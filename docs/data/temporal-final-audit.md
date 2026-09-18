# MetroPulse — Temporal Final Audit

日期：2026-09-18
狀態：**Production-readiness audit，非新功能開發**
稽核範圍：Monthly / Yearly / Holiday recommendation、Cross-year same-holiday comparison。
明確排除：Custom date range（不做）、Weekend / weekday analysis（列為 future backlog，不實作）。
前置閱讀：temporal-architecture-design.md、temporal-phase1~3b1-*.md、docs/uiux/02-design-direction.md（皆已讀畢，稽核基於這些文件已確認的設計決策，不重新討論決策本身）。

方法：讀畢全部 phase 文件 → 兩個並行 code-review agent（data-truth/scoring、storage/ops）交叉核對現有原始碼 → 針對 agent 回報的高風險項目親自在本地 dev server 與本地 D1 上重現、驗證、修正、再驗證 → 瀏覽器實測主要 temporal flow（首頁→結果→詳情→返回、Analytics 連假比較）與 390/768/1024/1440 四個寬度 → `npm run build` / `git diff --check`。

---

## 1. 結論：NOT READY FOR PRODUCTION

技術核心（data truth、推薦計分、temporal context、UI/UX）稽核結果良好，稽核期間發現的唯一程式碼層級 P1 缺陷已修正並驗證。**未達 production ready 的原因是流程與維運層級的 P1 項目**，不是功能或資料正確性的問題——詳見第 2 節。

---

## 2. P0 / P1

**P0：無。**

**P1：**

1. **[已修正]** 年度／連假 range 重新 materialize 時會靜默把已完整（`is_complete=1`）的 range 降級為不完整，導致 API 誤報「資料不完整」，即使底層 `range_pagerank`/`range_od_flow` 完全沒事。詳見第 3 節。
2. **Phase 3B／3B.1（連假推薦、跨年連假比較）整批程式碼未 commit。** `git status` 顯示 migrations/0007、`materialize_holiday_range.py`、`verify_holiday_parity.py`、`build_holiday_fixture.py`、`build_compact_holiday_fixture.py`、兩份 phase 3B 文件，以及 `src/routes/*`、`src/db/queries.ts`、`src/index.ts` 等全部修改都是 untracked/uncommitted。**任何 git-based 部署流程目前都不會包含連假功能**——這不是程式碼缺陷，是不能忽略的部署阻塞點，需要人工決定何時、以何種粒度 commit。
3. **沒有自動化的推薦分數回歸測試。** `package.json` 沒有任何測試框架；`BL11→night→food` baseline（`['BL12','BL10','R11','BL18','BL15']` / `[0.79,0.38,0.38,0.37,0.33]`）過去每個 phase 都只靠人工 curl 比對後寫進文件，沒有任何 CI 或指令能自動抓到分數 regression。這是既有缺口（不是本次 Temporal 工作引入），但 Temporal 六個 phase 疊加的變更量已經足夠大，建議 production 前至少把這個 baseline 寫成一個可重跑的腳本（例如 `scripts/verify_recommend_baseline.py`），而不是繼續留在文件的人工紀錄裡。
4. **Retention 保護只涵蓋「已經被檢查過」的 range，沒有涵蓋「從未 materialize 過」的年度／連假。** `retention.py` 的 `find_unmaterialized_ranges_at_risk()` 只能保護已經在 `date_ranges` 有狀態列（哪怕是 `is_complete=0`）的 range；如果一個年度的月份逐步匯入中、但從未跑過 `materialize_year_range.py`，18 個月 rolling window 會在完全沒有警告的情況下把早期月份的 `daily_od_flow` 清掉，永久斷絕這個年度未來被完整化的可能。這是程式碼自己註解承認的已知範圍限制，但沒有在 README 或任何操作文件中提醒維運者「必須主動、提早、定期跑 materialize 才安全」。建議 production 前決定一個明確的 materialize 排程政策（例如：每個月匯入後立即嘗試 materialize 當年度／已知連假，即使預期會回報不完整）。

---

## 3. 已修正項目

**Bug：年度／連假 materialize 腳本重跑時會靜默降級已完整的 range。**

