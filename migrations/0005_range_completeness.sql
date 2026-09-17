-- ============================================================
-- MetroPulse Phase 3A — date_ranges completeness tracking
-- 純新增欄位（ALTER TABLE ADD COLUMN）：不刪除、不修改既有欄位或資料。
-- 支援年度（未來也適用連假／自訂區間）range 的「完整性」判斷：
-- 只有 is_complete=1 的 range 才能被 /api/recommend、/api/analytics/* 當作可用資料使用，
-- 避免用不完整的年度資料冒充全年、或把缺月份補 0（見 temporal-phase3a-year-implementation.md）。
-- ============================================================

ALTER TABLE date_ranges ADD COLUMN is_complete INTEGER NOT NULL DEFAULT 0;
ALTER TABLE date_ranges ADD COLUMN expected_day_count INTEGER;

-- 既有的 month range（Phase 2A/2B/2C 匯入的月份）維持 is_complete=0（保守預設）。
-- 這些月份本來就一直是透過 /api/recommend 的既有 year/month 參數存取（讀 real_od_flow/real_pagerank），
-- 不經過這個新欄位，因此不需要回填也不影響現有行為；只有 Phase 3A 新增的 range_type='year' 路徑
-- 會檢查這個欄位。
