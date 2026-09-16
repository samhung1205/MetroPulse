# MetroPulse UI/UX — Implementation Batch A

完成日期：2026-09-15。範圍：**Homepage Query Flow + Query State + Accessibility Foundation**。

依據 [Current Audit](01-current-audit.md) 與 [Design Direction](02-design-direction.md)，沿用 **Taipei Transit Wayfinding × Urban Exploration**：先讓使用者可靠地選站、設定條件與理解查詢狀態。本批不是完整視覺改版，也不是地圖或資料模型重寫。

本批沿用 UI UX Pro Max 的表單、觸控、鍵盤與 responsive 指引，以及 Impeccable 的 adapt / harden 檢查方式；以使用者限定的 Batch A 範圍為準。保留 Hono、TypeScript、Vanilla JS、Tailwind CDN、SVG、Chart.js 與 Cloudflare Pages/D1。

## 1. Files changed

| 檔案 | 本批變更 |
|---|---|
| `src/index.ts` | 僅首頁 render 函式：重排內容、語意表單、combobox、query state、可取消請求、結果與錯誤狀態、手機 map 開關、焦點回饋 |
| `public/static/styles.css` | 在既有樣式之後新增 `.mp-home` 限定的 query layout、表單、觸控、focus、validation 與 reduced-motion 規則 |
| `README.md` | 更新首頁使用流程、預設值、keyboard、responsive、查詢狀態與本文件連結 |
| `docs/uiux/04-batch-a-implementation.md` | 本批架構、驗證、限制與 audit 對照 |

工作區在 Batch A 開始前已有未提交修改。本批以開始時的檔案快照比對，沒有將原有差異算成本批成果，也沒有回復它們。

**功能邊界：**未改 API routes、`src/db/`、`src/lib/`、D1 migrations、seed、站點 fallback 資料、`mrt-map.js`、package 或 lockfile。`renderHomePage` 之外的 shared helpers、站點詳情與 analytics 程式保持原樣；CSS 原有內容保持原樣。沒有改推薦權重、PageRank、normalization、sorting、gamma、站點 identity、real / synthetic 或資料來源選擇邏輯。沒有部署 production。

## 2. Homepage hierarchy / responsive behavior

DOM 順序為：

1. 簡短產品介紹。
2. 出發站 → 時段 → 偏好 →「查看推薦」。
3. 路線圖選站入口／地圖。
4. 本次推薦結果與「修改查詢條件」。
5. 分數說明與研究方法。

桌機 **≥1024px** 使用左查詢、右地圖。DOM 與鍵盤順序仍為查詢在前，沒有透過 CSS order 造成視覺與閱讀順序相反。

手機／平板 **<1024px** 為單欄，地圖預設收合。「從路線圖選站」展開同一份地圖；點選可用站點會直接確認出發站、同步 input / hidden ID / map selected state，然後收起並返回出發站。使用「收起地圖，返回查詢」則保留原查詢，焦點回到入口。沒有建立第二份表單或第二份查詢 state。

沒有沿用舊的 mobile sticky submit，也沒有一般推薦用的全螢幕 loading。單一 CTA 隨表單正常捲動；不為了硬塞首屏而縮字或縮 target。

### 實測初始版面

Chromium、一般字級；數值取近似 CSS pixel，字型與瀏覽器不同時可自然變動。

| Viewport | 出發站 input 距頁首 | CTA 底部距頁首 | 地圖 | 全頁水平溢出 |
|---|---:|---:|---|---|
| 1440×900 | 307px | 710px | 右側展開 | 無 |
| 1024×900 | 307px | 710px | 右側展開 | 無 |
| 768×844 | 301px | 703px | 收合 | 無 |
| 390×844 | 311px | 713px | 收合 | 無 |
| 375×844 | 338px | 741px | 收合 | 無 |
| 320×844 | 334px | 793px | 收合 | 無 |

出發站 input / select 字級固定至少 16px；主要控制與偏好 chips 高度 48px，清除按鈕可操作範圍 ≥44×44px。320px 改為兩欄偏好 chips，其他尺寸使用三欄；選站回饋、錯誤、大字或窄螢幕允許正常增加高度。

## 3. Query architecture / state model

使用首頁內的小型 Vanilla JS `queryState`，沒有新增 framework 或 state library。

