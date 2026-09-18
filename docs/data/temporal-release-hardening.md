# MetroPulse — Temporal Release Hardening

日期：2026-09-18
狀態：**只處理 temporal-final-audit.md 剩餘 P1，不新增產品功能、不 redesign、未部署 production**
前置閱讀：temporal-final-audit.md、temporal-phase2c-foundation.md、temporal-phase3b-holiday-implementation.md、temporal-phase3b1-holiday-comparison.md（皆已讀畢）。

範圍：只處理 [temporal-final-audit.md](temporal-final-audit.md) 第 2 節列出的四項 P1（自動化 baseline、retention 安全性、remote 驗證、git readiness）。Custom date range 與 Weekend/weekday analysis 明確不在範圍內，未實作。

---

## 1. Automated recommendation baseline

新增 [scripts/verify_recommend_baseline.py](../../scripts/verify_recommend_baseline.py)。

**設計決定：打真正在跑的 `/api/recommend` HTTP 端點，不重新實作計分邏輯。** 與 `verify_range_parity.py`/`verify_year_parity.py`/`verify_holiday_parity.py` 直接查 D1 不同——這支腳本驗證的是「DB → recommender.ts → API 回應」整條路徑，因為分數 regression 最可能來自 API 層或資料層的意外改動，而不是受版本控制與 code review 保護的 `recommender.ts` 本身。

- 內建 `BL11 → night → food` 基準：Top5 依名次比對 station id **與** `total_score`（容忍度 0.005，對應 API 回傳值四捨五入到小數點後兩位），不是只比 id 順序——分數本身的漂移（例如某個維度的 normalize 範圍被意外改變）不會改變排序，但會被分數比對抓到。
- 任一檢查失敗即 non-zero exit；報告寫入 `scripts/output/recommend_baseline_report.json`（gitignored）。
- 已驗證失敗偵測邏輯本身有效：暫時把期望分數改成明顯錯誤的值（僅在記憶體中 monkeypatch，未寫入檔案），確認腳本正確回報 `FAIL` 並以 exit code 1 結束；之後用真實基準重跑確認回到 `PASS`。
- 新增基準只需要在 `BASELINES` 清單多加一筆，不需要改動驗證邏輯——為未來（例如年度／連假的固定 baseline）預留擴充空間，但本次不新增額外基準（避免無中生有創造一個未經人工驗證過的「基準」）。

**本地驗證結果**：`python3 scripts/verify_recommend_baseline.py` 對本地 dev server 執行，五個名次的站點 id 與 total_score 全數 PASS，exit code 0。

---

## 2. Retention safety

### 2.1 問題回顧

Final Audit P1-4 指出：`retention.py` 原本的 `find_unmaterialized_ranges_at_risk()` 對年度的保護，只查詢 `date_ranges` 裡「已經有 `range_type='year'` 狀態列、且 `is_complete=0`」的年度——也就是說，只有「曾經跑過 `materialize_year_range.py`、但當時判定不完整」的年度才會被保護。如果一個年度的月份正在逐步匯入、但從未執行過 materialize（沒有任何理由要對明顯不完整的年度提早跑 materialize），這個年度在 `date_ranges`完全沒有任何記錄可查，retention 的 18 個月保留窗口會在**零警告**的情況下把它的早期月份清掉，永久斷絕這個年度未來被完整化的可能。

### 2.2 修正方式

`find_unmaterialized_ranges_at_risk()`（[scripts/retention.py](../../scripts/retention.py)）不再從 `date_ranges` 既有記錄「回頭查」年度風險，改成**從這次 purge 即將刪除的 `daily_od_flow` 列本身反推受影響的曆年**：

```sql
SELECT y.year, dr.is_complete, dr.start_date, dr.end_date, dr.day_count, dr.expected_day_count, dr.coverage_note
FROM (
  SELECT DISTINCT substr(service_date, 1, 4) as year FROM daily_od_flow
  WHERE service_date < :cutoff
) y
LEFT JOIN date_ranges dr ON dr.range_id = 'year:' || y.year
WHERE dr.is_complete IS NULL OR dr.is_complete = 0
ORDER BY y.year
```

