# MetroPulse — Deployment Preflight（Existing Pages Target / Automation / Git Readiness）

日期：2026-09-19
狀態：**Audit only**。未 deploy、未 merge、未 push、未新增自動化、未修改 README／AGENTS.md。

前置閱讀：[final-production-data-gate.md](../data/final-production-data-gate.md)、[production-batch5b-final-backfill.md](../data/production-batch5b-final-backfill.md)。

---

## 4. Existing Pages deployment audit

`npx wrangler pages project list`：

| Project Name | Domain | Git Provider | Last Modified |
|---|---|---|---|
| **metro-go** | metro-go.pages.dev | **No**（Direct Upload，非 Git 整合） | 4 天前 |

**只有這一個 Pages project**，沒有第二個 production hostname。

`npx wrangler pages deployment list --project-name metro-go`：目前所有既有部署（含 4 天前最新一筆 `3d72386f`）皆為 **Environment=Production、Branch=main**，透過 Direct Upload 完成（Source 欄位顯示的短 commit hash 只是 wrangler 附加的本地 git commit 標籤，不是實際 Git 整合觸發的建置）。

### 逐項確認

| 項目 | 結果 | 依據 |
|---|---|---|
| existing Cloudflare Pages project name | `metro-go` | `wrangler pages project list` |
| pages.dev hostname | `metro-go.pages.dev` | 同上 |
| connected Git repository | **無**（Direct Upload，Git Provider=No） | 同上 |
| production branch | `main` | 既有部署歷史全部標記 `Branch=main, Environment=Production` |
| Git integration 或 Direct Upload | **Direct Upload** | 同上 |
| build command | 本地執行 `npm run build`（`vite build`），非 Cloudflare 端自動建置（因無 Git 整合） | `package.json` scripts；`README.md` 部署流程 |
| output directory | `dist`（`wrangler.jsonc` 的 `pages_build_output_dir: "./dist"`，`deploy:prod` 明確傳入 `dist`） | `wrangler.jsonc`、`package.json` |
| production D1 binding | `mrt_rank_db` → `mrt-rank-db`（`database_id=2105f85a-ddb7-4356-9d28-eaf2eeb51842`） | `wrangler.jsonc` |
| R2 binding | **無**（`wrangler.jsonc` 沒有 `r2_buckets` 區塊） | `wrangler.jsonc`；R2 archive 由 `import_od_data.py --archive-to-r2` 透過獨立腳本／wrangler CLI 寫入 `metropulse-raw-od-archive`，屬原始資料備份，**不是** Worker 執行期讀取的 binding |

### 下一次部署是否會更新 metro-go.pages.dev？

**會**。`package.json` 的 `deploy:prod` 指令：

```
npm run build && wrangler pages deploy dist --project-name metro-go --branch main
```

明確指定 `--project-name metro-go --branch main`，與目前唯一存在、且所有既有 production 部署都使用的 project/branch 完全一致；`wrangler.jsonc` 的 `d1_databases` binding 同樣是這次稽核查到的 production database_id，會被下一次部署原樣沿用。**沒有第二個 Pages project、沒有 create new project 的路徑、沒有第二個 production hostname**——下一次執行 `npm run deploy:prod` 會更新既有 `metro-go.pages.dev`，不會建立新網站。

**本項非 blocker。**

---

## 5. Monthly automation audit

檢查結果：

| 機制 | 是否存在 |
|---|---|
| `.github/workflows/*` | **不存在**（repo 沒有 `.github` 目錄） |
| wrangler cron trigger（`wrangler.jsonc` 的 `triggers.crons`） | **不存在** |
| Worker `scheduled()` handler（`src/index.ts` 的 `export default { scheduled }`） | **不存在**（`src/index.ts` 只有 `export default app`，一個 Hono fetch handler，無 `scheduled` 匯出） |
| Cloudflare Workflow schedule | **不存在** |
| 其他 monthly ETL automation | **不存在**——`import_od_data.py`／`materialize_year_range.py`／`materialize_holiday_range.py`／`verify_*_parity.py`／`retention.py` 全部是本地手動執行的 Python CLI 腳本，沒有任何排程器觸發 |

