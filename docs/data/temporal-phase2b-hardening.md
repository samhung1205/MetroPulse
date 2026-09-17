# MetroPulse — Temporal Phase 2B: Operational Hardening

日期：2026-09-17
狀態：已在**可拋棄的 remote 測試資料庫**上完整驗證，測試資料庫已刪除；**未動 production remote 資料庫、未 deploy**
前置閱讀：[temporal-architecture-design.md](temporal-architecture-design.md)、[temporal-phase1-implementation.md](temporal-phase1-implementation.md)、[temporal-phase2a-implementation.md](temporal-phase2a-implementation.md)

本階段目標：在開始 year / holiday / custom range 功能前，把 Phase 2A 建立的 daily temporal foundation 做到可安全長期維運。**沒有新增任何 user-facing 功能，沒有改 UI**，所有變更集中在 `scripts/import_od_data.py`（新增 `--db-name` 參數與 provenance 欄位）與兩支新增的維運工具腳本。

---

## 0. 測試方法說明

第 1 節的所有動作都在一個**臨時建立、測試完立即刪除**的 remote D1 資料庫 `mrt-rank-db-phase2b-test` 上執行（`database_id=f2662c68-13e3-4316-b48c-98c7c60a8112`），**完全沒有對正式的 `mrt-rank-db`（`database_id=2105f85a-...`）做任何寫入或刪除**。為了讓 `wrangler d1 migrations apply` 認得這個臨時資料庫（該指令需要資料庫已登記在 `wrangler.jsonc` 才能運作，不像 `d1 execute` 可以直接用資料庫名稱），過程中暫時在 `wrangler.jsonc` 加了一個對應的 binding 項目；測試結束後已確認 `git diff wrangler.jsonc` 為空（完全還原），測試資料庫本身也已用 `wrangler d1 delete` 刪除。

---

## 1. Remote D1 findings

### 1.1 Migration —— 發現一個先前未暴露的隱性相依

在全新的 remote 資料庫上依序套用 `migrations/0001` ~ `0004`：`0001`、`0002` 成功，**`0003_add_r01_guangci.sql` 失敗**：

```
✘ FOREIGN KEY constraint failed: SQLITE_CONSTRAINT (extended: SQLITE_CONSTRAINT_FOREIGNKEY)
```

原因：`0003` 會 `INSERT INTO travel_costs` 一批引用其他既有站點（`BL12`、`BL11`、`R11` 等）的列，但這些站點的基礎資料**不是由任何一份 migration 建立的**——它們來自專案根目錄的 `seed.sql`（`npm run db:seed`），這是一個**獨立於 migrations 系統之外、需要另外手動執行的步驟**。本地開發資料庫因為很久以前已經跑過 `db:seed`，`stations` 表一直有資料，這個相依關係從未在本地暴露過；但一個全新的資料庫（僅套用 migrations、未跑 seed）會在 `0003` 卡住。

**驗證結果**：這次失敗**沒有留下任何殘餘資料**——失敗後查詢 `stations` 表是空的（`R01` 沒有被插入），`0004` 因為排在失敗的 `0003` 之後，wrangler 自動跳過、完全沒有嘗試套用。這本身就是「migration 失敗時，wrangler 會在該檔案失敗處停止，不會用錯誤狀態繼續套用後續 migration」的正面驗證。

**解法**：對這個測試資料庫先執行 `wrangler d1 execute mrt-rank-db-phase2b-test --remote --file=./seed.sql`，補上 117+1 個站點的基礎資料，再重跑 `wrangler d1 migrations apply`——`0003`、`0004` 隨即成功套用。

**這是一個需要在 Phase 3 前處理的維運缺口**：任何未來要建立全新環境（災難復原、CI 用的一次性測試環境、或另一個區域的 D1 副本）的人，如果只知道「跑 migrations」而不知道 `seed.sql` 必須先/一併執行，會在 `0003` 卡住且錯誤訊息（FK constraint failed）不會直接告訴他們「你漏了 seed.sql」。這不是 Phase 2A/2B 引入的新問題——它從 `0003` 加入 R01 站點時就存在，只是從未在乾淨環境被驗證過。

