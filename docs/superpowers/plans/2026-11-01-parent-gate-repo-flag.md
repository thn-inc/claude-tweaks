# Parent-Gate `--repo` on Prose Writes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Parent-Gate Procedure's prose writes (`gh issue comment|close|edit`, plus Apply's comment read) target the same repository the gate's CLI read from, and never run them when that value is empty. Then inventory every other `gh issue` write under `plugin/skills/`, fenced lines and runnable inline spans alike, so none is left unclassified, and send the ones that need a fix to one follow-up record.

**Architecture:** `bin/parent-gate.js` already resolves `owner/repo` (and the host) from the origin remote for its reads, on the `gh` path through `repo-resolve.js`'s `gateOriginRepo` (#4933). It gains one verdict field, `repo` (`repoSlug({host, owner, repo})` over that resolved spec: bare `owner/repo` on github.com, host-qualified elsewhere, `null` when the CLI resolved no origin). Every gh line in the gate file passes it as `--repo "{parent-repo}"`, a literal placeholder the agent fills from the verdict, the same way the file's `{parent-close-comment}` is filled. One stated rule, next to the verdict's `repo` bullet, stops the procedure before any of those lines runs when `repo` is `null` or empty. An unfilled placeholder fails closed in `gh` itself. A new conformance suite pins the lines and the rule. The inventory is one committed reference doc, one row per write. The writes it classifies `needs-fix` go to one follow-up record, filed by the controller.

**Tech Stack:** Node 18+ CommonJS, `node --test`, Markdown skill prose.

**Spec:** `.claude-tweaks/pipelines/2026-11-03T082955-record-4824/work/4824-spec.md` (record #4824, with its four `## Plan Review Clarifications` paragraphs)

## Global Constraints

- The verdict field is named `repo`. It sits second in `VERDICT_FIELDS`, after `parent`. Its value comes from `repoSlug` in `plugin/bin/lib/repo-resolve.js`, the same helper `below-floor-parent-close.js` uses for its `--repo`.
- The flag, byte for byte: `--repo "{parent-repo}"`. It goes right after `$PARENT_NUM` on every gh line in `plugin/skills/wrap-up/verification-brief-parent-gate.md`. A shell-variable form (`--repo "$PARENT_REPO"`, `"${PARENT_REPO:?…}"`) is a defect. Nothing ever assigns such a variable: every Bash call starts a fresh shell, and the file's `$PARENT_NUM` is itself filled in by the agent, never assigned. A prefix assignment (`PARENT_REPO=o/r gh … "${PARENT_REPO:?…}"`) does not help, because bash expands the word before the assignment applies. A separate assignment statement makes the call compound with a variable `gh` operand, which the worktree guard refuses (`tools/guard-refusals/shapes.js`'s `ghComputedInput`).
- The stop rule (`STOP_RULE`), added once to the verdict's `repo` bullet, byte for byte as the one line in this fence (it may be hard-wrapped in the skill file; the test compares it whitespace-collapsed):

  ```text
  When `repo` is `null` or empty, run none of the `gh` lines below and report the entry as a failing `gh` call: a `--repo ""` sends the write to `gh`'s default repository.
  ```
