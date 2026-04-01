/**
 * MRT Rank — 推薦引擎核心模組
 * 
 * 推薦分數公式：
 * RecommendationScore(i → j, t, pref) = 
 *   w₁ × norm(PR_j(t))            // 時段熱門度
 * + w₂ × norm(p_ij(t))            // 人流連結強度
 * + w₃ × PreferenceMatch(j, pref) // 偏好匹配度
 * - w₄ × norm(TravelCost(i, j))   // 旅行成本（負向）
 * 
 * 學術脈絡：
 * - PR_j 來自 PageRank (Power Method) 計算
 * - p_ij 來自轉移機率矩陣（含 damping factor γ=0.85）
 * - 所有分數經 Min-Max 正規化，確保可比較性
 * - 推薦理由基於各維度的分數自動生成，保持可解釋性
 */

import {
  Station,
  PageRankScore,
  TransitionRecord,
  StationTag,
  TravelCost,
  TimePeriod,
  PreferenceCategory,
  RecommendationWeights,
  RecommendationResult,
  ScoreBreakdown,
  ScoreComponent,
  DEFAULT_WEIGHTS,
  PREFERENCE_LABELS,
  PREFERENCE_EMOJI,
  TIME_PERIOD_LABELS,
} from './types';
import { normalizeValue, roundScore } from './normalizer';

// ============================================================
// 核心推薦引擎
// ============================================================

/** 候選站的原始資料彙整 */
interface CandidateData {
  station: Station;
  prScore: PageRankScore | null;
  transitionProb: TransitionRecord | null;
  tags: StationTag[];
  travelCost: TravelCost | null;
}

/**
 * 計算推薦分數並返回排序後的 Top N 結果
 * 
 * @param fromStationId - 出發站 ID
 * @param timePeriod - 時段
 * @param preference - 偏好類別
 * @param candidates - 所有候選站資料
 * @param weights - 權重設定（預設使用 DEFAULT_WEIGHTS）
 * @param topN - 返回數量
 * @returns 排序後的推薦結果
 */
export function computeRecommendations(
  fromStationId: string,
  timePeriod: TimePeriod,
  preference: PreferenceCategory,
  candidates: CandidateData[],
  weights: RecommendationWeights = DEFAULT_WEIGHTS,
  topN: number = 5
): RecommendationResult[] {
  
  // 排除出發站自身
  const filteredCandidates = candidates.filter(c => c.station.id !== fromStationId);
  
  if (filteredCandidates.length === 0) return [];

  // Step 1: 收集各維度的原始值，用於正規化
  const prValues = filteredCandidates.map(c => c.prScore?.pr_value ?? 0);
  const transValues = filteredCandidates.map(c => c.transitionProb?.transition_prob ?? 0);
  const costValues = filteredCandidates.map(c => c.travelCost?.cost_score ?? 0.5);
  
  const prMin = Math.min(...prValues);
  const prMax = Math.max(...prValues);
  const transMin = Math.min(...transValues);
  const transMax = Math.max(...transValues);
  const costMin = Math.min(...costValues);
  const costMax = Math.max(...costValues);

  // Step 2: 計算每個候選站的分數
  const scoredCandidates = filteredCandidates.map(candidate => {
    const breakdown = computeScoreBreakdown(
      candidate,
      preference,
      weights,
      { prMin, prMax, transMin, transMax, costMin, costMax }
    );
    
    const totalScore = 
      breakdown.popularity.weighted +
      breakdown.connectivity.weighted +
      breakdown.preference_match.weighted -
      breakdown.travel_cost.weighted;

    return {
      candidate,
      totalScore: roundScore(Math.max(0, totalScore), 2),
      breakdown,
    };
  });

  // Step 3: 按總分排序，取 Top N
  scoredCandidates.sort((a, b) => b.totalScore - a.totalScore);
  const topResults = scoredCandidates.slice(0, topN);

  // Step 4: 生成推薦理由
  return topResults.map((item, index) => ({
    rank: index + 1,
    station: item.candidate.station,
    total_score: item.totalScore,
    score_breakdown: item.breakdown,
    reasons: generateReasons(
      item.candidate,
      item.breakdown,
      timePeriod,
      preference,
      fromStationId
    ),
    tags: item.candidate.tags
      .filter(t => t.tag_score >= 0.6)
      .sort((a, b) => b.tag_score - a.tag_score)
      .map(t => PREFERENCE_LABELS[t.tag_category as PreferenceCategory] || t.tag_category),
  }));
}

// ============================================================
// 分數計算內部函式
// ============================================================

/** 正規化範圍參數 */
interface NormRanges {
  prMin: number;
  prMax: number;
  transMin: number;
  transMax: number;
  costMin: number;
  costMax: number;
}

/**
 * 計算單一候選站的分數拆解
 */
