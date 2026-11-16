# Queue pull: a failed shipped-PR view warns (#5313) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A failed `gh pr view` in the queue pull's shipped pass prints one `Warning:` line naming the fetch and each record it affects; the record keeps the pass's fail-open posture (stays a weak candidate, still dispatched).

**Architecture:** The shipped pass probes at most 5 PRs with `gh pr view {pr} --json files` and appends one `{pr, files}` line per PR to `dispatch-shipped-pr-files.jsonl`. Today a failed view writes `files: []`, indistinguishable from a PR that changed no files. After this change a failed view writes `files: null`; the second pass (which knows the record) prints the Warning for each non-predating weak record whose PR's files are `null`. `classifyShipped` already treats a non-array `files` as "no files" (`plugin/bin/lib/issues/shipped-candidate.js:111-114`, `Array.isArray(files)`), so tiers do not change. The module (`plugin/bin/lib/dispatch/queue-pull.js`) and the fence (`plugin/skills/dispatch/queue-pull-script.md`) must change identically (#5227 parity contract; the fence still exists, so the record's "fix both" clause applies).

**Tech Stack:** Node 18+ CommonJS, bash fence, `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-11-15T162121-spec-5304-5305-5306-5307-5309-5310-5311-5312-5313-5314-5315-5316-5317-5409/spec-5313/work/5313-spec.md` (record #5313)

## Global Constraints

- The Warning text, byte for byte, in both module and fence: `Warning: gh pr view {pr} failed — #{record} kept as a weak shipped candidate (files unprobed) this run` (the dash is U+2014, as in every other queue-pull Warning).
- Failure posture is unchanged: fail open. No exclusion is added or dropped by a failed view; the weak `AUTO — dispatch: #N mentioned by merged PR #P without a closing keyword; dispatching anyway` line still prints, and the Warning prints right after it.
- `plugin/skills/dispatch/queue-pull-script.md` is 52,492 bytes against the 52,500 rail (`RAIL_BYTES`, `plugin/bin/lib/skill-audit/budgets.js`). After the edit it must be ≤ 52,500 bytes (`wc -c`), quoted in the report. Pay for the additions by trimming restatement in the shipped pass's own comment lines 466-471 / 497-498 (they restate `shipped-candidate.js`'s rules and the code below them; no test pins their text — checked with `git grep`). Never cut a clause that tells the reader what to do.
- Keep the fence's line count unchanged: remove exactly one comment line in 466-492 (before the added Warning line), so every `fence NNN` / `Fence NNN` citation in `queue-pull.js` stays valid. The two citations spanning the edit are `Fence 466-569` (queue-pull.js:1043) and `Fence 542-569` (queue-pull.js:1015); confirm both still bound the same code afterwards.
- Governing skill `.claude/skills/skill-prose-conformance-tests/whole-fence-parity-oracle.md`, item 8, verbatim: "**Compare what the acceptance criterion names, and guard the rest.** Compare the exit status, the files each side writes, and the reported line kinds the criterion names (`AUTO`, `Warning:`). A comparison built only from what the reference prints hides everything extra the port prints. Add a guard that fails when the port prints a step diagnostic where the reference's stderr shows no error (`assertParity`'s `queue-pull:` check, added in #5227's review fix wave 566b73843)."
- Shell constraint (worktree is harness-isolated): one plain command per Bash call, no `&&`/`;` chains, no `cd … &&`, no heredoc, no loop, no `$(...)`, no shell variable that must survive to the next call. Use absolute double-quoted paths; `git -C "{worktree}"` for git.
- Scope: "Commit tests only where the task asks for them or the repo already keeps tests for this kind of change, sized like the neighboring test files; scratch checks stay scratch. Touch only what the task requires — a pre-existing bug you notice is a follow-up to report, not a fix to fold in, unless the task cannot work without it. Don't reformat or "improve" adjacent code; edit in place rather than rewrite when the result is the same."

## Review Focus

