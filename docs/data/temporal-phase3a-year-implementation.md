# MetroPulse — Temporal Phase 3A: Monthly + Year Recommendation

日期：2026-09-17
狀態：已在本地完整驗證（含一個合成但結構真實的完整年度 fixture）；**未 deploy production、未對 remote D1 寫入任何 Phase 3A 資料**
前置閱讀：[temporal-architecture-design.md](temporal-architecture-design.md)、[temporal-phase1-implementation.md](temporal-phase1-implementation.md)、[temporal-phase2a-implementation.md](temporal-phase2a-implementation.md)、[temporal-phase2b-hardening.md](temporal-phase2b-hardening.md)、[temporal-phase2c-foundation.md](temporal-phase2c-foundation.md)

本階段新增真正的「年度推薦」，並把首頁與分析頁的月份選擇自然演進為「資料範圍〔月份｜年度〕」。**沒有實作 holiday/custom range，沒有修改推薦計分邏輯（weights/gamma/normalize）**。

---

## 1. Yearly range computation

### 設計：沿用 daily_od_flow → range_od_flow → range_pagerank，禁止平均月度 PageRank

新增 [scripts/materialize_year_range.py](../../scripts/materialize_year_range.py)，流程與月度 range 完全共用同一條管線（[queries.ts](../../src/db/queries.ts) 的 `getRangePageRankMap`/`getRangeTransitionMap` 對月／年一視同仁）：

```
daily_od_flow（已持久化的逐日資料）
  │  SQL SUM(flow_count) GROUP BY from,to,period WHERE service_date BETWEEN 該年 1/1 ~ 12/31
  ▼
range_od_flow（range_id='year:{year}'）
  │  compute_pagerank() / normalize_pr()（與月度、real_pagerank 完全相同、未修改的函式）
  ▼
range_pagerank（range_id='year:{year}'）
```

**沒有任何程式路徑對已算好的月度 `pr_value` 做平均**——年度 PageRank 一律從整年 OD 流量重新建轉移矩陣、重新跑 Power Method，與月度 range 的計算方式（Phase 2A 已驗證）完全對稱，只是聚合的日期集合換成整年。

### 完整性（completeness）判斷

新增 migration [0005_range_completeness.sql](../../migrations/0005_range_completeness.sql)：`date_ranges` 純新增 `is_complete`／`expected_day_count` 兩個欄位（`ALTER TABLE ADD COLUMN`，不動既有欄位或資料）。

一個年度被判定為「完整」，若且唯若 `daily_od_flow` 對該年 1/1～12/31（依閏年為 365 或 366 天）**每一天都至少有一列資料**——不是「有 12 個月份的資料就好」，因為 Phase 2A 已知月份匯入本身可能不完整。

- **完整**：`date_ranges` 寫入 `is_complete=1`，**同時**寫入 `range_od_flow`／`range_pagerank`。
- **不完整**：`date_ranges` 仍會更新狀態列（準確記錄 `day_count`/`expected_day_count`，讓維運者知道目前缺多少天），但**不計算、不寫入** `range_od_flow`／`range_pagerank`——不會有一份用不完整資料算出、卻沒被標記的 PageRank 結果存在資料庫裡，杜絕任何查詢路徑意外讀到它的可能性，而不只是靠 API 那一層過濾。

### 驗證用 fixture：真正的完整年度，不是拿一個月假裝

Phase 3A 明確禁止「只有一個月的 production-like data 假裝全年」。新增 [scripts/build_year_fixture.py](../../scripts/build_year_fixture.py)，用 Phase 2A 已驗證過的真實 2026-01 逐日資料當模板，依每個月實際天數（正確處理 2/28 vs 大月 31 天）與**十二個不同倍率**重新映射服務日期，在本地 D1 合成出 **2027 年全年 365 天、22,216,671 列**的 `daily_od_flow`——逐日粒度是真的（每天都有獨立列），OD 流量因為十二個月各自倍率不同而彼此可區分（不是同一份資料複製十二次）。另外用 `--incomplete-months` 合成了 **2028 年（只填 8/12 個月，244 天）**專門測試不完整年度路徑。

