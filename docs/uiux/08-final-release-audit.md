⚠️ DEGRADED: single-context — 兩個獨立 Astra High 審查均因用量限制未能完成；本報告由主審完成，不宣稱已通過雙人獨立覆核。

# MetroPulse Final Release Audit

日期：2026-09-16（Asia/Taipei）
範圍：Batch A～D 整合後的本地 production build；沒有部署 production。

## Executive verdict

**READY FOR PRODUCTION**

本輪發現並修復 **1 項 P0、6 組 P1**，最終沒有已知、尚未修復的 P0／P1。此結論適用於本次檢查的程式與本地資料環境；部署前仍須完成人工裝置清單，不代表完整 WCAG 認證或已驗證遠端 production 環境。

整體維持 **Taipei Transit Wayfinding × Urban Exploration**：查詢是主要任務，地圖輔助空間選站；推薦先呈現目的地與理由，再提供評分證據；方法說明採漸進揭露；詳情延續本次查詢，分析頁沿用同一視覺系統。沒有新增功能、重做設計方向或擴大為架構改造。

### 審查依據與方法

- 完整閱讀 [初始稽核](01-current-audit.md)、[設計方向](02-design-direction.md)、[Batch A](04-batch-a-implementation.md)、[Batch B](05-batch-b-implementation.md)、[Batch C](06-batch-c-implementation.md)、[Batch D](07-batch-d-map-implementation.md)，再核對 production source、既有 git diff 與 README。
- 使用 Impeccable 的 `critique`、`audit`、`adapt`、`harden`、`typeset`、`layout`、`polish` 參考流程。主審先完成產品與畫面判斷，再讀 detector；沒有以 detector 分數取代判斷。
- 實際以 Playwright／Chromium 操作 `npm run build` 產物及 Wrangler 本地 preview，包含真實本地 API、隔離頁面中的故障注入、鍵盤與觸控模擬。
- 本地 D1 的分析月份只有 **2026 年 1 月**。成功情境使用本地匯入資料；故障、缺值、空資料與回應競態使用瀏覽器攔截，不冒充真實資料觀測。
- Questions skipped：使用者已提供明確範圍、設計依據與發布標準。

## P0 findings

### P0-01：站點 URL 可終止內嵌 script — 已修復

**修正前：** `/station/:id` 把路徑值以 `JSON.stringify` 寫入 HTML 的 `<script>`。含 HTML script 結束標記的編碼路徑仍可突破 script 邊界；本機無害 sentinel 確認曾執行。

**修正：** 序列化後將 `<` 轉成 JavaScript Unicode escape，避免 HTML parser 提前結束 script。保留合法站碼的解碼值，不調整 station identity 或 API。

**驗證：** 同一路徑 sentinel 修正後未執行；正常 BL12 詳情、返回推薦與改起站流程通過。

## P1 findings

| 編號 | 修正前的使用者影響 | 最小修正 | 複驗結果 |
| --- | --- | --- | --- |
| P1-01 | 手機地圖開啟後初始焦點在標題，第一次 Shift+Tab 可跳回背景入口 | focus trap 納入非 Tab 停靠點的初始焦點；背景設為 inert，關閉與桌機 resize 復原 | Shift+Tab 留在 dialog；confirm、cancel、Escape、轉乘選擇與焦點恢復通過 |
| P1-02 | 詳情與分析請求沒有等待上限；非必要推薦脈絡也能讓整頁一直 loading | 詳情／分析 fetch 設 20 秒 timeout；保留條件及重試；可選推薦脈絡失敗時仍顯示詳情與限制 | 實際等待 21 秒，主資料顯示錯誤恢復路徑；脈絡逾時仍顯示站點內容 |
| P1-03 | Analytics 更改條件、無效站名或新請求失敗後，可能殘留舊資料／摘要；舊 catch／finally 可干擾新請求 | 集中清除失效排名、圖表、表格和摘要；先移除舊請求身分再 abort；success／catch／finally 均檢查請求身分 | 晨峰→夜間、BL12→BL11、慢舊回應與晚到錯誤皆未覆蓋新結果；無效站名不留舊表 |
| P1-04 | 缺少 PR 的圖表與摘要顯示成 0；詳情缺少標籤可用性資訊時當成已知；連結百分比可能被理解為旅客比例 | 缺值顯示資料不足／未知、圖表保留 null；缺少 availability 不假設已知；補明矩陣值 ×100 的來源限制 | 缺 PR 不再顯示 0.0000%；缺 availability 的五類標籤顯示資料不足且不畫雷達；推薦計算未變 |
| P1-05 | 月份服務失敗被描述為尚未匯入資料，將未知狀態誤稱為確定無資料 | 分開「成功取得空月份」與「服務失敗、無法確認」；重試保留仍有效的月份選擇 | 空回應及 HTTP 錯誤顯示不同狀態，重試可恢復排名 |
| P1-06 | 768px、根字級 200% 時，分析控制列及方法定義造成整頁水平溢出 | 分析控制列依可用寬度換行；方法定義欄可縮及長文字換行 | 分析原 scrollWidth 1090、首頁原 849，修正後均為 768；詳情亦為 768 |

