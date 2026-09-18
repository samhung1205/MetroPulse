#!/usr/bin/env python3
"""
測試用工具（不是正式 ETL 的一部分）——本地/測試 D1 合成連假 fixture。

用途：Phase 3B 的連假推薦需要真正涵蓋「登錄事件的 [start_date, end_date]」的
daily_od_flow 資料集才能驗證 holiday OD aggregate correctness 與 PageRank correctness，
但下載真實連假期間的公開 CSV 不切實際、且真正的 production 連假日期必須來自明確可追溯
來源（這支腳本產生的一律是**測試用** fixture，holiday_events.source 會清楚標示，不冒充
官方公告）。

做法與 build_year_fixture.py 相同：拿本地已有的 2026-01（真實資料，Phase 2A 匯入）當模板，
用 SQL INSERT...SELECT 依日期重新映射＋逐日不同倍率，合成一段指定的連假日期區間。

用法：
  # 完整 9 天連假 fixture，同時登錄 holiday_events
  python3 scripts/build_holiday_fixture.py --event-key lunar-new-year --year 2026 \\
      --name-zh 春節 --start-date 2026-02-14 --end-date 2026-02-22 --local

  # 反例：少一天（不產生 02-18 那天的資料）
  python3 scripts/build_holiday_fixture.py --event-key test-holiday --year 2030 \\
      --name-zh 測試連假 --start-date 2030-05-01 --end-date 2030-05-09 --local \\
      --omit-day 05-05

  # 反例：9 天都有資料，但其中一天少一個 period
  python3 scripts/build_holiday_fixture.py --event-key test-holiday --year 2031 \\
      --name-zh 測試連假 --start-date 2031-05-01 --end-date 2031-05-09 --local \\
      --corrupt-period 05-05:evening_peak
"""

import argparse
import os
import sys
from datetime import date, timedelta

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from import_od_data import _wrangler_bin, _run_wrangler  # noqa: E402

VALID_PERIODS = {'morning_peak', 'morning', 'noon', 'afternoon', 'evening_peak', 'night'}


def main():
    parser = argparse.ArgumentParser(description='合成一段連假日期區間的本地/測試 daily_od_flow fixture，並登錄 holiday_events')
    parser.add_argument('--event-key', required=True)
    parser.add_argument('--year', type=int, required=True)
    parser.add_argument('--name-zh', required=True)
    parser.add_argument('--start-date', required=True, help='YYYY-MM-DD')
    parser.add_argument('--end-date', required=True, help='YYYY-MM-DD')
    parser.add_argument('--db-name', dest='db_name', type=str, default='mrt-rank-db')
    scope = parser.add_mutually_exclusive_group(required=True)
    scope.add_argument('--local', action='store_true')
    scope.add_argument('--remote', action='store_true')
    parser.add_argument('--omit-day', type=str, default='', help='MM-DD：故意不產生這一天的資料（測試「少一天」）')
    parser.add_argument('--corrupt-period', type=str, default='', help='MM-DD:period：產生完該天後再刪掉該 period（測試「少一個 period」）')
    args = parser.parse_args()

    project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    wrangler_bin = _wrangler_bin(project_root)
    scope_flag = '--remote' if args.remote else '--local'

    start = date.fromisoformat(args.start_date)
    end = date.fromisoformat(args.end_date)
    if end < start:
        print('錯誤：--end-date 不可早於 --start-date', file=sys.stderr)
        sys.exit(1)

    omit_day = None
    if args.omit_day:
        omit_day = date.fromisoformat(f"{args.year}-{args.omit_day}")

    corrupt_date = corrupt_period = None
    if args.corrupt_period:
        try:
            date_part, corrupt_period = args.corrupt_period.split(':', 1)
            if corrupt_period not in VALID_PERIODS:
                raise ValueError
            corrupt_date = date.fromisoformat(f"{args.year}-{date_part}")
        except ValueError:
            print('錯誤：--corrupt-period 格式必須是 MM-DD:period，例如 05-05:evening_peak', file=sys.stderr)
            sys.exit(1)

    print(f"\n{'='*64}")
    print(f"  合成連假 fixture：{args.name_zh}（{args.event_key}:{args.year}）")
    print(f"  日期範圍：{start.isoformat()} ~ {end.isoformat()}")
    print(f"{'='*64}\n")

    lines = [f"DELETE FROM daily_od_flow WHERE service_date BETWEEN '{start.isoformat()}' AND '{end.isoformat()}';"]

    # 登錄／更新 holiday_events——測試用，source 清楚標示，不冒充官方公告。
    ts = __import__('datetime').datetime.now().isoformat(timespec='seconds')
    lines.append(
        "INSERT OR REPLACE INTO holiday_events (event_key, year, name_zh, start_date, end_date, source, updated_at) "
        f"VALUES ('{args.event_key}', {args.year}, '{args.name_zh}', '{start.isoformat()}', '{end.isoformat()}', "
        f"'本地測試 fixture，非官方公告', '{ts}');"
    )

    d = start
    day_offset = 0
    day_count = 0
    while d <= end:
        if d == omit_day:
            print(f"  [反例：少一天] 略過 {d.isoformat()}，不產生任何資料")
            d += timedelta(days=1)
            day_offset += 1
            continue
        # 模板來源固定用 2026-01 的第 (day_offset % 28 + 1) 天，避開月底日數差異；
        # 倍率依 day_offset 變化，讓連假內每天彼此可區分。
        source_day = (day_offset % 28) + 1
        source_date = f"2026-01-{source_day:02d}"
        multiplier = 0.85 + 0.05 * (day_offset % 5)
        ds = d.isoformat()
        lines.append(f"-- {ds}（模板 {source_date}，倍率 {multiplier:.2f}）")
        lines.append(
            "INSERT INTO daily_od_flow (from_station_id, to_station_id, service_date, period, flow_count) "
            "SELECT from_station_id, to_station_id, "
            f"'{ds}', period, CAST(flow_count * {multiplier} AS INTEGER) "
            f"FROM daily_od_flow WHERE service_date = '{source_date}' "
            f"AND CAST(flow_count * {multiplier} AS INTEGER) > 0;"
        )
        day_count += 1
        d += timedelta(days=1)
        day_offset += 1

    if corrupt_date:
        lines.append(f"-- 反例：刪除 {corrupt_date.isoformat()} 的 {corrupt_period}（其餘 period 與天數維持完整）")
        lines.append(
            f"DELETE FROM daily_od_flow WHERE service_date = '{corrupt_date.isoformat()}' AND period = '{corrupt_period}';"
        )
        print(f"  [反例：少一個 period] 將刪除 {corrupt_date.isoformat()} 的 {corrupt_period}")

    output_path = os.path.join(project_root, 'scripts', 'output', f"holiday_fixture_{args.event_key}_{args.year}.sql")
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    with open(output_path, 'w', encoding='utf-8') as f:
        f.write('\n'.join(lines))

    print(f"\n[執行] 套用到 {'遠端' if args.remote else '本地'} '{args.db_name}'（{day_count} 天）...")
    _run_wrangler(
        [wrangler_bin, 'd1', 'execute', args.db_name, scope_flag, '--file', output_path],
        project_root, '合成連假 fixture',
    )
    print(f"\n完成。holiday_events 已登錄 {args.event_key}:{args.year}；daily_od_flow 已寫入 {day_count} 天。")


if __name__ == '__main__':
    main()
