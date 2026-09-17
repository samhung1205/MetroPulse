-- Phase 3A.1：年度完整性判定改為同時驗證 service_date × period 覆蓋，
-- 新增一個可為 null 的說明欄位，讓「為什麼不完整」有機器產生的具體原因
-- （缺天數，或缺哪一天的哪個 period），不必在 API 即時重新掃 daily_od_flow 才能解釋。
-- 純加欄位，不改動、不刪除既有欄位；is_complete 判定邏輯本身在 materialize_year_range.py。
ALTER TABLE date_ranges ADD COLUMN coverage_note TEXT;
