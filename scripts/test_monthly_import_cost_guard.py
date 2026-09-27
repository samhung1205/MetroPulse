#!/usr/bin/env python3
"""Local/mock regression tests for the monthly production import cost guard.

These tests never invoke Wrangler, never access Cloudflare, and never import production data.
"""

import contextlib
import io
import pathlib
import sqlite3
import sys
import unittest
from unittest import mock

import import_od_data as importer


ROOT = pathlib.Path(__file__).resolve().parents[1]
WORKFLOW_PATH = ROOT / '.github' / 'workflows' / 'monthly-data-import.yml'


def month_status(*, complete: bool = False, partial: bool = False) -> dict:
    status = {
        'year': 2026,
        'month': 9,
        'month_start': '2026-09-01',
        'month_end': '2026-09-30',
        'expected_day_count': 30,
        'expected_pagerank_count': 708,
        'range_id': 'month:2026-09',
        'data_months_count': 0,
        'real_od_flow_count': 0,
        'real_pagerank_count': 0,
        'daily_row_count': 0,
        'daily_day_count': 0,
        'complete_period_day_count': 0,
        'daily_start_date': None,
        'daily_end_date': None,
        'date_range_count': 0,
        'month_range_count': 0,
        'range_start_date': None,
        'range_end_date': None,
        'range_day_count': None,
        'range_od_flow_count': 0,
        'range_pagerank_count': 0,
    }
    if complete:
        status.update({
            'data_months_count': 1,
            'real_od_flow_count': 70000,
            'real_pagerank_count': 708,
            'daily_row_count': 1900000,
            'daily_day_count': 30,
            'complete_period_day_count': 30,
            'daily_start_date': '2026-09-01',
            'daily_end_date': '2026-09-30',
            'date_range_count': 1,
            'month_range_count': 1,
            'range_start_date': '2026-09-01',
            'range_end_date': '2026-09-30',
            'range_day_count': 30,
            'range_od_flow_count': 70000,
            'range_pagerank_count': 708,
        })
    elif partial:
        status.update({
            'data_months_count': 1,
            'daily_row_count': 123,
            'daily_day_count': 1,
            'complete_period_day_count': 1,
            'daily_start_date': '2026-09-01',
            'daily_end_date': '2026-09-01',
        })
    return status


class MonthlyImportCostGuardTests(unittest.TestCase):
    def test_preflight_query_runs_against_empty_local_mock_schema(self):
        db = sqlite3.connect(':memory:')
        db.row_factory = sqlite3.Row
        db.executescript('''
            CREATE TABLE data_months (year INTEGER, month INTEGER);
            CREATE TABLE real_od_flow (year INTEGER, month INTEGER);
            CREATE TABLE real_pagerank (year INTEGER, month INTEGER);
            CREATE TABLE daily_od_flow (service_date TEXT, period TEXT);
            CREATE TABLE date_ranges (
                range_id TEXT, range_type TEXT, start_date TEXT, end_date TEXT, day_count INTEGER
            );
            CREATE TABLE range_od_flow (range_id TEXT);
            CREATE TABLE range_pagerank (range_id TEXT);
        ''')

        def local_query(sql, _project_root, _db_name, _remote):
            return [dict(db.execute(sql).fetchone())]

        with mock.patch.object(importer, '_d1_json_query', side_effect=local_query):
            status = importer.query_month_import_status(2026, 9, str(ROOT), 'mock-db', remote=False)
        self.assertEqual(importer.classify_month_import_status(status), importer.IMPORT_STATE_NEW)
        db.close()

    def test_new_month_is_allowed_and_logs_expected_operation(self):
        with mock.patch.object(importer, 'query_month_import_status', return_value=month_status()):
            output = io.StringIO()
            with contextlib.redirect_stdout(output):
                importer.run_month_import_preflight(
                    2026, 9, str(ROOT), 'mrt-rank-db', remote=True, maintenance_reimport=False,
                )
        log = output.getvalue()
        self.assertIn('existing_month_status = ABSENT', log)
        self.assertIn('operation = NEW IMPORT', log)
        self.assertIn('maintenance_reimport = false', log)
        self.assertIn('COST_SAFETY_PREFLIGHT_PASS', log)

    def test_existing_complete_month_stops_before_import(self):
        with self.assertRaises(importer.MonthImportBlocked) as caught:
            importer.enforce_month_import_guard(month_status(complete=True), maintenance_reimport=False)
        self.assertEqual(caught.exception.marker, 'MONTH_ALREADY_IMPORTED')

    def test_blocked_main_never_reads_csv(self):
        blocked = importer.MonthImportBlocked('MONTH_ALREADY_IMPORTED', 'already complete')
        argv = ['import_od_data.py', '--year', '2026', '--month', '9', '--apply-remote']
        with (
            mock.patch.object(sys, 'argv', argv),
            mock.patch.object(importer, 'run_month_import_preflight', side_effect=blocked),
            mock.patch.object(importer, 'process_csv_stream') as process_csv,
            contextlib.redirect_stdout(io.StringIO()),
            contextlib.redirect_stderr(io.StringIO()),
            self.assertRaises(SystemExit) as caught,
        ):
            importer.main()
        self.assertEqual(caught.exception.code, 2)
        process_csv.assert_not_called()

    def test_partial_month_fails_closed_instead_of_auto_resume(self):
        with self.assertRaises(importer.MonthImportBlocked) as caught:
            importer.enforce_month_import_guard(month_status(partial=True), maintenance_reimport=False)
        self.assertEqual(caught.exception.marker, 'MONTH_IMPORT_STATE_CONFLICT')

    def test_duplicate_run_is_allowed_once_then_blocked(self):
        self.assertEqual(
            importer.enforce_month_import_guard(month_status(), maintenance_reimport=False),
            'NEW IMPORT',
        )
        with self.assertRaises(importer.MonthImportBlocked) as caught:
            importer.enforce_month_import_guard(month_status(complete=True), maintenance_reimport=False)
        self.assertEqual(caught.exception.marker, 'MONTH_ALREADY_IMPORTED')

    def test_routine_workflow_cannot_enable_maintenance_reimport(self):
        workflow = WORKFLOW_PATH.read_text(encoding='utf-8')
        self.assertNotIn('--maintenance-reimport', workflow)
        importer_source = (ROOT / 'scripts' / 'import_od_data.py').read_text(encoding='utf-8')
        self.assertIn("'--maintenance-reimport', action='store_true'", importer_source)

    def test_same_month_concurrency_waits_without_cancel(self):
        workflow = WORKFLOW_PATH.read_text(encoding='utf-8')
        self.assertIn('group: production-monthly-import', workflow)
        self.assertIn('cancel-in-progress: false', workflow)
        self.assertIn("type: choice", workflow)

    def test_preflight_runs_before_csv_download(self):
        source = (ROOT / 'scripts' / 'import_od_data.py').read_text(encoding='utf-8')
        main_source = source[source.index('def main():'):]
        self.assertLess(
            main_source.index('run_month_import_preflight('),
            main_source.index('process_csv_stream('),
        )


if __name__ == '__main__':
    unittest.main(verbosity=2)
