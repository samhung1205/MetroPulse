# MetroPulse — Temporal Phase 3B.1：歷年同連假比較（Cross-Year Same-Holiday Comparison）

日期：2026-09-18
狀態：已實作、已在本地與 disposable remote D1 驗證，**未部署 production**
前置閱讀：[temporal-phase3b-holiday-implementation.md](temporal-phase3b-holiday-implementation.md)、
[temporal-phase3a1-hardening.md](temporal-phase3a1-hardening.md)、
[temporal-architecture-design.md](temporal-architecture-design.md)、
[docs/uiux/02-design-direction.md](../uiux/02-design-direction.md)

Phase 3B.1 只在 **Analytics** 新增「歷年同連假比較」。首頁 Recommendation 完全不變——維持
Phase 3B 的單一 holiday-year 查詢，跨年比較沒有塞進首頁。**沒有新的計算**：比較資料一律直接讀
`holiday_events`/`date_ranges`/`range_pagerank`/`range_od_flow`，不重新跑 PageRank。

---

## 1. Comparison API

新增 `GET /api/analytics/holiday-comparison?event_key=&period=&station=`（[analytics.ts](../../src/routes/analytics.ts)）。
比較依 `event_key` 對齊（穩定識別碼），不是依固定國曆日期——同一個 `event_key` 底下有幾個年份，
就回傳幾個年份，天然支援「2024 春節 vs 2025 春節 vs 2026 春節」這種查詢，不需要另外猜日期。

回應對每個已登錄年份回傳：

```jsonc
{
  "year": 2025, "range_id": "holiday:...", "start_date": "...", "end_date": "...",
  "event_source": "...",
  "status": "complete" | "incomplete" | "not_materialized" | "unavailable",
  "reason": null | "說明文字",
  "day_count": 9, "expected_day_count": 9,
  "pagerank": { "pr_value": ..., "pr_rank": ..., "normalized_score": ... } | null,
  "flow": { "outbound_total": ..., "inbound_total": ..., "outbound_avg_daily": ..., "inbound_avg_daily": ... } | null,
  "source": { "pagerank_source": "range_pagerank", "flow_source": "range_od_flow" }
}
```

**刻意取「所有」已登錄年份**（`getHolidayEventsByKey()`，新增查詢函式），不只完整年份——
不完整或尚未計算的年份仍然出現在回應裡，只是 `pagerank`/`flow` 為 `null`、`status`/`reason` 說明
原因，不會從清單裡悄悄消失讓使用者誤以為那個年份不存在。

實作上完全重用 Phase 3A.1/3B 既有的函式：`getDateRange()`、`resolveRangeStationId()`（轉乘站
別名解析）、`getRangePageRankByStation()`、`getRangeOdFlowFrom()`/`getRangeOdFlowTo()`——
沒有新增任何一個會重新計算 PageRank 或重新聚合 OD 的函式。

---

## 2. Statistical semantics

- **Recommendation Score 不作為跨年比較 metric**——回應裡根本不包含 `total_score`／推薦排序分數，
  只回傳 PageRank 與 Flow 兩類，避免使用者誤把「排序分數」當成可跨年比較的統計量（排序分數的
  權重、正規化基準是同一次查詢內部的相對值，本來就不適合拿來跨年直接比較）。
- **Same-holiday years 視為 categorical observations**，不是連續趨勢：前端兩張圖都是 Chart.js
  `bar`（類別長條圖），x 軸是離散的年份標籤，不是時間刻度；沒有折線圖、沒有 `spanGaps` 這類
  「連續但缺值」的處理，因為這些年份之間本來就不是等距的時間點。
- **Average daily flow = total ÷ day_count**：不同年份的連假天數不同時（本次驗證用 5 天 vs 9 天），
  UI 不只比較 raw total——每年同時列出 `day_count`、`outbound_total`／`inbound_total`（原始總量）
  與 `outbound_avg_daily`／`inbound_avg_daily`（平均每日），圖表用平均值做跨年比較（公平），
  表格保留原始總量與天數（不隱藏期間差異）。分母是 `date_ranges.day_count`（實際涵蓋天數，
  已通過完整性檢查即等於 `expected_day_count`），不是預期天數。

---

## 3. Analytics UX

新增第 4 個分頁「連假比較」（[index.ts](../../src/index.ts)），**重用既有的 tablist 元件**
（`role="tablist"`/`role="tab"`/roving tabindex/方向鍵），不是重新做一套 tab 系統——鍵盤導覽
因此不需要額外驗證邏輯，直接繼承既有已驗證過的無障礙行為（實測 ArrowLeft 從第一個 tab 正確
循環到新分頁）。

