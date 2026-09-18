#!/usr/bin/env python3
"""
MetroPulse Phase 3B — holiday range materialization
======================================================

把 `daily_od_flow` 裡已持久化的逐日資料，依單一登錄過的連假事件（`holiday_events`）
的 [start_date, end_date] 聚合成 `range_od_flow`／`range_pagerank`
（`range_type='holiday'`，`range_id='holiday:{event_key}:{year}'`）。

沿用與 year range **完全相同**的共用管線（`import_od_data.py` 的
`compute_service_date_period_coverage()`／`fetch_range_od_aggregate()`／
`generate_range_materialization_sql()`，Phase 3B 從 materialize_year_range.py 抽出）：

    daily_od_flow → SQL SUM...GROUP BY → compute_pagerank()/normalize_pr() → range_*

不對已算好的月度／年度 PageRank 值做平均；連假的 OD 一律重新從 daily_od_flow 聚合、
重新跑一次 Power Method。

完整性（同 year range 的規則，套用在連假的 [start_date, end_date] 而不是整年）：
  連假被視為「完整」，若且唯若該區間的每一天都有資料、且每一天六個既有 period 都齊。
  不要求同一天每個 OD pair 都存在，不對缺的 period 補 0。
  - 完整：寫入 date_ranges（is_complete=1）+ range_od_flow + range_pagerank。
  - 不完整：只更新 date_ranges 狀態列，不寫入 range_od_flow/range_pagerank。

**materialized 結果永久保留**：一旦連假 range 被標記完整並寫入 range_od_flow/range_pagerank，
之後即使 daily_od_flow 被 18 個月 rolling retention（scripts/retention.py）清掉這段日期，
range_od_flow/range_pagerank 完全不受影響——retention 腳本從未、也沒有能力刪除 range_* 表
（見 retention.py 開頭說明）。這正是「歷史連假推薦在 daily 被 purge 後仍可使用」的機制。

event_key/year 必須已存在於 holiday_events（見 migrations/0007_holiday_events.sql）；
這支腳本不會自己造一個 event 出來，也不會用月份或固定國曆日期猜連假邊界——
連假的起訖日期永遠來自 holiday_events 這張人工維護的表。

用法：
  python3 scripts/materialize_holiday_range.py --event-key lunar-new-year --year 2026 --local
  python3 scripts/materialize_holiday_range.py --event-key lunar-new-year --year 2026 --remote --db-name mrt-rank-db
"""

import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from import_od_data import (  # noqa: E402
    PERIODS,
    get_all_station_ids,
    _wrangler_bin,
    _run_wrangler,
    _d1_json_query,
    compute_service_date_period_coverage,
    fetch_range_od_aggregate,
    generate_range_materialization_sql,
    get_existing_range_is_complete,
)


def get_holiday_event(event_key: str, year: int, project_root: str, db_name: str, remote: bool) -> dict | None:
    rows = _d1_json_query(
        f"SELECT * FROM holiday_events WHERE event_key = '{event_key}' AND year = {year}",
        project_root, db_name, remote,
    )
    return rows[0] if rows else None


def compute_holiday_coverage(event: dict, project_root: str, db_name: str, remote: bool) -> dict:
    start = event['start_date']
    end = event['end_date']
    from datetime import date
    expected_days = (date.fromisoformat(end) - date.fromisoformat(start)).days + 1
    coverage = compute_service_date_period_coverage(start, end, expected_days, project_root, db_name, remote)
    coverage['event_key'] = event['event_key']
    coverage['year'] = event['year']
    coverage['range_id'] = f"holiday:{event['event_key']}:{event['year']}"
    return coverage


