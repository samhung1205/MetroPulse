# MetroPulse — Temporal Final Gate

日期：2026-09-18
狀態：**獨立驗證關卡，非新開發**——只重新驗證 temporal-final-audit.md 列出的 P0/P1 是否已全數關閉，判定能否進入 production preparation。不新增功能、不 redesign、不修改 P2、未 deploy。
前置閱讀：[temporal-final-audit.md](temporal-final-audit.md)、[temporal-release-hardening.md](temporal-release-hardening.md)（皆已讀畢）。

方法：對每一項驗收標準**重新產生獨立證據**（不只是重讀先前文件的敘述）——本地 D1 端到端重現、全新建立的 disposable remote Paid D1、即時重跑腳本與 API 呼叫、逐一核對 git 狀態與 commit 內容。

---

## 逐項驗證結果

### 1. `scripts/verify_recommend_baseline.py` PASS

即時重跑：`python3 scripts/verify_recommend_baseline.py`，對本地 dev server 執行。

```
[PASS] success == true
[PASS] data_source == 'real'
[PASS] 回傳至少 5 筆推薦
[PASS] 第 1~5 名站點 id 與 total_score 全部相符
結論：PASS
```

**✅ 通過**（exit code 0）。

### 2. Retention 攔截能力

**測試情境**（本地 D1 既有 fixture 天然提供了所需的三種狀態，未額外偽造資料）：
- `year:2024`／`2025`／`2026`：有 `daily_od_flow` 資料，`date_ranges` 完全沒有對應列（從未 materialize）。
- `holiday:test-compare:2026`：已登錄 `holiday_events`，`date_ranges.is_complete=0`（已知但未完整）。
- `holiday:test-compare:2024`／`2025`、`year:2027`：`is_complete=1`（已完整永久保留），且其日期範圍同樣落在測試用的 purge 窗口內。

即時重跑 `python3 scripts/retention.py --dry-run --as-of 2028-06-06`：

```
⚠️ 偵測到尚未 materialize、且會被這次 purge 波及的 range：
  - 連假 測試比較連假（test-compare:2026）：已登錄 holiday_events，但尚未完整 materialize
  - 年度 year:2024：從未執行過 materialize_year_range.py，date_ranges 沒有任何記錄
  - 年度 year:2025：從未執行過 materialize_year_range.py，date_ranges 沒有任何記錄
  - 年度 year:2026：從未執行過 materialize_year_range.py，date_ranges 沒有任何記錄
```

`test-compare:2024`／`2025`／`year:2027` **沒有**出現在清單中，即使它們的日期範圍同樣落在 purge 窗口內——確認不誤擋已完整 permanent range。

`--purge --as-of 2028-06-06`（不帶 override）：exit code 1，`daily_od_flow` 864 列不變。

**remote 端重複驗證**（見第 4 節）：全新 disposable DB 上，`year:2037`（從未 materialize）被擋、`year:2036`（已完整）不被擋。

**✅ 通過**：能攔截從未 materialize 的年度、已知但未完整的連假，且不誤擋已完整 permanent range。本地與 remote 結果一致。

### 3. 已完整 year / holiday 不會因重新 materialize 被降級

**Year**：`year:2027`（`is_complete=1`／`day_count=365`／`range_pagerank=708` 列）。手動插入一筆殘留日期資料（模擬部分 purge 後殘留）後，即時重跑 `materialize_year_range.py --year 2027 --local`：

```
[CRITICAL] 2027 年目前在 date_ranges 已標記為完整（is_complete=1）...
拒絕寫入：繼續執行會把 date_ranges.is_complete 降級為 0...
```

exit code 1；操作後核對 `date_ranges`（`is_complete=1`／`day_count=365`，未變）與 `range_pagerank`（708 列，未變）。測試資料已清除。

**Holiday**：`holiday:lunar-new-year:2026`（`is_complete=1`／`day_count=9`／`range_pagerank=708` 列），同樣手法測試 `materialize_holiday_range.py`：exit code 1，`[CRITICAL]` 訊息一致，`date_ranges`／`range_pagerank` 皆未變。測試資料已清除。

**✅ 通過**：年度與連假兩條路徑的降級防護皆重新驗證有效。

### 4. Remote Paid D1 hardening smoke test 有效證據

本次**重新建立一個全新的 disposable 資料庫**（`metropulse-final-gate-test`，非沿用先前已刪除的資料庫），獨立取得證據：

