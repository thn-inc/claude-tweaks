# Shaping mode emits and validates the Release Note — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/specify` shaping mode always emits `## Release Note`, and never stamps `ready` on a body the Materialization gate would reject — with exactly one structural checker in the repo (the gate's `shapeGate`).

**Architecture:** `materialize-format.js` gains one additive export (`PLACEHOLDER_PATTERNS`, whose union rebuilds the existing `PLACEHOLDER_RE`). `compose.js`'s `validateShaped` decides `ok` from `shapeGate` and only formats gap strings itself. `compose-record.js` gains a `--check <body-file>` mode reusing its exit-4 contract, and shaping-mode prose adds the section everywhere it lists sections, plus the pre-write check.

**Tech Stack:** Node 18+ CommonJS, `node --test` (built-in runner), markdown skill prose.

**Spec:** `.claude-tweaks/pipelines/2026-09-29T183057-spec-2827-2828/spec-2827/work/2827-spec.md` (record #2827)

Scope keywords: validateShaped, PLACEHOLDER_MARKERS, five spec-shaped sections, six sections

## Global Constraints

- `shapeGate(body)`'s return value must be byte-identical to today's for every input — `/flow`'s Materialization gate is not changed by this record.
- `validateShaped`'s `{ ok, gaps }` shape and its gap strings stay exactly `missing section: ## {name}` / `empty section: ## {name}` / `unresolved placeholder marker: {marker}`.
- `--check`'s failure stderr is exactly the `--require-shaped` format: `compose-record.js: body is not spec-shaped:\n` + one `  - {gap}` line per gap + `\n`.
- `compose.js` keeps exporting `REQUIRED_SECTIONS` (plain names, no `## ` prefix) and `PLACEHOLDER_MARKERS` (the three marker strings) — imported, never locally declared.
- Never type a literal placeholder marker in authored skill prose outside backticks; in skill prose, refer to "an unresolved marker".
- Project maturity is `established`: for any task modifying pre-existing behavior, write a full characterization test covering edge cases before changing it.
- Commit style: `{Verb} {what} — {detail}` (imperative, no conventional-commit prefix), each commit ending with the line `Claude-Session: https://claude.ai/code/session_01DMuab2XkEUVKUYMn3Yigpm`; reference `refs #2827`, never `closes`.
- Every `git`/`node --test` command runs from the worktree root `/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude/worktrees/design-2786-release-note-remediation` (verify with `git rev-parse --show-toplevel`).

## Review Focus

- A body whose only Release Note heading is `### Release Note` — `validateShaped` and `shapeGate` must return the same `ok` (today they disagree). Pinned in Task 1.
- A marker embedded inside a longer word (`TODOS`, `TBDs`) — now passes both checkers (the gate's word-bounded regex); this is the one intended behavior change for `--require-shaped` callers. Pinned in Task 1.
- `--check` on an empty body file — exit 4 naming all four missing sections, not exit 2. `--check` on a nonexistent file — exit 2. Pinned in Task 2.
- `--check` combined with `--require-shaped`, `--out`, or a positional payload — exit 2 with a usage error, nothing read or written. Pinned in Task 2.
- A future edit re-deleting `## Release Note` from either shaping-mode template fence — the conformance test fails. Pinned in Task 3.

---

### Task 1: One structural checker — `validateShaped` delegates to `shapeGate`

**Files:**
- Modify: `plugin/bin/lib/issues/materialize-format.js:9-10` (placeholder constants) and `:175-177` (exports)
- Modify: `plugin/bin/lib/compose-record/compose.js` (whole `validateShaped` + constants + requires)
- Modify: `docs/plugin-structure.md:39` (module-map description)
- Test: `tests/bin-lib/compose-record/compose.test.js`
- Test (must pass unchanged): `tests/bin-lib/issues/materialize-format.test.js`

**Interfaces:**
- Consumes: `shapeGate(body) -> { ok, missing: string[] }`, `sectionText(body, name) -> string|null`, `stripCodeSpans(text) -> string` from `materialize-format.js` (all existing).
- Produces: `materialize-format.js` exports `PLACEHOLDER_PATTERNS: Array<{ marker: string, re: RegExp }>` (order: `TBD`, `TODO`, `<!-- ambiguity:`). `compose.js`'s `validateShaped(body) -> { ok: boolean, gaps: string[] }` (unchanged signature), `REQUIRED_SECTIONS: string[]` (plain names), `PLACEHOLDER_MARKERS: string[]`.

- [ ] **Step 1: Write characterization tests pinning today's gap format and order (must pass before AND after)**

Append to `tests/bin-lib/compose-record/compose.test.js`:

```js
test('validateShaped characterization: exact gaps, in order, for a multi-gap body', () => {
  const body = '## Deliverables\n\nTBD\n\n## Release Note\n\n   \n\n## Gotchas\n\nTODO and <!-- ambiguity: x -->';
  assert.deepEqual(validateShaped(body), {
    ok: false,
    gaps: [
      'missing section: ## Current State',
      'missing section: ## Acceptance Criteria',
      'empty section: ## Release Note',
      'unresolved placeholder marker: TBD',
      'unresolved placeholder marker: TODO',
      'unresolved placeholder marker: <!-- ambiguity:',
    ],
  });
});

test('validateShaped characterization: empty body names all four sections missing', () => {
  assert.deepEqual(validateShaped(''), {
    ok: false,
    gaps: [
      'missing section: ## Current State',
      'missing section: ## Deliverables',
      'missing section: ## Acceptance Criteria',
      'missing section: ## Release Note',
    ],
  });
});
```

- [ ] **Step 2: Run them — expect PASS on the current code (characterization)**

Run: `node --test tests/bin-lib/compose-record/compose.test.js`
Expected: PASS (all tests, including the two new ones).

- [ ] **Step 3: Write the failing parity + intended-change tests**

Append to `tests/bin-lib/compose-record/compose.test.js` (add `const { shapeGate, PLACEHOLDER_PATTERNS } = require('../../../plugin/bin/lib/issues/materialize-format');` near the top requires):

```js
test('validateShaped agrees with shapeGate on a ### Release Note subheading (one checker, #2827)', () => {
  const body = SHAPED.replace('## Release Note', '### Release Note');
  assert.equal(validateShaped(body).ok, shapeGate(body).ok);
});

test('validateShaped: a marker embedded in a longer word passes, as the gate\'s word-bounded regex does (#2827 intended change)', () => {
  const body = SHAPED.replace('- [ ] Do the thing.', '- [ ] Close the TODOS list and the TBDs.');
  assert.deepEqual(validateShaped(body), { ok: true, gaps: [] });
  assert.equal(shapeGate(body).ok, true);
});

test('validateShaped: one gap per distinct placeholder marker, fixture built from PLACEHOLDER_PATTERNS', () => {
  const [a, b] = PLACEHOLDER_PATTERNS.map((p) => p.marker);
  const body = SHAPED.replace('- [ ] Do the thing.', `- [ ] first ${a} then ${b} here`);
  assert.deepEqual(validateShaped(body).gaps, [
    `unresolved placeholder marker: ${a}`,
    `unresolved placeholder marker: ${b}`,
  ]);
  assert.deepEqual(shapeGate(body), { ok: false, missing: ['unresolved-placeholder'] });
});

test('PLACEHOLDER_PATTERNS union equals the gate\'s existing combined regex', () => {
  assert.equal(
    PLACEHOLDER_PATTERNS.map((p) => p.re.source).join('|'),
    '\\bTBD\\b|\\bTODO\\b|<!--\\s*ambiguity:',
  );
});

test('compose.js declares no section or placeholder list of its own (#2827)', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '../../../plugin/bin/lib/compose-record/compose.js'), 'utf8');
  assert.doesNotMatch(src, /REQUIRED_SECTIONS\s*=/);
  assert.doesNotMatch(src, /PLACEHOLDER_MARKERS\s*=/);
});

test('compose.js still exports REQUIRED_SECTIONS / PLACEHOLDER_MARKERS with their historical values', () => {
  const m = require('../../../plugin/bin/lib/compose-record/compose');
  assert.deepEqual(m.REQUIRED_SECTIONS, ['Current State', 'Deliverables', 'Acceptance Criteria', 'Release Note']);
  assert.deepEqual(m.PLACEHOLDER_MARKERS, ['TBD', 'TODO', '<!-- ambiguity:']);
});
```

- [ ] **Step 4: Run them to verify they fail**

Run: `node --test tests/bin-lib/compose-record/compose.test.js`
Expected: FAIL — `PLACEHOLDER_PATTERNS` is undefined (TypeError on `.map`), the `### Release Note` parity test fails (`validateShaped` false vs `shapeGate` true), the embedded-word test fails (`includes('TODO')` matches `TODOS`), and the no-local-declaration test fails. The historical-exports test passes already (it pins values that must not change).

- [ ] **Step 5: Implement — `materialize-format.js`**

Replace lines 9-10:

```js
const REQUIRED_SECTIONS = ['## Current State', '## Deliverables', '## Acceptance Criteria', '## Release Note'];
const PLACEHOLDER_RE = /\bTBD\b|\bTODO\b|<!--\s*ambiguity:/;
```

with:

```js
const REQUIRED_SECTIONS = ['## Current State', '## Deliverables', '## Acceptance Criteria', '## Release Note'];
// One entry per placeholder marker; the gate's combined regex is their union, so
// compose.js can name which marker matched without a second implementation (#2827).
const PLACEHOLDER_PATTERNS = [
  { marker: 'TBD', re: /\bTBD\b/ },
  { marker: 'TODO', re: /\bTODO\b/ },
  { marker: '<!-- ambiguity:', re: /<!--\s*ambiguity:/ },
];
const PLACEHOLDER_RE = new RegExp(PLACEHOLDER_PATTERNS.map((p) => p.re.source).join('|'));
```

and extend the exports:

```js
module.exports = {
  REQUIRED_SECTIONS, PLACEHOLDER_PATTERNS, sectionText, shapeGate, liftMetadata, composeHeader, composeFile, stripCodeSpans,
};
```

- [ ] **Step 6: Implement — `compose.js`**

Replace the header comment's last two lines, the `stripCodeSpans` require, both constant declarations, `ORIGINAL_REQUEST_RE`, and `validateShaped` so the file reads (keep `splitSections` and `composeBody` exactly as they are):

```js
// Composition + spec-shaped-body validation for bin/compose-record.js. Reuses the existing
// recordPayload composer (bin/lib/issues/record.js) for body assembly (fingerprint marker,
// Defer-reason prefix, label derivation) and adds _shared/work-record.md's spec-shaped-body
// structural check — decided by the Materialization gate's own shapeGate (one checker, #2827);
// this file only formats the gap strings.
'use strict';

const { recordPayload } = require('../issues/record');
const {
  REQUIRED_SECTIONS: GATE_SECTIONS, PLACEHOLDER_PATTERNS, sectionText, shapeGate, stripCodeSpans,
} = require('../issues/materialize-format');

// Derived from the gate's own lists — never a locally declared copy (#2827). Exported under
// the historical names REQUIRED_SECTIONS / PLACEHOLDER_MARKERS.
const SECTION_NAMES = GATE_SECTIONS.map((h) => h.replace(/^## /, ''));
const MARKER_NAMES = PLACEHOLDER_PATTERNS.map((p) => p.marker);

// Same exemption boundary shapeGate applies (#1240): markers inside the verbatim
// ## Original request copy are the original capture's own text.
const ORIGINAL_REQUEST_RE = /^## Original request[ \t]*$/m;
```

(`splitSections` unchanged here.)

```js
// body -> { ok, gaps: string[] } — ok is shapeGate's verdict; gaps names every failing check at
// once (never just the first), in REQUIRED_SECTIONS order then marker order.
function validateShaped(body) {
  const text = String(body || '');
  const gate = shapeGate(text);
  if (gate.ok) return { ok: true, gaps: [] };
  const gaps = [];
  for (const name of SECTION_NAMES) {
    if (!gate.missing.includes(name)) continue;
    gaps.push(sectionText(text, name) === null ? `missing section: ## ${name}` : `empty section: ## ${name}`);
  }
  if (gate.missing.includes('unresolved-placeholder')) {
    const at = text.search(ORIGINAL_REQUEST_RE);
    const authored = stripCodeSpans(at === -1 ? text : text.slice(0, at));
    for (const { marker, re } of PLACEHOLDER_PATTERNS) {
      if (re.test(authored)) gaps.push(`unresolved placeholder marker: ${marker}`);
    }
  }
  return { ok: false, gaps };
}
```

`module.exports` becomes `{ composeBody, validateShaped, splitSections, REQUIRED_SECTIONS: SECTION_NAMES, PLACEHOLDER_MARKERS: MARKER_NAMES }` — the same exported names and values as before.

- [ ] **Step 6b: Update the module map (added by plan audit Check B)**

`docs/plugin-structure.md:39` — replace `+ validateShaped (reusable implementation of _shared/work-record.md's spec-shaped-body structural check: four sections present and non-empty — Current State, Deliverables, Acceptance Criteria, Release Note (#2580) — no TBD/TODO/<!-- ambiguity: marker anywhere)` with `+ validateShaped (_shared/work-record.md's spec-shaped-body structural check, decided by materialize-format.js's shapeGate — one checker (#2827) — and formatted as per-section / per-marker gap strings: four sections present and non-empty — Current State, Deliverables, Acceptance Criteria, Release Note (#2580) — no unresolved placeholder marker outside ## Original request or code spans)`. Leave the rest of the line unchanged.

- [ ] **Step 7: Run the compose, CLI, and materialize-format suites**

Run: `node --test tests/bin-lib/compose-record/compose.test.js tests/bin-lib/compose-record/cli.test.js tests/bin-lib/issues/materialize-format.test.js`
Expected: PASS — every pre-existing test unchanged, plus all Task 1 tests.

- [ ] **Step 8: Commit**

```bash
git add plugin/bin/lib/issues/materialize-format.js plugin/bin/lib/compose-record/compose.js tests/bin-lib/compose-record/compose.test.js docs/plugin-structure.md
git commit -m "Make validateShaped delegate to the gate's shapeGate — one structural checker, per-marker naming via PLACEHOLDER_PATTERNS (refs #2827)" -m "Claude-Session: https://claude.ai/code/session_01DMuab2XkEUVKUYMn3Yigpm"
```

---

### Task 2: `compose-record.js --check <body-file>`

**Files:**
- Modify: `plugin/bin/compose-record.js` (header comment lines 2-8, `USAGE`, `parseArgs`, `run`)
- Modify: `docs/plugin-structure.md:152` (CLI reference)
- Test: `tests/bin-lib/compose-record/cli.test.js`

**Interfaces:**
- Consumes: `validateShaped(body) -> { ok, gaps }` (Task 1).
- Produces: CLI `node plugin/bin/compose-record.js --check <body-file>` — exit 0 (conforming, no output), 4 (gaps on stderr in the `--require-shaped` format), 2 (usage error: missing/unreadable file, or combined with a positional payload, `--out`, or `--require-shaped`). `parseArgs` returns `check: string|null`. #2828's `/tidy` repair and shaping mode (Task 3) call exactly this.

- [ ] **Step 1: Write the failing tests**

Append to `tests/bin-lib/compose-record/cli.test.js`:

```js
const SHAPED_BODY = SHAPED_PAYLOAD.body;

test('--check: a conforming body exits 0 with no output', () => {
  const dir = tmpDir();
  const bodyFile = path.join(dir, 'body.md');
  fs.writeFileSync(bodyFile, SHAPED_BODY);
  const out = [];
  assert.equal(run(['--check', bodyFile], deps(out)), 0);
  assert.equal(out.length, 0);
});

test('--check: a body missing its Release Note exits 4 with the exact --require-shaped stderr', () => {
  const dir = tmpDir();
  const bodyFile = path.join(dir, 'body.md');
  fs.writeFileSync(bodyFile, SHAPED_BODY.replace('\n\n## Release Note\n\nDid the thing.', ''));
  const out = [];
  assert.equal(run(['--check', bodyFile], deps(out)), 4);
  assert.equal(streamOf(out, 'err'), 'compose-record.js: body is not spec-shaped:\n  - missing section: ## Release Note\n');
  assert.equal(streamOf(out, 'out'), '');
});

test('--check: an empty body file exits 4 naming all four sections', () => {
  const dir = tmpDir();
  const bodyFile = path.join(dir, 'empty.md');
  fs.writeFileSync(bodyFile, '');
  const out = [];
  assert.equal(run(['--check', bodyFile], deps(out)), 4);
  const err = streamOf(out, 'err');
  for (const s of ['Current State', 'Deliverables', 'Acceptance Criteria', 'Release Note']) {
    assert.match(err, new RegExp(`  - missing section: ## ${s}\\n`));
  }
});