### 1.2 Full import —— 成功

第一次在測試資料庫執行完整匯入（2026-01 fixture，含 `real_*`＋`daily_od_flow`＋`range_*`，合併單一 100MB SQL 檔）：**成功**，`wrangler` 回報 `Executed 75928 queries`，`rows_written: 8241002`。匯入後逐表核對列數，全部與本地端 Phase 2A 的數字完全一致（`daily_od_flow=1,934,412`／`range_od_flow=71,199`／`range_pagerank=708`／`real_od_flow=71,199`），對這個 remote 資料庫重跑 `verify_range_parity.py --remote` 六項檢查全數 PASS，最大誤差 `0.000e+00`（見第 4 節完整輸出）。

### 1.3 Failed-file rollback / atomicity —— 驗證兩次，方式不同，結論一致

**第一次（刻意構造）**：把一個語法錯誤的陳述式塞進**真實產生的 75,951 行、100MB 匯入檔案正中間**（不是縮小版測試檔），對 remote 執行。結果：

```
Note: if the execution fails to complete, your DB will return to its original state and you can safely retry.
✘ [ERROR] near "syntax": syntax error at offset 158: SQLITE_ERROR
```

`wrangler` 自己在錯誤發生前就先印出了這個保證。匯入前後比對 `daily_od_flow` 列數、`range_pagerank` 的 `BL11`/`night` 值、`date_ranges.computed_at`：**全部沒有變化**，刻意注入的髒資料（`from_station_id='NOPE'`）查詢結果是 0 筆。

**第二次（意外真實發生，見 1.5）**：對已經有資料的月份重新匯入時，wrangler CLI 因為用戶端輪詢逾時回報失敗（不是 SQL 錯誤）。獨立比對 `data_months.imported_at`（這個值是在 SQL **生成當下**寫死進 SQL 文字裡的時間戳，不是執行時才決定）：失敗後這個值仍是**第一次成功匯入**時的舊值，證明第二次的整個檔案（包含它已經處理到的 7 萬多筆陳述式）完全沒有任何部分提交，重現了與刻意構造測試相同的「全有或全無」結果。

**結論**：Phase 2A 只在本地驗證過的「單一檔案匯入具原子性」，在 remote D1 上**也成立**，而且是在一次刻意構造、一次真實意外的失敗下都得到相同結果，不是單一巧合。

### 1.4 Re-import idempotency —— 成立，但發現一個真實的操作邊界

對已經有完整一個月資料（1,934,412 筆 `daily_od_flow`）的 remote 資料庫重新執行同一份匯入，**用戶端連續失敗兩次**，訊息相同：

```
✘ [ERROR] Cancelled due to no poll() received in 15000ms. Latest messages:
    Processed 71964 queries.
```

診斷：獨立執行一個只有 `DELETE FROM daily_od_flow WHERE service_date BETWEEN ...` 的單一陳述式（對已有 1,934,412 列的表）：

```
"sql_duration_ms": 21378.12   -- 21.4 秒
```

**根因確認**：`daily_od_flow` 的月度 DELETE，在表已經有近 200 萬列時，單一陳述式執行時間（21.4 秒）**超過了 wrangler CLI 內建、寫死在程式碼裡的 15 秒靜默逾時**——這個逾時屬於「非同步匯入工作」（`d1 execute --file`，用輪詢方式回報進度）這條路徑特有的用戶端行為，**不是** D1 伺服器端限制（同一個 DELETE 陳述式透過同步的 `d1 execute --command` 執行完全沒有觸發任何逾時，正常回傳成功）。第一次匯入不會遇到這個問題，是因為當時表是空的，DELETE 幾乎瞬間完成；**只有「重新匯入一個已經有資料的月份」才會觸發**，而且隨著 `daily_od_flow` 未來累積更多月份，DELETE 掃描與刪除的資料量還會再放大（雖然 DELETE 的 WHERE 條件已經限定在單一曆月範圍內，不會隨其他月份增加而變慢，但單一個月本身的列數如果隨資料密度成長，仍可能讓這個 21 秒繼續往上升）。