| State | 責任 | 規則 |
|---|---|---|
| `draftInput` | 搜尋欄目前文字 | 文字本身不是 station ID；每次手動 input 都會 invalidate 原選站 |
| `committedOrigin` | 使用者已確認的 station record | 僅 suggestion / map 明確選取；既有合法 URL 深連結保留預選相容性 |
| `draftQuery` | 目前時段與偏好 | 由同一份 native select / radio 同步；預設 `afternoon` / `all` |
| `submittedQuery` | 最近一次送出的不可變條件快照 | 複製 ID、站名、time/preference value 與 label、top_n；不引用可變 controls |
| `currentRequest` | 目前有權更新 UI 的請求 | 持有 snapshot、AbortController、遞增 ID、timeout；以 request object identity 判斷有效回應 |
| `phase` | 查詢生命週期 | `idle`、`loading`、`success`、`empty`、`error` |

### 輸入與選站

- 已選 BL12 後手動輸入「西門」，立即清除 `committedOrigin`、hidden station ID、選站 badge 與 map selection。
- 把文字改回「台北車站」也不會自動恢復 BL12；需要再次明確選取。
- 中文、英文、站碼均可搜尋；建議顯示站名、ID、英文，沒有合併或轉換資料 identity。
- 「清除」同時重設文字、已選站與地圖，焦點留在搜尋欄。
- `/?from=BL12&time_period=night&preference=food` 保留預選功能，不自動 submit。時間／偏好先初始化；若站點資料較慢回來，不會覆蓋使用者已開始輸入的新站名。

### 請求與結果歸屬

1. Submit 檢查有效的 `committedOrigin`，再建立 frozen snapshot。
2. 送出與舊版相同的 API 參數：`from`、`time_period`、`preference`、`top_n=5`。
3. 相同查詢進行中會禁止 duplicate submission。
4. 編輯任何實際查詢條件，立即取消舊 request、移除其 UI 更新資格，恢復可送出狀態。
5. 新查詢可立即送出；回應／error／finally 都檢查 identity，舊 A 不可覆蓋新 B 或改掉 B 的 loading。
6. 即使 transport 沒有理會 AbortSignal，identity 檢查仍擋住遲來 A。
7. 結果 summary 使用該次 snapshot，不讀目前表單，也不讓 response.query 覆蓋使用者送出的條件。
8. 查詢逾時 20 秒會中止並顯示可重試錯誤；條件保留。

## 4. Loading / validation / result states

| 情境 | 使用者看到的行為 | 清理與狀態 |
|---|---|---|
| 未確認出發站 | origin 附近提示需選取建議／地圖站點，focus 返回 input | 不送 API、不使用 alert；`aria-invalid=true` |
| Loading | CTA「正在查詢…」、inline status | CTA busy / disabled；表單仍能修改條件以取消並改查 |
| Success | 顯示結果、送出條件摘要、5 筆卡片及既有圖表 | focus / scroll 到可見結果標題；同步 map 推薦高亮 |
| Empty |「目前沒有推薦結果」、建議修改時段／偏好／出發站 | 舊 cards、chart instances、metadata、map 高亮均清除；保留新查詢摘要與查詢 controls |
| Error / timeout | inline error 與「重試推薦」 | 保留 query；無舊 cards / charts / metadata 偽裝成功結果；CTA 恢復可用 |
| 結果完成後修改條件 | query 與舊結果旁標示「條件已變更，請重新查詢」 | 舊 summary 不變；新 submit 才清理舊結果並重新查詢 |
| Station list 載入失敗 | 維持既有內建清單 fallback；不可用時提供「重新載入站點」 | 每個清單請求有 10 秒 timeout；不向一般使用者展示 DB migration 指令 |

新的 submit 會先 destroy 舊 Chart instances，清空 card / summary / metadata、隱藏 chart/result section 並清理 map 推薦高亮；empty 與 error 不會殘留前一輪圖表。若 Chart.js 未載入，推薦卡片仍可呈現，圖表保持隱藏。

## 5. Accessibility foundation

