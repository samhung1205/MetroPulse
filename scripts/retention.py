#!/usr/bin/env python3
"""
MetroPulse — daily_od_flow rolling retention（decision 2）
================================================================

政策：`daily_od_flow`（逐日粒度）採 rolling N 個月（預設 18 個月）保留窗口；
`real_od_flow`／`real_pagerank`／`range_od_flow`／`range_pagerank`／`date_ranges`／`data_months`
（月度／未來的年度／連假聚合結果）**永久保留，這支腳本永遠不會、也沒有能力刪除它們**——
它產生的 SQL 只有一種形態：`DELETE FROM daily_od_flow WHERE service_date < ?`，
沒有任何路徑觸碰其他表。

這個政策也是 decision 3（custom date range 只保證在仍有逐日粒度的日期範圍內可計算）
的資料層基礎：`--dry-run`／`--purge` 都會回報「執行後，daily_od_flow 目前還涵蓋哪個
日期區間」，這個區間就是未來 custom range 功能應該拿來檢查查詢範圍是否可行的依據。

用法：
  python3 scripts/retention.py --dry-run                              # 預設：只回報，不刪除
  python3 scripts/retention.py --dry-run --window-months 24           # 調整保留窗口再預覽
  python3 scripts/retention.py --purge                                # 實際刪除窗口外的 daily_od_flow 列
  python3 scripts/retention.py --purge --remote --db-name mrt-rank-db
"""

import argparse
import json
import os
import subprocess
import sys
from datetime import date, timedelta


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
    payload = json.loads(result.stdout)
    return payload[0]['results']


def d1_exec(sql: str, project_root: str, remote: bool, db_name: str) -> dict:
    wrangler_bin = _wrangler_bin(project_root)
    cmd = [wrangler_bin, 'd1', 'execute', db_name, '--json',
           '--remote' if remote else '--local', '--command', sql]
    env = os.environ.copy()
    env.setdefault('CI', '1')
    result = subprocess.run(cmd, cwd=project_root, env=env, capture_output=True, text=True)
    if result.returncode != 0:
        print(f"[錯誤] 執行失敗：{sql[:160]}...", file=sys.stderr)
        print(result.stderr, file=sys.stderr)
        sys.exit(1)
    return json.loads(result.stdout)[0]


def months_ago(today: date, n: int) -> date:
    """回傳 today 往前推 n 個月的同一天（day-of-month 超過目標月天數時夾到月底）。"""
    year = today.year
    month = today.month - n
    while month <= 0:
        month += 12
        year -= 1
    import calendar as _cal
    last_day = _cal.monthrange(year, month)[1]
    day = min(today.day, last_day)
    return date(year, month, day)


def permanent_table_counts(project_root: str, remote: bool, db_name: str) -> dict:
    """永久保留表的列數快照，purge 前後都會印出來，讓「這些表完全沒被動過」肉眼可驗證。"""
    row = d1_query(
        "SELECT "
        "(SELECT COUNT(*) FROM real_od_flow) AS real_od_flow, "
        "(SELECT COUNT(*) FROM real_pagerank) AS real_pagerank, "
        "(SELECT COUNT(*) FROM range_od_flow) AS range_od_flow, "
        "(SELECT COUNT(*) FROM range_pagerank) AS range_pagerank, "
        "(SELECT COUNT(*) FROM date_ranges) AS date_ranges, "
        "(SELECT COUNT(*) FROM data_months) AS data_months",
        project_root, remote, db_name,
    )[0]
    return row