**驗證用戶端逾時不等於資料損毀**：兩次逾時後立即查證，`daily_od_flow`／`range_*`／`data_months.imported_at` 全部維持在**第一次成功匯入**的狀態，未見任何部分寫入——與 1.3 節的原子性結論完全一致，這只是「操作失敗」，不是「資料不一致」。

**修復方向確認可行、但刻意不做成預設行為**：把 `daily_od_flow` 的 DELETE 從主檔案抽出、改用同步的 `--command` 單獨送出（同步路徑沒有這個 15 秒輪詢限制），INSERT 部分維持走 `--file`（每批次 500 列，陳述式本身都很快，不會觸發逾時）。**手動驗證過這個拆分後的流程可以完整跑完**（清空 `daily_od_flow` 後重新匯入耗時 133 秒，`sql_duration_ms: 132779.4`），idempotency 結果與第一次匯入完全一致（`pr_value` 相同、`computed_at` 正確更新為新時間戳、`verify_range_parity.py --remote` 六項全 PASS）。

但**沒有把這個拆分做成 ETL 的預設行為**：拆成兩個獨立的 `wrangler` 呼叫，代表 DELETE 與後續 INSERT 不再屬於同一個交易——如果 DELETE 成功、後續 INSERT 那個檔案又遇到真正的錯誤（不是逾時，是實質失敗），資料庫會停在「舊資料已刪、新資料還沒進來」的半套狀態，這正是 Phase 2A 用單一檔案設計要避免的問題。在沒有更完整的復原機制（例如失敗時自動重試 INSERT、或先備份被刪除的列）之前，用「偶爾對大月份重匯會被用戶端逾時擋下（但資料永遠安全）」換「拆檔案但引入半套狀態風險」，不是一個好交易。這個取捨與三個可能的修復方向記錄在第 6 節，留給 Phase 3 決定。

### 1.5 小結

| 驗證項目 | 結果 |
|---|---|
| Migration（全新環境） | 發現 `0003` 隱性依賴 `seed.sql`（第一次執行時失敗），補跑 `seed.sql` 後成功；失敗過程無殘留 |
| Full import | 成功，逐表列數與本地完全一致 |
| Failed-file rollback | 刻意構造＋真實意外各驗證一次，皆完整回滾、零殘留 |
| Re-import idempotency | 成立（資料/PR 值/parity 皆與首次匯入一致），但用戶端會在大表 DELETE 情境下逾時，已根因診斷並記錄修復方向（未預設啟用） |

---

## 2. Import performance

以下時間全部是這個 fixture（2026-01，31 天，`daily_od_flow` 1,934,412 列）在**本次實測**得到的數字，不是估計值；同一操作在不同次執行間出現的差異也如實記錄，不挑單次最好的結果當標準。

| 操作 | 環境 | 次數 | 結果 |
|---|---|---|---|
| CSV 解析＋雙管線資料結構建立 | 本機 | 2 次（本地/遠端各一次生成） | 4.50s / 5.18s |
| SQL 生成（`real_*`＋`daily_od_flow`＋`range_*`，含 6 期 PageRank 兩次計算） | 本機 | 2 次 | 1.16s / 1.22s（生成階段總和） |
| Range 聚合（Python 端 SUM，模擬 SQL GROUP BY） | 本機 | 2 次 | 0.16s / 0.17s |
| **完整匯入（空表，`d1 execute --file`）** | 本地 D1 | 1 次 | 51.96s |
| **完整匯入（空表，`d1 execute --file`）** | 遠端 D1 | 1 次 | 327.0s（wrangler 回報的 `sql_duration_ms`）／346.6s（含腳本本身的 CSV 讀取與 SQL 生成的總牆鐘時間） |
| **重新匯入（表已有 1,934,412 列）** | 本地 D1 | 1 次 | 114.90s（成功） |
| **重新匯入（表已有 1,934,412 列）** | 遠端 D1，未拆分 DELETE | 2 次 | **兩次皆因用戶端輪詢逾時失敗**（見 1.4）；伺服器端已處理到 71,964／75,928 個陳述式時逾時 |
| **重新匯入（表已有 1,934,412 列）** | 遠端 D1，DELETE 拆分後 | 1 次 | 133.0s（成功） |
| 獨立 `DELETE FROM daily_od_flow`（範圍涵蓋 1,934,412 列） | 遠端 D1，同步 `--command` | 1 次 | **21.4s**（根因所在） |
| 獨立 `SUM(flow_count) GROUP BY from,to,period`（1,934,412 列 → 71,199 列結果） | 本地 D1 | 1 次（Phase 2A） | 1,515ms |
| `verify_range_parity.py`（6 項檢查，全部逐筆比對） | 本地 D1 | 1 次 | 完整腳本 <5s |
| `verify_range_parity.py`（6 項檢查，全部逐筆比對） | 遠端 D1 | 1 次 | 完整腳本 10.7s |

