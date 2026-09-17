/**
 * MetroPulse — 推薦 API 路由
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
import {
  getRecommendationCandidates,
  getStationById,
  getLatestDataMonth,
  getDataMonth,
  getDataMonths,
  getRealPageRankMap,
  getRealTransitionMap,
  getDateRange,
  getRangePageRankMap,
  getRangeTransitionMap,
} from '../db/queries';
import { jsonDbError } from '../lib/d1-response';

const recommend = new Hono<{ Bindings: Env }>();

// 有效的時段與偏好值
const VALID_PERIODS = Object.keys(TIME_PERIOD_LABELS);
const VALID_PREFERENCES = Object.keys(PREFERENCE_LABELS);

// 資料模式：auto（優先真實）/ real（強制真實）/ synthetic（強制合成）
type DataMode = 'auto' | 'real' | 'synthetic';

// 資料範圍模式：month（既有 Phase 1 行為，預設）/ year（Phase 3A 新增，generalized range）
type RangeType = 'month' | 'year';
const VALID_RANGE_TYPES: RangeType[] = ['month', 'year'];

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
  const dataMode = (c.req.query('data_mode') || 'auto') as DataMode;
  const yearStr = c.req.query('year');
  const monthStr = c.req.query('month');
  const hasYear = yearStr !== undefined;
  const hasMonth = monthStr !== undefined;
  const rangeTypeStr = c.req.query('range_type') || 'month';

  // Phase 3A：range_type 驗證（'month' 是預設值，向下相容 Phase 1 完全不帶 range_type 的呼叫）
  if (!VALID_RANGE_TYPES.includes(rangeTypeStr as RangeType)) {
    return c.json({
      success: false,
      error: `無效的 range_type：${rangeTypeStr}`,
      valid_values: VALID_RANGE_TYPES,
    }, 400);
  }
  const rangeType = rangeTypeStr as RangeType;

  if (rangeType === 'year' && dataMode === 'synthetic') {
    return c.json({
      success: false,
      error: 'data_mode=synthetic 不支援 range_type=year',
      hint: '合成資料沒有年度概念；請移除 data_mode=synthetic，或改用 data_mode=real/auto',
    }, 400);
  }

  let requestedYear: number | null = null;
  let requestedMonth: number | null = null;

  if (rangeType === 'year') {
    if (hasMonth) {
      return c.json({
        success: false,
        error: 'range_type=year 不支援同時指定 month',
        hint: '年度推薦只需要 year（如 range_type=year&year=2025），請移除 month 參數',
      }, 400);
    }
    if (!hasYear) {
      return c.json({
        success: false,
        error: 'range_type=year 需要 year 參數',
        hint: '請提供 year（如 range_type=year&year=2025）',
      }, 400);
    }
    requestedYear = parseInt(yearStr!, 10);
    if (!Number.isInteger(requestedYear)) {
      return c.json({
        success: false,
        error: 'year 格式錯誤',
        hint: 'year 需為西元年整數',
      }, 400);
    }
  } else {
    // range_type=month（既有 Phase 1 行為，完全不變）
    if (hasYear !== hasMonth) {
      return c.json({
        success: false,
        error: 'year 與 month 必須成對提供',
        hint: '請同時提供 year 與 month（如 year=2026&month=1），或都不提供以使用最新月份',
      }, 400);
    }

    if (hasYear && hasMonth) {
      requestedYear = parseInt(yearStr!, 10);
      requestedMonth = parseInt(monthStr!, 10);
      if (!Number.isInteger(requestedYear) || !Number.isInteger(requestedMonth) || requestedMonth < 1 || requestedMonth > 12) {
        return c.json({
          success: false,
          error: 'year/month 格式錯誤',
          hint: 'year 需為西元年整數，month 需為 1-12 的整數',
        }, 400);
      }
      if (dataMode === 'synthetic') {
        return c.json({
          success: false,
          error: 'data_mode=synthetic 不支援指定 year/month',
          hint: '合成資料沒有月份概念；請移除 year/month，或改用 data_mode=real/auto',
        }, 400);
      }
    }
  }

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

    // Step 3: 決定資料來源（真實 vs 合成；range_type=year 走完全獨立的 generalized range 路徑）
    let usedRealData = false;
    let realDataMonth: { year: number; month: number; label: string } | null = null;
    let realPrMap: Map<string, { pr_value: number; normalized_score: number }> | null = null;
    let realTransMap: Map<string, { flow_count: number; transition_prob: number }> | null = null;
    let yearRangeLabel: string | null = null;
    let yearRangeMeta: { range_id: string; day_count: number; expected_day_count: number; start_date: string; end_date: string } | null = null;

    if (rangeType === 'year' && dataMode !== 'synthetic') {
      const rangeId = `year:${requestedYear}`;
      const dateRange = await getDateRange(c.env.mrt_rank_db, rangeId);

      if (!dateRange) {
        return c.json({
          success: false,
          error: `找不到 ${requestedYear} 年的旅運資料`,
          hint: `${requestedYear} 年尚未匯入任何逐日資料，無法提供年度推薦`,
        }, 404);
      }
      if (!dateRange.is_complete) {
        return c.json({
          success: false,
          error: `${requestedYear} 年的旅運資料不完整，目前無法提供年度推薦`,
          hint: '年度推薦需要全年 365（閏年 366）天的逐日資料才會計算；不完整年度不會假裝成全年，也不會用缺月份補 0',
          coverage: {
            actual_day_count: dateRange.day_count,
            expected_day_count: dateRange.expected_day_count,
            start_date: dateRange.start_date,
            end_date: dateRange.end_date,
            note: dateRange.coverage_note,
          },
        }, 404);
      }

      if (dataMode === 'real' || dataMode === 'auto') {
        const [prMap, transMap] = await Promise.all([
          getRangePageRankMap(c.env.mrt_rank_db, rangeId, timePeriod),
          getRangeTransitionMap(c.env.mrt_rank_db, from, rangeId, timePeriod),
        ]);
        if (prMap.size > 0) {
          usedRealData = true;
          realPrMap = prMap;
          realTransMap = transMap;
          yearRangeLabel = dateRange.label || `${requestedYear}年（全年）`;
          yearRangeMeta = {
            range_id: rangeId,
            day_count: dateRange.day_count ?? 0,
            expected_day_count: dateRange.expected_day_count ?? 0,
            start_date: dateRange.start_date,
            end_date: dateRange.end_date,
          };
        }
      }
    } else if (rangeType === 'month' && dataMode !== 'synthetic') {
      let targetMonth: { year: number; month: number; label: string } | null;
      if (requestedYear !== null && requestedMonth !== null) {
        targetMonth = await getDataMonth(c.env.mrt_rank_db, requestedYear, requestedMonth);
        if (!targetMonth) {
          const available = await getDataMonths(c.env.mrt_rank_db);
          const availableLabel = available.length
            ? available.map(m => `${m.year}-${String(m.month).padStart(2, '0')}`).join('、')
            : '（目前無任何已匯入月份）';
          return c.json({
            success: false,
            error: `找不到 ${requestedYear} 年 ${requestedMonth} 月的旅運資料`,
            hint: `目前可用月份：${availableLabel}`,
          }, 404);
        }
      } else {
        targetMonth = await getLatestDataMonth(c.env.mrt_rank_db);
      }

      if (targetMonth && (dataMode === 'real' || dataMode === 'auto')) {
        const [prMap, transMap] = await Promise.all([
          getRealPageRankMap(c.env.mrt_rank_db, targetMonth.year, targetMonth.month, timePeriod),
          getRealTransitionMap(c.env.mrt_rank_db, from, targetMonth.year, targetMonth.month, timePeriod),
        ]);
        if (prMap.size > 0) {
          usedRealData = true;
          realDataMonth = targetMonth;
          realPrMap = prMap;
          realTransMap = transMap;
        }
      }
    }

    // Step 4: 取得候選資料
    const candidates = await getRecommendationCandidates(
      c.env.mrt_rank_db,
      from,
      timePeriod
    );

    // 若有真實資料，覆蓋候選資料中的 PR 值和轉移機率
    if (usedRealData && realPrMap && realTransMap) {
      for (const candidate of candidates) {
        const realPr = realPrMap.get(candidate.station.id);
        if (realPr) {
          candidate.prScore = {
            station_id: candidate.station.id,
            time_period: timePeriod,
            pr_value: realPr.pr_value,
            pr_rank: null,
            normalized_score: realPr.normalized_score,
          };
        }
        const realTrans = realTransMap.get(candidate.station.id);
        if (realTrans) {
          candidate.transitionProb = {
            from_station_id: from,
            to_station_id: candidate.station.id,
            time_period: timePeriod,
            raw_flow: realTrans.flow_count,
            transition_prob: realTrans.transition_prob,
            normalized_prob: realTrans.transition_prob,
          };
        }
      }
    }

    // Step 5: 計算推薦
    const recommendations = computeRecommendations(
      from,
      timePeriod,
      preference,
      candidates,
      DEFAULT_WEIGHTS,
      topN
    );

    // Step 6: 組裝回應
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
        data_source: usedRealData ? 'real' : 'synthetic',
        data_month: realDataMonth ? `${realDataMonth.year}年${realDataMonth.month}月` : null,
        data_year: realDataMonth ? realDataMonth.year : null,
        data_month_num: realDataMonth ? realDataMonth.month : null,
        // Phase 3A 新增：generalized range 的確認後 metadata（前端必須用這裡的值顯示實際資料範圍，
        // 不可用送出前的草稿選擇冒充——range_type/range_label 只在真的用了該 range 的資料時才非 null）
        range_type: yearRangeMeta ? 'year' : (realDataMonth ? 'month' : null),
        range_label: yearRangeMeta ? yearRangeLabel : (realDataMonth ? `${realDataMonth.year}年${realDataMonth.month}月` : null),
        range: yearRangeMeta ? {
          range_id: yearRangeMeta.range_id,
          range_type: 'year',
          year: requestedYear,
          start_date: yearRangeMeta.start_date,
          end_date: yearRangeMeta.end_date,
          day_count: yearRangeMeta.day_count,
          expected_day_count: yearRangeMeta.expected_day_count,
          is_complete: true,
        } : null,
      } as any,
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