- `LEFT JOIN` 沒有配對到任何列（`dr.is_complete IS NULL`）＝這個年度**從未**被 materialize 過，`date_ranges` 完全沒有記錄——這正是舊版邏輯漏掉的情況，現在會被正確抓出來，訊息明確標示「從未執行過 materialize_year_range.py」。
- `dr.is_complete = 0`＝曾經檢查過但不完整，維持舊版行為，訊息保留 `start_date`/`end_date`/`coverage_note`。
- `dr.is_complete = 1`（已完整、永久保留）的年度**不會**出現在這個清單——已完整的年度不需要、也不應該阻擋 purge，這是既有設計，本次沒有改變。
- Holiday 保護**維持不變**：`holidays_at_risk` 繼續以 `holiday_events` 作為唯一的已知連假名冊，只保護「已登錄但尚未完整 materialize」的事件。**沒有嘗試保護未登錄的連假**——系統沒有辦法知道一個從未 key 進 `holiday_events` 的連假存在，假裝能保護它只會製造錯誤的安全感。這點在 `find_unmaterialized_ranges_at_risk()` 的 docstring 中明確記錄。

### 2.3 驗證

**本地 D1**（既有的 `test-compare` holiday fixture 副作用地提供了現成的「有 daily 資料、但年度從未 materialize」情境：2024/2025/2026 三個年度都只有連假 fixture 的少量日期，且從未跑過 `materialize_year_range.py`）：

| 情境 | 結果 |
|---|---|
| `--dry-run --as-of 2028-06-06`（cutoff 涵蓋 2024/2025/2026） | 正確列出三個「從未執行過 materialize_year_range.py」的年度 + 一個未完整連假 |
| `--purge --as-of 2028-06-06`（不帶 override） | 正確拒絕，exit 1，`daily_od_flow` 864 列不變 |
| `--dry-run`（今天，cutoff 只涵蓋 2024） | 只正確列出 2024（2025/2026 資料仍在窗口內，不受影響）——確認查詢邏輯精準對應「這次 purge 實際會刪除的日期」，不是全表掃描 |
| **負向測試**：手動插入一筆 `2027-03-01` 資料（`year:2027` 是本地既有的完整年度 fixture）並以會涵蓋它的 cutoff 執行 `--dry-run` | `year:2027` **沒有**出現在風險清單——確認已完整的年度不會被誤判為風險、不會過度阻擋 purge。測試資料已清除 |

**Remote（disposable Paid D1）**：見第 3 節，`year:2033`（完整）與 `year:2034`（從未 materialize）兩者在同一次 `--dry-run` 呼叫中分別得到正確結果——完整的不擋、從未 materialize 的被擋。

### 2.4 Production policy（文件化，供維運者遵循）

1. **新月份匯入後何時嘗試 year / holiday materialization**：
   - 每次 `import_od_data.py` 完成一個月份的匯入後，**立即**對該月份所屬的曆年執行一次 `materialize_year_range.py --year <Y>`——即使預期會回報「不完整」也要跑。原因：這個動作本身會在 `date_ranges` 留下一筆 `is_complete=0` 的狀態列，讓這個年度從此**進入 retention 保護範圍**（不再是「從未記錄過」的空窗狀態）。跑一次不完整的 materialize 幾乎零成本（只更新一列狀態，不寫入 `range_*`），但換來的是往後每次 retention purge 前都會被自動檢查。
   - 對每個已知的 `holiday_events` 事件：一旦該連假涵蓋的所有日期都已匯入，應盡快執行 `materialize_holiday_range.py`，讓它從「已登錄但未計算」轉為「永久保留」，不要等到 retention 窗口逼近才處理。
2. **retention 何時執行**：`retention.py` 目前仍是手動工具，沒有排程。建議：在確認每月匯入 + 年度/連假 materialize 流程都已執行之後，每月固定執行一次 `--dry-run` 檢視風險清單；只有在風險清單為空、或清單上的項目已經人工確認可以放棄時，才執行 `--purge`。**不建議**在自動化排程中直接跑 `--purge`（更不用說加上 `--acknowledge-unmaterialized-ranges`）——purge 的最終判斷應該保留人工介入的機會。
3. **holiday metadata 必須在 daily data 被 purge 前登錄**：`holiday_events` 是純人工維護表；一個連假如果在對應的 `daily_od_flow` 被 18 個月保留窗口清掉之前都沒有被登錄，這個連假就永遠無法被 materialize（第 2.2 節保護的前提是「已登錄」）。建議至少提前半年登錄下一屆已知的國定連假日期（政府行事曆通常提前公告），不要等到連假結束後才登錄。

