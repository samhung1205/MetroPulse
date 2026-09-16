# MetroPulse — Design Direction

文件完成：2026-09-15；依據2026-09-14實測。狀態：**待實作的設計規格**；本文件不代表介面已修改。依據：`01-current-audit.md` 的源碼／正式網站實測，以及 UI UX Pro Max + Impeccable 評估。

## 1. Design principles

**Taipei Transit Wayfinding × Urban Exploration**：用導視系統的可辨識順序，協助旅客找到有理由前往的下一站。

1. **先完成選擇，再提供研究深度。** 首屏讓人能選站；完整公式、圖表與metadata按需查看。
2. **每個顏色回答一個問題。** 路線色回答「哪條線」，狀態回答「已選／錯誤」，數據回答「哪個維度」，不可混為裝飾。
3. **推薦先說理由。** 先站名與可驗證的站點特徵，再交通負擔，最後排序分數。
4. **看見的條件就是實際條件。** 輸入、選中、送出、結果各狀態可辨；畫面與API一致。
5. **手機有自己的順序。** 行動操作以搜尋與查詢為主；大型地圖由使用者選擇打開。
6. **可解釋包括限制。** PR不是即時擁擠度；tag score不是滿意度機率；未知不能顯示為零。
7. **連續改善既有產品。** 保留Hono／Vanilla JS與研究模型；以小步驗證完成，不把UI改善變成框架遷移。

## 2. Product personality

可靠、清楚、有城市好奇心、願意說明理由。像熟悉路網的城市嚮導，用精準站名與生活資訊幫忙選擇；不假裝官方營運服務，也不扮演萬能AI。

文案以繁體中文為主：站名＋路線代碼＋完整時段。不用「AI為你精準預測」「必去」「最佳保證」「現在人潮」等超出資料能力的措辭。

首頁短句建議保留「搭捷運，下一站去哪？」；副文改為「選擇出發站、時段與偏好，找出值得探索的 5 個站點。」研究身份以一行資料註記與「推薦依據」入口承接。

## 3. Visual direction

**低彩度城市紙面、深色導視文字、準確路線標記、水平分隔、固定資訊順序。** 以資訊排列形成識別，不新增大幅地景、玻璃材質或裝飾性軌道圖案。

採 UI UX Pro Max 的 Accessible & Ethical + Flat Design 原則，經產品需求調整：足夠對比、熟悉控制、節制色彩、無普通卡片陰影。排除其搜尋回傳的AI landing、Aurora及Fira Code dashboard風格。

首頁、詳情、分析使用同一淺色系統；分析以較密集列、表頭、單位和篩選辨認。若採漸進實作，第一步可先修現有暗色分析底色及對比，第二步才切換共同淺色tokens；不能只改background而留暗色文字值。

## 4. Color tokens

命名沿用 `--mp-*`，避免建立平行設計系統。以下為建議值；implementation需在實際底色、focus、hover、disabled與charts上驗證。

| Token | Value | 角色 |
|---|---|---|
| `--mp-bg-page` | `#F6F5F1` | 暖中性頁面底色，純色 |
| `--mp-surface` | `#FFFFFF` | 輸入、可操作surface、資料區 |
| `--mp-bg-elevated` | `#EEEFEA` | 次級分組／table header，並非陰影高度 |
| `--mp-text` | `#172B32` | 主要站名、正文與主要action底色 |
| `--mp-text-muted` | `#52626A` | 次要說明；白底6.34:1、page底5.81:1 |
| `--mp-text-soft` | `#52626A` | 基本文字不再因第三灰階弱化；細微差異靠字級與位置 |
| `--mp-border` | `#D8DEDA` | 非互動分隔線，不承擔唯一識別 |
| `--mp-border-strong` | `#687780` | 輸入邊界；白底約4.63:1 |
| `--mp-accent` | `#172B32` | 主要CTA、選中邊框；與文字共用值但角色不同 |
| `--mp-accent-hover` | `#28434C` | 主要CTA hover |
| `--mp-accent-soft` | `#E7EDEA` | 選中區塊純色底，不是gradient |
| `--mp-on-accent` | `#FFFFFF` | CTA文字；accent底約14.71:1 |
| `--mp-focus` | `#172B32` | 3px outline；深色物件加2px白間隔 |
| `--mp-success` | `#236447` | 成功狀態icon＋文字，不能獨立當G線色 |
| `--mp-warning` | `#81530F` | 資料有限／估計值註記 |
| `--mp-error` | `#A12B36` | field error／retry訊息 |
| `--mp-info` | `#345563` | 資料說明與中性提示 |
| `--mp-disabled-bg` | `#E5E8E5` | disabled control面 |
| `--mp-disabled-text` | `#52626A` | 不用整體opacity讓文字過淡 |

