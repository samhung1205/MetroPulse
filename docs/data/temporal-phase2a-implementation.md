# MetroPulse — Temporal Phase 2A Implementation

日期：2026-09-17
狀態：已實作、已本地驗證，**未 migration 到 remote、未 deploy**
前置閱讀：[temporal-capability-audit.md](temporal-capability-audit.md)、[temporal-architecture-design.md](temporal-architecture-design.md)、[temporal-phase1-implementation.md](temporal-phase1-implementation.md)

本文件記錄 Phase 2A：建立 daily temporal foundation（`daily_od_flow` → `range_od_flow` → `range_pagerank`），並只用「月」驗證 generalized range pipeline 與既有 monthly real-data pipeline 完全等價。**不新增任何 year / holiday / custom 使用者功能，不改前端，不改 recommend/analytics API 的對外行為。**

---

## 1. Schema / migration

新增 [migrations/0004_daily_range.sql](../../migrations/0004_daily_range.sql)，純新增，與架構設計文件的 Proposed schema 一致：

- `daily_od_flow(from_station_id, to_station_id, service_date, period, flow_count)` — PK 含 `service_date`，逐日粒度。
- `date_ranges(range_id, range_type, start_date, end_date, holiday_event_id, label, day_count, computed_at)` — 本階段只寫入 `range_type='month'` 的列；`holiday_event_id` 保留給 Phase 3，本階段一律 `NULL`。
- `range_od_flow(range_id, from_station_id, to_station_id, period, flow_count)`
- `range_pagerank(range_id, station_id, period, pr_value, pr_rank, normalized_score)`

**未刪除、未修改**：`data_months`、`real_od_flow`、`real_pagerank`（欄位、PK、索引都原封不動）。`/api/recommend`、`/api/analytics/*` 現有程式碼完全沒有改動，仍然只讀舊表——本次 migration 對外 API 行為零影響（已用 Phase 1 的四項回歸測試驗證，見第 7 節）。

本地已套用並驗證：`npx wrangler d1 migrations apply mrt-rank-db --local` 成功建立四張新表與對應索引。

---

## 2. Daily ETL

修改對象：[scripts/import_od_data.py](../../scripts/import_od_data.py)。

### 核心變更

- `process_csv_stream()` 現在**同一次 CSV 掃描**同時產出：
  - `od_by_period`（舊管線，逐行累加條件完全不變：`MIN_FLOW` 過濾、`HOUR_TO_PERIOD` 映射、`STATION_MAP` 對應，一個都沒有動）
  - `daily_by_period`（新管線，鍵多一個 `service_date`）
- **關鍵設計決定**：`od_by_period` 的累加**先於**、且**不依賴**新增的日期格式驗證。第一版實作曾把日期驗證放在 `od_by_period` 累加之前（見下方「已發現並修正的問題」），會讓舊管線的行為悄悄依賴一個過去不存在的條件——即使這次 fixture 剛好沒有觸發（`skipped_date=0`），也是必須排除的隱性風險，已在驗證階段發現並修正。
- 新增 `--csv-file` 參數：可指向本地已下載的 CSV，略過遠端請求。用途見第 5 節「Source provenance」。
- 新增串流計算的 `sha256` checksum（逐 chunk 累加，不需把整個 300MB 檔案再讀一次）。
- 新增 `get_all_station_ids()`：從 `generate_sql()` 抽出的既有邏輯（station 去重＋排序），**未改變任何行為**，只是讓 `generate_range_sql()` 可以用同一份 station 順序呼叫 `compute_pagerank()`——這對 parity 測試是必要的（見第 4 節）。
- 新增 `generate_daily_sql()`、`aggregate_range_from_daily()`、`generate_range_sql()`、`generate_manifest()`，`_batched_insert_lines()` 通用批次 INSERT 輔助函式（每批 500 列，降低陳述式數量以縮短匯入時間）。

### 未修改

- `GAMMA = 0.85`、`POWER_ITER = 150`：一個字元都沒有動。
- `compute_pagerank()`、`normalize_pr()`：原封不動；`range_pagerank` 呼叫的是同一份函式，只是輸入的 `od_flows` 改用 `range_od_agg`（來自 daily 聚合）。
- `HOUR_TO_PERIOD` 映射：完全沿用，6 段時段語意不變。
- `src/lib/recommender.ts`、`src/lib/normalizer.ts`：本階段完全沒有觸碰（Phase 2A 範圍不含前端／推薦計分）。

### 已發現並修正的問題

