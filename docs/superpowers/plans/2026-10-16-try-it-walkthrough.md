# Try It Walkthrough Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every finished feature run ends with a human "Try it" walkthrough (where to go, what to do, what to expect) that the Pipeline Summary, the PR, the Verification Brief and `/claude-tweaks:demo` all show identically, independent of the oversight floor.

**Architecture:** One new shared contract, `plugin/skills/_shared/try-it.md`, defines the block's shape, sources, rules and placement. `wrap-up/verification-brief.md` composes the block for every record before its parent/floor branching and writes it to a session-scoped `try-it-{N}.md`; the brief embeds it (above-floor), or it posts alone as a new `try-it` PR run comment (below-floor and parent-linked records). The flow summary templates render that same file, and demo renders the brief's block first. Every consumer cites the contract and restates none of its fields.

**Tech Stack:** Markdown skill prose; `node --test` prose-conformance suite.

**Spec:** `.claude-tweaks/pipelines/2026-10-16T210949-spec-2821/work/2821-spec.md` (record #2821)

**Scope keywords:** Try it, try-it

**Premise-refs:** plugin/skills/wrap-up/verification-brief.md, plugin/skills/wrap-up/verification-brief-parent-gate.md, plugin/skills/_shared/pr-run-comments.md, plugin/bin/session-tmp-resolve.js

## Global Constraints

- The Try it shape is defined in exactly one file (`plugin/skills/_shared/try-it.md`); `flow/summary-template.md`, `flow/multispec-summary.md`, `wrap-up/verification-brief.md` and `demo/SKILL.md` cite it and do not restate its fields.
- Do not remove the floor gate on `demo:pending`: a below-floor record still gets no `demo:pending` label and no sign-off ceremony. Keep the #2383 `oversightExempt` recording (`set-verify-expectations.js --oversight-exempt {N}`) unchanged, including the `Record the exemption (#2383)` lead-in that `tests/verify-expectations-writer-conformance.test.js` extracts by regex.
- `plugin/bin/lib/issues/oversight-floor.js` is read-only; its semantics do not change.
- A run with no green QA stories (backend/infra) still gets a Try it block, built from the ACs and an observation-plan Entry point command, never empty and never placeholder text.
- `/claude-tweaks:demo`'s legacy-brief path (`demo/legacy-brief-compatibility.md`) keeps working (that file is not edited).
- `npm test` passes in full.
- Hand-written commits use `refs #2821` (never a closing keyword) and end with the `Claude-Session:` trailer line.

## Review Focus

1. A below-floor record on a `local-merge` run (no `pr` object): nothing posts anywhere, so the Pipeline Summary must still render the block. Task 3 pins the no-PR degrade sentence, and Task 2 pins the summary's "missing file → compose fresh, never omit" rule.
2. Multi-spec runs share one PR, so a single `try-it` marker would overwrite each spec's comment. Task 3 pins the `try-it:{spec}` qualification.
3. A parent-linked sub-issue that closes the parent's last open sub-issue, below the floor: the end-to-end walkthrough must still reach the human. Task 3 pins the append-to-try-it-file rule in the parent gate's `exceeds: false` branch.
4. A parent brief with no promise register (fewer than 4 sub-issues): `### Confirmed` must still exist, because `engine-verify.js` and the already-posted check key on it, while the walkthrough moves to `### Try it — end to end`. Task 3 pins both headings.
5. `/demo #N` on an old brief with no Try it block must not render an empty section. Task 4 pins "compose one now … never render it empty".

---

### Task 1: The shared Try it contract

**Files:**
- Create: `plugin/skills/_shared/try-it.md`
- Test: `tests/try-it-contract-conformance.test.js`

**Interfaces:**
- Produces: the file `plugin/skills/_shared/try-it.md` with the headings `## Shape`, `## End-to-end variant`, `## Sources`, `## Rules`, `## Where it appears`; the session file name `try-it-{N}.md`; the PR run-comment kind name `try-it` (`try-it:{spec}` under multi-spec); the variant heading literal `### Try it — end to end`.

- [ ] **Step 1: Write the failing test**

Create `tests/try-it-contract-conformance.test.js`:

```js
'use strict';
// #2821: one shared "Try it" walkthrough block, defined once in
// _shared/try-it.md and cited (never restated) by every surface that shows it.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SKILLS = path.join(ROOT, 'plugin', 'skills');
const read = (rel) => fs.readFileSync(path.join(SKILLS, rel), 'utf8');

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : (e.name.endsWith('.md') ? [p] : []);
  });
}

const FIELD_LINE = /^- (Precondition|Access): /m;

test('try-it.md defines the five fields in fixed order', () => {
  const doc = read('_shared/try-it.md');
  const fields = ['- Precondition: ', '- Access: ', '- Entry point: ', '- Steps:', '- Expected: '];
  const idx = fields.map((f) => doc.indexOf(f));
  assert.ok(idx.every((i) => i >= 0), `missing a field line: ${JSON.stringify(idx)}`);
  assert.deepEqual([...idx].sort((a, b) => a - b), idx, 'fields must appear in the fixed order');
  for (const h of ['## Shape', '## End-to-end variant', '## Sources', '## Rules', '## Where it appears']) {
    assert.ok(doc.includes(h), `try-it.md missing ${h}`);
  }
  assert.ok(doc.includes('### Try it — end to end'), 'end-to-end variant heading');
  assert.ok(doc.includes('try-it-{N}.md'), 'session file name');
});

test('try-it.md forbids empty and placeholder blocks and decouples from the oversight floor', () => {
  const doc = read('_shared/try-it.md');
  assert.match(doc, /Never empty, never placeholder/);
  assert.match(doc, /no green QA stories/i);
  assert.match(doc, /never gates the block/);
});

test('the Try it field lines live in exactly one skill file', () => {
  const owners = walk(SKILLS).filter((f) => FIELD_LINE.test(fs.readFileSync(f, 'utf8')))
    .map((f) => path.relative(SKILLS, f));
  assert.deepEqual(owners, ['_shared/try-it.md']);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/try-it-contract-conformance.test.js`
Expected: FAIL with `ENOENT` on `_shared/try-it.md` (the first two tests), and the third fails with `[] !== ['_shared/try-it.md']`

- [ ] **Step 3: Write the contract**

Create `plugin/skills/_shared/try-it.md` with exactly this content:

````markdown
# Try It — the Human Walkthrough Block

Canonical definition of the `### Try it` block: the human-facing walkthrough of what a finished
run delivered — where to go, what to do, what to expect. Every surface that shows it cites this
file and renders the block verbatim; none restates its fields. Consumers:
`wrap-up/verification-brief.md` (composes it for every record), `wrap-up/verification-brief-parent-gate.md`
(the end-to-end variant for a decomposition parent), `flow/summary-template.md` and
`flow/multispec-summary.md` (render it in the Pipeline Summary), `demo/SKILL.md` and
`demo/entry-paths.md` (render it first; compose it when a brief carries none).

Distinct from `_shared/observation-plan.md`: the observation plan is the agent's procedure — the
Prepare/Validate/Inspect commands `/claude-tweaks:demo` executes. This block is what a person reads
and does by hand. It borrows the observation plan's Entry point semantics for non-web surfaces; it
never replaces the plan.

## Shape

```markdown
### Try it

**{feature — one short name per thing the human can try}**
- Precondition: {what must be true first — deployed, data sync run, feature flag on, plugin updated — or `none`}
- Access: {the login tier or role needed, or `none`}
- Entry point: {the route or page to open, or the command to run}
- Steps:
  1. {one human action per numbered line — open, click, type, run}
- Expected: {the observable result that means it works}
```

One bold-named group per feature the run delivered — most records deliver one. The five field
lines keep this order.

## End-to-end variant

For a bundle (a multi-spec `/claude-tweaks:flow` run) or a decomposition parent: heading
`### Try it — end to end`, one group walking the primary path across the assembled specs or
sub-issues, the same five fields. Each step names the spec it exercises with a `(#N)` suffix.

## Sources

Compose from evidence the run already produced — never invent behavior nobody observed:

1. The spec's Deliverables and Acceptance Criteria — what the feature is, and the Expected result.
2. The QA stories that passed this run (`/claude-tweaks:test`'s green stories only) — a story's URL
   becomes the Entry point, its steps become Steps, its assertions become Expected.
3. A run with no green QA stories (a backend, infra, skill or CLI surface) builds the block from the
   ACs, taking the Entry point from `_shared/observation-plan.md`'s per-kind Entry point semantics:
   the invocation for `cli`, the flow's own invocation for `flow`, the file to open for `diff`. In
   this plugin's own repo the runnable unit is a skill invocation (e.g. `/claude-tweaks:flow #N`) —
   name it.

## Rules

- Never empty, never placeholder text (`TBD`, an unfilled `{...}`, "see the PR"). Only
  Precondition and Access may read `none`; Entry point, Steps and Expected are always concrete.
- Human-facing: no agent procedure — no `playwright-cli`, no Prepare/Validate vocabulary, and no
  test command as the Expected result (Expected is what a person sees). A command belongs in Steps
  only when running it is the feature itself.
- Every command is runnable as written from the repository root — no inherited working directory.
- Composed once per record per run, by `wrap-up/verification-brief.md`, into the session-scoped
  file `try-it-{N}.md` (`_shared/session-tmp-root.md`). Every later surface in the same run reads
  that file rather than recomposing, so the summary, the PR and the brief show identical text. A
  surface that finds the file missing or empty (a different session, or the composing step never
  ran) composes the block fresh from the Sources above.

## Where it appears

| Surface | When | Placement |
|---|---|---|
| Verification Brief | a record with no resolvable parent clears the oversight floor | its `### Try it` section, after `### What shipped` |
| `try-it` PR run comment (`_shared/pr-run-comments.md`) | the run has a PR and no brief on it carries the block — a below-floor record, or any parent-linked sub-issue | the whole comment body |
| Parent Verification Brief | a decomposition parent's gate opens | the end-to-end variant, as its `### Try it — end to end` section |
| Pipeline Summary | every successful `/claude-tweaks:flow` run | `### Try it` per spec, plus the end-to-end variant for a bundle |
| `/claude-tweaks:demo` | every item it walks | rendered first in its Step 2 |

The oversight floor (`bin/lib/issues/oversight-floor.js`) never gates the block — it gates only the
`demo:pending` label and the sign-off ceremony.
````

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/try-it-contract-conformance.test.js`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/_shared/try-it.md tests/try-it-contract-conformance.test.js
git commit -m "Add _shared/try-it.md — one human walkthrough shape for every closing surface, refs #2821" -m "Claude-Session: https://claude.ai/code/session_011ZYKWYizjVE2LRbdQhzmBy"
```

---

### Task 2: Pipeline summaries render Try it

**Files:**
- Modify: `plugin/skills/flow/summary-template.md` (template fence lines 9-85; add the section between the `**Reconcile:**` line and `### Timing`, plus a prose rule above the fence)
- Modify: `plugin/skills/flow/multispec-summary.md` (template fence lines 7-41; add between `**Release status:**` and `### Timing`)
- Test: `tests/try-it-contract-conformance.test.js` (append)

**Interfaces:**
- Consumes: `_shared/try-it.md` and the session file name `try-it-{N}.md` (Task 1).

- [ ] **Step 1: Append the failing tests**

Append to `tests/try-it-contract-conformance.test.js`:

```js
function firstFence(doc) {
  const m = /```markdown\n([\s\S]*?)\n```/.exec(doc);
  assert.ok(m, 'no ```markdown template fence');
  return m[1];
}

test('single-spec Pipeline Summary carries a mandatory Try it section before Timing', () => {
  const doc = read('flow/summary-template.md');
  const fence = firstFence(doc);
  const tryIt = fence.indexOf('### Try it');
  assert.ok(tryIt >= 0, 'template fence must contain ### Try it');
  assert.ok(tryIt < fence.indexOf('### Timing'), 'Try it renders before Timing');
  assert.ok(doc.includes('_shared/try-it.md'), 'cites the contract');
  assert.match(doc, /try-it-\{number\}\.md/);
  assert.match(doc, /never gates this section/);
  assert.match(doc, /never omit the section/);
  assert.doesNotMatch(doc, FIELD_LINE);
});

test('multi-spec summary carries one Try it per spec plus the end-to-end section', () => {
  const doc = read('flow/multispec-summary.md');
  const fence = firstFence(doc);
  const perSpec = fence.indexOf('### Try it\n');
  const e2e = fence.indexOf('### Try it — end to end');
  assert.ok(perSpec >= 0 && e2e > perSpec, 'per-spec Try it, then end to end');
  assert.ok(e2e < fence.indexOf('### Timing'), 'both render before Timing');
  assert.match(fence, /#### Spec \{N\}: \{title\}/);
  assert.ok(doc.includes('_shared/try-it.md'), 'cites the contract');
  assert.doesNotMatch(doc, FIELD_LINE);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/try-it-contract-conformance.test.js`
Expected: FAIL — the two new tests fail on `template fence must contain ### Try it` and `per-spec Try it, then end to end`

- [ ] **Step 3: Edit the templates**

In `plugin/skills/flow/summary-template.md`, insert this paragraph immediately before the line `On successful completion of all steps (\`wrap-up\` in the step list):`:

```markdown
**Try it is mandatory (#2821).** Render the `### Try it` section on every successful run, including a record below the oversight floor — the floor gates `demo:pending` and the sign-off ceremony, and never gates this section. Its body is the block `wrap-up/verification-brief.md` composed for this record, per `_shared/try-it.md`, read verbatim from the session-scoped file: `eval "$(node "{pluginRoot}/bin/session-tmp-resolve.js" TRY_IT=try-it-{number}.md)"`, then render `"$TRY_IT"` minus its own heading line. When that file is missing or empty, compose the block now per that contract's Sources — never omit the section and never render a placeholder.

```

Inside the template fence, after the `**Reconcile:** …` line and its following blank line, before `### Timing`, insert:

```markdown
### Try it

{spec {number}'s Try it block (`_shared/try-it.md`) — the body of the session-scoped `try-it-{number}.md`, verbatim, minus its own heading line}

```

In `plugin/skills/flow/multispec-summary.md`, inside the template fence, after the `**Release status:** …` line and its following blank line, before `### Timing`, insert:

```markdown
### Try it

#### Spec {N}: {title}
{that spec's Try it block (`_shared/try-it.md`) — the body of its session-scoped `try-it-{N}.md`, verbatim, minus its own heading line; composed now per that contract when the file is missing. A spec that did not complete reads `Not delivered — {outcome}` instead}

### Try it — end to end
{the contract's end-to-end variant, composed now across every completed spec, minus its own heading line. When fewer than two specs completed: `Only spec {N} completed — its Try it above is the end-to-end path.`}

```

and, after the fence's closing line, before `The header includes \`— keep-going\``, add:

```markdown
Both Try it sections are mandatory on every multi-spec summary (#2821) — the oversight floor never gates them; see `summary-template.md`'s Try it rule for where each spec's block is read from.

```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/try-it-contract-conformance.test.js tests/run-dir-timestamp-utc.test.js tests/wrap-up-summary-template-standalone-conformance.test.js tests/bin-lib/hooks/reconcile-summary.test.js tests/release-recommendation-gate-conformance.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/flow/summary-template.md plugin/skills/flow/multispec-summary.md tests/try-it-contract-conformance.test.js
git commit -m "Pipeline Summaries render a mandatory Try it section per spec, plus end to end for a bundle — refs #2821" -m "Claude-Session: https://claude.ai/code/session_011ZYKWYizjVE2LRbdQhzmBy"
```

---

### Task 3: Verification Brief composes Try it on every record; floor gates only the label

**Files:**
- Modify: `plugin/skills/wrap-up/verification-brief.md` (Routing section lines 8-36; new section before `## Parent-Gate Procedure`; Oversight-floor gate `exceeds: false` bullet lines 70-75; Step 4 template lines 238-276)
- Modify: `plugin/skills/wrap-up/verification-brief-parent-gate.md` ("What this path deliberately does not run" lines 72-78; Evaluate the gate `exceeds: false` lines 248-249; Compose the parent brief lines 253-280)
- Modify: `plugin/skills/_shared/pr-run-comments.md` (Comment kinds table line 28-34; Consumer table lines 125-131)
- Test: `tests/try-it-contract-conformance.test.js` (append)

**Interfaces:**
- Consumes: Task 1's contract, `try-it-{N}.md`, kind `try-it` / `try-it:{spec}`.
- Produces: the section heading `## Try it block (every record, before either branch)` and its `**Posting it alone**` paragraph in `verification-brief.md`, which Task 4's demo prose points at.

- [ ] **Step 1: Append the failing tests**

```js
test('verification-brief.md composes Try it before any parent or floor branching', () => {
  const doc = read('wrap-up/verification-brief.md');
  const compose = doc.indexOf('## Try it block (every record, before either branch)');
  assert.ok(compose >= 0, 'compose section missing');
  assert.ok(compose < doc.indexOf('## Parent-Gate Procedure'), 'before the parent branch');
  assert.ok(compose < doc.indexOf('## Oversight-floor gate'), 'before the floor gate');
  assert.ok(doc.includes('_shared/try-it.md'));
  assert.match(doc, /TRY_IT=try-it-\{N\}\.md/);
  assert.match(doc, /<!-- run-comment: try-it -->/);
  assert.match(doc, /try-it:\{N\}/);
  assert.doesNotMatch(doc, FIELD_LINE);
});

test('below the floor: no demo:pending, but the walkthrough still posts', () => {
  const doc = read('wrap-up/verification-brief.md');
  const gate = doc.slice(doc.indexOf('## Oversight-floor gate'), doc.indexOf('## Step 1:'));
  const below = gate.slice(gate.indexOf('**`exceeds: false`**'), gate.indexOf('**`exceeds: true`**'));
  assert.match(below, /no `demo:pending`\s+bootstrap/, 'floor still gates the label');
  assert.match(below, /walkthrough is not skipped/);
  assert.match(below, /\*\*Posting it alone\*\*/);
  assert.match(doc, /Record the exemption \(#2383\)/, '#2383 recording unchanged');
});

test('no-PR runs degrade to the Pipeline Summary, citing the pr-run-comments gate', () => {
  const doc = read('wrap-up/verification-brief.md');
  const alone = doc.slice(doc.indexOf('**Posting it alone**'));
  assert.match(alone, /No `pr` object/);
  assert.match(alone, /Pipeline Summary carries it/);
  assert.match(alone, /_shared\/pr-run-comments\.md/);
});

test('the brief template places Try it between What shipped and Confirmed', () => {
  const doc = read('wrap-up/verification-brief.md');
  const t = doc.slice(doc.indexOf('## Verification Brief\n\n### The ask'));
  const shipped = t.indexOf('### What shipped');
  const tryIt = t.indexOf('{the Try it block');
  const confirmed = t.indexOf('### Confirmed');
  assert.ok(shipped >= 0 && tryIt > shipped && confirmed > tryIt, `${shipped} ${tryIt} ${confirmed}`);
});

test('parent gate: the end-to-end Try it replaces the inline Confirmed walkthrough, and survives the floor', () => {
  const doc = read('wrap-up/verification-brief-parent-gate.md');
  assert.ok(doc.includes('_shared/try-it.md'));
  assert.ok(doc.includes('### Try it — end to end'));
  assert.doesNotMatch(doc, /inline inside `### Confirmed`/);
  assert.doesNotMatch(doc, /inline within Confirmed/);
  const evalGate = doc.slice(doc.indexOf('## Evaluate the gate'), doc.indexOf('## Compose the parent brief'));
  const below = evalGate.slice(evalGate.indexOf('**`exceeds: false`**'), evalGate.indexOf('**`exceeds: true`**'));
  assert.match(below, /no `demo:pending`, no brief/, 'floor still gates the label and brief');
  assert.match(below, /end-to-end variant/);
  assert.match(below, /Parent-side entry/);
  const compose = doc.slice(doc.indexOf('## Compose the parent brief'), doc.indexOf('## Apply the gate'));
  assert.match(compose, /### Confirmed/, 'Confirmed survives for verify + already-posted checks');
  assert.doesNotMatch(doc, FIELD_LINE);
});

test('pr-run-comments.md registers the try-it kind, spec-qualified under multi-spec', () => {
  const doc = read('_shared/pr-run-comments.md');
  assert.match(doc, /^\| `try-it` \| `\/claude-tweaks:wrap-up`[^\n]*`<!-- run-comment: try-it -->`[^\n]*`<!-- run-comment: try-it:\{spec\} -->`[^\n]*\|$/m);
  assert.match(doc, /^\| `\/claude-tweaks:wrap-up` \(`verification-brief\.md`'s Try it block\) \| `try-it` \|/m);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/try-it-contract-conformance.test.js`
Expected: FAIL — the six new tests fail (`compose section missing`, etc.)

- [ ] **Step 3a: Edit `verification-brief.md`**

(1) In the Routing section, after the paragraph beginning `**Otherwise — no resolvable parent**` (ends `…only when the gate says the record clears the floor.`), insert:

```markdown
**Before either branch, on every path:** compose this record's Try it block — the next section. Neither the Parent-Gate Procedure nor the Oversight-floor gate gates it (#2821); they decide only where it lands.
```

(2) Insert this new section immediately before `## Parent-Gate Procedure (parent-linked sub-issues)`:

````markdown
## Try it block (every record, before either branch)

Compose this record's `### Try it` block per `_shared/try-it.md` (shape, sources, rules — cited, not
restated here) now, before the Parent-Gate Procedure or the Oversight-floor gate runs, and write it
to the session-scoped file that `/claude-tweaks:flow`'s Pipeline Summary reads back:

```bash
eval "$(node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" TRY_IT=try-it-{N}.md)"
```

Write the composed block to `"$TRY_IT"`. Where it lands is the branch's decision: a record with no
resolvable parent that clears the floor embeds it in its brief (Step 4's template); every other
record posts it alone, below.

**Posting it alone** — a record below the floor (`exceeds: false`), or any parent-linked sub-issue
(post that one after the Parent-Gate Procedure returns, so an end-to-end variant it appended rides
along). Under `_shared/pr-run-comments.md`'s gate (`run-state.json` carries a `pr` object), post it
as the `try-it` kind — `try-it:{N}` inside a multi-spec run, the same spec qualification the
`verdict` kind uses:

```bash
printf '<!-- run-comment: try-it -->\n\n' | cat - "$TRY_IT" > "$TRY_IT.pr"
# find-or-create per _shared/pr-run-comments.md's post-or-update procedure, kind=try-it, against {pr-number}
```

No `pr` object (`local-merge`, or a degraded `pr-first` run): post nothing — the
Pipeline Summary carries it. A below-floor record gets no comment on the issue; the floor still
means no ceremony there.

````

(3) In `## Oversight-floor gate`, the `**\`exceeds: false\`**` bullet's first paragraph currently reads:

```
- **`exceeds: false`** — this record does not clear the oversight floor. **Skip Step 1 through
  Step 4 entirely** — no `demo:pending` bootstrap, no observation plan, no brief composed or
  posted. The record closes with no `demo:*` label and no ceremony (this is the *not required*
```

Replace those three lines with:

```
- **`exceeds: false`** — this record does not clear the oversight floor. **Skip Step 1 through
  Step 4 entirely** — no `demo:pending` bootstrap, no observation plan, no brief composed or
  posted. The walkthrough is not skipped: the Try it block composed above posts alone
  (**Posting it alone**), and the Pipeline Summary renders it. The record closes with no `demo:*` label and no ceremony (this is the *not required*
```

(leave the rest of that bullet, including `Record the exemption (#2383)` and its bash fence, unchanged).

(4) In Step 4's rendered template, between the `### What shipped` block (`{one-paragraph summary from the record body + diff}`) and `### Confirmed`, insert:

```markdown
{the Try it block composed in **Try it block** above, verbatim from `"$TRY_IT"`, its own `### Try it` heading included}

```

- [ ] **Step 3b: Edit `verification-brief-parent-gate.md`**

(1) In `## What this path deliberately does not run`, replace the paragraph that starts `**So the brief carries the human instead.**` (through `…it is standing in for the safety net, not summarizing it.`) with:

```markdown
**So the brief carries the human instead.** Part 2 of **Compose the parent brief** below — the
end-to-end walkthrough, rendered as the brief's `### Try it — end to end` section
(`_shared/try-it.md`'s end-to-end variant) — is the only walk instruction a parent brief carries
(it omits the `### Observation plan` section, so `/claude-tweaks:demo` runs no Prepare/Validate/Show
for a parent — it renders that Try it section first and goes to the verdict). For a parent whose
assembled sub-issues touch UI, that walkthrough must therefore name the pages or journeys to open
and what to look for, not just the skill invocation — it is standing in for the safety net, not
summarizing it.
```

(2) In `## Evaluate the gate`, replace:

```
- **`exceeds: false`** — the parent closes cleanly: no `demo:pending`, no brief, same as a
  below-floor sub-issue record on the non-parent path. Stop here; do not compose the parent brief.
```

with:

```
- **`exceeds: false`** — the parent closes cleanly: no `demo:pending`, no brief, same as a
  below-floor sub-issue record on the non-parent path. Do not compose the parent brief. The
  walkthrough is not gated (#2821): on a sub-issue-side entry, compose the end-to-end variant
  (`_shared/try-it.md`) across the assembled sub-issues and append it to this run's `"$TRY_IT"`
  file (`verification-brief.md`'s **Try it block**), so it posts with the sub-issue's own block and
  reaches the Pipeline Summary. Parent-side entry (`/claude-tweaks:tidy`): stop here — no delivering
  run exists to carry it.
```

(3) In `## Compose the parent brief`, replace item 2:

```
2. One walkthrough of the feature's primary path across the assembled sub-issues. For this repo the
   runnable unit is a skill invocation, not a deploy — name the invocation and the observable
   outcome.
```

with:

```
2. One walkthrough of the feature's primary path across the assembled sub-issues — the
   end-to-end variant of `_shared/try-it.md`, rendered as the brief's `### Try it — end to end`
   section.
```

Replace `Where no register exists (…), part 2 alone is the brief.` — keep its parenthetical unchanged and change only the closing clause `part 2 alone is the brief.` to:

```
part 2 alone carries the brief, and `### Confirmed` reads `No cross-spec promise register — walk the end-to-end path in Try it below.` (the section stays: the already-posted check below and `engine-verify.js` both key on it).
```

In the `Render the same ## Verification Brief template …` paragraph, replace `**Confirmed** — parts 1 and 2 above, in place of Step 4's kind-keyed Confirmed
branches;` with `**Confirmed** — part 1 above, in place of Step 4's kind-keyed Confirmed
branches; **Try it** — part 2, in place of Step 4's per-record Try it block;` and replace `Omit the **Observation plan** section — part 2's
walkthrough already names the entry point inline within Confirmed.` with `Omit the **Observation plan** section — part 2's
Try it section already names the entry point.`

- [ ] **Step 3c: Edit `_shared/pr-run-comments.md`**

In `## Comment kinds`, after the `timing` row, add:

```markdown
| `try-it` | `/claude-tweaks:wrap-up`, a record's Try it block when no brief on the PR carries it | `<!-- run-comment: try-it -->` single-spec; `<!-- run-comment: try-it:{spec} -->` per spec in a multi-spec run, the same qualification as `verdict` |
```

In `## Consumer table`, after the `timing` consumer row, add:

```markdown
| `/claude-tweaks:wrap-up` (`verification-brief.md`'s Try it block) | `try-it` | The human walkthrough (`_shared/try-it.md`) for a below-floor record or a parent-linked sub-issue — the cases with no brief on the PR to embed it (#2821); find-or-update by marker |
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/try-it-contract-conformance.test.js tests/verify-expectations-writer-conformance.test.js tests/pr-run-comments.test.js tests/timing-prose-conformance.test.js tests/bin-lib/wrap-up/engine-verify.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/wrap-up/verification-brief.md plugin/skills/wrap-up/verification-brief-parent-gate.md plugin/skills/_shared/pr-run-comments.md tests/try-it-contract-conformance.test.js
git commit -m "Verification Brief composes Try it on every record — the oversight floor now gates only demo:pending and sign-off, refs #2821" -m "Claude-Session: https://claude.ai/code/session_011ZYKWYizjVE2LRbdQhzmBy"
```

---

### Task 4: `/claude-tweaks:demo` shows Try it first

**Files:**
- Modify: `plugin/skills/demo/SKILL.md` (`## Step 2: Per-item walkthrough` lines 78-95; `### Show-first walkthrough` lines 110-117)
- Modify: `plugin/skills/demo/entry-paths.md` (session-recall section list lines 12-35; `#N` closing-commit reconstruction section list around lines 137-167)
- Test: `tests/try-it-contract-conformance.test.js` (append)

**Interfaces:**
- Consumes: Task 1's contract; Task 3's `### Try it — end to end` parent heading.

- [ ] **Step 1: Append the failing tests**

```js
test('demo Step 2 renders Try it before the design contract and before Prepare', () => {
  const doc = read('demo/SKILL.md');
  const step2 = doc.slice(doc.indexOf('## Step 2: Per-item walkthrough'), doc.indexOf('### Verdict'));
  const tryIt = step2.indexOf('Try it');
  assert.ok(tryIt >= 0, 'Step 2 must name Try it');
  assert.ok(tryIt < step2.indexOf('### The design contract'), 'before the design-contract section');
  assert.ok(tryIt < step2.indexOf('**Prepare**'), 'before Prepare');
  assert.ok(doc.includes('_shared/try-it.md'));
  assert.match(step2, /never render it empty/);
  assert.doesNotMatch(doc, /walkthrough lives inline in `### Confirmed`/);
  assert.doesNotMatch(doc, FIELD_LINE);
});

test('demo entry paths compose a Try it block on both composer branches', () => {
  const doc = read('demo/entry-paths.md');
  const hits = doc.split('_shared/try-it.md').length - 1;
  assert.ok(hits >= 2, `expected session-recall and reconstruction to cite the contract, found ${hits}`);
  assert.doesNotMatch(doc, FIELD_LINE);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/try-it-contract-conformance.test.js`
Expected: FAIL — the two new tests fail (`Step 2 must name Try it`, `found 0`)

- [ ] **Step 3: Edit demo**

In `plugin/skills/demo/SKILL.md` `## Step 2: Per-item walkthrough`, insert this paragraph immediately after the heading line (before `Render this record's full Verification Brief`):

```markdown
**Try it first (#2821).** Before anything else in this step — before the design-contract section
and before any Prepare/Validate output — render the brief's `### Try it` block (`_shared/try-it.md`;
a parent brief's `### Try it — end to end`), so `/claude-tweaks:demo #N` opens on the same
walkthrough the Pipeline Summary and the PR showed. A brief carrying none (posted before this
shipped) — compose one now per that contract from the record's Acceptance Criteria and Step 1's
entry point, and never render it empty.

```

In the same section, replace both occurrences of `walkthrough lives inline in \`### Confirmed\`` (one in the `Render this record's full Verification Brief` paragraph, one in `### Show-first walkthrough`'s first paragraph — the second is worded `(walkthrough lives inline in \`### Confirmed\`` followed by a line break and `instead)`) with `walkthrough lives in its \`### Try it — end to end\` section`. Re-read both paragraphs after the edit: the surrounding text says such a brief skips Prepare/Validate/Show "and goes straight to the Verdict question" — that remains true (Try it was already rendered at the top of the step).

In `plugin/skills/demo/entry-paths.md`:
- In `## No arguments: session-recall`, where the bullets list the sections the recall entry composes (`- **Confirmed** — …`, `- **Observation plan** — …`), add after the Observation plan bullet:
  `- **Try it** — compose the block from recall per \`_shared/try-it.md\` (its Sources and Rules; the Entry point from the Observation plan just composed).`
- In `## \`#N\` given: single-record lookup`'s closing-commit reconstruction bullets (`- **Confirmed** — this brief is a **reconstruction**…`, `- **Observation plan** — run the commit's changed-path list…`), add after the Observation plan bullet's paragraph:
  `- **Try it** — compose the block per \`_shared/try-it.md\` from the record's Acceptance Criteria and the Observation plan's Entry point; a reconstruction asserts nothing past what the commit shows.`

Adjust the session-recall preamble's section list on line 12-13 (`\`### The ask\` / \`### What shipped\` / \`### Confirmed\` / \`### Observation plan\``) to append ` / \`### Try it\``.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/try-it-contract-conformance.test.js tests/demo-full-verification-pointer.test.js tests/demo-visual-decision-adoption.test.js tests/bin-lib/skill-audit/anti-patterns.test.js tests/bin-lib/skill-audit/context-cost.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/demo/SKILL.md plugin/skills/demo/entry-paths.md tests/try-it-contract-conformance.test.js
git commit -m "demo renders the Try it walkthrough first, composing one when a brief predates it — refs #2821" -m "Claude-Session: https://claude.ai/code/session_011ZYKWYizjVE2LRbdQhzmBy"
```

---

### Task 5: Document the edges and run the full suite

**Files:**
- Modify: `docs/skill-graph.md:614` (the `/demo` row's sentence `a parent brief omits the Observation plan section and carries its walk instruction inline in \`### Confirmed\` instead`)
- Modify: `docs/plugin-structure.md:115` (the `_shared` curated row — add `try-it.md` to the file list and a one-sentence description)

- [ ] **Step 1: Edit the docs**

`docs/skill-graph.md` line 614: replace `carries its walk instruction inline in \`### Confirmed\` instead.` with `carries its walk instruction in its \`### Try it — end to end\` section instead. Every record's brief, PR and the flow Pipeline Summary carry the same human \`### Try it\` walkthrough (\`_shared/try-it.md\`), composed by \`verification-brief.md\` for every record regardless of the oversight floor; \`/demo\` renders it first.`

`docs/plugin-structure.md` line 115: append `, try-it.md` to the file-name list cell (after `ceremony-profile.md`), and append to the description cell, before its closing ` |`: ` try-it.md (#2821): the human "Try it" walkthrough block — shape, sources, rules, placement; composed by wrap-up's verification-brief.md for every record, rendered by flow's summary templates and /demo.`

- [ ] **Step 2: Verify no stale "inline in Confirmed" claims remain**

Run: `grep -rn -e "inline in \`### Confirmed\`" -e "inline inside \`### Confirmed\`" -e "inline within Confirmed" plugin docs`
Expected: no output (exit 1)

- [ ] **Step 3: Full suite**

Run: `npm test > /private/tmp/claude-501/-Users-thomasholknielsen-Code-Workspaces-claude-tweaks/82e7b9ad-2cef-47ed-9c48-ca4063e76e9f/scratchpad/npm-test-2821.log 2>&1; echo "exit=$?"`
Expected: `exit=0`; re-run any failing file in isolation before treating it as real (CLAUDE.md's load-flake rule).

- [ ] **Step 4: Commit**

```bash
git add docs/skill-graph.md docs/plugin-structure.md
git commit -m "Document the Try it contract's edges in skill-graph and plugin-structure — refs #2821" -m "Claude-Session: https://claude.ai/code/session_011ZYKWYizjVE2LRbdQhzmBy"
```
