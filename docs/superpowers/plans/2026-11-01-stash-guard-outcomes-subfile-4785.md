# Stash-Guard Outcomes Sub-File Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Shrink `plugin/skills/build/dispatch.md`'s stash-guard stanza below 2,000 bytes by moving everything that runs only on a non-zero `stash-guard.js` exit into a new lazy-loaded sub-file, `plugin/skills/build/stash-guard.md`.

**Architecture:** The stanza keeps what every git-capable dispatch needs: the dispatch roster, the two commands, the id and snapshot naming, and the exit-0 rule. Its text is reworded to fit the budget, keeping every condition. Two rationale clauses go ("the forbid sentence above only asks", "since the stash stack is repo-wide…"), as does the `_shared/session-tmp-root.md` citation (that file already lists this consumer), and the whole-branch label list is compressed. Everything else moves verbatim (paragraphing only) into `stash-guard.md`, which the stanza tells the controller to read on exit 3 or 2. That covers the restore logging, the implementer/fix and reviewer branches with the reviewer retry, the handoff and hand-log carry-over, and the exit-2 SKIP. Read only on a stash change or a degraded guard, the sub-file costs nothing on the common exit-0 path. No CLI behavior changes. The record allows a stash-guard.js subcommand or a sub-file, and this plan takes the sub-file. A subcommand cannot dispatch the retry review itself, so it would still need prose for the role-aware branch, and would add a CLI surface for no reduction in what the controller must follow.

**Tech Stack:** Markdown skill prose; `node --test` conformance suite.

