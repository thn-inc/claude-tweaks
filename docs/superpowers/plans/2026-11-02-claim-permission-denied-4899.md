# Claim permission denied (exit 7) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A claim read or write GitHub refuses for permissions stops the run with exit 7 and a card naming the token access to fix, and dispatch treats it as a pre-flight stop that ends the firing.

**Architecture:** One rule in the per-target claim loop: `read.failure` or `write.failure` equal to `permission-denied` calls `abort({ permissionDenied: { issue, operation, reason } }, 7)`. The claim store additively carries GitHub's error text on a `permission-denied` result. Everything else is prose consuming the new exit code.

**Tech Stack:** Node (CommonJS, `node:test`), Markdown skills.

**Spec:** `.claude-tweaks/pipelines/2026-11-02T104342-record-4899/work/4899-spec.md`

**Scope keywords:** permissionDenied, claim-permission-denied, Claim permission denied

## Global Constraints

- "Every other failure at those sites keeps its current exit."
- "The classifier does not change." `classifyGhApiError` stays byte-identical.
- "Bootstrap permission failures stay exit 6. This record changes only the per-target claim loop."
- "Other callers of the classifier keep their exits: `list-claims.js`, `dispatch-resume.js`, `release-claim.js` and the dispatch first-call artifact check are out of scope."
- Failing-check-name is exactly `flow-step-2.8-claim-permission-denied`; the card heading is exactly `## Flow: Claim permission denied`; the envelope key is exactly `permissionDenied`.
- The first call's report for this stop is `ISSUE #{n}: failed:claim-permission-denied` (the `failed:{gate}` shape at `dispatch/task-prompt.md:291`).
- Governing rule, quoted from `.claude/skills/gh-api-module-pattern/cli-wrapper-contract.md`: "Spell each one out in that CLI's own `USAGE` and in the prose that branches on it; never assume a number carries its meaning across CLIs." Quoted from `.claude/skills/gh-api-module-pattern/SKILL.md`: "`deps.ghApi` — the `plugin/bin/lib/issues/claim-store.js` contract, which *never throws* and returns `{stdout, failure, status}`". The remaining project skills naming these modules (`driver-skill-outcome-taxonomy`, `mcp-agent-fetch-node-compute`, `parse-signal-discipline`, `prose-code-twin-pin`) carry no rule about this change: exit 7 has no prose table restating a code enum, and no new parsing.
- Size: `plugin/skills/dispatch/SKILL.md` is 51,407 B and `plugin/skills/flow/SKILL.md` 51,626 B against the 52,500 B rail (`RAIL_BYTES`). The Task 2 additions below are about 300 B and 2 B, leaving about 790 B and 870 B. `settle-and-merge.md` (47,119 B) and `flow/claim-targets.md` (38,092 B) have room.
- Every implementer that touches `plugin/bin/` also runs `tests/path-guard-conformance.test.js` and `tests/windows-hide-spawn-conformance.test.js`.
- Commit messages use `refs #4899`, never a closing keyword. Never run `git stash`.
- Decided by the user at plan review: Settle skips steps 1-7 on this stop (no release command, so no false release comment), and the rule is `gh`-transport only; the hand-followed MCP claim path stays transient, stated as a limitation in `flow/claim-targets.md`, with a follow-up record for it.
- Two other refused reads in the loop: a refused re-read after a PUT 404/409/422 becomes `failure: 'permission-denied'` (exit 7) instead of a false contest; a refused post-write read-back keeps exit 5, because the write itself succeeded and "unverified" is accurate. Both are pinned in Task 1.

Waived AC1.2: Task 1 Step 2's red run against the unchanged code is the proof; a committed test cannot assert behaviour the change removes.
Waived AC2.2: same as AC1.2.

## Review Focus

- A claim read whose git leg fails at the transport and whose contents-API fallback answers 403: expect exit 7, `operation: read`. Pinned by Task 1's `git-leg fallback` test.
- A claim write whose git push fails at the transport and whose fallback re-read answers 403: expect exit 7, `operation: write`, GitHub's text as `reason`. Pinned by Task 1's `write fallback re-read` test.
- GitHub error text carrying newlines or control characters: expect one flattened line on stderr and in `reason`. Pinned by Task 1's `reason flattened` test.
- Releasing earlier claims with the same refused token: expect exit 7 still, with the target in `releaseFailed`. Pinned by Task 1's `release refused` test.
- A `--resume-pr` re-claim whose write is refused: expect exit 7. Pinned by Task 1's `resume-pr` test.

