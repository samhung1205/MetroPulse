# MetroPulse v1.1 — Iconography + Subtle Visual Warmth

完成日期：2026-09-16（Asia/Taipei）
範圍：首頁查詢／偏好／地圖工具列、推薦詳情與證據入口、站點詳情資料依據、Analytics tabs 與可恢復狀態。未部署 production。

## Scope and current state

本次是既有 **Taipei Transit Wayfinding × Urban Exploration** 視覺方向上的小範圍 polish，不是 redesign 或新功能。開始前的介面已具有穩定的 query state、推薦證據層、進階地圖 pan／zoom 與 mobile confirm、Station Detail、Analytics keyboard tabs 與 request identity；本次只補一致圖示語言和少量中性色視覺節奏。

保留 Hono／TypeScript／Vite／Cloudflare Pages／D1／Wrangler，以及原有 DOM ID、grid、spacing、control height、breakpoint、focus、ARIA、loading／empty／error semantics。推薦排序、PageRank、gamma、API、D1、real／synthetic 選擇、station identity、地圖座標與 map interaction architecture 均不在範圍內。

## Files changed

| 檔案 | 變更 |
| --- | --- |
| `src/index.ts` | 新增共用 inline SVG symbol sprite 與 icon helper；套用到查詢標籤、偏好、地圖控制、推薦／詳情證據、重試／錯誤狀態與 Analytics tabs；移除未使用 Font Awesome stylesheet |
| `public/static/styles.css` | 圖示尺寸、基線、文字間距、中性色及窄螢幕 Analytics tab icon 隱藏規則 |
| `README.md` | 同步圖示系統、Analytics responsive 行為與本文件連結 |
| `docs/uiux/10-icon-polish.md` | 本次實作邊界、可及性與驗證紀錄 |

## 1. Icon system

- 每頁只注入一份共用 `<symbol>` sprite，實際圖示以 `<svg><use href="#mp-icon-*">` 重用；沒有新增 npm 套件或 client-side icon runtime。
- 全套使用 24×24 viewBox、1.8px stroke、round cap／join 的 Lucide-style outline；畫面顯示固定 16 或 18px，並在 markup 明示 `width`／`height`。
- 圖示使用 `currentColor`。一般圖示沿用深墨或 muted 中性色；警告／錯誤只在既有狀態語意中使用對應 token。MRT 路線色仍只表示路線，不用於裝飾圖示。
- 所有搭配可見文字的圖示都設為 `aria-hidden="true"`、`focusable="false"`。原有 button／link 文字、`aria-label`、control hit area 與 keyboard focus 保留。
- 移除未被介面使用的 Font Awesome CDN CSS，降低一個外部資源依賴；Chart.js、KaTeX、字型與 Tailwind 載入方式未在本批處理。

## 2. Icons added / intentionally not added

### Homepage

- 「出發站」「時段」「偏好」及「從路線圖選站」分別加入 map pin／clock／compass／map 小型線性圖示，維持原本 label／heading 層級與間距。
- 六個偏好 chip 使用 compass／landmark／utensils／shopping bag／moon／users。radio 仍是可見且原生的選中語意，圖示只協助快速掃描。
- 地圖工具列保留「放大／縮小／重設全圖」文字與原有 accessible names，搭配 plus／minus／rotate；未改 zoom step、viewBox、pan、mobile draft／confirm 或 transfer picker。

### Recommendation and Station Detail

- 每筆推薦只在「查看站點詳情」與「查看評分依據」加入 arrow／chevron；空結果以 search-x 輔助辨識，不為四個 evidence rows 逐列配置圖示，避免噪音。
- 查詢、詳情與分析的 retry actions 共用 refresh；錯誤或月份不可用狀態使用既有 error／warning token。
- `stationReason` 與 `preferenceReason` 內的 emoji prefix mapping 保留，只用於相容舊 API reasons 的精確解析；解析後的可見介面仍輸出純文字與 SVG，不顯示 emoji icon。

### Analytics

- 三個 tabs 在可用寬度加入 ranking／chart／calendar 圖示；小於 480px 隱藏裝飾圖示，完整 tab 文字、active underline、roving `tabindex` 與方向鍵／Home／End 行為不變。
- 趨勢 tab 的動態文字只更新 `.mp-tab-label`，不再對整個 button 設 `textContent`，因此 SVG 與 ARIA tab 結構不會被清除。

### Intentionally omitted

