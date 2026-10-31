'use strict';
// Conformance suite for record #4073: the local-merge finish sequence (branch guard,
// compose-subject.js + git merge-tree pre-merge checks, close-run, guarded merge, explicit-branch
// push, re-protect) lives once in plugin/skills/_shared/local-merge-sequence.md. Its callers cite
// it and keep only their deltas (bindings, --tag/issue list, inserted steps, failure routing).
// Live-corpus read: a convention enforced against every future edit (skill-prose-conformance-tests'
// Decision Framework). Whitespace collapsed on haystack and needle, absence checks included
// [IL-66]; each fact is proved red on a doctored in-memory copy, matched to its own name [IL-105].
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { readText } = require('./helpers/read-skill');

const ROOT = path.join(__dirname, '..');
const collapse = (s) => s.replace(/\s+/g, ' ');
const read = (rel) => readText(path.join(ROOT, rel));
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// Remove one occurrence of `lit` even when the prose wraps it across lines.
const stripLoose = (text, lit) => text.replace(new RegExp(lit.split(/\s+/).map(esc).join('\\s+')), '');

const SEQUENCE = 'plugin/skills/_shared/local-merge-sequence.md';
const CITATION = '_shared/local-merge-sequence.md';
const VOCAB = ['base-branch', 'branch', 'issues', 'tag', 'run-dir', 'subject-dir', 'worktree-path'];
const BOUND = VOCAB.filter((v) => v !== 'subject-dir'); // {subject-dir} resolves per pr-first-merge.md Step 3

const fencesOf = (text) => [...text.replace(/\r\n/g, '\n').matchAll(/^([ \t]*)```bash\n([\s\S]*?)\n[ \t]*```/gm)]
  .map((m) => m[2].split('\n').map((l) => (l.startsWith(m[1]) ? l.slice(m[1].length) : l)).join('\n'));
const fenceCount = (t, pred) => fencesOf(t).filter(pred).length;

const PRE_MERGE = [
  "if ! git branch --show-current | grep -qxF '{base-branch}'; then",
  'node "${CLAUDE_PLUGIN_ROOT}/bin/compose-subject.js" {issues} --tag {tag} --range {base-branch}...{branch} --out-dir "{subject-dir}" || exit 1',
  'git merge-tree --write-tree --name-only {base-branch} {branch} || exit 1',
];
const CLOSE_RUN = 'node "${CLAUDE_PLUGIN_ROOT}/bin/hooks.js" close-run --run "{run-dir}"';
const MERGE = 'git merge --no-ff {branch} -F "{subject-dir}/message.txt"';
const PUSH = 'git -C "{worktree-path}" push origin {base-branch}';
const REPROTECT = 'node "${CLAUDE_PLUGIN_ROOT}/bin/hooks.js" record-worktree --run "{run-dir}" "{worktree-path}"';

