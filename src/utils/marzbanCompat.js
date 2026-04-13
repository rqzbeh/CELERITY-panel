/**
 * Marzban subscription token compatibility decoder.
 *
 * Ports the Python algorithm from Marzban's app/utils/jwt.py to Node.js so that
 * existing subscription links (/sub/<token>) issued by a Marzban panel remain
 * valid after migration to Celerity.
 *
 * Supported token formats:
 *  1. New format (default since Marzban ~0.4):
 *       base64url(username + "," + ceil(time())) + SHA256_signature_10chars
 *     Python uses base64 with altchars=b'-_' and strips padding — this is
 *     identical to Node's native 'base64url' encoding.
 *  2. Legacy JWT format (eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.…):
 *       Standard HS256 JWT with payload { sub: username, access: "subscription" }
 */

'use strict';

const crypto = require('crypto');

// Fixed JWT header produced by PyJWT for HS256 — used to detect legacy tokens
const LEGACY_JWT_HEADER = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.';

/**
 * Decode and verify a Marzban subscription token.
 *
 * @param {string} token      - Raw token from the URL path segment
 * @param {string} secretKey  - 64-char hex string from Marzban's `jwt` table
 * @returns {{ username: string, createdAt: number }|null}
 *          Parsed payload or null if the token is invalid / signature mismatch
 */
function decodeMarzbanToken(token, secretKey) {
    if (!token || typeof token !== 'string' || token.length < 15) return null;
    if (!secretKey) return null;

    // --- Legacy JWT format ---
    if (token.startsWith(LEGACY_JWT_HEADER)) {
        return _decodeLegacyJwt(token, secretKey);
    }

    // --- New format ---
    return _decodeNewFormat(token, secretKey);
}

/**
 * Decode Marzban's new-style token.
 *
 * Python reference (jwt.py):
 *   data        = username + ',' + str(ceil(time.time()))
 *   data_b64    = base64url(data).rstrip('=')
 *   signature   = base64url(sha256(data_b64 + secret_key))[:10]
 *   token       = data_b64 + signature
 */
function _decodeNewFormat(token, secretKey) {
    if (token.length < 10) return null;

    const dataB64 = token.slice(0, -10);
    const sig     = token.slice(-10);

    // Verify signature: SHA256(payload + secretKey) → base64url → first 10 chars
    const expected = crypto
        .createHash('sha256')
        .update(dataB64 + secretKey)
        .digest('base64url')
        .slice(0, 10);

    if (sig !== expected) return null;

    // Decode payload
    let decoded;
    try {
        decoded = Buffer.from(dataB64, 'base64url').toString('utf8');
    } catch {
        return null;
    }

    const commaIdx = decoded.lastIndexOf(',');
    if (commaIdx === -1) return null;

    const username   = decoded.slice(0, commaIdx);
    const tsStr      = decoded.slice(commaIdx + 1);
    const createdAt  = parseInt(tsStr, 10);

    if (!username || isNaN(createdAt)) return null;

    return { username, createdAt };
}

/**
 * Decode a legacy PyJWT HS256 subscription token.
 * The token was signed with the same secretKey.
 */
function _decodeLegacyJwt(token, secretKey) {
    const parts = token.split('.');
    if (parts.length !== 3) return null;

    try {
        // Verify signature: HMAC-SHA256(header + "." + payload, secretKey) → base64url
        const signingInput = `${parts[0]}.${parts[1]}`;
        const expected = crypto
            .createHmac('sha256', secretKey)
            .update(signingInput)
            .digest('base64url');

        if (expected !== parts[2]) return null;

        const payload = JSON.parse(
            Buffer.from(parts[1], 'base64url').toString('utf8'),
        );

        if (payload.access !== 'subscription') return null;
        if (!payload.sub) return null;

        return {
            username:  payload.sub,
            createdAt: payload.iat || 0,
        };
    } catch {
        return null;
    }
}

module.exports = { decodeMarzbanToken };
