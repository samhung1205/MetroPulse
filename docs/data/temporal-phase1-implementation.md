# MetroPulse — Temporal Phase 1 Implementation

日期：2026-09-16
狀態：已實作、已本地驗證，**未 migration、未 deploy**
前置閱讀：[temporal-capability-audit.md](temporal-capability-audit.md)、[temporal-architecture-design.md](temporal-architecture-design.md)

本文件記錄 Phase 1（架構設計文件中的「指定月份推薦」與「missing month 趨勢圖缺口標示」）的實作結果。範圍嚴格遵守架構設計：**零 schema 改動、零 ETL 改動、零推薦計分邏輯改動**。

---

## API changes

### `GET /api/recommend`

新增選填參數 `year`、`month`。行為對照設計文件的決策 #1：

| 情境 | 行為 |
|---|---|
| 未提供 `year`/`month` | 與現況完全一致：`data_mode=real/auto` 時使用 `getLatestDataMonth()` |
| `year`/`month` 都提供，且該月已匯入 | 改用該月的 `real_pagerank`/`real_od_flow`（透過既有的 `getRealPageRankMap`/`getRealTransitionMap`，僅替換傳入的 `year`/`month`） |
| `year`/`month` 都提供，但該月**未**匯入 | `404`，訊息包含目前可用月份列表；**不 fallback** 到最新月份或合成資料 |
| 只提供 `year` 或只提供 `month` | `400`（成對驗證） |
| `year`/`month` 非法（非整數、`month` 不在 1–12） | `400` |
| `data_mode=synthetic` 同時帶 `year`/`month` | `400`（合成資料沒有月份概念，語意衝突） |

