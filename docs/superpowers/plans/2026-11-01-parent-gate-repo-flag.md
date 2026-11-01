# Parent-Gate `--repo` on Prose Writes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Parent-Gate Procedure's prose writes (`gh issue comment|close|edit`, plus Apply's comment read) target the same repository the gate's CLI read from. Then inventory every other bare fenced `gh issue` write under `plugin/skills/` so none is left unclassified.

**Architecture:** `bin/parent-gate.js` already resolves `owner/repo` (and the host) from the origin remote for its reads. It gains one verdict field, `repo` (`repoSlug({host, owner, repo})`: bare `owner/repo` on github.com, host-qualified elsewhere, `null` when the CLI resolved no origin). The prose binds it as `$PARENT_REPO` next to `$PARENT_NUM`, and every gh fence passes `--repo "$PARENT_REPO"`. A new conformance suite pins those fences. A second new suite is the committed inventory: per file, the bare fenced `gh issue` write lines, classified.

**Tech Stack:** Node 18+ CommonJS, `node --test`, Markdown skill prose.

**Spec:** `.claude-tweaks/pipelines/2026-11-01T203400-record-4824/work/4824-spec.md` (record #4824)

## Global Constraints

- The verdict field is named `repo`. It sits second in `VERDICT_FIELDS`, after `parent`. Its value comes from `repoSlug` in `plugin/bin/lib/repo-resolve.js`, the same helper `below-floor-parent-close.js` uses for its `--repo`.
- Prose placeholder: `$PARENT_REPO`, written as `--repo "$PARENT_REPO"` and placed right after `$PARENT_NUM` on every gh line in `plugin/skills/wrap-up/verification-brief-parent-gate.md`.
- No `--repo` flag is added to `parent-gate.js`. The repository still comes only from the origin remote, so `unknownCliFlags` in `below-floor-parent-close-conformance.test.js` must keep reporting `--repo` as unknown.
- `--facts-json` keeps its contract: it reads the origin remote only for a qualified `--closing` token. Without one, `repo` is `null`. `--backend local-files` reads no remote, so `repo` is `null` there too.
- Commit subjects use `{Verb} {what} — {detail}` and end with `refs #4824`. Never write `closes`.
- Do not run `git stash`. Use one plain command per Bash call. Use `git -C "<worktree>"`, never `cd … &&`.

## Review Focus

1. **GHE origin.** A `git@ghe.example:o/r.git` remote must yield `repo: "ghe.example/o/r"`, the exact value the reads used. A bare `o/r` would send the write to github.com. Owned by Task 1 (CLI test).
2. **gh-absent run.** `--facts-json` without a qualified token yields `repo: null`. The prose must say `$PARENT_REPO` applies only to the `gh` fences, and that the MCP path is unchanged. Owned by Task 1 (CLI test) and Task 2 (the prose bullet).
3. **local-files backend.** It yields `repo: null` and makes no remote read (the existing `local-files: never calls gh, ghAvailable or remoteUrl` test still passes). Owned by Task 1.
4. **no-parent verdict.** It carries `repo` too, so `Object.keys(verdict)` still equals `VERDICT_FIELDS` on every state. Owned by Task 1 (lib test).
5. **A fence losing its flag.** Removing `--repo "$PARENT_REPO"` from any one gh line in the gate file turns the new suite red. Owned by Task 2 (go-red test).

---

### Task 1: Verdict field `repo`

**Files:**
- Modify: `plugin/bin/lib/issues/parent-gate.js` (`VERDICT_FIELDS` at line 56, `evaluateParentGate` at about line 260)
- Modify: `plugin/bin/parent-gate.js` (header Output comment at about line 46, the gh/facts path's `evaluateGateWithIdempotence` call at about line 366)
- Modify: `docs/plugin-structure.md:228` (the verdict listing `{parent, state, …}`)
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
- the GHE run at line 332 also asserts `r.verdict.repo === \`${GHE}/o/r\``
- `--facts-json` with `--closing 11,12` and `remoteUrl: boom` gives `repo === null`
- `goLocal(['--parent', …], dir).verdict.repo === null`

- [ ] **Step 2: Run them to verify they fail**

Run: `node --test tests/bin-lib/issues/parent-gate.test.js tests/parent-gate-cli.test.js`
Expected: FAIL. The lib tests and the new CLI test fail on the missing `repo` key.

- [ ] **Step 3: Implement**

- Add `slug = null` to `evaluateParentGate`'s destructured input and return `repo: slug` on both branches, in `VERDICT_FIELDS` order.
- In `bin/parent-gate.js` `run()`, add `slug: owner && repo ? repoSlug({ host, owner, repo }) : null` to the gate input passed to `evaluateGateWithIdempotence`, importing `repoSlug` from `./lib/repo-resolve`. `runLocalFiles` stays untouched.
- Add `repo` to the CLI header's Output field list and to `docs/plugin-structure.md:228`'s verdict listing, after `parent`.

Then fix the return-shape-widening fallout: the cross-path verdict equalities that now differ only in `repo`. Compare against the spread with the expected `repo`; never drop the key from the comparison.
- `parent-gate-cli.test.js:334` (GHE vs github.com): expect `{ ...go(argv, world).verdict, repo: \`${GHE}/o/r\` }`
- `:558` and `:618` (facts vs gh): expect `{ ...viaGh.verdict, repo: null }`
- `:767` (local-files literal): add `repo: null`

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/bin-lib/issues/parent-gate.test.js tests/parent-gate-cli.test.js tests/bin-lib/issues/below-floor-parent-close.test.js tests/bin-lib/issues/mcp-parent-gate-shape.test.js tests/bin-lib/issues/local-parent-gate-shape.test.js tests/bin-lib/reconcile/post-merge.test.js`
Expected: PASS, 0 failures.

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/issues/parent-gate.js plugin/bin/parent-gate.js docs/plugin-structure.md tests/bin-lib/issues/parent-gate.test.js tests/parent-gate-cli.test.js
git commit -m "Add repo to the parent-gate verdict — the slug its reads used, for the prose writes; refs #4824"
```

### Task 2: Parent-gate prose fences carry `--repo "$PARENT_REPO"`

**Files:**
- Modify: `plugin/skills/wrap-up/verification-brief-parent-gate.md`. Edit the Transport paragraph (line 69), the verdict field list in **Run the gate CLI** (add a `repo` bullet after `parent`), the Close fences (lines 442, 450 and 458), Apply's comment read (line 567) and the Apply fences (lines 586, 597 and 598).
- Modify: `tests/below-floor-parent-close-conformance.test.js` (byte pins at lines 98, 99, 150 and 966-967)
- Create: `tests/parent-gate-repo-flag-conformance.test.js`

**Interfaces:**
- Consumes: Task 1's verdict field `repo`.

- [ ] **Step 1: Prove the AC grep's starting state**

Run: `grep -nE "gh issue (comment|close)" plugin/skills/wrap-up/verification-brief-parent-gate.md`
Expected: 5 lines, none containing `--repo`. That is 442, 450, 458 and 597, plus the line-69 Transport prose. The record's AC says "the four bare lines", but it missed line 69. Step 3 rewords line 69 so the AC's "only lines that also contain `--repo`" holds literally. Log that as a premise note in `decisions.md`.

- [ ] **Step 2: Write the failing conformance suite `tests/parent-gate-repo-flag-conformance.test.js`**

The suite needs one pure helper: `bareGhLines(text) -> string[]`. It walks the text tracking ```` ``` ```` fence state. It returns every fenced line matching `/\bgh issue [a-z]+\b/` that lacks `--repo "$PARENT_REPO"`.

Tests:
- `every fenced gh issue line in the parent gate carries --repo "$PARENT_REPO"`: `assert.deepEqual(bareGhLines(live), [])`, and the count of fenced `gh issue` lines in the live file is `>= 6`, so an empty scan cannot pass.
- `go-red: removing the flag from one fence is caught`: for each fenced `gh issue` line in the live file, replace ` --repo "$PARENT_REPO"` with `''` on that one line and assert `bareGhLines(mutated)` returns exactly that line.
- `the scanner ignores prose and toggles on fences`: a synthetic text with one bare `gh issue close 1` outside any fence and one inside, where only the fenced one is returned.
- `the Close and Apply inline reads carry the flag too`: the collapsed live file includes `gh issue view $PARENT_NUM --repo "$PARENT_REPO" --json comments`.
- `the verdict list names repo as $PARENT_REPO`: the collapsed **Run the gate CLI** section includes `` `repo` `` and `$PARENT_REPO`, and states that the `gh`-absent path does not use it.

Run: `node --test tests/parent-gate-repo-flag-conformance.test.js`
Expected: FAIL. `bareGhLines(live)` lists the 6 fenced `gh issue` lines: 442, 450, 458, 586, 597 and 598. The line-567 `gh issue view` is an inline span, pinned by the separate inline-read test.

- [ ] **Step 3: Edit the prose**

- Each fence becomes `gh issue <verb> $PARENT_NUM --repo "$PARENT_REPO" <rest unchanged>`.
- Line 567's inline span becomes `` `gh issue view $PARENT_NUM --repo "$PARENT_REPO" --json comments` ``. Re-wrap so the span stays on one line; `brokenSpanLines` in the existing suite checks this.
- Verdict list: add a `repo` bullet after `parent`. It is the repository the CLI's reads used (`owner/repo`, host-qualified off github.com), and it is the `$PARENT_REPO` that every `gh` fence below passes as `--repo`, so one gate reads and writes one repository. It is `null` under `--facts-json` without a qualified token and under `--backend local-files`; neither path runs a `gh` fence.
- Transport paragraph: `` `gh issue comment` is `add_issue_comment`; `gh issue close` and `gh issue edit --add-label` are `issue_write` `` becomes `` `gh issue comment --repo` is `add_issue_comment`; `gh issue close --repo` and `gh issue edit --repo --add-label` are `issue_write` ``.

Update the byte pins in `tests/below-floor-parent-close-conformance.test.js`:
- `:98` becomes `'gh issue comment $PARENT_NUM --repo "$PARENT_REPO" --body-file'`
- `:99` becomes `'gh issue close $PARENT_NUM --repo "$PARENT_REPO" --reason completed'`
- `:150` becomes `'gh issue close $PARENT_NUM --repo "$PARENT_REPO" --reason "not planned"'`
- `:966-967` takes the reworded pairings

`GH_TO_MCP`'s `/^gh issue edit\b.*--add-label/` still matches. Keep it.

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

### Task 3: Inventory of the remaining bare fenced `gh issue` writes

**Files:**
- Create: `tests/gh-issue-write-repo-inventory.test.js`

**Interfaces:**
- Consumes: Task 2's state, in which `verification-brief-parent-gate.md` has no bare fenced write.

- [ ] **Step 1: Write the suite with an empty `INVENTORY`, and watch it fail**

Define `WRITE_RE = /\bgh issue (comment|close|edit|create|reopen|delete|lock|unlock|pin|unpin|transfer|develop)\b/`.

Add a helper: `bareWrites(text) -> { line, text }[]`. It returns fenced lines (fence state toggles on `/^\s*(```|~~~)/`) that match `WRITE_RE` and lack `/--repo\b/`. Walk `plugin/skills/**/*.md`.

`INVENTORY` maps a repo-relative path to class counts, `{ 'gh-default': n, 'not-run': m }`. The reason for each class is written once, as a comment above the map:
- `gh-default`: the procedure's own reads and writes both resolve against `gh`'s default repository: bare `gh issue`/`gh pr` calls and `gh api repos/{owner}/{repo}/…` placeholders, which gh fills from that same default. They cannot split across remotes, so they are intentionally cwd-scoped.
- `not-run`: a fenced line naming the command without running it. That covers a `#`/`//` comment, an `echo`ed string, a quoted hint or reversibility text, and a numbered example such as `gh issue edit 123`.

Tests:
- `every bare fenced gh issue write is classified`: for each file with bare writes, the sum of its `INVENTORY` class counts equals its bare-write count. Fail with the file and its lines.
- `no stale inventory entry`: every `INVENTORY` key exists and has at least one bare write.
- `the parent gate is not in the inventory`: `INVENTORY` has no `plugin/skills/wrap-up/verification-brief-parent-gate.md` key, and `bareWrites` of that file is `[]`.
- `the scan sees the corpus`: total bare writes `>= 40`.
- `go-red: an unclassified fence fails`: append a fenced `gh issue close 9` to one inventoried file's text in memory and assert the per-file count check reports a mismatch for it.

Run: `node --test tests/gh-issue-write-repo-inventory.test.js`
Expected: FAIL, listing every file with bare writes (about 27 files and 75 lines).

- [ ] **Step 2: Classify each file**

For each listed file, read the procedure around every bare line and decide the class. A `gh-default` call requires that the procedure's reads for that record are also gh-default: no `--repo {resolved slug}`, and no CLI verdict sourced from `origin`. If a procedure reads through an origin-resolved slug and writes bare, the parent gate's hazard has recurred. Do **not** classify that write. Add `--repo` from the slug already in scope in that procedure. If no slug is in scope, stop and report it as `DONE_WITH_CONCERNS`, naming the file and line. In the plan author's scan, `dispatch/settle-and-merge.md`'s `{owner}/{repo}` and `_shared/issue-claims.md`'s claims reads are gh's own default-repo placeholders, which makes them `gh-default`. Confirm that per file; do not assume it.

- [ ] **Step 3: Run to verify it passes**

Run: `node --test tests/gh-issue-write-repo-inventory.test.js`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add tests/gh-issue-write-repo-inventory.test.js
git commit -m "Inventory the bare fenced gh issue writes — each classified gh-default or not-run, pinned by a ratchet; refs #4824"
```

## Coverage

| Spec item | Task |
|---|---|
| Deliverable 1, `--repo {owner}/{repo}` on the Close and Apply fences, taken from the gate's own resolution | 1 (verdict field), 2 (fences) |
| Deliverable 2, inventory across `plugin/skills/**/*.md` with each fence classified | 3 |
| AC1.1, the grep before and after | 2, Steps 1 and 4 |
| AC2.1, a conformance test that goes red on removal | 2 (go-red test) |
| AC3.1, the inventory committed with no fence unclassified | 3 |

Waived plugin/bin/lib/issues/below-floor-parent-close.js: read only, as the `repoSlug` pattern to copy; its writes already carry `--repo`.

Known residual, outside this record: Apply's label bootstrap (`_shared/label-bootstrap.md`'s `gh label list`/`create` loop) stays gh-default. On a checkout whose gh default differs from origin, `demo:pending` can be bootstrapped into the other repository, so the `--repo` label add fails and is reported as partial state. That outcome is strictly better than today, where every write went to the other repository. It goes to the ledger as a follow-up, because it changes a shared contract that many consumers cite.
