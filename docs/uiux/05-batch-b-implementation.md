# MetroPulse UI/UX — Implementation Batch B

完成日期：2026-09-15。範圍：**Visual System + Homepage Recommendation Experience + Methodology**。

以 [Current Audit](01-current-audit.md)、[Design Direction](02-design-direction.md) 與 [Batch A](04-batch-a-implementation.md) 為依據。沿用 **Taipei Transit Wayfinding × Urban Exploration**，優先順序為 clarity → information hierarchy → visual identity → consistency → decoration。

本批已實作、build 與本地瀏覽器驗證；**未部署 production**。推薦演算法、API contract、站碼、資料源邏輯及 D1 均未修改。

## 1. Files changed / boundaries

| 檔案 | 本批變更 |
|---|---|
| `src/index.ts` | Shared header/footer、首頁 result markup/rendering、來源文案、methodology；地圖僅傳入新的 presentation option |
| `public/static/styles.css` | 正式 tokens、shared 基礎 surface/header、query visual polish、有序推薦清單、evidence 與方法排版；清除過時首頁 card/gradient/animation 樣式 |
| `public/static/mrt-map.js` | 從 CSS 讀取 route tokens、修正 prefix、外移首頁 legend、縮減 viewBox 留白、label 對比、Y 路徑襯線、中性選站／名次標記、實色 tooltip |
| `README.md` | 同步推薦清單、選用比較圖、方法公式／來源區分、新導覽與本文件連結 |
| `docs/uiux/05-batch-b-implementation.md` | 實作、驗證、Impeccable 評估與 deferred work |

開始前保存了本批基準快照，避免將既有未提交修改算入本批。比對確認：

- `src/lib/`、`src/db/queries.ts`、API routes、migrations、seed、stations fallback、package/lockfile 保持原樣。
- `src/index.ts` 的站點詳情與 analytics 函式本文保持原樣；只透過 shared tokens/header/footer 得到基礎變化。
- MRT `STATION_COORDS`、`LINE_PATHS`、transfer mapping、label offsets 及名稱表保持原樣。
- Batch A 的 draft / committed / submitted 模型、input invalidation、keyboard/IME、防競速、validation、loading/empty/error、focus 仍沿用。
- Hono + TypeScript + HTML/Tailwind CDN + Vanilla JS + SVG + Chart.js + Cloudflare Pages/D1 不變，沒有新增套件。

## 2. Design intelligence / approach

持續使用 UI UX Pro Max；重新執行 design-system 搜尋及 html-tailwind responsive typography/disclosure 指引。搜尋泛化出的 AI personalization landing、粉色 CTA 與 editorial font pairing 不符合已批准方向，因此未採用；採用其可讀性、觸控、focus、語意控制與 responsive 檢查，視覺值以 `02-design-direction.md` 為準。

Impeccable 採用 **critique / layout / typeset / distill**，最後進行技術 **audit**。首頁是 Operate；方法區是 Read。設計判斷先於 detector，避免因靜態警告移除有語意的 MRT 色彩。

空間策略：query 是唯一主要操作區；map 是同一 workspace 的空間輔助。推薦以共同閱讀順序和分隔線組成一份清單；數據與方法採漸進揭露，不讓每個欄位都有一張卡。

## 3. Visual tokens implemented

### Surface / text / interaction

| Token | Value |
|---|---|
| `--mp-bg-page` | `#F6F5F1` |
| `--mp-surface` | `#FFFFFF` |
| `--mp-bg-elevated` | `#EEEFEA` |
| `--mp-text` / `--mp-accent` / `--mp-focus` | `#172B32` |
| `--mp-text-muted` / `--mp-text-soft` | `#52626A` |
| `--mp-border` | `#D8DEDA` |
| `--mp-border-strong` | `#687780` |
| `--mp-accent-hover` | `#28434C` |
| `--mp-accent-soft` | `#E7EDEA` |
| `--mp-on-accent` | `#FFFFFF` |
| success / warning / error / info | `#236447` / `#81530F` / `#A12B36` / `#345563` |
| disabled bg / text | `#E5E8E5` / `#52626A` |
| score PR / flow / preference / cost | `#345563` / `#5D666C` / `#746442` / `#754A50` |