---

## 2. API

### 保持 Phase 1 backward compatibility

`/api/recommend` 完全不帶 `range_type`／`year`／`month` 時的行為，與帶 `range_type=month`（新增的顯式預設值）時完全相同，都是既有的「未指定→取得最新月份」邏輯——**這段程式碼路徑一個字元都沒有動**，只是外面多包了一層 `if (rangeType === 'month' ...)` 判斷。實測：

```
GET /api/recommend?from=BL11&time_period=night&preference=food
→ metadata.data_month=2026年1月, metadata.range_type=month, metadata.range_label=2026年1月
```

### 新增 generalized range 路徑

```
GET /api/recommend?...&range_type=year&year=2025
```

`year` 與既有月份路徑共用同一個查詢參數名稱，`range_type` 是唯一新增的判別參數（採用清楚參數設計，而非要求呼叫端自己組 `range_id` 字串）。內部把 `year` 轉成 `range_id='year:{year}'` 查 `date_ranges`，驗證 `is_complete=1` 才會用 `getRangePageRankMap`/`getRangeTransitionMap` 覆蓋候選資料——與月度路徑餵給**完全沒有改動**的 `computeRecommendations()` 是同一個函式呼叫。

驗證涵蓋的情境（皆為本地 dev server 對真實 fixture 的實測，非單元測試模擬）：

| 情境 | 結果 |
|---|---|
| 完整年度推薦（`range_type=year&year=2027`） | `200`，`recommendations` 正常回傳，`metadata.range` 含 `is_complete:true`、`day_count:365` |
| 不完整年度（`range_type=year&year=2028`，244/366 天） | `404`，`error:"2028 年的旅運資料不完整，目前無法提供年度推薦"`，附 `coverage:{actual_day_count:244, expected_day_count:366}` |
| 從未匯入的年度（`year=2029`） | `404`，`error:"找不到 2029 年的旅運資料"`（與不完整年度的錯誤訊息不同，兩種「不可用」誠實區分原因） |
| 無效 `range_type`（`range_type=bogus`） | `400`，`valid_values:["month","year"]` |
| `range_type=year` 同時給 `month` | `400`，明確說明年度推薦不支援 `month` 參數 |
| `data_mode=synthetic` + `range_type=year` | `400`（比照既有月度規則：合成資料沒有時間範圍概念） |
| 未指定任何 range 參數 | 沿用既有 latest-month 行為，`metadata.range_type=month` |

`/api/analytics/pagerank` 同步擴充 `range_type=year&year=`（既有 `year`/`month` 參數行為不變），新增 `/api/analytics/years` 回傳「只有完整年度」的清單，供前端年度下拉使用——不完整或從未匯入的年度**不會**出現在這個清單裡。

### Recommendation scoring 不變

`src/lib/recommender.ts`、`normalizeValue()`、`DEFAULT_WEIGHTS`、`gamma=0.85` 全部未修改。年度資料進入計分流程的方式與月度完全相同：`getRangePageRankMap`/`getRangeTransitionMap` 回傳的 Map 形狀與既有 `getRealPageRankMap`/`getRealTransitionMap` 一致，`computeRecommendations()` 不需要（也不會）知道資料來自 `real_pagerank` 還是 `range_pagerank`。

---

## 3. Temporal selector UX

### 設計決策（先於實作的判斷，取代 ui-ux-pro-max 工具呼叫）

本次會話的工具列表中沒有名為「ui-ux-pro-max」或「Impeccable」的可呼叫技能——`docs/uiux/` 下的既有文件顯示這兩個詞是先前 UI/UX 稽核所採用的**評估方法論代號**（見 `02-design-direction.md` 開頭），不是本次工作階段可呼叫的工具。因此本階段實作前，依循 `02-design-direction.md` 已確立的 token／間距／圖示／單選元件規範自行做設計判斷（而非呼叫外部工具），完成後再依同一份文件的驗收標準（第 25 節）自我審查一輪，記錄於第 3.3 節。

