#!/usr/bin/env python3
"""
MetroPulse — monthly OD data availability checker（只讀，不寫 D1／R2，不下載完整 CSV）
================================================================================

用途：定期（見 .github/workflows/monthly-data-check.yml）確認官方台北捷運 OD 資料集
是否已發布「production 目前最新月份的下一個月」，讓後續的 production import 有明確的
人工觸發時機，而不是每次都要手動去官網確認。

做的事：
  1. 透過 production 網站自己的公開唯讀 API（GET /api/analytics/months，不需要任何
     Cloudflare 憑證）取得目前 production 已匯入的最新月份。
  2. 算出下一個月，用與 import_od_data.py 完全相同的 URL 規則（直接 import 該函式，
     避免規則兩邊各自維護、日後漂移）組出候選 CSV URL。
  3. 對候選 URL 發 HTTP HEAD（不是 GET），只看是否存在與檔案大小，不下載任何 CSV 內容。

明確不做的事：不寫 daily_od_flow／range_*／holiday_events，不上傳 R2，不下載 CSV 本體，
不觸發 import_od_data.py。這支腳本的唯一輸出是「有沒有新月份可以匯入」這個判斷。

用法：
  python3 scripts/check_latest_od_month.py
  python3 scripts/check_latest_od_month.py --base-url https://metro-go.pages.dev
  python3 scripts/check_latest_od_month.py --year 2026 --month 8   # 覆蓋「目前最新月份」，供測試
  python3 scripts/check_latest_od_month.py --github-output          # 額外寫入 $GITHUB_OUTPUT

輸出（stdout 最後一行，供 CI 直接 grep）：
  RESULT=NO_NEW_DATA | RESULT=NEW_MONTH_AVAILABLE | RESULT=ERROR

Exit code：
  0 — 檢查本身成功執行（不論結果是 NO_NEW_DATA 或 NEW_MONTH_AVAILABLE）
  1 — 檢查過程發生錯誤（網路失敗、API 回應不可解析等），不代表「沒有新資料」
"""

import argparse
import json
import os
import sys
import urllib.error
import urllib.request
from datetime import date

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from import_od_data import build_url  # noqa: E402 — 與 production import 共用同一份 URL 規則


DEFAULT_BASE_URL = 'https://metro-go.pages.dev'
DEFAULT_TIMEOUT = 20


def next_month(year: int, month: int) -> tuple[int, int]:
    if month == 12:
        return year + 1, 1
    return year, month + 1


def get_latest_production_month(base_url: str, timeout: int) -> tuple[int, int]:
    """讀 production 網站自己的公開唯讀 API，取得目前已匯入的最新月份。不需要任何 Cloudflare 憑證——
    這是給一般使用者用的 HTTPS 公開端點，跟直接查詢 D1 資料庫是兩回事。"""
    url = f"{base_url.rstrip('/')}/api/analytics/months"
    req = urllib.request.Request(url, headers={'User-Agent': 'metropulse-availability-checker'})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        payload = json.load(resp)
    if not payload.get('success') or not payload.get('months'):
        raise RuntimeError(f"/api/analytics/months 回應不含任何月份資料：{json.dumps(payload, ensure_ascii=False)[:200]}")
    latest = max(payload['months'], key=lambda m: (m['year'], m['month']))
    return latest['year'], latest['month']


def check_upstream_availability(year: int, month: int, timeout: int) -> tuple[bool, dict]:
    """對候選月份的官方 CSV URL 發 HEAD 請求，只確認存在與大小，不下載內容。"""
    url = build_url(year, month)
    req = urllib.request.Request(url, method='HEAD', headers={'User-Agent': 'metropulse-availability-checker'})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            status = resp.status
            content_length = resp.headers.get('Content-Length')
            last_modified = resp.headers.get('Last-Modified')
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return False, {'url': url, 'http_status': 404}
        raise
    if status != 200:
        return False, {'url': url, 'http_status': status}
    return True, {
        'url': url,
        'http_status': status,
        'content_length_bytes': int(content_length) if content_length else None,
        'last_modified': last_modified,
    }