Score tokens 是既有其他元件的相容性 tokens，與 route tokens 分離；首頁 evidence 直接用文字／數字，跨站總分圖使用中性墨色，不再拿捷運線色當評分維度。

### Route tokens

| Route | Token color | Badge foreground | 瀏覽器文字對比 |
|---|---|---|---:|
| BL | `#0070BD` | 白 | 5.18:1 |
| R | `#E3002C` | 白 | 4.88:1 |
| G | `#1A803F` | 白 | 5.00:1 |
| O | `#F5A623` | 固定 `#172B32` | 7.26:1 |
| BR | `#C48C31` | 固定 `#172B32` | 5.00:1 |
| Y | `#EDDC00` | 固定 `#172B32` | 10.39:1 |

Badge 同時顯示 route code；accessible name 包含路線名稱。推薦列依 `station.line` 與既有 `transfer_lines` 顯示路線，不推導新的 canonical station。以上六色是專案語意色，不宣稱為官方授權品牌規範。

### Typography / spacing / shape / elevation

- 正文、站名、標題與數據使用既有 Noto Sans TC；Outfit 僅用在小型 wordmark。沒有新增字型。
- Type tokens：caption 13、small 14、body/label 16、station 20、section 24、page 28 mobile / 32 desktop；主要正文 line-height 1.65–1.75，中文不套負 tracking。
- 數值使用 tabular numerals。方法正文最大 44rem，約 44 個全形中文字；公式保持 16px，以 block line 與自然換行處理窄螢幕。
- 4px spacing base，tokens 為 4/8/12/16/24/32/48。Gutter 為 mobile 16、tablet 24、desktop 32px；desktop 內容可用寬度最多 1200px。
- Route badge radius 4px；input/button/chip 8px；真正 panels 最多 12px。Query 與推薦項目不靠大圓角識別。
- Base shadow 為 none；只有浮層使用 `0 8px 24px rgb(23 43 50 / 14%)`。
- 去除 shared radial/linear 背景、glass navbar、CTA gradient/glow、card hover lift、首頁 staggered card animation。
- 游標、文字選取、focus 與數值角色使用系統 tokens。首屏沒有新增裝飾圖示；偏好仍為純文字 native radio。

Analytics 保留既有深色模式，改用協調的中性色 surface/text tokens；這是 shared 基礎調整，不代表其內容視覺與 IA 已完整改版。

## 4. Header / workspace / controls

Shared header 為實色 surface＋底部分隔線，只有 wordmark、產品副標及三個文字連結：**開始推薦／旅運量分析／推薦方法**。移除 emoji logo 與 feature icons，API 移到頁尾／研究資訊。Active navigation 以字重與底線表示，沒有大型 pill 或 desktop hamburger。

發現並修正導覽 regression：帶 `?from=...` 的首頁原先點 `/#about` 會重載無參數首頁。首頁 header/footer 現在使用 `#about`，其他頁仍使用 `/#about`。實測點擊後 document requests=0，query snapshot、輸入與五筆結果全部保留。

Desktop ≥1024px 保持 query 在左、map 在右；查詢表單有實色 surface，map 以空間和單一分隔線作為輔助區。Mobile/tablet 保留 query-first、可展開地圖及選站後收合。DOM 沒有移動成 map-first。

Native time select、fieldset/legend/radio、combobox attributes 與事件處理保留。文字、hover、focus、checked 與 error 樣式改用正式 tokens；主要 controls 高 48px。Radio dot、邊框及字重提供非色彩選中訊號。CTA 仍是「查看推薦」。

## 5. Homepage MRT presentation