以上均為明確且低風險的顯示、互動或錯誤處理修正，沒有變動演算法、資料庫或研究語意。

## P2 / future improvements

以下可隨 v1 發布，本輪未實作：

1. **外部資源與載入策略：** Tailwind CDN 仍產生 production 使用警告；字型、Chart.js、KaTeX 等外部資源仍有網路依賴。未使用的 Font Awesome、favicon 404 可另案處理，不擴大為框架遷移。
2. **方法／詳情的閱讀負擔：** 資料限制文字有重複，部分包含資料表名稱及 provenance 等術語；寬畫面部分段落偏長。可後續精簡，但本輪優先保留資料限制的準確性。
3. **高密度資料畫面：** 全圖站名與圖表數字較密；完整站點搜尋及同源資料表已提供替代路徑。表格與公式保留局部水平捲動。
4. **Dead CSS：** 發現舊 `.mp-card`、`.detail-card`、`.theme-analytics` 等相容樣式，未見其造成目前頁面的視覺洩漏。本輪不為清理而改動。
5. **資料來源細緻度：** 逐站、逐欄 provenance 與既有補值的明確標記仍不足。介面已說明限制；改善需後續 API／資料工作，不在 Final Audit 改寫研究或 D1 語意。

### Anti-AI visual audit 與 detector 判讀

人工檢視首頁、結果、評分依據、方法、詳情及分析的桌機／手機畫面：沒有發現主導介面的藍紫／粉紅漸層、玻璃效果、glow、過大行銷 hero、裝飾動畫、emoji 操作圖示、深淺頁面身份衝突或通用 SaaS 卡片堆疊。MRT 色彩用於路線辨識，分數圖表沿用中性色；選單陰影、focus ring、dialog overlay 具有功能用途。

靜態 `impeccable detect --json src/index.ts` 回傳 `[]`。隔離瀏覽器中的 live detector 分別標記首頁 6、詳情 4、分析 4 個元素；逐項讀取元素後判讀如下，**沒有宣稱 runtime 零警告**：

| Surface | 警告 | 人工判讀 |
| --- | --- | --- |
| Homepage | 2 個 thin-border/wide-shadow | `.mp-query-suggestions` 與 `.mrt-station-choice`，掃描時為 hidden；皆為功能性浮層，保留 |
| Homepage | 4 個 line-length，估計約 88 字元／行 | 方法及資料限制段落；無裁切，屬 P2 閱讀優化 |
| Station Detail | 2 個 cramped-padding | `.mp-table-scroll` 的表格底邊與外框相接；表格儲存格有內距，不構成內容遮擋 |
| Station Detail | 2 個 line-length，估計約 88／137 字元／行 | 人流連結限制與資料來源說明；P2，不機械改寫 |
| Analytics | 4 個 text-overflow | `sr-only` 排名表頭內的「排名／路線／站點／PageRank」；為視覺隱藏的輔助文字，非使用者可見內容溢出，不移除讀屏語意 |

Live detector 僅注入隔離瀏覽器頁面，沒有注入 production source。中途補讀警告曾因用量限制遭自動審核拒絕；使用者要求繼續後重試成功，警告細項已完成核對。獨立代理審查未完成的限制仍如報告首行所示。

## Resolved during audit

相對於稽核開始時的檔案快照，本輪僅改動以下既有檔案，另新增本報告：

