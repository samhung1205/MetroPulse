#!/usr/bin/env python3
"""
MetroPulse — 唯一官方 fresh-database bootstrap 流程
======================================================

背景（見 docs/data/temporal-phase2b-hardening.md 第 1.1 節）：
migration `0003_add_r01_guangci.sql` 會插入引用既有站點的 travel_costs/pagerank_scores 列，
但基礎站點資料來自 seed.sql——一個獨立於 migrations 系統之外、只有本地開發資料庫因為
很久以前手動跑過才「恰好」有資料的檔案。任何全新資料庫只跑 `wrangler d1 migrations apply`
會在 0003 卡住（FOREIGN KEY constraint failed），而且錯誤訊息不會直接指向根因。

本腳本是「不修改既有 migration 檔案本身」前提下的官方修復：
利用 wrangler 對 migrations 的追蹤機制（失敗的 migration 不會被標記為已套用，
下次呼叫 `migrations apply` 會重試它），做出一個三步驟、冪等、可重複執行的 bootstrap 序列：

  1. wrangler d1 migrations apply   —— 套用 0001、0002；預期在全新資料庫上會在 0003 卡住（正常現象）
  2. wrangler d1 execute --file=seed.sql —— 補齊基礎站點資料（INSERT OR IGNORE，冪等）
  3. wrangler d1 migrations apply   —— 重試，這次 0003（現在能通過 FK 檢查）與 0004 應該成功

對已經完整 bootstrap 過的資料庫重複執行本腳本是安全的：
  step 1 回報「沒有 migration 需要套用」、step 2 的 INSERT OR IGNORE 對已存在的列是無害的
  no-op、step 3 同樣回報「沒有 migration 需要套用」——整個流程冪等，可以放心當作
  「不確定資料庫是不是全新的，就跑一次 bootstrap」的萬用指令。

用法：
  python3 scripts/bootstrap_db.py --local
  python3 scripts/bootstrap_db.py --remote --db-name mrt-rank-db
  python3 scripts/bootstrap_db.py --remote --db-name <可拋棄的測試資料庫>   # 驗證用
"""

import argparse
import json
import os
import subprocess
import sys


def _wrangler_bin(project_root: str) -> str:
    wrangler_local = os.path.join(project_root, 'node_modules', '.bin', 'wrangler')
    return wrangler_local if os.path.exists(wrangler_local) else 'wrangler'


def _run(cmd: list[str], project_root: str, label: str, allow_failure: bool = False) -> tuple[int, str, str]:
    env = os.environ.copy()
    env.setdefault('CI', '1')
    print(f"\n[{label}] 執行：{' '.join(cmd)}", flush=True)
    result = subprocess.run(cmd, cwd=project_root, env=env, capture_output=True, text=True)
    if result.stdout:
        print(result.stdout)
    if result.stderr:
        print(result.stderr, file=sys.stderr)
    if result.returncode != 0 and not allow_failure:
        print(f"\n[錯誤] {label} 失敗（exit code {result.returncode}），bootstrap 中止。", file=sys.stderr)
        sys.exit(1)
    return result.returncode, result.stdout, result.stderr


def main():
    parser = argparse.ArgumentParser(description='MetroPulse 唯一官方 fresh-database bootstrap 流程')
    parser.add_argument('--db-name', dest='db_name', type=str, default='mrt-rank-db')
    scope = parser.add_mutually_exclusive_group(required=True)
    scope.add_argument('--local', action='store_true')
    scope.add_argument('--remote', action='store_true')
    args = parser.parse_args()

    project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    wrangler_bin = _wrangler_bin(project_root)
    scope_flag = '--remote' if args.remote else '--local'
    scope_label = '遠端' if args.remote else '本地'

    print(f"\n{'='*64}")
    print(f"  MetroPulse DB Bootstrap — {scope_label} 資料庫 '{args.db_name}'")
    print(f"{'='*64}")

    # Step 1：第一次套用 migrations。全新資料庫預期在 0003 卡住（seed 資料尚未存在），
    # 這裡刻意允許失敗——失敗本身不代表 bootstrap 失敗，是流程的一部分。
    code1, out1, _ = _run(
        [wrangler_bin, 'd1', 'migrations', 'apply', args.db_name, scope_flag],
        project_root, 'Step 1/3：首次套用 migrations（預期可能在 0003 卡住）',
        allow_failure=True,
    )
    if code1 != 0:
        print("  → 依預期：0003 需要 seed.sql 先提供基礎站點資料，繼續 Step 2。")
    else:
        print("  → 全部 migrations 已成功套用（可能是已 bootstrap 過的資料庫，或本次剛好不需要 seed 相依）。")

    # Step 2：補齊基礎站點資料。INSERT OR IGNORE，對已有資料的資料庫是安全的 no-op。
    seed_path = os.path.join(project_root, 'seed.sql')
    if not os.path.exists(seed_path):
        print(f"\n[錯誤] 找不到 {seed_path}，無法完成 bootstrap。", file=sys.stderr)
        sys.exit(1)
    _run(
        [wrangler_bin, 'd1', 'execute', args.db_name, scope_flag, '--file', seed_path],
        project_root, 'Step 2/3：套用 seed.sql（基礎站點資料，INSERT OR IGNORE）',
    )

    # Step 3：重試 migrations。這次必須完全成功（沒有 seed 相依阻擋了）。
    _run(
        [wrangler_bin, 'd1', 'migrations', 'apply', args.db_name, scope_flag],
        project_root, 'Step 3/3：重試 migrations（必須全部成功）',
    )

    # 驗證：四張 Phase 2A 新表、基礎站點數都應該存在。
    print("\n[驗證] 確認 bootstrap 後的資料庫狀態...")
    check_cmd = [
        wrangler_bin, 'd1', 'execute', args.db_name, scope_flag, '--json', '--command',
        "SELECT "
        "(SELECT COUNT(*) FROM stations) AS stations, "
        "(SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='daily_od_flow') AS has_daily_od_flow, "
        "(SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='date_ranges') AS has_date_ranges, "
        "(SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='range_od_flow') AS has_range_od_flow, "
        "(SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='range_pagerank') AS has_range_pagerank"
    ]
    env = os.environ.copy()
    env.setdefault('CI', '1')
    result = subprocess.run(check_cmd, cwd=project_root, env=env, capture_output=True, text=True)
    if result.returncode != 0:
        print(f"[錯誤] 驗證查詢失敗：{result.stderr}", file=sys.stderr)
        sys.exit(1)
    row = json.loads(result.stdout)[0]['results'][0]
    ok = (
        row['stations'] > 0
        and row['has_daily_od_flow'] == 1
        and row['has_date_ranges'] == 1
        and row['has_range_od_flow'] == 1
        and row['has_range_pagerank'] == 1
    )
    print(json.dumps(row, ensure_ascii=False, indent=2))
    if not ok:
        print("\n[錯誤] 驗證未通過——資料庫狀態不完整，請檢查上方輸出。", file=sys.stderr)
        sys.exit(1)

    print(f"\n{'='*64}")
    print(f"  ✅ Bootstrap 完成：'{args.db_name}'（{scope_label}）已具備完整 schema 與基礎站點資料。")
    print(f"{'='*64}\n")


if __name__ == '__main__':
    main()
