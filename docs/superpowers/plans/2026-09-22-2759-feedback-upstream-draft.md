# #2759 — /feedback draft-only `--upstream <owner/name>` path — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give `/claude-tweaks:feedback` a terminal, draft-only path for a learning owned by a third-party dependency — selected by a new `--upstream <owner/name>` argument — so `_shared/learning-routing.md`'s third-party rule hands the learning somewhere instead of dead-ending at "report it, name the owner, and stop".

**Architecture:** Purely additive. `feedback/SKILL.md` stays the filing skill and gains one routing paragraph after Step 2 plus one `## Input` row; the whole draft path lives in a new lazily-loaded sub-file, `feedback/upstream-draft.md`, which reuses Steps 1, 2, 4 (retargeted), 5 (adapted), and 6 (the `[Use: Capable]` scrub singleton, unchanged) and replaces 3, 7, 8, and 9. Step 3 collapses to a self-target guard whose normalization lives only in the sub-file; Step 7 is skipped because nothing is published; Step 8 never runs. The path ends at a scrubbed draft persisted to disk plus a paste-ready `gh issue create` command and a web fallback that the **human** runs. An invocation without `--upstream` is byte-identically routed to today's behavior.

**Tech Stack:** Markdown skill files (`plugin/skills/**`), `node --test` prose-conformance suites (`tests/*.test.js`), `plugin/bin/stage-item.js` + `plugin/bin/hooks.js resolve-run-dir` + `plugin/bin/session-tmp-resolve.js` as the persistence CLIs, `gh` CLI (read-only here), git.

**Spec:** `.claude-tweaks/pipelines/2026-09-21T213441-spec-2697-2757-2758-2759/spec-2759/work/2759-spec.md`

## Global Constraints

- **The central invariant, permanent:** nothing is ever filed, commented, labelled, or otherwise written against a third-party repository on the user's behalf. `bin/file-feedback.js` is never invoked on this path; `gh issue create` is only ever *rendered as text* for the human to run (spec, Non-Goals + Decision Rationale).
- The skill still **files** only at `thomasholknielsen/claude-tweaks`. It additionally **drafts** for elsewhere (spec, Overview).
- Step 6's scrub HARD GATE (`<!-- HARD-GATE: feedback-scrub -->`) runs unchanged on this path, including its unconditional stop, and reuses **the same** `[Use: Capable]` singleton Task dispatch — one per invocation, never a second (spec, Gotchas).
- Step 7's confirm gate never runs on this path; there is nothing to confirm because nothing is published (spec, Decision Rationale).
- **Two byte ceilings on `plugin/skills/feedback/SKILL.md`, both binding, measured differently:**
  - Acceptance Criterion 9: at most **1.5 KB (1,536 bytes)** larger than before this record, measured with `wc -c`. Pre-change `wc -c` on this box: **29,624** → ceiling **31,160**.
  - `tests/skill-mode-split-conformance.test.js`'s `STUB_CEILING_BYTES = 30 * 1024` asserts `bytes < 30720` on the **CRLF-normalized** text (`read()` does `.replace(/\r\n/g, '\n')` before `Buffer.byteLength`). Pre-change normalized size: **29,167** → headroom **1,552** normalized bytes. The working tree on this Windows box is CRLF, so `wc -c` (29,624) and the test's view (29,167) differ by 457 bytes; do **not** subtract 29,624 from 30,720 and conclude the two constraints conflict. Measure both after the edit:
    - `wc -c plugin/skills/feedback/SKILL.md`
    - `node -p "const s=require('fs').readFileSync('plugin/skills/feedback/SKILL.md','utf8'); Buffer.byteLength(s.replace(/\r\n/g,'\n'),'utf8')"`
- `feedback/SKILL.md`'s `## Anti-Patterns` row is **rewritten in place, never added to**. The live-corpus row-count ledger in `tests/bin-lib/skill-audit/anti-patterns.test.js` asserts `total === 421`; a rewrite is count-neutral and that number must not change (spec, Gotchas).
- Acceptance Criterion 3: `git diff` of `feedback/SKILL.md` must show **no change to the text of Steps 3 through 9** other than the one routing paragraph inserted after Step 2 and the rewritten Anti-Patterns row. (Edits to the frontmatter, `## When to Use`, `## Input`, and `## Component-Skill Contract` are outside Steps 3-9 and are in scope.)
- Step 4's privacy constraint transfers verbatim: dedup `--search` keywords derive from the **affected component name only**, never from draft-derived summary/symptom text, because the search runs before the scrub gate (spec, Gotchas; `tests/feedback-dedup-search-scrub-conformance.test.js`).
- Never emit a prefilled `https://github.com/.../issues/new?title=&body=` URL — bodies routinely exceed practical URL length and truncate silently (spec, Gotchas).
- `--upstream` naming claude-tweaks itself is **not** an error and **not** a draft: it returns to `SKILL.md` Step 3 and files normally. The normalize-and-compare logic has exactly one home, `upstream-draft.md`; `SKILL.md`'s routing paragraph must never grow its own copy (spec, Gotchas).
- A bare dependency name (`agent-browser`, `superpowers`) is the expected common case from `/reflect` and `/intake` — handled as an unresolved target, never rejected (spec, Gotchas).
- `stage-item.js` exits `3` when the run dir is missing or not anchored under the main checkout; on exit 3, fall back to the session-scoped scratch path and report why — never write into a worktree-local shadow (spec, Gotchas; `[IL-127]`).
- Cross-references are stated **once**, in `docs/skill-graph.md` (CLAUDE.md). The new intake→feedback `--upstream` edge is stated in full under `## feedback` (feedback is the callee) and referenced, not duplicated, from `## intake`.
- A skill reference inside actionable instruction text (a Step body, a `## Next Actions` block) uses the fully-qualified `/claude-tweaks:{skill}` form (CLAUDE.md, Cross-references). Note `tests/intake-conformance.test.js` assertion (h) enforces exactly this on `intake/SKILL.md`'s Step bodies.
- The new sub-file gets **no** `> **Interaction style:**` line — the SessionStart hook injects it (`docs/skill-authoring.md`; `tests/skill-conventions.test.js` and `tests/bin-lib/skill-audit/house-structure.test.js` fail a file that carries one). Sub-files are not `SKILL.md`s and carry no YAML frontmatter.
- Commit message style: `{Verb} {what} — {detail}`, imperative, no conventional-commit prefix, ending with the trailer `Claude-Session: https://claude.ai/code/session_01RiCXcUa95YrY58fczMQxhj`.
- **Worktree Bash guard** (this session is worktree-isolated): one plain command per Bash call; no heredocs, no `&&`, no output redirection to a path outside the worktree; the bare argv word `complete` is refused. Author every file with the Write/Edit tool, never a heredoc.
- **Windows test baseline.** `npm test` cannot run as written on this box. Use a script file: write it with the Write tool, then run `bash <script>`. The full-suite invocation is `node --test 'tests/**/*.test.js' 'tools/upstream-drift/tests/**/*.test.js'`. The pre-existing per-file failure baseline for this run lives at `.claude-tweaks/pipelines/2026-09-21T213441-spec-2697-2757-2758-2759/sweep-baseline.txt` — **395 failures across 104 files**, all environmental (Windows path/CRLF shapes). Compare per-file against that baseline; a file whose count rises above its baseline line (or a file absent from the baseline that now fails) is a regression. Re-run any suspect file in isolation (`node --test path/to/file.test.js`) before calling it a regression.

---

## File Structure