---

### Task 1: Exit 7 at the claim read and write sites

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/issues/claim-store.js:298-307` (`readClaimBlobContentsApi`), `:493`, `:540`, `:544` (`writeClaimBlob`)
- Modify: `plugin/bin/lib/claim-targets/claim-targets.js` (USAGE, the `abort` and `stopOrSkip` comments, the read site at `:515`, the write site at `:638`)
- Modify: `plugin/bin/claim-targets.js:6-16` (header exit list)
- Test: `tests/bin-lib/claim-targets/claim-targets.test.js` (replace `(perm-read)` and `(perm-write)`, lines 2607-2636)
- Test: `tests/bin-lib/issues/claim-store.test.js`

**Interfaces:**
- Produces: exit 7 with stdout `{permissionDenied: {issue, operation: 'read'|'write', reason}, released, releaseFailed}`, and one stderr line.
- Produces: `readClaimBlob` and `writeClaimBlob` results gain an `error` string only when `failure === 'permission-denied'` and the `ghApi` result carried `error`. No key is added on any other result, so existing `deepEqual` pins (claim-store.test.js lines 51, 97, 295, 548, 785, 1112, 1122) stay green unchanged.

- [ ] **Step 1: Write the failing tests**

In `claim-targets.test.js`, replace `(perm-read)` and `(perm-write)` using the same `ghApi` fixtures (`baseDeps`, `makeGh`, `readAbsent`), and add:

```js
test('AC1.1: a 403 claim read exits 7 with operation read', /* status 403, error 'HTTP 403: Resource not accessible by integration' */);
test('AC1.1: a 401 claim read exits 7 with operation read', /* status 401, error 'HTTP 401: Bad credentials' */);
test('AC2.1: a 403 claim write exits 7 with operation write', /* read absent, PUT 403 */);
test('AC2.1: a 401 claim write exits 7 with operation write', /* read absent, PUT 401 */);
// each asserts: code === 7; body.permissionDenied.issue === 720;
// body.permissionDenied.reason matches the fixture's error text; body.transient === undefined;
// stderr names #720 and matches /token/.
test('AC3.1: --keep-going with a 403 on the second target exits 7 and releases the first', /* targets 720,721; 720 claims via stateful ghApi; 721 read 403 */);
// asserts: code === 7; body.released deepEquals [720]; body.permissionDenied.issue === 721; no `skipped` key in the envelope.
test('AC4.1: network-failure and secondary rate limit claim reads and writes still exit 4', /* four cases: read network-failure, read secondary-rate-limit, write network-failure, write secondary-rate-limit */);
test('AC5.1: a bootstrap refused by a permission 403 still exits 6 with branchMissing', /* makeBranchlessGhApi({ postResponse: { stdout: null, failure: 'permission-denied', status: 403, error: 'HTTP 403' } }) */);
test('git-leg fallback: git read transport failure then contents-API 403 exits 7 operation read', /* gitRunner failing fetch at the transport */);
test('write fallback re-read: git push transport failure then a 403 re-read exits 7 operation write', /* assert reason carries the 403 text */);
test('reason flattened: error text with newlines and control characters is one line in reason and on stderr', /* error 'HTTP 403\nforged line\u0007' */);
test('reason falls back to permission-denied when the store carries no error text', /* fixture without `error` */);
test('release refused: the earlier claim\'s release read answers 403 — exit stays 7, target in releaseFailed', /* targets 720,721 */);
test('resume-pr: a stale in-flight claim re-claimed with --resume-pr whose write answers 403 exits 7', /* use the file\'s existing --resume-pr stale fixture */);
test('refused re-read: a PUT 404 whose self-write re-read answers 403 exits 7 operation write, never contested', /* contents read absent, PUT status 404, re-read permission-denied */);
test('refused read-back: a claim write that succeeded but whose read-back answers 403 keeps exit 5', /* PUT ok, verify read permission-denied */);
```

In `claim-store.test.js`:

```js
test('readClaimBlob carries error on a permission-denied read only', /* permission-denied with error → r.error === text; network-failure with error → deepEqual without an error key */);
test('writeClaimBlob carries error on a permission-denied PUT only', /* same two cases */);
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/bin-lib/claim-targets/claim-targets.test.js tests/bin-lib/issues/claim-store.test.js`
Expected: FAIL after Step 1. The new 401/403 cases report `4 !== 7`, and the claim-store cases report a missing `error` key.

- [ ] **Step 3: Implement**

In `claim-store.js`, add one local helper `permissionErrorField(r)` returning `{ error: r.error }` when `r.failure === 'permission-denied' && r.error`, else `{}`. Spread it into the failure returns of `readClaimBlobContentsApi` (`:301`), `writeClaimBlob`'s `fresh.failure` return (`:493`, spreading from `fresh`), its `lookup.result.failure` return (`:540`, spreading from `lookup.result`), and its final return (`:544`). After the self-write check at `:530`, add `if (fresh.failure === 'permission-denied') return { ok: false, failure: fresh.failure, ...permissionErrorField(fresh) };`. Every other re-read failure keeps today's `conflict: true`. `classifyGhApiError` is untouched.

In `claim-targets.js`, add `function permissionStop(issue, operation, result)`, defined beside `handleBranchMissing`:
- `reason = oneLineReason(result.error || 'permission-denied')`
- stderr: `claim-targets: GitHub refused the claim ${operation} for #${issue}: ${reason} — check the token's access to this repository and the ${CLAIMS_BRANCH} branch\n`
- returns `abort({ permissionDenied: { issue, operation, reason } }, 7)`

