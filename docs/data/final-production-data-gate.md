# MetroPulse — Final Production Data Gate

日期：2026-09-19
狀態：**PASS**。確認 production `mrt-rank-db` 資料完整性、retention 安全性（僅 dry-run）、無 test data。未執行 purge、未 merge、未 push、未 deploy。

前置閱讀：[production-batch5b-final-backfill.md](production-batch5b-final-backfill.md)、[production-batch5a-holiday.md](production-batch5a-holiday.md)、[year-materialization-production-hotfix.md](year-materialization-production-hotfix.md)、[temporal-final-gate.md](temporal-final-gate.md)、[production-initialization-runbook.md](production-initialization-runbook.md)。

---

## 1. Final production data gate

### Monthly daily granularity

`backfill_status.py --remote --db-name mrt-rank-db`：**20 個月份，0 個月份缺逐日粒度資料**——2025-01～2025-12、2026-01～2026-08 全部 ✅。

### Year

| range_id | is_complete | day_count |
|---|---:|---:|
| year:2025 | 1 | 365 |

**`year:2026` 確認不存在於 `date_ranges`**（`range_type='year'` 只有一列，即 `year:2025`）——不可能被誤標為 complete，正確行為。

### Holiday

`date_ranges` 中 `range_type='holiday'` 共 10 列，全部 `is_complete=1`：

| event_key | 2025 | 2026 |
|---|---|---|
| lunar-new-year | ✅ complete | ✅ complete |
| peace-memorial-day | ✅ complete | ✅ complete |
| qingming-childrens-day | ✅ complete | ✅ complete |
| dragon-boat | ✅ complete | ✅ complete |
| mid-autumn | ✅ complete | metadata only（`holiday_events` 已登錄，`date_ranges` 無對應列，未 materialize——需 2026-09） |
| national-day | ✅ complete | metadata only（同上，需 2026-10） |

`holiday_events` 共 **12 筆**，逐筆檢查 `source` 欄位：全部可追溯至行政院人事行政總處官方公告 URL，**無 `test-holiday`／`test-compare`／`new-year-eve`／未確認日期**。

**無 unexpected ranges**：`date_ranges` 總筆數 31（month 20 + year 1 + holiday 10），與 20 個月匯入 + 1 個年度 + 10 個連假的預期完全吻合，無多餘列。

**結論：FINAL PRODUCTION DATA GATE — PASS。**

---

## 2. Final validation（重用既有充分證據，未重跑全量 destructive test）

| 項目 | 結果 |
|---|---|
| `backfill_status.py --remote` | ✅ 20/20 月份完整 |
| `verify_recommend_baseline.py`（本地 Worker → production D1，BL11→night→food, 2026-01） | ✅ PASS，BL12 0.79／BL10 0.38／R11 0.38／BL18 0.37／BL15 0.33 完全相符；latest-month smoke check 正確抓到 2026年8月 |
| Representative month parity：`verify_range_parity.py --year 2026 --month 8 --remote` | ✅ 6/6 PASS |
| `verify_year_parity.py --year 2025 --remote` | ✅ PASS（OD 守恆、118/118 站全站 PageRank、六時段全數通過） |
| Representative holiday：`verify_holiday_parity.py --event-key national-day --year 2025 --remote` | ✅ PASS |
| Month API smoke（`range_type=month&year=2026&month=8`） | ✅ success:true, data_source:real |
| Year API smoke（`range_type=year&year=2025`） | ✅ success:true, data_source:real, range_label=2025年（全年） |
| Holiday API smoke（`range_type=holiday&event_key=national-day&year=2025`） | ✅ success:true, data_source:real, range_label=2025年國慶日 |
| Holiday comparison smoke（`event_key=lunar-new-year`） | ✅ success:true，2025／2026 皆 status:complete |
| `npm run build` | ✅ 成功，`dist/_worker.js 210.88 kB` |
| `git diff --check` | ✅ exit 0 |

未重新執行全量 20 個月逐月 parity、全部 10 個連假逐一 parity、或 remote hardening destructive test（降級防護、purge 攔截）——這些已在 Batch 5A/5B 與 temporal-final-gate.md 各自取得充分證據，本輪只做代表性抽測與必要的新項目複驗。

---

## 3. Retention DRY RUN（僅 dry-run，未 purge）

```
python3 scripts/retention.py --dry-run --remote --db-name mrt-rank-db
```

```
保留窗口：18 個月　基準日：2026-09-19　cutoff（含當天保留）：2025-03-19

窗口外（將被刪除，service_date < 2025-03-19）：
  4,739,203 列，涵蓋 3 個月份（2025-01-01 ~ 2025-03-18）

窗口內（將保留，service_date >= 2025-03-19）：
  33,062,558 列（2025-03-19 ~ 2026-08-31）
```

- **哪些 daily dates／月份超過 18-月窗口**：2025-01-01～2025-03-18（涵蓋 2025-01、2025-02 全月＋2025-03 前 18 天）。
- **預計刪除列數**：4,739,203 列（`daily_od_flow`，唯一 DELETE 目標）。
- **預計保留日期範圍**：2025-03-19～2026-08-31（33,062,558 列）。
- **year / holiday permanent range 保護**：`year:2025`（涵蓋整個 2025 年，含窗口外的 1～3 月）與 `peace-memorial-day:2025`（2025-02-28～2025-03-02，落在窗口外）皆已於 Batch 5A 完整 materialize（`is_complete=1`），對應的 `range_od_flow`／`range_pagerank` 是獨立永久表，不受 `daily_od_flow` purge 影響——**保護成功**。
- **unmaterialized range at risk**：**無**。腳本本次 dry-run 未印出任何「偵測到尚未 materialize、且會被這次 purge 波及的 range」警告——因為窗口外唯一涉及的連假（peace-memorial-day:2025）與涵蓋該窗口的年度（year:2025）皆已完整 materialize。exit code 0，無需 `--acknowledge-unmaterialized-ranges`。
- **估計可釋放 storage**：4,739,203 列 ≈ `daily_od_flow` 總列數（37,801,761）的 **12.5%**；以此比例粗估，若執行 purge 約可釋放 DB file_size 的同等級占比（**粗估數百 MB～約 0.8GB**，實際視 SQLite 頁面回收與索引結構而定，非精確值）。

**Guard 判定：無風險，非 blocker。** 本輪僅執行 dry-run，未執行任何 `--purge`。

---

## 未變動範圍（明確確認）

- 未執行 `retention.py --purge`
- 未 merge、未 push
- 未 deploy
- 未修改任何 production 資料（本文件全程為唯讀查詢 + dry-run）
