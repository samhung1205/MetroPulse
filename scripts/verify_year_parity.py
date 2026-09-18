#!/usr/bin/env python3
"""
MetroPulse Phase 3A — yearly range correctness verification
================================================================

年度沒有像月度那樣的「舊管線」（real_od_flow/real_pagerank）可以互相比對——年度是全新計算的
range，不是從既有月度資料平均或衍生而來（decision：禁止 averaging monthly PageRank）。
因此這支腳本驗證的是「聚合本身是否正確、完整、且是唯一一次獨立計算」，具體檢查：

  1. yearly OD aggregate correctness：range_od_flow 的加總與 daily_od_flow 原始逐日資料的加總
     完全一致（總流量守恆，不多不少）——用兩種不同的 SQL 聚合路徑互相驗證，不只信任其中一種。
  2. yearly PageRank 全站 correctness：每個時段都有全部站點的列（無缺站）、pr_value 總和為 1.0
     （Power Method 的正規化不變量）、pr_rank 是 1..N 無重複的完整排列、normalized_score 落在
     [0,1] 且 min/max 端點確實有站點對應（min-max normalize 的定義性質）。
  3. year range 有被正確持久化：date_ranges 的 is_complete/day_count/expected_day_count/
     start_date/end_date/computed_at 都正確。

Phase 3A.1 新增 `--expect-incomplete`：驗證「反例」fixture（365/366 天都有資料，但其中一天缺一個
period）確實被新版完整性判定擋下——只檢查 date_ranges.is_complete=0 與 coverage_note 是否存在，
不跑第 1、2 節的 OD/PageRank 檢查（is_complete=0 時 range_od_flow/range_pagerank 本來就不會有資料）。

用法：
  python3 scripts/verify_year_parity.py --year 2027 --local
  python3 scripts/verify_year_parity.py --year 2027 --remote --db-name mrt-rank-db
  python3 scripts/verify_year_parity.py --year 2027 --local --expect-incomplete
"""

import argparse
import calendar as _cal_module
import json
import os
import subprocess
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from import_od_data import get_all_station_ids  # noqa: E402

PERIODS = ['morning_peak', 'morning', 'noon', 'afternoon', 'evening_peak', 'night']
PR_SUM_TOLERANCE = 1e-6
NORM_TOLERANCE = 1e-9


def _wrangler_bin(project_root: str) -> str:
    wrangler_local = os.path.join(project_root, 'node_modules', '.bin', 'wrangler')
    return wrangler_local if os.path.exists(wrangler_local) else 'wrangler'


def d1_query(sql: str, project_root: str, remote: bool, db_name: str) -> list[dict]:
    wrangler_bin = _wrangler_bin(project_root)
    cmd = [wrangler_bin, 'd1', 'execute', db_name, '--json',
           '--remote' if remote else '--local', '--command', sql]
    env = os.environ.copy()
    env.setdefault('CI', '1')
    result = subprocess.run(cmd, cwd=project_root, env=env, capture_output=True, text=True)
    if result.returncode != 0:
        print(f"[錯誤] 查詢失敗：{sql[:160]}...", file=sys.stderr)
        print(result.stderr, file=sys.stderr)
        sys.exit(1)
    return json.loads(result.stdout)[0]['results']