- 控制項：連假（event_key，選項來自 `/api/analytics/holidays`，只列出至少有一個完整年份的
  event）、站點（沿用「月份資料」分頁既有的站碼／站名輸入＋datalist 建議模式）、時段。
- **Categorical dot/bar comparison**：兩張獨立的 Chart.js `bar` 圖——PageRank（單一中性色）與
  平均每日人流（出發／抵達兩個資料集，分別用 `--mp-accent`／`--mp-score-flow` 兩個既有中性
  token，不是路線色，也不是彩虹色）。
- **Accompanying data table**：`.mp-data-table`（既有樣式）列出年份、連假日期、天數、PageRank、
  排名、出發總量、平均每日出發、抵達總量、平均每日抵達、狀態十個欄位，`.mp-table-scroll`
  提供受控的本地水平捲動（見第 5 節）。
- **Explicit year + holiday date range**：每一列都顯示 `start_date ～ end_date`，不只顯示年份
  數字。
- 明確避免：dashboard 卡片（沒有任何 stat-tile／summary card，只有圖＋表）、路線色當資料色、
  彩虹色（全程只用 2 個既有中性 token）、誤導性連續趨勢線（兩張圖都是 bar，不是 line）。
- 同一 station 跨年保持同一視覺語意——比較本來就是「單一站點、跨年份」，色彩語意天然一致
  （PageRank 圖只有一個資料系列；Flow 圖的「出發」「抵達」兩個系列跨年份固定用同一組顏色）。

---

## 4. Missing/incomplete handling

三種非完整狀態明確區分（不是統一的「無資料」）：

| status | 情境 | 表格呈現 |
|---|---|---|
| `not_materialized` | `holiday_events` 有登錄，但 `date_ranges` 從未寫入過狀態列 | 斜體列，「尚未計算」＋原因 |
| `incomplete` | `date_ranges.is_complete=0` | 斜體列，「不完整」＋`coverage_note`（缺哪天／缺哪個 period） |
| `unavailable` | 完整年度，但該站解析不到對應資料 | 斜體列，「此站無資料」＋原因 |
| `complete` | 正常 | 正常列，完整數值 |

非完整年份的 `pagerank`/`flow` 一律是 `null`，**前端顯示「資料不足」，不是 `0`**（表格渲染函式
`renderCompareTable()` 逐欄檢查 `Number.isFinite()`，不會把 `null` 轉成 `0` 顯示）。圖表端更嚴格：
`renderCompareCharts()` 先 `filter(y => y.status === 'complete')` 才組資料，非完整年份**完全不會
出現在圖表的 x 軸上**——不是畫一個 0 高度的柱狀，是那個類別根本不存在，避免「柱子很矮」被
誤讀成「這年很冷門」。一句彙總說明（`compare-unavailable-note`）列出被排除的年份與具體原因，
不是靜默省略。

---

## 5. Responsive/accessibility

- 390/768/1024/1440 四個寬度皆截圖驗證：`document.body.scrollWidth > window.innerWidth` 全部
  回傳 `false`（無 page-level 水平溢出）。
- 兩張圖表在所有寬度下垂直堆疊（沿用既有 `.mp-analytics-chart` 響應式容器，新增
  `#compare-pr-chart-wrap`/`#compare-flow-chart-wrap` 專用高度 320px，避免手機上兩張全高圖
  疊加造成過長頁面）。
- 資料表在窄螢幕正確觸發**受控的本地水平捲動**（`.mp-table-scroll` 既有樣式，390px 下截圖
  確認表格內部出現捲軸、頁面本身不橫向捲動）——符合「若年份很多，優先可讀 table / controlled
  local overflow」的要求。
- Keyboard/focus：新分頁按鈕與既有三個分頁共用同一個 `[role="tab"]` 集合與同一套鍵盤事件處理，
  未新增任何 bespoke focus 邏輯；實測方向鍵可正確在 4 個分頁間循環導覽。

---

## 6. Validation/regression

### 3 個本地 compact fixture（同一 `event_key='test-compare'`，`build_compact_holiday_fixture.py`）

不使用真實資料模板或數千萬列的合成資料——這支新腳本直接生成極少量固定 OD pair（跟 Phase 3B
remote smoke test 用的手法相同），只驗證管線本身，不驗證大資料量統計特性：

| 年份 | 天數 | 狀態 | 結果 |
|---|---|---|---|
| 2024 | 5 天（完整） | complete | `verify_holiday_parity.py` PASS：118/118 站、pr_value≈1.0 |
| 2025 | 9 天（完整，天數刻意與 2024 不同） | complete | 同上 PASS |
| 2026 | 4/5 天（缺一天） | incomplete | `coverage_note`＝「僅涵蓋 4/5 天」，`range_od_flow`/`range_pagerank` 皆 0 筆 |