| File | Responsibility |
|---|---|
| `tests/feedback-upstream-draft-conformance.test.js` (create) | The five conformance assertions from the spec's Deliverables list. Written first, red across the board. |
| `plugin/skills/feedback/upstream-draft.md` (create) | The whole draft path: self-target guard + normalization (sole home), retargeted advisory dedup, adapted draft template, scrub-by-reference, persistence, hand-off. Lazily loaded — read only when `--upstream` was passed. |
| `plugin/skills/feedback/SKILL.md` (modify) | `argument-hint` frontmatter, `## Input`'s parse line + new row, `## When to Use`'s third-party paragraph, the routing paragraph after Step 2, `## Component-Skill Contract` note, the rewritten `## Anti-Patterns` row. Steps 3-9 untouched. |
| `plugin/skills/_shared/learning-routing.md` (modify) | The "Non-claude-tweaks upstream" paragraph: hands off to `--upstream` instead of stopping. |
| `plugin/skills/reflect/SKILL.md` (modify) | One sentence in the "Classify first" paragraph. |
| `plugin/skills/intake/SKILL.md` (modify) | New `upstream:<owner/name>` verdict: Step 3's table + bullet, Step 4's override-grammar example, Step 6's writer table + processing order, Step 7's Actions-Performed vocabulary. |
| `tests/intake-conformance.test.js` (modify) | `VERDICT_ORDER` gains the new verdict; the eight-row test name and assertion message become nine. |
| `docs/skill-graph.md` (modify) | `## feedback` gains an `/intake` row and an updated `_shared/learning-routing.md` row; `## intake` and `## reflect` rows updated to match. |
| `docs/plugin-structure.md` (modify) | The per-skill sub-file table's `feedback` row lists `upstream-draft.md`. |
| Verify-only, **no edits expected** | `plugin/skills/code-health/filing.md`, `plugin/skills/harness-health/filing.md`, `plugin/skills/harness-health/SKILL.md`, `plugin/skills/docs-health/SKILL.md`, `plugin/skills/journey-health/SKILL.md`, `plugin/skills/wrap-up/upstream-feedback.md`, `plugin/skills/wrap-up/review-console.md`, `plugin/skills/help/context-flow.md` |

---

### Task 1: The conformance test, written first and red

**Files:**
- Create: `tests/feedback-upstream-draft-conformance.test.js`

**Interfaces:**
- Produces, for every later task: the five literals that must exist when this task's file goes green.
  - `plugin/skills/_shared/learning-routing.md`'s paragraph beginning `**Non-claude-tweaks upstream.**` must contain `--upstream` and `publishes nothing`, and must not contain the words `and stop`.
  - `plugin/skills/feedback/SKILL.md`'s `## Anti-Patterns` table must keep exactly one row matching ``other than `thomasholknielsen/claude-tweaks` ``, and that row must contain `**Filing**` and `--upstream`.
  - `plugin/skills/feedback/upstream-draft.md` must exist, must **not** contain `file-feedback.js`, must **not** contain `--pre-confirmed`, must contain the backticked literal `` `staged/upstream-draft-{N}.md` `` (and no `staged/<something>-{N}.md` literal earlier in the file), must contain the literal `gh issue create --repo <owner/name> --title '<title>' --body-file`, and must contain the literal `'\''`.

- [ ] **Step 1: Write the failing test**

Create `tests/feedback-upstream-draft-conformance.test.js`:

```js
'use strict';
// tests/feedback-upstream-draft-conformance.test.js — #2759: /claude-tweaks:feedback's
// draft-only `--upstream <owner/name>` path. Five live-corpus pins, read fresh from the
// working tree rather than frozen into fixtures: this is just-shipped skill prose that is
// expected to keep evolving in place, and a fixture copy would pin the fixture, not the
// shipped instruction the model actually follows.
//
// Discrimination proof (skill-prose-conformance-tests): all five were RUN red before any
// implementation landed. (1) and (2) failed on content — learning-routing.md still ended
// its third-party rule in "and stop", and the Anti-Patterns row was not yet scoped to
// *filing*. (3), (4), and (5) failed because plugin/skills/feedback/upstream-draft.md did
// not exist. Each test reads its own files lazily so a missing file fails exactly one test
// instead of crashing the module at load.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');

const ROUTING_PATH = 'plugin/skills/_shared/learning-routing.md';
const SKILL_PATH = 'plugin/skills/feedback/SKILL.md';
const DRAFT_PATH = 'plugin/skills/feedback/upstream-draft.md';

// The third-party rule is one paragraph: its bold lead-in through the next blank line.
function thirdPartyParagraph() {
  const routing = read(ROUTING_PATH);
  const start = routing.indexOf('**Non-claude-tweaks upstream.**');
  assert.ok(start >= 0, `${ROUTING_PATH} must still carry the "Non-claude-tweaks upstream" rule`);
  const end = routing.indexOf('\n\n', start);
  return routing.slice(start, end === -1 ? routing.length : end);
}

test('(1) the third-party rule routes to --upstream and no longer dead-ends in "and stop"', () => {
  const para = thirdPartyParagraph();
  assert.ok(para.includes('--upstream'), 'the rule must hand the learning to --upstream');
  assert.ok(para.includes('publishes nothing'), 'the rule must state that the path publishes nothing');
  assert.equal(/\band stop\b/.test(para), false, 'the rule must no longer end by telling the classifier to stop');
});

test('(2) feedback/SKILL.md still forbids FILING against a non-claude-tweaks repo', () => {
  const skill = read(SKILL_PATH);
  const table = skill.slice(skill.indexOf('## Anti-Patterns'));
  const rows = table.split('\n').filter((l) => l.startsWith('|') && l.includes('other than `thomasholknielsen/claude-tweaks`'));
  assert.equal(rows.length, 1, 'exactly one Anti-Patterns row may forbid a non-claude-tweaks target — rewrite it, never add a second');
  assert.ok(rows[0].includes('**Filing**'), 'the row must scope the prohibition to *filing*, since drafting is now sanctioned');
  assert.ok(rows[0].includes('--upstream'), 'the row must name --upstream as the sanctioned alternative');
});

test('(3) upstream-draft.md never names the filing CLI', () => {
  const draft = read(DRAFT_PATH);
  assert.equal(draft.includes('file-feedback.js'), false, 'the draft path must never invoke the filing CLI');
});

test('(4) the persisted draft sits outside the consoles\' glob and the path never pre-confirms', () => {
  const draft = read(DRAFT_PATH);
  const m = draft.match(/`staged\/([a-z0-9-]+-\{N\}\.md)`/);
  assert.ok(m, 'upstream-draft.md must name its persisted staged/ filename as a backticked literal');
  assert.equal(m[1], 'upstream-draft-{N}.md', `persisted filename is ${m[1]}`);
  assert.equal(/wrap-up-upstream-.*\.md/.test(m[1]), false,
    `${m[1]} must not match the staged/wrap-up-upstream-*.md aggregation glob the wrap-up and multi-spec consoles scan`);
  assert.equal(draft.includes('--pre-confirmed'), false, 'nothing is published on this path, so nothing is pre-confirmed');
});

test('(5) upstream-draft.md renders the hand-off block and states the single-quote escaping rule', () => {
  const draft = read(DRAFT_PATH);
  assert.ok(draft.includes("gh issue create --repo <owner/name> --title '<title>' --body-file"),
    'the hand-off block must render verbatim, with the body via --body-file');
  assert.ok(draft.includes("'\\''"), "the escaping rule must name the four-character '\\'' form");
});
```

- [ ] **Step 2: Run the test and confirm all five fail**

Run: `node --test tests/feedback-upstream-draft-conformance.test.js`

Expected: 5 fail / 0 pass. Tests (1) and (2) fail on content (`and stop` still present; the row lacks `**Filing**`). Tests (3), (4), (5) fail with `ENOENT ... plugin/skills/feedback/upstream-draft.md`.

Record the raw output — it is the discrimination proof the file's header comment claims, and the PR body quotes it.

- [ ] **Step 3: Commit**

```bash
git add tests/feedback-upstream-draft-conformance.test.js
```

```bash
git commit -m "Add the #2759 upstream-draft conformance suite — five live-corpus pins, all red before implementation

Claude-Session: https://claude.ai/code/session_01RiCXcUa95YrY58fczMQxhj"
```

---

### Task 2: `feedback/upstream-draft.md` — the draft path