**觀察到的分布特徵，不當作 SLA**：
- 本地「完整匯入」耗時在兩次獨立執行間有 52s→115s 的差距（同一份資料、同一台機器），推測與當下磁碟/CPU 資源爭用有關，Phase 2A 文件已記錄過這個變異。
- 遠端「完整匯入」（空表）耗時約為本地的 3-6 倍（327s vs 52-115s），符合預期（網路往返、跨資料中心延遲）。
- 遠端「重新匯入」在**未拆分 DELETE**的情境下對這個資料量**已知會可靠地觸發**用戶端逾時（兩次獨立嘗試、完全相同的失敗點），不是偶發的邊界情況——這代表隨著匯入月份增加、`daily_od_flow` 持續成長，這個逾時只會更容易發生，不會自己消失。
- 沒有把任何單次數字寫成「保證幾秒完成」的效能承諾；這裡記錄的是「觀察到的量級與分布」，供之後決定要不要投資更完善的匯入客戶端（見第 6 節）時參考。

---

## 3. Provenance / archival strategy

### 3.1 Manifest 正式化（schema version 2）

`generate_manifest()`（[scripts/import_od_data.py](../../scripts/import_od_data.py)）新增 `manifest_schema_version` 欄位（現在是 `2`；Phase 2A 產出的 manifest 沒有這個欄位，視為隱含的 version 1），並補齊以下欄位，使每次 import 至少記錄：

| 欄位 | 內容 |
|---|---|
| `source_url` | 這次匯入的來源 URL（即使用 `--csv-file` 略過下載，仍記錄理論上對應的 URL，方便追溯） |
| `year` / `month` | 匯入的年月 |
| `downloaded_at_or_read_at` / `imported_at` | 下載（或讀取本地檔案）時間戳／實際寫入 D1 完成的時間戳 |
| `row_count_raw` / `row_count_mapped` | 原始資料列數／成功對應到站碼且落在時段內的列數 |
| `distinct_service_dates` / `service_date_range` | 實際涵蓋的日期數與起訖（即「imported date coverage」） |
| `checksum_sha256_etl_computed` | **本專案信任的完整性依據**：ETL 自己在串流讀取時逐 chunk 計算的 SHA-256 |
| `bytes_read` / `upstream_content_length` / `bytes_read_matches_content_length` | 新增：實際接收位元組數、伺服器宣告的 `Content-Length`、兩者是否相符——這是判斷「下載有沒有被截斷」的依據 |
| `upstream_content_md5_header` / `upstream_last_modified_header` | 新增：**只保留供比對追蹤，明確不作為完整性驗證依據**（理由見下） |
| `db_name` | 新增：這次匯入寫入的是哪個 D1 資料庫（正式庫或測試庫），避免事後無法分辨 manifest 對應哪個環境 |

### 3.2 為什麼不信任 upstream Content-MD5

