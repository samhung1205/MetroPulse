#!/usr/bin/env python3
"""
MetroPulse Phase 2A — old-vs-new pipeline parity verification
================================================================

比較兩條獨立管線在同一個月份的輸出：

  OLD：real_od_flow / real_pagerank
       （CSV 掃描時直接按 period 累加，Phase 1 以前就存在、目前 API 仍在讀的表）

  NEW：range_od_flow / range_pagerank（range_type='month'）
       （daily_od_flow → SQL SUM GROUP BY → compute_pagerank()）

驗證項目：
  1. 各 period OD totals（range_od_flow.flow_count 加總 vs real_od_flow.flow_count 加總）
  2. representative OD pairs（逐筆比對，不只是加總）
  3. all station PageRank values（全站，不只 Top 5）
  4. ranks
  5. normalized values
  6. 額外：對 daily_od_flow 表本身執行真正的 SQL SUM GROUP BY，
     驗證資料庫端聚合出的結果，而不只是信任 Python 記憶體裡的計算。

用法：
  python3 scripts/verify_range_parity.py --year 2026 --month 1 [--remote]
"""

import argparse
import json
import subprocess
import sys
import os

PERIODS = ['morning_peak', 'morning', 'noon', 'afternoon', 'evening_peak', 'night']

# PageRank 值本身是 150 次 Power Method 迭代的浮點運算結果；OD 流量是整數加總。
# 見 docs/data/temporal-phase2a-implementation.md 的「old-vs-new parity」段落對此容忍度的完整推導：
# 因為所有原始流量都是可被 float64 精確表示的整數，且新舊兩條管線的分組彙總只是把同一組整數
# 用不同順序相加，總和理論上應逐位元組相同；下面容忍度是安全邊界，不是「因為浮點數所以放寬」的藉口。
OD_TOLERANCE = 0          # 整數，必須完全相等
PR_ABS_TOLERANCE = 1e-9   # pr_value / normalized_score 絕對誤差
PR_REL_TOLERANCE = 1e-6   # 相對誤差（保險用，理論上不會用到）


def _wrangler_bin(project_root: str) -> str:
    wrangler_local = os.path.join(project_root, 'node_modules', '.bin', 'wrangler')
    return wrangler_local if os.path.exists(wrangler_local) else 'wrangler'


def d1_query(sql: str, project_root: str, remote: bool, db_name: str = 'mrt-rank-db') -> list[dict]:
    wrangler_bin = _wrangler_bin(project_root)
    cmd = [wrangler_bin, 'd1', 'execute', db_name, '--json',
           '--remote' if remote else '--local', '--command', sql]
    env = os.environ.copy()
    env.setdefault('CI', '1')
    result = subprocess.run(cmd, cwd=project_root, env=env, capture_output=True, text=True)
    if result.returncode != 0:
        print(f"[錯誤] 查詢失敗：{sql[:120]}...", file=sys.stderr)
        print(result.stderr, file=sys.stderr)
        sys.exit(1)
    payload = json.loads(result.stdout)
    return payload[0]['results']


