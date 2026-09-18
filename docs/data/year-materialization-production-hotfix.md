# MetroPulse — Year Materialization Production Hotfix

日期：2026-09-18
狀態：**已在 production 完整驗證，未 deploy 網站**。`year:2025` 已成功 materialize 並通過完整正確性驗證與真實 API smoke test。未執行 Batch 5、未 INSERT 新 holiday metadata、未執行 retention purge。
前置閱讀：Batch 4 執行紀錄（本次會話）、[production-initialization-runbook.md](production-initialization-runbook.md)。

Batch 4（2025 Q4）的 2025-10/11/12 匯入與逐月 parity 全部 PASS，2025 年度覆蓋確認 365/365 天 × 6 期完整。唯一 blocker：`materialize_year_range.py --year 2025 --remote` 在對整年 `daily_od_flow` 執行單一 `SUM...GROUP BY` 時，於 remote D1 觸發 Cloudflare API internal error。本文件記錄根因、修正設計、正確性驗證與 production 重跑結果。

---

## 1. Root cause

### 1.1 錯誤本身

```json
{
  "error": {
    "text": "A request to the Cloudflare API (.../d1/database/.../query) failed.",
    "notes": [{ "text": "internal error; reference = e_PVSMDp_... [code: 7500]" }],
    "kind": "error", "name": "APIError", "code": 7500
  }
}
```

重現兩次，各自獨立的 `reference` ID——確認是**可重現的資源層級限制**，不是單次網路瞬斷。

### 1.2 定位：跟「掃描列數」有關，不是跟「結果列數」有關

診斷過程中額外驗證了一個關鍵點：`verify_year_parity.py` 自己的獨立交叉驗證查詢
（`SELECT period, SUM(flow_count) FROM daily_od_flow WHERE ... GROUP BY period`，
**只有 6 列結果**）對同一份資料執行，**同樣觸發 code 7500**。這排除了「結果集太大」
的假設——兩個查詢的輸出都不算大（一個 ~7 萬列、一個 6 列），差異只在於**都需要掃描
整年 `daily_od_flow` 的全部列**。

```
SELECT COUNT(*) FROM daily_od_flow WHERE service_date BETWEEN '2025-01-01' AND '2025-12-31'
→ 22,702,706
```

這是**第一次**這個聚合路徑在 remote D1 上碰到 production 規模的真實資料——先前所有測試
（Final Gate、disposable rehearsal、Phase 3A 系列）都只用本地 D1 或遠小於此規模的 compact
fixture 驗證過，Phase 3A 文件本身也明確記錄過「正式在 remote 上執行年度 materialization
前，建議先確認帳號方案」，但沒有機會先在 remote 上用真實全年資料量測過這條路徑。

---

## 2. Old / new aggregation design

### 2.1 舊設計（觸發錯誤）

`fetch_range_od_aggregate()`：對 `daily_od_flow` 執行單一
`SELECT from,to,period,SUM(flow_count) ... WHERE service_date BETWEEN <年度範圍> GROUP BY from,to,period`，
一次掃描全年 ~2200 萬列。

### 2.2 新設計：改為加總 12 個月的 `range_od_flow`

新增 `fetch_year_od_aggregate_from_monthly_ranges()`（`scripts/import_od_data.py`），
**只用於年度聚合**，`fetch_range_od_aggregate()` 保持不變、繼續原樣供連假使用（連假最長
9~10 天，daily 掃描量級遠低於觸發門檻，沒有相同風險，不需要、也沒有被改動）：

```
舊：daily_od_flow（整年 ~2200 萬列）→ 單一 GROUP BY from,to,period → od_by_period
新：range_od_flow（12 個月 × range_type='month'，每月已經是 SUM 好的結果）
      → WHERE range_id IN (12 個月) AND period = ?　（按 period 分 6 次查詢）
      → GROUP BY from,to
      → od_by_period
```

**按 period 分批**（而非一次查全部 period）：6 次查詢、每次只需處理 12 個月 × 該
period 的資料（量級與單月匯入時的查詢相當，已經被 Batch 1~4 反覆驗證過可行），
比一次處理全部 6 個 period 的合併查詢負擔更低。

**數學等價性**：每個月的 `range_od_flow` 本身就是「該月 `SUM(flow_count) GROUP BY
from,to,period`」的結果，且已經在每月匯入時被 `verify_range_parity.py` 逐筆驗證過與
`daily_od_flow` 完全一致（Batch 1~4 全部 6/6 PASS）。對 12 個月的 `range_od_flow` 再做
一次 SUM，等於「先分月加總、再加總 12 個分月結果」——整數加法結合律保證這與「直接對
整年 `daily_od_flow` 加總」完全等價，不是近似值。

