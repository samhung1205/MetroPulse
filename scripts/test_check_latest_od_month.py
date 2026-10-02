#!/usr/bin/env python3
"""Mock HTTP regression tests for the read-only availability checker."""

import contextlib
import io
import json
import os
import pathlib
import sys
import tempfile
import unittest
import urllib.error
from unittest import mock

import check_latest_od_month as checker


def response(payload=None, *, status=200, headers=None):
    stream = io.BytesIO(json.dumps(payload).encode() if payload is not None else b'')
    stream.status = status
    stream.headers = headers or {}
    return stream


def http_error(status):
    return urllib.error.HTTPError('https://example.test', status, 'test error', {}, None)


class AvailabilityCheckerTests(unittest.TestCase):
    def setUp(self):
        # A missed mock must never perform a live request; backoff also never sleeps in tests.
        self.urlopen = mock.patch.object(checker.urllib.request, 'urlopen').start()
        self.sleep = mock.patch.object(checker.time, 'sleep').start()
        self.addCleanup(mock.patch.stopall)

    def test_timeout_then_success_returns_latest_month(self):
        self.urlopen.side_effect = [
            TimeoutError('The read operation timed out'),
            response({'success': True, 'months': [{'year': 2026, 'month': 8}]}),
        ]
        self.assertEqual(checker.get_latest_production_month('https://example.test', 20), (2026, 8))
        self.assertEqual(self.urlopen.call_count, 2)
        self.sleep.assert_called_once_with(2)

    def test_response_body_timeout_is_also_retried(self):
        stalled = mock.MagicMock()
        stalled.__enter__.return_value = stalled
        stalled.read.side_effect = TimeoutError('body read timed out')
        self.urlopen.side_effect = [
            stalled,
            response({'success': True, 'months': [{'year': 2026, 'month': 8}]}),
        ]
        self.assertEqual(checker.get_latest_production_month('https://example.test', 20), (2026, 8))
        self.assertEqual(self.urlopen.call_count, 2)
        stalled.__exit__.assert_called_once()

    def test_upstream_503_then_success_only_uses_head(self):
        self.urlopen.side_effect = [
            http_error(503), response(headers={'Content-Length': '100', 'Last-Modified': 'today'}),
        ]
        available, info = checker.check_upstream_availability(2026, 9, 20)
        self.assertTrue(available)
        self.assertEqual(info['content_length_bytes'], 100)
        for call in self.urlopen.call_args_list:
            self.assertEqual(call.args[0].get_method(), 'HEAD')

    def test_upstream_404_is_no_new_data_without_retry(self):
        self.urlopen.side_effect = http_error(404)
        available, info = checker.check_upstream_availability(2026, 9, 20)
        self.assertFalse(available)
        self.assertEqual(info['http_status'], 404)
        self.assertEqual(self.urlopen.call_count, 1)
        self.sleep.assert_not_called()

    def test_permanent_http_error_is_not_retried(self):
        self.urlopen.side_effect = http_error(403)
        with self.assertRaises(urllib.error.HTTPError):
            checker.get_latest_production_month('https://example.test', 20)
        self.assertEqual(self.urlopen.call_count, 1)
        self.sleep.assert_not_called()

    def test_network_failure_exhausts_only_three_attempts(self):
        self.urlopen.side_effect = urllib.error.URLError('connection reset')
        with self.assertRaisesRegex(RuntimeError, 'GET .* failed after 3 attempts'):
            checker.get_latest_production_month('https://example.test', 20)
        self.assertEqual(self.urlopen.call_count, 3)
        self.assertEqual(self.sleep.call_args_list, [mock.call(2), mock.call(4)])

    def test_invalid_json_does_not_retry(self):
        self.urlopen.return_value = io.BytesIO(b'not json')
        with self.assertRaises(json.JSONDecodeError):
            checker.get_latest_production_month('https://example.test', 20)
        self.assertEqual(self.urlopen.call_count, 1)
        self.sleep.assert_not_called()

    def test_main_reports_error_after_all_timeouts(self):
        self.urlopen.side_effect = TimeoutError('The read operation timed out')
        with tempfile.TemporaryDirectory() as directory:
            output_path = pathlib.Path(directory) / 'github-output'
            stdout = io.StringIO()
            stderr = io.StringIO()
            with (
                mock.patch.object(sys, 'argv', ['checker', '--github-output']),
                mock.patch.dict(os.environ, {'GITHUB_OUTPUT': str(output_path)}),
                contextlib.redirect_stdout(stdout),
                contextlib.redirect_stderr(stderr),
            ):
                exit_code = checker.main()
            self.assertEqual(exit_code, 1)
            self.assertIn('RESULT=ERROR', stdout.getvalue())
            self.assertIn('result=ERROR', output_path.read_text())
            self.assertNotIn('NO_NEW_DATA', output_path.read_text())
            self.assertIn('failed after 3 attempts', stderr.getvalue())

    def test_recovered_check_produces_new_month_output(self):
        self.urlopen.side_effect = [
            TimeoutError('timeout'),
            response({'success': True, 'months': [{'year': 2026, 'month': 8}]}),
            response(headers={'Content-Length': '100'}),
        ]
        with (
            mock.patch.object(sys, 'argv', ['checker']),
            mock.patch.dict(os.environ, {}, clear=True),
            contextlib.redirect_stdout(io.StringIO()) as stdout,
            contextlib.redirect_stderr(io.StringIO()),
        ):
            self.assertEqual(checker.main(), 0)
        self.assertIn('RESULT=NEW_MONTH_AVAILABLE', stdout.getvalue())
        self.assertEqual(self.urlopen.call_count, 3)


if __name__ == '__main__':
    unittest.main(verbosity=2)