Call it first inside `if (read.failure)` and inside `if (write.failure || write.secondaryRateLimit)`, each when `.failure === 'permission-denied'`; the rest of each branch stays. Replace the two "stays exit 4" comments. Add an `exit 7` line to `USAGE` and to the `bin/claim-targets.js` header. Change "3, 4, 5, or 6" to include 7 in the `stopOrSkip` comment, and add 7 to `abort`'s exit-code comment.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/bin-lib/claim-targets/claim-targets.test.js tests/bin-lib/issues/claim-store.test.js tests/path-guard-conformance.test.js tests/windows-hide-spawn-conformance.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/issues/claim-store.js plugin/bin/lib/claim-targets/claim-targets.js plugin/bin/claim-targets.js tests/bin-lib/claim-targets/claim-targets.test.js tests/bin-lib/issues/claim-store.test.js
git commit -m "fix: exit 7 when GitHub refuses a claim read or write" -m "refs #4899"
```

### Task 2: Card, Settle, firing stop and docs

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/skills/dispatch/express-prompt.md:96-101` (OUTPUT FORMAT)
- Modify: `plugin/skills/_shared/express-lane.md:13`
- Modify: `plugin/skills/flow/claim-targets.md` (new exit-7 bullet and card after the exit-6 bullet; `:360` "On exit 3, 4, 5, or 6"; `:428` the `--keep-going` sentence)
- Modify: `plugin/skills/flow/SKILL.md:148` (`Exit 3/4/5/6` → `Exit 3/4/5/6/7`, plus "/ claim permission denied" in its parenthesis)
- Modify: `plugin/skills/dispatch/settle-and-merge.md:39-64` (Claim-contest special case)
- Modify: `plugin/skills/dispatch/SKILL.md:58` (new paragraph right after the Repo-wide infra outage stop)
- Modify: `plugin/skills/dispatch/firing-exclusion.md:7`
- Modify: `plugin/skills/dispatch/next-ranking.md:24`
- Modify: `plugin/skills/dispatch/reporting.md` (new paragraph after the No-dispatch-host paragraph)
- Modify: `docs/plugin-structure.md:217`
- Modify: `docs/journeys/act-on-a-contested-claim.md`
- Test: `tests/flow-claim-preflight.test.js`
- Waived `plugin/bin/lib/claim-targets/claim-targets.js`: read only here, for the envelope shape Task 1 produced.
- Waived `plugin/bin/list-claims.js`, `plugin/bin/dispatch-resume.js`, `plugin/bin/release-claim.js`: out of scope per the spec's Gotchas.

