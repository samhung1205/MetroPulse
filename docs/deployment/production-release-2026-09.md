# MetroPulse — Production Release (2026-09)

日期：2026-09-19
狀態：**RELEASE COMPLETE**。`main` 已 merge、push，`metro-go` Pages project 已部署最新版本，public smoke test 全數通過，README／AGENTS.md 已更新（README 已 commit+push；AGENTS.md 為本 repo 既有慣例的 gitignored 本地檔案，已更新但不進版控）。

前置閱讀：[production-retention-purge-2026-09.md](../data/production-retention-purge-2026-09.md)、[deployment-preflight.md](deployment-preflight.md)、[final-production-data-gate.md](../data/final-production-data-gate.md)。

---

## 1. Release commit / merge

- **Precheck**：`uiux-redesign` working tree clean、`npm run build` PASS、`git diff --check` exit 0、`main` 為 `uiux-redesign` 的直接祖先（可 fast-forward）。
- **Fast-forward merge**（`uiux-redesign` → local `main`）：`1ac6589..7aa1a88`。
- **意外發現並解決的 divergence**：`origin/main` 領先本地 `main` 一個先前直接推上 GitHub 的 commit（`53a6929 docs: align station count with public data`，2026-08-29），與 `uiux-redesign` 的 README 改動在同一段落產生真實 conflict。依你的指示，以合併 commit（非 force push）解決，兩處衝突皆保留 `uiux-redesign` 的內容（已用更完整、非硬編碼的描述取代舊版寫死站數的問題本身）。
- **Merge commit**：`1899783 merge: reconcile origin/main station-count doc fix into release`。
- **Push 到 `origin/main`**：`53a6929..1899783`（非 force push，一般 fast-forward-of-merge push）。

---

## 2. Deployment result

```
npm run deploy:prod
→ wrangler pages deploy dist --project-name metro-go --branch main
```

| 項目 | 值 |
|---|---|
| Pages project | `metro-go`（既有 project，未建立新 project） |
| Deployment ID | `15e4c975-01f0-433f-a7a2-151775c5be0b` |
| Environment | Production |
| Branch | `main` |
| Source commit | `1899783` |
| 部署快照 URL | `https://15e4c975.metro-go.pages.dev` |
| 正式網址（永遠指向最新 Production） | `https://metro-go.pages.dev` |

`wrangler pages project list` 確認帳號下**只有這一個** Pages project，`metro-go.pages.dev` 是唯一的 project domain。`wrangler.jsonc` 的 D1 binding（`mrt_rank_db` → `mrt-rank-db`，`database_id=2105f85a-...`）與部署前完全相同，未新增 R2 binding，未產生第二個 production hostname。

---

## 3. Public post-deploy smoke result

### 首頁 / UI

- `https://metro-go.pages.dev/` 直接載入，HTTP 200，無 console error。
- 首頁「資料範圍」月份下拉選單完整列出 2025年1月～2026年8月（20 個月），與 production 實際覆蓋範圍一致。
- Mobile viewport（375×812）版面正常堆疊，無破版、無溢出。

### Production API

| 測試 | 結果 |
|---|---|
| 最新月份（無 year/month 參數，取最新已匯入月份） | ✅ `success:true`，`data_year:2026`，`data_month_num:8` |
| `month:2025-01`（daily 明細已被 retention 清除） | ✅ `success:true`，`range_label:2025年1月`——證明 purge 不影響永久聚合 |
| `year:2025` | ✅ `success:true`，`is_complete:true` |
| `holiday:lunar-new-year:2025` | ✅ `success:true`，`range_label:2025年春節`，`is_complete:true` |
| `holiday:dragon-boat:2026` | ✅ `success:true`，`range_label:2026年端午節`，`is_complete:true` |
| `holiday-comparison`（`lunar-new-year`，2025 vs 2026） | ✅ `success:true`，兩年皆 `status:complete` |
| `year:2026`（應被拒絕，不可視為 complete） | ✅ 正確回傳 `success:false`，`"找不到 2026 年的旅運資料"`——未被當成完整年度 |

