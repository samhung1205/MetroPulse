# 🚇 MetroPulse — 台北捷運智慧推薦系統

## 專案概覽

**MetroPulse** 是一個基於 **PageRank 演算法**的台北捷運站點推薦系統。

本專案將 Google PageRank 的「連結分析」概念遷移到捷運人流分析：
- 人流量即連結 — 越多人從各站流向某一站，該站越「重要」
- 轉移機率矩陣 — 建構站與站之間的人流流向
- 時段化分析 — 不同時段有不同的人流模式與站點熱門度

在此學術模型基礎上，疊加偏好匹配與旅行成本，構成一個可檢視評分依據與資料限制的推薦系統。

## 核心功能

### 已完成（v2.0）

- **智慧推薦引擎**：輸入出發站、時段、偏好，推薦 Top 5 捷運站
- **可解釋分數**：每個推薦結果展示四維分數拆解（熱門度、連結性、偏好匹配、旅行成本）
- **推薦理由**：自動生成自然語言的推薦理由
- **互動查詢介面**：支援鍵盤的站點搜尋、時段 select、偏好 radio；依選定歷史時段取得推薦，非即時人潮預測
- **一致圖示系統**：首頁查詢、偏好、地圖工具列、推薦證據與分析頁籤共用單一 inline SVG symbol sprite；地圖工具列採 16px icon + 文字，桌機使用緊湊密度、手機保留 44px 觸控高度；保留既有可及性名稱，不載入額外 icon runtime
- **推薦結果**：有序站點清單、具體理由、0.xx 排序分數；原生 disclosure 展示評分依據，Chart.js 提供選用的固定 0–1 總分比較
- **推薦方法區**：以 LaTeX 呈現靠左多行公式，並說明正規化、權重與資料限制，區分 PageRank 研究模型與目前推薦資料路徑
- **RESTful API**：完整的後端 API，可獨立使用
- **SVG 捷運路線圖**：原生 SVG `viewBox` 有界縮放、重設與 Pointer Events 拖曳；visual marker 與 hit layer 分離，同座標轉乘節點會要求明確選擇站碼；高密度區以局部 label offset／side 微調降低碰撞，不改路網拓樸
- **站點詳情頁**：延續推薦查詢脈絡，先呈現站點身分、推薦關係與特徵，再提供 PageRank、偏好與人流連結證據及同源資料表
- **🆕 真實旅運量資料接入**：整合台北捷運公開 OD 資料，以真實旅運量計算 PageRank
- **🆕 旅運量分析中心**：`/analytics` 頁面，支援月份、時段、Top 10/20/30、站點排名與月份資料；只有兩個以上月份才顯示跨月趨勢
- **🆕 Temporal range 查詢**：`range_type=month|year|holiday` 三種資料範圍——月份（既有行為）、整年（`range_type=year&year=`，只有該曆年 12 個月皆已匯入才會標記為完整）、連假（`range_type=holiday&event_key=&year=`，見下方「production 連假支援」）。年度／連假的 OD 與 PageRank 皆是**重新聚合、重新跑 Power Method**算出來的獨立結果，不是把月度 PageRank 平均——PageRank 不是線性可加總的量。
- **🆕 同節日跨年比較**：`GET /api/analytics/holiday-comparison?event_key=&period=&station=`，同一個連假（如春節）不同年份並排比較 PageRank 排名與 OD 流量；缺資料或尚未完整計算的年份會明確標示狀態（`not_materialized` / `incomplete`），不會被當成 0 呈現。

### 未來擴充

- [ ] gamma 參數互動調整面板
- [ ] 使用者回饋與推薦改善
- [ ] 多段行程規劃
- [ ] Weekend／weekday 分析（目前推薦與分析皆不分平假日）
- [ ] Custom date range（目前只支援月份／年度／已登錄連假三種固定範圍，使用者無法自訂任意起訖日）
- [ ] **Special Overnight Event Analysis**：目前六時段模型（見下方時段劃分）刻意不涵蓋 23:00 及 00:00–06:00，這不是遺漏——只有官方公告的特殊延長／通宵營運事件（例如跨年夜）才有分析這段時間的意義，一般日期的凌晨時段本來就不是這個推薦系統要處理的場景。未來若要支援，會是針對特定事件的獨立分析，**不會**修改現有六時段 period architecture。
- [ ] 定期自動匯入最新月份旅運量（CI/CD）——目前為人工執行，見下方「monthly 更新 SOP」

