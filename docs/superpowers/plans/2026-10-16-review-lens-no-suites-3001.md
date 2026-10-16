# Review lens no-suites rule + listener sweep (#3001) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/claude-tweaks:review` Step 3's lens, debate, refutation and gap-sweep agents are told, in text that reaches their prompts, never to run the project's test suites, builds, dev servers or e2e runners. The post-fan-out sweep also reports, without killing anything, any local TCP listener the fan-out left running.

**Architecture:** The rule lives once in `_shared/subagent-dispatch-core.md`, one of the two sources of the composed `review-dispatch` bundle. It sits as a new `## Read-only Reviewer Discipline` section beside the existing Working Directory and Foreground Execution sections, and carries one verbatim prompt line. `review/step3-lens-dispatch.md` gets a sibling dispatch note telling the dispatcher to inline that line outside the byte-pinned Calibration block, and its Foreground note is reconciled. The three Step 3.5/3.6 prompt templates in `step3-debate-and-refutation.md` get a placeholder for the line. The sweep section gains a pre-dispatch `lsof` listener snapshot next to `pre-dispatch-status.txt`, plus a report-only diff by command + port.

**Tech Stack:** Markdown skill prose; `node --test` conformance suite.

**Spec:** `.claude-tweaks/pipelines/2026-10-16T162820-spec-3001/work/3001-spec.md`

## Global Constraints

- Do not edit anything between `CALIBRATION (required):` and the closing fence of the Per-lens Calibration + Output template in `plugin/skills/review/step3-lens-dispatch.md`. It is byte-pinned against `_shared/criteria-review-quality.md` by `tests/code-health-misc/criteria-fragments.test.js`.
- The composed `review-dispatch` bundle must stay under `CEILING_BYTES` (46,080 B), with no new `COMPOSED_STEP_EXCEPTIONS` entry. Measured at plan time: 40,073 B, leaving 6,007 B of headroom.
- Every `plugin/skills/**/*.md` file stays under 46,080 B. Measured at plan time: `step3-lens-dispatch.md` 40,515 B (5,565 B headroom), `subagent-dispatch-core.md` 27,909 B, `step3-debate-and-refutation.md` 20,782 B, `review-summary-template.md` 14,211 B. Grepping `tests/` for these basenames next to `byteLength`/`wc -c` found no file-specific byte pin.
- The listener check is report-only: never kill a process. It cannot attribute ownership, because a sibling session may have started the listener.
- The rule forbids running suites, builds, servers and e2e runners. It does not forbid reading test files. The one sanctioned execution is lens 3f's Vacuity-evidence diagnostic, which requires a single targeted case run with observed output; the rule names that as its sole exception.

## Review Focus

1. Lens 3f's Vacuity-evidence diagnostic (`step3-lens-dispatch.md` § 3f) *requires* running one targeted test case. A blanket "never run tests" rule would contradict it. The rule's sole-exception clause must keep both consistent (Task 1 test asserts the exception names 3f).
2. `lsof` absent (Windows, minimal containers). The sweep must skip and log, never fail the review (Task 2 test asserts the skip-and-log text).
3. A listener started by a sibling session during the fan-out. It must be reported as unattributed, never treated as proof that a lens misbehaved (Task 2 test asserts the attribution caveat).
4. The same process re-binding with a new PID. The diff is keyed on command + port, not on the raw line, so a PID change alone is not a "new listener" (Task 2 test asserts the command + port keying).
5. The rule is inlined into the Calibration block, which breaks the byte pin. Task 1 test asserts the Calibration span does not contain it.

---

### Task 1: Read-only reviewer rule in the dispatch bundle and dispatch notes

**Files:**
- Modify: `plugin/skills/_shared/subagent-dispatch-core.md` (title line 1, preamble lines 3-13, insert new section between `## Foreground Execution Discipline` and `## Model Selection`)
- Modify: `plugin/skills/review/step3-lens-dispatch.md:15-17` (compose-section citation list), `:58` (Foreground note → new Read-only note + reconciled Foreground note)
- Modify: `plugin/skills/review/step3-debate-and-refutation.md` (three prompt templates: debate `Read-only.` line, refutation template before `SCRATCH:`, gap-sweep template before `SCRATCH:`)
- Test: `tests/review-lens-no-suites-conformance.test.js` (create)

