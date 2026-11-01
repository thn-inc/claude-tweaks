# Stash guard: nothing-to-recover restore failure (#4787) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When `git stash store` writes nothing because the same commit is still at `stash@{0}`, `stash-guard.js compare --restore` reports a failed restore with no recover command (`command: null`), and the build prose that renders failed restores handles a null command.

**Architecture:** One CLI change in `plugin/bin/stash-guard.js`'s `restoreRemoved` (its `fail` helper takes the command, null for the nothing-written case) and `logItems` (FAILED line drops the `— recover with: …` clause for a null command), plus prose in the two `/build` skill files that consume `restoreFailed[].command`, the journey that describes the handoff, and the conformance pins over that prose.

**Tech Stack:** Node 18+ CommonJS, `node --test`, git CLI.

**Spec:** `.claude-tweaks/pipelines/2026-11-01T191928-record-4787/work/4787-spec.md`

Scope keywords: restoreFailed

## Global Constraints

- New error text, verbatim from the spec: `same commit still at stash@{0}; nothing to recover`.
- Decision (spec leaves "absent or null"): `restoreFailed[].command` is **`null`** for the nothing-written case — the key stays present so every `restoreFailed` element keeps the `{sha, subject, error, command}` shape the header comment documents; a JSON consumer tests `command === null`.
- Every other restore failure (a `git stash store` that exits non-zero) is unchanged: `command` is `storeCommand(subject, sha)`, the stderr line still reads `stash-guard.js: restore failed for {sha}; recover with:\n{command}\n`, and the FAILED line still ends `— recover with: {command}. Reversibility: n/a (write did not land).`
- Governing project skill `gh-api-module-pattern` (`.claude/skills/gh-api-module-pattern/cli-wrapper-contract.md`), quoted: "`stash-guard.js compare` is the one roster member that also hand-composes entries: `formatEntry` throws on `FAILED` (absent from `append.js`'s `STATUSES` by #1072's choice), so its restore-failure lines are literal `- FAILED {hms} — {step}: …` strings queued into the same `appendEntries` batch as its `formatEntry` `AUTO` lines." — the null-command FAILED line stays a hand-composed literal in the same batch; do not route it through `formatEntry`.
- Governing project skill `skill-prose-conformance-tests`, quoted: "**Retargeting existing pins: diff the assertion inventory, not the plan's prose anchor list.**" — Task 2 keeps every existing `STASH_GUARD_FACTS` / `HANDOFF_FACTS` literal matching (none is retired; the edits only add text), and adds new facts.
- Byte rail (`RAIL_BYTES` 52,500): `plugin/skills/build/dispatch.md` is 45,666 B at base — Task 2 adds ~300 B, headroom ~6.5 KB; `handoff-template.md` 5,917 B.
- Commit messages: `{Verb} {what} — {detail}`, reference the record as `refs #4787` (never `closes`/`fixes`).

## Review Focus

1. A real store failure (git exits non-zero) must keep its recover command, stderr block and FAILED clause — the null branch must be decided only by the "wrote nothing" re-read. Pinned by the existing `AC4.1: a forced restore failure…` test and the FAILED-line test near `tests/stash-guard.test.js:597`, both left unchanged and still green.
2. Mixed outcome (probe B: one entry restored, one nothing-written) — only the failed one has `command: null`; Task 1 adds that assertion to probe B.
3. `command` must serialize as JSON `null`, not be omitted — Task 1 asserts `'command' in entry` and `=== null`.
4. The handoff must never render `recover with:` followed by an empty or `null` command — Task 2's new handoff slot plus its parenthetical rule.
5. A subject containing the text `recover with` would make an absence check on stderr meaningless — Task 1's fixture subjects (`On main: twice`, `On main: between`) do not contain it, and AC1.1's stderr assertion is an exact equality, not only an absence check.

## Spec coverage map