- Probed on this machine before the plan was final, read-only. `gh issue view 4824 --repo "" --json number` printed `{"number":4824}` and exited 0, so an empty value silently uses the default repository: that is the hazard the rule stops. `gh issue view 4824 --repo "{parent-repo}" --json number` and `gh issue view 4824 --repo "null" --json number` both exited 1 with `expected the "[HOST/]OWNER/REPO" format, got "…"`, so an unfilled placeholder or a pasted `null` fails closed with no write.
- No `--repo` flag is added to `parent-gate.js`. The repository still comes only from the origin remote, so `unknownCliFlags` in `below-floor-parent-close-conformance.test.js` must keep reporting `--repo` as unknown.
- `--facts-json` keeps its contract: it reads the origin remote only for a qualified `--closing` token. Without one, `repo` is `null`; with one, `repo` is that slug. `--backend local-files` reads no remote, so `repo` is `null` there too. Neither path runs a `gh` fence.
- When an exported `GH_HOST` names a host other than origin's, `gateOriginRepo` gives the reads host `github.com`. `repo` must be that same slug, built from the `{host, owner, repo}` the reads use. Never build it from the raw remote.
- Spec, verbatim: "The inventory classifies; it does not fix the inline writes."
- Spec, verbatim: "This record adds `--repo` only to the Parent-Gate Procedure, and adds no slug-resolution step to any other procedure."
- Spec, verbatim: "A fence or span in that class satisfies the third acceptance criterion, and this record files one named follow-up listing them all."
- Spec, verbatim: "Every fence this record gives `--repo` stops before the write when the value is empty, and the conformance test pins that."
- Commit subjects use `{Verb} {what} — {detail}` and end with `refs #4824`. Never write `closes`.
- Do not run `git stash`. Use one plain command per Bash call. Use `git -C "<worktree>"`, never `cd … &&`.
- Governing skill `skill-prose-conformance-tests`, verbatim: "`[IL-105]` says prove the assertion can go red". Also verbatim: "When the pinned prose is added in the same change, there is no frozen excerpt to use as a control. Prove each assertion on a mutated copy of the live text instead: delete or alter only the pinned clause, then assert the shared assertion helper throws **with that assertion's own message** — `assert.throws(() => assertBlock(mutated), { message }, …)` — preceded by `assert.notEqual(mutated, original)` so a replace that matched nothing cannot pass as a control." Also verbatim: "(3) a wrapped-span guard when the extractor reads one line at a time, because a `gh`/`issue view` pair split across a hard-wrapped line slips past it".
- Governing skill `prose-code-twin-pin`: the prose verdict list and `VERDICT_FIELDS` are already pinned equal by the `#4603: the prose names only the CLI's own flags, verdict fields and facts keys` test, so the new field lands in both. No other project skill's rule applies: the change adds no shell-out, no hook, no policy key and no `plugin/bin` source scan.
- Size: `verification-brief-parent-gate.md` is 44,844 B against the 52,500 B rail (`RAIL_BYTES`). This plan adds about 1.5 KB, which leaves about 6 KB of headroom.

## Review Focus

1. **GHE origin.** A `git@ghe.example:o/r.git` remote with `GH_HOST=ghe.example` exported must yield `repo: "ghe.example/o/r"`, the exact value the reads used. A bare `o/r` would send the write to github.com. Owned by Task 1 (CLI test).
2. **Empty value.** A `null` or empty verdict `repo` must stop the procedure before any gh line runs. Without the rule, `gh` exits 0 and writes to its default repository. Owned by Task 2 (the stop-rule pin and its go-red control).
3. **gh-absent run.** `--facts-json` without a qualified token yields `repo: null`, and with one it yields the slug. The prose must say the MCP path takes no `{parent-repo}`. Owned by Task 1 (CLI test) and Task 2 (the prose bullet).
4. **local-files backend.** It yields `repo: null` and makes no remote read (the existing `local-files: never calls gh, ghAvailable or remoteUrl` test still passes). Owned by Task 1.
5. **no-parent verdict.** It carries `repo` too, so `Object.keys(verdict)` still equals `VERDICT_FIELDS` on every state. Owned by Task 1 (lib test).

---