**Interfaces:**
- Produces: the section heading `## Read-only Reviewer Discipline` in `subagent-dispatch-core.md`. The verbatim prompt line starts `READ-ONLY REVIEW:`. The placeholder string `[... READ-ONLY REVIEW line` appears in the debate file. Task 2 appends to the same test file.

- [ ] **Step 1: Write the failing test**

Create `tests/review-lens-no-suites-conformance.test.js`:

```js
// tests/review-lens-no-suites-conformance.test.js — pins #3001: review Step 3's read-only
// reviewer agents (lens, debate, refutation, gap-sweep) are told, in text that reaches their
// prompts via the composed review-dispatch bundle, never to run the project's test suites,
// builds, dev servers or e2e runners; and the post-fan-out sweep reports leftover listeners.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { compose } = require('../plugin/bin/lib/compose-context/compose');

const SKILLS = path.join(__dirname, '..', 'plugin', 'skills');
const read = (...p) => fs.readFileSync(path.join(SKILLS, ...p), 'utf8');

const CONDITIONS = {
  'integration-model': 'pr-first',
  mode: 'auto',
  attendance: 'headless',
  transport: 'gh',
  'worktree-policy': 'always',
  'work-backend': 'github-issues',
};

const RULE = /never run the project's test suites, builds, dev servers, or e2e runners/;

function section(text, heading) {
  const start = text.indexOf(heading);
  assert.notEqual(start, -1, `missing heading: ${heading}`);
  const next = text.indexOf('\n## ', start + 1);
  return text.slice(start, next === -1 ? text.length : next);
}

function reviewDispatchBundle() {
  return compose(
    [
      { path: 'plugin/skills/_shared/subagent-dispatch-core.md', content: read('_shared', 'subagent-dispatch-core.md') },
      { path: 'plugin/skills/_shared/run-dir-resolution.md', content: read('_shared', 'run-dir-resolution.md') },
    ],
    CONDITIONS,
  );
}

test('the composed review-dispatch bundle carries the verbatim READ-ONLY REVIEW prompt line', () => {
  const sec = section(reviewDispatchBundle(), '## Read-only Reviewer Discipline');
  const line = sec.split('\n').find((l) => l.includes('READ-ONLY REVIEW:'));
  assert.ok(line, 'the section must carry one verbatim prompt line starting READ-ONLY REVIEW:');
  assert.match(line, RULE);
  assert.match(line, /read and report only/);
  assert.match(line, /\/claude-tweaks:test/);
  assert.match(line, /lens 3f's Vacuity-evidence diagnostic/, 'the sole exception must name lens 3f so the rule does not contradict that diagnostic');
});

test('the rule is scoped to read-and-report dispatches, never implementer/test/QA ones', () => {
  const sec = section(reviewDispatchBundle(), '## Read-only Reviewer Discipline');
  assert.match(sec, /lens, debate, refutation, and gap-sweep agents/);
  assert.match(sec, /never applies to an implementer, test, or QA\s+dispatch/);
});

test('step3-lens-dispatch.md instructs inlining the rule, outside the byte-pinned Calibration block', () => {
  const d = read('review', 'step3-lens-dispatch.md');
  assert.match(d, /> \*\*Read-only Reviewer Discipline:\*\*/);
  const calStart = d.indexOf('CALIBRATION (required):');
  const calEnd = d.indexOf('Self-check before sending');
  assert.ok(calStart !== -1 && calEnd > calStart, 'Calibration block anchors not found');
  const cal = d.slice(calStart, calEnd);
  assert.doesNotMatch(cal, RULE);
  assert.doesNotMatch(cal, /READ-ONLY REVIEW/);
});

test('the Foreground note no longer frames running a verification command as an expected lens activity', () => {
  const d = read('review', 'step3-lens-dispatch.md');
  assert.doesNotMatch(d, /runs a verification command \(rather than only reading\/reporting\)/);
  assert.match(d, /> \*\*Foreground Execution Discipline:\*\*[^\n]*Vacuity-evidence diagnostic/);
});

test('the debate, refutation, and gap-sweep prompt templates each carry the READ-ONLY REVIEW placeholder', () => {
  const t = read('review', 'step3-debate-and-refutation.md');
  const hits = t.match(/\[\.\.\. READ-ONLY REVIEW line, verbatim from the review-dispatch bundle's Read-only Reviewer Discipline section \.\.\.\]/g) || [];
  assert.equal(hits.length, 3);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/review-lens-no-suites-conformance.test.js`
