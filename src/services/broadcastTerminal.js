/**
 * Broadcast Terminal Service
 * Executes commands on multiple nodes in parallel via SSH exec.
 */

const { Client } = require('ssh2');
const logger = require('../utils/logger');
const cryptoService = require('./cryptoService');

const DEFAULT_TIMEOUT_MS = 60000;
const MAX_COMMAND_LENGTH = 4096;

class BroadcastSession {
    /**
     * @param {import('ws').WebSocket} ws
     */
    constructor(ws) {
        this.ws = ws;
        /** @type {Map<string, { conn: Client, stream: any, timer: NodeJS.Timeout | null, resolve: Function }>} */
        this.active = new Map();
        this.running = false;
    }

    /**
     * Send JSON message to the client WebSocket.
     */
    _send(payload) {
        if (this.ws.readyState === 1) {
            this.ws.send(JSON.stringify(payload));
        }
    }

    /**
     * Build ssh2 connection config from a node document.
     */
    _buildConfig(node) {
        const config = {
            host: node.ip,
            port: node.ssh?.port || 22,
            username: node.ssh?.username || 'root',
            readyTimeout: 15000,
        };
        if (node.ssh?.privateKey) {
            config.privateKey = cryptoService.decryptPrivateKey(node.ssh.privateKey);
        } else if (node.ssh?.password) {
            config.password = cryptoService.decryptSafe(node.ssh.password);
        } else {
            throw new Error('SSH credentials not configured');
        }
        return config;
    }

    /**
     * Execute a command on a single node, streaming output back to the client.
     */
    _execOnNode(node, command, timeoutMs) {
        return new Promise((resolve) => {
            const nodeId = node._id.toString();
            const startedAt = Date.now();
            const conn = new Client();
            let settled = false;

            const finish = (success) => {
                if (settled) return;
                settled = true;
                const entry = this.active.get(nodeId);
                if (entry?.timer) clearTimeout(entry.timer);
                this.active.delete(nodeId);
                try { conn.end(); } catch (_) {}
                resolve({ nodeId, success });
            };

            this._send({ type: 'node-status', nodeId, name: node.name, ip: node.ip, status: 'connecting' });

            let config;
            try {
                config = this._buildConfig(node);
            } catch (err) {
                this._send({ type: 'node-status', nodeId, name: node.name, ip: node.ip, status: 'error', error: err.message });
                return finish(false);
            }

            conn.on('ready', () => {
                this._send({ type: 'node-status', nodeId, name: node.name, ip: node.ip, status: 'connected' });

                conn.exec(command, (err, stream) => {
                    if (err) {
                        this._send({ type: 'node-status', nodeId, name: node.name, ip: node.ip, status: 'error', error: err.message });
                        return finish(false);
                    }

                    const timer = setTimeout(() => {
                        this._send({ type: 'exit', nodeId, code: -1, durationMs: Date.now() - startedAt, timedOut: true });
                        finish(false);
                    }, timeoutMs);

                    this.active.set(nodeId, { conn, stream, timer, resolve: () => finish(false) });

                    stream.on('data', (data) => {
                        this._send({ type: 'output', nodeId, data: data.toString('utf8'), stream: 'stdout' });
                    });

                    stream.stderr.on('data', (data) => {
                        this._send({ type: 'output', nodeId, data: data.toString('utf8'), stream: 'stderr' });
                    });

                    stream.on('close', (code) => {
                        const durationMs = Date.now() - startedAt;
                        this._send({ type: 'exit', nodeId, code: code ?? 0, durationMs });
                        finish(code === 0);
                    });
                });
            });

            conn.on('error', (err) => {
                logger.warn(`[Broadcast] SSH error on ${node.name}: ${err.message}`);
                this._send({ type: 'node-status', nodeId, name: node.name, ip: node.ip, status: 'error', error: err.message });
                finish(false);
            });

            conn.connect(config);
        });
    }

    /**
     * Execute a command on the provided list of nodes in parallel.
     * @param {object[]} nodes - Array of node documents (already filtered for SSH creds)
     * @param {string} command
     * @param {number} [timeoutMs]
     */
    async exec(nodes, command, timeoutMs = DEFAULT_TIMEOUT_MS) {
        if (this.running) {
            this._send({ type: 'error', message: 'Another command is already running' });
            return;
        }

        if (!command || command.length > MAX_COMMAND_LENGTH) {
            this._send({ type: 'error', message: 'Invalid command' });
            return;
        }

        this.running = true;
        logger.info(`[Broadcast] exec on ${nodes.length} nodes: ${command.substring(0, 100)}`);

        const results = await Promise.allSettled(
            nodes.map((node) => this._execOnNode(node, command, timeoutMs))
        );

        const summary = results.reduce(
            (acc, r) => {
                const val = r.status === 'fulfilled' ? r.value : { success: false };
                val.success ? acc.success++ : acc.failed++;
                acc.total++;
                return acc;
            },
            { total: 0, success: 0, failed: 0 }
        );

        if (this.running) {
            this._send({ type: 'done', summary });
        }
        this.running = false;
    }

    /**
     * Cancel all running streams (sends SIGINT / closes streams).
     */
    cancel() {
        for (const [, entry] of this.active) {
            if (entry.timer) clearTimeout(entry.timer);
            if (entry.resolve) entry.resolve();
            try { entry.stream?.close(); } catch (_) {}
            try { entry.conn?.end(); } catch (_) {}
        }
        this.active.clear();
        this.running = false;
        logger.info('[Broadcast] Cancelled');
    }

    /**
     * Tear down all connections on WebSocket close.
     */
    destroy() {
        this.cancel();
    }
}

module.exports = BroadcastSession;
