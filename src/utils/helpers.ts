/**
 * Sleep utility for simulating network delays
 * @param ms - Milliseconds to sleep
 */
export const sleep = (ms: number): Promise<void> => {
  return new Promise(resolve => setTimeout(resolve, ms));
};

/**
 * Generate a mock transaction hash
 * @returns 64-character hex string resembling a Solana transaction signature
 */
export const generateMockTxHash = (): string => {
  const chars = '0123456789abcdef';
  let hash = '';
  for (let i = 0; i < 64; i++) {
    hash += chars[Math.floor(Math.random() * chars.length)];
  }
  return hash;
};

/**
 * Calculate price with random variance
 * @param basePrice - Base price to apply variance to
 * @param minVariance - Minimum variance (e.g., 0.98 for -2%)
 * @param maxVariance - Maximum variance (e.g., 1.02 for +2%)
 */
export const applyPriceVariance = (
  basePrice: number,
  minVariance: number,
  maxVariance: number
): number => {
  const variance = minVariance + Math.random() * (maxVariance - minVariance);
  return basePrice * variance;
};

/**
 * Generate random delay within a range
 * @param minMs - Minimum delay in milliseconds
 * @param maxMs - Maximum delay in milliseconds
 */
export const randomDelay = (minMs: number, maxMs: number): number => {
  return minMs + Math.random() * (maxMs - minMs);
};
