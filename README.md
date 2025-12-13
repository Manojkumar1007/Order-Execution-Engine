# Eterna Assignment - Market Order Execution Engine

A sophisticated market order execution engine with DEX routing between Raydium and Meteora for the Solana blockchain. This system intelligently routes trades through multiple decentralized exchanges to find the best prices and execute swaps efficiently.

> **🚀 Live Demo**: [https://order-execution-engine-h1zi.onrender.com](https://order-execution-engine-h1zi.onrender.com)

## Table of Contents
- [Overview](#overview)
- [Features](#features)
- [Architecture](#architecture)
- [Technology Stack](#technology-stack)
- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Configuration](#configuration)
- [Running the Application](#running-the-application)
- [API Endpoints](#api-endpoints)
- [WebSocket Integration](#websocket-integration)
- [Queue Processing](#queue-processing)
- [Environment Variables](#environment-variables)
- [Database Schema](#database-schema)

## Overview

This project implements a robust market order execution engine that:
- Accepts market orders for token swaps
- Compares quotes between Raydium and Meteora DEXs
- Selects the best route based on optimal pricing
- Executes swaps through the selected DEX
- Provides real-time status updates via WebSocket
- Implements retry mechanisms for failed transactions
- Includes comprehensive monitoring and metrics

## Features

- **Multi-Dex Routing**: Automatically compares quotes between Raydium and Meteora to find optimal pricing
- **Real-time Updates**: WebSocket support for live order status monitoring
- **Queue-Based Processing**: Background job processing using BullMQ for reliable order execution
- **Auto-Retry Mechanism**: Failed orders are automatically retried with exponential backoff
- **Database Persistence**: PostgreSQL storage for order history and state
- **Caching Layer**: Redis caching for faster order lookup
- **Comprehensive Monitoring**: Metrics endpoint for queue and system health
- **Graceful Shutdown**: Proper cleanup of resources during shutdown

## Design Choices & Concepts

### Why Market Order?
We implemented **Market Orders** (as opposed to Limit Orders) for this execution engine to prioritize **speed and liquidity**. 
- **Immediate Execution**: Market orders are executed instantly at the best available price, ensuring the user enters/exits the position without waiting.
- **Slippage Protection**: While market orders accept the current price, we enforce a strict `slippage` tolerance. If the price moves unfavorably beyond this limit during processing, the transaction is rejected to protect the user's value.
- **Smart Routing**: Since the price is not fixed, the engine's value comes from finding the *best* market price across multiple DEXs (Raydium vs Meteora) in real-time.

### Key Architectural Decisions
1.  **Fastify vs Express**: Chosen for its low overhead and high performance, which is critical for a high-throughput trading engine.
2.  **BullMQ (Redis Queues)**: Decoupling the HTTP request from the actual order execution is vital. It allows the API to remain responsive under high load while orders are processed reliably in the background wih automatic retries.
3.  **PostgreSQL (Relational DB)**: Financial data requires strict consistency (ACID compliance) which SQL databases provide better than NoSQL alternatives for this use case.
4.  **WebSockets**: Polling for order status is inefficient. WebSockets provide a direct, full-duplex channel to push updates (Routing -> Building -> Confirmed) instantly to the client.

## Architecture

```
┌─────────────┐    ┌──────────────┐    ┌─────────────┐
│   Client    │───▶│   Fastify    │───▶│   Queue     │
│             │    │   Server     │    │  (BullMQ)   │
└─────────────┘    └──────────────┘    └─────────────┘
                        │                       │
        ┌───────────────▼───────────────┐       │
        │      WebSocket Manager        │       │
        └───────────────┬───────────────┘       │
                        │                       │
        ┌───────────────▼───────────────┐       │
        │      DEX Router (Mock)        │◀──────┘
        └───────────────────────────────┘
                        │
        ┌───────────────▼───────────────┐
        │   PostgreSQL & Redis Cache    │
        └───────────────────────────────┘
```

## Technology Stack

- **Runtime**: Node.js with TypeScript
- **Web Framework**: Fastify for high-performance APIs
- **Database**: PostgreSQL for persistent storage
- **Cache**: Redis for fast order lookup
- **Queue System**: BullMQ for background job processing
- **WebSocket**: Real-time status updates
- **Package Manager**: npm

## Prerequisites

- Node.js (v18 or higher)
- PostgreSQL
- Redis

## Installation

1. Clone the repository:
```bash
git clone https://github.com/yourusername/eterna_assignment.git
cd eterna_assignment
```

2. Install dependencies:
```bash
npm install
```

3. Create a `.env` file (see [Configuration](#configuration) below)

## Configuration

Create a `.env` file in the root directory with the following variables:

```env
# Server Configuration
PORT=5000
NODE_ENV=development

# Database Configuration
DATABASE_URL=postgresql://postgres:password@localhost:5432/orderengine

# Redis Configuration
REDIS_URL=redis://localhost:6379

# Queue Configuration
QUEUE_CONCURRENCY=10
MAX_RETRIES=3

# Mock Configuration (for simulation)
MOCK_QUOTE_DELAY_MS=200
MOCK_EXECUTION_DELAY_MS=2500
```

### Environment Variables Explained

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Port on which the server runs | 5000 |
| `NODE_ENV` | Environment mode (development/production) | development |
| `DATABASE_URL` | PostgreSQL connection string | postgresql://postgres:password@localhost:5432/orderengine |
| `REDIS_URL` | Redis connection string | redis://localhost:6379 |
| `QUEUE_CONCURRENCY` | Number of concurrent jobs processed | 10 |
| `MAX_RETRIES` | Maximum retry attempts for failed orders | 3 |
| `MOCK_QUOTE_DELAY_MS` | Delay in milliseconds for quote simulation | 200 |
| `MOCK_EXECUTION_DELAY_MS` | Delay in milliseconds for execution simulation | 2500 |

## Running the Application

### Development Mode
```bash
npm run dev
```

### Production Mode
```bash
# Build the project
npm run build

# Start the server
npm start
```

## API Endpoints

### Health Check
```
GET /
```
Returns system information and available endpoints.

### Health Status
```
GET /health
```
Returns server health status.

### Queue Metrics
```
GET /api/metrics
```
Returns queue processing metrics (waiting, active, completed, failed jobs).

### Submit Order
```
POST /api/orders/execute
```
Submit a new market order.

**Request Body:**
```json
{
  "tokenIn": "SOL",
  "tokenOut": "USDC",
  "amount": 1.5,
  "slippage": 0.005
}
```

**Parameters:**
- `tokenIn`: Input token symbol (string, required)
- `tokenOut`: Output token symbol (string, required)
- `amount`: Amount to trade (number, positive, required)
- `slippage`: Slippage tolerance as decimal (number, 0-1, required)

**Response:**
```json
{
  "orderId": "uuid-string",
  "status": "pending",
  "message": "Order created successfully. Connect via WebSocket for real-time updates.",
  "websocketUrl": "/api/orders/execute?orderId=..."
}
```

### Get Order Details
```
GET /api/orders/:orderId
```
Retrieve details of an order.

**Response:**
```json
{
  "orderId": "uuid-string",
  "tokenIn": "SOL",
  "tokenOut": "USDC",
  "amount": 1.5,
  "slippage": 0.005,
  "status": "confirmed",
  "selectedDex": "raydium",
  "executedPrice": 100.25,
  "amountOut": 149.8,
  "txHash": "mock-tx-hash",
  "errorMessage": null,
  "createdAt": "2023-01-01T00:00:00.000Z",
  "updatedAt": "2023-01-01T00:00:00.000Z"
}
```

### List Recent Orders
```
GET /api/orders?limit=50
```
Get recent orders with pagination support.

**Query Parameters:**
- `limit`: Number of orders to return (1-100, default: 50)

**Response:**
```json
{
  "orders": [
    {
      "orderId": "uuid-string",
      "tokenIn": "SOL",
      "tokenOut": "USDC",
      "amount": 1.5,
      "status": "confirmed",
      "selectedDex": "raydium",
      "txHash": "mock-tx-hash",
      "createdAt": "2023-01-01T00:00:00.000Z"
    }
  ],
  "count": 1
}
```

## WebSocket Integration

For real-time order status updates, connect to the order execution endpoint via WebSocket:

### WebSocket Connection
```
POST /api/orders/execute (with WebSocket upgrade headers)
```

After submitting an order with WebSocket upgrade headers, you'll receive real-time status updates:

- `pending`: Order created and queued
- `routing`: Comparing quotes from DEXs
- `building`: Building transaction
- `submitted`: Transaction submitted to blockchain
- `confirmed`: Transaction confirmed
- `failed`: Order execution failed

### Example WebSocket Status Message
```json
{
  "orderId": "uuid-string",
  "status": "routing",
  "timestamp": "2023-01-01T00:00:00.000Z",
  "data": {
    "message": "Comparing DEX quotes..."
  }
}
```

## Queue Processing

The system uses BullMQ for reliable background job processing:

- Orders are placed in a processing queue
- Workers process orders concurrently (based on `QUEUE_CONCURRENCY`)
- Failed orders are automatically retried with exponential backoff
- Successful orders are marked as complete
- Retry attempts are limited by `MAX_RETRIES`

## Database Schema

The application uses PostgreSQL to store order information:

```sql
-- Orders table
CREATE TABLE orders (
  id UUID PRIMARY KEY,
  token_in VARCHAR(50) NOT NULL,
  token_out VARCHAR(50) NOT NULL,
  amount DECIMAL(20, 8) NOT NULL,
  slippage DECIMAL(5, 4) NOT NULL,
  status VARCHAR(20) NOT NULL,
  selected_dex VARCHAR(20),
  raydium_quote JSONB,
  meteora_quote JSONB,
  executed_price DECIMAL(20, 8),
  amount_out DECIMAL(20, 8),
  tx_hash VARCHAR(100),
  error_message TEXT,
  retry_count INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_orders_status ON orders(status);
CREATE INDEX idx_orders_created_at ON orders(created_at DESC);
```

## Order Status Flow

1. **pending**: Order created and added to queue
2. **routing**: Fetching quotes from DEXs, comparing prices
3. **building**: Building transaction with best quote
4. **submitted**: Transaction submitted to blockchain
5. **confirmed**: Transaction confirmed on chain
6. **failed**: Order execution failed (auto-retried up to MAX_RETRIES)

## Development

### Building the Project
```bash
npm run build
```

### Linting
```bash
npm run lint
```

### Running in Watch Mode
```bash
npm run dev
```

## Notes

- This implementation includes a mock DEX router as a placeholder for actual Raydium/Meteora SDK integration
- In production, the `MockDexRouter` class should be replaced with real SDK implementations
- The system supports pluggable DEX adapters for easy expansion to other DEXs
- All sensitive configurations should be properly secured in production environments

## License

[MIT](LICENSE)