test('--check: misuse exits 2', () => {
  const dir = tmpDir();
  const bodyFile = path.join(dir, 'body.md');
  fs.writeFileSync(bodyFile, SHAPED_BODY);
  const payloadFile = path.join(dir, 'payload.json');
  fs.writeFileSync(payloadFile, JSON.stringify(SHAPED_PAYLOAD));
  assert.equal(run(['--check'], deps([])), 2, '--check with no file');
  assert.equal(run(['--check', path.join(dir, 'missing.md')], deps([])), 2, 'unreadable body file');
  assert.equal(run(['--check', bodyFile, '--out', path.join(dir, 'o.md')], deps([])), 2, 'with --out');
  assert.equal(run(['--check', bodyFile, '--require-shaped'], deps([])), 2, 'with --require-shaped');
  assert.equal(run([payloadFile, '--check', bodyFile], deps([])), 2, 'with a positional payload');
  assert.equal(fs.existsSync(path.join(dir, 'o.md')), false, 'nothing written on misuse');
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/bin-lib/compose-record/cli.test.js`
Expected: FAIL — `--check` is rejected as `unknown argument: --check` (exit 2), so the exit-0 and exit-4 tests fail.

- [ ] **Step 3: Implement**

Header comment lines 2-8 become:

```js
// bin/compose-record.js — compose + validate a work-record body from a JSON payload file,
// or validate an already-composed body file.
//   node bin/compose-record.js <payload-file> --out <body-file> [--require-shaped] [--help]
//   node bin/compose-record.js --check <body-file>
// Exit 0 = composed and written (prints {title,type,labels,out} JSON to stdout), or --check passed (no output);
// 2 = malformed invocation (bad args, missing/unreadable/unparsable payload or body file, missing --out,
//     or --check combined with a payload, --out, or --require-shaped);
// 3 = payload validation error (recordPayload rejected a field — see stderr);
// 4 = shape validation failed (--require-shaped or --check — gaps on stderr, one per line);
// 5 = could not write --out.
```

`USAGE`:

```js
const USAGE = 'usage: compose-record.js <payload-file> --out <body-file> [--require-shaped] [--help]\n'
  + '       compose-record.js --check <body-file>\n';
```

`parseArgs` — add `check: null` to the initial object and one branch (a missing value leaves `check` as `''`, caught in `run`):

```js
    else if (a === '--check') o.check = next() ?? '';
```

`run` — factor the stderr line into one helper used by both paths, and branch on `--check` right after the help check:

```js
const shapeGapsMessage = (gaps) => `compose-record.js: body is not spec-shaped:\n${gaps.map((g) => `  - ${g}`).join('\n')}\n`;
```

```js
  if (o.check !== null) {
    if (!o.check) return usageError('--check <body-file> is required');
    if (o.payloadFile || o.out || o.requireShaped) return usageError('--check cannot be combined with a payload file, --out, or --require-shaped');
    let body;
    try { body = fs.readFileSync(o.check, 'utf8'); } catch (err) {
      return usageError(`could not read body file: ${o.check} (${err && err.message})`);
    }
    const shaped = validateShaped(body);
    if (!shaped.ok) { deps.stderr(shapeGapsMessage(shaped.gaps)); return 4; }
    return 0;
  }
```

and the existing `--require-shaped` branch uses `deps.stderr(shapeGapsMessage(shaped.gaps));`.

- [ ] **Step 4: Run to verify they pass**

Run: `node --test tests/bin-lib/compose-record/cli.test.js tests/bin-lib/compose-record/compose.test.js`
Expected: PASS (all pre-existing CLI tests unchanged, including `--require-shaped: fails (exit 4)` and `malformed invocations exit 2`).

- [ ] **Step 4b: Update the CLI reference (added by plan audit Check B)**

`docs/plugin-structure.md:152` — directly below the existing `node plugin/bin/compose-record.js <payload-file> --out …` line, add one line in the same format:

```
node plugin/bin/compose-record.js --check <body-file>   # Validate an already-composed body against _shared/work-record.md's spec-shaped-body check (the Materialization gate's shapeGate, #2827) — used by /specify shaping mode before its write and by /tidy's Release-Note repair; exit 0 conforming (no output), 2 malformed invocation (missing/unreadable body file, or combined with a payload, --out, or --require-shaped), 4 not spec-shaped (gaps on stderr in the --require-shaped format)
```

and on the existing line, change `4 shape validation failed (--require-shaped only)` to `4 shape validation failed (--require-shaped or --check)`.

- [ ] **Step 5: Real-input probe (record the numbers in the task report)**

Run: `node -e "const {execFileSync}=require('child_process');const fs=require('fs');const os=require('os');const p=require('path');const {shapeGate}=require('./plugin/bin/lib/issues/materialize-format');const rs=JSON.parse(execFileSync('gh',['issue','list','--state','open','--label','ready','--limit','500','--json','number,body'],{encoding:'utf8',maxBuffer:1<<28}));const d=fs.mkdtempSync(p.join(os.tmpdir(),'chk-'));let cli=0,gate=0,rn=0;for(const r of rs){const f=p.join(d,r.number+'.md');fs.writeFileSync(f,r.body);let c=0;try{execFileSync('node',['plugin/bin/compose-record.js','--check',f],{stdio:'pipe'})}catch(e){c=e.status}if(c===0)cli++;if(shapeGate(r.body).ok)gate++;if(!/^##\s*Release Note/mi.test(r.body))rn++;}console.log(JSON.stringify({total:rs.length,cliPass:cli,gatePass:gate,missingReleaseNoteRegex:rn}))"`
Expected: `cliPass === gatePass` (the CLI and the gate agree on every real body); `missingReleaseNoteRegex` is the independent count (2026-09-29 snapshot: 110 of 126). Record the printed JSON.

- [ ] **Step 6: Commit**

```bash
git add plugin/bin/compose-record.js tests/bin-lib/compose-record/cli.test.js docs/plugin-structure.md
git commit -m "Add compose-record.js --check <body-file> — validate an existing body with the gate's checker, exit-4 contract reused (refs #2827)" -m "Claude-Session: https://claude.ai/code/session_01DMuab2XkEUVKUYMn3Yigpm"
```

---

### Task 3: Shaping mode emits `## Release Note` and checks before writing

**Files:**
- Modify: `plugin/skills/specify/shaping-mode.md:16` ("own five sections"), `:40-67` (template), `:69` (core-sections sentence)
- Modify: `plugin/skills/specify/shaping-mode-stamping.md:130-160` (assembly fence + new pre-write check paragraph), `:214` (read-back list), `:235` and `:241` (`failed` wording)
- Modify: `tests/specify-range-form-readback.test.js:60` (pinned token)
- Create: `tests/specify-shaping-template-required-sections.test.js`

**Interfaces:**
- Consumes: CLI `compose-record.js --check <body-file>` (Task 2); `REQUIRED_SECTIONS` from `plugin/bin/lib/issues/materialize-format.js`.
- Produces: prose contract #2828 relies on — shaping mode never writes a body that fails `--check`.

- [ ] **Step 1: Write the failing conformance test**

Create `tests/specify-shaping-template-required-sections.test.js`:

```js
'use strict';
// #2827: shaping mode's literal body templates must carry every section the
// Materialization gate requires — the template omitting ## Release Note is how
// 110 of 126 ready records came to fail the gate (2026-09-29).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { REQUIRED_SECTIONS } = require('../plugin/bin/lib/issues/materialize-format');

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');

// The first ``` fenced block after an anchor phrase, as an array of lines.
function fenceAfter(src, anchor) {
  const at = src.indexOf(anchor);
  assert.ok(at >= 0, `anchor not found: ${anchor}`);
  const open = src.indexOf('\n```', at);
  const close = src.indexOf('\n```', open + 4);
  assert.ok(open >= 0 && close > open, `no fenced block after: ${anchor}`);
  return src.slice(open + 4, close).split('\n').map((l) => l.trim());
}

for (const [file, anchor] of [
  ['plugin/skills/specify/shaping-mode.md', 'in this literal shape'],
  ['plugin/skills/specify/shaping-mode-stamping.md', 'Final assembly order'],
]) {
  test(`${path.basename(file)} template carries every gate-required section`, () => {
    const lines = fenceAfter(read(file), anchor);
    for (const heading of REQUIRED_SECTIONS) {
      assert.ok(lines.some((l) => l === heading || l.startsWith(`${heading} `)), `${file} template is missing ${heading}`);
    }
  });
}

test('shaping-mode-stamping.md runs compose-record.js --check before the write', () => {
  const src = read('plugin/skills/specify/shaping-mode-stamping.md');
  const checkAt = src.indexOf('compose-record.js" --check');
  const writeAt = src.indexOf('gh issue edit {n} \\');
  assert.ok(checkAt >= 0, 'pre-write --check call missing');
  assert.ok(checkAt < writeAt, 'the --check call must come before the gh issue edit write');
  assert.ok(src.includes('pre-write shape check failed:'), 'failed-row Detail wording missing');
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/specify-shaping-template-required-sections.test.js`
Expected: FAIL — both template tests report `missing ## Release Note`; the `--check` ordering test reports `pre-write --check call missing`.

- [ ] **Step 3: Edit `shaping-mode.md`**

Line 16 — replace `own five sections + \`## Original request\`` with `own six sections + \`## Original request\``.

Line 40 — replace `Rewrite the record's body into six sections, in this literal shape` with `Rewrite the record's body into seven sections, in this literal shape`.

In the template fence, between the `## Acceptance Criteria` block and `## Technical Approach`, insert:

```
## Release Note

{one plain-language, verb-first line — spec-template.md's Release Note guidance}

```

(so the fence reads `## Acceptance Criteria` / `{...}` / blank / `## Release Note` / the line / blank / `## Technical Approach`).

Line 69 — replace its opening ``` `## Current State`, `## Deliverables`, `## Acceptance Criteria`, `## Technical Approach`, and `## Gotchas` are the core ``` with ``` `## Current State`, `## Deliverables`, `## Acceptance Criteria`, `## Release Note`, `## Technical Approach`, and `## Gotchas` are the core ``` (rest of the paragraph unchanged).

- [ ] **Step 4: Edit `shaping-mode-stamping.md`**

In the Compose-then-write-once fence, after the `## Acceptance Criteria` / `...` pair, insert `## Release Note` / `...` (same two-line shape as its neighbours).

Immediately after that fence's closing ```` ``` ```` (before the `**\`work-backend: github-issues\`:**` paragraph), insert:

````markdown
**Pre-write shape check (#2827), both drivers.** Write the assembled body to this run's session-scoped temp file — the same `specify-shaped-body.md` path the `github-issues` write below uses (`_shared/session-tmp-root.md`) — then validate it with the Materialization gate's own checker before any write call:

```bash
SPECIFY_SHAPED_BODY=$(node -e "
  const { sessionTmpPath } = require('${CLAUDE_PLUGIN_ROOT}/bin/lib/session-tmp.js');
  console.log(sessionTmpPath(process.env.CLAUDE_CODE_SESSION_ID, 'specify-shaped-body.md') || require('path').join(require('os').tmpdir(), 'specify-shaped-body.md'))
")
node "${CLAUDE_PLUGIN_ROOT}/bin/compose-record.js" --check "$SPECIFY_SHAPED_BODY"
```

Exit 0 → proceed to the write below. Exit 4 → write nothing and stamp no labels: this record's Actions Performed row renders as `failed` with the Detail `pre-write shape check failed:` followed by the gap lines from stderr, and a batch continues with the next record. Under `--chained` that `failed` row is the returned output; under bare drain it is the attempt's reported outcome — never a silent skip. Any other exit is the same `failed` row naming the exit code.
````

Line 214 — replace ``- The five spec-shaped sections (`## Current State`, `## Deliverables`, `## Acceptance Criteria`, `## Technical Approach`, `## Gotchas`) plus `## Original request` are all present in the re-fetched body.`` with ``- The six spec-shaped sections (`## Current State`, `## Deliverables`, `## Acceptance Criteria`, `## Release Note`, `## Technical Approach`, `## Gotchas`) plus `## Original request` are all present in the re-fetched body.``

Line 235 — replace `(a record whose write failed, or whose read-back verification (above) failed, renders` with `(a record whose pre-write shape check refused the body, whose write failed, or whose read-back verification (above) failed, renders`.

Line 241 — replace `` or `failed` (either the write call itself failed, or the read-back verification (above) failed — the Detail cell's own text names which one) `` with `` or `failed` (the pre-write shape check (Compose-then-write-once) refused the composed body, the write call itself failed, or the read-back verification (above) failed — the Detail cell's own text names which one) ``.

- [ ] **Step 5: Update the pinned token**

`tests/specify-range-form-readback.test.js:60` — replace `'five spec-shaped sections'` with `'six spec-shaped sections'`.

- [ ] **Step 6: Run the targeted suites**

Run: `node --test tests/specify-shaping-template-required-sections.test.js tests/specify-range-form-readback.test.js tests/ceremony-framing-per-record-conformance.test.js tests/shaping-mode-needs-removal.test.js tests/bin-lib/skill-audit/context-cost.test.js`
Expected: PASS.

- [ ] **Step 7: Renumbering-completeness sweep (three forms)**

Run: `git grep -n -i -E "five (spec-shaped )?sections|six sections|\b(four|five) sections" -- plugin/skills/specify tests`
Expected: no hit that still describes the shaped-body section set with the old count (the `terminal-track` "six sections" hit is unrelated).
Run: `git grep -n "## Acceptance Criteria\`, \`## Technical Approach\`" -- plugin/skills/specify`
Expected: no output (every enumeration now lists Release Note between them).
Run: `git grep -n -E "\bTBD\b|\bTODO\b" -- plugin/skills/specify/shaping-mode.md plugin/skills/specify/shaping-mode-stamping.md`
Expected: every hit is inside backticks (pre-existing assertion-target mentions); none introduced by this task.

- [ ] **Step 8: Commit**

```bash
git add plugin/skills/specify/shaping-mode.md plugin/skills/specify/shaping-mode-stamping.md tests/specify-range-form-readback.test.js tests/specify-shaping-template-required-sections.test.js
git commit -m "Emit ## Release Note from shaping mode and gate the write on compose-record.js --check (refs #2827)" -m "Claude-Session: https://claude.ai/code/session_01DMuab2XkEUVKUYMn3Yigpm"
```
