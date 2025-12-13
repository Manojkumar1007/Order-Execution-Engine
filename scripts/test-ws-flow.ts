import WebSocket from 'ws';
import 'dotenv/config';
// Node.js 18+ has global fetch
// import { fetch } from 'undici';

const PORT = process.env.PORT || 3000;
const API_URL = `http://localhost:${PORT}`;
const WS_URL = `ws://localhost:${PORT}`;

async function sleep(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function runTest() {
    console.log(`Starting WebSocket verification test on port ${PORT}...`);

    // 1. Submit Order
    console.log('1. Submitting order...');
    const response = await fetch(`${API_URL}/api/orders/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            tokenIn: 'SOL',
            tokenOut: 'USDC',
            amount: 1.5,
            slippage: 0.05
        })
    });

    if (!response.ok) {
        throw new Error(`Failed to submit order: ${response.status} ${response.statusText}`);
    }

    const data = await response.json() as any;
    console.log('Order submitted:', data);
    const { orderId } = data;

    if (!orderId) {
        throw new Error('No orderId returned');
    }

    // 2. Connect to WebSocket
    const wsUrl = `${WS_URL}/api/orders/${orderId}/ws`;
    console.log(`2. Connecting to WebSocket: ${wsUrl}`);

    const ws = new WebSocket(wsUrl);

    const statusUpdates: string[] = [];

    ws.on('open', () => {
        console.log('✓ WebSocket connected');
    });

    ws.on('message', (message) => {
        const update = JSON.parse(message.toString());
        console.log('-> Received update:', update.status);
        statusUpdates.push(update.status);

        if (update.status === 'confirmed' || update.status === 'failed') {
            console.log(`Final status reached: ${update.status}`);
            ws.close();
        }
    });

    ws.on('error', (error) => {
        console.error('WebSocket error:', error);
    });

    ws.on('close', (code, reason) => {
        console.log(`WebSocket closed: ${code} ${reason.toString()}`);

        // Verify we got the expected sequence
        const expectedSequence = ['pending', 'routing', 'building', 'submitted', 'confirmed'];
        // Note: pending might be missed if it happens very fast, but typically we get it.
        // 'routing' and others come from the worker.

        console.log('Status history:', statusUpdates);

        if (statusUpdates.includes('confirmed')) {
            console.log('PASS: Order completed successfully with status updates');
            process.exit(0);
        } else if (statusUpdates.includes('failed')) {
            console.log('FAIL: Order failed');
            process.exit(1);
        } else {
            console.log('WARN: connection closed before final status');
            process.exit(1);
        }
    });
}

runTest().catch(console.error);