const PROSE = {
  'never-chain rule': 'never chain the push onto the merge or onto `close-run`',
  'whole-command-string reason': 'the gate inspects the whole command string up front',
  'single-branch loop': 'A caller that merges several branches loops Steps 1-3 once per branch',
  'push once after the loop': 'A caller that merges several branches runs Step 4 once, after its last merge',
  'inserted caller step': 'A caller may run its own step between Step 3 and Step 4',
  'routing stays with the caller': 'it never decides what the caller does next',
  'read worktree before close-run': "Read it from `{run-dir}/run-state.json`'s `worktree` field **before Step 2**",
  'pre-check vs conflict': 'Record it as `pre-check failed: {first stderr line}`, never as a conflict',
  'push failure keeps the merge': 'Never `git merge --abort` and never undo the local merge',
  're-stamp output logged': 'is never ignored — the caller logs it',
};
const FACTS = {
  'pre-merge fence': (t) => fenceCount(t, (f) => PRE_MERGE.every((l) => f.includes(l))) === 1,
  'close-run fence is one command': (t) => fenceCount(t, (f) => f.trim() === CLOSE_RUN) === 1,
  'merge fence': (t) => fenceCount(t, (f) => f.includes(PRE_MERGE[0]) && f.trim().endsWith(MERGE)) === 1,
  'push fence is one command': (t) => fenceCount(t, (f) => f.trim() === PUSH) === 1,
  're-protect fence': (t) => fenceCount(t, (f) => f.trim() === REPROTECT) === 1,
  ...Object.fromEntries(Object.entries(PROSE).map(([n, lit]) => [n, (t) => collapse(t).includes(collapse(lit))])),
};
const missingFacts = (t) => Object.entries(FACTS).filter(([, ok]) => !ok(t)).map(([n]) => n);
const DOCTORS = {
  'pre-merge fence': (t) => t.replace(PRE_MERGE[2], 'git merge-tree --write-tree --name-only {base-branch} {branch}'),
  'close-run fence is one command': (t) => t.replace(CLOSE_RUN, `${CLOSE_RUN} && ${PUSH}`),
  'merge fence': (t) => t.replace(MERGE, 'git merge --no-ff {branch}'),
  'push fence is one command': (t) => t.replace(`${PUSH}\n`, `git merge --no-ff {branch} && ${PUSH}\n`),
  're-protect fence': (t) => t.replace(REPROTECT, 'node "${CLAUDE_PLUGIN_ROOT}/bin/hooks.js" record-worktree --run "{run-dir}"'),
  ...Object.fromEntries(Object.entries(PROSE).map(([n, lit]) => [n, (t) => stripLoose(t, lit)])),
};

test('local-merge-sequence.md states every fact of the sequence', () => {
  assert.deepEqual(missingFacts(read(SEQUENCE)), []);
});

test('go-red: each sequence fact, doctored alone, is the only one reported', () => {
  const live = read(SEQUENCE);
  for (const name of Object.keys(FACTS)) {
    const doctored = DOCTORS[name](live);
    assert.notEqual(doctored, live, `${name}: the doctor matched nothing`);
    assert.deepEqual(missingFacts(doctored), [name], name);
  }
});

function placeholderReport(text) {
  const used = new Set();
  for (const f of fencesOf(text)) for (const m of f.matchAll(/\{([a-z-]+)\}/g)) used.add(m[1]);
  return { foreign: [...used].filter((u) => !VOCAB.includes(u)).sort(), unused: VOCAB.filter((v) => !used.has(v)) };
}

test('the sequence fences use exactly the one placeholder vocabulary', () => {
  assert.deepEqual(placeholderReport(read(SEQUENCE)), { foreign: [], unused: [] });
});

test('go-red: a foreign placeholder and a dropped one are both reported', () => {
  const live = read(SEQUENCE);
  assert.deepEqual(placeholderReport(live.replace(PRE_MERGE[0], PRE_MERGE[0].replace('{base-branch}', '{integration-branch}'))),
    { foreign: ['integration-branch'], unused: [] });
  assert.deepEqual(placeholderReport(live.split('{issues}').join('{issue}')), { foreign: ['issue'], unused: ['issues'] });
});

// The contract owns recognition; callers own outcomes (shared-contract-extraction).
const CALLER_OUTCOMES = ['pending-review', 'skip this branch', 'fall back to rendering the console', '**Park**', 'Review Console'];
const callerOutcomesIn = (t) => CALLER_OUTCOMES.filter((o) => collapse(t).includes(o));

test('the sequence names no caller outcome', () => {
  assert.deepEqual(callerOutcomesIn(read(SEQUENCE)), []);
});

test('go-red: each caller outcome, appended alone, is the only one reported', () => {
  const live = read(SEQUENCE);
  for (const o of CALLER_OUTCOMES) assert.deepEqual(callerOutcomesIn(`${live}\n${o}\n`), [o]);
});

test('the sequence cites the integration-model fragment and the pr-first-merge subject-dir definition', () => {
  const flat = collapse(read(SEQUENCE));
  assert.ok(flat.includes('`_shared/integration-model.md`'));
  assert.ok(flat.includes('`{subject-dir}` — resolves per `_shared/pr-first-merge.md` Step 3'));
});

// Site-side half (Tasks 2-4 of the #4073 plan): callers append here without restructuring.
const SITES = [];