- 首頁 legend 移出 SVG，成為可讀的 HTML route code＋line name。
- Homepage viewBox 從 `-90 0 1240 820` 改為 `-10 0 1140 820`；縮減 legend 占用與左右留白。更窄 query 欄讓 desktop map 使用更多 workspace 寬度。
- 新增 `externalLegend` optional presentation option；其他呼叫者不傳時仍保留原 embedded legend/viewBox。
- 未重畫任何站點座標、路徑或 label offset。名稱字級 10→12 SVG units、站碼 8→9；站名改深字，避免橙／黃小字低對比。
- Prefix 改用既有一致模式 `/^[A-Z]+/`；R10 實測 stroke=`#E3002C`，不再誤用 BL。
- Y 線加中性外襯，保留黃色路徑與 Y 代碼；搜尋仍是小字／小 targets 的完整替代。
- 出發站使用深墨實心，推薦以中性數字 1–5 標記，沒有金色推薦填色。
- Tooltip 改實色＋功能性 elevation，移除 blur；初始化重試時清理上一個 tooltip。

**未宣稱解決完整 map usability：**手機原尺寸路網仍有小字、小點、轉乘重疊。完整 zoom/pan、keyboard map、canonical transfer selection 留專門 Map batch。

## 6. Recommendation UX / score evidence

五筆結果改為 `<ol>`，每站是 divider 分隔的 list item / article。DOM 與視覺順序為：

1. 中性 rank。
2. Route badges、站名及既有 station ID／行政區。
3. 具體推薦理由，及有資料支持時的相對人流連結說明。
4. 交通負擔的資料限制。
5. 原值 `0.xx` 推薦排序分數。
6. 站點詳情連結。
7. Native `<details>` 評分依據。

第一名只增加站名字級；沒有獎牌、金色、glow 或 confidence bar。每站理由先於分數，保持五站的共同欄位順序，不做 mobile carousel。

### 理由與交通的資料界線

既有 `reasons` 由後端加入 emoji 與百分比。首頁只匹配 `recommender.ts` 已知的偏好理由前綴，保留冒號後的原有地點描述；未找到時使用既有 `tags`，缺少兩者就明說特色說明不足。沒有廣泛 Unicode regex 刪除站名／理由，也沒有更改 API `reasons`。

連結說明依已提供的 normalized value 表示「本次候選中較高」，不沿用「穩定流量」的時序推論。數值完整呈現在 evidence，明說不是旅客前往機率。

目前推薦 API 沒有結構化 `station_count`／`transfer_count`／`estimated_time` 或欄位來源證明；數字僅存在於舊理由的估計文字。本批**不從字串拆數字、不從 cost score 推算旅程**，每站顯示「資料不足；尚無可核實的站數、轉乘與時間資訊」。若後续有可靠的結構化來源，再新增交通摘要，不需更改本次 ranking。

### 分數／比較圖

- 保留 API `total_score` 的兩位小數，未改成百分比或百分制。
- 移除 `total_score / maxScore` 的首名滿條與卡內 score bar。
- 比較圖改為選用 native disclosure 內的水平 Chart.js，固定 x 軸 0–1，全站同一墨色。不是將首名正規化為 1，也不標示「適合你」。
- 四維度堆疊圖的常駐呈現由 evidence rows 取代；各站 raw / normalized / weight / contribution 更容易核對，資料沒有移除。
- Evidence 預設收合；展開後 desktop 為四欄、mobile 為兩欄 stacked data，不造成整頁 horizontal scroll。
- Contribution 保留四位小數與正／負號；成本 0 顯示 `0.0000`，不顯示負零。缺少或非有限數值顯示「未知」，未補 0。
- 比較圖沒有入場動畫；reduced motion 下查詢、焦點與其他功能仍可用。

Batch A 的結果 snapshot、stale 提示、清除 chart instances／metadata、empty/error/retry 與 race protection 繼續生效。

## 7. Methodology / formula / data-source clarification

合併舊「推薦分數怎麼來的」與演算法大卡片為單一 **推薦方法** research note：h2 → paragraph → divider → h3 → formula / definition list / native details。沒有巢狀 cards、purple icon、彩色 feature dots 或公式卡。

