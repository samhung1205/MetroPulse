/**
 * MRT Rank — 站點詳情 API 路由
 * 
 * 提供站點詳細資訊，包含：
 * - 基本資料
 * - 各時段 PageRank 變化
 * - 偏好標籤雷達圖資料
 * - 主要連結站（轉移機率 Top N）
 */

import { Hono } from 'hono';
import {
  Env,
  TimePeriod,
  TIME_PERIOD_LABELS,
  PREFERENCE_LABELS,
  LINE_COLORS,
  LINE_NAMES,
} from '../lib/types';
import {
  getStationById,
  getStationTags,
  getPageRankByStation,
} from '../db/queries';
import { jsonDbError } from '../lib/d1-response';

const stationDetail = new Hono<{ Bindings: Env }>();

/**
 * GET /api/station-detail/:id
 * 取得站點完整詳情（用於站點詳情頁）
 */
stationDetail.get('/:id', async (c) => {
  const id = c.req.param('id');

  try {
    // 並行查詢
    const [station, tags, prScores] = await Promise.all([
      getStationById(c.env.mrt_rank_db, id),
      getStationTags(c.env.mrt_rank_db, id),
      getPageRankByStation(c.env.mrt_rank_db, id),
    ]);

    if (!station) {
      return c.json({ success: false, error: '找不到該站點' }, 404);
    }

    // 查詢該站的主要轉移連結（各時段 Top 5 目的站）
    const transResult = await c.env.mrt_rank_db.prepare(`
      SELECT t.to_station_id, t.time_period, t.transition_prob, t.normalized_prob, t.raw_flow,
             s.name_zh, s.line, s.line_color
      FROM transition_matrix t
      JOIN stations s ON t.to_station_id = s.id
      WHERE t.from_station_id = ?
      ORDER BY t.transition_prob DESC
      LIMIT 30
    `).bind(id).all();

    // 查詢反向連結 — 哪些站流向此站
    const inboundResult = await c.env.mrt_rank_db.prepare(`
      SELECT t.from_station_id, t.time_period, t.transition_prob, t.raw_flow,
             s.name_zh, s.line, s.line_color
      FROM transition_matrix t
      JOIN stations s ON t.from_station_id = s.id
      WHERE t.to_station_id = ?
      ORDER BY t.transition_prob DESC
      LIMIT 20
    `).bind(id).all();

    // 整理 PageRank 時序資料
    const prTimeSeries = prScores.map(p => ({
      time_period: p.time_period,
      time_period_label: TIME_PERIOD_LABELS[p.time_period as TimePeriod] || p.time_period,
      pr_value: p.pr_value,
      pr_rank: p.pr_rank,
      normalized_score: p.normalized_score,
    }));

    // 整理偏好雷達資料
    const radarData = {
      labels: ['景點', '美食', '購物', '夜生活', '親子'],
      categories: ['attraction', 'food', 'shopping', 'nightlife', 'family'],
      scores: ['attraction', 'food', 'shopping', 'nightlife', 'family'].map(cat => {
        const tag = tags.find(t => t.tag_category === cat);
        return tag ? tag.tag_score : 0;
      }),
      reasons: {} as Record<string, string>,
    };
    tags.forEach(t => {
      if (t.tag_reason) {
        const label = PREFERENCE_LABELS[t.tag_category as keyof typeof PREFERENCE_LABELS] || t.tag_category;
        radarData.reasons[label] = t.tag_reason;
      }
    });

    return c.json({
      success: true,
      station: {
        ...station,
        line_name: LINE_NAMES[station.line] || station.line,
        line_color: LINE_COLORS[station.line] || station.line_color,
      },
      pagerank: {
        time_series: prTimeSeries,
        best_period: prTimeSeries.reduce((best, p) =>
          (p.pr_value > (best?.pr_value ?? 0)) ? p : best,
          prTimeSeries[0]
        ),
      },
      preference: radarData,
      connections: {
        outbound: transResult.results,
        inbound: inboundResult.results,
      },
    });
  } catch (error) {
    return jsonDbError(c, error);
  }
});

export default stationDetail;