## 頁面與路由

| 頁面 | 路徑 | 說明 |
|------|------|------|
| 首頁 | `/` | 查詢表單優先 + 選用 SVG 路線圖 + 推薦結果 + 研究說明 |
| 站點詳情 | `/station/:id` | 站點身分、推薦脈絡、站點特徵、PageRank／偏好／連結證據 |
| 旅運量分析 | `/analytics` | 月份／時段／Top N 控制、真實 PR 排名、比較圖與月份資料 |
| API 根 | `/api` | API 端點列表 |

## 推薦演算法

### 推薦分數公式

$$
\begin{aligned}
& \mathrm{RecommendationScore}(i \rightarrow j, t, \mathrm{pref}) = \\
& \quad w_1 \times \mathrm{norm}(\mathrm{PR}_j(t)) \quad \text{時段熱門度 (0.30)} \\
& \quad + w_2 \times \mathrm{norm}(\mathrm{transition}_{ij}(t)) \quad \text{人流連結值 (0.25)} \\
& \quad + w_3 \times \mathrm{PreferenceMatch}(j, \mathrm{pref}) \quad \text{偏好匹配度 (0.30)} \\
& \quad - w_4 \times \mathrm{norm}(\mathrm{TravelCost}(i, j)) \quad \text{旅行成本 (0.15)}
\end{aligned}
$$

$$
\mathrm{norm}(x) = \frac{x - x_{\min}}{x_{\max} - x_{\min}}
$$

每項加權分量先取四位小數；加減後負值截為 0，再取兩位小數作為排序分數。`norm` 的範圍取自排除出發站後的全部候選；全值相同時回傳 0.5。偏好標籤評分不再做候選間 Min-Max 正規化。排序分數不是個人喜愛機率，也不宜跨查詢比較。

### 研究模型：轉移機率矩陣

$$
p_{ij} = \gamma \times \left(\frac{e_{ij}}{s_i}\right) + (1 - \gamma) \times \left(\frac{1}{n}\right), \quad \gamma = 0.85
$$


上述是含阻尼的研究模型。**目前 real 資料路徑**取已匯入月份的 PageRank，`getRealTransitionMap` 以起站在該月份／時段的 OD 流量占比取得連結值，並非每次推薦都即時計算上方 γ 公式。只有具對應記錄的欄位才以真實資料覆蓋；其他資料仍可能沿用既有值。結果摘要呈現 API 的 `data_source` / `data_month`，不宣稱每站、每項指標都有真實觀測。

### 四個評分維度

| 維度 | 權重 | 說明 |
|------|------|------|
| PR_j(t) | 0.30 | 站點在時段 t 的 PageRank 值（Power Method 計算） |
| transition_ij(t) | 0.25 | 目前資料路徑提供的起站到候選站連結值，再做候選間正規化 |
| PreferenceMatch | 0.30 | 站點偏好標籤與使用者選擇的匹配度 |
| TravelCost | 0.15 | 既有交通成本分數，正規化後作負向項；不可直接還原已核實旅程時間 |

## API 文件

### 核心推薦 API

```
GET /api/recommend?from={站點ID}&time_period={時段}&preference={偏好}&top_n={數量}
```

**參數：**

| 參數 | 必填 | 說明 | 範例 |
|------|------|------|------|
| from | ✅ | 出發站 ID | BL12, R03, BL11 |
| time_period | ✅ | 時段 | morning_peak, morning, noon, afternoon, evening_peak, night |
| preference | 選填 | 偏好 | attraction, food, shopping, nightlife, family, all |
| top_n | 選填 | 數量（預設 5） | 1~20 |
| range_type | 選填 | 資料範圍（預設 `month`，向下相容不帶此參數的既有呼叫） | `month`／`year`／`holiday` |
| year, month | `range_type=month` 時選填；`range_type=year` 時 year 必填 | 指定月份／年度；不帶 year/month 時取最新已匯入月份 | year=2025&month=1 |
| event_key, year | `range_type=holiday` 時皆必填 | 連假事件代碼與年份（不可與 month 併用） | event_key=lunar-new-year&year=2025 |