**Spec:** `.claude-tweaks/pipelines/2026-11-01T205900-record-4785/work/4785-spec.md` (record #4785)

**Scope keywords:** stash-guard-{id}-note.txt

## Global Constraints

- The stash-guard stanza in `plugin/skills/build/dispatch.md` is under 2KB — this plan pins it as `Buffer.byteLength(stanza) < 2000` (the stricter reading of "2KB").
- Keep every behavior the stanza states today: restore by sha, logged restore, hand-log on a failed append, voided reviewer verdict with one retry. The text that stays in the stanza keeps its conditions: "when `$PIPELINE_RUN_DIR` resolves" and "The exit code is authoritative:".
- Deliverable 3 is honored as written (plan review, Reading A): the moved text is re-pinned in `tests/dispatch-no-stash-conformance.test.js` **and** in `tests/stash-guard.test.js`. The latter gets a prose-to-CLI twin pin of the restore line documented in `stash-guard.md`. Each re-pinned source is shown red by reverting it for real in a scratch checkout (Step 5).
- The sub-file pointer names an unambiguous path, `${CLAUDE_PLUGIN_ROOT}/skills/build/stash-guard.md`. The instruction is forwarded into `/superpowers:subagent-driven-development`, where "this skill's directory" would mean SDD's.
- The stanza stays on line 19 of `dispatch.md`, starting exactly where the **Forbid `git stash`** paragraph ends and ending at the next `**` bold label (`**Cherry-pick source-branch PR check (#1957):**`) — `tests/dispatch-no-stash-conformance.test.js`'s same-line test pins this.
- Release Note: no user-visible change.

## Review Focus

1. A moved sentence reworded in transit, so a pinned phrase now matches only by accident or not at all. Every moved sentence is a verbatim copy; the per-fact strip controls (AC6.3 loop) prove each pin still goes red.
2. The stanza restating a moved rule, leaving two copies to drift. Task 1's `NOT_IN_STANZA` check pins this, with a go-red control.
3. The exit-2 path after a failed `snapshot` reaching the sub-file. The pointer says "exit 3 or 2 from either command", so a failed snapshot (exit 2) also routes there. Pinned by the stanza pointer fact's exact wording.
4. `session-tmp-root.md`'s consumer line still naming `dispatch.md` for the note file after the note-file rule moved. Re-pinned in Task 1.
5. `docs/plugin-structure.md`'s build row missing the new sub-file — `tests/build-dispatch-subfile-table-completeness.test.js` already fails on this; Task 1 adds the row entry.

---

### Task 1: Move the stash-guard outcome handling into `build/stash-guard.md`

**Role:** integration
**Review risk:** high

**Files:**
- Create: `plugin/skills/build/stash-guard.md`
- Modify: `plugin/skills/build/dispatch.md:19` (the stash-guard stanza only)
- Modify: `plugin/skills/_shared/session-tmp-root.md:153`
- Modify: `docs/plugin-structure.md:106` (the `| build |` row)
- Modify: `docs/skill-graph.md:123` (the `bin/stash-guard.js` row)
- Modify: `docs/journeys/keep-the-shared-stash-through-a-dispatched-build-4559.md` (frontmatter `files:` and step 4 heading)
- Test: `tests/dispatch-no-stash-conformance.test.js`
- Test: `tests/stash-guard.test.js`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: `plugin/skills/build/stash-guard.md` — the only file the stanza points to; `stanzaOf(text)` / `outcomesFacts` helpers live only inside the test file.

- [ ] **Step 1: Rewrite the stash-guard pins in `tests/dispatch-no-stash-conformance.test.js` to the two-file split**

Keep everything above the `// ---- #4559: the controller brackets every git-capable dispatch` comment unchanged, and keep the handoff-template tests and the docs/hooks.md AC8 tests unchanged. In the stash-guard block:

- Add `const STASH_GUARD_OUTCOMES = read('plugin', 'skills', 'build', 'stash-guard.md');`.
- Facts now run against a `texts` object `{ stanza, outcomes }`, where `stanza` is `stashGuardParagraph(BUILD_DISPATCH)` and `outcomes` is `STASH_GUARD_OUTCOMES`. Replace `paragraphFact` with `stanzaFact(label, pattern)` and `outcomesFact(label, pattern)`. Each returns `{ label, test: (t) => pattern.test(t.<home>), strip: (t) => ({ ...t, <home>: t.<home>.replace(globalOf(pattern), () => '') }) }`. `branchFact` reads and strips `reviewerBranch(t.outcomes)` with the same function-replacement shape it has today.
- Stanza facts, with each existing label and regex unchanged: `AC6.1 snapshot command`, `AC6.1 compare --restore command`, `AC6.1 snapshot immediately before the dispatch`, `AC6.1 compare before the task's review`, the eight `AC11.1 …` members, `AC11.2 --task {k} --label`, `AC11.2 stash-guard-{id}.json`, `{worktree} is filled`, `exit 0 appends nothing and logged is absent`. Replace `AC11.2 --label fix-wave` with `AC11.2 whole-branch roles`, matching ``/`--label \{role\}` for a whole-branch one \(`final-review`, `fix-wave`, `fix-wave-re-review`, `whole-branch-fix-\{r\}`\)/``. Three new stanza facts:
  - `AC2.1 the stanza points to stash-guard.md` matches ``/on exit 3 or 2 from either command, read `\$\{CLAUDE_PLUGIN_ROOT\}\/skills\/build\/stash-guard\.md` before the next dispatch/``.
  - `snapshot path is conditional on the run dir` matches ``/`\$PIPELINE_RUN_DIR\/stash-guard-\{id\}\.json` when `\$PIPELINE_RUN_DIR` resolves, else/``.
  - `the exit code is authoritative` matches `/The exit code is authoritative: exit 0 means nothing to do/`.
- Outcomes facts: every other existing entry of `STASH_GUARD_FACTS`, with label and regex unchanged, plus `branchFact('AC13.1 no stop (reviewer-restore branch)', /no stop/)`. One new outcomes fact: `AC2.1 the dirty-tree note file`, matching `/session-tmp-resolve\.js" --value stash-guard-\{id\}-note\.txt/`.
- `missingStashGuardFacts(texts)` returns the missing labels, plus `forbidden: {label}` for each `STASH_GUARD_FORBIDDEN` pattern matching `texts.stanza` or `texts.outcomes`. Add a third group, `restated in stanza: {label}`, for each entry of a new `NOT_IN_STANZA` list that matches `texts.stanza`. Its entries: `['verdict is void', /verdict is void/]`, `['git status --porcelain', /git status --porcelain/]`, `['DONE_WITH_CONCERNS', /DONE_WITH_CONCERNS/]`, `['dirty-tree note file', /stash-guard-\{id\}-note\.txt/]`, `['Stash guard (degraded)', /Stash guard \(degraded\)/]`. `assertStashGuardInstruction(texts)` throws with `missing: ${problems.join(', ')}` as today.
- New test `AC1.1: the stash-guard stanza in build/dispatch.md is under 2KB`. It uses a helper `stanzaSizeProblems(stanza)`, which returns `[`stanza is ${n} bytes, not under 2000`]` when `Buffer.byteLength(stanza, 'utf8') >= 2000` and `[]` otherwise. The test asserts `[]` for the shipped stanza. Go-red control: the same helper on `stanza + STASH_GUARD_OUTCOMES` (the moved text re-inlined) returns one problem.
- New test `AC2.1: the reviewer-retry steps live in the lazy-loaded sub-file, not the stanza`. It asserts that `missingStashGuardFacts` on the shipped texts reports nothing in the `restated in stanza:` group. Go-red control: on `{ stanza: stanza + STASH_GUARD_OUTCOMES, outcomes }` it reports exactly the five `restated in stanza: …` labels and no other problem.
- Rewire the existing tests to `texts`. In `AC6.3: stripping any one pinned fact…`, `doctored = fact.strip(texts)` and `assert.notDeepStrictEqual(doctored, texts)`. In the named go-red controls test, `the snapshot command deleted` and `whole-branch-fix deleted` doctor `stanza`, while `the verdict-is-void sentence deleted` and `verdict stands deleted` doctor `outcomes`. Each control's expected result stays exactly its one label. `whole-branch-fix deleted` must not create a `restated` hit, and it will not, since the strip only removes text. In `AC13.1: the superseded report-the-task-BLOCKED…`, the re-insertion goes into `outcomes` at the anchor `'the CLI has already restored the removed entries;'`. In `AC13.1: "no stop" is pinned inside the reviewer-restore branch…`, the branch is `reviewerBranch(STASH_GUARD_OUTCOMES)`, and the `/no new stop/` outside-branch assertion runs on the doctored `outcomes`. In `AC6.3: every banned retired form…`, the reinsertion appends to `outcomes`.
- Re-pin `session-tmp-root.md lists the stash guard as a consumer…`. The new pattern matches exactly ``**Extended (#4559):** `skills/build/dispatch.md`'s stash guard (`stash-guard-{id}.json`, the standalone /build snapshot path) and `skills/build/stash-guard.md` (`stash-guard-{id}-note.txt`, the dirty-tree note's `--text-file`).``, escaped as a regex like today's. Control: today's shipped line, frozen verbatim as `preSplit`, must `doesNotMatch` the new pattern. Keep the existing `preRuling` control.
- Rename the test `AC6.1/AC11/AC12/AC13: the stash-guard paragraph carries every pinned instruction` to `AC6.1/AC11/AC12/AC13/AC2.1: the stanza and stash-guard.md carry every pinned instruction`, and add `AC3.1` to its name.

Also add one test to `tests/stash-guard.test.js`: `AC3.1: the restore line build/stash-guard.md documents is the line the CLI writes`. This is a prose-to-CLI twin pin of the moved exit-3 text.
- A helper `documentedRestoreLineProblems(doc, emitted)` (`doc` is the text of `plugin/skills/build/stash-guard.md`, `emitted` is a list of `{ who, line }`) returns `[]` or a list of problem strings.
- It extracts the documented template, the text inside the first backtick pair after `logged ` that starts with `AUTO {time} — Stash guard: {who} removed stash entr`. It turns the template into a regex: escape it; `{time}` → `\d{2}:\d{2}:\d{2}`; `{who}` → the emitted `who` literally; `entr{y,ies}` → `entr(?:y|ies)`; `{sha subject …}` → `.+`. It reports `restore line does not match the documented template: {line}` for each emitted line that does not match.
- It extracts the parenthesised `{who}` list right after the template (`` (`{who}` is `implementer for task {k}`, `{role} dispatch for task {k}` or `{role} dispatch`) ``). It reports a problem unless the three forms, with `{k}` → `2` and `{role}` → the label, equal the set of emitted `who` values.
- The test drives the CLI through the same three dispatch-id cases `AC11.2: --label alone and --task with --label …` uses (`--label fix-wave`, `--task 2 --label review`, `--task 2`), via `fixture`, `withRunDir`, `stashPush`, `snapshot`, `compare` and `decisionsOf`. It collects each `- AUTO …` decisions.md line minus its leading `- `, then asserts `documentedRestoreLineProblems(doc, emitted)` is `[]`.
- Go-red control, run through the same helper: the doc with `restored via git stash store` replaced by `restored` reports exactly the three `does not match` problems, and the doc with `` `{role} dispatch` `` removed from the who list reports one who-list problem.

- [ ] **Step 2: Run the suite to verify it fails**

Run: `node --test tests/dispatch-no-stash-conformance.test.js tests/stash-guard.test.js`
Expected: FAIL after Step 1 — `ENOENT` reading `plugin/skills/build/stash-guard.md` (the module-level `read` throws, failing the conformance file; the new twin-pin test fails the same way).

- [ ] **Step 3: Create `plugin/skills/build/stash-guard.md` and shrink the stanza**

Create `plugin/skills/build/stash-guard.md` with this structure:

1. Heading `# Stash Guard — Non-Zero Exit Outcomes`, a blank line, then one sentence: ``Read by `dispatch.md`'s **Stash guard around every dispatch that can run git (#4559)** instruction only when a `stash-guard.js` `snapshot` or `compare` exits 3 or 2 — exit 0 needs nothing from this file.``
2. The text of today's stanza from `Exit 3 means the CLI has already restored` through `its evidence lands in `decisions.md` and the Review Console.`, copied **byte-for-byte**, copied from `git show HEAD:plugin/skills/build/dispatch.md` line 19. The only change is blank-line paragraph breaks inserted immediately before these four sentence starts, each kept verbatim: `For an implementer or fix dispatch,`, `For a reviewer dispatch (task reviewer,`, `Exit 2 (an unreadable baseline,`, `The guard adds no new stop:`. No other word changes, and nothing else rewrapped.
3. The file ends with a single trailing newline.

Then, in `plugin/skills/build/dispatch.md` line 19, replace the span from `**Stash guard around every dispatch that can run git (#4559):**` up to, but not including, `**Cherry-pick source-branch PR check (#1957):**` with exactly this text, including its single trailing space and with no newline:

```
**Stash guard around every dispatch that can run git (#4559):** in the same invocation instruction, also direct `/superpowers:subagent-driven-development` to run the stash guard around every dispatch it composes that can run git — each per-task implementer dispatch; every fix round (a resumed or a fresh implementer); every NEEDS_CONTEXT/BLOCKED re-dispatch; each task reviewer and scoped re-review; the final code reviewer, its fix-wave dispatch and that fix's scoped re-review; and every whole-branch-fix implementer (a pre-review catch-up repair, a ruling's targeted fix). SDD dispatches these one at a time, so each pair brackets one agent: `node "${CLAUDE_PLUGIN_ROOT}/bin/stash-guard.js" snapshot --repo "{worktree}" --out "{snapshot}"` immediately before the dispatch, and `node "${CLAUDE_PLUGIN_ROOT}/bin/stash-guard.js" compare --repo "{worktree}" --baseline "{snapshot}" --restore --run "$PIPELINE_RUN_DIR" {dispatch id}` as soon as it returns, before the next dispatch (for a task's implementer, before that task's review) — both from `{worktree}`, the worktree root `/build` runs in (the project root under `current-branch`). `{dispatch id}` is `--task {k}` for a task's first implementer; `--task {k} --label {role}` for its other dispatches (`fix-{r}`, `redispatch-{r}`, `review`, `re-review-{r}`); `--label {role}` for a whole-branch one (`final-review`, `fix-wave`, `fix-wave-re-review`, `whole-branch-fix-{r}`); `{id}` is `task-{k}`, `task-{k}-{role}` or `{role}`. `{snapshot}` is `$PIPELINE_RUN_DIR/stash-guard-{id}.json` when `$PIPELINE_RUN_DIR` resolves, else the path `node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" --value stash-guard-{id}.json` prints; a standalone `/build` omits `--run` and the dispatch id. The exit code is authoritative: exit 0 means nothing to do (nothing was appended and `logged` is absent); on exit 3 or 2 from either command, read `${CLAUDE_PLUGIN_ROOT}/skills/build/stash-guard.md` before the next dispatch. 
```

That text measures 1,972 bytes including its trailing space, which leaves 27 bytes under the pin. Make the edit with a scratchpad Node script — never by retyping line 19. The script reads the file, does `indexOf` on the two labels, splices, and prints the new stanza's `Buffer.byteLength` before you commit; the printed value must be below 2000.

- [ ] **Step 4: Update the other sites that name where the rule lives**

- `plugin/skills/_shared/session-tmp-root.md` line 153 → exactly the line Step 1's new pattern matches.
- `docs/plugin-structure.md` `| build |` row: append `, stash-guard.md` to the first cell's file list (after `plan-review.md`). Append to the description cell: `; stash-guard.md holds the stash guard's non-zero outcomes — exit-3 restore logging, the implementer/fix and reviewer branches with the one reviewer retry, the handoff and hand-log carry-over, and the exit-2 SKIP — read by dispatch.md's stash-guard stanza only when a snapshot or compare exits 3 or 2 (#4785)`.
- `docs/skill-graph.md` `bin/stash-guard.js` row: after its first sentence, insert `Since #4785 the controller reads `build/stash-guard.md` only when a `snapshot` or `compare` exits 3 or 2; it holds the restore, reviewer-retry and degrade handling.`
- `docs/journeys/keep-the-shared-stash-through-a-dispatched-build-4559.md`: add `  - plugin/skills/build/stash-guard.md` to the frontmatter `files:` list after `plugin/skills/build/dispatch.md`. Change step 4's heading suffix from `— `build/dispatch.md`` to `— `build/stash-guard.md``.

- [ ] **Step 5: Run the focused tests to verify they pass**

Run: `node --test tests/dispatch-no-stash-conformance.test.js tests/stash-guard.test.js tests/build-dispatch-subfile-table-completeness.test.js tests/session-tmp-placeholder-quoting-conformance.test.js tests/skill-graph-table-structure.test.js`
Expected: PASS, 0 failures.

Then show each re-pinned source red by reverting it for real (Deliverable 3). The in-test strip controls doctor the source in memory; these reverts edit the real files. Do every revert in a scratch checkout per `_shared/subagent-dispatch-core.md`'s **Discrimination checks in a scratch checkout**, at this task's commit, one revert at a time, restoring the file before the next. Never edit this worktree. For each revert, run the two-file command from Step 2 there and record which tests fail:
1. `dispatch.md` line 19 back to its pre-change version (`git show HEAD~1:plugin/skills/build/dispatch.md`, or the base commit if this task's commit is not `HEAD`). It must fail `AC1.1`, the new stanza facts, and `restated in stanza:`.
2. Delete each `stash-guard.md` paragraph in turn (the exit-3 paragraph, the implementer/fix paragraph, the reviewer paragraph, the exit-2 paragraph, the no-new-stop paragraph). Each must fail at least one fact naming that paragraph's content.
3. `session-tmp-root.md` line 153 back to its pre-change text. It must fail the session-tmp-root pin.
4. In `stash-guard.md`, change `restored via git stash store` inside the documented AUTO template to `restored`. It must fail the new `stash-guard.test.js` twin pin.

Write the whole proof log with a plain Bash redirect, after `mkdir -p "/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude-tweaks/pipelines/2026-11-01T205900-record-4785/evidence"`, to `/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude-tweaks/pipelines/2026-11-01T205900-record-4785/evidence/stash-guard-revert-proofs.txt`. The log holds each revert's label and the failing test names. Quote the failing lines in your report. Finally, re-run the Step 5 command in this worktree and quote its final `# pass` / `# fail` lines.

- [ ] **Step 6: Commit**

```bash
git add plugin/skills/build/stash-guard.md plugin/skills/build/dispatch.md plugin/skills/_shared/session-tmp-root.md docs/plugin-structure.md docs/skill-graph.md docs/journeys/keep-the-shared-stash-through-a-dispatched-build-4559.md tests/dispatch-no-stash-conformance.test.js tests/stash-guard.test.js
git commit -m "Move stash-guard outcome handling into build/stash-guard.md — stanza under 2KB (refs #4785)"
```

## Spec coverage

| AC clause | Covered by |
|---|---|
| AC1.1 | Task 1 Step 1, test `AC1.1: the stash-guard stanza in build/dispatch.md is under 2KB` |
| AC2.1 | Task 1 Step 1, test `AC2.1: the reviewer-retry steps live in the lazy-loaded sub-file, not the stanza` and the stanza fact `AC2.1 the stanza points to stash-guard.md` |
| AC3.1 | Task 1 Step 5 runs `node --test tests/dispatch-no-stash-conformance.test.js tests/stash-guard.test.js`. AC3.1 is also named in the renamed carries-every-pinned-instruction test and in the new `stash-guard.test.js` twin-pin test |

Deliverable 3 is covered as written by Step 1 (both suites re-pinned) and Step 5 (each re-pinned source reverted for real).