def main():
    parser = argparse.ArgumentParser(description='daily_od_flow rolling retention（永久保留 monthly/range 聚合）')
    parser.add_argument('--window-months', type=int, default=18, help='保留窗口（月），預設 18')
    action = parser.add_mutually_exclusive_group()
    action.add_argument('--dry-run', action='store_true', help='只回報，不刪除（未指定 --purge 時的預設行為）')
    action.add_argument('--purge', action='store_true', help='實際執行刪除')
    parser.add_argument('--remote', action='store_true')
    parser.add_argument('--db-name', dest='db_name', type=str, default='mrt-rank-db')
    parser.add_argument('--as-of', type=str, default='', help='以指定日期（YYYY-MM-DD）取代「今天」計算窗口，供測試使用')
    args = parser.parse_args()

    do_purge = args.purge
    project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

    today = date.fromisoformat(args.as_of) if args.as_of else date.today()
    cutoff = months_ago(today, args.window_months)
    cutoff_str = cutoff.isoformat()

    print(f"\n{'='*64}")
    print(f"  daily_od_flow retention — 保留窗口 {args.window_months} 個月")
    print(f"  基準日：{today.isoformat()}　cutoff（含 cutoff 當天在內都保留)：{cutoff_str}")
    print(f"  模式：{'PURGE（實際刪除）' if do_purge else 'DRY-RUN（不會刪除任何資料）'}")
    print(f"{'='*64}\n")

    before = permanent_table_counts(project_root, args.remote, args.db_name)
    print("[確認] 永久保留表目前列數（操作前）：")
    print(f"  {json.dumps(before, ensure_ascii=False)}")

    scope = d1_query(
        f"SELECT COUNT(*) as rows_to_purge, MIN(service_date) as earliest, MAX(service_date) as latest, "
        f"COUNT(DISTINCT substr(service_date,1,7)) as distinct_months "
        f"FROM daily_od_flow WHERE service_date < '{cutoff_str}'",
        project_root, args.remote, args.db_name,
    )[0]

    remaining_window = d1_query(
        f"SELECT MIN(service_date) as earliest, MAX(service_date) as latest, COUNT(*) as rows "
        f"FROM daily_od_flow WHERE service_date >= '{cutoff_str}'",
        project_root, args.remote, args.db_name,
    )[0]

    print(f"\n[範圍] 窗口外（service_date < {cutoff_str}），將{'被刪除' if do_purge else '會被刪除（dry-run，尚未執行）'}：")
    print(f"  {scope['rows_to_purge']:,} 列，涵蓋 {scope['distinct_months']} 個月份"
          f"（{scope['earliest']} ~ {scope['latest']}）" if scope['rows_to_purge'] else "  0 列——目前沒有任何資料落在保留窗口之外。")

    print(f"\n[範圍] 窗口內（service_date >= {cutoff_str}），{'將' if not do_purge else '執行後仍'}保留：")
    print(f"  {remaining_window['rows']:,} 列（{remaining_window['earliest']} ~ {remaining_window['latest']}）")

    if not scope['rows_to_purge']:
        print("\n沒有需要清理的資料，結束。")
        return

    if not do_purge:
        print(f"\n這是 dry-run：以上是「如果現在執行 --purge」會發生的事，尚未刪除任何資料。")
        print(f"monthly/range 聚合表（real_*/range_*/date_ranges/data_months）不受任何影響——")
        print(f"這支腳本產生的唯一 DELETE 目標是 daily_od_flow，其餘表完全沒有對應的刪除路徑。")
        return

    print(f"\n[執行] DELETE FROM daily_od_flow WHERE service_date < '{cutoff_str}' ...")
    result = d1_exec(
        f"DELETE FROM daily_od_flow WHERE service_date < '{cutoff_str}'",
        project_root, args.remote, args.db_name,
    )
    changes = result.get('meta', {}).get('changes')
    print(f"  已刪除 {changes if changes is not None else scope['rows_to_purge']} 列。")

    after = permanent_table_counts(project_root, args.remote, args.db_name)
    print("\n[確認] 永久保留表列數（操作後，必須與操作前完全相同）：")
    print(f"  {json.dumps(after, ensure_ascii=False)}")
    if after != before:
        print("\n🚨 CRITICAL：永久保留表的列數在 purge 前後不一致！這不應該發生，", file=sys.stderr)
        print("   請立即停止使用這個結果並回報——retention 腳本理論上不可能觸碰這些表。", file=sys.stderr)
        sys.exit(1)
    print("  ✅ 與操作前完全相同，monthly/range 聚合資料未受影響。")

    final_window = d1_query(
        "SELECT MIN(service_date) as earliest, MAX(service_date) as latest, COUNT(*) as rows FROM daily_od_flow",
        project_root, args.remote, args.db_name,
    )[0]
    print(f"\n[結果] daily_od_flow 目前可用的逐日粒度範圍（decision 3 custom range 的可行性依據）：")
    print(f"  {final_window['earliest']} ~ {final_window['latest']}（共 {final_window['rows']:,} 列）")
    print()


if __name__ == '__main__':
    main()
