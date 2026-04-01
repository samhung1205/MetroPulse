/**
 * MRT Rank — 數值正規化工具
 * 
 * 提供各種正規化方法，確保不同維度的分數可以公平比較。
 * 
 * 學術背景：
 * - Min-Max 正規化將原始值映射到 [0, 1] 區間
 * - 公式：x' = (x - x_min) / (x_max - x_min)
 * - 當所有值相同時，返回 0.5 避免除以零
 */

/**
 * Min-Max 正規化
 * 將數值陣列映射到 [0, 1] 區間
 * 
 * @param values - 原始數值陣列
 * @returns 正規化後的數值陣列
 */
export function minMaxNormalize(values: number[]): number[] {
  if (values.length === 0) return [];
  
  const min = Math.min(...values);
  const max = Math.max(...values);
  
  // 所有值相同的情況，避免除以零
  if (max === min) {
    return values.map(() => 0.5);
  }
  
  return values.map(v => (v - min) / (max - min));
}

/**
 * 對單一值進行 Min-Max 正規化
 * 
 * @param value - 要正規化的值
 * @param min - 該維度的最小值
 * @param max - 該維度的最大值
 * @returns 正規化後的值 [0, 1]
 */
export function normalizeValue(value: number, min: number, max: number): number {
  if (max === min) return 0.5;
  return Math.max(0, Math.min(1, (value - min) / (max - min)));
}

/**
 * 對 Map 中的數值進行 Min-Max 正規化
 * 
 * @param map - key 到數值的映射
 * @returns key 到正規化數值的映射
 */
export function normalizeMap(map: Map<string, number>): Map<string, number> {
  const values = Array.from(map.values());
  if (values.length === 0) return new Map();
  
  const min = Math.min(...values);
  const max = Math.max(...values);
  
  const result = new Map<string, number>();
  for (const [key, value] of map.entries()) {
    result.set(key, normalizeValue(value, min, max));
  }
  
  return result;
}

/**
 * 計算分數的統計摘要
 * 用於 API 回應中的 metadata
 */
export function computeStats(values: number[]): {
  min: number;
  max: number;
  mean: number;
  std: number;
} {
  if (values.length === 0) {
    return { min: 0, max: 0, mean: 0, std: 0 };
  }
  
  const min = Math.min(...values);
  const max = Math.max(...values);
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / values.length;
  const std = Math.sqrt(variance);
  
  return { min, max, mean, std };
}

/**
 * 將分數四捨五入到指定小數位
 */
export function roundScore(value: number, decimals: number = 4): number {
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
}
