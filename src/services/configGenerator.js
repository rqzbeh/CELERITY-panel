/**
 * Hysteria 2 config generator
 */

const yaml = require('yaml');

/**
 * Generate YAML config for Hysteria 2 node
 * @param {Object} node - Node configuration
 * @param {string} authUrl - Auth API URL
 * @param {Object} options - Additional options
 * @param {boolean} options.authInsecure - Allow self-signed certs for auth API (default: true)
 */
function generateNodeConfig(node, authUrl, options = {}) {
    const { authInsecure = true } = options;
    
    const config = {
        listen: `:${node.port}`,
        
        sniff: {
            enable: true,
            timeout: '2s',
            rewriteDomain: false,
            tcpPorts: '80,443,8000-9000',
            udpPorts: '443,80,53',
        },
        
        quic: {
            initStreamReceiveWindow: 8388608,
            maxStreamReceiveWindow: 8388608,
            initConnReceiveWindow: 20971520,
            maxConnReceiveWindow: 20971520,
            maxIdleTimeout: '60s',
            maxIncomingStreams: 256,
            disablePathMTUDiscovery: false,
        },
        
        auth: {
            type: 'http',
            http: {
                url: authUrl,
                insecure: authInsecure,
            },
        },
        
        ignoreClientBandwidth: false,
        
        masquerade: {
            type: 'proxy',
            proxy: {
                url: 'https://www.google.com',
                rewriteHost: true,
            },
        },
        
        acl: {
            inline: [
                'reject(geoip:cn)',
                'reject(geoip:private)',
            ],
        },
    };
    
    if (node.domain) {
        // ACME - SNI must match domain (sniGuard: dns-san by default)
        config.acme = {
            domains: [node.domain],
            email: 'acme@' + node.domain,
            ca: 'letsencrypt',
            listenHost: '0.0.0.0',
        };
    } else {
        // Self-signed certificate
        config.tls = {
            cert: node.paths?.cert || '/etc/hysteria/cert.pem',
            key: node.paths?.key || '/etc/hysteria/key.pem',
        };
        // If custom SNI is set, disable sniGuard to allow domain fronting
        if (node.sni) {
            config.tls.sniGuard = 'disable';
        }
    }
    
    if (node.statsPort && node.statsSecret) {
        config.trafficStats = {
            listen: `:${node.statsPort}`,
            secret: node.statsSecret,
        };
    }
    
    applyOutboundsAndAcl(config, node);
    
    return yaml.stringify(config);
}

/**
 * Apply outbounds and ACL rules from node settings to config object
 * @param {Object} config - Hysteria config object (mutated in place)
 * @param {Object} node - Node with outbounds and aclRules fields
 */
function applyOutboundsAndAcl(config, node) {
    const customOutbounds = node.outbounds || [];
    const customAclRules = node.aclRules || [];
    
    if (customOutbounds.length > 0) {
        config.outbounds = customOutbounds.map(ob => {
            const entry = { name: ob.name, type: ob.type };
            if (ob.type === 'socks5' || ob.type === 'http') {
                const proxyConfig = { addr: ob.addr };
                if (ob.username) proxyConfig.username = ob.username;
                if (ob.password) proxyConfig.password = ob.password;
                entry[ob.type] = proxyConfig;
            }
            return entry;
        });
    }
    
    if (customAclRules.length > 0) {
        config.acl = { inline: customAclRules };
    }
}

/**
 * Generate config with ACME (Let's Encrypt)
 * @param {Object} node - Node configuration
 * @param {string} authUrl - Auth API URL
 * @param {string} domain - ACME domain
 * @param {string} email - ACME email
 * @param {Object} options - Additional options
 * @param {boolean} options.authInsecure - Allow self-signed certs for auth API (default: true)
 */
function generateNodeConfigACME(node, authUrl, domain, email, options = {}) {
    const { authInsecure = true } = options;
    
    const config = {
        listen: `:${node.port}`,
        
        acme: {
            domains: [domain],
            email: email,
        },
        
        sniff: {
            enable: true,
            timeout: '2s',
            rewriteDomain: false,
            tcpPorts: '80,443,8000-9000',
            udpPorts: '443,80,53',
        },
        
        quic: {
            initStreamReceiveWindow: 8388608,
            maxStreamReceiveWindow: 8388608,
            initConnReceiveWindow: 20971520,
            maxConnReceiveWindow: 20971520,
            maxIdleTimeout: '60s',
            maxIncomingStreams: 256,
            disablePathMTUDiscovery: false,
        },
        
        auth: {
            type: 'http',
            http: {
                url: authUrl,
                insecure: authInsecure,
            },
        },
        
        ignoreClientBandwidth: false,
        
        masquerade: {
            type: 'proxy',
            proxy: {
                url: 'https://www.google.com',
                rewriteHost: true,
            },
        },
        
        acl: {
            inline: [
                'reject(geoip:cn)',
                'reject(geoip:private)',
            ],
        },
    };
    
    if (node.statsPort && node.statsSecret) {
        config.trafficStats = {
            listen: `:${node.statsPort}`,
            secret: node.statsSecret,
        };
    }
    
    applyOutboundsAndAcl(config, node);
    
    return yaml.stringify(config);
}

/**
 * Generate systemd service file for Hysteria
 */
function generateSystemdService() {
    return `[Unit]
Description=Hysteria 2 Server
After=network.target

[Service]
Type=simple
ExecStart=/usr/local/bin/hysteria server -c /etc/hysteria/config.yaml
Restart=always
RestartSec=3
LimitNOFILE=1048576

[Install]
WantedBy=multi-user.target
`;
}

module.exports = {
    generateNodeConfig,
    generateNodeConfigACME,
    generateSystemdService,
    applyOutboundsAndAcl,
};
