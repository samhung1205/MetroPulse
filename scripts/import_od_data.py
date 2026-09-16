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
import urllib.request
import urllib.parse
import tempfile
from datetime import datetime
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

def process_csv_stream(year: int, month: int, verbose: bool = True):
    """
    串流下載並解析 OD CSV，回傳：
      od_by_period: dict[period, dict[(from_id, to_id), int]]
      total_rows: int（含 flow=0 的原始行數）
      mapped_rows: int（成功對應到站 ID 的行數）
    """
    url = build_url(year, month)
    if verbose:
        print(f"[下載] {url}", flush=True)

    od_by_period: dict[str, dict[tuple[str, str], int]] = {p: defaultdict(int) for p in PERIODS}
    total_rows = 0
    mapped_rows = 0
    skipped_hour = 0
    skipped_name = 0

    req = urllib.request.Request(url, headers={"User-Agent": "MetroPulse-ETL/1.0"})

    with urllib.request.urlopen(req, timeout=300) as response:
        # 逐行解碼（CSV 可能是 UTF-8 with BOM 或 Big5）
        # 先嘗試 UTF-8，失敗則用 Big5
        reader_iter = None
        raw_lines = []

        # 分塊讀取並在行邊界切分
        buffer = b""
        chunk_size = 1024 * 256  # 256 KB per chunk
        encoding = None

        first_chunk = True
        line_buffer = ""

        while True:
            chunk = response.read(chunk_size)
            if not chunk:
                break

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
                _, hour_str, from_name, to_name, count_str = parts[0], parts[1], parts[2], parts[3], parts[4]

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

                od_by_period[period][(from_id, to_id)] += count
                mapped_rows += 1

        # 處理最後一行
        if line_buffer.strip() and not line_buffer.startswith('日期'):
            parts = line_buffer.strip().split(',')
            if len(parts) >= 5:
                total_rows += 1

    if verbose:
        print(f"[解析] 共 {total_rows:,} 行（流量>0），成功對應 {mapped_rows:,} 行", flush=True)
        print(f"       略過（非高峰外時段）: {skipped_hour:,}，略過（站名未對應）: {skipped_name:,}", flush=True)

    return od_by_period, total_rows, mapped_rows

# ============================================================
# SQL 生成
# ============================================================

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
    all_station_ids = sorted(STATION_MAP.values(), key=lambda x: (x[:2], int(''.join(filter(str.isdigit, x)) or '0')))
    # Deduplicate
    seen = set()
    station_ids = []
    for sid in all_station_ids:
        if sid not in seen:
            seen.add(sid)
            station_ids.append(sid)

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


def _apply_local_wrangler(sql_path: str, project_root: str) -> None:
    """用 wrangler 匯入本地 D1，並先套用 migrations 確保 real_* 資料表存在"""
    wrangler_bin = _wrangler_bin(project_root)
    _run_wrangler(
        [wrangler_bin, 'd1', 'migrations', 'apply', 'mrt-rank-db', '--local'],
        project_root,
        '本地 D1 migrations',
    )
    _run_wrangler(
        [wrangler_bin, 'd1', 'execute', 'mrt-rank-db', '--local', '--file', sql_path],
        project_root,
        '本地 D1 匯入',
    )
    print("[完成] 資料已匯入本地 D1")

def _apply_remote_wrangler(sql_path: str, project_root: str) -> None:
    """用 wrangler 匯入遠端 Cloudflare D1，並先套用 migrations"""
    wrangler_bin = _wrangler_bin(project_root)
    _run_wrangler(
        [wrangler_bin, 'd1', 'migrations', 'apply', 'mrt-rank-db', '--remote'],
        project_root,
        '遠端 D1 migrations',
    )
    _run_wrangler(
        [wrangler_bin, 'd1', 'execute', 'mrt-rank-db', '--remote', '--file', sql_path],
        project_root,
        '遠端 D1 匯入',
    )
    print(f"[完成] 資料已匯入遠端 D1")


# ============================================================
# 主程式
# ============================================================

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
        '--apply-local', action='store_true',
        help='生成 SQL 後直接透過 wrangler 寫入本地 D1'
    )
    parser.add_argument(
        '--apply-remote', action='store_true',
        help='生成 SQL 後直接執行 wrangler d1 execute（遠端 Cloudflare D1）'
    )
    parser.add_argument('--verbose', action='store_true', default=True)
    args = parser.parse_args()

    if not (1 <= args.month <= 12):
        print("錯誤：月份需為 1-12", file=sys.stderr)
        sys.exit(1)

    # 確保輸出目錄存在
    output_dir = os.path.join(os.path.dirname(__file__), 'output')
    os.makedirs(output_dir, exist_ok=True)

    output_path = args.output or os.path.join(output_dir, f"od_{args.year}{args.month:02d}.sql")

    print(f"\n{'='*60}")
    print(f"  MetroPulse OD Import — {args.year}年{args.month}月")
    print(f"{'='*60}\n")

    # 下載並解析
    od_by_period, total_rows, mapped_rows = process_csv_stream(
        args.year, args.month, verbose=args.verbose
    )

    # 生成 SQL
    print("\n[生成] SQL 檔案...", flush=True)
    sql = generate_sql(args.year, args.month, od_by_period, total_rows)

    with open(output_path, 'w', encoding='utf-8') as f:
        f.write(sql)

    # 統計
    od_total = sum(len(flows) for flows in od_by_period.values())
    print(f"\n[完成] 輸出至：{output_path}")
    print(f"  OD 對（各時段）：{od_total:,} 筆")
    print(f"  檔案大小：{os.path.getsize(output_path) / 1024:.1f} KB")

    project_root = os.path.dirname(os.path.dirname(__file__))

    # 選擇性直接匯入
    if args.apply_local:
        _apply_local_wrangler(output_path, project_root)

    if args.apply_remote:
        _apply_remote_wrangler(output_path, project_root)

    print("\n後續步驟：")
    if not (args.apply_local or args.apply_remote):
        print(f"  本地匯入：python3 scripts/import_od_data.py --year {args.year} --month {args.month} --apply-local")
        print(f"  遠端匯入：python3 scripts/import_od_data.py --year {args.year} --month {args.month} --apply-remote")
        print(f"  或直接：  sqlite3 <db路徑> < {output_path}")
    print()

if __name__ == '__main__':
    main()
