#!/usr/bin/env python3
"""
Phase 3A.1 — Remote Paid D1 smoke test 專用：compact 完整年度 fixture（測試用，不是正式 ETL）。

目的只是驗證整條管線在真正的 remote D1 上跑得通：
  bootstrap → daily coverage → year materialization → yearly API → Station Detail 年度證據
不是要在大資料量下驗證 PageRank 的統計特性——那件事已經在本地用 2027 年、71,199 筆
range_od_flow、772,324,718 筆流量守恆的 fixture 完整驗證過（見 verify_year_parity.py）。

因此刻意只寫極少量固定 OD pair（不是每天上萬筆的真實量體），但涵蓋全年「每一天」與
「每個既有 period」，讓 service_date × period 完整性判定與 PageRank 計算都能被真正跑過一次，
同時把要上傳到 remote D1 的列數壓在數千筆等級，不是 22M 列。

用法：
  python3 scripts/build_remote_smoke_fixture.py --year 2031 --db-name metropulse-smoke-test --remote
"""

import argparse
import calendar as _cal
import os
import sys
from datetime import date, timedelta

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from import_od_data import (  # noqa: E402
    PERIODS,
    get_all_station_ids,
    _wrangler_bin,
    _run_wrangler,
    _batched_insert_lines,
)


def main():
    parser = argparse.ArgumentParser(description='建立 remote D1 smoke test 用的 compact 完整年度 fixture')
    parser.add_argument('--year', type=int, required=True)
    parser.add_argument('--db-name', required=True, help='disposable 測試用 D1 名稱；不得是 mrt-rank-db')
    parser.add_argument('--remote', action='store_true', required=True, help='只用於 remote smoke test，不支援 --local（本地已有完整規模的 2027 fixture）')
    args = parser.parse_args()

    if args.db_name == 'mrt-rank-db':
        print('錯誤：--db-name 不可以是 mrt-rank-db（正式資料庫），這支腳本只給 disposable 測試 DB 用', file=sys.stderr)
        sys.exit(1)

    project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    wrangler_bin = _wrangler_bin(project_root)
    year = args.year
    expected_days = 366 if _cal.isleap(year) else 365

    station_ids = get_all_station_ids()
    # 固定抽樣一小組 OD pair（每 15 站取一個當起點，配對到往後第 7 個站），
    # 只是要讓 118 站的 PageRank 全網計算有非退化的輸入，不追求真實流量分布。
    pairs = [(station_ids[i], station_ids[(i + 7) % len(station_ids)])
             for i in range(0, len(station_ids), 15)]

    print(f"\n{'='*64}")
    print(f"  Remote D1 smoke fixture：{year} 年（{expected_days} 天 × 6 期 × {len(pairs)} OD pair）")
    print(f"  目標 DB：{args.db_name}（remote，disposable）")
    print(f"{'='*64}\n")

    lines = [f"DELETE FROM daily_od_flow WHERE service_date BETWEEN '{year}-01-01' AND '{year}-12-31';"]
    rows = []
    d = date(year, 1, 1)
    while d.year == year:
        ds = d.isoformat()
        yday = d.timetuple().tm_yday
        for period in PERIODS:
            for i, (a, b) in enumerate(pairs):
                # 非零、隨日期/OD序號變化的小數字，避免整年每天都是同一個常數
                flow = 50 + (yday * 3 + i * 11) % 300
                rows.append(f"('{a}','{b}','{ds}','{period}',{flow})")
        d += timedelta(days=1)

    lines.extend(_batched_insert_lines(
        'daily_od_flow',
        ['from_station_id', 'to_station_id', 'service_date', 'period', 'flow_count'],
        rows,
    ))

    output_path = os.path.join(project_root, 'scripts', 'output', f"remote_smoke_fixture_{year}.sql")
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    with open(output_path, 'w', encoding='utf-8') as f:
        f.write('\n'.join(lines))

    print(f"[執行] 套用到 remote '{args.db_name}'（{len(rows):,} 列 daily_od_flow）...")
    _run_wrangler(
        [wrangler_bin, 'd1', 'execute', args.db_name, '--remote', '--file', output_path],
        project_root, 'remote smoke fixture',
    )
    print(f"\n完成。{year} 年（{len(rows):,} 列）已寫入 {args.db_name} 的 daily_od_flow。")


if __name__ == '__main__':
    main()
