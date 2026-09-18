#!/usr/bin/env python3
"""
MetroPulse OD Data Import Script
=================================
臺北捷運每日分時各站OD流量統計 → MetroPulse D1 SQL

資料來源（公開）：
  http://tcgmetro.blob.core.windows.net/stationod/
  臺北捷運每日分時各站OD流量統計資料_YYYYMM.csv

CSV 格式：日期,時段,進站,出站,人次
時段為 0-23 整數（每小時），人次為當日該小時該 OD 對的旅客數。

用法：
  python3 scripts/import_od_data.py --year 2026 --month 1
  python3 scripts/import_od_data.py --year 2026 --month 1 --output scripts/output/od_202601.sql
  python3 scripts/import_od_data.py --year 2026 --month 1 --apply-local   # 直接匯入本地 D1
"""

import csv
import sys
import math
import json
import argparse
import subprocess
import os
import hashlib
import calendar
import urllib.request
import urllib.parse
import tempfile
from datetime import datetime, date, timedelta
from collections import defaultdict

# ============================================================
# 常數
# ============================================================

GAMMA = 0.85
POWER_ITER = 150
MIN_FLOW = 1  # 過濾掉流量為 0 的 OD 對（CSV 中有大量 0）

# 時段對應：小時 → 時段代碼
HOUR_TO_PERIOD: dict[int, str] = {
    7: 'morning_peak', 8: 'morning_peak',
    9: 'morning', 10: 'morning', 11: 'morning',
    12: 'noon', 13: 'noon',
    14: 'afternoon', 15: 'afternoon', 16: 'afternoon',
    17: 'evening_peak', 18: 'evening_peak',
    19: 'night', 20: 'night', 21: 'night', 22: 'night',
}

PERIODS = ['morning_peak', 'morning', 'noon', 'afternoon', 'evening_peak', 'night']

# ============================================================
# 站名 → ID 對照表（從 seed.sql 提取，優先取主線代表站）
# 轉乘站以主線 ID 為準（e.g. 台北車站 → BL12）
# ============================================================

STATION_MAP: dict[str, str] = {
    # 板南線 BL
    "頂埔": "BL01", "永寧": "BL02", "土城": "BL03", "海山": "BL04",
    "亞東醫院": "BL05", "府中": "BL06", "板橋": "BL07", "新埔": "BL08",
    "江子翠": "BL09", "龍山寺": "BL10", "西門": "BL11",
    "台北車站": "BL12", "善導寺": "BL13", "忠孝新生": "BL14",
    "忠孝復興": "BL15", "忠孝敦化": "BL16", "國父紀念館": "BL17",
    "市政府": "BL18", "永春": "BL19", "後山埤": "BL20",
    "昆陽": "BL21", "南港": "BL22", "南港展覽館": "BL23",
    # 淡水信義線 R
    "廣慈/奉天宮": "R01", "廣慈／奉天宮": "R01", "廣慈": "R01",
    "象山": "R02", "台北101/世貿": "R03", "信義安和": "R04",
    "大安": "R05", "大安森林公園": "R06", "東門": "R07",
    "中正紀念堂": "R08", "台大醫院": "R09",
    "中山": "R11", "雙連": "R12", "民權西路": "R13",
    "圓山": "R14", "劍潭": "R15", "士林": "R16",
    "芝山": "R17", "明德": "R18", "石牌": "R19",
    "唭哩岸": "R20", "奇岩": "R21", "北投": "R22",
    "復興崗": "R23", "忠義": "R24", "關渡": "R25",
    "竹圍": "R26", "紅樹林": "R27", "淡水": "R28",
    # 松山新店線 G（轉乘站以 G 為主，O/BL 為輔）
    "新店": "G01", "新店區公所": "G02", "七張": "G03", "小碧潭": "G03A",
    "大坪林": "G04", "景美": "G05", "萬隆": "G06", "公館": "G07",
    "台電大樓": "G08", "古亭": "G09", "小南門": "G11",
    "北門": "G13", "松江南京": "G15", "南京復興": "G16",
    "台北小巨蛋": "G17", "南京三民": "G18", "松山": "G19",
    # 中和新蘆線 O（轉乘站 G 已佔名稱者用 O 別名）
    "南勢角": "O01", "景安": "O02", "永安市場": "O03", "頂溪": "O04",
    "行天宮": "O09", "中山國小": "O10", "大橋頭": "O12", "台北橋": "O13",
    "菜寮": "O14", "三重": "O15", "先嗇宮": "O16",
    "頭前庄": "O17", "新莊": "O18", "輔大": "O19",
    "丹鳳": "O20", "迴龍": "O21", "三重國小": "O50",
    "三和國中": "O51", "徐匯中學": "O52", "三民高中": "O53", "蘆洲": "O54",
    # 文湖線 BR
    "動物園": "BR01", "木柵": "BR02", "萬芳社區": "BR03", "萬芳醫院": "BR04",
    "辛亥": "BR05", "麟光": "BR06", "六張犁": "BR07", "科技大樓": "BR08",
    "中山國中": "BR12", "松山機場": "BR13",
    "大直": "BR14", "劍南路": "BR15", "西湖": "BR16", "港墘": "BR17",
    "文德": "BR18", "內湖": "BR19", "大湖公園": "BR20",
    "葫洲": "BR21", "東湖": "BR22", "南港軟體園區": "BR23",
    # 環狀線 Y
    "十四張": "Y08", "秀朗橋": "Y09", "景平": "Y10",
    "中和": "Y12", "橋和": "Y13", "中原": "Y14", "板新": "Y15",
    "新埔民生": "Y17", "幸福": "Y19", "新北產業園區": "Y20",
    # 別名（CSV 中可能出現繁體「臺」或不同斜線）
    "臺北車站": "BL12",
    "臺北101/世貿": "R03",
    "臺北101∕世貿": "R03",
    "台北101∕世貿": "R03",
    "新北投": "R22",      # 新北投是北投的支線，歸入北投
    "大橋頭站": "O12",    # 部分 CSV 帶「站」字
    "廣慈奉天宮": "R01",
    "奉天宮": "R01",
}

# ============================================================
# PageRank 計算（Power Method）
# ============================================================

def compute_pagerank(
    station_ids: list[str],
    od_flows: dict[tuple[str, str], int],
) -> dict[str, float]:
    """
    輸入：
      station_ids — 參與計算的站點 ID 列表（順序任意）
      od_flows    — {(from_id, to_id): flow_count} 整月流量加總

    輸出：
      {station_id: pr_value}（加總 = 1.0）

    演算法：
      p_ij = γ × (e_ij / s_i) + (1−γ) × (1/n)
      PR = Power Method，迭代 POWER_ITER 次
    """
    n = len(station_ids)
    if n == 0:
        return {}

    idx = {sid: i for i, sid in enumerate(station_ids)}
    uniform = 1.0 / n

    # 建立轉移矩陣 P（row = from, col = to）
    # p[i][j] = 從站 i 轉移到站 j 的機率
    P = [[uniform * (1 - GAMMA)] * n for _ in range(n)]

    # 計算各來源站的總出流量 s_i
    s_i: dict[str, float] = defaultdict(float)
    for (frm, to), flow in od_flows.items():
        if frm in idx and to in idx:
            s_i[frm] += flow

    # 填入 γ × (e_ij / s_i) 部分
    for (frm, to), flow in od_flows.items():
        if frm not in idx or to not in idx:
            continue
        if s_i[frm] <= 0:
            continue
        i, j = idx[frm], idx[to]
        P[i][j] += GAMMA * (flow / s_i[frm])

    # Power Method：PR = P^T × PR（column-stochastic form）
    pr = [uniform] * n
    for _ in range(POWER_ITER):
        new_pr = [0.0] * n
        for j in range(n):
            for i in range(n):
                new_pr[j] += P[i][j] * pr[i]
        # Normalize
        total = sum(new_pr)
        if total > 0:
            pr = [v / total for v in new_pr]
        else:
            pr = [uniform] * n

    return {station_ids[i]: pr[i] for i in range(n)}

