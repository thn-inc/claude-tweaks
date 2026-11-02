# Parent-Gate `--repo` on Prose Writes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Parent-Gate Procedure's prose writes (`gh issue comment|close|edit`, plus Apply's comment read) target the same repository the gate's CLI read from. Then inventory every other `gh issue` write under `plugin/skills/`, fenced lines and runnable inline spans alike, so none is left unclassified.

**Architecture:** `bin/parent-gate.js` already resolves `owner/repo` (and the host) from the origin remote for its reads. It gains one verdict field, `repo` (`repoSlug({host, owner, repo})`: bare `owner/repo` on github.com, host-qualified elsewhere, `null` when the CLI resolved no origin). The prose binds it as `$PARENT_REPO` next to `$PARENT_NUM`, and every gh fence passes `--repo "$PARENT_REPO"`. A new conformance suite pins those fences. The inventory is one committed reference doc, one row per write.

**Tech Stack:** Node 18+ CommonJS, `node --test`, Markdown skill prose.

**Spec:** `.claude-tweaks/pipelines/2026-11-02T201539-record-4824/work/4824-spec.md` (record #4824, with its `## Plan Review Clarifications` section)

## Global Constraints

- The verdict field is named `repo`. It sits second in `VERDICT_FIELDS`, after `parent`. Its value comes from `repoSlug` in `plugin/bin/lib/repo-resolve.js`, the same helper `below-floor-parent-close.js` uses for its `--repo`.
- Prose placeholder: `$PARENT_REPO`, written as `--repo "$PARENT_REPO"` and placed right after `$PARENT_NUM` on every gh line in `plugin/skills/wrap-up/verification-brief-parent-gate.md`.
- No `--repo` flag is added to `parent-gate.js`. The repository still comes only from the origin remote, so `unknownCliFlags` in `below-floor-parent-close-conformance.test.js` must keep reporting `--repo` as unknown.
- `--facts-json` keeps its contract: it reads the origin remote only for a qualified `--closing` token. Without one, `repo` is `null`; with one, `repo` is that slug. `--backend local-files` reads no remote, so `repo` is `null` there too.
- Spec, verbatim: "Runnable inline-span `gh issue` writes are inventoried too." and "The inventory classifies; it does not fix the inline writes."
- Commit subjects use `{Verb} {what} — {detail}` and end with `refs #4824`. Never write `closes`.
- Do not run `git stash`. Use one plain command per Bash call. Use `git -C "<worktree>"`, never `cd … &&`.
- Governing skill `skill-prose-conformance-tests`, verbatim: "`[IL-105]` says prove the assertion can go red". Governing skill `prose-code-twin-pin`: the prose verdict list and `VERDICT_FIELDS` are already pinned equal by the `#4603: the prose names only the CLI's own flags, verdict fields and facts keys` test, so the new field lands in both. No other project skill's rule applies: the change adds no shell-out, no hook, no policy key and no `plugin/bin` source scan.
- Size: `verification-brief-parent-gate.md` is 44,844 B against the 52,500 B rail; this plan adds under 1 KB.

## Review Focus

1. **GHE origin.** A `git@ghe.example:o/r.git` remote must yield `repo: "ghe.example/o/r"`, the exact value the reads used. A bare `o/r` would send the write to github.com. Owned by Task 1 (CLI test).
2. **gh-absent run.** `--facts-json` without a qualified token yields `repo: null`, and with one yields the slug. The prose must say `$PARENT_REPO` applies only to the `gh` fences and that the MCP path is unchanged. Owned by Task 1 (CLI test) and Task 2 (the prose bullet).
3. **local-files backend.** It yields `repo: null` and makes no remote read (the existing `local-files: never calls gh, ghAvailable or remoteUrl` test still passes). Owned by Task 1.
4. **no-parent verdict.** It carries `repo` too, so `Object.keys(verdict)` still equals `VERDICT_FIELDS` on every state. Owned by Task 1 (lib test).
5. **A fence losing its flag.** Removing `--repo "$PARENT_REPO"` from any one gh line in the gate file turns the new suite red. Owned by Task 2 (go-red test).

---

### Task 1: Verdict field `repo`

**Role:** integration

**Files:**
- Modify: `plugin/bin/lib/issues/parent-gate.js` (`VERDICT_FIELDS` at line 57, `evaluateParentGate` at line 290)
- Modify: `plugin/bin/parent-gate.js` (header Output comment at line 48, the gh/facts path's `evaluateGateWithIdempotence` call at line 375)
- Modify: `docs/plugin-structure.md:233` (the verdict listing `{parent, state, …}`)
- Test: `tests/bin-lib/issues/parent-gate.test.js`, `tests/parent-gate-cli.test.js`

**Interfaces:**
- Produces: `evaluateParentGate({ ..., slug = null })`, which returns `repo: slug` on every branch, `no-parent` included. `VERDICT_FIELDS = ['parent', 'repo', 'state', …unchanged]`. On the gh path, and on a `--facts-json` call with a qualified token, the CLI passes `slug: repoSlug({ host, owner, repo })`. Every other path passes nothing.
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
- the GHE run in `an Enterprise origin puts the host on every gh read` also asserts `r.verdict.repo === \`${GHE}/o/r\``
- `--facts-json` with `--closing 11,12` and `remoteUrl: boom` gives `repo === null`
- `--facts-json` with a qualified `--closing o/r#11` gives `repo === 'o/r'`
- `goLocal(['--parent', …], dir).verdict.repo === null`

- [ ] **Step 2: Run them to verify they fail**

Run: `node --test tests/bin-lib/issues/parent-gate.test.js tests/parent-gate-cli.test.js`
Expected: FAIL. The lib tests and the new CLI test fail on the missing `repo` key.

- [ ] **Step 3: Implement**

- Add `slug = null` to `evaluateParentGate`'s destructured input and return `repo: slug` on both branches, in `VERDICT_FIELDS` order.
- In `bin/parent-gate.js` `run()`, add `slug: owner && repo ? repoSlug({ host, owner, repo }) : null` to the gate input passed to `evaluateGateWithIdempotence`, importing `repoSlug` from `./lib/repo-resolve`. `runLocalFiles` stays untouched.
- Add `repo` to the CLI header's Output field list and to `docs/plugin-structure.md:233`'s verdict listing, after `parent`.

Then fix the return-shape-widening fallout: the cross-path verdict equalities that now differ only in `repo`. Compare against the spread with the expected `repo`; never drop the key from the comparison.
- `parent-gate-cli.test.js:335` (GHE vs github.com): expect `{ ...go(argv, world).verdict, repo: \`${GHE}/o/r\` }`
- `:560` and `:620` (facts vs gh): expect `{ ...viaGh.verdict, repo: null }`. If a table row at `:560` passes a qualified token, it keeps the slug instead.
- the local-files literal the suite compares a whole verdict against: add `repo: null`

`tests/below-floor-parent-close-conformance.test.js`'s `#4603: the prose names only the CLI's own flags, verdict fields and facts keys` test goes red here (its length pin and its `missingSpans` check both read `VERDICT_FIELDS`). That is expected until Task 2 lands the `` `repo` `` span and updates the pin; Task 1 does not run that suite.

- [ ] **Step 4: Run the tests to verify they pass, then probe a real origin**

Run: `node --test tests/bin-lib/issues/parent-gate.test.js tests/parent-gate-cli.test.js tests/bin-lib/issues/below-floor-parent-close.test.js tests/bin-lib/issues/mcp-parent-gate-shape.test.js tests/bin-lib/issues/local-parent-gate-shape.test.js tests/bin-lib/reconcile/post-merge.test.js tests/path-guard-conformance.test.js tests/windows-hide-spawn-conformance.test.js`
Expected: PASS, 0 failures.

Run: `node plugin/bin/parent-gate.js --parent 4824 --work-links native --risk-floor high`
Then: `git remote get-url origin`
Expected: the verdict's `repo` is the `owner/repo` of the printed origin URL.

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/issues/parent-gate.js plugin/bin/parent-gate.js docs/plugin-structure.md tests/bin-lib/issues/parent-gate.test.js tests/parent-gate-cli.test.js
git commit -m "Add repo to the parent-gate verdict — the slug its reads used, for the prose writes; refs #4824"
```

### Task 2: Parent-gate prose fences carry `--repo "$PARENT_REPO"`

**Role:** integration

**Files:**
- Modify: `plugin/skills/wrap-up/verification-brief-parent-gate.md`. Edit the Transport paragraph (line 70), the verdict field list in **Run the gate CLI** (add a `repo` bullet after `parent`, line 293), the Close fences (lines 453, 461 and 469), Apply's comment read (line 622) and the Apply fences (lines 641, 652 and 653).
- Modify: `tests/below-floor-parent-close-conformance.test.js` (byte pins at lines 99, 100, 151 and 967-968; the `VERDICT_FIELDS.length` pin at line 1140)
- Create: `tests/parent-gate-repo-flag-conformance.test.js`

**Interfaces:**
- Consumes: Task 1's verdict field `repo`.

- [ ] **Step 1: Prove the AC grep's starting state**

Run: `grep -nE "gh issue (comment|close)" plugin/skills/wrap-up/verification-brief-parent-gate.md`
Expected: 5 lines, none containing `--repo`: 70, 453, 461, 469 and 652. Line 70 is the Transport mapping the spec's clarification names (as line 69, before the catch-up). Step 3 rewords it, so AC1.1's "only lines that also contain `--repo`" holds literally.

- [ ] **Step 2: Write the failing conformance suite `tests/parent-gate-repo-flag-conformance.test.js`**

The suite needs one pure helper: `bareGhLines(text) -> string[]`. It walks the text tracking ```` ``` ```` fence state. It returns every fenced line matching `/\bgh issue [a-z]+\b/` that lacks `--repo "$PARENT_REPO"`. Each positive test and its go-red control call the same assertion function.

Tests:
- `AC1.1: every line the AC grep matches in the parent gate contains --repo`: filter the live file's lines by `/gh issue (comment|close)/`, assert the count is `>= 5` and that each includes `--repo`.
- `AC2.1: every fenced gh issue line in the parent gate carries --repo "$PARENT_REPO"`: `assert.deepEqual(bareGhLines(live), [])`, and the count of fenced `gh issue` lines in the live file is `>= 6`, so an empty scan cannot pass.
- `AC2.1 go-red: removing the flag from one fence is caught`: for each fenced `gh issue` line in the live file, replace ` --repo "$PARENT_REPO"` with `''` on that one line and assert `bareGhLines(mutated)` returns exactly that line.
- `the scanner ignores prose and toggles on fences`: a synthetic text with one bare `gh issue close 1` outside any fence and one inside, where only the fenced one is returned.
- `the Apply inline read carries the flag too`: the live file includes `` `gh issue view $PARENT_NUM --repo "$PARENT_REPO" --json comments` `` on one line.
- `the verdict list names repo as $PARENT_REPO`: the collapsed **Run the gate CLI** section includes `` `repo` `` and `$PARENT_REPO`, and states that the `gh`-absent path does not use it.

Run: `node --test tests/parent-gate-repo-flag-conformance.test.js`
Expected: FAIL. `bareGhLines(live)` lists the 6 fenced `gh issue` lines: 453, 461, 469, 641, 652 and 653. The line-622 `gh issue view` is an inline span, pinned by the separate inline-read test.

- [ ] **Step 3: Edit the prose**

- Each fence becomes `gh issue <verb> $PARENT_NUM --repo "$PARENT_REPO" <rest unchanged>`.
- Line 622's inline span becomes `` `gh issue view $PARENT_NUM --repo "$PARENT_REPO" --json comments` ``, kept on one line; `brokenSpanLines` in the existing suite checks this.
- Verdict list: add a `repo` bullet after `parent`. It is the repository the CLI's reads used (`owner/repo`, host-qualified off github.com), and it is the `$PARENT_REPO` that every `gh` fence below passes as `--repo`, so one gate reads and writes one repository. It is `null` under `--backend local-files` and under `--facts-json` without a qualified token; neither path runs a `gh` fence, and the `gh`-absent path's MCP calls take no `$PARENT_REPO`.
- Transport paragraph: `` `gh issue comment` is `add_issue_comment`; `gh issue close` and `gh issue edit --add-label` are `` becomes `` `gh issue comment --repo` is `add_issue_comment`; `gh issue close --repo` and `gh issue edit --repo --add-label` are ``.

Update the byte pins in `tests/below-floor-parent-close-conformance.test.js`:
- `:99` becomes `'gh issue comment $PARENT_NUM --repo "$PARENT_REPO" --body-file'`
- `:100` becomes `'gh issue close $PARENT_NUM --repo "$PARENT_REPO" --reason completed'`
- `:151` becomes `'gh issue close $PARENT_NUM --repo "$PARENT_REPO" --reason "not planned"'`
- `:967-968` take the reworded pairings
- `:1140` becomes `assert.equal(VERDICT_FIELDS.length, 13)`

`GH_TO_MCP`'s `/^gh issue edit\b.*--add-label/` still matches. Keep it. `tests/comment-trust-conformance.test.js:211` is a frozen pre-change fixture; leave it.

- [ ] **Step 4: Run to verify they pass, and re-run the AC grep**

Run: `node --test tests/parent-gate-repo-flag-conformance.test.js tests/below-floor-parent-close-conformance.test.js tests/comment-trust-conformance.test.js tests/fetch-sub-issues-prose-conformance.test.js tests/skill-fence-guard-shapes.test.js tests/try-it-contract-conformance.test.js tests/accept-label-reader-conformance.test.js`
Expected: PASS.

Run: `grep -nE "gh issue (comment|close)" plugin/skills/wrap-up/verification-brief-parent-gate.md`
Expected: every printed line contains `--repo`.

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/wrap-up/verification-brief-parent-gate.md tests/parent-gate-repo-flag-conformance.test.js tests/below-floor-parent-close-conformance.test.js
git commit -m "Pass --repo on the parent gate's prose writes — comment, close and label land where the gate read; refs #4824"
```

### Task 3: Inventory of the remaining `gh issue` writes

**Role:** judgment

**Files:**
- Create: `docs/reference/gh-issue-write-inventory.md`
- Modify: `docs/REGISTRY.md` (one row after line 31, in the same shape)

Step 3 may also modify a skill file whose fenced write it finds hazardous with a slug in scope, plus the conformance pins on that file's lines. The scan decides which, so no path is named here.

**Interfaces:**
- Consumes: Task 2's state, in which `verification-brief-parent-gate.md` has no bare fenced write.

The inventory is committed prose, not a test ratchet. A suite keyed on every `gh issue` line across 84 skill files would turn sibling branches red at merge for an edit unrelated to them, and AC3.1 asks for the inventory, not a guard on future lines. The scan stays scratch; its result goes to the run directory (Step 5).

- [ ] **Step 1: Scan**

Write a scratch script under the session scratchpad, never committed. It walks `plugin/skills/**/*.md` and emits one row per write: `{file, line, kind: fence|span, text}`.
- Write regex: `/\bgh issue (comment|close|edit|create|reopen|delete|lock|unlock|pin|unpin|transfer|develop)\b/`.
- Fence state toggles on `/^\s*(```|~~~)/`.
- Outside fences, match backtick spans, including a span wrapped across one line break (`review/cross-spec-promise-check.md:26` is one).

Expected: about 79 fence rows and 188 span rows across about 84 files (the plan author's scan, which did not join wrapped spans, so the span count is a floor). Reconcile the total against an independent count: `git grep -c -E "gh issue (comment|close|edit|create|reopen|delete|lock|unlock|pin|unpin|transfer|develop)" -- plugin/skills` counts matching lines.

- [ ] **Step 2: Classify each row, reading the procedure around it**

| Class | Meaning |
|---|---|
| `repo` | Carries `--repo`. |
| `cwd-scoped` | Runs, and the procedure's reads for that record also resolve against `gh`'s default repository: bare `gh issue`/`gh pr` calls and `gh api repos/{owner}/{repo}/…` placeholders, which `gh` fills from that same default. Reads and writes cannot split across remotes. |
| `needs-fix` | Runs bare, and the procedure reads that record through an origin-resolved slug or a CLI verdict sourced from `origin`. The parent gate's hazard has recurred. |
| `descriptive` | Names the command without running it: a transport mapping table, a `#`/`//` comment, an `echo`ed string, a quoted hint, a numbered example such as `gh issue edit 123`, or a command a human runs. |

Confirm per file; do not assume. In the plan author's scan, `dispatch/settle-and-merge.md`'s `{owner}/{repo}` and `_shared/issue-claims.md`'s claims reads are `gh`'s own default-repo placeholders, which reads as `cwd-scoped`.

- [ ] **Step 3: Handle each `needs-fix` row by kind**

- **Span:** leave it unfixed and record it `needs-fix`. The spec says the inventory does not fix inline writes.
- **Fence, with a slug in scope in that procedure:** add `--repo` from that slug and record the row `repo`. Update any pin the edit breaks (`git grep -n -F '{old line}' -- tests plugin`). Commit these prose fixes on their own, before the inventory, with the touched files' suites green: `Pass --repo on {file}'s bare writes — its reads are origin-resolved; refs #4824`.
- **Fence, with no slug in scope:** leave it, record it `needs-fix`, and report `DONE_WITH_CONCERNS` naming the file and line. Deliverable 2 allows a fence only `--repo` or `cwd-scoped`, so the controller rules on it.

- [ ] **Step 4: Write `docs/reference/gh-issue-write-inventory.md`**

Rerun the scan after Step 3, so the line numbers are current. The doc holds: a one-paragraph purpose naming #4824; the commit it was scanned at; the write regex and the two scan rules from Step 1, so a reader can reproduce it; the Step 2 class table; per-class counts; a `needs-fix` list on its own; then one table per file with columns `Line | Kind | Command | Class`, with a one-line note under a file's table when its classification needed a reason beyond the class definition. Escape every `|` in a command as `\|`. No row is left without a class.

Add the `docs/REGISTRY.md` row: `| docs/reference/gh-issue-write-inventory.md | Classified inventory of `gh issue` writes under `plugin/skills/` (#4824) — fenced lines and runnable inline spans, each `repo`, `cwd-scoped`, `needs-fix` or `descriptive`; a snapshot at its stated commit | *(no auto-detect — a point-in-time snapshot, re-scanned when a `--repo` sweep runs)* |`

- [ ] **Step 5: Record AC3.1's evidence and commit**

Create `/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude-tweaks/pipelines/2026-11-02T201539-record-4824/evidence` with `mkdir -p`, then write the final scan's full output to `gh-issue-write-scan.txt` inside it with a plain Bash redirect. Report to the controller, verbatim: the scan's row count, the doc's table-row count, and the per-class counts. The two row counts must be equal. AC3.1 is: "The inventory of the remaining prose fences is committed or filed, with no fence left unclassified."

```bash
git add docs/reference/gh-issue-write-inventory.md docs/REGISTRY.md
git commit -m "Inventory the gh issue writes under plugin/skills — fenced lines and runnable spans, each classified; refs #4824"
```

The controller writes the `AC evidence` entry through `log-decision.js --text-file`, from those counts.

## Coverage

| Spec item | Task |
|---|---|
| Deliverable 1, `--repo {owner}/{repo}` on the Close and Apply fences, taken from the gate's own resolution | 1 (verdict field), 2 (fences) |
| Deliverable 2, inventory across `plugin/skills/**/*.md`, fences and runnable spans, each classified | 3 |
| AC1.1, the grep before and after | 2, Steps 1 and 4, and the `AC1.1` test |
| AC2.1, a conformance test that goes red on removal | 2 (the `AC2.1` tests) |
| AC3.1, the inventory committed with no fence unclassified | 3 (Steps 4 and 5) |

Waived plugin/bin/lib/issues/below-floor-parent-close.js: read only, as the `repoSlug` pattern to copy; its writes already carry `--repo`.

Known residual, outside this record: Apply's label bootstrap (`_shared/label-bootstrap.md`'s `gh label list`/`create` loop) stays gh-default. On a checkout whose gh default differs from origin, `demo:pending` can be bootstrapped into the other repository, so the `--repo` label add fails and is reported as partial state. That outcome is strictly better than today, where every write went to the other repository. It goes to the ledger as a follow-up, `Defer-reason: genuinely-larger`, because it changes a shared contract that many consumers cite. Task 3's `needs-fix` spans go to the same follow-up: the spec keeps them out of this record.
