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

// The block no caller may carry inline (collapsed, so a line-wrapped copy is still caught).
const BLOCK = [
  ['branch guard', 'if ! git branch --show-current | grep -qxF'],
  ['composer call', 'bin/compose-subject.js" '],
  ['merge-tree pre-check', 'git merge-tree --write-tree --name-only'],
  ['close-run call', 'bin/hooks.js" close-run --run'],
];
// Frozen pre-#4073 lines from wrap-up/auto-merge-short-circuit.md (its pre-merge fence and close-run fence).
const PRE_4073_BLOCK = {
  'branch guard': "if ! git branch --show-current | grep -qxF '{integration-branch}'; then",
  'composer call': 'node "${CLAUDE_PLUGIN_ROOT}/bin/compose-subject.js" {issue} --tag {tag} --range {integration-branch}...{branch} --out-dir "{subject-dir}" || exit 1',
  'merge-tree pre-check': 'git merge-tree --write-tree --name-only {integration-branch} {branch} || exit 1',
  'close-run call': 'node "${CLAUDE_PLUGIN_ROOT}/bin/hooks.js" close-run --run "$RUN_DIR"',
};
const inlineBlockParts = (t) => BLOCK.filter(([, needle]) => collapse(t).includes(collapse(needle))).map(([name]) => name);

// Each caller's **Bindings** paragraph binds every placeholder but {subject-dir}: `{x}` = … or `{x}` — none.
function bindingsGaps(text) {
  const start = text.indexOf('**Bindings');
  if (start < 0) return ['no **Bindings** paragraph'];
  const end = text.indexOf('\n\n', start);
  const para = collapse(end < 0 ? text.slice(start) : text.slice(start, end));
  return BOUND.filter((p) => !new RegExp('`\\{' + esc(p) + '\\}` (?:=|— none)').test(para));
}
const deltaGaps = (text, deltas) => Object.entries(deltas).filter(([, lit]) => !collapse(text).includes(collapse(lit))).map(([n]) => n);

test('the anchor: the sequence itself carries every block part', () => {
  assert.deepEqual(inlineBlockParts(read(SEQUENCE)), BLOCK.map(([n]) => n));
});

function siteTests(site) {
  test(`${site.label}: cites ${CITATION}`, () => {
    const live = read(site.file);
    assert.ok(collapse(live).includes(CITATION));
    const doctored = live.split(CITATION).join('_shared/zzz-no-such-sequence-4073.md'); // a nonsense token: a hit means re-pick it
    assert.ok(!collapse(doctored).includes(CITATION), 'go-red: an uncited site must fail');
  });
  test(`${site.label}: carries no inline copy of the guard, composer, merge-tree or close-run block`, () => {
    const live = read(site.file);
    assert.deepEqual(inlineBlockParts(live), []);
    for (const [name] of BLOCK) {
      const wrapped = PRE_4073_BLOCK[name].replace(' ', '\n   '); // a line-wrapped copy is still caught [IL-66]
      assert.deepEqual(inlineBlockParts(`${live}\n${wrapped}\n`), [name], `go-red: ${name}`);
    }
  });
  test(`${site.label}: binds every placeholder the sequence needs`, () => {
    const live = read(site.file);
    assert.deepEqual(bindingsGaps(live), []);
    const doctored = live.replace(/`\{worktree-path\}` =/, '`{worktree-path}` is');
    assert.notEqual(doctored, live);
    assert.deepEqual(bindingsGaps(doctored), ['worktree-path'], 'go-red: a dropped binding');
  });
  test(`${site.label}: keeps its own deltas`, () => {
    const live = read(site.file);
    assert.deepEqual(deltaGaps(live, site.deltas), []);
    for (const [name, lit] of Object.entries(site.deltas)) {
      const doctored = stripLoose(live, lit);
      assert.notEqual(doctored, live, `${name}: the strip matched nothing`);
      assert.deepEqual(deltaGaps(doctored, site.deltas), [name], `go-red: ${name}`);
    }
  });
}

// Site-side half (Tasks 2-4 of the #4073 plan): callers append here without restructuring.
const SITES = [
  { label: 'local-merge-auto-finish.md', file: 'plugin/skills/_shared/local-merge-auto-finish.md', deltas: {
    'tag auto-finish': '`{tag}` = `auto-finish`',
    'single issue': '`{issues}` = `{issue}`',
    'feature-branch binding': '`{branch}` = `{feature-branch}`',
    'verification between merge and push': '6. **Verify on the merged result**',
    're-stamp output logged': "carry it into the log call's `{text-file}`",
  } },
  { label: 'auto-merge-short-circuit.md', file: 'plugin/skills/wrap-up/auto-merge-short-circuit.md', deltas: {
    'own tag': "`{tag}` = this file's own `{tag}`",
    'single issue': '`{issues}` = `{issue}`',
    'integration-branch binding': '`{base-branch}` = `{integration-branch}`',
    're-stamp output logged': 'log its output line to `decisions.md`',
  } },
  { label: 'settle-and-merge.md', file: 'plugin/skills/dispatch/settle-and-merge.md', deltas: {
    'two-issue composer call': '`{issues}` = `{issue} {second-issue}`',
    'tag auto-merge': '`{tag}` = `auto-merge`',
    'integration-branch resolution': 'node "${CLAUDE_PLUGIN_ROOT}/bin/resolve-policy.js" --values integration-branch',
    'remote-show fallback': "git remote show origin | sed -n '/HEAD branch/s/.*: //p'",
    'group worktree': '`{worktree-path}` = `{group-worktree}`',
    're-stamp output logged': 'log any other line it prints to `{run-dir}/decisions.md`',
  } },
  { label: 'worktree-merge.md', file: 'plugin/skills/flow/worktree-merge.md', deltas: {
    'no tag': '`{tag}` — none: drop `--tag {tag}`',
    'two-issue composer call': '`{issues}` = `{issue} {second-issue}`',
    'no-record branch': "A branch with no record drops the sequence's composer line",
    'push once': '6. **Push the base branch once',
    'owner-preserving re-protect': 'env -u CLAUDE_CODE_SESSION_ID node "${CLAUDE_PLUGIN_ROOT}/bin/hooks.js" record-worktree --run "{run-dir}" "{worktree-path}"',
  } },
];
for (const site of SITES) siteTests(site);