### 2.3 安全檢查：新增 `verify_all_monthly_ranges_present()`

新來源是 `range_od_flow`，不再是 `daily_od_flow`——如果 `daily_od_flow` 的
`service_date × period` 覆蓋顯示完整，但某個月的 `range_od_flow` 因故沒有正確寫入
（理論上不該發生，但不能假設），新方法會安靜地算出一個少了一整個月的錯誤年度總和。
`materialize_year_range.py` 在呼叫新聚合函式前，先明確查詢 12 個 `month:Y-MM` range_id
是否都存在於 `range_od_flow`，缺任何一個月就印出 `[CRITICAL]` 並以非零狀態碼中止，
不嘗試用不完整的來源硬算。

### 2.4 未變動範圍（明確確認）

- `compute_pagerank()`／`normalize_pr()`／gamma／PageRank 演算法：**零改動**。
- coverage/completeness 判定（365/366 天 × 6 period）：**仍然直接查 `daily_od_flow`**，
  完全不受影響——只有「把 OD 流量加總成一組數字」這一步換了資料來源，「這個年度是否
  完整」的判斷邏輯沒有變。
- 月度匯入管線（`import_od_data.py` 的既有月度流程）：**零改動**。
- `fetch_range_od_aggregate()`（連假使用）：**零改動**。

---

## 3. EXPLAIN QUERY PLAN

對新查詢的 `range_id IN (...) AND period = ?` 篩選條件，本地 D1 執行計畫：