---

## 3. Remote validation

全程使用 disposable Paid D1 資料庫 `metropulse-release-hardening-test`（`database_id=ecede924-ecf4-485e-8d81-c013aa2234f8`），**全程未對 production `mrt-rank-db`（`database_id=2105f85a-...`）執行任何寫入、刪除或 migration 指令**。過程中依循既有 phase 文件的模式，暫時在 `wrangler.jsonc` 加入該 disposable DB 的 binding（`migrations apply` 需要），驗證結束後已確認 `git diff wrangler.jsonc` 為空，disposable DB 已刪除（`wrangler d1 list` 確認只剩 `mrt-rank-db`）。

流程：

1. `wrangler d1 create metropulse-release-hardening-test` → `bootstrap_db.py --remote`（7 個 migration 全部成功，含本次的 0007）。
2. `build_remote_smoke_fixture.py --year 2033 --remote`（compact fixture，17,520 列）→ `materialize_year_range.py --year 2033 --remote`（完整，708 筆 PageRank）→ `verify_year_parity.py --year 2033 --remote` 全部 PASS。
3. **模擬部分 daily data 缺失**：`DELETE FROM daily_od_flow WHERE service_date = '2033-06-15'`（remote，刻意刪除 1 天）。
4. **重跑 materialize**：`materialize_year_range.py --year 2033 --remote` → **正確拒絕**（`[CRITICAL]`，exit 1），`date_ranges.is_complete` 與 `day_count` 維持 `1`/`365` 不變，`range_pagerank` 仍是 708 列——已修正的降級防護（Final Audit P1-1）在 remote 查詢路徑（`_d1_json_query` 走 `wrangler d1 execute --remote`）上與本地行為一致。
5. 對同一個 disposable DB 重複 2-4 的流程，改用 `build_compact_holiday_fixture.py` + `materialize_holiday_range.py` 建立 `holiday:release-hardening-test:2033`（完整，9 天/5 天視 fixture 設定，本次為 5 天）→ 刪除其中 1 天 → 重跑 `materialize_holiday_range.py` → **同樣正確拒絕**，`date_ranges`/`range_pagerank` 不變。
6. **Retention 正／反例對照**（同一個 disposable DB，同一次 `--dry-run` 呼叫可觀察兩種年度並存）：`year:2033`（已完整）不出現在風險清單；額外建立、從未 materialize 的 `year:2034`（`build_remote_smoke_fixture.py --year 2034`）正確出現在風險清單、標示「從未執行過 materialize_year_range.py」。
7. Permanent range／API 在整個模擬過程中持續可查（`date_ranges`/`range_pagerank` 逐次以 `wrangler d1 execute --remote --command` 直接核對，數值全程未受任何一次「拒絕的重跑」影響）。
8. 清理：`wrangler d1 delete metropulse-release-hardening-test -y` → `wrangler d1 list` 確認只剩 `mrt-rank-db` → `wrangler.jsonc` 還原（`git diff wrangler.jsonc` 為空）。

**結論**：Final Audit P1-1（降級防護）與本次 P1-4（retention 年度保護）在 disposable Paid D1 上的行為與本地 D1 完全一致，正向（拒絕降級／拒絕 purge）與負向（不誤擋已完整 range）皆已驗證，production `mrt-rank-db` 全程未被觸碰。

---

## 4. Git readiness

### 4.1 現況

`git status` 顯示的變更可以清楚分成三組，彼此沒有交錯依賴：

