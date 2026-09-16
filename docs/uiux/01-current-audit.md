# MetroPulse — Current UI/UX Audit

Method: dual-agent（A: `/root/design_review` · B: `/root/technical_audit`），主評估者交叉驗證與整合。

實測日期：2026-09-14；文件完成：2026-09-15。範圍：既有產品 UI/UX audit；本階段只新增本文件與 `02-design-direction.md`，不修改 production code、推薦公式、資料庫或部署。

## 1. 核心判斷

MetroPulse 已有真實的產品內容：站點、路線、偏好、可解釋的四維評分，以及能完成操作的推薦流程。最大的問題不是缺乏裝飾，而是**查詢晚於研究說明、手機晚於桌機思考、數字早於目的地理由、介面狀態不完全等於實際資料狀態**。

目前可用滑鼠／觸控完成推薦，不能稱為整個產品不可用。但現有介面需要使用者自行處理選站歧義、資料來源差異、分數語意與回程脈絡，這些正好削弱產品最重要的「可解釋」。

建議方向：**Taipei Transit Wayfinding × Urban Exploration**。首頁是完成任務的 Operate 介面；方法說明是選用的 Read 內容。優先序為 clarity > usability > information hierarchy > visual identity > decoration。

## 2. 範圍、方法與可信度

### 已閱讀的實作

- `README.md`、`package.json`、`AGENTS.md`。
- `src/index.ts` 全檔：共用 head/nav/footer、首頁、搜尋／表單、結果、Chart.js、站點詳情、analytics。
- `public/static/` 全部三個檔案：`styles.css`、`mrt-map.js`、`stations-fallback.json`。
- `src/routes/recommend.ts`、`src/routes/station-detail.ts`、`src/lib/recommender.ts`、`src/lib/normalizer.ts`、`src/lib/types.ts`、`src/db/queries.ts`，追查顯示資訊的資料來源與含義。
- UI UX Pro Max 的 design-system、product、style、typography、chart、ux、html-tailwind 搜尋結果；Impeccable 的 context、audit、critique、operate 指引。

保留 Hono + TypeScript + Vite + HTML + Tailwind CDN + Vanilla JS + SVG + Chart.js + Cloudflare Pages/D1。三頁目前集中在同一 Hono 檔案；此次不以 audit 為由拆檔或遷移框架。

### 實際瀏覽器操作

正式網站：<https://metro-go.pages.dev/>。使用隔離的 headless Chromium／Playwright，桌面 1440×1000、手機 390×844。手機為 viewport／touch emulation，並非實體 iPhone Safari。

| 檢查 | 實際結果 |
|---|---|
| 首頁桌面與手機 | 均成功載入；已看截圖與 DOM |
| 中文搜尋／選站 | 搜尋台北、選 BL12、改輸入西門、選 BL11 |
| 鍵盤選站 | 輸入台北後 ArrowDown + Enter 未選中；Tab 到 suggestion 後 Enter 有實作，不能說完全沒有鍵盤路徑 |
| 核心推薦 | 西門 BL11 → 夜間 → 美食 → 正常得到 5 站；第一名台北車站 0.79 |
| 推薦依據 | 展開原生 details；讀取 API 四維分數與畫面 |
| 站點詳情 | 點推薦站名進 BL12；查看 PR、雷達、標籤及雙向連結 |
| 以此站推薦 | 回到 `/?from=BL12`，時段變成下午、偏好變成不限 |
| 地圖選站 | 點 Y20 成功同步表單，並非所有環狀線站點不可用 |
| 分析頁 | 桌面／手機排名載入；操作長條圖、BL12 跨月趨勢 |
| 空結果 | 隔離瀏覽器攔截單次推薦回應改為空陣列；新空訊息與舊圖表同時存在。未修改正式 API |
| 減少動態效果 | emulate reduced motion 後 spinner 仍為 0.85s infinite；原始碼沒有替代規則 |
| 其他寬度 | 首頁補查 320、375、768、1024 CSS px，未量到整頁水平溢出 |

