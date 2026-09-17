# MetroPulse — Temporal Phase 2C: Foundation Decisions & Fixes

日期：2026-09-17
狀態：已在**可拋棄的 remote 測試資料庫**與本地 D1 上完整驗證，測試資料庫已刪除；**未動 production `mrt-rank-db`、未 deploy**
前置閱讀：[temporal-architecture-design.md](temporal-architecture-design.md)、[temporal-phase2a-implementation.md](temporal-phase2a-implementation.md)、[temporal-phase2b-hardening.md](temporal-phase2b-hardening.md)

本階段把 Phase 2B 找到的四個 foundation blockers 依照五項決策收斂成實際可用的維運流程。**沒有實作 year/holiday/custom range 的任何使用者功能，沒有改前端，沒有改動 `recommender.ts`/`normalizer.ts` 或任何現有 API 行為。**

---

## 決策對照

| # | 決策 | 本文件對應實作 |
|---|---|---|
| 1 | 唯一官方 fresh-database bootstrap 流程；不修改既有 migration 歷史 | [scripts/bootstrap_db.py](../../scripts/bootstrap_db.py)（第 1 節） |
| 2 | `daily_od_flow` rolling 18 個月保留；monthly/yearly/holiday range 聚合永久保留 | [scripts/retention.py](../../scripts/retention.py)（第 2 節） |
| 3 | Custom date range 只保證在仍有逐日粒度的日期範圍內可計算 | retention.py 每次操作都回報目前的逐日粒度可用範圍（第 2 節） |
| 4 | Raw source CSV 採 R2 durable archive；manifest 記錄 archive key + SHA-256 | R2 bucket `metropulse-raw-od-archive` + ETL 的 `--archive-to-r2`（第 3 節） |
| 5 | Existing-month re-import 定義為 maintenance workflow；不犧牲一般 import 的原子性 | ETL 的 `--maintenance-reimport`（第 4 節） |

---

## 0. 測試方法說明

第 1、4、5 節的驗證都在一個**臨時建立、測試完立即刪除**的 remote D1 資料庫 `mrt-rank-db-phase2c-test` 上執行，過程中和 Phase 2B 一樣暫時在 `wrangler.jsonc` 加入對應 binding（讓 `migrations apply` 認得這個資料庫），測試結束後已確認 `git diff wrangler.jsonc` 為空、資料庫本身已刪除。原始 CSV 封存驗證使用新建立的 R2 bucket `metropulse-raw-od-archive`（見第 3 節）。全程未寫入或刪除 production `mrt-rank-db` 的任何資料。

---

## 1. Bootstrap fix

### 問題回顧

Phase 2B 發現 `migrations/0003_add_r01_guangci.sql` 隱性依賴 `seed.sql` 已經把基礎站點資料寫入，但 `seed.sql` 不屬於 migrations 系統，導致全新資料庫只跑 `wrangler d1 migrations apply` 會在 0003 卡在 FOREIGN KEY constraint 錯誤，且錯誤訊息不會指向根因。

### 決策 1 的落地：不修改 migration 歷史

沒有把 `seed.sql` 的內容改寫進某個 migration 檔案，也沒有調整 migration 檔名順序——這兩種做法都等於「修改既有 migration 歷史」，會讓已經套用過舊版 migrations 的環境（包含 production）出現「本地檔案內容跟遠端已記錄的套用歷史對不上」的風險。

改用 wrangler 本身就有的行為：**失敗的 migration 不會被標記為已套用，下次呼叫 `migrations apply` 會自動重試它**。[scripts/bootstrap_db.py](../../scripts/bootstrap_db.py) 只是把這個行為包裝成一個официальный、冪等、可重複執行的三步驟：

```
1. wrangler d1 migrations apply <db>   # 套用 0001、0002；全新資料庫預期在 0003 卡住（正常現象）
2. wrangler d1 execute <db> --file=seed.sql   # 補齊基礎站點資料（INSERT OR IGNORE，冪等）
3. wrangler d1 migrations apply <db>   # 重試；0003 現在能通過 FK 檢查，接著 0004
```

