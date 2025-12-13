import { randomUUID } from 'crypto';
import pool from '../config/database.js';
import redis from '../config/redis.js';

export type OrderStatus = 'pending' | 'routing' | 'building' | 'submitted' | 'confirmed' | 'failed';

export interface Order {
  id: string;
  tokenIn: string;
  tokenOut: string;
  amount: number;
  slippage: number;
  status: OrderStatus;
  selectedDex?: 'raydium' | 'meteora';
  raydiumQuote?: any;
  meteoraQuote?: any;
  executedPrice?: number;
  amountOut?: number;
  txHash?: string;
  errorMessage?: string;
  retryCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export class OrderModel {
  /**
   * Create a new order in the database
   */
  static async create(
    tokenIn: string,
    tokenOut: string,
    amount: number,
    slippage: number
  ): Promise<Order> {
    const id = randomUUID();
    const client = await pool.connect();

    try {
      const result = await client.query(
        `INSERT INTO orders (id, token_in, token_out, amount, slippage, status, retry_count)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING *`,
        [id, tokenIn, tokenOut, amount, slippage, 'pending', 0]
      );

      const order = this.mapRow(result.rows[0]);

      // Cache in Redis for quick access
      await redis.setex(`order:${id}`, 3600, JSON.stringify(order));

      return order;
    } finally {
      client.release();
    }
  }

  /**
   * Get order by ID (checks Redis cache first)
   */
  static async getById(id: string): Promise<Order | null> {
    // Try Redis cache first
    const cached = await redis.get(`order:${id}`);
    if (cached) {
      return JSON.parse(cached);
    }

    // Validate ID as UUID before querying the database
    const uuidRegex = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
    if (!uuidRegex.test(id)) {
      return null; // Return null for invalid UUIDs without querying the database
    }

    // Fall back to database
    const result = await pool.query('SELECT * FROM orders WHERE id = $1', [id]);
    if (result.rows.length === 0) {
      return null;
    }

    const order = this.mapRow(result.rows[0]);

    // Update cache
    await redis.setex(`order:${id}`, 3600, JSON.stringify(order));

    return order;
  }

  /**
   * Update order status
   */
  static async updateStatus(
    id: string,
    status: OrderStatus,
    additionalData?: Partial<Order>
  ): Promise<void> {
    const client = await pool.connect();

    try {
      const updates: string[] = ['status = $2', 'updated_at = NOW()'];
      const values: any[] = [id, status];
      let paramIndex = 3;

      if (additionalData?.selectedDex) {
        updates.push(`selected_dex = $${paramIndex++}`);
        values.push(additionalData.selectedDex);
      }

      if (additionalData?.raydiumQuote) {
        updates.push(`raydium_quote = $${paramIndex++}`);
        values.push(JSON.stringify(additionalData.raydiumQuote));
      }

      if (additionalData?.meteoraQuote) {
        updates.push(`meteora_quote = $${paramIndex++}`);
        values.push(JSON.stringify(additionalData.meteoraQuote));
      }

      if (additionalData?.executedPrice !== undefined) {
        updates.push(`executed_price = $${paramIndex++}`);
        values.push(additionalData.executedPrice);
      }

      if (additionalData?.amountOut !== undefined) {
        updates.push(`amount_out = $${paramIndex++}`);
        values.push(additionalData.amountOut);
      }

      if (additionalData?.txHash) {
        updates.push(`tx_hash = $${paramIndex++}`);
        values.push(additionalData.txHash);
      }

      if (additionalData?.errorMessage) {
        updates.push(`error_message = $${paramIndex++}`);
        values.push(additionalData.errorMessage);
      }

      if (additionalData?.retryCount !== undefined) {
        updates.push(`retry_count = $${paramIndex++}`);
        values.push(additionalData.retryCount);
      }

      await client.query(
        `UPDATE orders SET ${updates.join(', ')} WHERE id = $1`,
        values
      );

      // Invalidate cache
      await redis.del(`order:${id}`);
    } finally {
      client.release();
    }
  }

  /**
   * Get recent orders
   */
  static async getRecent(limit: number = 50): Promise<Order[]> {
    const result = await pool.query(
      'SELECT * FROM orders ORDER BY created_at DESC LIMIT $1',
      [limit]
    );
    return result.rows.map((row: any) => this.mapRow(row));
  }

  /**
   * Map database row to Order interface
   */
  private static mapRow(row: any): Order {
    return {
      id: row.id,
      tokenIn: row.token_in,
      tokenOut: row.token_out,
      amount: parseFloat(row.amount),
      slippage: parseFloat(row.slippage),
      status: row.status,
      selectedDex: row.selected_dex,
      raydiumQuote: row.raydium_quote,
      meteoraQuote: row.meteora_quote,
      executedPrice: row.executed_price ? parseFloat(row.executed_price) : undefined,
      amountOut: row.amount_out ? parseFloat(row.amount_out) : undefined,
      txHash: row.tx_hash,
      errorMessage: row.error_message,
      retryCount: row.retry_count,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