檢查了 `src/lib/recommender.ts`、`normalizer.ts`、`src/routes/recommend.ts` 與 `src/db/queries.ts`，UI 說明對齊目前程式：

- PR、transition、TravelCost 使用候選間 Min-Max；PreferenceMatch 本身為標籤值，不再做候選間 norm。
- norm 範圍取排除 origin 後的全部候選；全值相同回傳 0.5；一般值限制於 0–1。
- 權重不變：0.30 / 0.25 / 0.30 / 0.15。
- 各 weighted component 先取四位小數，再加減；總和負值截 0、取兩位小數後排序。既有 ties 行為不變。
- 已有 backend defaults：PR/transition 缺漏→0、cost 缺漏→0.5、指定偏好缺標籤→0.1、「不限」且沒有標籤→0.3。這些既有行為只在方法區誠實記錄，**沒有改引擎**。
- UI 的「未知」只能處理 API 未提供的值；無法從已代入的 0 反推原始資料是否缺漏，不把它認證為真實觀測零值。

**研究模型**仍保留 `pᵢⱼ = γ × (eᵢⱼ / sᵢ) + (1 − γ) × (1 / n)`、γ=0.85、Power Method 與變數定義。

**目前推薦資料路徑**另節說明：real 模式取已匯入月份 PR；`getRealTransitionMap` 的連結值為起站該月份／時段的 `flow_count / total`，未在每次推薦重新加上 γ 項。只有有對應 PR/OD 的候選欄位才覆蓋，其餘可能保留舊資料。因此模型公式不能等同每次 production transition 的即時計算來源。

結果摘要讀取既有 `metadata.data_source` / `data_month`：real 顯示月份旅運資料；synthetic 明說合成示範；來源或月份未提供時顯示未知。摘要旁有一行「部分偏好與交通資訊來自既有標籤或估計資料」，更完整的欄位來源限制放在方法區。沒有新增 API 欄位或改 data mode。

## 8. Verification

環境：本地已 build 的 Cloudflare Pages preview、既有 local D1，Playwright Chromium。真實成功路徑使用本地 API；race/empty/network/unknown/synthetic 等測試透過隔離 browser response 模擬。沒有 seed、migration 或 remote 資料寫入。

### Build / Batch A regression

- `npm run build` 通過 2 次：完整實作、導覽修正後；Vite 6.4.2、37 modules、最後 worker bundle 約 114.09 kB。
- 既有 Batch A 測試換成新清單 selector 後 **16 組通過**：中文 BL12、英文／站碼、input invalidate、鍵盤、IME guard、clear、URL preselection、snapshot、duplicate request、A/B race、empty 清理、error/retry、mobile map、reduced motion、detail/analytics 可載入。
- Race 模擬特別讓 A 忽略 abort 且最後返回；A 仍不能覆蓋 B。
- BL11 → night → food 的完整 Top 5 `[station.id, total_score]` 與 Batch A fixture 完全相等：

| Rank | Station | Score |
|---:|---|---:|
| 1 | BL12 台北車站 | 0.79 |
| 2 | BL10 龍山寺 | 0.38 |
| 3 | R11 中山 | 0.38 |
| 4 | BL18 市政府 | 0.37 |
| 5 | BL15 忠孝復興 | 0.33 |

### Batch B checks

另外 **6 組檢查通過**：同頁方法導覽保留 state、固定尺度／排序原值、六尺寸 reflow、無首頁裝飾效果、未知值處理、合成來源標示。

| 寬度 | 全頁 scrollWidth | 方法公式 / evidence 溢出 | Header blur |
|---:|---:|---|---|
| 1440（高900） | 1440 | 無 | none |
| 1024（高900） | 1024 | 無 | none |
| 768 | 768 | 無 | none |
| 390（高844） | 390 | 無 | none |
| 375 | 375 | 無 | none |
| 320 | 320 | 無 | none |