### 驗證

在全新建立的 `mrt-rank-db-phase2c-test`（remote）上執行：

- **第一次執行**：Step 1 依預期在 0003 卡住 → Step 2 套用 seed.sql（`changes: 1483`，寫入 5,708 列）→ Step 3 全部成功。最終驗證查詢確認：`stations=136`、四張 Phase 2A 新表（`daily_od_flow`/`date_ranges`/`range_od_flow`/`range_pagerank`）皆存在。
- **對已 bootstrap 過的同一個資料庫再執行一次**：Step 1 直接全部成功（沒有卡住）、Step 2 的 `INSERT OR IGNORE` 是無害 no-op、Step 3 回報「沒有 migration 需要套用」——證實**重複執行是安全的**，可以當作「不確定資料庫狀態就跑一次」的萬用指令，不需要先判斷資料庫是全新的還是已存在的。

**這就是「單一 bootstrap command 建立成功」的驗證**：`python3 scripts/bootstrap_db.py --remote --db-name <任意全新資料庫>` 一行指令，從零到可用。

---

## 2. Retention implementation

### 決策 2／3 的落地

新增 [scripts/retention.py](../../scripts/retention.py)：

- `--window-months`（預設 18）定義 `daily_od_flow` 的保留窗口，cutoff = 今天往前推 N 個月（正確處理月份天數差異，例如月底日期的邊界情況）。
- **這支腳本產生的唯一 DELETE 目標是 `daily_od_flow`**——沒有任何程式路徑會對 `real_od_flow`/`real_pagerank`/`range_od_flow`/`range_pagerank`/`date_ranges`/`data_months` 執行刪除。每次執行（不論 dry-run 或 purge）都會印出這六張「永久保留表」的列數快照；purge 完成後會**強制比對操作前後這六個數字完全相同**，不同就以 CRITICAL 訊息中止（雖然依程式邏輯這種情況不可能發生，但仍然加上這層驗證，不只是口頭承諾）。
- 預設是 `--dry-run`（只回報，不刪除）；`--purge` 才會真正執行。
- 每次操作結束都回報 `daily_od_flow` 目前實際涵蓋的日期範圍（`MIN(service_date)` ~ `MAX(service_date)`）——這是決策 3「custom range 只保證在仍有逐日粒度的日期範圍內可計算」的資料層依據：本階段沒有 custom range 功能可以綁定這個查詢（範圍明確排除），但保留窗口清理後「目前還能算什麼範圍」這件事，retention.py 已經誠實地回報出來，Phase 3 設計 custom range 的可行性檢查時直接可用。
- `--as-of` 參數可以覆寫「今天」的日期，供測試使用（不影響正常操作，正常使用永遠用真實日期）。

### 驗證（在本地與 remote 測試資料庫上各執行過一輪）

| 情境 | 結果 |
|---|---|
| Dry-run，真實日期（2026-09-17，18 個月前是 2025-03-17） | 正確回報「0 列需要清理」——2026-01 的資料在窗口內，不會被視為候選 |
| Dry-run，模擬未來日期（`--as-of 2028-01-01`，cutoff 為 2026-07-01） | 正確列出 2026-01（1,934,412 列）為候選，**未刪除任何資料** |
| Purge，模擬未來日期 | 實際執行 `DELETE FROM daily_od_flow WHERE service_date < '2026-07-01'`，刪除 1,934,412 列；操作前後六張永久保留表列數**逐一比對完全相同**（`real_od_flow=71,199`／`real_pagerank=708`／`range_od_flow=71,199`／`range_pagerank=708`／`date_ranges=1`／`data_months=2` 在本地驗證中前後一致） |

