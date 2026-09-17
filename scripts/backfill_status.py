#!/usr/bin/env python3
"""
MetroPulse — daily-granularity backfill status report
========================================================

對每個已匯入月份（data_months）回報是否已經有對應的逐日粒度資料
（daily_od_flow → date_ranges(range_type='month') → range_od_flow/range_pagerank）。

這是 backfill workflow 的「起點」：在決定要不要對某個月執行 backfill 之前，
先用這支腳本確認它目前的狀態，避免對已經有逐日資料的月份做不必要的重複工作，
也避免漏掉還停留在月加總粒度、無法納入未來 year/holiday/custom range 聚合的月份。

用法：
  python3 scripts/backfill_status.py [--remote] [--db-name mrt-rank-db]

backfill 一個月份的標準流程（見 docs/data/temporal-phase2b-hardening.md「Historical backfill」）：
  1. python3 scripts/backfill_status.py            — 確認這個月份目前缺逐日資料
  2. 取得該月原始 CSV（重新下載，或使用已封存的本地副本，見 provenance 段落）
  3. python3 scripts/import_od_data.py --year Y --month M --csv-file <path> --apply-local（先在本地驗證）
  4. python3 scripts/verify_range_parity.py --year Y --month M          — 確認新舊管線一致
  5. 確認無誤後才對 remote 執行同樣的 --apply-remote
  6. python3 scripts/backfill_status.py --remote   — 確認該月份狀態已更新為「已有逐日資料」
"""

import argparse
import json
import os
import subprocess
import sys


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
        print(f"[錯誤] 查詢失敗：{sql[:120]}...", file=sys.stderr)
        print(result.stderr, file=sys.stderr)
        sys.exit(1)
    payload = json.loads(result.stdout)
    return payload[0]['results']


def main():
    parser = argparse.ArgumentParser(description='回報各月份是否已有逐日粒度資料（daily_od_flow）')
    parser.add_argument('--remote', action='store_true')
    parser.add_argument('--db-name', dest='db_name', type=str, default='mrt-rank-db')
    args = parser.parse_args()

    project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

    months = d1_query(
        "SELECT year, month, label, row_count, imported_at FROM data_months ORDER BY year, month",
        project_root, args.remote, args.db_name,
    )
    ranges = {r['range_id']: r for r in d1_query(
        "SELECT range_id, day_count, start_date, end_date, computed_at FROM date_ranges WHERE range_type='month'",
        project_root, args.remote, args.db_name,
    )}

    print(f"\n{'年月':<10}{'月加總資料':<14}{'逐日粒度':<12}{'day_count':<12}{'range 最後計算時間':<22}")
    print('-' * 70)
    missing = []
    for m in months:
        range_id = f"month:{m['year']:04d}-{m['month']:02d}"
        r = ranges.get(range_id)
        has_daily = r is not None
        if not has_daily:
            missing.append((m['year'], m['month']))
        print(
            f"{m['year']}-{m['month']:02d}      "
            f"{'✅ 有':<14}"
            f"{'✅ 有' if has_daily else '❌ 缺':<12}"
            f"{str(r['day_count']) if r else '—':<12}"
            f"{r['computed_at'] if r else '—':<22}"
        )

    print(f"\n共 {len(months)} 個月份，其中 {len(missing)} 個月份缺逐日粒度資料。")
    if missing:
        print("\n缺逐日粒度的月份（backfill 候選）：")
        for y, mo in missing:
            print(f"  python3 scripts/import_od_data.py --year {y} --month {mo} --csv-file <該月 CSV 路徑> --apply-local")
    print()


if __name__ == '__main__':
    main()