**範例：**
```bash
curl "/api/recommend?from=BL12&time_period=afternoon&preference=food&top_n=5"
curl "/api/recommend?from=BL12&time_period=night&preference=food&range_type=year&year=2025"
curl "/api/recommend?from=BL12&time_period=night&preference=food&range_type=holiday&event_key=lunar-new-year&year=2025"
```

### 其他 API

| 端點 | 說明 |
|------|------|
| `GET /api/stations` | 所有站點列表（支援 `?line=BL` 或 `?search=台北`） |
| `GET /api/stations/:id` | 站點詳情 + 標籤 |
| `GET /api/station-detail/:id` | 站點完整詳情（PR 時序、偏好雷達、人流連結） |
| `GET /api/pagerank?time_period=afternoon&top_n=10` | PageRank 排名（合成資料） |
| `GET /api/pagerank/:stationId` | 站點各時段 PR 值 |
| `GET /api/recommend/options` | 表單選項（站點、時段、偏好列表） |
| `GET /api/analytics/months` | 已匯入的真實旅運量月份列表 |
| `GET /api/analytics/years` | 已完整 materialize 的年度列表（不完整年度不會出現） |
| `GET /api/analytics/holidays` | 已登錄的連假列表，依 event_key 分組、標示每年是否已完整 materialize |
| `GET /api/analytics/pagerank?range_type=&year=&month=&event_key=&period=` | 真實 PageRank 排名，支援月／年／連假三種 range_type |
| `GET /api/analytics/flow?from=&year=&month=&period=` | 起站 OD 流量 Top N |
| `GET /api/analytics/trends?station=&period=` | 站點跨月 PR 趨勢 |
| `GET /api/analytics/holiday-comparison?event_key=&period=&station=` | 同一連假跨年比較（PageRank／OD 流量），見上方「同節日跨年比較」 |

## 資料架構

### 資料表

以下為種子資料的概略規模；實際匯入後請以 D1 查詢為準，不代表每筆都有真實觀測來源。

| 資料表 | 筆數 | 說明 |
|--------|------|------|
| stations | 依實際匯入而定 | 以 `/api/stations` 回傳為準；站碼記錄包含同名轉乘站的不同代碼，不等於實體車站數 |
| pagerank_scores | 420 | 6 時段 × ~70 站的 PR 值 |
| station_tags | 200 | 40 站 × 5 類偏好標籤 |
| transition_matrix | 285 | 主要站間轉移機率 |
| travel_costs | 200 | 站間旅行距離與成本 |

### 時段劃分

| 時段 | 時間 | 特徵 |
|------|------|------|
| morning_peak | 07:00-09:00 | 通勤模式 |
| morning | 09:00-12:00 | 觀光/辦事 |
| noon | 12:00-14:00 | 用餐/休閒 |
| afternoon | 14:00-17:00 | 購物/觀光 |
| evening_peak | 17:00-19:00 | 下班通勤 |
| night | 19:00-23:00 | 夜生活/聚餐 |

> **關於 23:00～06:00**：以上六時段刻意不涵蓋 23:00 及 00:00–06:00。一般日期的凌晨時段沒有穩定、可比較的旅運模式可供推薦，只有官方公告的特殊延長／通宵營運事件（例如跨年夜）才有分析這段時間的意義——這會是未來獨立於現有六時段模型之外的 event-specific 分析，見「未來擴充」的 Special Overnight Event Analysis。

## 生產環境與資料維運

### Temporal 資料模型（production）

