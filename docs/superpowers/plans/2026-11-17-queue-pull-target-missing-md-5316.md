# Queue pull stages the target-missing Close proposal as .md (#5316) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The target-missing pass stages its Close proposal as exactly `staged/dispatch-target-missing-{n}.md`, in both the bash fence and the Node module, and the parity/module tests pin that name.

**Architecture:** `stage-item.js` names a staged item `{--id}{extname(--file)}` (`plugin/bin/lib/stage-item/write.js:117-120`). Today both sides write the proposal to an extensionless `mktemp` file (`tmp.XXXXXXXXXX`), so the staged name takes the random suffix as its "extension". The fix writes the proposal to a deterministic `target-missing-proposal-{n}.md` in the session temp directory that already holds `dispatch-exclusions.json` — the same place and shape the shipped pass's twin already uses (`shipped-close-proposal-{n}.md`, fence 545-567, module `stageShippedProposals`). That removes the pass's only `mktemp` call, which orphans the module's `tmpName` dep, its `QP_TMPNAME_COUNTER_FILE` test seam and the oracle's `mktemp` shim; Task 2 retires them.

**Tech Stack:** Node 18+ (`node --test`), bash fence in `plugin/skills/dispatch/queue-pull-script.md`, the bash parity oracle in `tests/bin-lib/dispatch/queue-pull-oracle.js`.

**Spec:** `.claude-tweaks/pipelines/2026-11-15T162121-spec-5304-5305-5306-5307-5309-5310-5311-5312-5313-5314-5315-5316-5317-5409/spec-5316/work/5316-spec.md`

Scope keywords: tmpName, QP_TMPNAME_COUNTER_FILE, mktemp, target-missing-proposal

## Global Constraints

- Deliverable 1 (verbatim): "The proposal is written to a `.md` temp path (or staged with an explicit `.md` id) so the staged name is `dispatch-target-missing-{n}.md`."
- Deliverable 2 (verbatim): "The parity/module test pins the staged name."
- AC1 (verbatim): "A target-missing candidate stages exactly `staged/dispatch-target-missing-{n}.md`, with `{n}` a number."
- Spec Current State: the fence has not been removed by #5231, so "fix both and keep the parity row" — fence and module change together, in one commit.
- Fence size rail: `plugin/skills/dispatch/queue-pull-script.md` is 52,494 bytes against `RAIL_BYTES` 52,500 (`plugin/bin/lib/skill-audit/budgets.js`). Every byte added beyond 6 must be paid for by trimming restatement inside the fence, never a clause that tells the reader what to do or gives a reason stated nowhere else. Quote `wc -c` after the edit.
- Fence line count must not change: `queue-pull.js` cites fence lines as `fence NNN` in ~25 comments. Every fence edit in this plan is in place (same line count), so no `fence NNN` comment moves; if an implementer's edit does change the count, re-anchor every moved citation.
- Shell constraint for every agent: one plain command per Bash call — no `&&`/`;` chains, no `cd … &&`, no heredoc, no loop, no `$(...)`, no shell variable carried across calls. Use Write/Edit/Read for file content and double-quoted literal absolute paths. Worktree: `/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude/worktrees/flow+spec-5304-5409`; check `pwd` and `git rev-parse --show-toplevel` both print it before any commit.
- Run targeted test files in the foreground with an explicit timeout (`node --test <file>`), never in the background (a background run can queue ~45 min behind another worktree's suite slot). Never run the full suite.
- Commit subject style `{Verb} {what} — {detail}`, `refs #5316` in the subject; the message ends, after a blank line, with `Claude-Session: https://claude.ai/code/session_01CcCLFt4ZXj57iPy1vEWBhb`.
- Scope and edit discipline (verbatim): "Commit tests only where the task asks for them or the repo already keeps tests for this kind of change, sized like the neighboring test files; scratch checks stay scratch. Touch only what the task requires — a pre-existing bug you notice is a follow-up to report, not a fix to fold in, unless the task cannot work without it. Don't reformat or "improve" adjacent code; edit in place rather than rewrite when the result is the same."
- Governing project skill quoted (`.claude/skills/skill-prose-conformance-tests/whole-fence-parity-oracle.md` item 6, the only item this change touches): "**Share deterministic seams.** The oracle's `mktemp` shim and the port's temp-name seam read one counter file, so both sides name files identically. A frozen-clock preload stubs `Date` on both sides." Task 2 rewrites its example, since the seam it names is retired. `dispatch-queue-exclusion-addition` does not apply (no exclusion reason added or changed); `prose-code-twin-pin` does not apply (no prose table restating code); `windows-checkout-test-parity`: the new module assertions compare `path.basename` values and session-dir file keys, never a full path string, and the oracle tests already skip on win32 (`oracleSkip`).
- Twin note (report only, do not fix): the shipped pass is the only other pass that stages a Close proposal; it already writes a deterministic `.md` (`shipped-close-proposal-{n}.md`). No other `mktemp` call exists in the fence.

## Review Focus

1. A second pull in the same session finds an earlier pull's `target-missing-proposal-{n}.md` already there — it must be overwritten with this pull's body, never appended to or kept. (Task 1 test pre-writes junk at that path.)
2. Two target-missing records in one pull must get two distinct proposal files and two distinct staged names (`9006` and `9009` in `FULL()`). (Task 1 test.)
3. A Windows checkout: `DISPATCH_EXCLUSIONS` is a native path; the fence derives the directory with `dirname`, the same call the shipped twin uses at fence 545, and the module with `path.dirname`. No new path-string assertion is added.
4. A regression back to an extensionless temp name on both sides at once would keep the parity comparison green (both sides would agree); only the exact-name pins in Task 1 (module and oracle) catch it.
5. The fence's byte rail: a trim must not remove a reason stated nowhere else (#5315's review found one earlier cut that did).

