#!/usr/bin/env python3
"""
測試用工具（不是正式 ETL 的一部分）——本地端合成一個「完整年度」的 daily_od_flow fixture。

用途：Phase 3A 的年度推薦需要一個真正涵蓋 365/366 天的 daily_od_flow 資料集才能驗證
「yearly OD aggregate correctness」與「yearly PageRank 全站 correctness」，但下載 12 個月
的真實 291MB CSV 不切實際。這支腳本改用已經在本地 D1 的 2026-01（31 天，真實資料，
Phase 2A 匯入）當模板，用 SQL INSERT...SELECT 依日期重新映射＋逐月不同倍率，
合成一個明確標示為測試用的年份（預設 2027，一個專案時間軸上還沒有任何真實資料的年份）。

每個月倍率不同，避免十二個月的資料變成同一份資料的十二份複製——這樣年度聚合／PageRank
算出來的結果才有意義驗證「不是巧合等於某個月」，而是真的把十二個月加總後重新算。

用法：
  python3 scripts/build_year_fixture.py --year 2027 --local
  python3 scripts/build_year_fixture.py --year 2027 --local --incomplete-months 3   # 只填 9 個月，測試 incomplete 分支
  python3 scripts/build_year_fixture.py --year 2027 --local --corrupt-period 03-15:evening_peak
      # 反例 fixture：365/366 天都有資料（distinct service_date 數完整），
      # 但其中一天刻意刪掉一個 period——用來驗證 Phase 3A.1 收緊後的完整性判定
      # 「同時看 service_date × period」不會被舊版「只看 distinct 天數」的判定誤判為完整。
"""

import argparse
import calendar as _cal
import os
import subprocess
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from import_od_data import _wrangler_bin, _run_wrangler  # noqa: E402

# 每個月一個倍率，刻意不對稱，讓十二個月互相可區分
MONTH_MULTIPLIERS = {
    1: 1.00, 2: 0.82, 3: 1.15, 4: 0.94, 5: 1.08, 6: 1.22,
    7: 1.35, 8: 1.28, 9: 1.02, 10: 0.97, 11: 1.11, 12: 1.44,
}


def main():
    parser = argparse.ArgumentParser(description='合成一個完整年度的本地 daily_od_flow 測試 fixture')
    parser.add_argument('--year', type=int, default=2027, help='合成的目標年份（預設 2027，避免與任何真實資料年份衝突）')
    parser.add_argument('--db-name', dest='db_name', type=str, default='mrt-rank-db')
    scope = parser.add_mutually_exclusive_group(required=True)
    scope.add_argument('--local', action='store_true')
    scope.add_argument('--remote', action='store_true')
    parser.add_argument(
        '--incomplete-months', type=int, default=0,
        help='只填入前 (12-N) 個月，刻意留 N 個月空缺，用來測試 incomplete-year 分支（預設 0＝完整年度）'
    )
    parser.add_argument(
        '--corrupt-period', type=str, default='',
        help='格式 MM-DD:period，建完整年度後再刪掉該日該 period 的所有列，用來測試「天數完整但缺 period」反例'
    )
    args = parser.parse_args()

    corrupt_date = corrupt_period = None
    if args.corrupt_period:
        try:
            date_part, corrupt_period = args.corrupt_period.split(':', 1)
            corrupt_date = date_part
            if corrupt_period not in {
                'morning_peak', 'morning', 'noon', 'afternoon', 'evening_peak', 'night'
            }:
                raise ValueError
        except ValueError:
            print('錯誤：--corrupt-period 格式必須是 MM-DD:period，例如 03-15:evening_peak', file=sys.stderr)
            sys.exit(1)

    project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    wrangler_bin = _wrangler_bin(project_root)
    scope_flag = '--remote' if args.remote else '--local'
    months_to_fill = 12 - args.incomplete_months
    if not (1 <= months_to_fill <= 12):
        print('錯誤：--incomplete-months 必須在 0-11 之間', file=sys.stderr)
        sys.exit(1)

    year = args.year
    print(f"\n{'='*64}")
    print(f"  合成年度 fixture：{year} 年（{months_to_fill}/12 個月，來源模板 2026-01）")
    print(f"{'='*64}\n")

    lines = [f"DELETE FROM daily_od_flow WHERE service_date BETWEEN '{year}-01-01' AND '{year}-12-31';"]
    for month in range(1, months_to_fill + 1):
        days_in_month = _cal.monthrange(year, month)[1]
        source_end = f"2026-01-{min(days_in_month, 31):02d}"
        multiplier = MONTH_MULTIPLIERS[month]
        lines.append(
            f"-- {year}-{month:02d}（{days_in_month} 天，倍率 {multiplier}）"
        )
        lines.append(
            "INSERT INTO daily_od_flow (from_station_id, to_station_id, service_date, period, flow_count) "
            "SELECT from_station_id, to_station_id, "
            f"'{year}-{month:02d}-' || substr(service_date, 9, 2), period, "
            f"CAST(flow_count * {multiplier} AS INTEGER) "
            f"FROM daily_od_flow WHERE service_date BETWEEN '2026-01-01' AND '{source_end}' "
            f"AND CAST(flow_count * {multiplier} AS INTEGER) > 0;"
        )

    if corrupt_date and corrupt_period:
        target_date = f"{year}-{corrupt_date}"
        lines.append(f"-- 反例注入：刪除 {target_date} 的 {corrupt_period}（其餘 period 與天數維持完整）")
        lines.append(
            f"DELETE FROM daily_od_flow WHERE service_date = '{target_date}' AND period = '{corrupt_period}';"
        )
        print(f"  [反例] 將刪除 {target_date} 的 {corrupt_period}（distinct 天數不受影響，只少一個 period）")

    output_path = os.path.join(project_root, 'scripts', 'output', f"year_fixture_{year}.sql")
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    with open(output_path, 'w', encoding='utf-8') as f:
        f.write('\n'.join(lines))

    print(f"[執行] 套用到 {'遠端' if args.remote else '本地'} '{args.db_name}'...")
    _run_wrangler(
        [wrangler_bin, 'd1', 'execute', args.db_name, scope_flag, '--file', output_path],
        project_root, '合成年度 fixture',
    )
    print(f"\n完成。{months_to_fill}/12 個月已寫入 daily_od_flow（{year} 年）。")
    if corrupt_date and corrupt_period:
        print(f"     已刻意刪除 {year}-{corrupt_date} 的 {corrupt_period}，用於驗證 service_date × period 完整性判定。")


if __name__ == '__main__':
    main()