Expected: FAIL. All five tests fail: `missing heading: ## Read-only Reviewer Discipline`, the missing `**Read-only Reviewer Discipline:**` note, the still-present Foreground wording, and 0 placeholders.

- [ ] **Step 3: Implement**

3a. `plugin/skills/_shared/subagent-dispatch-core.md` line 1, replace:
`# Subagent Dispatch Core — Working Directory, Foreground Execution, Model Selection, Template A, Retrieval, Fan-Out`
with:
`# Subagent Dispatch Core — Working Directory, Foreground Execution, Read-only Reviewers, Model Selection, Template A, Retrieval, Fan-Out`

3b. Same file, preamble: replace
```
states at its own top ("This file is the single source of truth"). The Foreground Execution
Discipline section below is the one exception to "extracted" — it originates here, directly
(#2271), since no equivalent content exists in the parent file to move from.
```
with
```
states at its own top ("This file is the single source of truth"). The Foreground Execution
Discipline (#2271) and Read-only Reviewer Discipline (#3001) sections below are the two
exceptions to "extracted" — they originate here, directly, since no equivalent content exists
in the parent file to move from.
```

3c. Same file: insert immediately before the line `## Model Selection`:
```
## Read-only Reviewer Discipline

Applies only to dispatches whose job is to read and report: `/claude-tweaks:review` Step 3's
lens, debate, refutation, and gap-sweep agents. It never applies to an implementer, test, or QA
dispatch, whose job is to run things. Inline this line verbatim into every such prompt, outside
any byte-pinned Calibration/Output block:

`READ-ONLY REVIEW: never run the project's test suites, builds, dev servers, or e2e runners — read and report only, since mechanical verification belongs to /claude-tweaks:test (sole exception: one targeted test case, run in the foreground, when lens 3f's Vacuity-evidence diagnostic needs execution evidence).`

Reading a test file is always fine; running the suite is not. A reviewer that starts the
project's suite or server races any server the same review started (`/visual-review`'s
ephemeral dev server), and it reports failures produced by the wrong harness rather than by the
diff. #3001 observed exactly this: a Fast-profile lens agent ran a full Playwright e2e suite in
the background on the framework's default ports.

```

3d. `plugin/skills/review/step3-lens-dispatch.md` compose section: replace
`> Directory Discipline, Foreground Execution Discipline, Model Selection, Failed-agent retrieval,`
with
`> Directory Discipline, Foreground Execution Discipline, Read-only Reviewer Discipline, Model Selection, Failed-agent retrieval,`

3e. Same file: replace the whole line beginning `> **Foreground Execution Discipline:** Applies to the same dispatches. Any lens, debate, refutation, or gap-sweep agent that runs a verification command` (line 58) with these three lines:
```
> **Read-only Reviewer Discipline:** Applies to the same dispatches. Lens, debate, refutation, and gap-sweep agents read and report only: they never run the project's test suites, builds, dev servers, or e2e runners, because mechanical verification belongs to `/claude-tweaks:test`. Inline the `READ-ONLY REVIEW:` line from that bundle's (or, standalone, `_shared/subagent-dispatch-core.md`'s) Read-only Reviewer Discipline section verbatim into every prompt, alongside the scope and `Path:Line` instructions, and never inside the byte-identical Calibration/Output block below.
>
> **Foreground Execution Discipline:** Applies to the same dispatches. The one command a reviewer may run, a single targeted test case for lens 3f's Vacuity-evidence diagnostic, runs in the foreground per that same bundle's (or, standalone, `_shared/subagent-dispatch-core.md`'s) Foreground Execution Discipline section. It never backgrounds a check and ends its turn waiting for a Monitor/background-task notification, since none reaches a dispatched agent that way.
```

