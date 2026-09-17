/**
 * MetroPulse Analytics API
 * 真實旅運量分析端點（基於台北捷運公開 OD 資料）
 *
 * GET /api/analytics/months                              — 已匯入月份列表
 * GET /api/analytics/pagerank?year=&month=&period=&top_n= — 真實 PageRank 排名
 * GET /api/analytics/flow?year=&month=&from=&period=      — 起站 OD 流量
 * GET /api/analytics/trends?station=&period=             — 站點跨月 PR 趨勢
 * GET /api/analytics/latest                             — 最新匯入月份摘要
 */

import { Hono } from 'hono';
import { Env } from '../lib/types';
import {
  getDataMonths,
  getLatestDataMonth,
  getRealPageRank,
  getRealOdFlow,
  getStationPrTrends,
  getRealPageRankByStation,
  buildContinuousMonthCalendar,
  getCompleteYearRanges,
  getRangePageRank,
  getDateRange,
} from '../db/queries';

const analytics = new Hono<{ Bindings: Env }>();

// ============================================================
// GET /api/analytics/months — 已匯入月份列表
// ============================================================
analytics.get('/months', async (c) => {
  try {
    const months = await getDataMonths(c.env.mrt_rank_db);
    return c.json({ success: true, months });
  } catch (e) {
    return c.json({ success: false, error: String(e) }, 500);
  }
});

// ============================================================
// GET /api/analytics/years — 已完整計算的年度 range 列表（Phase 3A）
// ============================================================
analytics.get('/years', async (c) => {
  try {
    const years = await getCompleteYearRanges(c.env.mrt_rank_db);
    return c.json({
      success: true,
      years: years.map(y => ({
        year: parseInt(y.range_id.split(':')[1], 10),
        range_id: y.range_id,
        label: y.label,
        start_date: y.start_date,
        end_date: y.end_date,
        day_count: y.day_count,
        computed_at: y.computed_at,
      })),
    });
  } catch (e) {
    return c.json({ success: false, error: String(e) }, 500);
  }
});

// ============================================================
// GET /api/analytics/latest — 最新月份基本摘要
// ============================================================
analytics.get('/latest', async (c) => {
  try {
    const month = await getLatestDataMonth(c.env.mrt_rank_db);
    if (!month) {
      return c.json({ success: true, has_real_data: false });
    }
    return c.json({ success: true, has_real_data: true, latest: month });
  } catch (e) {
    return c.json({ success: false, error: String(e) }, 500);
  }
});

// ============================================================
// GET /api/analytics/pagerank — 真實 PageRank 排名
// ============================================================
analytics.get('/pagerank', async (c) => {
  const yearStr    = c.req.query('year');
  const monthStr   = c.req.query('month');
  const period     = c.req.query('period') || 'morning_peak';
  const topN       = Math.min(parseInt(c.req.query('top_n') || '20', 10), 100);
  const rangeType  = c.req.query('range_type') || 'month';

  const validPeriods = ['morning_peak', 'morning', 'noon', 'afternoon', 'evening_peak', 'night'];
  if (!validPeriods.includes(period)) {
    return c.json({ success: false, error: '無效的時段代碼' }, 400);
  }

  if (rangeType === 'year') {
    if (!yearStr) {
      return c.json({ success: false, error: 'range_type=year 需要 year 參數' }, 400);
    }
    const year = parseInt(yearStr, 10);
    if (!Number.isInteger(year)) {
      return c.json({ success: false, error: 'year 格式錯誤' }, 400);
    }
    const rangeId = `year:${year}`;
    try {
      const dateRange = await getDateRange(c.env.mrt_rank_db, rangeId);
      if (!dateRange) {
        return c.json({ success: false, error: `找不到 ${year} 年的旅運資料` }, 404);
      }
      if (!dateRange.is_complete) {
        return c.json({
          success: false,
          error: `${year} 年的旅運資料不完整，目前無法提供年度排名`,
          coverage: { actual_day_count: dateRange.day_count, expected_day_count: dateRange.expected_day_count },
        }, 404);
      }
      const rankings = await getRangePageRank(c.env.mrt_rank_db, rangeId, period, topN);
      return c.json({
        success: true,
        query: { range_type: 'year', year, period, top_n: topN },
        data_source: 'real',
        range: {
          range_id: rangeId,
          label: dateRange.label,
          start_date: dateRange.start_date,
          end_date: dateRange.end_date,
          day_count: dateRange.day_count,
        },
        rankings,
      });
    } catch (e) {
      return c.json({ success: false, error: String(e) }, 500);
    }
  }

  // range_type=month（既有行為，未變動）
  let year: number, month: number;
  if (!yearStr || !monthStr) {
    const latest = await getLatestDataMonth(c.env.mrt_rank_db);
    if (!latest) {
      return c.json({ success: false, error: '尚無真實資料，請先執行 ETL 腳本匯入資料' }, 404);
    }
    year = latest.year;
    month = latest.month;
  } else {
    year = parseInt(yearStr, 10);
    month = parseInt(monthStr, 10);
  }

  try {
    const rankings = await getRealPageRank(c.env.mrt_rank_db, year, month, period, topN);
    return c.json({
      success: true,
      query: { range_type: 'month', year, month, period, top_n: topN },
      data_source: 'real',
      rankings,
    });
  } catch (e) {
    return c.json({ success: false, error: String(e) }, 500);
  }
});