實作過程中，第一版把「日期格式驗證」放在 `od_by_period[period][(from_id,to_id)] += count` **之前**，導致格式異常的日期列會連 `od_by_period`（舊管線）都跳過——這原本不存在的條件差異即使在本次 fixture 沒有觸發（`skipped_date=0`），仍然是會讓舊管線輸出偷偷依賴新程式碼的隱性風險。已修正為：`od_by_period` 的累加**不受**日期格式影響（與 Phase 1 以前的行為完全一致），日期格式驗證只用來決定是否寫入 `daily_by_period`。修正後重新執行完整 parity 測試，結果不變（見第 4 節）。

---

## 3. Monthly range pipeline

流程與架構設計文件一致：

```
CSV（逐行）
  │  同一次掃描
  ├─→ od_by_period[period][(from,to)] += count          （舊管線，未變動）
  └─→ daily_by_period[period][(date,from,to)] += count   （新管線）
         │  daily_od_flow（DELETE 整個曆月範圍 → 批次 INSERT）
         ▼
  aggregate_range_from_daily()：SUM(flow_count) GROUP BY from,to,period
  WHERE service_date BETWEEN <該月實際涵蓋的最早/最晚日期>
         │
         ▼
  range_od_flow（range_id='month:2026-01'）
         │  compute_pagerank()（與 real_pagerank 呼叫同一份函式，同一份 station_ids 順序）
         ▼
  range_pagerank
```

`date_ranges` 的 `start_date`/`end_date`/`day_count` 取自**該月實際觀測到的日期集合**（本次 fixture 是 2026-01-01 ~ 2026-01-31，31 天），不是假設的曆月天數——如果來源資料缺某幾天，`day_count` 會誠實反映缺口，不會假裝涵蓋整月。

`daily_od_flow` 的 `DELETE` 範圍改用**曆月邊界**（`calendar.monthrange()` 算出的該月第一天到最後一天），而不是本次觀測到的最早/最晚日期——這樣即使前一次匯入的資料範圍比這次窄，重新匯入仍能完整覆蓋整個曆月，不會留下舊的殘餘列（細節見第 5 節 import safety）。

---

## 4. Old-vs-new parity

新增 [scripts/verify_range_parity.py](../../scripts/verify_range_parity.py)，對指定月份做六項獨立驗證，全部**逐筆比對，不是只比較 Top 5**：

| # | 驗證項目 | 方法 | 結果（2026-01 fixture） |
|---|---|---|---|
| 1 | 各 period OD totals | `SUM(flow_count) GROUP BY period`，`real_od_flow` vs `range_od_flow` | 6/6 period 完全相等 |
| 2 | OD pairs | `real_od_flow` LEFT JOIN `range_od_flow`，全部 71,199 筆逐筆比對（非抽樣） | 0 筆不符、0 筆單邊缺漏 |
| 3 | PageRank 值（全站） | `real_pagerank` vs `range_pagerank`，全部 708 列（118 站 × 6 期） | 最大絕對誤差 `0.000e+00`，最大相對誤差 `0.000e+00` |
| 4 | PageRank 排名 | 同上 | 0 筆不相等 |
| 5 | normalized_score | 同上 | 0 筆超出容忍度 |
| 6 | 獨立 SQL 聚合驗證 | 直接對 `daily_od_flow` 執行真正的 `SUM...GROUP BY` 查詢（不經過 Python 或 `range_od_flow`），比對 `real_od_flow` | 0 筆不符 |

第 6 項刻意繞過 `range_od_flow`／ETL 腳本自己算出的聚合結果，直接對資料庫裡落地的 `daily_od_flow` 下真正的 SQL 查詢，避免「驗證腳本只是在跟自己比對」的風險。

### 容忍度定義（為何允許、又為何觀測到 0）

- **OD 流量**：`OD_TOLERANCE = 0`，必須完全相等——這是整數的加總，加總順序不影響結果（結合律精確成立），沒有放寬的理由。
- **PageRank 值 / normalized_score**：容忍度設為 `abs diff < 1e-9` 或 `rel diff < 1e-6`。理論推導：`daily_od_flow` 的逐日流量都是可被 `float64`精確表示的整數，且不論是舊管線「CSV 掃描時直接按 period 累加」還是新管線「先按日累加、再用 SQL SUM 依 period 重新聚合」，兩者的每個 `(from,to,period)` 加總值都是同一組整數的重新排序求和——只要總和落在 `float64` 精確整數範圍內（本例最大單一 OD 對加總遠低於 2⁵³），浮點加法的結合律誤差為零，理論上應逐位元組相同。`compute_pagerank()` 的 Power Method 本身是對固定的轉移矩陣做固定次數的迭代乘加，矩陣一旦相同，後續計算路徑完全確定，不受聚合順序影響。因此容忍度是**安全邊界**，不是「因為浮點數所以放寬」的讓步——實測結果（最大絕對/相對誤差均為 `0.000e+00`）印證了這個推導：兩條管線的 708 筆 PageRank 值逐位元組相同。

