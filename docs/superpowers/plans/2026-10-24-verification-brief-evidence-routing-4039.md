# Verification-Brief Evidence Routing (#4039) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `verification-brief.md` Step 4 check the run branch's PR state before committing demo-evidence screenshots, so evidence never lands on an already-merged branch.

**Architecture:** Skill-prose change to Step 4's **Screenshot commit** paragraph, reusing the existing `resolvePrState` branch→PR join (`plugin/bin/lib/reconcile/pr-state.js`) via a `node -e` read, plus one example row in wrap-up's summary template and one new conformance suite pinning the routing.

**Tech Stack:** Markdown skill prose; `node --test` (built-in).

**Spec:** `.claude-tweaks/pipelines/2026-10-24T110909-spec-4039/work/4039-spec.md`

## Global Constraints

- Under `integration-model: local-merge`, behavior is unchanged: commit on the current branch, no push, no PR.
- The evidence PR references the record as `Refs #{record}` — never `Fixes`/`Closes`/`Resolves`.
- The evidence PR is never auto-merged.
- Do not reorder the Review Console or Phase 4 (that is #3813's scope).
- Never write the literal tokens `TBD`/`TODO` in authored prose.
- `plugin/skills/wrap-up/verification-brief.md` is 24,449 B against the 52,500 B rail (`plugin/bin/lib/skill-audit/budgets.js`); this change adds ~2.5 KB — headroom stays above 25 KB. `summary-template.md` is 19,005 B; it gains one table row and a few words.

## Review Focus

1. **A branch with more than one PR (closed, then reopened and merged)** — the merged PR must govern, so the evidence goes to its own PR. `resolvePrState` already tie-breaks merged-wins; the prose must say so, and the test asserts that sentence.
2. **`gh` absent or a failed read** — must never fall through to a blind commit on the possibly dead branch; the prose routes it to the evidence-branch route, and the test asserts it.
3. **A second late re-run when `demo-evidence/{record}` already exists** (locally or on `origin`) — `git switch -c` or the push would fail; the prose names a free-suffix rule, and the test asserts it.
4. **A local edit that blocks `git switch`** — the brief must say why the screenshots are missing rather than silently omit them; the test asserts the sentence.
5. **A `local-merge` run** — must not read PR state at all; the test asserts the local-merge sentence is unchanged in meaning.

---

### Task 1: Route Step 4's screenshot commit on the run PR's state

**Files:**
- Create: `tests/verification-brief-evidence-routing.test.js`
- Modify: `plugin/skills/wrap-up/verification-brief.md:244-255` (the **Screenshot commit** paragraph and its `git add`/`git commit` fence)
- Modify: `plugin/skills/wrap-up/summary-template.md:236-252` (Actions Performed table + its "Generate from" sentence)

**Interfaces:**
- Consumes: `resolvePrState(repoRoot: string, branch: string) → {number, state, ...} | null | 'gh-absent' | 'network-failure'` from `plugin/bin/lib/reconcile/pr-state.js` (existing, unchanged). Probed read-only at authoring time from this worktree: `worktree-flow-spec-4039 → OPEN #4122`, `worktree-sweep-trail-landing → MERGED #4075`, `demo-evidence-no-such-branch-4039 → null`.
- Consumes: `readText(absPath)` from `tests/helpers/read-skill.js` (existing).
- Produces: nothing other tasks use.

- [ ] **Step 1: Write the failing test**

Create `tests/verification-brief-evidence-routing.test.js`:

```js
'use strict';
// #4039: verification-brief Step 4 routes the demo-evidence screenshot commit on
// the run PR's state, so evidence never lands on an already-merged branch.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { readText } = require('./helpers/read-skill');

const SKILLS = path.join(__dirname, '..', 'plugin', 'skills');
const read = (rel) => readText(path.join(SKILLS, rel));

function step4(doc) {
  const start = doc.indexOf('## Step 4: Compose and post the brief');
  assert.ok(start >= 0, 'missing Step 4 heading');
  const next = doc.indexOf('\n## ', start + 1);
  return doc.slice(start, next < 0 ? undefined : next);
}

// One routing bullet, from its bold opener to the next bullet or blank line.
function bullet(s, opener) {
  const start = s.indexOf(opener);
  assert.ok(start >= 0, `missing routing bullet ${opener}`);
  const ends = ['\n- **', '\n\n'].map((m) => s.indexOf(m, start + 1)).filter((i) => i >= 0);
  return s.slice(start, ends.length ? Math.min(...ends) : undefined);
}

const OPEN = '- **Open PR (`OPEN`)**';
const GONE = '- **Merged or closed PR (`MERGED`/`CLOSED`)**';
const NONE = '- **No PR (`no-pr`)**';
const UNREADABLE = '- **State unreadable (`gh-absent`, `network-failure`)**';

// Every routing assertion in one function, so the go-red control below runs the
// exact code the positive test runs.
function assertRouting(s) {
  const check = s.indexOf("**Check the branch's PR before committing");
  const commit = s.indexOf('git commit -m "Add demo evidence screenshots');
  assert.ok(check >= 0, 'missing the PR-state check paragraph');
  assert.ok(commit > check, 'the PR-state check must come before the screenshot commit');
  assert.match(s, /resolvePrState/);
  assert.match(s, /a merged PR wins when the branch has several/);
  assert.ok(s.includes('`git branch --show-current`'), 'branch name read as its own call');
  assert.ok(!s.includes('$(git'), 'no git inside a command substitution — refused in a worktree session');

  const open = bullet(s, OPEN);
  assert.match(open, /push that commit straight away/);
  assert.ok(open.includes('`git push origin {branch}`'));

  const gone = bullet(s, GONE);
  assert.match(gone, /never commit to the dead branch/);
  assert.ok(gone.includes('`git switch -c demo-evidence/{record} origin/{integration-branch}`'));
  assert.ok(gone.includes('commit only `docs/demo-evidence/{record}/`'));
  assert.ok(gone.includes('`git push -u origin demo-evidence/{record}`'));
  assert.ok(gone.includes('`Refs #{record}`'));
  assert.ok(gone.includes('never `Fixes`, `Closes`, or `Resolves`'));
  assert.match(gone, /left open for a human to merge and is never auto-merged/);
  assert.match(gone, /this evidence commit's SHA, never the dead branch's/);
  assert.match(gone, /already taken/);
  assert.ok(gone.includes('`git switch -`'));
  assert.match(gone, /say in it why they are missing/);

  assert.match(bullet(s, NONE), /commit and push as for an open PR/);
  const unreadable = bullet(s, UNREADABLE);
  assert.match(unreadable, /never commit to it blind/);
  assert.ok(unreadable.includes('mcp__github__create_pull_request'));
  assert.ok(unreadable.includes('_shared/github-write-transport.md'));

  assert.ok(s.includes('--section "/wrap-up"'), 'routing is logged under /wrap-up');
  assert.match(s, /name the evidence PR's URL in the brief/);
  assert.ok(s.includes('**`integration-model: local-merge`** — no PR to read: commit on the current branch as below, with no push and no PR.'));
}

test('AC1.1 AC2.1 AC3.1 AC4.1 AC5.1 AC6.1 AC7.1: Step 4 routes the screenshot commit on the PR state', () => {
  assertRouting(step4(read('wrap-up/verification-brief.md')));
});

test('AC6.1: the wrap-up summary carries an evidence-PR row in Actions Performed', () => {
  const doc = read('wrap-up/summary-template.md');
  const table = doc.slice(doc.indexOf('### Actions Performed'));
  assert.ok(table.includes('| Operational | Opened evidence PR #{m} ({url}) for #{n}'), 'missing evidence-PR row');
  assert.match(table, /the Verification Brief's evidence PR/);
});

test('AC8.1: removing the merged-or-closed route turns the routing assertions red', () => {
  const s = step4(read('wrap-up/verification-brief.md'));
  const gone = bullet(s, GONE);
  assert.throws(() => assertRouting(s.replace(gone, '')));
});
```

Waived AC9.1: suite-level criterion (`npm test` passes) — proven by Common Step 5's full-suite run, not a unit assertion.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/verification-brief-evidence-routing.test.js`
Expected: FAIL — `missing the PR-state check paragraph` (and the summary-row test fails on `missing evidence-PR row`; the AC8.1 control fails because `bullet` cannot find the merged-or-closed opener).

- [ ] **Step 3: Rewrite Step 4's Screenshot commit paragraph and add the summary row**

In `plugin/skills/wrap-up/verification-brief.md`, replace this exact block (lines 244-255):

````
**Screenshot commit** (`app-route`/`rendered-page` plans whose Step 2.5 walk completed, with screenshots from Step 3): commit the 1-3 selected
screenshots to `docs/demo-evidence/{record}/{NN}-{description}.png` on this run's current branch
— `{record}` is the issue number (`github-issues`) or record id (`local-files`); `{NN}` is a
zero-padded sequence starting at `01`; `{description}` is a short kebab-case label matching the
screenshot's content (e.g. `settings-toggle-persisted`). Commit before composing the template
below — the embed needs the committed SHA.

```bash
git add docs/demo-evidence/{record}/
git commit -m "Add demo evidence screenshots for #{record}"
```
````

with:

````
**Screenshot commit** (`app-route`/`rendered-page` plans whose Step 2.5 walk completed, with screenshots from Step 3): commit the 1-3 selected
screenshots to `docs/demo-evidence/{record}/{NN}-{description}.png` — `{record}` is the issue
number (`github-issues`) or record id (`local-files`); `{NN}` is a zero-padded sequence starting
at `01`; `{description}` is a short kebab-case label matching the screenshot's content (e.g.
`settings-toggle-persisted`). Commit before composing the template below — the embed needs the
committed SHA. Which branch the commit lands on is decided first.

**Check the branch's PR before committing (`integration-model: pr-first`, #4039).** This run's
current branch is a safe home for the evidence only while its PR is still open. Acceptance
labeling can run after that PR merged — a re-run after a `BLOCKED` verify verdict, or a console
merge that ran before Phase 4 — and a commit on a merged branch never reaches the integration
branch. Read the branch's governing PR with the existing resolver (`bin/lib/reconcile/pr-state.js`'s
`resolvePrState`; a merged PR wins when the branch has several). Run `git branch --show-current`
as its own Bash call first and pass the name in literally — a `git` inside `$(...)` is refused in
a worktree session (`_shared/scratch-worktree.md` §7):

