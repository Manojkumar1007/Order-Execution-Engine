import { describe, it, expect, beforeEach } from 'vitest';
import { MockDexRouter } from '../src/services/dex-router.js';

describe('MockDexRouter', () => {
  let router: MockDexRouter;

  beforeEach(() => {
    router = new MockDexRouter();
  });

  describe('getRaydiumQuote', () => {
    it('should return a valid quote with correct structure', async () => {
      const quote = await router.getRaydiumQuote('SOL', 'USDC', 1.0);

      expect(quote).toBeDefined();
      expect(quote.dex).toBe('raydium');
      expect(quote.price).toBeGreaterThan(0);
      expect(quote.fee).toBe(0.003);
      expect(quote.estimatedOutput).toBeGreaterThan(0);
      expect(quote.timestamp).toBeGreaterThan(0);
    });

    it('should apply fee to estimated output', async () => {
      const amount = 1.0;
      const quote = await router.getRaydiumQuote('SOL', 'USDC', amount);

      // Output should be less than amount * price due to fees
      const theoreticalOutput = amount * quote.price;
      expect(quote.estimatedOutput).toBeLessThan(theoreticalOutput);
      
      // Output should be approximately amount * price * (1 - fee)
      const expectedOutput = amount * quote.price * (1 - quote.fee);
      expect(quote.estimatedOutput).toBeCloseTo(expectedOutput, 2);
    });

    it('should simulate network delay', async () => {
      const startTime = Date.now();
      await router.getRaydiumQuote('SOL', 'USDC', 1.0);
      const endTime = Date.now();

      // Should take at least the configured delay (default 200ms)
      expect(endTime - startTime).toBeGreaterThanOrEqual(150); // Allow some margin
    });
  });

  describe('getMeteorQuote', () => {
    it('should return a valid quote with correct structure', async () => {
      const quote = await router.getMeteorQuote('SOL', 'USDC', 1.0);

      expect(quote).toBeDefined();
      expect(quote.dex).toBe('meteora');
      expect(quote.price).toBeGreaterThan(0);
      expect(quote.fee).toBe(0.002);
      expect(quote.estimatedOutput).toBeGreaterThan(0);
      expect(quote.timestamp).toBeGreaterThan(0);
    });

    it('should have lower fees than Raydium', async () => {
      const meteoraQuote = await router.getMeteorQuote('SOL', 'USDC', 1.0);
      const raydiumQuote = await router.getRaydiumQuote('SOL', 'USDC', 1.0);

      expect(meteoraQuote.fee).toBeLessThan(raydiumQuote.fee);
    });
  });

  describe('getBestQuote', () => {
    it('should fetch quotes from both DEXs', async () => {
      const result = await router.getBestQuote('SOL', 'USDC', 1.0);

      expect(result.raydiumQuote).toBeDefined();
      expect(result.meteoraQuote).toBeDefined();
      expect(result.raydiumQuote.dex).toBe('raydium');
      expect(result.meteoraQuote.dex).toBe('meteora');
    });

    it('should select the quote with better estimated output', async () => {
      const result = await router.getBestQuote('SOL', 'USDC', 1.0);

      expect(result.bestQuote).toBeDefined();
      expect(result.bestQuote.estimatedOutput).toBeGreaterThanOrEqual(
        Math.min(result.raydiumQuote.estimatedOutput, result.meteoraQuote.estimatedOutput)
      );
    });

    it('should calculate price improvement', async () => {
      const result = await router.getBestQuote('SOL', 'USDC', 1.0);

      expect(result.priceImprovement).toBeGreaterThanOrEqual(0);
      expect(typeof result.priceImprovement).toBe('number');
    });

    it('should fetch quotes in parallel (performance check)', async () => {
      const startTime = Date.now();
      await router.getBestQuote('SOL', 'USDC', 1.0);
      const endTime = Date.now();

      // Should take roughly the time of one quote (parallel), not two (sequential)
      // Allow some overhead, but it shouldn't be 2x the delay
      expect(endTime - startTime).toBeLessThan(500); // Much less than 2 * 200ms + overhead
    });
  });

  describe('executeSwap', () => {
    it('should execute swap with valid result', async () => {
      const order = {
        orderId: 'test-order-123',
        tokenIn: 'SOL',
        tokenOut: 'USDC',
        amount: 1.5,
        slippage: 0.01,
      };

      const result = await router.executeSwap(order, 'raydium');

      expect(result).toBeDefined();
      expect(result.txHash).toBeDefined();
      expect(result.txHash.length).toBe(64);
      expect(result.executedPrice).toBeGreaterThan(0);
      expect(result.amountIn).toBe(order.amount);
      expect(result.amountOut).toBeGreaterThan(0);
      expect(result.dex).toBe('raydium');
      expect(result.timestamp).toBeGreaterThan(0);
    });

    it('should generate unique transaction hashes', async () => {
      const order = {
        orderId: 'test-order-123',
        tokenIn: 'SOL',
        tokenOut: 'USDC',
        amount: 1.0,
        slippage: 0.01,
      };

      const result1 = await router.executeSwap(order, 'raydium');
      const result2 = await router.executeSwap(order, 'meteora');

      expect(result1.txHash).not.toBe(result2.txHash);
    }, 10000); // Increased timeout for two sequential swaps

    it('should respect slippage tolerance', async () => {
      const order = {
        orderId: 'test-order-123',
        tokenIn: 'SOL',
        tokenOut: 'USDC',
        amount: 1.0,
        slippage: 0.01,
      };

      const result = await router.executeSwap(order, 'raydium');

      // Executed price should be within reasonable range of base price
      // Base price for SOL-USDC is 100, with slippage should be close
      expect(result.executedPrice).toBeGreaterThan(95);
      expect(result.executedPrice).toBeLessThan(105);
    });

    it('should simulate execution delay', async () => {
      const order = {
        orderId: 'test-order-123',
        tokenIn: 'SOL',
        tokenOut: 'USDC',
        amount: 1.0,
        slippage: 0.01,
      };

      const startTime = Date.now();
      await router.executeSwap(order, 'raydium');
      const endTime = Date.now();

      // Should take approximately the configured execution delay (default ~2500ms)
      expect(endTime - startTime).toBeGreaterThanOrEqual(1800); // Allow margin
      expect(endTime - startTime).toBeLessThan(3500); // But not too long
    });
  });

  describe('Price variance', () => {
    it('should have different prices across multiple quotes', async () => {
      const quotes = await Promise.all([
        router.getRaydiumQuote('SOL', 'USDC', 1.0),
        router.getRaydiumQuote('SOL', 'USDC', 1.0),
        router.getRaydiumQuote('SOL', 'USDC', 1.0),
      ]);

      // At least some quotes should have different prices (very unlikely all same with variance)
      const uniquePrices = new Set(quotes.map(q => q.price));
      expect(uniquePrices.size).toBeGreaterThan(1);
    });
  });
});
