# MetroPulse — Temporal Data Capability Audit

日期：2026-09-16
範圍：`uiux-redesign` 分支（`main` 尚未合併此分支；`main` 完全不含 `real_*` 資料表、`/api/analytics/*`、月份分析頁與 [08-final-release-audit.md](../uiux/08-final-release-audit.md)，該文件只存在於 `uiux-redesign`）。本稽核僅讀取程式與 migrations，未執行 import、未修改推薦公式、未部署。

## 前情提要：兩條平行的資料軌道

專案目前同時存在兩套時間語意完全不同的資料：

| 軌道 | 資料表 | 時間粒度 | 使用者 |
|---|---|---|---|
| **合成／既有（v1）** | `pagerank_scores`、`transition_matrix`、`station_tags`、`travel_costs`（[0001_schema.sql](../../migrations/0001_schema.sql)） | 僅 `time_period`（一天 6 個時段），**無 year/無 month**，全站只有一份「快照」 | `/api/recommend`（data_mode=synthetic 或無真實資料時 fallback）、`/api/pagerank`、`/api/pagerank/:stationId`、`/api/station-detail/:id`（PR 時序） |
| **真實 OD（v2）** | `data_months`、`real_od_flow`、`real_pagerank`（[0002_real_data.sql](../../migrations/0002_real_data.sql)） | `year` + `month`（曆月），**無日期/無小時** | `/api/analytics/*`、`/api/recommend`（data_mode=auto/real 時覆蓋 PR 與連結值） |

這個區分是整份稽核的關�。任何「時序」功能都要先問：走的是哪一條軌道。

---

## Capability Matrix