### Task 1: Verdict field `repo`

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/issues/parent-gate.js` (`VERDICT_FIELDS` at line 57, `evaluateParentGate` at line 290)
- Modify: `plugin/bin/parent-gate.js` (header Output comment at lines 47-48, the gh/facts path's `evaluateGateWithIdempotence` call at line 391)
- Modify: `docs/plugin-structure.md:235` (the verdict listing `{parent, state, …}` in the `parent-gate.js` CLI line)
- Test: `tests/bin-lib/issues/parent-gate.test.js`, `tests/parent-gate-cli.test.js`

**Interfaces:**
- Produces: `evaluateParentGate({ ..., slug = null })`, which returns `repo: slug` on every branch, `no-parent` included. `VERDICT_FIELDS = ['parent', 'repo', 'state', …unchanged]`. On the gh path, and on a `--facts-json` call with a qualified token, the CLI passes `slug: repoSlug({ host, owner, repo })` from the resolved spec at line 343. Every other path passes nothing.
- Consumes: `repoSlug({ host, owner, repo })` from `plugin/bin/lib/repo-resolve.js`, which `lib/issues/parent-gate.js` already imports.

- [ ] **Step 1: Write the failing tests**

In `tests/bin-lib/issues/parent-gate.test.js`:
- Update `the verdict carries VERDICT_FIELDS in order`'s literal list so `'repo'` comes after `'parent'`.
- Update `no parent yields the no-parent verdict`'s expected object to include `repo: null`.
- Add `evaluateParentGate passes slug through as repo`:
  ```js
  assert.equal(evaluateParentGate(facts()).repo, null);
  assert.equal(evaluateParentGate(facts({ slug: 'o/r' })).repo, 'o/r');
  assert.equal(evaluateParentGate({ parent: null, parentLabels: [], subIssues: [], riskFloor: 'high', slug: 'o/r' }).repo, 'o/r');
  ```

In `tests/parent-gate-cli.test.js`, add `the verdict names the repository its reads used`:
- `go(['--sub-issue', '11'], {}).verdict.repo === 'o/r'`
- the GHE run in `an Enterprise origin puts the host on every gh read` (line 333, `gateDeps: { env: { GH_HOST: GHE } }`) also asserts `r.verdict.repo === \`${GHE}/o/r\``
- with `remoteUrl: () => \`git@${GHE}:o/r.git\`` and `gateDeps: { env: { GH_HOST: 'github.com' } }`, `repo === 'o/r'` (the reads' host, never the remote's)
- `--facts-json` with `--closing 11,12` and `remoteUrl: boom` gives `repo === null`
- `--facts-json` with a qualified `--closing o/r#11` gives `repo === 'o/r'`
- `goLocal(['--parent', …], dir).verdict.repo === null`

- [ ] **Step 2: Run them to verify they fail**

Run: `node --test tests/bin-lib/issues/parent-gate.test.js tests/parent-gate-cli.test.js`
Expected: FAIL. The lib tests and the new CLI test fail on the missing `repo` key.

- [ ] **Step 3: Implement**

- Add `slug = null` to `evaluateParentGate`'s destructured input and return `repo: slug` on both branches, in `VERDICT_FIELDS` order.
- In `bin/parent-gate.js` `run()`, add `slug: owner && repo ? repoSlug({ host, owner, repo }) : null` to the gate input passed to `evaluateGateWithIdempotence` (line 391), and add `repoSlug` to the existing `require('./lib/repo-resolve')` destructure (lines 87-89). `runLocalFiles` stays untouched.
- Add `repo` to the CLI header's Output field list (line 48) and to `docs/plugin-structure.md:235`'s verdict listing, after `parent`.

Then fix the return-shape-widening fallout: the cross-path verdict equalities that now differ only in `repo`. Compare against the spread with the expected `repo`; never drop the key from the comparison.
- `parent-gate-cli.test.js:335` (GHE vs github.com): expect `{ ...go(argv, world).verdict, repo: \`${GHE}/o/r\` }`
- `:560` (facts vs gh, the table loop) and `:634` (facts vs gh, incomplete parent): expect `{ ...viaGh.verdict, repo: null }`. No table row at `:528-547` passes a qualified token, so every row takes `null`.
- any local-files literal the suite compares a whole verdict against: add `repo: null`

`tests/below-floor-parent-close-conformance.test.js`'s `#4603: the prose names only the CLI's own flags, verdict fields and facts keys` test goes red here (its length pin at line 1140 and its `missingSpans` check both read `VERDICT_FIELDS`). That is expected until Task 2 lands the `` `repo` `` span and updates the pin; Task 1 does not run that suite.

- [ ] **Step 4: Run the tests to verify they pass, then probe a real origin**

Run: `node --test tests/bin-lib/issues/parent-gate.test.js tests/parent-gate-cli.test.js tests/bin-lib/issues/below-floor-parent-close.test.js tests/bin-lib/issues/mcp-parent-gate-shape.test.js tests/bin-lib/issues/local-parent-gate-shape.test.js tests/bin-lib/reconcile/post-merge.test.js tests/path-guard-conformance.test.js tests/windows-hide-spawn-conformance.test.js tests/gh-host-seam-behavior.test.js tests/gh-host-seam-conformance.test.js`
Expected: PASS, 0 failures.

Run: `node plugin/bin/parent-gate.js --parent 4824 --work-links native --risk-floor high`
Then: `git remote get-url origin`
Expected: the verdict's `repo` is the `owner/repo` of the printed origin URL (`thn-inc/claude-tweaks`).

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/issues/parent-gate.js plugin/bin/parent-gate.js docs/plugin-structure.md tests/bin-lib/issues/parent-gate.test.js tests/parent-gate-cli.test.js
git commit -m "Add repo to the parent-gate verdict — the slug its reads used, for the prose writes; refs #4824"
```