Phase 2A 已經發現來源伺服器回傳的 `Content-MD5` 標頭與檔案實際內容的 SHA-256／MD5 都對不上（兩次獨立下載後比對位元組完全一致，證明不是下載損毀）。Phase 2B 把這個結論**寫進 manifest 本身的 `checksum_note` 欄位**（而不只是文件裡的一段敘述），並且新增 `bytes_read_matches_content_length` 作為**另一個獨立的下載完整性依據**（比對接收位元組數與伺服器宣告的 `Content-Length`，這個標頭在本次觀察中是可信的，只有 `Content-MD5` 不可信）——manifest 現在同時記錄「用什麼驗證完整性」與「為什麼不用另一個看起來也可以驗證完整性的欄位」，避免未來的維運者重新踩到同一個坑。

### 3.3 Raw source preservation：manifest-first，不引入新的雲端服務

現況：原始 CSV（本次 fixture 291 MB）在整個 ETL 流程中**只存在於本機暫存路徑**，處理完就沒有任何地方保留副本——如果之後想用不同邏輯重新處理同一個月份的資料（例如未來要改成保留逐小時粒度），唯一的辦法是回頭向上游重新下載，而上游檔案本身**可能已經被更新過**（Phase 2A 已經實測發現同一個月份的 CSV 在兩次下載之間內容有變化，見 [temporal-phase2a-implementation.md](temporal-phase2a-implementation.md) 第 4 節）。

**本階段的立場**：不自行引入新的雲端物件儲存（例如自動把每個月的 CSV 上傳到 R2）。原因：這是一個會持續產生儲存成本、需要生命週期管理決策（保留多久、誰可以存取）的基礎設施決定，不應該在一次「hardening」任務裡順手做掉；而且目前完全不知道實際會不會有人需要「用不同邏輯重新處理歷史 CSV」這個情境發生的頻率，過早建置可能是浪費。

**最低風險的可行方案（本階段完成的部分）**：
1. **Manifest 是目前唯一、且已經完整化的來源記錄**——每次匯入都留下可回溯「這批資料來自哪個 URL、哪個時間點下載、SHA-256 是多少、涵蓋哪些日期」的紀錄，即使原始檔案本身沒有留存，至少能證明「這份資料曾經以這個 checksum 存在過」，未來若真的重新下載到同一個月份、且 checksum 不同，可以立刻知道上游資料變過（就像 Phase 2A 發現的那次一樣）。
2. **建議但未實作**：如果之後確定需要長期保留原始 CSV，Cloudflare R2 是最低摩擦的選項——因為帳號已經在用 Cloudflare（D1、Pages），不需要導入新的雲端供應商，R2 對外流出免費（不像多數物件儲存會收 egress 費用），且可以用生命週期規則自動把舊檔案轉冷儲存或到期刪除，不需要另外設計刪除排程。**這只是一個建議方向，本階段沒有建立任何 R2 bucket，也沒有寫任何上傳程式碼**——是否要做，屬於「原始資料要保留多久、值不值得付這筆儲存成本」的產品/預算決策，本文件不代為決定。
3. 如果暫時不想引入 R2，次低成本的替代方案是**把每月下載到的 CSV 手動或用簡單腳本存放到一個團隊控管的本機/NAS 目錄**（不進 git，因為單一檔案就是 291 MB），manifest 裡的 `source_local_path` 欄位已經預留了記錄這類路徑的位置。這個方案零額外雲端成本，但沒有異地備援、也仰賴人工紀律維持目錄完整。

---

## 4. Backfill workflow

新增 [scripts/backfill_status.py](../../scripts/backfill_status.py)：對每個 `data_months` 裡已存在的月份，回報它是否已經有對應的 `daily_od_flow` 逐日粒度（透過檢查 `date_ranges` 是否有 `range_type='month'` 且 `range_id` 對應的列），輸出範例：

```
年月        月加總資料         逐日粒度        day_count   range 最後計算時間
----------------------------------------------------------------------
2025-11      ✅ 有           ❌ 缺         —           —
2026-01      ✅ 有           ✅ 有         31          2026-09-17T00:15:43

共 2 個月份，其中 1 個月份缺逐日粒度資料。

缺逐日粒度的月份（backfill 候選）：
  python3 scripts/import_od_data.py --year 2025 --month 11 --csv-file <該月 CSV 路徑> --apply-local
```

