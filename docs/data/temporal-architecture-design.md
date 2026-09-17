# MetroPulse — Temporal Architecture Design

日期：2026-09-16
狀態：**設計文件，未實作、未 migration、未 deploy**
前置閱讀：[temporal-capability-audit.md](temporal-capability-audit.md)、[migrations/](../../migrations/)、[scripts/import_od_data.py](../../scripts/import_od_data.py)、[src/db/queries.ts](../../src/db/queries.ts)、[src/routes/recommend.ts](../../src/routes/recommend.ts)、[src/routes/analytics.ts](../../src/routes/analytics.ts)

本文件在稽核報告已確認的現況上，設計一套**可分階段導入、每階段皆向下相容**的 temporal architecture。所有設計都遵守使用者已拍板的六項決策（見下方「Decisions 對照」），**不重新討論**這些決策本身，只把它們落地成 schema / pipeline / API / UI。

## Decisions 對照（本設計如何落地）

| # | 決策 | 本文件對應設計 |
|---|---|---|
| 1 | 指定月份推薦、不 silent fallback、未指定才預設最新 | Phase 1：`/api/recommend` 新增 `year`/`month`，見「API Contract」 |
| 2 | 年度先聚合 OD 再重算 PageRank，不用月度簡單平均 | 「Aggregation pipeline」「PageRank computation strategy」：所有 range 共用同一個「聚合 OD → 建 transition matrix → Power Method」流程 |
| 3 | Generalized date-range engine，不為每種範圍寫不同演算法 | 「Proposed schema」的 `date_ranges` / `range_od_flow` / `range_pagerank` 三表，月/年/自訂/連假共用同一組表與同一個計算函式 |
| 4 | 未來 ETL 保留日期；現有月表可留作 derived/compat layer | 「Daily OD table」「Existing monthly table relationship」 |
| 5 | Holiday 是 date-range metadata，不寫死推薦器；用 holiday event 跨年對齊，第一版比較整段 event | 「Holiday metadata model」 |
| 6 | Missing month trend 不插值，明確標示 gap | 「Trend-gap handling」 |

---

## Proposed schema

分兩批新增資料表，皆為**純新增**（不改動、不刪除現有欄位或表）：

### Phase 2 新增：daily OD + generalized range engine

```sql
-- 逐日 OD 流量（依現有 6 段 period 分桶；見下方「daily OD table」說明為何不存逐小時）
CREATE TABLE daily_od_flow (
  from_station_id TEXT NOT NULL,
  to_station_id   TEXT NOT NULL,
  service_date    TEXT NOT NULL,   -- ISO 8601 'YYYY-MM-DD'
  period          TEXT NOT NULL,   -- 沿用既有 6 段時段代碼，語意不變
  flow_count      INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (from_station_id, to_station_id, service_date, period)
);

CREATE INDEX idx_daily_od_date   ON daily_od_flow(service_date, period);
CREATE INDEX idx_daily_od_from   ON daily_od_flow(from_station_id, service_date, period);

-- 任何時間範圍的「身分證」：月、年、連假、自訂區間都在此註冊
CREATE TABLE date_ranges (
  range_id          TEXT PRIMARY KEY,   -- 'month:2026-01' / 'year:2026' / 'holiday:lunar-new-year:2026' / 'custom:2026-02-05:2026-02-10'
  range_type        TEXT NOT NULL,      -- 'month' | 'year' | 'holiday' | 'custom'
  start_date        TEXT NOT NULL,      -- ISO date，含
  end_date          TEXT NOT NULL,      -- ISO date，含
  holiday_event_id  TEXT,               -- range_type='holiday' 時指向 holiday_events.event_id
  label             TEXT,               -- 顯示名稱，如 '2026年1月'／'2026春節'
  day_count         INTEGER,            -- 該範圍內實際有 daily_od_flow 資料涵蓋的天數（見「Risks」的 partial 透明度）
  computed_at       TEXT                -- range_pagerank/range_od_flow 最後一次計算時間
);

-- 通用聚合結果：任何 range_id 都寫進同一組表，月/年/連假/自訂不再各自建表
CREATE TABLE range_od_flow (
  range_id        TEXT NOT NULL REFERENCES date_ranges(range_id),
  from_station_id TEXT NOT NULL,
  to_station_id   TEXT NOT NULL,
  period          TEXT NOT NULL,
  flow_count      INTEGER NOT NULL,
  PRIMARY KEY (range_id, from_station_id, to_station_id, period)
);

CREATE TABLE range_pagerank (
  range_id         TEXT NOT NULL REFERENCES date_ranges(range_id),
  station_id       TEXT NOT NULL,
  period           TEXT NOT NULL,
  pr_value         REAL NOT NULL,
  pr_rank          INTEGER,
  normalized_score REAL,
  PRIMARY KEY (range_id, station_id, period)
);

CREATE INDEX idx_range_pr_lookup ON range_pagerank(range_id, period, pr_rank);
CREATE INDEX idx_range_od_from   ON range_od_flow(range_id, from_station_id, period);
```