| Spec item | Task |
|---|---|
| Deliverable 1 (CLI reword, drop recover clause, decide `command`) | Task 1 |
| Deliverable 2 (handoff template + dispatch.md stanza) | Task 2 |
| Deliverable 3 (update tests, each shown red by reverting) | Task 1 Step 2, Task 2 Step 2 |
| AC1.1 | Task 1 test `AC1.1: …` |
| AC2.1 | Task 2 tests `AC2.1: …` |
| AC3.1 | Task 1 Step 4 + Task 2 Step 4 (both files run together) |

---

### Task 1: CLI reports the nothing-written case without a recover command

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/stash-guard.js` (header comment lines 15-26; `restoreRemoved` lines 233-271; `logItems` lines 286-292)
- Test: `tests/stash-guard.test.js` (constant at line 266; probe A test at 268-290; probe B test at 292-309)

**Interfaces:**
- Produces: `restoreFailed[]` element `{sha: string, subject: string, error: string, command: string|null}` — `command` is `null` exactly when `error === 'same commit still at stash@{0}; nothing to recover'`, which the CLI reports only when the post-store re-read shows the count did not rise **and** that re-read's `stash@{0}` sha equals the entry's sha. A store that exited 0 but whose re-read shows neither a higher count nor the sha at `stash@{0}` (a sibling session dropped a copy in between) keeps `command: storeCommand(subject, sha)` with error `git stash store exited 0 but the entry is not back on the stack`, and today's recover-with stderr block and FAILED clause (plan review, Common Step 1.6).
- Stderr for a null command (one line): `stash-guard.js: restore failed for {sha}: same commit still at stash@{0}; nothing to recover\n`
- FAILED line for a null command: `- FAILED {hms} — Stash guard: {who} removed stash entry {sha} {subject}; restore failed: same commit still at stash@{0}; nothing to recover. Reversibility: n/a (write did not land).`

- [ ] **Step 1: Rewrite the probe A and probe B tests**

In `tests/stash-guard.test.js`, rename the constant at line 266 to `NOTHING_TO_RECOVER = /same commit still at stash@\{0\}; nothing to recover/` and update both of its users.

Rename the probe A test to `'AC1.1: stack [x, y, x] with stash@{2} dropped, then compare --restore: reported as a failed restore with no recover command (probe A)'` and replace its assertions from line 280 on with:

```js
  assert.equal(r.json.restoreFailed.length, 1);
  const failed = r.json.restoreFailed[0];
  assert.equal(failed.sha, x.sha);
  assert.equal(failed.subject, x.subject);
  assert.equal(failed.error, 'same commit still at stash@{0}; nothing to recover');
  assert.ok('command' in failed);
  assert.equal(failed.command, null);
  assert.equal(r.err, `stash-guard.js: restore failed for ${x.sha}: same commit still at stash@{0}; nothing to recover\n`);
  assert.doesNotMatch(r.err, /recover with/);
  assert.deepEqual(stack(dir), [x, y]);
  const text = decisionsOf(runDir);
  assert.equal(r.json.logged, true);
  assert.doesNotMatch(text, /restored via git stash store/);
  assert.doesNotMatch(text, /recover with/);
  const failedLine = text.split('\n').find((l) => l.startsWith('- FAILED '));
  assert.match(failedLine, /^- FAILED \d{2}:\d{2}:\d{2} — Stash guard: implementer for task 2 removed stash entry [0-9a-f]{40} On main: twice; restore failed: same commit still at stash@\{0\}; nothing to recover\. Reversibility: n\/a \(write did not land\)\.$/);