| 檔案 | 變更 |
| --- | --- |
| `src/index.ts` | script 邊界 escaping、dialog 焦點與 inert、詳情／分析 timeout、圖表清理、分析競態及狀態清理、缺值與資料限制文字 |
| `public/static/styles.css` | 分析月份控制列及方法定義的放大字級重排 |
| `README.md` | 同步本輪使用行為、驗證與限制；修正站碼範例與未經保證的資料筆數／解釋性敘述 |

工作區在本輪開始前已有 Batch A～D 及其他變更；沒有把那些變更算成本輪修復，也沒有 reset、覆蓋、提交或部署它們。

## Homepage verdict

**PASS。** 首次進入能辨識這是捷運目的地推薦、從選起站開始；站名、時段、偏好與推薦 CTA 的順序清楚。桌機查詢在左、地圖在右；手機先查詢，再選擇是否打開地圖。共用 header／footer、skip link 及頁面標題一致。

搜尋支援中文、英文與站碼。已選站後手動修改文字會清除站碼，避免送出「看到 A、實際查 B」；組字 Enter 防護與雙擊只發出一次推薦請求通過。站點 API 失敗可切換 fallback，兩者皆失敗時顯示恢復訊息。

## Recommendation verdict

**PASS。** 順序為目的地、路線與理由，再呈現排序分數與可展開證據。分數沒有描述成適合機率，也未暗示跨查詢可比。摘要保留本次起站、時段、偏好與資料模式／月份；條件改變後不把舊結果冒充成新查詢。

實際走完搜尋→夜間→美食→推薦→評分依據→分數比較→詳情→返回本次推薦→改以此站出發。返回時恢復 BL11／night／food 及結果標題焦點；改起站為 BL12 時保留時段／偏好，沒有自動執行新推薦。空資料與錯誤清除不適用圖表，重試保留查詢。

## Methodology verdict

**PASS。** 深入內容置於同頁方法區及 details，不阻礙查詢。PageRank 研究公式、Power Method、γ=0.85 與目前推薦服務的查表／組合流程有區分；沒有宣稱每次查詢即時重算研究模型。

raw、normalized、weight、contribution 的關係可查；候選範圍正規化、同值回傳 0.5、引擎既有缺值代入及分數不可跨次比較均有說明。公式在窄畫面採局部捲動，大字定義欄修正後不再造成整頁水平溢出。

## Station Detail verdict

**PASS（保留資料來源限制）。** 從推薦進入時延續起站、時段與偏好；直接進入不假造推薦脈絡。可返回本次推薦或改起站；可選脈絡服務失敗不再永遠阻擋主內容。

PageRank、偏好與人流連結提供同源表格／文字。標籤 availability 缺漏保守顯示資料不足；矩陣百分比不稱為真實旅客比例。詳情的 pagerank_scores／transition_matrix 不假裝與首頁 real metadata 具有相同月份及逐欄來源。

## Analytics verdict

**PASS。** 沿用暖灰底色、深色文字、同一標題／按鈕／表單與路線 badge，沒有形成另一套 dashboard。月份→時段→Top N 的範圍可讀；排名與圖表比較使用相同資料。

本地 2026 年 1 月的 Top 10／20／30，排名列與圖表標籤數量一致；BL12 單月資料不畫成跨月趨勢。切換條件會清除舊資料，無效或同名歧義站名不保留舊表；競態、缺值、HTTP 錯誤及月份服務恢復通過。只有一個真實可用月份，沒有宣稱驗證過兩個真實月份的切換或真實多月趨勢。

## Map verdict

**PASS。** overview、zoom in／out／reset、滑鼠拖曳、觸控平移與選站狀態維持正常。overview viewBox 為 `-10 0 1140 820`，放大及拖曳後 reset 回到相同值；起站 BL11 與五筆推薦標示保持。

手機普通站 BL13 先成為 draft，原 committed BL11 不變；取消保留 BL11，確認才更新為 BL13 並回到搜尋欄。台北車站轉乘 picker 明確列 BL12／R10，選 R10 後 Escape 可取消，原起站仍為 BL13。關閉焦點恢復、body scroll lock 及切回桌機移除 dialog／inert 均通過。

