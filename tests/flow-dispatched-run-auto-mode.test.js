'use strict';

// Pins /flow's Step 1 mode-resolution order: a dispatched run (run-state.json `dispatched: true`,
// stamped by /claude-tweaks:dispatch) resolves `auto` at rung 2, ahead of the `auto-mode` policy,
// so `auto-mode: default-off` cannot bounce a headless dispatch to `interactive` (#3372). The
// Manifesto's Mode row names this source via the `dispatch` row of its Source values table.
// Live-file reads, not frozen fixtures: the prose IS the contract being enforced
// (skill-prose-conformance-tests' declared-contract carve-out). Synthetic fixtures prove the
// extractors can go red.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');

function read(...parts) {
  return fs.readFileSync(path.join(__dirname, '..', ...parts), 'utf8').replace(/\r\n/g, '\n');
}

// The Step 1 body: from its heading up to Step 2's heading.
function step1(text) {
  const a = text.indexOf('### Step 1: Validate Input');
  const b = text.indexOf('### Step 2:');
  if (a === -1 || b === -1) throw new Error('Step 1 or Step 2 heading not found');
  return text.slice(a, b);
}

// The nested mode-resolution rungs: 3-space-indented `N. ` lines after the "Resolve the mode"
// marker, up to Step 1's next top-level item.
function rungs(section) {
  const lines = section.split('\n');
  const start = lines.findIndex((l) => l.includes('**Resolve the mode**'));
  if (start === -1) throw new Error('"Resolve the mode" marker not found');
  const out = [];
  for (const line of lines.slice(start + 1)) {
    if (/^\d+\. /.test(line)) break;
    const m = line.match(/^   (\d+)\. (.*)$/);
    if (m) out.push({ n: m[1], text: m[2] });
  }
  return out;
}

function kind(t) {
  if (/^Explicit mode keyword/.test(t)) return 'keyword';
  if (/^\*\*Dispatch binding → `auto`\*\*/.test(t)) return 'dispatch';
  if (/^`auto-mode` policy/.test(t)) return 'policy';
  if (/^\*\*Intrinsic default → `auto`\.\*\*/.test(t)) return 'intrinsic';
  return null;
}

// The one table row whose first cell is `cell`; asserts it is unique so a duplicate can't hide a stale copy.
function tableRow(text, cell) {
  const rows = text.split('\n').filter((l) => l.startsWith(`| \`${cell}\` | `));
  assert.strictEqual(rows.length, 1, `expected exactly one | \`${cell}\` | row`);
  return rows[0];
}

const EXPECTED_ORDER = ['keyword', 'dispatch', 'policy', 'intrinsic'];

// Rung 2 (the dispatch binding) of the live flow/SKILL.md Step 1 mode resolution.
function liveRung2() {
  const rung2 = rungs(step1(read('plugin', 'skills', 'flow', 'SKILL.md'))).find((r) => r.n === '2');
  assert.ok(rung2, 'no rung 2 in Step 1 mode resolution');
  return rung2;
}

// --- Proof the extractors can go red (synthetic fixtures) ---

test('synthetic: kind order flags a missing or misplaced dispatch rung', () => {
  const fixtureA = [
    '1. Parse `$ARGUMENTS`. **Resolve the mode** in this order (first match wins):',
    '   1. Explicit mode keyword in `$ARGUMENTS` — `interactive` / `hybrid` / `confirm` / `auto`.',
    '   2. `auto-mode` policy — `AUTO_MODE=…`.',
    '   3. **Intrinsic default → `auto`.** Flow is hands-off by purpose.',
    '2. Determine record mode.',
  ].join('\n');
  const fixtureB = [
    '1. Parse `$ARGUMENTS`. **Resolve the mode** in this order (first match wins):',
    '   1. **Dispatch binding → `auto`** (#3372). Dispatched.',
    '   2. Explicit mode keyword in `$ARGUMENTS` — `interactive` / `hybrid` / `confirm` / `auto`.',
    '   3. `auto-mode` policy — `AUTO_MODE=…`.',
    '   4. **Intrinsic default → `auto`.** Flow is hands-off by purpose.',
    '2. Determine record mode.',
  ].join('\n');
  const a = rungs(fixtureA).map((r) => kind(r.text));
  const b = rungs(fixtureB).map((r) => kind(r.text));
  assert.deepStrictEqual(a, ['keyword', 'policy', 'intrinsic']);
  assert.deepStrictEqual(b, ['dispatch', 'keyword', 'policy', 'intrinsic']);
  assert.notDeepStrictEqual(a, EXPECTED_ORDER);
  assert.notDeepStrictEqual(b, EXPECTED_ORDER);
});