- 不在每一行推薦理由、交通資訊、分數維度或排名資料列重複放 icon；文字與數值仍是主體。
- 不為 primary CTA、導覽列、route badge 或每一個 Analytics field label 裝飾 icon；這些位置已有清楚層級或 MRT 語意。
- 不加入 icon tile、圓形底、漸層、glow、玻璃效果或另一套高彩度品牌色。

## 3. Color usage

- 一般 field／heading／tab icon 使用 `--mp-text` 或 `--mp-text-muted`，selected preference 仍由 radio、border 與 font weight 共同表達。
- 錯誤與警告 icon 只沿用既有 `--mp-error`／`--mp-warning` state token；顏色不是唯一訊號，旁邊仍保留狀態文字。
- MRT route colors 只存在於路線代碼牌與路網；未套用到偏好、toolbar、tab 或 recommendation icon。

## 4. Accessibility

- 圖示不是唯一資訊來源；所有主要 action、map controls、tabs 與狀態保留文字。
- 所有 decorative SVG 均為 `aria-hidden="true"`、`focusable="false"`；實測 accessible snapshot 中 label、radio、button、link 與 tab 名稱未包含重複 icon 名稱。
- 16–18px icon 不改 44／48px control target；`currentColor` 讓 disabled、hover、active 與 focus 所屬文字狀態同步。
- Sprite 自身為零尺寸且從 accessibility tree 隱藏，不形成多餘焦點或可讀名稱。
- 原生 radio、details、focus-visible、ARIA tab relationship 與 roving `tabindex` 保留；鍵盤 `End` 實測仍會將焦點與 selected state 移至「月份資料」。

## 5. Responsive / regression

### Compatibility boundaries

- 未改 query draft／committed／submitted state、request timeout／identity、推薦 API 或結果數值。
- 未改 map SVG module、station coordinates、路線 geometry、pan／zoom state、mobile dialog focus trap、confirm／cancel 或站碼選擇。
- 未改 Analytics 資料請求、tab switching handler、chart data、單月／多月判斷或 error／retry state。
- 未把 emoji parsing prefix 改為 regex，也沒有修改後端 `reasons` contract。
- README 因 user-facing 圖示與 responsive tabs 行為改變而同步；setup、deployment 與 API 文件仍正確。

### Browser verification

- Homepage 與 Analytics 於 320、390、768、1024、1440px 的 `scrollWidth` 均等於 viewport client width，沒有 page-level horizontal overflow。
- Homepage 的 preference control 維持 48px 高；icon 實際尺寸只出現 16／18px。390px mobile map dialog 保留 `role="dialog"`／`aria-modal="true"`，三個 toolbar controls 為 70px 高；320px 時仍同列呈現且確認、取消與站名搜尋入口可達。
- Analytics tabs 在 320／390px 隱藏 decorative SVG 並保留完整文字；768／1024／1440px 顯示 18px icon。月份 controls 的 station input、period select 與 CTA bottom 均為 821.80px（48–48.39px browser subpixel height），baseline 未被 icon 影響。
- 768px + 200% root font simulation 在 Homepage／Analytics 均無水平 overflow；SVG 仍固定 16／18px，不推高 typography baseline。
- `BL11 → night → food` 實測仍回傳 BL12 0.79、BL10 0.38、R11 0.38、BL18 0.37、BL15 0.33；recommendation 可見文字不含 emoji，details 的 chevron 只反映 open state。

## 6. Build result

- `npm run build`：通過；Vite 6.4.2、37 modules，`dist/_worker.js` 約 148.74 kB。
- `git diff --check`：通過。
- Impeccable static detector：`[]`，沒有 finding。
- 靜態掃描確認 production source／README／本報告不再載入 Font Awesome；可見介面 markup 不含 emoji icon，兩處 emoji 字串只留在 legacy reason prefix parsing。
- 本地 browser preview 目視檢查首頁 desktop query／map workspace、mobile map dialog、推薦結果與 Analytics；圖示 stroke、基線、文字保留及 route color 邊界符合既有系統，沒有 application JavaScript error。既有 Tailwind CDN development warning 不屬本批變更。
- Analytics 實際切換「月份資料」、查詢 BL12 單月資料後，動態 tab label 更新且 calendar SVG 保留；tab accessible name、active underline 與 panel 關聯維持正常。
- 以 `BL11 → night → food` 還原推薦結果，Top 5 與分數仍為 BL12 0.79、BL10 0.38、R11 0.38、BL18 0.37、BL15 0.33；理由正常去除 legacy emoji prefix，詳情 arrow 與 evidence list-check 可見且未進入 accessible name。
- 未執行 production deploy、migration、seed 或遠端資料寫入。