主流程測試未收到 `pageerror`。正式 `/static/styles.css`、`mrt-map.js`、`stations-fallback.json` 與工作區檔案逐位元比較一致；未宣稱全部後端部署版本等同本地。使用正式站已能覆蓋本次任務，因此未啟動本地 D1、執行 seed 或部署。

證據分級：**實測**＝瀏覽器重現／幾何與樣式讀值；**原始碼**＝可確認程式路徑，未必在正常服務中發生；**設計判斷**＝專家評估；**待驗證**＝需要後續裝置、讀屏器或研究檢查。沒有真實使用者訪談、完成率或 Lighthouse/Core Web Vitals 測量；評分不是這些指標的替代品。

### Impeccable detector 與限制

Assessment A 在未看 detector 的情況下獨立完成設計判斷；Assessment B 另行執行 detector、DOM 檢查。A 完成後才合併結果。

`impeccable detect --json src/index.ts`：exit 2，**1 個 warning**，規則 `side-tab`，`src/index.ts:762` 的路線色左邊框。

此項不能直接當成缺陷：顏色來自 `rec.station.line`，具有路線語意。真正的設計問題是同一張卡又有路線色名次圓章、漸層條與多色標籤，訊號重複。Detector 也沒有抓到選站狀態、手機順序、資料來源等主要 UX 問題。

Browser overlay 的 mutable preflight 成功，但三頁均無法載入 localhost 的 `detect.js`，沒有 detector console 結果，也沒有可靠的使用者可見 overlay。後續組合重試被自動審核拒絕，理由是可能保留 source injection、與唯讀範圍不符；改採 CLI + 隔離瀏覽器 DOM／截圖完成 audit。暫存 server 已直接終止，瀏覽器已關閉，未留下 production injection。

target slug：`src-index-ts`；沒有 ignore list。依使用者指定，報告持久化於 `docs/uiux/`，不另外建立 PRODUCT.md、DESIGN.md 或 critique history；不推算不存在的歷次分數趨勢。暫存證據位於 `/tmp/metropulse-*` 與 `/tmp/mp-a-*`，不是需部署的資產，也不是永久文件依賴。

## 3. UI UX Pro Max design intelligence 的採用與排除

可重現的主要搜尋：

```sh
python3 .codex/skills/ui-ux-pro-max/scripts/search.py 'public transit journey planner urban exploration data recommendation accessible wayfinding' --design-system -p MetroPulse -f markdown
python3 .codex/skills/ui-ux-pro-max/scripts/search.py 'transportation travel local discovery' --domain product -n 3
python3 .codex/skills/ui-ux-pro-max/scripts/search.py 'minimalism accessible ethical flat design' --domain style -n 3
python3 .codex/skills/ui-ux-pro-max/scripts/search.py 'chinese multilingual readable' --domain typography -n 2
python3 .codex/skills/ui-ux-pro-max/scripts/search.py 'ranking comparison radar' --domain chart -n 3
python3 .codex/skills/ui-ux-pro-max/scripts/search.py 'navigation search form accessible mobile' --domain ux -n 8
python3 .codex/skills/ui-ux-pro-max/scripts/search.py 'responsive form focus keyboard' --stack html-tailwind -n 5
```

| 面向 | Intelligence 回傳與產品判斷 |
|---|---|
| Product category | 搜尋沒有精確的 transit recommendation 分類，回傳 travel agency 等近似結果。定義為「交通情境下的城市探索／目的地決策工具」，研究分析為次要工作區 |
| Visual style | 採 Accessible & Ethical、Flat Design 的對比、標準控制、純色與分隔線；排除 Aurora、glassmorphism、誇張 minimalism |
| Color system | 初次回傳 blue + amber；不照搬。改以中性介面、單一 action ink、MRT categorical colors 分工 |
| Typography | 查到繁體中文 Noto 系列；保留 Noto Sans TC，不採初次回傳的 Fira Code dashboard heading，也不新增不必要的 serif |
| Information architecture | 初次回傳 AI Personalization Landing 不適用；排除 hero/testimonials/smart CTA，改成 query → recommendations → evidence |
| Interaction | 採 label、autocomplete、提交回饋、可恢復 empty state、鍵盤與清楚 focus；不把每個功能變成浮動面板 |
| Responsive | 採結構性重排與相同內容來源；mobile query-first，map secondary，不複製兩套表單狀態 |
| Accessibility | 採明確 label、非色彩選中狀態、44px 產品點擊目標、圖表資料表與 reduced motion；skill 的「AAA」字樣不是現況認證 |
| Anti-patterns | 採禁止 emoji icons、低對比、無目的動態、AI 紫粉漸層；路線色的正常使用不在禁止範圍 |

