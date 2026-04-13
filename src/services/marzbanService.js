/**
 * Marzban migration service.
 * Connects to a Marzban panel API, fetches users, and imports them into Celerity.
 */

'use strict';

const HyUser = require('../models/hyUserModel');
const logger = require('../utils/logger');

// In-memory job store: jobId -> { phase, fetched, total, imported, created, skipped, errors, done, error, cancel }
const jobs = new Map();

// Timeout for a single paginated fetch from Marzban (ms)
const PAGE_FETCH_TIMEOUT_MS = 60_000;
// Maximum total import time before aborting (ms)
const TOTAL_IMPORT_TIMEOUT_MS = 10 * 60_000;
// Users per page when fetching from Marzban
const PAGE_SIZE = 100;
// bulkWrite batch size for MongoDB
const MONGO_BATCH_SIZE = 500;

/**
 * Sanitize and normalize the panel base URL.
 * Strips trailing slash.
 */
function normalizeUrl(rawUrl) {
    return String(rawUrl || '').trim().replace(/\/+$/, '');
}

/**
 * Fetch with timeout + retry (exponential backoff).
 * @param {string} url
 * @param {RequestInit} options
 * @param {number} maxRetries
 * @returns {Promise<Response>}
 */
async function fetchWithRetry(url, options, maxRetries = 3) {
    let lastError;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), PAGE_FETCH_TIMEOUT_MS);
        try {
            const res = await fetch(url, { ...options, signal: controller.signal });
            clearTimeout(timer);
            if (res.status >= 500) {
                throw new Error(`HTTP ${res.status}`);
            }
            return res;
        } catch (err) {
            clearTimeout(timer);
            lastError = err;
            if (attempt < maxRetries) {
                // Exponential backoff: 2s, 4s, 8s
                await new Promise(r => setTimeout(r, 2 ** attempt * 1000));
            }
        }
    }
    throw lastError;
}

/**
 * Authenticate with the Marzban admin API.
 * @param {string} baseUrl - Panel base URL (e.g. https://marzban.example.com)
 * @param {string} username
 * @param {string} password
 * @returns {Promise<string>} Bearer access token
 */