# ============================================================
# CSV 下載（Streaming，避免 300MB 全載入記憶體）
# ============================================================

def build_url(year: int, month: int) -> str:
    filename = f"臺北捷運每日分時各站OD流量統計資料_{year}{month:02d}.csv"
    encoded = urllib.parse.quote(filename)
    return f"http://tcgmetro.blob.core.windows.net/stationod/{encoded}"


class _SourceReader:
    """
    統一遠端 URL 與本地檔案的分塊讀取介面，兩者共用同一套解析邏輯。

    當來源是遠端下載且指定 cache_path 時，邊解析邊把原始位元組寫入本地快取檔——
    這是唯一一次下載，之後的 R2 封存直接上傳這份快取檔，不需要重新下載。
    """

    def __init__(self, year: int, month: int, local_path: str | None, verbose: bool, cache_path: str | None = None):
        self.url = build_url(year, month)
        self.local_path = local_path
        self.cache_path = None  # 若本次確實寫入了快取檔，設為實際路徑
        self.upstream_content_length: int | None = None
        self.upstream_content_md5: str | None = None
        self.upstream_last_modified: str | None = None
        self._fh = None
        self._response_cm = None
        self._cache_fh = None
        if local_path:
            if verbose:
                print(f"[讀取本地檔案] {local_path}（不下載遠端 CSV）", flush=True)
            self._fh = open(local_path, 'rb')
        else:
            if verbose:
                print(f"[下載] {self.url}", flush=True)
            req = urllib.request.Request(self.url, headers={"User-Agent": "MetroPulse-ETL/1.0"})
            self._response_cm = urllib.request.urlopen(req, timeout=300)
            self._fh = self._response_cm.__enter__()
            headers = self._fh.headers
            cl = headers.get('Content-Length')
            self.upstream_content_length = int(cl) if cl else None
            self.upstream_content_md5 = headers.get('Content-MD5')
            self.upstream_last_modified = headers.get('Last-Modified')
            if cache_path:
                os.makedirs(os.path.dirname(cache_path), exist_ok=True)
                self._cache_fh = open(cache_path, 'wb')
                self.cache_path = cache_path

    def read(self, size: int) -> bytes:
        chunk = self._fh.read(size)
        if chunk and self._cache_fh is not None:
            self._cache_fh.write(chunk)
        return chunk

    def close(self):
        if self._response_cm is not None:
            self._response_cm.__exit__(None, None, None)
        elif self._fh is not None:
            self._fh.close()
        if self._cache_fh is not None:
            self._cache_fh.close()

    def archivable_path(self) -> str | None:
        """回傳這次讀取實際對應的本地檔案路徑（供 R2 上傳使用），沒有則回傳 None。"""
        return self.local_path or self.cache_path


def process_csv_stream(year: int, month: int, verbose: bool = True, local_path: str | None = None, cache_path: str | None = None):
    """
    串流讀取（遠端下載或本地檔案）並解析 OD CSV，回傳：
      od_by_period:    dict[period, dict[(from_id, to_id), int]]        — 整月彙總（既有邏輯，未變動）
      daily_by_period:  dict[period, dict[(service_date, from_id, to_id), int]] — 逐日彙總（新增）
      total_rows:  int（原始資料行數，含 header 之後的所有資料列）
      mapped_rows: int（成功對應到站 ID 且落在 6 段時段內的行數）
      stats: dict — 額外統計（skipped_hour/skipped_name/distinct_dates/min_date/max_date/checksum_sha256/source_url）

    daily_by_period 與 od_by_period 由同一次 CSV 掃描、同一組過濾條件（MIN_FLOW／HOUR_TO_PERIOD／STATION_MAP）
    產生，因此 od_by_period[p][(f,t)] 恆等於 sum(daily_by_period[p][(d,f,t)] for all d) —— 這是後續 parity
    測試成立的前提，不是巧合。
    """
    od_by_period: dict[str, dict[tuple[str, str], int]] = {p: defaultdict(int) for p in PERIODS}
    daily_by_period: dict[str, dict[tuple[str, str, str], int]] = {p: defaultdict(int) for p in PERIODS}
    total_rows = 0
    mapped_rows = 0
    skipped_hour = 0
    skipped_name = 0
    skipped_date = 0
    distinct_dates: set[str] = set()

    checksum = hashlib.sha256()
    bytes_read = 0
    source = _SourceReader(year, month, local_path, verbose, cache_path=cache_path)

    try:
        chunk_size = 1024 * 256  # 256 KB per chunk
        encoding = None
        first_chunk = True
        line_buffer = ""

        while True:
            chunk = source.read(chunk_size)
            if not chunk:
                break

            checksum.update(chunk)
            bytes_read += len(chunk)

            if first_chunk:
                # 偵測 BOM
                if chunk.startswith(b'\xef\xbb\xbf'):
                    chunk = chunk[3:]
                    encoding = 'utf-8-sig'
                else:
                    encoding = 'utf-8'
                first_chunk = False

            try:
                decoded = chunk.decode(encoding)
            except UnicodeDecodeError:
                encoding = 'big5'
                try:
                    decoded = chunk.decode(encoding)
                except Exception:
                    decoded = chunk.decode('utf-8', errors='replace')

            line_buffer += decoded
            lines = line_buffer.split('\n')
            line_buffer = lines[-1]  # 最後一個可能不完整

            for line in lines[:-1]:
                line = line.strip()
                if not line:
                    continue

                # 跳過 header
                if line.startswith('日期'):
                    continue

                parts = line.split(',')
                if len(parts) < 5:
                    continue

                # 日期,時段,進站,出站,人次
                date_str, hour_str, from_name, to_name, count_str = parts[0], parts[1], parts[2], parts[3], parts[4]

                total_rows += 1

                try:
                    count = int(count_str.strip())
                except ValueError:
                    continue

                if count < MIN_FLOW:
                    continue  # 跳過零流量

                try:
                    hour = int(hour_str.strip())
                except ValueError:
                    continue

                period = HOUR_TO_PERIOD.get(hour)
                if period is None:
                    skipped_hour += 1
                    continue

                from_id = STATION_MAP.get(from_name.strip())
                to_id = STATION_MAP.get(to_name.strip())
                if from_id is None or to_id is None:
                    skipped_name += 1
                    continue

                # od_by_period（舊管線）的累加條件必須與 Phase 1 以前完全相同，
                # 不得因為日期欄位格式異常而跳過——否則新程式碼會悄悄改變舊管線的輸出，
                # 即使這次 fixture 剛好沒有觸發也一樣是隱性風險。日期驗證只影響 daily_by_period。
                od_by_period[period][(from_id, to_id)] += count
                mapped_rows += 1

                service_date = date_str.strip()
                if len(service_date) != 10 or service_date[4] != '-' or service_date[7] != '-':
                    skipped_date += 1
                    continue

                daily_by_period[period][(service_date, from_id, to_id)] += count
                distinct_dates.add(service_date)

        # 處理最後一行（無結尾換行的情況）
        if line_buffer.strip() and not line_buffer.startswith('日期'):
            parts = line_buffer.strip().split(',')
            if len(parts) >= 5:
                total_rows += 1
    finally:
        source.close()

    if verbose:
        print(f"[解析] 共 {total_rows:,} 行（流量>0），成功對應 {mapped_rows:,} 行", flush=True)
        print(f"       略過（非高峰外時段）: {skipped_hour:,}，略過（站名未對應）: {skipped_name:,}，略過（日期格式異常）: {skipped_date:,}", flush=True)
        print(f"       涵蓋日期：{min(distinct_dates) if distinct_dates else '無'} ~ {max(distinct_dates) if distinct_dates else '無'}（共 {len(distinct_dates)} 天）", flush=True)

    stats = {
        'skipped_hour': skipped_hour,
        'skipped_name': skipped_name,
        'skipped_date': skipped_date,
        'distinct_dates': len(distinct_dates),
        'min_date': min(distinct_dates) if distinct_dates else None,
        'max_date': max(distinct_dates) if distinct_dates else None,
        'checksum_sha256': checksum.hexdigest(),
        'bytes_read': bytes_read,
        'source_url': source.url,
        'source_local_path': local_path,
        'archivable_path': source.archivable_path(),
        'upstream_content_length': source.upstream_content_length,
        'upstream_content_md5': source.upstream_content_md5,
        'upstream_last_modified': source.upstream_last_modified,
        'bytes_read_matches_content_length': (
            source.upstream_content_length is None or bytes_read == source.upstream_content_length
        ),
    }

    return od_by_period, daily_by_period, total_rows, mapped_rows, stats

