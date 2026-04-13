/**
 * MRT Rank — 推薦 API 路由
 * 
 * 核心推薦端點：接收使用者查詢條件，返回 Top N 推薦站點
 * 
 * 推薦流程：
 * 1. 驗證輸入參數
 * 2. 從 D1 取得所有候選資料
 * 3. 調用推薦引擎計算分數
 * 4. 返回排序後的推薦結果
 */

import { Hono } from 'hono';
import {
  Env,
  TimePeriod,
  PreferenceCategory,
  DEFAULT_WEIGHTS,
  TIME_PERIOD_LABELS,
  PREFERENCE_LABELS,
  RecommendationResponse,
} from '../lib/types';
import { computeRecommendations } from '../lib/recommender';
import { getRecommendationCandidates, getStationById } from '../db/queries';
import { jsonDbError } from '../lib/d1-response';

const recommend = new Hono<{ Bindings: Env }>();

// 有效的時段與偏好值
const VALID_PERIODS = Object.keys(TIME_PERIOD_LABELS);
const VALID_PREFERENCES = Object.keys(PREFERENCE_LABELS);

/**
 * GET /api/recommend
 * 
 * 核心推薦 API
 * 
 * Query Parameters:
 *   from       - 出發站 ID (必填)
 *   time_period - 時段代碼 (必填)
 *   preference  - 偏好類別 (必填)
 *   top_n       - 返回數量 (選填，預設 5)
 * 
 * Example:
 *   /api/recommend?from=BL12&time_period=afternoon&preference=food&top_n=5
 */
recommend.get('/', async (c) => {
  // Step 1: 解析與驗證參數
  const from = c.req.query('from');
  const timePeriod = c.req.query('time_period') as TimePeriod;
  const preference = (c.req.query('preference') || 'all') as PreferenceCategory;
  const topN = Math.min(Math.max(parseInt(c.req.query('top_n') || '5'), 1), 20);

  // 參數驗證
  if (!from) {
    return c.json({
      success: false,
      error: '缺少必填參數：from（出發站 ID）',
      hint: '請提供出發站代碼，如 from=BL12',
    }, 400);
  }

  if (!timePeriod || !VALID_PERIODS.includes(timePeriod)) {
    return c.json({
      success: false,
      error: `無效的時段：${timePeriod}`,
      valid_values: VALID_PERIODS,
    }, 400);
  }

  if (!VALID_PREFERENCES.includes(preference)) {
    return c.json({
      success: false,
      error: `無效的偏好類別：${preference}`,
      valid_values: VALID_PREFERENCES,
    }, 400);
  }

  try {
    // Step 2: 確認出發站存在
    const fromStation = await getStationById(c.env.mrt_rank_db, from);
    if (!fromStation) {
      return c.json({
        success: false,
        error: `找不到出發站：${from}`,
        hint: '請使用有效的站點代碼，如 BL12（台北車站）、R30（台北101/世貿）',
      }, 404);
    }

    // Step 3: 取得所有候選資料
    const candidates = await getRecommendationCandidates(
      c.env.mrt_rank_db,
      from,
      timePeriod
    );

    // Step 4: 計算推薦
    const recommendations = computeRecommendations(
      from,
      timePeriod,
      preference,
      candidates,
      DEFAULT_WEIGHTS,
      topN
    );

    // Step 5: 組裝回應
    const response: RecommendationResponse = {
      success: true,
      query: {
        from_station: { id: fromStation.id, name: fromStation.name_zh },
        time_period: timePeriod,
        time_period_label: TIME_PERIOD_LABELS[timePeriod],
        preference,
        preference_label: PREFERENCE_LABELS[preference],
        top_n: topN,
      },
      recommendations,
      metadata: {
        algorithm: 'PageRank-based Weighted Recommendation',
        weights: DEFAULT_WEIGHTS,
        gamma: 0.85,
        total_stations_evaluated: candidates.length,
      },
    };

    return c.json(response);
  } catch (error) {
    console.error('Recommendation error:', error);
    return jsonDbError(c, error);
  }
});

/**
 * GET /api/recommend/options
 * 取得推薦表單可選的選項（前端下拉選單用）
 */
recommend.get('/options', async (c) => {
  try {
    // 取得所有站點作為出發站選項
    const result = await c.env.mrt_rank_db.prepare(
      `SELECT id, name_zh, line, line_color, is_transfer_station 
       FROM stations ORDER BY line, station_number`
    ).all();

    return c.json({
      success: true,
      stations: result.results ?? [],
      time_periods: Object.entries(TIME_PERIOD_LABELS).map(([value, label]) => ({
        value,
        label,
      })),
      preferences: Object.entries(PREFERENCE_LABELS).map(([value, label]) => ({
        value,
        label,
      })),
      weights: DEFAULT_WEIGHTS,
    });
  } catch (error) {
    return jsonDbError(c, error);
  }
});

export default recommend;