### API 直接驗證

- `event_key=test-compare&station=BL01`：2026 正確回傳 `pagerank:null, flow:null, status:incomplete`；
  2024/2025 正確回傳數值，`outbound_total` 280（5 天）vs 889（9 天），
  `outbound_avg_daily` 56.0 vs 98.8——證明 day_count 正規化計算正確，兩年天數不同時不是直接比較
  raw total。
- **PageRank/rank correctness**：2024/2025 的 `pr_value`／`pr_rank` 相同（0.006537／#9），
  這是資料層面合理的結果（此站在合成 fixture 裡只有單一出邊，transition 機率不受流量絕對值
  影響，只受相對結構影響）——不是比較邏輯的錯誤，Power Method 的既有不變量（118/118 站、
  pr_value 總和≈1.0、rank 為完整排列）在兩年各自的 `verify_holiday_parity.py` 都已經獨立驗證過。
- **Alias station**：`BL23`（南港展覽館，板南線）與其別名 `BR24`（文湖線同名站）查詢結果
  完全一致（`pr_value`/`pr_rank`/`flow` 逐一比對相同）——證明 `resolveRangeStationId()` 在
  comparison 端點正確運作。
- **既有 Analytics 回歸**：`/api/analytics/pagerank?year=2026&month=1`（月模式）、
  `/api/analytics/holidays`（正確排除 `test-compare:2026` 不完整年份，只列出 2024/2025）皆與
  本 phase 前行為一致。

### 前端

- 連假比較分頁：選 `測試比較連假` → 輸入 `BL01` → 送出 → 摘要文字「共 3 個已登錄年份，2 個
  完整可比較」，未列入圖表的說明文字列出 2026 年與具體原因，兩張長條圖各只有 2024/2025 兩根
  柱（2026 正確被排除，不是畫成 0）。
- Table 逐欄核對：2026 列全部顯示「資料不足」而非 0；2024/2025 列顯示正確數值。
- 響應式：390/768/1024/1440 全數確認無 page-level 水平溢出；390px 下表格局部捲動正常運作。
- Keyboard：ArrowLeft 從「站點排名」分頁正確循環到「連假比較」分頁，焦點、`aria-selected`、
  面板可見性三者同步正確。
- BL11→night→food 基準：`['BL12','BL10','R11','BL18','BL15']` / `[0.79,0.38,0.38,0.37,0.33]`，
  全程不變。

### Remote Paid D1 smoke test

Disposable `metropulse-smoke-3b1-compare`：建立 → 暫時加入 `wrangler.jsonc` binding →
`bootstrap_db.py --remote`（7 個 migration 全部成功）→
`build_compact_holiday_fixture.py --remote`（兩個 compact fixture，`remote-compare:2024` 5 天、
`remote-compare:2025` 9 天，各僅 240/432 列 `daily_od_flow`，不是數千萬列）→
`materialize_holiday_range.py --remote`（各 708 筆 PageRank）→
`verify_holiday_parity.py --remote` 兩年皆全部 PASS → 還原 `wrangler.jsonc`（`git diff` 確認為空）→
`wrangler d1 delete`（`wrangler d1 list` 確認只剩 `mrt-rank-db`）。全程未對 `mrt-rank-db`
執行任何寫入或 migration 指令。

### Build

| 檢查 | 結果 |
|---|---|
| `npm run build` | 成功，`dist/_worker.js 210.88 kB` |
| `git diff --check` | exit 0 |
| `git diff wrangler.jsonc`（暫時 binding，已還原） | exit 0 |

---

## 7. 延後（Custom-range 相關工作）

- **Custom date range**：本 phase 的比較端點仍然只讀既有 `holiday_events`/`date_ranges`——
  跟 Phase 3B 一樣，custom range 需要的同步計算效能路徑（Cloudflare Workers CPU 時間限制）與
  非同步排隊機制尚未設計實作，不在本 phase 範圍內。
- 跨年比較目前限定「同一個 event_key」；跨「不同」連假事件（例如春節 vs 端午）的比較不是本
  phase 的範圍，也不符合「依 stable event_key 對齊」的比較語意本身。
- 圖表目前一次比較一個站點；批次多站同時比較（例如整條路線）留待後續評估是否需要，避免
  在本 phase 引入尚未確認需求的介面複雜度。

不改變 recommendation scoring；不改變首頁；未部署 production；所有驗證使用本地 D1 與
disposable remote D1，皆已清除。