# ============================================================
# SQL 生成
# ============================================================

def get_all_station_ids() -> list[str]:
    """participating station 順序（去重後）；real_pagerank 與 range_pagerank 都必須用同一份順序才能比較。"""
    all_station_ids = sorted(STATION_MAP.values(), key=lambda x: (x[:2], int(''.join(filter(str.isdigit, x)) or '0')))
    seen = set()
    station_ids = []
    for sid in all_station_ids:
        if sid not in seen:
            seen.add(sid)
            station_ids.append(sid)
    return station_ids


def normalize_pr(pr_by_station: dict[str, float]) -> dict[str, tuple[float, int, float]]:
    """回傳 {station_id: (pr_value, rank, normalized_score)}"""
    if not pr_by_station:
        return {}
    sorted_items = sorted(pr_by_station.items(), key=lambda x: -x[1])
    min_v = min(pr_by_station.values())
    max_v = max(pr_by_station.values())
    span = max_v - min_v if max_v > min_v else 1.0
    result = {}
    for rank, (sid, pr_val) in enumerate(sorted_items, 1):
        norm = (pr_val - min_v) / span
        result[sid] = (pr_val, rank, norm)
    return result

def generate_sql(
    year: int,
    month: int,
    od_by_period: dict[str, dict[tuple[str, str], int]],
    total_rows: int,
) -> str:
    lines = []
    ts = datetime.now().isoformat(timespec='seconds')
    label = f"{year}年{month}月"

    lines.append("-- ============================================================")
    lines.append(f"-- MetroPulse 真實旅運量資料：{label}")
    lines.append(f"-- 來源：臺北捷運每日分時各站OD流量統計資料_{year}{month:02d}.csv")
    lines.append(f"-- 生成時間：{ts}")
    lines.append("-- ============================================================")
    lines.append("")

    # 1. data_months
    lines.append("-- 月份索引")
    lines.append(
        f"INSERT OR REPLACE INTO data_months (year, month, label, row_count, imported_at) "
        f"VALUES ({year}, {month}, '{label}', {total_rows}, '{ts}');"
    )
    lines.append("")

    # 2. real_od_flow（合併所有時段）
    lines.append("-- 真實 OD 流量（按時段）")
    lines.append("DELETE FROM real_od_flow WHERE year = {y} AND month = {m};".format(y=year, m=month))
    od_count = 0
    for period in PERIODS:
        flows = od_by_period[period]
        for (from_id, to_id), flow in flows.items():
            if flow <= 0:
                continue
            lines.append(
                f"INSERT OR REPLACE INTO real_od_flow "
                f"(from_station_id, to_station_id, period, year, month, flow_count) "
                f"VALUES ('{from_id}', '{to_id}', '{period}', {year}, {month}, {flow});"
            )
            od_count += 1
    lines.append("")

    # 3. real_pagerank（每個時段）
    lines.append("-- 真實 PageRank（Power Method）")
    lines.append("DELETE FROM real_pagerank WHERE year = {y} AND month = {m};".format(y=year, m=month))
    pr_count = 0
    station_ids = get_all_station_ids()

    for period in PERIODS:
        od_flows = od_by_period[period]
        print(f"  [{period}] 計算 PageRank（{len(od_flows)} OD 對）...", flush=True)
        pr_raw = compute_pagerank(station_ids, od_flows)
        pr_info = normalize_pr(pr_raw)
        for sid, (pr_val, rank, norm) in pr_info.items():
            lines.append(
                f"INSERT OR REPLACE INTO real_pagerank "
                f"(station_id, period, year, month, pr_value, pr_rank, normalized_score) "
                f"VALUES ('{sid}', '{period}', {year}, {month}, {pr_val:.8f}, {rank}, {norm:.6f});"
            )
            pr_count += 1

    lines.append("")
    lines.append(f"-- 匯入完成：{od_count} 筆 OD 資料，{pr_count} 筆 PageRank")

    return '\n'.join(lines)

# ============================================================
# Phase 2A — daily_od_flow + generalized range（僅 month）
# ============================================================

def _batched_insert_lines(table: str, columns: list[str], rows: list[str], batch_size: int = 500) -> list[str]:
    """rows 為已格式化的 '(...)' value tuple 字串；分批組成多列 INSERT，降低陳述式數量。"""
    out = []
    col_list = ", ".join(columns)
    for i in range(0, len(rows), batch_size):
        chunk = rows[i:i + batch_size]
        out.append(f"INSERT INTO {table} ({col_list}) VALUES " + ", ".join(chunk) + ";")
    return out


def generate_daily_sql(
    year: int,
    month: int,
    daily_by_period: dict[str, dict[tuple[str, str, str], int]],
) -> tuple[str, int]:
    """
    daily_od_flow 的 INSERT／DELETE。

    DELETE 範圍用「整個曆月」（而非本次實際觀測到的最早/最晚日期），確保重新匯入同月份時，
    即使先前一次匯入資料不完整（觀測範圍較窄），這次也能完整覆蓋、不留舊列——
    同時仍限定在該曆月，不會touched 到其他月份（曆月彼此不重疊，見 import safety 段落）。
    """
    last_day = calendar.monthrange(year, month)[1]
    month_start = f"{year:04d}-{month:02d}-01"
    month_end = f"{year:04d}-{month:02d}-{last_day:02d}"

    lines = []
    lines.append("-- 逐日 OD 流量（daily_od_flow）")
    lines.append(f"DELETE FROM daily_od_flow WHERE service_date BETWEEN '{month_start}' AND '{month_end}';")

    rows: list[str] = []
    row_count = 0
    for period in PERIODS:
        for (service_date, from_id, to_id), flow in daily_by_period[period].items():
            if flow <= 0:
                continue
            rows.append(f"('{from_id}', '{to_id}', '{service_date}', '{period}', {flow})")
            row_count += 1

    lines.extend(_batched_insert_lines(
        'daily_od_flow',
        ['from_station_id', 'to_station_id', 'service_date', 'period', 'flow_count'],
        rows,
    ))
    lines.append("")
    lines.append(f"-- daily_od_flow 匯入完成：{row_count} 筆（涵蓋 {month_start} ~ {month_end}）")
    return '\n'.join(lines), row_count


def aggregate_range_from_daily(
    daily_by_period: dict[str, dict[tuple[str, str, str], int]],
    start_date: str | None = None,
    end_date: str | None = None,
) -> dict[str, dict[tuple[str, str], int]]:
    """
    Python 端模擬「SUM(flow_count) GROUP BY from,to,period WHERE service_date BETWEEN ? AND ?」。
    這是 generalized range 引擎的聚合邏輯本體：任何 range_type（month/year/holiday/custom）
    最終都收斂成「決定日期集合 → 呼叫這個函式」，本階段只用它來服務 month。

    對 DB 中實際落地的 daily_od_flow 所做的 SQL 版本聚合驗證，見
    scripts/verify_range_parity.py（拿真正的 SQL SUM 結果跟這裡的 Python 結果 / real_od_flow 三方比對）。
    """
    result: dict[str, dict[tuple[str, str], int]] = {p: defaultdict(int) for p in PERIODS}
    for period, entries in daily_by_period.items():
        for (service_date, from_id, to_id), flow in entries.items():
            if start_date and service_date < start_date:
                continue
            if end_date and service_date > end_date:
                continue
            result[period][(from_id, to_id)] += flow
    return result


