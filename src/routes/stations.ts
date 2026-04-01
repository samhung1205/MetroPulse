/**
 * MRT Rank — 站點 API 路由
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
      result = await searchStations(c.env.DB, search);
    } else if (line) {
      result = await getStationsByLine(c.env.DB, line);
    } else {
      result = await getAllStations(c.env.DB);
    }

    return c.json({
      success: true,
      count: result.length,
      stations: result,
    });
  } catch (error) {
    return c.json({ success: false, error: String(error) }, 500);
  }
});

/**
 * GET /api/stations/:id
 * 取得單一站點詳情（含標籤）
 */
stations.get('/:id', async (c) => {
  const id = c.req.param('id');

  try {
    const station = await getStationById(c.env.DB, id);
    if (!station) {
      return c.json({ success: false, error: '找不到該站點' }, 404);
    }

    const tags = await getStationTags(c.env.DB, id);

    return c.json({
      success: true,
      station,
      tags,
    });
  } catch (error) {
    return c.json({ success: false, error: String(error) }, 500);
  }
});

export default stations;