### 實作

首頁「資料月份」單一 select 演進為 fieldset「資料範圍」：

```
📅 資料範圍
[● 月份]  [○ 年度]

月份： [ 最新月份（自動） ▼ ]
```

切到年度：

```
📅 資料範圍
[○ 月份]  [● 年度]

年度： [ 2027年（全年） ▼ ]
年度推薦需要完整 365（閏年 366）天的逐日資料才會計算，可能少於已匯入的月份數。
```

- **沒有新增大量 dropdown**：只多了一個兩選項的 fieldset（沿用既有 `.mp-query-chip` 單選 chip 樣式，`grid-template-columns: repeat(2, ...)` 覆寫既有三欄佈局，`max-width: 17.5rem` 讓它維持緊湊，不佔滿整個欄位寬度）+ 一個依模式顯示/隱藏的既有 select 元件；不是疊加第三顆下拉。
- **延續既有 tokens／icon system**：沒有新增顏色、字級或圖示；重用 `iconUse('calendar')`（分析頁「月份資料」分頁已在用同一個圖示）、`.mp-query-help`、`.mp-query-error`。
- **Keyboard accessible**：兩個 radio 用同一個 `name="range_mode"`，瀏覽器原生支援 Tab 進入、方向鍵在群組內切換（本次驗證發現自動化測試工具的合成鍵盤事件無法觸發瀏覽器原生 radio-group 方向鍵行為——但用完全相同的手法測試「既有、上線已久」的偏好 chips 一樣觸發不了，證實這是測試工具本身傳遞鍵盤事件的限制，不是 Phase 3A 新增標記引入的問題；真實鍵盤操作走的是瀏覽器原生、未被任何 JS `preventDefault()` 攔截的路徑）。`fieldset`/`legend` 語意與既有偏好欄位一致。
- **desktop／mobile 都清楚**：見第 6 節 responsive 截圖，390/768/1024/1440 四個寬度都經過實測，沒有橫向溢出或遮擋。

### 資料真相（data truth）處理

- 結果摘要的「資料範圍」欄位、`metadata-section` 的來源說明句，**一律讀取 API 回應的 `metadata.range_label`/`metadata.range`**（伺服器確認後的值），不是送出當下的草稿選擇。實測年度推薦的來源句：

  ```
  依 2027 全年度旅運資料
  ```

  逐字對照任務指定的範例格式「依 2025 全年度旅運資料」。
- 沒有完整年度資料時：`sel-data-year` 隱藏、顯示誠實的 `目前沒有完整年度資料可用，請改用月份查詢。`（用真實 API 回應 `years:[]` 觸發，非硬編碼樣式），**不提供假的可選年份**；此時嘗試以年度模式送出會被攔在前端（`#range-mode-error` 內嵌錯誤 + focus 移到年度 select），不會發出必然失敗的請求；月份推薦完全不受影響（同一個 fieldset 內兩個分頁互相獨立）。

### Stale-request 保護

`matchesDraft()` 新增比對 `range_mode`/`month_value`/`year_value`。實測：先送出月份模式（2025-11）請求，還沒等它回來就切換成年度模式再送出——最終畫面正確顯示後送出的年度結果，不會被較晚回來的舊月份回應覆蓋。

---

## 4. Analytics changes

`analytics.ts` 排名控制列的「月份」select 演進為「資料範圍」select（月份／年度）+ 依模式顯示的月份或年度 select，共用既有 `.mp-control`／`.mp-control-grid` 視覺語言，不新增 grid 欄位數（兩個 select 疊在同一個 grid cell 裡，避免打亂既有 3 欄 + 按鈕的響應式版面）。