```

Keep lines 276-279 (`code 3`, `removed [x]`, `restored []`, `alreadyPresent []`) as they are — they are the "still reported as failed" half of AC1.1.

In probe B (line 292), after the existing `NOTHING_TO_RECOVER` match, add `assert.equal(r.json.restoreFailed[0].command, null);` and `assert.doesNotMatch(r.err, /recover with/);` (probe B's one restore succeeds and its one failure is nothing-written, so stderr carries no recover clause at all).

Leave `AC4.1: a forced restore failure…` (line 327) and the FAILED-line test near line 597 unchanged: they pin Review Focus 1.

Add a test `'a store that exits 0 but leaves a different sha at stash@{0} keeps its recover command (sibling drop race)'`: stack `[newer, older]` (two `stashPush` calls), snapshot, `git stash drop stash@{1}` (removes `older`), then `compare(dir, baseline, ['--restore'], { git: noopStore() })` where `noopStore()` is a new helper beside `failingStore` that returns `''` for `stash store` without running git and delegates everything else to `realGit`. Assert: `code` 3; `restoreFailed.length` 1; `restoreFailed[0].sha === older.sha`; `restoreFailed[0].error === 'git stash store exited 0 but the entry is not back on the stack'`; `restoreFailed[0].command === storeCommand(older.subject, older.sha)`; `r.err` matches `restore failed for ${older.sha}; recover with:`. This test is the one input on which only the new `stash@{0}` sha check decides the outcome: deleting that check turns it red (it would report `nothing to recover` with a null command).

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/stash-guard.test.js`
Expected: FAIL — the AC1.1 and probe B tests (error is still `same commit already at stash@{0} — git stash store wrote nothing`, `command` still a string) and the sibling-drop race test (error is still the old wrote-nothing text).

- [ ] **Step 3: Implement the null-command case in `plugin/bin/stash-guard.js`**

- `restoreRemoved`: change `fail` to `fail(error, command)`; the git-error call passes `storeCommand(entry.subject, entry.sha)` and keeps today's stderr block (`restore failed for {sha}; recover with:\n{command}\n`); the `!wrote` branch keeps the stack the post-store re-read returned and splits on its `[0].sha`: equal to `entry.sha` → `'same commit still at stash@{0}; nothing to recover'` with `command` `null` and the one-line stderr from the Interfaces block; otherwise → `'git stash store exited 0 but the entry is not back on the stack'` with `storeCommand(entry.subject, entry.sha)` and the recover-with stderr block. A failed re-read still counts as restored (today's "trust the exit code" rule, unchanged).
- `logItems`: the FAILED literal appends ` — recover with: ${f.command}` only when `f.command !== null`; both variants end `. Reversibility: n/a (write did not land).`
- Header comment (lines 15-26): say `command` is null for the nothing-written case, and quote the new error text in place of the old one.

- [ ] **Step 4: Run the suite file to verify it passes**

Run: `node --test tests/stash-guard.test.js`
Expected: PASS, 0 failures (including `AC4.1` and the forced-failure FAILED-line test, unchanged).