def generate_range_sql(
    year: int,
    month: int,
    range_od_agg: dict[str, dict[tuple[str, str], int]],
    station_ids: list[str],
    day_count: int,
    data_start_date: str,
    data_end_date: str,
) -> tuple[str, dict]:
    """
    寫入 date_ranges（range_type='month'）+ range_od_flow + range_pagerank。

    range_pagerank 呼叫與 real_pagerank 完全相同、未修改的 compute_pagerank()/normalize_pr()，
    唯一差異是輸入的 od_flows 改用「由 daily_od_flow 聚合而來」的 range_od_agg，而不是
    「CSV 掃描時直接按 period 累加」的 od_by_period —— 兩者數學上應恆等（見函式註解），
    這正是 critical parity test 要驗證的假設。
    """
    range_id = f"month:{year:04d}-{month:02d}"
    ts = datetime.now().isoformat(timespec='seconds')
    label = f"{year}年{month}月"

    lines = []
    lines.append("-- date_ranges / range_od_flow / range_pagerank（range_type='month'）")
    lines.append(
        "INSERT OR REPLACE INTO date_ranges "
        "(range_id, range_type, start_date, end_date, holiday_event_id, label, day_count, computed_at) "
        f"VALUES ('{range_id}', 'month', '{data_start_date}', '{data_end_date}', NULL, '{label}', {day_count}, '{ts}');"
    )

    lines.append(f"DELETE FROM range_od_flow WHERE range_id = '{range_id}';")
    od_rows: list[str] = []
    od_count = 0
    for period in PERIODS:
        for (from_id, to_id), flow in range_od_agg[period].items():
            if flow <= 0:
                continue
            od_rows.append(f"('{range_id}', '{from_id}', '{to_id}', '{period}', {flow})")
            od_count += 1
    lines.extend(_batched_insert_lines(
        'range_od_flow',
        ['range_id', 'from_station_id', 'to_station_id', 'period', 'flow_count'],
        od_rows,
    ))

    lines.append(f"DELETE FROM range_pagerank WHERE range_id = '{range_id}';")
    pr_rows: list[str] = []
    pr_count = 0
    range_pr_by_period: dict[str, dict[str, tuple[float, int, float]]] = {}
    for period in PERIODS:
        od_flows = range_od_agg[period]
        print(f"  [range:{period}] 計算 PageRank（{len(od_flows)} OD 對，來源 daily_od_flow 聚合）...", flush=True)
        pr_raw = compute_pagerank(station_ids, od_flows)
        pr_info = normalize_pr(pr_raw)
        range_pr_by_period[period] = pr_info
        for sid, (pr_val, rank, norm) in pr_info.items():
            pr_rows.append(f"('{range_id}', '{sid}', '{period}', {pr_val:.8f}, {rank}, {norm:.6f})")
            pr_count += 1
    lines.extend(_batched_insert_lines(
        'range_pagerank',
        ['range_id', 'station_id', 'period', 'pr_value', 'pr_rank', 'normalized_score'],
        pr_rows,
    ))

    lines.append("")
    lines.append(f"-- range 匯入完成：range_id={range_id}，{od_count} 筆 OD 資料，{pr_count} 筆 PageRank")

    meta = {
        'range_id': range_id,
        'od_count': od_count,
        'pr_count': pr_count,
        'range_pr_by_period': range_pr_by_period,
        'range_od_agg': range_od_agg,
    }
    return '\n'.join(lines), meta

# ============================================================
# 匯入輔助函式
# ============================================================

def _wrangler_bin(project_root: str) -> str:
    wrangler_local = os.path.join(project_root, 'node_modules', '.bin', 'wrangler')
    return wrangler_local if os.path.exists(wrangler_local) else 'wrangler'


def _run_wrangler(cmd: list[str], project_root: str, label: str) -> None:
    env = os.environ.copy()
    env.setdefault('CI', '1')
    print(f"\n[匯入] 執行：{' '.join(cmd)}", flush=True)
    result = subprocess.run(cmd, cwd=project_root, env=env, capture_output=True, text=True)
    if result.stdout:
        print(result.stdout)
    if result.stderr:
        print(result.stderr, file=sys.stderr)
    if result.returncode != 0:
        print(f"\n[錯誤] {label} 失敗（exit code {result.returncode}）", file=sys.stderr)
        print(f"可手動執行：{' '.join(cmd)}", file=sys.stderr)
        sys.exit(1)


def _apply_local_wrangler(sql_path: str, project_root: str, db_name: str = 'mrt-rank-db') -> None:
    """用 wrangler 匯入本地 D1，並先套用 migrations 確保 real_* 資料表存在"""
    wrangler_bin = _wrangler_bin(project_root)
    _run_wrangler(
        [wrangler_bin, 'd1', 'migrations', 'apply', db_name, '--local'],
        project_root,
        '本地 D1 migrations',
    )
    _run_wrangler(
        [wrangler_bin, 'd1', 'execute', db_name, '--local', '--file', sql_path],
        project_root,
        '本地 D1 匯入',
    )
    print(f"[完成] 資料已匯入本地 D1（{db_name}）")

def _apply_remote_wrangler(sql_path: str, project_root: str, db_name: str = 'mrt-rank-db') -> None:
    """
    用 wrangler 匯入遠端 Cloudflare D1，並先套用 migrations。

    db_name 預設為正式資料庫 'mrt-rank-db'；操作維運/驗證時應明確傳入一個可拋棄的
    測試資料庫名稱（例如 --db-name mrt-rank-db-phase2b-test），避免任何驗證動作
    意外寫入正式資料庫。
    """
    wrangler_bin = _wrangler_bin(project_root)
    _run_wrangler(
        [wrangler_bin, 'd1', 'migrations', 'apply', db_name, '--remote'],
        project_root,
        '遠端 D1 migrations',
    )
    _run_wrangler(
        [wrangler_bin, 'd1', 'execute', db_name, '--remote', '--file', sql_path],
        project_root,
        '遠端 D1 匯入',
    )
    print(f"[完成] 資料已匯入遠端 D1（{db_name}）")


def _upload_to_r2(local_path: str, bucket: str, object_key: str, project_root: str, verbose: bool = True) -> tuple[bool, str | None]:
    """
    上傳原始 CSV 到 R2 做長期封存（decision 4：raw source 需要 durable archive）。

    刻意保持簡單：單次嘗試、同步等待完成、不做重試佇列或斷點續傳。
    上傳失敗不會讓整個資料匯入失敗——archival 是「盡量確保長期可回溯」，
    不是這次匯入資料是否正確可用的前提條件；但失敗一定會被清楚寫進 manifest
    （r2_upload_status='failed' + 錯誤訊息），不會被靜默吞掉。
    """
    if not local_path or not os.path.exists(local_path):
        return False, f'找不到可封存的本地檔案：{local_path}'
    wrangler_bin = _wrangler_bin(project_root)
    cmd = [
        wrangler_bin, 'r2', 'object', 'put', f'{bucket}/{object_key}',
        '--file', local_path, '--content-type', 'text/csv', '--remote',
    ]
    env = os.environ.copy()
    env.setdefault('CI', '1')
    if verbose:
        print(f"\n[R2 封存] 上傳 {local_path} → {bucket}/{object_key}", flush=True)
    result = subprocess.run(cmd, cwd=project_root, env=env, capture_output=True, text=True)
    if result.stdout:
        print(result.stdout)
    if result.returncode != 0:
        print(f"[警告] R2 封存上傳失敗（不影響本次資料匯入結果）：{result.stderr}", file=sys.stderr)
        return False, (result.stderr or '').strip()[:500]
    print(f"[R2 封存] 完成：{bucket}/{object_key}")
    return True, None


