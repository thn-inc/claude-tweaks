# #2697 — Split /demo and /feedback mode bodies into lazily-loaded sub-files — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a `/claude-tweaks:demo` or `/claude-tweaks:feedback` invocation load only the procedure text its resolved branch can execute, by moving each mutually-exclusive branch body out of `SKILL.md` into its own sub-file that the routing stub reads only under that branch's condition — a pure load-time restructuring with every behavior unchanged.

**Architecture:** Follow #89's precedent (`backlog/`, `tidy/`, `specify/`, `dispatch/` — `SKILL.md` is a routing stub that says "read `{file}.md` in this skill's directory" under the matching condition; the branch body lives verbatim in that file). Five extractions: three from `demo/SKILL.md` (the browser-verdict path, the design-contract section, the follow-up-record filing procedure) and two from `feedback/SKILL.md` (the bare-invocation umbrella, the `--pre-confirmed` path). Every moved block is a byte-for-byte cut — a scratch line-preservation check proves nothing was dropped — and the prose-conformance tests that pin moved text are re-pointed at the new file, with their go-red probes left on the path the literal was absent from pre-change.

**Tech Stack:** Markdown skill files (`plugin/skills/**`), `node --test` prose-conformance suites (`tests/*.test.js`), git.

**Spec:** `.claude-tweaks/pipelines/2026-09-21T213441-spec-2697-2757-2758-2759/spec-2697/work/2697-spec.md`

## Global Constraints

