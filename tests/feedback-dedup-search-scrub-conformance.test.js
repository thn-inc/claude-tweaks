'use strict';
// tests/feedback-dedup-search-scrub-conformance.test.js — pins that
// skills/feedback/SKILL.md (#539) derives Step 4's `gh issue list --search`
// keywords from the affected-component name only, never from pre-scrub
// free-text summary, while leaving Step 8's fingerprintBasis untouched.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const MD_PATH = path.join(__dirname, '..', 'plugin', 'skills', 'feedback', 'SKILL.md');
const md = fs.readFileSync(MD_PATH, 'utf8');

// #2697 moved Step 0's batch-loop body (and its cross-reference to Step 4's fingerprint basis)
// verbatim into bare-invocation.md; SKILL.md keeps only Step 0's trigger paragraph and pointer.
const BARE_PATH = path.join(__dirname, '..', 'plugin', 'skills', 'feedback', 'bare-invocation.md');
const bare = fs.readFileSync(BARE_PATH, 'utf8');

test('Step 4 derives the --search keywords from the component name only', () => {
  assert.ok(/component[^.\n]*only/i.test(md), 'Step 4 must state the search keywords derive from the component name only');
});

test('Step 4 states the free-text summary is never sent to the public search API before the scrub gate runs', () => {
  assert.ok(/never[\s\S]{0,80}?(free-text|summary)/i.test(md), 'Step 4 must state the free-text symptom/summary is never used for the search');
  assert.ok(/reaching the public search API|reaches? the search|sent to.*search/i.test(md),
    'Step 4 must state that this text never reaches the public search API before the scrub gate runs');
});

test('Step 8 fingerprintBasis still consumes the full { component, summary } basis, unmodified', () => {
  assert.ok(md.includes('fingerprintFromBasis'), 'must still cite fingerprintFromBasis');
  assert.ok(/full,? unscrubbed|unmodified.*basis|full.*basis/i.test(md),
    'must state the fingerprint basis stays full/unmodified');
});

test('Step 0 batch-loop cross-reference (now in bare-invocation.md) to the dedup fingerprint basis is still accurate', () => {
  assert.ok(bare.includes('dedup fingerprint basis'), 'bare-invocation.md must still cross-reference the dedup fingerprint basis');
});