**Interfaces:**
- Consumes: Task 1's exit 7 and `{permissionDenied: {issue, operation, reason}, released, releaseFailed}`.

- [ ] **Step 1: Write the failing conformance tests**

Add to `tests/flow-claim-preflight.test.js`, reading the section the same way the #4495 test at line 321 does (from `**Claim-contest special case` to `\n**Open-linked-PR enrichment`):

```js
test('AC6.1: flow/claim-targets.md carries the exit-7 card with no retry and no question (#4899)', () => {
  // slice from '- **7**' to the next '\n- **2**'
  // match: /## Flow: Claim permission denied/, /\{operation\}/, /\{reason\}/, /token's access/, /claims-registry/, /No `AskUserQuestion`/
  // doesNotMatch inside the fenced card: /re-run/i
  // whole file match: /On exit 3, 4, 5, 6, or 7/
});
test('AC6.1: settle-and-merge.md treats the claim permission denied stop as a pre-flight stop (#4899)', () => {
  // match: /Claim permission denied/, /flow-step-2\.8-claim-permission-denied/, /failed:claim-permission-denied/,
  // /claim-permission-denied stop, skip steps 1-7/, /no release/, /dispatch-retry-ceiling/, /no failure comment/, /no `bot:blocked`/, /grants untouched/
});
test('the express call reports the claim permission denied line (#4899)', () => {
  // express-prompt.md matches /ISSUE #\{issue\}: failed:claim-permission-denied/
  // _shared/express-lane.md matches /exit 7/ and /failed:claim-permission-denied/
});
test('flow/claim-targets.md states the MCP claim path is not this stop (#4899)', () => {
  // matches /gh-absent[^\n]*this stop|MCP[^\n]*transient[^\n]*#4899/ inside the exit-7 bullet
});
test('AC7.1: dispatch/SKILL.md stops the firing on a claim permission denied stop, in every selection form (#4899)', () => {
  // slice from '**Claim permission stop (#4899).**' to the next blank line
  // match: /failed:claim-permission-denied/, /every selection form/, /attempt no further group/, /same token/
});
test('firing-exclusion.md and next-ranking.md name the stop; reporting.md relays it (#4899)', () => {
  // each matches /claim-permission-denied/
  // firing-exclusion.md and next-ranking.md each match /ends the firing/
});
test('AC8.1: no prose says a claim read or write 401/403 exits 4 (#4899)', () => {
  // walk every .md under plugin/skills, every .js under plugin/bin, docs/plugin-structure.md and the journey:
  // no line matches /(claim read( or write)?|claim write|401\/403)[^.\n]{0,80}\bexits? 4\b/i
  // plugin-structure.md matches /7 GitHub refused a claim read or write/
});
```