**Files:**
- Create: `plugin/skills/feedback/upstream-draft.md`
- Test: `tests/feedback-upstream-draft-conformance.test.js` (from Task 1)

**Interfaces:**
- Consumes (from `feedback/SKILL.md`, unchanged by this plan): Step 1's gathered summary / affected component / title / repro-or-use-case; Step 2's `defect`|`gap` kind; Step 5's title form `<component>: <symptom>`; Step 6's scrub criteria and its `[Use: Capable]` singleton dispatch.
- Consumes (CLIs, real signatures): `node "${CLAUDE_PLUGIN_ROOT}/bin/hooks.js" resolve-run-dir` (prints the resolved absolute run dir on stdout, exit 0; non-zero with a stderr message when nothing resolves or a shadow is refused). `node "${CLAUDE_PLUGIN_ROOT}/bin/stage-item.js" --run <run-dir> --id <kind>-<n> --file <path>` (exit 0 → echoes the written absolute path on stdout; exit 2 malformed invocation; exit 3 run dir missing or not anchored under the main checkout). `eval "$(node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" VAR=filename.md)"` (sets `$VAR` to a session-scoped absolute path).
- Produces, for Task 3's routing paragraph and Task 6's docs rows: the file name `upstream-draft.md`, its Step A self-target return target (`SKILL.md` Step 3), and the persisted-file name `staged/upstream-draft-{N}.md`.

- [ ] **Step 1: Write the sub-file**

Create `plugin/skills/feedback/upstream-draft.md` with exactly this content:

````markdown
# Feedback — The `--upstream` Draft-Only Path

Referenced by `skills/feedback/SKILL.md`'s routing paragraph after Step 2. Read only when
`--upstream <value>` was passed; an invocation without the flag never reads this file.

**This path drafts; it never publishes.** Step 7 (Confirm) and Step 8 (File) do not run here.
Nothing is created, commented on, or labelled in any repository, and this skill's filing CLI is
never invoked — the human is the filer. Being inside a pipeline changes none of that, and `auto`
mode does not silence this path, the same stance `SKILL.md`'s Component-Skill Contract already
takes on Steps 6 and 7.

Entered with Step 1's gathered material (summary, affected component, title, and either repro
steps plus expected-vs-actual, or a use case) and Step 2's `defect`/`gap` kind already in hand.
Steps A-E below stand in for `SKILL.md`'s Steps 3-9.

## Step A: Self-target guard and normalization

This file is the **sole home** of `--upstream`'s normalization and its compare against
claude-tweaks. `SKILL.md`'s routing paragraph dispatches on the flag's presence only and never
grows its own copy.

**Empty value.** `--upstream` with nothing after it is a hard error. Stop and report, verbatim:

```
'--upstream' needs a value: an owner/name slug, a GitHub URL, or the dependency's name
```

**Resolvable forms.** Strip one trailing `/` if present, then one trailing `.git` if present,
then match the remainder against:

| Form | Example |
|---|---|
| `owner/name` | `vercel-labs/agent-browser` |
| `github.com/owner/name` | `github.com/vercel-labs/agent-browser` |
| `https://github.com/owner/name` | `https://github.com/thomasholknielsen/claude-tweaks` |
| `git@github.com:owner/name` | `git@github.com:ThomasHolkNielsen/claude-tweaks` |

`owner` and `name` are each exactly one segment of `[A-Za-z0-9._-]` characters. A value carrying a
third path segment, a query string, or a fragment is **not** resolvable. Lower-case both segments;
the normalized result is always `owner/name`.

**Self-target.** When the normalized slug equals `thomasholknielsen/claude-tweaks`, this learning
is not third-party at all. Say so — "`--upstream {the raw value}` names claude-tweaks itself;
filing normally" — and **return to `SKILL.md` Step 3**, which then runs unchanged through Step 9.
Nothing below this line runs. This is neither an error nor a draft.

**Unresolved target.** Any other non-empty value is an **unresolved target**, never an error: the
classifier could name the dependency but not its repository (`agent-browser`, `superpowers`), or
the dependency has no GitHub repository at all. This is the expected common case when the value
came from `/claude-tweaks:intake` or `/claude-tweaks:reflect` rather than a typed flag. The path
continues, with exactly three differences, stated once here:

- **U1.** Step E's hand-off renders the literal placeholder `<owner/name>` where the slug would go.
- **U2.** Step B's dedup search is skipped, with a one-line note saying why.
- **U3.** Step D's header comment records `target: unresolved ({the raw value})`.

**One question, only when a human is present.** Before Step D persists anything, ask exactly one
`AskUserQuestion`: `question: "Which GitHub repository owns \`{the raw value}\`?"`,
`header: "Upstream"`, `multiSelect: false`, options `I don't know — keep the placeholder
(Recommended)` plus `Other`, where the human types an `owner/name` slug. A typed slug re-enters
the normalization above, self-target check included. A headless invocation — a scheduled Routine
or a `claude -p` run, resolved from session state, never a hard-coded literal — skips the question
and keeps the placeholder. This is the path's only question: there is no confirm gate here,
because there is nothing to confirm.

## Step B: Dedup — retargeted, read-only, advisory

An unresolved target skips this step (U2): say so in one line — "no repository to search; search
their tracker yourself before pasting" — and go to Step C. Otherwise:

```bash
gh issue list --repo <owner/name> --search '<component>' --state all --limit 10 --json number,title,state,url
```

`<component>` is the affected component name **only** — their component name as the learning names
it — and never the free-text symptom or summary, which is draft-derived text that has not yet
passed Step D's scrub criteria. That is `SKILL.md` Step 4's privacy constraint, and it transfers
here unchanged: nothing draft-derived is sent to a public search API before the scrub gate runs.

This is a coarse screen in a tracker whose conventions this skill cannot know, so both irrelevant
matches and missed duplicates are accepted costs. It is **advisory only**: render any matches as
context under the heading "Search their tracker first — possible related issues", and never stop
on one. Judging whether an existing thread really is the same bug is the human's call, not this
skill's. A failed search — transient or not — attaches its reason in one line and the path
continues; there is no retry loop, because nothing downstream depends on the result.

## Step C: Draft — the adapted template

Title: `<component>: <symptom>`, formed exactly as `SKILL.md` Step 5 forms it.

Body:

```
**Summary:** <one line>

**Kind:** Defect | Gap

**Affected component:** <their component, as the learning names it>

**Repro steps:** (defect only)
1. ...

**Expected vs. actual:** (defect only)
Expected: ...
Actual: ...

**Use case:** (gap only)
<what you were trying to do and why their current behavior does not support it>

**Environment:** <a version string — only when the learning text itself states one>
```

`SKILL.md` Step 5's `**Objective:**`, `**Measurement:**`, `**Cost this session:**`,
`**Definition:**`, and `**Plugin version:**` lines, its `Filed via /claude-tweaks:feedback.`
footer, and its `<!-- fingerprint: <marker> -->` marker are all **dropped**. Every one of them is
claude-tweaks-internal bookkeeping that means nothing in someone else's tracker, and the
fingerprint marker specifically drives this repo's own dedup-on-refile check, which never runs on
this path.

Emit `**Environment:**` only when the learning text itself states a version. This skill performs
no version lookup against the dependency; with no version stated, omit the line entirely rather
than guessing or writing "unknown".

Honoring the target's issue template, and judging whether a Discussion is the better venue than an
issue, stay with the human — they are judgments this skill cannot make.

## Step D: Scrub, then persist

**Scrub first, unchanged.** Run `SKILL.md` Step 6 exactly as written: the same removal criteria,
the same unconditional posture, and the same `[Use: Capable]` singleton Task dispatch. This path
reuses that one dispatch; it never adds a second. The gate is if anything more load-bearing here
than on the filing path — a draft a human pastes leaks a credential exactly as well as one a CLI
files.

**If the learning cannot survive the scrub, stop.** `SKILL.md` Step 6's hard stop applies here in
full: write nothing to disk, report that the learning is unfileable as-is, and hand it back.
Everything below runs only on the scrubbed body.