1. `wrangler d1 create metropulse-final-gate-test` → `bootstrap_db.py --remote`：7 個 migration 全部成功。
2. `build_remote_smoke_fixture.py --year 2036 --remote`（compact fixture）→ `materialize_year_range.py --year 2036 --remote`：完整年度，708 筆 PageRank。
3. 手動 `DELETE FROM daily_od_flow WHERE service_date='2036-07-01'`（remote）模擬部分 purge。
4. 重跑 `materialize_year_range.py --year 2036 --remote`：**正確拒絕**（`[CRITICAL]`，exit 1）。核對 `date_ranges`（`is_complete=1`／`day_count=366`，未變）與 `range_pagerank`（708 列，未變）。
5. `build_remote_smoke_fixture.py --year 2037 --remote`（未 materialize）→ `retention.py --dry-run --remote --as-of 2039-06-01`：正確列出 `year:2037`（從未 materialize）為風險，`year:2036`（已完整）不在清單中。
6. 清理：`wrangler d1 delete metropulse-final-gate-test -y` → `wrangler d1 list` 確認只剩 `mrt-rank-db`（`file_size` 與先前所有 phase 文件記錄的基準值 9,187,328 bytes 完全相同，證實未曾被任何 temporal migration／匯入觸碰過）→ `wrangler.jsonc` 已還原，`git diff wrangler.jsonc` 為空。

**✅ 通過**：本次獨立重現的證據與 temporal-release-hardening.md 第 3 節先前記錄的結果一致，非單一巧合。

### 5. Phase 3B／3B.1／hardening 所需檔案全部 tracked + committed

`git status --short` 輸出為空（工作目錄乾淨）。逐一 `git ls-files --error-unmatch` 核對以下檔案，全部 `TRACKED`：

`migrations/0007_holiday_events.sql`、`scripts/materialize_holiday_range.py`、`scripts/verify_holiday_parity.py`、`scripts/build_holiday_fixture.py`、`scripts/build_compact_holiday_fixture.py`、`scripts/verify_recommend_baseline.py`、`scripts/import_od_data.py`、`scripts/materialize_year_range.py`、`scripts/retention.py`、`src/routes/{recommend,analytics,station-detail}.ts`、`src/db/queries.ts`、`src/lib/types.ts`、`src/index.ts`、`public/static/styles.css`、`docs/data/temporal-phase3b-holiday-implementation.md`、`docs/data/temporal-phase3b1-holiday-comparison.md`、`docs/data/temporal-final-audit.md`、`docs/data/temporal-release-hardening.md`。

另外核對三個 commit 的**實際內容**（不只是訊息），確認修正真的在 commit 裡而非停留在工作目錄：

```
git log --oneline -3
  4dbf283 chore: automate recommendation baseline check and close retention gap for unmaterialized years
  f9d6c35 fix: guard year/holiday range materialization from silently downgrading a completed range
  be8b655 feat: add holiday recommendation and cross-year comparison (Phase 3B/3B.1)

git show HEAD:scripts/import_od_data.py       | grep -c "def get_existing_range_is_complete"  → 1
git show HEAD:scripts/materialize_year_range.py | grep -c "get_existing_range_is_complete"     → 2
git show HEAD:scripts/materialize_holiday_range.py | grep -c "get_existing_range_is_complete"  → 2
git show HEAD:scripts/retention.py | grep -c "從未執行過 materialize_year_range.py"            → 1
```

**✅ 通過**：所有必要程式與 migration 皆已 tracked 且 commit 內容確實包含修正，未停留在未提交狀態。

### 6. Month / Year / Holiday / Holiday Comparison 主要 API 正常

即時對本地 dev server 呼叫：

| 端點 | 結果 |
|---|---|
| `GET /api/recommend?...&year=2026&month=1` | `success:true`，`range_label:2026年1月` |
| `GET /api/recommend?...&range_type=year&year=2027` | `success:true`，`range_label:2027年（全年）` |
| `GET /api/recommend?...&range_type=holiday&event_key=lunar-new-year&year=2026` | `success:true`，`range_label:2026年春節` |
| `GET /api/analytics/holiday-comparison?event_key=lunar-new-year&station=BL12` | `success:true`，2026／2027 皆 `status:complete` |
| `GET /api/analytics/years` | `success:true`，`[2027]` |
| `GET /api/analytics/holidays` | `success:true`，正確依 event_key 分組且排除不完整年份 |

**✅ 通過**：四個主要 temporal 端點與輔助端點皆正常回應、資料正確。