**過程中發現並修正一個真實 bug**：`d1_exec()` 裡讀取 DELETE 影響列數的程式碼原本寫成 `result.get('meta', {}).get('changes', result.get('results', [{}])[0].get('meta', {}).get('changes'))`——Python 會**優先求值**當作預設值的那段運算式，而 DELETE 陳述式的 `results` 欄位固定是空陣列 `[]`，`[][0]` 直接拋出 `IndexError`，導致腳本在**刪除操作本身已經成功之後**，於列印訊息階段當掉。這個 bug 不影響資料正確性（DELETE 已經真的執行完成），但會讓操作者誤以為 purge 失敗——已simplify 成 `result.get('meta', {}).get('changes')` 並重新完整驗證過一次乾淨的端到端執行（見上表）。

---

## 3. Raw archive

### 決策 4 的落地

建立新的 R2 bucket `metropulse-raw-od-archive`（Cloudflare 帳號內，與現有 D1/Pages 同一帳號，沒有引入新的雲端供應商）。ETL 新增 `--archive-to-r2`（選填，預設關閉——避免每次測試/backfill 都預設上傳）與 `--r2-bucket`：

- 若是遠端下載（非 `--csv-file`）且要求封存，`_SourceReader` 邊解析邊把原始位元組寫進本地快取檔（`scripts/output/raw-cache/`，已被既有的 `scripts/output/` gitignore 規則涵蓋），確保**只下載一次**，解析與封存共用同一份位元組。
- 上傳後把 `r2_bucket`／`r2_object_key`／`r2_uploaded_at`／`r2_upload_status`／`r2_upload_error` 寫進 manifest（schema version 提升到 3）。物件路徑 `raw/{year}{month:02d}/od_{year}{month:02d}_{sha256前16碼}.csv`——checksum 前綴讓同一個月份即使因為上游資料變動（Phase 2A 已經實測過這會發生）重新封存出不同內容，也會落在不同的物件路徑，不會靜默覆蓋。
- **刻意保持簡單**：單次嘗試、同步等待完成，沒有重試佇列或斷點續傳；上傳失敗**不會**讓整個資料匯入失敗（archival 是「盡量確保長期可回溯」，不是這次匯入資料正確可用的前提），但失敗一定會被寫進 `r2_upload_status='failed'` + 錯誤訊息，不會被靜默吞掉。

### 驗證：archived raw file checksum 與 manifest 對應

對測試資料庫執行 `--archive-to-r2` 匯入後：

```
manifest: {
  "r2_bucket": "metropulse-raw-od-archive",
  "r2_object_key": "raw/202601/od_202601_74d2374f526e0ab0.csv",
  "r2_upload_status": "success",
  "checksum_sha256_etl_computed": "74d2374f526e0ab06164820a428242ada24291187b5fd2d06a6dfb91e291abad"
}
```

獨立把這個物件從 R2 下載回來（`wrangler r2 object get`），重新計算 SHA-256：

```
74d2374f526e0ab06164820a428242ada24291187b5fd2d06a6dfb91e291abad
```

**與 manifest 記錄的 checksum 逐字元相同**——完整驗證了「R2 上封存的檔案，與這次匯入實際使用、manifest 記錄的原始資料，是同一份位元組」。

---

## 4. Maintenance re-import

### 決策 5 的落地

Phase 2B 發現：對已有 ~1.9M 列的月份重新匯入時，`daily_od_flow` 的 DELETE 陳述式（單獨執行約 21 秒）會超過 wrangler CLI 非同步 `--file` 匯入路徑的 15 秒用戶端輪詢逾時，即使伺服器端持續正確處理、失敗時完整回滾（Phase 2B 已驗證），也會讓操作者看到「失敗」而困惑。

**一般（新月份）匯入完全不變**：`_apply_local_wrangler`/`_apply_remote_wrangler` 仍然是單一檔案、單一 wrangler 呼叫，維持 Phase 2A/2B 已驗證過的完整原子性——這條路徑沒有被這裡的修法影響，滿足「不因 Wrangler timeout 犧牲一般 import 的 atomicity」。

新增 `--maintenance-reimport` 旗標，**只在明確要求重新匯入一個已有資料的月份時**才會啟用不同的流程（[apply_maintenance_reimport()](../../scripts/import_od_data.py)）：

