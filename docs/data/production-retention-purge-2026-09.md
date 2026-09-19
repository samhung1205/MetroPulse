# MetroPulse — Production Retention Purge (2026-09)

日期：2026-09-19
狀態：**PURGE COMPLETED**。`daily_od_flow` 已成功清除 18 個月保留窗口外的 4,739,203 列（2025-01-01～2025-03-18），全部驗證通過。未 merge、未 push、未 deploy。

前置閱讀：[final-production-data-gate.md](final-production-data-gate.md)、[deployment-preflight.md](../deployment/deployment-preflight.md)、[production-batch5b-final-backfill.md](production-batch5b-final-backfill.md)、[year-materialization-production-hotfix.md](year-materialization-production-hotfix.md)。

---

## 0. 前情提要：三次單一指令嘗試皆失敗

上一輪（見 git 歷史）記錄了三次以單一 `DELETE FROM daily_od_flow WHERE service_date < cutoff` 執行 purge 的嘗試，全部失敗於同一個可重現的 Cloudflare D1 基礎設施限制：

```json
{"error": {"text": "...", "notes": [{"text": "D1 DB exceeded its CPU time limit and was reset. [code: 7429]"}], "code": 7429}}
```

三次嘗試皆確認未造成任何 partial write（`daily_od_flow` 列數在每次失敗前後完全相同）。Cloudflare 官方文件（`developers.cloudflare.com/d1/observability/debug-d1/`）對此錯誤的建議動作是「Split the query into smaller shards」。本輪據此修正 `scripts/retention.py`，把 purge 改為分批執行。

---

## 1. Retention.py 分批 hotfix

修改 `scripts/retention.py`（不改變既有 CLI 用法，`--purge --remote --db-name mrt-rank-db` 一如既往可用，新增可選的 `--batch-days`，預設 7）：

- purge 語意不變：仍然只刪除 `service_date < cutoff` 範圍內的 `daily_od_flow` 列。
- 內部把單一大範圍 DELETE 拆成連續的 `[batch_start, batch_end)` 區間，逐批各自獨立送出、獨立 commit，預設每批 7 天。
- 既有 unmaterialized-range guard（`find_unmaterialized_ranges_at_risk`）完全保留、行為不變——仍在分批執行前一次性檢查整個 cutoff 範圍，任一連假／年度未完整 materialize 就拒絕執行（除非 `--acknowledge-unmaterialized-ranges`）。
- 每批印出日期範圍與實際刪除列數；任一批失敗會在該批次資訊印出後立即中止（`d1_exec` 遇錯即 `sys.exit(1)`），清楚看到卡在哪一天。
- **Rerun-safe**：批次排程的起點一律取「這次執行當下」`daily_od_flow` 實際最早日期（`scope['earliest']`，每次重新查詢），不是寫死的固定值——若某次執行只完成一部分就中斷，重新執行時會自動從剩下的資料接續，不會重複刪除，也不需要人工指定從哪裡續跑。
- 範圍限制不變：唯一 DELETE 目標仍是 `daily_od_flow`，未新增任何觸及 `range_od_flow`／`range_pagerank`／`date_ranges`／`holiday_events`／`real_od_flow`／`real_pagerank`／`data_months`／`stations` 的路徑。
- 修正一個連帶發現的小 bug：local wrangler 的 `meta` 不含 `changes` 欄位（只有 remote 才有），舊版單一 DELETE 邏輯原本就有 fallback，分批版本一開始沒處理好、在本地測試時把「不知道刪了幾列」誤報成「刪了 0 列」——已改為明確印出「本地未回報確切列數」而不是靜默顯示 0（production/remote 執行不受影響，remote 一律正確回報 `changes`）。

**EXPLAIN QUERY PLAN 確認**：對批次查詢的日期條件（`service_date >= ? AND service_date < ?`）執行 `EXPLAIN QUERY PLAN`，確認走既有索引 `idx_daily_od_date(service_date, period)` 的 index seek（`SEARCH daily_od_flow USING INDEX idx_daily_od_date (service_date>? AND service_date<?)`），不是 full table scan。**未新增任何索引**——既有索引已經足夠。

---

## 2. Hotfix 驗證（本地 / disposable 環境，未動 production）

在本地既有的大型測試複本（22.7M 列，2024-06～2026-06 的真實規模 fixture）上驗證：

| 驗證項目 | 結果 |
|---|---|
| dry-run 輸出格式與既有邏輯 | ✅ 不變，含既有 guard 警告正常觸發（`year:2024` 未 materialize 時正確攔截） |
| 分批邊界無 gap／無 overlap | ✅ 3 個連續小規模測試（3 天批次、7 天批次）皆確認相鄰批次首尾銜接、最後一批精確截斷於 cutoff |
| cutoff 計算 | ✅ 與修改前完全相同（`months_ago()` 未變動） |
| Rerun-safe：完整跑完後重跑 | ✅ 第二次執行正確顯示「0 列——目前沒有任何資料落在保留窗口之外」，未重複刪除、未報錯 |
| Rerun-safe：延伸 cutoff 後重跑 | ✅ 批次排程正確從「上次執行後的實際剩餘最早日期」重新開始，不是從原始起點 |
| 永久表保護 | ✅ 每次測試後 `real_od_flow`／`range_od_flow`／`range_pagerank`／`date_ranges`／`data_months` 列數與操作前逐一比對完全相同 |

`npm run build`：✅ PASS（`dist/_worker.js 210.88 kB`）。`git diff --check`：✅ exit 0。

---

## 3. Production safety（正式 purge 前）

重新取得 D1 Time Travel bookmark（供必要時 restore）：

