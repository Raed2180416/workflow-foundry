"""Tests for the learned selector: leak guard, hygiene, learners and metrics. Synthetic data only (no lab files).

  python3 -I experiments/autobench/verifier/learned-selector/test_learned_selector.py
"""
import copy
import os
import re
import sys
import unittest

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from features import (FORBIDDEN_KEYS, assert_clean_view, candidate_view, config_view, consensus_features,  # noqa: E402
                      features, telemetry_view)
from metrics import auroc, best_f1_threshold, pair_ranking, prf  # noqa: E402
from models import GBM, CondLogit, LogReg  # noqa: E402


def synthetic_row(label=1, task='domain.some_task', body='Hello Alice, the invoice INV-1001 total is $1,200.'):
    return {
        'rowId': f'run-x/{task}', 'task': task, 'domain': 'domain', 'arm': 'arm-x', 'run': 'run-x',
        'harness': 'A1-C', 'actor': 'mercury-3 ledger+checker, claude-haiku-5-5 acting', 'outcome': True,
        'canonical': True, 'fold': 0,
        'prompt': {'system': 'You are an agent.', 'user': 'Email alice@company.example.com about INV-1001 from ss_bills.'},
        'today': '2026-02-15T09:00:00Z', 'services': ['gmail', 'google_sheets'],
        'diff': {'summary': {}, 'nChanges': 2, 'actionRecords': [], 'changes': [
            {'app': 'gmail', 'coll': 'messages', 'op': 'created', 'id': 'm1',
             'record': {'id': 'm1', 'to': ['alice@company.example.com'], 'subject': 'Invoice INV-1001',
                        'body_plain': body}},
            {'app': 'google_sheets', 'coll': 'rows', 'op': 'updated', 'id': 'r1', 'ref': {},
             'fields': {'cells.Status': ['Open', 'Notified'], 'updated_at': ['a', 'b']}}]},
        'writes': {'n': 2, 'shown': 2, 'calls': [
            {'step': 3, 'tool': 'api_fetch', 'method': 'POST', 'url': 'https://gmail.googleapis.com/send', 'body': '{}',
             'looksError': False, 'result': '{"id":"m1"}'},
            {'step': 4, 'tool': 'api_fetch', 'method': 'POST', 'url': 'https://api.other.com/x', 'body': '{}',
             'looksError': True, 'result': '{"error": {"code": 401, "message": "No other account is connected"}}'}]},
        'selfCheck': {'kind': 'a1c-checks', 'termination': 'all checks pass', 'rounds': 0, 'nChecks': 2, 'nFail': 0,
                      'nUndecided': 0, 'hardFail': 0, 'allPass': True,
                      'checks': [{'id': 'P1', 'hard': True, 'pass': True, 'by': 'code', 'polarity': 'positive'},
                                 {'id': 'N1', 'hard': False, 'pass': True, 'by': 'checker', 'polarity': 'negative'}]},
        'steps': 9, 'costUsd': 0.01,
        'source': {'host': '/var/tmp/x', 'n_assertions': 7, 'contract_sha256': 'abc'},
        'label': {'task_completed_correctly': label, 'partial_credit': 1.0 if label else 0.5, 'n_scored': 5,
                  'n_passed': 5 if label else 3, 'failedTypes': [], 'failedTypeCounts': {}, 'grade_error': None},
        'worlds': {'initial': 'x', 'final': 'y'},
    }


FORK = {'steps': 9, 'turns': 7, 'durationMs': 1000, 'partial_credit': 1, 'task_completed_correctly': 1, 'n_scored': 5,
        'n_passed': 5, 'failed_types': ['x_equals'], 'grade_error': None, 'costUsd': 0.02,
        'session': {'modelResponses': 7, 'resultSubtype': 'success', 'stopReason': None, 'violations': []},
        'usage': {'worldCalls': 30, 'reads': 25, 'writes': 3, 'invalid': 0},
        'pipeline': {'termination': {'reason': 'all checks pass', 'failingHard': 0}, 'rounds': 0,
                     'checks': [{'round': 0, 'checks': 2, 'pass': 2, 'fail': 0, 'undecided': 0, 'hardFail': 0}]}}
