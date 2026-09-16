-- ============================================================
-- MetroPulse v2 — 真實旅運量資料表
-- 來源：臺北捷運每日分時各站OD流量統計（Azure Blob 公開資料）
-- ============================================================

-- 已匯入月份索引
CREATE TABLE IF NOT EXISTS data_months (
  year       INTEGER NOT NULL,
  month      INTEGER NOT NULL,
  label      TEXT,                  -- 顯示名稱，如 '2026年1月'
  row_count  INTEGER DEFAULT 0,    -- 原始資料筆數
  imported_at TEXT,                -- ISO 8601
  PRIMARY KEY (year, month)
);

-- 真實 OD 流量（按時段彙整，不含逐日明細）
-- e_ij = 整月該時段所有日期的流量加總
CREATE TABLE IF NOT EXISTS real_od_flow (
  from_station_id TEXT NOT NULL,
  to_station_id   TEXT NOT NULL,
  period          TEXT NOT NULL,   -- morning_peak/morning/noon/afternoon/evening_peak/night
  year            INTEGER NOT NULL,
  month           INTEGER NOT NULL,
  flow_count      INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (from_station_id, to_station_id, period, year, month)
);

-- 真實 PageRank（由 Power Method 從真實 OD 資料計算）
CREATE TABLE IF NOT EXISTS real_pagerank (
  station_id      TEXT NOT NULL,
  period          TEXT NOT NULL,
  year            INTEGER NOT NULL,
  month           INTEGER NOT NULL,
  pr_value        REAL NOT NULL,
  pr_rank         INTEGER,
  normalized_score REAL,
  PRIMARY KEY (station_id, period, year, month)
);

-- ============================================================
-- 索引
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_real_od_from
  ON real_od_flow(from_station_id, period, year, month);

CREATE INDEX IF NOT EXISTS idx_real_od_to
  ON real_od_flow(to_station_id, period, year, month);

CREATE INDEX IF NOT EXISTS idx_real_pr_lookup
  ON real_pagerank(period, year, month, pr_rank);

CREATE INDEX IF NOT EXISTS idx_real_pr_station
  ON real_pagerank(station_id, year, month);

CREATE INDEX IF NOT EXISTS idx_data_months
  ON data_months(year DESC, month DESC);