def write_github_output(pairs: dict) -> None:
    gh_output = os.environ.get('GITHUB_OUTPUT')
    if not gh_output:
        return
    with open(gh_output, 'a', encoding='utf-8') as f:
        for k, v in pairs.items():
            f.write(f"{k}={v}\n")


def main() -> int:
    parser = argparse.ArgumentParser(description='MetroPulse — monthly OD data availability checker（只讀）')
    parser.add_argument('--base-url', type=str, default=DEFAULT_BASE_URL,
                         help=f'production 網站 base URL（預設 {DEFAULT_BASE_URL}），用來查詢目前最新已匯入月份')
    parser.add_argument('--year', type=int, default=None, help='覆蓋「目前最新月份」的年份，供測試用；需與 --month 同時提供')
    parser.add_argument('--month', type=int, default=None, help='覆蓋「目前最新月份」的月份，供測試用；需與 --year 同時提供')
    parser.add_argument('--timeout', type=int, default=DEFAULT_TIMEOUT, help=f'HTTP timeout 秒數（預設 {DEFAULT_TIMEOUT}）')
    parser.add_argument('--github-output', action='store_true', help='額外把結果寫入 $GITHUB_OUTPUT（GitHub Actions step output）')
    args = parser.parse_args()

    if (args.year is None) != (args.month is None):
        print('[錯誤] --year 與 --month 必須同時提供或同時省略', file=sys.stderr)
        return 1

    print(f"{'='*64}")
    print(f"  MetroPulse — monthly OD data availability check")
    print(f"  執行時間（UTC）：{date.today().isoformat()}")
    print(f"{'='*64}\n")

    try:
        if args.year is not None:
            latest_year, latest_month = args.year, args.month
            print(f"[1/2] 使用手動指定的目前最新月份：{latest_year}-{latest_month:02d}（略過查詢 {args.base_url}）")
        else:
            print(f"[1/2] 查詢 production 目前最新月份（{args.base_url}/api/analytics/months）...")
            latest_year, latest_month = get_latest_production_month(args.base_url, args.timeout)
            print(f"  production 目前最新月份：{latest_year}-{latest_month:02d}")

        n_year, n_month = next_month(latest_year, latest_month)
        print(f"\n[2/2] 檢查下一個月（{n_year}-{n_month:02d}）的官方 CSV 是否已發布（HEAD request，不下載）...")
        available, info = check_upstream_availability(n_year, n_month, args.timeout)

        print(f"  URL: {info['url']}")
        print(f"  HTTP status: {info['http_status']}")
        if available:
            size_mb = (info['content_length_bytes'] / 1_000_000) if info.get('content_length_bytes') else None
            print(f"  Content-Length: {info.get('content_length_bytes')}" + (f"（≈{size_mb:.1f} MB）" if size_mb else ""))
            print(f"  Last-Modified: {info.get('last_modified')}")

        result = 'NEW_MONTH_AVAILABLE' if available else 'NO_NEW_DATA'
        print(f"\n{'✅' if available else 'ℹ️ '} {result}"
              + (f"：{n_year}-{n_month:02d} 資料已發布，可安排 production import。"
                 if available else f"：{n_year}-{n_month:02d} 尚未發布，暫無需動作。"))

        write_github_output({
            'result': result,
            'latest_year': latest_year,
            'latest_month': latest_month,
            'next_year': n_year,
            'next_month': n_month,
            'next_month_label': f"{n_year}-{n_month:02d}",
            'csv_url': info['url'],
        }) if args.github_output else None

        print(f"\nRESULT={result}")
        return 0

    except Exception as e:
        print(f"\n[錯誤] 檢查過程失敗：{e}", file=sys.stderr)
        write_github_output({'result': 'ERROR', 'error_message': str(e)}) if args.github_output else None
        print(f"\nRESULT=ERROR")
        return 1


if __name__ == '__main__':
    sys.exit(main())
