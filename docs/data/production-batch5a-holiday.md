# MetroPulse — Production Holiday Catalog 正式登錄 + Batch 5A 執行紀錄

日期：2026-09-18
狀態：**production 已完整執行本輪全部項目**。已 INSERT 10 筆正式 holiday metadata、materialize 8 個連假 range（2025×5、2026×3）、完成 Batch 5A（2026-01 maintenance re-import + 2026-02/03/04 新月份匯入）、通過所有 parity 與 pinned baseline 驗證、完成 holiday API smoke test 與跨年比較驗證。未執行 2026-05 以後、未 retention purge、未 deploy。

前置閱讀：[production-holiday-catalog.md](production-holiday-catalog.md)、[year-materialization-production-hotfix.md](year-materialization-production-hotfix.md)、[production-initialization-runbook.md](production-initialization-runbook.md)。

---

## 0. Holiday date safety gate

正式 INSERT 前，10 筆新 event/date（peace-memorial-day、qingming-childrens-day、dragon-boat、mid-autumn、national-day × 2025/2026）已由使用者確認為人工對照 DGPA 官方 PDF/Excel 核實。`new-year-eve` 依既有規劃未納入本輪，列入未來的 Special Overnight Event Analysis（六時段模型丟棄 23:00 與 00:00–06:00，跨年通宵營運需要獨立分析，不修改既有 period architecture）。

---

## 1. Holiday metadata INSERT 結果

10 筆全部成功 INSERT 進 `holiday_events`，無重複、無 test data：

| event_key | year | name_zh | start_date | end_date |
|---|---:|---|---|---|
| peace-memorial-day | 2025 | 和平紀念日 | 2025-02-28 | 2025-03-02 |
| qingming-childrens-day | 2025 | 兒童節及民族掃墓節 | 2025-04-03 | 2025-04-06 |
| dragon-boat | 2025 | 端午節 | 2025-05-30 | 2025-06-01 |
| mid-autumn | 2025 | 中秋節 | 2025-10-04 | 2025-10-06 |
| national-day | 2025 | 國慶日 | 2025-10-10 | 2025-10-12 |
| peace-memorial-day | 2026 | 和平紀念日 | 2026-02-27 | 2026-03-01 |
| qingming-childrens-day | 2026 | 兒童節及清明節 | 2026-04-03 | 2026-04-06 |
| dragon-boat | 2026 | 端午節 | 2026-06-19 | 2026-06-21 |
| mid-autumn | 2026 | 中秋節 | 2026-09-25 | 2026-09-28 |
| national-day | 2026 | 國慶日 | 2026-10-09 | 2026-10-11 |

INSERT 後重新查詢完整 `holiday_events`（12 筆，含既有 `lunar-new-year:2025`/`lunar-new-year:2026`），確認無 duplicate、無 unexpected rows。

---

## 2. 2025 holiday materialization

5 筆全部成功，`is_complete=1`、`range_pagerank=708` 筆、`verify_holiday_parity.py` 全部 PASS：

| event_key:2025 | range_od_flow 筆數 | range_pagerank | parity |
|---|---:|---:|---|
| peace-memorial-day | 66,552 | 708 | ✅ PASS |
| qingming-childrens-day | 67,313 | 708 | ✅ PASS |
| dragon-boat | 66,142 | 708 | ✅ PASS |
| mid-autumn | 66,273 | 708 | ✅ PASS |
| national-day | 66,438 | 708 | ✅ PASS |

既有 `lunar-new-year:2025`（`is_complete=1`）與 `year:2025`（`is_complete=1`，365 天）確認完全不受影響。

---

## 3. Batch 5A — 2026-01 maintenance re-import

生產環境 2026-01 原僅有舊版 legacy monthly 資料（`real_od_flow`/`real_pagerank`），缺 `daily_od_flow` 逐日粒度。優先復用既有已驗證的原始 CSV（`/private/tmp/.../scratchpad/od_202601.csv`，sha256 `74d2374f526e0ab06164820a428242ada24291187b5fd2d06a6dfb91e291abad`，與既有 manifest 記錄逐位元組核對相符），避免重新下載可能已改版的 upstream CSV。

執行：
```
python3 scripts/import_od_data.py --year 2026 --month 1 --csv-file <verified CSV> \
  --apply-remote --db-name mrt-rank-db --maintenance-reimport --archive-to-r2
```

列數核對全部通過（`daily_od_flow` 1,934,412、`range_od_flow` 71,199、`range_pagerank` 708、`real_od_flow` 71,199、`real_pagerank` 708）。

`verify_range_parity.py --year 2026 --month 1 --remote --db-name mrt-rank-db`：**6/6 PASS**。

### Pinned recommendation baseline（BL11 → night → food，year=2026 month=1）

