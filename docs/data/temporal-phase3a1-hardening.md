# MetroPulse — Temporal Phase 3A.1：年度完整性 + Detail Context 收尾

日期：2026-09-18
狀態：已實作、已在本地與 disposable remote D1 驗證，**未部署 production**
前置閱讀：[temporal-phase3a-year-implementation.md](temporal-phase3a-year-implementation.md)、[temporal-architecture-design.md](temporal-architecture-design.md)、[docs/uiux/02-design-direction.md](../uiux/02-design-direction.md)

Phase 3A 已經做出「年度推薦」這個新能力；Phase 3A.1 不新增產品功能，只收尾兩個
data-truth／UX 缺口：(1) 完整性判定過鬆，(2) 年度推薦進站點詳情後失去自己的 temporal
context、也拿不到年度證據。

---

## 1. Completeness rule（service_date × period）

**舊規則的漏洞**：`compute_year_coverage()` 只檢查 `COUNT(DISTINCT service_date)` 是否等於
365/366，且 `MIN`/`MAX` 落在年份邊界。一個「365 天都有資料，但某一天只匯入 5 個 period」的
年度會被判成完整——因為 distinct 天數沒變，只是某天資料不齊。

**新規則**（[materialize_year_range.py](../../scripts/materialize_year_range.py) `compute_year_coverage()`）：
一個年度必須同時滿足：

1. 365/366 天都有 `daily_od_flow` 資料（沿用既有檢查）。
2. **每一個有資料的日期，六個既有 period 都必須各至少一列**——用
   `GROUP BY service_date HAVING COUNT(DISTINCT period) <> 6` 直接抓出不齊的日期，
   完整年度這個查詢應該回傳 0 列。

明確**不**要求：同一天每個 OD pair 都存在（人流本來就會自然缺席某些 OD pair）；
明確**不**對缺的 period 補 0——缺 period 的日期直接讓整個年度判定為不完整，
不摻入 PageRank 計算。

**新增 `date_ranges.coverage_note`**（[migrations/0006_range_coverage_note.sql](../../migrations/0006_range_coverage_note.sql)，
純加欄位）：materialize 時把「為什麼不完整」寫成一句人可讀的說明（例如
`1 天沒有完整六個時段的資料，例如 2029-03-15 缺少 evening_peak`），完整年度時為 `NULL`。
`recommend.ts`／`analytics.ts` 的不完整年度 404 回應新增 `coverage.note` 欄位帶出這個說明
（additive，既有欄位不變）。

---

## 2. 反例測試（negative completeness test）

[build_year_fixture.py](../../scripts/build_year_fixture.py) 新增 `--corrupt-period MM-DD:period`：
先建出完整 365/366 天的年度，再刪掉指定那一天的某個 period，製造「天數看起來完整、
但缺一個 period」的反例。[verify_year_parity.py](../../scripts/verify_year_parity.py) 新增
`--expect-incomplete` 模式：只驗證 `is_complete=0`、`coverage_note` 有值、且 `range_od_flow`/
`range_pagerank` 完全沒被污染（不完整年度不該留下任何聚合結果的殘影）。

**實際跑過的驗證**（本地 D1，年份 2029，刪除 `2029-03-15` 的 `evening_peak`）：

```
涵蓋 365/365 天（2029-01-01 ~ 2029-12-31）
service_date × period 覆蓋：1 天沒有完整六個時段資料
  - 2029-03-15：缺 evening_peak
完整性：⚠️ 不完整
coverage_note：1 天沒有完整六個時段的資料，例如 2029-03-15 缺少 evening_peak
```

`verify_year_parity.py --year 2029 --local --expect-incomplete` 全部 PASS：
`is_complete=0`、`coverage_note` 有值、`range_od_flow`/`range_pagerank` 皆為 0 筆。

**回歸確認**：同一套邏輯套用在既有完整年度 2027（365/365 天、逐日逐 period 皆齊）不受影響——
`verify_year_parity.py --year 2027 --local` 全部 PASS（OD 守恆 772,324,718 = 772,324,718、
118/118 站、pr_value 總和 ≈1.0、`coverage_note` 為 `NULL`）。新規則沒有讓一個真正完整的年度
被誤判為不完整。