### 目前 monthly data update 狀態：**MANUAL**

每月匯入（下載 CSV → import → R2 archive → parity → materialize → smoke test）完全由人工在本地執行既有腳本鏈完成，沒有任何自動觸發路徑。

### Production 建議（僅建議，未實作）

依使用者偏好的流程設計：

```
1. scheduled availability check   — 定期（如每月 5 號）自動偵測 data.taipei 該月 CSV 是否已發布
2. human approval                 — 通知負責人確認可以匯入（不自動略過）
3. monthly import                 — import_od_data.py --apply-remote
4. R2 archive                     — --archive-to-r2（已是 import 腳本內建選項）
5. parity                         — verify_range_parity.py --remote，6/6 未過則中止並通知
6. year/holiday materialization   — 依已知連假日期表與年度覆蓋狀態，parity 過後才 materialize
7. smoke tests                    — verify_recommend_baseline.py + 月度/年度/連假 API 抽測
```

- 第 1 步（availability check）與第 2 步（human approval）建議用 GitHub Actions `schedule` trigger 或 Cloudflare Cron Trigger 呼叫一個「只檢查、不寫入」的輕量端點／腳本，結果用 issue／通知呈現，等人工核准後才觸發第 3 步起的既有腳本鏈——不建議讓步驟 3 以後在核准前自動執行。
- **明確不建議**把 `retention.py --purge` 放進任何無人審核的自動化排程——`--purge` 應維持人工觸發，`--dry-run` 可以排程但 `--purge` 不行（沿用 temporal-final-gate.md 第 152～163 行既有結論）。

本輪只 audit，未新增任何 workflow 或排程設定。

---

## 6. Git / release readiness

| 項目 | 結果 |
|---|---|
| current branch | `uiux-redesign` |
| uncommitted files | 3 個既有修改（見下）+ 4 個本次會話新增的 untracked docs |
| uiux-redesign 領先 main | 8 個 commit（`git log main..uiux-redesign --oneline`） |
| main 領先 uiux-redesign | **0 個 commit**（`git log uiux-redesign..main --oneline` 為空） |
| merge conflict risk | **無**——main 是 uiux-redesign 的直接祖先，未來 merge 為 fast-forward，不會產生 conflict |
| migrations 是否全部 tracked | ✅ `migrations/0001`～`0007` 全部 `git ls-files` 可見 |
| temporal / production scripts 是否全部 tracked | ⚠️ **多數已 tracked**（`materialize_holiday_range.py`／`verify_holiday_parity.py`／`retention.py`／`verify_recommend_baseline.py` 等），但 **3 個檔案有未提交的工作目錄修改**：`scripts/import_od_data.py`（+43/-0）、`scripts/materialize_year_range.py`（+64/-15，即 year-materialization hotfix 的核心修正：改用 `range_od_flow` 12 個月加總取代整年 `daily_od_flow` 掃描）、`scripts/verify_year_parity.py`（+28/-8，對應的獨立驗證查詢改為按月分批）。這些修正**已在 production 實際跑過並驗證有效**（`year:2025` materialize 成功即用此版本），但**程式碼本身尚未 commit** |
| docs 是否 committed | ⚠️ 4 個 docs 檔案為 untracked：`docs/data/production-holiday-catalog.md`、`docs/data/year-materialization-production-hotfix.md`（Batch 5A 之前即已存在的 untracked 狀態）、`docs/data/production-batch5a-holiday.md`、`docs/data/production-batch5b-final-backfill.md`（本次與上次會話新增）。本輪新增的 `docs/data/final-production-data-gate.md`、`docs/deployment/deployment-preflight.md` 同樣尚未 commit |

### Blocker 判定