| 資料表 | 角色 | 保留政策 |
|--------|------|----------|
| `daily_od_flow` | 逐日、逐站、逐時段 OD 流量——月／年／連假聚合的唯一輸入 | **Rolling 18-month window**：只保留最近 18 個月，較舊的列會被 `retention.py --purge` 清除 |
| `range_od_flow` / `range_pagerank` | 依 `range_id`（`month:YYYY-MM` / `year:YYYY` / `holiday:<event_key>:YYYY`）預先聚合好的 OD 總量與 PageRank 結果 | **永久保留**，不受 `daily_od_flow` retention 影響 |
| `date_ranges` | 每個 range 的日期範圍、覆蓋天數與 `is_complete` 完整性狀態 | 永久保留 |
| `holiday_events` | 人工維護的連假 metadata（event_key／年份／日期範圍／官方來源），跨年比較的名冊 | 永久保留 |

**已 materialize 的月／年／連假 range，即使對應的 `daily_od_flow` 逐日明細已被 retention 清除，仍然永久可查**——查詢時讀的是 `range_od_flow`／`range_pagerank`，不是逐日表。這也是為什麼 2025-01～2025-03-18 的每日明細已被清除，但 `month:2025-01` 推薦、`year:2025`、2025 年各連假查詢仍然全部正常運作。

### D1 與 R2 的分工

- **Cloudflare D1（`mrt-rank-db`）**：唯一的 production 查詢資料庫。線上服務（首頁推薦、`/analytics`、所有 API）只讀 D1，沒有 R2 binding。
- **Cloudflare R2（`metropulse-raw-od-archive`）**：原始 CSV 的長期封存（`import_od_data.py --archive-to-r2`），供未來重新匯入、稽核或災難復原追溯來源，**不參與任何線上查詢路徑**。

### 目前 production 資料涵蓋範圍

- 逐日粒度：**2025-03-19 ～ 2026-08-31**（18 個月滾動窗口內）；2025-01-01～2025-03-18 已依保留政策清除逐日明細，但月度／年度／連假聚合仍完整保留。
- `year:2025`：完整（12 個月皆已匯入）。`year:2026` 目前**不完整**（僅 1～8 月），不會、也不可被查詢為完整年度。
- 連假支援：

  | event_key | 2025 | 2026 |
  |---|---|---|
  | 春節 `lunar-new-year` | ✅ 完整 | ✅ 完整 |
  | 228 `peace-memorial-day` | ✅ 完整 | ✅ 完整 |
  | 兒童節／清明節 `qingming-childrens-day` | ✅ 完整 | ✅ 完整 |
  | 端午節 `dragon-boat` | ✅ 完整 | ✅ 完整 |
  | 中秋節 `mid-autumn` | ✅ 完整 | ⏳ 已登錄 metadata，等待 2026-09 資料匯入後才能 materialize |
  | 國慶日 `national-day` | ✅ 完整 | ⏳ 已登錄 metadata，等待 2026-10 資料匯入後才能 materialize |

### Monthly 更新 SOP（目前為 **人工執行**，非自動化）

沒有排程器（無 GitHub Actions workflow、無 wrangler cron trigger、無 Worker `scheduled()` handler）會自動觸發匯入；每月更新由人工依序執行：

```bash
# 1. 匯入新月份（含 R2 封存）
python3 scripts/import_od_data.py --year YYYY --month MM --apply-remote --db-name mrt-rank-db --archive-to-r2

# 2. 逐月 parity 驗證，6/6 皆須 PASS 才算成功
python3 scripts/verify_range_parity.py --year YYYY --month MM --remote --db-name mrt-rank-db

# 3. 若該月份補齊了某個連假／整年的資料，才 materialize（成功後也要 verify）
python3 scripts/materialize_holiday_range.py --event-key <event_key> --year YYYY --remote --db-name mrt-rank-db
python3 scripts/verify_holiday_parity.py --event-key <event_key> --year YYYY --remote --db-name mrt-rank-db
python3 scripts/materialize_year_range.py --year YYYY --remote --db-name mrt-rank-db
python3 scripts/verify_year_parity.py --year YYYY --remote --db-name mrt-rank-db

# 4. Regression 檢查
python3 scripts/verify_recommend_baseline.py --base-url <本地連 production D1 的 wrangler dev URL>
```