---

## 3. Station Detail 年度支援

**設計**：`/api/station-detail/:id?range_type=year&year=Y`
（[station-detail.ts](../../src/routes/station-detail.ts)）。不帶參數時行為與 Phase 3A 前
完全一致（合成軌道 `pagerank_scores`/`transition_matrix`）——用實際 curl 比對過兩者回應，
byte-for-byte 相同。

**canonical station id 解析**（新問題，Phase 3A 沒處理過）：轉乘站在 `stations` 表對每條線
各有一列（如台北車站的 `BL12`/`R10`，同 `name_zh`、不同 `id`），但 ETL 只用「主線代表站」
的 id 算 `daily_od_flow`/`range_pagerank`。直接拿 `R10` 去查 `range_pagerank` 會查到 0 筆，
不是真的沒資料。新增 [`resolveRangeStationId()`](../../src/db/queries.ts)：先看請求的 id
本身在該 range 有沒有資料，沒有就用 `name_zh` 找同名列裡真正在 `range_pagerank` 出現過的
那個 id。實測 `R10` 正確解析到 `BL12`，回傳的 PageRank 時序與直接查 `BL12` 完全一致。

**證據來源**：直接讀 `range_pagerank`/`range_od_flow`，**不重新計算 PageRank**——
`getRangePageRankByStation()` 取某站各時段值；`getRangeOdFlowFrom`/`getRangeOdFlowTo()`
取原始 `flow_count`，在 route 層依「同站同時段」總量換算 `transition_prob`（作法與既有
`getRangeTransitionMap()` 一致，只是一次算完所有時段供 Detail 頁用）。

**graceful degradation**：年度不存在／不完整／解析不到對應站點時，**不讓整頁失敗**——
只是不附加年度證據，`metadata.range_error` 誠實說明原因，前端顯示一行說明後改用既有
預設資料，不假裝有年度資料。實測 `range_type=year&year=2029`（不完整年度）：
`pagerank_source` 正確退回 `pagerank_scores`，`range_error` 顯示
「2029 年的旅運資料不完整，暫時無法提供年度證據」。

**前端 context 串接**（Phase 3A 遺留缺口，這次一併修）：
- `detailContextHref()` 把 `range_type`/`year`（或 `year`/`month`）一起帶進 Detail 的 deep link。
- `readRecommendationContext()` 解析並驗證這些參數（格式錯誤就當沒帶，不擋整個 context）。
- `loadStationDetail()` 用這個 context 同時查 `/api/station-detail/:id` 與重新查
  `/api/recommend`（原本重新查 recommend 時完全沒帶 range 參數，年度推薦進 Detail 後
  「與本次推薦的關係」區塊會用月模式資料回填，是真的 bug，這次修掉）。
- `homeQueryUrl()`／「返回本次推薦」連結把 range context 一併帶回首頁；首頁新增
  `applyRangeContextFromUrl()`，在 `loadDataMonths()`/`loadDataYears()` 之後比對實際可用的
  月份／年度才還原（無效或不存在的參數不還原，不虛構選項）。

實測整條路徑：首頁選年度 2027 → 查看推薦 → 進站點詳情（顯示「資料範圍：2027 全年度」，
PageRank 表與人流連結都是 2027 全年度數字）→ 按「返回本次推薦」→ 首頁正確恢復年度模式、
2027、且結果摘要顯示「2027年（全年）」——Phase 3A 原本會悄悄退回月模式的問題已修正。

---

## 4. Remote Paid D1 smoke test

使用 disposable 資料庫 `metropulse-smoke-3a1-test`（非 `mrt-rank-db`），流程：

