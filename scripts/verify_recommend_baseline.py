#!/usr/bin/env python3
"""
MetroPulse — 推薦分數回歸基準驗證
======================================================

Temporal Final Audit（docs/data/temporal-final-audit.md）P1-3 指出：`BL11→night→food` 這組
推薦基準過去六個 phase 全部只靠人工 curl 比對、寫進文件敘述，沒有任何自動化能在 CI 或本地
一鍵抓到分數 regression。這支腳本把這個基準（以及可能之後追加的其他基準）變成一個可重跑、
non-zero exit 的檢查。

**這支腳本刻意不重新實作計分邏輯**——它打的是真正在跑的 `/api/recommend` HTTP 端點（預設
`http://localhost:5180`，需要先用 `npm run dev` 或等效方式啟動 dev server），驗證的是「整條
路徑」（DB → recommender.ts → API 回應），不是「純函式在真空中算出同樣的數字」。這與
`verify_range_parity.py`/`verify_year_parity.py`/`verify_holiday_parity.py` 直接查 D1 的做法
不同，是刻意的選擇：分數 regression 最可能的來源是 API 層或資料層的意外改動，不是
`recommender.ts` 本身（那支函式本來就受版本控制與 code review 保護）。

同時比對 station id **與** total_score（不是只看 id 順序）——分數本身的漂移（例如某個維度的
normalize 範圍被意外改變）不會改變排序，但會被這支腳本的分數容忍度檢查抓到。

用法：
  python3 scripts/verify_recommend_baseline.py
  python3 scripts/verify_recommend_baseline.py --base-url http://localhost:5180
  python3 scripts/verify_recommend_baseline.py --base-url https://staging.example.com
"""

import argparse
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request

SCORE_TOLERANCE = 0.005  # API 回傳的 total_score 四捨五入到小數點後兩位；允許浮點運算誤差

# 每一組基準：查詢條件 + 期望的 Top N（依名次排序，station_id 與 total_score 都要對上）。
# 新增基準時只需要在這個清單多加一個 dict，不需要改動下面的驗證邏輯。
BASELINES = [
    {
        'name': 'BL11 → night → food（Phase 1 起沿用至今的既有基準）',
        'params': {'from': 'BL11', 'time_period': 'night', 'preference': 'food'},
        'expected_data_source': 'real',
        'expected_top5': [
            ('BL12', 0.79),
            ('BL10', 0.38),
            ('R11', 0.38),
            ('BL18', 0.37),
            ('BL15', 0.33),
        ],
    },
]


def fetch_json(url: str, timeout: float = 20.0) -> dict:
    req = urllib.request.Request(url, headers={'User-Agent': 'MetroPulse-BaselineCheck/1.0'})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode('utf-8'))
    except urllib.error.HTTPError as e:
        # /api/recommend 在錯誤情境下也回傳 JSON body（見 recommend.ts），一併讀出來方便診斷
        try:
            return json.loads(e.read().decode('utf-8'))
        except Exception:
            print(f"[錯誤] HTTP {e.code}，且回應不是合法 JSON：{url}", file=sys.stderr)
            sys.exit(1)
    except urllib.error.URLError as e:
        print(f"[錯誤] 無法連線到 {url}：{e.reason}", file=sys.stderr)
        print("       請先啟動 dev server（例如 npm run dev），或用 --base-url 指向已在執行的環境。", file=sys.stderr)
        sys.exit(1)


def main():
    parser = argparse.ArgumentParser(description='驗證推薦分數基準（BL11→night→food 等）是否 regression')
    parser.add_argument('--base-url', default='http://localhost:5180',
                         help='MetroPulse 服務的 base URL（預設 http://localhost:5180，即本地 dev server）')
    parser.add_argument('--output', type=str, default='',
                         help='驗證報告輸出路徑（預設 scripts/output/recommend_baseline_report.json）')
    args = parser.parse_args()

    project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    base_url = args.base_url.rstrip('/')

    report = {'base_url': base_url, 'baselines': [], 'failures': []}

    def check(scope: str, name: str, ok: bool, detail: str = '') -> None:
        status = 'PASS' if ok else 'FAIL'
        print(f"  [{status}] {name}" + (f" — {detail}" if detail else ''))
        if not ok:
            report['failures'].append(f"{scope}: {name}" + (f" — {detail}" if detail else ''))

    print(f"\n{'='*70}")
    print(f"  推薦分數回歸基準驗證（base_url={base_url}）")
    print(f"{'='*70}\n")

    for baseline in BASELINES:
        print(f"[{baseline['name']}]")
        query = urllib.parse.urlencode(baseline['params'])
        url = f"{base_url}/api/recommend?{query}"
        data = fetch_json(url)

        entry = {'name': baseline['name'], 'url': url, 'checks': []}
        scope = baseline['name']

        def entry_check(name: str, ok: bool, detail: str = '') -> None:
            entry['checks'].append({'name': name, 'ok': ok, 'detail': detail})
            check(scope, name, ok, detail)

        entry_check('success == true', data.get('success') is True, json.dumps(data)[:300] if not data.get('success') else '')

        if not data.get('success'):
            report['baselines'].append(entry)
            continue

        actual_source = (data.get('metadata') or {}).get('data_source')
        entry_check(
            f"data_source == '{baseline['expected_data_source']}'",
            actual_source == baseline['expected_data_source'],
            f"實際值：{actual_source}",
        )

        recs = data.get('recommendations') or []
        expected_top = baseline['expected_top5']
        entry_check(
            f"回傳至少 {len(expected_top)} 筆推薦",
            len(recs) >= len(expected_top),
            f"實際筆數：{len(recs)}",
        )

        for i, (expected_id, expected_score) in enumerate(expected_top):
            if i >= len(recs):
                entry_check(f"第 {i+1} 名存在", False, f"回應只有 {len(recs)} 筆")
                continue
            rec = recs[i]
            actual_id = (rec.get('station') or {}).get('id')
            actual_score = rec.get('total_score')

            entry_check(
                f"第 {i+1} 名站點 id == {expected_id}",
                actual_id == expected_id,
                f"實際值：{actual_id}",
            )

            score_ok = (
                isinstance(actual_score, (int, float))
                and abs(actual_score - expected_score) < SCORE_TOLERANCE
            )
            entry_check(
                f"第 {i+1} 名 total_score ≈ {expected_score}（容忍度 {SCORE_TOLERANCE}）",
                score_ok,
                f"實際值：{actual_score}",
            )

        report['baselines'].append(entry)
        print()

    print(f"{'='*70}")
    all_ok = len(report['failures']) == 0
    if all_ok:
        print("  結論：PASS — 所有基準的站點順序與分數皆與記錄值相符，沒有偵測到 regression")
    else:
        print(f"  結論：FAIL — {len(report['failures'])} 項檢查失敗：")
        for f in report['failures']:
            print(f"    - {f}")
    print(f"{'='*70}\n")

    output_path = args.output or os.path.join(project_root, 'scripts', 'output', 'recommend_baseline_report.json')
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(report, f, ensure_ascii=False, indent=2)
    print(f"報告已寫入：{output_path}")

    sys.exit(0 if all_ok else 1)


if __name__ == '__main__':
    main()
