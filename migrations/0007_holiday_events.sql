-- Phase 3B：連假 metadata（人工維護的行事曆事實，不是從 OD CSV 推導）。
-- 純新增：不改動、不刪除既有表。date_ranges.holiday_event_id（migration 0004 已建立，
-- 之前一直是 NULL）從本 migration 起開始被 materialize_holiday_range.py 寫入 event_key。
--
-- (event_key, year) 唯一：同一連假跨年用同一個 event_key（如 'lunar-new-year'），
-- 每年各自一列、各自的 start_date/end_date——跨年比較永遠是 WHERE event_key = ?，
-- 不需要在程式碼裡猜「哪一年的哪幾天算同一個節日」。
CREATE TABLE IF NOT EXISTS holiday_events (
  event_key   TEXT NOT NULL,   -- 跨年穩定識別碼，如 'lunar-new-year'
  year        INTEGER NOT NULL,
  name_zh     TEXT NOT NULL,   -- 顯示名稱，如 '春節'
  start_date  TEXT NOT NULL,   -- ISO date，含
  end_date    TEXT NOT NULL,   -- ISO date，含
  source      TEXT,            -- 邊界依據（如「行政院人事行政總處公告」），production 資料必填
  updated_at  TEXT,
  PRIMARY KEY (event_key, year)
);

CREATE INDEX IF NOT EXISTS idx_holiday_events_key ON holiday_events(event_key);