觸控 context 的實際 touch events 能改變 viewBox；地圖開啟時背景 body 固定。844×390 橫向操作可 zoom、關閉，無整頁水平溢出。完整 combobox 為密集站點的替代選站路徑。

## Responsive verification

在 Chromium 中逐一設定 viewport，等待字型／canvas 版面穩定後核對 `documentElement.scrollWidth`，並檢視桌機／手機畫面。

| 寬度 | Homepage／Results | Station Detail | Analytics | 地圖呈現 |
| --- | --- | --- | --- | --- |
| 320 | PASS，scrollWidth 320 | PASS，320 | PASS，320 | 全畫面 map mode、焦點留在框內 |
| 375 | PASS，375 | PASS，375 | PASS，375 | 全畫面 map mode |
| 390 | PASS，390 | PASS，390 | PASS，390 | 全畫面 map mode、觸控選站／平移 |
| 768 | PASS，768 | PASS，768 | PASS，768 | map mode，關閉後恢復背景 |
| 1024 | PASS，1024 | PASS，1024 | PASS，1024 | 桌機並排 |
| 1440 | PASS，1440 | PASS，1440 | PASS，1440 | 桌機並排 |

- 手機 viewport 高度主要為 844，較寬畫面為 900；另驗證 844×390 橫向地圖。
- 展開推薦比較圖後，各尺寸沒有整頁水平溢出；公式／資料表的局部捲動不算整頁失敗。
- 768px 將根字級設為 `200%` 後，首頁方法、詳情與分析 scrollWidth 均為 768。這是文字放大模擬，**不是原生瀏覽器 200%／400% zoom 的替代認證**。
- 長英文站名、方法識別字與錯誤文字可呈現；真實手機鍵盤遮擋及 OS 字級設定仍列入人工清單。

## Accessibility verification

| 項目 | 結果／證據 |
| --- | --- |
| Landmarks／heading／skip | 檢查共用 header、main、footer、skip link；各主要頁面單一可見 h1，方法及證據有下層標題 |
| Labels／controls | 起站 combobox、時段 select、偏好 radio、分析月份／Top N／站點有標籤；輸入改變會清除舊 identity |
| Keyboard／focus | 搜尋方向鍵／Enter／Escape、推薦後結果標題、返回結果、dialog 初始 Shift+Tab 及雙向循環、關閉焦點恢復通過 |
| Transfer picker | 轉乘節點需選明確站碼；關閉與取消不偷偷提交 draft；完整搜尋保留鍵盤替代路徑 |
| Tabs | Analytics ArrowRight、Home、End 的焦點與頁籤切換通過 |
| Status／errors | loading／empty／error 有文字狀態與 live region；站點錯誤以 aria-invalid 及 describedby 關聯；retry 保留條件 |
| Charts | 有 accessible name、同源資料表或文字；圖表未載入不應成為唯一資料路徑；缺值不轉為 0 |
| Color | 路線代碼與色彩並用；實際 badge 文字／背景對比 BL 5.18、R 4.88、G 5.00、O 7.26、BR 5.00、Y 10.39 |
| Focus／touch | 可見焦點樣式；主要控制與手機替代流程可操作。未要求 overview 每一站都達 44px |
| Reduced motion | 模擬偏好下 spinner animation 為 none，Chart animation 為 false |
| Reflow／large text | 六尺寸及 200% 根字級模擬通過；原生 zoom 與實體輔助技術待人工驗證 |

以上是已執行的結構、互動、畫面及部分量測結果，**不宣稱全面色彩掃描或完整 WCAG certification**。

## Data truth verification

