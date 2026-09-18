# MetroPulse — Batch 5B (2026-05~08) + Final v1 Backfill Checkpoint

日期：2026-09-18
狀態：**production 已完成 v1 backfill 全部範圍**（2025-01～2025-12、2026-01～2026-08，共 20 個月）。Dragon Boat 2026 已 materialize。未執行 2026-09 以後任何匯入、未 retention purge、未 deploy、未 materialize `year:2026`。

前置閱讀：[production-batch5a-holiday.md](production-batch5a-holiday.md)、[production-initialization-runbook.md](production-initialization-runbook.md)、[year-materialization-production-hotfix.md](year-materialization-production-hotfix.md)。

---

## 1. 2026-05 import / parity

`import_od_data.py --year 2026 --month 5 --apply-remote --db-name mrt-rank-db --archive-to-r2`：成功，`range_id=month:2026-05`，71,247 筆 OD、708 筆 PageRank。

`verify_range_parity.py --year 2026 --month 5 --remote`：**6/6 PASS**。

---

## 2. 2026-06 import / parity

第一次嘗試遇到 Cloudflare API 暫時性錯誤（`Upstream service unavailable [code: 7009]`），發生在遠端匯入階段、尚未寫入任何資料即失敗（無 partial write，符合單一檔案原子性設計）。重新執行同一指令後乾淨成功：`range_id=month:2026-06`，71,190 筆 OD、708 筆 PageRank。

`verify_range_parity.py --year 2026 --month 6 --remote`：**6/6 PASS**。

---

## 3. Dragon Boat 2026 materialization

2026-05 與 2026-06 皆匯入且 parity PASS 後，依 production metadata（`2026-06-19 ~ 2026-06-21`）materialize：

- `materialize_holiday_range.py --event-key dragon-boat --year 2026 --remote`：✅ 3 天完整、66,260 筆 OD、**708 筆 PageRank**、`is_complete=1`。
- `verify_holiday_parity.py --event-key dragon-boat --year 2026 --remote`：**PASS**（OD 守恆、118/118 站全站 PageRank、pr_rank 完整排列、normalized_score 端點正確，六個時段全數通過）。

### Dragon Boat 2025 vs 2026 holiday-comparison smoke test

`GET /api/analytics/holiday-comparison?event_key=dragon-boat&period=night&station=BL12`：`success:true`，兩年皆 `status:complete`（2025 day_count=3 pr_value=0.06136263；2026 day_count=3 pr_value=0.06302177），無 missing/incomplete 被當 0。

---

## 4. 2026-07 import / parity

`range_id=month:2026-07`，71,211 筆 OD、708 筆 PageRank。`verify_range_parity.py --year 2026 --month 7 --remote`：**6/6 PASS**。

---

## 5. 2026-08 import / parity

`range_id=month:2026-08`，72,433 筆 OD、708 筆 PageRank。`verify_range_parity.py --year 2026 --month 8 --remote`：**6/6 PASS**。

---

## 6. R2 / manifest

4 個月全部 `r2_upload_status: success`，checksum 與 `bytes_read_matches_content_length` 皆正確：

| 年月 | R2 object key | distinct_service_dates |
|---|---|---:|
| 2026-05 | raw/202605/od_202605_c4a7ce82ed748d13.csv | 31 |
| 2026-06 | raw/202606/od_202606_efd4a84235dc325f.csv | 30 |
| 2026-07 | raw/202607/od_202607_1e331e0e4aa704b2.csv | 31 |
| 2026-08 | raw/202608/od_202608_fa17140855d4984e.csv | 31 |

---

## 7. Final 20-month backfill status

`backfill_status.py --remote --db-name mrt-rank-db`：**20 個月份，0 個月份缺逐日粒度資料**（2025-01～2025-12、2026-01～2026-08 全部 ✅）。

`date_ranges` 交叉確認：

| range_type | 筆數 | is_complete=1 |
|---|---:|---:|
| month | 20 | 0（月度 range 的 `is_complete` 欄位語意向來與逐日覆蓋判定分開記錄，`backfill_status.py` 才是以 `daily_od_flow` 實際覆蓋為準的判定依據——此行為在 Batch 5A 之前即已存在，非本輪新增，20 個月的逐日覆蓋已由上方 backfill_status 結果獨立確認完整） |
| year | 1 | 1（僅 `year:2025`，`day_count=365=expected_day_count`） |
| holiday | 10 | 10（見下方明細） |