展開 evidence、method details 與比較圖後仍無整頁橫向捲動。Charts 取得正確非零 canvas 尺寸；固定 x=min0/max1，資料陣列未重新縮放。Home computed gradient=0、可見 emoji=0、推薦列 shadow=none；六條線的 SVG stroke 與 token 相符。

未知測試涵蓋 missing metadata、null total_score、null raw/normalized/weight/weighted，皆顯示未知；不輸出 `NaN` 或把缺值變 0。Synthetic 測試不殘留上次 real 月份。正常與模擬資料測試沒有未捕捉 JavaScript pageerror；刻意 network abort 的 ERR_FAILED 為預期。

### Impeccable critique / final audit

Method: **dual-agent** — A `/root/design_review`、B `/root/technical_audit`；A 未讀 detector，B 結果在 A 完成後才合併。

- A 的設計判斷：產品專屬性成立；layout、typeset 通過，distill 大致通過。初評 Nielsen **32/40**，評分發生於方法 link 修正前，未冒稱後續重新評分。
- A 唯一 P1 是帶參數首頁的 `/#about` 丟失查詢，已修正並專項驗證為 0 次 document navigation。P2 是重複選站文字與資料限制略長；本批精簡摘要，保留原有 live announcement 與未知資訊。
- B CLI `impeccable detect --json src/index.ts`：exit 0，**0 findings**。技術 scope audit **16/20**，未發現新增 P0/P1；不是 Lighthouse 分數或整站合規認證。
- Browser `detect.js` 確認在 local 新頁注入成功，僅產生 headless 證據，沒有宣稱使用者可見 live overlay。
- 人工判讀：dropdown border+shadow 是功能性浮層；方法 704px/16px 約44個全形字，不能用英文 character 計數機械縮窄；detector 自己的黃色 overlay 造成的 glow 警告排除。沒有因此改掉 semantic MRT colors。
- 獨立 browser 已關閉，audit 自建 live-server 已停止，production source 無 detector injection。
- Questions skipped: 使用者已完整指定本批範圍及輸出，不需額外決策。

限制：使用 Chromium、DOM、keyboard、synthetic composition events 與 touch simulation；實體 IME、VoiceOver/NVDA、iOS Safari 仍需人工複驗。沒有宣稱地圖全部 targets 達 44px，或所有頁面 WCAG 合規。

## 9. Deferred work

### Station Detail

完整 IA、從詳情回到原查詢結果、推薦脈絡／時段延續、雷達與圖表文字替代、人流來源說明、route badge 橙／棕／黃對比仍需專批。函式本文未改；舊 emoji、圖表顏色、局部 badge shadow 不算本批完成。

### Analytics

完整 IA、Top N 範圍一致、tabs keyboard、未知與錯誤狀態、單月趨勢文案、inline route bar gradient 與 chart color hardcodes 留後續。Shared 暖／深中性 tokens、實色 header 與基本 panels 已生效，但未宣稱 analytics 全面 redesign。

### Advanced Map UX

轉乘站重疊／canonical 選擇、完整 pan/zoom、可放大 hit area、100+ stations keyboard navigation、密集標籤與定位／交通資料核對仍待處理。圖例、對比、prefix 與 viewport 改善不等於完成整個 map engine。

### Data / performance / polish

- 逐站、逐欄 provenance、可靠結構化交通 context、區分 backend default 與 observed zero，需要後續另案；本批不改 API、real/synthetic selection 或研究公式。
- Shared Tailwind CDN / Chart.js 同步載入仍為既有效能負債，沒有虛構效能改善分數。
- 可進一步合併可見選站確認與 live status 的重複文字、精簡逐站限制，仍須保留無障礙播報與 unknown 語意。

Audit 對照：Batch A UX01/02/03 與 UX05/06 已完成部分保持；本批完成 UX07 **UI 層**與首頁 result/method 視覺系統；UX04 僅修 presentation／prefix，UX08–UX10 及其他頁面仍 deferred。
