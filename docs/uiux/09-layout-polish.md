# MetroPulse v1.1 — Layout Polish

完成日期：2026-09-16（Asia/Taipei）
範圍：Homepage 與 Analytics 的 visual grid、baseline、spacing 與 control alignment。未部署 production。

本次是 release candidate 的小範圍 composition refinement，不是 redesign 或新功能開發。保留 Hono／TypeScript／Vite／Cloudflare 架構、既有視覺方向、query state、analytics request state 與 map interaction architecture。

## Files changed

| 檔案 | 變更 |
| --- | --- |
| `src/index.ts` | 為地圖說明補上 layout class；將 Analytics 站碼 helper 移到 controls 下方的獨立 row |
| `public/static/styles.css` | desktop workspace 對齊、map heading toolbar composition、Analytics control grid／高度與 tabs active indicator |
| `README.md` | 同步 desktop map controls、Analytics helper／tabs 與本文件連結 |
| `docs/uiux/09-layout-polish.md` | 本次範圍、驗證與 regression 記錄 |

`public/static/mrt-map.js`、API routes、DB／D1、推薦器、PageRank、station identity、map coordinates 與資料檔案均未因本次 polish 修改。

## 1. Homepage alignment changes

- 保留 **Query rail + spatial map workspace** 的既有兩欄結構，沒有包成兩張大型浮動 cards。
- desktop map workspace 使用既有 `--mp-space-6` block inset，與 query panel 的 24px content inset 對齊；`#query-title` 與 `#map-heading` 的量測 top 均相同。
- divider 從 `.mp-query-map-area` 移到 desktop `.mp-query-map-panel`，使線條從共同 workspace top 開始，並延伸到 map workspace 的 bottom padding。
- desktop `.mp-query-map-area` 改用兩欄 CSS grid：map heading 在左，放大／縮小／重設全圖在右；其餘說明、view status、legend、map canvas 仍依原 DOM 順序跨滿整欄。
- 三個 toolbar buttons 保留可見文字、accessible names、keyboard focus 與 48px target；1024px 與 1440px 均維持單列。
- desktop 隱藏重複的「改用站名搜尋」；左側完整 combobox 仍可用。`<1024px` 的 mobile map dialog 保留該入口及原本 full-width 呈現。
- 未改地圖 SVG、座標、pan／zoom state、draft／committed 邊界、transfer picker 或 mobile confirmation。

## 2. Analytics control alignment

- 「月份資料」的 station helper 從第一個 grid item 移到 controls 下方；原 `id="trend-station-help"` 與 `aria-describedby` 關聯保留。
- ≥1024px 使用 `minmax(0, 1.4fr) minmax(0, 1fr) auto`，呈現 station field > period field > action 的內容權重。
- station input、period select 與 CTA 的 control bottom 在 1024px／1440px 量測差為 `0`；CTA 為 48px，與主要 controls 一致。
- 頂部「分析範圍」的更新 CTA 同樣使用 48px control height，避免相同元件在另一列產生高度 drift。
- ≤1023px 延續既有 auto-fit／stack reflow；不加入固定寬度或只為截圖成立的 offset。

## 3. Tabs refinement

- 移除 `.tab-btn::after` 的額外圓點；active state 保留文字色、700 字重與 3px underline。
- `role="tab"`、`aria-selected`、roving `tabindex`、focus-visible 及 Arrow／Home／End handler 未修改。
- Browser regression：ArrowRight 切到圖表比較，End 切到月份資料，Home 回到站點排名；focus、`aria-selected` 與對應 panel visibility 同步。

## 4. Responsive verification

環境：Vite local dev server、Playwright CLI、Chromium。以 `documentElement.scrollWidth === documentElement.clientWidth` 判斷 page-level horizontal overflow，避免把垂直 scrollbar 寬度誤判為 overflow。

| Viewport | Homepage | Analytics | Map toolbar／mobile behavior |
| --- | --- | --- | --- |
| 1440×900 | 無 page overflow；兩個 section heading top 同為 230.1px | 無 page overflow；trend controls bottom 對齊 | desktop toolbar 48px、單列；搜尋替代隱藏 |
| 1024×900 | 無 page overflow；兩個 section heading top 同為 230.1px | 無 page overflow；trend controls bottom 對齊 | desktop toolbar 48px、單列；divider 完整 |
| 768×900 | 無 page overflow；query-first | 無 page overflow；controls 可 reflow | dialog role／toolbar 48px／搜尋替代保留 |
| 390×844 | 無 page overflow | 無 page overflow；helper 自然換行空間充足 | dialog 開關、Escape、body lock、focus restore 通過；toolbar 48px |
| 375×844 | 無 page overflow | 無 page overflow | mobile toolbar 48px |
| 320×844 | 無 page overflow | 無 page overflow；CTA 可達 | 三個 toolbar buttons 因文字自然增高為 70px，仍符合 target 門檻 |

768×900 並將 root font 設為 200%：Homepage 與 Analytics 均無 page-level horizontal overflow；Analytics controls 改為直向 reflow，helper 自然換行，CTA 高度隨大字增為 90px 且保持可達。這是 root-font simulation，不取代原生瀏覽器 zoom／實體輔助技術驗證。

Mobile map 回歸另驗證：開啟時維持 `role="dialog"`、`aria-modal="true"` 與 body scroll lock；Escape 關閉後解除 lock，焦點回到 `#map-toggle`。未執行 production deploy。

## 5. Regression / build result

- Impeccable layout detector：`[]`，無 finding。
- `git diff --check`：通過。
- `npm run build`：通過；Vite 6.4.2、37 modules，`dist/_worker.js` 約 144.28 kB。
- Browser console：檢查流程沒有 uncaught page error；保留既有 Tailwind CDN production warning。
- 未修改 recommendation algorithm、PageRank、gamma、API、D1、station identity、map coordinates、map pan／zoom state、mobile map confirmation、queryState、analytics request state、error/loading semantics。

本次只完成 layout alignment 與 composition refinement；icons 與 map coordinate polish 明確留待後續獨立工作。
