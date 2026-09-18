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
  getCompleteHolidayRanges,
  getHolidayEvent,
  getHolidayEventsByKey,
  resolveRangeStationId,
  getRangePageRankByStation,
  getRangeOdFlowFrom,
  getRangeOdFlowTo,
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
// GET /api/analytics/holidays — 已完整計算的連假 range 列表，依 event_key 分組（Phase 3B）
// ============================================================
// 只回傳完整（is_complete=1）連假實例；event 與 year 選項一律由這個端點決定，前端不 hardcode。
analytics.get('/holidays', async (c) => {
  try {
    const ranges = await getCompleteHolidayRanges(c.env.mrt_rank_db);
    const byEvent = new Map<string, { event_key: string; name_zh: string; years: any[] }>();
    for (const r of ranges) {
      if (!byEvent.has(r.event_key)) {
        byEvent.set(r.event_key, { event_key: r.event_key, name_zh: r.name_zh, years: [] });
      }
      byEvent.get(r.event_key)!.years.push({
        year: r.year,
        range_id: r.range_id,
        label: r.label,
        start_date: r.start_date,
        end_date: r.end_date,
        day_count: r.day_count,
        computed_at: r.computed_at,
      });
    }
    return c.json({ success: true, events: Array.from(byEvent.values()) });
  } catch (e) {
    return c.json({ success: false, error: String(e) }, 500);
  }
});