| 項目 | 值 |
|---|---|
| 取得時間（UTC） | `2026-09-19T04:54:33Z` |
| bookmark | `00000083-00000000-000050eb-90d282d818e59f3b13b0917762f06043` |

重新執行 dry-run，確認與先前完全一致，無任何意外變化：

| 項目 | 值 |
|---|---|
| cutoff | 2025-03-19 |
| 預計刪除範圍 | 2025-01-01 ~ 2025-03-18 |
| 預計刪除列數 | 4,739,203（與前一輪完全相同） |
| unmaterialized range at risk | 0（無警告） |

---

## 4. Production purge 執行結果

```
python3 scripts/retention.py --purge --remote --db-name mrt-rank-db
```

單一指令，內部分 11 批（每批 7 天）依序執行，**全部成功**：

| 批次 | 日期範圍（不含右界） | 刪除列數 |
|---:|---|---:|
| 1 | 2025-01-01 ~ 2025-01-08 | 430,698 |
| 2 | 2025-01-08 ~ 2025-01-15 | 436,561 |
| 3 | 2025-01-15 ~ 2025-01-22 | 436,715 |
| 4 | 2025-01-22 ~ 2025-01-29 | 412,285 |
| 5 | 2025-01-29 ~ 2025-02-05 | 402,904 |
| 6 | 2025-02-05 ~ 2025-02-12 | 436,561 |
| 7 | 2025-02-12 ~ 2025-02-19 | 436,414 |
| 8 | 2025-02-19 ~ 2025-02-26 | 437,460 |
| 9 | 2025-02-26 ~ 2025-03-05 | 433,362 |
| 10 | 2025-03-05 ~ 2025-03-12 | 438,455 |
| 11 | 2025-03-12 ~ 2025-03-19 | 437,788 |

**總計刪除：4,739,203 列**——與 dry-run 預估**完全相符**。腳本內建的操作前／後永久表列數比對（`real_od_flow`／`real_pagerank`／`range_od_flow`／`range_pagerank`／`date_ranges`／`data_months`）確認完全相同，未觸發任何 CRITICAL 警告。

---

## 5. Post-purge database verification

| 檢查 | 結果 |
|---|---|
| `daily_od_flow` 總列數 | **33,062,558**（37,801,761 − 4,739,203，精確相符） |
| `daily_od_flow` MIN(service_date) | **2025-03-19** |
| `daily_od_flow` MAX(service_date) | **2026-08-31**（未變） |
| `service_date < 2025-03-19` 的剩餘列數 | **0** |
| `range_od_flow` | 2,167,143（purge 前後完全相同） |
| `range_pagerank` | 21,948（purge 前後完全相同） |
| `date_ranges` | 31（purge 前後完全相同） |
| `holiday_events` | 12（purge 前後完全相同） |
| `year:2025` | `is_complete=1`（未變） |
| 2025 全部 6 個 holiday range | `is_complete=1`（未變） |
| 2026 全部 4 個已 materialize holiday range | `is_complete=1`（未變） |

---

## 6. Post-purge correctness tests（本地 Worker → production D1 preview）

| 測試 | 結果 |
|---|---|
| Pinned baseline（BL11→night→food, 2026-01） | ✅ PASS：BL12 0.79／BL10 0.38／R11 0.38／BL18 0.37／BL15 0.33，完全相符，latest-month smoke 正確抓到 2026年8月 |
| **`month:2025-01` recommendation** | ✅ **PASS**（`success:true`，`range_label:2025年1月`）——**關鍵驗證**：該月份的逐日資料已被 purge，但 `range_od_flow`／`range_pagerank`（永久月度聚合）不受影響，查詢功能完全正常，證明 daily purge 不會破壞歷史月度產品功能 |
| `month:2026-08` recommendation | ✅ PASS |
| `year:2025` recommendation | ✅ PASS（`is_complete:true`） |
| `holiday:peace-memorial-day:2025` recommendation | ✅ PASS（`is_complete:true`） |
| `holiday:dragon-boat:2026` recommendation | ✅ PASS（`is_complete:true`） |
| Holiday comparison（`lunar-new-year`） | ✅ PASS（2025／2026 皆 `status:complete`） |

Post-purge retention dry-run（guard 確認）：

```
[範圍] 窗口外（service_date < 2025-03-19），將會被刪除（dry-run，尚未執行）：
  0 列——目前沒有任何資料落在保留窗口之外。
沒有需要清理的資料，結束。
```

**確認目前已無可刪資料**。

---

## 7. Storage

| 時間點 | DB file_size |
|---|---:|
| Purge 前 | 6,303,059,968 bytes |
| Purge 後 | 5,594,787,840 bytes |
| 差異 | −708,272,128 bytes（約 −675 MB，占 4,739,203／37,801,761 ≈ 12.5% 的 `daily_od_flow` 列數比例大致吻合） |

如實記錄：本次 D1 在 purge 後**確實立即回報了較小的 file_size**（未執行、也不需要執行任何 `VACUUM`／rebuild／額外 storage maintenance）。這不是判定 purge 成功與否的依據——判定依據仍是第 4～6 節的刪除列數、保留日期範圍與永久聚合完整性，file_size 下降只是這次觀察到的附帶結果。

---

## 8. Build / Git 完整性

`npm run build`：✅ PASS。`git diff --check`：✅ exit 0。retention 操作（D1 DELETE）未造成任何 source code 變更；本輪對 `scripts/retention.py` 的修改屬於獨立的 hotfix commit，非 purge 操作本身產生的副作用。

---

## 未變動範圍（明確確認）

- 未執行 Time Travel restore。
- 未 merge、未 push、未 deploy。
- 未修改 PageRank 演算法、gamma、normalization、recommender scoring、period definitions。
- 未新增任何索引。
- 未執行 VACUUM 或其他 storage maintenance。
