'use strict';
// Worker envelopes a merge-check launch can come back with, shared by the supplier's own suite
// (judgments-merge-check.test.js) and the AC2 run over merge() (merge.test.js): none of the
// BAD ones may read as an `auto-merge` verdict.

const OK_ENVELOPE = (verdict, rationale = 'small and safe') => ({ status: 'ok', result: { verdict, rationale } });

const BAD_MERGE_CHECK_ENVELOPES = [
  ['launch-error', { status: 'fail', reason: 'launch-error' }],
  ['timeout', { status: 'timeout' }],
  ['null result', { status: 'ok', result: null }],
  ['string result', { status: 'ok', result: 'not json' }],
  ['no verdict', { status: 'ok', result: {} }],
  ['Auto-Merge', OK_ENVELOPE('Auto-Merge')],
  ['trailing space', OK_ENVELOPE('auto-merge ')],
  ['merge', OK_ENVELOPE('merge')],
  ['approve', OK_ENVELOPE('approve')],
  ['numeric verdict', { status: 'ok', result: { verdict: 1, rationale: 'r' } }],
  ['boolean verdict', { status: 'ok', result: { verdict: true, rationale: 'r' } }],
  ['schema fail with auto-merge', { status: 'fail', reason: 'schema', result: { verdict: 'auto-merge' } }],
  ['array result', { status: 'ok', result: [{ verdict: 'auto-merge' }] }],
];

module.exports = { OK_ENVELOPE, BAD_MERGE_CHECK_ENVELOPES };
