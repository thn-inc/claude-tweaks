# Stash-Guard Outcomes Sub-File Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Shrink `plugin/skills/build/dispatch.md`'s stash-guard stanza below 2,000 bytes by moving everything that runs only on a non-zero `stash-guard.js` exit into a new lazy-loaded sub-file, `plugin/skills/build/stash-guard.md`.

**Architecture:** The stanza keeps what every git-capable dispatch needs: the dispatch roster, the two commands, the id and snapshot naming, and the exit-0 rule. Everything else moves verbatim (paragraphing only) into `stash-guard.md`, which the stanza tells the controller to read on exit 3 or 2. That covers the restore logging, the implementer/fix and reviewer branches with the reviewer retry, the handoff and hand-log carry-over, and the exit-2 SKIP. Read only on a stash change or a degraded guard, the sub-file costs nothing on the common exit-0 path. No CLI behavior changes. The record allows a stash-guard.js subcommand or a sub-file, and this plan takes the sub-file. A subcommand cannot dispatch the retry review itself, so it would still need prose for the role-aware branch, and would add a CLI surface for no reduction in what the controller must follow.

**Tech Stack:** Markdown skill prose; `node --test` conformance suite.

**Spec:** `.claude-tweaks/pipelines/2026-11-01T205900-record-4785/work/4785-spec.md` (record #4785)

**Scope keywords:** stash-guard-{id}-note.txt

## Global Constraints

- The stash-guard stanza in `plugin/skills/build/dispatch.md` is under 2KB — this plan pins it as `Buffer.byteLength(stanza) < 2000` (the stricter reading of "2KB").
- Keep every behavior the stanza states today: restore by sha, logged restore, hand-log on a failed append, voided reviewer verdict with one retry.
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

**Files:**
- Create: `plugin/skills/build/stash-guard.md`
- Modify: `plugin/skills/build/dispatch.md:19` (the stash-guard stanza only)
- Modify: `plugin/skills/_shared/session-tmp-root.md:153`
- Modify: `docs/plugin-structure.md:106` (the `| build |` row)
- Modify: `docs/skill-graph.md:123` (the `bin/stash-guard.js` row)
- Modify: `docs/journeys/keep-the-shared-stash-through-a-dispatched-build-4559.md` (frontmatter `files:` and step 4 heading)
- Test: `tests/dispatch-no-stash-conformance.test.js`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: `plugin/skills/build/stash-guard.md` — the only file the stanza points to; `stanzaOf(text)` / `outcomesFacts` helpers live only inside the test file.

- [ ] **Step 1: Rewrite the stash-guard pins in `tests/dispatch-no-stash-conformance.test.js` to the two-file split**

Keep everything above the `// ---- #4559: the controller brackets every git-capable dispatch` comment unchanged, and keep the handoff-template tests and the docs/hooks.md AC8 tests unchanged. In the stash-guard block:

- Add `const STASH_GUARD_OUTCOMES = read('plugin', 'skills', 'build', 'stash-guard.md');`.
- Facts now run against a `texts` object `{ stanza, outcomes }`, where `stanza` is `stashGuardParagraph(BUILD_DISPATCH)` and `outcomes` is `STASH_GUARD_OUTCOMES`. Replace `paragraphFact` with `stanzaFact(label, pattern)` and `outcomesFact(label, pattern)`. Each returns `{ label, test: (t) => pattern.test(t.<home>), strip: (t) => ({ ...t, <home>: t.<home>.replace(globalOf(pattern), () => '') }) }`. `branchFact` reads and strips `reviewerBranch(t.outcomes)` with the same function-replacement shape it has today.
- Stanza facts, with each existing label and regex unchanged: `AC6.1 snapshot command`, `AC6.1 compare --restore command`, `AC6.1 snapshot immediately before the dispatch`, `AC6.1 compare before the task's review`, the eight `AC11.1 …` members, `AC11.2 --task {k} --label`, `AC11.2 --label fix-wave`, `AC11.2 stash-guard-{id}.json`, `{worktree} is filled`, `exit 0 appends nothing and logged is absent`. One new stanza fact: `AC2.1 the stanza points to stash-guard.md`, matching `/on exit 3 or 2 from either command, read `stash-guard\.md` in this skill's directory/`.
- Outcomes facts: every other existing entry of `STASH_GUARD_FACTS`, with label and regex unchanged, plus `branchFact('AC13.1 no stop (reviewer-restore branch)', /no stop/)`. One new outcomes fact: `AC2.1 the dirty-tree note file`, matching `/session-tmp-resolve\.js" --value stash-guard-\{id\}-note\.txt/`.
- `missingStashGuardFacts(texts)` returns the missing labels, plus `forbidden: {label}` for each `STASH_GUARD_FORBIDDEN` pattern matching `texts.stanza` or `texts.outcomes`. Add a third group, `restated in stanza: {label}`, for each entry of a new `NOT_IN_STANZA` list that matches `texts.stanza`. Its entries: `['verdict is void', /verdict is void/]`, `['git status --porcelain', /git status --porcelain/]`, `['DONE_WITH_CONCERNS', /DONE_WITH_CONCERNS/]`, `['dirty-tree note file', /stash-guard-\{id\}-note\.txt/]`, `['Stash guard (degraded)', /Stash guard \(degraded\)/]`. `assertStashGuardInstruction(texts)` throws with `missing: ${problems.join(', ')}` as today.
- New test `AC1.1: the stash-guard stanza in build/dispatch.md is under 2KB`. It uses a helper `stanzaSizeProblems(stanza)`, which returns `[`stanza is ${n} bytes, not under 2000`]` when `Buffer.byteLength(stanza, 'utf8') >= 2000` and `[]` otherwise. The test asserts `[]` for the shipped stanza. Go-red control: the same helper on `stanza + STASH_GUARD_OUTCOMES` (the moved text re-inlined) returns one problem.
- New test `AC2.1: the reviewer-retry steps live in the lazy-loaded sub-file, not the stanza`. It asserts that `missingStashGuardFacts` on the shipped texts reports nothing in the `restated in stanza:` group. Go-red control: on `{ stanza: stanza + STASH_GUARD_OUTCOMES, outcomes }` it reports exactly the five `restated in stanza: …` labels and no other problem.
- Rewire the existing tests to `texts`. In `AC6.3: stripping any one pinned fact…`, `doctored = fact.strip(texts)` and `assert.notDeepStrictEqual(doctored, texts)`. In the named go-red controls test, `the snapshot command deleted` and `whole-branch-fix deleted` doctor `stanza`, while `the verdict-is-void sentence deleted` and `verdict stands deleted` doctor `outcomes`. Each control's expected result stays exactly its one label. `whole-branch-fix deleted` must not create a `restated` hit, and it will not, since the strip only removes text. In `AC13.1: the superseded report-the-task-BLOCKED…`, the re-insertion goes into `outcomes` at the anchor `'the CLI has already restored the removed entries;'`. In `AC13.1: "no stop" is pinned inside the reviewer-restore branch…`, the branch is `reviewerBranch(STASH_GUARD_OUTCOMES)`, and the `/no new stop/` outside-branch assertion runs on the doctored `outcomes`. In `AC6.3: every banned retired form…`, the reinsertion appends to `outcomes`.
- Re-pin `session-tmp-root.md lists the stash guard as a consumer…`. The new pattern matches exactly ``**Extended (#4559):** `skills/build/dispatch.md`'s stash guard (`stash-guard-{id}.json`, the standalone /build snapshot path) and `skills/build/stash-guard.md` (`stash-guard-{id}-note.txt`, the dirty-tree note's `--text-file`).``, escaped as a regex like today's. Control: today's shipped line, frozen verbatim as `preSplit`, must `doesNotMatch` the new pattern. Keep the existing `preRuling` control.
- Rename the test `AC6.1/AC11/AC12/AC13: the stash-guard paragraph carries every pinned instruction` to `AC6.1/AC11/AC12/AC13/AC2.1: the stanza and stash-guard.md carry every pinned instruction`, and add `AC3.1` to its name.

- [ ] **Step 2: Run the suite to verify it fails**

Run: `node --test tests/dispatch-no-stash-conformance.test.js`
Expected: FAIL after Step 1 — `ENOENT` reading `plugin/skills/build/stash-guard.md` (the module-level `read` throws, failing the file).

- [ ] **Step 3: Create `plugin/skills/build/stash-guard.md` and shrink the stanza**

Create `plugin/skills/build/stash-guard.md` with this structure:

1. Heading `# Stash Guard — Non-Zero Compare Outcomes`, a blank line, then one sentence: ``Read by `dispatch.md`'s **Stash guard around every dispatch that can run git (#4559)** instruction only when a `stash-guard.js` `snapshot` or `compare` exits 3 or 2 — exit 0 needs nothing from this file.``
2. The text of today's stanza from `Exit 3 means the CLI has already restored` through `its evidence lands in `decisions.md` and the Review Console.`, copied **byte-for-byte**, copied from `git show HEAD:plugin/skills/build/dispatch.md` line 19. The only change is blank-line paragraph breaks inserted immediately before these four sentence starts, each kept verbatim: `For an implementer or fix dispatch,`, `For a reviewer dispatch (task reviewer,`, `Exit 2 (an unreadable baseline,`, `The guard adds no new stop:`. No other word changes, and nothing else rewrapped.
3. The file ends with a single trailing newline.

Then, in `plugin/skills/build/dispatch.md` line 19, replace the span from `**Stash guard around every dispatch that can run git (#4559):**` up to, but not including, `**Cherry-pick source-branch PR check (#1957):**` with exactly this text, including its single trailing space and with no newline:

```
**Stash guard around every dispatch that can run git (#4559):** the forbid sentence only asks, so in the same invocation instruction, also direct `/superpowers:subagent-driven-development` to run the stash guard around every dispatch it composes that can run git — each per-task implementer dispatch; every fix round (a resumed or a fresh implementer); every NEEDS_CONTEXT/BLOCKED re-dispatch; each task reviewer and scoped re-review; the final code reviewer, its fix-wave dispatch and that fix's scoped re-review; and every whole-branch-fix implementer (a pre-review catch-up repair, a ruling's targeted fix). SDD dispatches these one at a time, so each pair brackets one agent: `node "${CLAUDE_PLUGIN_ROOT}/bin/stash-guard.js" snapshot --repo "{worktree}" --out "{snapshot}"` immediately before the dispatch, and `node "${CLAUDE_PLUGIN_ROOT}/bin/stash-guard.js" compare --repo "{worktree}" --baseline "{snapshot}" --restore --run "$PIPELINE_RUN_DIR" {dispatch id}` as soon as it returns, before the next dispatch (for a task's implementer, before that task's review) — both from `{worktree}`, the worktree root `/build` runs in (the project root under `current-branch`). `{dispatch id}` is `--task {k}` for a task's first implementer; `--task {k} --label {role}` for its other dispatches (`fix-{r}`, `redispatch-{r}`, `review`, `re-review-{r}`); `--label {role}` for a whole-branch one (`--label final-review`, `--label fix-wave`, `--label fix-wave-re-review`, `--label whole-branch-fix-{r}`); `{id}` is `task-{k}`, `task-{k}-{role}` or `{role}`. `{snapshot}` is `$PIPELINE_RUN_DIR/stash-guard-{id}.json`, else the path `node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" --value stash-guard-{id}.json` prints (`_shared/session-tmp-root.md`); a standalone `/build` omits `--run` and the dispatch id. Exit 0 means nothing to do (nothing was appended and `logged` is absent); on exit 3 or 2 from either command, read `stash-guard.md` in this skill's directory before the next dispatch. 
```

That text measures 1,994 bytes. Make the edit with a scratchpad Node script that reads the file, does `indexOf` on the two labels, and splices — never by retyping line 19.

- [ ] **Step 4: Update the other sites that name where the rule lives**

- `plugin/skills/_shared/session-tmp-root.md` line 153 → exactly the line Step 1's new pattern matches.
- `docs/plugin-structure.md` `| build |` row: append `, stash-guard.md` to the first cell's file list (after `plan-review.md`). Append to the description cell: `; stash-guard.md holds the stash guard's non-zero outcomes — exit-3 restore logging, the implementer/fix and reviewer branches with the one reviewer retry, the handoff and hand-log carry-over, and the exit-2 SKIP — read by dispatch.md's stash-guard stanza only when a snapshot or compare exits 3 or 2 (#4785)`.
- `docs/skill-graph.md` `bin/stash-guard.js` row: after its first sentence, insert `Since #4785 the controller reads `build/stash-guard.md` only when a `snapshot` or `compare` exits 3 or 2; it holds the restore, reviewer-retry and degrade handling.`
- `docs/journeys/keep-the-shared-stash-through-a-dispatched-build-4559.md`: add `  - plugin/skills/build/stash-guard.md` to the frontmatter `files:` list after `plugin/skills/build/dispatch.md`. Change step 4's heading suffix from `— `build/dispatch.md`` to `— `build/stash-guard.md``.

- [ ] **Step 5: Run the focused tests to verify they pass**

Run: `node --test tests/dispatch-no-stash-conformance.test.js tests/stash-guard.test.js tests/build-dispatch-subfile-table-completeness.test.js tests/session-tmp-placeholder-quoting-conformance.test.js tests/skill-graph-table-structure.test.js`
Expected: PASS, 0 failures.

Then prove AC1.1 discriminates against the real old stanza, not only the in-test control. Do this in a scratch checkout per `_shared/subagent-dispatch-core.md`'s **Discrimination checks in a scratch checkout**, never by editing this worktree:
1. Copy the new test file and `stash-guard.md` into the scratch checkout, and leave `dispatch.md` at `HEAD`'s version (the 6,975-byte stanza).
2. Run `node --test --test-name-pattern "AC1.1" tests/dispatch-no-stash-conformance.test.js` there.
3. Quote the failure: it must name `not under 2000`.
Finally, re-run the Step 5 command in this worktree and quote its final `# pass` / `# fail` lines.

- [ ] **Step 6: Commit**

```bash
git add plugin/skills/build/stash-guard.md plugin/skills/build/dispatch.md plugin/skills/_shared/session-tmp-root.md docs/plugin-structure.md docs/skill-graph.md docs/journeys/keep-the-shared-stash-through-a-dispatched-build-4559.md tests/dispatch-no-stash-conformance.test.js
git commit -m "Move stash-guard outcome handling into build/stash-guard.md — stanza under 2KB (refs #4785)"
```

## Spec coverage

| AC clause | Covered by |
|---|---|
| AC1.1 | Task 1 Step 1, test `AC1.1: the stash-guard stanza in build/dispatch.md is under 2KB` |
| AC2.1 | Task 1 Step 1, test `AC2.1: the reviewer-retry steps live in the lazy-loaded sub-file, not the stanza` and the stanza fact `AC2.1 the stanza points to stash-guard.md` |
| AC3.1 | Task 1 Step 5 runs `node --test tests/dispatch-no-stash-conformance.test.js tests/stash-guard.test.js`. AC3.1 is also named in the renamed carries-every-pinned-instruction test |

Deliverable 3's `tests/stash-guard.test.js` leg applies to the subcommand option. This plan moves no CLI behavior, so that file needs no new pin and only has to keep passing (AC3.1).
