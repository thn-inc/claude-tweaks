# Tidy Resume → dispatch resume when the run dir is gone (#4673) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a stale claim's run directory is absent or archived, `/tidy`'s Yours row recommends `/claude-tweaks:dispatch resume #N` instead of the PR body's resume line.

**Architecture:** The Resume line is already computed in code by `plugin/bin/stale-claim-pr.js --resume` (#4596: "the rule lives once, in code"), so the run-dir check goes there too, not into prose. A new opt-in flag, `--issue <n>`, lets the CLI check the matched run's directory under the main checkout's `.claude-tweaks/pipelines/`. When that directory is gone, `resume` becomes the dispatch-resume command. `/tidy`'s Step 4.7 passes `--issue {n}` and documents the second source of `resume`. Without `--issue`, nothing changes.

**Tech Stack:** Node 18+ CommonJS, `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-10-31T143430-record-4673/work/4673-spec.md`

## Global Constraints

- The rendered row is exactly `Resume open PR #{number} ({url}) — {resume}`. In the gone case, `resume` is the literal `` `/claude-tweaks:dispatch resume #{n}` `` (backticks included), the same backticked shape as `composeResumeLine`'s output.
- From `plugin/bin/stale-claim-pr.js`'s header (the CLI's contract): "Exit codes (a CLI-specific vocabulary — verdicts are data on stdout, so the codes only cover what stops a verdict being reached; no JSON on 1-3): 1 malformed invocation (unknown flag, a flag missing its value, no --claim-file); usage on stderr."
- The governing skill (`.claude/skills/gh-api-module-pattern/cli-wrapper-contract.md`), verbatim: "A prose guard that keys on who is calling, or on a human choice no file records, cannot be inherited by the CLI — it becomes an explicit flag the prose passes, and the absent flag takes the safe route." Here the absent `--issue` keeps today's behavior: no filesystem probe, and the PR-body line.
- The same governing skill, verbatim: "list each conditional the prose leaves to what the reader could see ("if present", "still unchecked", "when nothing changed"), give each its own branch and its own status value in the envelope, and add a test per branch."
- The verdict JSON keeps its contract key order: `match, link, resume | resolve, failure`. No new keys.
- `plugin/skills/tidy/scan-procedures.md` is 51207 bytes against `RAIL_BYTES` 52500 (97.5%). This plan's prose delta must stay under +250 bytes; if it grows, cut words elsewhere in the same paragraph. No file split.

## Review Focus

1. A run dir that was archived but whose root still holds a `work/` stub (tracked spec residue, or a late write) must still count as archived. Pinned in Task 1 by `AC1.1: a real archive wins over a root work/ stub`.
2. A failed `archiving` marker (`status: 'archiving'`) beside a present root dir is not archived: the run still exists. Pinned in Task 1 by `an archiving-marker archive beside a present root is not gone`.
3. When the main checkout cannot be resolved (`pipelinesRoot()` returns null), the CLI falls back to today's PR-body route and never reports `gone`. Pinned in Task 1.
4. Without `--issue`, or on a no-match, no filesystem probe runs. Pinned in Task 1 by fakes that throw when called.
5. A malformed `--issue` value (`0`, `-3`, `12x`, `abc`) is exit 1 with usage on stderr and no stdout. Pinned in Task 1's malformed-invocation table.

---

### Task 1: `stale-claim-pr.js --issue` — run-dir-aware Resume line

**Role:** integration