- Every existing `/demo` and `/feedback` behavior is unchanged — this is a load-time restructuring, not a behavior change; every mode still works identically once its sub-file is loaded (spec, Acceptance Criteria).
- Verify each mode's full procedure text lands intact in its own sub-file with nothing dropped or altered in the split (spec, Gotchas) — moved blocks are verbatim, and Task 7's line-preservation check must print `all pre-split lines present` for both skills.
- Content genuinely shared across modes (the Anti-Patterns table, the Component-Skill Contract, Input, When to Use, Next Actions) stays in the routing `SKILL.md`, never duplicated per sub-file (spec, Gotchas; `docs/skill-authoring.md`'s Component-skill contract placement rule).
- A skill reference inside actionable instruction text uses the fully-qualified `/claude-tweaks:{skill}` form (CLAUDE.md, Cross-references) — moved text already complies; stubs must too.
- 40 KB per `plugin/skills/**/*.md` file is the warning tier (`docs/skill-authoring.md`); neither `SKILL.md` nor any new sub-file may exceed it. Pre-split sizes: `demo/SKILL.md` 35,407 bytes, `feedback/SKILL.md` 35,525 bytes.
- Premise correction (spec's `[IL-71]` re-verification, `flow/materialize.md`'s named-location drift rule): the record's Acceptance Criteria name `/demo` `explore`/`live` modes. **No such modes exist** in `plugin/skills/demo/SKILL.md` at this base (`6d0f768a4`) — its entry paths are already split (`entry-paths.md`, no-arguments vs `#N`). The mutually-exclusive bodies that *do* exist in `/demo` are the ones this plan extracts: the browser verdict (only `rendered-page`/`app-route` plans with browser tools), the design-contract section (only when a contract resolves or parses malformed), and the follow-up-record filing (only on a Request-changes verdict or a scope-fork capture). Build's Common Step 4.5 records this as an "Update the spec" deviation.
- Commit message style: `{Verb} {what} — {detail}`, ending with `Claude-Session: https://claude.ai/code/session_01RiCXcUa95YrY58fczMQxhj`.
- Worktree Bash guard (this session is worktree-isolated): one plain command per Bash call; no heredocs, no `$(...)` feeding git, no output redirection to a path outside the worktree; the bare argv word `complete` is refused. Author files with the Write tool.
- **Three pre-existing failures** in the suites this plan runs, present at the base commit before any task (run ledger item #2, batch pre-flight sweep) — every "Expected: ... pass" below reads "pass except these three": `tests/demo-full-verification-pointer.test.js` › `observation-plan.md declares Full verification with Parent/Pending/Then, inside the Schema fence` (Schema fenced block not found); `tests/demo-visual-decision-adoption.test.js` › `docs cross-references: skill-graph.md ## demo table gains a _shared/visual-decision.md row`; `tests/help-acceptance-queue-local-files.test.js` › `Stage 4.7: every embedded node -e script is syntactically valid`. None reads `demo/SKILL.md` or `feedback/SKILL.md`; do not fix them in this build (surgical-change rule) — a fourth failure in any of these files is a regression.

---

## File Structure

| File | Responsibility |
|---|---|
| `plugin/skills/demo/SKILL.md` (modify) | Routing stub: frontmatter, When to Use, Input, Step 1 pointer, Step 2's shared walkthrough (design-contract *pointer*, Show-first, Verdict *terminal fallback* + browser-verdict *pointer*, Compatibility, Scope-fork, Task-anchor), Step 3's label swaps + follow-up *pointer*, Next Actions, Component-Skill Contract, Anti-Patterns |
| `plugin/skills/demo/browser-verdict.md` (create) | Step 2 Verdict's browser-verdict path, verbatim (old lines 202-242) |
| `plugin/skills/demo/design-contract-section.md` (create) | Step 2's "The design contract this was built against" rendering rules, verbatim (old lines 99-138) |
| `plugin/skills/demo/follow-up-record.md` (create) | Step 3's Request-changes items 2-3 (both drivers), verbatim (old lines 318-343) |
| `plugin/skills/feedback/SKILL.md` (modify) | Routing stub: Step 0 condition + pointer, Steps 1-9 with Step 7's `--pre-confirmed` block and Step 8's item 5 replaced by pointers, Next Actions, Component-Skill Contract, Anti-Patterns |
| `plugin/skills/feedback/bare-invocation.md` (create) | Step 0's two gathers, merging, interaction budget, and the #239 rationale, verbatim (old lines 55-118) |
| `plugin/skills/feedback/pre-confirmed.md` (create) | Step 7's `--pre-confirmed` two-check block (old lines 375-396) and Step 8's item 5 cleanup-on-success (old lines 480-488), verbatim |
| `tests/skill-mode-split-conformance.test.js` (create) | Pins: each sub-file exists, carries its H1 and a body literal; `SKILL.md` cites it and no longer carries the body literal; both `SKILL.md`s stay under 30 KB |
| `tests/demo-visual-decision-adoption.test.js` (modify) | Verdict-section assertions read `browser-verdict.md`; go-red probes stay on `SKILL.md` |
| `tests/visual-decision-contract-conformance.test.js` (modify) | The demo no-event-literal check also covers `browser-verdict.md` |
| `plugin/skills/_shared/visual-decision.md` (modify) | Consumers row for demo names the sub-file the Verdict step routes to (the `plugin/skills/demo/SKILL.md` literal `tests/demo-visual-decision-adoption.test.js` pins stays) |
| `docs/plugin-structure.md` (modify) | `demo` and `feedback` rows of the per-skill sub-file table list the new files |

Line numbers above refer to the pre-split files at base commit `6d0f768a4` (`git show 6d0f768a4:plugin/skills/demo/SKILL.md`). Read the file at HEAD before each cut; earlier tasks in this plan shift later line numbers.

---

### Task 1: Conformance test (written first, red across the board)

**Files:**
- Create: `tests/skill-mode-split-conformance.test.js`

**Interfaces:**
- Produces: the `SPLITS` table below — every later task must create exactly the `sub` file with exactly the `heading` H1 line, keep the `bodyLiteral` inside it, cite `cite` from `SKILL.md`, and remove `bodyLiteral` from `SKILL.md`.

- [ ] **Step 1: Write the failing test**

```js
'use strict';
// tests/skill-mode-split-conformance.test.js — #2697: /demo and /feedback load only
// the branch they resolve. Pins that each extracted branch body lives in its own
// sub-file (H1 + one distinctive body literal), that SKILL.md routes to it by file
// name, and that SKILL.md no longer carries the body itself. Read live, not frozen:
// this is just-shipped prose expected to evolve in place; the discrimination proof is
// structural — pre-#2697 none of the sub-files existed, so every row was red.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

// Byte ceiling both routing stubs must stay under after the split. Pre-split they were
// 35,407 (demo) and 35,525 (feedback) bytes; the five extractions remove ~8-10 KB each.
// 30 KB is a regression guard against the bodies silently drifting back inline, not a
// tuned budget — the per-file warning tier is 40 KB (docs/skill-authoring.md).
const STUB_CEILING_BYTES = 30 * 1024;

const SPLITS = [
  {
    skill: 'demo',
    sub: 'browser-verdict.md',
    heading: '# Demo Step 2 — Browser Verdict',
    bodyLiteral: 'Compose a single-variant `layout`-scope',
  },
  {
    skill: 'demo',
    sub: 'design-contract-section.md',
    heading: '# Demo Step 2 — The Design Contract Section',
    bodyLiteral: 'five blocks reproduced **verbatim**',
  },
  {
    skill: 'demo',
    sub: 'follow-up-record.md',
    heading: '# Demo Step 3 — Filing the Follow-Up Record',
    bodyLiteral: 'Never `allocateId`+`writeRecord`',
  },
  {
    skill: 'feedback',
    sub: 'bare-invocation.md',
    heading: '# Feedback Step 0 — Bare-Invocation Umbrella',
    bodyLiteral: 'gh issue list --label upstream-candidate',
  },
  {
    skill: 'feedback',
    sub: 'pre-confirmed.md',
    heading: '# Feedback — The `--pre-confirmed` Path',
    bodyLiteral: 'compare it, byte-for-byte, against the approved snapshot',
  },
];

for (const s of SPLITS) {
  test(`${s.skill}/${s.sub} carries the extracted body; ${s.skill}/SKILL.md routes to it and no longer restates it`, () => {
    const subPath = `plugin/skills/${s.skill}/${s.sub}`;
    const skillPath = `plugin/skills/${s.skill}/SKILL.md`;
    const sub = read(subPath);
    const skill = read(skillPath);
    assert.ok(sub.startsWith(`${s.heading}\n`), `${subPath} must open with the H1 line ${JSON.stringify(s.heading)}`);
    assert.ok(sub.includes(s.bodyLiteral), `${subPath} must carry the moved body (literal ${JSON.stringify(s.bodyLiteral)})`);
    assert.ok(skill.includes(`\`${s.sub}\``), `${skillPath} must cite \`${s.sub}\` so the branch is loaded by file name`);
    assert.equal(skill.includes(s.bodyLiteral), false, `${skillPath} still carries the moved body — the extraction is a move, not a copy`);
  });
}

