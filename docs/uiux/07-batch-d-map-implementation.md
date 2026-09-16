# MetroPulse UI/UX Redesign — Batch D Map Implementation

完成日期：2026-09-15。範圍：**Advanced MRT Map Interaction**。

本批只強化首頁 MRT map 的 usability / interaction，沿用 Batch A 的 query state、Batch B 的視覺與推薦語意、Batch C 的 Station Detail / Analytics。未修改推薦演算法、PageRank、gamma、OD / travel-cost 語意、D1 schema、station identity、`STATION_COORDS` 或 `LINE_PATHS`，亦未部署 production。

## Files changed

| 檔案 | 變更 |
|---|---|
| `public/static/mrt-map.js` | 有界 SVG `viewBox` zoom、Pointer Events pan、marker / label / hit layers、同座標 station grouping、轉乘 picker、origin / draft / recommendation presentation state |
| `src/index.ts` | Map controls、手機 map dialog、map draft / committed boundary、確認／取消、focus trap / restore、body scroll lock、view status |
| `public/static/styles.css` | Map controls、hit/focus layer、state labels、transfer picker、mobile safe-area dialog 與 responsive rules |
| `README.md` | 同步地圖操作、手機確認流程、keyboard alternative、轉乘站 identity 邊界與 Batch D 文件連結 |
| `docs/uiux/07-batch-d-map-implementation.md` | 本批架構、驗證、限制與未實作項目 |

## Zoom / pan architecture

- Approved overview 固定為 SVG `viewBox="-10 0 1140 820"`；不改站點座標或路線幾何。
- 「放大」「縮小」「重設全圖」是原生 button，具有 visible text / accessible name，最小高度 48px（320px 因文字重排為 70px）。
- Zoom step 為 1.35，範圍限制在 1×–4×。每次縮放以目前 view 中心計算，再 clamp 回 approved overview bounds，避免移到整片空白。
- Reset 立即恢復 approved overview，並關閉暫時的 transfer picker / tooltip。
- Pan 使用同一套 Pointer Events 支援 mouse / touch。只有移動超過 6 CSS px 才進入 drag，之後才呼叫 pointer capture；這避免微小移動或 tap 被誤判，亦修正了「在 pointerdown 就 capture，導致 station click 被 SVG 吃掉」的第一輪缺陷。
- Pointer move 只排程 `requestAnimationFrame` 更新 viewBox；不重建路線、station 或 labels。
- Desktop SVG 使用 `touch-action: pan-y`，一般頁面垂直 scroll 不會被 map 攔截。Mobile map mode 鎖定背景後才讓 SVG 使用 `touch-action: none` 進行 map pan。
- Zoom 超過約 1.55× 時進入 detail label class；文字與 markers 仍留在同一 SVG coordinate system，沒有 CSS transform 導致 geometry / pointer target 分離。

## Mobile map behavior

- `<1024px` 保留「從路線圖選站」secondary entry；開啟後 `map-area` 動態成為全 viewport `role="dialog" aria-modal="true"` 的 isolated map mode。
- Dialog 使用 `100dvh`、safe-area padding、sticky solid header / toolbar；必要內容在 dialog 內自然捲動，沒有 glass / floating controls。
- 開啟時保存入口 focus 與頁面 scroll；body 以 fixed-position lock 阻止背景捲動。關閉後解除 lock、恢復原 scroll，focus 回到入口；「改用站名搜尋」與確認則回到 origin combobox。
- Map mode 支援 Escape、可見返回按鈕及 Tab focus containment。Desktop 不套 dialog / scroll-lock semantics。
- 點站只更新 `mapDraftOrigin` 和「預選」presentation，不修改 Batch A 的 `queryState.committedOrigin`。按「使用此站」後才呼叫既有 `selectStation`；返回、Escape 或「取消預選」會恢復原 committed origin。
- Resize 進入 desktop 時會安全結束 mobile draft、解除 body lock 並恢復 committed marker；desktop ↔ mobile 不重建 station data。

## Station hit-target strategy

- Visual marker、label、transparent hit layer 分開；視覺 circle 不為了達成數字門檻而放大到互相覆蓋。
- 一般站 hit radius 為 12 SVG units，轉乘／同座標節點為 15。Hit target 會隨 viewBox zoom 放大；密集區仍優先避免相鄰 target 大量相交。
- 本批不宣稱 overview 的每站皆達 44px。全網 overview 必須縮小才能看見完整 network；在 dense network 中，可靠替代是既有完整 combobox 搜尋與「改用站名搜尋」。
- Station hit targets 為 `tabindex=-1`，因此 100+ stations 不進主要 Tab order；picker 關閉時仍可把 focus programmatically 還給原節點並顯示 focus ring。
- Tooltip 只補充 pointer 使用情境，不是手機或 keyboard 唯一資訊來源。

## Transfer-overlap handling

- Interaction layer 依既有完全相同的 SVG 座標分組，但不合併 DB records、canonical IDs 或推薦 identity。
- 一個視覺節點若對應多個 IDs，只有一個 transparent hit target；click 不再由兩個重疊 circles 的 DOM stacking order 決定。
- 點擊後顯示小型 station-choice UI，標示站名以及每個 route code / line，例如「台北車站：BL12 板南線／R10 淡水信義線」。使用者必須明確選一個可用 ID。
- Picker options / close 均為 ≥44px buttons，支援 keyboard、Escape、visible focus 與 focus restore；未在 station list 的 ID 會顯示為不可選，不猜 alias。
- 地圖 overview 保留原本短標籤寬度：同座標的 secondary code 只在 picker 與 accessible name 出現，不把 `BL12 · R10` 串回中央密集標籤。State overlays 之後會把 labels 移回最上方，恢復原版 marker-then-label paint order；「出發／預選」依既有 label offset 的反方向放置。