test("worktree-merge.md: a composer failure skips the branch and continues (AC3)", () => {
  const SKIP = 'skip this branch, and continue with the next one';
  const bullet = (t) => t.split('\n').find((l) => l.trimStart().startsWith('- **The composer failed**'));
  const live = read('plugin/skills/flow/worktree-merge.md');
  assert.ok(bullet(live), 'composer-failed bullet missing');
  assert.ok(bullet(live).includes(SKIP));
  const doctored = live.replace(SKIP, 'stop the reconciliation');
  assert.notEqual(doctored, live);
  assert.ok(!bullet(doctored).includes(SKIP), 'go-red: an aborting composer bullet must fail');
});

// Roster, both directions: every plugin/skills file citing the sequence is a SITES entry or a MENTIONS
// entry (a file that names the sequence without running it), and every entry still cites it.
// Task 4 adds the two mention-only files its sweep creates; an entry that stops citing fails with "shrink the list".
const MENTIONS = new Map([
  ['plugin/skills/_shared/policy-schema.md', 'commit-scope row names the composer call site; runs nothing'],
  ['plugin/skills/_shared/integration-model.md', 'consumer table names the local-merge path; runs nothing'],
]);
function citers(root) {
  const out = [];
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p); else if (e.name.endsWith('.md') && collapse(readText(p)).includes(CITATION)) out.push(path.relative(ROOT, p).split(path.sep).join('/'));
  } };
  walk(root);
  return out.sort();
}
test('the SITES roster is exactly the files citing the sequence', () => {
  assert.equal(SITES.length, 4);
  assert.deepEqual(citers(path.join(ROOT, 'plugin/skills')).filter((f) => f !== SEQUENCE && !MENTIONS.has(f)), SITES.map((s) => s.file).sort());
  for (const m of MENTIONS.keys()) assert.ok(collapse(read(m)).includes(CITATION), `stale MENTIONS entry ${m}: shrink the list`);
  // go-red: a stray citing file under a scratch tree is found by the walk.
  const tmp = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'lms-roster-'));
  try {
    fs.mkdirSync(path.join(tmp, 'sub'));
    fs.writeFileSync(path.join(tmp, 'sub', 'stray.md'), `cites ${CITATION}\n`);
    fs.writeFileSync(path.join(tmp, 'sub', 'other.md'), 'cites nothing\n');
    const found = citers(tmp);
    assert.equal(found.length, 1, 'go-red: the walk must find exactly the one stray citer');
    assert.ok(found[0].endsWith('stray.md'));
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('docs register the new _shared file (AC5)', () => {
  const graph = readText(path.join(ROOT, 'docs/skill-graph.md'));
  const rowOf = (g, key) => g.split('\n').find((l) => l.startsWith(key));
  const KEY = '| `_shared/local-merge-sequence.md` |';
  const row = rowOf(graph, KEY);
  assert.ok(row, 'skill-graph.md has no row for _shared/local-merge-sequence.md');
  for (const s of ['/flow', '/wrap-up', 'local-merge-auto-finish.md', 'auto-merge-short-circuit.md', 'worktree-merge.md']) assert.ok(row.includes(s), `row names ${s}`);
  const autoFinish = rowOf(graph, '| `_shared/local-merge-auto-finish.md` |');
  assert.ok(autoFinish.includes('`_shared/local-merge-sequence.md`'), 'the auto-finish row cites the sequence');
  assert.ok(!collapse(autoFinish).includes("Reuses `wrap-up/auto-merge-short-circuit.md`'s own local-merge git mechanics"), 'the retired reuse clause is gone');
  // go-red: a renamed row is not found.
  assert.equal(rowOf(graph.replace(KEY, '| `_shared/zzz-4073.md` |'), KEY), undefined, 'go-red: a missing row must fail the lookup');
  const structure = readText(path.join(ROOT, 'docs/plugin-structure.md'));
  const shared = structure.split('\n').find((l) => l.startsWith('| _shared |'));
  assert.ok(shared.split(' | ')[1].includes('local-merge-sequence.md'), 'plugin-structure.md curated _shared row lists it');
});