```
QUERY PLAN
|--SEARCH range_od_flow USING INDEX idx_range_od_from (range_id=?)
`--USE TEMP B-TREE FOR GROUP BY
```

`SEARCH ... USING INDEX idx_range_od_from` 確認 `range_id` 篩選走**既有索引的 index
seek**（`idx_range_od_from(range_id, from_station_id, period)`，migrations/0004 就已建立），
不是 full table scan；`IN (...)` 會展開成多次 index seek。`USE TEMP B-TREE FOR GROUP BY`
是對篩選後的小結果集做分組排序，不是對整張表操作，屬預期行為。**沒有新增任何索引**——
既有索引已經足夠，不需要盲目新增。

---

## 4. Correctness parity（本地，真實 2025 年資料）

在本地 D1 上重建與 production 完全同規模的真實測試環境：把 production 匯入時快取的
12 份真實 2025 CSV（`scripts/output/raw-cache/od_2025*.csv`）逐一以 `--apply-local`
匯入本地 D1，得到 **22,702,706 列 `daily_od_flow`**——與 production 的真實列數逐位元組
相同，不是縮小版 fixture。

| 比對項目 | 結果 |
|---|---|
| (from,to,period) 組合總數 | 舊法：71,656　新法：71,656（完全相同） |
| 逐 period OD pair 集合 | 6 個 period 全部 `only_old=0 only_new=0 value_mismatched=0` |
| 全年 OD 總流量 | 舊法：695,109,590　新法：695,109,590（完全相同） |
| PageRank pr_value（118 站 × 6 期，全站，非只比 Top 5） | **max absolute diff = 0.000e+00**，max relative diff = 0.000e+00 |
| pr_rank | 0 筆不相等 |
| normalized_score（容忍度 1e-9） | 0 筆不相等 |

**結論：PASS，新舊兩種聚合方式的結果逐位元組相同。**

之後對本地重建的 2025 年執行完整流程（`materialize_year_range.py --year 2025 --local`
→ `verify_year_parity.py --year 2025 --local`）：全部 PASS，包含腳本自己的獨立
daily-scan 交叉驗證（本地 D1 沒有 remote 的規模限制，可以直接跑）。

---

## 5. Production year:2025 result

```bash
python3 scripts/materialize_year_range.py --year 2025 --remote --db-name mrt-rank-db
```

```
[2/3] 驗證 12 個月的 range_od_flow 都存在 → ✅ 12 個月全部存在
[2b/3] 對 12 個月的 range_od_flow 執行 SQL SUM...GROUP BY（按 period 分批）→ 聚合出 71,656 筆 OD×period 組合
✅ 2025 年已標記為完整年度，range_od_flow/range_pagerank 已寫入（71,656 筆 OD、708 筆 PageRank）
```

`verify_year_parity.py --year 2025 --remote`（同樣需要把腳本自己的 Path A 獨立驗證查詢
改成按曆月分 12 次查詢，見第 6 節）：**全部 PASS**——

- `date_ranges`：`is_complete=1`、`day_count=365=expected_day_count`、起訖日期正確。
- OD 總量守恆：6 個 period 逐一比對 + 全部加總比對，`daily_od_flow` 獨立聚合與
  `range_od_flow` 完全相等（695,109,590 = 695,109,590）。
- PageRank：118/118 站無缺、pr_value 總和 ≈ 1.0（Power Method 正規化不變量）、pr_rank
  為 1..118 完整排列無重複、normalized_score 端點正確（min≈0, max≈1），六個時段全數通過。

**既有 range 確認不受影響**：`date_ranges` 查詢確認 `holiday:lunar-new-year:2025`
（`is_complete=1`）與 12 筆 `month:2025-*` 狀態列全部維持原狀，只新增了 `year:2025`
這一筆，沒有任何既有列被覆蓋或遺失。

---

## 6. verify_year_parity.py 的獨立驗證查詢同步修正

`verify_year_parity.py` 自己的「Path A：直接掃 `daily_od_flow`」交叉驗證查詢
（刻意繞過 `range_od_flow`，避免驗證腳本只是在跟自己比對）在 production 規模資料上
**觸發同一個 code 7500 錯誤**——即使這裡的查詢只有 6 列結果（`GROUP BY period`），
再次確認問題跟結果集大小無關，是掃描列數的問題。

修正方式與 materialize 腳本相同的精神，但**刻意維持「不透過 `range_od_flow`」的獨立性**
（如果改成也從 `range_od_flow` 加總，會失去這個檢查原本要驗證的「和 materialize 用的
是不是同一個來源以外的第二個獨立來源」的意義）：把整年一次查詢拆成**按曆月分 12 次
查詢 `daily_od_flow`**（每次只掃該月 ~200 萬列，Batch 1~4 逐月驗證時反覆確認過這個
量級可行），在 Python 端加總——查詢邏輯本身沒變，還是直接掃 `daily_od_flow`、不透過
`range_od_flow`，只是把「一次掃全年」拆成「12 次各掃一個月」，兩者數學上等價。

---

## 7. Real annual API smoke test

透過 `wrangler dev dist/_worker.js --remote`（本地伺服器、真正連到 production D1，
非部署）驗證：

| 端點 | 結果 |
|---|---|
| `GET /api/recommend?...&range_type=year&year=2025` | `success:true`，`range_type:year`，`range_label:2025年（全年）`，`data_source:real`，`range.is_complete:true`，Top5 為真實年度推薦（`BL11 0.79 / BL18 0.58 / R11 0.56 / BL15 0.5 / BL14 0.43`） |
| `GET /api/analytics/pagerank?range_type=year&year=2025&period=morning_peak` | `success:true`，回傳真實年度 PageRank 排名（`BL12` 第一，`pr_value=0.05729`） |
| `GET /api/analytics/years` | `success:true`，正確列出 `2025`（`day_count:365`） |
| `GET /api/recommend?...&range_type=holiday&event_key=lunar-new-year&year=2025` | `success:true`，`range_label:2025年春節`——確認既有連假功能不受年度 materialize 影響 |

**這是本專案第一次用真實、完整的全年 production 資料驗證年度推薦與年度分析功能**——
先前所有測試都只用 fixture 年度或本地資料，這次是端到端的真實驗證。

---

## 8. Regression / build

| 檢查 | 結果 |
|---|---|
| 月度 parity 抽測（production 2025-01、2025-12，確認 hotfix 改動的共用模組沒有波及月度路徑） | 兩者皆 6/6 PASS |
| `verify_recommend_baseline.py`（本地，固定基準 2026-01 + latest-month smoke check） | PASS（兩組皆 PASS） |
| `npm run build` | 成功，`dist/_worker.js 210.88 kB` |
| `git diff --check` | exit 0 |
| `git diff wrangler.jsonc` | exit 0（本次 API smoke test 直接用 production binding，未修改設定檔） |

---

## 9. 結論

### READY FOR BATCH 5

`year:2025` 已在 production 完整、正確地 materialize，通過本地真實規模資料的正確性證明、
production 上的完整 `verify_year_parity.py` 驗證，以及第一次真實年度 API 端到端 smoke
test。既有月度與連假 range 確認不受影響。PageRank 演算法、gamma、normalization、
推薦計分、月度管線皆零改動——本次修正只改變「年度 OD 流量從哪裡加總」這一件事。

未執行 Batch 5、未 INSERT 新 holiday metadata、未執行 retention purge、未 deploy。