完整報告：`scripts/output/parity_report_202601.json`（gitignored，可用 `python3 scripts/verify_range_parity.py --year 2026 --month 1` 重新產生）。

### Phase 1 baseline 對照

Phase 1 文件記錄的 `BL11 → night → food` 未指定月份基準（`rank1=BL12, total_score=0.79` 等）在本次 Phase 2A 重新匯入 2026-01 後**重新比對，站點順序與四捨五入後的 `total_score` 完全相同**（見第 7 節）。

但過程中發現一個值得記錄的資料現象：**重新下載的 2026-01 原始 CSV 與 Phase 1 當時匯入所用的版本，原始 `pr_value` 在小數點第 5 位開始出現極小差異**（例如 `BL11`/`night` 從 `0.0293307` 變成 `0.02932031`）。這不是 Phase 2A 程式碼造成的——本次修改後的 `od_by_period` 邏輯與 Phase 1 以前完全一致，且新舊兩條管線本身互相對照是 `0.000e+00` 差異。合理解釋是**來源 CSV 在兩次下載之間被上游更新過**（該 blob 的 `Last-Modified` 標頭顯示 `2026-02-10`，晚於 Phase 1 執行時間）。這個差異只發生在小數點第 5 位以後，四捨五入到 2 位小數的 `total_score` 與推薦排序完全不受影響（已驗證），但這正是第 5 節要求的「不要假設遠端 CSV 永遠存在／不變」的真實案例，已記錄在案。

---

## 5. Import safety

### 5.1 Idempotent 重匯同月份

同一份 fixture CSV 對 `2026-01` 執行兩次完整匯入（含 `--apply-local`），比對結果：

| 指標 | 第一次匯入 | 第二次匯入 |
|---|---|---|
| `daily_od_flow` 列數 / SUM(flow_count) | 1,934,412 / 59,426,218 | 1,934,412 / 59,426,218（相同） |
| `range_od_flow` 列數 | 71,199 | 71,199（相同） |
| `range_pagerank`（BL11/night） | `pr_value=0.02932031` | `pr_value=0.02932031`（相同） |
| `date_ranges.day_count` | 31 | 31（相同） |
| `date_ranges.computed_at` | `2026-09-17T00:11:25` | `2026-09-17T00:15:43`（**有更新**，符合預期——時間戳應反映最後一次計算） |

除了刻意應該更新的 `computed_at` 之外，所有資料值逐位元組相同——重匯是 idempotent 的。

### 5.2 匯入 A 月不影響 B 月

`2025-11`（Phase 1 留下的本地測試月份）在重新匯入 `2026-01` 前後：`real_od_flow`/`real_pagerank` 列數（71,199 / 702）與 `BL11`/`night` 的 `pr_value`（`0.0454626005`）**完全未變動**；`daily_od_flow` 中 `service_date < '2026-01-01'` 的列數為 0（`2025-11` 從未透過本階段 ETL 匯入逐日資料，這是預期行為，不是 bug——它是 Phase 1 用 SQL 直接灌入的合成測試資料，不影響本次驗證的獨立性）。

`daily_od_flow` 的 `DELETE` 範圍鎖定在**該月曆月邊界**（如 `2026-01-01` ~ `2026-01-31`），與 `real_od_flow`/`real_pagerank` 沿用的 `WHERE year=? AND month=?` 邊界語意一致，曆月彼此不重疊，因此匯入任一月份不會、也不可能觸及其他月份的既有列。

### 5.3 中途失敗不得留下半套狀態

**先做了一個關鍵的能力探測**：本地 D1（`wrangler d1 execute --local --file`）對整份 SQL 檔案的執行是否原子化？實測方法：構造一個「先 `CREATE TABLE` 成功、插入兩筆資料成功、第三筆違反 UNIQUE 約束失敗」的檔案。結果：**執行失敗後，連最前面成功的 `CREATE TABLE` 都被回滾**——`SELECT * FROM` 該表回報「no such table」，證實 wrangler 對本地 D1 的單一 `--file` 執行是整檔案原子的（失敗即全部回滾，不留痕跡）。