// --- Live files ---

test('flow/SKILL.md Step 1 lists the four mode rungs in order', () => {
  const found = rungs(step1(read('plugin', 'skills', 'flow', 'SKILL.md')));
  assert.deepStrictEqual(found.map((r) => kind(r.text)), EXPECTED_ORDER);
  assert.deepStrictEqual(found.map((r) => r.n), ['1', '2', '3', '4']);
});

test('the dispatch-binding rung names its source, anchoring, and every fall-through case', () => {
  const rung2 = liveRung2();
  const required = [
    /`run-state\.json`/,
    /`dispatched: true`/,
    /`\$RUN_ROOT`/,
    /`_shared\/pipeline-run-dir\.md`/,
    /`PIPELINE_RUN_DIR` unset/,
    /fails the `\$RUN_ROOT` anchoring check/,
    /missing or unparseable `run-state\.json`/,
    /`dispatched` absent or not `true`/,
    /falls through to rung 3/,
    /never stops the run/,
    /Log nothing to `decisions\.md` here/,
  ];
  for (const re of required) assert.match(rung2.text, re);
});

test('manifesto.md names the dispatch binding as the Mode source', () => {
  const row = tableRow(read('plugin', 'skills', 'flow', 'manifesto.md'), 'dispatch');
  assert.match(row, /auto \(dispatched run\)/);
  assert.match(row, /source: dispatch binding/);
});

// --- #3372: the dispatched-run auto exception, carried through the contract, card and policy row ---