| Feature | Supported / Partial / Not supported | Current mechanism | Missing requirement |
|---|---|---|---|
| **Monthly recommendation**（指定 2026-01 → morning_peak → recommendation） | **Not supported** | [`recommend.ts`](../../src/routes/recommend.ts) 只有 `data_mode`（auto/real/synthetic）參數；真實資料路徑一律呼叫 `getLatestDataMonth()`（[queries.ts:243](../../src/db/queries.ts#L243)）取「最新已匯入月份」，**沒有 `year`/`month` query 參數可指定**。即使 DB 裡已有 2026-01 和 2026-03 兩個月，`/api/recommend` 也只會用最新一個月，無法要求「用 2026-01 的資料推薦」 | 在 `recommend.ts` 加 `year`/`month` 參數，改用 `getRealPageRankMap(db, year, month, period)` / `getRealTransitionMap(...)` 而非 `getLatestDataMonth`；需決定「指定月份不存在」時的 fallback 行為（報錯 vs 退回 synthetic vs 退回最新月）— 此為產品行為決策，不只是工程 |
| **Month switching**（分析頁切換月份） | **Supported** | `/api/analytics/months` 回傳已匯入月份列表；`/api/analytics/pagerank`、`/flow`、`/station-pr` 都接受 `year`/`month`（[analytics.ts](../../src/routes/analytics.ts)）；前端 `<select id="sel-month">` 由真實月份列表動態產生（[index.ts:1690-1712](../../src/index.ts#L1690)），非寫死選項 | 無（僅適用真實軌道；合成軌道 `/api/pagerank` 沒有月份概念可切） |
| **Multi-month storage**（新月份匯入不覆蓋舊月份） | **Supported**（僅真實軌道） | `data_months`/`real_od_flow`/`real_pagerank` 的 PK 都含 `(year, month)`；ETL（[import_od_data.py](../../scripts/import_od_data.py) `generate_sql()`）對每次匯入是 `DELETE FROM real_od_flow WHERE year=? AND month=?` 後只 `INSERT OR REPLACE` 該月資料，不觸及其他月份 | 無資料庫層風險。但**合成軌道**（`pagerank_scores`/`transition_matrix`）完全沒有月份欄位，全域只有一份，ETL 不會、也無法對它做多版本管理——`/api/pagerank`、`/api/station-detail/:id` 永遠讀同一份合成快照，與月份匯入無關 |
| **Yearly recommendation**（整年推薦） | **Not supported** | 全庫（`queries.ts`/`analytics.ts`/`recommend.ts`）沒有任何 `GROUP BY year`、跨月加總或平均的程式碼 | DB 層面**可行**：`real_pagerank`/`real_od_flow` 都有 `year`+`month`，理論上可對同一年份的 12 筆月資料做加總或平均。但用什麼統計量代表「整年」（月 PR 簡單平均？依各月原始人次加權平均？還是把整年 OD 加總後重新跑一次 Power Method？月份不足 12 個時怎麼算？）是**研究方法選擇，不應由工程自行決定**（詳見下方「涉及研究方法」段落） |
| **Arbitrary date range**（任意日期區間） | **Not supported，且目前資料無法還原** | `real_od_flow`/`real_pagerank` 的鍵是 `(…, year, month)`，**沒有日期欄位**。ETL 來源 CSV 本身逐行有「日期」欄（[import_od_data.py](../../scripts/import_od_data.py) 開頭格式說明：`日期,時段,進站,出站,人次`），但 `process_csv_stream()` 解析時**只取 `hour_str` 對應到 6 個時段、把整月同時段流量加總進 `od_by_period[period][(from_id,to_id)]`，日期欄位被讀取後即捨棄，從未寫入任何輸出結構** | 這不是「補 API」就能解決的：現有 D1 裡已匯入的月份**永久遺失了日期粒度**，唯一補救是拿原始 CSV 重新跑一版**保留日期欄**的 ETL、新增日期粒度的資料表（新 migration）、重新匯入。屬於「需要不同粒度原始資料處理方式」，不是「需要不同粒度的原始公開資料」——公開資料本身就有日期，是本專案的匯入邏輯把它丟棄了 |
| **Holiday comparison**（特定連假／日期區間推薦） | **Not supported，不可由現有資料可靠還原** | 同上；`grep` 全庫確認沒有任何 `holiday`/`date_range`/`is_holiday`/`weekday` 相關程式碼或欄位 | 月度加總資料把「連假 3 天」和「該月其餘 27-28 天」混在同一個數字裡，**不能**把月度 PR/OD 拿來冒充連假期間的數值。需要：① 日期粒度的 ETL 與資料表（同上）；② 明確定義「連假」的日期區間規則（是否含前後補班日、跨月連假如何切）——**這是研究/領域定義決策，不是工程可以自行拍板的事** |
| **Multi-year same-holiday comparison**（歷年同一連假比較） | **Not supported** | 是「Holiday comparison」的更嚴格版本，前置需求完全相同且需多年份資料 | 除了上一列的全部需求外，還需要「跨年度對齊同一節日」的定義（例：農曆春節每年國曆日期不同，2026 年初一與 2027 年初一相差近半個月，「同一連假」要用農曆對齊還是國定假日公告日期對齊）——**明確屬於研究方法選擇**，工程只能等待此定義後才能設計 schema |
| **Monthly trend**（≥2 個真實月份時的跨月 PR 折線圖） | **Partial** | 機制是真的，不只是 UI 殼子：`GET /api/analytics/trends?station=&period=`（[analytics.ts](../../src/routes/analytics.ts) → `getStationPrTrends`，[queries.ts:279-291](../../src/db/queries.ts#L279)）依 `(station_id, period)` 回傳所有已匯入月份的 `(year, month, pr_value, pr_rank)`，`ORDER BY year, month`；前端 `loadTrend()`（[index.ts:1861-1947](../../src/index.ts#L1861)）只在 `trends.length > 1` 時才把標題改成「跨月份 PageRank 趨勢」並畫折線圖，恰好 1 筆時明確顯示「目前僅一個月份，尚不足判讀趨勢」，不會用單點資料偽裝成趨勢 | 站點識別（station identity）也是真實邏輯，非僅 UI：輸入站名可能對應多個轉乘代表站時會擋下並要求選明確站碼（[index.ts:1863-1872](../../src/index.ts#L1863)）。**缺口**：missing month 沒有被特別標示——Chart.js 的 X 軸標籤直接用「有資料的月份」字串陣列產生（[index.ts:1912](../../src/index.ts#L1912)），若 2026-01 與 2026-03 有資料但 2026-02 沒匯入，折線圖會把 1 月、3 月畫成相鄰兩點，視覺上看起來像連續月份，沒有缺口或虛線提示中間少一個月 |
| **Yearly trend**（跨年度趨勢彙整） | **Not supported** | `/api/analytics/trends` 回傳的是原始月資料點，沒有以「年」為單位做彙整或年增率之類的計算；若未來有 24 個月（跨 2 年）的資料，會照樣畫成一條 24 個點的折線，而不是「兩個年度值」的比較 | 同「Yearly recommendation」，統計量定義是研究方法問題，需先定義後才有 API/DB 工作 |

**額外澄清（item 5 的另一半）**：Station Detail 頁（`/station/:id`）上顯示的「PageRank 時序折線圖」**不是**月度趨勢，而是合成軌道的 6 個 `time_period`（[station-detail.ts:70-77](../../src/routes/station-detail.ts#L70)）；`metadata.data_month` 在該路由裡被寫死為 `null`（[station-detail.ts:120](../../src/routes/station-detail.ts#L120)），完全未串接 `real_pagerank`。真正的跨月趨勢只存在於 `/analytics` 頁的「月份資料」分頁，兩者是互不相通的兩套實作，容易被誤認為同一件事。

---

## 現有資料表的時間粒度

- 合成軌道：`time_period`（6 段，一天內循環），無日期概念，全庫僅一份，等同「時間之外」的靜態表。
- 真實軌道：`year` + `month`（曆月），無日、無週、無小時、無農曆／國定假日標記。
- 上游公開資料（臺北捷運每日分時各站 OD 流量統計 CSV）本身粒度是**逐日 + 逐小時**，比本專案 DB 存的細很多；差距是本專案 ETL 主動丟棄造成的，不是公開資料本身的限制。

## Import 新月份是否安全

安全，在真實軌道的資料庫層面：`data_months`/`real_od_flow`/`real_pagerank` 的 PRIMARY KEY 都含 `year, month`，ETL 對目標月份先 `DELETE` 再 `INSERT OR REPLACE`，範圍精準限定在該 `(year, month)`，不會動到其他月份的既有列（[import_od_data.py](../../scripts/import_od_data.py) `generate_sql()`）。`data_months` 用 `INSERT OR REPLACE`，重複匯入同一個月會正確更新該月的 `row_count`/`imported_at` 而不會產生重複列。

需要注意的操作面風險（非資料庫層 bug，是流程層）：
- 匯入完全是手動指令（`--year --month`），沒有防呆檢查「這個月是否已經匯過」或「年月參數是否打錯」；打錯 `--month` 會用錯誤標籤覆蓋掉那個（錯誤的）月份格。
- README 明確把「定期自動匯入最新月份（CI/CD）」列為未完成項目，目前不是自動化流程。
- 合成軌道完全不受匯入影響，也無法被匯入更新——它是專案初始 `seed.sql` 寫死的單一快照，永遠停留在建置當下的樣子。

## API 目前接受哪些 temporal parameters

| 端點 | 接受的時間參數 |
|---|---|
| `GET /api/recommend` | 無 `year`/`month`；只有 `data_mode`（auto/real/synthetic），真實模式下強制用「最新已匯入月份」 |
| `GET /api/analytics/pagerank` | `year`, `month`, `period`（缺省時自動取最新月份） |
| `GET /api/analytics/flow` | `year`, `month`, `period`（缺省時自動取最新月份） |
| `GET /api/analytics/station-pr` | `year`, `month`（缺省時自動取最新月份） |
| `GET /api/analytics/trends` | `period` 而已（無 `year`/`month`，回傳該站該時段**所有**已匯入月份，無起訖區間可篩） |
| `GET /api/analytics/months`, `/latest` | 無 |
| `GET /api/pagerank`, `/api/pagerank/:stationId` | 無（合成軌道，`time_period` 而非月份） |
| `GET /api/station-detail/:id` | 無 |

## 哪些功能只差 UI

嚴格來說**沒有**。稽核範圍內每一項「Not supported」都同時缺 API 參數與對應查詢函式（或缺資料本身），沒有發現「API/DB 都準備好了、只是前端沒接」的案例。`/api/recommend` 缺 `year`/`month` 參數是最接近「小補丁」的一項，但仍需新增後端參數處理與查詢邏輯，不是純前端工作。

## 哪些需要 API / DB 改動

- 指定月份推薦：`recommend.ts` 加參數 + 改查詢邏輯（不需改 schema，`real_pagerank`/`real_od_flow` 已有 year/month）。
- Missing month 在趨勢圖上的視覺缺口標示：前端圖表邏輯（X 軸改用連續月份序列、缺月留空值），不需改 DB。
- 整年推薦／跨年趨勢彙整：需要新的彙整查詢（`GROUP BY year` 或等效邏輯），**但彙整公式需等研究方法決策後才能定案**，故列在下一節。

## 哪些需要不同粒度的原始公開資料處理方式

- 任意日期區間推薦／分析、連假比較、歷年同連假比較：都需要日期粒度的資料表（新 migration）與**修改 ETL 保留 CSV 的「日期」欄**（目前 `process_csv_stream()` 讀到即丟）。公開資料源本身已具備逐日資料，不需要向資料源要求更細的資料，只需要本專案的匯入邏輯不要再丟棄它。
- 這類改動屬於中～大型變更：新表、重新匯入所有已處理月份（現有月份的日期粒度已經永久遺失，補不回來，只能重新下載 CSV 重跑）。

## 哪些地方涉及研究方法選擇，不能由工程自行決定

1. **整年 PageRank 如何定義**：12 個月 PR 值的簡單平均？依各月原始人次加權平均？還是把整年 OD 流量加總後重新跑一次 Power Method（可能得到與「月度平均」不同的排名）？月份不足 12 個時是否仍可稱為「年度」？
2. **連假的定義與邊界**：連假是否含補班日／調整放假日？跨月連假（如跨兩個曆月）如何處理，因為現有月度聚合會把連假切成兩截、分屬不同月資料列？
3. **「同一連假」跨年對齊方式**：農曆節日（春節）每年國曆日期不同，要用農曆日期對齊、國定假日公告日期對齊，還是「連假第 N 天」相對對齊？
4. **趨勢圖的缺月語意**：中間缺一個月時，折線該畫成斷點、插值，還是明確留白？這會影響讀者對「連續上升/下降」的判讀，屬於資料呈現的方法論決定，不只是圖表庫用法問題。

以上四點本稽核**不代為決定**，僅指出它們是後續實作前必須先由產品／研究端拍板的前提，工程端在拿到定義前不應假設任一答案並直接實作。