（以上是對本地開發資料庫的真實輸出：`2025-11` 是 Phase 1 用手寫 SQL 直接灌入的合成測試月份，從未經過本階段的 ETL，因此正確地被標示為「缺逐日粒度」；`2026-01` 是本階段實際匯入的月份，正確顯示 `day_count=31`。）

### 標準 backfill 流程（滿足「指定月份／不覆蓋其他月份／可辨識已有逐日粒度／可驗證 parity」四項要求）

1. `python3 scripts/backfill_status.py [--remote --db-name <目標庫>]` —— 確認目標月份目前確實缺逐日資料，避免重工。
2. 取得該月原始 CSV（見第 3 節 provenance／archival 策略：重新下載，或使用已封存的本地副本）。
3. **先在本地 D1 驗證**：`python3 scripts/import_od_data.py --year Y --month M --csv-file <path> --apply-local`。
4. `python3 scripts/verify_range_parity.py --year Y --month M` —— 確認新舊管線在這個月份完全等價（全站逐筆比對，非只看 Top 5）。
5. 確認無誤後才對目標 remote 資料庫執行同樣的匯入：`--db-name <目標庫> --apply-remote`（**指定月份**：`--year`/`--month` 是必填參數，且 DELETE 範圍嚴格限定在該曆月，Phase 2A／2B 都已反覆驗證**不影響其他月份**）。
6. `python3 scripts/backfill_status.py --remote --db-name <目標庫>` —— 確認該月份狀態已更新為「已有逐日資料」，`day_count`／`computed_at` 合理。

**本階段沒有真的回補任何歷史年份**（只用 2026-01 這一個 fixture 月份做端到端驗證），符合任務範圍；上面的流程對「未來要不要、要回補到哪一年」這個決策保持中立，只確保工具本身在被使用時是安全、可重跑、可驗證的。

---

## 5. Storage assessment

### 5.1 官方目前的 D1 限制（查閱 Cloudflare 官方文件，非猜測）

| 項目 | Free | Paid（Workers Paid） |
|---|---|---|
| 單一資料庫最大容量 | 500 MB | **10 GB** |
| 帳號總儲存上限 | 5 GB | 1 TB |
| 單一 SQL 陳述式長度上限 | 100 KB（兩者相同） |
| 單一查詢最長執行時間 | 30 秒（兩者相同） |
| 單一 row／字串／BLOB 大小上限 | 2 MB（兩者相同） |
| 單一表格列數上限 | 官方文件未設明確上限（受資料庫總容量限制） |

（來源：Cloudflare 官方文件 `developers.cloudflare.com/d1/platform/limits/`，查閱時間 2026-09-17；未使用任何未在本次查閱中確認過的數字。）

### 5.2 實測儲存成長率

用 remote 測試資料庫的實際 `file_size`（wrangler 回報值）計算：

- 空 schema＋seed 資料（無任何真實旅運資料）：**9,187,328 bytes**（≈ 9.19 MB）——這是 production `mrt-rank-db` 目前遠端的實際大小。
- 匯入完整一個月（`real_*`＋`daily_od_flow`＋`range_*`，31 天）後：**308,408,320 bytes**（≈ 308.41 MB）。
- **每月淨增量 ≈ 299.22 MB**（≈ 285.36 MiB），其中 93% 以上的新增列數來自 `daily_od_flow`（1,934,412 / 2,078,227 筆新增列）——`real_*`／`range_*` 四張表合計只有 ~143,814 筆新增列，是很小的固定開銷，不是成長的主要驅動因素。

### 5.3 多年成長投影（純粹依線性外推，不代表未來每月流量必然相同）

| 累積時長 | 投影資料庫大小（若每月都保留完整逐日粒度） | 對照 Paid 上限（10 GB） |
|---|---|---|
| 6 個月 | 1.80 GB | 18% |
| 1 年 | 3.59 GB | 36% |
| 2 年 | 7.18 GB | 72% |
| **~2.8 年** | **~10 GB** | **100% —— 預期超過單一資料庫上限** |
| 5 年 | 17.95 GB | 180%（遠超） |

