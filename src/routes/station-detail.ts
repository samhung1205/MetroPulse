/**
 * MetroPulse — 站點詳情 API 路由
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
  getDateRange,
  resolveRangeStationId,
  getRangePageRankByStation,
  getRangeOdFlowFrom,
  getRangeOdFlowTo,
  getHolidayEvent,
} from '../db/queries';
import { jsonDbError } from '../lib/d1-response';

const stationDetail = new Hono<{ Bindings: Env }>();

/** 把 range_od_flow 的原始 flow_count 列，依「同一站同一時段」的總量換算成 transition_prob，
 *  做法與 getRangeTransitionMap()（推薦用）一致，只是這裡要跨全部時段一次算完，供 Detail 頁使用。
 *  不對缺值補 0——沒有 flow_count 的 (to,period) 組合本來就不會出現在列裡。 */
function withTransitionProb<T extends { period: string; flow_count: number }>(
  rows: T[]
): (T & { time_period: string; transition_prob: number })[] {
  const totalsByPeriod = new Map<string, number>();
  for (const r of rows) totalsByPeriod.set(r.period, (totalsByPeriod.get(r.period) ?? 0) + r.flow_count);
  return rows
    .map(r => ({
      ...r,
      time_period: r.period,
      transition_prob: (totalsByPeriod.get(r.period) ?? 0) > 0 ? r.flow_count / totalsByPeriod.get(r.period)! : 0,
    }))
    .sort((a, b) => b.transition_prob - a.transition_prob);
}

/**
 * GET /api/station-detail/:id?range_type=year&year=YYYY
 * GET /api/station-detail/:id?range_type=holiday&event_key=lunar-new-year&year=YYYY
 *
 * 取得站點完整詳情（用於站點詳情頁）。
 * 不帶 range 參數時行為與既有版本完全一致（合成軌道 pagerank_scores/transition_matrix）。
 * 帶 range_type=year/holiday 且該 range 已完整時，PageRank 與連結證據改用同一個 range 的
 * range_pagerank/range_od_flow（直接讀取，不重新計算），並在 metadata.range 回傳確認後的
 * range 資訊；range 不存在／不完整／解析不到對應站點時，不讓整頁失敗，只是不附加證據，並在
 * metadata.range_error 誠實說明原因，讓前端可以選擇顯示或忽略。連假 context 下絕不混用
 * 月份／年度／synthetic 證據——要嘛是同一個 holiday range 的證據，要嘛明確標示不可用。
 */