**`--dry-run`.** Render the scrubbed draft and Step E's hand-off block, then stop without
persisting: no file is written, and the hand-off leaves `<absolute path>` as a placeholder.
`SKILL.md`'s `--dry-run` precedence rule is untouched by this path.

**Where the file goes.** Resolve the run directory per `_shared/pipeline-run-dir.md`:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/hooks.js" resolve-run-dir
```

- **Exit 0 — a run directory resolved.** Write the scrubbed body to a scratch file, then stage it
  as `staged/upstream-draft-{N}.md` through the sanctioned writer:

  ```bash
  node "${CLAUDE_PLUGIN_ROOT}/bin/stage-item.js" --run "<the resolved run dir>" --id upstream-draft-{N} --file <scratch path>
  ```

  `{N}` is 1 plus the highest `{N}` already present among that run's `staged/upstream-draft-*.md`
  files, or `1` when there are none. `stage-item.js` creates a per-item path, so no lock is
  needed. It echoes the written absolute path on stdout; report **that** path, not the `--run`
  input string, which can differ from it after realpath resolution.
- **Exit 3.** The run directory is missing, or it is a worktree-local shadow rather than an
  anchored main-checkout path (`_shared/pipeline-run-dir.md`'s Anchoring section, `[IL-127]`).
  Fall back to the scratch path below and report why. Never hand-write into a worktree-local
  shadow to work around this.
- **`resolve-run-dir` exits non-zero.** No run directory at all — the ordinary case, since this
  skill is commonly invoked standalone. Fall back to the scratch path below, silently; this is
  not a degradation worth reporting.

**Scratch fallback**, per `_shared/session-tmp-root.md` — substitute the current UTC timestamp for
`{YYYYMMDDTHHMMSS}` before running:

```bash
eval "$(node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" UPSTREAM_DRAFT=feedback-upstream-draft-{YYYYMMDDTHHMMSS}.md)"
```

Write the scrubbed body to `$UPSTREAM_DRAFT` with the Write tool and report that absolute path. A
timestamp replaces `{N}` here because the session directory has no other writer to number against.

**The name is load-bearing.** `upstream-draft-{N}.md` sits deliberately outside the
`staged/wrap-up-upstream-*.md` glob that `wrap-up/review-console.md` and
`flow/multispec-review-console.md` both scan, so a stop-and-resume never re-enumerates a hand-off
draft as a fresh filing proposal — the same constraint `SKILL.md` Step 8's `upstream-unfiled-{N}.md`
fallback already observes. It also sits outside `/claude-tweaks:tidy`'s `staged/upstream-unfiled-*`
backstop glob, by design: a drafted-but-never-pasted report is a courtesy that outlives the
session, not a tracked item that resurfaces.

**File header.** The persisted file opens with one comment line, then the scrubbed body verbatim
and nothing else:

```
<!-- upstream-draft: {owner/name, or "unresolved ({the raw value})"} | {defect|gap} | drafted {ISO date} -->
```

so a later reader can tell target and kind without the session that produced it.

## Step E: Report — the hand-off

Report three things, in this order: the absolute path the draft was written to, the command, and
the web fallback.

```
gh issue create --repo <owner/name> --title '<title>' --body-file <absolute path>

Web: https://github.com/<owner>/<name>/issues/new  (paste the body from <absolute path>)
```

**Substitution.** `<owner/name>`, `<owner>`, and `<name>` take Step A's normalized slug — or stay
literal for an unresolved target (U1), for the human to fill in. `<absolute path>` is Step D's
reported path. `<title>` is Step C's title, **single-quoted, with every embedded `'` replaced by
the four-character sequence `'\''`** — close the quote, escape one literal apostrophe, reopen the
quote. That is the one form under which backticks, `$(...)`, `;`, and `&&` inside a title are inert
in every POSIX shell, and the hazard is real precisely because a human runs this command in their
own shell. A title of `it's $(rm -rf x)` renders as `'it'\''s $(rm -rf x)'` and creates an issue
titled literally `it's $(rm -rf x)`.

The body travels via `--body-file`, never inlined: `gh` has no `--title-file`, so the title must be
inlined and escaped as above, while the body has no such constraint and gains nothing from the
risk.

**Never render a prefilled URL.** `https://github.com/.../issues/new?title=&body=` truncates
silently past a length limit that real bodies routinely exceed, and a silently truncated body is
worse than a manual paste.

Close by saying, in one line, that the draft is the human's to send and that nothing was published.

`## Next Actions` renders per `SKILL.md`'s Component-Skill Contract — omitted inside a pipeline —
and never offers a command that files anything anywhere.
````

- [ ] **Step 2: Run the conformance test and confirm (3), (4), (5) now pass**

Run: `node --test tests/feedback-upstream-draft-conformance.test.js`

Expected: tests (3), (4), (5) PASS; tests (1) and (2) still FAIL (Tasks 3 and 4 fix those). 2 fail / 3 pass.

- [ ] **Step 3: Confirm the file carries no forbidden literal and no frontmatter**

Run: `grep -n "file-feedback.js\|--pre-confirmed\|Interaction style\|^---" plugin/skills/feedback/upstream-draft.md`

Expected: no output at all.

- [ ] **Step 4: Confirm the file is under the 40 KB per-file warning tier**

Run: `wc -c plugin/skills/feedback/upstream-draft.md`

Expected: well under 40960 (roughly 9-10 KB).

- [ ] **Step 5: Prove the escaping rule locally (deterministic half of AC 5)**

Write `/tmp/ct-2759-escape-check.sh` **with the Write tool** (no heredocs — the worktree guard refuses them):

```bash
#!/usr/bin/env bash
# Proves the '\'' escaping rule from upstream-draft.md Step E neutralizes a shell-injection
# title. `gh` is replaced by a printf shim, so nothing touches the network or GitHub.
set -u
gh() { printf 'ARG:%s\n' "$@"; }
TITLE_RENDERED="'it'\''s $(printf %s '$(rm -rf x)')'"
echo "--- rendered title argument ---"
echo "$TITLE_RENDERED"
echo "--- what the shell actually passes to gh ---"
eval "gh issue create --repo owner/name --title $TITLE_RENDERED --body-file /tmp/body.md"
```

Run: `bash /tmp/ct-2759-escape-check.sh`

Expected: the `ARG:` lines show `ARG:issue`, `ARG:create`, `ARG:--repo`, `ARG:owner/name`, `ARG:--title`, `ARG:it's $(rm -rf x)`, `ARG:--body-file`, `ARG:/tmp/body.md` — the title arrives as one argument whose text is the literal `it's $(rm -rf x)`, with no command substitution performed and no `rm` executed. Quote this output in the PR body.

- [ ] **Step 6: Commit**

```bash
git add plugin/skills/feedback/upstream-draft.md
```

```bash
git commit -m "Add feedback/upstream-draft.md — the draft-only --upstream path: self-target guard, retargeted advisory dedup, adapted template, persistence, shell-safe hand-off

Claude-Session: https://claude.ai/code/session_01RiCXcUa95YrY58fczMQxhj"
```

---

### Task 3: `feedback/SKILL.md` — the six in-place edits