async function connect(baseUrl, username, password) {
    const url = normalizeUrl(baseUrl);
    const body = new URLSearchParams({ username, password });

    const res = await fetchWithRetry(`${url}/api/admin/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
    });

    if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`Marzban auth failed (HTTP ${res.status}): ${text}`);
    }

    const data = await res.json();
    if (!data.access_token) {
        throw new Error('No access_token in Marzban response');
    }
    return data.access_token;
}

/**
 * Fetch only the total user count (limit=1 for speed).
 * @param {string} baseUrl
 * @param {string} token
 * @returns {Promise<number>}
 */
async function fetchUsersCount(baseUrl, token) {
    const url = normalizeUrl(baseUrl);
    const res = await fetchWithRetry(`${url}/api/users?limit=1`, {
        headers: { Authorization: `Bearer ${token}` },
    });

    if (!res.ok) {
        throw new Error(`Marzban /api/users failed (HTTP ${res.status})`);
    }

    const data = await res.json();
    return data.total || 0;
}

/**
 * Map a Marzban user object to a Celerity HyUser document fields.
 * @param {object} marzbanUser
 * @returns {object}
 */
function parseUser(marzbanUser) {
    const proxies = marzbanUser.proxies || {};

    // Prefer VLESS UUID, fall back to VMess UUID
    const xrayUuid =
        proxies.vless?.id ||
        proxies.vmess?.id ||
        null;

    // Map status to enabled flag
    const enabled = marzbanUser.status === 'active';

    // Convert Unix timestamp to Date (null if no expiry)
    const expireAt =
        marzbanUser.expire ? new Date(marzbanUser.expire * 1000) : null;

    return {
        userId: marzbanUser.username,
        username: marzbanUser.username,
        xrayUuid: xrayUuid || undefined, // undefined = let model default generate UUID
        enabled,
        expireAt,
        trafficLimit: marzbanUser.data_limit || 0,
        traffic: {
            rx: marzbanUser.used_traffic || 0,
            tx: 0,
        },
    };
}

/**
 * Write a batch of parsed users to MongoDB via bulkWrite (upsert).
 * Uses $setOnInsert so existing users are never overwritten.
 * @param {object[]} parsedUsers
 * @param {string|null} groupId  - ObjectId string for target group
 * @param {object} cryptoService
 * @returns {{ created: number, skipped: number, errors: number }}
 */
async function writeBatch(parsedUsers, groupId, cryptoService) {
    const ops = parsedUsers.map(u => {
        const doc = {
            ...u,
            password: cryptoService.generatePassword(u.userId),
            nodes: [],
        };
        if (groupId) {
            doc.groups = [groupId];
        }
        return {
            updateOne: {
                filter: { userId: u.userId },
                update: { $setOnInsert: doc },
                upsert: true,
            },
        };
    });

    try {
        const result = await HyUser.bulkWrite(ops, { ordered: false });
        const created = result.upsertedCount || 0;
        const skipped = parsedUsers.length - created;
        return { created, skipped, errors: 0 };
    } catch (err) {
        logger.error(`[Marzban] bulkWrite error: ${err.message}`);
        return { created: 0, skipped: 0, errors: parsedUsers.length };
    }
}

/**
 * Start an async import job.
 * Returns jobId immediately; progress can be polled via getJobProgress().
 *
 * @param {string} baseUrl
 * @param {string} token  - Marzban access token
 * @param {string|null} groupId
 * @param {object} cryptoService
 * @returns {string} jobId
 */
function startImportJob(baseUrl, token, totalUsers, groupId, cryptoService) {
    const jobId = `mig_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    const job = {
        phase: 'starting',
        fetched: 0,
        total: totalUsers || 0,
        imported: 0,
        created: 0,
        skipped: 0,
        errors: 0,
        done: false,
        cancelled: false,
        errorMessage: null,
        startedAt: Date.now(),
    };
    jobs.set(jobId, job);

    // Run async without blocking the caller
    _runImport(jobId, baseUrl, token, totalUsers, groupId, cryptoService).catch(err => {
        const j = jobs.get(jobId);
        if (j) {
            j.phase = 'error';
            j.done = true;
            j.errorMessage = err.message;
        }
        logger.error(`[Marzban] Import job ${jobId} failed: ${err.message}`);
    });

    return jobId;
}

/**
 * Internal: runs the full fetch+import cycle for a job.
 */
async function _runImport(jobId, baseUrl, token, totalUsers, groupId, cryptoService) {
    const job = jobs.get(jobId);
    const url = normalizeUrl(baseUrl);
    const deadline = job.startedAt + TOTAL_IMPORT_TIMEOUT_MS;
    const total = totalUsers || job.total;

    job.phase = 'fetching';
    job.total = total;

    let offset = 0;
    let mongoBatch = [];

    while (offset < total) {
        // Check cancellation and timeout
        if (job.cancelled) {
            job.phase = 'cancelled';
            job.done = true;
            return;
        }
        if (Date.now() > deadline) {
            logger.warn(`[Marzban] Import job ${jobId} timed out after 10 min`);
            break;
        }

        // Fetch one page
        let pageData;
        try {
            const res = await fetchWithRetry(
                `${url}/api/users?offset=${offset}&limit=${PAGE_SIZE}`,
                { headers: { Authorization: `Bearer ${token}` } },
            );
            pageData = await res.json();
        } catch (err) {
            logger.error(`[Marzban] Page fetch error at offset ${offset}: ${err.message}`);
            job.errors += PAGE_SIZE;
            offset += PAGE_SIZE;
            continue;
        }

        const pageUsers = pageData.users || [];
        if (pageUsers.length === 0) break;

        job.fetched += pageUsers.length;
        offset += pageUsers.length;

        // Parse and accumulate
        for (const marzbanUser of pageUsers) {
            try {
                mongoBatch.push(parseUser(marzbanUser));
            } catch (err) {
                job.errors++;
            }
        }

        // Flush when batch is full
        if (mongoBatch.length >= MONGO_BATCH_SIZE) {
            const result = await writeBatch(mongoBatch, groupId, cryptoService);
            job.created += result.created;
            job.skipped += result.skipped;
            job.errors += result.errors;
            job.imported += mongoBatch.length;
            mongoBatch = [];
        }
    }

    // Flush remaining
    if (mongoBatch.length > 0) {
        const result = await writeBatch(mongoBatch, groupId, cryptoService);
        job.created += result.created;
        job.skipped += result.skipped;
        job.errors += result.errors;
        job.imported += mongoBatch.length;
    }

    job.phase = 'done';
    job.done = true;

    logger.info(`[Marzban] Import job ${jobId} complete: created=${job.created} skipped=${job.skipped} errors=${job.errors}`);
}

/**
 * Get current progress of an import job.
 * @param {string} jobId
 * @returns {object|null}
 */
function getJobProgress(jobId) {
    return jobs.get(jobId) || null;
}

/**
 * Cancel a running import job.
 * @param {string} jobId
 */
function cancelJob(jobId) {
    const job = jobs.get(jobId);
    if (job && !job.done) {
        job.cancelled = true;
    }
}

/**
 * Clean up finished jobs older than 30 minutes from memory.
 */
function cleanupOldJobs() {
    const cutoff = Date.now() - 30 * 60_000;
    for (const [id, job] of jobs.entries()) {
        if (job.done && job.startedAt < cutoff) {
            jobs.delete(id);
        }
    }
}

// Periodic cleanup every 30 minutes
setInterval(cleanupOldJobs, 30 * 60_000).unref();

module.exports = {
    connect,
    fetchUsersCount,
    startImportJob,
    getJobProgress,
    cancelJob,
};