**未提交的 `scripts/materialize_year_range.py`／`scripts/verify_year_parity.py` hotfix 是本輪發現的實質 blocker**：目前 production 上實際生效、且已被驗證通過的年度 materialize 邏輯，只存在於工作目錄，尚未進入 git 歷史。若在未 commit 的狀態下切換分支、reset 或任何人 checkout 這個 repo 的乾淨版本，會拿到**尚未修正、會在 remote 大量資料上觸發 Cloudflare code 7500 錯誤**的舊版本。**建議在 merge/deploy 前，先將這 3 個檔案與相關 docs 提交成一個獨立 commit**（本輪未執行，因使用者要求不要 merge/push，commit 與否留待下一輪明確指示）。

不要 merge、不要 push——本輪僅完成上述 readiness 盤點。

---

## 7. Documentation finalization plan（僅列清單，本輪不執行大改）

Deploy 成功後，以下兩份文件需要更新（本輪不動）：

### README.md 需涵蓋

- **current product capabilities**：現有「核心功能」章節需加入 temporal range（月／年／連假／跨年比較）查詢能力，目前只提到月份分析
- **production architecture**：Hono + D1 +（新增）R2 raw archive 的角色說明
- **temporal data model**：`daily_od_flow`（18 個月滾動窗口）／`range_od_flow`／`range_pagerank`／`date_ranges`／`holiday_events` 五表關係，`range_id` 命名規則（`month:YYYY-MM`／`year:YYYY`／`holiday:<event_key>:YYYY`）
- **production data range**：目前 2025-01～2026-08（20 個月）、`year:2025` complete、10 個 holiday range complete 的現況，需隨每次 batch 更新
- **D1 / R2 角色分工**：D1 是唯一查詢路徑（線上服務直接讀 D1，無 R2 binding）；R2 只做原始 CSV 備份／溯源，不參與線上查詢
- **monthly update SOP**：對應第 5 節列出的 7 步流程（目前 MANUAL，非 automated）
- **retention policy**：18 個月滾動窗口、`daily_od_flow` 才會被刪、`range_*`／`date_ranges`／`holiday_events` 永久保留、purge 前必須先 dry-run 並人工確認
- **deployment target**：`metro-go.pages.dev`，Direct Upload（非 Git 整合），`npm run deploy:prod`
- **validation scripts**：`verify_range_parity.py`／`verify_year_parity.py`／`verify_holiday_parity.py`／`verify_recommend_baseline.py`／`backfill_status.py`／`retention.py --dry-run` 的用途與何時執行
- **statistical invariants**：PageRank `pr_value` 總和 ≈1.0、118/118 站不缺、`pr_rank` 完整排列、OD 流量守恆——這些是每次驗證腳本實際檢查的不變量，應寫進文件供未來維運者理解「PASS」的具體含義
- **maintenance / re-import**：`--maintenance-reimport` 的用途（既有月份重新匯入，如 2026-01 legacy 升級案例）與其犧牲單檔原子性、改為核對列數的設計取捨
- **future backlog**：weekend/weekday 分析、custom date range、**Special Overnight Event Analysis**——需明確註記：午夜～清晨（23:00 及 00:00–06:00）不是六時段模型的一般固定推薦時段，目前架構刻意丟棄這段時間；未來若要分析，僅針對官方公告的特殊延長／通宵營運事件（例如跨年夜），且**不修改現有六時段 period architecture**，是獨立於現有模型之外的分析

### AGENTS.md 需涵蓋

- 現有內容聚焦「合成資料＋推薦引擎」時期的架構描述，需補充：temporal/production data 已上線的事實、production D1 是真實資料（非本地開發用的合成/種子資料）、修改 `scripts/` 下任何 import／materialize／verify 腳本時的既有正確性保證（OD 守恆、PageRank 不變量）不可破壞
- 補充「Deployment Rules」段落：明確指出 production 目標是既有 `metro-go` Pages project、Direct Upload、不可新建 project
- 補充：`retention.py --purge` 永遠需要人工觸發，任何未來自動化提案都不應包含無人審核的 purge 路徑

本輪僅列出上述清單，**不修改 README.md 或 AGENTS.md 內容**。

---

## 未變動範圍（明確確認）

- 未 create new Pages project
- 未 create second production hostname
- 未執行任何 deploy
- 未 merge、未 push
- 未新增任何 GitHub Actions workflow 或 cron trigger
- 未修改 README.md／AGENTS.md
