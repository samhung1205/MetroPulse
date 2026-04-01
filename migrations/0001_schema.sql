-- ============================================================
-- MRT Rank 台北捷運智慧推薦系統 — 資料庫結構定義
-- ============================================================

-- 1. stations — 捷運站基本資料
CREATE TABLE IF NOT EXISTS stations (
  id TEXT PRIMARY KEY,                          -- 站點代碼，如 'BL12', 'R10'
  name_zh TEXT NOT NULL,                        -- 中文名稱
  name_en TEXT,                                 -- 英文名稱
  line TEXT NOT NULL,                           -- 主線代碼：BL/R/G/O/BR/Y
  line_name TEXT,                               -- 路線中文名
  line_color TEXT,                              -- 路線顏色 hex，如 '#0070BD'
  station_number INTEGER,                       -- 站序號
  latitude REAL,                                -- 緯度
  longitude REAL,                               -- 經度
  is_transfer_station INTEGER DEFAULT 0,        -- 是否為轉乘站 (0/1)
  transfer_lines TEXT,                          -- 可轉乘路線 JSON '["BL","R"]'
  district TEXT,                                -- 所在行政區
  address TEXT                                  -- 地址
);

-- 2. pagerank_scores — 各時段 PageRank 分數
CREATE TABLE IF NOT EXISTS pagerank_scores (
  station_id TEXT NOT NULL,                     -- 站點代碼
  time_period TEXT NOT NULL,                    -- 時段：morning_peak/morning/noon/afternoon/evening_peak/night
  pr_value REAL NOT NULL,                       -- 原始 PageRank 值
  pr_rank INTEGER,                              -- 該時段排名
  normalized_score REAL,                        -- Min-Max 正規化 [0,1]
  PRIMARY KEY (station_id, time_period),
  FOREIGN KEY (station_id) REFERENCES stations(id)
);

-- 3. transition_matrix — 站間轉移機率
CREATE TABLE IF NOT EXISTS transition_matrix (
  from_station_id TEXT NOT NULL,                -- 起點站
  to_station_id TEXT NOT NULL,                  -- 終點站
  time_period TEXT NOT NULL,                    -- 時段
  raw_flow INTEGER DEFAULT 0,                   -- 原始人流量
  transition_prob REAL NOT NULL,                -- 轉移機率 (含 damping)
  normalized_prob REAL,                         -- 正規化 [0,1]
  PRIMARY KEY (from_station_id, to_station_id, time_period),
  FOREIGN KEY (from_station_id) REFERENCES stations(id),
  FOREIGN KEY (to_station_id) REFERENCES stations(id)
);

-- 4. station_tags — 站點偏好標籤
CREATE TABLE IF NOT EXISTS station_tags (
  station_id TEXT NOT NULL,                     -- 站點代碼
  tag_category TEXT NOT NULL,                   -- 標籤：attraction/food/shopping/nightlife/family
  tag_score REAL NOT NULL DEFAULT 0,            -- 分數 [0,1]
  tag_reason TEXT,                              -- 推薦理由描述
  PRIMARY KEY (station_id, tag_category),
  FOREIGN KEY (station_id) REFERENCES stations(id)
);

-- 5. travel_costs — 站間旅行成本
CREATE TABLE IF NOT EXISTS travel_costs (
  from_station_id TEXT NOT NULL,
  to_station_id TEXT NOT NULL,
  station_count INTEGER NOT NULL,               -- 經過站數
  transfer_count INTEGER DEFAULT 0,             -- 轉乘次數
  estimated_time INTEGER,                       -- 預估時間（分鐘）
  cost_score REAL,                              -- 正規化成本 [0,1]
  PRIMARY KEY (from_station_id, to_station_id),
  FOREIGN KEY (from_station_id) REFERENCES stations(id),
  FOREIGN KEY (to_station_id) REFERENCES stations(id)
);

-- ============================================================
-- 索引 — 加速查詢效能
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_stations_line ON stations(line);
CREATE INDEX IF NOT EXISTS idx_stations_name ON stations(name_zh);
CREATE INDEX IF NOT EXISTS idx_pr_period ON pagerank_scores(time_period);
CREATE INDEX IF NOT EXISTS idx_pr_station ON pagerank_scores(station_id);
CREATE INDEX IF NOT EXISTS idx_transition_from ON transition_matrix(from_station_id, time_period);
CREATE INDEX IF NOT EXISTS idx_transition_to ON transition_matrix(to_station_id, time_period);
CREATE INDEX IF NOT EXISTS idx_tags_station ON station_tags(station_id);
CREATE INDEX IF NOT EXISTS idx_tags_category ON station_tags(tag_category);
CREATE INDEX IF NOT EXISTS idx_cost_from ON travel_costs(from_station_id);