- **根因**：`generate_range_materialization_sql()`（`scripts/import_od_data.py`）在 `coverage['is_complete']` 為 `False` 時，只是**不寫入** `range_od_flow`/`range_pagerank`，但仍然對 `date_ranges` 執行 `INSERT OR REPLACE`，把 `is_complete` 覆蓋成 `0`。如果這個 range 過去已經完整 materialize 過（`range_pagerank`/`range_od_flow` 資料還在，且這正是文件反覆宣稱「永久保留、不受 retention 影響」的機制），而背後的 `daily_od_flow` 之後被 `retention.py` 的 18 個月保留窗口清掉一部分，這時如果有人（誤觸或排程）重新執行 `materialize_year_range.py`／`materialize_holiday_range.py`，就會把 `date_ranges.is_complete` 降級為 `0`——所有 gate 在 `is_complete=1` 的 API（`/api/recommend`、`/api/analytics/pagerank`、`/api/analytics/holiday-comparison`、station-detail）會立刻回報「資料不完整」，即使底層 PageRank 資料完全沒事、只是暫時不可達。
- **實測重現**：本地 D1 的 `year:2027` 本來就處於這個狀態（`date_ranges.is_complete=1`，但 `daily_od_flow` 對 2027 年已經是 0 列，因為 Phase 3A.1 文件記錄過的 retention 測試把它清空了）。先驗證「完全清空」的情況本身是安全的（`actual_day_count=0` 時腳本會提早 return，不寫入任何東西）；接著手動插入 2 列殘留的 `daily_od_flow`（模擬「部分清除」）重跑腳本，**修正前的邏輯會把 `year:2027` 降級為 `is_complete=0`**；修正後腳本正確拒絕執行並以非零狀態碼結束，`date_ranges`／`range_pagerank` 維持原狀不變（測試資料已清除，資料庫已還原）。
- **修正方式**：新增共用函式 `get_existing_range_is_complete()`（`scripts/import_od_data.py`），在 `materialize_year_range.py`／`materialize_holiday_range.py` 判定「這次重新計算結果不完整」時，先查詢資料庫目前的狀態；若現有列已經是 `is_complete=1`，直接印出 `[CRITICAL]` 說明並以 `sys.exit(1)` 中止，不寫入任何 SQL——不新增旗標、不改變任何現有成功路徑的行為，純粹是防止資料降級的安全閘門，與 `retention.py` 既有的「拒絕而非靜默執行」設計慣例一致。
- **驗證**：`python3 -m py_compile` 全部通過；`npm run build`／`git diff --check` 均無錯誤；針對本地 D1 的 partial-purge 情境端到端重現、確認修正後正確拒絕且資料不變、確認 `/api/recommend?range_type=year&year=2027` 修正後仍正常運作。

**未修正、但已當場驗證非新問題**：`month:2026-01` 在 `date_ranges` 的 `is_complete` 欄位是 `0`（月度 range materialize pipeline 從未寫入這個欄位）。已確認 `recommend.ts`／`analytics.ts` 的月份路徑完全不讀 `date_ranges.is_complete`（月份走的是 Phase 1 就有的 `data_months`/`real_pagerank` 路徑），所以目前沒有任何功能受影響——純粹是欄位語意不一致，留在第 5 節的 P2 待改善清單。

---

## 4. Temporal data-truth verdict：PASS

- **Month**：完整性沿用 Phase 1 既有邏輯（`data_months` 存在即視為該月已匯入），與 Phase 2 之後的 `date_ranges`/`is_complete` 機制完全獨立，兩條路徑互不干擾（已確認 `month:2026-01` 的 `is_complete=0` 不影響任何 API 行為，見第 3 節）。
- **Year／Holiday**：completeness 規則直接讀原始碼確認為雙重條件——`compute_service_date_period_coverage()`（`scripts/import_od_data.py`）同時要求 (1) 區間內每一天都有 `daily_od_flow` 資料、(2) 每個有資料的日期六個既有 period 都齊；只看 distinct 天數會漏掉「某天只匯入 5 個 period」的情況，程式碼證實沒有這個漏洞。`materialize_year_range.py`／`materialize_holiday_range.py` 呼叫的是同一組共用函式（`compute_service_date_period_coverage`／`fetch_range_od_aggregate`／`generate_range_materialization_sql`），不是各自重寫、可能分歧的邏輯。
- **Missing ≠ 0**：不完整 range 一律不寫入 `range_od_flow`/`range_pagerank`（原始碼確認 `if coverage['is_complete']:` 是唯一的寫入分支）；API 層對缺值一律回傳 `null` 並附 `coverage`/`coverage_note` 說明原因，前端（`renderCompareTable`/`renderCompareCharts`）確認不把 `null` 顯示或畫成 `0`，且不完整年份完全不出現在比較圖表的 x 軸上（已讀原始碼 `filter(y => y.status === 'complete')` 確認，並在瀏覽器對 `test-holiday:2030`／`range_type=year&year=2028`／`range_type=holiday&event_key=test-holiday&year=2030` 三個不完整情境實測，皆正確回 404 並附 `coverage`）。
- **Temporal context 一致性**：首頁→結果→站點詳情→返回推薦，已針對連假（最嚴格的新增路徑）端到端實測：選台北車站→連假模式→春節/2027→送出→結果摘要顯示「依 2027 春節連假旅運資料（2027-02-03～2027-02-11）」→查看站點詳情正確顯示同一段連假日期與「連結值來自 2027 春節連假 range_od_flow」→返回本次推薦，首頁正確還原連假模式／春節／2027／結果排名。全程無退回月模式或遺失 context 的情況。
- **API-confirmed metadata**：`renderMetadata()`／`renderStationDetail()` 讀取的都是伺服器回應的 `metadata.range`/`range_label`/`range_error`，不是送出前的草稿選擇（原始碼確認 + 實測確認）。
- **Recommendation scoring 不變**：`src/lib/recommender.ts`／`src/lib/normalizer.ts` 與 branch base（`main`）逐位元組相同，`GAMMA=0.85`／`POWER_ITER=150` 未變動；年／月／連假三種 range 全部透過 `getRangePageRankMap`/`getRangeTransitionMap`（或 `getRealPageRankMap`/`getRealTransitionMap`）產出相同形狀的 Map，餵給同一個、唯一的 `computeRecommendations()` 呼叫點（`src/routes/recommend.ts`），沒有平行或分歧的計分路徑。`BL11→night→food` baseline 已在本次稽核當場重新請求驗證：`['BL12','BL10','R11','BL18','BL15']` / `[0.79,0.38,0.38,0.37,0.33]`，與所有 phase 文件記錄的基準逐項相同。