- `站點排名`／`圖表比較` 兩個分頁完全支援年度：實測 `真實年度資料 · 2027年（全年） · 晨峰 07:00–09:00 · Top 20` 正確顯示，排名列表（`renderRankTable`）與長條圖（`renderBarChart`）不需任何改動就能消化 `range_pagerank` 回傳的資料（欄位形狀與既有月度排名列一致）。
- `月份資料`（trends，跨月趨勢折線圖）**維持月份限定，未擴充年度**——這是任務明確排除的範圍（「本階段只需要支援月/年的ranking/comparison，不要實作holiday/custom UI」，trend 折線圖本質上是「多個時間點的序列」，單一年度只是一個點，不是這個功能自然延伸的方向）。實測 `BL11`/`night` 的 `calendar` 缺口標示（Phase 1 功能）在本次修改後行為不變。

---

## 5. Completeness / data-truth handling

四項禁止規則（不得假裝全年／不得 silent extrapolate／不得補 0／可回報 incomplete）在程式碼裡分別由不同機制保證，逐一對應：

| 規則 | 保證機制 |
|---|---|
| 不得假裝全年 | `is_complete` 判斷用**逐日覆蓋率**（365/366 天），不是「有 12 個月」；2028 年即使已有 8 個完整月份，仍正確標記為不完整 |
| 不得 silent extrapolate | 不完整年度**完全不計算** `range_pagerank`——沒有任何程式路徑用部分資料外推出一個看似完整的年度值 |
| 不得補 0（缺月份） | 同上；`range_od_flow`/`range_pagerank` 要嘛有完整年度的真實聚合值，要嘛完全不存在，沒有「缺的部分補 0」這個中間狀態 |
| 可回報 incomplete/unavailable | API 對「不完整」與「從未匯入」回傳不同的錯誤訊息，`coverage` 物件附實際/預期天數；前端 `range-year-unavailable`／`range-mode-error` 用真實 API 資料誠實呈現，不是靜態文案硬編碼一種情境 |

---

## 6. Regression / build

### 完整年度正確性（[scripts/verify_year_parity.py](../../scripts/verify_year_parity.py)）

對 2027 年 fixture 執行，全數 PASS：

- **yearly OD aggregate correctness**：`daily_od_flow` 直接 `SUM...GROUP BY` 整年聚合，與 `range_od_flow` 逐時段比對完全相等（772,324,718 = 772,324,718，六個時段個別比對也全部相等）——用兩條獨立 SQL 路徑互相驗證，不是只信任其中一種。
- **yearly PageRank 全站 correctness**：六個時段各自驗證：118/118 站無缺、`pr_value` 總和 ≈ 1.0（Power Method 正規化不變量）、`pr_rank` 是 1..118 的完整排列無重複、`normalized_score` 端點精確為 0/1、排名順序與 `pr_value` 大小一致。
- **year range 有被正確持久化**：`date_ranges.is_complete=1`、`day_count=expected_day_count=365`、`start_date`/`end_date`/`computed_at` 皆正確。

過程中發現並修正驗證腳本本身的一個錯誤假設：原本用 `SELECT COUNT(*) FROM stations`（136 列，含 STATION_MAP 別名去重前的原始列數）當作「全站無缺」的基準，導致六個時段全部誤報 FAIL；改用 ETL 實際使用的去重後站點清單（`get_all_station_ids()`，118 個）之後，六項檢查全數正確通過——這是測試腳本的 bug，不是資料或計算的問題。

### daily purge 後 year recommendation 仍正常

用 [scripts/retention.py](../../scripts/retention.py)（Phase 2C）以 `--as-of 2029-07-01` 模擬 18 個月保留窗口，實際刪除 2027 年全部 22,216,671 列 `daily_od_flow`（連同 2026-01 一起，共 24,151,083 列）。刪除前後比對六張永久保留表列數**逐一相同**。刪除**之後**：

```
GET /api/recommend?from=BL11&time_period=night&preference=food&range_type=year&year=2027
→ success:true，站點順序與分數與刪除前完全相同
GET /api/recommend?from=BL11&time_period=night&preference=food&year=2026&month=1
→ success:true（月度路徑同樣不受影響）
```

