# MetroPulse — Production Initialization Runbook

日期：2026-09-18
狀態：**待執行的正式 runbook**，本文件本身未對 production `mrt-rank-db` 寫入、未部署網站。
前置閱讀：[production-data-preparation.md](production-data-preparation.md)（inventory、holiday 研究、disposable rehearsal 證據）、[temporal-final-gate.md](temporal-final-gate.md)、`scripts/verify_recommend_baseline.py`。

本文件是 [production-data-preparation.md](production-data-preparation.md) 規劃的**逐步執行版本**：每一步都有明確的指令、預期結果與 stop condition。**不要把 20 個月一口氣無人監督執行**——整個 backfill 拆成 5 個 batch，每個 batch 跑完都要人工檢視結果再繼續下一批。任何一步出現非預期結果，依該步驟的 stop condition 停下來，先排除問題再繼續，不要跳過或忽略錯誤繼續往下跑。

**v1 範圍（已於 Production Preflight 正式確認，見 production-data-preparation.md 3.3／2.2.1 節）**：
- Backfill：**2025-01 ～ 2026-08**（20 個月）。
- Holiday metadata：**`lunar-new-year:2025`、`lunar-new-year:2026`**。**不**登錄 2023／2024（明確排除，留 future backfill）。
- 完成後**不得宣稱**支援 2023／2024 春節或跨年比較——v1 上線時春節比較只有 2025／2026 兩年可用。

---

## Phase 0：執行前必要確認（stop condition：任一項未完成就不得進入 Phase 1）

