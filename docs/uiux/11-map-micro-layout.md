# MetroPulse v1.1 — MRT Map Micro-layout

日期：2026-09-16

## 本輪範圍

本輪把目前 MRT schematic 視為既定版面，只做 responsive 驗證與地圖檢視工具列微調；沒有再修改站點位置、路線幾何、label offset、hit target 或任何選站語意。

工具列維持「16px inline SVG icon + 文字」而非 icon-only：

- 桌機工具按鈕由一般表單按鈕的 48px 收斂為 40px，高度、padding、文字尺寸與 icon gap 改為較像地圖工具列的密度。
- 手機保留 44px 高觸控目標，三顆按鈕平均分配可用寬度。
- `放大`、`縮小`、`重設全圖` 的可見文字與完整 `aria-label` 均保留。

## Hotspot 檢視

在現有座標與標籤配置不變的前提下，實際檢視：

- 台北車站／中山／忠孝新生中央轉乘區
- 忠孝復興至忠孝敦化
- 台北小巨蛋／南京三民
- 新埔／新埔民生
- 東門／古亭／中正紀念堂南側複雜區

本輪沒有再對上述區域做機械式 detector 修正，也沒有移動 station coordinates。

## Responsive 與互動驗證

| 檢查 | 結果 |
| --- | --- |
| 1440 × 1000 desktop overview | 通過；工具列為 40px 高，16px icon，無頁面水平 overflow |
| 1024 × 900 desktop | 通過；標題與工具列同列仍有足夠間距，無頁面水平 overflow |
| 390 × 844 mobile map mode | 通過；三顆工具按鈕各 44px 高，無頁面水平 overflow，body scroll lock 正常 |
| Zoom | 通過；`viewBox` 由完整路網切換至縮放區域 |
| Reset | 通過；恢復 `-10 0 1140 820` 完整路網 |
| Runtime console | 0 errors；保留既有 Tailwind CDN production warning，非本輪新增 |
| `npm run build` | 通過（37 modules） |

## 視覺判斷依據

依 Impeccable 的 polish / craft-floor 原則，這組控制屬於次要工具列，不應與主要查詢 CTA 同量級；UI UX Pro Max 的通用 responsive 建議則用於確認觸控尺寸與無水平溢位。Metro schematic 的站碼、路線色、轉乘節點與可讀性仍以專案既有設計文件為最高優先，不依通用 detector 機械重排。

## 尚存限制

- 完整路網 overview 必然以較小字級呈現；密集細節仍應搭配 zoom 查看。
- 地圖仍是手工配置的 schematic，沒有自動 label collision engine。
- Tailwind CDN production warning 為既有技術債；本輪未改建置方式。
- 本輪未在實體 iOS／Android 裝置驗證，mobile 結果來自 390px Chromium viewport。