| 主題 | 最終判讀 |
| --- | --- |
| PageRank | 表達特定資料範圍的站點重要性／熱門程度；不是即時人潮 |
| Transition | 研究公式與 production real 模式取得 OD 值的流程分開；normalized transition 不稱為實際旅客比例 |
| PreferenceMatch／TravelCost | 呈現標籤或估計及限制，不冒充全部真實觀測 |
| Recommendation Score | 排序分數，保留 raw／normalized／weight／contribution；不是個人適合機率 |
| Real／synthetic／month | 首頁摘要反映回應模式與月份；synthetic fixture 不殘留 real 月份；缺少 metadata 顯示未知 |
| Unknown／zero | 前端沒有對缺 PR 額外補 0；標籤可用性未知不當作已知。引擎既有補值保留，方法說明回傳 0 未必是觀測零流量 |
| Station tags | 無 availability 時保守顯示資料不足；不自行推斷標籤來源 |
| Flow connections | 詳情 outbound 優先下午／否則第一可用時段；inbound 每來源取跨時段最大值，兩者不同範圍已說明。百分比僅矩陣值 ×100，無來源證明不稱旅客比例 |
| 頁面之間 | Results／Methodology 的推薦資料與 Detail 的既有資料表有來源限制；Analytics 為可用月份的 PR，不將不同來源假裝成完全一致 |

## Regression verification

### 指定 baseline

`BL11 → night → food → Top 5`：

| 排名 | 站碼 | 修正前 | 修正後 |
| --- | --- | --- | --- |
| 1 | BL12 | 0.79 | 0.79 |
| 2 | BL10 | 0.38 | 0.38 |
| 3 | R11 | 0.38 | 0.38 |
| 4 | BL18 | 0.37 | 0.37 |
| 5 | BL15 | 0.33 | 0.33 |

除了 UI 讀值比對，最後再次呼叫本地 `/api/recommend?from=BL11&time_period=night&preference=food&top_n=5`，與稽核開始保存的 JSON 做完整物件比較：**完全相同**。

### 計算與資料邊界

對照稽核開始時 SHA-256 快照，19 個受保護檔案保持一致：`src/lib/` 的推薦器、normalizer、types、D1 response helper，`src/db/queries.ts`，各 API route（含 analytics）、地圖 JS、方法公式 JS、fallback JSON、package／lock、seed 與三份 migrations。

因此本輪未變更 recommendation ranking、weights、normalization、PageRank、gamma、station identity、D1 semantics 或 real／synthetic selection；沒有執行資料匯入、seed 或 migration。

### Robustness 與完整流程

| 情境 | 最終結果 |
| --- | --- |
| 搜尋→推薦→證據→詳情→返回→改起站 | 通過；返回條件及焦點恢復，新起站不自動推薦 |
| Station API failure／fallback／雙重失敗 | fallback 有明確提示；重試恢復；雙重失敗提供恢復訊息 |
| 推薦成功→empty | 舊推薦數 0、比較圖清除、空狀態摘要正確 |
| 推薦網路失敗→retry | 錯誤可見，重試恢復 5 筆 |
| Timeout | 首頁、詳情主資料、詳情可選脈絡、分析排名以實際 21 秒等待驗證恢復狀態 |
| 推薦 rapid change／stale response | 故意讓舊晨峰回應晚於新夜間回應，仍維持夜間摘要 |
| Analytics stale success／error／finally | 舊晨峰失敗不覆蓋夜間 20 筆；BL12 慢回應不覆蓋 BL11 |
| Analytics empty／error／retry | 舊表／圖移除；錯誤範圍正確；retry 恢復；空月份與失敗分開 |
| Unknown metadata／PR／availability | 未知／資料不足，不冒充 0 或 real source；雷達不畫未知標籤 |
| Detail error／retry | HTTP 500 可重試；成功後只有預期的兩個 chart instance |
| 連按與輸入 | 推薦 double click 只有 1 個請求；編輯已選站無請求；組字 Enter 無請求 |
| Resize／touch | 六寬度、手機橫向、dialog→desktop、實際合成 touch pan／tap 通過 |
| Uncaught pageerror | 核心、故障及逾時測試捕捉結果均為空陣列 |

組字事件使用瀏覽器合成事件；沒有宣稱完成實體中文 IME 或作業系統虛擬鍵盤測試。

## Build verification

**PASS：`npm run build`。** 最後 CSS 修正後的 Vite build 成功，37 modules，輸出 worker 約 **144.24 kB**（稽核開始約 139.85 kB，均為 build 顯示值，非壓縮傳輸量）。沒有新增 dependency，package.json／lock 與稽核開始時相同。

修正後已重走核心流程及受影響異常分支；最後方法重排修正另驗證 320／768／1440 與 200% 根字級。最終 `git diff --check` 通過。

### Performance sanity