對照 Free tier（500 MB）：**不到 2 個月就會超過**。

### 5.4 評估結論

**如果不做任何調整，維持「每個月都用完整逐日粒度、永久保留在同一個 D1 資料庫」的策略，在 Paid tier 下大約 2.8 年後就會撞到單一資料庫 10 GB 的上限，Free tier 下兩個月內就會撞到。** 這印證了架構設計文件本來就提出過的疑慮（「Risks / open questions」第 1 點：`daily_od_flow` 實際成長速度未知，建議上線後量測——現在有真實數字了），不是新問題，但現在有了具體的時間表。

**不建議在這個有疑慮的 storage 基礎上直接把 Phase 3（year/holiday/custom range）的功能往上疊**，因為 Phase 3 的功能天生會增加 `daily_od_flow` 的查詢頻率與依賴深度，一旦真的撞到容量上限才處理，屆時要做的資料遷移／清理，複雜度與風險都會遠高於現在先規劃。

### 5.5 Evidence-based 替代方案（提出方向，不在本階段實作）

1. **限定 `daily_od_flow` 的保留窗口（建議優先方向）**：只在 D1 保留最近 N 個月（例如 24 個月）的逐日粒度，超過窗口的月份，`daily_od_flow` 明細可以清除或搬移，但**永久保留** `real_*`／`range_*`（月度聚合結果）——這四張表加總每月只有 ~143,814 筆新增列，換算儲存量遠低於 `daily_od_flow`，即使保留數十年也不會逼近容量上限。代價：超過窗口的月份無法再做「custom range」這類需要重新聚合逐日資料的查詢，但仍然可以查月度／（未來）年度聚合結果。這個方案完全不需要新基礎設施，只需要一個定期清理 job（Phase 3 再設計），且與架構設計文件「Existing monthly table relationship」一節「舊表要不要被汰換是可選的未來優化」的既有立場一致。
2. **依年份切分成多個 D1 資料庫**：D1 帳號可建立的資料庫數量上限是 50,000（Paid），遠遠夠用；把 `daily_od_flow_2026`、`daily_od_flow_2027`... 分成不同資料庫，可以讓單一資料庫永遠不逼近容量上限。代價：跨年查詢（例如「比較 2026 與 2027 同一個連假」）需要對多個資料庫分別查詢再應用端合併，複雜度轉嫁到查詢層，且 D1 目前沒有原生跨資料庫 JOIN。這個方案需要在 Phase 3 設計 `range_type=year/holiday/custom` 的查詢邏輯時一併考慮，不是現在就要決定。
3. **把逐日明細搬到 D1 以外**（例如 R2 存 Parquet／CSV，需要時用 Workers 讀取或另外跑批次工作重新聚合）：儲存成本最低、擴充性最好，但需要新增基礎設施與新的查詢路徑，複雜度最高，與第 3 節「不引入新雲端架構」的本階段立場衝突，列在這裡是為了完整性，**不建議作為近期方向**。

**上面三個方向沒有互斥**：方案 1（保留窗口）可以先做、成本最低、立即把成長曲線壓平；方案 2、3 是規模繼續成長後才需要考慮的下一步。本文件不代為決定選哪個，只確保這個決策是在**有實測數據**的基礎上做，而不是先把 Phase 3 建起來才發現存不下。

---

## 6. Blockers before Phase 3

依風險與急迫性排序：