| 分組 | 內容 | 狀態 |
|---|---|---|
| A. Phase 3B／3B.1（連假推薦＋跨年比較） | `migrations/0007_holiday_events.sql`、`scripts/materialize_holiday_range.py`、`scripts/verify_holiday_parity.py`、`scripts/build_holiday_fixture.py`、`scripts/build_compact_holiday_fixture.py`、`src/routes/{recommend,analytics,station-detail}.ts`、`src/db/queries.ts`、`src/lib/types.ts`、`src/index.ts`、`public/static/styles.css`、兩份 phase 3B 文件 | 全部 untracked／modified，未 commit |
| B. Final Audit P1 修正（降級防護） | `scripts/import_od_data.py`（`get_existing_range_is_complete()`）、`scripts/materialize_year_range.py`（guard 接線）、`docs/data/temporal-final-audit.md` | 未 commit（`materialize_holiday_range.py` 的對應 guard 是新檔案，從建立時就內建，隨 A 一起進版控，見下方說明） |
| C. Release Hardening（本次） | `scripts/verify_recommend_baseline.py`（新）、`scripts/retention.py`（年度保護修正）、`docs/data/temporal-release-hardening.md`（本文件） | 未 commit |

`migrations/0001`~`0006`、`scripts/bootstrap_db.py`、`scripts/backfill_status.py`、`scripts/build_year_fixture.py`、`scripts/build_remote_smoke_fixture.py`、`scripts/verify_range_parity.py`、`scripts/verify_year_parity.py` 等 Phase 2C／3A 基礎設施**已確認全部 tracked**（`git ls-files` 逐一核對），不在本次待 commit 範圍內。

**一個檔案層級的說明**：`materialize_holiday_range.py` 是 Phase 3B 才新增的檔案，從未有過「沒有降級防護」的已提交版本——它的第一次進版控就已經包含 Final Audit 的 guard（因為 guard 是在檔案存在之後才加的，但檔案本身還沒 commit 過）。因此把它歸進分組 A（隨 Phase 3B 一起 commit）是誠實的做法，commit 訊息會註明這點，不假裝有一個「沒有 guard 的舊版」需要單獨修正。

### 4.2 建議 commit boundaries

1. `feat: add holiday recommendation and cross-year comparison (Phase 3B/3B.1)` — 分組 A 全部檔案。
2. `fix: guard year/holiday range materialization from silently downgrading a completed range` — 分組 B（`import_od_data.py`、`materialize_year_range.py`、`temporal-final-audit.md`），commit message 註明 holiday 側的對應保護已隨 commit 1 一起進版控。
3. `chore: automate recommendation baseline check and close retention gap for unmaterialized years` — 分組 C。

### 4.3 執行結果

環境允許安全 commit（工作目錄乾淨、在 feature branch `uiux-redesign` 上、未涉及任何需要人工複查的密鑰或敏感檔案）。已依上方三個邊界建立三個 commit，**未 push、未 deploy**。commit hash 與訊息見本文件發布時的 `git log` 輸出（下方第 5 節驗證表格之前列出）。

---

## 5. Validation

| 項目 | 結果 |
|---|---|
| `python3 scripts/verify_recommend_baseline.py`（本地 dev server） | PASS，5/5 名次站點 id 與 total_score 皆相符 |
| `npm run build` | 成功，`dist/_worker.js 210.88 kB` |
| `git diff --check` | exit 0 |
| Month（`year=2026&month=1`） | `success:true`，`range_label:2026年1月` |
| Year（`range_type=year&year=2027`） | `success:true`，`range_label:2027年（全年）` |
| Holiday（`range_type=holiday&event_key=lunar-new-year&year=2026`） | `success:true`，`range_label:2026年春節` |
| Holiday Comparison（`event_key=lunar-new-year&station=BL12`） | `success:true`，2026／2027 皆 `status:complete` |
| Retention 正例（已完整年度不誤擋） | 本地＋remote 皆驗證不出現在風險清單 |
| Retention 反例（從未 materialize 的年度） | 本地（2024/2025/2026）＋remote（2034）皆正確擋下 |
| 降級防護（年度／連假） | 本地＋remote 皆驗證重跑後拒絕、`is_complete`/`range_pagerank` 不變 |

---

## 6. 未變動範圍（明確排除）

- 不新增 Custom date range。
- 不新增 Weekend / weekday analysis。
- 未對 production 執行 deploy 或任何 migration／purge。
- 未修改 `src/lib/recommender.ts`／`normalizer.ts`、任何現有計分邏輯。
- 未 push 任何 commit 到遠端。
