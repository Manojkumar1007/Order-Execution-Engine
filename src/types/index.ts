// Types for DEX quotes and execution results
export interface DexQuote {
  dex: 'raydium' | 'meteora';
  price: number;
  fee: number;
  estimatedOutput: number;
  timestamp: number;
}

export interface SwapResult {
  txHash: string;
  executedPrice: number;
  amountIn: number;
  amountOut: number;
  dex: 'raydium' | 'meteora';
  timestamp: number;
}

export interface OrderDetails {
  orderId: string;
  tokenIn: string;
  tokenOut: string;
  amount: number;
  slippage: number;
}