## 4. 實測尺寸與對比

| 指標 | Desktop 1440×1000 | Mobile 390×844 |
|---|---:|---:|
| 查詢面板起點（距頁頂） | 487.5px | 1202.5px |
| 站名輸入框起點 | 540.5px | 1251.5px |
| 地圖外框 | 782×517.8px | 324×422px |
| 台北車站圓點（轉乘站） | 約 10.1×10.1px | 約 4.2×4.2px |
| 普通站圓點（B 測量） | 約 6.3×6.3px | 約 2.6×2.6px |
| 首頁水平 overflow | 無 | 無 |

SVG 的 1240 單位寬縮到手機約 322px，10 單位站名文字相當於約 2.6px；外框仍保留 422px 高，造成「內容縮得很小，空白仍很大」。畫面沒有 overflow 不等於可讀／可點。

以下是依 sRGB 相對亮度公式計算的純色 pair；透明、漸層與 hover 狀態仍須在實作時個別量測。

| 前景／背景 | 比率 | 判斷 |
|---|---:|---|
| 白字／O `#F5A623` | 2.03:1 | 不適合站碼／名次文字 |
| 白字／BR `#C48C31` | 2.94:1 | 不適合一般文字，亦低於大字 3:1 |
| 白字／Y `#EDDC00` | 1.42:1 | 明顯不足 |
| `text-gray-400` `#9CA3AF`／白 | 2.54:1 | 搜尋站碼、空資料訊息不足 |
| `#94A3B8`／白 | 2.56:1 | 分析頁深色 token 落在白底時不足 |
| 既有 `--mp-text-soft` `#64748B`／白 | 4.76:1 | 一般字達 4.5:1；不能概括說所有灰字都失敗 |

