#!/usr/bin/env python3
"""
測試用工具（不是正式 ETL 的一部分）——compact 連假 fixture，供 Phase 3B.1 歷年比較驗證用。

與 build_holiday_fixture.py 的差異：那支腳本從真實 2026-01 資料重新映射，一次連假就有
數萬筆 OD pair；這支腳本只寫極少量固定 OD pair（跟 build_remote_smoke_fixture.py 同一個
精神），目的只是驗證「歷年比較」這個功能本身跑得通、算得對，不是要驗證大資料量下的統計特性
（那件事 Phase 3A.1/3B 已經用大 fixture 驗證過）。不需要真實資料模板，直接生成。

用法：
  # 完整連假（5 天）
  python3 scripts/build_compact_holiday_fixture.py --event-key test-compare --year 2024 \\
      --name-zh 測試比較連假 --start-date 2024-06-01 --end-date 2024-06-05 --multiplier 1.0 --local

  # 完整連假（9 天，刻意跟上面天數不同）
  python3 scripts/build_compact_holiday_fixture.py --event-key test-compare --year 2025 \\
      --name-zh 測試比較連假 --start-date 2025-06-01 --end-date 2025-06-09 --multiplier 1.6 --local

  # 反例：缺一天（測試 incomplete year 不被當 0，不列入圖表）
  python3 scripts/build_compact_holiday_fixture.py --event-key test-compare --year 2026 \\
      --name-zh 測試比較連假 --start-date 2026-06-01 --end-date 2026-06-05 --multiplier 0.8 --local \\
      --omit-day 06-03
"""

import argparse
import os
import sys
from datetime import date, timedelta, datetime

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from import_od_data import PERIODS, get_all_station_ids, _wrangler_bin, _run_wrangler  # noqa: E402


def main():
    parser = argparse.ArgumentParser(description='建立 compact 連假 fixture（測試用，不從真實資料映射）')
    parser.add_argument('--event-key', required=True)
    parser.add_argument('--year', type=int, required=True)
    parser.add_argument('--name-zh', required=True)
    parser.add_argument('--start-date', required=True, help='YYYY-MM-DD')
    parser.add_argument('--end-date', required=True, help='YYYY-MM-DD')
    parser.add_argument('--multiplier', type=float, default=1.0, help='流量倍率，讓不同年份彼此可區分')
    parser.add_argument('--db-name', dest='db_name', type=str, default='mrt-rank-db')
    scope = parser.add_mutually_exclusive_group(required=True)
    scope.add_argument('--local', action='store_true')
    scope.add_argument('--remote', action='store_true')
    parser.add_argument('--omit-day', type=str, default='', help='MM-DD：故意不產生這一天的資料（測試「少一天」）')
    args = parser.parse_args()

    project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    wrangler_bin = _wrangler_bin(project_root)
    scope_flag = '--remote' if args.remote else '--local'

    start = date.fromisoformat(args.start_date)
    end = date.fromisoformat(args.end_date)
    omit_day = date.fromisoformat(f"{args.year}-{args.omit_day}") if args.omit_day else None

    station_ids = get_all_station_ids()
    pairs = [(station_ids[i], station_ids[(i + 7) % len(station_ids)]) for i in range(0, len(station_ids), 15)]

    print(f"\n{'='*64}")
    print(f"  Compact 連假比較 fixture：{args.name_zh}（{args.event_key}:{args.year}）")
    print(f"  日期範圍：{start.isoformat()} ~ {end.isoformat()}（倍率 {args.multiplier}）")
    print(f"{'='*64}\n")

    lines = [f"DELETE FROM daily_od_flow WHERE service_date BETWEEN '{start.isoformat()}' AND '{end.isoformat()}';"]
    ts = datetime.now().isoformat(timespec='seconds')
    lines.append(
        "INSERT OR REPLACE INTO holiday_events (event_key, year, name_zh, start_date, end_date, source, updated_at) "
        f"VALUES ('{args.event_key}', {args.year}, '{args.name_zh}', '{start.isoformat()}', '{end.isoformat()}', "
        f"'compact 測試 fixture，非官方公告', '{ts}');"
    )

    d = start
    day_offset = 0
    day_count = 0
    rows = []
    while d <= end:
        if d == omit_day:
            print(f"  [反例：少一天] 略過 {d.isoformat()}，不產生任何資料")
            d += timedelta(days=1)
            day_offset += 1
            continue
        ds = d.isoformat()
        for period in PERIODS:
            for i, (a, b) in enumerate(pairs):
                flow = int((50 + (day_offset * 3 + i * 11) % 300) * args.multiplier)
                if flow <= 0:
                    continue
                rows.append(f"('{a}','{b}','{ds}','{period}',{flow})")
        day_count += 1
        d += timedelta(days=1)
        day_offset += 1

    lines.append(
        "INSERT INTO daily_od_flow (from_station_id, to_station_id, service_date, period, flow_count) VALUES "
        + ", ".join(rows) + ";"
    )

    output_path = os.path.join(project_root, 'scripts', 'output', f"compact_holiday_fixture_{args.event_key}_{args.year}.sql")
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    with open(output_path, 'w', encoding='utf-8') as f:
        f.write('\n'.join(lines))

    print(f"[執行] 套用到 {'遠端' if args.remote else '本地'} '{args.db_name}'（{day_count} 天，{len(rows):,} 列）...")
    _run_wrangler(
        [wrangler_bin, 'd1', 'execute', args.db_name, scope_flag, '--file', output_path],
        project_root, 'compact 連假比較 fixture',
    )
    print(f"\n完成。{args.event_key}:{args.year}（{day_count} 天，{len(rows):,} 列）已寫入 daily_od_flow，holiday_events 已登錄。")


if __name__ == '__main__':
    main()