`--mp-text`在page底約13.48:1、白底14.71:1。舊`--mp-accent`藍色可保留在`--mp-line-bl`，不再兼任所有action。專用score tokens可沿用既有名稱但換值：

| Token | Value | 表達 |
|---|---|---|
| `--mp-score-pr` | `#345563` | 熱門度分量，固定label |
| `--mp-score-flow` | `#5D666C` | 人流連結分量，固定label |
| `--mp-score-pref` | `#746442` | 偏好分量，固定label |
| `--mp-score-cost` | `#754A50` | 成本分量，明確負號與負向軸 |

這四個色塊不得獨立承擔辨識：近似中性色需加文字、數值、留白／邊界；色覺模擬若不可分，改成分列bars或圖樣，而不是再添一組高彩度路線色。

## 5. MRT semantic colors

官方路網的借鑑是「色彩＋路線代碼＋文字＋轉乘符號」，不照搬官方網站版型或品牌標誌。核對路線名稱／路網語意參考 [臺北捷運路網資訊](https://tpweb.metro.taipei/2026/) 與 [官方路網圖](https://web.metro.taipei/pages2026/WebRouteMap)。以下hex以**專案既有色值作為相容性起點**，不是宣稱官方授權品牌色規範。

| Token | Hex | 名稱／代碼 | Badge文字 |
|---|---|---|---|
| `--mp-line-bl` | `#0070BD` | BL 板南線 | 白，約5.18:1 |
| `--mp-line-r` | `#E3002C` | R 淡水信義線 | 白，約4.88:1 |
| `--mp-line-g` | `#1A803F` | G 松山新店線 | 白，約5.00:1 |
| `--mp-line-o` | `#F5A623` | O 中和新蘆線 | `#172B32`，約7.26:1 |
| `--mp-line-br` | `#C48C31` | BR 文湖線 | `#172B32`，約5.00:1 |
| `--mp-line-y` | `#EDDC00` | Y 環狀線 | `#172B32`，約10.39:1 |

規則：

- 可用於SVG路線、路線代碼牌、轉乘站的多條路線標記、清楚標示路線的圖例。
- 不可用於全頁背景、CTA漸層、rank獎牌、隨機feature icon、success/failure唯一訊號、四維分數的同色分類。
- 「BL12 台北車站」站名仍用深色；O/BR/Y不可直接用其route color寫小字在白底。代碼牌用上表on-color。
- Y線在白底對比低，路徑需深色外襯／輪廓，且保留Y文字圖例。地圖縮放也要保持必要描邊，不只放大viewBox。
- 轉乘站保持中性節點＋多個路線代碼，不用彩虹漸層，也不以單一路線色暗示只有一條線。
- Origin＝黑色外環＋「出發」；推薦＝中性數字標記1–5＋圖例；一般站＝白心＋正確路線輪廓。推薦不再用接近Y線的金黃填色。
- 統一CSS、SVG、Chart.js、後端`LINE_COLORS`中的Y色值；顏色可統一，station IDs與transfer mapping不可順便重定義。

路線的「哪條線」與互動的「是否選中」可同時存在：使用色彩表示前者，輪廓、文字、checked語意表示後者。[W3C Non-text Contrast](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html) 是驗收依據之一。

## 6. Typography 與 type scale

內容、操作、站名：沿用 `Noto Sans TC, system-ui, -apple-system, "Segoe UI", sans-serif`。Outfit可只保留既有小型wordmark，資料與中文標題不依賴它。無新增外部字體需求。

用固定rem scale；不採超大型行銷hero或跟容器任意縮小的clamp標題。400正文、500 label、600小標、700站名與標題；不使用未載入的650作為關鍵層級。

| Role／token | 字級 | 行高 | weight／用途 |
|---|---:|---:|---|
| `--mp-type-caption` | 0.8125rem / 13px | 1.5 | 400，非關鍵metadata；不可作唯一操作文字 |
| `--mp-type-small` | 0.875rem / 14px | 1.5 | 400/500，站碼、表格、單位 |
| `--mp-type-body` | 1rem / 16px | 1.65 | 400，推薦理由；input固定至少16px |
| `--mp-type-label` | 1rem / 16px | 1.4 | 600，control label與button |
| `--mp-type-station` | 1.25rem / 20px | 1.4 | 700，result站名 |
| `--mp-type-section` | 1.5rem / 24px | 1.35 | 700，段落標題／detail站名可上調 |
| `--mp-type-page` | 1.75rem / 28px mobile；2rem / 32px desktop | 1.3 | 700，唯一h1 |

數字用tabular-nums；預設分數保留API精度0.xx，詳細加權分量保留必要小數位。中英文站名分兩行，不縮小長站名、不對中文字套負letter-spacing。理由寬度約32–40個中文字，研究段落約36–44個中文字；文字放大時自然換行。

## 7. Spacing system

4px base：4／8／12／16／24／32／48；CSS以rem表示。禁止為了截圖吻合大量新增5、7、13、19px間距。

- label到input：8；input到error/helper：8。
- 相關內容：8–12；表單group：24；section：32 mobile／48 desktop。
- 頁面gutter：16 mobile、24 tablet、32 desktop；最大內容寬度1200px。
- 搜尋列／推薦列padding：16 mobile、20–24 desktop；相鄰click targets至少有可辨邊界與適當間距。
- 地圖／結果與表單之間24–32；不用額外空白占位模擬高度。
- 若sticky action開啟，頁底預留實際action高度＋safe area；不永久添加很大的空白頁尾。

## 8. Border radius strategy

| 角色 | Radius |
|---|---:|
| 分隔線、資料列、基本區段 | 0 |
| 路線代碼牌 | 4px |
| Input／button／單選chip | 8px |
| Dropdown／真正的panel／map dialog | 12px |
| 小狀態圓點／radio控制 | 50%（幾何形狀本身有語意） |

不以rounded-full包所有tag；不讓每一行資訊都得到圓角白卡。普通results列只需separator。若第1名需要額外層級，增加空間與站名字重，而非獎牌卡或厚框。

## 9. Elevation strategy

Base：無shadow。普通表單區、結果列、圖表與詳情section依靠底色、對齊與border。

Popover/dropdown：只用一級 `0 8px 24px rgb(23 43 50 / 14%)` 區分與被覆蓋內容。Modal地圖用實色surface＋中性遮罩；不加backdrop blur。Sticky nav／action以1px border分隔，不用霓虹光暈。

z-index角色固定：base 0、sticky 20、popup 30、map dialog原生top layer（或50）、toast/status依必要性。dropdown不得被map框或overflow panel裁切；避免每個元件自創9999。

## 10. Iconography

改用單一套24×24 viewBox、約1.75–2px stroke的SVG線性圖示，顯示20或24px。路線碼與站點／轉乘符號本身就是導航資訊，優先於泛用圖示。

必要icon：search、close、chevron、arrow、clock、transfer、map、info。偏好可以純文字；不強制每種偏好都有圖。取消emoji和magic-wand作interface icon。

有文字的decorative SVG設`aria-hidden`；icon-only control要明確名稱，如「清除出發站」「放大地圖」。button hit area至少44px，圖示本身不必44px。

API `reasons`目前帶emoji：不能用隨意regex刪Unicode導致站名／理由損壞。未來以相容性保留`reasons`並新增結構化理由類型；新UI用類型對應icon或純文字，詳細說明見檔案計畫。

## 11. Information architecture

主導覽：MetroPulse／開始推薦／旅運量分析；方法說明在結果附近及頁尾可達，API移至頁尾研究資訊。手機保留產品名稱與清楚的「旅運量分析」文字入口，不新增難以辨識的icon-only navigation。

```text
首頁：一句價值說明
  → 出發站 → 時段 → 偏好 → 查看推薦
  → 本次條件 + 資料來源 + Top 5
  → 各站理由 / 詳情 / 選用評分拆解
  → 研究方法與API

地圖：選站替代入口；桌面可並列，手機由「從路線圖選站」打開
詳情：站點識別 → 與本次查詢的關係 → 站點特徵 → 資料依據
分析：月份／時段／範圍 → 排名與比較 → 趨勢 → 資料定義
```

同頁保留三個輸入，不拆成三頁wizard。對一般旅客，完成推薦不應需要瀏覽分析頁或先學PageRank。

## 12. Buttons

- Primary：純色深墨底＋白字，48px高；同一視窗內只維持一個最主要action。文案「查看推薦」；結果數量可由旁邊文案說明「最多5站」，空資料時不可承諾固定5站。
- Secondary：白底、深字、1px強border；如「從路線圖選站」「重試」。
- Tertiary：有底線／明確箭頭的文字連結；如「查看站點詳情」「返回本次結果」，hit area擴大。
- Default／hover／focus／pressed／disabled／loading狀態齊備。hover只改實色，不浮起、不橫移。
- 未選起站時若允許按primary，必須以欄位內錯誤引導focus；不使用alert。選取無效或loading期間阻止重複請求。
- Loading保持按鈕寬高，用「正在查詢…」與區域status；不為快速查詢封鎖全螢幕。
- Mobile sticky action只在主按鈕離開viewport且目前query可提交時顯示，兩者共用狀態；不要兩個重複按鈕同時搶注意力。

## 13. Inputs 與 selection state

Origin採用可存取combobox：可見label「出發站」、placeholder「搜尋站名或代碼」、選中後仍完整顯示站名，附近有route code。支援中英文與代碼，不自動將「臺／台」正規化到錯誤站點；若增別名只影響搜尋匹配。

候選列：站名主體 → route code → transfer label。一次顯示約5–6列並可滾動，不硬砍完整候選。對同名多碼站可先分列但清楚列線名；視覺合併須先定義 canonical ID與別名規則。

四份狀態有明確責任：

| State | 用途與規則 |
|---|---|
| draft input | 使用者正在輸入；不直接當station ID |
| committed origin | 從有效候選／map明確選定；input一旦不符就invalidate並清badge |
| draft query | 目前from/time/preference；改動後顯示「條件已變更，請重新查詢」 |
| submitted query + results | 綁定同次request與response；舊回應不能覆蓋新查詢 |

Keyboard：Tab進input；Down/Up移動候選；Enter確認；Escape關閉不意外提交；`aria-activedescendant`與`aria-selected`正確同步。中文IME組字時Enter不提早選取或送出；焦點留在input，候選不形成15個Tab停點。參考 [APG Combobox](https://www.w3.org/WAI/ARIA/apg/patterns/combobox/)。

No match：「找不到符合的站名，試試完整站名或代碼。」資料失敗：「站點清單暫時無法載入」＋「重試」。使用內建清單時說明推薦資料仍可能暫時無法使用；不把D1／seed指令放進旅客介面。

## 14. Segmented controls / chips

時段：mobile預設原生select，顯示完整「下午 14:00–17:00」，減少12張option卡高度；desktop也可用相同select維持一致，若需要總覽則用兩列三欄原生radio labels。不可用CSS移動兩套不同值的控制。

偏好：維持不限、景點、美食、購物、夜生活、親子，2×3或3×2文字chips，以實際可讀寬度決定。每格至少44px高，不用emoji上圖下文。

單選本質使用fieldset/legend + radio input；selected有checked語意、2px深色框、淡底、勾選記號。Hover不能與selected相同，focus獨立可辨。預設下午／不限沿用現有行為，不在UI改版中偷偷改成「現在」；它是歷史資料分時段，不是即時推薦服務。

## 15. Map interaction

地圖是空間理解與選站工具，不是手機首頁通行門檻。

- Desktop：查詢右側可見，標題「從路線圖選站」；map selection與表單雙向同步；選站後顯示「已設為出發站：台北車站 BL12」。
- Mobile：表單旁secondary按鈕開獨立全屏map dialog或專用可返回view，內含搜尋、地圖、縮放、重設與清楚的「使用此站」動作。探索中的暫選不污染已提交query，關閉可取消。
- 不重畫所有站座標作為首輪必要條件。先解決尺寸、可點性、顏色與狀態；全路網縮略圖只作概覽，不要求直接點2px圓圈。
- 放大後提供至少44px可靠hit area；鄰近／重疊轉乘點不能以擴圈方式任意互相蓋住，應顯示可存取站點列表選擇。
- 支援鍵盤zoom/reset與搜尋替代；可實作roving焦點／站點清單，不要讓100多節點全部成為主要Tab路徑。可用Escape關閉，還原開啟按鈕focus。
- 若支援drag/pinch，同時有不需拖曳／多指的按鈕。一般頁面滾動不能被預設map區攔截。觸控選站不依賴hover tooltip。
- tooltip資訊也在文字選站面板可達；不遮住target或越出viewport；不以cursor附近tooltip充當手機唯一回饋。
- 轉乘的code aliases要映射到同個可視節點；處理SKIP_LABEL中的hidden labels，避免兩圈重疊而選到使用者不知道的次碼。
- 標注「路線示意，非實際地理比例」；不把這張示意圖當步行導航或營運狀態圖。

依據 [WCAG target size](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html)，AA最低24px有特定例外；MetroPulse採44px為可用性設計門檻。驗收需要看hit area、間距、替代控制與真實操作，不能只看circle的`r`。

## 16. Recommendation result pattern

結果用有序列表；五站共享相同欄位順序，第一站可多一行完整理由，其他四站仍能直接比較，不做carousel或一次只看一站。

```text
從 西門 BL11 出發 · 夜間 19–23 · 美食      修改條件
依2026年1月旅運資料；偏好與交通資訊包含標籤／估計值

1  [BL] 台北車站                   推薦排序分數 0.79
   美食：台北地下街、站前餐廳等（沿用既有資料）
   1站 · 無需轉乘 · 約2分鐘（資料估計，若有可靠欄位）
   為什麼推薦：人流連結強、符合美食偏好
   查看站點詳情 →        查看評分依據 ▾
────────────────────────────────────────────
2  [BL] 龍山寺 ...
```

以上數字取自本次audit樣例，**不得硬編碼成產品內容**。

顯示層次：

1. 第一層：排名、站名、route code、主要偏好理由、可用的交通資訊、詳情入口。
2. 第二層：其他推薦理由、資料限制；不要截斷到失去關鍵限定詞。
3. 第三層：`details`評分依據，以四列文字／小表顯示原始值、正規化、權重、加權分量與總和；mobile可只先顯示label + contribution，展開才看所有欄。
4. 跨站比較圖為選用，不與Top5同時搶第一視線。以水平bar／相同尺度比較，保留Chart.js。

Score規則：

- 保留0.xx推薦排序分數，不改為「79%適合你」，也不任意變100分制。
- 加權分量例：`+0.3000 +0.2500 +0.2400 −0.0000 ≈0.79`。成本0顯示0，不顯示負零；保留四捨五入說明。
- 首位0.79不畫成「百分之百」滿條；若圖以0–1為軸，要註明展示範圍不代表各query可跨次比較，預設理論正項上界是w1+w2+w3=0.85。
- 展示公式要包含norm。沿用引擎負值裁為0、兩位小數與既有排序，不在設計任務變更ties。
- 連結強度100%目前是候選間Min-Max normalized值，不是100%旅客流向本站。文案用「本次候選中連結性較高」，完整值在證據層區分raw與normalized。
- 不把PR稱為即時擁擠程度，也不由高PR推論「穩定」時間序列。偏好80%若保留，旁邊明說站點標籤評分0.8的顯示方式，不是個人喜愛機率。
- data_source/month可先取現有metadata，但標記「使用該月資料，部分指標可能採既有估計」，不能宣稱每站／每維都有real coverage。

State規則：loading、success、empty、partial、error、條件已變更均有明確標題；空結果清除舊圖與metadata，部分結果顯示實際數量，不補假站；錯誤保留查詢並提供retry。完成後把focus移到結果標題，若使用者已主動離開查詢流程則避免突然搶焦點。

## 17. Station detail pattern

保留`/station/:id`，既有deep link可獨立開啟。推薦進入時可帶已驗證的from/time_period/preference與可恢復的結果脈絡；站點本身的id與query的from要分開。

1. 導覽：有推薦上下文時顯示「返回本次推薦」，恢復條件、結果與閱讀位置；獨立進入時是「返回開始推薦」。
2. Header：站名、英文名、各路線代碼、行政區；由既有資料呈現轉乘資訊。
3. 與本次查詢的關係：偏好理由與已知交通負擔；未帶from時不假造距離／時間。
4. 站點特徵：先放現有tag reasons，照使用者偏好把相關內容置前；其他類型是簡單段落／列表。
5. CTA：「改以此站出發」是次要延伸，保留時段與偏好；不能以此取代回到Top5的主路徑。
6. 資料依據：PR各時段、偏好雷達、人流連結，以摘要→圖→資料表的順序出現。

PR文案：「PageRank最高時段」或「熱門時段（依PageRank）」；補上這是相對重要性，不等於最佳遊玩時段。六時段用固定時間順序；非連續取樣不假造即時曲線。

Radar保留五軸0–1、一組站點資料，填色僅用單色低透明度；同時列出五個數值與理由。缺tag需要availability欄位才能顯示「尚無資料」，不能把無資料當真實0。只有既有API時，保守標示評分資訊可能不足。

人流連結：來源→本站與本站→目的地用方向文字／箭頭區別，路線色只標站點。顯示月份、時段、百分比定義。先標出現有outbound afternoon／inbound跨時段取最大值的差異；要統一為同時段真實OD，需另行調整API且解釋用戶看到的變化。

不新增未驗證的出口、票價、步行路徑、店家營業時間、即時擁擠或「開始導航」假功能。

## 18. Desktop behavior

≥1024px：1200px最大寬度，查詢約360–400px在左、地圖在右，間距24；DOM查詢在前，視覺與鍵盤順序一致。短標題／副文後即進工作區，不保留前置四維說明卡。

表單必須在1440×900視窗可見主要controls及CTA；若縮放或高度不足則正常滾動，不強制等高／固定高。Sidebar只有內容可容納時才sticky，sticky top跟導航實高一致。

結果沿主閱讀方向出現在工作區下方，回應完成後移至結果heading。可選用地圖／圖表在旁，但不新增永久第三欄。調整條件在結果summary可達，不必手動長距離捲回頁首。

768–1023px：單欄query為主，地圖為選用展開；不要把縮小桌機12欄硬擠在tablet。

## 19. Mobile behavior

<768px：16px邊距；compact header與短介紹 → 起站input → 時段select → 偏好chips → primary action。「從路線圖選站」為起站旁secondary入口，預設不載入一大塊map佔位。

390×844的目標是未捲動可看見出發站、時段、偏好與主要CTA；320px／大字模式允許自然滾動，不能為硬塞第一屏而縮字／縮hit targets。虛擬鍵盤出現時，候選與選中回饋維持可見，sticky CTA不可遮input、候選或結果。

提交後首屏看見summary與第一站主要理由。Top5直向排列，無橫向滑卡；score表可改逐列或提供明確水平捲動容器，不讓整頁左右拖。

詳情頁先給站名、特徵與返回，不讓PR和radar長圖擋住在地理由。Map專用view的關閉、重設、使用此站皆為44–48px；scroll、pinch與back行為需在iOS Safari／Android Chrome真機驗證。

## 20. Accessibility rules

目標：WCAG 2.2 AA，搭配44px產品hit-area門檻；不能由token表或自動工具單獨宣稱達標。

- 每頁一個h1、main landmark與skip link；階層依內容，不為選字型跳標題級別。
- label與control關聯、radio分組、combobox名稱／值／active option；visible label與accessible name一致。
- 全流程鍵盤可完成；focus永遠可見，sticky導覽／CTA不得遮focus target；dialog Escape關閉並還原focus。
- 預設一般文字≥4.5:1，大字≥3:1；控制邊界與必要圖形≥3:1；disabled雖有標準例外仍維持可辨。
- 行動primary、clear、map controls≥44px。24px是AA minimum且有例外，44px是本案設計規則。
- 顏色之外必有代碼、文字、符號或checked；灰階仍能看懂起站、推薦排名與轉乘。
- 狀態使用role=status或適合的live region，適當aria-busy；錯誤連到field；不把一般loading扮成沒有焦點管理的alertdialog。
- 圖表有可存取名稱、簡短結論與同源表格；數值不得只有hover tooltip。
- 200%文字放大／等效400%頁面reflow檢查；320px下除必要二維map/table外不整頁水平捲動。正式驗收用瀏覽器zoom，不只改viewport。
- 裝飾icon隱藏；外連與新增分頁行為可預期；連結與普通文字有非色彩辨識。
- 中文輸入法、長站名、英文名、缺資料與空列表一起驗收。

依據 [WCAG quick reference](https://www.w3.org/WAI/WCAG22/quickref/)、[WAI complex images](https://www.w3.org/WAI/tutorials/images/complex/)、[Status messages](https://www.w3.org/WAI/WCAG22/Understanding/status-messages.html)；此次audit未做VoiceOver實機驗收。

## 21. Motion rules

Motion只解釋狀態：button color、展開收合、map位置變更。一般150–200ms ease-out；結果不逐張delay、不slide-in，hover不改geometry。

`prefers-reduced-motion: reduce`時：立即顯示結果、移除translate／stagger、使用即時scroll、Chart.js停止非必要animation、spinner換靜態進度符號＋「正在查詢」。不要用全域0.01ms把所有回饋一起消滅。

Map可保留由使用者直接控制的移動；自動飛行／zoom動畫可立即停止。沒有首屏進場編舞、視差、路線流光、呼吸光環或慶祝confetti。

## 22. 明確禁止的 AI-looking patterns

禁止以下作為MetroPulse的預設設計語法：

1. 藍紫／紫粉品牌漸層、綠藍魔法CTA、背景radial glow。
2. decorative gradient surface、glass cards、透明blur navbar與tooltip。
3. 所有區塊皆20px大圓角＋shadow、card-inside-card、每項統計獨立容器。
4. 路線色當裝飾光暈、success色或任意feature分類。
5. emoji代替interface icons、magic-wand／sparkles暗示黑箱AI。
6. 以巨大hero、testimonials、浮動stats將任務介面變SaaS landing。
7. 無資料意義的多色badge、彩虹圖表、把第一名畫成100%信心。
8. 11–12px低對比灰字承擔重要説明；全站過度letter-spacing或display font。
9. 卡片上浮、橫移、stagger、裝飾pulse、load choreography。
10. 一頁淺色工具、一頁crypto風格暗色dashboard的任意切換。
11. 頁面告訴旅客自己的framework、色票、深色模式設計或migration指令。
12. Apple外觀模仿、官方捷運網站clone、泛用Tailwind demo套皮。

允許：有路線／資料語意的純色、數據圖中的單色alpha、具有功能的dialog遮罩、清楚focus ring與原生details。禁止清單不應被用來刪除可解釋資訊。

## 23. 預計修改檔案與相容性邊界

本次實際新增只有兩份文件；以下是**後續implementation的候選檔案**。

| 檔案 | 必要性／後續工作 |
|---|---|
| `src/index.ts` | 必改：query-first DOM、語意表單、state/error/focus、results/detail/analytics hierarchy、來源／單位文案、回到本次結果 |
| `public/static/styles.css` | 必改：沿用mp命名重定tokens、type/spacing/radius、取消gradient/shadow、responsive與motion |
| `public/static/mrt-map.js` | 必改：prefix色彩bug、起站／推薦區別、可達的map interaction、縮放與列表替代，保留現有座標與public方法alias |
| `src/lib/types.ts` | 依需求：補metadata型別與可選的structured reason／travel／availability欄位；統一route colors |
| `src/lib/recommender.ts` | 限定：增加語意明確、無emoji的新UI理由資料；不得變動權重、排序、正規化與缺值策略。保留既有reasons相容性 |
| `src/routes/recommend.ts` | 依需求：相容性輸出來源／coverage或travel欄位，不在UI首輪改變real/synthetic選擇規則 |
| `src/routes/station-detail.ts` | 依需求：來源、tag availability、明確time context；改查真實OD需獨立說明behavior變更 |
| `src/db/queries.ts` | 僅資料一致性另案需要；不得為完成前端視覺順手更換p_ij定義 |
| `README.md` | implementation必改：流程、來源語意、站點筆數口徑、路線／代碼例子、檔案結構與驗證步驟 |
| `package.json`／lockfile | 首輪不需要；只有獨立批准的本地Tailwind編譯／依賴整合階段才動 |
| `public/static/stations-fallback.json` | 純UI不動；若station alias／metadata正式變更，須由原有產生流程同步，不手改資料 |

避免先拆出大型新component layer。若query state仍反覆出錯，可提出小型`QueryState`重構：集中draft/committed/submitted、request identity與URL狀態；先在原檔劃清責任即可，不需要引入React或state library。

## 24. Implementation plan：P0 → P1 → P2

### P0 — UX / accessibility

1. **建立baseline**：保存三頁畫面、API樣例與existing IDs；記錄from/time/preference/top_n與排序。不要覆蓋目前未提交工作。
2. **改query hierarchy與state**：手機query-first、時段select／偏好radio、標準combobox、invalidate舊選站、loading/error/empty完整狀態、結果focus。同步README。
3. **來源與可解釋資訊**：呈現metadata、重寫顯示層單位，保留四維；先揭露既有來源差異，資料修正獨立提交。
4. **詳情回程與可達性**：query context、返回位置、charts摘要／table、對比／hit area／reduced motion，map搜尋替代可用。

驗收：選BL12後改輸入西門不能送出舊BL12；鍵盤完成三輸入並讀到5站；重新查詢為空不殘留圖表；錯誤可retry；detail返回保留night/food；來源月份可見。數值與Top5次序對baseline不變。

### P1 — visual system / hierarchy

5. **套共用tokens與導視排列**：pure surfaces、route badge對比、字級、間距、8/12px圓角與低elevation；分析theme整體一致。
6. **重排results/detail**：站點理由／交通負擔在前，證據按需展開；取消滿條第一名與重複圖表預設；可用資料不足要明示。
7. **改良map interaction**：fix prefix、共站選擇、清楚origin／rank符號；mobile專用view與zoom控制，確認callback同步不變。

驗收：390×844第一屏可查詢；1440×900主CTA可找到；六路線badge白／深字對比正確；不靠顏色也能辨認選中與推薦；預設頁面無裝飾gradient、shadow card群或emoji controls。

### P2 — polish / delight

8. **有用的細節**：記住本次閱讀位置、選中站的短文字回饋、表單與地圖連動；不新增沒有資料支援的「驚喜推薦」功能。
9. **驗證資源載入**：量測font/CDN/Chart啟動與網路失敗，再決定按需載入／Vite編譯CSS；不把推測當優化成果。
10. **Bounded QA**：一次desktop/mobile/keyboard/empty/error批次驗證，集中修正，再一輪確認；最後Impeccable polish + audit記錄改善。

## 25. Validation matrix 與 expected result

| 驗證面 | 情境 | 預期結果 |
|---|---|---|
| 基本回歸 | BL11/BL12/R03/Y20，各時段／偏好代表組合 | 無station ID錯配；Top5、gamma與weights不被UI改動 |
| 表單狀態 | 選站→改字→清除→再次選；IME輸入；Arrow/Escape/Enter | visible query＝submitted query；無誤送、無15次Tab負擔 |
| 多次請求 | 快速變更條件、慢回應先後顛倒 | 舊response不能覆蓋最新submitted query；顯示對應狀態 |
| 異常 | 站點API失敗、fallback、推薦空／部分結果、網路中斷、detail不存在 | 有具體下一步，條件保留，沒有混合新舊圖表 |
| Data explanation | real/synthetic、缺tag、缺travel、不同月份 | 來源／限制準確；不把0、未知、百分比與真實人流混用 |
| 導覽 | results→detail→返回；detail→改以此站出發；URL直接開啟 | 回到正確條件／位置；獨立詳情仍可用 |
| Map | 共站、Y線、推薦高亮、touch/keyboard、關閉／重開 | 正確route stroke；origin與rank可辨；無gesture-only路徑 |
| Responsive | 320/375/390/768/1024/1440；landscape；keyboard打開 | query優先、無整頁overflow、action不遮擋 |
| Accessibility | VoiceOver或NVDA、鍵盤、200%文字／400%reflow、灰階與色覺檢查 | label/checked/status/focus/data alternative可理解 |
| Motion | reduced motion與一般模式 | 不犧牲狀態回饋；reduce無非必要位移／smooth scroll |
| Charts | 項目數、尺度、負成本、單月、缺值、resize／reopen | 圖與表一致、沒有假趨勢、無0尺寸canvas |
| Build | `npm run build`；既有本地preview smoke check | 延續Hono/Vite/Pages/D1；不產生新部署流程 |

此次只寫文件，因此未跑build或更動D1；後續implementation才執行相關build與smoke checks。部署需另有任務授權，沿用既有`npm run deploy`／明確production流程，不在audit中執行。

## 26. 可能影響既有功能的風險

- **DOM重排**：`query-panel`、`station-search`、`recommend-btn`、`results-section`與MRTMap方法是現有JS契約；重排保留ID且不能複製重複ID。
- **state與URL**：保留結果需要明確request快照、返回策略與失效方式；只用history.back會受deep link／重整影響。URL值需驗證，不把任意query拼進HTML。
- **同站多碼**：BL12/R10、BL11/G12、Y轉乘等關係若改映射會影響推薦候選、OD查詢與自站排除；首輪不改資料身份。
- **新數據欄位**：API理由字串、metadata型別、station tags缺值會影響舊consumer；以optional additive欄位過渡，不破壞原API。
- **研究邏輯**：p_ij實際來源、real/synthetic混合、PR rank與best_period需核對；任何計分變化另列what/why/user effect，不混入visual commit。
- **圖表收合與主題**：Chart.js在hidden區域可能需resize，canvas色不會自動跟CSS variable改變；destroy/recreate與同源table都要驗證。
- **mobile map view**：打開／關閉、focus restore、scroll lock、safe area與virtual keyboard互相影響；需真機測試。
- **Tailwind CDN改編譯**：`bg-${c}-50`等runtime class需要映射或safelist；若未處理會讓detail tag失去樣式，因此此項獨立於首輪UI工作。
- **文案承諾**：「為什麼去」只能使用已存在tag reasons；不可憑PR創造最佳遊玩時段、可靠路線時間或店家狀態。
- **工作區現況**：audit開始前已有大量未提交修改。後續patch必須從當時實際檔案重新確認，不能整檔還原到Git版本套設計。

完成定義：旅客無需先理解PageRank或操作地圖就能查詢；能知道五站的差異、資料依據與限制，進出詳情不丟失條件；原有推薦行為與技術棧延續。
