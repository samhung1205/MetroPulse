# MetroPulse — Temporal Phase 3B：連假推薦（Holiday Recommendation）

日期：2026-09-18
狀態：已實作、已在本地與 disposable remote D1 驗證，**未部署 production**
前置閱讀：[temporal-architecture-design.md](temporal-architecture-design.md)、[temporal-phase3a-year-implementation.md](temporal-phase3a-year-implementation.md)、[temporal-phase3a1-hardening.md](temporal-phase3a1-hardening.md)、[docs/uiux/02-design-direction.md](../uiux/02-design-direction.md)

Phase 3B 在月／年度 generalized range 架構上新增第三種 range type：連假。**沒有新的推薦演算法**——
連假、年度、月份共用同一條管線：

```
date range → daily_od_flow 聚合 OD → 建 transition matrix → compute_pagerank()/normalize_pr() → 既有 recommendation scoring
```

不實作 custom date range；不實作跨年 holiday comparison chart。兩者留給 Phase 3B.1。

---

## 1. Holiday metadata model

新增 `holiday_events` 表（[migrations/0007_holiday_events.sql](../../migrations/0007_holiday_events.sql)，純加表）：

```sql
CREATE TABLE holiday_events (
  event_key   TEXT NOT NULL,   -- 跨年穩定識別碼，如 'lunar-new-year'
  year        INTEGER NOT NULL,
  name_zh     TEXT NOT NULL,   -- 顯示名稱，如 '春節'
  start_date  TEXT NOT NULL,
  end_date    TEXT NOT NULL,
  source      TEXT,            -- 邊界依據；production 資料必須可追溯
  updated_at  TEXT,
  PRIMARY KEY (event_key, year)
);
```

`(event_key, year)` 唯一；同一連假跨年用同一個 `event_key`，各自獨立的 `start_date`/`end_date`。
`date_ranges.holiday_event_id`（migration 0004 就已保留的欄位，之前一直是 NULL）現在存
`event_key`，讓 `range_id = holiday:{event_key}:{year}` 的實例能反查回登錄資料。

**不從固定國曆日期推算春節，不從月份自動猜連假邊界，不 hardcode 不可追溯的 production 日期**——
連假起訖日期永遠來自這張表，`materialize_holiday_range.py` 找不到登錄列就直接報錯退出，不會
自己編一個。本次驗證用的 fixture（`scripts/build_holiday_fixture.py`）在 `source` 欄位清楚標示
「本地測試 fixture，非官方公告」，不冒充真實資料。

---

## 2. Materialization / completeness

新增 [materialize_holiday_range.py](../../scripts/materialize_holiday_range.py)。**不是獨立重寫一份邏輯**——
把 Phase 3A.1 寫在 `materialize_year_range.py` 裡的 service_date × period 完整性判定與
range SQL 產生邏輯，抽成 [import_od_data.py](../../scripts/import_od_data.py) 的三個共用函式：

- `compute_service_date_period_coverage(start_date, end_date, expected_day_count, ...)`
- `fetch_range_od_aggregate(start_date, end_date, ...)`
- `generate_range_materialization_sql(coverage, od_by_period, station_ids, range_id, range_type, label, holiday_event_id)`

`materialize_year_range.py` 同步改為呼叫這三個共用函式（年度只是「日期區間 = 該年 1/1~12/31」的
特例），`materialize_holiday_range.py` 呼叫同一套函式、日期區間換成 `holiday_events` 登錄的
`start_date`~`end_date`。重構後用既有的 2027（完整）/2029（反例）本地 fixture 重新跑過一次
`verify_year_parity.py`，結果與重構前完全一致（見第 7 節），確認共用化沒有改變年度的既有行為。

**完整性規則**（與年度相同，只是套用在連假的日期區間而非整年）：
連假必須同時滿足「區間內每一天都有資料」與「每個有資料的日期，六個既有 period 都齊」。
不要求同一天每個 OD pair 都存在，不對缺的 period 補 0。缺任一天或任一 period：

- `date_ranges` 標 `is_complete=0`，`coverage_note` 說明具體原因（缺哪天／哪天缺哪個 period）。
- **不寫入** `range_od_flow`／`range_pagerank`——不補 0、不 extrapolate。

**永久保留**：連假一旦完整 materialize，`range_od_flow`/`range_pagerank` 完全獨立於
`daily_od_flow`——`retention.py` 的 18 個月 rolling window purge 從未、也沒有能力刪除這兩張表
（見第 3 節與第 7 節的實測）。