**Files:**
- Modify: `plugin/bin/stale-claim-pr.js` (header usage/`--resume`/`--issue` doc, `USAGE`, `parseArgs`, `realDeps`, verdict assembly)
- Modify: `docs/plugin-structure.md` (line 213's `stale-claim-pr.js` command-reference entry: add `[--issue <n>]` and one clause on the gone-run-dir `resume`)
- Test: `tests/stale-claim-pr-cli.test.js`

**Interfaces:**
- Produces: CLI flag `--issue <n>` (a positive integer, `/^[1-9]\d*$/`), consulted only with `--resume` on a match. New deps seams: `pipelinesRoot(): string | null` (real: `path.join(mainCheckoutRoot(process.cwd()), '.claude-tweaks', 'pipelines')`, or null when `mainCheckoutRoot` returns null, from `./lib/hooks/worktree-detect`) and `exists(p): boolean` (real: `lstatType(p).type !== 'missing'`, from `./lib/path-guard`, matching `dispatch-resume.js`'s `exists`). The existing `readFile` seam reads the archive's `run-state.json`. `parseArgs` returns `{ claimFile, listing, repo, resume, issue, help }`, where `issue` is a Number or null.

**Gone rule** (`runDirGone(deps, runId) -> boolean`, internal): this is the subset of `dispatch-resume.js` `classifyPriorRun`'s archive/absent rule that the spec names.
- `root = deps.pipelinesRoot()`. If it is null, return false.
- When `exists(root/archive/{runId})` is true, read `archive/{runId}/run-state.json`. If it parses as an object with `status !== 'archiving'`, return true (archived).
- Otherwise, return `!exists(root/{runId})` (absent).
- Any throw is caught and returns false (today's route).

**Verdict:** on a match with `--resume` and `--issue N`, when `runDirGone` is true, the verdict is `{ match: true, link, resume: '`/claude-tweaks:dispatch resume #N`', failure: null }`. This holds whatever the PR body's Resume line says, and it supersedes `resolve`. Otherwise `resumeFields(body, runId)` runs as today.

- [ ] **Step 1: Write the failing tests** in `tests/stale-claim-pr-cli.test.js`. Extend `fakeDeps` with `pipelinesRoot: () => { calls.pipelinesRoot++; throw new Error('must not probe the run dir'); }` and an `exists` that throws the same way, both overridable. Every existing test then also proves that no probe runs without `--issue`. Add `const ROOT = '/repo/.claude-tweaks/pipelines'` and `const DISPATCH = '`/claude-tweaks:dispatch resume #4596`'`, plus a helper that builds `{ pipelinesRoot: () => ROOT, exists: (p) => present.has(p) }` from a set of present paths. Archive `run-state.json` content goes in through `files`. Tests (run through `runBoth` so both transports agree):
  - `AC1.1: an archived run dir yields the dispatch resume line`: present = `{ROOT/archive/RUN}`, file `ROOT/archive/RUN/run-state.json` = `{"status":"clean"}`, args `['--resume', '--issue', '4596']`, composed body → `deepEqual {match:true, link:PR_URL, resume:DISPATCH, failure:null}`.
  - `AC1.1: an absent run dir yields the dispatch resume line`: nothing present → same verdict.
  - `AC1.1: a real archive wins over a root work/ stub`: present = `{ROOT/RUN, ROOT/archive/RUN}`, archive state `{"status":"clean"}` → DISPATCH.
  - `AC1.1: a gone run dir supersedes resolve`: absent dir, body `MARKED` (no Resume heading) → `resume: DISPATCH`, and `'resolve' in v` is false.
  - `AC2.1: a present run dir keeps the PR body's resume line`: present = `{ROOT/RUN}`, composed body → `deepEqual {match:true, link:PR_URL, resume:RESUME, failure:null}`.
  - `an archiving-marker archive beside a present root is not gone`: present = `{ROOT/RUN, ROOT/archive/RUN}`, archive state `{"status":"archiving"}` → `resume: RESUME`.
  - `an unresolved main checkout keeps the PR body's resume line`: `pipelinesRoot: () => null` → `resume: RESUME`.
  - `--issue without --resume, or on a no-match, never probes the run dir`: default throwing fakes. `['--issue','4596']` on a composed body → `{match:true, link, failure:null}`; `['--resume','--issue','4596']` on `[]` → `NO_MATCH`.
  - Add to `malformed invocations exit 1` rows: `['--issue with no value', ['--claim-file', CLAIM, '--issue']]` and `--issue` values `'0'`, `'-3'`, `'12x'`, `'abc'`.
  - Update `parseArgs reads the documented flags`: add `'--issue', '7'` → `issue: 7`. Without the flag, `issue: null`.
  - `the verdict is one JSON line with keys in contract order` gets a gone-case twin: keys equal `['match','link','resume','failure']`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/stale-claim-pr-cli.test.js`
Expected: FAIL. The new `AC1.1` tests report `resume` equal to the PR-body line, or the run exits 1 with `unknown argument: --issue`.

- [ ] **Step 3: Implement** the flag, the deps seams, `runDirGone`, and the verdict branch in `plugin/bin/stale-claim-pr.js` per the Interfaces and Gone rule above. `parseArgs` rejects a non-matching `--issue` value with `--issue requires a positive integer`. Update the header: add `[--issue <n>]` to Usage, give the `--issue` entry (opt-in; only with `--resume`; the gone rule in one sentence), and extend the `--resume` sentence to say `resume` is the dispatch-resume command when `--issue` is given and the run dir is absent or archived. Update `USAGE` and `docs/plugin-structure.md` line 213 to match.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/stale-claim-pr-cli.test.js`
Expected: PASS (all tests, `fail 0`).

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/stale-claim-pr.js tests/stale-claim-pr-cli.test.js docs/plugin-structure.md
git commit -m "Point stale-claim-pr.js's Resume line at dispatch resume when the run dir is gone — --issue opt-in (refs #4673)"
```

---

### Task 2: `/tidy` Step 4.7 passes `--issue {n}` and names the dispatch-resume source

**Role:** integration

**Files:**
- Modify: `plugin/skills/tidy/scan-procedures.md` (the "Stale claim with an open PR (#4423)" paragraph, lines ~242-256)
- Modify: `docs/journeys/tidy-standalone-auto-report.md` (line 36's "rendered only when the PR body's shaped `### Resume` line names that same run" sentence, plus a changelog bullet at the end like line 63's)
- Test: `tests/tidy-stale-claim-open-pr-conformance.test.js`
- Waived plugin/skills/tidy/step-6-auto.md: no change. Its Unsettled run row (line 38) says "recommends resuming via the reported command" and never restates the Resume line (the spec's "if it restates the line" condition is false). The same goes for `plugin/skills/_shared/issue-claims.md`, which calls the CLI without `--resume`.

**Interfaces:**
- Consumes: Task 1's `--issue <n>` flag and its gone-case `resume` value `` `/claude-tweaks:dispatch resume #{n}` ``.

- [ ] **Step 1: Write the failing tests** in `tests/tidy-stale-claim-open-pr-conformance.test.js`, both over `claimAuditSection()` flattened by `replace(/\s+/g, ' ')`:
  - `AC1.1: the stale-claim call passes --issue {n} so a gone run dir resumes through dispatch (#4673)`: the section includes `--resume --issue {n}`, includes `` `/claude-tweaks:dispatch resume #{n}` ``, and matches `/absent or archived/`.
  - `AC2.1: a present run dir still renders the PR body's resume line (#4673)`: the section still includes `Resume open PR #{number} ({url}) — {resume}` and `the PR body's resume line`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/tidy-stale-claim-open-pr-conformance.test.js`
Expected: FAIL. The AC1.1 test reports that `--resume --issue {n}` is missing.

- [ ] **Step 3: Edit the paragraph.** In the command, append ` --issue {n}` after `--resume`, where `{n}` is the claim file's `claims/issue-{n}.json` number. Replace the parenthetical `(the PR body's resume line, already validated as a paste-safe command naming this same run)` with `(the PR body's resume line, already validated as a paste-safe command naming this same run — or `` `/claude-tweaks:dispatch resume #{n}` `` when that run's directory is absent or archived)`. Keep the delta under +250 bytes (`wc -c` before and after). In the journey, change the sentence to say the row carries the PR body's shaped Resume line when the run dir still exists and `` `/claude-tweaks:dispatch resume #{n}` `` when it is absent or archived. Add a bullet: `- Updated during build of #4673: a stale claim whose run dir is absent or archived resumes through `/claude-tweaks:dispatch resume #{n}` (`stale-claim-pr.js --issue`).`

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/tidy-stale-claim-open-pr-conformance.test.js tests/stale-claim-pr-cli.test.js`
Expected: PASS (`fail 0`).

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/tidy/scan-procedures.md docs/journeys/tidy-standalone-auto-report.md tests/tidy-stale-claim-open-pr-conformance.test.js
git commit -m "Route /tidy's stale-claim Resume row through dispatch resume when the run dir is gone (refs #4673)"
```

---

## Spec coverage

| Spec item | Task |
|---|---|
| Deliverable 1 (absent/archived → dispatch resume) | Task 1 (code), Task 2 (prose call) |
| Deliverable 2 (present → PR-body line) | Task 1 `AC2.1`, Task 2 `AC2.1` |
| AC1.1 | Task 1 `AC1.1` tests, Task 2 `AC1.1` test |
| AC2.1 | Task 1 `AC2.1`, Task 2 `AC2.1` |
| AC3.1 (a test pins both branches) | Task 1's `AC1.1` and `AC2.1` tests together |