- 新增 `main` landmark、首頁 h1、命名的 query form 與 skip link。
- 出發站使用真正的 `label[for]`，helper / error 透過 `aria-describedby` 關聯。
- Combobox 使用 `role=combobox`、`aria-controls`、`aria-expanded`、`aria-autocomplete=list`、`aria-activedescendant`；候選使用 `role=option` / `aria-selected`。
- ArrowDown / ArrowUp 移動 active option，Enter 確認，Escape 收起；候選不加入 Tab 順序，DOM focus 保留在 input。
- 檢查 composition state、`isComposing` 與 keyCode 229，避免中文組字 Enter 誤選／誤送；compositionend 當下也有 guard。
- 時段統一使用 native select，六個選項皆含完整名稱與範圍，沒有桌機／手機兩份 state。
- 偏好使用 `fieldset` / `legend` / native radio，純文字 chips，透過 radio dot、粗框與字重呈現選中，不只靠顏色。
- 查詢 controls 具有可見 focus outline；clear 名稱為「清除出發站」，有 ≥44px target。
- Loading 的 `aria-busy` 放在 CTA；live status 不放在 busy 的祖先內，避免載入訊息被整個 form 的 busy 狀態壓住。
- 錯誤使用 inline alert；一般狀態使用 polite status。沒有 window.alert 或全螢幕遮罩。
- 結果有可見 h2、`tabindex=-1`；僅最新有效查詢完成才移動 focus。
- `ResizeObserver` 取得 sticky nav 實際高度，加 20px 設定 scroll margin；桌機標題 top 約 92px、nav bottom 約 73px，手機標題約 108–109px、nav bottom 89px。
- `prefers-reduced-motion: reduce` 下使用直接 scroll，首頁結果既有 fade-in / hover transition 及兩張 Chart 動畫停用；資料與操作不受影響。

這是查詢與結果轉換的無障礙基礎，**不是整站 WCAG 合規認證**。本次驗證包含 DOM 語意、keyboard、Chromium touch simulation 與 reduced motion；尚未進行真人 VoiceOver/NVDA、實體手機鍵盤、iOS Safari 或實體中文 IME 驗證。IME 已驗證模擬 composition event 序列，仍需跨瀏覽器人工複驗。

## 6. Browser verification / regressions checked

環境：本地 `npm run dev:sandbox` → `http://localhost:3000/`，使用既有 local D1 資料；Playwright 驅動 headless Chromium。沒有 seed、migration、remote DB write 或 production deploy。

一般成功路徑使用真正的本地 API / D1；race、empty、network error、timeout 僅在測試頁面隔離模擬，沒有修改應用 API 或 fixture 資料來源邏輯。

| 驗證 | 結果 |
|---|---|
| 搜尋「台北」→ 方向鍵選 BL12 → Enter | 通過；active descendant / selected 同步，options 無 Tab stops |
| 已選 BL12 → 輸入西門 → 直接 submit | 通過；BL12 立即失效、API 0 次送出、inline error、focus origin |
| 英文 `Taipei Main`、站碼、ArrowUp / Escape | 通過 |
| BL11 → 夜間 → 美食 → submit | 通過；本地 API 200，5 筆，第一筆 BL12、分數 0.79；卡片、charts 與分數展開可用 |
| 編輯已完成查詢 | 通過；stale 提示可見，舊 summary 不變 |
| A / B 快速連續 submit、A 最晚回來 | 通過；A 被 abort；故意忽略 abort 仍無法覆蓋 B，server query label 也不會改寫 snapshot |
| 同查詢 loading 中連續呼叫 submit | 通過；只建立一個 request |
| Success → 模擬 empty | 通過；cards=0、chart instances=null、charts 隱藏、metadata 空白，query 保留 |
| 模擬 network error → retry | 通過；inline error、條件保留，恢復連線後正常取得推薦 |
| 純 keyboard：skip → origin → time → preference → CTA | 通過；最後 focus 結果標題，radio group 不產生六個 Tab stops |
| 模擬 IME composing Enter | 通過；不 commit、不 submit，composition 完成後明確 Enter 才確認 |
| Clear 與既有 URL 預選 | 通過 |
| 1440 / 1024 / 768 / 390 / 375 / 320px 初始版面 | 通過；query first、無水平溢出、controls ≥44px、input 16px |
| 手機 touch suggestion、map 開啟 → 選 BL13 → 同步 → 收起／返回 | 通過；測試採真正 touch events，未使用 force click |
| Reduced motion | 通過；Chart animation=false、card animation=none，結果 focus 正常 |
| Station detail / analytics | 既有頁面可載入，沒有新增 pageerror；不是完整其他頁面重驗 |
| Station API 失敗 → fallback → retry | 通過；恢復 API 後結束 fallback 狀態 |
| Station API + fallback 都失敗 | 通過；inline retry 後恢復清單，未選站不能送出 |
| Station 資料延遲 + URL 預選 + 使用者已編輯 | 通過；不覆蓋新的輸入、時段與偏好 |
| 390 / 375 / 320px 有結果版面 | 通過；沒有全頁水平溢出，sticky nav 不遮結果標題 |
| 模擬 query timeout | 通過；busy 結束，條件保留且提供重試 |