1. 把 DELETE 陳述式從主檔案抽出，合併成一次 `d1 execute --command`（同步路徑，沒有輪詢逾時問題）送出。
2. 其餘 INSERT 陳述式仍走 `--file`（每批 500 列，陳述式本身都很快，不會觸發逾時）。
3. **完成後強制列數核對**：對 `daily_od_flow`（依本次匯入的日期範圍）、`range_od_flow`、`range_pagerank`、`real_od_flow`、`real_pagerank` 五張表分別查詢實際列數，與這次匯入「應該」寫入的列數比對。任何一項不符，印出明確的 CRITICAL 訊息與復原步驟並以非零狀態碼中止——**不會**把不一致的狀態靜默報告成功。
4. DELETE 與 INSERT 都設計成冪等，任何一種部分失敗，操作者只要重新執行同一個 maintenance 指令即可安全復原。

流程開始時會印出明確的警告橫幅，說明這條路徑犧牲了單一檔案的原子性，且只應該用於「重新匯入既有月份」情境。

### 驗證

| 情境 | 結果 |
|---|---|
| Happy path：對已有完整一個月資料的 remote 測試資料庫執行 `--maintenance-reimport` | 成功，列數核對五項全 OK（`daily_od_flow=1,934,412`／`range_od_flow=71,199`／`range_pagerank=708`／`real_od_flow=71,199`／`real_pagerank=708`），事後 `verify_range_parity.py` 六項全 PASS |
| **偵測邏輯本身是否真的會抓到不一致**（不是只測「wrangler 本身失敗」這個 Phase 2B 已經測過的情境） | 刻意手動刪除 `range_pagerank` 裡 3 個站點的列（708 → 690），直接呼叫核對邏輯：正確回報 `[MISMATCH] range_pagerank: expected 708, actual 690`——證實檢查機制對「wrangler 回報成功、但資料實際上不對」這種更隱蔽的情境也會抓到，不只是對硬性錯誤有反應 |
| 從注入的不一致復原 | 重新執行同一個 `--maintenance-reimport` 指令：DELETE 清空、INSERT 重新寫入全部資料，列數核對五項全部恢復 OK，證實冪等復原設計成立 |

**注意**：由於 D1 免費方案的每日列讀取配額在本次高強度測試中被完全用盡（見第 5 節），原本計畫的「乾淨重跑一次 purge 展示」在 remote 測試資料庫上受阻，改在本地 D1（不受這個配額限制）完整重跑並取得乾淨結果，記錄於第 2 節與第 5 節。

---

## 5. Validation

| 驗證項目 | 結果 |
|---|---|
| Fresh disposable DB 可由單一 bootstrap command 建立成功 | ✅（見第 1 節，含冪等性驗證） |
| Normal new-month import 不 regression | ✅ 對 remote 測試資料庫執行一般匯入（含 `--archive-to-r2`），`verify_range_parity.py --remote` 六項全 PASS，最大誤差 `0.000e+00` |
| Archived raw file checksum 可與 manifest 對應 | ✅（見第 3 節，獨立下載重新計算 SHA-256，逐字元相符） |
| Retention dry-run 不會刪除仍在 18-month window 的資料 | ✅（見第 2 節，真實日期下回報 0 列候選） |
| Purge daily rows 不刪 monthly/range aggregates | ✅（見第 2 節，操作前後六張永久保留表列數逐一比對完全相同） |
| Maintenance re-import failure 不造成 silent corruption | ✅（見第 4 節，偵測邏輯對真實注入的不一致正確報警，且可冪等復原） |
| Phase 1 / 2A parity 仍 PASS | ✅（見下方） |

### Phase 1 回歸（本地 dev server + 本地 D1）

| 測試 | 結果 |
|---|---|
| 未指定月份 → latest | `data_month=2026年1月`，推薦站點順序與 `total_score` 與先前記錄完全相同 |
| 指定有效月份（`year=2025&month=11`） | `data_month=2025年11月` |
| 指定不存在月份（`year=2026&month=5`） | `404`，可用月份提示正確 |
| Trend gap（`BL11`/`night`） | `calendar` 正確標示缺口 |