3f. `plugin/skills/review/step3-debate-and-refutation.md`:
- Debate template: replace the line `>    Read-only.` with `>    [... READ-ONLY REVIEW line, verbatim from the review-dispatch bundle's Read-only Reviewer Discipline section ...]`.
- Refutation template: insert, immediately before the line beginning `>    SCRATCH: {ctx-dir}/agent-scratch/{agent-id}`, the line `>    [... READ-ONLY REVIEW line, verbatim from the review-dispatch bundle's Read-only Reviewer Discipline section ...]` followed by a `>` blank line.
- Gap-sweep template: insert, immediately before the line beginning `SCRATCH: {ctx-dir}/agent-scratch/gap-sweep`, the line `[... READ-ONLY REVIEW line, verbatim from the review-dispatch bundle's Read-only Reviewer Discipline section ...]` followed by a blank line.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/review-lens-no-suites-conformance.test.js tests/review-dispatch-composition.test.js tests/code-health-misc/criteria-fragments.test.js tests/multi-agent-coordination.test.js tests/subagent-contract-clauses.test.js tests/review-vacuity-evidence-conformance.test.js`
Expected: PASS, with 0 failures in every file.

- [ ] **Step 5: Commit**

```bash
git add tests/review-lens-no-suites-conformance.test.js plugin/skills/_shared/subagent-dispatch-core.md plugin/skills/review/step3-lens-dispatch.md plugin/skills/review/step3-debate-and-refutation.md
git commit -m "Tell review read-only reviewers never to run suites or servers — #3001 rule in the review-dispatch bundle"
```

### Task 2: Report-only leftover-listener sweep

**Files:**
- Modify: `plugin/skills/review/step3-lens-dispatch.md` (the `> **Pre-dispatch listing (scratch-sweep baseline).**` paragraph; the `## Post-fan-out untracked-file sweep` section)
- Modify: `plugin/skills/review/step3-debate-and-refutation.md` (the `## Post-fan-out sweep (this file's own closing step)` paragraph)
- Modify: `plugin/skills/review/review-summary-template.md` (the `### Fan-out leftovers` section)
- Test: `tests/review-lens-no-suites-conformance.test.js` (append)

**Interfaces:**
- Consumes: the test file and the `read`/`section` helpers from Task 1.
- Produces: the snapshot file name `{ctx-dir}/pre-dispatch-listeners.txt` and the command `lsof -nP -iTCP -sTCP:LISTEN`.

- [ ] **Step 1: Write the failing test**

Append to `tests/review-lens-no-suites-conformance.test.js`:

```js
test('the pre-dispatch listing also snapshots local TCP listeners next to pre-dispatch-status.txt', () => {
  const d = read('review', 'step3-lens-dispatch.md');
  const para = d.slice(d.indexOf('**Pre-dispatch listing (scratch-sweep baseline).**'), d.indexOf('**`Path:Line` must be file-native'));
  assert.match(para, /pre-dispatch-status\.txt/);
  assert.match(para, /lsof -nP -iTCP -sTCP:LISTEN > \{ctx-dir\}\/pre-dispatch-listeners\.txt/);
  assert.match(para, /lsof.*unavailable[\s\S]*SKIP/);
});

test('the post-fan-out sweep documents a report-only listener diff and its outputs', () => {
  const sweep = section(read('review', 'step3-lens-dispatch.md'), '## Post-fan-out untracked-file sweep');
  assert.match(sweep, /pre-dispatch-listeners\.txt/);
  assert.match(sweep, /command name and port/, 'diff is keyed on command + port, not PID or raw line');
  assert.match(sweep, /Never kill/);
  assert.match(sweep, /cannot attribute/);
  assert.match(sweep, /Fan-out leftovers/);
  assert.match(sweep, /STAGED \{HH:MM:SS\} — Review fan-out left \{n\} new listener\(s\): \{command:port list\}\. Not killed\. Reversibility: n\/a\./);
});

test('the summary template Fan-out leftovers slot lists leftover listeners', () => {
  const t = read('review', 'review-summary-template.md');
  const slot = t.slice(t.indexOf('### Fan-out leftovers'), t.indexOf('### Implementation Hindsight'));
  assert.match(slot, /listener/);
  assert.match(slot, /\{command\}:\{port\}/);
});

test('the high-tier closing sweep in step3-debate-and-refutation.md also runs the listener diff', () => {
  const sec = section(read('review', 'step3-debate-and-refutation.md'), '## Post-fan-out sweep (this file\'s own closing step)');
  assert.match(sec, /pre-dispatch-listeners\.txt/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/review-lens-no-suites-conformance.test.js`
Expected: FAIL. The four new tests fail because `pre-dispatch-listeners.txt` is absent everywhere. Task 1's five tests still pass.

- [ ] **Step 3: Implement**