**`year:2026` 確認不存在**（`date_ranges` 查無此列），不可能被誤標為 complete——正確行為，本輪未 materialize。

`holiday_events`：12 筆，無 `test-holiday`／`test-compare`／`new-year-eve`／未確認日期。

| event_key | 2025 | 2026 |
|---|---|---|
| lunar-new-year | ✅ materialized | ✅ materialized |
| peace-memorial-day | ✅ materialized | ✅ materialized |
| qingming-childrens-day | ✅ materialized | ✅ materialized |
| dragon-boat | ✅ materialized | ✅ materialized（本輪新增） |
| mid-autumn | ✅ materialized | metadata only（需 2026-09） |
| national-day | ✅ materialized | metadata only（需 2026-10） |

---

## 8. API smoke tests（本地 Worker → production D1 preview）

| 類型 | 查詢 | success | data_source | 備註 |
|---|---|---|---|---|
| Monthly | range_type=month, 2026-08 | ✅ true | real | data_year=2026 data_month_num=8 |
| Year | range_type=year, 2025 | ✅ true | real | range_label=2025年（全年）, is_complete=true |
| Holiday | range_type=holiday, dragon-boat:2026 | ✅ true | real | 2026-06-19～2026-06-21, is_complete=true |
| Analytics pagerank | month/year/holiday 各一條 | ✅ true ×3 | real ×3 | — |

Holiday-comparison（4 組，皆 `success:true`，兩年皆 `status:complete`）：

| event_key | 2025 pr_value | 2026 pr_value |
|---|---:|---:|
| lunar-new-year | 0.06570583 | 0.06448252 |
| peace-memorial-day | 0.0629903 | 0.06031804 |
| qingming-childrens-day | 0.06527293 | 0.06519565 |
| dragon-boat | 0.06136263 | 0.06302177 |

---

## 9. Pinned recommendation baseline（BL11 → night → food，2026-01）

| 排名 | 站點 | total_score |
|---:|---|---:|
| 1 | BL12 | 0.79 |
| 2 | BL10 | 0.38 |
| 3 | R11 | 0.38 |
| 4 | BL18 | 0.37 |
| 5 | BL15 | 0.33 |

**結果：PASS，與固定基準完全相符，無 regression。** Latest-month smoke check 同步確認已正確抓到 2026-08 為最新月份。

`npm run build`：成功，`dist/_worker.js 210.88 kB`。`git diff --check`：exit 0。

---

## 10. Production storage summary

| 指標 | Batch 5A 結束時 | Batch 5B 結束時 | 本輪成長 |
|---|---:|---:|---:|
| daily_od_flow row count | 30,159,619 | 37,801,761 | +7,642,142 |
| range_od_flow row count | 1,814,802 | 2,167,143 | +352,341 |
| range_pagerank row count | 18,408 | 21,948 | +3,540（4 個月 + 1 個連假 = 5 × 708） |
| holiday_events count | 12 | 12 | 0（dragon-boat:2026 metadata 已於 Batch 5A 登錄，本輪未新增 INSERT） |
| DB file_size | 5,044,736,000 bytes | 6,303,059,968 bytes | +1,258,323,968 bytes（≈1,200.1 MB） |

成長幅度與 Batch 5A（4 個月 + 5 個連假、≈1,247.5 MB）同量級、線性，**無不合理非線性成長**，未觸發停止條件。

---

## 11. 尚待處理的 2026 連假

| event_key | 需要月份 | 狀態 |
|---|---|---|
| mid-autumn:2026 | 2026-09 | metadata 已登錄，等待未來月份匯入後 materialize |
| national-day:2026 | 2026-10 | metadata 已登錄，等待未來月份匯入後 materialize |

`year:2026` 需等 2026-12 全年資料到齊才可 materialize，目前僅 Jan-Aug，明確不完整、未標示為 complete。

---

## 12. 未執行範圍（明確確認）

- 未執行 2026-09 以後任何匯入
- 未執行 retention purge
- 未 deploy 網站
- 未 materialize `year:2026`
- 未 materialize `mid-autumn:2026`／`national-day:2026`

---

## READY FOR FINAL PRODUCTION DATA GATE

v1 backfill（2025-01～2026-08，共 20 個月）已全數完成，逐日粒度、月度 range、年度 range（2025）、8 個連假 range（2025×5、2026×3）全部通過 parity/correctness 驗證，pinned baseline 無 regression，R2/manifest/checksum 正常，storage 成長線性、無異常。**READY.**