WCAG 的一般文字最低 4.5:1、大字 3:1；圖形／控制識別另需檢查 3:1。參考 [WCAG quick reference](https://www.w3.org/WAI/WCAG22/quickref/) 與 [Non-text Contrast](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html)。

## 5. 核心流程逐步 audit

| 步驟 | 認知負擔／點擊 | 狀態與可用性 | 建議與驗收 |
|---|---|---|---|
| 選出發站 | 先讀 hero、四維說明、看大地圖；搜尋最多 15 項，同站 BL12/R10 各一項 | 手機第一屏沒有欄位；輸入未必等於 committed origin；label 未關聯；ArrowDown/Enter 不選站 | 手機首屏出現 origin；搜尋後明確選取，改文字即取消舊選中；不要求先看地圖 |
| 選時間 | 6 個大卡片，同時要理解晨峰／晚峰縮寫；不是 6 個選項本身有錯 | 預設下午可見，但選中只有 CSS；無 radio group／checked | 顯示完整時段＋時間範圍，用標準單選控制；讀屏器能宣告目前值 |
| 選偏好 | 6 個 emoji 容器，重複卡框提升噪音 | 有「不限」合理預設；缺少 programmatic selection | 保留六種選擇，以 44px 文字 chips／radio group；不另加 wizard |
| 開始推薦 | 桌面也要往下找 CTA；手機 sticky 只有選站後才出現 | alert 驗證／全屏 loading；結果只捲動未 focus，89px sticky nav 遮到摘要 | 表單內錯誤、區域 busy、可見狀態；結果完成後聚焦標題並避開導覽 |
| 理解 Top 5 | 名次、0.xx、彩條、標籤、理由、兩圖並列；五個結果必須保留 | 第一名條永遠 100% 長，和圖表 0–1 座標不是同一尺度 | 先站名、去的理由、已知交通負擔；同一數值尺度，只保留必要比較 |
| 理解為何推薦 | 理由已直接可見，是優點；四維可展開 | 加權值乘 100% 與 normalized 連結強度 100% 易被當真實旅客比例 | 用有正負號的加權分量；分清 PR、OD 比例、正規化、tag score；資料來源近結果 |
| 查看站點詳情 | 點站名有效，但 link affordance 偏弱；先看兩張圖才到在地理由 | 缺返回本次結果；「以此站推薦」只傳 from；最佳時段與當前 query 無關 | 明確詳情入口、保留本次條件／返回位置；先呈現站點特徵，研究圖表次之 |

### Cognitive load 與情緒旅程

Impeccable A 的 cognitive load 檢查指出六個弱點：主要焦點、chunking 粒度、hierarchy、決策順序、同時可見選項、progressive disclosure；已有基本群組與 query summary 支持記憶。六種偏好、六個時段、十五項候選與全路網同時爭取注意力，不應機械套用「只能四個選項」而刪掉 Top 5。

現況情緒：好奇（下一站去哪）→ 學習負擔（先懂模型）→ 操作不確定（小地圖／選中歧義）→ 推薦帶來價值 → 詳情又變研究報告。理想順序：找到方向 → 確認條件 → 發現站點 → 理解理由 → 能回到比較。

## 6. 優先問題清單

以下 P0/P1/P2 **依使用者指定代表工作階段**：P0＝UX／accessibility；P1＝visual system／hierarchy；P2＝polish／delight。不是把所有 P0 都宣稱為阻斷性 bug；表內另列影響。共 **18 組：P0 10、P1 6、P2 2**。子現象不重複累計。

### P0：UX / accessibility

| ID／影響 | 證據與位置 | 修正方向／驗收 |
|---|---|---|
| UX01 重大：手機查詢被埋住 | 實測 input y≈1252；`src/index.ts:179–228`，map order-1、query order-2 | compact intro → query；map 選用。390×844 首屏有 origin，無需開圖即可完成 |
| UX02 重大：輸入、選中、結果狀態不同步 | 實测輸入西門仍提交 BL12 的狀態；`src/index.ts:577–582,650–655,711–714`。空結果早退 `750–754` 留下舊圖，已以隔離回應重現 | 區分 draft/committed/submitted query；文字改動 invalidate；空／錯誤重試不混用舊 metadata/charts |
| UX03 重大：表單可見名稱／選中語意不完整 | 實測 input.labels=0；12 個 buttons 無 checked/pressed；`src/index.ts:231–295,557–605,630–633` | label-for、fieldset/legend + radio；combobox active option、Arrow/Escape/Enter、IME。依 [APG Combobox](https://www.w3.org/WAI/ARIA/apg/patterns/combobox/) 驗證 |
| UX04 重大：map 太小、滑鼠依賴與 route stroke 錯誤 | `mrt-map.js:451–456,599–611`；圈圈 2.6–4.2px mobile。prefix regex 清掉整個 ID，未選中的 R10 圈線實測變 BL 藍 | 搜尋為完整替代；獨立 map view 可縮放／平移並有非手勢控制；改正路線色映射；選中加形狀與文字 |
| UX05 重大：文字對比與小控制 | `src/index.ts:668–672,763–774,991–992` 白字跨所有 route colors；清除鈕 14×20px；gray-400 多處 | O/BR/Y 用深字，清除 origin 有名稱和 ≥44px hit area。44px 為產品門檻；[WCAG 2.5.8](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html) 是 24px 並含例外，不能將每個小 SVG 圈直接判違規 |
| UX06 重大：結果、錯誤與焦點回饋不足 | 無 main/h1；`src/index.ts:382,699–726,736–739,951–969`。結果區 top≈0 而 sticky nav 高89px；載入 overlay 無完整 dialog focus 管理 | main/heading、skip link；結果 status 與 focus；scroll offset；原位 retry、保留條件。以 [Status Messages](https://www.w3.org/WAI/WCAG22/Understanding/status-messages.html) 驗證動態訊息 |
| UX07 重大：來源與分數含義不透明 | API 實測 real、2026年1月，前端 `905–913` 不呈現；`recommend.ts:128–153` 只覆蓋有 real 記錄的欄位，其餘仍可能合成 | 顯示來源／月份且明說部分指標為標籤或估計；不把 real metadata 當全欄位真實認證。分數是查詢內排序，不是喜歡機率；更改資料邏輯另案 |
| UX08 重大：詳情與前次推薦脈絡中斷 | `src/index.ts:768,998–1003,1187–1213`；詳情只收 station id，outbound 選 afternoon，inbound 每站挑跨時段最大值 | 返回本次結果／條件與清楚的「改以此站出發」；連結資料標出各自時段，不混稱同一時段；先標示來源，再另案評估統一資料 |
| UX09 中高：圖表沒有充分文字替代／資料不足被當低分 | 詳情 canvas `1013,1020` 無名稱，PR 無等價表；`station-detail.ts:85–90` 缺 tag 變 0。首頁已有分數文字但 chart aria-label 不能取代完整內容 | 圖表前摘要與同源資料表；無資料與數值 0 分開。雷達保留五軸，不是唯一資訊入口；參考 [WAI Complex Images](https://www.w3.org/WAI/tutorials/images/complex/) |
| UX10 中：分析流程狀態與範圍不一致 | `src/index.ts:1332,1378–1398,1414–1437,1477,1509`；實測 Top20 下圖只畫15；趨勢僅1月但叫跨月；失敗 fetch 無完整 catch | station-name search、同一範圍或明示圖只列15；單月說「尚不足判讀趨勢」；tabs 鍵盤／關聯、retry 與載入狀態 |

### P1：visual system / hierarchy

| ID／影響 | 證據與位置 | 修正方向／驗收 |
|---|---|---|
| VI01 重大：page theme 不完整 | 實測 analytics body/html bg transparent，實際白底；`styles.css:41–60,83–100`，`index.ts:1247` 缺背景填色 | 統一淺色產品 surface，分析靠密度辨別；若先保留暗色，完整 scoped page/text/chart tokens 及對比 |
| VI02 中：路線色、評分色、品牌色混用 | `index.ts:408–410,744–747,780,945,1369`；Y 同時 #FFDB00 與 map #EDDC00；成本紅與R線紅重疊 | route colors 只作路線識別；action／state／data tokens 分開，修正 Y 一致性 |
| VI03 中：過多圓角容器與陰影 | `styles.css:30–38,119–147,191–219,317–346,541`；卡內map框、卡內四維小卡、卡內tag | 以間距、標題、分隔線分組；一項可獨立操作的內容才需要surface。普通列不加陰影 |
| VI04 中：裝飾漸層與玻璃效果 | `styles.css:83–100,126–147,206–215,272–277`；`index.ts:138,382,780` | 純色 CTA／背景／比例條；nav 與tooltip實色。Loading背景遮罩有功能，blur本身沒有必要 |
| VI05 中：字級與圖示削弱導視 | `index.ts:135,248–295,763–805,1147`；大量11–12px與emoji；首頁／詳情 h2 充當主標題 | Noto Sans TC 單一內容家族、16px正文／14px輔助；站名與理由先於分數；統一SVG icon |
| VI06 重大：資訊先後與產品文案 | `src/index.ts:182–208,775–805,998–1028,1253,1319`；「最佳時段」、設計實作自述、圖表早於在地內容 | model 教學後移；「熱門時段（依PageRank）」；站點特徵先於圖。不得把熱門等同適合出遊 |

### P2：polish / delight

| ID／影響 | 證據與位置 | 修正方向／驗收 |
|---|---|---|
| PL01 中：非必要 motion 與 reduced motion 缺口 | `styles.css:330,401–457,471–475,525`；強制 smooth scroll `index.ts:739`；卡片最多延遲0.4s後再播0.5s | 只保留狀態轉換150–200ms；reduce 時移除位移、stagger、平滑捲動，用文字保持回饋。不是單憑此宣告 WCAG AA 失敗 |
| PL02 待量測：外部資源與初載依賴 | `src/index.ts:88–120`；Tailwind runtime、Chart.js同步head、字型與FA外站資源 | 核心DOM先可操作、chart按需載入；後續獨立評估Vite生成CSS。此項是風險，不虛報效能分數／故障 |

注意：reduced-motion 支援與所有 accessibility 驗收應隨首輪相關改動完成；PL01 階段標籤不代表可以延後已影響操作的動態問題。

## 7. AI-generated UI patterns 專項判定

| Pattern | 現況判斷 | 證據／處理 |
|---|---|---|
| Blue/purple gradient branding | 部分存在，不是所有branding皆漸層 | Wordmark 只是純色藍；detail CTA與score bar有藍紫，main CTA為綠藍。移除後兩者 |
| Decorative gradient background | 存在 | page radial wash、soft card diagonal wash，無資料語意 |
| 無功能理由 glassmorphism | 局部存在 | sticky nav、map tooltip backdrop blur；層級分離可用實色與border，不必毛玻璃 |
| Excessive rounded cards | 存在 | 12/16/20px系統＋option cards＋detail cards，所有內容都像獨立物件 |
| Card-inside-card | 存在 | map容器、四維拆解、tag details、公式框多層包裝 |
| Unnecessary shadows | 存在 | 大多数普通surface、rank badge、CTA、hover全部加陰影 |
| Generic SaaS appearance | 設計判斷：部分成立 | 中置hero→解說card→圖表card；領域內容很強，但容器語法可換皮到一般dashboard |
| Emoji interface icons | 明確存在 | 品牌、時段、偏好、API reasons、detail方向標題 |
| Weak typography hierarchy | 存在 | 站名／理由／分數競爭，關鍵輔助文字過小；不是完全沒有標題差異 |
| Excessive gray text | 存在但分層判斷 | 大量輔助文案變成低權重灰；#64748B白底達AA，gray-400不達 |
| Decorative animation | 存在 | stagger、card橫移、option上浮；spinner有功能但須可減少動態 |
| Every element has a container | 傾向存在，不是字面上每一個 | 群組用border/shadow/radius過度解決，應改用grid與separator |
| Generic AI dashboard language | 部分存在 | magic-wand CTA、紫色evidence、深色分析獨立外觀、介面介紹自己的「深色儀表板模式」 |

**禁止誤判：**路網線段使用多色是交通資訊；雷達的單色半透明填色是數據範圍；loading遮罩的遮蔽有操作目的；`details` 的資訊收合是良好的漸進揭露。它們不等同裝飾性漸層或玻璃卡。

## 8. Design health 與 technical audit 評分

### Nielsen heuristics — 20/40

| 原則 | /4 | 主要原因 |
|---|---:|---|
| 系統狀態可見 | 2 | 有loading與摘要，結果焦點／更新狀態不足 |
| 符合現實語言 | 2 | 站名熟悉，但PageRank／最佳時段需解碼 |
| 控制與自由 | 2 | 有清除與返回首頁，缺返回本次結果 |
| 一致與標準 | 2 | 共用token存在；theme、色彩與搜尋模式分裂 |
| 預防錯誤 | 2 | 選項受限但存在stale origin |
| 辨識優於回憶 | 3 | 名稱／代碼搜尋與摘要有效；趨勢需記代碼 |
| 彈性與效率 | 2 | map/search雙入口但mobile高成本 |
| 美感與最小化 | 2 | 可見層級存在但說明與容器過多 |
| 錯誤辨識與復原 | 1 | alert、技術指令、缺retry |
| 說明與文件 | 2 | 方法豐富但缺決策當下的解釋 |

十項均適用。Impeccable band：Acceptable，需明顯改善；不是需要換框架或重寫全部功能。

### 技術健康 — 9/20（整合實測後）

| 維度 | /4 | 依據 |
|---|---:|---|
| Accessibility | 2 | 部分原生控制／focus已存在；label、選中、圖表、對比有缺口 |
| Performance | 2 | 源碼層面的外部blocking依賴；未做速度benchmark |
| Responsive | 2 | 無整頁overflow、有breakpoint與sticky；mobile priority與SVG尺寸失敗 |
| Theming | 1 | 有token但analytics實際缺底色，route／chart多處硬編碼 |
| Implementation integrity | 2 | 領域語意存在；狀態、來源、圖表尺度不一致 |

Impeccable band：Poor。B 的暫定11/20中 theming 給3；主評估者加入透明body／白底深色token實測後調為1，故整合為9。這是可追溯的專家分數，不是假稱自動掃描評出9分。

## 9. Personas、應保留的優點與資料風險

- **Jordan／初次使用者：**手機第一屏找不到起站；100%連結與「最佳時段」容易理解成保證。需要「去哪、理由、依據」的順序。
- **Sam／鍵盤或讀屏器使用者：**無label關聯、無選中語意、map不可focus、動態結果未通知，會失去位置。需要與視覺相同的完整任務路徑。
- **Casey／分心的手機旅客：**2–4px站點無法可靠點擊，從detail回來重選條件，還需看完長圖。需要直接搜尋、保留條件與簡短比較。

保留：原生details、中文／英文／代碼搜尋、站名與district、query summary、URL prefill、可解釋reasons與四維資料、SVG／表單同步、合理下午／不限預設、手機safe-area考量。這些是改善的基礎。

### 說明層不能掩蓋的資料限制

1. `getRealTransitionMap`（`src/db/queries.ts:372`）目前回傳 `flow_count / total`；研究公式描述含 gamma 的 p_ij。來源邏輯與公式語意需要獨立核對，不能僅改文案就聲稱二者完全相同，也不能在UI任務中偷偷改排序。
2. 詳情 PR／connections 查的是 `pagerank_scores`／`transition_matrix`；推薦可使用 real 月份覆蓋，兩頁不必然相同來源。只同步 query URL 無法修正資料差異。
3. 缺少偏好、旅行成本時已有引擎預設；未提供欄位層來源旗標，UI不得自行猜哪些分數來自真實紀錄。
4. 台北車站 BL12/R10 等同名代碼在搜尋重複；合併視覺搜尋項之前要定義canonical mapping。不能直接合併資料列，否則影響OD、旅行成本與排除起站規則。
5. API 的理由包含emoji且缺少結構化travel欄位；UI不能靠字串拆解假裝取得可靠交通時間。需要未來相容性欄位擴充或保留完整文字。

### README 一致性檢查

已檢查：README仍描述「5條100站」、表格101站與舊R30範例；目前fallback有136筆station records、6種line codes（筆數含不同路線代碼，不能當成136個實體車站）。`/api/pagerank`與recommend data_mode也需清楚區分；架構樹尚未完整記錄analytics等現況。

這是既有文件漂移，不是本次造成的功能變更。本次遵守只建立audit與direction的範圍，保留已有未提交的README修改；後續implementation必須同步README並核對實際站點口徑，不直接用136替換所有「站數」。

## 10. 後續工作與驗收入口

執行順序：P0 query/state/accessibility/data truth → P1 tokens/hierarchy/map/result/detail → P2 motion/loading polish。完整規格與檔案計畫見 `02-design-direction.md`。

可對應 Impeccable：`adapt` 處理mobile；`harden` 處理state/keyboard/error；`clarify` 處理來源與文案；`distill`/`typeset` 處理容器與層級；`optimize` 以實測為前提；最後 `polish`，再以相同情境重跑audit。

Questions skipped: 使用者已提供產品定位、優先序、範圍與指定交付，本階段以可審查的文件完成，不要求額外確認，也不進入實作。