| # | 項目 | 如何確認 | Stop condition |
|---|---|---|---|
| 0.1 | Cloudflare 帳號方案確認為 Workers Paid（D1 18 個月保留窗口需要） | 人工在 Cloudflare Dashboard 確認 | 未確認 Paid plan → **不得執行任何一步**，先解決帳務問題 |
| 0.2 | 春節 2025／2026 日期人工複核（見下方 SQL） | 人工從 [DGPA 114年公告](https://www.dgpa.gov.tw/information?uid=82&pid=11972) 與 [DGPA 115年公告](https://www.dgpa.gov.tw/information?uid=41&pid=12573) 下載官方 PDF／Excel 原始檔，逐字核對 2025-01-25~2025-02-02（9天）與 2026-02-14~2026-02-22（9天） | 官方原始檔案日期與下方 SQL 不符 → 先修正 SQL 中的日期，不得用未複核的日期執行 Phase 2 |
| 0.3 | 確認目前 production 狀態（起點基準線） | `npx wrangler d1 list` | `mrt-rank-db` 的 `file_size` 應為 `9,187,328 bytes`（僅 schema+seed，尚無任何 temporal 資料）；若不是這個值，代表已經有資料寫入過，**停止**並先確認現況與本 runbook 的假設是否還成立 |

---

## Phase 1：Bootstrap

**指令**：
```bash
python3 scripts/bootstrap_db.py --remote --db-name mrt-rank-db
```

**預期結果**：三步驟（migrations apply → seed.sql → migrations apply）全部完成，最後印出：
```json
{
  "stations": 136,
  "has_daily_od_flow": 1,
  "has_date_ranges": 1,
  "has_range_od_flow": 1,
  "has_range_pagerank": 1
}
✅ Bootstrap 完成
```

**Stop condition**：任一驗證欄位不是預期值（`stations` 應 > 0，其餘四項應為 `1`）→ 停止，不得繼續 Phase 2。這是唯一一次直接對 production 執行 migrations，失敗必須先排除，不得重試跳過驗證步驟。

---

## Phase 2：Holiday metadata 登錄（v1 只有這兩筆）

**前提**：Phase 0.2 已完成人工複核。

**指令**：
```bash
npx wrangler d1 execute mrt-rank-db --remote --command "INSERT INTO holiday_events (event_key, year, name_zh, start_date, end_date, source, updated_at) VALUES ('lunar-new-year', 2025, '春節', '2025-01-25', '2025-02-02', '行政院人事行政總處 中華民國114年（西元2025年）政府行政機關辦公日曆表 https://www.dgpa.gov.tw/information?uid=82&pid=11972', '2026-09-18T00:00:00')"

npx wrangler d1 execute mrt-rank-db --remote --command "INSERT INTO holiday_events (event_key, year, name_zh, start_date, end_date, source, updated_at) VALUES ('lunar-new-year', 2026, '春節', '2026-02-14', '2026-02-22', '行政院人事行政總處 中華民國115年（西元2026年）政府行政機關辦公日曆表 https://www.dgpa.gov.tw/information?uid=41&pid=12573', '2026-09-18T00:00:00')"
```

**預期結果**：兩次 `INSERT` 皆回報 `"success": true"`，`"changes": 1"`。

**驗證**：
```bash
npx wrangler d1 execute mrt-rank-db --remote --json --command "SELECT event_key, year, start_date, end_date FROM holiday_events ORDER BY year"
```
應只回傳這兩筆，日期與 Phase 0.2 複核結果逐字相符。

**Stop condition**：回傳筆數不是 2、或日期與官方原始檔不符 → 停止，`DELETE FROM holiday_events WHERE event_key='lunar-new-year'` 清空重來，不得帶著錯誤資料繼續。**不得**登錄任何 `test-holiday`／`test-compare` 或 2023/2024 的列（見 production-data-preparation.md 2.4 節）。

---

## Phase 3：分批月份匯入（5 個 batch，每批跑完才進下一批）

每個月份的**單一步驟**（每個 batch 對其涵蓋的每個月重複這個步驟）：

```bash
python3 scripts/import_od_data.py --year <Y> --month <M> --apply-remote \
  --db-name mrt-rank-db --archive-to-r2
```

**預期結果**（每個月）：
- 若 2026-01／2026-08 之外的月份：完整下載（約 280~340MB）→ 解析 → 寫入 `real_od_flow`/`real_pagerank`/`daily_od_flow`/`range_od_flow`/`range_pagerank`（`range_type='month'`）→ manifest 印出 `r2_upload_status: "success"`。
- 2026-01：可用 `--csv-file` 指向已封存在 R2 的副本（`raw/202601/od_202601_74d2374f526e0ab0.csv`，先用 `wrangler r2 object get` 下載），略過重新下載；checksum 應與 manifest 記錄的 `74d2374f526e0ab0...` 相符。
- 2026-08：同理可用 `raw/202608/od_202608_fa17140855d4984e.csv`。

**每個月匯入後立即執行**（per-month parity，stop condition 內建）：
```bash
python3 scripts/verify_range_parity.py --year <Y> --month <M> --remote --db-name mrt-rank-db
```
**Stop condition**：六項檢查任一項 `FAIL` → **立刻停止整個 batch**，不得匯入下一個月份。先排除這個月份的問題（重新下載、重新匯入），parity 全數 `PASS` 才能繼續同一 batch 剩下的月份。

### Batch 1／5：2025 Q1（2025-01, 2025-02, 2025-03）

匯入這三個月，每月都跑上面的 import + parity 步驟。

**Batch 結束檢查點（人工審核，不得自動跳過）**：
```bash
python3 scripts/backfill_status.py --remote --db-name mrt-rank-db
```
確認 2025-01／02／03 皆顯示「逐日粒度：✅ 有」。**人工確認這三個月的資料看起來合理**（例如透過 `wrangler d1 execute --remote --command "SELECT year, month, row_count FROM data_months ORDER BY year, month"` 檢查列數量級與其他月份相近，約 4.4M 上下）後才進 Batch 2。

**此時可嘗試連假 materialize**（2025-01、2025-02 皆已匯入，涵蓋春節 2025 的 2025-01-25~2025-02-02）：
```bash
python3 scripts/materialize_holiday_range.py --event-key lunar-new-year --year 2025 --remote --db-name mrt-rank-db
```
**預期結果**：完整（`is_complete=1`），寫入 `range_od_flow`/`range_pagerank`。**Stop condition**：若回報不完整，檢查 2025-01／02 的 `daily_od_flow` 是否確實涵蓋 2025-01-25~2025-02-02 這 9 天（可能是其中某天資料被 CSV 來源跳過，需要個別排查，不是 materialize 腳本的問題）。

### Batch 2／5：2025 Q2（2025-04, 2025-05, 2025-06）

同上流程（import + parity，逐月）。Batch 結束檢查點同上（`backfill_status.py`）。

### Batch 3／5：2025 Q3（2025-07, 2025-08, 2025-09）

同上流程。

### Batch 4／5：2025 Q4（2025-10, 2025-11, 2025-12）

同上流程。**這個 batch 結束後，2025 全年 12 個月首次全部到齊**，執行 2025 年度最終 materialize：

```bash
python3 scripts/materialize_year_range.py --year 2025 --remote --db-name mrt-rank-db
```

**預期結果（2025 final year materialization）**：`✅ 2025 年已標記為完整年度，range_od_flow/range_pagerank 已寫入`，`day_count` 應為 365（2025 非閏年）。

**Stop condition**：若回報「不完整」，用輸出的 `coverage_note` 找出缺哪一天／哪個 period，回頭排查對應月份的匯入是否有缺漏（可能是某個月的來源 CSV 本身有缺口，不一定是匯入腳本的問題），修正後重跑本步驟，**不得**帶著「2025 年度不完整」的狀態進入 Batch 5——之後若真的重跑，務必留意 `scripts/materialize_year_range.py` 已內建「拒絕降級已完整 range」的安全閘門（見 temporal-final-audit.md），正常情況下不會意外觸發。

### Batch 5／5：2026 Jan-Aug（2026-01, 2026-02, ..., 2026-08，共 8 個月）

同上流程（import + parity，逐月；2026-01／08 可用第 3 節說明的 R2 既有封存加速）。

**2026-02 匯入完成後**，執行春節 2026 的 holiday materialize：
```bash
python3 scripts/materialize_holiday_range.py --event-key lunar-new-year --year 2026 --remote --db-name mrt-rank-db
```
預期完整（涵蓋 2026-02-14~22）。Stop condition 同 Batch 1 的春節 2025 步驟。

**8 個月全部完成後**，年度 `year:2026`（只有 1~8 月）**必然**回報不完整（v1 backfill 本來就不含 9~12 月）——這是**預期、正確**的狀態，不是錯誤，不需要排查，也不應該加 `--force` 或任何方式讓它「看起來完整」。可選擇性執行一次確認這個預期行為：
```bash
python3 scripts/materialize_year_range.py --year 2026 --remote --db-name mrt-rank-db
```
應回報「8/365 天，不完整」且不寫入 `range_*`。

---

## Phase 4：API smoke tests（透過真正的 HTTP 端點，部署前先驗證）

**方法**：比照 disposable rehearsal 的做法，暫時把 `wrangler.jsonc` 的 `mrt_rank_db` binding 指向 production 的 `database_id`（本來就是，不需要改，因為這次目標本來就是 production），用 `wrangler dev dist/_worker.js --remote` 起一個**本地**伺服器連到 production D1，在部署網站前先確認 API 行為正確：

```bash
npm run build
npx wrangler dev dist/_worker.js --remote --port 8788 --compatibility-date 2026-04-01 --compatibility-flags nodejs_compat
```

**測試矩陣（另開一個終端機執行 curl）**：

| 檢查 | 指令 | 預期結果 | Stop condition |
|---|---|---|---|
| 月份列表 | `curl http://localhost:8788/api/analytics/months` | `success:true`，列出 20 個月份（2025-01~2026-08） | 月份數不是 20 → 停止，對照 Phase 3 的 `backfill_status.py` 找出缺哪個月 |
| 月度推薦（最新月份） | `curl "http://localhost:8788/api/recommend?from=BL12&time_period=afternoon&preference=all"` | `success:true`，`data_source:real`，`data_month:2026年8月` | `data_month` 不是 2026年8月 → 停止，檢查 `data_months` 表 |
| 年度推薦 2025 | `curl "http://localhost:8788/api/recommend?from=BL12&time_period=afternoon&preference=all&range_type=year&year=2025"` | `success:true`，`range_label:2025年（全年）` | 回 404 → 停止，回頭確認 Phase 3 Batch 4 的 2025 年度 materialize 是否真的成功（不是「看起來成功」） |
| 連假推薦 2025 春節 | `curl "http://localhost:8788/api/recommend?from=BL12&time_period=afternoon&preference=all&range_type=holiday&event_key=lunar-new-year&year=2025"` | `success:true`，`range_label` 含「2025」與「春節」 | 404 → 檢查 Phase 3 Batch 1 的連假 materialize 步驟 |
| 連假推薦 2026 春節 | `curl "http://localhost:8788/api/recommend?from=BL12&time_period=afternoon&preference=all&range_type=holiday&event_key=lunar-new-year&year=2026"` | `success:true`，`range_label` 含「2026」與「春節」 | 404 → 檢查 Phase 3 Batch 5 的連假 materialize 步驟 |
| 連假跨年比較 | `curl "http://localhost:8788/api/analytics/holiday-comparison?event_key=lunar-new-year&period=morning_peak&station=BL12"` | `success:true`，`years` 陣列有 2 筆，皆 `status:complete` | 筆數不是 2、或有 `status` 不是 `complete` → 停止排查 |
| 年度排名 2026（預期不完整） | `curl -o /dev/null -w "%{http_code}\n" "http://localhost:8788/api/recommend?from=BL12&time_period=afternoon&preference=all&range_type=year&year=2026"` | `404`（v1 只有 8 個月，這是預期行為） | 若回 `200` → **停止並深入排查**——代表某個安全閘門被繞過，不完整年度不應該能被查詢到 |

測試完成後 `Ctrl+C` 停止 `wrangler dev`，這一步**不是** deploy，只是本地連到 production D1 的預覽，不會改變任何 production 網址或使用者看到的內容。

---

## Phase 5：Pinned recommendation baseline

**指令**（沿用 Phase 4 起的 `wrangler dev --remote` 本地伺服器；若已關閉，重新啟動）：
```bash
python3 scripts/verify_recommend_baseline.py --base-url http://localhost:8788
```

**預期結果**：
- **固定基準**（`BL11→night→food`，明確帶 `year=2026&month=1`）：全部 `PASS`——`range_label` 確認為 `2026年1月`，Top5 為 `BL12 0.79 / BL10 0.38 / R11 0.38 / BL18 0.37 / BL15 0.33`。這組分數綁定 2026-01 這個特定月份的真實資料，Phase 3 已經匯入這個月，理論上應該與本地 dev D1（同樣是真實 2026-01 資料）算出完全相同的值。
- **Latest-month smoke check**（不帶年月，查最新月份 2026-08）：`PASS`——只確認 `success`／`data_source=real`／筆數 ≥5，**不**比對固定分數（2026-08 的真實排序與分數本來就與 2026-01 不同，這是正常現象）。

**Stop condition**：
- 若**固定基準** FAIL 且 `range_label` 顯示的不是 `2026年1月`（代表查詢意外退回了其他月份）→ 停止，這是嚴重的資料路徑問題，不是正常的資料差異。
- 若**固定基準** FAIL 但 `range_label` 確實是 `2026年1月`（代表 2026-01 這個月的真實計算結果與本地 dev D1 不同）→ 停止，這代表 production 匯入的 2026-01 資料與本地驗證過的版本不一致，需要用 `verify_range_parity.py --year 2026 --month 1 --remote --db-name mrt-rank-db` 進一步排查，**不得**忽略這個差異就繼續部署。
- 若 latest-month smoke check FAIL（`success` 不是 `true` 或筆數 <5）→ 停止，代表最新月份（2026-08）的真實資料路徑本身有問題。

---

## Phase 6：Production data inventory 最終驗證

```bash
python3 scripts/backfill_status.py --remote --db-name mrt-rank-db
```
**預期結果**：20 個月（2025-01~2026-08）全部顯示「逐日粒度：✅ 有」，`day_count` 皆為該月實際天數。

```bash
npx wrangler d1 execute mrt-rank-db --remote --json --command "SELECT range_type, COUNT(*) as c, SUM(is_complete) as complete_c FROM date_ranges GROUP BY range_type"
```
**預期結果**：
- `range_type='month'`：20 筆（`complete_c` 欄位對月份型 range 沒有實質意義，月份完整性走既有 `data_months` 邏輯，不看這裡的 `is_complete`，見 temporal-final-audit.md 對 `month:2026-01` 的既有 P2 記錄）。
- `range_type='year'`：至少 2 筆（`2025` 與 `2026`），`2025` 應 `is_complete=1`，`2026` 應 `is_complete=0`（8 個月不完整，預期行為，見 Phase 3 Batch 5 說明）。
- `range_type='holiday'`：2 筆，皆 `is_complete=1`。

**Stop condition**：任一數字與預期不符 → 對照本 runbook 對應 Phase 重新核對，不得在 inventory 有缺口的狀態下視為「初始化完成」。

**最終確認**：
```bash
npx wrangler d1 list
```
`mrt-rank-db` 的 `file_size` 應該從基準值 `9,187,328 bytes` 明顯成長（20 個月真實資料量級，參考 Phase 2A 實測：每月約 300MB daily 粒度 + 較小的月度/年度/連假聚合表，20 個月量級預期在數 GB 範圍——具體數字以實際查詢結果為準，不預先假設，若成長幅度明顯不合理則需要排查是否有未預期的重複匯入）。

---

## 完成後的下一步（本 runbook 範圍外）

- 部署網站（`npm run deploy:prod`）：本文件不涵蓋，需要另一輪明確授權才能執行。
- 之後每月新資料：依 production-data-preparation.md 第 5.1 節「每月新資料流程」（import → archive → year materialize attempt → holiday materialize → baseline/smoke check），不需要重跑本 runbook 全部步驟。
- Retention 排程：依 production-data-preparation.md 第 5.2 節，先 `--dry-run`，人審核後才 `--purge`。
- 2023／2024 春節與年度的 future backfill：需要另一輪獨立規劃與人工授權，本 runbook 不涵蓋。