### Task 2: Parent-gate gh lines carry `--repo "{parent-repo}"`, behind a stop rule

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/skills/wrap-up/verification-brief-parent-gate.md`. Edit the Transport paragraph (line 70), the verdict field list in **Run the gate CLI** (add a `repo` bullet after `parent`, line 293), the Close fences (lines 453, 461 and 469), Apply's comment read (line 622), the Apply fences (lines 641, 652 and 653) and Apply's **Partial-state note** (lines 659-664).
- Modify: `tests/below-floor-parent-close-conformance.test.js` (byte pins at lines 99, 100, 151 and 967-968; the `VERDICT_FIELDS.length` pin at line 1140)
- Modify: `tests/skill-fence-guard-shapes.test.js` only if its line-156 ratchet entry for this file stops matching exactly one offender
- Create: `tests/parent-gate-repo-flag-conformance.test.js`

**Interfaces:**
- Consumes: Task 1's verdict field `repo`.
- Produces: the literal `REPO_FLAG = '--repo "{parent-repo}"'`, which Task 3 counts as the `repo` class.

- [ ] **Step 1: Prove the AC grep's starting state**

Run: `grep -nE "gh issue (comment|close)" plugin/skills/wrap-up/verification-brief-parent-gate.md`
Expected: 5 lines, none containing `--repo`: 70, 453, 461, 469 and 652. Line 70 is the Transport mapping the spec's clarification names (as line 69, before the catch-up). Step 3 rewords it, so AC1.1's "only lines that also contain `--repo`" holds literally.

- [ ] **Step 2: Write the failing conformance suite `tests/parent-gate-repo-flag-conformance.test.js`**

The suite needs one pure helper: `flaglessGhLines(text) -> string[]`. It walks the text tracking ```` ``` ```` fence state. It returns every fenced line matching `/\bgh issue [a-z]+\b/` that does not contain `` `$PARENT_NUM ${REPO_FLAG}` ``. Each positive test and its go-red control call the same assertion function. Each control asserts `notEqual(mutated, live)` first, and a control over prose asserts the throw with that assertion's own message.

Tests:
- `AC1.1: every line the AC grep matches in the parent gate contains --repo`: filter the live file's lines by `/gh issue (comment|close)/`, assert the count is `>= 5` and that each includes `--repo`.
- `AC2.1: every fenced gh issue line in the parent gate carries --repo "{parent-repo}"`: `assert.deepEqual(flaglessGhLines(live), [])`, and the count of fenced `gh issue` lines in the live file is `>= 6`, so an empty scan cannot pass.
- `AC2.1 go-red: removing the flag from one fence is caught`: for each fenced `gh issue` line in the live file, delete ` ${REPO_FLAG}` on that one line and assert `flaglessGhLines(mutated)` returns exactly that line.
- `empty-value go-red: a shell-variable --repo is caught`: for each fenced `gh issue` line, replace `REPO_FLAG` with `--repo "$PARENT_REPO"` on that one line and assert `flaglessGhLines(mutated)` returns exactly that line. A variable no call assigns expands empty.
- `empty-value: the stop rule precedes every gh line`: the whitespace-collapsed live file contains `STOP_RULE` (the Global Constraints sentence as one string constant) exactly once, inside the collapsed **Run the gate CLI** section, and its index is below the index of the first fenced `gh issue` line in the collapsed file. Go-red: delete `STOP_RULE` from a copy and assert the shared assertion throws with its own presence message; then move `STOP_RULE` below the Close section's first fence in a copy and assert it throws with its own ordering message.
- `the scanner ignores prose and toggles on fences`: a synthetic text with one flagless `gh issue close 1` outside any fence and one inside, where only the fenced one is returned.
- `the Apply inline read carries the flag too`: the live file includes `` `gh issue view $PARENT_NUM --repo "{parent-repo}" --json comments` `` on one line.
- `the verdict list names repo as {parent-repo}`: the whitespace-collapsed **Run the gate CLI** section includes `` `repo` ``, `{parent-repo}` and `the \`gh\`-absent path's MCP calls take no \`{parent-repo}\``. Prove each of those three literals red on a mutated copy with a message-matched `assert.throws`.
- `the Apply partial-state note names the gh-default bootstrap`: the collapsed **Partial-state note.** paragraph includes `against \`gh\`'s default repository` and no longer includes `specifically impossible`. Prove each half red on a mutated copy with a message-matched `assert.throws`.

