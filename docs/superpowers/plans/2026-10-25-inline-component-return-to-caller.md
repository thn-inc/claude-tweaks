# Inline Component Return-to-Caller Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop inline component skills that end on a bare "Output ONLY these lines" render from ending the calling pipeline's turn, by adding an explicit return-to-caller line after every such render and stating the convention in `docs/skill-authoring.md`.

**Architecture:** One canonical sentence (`RETURN_LINE` below) is inserted verbatim, on its own line, immediately after the render fence in each inline-invoked mode file. `docs/skill-authoring.md`'s Component-skill contract bullet gains a sub-paragraph stating the convention and quoting the same sentence. One new `node --test` suite pins both, reading the live corpus (a convention enforced against every future addition, per `.claude/skills/skill-prose-conformance-tests/SKILL.md`'s Decision Framework row), with in-memory go-red controls.

**Tech Stack:** Markdown skill files; Node 18+ `node:test`.

**Spec:** `.claude-tweaks/pipelines/2026-10-25T220014-record-4117/work/4117-spec.md` (record #4117)

## Global Constraints

- The canonical line, byte-exact (copy from here, never retype):
  `**Return to caller:** this output is consumed by the calling skill — control returns to the caller, whose next step runs in this same turn; never end the turn on this render.`
- The line sits on its own line, alone in its paragraph (blank line before and after), immediately after the closing ```` ``` ```` of the render template block in each mode's `Step 3: Render` section.
- Read governed markdown in tests through `tests/helpers/read-skill.js`'s `readText()`, never a raw `fs.readFileSync` (`tests/raw-markdown-read-conformance.test.js` enforces this).
- Every go-red control runs the same predicate the positive test runs, against mutated input, and asserts it reports exactly the mutated item (plan-authoring-checks' Go-red control check).
- Commit messages: `{Verb} {what} — {detail}`, body carries `refs #4117` (never `closes`/`fixes`), ends with `Claude-Session: https://claude.ai/code/session_01H3QK8v6NvNwTTpvEh4rEEm`.
- Byte headroom vs `RAIL_BYTES` (52,500 B): ceremony-check.md 4,765 B, grant-check.md 11,578 B, merge-check.md 12,356 B, failure-check.md 3,757 B, challenge/SKILL.md 19,122 B — each grows by ~200 B; all stay far under the rail. `docs/skill-authoring.md` is not a governed `plugin/skills/` file.

## Review Focus

- A future skill file that adds an "Output ONLY" render without the line must go red — covered by the sweep test plus the temp-tree walker control (Task 1).
- The line placed *before* the render fence (or in another section) must not satisfy the roster check — covered by the permutation control (Task 1).
- A CRLF (Windows autocrlf) checkout must not make the sweep vacuous — covered by routing every read through `readText()`.
- Subagent-dispatch prompts saying "Return ONLY …, no preamble" (`dispatch/task-prompt.md`, `review/step3-lens-dispatch.md`, etc.) are a subagent's final reply, not an inline render — they are deliberately out of scope; the sweep keys on the exact literal `Output ONLY`, which none of them carry. `_shared/causal-depth.md`'s "Render, no preamble beyond what's above" is an in-context verdict inside the caller's own procedure (its `## Logging and routing` section continues), not a Skill-tool return — out of scope, noted for review.
- The doc convention and the skill files must quote the same sentence — covered by Task 2's test asserting the doc region contains `RETURN_LINE` itself.

---

### Task 1: Return-to-caller line in every inline mode render + conformance sweep

**Files:**
- Create: `tests/component-return-to-caller-conformance.test.js`
- Modify: `plugin/skills/assess-agent-autonomy/ceremony-check.md` (Step 3: Render, after the fence ending at the `RATIONALE:` line)
- Modify: `plugin/skills/assess-agent-autonomy/grant-check.md` (Step 3: Render, after the fence)
- Modify: `plugin/skills/assess-agent-autonomy/merge-check.md` (Step 3: Render, after the fence, before `## Anti-Patterns`)
- Modify: `plugin/skills/assess-agent-autonomy/failure-check.md` (Step 3: Render, after the fence, before "The caller (dispatch's Settle step)…")
- Modify: `plugin/skills/challenge/SKILL.md` (framing-check `### Step 3: Render`, after the fence, before "On `solution-baked`…")

**Interfaces:**
- Produces (module-local to the test, reused by Task 2): `RETURN_LINE` (string), `collapse(s)`, `walkMarkdown(root) -> Map<relPosixPath, text>`, `outputOnlyFiles(corpus) -> string[]` (sorted), `renderSection(text) -> string`, `placementOk(text) -> boolean`, `offenders(corpus) -> string[]` (sorted, deduped).

- [ ] **Step 1: Write the failing test** — create `tests/component-return-to-caller-conformance.test.js`:

```js
'use strict';
// tests/component-return-to-caller-conformance.test.js — pins #4117: an inline-invoked
// component mode that ends on a bare "Output ONLY these lines" render must say, right after
// the render template, that control returns to the caller and the caller's next step runs in
// the same turn. Without it a model rendered ceremony-check's verdict as its whole reply and
// ended /flow's Manifesto turn before config.yml was written.
// Reads the live corpus on purpose: this is a convention enforced against every future
// addition (skill-prose-conformance-tests' Decision Framework), never a frozen fixture.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { readText } = require('./helpers/read-skill');

const ROOT = path.join(__dirname, '..');
const SKILLS = path.join(ROOT, 'plugin', 'skills');

const RETURN_LINE = '**Return to caller:** this output is consumed by the calling skill — control returns to the caller, whose next step runs in this same turn; never end the turn on this render.';
const OUTPUT_ONLY = 'Output ONLY';
// Inline-invoked modes that end on a bare render, whether or not they say "Output ONLY".
const ROSTER = [
  'assess-agent-autonomy/ceremony-check.md',
  'assess-agent-autonomy/failure-check.md',
  'assess-agent-autonomy/grant-check.md',
  'assess-agent-autonomy/merge-check.md',
  'challenge/SKILL.md',
];

const collapse = (s) => s.replace(/\s+/g, ' ');

function walkMarkdown(root) {
  const corpus = new Map();
  const visit = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(abs);
      else if (entry.name.endsWith('.md')) {
        corpus.set(path.relative(root, abs).split(path.sep).join('/'), readText(abs));
      }
    }
  };
  visit(root);
  return corpus;
}

function outputOnlyFiles(corpus) {
  return [...corpus].filter(([, text]) => text.includes(OUTPUT_ONLY)).map(([rel]) => rel).sort();
}

const lacksLine = (text) => !collapse(text).includes(collapse(RETURN_LINE));

// The single `## Step 3: Render` / `### Step 3: Render` heading's section, up to the next
// heading of any level; the last section of a file runs to end of file (explicit fallback).
function renderSection(text) {
  const headings = [...text.matchAll(/^#{2,3} Step 3: Render[ \t]*$/gm)];
  if (headings.length !== 1) throw new Error(`expected exactly one Step 3: Render heading, found ${headings.length}`);
  const start = headings[0].index + headings[0][0].length;
  const rest = text.slice(start);
  const next = rest.search(/^#{1,6} /m);
  return next === -1 ? rest : rest.slice(0, next);
}

// The line must sit inside the render section, after the render template's closing fence.
function placementOk(text) {
  let section;
  try { section = renderSection(text); } catch { return false; }
  const open = section.indexOf('```');
  const close = open === -1 ? -1 : section.indexOf('```', open + 3);
  const line = section.indexOf(RETURN_LINE);
  return open !== -1 && close !== -1 && line !== -1 && line > close;
}

function offenders(corpus) {
  const bad = new Set(outputOnlyFiles(corpus).filter((rel) => lacksLine(corpus.get(rel))));
  for (const rel of ROSTER) {
    const text = corpus.get(rel);
    if (text === undefined || !placementOk(text)) bad.add(rel);
  }
  return [...bad].sort();
}

const CORPUS = walkMarkdown(SKILLS);

test('AC1.1: every plugin/skills/**/*.md containing "Output ONLY" carries the return-to-caller line', () => {
  const files = outputOnlyFiles(CORPUS);
  assert.ok(files.length >= 3, `sweep found only ${files.length} "Output ONLY" files — haystack is vacuous`);
  for (const rel of ['assess-agent-autonomy/ceremony-check.md', 'assess-agent-autonomy/grant-check.md', 'challenge/SKILL.md']) {
    assert.ok(files.includes(rel), `expected ${rel} in the "Output ONLY" sweep`);
  }
  assert.deepEqual(files.filter((rel) => lacksLine(CORPUS.get(rel))), []);
});

test('roster: each inline mode carries the line in its Step 3 Render section, after the render fence', () => {
  assert.deepEqual(offenders(CORPUS), []);
});

test('AC1.1 go-red: removing the line from any one file reports exactly that file', () => {
  const targets = [...new Set([...outputOnlyFiles(CORPUS), ...ROSTER])].sort();
  assert.ok(targets.length >= ROSTER.length);
  for (const rel of targets) {
    const original = CORPUS.get(rel);
    const mutated = original.replace(RETURN_LINE, '');
    assert.notEqual(mutated, original, `${rel}: the strip matched nothing`);
    const corpus = new Map(CORPUS).set(rel, mutated);
    assert.deepEqual(offenders(corpus), [rel], `${rel}: removal must be reported as exactly this file`);
  }
});

test('placement go-red: the line moved above the render fence is rejected', () => {
  const rel = 'assess-agent-autonomy/ceremony-check.md';
  const original = CORPUS.get(rel);
  assert.equal(placementOk(original), true);
  const heading = original.match(/^#{2,3} Step 3: Render[ \t]*$/m)[0];
  const permuted = original.replace(`\n${RETURN_LINE}\n`, '\n').replace(heading, `${heading}\n\n${RETURN_LINE}\n`);
  assert.notEqual(permuted, original);
  assert.equal(placementOk(permuted), false);
  assert.deepEqual(offenders(new Map(CORPUS).set(rel, permuted)), [rel]);
});

test('walker go-red: a nested "Output ONLY" file without the line is found and reported', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-return-to-caller-'));
  try {
    fs.mkdirSync(path.join(dir, 'a', 'b'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'a', 'b', 'mode.md'), '## Step 3: Render\n\nOutput ONLY these lines, no preamble:\n\n```\nX: y\n```\n');
    fs.writeFileSync(path.join(dir, 'a', 'ok.md'), `Output ONLY these lines:\n\n\`\`\`\nX: y\n\`\`\`\n\n${RETURN_LINE}\n`);
    const corpus = walkMarkdown(dir);
    assert.deepEqual(outputOnlyFiles(corpus), ['a/b/mode.md', 'a/ok.md']);
    assert.deepEqual(outputOnlyFiles(corpus).filter((rel) => lacksLine(corpus.get(rel))), ['a/b/mode.md']);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

module.exports = { RETURN_LINE, collapse };
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/component-return-to-caller-conformance.test.js`
Expected: FAIL — the AC1.1 sweep, roster, and go-red tests fail (no file carries `RETURN_LINE` yet); the walker test passes.

- [ ] **Step 3: Insert `RETURN_LINE` in the five mode files**

In each of the five files listed under **Files**, insert a blank line plus the byte-exact `RETURN_LINE` (Global Constraints) immediately after the closing fence of the `Step 3: Render` template block, so it is its own paragraph and every paragraph that previously followed the fence still follows it. Touch nothing else in those files.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/component-return-to-caller-conformance.test.js`
Expected: PASS (5 tests). Also run `node --test tests/untrusted-record-content-conformance.test.js tests/assess-agent-autonomy-transport-pin.test.js tests/specify-next-mode.test.js tests/backlog-grant-lane-decision.test.js` (suites that pin these render sections) — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tests/component-return-to-caller-conformance.test.js plugin/skills/assess-agent-autonomy/ceremony-check.md plugin/skills/assess-agent-autonomy/grant-check.md plugin/skills/assess-agent-autonomy/merge-check.md plugin/skills/assess-agent-autonomy/failure-check.md plugin/skills/challenge/SKILL.md
git commit -m "Add return-to-caller line after inline component renders — assess-agent-autonomy modes and challenge framing-check (refs #4117)"
```

### Task 2: State the convention in `docs/skill-authoring.md` and pin it

**Files:**
- Modify: `docs/skill-authoring.md:113-124` (the `- **Component-skill contract**` bullet — append a sub-paragraph after its Canonical CSC template fence, before `- **Next Actions placement**`)
- Modify: `tests/component-return-to-caller-conformance.test.js` (append two tests)

**Interfaces:**
- Consumes: `RETURN_LINE`, `collapse` from Task 1 (same file).
- Produces: `missingDocFacts(text) -> string[]`.

- [ ] **Step 1: Write the failing tests** — append to the test file (above `module.exports`):

```js
const DOC = readText(path.join(ROOT, 'docs', 'skill-authoring.md'));
const DOC_FACTS = {
  heading: '**Return to caller after a bare render.**',
  line: RETURN_LINE,
  placement: 'immediately after the render template',
};

function componentContractRegion(text) {
  const start = text.indexOf('- **Component-skill contract**');
  const end = text.indexOf('- **Next Actions placement**');
  if (start === -1 || end === -1 || end < start) throw new Error('Component-skill contract bullet anchors not found');
  return text.slice(start, end);
}

function missingDocFacts(text) {
  const region = collapse(componentContractRegion(text));
  return Object.entries(DOC_FACTS).filter(([, needle]) => !region.includes(collapse(needle))).map(([name]) => name);
}

test('AC2.1: docs/skill-authoring.md Component-skill contract states the return-to-caller convention', () => {
  assert.deepEqual(missingDocFacts(DOC), []);
});

test('AC2.1 go-red: stripping any one convention fact reports exactly that fact', () => {
  const region = componentContractRegion(DOC);
  for (const [name, needle] of Object.entries(DOC_FACTS)) {
    const strippedRegion = region.replace(needle, '');
    assert.notEqual(strippedRegion, region, `${name}: the strip matched nothing`);
    assert.deepEqual(missingDocFacts(DOC.replace(region, () => strippedRegion)), [name]);
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/component-return-to-caller-conformance.test.js`
Expected: FAIL — the two AC2.1 tests fail (`missingDocFacts` returns `['heading', 'line', 'placement']`; the go-red strip matches nothing).

- [ ] **Step 3: Add the convention paragraph to `docs/skill-authoring.md`**

Insert, as an indented (two-space) continuation paragraph of the `- **Component-skill contract**` bullet, after the closing fence of its Canonical CSC template and before `- **Next Actions placement**`, a paragraph that starts with `**Return to caller after a bare render.**` and says: a component skill or mode whose last step is a bare render — an "Output ONLY these lines" block or any other verdict block its caller parses (`assess-agent-autonomy`'s four mode files, `challenge`'s framing-check) — must state that control returns to the caller, on its own line immediately after the render template, in exactly this wording; then a two-space-indented ```` ```markdown ```` fence holding `RETURN_LINE` byte-exact; then one sentence of why: omitting `## Next Actions` tells the model what not to render, not that the caller's procedure continues, so a model that renders the verdict as its whole reply ends the caller's turn mid-procedure (#4117: `/flow`'s Manifesto stopped after `ceremony-check #4041` before writing `config.yml`); then a final sentence naming `tests/component-return-to-caller-conformance.test.js` as the pin over every `plugin/skills/**/*.md` file containing "Output ONLY". The phrase `immediately after the render template` must appear verbatim.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/component-return-to-caller-conformance.test.js`
Expected: PASS (7 tests). Also run every suite that reads `docs/skill-authoring.md`: `node --test tests/next-actions-premise.test.js tests/bin-lib/skill-audit/house-structure.test.js tests/claude-md-budget.test.js tests/argument-hint-mirrors.test.js` — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add docs/skill-authoring.md tests/component-return-to-caller-conformance.test.js
git commit -m "Document return-to-caller convention in skill-authoring Component-skill contract — pinned by conformance suite (refs #4117)"
```

### Verification (folded into /build Common Step 5)

Waived AC3.1: `npm test` passing is verified by `/claude-tweaks:build` Common Step 5's full-suite verification run, not by a task test step.