---

## 3. Retention protection

[retention.py](../../scripts/retention.py) 新增 `find_unmaterialized_ranges_at_risk()`：purge 前檢查
即將被刪除的日期範圍（`service_date < cutoff`）是否覆蓋：

1. 已登錄 `holiday_events`、但尚未完整 materialize（`date_ranges.is_complete != 1`）的連假事件；
2. 已有 `date_ranges` 狀態列、但 `is_complete=0` 的年度 range（沿用既有 date_ranges 記錄，
   不為年度另建一張登錄表——沒有重寫 retention 架構）。

只要任一清單非空，`--purge` 一律拒絕執行（`sys.exit(1)`，**不 silent purge**），並列出具體是哪個
連假／年度會受影響、建議怎麼處理。新增 `--acknowledge-unmaterialized-ranges` flag，作為唯一的
明確 override——每次都要主動傳入，不是預設行為。`--dry-run` 同樣會顯示警示（純提前告知，
dry-run 本來就不刪除任何東西）。

---

## 4. API

`/api/recommend` 與 `/api/analytics/pagerank` 的 `RangeType` 擴充為 `'month' | 'year' | 'holiday'`：

```
GET /api/recommend?...&range_type=holiday&event_key=lunar-new-year&year=2026
GET /api/analytics/pagerank?range_type=holiday&event_key=lunar-new-year&year=2026&period=...
GET /api/analytics/holidays   -- 新增：已完整 materialize 的連假，依 event_key 分組
```

三種狀態明確區分（`recommend.ts`/`analytics.ts`/`station-detail.ts` 一致）：

| 狀態 | 回應 |
|---|---|
| event 不存在（`holiday_events` 查無列） | 404，「找不到連假事件：{event_key} {year} 年」 |
| event 已登錄，但 daily coverage 尚未計算（`date_ranges` 無列） | 404，「已登錄，但尚未計算逐日資料覆蓋狀態」 |
| event 已登錄，但不完整（`is_complete=0`） | 404，附 `coverage:{actual_day_count, expected_day_count, note}` |
| 已完整 materialize | 200，`metadata.range` 帶 `range_id/range_type/event_key/event_name/year/range_label/start_date/end_date/day_count/expected_day_count/is_complete` |

Recommendation scoring（`computeRecommendations()`/`normalizeValue()`/PageRank 演算法）**完全未變動**——
連假只是把 `range_pagerank`/`range_od_flow` 換成 `holiday:*` 的 range_id，餵給同一組既有函式。

---

## 5. Homepage / Analytics UX

首頁「資料範圍」從 `[ 月份 | 年度 ]` 自然演進成 `[ 月份 | 年度 | 連假 ]`（沿用既有
`.mp-query-chip` 元件與 3 欄 grid，未新增元件、未新增 focus 邏輯）。連假模式：

```
連假  [ 春節 ▼ ]
年份  [ 2026年春節 ▼ ]
```

- Event／年份選項一律來自 `/api/analytics/holidays`，不 hardcode；年份依目前選中的 event 過濾
  （`populateHolidayYearOptions()`），只列出已完整 materialize 的實例。
- 沒有任何完整連假資料時，顯示誠實的 unavailable 狀態（`#range-holiday-unavailable`），不影響
  月份／年度模式；月份／年度既有行為零改動。
- 結果一律使用 API-confirmed metadata：`依 2026 春節連假旅運資料（2026-02-14 ～ 2026-02-22）`，
  不從送出前的草稿選擇組字串（`renderMetadata()`／`renderStationDetail()` 都是讀
  `meta.range.year`/`meta.range.event_name`/`meta.range.start_date`/`meta.range.end_date`）。
- Analytics 頁的 `#sel-range-mode` 同步新增「連假」選項，Ranking／Chart 支援「單一年份的一個
  holiday event」（例：春節／2026／morning_peak／Top 20）；Trend 分頁維持月份專屬，不動。
- Mobile/keyboard/focus 從一開始沿用已驗證過的既有 `.mp-query-chip`
  `:has(input:focus-visible)` pattern，390/768/1024/1440 四個寬度都截圖驗證過，無 overflow。

---

## 6. Station Detail context

`/api/station-detail/:id?range_type=holiday&event_key=&year=`（`station-detail.ts` 的年度／連假
分支已合併成同一段邏輯，只在 `isHoliday` 時多查一次 `holiday_events`）：

