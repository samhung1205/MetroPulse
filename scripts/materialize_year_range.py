#!/usr/bin/env python3
"""
MetroPulse Phase 3A — yearly range materialization
======================================================

把 `daily_od_flow` 裡已經持久化的逐日資料，依整個曆年聚合成 `range_od_flow`／`range_pagerank`
（`range_type='year'`，`range_id='year:{year}'`），沿用與月度 range 完全相同的管線設計
（`daily_od_flow` → SQL `SUM...GROUP BY` → `compute_pagerank()`/`normalize_pr()`），
**不對已算好的月度 PageRank 值做平均**——PageRank 不是線性可加總的量，唯一正確做法是
先把整年 OD 流量加總、重新建轉移矩陣、重新跑一次 Power Method，這正是這支腳本做的事。

完整性（decision：只有完整年度資料才可標成完整年度）：
  一個年度被視為「完整」，若且唯若 `daily_od_flow` 對該年份 1/1 ~ 12/31（或閏年 12/31）
  的**每一天**都至少有一列資料——不是「有 12 個月份的資料就好」，因為 Phase 2A 已知某些月份
  可能只有部分日期被匯入（見 date_ranges.day_count 的既有語意）。

  - 完整：寫入 date_ranges（is_complete=1）+ range_od_flow + range_pagerank，可被 API 使用。
  - 不完整：**只**更新 date_ranges 的狀態列（is_complete=0，準確記錄目前涵蓋天數），
    **不寫入** range_od_flow／range_pagerank——這樣任何查詢路徑都不可能意外讀到
    一個用不完整資料算出來、卻沒有明確標示的 PageRank 結果。不插值、不假裝、不補 0。

用法：
  python3 scripts/materialize_year_range.py --year 2027 --local
  python3 scripts/materialize_year_range.py --year 2027 --remote --db-name mrt-rank-db
  python3 scripts/materialize_year_range.py --year 2027 --local --force-incomplete   # 測試用：即使不完整也印出診斷，不寫入 range_*
"""

import argparse
import calendar as _cal
import json
import os
import subprocess
import sys
from collections import defaultdict
from datetime import datetime

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from import_od_data import (  # noqa: E402
    PERIODS,
    compute_pagerank,
    normalize_pr,
    get_all_station_ids,
    _wrangler_bin,
    _run_wrangler,
    _d1_json_query,
    _batched_insert_lines,
)


def compute_year_coverage(year: int, project_root: str, db_name: str, remote: bool) -> dict:
    start = f"{year:04d}-01-01"
    end = f"{year:04d}-12-31"
    row = _d1_json_query(
        f"SELECT MIN(service_date) as min_date, MAX(service_date) as max_date, "
        f"COUNT(DISTINCT service_date) as distinct_dates "
        f"FROM daily_od_flow WHERE service_date BETWEEN '{start}' AND '{end}'",
        project_root, db_name, remote,
    )[0]
    expected_days = 366 if _cal.isleap(year) else 365
    distinct_dates = row['distinct_dates'] or 0
    is_complete = (
        distinct_dates == expected_days
        and row['min_date'] == start
        and row['max_date'] == end
    )
    return {
        'year': year,
        'range_id': f"year:{year}",
        'start_date': start,
        'end_date': end,
        'expected_day_count': expected_days,
        'actual_day_count': distinct_dates,
        'actual_min_date': row['min_date'],
        'actual_max_date': row['max_date'],
        'is_complete': is_complete,
    }


def fetch_year_od_aggregate(year: int, project_root: str, db_name: str, remote: bool) -> dict[str, dict[tuple[str, str], int]]:
    """對已持久化的 daily_od_flow 執行真正的 SQL SUM...GROUP BY（不是 Python 端重算）。"""
    start = f"{year:04d}-01-01"
    end = f"{year:04d}-12-31"
    rows = _d1_json_query(
        f"SELECT from_station_id, to_station_id, period, SUM(flow_count) as total "
        f"FROM daily_od_flow WHERE service_date BETWEEN '{start}' AND '{end}' "
        f"GROUP BY from_station_id, to_station_id, period",
        project_root, db_name, remote,
    )
    od_by_period: dict[str, dict[tuple[str, str], int]] = {p: defaultdict(int) for p in PERIODS}
    for r in rows:
        if r['period'] in od_by_period:
            od_by_period[r['period']][(r['from_station_id'], r['to_station_id'])] = r['total']
    return od_by_period