def _d1_json_query(sql: str, project_root: str, db_name: str, remote: bool) -> list[dict]:
    wrangler_bin = _wrangler_bin(project_root)
    cmd = [wrangler_bin, 'd1', 'execute', db_name, '--json',
           '--remote' if remote else '--local', '--command', sql]
    env = os.environ.copy()
    env.setdefault('CI', '1')
    result = subprocess.run(cmd, cwd=project_root, env=env, capture_output=True, text=True)
    if result.returncode != 0:
        print(f"[錯誤] 驗證查詢失敗：{result.stderr}", file=sys.stderr)
        sys.exit(1)
    return json.loads(result.stdout)[0]['results']


def apply_maintenance_reimport(
    combined_sql: str,
    project_root: str,
    db_name: str,
    remote: bool,
    expected_counts: dict,
) -> None:
    """
    「Existing-month re-import」maintenance workflow（decision 5）。

    一般（新月份）匯入一律走 `_apply_local_wrangler`/`_apply_remote_wrangler`——單一檔案、
    單一 wrangler 呼叫，維持 Phase 2A/2B 已驗證過的完整原子性；這裡發現的 wrangler 輪詢逾時
    問題**不會**讓一般匯入的原子性被犧牲。

    這個函式只在明確要求「重新匯入一個已經有資料的月份」時才會被呼叫（--maintenance-reimport）。
    做法：把 DELETE 陳述式從主檔案抽出、改用同步的 `d1 execute --command` 送出，其餘 INSERT
    陳述式仍走 `--file`——避開 Phase 2B 實測到的「大表 DELETE 執行時間超過 wrangler 非同步匯入
    工作 15 秒用戶端輪詢逾時」問題（見 docs/data/temporal-phase2b-hardening.md 1.4 節）。
    代價：DELETE 與 INSERT 不再屬於同一個交易，中間如果被真正的錯誤（不是逾時）打斷，
    有可能停在「已刪除、尚未重新寫入」的狀態。

    為了不讓這個代價變成「靜默的資料損毀」：完成後一定執行列數核對，任何一張表的實際列數
    與這次匯入「應該」寫入的列數不符，就印出明確的 CRITICAL 訊息並以非零狀態碼結束。
    DELETE 與 INSERT 都設計成冪等（DELETE 對已清空範圍是無害 no-op；INSERT 前一定先跑過
    對應的 DELETE，不會重複），所以任何一種部分失敗，操作者只要重新執行同一個
    maintenance 指令即可安全復原，不需要手動修補資料。
    """
    print("\n" + "=" * 64)
    print("  ⚠️  MAINTENANCE RE-IMPORT — 這不是一般匯入流程")
    print("  DELETE 與 INSERT 分成兩次獨立呼叫，不具備單一檔案的原子性保證。")
    print("  僅用於「重新匯入一個已存在資料的月份」；新月份請使用一般匯入。")
    print("=" * 64)

    delete_lines = []
    other_lines = []
    for line in combined_sql.split('\n'):
        if line.strip().startswith('DELETE FROM'):
            delete_lines.append(line.strip())
        else:
            other_lines.append(line)

    if not delete_lines:
        print("[錯誤] 找不到任何 DELETE 陳述式，可能不是重新匯入情境，中止 maintenance 流程。", file=sys.stderr)
        sys.exit(1)

    project_root_local = project_root
    wrangler_bin = _wrangler_bin(project_root_local)
    scope_flag = '--remote' if remote else '--local'

    print(f"\n[Maintenance 1/2] 同步送出 {len(delete_lines)} 筆 DELETE 陳述式（--command，避開輪詢逾時）...")
    delete_cmd = [wrangler_bin, 'd1', 'execute', db_name, scope_flag, '--command', ' '.join(delete_lines)]
    _run_wrangler(delete_cmd, project_root_local, 'Maintenance DELETE')

    insert_only_path = os.path.join(project_root_local, 'scripts', 'output', '_maintenance_inserts_tmp.sql')
    with open(insert_only_path, 'w', encoding='utf-8') as f:
        f.write('\n'.join(other_lines))

    print(f"\n[Maintenance 2/2] 透過 --file 送出其餘 INSERT 陳述式...")
    scope = 'remote' if remote else 'local'
    if remote:
        _apply_remote_wrangler(insert_only_path, project_root_local, db_name=db_name)
    else:
        _apply_local_wrangler(insert_only_path, project_root_local, db_name=db_name)

    # 完成後強制列數核對——這是避免「維護流程失敗卻靜默看起來像成功」的關鍵步驟。
    print("\n[驗證] 核對 maintenance re-import 後的實際列數...")
    problems = []
    for label, sql, expected in expected_counts['checks']:
        rows = _d1_json_query(sql, project_root_local, db_name, remote)
        actual = rows[0]['c'] if rows else None
        status = 'OK' if actual == expected else 'MISMATCH'
        print(f"  [{status}] {label}：預期 {expected:,}，實際 {actual if actual is not None else '查詢失敗'}")
        if actual != expected:
            problems.append((label, expected, actual))

    if problems:
        print("\n" + "!" * 64, file=sys.stderr)
        print("  🚨 CRITICAL：maintenance re-import 後列數與預期不符，資料可能處於不一致狀態。", file=sys.stderr)
        print("  不要信任這個月份目前的資料。建議立即重新執行同一個 maintenance 指令一次，", file=sys.stderr)
        print("  DELETE/INSERT 皆為冪等操作，重跑可安全復原到正確狀態；復原後務必重新執行", file=sys.stderr)
        print("  scripts/verify_range_parity.py 確認 parity 通過，才能信任這個月份的資料。", file=sys.stderr)
        for label, expected, actual in problems:
            print(f"    - {label}：預期 {expected:,}，實際 {actual}", file=sys.stderr)
        print("!" * 64, file=sys.stderr)
        sys.exit(1)

    print("\n✅ Maintenance re-import 完成，列數核對全部通過。強烈建議接著執行 verify_range_parity.py 再次確認 parity。")


MANIFEST_SCHEMA_VERSION = 3  # Phase 2C：新增 r2_* 封存欄位；Phase 2B 是 version 2，Phase 2A 是 version 1（無此欄位）


def generate_manifest(
    year: int,
    month: int,
    stats: dict,
    total_rows: int,
    mapped_rows: int,
    downloaded_at: str,
    imported_at: str | None,
    daily_row_count: int,
    range_meta: dict,
    timings: dict,
    db_name: str,
    r2_info: dict,
) -> dict:
    """
    每次 import 的來源與內容記錄（source provenance manifest）。

    Phase 2C（decision 4）：raw CSV 現在可以封存到 Cloudflare R2（`--archive-to-r2`），
    manifest 記錄 R2 物件位置與這次匯入自己算出的 SHA-256——用這兩者可以隨時把 R2 上的
    封存檔重新下載下來，獨立驗證 checksum 是否仍然吻合，而不需要相信任何中介系統。
    """
    return {
        'manifest_schema_version': MANIFEST_SCHEMA_VERSION,
        'r2_bucket': r2_info['r2_bucket'],
        'r2_object_key': r2_info['r2_object_key'],
        'r2_uploaded_at': r2_info['r2_uploaded_at'],
        'r2_upload_status': r2_info['r2_upload_status'],
        'r2_upload_error': r2_info['r2_upload_error'],
        'year': year,
        'month': month,
        'db_name': db_name,
        'source_url': stats['source_url'],
        'source_local_path': stats['source_local_path'],
        'downloaded_at_or_read_at': downloaded_at,
        'imported_at': imported_at,
        'row_count_raw': total_rows,
        'row_count_mapped': mapped_rows,
        'row_count_skipped_hour': stats['skipped_hour'],
        'row_count_skipped_name': stats['skipped_name'],
        'row_count_skipped_date_format': stats['skipped_date'],
        'distinct_service_dates': stats['distinct_dates'],
        'service_date_range': {'min': stats['min_date'], 'max': stats['max_date']},
        'bytes_read': stats['bytes_read'],
        'upstream_content_length': stats['upstream_content_length'],
        'bytes_read_matches_content_length': stats['bytes_read_matches_content_length'],
        'checksum_sha256_etl_computed': stats['checksum_sha256'],
        'upstream_content_md5_header': stats['upstream_content_md5'],
        'upstream_last_modified_header': stats['upstream_last_modified'],
        'checksum_note': (
            '此 sha256 由 ETL 在串流讀取時逐區塊計算，是本專案唯一信任的完整性依據。'
            '不使用來源伺服器回傳的 Content-MD5 標頭作為完整性判斷——Phase 2A 實測發現該值與檔案'
            '實際內容不一致（見 docs/data/temporal-phase2a-implementation.md 的紀錄），可能是物件'
            '儲存端過期或未更新的中介資料，不可信任；upstream_content_md5_header 只保留供比對追蹤，'
            '不作為完整性驗證依據。bytes_read_matches_content_length 才是下載完整性的判斷依據'
            '（實際接收位元組數 vs 伺服器宣告的 Content-Length）。'
        ),
        'daily_od_flow_row_count': daily_row_count,
        'range': {
            'range_id': range_meta['range_id'],
            'range_od_flow_row_count': range_meta['od_count'],
            'range_pagerank_row_count': range_meta['pr_count'],
        },
        'timings_seconds': timings,
        'etl_version': 'phase2c',
    }


