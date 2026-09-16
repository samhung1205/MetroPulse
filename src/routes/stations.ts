/**
 * MetroPulse — 站點 API 路由
 * 
 * 提供捷運站基本資料的查詢介面
 */

import { Hono } from 'hono';
import { Env } from '../lib/types';
import {
  getAllStations,
  getStationsByLine,
  getStationById,
  searchStations,
  getStationTags,
} from '../db/queries';
import { jsonDbError } from '../lib/d1-response';

const stations = new Hono<{ Bindings: Env }>();

/**
 * GET /api/stations
 * 取得所有站點，可選依路線篩選
 * Query: ?line=BL&search=台北
 */
stations.get('/', async (c) => {
  const line = c.req.query('line');
  const search = c.req.query('search');

  try {
    let result;
    if (search) {
      result = await searchStations(c.env.mrt_rank_db, search);
    } else if (line) {
      result = await getStationsByLine(c.env.mrt_rank_db, line);
    } else {
      result = await getAllStations(c.env.mrt_rank_db);
    }

    return c.json({
      success: true,
      count: result.length,
      stations: result,
    });
  } catch (error) {
    return jsonDbError(c, error);
  }
});

/**
 * GET /api/stations/:id
 * 取得單一站點詳情（含標籤）
 */
stations.get('/:id', async (c) => {
  const id = c.req.param('id');

  try {
    const station = await getStationById(c.env.mrt_rank_db, id);
    if (!station) {
      return c.json({ success: false, error: '找不到該站點' }, 404);
    }

    const tags = await getStationTags(c.env.mrt_rank_db, id);

    return c.json({
      success: true,
      station,
      tags,
    });
  } catch (error) {
    return jsonDbError(c, error);
  }
});

export default stations;