```bash
node -e "const s=require('${CLAUDE_PLUGIN_ROOT}/bin/lib/reconcile/pr-state.js').resolvePrState(process.cwd(), process.argv[1]); console.log(typeof s === 'string' ? s : s ? s.state + ' ' + s.number : 'no-pr')" "{branch}"
```

It prints `OPEN {n}`, `MERGED {n}`, `CLOSED {n}`, `no-pr`, `gh-absent`, or `network-failure`.
Route on it:

- **Open PR (`OPEN`)** — commit on the current branch (the fence below), then push that commit straight away, as its own Bash call: `git push origin {branch}`. The run's later phase-exit push would carry it, but a re-run after that push has none.
- **Merged or closed PR (`MERGED`/`CLOSED`)** — never commit to the dead branch. Fetch the integration branch (`_shared/integration-branch.md`), then `git switch -c demo-evidence/{record} origin/{integration-branch}`, commit only `docs/demo-evidence/{record}/` there, and `git push -u origin demo-evidence/{record}` — one Bash call each. When that branch name is already taken locally or on `origin` (an earlier re-run left it), append `-2`, `-3`, … and use the first free name. Open an evidence-only PR against `{integration-branch}` whose body references the record as `Refs #{record}` — never `Fixes`, `Closes`, or `Resolves`: the record's closure belongs to its original PR. The evidence PR is left open for a human to merge and is never auto-merged — no `auto:merge` grant covers it. `{commit-sha}` in the embed below is this evidence commit's SHA, never the dead branch's. Then `git switch -` back, so the rest of wrap-up runs on the branch it expects. If either switch refuses (a local edit conflicts), skip the screenshot commit, compose the brief without embedded screenshots, and say in it why they are missing.
- **No PR (`no-pr`)** — a degraded run that never opened one: commit and push as for an open PR.
- **State unreadable (`gh-absent`, `network-failure`)** — the branch cannot be shown to be live, so never commit to it blind: take the merged-or-closed route. With `gh` absent, open the evidence PR through `mcp__github__create_pull_request` (`_shared/github-write-transport.md`'s PR create exception — PR reads have no MCP equivalent there, which is why the read itself degrades).

Log the route when a run directory resolves (`_shared/pipeline-run-dir.md`):

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/log-decision.js" --run "$PIPELINE_RUN_DIR" --section "/wrap-up" --status AUTO --step "Verification Brief Step 4" --text "screenshot commit for #{record}: PR state {state} → {current branch | evidence PR #{m} ({url})}" --reversibility high
```

On the evidence-PR route, name the evidence PR's URL in the brief (one line under the
screenshots) and in wrap-up's Actions Performed (`summary-template.md`'s evidence-PR row).

**`integration-model: local-merge`** — no PR to read: commit on the current branch as below, with no push and no PR.

```bash
git add docs/demo-evidence/{record}/
git commit -m "Add demo evidence screenshots for #{record}"
```
````

In `plugin/skills/wrap-up/summary-template.md`, add this row to the Actions Performed table directly after the `| Operational | Removed worktree ...` row:

```
| Operational | Opened evidence PR #{m} ({url}) for #{n}'s demo screenshots — the run's own PR was already {merged \| closed} | — |
```

and in the "Generate from:" sentence below the table, change `cleanup actions executed in
Phase 4,` to `cleanup actions executed in Phase 4, the Verification Brief's evidence PR (when
Step 4 opened one),`.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/verification-brief-evidence-routing.test.js`
Expected: PASS — 3 tests, 0 fail.