全部回應皆 `data_source:real`，temporal metadata（`range_label`／`range_type`／`is_complete`／日期範圍）正確，無 console／runtime critical error。

---

## 4. README / AGENTS update

- **README.md**：新增「生產環境與資料維運」章節（temporal 五表模型、D1/R2 分工、目前資料涵蓋範圍與連假支援狀態、monthly SOP、retention 流程、驗證腳本一覽、正確性不變量）；核心功能新增 temporal range 查詢與跨年連假比較；API 文件補上 `range_type`／`event_key` 參數與新端點；未來擴充新增 weekend/weekday、custom range、Special Overnight Event Analysis（含跨年凌晨時段註記）；部署章節新增「唯一 production project」的明確限制。已 commit + push。
- **AGENTS.md**：新增 Production Data & Temporal Architecture、Retention & Purge Rules、R2 Archive Role、Monthly Maintenance SOP、Overnight Time Window 等章節，內容與 README 同步。**此檔案在本 repo `.gitignore` 中被列為本地專用檔案**（與 `SKILL.md`／`PROJECT_CONTEXT.md`／`TASK_TEMPLATE.md` 同一類），本輪修改已寫入磁碟但依既有慣例不進版控、不會出現在 commit 或 push 中。

---

## 5. Final release audit

| 檢查 | 結果 |
|---|---|
| `origin/main` == local `main` | ✅ 皆為 `1b9d42e` |
| working tree clean | ✅ |
| `npm run build` | ✅ PASS（`dist/_worker.js 210.88 kB`） |
| `metro-go.pages.dev` | ✅ HTTP 200，功能正常 |
| production API | ✅ 全數 PASS（見第 3 節） |
| README 已更新並 push | ✅ |
| AGENTS.md 已更新（本地，依慣例不進版控） | ✅ |
| 新 Pages project | ❌ 未建立（仍只有 `metro-go` 一個） |
| production D1 / R2 binding 是否被意外更改 | ❌ 未變更（`wrangler.jsonc` 與部署前逐位元組相同） |

---

## 目前資料涵蓋範圍（release 當下快照）

- 逐日粒度：2025-03-19 ～ 2026-08-31（18 個月滾動窗口內）。
- `year:2025`：完整。`year:2026`：不完整（僅 1～8 月），API 正確拒絕。
- 連假：2025 全部 6 個（春節／228／兒童清明／端午／中秋／國慶）皆完整；2026 已完整 4 個（春節／228／兒童清明／端午），中秋／國慶僅登錄 metadata，等待 2026-09／2026-10 資料。

## Retention 狀態

已完成本 repo 第一次 production retention purge（見 [production-retention-purge-2026-09.md](../data/production-retention-purge-2026-09.md)）：`daily_od_flow` 2025-01-01～2025-03-18 的 4,739,203 列已依 18 個月滾動窗口政策清除，永久聚合（`range_od_flow`／`range_pagerank`／`date_ranges`／`holiday_events`）完全不受影響。下次 purge 前仍須依既有流程（dry-run → 人工複核 → 取得新的 Time Travel bookmark → 分批 purge）執行。

## 已知待辦（未來 batch）

- `mid-autumn:2026`（需 2026-09 資料）、`national-day:2026`（需 2026-10 資料）——metadata 已登錄，等待月份資料到齊後 materialize。
- `year:2026` 需等 2026-12 全年資料到齊才可 materialize。
- Monthly 更新目前為**人工執行**，尚無排程自動化（見 README「Monthly 更新 SOP」的建議方向，本輪未實作）。
- Weekend/weekday 分析、custom date range、Special Overnight Event Analysis 皆為 future backlog，未實作。

## Monthly maintenance 狀態

**MANUAL**——無 `.github/workflows`、無 wrangler cron trigger、無 Worker `scheduled()` handler、無其他排程機制。下一次月份匯入（2026-09）需依 README「Monthly 更新 SOP」人工執行。
