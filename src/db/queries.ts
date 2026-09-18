/**
 * MetroPulse — D1 資料庫查詢封裝
 * 
 * 將所有 SQL 查詢集中管理，提供型別安全的查詢介面。
 * 使用 Cloudflare D1 (SQLite) 作為後端資料庫。
 */

import {
  Station,
  PageRankScore,
  TransitionRecord,
  StationTag,
  TravelCost,
  TimePeriod,
  PreferenceCategory,
  DataMonth,
  RealPageRankRow,
  RealOdFlowRow,
  DateRange,
  RangePageRankRow,
  HolidayEvent,
} from '../lib/types';

// ============================================================
// 站點查詢
// ============================================================

/** 取得所有站點 */
export async function getAllStations(db: D1Database): Promise<Station[]> {
  const result = await db.prepare(
    'SELECT * FROM stations ORDER BY line, station_number'
  ).all<Station>();
  return result.results ?? [];
}

/** 依路線篩選站點 */
export async function getStationsByLine(db: D1Database, line: string): Promise<Station[]> {
  const result = await db.prepare(
    'SELECT * FROM stations WHERE line = ? ORDER BY station_number'
  ).bind(line).all<Station>();
  return result.results;
}

/** 取得單一站點 */
export async function getStationById(db: D1Database, id: string): Promise<Station | null> {
  const result = await db.prepare(
    'SELECT * FROM stations WHERE id = ?'
  ).bind(id).first<Station>();
  return result;
}