證實年度／月度推薦在請求當下只讀 `range_pagerank`/`range_od_flow`/`real_pagerank`/`real_od_flow`（永久保留表），從不觸碰 `daily_od_flow`——這是程式碼結構本身的保證（`recommend.ts` 的 year 分支完全沒有查詢 `daily_od_flow` 的程式碼路徑），不是巧合。重新對 2027 執行 `verify_year_parity.py`：PageRank 相關檢查（不依賴 `daily_od_flow`）全部繼續 PASS，只有依賴 `daily_od_flow` 才能驗證的「OD 守恆」檢查如預期失敗（因為驗證的前提資料已被刻意清空）——這是正確、可解釋的訊號，不是缺陷。

### incomplete year 不被標成 full year

見第 1、2、5 節：2028 年（244/366 天）`date_ranges.is_complete=0`，`/api/recommend?range_type=year&year=2028` 回 `404` 附 `coverage`，`/api/analytics/years` 不列出 2028。

### month mode regression / BL11 → night → food baseline

在整個 Phase 3A 實作與 fixture 建置（含大量 daily_od_flow 寫入與後續 purge）前後，反覆重新請求同一個 baseline，逐位元組比對：

```
ids: ['BL12', 'BL10', 'R11', 'BL18', 'BL15']
scores: [0.79, 0.38, 0.38, 0.37, 0.33]
data_month: 2026年1月
```

不變。

### stale request protection

見第 3 節：月份→年度快速切換，最終顯示結果正確對應最後一次送出的請求。

### Responsive / keyboard

390 / 768 / 1024 / 1440 四個寬度皆已截圖確認（首頁與分析頁），無橫向溢出、控制項未被遮擋、觸控熱區維持既有 44px+ 門檻。Keyboard：fieldset/legend + 原生 radio 分組，Tab 順序、focus-visible 樣式沿用既有 `.mp-query-chip:has(input:focus-visible)` 規則，未新增任何攔截鍵盤事件的程式碼。

### Build

```
npm run build   # ✓ built in ~150ms，dist/_worker.js 166.45 kB
git diff --check  # 無空白字元錯誤（含所有新增檔案）
python3 -m py_compile scripts/*.py  # 全部通過
```

---

## 7. Deferred holiday/custom work

依任務範圍明確排除，本階段未實作：

- **Holiday range**：`date_ranges.holiday_event_id`／`holiday_events` 表仍是 Phase 3（架構設計文件用語，非本文件的「Phase 3A」）待辦；`range_type` 目前只接受 `month`/`year`。
- **Custom date range**：同上，`date_ranges` schema 已經是通用設計（可承載任何 `range_type`），但沒有對應的計算流程或 API 參數。
- **年度趨勢圖／跨年比較**：Analytics 的「月份資料」分頁維持月份限定，沒有新增年度版本的跨時間點序列圖。
- **`/api/analytics/flow`／`/api/analytics/station-pr`**：未擴充 `range_type=year`（範圍明確限定在「ranking/comparison」，即排名表與長條圖分頁）。
- **年度資料的 R2 封存／provenance manifest**：`materialize_year_range.py` 目前不產生 Phase 2C 那樣的 manifest（因為它不涉及原始 CSV 下載，只聚合已持久化的 `daily_od_flow`）；如果未來需要對「這次年度計算的完整性/可重現性」做更正式的稽核記錄，屬於後續工作。
- **Remote D1 上的年度 materialization 驗證**：本階段所有驗證都在本地 D1 完成（避免重演 Phase 2C 已經踩過的 D1 免費方案每日列讀取配額問題——年度計算涉及掃描數千萬列 `daily_od_flow`，對 remote 執行會消耗大量配額）；正式在 remote 上執行年度 materialization 前，建議先確認帳號方案（見 Phase 2C 文件第 5 節）。