已有月份需要重新匯入（例如上游 CSV 修正、或把只有舊版 legacy 資料的月份升級成新版逐日粒度）時使用 `--maintenance-reimport`：犧牲單一檔案的原子性（DELETE 與 INSERT 分兩次呼叫）以避開大表 DELETE 在非同步匯入路徑上的用戶端輪詢逾時，完成後強制核對列數，不一致會以非零狀態碼中止，不會靜默視為成功。**新月份的一般匯入請勿使用此旗標**。

生產環境建議的自動化方向（尚未實作，見 `docs/deployment/deployment-preflight.md`）：scheduled availability check（偵測新月份 CSV 是否發布）→ human approval → 上述步驟 1～4，**purge 永遠不進無人審核的自動化排程**。

### Retention（`daily_od_flow` 18 個月滾動窗口）

```bash
# 只回報，不刪除——正式 purge 前一律先跑這個
python3 scripts/retention.py --dry-run --remote --db-name mrt-rank-db

# 確認 dry-run 結果無誤、且已取得 D1 Time Travel 復原座標後，才執行
python3 scripts/retention.py --purge --remote --db-name mrt-rank-db
```

流程固定是 **dry-run → 人工複核 → purge**，不建議把 `--purge` 放進無人審核的自動化排程。`--purge` 內部把整個窗口外的 DELETE 拆成多個 `[batch_start, batch_end)` 區間分批執行（預設每批 7 天，`--batch-days` 可調），避免單一大範圍 DELETE 在 remote D1 觸發 CPU time limit（code 7429）；每批獨立 commit，可安全中斷後重跑（已刪除的日期會自動略過）。有登錄但尚未完整 materialize 的連假／年度，其涵蓋的日期會被 retention guard 自動保護、拒絕 purge（除非明確傳入 `--acknowledge-unmaterialized-ranges`）。實際執行 purge 前務必先用 `wrangler d1 time-travel info mrt-rank-db` 取得復原 bookmark。

### 驗證腳本一覽

| 腳本 | 用途 |
|---|---|
| `backfill_status.py` | 回報各月份是否已有逐日粒度資料 |
| `verify_range_parity.py` | 驗證單一月份的 `range_od_flow`／`range_pagerank` 與 `daily_od_flow` 完全等價（OD 守恆、PageRank 全站比對） |
| `verify_year_parity.py` | 驗證年度聚合正確性，含獨立於 `range_od_flow` 之外的 `daily_od_flow` 交叉驗證 |
| `verify_holiday_parity.py` | 驗證連假聚合正確性 |
| `verify_recommend_baseline.py` | 固定基準（`BL11→night→food`）分數回歸檢查，偵測任何非預期的排序／分數變動 |
| `retention.py --dry-run` | Retention 影響範圍預覽，不刪除任何資料 |

### 正確性不變量（每次驗證腳本實際檢查的內容）

- **OD 流量守恆**：`range_od_flow` 各時段總量必須與獨立掃描 `daily_od_flow` 的加總結果逐位元組相等。
- **PageRank 全站覆蓋**：118/118 站不缺、`pr_value` 總和 ≈ 1.0（Power Method 正規化不變量）、`pr_rank` 是 1..118 的完整排列無重複。
- **年度聚合不可用月度平均取代**：PageRank 不是線性可加總的量，`year:YYYY` 的 OD 流量是重新加總 12 個月的 `range_od_flow`（按 period 分批查詢，避免 remote D1 觸發大範圍掃描的 CPU 限制），再重新跑一次 Power Method，**不是**對 12 個月已算好的 PageRank 值取平均。
- **已完整的 range 不可被降級**：`materialize_year_range.py`／`materialize_holiday_range.py` 重跑時，若目標 range 已經 `is_complete=1`，會拒絕執行並以非零狀態碼中止，避免任何後續操作意外覆蓋已驗證完整的結果。

## 技術架構