### 7. `npm run build`

```
✓ 37 modules transformed.
dist/_worker.js  210.88 kB
✓ built in 127ms
```

**✅ 通過**。

### 8. `git diff --check`

```
exit code 0
```

**✅ 通過**（工作目錄乾淨，無待檢查差異；三個 commit 各自建立時也逐一驗證過 `diff --check`）。

---

## 額外確認

- **`recommender`／`normalizer` semantics 未變**：`git diff main...HEAD -- src/lib/recommender.ts src/lib/normalizer.ts` 只有一行 header 註解變更（品牌名稱從「MRT Rank」改為「MetroPulse」，屬於更早的 UI/UX redesign commit，與 temporal 工作無關），無任何計分邏輯改動；工作目錄對這兩個檔案也沒有未提交差異。
- **Custom Range 不在 v1**：`grep -rn "range_type.*custom\|'custom'" src/routes/ src/index.ts` 無任何符合，確認路由層完全沒有實作 custom range 的參數處理或計算路徑。
- **Weekend / weekday 留 future backlog**：`grep -rin "weekend\|weekday" src/` 無任何符合，確認未實作；已記錄在 temporal-final-audit.md 與 temporal-release-hardening.md 的 future backlog 段落。
- **Production `mrt-rank-db` 尚未被 migration／deploy**：`wrangler d1 list` 顯示 `mrt-rank-db`（`database_id=2105f85a-...`）的 `file_size` 為 **9,187,328 bytes**，與 Phase 2C 文件記錄的「空 schema＋seed 資料（無任何 temporal migration）」基準值**完全相同**——確認 migrations 0004~0007（daily_od_flow／date_ranges／range_*／holiday_events）從未被套用到 production；本次與先前所有 phase 的 remote 驗證皆只在 disposable 資料庫上執行，且每次都已核對刪除、`wrangler.jsonc` 已還原。`npm run deploy`／`wrangler pages deploy` 全程未被執行。

---

## 結論

**READY FOR PRODUCTION PREPARATION**

temporal-final-audit.md 列出的四項 P1（自動化 baseline、retention 年度保護缺口、降級防護、git readiness）與其驗收條件，本次全數用獨立重新產生的證據（本地重現 + 全新 disposable remote D1 + 即時 API／build／git 檢查）確認關閉，沒有發現殘留或新增的 P0/P1。

## Production preparation checklist

以下項目屬於部署前的人工／維運決策，不是程式碼缺陷，本次稽核範圍內不代為執行（沿用 temporal-final-audit.md 第 7 節與 temporal-release-hardening.md 第 2.4 節的既有記錄，本次確認仍然適用、未過時）：

1. **確認 Cloudflare 帳號方案**：18 個月 `daily_od_flow` 保留窗口的儲存投影（穩態 ≈5.4GB）需要 Workers Paid plan；Free tier 會在數個月內撞到 500MB 上限。
2. **在 production D1 上執行官方 bootstrap 流程**（`bootstrap_db.py`），套用 migrations 0001~0007；不要手動複製本地 `.sqlite` 或本次驗證用的測試資料。
3. **人工登錄 production 用的 `holiday_events`**（春節、端午、國慶等），每一列 `source` 欄位需可追溯官方公告；不可沿用測試 fixture（`test-compare`／`test-holiday` 等）。
4. **決定並文件化 materialize 排程政策**：新月份匯入後立即嘗試該曆年的 `materialize_year_range.py`（即使預期不完整），讓年度從一開始就進入 retention 保護範圍；已知連假應在涵蓋日期匯入完成後盡快 materialize。
5. **決定 retention.py 的執行排程**（誰、多常執行 `--dry-run`／`--purge`）；不建議把 `--purge` 直接放進無人審核的自動化排程。
6. **建議（非阻塞）**：在正式 CI 或部署前檢查清單中加入 `python3 scripts/verify_recommend_baseline.py` 一步，讓分數 regression 檢查成為例行流程的一部分，而不是只在稽核時才手動執行。
7. **P2 待改善清單**（temporal-final-audit.md 第 6 節）維持原狀、未在本輪處理，可於上線後排入後續改善。

## 未變動範圍（本次明確排除）

- 未新增功能、未 redesign。
- 未修改任何 P2 項目。
- 未新增 Custom date range 或 Weekend/weekday analysis。
- 未對 production `mrt-rank-db` 執行 migration、purge 或任何寫入。
- 未執行 `npm run deploy` 或任何部署動作。