Step 2's FAIL against the pre-change files is the go-red proof for the two positive tests; the AC8.1 control proves the routing assertions can fail on a mutated Step 4. Never use `git stash` for a revert check here (the stash is shared across worktrees).

- [ ] **Step 5: Run the suites that read these two files**

Run: `node --test tests/try-it-contract-conformance.test.js tests/pr-run-comments.test.js tests/verify-expectations-writer-conformance.test.js tests/comment-trust-conformance.test.js tests/timing-nested-parent-roster.test.js tests/verify-json-acceptance-guard-conformance.test.js tests/session-tmp-root-migration.test.js tests/demo-full-verification-pointer.test.js tests/timing-prose-conformance.test.js tests/ceremony-profile-roster.test.js`
Expected: PASS, 0 fail.

- [ ] **Step 6: Check `docs/REGISTRY.md`'s demo-evidence row**

Run: `grep -n "demo-evidence" docs/REGISTRY.md`
Expected: the row still reads "written by `/claude-tweaks:wrap-up`'s verification-brief step (`plugin/skills/wrap-up/verification-brief.md` Step 4)" — still accurate (the evidence PR is still written by Step 4), so no edit.

- [ ] **Step 7: Commit**

```bash
git add tests/verification-brief-evidence-routing.test.js plugin/skills/wrap-up/verification-brief.md plugin/skills/wrap-up/summary-template.md
git commit -m "Route verification-brief evidence on the run PR's state — refs #4039"
```