基於這個實測結果，Phase 2A 的 SQL 生成策略是：**把 `real_od_flow`/`real_pagerank`（舊表）與 `daily_od_flow`/`date_ranges`/`range_od_flow`/`range_pagerank`（新表）合併進單一輸出檔案**，用單一 `wrangler d1 execute --file` 呼叫寫入。這樣任何一段失敗，新舊表都會一起回到匯入前的狀態，不會出現「舊表已更新、新表沒更新」或反過來的矛盾狀態。

**用真實產生的匯入檔案再次驗證**：在完整的 2026-01 匯入 SQL（75,951 行、100MB，包含 `real_*`、`daily_od_flow`、`range_*` 全部陳述式）正中間插入一筆語法錯誤的陳述式，執行後：
- `wrangler` 回報 `SQLITE_ERROR: near "syntax": syntax error`，匯入失敗。
- 匯入前後比對 `daily_od_flow` 列數（1,934,412 → 1,934,412，不變）、`range_pagerank` 的 `BL11`/`night` 值（不變）、`date_ranges.computed_at`（不變，證明這次失敗的匯入完全沒有觸及任何一張表）、刻意注入的髒資料（`from_station_id='NOPE'`）在 `daily_od_flow` 中查到 0 筆。

**限制與待確認事項**（如實記錄，不假設）：以上原子性驗證僅針對**本地** D1（`--local`，底層是 miniflare 的 SQLite 實作）。Cloudflare 官方文件說明遠端 D1 的 `d1 execute --file` 會把陳述式包在單一批次（batch）中執行，理論上具備類似的原子性，但**本次未對遠端 D1 執行任何寫入測試**（避免在未經授權下觸碰共用的遠端資料庫，也符合任務要求的「不要 deploy production」）。因此：遠端行為是否與本地實測結果一致，目前是**推論、非本次驗證的事實**——正式導入遠端環境前，應該先用同樣的「中段注入語法錯誤」手法針對一個可拋棄的遠端測試資料庫重覆這個實驗，再對正式資料庫執行。

### 5.4 `date_ranges` 的 `day_count` / `computed_at`

已驗證兩者都正確寫入且語意正確：`day_count` 反映該範圍內**實際**有 `daily_od_flow` 資料涵蓋的天數（本次 fixture 為 31，若來源資料有缺口則會小於曆月天數，不會虛報），`computed_at` 每次重新計算 `range_pagerank` 時都會更新為當下時間戳。

---

## 6. Measured data size / performance

以下數字全部來自對本地 D1 執行 2026-01 fixture（117萬…等，見下方精確值）匯入的**實測結果**，不是估計值。

| 指標 | 數值 |
|---|---|
| 原始 CSV 大小 | 305,559,351 bytes（約 291 MB） |
| 原始 CSV 行數（不含 header） | 8,353,800 |
| 成功對應到站碼且落在 6 段時段內的行數（`mapped_rows`） | 4,446,722 |
| 涵蓋日期數 | 31 天（2026-01-01 ~ 2026-01-31，資料完整無缺口） |
| **`daily_od_flow` 列數** | **1,934,412** |
| 每日平均列數 | 1,934,412 ÷ 31 ≈ **62,400 列/天** |
| `range_od_flow` 列數（= 該月 71,199 個相異 OD×period 組合） | 71,199 |
| `range_pagerank` 列數（118 站 × 6 期） | 708 |
| CSV 解析＋兩條管線資料結構建立時間 | 4.50s |
| 生成 `real_*` SQL（舊管線，含 6 期 Power Method） | 0.35s |
| 生成 `daily_od_flow` SQL | 0.33s |
| **月度 range 聚合時間（Python 記憶體版 SUM，見下方 SQL 版本對照）** | **0.16s** |
| **range PageRank 計算時間（6 期，含 Power Method 150 次迭代 ×118 站）** | **0.33s** |
| 合併後的完整匯入 SQL 檔案大小 | 100.19 MB |
| `wrangler d1 execute --local --file`（含 migrations 檢查＋完整寫入） | 第一次 51.96s；重跑一次 114.90s（見下方說明） |
| **對已落地的 `daily_od_flow` 執行真正 SQL `SUM...GROUP BY`（71,199 筆結果）** | **1,515 ms** |
| 本地 D1 sqlite 檔案大小（累積兩個月份資料後） | 303 MB |