// ============================================================
// GET /api/analytics/holiday-comparison?event_key=&period=&station=
// 歷年同連假比較（Phase 3B.1）——同一 event_key、不同年份的 categorical 比較，不是連續趨勢。
// 只讀既有 holiday_events/date_ranges/range_pagerank/range_od_flow，不重新計算 PageRank。
// ============================================================
analytics.get('/holiday-comparison', async (c) => {
  const eventKey  = c.req.query('event_key');
  const period    = c.req.query('period') || 'morning_peak';
  const stationId = c.req.query('station');

  const validPeriods = ['morning_peak', 'morning', 'noon', 'afternoon', 'evening_peak', 'night'];
  if (!eventKey) {
    return c.json({ success: false, error: '請提供 event_key 參數' }, 400);
  }
  if (!stationId) {
    return c.json({ success: false, error: '請提供 station 參數' }, 400);
  }
  if (!validPeriods.includes(period)) {
    return c.json({ success: false, error: '無效的時段代碼' }, 400);
  }

  try {
    // 刻意取「所有」已登錄年份（不只完整年份），讓不完整／尚未計算的年份也能在比較表裡
    // 被明確標示，而不是悄悄從清單消失、讓使用者誤以為那個年份沒有登錄過。
    const events = await getHolidayEventsByKey(c.env.mrt_rank_db, eventKey);
    if (events.length === 0) {
      return c.json({ success: false, error: `找不到連假事件：${eventKey}` }, 404);
    }
    const eventName = events[0].name_zh;

    const years = await Promise.all(events.map(async (ev) => {
      const rangeId = `holiday:${eventKey}:${ev.year}`;
      const base = {
        year: ev.year,
        range_id: rangeId,
        start_date: ev.start_date,
        end_date: ev.end_date,
        event_source: ev.source,
      };

      const dateRange = await getDateRange(c.env.mrt_rank_db, rangeId);
      if (!dateRange) {
        return {
          ...base, status: 'not_materialized',
          reason: '已登錄，但尚未計算逐日資料覆蓋狀態',
          day_count: null, expected_day_count: null, pagerank: null, flow: null,
        };
      }
      if (!dateRange.is_complete) {
        return {
          ...base, status: 'incomplete',
          reason: dateRange.coverage_note || '這個年份的旅運資料不完整',
          day_count: dateRange.day_count, expected_day_count: dateRange.expected_day_count,
          pagerank: null, flow: null,
        };
      }

      const canonicalId = await resolveRangeStationId(c.env.mrt_rank_db, stationId, rangeId);
      if (!canonicalId) {
        return {
          ...base, status: 'unavailable',
          reason: '此站在這個連假 range 沒有對應資料',
          day_count: dateRange.day_count, expected_day_count: dateRange.expected_day_count,
          pagerank: null, flow: null,
        };
      }

      const [prRows, outboundRows, inboundRows] = await Promise.all([
        getRangePageRankByStation(c.env.mrt_rank_db, rangeId, canonicalId),
        getRangeOdFlowFrom(c.env.mrt_rank_db, rangeId, canonicalId),
        getRangeOdFlowTo(c.env.mrt_rank_db, rangeId, canonicalId),
      ]);
      const pr = prRows.find(p => p.period === period) || null;
      const dayCount = dateRange.day_count && dateRange.day_count > 0 ? dateRange.day_count : null;
      const outboundTotal = outboundRows.filter(r => r.period === period).reduce((s, r) => s + r.flow_count, 0);
      const inboundTotal = inboundRows.filter(r => r.period === period).reduce((s, r) => s + r.flow_count, 0);

      return {
        ...base, status: 'complete', reason: null,
        day_count: dateRange.day_count,
        expected_day_count: dateRange.expected_day_count,
        pagerank: pr ? { pr_value: pr.pr_value, pr_rank: pr.pr_rank, normalized_score: pr.normalized_score } : null,
        flow: {
          outbound_total: outboundTotal,
          inbound_total: inboundTotal,
          // day_count 為 null（理論上不會發生在 is_complete=1 的列）時不假裝算得出平均值。
          outbound_avg_daily: dayCount ? outboundTotal / dayCount : null,
          inbound_avg_daily: dayCount ? inboundTotal / dayCount : null,
        },
        source: { pagerank_source: 'range_pagerank', flow_source: 'range_od_flow' },
      };
    }));

    return c.json({
      success: true,
      query: { event_key: eventKey, period, station: stationId },
      event: { event_key: eventKey, name_zh: eventName },
      years,
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
  const eventKey   = c.req.query('event_key');
  const period     = c.req.query('period') || 'morning_peak';
  const topN       = Math.min(parseInt(c.req.query('top_n') || '20', 10), 100);
  const rangeType  = c.req.query('range_type') || 'month';

  const validPeriods = ['morning_peak', 'morning', 'noon', 'afternoon', 'evening_peak', 'night'];
  if (!validPeriods.includes(period)) {
    return c.json({ success: false, error: '無效的時段代碼' }, 400);
  }

  if (rangeType === 'holiday') {
    if (!eventKey) {
      return c.json({ success: false, error: 'range_type=holiday 需要 event_key 參數' }, 400);
    }
    if (!yearStr) {
      return c.json({ success: false, error: 'range_type=holiday 需要 year 參數' }, 400);
    }
    const year = parseInt(yearStr, 10);
    if (!Number.isInteger(year)) {
      return c.json({ success: false, error: 'year 格式錯誤' }, 400);
    }
    const rangeId = `holiday:${eventKey}:${year}`;
    try {
      const holidayEvent = await getHolidayEvent(c.env.mrt_rank_db, eventKey, year);
      if (!holidayEvent) {
        return c.json({ success: false, error: `找不到連假事件：${eventKey} ${year} 年` }, 404);
      }
      const dateRange = await getDateRange(c.env.mrt_rank_db, rangeId);
      if (!dateRange) {
        return c.json({ success: false, error: `${holidayEvent.name_zh}（${year} 年）已登錄，但尚未計算逐日資料覆蓋狀態` }, 404);
      }
      if (!dateRange.is_complete) {
        return c.json({
          success: false,
          error: `${holidayEvent.name_zh}（${year} 年）的旅運資料不完整，目前無法提供連假排名`,
          coverage: { actual_day_count: dateRange.day_count, expected_day_count: dateRange.expected_day_count, note: dateRange.coverage_note },
        }, 404);
      }
      const rankings = await getRangePageRank(c.env.mrt_rank_db, rangeId, period, topN);
      return c.json({
        success: true,
        query: { range_type: 'holiday', event_key: eventKey, year, period, top_n: topN },
        data_source: 'real',
        range: {
          range_id: rangeId,
          event_key: eventKey,
          year,
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
          coverage: { actual_day_count: dateRange.day_count, expected_day_count: dateRange.expected_day_count, note: dateRange.coverage_note },
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