Discrimination proof (Deliverable 3): after committing, in a scratch checkout (the dispatch prompt's "Discrimination checks in a scratch checkout" steps — never the shared worktree in place), check out the task's base version of `plugin/bin/stash-guard.js` only, run `tests/stash-guard.test.js` there, and confirm the AC1.1, probe B and sibling-drop race tests go red while the unmutated scratch run is green. Quote both runs' summary lines in the task report.

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/stash-guard.js tests/stash-guard.test.js
git commit -m "Report a nothing-written stash restore without a recover command — refs #4787"
```

### Task 2: Build prose names the no-command case

**Role:** integration

**Files:**
- Modify: `plugin/skills/build/dispatch.md` (line 19, the `**Stash guard around every dispatch that can run git (#4559):**` paragraph only)
- Modify: `plugin/skills/build/handoff-template.md` (`### Stash guard (if any)` section, lines 37-44)
- Modify: `docs/journeys/keep-the-shared-stash-through-a-dispatched-build-4559.md` (line 50, the handoff Action bullet)
- Modify: `docs/plugin-structure.md` (line 209, the `stash-guard.js` row — Check B scope-creep add)
- Test: `tests/dispatch-no-stash-conformance.test.js` (`STASH_GUARD_FACTS` ~line 283, `HANDOFF_FACTS` ~line 370)
- No change (swept, classified): `docs/hooks.md:13` (the hook's `git stash store` exception still applies to every non-null command), `docs/superpowers/plans/2026-10-31-stash-guard.md` (shipped plan, history — never edited).

**Interfaces:**
- Consumes: Task 1's `command: null` contract and error text.

- [ ] **Step 1: Add the conformance facts**

Append to `STASH_GUARD_FACTS`:

```js
  paragraphFact('AC2.1 a null restoreFailed[].command logs a FAILED line with no recover clause', /or — when that `command` is null because the same commit is still at `stash@\{0\}` and `git stash store` wrote nothing — as a `FAILED` line that says there is nothing to recover and carries no command/),
  paragraphFact('AC2.1 a null command reaches the handoff in its nothing-to-recover slot', /a null `command` in its nothing-to-recover slot/),
```

Append to `HANDOFF_FACTS`:

```js
  ['AC2.1 nothing-to-recover slot', /- \{sha\} \{subject\} — restore failed; same commit still at stash@\{0\}, nothing to recover/],
  ['AC2.1 a null command takes the nothing-to-recover slot', /an entry whose `command` is null takes the nothing-to-recover slot instead, with no command line/],
```

The existing strip loops (`AC6.3: stripping any one pinned fact…` and the handoff test's per-fact strip) are the go-red controls for these four facts; no separate control test is needed.

- [ ] **Step 2: Run the conformance file to verify it fails**

Run: `node --test tests/dispatch-no-stash-conformance.test.js`
Expected: FAIL after Step 1 — the four new facts are reported missing.

- [ ] **Step 3: Edit the prose**

`plugin/skills/build/dispatch.md` — in the stash-guard paragraph, two in-place insertions (no other text changes; every existing pinned phrase must keep matching, including `every \`restoreFailed\` command` which is `REVIEWER_BRANCH_END`):

- replace `a failed restore is logged as a \`FAILED\` line carrying its shell-escaped \`restoreFailed[].command\` (also on stderr);` with `a failed restore is logged as a \`FAILED\` line carrying its shell-escaped \`restoreFailed[].command\` (also on stderr), or — when that \`command\` is null because the same commit is still at \`stash@{0}\` and \`git stash store\` wrote nothing — as a \`FAILED\` line that says there is nothing to recover and carries no command;`
- replace `(\`handoff-template.md\`'s Stash guard section), as does every restored entry` with `(\`handoff-template.md\`'s Stash guard section, a null \`command\` in its nothing-to-recover slot), as does every restored entry`

`plugin/skills/build/handoff-template.md` — insert a slot line directly after the two-line `restore failed; recover with:` / `  {command}` slot:

```
- {sha} {subject} — restore failed; same commit still at stash@{0}, nothing to recover
```

and in the parenthetical, after `` `{command}` is `restoreFailed[].command` verbatim, already shell-escaped by the CLI; `` insert `` an entry whose `command` is null takes the nothing-to-recover slot instead, with no command line; ``.

`docs/journeys/keep-the-shared-stash-through-a-dispatched-build-4559.md` line 50 — after the first sentence, insert: `A failed restore whose \`command\` is null — the same commit is still at \`stash@{0}\`, so \`git stash store\` wrote nothing — is listed as having nothing to recover, with no command.`

`docs/plugin-structure.md` line 209 — replace `(+ restored, alreadyPresent, restoreFailed)` with `(+ restored, alreadyPresent, restoreFailed — whose \`command\` is null when the same commit is still at stash@{0} and there is nothing to recover)`.

- [ ] **Step 4: Run both AC files to verify they pass (AC3.1)**

Run: `node --test tests/stash-guard.test.js tests/dispatch-no-stash-conformance.test.js`
Expected: PASS, 0 failures.

Discrimination proof (Deliverable 3): after committing, in a scratch checkout (the dispatch prompt's "Discrimination checks in a scratch checkout" steps — never the shared worktree in place), check out the task's base version of the two skill files only, run `tests/dispatch-no-stash-conformance.test.js` there, and confirm red naming the four AC2.1 facts while the unmutated scratch run is green. Quote both summary lines.

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/build/dispatch.md plugin/skills/build/handoff-template.md docs/journeys/keep-the-shared-stash-through-a-dispatched-build-4559.md docs/plugin-structure.md tests/dispatch-no-stash-conformance.test.js
git commit -m "Name the nothing-to-recover stash restore in build prose — refs #4787"
```