- 沒有虛構 Lighthouse 或 Core Web Vitals 分數；未進行負載或 production 網路效能認證。
- 檢查 map pointermove 採 requestAnimationFrame 更新 viewBox，未因平移重建整張地圖；實際拖曳後站點／推薦狀態維持。
- 詳情與分析在重載／條件改變時 destroy 舊 chart；詳情重試後驗證只有預期的兩個實例。
- 推薦雙擊只有一個請求；過期請求不覆蓋新畫面。無限 loading 問題已修正。
- 測試中沒有 uncaught pageerror；保留已知 Tailwind CDN warning 與 favicon 404 等 P2。外部資源延遲／離線對初始載入的全面影響尚未量測。

### 證據位置與可重跑方式

本輪執行記錄在本機 `/tmp/mp-core.js.log`、`/tmp/mp-states.js.log`、`/tmp/mp-map.js.log`、`/tmp/mp-final-extra.js.log`、`/tmp/mp-final-races.js.log`、`/tmp/mp-final-responsive.js.log`、`/tmp/mp-final-check.js.log`、`/tmp/mp-final-inputs.js.log`、`/tmp/mp-overlay-nodes.js.log`。開始快照在 `/tmp/mp-final-before/`，前後 API JSON 為 `/tmp/mp-final-baseline.json` 與 `/tmp/mp-final-baseline-after.json`。這些是本機暫存證據，不保證會永久保留。

可重跑：`npm run build` → `npm run dev:sandbox` → 在本地 preview 依本報告的核心流程、指定 baseline、尺寸及錯誤矩陣驗證。使用已準備的本地 D1；不需為本輪 UI 修正執行 migration／seed。

## Manual device checklist

**Production deploy 前，請人工完成以下清單並記錄裝置／瀏覽器版本與結果：**

- [ ] **iOS Safari + VoiceOver：** 依序讀取查詢標籤與建議、操作推薦／詳情返回、打開地圖與轉乘 picker；確認背景不被讀取、取消／確認後焦點正確，安全區與瀏覽器工具列不遮擋按鈕。
- [ ] **Windows + NVDA（實際部署支援的瀏覽器）：** 檢查 combobox、radio／select、status／錯誤播報、Analytics tabs、排名表頭及 chart alternatives 的閱讀順序。
- [ ] **Android Chrome：** 直向與橫向的觸控 pan／zoom／confirm／cancel；虛擬鍵盤開啟時搜尋建議和 CTA 仍可抵達，背景不與地圖搶捲動。
- [ ] **實體中文輸入法：** 注音／拼音組字期間 Enter 不提交；完成組字後能選明確站碼；輸入轉乘同名站不誤用先前 identity。
- [ ] **原生瀏覽器 200%／400% zoom、OS 大字：** 查詢、方法、詳情、分析及 dialog 無遺失操作；允許公式／表格局部捲動，確認沒有整頁意外橫向捲動。
- [ ] **目標 production 資料與外部資源：** 確認既有部署設定、可用月份、real／synthetic 標示符合預期；字型／Chart／KaTeX 可載入；人工核對推薦→詳情→返回與重試。不以本地 D1 的月份推定遠端月份。

此清單不授權代理自動部署。本輪沒有呼叫 production deploy。

## Intentional limitations accepted for v1

- 不新增 pinch／wheel zoom、100+ 站點 roving focus，亦不要求 overview 每站 44px；完整搜尋及明確轉乘站碼選擇是替代路徑。
- 這是可解釋的探索推薦／研究展示，不是即時人潮、個人適合機率或即時路線規劃。
- 保留研究公式與 production 取值差異、候選正規化、既有估計／補值及 provenance 限制；沒有為了文案整齊改動分數或資料語意。
- 詳情與推薦可能取自不同資料表／範圍；outbound 與 inbound 的時段取法不同，已明示，未擅自統一。
- 單月份顯示資料表，不冒稱跨月趨勢；本輪不新增月份或補造資料。
- 外部資源、少量長段落、密集全圖、dead CSS 等 P2 留待後續小範圍工作。

## Final release decision

**READY FOR PRODUCTION。** 本輪確認的 P0／P1 已修復，指定 baseline 與完整 API 回應不變，本地 build 與修正後核心流程通過。請先完成人工裝置清單，再依既有部署流程安排 production release。