test('auto-mode-contract.md interactive row and Default note state the dispatched-run exception', () => {
  const text = read('plugin', 'skills', '_shared', 'auto-mode-contract.md');
  const row = tableRow(text, 'interactive');
  assert.match(row, /`dispatched: true`/);
  assert.match(row, /an explicit `interactive` arg still wins/);
  const notes = text.split('\n').filter((l) => l.startsWith('**Default note:**'));
  assert.strictEqual(notes.length, 1, 'expected exactly one **Default note:** line');
  assert.match(notes[0], /Exception \(#3372\): `default-off` does not lower/);
  assert.match(notes[0], /`dispatched: true`/);
  assert.match(notes[0], /an explicit mode keyword still outranks the binding/);
});

test('auto-mode-card.md interactive row mirrors the exception', () => {
  const row = tableRow(read('plugin', 'skills', '_shared', 'auto-mode-card.md'), 'interactive');
  assert.match(row, /`dispatched: true`/);
});

test('policy-schema.md auto-mode meaning cell states the exception', () => {
  const row = tableRow(read('plugin', 'skills', '_shared', 'policy-schema.md'), 'auto-mode');
  const meaning = row.split(/(?<!\\)\|/)[5];
  assert.match(meaning, /`dispatched: true`/);
  assert.match(meaning, /`default-off`\s*→\s*`interactive`/);
});

// --- The rung's `node -e` one-liner, extracted from the live prose and executed ---

const SNIPPET_RE = /`node -e '([^']+)' "\$\{CLAUDE_PLUGIN_ROOT\}" "\$PIPELINE_RUN_DIR"`/;

// The JS between `node -e '` and `' "${CLAUDE_PLUGIN_ROOT}" "$PIPELINE_RUN_DIR"` in rung 2. Fails
// loudly when the span is absent so a reworded rung cannot turn the run tests into silent no-ops.
function rungSnippet(rung2Text) {
  const m = rung2Text.match(SNIPPET_RE);
  assert.ok(m, 'rung 2 no longer carries the node -e span ending in "${CLAUDE_PLUGIN_ROOT}" "$PIPELINE_RUN_DIR"');
  return m[1];
}

function liveSnippet() {
  return rungSnippet(liveRung2().text);
}

test('synthetic: the snippet extractor fails on a rung with no one-liner and returns the JS otherwise', () => {
  assert.throws(() => rungSnippet('**Dispatch binding → `auto`** (#3372). Reworded.'), /no longer carries/);
  const ok = 'x `node -e \'console.log(1)\' "${CLAUDE_PLUGIN_ROOT}" "$PIPELINE_RUN_DIR"` y';
  assert.strictEqual(rungSnippet(ok), 'console.log(1)');
});

const PLUGIN_ROOT = path.join(__dirname, '..', 'plugin');

function git(cwd, ...args) {
  return execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', ...args], { cwd, stdio: 'pipe' });
}

let tmp;
let mainCheckout;
let linkedWorktree;
let seq = 0;

before(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-dispatch-rung-'));
  mainCheckout = path.join(tmp, 'main');
  linkedWorktree = path.join(tmp, 'linked');
  fs.mkdirSync(mainCheckout);
  git(mainCheckout, 'init', '-q');
  fs.writeFileSync(path.join(mainCheckout, 'f.txt'), 'x\n');
  git(mainCheckout, 'add', 'f.txt');
  git(mainCheckout, 'commit', '-q', '-m', 'init');
  git(mainCheckout, 'worktree', 'add', '-q', '-b', 'wt', linkedWorktree);
});

after(() => {
  if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
});

// A run dir under `<root>/.claude-tweaks/pipelines/`; `state` is the run-state.json text, or null for none.
function runDir(root, state) {
  const dir = path.join(root, '.claude-tweaks', 'pipelines', `2026-10-17T00000${seq++}-case`);
  fs.mkdirSync(dir, { recursive: true });
  if (state !== null) fs.writeFileSync(path.join(dir, 'run-state.json'), state);
  return dir;
}

function runSnippet(dir, cwd) {
  return execFileSync(process.execPath, ['-e', liveSnippet(), PLUGIN_ROOT, dir], { cwd, encoding: 'utf8', stdio: 'pipe' });
}

test('rung 2 snippet prints `dispatched` for an anchored dispatched run dir', () => {
  const dir = runDir(mainCheckout, '{"dispatched":true}');
  assert.strictEqual(runSnippet(dir, linkedWorktree), 'dispatched\n');
  assert.strictEqual(runSnippet(dir, mainCheckout), 'dispatched\n');
});

test('rung 2 snippet prints nothing for a worktree-local shadow run dir carrying dispatched: true', () => {
  const dir = runDir(linkedWorktree, '{"dispatched":true}');
  assert.strictEqual(runSnippet(dir, linkedWorktree), '');
});

test('rung 2 snippet prints nothing for a non-dispatched, unparseable, missing, or empty run state', () => {
  assert.strictEqual(runSnippet(runDir(mainCheckout, '{"dispatched":false}'), linkedWorktree), '', 'dispatched: false');
  assert.strictEqual(runSnippet(runDir(mainCheckout, '{"dispatched":"true"}'), linkedWorktree), '', 'dispatched: "true" string');
  assert.strictEqual(runSnippet(runDir(mainCheckout, '{not json'), linkedWorktree), '', 'unparseable run-state.json');
  assert.strictEqual(runSnippet(runDir(mainCheckout, null), linkedWorktree), '', 'missing run-state.json');
  assert.strictEqual(runSnippet('', linkedWorktree), '', 'empty PIPELINE_RUN_DIR');
});