- **保留 `range_type`/`event_key`/`year`**：推薦結果的 Detail deep link
  （`detailContextHref()`）、Detail 頁重新查 `/api/recommend` 與 `/api/station-detail`
  （`loadStationDetail()`）、「返回本次推薦」連結（`homeQueryUrl()`）、首頁還原
  （`applyRangeContextFromUrl()`）全部一致帶著這三個參數，形成完整的來回閉環。
- **證據直接來自同一個 holiday range**：`range_pagerank`/`range_od_flow`（`getRangePageRankByStation`/
  `getRangeOdFlowFrom`/`getRangeOdFlowTo`，Phase 3A.1 就有的函式，範圍無關），**不重新計算
  PageRank**。轉乘站別名（如台北車站的 `R10`）透過既有 `resolveRangeStationId()` 解析到 canonical
  ETL id（`BL12`），實測兩者回傳完全相同的年度／連假證據。
- **絕不混用證據**：「2026 春節」context 下，PageRank 表格／連結列表／文案（「連結值來自 2026
  春節連假 range_od_flow」）全部明確標示連假來源，不會偷偷改用月份／年度／synthetic pagerank_scores。
- **不可用時明確 unavailable**：連假不存在／不完整／解析不到對應站點時，不讓整頁失敗，只是
  不附加連假證據，`metadata.range_error` 誠實說明原因，頁面上顯示一行克制的說明後改用既有
  預設資料，不假裝有連假資料。
- **Direct deep link 無 context 時**：`/station/:id`（無參數）行為與本 phase 前完全一致，實測
  API 回應 byte-for-byte 相同。

---

## 7. Validation / regression

### 4 個本地 fixture（`build_holiday_fixture.py`，模板取自本地已有的真實 2026-01 資料）

| Fixture | 用途 | 結果 |
|---|---|---|
| `lunar-new-year:2026`（2026-02-14~22，9 天） | 完整連假 | `verify_holiday_parity.py` 全部 PASS：OD 守恆 15,642,549=15,642,549、118/118 站、pr_value≈1.0 |
| `lunar-new-year:2027`（2027-02-03~11，9 天） | 同 event_key 的另一年份 | 獨立 materialize、獨立 PASS，證明跨年互不干擾 |
| `test-holiday:2030`（少一天，8/9） | 反例 | `is_complete=0`，`coverage_note`＝「僅涵蓋 8/9 天」，`range_od_flow`/`range_pagerank` 皆 0 筆 |
| `test-holiday:2031`（9/9 天，其中一天少一個 period） | 反例 | `is_complete=0`，`coverage_note`＝「1 天沒有完整六個時段的資料，例如 2031-05-05 缺少 evening_peak」，`range_od_flow`/`range_pagerank` 皆 0 筆 |

### Retention 保護

`--dry-run --as-of 2033-01-01`（cutoff 2031-07-01）正確列出 4 個受影響、尚未完整 materialize
的 range（`test-holiday:2030`、`test-holiday:2031`、`year:2028`、`year:2029`），且正確排除已完整
的 `lunar-new-year:2026/2027`、`year:2027`。`--purge`（不帶 override）：拒絕執行，exit 1，
daily_od_flow 62,716,178 列數不變（4 次獨立確認，包含排除掉的一次因本地 D1 鎖爭用產生的
transient 失敗，重跑後結果一致）。加上 `--acknowledge-unmaterialized-ranges` 後：**實際刪除
62,716,178 列**（2026-01-01~2031-05-09 全部 daily 粒度資料），永久表（`real_od_flow`/
`real_pagerank`/`range_od_flow`/`range_pagerank`/`date_ranges`/`data_months`）purge 前後列數
完全相同。

**Purge 後**（`daily_od_flow` 歸零），重啟 dev server 實測：
`/api/recommend?range_type=holiday&event_key=lunar-new-year&year=2026` 與 `year=2027` **都仍然
正常回應推薦**（`data_source: real`），`/api/recommend?range_type=year&year=2027` 同樣正常——
證明已 materialize 的連假／年度 range 完全不受 daily retention 影響。

### API / Detail

- `range_type=holiday` 三種狀態（不存在／不完整／完整）分別回傳正確的 404/200 與訊息。
- `R10`（台北車站別名）與 `BL12` 的連假證據完全一致（同一組 `pr_value`）。
- 不完整連假（`test-holiday:2030`）的 Detail 請求正確 graceful fallback 回合成軌道，
  `range_error` 訊息正確。
- `/api/analytics/holidays` 正確依 `event_key` 分組、只列出完整實例、依年份新到舊排序。