**Files:**
- Modify: `plugin/skills/feedback/SKILL.md` (frontmatter line 4; `## When to Use` lines 26-29; `## Input` line 33 and its table; the gap between Step 2's end and `### Step 3`; `## Component-Skill Contract`; `## Anti-Patterns` row 2)
- Test: `tests/feedback-upstream-draft-conformance.test.js`, `tests/skill-mode-split-conformance.test.js`, `tests/bin-lib/skill-audit/anti-patterns.test.js`, `tests/feedback-dedup-search-scrub-conformance.test.js`, `tests/tidy-unfiled-backstop.test.js`, `tests/feedback-next-actions-plain-markdown-conformance.test.js`

**Interfaces:**
- Consumes (from Task 2): the sub-file name `upstream-draft.md` and its Step A self-target return to `SKILL.md` Step 3.
- Produces: the flag spelling `--upstream <owner/name>` used verbatim by Tasks 4, 5, and 6.

- [ ] **Step 1: Record the pre-edit sizes**

Run: `wc -c plugin/skills/feedback/SKILL.md`
Expected: `29624`

Run: `node -p "const s=require('fs').readFileSync('plugin/skills/feedback/SKILL.md','utf8'); Buffer.byteLength(s.replace(/\r\n/g,'\n'),'utf8')"`
Expected: `29167`

- [ ] **Step 2: Update the `argument-hint` frontmatter**

Edit line 4. Replace:

```
argument-hint: "[<learning text>] [--kind=defect|gap] [--dry-run] [--queue] [--full] [--pre-confirmed]"
```

with:

```
argument-hint: "[<learning text>] [--kind=defect|gap] [--upstream <owner/name>] [--dry-run] [--queue] [--full] [--pre-confirmed]"
```

(`docs/skill-authoring.md`: a new flag has two syntactic-mirror surfaces beyond the `## Input` table — this one and Step 3's parse line — and #679 is the incident where both were missed.)

- [ ] **Step 3: Rewrite the `## When to Use` third-party paragraph**

Replace this four-line paragraph (lines 26-29):

```
Do **not** use this skill to file against any repository other than
`thomasholknielsen/claude-tweaks`. A learning owned by a third-party dependency
is reported to the user and stopped — see `_shared/learning-routing.md`,
"Non-claude-tweaks upstream".
```

with:

```
This skill **files** against `thomasholknielsen/claude-tweaks` and nowhere else. A learning owned
by a third-party dependency takes `--upstream <owner/name>`'s draft-only path instead, which
publishes nothing — see `upstream-draft.md` in this skill's directory, and
`_shared/learning-routing.md`, "Non-claude-tweaks upstream".
```

- [ ] **Step 4: Update the `## Input` parse line and add the table row**

Replace line 33:

```
`$ARGUMENTS` is parsed as `[<learning text>] [--kind=<value>] [--dry-run] [--queue] [--full] [--pre-confirmed]`:
```

with:

```
`$ARGUMENTS` is parsed as `[<learning text>] [--kind=<value>] [--upstream <owner/name>] [--dry-run] [--queue] [--full] [--pre-confirmed]`:
```

Then insert this row into the table immediately after the `` | `--kind=gap` | ... | `` row and before the `` | `--dry-run` | ... | `` row:

```
| `--upstream <owner/name>` | Draft-only path for a learning owned by a third-party dependency: Steps 1, 2, 4 (retargeted), 5 (adapted), and 6 run; 3 collapses to the self-target guard; 7 is skipped because nothing is published; 8 never runs. Persists the scrubbed draft and hands the human a paste-ready command. Read `upstream-draft.md`. |
```

- [ ] **Step 5: Insert the routing paragraph after Step 2**

Step 2 currently ends with:

```
A defect and a gap differ in triage, urgency, and what a maintainer does with
them. They must not arrive looking identical.
```

immediately followed by `### Step 3: Self-reference check`. Insert this paragraph between them (blank line above and below):

```
**`--upstream` routing.** When `--upstream` is present, continue in `upstream-draft.md` in this
skill's directory; its self-target guard returns here, at Step 3, when the value names
claude-tweaks itself. Steps 3 through 9 below never run for any other `--upstream` value.
```

This paragraph dispatches on the flag's *presence* only. It must never grow its own copy of the
normalize-and-compare logic — that lives in `upstream-draft.md` alone.

- [ ] **Step 6: Add the Component-Skill Contract note**

In `## Component-Skill Contract`, insert this paragraph immediately after the existing
`Being inside a pipeline never relaxes Steps 6 and 7. ...` paragraph and before the
`**`--pre-confirmed` legitimacy is narrower than "inside a pipeline."**` paragraph:

```
`/claude-tweaks:intake` and `/claude-tweaks:reflect` pass the owner their classifier already
identified as `--upstream <owner/name>`, so the common third-party path needs no typing.
```

- [ ] **Step 7: Rewrite the Anti-Patterns row in place**

Replace this row (do **not** add a second — the live-corpus ledger in
`tests/bin-lib/skill-audit/anti-patterns.test.js` asserts a total of 421 and a rewrite is
count-neutral):

```
| Filing against a repo other than `thomasholknielsen/claude-tweaks` | Out of scope by design — a third-party owner has different consent requirements |
```

with:

```
| **Filing** against a repo other than `thomasholknielsen/claude-tweaks` | Out of scope by design: a third-party owner has different consent requirements. Drafting for one via `--upstream` is the sanctioned alternative; the draft path never invokes `bin/file-feedback.js` |
```

- [ ] **Step 8: Verify both byte ceilings**

Run: `wc -c plugin/skills/feedback/SKILL.md`
Expected: at most `31160` (pre-change `29624` + 1536). Projected: roughly `30690`.

Run: `node -p "const s=require('fs').readFileSync('plugin/skills/feedback/SKILL.md','utf8'); Buffer.byteLength(s.replace(/\r\n/g,'\n'),'utf8')"`
Expected: strictly less than `30720`. Projected: roughly `30220`.

If either ceiling is breached, trim the `## Input` row's wording first (it is the longest of the six additions), then the Component-Skill Contract note — never the routing paragraph, whose every clause is load-bearing.

- [ ] **Step 9: Verify Steps 3-9 are otherwise untouched (AC 3)**

Run: `git diff -U0 -- plugin/skills/feedback/SKILL.md`

Expected: the only hunks between `### Step 3` and `## Next Actions` are the single inserted routing paragraph (which sits *above* `### Step 3`). Every other hunk is in the frontmatter, `## When to Use`, `## Input`, `## Component-Skill Contract`, or `## Anti-Patterns`. Quote this diff in the PR body as AC 3's evidence.

- [ ] **Step 10: Run the affected suites**

Run: `node --test tests/feedback-upstream-draft-conformance.test.js tests/skill-mode-split-conformance.test.js tests/feedback-dedup-search-scrub-conformance.test.js tests/tidy-unfiled-backstop.test.js tests/feedback-next-actions-plain-markdown-conformance.test.js tests/feedback-watermark-prose.test.js`

Expected: all pass except conformance test (1), which Task 4 fixes. Specifically `skill-mode-split-conformance.test.js`'s `feedback/SKILL.md stays under the post-split stub ceiling` must PASS.

Run: `node --test tests/bin-lib/skill-audit/anti-patterns.test.js`

Expected: PASS — the ledger total is still 421.

- [ ] **Step 11: Commit**

```bash
git add plugin/skills/feedback/SKILL.md
```

```bash
git commit -m "Route --upstream from feedback/SKILL.md — Input row, argument mirrors, post-Step-2 dispatch, in-place Anti-Patterns rewrite

Claude-Session: https://claude.ai/code/session_01RiCXcUa95YrY58fczMQxhj"
```

---

### Task 4: `_shared/learning-routing.md` and `reflect/SKILL.md`

**Files:**
- Modify: `plugin/skills/_shared/learning-routing.md` (the `**Non-claude-tweaks upstream.**` paragraph, currently lines 73-76)
- Modify: `plugin/skills/reflect/SKILL.md` (the `**Classify first.**` paragraph, currently line 117)
- Test: `tests/feedback-upstream-draft-conformance.test.js`, `tests/reflect-transcript-judge-prose.test.js`

**Interfaces:**
- Consumes (from Task 3): the flag spelling `--upstream <owner/name>`.
- Produces, for Task 5's intake verdict and Task 6's skill-graph rows: the contract's own name for the value the classifier hands over — `owner/name` when resolvable from the dependency's documented source, otherwise the dependency's bare name, treated as an unresolved target.

- [ ] **Step 1: Rewrite the third-party rule**

In `plugin/skills/_shared/learning-routing.md`, replace:

```
**Non-claude-tweaks upstream.** Filing an issue *against* a third-party
dependency's own repository (superpowers, an MCP server, another plugin) is
**not** a D5 filing and is out of this contract's scope. Report it to the user,
name the owner, and stop.
```

with:

```
**Non-claude-tweaks upstream.** Filing an issue *against* a third-party
dependency's own repository (superpowers, an MCP server, another plugin) is
**not** a D5 filing and is out of this contract's scope. It is not a dead end
either. Name the owner — `owner/name` when the dependency's documented source
resolves to one, otherwise the dependency's bare name — and hand the learning to
`/claude-tweaks:feedback --upstream <value>`, whose draft-only path scrubs the
report, writes it to disk, and hands the human a paste-ready command. That path
publishes nothing: a bare name is treated as an unresolved target and drafted
with a placeholder, and no repository is ever written to on the user's behalf.
```

The rule-7 clarification paragraph immediately below (`This does not conflict with rule 7. ...`)
is unchanged.

- [ ] **Step 2: Add the reflect sentence**

In `plugin/skills/reflect/SKILL.md`, the `**Classify first.**` paragraph currently ends:

```
... a high-cost insight (repeated retries, a reverted decision) weighs toward D1-D3 direct action; `unclear` is not itself a reason to drop.
```

Append this sentence to the end of that same paragraph (same line, one space after the final
period):

```
An insight the classifier routes to a **third-party** owner rather than to claude-tweaks is handed to `/claude-tweaks:feedback --upstream <owner/name>` inline — draft-only, nothing published — so it is never a `U#` Review Console row and never uses `--pre-confirmed`.
```

- [ ] **Step 3: Run the conformance test and confirm (1) now passes**

Run: `node --test tests/feedback-upstream-draft-conformance.test.js`

Expected: all 5 PASS.

- [ ] **Step 4: Confirm no other consumer restated the retired clause**

Run: `grep -rn "name the owner, and stop" plugin/ docs/ tests/`

Expected: no output — the clause was stated once, in the contract, and consumers cite rather than restate it.

- [ ] **Step 5: Run reflect's own prose suite**

Run: `node --test tests/reflect-transcript-judge-prose.test.js`

Expected: 6 failures — exactly the count `sweep-baseline.txt` records for this file (it is an environmental pre-existing, not a regression). Any seventh failure is a regression from Step 2.

- [ ] **Step 6: Commit**

```bash
git add plugin/skills/_shared/learning-routing.md plugin/skills/reflect/SKILL.md
```

```bash
git commit -m "Route the third-party learning rule to --upstream — learning-routing hands off instead of stopping, reflect names the inline path

Claude-Session: https://claude.ai/code/session_01RiCXcUa95YrY58fczMQxhj"
```

---

### Task 5: `intake/SKILL.md`'s `upstream:<owner/name>` verdict

**Files:**
- Modify: `plugin/skills/intake/SKILL.md` (Step 3's verdict table and bullet list, Step 4's override grammar, Step 6's writer table and processing order, Step 7's Actions Performed vocabulary)
- Modify: `tests/intake-conformance.test.js` (`VERDICT_ORDER`, and the eight-row test's name and message)

**Interfaces:**
- Consumes (from Task 4): the contract's rewritten "Non-claude-tweaks upstream" rule and the bare-name-is-unresolved allowance.
- Produces: the verdict token `upstream:<owner/name>`, placed at index 4 of `VERDICT_ORDER` — immediately after `upstream` — and the writer call `Skill(skill: "claude-tweaks:feedback", args: "<text> --upstream <owner/name>")`.

Placement rationale, so the implementer does not have to re-derive it: `VERDICT_ORDER` is
first-match-wins and mirrors the table top-to-bottom. `upstream` (a claude-tweaks defect) and
`upstream:<owner/name>` (a third-party defect) are mutually exclusive by subject, so relative order
between the two is free; adjacency is what makes the table readable, and the existing
parameterized verdict `absorb:#N` already sits at index 2 without a separate unparameterized twin,
so there is no precedent pushing parameterized verdicts to the end.

- [ ] **Step 1: Update the test pin first**

In `tests/intake-conformance.test.js`, replace:

```js
const VERDICT_ORDER = ['drop', 'shipped', 'absorb:#N', 'upstream', 'remember', 'file', 'nudge', 'not-here'];
```

with:

```js
const VERDICT_ORDER = ['drop', 'shipped', 'absorb:#N', 'upstream', 'upstream:<owner/name>', 'remember', 'file', 'nudge', 'not-here'];
```

and replace:

```js
test('the verdict table has exactly eight `| `verdict` |` rows in the designed order', () => {
```

with:

```js
test('the verdict table has exactly nine `| `verdict` |` rows in the designed order', () => {
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `node --test tests/intake-conformance.test.js`

Expected: the verdict-table test FAILS with a `deepEqual` diff showing the live table's eight rows against the expected nine. Every other test in the file passes.

- [ ] **Step 3: Add the verdict to Step 3's table**

In `plugin/skills/intake/SKILL.md`, insert this row immediately after the `` | `upstream` | ... | `` row:

```
| `upstream:<owner/name>` | A defect or gap in a **third-party** dependency — drafted for its owner, never filed by this repo. |
```

Then change Step 3's lead-in from:

```
Judge every fragment against exactly these eight verdicts, in this order — **first match wins**:
```

to:

```
Judge every fragment against exactly these nine verdicts, in this order — **first match wins**:
```

- [ ] **Step 4: Add the explanatory bullet**

Insert this bullet immediately after the existing `- **`upstream`** — ...` bullet and before
`- **`remember`** — ...`:

```
- **`upstream:<owner/name>`** — `_shared/learning-routing.md`'s "Non-claude-tweaks upstream" rule: the fragment's subject is owned by a third-party dependency (superpowers, an MCP server, another plugin), not by claude-tweaks. Unlike `upstream`, `$SELF_REPO` never removes this verdict — it is about someone else's repository either way. When the classifier can name the dependency but not its repository, the parameter is that bare name, which the draft path handles as an unresolved target rather than rejecting.
```

(No bare `/feedback` in this bullet — `tests/intake-conformance.test.js` assertion (h) forbids a
bare slash-skill reference in a non-table line inside a Step body.)

- [ ] **Step 5: Extend Step 4's override-grammar example**

Replace:

```
**Override grammar.** One or more `F{n} {verdict}` pairs, comma-separated, a parameterized verdict carrying its parameter inline — e.g. `F1 file, F3 absorb:#573, F4 drop, F6 not-here`. A `nudge` row cannot be answered in an override — its answer belongs to Step 5. Re-render only the changed rows; no second question.
```

with:

```
**Override grammar.** One or more `F{n} {verdict}` pairs, comma-separated, a parameterized verdict carrying its parameter inline — e.g. `F1 file, F3 absorb:#573, F4 drop, F5 upstream:obra/superpowers, F6 not-here`. A `nudge` row cannot be answered in an override — its answer belongs to Step 5. Re-render only the changed rows; no second question.
```

- [ ] **Step 6: Add the Step 6 writer row and processing-order entry**

Insert this row into Step 6's writer table immediately after the `` | `upstream` | ... | `` row:

```
| `upstream:<owner/name>` | `Skill(skill: "claude-tweaks:feedback", args: "<text> --upstream <owner/name>")` |
```

Then replace processing-order item 3:

```
3. Every `upstream`, in fragment order, each its own `Skill(skill: "claude-tweaks:feedback", args: "<text>")` call — `/claude-tweaks:feedback`'s own scrub and confirm gate still applies; no pre-approved fast-path flag is used here.
```

with:

```
3. Every `upstream` and `upstream:<owner/name>`, in fragment order, each its own `Skill(skill: "claude-tweaks:feedback", args: "<text>")` call — plus ` --upstream <owner/name>` for the parameterized form. `/claude-tweaks:feedback`'s own scrub gate applies to both; its confirm gate applies to `upstream` only, since the parameterized form publishes nothing to confirm. No pre-approved fast-path flag is used here.
```

- [ ] **Step 7: Extend Step 7's Actions Performed vocabulary**

Replace:

```
- `### Actions Performed` — `| Action | Detail | Ref |`, one row per non-`drop`/`shipped`/`not-here` fragment: `Filed #N`, `Absorbed into #N`, `Upstream #N`, `Remembered <file>`, or `Failed — {error}`.
```

with:

```
- `### Actions Performed` — `| Action | Detail | Ref |`, one row per non-`drop`/`shipped`/`not-here` fragment: `Filed #N`, `Absorbed into #N`, `Upstream #N`, `Upstream draft <absolute path>` (the `upstream:<owner/name>` verdict, which produces a draft and a hand-off command rather than an issue number), `Remembered <file>`, or `Failed — {error}`.
```

- [ ] **Step 8: Run the intake suite and the dogfood check**

Run: `node --test tests/intake-conformance.test.js`

Expected: all PASS.

The Decisions section's maintenance rule ("Any change to Steps 2-6 re-runs the graded dogfood
check") applies — this task changes Steps 3, 4, and 6. Run:

Run: `node -p "const fs=require('fs');const d=fs.readFileSync('tests/fixtures/intake-sample-dump.md','utf8').split('\n').filter(l=>l.trim()).length;const e=[...fs.readFileSync('tests/fixtures/intake-sample-dump.expected.md','utf8').matchAll(/^\| \d+ \|/gm)].length;JSON.stringify({dumpLines:d,expectedRows:e})"`

Expected: `dumpLines` equals `expectedRows` (test (i) pins this). Then read
`tests/fixtures/intake-sample-dump.md` and `tests/fixtures/intake-sample-dump.expected.md` and
judge each expected verdict against the nine-verdict order. Any fragment whose subject is a
third-party dependency must now read `upstream:<owner/name>` rather than `upstream` or
`not-here`; update the expected fixture in this same commit if so, and state in the PR body which
rows changed (or that none did).

- [ ] **Step 9: Commit**

```bash
git add plugin/skills/intake/SKILL.md tests/intake-conformance.test.js tests/fixtures/intake-sample-dump.expected.md
```

```bash
git commit -m "Add intake's upstream:<owner/name> verdict — third-party fragments delegate to feedback --upstream, VERDICT_ORDER pinned at nine

Claude-Session: https://claude.ai/code/session_01RiCXcUa95YrY58fczMQxhj"
```

(If Step 8 changed no fixture row, drop `tests/fixtures/intake-sample-dump.expected.md` from the
`git add`.)

---

### Task 6: Consumer sweep, docs registration, and the full-suite gate

**Files:**
- Modify: `docs/skill-graph.md` (`## feedback`, `## intake`, `## reflect`)
- Modify: `docs/plugin-structure.md` (the per-skill sub-file table's `feedback` row, currently line 105)
- Read-only verification, **no edits expected**: `plugin/skills/code-health/filing.md`, `plugin/skills/harness-health/filing.md`, `plugin/skills/harness-health/SKILL.md`, `plugin/skills/docs-health/SKILL.md`, `plugin/skills/journey-health/SKILL.md`, `plugin/skills/wrap-up/upstream-feedback.md`, `plugin/skills/wrap-up/review-console.md`, `plugin/skills/help/context-flow.md`
- Test: the full suite

**Interfaces:**
- Consumes: Task 2's sub-file name `upstream-draft.md`; Task 3's flag spelling; Task 5's verdict token `upstream:<owner/name>`.
- Produces: nothing downstream — this is the closing task.

- [ ] **Step 1: Add the `/intake` row under `## feedback`**

In `docs/skill-graph.md`'s `## feedback` section, insert this row immediately after the
`` | `/wrap-up` | ... | `` row:

```
| `/intake` | Intake's `upstream` verdict delegates a claude-tweaks-owned fragment as a plain `Skill(skill: "claude-tweaks:feedback", args: "<text>")` call; its `upstream:<owner/name>` verdict appends `--upstream <owner/name>`, entering this skill's draft-only path (`upstream-draft.md`) instead of the filing path — scrub gate on both, confirm gate on the first only. This is the edge's single statement; `## intake`'s own `/feedback` row points here. |
```

- [ ] **Step 2: Update the `_shared/learning-routing.md` row under `## feedback`**

Replace:

```
| `_shared/learning-routing.md` | This skill is the contract's D5 writer — Steps 2-3 read the classifier directly to confirm a learning is D5 and to re-run it from rule 4 on self-reference collapse. |
```

with:

```
| `_shared/learning-routing.md` | This skill is the contract's D5 writer — Steps 2-3 read the classifier directly to confirm a learning is D5 and to re-run it from rule 4 on self-reference collapse. It is also the terminal action of the contract's "Non-claude-tweaks upstream" rule: a third-party-owned learning is handed to `--upstream <owner/name>`'s draft-only path (`upstream-draft.md`), which scrubs, persists, and hands off a paste-ready command while publishing nothing. |
```

- [ ] **Step 3: Update `## intake`'s `/feedback` row to point rather than duplicate**

Replace:

```
| `/feedback` | Every `upstream` verdict delegates as a plain `Skill(skill: "claude-tweaks:feedback", args: "<text>")` call — feedback's own scrub and confirm gate stays; never called when `$SELF_REPO` is true. |
```

with:

```
| `/feedback` | Every `upstream` verdict delegates as a plain `Skill(skill: "claude-tweaks:feedback", args: "<text>")` call — feedback's own scrub and confirm gate stays; never called when `$SELF_REPO` is true. The `upstream:<owner/name>` verdict's `--upstream` delegation is stated once, in `## feedback`'s `/intake` row. |
```

- [ ] **Step 4: Update `## reflect`'s `/feedback` row**

Replace:

```
| `/feedback` | Insights classified via `_shared/learning-routing.md` that resolve to D5 route to `/feedback` for upstream filing. |
```

with:

```
| `/feedback` | Insights classified via `_shared/learning-routing.md` that resolve to D5 route to `/feedback` for upstream filing; an insight whose owner is a third-party dependency instead routes inline to `/feedback --upstream <owner/name>`'s draft-only path (Step 3's "Classify first") — never a `U#` Review Console row, never `--pre-confirmed`. |
```

- [ ] **Step 5: Register the sub-file in `docs/plugin-structure.md`**

On the `| feedback | ... |` row of the per-skill sub-file table, change the file-list cell from:

```
session-evaluation.md, bare-invocation.md, pre-confirmed.md
```

to:

```
session-evaluation.md, bare-invocation.md, pre-confirmed.md, upstream-draft.md
```

and append this sentence to the end of that row's notes cell (immediately before the closing `|`,
after the existing `... — #2697's mode-body split` text):

```
. upstream-draft.md holds the draft-only `--upstream <owner/name>` path — self-target guard and normalization (its sole home), the retargeted advisory dedup, the adapted draft template, persistence via `staged/upstream-draft-{N}.md` or a session-scoped scratch path, and the paste-ready `gh issue create` hand-off — read only when `--upstream` was passed, and it never files (#2759)
```

- [ ] **Step 6: Verify the eight consumer files need no edit**

Read each file in full and confirm the stated reason. Record one line per file for the PR body.

```bash
grep -n "feedback\|learning-routing\|upstream" plugin/skills/code-health/filing.md plugin/skills/harness-health/filing.md plugin/skills/harness-health/SKILL.md plugin/skills/docs-health/SKILL.md plugin/skills/journey-health/SKILL.md
```

Expected reason for all five: their "Subject check (health sweeps)" citation routes
**claude-tweaks-owned** findings to D5. The third-party branch is a different rule in the same
contract and does not touch the subject check, so no edit.

```bash
grep -n "wrap-up-upstream\|upstream-unfiled\|upstream-draft" plugin/skills/wrap-up/upstream-feedback.md plugin/skills/wrap-up/review-console.md
```

Expected reason for both: they scan `staged/wrap-up-upstream-*.md`, a glob the new
`upstream-draft-{N}.md` name deliberately sits outside, so neither re-enumerates a hand-off draft.
No edit.

```bash
grep -n "feedback" plugin/skills/help/context-flow.md
```

Expected: two rows — `/intake`'s "delegates ... upstream learnings to `/feedback`" and
`/feedback`'s own "A GitHub issue against `thomasholknielsen/claude-tweaks` (human-invoked, after
explicit scrub + confirmation)". Both describe what this skill *files*, which is unchanged: it
still files only at claude-tweaks. The draft path produces no issue and so adds nothing to a
column describing what lands in a tracker. No edit.

**If any of these reads contradicts its expected reason, stop and report it** rather than editing
opportunistically — the spec scoped this sweep verify-only, and a real finding here is a scope
change to surface, not a fix to fold in.

- [ ] **Step 7: Exercise the path end-to-end (AC 1, AC 2, AC 4)**

Five invocations, each run in this session, each transcript quoted in the PR body. Every one of
them must show **zero** `gh issue create`, `gh issue comment`, or `bin/file-feedback.js` calls.

1. **AC 1 — the resolvable-target happy path.**
   `/claude-tweaks:feedback "agent-browser exposes no screencast or frame-capture operation, which blocks any demo-recording capability" --upstream vercel-labs/agent-browser`
   Expect: a scrubbed draft at a reported absolute path; a rendered
   `gh issue create --repo vercel-labs/agent-browser --title '…' --body-file <that path>` line; the
   web fallback `https://github.com/vercel-labs/agent-browser/issues/new`. Confirm the file exists
   on disk (`ls -l <that path>`) and that its first line is the
   `<!-- upstream-draft: vercel-labs/agent-browser | gap | drafted … -->` header.
2. **AC 2 — self-target, bare slug.** Same learning text with `--upstream thomasholknielsen/claude-tweaks`.
   Expect: "names claude-tweaks itself; filing normally", then Steps 3-9 run — stop at Step 7's
   confirm gate rather than filing.
3. **AC 2 — self-target, https + `.git`.** `--upstream https://github.com/thomasholknielsen/claude-tweaks.git`. Same expectation.
4. **AC 2 — self-target, SSH + mixed case.** `--upstream git@github.com:ThomasHolkNielsen/claude-tweaks`. Same expectation — the lower-casing rule is what makes this one resolve.
5. **AC 2 — unresolved target.** `--upstream agent-browser`.
   Expect: the draft is still produced; the hand-off carries the literal `<owner/name>`; the dedup
   search is skipped with a one-line note; the persisted file's header reads
   `target: unresolved (agent-browser)`.

Then **AC 4 — the scrub stop.** Invoke the path with a learning whose repro is only intelligible
via private content, e.g.
`/claude-tweaks:feedback "agent-browser's locator resolution fails on our internal admin console — repro needs the page source at C:/repos/<private>/app/admin.tsx lines 40-90 and the session token in .env.local" --upstream vercel-labs/agent-browser`
Expect: Step 6's unconditional stop fires, **no** file is written anywhere (verify the run's
`staged/` and the session temp root gained nothing), and the report says the learning is
unfileable as-is.

Delete every draft file these probes wrote before moving on, and say so in the PR body.

- [ ] **Step 8: Prove the escaping rule against a live throwaway repository (AC 5)**

This is the live half of AC 5; Task 2 Step 5 already proved the escaping deterministically offline.

```bash
gh repo create ct-2759-escape-probe --private --confirm
```

Write `/tmp/ct-2759-body.md` with the Write tool (one line: `Shell-injection probe for #2759. Safe to delete.`), then run the hand-off command exactly as `upstream-draft.md` Step E renders it for a title of `it's $(rm -rf x)`:

```bash
gh issue create --repo "$(gh api user --jq .login)/ct-2759-escape-probe" --title 'it'\''s $(rm -rf x)' --body-file /tmp/ct-2759-body.md
```

Then read the created title back:

```bash
gh issue list --repo "$(gh api user --jq .login)/ct-2759-escape-probe" --json number,title
```

Expected: `"title": "it's $(rm -rf x)"` — the literal text, with no command substitution performed
and no file removed. Quote this JSON in the PR body.

Clean up:

```bash
gh repo delete "$(gh api user --jq .login)/ct-2759-escape-probe" --yes
```

If `gh repo delete` reports a missing `delete_repo` scope, run
`gh auth refresh -h github.com -s delete_repo` and retry. If the scope cannot be granted, **stop
and report the stray repository by name** rather than leaving it undeclared.

- [ ] **Step 9: Run the full suite**

Write `/tmp/ct-2759-full-suite.sh` with the Write tool (no heredoc):

```bash
#!/usr/bin/env bash
export CT_HOOKS_GIT_TIMEOUT_MS=60000
cd "C:/repos/claude-tweaks/.claude/worktrees/flow+spec-2697-2757-2758-2759"
node --test 'tests/**/*.test.js' 'tools/upstream-drift/tests/**/*.test.js' 2>&1 | tail -60
```

Run: `bash /tmp/ct-2759-full-suite.sh`

Expected: the `# fail` line at or below the run's environmental baseline of **395**. Compare the
per-file failure counts against
`.claude-tweaks/pipelines/2026-09-21T213441-spec-2697-2757-2758-2759/sweep-baseline.txt`. A file
whose count exceeds its baseline line — or a failing file absent from the baseline — is a
regression; re-run that one file in isolation (`node --test path/to/file.test.js`) before
concluding anything. Quote the raw tail output in the PR body; never summarize it.

- [ ] **Step 10: Spot-check the new and touched suites in isolation**

Run: `node --test tests/feedback-upstream-draft-conformance.test.js tests/intake-conformance.test.js tests/skill-mode-split-conformance.test.js tests/bin-lib/skill-audit/anti-patterns.test.js tests/tidy-unfiled-backstop.test.js tests/feedback-dedup-search-scrub-conformance.test.js`

Expected: 0 failures across all six files.

- [ ] **Step 11: Commit**

```bash
git add docs/skill-graph.md docs/plugin-structure.md
```

```bash
git commit -m "Register the upstream-draft path in the docs graph — feedback/intake/reflect edges and the feedback sub-file row

Claude-Session: https://claude.ai/code/session_01RiCXcUa95YrY58fczMQxhj"
```

---

## Acceptance Criteria → Task Map

| AC | Where it is satisfied |
|---|---|
| 1. Draft on disk + rendered `gh issue create` + web fallback, nothing filed | Task 2 Steps 1-3 (the path, and the grep proving the filing CLI is never named); demonstrated by Task 6 Step 7 probe 1 |
| 2. Three self-target forms return to Step 3; a bare name drafts with the placeholder | Task 2 Step 1 (Step A's normalization table, self-target rule, and U1/U2/U3); demonstrated by Task 6 Step 7 probes 2-5 |
| 3. No-`--upstream` invocation unchanged; diff limited to the routing paragraph + Anti-Patterns row | Task 3 Step 9 |
| 4. Unscrubbable learning stops with nothing written | Task 2 Step 1 (Step D's "If the learning cannot survive the scrub, stop", placed *before* persistence); demonstrated by Task 6 Step 7's AC 4 probe |
| 5. `it's $(rm -rf x)` is neutralized | Task 2 Step 5 (offline proof) and Task 6 Step 8 (live throwaway-repo proof) |
| 6. Routing paragraph contains `--upstream` and `publishes nothing`, not `and stop` | Task 4 Steps 1, 3; conformance assertion (1) |
| 7. Anti-Patterns row count unchanged, row keeps the literal slug | Task 3 Steps 7, 10; conformance assertion (2) |
| 8. `intake-conformance` passes with the new verdict; `tidy-unfiled-backstop` still passes | Task 5 Step 8; Task 6 Step 10 |
| 9. `feedback/SKILL.md` grows by at most 1.5 KB | Task 3 Steps 1, 8 |
| 10. Full `npm test` equivalent passes, new file's five assertions included | Task 6 Steps 9, 10 |