for (const skill of ['demo', 'feedback']) {
  test(`${skill}/SKILL.md stays under the post-split stub ceiling`, () => {
    const bytes = Buffer.byteLength(read(`plugin/skills/${skill}/SKILL.md`), 'utf8');
    assert.ok(bytes < STUB_CEILING_BYTES, `plugin/skills/${skill}/SKILL.md is ${bytes} bytes — expected under ${STUB_CEILING_BYTES}`);
  });
}
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test tests/skill-mode-split-conformance.test.js`
Expected: FAIL — 7 tests, 7 failures. The five `SPLITS` tests fail with `ENOENT` on the missing sub-file; the two ceiling tests fail with `35407 bytes` / `35525 bytes`.

- [ ] **Step 3: Commit**

```bash
git add tests/skill-mode-split-conformance.test.js
```
```bash
git commit -m "Add mode-split conformance test for demo and feedback — red until #2697's five extractions land" -m "Claude-Session: https://claude.ai/code/session_01RiCXcUa95YrY58fczMQxhj"
```

---

### Task 2: demo — extract the browser-verdict path

**Files:**
- Create: `plugin/skills/demo/browser-verdict.md`
- Modify: `plugin/skills/demo/SKILL.md` (the `### Verdict` subsection, old lines 200-251)
- Modify: `plugin/skills/_shared/visual-decision.md` (the `## Consumers` table's demo row)
- Modify: `tests/demo-visual-decision-adoption.test.js`
- Modify: `tests/visual-decision-contract-conformance.test.js`
- Test: `tests/skill-mode-split-conformance.test.js`, `tests/demo-visual-decision-adoption.test.js`, `tests/visual-decision-contract-conformance.test.js`, `tests/demo-full-verification-pointer.test.js`

**Interfaces:**
- Consumes: Task 1's row `{ sub: 'browser-verdict.md', heading: '# Demo Step 2 — Browser Verdict', bodyLiteral: 'Compose a single-variant `layout`-scope' }`.
- Produces: `plugin/skills/demo/browser-verdict.md`; `SKILL.md`'s `### Verdict` keeps the terminal `AskUserQuestion` fallback inline.

- [ ] **Step 1: Read the block to move**

Run: `git show 6d0f768a4:plugin/skills/demo/SKILL.md`
Locate the block from the line beginning `**Browser verdict (optional, \`rendered-page\`/\`app-route\` only):**` (old line 202) through the line ending `requires of every consumer.` (old line 242 — the end of the `**No auto-mode path reaches this.**` paragraph). That block — 41 lines, five paragraphs plus the six-bullet resume list — is the body to move, byte-for-byte.

- [ ] **Step 2: Create `plugin/skills/demo/browser-verdict.md`**

Use the Write tool. Contents: the header below, then the block from Step 1 pasted verbatim (no rewording, no re-wrapping, no reordering — the resume bullets, the `Stop the server (...)` paragraph and the `**No auto-mode path reaches this.**` paragraph included, in that order).

```markdown
# Demo Step 2 — Browser Verdict

Referenced by `skills/demo/SKILL.md` Step 2's `### Verdict` subsection. Read only when this
record's Observation plan is a `rendered-page`/`app-route` surface **and** browser tools resolve
— a `cli`/`flow`/`diff` plan, or a run with no browser tools, goes straight to `SKILL.md`'s
terminal question and never reads this file. Follows `_shared/visual-decision.md`'s contract —
cited here, never restated.

{old lines 202-242, verbatim}
```

- [ ] **Step 3: Replace the block in `SKILL.md` with the routing pointer**

In `plugin/skills/demo/SKILL.md`, delete old lines 202-243 (the moved block plus the blank line after it) and put this paragraph in their place, directly under the `### Verdict` heading's blank line and above the `**Fallback — terminal \`AskUserQuestion\`...` paragraph:

```markdown
**Browser verdict (optional, `rendered-page`/`app-route` only):** applies only to the URL surfaces
Validate above already gates on, and only when browser tools resolve (the same gate Validate uses
— unavailable → skip straight to the terminal question below, no error). When both hold, read
`browser-verdict.md` in this skill's directory and follow it — it composes the recap-page manifest,
runs the `_shared/visual-decision.md` turn loop, maps each event to a verdict outcome (a Pick
**replaces** the terminal question; an Exit **falls back** to it with Approve omitted; everything
else falls back unchanged), and stops the server on every exit path. A `cli`/`flow`/`diff` plan
never reads it. No auto-mode path reaches this — `/claude-tweaks:demo` is standalone-only
(`## Component-Skill Contract` below).
```

The `**Fallback — terminal \`AskUserQuestion\`, reused every round ...**` paragraph and its three options stay exactly as they were.

- [ ] **Step 4: Update the `_shared/visual-decision.md` Consumers row**

Run: `grep -n "plugin/skills/demo/SKILL.md" plugin/skills/_shared/visual-decision.md`
That row (line 108 at base) begins `` | `plugin/skills/demo/SKILL.md` (Verdict, `rendered-page`/`app-route` records only) | ``. Keep the `` `plugin/skills/demo/SKILL.md` `` literal (a test pins it) and change the parenthetical to `` (Verdict — routes to `demo/browser-verdict.md`; `rendered-page`/`app-route` records only) ``. Change nothing else in the row.

- [ ] **Step 5: Re-point `tests/demo-visual-decision-adoption.test.js`**

Add, after `const DEMO_SKILL_PATH = 'plugin/skills/demo/SKILL.md';`:

```js
// #2697 moved the browser-verdict body out of SKILL.md into this sub-file (SKILL.md keeps
// a routing pointer). The go-red probes below still target DEMO_SKILL_PATH: that is the
// file each literal was absent from at PRE_CHANGE_SHA, which is what proves discrimination.
const BROWSER_VERDICT_PATH = 'plugin/skills/demo/browser-verdict.md';
```
and after `const demoSkill = ...`:
```js
const browserVerdict = fs.readFileSync(path.join(ROOT, BROWSER_VERDICT_PATH), 'utf8');
```

Then change these assertions (leave every `countAtPreChangeOrSkip(t, DEMO_SKILL_PATH, ...)` call untouched):

1. Test `#1208 AC1/AC3: demo/SKILL.md cites the contract and never restates the event JSON shapes` — keep the `demoSkill` assertions and add the same three checks for `browserVerdict` (cites `_shared/visual-decision.md`; none of the five `"type":"…"` literals; at least one citation).
2. Test `#1208 AC1: demo/SKILL.md documents pick-replaces / ...` — compute `verdictIdx`/`verdictSection` from `browserVerdict` instead of `demoSkill`, using `browserVerdict.indexOf('**Browser verdict (optional')` as the start (the sub-file has no `### Verdict` heading).
3. Test `#1208 AC1: demo/SKILL.md gates the browser round ...` — assert both regexes against `browserVerdict`, and additionally `assert.match(demoSkill, /`rendered-page`\/`app-route` only.*applies only to the URL surfaces/s)` (the pointer keeps the gate visible in the stub).
4. Test `#1208 AC1: demo/SKILL.md documents lifecycle stop on every exit path ...` — assert the three regexes against `browserVerdict`.
5. Test `CRITICAL gotcha: demo/SKILL.md explicitly states no auto-mode path ...` — assert `/No auto-mode path reaches this/` against `demoSkill` **and** `browserVerdict`; assert ``/never invoked from within an `auto`-mode pipeline/`` against `browserVerdict`.

Rename each affected test title's `demo/SKILL.md` to `demo/browser-verdict.md` where the now-assertion moved.

- [ ] **Step 6: Extend `tests/visual-decision-contract-conformance.test.js`**

Add `const DEMO_BROWSER_VERDICT = path.join(__dirname, '..', 'plugin', 'skills', 'demo', 'browser-verdict.md');` next to `const DEMO = ...`, and inside the test `#1208 AC3: demo/SKILL.md cites the contract and never restates the event JSON shapes` read `readNonTombstone(DEMO_BROWSER_VERDICT)` too and run the identical citation + no-literal assertions over it.

- [ ] **Step 7: Run the tests**

Run: `node --test tests/skill-mode-split-conformance.test.js tests/demo-visual-decision-adoption.test.js tests/visual-decision-contract-conformance.test.js tests/demo-full-verification-pointer.test.js`
Expected: `skill-mode-split-conformance` — the `demo/browser-verdict.md` row passes; the other four `SPLITS` rows still fail (ENOENT); `demo/SKILL.md stays under...` still fails (~31.9 KB); every test in the other three files passes.

- [ ] **Step 8: Commit**

```bash
git add plugin/skills/demo/browser-verdict.md plugin/skills/demo/SKILL.md plugin/skills/_shared/visual-decision.md tests/demo-visual-decision-adoption.test.js tests/visual-decision-contract-conformance.test.js
```
```bash
git commit -m "Extract demo's browser-verdict path into browser-verdict.md — loaded only for URL surfaces with browser tools" -m "Claude-Session: https://claude.ai/code/session_01RiCXcUa95YrY58fczMQxhj"
```

---

### Task 3: demo — extract the design-contract section

**Files:**
- Create: `plugin/skills/demo/design-contract-section.md`
- Modify: `plugin/skills/demo/SKILL.md` (the `### The design contract this was built against` subsection)
- Test: `tests/skill-mode-split-conformance.test.js`, `tests/demo-full-verification-pointer.test.js`, `tests/bin-lib/skill-audit/anti-patterns.test.js`

**Interfaces:**
- Consumes: Task 1's row `{ sub: 'design-contract-section.md', heading: '# Demo Step 2 — The Design Contract Section', bodyLiteral: 'five blocks reproduced **verbatim**' }`.
- Produces: `plugin/skills/demo/design-contract-section.md`; the three design-contract Anti-Patterns rows stay in `SKILL.md` (the `anti-patterns.test.js` row ledger is count-neutral).

- [ ] **Step 1: Read the block to move**

Run: `git show 6d0f768a4:plugin/skills/demo/SKILL.md`
The subsection runs from the heading `### The design contract this was built against` (old line 97) to the paragraph ending `puts the promise in front of a human and asks them.` (old line 138). Move the **body** — old lines 99-138, the six paragraphs after the heading's blank line — verbatim. The heading itself stays in `SKILL.md`.

- [ ] **Step 2: Create `plugin/skills/demo/design-contract-section.md`**

Use the Write tool:

```markdown
# Demo Step 2 — The Design Contract Section

Referenced by `skills/demo/SKILL.md` Step 2's `### The design contract this was built against`
subsection. Read only after `../_shared/design-contract.md`'s locate-and-parse procedure has run
over Step 1's changed-path list **and** it resolved a contract or reported one malformed — when
nothing resolves, `SKILL.md` renders nothing and never reads this file.

{old lines 99-138, verbatim}
```

- [ ] **Step 3: Replace the body in `SKILL.md` with the routing pointer**

Under the `### The design contract this was built against` heading, delete old lines 99-138 and put this in their place (keep the blank line after the heading and one before `### Show-first walkthrough`):

```markdown
Run the locate-and-parse procedure in `../_shared/design-contract.md` over the changed-path list
Step 1 already produced — the closing commit's `--name-only` list, the label-backed brief's paths,
or session recall's own list. Do not go looking for files beyond it. **When no contract resolves,**
render nothing — no heading, no empty section, no "not found" note. **When a contract resolves, or
the parse reports one malformed,** read `design-contract-section.md` in this skill's directory and
follow it: it renders the five blocks verbatim under this heading with the `Design-seed:` line, or
— for the malformed case — omits the section and leaves the one plain-line trace above the verdict.
This section never becomes a reason to block.
```

- [ ] **Step 4: Run the tests**

Run: `node --test tests/skill-mode-split-conformance.test.js tests/demo-full-verification-pointer.test.js tests/bin-lib/skill-audit/anti-patterns.test.js`
Expected: `design-contract-section.md` row passes (three `SPLITS` rows still ENOENT, `demo` ceiling test now passes — the stub is ~28.7 KB — `feedback` ceiling still fails); `demo-full-verification-pointer` all pass (Show → Verdict ordering and the `as if the slice were the feature` row are untouched); `anti-patterns.test.js` passes — the row ledger is unchanged because no `## Anti-Patterns` row moved.

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/demo/design-contract-section.md plugin/skills/demo/SKILL.md
```
```bash
git commit -m "Extract demo's design-contract rendering into design-contract-section.md — loaded only when a contract resolves" -m "Claude-Session: https://claude.ai/code/session_01RiCXcUa95YrY58fczMQxhj"
```

---

### Task 4: demo — extract the follow-up-record filing procedure

**Files:**
- Create: `plugin/skills/demo/follow-up-record.md`
- Modify: `plugin/skills/demo/SKILL.md` (Step 3's `**Request changes**` bullet, items 2-3)
- Test: `tests/skill-mode-split-conformance.test.js`, `tests/batch-ref-argument.test.js`, `tests/help-acceptance-queue-local-files.test.js`

**Interfaces:**
- Consumes: Task 1's row `{ sub: 'follow-up-record.md', heading: '# Demo Step 3 — Filing the Follow-Up Record', bodyLiteral: 'Never `allocateId`+`writeRecord`' }`.
- Produces: `plugin/skills/demo/follow-up-record.md`, cited from Step 3's label-backed Request-changes bullet, Step 3's session-recall Request-changes bullet, and the Scope-fork checkpoint's "Capture it" paragraph.

- [ ] **Step 1: Read the block to move**

Run: `git show 6d0f768a4:plugin/skills/demo/SKILL.md`
Inside `## Step 3: Apply verdicts`, the `- **Request changes** — prompt for a short reason inline, then:` bullet has three numbered items. Item 1 (the label swap / `facets.acceptance` write, old line 317) stays. Items 2 and 3 — old lines 318-343, from `  2. File a linked follow-up record:` through `the original record's body instead, via the same \`readRecord\`/\`writeRecord\` round trip.` — move verbatim, indentation and numbering included.

- [ ] **Step 2: Create `plugin/skills/demo/follow-up-record.md`**

Use the Write tool:

```markdown
# Demo Step 3 — Filing the Follow-Up Record

Referenced by `skills/demo/SKILL.md` Step 3 (both the label-backed and the session-recall
**Request changes** branches) and Step 2's Scope-fork checkpoint ("Capture it"). Read only when a
Request-changes verdict was given or a scope-fork capture was chosen — an Approve or Skip verdict
never reads this file. Step 3's Request-changes items 2 and 3, verbatim (item 1, the label swap,
stays in `SKILL.md`); a session-recall entry runs the same procedure with no original record to
relabel, comment on, or reference, and its `Origin:` line reads `Origin: demo changes-requested
from session recall`; a scope-fork capture's `Origin:` line reads `Origin: demo scope-fork from
#{n}` (or `from session recall`).

{old lines 318-343, verbatim}
```

- [ ] **Step 3: Replace items 2-3 in `SKILL.md` with the routing pointer**

Delete old lines 318-343 and put this single item in their place (same two-space indentation as item 1):

```markdown
  2. File a linked follow-up record and note the bidirectional link back on the original — read
     `follow-up-record.md` in this skill's directory and follow its items 2 and 3 (both drivers:
     `recordPayload` under `work-backend: github-issues`, `createRecord`+`deriveSlug` under
     `local-files`, the `Origin: demo changes-requested from #{n}` provenance line).