### 前端

- 首頁：選台北車站 → 連假模式 → 春節／2026 → 送出 → 結果摘要「2026年春節」、metadata 句子
  「依 2026 春節連假旅運資料（2026-02-14 ～ 2026-02-22）」與 spec 範例逐字一致。
- Detail：進站點詳情顯示「資料範圍：2026 春節連假（2026-02-14 ～ 2026-02-22）」，PageRank／
  連結證據與文案全部標示連假來源；「返回本次推薦」→ 首頁正確還原連假模式／春節／2026／
  結果，Phase 3A 曾經出現過的「context 遺失退回月模式」問題在連假路徑上直接以同一套機制避免。
- Analytics：連假 ranking tab 正確載入、`current-data-summary` 顯示「真實連假資料 · 2026年
  春節（2026-02-14 ～ 2026-02-22）· 晨峰 07:00–09:00 · Top 20」。
- Stale-request protection：月模式送出後立刻切換連假模式再送出，最終結果正確停留在連假
  （後送出的請求），沒有被較早的月模式回應覆蓋。
- Responsive：390/768/1024/1440 四個寬度截圖確認，3 欄 toggle 與 event/年份下拉無 overflow。
- Keyboard/focus：連假選項沿用既有已驗證的 `.mp-query-chip` focus-visible pattern，無新元件、
  無新邏輯需要獨立驗證。
- BL11→night→food 基準：`['BL12','BL10','R11','BL18','BL15']` / `[0.79,0.38,0.38,0.37,0.33]`，
  purge 前後、全程不變。

### Remote Paid D1 smoke test

Disposable `metropulse-smoke-3b-holiday`：建立 → 暫時加入 `wrangler.jsonc` binding
（`d1 migrations apply` 需要，純 `d1 execute` 不需要）→ `bootstrap_db.py --remote`（7 個
migration 全部成功，含本次新增的 0007）→ `build_remote_smoke_fixture.py --year 2031 --remote`
（compact 17,520 列，不是完整合成年度的 22M 列）→ 直接登錄一個 `holiday_events` 測試列
（`lunar-new-year:2031`，2031-05-01~09，落在 fixture 涵蓋範圍內）→
`materialize_holiday_range.py --remote`（708 筆 PageRank）→ `verify_holiday_parity.py --remote`
全部 PASS（OD 守恆 70,632=70,632、118/118 站）→ 還原 `wrangler.jsonc`（`git diff` 確認為空）→
`wrangler d1 delete`（`wrangler d1 list` 確認只剩 `mrt-rank-db`）。全程未對 `mrt-rank-db`
執行任何寫入或 migration 指令。

### Build

| 檢查 | 結果 |
|---|---|
| `npm run build` | 成功，`dist/_worker.js 192.79 kB` |
| `git diff --check` | exit 0 |
| `git diff wrangler.jsonc`（兩次暫時 binding，皆已還原） | exit 0 |

---

## 8. 延後至 Phase 3B.1

- **跨年同連假比較**（例如 2026 春節 vs 2027 春節並列比較）：本 phase 只做「單一年份的一個
  holiday event」查詢，`holiday_events` 的 `(event_key, year)` 設計已經支援未來直接
  `WHERE event_key = ?` 撈多年份，不需要改 schema，但比較視圖（並列長條圖、差異指標）本身
  是新的產品決策，留給 3B.1。
- **Holiday trend line**：Phase 1 的月度 gap-handling 原則（`spanGaps:false`、不插值）若要
  套用到連假，需要先決定「連假實例之間本來就不等距，畫成連續折線是否會誤導成連續時間變化」
  這個 UX 問題（`temporal-architecture-design.md` 已指出這點），本 phase 不預先決定。
- **Custom date range**：`compute_service_date_period_coverage()`/`fetch_range_od_aggregate()`/
  `generate_range_materialization_sql()` 三個共用函式已經是通用日期區間介面，custom range
  理論上可以直接複用，但同步計算的效能路徑（Cloudflare Workers CPU 時間限制）與非同步排隊
  機制（見 `temporal-architecture-design.md` 的 Option A/B）尚未設計實作，留給後續 phase。
- **holiday_events 自動化來源**：目前完全仰賴人工維護；若之後要串接官方行事曆 API 自動更新，
  是新的範圍，需要另外評估來源可靠性。

不涉及 custom date range 實作；不改變 recommendation scoring；未部署 production；所有驗證使用
本地 D1 與 disposable remote D1，皆已清除。
