/**
 * MRT Rank — TypeScript 型別定義
 * 定義所有資料模型與 API 介面
 */

// ============================================================
// 基礎資料模型
// ============================================================

/** 捷運站基本資料 */
export interface Station {
  id: string;              // 站點代碼，如 'BL12'
  name_zh: string;         // 中文名稱
  name_en: string | null;  // 英文名稱
  line: string;            // 主線代碼
  line_name: string | null;
  line_color: string | null;
  station_number: number | null;
  latitude: number | null;
  longitude: number | null;
  is_transfer_station: number;
  transfer_lines: string | null;  // JSON 字串 '["BL","R"]'
  district: string | null;
  address: string | null;
}

/** PageRank 分數記錄 */
export interface PageRankScore {
  station_id: string;
  time_period: TimePeriod;
  pr_value: number;
  pr_rank: number | null;
  normalized_score: number | null;
}

/** 轉移機率記錄 */
export interface TransitionRecord {
  from_station_id: string;
  to_station_id: string;
  time_period: TimePeriod;
  raw_flow: number;
  transition_prob: number;
  normalized_prob: number | null;
}

/** 站點偏好標籤 */
export interface StationTag {
  station_id: string;
  tag_category: PreferenceCategory;
  tag_score: number;
  tag_reason: string | null;
}

/** 旅行成本 */
export interface TravelCost {
  from_station_id: string;
  to_station_id: string;
  station_count: number;
  transfer_count: number;
  estimated_time: number | null;
  cost_score: number | null;
}

// ============================================================
// 列舉與常數
// ============================================================

/** 時段代碼 */
export type TimePeriod =
  | 'morning_peak'   // 晨峰 07:00-09:00
  | 'morning'        // 上午 09:00-12:00
  | 'noon'           // 午間 12:00-14:00
  | 'afternoon'      // 下午 14:00-17:00
  | 'evening_peak'   // 晚峰 17:00-19:00
  | 'night';         // 夜間 19:00-23:00

/** 偏好類別 */
export type PreferenceCategory =
  | 'attraction'  // 景點
  | 'food'        // 美食
  | 'shopping'    // 購物
  | 'nightlife'   // 夜生活
  | 'family'      // 親子
  | 'all';        // 不限

/** 時段顯示名稱對照 */
export const TIME_PERIOD_LABELS: Record<TimePeriod, string> = {
  morning_peak: '晨峰 (07:00-09:00)',
  morning: '上午 (09:00-12:00)',
  noon: '午間 (12:00-14:00)',
  afternoon: '下午 (14:00-17:00)',
  evening_peak: '晚峰 (17:00-19:00)',
  night: '夜間 (19:00-23:00)',
};

/** 偏好類別顯示名稱對照 */
export const PREFERENCE_LABELS: Record<PreferenceCategory, string> = {
  attraction: '景點',
  food: '美食',
  shopping: '購物',
  nightlife: '夜生活',
  family: '親子',
  all: '不限',
};

/** 偏好類別 Emoji */
export const PREFERENCE_EMOJI: Record<PreferenceCategory, string> = {
  attraction: '🏛️',
  food: '🍜',
  shopping: '🛍️',
  nightlife: '🌙',
  family: '👨‍👩‍👧‍👦',
  all: '✨',
};

/** 路線顏色對照 */
export const LINE_COLORS: Record<string, string> = {
  BL: '#0070BD',   // 板南線 — 藍色
  R: '#E3002C',    // 淡水信義線 — 紅色
  G: '#1A803F',    // 松山新店線 — 綠色
  O: '#F5A623',    // 中和新蘆線 — 橘色
  BR: '#C48C31',   // 文湖線 — 棕色
  Y: '#FFDB00',    // 環狀線 — 黃色
};

/** 路線名稱對照 */
export const LINE_NAMES: Record<string, string> = {
  BL: '板南線',
  R: '淡水信義線',
  G: '松山新店線',
  O: '中和新蘆線',
  BR: '文湖線',
  Y: '環狀線',
};

// ============================================================
// 推薦系統核心型別
// ============================================================

/** 推薦權重設定 */
export interface RecommendationWeights {
  w1: number;  // 熱門度 (PageRank)
  w2: number;  // 連結性 (轉移機率)
  w3: number;  // 偏好匹配
  w4: number;  // 旅行成本 (負向)
}

/** 預設推薦權重 */
export const DEFAULT_WEIGHTS: RecommendationWeights = {
  w1: 0.30,  // 熱門度
  w2: 0.25,  // 連結性
  w3: 0.30,  // 偏好匹配
  w4: 0.15,  // 旅行成本
};

/** 分數拆解項 */
export interface ScoreComponent {
  raw: number;         // 原始值
  normalized: number;  // 正規化後 [0,1]
  weighted: number;    // 加權後
  weight: number;      // 使用的權重
}

/** 分數拆解 */
export interface ScoreBreakdown {
  popularity: ScoreComponent;     // w1 * PR_j
  connectivity: ScoreComponent;   // w2 * p_ij
  preference_match: ScoreComponent; // w3 * PreferenceMatch
  travel_cost: ScoreComponent;    // w4 * TravelCost (負向)
}

/** 單一推薦結果 */
export interface RecommendationResult {
  rank: number;
  station: Station;
  total_score: number;
  score_breakdown: ScoreBreakdown;
  reasons: string[];
  tags: string[];
}

/** 推薦 API 回應 */
export interface RecommendationResponse {
  success: boolean;
  query: {
    from_station: { id: string; name: string };
    time_period: TimePeriod;
    time_period_label: string;
    preference: PreferenceCategory;
    preference_label: string;
    top_n: number;
  };
  recommendations: RecommendationResult[];
  metadata: {
    algorithm: string;
    weights: RecommendationWeights;
    gamma: number;
    total_stations_evaluated: number;
  };
}

// ============================================================
// API 請求參數
// ============================================================

/** 推薦 API 查詢參數 */
export interface RecommendQuery {
  from: string;                    // 出發站 ID
  time_period: TimePeriod;         // 時段
  preference: PreferenceCategory;  // 偏好
  top_n?: number;                  // 返回數量，預設 5
}

/** Cloudflare Bindings（須與 Pages 專案 Settings → Bindings 的變數名一致） */
export interface Env {
  mrt_rank_db: D1Database;
}