---

### Task 1: Write the target-missing proposal to `target-missing-proposal-{n}.md` in both fence and module, and pin the staged name

**Files:**
- Modify: `plugin/skills/dispatch/queue-pull-script.md:444` (the `TMP_PROPOSAL=$(mktemp)` line), `:415-416` and `:456-457` (byte trims, in place)
- Modify: `plugin/bin/lib/dispatch/queue-pull.js:1018-1026` (`runTargetMissing`'s staging loop)
- Test: `tests/bin-lib/dispatch/queue-pull.test.js` — `fenceTargetProposal` (~line 1631), the `AC2.1 target-missing D2` test (~line 1803), the oracle cross-check (~line 2175), `AC1.2` (~line 3303)

**Interfaces:**
- Consumes: `put(ctx, file, content)` (queue-pull.js:246), `targetMissingProposal(num, tpath, ref)` (queue-pull.js:948), `paths['dispatch-exclusions.json']` (already bound as `exclusions` in `runTargetMissing`).
- Produces: the proposal file `path.join(path.dirname(paths['dispatch-exclusions.json']), \`target-missing-proposal-${n}.md\`)`, passed as `stage-item.js --file`. Task 2 relies on `deps.tmpName` no longer being called anywhere.

- [ ] **Step 1: Write the failing tests**

1a. In `fenceTargetProposal`, change the block regex to anchor on the new line:
`/TMP_PROPOSAL="\$\(dirname "\$DISPATCH_EXCLUSIONS"\)\/target-missing-proposal-\$\{NUM\}\.md"\n {2}\{\n([\s\S]*?)\n {2}\} > "\$TMP_PROPOSAL"/`

1b. Replace the `AC2.1 target-missing D2: --file is whatever deps.tmpName returns …` test with:

```js
test('AC1.1 target-missing: the Close proposal is written to target-missing-proposal-<n>.md in the session dir, so stage-item.js stages dispatch-target-missing-<n>.md', () => {
  const r = pull4(FULL(), {
    // Review Focus 1: an earlier pull's file at the same path is overwritten, not kept.
    prepare: () => {
      const dir = path.dirname(sessionPaths('qp-t3')['dispatch-groups.json']);
      fs.writeFileSync(path.join(dir, 'target-missing-proposal-9006.md'), 'stale\n');
      return {};
    },
  });
  const staged = r.cap.staged.filter((s) => s.id.startsWith('dispatch-target-missing-'));
  assert.deepEqual(staged.map((s) => `${s.id}${path.extname(s.file)}`), ['dispatch-target-missing-9006.md', 'dispatch-target-missing-9009.md'], 'the name stage-item.js writes: --id plus --file\'s extension (write.js)');
  assert.deepEqual(staged.map((s) => path.basename(s.file)), ['target-missing-proposal-9006.md', 'target-missing-proposal-9009.md']);
  assert.equal(staged[0].body, fenceTargetProposal('9006', 'docs/gone6.md', 'origin/main'));
  assert.equal(r.text['target-missing-proposal-9006.md'], staged[0].body, 'the file sits in the session dir beside dispatch-exclusions.json');
  assert.equal(r.text['target-missing-proposal-9009.md'], staged[1].body);
});
```

Confirm `sessionPaths('qp-t3')` resolves to the same dir `pull` uses (its default `sessionId` is `'qp-t3'`, and `prepare` runs inside `inOwnTmp`, after `pull` created the dir). If `pull4`'s `prepare` runs before the session dir exists, create it with `fs.mkdirSync(dir, { recursive: true })` first.

1c. Oracle cross-check (~line 2175): replace the `.qp\d{8}` assertion with
`assert.ok(Object.keys(oracle.staged).includes('dispatch-target-missing-9009.md'), \`the oracle stages the target-missing item as .md: ${Object.keys(oracle.staged)}\`);`

1d. `AC1.2` (~line 3303): replace the `.qp\d{8}` assertion with
`assert.ok(names.includes('dispatch-target-missing-9009.md'), \`${name}: the target-missing item is staged as .md: ${names}\`);`
Leave the byte-equal `Object.keys(module.staged)` vs `Object.keys(oracle.staged)` loop above it unchanged — it stays the parity check.

- [ ] **Step 2: Run the tests to verify they fail**

Run (foreground, timeout 900000 ms): `node --test --test-name-pattern="AC1.1 target-missing: the Close proposal|oracle cross-check: S1 full|AC1.2: normalize" "/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude/worktrees/flow+spec-5304-5409/tests/bin-lib/dispatch/queue-pull.test.js"`
Expected: FAIL — `fenceTargetProposal` asserts "the fence no longer builds the proposal with an echo group", and the staged names end in `.tmp…`/`.qp00000001`, not `.md`. (On a host without bash ≥ 4 the two oracle tests skip; the module test still fails.)

- [ ] **Step 3: Implement**

3a. Fence line 444 becomes exactly:
`  TMP_PROPOSAL="$(dirname "$DISPATCH_EXCLUSIONS")/target-missing-proposal-${NUM}.md"`
(+61 bytes.)

3b. Fence byte trims, both in place (line count unchanged), together −67 bytes:
- Lines 415-416: `# #3110: stop rather than continue with a partial exclusion list when` / `# appendExclusion throws (corrupt/unreadable dispatch-exclusions.json).` → drop the parenthetical ` (corrupt/unreadable dispatch-exclusions.json)` (−46): the line becomes `# appendExclusion throws.`. The cause is restated: lines 127-128 and 365 already name a corrupt/unreadable `dispatch-exclusions.json` as what makes `appendExclusion` throw.
- Lines 456-457: `# stage-item.js is the sanctioned writer for a run dir's staged/ (CLAUDE.md's` / `# pipeline-run-dir.md citation) -- never a direct Write/heredoc into it.` → `# stage-item.js is the sanctioned writer for a run dir's staged/` / `# (pipeline-run-dir.md) -- never a direct Write/heredoc into it.` (−21): only the "CLAUDE.md's … citation" provenance wording goes; the rule and its source file stay.
Expected `wc -c` after: 52,488 (12 bytes headroom). Verify with `wc -c "<worktree>/plugin/skills/dispatch/queue-pull-script.md"` and quote it.

3c. Module, `runTargetMissing`'s loop body: replace the two-line mktemp comment, the `tmp` step, the `put` and the `stage-item.js` call with: compute `const file = path.join(path.dirname(exclusions), \`target-missing-proposal-${number}.md\`);`, `put(ctx, file, targetMissingProposal(number, tpath, ref));`, then `forward(ctx, spawnCli(ctx, 'stage-item.js', ['--run', state.standaloneDir, '--id', \`dispatch-target-missing-${number}\`, '--file', file]));`. One-line comment above `file`: `// Fence 444: beside dispatch-exclusions.json, as the shipped pass's proposals are; the .md names the staged item (#5316).` (`deps.tmpName` is then unused; Task 2 removes it.)

- [ ] **Step 4: Run the tests to verify they pass**

Run the Step 2 command. Expected: PASS (oracle tests PASS or skip with `no bash oracle`).
Then run the whole file once, foreground, timeout 1200000 ms: `node --test "<worktree>/tests/bin-lib/dispatch/queue-pull.test.js"` — expected: the only failures, if any, are the tmpName/mktemp-seam tests Task 2 retires (`#5227 tmpName: …`, `#5227 tmpName counter seam …`, `#5227 oracle: the mktemp shim emits …`); quote the raw `# pass`/`# fail` lines.

- [ ] **Step 5: Commit**

`git -C "<worktree>" add -- plugin/skills/dispatch/queue-pull-script.md plugin/bin/lib/dispatch/queue-pull.js tests/bin-lib/dispatch/queue-pull.test.js`
Subject: `Stage the target-missing Close proposal as dispatch-target-missing-N.md — a session-dir .md path in the fence and module, the name pinned (refs #5316)`

---

### Task 2: Retire the orphaned temp-name seam (`tmpName`, `QP_TMPNAME_COUNTER_FILE`, the oracle's `mktemp` shim)

After Task 1 nothing calls `deps.tmpName` and the fence runs no `mktemp`. Remove every copy of the mechanism.

**Files:**
- Modify: `plugin/bin/lib/dispatch/queue-pull.js` — delete the header paragraph at lines 59-64 ("Test-only seam: when QP_TMPNAME_COUNTER_FILE is set …"), the `tmpName()` function (~1322-1341), the `tmpName,` entry in `defaultDeps` (~1387), and the `crypto` require (line 77; `tmpName` was its only user — confirm with `grep -n "crypto" queue-pull.js` showing only the require before deleting).
- Modify: `tests/bin-lib/dispatch/queue-pull-oracle.js` — delete `mktempShimScript()` and its comment (~307-354), the `bin/mktemp` write in `writeShims` (~298), `QP_TMPNAME_COUNTER_FILE: path.join(logs, 'tmpname-counter')` from `runEnv` (~732); edit the header comment (lines 9-17: drop "mktemp (counter-file names, mktempShimScript)" and "and the mktemp counter") and `writeShims`'s comment (~284: drop "mktemp (mktempShimScript),").
- Modify: `tests/bin-lib/dispatch/queue-pull-shims.test.js` — delete the seven `the mktemp shim …` tests (~367-446); keep `bin/node is a sh script`, giving it its own sandbox (`const sb = createSandbox(S0()); t.after(() => sb.cleanup());`) in place of `mktempSandbox`; delete `mktempSandbox`; retitle the section comment to `// --- bin/node ---…` keeping its dash width.
- Modify: `tests/bin-lib/dispatch/queue-pull.test.js` — delete `#5227 oracle: the mktemp shim emits …` (~125-145), `#5227 tmpName: random tmp.<10 alnum> …` (~617-634) and `#5227 tmpName counter seam matches the oracle mktemp shim …` (~661-675); drop `'QP_TMPNAME_COUNTER_FILE'` from `ORACLE_ENV_KEYS` (~86) and from `inOwnTmp`'s `keys` plus its `delete process.env.QP_TMPNAME_COUNTER_FILE;` line (~564-567); header comment lines 3-4 "PATH shims for gh, git and mktemp" → "PATH shims for gh and git", and lines 8-9 "The clock is frozen by the stub rather than normalized, and temp names match across sides through the QP_TMPNAME_COUNTER_FILE seam." → "The clock is frozen by the stub rather than normalized; the one temp file both sides name (the target-missing proposal) has a fixed name."; in `AC1.2`'s normalize sample (~3307-3309) drop the ` tmp.qp00000001` token from both strings and change the message to `'the clock is left as it is'`.
- Modify: `tests/dispatch-named-target-exclusion-fixture.test.js:73` — drop the `tmpName: () => path.join(scratch, 'proposal.md')` dep (the proposal now lands in the session dir its `t.after` already removes).
- Modify: `.claude/skills/skill-prose-conformance-tests/whole-fence-parity-oracle.md` item 6 → `6. **Share deterministic seams.** Give a file both sides write a fixed name rather than a random temp name, so both sides name it identically (#5316 replaced #5227's shared mktemp counter with a fixed session-dir path). A frozen-clock preload stubs \`Date\` on both sides.`

**Interfaces:**
- Consumes: Task 1's module change (no `deps.tmpName` call left).
- Produces: nothing new.

- [ ] **Step 1: Prove the sweep target is complete (retirement sweep)**

Run each phrasing, one `-e` per phrasing, over non-history paths:
`git -C "<worktree>" grep -n -i -e tmpName -e QP_TMPNAME -e mktempShim -e "mktemp shim" -e "tmp\.qp" -e "tmpname-counter" -- plugin tests docs perf tools .claude/skills ":!docs/superpowers/plans" ":!docs/plans/*-ledger.md"`
Control (#4579 absence-grep rule): before any edit, this command matches the sites listed in Files above — record the match count. The exclusions were added per #4579 (the plan and ledger quote the target).

- [ ] **Step 2: Make the edits above.**

- [ ] **Step 3: Verify**

- Re-run the Step 1 grep: expected no output (exit 1).
- `node --test "<worktree>/tests/bin-lib/dispatch/queue-pull-shims.test.js"` (foreground, timeout 600000 ms): PASS.
- `node --test "<worktree>/tests/dispatch-named-target-exclusion-fixture.test.js"` (timeout 300000 ms): PASS.
- `node --test "<worktree>/tests/bin-lib/dispatch/queue-pull.test.js"` (timeout 1200000 ms): PASS; quote the raw `# pass`/`# fail`/`# skipped` lines.

- [ ] **Step 4: Commit**

`git -C "<worktree>" add --` each file above, then subject: `Retire the queue-pull temp-name seam — tmpName, QP_TMPNAME_COUNTER_FILE and the oracle's mktemp shim lost their one caller with #5316's fixed proposal path (refs #5316)`

---

## Spec coverage

| Spec item | Covered by |
|---|---|
| Deliverable 1 — `.md` temp path, staged name `dispatch-target-missing-{n}.md` | Task 1 Step 3 (fence 3a, module 3c) |
| Deliverable 2 — parity/module test pins the staged name | Task 1 Step 1b (module), 1c and 1d (oracle) |
| AC1.1 — stages exactly `staged/dispatch-target-missing-{n}.md`, `{n}` a number | Task 1 test `AC1.1 target-missing: the Close proposal …` (module, `9006`/`9009`), plus the oracle pins on `dispatch-target-missing-9009.md` |
| Current State — fix both fence and module, keep the parity row | Task 1 (one commit), parity loop in `AC1.2` left unchanged |

## Self-review

- **Spec coverage:** every Deliverable and AC1.1 maps to Task 1 above.
- **Placeholders:** none; `<worktree>` is the literal path in Global Constraints.
- **Proportion:** two tasks; Task 2 is a mechanical removal of what Task 1 orphans.