WORLD0 = {'meta': {'current_time': '2026-03-15T00:00:00Z', 'hidden': 'secret'},
          'gmail': {'messages': [{'id': 'a', 'body_plain': 'Due 2026-02-10'}]},
          'google_sheets': {'rows': [{'id': 'r1', 'cells': {'Status': 'Open'}}, {'id': 'r2', 'cells': {'Status': 'Open'}}]}}


def view_of(row):
    return candidate_view(row, FORK, WORLD0, config_view(row['harness'], row['actor'], True))


class LeakGuard(unittest.TestCase):
    def test_view_has_no_forbidden_keys(self):
        v = view_of(synthetic_row())
        keys = set(v)
        self.assertFalse(keys & FORBIDDEN_KEYS)
        self.assertNotIn('meta', v['world0'])
        flat = repr(v['telemetry'])
        for k in ('partial_credit', 'task_completed_correctly', 'n_scored', 'n_passed', 'failed_types', 'costUsd'):
            self.assertNotIn(k, flat)

    def test_features_ignore_label_task_and_grader_fields(self):
        a, b = synthetic_row(label=1, task='d.alpha'), synthetic_row(label=0, task='d.beta')
        b['source']['n_assertions'] = 99
        b['costUsd'] = 5.0
        fork_b = copy.deepcopy(FORK)
        fork_b.update({'partial_credit': 0, 'task_completed_correctly': 0, 'n_scored': 9, 'failed_types': ['y']})
        fa = features(view_of(a))
        fb = features(candidate_view(b, fork_b, WORLD0, config_view(b['harness'], b['actor'], True)))
        self.assertEqual(fa, fb)

    def test_assert_clean_view_refuses(self):
        v = view_of(synthetic_row())
        v['label'] = 1
        with self.assertRaises(ValueError):
            assert_clean_view(v)
        v = view_of(synthetic_row())
        v['telemetry']['num']['n_passed'] = 3
        with self.assertRaises(ValueError):
            assert_clean_view(v)

    def test_telemetry_allowlist_only(self):
        t = telemetry_view({'steps': 3, 'secret_grade': 1, 'n_passed': 4, 'usage': {'reads': 2, 'hidden': 5}})
        self.assertEqual(t['num'], {'steps': 3.0, 'usage.reads': 2.0})


class FeatureBehaviour(unittest.TestCase):
    def test_incomplete_text_and_duplicates(self):
        r = synthetic_row(body='We could not calculate the total; TBD.')
        r['diff']['changes'].append(copy.deepcopy(r['diff']['changes'][0]))
        r['diff']['changes'][-1]['id'] = 'm2'
        r['diff']['changes'][-1]['record']['id'] = 'm2'
        f = features(view_of(r))
        self.assertGreater(f['t.incomplete_strong'], 0)
        self.assertGreater(f['d.dup_created'], 0)
        g = features(view_of(synthetic_row()))
        self.assertEqual(g['t.incomplete_strong'], 0)
        self.assertEqual(g['d.dup_created'], 0)

    def test_bookkeeping_updates_are_not_effects(self):
        r = synthetic_row()
        r['diff']['changes'] = [{'app': 'gmail', 'coll': 'messages', 'op': 'updated', 'id': 'a', 'ref': {},
                                 'fields': {'is_read': [False, True]}}]
        f = features(view_of(r))
        self.assertEqual(f['d.only_bookkeeping'], 1.0)
        self.assertEqual(f['d.n_updated_meaningful'], 0.0)

    def test_scope_and_write_errors(self):
        f = features(view_of(synthetic_row()))
        self.assertAlmostEqual(f['w.update_coverage_mean'], 0.5)
        self.assertGreater(f['w.unconnected_errors'], 0)
        self.assertEqual(f['w.last_write_error'], 1.0)
        self.assertGreater(f['p.frac_emails_in_effects'], 0.99)

    def test_consensus(self):
        v1, v2 = view_of(synthetic_row()), view_of(synthetic_row())
        v3 = view_of(synthetic_row())
        v3['diff'] = {'changes': [], 'actionRecords': []}
        k = consensus_features([v1, v2, v3])
        self.assertGreater(k[0]['k.jacc_max'], k[2]['k.jacc_max'])

    def test_config(self):
        self.assertEqual(config_view('A1-C', 'mercury-3 ledger+checker, claude-haiku-5-5 acting', True)['planner'], 'mercury')
        self.assertEqual(config_view('A1', 'claude-sonnet-5-5', False)['acting'], 'sonnet')