/** 搜尋站點（支援中英文模糊搜尋） */
export async function searchStations(db: D1Database, keyword: string): Promise<Station[]> {
  const result = await db.prepare(
    `SELECT * FROM stations 
     WHERE name_zh LIKE ? OR name_en LIKE ? OR id LIKE ?
     ORDER BY line, station_number
     LIMIT 20`
  ).bind(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`).all<Station>();
  return result.results;
}

// ============================================================
// PageRank 查詢
// ============================================================

/** 取得指定時段的所有 PageRank 分數 */
export async function getPageRankByPeriod(
  db: D1Database,
  timePeriod: TimePeriod
): Promise<PageRankScore[]> {
  const result = await db.prepare(
    `SELECT * FROM pagerank_scores 
     WHERE time_period = ? 
     ORDER BY pr_rank ASC`
  ).bind(timePeriod).all<PageRankScore>();
  return result.results;
}

/** 取得指定站點在所有時段的 PageRank */
export async function getPageRankByStation(
  db: D1Database,
  stationId: string
): Promise<PageRankScore[]> {
  const result = await db.prepare(
    `SELECT * FROM pagerank_scores 
     WHERE station_id = ? 
     ORDER BY time_period`
  ).bind(stationId).all<PageRankScore>();
  return result.results;
}

/** 取得指定時段的 Top N PageRank 站點（含站點資訊） */
export async function getTopPageRank(
  db: D1Database,
  timePeriod: TimePeriod,
  topN: number = 10
): Promise<(PageRankScore & { name_zh: string; line: string; line_color: string })[]> {
  const result = await db.prepare(
    `SELECT p.*, s.name_zh, s.line, s.line_color 
     FROM pagerank_scores p
     JOIN stations s ON p.station_id = s.id
     WHERE p.time_period = ?
     ORDER BY p.pr_rank ASC
     LIMIT ?`
  ).bind(timePeriod, topN).all();
  return result.results as any;
}

// ============================================================
// 轉移機率查詢
// ============================================================

/** 取得從某站出發在某時段的所有轉移機率 */
export async function getTransitionsFrom(
  db: D1Database,
  fromStationId: string,
  timePeriod: TimePeriod
): Promise<TransitionRecord[]> {
  const result = await db.prepare(
    `SELECT * FROM transition_matrix 
     WHERE from_station_id = ? AND time_period = ?
     ORDER BY transition_prob DESC`
  ).bind(fromStationId, timePeriod).all<TransitionRecord>();
  return result.results;
}

// ============================================================
// 站點標籤查詢
// ============================================================

/** 取得指定站點的所有標籤 */
export async function getStationTags(
  db: D1Database,
  stationId: string
): Promise<StationTag[]> {
  const result = await db.prepare(
    `SELECT * FROM station_tags WHERE station_id = ? ORDER BY tag_score DESC`
  ).bind(stationId).all<StationTag>();
  return result.results;
}

/** 批次取得多個站點的標籤 */
export async function getBatchStationTags(
  db: D1Database,
  stationIds: string[]
): Promise<Map<string, StationTag[]>> {
  if (stationIds.length === 0) return new Map();

  // Cloudflare D1 / SQLite 對單次 bind 參數數量有限制，這裡分批查詢避免推薦頁在全站資料時爆掉。
  const MAX_IDS_PER_QUERY = 50;
  const allTags: StationTag[] = [];

  for (let i = 0; i < stationIds.length; i += MAX_IDS_PER_QUERY) {
    const chunk = stationIds.slice(i, i + MAX_IDS_PER_QUERY);
    const placeholders = chunk.map(() => '?').join(',');
    const result = await db.prepare(
      `SELECT * FROM station_tags
       WHERE station_id IN (${placeholders})
       ORDER BY station_id, tag_score DESC`
    ).bind(...chunk).all<StationTag>();

    allTags.push(...(result.results ?? []));
  }

  // 按 station_id 分組
  const tagMap = new Map<string, StationTag[]>();
  for (const tag of allTags) {
    if (!tagMap.has(tag.station_id)) {
      tagMap.set(tag.station_id, []);
    }
    tagMap.get(tag.station_id)!.push(tag);
  }

  return tagMap;
}

/** 依偏好類別查詢高分站點 */
export async function getStationsByPreference(
  db: D1Database,
  category: PreferenceCategory,
  minScore: number = 0.7
): Promise<(StationTag & { name_zh: string; line: string })[]> {
  if (category === 'all') {
    // 不限偏好：取所有高分站點
    const result = await db.prepare(
      `SELECT t.*, s.name_zh, s.line
       FROM station_tags t
       JOIN stations s ON t.station_id = s.id
       WHERE t.tag_score >= ?
       ORDER BY t.tag_score DESC
       LIMIT 50`
    ).bind(minScore).all();
    return result.results as any;
  }
  
  const result = await db.prepare(
    `SELECT t.*, s.name_zh, s.line
     FROM station_tags t
     JOIN stations s ON t.station_id = s.id
     WHERE t.tag_category = ? AND t.tag_score >= ?
     ORDER BY t.tag_score DESC`
  ).bind(category, minScore).all();
  return result.results as any;
}

// ============================================================
// 旅行成本查詢
// ============================================================

/** 取得從某站出發到所有站的旅行成本 */
export async function getTravelCostsFrom(
  db: D1Database,
  fromStationId: string
): Promise<TravelCost[]> {
  const result = await db.prepare(
    `SELECT * FROM travel_costs 
     WHERE from_station_id = ?
     ORDER BY cost_score ASC`
  ).bind(fromStationId).all<TravelCost>();
  return result.results;
}

/** 取得兩站之間的旅行成本 */
export async function getTravelCost(
  db: D1Database,
  fromId: string,
  toId: string
): Promise<TravelCost | null> {
  const result = await db.prepare(
    `SELECT * FROM travel_costs 
     WHERE from_station_id = ? AND to_station_id = ?`
  ).bind(fromId, toId).first<TravelCost>();
  return result;
}

// ============================================================
// 真實旅運量資料查詢（real_od_flow / real_pagerank）
// ============================================================

/** 取得所有已匯入月份 */
export async function getDataMonths(db: D1Database): Promise<DataMonth[]> {
  const result = await db.prepare(
    `SELECT * FROM data_months ORDER BY year DESC, month DESC`
  ).all<DataMonth>();
  return result.results ?? [];
}

/** 取得最新已匯入月份 */
export async function getLatestDataMonth(db: D1Database): Promise<DataMonth | null> {
  const result = await db.prepare(
    `SELECT * FROM data_months ORDER BY year DESC, month DESC LIMIT 1`
  ).first<DataMonth>();
  return result ?? null;
}

/** 取得指定年月是否已匯入；不存在回傳 null */
export async function getDataMonth(db: D1Database, year: number, month: number): Promise<DataMonth | null> {
  const result = await db.prepare(
    `SELECT * FROM data_months WHERE year = ? AND month = ?`
  ).bind(year, month).first<DataMonth>();
  return result ?? null;
}

/** 真實 PageRank 排名（含站點資訊） */
export async function getRealPageRank(
  db: D1Database,
  year: number,
  month: number,
  period: string,
  topN: number = 20
): Promise<RealPageRankRow[]> {
  const result = await db.prepare(
    `SELECT r.station_id, r.period, r.year, r.month,
            r.pr_value, r.pr_rank, r.normalized_score,
            s.name_zh, s.line, s.line_color, s.is_transfer_station
     FROM real_pagerank r
     JOIN stations s ON r.station_id = s.id
     WHERE r.year = ? AND r.month = ? AND r.period = ?
     ORDER BY r.pr_rank ASC
     LIMIT ?`
  ).bind(year, month, period, topN).all<RealPageRankRow>();
  return result.results ?? [];
}

/** 真實 PageRank 某站各時段值 */
export async function getRealPageRankByStation(
  db: D1Database,
  stationId: string,
  year: number,
  month: number
): Promise<{ period: string; pr_value: number; pr_rank: number | null }[]> {
  const result = await db.prepare(
    `SELECT period, pr_value, pr_rank
     FROM real_pagerank
     WHERE station_id = ? AND year = ? AND month = ?
     ORDER BY period`
  ).bind(stationId, year, month).all();
  return (result.results ?? []) as any;
}

/** 真實 OD 流量（從某站出發，按流量排序） */
export async function getRealOdFlow(
  db: D1Database,
  fromStationId: string,
  year: number,
  month: number,
  period: string,
  topN: number = 15
): Promise<RealOdFlowRow[]> {
  const result = await db.prepare(
    `SELECT f.from_station_id, f.to_station_id, f.period, f.year, f.month, f.flow_count,
            s.name_zh AS to_name_zh, s.line AS to_line, s.line_color AS to_line_color
     FROM real_od_flow f
     JOIN stations s ON f.to_station_id = s.id
     WHERE f.from_station_id = ? AND f.year = ? AND f.month = ? AND f.period = ?
     ORDER BY f.flow_count DESC
     LIMIT ?`
  ).bind(fromStationId, year, month, period, topN).all<RealOdFlowRow>();
  return result.results ?? [];
}

/** 站點 PR 跨月趨勢 */
export async function getStationPrTrends(
  db: D1Database,
  stationId: string,
  period: string
): Promise<{ year: number; month: number; pr_value: number; pr_rank: number | null }[]> {
  const result = await db.prepare(
    `SELECT year, month, pr_value, pr_rank
     FROM real_pagerank
     WHERE station_id = ? AND period = ?
     ORDER BY year ASC, month ASC`
  ).bind(stationId, period).all();
  return (result.results ?? []) as any;
}

/**
 * 把跨月趨勢資料補成連續月曆序列，缺資料的月份以 null 值標示。
 * 不插值、不補 0——缺月就是缺月。
 */
export function buildContinuousMonthCalendar(
  trends: { year: number; month: number; pr_value: number; pr_rank: number | null }[]
): { year: number; month: number; pr_value: number | null; pr_rank: number | null; has_data: boolean }[] {
  if (trends.length === 0) return [];
  const byKey = new Map(trends.map(t => [`${t.year}-${t.month}`, t]));
  const first = trends[0];
  const last = trends[trends.length - 1];
  const calendar: { year: number; month: number; pr_value: number | null; pr_rank: number | null; has_data: boolean }[] = [];
  let y = first.year;
  let m = first.month;
  while (y < last.year || (y === last.year && m <= last.month)) {
    const existing = byKey.get(`${y}-${m}`);
    calendar.push(existing
      ? { year: y, month: m, pr_value: existing.pr_value, pr_rank: existing.pr_rank, has_data: true }
      : { year: y, month: m, pr_value: null, pr_rank: null, has_data: false });
    m += 1;
    if (m > 12) { m = 1; y += 1; }
  }
  return calendar;
}

/**
 * 取得推薦用的真實 PageRank（針對某月某時段）
 * 回傳 Map<station_id, {pr_value, normalized_score}>
 */
export async function getRealPageRankMap(
  db: D1Database,
  year: number,
  month: number,
  period: string
): Promise<Map<string, { pr_value: number; normalized_score: number }>> {
  const result = await db.prepare(
    `SELECT station_id, pr_value, normalized_score
     FROM real_pagerank
     WHERE year = ? AND month = ? AND period = ?`
  ).bind(year, month, period).all<{ station_id: string; pr_value: number; normalized_score: number }>();

  const map = new Map<string, { pr_value: number; normalized_score: number }>();
  for (const row of result.results ?? []) {
    map.set(row.station_id, { pr_value: row.pr_value, normalized_score: row.normalized_score ?? 0 });
  }
  return map;
}

/**
 * 取得推薦用的真實 OD 轉移機率（從 real_od_flow 計算 p_ij）
 */
export async function getRealTransitionMap(
  db: D1Database,
  fromStationId: string,
  year: number,
  month: number,
  period: string
): Promise<Map<string, { flow_count: number; transition_prob: number }>> {
  // 取所有出發站的流量
  const result = await db.prepare(
    `SELECT to_station_id, flow_count
     FROM real_od_flow
     WHERE from_station_id = ? AND year = ? AND month = ? AND period = ?`
  ).bind(fromStationId, year, month, period).all<{ to_station_id: string; flow_count: number }>();

  const rows = result.results ?? [];
  const total = rows.reduce((s, r) => s + r.flow_count, 0);

  const map = new Map<string, { flow_count: number; transition_prob: number }>();
  for (const row of rows) {
    const prob = total > 0 ? row.flow_count / total : 0;
    map.set(row.to_station_id, { flow_count: row.flow_count, transition_prob: prob });
  }
  return map;
}

// ============================================================
// Generalized range 查詢（Phase 3A：month/year 共用同一組表）
// ============================================================

/** 取得單一 range 的狀態記錄；不存在回傳 null。is_complete 需另外檢查，不保證有 range_* 資料 */
export async function getDateRange(db: D1Database, rangeId: string): Promise<DateRange | null> {
  const result = await db.prepare(
    `SELECT * FROM date_ranges WHERE range_id = ?`
  ).bind(rangeId).first<DateRange>();
  return result ?? null;
}

/**
 * 取得所有「完整」年度 range（is_complete=1），依年份新到舊排序。
 * 只回傳完整年度——不完整的年度即使在 date_ranges 有狀態列，也不會出現在這裡，
 * 因為它們沒有對應的 range_pagerank 可用，不該被當成使用者可選的選項。
 */
export async function getCompleteYearRanges(db: D1Database): Promise<DateRange[]> {
  const result = await db.prepare(
    `SELECT * FROM date_ranges WHERE range_type = 'year' AND is_complete = 1 ORDER BY range_id DESC`
  ).all<DateRange>();
  return result.results ?? [];
}

/** 取得單一連假事件 metadata（(event_key, year) 唯一）；不存在回傳 null。 */
export async function getHolidayEvent(db: D1Database, eventKey: string, year: number): Promise<HolidayEvent | null> {
  const result = await db.prepare(
    `SELECT * FROM holiday_events WHERE event_key = ? AND year = ?`
  ).bind(eventKey, year).first<HolidayEvent>();
  return result ?? null;
}

/**
 * 取得某個 event_key 底下「所有」已登錄年份（Phase 3B.1 歷年比較用），依年份新到舊排序。
 * 刻意不過濾 is_complete——比較頁需要能明確標示「已登錄但不完整／尚未計算」的年份，
 * 不能只看到完整年份而讓使用者誤以為那個年份不存在。
 */
export async function getHolidayEventsByKey(db: D1Database, eventKey: string): Promise<HolidayEvent[]> {
  const result = await db.prepare(
    `SELECT * FROM holiday_events WHERE event_key = ? ORDER BY year DESC`
  ).bind(eventKey).all<HolidayEvent>();
  return result.results ?? [];
}

/**
 * 取得所有「完整」連假 range（is_complete=1），並帶出 holiday_events 的 event_key/年份/名稱，
 * 依 event_key、年份新到舊排序——供首頁「連假」選單與 /api/analytics/holidays 依 event 分組使用。
 * 只回傳完整連假：不完整的連假即使已登錄 holiday_events、已嘗試 materialize，也不該被當成
 * 使用者可選的選項（沒有對應的 range_pagerank 可用）。
 *
 * 用 holiday_events.start_date/end_date 與 date_ranges 的實際範圍做 JOIN，而不是去解析
 * range_id 字串（event_key 本身可能含連字號，但不會含冒號，理論上可以解析，但用日期 JOIN
 * 更直接、也順便驗證了兩邊資料一致）。
 */
export async function getCompleteHolidayRanges(
  db: D1Database
): Promise<(DateRange & { event_key: string; year: number; name_zh: string })[]> {
  const result = await db.prepare(
    `SELECT d.*, h.event_key as event_key, h.year as year, h.name_zh as name_zh
     FROM date_ranges d
     JOIN holiday_events h
       ON h.event_key = d.holiday_event_id
      AND h.start_date = d.start_date
      AND h.end_date = d.end_date
     WHERE d.range_type = 'holiday' AND d.is_complete = 1
     ORDER BY h.event_key ASC, h.year DESC`
  ).all<DateRange & { event_key: string; year: number; name_zh: string }>();
  return result.results ?? [];
}

/** Range PageRank 排名（含站點資訊；月／年通用，analytics 排名表用） */
export async function getRangePageRank(
  db: D1Database,
  rangeId: string,
  period: string,
  topN: number = 20
): Promise<RangePageRankRow[]> {
  const result = await db.prepare(
    `SELECT r.station_id, r.period, r.range_id,
            r.pr_value, r.pr_rank, r.normalized_score,
            s.name_zh, s.line, s.line_color, s.is_transfer_station
     FROM range_pagerank r
     JOIN stations s ON r.station_id = s.id
     WHERE r.range_id = ? AND r.period = ?
     ORDER BY r.pr_rank ASC
     LIMIT ?`
  ).bind(rangeId, period, topN).all<RangePageRankRow>();
  return result.results ?? [];
}

/**
 * 取得推薦用的 range PageRank（月／年通用，針對某個 range_id 某時段）
 * 回傳 Map<station_id, {pr_value, normalized_score}>，形狀與 getRealPageRankMap 相同，
 * 讓 computeRecommendations() 完全不需要知道資料來自 real_pagerank 還是 range_pagerank。
 */
export async function getRangePageRankMap(
  db: D1Database,
  rangeId: string,
  period: string
): Promise<Map<string, { pr_value: number; normalized_score: number }>> {
  const result = await db.prepare(
    `SELECT station_id, pr_value, normalized_score
     FROM range_pagerank
     WHERE range_id = ? AND period = ?`
  ).bind(rangeId, period).all<{ station_id: string; pr_value: number; normalized_score: number }>();

  const map = new Map<string, { pr_value: number; normalized_score: number }>();
  for (const row of result.results ?? []) {
    map.set(row.station_id, { pr_value: row.pr_value, normalized_score: row.normalized_score ?? 0 });
  }
  return map;
}

/** 取得推薦用的 range 轉移機率（月／年通用，從 range_od_flow 計算 p_ij） */
export async function getRangeTransitionMap(
  db: D1Database,
  fromStationId: string,
  rangeId: string,
  period: string
): Promise<Map<string, { flow_count: number; transition_prob: number }>> {
  const result = await db.prepare(
    `SELECT to_station_id, flow_count
     FROM range_od_flow
     WHERE from_station_id = ? AND range_id = ? AND period = ?`
  ).bind(fromStationId, rangeId, period).all<{ to_station_id: string; flow_count: number }>();

  const rows = result.results ?? [];
  const total = rows.reduce((s, r) => s + r.flow_count, 0);

  const map = new Map<string, { flow_count: number; transition_prob: number }>();
  for (const row of rows) {
    const prob = total > 0 ? row.flow_count / total : 0;
    map.set(row.to_station_id, { flow_count: row.flow_count, transition_prob: prob });
  }
  return map;
}

/**
 * 把任意 `stations.id` 解析成它在某個 range 實際使用的 canonical station_id。
 *
 * 轉乘站在 `stations` 表對每條線各有一列（如 BL12／R10 都是台北車站，同一 name_zh、不同 id），
 * 但 ETL 只用「主線代表站」的 id 算 daily_od_flow/range_pagerank（見
 * scripts/import_od_data.py 的 STATION_MAP／get_all_station_ids）。若直接拿非代表 id 去查
 * range_pagerank/range_od_flow 會查到 0 筆，不是真的沒有資料。
 * 用 name_zh 找同名列裡「真的在這個 range_pagerank 出現過」的那個 id；找不到回傳 null
 * （理論上不會發生在真實站名，這裡只是防禦性處理，不假裝一定能解析成功）。
 */
export async function resolveRangeStationId(
  db: D1Database,
  stationId: string,
  rangeId: string
): Promise<string | null> {
  const direct = await db.prepare(
    `SELECT 1 FROM range_pagerank WHERE range_id = ? AND station_id = ? LIMIT 1`
  ).bind(rangeId, stationId).first();
  if (direct) return stationId;

  const result = await db.prepare(
    `SELECT r.station_id
     FROM stations s1
     JOIN stations s2 ON s2.name_zh = s1.name_zh
     JOIN range_pagerank r ON r.station_id = s2.id AND r.range_id = ?
     WHERE s1.id = ?
     LIMIT 1`
  ).bind(rangeId, stationId).first<{ station_id: string }>();
  return result?.station_id ?? null;
}

/** Range PageRank 某站各時段值（月／年通用；Station Detail 年度證據用） */
export async function getRangePageRankByStation(
  db: D1Database,
  rangeId: string,
  stationId: string
): Promise<{ period: string; pr_value: number; pr_rank: number | null; normalized_score: number | null }[]> {
  const result = await db.prepare(
    `SELECT period, pr_value, pr_rank, normalized_score
     FROM range_pagerank
     WHERE range_id = ? AND station_id = ?
     ORDER BY period`
  ).bind(rangeId, stationId).all();
  return (result.results ?? []) as any;
}

/** Range OD 流量（某站出發，含所有時段；Station Detail 年度連結證據用）。不做 topN 截斷——
 *  一站最多連到約 117 個 canonical 站 × 6 時段，量小，交給呼叫端依 transition_prob 排序後再截斷。 */
export async function getRangeOdFlowFrom(
  db: D1Database,
  rangeId: string,
  fromStationId: string
): Promise<{ to_station_id: string; period: string; flow_count: number; name_zh: string; line: string; line_color: string }[]> {
  const result = await db.prepare(
    `SELECT f.to_station_id, f.period, f.flow_count, s.name_zh, s.line, s.line_color
     FROM range_od_flow f
     JOIN stations s ON f.to_station_id = s.id
     WHERE f.range_id = ? AND f.from_station_id = ?`
  ).bind(rangeId, fromStationId).all();
  return (result.results ?? []) as any;
}

/** Range OD 流量（流向某站，含所有時段；Station Detail 年度連結證據用） */
export async function getRangeOdFlowTo(
  db: D1Database,
  rangeId: string,
  toStationId: string
): Promise<{ from_station_id: string; period: string; flow_count: number; name_zh: string; line: string; line_color: string }[]> {
  const result = await db.prepare(
    `SELECT f.from_station_id, f.period, f.flow_count, s.name_zh, s.line, s.line_color
     FROM range_od_flow f
     JOIN stations s ON f.from_station_id = s.id
     WHERE f.range_id = ? AND f.to_station_id = ?`
  ).bind(rangeId, toStationId).all();
  return (result.results ?? []) as any;
}

// ============================================================
// 推薦系統專用的複合查詢
// ============================================================

/**
 * 取得推薦所需的全部候選資料
 * 一次查詢所有需要的資訊，減少 DB round-trip
 */
export async function getRecommendationCandidates(
  db: D1Database,
  fromStationId: string,
  timePeriod: TimePeriod
) {
  // 並行查詢所有需要的資料
  const [stations, pageranks, transitions, travelCosts] = await Promise.all([
    getAllStations(db),
    getPageRankByPeriod(db, timePeriod),
    getTransitionsFrom(db, fromStationId, timePeriod),
    getTravelCostsFrom(db, fromStationId),
  ]);
  
  // 建立查找表
  const prMap = new Map(pageranks.map(p => [p.station_id, p]));
  const transMap = new Map(transitions.map(t => [t.to_station_id, t]));
  const costMap = new Map(travelCosts.map(c => [c.to_station_id, c]));
  
  // 批次取得所有站點的標籤
  const stationIds = stations.map(s => s.id);
  const tagsMap = await getBatchStationTags(db, stationIds);
  
  // 組裝候選資料
  return stations.map(station => ({
    station,
    prScore: prMap.get(station.id) ?? null,
    transitionProb: transMap.get(station.id) ?? null,
    tags: tagsMap.get(station.id) ?? [],
    travelCost: costMap.get(station.id) ?? null,
  }));
}