Absence control, already run while authoring: `docs/plugin-structure.md:217` currently reads "a claim read or write GitHub refused with a 401/403 also exits 4", which the AC8.1 regex matches.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/flow-claim-preflight.test.js`
Expected: FAIL after Step 1, on the seven new tests.

- [ ] **Step 3: Write the prose**

`flow/claim-targets.md`, new bullet after the exit-6 card:

```markdown
- **7** (#4899) — GitHub refused a claim read or write for permissions (a plain HTTP 401/403 — a rate-limited 403 is exit 4), also under `--keep-going`: stdout carries `{permissionDenied: {issue, operation, reason}, released, releaseFailed}`, stderr carries the remedy. Render:

  ```markdown
  ## Flow: Claim permission denied

  GitHub refused the claim {operation} for #{target}: {reason}.
  Next: check the token's access to this repository and the `claims-registry` branch.
  ```

  No `AskUserQuestion` — nothing to choose between. This is the `gh` transport only: the gh-absent MCP claim procedure does not reach this stop, and a refused claim there stays the transient `## Flow: Claim failed` card (#4899).
```

Line 360 becomes "On exit 3, 4, 5, 6, or 7". Line 428 becomes "it still exits 6 — a missing, uncreatable claims branch fails every target alike — and 7 — a refused claim read or write, with the same token for every target".

`settle-and-merge.md`: add to the special case's opening list, after the "Claims branch missing" clause: `, or its "Claim permission denied" stop (`claim-targets.js` exit 7, #4899: GitHub refused a claim read or write for permissions — the first call reports `ISSUE #{n}: failed:claim-permission-denied`)`. Add `flow-step-2.8-claim-permission-denied` for that stop to the failing-check-name list, change "the three are different stop shapes" to "the four", and add a final sentence after the claims-branch-missing one: `For the claim-permission-denied stop, skip steps 1-7 below: no release, no `failure-check` classification, no attempt counted against `dispatch-retry-ceiling`, no failure comment, no `bot:blocked`, grants untouched — the token, not the record, is at fault. The CLI already attempted the release of any claim this run took, and a release here under the same token would post a false release comment on a record this run never claimed.`

`dispatch/SKILL.md`, new paragraph after line 58:

```markdown
**Claim permission stop (#4899).** A group's call reporting `ISSUE #{n}: failed:claim-permission-denied` (`claim-targets.js` exit 7) stops the firing in every selection form, because every group uses the same token: attempt no further group, and report the record and the stop.
```

`firing-exclusion.md:7`: extend the list to `claim-contest/in-flight/claims-branch-missing/claim-permission-denied`, and add after the two bullets' paragraph: `A claim-permission-denied stop also ends the firing (`SKILL.md`'s Claim permission stop), so no next iteration runs.`

`next-ranking.md:24`: leave its "very next iteration" list unchanged, and add after that sentence: `A claim-permission-denied stop never reaches this filter: it ends the firing (`SKILL.md`'s Claim permission stop).`

`express-prompt.md`, OUTPUT FORMAT, after the `MANIFEST:` entry: `ISSUE #{issue}: failed:claim-permission-denied -- only when step 1's claim-targets.js exited 7; omit otherwise`. `_shared/express-lane.md:13`, append: `On exit 7, the report also carries `ISSUE #{n}: failed:claim-permission-denied`, which stops the firing.`

`reporting.md`, new paragraph after the No-dispatch-host one:

```markdown
**Claim permission stops are relayed (#4899).** When a group's first call reports `ISSUE #{n}: failed:claim-permission-denied`, its report block names the record and the refusal, says the firing stopped, and closes with the remedy: check the token's access to this repository and the `claims-registry` branch.
```

`docs/plugin-structure.md:217`: delete the clause "; a claim read or write GitHub refused with a 401/403 also exits 4, reported as `error: 'permission-denied'` — a permissions problem a re-run will not fix", and append ", 7 GitHub refused a claim read or write for permissions (`{permissionDenied:{issue,operation,reason}, ...}`, also under --keep-going, #4899)". Leave the rest of the line alone.

`docs/journeys/act-on-a-contested-claim.md`: add "or a claim-permission-denied card when GitHub refused the claim read or write (#4899)" to the Success state. Add step `### 3e. Recognize a refused claim — terminal` in the file's bullet shape: **Should understand** covers exit 7, claims already taken are released, no retry and no attempt counted, and a dispatch firing stops at the first such stop in every selection form; **Red flags** covers the card suggesting a re-run, the stop counting toward `dispatch-retry-ceiling`, `--keep-going` moving to the next target, and a permission refusal during branch creation rendering this card instead of the claims-branch-missing one. Add an `Origin` line "Extended during build of #4899", and add #4899 to `Related specs`. The existing 3d sentence "the drain moves on to its next record" is about exit 6 and stays.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/flow-claim-preflight.test.js tests/dispatch-handoff-continuation-conformance.test.js`
Expected: PASS.

Run: `wc -c plugin/skills/dispatch/SKILL.md plugin/skills/flow/SKILL.md`
Expected: both under 52,500.

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/dispatch/express-prompt.md plugin/skills/_shared/express-lane.md plugin/skills/flow/claim-targets.md plugin/skills/flow/SKILL.md plugin/skills/dispatch/settle-and-merge.md plugin/skills/dispatch/SKILL.md plugin/skills/dispatch/firing-exclusion.md plugin/skills/dispatch/next-ranking.md plugin/skills/dispatch/reporting.md docs/plugin-structure.md docs/journeys/act-on-a-contested-claim.md tests/flow-claim-preflight.test.js
git commit -m "docs: claim permission denied card, Settle stop and firing stop" -m "refs #4899"
```