實作位置：[src/routes/recommend.ts](../../src/routes/recommend.ts)。新增查詢函式 `getDataMonth(db, year, month)`（[src/db/queries.ts:255](../../src/db/queries.ts#L255)），用來驗證指定月份是否已匯入；`404` 訊息中的「目前可用月份」透過既有的 `getDataMonths()` 取得。

回應的 `metadata` 新增兩個欄位（純加法，不刪除既有欄位）：

```jsonc
{
  "metadata": {
    "data_source": "real",
    "data_month": "2026年1月",   // 既有欄位，格式化字串
    "data_year": 2026,           // 新增：數字年，供前端可靠比對，不必解析中文字串
    "data_month_num": 1          // 新增：數字月
  }
}
```

### `GET /api/analytics/trends`

新增回應欄位 `calendar`：以第一筆與最後一筆有資料的月份為界，補齊成連續月曆序列，缺資料的月份 `pr_value`/`pr_rank` 為 `null`、`has_data: false`。既有的 `trends` 欄位（只含實際有資料的月份）維持不變，供仍在讀取舊格式的呼叫端使用。

實作：新函式 `buildContinuousMonthCalendar()`（[src/db/queries.ts:328](../../src/db/queries.ts#L328)），純函式、不觸碰 DB；[src/routes/analytics.ts](../../src/routes/analytics.ts) 在既有查詢後呼叫它組裝 `calendar`。

---

## Homepage month UX

首頁查詢表單（`renderHomePage()`，[src/index.ts](../../src/index.ts)）新增「資料月份」欄位：

- 初始化時並行呼叫 `/api/analytics/months`（新函式 `loadDataMonths()`），與既有的 `loadStations()` 一起 `Promise.all`。
- **有真實月份**：顯示 `<select id="sel-data-month">`，選項為「最新月份（自動）」（`value=""`，預設選取）加上每個已匯入月份（依新到舊排序，label 取自 API）。
- **沒有真實月份**：`month-field` 保持 `hidden`，`queryState.draftQuery.monthValue` 維持預設空字串，行為與 Phase 1 之前完全一致（沿用既有 synthetic/fallback 路徑，不虛構月份選項）。
- 選擇非「最新月份」選項時，`submitRecommendation()` 會在查詢參數加上 `year`/`month`；選「最新月份（自動）」則不帶這兩個參數，對應後端「未指定→維持 latest-month 行為」。
- `matchesDraft()` 新增比對 `month_value`，使得**變更月份而未重新查詢**時，會與變更時段/偏好一樣觸發「條件已變更，請重新查詢」提示（`#query-changed` / `#results-stale-note`），舊結果不會被誤認為屬於新月份。
- 結果摘要（`#query-summary`）新增「資料月份」列，其值**一律取自 API 回應的 `metadata.data_month`**（伺服器確認的實際月份），不是使用者送出時選的草稿值——即使草稿之後被改掉，已顯示的結果仍精確標示它實際屬於哪個月。
- 找不到指定月份時（`404`），前端顯示 API 回傳的錯誤訊息（如「找不到 2026 年 5 月的旅運資料」）並提示改選其他月份，而不是顯示通用的「暫時無法取得推薦」。

---

## Trend-gap behavior

`/analytics` 頁「月份資料」頁籤（`renderAnalyticsPage()`，[src/index.ts](../../src/index.ts)）：

- 折線圖與表格改用 `calendar`（連續月曆序列）而非 `trends`（只有資料的月份），缺資料月份在圖表資料陣列中是 `null`。
- 折線資料集加上 `spanGaps: false`，Chart.js 會在 `null` 值處斷開線段，不連到下一個有值的點——**不插值**。
- 表格每一列都涵蓋連續月曆，缺資料列加上 `mp-trend-missing` class（斜體、灰色文字），PR 值與排名欄位顯示「資料缺失」，而非略過該列或顯示 0。
- 摘要文字在有缺月時額外提示「期間另有 N 個月份缺資料，圖表與表格會明確標示，不插值、不補 0」。
- `hasTrend`（是否啟用折線圖/跨月標題）的判斷仍以「實際有資料的月份數」（`trends.length > 1`）為準，不受補齊後的 calendar 長度影響——只有一個真實月份時不會因為 calendar 只有一格而錯誤判斷。

---

## Backward compatibility

- `/api/recommend` 不帶 `year`/`month` 時的行為與輸出（包含 `data_source`、`data_month`、推薦排序與分數）與 Phase 1 之前**逐位元組相同**（見下方「tests / build」的基準比對）。
- `/api/analytics/trends` 的既有 `trends` 欄位未變動；`calendar` 是新增欄位，舊前端或第三方呼叫端忽略它即可。
- 未改動 `computeRecommendations()`/`computeScoreBreakdown()`/`normalizeValue()`（`src/lib/recommender.ts`）、任何 migration 檔案、`scripts/import_od_data.py`。
- 合成軌道（`/api/pagerank`、Station Detail）完全不在改動範圍內。

---

## Tests / build

### 本地測試月份設置

本地 D1（`.wrangler/state`，已被 `.gitignore` 排除，不會進入版本控制）原本只有 `2026-01` 一個月份。為了驗證「指定月份真的讀不同月份」而非碰巧回傳同一份資料，額外灌入一個**時間早於既有最新月份**的測試月份 `2025-11`：`real_pagerank`/`real_od_flow` 以 `2026-01` 資料為底、依 `period` 乘上不同係數複製而成（例如 `night` 期 PR 值乘 1.55、OD 流量乘 0.92），確保兩個月份的原始數值可明確區分，同時因為 `2025-11` 早於 `2026-01`，**不影響「未指定月份→最新月份」的既有行為**（最新月份仍是 `2026-01`）。

### 測試結果

| 測試情境 | 結果 |
|---|---|
| 不指定月份 → latest | `data_month: "2026年1月"`，推薦排序/分數與變更前**逐位元組相同**（見下方基準比對） |
| 指定有效月份（`year=2025&month=11`） | `success:true`，`data_month: "2025年11月"`；`score_breakdown.popularity.raw` 為 `0.0813`，對照 latest 月份的 `0.0525`（比例吻合 night 期 ×1.55 的測試係數），證實讀到的是不同月份的真實資料，不是巧合回傳同一份 |
| 指定不存在月份（`year=2026&month=5`） | `404`，`{"error":"找不到 2026 年 5 月的旅運資料","hint":"目前可用月份：2026-01、2025-11"}` |
| 只給 `year`（無 `month`） | `400`，「year 與 month 必須成對提供」 |
| 只給 `month`（無 `year`） | `400`，同上 |
| `data_mode=synthetic` + `year`/`month` | `400`，「data_mode=synthetic 不支援指定 year/month」 |
| 快速切換月份（同一 session 內連續兩次 submit，第一次 2025-11、第二次 2026-01） | 最終顯示結果為 `2026年1月`（後送出的請求），未出現 stale response |
| 變更月份但未重新查詢 | `#query-changed`/`#results-stale-note` 正確顯示，舊結果仍標示原本月份（未被誤認為新月份） |
| missing-month trend gap（`BL11`/`night`，涵蓋 `2025-11`→`2025-12`(缺)→`2026-01`） | `calendar` 正確補上 `2025-12` 為 `has_data:false`/`pr_value:null`；Chart.js 資料陣列對應位置為 `null`、`spanGaps:false`；表格該列顯示「資料缺失」並套用 `mp-trend-missing` 樣式；圖表視覺上兩點不連線（已截圖確認） |
| 390 / 768 / 1440 responsive | 三個寬度下「資料月份」欄位與其餘表單元素排列正常，無溢出或遮擋（已截圖確認） |
| `BL11 → night → food` 未指定月份 baseline | 與變更前的回應比對：推薦站點 ID 順序、`total_score`、`data_month`、`total_stations_evaluated` 全部相同 |

### Build

```
npm run build   # ✓ built in 127ms，dist/_worker.js 154.52 kB
git diff --check  # 無空白字元錯誤
```

---

## Deferred to Phase 2+

以下項目維持在架構設計文件的 Phase 2/3 範圍，本次**未實作**：

- `daily_od_flow`、`date_ranges`、`range_od_flow`、`range_pagerank`、`holiday_events` 等新資料表與對應 migration。
- ETL 保留 `service_date`、通用聚合引擎（月/年/連假/自訂共用同一條 SUM + Power Method 管線）。
- 年度推薦、自訂區間推薦、連假推薦與跨年連假比較。
- 首頁/分析頁的「月 / 年 / 自訂 / 連假」四模式共用範圍選擇器（本次僅實作月模式的月份下拉）。
- 歷史月份的逐日資料回補（backfill）。
- Cloudflare D1 效能量測與 `custom` range 的天數上限、非同步計算流程（Option A/B）。

本次未執行任何 migration，也未部署。