### Phase 3a 新增：holiday metadata

```sql
CREATE TABLE holiday_events (
  event_id     TEXT NOT NULL,   -- 跨年穩定的 slug，如 'lunar-new-year'（見「Holiday metadata model」）
  event_name   TEXT NOT NULL,   -- 顯示名稱，如 '春節'
  year         INTEGER NOT NULL,
  start_date   TEXT NOT NULL,   -- ISO date，含
  end_date     TEXT NOT NULL,   -- ISO date，含
  source_note  TEXT,            -- 邊界依據（人工填寫，如「行政院人事行政總處公告」）
  PRIMARY KEY (event_id, year)
);
```

`holiday_events` 是**人工維護的行事曆資料**，不是從 OD CSV 推得——連假邊界是公部門公告的事實，不是可以從人流反推的統計量。每年需要人工新增一列。

---

## Daily OD table

存 `(service_date, period)`，**不存逐小時**。理由：

- 現有推薦引擎、分析頁、UI 的時段選單全部是 6 段 `period` 語意（[types.ts](../../src/lib/types.ts) `TIME_PERIOD_LABELS`），改成逐小時儲存不會讓現有任何功能變得更好，只會讓 `daily_od_flow` 的列數再乘上一個因子，卻沒有對應的產品需求。
- 使用者的六項決策沒有一項要求「比 period 更細」的輸出粒度；holiday/year/custom 都是「哪些天算進這個範圍」的問題，不是「一天內要切更細的時段」的問題。
- 若未來確實需要重新定義 period 邊界（例如把晨峰拆成兩段），那是**另一個研究方法決策**，不在本次六項決策範圍內；屆時要不要回頭存逐小時，留在「Risks / open questions」，不在這裡預先實作一個目前用不到的粒度。

ETL 端會拿到 CSV 的逐日逐小時列（`process_csv_stream()` 目前把 `hour_str` 讀出後立刻映射進 6 段並捨棄，見 [import_od_data.py 現有邏輯](../../scripts/import_od_data.py)），Phase 2 的修改是：**多留一個 `service_date` 欄位往下傳**，其餘映射邏輯（`HOUR_TO_PERIOD`）不變，寫入 `daily_od_flow` 時已經是 `(date, period)` 粒度的累加值。

---

## Existing monthly table relationship

`data_months` / `real_od_flow` / `real_pagerank`（[0002_real_data.sql](../../migrations/0002_real_data.sql)）**不刪除、不改 schema**，維持現有 `/api/analytics/*` 與月度趨勢圖（[index.ts loadTrend()](../../src/index.ts)）完全不受影響地運作。

它們在 Phase 2 之後的角色是「`range_type='month'` 的相容鏡射」：

