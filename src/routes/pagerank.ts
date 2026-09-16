/**
 * MetroPulse — PageRank API 路由
 * 
 * 提供 PageRank 分數的查詢與視覺化資料
 */

import { Hono } from 'hono';
import { Env, TimePeriod, TIME_PERIOD_LABELS } from '../lib/types';
import {
  getTopPageRank,
  getPageRankByStation,
  getPageRankByPeriod,
} from '../db/queries';
import { jsonDbError } from '../lib/d1-response';

const pagerank = new Hono<{ Bindings: Env }>();

/**
 * GET /api/pagerank
 * 取得指定時段的 PageRank 排名
 * Query: ?time_period=afternoon&top_n=10
 */
pagerank.get('/', async (c) => {
  const timePeriod = (c.req.query('time_period') || 'afternoon') as TimePeriod;
  const topN = parseInt(c.req.query('top_n') || '10');

  // 驗證時段
  if (!TIME_PERIOD_LABELS[timePeriod]) {
    return c.json({
      success: false,
      error: `無效的時段，可選值：${Object.keys(TIME_PERIOD_LABELS).join(', ')}`,
    }, 400);
  }

  try {
    const rankings = await getTopPageRank(c.env.mrt_rank_db, timePeriod, topN);
    
    return c.json({
      success: true,
      time_period: timePeriod,
      time_period_label: TIME_PERIOD_LABELS[timePeriod],
      count: rankings.length,
      rankings,
    });
  } catch (error) {
    return jsonDbError(c, error);
  }
});

/**
 * GET /api/pagerank/periods
 * 取得所有可用時段
 */
pagerank.get('/periods', async (c) => {
  return c.json({
    success: true,
    periods: Object.entries(TIME_PERIOD_LABELS).map(([key, label]) => ({
      value: key,
      label,
    })),
  });
});

/**
 * GET /api/pagerank/:stationId
 * 取得指定站點在所有時段的 PageRank 變化
 */
pagerank.get('/:stationId', async (c) => {
  const stationId = c.req.param('stationId');

  try {
    const scores = await getPageRankByStation(c.env.mrt_rank_db, stationId);
    
    if (scores.length === 0) {
      return c.json({
        success: false,
        error: '找不到該站點的 PageRank 資料',
      }, 404);
    }

    return c.json({
      success: true,
      station_id: stationId,
      scores: scores.map(s => ({
        ...s,
        time_period_label: TIME_PERIOD_LABELS[s.time_period as TimePeriod] || s.time_period,
      })),
    });
  } catch (error) {
    return jsonDbError(c, error);
  }
});

export default pagerank;