# ============================================================
# Phase 3B — generalized range coverage / aggregate 共用邏輯
# ============================================================
# Month／Year／Holiday 共用同一套「聚合 OD → 建 transition matrix → PageRank」管線
# （見 docs/data/temporal-architecture-design.md）。以下三個函式是這套管線裡與「range 是
# 一段日期區間」相關的共用部分，只依賴 start_date/end_date，不知道呼叫端是年度還是連假——
# Phase 3A.1 原本把這套邏輯寫死在 materialize_year_range.py 裡，Phase 3B 把它搬到這裡，
# 讓新的 materialize_holiday_range.py 呼叫同一份、已經被 2027/2029 fixture 驗證過的邏輯，
# 不是重新寫一份容易走樣的複製品。

PERIOD_SET = set(PERIODS)


def compute_service_date_period_coverage(
    start_date: str,
    end_date: str,
    expected_day_count: int,
    project_root: str,
    db_name: str,
    remote: bool,
) -> dict:
    """通用 service_date × period 完整性檢查（year/holiday/custom 共用，不含 range 專屬欄位）。

    一個日期區間被視為「完整」，若且唯若：
      1. daily_od_flow 對 [start_date, end_date] 的每一天都至少有一列資料。
      2. 每個有資料的日期，六個既有 period 都必須各至少一列——只看 distinct 日期數會漏掉
         「某天只匯入 5 個 period」的情況。
    不要求同一天每個 OD pair 都存在，也不對缺的 period 補 0。
    """
    row = _d1_json_query(
        f"SELECT MIN(service_date) as min_date, MAX(service_date) as max_date, "
        f"COUNT(DISTINCT service_date) as distinct_dates "
        f"FROM daily_od_flow WHERE service_date BETWEEN '{start_date}' AND '{end_date}'",
        project_root, db_name, remote,
    )[0]
    distinct_dates = row['distinct_dates'] or 0

    incomplete_rows = _d1_json_query(
        f"SELECT service_date, GROUP_CONCAT(DISTINCT period) as periods_present, "
        f"COUNT(DISTINCT period) as period_count FROM daily_od_flow "
        f"WHERE service_date BETWEEN '{start_date}' AND '{end_date}' "
        f"GROUP BY service_date HAVING period_count <> {len(PERIODS)} "
        f"ORDER BY service_date LIMIT 50",
        project_root, db_name, remote,
    )
    incomplete_period_days = []
    for r in incomplete_rows:
        present = set((r['periods_present'] or '').split(','))
        missing = sorted(PERIOD_SET - present)
        incomplete_period_days.append({
            'service_date': r['service_date'],
            'periods_present': sorted(present),
            'missing_periods': missing,
        })
    count_row = _d1_json_query(
        f"SELECT COUNT(*) as n FROM (SELECT service_date FROM daily_od_flow "
        f"WHERE service_date BETWEEN '{start_date}' AND '{end_date}' "
        f"GROUP BY service_date HAVING COUNT(DISTINCT period) <> {len(PERIODS)})",
        project_root, db_name, remote,
    )[0]
    incomplete_period_day_count = count_row['n'] or 0

    is_complete = (
        distinct_dates == expected_day_count
        and row['min_date'] == start_date
        and row['max_date'] == end_date
        and incomplete_period_day_count == 0
    )
    coverage = {
        'start_date': start_date,
        'end_date': end_date,
        'expected_day_count': expected_day_count,
        'actual_day_count': distinct_dates,
        'actual_min_date': row['min_date'],
        'actual_max_date': row['max_date'],
        'expected_period_count': len(PERIODS),
        'incomplete_period_day_count': incomplete_period_day_count,
        'incomplete_period_days_sample': incomplete_period_days,
        'is_complete': is_complete,
    }
    coverage['coverage_note'] = build_coverage_note(coverage)
    return coverage


def build_coverage_note(coverage: dict) -> str | None:
    """把不完整的原因寫成一句可讀說明；完整 range 回傳 None（不寫欄位，不是空字串）。"""
    if coverage['is_complete']:
        return None
    reasons = []
    if (coverage['actual_day_count'] != coverage['expected_day_count']
            or coverage['actual_min_date'] != coverage['start_date']
            or coverage['actual_max_date'] != coverage['end_date']):
        reasons.append(
            f"僅涵蓋 {coverage['actual_day_count']}/{coverage['expected_day_count']} 天"
            f"（{coverage['actual_min_date'] or '無資料'} ~ {coverage['actual_max_date'] or '無資料'}）"
        )
    if coverage['incomplete_period_day_count'] > 0:
        sample = coverage['incomplete_period_days_sample'][0] if coverage['incomplete_period_days_sample'] else None
        example = f"，例如 {sample['service_date']} 缺少 {'、'.join(sample['missing_periods'])}" if sample else ''
        reasons.append(f"{coverage['incomplete_period_day_count']} 天沒有完整六個時段的資料{example}")
    note = '；'.join(reasons) if reasons else '完整性檢查未通過（原因不明，請檢查腳本邏輯）'
    return note.replace("'", "''")  # 防禦性跳脫，避免文字內容意外含有單引號時破壞 SQL 字面值


def fetch_range_od_aggregate(
    start_date: str, end_date: str, project_root: str, db_name: str, remote: bool,
) -> dict[str, dict[tuple[str, str], int]]:
    """對已持久化的 daily_od_flow 執行真正的 SQL SUM...GROUP BY（不是 Python 端重算）。"""
    rows = _d1_json_query(
        f"SELECT from_station_id, to_station_id, period, SUM(flow_count) as total "
        f"FROM daily_od_flow WHERE service_date BETWEEN '{start_date}' AND '{end_date}' "
        f"GROUP BY from_station_id, to_station_id, period",
        project_root, db_name, remote,
    )
    od_by_period: dict[str, dict[tuple[str, str], int]] = {p: defaultdict(int) for p in PERIODS}
    for r in rows:
        if r['period'] in od_by_period:
            od_by_period[r['period']][(r['from_station_id'], r['to_station_id'])] = r['total']
    return od_by_period


