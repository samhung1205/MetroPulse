# MetroPulse — Production Data Preparation

日期：2026-09-18
狀態：**Inventory ＋ 正式資料規劃 ＋ disposable dry run**，未對 production `mrt-rank-db` 寫入、未部署網站、未修改推薦演算法、未新增功能。
前置閱讀：[temporal-final-gate.md](temporal-final-gate.md)、[temporal-release-hardening.md](temporal-release-hardening.md)、[temporal-phase2c-foundation.md](temporal-phase2c-foundation.md)、README.md、`scripts/import_od_data.py`／`bootstrap_db.py`／`backfill_status.py`。

Temporal Final Gate 已 PASS（見 temporal-final-gate.md）。本文件是下一階段：確認「真的能不能用真實資料把 production 準備好」，方法是（1）對公開資料源做即時 inventory（2）用可追溯官方來源規劃 holiday metadata（3）在**全新 disposable Paid D1**上，用「實際準備上 production 的流程」演練一次真實月份的完整匯入（4）收斂成明確的 production 執行順序與維運政策。

---

## 1. Available real-data inventory

### 1.1 來源與探測方法

資料來源：`http://tcgmetro.blob.core.windows.net/stationod/臺北捷運每日分時各站OD流量統計資料_YYYYMM.csv`（[臺北捷運每日分時各站OD流量統計](https://data.taipei/dataset/detail?id=63f31c7e-7fc3-418b-bd82-b95158755b4d)，公開）。

本次對來源伺服器逐月發出 HTTP `HEAD` 請求（不下載內容，只取 `Content-Length`/`Last-Modified`），即時探測目前實際可下載的月份範圍，而不是憑記憶或文件記錄猜測。

### 1.2 確認可下載月份（2023-01 ~ 2026-08，共 44 個月，全部即時 HEAD 驗證 200 OK）

| 年月 | Content-Length | Last-Modified（來源更新時間） | 目前狀態 |
|---|---:|---|---|
| 2023-01 ~ 2023-12 | 296M ~ 336M | 2023-02 ~ 2024-01 | 可下載，尚未匯入任何 D1 |
| 2024-01 ~ 2024-12 | 286M ~ 308M | 2024-02 ~ 2025-01 | 可下載，尚未匯入任何 D1 |
| 2025-01 ~ 2025-12 | 276M ~ 308M | 2025-02 ~ 2026-01 | 可下載，尚未匯入任何 D1 |
| **2026-01** | 305,559,351 bytes | 2026-02-10 | **已在本地 dev D1 匯入（真實資料）＋已封存至 R2**（`raw/202601/od_202601_74d2374f526e0ab0.csv`，checksum 已比對相符） |
| 2026-02 ~ 2026-07 | 276M ~ 306M | 2026-03 ~ 2026-08 | 可下載，尚未匯入任何 D1 |
| **2026-08** | 312,474,694 bytes | 2026-09-13 | **本次 disposable rehearsal 已完整匯入＋驗證＋已封存至 R2**（`raw/202608/od_202608_fa17140855d4984e.csv`，checksum 已比對相符）——見第 4 節 |
| 2026-09 | — | — | `404`，尚未發布（符合「約月底後 10-15 天發布」的既有規律，預期 2026 年 10 月中旬左右上線） |

補充探測：2020-01、2021-01、2022-01/06/12 皆回傳 `200`，確認來源實際保有的歷史深度**至少回溯到 2020 年 1 月**（未逐月探測 2020~2022 全部月份，因為 v1 production 不需要涵蓋這麼深的歷史，見第 3.3 節的建議範圍）。

### 1.3 目前任何 D1（含 production）的實際匯入狀態

| 位置 | 已匯入的真實月份 | 備註 |
|---|---|---|
| production `mrt-rank-db` | **無** | `file_size=9,187,328 bytes`，與 Phase 2C 記錄的「空 schema＋seed 資料」基準值逐位元組相同，確認 migrations 0004~0007 與任何月份資料皆未曾寫入 |
| 本地開發 D1（`.wrangler/state`） | 2026-01（真實） | 另有 2025-11 是 Phase 1 手寫 SQL 灌入的**合成測試月份，不是真實資料**（見 1.4 節） |
| Cloudflare R2（`metropulse-raw-od-archive`，真實 bucket，非 disposable） | 2026-01、2026-08（皆真實，checksum 已驗證） | 本次 rehearsal 新增 2026-08 的封存，是**永久、非拋棄式**的產出（詳見第 4 節） |
| Disposable rehearsal D1（`metropulse-prod-dryrun`） | 2026-08（真實，已驗證，已刪除） | 見第 4 節，資料庫本身已刪除，證據保留在本文件與 R2 |

### 1.4 明確排除：本地 fixture／synthetic 月份與年度

以下**不是**真實資料，本次 inventory 不把它們算進「可用真實月份」，production 規劃也不會用它們：

- `data_months` 裡的 `2025-11`：Phase 1 用「複製 2026-01 資料、依 period 乘上不同係數」手寫 SQL 灌入的**測試月份**，用途是驗證「指定月份查詢」邏輯，不代表 2025 年 11 月的真實旅運量。
- `date_ranges` 裡的合成年度 `year:2027`／`year:2028`／`year:2029`／`year:2031`：Phase 3A/3A.1 用 `build_year_fixture.py` 依模板與倍率生成的**合成逐日資料**，用途是驗證年度 completeness／PageRank 管線，不是任何真實年份的觀測值。
- 本地開發 D1 現有 daily_od_flow 中屬於 2024/2025/2026 六月的少量列：來自 `build_compact_holiday_fixture.py` 的**連假比較功能測試 fixture**（`test-compare`），同樣不是真實資料。

---

## 2. Production holiday metadata plan

### 2.1 規則

只納入「有明確產品價值、日期邊界有可靠來源、source 欄位可追溯」的連假。本次**不**自行推算或沿用任何本地測試 fixture 的日期——即使某個測試 fixture 的日期恰好與真實日期相符（例如本地 `lunar-new-year:2026` 剛好是 2026-02-14~22），production 仍然必須用一筆全新、附正式來源的列重新登錄，不可延用測試列（本地測試列的 `source` 欄位本來就明確標示「本地測試 fixture，非官方公告」，見 1.4 節）。

### 2.2 春節（Lunar New Year）日期研究：v1 只登錄 2025／2026

理由：MetroPulse 的連假比較功能從 Phase 3B 起就以春節為範例，是台灣旅運模式變化最劇烈、最具產品說明力的連假（多日、跨區、長途探親／旅遊模式明顯不同於平日通勤）。以下日期已用**兩個獨立來源交叉核對**（行政院人事行政總處官方公告頁面 + 至少一個第三方行事曆網站逐字複誦同一份官方公告）：

| event_key | year | 起訖日期 | 天數 | 對應需匯入月份 | 官方來源 | **v1 production 範圍** |
|---|---:|---|---:|---|---|---|
| lunar-new-year | 2023 | 2023-01-20 ～ 2023-01-29 | 10 | 2023-01 | 行政院人事行政總處 中華民國112年（西元2023年）政府行政機關辦公日曆表 | ❌ 不在 v1，見 2.2.1 節 |
| lunar-new-year | 2024 | 2024-02-08 ～ 2024-02-14 | 7 | 2024-02 | 行政院人事行政總處 中華民國113年（西元2024年）政府行政機關辦公日曆表 | ❌ 不在 v1，見 2.2.1 節 |
| lunar-new-year | 2025 | 2025-01-25 ～ 2025-02-02 | 9 | 2025-01、2025-02 | 行政院人事行政總處 中華民國114年（西元2025年）政府行政機關辦公日曆表 | ✅ **v1 production**（正式確認，見 docs/data/production-initialization-runbook.md） |
| lunar-new-year | 2026 | 2026-02-14 ～ 2026-02-22 | 9 | 2026-02 | 行政院人事行政總處 中華民國115年（西元2026年）政府行政機關辦公日曆表 | ✅ **v1 production**（正式確認，見 docs/data/production-initialization-runbook.md） |

官方公告頁面（`source` 欄位建議引用的網址）：
- 112年：https://www.dgpa.gov.tw/information?uid=82&pid=11011
- 113年：https://www.dgpa.gov.tw/information?uid=82&pid=11398
- 114年：https://www.dgpa.gov.tw/information?uid=82&pid=11972
- 115年：https://www.dgpa.gov.tw/information?uid=41&pid=12573

**重要限制，誠實記錄**：官方公告本體是圖檔／PDF／Excel，本次工具只能取得頁面文字結構，無法直接讀出表格內的逐日儲存格數字；上表日期是透過**搜尋引擎結果與至少一個第三方行事曆網站的文字敘述**交叉比對得出，兩個獨立管道對每一年份的日期與天數描述都一致。**日期必須在實際 production insert 前，由人工從 DGPA 官方 PDF／Excel 再確認一次**——這是 production initialization runbook 明確列出的 stop condition，不會因為「查起來很像對」就跳過這一步；2024 年尤其需要複核（來源網頁摘要一度出現格式混亂，本文件已改用另一個獨立網站重新確認過一次，但仍建議雙重確認）。

#### 2.2.1 v1 只登錄 2025／2026 的理由——不宣稱支援 2023／2024 春節比較

**Production Preflight 修正**：v1 initial backfill 範圍正式定為 **2025-01 ～ 2026-08**（見 3.3 節），這個範圍**不涵蓋** 2023-01 與 2024-02，因此 `holiday_events` 的 v1 production 內容**只登錄 2025 與 2026 兩筆**——2023／2024 春節的日期研究已經做完（上表仍保留供未來參考），但**不會**在 v1 insert，因為對應的月份資料根本不在 v1 backfill 範圍內，登錄一筆永遠無法 materialize 完整的 holiday range 沒有意義。2023／2024 的春節（以及任何依賴它們的跨年比較）明確留給 **future backfill**（見 3.3 節），不是 v1 的一部分。

### 2.3 明確不納入本輪：其他連假類型

端午、中秋、國慶、清明等其他連假**本次未驗證日期，不建議現在登錄**——不是因為沒有產品價值，而是本次時間範圍內只完整驗證了春節（優先度最高、跨年比較意義最大）。如果之後要擴充，流程與本節完全相同：查 DGPA 官方公告 → 至少兩個獨立來源交叉核對 → 人工下載官方原始檔複核 → 才登錄 `source` 可追溯的列。**不要**為了湊清單數量，用未經此流程驗證的日期硬編碼。

### 2.4 測試資料禁止清單（再次明確列出）

以下 `event_key`／`year` 組合**一律不得**出現在 production `holiday_events`：`lunar-new-year:2026`／`lunar-new-year:2027`（本地測試列，即使 2026 日期恰好正確，仍是合成 OD 資料，且 source 欄位已自我標示為測試）、`test-compare:2024/2025/2026`、`test-holiday:2030/2031`。Production 的 `lunar-new-year:2025`／`lunar-new-year:2026` 必須是本文件 2.2 節這兩筆全新、附正式來源的列，不是本地那筆的複製。

---

## 3. Production bootstrap plan

### 3.1 標準流程（已在第 4 節的 disposable rehearsal 完整演練過一次，逐字相同的指令）

```
1. bootstrap_db.py --remote --db-name mrt-rank-db
   → migrations 0001~0007 全部套用成功，136 個站點就緒

2. 對選定的初始月份範圍，逐月執行：
   import_od_data.py --year Y --month M --apply-remote --db-name mrt-rank-db --archive-to-r2
   → 每個月同時完成：下載真實 CSV → 寫入 real_od_flow/real_pagerank（既有月度管線）
     → 寫入 daily_od_flow（逐日粒度）→ 聚合寫入 range_od_flow/range_pagerank（range_type=month）
     → 原始 CSV 封存至 R2（metropulse-raw-od-archive）→ manifest 產生

3. 每個曆年只要當年至少已有 1 個月資料，就嘗試：
   materialize_year_range.py --year Y --remote --db-name mrt-rank-db
   → 尚未滿 12 個月會正確回報「不完整」，不寫入 range_od_flow/range_pagerank（不是失敗，是預期狀態，
     見第 5 節 operational policy）；等到該年 1~12 月全數匯入完成後重跑，才會轉為完整

4. 對第 2 節登錄的每個 holiday_events 列，待其涵蓋月份匯入完成後執行：
   materialize_holiday_range.py --event-key lunar-new-year --year Y --remote --db-name mrt-rank-db

5. 每次匯入後執行驗證：
   verify_range_parity.py --year Y --month M --remote --db-name mrt-rank-db
   verify_recommend_baseline.py --base-url <暫時指向這個資料庫的 preview URL>
```

### 3.2 禁止事項（本次規劃與本文件皆嚴格遵守）

- **不複製本地 `.sqlite`**：production 的每一筆資料都必須是這套官方流程產生的，不是把本地開發資料庫的檔案搬過去（本地混有大量測試 fixture，見 1.4／2.4 節）。
- **不匯入 fixture 年份**：`build_year_fixture.py`／`build_holiday_fixture.py`／`build_compact_holiday_fixture.py`／`build_remote_smoke_fixture.py` 產生的任何資料只能用在 disposable 測試資料庫，不得指向 `mrt-rank-db`（`--db-name` 參數的說明文字本身就已經寫死「維運驗證／演練時應明確指定一個可拋棄的測試資料庫名稱，不要用預設值對正式庫做實驗」）。
- **不登錄 test holiday metadata**：見 2.4 節。

### 3.3 v1 initial backfill 範圍：**正式確認為 2025-01 ～ 2026-08（20 個月）**

**Production Preflight 已正式決定**（不再是建議中的選項）：v1 initial backfill = **2025-01 ～ 2026-08，共 20 個月**。理由：2025 全年（1~12 月）匯入完成後 `year:2025` 可以完整 materialize，是 v1 唯一會被完整 materialize 的年度；20 個月的量級也對齊 18 個月 rolling retention window。詳細逐月執行順序（分 5 個 batch，每批驗證後才繼續）見 [production-initialization-runbook.md](production-initialization-runbook.md)。

**v1 明確不涵蓋、也不宣稱支援**：
- **不涵蓋 2023-01 ～ 2024-12**（24 個月）——2023／2024 春節、2023／2024 年度皆**不在** v1 range 內，v1 上線後**不得宣稱**「支援 2023～2026 春節連假比較」；跨年比較功能在 v1 上線時只有 2025／2026 兩個年份可用（見 2.2.1 節）。
- 2023／2024 的 backfill（若之後決定要做）明確列為 **future backfill**，需要另一輪獨立的執行與驗證，本文件與 runbook 皆不假設它會自動發生。

下表保留原本評估過的其他範圍選項，供未來擴充 backfill 時參考（**非 v1 決定**）：

| 方案（非 v1，供未來參考） | 涵蓋月份 | 月數 | 說明 |
|---|---|---:|---|
| 最小可行（未採用） | 2025-08 ～ 2026-08 | 13 | 立刻可用，但不足以組成完整曆年；v1 已改採更完整的 20 個月方案 |
| **v1 正式範圍** | **2025-01 ～ 2026-08** | **20** | **本節已確認，唯一 v1 執行範圍** |
| 完整歷史（future backfill） | 2023-01 ～ 2026-08 | 44 | 來源實際可下載的完整範圍；成本高（44 次 × 約 3~4 分鐘/月），可支援 2023~2026 四年春節比較，但明確排除在 v1 之外 |

---

## 4. Disposable dry run（已完成，使用真實 2026-08 資料）

全程使用 disposable Paid D1 `metropulse-prod-dryrun`（`database_id=8b3bc4b3-705a-401d-8d65-2b3cbd2b3d6a`，已刪除）。**production `mrt-rank-db` 全程未被寫入**（每一步前後皆用 `wrangler d1 list` 核對其 `file_size` 維持 9,187,328 bytes 不變）。

### 4.1 步驟與結果

1. **建立＋bootstrap**：`wrangler d1 create metropulse-prod-dryrun` → `bootstrap_db.py --remote --db-name metropulse-prod-dryrun`。7 個 migration 全部成功，136 站點就緒。
2. **匯入真實月份（2026-08，來源目前最新可下載月份）**：
   ```
   import_od_data.py --year 2026 --month 8 --apply-remote \
     --db-name metropulse-prod-dryrun --archive-to-r2 --verbose
   ```
   實測結果：下載 312,474,694 bytes（與伺服器 `Content-Length` 相符）→ 解析 8,515,080 行、成功對應 4,425,196 行（涵蓋 2026-08-01~31，31 天無缺口）→ 產生 `daily_od_flow` 1,932,829 列、`range_od_flow` 72,433 列、`range_pagerank` 708 列 → **R2 封存成功**（`r2_upload_status: "success"`，物件 `raw/202608/od_202608_fa17140855d4984e.csv`）→ 寫入 D1（77,161 條 SQL 陳述式，8,243,308 列寫入，耗時 109.4 秒）。Manifest 完整（`bytes_read_matches_content_length: true`，checksum 已計算）。
3. **R01（廣慈/奉天宮，2026-08-30 通車）驗證**：直接查詢 `real_pagerank WHERE station_id='R01'`，確認 6 個時段皆有真實 PR 值（例如 `pr_value` 範圍 0.00153~0.00243）——證實新站真實資料正確被涵蓋，不是空的。
4. **Parity 驗證**：`verify_range_parity.py --year 2026 --month 8 --remote` 六項全部 **PASS**（OD 總量守恆、71,433 筆 OD pair 逐筆比對、708 筆 PageRank 全站逐筆比對，最大絕對／相對誤差皆 `0.000e+00`）。
5. **年度 materialize 嘗試**（預期不完整，驗證誠實回報）：`materialize_year_range.py --year 2026 --remote` → 正確回報「31/365 天，不完整」，**沒有**寫入 `range_od_flow`/`range_pagerank`，`date_ranges` 只更新狀態列——符合預期，不是失敗。
6. **Holiday metadata 登錄 + materialize 嘗試**（用第 2.2 節真實、附官方來源的春節 2026 資料列）：
   ```sql
   INSERT INTO holiday_events (event_key, year, name_zh, start_date, end_date, source, updated_at)
   VALUES ('lunar-new-year', 2026, '春節', '2026-02-14', '2026-02-22',
           '行政院人事行政總處 中華民國115年（西元2026年）政府行政機關辦公日曆表', '2026-09-18T00:00:00');
   ```
   `materialize_holiday_range.py --event-key lunar-new-year --year 2026 --remote` → 正確找到已登錄的事件、正確查出涵蓋範圍 0/9 天（因為只匯入了 8 月，2 月資料還沒進來）、正確不寫入 `range_*`——證實 holiday metadata 登錄機制對真實、附來源的資料運作正常，只是這次演練資料量本來就不足以完整化（預期中的狀態，不是缺陷）。
7. **API smoke tests（透過真正的 HTTP 端點，非只查 D1）**：`wrangler pages dev --remote` 在目前的 wrangler 版本不支援 D1 remote binding，改用 `wrangler dev dist/_worker.js --remote`（暫時把 `wrangler.jsonc` 的 `mrt_rank_db` binding 指向 disposable 資料庫 id，測試完立即改回並確認 `git diff` 為空）成功起了一個本地伺服器、透過真正的 Worker 執行環境連到 disposable D1：

   | 端點 | 結果 |
   |---|---|
   | `GET /api/analytics/months` | `success:true`，正確列出 `2026-08` |
   | `GET /api/recommend?from=BL12&time_period=afternoon&preference=all`（未指定月份） | `success:true`，`data_source:real`，`data_month:2026年8月`（正確取得唯一已匯入的真實月份） |
   | `GET /api/recommend?...&year=2026&month=8`（顯式指定） | `success:true`，`range_label:2026年8月` |
   | `GET /api/analytics/pagerank?year=2026&month=8&period=morning_peak` | `success:true`，回傳真實排名（`BL12` 第一，`pr_value=0.06011`） |
   | `GET /api/recommend?...&range_type=year&year=2026` | `404`（正確，年度不完整） |
   | `GET /api/recommend?...&range_type=holiday&event_key=lunar-new-year&year=2026` | `404`，訊息正確說明「已登錄，但尚未計算逐日資料覆蓋狀態」 |

8. **`verify_recommend_baseline.py --base-url http://localhost:8788`**：正確回報 `FAIL`（第 2/3 名站點對調、部分分數有 0.01 量級差異）——**這是預期、正確的行為，不是 regression**：這個 disposable 資料庫的「最新月份」是 2026-08（真實資料），而記錄的基準分數是綁定 2026-01 資料算出來的；兩個月份的真實旅運模式本來就不同，工具正確偵測到「資料不同→分數不同」，證明工具本身敏感且正常運作。針對本地 dev server（仍是 2026-01）重新執行後，恢復 **PASS**。
9. **清理**：停止 `wrangler dev` 程序 → `wrangler.jsonc` 的 `mrt_rank_db` binding 改回 production id（`git diff wrangler.jsonc` 確認為空）→ `wrangler d1 delete metropulse-prod-dryrun -y` → `wrangler d1 list` 確認只剩 `mrt-rank-db`（`file_size` 全程未變）。

### 4.2 R2 封存：本次演練的非拋棄式產出

與 disposable D1 不同，`metropulse-raw-od-archive` 是**真實、非拋棄式**的 production 用 bucket（Phase 2C 建立）。本次演練上傳的 2026-08 真實原始 CSV **予以保留**（不是測試產物需要清除），與既有的 2026-01 一起，讓這兩個月成為「production 匯入時可以直接使用既有 R2 封存、不需要重新下載」的月份（見第 5 節 SOP 的『若 R2 已有封存可跳過下載』說明）。目前 bucket 內容：`object_count: 2`，`bucket_size: 618 MB`。

---

## 5. Operational policy（production SOP）

### 5.1 每月新資料流程（明確順序）

```
1. import  — python3 scripts/import_od_data.py --year Y --month M --apply-remote \
             --db-name mrt-rank-db --archive-to-r2
             （若 R2 已有這個月份的封存且 checksum 相符，可用 --csv-file 指向已下載的本地副本，
              略過重新下載；否則照常從來源下載）
2. archive — 已內建在上一步的 --archive-to-r2；匯入後應核對 manifest 的
             r2_upload_status == "success"，若為 "failed" 需另外手動補傳，不阻塞這個月的資料可用性
             （匯入本身與 R2 封存是獨立成功/失敗的，見 import_od_data.py 設計）
3. year materialize attempt — python3 scripts/materialize_year_range.py --year Y --remote \
             --db-name mrt-rank-db
             （即使預期不完整也要跑；跑一次幾乎零成本，但能讓這個年度從此進入 retention.py 的
              保護範圍，避免第 5.2 節描述的「從未 materialize 就被 purge」風險——
              見 temporal-release-hardening.md 第 2.4 節）
4. relevant holiday materialize — 若這個月完成了某個已登錄連假的涵蓋範圍，執行
             python3 scripts/materialize_holiday_range.py --event-key <key> --year <Y> --remote \
             --db-name mrt-rank-db
5. baseline / smoke check — python3 scripts/verify_range_parity.py --year Y --month M --remote \
             --db-name mrt-rank-db
             python3 scripts/verify_recommend_baseline.py --base-url <指向這次更新後環境的 URL>
             （只有在確認要部署新版本、且該版本會讀到這個月資料時才需要對 production URL 執行；
              純粹匯入資料不需要重新部署網站，此步驟主要驗證資料本身，可對本地或 disposable
              環境先行確認）
```

### 5.2 Retention（先 dry-run，人審核後才 purge）

```
1. python3 scripts/retention.py --dry-run --db-name mrt-rank-db
   → 檢視風險清單（尚未完整 materialize 的年度／連假，若第 5.1 節步驟 3/4 有確實執行，
     這份清單在正常運作下應該經常是空的）
2. 人工審核：清單為空 → 可以執行 purge；清單非空 → 先處理清單項目（materialize 或明確決定放棄），
   不直接加 --acknowledge-unmaterialized-ranges 跳過
3. python3 scripts/retention.py --purge --db-name mrt-rank-db
   （只在完成步驟 2 的人工確認後才執行；不建議放進無人審核的自動化排程，
    見 temporal-release-hardening.md 第 2.4 節既有立場，本文件不重新開放這個限制）
```

---

## 6. Risks / 剩餘人工決策

1. **Cloudflare 帳號方案未確認**：18 個月保留窗口的儲存投影（≈5.4GB 穩態）需要 Workers Paid plan；本次 disposable 測試確認帳號目前可以建立/刪除 Paid D1（表示帳號至少有 D1 付費能力），但**沒有**單獨確認 `mrt-rank-db` 本身掛載在哪個方案——這是所有先前 phase 文件反覆標記、至今仍未關閉的同一項決策，本文件不重複解決，只再次提醒。
2. **來源資料傳輸未加密**：`build_url()` 使用 `http://`（非 `https://`）。ETL 自行計算的 SHA-256 checksum 能偵測傳輸損毀，但無法防止主動竄改（中間人攻擊）；公開統計資料的敏感度低，風險可接受，但如果之後上游改提供 HTTPS 版本，建議改用。
3. **Holiday 日期未經官方原始檔案人工複核**：見 2.2 節——本次用搜尋引擎與第三方網站交叉驗證，信心高但不是 100% 等同直接讀官方 PDF／Excel。**日期必須在實際 production insert 前，由人工從 DGPA 官方 PDF／Excel 再確認一次**（v1 只需複核 2025／2026 兩年，見 2.2.1 節），這是 production-initialization-runbook.md 的明確 stop condition。
4. **Backfill 深度**：v1 範圍已正式確認為 2025-01～2026-08（20 個月，見 3.3 節）；2023/2024 明確列為 future backfill，未包含在本次決策範圍內。
5. **每月匯入耗時**：實測單月完整流程（下載＋ETL＋R2 封存＋D1 寫入）約 3~4 分鐘（本次 2026-08 實測：下載+解析 50s、R2 上傳＋D1 寫入合計約 3 分鐘）；v1 的 20 個月**不會**一次無人監督執行，production-initialization-runbook.md 已分成 5 個 batch（2025 Q1/Q2/Q3/Q4、2026 Jan-Aug），每批驗證後才繼續。
6. **R2 生命週期規則未設定**：bucket 目前沒有自動轉冷儲存或到期刪除規則（Phase 2C 已知決策，本次不重新處理）；隨真實月份累積，bucket 儲存成本會持續成長，建議在 backfill 規模確定後一併規劃。
7. **本次 rehearsal 只涵蓋單一月份的「不完整年度／不完整連假」路徑**：完整年度／完整連假的 materialize 成功路徑已經在 Final Gate（temporal-final-gate.md）的 fixture 驗證與本次真實資料的「不完整」分支都驗證過，但**尚未**用真實資料端到端驗證過「完整年度 materialize 成功＋年度推薦 API 成功」——這需要先完成至少 12 個月的真實 backfill 才能做到，是第 3.3 節 backfill 決策之後的自然後續驗證，本文件不假裝已經測過。

---

## 7. 結論

### READY TO INITIALIZE PRODUCTION D1

理由：
- Bootstrap → migrations → 真實月份匯入（含下載、ETL、parity 驗證、R2 封存與 manifest）→ 年度／連假 materialize attempt → API smoke test → baseline 檢查，這整條「實際準備上 production 的流程」已經用**真實** 2026-08 資料在 disposable Paid D1 上完整跑過一次，每一步結果都符合設計預期，沒有發現任何程式碼層級的阻塞問題。
- Holiday metadata 的登錄與 materialize-attempt 機制已用附真實官方來源的資料驗證正常運作。
- production `mrt-rank-db` 在整個演練過程中確認完全未被觸碰（`file_size` 全程不變）。

「READY」是指**機制與流程已就緒、可以開始執行**，不代表可以跳過第 6 節列出的人工決策（帳號方案、holiday 日期最終複核）。v1 backfill 範圍與 holiday metadata 已在本次 Production Preflight 正式確認（2025-01～2026-08、`lunar-new-year:2025/2026`，見 3.3／2.2.1 節）；逐步執行順序見 [production-initialization-runbook.md](production-initialization-runbook.md)，建議順序：先確認帳號方案 → 人工複核 2025／2026 春節日期 → 依 runbook 的 batch 順序對 `mrt-rank-db` 執行匯入。

本文件全程未寫入 production `mrt-rank-db`、未部署網站、未修改推薦演算法或任何現有 API 行為。