def main():
    parser = argparse.ArgumentParser(description='驗證 OLD (real_*) 與 NEW (range_*) 月度管線輸出等價')
    parser.add_argument('--year', type=int, required=True)
    parser.add_argument('--month', type=int, required=True)
    parser.add_argument('--remote', action='store_true')
    parser.add_argument('--db-name', dest='db_name', type=str, default='mrt-rank-db',
                         help="目標 D1 資料庫名稱（預設 'mrt-rank-db'）。維運驗證時應指定可拋棄的測試資料庫。")
    args = parser.parse_args()

    project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    range_id = f"month:{args.year:04d}-{args.month:02d}"

    report = {
        'range_id': range_id,
        'checks': [],
        'failures': [],
    }

    def check(name: str, ok: bool, detail: str = ''):
        report['checks'].append({'name': name, 'ok': ok, 'detail': detail})
        status = 'PASS' if ok else 'FAIL'
        print(f"  [{status}] {name}" + (f" — {detail}" if detail else ''))
        if not ok:
            report['failures'].append(name)

    print(f"\n{'='*70}")
    print(f"  Parity 驗證：{args.year}年{args.month}月（range_id={range_id}）")
    print(f"{'='*70}\n")

    # ------------------------------------------------------------
    # 1. 各 period OD totals：range_od_flow vs real_od_flow
    # ------------------------------------------------------------
    print("[1/6] 各 period OD totals（range_od_flow vs real_od_flow）")
    old_totals = {r['period']: r['total'] for r in d1_query(
        f"SELECT period, SUM(flow_count) as total FROM real_od_flow "
        f"WHERE year={args.year} AND month={args.month} GROUP BY period", project_root, args.remote, args.db_name)}
    new_totals = {r['period']: r['total'] for r in d1_query(
        f"SELECT period, SUM(flow_count) as total FROM range_od_flow "
        f"WHERE range_id='{range_id}' GROUP BY period", project_root, args.remote, args.db_name)}
    for period in PERIODS:
        old_v, new_v = old_totals.get(period, 0), new_totals.get(period, 0)
        check(f"OD total [{period}]", old_v == new_v, f"old={old_v:,} new={new_v:,}")

    # ------------------------------------------------------------
    # 2. representative OD pairs — 全部逐筆比對（非只取樣），因為本月 OD 對數量
    #    （~71k）在 D1 單次查詢範圍內是可行的，逐筆比對比「代表性抽樣」更嚴謹。
    # ------------------------------------------------------------
    print("\n[2/6] OD pairs 逐筆比對（real_od_flow ⨝ range_od_flow）")
    mismatches = d1_query(
        f"""
        SELECT o.from_station_id, o.to_station_id, o.period,
               o.flow_count AS old_flow, r.flow_count AS new_flow
        FROM real_od_flow o
        LEFT JOIN range_od_flow r
          ON r.range_id = '{range_id}'
         AND r.from_station_id = o.from_station_id
         AND r.to_station_id = o.to_station_id
         AND r.period = o.period
        WHERE o.year = {args.year} AND o.month = {args.month}
          AND (r.flow_count IS NULL OR r.flow_count != o.flow_count)
        """, project_root, args.remote, args.db_name)
    missing_in_old = d1_query(
        f"""
        SELECT r.from_station_id, r.to_station_id, r.period, r.flow_count
        FROM range_od_flow r
        LEFT JOIN real_od_flow o
          ON o.year = {args.year} AND o.month = {args.month}
         AND o.from_station_id = r.from_station_id
         AND o.to_station_id = r.to_station_id
         AND o.period = r.period
        WHERE r.range_id = '{range_id}' AND o.flow_count IS NULL
        """, project_root, args.remote, args.db_name)
    total_od_pairs = d1_query(
        f"SELECT COUNT(*) as c FROM real_od_flow WHERE year={args.year} AND month={args.month}",
        project_root, args.remote, args.db_name)[0]['c']
    check(
        f"OD pairs exact match（{total_od_pairs:,} 筆全數逐筆比對，非抽樣）",
        len(mismatches) == 0 and len(missing_in_old) == 0,
        f"mismatched={len(mismatches)} only_in_range={len(missing_in_old)}"
    )
    for m in mismatches[:10]:
        print(f"    差異：{m}")

    # ------------------------------------------------------------
    # 3-5. all station PageRank values / ranks / normalized values — 全站，逐筆比對
    # ------------------------------------------------------------
    print("\n[3-5/6] PageRank 值／排名／正規化分數（全站逐筆比對，非 Top 5）")
    pr_rows = d1_query(
        f"""
        SELECT o.station_id, o.period,
               o.pr_value AS old_pr, r.pr_value AS new_pr,
               o.pr_rank AS old_rank, r.pr_rank AS new_rank,
               o.normalized_score AS old_norm, r.normalized_score AS new_norm
        FROM real_pagerank o
        LEFT JOIN range_pagerank r
          ON r.range_id = '{range_id}'
         AND r.station_id = o.station_id
         AND r.period = o.period
        WHERE o.year = {args.year} AND o.month = {args.month}
        """, project_root, args.remote, args.db_name)

    total_pr_rows = len(pr_rows)
    pr_missing = [r for r in pr_rows if r['new_pr'] is None]
    pr_value_bad = []
    pr_rank_bad = []
    pr_norm_bad = []
    max_abs_diff = 0.0
    max_rel_diff = 0.0
    for r in pr_rows:
        if r['new_pr'] is None:
            continue
        old_pr, new_pr = float(r['old_pr']), float(r['new_pr'])
        abs_diff = abs(old_pr - new_pr)
        rel_diff = abs_diff / abs(old_pr) if old_pr != 0 else abs_diff
        max_abs_diff = max(max_abs_diff, abs_diff)
        max_rel_diff = max(max_rel_diff, rel_diff)
        if abs_diff > PR_ABS_TOLERANCE and rel_diff > PR_REL_TOLERANCE:
            pr_value_bad.append((r['station_id'], r['period'], old_pr, new_pr, abs_diff))
        if r['old_rank'] != r['new_rank']:
            pr_rank_bad.append((r['station_id'], r['period'], r['old_rank'], r['new_rank']))
        old_norm, new_norm = float(r['old_norm']), float(r['new_norm'])
        if abs(old_norm - new_norm) > PR_ABS_TOLERANCE:
            pr_norm_bad.append((r['station_id'], r['period'], old_norm, new_norm))

    check(
        f"PageRank rows present（{total_pr_rows} 筆，應為 118 站 × 6 期 = 708）",
        len(pr_missing) == 0,
        f"missing_in_range={len(pr_missing)}"
    )
    check(
        f"pr_value 全站逐筆比對（容忍度：abs<{PR_ABS_TOLERANCE} 或 rel<{PR_REL_TOLERANCE}）",
        len(pr_value_bad) == 0,
        f"超出容忍度筆數={len(pr_value_bad)}，觀測到的最大絕對誤差={max_abs_diff:.3e}，最大相對誤差={max_rel_diff:.3e}"
    )
    check(
        "pr_rank 全站逐筆比對（必須完全相等）",
        len(pr_rank_bad) == 0,
        f"不相等筆數={len(pr_rank_bad)}"
    )
    check(
        f"normalized_score 全站逐筆比對（容忍度：abs<{PR_ABS_TOLERANCE}）",
        len(pr_norm_bad) == 0,
        f"超出容忍度筆數={len(pr_norm_bad)}"
    )
    for row in (pr_value_bad + pr_rank_bad + pr_norm_bad)[:10]:
        print(f"    差異：{row}")

    # ------------------------------------------------------------
    # 6. 對 daily_od_flow 執行真正的 SQL SUM GROUP BY，再跟 real_od_flow 比對——
    #    這一步不信任 ETL 腳本記憶體裡的聚合結果，而是驗證「資料庫裡已經落地的逐日資料」
    #    本身聚合起來是否等於舊管線的月加總，避免只是驗證 ETL 腳本自己跟自己一致。
    # ------------------------------------------------------------
    print("\n[6/6] 對 daily_od_flow 執行獨立 SQL 聚合，直接跟 real_od_flow 比對（不經過 range_od_flow）")
    last_day = 31 if args.month in (1, 3, 5, 7, 8, 10, 12) else (30 if args.month != 2 else 28)
    # 用資料庫裡實際的月份邊界，不寫死日曆規則：直接取這個 range 的 start/end
    date_range = d1_query(f"SELECT start_date, end_date FROM date_ranges WHERE range_id='{range_id}'", project_root, args.remote, args.db_name)
    if not date_range:
        check("date_ranges 存在", False, "找不到 range_id，略過 daily 獨立聚合驗證")
    else:
        start_date, end_date = date_range[0]['start_date'], date_range[0]['end_date']
        daily_sum_rows = d1_query(
            f"""
            SELECT from_station_id, to_station_id, period, SUM(flow_count) as total
            FROM daily_od_flow
            WHERE service_date BETWEEN '{start_date}' AND '{end_date}'
            GROUP BY from_station_id, to_station_id, period
            """, project_root, args.remote, args.db_name)
        daily_sum_by_key = {(r['from_station_id'], r['to_station_id'], r['period']): r['total'] for r in daily_sum_rows}

        real_rows = d1_query(
            f"SELECT from_station_id, to_station_id, period, flow_count FROM real_od_flow "
            f"WHERE year={args.year} AND month={args.month}", project_root, args.remote, args.db_name)
        direct_mismatches = []
        for r in real_rows:
            key = (r['from_station_id'], r['to_station_id'], r['period'])
            daily_sum = daily_sum_by_key.pop(key, None)
            if daily_sum != r['flow_count']:
                direct_mismatches.append((key, r['flow_count'], daily_sum))
        # daily_sum_by_key 剩下的是 daily 聚合裡有、real_od_flow 沒有的 key
        check(
            f"daily_od_flow SQL SUM 直接對比 real_od_flow（{len(real_rows):,} 筆）",
            len(direct_mismatches) == 0 and len(daily_sum_by_key) == 0,
            f"不相符={len(direct_mismatches)}，daily 端多出={len(daily_sum_by_key)}"
        )
        for row in direct_mismatches[:10]:
            print(f"    差異：{row}")

    print(f"\n{'='*70}")
    all_ok = len(report['failures']) == 0
    print(f"  結論：{'PASS — 兩條管線在此月份完全等價' if all_ok else 'FAIL — 見上方標記為 FAIL 的項目'}")
    print(f"{'='*70}\n")

    db_suffix = '' if args.db_name == 'mrt-rank-db' else f"_{args.db_name}"
    scope_suffix = '_remote' if args.remote else '_local'
    report_path = os.path.join(
        project_root, 'scripts', 'output',
        f"parity_report_{args.year}{args.month:02d}{scope_suffix}{db_suffix}.json"
    )
    os.makedirs(os.path.dirname(report_path), exist_ok=True)
    with open(report_path, 'w', encoding='utf-8') as f:
        json.dump(report, f, ensure_ascii=False, indent=2)
    print(f"報告已寫入：{report_path}")

    sys.exit(0 if all_ok else 1)


if __name__ == '__main__':
    main()