次要發現（P2，見第 6 節）：`station-detail.ts` 對 `range_type` 的驗證與錯誤回應風格與 `recommend.ts`/`analytics.ts` 不完全一致（前者不驗證非法值、且用 200+`range_error` 而非 404），屬設計選擇（Detail 頁必須永遠能渲染）但值得記錄以免日後被誤當成 bug 修掉。

---

## 5. UI/UX verdict：PASS

- 首頁「資料範圍」三選項 fieldset（月份／年度／連假）在 390/768/1024/1440 四個寬度下皆無橫向溢出（本次逐一用瀏覽器實測 `document.body.scrollWidth <= window.innerWidth` 確認，不只是讀文件記錄）；390px 下維持既有 chip 樣式與間距，未新增額外 dropdown 或 clutter。
- Analytics 頁「連假比較」分頁重用既有 tablist／`.mp-data-table`／`.mp-table-scroll` 元件，兩張比較圖確認是 Chart.js `bar`（類別長條圖），不是連續趨勢折線——與 design-direction.md「連假實例之間不等距，畫成連續線會誤導」的要求一致，已截圖與程式碼雙重確認。
- 不完整／未計算的年份／連假在圖表中完全不出現（不是畫成 0 高度柱狀），資料表對應列顯示「資料不足」／「不完整」／狀態原因，皆已即時於瀏覽器驗證，非僅讀文件。
- CSS diff（`public/static/styles.css`）僅新增少量沿用既有 `--mp-*` token 與既有 spacing scale 的規則，沒有新顏色、沒有漸層／陰影／圓角越權，符合 design-direction.md 第 4、7、9、22 節的限制。
- Keyboard/focus：連假、年度控制沿用既有已驗證過的 `.mp-query-chip:has(input:focus-visible)`／tablist roving tabindex pattern，本次稽核未發現任何新增的、未經驗證的鍵盤陷阱。

---

## 6. Regression / build 結果

| 項目 | 結果 |
|---|---|
| `npm run build` | 成功，`dist/_worker.js 210.88 kB` |
| `git diff --check` | exit 0（含本次修正的檔案） |
| `python3 -m py_compile`（本次修改的三支腳本） | 全部通過 |
| BL11→night→food baseline（即時重新請求） | `['BL12','BL10','R11','BL18','BL15']` / `[0.79,0.38,0.38,0.37,0.33]`，與歷次文件記錄相同 |
| `recommender.ts`／`normalizer.ts` vs branch base | 逐位元組相同（`git diff main...HEAD` 僅一行 header 註解變更，非本次或任一 temporal phase 引入） |
| 390 / 768 / 1024 / 1440 無橫向溢出 | 四個寬度本次逐一即時驗證通過 |
| 年度／連假 incomplete 錯誤路徑（404 + coverage） | `range_type=year&year=2028`、`range_type=holiday&event_key=test-holiday&year=2030` 即時驗證皆為 404，內容與文件宣稱一致 |
| station-detail graceful degradation（incomplete year） | `range_type=year&year=2029` 即時驗證回 200，正確退回合成軌道並附 `range_error` |
| `/api/analytics/holidays` 排除不完整年份 | 即時驗證只列出 `lunar-new-year:2026/2027`，未列出任何 `is_complete=0` 的連假 |
| P1 降級 bug 修正 | 見第 3 節，端到端重現＋修正＋驗證＋清除測試資料 |

