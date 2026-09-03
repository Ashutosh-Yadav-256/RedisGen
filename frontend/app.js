(function () {
    'use strict';

    var ws = null;
    var baseUrl = '';
    var cmdHistory = [];
    var historyIdx = -1;
    var msgId = 0;
    var pendingCallbacks = {};
    var statsInterval = null;
    var memoryHistory = [];
    var MAX_MEM_POINTS = 60;

    var els = {
        overlay: document.getElementById('login-overlay'),
        app: document.getElementById('app'),
        wsUrl: document.getElementById('ws-url'),
        btnConnect: document.getElementById('btn-connect'),
        loginError: document.getElementById('login-error'),
        status: document.getElementById('connection-status'),
        dbSelect: document.getElementById('db-select'),
        btnDisconnect: document.getElementById('btn-disconnect'),
        terminalOutput: document.getElementById('terminal-output'),
        terminalInput: document.getElementById('terminal-input'),
        btnClear: document.getElementById('btn-clear-terminal'),
        keyFilter: document.getElementById('key-filter'),
        btnRefreshKeys: document.getElementById('btn-refresh-keys'),
        keyList: document.getElementById('key-list'),
        keyDetail: document.getElementById('key-detail'),
        detailKeyName: document.getElementById('detail-key-name'),
        detailKeyType: document.getElementById('detail-key-type'),
        detailContent: document.getElementById('detail-content'),
        btnCloseDetail: document.getElementById('btn-close-detail'),
        statMemory: document.getElementById('stat-memory'),
        statClients: document.getElementById('stat-clients'),
        statKeys: document.getElementById('stat-keys'),
        statNode: document.getElementById('stat-node'),
        statsUptime: document.getElementById('stats-uptime'),
        memoryChart: document.getElementById('memory-chart'),
        btnHelp: document.getElementById('btn-help'),
        onboardingOverlay: document.getElementById('onboarding-overlay'),
        onboardingModal: document.getElementById('onboarding-modal'),
        btnCloseOnboarding: document.getElementById('btn-close-onboarding'),
        onboardingDotsContainer: document.getElementById('onboarding-dots'),
        btnOnboardingPrev: document.getElementById('btn-onboarding-prev'),
        btnOnboardingNext: document.getElementById('btn-onboarding-next'),
        onboardingTitle: document.getElementById('onboarding-title'),
        onboardingText: document.getElementById('onboarding-text')
    };

    var currentOnboardingStep = 0;

    els.btnConnect.addEventListener('click', doConnect);
    els.wsUrl.addEventListener('keydown', function (e) { if (e.key === 'Enter') doConnect(); });
    els.btnDisconnect.addEventListener('click', doDisconnect);
    
    els.wsUrl.value = 'wss://redisgen.onrender.com';
    setTimeout(doConnect, 100);
    els.terminalInput.addEventListener('keydown', onTerminalKey);
    els.btnClear.addEventListener('click', function () { els.terminalOutput.innerHTML = ''; });
    els.btnRefreshKeys.addEventListener('click', refreshKeys);
    els.btnCloseDetail.addEventListener('click', function () { els.keyDetail.classList.add('hidden'); });
    els.dbSelect.addEventListener('change', onDbChange);
    


    // Navigation links smooth scroll
    var navLinks = {
        'nav-dashboard': 'app',
        'nav-browser': 'tour-browser',
        'nav-cli': 'tour-terminal',
        'nav-settings': 'tour-stats'
    };
    for (var id in navLinks) {
        var el = document.getElementById(id);
        if (el) {
            el.addEventListener('click', (function(targetId) {
                return function(e) {
                    e.preventDefault();
                    var target = document.getElementById(targetId);
                    if (target) {
                        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
                    }
                };
            })(navLinks[id]));
        }
    }

    function doConnect() {
        els.loginError.textContent = '';
        var rawUrl = els.wsUrl.value.trim();

        if (!rawUrl) {
            els.loginError.textContent = 'Please enter the server URL.';
            return;
        }

        if (rawUrl.indexOf('://') < 0) {
            rawUrl = 'wss://' + rawUrl;
        }

        baseUrl = rawUrl.replace(/^ws/, 'http');
        var wsTarget = rawUrl.replace(/^http/, 'ws');
        if (wsTarget.endsWith('/')) wsTarget = wsTarget.slice(0, -1);

        els.btnConnect.textContent = 'Connecting...';
        els.btnConnect.disabled = true;

        try {
            ws = new WebSocket(wsTarget);
        } catch (e) {
            els.loginError.textContent = 'Invalid URL format.';
            els.btnConnect.textContent = 'Connect';
            els.btnConnect.disabled = false;
            return;
        }

        ws.onopen = function () {
            enterDashboard();
        };

        ws.onmessage = function (e) {
            var msg;
            try { msg = JSON.parse(e.data); } catch (err) { return; }
            if (msg.id && pendingCallbacks[msg.id]) {
                pendingCallbacks[msg.id](msg.result);
                delete pendingCallbacks[msg.id];
            }
        };

        ws.onclose = function () {
            setDisconnected();
        };

        ws.onerror = function () {
            els.loginError.textContent = 'Connection failed. Check the URL.';
            els.btnConnect.textContent = 'Connect';
            els.btnConnect.disabled = false;
        };
    }

    function enterDashboard() {
        els.overlay.classList.add('hidden');
        els.app.classList.remove('hidden');
        els.btnConnect.textContent = 'Connect';
        els.btnConnect.disabled = false;
        setConnected();
        addTermLine('Connected to ' + els.wsUrl.value.trim(), 'info-line');
        refreshKeys();
        statsInterval = setInterval(pollStats, 2000);
        pollStats();
    }

    function doDisconnect() {
        if (ws) ws.close();
        setDisconnected();
    }

    function setConnected() {
        els.status.textContent = 'Connected';
        els.status.className = 'px-3 py-1 rounded cursor-default neo-inset text-accent-green font-bold text-sm';
    }

    function setDisconnected() {
        els.status.textContent = 'Disconnected';
        els.status.className = 'px-3 py-1 rounded cursor-default neo-inset text-accent-red font-bold text-sm';
        if (statsInterval) { clearInterval(statsInterval); statsInterval = null; }
        els.overlay.classList.remove('hidden');
        els.app.classList.add('hidden');
        els.btnConnect.textContent = 'Connect';
        els.btnConnect.disabled = false;
        ws = null;
    }

    function sendCommand(parts, callback) {
        if (!ws || ws.readyState !== WebSocket.OPEN) return;

        var id = ++msgId;
        if (callback) pendingCallbacks[id] = callback;
        ws.send(JSON.stringify({ id: id, command: parts }));
    }

    function onTerminalKey(e) {
        if (e.key === 'Enter') {
            var raw = els.terminalInput.value.trim();
            if (!raw) return;

            cmdHistory.unshift(raw);
            if (cmdHistory.length > 200) cmdHistory.pop();
            historyIdx = -1;

            els.terminalInput.value = '';
            addTermLine('redis> ' + raw, 'cmd-line');

            var parts = parseCommandString(raw);

            sendCommand(parts, function (res) {
                renderResponse(res);
            });
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            if (historyIdx < cmdHistory.length - 1) {
                historyIdx++;
                els.terminalInput.value = cmdHistory[historyIdx];
            }
        } else if (e.key === 'ArrowDown') {
            e.preventDefault();
            if (historyIdx > 0) {
                historyIdx--;
                els.terminalInput.value = cmdHistory[historyIdx];
            } else {
                historyIdx = -1;
                els.terminalInput.value = '';
            }
        }
    }

    function parseCommandString(str) {
        var parts = [];
        var current = '';
        var inQuote = false;
        var quoteChar = '';

        for (var i = 0; i < str.length; i++) {
            var ch = str[i];
            if (inQuote) {
                if (ch === quoteChar) {
                    inQuote = false;
                } else {
                    current += ch;
                }
            } else if (ch === '"' || ch === "'") {
                inQuote = true;
                quoteChar = ch;
            } else if (ch === ' ') {
                if (current.length > 0) {
                    parts.push(current);
                    current = '';
                }
            } else {
                current += ch;
            }
        }

        if (current.length > 0) parts.push(current);
        return parts;
    }

    function renderResponse(res) {
        if (res === null || res === undefined) {
            addTermLine('(nil)', 'resp-line');
        } else if (res && res.error) {
            addTermLine('(error) ' + res.error, 'err-line');
        } else if (Array.isArray(res)) {
            if (res.length === 0) {
                addTermLine('(empty array)', 'resp-line');
            } else {
                for (var i = 0; i < res.length; i++) {
                    var prefix = (i + 1) + ') ';
                    if (res[i] === null) {
                        addTermLine(prefix + '(nil)', 'resp-line');
                    } else if (typeof res[i] === 'object' && res[i].error) {
                        addTermLine(prefix + '(error) ' + res[i].error, 'err-line');
                    } else {
                        addTermLine(prefix + '"' + res[i] + '"', 'resp-line');
                    }
                }
            }
        } else if (typeof res === 'number') {
            addTermLine('(integer) ' + res, 'resp-line');
        } else {
            addTermLine('"' + res + '"', 'resp-line');
        }
    }

    function addTermLine(text, cls) {
        var div = document.createElement('div');
        div.className = cls || '';
        div.textContent = text;
        els.terminalOutput.appendChild(div);
        els.terminalOutput.scrollTop = els.terminalOutput.scrollHeight;
    }

    function onDbChange() {
        var db = els.dbSelect.value;
        sendCommand(['SELECT', db], function (res) {
            addTermLine('Switched to db' + db, 'info-line');
            refreshKeys();
        });
    }

    function refreshKeys() {
        var pattern = els.keyFilter.value.trim() || '*';
        var allKeys = [];

        function scanCursor(cursor) {
            sendCommand(['SCAN', String(cursor), 'MATCH', pattern, 'COUNT', '100'], function (res) {
                if (!Array.isArray(res) || res.length < 2) {
                    renderKeyList(allKeys);
                    return;
                }

                var nextCursor = parseInt(res[0], 10);
                var keys = res[1];

                if (Array.isArray(keys)) {
                    for (var i = 0; i < keys.length; i++) {
                        allKeys.push(keys[i]);
                    }
                }

                if (nextCursor === 0 || isNaN(nextCursor)) {
                    renderKeyList(allKeys);
                } else {
                    scanCursor(nextCursor);
                }
            });
        }

        scanCursor(0);
    }

    function renderKeyList(keys) {
        els.keyList.innerHTML = '';

        if (keys.length === 0) {
            els.keyList.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-muted);font-size:0.8rem;">No keys found</div>';
            return;
        }

        keys.sort();
        var pending = keys.length;

        for (var i = 0; i < keys.length; i++) {
            (function (key) {
                sendCommand(['TYPE', key], function (typeRes) {
                    var type = typeRes || 'unknown';
                    var item = document.createElement('div');
                    item.className = 'key-item';
                    item.innerHTML =
                        '<span class="key-name">' + escapeHtml(key) + '</span>' +
                        '<span class="key-type key-type-' + type + '">' + type + '</span>';
                    item.addEventListener('click', function () { inspectKey(key, type); });
                    els.keyList.appendChild(item);
                });
            })(keys[i]);
        }
    }

    function inspectKey(key, type) {
        els.detailKeyName.textContent = key;
        els.detailKeyType.textContent = type;
        els.detailKeyType.className = 'detail-type-badge key-type-' + type;

        var cmd;
        switch (type) {
            case 'string': cmd = ['GET', key]; break;
            case 'list': cmd = ['LRANGE', key, '0', '-1']; break;
            case 'hash': cmd = ['HGETALL', key]; break;
            case 'set': cmd = ['SMEMBERS', key]; break;
            case 'zset': cmd = ['ZRANGE', key, '0', '-1', 'WITHSCORES']; break;
            default: cmd = ['TYPE', key];
        }

        sendCommand(cmd, function (res) {
            var formatted = '';

            if (type === 'string') {
                formatted = res !== null ? String(res) : '(nil)';
            } else if (type === 'hash' && Array.isArray(res)) {
                for (var i = 0; i < res.length; i += 2) {
                    formatted += res[i] + ': ' + (res[i + 1] || '') + '\n';
                }
            } else if (type === 'zset' && Array.isArray(res)) {
                for (var j = 0; j < res.length; j += 2) {
                    formatted += res[j] + ' (score: ' + (res[j + 1] || '0') + ')\n';
                }
            } else if (Array.isArray(res)) {
                for (var k = 0; k < res.length; k++) {
                    formatted += (k + 1) + ') ' + (res[k] !== null ? res[k] : '(nil)') + '\n';
                }
            } else if (res && res.error) {
                formatted = 'Error: ' + res.error;
            } else {
                formatted = String(res);
            }

            els.detailContent.textContent = formatted.trim() || '(empty)';
            els.keyDetail.classList.remove('hidden');
        });
    }

    function pollStats() {
        if (!baseUrl) return;

        var url = baseUrl.replace(/\/$/, '') + '/stats';

        fetch(url)
            .then(function (r) { return r.json(); })
            .then(function (stats) {
                els.statMemory.textContent = stats.used_memory_human || '--';
                els.statClients.textContent = String(stats.connected_clients || 0);
                els.statKeys.textContent = String(stats.total_keys || 0);
                els.statNode.textContent = stats.node_version || '--';
                els.statsUptime.textContent = formatUptime(stats.uptime_seconds || 0);

                memoryHistory.push(stats.used_memory || 0);
                if (memoryHistory.length > MAX_MEM_POINTS) memoryHistory.shift();
                drawMemoryChart();
            })
            .catch(function () {});
    }

    function formatUptime(sec) {
        var d = Math.floor(sec / 86400);
        var h = Math.floor((sec % 86400) / 3600);
        var m = Math.floor((sec % 3600) / 60);
        var s = sec % 60;
        if (d > 0) return d + 'd ' + h + 'h';
        if (h > 0) return h + 'h ' + m + 'm';
        if (m > 0) return m + 'm ' + s + 's';
        return s + 's';
    }

    function drawMemoryChart() {
        var canvas = els.memoryChart;
        var ctx = canvas.getContext('2d');
        var dpr = window.devicePixelRatio || 1;

        canvas.width = canvas.clientWidth * dpr;
        canvas.height = canvas.clientHeight * dpr;
        ctx.scale(dpr, dpr);

        var w = canvas.clientWidth;
        var h = canvas.clientHeight;
        var pad = 4;

        ctx.clearRect(0, 0, w, h);

        if (memoryHistory.length < 2) return;

        var maxMem = Math.max.apply(null, memoryHistory) * 1.2;
        if (maxMem === 0) maxMem = 1;

        var step = (w - pad * 2) / (MAX_MEM_POINTS - 1);

        var gradient = ctx.createLinearGradient(0, 0, 0, h);
        gradient.addColorStop(0, 'rgba(24, 133, 226, 0.2)');
        gradient.addColorStop(1, 'rgba(24, 133, 226, 0.0)');

        ctx.beginPath();
        ctx.moveTo(pad, h - pad);

        for (var i = 0; i < memoryHistory.length; i++) {
            var x = pad + i * step;
            var y = h - pad - ((memoryHistory[i] / maxMem) * (h - pad * 2));
            if (i === 0) ctx.lineTo(x, y);
            else ctx.lineTo(x, y);
        }

        ctx.lineTo(pad + (memoryHistory.length - 1) * step, h - pad);
        ctx.closePath();
        ctx.fillStyle = gradient;
        ctx.fill();

        ctx.beginPath();
        for (var j = 0; j < memoryHistory.length; j++) {
            var x2 = pad + j * step;
            var y2 = h - pad - ((memoryHistory[j] / maxMem) * (h - pad * 2));
            if (j === 0) ctx.moveTo(x2, y2);
            else ctx.lineTo(x2, y2);
        }
        ctx.strokeStyle = '#1885E2';
        ctx.lineWidth = 2;
        ctx.stroke();
    }

    function escapeHtml(str) {
        return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function initOnboarding() {
        if (!els.onboardingOverlay) return;

        var tourSteps = [
            { target: null, title: "Welcome to RedisGen", text: "RedisGen is your in-memory datastore playground. Let's take a quick tour of the dashboard!" },
            { target: 'tour-stats', title: "Live Metrics", text: "Monitor server memory, connected clients, total keys, and uptime in real-time." },
            { target: 'tour-chart', title: "Memory Chart", text: "Track memory usage over time. (Sample data shown while testing)." },
            { target: 'tour-terminal', title: "Interactive Terminal", text: "Run any Redis command right from your browser. Try typing 'PING' or 'SET hello world'." },
            { target: 'tour-browser', title: "Key Browser", text: "Search, view, and inspect all keys in the selected database visually." }
        ];

        els.onboardingDotsContainer.innerHTML = '';
        for (var i = 0; i < tourSteps.length; i++) {
            var dot = document.createElement('div');
            dot.className = 'w-2 h-2 rounded-full transition-colors duration-300 ' + (i === 0 ? 'bg-accent-blue' : 'bg-[#C4C9D4]');
            els.onboardingDotsContainer.appendChild(dot);
        }

        var currentHighlight = null;

        function positionModal(targetId) {
            if (!targetId) {
                // Center modal
                els.onboardingModal.style.top = '50%';
                els.onboardingModal.style.left = '50%';
                els.onboardingModal.style.transform = 'translate(-50%, -50%)';
                return;
            }

            var target = document.getElementById(targetId);
            if (!target) return;

            var rect = target.getBoundingClientRect();
            
            // Try placing it to the left or right, or bottom/top
            els.onboardingModal.style.transform = 'none';
            var baseTop = Math.max(20, rect.top + (rect.height / 2) - 100);
            els.onboardingModal.style.top = Math.min(window.innerHeight - 220, baseTop) + 'px';
            
            if (rect.left > 400) {
                // place left
                els.onboardingModal.style.left = (rect.left - 370) + 'px';
            } else if (window.innerWidth - rect.right > 400) {
                // place right
                els.onboardingModal.style.left = (rect.right + 20) + 'px';
            } else {
                // place top or bottom depending on available space
                if (rect.bottom + 180 > window.innerHeight && rect.top > 180) {
                    els.onboardingModal.style.top = (rect.top - 160) + 'px';
                } else {
                    els.onboardingModal.style.top = Math.min(window.innerHeight - 180, rect.bottom + 20) + 'px';
                }
                els.onboardingModal.style.left = '50%';
                els.onboardingModal.style.transform = 'translateX(-50%)';
            }
        }

        function showStep(stepIdx) {
            var step = tourSteps[stepIdx];
            
            els.onboardingTitle.innerHTML = '<span class="material-symbols-outlined">explore</span> ' + step.title;
            els.onboardingText.textContent = step.text;

            var dots = els.onboardingDotsContainer.children;
            for (var j = 0; j < dots.length; j++) {
                dots[j].className = 'w-2 h-2 rounded-full transition-colors duration-300 ' + (j === stepIdx ? 'bg-accent-blue' : 'bg-[#C4C9D4]');
            }

            els.btnOnboardingPrev.classList.toggle('hidden', stepIdx === 0);
            els.btnOnboardingNext.textContent = stepIdx === tourSteps.length - 1 ? "Got it!" : "Next";

            if (currentHighlight) {
                currentHighlight.classList.remove('onboarding-highlight');
            }

            if (step.target) {
                currentHighlight = document.getElementById(step.target);
                if (currentHighlight) {
                    currentHighlight.classList.add('onboarding-highlight');
                    currentHighlight.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }
            }
            
            positionModal(step.target);
        }

        function openModal() {
            currentOnboardingStep = 0;
            els.onboardingOverlay.classList.remove('hidden');
            els.onboardingModal.classList.remove('hidden');
            showStep(0);
        }

        function closeModal() {
            els.onboardingOverlay.classList.add('hidden');
            els.onboardingModal.classList.add('hidden');
            if (currentHighlight) {
                currentHighlight.classList.remove('onboarding-highlight');
                currentHighlight = null;
            }
        }

        els.btnOnboardingNext.addEventListener('click', function() {
            if (currentOnboardingStep < tourSteps.length - 1) {
                currentOnboardingStep++;
                showStep(currentOnboardingStep);
            } else {
                closeModal();
            }
        });

        els.btnOnboardingPrev.addEventListener('click', function() {
            if (currentOnboardingStep > 0) {
                currentOnboardingStep--;
                showStep(currentOnboardingStep);
            }
        });

        els.btnCloseOnboarding.addEventListener('click', closeModal);
        if (els.btnHelp) {
            els.btnHelp.addEventListener('click', openModal);
        }

        if (!localStorage.getItem('redisgen_onboarding_seen')) {
            localStorage.setItem('redisgen_onboarding_seen', 'true');
            setTimeout(openModal, 500);
        }
    }

    initOnboarding();
})();
