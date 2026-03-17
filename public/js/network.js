/**
 * Network topology visualization using cytoscape.js
 * With particle traffic animation and glow effects.
 */

(function () {
    'use strict';

    if (typeof cytoscape === 'undefined') return;

    if (typeof cytoscapeDagre !== 'undefined') {
        cytoscape.use(cytoscapeDagre);
    }

    const i18n = window._networkI18n || {};

    const STATUS_COLORS = {
        online:   '#22c55e',
        offline:  '#64748b',
        error:    '#ef4444',
        syncing:  '#eab308',
        deployed: '#3b82f6',
        pending:  '#475569',
    };

    const ROLE_BG = {
        standalone: '#0f172a',
        portal:     '#150e3a',
        bridge:     '#1a0e00',
        relay:      '#130a2a',
        internet:   '#0a2e1a',
    };

    const ROLE_BORDER_ACCENT = {
        standalone: '#334155',
        portal:     '#6366f1',
        bridge:     '#f59e0b',
        relay:      '#8b5cf6',
        internet:   '#22c55e',
    };

    const ROLE_GLOW = {
        standalone: null,
        portal:   '#6366f1',
        bridge:   '#f59e0b',
        relay:    '#8b5cf6',
        internet: '#22c55e',
    };

    const ROLE_LABELS = {
        standalone: '',
        portal:   i18n.rolePortal || 'PORTAL',
        relay:    i18n.roleRelay  || 'RELAY',
        bridge:   i18n.roleBridge || 'BRIDGE',
        internet: '',
    };

    let cy = null;

    // ==================== INIT ====================

    function init() {
        cy = cytoscape({
            container: document.getElementById('cy'),
            style: getCytoscapeStyle(),
            layout: { name: 'preset' },
            minZoom: 0.15,
            maxZoom: 4,
            wheelSensitivity: 0.3,
            boxSelectionEnabled: false,
        });

        cy.on('tap', 'node', onNodeTap);
        cy.on('tap', 'edge', onEdgeTap);
        cy.on('tap', function (e) { if (e.target === cy) closeInfoModal(); });
        cy.on('dragfree', 'node', onNodeDragEnd);

        document.getElementById('btnAutoLayout').addEventListener('click', runAutoLayout);
        document.getElementById('btnFitView').addEventListener('click', function () { cy.fit(50); });
        document.getElementById('btnRefresh').addEventListener('click', loadTopology);
        document.getElementById('btnAddLink').addEventListener('click', openAddLinkModal);
        document.getElementById('nodeInfoClose').addEventListener('click', closeInfoModal);
        document.getElementById('nodeInfoModal').addEventListener('click', function (e) {
            if (e.target === this) closeInfoModal();
        });
        document.getElementById('modalClose').addEventListener('click', closeModal);
        document.getElementById('modalCancel').addEventListener('click', closeModal);
        document.getElementById('addLinkForm').addEventListener('submit', onAddLinkSubmit);

        setTimeout(function () {
            cy.resize();
            loadTopology();
        }, 30);

        setInterval(refreshStatuses, 30000);

        if (typeof ResizeObserver !== 'undefined') {
            new ResizeObserver(function () { if (cy) cy.resize(); })
                .observe(document.getElementById('cy'));
        }

        window._networkResize = function () {
            if (cy) { cy.resize(); cy.fit(50); }
        };
    }

    // ==================== DATA LOADING ====================

    async function loadTopology() {
        showLoading(true);
        setEmptyState(false);
        try {
            const res = await fetch('/api/cascade/topology');
            if (!res.ok) throw new Error('HTTP ' + res.status);
            const data = await res.json();
            renderGraph(data);
        } catch (err) {
            console.error('[Network] Topology load error:', err);
        } finally {
            showLoading(false);
        }
    }

    async function refreshStatuses() {
        try {
            const res = await fetch('/api/cascade/topology');
            if (!res.ok) return;
            const data = await res.json();
            cy.batch(function () {
                for (const n of data.nodes) {
                    const ele = cy.getElementById(n.data.id);
                    if (ele.length) {
                        ele.data('status', n.data.status);
                        ele.data('onlineUsers', n.data.onlineUsers);
                    }
                }
                for (const e of data.edges) {
                    const ele = cy.getElementById(e.data.id);
                    if (ele.length) {
                        ele.data('status', e.data.status);
                        ele.data('latencyMs', e.data.latencyMs);
                    }
                }
            });
        } catch (_) {}
    }

    function renderGraph(data) {
        cy.elements().remove();

        const isEmpty = (!data.nodes || data.nodes.length === 0) &&
                        (!data.edges || data.edges.length === 0);
        if (isEmpty) { setEmptyState(true); return; }
        setEmptyState(false);

        const elements = [];

        for (const n of data.nodes) {
            const role = n.data.cascadeRole || 'standalone';
            const roleLabel = ROLE_LABELS[role] || '';
            const displayLabel = (n.data.flag ? n.data.flag + '\u2009' : '') + (n.data.label || n.data.ip || '');
            const subtitle = n.data.ip || '';

            elements.push({
                group: 'nodes',
                data: {
                    ...n.data,
                    roleLabel,
                    displayLabel,
                    subtitle,
                    roleBg:     ROLE_BG[role]            || ROLE_BG.standalone,
                    roleAccent: ROLE_BORDER_ACCENT[role] || ROLE_BORDER_ACCENT.standalone,
                    roleGlow:   ROLE_GLOW[role]          || null,
                },
                position: n.position || undefined,
            });
        }

        for (const e of data.edges) {
            elements.push({
                group: 'edges',
                data: { ...e.data, edgeLabel: buildEdgeLabel(e.data) },
            });
        }

        cy.add(elements);

        const hasPositions = data.nodes.some(n => n.position);
        if (hasPositions) { cy.fit(50); } else { runAutoLayout(); }

        initParticleSystem();
    }

    function buildEdgeLabel(d) {
        const parts = [];
        if (d.tunnelProtocol) parts.push(d.tunnelProtocol.toUpperCase());
        if (d.tunnelPort)     parts.push(':' + d.tunnelPort);
        if (d.latencyMs != null) parts.push(d.latencyMs + 'ms');
        return parts.join(' ');
    }

    // ==================== CYTOSCAPE STYLE ====================

    function getCytoscapeStyle() {
        return [
            // ---- Node base ----
            {
                selector: 'node',
                style: {
                    'shape': 'round-rectangle',
                    'width': 154,
                    'height': 54,
                    'background-color': function (e) { return e.data('roleBg') || ROLE_BG.standalone; },
                    'border-width': 1.5,
                    'border-color': function (e) {
                        const s = e.data('status');
                        if (s === 'online')  return STATUS_COLORS.online;
                        if (s === 'error')   return STATUS_COLORS.error;
                        return e.data('roleAccent') || ROLE_BORDER_ACCENT.standalone;
                    },
                    'label': function (e) {
                        const rl = e.data('roleLabel');
                        const main = e.data('displayLabel') || e.data('label') || '';
                        const sub = e.data('subtitle') || '';
                        return (rl ? '[' + rl + ']\n' : '') + main + (sub ? '\n' + sub : '');
                    },
                    'text-valign': 'center',
                    'text-halign': 'center',
                    'color': '#e2e8f0',
                    'font-size': '11px',
                    'font-family': 'JetBrains Mono, "Fira Code", monospace',
                    'font-weight': 500,
                    'text-wrap': 'wrap',
                    'text-max-width': '140px',
                    'line-height': 1.45,
                    'overlay-opacity': 0,
                    // glow: default subtle
                    'shadow-blur':      12,
                    'shadow-color':     function (e) { return e.data('roleGlow') || '#000'; },
                    'shadow-opacity':   function (e) { return e.data('roleGlow') ? 0.45 : 0; },
                    'shadow-offset-x':  0,
                    'shadow-offset-y':  0,
                },
            },
            // ---- Online node — green glow ----
            {
                selector: 'node[status = "online"]',
                style: {
                    'border-color':   STATUS_COLORS.online,
                    'border-width':   2,
                    'shadow-blur':    22,
                    'shadow-color':   STATUS_COLORS.online,
                    'shadow-opacity': 0.55,
                },
            },
            // ---- Error node — red pulse ----
            {
                selector: 'node[status = "error"]',
                style: {
                    'border-color':   STATUS_COLORS.error,
                    'shadow-blur':    16,
                    'shadow-color':   STATUS_COLORS.error,
                    'shadow-opacity': 0.5,
                },
            },
            // ---- Internet node — globe icon ----
            {
                selector: 'node[cascadeRole = "internet"]',
                style: {
                    'shape': 'ellipse',
                    'width': 60,
                    'height': 60,
                    'background-color': '#0a2e1a',
                    'border-width': 2,
                    'border-color': '#22c55e',
                    'label': '🌐\nInternet',
                    'font-size': '10px',
                    'shadow-blur': 20,
                    'shadow-color': '#22c55e',
                    'shadow-opacity': 0.5,
                },
            },
            // ---- Selected ----
            {
                selector: 'node:selected',
                style: {
                    'border-width':   2.5,
                    'border-color':   '#818cf8',
                    'shadow-blur':    24,
                    'shadow-color':   '#6366f1',
                    'shadow-opacity': 0.7,
                    'overlay-opacity': 0,
                },
            },
            { selector: 'node:active', style: { 'overlay-opacity': 0 } },

            // ---- Edge base ----
            {
                selector: 'edge',
                style: {
                    'width': 1.5,
                    'line-color':          function (e) { return STATUS_COLORS[e.data('status')] || STATUS_COLORS.pending; },
                    'target-arrow-color':  function (e) { return STATUS_COLORS[e.data('status')] || STATUS_COLORS.pending; },
                    'target-arrow-shape':  'triangle',
                    'curve-style':         'bezier',
                    'arrow-scale':         1,
                    'label':               function (e) { return e.data('edgeLabel') || ''; },
                    'font-size':           '9px',
                    'font-family':         'JetBrains Mono, monospace',
                    'color':               '#64748b',
                    'text-background-color':   '#0a0f1e',
                    'text-background-opacity': 0.9,
                    'text-background-padding': '3px',
                    'text-background-shape':   'round-rectangle',
                    'text-rotation':       'autorotate',
                    'overlay-opacity': 0,
                    'line-style': 'dashed',
                    'line-dash-pattern': [6, 4],
                    'line-dash-offset': 0,
                },
            },
            {
                selector: 'edge[status = "online"]',
                style: {
                    'width': 2.5,
                    'line-dash-pattern': [10, 5],
                    'shadow-blur':    8,
                    'shadow-color':   STATUS_COLORS.online,
                    'shadow-opacity': 0.5,
                    'shadow-offset-x': 0,
                    'shadow-offset-y': 0,
                },
            },
            {
                selector: 'edge[status = "deployed"]',
                style: {
                    'width': 2,
                    'line-dash-pattern': [8, 4],
                    'shadow-blur':    6,
                    'shadow-color':   STATUS_COLORS.deployed,
                    'shadow-opacity': 0.4,
                    'shadow-offset-x': 0,
                    'shadow-offset-y': 0,
                },
            },
            {
                selector: 'edge[status = "syncing"]',
                style: {
                    'width': 2,
                    'line-color': STATUS_COLORS.syncing,
                    'line-dash-pattern': [4, 3],
                },
            },
            {
                selector: 'edge:selected',
                style: {
                    'width': 3,
                    'line-color':         '#818cf8',
                    'target-arrow-color': '#818cf8',
                    'shadow-blur':    12,
                    'shadow-color':   '#6366f1',
                    'shadow-opacity': 0.6,
                    'shadow-offset-x': 0,
                    'shadow-offset-y': 0,
                },
            },
            // ---- Internet edge — green dashed ----
            {
                selector: 'edge[?isInternetEdge]',
                style: {
                    'width': 1.5,
                    'line-color': '#22c55e',
                    'target-arrow-color': '#22c55e',
                    'line-dash-pattern': [4, 6],
                    'opacity': 0.7,
                },
            },
        ];
    }

    // ==================== DASH ANIMATION ====================

    let dashOffset = 0;
    let dashAnimFrame = null;

    function startDashAnimation() {
        if (dashAnimFrame) cancelAnimationFrame(dashAnimFrame);

        function loop() {
            dashOffset -= 0.55;
            cy.batch(function () {
                cy.edges().style('line-dash-offset', dashOffset);
            });
            dashAnimFrame = requestAnimationFrame(loop);
        }
        loop();
    }

    // ==================== PARTICLE SYSTEM ====================

    let particleCanvas = null;
    let particles = [];
    let particleAnimFrame = null;

    function initParticleSystem() {
        const page = document.querySelector('.network-page');
        if (!page) return;

        if (!particleCanvas) {
            particleCanvas = document.createElement('canvas');
            particleCanvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:4';
            page.appendChild(particleCanvas);
        }

        spawnParticles();

        if (!particleAnimFrame) {
            animateParticles();
        }

        if (!dashAnimFrame) {
            startDashAnimation();
        }

        cy.on('add remove', 'edge', spawnParticles);
        cy.on('data', 'edge', spawnParticles);
        cy.on('layoutstop', spawnParticles);
    }

    function spawnParticles() {
        particles = [];
        if (!cy) return;

        cy.edges().forEach(function (edge) {
            const status = edge.data('status');
            if (status !== 'online' && status !== 'deployed') return;

            const isOnline = status === 'online';
            const color    = isOnline ? [34, 197, 94] : [59, 130, 246];
            const count    = isOnline ? 4 : 2;

            for (let i = 0; i < count; i++) {
                particles.push({
                    edge,
                    progress: i / count,
                    speed: 0.0035 + Math.random() * 0.003,
                    size: isOnline ? 2.8 : 2.2,
                    color,
                });
            }
        });
    }

    function animateParticles() {
        const dpr = window.devicePixelRatio || 1;
        const page = document.querySelector('.network-page');
        if (!page || !particleCanvas || !cy) {
            particleAnimFrame = requestAnimationFrame(animateParticles);
            return;
        }

        const W = page.offsetWidth;
        const H = page.offsetHeight;

        if (particleCanvas.width !== W * dpr || particleCanvas.height !== H * dpr) {
            particleCanvas.width  = W * dpr;
            particleCanvas.height = H * dpr;
        }

        const ctx = particleCanvas.getContext('2d');
        ctx.clearRect(0, 0, particleCanvas.width, particleCanvas.height);

        const zoom = cy.zoom();
        const pan  = cy.pan();

        for (const p of particles) {
            p.progress += p.speed;
            if (p.progress >= 1) p.progress -= 1;

            const src = p.edge.source().position();
            const tgt = p.edge.target().position();

            // Bezier mid-point approximation (cytoscape default bend)
            const midX = (src.x + tgt.x) / 2;
            const midY = (src.y + tgt.y) / 2;

            // Quadratic bezier: P = (1-t)^2 * src + 2*(1-t)*t * mid + t^2 * tgt
            const t  = p.progress;
            const mt = 1 - t;
            const bx = mt * mt * src.x + 2 * mt * t * midX + t * t * tgt.x;
            const by = mt * mt * src.y + 2 * mt * t * midY + t * t * tgt.y;

            const sx = (bx * zoom + pan.x) * dpr;
            const sy = (by * zoom + pan.y) * dpr;
            const r  = p.size * dpr * Math.sqrt(zoom);

            // Trail
            const TRAIL = 7;
            for (let i = TRAIL; i >= 1; i--) {
                const tp = p.progress - i * p.speed * 2.5;
                if (tp < 0) continue;
                const ttm = 1 - tp;
                const tx = (ttm * ttm * src.x + 2 * ttm * tp * midX + tp * tp * tgt.x) * zoom + pan.x;
                const ty2 = (ttm * ttm * src.y + 2 * ttm * tp * midY + tp * tp * tgt.y) * zoom + pan.y;
                const alpha = (1 - i / TRAIL) * 0.5;
                const tr = r * (1 - i / TRAIL * 0.6);
                const [R, G, B] = p.color;
                ctx.beginPath();
                ctx.arc(tx * dpr, ty2 * dpr, Math.max(tr, 0.3), 0, Math.PI * 2);
                ctx.fillStyle = `rgba(${R},${G},${B},${alpha})`;
                ctx.fill();
            }

            // Main particle with radial glow
            const [R, G, B] = p.color;
            const grad = ctx.createRadialGradient(sx, sy, 0, sx, sy, r * 4);
            grad.addColorStop(0,    `rgba(${R},${G},${B},1)`);
            grad.addColorStop(0.35, `rgba(${R},${G},${B},0.55)`);
            grad.addColorStop(1,    `rgba(${R},${G},${B},0)`);

            ctx.beginPath();
            ctx.arc(sx, sy, r * 4, 0, Math.PI * 2);
            ctx.fillStyle = grad;
            ctx.fill();
        }

        particleAnimFrame = requestAnimationFrame(animateParticles);
    }

    // ==================== LAYOUT ====================

    function runAutoLayout() {
        const layout = cy.layout({
            name:              'dagre',
            rankDir:           'LR',
            nodeSep:           80,
            rankSep:           160,
            edgeSep:           30,
            animate:           true,
            animationDuration: 400,
            fit:               true,
            padding:           70,
        });
        layout.run();
    }

    // ==================== INFO MODAL ====================

    function openInfoModal(title, bodyHtml) {
        document.getElementById('nodeInfoTitleText').textContent = title;
        document.getElementById('nodeInfoBody').innerHTML = bodyHtml;
        document.getElementById('nodeInfoModal').classList.add('active');
    }

    function closeInfoModal() {
        document.getElementById('nodeInfoModal').classList.remove('active');
        cy.elements(':selected').unselect();
    }

    function onNodeTap(evt) {
        const d = evt.target.data();

        // Internet node - show simple info
        if (d.cascadeRole === 'internet') {
            const html =
                '<div class="info-grid">' +
                '<div class="info-field" style="text-align:center; padding:20px;">' +
                '<div style="font-size:48px; margin-bottom:10px;">🌐</div>' +
                '<div style="color:#22c55e; font-size:14px;">' + (i18n.internetDesc || 'Traffic exits to the Internet from connected nodes') + '</div>' +
                '</div>' +
                '</div>';
            openInfoModal('Internet', html);
            return;
        }

        const sc = d.status || 'offline';
        const roleLabel = d.roleLabel
            ? '<span class="info-role-badge role-' + d.cascadeRole + '">' + d.roleLabel + '</span>'
            : '';

        const html =
            '<div class="info-grid">' +
            field(i18n.drawerStatus || 'Status',
                '<div class="info-status ' + sc + '">\u25CF ' + (d.status || 'unknown') + roleLabel + '</div>') +
            field('ti-network',    i18n.drawerIP     || 'IP',           d.ip     || '—') +
            field('ti-cpu',        i18n.drawerType   || 'Type',         d.type   || '—') +
            field('ti-topology-star-3', i18n.drawerRole || 'Role',      d.cascadeRole || 'standalone') +
            field('ti-users',      i18n.drawerOnline || 'Online Users', d.onlineUsers || 0) +
            field('ti-plug',       i18n.drawerPort   || 'Port',         d.port   || '—') +
            '</div>' +
            '<div class="info-actions">' +
            '<a href="/panel/nodes/' + d.id + '" class="btn btn-sm btn-outline">' +
            '<i class="ti ti-external-link"></i> ' + (i18n.openNode || 'Open Node') + '</a>' +
            '</div>';

        openInfoModal((d.flag ? d.flag + ' ' : '') + (d.label || d.ip || ''), html);
    }

    function onEdgeTap(evt) {
        const d = evt.target.data();
        const sc = d.status || 'pending';
        const lid = d.linkId;

        // Internet edge - show simple info without actions
        if (d.isInternetEdge) {
            const html =
                '<div class="info-grid">' +
                '<div class="info-field" style="text-align:center; padding:20px;">' +
                '<div style="font-size:32px; margin-bottom:10px;">🌐</div>' +
                '<div style="color:#22c55e; font-size:14px;">' + (i18n.internetExitDesc || 'Internet exit point') + '</div>' +
                '</div>' +
                '</div>';
            openInfoModal(i18n.internetExit || 'Internet Exit', html);
            return;
        }

        const html =
            '<div class="info-grid">' +
            field(i18n.drawerStatus || 'Status',
                '<div class="info-status ' + sc + '">\u25CF ' + (d.status || 'pending') + '</div>') +
            field('ti-plug',           i18n.drawerTunnelPort        || 'Tunnel Port',         d.tunnelPort || '—') +
            field('ti-arrows-exchange',i18n.drawerProtocolTransport || 'Protocol / Transport',
                (d.tunnelProtocol || 'vless').toUpperCase() + ' / ' + (d.tunnelTransport || 'tcp')) +
            field('ti-clock',          i18n.drawerLatency           || 'Latency',
                d.latencyMs != null ? d.latencyMs + ' ms' : '—') +
            '</div>' +
            '<div class="info-actions">' +
            '<button class="btn btn-sm btn-success" id="btnDeploy" onclick="window._cascadeDeploy(\'' + lid + '\')">' +
            '<i class="ti ti-upload"></i> ' + (i18n.deploy || 'Deploy') + '</button>' +
            '<button class="btn btn-sm btn-primary" id="btnDeployChain" onclick="window._cascadeDeployChain(\'' + lid + '\')">' +
            '<i class="ti ti-link"></i> ' + (i18n.syncChain || 'Sync Chain') + '</button>' +
            '<button class="btn btn-sm btn-danger" id="btnDelete" onclick="window._cascadeDelete(\'' + lid + '\')">' +
            '<i class="ti ti-trash"></i> ' + (i18n.delete || 'Delete') + '</button>' +
            '</div>';

        openInfoModal(d.label || 'Cascade Link', html);
    }

    /** Helper: render a drawer field row */
    function field(iconOrLabel, labelOrValue, value) {
        if (value === undefined) {
            // called as field(label, htmlValue) — first arg is plain text label
            return '<div class="info-field"><div class="info-label">' + iconOrLabel + '</div>' +
                   '<div>' + labelOrValue + '</div></div>';
        }
        return '<div class="info-field">' +
               '<div class="info-label"><i class="ti ' + iconOrLabel + '"></i> ' + labelOrValue + '</div>' +
               '<div class="info-value">' + value + '</div>' +
               '</div>';
    }

    // ==================== NODE DRAG / POSITIONS ====================

    let positionSaveTimer = null;
    function onNodeDragEnd() {
        clearTimeout(positionSaveTimer);
        positionSaveTimer = setTimeout(saveAllPositions, 600);
    }

    async function saveAllPositions() {
        const positions = cy.nodes().map(function (n) {
            const p = n.position();
            return { id: n.data('id'), x: Math.round(p.x), y: Math.round(p.y) };
        });
        try {
            await fetch('/api/cascade/topology/positions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ positions }),
            });
        } catch (_) {}
    }

    // ==================== ADD LINK MODAL ====================

    async function openAddLinkModal() {
        const modal       = document.getElementById('addLinkModal');
        const portalSelect = document.getElementById('selectPortal');
        const bridgeSelect = document.getElementById('selectBridge');

        try {
            const res   = await fetch('/api/nodes');
            if (!res.ok) throw new Error();
            const nodes = await res.json();
            const opts  = nodes.map(n =>
                '<option value="' + n._id + '">' + (n.flag || '') + ' ' + n.name + ' (' + n.ip + ')</option>'
            ).join('');

            portalSelect.innerHTML = '<option value="">' + (i18n.selectPortal || '— Select Portal —') + '</option>' + opts;
            bridgeSelect.innerHTML = '<option value="">' + (i18n.selectBridge || '— Select Bridge —') + '</option>' + opts;
        } catch (_) {
            const err = '<option value="">' + (i18n.errorLoadingNodes || 'Error loading nodes') + '</option>';
            portalSelect.innerHTML = bridgeSelect.innerHTML = err;
        }
        modal.classList.add('active');
    }

    function closeModal() {
        document.getElementById('addLinkModal').classList.remove('active');
        document.getElementById('addLinkForm').reset();
    }

    async function onAddLinkSubmit(e) {
        e.preventDefault();
        const form = e.target;
        const btn  = form.querySelector('[type="submit"]');
        const data = {
            name:           form.name.value,
            portalNodeId:   form.portalNodeId.value,
            bridgeNodeId:   form.bridgeNodeId.value,
            tunnelPort:     parseInt(form.tunnelPort.value) || 10086,
            tunnelProtocol: form.tunnelProtocol.value,
            tunnelTransport:form.tunnelTransport.value,
            tunnelSecurity: form.tunnelSecurity.value,
            autoDeploy:     form.autoDeploy?.checked || false,
        };

        if (!data.name || !data.portalNodeId || !data.bridgeNodeId) {
            alert(i18n.fillRequired || 'Please fill in all required fields');
            return;
        }

        btn.disabled = true;
        btn.innerHTML = '<i class="ti ti-loader-2 spin"></i>';

        try {
            const res = await fetch('/api/cascade/links', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data),
            });
            if (!res.ok) {
                const err = await res.json();
                showToast((i18n.networkError || 'Error') + ': ' + (err.error || ''), 'error');
                return;
            }
            closeModal();
            loadTopology();
        } catch (err) {
            showToast((i18n.networkError || 'Error') + ': ' + err.message, 'error');
        } finally {
            btn.disabled = false;
            btn.innerHTML = '<i class="ti ti-plus"></i> ' + (i18n.createLink || 'Create');
        }
    }

    // ==================== CASCADE ACTIONS ====================

    function setActionLoading(msg) {
        ['btnDeploy','btnDeployChain','btnDelete'].forEach(function (id) {
            const b = document.getElementById(id);
            if (b) b.disabled = true;
        });
        const body = document.getElementById('nodeInfoBody');
        if (body && !body.querySelector('.info-loading')) {
            const el = document.createElement('div');
            el.className = 'info-loading';
            el.innerHTML = '<i class="ti ti-loader-2 spin"></i> ' + msg;
            body.appendChild(el);
        }
    }

    function resetActionLoading() {
        ['btnDeploy','btnDeployChain','btnDelete'].forEach(function (id) {
            const b = document.getElementById(id);
            if (b) b.disabled = false;
        });
        const el = document.querySelector('.info-loading');
        if (el) el.remove();
    }

    window._cascadeDeploy = async function (linkId) {
        if (!confirm(i18n.confirmDeploy || 'Deploy this cascade link?')) return;
        setActionLoading(i18n.deploying || 'Deploying...');

        const edge = cy.edges().filter(e => e.data('linkId') === linkId);
        const prev = edge.length ? edge.data('status') : null;
        if (edge.length) edge.data('status', 'syncing');

        try {
            const res  = await fetch('/api/cascade/links/' + linkId + '/deploy', { method: 'POST' });
            const data = await res.json();
            if (data.success) {
                showToast(i18n.deploySuccess || 'Deployed');
                loadTopology();
                closeInfoModal();
            } else {
                if (edge.length && prev) edge.data('status', prev);
                showToast((i18n.deployFailed || 'Failed') + ': ' + (data.error || ''), 'error');
            }
        } catch (err) {
            if (edge.length && prev) edge.data('status', prev);
            showToast((i18n.networkError || 'Error') + ': ' + err.message, 'error');
        } finally { resetActionLoading(); }
    };

    window._cascadeDeployChain = async function (linkId) {
        if (!confirm(i18n.confirmDeployChain || 'Deploy entire chain? This will sync all connected nodes in the correct order.')) return;
        setActionLoading(i18n.syncingChain || 'Syncing chain...');

        cy.edges().forEach(function (e) { e.data('status', 'syncing'); });

        try {
            const res  = await fetch('/api/cascade/chain/deploy', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ linkId: linkId }),
            });
            const data = await res.json();
            if (data.success) {
                showToast((i18n.chainDeploySuccess || 'Chain synced') + ': ' + data.deployed + ' ' + (i18n.nodes || 'nodes'));
                loadTopology();
                closeInfoModal();
            } else {
                showToast((i18n.chainDeployFailed || 'Chain sync failed') + ': ' + (data.errors || []).join(', '), 'error');
                loadTopology();
            }
        } catch (err) {
            showToast((i18n.networkError || 'Error') + ': ' + err.message, 'error');
            loadTopology();
        } finally { resetActionLoading(); }
    };

    window._cascadeUndeploy = async function (linkId) {
        if (!confirm(i18n.confirmUndeploy || 'Undeploy this cascade link?')) return;
        setActionLoading(i18n.undeploying || 'Undeploying...');

        const edge = cy.edges().filter(e => e.data('linkId') === linkId);
        if (edge.length) edge.data('status', 'syncing');

        try {
            await fetch('/api/cascade/links/' + linkId + '/undeploy', { method: 'POST' });
            showToast(i18n.undeploySuccess || 'Undeployed');
            loadTopology();
            closeInfoModal();
        } catch (err) {
            showToast((i18n.networkError || 'Error') + ': ' + err.message, 'error');
        } finally { resetActionLoading(); }
    };

    window._cascadeDelete = async function (linkId) {
        if (!confirm(i18n.confirmDeleteLink || 'Delete this cascade link?')) return;
        setActionLoading(i18n.deleting || 'Deleting...');

        try {
            await fetch('/api/cascade/links/' + linkId, { method: 'DELETE' });
            showToast(i18n.deleteSuccess || 'Deleted');
            loadTopology();
            closeInfoModal();
        } catch (err) {
            showToast((i18n.networkError || 'Error') + ': ' + err.message, 'error');
        } finally { resetActionLoading(); }
    };

    // ==================== HELPERS ====================

    function showLoading(show) {
        let el = document.querySelector('.network-loading');
        if (show && !el) {
            el = document.createElement('div');
            el.className = 'network-loading';
            el.innerHTML = '<div class="spinner"></div> ' + (i18n.loadingTopology || 'Loading...');
            const c = document.querySelector('.network-container');
            if (c) c.appendChild(el);
        } else if (!show && el) {
            el.remove();
        }
    }

    function setEmptyState(show) {
        const el  = document.getElementById('networkEmpty');
        const leg = document.getElementById('networkLegend');
        if (el)  el.style.display  = show ? 'flex' : 'none';
        if (leg) leg.style.display = show ? 'none' : '';
    }

    function showToast(message, type) {
        if (typeof window.showToast === 'function') {
            window.showToast(message, type || 'success');
            return;
        }
        let toast = document.getElementById('toast');
        if (!toast) {
            toast = document.createElement('div');
            toast.id = 'toast';
            toast.className = 'toast';
            document.body.appendChild(toast);
        }
        toast.textContent = message;
        toast.className = 'toast show ' + (type || 'success');
        setTimeout(function () { toast.className = 'toast'; }, 3500);
    }

    // ==================== START ====================

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