Run: `node --test tests/parent-gate-repo-flag-conformance.test.js`
Expected: FAIL. `flaglessGhLines(live)` lists the 6 fenced `gh issue` lines: 453, 461, 469, 641, 652 and 653. The line-622 `gh issue view` is an inline span, pinned by the separate inline-read test.

- [ ] **Step 3: Edit the prose**

- Each fence becomes `gh issue <verb> $PARENT_NUM --repo "{parent-repo}" <rest unchanged>`.
- Line 622's inline span becomes `` `gh issue view $PARENT_NUM --repo "{parent-repo}" --json comments` ``, kept on one line. `brokenSpanLines` in the existing suite checks this.
- Verdict list: add a `repo` bullet after `parent`. It is the repository the CLI's reads used (`owner/repo`, host-qualified off github.com). It is the `{parent-repo}` that every `gh` line below passes as `--repo`, filled in from the verdict, so one gate reads and writes one repository. Then the stop rule, byte for byte from Global Constraints. Then: `repo` is `null` under `--backend local-files` and under `--facts-json` without a qualified token. Neither path runs a `gh` line, and the `gh`-absent path's MCP calls take no `{parent-repo}`.
- Transport paragraph: `` `gh issue comment` is `add_issue_comment`; `gh issue close` and `gh issue edit --add-label` are `` becomes `` `gh issue comment --repo` is `add_issue_comment`; `gh issue close --repo` and `gh issue edit --repo --add-label` are ``.
- Apply's **Partial-state note.**: replace `(a transient \`gh\` error; the bootstrap above should make a missing-label failure specifically impossible)` with a parenthetical saying the failure is a transient `gh` error, or a missing label: the bootstrap above runs against `gh`'s default repository, so on a checkout whose default differs from origin, `demo:pending` may exist only there. Then add one sentence after the paragraph's last one: a label add that fails for a missing label fails again on every re-entry, and is reported as partial state, never retried in a loop. Keep the rest of the paragraph.

Update the byte pins in `tests/below-floor-parent-close-conformance.test.js`:
- `:99` becomes `'gh issue comment $PARENT_NUM --repo "{parent-repo}" --body-file'`
- `:100` becomes `'gh issue close $PARENT_NUM --repo "{parent-repo}" --reason completed'`
- `:151` becomes `'gh issue close $PARENT_NUM --repo "{parent-repo}" --reason "not planned"'`
- `:967-968` take the reworded pairings
- `:1140` becomes `assert.equal(VERDICT_FIELDS.length, 13)`

`GH_TO_MCP`'s `/^gh issue edit\b.*--add-label/` still matches. Keep it. `tests/comment-trust-conformance.test.js:211` is a frozen pre-change fixture; leave it. `tests/skill-fence-guard-shapes.test.js:156` ratchets the Apply fence by its `PARENT_VERIFICATION_BRIEF="$(node` anchor. If the edit changes how many offenders that anchor matches, re-anchor the entry so it matches exactly one offender. Never add a new ratchet entry for this file.

- [ ] **Step 4: Run to verify they pass, and re-run the AC grep**

Run: `node --test tests/parent-gate-repo-flag-conformance.test.js tests/below-floor-parent-close-conformance.test.js tests/comment-trust-conformance.test.js tests/fetch-sub-issues-prose-conformance.test.js tests/skill-fence-guard-shapes.test.js tests/try-it-contract-conformance.test.js tests/accept-label-reader-conformance.test.js tests/node-e-snippet-syntax.test.js`
Expected: PASS.

Run: `grep -nE "gh issue (comment|close)" plugin/skills/wrap-up/verification-brief-parent-gate.md`
Expected: every printed line contains `--repo`.

