# 🚇 MRT Rank — 台北捷運智慧推薦系統

## 專案概覽

**MRT Rank** 是一個基於 **PageRank 演算法**的台北捷運站點推薦系統。

本專案將 Google PageRank 的「連結分析」概念遷移到捷運人流分析：
- 人流量即連結 — 越多人從各站流向某一站，該站越「重要」
- 轉移機率矩陣 — 建構站與站之間的人流流向
- 時段化分析 — 不同時段有不同的人流模式與站點熱門度

在此學術模型基礎上，疊加偏好匹配與旅行成本，構成一個**完全可解釋**的推薦系統。

## 核心功能

### 已完成（v1.0 MVP）

- **智慧推薦引擎**：輸入出發站、時段、偏好，推薦 Top 5 捷運站
- **可解釋分數**：每個推薦結果展示四維分數拆解（熱門度、連結性、偏好匹配、旅行成本）
- **推薦理由**：自動生成自然語言的推薦理由
- **互動查詢介面**：站點搜尋、時段/偏好選擇、即時推薦
- **視覺化圖表**：Chart.js 總分比較與堆疊分析圖
- **演算法說明頁**：公式推導與權重說明
- **RESTful API**：完整的後端 API，可獨立使用

### 未來擴充

- [ ] 捷運路線圖視覺化（SVG 互動地圖）
- [ ] 站點詳情頁（各時段 PR 趨勢、周邊景點）
- [ ] gamma 參數互動調整面板
- [ ] 使用者回饋與推薦改善
- [ ] 即時人流資料接入（台北捷運 Open Data）
- [ ] 多段行程規劃

## 推薦演算法

### 推薦分數公式

```
RecommendationScore(i → j, t, pref) = 
    w₁ × norm(PR_j(t))           // 時段熱門度 (0.30)
  + w₂ × norm(p_ij(t))           // 人流連結強度 (0.25)
  + w₃ × PreferenceMatch(j, pref) // 偏好匹配度 (0.30)
  - w₄ × norm(TravelCost(i, j))   // 旅行成本 (0.15)
```

### 轉移機率矩陣

```
p_ij = γ × (e_ij / s_i) + (1 - γ) × (1 / n)
其中 γ = 0.85 (Damping Factor)
```

### 四個評分維度

| 維度 | 權重 | 說明 |
|------|------|------|
| PR_j(t) | 0.30 | 站點在時段 t 的 PageRank 值（Power Method 計算） |
| p_ij(t) | 0.25 | 出發站 i 到目標站 j 的轉移機率 |
| PreferenceMatch | 0.30 | 站點偏好標籤與使用者選擇的匹配度 |
| TravelCost | 0.15 | 站數距離 + 轉乘次數的負向懲罰 |

## API 文件

### 核心推薦 API

```
GET /api/recommend?from={站點ID}&time_period={時段}&preference={偏好}&top_n={數量}
```

**參數：**

| 參數 | 必填 | 說明 | 範例 |
|------|------|------|------|
| from | ✅ | 出發站 ID | BL12, R30, BL11 |
| time_period | ✅ | 時段 | morning_peak, morning, noon, afternoon, evening_peak, night |
| preference | 選填 | 偏好 | attraction, food, shopping, nightlife, family, all |
| top_n | 選填 | 數量（預設 5） | 1~20 |

**範例：**
```bash
curl "/api/recommend?from=BL12&time_period=afternoon&preference=food&top_n=5"
```

### 其他 API

| 端點 | 說明 |
|------|------|
| `GET /api/stations` | 所有站點列表（支援 `?line=BL` 或 `?search=台北`） |
| `GET /api/stations/:id` | 站點詳情 + 標籤 |
| `GET /api/pagerank?time_period=afternoon&top_n=10` | PageRank 排名 |
| `GET /api/pagerank/:stationId` | 站點各時段 PR 值 |
| `GET /api/recommend/options` | 表單選項（站點、時段、偏好列表） |

## 資料架構

### 資料表

| 資料表 | 筆數 | 說明 |
|--------|------|------|
| stations | 100 | 台北捷運五大路線站點 |
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

## 技術架構

| 層面 | 技術 |
|------|------|
| 前端 | HTML + TailwindCSS (CDN) + 原生 JS |
| 後端 | Hono Framework (TypeScript) |
| 資料庫 | Cloudflare D1 (SQLite) |
| 圖表 | Chart.js |
| 部署 | Cloudflare Pages |
| 開發工具 | Vite + Wrangler |

## 專案結構

```
webapp/
├── src/
│   ├── index.ts              # 主應用入口 + 前端 HTML
│   ├── routes/
│   │   ├── recommend.ts      # 推薦 API
│   │   ├── stations.ts       # 站點 API
│   │   └── pagerank.ts       # PageRank API
│   ├── lib/
│   │   ├── recommender.ts    # 推薦引擎核心
│   │   ├── normalizer.ts     # 數值正規化
│   │   └── types.ts          # TypeScript 型別
│   └── db/
│       └── queries.ts        # D1 查詢封裝
├── migrations/
│   └── 0001_schema.sql       # 資料表結構
├── seed.sql                  # 種子資料
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

## 學術背景

本專案源自學術研究：**將 PageRank 演算法應用於台北捷運人流分析**。

- **核心理論**：Markov Chain + PageRank + Power Method
- **創新點**：將網頁連結結構映射為捷運人流結構
- **延伸應用**：從分析模型延伸為可互動的推薦系統

---

*MRT Rank — 基於 PageRank 演算法的學術專題延伸作品*
