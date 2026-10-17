# PR Spec-Summary Refresh After a Premise Reversal — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a build logs a premise reversal, the `pr-first` draft PR's `### Spec summary` is re-composed from the implemented behavior under a `Revised during build:` note, at the next phase-checklist update.

**Architecture:** A canonical `premise reversed: {original claim} → {implemented behavior}` `decisions.md` line (logged by `/claude-tweaks:build`) is the trigger. Pure functions in `plugin/bin/lib/flow/pr-body.js` parse those lines and apply an idempotent, heading-anchored rewrite of the Spec summary span. A thin CLI, `plugin/bin/revise-pr-summary.js`, reads the run's `decisions.md` file(s) and a body file, and either reports what is unnoted or writes the revised body. `_shared/pr-checklist-refresh.md`'s Phase-checklist update runs it before its one body write; the pre-merge refresh already re-runs that update, so merge time is covered with no extra step.

**Tech Stack:** Node 18+ CommonJS, `node --test`, markdown skill prose.

**Spec:** `.claude-tweaks/pipelines/2026-10-17T073340-spec-3050/work/3050-spec.md` (record #3050)

## Global Constraints

- Marker text, verbatim: `premise reversed:` followed by the original claim, ` → ` (U+2192 with one space each side), and the implemented behavior.
- Note text, verbatim: `Revised during build: {original claim} → {implemented behavior}`, with multiple entries joined by `; `.
- With no `premise reversed:` entry, the PR body's `### Spec summary` stays byte-unchanged.
- A failed Spec-summary edit is logged and never blocks the phase exit or the merge (same posture as `pr-checklist-refresh.md`'s "Best-effort, like the phase-exit push it follows").
- Never invent behavior not visible in the diff; the rewritten summary stays one paragraph.
- In a bundle sharing one PR, never let one spec's rewrite drop another spec's note entry.
- `plugin/bin/lib/flow/pr-body.js` reads and writes no files (its header says so); file I/O lives in the CLI.
- Commit style: `{Verb} {what} — {detail}`, body `refs #3050`, trailer `Claude-Session: https://claude.ai/code/session_011ZYKWYizjVE2LRbdQhzmBy`. Never `closes`/`fixes` in a commit.
- Composed-bytes ceiling is `CEILING_BYTES = 50 * 1024` (`plugin/bin/lib/skill-audit/context-cost.js:35`); `pr-checklist-refresh.md` is part of the `merge` bundle with `pr-first-merge.md` (44,199 B raw today), so keep its addition under ~2 KB.

## Plumbing decision (span location)

The Spec summary has no delimiter markers, unlike the phases and fixes spans. The rewrite locates it by its `### Spec summary` heading line, up to the next heading of level 1–3 (`### Phases` in the template). MCP reads strip only `<!-- ... -->` spans (`_shared/pr-early-run-lifecycle.md`'s Root cause section) and headings survive both transports, so this needs no new body markers and no change to `composePrEarlyBody`/`repairPrBody`'s template contract. A body with no `### Spec summary` heading is left unchanged (`reason: 'no-spec-summary-heading'`). `repairPrBody` does not restore that heading, and fabricating one is out of scope.

## Multi-spec decision

A bundle's one PR carries one Spec summary and one note line. The CLI reads every spec's `spec-{id}/decisions.md` (from the parent `manifest.yml`), so the reversal set is the union across specs. An existing note line is kept verbatim, and only entries it does not already contain are appended. A sibling spec's earlier entries therefore survive any later rewrite. The paragraph is re-composed by the agent each time and must describe the whole run's implemented behavior.

## Review Focus

1. An original claim that itself contains ` → `: parse on the first arrow. Test it so the split is deterministic rather than silently wrong.
2. A logged line whose implemented-behavior text ends in `.`: `log-decision.js`'s `formatEntry` only adds a period when the text has none, so the parser must strip at most one trailing period before ` Reversibility:`. Internal periods must be kept.
3. A body whose `### Spec summary` heading is missing (a hand-edited PR): return unchanged with a reason, never prepend a new section.
4. A bundle where spec A's note is already in the body and spec B adds a reversal: A's entry survives verbatim and B's is appended.
5. A CRLF body (as some API reads return): the heading is still located, and the rewrite still lands.

---

### Task 1: Premise-reversal parsing and Spec-summary rewrite in `pr-body.js`

**Files:**
- Modify: `plugin/bin/lib/flow/pr-body.js` (add functions before `module.exports`, extend the exports)
- Test: `tests/bin-lib/flow/pr-body-premise-reversal.test.js` (new file)

**Interfaces:**
- Consumes: nothing new.
- Produces (exported from `plugin/bin/lib/flow/pr-body.js`):
  - `PREMISE_REVERSED_MARKER` — the string `'premise reversed:'`
  - `REVISION_PREFIX` — the string `'Revised during build:'`
  - `parsePremiseReversals(text: string) -> Array<{original: string, replacement: string}>`. Order of first appearance, deduplicated by `formatReversal` key.
  - `formatReversal({original, replacement}) -> string` — `` `${original} → ${replacement}` ``
  - `reviseSpecSummary({body: string, reversals: Array<{original, replacement}>, summary?: string}) -> {body: string, changed: boolean, uncovered: string[], reason: null | 'no-reversals' | 'no-spec-summary-heading' | 'already-noted' | 'summary-required'}`

- [ ] **Step 1: Write the failing test**

Covers AC3.1 (the `no reversals leaves the body byte-unchanged` test). Create `tests/bin-lib/flow/pr-body-premise-reversal.test.js`:

```js
// tests/bin-lib/flow/pr-body-premise-reversal.test.js — #3050: parsing the
// canonical `premise reversed:` decisions.md line and the idempotent,
// heading-anchored Spec-summary rewrite in plugin/bin/lib/flow/pr-body.js.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  composePrEarlyBody, parsePremiseReversals, formatReversal, reviseSpecSummary,
  PREMISE_REVERSED_MARKER, REVISION_PREFIX,
} = require('../../../plugin/bin/lib/flow/pr-body');

// The exact line bin/log-decision.js writes for this marker.
const line = (text, step = 'Spec Step 3') => `- AUTO 09:35:19 — ${step}: ${text} Reversibility: high.`;

function body(summary = 'Reads the deployed commit from the health endpoint.') {
  return composePrEarlyBody({ runId: 'r1', specSummary: summary, target: '#3050', nextStep: 'build', fixesLines: ['Fixes #3050'] });
}

test('the two literals are exported verbatim', () => {
  assert.equal(PREMISE_REVERSED_MARKER, 'premise reversed:');
  assert.equal(REVISION_PREFIX, 'Revised during build:');
});

test('parsePremiseReversals reads the log-decision line shape and strips the one period formatEntry adds', () => {
  const text = [
    '## /build',
    line('premise reversed: read the deployed commit from /health → read it from the release tag.'),
    line('confirmed: the endpoint exists.'),
  ].join('\n');
  assert.deepEqual(parsePremiseReversals(text), [
    { original: 'read the deployed commit from /health', replacement: 'read it from the release tag' },
  ]);
});

test('parsePremiseReversals keeps internal periods and splits on the first arrow (Review Focus 1, 2)', () => {
  const text = line('premise reversed: v1.2 sha → ancestry → judge age on main v1.3.');
  assert.deepEqual(parsePremiseReversals(text), [{ original: 'v1.2 sha', replacement: 'ancestry → judge age on main v1.3' }]);
});

test('parsePremiseReversals dedupes repeated entries and ignores non-entry text', () => {
  const entry = line('premise reversed: A → B.');
  const text = [entry, 'premise reversed: hand-written → not an entry', entry, line('premise reversed: C → D.', 'spec #9 — Spec Step 3')].join('\n');
  assert.deepEqual(parsePremiseReversals(text), [{ original: 'A', replacement: 'B' }, { original: 'C', replacement: 'D' }]);
  assert.deepEqual(parsePremiseReversals(''), []);
});

test('formatReversal joins with a spaced U+2192 arrow', () => {
  assert.equal(formatReversal({ original: 'A', replacement: 'B' }), 'A → B');
});

test('no reversals leaves the body byte-unchanged', () => {
  const b = body();
  const r = reviseSpecSummary({ body: b, reversals: [], summary: 'ignored' });
  assert.equal(r.body, b);
  assert.equal(r.changed, false);
  assert.equal(r.reason, 'no-reversals');
});

test('a reversal rewrites only the Spec summary span, note line first', () => {
  const b = body();
  const r = reviseSpecSummary({ body: b, reversals: [{ original: 'health endpoint', replacement: 'release tag' }], summary: 'Reads the deployed commit from the release tag.\n' });
  assert.equal(r.changed, true);
  assert.deepEqual(r.uncovered, ['health endpoint → release tag']);
  assert.match(r.body, /### Spec summary\n\nRevised during build: health endpoint → release tag\n\nReads the deployed commit from the release tag\.\n\n### Phases\n/);
  assert.doesNotMatch(r.body, /health endpoint\.$/m);
  // everything from ### Phases on is untouched
  assert.equal(r.body.slice(r.body.indexOf('### Phases')), b.slice(b.indexOf('### Phases')));
});

test('re-running with the same reversal is idempotent — already-noted, unchanged', () => {
  const rev = [{ original: 'A', replacement: 'B' }];
  const first = reviseSpecSummary({ body: body(), reversals: rev, summary: 'New behavior.' });
  const second = reviseSpecSummary({ body: first.body, reversals: rev, summary: 'Different paragraph.' });
  assert.equal(second.changed, false);
  assert.equal(second.reason, 'already-noted');
  assert.equal(second.body, first.body);
});

test('a sibling spec\'s existing note entry survives; only the new entry is appended (Review Focus 4)', () => {
  const afterA = reviseSpecSummary({ body: body(), reversals: [{ original: 'A', replacement: 'B' }], summary: 'Run behavior v1.' }).body;
  const r = reviseSpecSummary({ body: afterA, reversals: [{ original: 'A', replacement: 'B' }, { original: 'C', replacement: 'D' }], summary: 'Run behavior v2.' });
  assert.equal(r.changed, true);
  assert.deepEqual(r.uncovered, ['C → D']);
  assert.match(r.body, /\nRevised during build: A → B; C → D\n\nRun behavior v2\.\n/);
  assert.equal((r.body.match(/Revised during build:/g) || []).length, 1);
});

test('missing Spec summary heading leaves the body unchanged with a reason (Review Focus 3)', () => {
  const b = 'claude-tweaks-run: r1\n\n### Phases\n\n- [ ] build\n';
  const r = reviseSpecSummary({ body: b, reversals: [{ original: 'A', replacement: 'B' }], summary: 'x' });
  assert.equal(r.body, b);
  assert.equal(r.changed, false);
  assert.equal(r.reason, 'no-spec-summary-heading');
  assert.deepEqual(r.uncovered, ['A → B']);
});

test('an empty summary is refused — unchanged, summary-required, uncovered reported', () => {
  const b = body();
  const r = reviseSpecSummary({ body: b, reversals: [{ original: 'A', replacement: 'B' }], summary: '   ' });
  assert.equal(r.body, b);
  assert.equal(r.changed, false);
  assert.equal(r.reason, 'summary-required');
  assert.deepEqual(r.uncovered, ['A → B']);
});

test('a CRLF body still has its Spec summary located and rewritten (Review Focus 5)', () => {
  const b = body().replace(/\n/g, '\r\n');
  const r = reviseSpecSummary({ body: b, reversals: [{ original: 'A', replacement: 'B' }], summary: 'New.' });
  assert.equal(r.changed, true);
  assert.match(r.body, /Revised during build: A → B/);
  assert.match(r.body, /### Phases/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/bin-lib/flow/pr-body-premise-reversal.test.js`
Expected: FAIL — `parsePremiseReversals is not a function` (the exports do not exist yet)

- [ ] **Step 3: Write minimal implementation**

In `plugin/bin/lib/flow/pr-body.js`, insert immediately before `module.exports = {`:

```js
// Premise reversals (#3050) — the one canonical decisions.md entry shape,
// defined in _shared/pr-checklist-refresh.md's "Premise-reversal decisions"
// paragraph: `premise reversed: {original claim} → {implemented behavior}`,
// written through bin/log-decision.js, so every real line carries
// formatEntry's `- {STATUS} {HH:MM:SS} — {location}: ` prefix and its
// ` Reversibility: {r}.` suffix. Matched here and nowhere else — a
// differently-worded line for the same decision is silently missed.
const PREMISE_REVERSED_MARKER = 'premise reversed:';
const REVISION_PREFIX = 'Revised during build:';
const PREMISE_REVERSED_RE = /^-\s+[A-Z-]+\s+\d{2}:\d{2}:\d{2}\s+—\s.*?\bpremise reversed:\s+(.+?)\s+→\s+(.+?)\.?\s+Reversibility:/;

function formatReversal({ original, replacement }) {
  return `${original} → ${replacement}`;
}

// decisions.md text -> [{original, replacement}], first-appearance order,
// deduplicated on formatReversal's key. Splits on the first ` → `; strips at
// most the one trailing period formatEntry adds (internal periods kept).
function parsePremiseReversals(text) {
  const seen = new Set();
  const result = [];
  for (const rawLine of String(text || '').split('\n')) {
    const match = PREMISE_REVERSED_RE.exec(rawLine.replace(/\r$/, ''));
    if (!match) continue;
    const reversal = { original: match[1].trim(), replacement: match[2].trim() };
    const key = formatReversal(reversal);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(reversal);
  }
  return result;
}

// The Spec summary has no delimiter markers: locate it by its heading line,
// up to the next level 1-3 heading. Headings survive both a gh read and a
// gh-absent MCP read (only `<!-- ... -->` spans are stripped).
function locateSpecSummary(lines) {
  const start = lines.findIndex((l) => l.trim() === '### Spec summary');
  if (start === -1) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^#{1,3}\s/.test(lines[i])) { end = i; break; }
  }
  return { start, end };
}

// { body, reversals, summary? } -> { body, changed, uncovered, reason }.
// Idempotent: a reversal already named in the span's existing
// `Revised during build:` line is covered. An existing note is kept
// verbatim and only uncovered entries are appended (`; `-joined), so a
// sibling spec's entries in a shared bundle PR are never dropped. The new
// paragraph (agent-written from the diff) replaces the old one.
function reviseSpecSummary({ body, reversals, summary }) {
  const text = typeof body === 'string' ? body : '';
  const wanted = (reversals || []).map(formatReversal);
  if (wanted.length === 0) return { body: text, changed: false, uncovered: [], reason: 'no-reversals' };
  const lines = text.split('\n');
  const span = locateSpecSummary(lines);
  if (!span) return { body: text, changed: false, uncovered: wanted, reason: 'no-spec-summary-heading' };
  const note = lines.slice(span.start + 1, span.end)
    .map((l) => l.replace(/\r$/, ''))
    .find((l) => l.startsWith(REVISION_PREFIX)) || null;
  const uncovered = wanted.filter((w) => !(note && note.includes(w)));
  if (uncovered.length === 0) return { body: text, changed: false, uncovered: [], reason: 'already-noted' };
  const paragraph = String(summary || '').trim();
  if (!paragraph) return { body: text, changed: false, uncovered, reason: 'summary-required' };
  const newNote = note ? `${note}; ${uncovered.join('; ')}` : `${REVISION_PREFIX} ${uncovered.join('; ')}`;
  const out = [...lines.slice(0, span.start + 1), '', newNote, '', paragraph, '', ...lines.slice(span.end)];
  return { body: out.join('\n'), changed: true, uncovered, reason: null };
}
```

Then extend the exports object by adding these names after `repairPrBody,`:

```js
  PREMISE_REVERSED_MARKER,
  REVISION_PREFIX,
  parsePremiseReversals,
  formatReversal,
  reviseSpecSummary,
```

Also update the module's header comment (lines 1–6): after "nothing else in this module reads or writes a file;" keep it true, and add one sentence: `Also parses build's premise-reversal decisions.md lines and rewrites the Spec summary span from them (#3050).`

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/bin-lib/flow/pr-body-premise-reversal.test.js tests/bin-lib/flow/pr-body.test.js`
Expected: PASS, all tests (the existing pr-body suite stays green)

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/flow/pr-body.js tests/bin-lib/flow/pr-body-premise-reversal.test.js
git commit -F <message-file>
```
Message: `Add premise-reversal parsing and an idempotent Spec-summary rewrite to pr-body.js — heading-anchored, sibling notes kept` + blank line + `refs #3050` + blank line + the `Claude-Session:` trailer.

---

### Task 2: `bin/revise-pr-summary.js` CLI

**Files:**
- Create: `plugin/bin/revise-pr-summary.js`
- Test: `tests/revise-pr-summary-cli.test.js` (new file)
- Modify: `docs/plugin-structure.md` — the command-reference block (next to the `compose-pr-body.js` line, ~:153) and the `plugin/bin/lib/flow/` row's `pr-body.js` description (~:47)

**Interfaces:**
- Consumes: `parsePremiseReversals`, `reviseSpecSummary` from Task 1; `readManifest(runDir)` from `plugin/bin/lib/flow/manifest.js` (returns `null` without a `manifest.yml`, else an object whose `multispec.specs` is `[{id, ...}]`).
- Produces: `run(argv: string[], deps) -> exitCode` and `parseArgs(argv)`, exported. Invocation:
  - `revise-pr-summary.js --run-dir <dir> --body-file <file>` → report mode: writes nothing, prints one JSON line `{reversals, uncovered, changed: false, reason}`, exit 0.
  - `revise-pr-summary.js --run-dir <dir> --body-file <file> --summary-file <file> --out <file>` → apply mode: prints `{reversals, uncovered, changed, reason, out}`, writes `--out` only when `changed` is true, exit 0.
  - Exit 2: unknown or valueless flag, missing `--run-dir`/`--body-file`, `--summary-file` without `--out` (or the reverse), an unreadable body or summary file, or an unwritable `--out`.
  - Reversal source: when `readManifest(runDir)` returns `multispec.specs`, every `{runDir}/spec-{id}/decisions.md`; otherwise `{runDir}/decisions.md`. A missing `decisions.md` contributes nothing (fail-open, the same posture as `readDeferredClosures`).

- [ ] **Step 1: Write the failing test**

Create `tests/revise-pr-summary-cli.test.js`:

```js
// tests/revise-pr-summary-cli.test.js — bin/revise-pr-summary.js (#3050).
// In-process via run(argv, deps), plus one real subprocess run against a
// temp run dir so the shipped invocation form is exercised end to end.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { run } = require('../plugin/bin/revise-pr-summary');
const { composePrEarlyBody } = require('../plugin/bin/lib/flow/pr-body');

const CLI = path.join(__dirname, '..', 'plugin', 'bin', 'revise-pr-summary.js');
const BODY = composePrEarlyBody({ runId: 'r1', specSummary: 'Old mechanism.', target: '#3050', nextStep: 'build', fixesLines: ['Fixes #3050'] });
const REV = '- AUTO 09:35:19 — Spec Step 3: premise reversed: health endpoint → release tag. Reversibility: high.';

function fakeDeps(files, manifest = null) {
  const calls = { stdout: [], stderr: [] };
  return {
    calls, files,
    readFile: (p) => { if (!(p in files)) throw new Error(`ENOENT: ${p}`); return files[p]; },
    writeFile: (p, s) => { files[p] = s; },
    readManifest: () => manifest,
    stdout: (s) => calls.stdout.push(s),
    stderr: (s) => calls.stderr.push(s),
  };
}
const out = (deps) => JSON.parse(deps.calls.stdout[0]);

test('report mode: lists uncovered reversals, writes nothing', () => {
  const deps = fakeDeps({ '/rd/decisions.md': REV, '/b.md': BODY });
  assert.equal(run(['--run-dir', '/rd', '--body-file', '/b.md'], deps), 0);
  assert.deepEqual(out(deps), { reversals: 1, uncovered: ['health endpoint → release tag'], changed: false, reason: 'summary-required' });
  assert.deepEqual(Object.keys(deps.files).sort(), ['/b.md', '/rd/decisions.md']);
});

test('no decisions.md at all is fail-open: zero reversals, no-reversals', () => {
  const deps = fakeDeps({ '/b.md': BODY });
  assert.equal(run(['--run-dir', '/rd', '--body-file', '/b.md'], deps), 0);
  assert.equal(out(deps).reason, 'no-reversals');
});

test('apply mode writes the revised body to --out', () => {
  const deps = fakeDeps({ '/rd/decisions.md': REV, '/b.md': BODY, '/s.md': 'Reads the release tag.\n' });
  assert.equal(run(['--run-dir', '/rd', '--body-file', '/b.md', '--summary-file', '/s.md', '--out', '/o.md'], deps), 0);
  const o = out(deps);
  assert.equal(o.changed, true);
  assert.equal(o.out, '/o.md');
  assert.match(deps.files['/o.md'], /Revised during build: health endpoint → release tag\n\nReads the release tag\./);
});

test('apply mode with every reversal already noted writes nothing', () => {
  const noted = BODY.replace('Old mechanism.', 'Revised during build: health endpoint → release tag\n\nReads the release tag.');
  const deps = fakeDeps({ '/rd/decisions.md': REV, '/b.md': noted, '/s.md': 'x' });
  assert.equal(run(['--run-dir', '/rd', '--body-file', '/b.md', '--summary-file', '/s.md', '--out', '/o.md'], deps), 0);
  assert.equal(out(deps).reason, 'already-noted');
  assert.equal('/o.md' in deps.files, false);
});

test('bundle run reads every spec-{id}/decisions.md and unions them', () => {
  const deps = fakeDeps({
    '/rd/spec-1/decisions.md': REV,
    '/rd/spec-2/decisions.md': '- AUTO 10:00:00 — spec #2 — Spec Step 3: premise reversed: C → D. Reversibility: high.',
    '/rd/decisions.md': '- AUTO 10:00:00 — x: premise reversed: parent → ignored. Reversibility: high.',
    '/b.md': BODY,
  }, { multispec: { specs: [{ id: 1 }, { id: 2 }, { id: 3 }] } });
  assert.equal(run(['--run-dir', '/rd', '--body-file', '/b.md'], deps), 0);
  assert.deepEqual(out(deps).uncovered, ['health endpoint → release tag', 'C → D']);
});

test('malformed invocations exit 2 and write nothing', () => {
  const cases = [
    [],
    ['--run-dir', '/rd'],
    ['--body-file', '/b.md'],
    ['--run-dir', '/rd', '--body-file', '/b.md', '--summary-file', '/s.md'],
    ['--run-dir', '/rd', '--body-file', '/b.md', '--out', '/o.md'],
    ['--run-dir', '/rd', '--body-file', '/missing.md'],
    ['--run-dir', '/rd', '--body-file', '/b.md', '--bogus', 'x'],
    ['--run-dir', '--body-file', '/b.md'],
  ];
  for (const argv of cases) {
    const deps = fakeDeps({ '/b.md': BODY, '/s.md': 's' });
    assert.equal(run(argv, deps), 2, argv.join(' '));
    assert.equal('/o.md' in deps.files, false);
  }
});

test('an unreadable --summary-file or unwritable --out is exit 2', () => {
  const deps = fakeDeps({ '/rd/decisions.md': REV, '/b.md': BODY });
  assert.equal(run(['--run-dir', '/rd', '--body-file', '/b.md', '--summary-file', '/nope.md', '--out', '/o.md'], deps), 2);
  const deps2 = fakeDeps({ '/rd/decisions.md': REV, '/b.md': BODY, '/s.md': 'x' });
  deps2.writeFile = () => { throw new Error('EACCES'); };
  assert.equal(run(['--run-dir', '/rd', '--body-file', '/b.md', '--summary-file', '/s.md', '--out', '/o.md'], deps2), 2);
});

test('real subprocess: a temp single-record run dir is revised end to end', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'revise-pr-summary-'));
  fs.writeFileSync(path.join(dir, 'decisions.md'), `${REV}\n`);
  fs.writeFileSync(path.join(dir, 'body.md'), BODY);
  fs.writeFileSync(path.join(dir, 'summary.md'), 'Reads the release tag.\n');
  const stdout = execFileSync(process.execPath, [CLI, '--run-dir', dir, '--body-file', path.join(dir, 'body.md'),
    '--summary-file', path.join(dir, 'summary.md'), '--out', path.join(dir, 'out.md')], { encoding: 'utf8' });
  assert.equal(JSON.parse(stdout).changed, true);
  assert.match(fs.readFileSync(path.join(dir, 'out.md'), 'utf8'), /Revised during build: health endpoint → release tag/);
  fs.rmSync(dir, { recursive: true, force: true });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/revise-pr-summary-cli.test.js`
Expected: FAIL — `Cannot find module '../plugin/bin/revise-pr-summary'`

- [ ] **Step 3: Write minimal implementation**

Create `plugin/bin/revise-pr-summary.js`:

```js
#!/usr/bin/env node
// bin/revise-pr-summary.js — refresh a pr-first run's PR `### Spec summary`
// after build logged a premise reversal (#3050).
//   node bin/revise-pr-summary.js --run-dir <dir> --body-file <file>
//     [--summary-file <file> --out <file>] [--help]
// Reads this run's `premise reversed:` decisions.md entries (a bundle's
// every spec-{id}/decisions.md, else the run's own decisions.md) and the PR
// body in --body-file. Without --summary-file it reports which reversals the
// body's `Revised during build:` note does not yet name, and writes nothing.
// With --summary-file (the agent-written one-paragraph summary, read from a
// file so record text never passes through a shell) and --out, it writes the
// revised body to --out — only when something changed. The rewrite itself is
// bin/lib/flow/pr-body.js's reviseSpecSummary; the procedure that calls this
// is _shared/pr-checklist-refresh.md's Phase-checklist update.
// Exit 0 = reported or applied (stdout: one JSON line); 2 = malformed
// invocation, an unreadable --body-file/--summary-file, or an unwritable --out.
'use strict';

const fs = require('fs');
const path = require('path');
const { parsePremiseReversals, reviseSpecSummary } = require('./lib/flow/pr-body');
const { readManifest } = require('./lib/flow/manifest');

const USAGE = 'usage: revise-pr-summary.js --run-dir <dir> --body-file <file> [--summary-file <file> --out <file>] [--help]\n';

const FLAGS = { '--run-dir': 'runDir', '--body-file': 'bodyFile', '--summary-file': 'summaryFile', '--out': 'out' };

function parseArgs(argv) {
  const o = { help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') { o.help = true; continue; }
    if (!(a in FLAGS)) return { error: `unknown argument: ${a}` };
    const v = argv[i + 1];
    if (v === undefined || v.startsWith('--')) return { error: `${a} needs a value` };
    o[FLAGS[a]] = v;
    i++;
  }
  return o;
}

const realDeps = {
  readFile: (p) => fs.readFileSync(p, 'utf8'),
  writeFile: (p, s) => fs.writeFileSync(p, s),
  readManifest,
  stdout: (s) => process.stdout.write(s),
  stderr: (s) => process.stderr.write(s),
};

// A missing decisions.md contributes nothing — the same fail-open posture as
// manifest.js's readDeferredClosures.
function readReversals(runDir, deps) {
  const manifest = deps.readManifest(runDir);
  const specs = manifest && manifest.multispec && Array.isArray(manifest.multispec.specs) ? manifest.multispec.specs : null;
  const files = specs
    ? specs.map((s) => path.join(runDir, `spec-${s.id}`, 'decisions.md'))
    : [path.join(runDir, 'decisions.md')];
  let text = '';
  for (const f of files) {
    try { text += `${deps.readFile(f)}\n`; } catch { /* no decisions.md for this spec */ }
  }
  return parsePremiseReversals(text);
}

function run(argv, deps = realDeps) {
  const o = parseArgs(argv);
  const usageError = (message) => { deps.stderr(`revise-pr-summary.js: ${message}\n${USAGE}`); return 2; };
  if (o.error) return usageError(o.error);
  if (o.help) { deps.stdout(USAGE); return 0; }
  for (const flag of ['--run-dir', '--body-file']) {
    if (!o[FLAGS[flag]]) return usageError(`${flag} is required`);
  }
  if (Boolean(o.summaryFile) !== Boolean(o.out)) return usageError('--summary-file and --out go together');

  let body;
  try { body = deps.readFile(o.bodyFile); } catch (err) {
    return usageError(`could not read --body-file: ${o.bodyFile} (${err && err.message})`);
  }
  let summary;
  if (o.summaryFile) {
    try { summary = deps.readFile(o.summaryFile); } catch (err) {
      return usageError(`could not read --summary-file: ${o.summaryFile} (${err && err.message})`);
    }
  }

  const reversals = readReversals(o.runDir, deps);
  const result = reviseSpecSummary({ body, reversals, summary });
  const report = { reversals: reversals.length, uncovered: result.uncovered, changed: result.changed, reason: result.reason };
  if (result.changed) {
    try { deps.writeFile(o.out, result.body); } catch (err) {
      deps.stderr(`revise-pr-summary.js: could not write --out file: ${o.out} (${err && err.message})\n`);
      return 2;
    }
    report.out = o.out;
  }
  deps.stdout(`${JSON.stringify(report)}\n`);
  return 0;
}

module.exports = { run, parseArgs };

if (require.main === module) process.exitCode = run(process.argv.slice(2), realDeps);
```

Note on report mode: with no `--summary-file`, `reviseSpecSummary` returns `reason: 'summary-required'` whenever something is uncovered. That is the report's signal to write a summary. The CLI test pins this exactly.

Then edit `docs/plugin-structure.md`:
- Directly after the `node plugin/bin/compose-pr-body.js ...` command-reference line (~:153), add:
  `node plugin/bin/revise-pr-summary.js --run-dir <dir> --body-file <file> [--summary-file <file> --out <file>]   # Spec-summary refresh CLI (#3050) — reads this run's \`premise reversed:\` decisions.md entries (a bundle's every spec-{id}/decisions.md) and, through \`bin/lib/flow/pr-body.js\`'s reviseSpecSummary, reports which the PR body's \`Revised during build:\` note does not yet name (no --summary-file) or writes the revised body to --out; run by \`_shared/pr-checklist-refresh.md\`'s Phase-checklist update. Exit 0 reported/applied (one JSON line), 2 malformed invocation or an unreadable/unwritable file; tests in \`tests/revise-pr-summary-cli.test.js\``
- In the `plugin/bin/lib/flow/` row (~:47), after the `repairPrBody (...)` clause, add: `, and parsePremiseReversals/reviseSpecSummary (the canonical \`premise reversed:\` decisions.md line and the heading-anchored, idempotent Spec-summary rewrite, #3050 — consumed through \`bin/revise-pr-summary.js\`)`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/revise-pr-summary-cli.test.js tests/bin-lib/flow/pr-body-premise-reversal.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/revise-pr-summary.js tests/revise-pr-summary-cli.test.js docs/plugin-structure.md
git commit -F <message-file>
```
Message: `Add revise-pr-summary.js — report or apply the Spec-summary rewrite from a run's premise-reversal entries` + `refs #3050` + trailer.

---

### Task 3: Wire the marker and the refresh into skill prose, pinned by a conformance test

**Files:**
- Modify: `plugin/skills/_shared/pr-checklist-refresh.md` — new paragraph in "Phase-checklist update" (before "Compose-then-write-once", ~:73); new "Premise-reversal decisions" paragraph after "Multi-spec runs share one PR" (~:86); one clause in "Pre-merge title/description refresh" step 2 (~:119)
- Modify: `plugin/skills/_shared/pr-early-run-lifecycle.md` — one note after Step 3's composed-shape template fence (after ~:235)
- Modify: `plugin/skills/build/SKILL.md` — Spec Step 3's `ASSUMPTION` paragraph (~:122)
- Modify: `docs/skill-graph.md` — the `_shared/pr-checklist-refresh.md` row (~:112)
- Test: `tests/premise-reversal-spec-summary-3050.test.js` (new file)

**Interfaces:**
- Consumes: `PREMISE_REVERSED_MARKER`, `REVISION_PREFIX` (Task 1); `bin/revise-pr-summary.js` and its flags (Task 2).
- Produces: nothing code-facing.

- [ ] **Step 1: Write the failing test**

Covers AC1.1 (the build/SKILL.md test), AC2.1 (the definition and Phase-checklist-update tests: rewrite, trigger, note, idempotency) and AC4.1 (`never a phase-exit or merge blocker`). Create `tests/premise-reversal-spec-summary-3050.test.js`:

```js
// tests/premise-reversal-spec-summary-3050.test.js
//
// Pins the prose #3050 added so a pr-first PR's `### Spec summary` is
// re-composed after a build premise reversal:
// - build/SKILL.md names the canonical `premise reversed:` decisions.md line
//   for both an ASSUMPTION probe's reversed outcome and a Spec Step 3 plan
//   departure;
// - _shared/pr-checklist-refresh.md defines that line (its single home) and
//   runs bin/revise-pr-summary.js in the Phase-checklist update, with the
//   trigger, the `Revised during build:` note, the idempotency rule and the
//   best-effort posture;
// - _shared/pr-early-run-lifecycle.md says the template's Spec summary is not
//   frozen at run start.
// The literals are also pinned equal to pr-body.js's exported constants, so
// prose and parser cannot drift apart. Matching is whitespace-normalized
// ([IL-80]: this reads live prose because the wording asserted IS the
// contract).
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { PREMISE_REVERSED_MARKER, REVISION_PREFIX } = require('../plugin/bin/lib/flow/pr-body');

const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');
const norm = (s) => s.replace(/\s+/g, ' ');
const BUILD = norm(read('plugin', 'skills', 'build', 'SKILL.md'));
const REFRESH = norm(read('plugin', 'skills', '_shared', 'pr-checklist-refresh.md'));
const LIFECYCLE = norm(read('plugin', 'skills', '_shared', 'pr-early-run-lifecycle.md'));

function section(text, start, end) {
  const s = text.split(start)[1];
  assert.ok(s, `section "${start}" must exist`);
  return end ? s.split(end)[0] : s;
}

test('build/SKILL.md names the marker for an ASSUMPTION reversal and a Spec Step 3 departure', () => {
  const para = section(BUILD, '**Verify `ASSUMPTION — verify at build:` markers first (#1769).**', 'The plan will be written to');
  assert.match(para, /`premise reversed: \{original claim\} → \{implemented behavior\}`/);
  assert.match(para, /_shared\/pr-checklist-refresh\.md/);
  assert.match(para, /Spec Step 3 plan that departs from a spec premise/);
});

test('pr-checklist-refresh.md defines the one premise-reversal entry shape and its reader', () => {
  const para = section(REFRESH, '**Premise-reversal decisions (#3050).**', '## Pre-merge title/description refresh');
  assert.match(para, /`premise reversed: \{original claim\} → \{implemented behavior\}`/);
  assert.match(para, /bin\/log-decision\.js/);
  assert.match(para, /spec-\{id\}\/decisions\.md/);
  assert.match(para, /parsePremiseReversals/);
});

test('the Phase-checklist update runs the Spec-summary refresh with trigger, note, idempotency and posture', () => {
  const update = section(REFRESH, '## Phase-checklist update (every phase exit)', '## Pre-merge title/description refresh');
  const step = section(update, '**Refresh the Spec summary after a premise reversal (#3050).**', 'Compose-then-write-once');
  assert.match(step, /bin\/revise-pr-summary\.js/);
  assert.match(step, /`premise reversed:`/);
  assert.match(step, /`Revised during build: \{original claim\} → \{implemented behavior\}`/);
  assert.match(step, /byte-unchanged/);
  assert.match(step, /already noted/);
  assert.match(step, /`### Spec summary` heading/);
  assert.match(step, /never a phase-exit or merge blocker/);
  assert.match(step, /nothing it does not show/);
});

test('the pre-merge refresh step 2 still re-runs the whole update, Spec summary included', () => {
  const pre = section(REFRESH, '## Pre-merge title/description refresh', '## Merge-time gh-absent degrade');
  assert.match(pre, /Re-run the Phase-checklist update procedure above once more, unconditionally/);
  assert.match(pre, /its Spec-summary refresh included/);
});

test('pr-early-run-lifecycle.md says the Spec summary is rewritten after a reversal', () => {
  const step3 = section(LIFECYCLE, '### Step 3: Compose the body and create the draft PR', '### Step 4: Record the PR');
  assert.match(step3, /`### Spec summary` paragraph is not frozen here/);
  assert.match(step3, /_shared\/pr-checklist-refresh\.md/);
  assert.match(step3, /`Revised during build:`/);
});

test('prose literals equal pr-body.js\'s exported constants', () => {
  assert.equal(PREMISE_REVERSED_MARKER, 'premise reversed:');
  assert.equal(REVISION_PREFIX, 'Revised during build:');
  assert.ok(REFRESH.includes(`\`${PREMISE_REVERSED_MARKER} {original claim} → {implemented behavior}\``));
  assert.ok(REFRESH.includes(`\`${REVISION_PREFIX} {original claim} → {implemented behavior}\``));
  assert.ok(BUILD.includes(`\`${PREMISE_REVERSED_MARKER} {original claim} → {implemented behavior}\``));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/premise-reversal-spec-summary-3050.test.js`
Expected: FAIL — `section "**Verify `ASSUMPTION — verify at build:` markers first (#1769).**" ...` assertions on `premise reversed:` fail (no prose names it yet)

- [ ] **Step 3: Edit the prose**

**3a. `plugin/skills/build/SKILL.md`** — in the `**Verify \`ASSUMPTION — verify at build:\` markers first (#1769).**` paragraph, replace exactly:

`Log each outcome as one \`decisions.md\` line per \`_shared/auto-decision-log.md\` (\`confirmed\` or \`reversed\`, naming the probe).`

with:

`Log each outcome as one \`decisions.md\` line per \`_shared/auto-decision-log.md\` — \`confirmed\`, naming the probe, or, for a reversal, \`_shared/pr-checklist-refresh.md\`'s \`premise reversed: {original claim} → {implemented behavior}\` line, which refreshes the PR's Spec summary.`

and append to the end of that same paragraph (after "...now-disproven claim."):

` A Spec Step 3 plan that departs from a spec premise on its own judgment logs the same line.`

Check: `wc -c plugin/skills/build/SKILL.md` stays under 51200 (it starts at 45,995; this adds ~200 B).

**3b. `plugin/skills/_shared/pr-checklist-refresh.md`** — insert this paragraph immediately before the line beginning `  Compose-then-write-once` (keep the two-space indent the surrounding list item uses):

```
  **Refresh the Spec summary after a premise reversal (#3050).** After composing the file above
  and before its run-id re-read and `gh pr edit` (or the MCP write), run `node
  "${CLAUDE_PLUGIN_ROOT}/bin/revise-pr-summary.js" --run-dir "{run-dir}" --body-file
  /tmp/pr-checklist-{run-id}-{n}.md`. It reads this run's `premise reversed:` entries
  ("Premise-reversal decisions" below) and prints which ones the body's `### Spec summary` note
  does not yet name. With none logged, or every one already noted (`changed: false`), write the
  body as composed so far: the Spec summary stays byte-unchanged. Otherwise, write a one-paragraph
  summary of the implemented behavior to a session temp file with the Write tool. Take it from this
  run's diff and nothing it does not show, and cover every spec for a bundle. Then re-run with
  `--summary-file {file} --out /tmp/pr-checklist-{run-id}-{n}.md`. It locates the span by its
  `### Spec summary` heading up to the next heading (headings survive both transports; only
  `<!-- ... -->` spans are stripped, per `_shared/pr-early-run-lifecycle.md`'s Root cause section).
  It writes one `Revised during build: {original claim} → {implemented behavior}` note above the
  new paragraph, with entries `; `-joined and appended to any note already there, so a bundle's
  sibling-spec entries are never dropped. Best-effort, like the checklist edit: a non-zero exit
  logs a warning to `decisions.md`, and the update writes the checklist-only body. It is never a
  phase-exit or merge blocker.
```

Then insert, immediately after the "**Multi-spec runs share one PR.**" paragraph (before `## Pre-merge title/description refresh`):

```
**Premise-reversal decisions (#3050).** The one `decisions.md` entry shape the Spec-summary
refresh above reads. It is written through `bin/log-decision.js` (`--status AUTO`): to the run's
own top-level `decisions.md` for a single-record run, or to that spec's `spec-{id}/decisions.md`
in a bundle (the same placement as `_shared/pr-early-run-lifecycle.md`'s Deferred-closure
decisions):

`premise reversed: {original claim} → {implemented behavior}`

`/claude-tweaks:build` logs it whenever the build changes a mechanism the spec described: an
`ASSUMPTION — verify at build:` probe that came back reversed, or a Spec Step 3 plan departing
from a spec premise. `{original claim}` must not itself contain ` → `. Its reader is
`parsePremiseReversals` (`bin/lib/flow/pr-body.js`). Do not log a differently-worded line for the
same decision; the refresh would silently miss it.
```

Then, in "Pre-merge title/description refresh" step 2, change `2. Re-run the Phase-checklist update procedure above once more, unconditionally — idempotent` to `2. Re-run the Phase-checklist update procedure above once more, unconditionally, its Spec-summary refresh included — idempotent`.

**3c. `plugin/skills/_shared/pr-early-run-lifecycle.md`** — immediately after the closing fence of Step 3's "Composed shape" template (the line after `<!-- fixes-end -->`'s fence), insert:

```

The `### Spec summary` paragraph is not frozen here: when the build logs a `premise reversed:`
entry, `_shared/pr-checklist-refresh.md`'s Phase-checklist update rewrites it from the
implemented behavior under a `Revised during build:` note (#3050).
```

**3d. `docs/skill-graph.md`** — in the `| \`_shared/pr-checklist-refresh.md\` |` row, append before the row's closing ` |`: ` Since #3050 it is also the single home of the \`premise reversed:\` decisions.md line \`/build\` Spec Step 3 logs, which its Phase-checklist update reads (through \`bin/revise-pr-summary.js\`) to rewrite the PR's Spec summary.`

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/premise-reversal-spec-summary-3050.test.js tests/deferred-closure-fixes-2686.test.js tests/pr-early-run-lifecycle.test.js tests/bin-lib/skill-audit/context-cost.test.js tests/skill-graph-dangling-pointer.test.js tests/compose-markers-conformance.test.js`
Expected: PASS (the context-cost suite confirms the `merge` bundle stays under its composed ceiling)

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/build/SKILL.md plugin/skills/_shared/pr-checklist-refresh.md plugin/skills/_shared/pr-early-run-lifecycle.md docs/skill-graph.md tests/premise-reversal-spec-summary-3050.test.js
git commit -F <message-file>
```
Message: `Wire premise reversals into the PR Spec summary — build logs one canonical line, the phase-checklist update rewrites the summary` + `refs #3050` + trailer.

---

Waived AC5.1: the full `npm test` suite runs centrally at build's Common Step 5 (and again at `/test`), never inside one task — each task's Step 4 runs only the suites it touches.

## Self-review notes

- **Spec coverage:** D1 marker → Task 3a/3b (+ Task 1's parser). D2 rewrite step → Tasks 1, 2 and 3b. D3 idempotency → Task 1 tests. AC "byte-unchanged with no reversal" → Task 1 test plus 3b's prose. AC failed edit never blocks → 3b's prose. AC npm test → the full suite runs centrally at build's Common Step 5. Gotcha: transport-aware span → Plumbing decision. Gotcha: multi-spec → Multi-spec decision plus the Task 1 and 2 tests. Gotcha: one paragraph, no invented behavior → 3b's prose.
- **Types:** `parsePremiseReversals`/`formatReversal`/`reviseSpecSummary`/`PREMISE_REVERSED_MARKER`/`REVISION_PREFIX` keep the same names across Tasks 1–3. The `reason` values are the same set in Tasks 1 and 2.
