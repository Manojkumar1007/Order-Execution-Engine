import pkg from 'pg';
const { Pool } = pkg;
import { config } from './index.js'

// Create PostgreSQL connection pool
export const pool = new Pool({
  connectionString: config.database.url,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

pool.on('error', (error: Error) => {
  console.error('PostgreSQL pool error:', error);
});

pool.on('connect', () => {
  console.log('✓ PostgreSQL connected successfully');
});

// Initialize database schema
export async function initDatabase(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS orders (
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

      CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
      CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at DESC);
    `);
    console.log('✓ Database schema initialized');
  } finally {
    client.release();
  }
}

export default pool;