### Phase 2A parity（本地）

`verify_range_parity.py --year 2026 --month 1` 六項全 PASS，最大誤差 `0.000e+00`。

### Build

`npm run build` 成功（`dist/_worker.js` 154.52 kB）；`git diff --check` 無空白字元錯誤。本階段沒有修改 `recommender.ts`/`normalizer.ts`/任何現有 API 行為/前端程式碼；沒有對 production 執行 deploy。

### 意外發現：D1 Free tier 每日列讀取配額

本階段高強度的驗證測試（多次完整匯入、maintenance re-import、parity 檢查，每次都掃描百萬列等級的資料）在同一天內把這個 Cloudflare 帳號的 D1 **免費方案每日列讀取配額完全用盡**，導致一次 `migrations apply` 呼叫被 Cloudflare API 直接拒絕：

```
Your account has exceeded D1's free tier daily row read limit.
Upgrade to a paid plan or wait until tomorrow (midnight UTC) to continue.
```

這不是本次任何程式碼的 bug，是帳號方案層級的限制，但值得記錄兩個含義：
1. **這個帳號目前運作在 D1 Free tier**（500 MB 單一資料庫上限、5 GB 帳號總儲存上限）——Phase 2B 的儲存成長投影（每月 ~299 MB）在 Free tier 下**兩個月內就會超過單一資料庫容量上限**，遠比 Paid tier 的 10 GB／~2.8 年寬鬆得多。
2. Phase 2C 選定的 18 個月保留窗口，穩態下 `daily_od_flow` 大約會落在 `18 × 299 MB ≈ 5.4 GB`——這個數字**在 Paid tier（10 GB）下是可行的（約 54% 使用率），但遠遠超過 Free tier（500 MB）**。這代表**這個保留政策成立的前提是帳號需要升級到 Paid tier**——這是一個必須在 Phase 3 正式仰賴這個保留窗口設計之前確認、而不是本文件能代為決定的帳務／預算決策。

---

## 6. Remaining blockers before Phase 3

1. **帳號方案確認**：如第 5 節所述，18 個月保留窗口的儲存投影需要 Paid tier 才站得住腳；目前帳號似乎在 Free tier（今天的配額耗盡直接證實）。這是一個需要人為確認/決定的事項，本文件不代為決定。
2. **Retention 的排程化**：`scripts/retention.py` 目前是手動執行的工具，沒有排程（例如每月自動跑一次 `--purge`）。本階段的範圍是「建立安全、可驗證的工具」，不包含排成自動化排程——Phase 3 開始大量仰賴這個保留窗口之前，應該決定由誰、多常執行。
3. **R2 封存的生命週期管理**：目前 R2 bucket 沒有設定生命週期規則（例如超過幾年自動轉冷儲存或刪除），也沒有涵蓋歷史上（Phase 2A/2B 匯入的）月份的回溯封存——`--archive-to-r2` 只對「這次執行的匯入」生效。如果需要把過去已經匯入但未封存的月份的原始 CSV 也補進 R2，需要另外用已封存（或重新下載）的 CSV 手動跑一次帶 `--archive-to-r2` 的匯入。
4. **Maintenance re-import 仍然犧牲原子性**：這是 Phase 2B 就承認的取捨，Phase 2C 沒有、也不打算消除它——只是把它限定在明確標記的維護流程裡，並加上偵測與復原機制。如果未來重新匯入既有月份的頻率變高（例如例行性資料修正），值得重新評估是否要投資一個不透過 wrangler CLI 輪詢機制的匯入用戶端（Phase 2B 已經提出這個方向）。

以上四項都不阻擋 Phase 2C 本身的驗收（第 5 節所有驗證項目與 Phase 1/2A 回歸皆已確認通過），但建議在啟動 Phase 3（year/holiday/custom range 的實際功能開發）之前，至少對第 1 項做出明確決定。