主流程 16 組檢查與補充 5 組檢查通過。無未捕捉 JavaScript pageerror；故意 abort network 的測試有預期的瀏覽器 `ERR_FAILED` 訊息，未算成正常路徑錯誤。

### 測試發現、刻意保留的地圖問題

手機若指定點選 `circle[data-id=BL11]`，會被相同座標上層的 `G12` circle 攔截。這是原有 SVG 轉乘站重疊／identity 問題。Batch A 不更動座標、站碼或 canonical mapping，因此沒有用 force click 偽裝通過；mobile map 整合改以可直接點選的 BL13 驗證。搜尋 BL11 與 BL12 均正常，仍是完整選站替代途徑。

## 7. Build / change boundary validation

- 每次主要首頁實作與狀態修正後執行 `npm run build`；共 3 次通過。
- Vite 6.4.2，37 modules transformed，Cloudflare worker bundle 成功產生。
- 瀏覽器實際載入 build 產物；除了 TypeScript bundle，也驗證了 HTML 內嵌 JavaScript 的執行。
- 與 Batch A 開始時快照比較：production source 只變更 `src/index.ts` 的首頁函式與 CSS 新增區段；shared header/footer、站點詳情、analytics、後端、map、data、package 均保持原樣。
- README 已同步新 query flow。本批不把原 audit / design direction 文件改寫成「全部已實作」。

## 8. Audit issue completion / deferred work

| Audit ID | Batch A 狀態 | 邊界 |
|---|---|---|
| **UX01** | **完成** | 手機 query-first；桌機左 query 右 map；研究資訊後移 |
| **UX02** | **完成** | draft / committed / submitted 分離；race、duplicate、empty、error、stale summary 處理 |
| **UX03** | **完成本批實作及瀏覽器驗證** | label、combobox、time select、native preference radio、IME guard；輔助科技／實體 IME 複驗限制如上 |
| **UX05 partial** | **完成 query controls 部分** | 文字、border、checked、focus、clear target；結果 rank badge、橙／黃／棕路線色對比與其他頁面仍未處理 |
| **UX06 partial** | **完成 query / result focus 部分** | main、h1、skip、inline loading/error、結果 heading focus 與 nav offset；全站導覽／詳情／analytics focus 未全面整理 |
| UX04 | 未完成，留 Batch B | map touch targets、可縮放／平移、非手勢操作、prefix 路線色錯誤、轉乘站重疊、完整鍵盤 map |
| UX07 | 未處理 | 資料來源／月份／分數意義說明；若涉及資料源混用，另案評估後端 |
| UX08 | 未處理 | 詳情返回本次結果、推薦脈絡／時段延續、人流連結時間語意 |
| UX09 | 未處理 | 圖表同等文字資料、雷達資訊替代、unknown 與 0 的區分 |
| UX10 | 未處理 | analytics 狀態、Top N 範圍、趨勢說明與 tabs |

### 留給 Batch B／後續批次

- **P0**：完整 map 操作與上述 UX04；其餘頁面的對比／focus；UX07–UX10；跨瀏覽器與輔助科技人工複驗。
- **P1**：完整 MRT semantic color tokens、全站 typography hierarchy、recommendation card / detail / analytics 視覺系統。首頁本批局部選中樣式不代表已完成全站配色遷移。
- **P2**：移除或重整既有 result 裝飾動畫、陰影與多層 cards；微互動與視覺 polish。

目前保留的首頁 shared nav 玻璃感、既有背景／score bar gradient、推薦理由 emoji、卡片與圖表配色，皆是原有內容；本批沒有新增這些效果。下一批需依完整 design direction 分階段處理，避免與 query correctness 修改混在一起。