| 層面 | 技術 |
|------|------|
| 前端 | HTML + TailwindCSS (CDN) + 原生 JS + SVG；共用 [**`/public/static/styles.css`**](public/static/styles.css)（MetroPulse `--mp-*` 設計標記與淺色介面系統）及 Noto Sans TC + Outfit |
| 後端 | Hono Framework (TypeScript) |
| 資料庫 | Cloudflare D1 (SQLite) |
| 圖表 | Chart.js (折線圖、雷達圖、長條圖) |
| 地圖 | 自製 SVG 示意圖（MRTMap 模組） |
| 部署 | Cloudflare Pages |
| 開發工具 | Vite + Wrangler |

## 專案結構

```
webapp/
├── src/
│   ├── index.ts              # 主應用入口 + 前端頁面（首頁、站點詳情、旅運量分析）
│   ├── routes/
│   │   ├── recommend.ts      # 推薦 API
│   │   ├── stations.ts       # 站點 API
│   │   ├── station-detail.ts # 站點詳情 API
│   │   ├── analytics.ts      # 真實旅運量分析 API
│   │   └── pagerank.ts       # PageRank API
│   ├── lib/
│   │   ├── recommender.ts    # 推薦引擎核心
│   │   ├── normalizer.ts     # 數值正規化
│   │   └── types.ts          # TypeScript 型別
│   └── db/
│       └── queries.ts        # D1 查詢封裝
├── public/static/
│   ├── mrt-map.js            # SVG 路線圖互動模組
│   └── styles.css            # 共用設計標記與頁面／元件樣式
├── migrations/                # 0001~0007：schema、真實資料表、R01 站點、
│                               # daily/range temporal 表、完整性欄位、holiday_events
├── scripts/                   # ETL／materialize／驗證／retention（皆為獨立 Python CLI）
│   ├── import_od_data.py      # 月份匯入（含 --maintenance-reimport、--archive-to-r2）
│   ├── materialize_year_range.py / materialize_holiday_range.py
│   ├── verify_range_parity.py / verify_year_parity.py / verify_holiday_parity.py
│   ├── verify_recommend_baseline.py
│   ├── backfill_status.py
│   └── retention.py           # daily_od_flow 18 個月滾動窗口
├── seed.sql                   # 種子資料
├── wrangler.jsonc             # Cloudflare 設定
├── vite.config.ts             # Vite 建置
└── ecosystem.config.cjs       # PM2 設定
```

## 本地開發

```bash
# 安裝依賴
npm install

# 建立資料庫 & 種子資料
npm run db:migrate:local
npm run db:seed

# 建置 & 啟動
npm run build
npm run dev:sandbox   # http://localhost:3000

# 重置資料庫
npm run db:reset
```

### 匯入真實旅運量資料（Open Data ETL）

```bash
# 下載並處理指定月份的 OD 旅運量資料，生成 SQL 後手動匯入
python3 scripts/import_od_data.py --year 2026 --month 1

# 直接匯入本地 D1（一行完成）
python3 scripts/import_od_data.py --year 2026 --month 1 --apply-local

# 直接匯入遠端 D1（需先 wrangler login）
python3 scripts/import_od_data.py --year 2026 --month 1 --apply-remote
```

