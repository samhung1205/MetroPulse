/**
 * MetroPulse — TypeScript 型別定義
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
  Y: '#EDDC00',    // 環狀線 — 黃色（與共用 route token 一致）
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

// ============================================================
// 真實旅運量資料型別
// ============================================================

/** 已匯入月份記錄 */
export interface DataMonth {
  year: number;
  month: number;
  label: string;
  row_count: number;
  imported_at: string;
}

/**
 * 通用時間範圍記錄（Phase 3A：目前只有 range_type='month'｜'year' 會被寫入且對外可用）。
 * is_complete=0 的列只代表「目前狀態」，不保證 range_od_flow/range_pagerank 有對應資料——
 * 只有 is_complete=1 才可信任已經有完整聚合結果可用。
 */
export interface DateRange {
  range_id: string;
  range_type: 'month' | 'year' | 'holiday' | 'custom';
  start_date: string;
  end_date: string;
  holiday_event_id: string | null; // range_type='holiday' 時存 holiday_events.event_key；其餘 range_type 為 null
  label: string | null;
  day_count: number | null;
  expected_day_count: number | null;
  is_complete: number; // SQLite 布林以 0/1 儲存
  computed_at: string | null;
  coverage_note: string | null; // is_complete=0 時說明缺失原因（缺天數／缺哪天的哪個 period）；完整時為 null
}

/** 連假 metadata（人工維護，見 migrations/0007_holiday_events.sql）。(event_key, year) 唯一。 */
export interface HolidayEvent {
  event_key: string;
  year: number;
  name_zh: string;
  start_date: string;
  end_date: string;
  source: string | null;
  updated_at: string | null;
}

/** 真實 PageRank 查詢結果列 */
export interface RealPageRankRow {
  station_id: string;
  period: string;
  year: number;
  month: number;
  pr_value: number;
  pr_rank: number | null;
  normalized_score: number | null;
  name_zh: string;
  line: string;
  line_color: string | null;
  is_transfer_station: number;
}

/** Range PageRank 查詢結果列（月／年通用；analytics 排名表用，含站點資訊） */
export interface RangePageRankRow {
  station_id: string;
  period: string;
  range_id: string;
  pr_value: number;
  pr_rank: number | null;
  normalized_score: number | null;
  name_zh: string;
  line: string;
  line_color: string | null;
  is_transfer_station: number;
}

/** 真實 OD 流量查詢結果列 */
export interface RealOdFlowRow {
  from_station_id: string;
  to_station_id: string;
  period: string;
  year: number;
  month: number;
  flow_count: number;
  to_name_zh: string;
  to_line: string;
  to_line_color: string | null;
}

/** 時段元資料 */
export const PERIODS_META: Record<string, { label: string; short: string }> = {
  morning_peak: { label: '晨峰 07:00-09:00', short: '晨峰' },
  morning:      { label: '上午 09:00-12:00', short: '上午' },
  noon:         { label: '午間 12:00-14:00', short: '午間' },
  afternoon:    { label: '下午 14:00-17:00', short: '下午' },
  evening_peak: { label: '晚峰 17:00-19:00', short: '晚峰' },
  night:        { label: '夜間 19:00-23:00', short: '夜間' },
};