Run: `wc -c plugin/skills/wrap-up/verification-brief-parent-gate.md`
Expected: under 52,500.

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/wrap-up/verification-brief-parent-gate.md tests/parent-gate-repo-flag-conformance.test.js tests/below-floor-parent-close-conformance.test.js
git commit -m "Pass --repo on the parent gate's gh lines — comment, close and label land where the gate read, never on an empty value; refs #4824"
```

Add `tests/skill-fence-guard-shapes.test.js` to the `git add` only if Step 3 re-anchored it.

### Task 3: Inventory of the remaining `gh issue` writes

**Role:** judgment

**Files:**
- Create: `docs/reference/gh-issue-write-inventory.md`
- Modify: `docs/REGISTRY.md` (one row after line 31, in the same shape)

**Interfaces:**
- Consumes: Task 2's state, in which every fenced `gh issue` line of `verification-brief-parent-gate.md` carries `--repo "{parent-repo}"`.
- Produces: the `needs-fix` list, which the controller files as one follow-up record (Task 4).

This task edits no skill file. The spec says, verbatim: "This record adds `--repo` only to the Parent-Gate Procedure, and adds no slug-resolution step to any other procedure."

The inventory is committed prose, not a test ratchet. A suite keyed on every `gh issue` line across 84 skill files would turn sibling branches red at merge for an edit unrelated to them, and AC3.1 asks for the inventory, not a guard on future lines. The scan stays scratch; its result goes to the run directory (Step 4).

- [ ] **Step 1: Scan**

Write a scratch script under the session scratchpad, never committed. It walks `plugin/skills/**/*.md` and emits one row per write: `{file, line, kind: fence|span, text}`.
- Write regex: `/\bgh issue (comment|close|edit|create|reopen|delete|lock|unlock|pin|unpin|transfer|develop)\b/`.
- Fence state toggles on `/^\s*(```|~~~)/`.
- Outside fences, match backtick spans, including a span wrapped across one line break (`review/cross-spec-promise-check.md:26` is one).

Expected: about 79 fence rows and 188 span rows across about 84 files (the plan author's scan, which did not join wrapped spans, so the span count is a floor). Reconcile the total against an independent count: `git grep -c -E "gh issue (comment|close|edit|create|reopen|delete|lock|unlock|pin|unpin|transfer|develop)" -- plugin/skills` counts matching lines. Explain every difference between the two counts in the report (several matches on one line, a wrapped span, a match outside both a fence and a span).

- [ ] **Step 2: Classify each row, reading the procedure around it**

| Class | Meaning |
|---|---|
| `repo` | Carries `--repo`. |
| `cwd-scoped` | Runs, and the procedure's reads for that record also resolve against `gh`'s default repository: bare `gh issue`/`gh pr` calls and `gh api repos/{owner}/{repo}/…` placeholders, which `gh` fills from that same default. Reads and writes cannot split across remotes. |
| `needs-fix` | Runs bare, and the procedure reads that record through an origin-resolved slug or a CLI verdict sourced from `origin`. The parent gate's hazard has recurred. |
| `descriptive` | Names the command without running it: a transport mapping table, a `#`/`//` comment, an `echo`ed string, a quoted hint, a numbered example such as `gh issue edit 123`, or a command a human runs. |

Precedence: `descriptive` wins. A row that only names a command is `descriptive` even when its text contains `--repo` (the parent gate's reworded Transport mapping, line 70, is one). `repo` is for a row that runs.

Confirm per file; do not assume. In the plan author's scan, `dispatch/settle-and-merge.md`'s `{owner}/{repo}` and `_shared/issue-claims.md`'s claims reads are `gh`'s own default-repo placeholders, which reads as `cwd-scoped`. A `needs-fix` row, fence or span, is left as it is: the clarification makes that class satisfy AC3.1, and the follow-up record carries it.

- [ ] **Step 3: Write `docs/reference/gh-issue-write-inventory.md`**

The doc holds:
- a one-paragraph purpose naming #4824
- the commit it was scanned at
- the write regex and the two scan rules from Step 1, so a reader can reproduce it
- the Step 2 class table
- per-class counts
- a `needs-fix` list on its own, under the heading `## Needs a fix`, each entry `{file}:{line}` plus a one-line reason naming the origin-resolved read it splits from
- one table per file, with columns `Line | Kind | Command | Class`, and a one-line note under a file's table when its classification needed a reason beyond the class definition

Escape every `|` in a command as `\|`. No row is left without a class. Do not write a follow-up record number; Task 4 adds it.

Add the `docs/REGISTRY.md` row: `| docs/reference/gh-issue-write-inventory.md | Classified inventory of `gh issue` writes under `plugin/skills/` (#4824) — fenced lines and runnable inline spans, each `repo`, `cwd-scoped`, `needs-fix` or `descriptive`; a snapshot at its stated commit | *(no auto-detect — a point-in-time snapshot, re-scanned when a `--repo` sweep runs)* |`

- [ ] **Step 4: Record AC3.1's evidence and commit**

Create `/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude-tweaks/pipelines/2026-11-03T082955-record-4824/evidence` with `mkdir -p`. Then write the final scan's full output to `gh-issue-write-scan.txt` inside it with a plain Bash redirect. Report to the controller, verbatim: the scan's row count, the doc's table-row count, the per-class counts, and the full `## Needs a fix` list. The two row counts must be equal. AC3.1 is: "The inventory of the remaining prose fences is committed or filed, with no fence left unclassified."

```bash
git add docs/reference/gh-issue-write-inventory.md docs/REGISTRY.md
git commit -m "Inventory the gh issue writes under plugin/skills — fenced lines and runnable spans, each classified; refs #4824"
```

The controller writes the `AC evidence` entry through `log-decision.js --text-file`, from those counts.

### Task 4: Name the follow-up record in the inventory

**Role:** transcription

**Files:**
- Modify: `docs/reference/gh-issue-write-inventory.md` (the `## Needs a fix` section)

**Interfaces:**
- Consumes: the follow-up record number `#{M}`. Between Task 3 and Task 4, the controller files it with `/claude-tweaks:capture`, per `build/SKILL.md` Common Step 4. The body is spec-shaped: Current State quoting Task 3's `## Needs a fix` list, Deliverables, Acceptance Criteria, `Defer-reason: genuinely-larger`, and a `### Key Files` list naming each file in that list. It also carries the known residual below. The controller passes `#{M}` in this task's brief.

- [ ] **Step 1: Add the record number**

Directly under the `## Needs a fix` heading, add one line: `These writes go to #{M}, filed from #4824; this record fixes none of them.` Use the literal number.

- [ ] **Step 2: Verify**

Run: `grep -n "#{M}" docs/reference/gh-issue-write-inventory.md`, with the literal number.
Expected: exactly one line, under `## Needs a fix`.

- [ ] **Step 3: Commit**

```bash
git add docs/reference/gh-issue-write-inventory.md
git commit -m "Name the needs-fix follow-up in the gh issue write inventory — one record carries them all; refs #4824"
```

## Coverage

| Spec item | Task |
|---|---|
| Deliverable 1, `--repo {owner}/{repo}` on the Close and Apply fences, taken from the gate's own resolution | 1 (verdict field), 2 (fences) |
| Deliverable 2, inventory across `plugin/skills/**/*.md`, fences and runnable spans, each classified | 3 |
| Clarification 3, needs-fix writes go to one named follow-up; no slug resolution outside the Parent-Gate Procedure | 3 (no skill edits), 4 (the record named in the doc) |
| Clarification 4, an empty `--repo` value stops before the write, pinned by the test | 2 (the stop rule and the `empty-value` tests) |
| AC1.1, the grep before and after | 2, Steps 1 and 4, and the `AC1.1` test |
| AC2.1, a conformance test that goes red on removal | 2 (the `AC2.1` tests) |
| AC3.1, the inventory committed with no fence unclassified | 3 (Steps 3 and 4) |

Waived plugin/bin/lib/issues/below-floor-parent-close.js: read only, as the `repoSlug` pattern to copy; its writes already carry `--repo`.

Known residual, outside this record: Apply's label bootstrap (`_shared/label-bootstrap.md`'s `gh label list`/`create` loop) stays gh-default. On a checkout whose gh default differs from origin, `demo:pending` can be bootstrapped into the other repository, so the `--repo` label add fails and is reported as partial state. That outcome is strictly better than today, where every write went to the other repository. It goes into Task 4's follow-up record as its own Deliverable, `Defer-reason: genuinely-larger`, because it changes a shared contract that many consumers cite.
