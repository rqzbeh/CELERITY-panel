/**
 * Webhook service
 *
 * Sends event notifications to a configured URL.
 * Delivery is fire-and-forget (async, non-blocking, 5s timeout).
 *
 * Each request is signed with HMAC-SHA256:
 *   X-Webhook-Signature: sha256=<hmac>
 *   X-Webhook-Event:     <event>
 *   X-Webhook-Timestamp: <unix seconds>
 *
 * Verification (receiver side):
 *   expected = HMAC-SHA256(secret, timestamp + "." + rawBody)
 *   compare with X-Webhook-Signature header value (after "sha256=")
 */

const crypto = require('crypto');
const axios = require('axios');
const logger = require('../utils/logger');
const cryptoService = require('./cryptoService');

const WEBHOOK_TIMEOUT_MS = 5000;

/**
 * All supported event names
 */
const EVENTS = {
    USER_CREATED: 'user.created',
    USER_UPDATED: 'user.updated',
    USER_DELETED: 'user.deleted',
    USER_ENABLED: 'user.enabled',
    USER_DISABLED: 'user.disabled',
    USER_TRAFFIC_EXCEEDED: 'user.traffic_exceeded',
    USER_EXPIRED: 'user.expired',
    NODE_ONLINE: 'node.online',
    NODE_OFFLINE: 'node.offline',
    NODE_ERROR: 'node.error',
    SYNC_COMPLETED: 'sync.completed',
};

/**
 * Compute HMAC-SHA256 signature
 */
function sign(secret, timestamp, body) {
    const payload = `${timestamp}.${body}`;
    return 'sha256=' + crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

/**
 * Load webhook settings (uses helpers to get cached settings)
 */
async function getWebhookSettings() {
    const { getSettings } = require('../utils/helpers');
    const settings = await getSettings();
    return settings?.webhook || null;
}

/**
 * Send an event to the configured webhook URL.
 * Non-blocking — errors are only logged.
 *
 * @param {string} event  - One of EVENTS.*
 * @param {object} data   - Event payload
 */
async function send(event, data) {
    let webhookSettings;
    try {
        webhookSettings = await getWebhookSettings();
    } catch (err) {
        logger.error(`[Webhook] Failed to load settings: ${err.message}`);
        return;
    }

    if (!webhookSettings || !webhookSettings.enabled || !webhookSettings.url) return;

    // Filter by configured events (empty = all)
    const allowedEvents = webhookSettings.events || [];
    if (allowedEvents.length > 0 && !allowedEvents.includes(event)) return;

    const timestamp = Math.floor(Date.now() / 1000).toString();
    const payload = JSON.stringify({
        event,
        timestamp: new Date().toISOString(),
        data,
    });

    const secret = cryptoService.decryptSafe(webhookSettings.secret) || '';
    const signature = sign(secret, timestamp, payload);

    try {
        await axios.post(webhookSettings.url, payload, {
            timeout: WEBHOOK_TIMEOUT_MS,
            headers: {
                'Content-Type': 'application/json',
                'X-Webhook-Event': event,
                'X-Webhook-Timestamp': timestamp,
                'X-Webhook-Signature': signature,
                'User-Agent': 'C3-Celerity-Webhook/1.0',
            },
        });
        logger.debug(`[Webhook] Sent ${event} to ${webhookSettings.url}`);
    } catch (err) {
        const status = err.response?.status;
        logger.warn(`[Webhook] Delivery failed for ${event}: ${status ? `HTTP ${status}` : err.message}`);
    }
}

/**
 * Fire-and-forget wrapper — never throws, never awaits
 */
function emit(event, data) {
    send(event, data).catch(() => {});
}

/**
 * Test webhook delivery (used by UI "Test" button).
 * Returns { success, status, error }
 */
async function test(url, secret) {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const payload = JSON.stringify({
        event: 'test',
        timestamp: new Date().toISOString(),
        data: { message: 'Test webhook from C³ CELERITY' },
    });

    const signature = sign(secret || '', timestamp, payload);

    try {
        const response = await axios.post(url, payload, {
            timeout: WEBHOOK_TIMEOUT_MS,
            headers: {
                'Content-Type': 'application/json',
                'X-Webhook-Event': 'test',
                'X-Webhook-Timestamp': timestamp,
                'X-Webhook-Signature': signature,
                'User-Agent': 'C3-Celerity-Webhook/1.0',
            },
        });
        return { success: true, status: response.status };
    } catch (err) {
        return {
            success: false,
            status: err.response?.status || null,
            error: err.message,
        };
    }
}

module.exports = { emit, send, test, EVENTS };