**`apply_to_d1` 耗時波動說明**：兩次完整匯入耗時分別是 52 秒與 115 秒（同一份 100MB 檔案，同一台機器）。差異推測與本機當下的磁碟/CPU 資源爭用有關（`wrangler d1 execute` 對本地 SQLite 的寫入吞吐本身就會受同時執行的其他行程影響），**不是**檔案內容或資料量造成的系統性成長（因為兩次匯入的目標資料完全相同、是同一份 idempotent 重跑）。正式導入前建議在乾淨環境下再量測一次，不應把這裡的任一數字當作穩定的效能保證。

**沒有臆測 D1 平台限制**：以上都是這台機器、這份 100MB／200 萬列規模資料的實測結果，用來說明「這個量級目前可行」，不代表 Cloudflare D1 遠端環境的容量或延遲上限——那些限制值應在正式導入遠端前查閱當時的官方文件，本文件不引用、也不假設任何具體平台數字（呼應架構設計文件「Performance considerations for D1」一節的既有立場）。

---

## 7. Phase 1 regression

在 Phase 2A 的 schema／ETL 變更全部套用、且已完整重新匯入 2026-01（含新的 `daily_od_flow`/`range_*` 資料）之後，對正在執行的 dev server 重新執行 Phase 1 記錄的四項關鍵行為：

| 測試 | 結果 |
|---|---|
| 未指定月份 → latest | `data_source=real`, `data_month=2026年1月`，推薦站點順序 `[BL12, BL10, R11, BL18, BL15]`、`total_score` `[0.79, 0.38, 0.38, 0.37, 0.33]`，與 Phase 1 記錄的基準**逐項相同** |
| 指定有效月份（`year=2025&month=11`） | `success=true`, `data_month=2025年11月`（Phase 1 建立的測試月份，未受 Phase 2A 影響） |
| 指定不存在月份（`year=2026&month=5`） | `404`，`"目前可用月份：2026-01、2025-11"` |
| Trend gap（`BL11`/`night`） | `calendar` 正確標示 `[(2025,11,有資料), (2025,12,無資料), (2026,1,有資料)]`，缺口語意不變 |

四項全部通過，`npm run build`（`dist/_worker.js` 154.52 kB）與 `git diff --check` 皆無錯誤——本階段沒有修改任何前端或 API 程式碼，這組結果同時證實 schema／ETL 的變動確實對現有服務零影響。

---

## 8. Remaining Phase 2B work

以下明確不在本階段範圍內，留給後續階段：

- **Year / holiday / custom range**：`date_ranges`/`range_od_flow`/`range_pagerank` 的 schema 已經是通用設計（可承載任何 `range_type`），但本階段只寫入並驗證 `range_type='month'`。年度、連假、自訂區間的日期集合決定邏輯、`/api/recommend` 與 `/api/analytics/*` 的 `range_type` 參數擴充，都尚未實作。
- **`holiday_events` 表**：架構設計文件 Phase 3a 範圍，本次未新增。
- **前端範圍選擇器**（月/年/自訂/連假四模式共用元件）：未實作，首頁與 `/analytics` 頁的月份選單維持 Phase 1 的實作，未變動。
- **歷史月份回補（backfill）**：目前只有本次匯入的 `2026-01` 擁有 `daily_od_flow`；其他既有已匯入月份（若未來有）仍只停留在月加總粒度，需要個別重新下載 CSV 補齊。
- **Custom range 的即時計算路徑**（Option A 非同步佇列 vs Option B 同步）：兩者都未實作，本階段的 range 計算完全在 ETL 離線批次流程中完成。
- **遠端 D1 的原子性正式驗證**：如第 5.3 節所述，本次只驗證了本地 D1；遠端環境的同等測試（在可拋棄的測試資料庫上重覆「中段注入失敗」實驗）是導入遠端前的必要前置工作，本階段未執行。
- **`apply_to_d1` 效能穩定性**：兩次量測耗時差距達一倍（52s vs 115s），需要在更受控的環境下多次量測、排除本機資源爭用因素，才能得出可信賴的效能基準；目前的數字只能證明「量級可行」，不能作為 SLA。
- **`daily_od_flow` 長期儲存成本**：架構設計文件提出的冷資料封存策略（超過 N 年的逐日資料轉存或捨棄）本階段未評估，因為目前只有一個月份的實測資料量，尚不足以推算長期成長曲線。

本次未執行任何 remote migration，也未部署。