**P2（可上線後改善，未自動修正）：**

1. D1 Paid tier 假設（18 個月保留窗口 ≈5.4GB，需要 Workers Paid plan）只寫在 `docs/data/temporal-phase2c-foundation.md`，README／`retention.py --help`／任何腳本 docstring 都沒有提及，維運者第一次執行可能毫無預警。
2. `materialize_year_range.py`／`materialize_holiday_range.py` 在 `actual_day_count==0` 時印出「只記錄狀態列」，但實際上完全沒有寫入 `date_ranges`（訊息與行為不符，不影響正確性，僅誤導除錯）。
3. `verify_range_parity.py`／`verify_year_parity.py`／`verify_holiday_parity.py` 的容忍度常數各自獨立定義，未共用，日後修改容忍度哲學不會自動同步三支腳本。
4. `station-detail.ts` 不驗證 `range_type` 的合法值（非法值直接當作沒帶，不像 `recommend.ts`/`analytics.ts` 回 400）；且用 200+`range_error` 而非 404 表示 range 不可用——皆為刻意設計（Detail 頁必須優雅降級），但與另外兩個路由的錯誤慣例不完全一致，值得留意但不建議現在改動（改動可能破壞「Detail 永遠能渲染」的既有承諾）。
5. `recommend.ts` 的 404 回應附 `hint` 欄位，`analytics.ts` 的 404 沒有——風格差異，不影響功能。
6. 本地開發 D1 目前混有測試用的 `holiday_events`（`test-compare`、`test-holiday`）與大量合成 fixture 年份（2027/2028/2029/2031）——這些**絕對不能**跟著遷移到 production D1，需要在部署前手動確認 production 只透過 `bootstrap_db.py` + 手動登錄的真實 `holiday_events` 建立，不是複製本地 `.sqlite` 檔案。

---

## 7. Production 前人工 checklist

1. **Commit Phase 3B／3B.1 全部變更**（migrations/0007、`materialize_holiday_range.py`、`verify_holiday_parity.py`、`build_holiday_fixture.py`、`build_compact_holiday_fixture.py`、本次修正的三支腳本、所有路由／查詢／前端修改），否則連假功能不會被部署。
2. **確認 Cloudflare 帳號方案**：18 個月 `daily_od_flow` 保留窗口的儲存投影（穩態 ≈5.4GB）需要 Workers Paid plan；Free tier 會在數個月內撞到 500MB 上限。這是 Phase 2C 就標記過、至今仍未確認的帳務決策。
3. **在 production D1 上執行官方 bootstrap 流程**（`bootstrap_db.py` 三步驟），不要手動複製本地 `.sqlite` 或本地測試用的 `holiday_events`／fixture 年份。
4. **人工登錄 production 用的 `holiday_events`**（春節、端午、國慶等），每一列的 `source` 欄位必須可追溯到官方公告，不可用本次稽核發現的測試列（`test-compare`/`test-holiday`）充數。
5. **決定並文件化 materialize 排程政策**：多常對已知年度／連假重跑 `materialize_year_range.py`／`materialize_holiday_range.py`，以避免第 2 節 P1-4 描述的「從未 materialize 過的年度被 retention 無聲清除」風險。
6. **決定 retention.py 的執行排程**（誰、多常執行 `--purge`），目前仍是手動工具。
7. **確認遠端 D1 是否需要重新驗證本次新增的降級防護**：本次修正只在本地 D1 端到端驗證過；建議部署前比照 Phase 2B/2C 的做法，在 disposable remote D1 上重複一次「部分 purge 後重跑 materialize」情境，確認 `get_existing_range_is_complete()` 在遠端查詢路徑（`_d1_json_query` 走 `wrangler d1 execute --remote`）行為與本地一致。
8. **建議（非阻塞）**：把 `BL11→night→food` 等 baseline 檢查寫成可重跑腳本，取代目前純人工 curl 比對記錄在文件裡的做法。

---

## 8. Future backlog（明確不在本次範圍）

- **Custom date range**：架構（`date_ranges`／`range_od_flow`／`range_pagerank`／共用 materialization 函式）已經是通用設計、理論上可直接沿用，但同步計算的 Cloudflare Workers CPU 時間限制與非同步排隊機制（架構文件的 Option A/B）從未設計實作，需要獨立的效能評估與產品決策。
- **Weekend / weekday analysis**：目前的 6 段 `period` 與 daily 粒度資料理論上可以支援，但「平日/假日」切分本身是新的研究方法決策（不是本次六項既有決策涵蓋的範圍），需要另外定義切分規則與呈現方式，故列為 future enhancement，本次不實作。