class Hygiene(unittest.TestCase):
    def test_sources_contain_no_benchmark_identifiers(self):
        """H7/H8: no task names (domain.snake_case), example ids, grader assertion types or lab paths in the feature
        and model code."""
        pat_task = re.compile(r"\b(sales|finance|hr|marketing|operations|support)\.[a-z0-9]+_[a-z0-9_]+\b")
        pat_assert = re.compile(r"\b[a-z]+_(?:exists|equals|not_exists|contains|not_contains)\w*\b")
        for fn in ('features.py', 'models.py', 'metrics.py'):
            with open(os.path.join(HERE, fn)) as fh:
                src = fh.read()
            self.assertIsNone(pat_task.search(src), fn)
            self.assertIsNone(pat_assert.search(src), fn)
            self.assertNotIn('dataset.jsonl', src)
            self.assertNotIn('grade.json', src)


class Learners(unittest.TestCase):
    def setUp(self):
        rng = np.random.default_rng(0)
        self.X = rng.normal(size=(400, 6))
        z = 1.5 * self.X[:, 0] - 1.0 * self.X[:, 1]
        self.y = (rng.random(400) < 1 / (1 + np.exp(-z))).astype(float)

    def test_logreg_recovers_signal(self):
        m = LogReg(C=1.0).fit(self.X[:300], self.y[:300])
        self.assertGreater(auroc(self.y[300:], m.predict_proba(self.X[300:])), 0.75)
        self.assertGreater(m.coef()[0], 0)
        self.assertLess(m.coef()[1], 0)

    def test_gbm_learns_and_is_deterministic(self):
        a = GBM(n_estimators=60).fit(self.X[:300], self.y[:300]).predict_proba(self.X[300:])
        b = GBM(n_estimators=60).fit(self.X[:300], self.y[:300]).predict_proba(self.X[300:])
        self.assertTrue(np.allclose(a, b))
        self.assertGreater(auroc(self.y[300:], a), 0.7)

    def test_condlogit_ranks_within_groups(self):
        groups = np.repeat(np.arange(100), 4)
        m = CondLogit(C=1.0).fit(self.X, self.y, groups)
        self.assertGreater(m.w[0], 0)


class Metrics(unittest.TestCase):
    def test_auroc_and_ties(self):
        self.assertEqual(auroc([0, 0, 1, 1], [0.1, 0.2, 0.8, 0.9]), 1.0)
        self.assertEqual(auroc([0, 1], [0.5, 0.5]), 0.5)
        self.assertIsNone(auroc([1, 1], [0.2, 0.3]))

    def test_prf_threshold_pairs(self):
        r = prf([1, 0, 1, 0], [1, 1, 0, 0])
        self.assertEqual((r['tp'], r['fp'], r['fn'], r['tn']), (1, 1, 1, 1))
        self.assertAlmostEqual(best_f1_threshold(np.array([0, 0, 1, 1]), np.array([0.1, 0.2, 0.7, 0.9])), 0.7)
        pr, n = pair_ranking(['a', 'a', 'b', 'b'], [1, 0, 1, 0], [0.9, 0.1, 0.2, 0.8])
        self.assertEqual((pr, n), (0.5, 2))


if __name__ == '__main__':
    unittest.main(verbosity=1)