- Phase 2 的聚合流程對每個月份同時做兩件事：① 寫入通用的 `date_ranges`(range_type='month') + `range_od_flow` + `range_pagerank`；② 用同一份聚合結果**鏡射寫入**舊表 `data_months` / `real_od_flow` / `real_pagerank`（數值完全相同，只是換一種表殼）。
- 這樣 `getRealPageRankMap`/`getRealTransitionMap`/`getStationPrTrends`（[queries.ts:331](../../src/db/queries.ts#L331)、[:353](../../src/db/queries.ts#L353)、[:313](../../src/db/queries.ts#L313)）與整個 `/api/analytics/*`、Phase 1 的 `/api/recommend?year=&month=` 都**不需要知道** `range_*` 表的存在，繼續讀舊表即可。
- 舊表要不要在更後面的階段被汰換成「直接查 `range_*` WHERE range_type='month'」是可選的未來優化，**本設計不要求、也不預先決定**這件事——決策 #4 只要求「可以保留」，不要求「必須遷移掉」。

---

## ETL changes

修改對象：[scripts/import_od_data.py](../../scripts/import_od_data.py)。

1. `process_csv_stream()`：目前解析每一行時只用 `hour_str` 查 `HOUR_TO_PERIOD`，`日期`欄（`parts[0]`）被讀出後從未使用。Phase 2 改成同時保留 `service_date`，聚合鍵從 `od_by_period[period][(from_id,to_id)]` 擴充為 `od_by_period[period][(from_id,to_id,service_date)]`（或等效的巢狀結構）。
2. `generate_sql()` 的 `DELETE ... WHERE year=? AND month=?` 範圍保護模式沿用到新表：對 `daily_od_flow` 改成 `DELETE WHERE service_date BETWEEN ? AND ?`，範圍限定在這次匯入的 CSV 實際涵蓋的日期，不動其他日期的既有列——延續現有「匯入某月不影響其他月」的安全模式（見稽核報告「Import 新月份是否安全」），只是把保護鍵從 `(year,month)` 換成 `service_date` 區間。
3. 新增一個聚合步驟（可以是同一支腳本的新函式，也可以拆成獨立腳本，例如 `aggregate_range.py`）：讀 `daily_od_flow` 對指定 `range_id` 的 `start_date`~`end_date` 做 `SUM(flow_count) GROUP BY from,to,period`，跑 `compute_pagerank()`（沿用現有函式，見下方「PageRank computation strategy」），寫入 `range_od_flow`/`range_pagerank`，再鏡射進舊表（見上一節）。
4. `_apply_local_wrangler`/`_apply_remote_wrangler` 的 wrangler 呼叫模式（先 `d1 migrations apply` 再 `d1 execute`）不變，新表透過新的 migration 檔案套用即可，不需要改這兩個函式的邏輯。

---

## Aggregation pipeline

所有 range type 共用同一條管線，差別只在「聚合的日期集合怎麼決定」：

```
daily_od_flow (原始事實)
      │  SUM(flow_count) WHERE service_date IN <range 的日期集合> GROUP BY from,to,period
      ▼
range_od_flow (該 range_id 的聚合流量)
      │  compute_pagerank()：建 transition matrix（含 γ=0.85 damping）→ Power Method 150 次迭代 → normalize
      ▼
range_pagerank (該 range_id 的 PR 值/排名/正規化分數)
```

各 range type 只是「日期集合」的決定方式不同：

| range_type | 日期集合怎麼來 |
|---|---|
| month | 該曆月的所有日期（現有邏輯的直接延伸） |
| year | 該年份所有已匯入的日期（可能不足 365 天，見 `day_count` 與「partial year」透明度） |
| holiday | `holiday_events.start_date` ~ `end_date`（單一事件，整段視為一個 range，決策 #5 的「第一版比較整段 event」） |
| custom | 使用者指定的 `start_date`~`end_date`，伺服器端有長度上限（見「Performance considerations」） |

**這條管線本身沒有「年度」「連假」專用程式碼**——四種 range type 進到同一個 SUM + Power Method 函式，滿足決策 #3。

---

## PageRank computation strategy

年度／自訂／連假 PageRank **一律**：先把 `daily_od_flow` 依 range 的日期集合加總成 OD 對，重新建 transition matrix，重新跑一次 Power Method——與現有月度計算是**同一個函式、同一組參數**（`GAMMA=0.85`、`POWER_ITER=150`，見 [import_od_data.py compute_pagerank()](../../scripts/import_od_data.py)），只是輸入的 OD 加總範圍不同。**不對已算好的月度 PR 值做平均**（決策 #2 明確排除這個做法），因為 PageRank 不是線性可加總的量，月度平均會系統性扭曲跨站相對排名。

計算的執行位置：

- **Named range（month/year/holiday）**：離線／批次執行（Python ETL 或排程），寫入 D1 後由 API 純讀取。Cloudflare Workers 有 CPU 時間限制，不適合把「重新聚合 + 跑 150 次迭代」放進即時請求路徑；這些 range 的邊界是可預期的（月份、年份、已登記的連假），可以在資料到齊時就預先算好。
- **Custom range**：見下方「Performance considerations」的兩個選項。

Power Method 本身對 ~100 個站點的矩陣（100×100，150 次迭代 ≈ 10⁶ 次乘加）計算量很小，**不是**效能瓶頸；真正的成本在「SUM 聚合要掃多少列 `daily_od_flow`」，這隨 range 的天數線性成長，是後面效能段落要處理的問題。

---

## API contract proposal

### `/api/recommend`（Phase 1，向下相容）

```
GET /api/recommend?from=&time_period=&preference=&top_n=&data_mode=&year=&month=
```

- `year`/`month` 必須成對出現；只給其中一個 → `400`。
- 兩者都給、但該 `(year,month)` 不在 `data_months` 裡 → `404`，明確錯誤訊息（例如「找不到 2026 年 5 月的旅運資料，目前可用月份：2026-01」），**不得**悄悄退回最新月份或 synthetic（決策 #1）。內部改法：`recommend.ts` 目前一律呼叫 `getLatestDataMonth()`（[recommend.ts:107](../../src/routes/recommend.ts#L107)）取得 `realDataMonth`；改為「有指定 year/month 就直接驗證並使用該月，沒指定才呼叫 `getLatestDataMonth()`」。
- 都不給 → 沿用現有行為（`data_mode=auto/real` 時自動用最新月份），不破壞任何現有呼叫端。
- `data_mode=synthetic` 與 `year`/`month` 同時出現 → `400`（synthetic 走的是完全不含月份概念的舊表，兩者語意衝突）。

### `/api/recommend`（Phase 3，generalized range）

在同一個端點疊加，而不是為每種 range 開新端點（決策 #3）：

```
GET /api/recommend?...&range_type=year&year=2026
GET /api/recommend?...&range_type=holiday&holiday_event=lunar-new-year&year=2026
GET /api/recommend?...&range_type=custom&start_date=2026-02-05&end_date=2026-02-10
```

伺服器內部把上述任一組合解析成一個 `range_id`，查 `range_pagerank`/`range_od_flow`（若尚未算好，依 range_type 決定是 404 提示尚未匯入／尚未計算，還是進入「計算中」流程，見效能段落），組出與現有 `getRealPageRankMap`/`getRealTransitionMap` **相同形狀**的 Map，餵給**沒有任何改動**的 `computeRecommendations()`（[recommender.ts:61](../../src/lib/recommender.ts#L61)）。回應新增：

```jsonc
{
  "metadata": {
    "data_source": "real",
    "data_month": "2026年1月",          // 保留舊欄位（range_type=month 時才有值），舊前端不必改
    "range": {                          // 新欄位，額外資訊
      "range_id": "holiday:lunar-new-year:2026",
      "range_type": "holiday",
      "start_date": "2026-02-14",
      "end_date": "2026-02-22",
      "label": "2026年春節",
      "day_count": 9,
      "is_partial": false
    }
  }
}
```

### `/api/analytics/*`（Phase 3，同樣加法式擴充）

`year`/`month` 參數繼續有效（等同 `range_type=month`）；新增 `range_type=year|holiday|custom` 與對應參數，行為與上面 `/api/recommend` 一致。新增：

```
GET /api/date-ranges?type=month|year|holiday       -- 取代/擴充現有 /api/analytics/months
GET /api/holiday-events                            -- 列出所有 event_id 與其各年份實例
GET /api/analytics/trends?station=&period=&range_type=month|year   -- 新增 range_type，預設 month（相容現有呼叫）
```

---

## UI temporal selector model

用一個共用的「範圍選擇器」元件取代現有單一 `<select id="sel-month">`（[index.ts:1492](../../src/index.ts#L1492)），供首頁推薦與 `/analytics` 共用：

- **模式切換**：月 / 年 / 自訂區間 / 連假，四個分頁或一個模式下拉。
- **月模式**：完全沿用現況（`/api/analytics/months` 動態產生選項），行為零改動。
- **年模式**：下拉列出「至少有一個月已匯入」的年份；若該年份未涵蓋 12 個月，選項文字明確標出（例如「2026（部分年度：僅 1–3 月）」），對應 `is_partial`/`day_count`——延續現有程式碼一貫的「缺值不偽裝成完整資料」風格（如 [index.ts:1787](../../src/index.ts#L1787) 的 `data_source`/`data_month` 顯示邏輯）。
- **自訂區間模式**：兩個日期輸入框，前端驗證 `start_date ≤ end_date` 且天數 ≤ 伺服器上限；送出後若後端回「計算中」，UI 顯示明確等待狀態而非空白或假資料。
- **連假模式**：先選 `event_id`（顯示 `event_name`，如「春節」），再選年份（該 event 已登記的年份列表）；「跨年比較同一連假」是獨立的勾選/多選操作，可勾多個年份，結果以**並列比較**（長條圖群組或並排卡片）呈現，**不是**單一時間軸折線——因為連假實例之間本來就不是等距的時間點，硬畫成一條線會誤導成「隨時間連續變化」（呼應決策 #6 的精神，也呼應稽核報告已指出的「缺值不能偽裝成 0」原則）。

四種模式最終都收斂成同一組內部狀態 `{ range_type, params }`，由共用函式轉成查詢字串打向 `/api/recommend` 或 `/api/analytics/*`——避免像現在的 `sel-month` 邏輯只為月模式量身打造，之後又要為年/連假各寫一份。

---

## Holiday metadata model

```
holiday_events(event_id, event_name, year, start_date, end_date, source_note)
PRIMARY KEY (event_id, year)
```

- `event_id` 是**跨年度穩定**的識別碼（如 `lunar-new-year`、`dragon-boat`、`national-day`），同一個 `event_id` 每年一列，`start_date`/`end_date` 各年不同——這就是決策 #5「以 holiday event 對齊」的落地：跨年比較永遠是 `WHERE event_id = ?`，不需要猜測「哪一年的哪幾天算同一個節日」。
- 純人工維護資料表，不從 OD CSV 推導；每年需要人工新增一列，`source_note` 記錄邊界依據（例如政府公告），方便日後追溯。
- 每個 `holiday_events` 實例對應一個 `date_ranges` 列（`range_type='holiday'`，`range_id = 'holiday:<event_id>:<year>'`，`holiday_event_id` 指回 `holiday_events`），聚合與計算走「Aggregation pipeline」一節的共用流程。
- **v1 範圍明確限定**：只比較整段連假（決策 #5），不做連假內逐日拆解、不處理「補班日算不算」「跨月連假算誰的月份」這類邊界定義——這些留在「Risks / open questions」，需要另一輪產品/研究決策才能擴大範圍。

---

## Trend-gap handling

現況：`/api/analytics/trends` 的 X 軸標籤直接用「有資料的月份」陣列產生（[index.ts:1912](../../src/index.ts#L1912)），中間缺一個月時前後兩點會被畫成相鄰，視覺上像連續月份——稽核報告已指出此缺口。

設計（決策 #6：不插值、明確標示 gap）：

1. **後端**：`/api/analytics/trends`（`range_type=month` 時）額外回傳一個**連續月曆序列**，涵蓋第一筆與最後一筆資料之間的每個月，缺資料的月份以 `pr_value: null` 表示（新增欄位，例如 `calendar`，與現有 `trends` 並存，不刪除舊欄位，舊前端不受影響）。`range_type=year` 的跨年趨勢用同樣邏輯，序列單位換成年。
2. **前端**：Chart.js 折線資料改用這個連續序列（而非只用「有資料的點」），並設定 `spanGaps: false`——Chart.js 原生行為是遇到 `null` 值就斷開線段，不會自動連到下一個有值的點，這是「不插值」最直接的落地方式。
3. **表格與文字摘要**：現有 `trend-rows`/`trend-table-wrap`（[index.ts:1585](../../src/index.ts#L1585)）延伸成也列出缺資料的月份列，儲存格顯示「資料缺失」而非略過該列——延續現有程式碼「缺 PR 顯示『資料不足』而非 0」的既有模式（見稽核報告對 P1-04 修正的描述）。
4. **連假跨年比較**（類別型比較，非折線）：某年份沒有該 event 的 `date_ranges` 資料時，直接從比較集合中省略並附一行「此年度尚無資料」，**不**畫成 0 值長條——避免重蹈稽核報告點名過的「缺值當成觀測 0」問題。

---

## Backward compatibility

- **Phase 1**：純加參數，`/api/recommend` 不帶 `year`/`month` 時行為與今日完全一致；不改動 `recommender.ts`/`normalizer.ts` 任何一行。
- **Phase 2**：純加表，`data_months`/`real_od_flow`/`real_pagerank` 持續被寫入、持續被 `/api/analytics/*` 與趨勢圖讀取，schema 不變；`daily_od_flow`/`date_ranges`/`range_*` 對外不可見（沒有任何現有 API 讀它們），純內部管線。
- **Phase 3**：`/api/recommend`、`/api/analytics/*` 的既有查詢參數（`data_mode`、`year`、`month`）語意不變，新參數（`range_type`、`holiday_event`、`start_date`/`end_date`）為選填；回應新增欄位（`range` 物件），不刪除、不重新命名既有欄位（`data_source`、`data_month` 保留）。
- **合成軌道**（`pagerank_scores`/`transition_matrix`，供 Station Detail 與 `/api/pagerank` 使用）全程不在本設計異動範圍內——稽核報告已指出它與真實月度資料是兩條互不相通的軌道，本文件不擴大範圍去統一它們。
- **計分邏輯**：任何階段都不修改 `computeRecommendations()`/`computeScoreBreakdown()`/`normalizeValue()`——所有新 range type 最終都是把「一個 `{pr_value, transition_prob, tags, travel_cost}` 形狀的候選資料」餵給現有函式，這是滿足「不得改變現有 recommendation scoring semantics」的核心設計原則，不是附帶結果。

---

## Data re-import requirement

- **已匯入月份（如現有的 2026-01）的日期粒度已經永久遺失**——現有 `real_od_flow` 只存月加總，原始逐日資料從未落地。要讓這些月份擁有 `daily_od_flow`，唯一辦法是重新向公開資料源（`http://tcgmetro.blob.core.windows.net/stationod/...`，見 [import_od_data.py build_url()](../../scripts/import_od_data.py)）下載當月原始 CSV，用 Phase 2 之後保留日期的新版 ETL 重新處理一次。這是一次性的**回補（backfill）**工作，與「往後新月份自動有日期粒度」是兩件獨立的事，不互相阻塞。
- 在回補完成之前，系統會處於「部分月份有 `daily_od_flow`、部分月份沒有」的混合狀態，且會**長期**存在（沒有強制要求全部回補）。設計必須容忍這個狀態：`/api/analytics/months`（或新的 `/api/date-ranges`）應該每個月份標示 `has_daily_granularity: boolean`；沒有日期粒度的月份可以繼續被查（透過舊表），但**不能**被納入 year/holiday/custom 的聚合（因為聚合的輸入是 `daily_od_flow`，沒有就是沒有，不能拿月加總去偽裝成某個連假區間的資料——這正是稽核報告點名過的「不要用月份資料假裝成連假資料」）。
- 回補是否要做、要回補到哪一年，屬於資料維運排程決策，本文件不代為決定，只確保架構能同時處理「有/沒有日期粒度」兩種月份共存。

---

## Performance considerations for D1

- **主要瓶頸是 SQL 掃描量，不是 PageRank 運算本身**：Power Method 只在 ~100×100 矩陣上跑 150 次迭代（約 10⁶ 次乘加），對任何一台機器都很快；真正隨 range 天數線性成長的是「`SUM(flow_count) ... WHERE service_date BETWEEN ...` 要掃多少列 `daily_od_flow`」。
- `daily_od_flow` 的實際列數目前無法從本次稽核得出精確數字（本次僅讀 schema/程式，未執行匯入、未查詢實際資料量），**不在此臆測具體數字**；建議 Phase 2 第一個月份的日粒度匯入完成後，實際量測「每日新增列數」，再回頭決定：
  - `custom` range 的天數上限（例如以「查詢延遲 < 某個可接受值」反推上限，而不是先定一個數字再驗證）；
  - 是否需要對 `daily_od_flow` 做冷資料封存（例如超過 N 年的逐日資料只保留聚合後的 `range_od_flow`，逐日明細轉存到 D1 以外的地方）——這是儲存成本與「保留多久的可回溯 recompute 能力」之間的取捨，取捨標準留待有真實資料量後再定。
- Cloudflare D1 對單一資料庫大小、單次查詢時間與回傳列數都有平台限制；本設計不引用具體數字，因為這些限制值可能隨時間調整，實作前應以 Cloudflare 當時的公開文件為準，而不是沿用這份設計文件裡的舊資訊。
- Named range（month/year/holiday）一律離線批次計算、API 只讀，這個決定本身就是最大的效能保護——避免任何一次使用者請求觸發「重新掃描 + 重新跑 Power Method」。custom range 是唯一可能在請求路徑上碰到即時聚合的情況，見下方兩個選項：
  - **Option A（建議的預設）**：後端收到未曾計算過的 `custom` range 時，回傳「已排入計算，稍後重試」（例如 202 + 一個可輪詢的狀態），實際計算交給背景流程（排程 worker 或人工觸發的批次腳本）異步完成，完成後結果永久快取在 `range_pagerank`（除非上游 `daily_od_flow` 事後被修正，否則不需重算）。
  - **Option B（需要先做效能量測才能採用）**：若 benchmark 顯示小範圍（例如 ≤31 天）的即時聚合 + 計算能穩定落在 Workers CPU 時間限制內，才考慮讓這類小範圍走同步路徑；大範圍（多年）一律走 Option A。**本文件不預先決定用哪個門檻**，因為目前沒有實測數字可以支撐一個具體的天數上限。

---

## Phased implementation plan

### Phase 1 — 指定月份推薦（無新表）
- `/api/recommend` 新增 `year`/`month` 參數，接上**現有** `getRealPageRankMap`/`getRealTransitionMap`（[queries.ts:331](../../src/db/queries.ts#L331)），未指定月份不存在時回 `404`，不 silent fallback。
- `/api/analytics/trends` 增加連續月曆序列（缺月 `pr_value: null`），前端改用 `spanGaps: false` 並在表格顯示缺資料列。
- 零 schema 改動、零 ETL 改動、零計分邏輯改動。可獨立上線，立刻解決稽核報告點名的「指定月份推薦不支援」與「missing month 趨勢圖沒有缺口標示」兩項缺口。

### Phase 2 — 逐日資料與通用聚合引擎（純新增 schema，管線先只服務「月」）
- 新 migration：`daily_od_flow`、`date_ranges`、`range_od_flow`、`range_pagerank`。
- 修改 ETL 保留 `service_date`；新增聚合函式把逐日資料捲成 `range_type='month'` 的 `range_*` 列，並鏡射進舊表 `data_months`/`real_od_flow`/`real_pagerank`（見「Existing monthly table relationship」）。
- 對外行為**不變**——這個階段是把管線換血，先在最熟悉、已驗證正確的「月」範圍上跑通，作為 Phase 3 擴充到年/連假/自訂前的地基與回歸測試基準（同一份月資料，新舊兩條算法應該算出一致的 PR 值）。

### Phase 3 — 年 / 自訂區間 / 連假、UI 選擇器、跨年連假比較
- 3a：`holiday_events` 表與初始資料；`range_type=year`/`holiday` 的離線聚合工作；`/api/recommend`、`/api/analytics/*` 擴充 `range_type` 參數。
- 3b：`range_type=custom`，預設走 Option A（異步計算 + 快取）；是否開放同步小範圍路徑（Option B）留待效能量測結果決定。
- 3c：前端共用範圍選擇器（月/年/自訂/連假四模式）、跨年連假並列比較視圖、年度趨勢圖（沿用 Phase 1 的 gap 處理原則）、partial year/partial range 的誠實標示。
- 3d（可獨立於 3a-3c 之外、隨時進行）：針對已匯入但缺日期粒度的歷史月份，重新下載原始 CSV 回補 `daily_od_flow`——不阻塞 3a-3c，因為新匯入的月份天生就有日期粒度可用。

每個階段結束時，現有功能（`/api/recommend` 無參數呼叫、`/api/analytics/*`、月度趨勢圖、Station Detail、合成軌道）都應該與該階段開始前**行為完全一致**，只有新增能力可用。

---

## Risks / open questions

1. `daily_od_flow` 實際列數與成長速度未知（本次稽核未執行任何匯入或查詢）——Phase 2 上線後應實際量測，再回頭訂 custom range 天數上限與封存策略，而不是先猜一個數字。
2. Cloudflare D1 的資料庫大小／查詢時間／回傳列數限制會隨平台演進，本文件刻意不引用具體數字，實作前須查當時的官方文件。
3. `holiday_events` 完全仰賴人工維護；沒有提出自動化來源（例如串接官方行事曆 API）——若之後要自動化，是新的範圍，需要另外評估來源可靠性與更新頻率。
4. 歷史月份（如現有 2026-01）的回補仰賴公開 Azure Blob CSV 網址仍然有效；本次稽核未實際發送請求驗證這些歷史檔案是否仍可下載。
5. `custom` range 的即時計算路徑（Option B）在多大範圍內可行，需要真實 benchmark 才能下結論；本文件只給出決策框架，不預先承諾一個天數上限。
6. 決策 #5 只解決「連假整段當一個 range 比較」，以下邊界仍未定義，需要額外一輪產品/研究決策：連假是否含補班調整日、跨月連假算進哪個月份的統計、是否需要連假內逐日拆解（現在的 v1 明確不需要，但若未來要，schema 已經支援——`daily_od_flow` 本來就是逐日的，只是 `holiday` range 目前只聚合成一整段）。
7. 合成軌道（Station Detail、`/api/pagerank`）永久與本設計的真實時間資料脫節；若產品之後想讓 Station Detail 也顯示真實月度/年度趨勢，那是本文件範圍外的後續工作，不隨本設計自動發生。
8. Phase 2 的「鏡射寫入舊表」增加了每次匯入的寫入量（同一份資料寫兩套表），需要在 ETL 的交易/重試邏輯上確保兩邊要嘛一起成功、要嘛一起失敗，避免 `range_*` 與舊表在匯入失敗時出現不一致——這是實作時的錯誤處理細節，本設計只點出風險，不在此規定具體重試策略。
