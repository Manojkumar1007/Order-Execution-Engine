import WebSocket from 'ws';
import 'dotenv/config';

const PORT = process.env.PORT || 3000;
const API_URL = `http://localhost:${PORT}`;
const WS_URL = `ws://localhost:${PORT}`;
const CONCURRENT_ORDERS = 5;

async function submitOrder(index: number) {
    const orderData = {
        tokenIn: 'SOL',
        tokenOut: 'USDC',
        amount: 1.0 + (index * 0.1), // Vary amount slightly
        slippage: 0.05
    };

    console.log(`[Order ${index}] Submitting...`);

    try {
        const response = await fetch(`${API_URL}/api/orders/execute`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(orderData)
        });

        if (!response.ok) {
            throw new Error(`Failed to submit: ${response.status} ${response.statusText}`);
        }

        const data = await response.json() as any;
        const { orderId } = data;
        console.log(`[Order ${index}] Submitted. ID: ${orderId}`);

        return monitorOrder(index, orderId);
    } catch (error) {
        console.error(`[Order ${index}] Submission failed:`, error);
        throw error;
    }
}

async function monitorOrder(index: number, orderId: string): Promise<string> {
    return new Promise((resolve, reject) => {
        const wsUrl = `${WS_URL}/api/orders/${orderId}/ws`;
        const ws = new WebSocket(wsUrl);
        const updates: string[] = [];

        ws.on('open', () => {
            console.log(`[Order ${index}] WS Connected`);
        });

        ws.on('message', (message) => {
            try {
                const update = JSON.parse(message.toString());
                const status = update.status;
                updates.push(status);
                // console.log(`[Order ${index}] Update: ${status}`);

                if (status === 'confirmed') {
                    console.log(`[Order ${index}] ✓ Confirmed`);
                    ws.close();
                    resolve('confirmed');
                } else if (status === 'failed') {
                    console.log(`[Order ${index}] ✗ Failed: ${update.data?.error || 'Unknown error'}`);
                    ws.close();
                    reject(new Error(`Order ${index} failed`));
                }
            } catch (err) {
                console.error(`[Order ${index}] Error parsing message:`, err);
            }
        });

        ws.on('error', (err) => {
            console.error(`[Order ${index}] WS Error:`, err);
            reject(err);
        });

        ws.on('close', () => {
            // If closed without terminal state, check if we somehow missed it or it was just a disconnect
            // For this test, we expect explicit close on terminal state
            if (!updates.includes('confirmed') && !updates.includes('failed')) {
                // Wait a bit, maybe it's just a flake
                console.warn(`[Order ${index}] WS Closed without terminal state. History: ${updates.join(' -> ')}`);
            }
        });

        // Safety timeout
        setTimeout(() => {
            if (!updates.includes('confirmed') && !updates.includes('failed')) {
                console.error(`[Order ${index}] Timeout waiting for completion`);
                ws.terminate();
                reject(new Error(`Order ${index} timed out`));
            }
        }, 30000); // 30s timeout
    });
}

async function runTest() {
    console.log(`Starting Concurrent Order Test (${CONCURRENT_ORDERS} orders)...`);

    // Create an array of indices [0, 1, 2, ...]
    const indices = Array.from({ length: CONCURRENT_ORDERS }, (_, i) => i);

    const startTime = Date.now();

    try {
        // Run all submissions concurrently
        await Promise.all(indices.map(i => submitOrder(i)));

        const duration = ((Date.now() - startTime) / 1000).toFixed(2);
        console.log(`\n✓ All ${CONCURRENT_ORDERS} orders processed successfully in ${duration}s`);
        process.exit(0);
    } catch (error) {
        console.error('\n✗ Test Failed:', error);
        process.exit(1);
    }
}

runTest();
