#!/usr/bin/env python3
"""
MetroPulse Phase 3A — yearly range materialization
======================================================

把 `daily_od_flow` 裡已經持久化的逐日資料，依整個曆年聚合成 `range_od_flow`／`range_pagerank`
（`range_type='year'`，`range_id='year:{year}'`），沿用與月度 range 完全相同的管線設計
（`daily_od_flow` → SQL `SUM...GROUP BY` → `compute_pagerank()`/`normalize_pr()`），
**不對已算好的月度 PageRank 值做平均**——PageRank 不是線性可加總的量，唯一正確做法是
先把整年 OD 流量加總、重新建轉移矩陣、重新跑一次 Power Method，這正是這支腳本做的事。

完整性（decision：只有完整年度資料才可標成完整年度；Phase 3A.1 收緊為同時驗證 service_date × period）：
  一個年度被視為「完整」，若且唯若同時滿足：
    1. `daily_od_flow` 對該年份 1/1 ~ 12/31（或閏年 12/31）的**每一天**都至少有一列資料
       ——不是「有 12 個月份的資料就好」，因為 Phase 2A 已知某些月份可能只有部分日期被匯入。
    2. 每個有資料的日期，六個既有 `period`（見 import_od_data.PERIODS）都必須各至少有一列
       ——只看 distinct service_date 數會漏掉「某天只匯入 5 個 period」這種情況，年度加總會悄悄
       用不完整的一天當作完整的一天。**不要求同一天的每個 OD pair 都存在**（OD pair 本來就會隨
       人流自然缺席），也**不對缺的 period 補 0**——缺 period 的日期直接讓整個年度判定為不完整。
  缺哪一天、缺哪個 period，記錄進 `date_ranges.coverage_note`（見 migrations/0006），
  讓「為什麼不完整」有具體、機器產生的原因，不是一個裸的 is_complete=0。

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
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from import_od_data import (  # noqa: E402
    PERIODS,
    get_all_station_ids,
    _wrangler_bin,
    _run_wrangler,
    compute_service_date_period_coverage,
    fetch_range_od_aggregate,
    generate_range_materialization_sql,
    get_existing_range_is_complete,
)


def compute_year_coverage(year: int, project_root: str, db_name: str, remote: bool) -> dict:
    """年度是「service_date × period 完整性檢查」套用在 1/1~12/31 這個日期區間的特例；
    共用邏輯見 import_od_data.compute_service_date_period_coverage()
    （Phase 3B 抽出，供 materialize_holiday_range.py 共用，不是重寫）。"""
    start = f"{year:04d}-01-01"
    end = f"{year:04d}-12-31"
    expected_days = 366 if _cal.isleap(year) else 365
    coverage = compute_service_date_period_coverage(start, end, expected_days, project_root, db_name, remote)
    coverage['year'] = year
    coverage['range_id'] = f"year:{year}"
    return coverage


def fetch_year_od_aggregate(year: int, project_root: str, db_name: str, remote: bool) -> dict[str, dict[tuple[str, str], int]]:
    start = f"{year:04d}-01-01"
    end = f"{year:04d}-12-31"
    return fetch_range_od_aggregate(start, end, project_root, db_name, remote)


def generate_year_sql(coverage: dict, od_by_period: dict, station_ids: list[str]) -> tuple[str, dict]:
    return generate_range_materialization_sql(
        coverage, od_by_period, station_ids,
        range_id=coverage['range_id'],
        range_type='year',
        label=f"{coverage['year']}年（全年）",
        holiday_event_id=None,
    )


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
    print(f"  service_date × period 覆蓋：{coverage['incomplete_period_day_count']} 天沒有完整六個時段資料")
    if coverage['incomplete_period_days_sample']:
        for d in coverage['incomplete_period_days_sample'][:5]:
            print(f"    - {d['service_date']}：缺 {'、'.join(d['missing_periods']) or '（無，異常）'}")
        if coverage['incomplete_period_day_count'] > len(coverage['incomplete_period_days_sample']):
            print(f"    - ...（僅列出前 {len(coverage['incomplete_period_days_sample'])} 筆範例）")
    print(f"  完整性：{'✅ 完整年度' if coverage['is_complete'] else '⚠️  不完整——不會計算或寫入 range_od_flow/range_pagerank'}")
    if coverage['coverage_note']:
        print(f"  coverage_note：{coverage['coverage_note']}")

    if coverage['actual_day_count'] == 0:
        print("\n[結束] 這個年份在 daily_od_flow 完全沒有資料，只記錄狀態列（不存在的年份不會出現在 date_ranges）。")
        print("       不寫入 date_ranges（沒有任何資料代表這個年份從未被匯入，不應該假裝有一列狀態記錄）。")
        return

    if not coverage['is_complete']:
        existing_is_complete = get_existing_range_is_complete(coverage['range_id'], project_root, args.db_name, remote)
        if existing_is_complete == 1:
            print(f"\n[CRITICAL] {args.year} 年目前在 date_ranges 已標記為完整（is_complete=1），"
                  f"range_od_flow/range_pagerank 應該已經永久保留。", file=sys.stderr)
            print(f"           但這次重新計算只看到 {coverage['actual_day_count']}/{coverage['expected_day_count']} 天"
                  f"的 daily_od_flow——很可能是 retention.py 已經 purge 掉這段日期的逐日資料。", file=sys.stderr)
            print(f"           拒絕寫入：繼續執行會把 date_ranges.is_complete 降級為 0，"
                  f"讓既有的 range_pagerank/range_od_flow 變成 API 查不到（但資料本身還在）。", file=sys.stderr)
            print(f"           已完整 materialize 過的年度不需要、也不應該重新執行這支腳本。", file=sys.stderr)
            sys.exit(1)

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