def main():
    parser = argparse.ArgumentParser(description='驗證年度 range 聚合與 PageRank 的正確性')
    parser.add_argument('--year', type=int, required=True)
    parser.add_argument('--db-name', dest='db_name', type=str, default='mrt-rank-db')
    parser.add_argument('--expect-incomplete', action='store_true',
                         help='反例模式：只驗證這個年度被正確判定為不完整（is_complete=0 且有 coverage_note），不跑 OD/PageRank 檢查')
    scope = parser.add_mutually_exclusive_group(required=True)
    scope.add_argument('--local', action='store_true')
    scope.add_argument('--remote', action='store_true')
    args = parser.parse_args()

    project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    remote = args.remote
    range_id = f"year:{args.year}"

    report = {'range_id': range_id, 'checks': [], 'failures': []}

    def check(name: str, ok: bool, detail: str = ''):
        report['checks'].append({'name': name, 'ok': ok, 'detail': detail})
        status = 'PASS' if ok else 'FAIL'
        print(f"  [{status}] {name}" + (f" — {detail}" if detail else ''))
        if not ok:
            report['failures'].append(name)

    print(f"\n{'='*70}")
    print(f"  年度 range 正確性驗證：{args.year} 年（range_id={range_id}）")
    print(f"{'='*70}\n")

    # ------------------------------------------------------------
    # 0. date_ranges 狀態
    # ------------------------------------------------------------
    print("[0/3] date_ranges 狀態記錄")
    dr_rows = d1_query(f"SELECT * FROM date_ranges WHERE range_id='{range_id}'", project_root, remote, args.db_name)
    if not dr_rows:
        check("date_ranges 存在", False, "找不到這個 range_id，後續檢查無法進行")
        sys.exit(1)
    dr = dr_rows[0]

    if args.expect_incomplete:
        # 反例模式：這個 fixture 應該「天數完整、但缺 period」——驗證 is_complete 沒有被舊版
        # 「只看 distinct 天數」的邏輯誤判為 1，且 coverage_note 有具體說明缺失原因。
        check("date_ranges.is_complete = 0（反例應被判定為不完整）", dr['is_complete'] == 0, f"實際值：{dr['is_complete']}")
        check("date_ranges.coverage_note 有值（說明缺失原因）", bool(dr.get('coverage_note')), dr.get('coverage_note') or '(空)')
        od_count = d1_query(f"SELECT COUNT(*) as c FROM range_od_flow WHERE range_id='{range_id}'", project_root, remote, args.db_name)[0]['c']
        pr_count = d1_query(f"SELECT COUNT(*) as c FROM range_pagerank WHERE range_id='{range_id}'", project_root, remote, args.db_name)[0]['c']
        check("不完整年度沒有寫入 range_od_flow", od_count == 0, f"實際筆數：{od_count}")
        check("不完整年度沒有寫入 range_pagerank", pr_count == 0, f"實際筆數：{pr_count}")
        print(f"\n{'='*70}")
        all_ok = len(report['failures']) == 0
        print(f"  結論：{'PASS — 反例確實被判定為不完整，且沒有污染 range_* 表' if all_ok else 'FAIL — 見上方標記為 FAIL 的項目'}")
        print(f"{'='*70}\n")
        report_path = os.path.join(project_root, 'scripts', 'output', f"year_parity_report_{args.year}_incomplete_{'remote' if remote else 'local'}.json")
        os.makedirs(os.path.dirname(report_path), exist_ok=True)
        with open(report_path, 'w', encoding='utf-8') as f:
            json.dump(report, f, ensure_ascii=False, indent=2)
        print(f"報告已寫入：{report_path}")
        sys.exit(0 if all_ok else 1)

    check("date_ranges.is_complete = 1", dr['is_complete'] == 1, f"實際值：{dr['is_complete']}")
    check("date_ranges.day_count == expected_day_count", dr['day_count'] == dr['expected_day_count'],
          f"day_count={dr['day_count']} expected_day_count={dr['expected_day_count']}")
    check("date_ranges.start_date 正確", dr['start_date'] == f"{args.year}-01-01", dr['start_date'])
    check("date_ranges.end_date 正確", dr['end_date'] == f"{args.year}-12-31", dr['end_date'])
    check("date_ranges.computed_at 有值", bool(dr['computed_at']), dr['computed_at'])

    # ------------------------------------------------------------
    # 1. yearly OD aggregate correctness：兩種獨立 SQL 聚合路徑互相驗證
    # ------------------------------------------------------------
    print("\n[1/3] yearly OD aggregate correctness")
    # 路徑 A：daily_od_flow 直接對整年做 SUM...GROUP BY（不透過 range_od_flow）——
    # 保持「完全獨立於 materialize_year_range.py 使用的 range_od_flow 來源」這個驗證價值。
    #
    # Year Materialization Hotfix（見 docs/data/year-materialization-production-hotfix.md）發現：
    # 對整年 daily_od_flow（production 規模 ~2200 萬列）執行單一 GROUP BY 查詢，在 remote D1 上
    # 會觸發 Cloudflare API internal error（code 7500）——即使這裡的 GROUP BY period 結果只有 6 列，
    # 錯誤一樣會發生，證實限制跟「掃描的列數」有關，不是跟「結果列數」有關。因此改成按曆月分 12 次
    # 查詢（每次只掃該月 ~200 萬列，這正是 Batch 1~4 逐月匯入時反覆驗證過可行的規模），在 Python
    # 端加總——查詢邏輯本身沒有變（還是直接掃 daily_od_flow，不透過 range_od_flow），只是把
    # 「一次掃全年」拆成「12 次各掃一個月」，兩者在數學上等價（整數加法結合律）。
    direct_totals: dict[str, int] = {p: 0 for p in PERIODS}
    for month in range(1, 13):
        month_start = f"{args.year}-{month:02d}-01"
        month_end_day = _cal_module.monthrange(args.year, month)[1]
        month_end = f"{args.year}-{month:02d}-{month_end_day:02d}"
        month_rows = d1_query(
            f"SELECT period, SUM(flow_count) as total FROM daily_od_flow "
            f"WHERE service_date BETWEEN '{month_start}' AND '{month_end}' GROUP BY period",
            project_root, remote, args.db_name)
        for r in month_rows:
            if r['period'] in direct_totals:
                direct_totals[r['period']] += r['total']
    # 路徑 B：range_od_flow（materialize_year_range.py 寫入的結果）
    range_totals = {r['period']: r['total'] for r in d1_query(
        f"SELECT period, SUM(flow_count) as total FROM range_od_flow WHERE range_id='{range_id}' GROUP BY period",
        project_root, remote, args.db_name)}
    for period in PERIODS:
        a, b = direct_totals.get(period, 0), range_totals.get(period, 0)
        check(f"OD total 守恆 [{period}]", a == b, f"daily_od_flow 直接聚合={a:,} range_od_flow={b:,}")

    total_direct = sum(direct_totals.values())
    total_range = sum(range_totals.values())
    check("OD total 守恆（全部時段加總）", total_direct == total_range, f"{total_direct:,} vs {total_range:,}")

    od_pair_count = d1_query(f"SELECT COUNT(*) as c FROM range_od_flow WHERE range_id='{range_id}'", project_root, remote, args.db_name)[0]['c']
    check(f"range_od_flow 有資料（{od_pair_count:,} 筆 OD×period 組合）", od_pair_count > 0)

    # ------------------------------------------------------------
    # 2. yearly PageRank 全站 correctness
    # ------------------------------------------------------------
    print("\n[2/3] yearly PageRank 全站 correctness")
    # 用 ETL 實際使用的「去重後站點清單」長度做基準（118 站），不是 stations 表的原始列數（136 列，
    # 含 STATION_MAP 別名對應到同一站碼前去重的重複列）——PageRank 計算的宇宙是前者，不是後者。
    station_count = len(get_all_station_ids())
    pr_rows = d1_query(
        f"SELECT period, station_id, pr_value, pr_rank, normalized_score FROM range_pagerank WHERE range_id='{range_id}'",
        project_root, remote, args.db_name)
    by_period: dict[str, list[dict]] = {p: [] for p in PERIODS}
    for r in pr_rows:
        if r['period'] in by_period:
            by_period[r['period']].append(r)

    for period in PERIODS:
        rows = by_period[period]
        check(f"[{period}] 全站無缺（{len(rows)}/{station_count} 站）", len(rows) == station_count)

        pr_sum = sum(r['pr_value'] for r in rows)
        check(f"[{period}] pr_value 總和 ≈ 1.0（Power Method 正規化不變量）",
              abs(pr_sum - 1.0) < PR_SUM_TOLERANCE, f"實際總和={pr_sum:.10f}")

        ranks = sorted(r['pr_rank'] for r in rows)
        expected_ranks = list(range(1, len(rows) + 1))
        check(f"[{period}] pr_rank 是 1..{len(rows)} 的完整排列，無重複無缺漏", ranks == expected_ranks)

        norms = [r['normalized_score'] for r in rows]
        min_norm, max_norm = min(norms), max(norms)
        check(f"[{period}] normalized_score 端點正確（min≈0, max≈1）",
              abs(min_norm - 0.0) < NORM_TOLERANCE and abs(max_norm - 1.0) < NORM_TOLERANCE,
              f"min={min_norm:.10f} max={max_norm:.10f}")

        # pr_rank 與 pr_value 排序必須一致（rank 1 = 最大 pr_value）
        sorted_by_value = sorted(rows, key=lambda r: -r['pr_value'])
        rank_matches_value_order = all(
            sorted_by_value[i]['pr_rank'] == i + 1 for i in range(len(sorted_by_value))
        )
        check(f"[{period}] pr_rank 順序與 pr_value 大小一致", rank_matches_value_order)

    print(f"\n{'='*70}")
    all_ok = len(report['failures']) == 0
    print(f"  結論：{'PASS — 年度 range 聚合與 PageRank 通過所有正確性檢查' if all_ok else 'FAIL — 見上方標記為 FAIL 的項目'}")
    print(f"{'='*70}\n")

    report_path = os.path.join(project_root, 'scripts', 'output', f"year_parity_report_{args.year}_{'remote' if remote else 'local'}.json")
    os.makedirs(os.path.dirname(report_path), exist_ok=True)
    with open(report_path, 'w', encoding='utf-8') as f:
        json.dump(report, f, ensure_ascii=False, indent=2)
    print(f"報告已寫入：{report_path}")

    sys.exit(0 if all_ok else 1)


if __name__ == '__main__':
    main()