function computeScoreBreakdown(
  candidate: CandidateData,
  preference: PreferenceCategory,
  weights: RecommendationWeights,
  ranges: NormRanges
): ScoreBreakdown {
  
  // 1. 熱門度 (PageRank)
  const prRaw = candidate.prScore?.pr_value ?? 0;
  const prNorm = normalizeValue(prRaw, ranges.prMin, ranges.prMax);
  
  // 2. 連結性 (轉移機率)
  const transRaw = candidate.transitionProb?.transition_prob ?? 0;
  const transNorm = normalizeValue(transRaw, ranges.transMin, ranges.transMax);
  
  // 3. 偏好匹配度
  const prefMatch = computePreferenceMatch(candidate.tags, preference);
  
  // 4. 旅行成本
  const costRaw = candidate.travelCost?.cost_score ?? 0.5;
  const costNorm = normalizeValue(costRaw, ranges.costMin, ranges.costMax);

  return {
    popularity: {
      raw: roundScore(prRaw, 4),
      normalized: roundScore(prNorm, 2),
      weighted: roundScore(weights.w1 * prNorm, 4),
      weight: weights.w1,
    },
    connectivity: {
      raw: roundScore(transRaw, 4),
      normalized: roundScore(transNorm, 2),
      weighted: roundScore(weights.w2 * transNorm, 4),
      weight: weights.w2,
    },
    preference_match: {
      raw: roundScore(prefMatch, 2),
      normalized: roundScore(prefMatch, 2), // 偏好匹配本身已在 [0,1]
      weighted: roundScore(weights.w3 * prefMatch, 4),
      weight: weights.w3,
    },
    travel_cost: {
      raw: roundScore(costRaw, 2),
      normalized: roundScore(costNorm, 2),
      weighted: roundScore(weights.w4 * costNorm, 4),
      weight: weights.w4,
    },
  };
}

/**
 * 計算偏好匹配度
 * 
 * 邏輯：
 * - 「不限」(all) → 返回所有標籤的平均分數
 * - 指定偏好 → 返回該偏好的標籤分數
 * - 若無對應標籤 → 返回 0.1（低基礎分）
 */
function computePreferenceMatch(
  tags: StationTag[],
  preference: PreferenceCategory
): number {
  if (preference === 'all') {
    // 不限偏好：取所有標籤的平均分數
    if (tags.length === 0) return 0.3;
    const avgScore = tags.reduce((sum, t) => sum + t.tag_score, 0) / tags.length;
    return avgScore;
  }
  
  // 指定偏好：找對應標籤分數
  const matchedTag = tags.find(t => t.tag_category === preference);
  if (matchedTag) {
    return matchedTag.tag_score;
  }
  
  // 無對應標籤但有其他標籤：給基礎分
  return 0.1;
}

// ============================================================
// 推薦理由生成
// ============================================================

/**
 * 基於分數拆解自動生成可讀的推薦理由
 * 這是可解釋性的核心：讓使用者理解「為什麼推薦這一站」
 */
function generateReasons(
  candidate: CandidateData,
  breakdown: ScoreBreakdown,
  timePeriod: TimePeriod,
  preference: PreferenceCategory,
  fromStationId: string
): string[] {
  const reasons: string[] = [];
  const periodLabel = TIME_PERIOD_LABELS[timePeriod];

  // 理由 1：熱門度
  if (candidate.prScore) {
    const rank = candidate.prScore.pr_rank;
    if (rank && rank <= 5) {
      reasons.push(`🔥 ${periodLabel}熱門度排名第 ${rank} 名`);
    } else if (rank && rank <= 15) {
      reasons.push(`📈 ${periodLabel}熱門度排名第 ${rank} 名，屬熱門站點`);
    } else if (breakdown.popularity.normalized >= 0.3) {
      reasons.push(`📊 該時段有穩定的旅客流量`);
    }
  }

  // 理由 2：連結性
  if (breakdown.connectivity.normalized >= 0.5) {
    reasons.push(`🔗 從出發站有較高的人流連結（連結強度 ${Math.round(breakdown.connectivity.normalized * 100)}%）`);
  } else if (breakdown.connectivity.normalized >= 0.2) {
    reasons.push(`🔗 與出發站有一定的人流往來`);
  }

  // 理由 3：偏好匹配
  if (preference !== 'all') {
    const emoji = PREFERENCE_EMOJI[preference];
    const label = PREFERENCE_LABELS[preference];
    const matchScore = Math.round(breakdown.preference_match.raw * 100);
    
    const matchedTag = candidate.tags.find(t => t.tag_category === preference);
    if (matchedTag && matchedTag.tag_reason) {
      reasons.push(`${emoji} ${label}匹配度 ${matchScore}%：${matchedTag.tag_reason}`);
    } else if (matchScore >= 50) {
      reasons.push(`${emoji} ${label}匹配度 ${matchScore}%`);
    }
  } else {
    // 不限偏好：列出該站最強的標籤
    const topTags = candidate.tags
      .filter(t => t.tag_score >= 0.7)
      .sort((a, b) => b.tag_score - a.tag_score)
      .slice(0, 2);
    
    if (topTags.length > 0) {
      const tagDescs = topTags.map(t => {
        const label = PREFERENCE_LABELS[t.tag_category as PreferenceCategory];
        return `${label}(${Math.round(t.tag_score * 100)}%)`;
      });
      reasons.push(`✨ 強項：${tagDescs.join('、')}`);
    }
  }

  // 理由 4：旅行成本
  if (candidate.travelCost) {
    const { station_count, transfer_count, estimated_time } = candidate.travelCost;
    let costDesc = `🚇 距離 ${station_count} 站`;
    if (transfer_count > 0) {
      costDesc += `，需轉乘 ${transfer_count} 次`;
    } else {
      costDesc += '，無需轉乘';
    }
    if (estimated_time) {
      costDesc += `，約 ${estimated_time} 分鐘`;
    }
    reasons.push(costDesc);
  }

  // 若理由太少，補充一條通用理由
  if (reasons.length < 2) {
    reasons.push('📍 值得一探的捷運站');
  }

  return reasons;
}