def generate_range_materialization_sql(
    coverage: dict,
    od_by_period: dict,
    station_ids: list[str],
    range_id: str,
    range_type: str,
    label: str,
    holiday_event_id: str | None = None,
) -> tuple[str, dict]:
    """通用 range materialization SQL 產生器：year/holiday 共用（custom 未來也可沿用）。

    完整：寫入 date_ranges（is_complete=1）+ range_od_flow + range_pagerank。
    不完整：只更新 date_ranges 狀態列，不寫入 range_od_flow/range_pagerank——不插值、
    不假裝、不補 0，任何查詢路徑都不可能意外讀到一個用不完整資料算出來的 PageRank 結果。
    """
    ts = datetime.now().isoformat(timespec='seconds')
    is_complete_flag = 1 if coverage['is_complete'] else 0
    note = coverage.get('coverage_note')
    note_sql = f"'{note}'" if note is not None else 'NULL'
    holiday_event_sql = f"'{holiday_event_id}'" if holiday_event_id is not None else 'NULL'

    lines = []
    lines.append(f"-- date_ranges（range_type='{range_type}'，range_id={range_id}）")
    lines.append(
        "INSERT OR REPLACE INTO date_ranges "
        "(range_id, range_type, start_date, end_date, holiday_event_id, label, day_count, computed_at, is_complete, expected_day_count, coverage_note) "
        f"VALUES ('{range_id}', '{range_type}', '{coverage['start_date']}', '{coverage['end_date']}', {holiday_event_sql}, '{label}', "
        f"{coverage['actual_day_count']}, '{ts}', {is_complete_flag}, {coverage['expected_day_count']}, {note_sql});"
    )

    od_count = 0
    pr_count = 0
    range_pr_by_period: dict[str, dict[str, tuple[float, int, float]]] = {}

    if coverage['is_complete']:
        lines.append(f"DELETE FROM range_od_flow WHERE range_id = '{range_id}';")
        od_rows = []
        for period in PERIODS:
            for (from_id, to_id), flow in od_by_period[period].items():
                if flow <= 0:
                    continue
                od_rows.append(f"('{range_id}', '{from_id}', '{to_id}', '{period}', {flow})")
                od_count += 1
        lines.extend(_batched_insert_lines(
            'range_od_flow',
            ['range_id', 'from_station_id', 'to_station_id', 'period', 'flow_count'],
            od_rows,
        ))

        lines.append(f"DELETE FROM range_pagerank WHERE range_id = '{range_id}';")
        pr_rows = []
        for period in PERIODS:
            od_flows = od_by_period[period]
            print(f"  [range:{period}] 計算 PageRank（{len(od_flows)} OD 對，來源 {range_type} range daily_od_flow SQL 聚合）...", flush=True)
            pr_raw = compute_pagerank(station_ids, od_flows)
            pr_info = normalize_pr(pr_raw)
            range_pr_by_period[period] = pr_info
            for sid, (pr_val, rank, norm) in pr_info.items():
                pr_rows.append(f"('{range_id}', '{sid}', '{period}', {pr_val:.8f}, {rank}, {norm:.6f})")
                pr_count += 1
        lines.extend(_batched_insert_lines(
            'range_pagerank',
            ['range_id', 'station_id', 'period', 'pr_value', 'pr_rank', 'normalized_score'],
            pr_rows,
        ))
    else:
        lines.append(
            f"-- {range_type} range 資料不完整（{coverage['actual_day_count']}/{coverage['expected_day_count']} 天，"
            f"{coverage['incomplete_period_day_count']} 天缺 period），只更新 date_ranges 狀態列，"
            f"不寫入 range_od_flow/range_pagerank。"
        )

    lines.append("")
    lines.append(f"-- range 處理完成：range_id={range_id}，is_complete={coverage['is_complete']}，{od_count} 筆 OD、{pr_count} 筆 PageRank")

    return '\n'.join(lines), {
        'range_id': range_id, 'od_count': od_count, 'pr_count': pr_count,
        'range_pr_by_period': range_pr_by_period,
    }