3a. `step3-lens-dispatch.md`: in the `> **Pre-dispatch listing (scratch-sweep baseline).**` paragraph, after the sentence ending `capture it exactly once per review, here, regardless of tier.`, append on the same paragraph line:
` In the same step, snapshot local TCP listeners: \`lsof -nP -iTCP -sTCP:LISTEN > {ctx-dir}/pre-dispatch-listeners.txt\`. When \`lsof\` is unavailable (\`command -v lsof\` finds nothing — Windows, a minimal container), skip both the snapshot and its later diff and log \`SKIP {HH:MM:SS} — Review listener snapshot: lsof unavailable → leftover-listener check not run. Reversibility: n/a.\` The skip never blocks the review.`

3b. Same file, `## Post-fan-out untracked-file sweep` section: insert a new paragraph immediately before the `**Agent-scratch cleanup check.**` paragraph:
```
**Leftover-listener check.** When `{ctx-dir}/pre-dispatch-listeners.txt` exists, re-run `lsof -nP -iTCP -sTCP:LISTEN` and compare the two listings by command name and port (the `COMMAND` column and the port in `NAME`), never by PID or whole line, so a process that merely re-bound with a new PID is not counted as new. Any command:port pair absent from the pre-dispatch snapshot is a new listener that a lens agent may have left running (a dev server, mock server, or test runner, none of which leaves an untracked file for the diff above to see). It is:
- reported by command name and port in the review summary's `Fan-out leftovers` section,
- logged to `decisions.md`: `STAGED {HH:MM:SS} — Review fan-out left {n} new listener(s): {command:port list}. Not killed. Reversibility: n/a.`

Never kill anything here. The check is report-only, like the untracked-file diff. It cannot attribute ownership, because another session may have started a listener during the fan-out, so a reported listener is never proof that a lens agent misbehaved. The controller decides what happens to it.

```

3c. `step3-debate-and-refutation.md`, `## Post-fan-out sweep (this file's own closing step)`: replace
`captures the pre-dispatch baseline (\`{ctx-dir}/pre-dispatch-status.txt\`) before Step 3's first dispatch;`
with
`captures the pre-dispatch baselines (\`{ctx-dir}/pre-dispatch-status.txt\`, plus \`{ctx-dir}/pre-dispatch-listeners.txt\` for its leftover-listener check) before Step 3's first dispatch;`

3d. `review-summary-template.md`, `### Fan-out leftovers` section: replace the line
`{None | N untracked file(s) left by the review fan-out, reported (not deleted) by the post-fan-out sweep: {paths}}`
with
```
{None | N untracked file(s) left by the review fan-out, reported (not deleted) by the post-fan-out sweep: {paths}}
{None | N new local listener(s) since the pre-dispatch snapshot, reported (not killed; ownership unattributed): {command}:{port}, …}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/review-lens-no-suites-conformance.test.js tests/review-dispatch-composition.test.js tests/code-health-misc/criteria-fragments.test.js tests/multi-agent-coordination.test.js tests/bin-lib/review-context/prose.test.js`
Expected: PASS, with 0 failures in every file.

- [ ] **Step 5: Commit**

```bash
git add tests/review-lens-no-suites-conformance.test.js plugin/skills/review/step3-lens-dispatch.md plugin/skills/review/step3-debate-and-refutation.md plugin/skills/review/review-summary-template.md
git commit -m "Report fan-out leftover listeners in review's post-fan-out sweep — #3001 report-only lsof diff"
```

## Verification notes (plan-authoring checks)

- Verbatim-command run-once: `lsof -nP -iTCP -sTCP:LISTEN` was run on this machine at plan time. It printed a `COMMAND PID USER FD TYPE DEVICE SIZE/OFF NODE NAME` header plus rows such as `rapportd 652 … TCP *:59044 (LISTEN)`, which confirms the command:port keying source. `/usr/sbin/lsof` is present.
- Moved-prose pin: grepped `tests/` for `runs a verification command` and `rather than only reading` and found no pin other than the new test. `Fan-out leftovers` is pinned by `tests/multi-agent-coordination.test.js` (`### Fan-out leftovers`, `Fan-out leftovers 0`). Both strings survive unchanged.
- Byte pins: no file-specific pin on the four touched files (grep for `byteLength`/`wc -c` in `tests/`). The shared ceiling headroom is recorded under Global Constraints.
- Degrade-clause convention: the `lsof`-unavailable clause follows `_shared/auto-decision-log.md`'s degrade-trace `SKIP` entry shape.
