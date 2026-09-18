#!/usr/bin/env python3
"""
MetroPulse Phase 3A — yearly range materialization
======================================================

把逐年 OD 流量聚合成 `range_od_flow`／`range_pagerank`（`range_type='year'`，
`range_id='year:{year}'`），**不對已算好的月度 PageRank 值做平均**——PageRank 不是線性
可加總的量，唯一正確做法是先把整年 OD 流量加總、重新建轉移矩陣、重新跑一次 Power Method，
這正是這支腳本做的事。

**OD 流量聚合來源（Production Year Materialization Hotfix，2026-09-18 起）**：不再直接對
整年 daily_od_flow 執行單一 `SUM...GROUP BY`——這個查詢在 remote D1 對 production 規模的
真實資料（一整年 ~2200 萬列）會觸發 Cloudflare API internal error（code 7500）。改為對
12 個月已持久化的 range_od_flow（每月匯入時就已經算好、且逐月通過 parity 驗證）做 SUM，
按 period 分 6 次查詢執行。與直接掃 daily_od_flow 數學上完全等價（整數加法結合律），
已用真實 2025 年資料（22,702,706 列）逐 OD pair、逐 PageRank 值驗證過結果逐位元組相同。
詳見 import_od_data.fetch_year_od_aggregate_from_monthly_ranges() 與
docs/data/year-materialization-production-hotfix.md。coverage/completeness 判定
（下方「完整性」一節）完全不受影響，仍然直接查 daily_od_flow。

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
    _d1_json_query,
    compute_service_date_period_coverage,
    fetch_year_od_aggregate_from_monthly_ranges,
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


def verify_all_monthly_ranges_present(year: int, project_root: str, db_name: str, remote: bool) -> list[str]:
    """Year Materialization Hotfix 安全檢查：新的年度聚合來源是 12 個月的 range_od_flow，
    不再直接掃 daily_od_flow。如果 daily_od_flow 的 service_date × period 覆蓋率顯示完整，
    但因為某種原因（例如月度 range_od_flow 沒有正確寫入）缺了其中一個月，新方法會安靜地
    算出一個少了一整個月的錯誤年度總和——不像直接查 daily_od_flow 那樣「資料在哪裡查都到」，
    所以這裡必須先明確驗證 12 個月的 range_od_flow 都真的存在，缺任何一個月就直接中止，
    不能假設「daily 完整＝月度 range 一定完整」。回傳缺少的 range_id 清單（空清單＝12 個月都在）。
    """
    expected = [f"month:{year:04d}-{m:02d}" for m in range(1, 13)]
    range_id_list = "','".join(expected)
    rows = _d1_json_query(
        f"SELECT DISTINCT range_id FROM range_od_flow WHERE range_id IN ('{range_id_list}')",
        project_root, db_name, remote,
    )
    present = {r['range_id'] for r in rows}
    return [rid for rid in expected if rid not in present]


def fetch_year_od_aggregate(year: int, project_root: str, db_name: str, remote: bool) -> dict[str, dict[tuple[str, str], int]]:
    """年度 OD 聚合：改為 SUM 12 個月的 range_od_flow（Production Year Materialization Hotfix），
    不再直接掃整年 daily_od_flow——後者在 remote D1 對 production 規模的真實資料（~2200 萬列）
    會觸發 Cloudflare API internal error（code 7500）。見
    import_od_data.fetch_year_od_aggregate_from_monthly_ranges() 的完整根因與數學等價性說明，
    以及 docs/data/year-materialization-production-hotfix.md 的正確性驗證。
    """
    return fetch_year_od_aggregate_from_monthly_ranges(year, project_root, db_name, remote)


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
        print("\n[2/3] 驗證 12 個月的 range_od_flow 都存在（Year Materialization Hotfix 安全檢查）...")
        missing_months = verify_all_monthly_ranges_present(args.year, project_root, args.db_name, remote)
        if missing_months:
            print(f"\n[CRITICAL] daily_od_flow 顯示 {args.year} 年 service_date × period 覆蓋完整，"
                  f"但以下月份的 range_od_flow 不存在：{', '.join(missing_months)}", file=sys.stderr)
            print(f"           年度聚合現在改用 12 個月的 range_od_flow 加總，缺任何一個月都會讓"
                  f"年度總和不完整——拒絕繼續，不假裝聚合得出正確結果。", file=sys.stderr)
            print(f"           請確認這些月份是否已透過 import_od_data.py 正常匯入（monthly range 應該"
                  f"隨月度匯入自動寫入），排除後再重跑本腳本。", file=sys.stderr)
            sys.exit(1)
        print(f"  ✅ 12 個月的 range_od_flow 全部存在")

        print("\n[2b/3] 對 12 個月的 range_od_flow 執行 SQL SUM...GROUP BY（按 period 分批，整年聚合）...")
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