1. **`0003` migration 隱性依賴 `seed.sql`（第 1.1 節）**：任何要建立新環境（remote 測試庫、CI、未來的災難復原）的人都會卡在這裡，而且錯誤訊息（FK constraint failed）不會直接指向根因。建議修法：要嘛把 `seed.sql` 的內容併入一份 migration（讓 `migrations apply` 單獨就能建出完整可用的資料庫），要嘛在 README／CONTRIBUTING 明確標示「新環境必須先跑 `db:seed` 再跑 migrations」，並讓 `0003` 的錯誤情境更容易被辨認。這不是 Phase 2A/2B 引入的問題，但既然 Phase 3 會需要更頻繁地操作 remote／新環境，建議在那之前解決。
2. **大量重新匯入在 remote 上會被用戶端逾時擋下（第 1.4 節）**：目前的因應方式是「失敗但資料安全，可重試」，不是「不會失敗」。如果 Phase 3 的 backfill 或排程重算需要頻繁對已有資料的月份重新匯入（例如修正 ETL bug 後要重跑好幾個月），現在的流程會不斷觸發這個逾時、需要人工介入判斷（查表確認資料完整、必要時手動用拆分流程重跑）。建議 Phase 3 開始前先決定要不要投資寫一個不透過 wrangler CLI（改用 Cloudflare D1 HTTP API、自訂逾時）的匯入用戶端，或至少把第 1.4 節驗證過可行的「DELETE 拆分」流程正式收斂成 ETL 的一個選項（清楚標示它犧牲了單檔案原子性、需要额外的失敗復原邏輯）。
3. **`daily_od_flow` 的長期儲存需要在 Phase 3 前定案（第 5 節）**：不是「現在就會出問題」（目前只有一個月的資料），而是「Phase 3 的功能設計如果假設 `daily_od_flow` 可以無限期、無限量累積，會在幾年內把自己逼進牆角」。建議在設計 `range_type=year`/`holiday`/`custom` 的查詢與聚合邏輯時，一併把「`daily_od_flow` 保留多久」這個問題定案（第 5.5 節的方案 1 是風險最低的起點），不要讓儲存策略變成事後補救。
4. **原始 CSV 沒有 durable 保存（第 3.3 節，優先度較低）**：目前唯一的緩解是 manifest 記錄了 checksum／來源／涵蓋範圍，讓「這批資料曾經長什麼樣」可以被追溯，但原始檔案本身遺失了就真的遺失了，只能向上游重新下載（而且已知上游檔案內容會變動）。優先度較低是因為短期內不影響任何功能運作，但如果之後真的需要「用不同邏輯重新處理歷史資料」（例如决定要保留逐小時粒度），現在沒有原始檔案保存，屆時只能盡力重新下載，不保證能拿到當初处理過的那個確切版本。

以上四項都不阻擋 Phase 2B 本身的驗收（Phase 1／2A 的 parity 與推薦 baseline 都已在第 7 節確認不變），但建議在啟動 Phase 3（year/holiday/custom range 的實際功能開發）之前，至少對第 1、3 項做出明確決定。

---

## 7. Validation

- **Remote D1 測試**：全部在可拋棄的 `mrt-rank-db-phase2b-test` 上執行，完成後已刪除（`wrangler d1 delete mrt-rank-db-phase2b-test -y`），production `mrt-rank-db` 全程未被寫入或修改。
- **`wrangler.jsonc`**：測試期間暫時加入的 binding 已還原，`git diff wrangler.jsonc` 為空。
- **Phase 1 回歸**（對本地 dev server + 本地 D1，未受今天任何 remote 操作影響）：

  | 測試 | 結果 |
  |---|---|
  | 未指定月份 → latest | `data_source=real`, `data_month=2026年1月`，推薦站點順序與 `total_score` 與先前記錄完全相同 |
  | 指定有效月份（`year=2025&month=11`） | `data_month=2025年11月` |
  | 指定不存在月份（`year=2026&month=5`） | `404`，`"目前可用月份：2026-01、2025-11"` |
  | Trend gap（`BL11`/`night`） | `calendar` 正確標示 `[(2025,11,有), (2025,12,無), (2026,1,有)]` |

- **Phase 2A parity**（本地）：`verify_range_parity.py --year 2026 --month 1` 六項全 PASS，最大誤差 `0.000e+00`。
- **`npm run build`**：成功，`dist/_worker.js` 154.52 kB。
- **`git diff --check`**：無空白字元錯誤。

本階段沒有修改 `recommender.ts`／`normalizer.ts`、任何現有 API 行為、Phase 1 的月份選擇 UX，或任何前端程式碼；沒有對 production 執行 deploy；沒有實作 year／holiday／custom range 的任何使用者功能。