透過 `wrangler dev dist/_worker.js --remote`（本地 Worker、真連 production D1）執行 `verify_recommend_baseline.py`：

| 排名 | 站點 | total_score |
|---:|---|---:|
| 1 | BL12 | 0.79 |
| 2 | BL10 | 0.38 |
| 3 | R11 | 0.38 |
| 4 | BL18 | 0.37 |
| 5 | BL15 | 0.33 |

**結果：PASS，與固定基準完全相符，無 regression。** Batch 5A 繼續執行 2026-02。

---

## 4. 2026-02 / 03 / 04 匯入

依序 import → archive-to-r2 → manifest/checksum → `verify_range_parity.py`，每月皆 **6/6 PASS**：

| 年月 | OD×period 組合 | parity |
|---|---:|---|
| 2026-02 | 71,163 | ✅ 6/6 PASS |
| 2026-03 | 71,242 | ✅ 6/6 PASS |
| 2026-04 | 71,211 | ✅ 6/6 PASS |

---

## 5. 2026 holiday materialization

3 筆全部成功，`is_complete=1`、`range_pagerank=708`、`verify_holiday_parity.py` 全部 PASS：

| event_key:2026 | range_od_flow 筆數 | range_pagerank | parity |
|---|---:|---:|---|
| lunar-new-year | 69,075 | 708 | ✅ PASS |
| peace-memorial-day | 66,564 | 708 | ✅ PASS |
| qingming-childrens-day | 67,032 | 708 | ✅ PASS |

`dragon-boat:2026`（需 2026-06）、`mid-autumn:2026`（需 2026-09）、`national-day:2026`（需 2026-10）與 `year:2026`（年度必然不完整）本輪皆**未**materialize，依規劃留待未來 batch。

---

## 6. Holiday API smoke tests（本地 Worker → production D1 preview）

`GET /api/recommend?...&range_type=holiday&event_key=...&year=...`，9 筆全部 `success:true`、`data_source:real`、`range_type:holiday`、`range_label`/`start_date`/`end_date` 正確：

| event_key:year | range_label | start | end |
|---|---|---|---|
| lunar-new-year:2025 | 2025年春節 | 2025-01-25 | 2025-02-02 |
| peace-memorial-day:2025 | 2025年和平紀念日 | 2025-02-28 | 2025-03-02 |
| qingming-childrens-day:2025 | 2025年兒童節及民族掃墓節 | 2025-04-03 | 2025-04-06 |
| dragon-boat:2025 | 2025年端午節 | 2025-05-30 | 2025-06-01 |
| mid-autumn:2025 | 2025年中秋節 | 2025-10-04 | 2025-10-06 |
| national-day:2025 | 2025年國慶日 | 2025-10-10 | 2025-10-12 |
| lunar-new-year:2026 | 2026年春節 | 2026-02-14 | 2026-02-22 |
| peace-memorial-day:2026 | 2026年和平紀念日 | 2026-02-27 | 2026-03-01 |
| qingming-childrens-day:2026 | 2026年兒童節及清明節 | 2026-04-03 | 2026-04-06 |

`GET /api/analytics/holiday-comparison?event_key=...&period=night&station=BL12`：春節、228、清明兒童節 2025 vs 2026 皆 `success:true`，兩年皆 `status:complete`，無 missing/incomplete 被當成 0 呈現。

---

## 7. production storage summary（Batch 5A checkpoint）

| 指標 | 數值 |
|---|---:|
| daily_od_flow row count | 30,159,619 |
| range_od_flow row count | 1,814,802 |
| range_pagerank row count | 18,408 |
| holiday_events count | 12 |
| date_ranges — holiday | 9（全部 is_complete=1） |
| date_ranges — month | 16 |
| date_ranges — year | 1（is_complete=1，2025） |
| DB file_size | 5,044,736,000 bytes（≈4,810.6 MB） |
| 本輪 storage growth | +1,307,688,960 bytes（≈1,247.5 MB，相對本次會話開始時的 3,737,047,040 bytes） |

覆蓋確認：2025-01～2025-12、2026-01～2026-04 共 16 個月份全部逐日粒度 ✅（`backfill_status.py` 確認 0 個月份缺逐日資料）；2026-01 不再是 legacy-only。

---

## 8. Validation

- Pinned recommendation baseline：PASS（見第 3 節）
- `npm run build`：成功，`dist/_worker.js 210.88 kB`
- `git diff --check`：exit 0

---

## 9. 未執行範圍（明確確認）

- 未執行 2026-05 以後的任何匯入
- 未執行 retention purge
- 未 deploy 網站
- `dragon-boat:2026`／`mid-autumn:2026`／`national-day:2026`／`year:2026` 未 materialize（資料月份尚不足或年度必然不完整）
- `new-year-eve` 未納入，列入未來 Special Overnight Event Analysis