stationDetail.get('/:id', async (c) => {
  const id = c.req.param('id');
  const rangeTypeParam = c.req.query('range_type');
  const yearStr = c.req.query('year');
  const eventKeyParam = c.req.query('event_key');

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

    // 整理 PageRank 時序資料（預設：合成軌道）
    let prTimeSeries = prScores.map(p => ({
      time_period: p.time_period,
      time_period_label: TIME_PERIOD_LABELS[p.time_period as TimePeriod] || p.time_period,
      pr_value: p.pr_value,
      pr_rank: p.pr_rank,
      normalized_score: p.normalized_score,
    }));
    let outboundRows: any[] = transResult.results ?? [];
    let inboundRows: any[] = inboundResult.results ?? [];

    // Phase 3A.1/3B：年度／連假 temporal context——只有在 range 完整、且能解析出這一站的
    // canonical station_id 時才覆蓋成該 range 的證據；其餘情況一律維持合成軌道（獨立進入
    // Detail 的既有預設行為）。「2026 春節」context 下絕不偷偷改用月份／年度／synthetic 證據。
    let rangeMeta: {
      range_id: string; range_type: 'year' | 'holiday'; year: number; event_key: string | null; event_name: string | null;
      label: string | null; start_date: string; end_date: string; day_count: number | null;
    } | null = null;
    let rangeError: string | null = null;

    if (rangeTypeParam === 'year' || rangeTypeParam === 'holiday') {
      const isHoliday = rangeTypeParam === 'holiday';
      const year = parseInt(yearStr ?? '', 10);
      if (!yearStr || !Number.isInteger(year)) {
        rangeError = `range_type=${rangeTypeParam} 需要有效的 year 參數`;
      } else if (isHoliday && !eventKeyParam) {
        rangeError = 'range_type=holiday 需要 event_key 參數';
      } else {
        const rangeId = isHoliday ? `holiday:${eventKeyParam}:${year}` : `year:${year}`;
        let holidayName: string | null = null;
        if (isHoliday) {
          const holidayEvent = await getHolidayEvent(c.env.mrt_rank_db, eventKeyParam!, year);
          if (!holidayEvent) {
            rangeError = `找不到連假事件：${eventKeyParam} ${year} 年`;
          } else {
            holidayName = holidayEvent.name_zh;
          }
        }

        if (!rangeError) {
          const dateRange = await getDateRange(c.env.mrt_rank_db, rangeId);
          if (!dateRange) {
            rangeError = isHoliday
              ? `${holidayName}（${year} 年）已登錄，但尚未計算逐日資料覆蓋狀態`
              : `找不到 ${year} 年的旅運資料`;
          } else if (!dateRange.is_complete) {
            rangeError = isHoliday
              ? `${holidayName}（${year} 年）的旅運資料不完整，暫時無法提供連假證據`
              : `${year} 年的旅運資料不完整，暫時無法提供年度證據`;
          } else {
            const canonicalId = await resolveRangeStationId(c.env.mrt_rank_db, id, rangeId);
            if (!canonicalId) {
              rangeError = `此站目前沒有對應的${isHoliday ? '連假' : '年度'}旅運資料`;
            } else {
              const [rangePr, outboundRaw, inboundRaw] = await Promise.all([
                getRangePageRankByStation(c.env.mrt_rank_db, rangeId, canonicalId),
                getRangeOdFlowFrom(c.env.mrt_rank_db, rangeId, canonicalId),
                getRangeOdFlowTo(c.env.mrt_rank_db, rangeId, canonicalId),
              ]);
              if (rangePr.length > 0) {
                prTimeSeries = rangePr.map(p => ({
                  time_period: p.period,
                  time_period_label: TIME_PERIOD_LABELS[p.period as TimePeriod] || p.period,
                  pr_value: p.pr_value,
                  pr_rank: p.pr_rank,
                  normalized_score: p.normalized_score,
                }));
                outboundRows = withTransitionProb(outboundRaw).slice(0, 30);
                inboundRows = withTransitionProb(inboundRaw).slice(0, 20);
                rangeMeta = {
                  range_id: rangeId,
                  range_type: isHoliday ? 'holiday' : 'year',
                  year,
                  event_key: isHoliday ? eventKeyParam! : null,
                  event_name: isHoliday ? holidayName : null,
                  label: dateRange.label,
                  start_date: dateRange.start_date,
                  end_date: dateRange.end_date,
                  day_count: dateRange.day_count,
                };
              } else {
                rangeError = `此站目前沒有對應的${isHoliday ? '連假' : '年度'} PageRank 資料`;
              }
            }
          }
        }
      }
    }

    // 整理偏好雷達資料
    const preferenceCategories = ['attraction', 'food', 'shopping', 'nightlife', 'family'];
    const radarData = {
      labels: ['景點', '美食', '購物', '夜生活', '親子'],
      categories: preferenceCategories,
      availability: preferenceCategories.map(cat => tags.some(t => t.tag_category === cat)),
      scores: preferenceCategories.map(cat => {
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
        outbound: outboundRows,
        inbound: inboundRows,
      },
      metadata: {
        pagerank_source: rangeMeta ? 'range_pagerank' : 'pagerank_scores',
        connection_source: rangeMeta ? 'range_od_flow' : 'transition_matrix',
        data_month: null,
        range_type: rangeMeta ? rangeMeta.range_type : null,
        range: rangeMeta,
        range_error: rangeError,
      },
    });
  } catch (error) {
    return jsonDbError(c, error);
  }
});

export default stationDetail;
