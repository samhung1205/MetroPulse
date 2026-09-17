-- ============================================================
-- MetroPulse Phase 2A — Daily temporal foundation + generalized range engine
-- 純新增：不刪除、不修改 data_months / real_od_flow / real_pagerank
-- 現有 API（/api/recommend、/api/analytics/*）仍讀舊表，本次遷移對外行為無影響。
-- 詳見 docs/data/temporal-architecture-design.md 的 Proposed schema。
-- ============================================================

-- 逐日 OD 流量（依現有 6 段 period 分桶，不存逐小時；理由見架構設計文件）
CREATE TABLE IF NOT EXISTS daily_od_flow (
  from_station_id TEXT NOT NULL,
  to_station_id   TEXT NOT NULL,
  service_date    TEXT NOT NULL,   -- ISO 8601 'YYYY-MM-DD'
  period          TEXT NOT NULL,   -- 沿用既有 6 段時段代碼，語意不變
  flow_count      INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (from_station_id, to_station_id, service_date, period)
);

CREATE INDEX IF NOT EXISTS idx_daily_od_date ON daily_od_flow(service_date, period);
CREATE INDEX IF NOT EXISTS idx_daily_od_from ON daily_od_flow(from_station_id, service_date, period);

-- 任何時間範圍的「身分證」：本階段只寫入 range_type='month' 的列
CREATE TABLE IF NOT EXISTS date_ranges (
  range_id          TEXT PRIMARY KEY,   -- 'month:2026-01' 格式；未來 year/holiday/custom 沿用同一組表
  range_type        TEXT NOT NULL,      -- 本階段僅 'month'
  start_date        TEXT NOT NULL,      -- ISO date，含；取自該月實際有資料的最早日期
  end_date          TEXT NOT NULL,      -- ISO date，含；取自該月實際有資料的最晚日期
  holiday_event_id  TEXT,               -- 本階段未使用，保留給 Phase 3
  label             TEXT,               -- 顯示名稱，如 '2026年1月'
  day_count         INTEGER,            -- 該範圍內實際有 daily_od_flow 資料涵蓋的天數
  computed_at       TEXT                -- range_pagerank/range_od_flow 最後一次計算時間
);

-- 通用聚合結果：任何 range_id 都寫進同一組表，本階段只有 month 一種 range_type
CREATE TABLE IF NOT EXISTS range_od_flow (
  range_id        TEXT NOT NULL REFERENCES date_ranges(range_id),
  from_station_id TEXT NOT NULL,
  to_station_id   TEXT NOT NULL,
  period          TEXT NOT NULL,
  flow_count      INTEGER NOT NULL,
  PRIMARY KEY (range_id, from_station_id, to_station_id, period)
);

CREATE TABLE IF NOT EXISTS range_pagerank (
  range_id         TEXT NOT NULL REFERENCES date_ranges(range_id),
  station_id       TEXT NOT NULL,
  period           TEXT NOT NULL,
  pr_value         REAL NOT NULL,
  pr_rank          INTEGER,
  normalized_score REAL,
  PRIMARY KEY (range_id, station_id, period)
);

CREATE INDEX IF NOT EXISTS idx_range_pr_lookup ON range_pagerank(range_id, period, pr_rank);
CREATE INDEX IF NOT EXISTS idx_range_od_from   ON range_od_flow(range_id, from_station_id, period);