1. **A failed view that printed partial stdout** (`["a"]` then exit 1): today the fence's `$(… || echo '[]')` concatenates to `["a"][]`, the append fails, and no line is written (test at queue-pull.test.js:1826-1831). With `FILES_JSON=$(…) || FILES_JSON=null` the whole value is replaced: the line is `{"pr":5016,"files":null}` and the Warning prints. Pinned in Task 1 Step 1 (partial case).
2. **One PR mentioned by two records**: one view, one failure, a Warning per affected record. Pinned in Task 1 Step 1 (cap test variant: #9208 shares PR 6201 with #9201).
3. **A record whose PR was beyond the 5-probe cap**: it was never probed, so no Warning (an unprobed-by-cap PR has no jsonl line, `prFiles.get` is `undefined`, never `null`). Pinned in the same cap variant (#9206, #9207).
4. **A weak mention that predates the claim release, sharing a PR whose probe failed**: files cannot change a predating result's tier, so no Warning for it — the Warning's condition includes `!predatesClaimRelease(result)`. Pinned in Task 1 Step 1 (predating case).
5. **A successful probe** keeps printing no Warning and writing the real file list (existing tests at 1759 and 1804 stay green unchanged).

---

### Task 1: Warn on a failed shipped-PR view, module and fence

**Role:** integration

**Files:**
- Modify: `plugin/bin/lib/dispatch/queue-pull.js:1074-1078` (probe loop; comment at 1075) and `:1103-1107` (weak branch of the second pass)
- Modify: `plugin/skills/dispatch/queue-pull-script.md:493` (probe line), the weak branch at `:521-525`, and one comment-line trim in `:466-492`
- Test: `tests/bin-lib/dispatch/queue-pull.test.js` — rewrite the test at 1815-1832; add two tests after it; `FAULT_EXPECT['F-prview']` at 3528; the F-prview assertion at 3715; the header comment at 49
- No change: `tests/bin-lib/dispatch/queue-pull-fixtures.js` (F-prview at 665 already fails `PR_VIEW_5016_ARGV`), `tests/bin-lib/dispatch/queue-pull-oracle.js`, `plugin/bin/lib/issues/shipped-candidate.js` (already `Array.isArray`-guarded), the `PASSES` registry's `shipped` row (`failOpen: 'open'` stays true)
- Readers of `dispatch-shipped-pr-files.jsonl` (consumer enumeration): the fence's and module's second pass only (`git grep -n "shipped-pr-files"` in `plugin/`); both are changed here. Prose describing the old silent behaviour: queue-pull.test.js:49 and the test names at 1815 (changed here); the journey `docs/journeys/select-the-dispatch-queue-with-the-queue-pull-cli-5227.md` line 46 is updated by /build's Common Step 6 (`/claude-tweaks:journeys`), not this task.

**Interfaces:**
- Consumes: `ghRun(ctx, argv, { quiet: true })` → `{ ok, stdout }`; `trimNl`; `classifyShipped`, `predatesClaimRelease`; test helpers `pull4`, `FULL()`, `PR_VIEW(pr)`, `prViews(r)`, `r.errs`, `r.text[...]`, `fenceText(regex)` / `FENCE`, `mention`, `ghRecord`, `withBody`, `QUEUE_ARGV`, `OPEN_NUMBERS_ARGV`.
- Produces: jsonl line `{"pr":<n>,"files":null}` for a failed view; the Global Constraints Warning on stderr.

- [ ] **Step 1: Write the failing tests** (AC1.1; `failGh` is not needed — these use `scenario.gh` edits like the existing 1815 test)

  Add near the top of the shipped tests a helper `const PR_VIEW_FAILED = (pr, n) => \`Warning: gh pr view ${pr} failed — #${n} kept as a weak shipped candidate (files unprobed) this run\n\`;`

  a. Replace the test at 1815 with `'#5313 shipped: a failed gh pr view writes files:null and prints one Warning naming the view and the record, after the weak AUTO line; the candidate stays weak and eligible'`:
  - `prViews(r)` deep-equals `[PR_VIEW(5016)]`
  - `r.text['dispatch-shipped-pr-files.jsonl'] === '{"pr":5016,"files":null}\n'`
  - `r.errs.filter((e) => e.startsWith('Warning:'))` deep-equals `[PR_VIEW_FAILED(5016, 9016)]`
  - the weak AUTO line's index in `r.errs` is one less than the Warning's index
  - `groupNumbers(r).flat()` includes 9016; `r.stderr` does not include `boom`
  - `FENCE.includes("'Warning: gh pr view ' + result.pr + ' failed — #' + c.number + ' kept as a weak shipped candidate (files unprobed) this run'")`
  - partial case (`stdout: '["a"]', status: 1`): jsonl `'{"pr":5016,"files":null}\n'`, the same one Warning, and no `r.errs` entry starting `queue-pull: shipped-pr-files: `
  b. `'#5313 shipped: with every probe failing, each probed weak record warns (two records sharing PR 6201 both warn); a record beyond the 5-probe cap does not'` — the 1863 scenario with each `PR_VIEW` entry `{ stdout: '', status: 1 }`: Warnings deep-equal the `PR_VIEW_FAILED` lines for (6201, 9201), (6202, 9202), (6203, 9203), (6204, 9204), (6205, 9205), (6201, 9208), in the order the run prints them (groups order; read it once and pin it exactly); none names 9206 or 9207.
  c. `'#5313 shipped: a weak mention predating the claim release that shares a failed probed PR prints no Warning'` — from the 1845 predating scenario, add a second, non-predating record mentioning the same PR so that PR is probed, and fail the view: exactly one Warning, for the non-predating record.
  d. Oracle: `FAULT_EXPECT['F-prview']` → `{ status: 0, stderr: [PR_VIEW_FAILED(5016, 9016).trimEnd()], drops: [] }` (match the form the other rows use: no trailing newline); line 3715's expected jsonl → `'{"pr":5016,"files":null}\n'` with message `a failed probe reads as files:null`; header line 49 → state that F-prview warns since #5313 (no silent fail-open remains in that list).

- [ ] **Step 2: Run the tests on the unchanged code — they must fail**

  Run: `node --test --test-name-pattern="5313|AC4.1|F-prview" "tests/bin-lib/dispatch/queue-pull.test.js"`
  Expected: FAIL — a/b/c on the missing Warning and the `[]` jsonl; the oracle rows on the extra Warning both sides lack. Quote the failing assertion lines in the report.

- [ ] **Step 3: Implement, module then fence**

  Module (`queue-pull.js`):
  - probe loop: `const filesJson = r.ok ? trimNl(r.stdout) : 'null';` and update the comment to say a failed fetch prints nothing (stderr ignored) and reads as `null` (`|| FILES_JSON=null`).
  - weak branch, after the AUTO `deps.stderr(...)`: when `!predatesClaimRelease(result) && prFiles.get(result.pr) === null`, `deps.stderr(` the Global Constraints Warning `\n)`.

  Fence (`queue-pull-script.md`):
  - line 493: `  FILES_JSON=$(gh pr view "$PR" --json files -q '[.files[].path]' 2>/dev/null) || FILES_JSON=null`
  - weak branch, after the AUTO `console.error(...)`: `if (!predatesClaimRelease(result) && prFiles.get(result.pr) === null) console.error('Warning: gh pr view ' + result.pr + ' failed — #' + c.number + ' kept as a weak shipped candidate (files unprobed) this run');`
  - trim the shipped pass's comment block (466-471, optionally 497-498) by enough bytes to land ≤ 52,500, removing exactly one line in 466-492; then `wc -c "plugin/skills/dispatch/queue-pull-script.md"` and confirm `Fence 466-569` / `Fence 542-569` in queue-pull.js still bound the same code (line count unchanged).

- [ ] **Step 4: Run the tests — they pass**

  Run: `node --test --test-name-pattern="5313|AC4.1|F-prview|shipped" "tests/bin-lib/dispatch/queue-pull.test.js"`
  Expected: PASS, 0 fail. Then the whole file: `node --test "tests/bin-lib/dispatch/queue-pull.test.js"` — PASS, 0 fail. Quote both summaries (`# pass`, `# fail`).

- [ ] **Step 5: Commit**

  `git -C "{worktree}" add -- plugin/bin/lib/dispatch/queue-pull.js plugin/skills/dispatch/queue-pull-script.md tests/bin-lib/dispatch/queue-pull.test.js`
  Commit message: `Warn when the shipped pass's gh pr view fails, in module and fence (refs #5313)`, then a blank line and the session trailer the dispatcher gives.

---

## Self-review

- **Spec coverage:** Deliverable (Warning naming the record; record treated per the pass's fail-open posture) → Task 1 Step 3; AC1.1 (with the shipped-PR view failing, the pull prints a line naming the fetch and the record) → Step 1a/d.
- **Placeholders:** none.
- **Types:** `files: null` written by both sides; read only by the second pass via `prFiles.get(result.pr) === null`.
