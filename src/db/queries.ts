/**
 * MRT Rank — D1 資料庫查詢封裝
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
