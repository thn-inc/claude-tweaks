# Specify Sub-file Split + Shaping `--check` Pins Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring every `plugin/skills/specify/*.md` sub-file at least 2,048 B under the 28,672 B `SPECIFY_SUBFILE_CEILING_BYTES` by splitting four files along existing section boundaries, make shaping mode's "already shaped, no-op" outcome the result of `compose-record.js --check` exiting 0, and pin the local-files driver's pre-write `--check` with a conformance test.

**Architecture:** Pure skill-prose reorganisation plus `node --test` conformance tests. Each split moves a contiguous line range verbatim into a new lazy-loaded sibling and leaves a conditional "read X when Y" pointer in the parent. No `plugin/bin` code changes: `compose-record.js --check` already exists and is the checker both new tests exercise.

**Tech Stack:** Markdown skill files, `node --test` (run via `npm test`), git.

**Spec:** `.claude-tweaks/pipelines/2026-10-04T145049-record-2841/work/2841-spec.md` (record #2841)

## Global Constraints

- Ceiling: `SPECIFY_SUBFILE_CEILING_BYTES = 28 * 1024` = 28,672 B (`tests/bin-lib/skill-audit/context-cost.test.js`). Target for every `plugin/skills/specify/*.md` sub-file: at most 26,624 B (`wc -c`).
- `plugin/skills/specify/SKILL.md` is 38,591 B against a hard 40,960 B ceiling: at most a few hundred bytes may be added to it.
- Moved text is moved **verbatim**: no rewording, no trimming, no reflowing. The only authored text is the new files' header paragraphs and the parents' pointer stubs given below.
- Baseline measured on this branch at `627e763ab` (0 commits behind `origin/main`): `next-mode.md` 28,454; `shaping-mode-stamping.md` 28,523; `spec-template.md` 28,010; `decomposition-mode.md` 26,894. Every other specify sub-file is already under 26,624 B.
- Commit message style: `{Verb} {what} — {detail}`, ending `(refs #2841)` — never `closes`/`fixes`. End every commit message with the line `Claude-Session: https://claude.ai/code/session_015ZX5aJf9QxottoX6taiskk`.
- Never run `git stash`. Run every command in the foreground. One plain command per Bash call (no `&&`, loops, heredocs, or globs); use absolute or repo-relative literal paths.
- Commit tests only where the task asks for them or the repo already keeps tests for this kind of change, sized like the neighboring test files; scratch checks stay scratch. Touch only what the task requires — a pre-existing bug you notice is a follow-up to report, not a fix to fold in, unless the task cannot work without it. Don't reformat or "improve" adjacent code; edit in place rather than rewrite when the result is the same.
- For any task modifying pre-existing behavior, write a full characterization test covering edge cases before changing it — published or external consumers may depend on them. (Applies to Task 2's prose-behaviour change; its test is that characterization.)

## Review Focus

- A citation elsewhere in the repo that names a moved section by its old host file (for example "`shaping-mode-stamping.md`'s Read-back verification") must now name the new file — Task 1 Step 6 greps for these.
- A moved passage that says "above"/"below" must still resolve: each new file's header states what those words refer to — Task 1 Step 2.
- A sibling nobody is told to read is an orphan: each parent stub must carry the conditional read instruction — Task 1 Step 7's reachability grep.
- A body that looks shaped by eye but lacks `## Release Note` (the #2827 failure) must never be reported `already shaped, no-op` — Task 2's rejected-body test.
- Removing the local-files `--check` clause must turn a test red — Task 3's discrimination probe.

---

### Task 1: Split the four near-ceiling sub-files [batch]

**Files:**
- Create: `plugin/skills/specify/shaping-mode-readback.md`
- Create: `plugin/skills/specify/next-mode-closeout.md`
- Create: `plugin/skills/specify/empirical-premise-check-deliverables.md`
- Create: `plugin/skills/specify/overlap-resolution.md`
- Modify: `plugin/skills/specify/shaping-mode-stamping.md`
- Modify: `plugin/skills/specify/shaping-mode.md`
- Modify: `plugin/skills/specify/next-mode.md`
- Modify: `plugin/skills/specify/spec-template.md`
- Modify: `plugin/skills/specify/decomposition-mode.md`
- Modify: `plugin/skills/specify/SKILL.md`
- Modify: `docs/plugin-structure.md`
- Modify: `docs/skill-graph.md`
- Modify: `plugin/skills/specify/decomposition-mode-closeout.md`
- Modify: `tests/specify-next-mode.test.js`
- Modify: `tests/sweep-orchestrator.test.js`
- Modify: `tests/review-risk-marker-verification.test.js`
- Modify: `tests/specify-range-form-readback.test.js`
- Modify: `tests/batch-ref-argument.test.js`

Plus any other test file under `tests/` whose assertion targets text that moved (found by running the suite in Step 5).

**Interfaces:**
- Produces: `plugin/skills/specify/shaping-mode-readback.md` containing the `### Read-back verification` and `### Actions Performed` sections (Tasks 2 reads/edits it); `shaping-mode-stamping.md` still containing `### Compose-then-write-once` in full (Task 3 pins it).

- [ ] **Step 1: Save the four originals for the nothing-dropped proof**

Copy each original, before editing, into the session scratchpad directory you were given (not `/tmp`, not the repo): `git show HEAD:plugin/skills/specify/shaping-mode-stamping.md > {scratch}/orig-shaping-mode-stamping.md`, and likewise for `next-mode.md`, `spec-template.md`, `decomposition-mode.md` (one Bash call each).

- [ ] **Step 2: Create the four siblings — header below, then the named line range verbatim**

Line numbers are of the originals at `HEAD` (`627e763ab`). Extract each range mechanically (for example `sed -n '211,251p' {orig}`), never by retyping.

`shaping-mode-readback.md` = this header, then original `shaping-mode-stamping.md` lines 211-251 (`### Read-back verification` through end of file):

```markdown
# Specify — Shaping Mode: Read-back and Actions Performed (continued)

Continues `shaping-mode-stamping.md` (this skill's directory) — the metadata block through
compose-then-write-once there, read-back verification and Actions Performed here (#2841's split).
Read it once a record's write call in that file's Compose-then-write-once section has run —
landed, been refused by the pre-write shape check, or failed — on every entry path that file
names. Section names are unchanged across the split, so a cross-reference naming a section here
still resolves regardless of which file it lands in; "above" in this file means
`shaping-mode-stamping.md`'s sections (and, before them, `shaping-mode.md`'s), which precede this
file in reading order.

---

```

`next-mode-closeout.md` = this header, then original `next-mode.md` lines 278-358 (the `## Zero eligible or budget exhausted (loop termination + close-out)` heading through the `--source sweep` paragraph's last line; line 359 is blank and line 360 is `## Claim`, which stays):

```markdown
# Specify — bare drain: loop termination and close-out

Loaded from `next-mode.md`'s `## Zero eligible or budget exhausted (loop termination + close-out)`
stub (this skill's directory; #2841's split). Read it when that file's Selection fence yields a
`null` `$PICK`, or when this firing's attempt counter reaches `--budget <n>` — never on an
iteration that picked a record. "This fence", "above", and "below" in this file refer to
`next-mode.md`'s reading order at that stub: its Selection section sits above, its `## Claim`
section below.

---

```

`empirical-premise-check-deliverables.md` = this header, then original `spec-template.md` lines 182-212 (the paragraph after the `## Empirical Premise-Check Deliverables` heading through the `Example: #560's Task 0 …` paragraph, including the `### Third-Party CLI/API Behavior Task 0` heading):

```markdown
# Empirical Premise-Check Deliverables

Referenced from `spec-template.md`'s Empirical Premise-Check Deliverables pointer, in this skill's
directory (#2841's split). Read it when a record's technical approach rests on an assumption about
how an external system, harness, tool, or third-party CLI/API actually behaves. "This section"
below means that `spec-template.md` section, which this file carries in full.

```

`overlap-resolution.md` = this header, then original `decomposition-mode.md` lines 116-151 (`### Auto mode (policy lookup)` through the paragraph ending `Policy-driven equivalent in auto mode (above).`):

```markdown
# Specify — Decomposition Mode: Overlap Resolution

Loaded from `decomposition-mode.md`'s Step 1 Overlap Analysis (this skill's directory; #2841's
split). Read it only when that analysis classified at least one design-doc section as **Already
exists** or **Partial overlap** — a run whose every section is a **Gap** never loads it. "Above"
in this file means `decomposition-mode.md`'s Overlap Analysis coverage table and the open records
its Step 1 found.

---

```

- [ ] **Step 3: Replace each moved range in its parent with the pointer stub**

`shaping-mode-stamping.md` — delete lines 211-251 and put this in their place (keep the blank line after line 209's `Nothing to commit …` paragraph):

```markdown
**Split across two files (#2841).** Read-back verification and Actions Performed live in
`shaping-mode-readback.md`, this skill's directory. Once this record's write call above has run —
landed, been refused by the pre-write shape check, or failed — read `shaping-mode-readback.md` and
continue there; shaping mode ends in that file, not here.
```

Also in `shaping-mode-stamping.md` lines 3-4, change `the body-shape edit and preserved original
request there, the metadata block through Actions Performed here.` to `the body-shape edit and preserved original
request there, the metadata block through compose-then-write-once here; read-back verification and
Actions Performed continue in `shaping-mode-readback.md`.` (the sentence's remaining text is unchanged).

`shaping-mode.md` final paragraph (lines 144-147) — replace with:

```markdown
**Split across three files (#1346, #2841).** This file holds the record-body edit into spec shape, the
spec-shape template, and preserving the original request. The metadata block, scoring/stage-label
stamping, and compose-then-write-once live in `shaping-mode-stamping.md`, this skill's directory;
read-back verification and Actions Performed live in `shaping-mode-readback.md`, which that file
hands off to. Continue in `shaping-mode-stamping.md` now.
```

`next-mode.md` — keep line 278 (the heading) and line 279 (blank); replace lines 280-358 with:

```markdown
When Selection's `$PICK` (above) is `null`, or this firing's attempt counter (incremented once per
successful claim in `## Claim` below) reaches `--budget <n>`, the drain loop ends — read
`next-mode-closeout.md` in this skill's directory then, and follow it: the two zero-eligible cases,
budget exhaustion, the `{shaped: N, routed: M, failed: K}` close-out render, and the
`--source sweep` reporting rule all live there (#2841's split). Never read it on an iteration that
picked a record.
```

`spec-template.md` — keep line 180 (the heading) and 181 (blank); replace lines 182-212 with:

```markdown
When a spec's technical approach rests on an assumption about how an external system, harness, or tool actually behaves — an undocumented payload shape, an unconfirmed API contract, an assumed invocation path, or a third-party CLI/API's behavior — read `empirical-premise-check-deliverables.md` in this skill's directory and write the blocking "Task 0" deliverable it describes before any other deliverable's fixtures are written.
```

`decomposition-mode.md` — keep line 114 (`**For each item with overlap:**`) and 115 (blank); replace lines 116-151 with:

```markdown
Read `overlap-resolution.md` in this skill's directory and resolve every overlap per its Auto mode (policy lookup) or Interactive mode (batch per-overlap decisions) section — whichever this run's mode selects. Skip the read when every item is a **Gap**.
```

(line 153, `For **Gap** items, proceed directly to Step 2 …`, stays.)

- [ ] **Step 4: Prove nothing was dropped**

Write a scratch script (scratchpad directory, not committed) that, for each of the four splits, reads the saved original and the concatenation of parent + sibling, and prints every original line (exact string, blank lines ignored) absent from the concatenation's line set. Run it and save its raw output to `{scratch}/split-proof.txt`.

Expected output: **exactly** these original lines and no others — each is a line this plan deliberately re-worded, not a drop:
- `shaping-mode-stamping.md`: `request there, the metadata block through Actions Performed here. Loaded by`
- no lines for `next-mode.md`, `spec-template.md`, `decomposition-mode.md`

(`shaping-mode.md` is not one of the four splits; its trailer edit is the only change to it in this task.) If any other line prints, the move was not verbatim — fix the move, do not edit the expectation.

- [ ] **Step 5: Run the suite and repoint tests that read moved text by path**

Run: `npm test > {scratch}/npm-test-task1.txt 2>&1` (foreground, timeout at least 20 minutes), then read the `# pass` / `# fail` summary lines and every `not ok` block.

Each failure caused by the split is a test reading a parent file for text that now lives in the sibling. Fix by extending that test's read to include the sibling (same idiom the file already uses — for example `readFlat('…/next-mode.md') + ' ' + readFlat('…/next-mode-shape.md')` gains `+ ' ' + readFlat('plugin/skills/specify/next-mode-closeout.md')`), or by pointing a single-file read at the sibling when every assertion on it targets moved text. Never weaken or delete an assertion. Known read sites to check (from `git grep` on this branch): `tests/batch-ref-argument.test.js:58`, `tests/shaping-mode-needs-removal.test.js:15`, `tests/specify-near-duplicate-prose.test.js:21`, `tests/specify-parent-guard.test.js:90`, `tests/specify-range-form-readback.test.js:54`, `tests/specify-next-mode.test.js:31,33`, `tests/untrusted-record-content-conformance.test.js:90,106`, `tests/sweep-orchestrator.test.js:182`, `tests/review-risk-marker-verification.test.js:25`, `tests/specify-decomposition-collapse.test.js:16`, `tests/specify-decomposition-crossref-prose.test.js:20`. Update a test's explanatory comment when it names the old host file. Re-run the affected test files individually (`node --test tests/{file}.test.js`) until green.

- [ ] **Step 6: Repoint prose citations**

Run each grep (one Bash call each) over `plugin docs/skill-graph.md docs/plugin-structure.md docs/skill-authoring.md .claude/skills tools evals tests` and fix every hit that attributes a moved section to its old host file:

- `git grep -n -i -E "shaping-mode(-stamping)?\.md.{0,40}(read-back|Actions Performed)"`
- `git grep -n -i -E "(read-back verification|Actions Performed).{0,60}shaping-mode-stamping"`
- `git grep -n -E "Third-Party CLI/API Behavior Task 0|Auto mode \(policy lookup\)|Interactive mode \(batch per-overlap"`
- `git grep -n -F "next-mode.md"` restricted to `plugin/skills/specify/SKILL.md plugin/skills/sweep`

Known required edits:
- `docs/skill-graph.md:500` — `` `shaping-mode-stamping.md`'s Read-back verification `` becomes `` `shaping-mode-readback.md`'s Read-back verification ``.
- `plugin/skills/specify/SKILL.md:146` — `close-out counts reporting to the parent (`next-mode.md`)` becomes `close-out counts reporting to the parent (`next-mode-closeout.md`)`.
- `plugin/skills/specify/SKILL.md:122` — after the existing `` `shaping-mode-stamping.md` (#1346's split) `` clause's description of what that file holds, name `` `shaping-mode-readback.md` `` (#2841's split) as holding read-back verification and Actions Performed, only if that sentence currently attributes either to `shaping-mode-stamping.md`; read the sentence first and make the smallest accurate edit. Check `wc -c plugin/skills/specify/SKILL.md` stays under 40,960.
- `plugin/skills/specify/decomposition-mode-closeout.md:109` — `same convention as Step 1's Overlap Analysis` becomes `same convention as Step 1's Overlap Analysis (`overlap-resolution.md`)`.

Citations of a section **by a heading that stayed in the parent as a stub** (`next-mode.md`'s Zero eligible or budget exhausted section; `spec-template.md`'s Empirical Premise-Check Deliverables) still resolve and are left alone. Historical records (`docs/incident-log.md`, `docs/decisions/`, `docs/journeys/`, archived run dirs) are not rewritten.

- [ ] **Step 7: Update `docs/plugin-structure.md` and verify reachability and sizes**

In `docs/plugin-structure.md`'s `| specify |` row (line 93): add `shaping-mode-readback.md`, `next-mode-closeout.md`, `overlap-resolution.md`, `empirical-premise-check-deliverables.md` to the file list (each next to its parent), and extend the description minimally: the shaping pair becomes three files (`shaping-mode-readback.md` holds read-back verification and Actions Performed, split at the `### Read-back verification` boundary — #2841); `next-mode-closeout.md` holds the loop-termination + close-out section, read only when the drain loop ends (#2841); `overlap-resolution.md` holds Step 1 Overlap Analysis's Auto/Interactive resolution procedures, read only when an overlap exists (#2841); `empirical-premise-check-deliverables.md` holds the Task 0 guidance, loaded from `spec-template.md`'s stub the same way `gate-authoring-deliverables.md` is (#2841). Move the phrase attributing "read-back verification, and Actions Performed" away from `shaping-mode-stamping.md` accordingly.

Then verify (one call each):
- `git grep -n -F "shaping-mode-readback.md" -- plugin/skills/specify/shaping-mode-stamping.md` → at least 1 hit containing `read`
- `git grep -n -F "next-mode-closeout.md" -- plugin/skills/specify/next-mode.md` → at least 1 hit
- `git grep -n -F "empirical-premise-check-deliverables.md" -- plugin/skills/specify/spec-template.md` → at least 1 hit
- `git grep -n -F "overlap-resolution.md" -- plugin/skills/specify/decomposition-mode.md` → at least 1 hit
- `wc -c` on every `.md` file in `plugin/skills/specify` (name each file literally) → every sub-file other than `SKILL.md` at most 26,624; `SKILL.md` under 40,960.

- [ ] **Step 8: Full suite, then commit**

Run: `npm test > {scratch}/npm-test-task1-final.txt 2>&1`
Expected: `# fail 0`.

```bash
git add plugin/skills/specify docs/plugin-structure.md docs/skill-graph.md tests
git commit -m "Split four near-ceiling /specify sub-files into lazy-loaded siblings — verbatim moves, citations repointed (refs #2841)" -m "Claude-Session: https://claude.ai/code/session_015ZX5aJf9QxottoX6taiskk"
```

(Stage the specific files you changed by literal path if `git add` on a directory is refused; never `git add -A`.)

---

### Task 2: Judge "already shaped, no-op" by `compose-record.js --check`

**Files:**
- Create: `tests/specify-shaping-noop-check.test.js`
- Modify: `plugin/skills/specify/shaping-mode.md` (the paragraph beginning `Absorb the record's existing content`)

Also edits Task 1's new sibling, shaping-mode-readback.md in `plugin/skills/specify/` (the `For a comma-list batch, render one row per shaped element` paragraph under `### Actions Performed`).

**Interfaces:**
- Consumes: `plugin/bin/compose-record.js`'s exported `run(argv, deps)` — `run(['--check', file], { stdout, stderr })` returns `0` when the body is spec-shaped, `4` with gap lines on stderr when not, `2` on an unreadable file. `shaping-mode-readback.md` from Task 1.

The classification lives only in skill prose — no code path computes it — so this task pins the prose with a conformance test that fails if the instruction reverts to a by-eye judgment, and exercises the real checker in both directions. No new `plugin/bin` seam is added: nothing in the plugin would call it.

- [ ] **Step 1: Write the failing test**

Create `tests/specify-shaping-noop-check.test.js`:

```js
'use strict';
// #2841: shaping mode's "already shaped, no-op" outcome is the result of
// compose-record.js --check exiting 0 on the record's live body — never a by-eye
// "the sections look present" judgment (the judgment that let 110 of 126 ready
// records miss ## Release Note, #2827). The classification is prose-only, so this
// pins the prose and runs the real checker in both directions.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { run } = require('../plugin/bin/compose-record');

const readFlat = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8').replace(/\s+/g, ' ');
const SHAPING = readFlat('plugin/skills/specify/shaping-mode.md');
const READBACK = readFlat('plugin/skills/specify/shaping-mode-readback.md');

const NOOP = '`already shaped, no-op`';
const CHECK_CALL = 'node "${CLAUDE_PLUGIN_ROOT}/bin/compose-record.js" --check "$SPECIFY_SHAPED_BODY"';

const ACCEPTED = [
  '## Current State', '', 'The widget ignores the flag.', '',
  '## Deliverables', '', '1. Honor the flag.', '',
  '## Acceptance Criteria', '', '- [ ] The flag is honored.', '',
  '## Release Note', '', 'Fixed the widget ignoring its flag.', '',
].join('\n');
// Looks shaped by eye; lacks ## Release Note — the #2827 shape.
const REJECTED = ACCEPTED.slice(0, ACCEPTED.indexOf('## Release Note'));

function check(body) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shaping-noop-'));
  const file = path.join(dir, 'body.md');
  fs.writeFileSync(file, body);
  let stderr = '';
  const code = run(['--check', file], { stdout: () => {}, stderr: (s) => { stderr += s; } });
  fs.rmSync(dir, { recursive: true, force: true });
  return { code, stderr };
}

// The born-ready paragraph: from its opening words to the next bold-led paragraph.
function bornReadyParagraph() {
  const start = SHAPING.indexOf("Absorb the record's existing content");
  const end = SHAPING.indexOf('**Feedback-filing deliverable check.**');
  assert.ok(start >= 0 && end > start, 'born-ready paragraph not found in shaping-mode.md');
  return SHAPING.slice(start, end);
}

test('shaping-mode.md decides "already shaped" by running compose-record.js --check on the live body', () => {
  const para = bornReadyParagraph();
  assert.ok(para.includes(CHECK_CALL), 'the born-ready paragraph must run the --check call on the fetched body');
  assert.ok(para.includes('Exit 0'), 'exit 0 must be named as the already-shaped signal');
  assert.match(para, /Any non-zero exit[^.]*\.[^.]*never report it `already shaped, no-op`/, 'a rejected body must never be reported as a no-op');
  assert.ok(!para.includes('verify the sections are present and non-empty and move on'), 'the by-eye judgment must be gone');
});

test('Actions Performed defines the no-op outcome by the --check exit, not by eye', () => {
  const at = READBACK.indexOf(NOOP);
  assert.ok(at >= 0, 'no-op outcome token missing from shaping-mode-readback.md');
  const definition = READBACK.slice(at, READBACK.indexOf('`refused — proposed Absorb into', at));
  assert.ok(definition.includes('`compose-record.js --check` exited 0'), 'no-op must be defined as --check exiting 0 on the live body');
  assert.ok(definition.includes('never reported this way'), 'the definition must rule out a rejected body');
  assert.ok(!definition.includes('every section present and non-empty and every label family already stamped'), 'the by-eye definition must be gone');
});

test('a body --check accepts exits 0 — the only exit the prose maps to no-op', () => {
  const { code, stderr } = check(ACCEPTED);
  assert.equal(code, 0, stderr);
});

test('a body that only looks shaped is rejected with a non-zero exit — never a no-op', () => {
  const { code, stderr } = check(REJECTED);
  assert.equal(code, 4);
  assert.match(stderr, /missing section: ## Release Note/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/specify-shaping-noop-check.test.js`
Expected: FAIL — the two prose tests fail (`the born-ready paragraph must run the --check call…`, `no-op must be defined as --check exiting 0…`); the two checker tests pass.

- [ ] **Step 3: Edit the prose**

In `plugin/skills/specify/shaping-mode.md`, in the paragraph beginning `Absorb the record's existing content`, replace exactly

`needs near-zero translation: verify the sections are present and non-empty and move on rather than rewriting content that's already correct.`

with

``needs near-zero translation — but "already shaped" is never a by-eye judgment (#2841): write the record's fetched body, unmodified, to the session-tmp path Compose-then-write-once uses (`shaping-mode-stamping.md`'s `$SPECIFY_SHAPED_BODY`) and run `node "${CLAUDE_PLUGIN_ROOT}/bin/compose-record.js" --check "$SPECIFY_SHAPED_BODY"` on it. Exit 0 → the live body is already spec-shaped: move on rather than rewriting content that's already correct. Any non-zero exit → it is not, whatever it looks like: shape it through the sections below like any other record, and never report it `already shaped, no-op`.``

In `plugin/skills/specify/shaping-mode-readback.md`, in the `For a comma-list batch, render one row per shaped element` paragraph, replace exactly

``(every section present and non-empty and every label family already stamped — nothing written, nothing to undo)``

with

``(`compose-record.js --check` exited 0 on the record's live body — `shaping-mode.md`'s Edit the body into spec shape runs it — and every label family was already stamped: nothing written, nothing to undo; a body `--check` rejected is never reported this way)``

- [ ] **Step 4: Run tests to verify they pass, and check neighbours**

Run: `node --test tests/specify-shaping-noop-check.test.js`
Expected: PASS (4 tests).

Run: `node --test tests/batch-ref-argument.test.js` and `node --test tests/skill-prose-plugin-root-invocations.test.js`
Expected: PASS (the outcome token `already shaped, no-op` is unchanged; the new call uses the `${CLAUDE_PLUGIN_ROOT}` form).

Run: `wc -c plugin/skills/specify/shaping-mode.md plugin/skills/specify/shaping-mode-readback.md` — both at most 26,624.

- [ ] **Step 5: Prove the test discriminates (scratch, not committed)**

Temporarily restore the old readback wording (`git show HEAD:plugin/skills/specify/shaping-mode-readback.md` shows it), run `node --test tests/specify-shaping-noop-check.test.js`, confirm the Actions Performed test goes red, then re-apply Step 3's edit and confirm green. Save both raw outputs to the scratchpad and quote them in your report.

- [ ] **Step 6: Commit**

```bash
git add tests/specify-shaping-noop-check.test.js plugin/skills/specify/shaping-mode.md plugin/skills/specify/shaping-mode-readback.md
git commit -m "Judge shaping no-ops by compose-record.js --check — exit 0 on the live body, never by eye (refs #2841)" -m "Claude-Session: https://claude.ai/code/session_015ZX5aJf9QxottoX6taiskk"
```

---

### Task 3: Pin the local-files driver's pre-write `--check`

**Files:**
- Modify: `tests/specify-shaping-template-required-sections.test.js` (append one test, mirroring the existing github-issues one)

**Interfaces:**
- Consumes: `plugin/skills/specify/shaping-mode-stamping.md`'s `**`work-backend: local-files`:** write `$SHAPED_BODY` …` paragraph under `### Compose-then-write-once` (unchanged by Tasks 1-2).

The prose already exists, so this test passes on first run; Step 3 is what proves it can go red.

- [ ] **Step 1: Append the test**

Append to `tests/specify-shaping-template-required-sections.test.js`:

```js

test('shaping-mode-stamping.md runs compose-record.js --check before the local-files writeRecord', () => {
  const src = read('plugin/skills/specify/shaping-mode-stamping.md');
  const para = src.split('\n').find((l) => l.startsWith('**`work-backend: local-files`:** write `$SHAPED_BODY`'));
  assert.ok(para, 'local-files compose-then-write-once paragraph missing');
  const checkAt = para.indexOf('run the same `compose-record.js --check` first');
  const writeAt = para.indexOf('`writeRecord` call');
  assert.ok(checkAt >= 0, 'local-files pre-write --check line missing');
  assert.ok(writeAt > checkAt, 'the --check must come before the writeRecord call');
  // "same exit handling" binds this driver to the github-issues fence's rule: any non-zero exit writes nothing.
  assert.match(para.slice(checkAt, writeAt), /same exit handling/, 'local-files --check must reuse the github-issues exit handling');
});
```

- [ ] **Step 2: Run it**

Run: `node --test tests/specify-shaping-template-required-sections.test.js`
Expected: PASS (4 tests).

- [ ] **Step 3: Prove discrimination (scratch — never commit the broken state)**

In `plugin/skills/specify/shaping-mode-stamping.md`, temporarily change `write `$SHAPED_BODY` to that same session-tmp path and run the same `compose-record.js --check` first, same exit handling; then one `writeRecord` call` to `write `$SHAPED_BODY` to that same session-tmp path; then one `writeRecord` call`. Run `node --test tests/specify-shaping-template-required-sections.test.js > {scratch}/task3-red.txt 2>&1` — Expected: the new test FAILS with `local-files pre-write --check line missing`. Restore the file with `git checkout -- plugin/skills/specify/shaping-mode-stamping.md`, confirm `git status --short` shows only the test file modified, re-run — Expected: PASS. Quote both raw outputs in your report.

- [ ] **Step 4: Commit**

```bash
git add tests/specify-shaping-template-required-sections.test.js
git commit -m "Pin the local-files pre-write --check in shaping mode — conformance test mirroring the github-issues fence (refs #2841)" -m "Claude-Session: https://claude.ai/code/session_015ZX5aJf9QxottoX6taiskk"
```