def main():
    parser = argparse.ArgumentParser(description='把 daily_od_flow 聚合成連假 range_od_flow/range_pagerank')
    parser.add_argument('--event-key', required=True)
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
    print(f"  連假 range materialization — {args.event_key}:{args.year}（{'遠端' if remote else '本地'} '{args.db_name}'）")
    print(f"{'='*64}\n")

    print("[1/4] 查詢 holiday_events 登錄的連假日期範圍...")
    event = get_holiday_event(args.event_key, args.year, project_root, args.db_name, remote)
    if not event:
        print(f"\n[錯誤] holiday_events 找不到 event_key='{args.event_key}' year={args.year} 的登錄列。", file=sys.stderr)
        print("       連假的起訖日期必須先登錄在 holiday_events，這支腳本不會自己推算連假邊界。", file=sys.stderr)
        sys.exit(1)
    print(f"  {event['name_zh']}（{event['event_key']}:{event['year']}）：{event['start_date']} ~ {event['end_date']}"
          f"（來源：{event.get('source') or '未提供'}）")

    print("\n[2/4] 查詢 daily_od_flow 對這段日期的實際覆蓋範圍...")
    coverage = compute_holiday_coverage(event, project_root, args.db_name, remote)
    print(f"  涵蓋 {coverage['actual_day_count']}/{coverage['expected_day_count']} 天"
          f"（{coverage['actual_min_date']} ~ {coverage['actual_max_date']}）")
    print(f"  service_date × period 覆蓋：{coverage['incomplete_period_day_count']} 天沒有完整六個時段資料")
    if coverage['incomplete_period_days_sample']:
        for d in coverage['incomplete_period_days_sample'][:5]:
            print(f"    - {d['service_date']}：缺 {'、'.join(d['missing_periods']) or '（無，異常）'}")
    print(f"  完整性：{'✅ 完整連假' if coverage['is_complete'] else '⚠️  不完整——不會計算或寫入 range_od_flow/range_pagerank'}")
    if coverage['coverage_note']:
        print(f"  coverage_note：{coverage['coverage_note']}")

    if coverage['actual_day_count'] == 0:
        print("\n[結束] 這段連假在 daily_od_flow 完全沒有資料，只記錄狀態列。")
        return

    if not coverage['is_complete']:
        existing_is_complete = get_existing_range_is_complete(coverage['range_id'], project_root, args.db_name, remote)
        if existing_is_complete == 1:
            print(f"\n[CRITICAL] {event['name_zh']} {args.year} 目前在 date_ranges 已標記為完整（is_complete=1），"
                  f"range_od_flow/range_pagerank 應該已經永久保留。", file=sys.stderr)
            print(f"           但這次重新計算只看到 {coverage['actual_day_count']}/{coverage['expected_day_count']} 天"
                  f"的 daily_od_flow——很可能是 retention.py 已經 purge 掉這段日期的逐日資料。", file=sys.stderr)
            print(f"           拒絕寫入：繼續執行會把 date_ranges.is_complete 降級為 0，"
                  f"讓既有的 range_pagerank/range_od_flow 變成 API 查不到（但資料本身還在）。", file=sys.stderr)
            print(f"           已完整 materialize 過的連假不需要、也不應該重新執行這支腳本。", file=sys.stderr)
            sys.exit(1)

    station_ids = get_all_station_ids()

    if coverage['is_complete']:
        print("\n[3/4] 對 daily_od_flow 執行 SQL SUM...GROUP BY（連假區間聚合）...")
        od_by_period = fetch_range_od_aggregate(event['start_date'], event['end_date'], project_root, args.db_name, remote)
        od_total = sum(len(v) for v in od_by_period.values())
        print(f"  聚合出 {od_total:,} 筆 OD×period 組合")
    else:
        od_by_period = {p: {} for p in PERIODS}

    print("\n[4/4] 生成並套用 SQL（單一檔案，維持一般匯入的原子性）...")
    sql, range_meta = generate_range_materialization_sql(
        coverage, od_by_period, station_ids,
        range_id=coverage['range_id'],
        range_type='holiday',
        label=f"{event['year']}年{event['name_zh']}",
        holiday_event_id=event['event_key'],
    )

    output_dir = os.path.join(project_root, 'scripts', 'output')
    os.makedirs(output_dir, exist_ok=True)
    db_suffix = '' if args.db_name == 'mrt-rank-db' else f"_{args.db_name}"
    output_path = args.output or os.path.join(output_dir, f"holiday_{args.event_key}_{args.year}{db_suffix}.sql")
    with open(output_path, 'w', encoding='utf-8') as f:
        f.write(sql)

    wrangler_bin = _wrangler_bin(project_root)
    scope_flag = '--remote' if remote else '--local'
    _run_wrangler(
        [wrangler_bin, 'd1', 'execute', args.db_name, scope_flag, '--file', output_path],
        project_root, f"套用連假 range SQL（{args.db_name}）",
    )

    print(f"\n{'='*64}")
    if coverage['is_complete']:
        print(f"  ✅ {event['name_zh']} {event['year']} 已標記為完整連假，range_od_flow/range_pagerank 已寫入")
        print(f"     ({range_meta['od_count']:,} 筆 OD、{range_meta['pr_count']:,} 筆 PageRank)")
        print(f"     這份結果永久保留，不受 daily_od_flow retention purge 影響。")
    else:
        print(f"  ⚠️  {event['name_zh']} {event['year']} 目前不完整，date_ranges 已更新狀態，")
        print(f"     但**沒有**寫入 range_od_flow/range_pagerank。")
        print(f"     /api/recommend?range_type=holiday&event_key={args.event_key}&year={args.year} 應該回報不可用。")
    print(f"{'='*64}\n")


if __name__ == '__main__':
    main()
