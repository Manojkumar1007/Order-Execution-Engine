const API_BASE = window.location.origin;

// Utilities
const el = (id) => document.getElementById(id);
const log = (msg, type = 'info') => {
    const container = el('logs-container');
    const div = document.createElement('div');
    const time = new Date().toLocaleTimeString();
    div.className = `log-entry ${type}`;
    div.innerHTML = `<span class="timestamp">[${time}]</span> ${msg}`;
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
};

// State
let activeWebsockets = {};

// Initialization
document.addEventListener('DOMContentLoaded', () => {
    checkHealth();
    fetchMetrics();
    fetchRecentOrders();

    // Poll metrics every 2 seconds
    setInterval(fetchMetrics, 2000);
});

// Actions
async function checkHealth() {
    try {
        const res = await fetch(`${API_BASE}/health`);
        const data = await res.json();
        el('health-output').textContent = JSON.stringify(data, null, 2);
        el('server-status').textContent = 'System Online';
        el('server-status').style.color = '#34d399';
    } catch (err) {
        el('server-status').textContent = 'System Offline';
        el('server-status').style.color = '#ef4444';
        log('Health check failed', 'error');
    }
}

async function fetchMetrics() {
    try {
        const res = await fetch(`${API_BASE}/api/metrics`);
        const data = await res.json();
        const metrics = data.queue;

        let html = '';
        for (const [key, value] of Object.entries(metrics)) {
            html += `
                <div class="metric-item">
                    <span class="label">${key.replace(/([A-Z])/g, ' $1').trim()}</span>
                    <span class="value">${value}</span>
                </div>
            `;
        }
        el('metrics-container').innerHTML = html;
    } catch (err) {
        // Silent error for polling
    }
}

async function fetchRecentOrders() {
    try {
        const res = await fetch(`${API_BASE}/api/orders?limit=10`);
        const data = await res.json();

        const tbody = el('orders-table-body');
        tbody.innerHTML = data.orders.map(o => `
            <tr>
                <td style="font-family: monospace">${o.orderId.slice(0, 8)}...</td>
                <td>${o.tokenIn} → ${o.tokenOut}</td>
                <td>${o.amount}</td>
                <td><span class="badge ${o.status}">${o.status}</span></td>
                <td>${o.selectedDex || '-'}</td>
                <td>${new Date(o.createdAt).toLocaleTimeString()}</td>
            </tr>
        `).join('');
    } catch (err) {
        log('Failed to fetch orders', 'error');
    }
}

// Order Submission
el('order-form').addEventListener('submit', async (e) => {
    e.preventDefault();

    const payload = {
        tokenIn: el('tokenIn').value,
        tokenOut: el('tokenOut').value,
        amount: parseFloat(el('amount').value),
        slippage: parseFloat(el('slippage').value) / 100 // Convert percentage
    };

    log(`Submitting order: ${payload.amount} ${payload.tokenIn} -> ${payload.tokenOut}...`, 'info');

    try {
        const res = await fetch(`${API_BASE}/api/orders/execute`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const data = await res.json();

        if (res.ok) {
            log(`Order Created! ID: ${data.orderId}`, 'success');
            connectWebSocket(data.orderId);
            fetchRecentOrders(); // Refresh table
        } else {
            log(`Error: ${data.message}`, 'error');
        }
    } catch (err) {
        log(`Submission failed: ${err.message}`, 'error');
    }
});

// Batch Execution
el('btn-batch').addEventListener('click', async () => {
    const payload = {
        tokenIn: el('tokenIn').value,
        tokenOut: el('tokenOut').value,
        amount: parseFloat(el('amount').value),
        slippage: parseFloat(el('slippage').value) / 100
    };

    log(`🚀 Starting batch execution of 5 orders...`, 'system');

    const promises = [];
    for (let i = 0; i < 5; i++) {
        promises.push(submitOrder(payload, i + 1));
    }

    await Promise.all(promises);
    log(`✅ Batch execution completed!`, 'success');
});

async function submitOrder(payload, index) {
    try {
        log(`[${index}/5] Submitting...`, 'info');
        const res = await fetch(`${API_BASE}/api/orders/execute`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const data = await res.json();

        if (res.ok) {
            log(`[${index}/5] Created! ID: ${data.orderId}`, 'success');
            connectWebSocket(data.orderId);
            fetchRecentOrders();
        } else {
            log(`[${index}/5] Error: ${data.message}`, 'error');
        }
    } catch (err) {
        log(`[${index}/5] Failed: ${err.message}`, 'error');
    }
}

// Manual Tracking
el('btn-track').addEventListener('click', () => {
    const orderId = el('track-order-id').value.trim();
    if (!orderId) return;

    log(`Connecting to manual order: ${orderId}`, 'system');
    connectWebSocket(orderId, true);
});

// WebSocket Connection
function connectWebSocket(orderId, verbose = false) {
    if (activeWebsockets[orderId]) return;

    // Determine correct protocol (ws: or wss:)
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/api/orders/${orderId}/ws`;

    log(`Connecting to WS for order ${orderId}...`, 'system');

    // Setup JSON viewer if verbose
    const container = el('json-output-container');
    const viewer = el('json-viewer');
    if (verbose) {
        container.style.display = 'block';
        viewer.textContent = `Connecting to ${wsUrl}...\nWaiting for updates...`;
        viewer.style.color = '#cbd5e1';
    }

    const ws = new WebSocket(wsUrl);
    activeWebsockets[orderId] = ws;

    ws.onopen = () => {
        log(`WS Connected for ${orderId}`, 'success');
        el('ws-status').textContent = 'WS Connected';
        el('ws-status').style.color = '#34d399';

        if (verbose) {
            viewer.textContent += '\nCreate Order Update: Connected!';
        }
    };

    ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        log(`Create Order Update [${orderId}]: ${data.status}`, 'info');

        if (verbose) {
            // Pretty print the latest JSON
            viewer.textContent = JSON.stringify(data, null, 2);
        }

        if (data.data && data.data.txHash) {
            log(`Transaction Hash: ${data.data.txHash}`, 'success');
        }

        // Log Routing Details
        if (data.data && data.data.routingInfo) {
            const info = data.data.routingInfo;
            const msg = `[DEX Routing] Raydium: ${info.raydium.output.toFixed(4)} | Meteora: ${info.meteora.output.toFixed(4)} -> Selected ${data.data.selectedDex.toUpperCase()}`;

            log(msg, 'info');
            console.log(`%c${msg}`, 'color: #3b82f6; font-weight: bold;');
            console.table(info);
        }

        // Refresh orders table to show new status
        fetchRecentOrders();

        if (['confirmed', 'failed'].includes(data.status)) {
            ws.close();
        }
    };

    ws.onclose = () => {
        log(`WS Closed for ${orderId}`, 'system');
        delete activeWebsockets[orderId];

        if (Object.keys(activeWebsockets).length === 0) {
            el('ws-status').textContent = 'WS Idle';
            el('ws-status').style.color = '#94a3b8';
        }

        if (verbose) {
            viewer.textContent += '\n\n[Connection Closed]';
        }
    };

    ws.onerror = (err) => {
        log(`WS Error for ${orderId}`, 'error');
        if (verbose) {
            viewer.textContent += '\n\n[Error] Connection Failed. Check server logs/port.';
            viewer.style.color = '#ef4444';
        }
    };
}

function clearLogs() {
    el('logs-container').innerHTML = '';
}