## Selected / recommendation states

- Committed origin：深墨實心 marker 與「出發」文字。
- Mobile exploration draft：深墨 outline 與「預選」文字，不等於 committed query。
- Recommendation：白底深墨 outline、中心中性 rank 1–5。
- Route：既有 route path color 與可見 route code；origin / recommendation / route 三者不共用單一顏色語意。
- Zoom、pan、reset 只改 viewBox；origin、draft 與 Top 5 state 不會重建或遺失。未加入 pulse、glow、route halo、flow animation 或 gold marker。

## Keyboard alternative / accessibility

- Map controls、reset、返回、確認、取消與搜尋替代入口均可 Tab，使用全站既有 3px focus ring。
- 手機 dialog 以 Escape 關閉、contain Tab、restore focus；transfer picker 自己可 Escape / close 並回到觸發節點。
- 未建立脆弱的 100+ station roving-focus engine。站點 keyboard selection 仍由 Batch A combobox 完整提供：中文／英文／站碼搜尋、Arrow Up / Down、Enter、Escape、IME guard。
- SVG accessible name 明確說明 buttons 可縮放／重設，keyboard 選站請使用搜尋；route code 與狀態文字確保資訊不只靠顏色。
- Zoom / pan 沒有必要動畫，`prefers-reduced-motion` 下不影響任何完成路徑。

## Responsive verification

本地 `wrangler pages dev` + Playwright Chromium；未 seed、未 migration、未 remote write。

| Viewport | 驗證 |
|---|---|
| 320×844 | Mobile dialog 320×844、整頁 overflow 0、controls 70px high、station Tab stops 0 |
| 375×844 | Mobile dialog 375×844、overflow 0、controls 48px high |
| 390×844 | Dialog exactly fills viewport、body fixed lock、heading focus、overflow 0；ordinary station draft / confirm / cancel tested |
| 768×900 | Isolated dialog 768×900、overflow 0、controls 48px high |
| 1024×900 | Desktop inline map visible、no dialog role、overflow 0、controls 48px high |
| 1440×900 / 1000 | Desktop two-column map visible、overflow 0；overview 與 zoomed central map 截圖人工檢查 |

Mobile landscape、physical iOS Safari / Android Chrome、screen reader 與真實多指手勢仍需 final device verification。

## Regression verification

- Desktop：zoom in → zoom in/detail labels → pointer drag pan → reset；viewBox 由 overview 變更且 reset 精確回到 `-10 0 1140 820`。
- Pointer drag 只更新 viewBox；tap 修正後 ordinary station click 可觸發 draft / select，微小 tap 不被 pan capture 吃掉。
- Mobile：開啟 map → BL13 ordinary station 預選時 hidden committed ID 仍未改 →「使用此站」後 committed ID 才變 BL13、dialog 關閉、body unlock、focus 回 origin。
- 既有 BL13 → 開 map → 預選 BL10 → Escape：committed BL13 與 input 保持，focus 回 map toggle。
- Transfer：點台北車站 shared node 顯示 BL12 / R10 選項；選 R10 時 committed origin 仍維持舊值，只有按「使用此站」後才更新為 R10。
- Keyboard：100+ station nodes 沒有 `tabindex=0`；map controls + combobox alternative 可完成選站。
- Resize：mobile / desktop breakpoints 保持可見性與正確 semantics，無 0-size map 或 page-level horizontal overflow。
- Recommendation → Detail → Return 與 Analytics 未改程式路徑；頁面可載入，browser 無新增 page error。
- 指定回歸 `BL11 → night → food` 通過：`BL12 0.79`、`BL10 0.38`、`R11 0.38`、`BL18 0.37`、`BL15 0.33`。Zoom 後仍有 origin 與五個 recommendation markers。
- `npm run build` 通過：Vite 6.4.2，37 modules transformed。

## Unresolved map / data limitations

- Overview 為全路網示意，不是精確地理圖；小字與 targets 不可能在同一 overview 同時全部達到 44px，需 zoom 或 combobox。
- 同站關係只對「完全相同視覺座標」消除 stacking-order 歧義；資料模型仍有不同站碼 records，沒有新增或猜測 canonical alias。
- 沒有 complex label collision engine。沿用既有 station label offsets，zoom 後提高可讀性與 state priority；若資料未來增加，需獨立評估標籤策略。
- Map 沒有站點鄰近清單、路線規劃、導航、即時營運或真實旅程時間。
- Physical VoiceOver / NVDA、實機 safe area、手機瀏覽器 back 行為與 multi-touch 尚未人工簽核，因此不宣稱整站 WCAG 或全裝置認證。

## Items intentionally not implemented

- Pinch zoom：本批保留 buttons + single-pointer pan 的完整路徑，未增加多指 gesture 複雜度。
- Mouse-wheel zoom：避免在一般 desktop page scroll 時意外攔截滾輪。
- 100+ station roving focus：以既有完整 searchable combobox 作低風險 keyboard alternative。
- Station coordinate rewrite、route geometry redesign、official-map clone、real geography conversion。
- Canonical database identity migration、recommendation / ranking / PageRank / gamma / OD / travel-cost 變更。
- 新 map library 或大型 dependency。
- Production deployment。