// ============================================================
// GET /api/analytics/flow — 特定站點 OD 流量
// ============================================================
analytics.get('/flow', async (c) => {
  const fromStation = c.req.query('from');
  const period      = c.req.query('period') || 'morning_peak';
  const topN        = Math.min(parseInt(c.req.query('top_n') || '15', 10), 50);
  const yearStr     = c.req.query('year');
  const monthStr    = c.req.query('month');

  if (!fromStation) {
    return c.json({ success: false, error: '請提供 from 參數（出發站 ID）' }, 400);
  }

  let year: number, month: number;
  if (!yearStr || !monthStr) {
    const latest = await getLatestDataMonth(c.env.mrt_rank_db);
    if (!latest) {
      return c.json({ success: false, error: '尚無真實資料' }, 404);
    }
    year = latest.year;
    month = latest.month;
  } else {
    year = parseInt(yearStr, 10);
    month = parseInt(monthStr, 10);
  }

  try {
    const flows = await getRealOdFlow(c.env.mrt_rank_db, fromStation, year, month, period, topN);
    return c.json({
      success: true,
      query: { from_station: fromStation, year, month, period, top_n: topN },
      flows,
    });
  } catch (e) {
    return c.json({ success: false, error: String(e) }, 500);
  }
});

// ============================================================
// GET /api/analytics/trends — 站點 PR 跨月趨勢
// ============================================================
analytics.get('/trends', async (c) => {
  const stationId = c.req.query('station');
  const period    = c.req.query('period') || 'morning_peak';

  if (!stationId) {
    return c.json({ success: false, error: '請提供 station 參數' }, 400);
  }

  try {
    const trends = await getStationPrTrends(c.env.mrt_rank_db, stationId, period);
    const calendar = buildContinuousMonthCalendar(trends);
    return c.json({
      success: true,
      query: { station_id: stationId, period },
      trends,
      calendar,
    });
  } catch (e) {
    return c.json({ success: false, error: String(e) }, 500);
  }
});

// ============================================================
// GET /api/analytics/station-pr — 單站各時段真實 PR
// ============================================================
analytics.get('/station-pr', async (c) => {
  const stationId = c.req.query('station');
  const yearStr   = c.req.query('year');
  const monthStr  = c.req.query('month');

  if (!stationId) {
    return c.json({ success: false, error: '請提供 station 參數' }, 400);
  }

  let year: number, month: number;
  if (!yearStr || !monthStr) {
    const latest = await getLatestDataMonth(c.env.mrt_rank_db);
    if (!latest) {
      return c.json({ success: false, error: '尚無真實資料' }, 404);
    }
    year = latest.year;
    month = latest.month;
  } else {
    year = parseInt(yearStr, 10);
    month = parseInt(monthStr, 10);
  }

  try {
    const pr = await getRealPageRankByStation(c.env.mrt_rank_db, stationId, year, month);
    return c.json({ success: true, station_id: stationId, year, month, pr_by_period: pr });
  } catch (e) {
    return c.json({ success: false, error: String(e) }, 500);
  }
});

export default analytics;