```

The session-recall `**Request changes**` bullet (old lines 353-359) and the Scope-fork "Capture it" paragraph (old lines 275-280) stay as written — both already say "the same follow-up-record mechanism"; append to each, at the end of its existing sentence about the mechanism, the words `(\`follow-up-record.md\` in this skill's directory)` so all three call sites name the file.

- [ ] **Step 4: Run the tests**

Run: `node --test tests/skill-mode-split-conformance.test.js tests/batch-ref-argument.test.js tests/help-acceptance-queue-local-files.test.js`
Expected: `follow-up-record.md` row passes (two feedback `SPLITS` rows still ENOENT; `feedback` ceiling still fails); the other two files all pass (they pin `## Input` and `## When to Use`, untouched).

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/demo/follow-up-record.md plugin/skills/demo/SKILL.md
```
```bash
git commit -m "Extract demo's follow-up-record filing into follow-up-record.md — loaded only on a Request-changes verdict or scope-fork capture" -m "Claude-Session: https://claude.ai/code/session_01RiCXcUa95YrY58fczMQxhj"
```

---

### Task 5: feedback — extract the bare-invocation umbrella

**Files:**
- Create: `plugin/skills/feedback/bare-invocation.md`
- Modify: `plugin/skills/feedback/SKILL.md` (`### Step 0: Bare-invocation umbrella (queue check + session evaluation)`)
- Test: `tests/skill-mode-split-conformance.test.js`, `tests/feedback-dedup-search-scrub-conformance.test.js`, `tests/tidy-unfiled-backstop.test.js`

**Interfaces:**
- Consumes: Task 1's row `{ sub: 'bare-invocation.md', heading: '# Feedback Step 0 — Bare-Invocation Umbrella', bodyLiteral: 'gh issue list --label upstream-candidate' }`.
- Produces: `plugin/skills/feedback/bare-invocation.md`; `SKILL.md` keeps Step 0's heading, its trigger sentence, and the two exclusions (free-text runs neither gather; `--pre-confirmed` never runs them).

- [ ] **Step 1: Read the block to move**

Run: `git show 6d0f768a4:plugin/skills/feedback/SKILL.md`
Step 0 spans old lines 47-118. Its first paragraph (old lines 49-53, `When \`$ARGUMENTS\` carries no free-text learning ... processes only its caller-supplied staged item(s).`) is the routing rule and stays. Everything after it — old lines 55-118: `**Gather 1 — local upstream-candidate queue (unchanged).**` through the paragraph ending `run.` (`...a \`gh issue list\` a human has to remember to run.`) — moves verbatim.

- [ ] **Step 2: Create `plugin/skills/feedback/bare-invocation.md`**

Use the Write tool:

```markdown
# Feedback Step 0 — Bare-Invocation Umbrella

Referenced by `skills/feedback/SKILL.md` Step 0. Read only on bare invocation — `$ARGUMENTS`
carries no free-text learning, or `--queue` was passed. A free-text invocation runs the
single-learning path (Steps 1-9) and never reads this file; a `--pre-confirmed` invocation never
reads it either — it processes only its caller-supplied staged item(s). Step 0's two gathers, the
merge rule, and the interaction budget, verbatim.

{old lines 55-118, verbatim}
```

- [ ] **Step 3: Replace the body in `SKILL.md` with the routing pointer**

Keep old lines 47-53 (heading, blank, the trigger paragraph). Delete old lines 54-118 and put this in their place, followed by one blank line before `### Step 1: Gather`:

```markdown
On bare invocation, read `bare-invocation.md` in this skill's directory and follow it: Gather 1
(the local `upstream-candidate` queue), Gather 2 (`session-evaluation.md`'s judge dispatch, with
its Skip check), the merge-by-concatenation rule that feeds one batch through Steps 1-6
non-interactively and then `_shared/upstream-feedback-batch.md`'s shared batch contract once, the
per-item "stop" scoping, and the one-confirmation interaction budget. Neither gather produced
anything → proceed to Step 1 as usual (gather from the conversation, or ask).
```

- [ ] **Step 4: Run the tests**

Run: `node --test tests/skill-mode-split-conformance.test.js tests/feedback-dedup-search-scrub-conformance.test.js tests/tidy-unfiled-backstop.test.js`
Expected: `bare-invocation.md` row passes (`pre-confirmed.md` row still ENOENT; `feedback` ceiling test now passes at ~30.3 KB → if it still fails by a few hundred bytes, that is expected until Task 6 lands and is the only remaining red); `feedback-dedup-search-scrub-conformance` (Step 4) and `tidy-unfiled-backstop` (Step 1) all pass.

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/feedback/bare-invocation.md plugin/skills/feedback/SKILL.md
```
```bash
git commit -m "Extract feedback's bare-invocation umbrella into bare-invocation.md — loaded only on bare or --queue invocation" -m "Claude-Session: https://claude.ai/code/session_01RiCXcUa95YrY58fczMQxhj"
```

---

### Task 6: feedback — extract the `--pre-confirmed` path

**Files:**
- Create: `plugin/skills/feedback/pre-confirmed.md`
- Modify: `plugin/skills/feedback/SKILL.md` (Step 7's `**\`--pre-confirmed\`:**` block; Step 8's item 5)
- Test: `tests/skill-mode-split-conformance.test.js`, `tests/frontier-unattended-literal.test.js`, `tests/bin-lib/skill-audit/anti-patterns.test.js`

**Interfaces:**
- Consumes: Task 1's row `{ sub: 'pre-confirmed.md', heading: '# Feedback — The `--pre-confirmed` Path', bodyLiteral: 'compare it, byte-for-byte, against the approved snapshot' }`.
- Produces: `plugin/skills/feedback/pre-confirmed.md`, cited from Step 7 and Step 8 item 5. The `<!-- HARD-GATE: feedback-scrub -->` and `<!-- HARD-GATE: feedback-confirm -->` markers and the Component-Skill Contract's `--pre-confirmed` legitimacy paragraph stay in `SKILL.md`.

- [ ] **Step 1: Read the two blocks to move**

Run: `git show 6d0f768a4:plugin/skills/feedback/SKILL.md`
Block A — Step 7, old lines 375-396: from `**\`--pre-confirmed\`:** the caller passes both the item's staged-file path` through `post-scrub content directly.` (the two numbered checks and the closing "When the drift check finds no mismatch" paragraph). Block B — Step 8's item 5, old lines 480-488: from `5. **On success when invoked via \`--pre-confirmed\`:**` through `that path.` Both move verbatim (Block B keeps its `5. ` prefix and indentation).

- [ ] **Step 2: Create `plugin/skills/feedback/pre-confirmed.md`**

Use the Write tool:

```markdown
# Feedback — The `--pre-confirmed` Path

Referenced by `skills/feedback/SKILL.md` Step 7 (Confirm — HARD GATE) and Step 8 (File). Read
only when `--pre-confirmed` was passed — legitimately only by `/claude-tweaks:wrap-up`'s Review
Console or `/claude-tweaks:flow`'s consolidated multi-spec console (`SKILL.md`'s Component-Skill
Contract). A direct invocation never reads this file. `--dry-run` takes precedence over
`--pre-confirmed` (Step 7) and stops before either section below runs.

## Step 7 — the two checks before filing

{old lines 375-396, verbatim}

## Step 8 — cleanup on success

Step 8's item 5, verbatim:

{old lines 480-488, verbatim}
```

- [ ] **Step 3: Replace both blocks in `SKILL.md` with routing pointers**

Step 7: delete old lines 375-396 and put this paragraph in their place (blank line before the `**\`--dry-run\`:**` paragraph preserved):

```markdown
**`--pre-confirmed`:** read `pre-confirmed.md` in this skill's directory and follow its Step 7
section — an unconditional Step 6 scrub rerun on the on-disk staged content, then a byte-for-byte
drift check against the caller's approved snapshot, which decides whether this item's
`AskUserQuestion` is skipped (no mismatch) or falls back to a normal per-item confirm (drift, or
the staged file already gone = already filed). Never read on a direct invocation.
```

Step 8: delete old lines 480-488 and put this item in their place:

```markdown
5. **On success when invoked via `--pre-confirmed`:** run `pre-confirmed.md`'s Step 8 section
   (this skill's directory) — the per-draft `staged/wrap-up-upstream-{N}.md` cleanup keyed on the
   CLI table's `filed`/`dedup-hit` status. A direct invocation has no staged file — no-op.
```

- [ ] **Step 4: Run the tests**

Run: `node --test tests/skill-mode-split-conformance.test.js tests/frontier-unattended-literal.test.js tests/bin-lib/skill-audit/anti-patterns.test.js`
Expected: all 7 `skill-mode-split-conformance` tests pass (both ceilings now green); the other two pass unchanged (no `frontier --unattended` literal moved; no Anti-Patterns row moved).

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/feedback/pre-confirmed.md plugin/skills/feedback/SKILL.md
```
```bash
git commit -m "Extract feedback's --pre-confirmed path into pre-confirmed.md — loaded only from the two consoles that pass the flag" -m "Claude-Session: https://claude.ai/code/session_01RiCXcUa95YrY58fczMQxhj"
```

---

### Task 7: Line-preservation proof, docs table, and the full related sweep

**Files:**
- Modify: `docs/plugin-structure.md` (the `demo` and `feedback` rows of the per-skill sub-file table, currently lines 104-105)
- Scratch (not committed): `.claude-tweaks/pipelines/2026-09-21T213441-spec-2697-2757-2758-2759/spec-2697/verify-move.js`
- Test: every suite named in Tasks 1-6, plus `tests/bin-lib/skill-audit/context-cost.test.js`

**Interfaces:**
- Consumes: every file Tasks 2-6 produced.
- Produces: the plugin-structure rows; the proof output quoted in the build handoff.

- [ ] **Step 1: Write the scratch line-preservation check**

Use the Write tool to create `.claude-tweaks/pipelines/2026-09-21T213441-spec-2697-2757-2758-2759/spec-2697/verify-move.js` (gitignored run-dir mirror, never committed):

```js
'use strict';
// Every non-blank line of the pre-split SKILL.md must still exist, byte-identical, in the union
// of the post-split SKILL.md and its new sub-files — proves the extraction moved and never
// dropped or reworded. Usage: node verify-move.js <baseSha> <skillRel> <newFile...>
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const [base, rel, ...files] = process.argv.slice(2);
const old = execFileSync('git', ['show', `${base}:${rel}`], { encoding: 'utf8' }).split(/\r?\n/);
const union = new Set(files.flatMap((f) => fs.readFileSync(f, 'utf8').split(/\r?\n/)));
const missing = old.filter((l) => l.trim() && !union.has(l));
console.log(missing.length ? `MISSING ${missing.length} line(s):\n${missing.join('\n')}` : `all pre-split lines present (${old.length} checked)`);
process.exit(missing.length ? 1 : 0);
```

- [ ] **Step 2: Run it for both skills**

Run: `node .claude-tweaks/pipelines/2026-09-21T213441-spec-2697-2757-2758-2759/spec-2697/verify-move.js 6d0f768a4 plugin/skills/demo/SKILL.md plugin/skills/demo/SKILL.md plugin/skills/demo/browser-verdict.md plugin/skills/demo/design-contract-section.md plugin/skills/demo/follow-up-record.md`
Expected: `all pre-split lines present (396 checked)`.

Run: `node .claude-tweaks/pipelines/2026-09-21T213441-spec-2697-2757-2758-2759/spec-2697/verify-move.js 6d0f768a4 plugin/skills/feedback/SKILL.md plugin/skills/feedback/SKILL.md plugin/skills/feedback/bare-invocation.md plugin/skills/feedback/pre-confirmed.md`
Expected: `all pre-split lines present (538 checked)`.

A `MISSING` line means a moved block was re-wrapped or reworded — restore it verbatim in the sub-file (the pointer paragraphs in `SKILL.md` are additions and never replace an old line).

- [ ] **Step 3: Update `docs/plugin-structure.md`'s sub-file table**

Run: `grep -n "^| demo \|^| feedback " docs/plugin-structure.md`
Replace the `demo` row's sub-file list column with `legacy-brief-compatibility.md, entry-paths.md, browser-verdict.md, design-contract-section.md, follow-up-record.md` and append to its description column: ` browser-verdict.md holds Step 2's browser-verdict path (read only for `rendered-page`/`app-route` plans with browser tools); design-contract-section.md holds the design-contract rendering rules (read only when a contract resolves or parses malformed); follow-up-record.md holds Step 3's follow-up-record filing (read only on a Request-changes verdict or a scope-fork capture) — #2697's mode-body split, following #89's precedent`.

Replace the `feedback` row's sub-file list column with `session-evaluation.md, bare-invocation.md, pre-confirmed.md` and append to its description column: ` bare-invocation.md holds Step 0's two gathers, merge rule, and interaction budget (read only on bare/--queue invocation); pre-confirmed.md holds Step 7's two `--pre-confirmed` checks and Step 8's cleanup-on-success (read only when the flag was passed by one of the two consoles) — #2697's mode-body split`.

- [ ] **Step 4: Run every related suite**

Run: `node --test tests/skill-mode-split-conformance.test.js tests/demo-visual-decision-adoption.test.js tests/visual-decision-contract-conformance.test.js tests/demo-full-verification-pointer.test.js tests/batch-ref-argument.test.js tests/help-acceptance-queue-local-files.test.js tests/feedback-dedup-search-scrub-conformance.test.js tests/tidy-unfiled-backstop.test.js tests/frontier-unattended-literal.test.js tests/bin-lib/skill-audit/anti-patterns.test.js tests/bin-lib/skill-audit/context-cost.test.js`
Expected: every test passes (any `context-cost` per-file warning for other skills is pre-existing and unrelated; neither `demo/SKILL.md` nor `feedback/SKILL.md` may appear in a new warning).

- [ ] **Step 5: Commit**

```bash
git add docs/plugin-structure.md
```
```bash
git commit -m "Document demo and feedback's new mode sub-files in the plugin-structure table — #2697" -m "Claude-Session: https://claude.ai/code/session_01RiCXcUa95YrY58fczMQxhj"
```

---

## Self-review

- **Spec coverage.** Deliverable 1 (split `demo/SKILL.md`) → Tasks 2-4. Deliverable 2 (split `feedback/SKILL.md`) → Tasks 5-6. AC "bare `/feedback` no longer loads batch/`--pre-confirmed`/other-mode text" → Tasks 5-6 (a bare run reads `bare-invocation.md` and never `pre-confirmed.md`; a free-text run reads neither). AC "`/demo` loads only its resolved mode's procedure" → Tasks 2-4, with the stale `explore`/`live` premise corrected in Global Constraints. AC "every behavior unchanged" → verbatim moves + Task 7's line-preservation proof + the re-pointed conformance suites. Gotcha "shared content stays in `SKILL.md`" → Anti-Patterns, Component-Skill Contract, Input, When to Use, Next Actions never move.
- **Placeholder scan.** Every `{old lines a-b, verbatim}` marker names exact pre-split line ranges from the base commit and is a cut instruction, not a fill-in.
- **Consistency.** Sub-file names, H1 lines, and body literals are identical between Task 1's `SPLITS` table and Tasks 2-6's Write blocks (`browser-verdict.md` / `# Demo Step 2 — Browser Verdict` / `Compose a single-variant \`layout\`-scope`; `design-contract-section.md` / `# Demo Step 2 — The Design Contract Section` / `five blocks reproduced **verbatim**`; `follow-up-record.md` / `# Demo Step 3 — Filing the Follow-Up Record` / `Never \`allocateId\`+\`writeRecord\``; `bare-invocation.md` / `# Feedback Step 0 — Bare-Invocation Umbrella` / `gh issue list --label upstream-candidate`; `pre-confirmed.md` / `# Feedback — The \`--pre-confirmed\` Path` / `compare it, byte-for-byte, against the approved snapshot`). Each body literal sits inside the moved range and nowhere in the surviving stub text.