def generate_year_sql(coverage: dict, od_by_period: dict, station_ids: list[str]) -> tuple[str, dict]:
    range_id = coverage['range_id']
    year = coverage['year']
    ts = datetime.now().isoformat(timespec='seconds')
    label = f"{year}年（全年）"
    is_complete_flag = 1 if coverage['is_complete'] else 0

    lines = []
    lines.append(f"-- date_ranges（range_type='year'，range_id={range_id}）")
    lines.append(
        "INSERT OR REPLACE INTO date_ranges "
        "(range_id, range_type, start_date, end_date, holiday_event_id, label, day_count, computed_at, is_complete, expected_day_count) "
        f"VALUES ('{range_id}', 'year', '{coverage['start_date']}', '{coverage['end_date']}', NULL, '{label}', "
        f"{coverage['actual_day_count']}, '{ts}', {is_complete_flag}, {coverage['expected_day_count']});"
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
            print(f"  [range:{period}] 計算 PageRank（{len(od_flows)} OD 對，來源整年 daily_od_flow SQL 聚合）...", flush=True)
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
            f"-- 年度資料不完整（{coverage['actual_day_count']}/{coverage['expected_day_count']} 天），"
            f"只更新 date_ranges 狀態列，不寫入 range_od_flow/range_pagerank。"
        )

    lines.append("")
    lines.append(f"-- 年度 range 處理完成：range_id={range_id}，is_complete={coverage['is_complete']}，{od_count} 筆 OD、{pr_count} 筆 PageRank")

    return '\n'.join(lines), {
        'range_id': range_id, 'od_count': od_count, 'pr_count': pr_count,
        'range_pr_by_period': range_pr_by_period,
    }


def main():
    parser = argparse.ArgumentParser(description='把 daily_od_flow 聚合成年度 range_od_flow/range_pagerank')
    parser.add_argument('--year', type=int, required=True)
    parser.add_argument('--db-name', dest='db_name', type=str, default='mrt-rank-db')
    scope = parser.add_mutually_exclusive_group(required=True)
    scope.add_argument('--local', action='store_true')
    scope.add_argument('--remote', action='store_true')
    parser.add_argument('--output', type=str, default='')
    args = parser.parse_args()

    project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    remote = args.remote

    print(f"\n{'='*64}")
    print(f"  年度 range materialization — {args.year} 年（{'遠端' if remote else '本地'} '{args.db_name}'）")
    print(f"{'='*64}\n")

    print("[1/3] 查詢 daily_od_flow 對這個年份的實際覆蓋範圍...")
    coverage = compute_year_coverage(args.year, project_root, args.db_name, remote)
    print(f"  涵蓋 {coverage['actual_day_count']}/{coverage['expected_day_count']} 天"
          f"（{coverage['actual_min_date']} ~ {coverage['actual_max_date']}）")
    print(f"  完整性：{'✅ 完整年度' if coverage['is_complete'] else '⚠️  不完整——不會計算或寫入 range_od_flow/range_pagerank'}")

    if coverage['actual_day_count'] == 0:
        print("\n[結束] 這個年份在 daily_od_flow 完全沒有資料，只記錄狀態列（不存在的年份不會出現在 date_ranges）。")
        print("       不寫入 date_ranges（沒有任何資料代表這個年份從未被匯入，不應該假裝有一列狀態記錄）。")
        return

    station_ids = get_all_station_ids()

    if coverage['is_complete']:
        print("\n[2/3] 對 daily_od_flow 執行 SQL SUM...GROUP BY（整年聚合）...")
        od_by_period = fetch_year_od_aggregate(args.year, project_root, args.db_name, remote)
        od_total = sum(len(v) for v in od_by_period.values())
        print(f"  聚合出 {od_total:,} 筆 OD×period 組合")
    else:
        od_by_period = {p: {} for p in PERIODS}

    print("\n[3/3] 生成並套用 SQL（單一檔案，維持一般匯入的原子性——不是 maintenance re-import）...")
    sql, range_meta = generate_year_sql(coverage, od_by_period, station_ids)

    output_dir = os.path.join(project_root, 'scripts', 'output')
    os.makedirs(output_dir, exist_ok=True)
    db_suffix = '' if args.db_name == 'mrt-rank-db' else f"_{args.db_name}"
    output_path = args.output or os.path.join(output_dir, f"year_{args.year}{db_suffix}.sql")
    with open(output_path, 'w', encoding='utf-8') as f:
        f.write(sql)

    wrangler_bin = _wrangler_bin(project_root)
    scope_flag = '--remote' if remote else '--local'
    _run_wrangler(
        [wrangler_bin, 'd1', 'execute', args.db_name, scope_flag, '--file', output_path],
        project_root, f"套用年度 range SQL（{args.db_name}）",
    )

    print(f"\n{'='*64}")
    if coverage['is_complete']:
        print(f"  ✅ {args.year} 年已標記為完整年度，range_od_flow/range_pagerank 已寫入")
        print(f"     ({range_meta['od_count']:,} 筆 OD、{range_meta['pr_count']:,} 筆 PageRank)")
    else:
        print(f"  ⚠️  {args.year} 年目前不完整（{coverage['actual_day_count']}/{coverage['expected_day_count']} 天），")
        print(f"     date_ranges 已更新狀態，但**沒有**寫入 range_od_flow/range_pagerank。")
        print(f"     /api/recommend?range_type=year&year={args.year} 應該回報這個年份不可用。")
    print(f"{'='*64}\n")


if __name__ == '__main__':
    main()