def main():
    parser = argparse.ArgumentParser(
        description="MetroPulse OD Data Import — 下載台北捷運 OD 旅運量並匯入 D1"
    )
    parser.add_argument('--year',  type=int, required=True, help='年份（西元，如 2026）')
    parser.add_argument('--month', type=int, required=True, help='月份（1-12）')
    parser.add_argument(
        '--output', type=str, default='',
        help='輸出 SQL 檔案路徑（預設：scripts/output/od_YYYYMM.sql）'
    )
    parser.add_argument(
        '--csv-file', type=str, default='',
        help='使用本地已下載的 CSV 檔案，不對遠端來源發出請求（來源不可用時的備援，也用於可重現測試）'
    )
    parser.add_argument(
        '--apply-local', action='store_true',
        help='生成 SQL 後直接透過 wrangler 寫入本地 D1'
    )
    parser.add_argument(
        '--apply-remote', action='store_true',
        help='生成 SQL 後直接執行 wrangler d1 execute（遠端 Cloudflare D1）'
    )
    parser.add_argument(
        '--db-name', type=str, default='mrt-rank-db',
        help="目標 D1 資料庫名稱（預設 'mrt-rank-db'，即正式資料庫）。"
             "維運驗證／演練時應明確指定一個可拋棄的測試資料庫名稱，不要用預設值對正式庫做實驗。"
    )
    parser.add_argument(
        '--maintenance-reimport', action='store_true',
        help="Existing-month re-import maintenance workflow（decision 5）：只在對「已有資料的月份」"
             "重新匯入時使用。會犧牲單一檔案的原子性（DELETE 與 INSERT 分成兩次呼叫）以避開大表 "
             "DELETE 在 wrangler 非同步匯入路徑上的用戶端輪詢逾時；完成後強制列數核對，"
             "不一致會以非零狀態碼中止並印出明確的復原步驟，不會靜默視為成功。"
             "新月份的一般匯入請勿使用此旗標——一般匯入必須保持單一檔案的完整原子性。"
    )
    parser.add_argument(
        '--archive-to-r2', action='store_true',
        help='把這次讀取到的原始 CSV 上傳到 Cloudflare R2 做長期封存（decision 4），並把 R2 物件資訊寫進 manifest。'
    )
    parser.add_argument(
        '--r2-bucket', type=str, default='metropulse-raw-od-archive',
        help="R2 封存用的 bucket 名稱（預設 'metropulse-raw-od-archive'）。"
    )
    parser.add_argument('--verbose', action='store_true', default=True)
    args = parser.parse_args()

    if not (1 <= args.month <= 12):
        print("錯誤：月份需為 1-12", file=sys.stderr)
        sys.exit(1)

    # 確保輸出目錄存在
    output_dir = os.path.join(os.path.dirname(__file__), 'output')
    os.makedirs(output_dir, exist_ok=True)

    db_suffix = '' if args.db_name == 'mrt-rank-db' else f"_{args.db_name}"
    output_path = args.output or os.path.join(output_dir, f"od_{args.year}{args.month:02d}{db_suffix}.sql")
    manifest_path = os.path.join(output_dir, f"manifest_{args.year}{args.month:02d}{db_suffix}.json")

    print(f"\n{'='*60}")
    print(f"  MetroPulse OD Import — {args.year}年{args.month}月")
    print(f"{'='*60}\n")

    downloaded_at = datetime.now().isoformat(timespec='seconds')
    t0 = datetime.now()

    # 若要封存到 R2 且這次是遠端下載（非 --csv-file），邊解析邊把原始位元組寫入本地快取檔，
    # 避免「解析完才發現要封存」還得重新下載一次。
    cache_path = None
    if args.archive_to_r2 and not args.csv_file:
        cache_path = os.path.join(output_dir, 'raw-cache', f"od_{args.year}{args.month:02d}.csv")

    # 下載（或讀取本地檔案）並解析——單一次掃描同時產出 od_by_period 與 daily_by_period
    od_by_period, daily_by_period, total_rows, mapped_rows, stats = process_csv_stream(
        args.year, args.month, verbose=args.verbose, local_path=(args.csv_file or None), cache_path=cache_path
    )
    t_parse = (datetime.now() - t0).total_seconds()

    station_ids = get_all_station_ids()

    # 舊管線：real_od_flow / real_pagerank（邏輯與輸出未變動）
    print("\n[生成] real_od_flow / real_pagerank（既有管線，未變動）...", flush=True)
    t1 = datetime.now()
    sql_old = generate_sql(args.year, args.month, od_by_period, total_rows)
    t_old_pipeline = (datetime.now() - t1).total_seconds()

    # 新管線：daily_od_flow
    print("[生成] daily_od_flow...", flush=True)
    t2 = datetime.now()
    sql_daily, daily_row_count = generate_daily_sql(args.year, args.month, daily_by_period)
    t_daily = (datetime.now() - t2).total_seconds()

    # 新管線：range 聚合（daily_od_flow → range_od_flow → range_pagerank，range_type='month'）
    print("[聚合] daily → range_od_flow（Python 端 SUM，模擬 SQL GROUP BY）...", flush=True)
    t3 = datetime.now()
    range_od_agg = aggregate_range_from_daily(daily_by_period, stats['min_date'], stats['max_date'])
    t_aggregate = (datetime.now() - t3).total_seconds()

    print("[計算] range_pagerank...", flush=True)
    t4 = datetime.now()
    sql_range, range_meta = generate_range_sql(
        args.year, args.month, range_od_agg, station_ids,
        day_count=stats['distinct_dates'],
        data_start_date=stats['min_date'] or f"{args.year:04d}-{args.month:02d}-01",
        data_end_date=stats['max_date'] or f"{args.year:04d}-{args.month:02d}-01",
    )
    t_range_pagerank = (datetime.now() - t4).total_seconds()

    # 三段 SQL 合併成單一檔案：wrangler d1 execute --file 對單一檔案是原子的
    # （本地已實測驗證：檔案中段任何一個陳述式失敗，整個檔案的變更全部回滾，包含 CREATE/DELETE/INSERT）。
    # 合併寫入可確保「舊表 + 新表」在同一次匯入中要嘛一起成功、要嘛一起維持匯入前的狀態，
    # 不會出現只有一邊更新的半套狀態。
    combined_sql = sql_old + "\n\n" + sql_daily + "\n\n" + sql_range + "\n"

    with open(output_path, 'w', encoding='utf-8') as f:
        f.write(combined_sql)

    file_size_mb = os.path.getsize(output_path) / (1024 * 1024)

    # 統計
    od_total = sum(len(flows) for flows in od_by_period.values())
    print(f"\n[完成] 輸出至：{output_path}")
    print(f"  real_od_flow OD 對（各時段合計）：{od_total:,} 筆")
    print(f"  daily_od_flow 列數：{daily_row_count:,} 筆（{stats['distinct_dates']} 天，平均每日 {daily_row_count / max(stats['distinct_dates'],1):,.0f} 列）")
    print(f"  range_od_flow 列數：{range_meta['od_count']:,} 筆")
    print(f"  合併 SQL 檔案大小：{file_size_mb:.2f} MB")
    print(f"  耗時：parse={t_parse:.2f}s old_pipeline_sql={t_old_pipeline:.2f}s daily_sql={t_daily:.2f}s aggregate={t_aggregate:.2f}s range_pagerank={t_range_pagerank:.2f}s")

    project_root = os.path.dirname(os.path.dirname(__file__))

    # R2 raw-source 封存（decision 4）。刻意保持簡單：只在明確要求時做，單次嘗試。
    r2_info = {
        'r2_bucket': None, 'r2_object_key': None,
        'r2_uploaded_at': None, 'r2_upload_status': 'skipped', 'r2_upload_error': None,
    }
    if args.archive_to_r2:
        archivable = stats['archivable_path']
        object_key = f"raw/{args.year:04d}{args.month:02d}/od_{args.year:04d}{args.month:02d}_{stats['checksum_sha256'][:16]}.csv"
        ok, err = _upload_to_r2(archivable, args.r2_bucket, object_key, project_root)
        r2_info['r2_bucket'] = args.r2_bucket
        r2_info['r2_object_key'] = object_key
        r2_info['r2_upload_status'] = 'success' if ok else 'failed'
        r2_info['r2_upload_error'] = err
        if ok:
            r2_info['r2_uploaded_at'] = datetime.now().isoformat(timespec='seconds')

    imported_at = None
    t_apply = 0.0
    is_reimport = args.maintenance_reimport
    if is_reimport:
        real_pr_expected = len(station_ids) * len(PERIODS)
        expected_counts = {
            'checks': [
                (
                    'daily_od_flow（本月範圍）',
                    f"SELECT COUNT(*) as c FROM daily_od_flow WHERE service_date BETWEEN "
                    f"'{stats['min_date'] or f'{args.year:04d}-{args.month:02d}-01'}' AND "
                    f"'{stats['max_date'] or f'{args.year:04d}-{args.month:02d}-01'}'",
                    daily_row_count,
                ),
                ('range_od_flow', f"SELECT COUNT(*) as c FROM range_od_flow WHERE range_id='{range_meta['range_id']}'", range_meta['od_count']),
                ('range_pagerank', f"SELECT COUNT(*) as c FROM range_pagerank WHERE range_id='{range_meta['range_id']}'", range_meta['pr_count']),
                ('real_od_flow', f"SELECT COUNT(*) as c FROM real_od_flow WHERE year={args.year} AND month={args.month}", od_total),
                ('real_pagerank', f"SELECT COUNT(*) as c FROM real_pagerank WHERE year={args.year} AND month={args.month}", real_pr_expected),
            ]
        }
        target_remote = args.apply_remote
        if not (args.apply_local or args.apply_remote):
            print("[錯誤] --maintenance-reimport 必須搭配 --apply-local 或 --apply-remote 使用。", file=sys.stderr)
            sys.exit(1)
        t5 = datetime.now()
        apply_maintenance_reimport(combined_sql, project_root, args.db_name, target_remote, expected_counts)
        imported_at = datetime.now().isoformat(timespec='seconds')
        t_apply = (datetime.now() - t5).total_seconds()
    else:
        # 選擇性直接匯入（本地／遠端各自獨立計時；此前版本在 --apply-remote 情境下
        # 於 --apply-local 區塊後就量測 t_apply，導致遠端耗時從未被記錄，已修正）
        if args.apply_local:
            t5 = datetime.now()
            _apply_local_wrangler(output_path, project_root, db_name=args.db_name)
            imported_at = datetime.now().isoformat(timespec='seconds')
            t_apply += (datetime.now() - t5).total_seconds()

        if args.apply_remote:
            t6 = datetime.now()
            _apply_remote_wrangler(output_path, project_root, db_name=args.db_name)
            imported_at = datetime.now().isoformat(timespec='seconds')
            t_apply += (datetime.now() - t6).total_seconds()

    timings = {
        'parse_csv': round(t_parse, 3),
        'generate_old_pipeline_sql': round(t_old_pipeline, 3),
        'generate_daily_sql': round(t_daily, 3),
        'aggregate_range': round(t_aggregate, 3),
        'compute_range_pagerank_sql': round(t_range_pagerank, 3),
        'apply_to_d1': round(t_apply, 3) if (args.apply_local or args.apply_remote) else None,
    }

    manifest = generate_manifest(
        args.year, args.month, stats, total_rows, mapped_rows,
        downloaded_at, imported_at, daily_row_count, range_meta, timings,
        args.db_name, r2_info,
    )
    with open(manifest_path, 'w', encoding='utf-8') as f:
        json.dump(manifest, f, ensure_ascii=False, indent=2)
    print(f"  Manifest 已寫入：{manifest_path}")

    print("\n後續步驟：")
    if not (args.apply_local or args.apply_remote):
        print(f"  本地匯入：python3 scripts/import_od_data.py --year {args.year} --month {args.month} --apply-local")
        print(f"  遠端匯入：python3 scripts/import_od_data.py --year {args.year} --month {args.month} --apply-remote")
        print(f"  或直接：  sqlite3 <db路徑> < {output_path}")
    print()

if __name__ == '__main__':
    main()