資料來源：[臺北捷運每日分時各站OD流量統計](https://data.taipei/dataset/detail?id=63f31c7e-7fc3-418b-bd82-b95158755b4d)（公開，每月更新）

> **R01 廣慈/奉天宮**：2026 年 8 月 30 日通車。站點、路線圖與合成推薦資料已內建；真實 OD / PageRank 需匯入 **2026 年 8 月以後** 的月份才會出現（目前預設的 2026 年 1 月資料不含此站）。

## 部署流程

**正式網址：** `https://metro-go.pages.dev`

### 本地預覽 / 正式部署 / URL 差異

| 用途 | 指令 | 會發生什麼事 | 你看到的網址 |
|------|------|-------------|-------------|
| 本地預覽（含本地 D1） | `npm run dev:sandbox` | 用 `wrangler pages dev dist --d1=... --local` 在你的電腦啟動 Pages 模擬環境，不會上傳到 Cloudflare | `http://localhost:3000` |
| 正式部署（Production） | `npm run deploy:prod` | 先 `build`，再用 `wrangler pages deploy dist --project-name metro-go --branch main` 上傳到 Cloudflare Pages 的 `main` 分支 | 固定正式網址：`https://metro-go.pages.dev` |
| 單次部署快照 | `npm run deploy:prod` 執行完成後 Wrangler 顯示的網址 | 那次部署的專屬快照，方便回頭核對某一版 | 例如：`https://<hash>.metro-go.pages.dev` |

### 為什麼本地預覽和固定網址的指令不一樣？

- `npm run dev:sandbox` 是 **本地模擬**：
  - 不會部署到 Cloudflare
  - 直接在你的電腦用 `dist` 啟動預覽
  - `--local` 代表 D1 也使用本地資料庫
  - 所以網址一定是 `localhost`

- `npm run deploy:prod` 是 **正式上傳**：
  - 會把目前 `dist` 上傳到 Cloudflare Pages
  - `--project-name metro-go --branch main` 表示更新同一個 Pages 專案的正式分支
  - 因此正式站固定是 `https://metro-go.pages.dev`

- Cloudflare 同時還會為每次部署產生一個 **deployment URL**：
  - 這個網址每次都不同，因為它代表「那一次部署的版本快照」
  - 但正式 alias `https://metro-go.pages.dev` 會始終指向最新的 Production 部署

依修改內容選擇對應指令：

| 修改內容 | 指令 |
|---------|------|
| 改程式 / UI / API 邏輯 | `npm run deploy:prod` |
| 新增資料表（改 migrations/） | `npm run db:migrate:remote` → `npm run deploy:prod` |
| 補充種子資料（改 seed.sql） | `npm run db:seed:remote` |
| 更新站點 fallback JSON | `npm run stations:fallback` → `npm run deploy:prod` |
| 本機驗證後再部署 | `npm run build` → `npm run dev:sandbox` → `npm run deploy:prod` |

> **注意事項**
> - `db:seed:remote` 使用 `INSERT OR IGNORE`，不會覆蓋已存在的資料。若要修改既有資料，需另外執行 `UPDATE` SQL。
> - Cloudflare Pages 部署有兩種網址：`metro-go.pages.dev`（永遠指向最新 Production）與 `<hash>.metro-go.pages.dev`（特定版本快照）。測試請使用前者。
> - 需先完成 `wrangler login` 才能執行 remote 相關指令。
> - **`metro-go` 是唯一的 production Pages project**（Direct Upload，未連接 Git repository，production branch 固定 `main`）。部署永遠是更新這一個既有 project——不建立第二個 Pages project、不建立第二個 production hostname。

## 使用指南

1. **首頁查詢**：輸入中文、英文站名或站碼，從建議清單選站 → 選擇時段與偏好 → 點「查看推薦」。時段預設「下午 14:00–17:00」、偏好預設「不限」。方向鍵移動建議，Enter 確認，Escape 收起；中文組字期間 Enter 不會送出。
2. **路線圖選站**：桌機（≥1024px）左側查詢、右側地圖，地圖標題列提供「放大／縮小／重設全圖」及滑鼠拖曳；桌機直接使用左側完整站名搜尋，手機／平板則保留「從路線圖選站」與 map mode 內的「改用站名搜尋」。手機點站只會預選，按「使用此站」才更新出發站。返回、Escape 或取消預選不改變原本起站，關閉後焦點回到入口／搜尋欄。點同座標轉乘節點時，需從路線與站碼清單明確選擇；鍵盤選站仍以完整 combobox 搜尋為主要替代路徑。
3. **查詢狀態**：手動修改站名會立即清除原本選站，必須重新從建議清單或地圖確認。查詢中顯示原位 loading；失敗可重試，空結果會清除舊圖表。修改條件後，舊結果保留原查詢摘要並標示「條件已變更，請重新查詢」。
4. **推薦結果**：完成後焦點移到結果標題；依序閱讀 Top 5 站名、路線代碼、推薦理由、交通資訊限制與 0.xx 排序分數。展開「查看評分依據」可看 raw / normalized / weight / contribution；「比較本次推薦分數」為選用圖表。資料來源與月份在摘要顯示，缺少數值顯示「未知」。推薦名次也標在地圖上。查詢快照與過期回應防護沿用 Batch A。
5. **站點詳情**：從推薦結果進入時會保留 `from`、`time_period` 與 `preference`，可「返回本次推薦」並重建結果與閱讀位置。直接開 `/station/:id` 不會假造推薦脈絡；「改以此站出發」只替換起站並保留原時段／偏好。圖表後均有同源資料表或文字資料。
6. **旅運量分析**：先選月份、時段與 Top N，再於排名、圖表比較、月份資料頁籤查看結果。排名與圖表使用相同 Top N；月份資料的站點／時段／CTA 共用 control baseline，站碼提示位於 controls 下方。輸入站碼可查單站月份資料，只有多月份時才顯示跨月趨勢。頁籤保留完整文字，active 由字重、文字色與底線共同表示；寬幅版另有裝飾 SVG，窄螢幕會隱藏圖示，方向鍵、Home／End 可切換。修改分析條件會取消舊請求並清除失效圖表與摘要；錯誤與空資料分開呈現，缺少 PR 的圖表點保留為缺值。

首頁流程與 state 見 [Batch A](docs/uiux/04-batch-a-implementation.md)；正式視覺系統、推薦清單與方法／資料語意見 [Batch B](docs/uiux/05-batch-b-implementation.md)；站點詳情與旅運量分析見 [Batch C](docs/uiux/06-batch-c-implementation.md)；進階地圖互動與限制見 [Batch D](docs/uiux/07-batch-d-map-implementation.md)；v1.1 版面對齊見 [Layout Polish](docs/uiux/09-layout-polish.md)，圖示系統與微暖視覺細節見 [Icon Polish](docs/uiux/10-icon-polish.md)，高密度路網標籤整理見 [Map Micro-layout](docs/uiux/11-map-micro-layout.md)。首頁「推薦方法」使用同頁錨點，保留當前條件與結果；API 說明位於方法區／頁尾。轉乘站的資料 identity 未合併，地圖只在 interaction layer 明確消除點擊歧義。

## Final Release Audit

完整結果見 [Final Release Audit](docs/uiux/08-final-release-audit.md)。本次僅修復 release-critical 顯示與互動問題：

- 手機地圖開啟後，Tab／Shift+Tab 保持在對話框內，背景暫停互動；關閉或切回桌機後恢復。
- 詳情與分析資料請求最多等待 20 秒，逾時保留條件並提供恢復路徑；詳情的推薦脈絡若逾時，仍能顯示站點內容與限制。
- 分析頁清除失效結果並防止舊回應／錯誤／完成回呼覆蓋新查詢；月份服務失敗不再等同「沒有資料」。
- 缺少 PR 或標籤可用性資訊顯示資料不足，不轉為觀測零值；詳情連結百分比明示為既有矩陣值 ×100，未證實為旅客比例。
- 月份資料控制與方法定義欄支援 200% 字級重排；站點 URL 寫入內嵌 script 時進行 HTML delimiter escaping。

驗證流程：`npm run build` → `npm run dev:sandbox` → 測試 `BL11 → night → food`，預期為 **BL12 0.79、BL10 0.38、R11 0.38、BL18 0.37、BL15 0.33**。本次未變更推薦權重、正規化、PageRank、gamma、站碼、D1 或 real/synthetic 選擇規則，亦未部署。實體讀屏器、iOS Safari／Android Chrome、中文輸入法與瀏覽器縮放人工檢查見報告。

## 學術背景

本專案源自學術研究：**將 PageRank 演算法應用於台北捷運人流分析**。

- **核心理論**：Markov Chain + PageRank + Power Method
- **創新點**：將網頁連結結構映射為捷運人流結構
- **延伸應用**：從分析模型延伸為可互動的推薦系統

---

*MetroPulse（MRT Rank 延伸）— 基於 PageRank 與可解釋評分的學術／專題展示作品*