```
wrangler d1 create metropulse-smoke-3a1-test
  → 暫時在 wrangler.jsonc 加入該 DB 的 binding
    （wrangler d1 migrations apply 需要 config 裡看得到這個 DB，純 d1 execute 不需要，
      這是這次才發現的差異）
  → bootstrap_db.py --remote --db-name metropulse-smoke-3a1-test（3 步驟 bootstrap，
    含這次新增的 migration 0006，全部成功）
  → build_remote_smoke_fixture.py --year 2031 --remote（新增的 compact fixture 產生器，
    只寫固定 8 組 OD pair × 365 天 × 6 period = 17,520 列，不是 22M 列的完整合成年度）
  → materialize_year_range.py --year 2031 --remote（708 筆 PageRank、48 筆 OD×period）
  → verify_year_parity.py --year 2031 --remote --expect 完整（全部 PASS：OD 守恆
    3,457,800 = 3,457,800、118/118 站、pr_value 總和 ≈1.0）
  → 直接查 range_pagerank 確認欄位形狀與本地／API 消費端一致
  → 還原 wrangler.jsonc（git diff wrangler.jsonc 確認為空）
  → wrangler d1 delete metropulse-smoke-3a1-test（wrangler d1 list 確認只剩 mrt-rank-db）
```

全程沒有對 `mrt-rank-db` 執行任何寫入或 migration 指令。

---

## 5. UI / accessibility

年度 temporal context 遵循 [02-design-direction.md](../uiux/02-design-direction.md) 的「克制」
原則：Detail 頁新增的只是站點識別區塊下方一行小字「資料範圍：2027 全年度」（沿用既有
`.mp-data-limit` 樣式與 token，沒有新增卡片、沒有新 CSS class），以及既有「資料依據」段落
的說明文字依資料來源動態調整（例如「連結值來自 2027 全年度 range_od_flow」）。沒有 redesign
Detail 頁的既有版面。

- **Responsive**：390/768/1440 皆截圖確認，年度切換 UI（首頁沿用 Phase 3A 既有的月／年
  2 欄 toggle）無 overflow、無版面破版。
- **Keyboard/focus**：年度相關控制沿用既有 `.mp-query-chip` 元件與其
  `:has(input:focus-visible)` focus 樣式規則（Phase 3A 已驗證過的既有模式），沒有新元件、
  沒有新的 focus 邏輯需要驗證。
- **Direct deep link 無 range context**：`/station/BL12`（無參數）行為與 Phase 3A 前
  完全一致，實測 API 回應 byte-for-byte 相同。

---

## 6. 回歸 / build

| 檢查 | 結果 |
|---|---|
| 2027（正例）`verify_year_parity.py` | PASS（OD 守恆、118/118 站 PageRank、rank/normalize 不變量全過） |
| 2029（反例）`verify_year_parity.py --expect-incomplete` | PASS（is_complete=0、coverage_note 有值、range_* 表 0 筆） |
| `/api/recommend?range_type=year&year=2027` | 200，推薦結果正常 |
| `/api/recommend?range_type=year&year=2029` | 404，`coverage.note` 正確帶出缺失原因 |
| `/api/analytics/years` | 只列出 2027（2028/2029 皆被排除） |
| `/api/station-detail/BL12?range_type=year&year=2027` | 年度證據正確（range_pagerank/range_od_flow 來源） |
| `/api/station-detail/R10?range_type=year&year=2027`（alias 站） | 正確解析到 BL12，證據與 BL12 一致 |
| `/api/station-detail/BL12?range_type=year&year=2029`（不完整） | 200，graceful fallback，`range_error` 有值 |
| `/api/station-detail/BL12`（無參數） | 與 Phase 3A 前 byte-for-byte 相同 |
| BL11→night→food 基準 | `['BL12','BL10','R11','BL18','BL15']` / `[0.79,0.38,0.38,0.37,0.33]`，不變 |
| 年度推薦 → Detail → 返回推薦 | context（範圍/年度）正確保留，Phase 3A 遺留的退回月模式 bug 已修正 |
| Remote Paid D1 smoke test | 全鏈路 PASS，disposable DB 已刪除，`mrt-rank-db` 未被觸碰 |
| `npm run build` | 成功，`dist/_worker.js 175.04 kB` |
| `git diff --check` | exit 0 |
| `git diff wrangler.jsonc` | exit 0（暫時 binding 已還原） |

---

## 未變動範圍

- 不涉及 holiday / custom range。
- 不改變 `computeRecommendations()`/`normalizeValue()`/PageRank 演算法本身。
- 不 redesign Detail 頁既有版面；只新增一行克制的 temporal context 說明與資料來源文字。
- 未部署 production；所有驗證使用本地 D1 與 disposable remote D1，皆已清除。
