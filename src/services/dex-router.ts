import { config } from '../config/index.js';
import { DexQuote, SwapResult, OrderDetails } from '../types/index.js';
import { sleep, generateMockTxHash, applyPriceVariance, randomDelay } from '../utils/helpers.js';

/**
 * Mock DEX Router for simulating Raydium and Meteora interactions
 * Provides realistic price quotes with variance and simulated execution delays
 * TODO: Replace with real SDK integration for production
 */
export class MockDexRouter {
  // Base price mapping for common token pairs (SOL as base)
  // These are just mock prices for testing
  private readonly basePrices: Record<string, number> = {
    'SOL-USDC': 100.0,
    'SOL-USDT': 100.0,
    'USDC-SOL': 0.01,
    'USDT-SOL': 0.01,
    'SOL-RAY': 20.0,
    'RAY-SOL': 0.05,
  };

  /**
   * Get base price for a token pair
   */
  private getBasePrice(tokenIn: string, tokenOut: string): number {
    const pair = `${tokenIn}-${tokenOut}`;
    return this.basePrices[pair] || 1.0;
  }

  /**
   * Fetch quote from Raydium DEX
   * Simulates network delay and returns price with variance
   */
  async getRaydiumQuote(
    tokenIn: string,
    tokenOut: string,
    amount: number
  ): Promise<DexQuote> {
    // Simulate network delay
    await sleep(config.mock.quoteDelayMs);

    const basePrice = this.getBasePrice(tokenIn, tokenOut);
    
    // Raydium typically has slightly higher fees but better liquidity
    // Price variance: -2% to +4%
    const price = applyPriceVariance(basePrice, 0.98, 1.04);
    const fee = 0.003; // 0.3% fee
    const estimatedOutput = amount * price * (1 - fee);

    return {
      dex: 'raydium',
      price,
      fee,
      estimatedOutput,
      timestamp: Date.now(),
    };
  }

  /**
   * Fetch quote from Meteora DEX
   * Simulates network delay and returns price with variance
   */
  async getMeteorQuote(
    tokenIn: string,
    tokenOut: string,
    amount: number
  ): Promise<DexQuote> {
    // Simulate network delay
    await sleep(config.mock.quoteDelayMs);

    const basePrice = this.getBasePrice(tokenIn, tokenOut);
    
    // Meteora typically has lower fees but more price variance
    // Price variance: -3% to +5%
    const price = applyPriceVariance(basePrice, 0.97, 1.05);
    const fee = 0.002; // 0.2% fee
    const estimatedOutput = amount * price * (1 - fee);

    return {
      dex: 'meteora',
      price,
      fee,
      estimatedOutput,
      timestamp: Date.now(),
    };
  }

  /**
   * Get quotes from both DEXs in parallel and select the best one
   * @returns Object containing both quotes and the selected best route
   */
  async getBestQuote(
    tokenIn: string,
    tokenOut: string,
    amount: number
  ): Promise<{
    raydiumQuote: DexQuote;
    meteoraQuote: DexQuote;
    bestQuote: DexQuote;
    priceImprovement: number;
  }> {
    // Fetch quotes from both DEXs in parallel
    const [raydiumQuote, meteoraQuote] = await Promise.all([
      this.getRaydiumQuote(tokenIn, tokenOut, amount),
      this.getMeteorQuote(tokenIn, tokenOut, amount),
    ]);

    // Select the quote with better estimated output
    const bestQuote =
      raydiumQuote.estimatedOutput > meteoraQuote.estimatedOutput
        ? raydiumQuote
        : meteoraQuote;

    // Calculate price improvement percentage
    const worseOutput = Math.min(
      raydiumQuote.estimatedOutput,
      meteoraQuote.estimatedOutput
    );
    const priceImprovement =
      ((bestQuote.estimatedOutput - worseOutput) / worseOutput) * 100;

    return {
      raydiumQuote,
      meteoraQuote,
      bestQuote,
      priceImprovement,
    };
  }

  /**
   * Execute swap on the selected DEX
   * Simulates transaction submission and confirmation
   */
  async executeSwap(order: OrderDetails, selectedDex: 'raydium' | 'meteora'): Promise<SwapResult> {
    // Simulate transaction building and submission delay
    const executionDelay = randomDelay(
      config.mock.executionDelayMs - 500,
      config.mock.executionDelayMs + 500
    );
    await sleep(executionDelay);

    const basePrice = this.getBasePrice(order.tokenIn, order.tokenOut);
    
    // Apply slippage - final execution price may differ slightly
    const slippageVariance = 1 - (Math.random() * order.slippage);
    const executedPrice = basePrice * slippageVariance;
    
    const fee = selectedDex === 'raydium' ? 0.003 : 0.002;
    const amountOut = order.amount * executedPrice * (1 - fee);

    return {
      txHash: generateMockTxHash(),
      executedPrice,
      amountIn: order.amount,
      amountOut,
      dex: selectedDex,
      timestamp: Date.now(),
    };
  }

  /**
   * Log routing decision for transparency
   */
  logRoutingDecision(
    orderId: string,
    raydiumQuote: DexQuote,
    meteoraQuote: DexQuote,
    selectedDex: 'raydium' | 'meteora',
    priceImprovement: number
  ): void {
    console.log(`
[DEX ROUTING] Order ${orderId}
Raydium: price=${raydiumQuote.price.toFixed(6)}, fee=${(raydiumQuote.fee * 100).toFixed(2)}%, output=${raydiumQuote.estimatedOutput.toFixed(6)}
Meteora: price=${meteoraQuote.price.toFixed(6)}, fee=${(meteoraQuote.fee * 100).toFixed(2)}%, output=${meteoraQuote.estimatedOutput.toFixed(6)}
Selected: ${selectedDex.toUpperCase()} (${priceImprovement.toFixed(3)}% improvement)
    `);
  }
}
