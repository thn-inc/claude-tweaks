# Queue pull: a failed per-dependency issue view fails closed (#5311) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A failed per-dependency `gh issue view` (gh transport), or a missing or malformed `dispatch-verified-open-deps.txt` (files transport), excludes the dependent record as `blocked` with one `Warning:` line, instead of silently letting it dispatch — in the module and in the fence, byte-identical.

**Architecture:** The blocked pass checks each dependency missing from the 200-record open pull with one live `gh issue view` (module `runBlocked`'s `verified-open-deps` step, queue-pull.js ~588-597; fence lines 169-173) and writes the OPEN ones to `dispatch-verified-open-deps.txt`; the `blocked-body` step (module ~599-613; fence lines 174-183) reads that file into `openNumbers`. On gh, a failed view now counts its dependency as open (appended to the file) and prints a Warning naming the view. On files the agent writes that file, so the reader fails closed: a missing file, or one with any non-empty line that is not a plain decimal number, counts every unresolved dependency (`dispatch-unresolved-deps.json`) as open and prints one Warning — only when there is at least one unresolved dependency (no record is affected otherwise). The MCP agent contract (`mcp-transport.md`) gains the files twin of the gh fix: an `issue_read` that fails lists the number (fail closed).

**Tech Stack:** Node 18+ (`plugin/bin/lib/dispatch/queue-pull.js`), bash fence (`plugin/skills/dispatch/queue-pull-script.md`), `node --test` with the bash parity oracle (`tests/bin-lib/dispatch/queue-pull-oracle.js`, unchanged: its `: > "$DISPATCH_VERIFIED_OPEN_DEPS"` … `done` span replacement still matches).

**Spec:** `.claude-tweaks/pipelines/2026-11-15T162121-spec-5304-5305-5306-5307-5309-5310-5311-5312-5313-5314-5315-5316-5317-5409/spec-5311/work/5311-spec.md` (materialized from GitHub issue #5311)

Scope keywords: DISPATCH_VERIFIED_OPEN_DEPS

## Global Constraints

- Fix both module and fence and keep the parity rows: #5230 is CLOSED (dispatch runs the CLI) but #5231 (remove the fence) is OPEN, so the spec's rule applies — "if the fence (`plugin/skills/dispatch/queue-pull-script.md`) has not been removed by #5231 when this lands, fix both and keep the parity row."
- `plugin/skills/dispatch/queue-pull-script.md` is exactly 52,500 bytes and `RAIL_BYTES` is 52,500: zero headroom. The finished file must be `wc -c` ≤ 52,500. Quote the `wc -c` output before and after in the report.
- Warning texts, both sides, byte for byte (U+2014 em dash, as every other queue-pull Warning):
  - gh: `Warning: gh issue view {dep} failed — dependency #{dep} treated as open (fail closed) this run`
  - files: `Warning: verified-open-deps file missing or malformed — every unresolved dependency treated as open (fail closed) this run`
- One gh Warning per failed view (each names its own fetch, in loop order); at most one files Warning per pull.
- "Malformed" means: after `trim()`, any non-empty line (split on `\n`, each line trimmed) that does not match `/^\d+$/`. An empty file is well-formed (no verified-open dependency).
- No exit-status change: the pull still exits 0 (the `blocked` pass's `failOpen` stays `'open'`, AC4.2).
- Do not touch the fence's comment lines 115-118 or 286-289: #5310's committed plan (`docs/superpowers/plans/2026-11-16-queue-pull-dep-freshness-warning-5310.md`, not yet built) reserves them as its own byte cuts.
- Do not implement any part of #5310 (dependency-freshness search Warnings).
- Every commit message ends, after a blank line, with `Claude-Session: https://claude.ai/code/session_01X7gPF9Z767qUj2FDCYWeFV`.
- Worktree shell constraint for any dispatched agent: one plain command per Bash call, no `&&`/`;`/`$(...)`/heredoc/loop; literal absolute paths.

## Review Focus

1. A gh view that fails for one dependency while another dependency's view answers OPEN and a third CLOSED: only the failed one gets a Warning, the file lists the OPEN one and the failed one, never the CLOSED one. Pinned by the multi-dependency in-process test in Step 1.
2. A files pull with no unresolved dependency and no verified-open-deps file (the agent wrote none because there was nothing to check): no Warning, no exclusion — the existing S1 files-matrix rows staying green pins it; the in-process control in Step 1 pins it directly.
3. A file holding `8000\r\n` (CRLF from an agent Write on Windows) or a trailing blank line: well-formed, not malformed. Pinned in Step 1.
4. A failed view whose dependency is also a native or foreign blocker: the exclusion detail must not duplicate it — `partitionByOpenBodyBlockers` is unchanged and reads `openNumbers` as a set, so this needs no new code; the reviewer checks that no second exclusion entry appears in the F-depview row.
5. The fence's files reader receiving the unresolved list: it must read `$DISPATCH_UNRESOLVED_DEPS` (written by the preceding node block), not recompute it, so module and fence agree on what "every unresolved dependency" means.

---

### Task 1: Fail closed on a failed dependency view and an unreadable verified-open-deps file, in module, fence and MCP contract

**Review risk:** high — it changes which records the blocked pass excludes and edits the fence at zero byte headroom.

**Files:**
- Modify: `plugin/bin/lib/dispatch/queue-pull.js` (the `verified-open-deps` step ~588-597; the `blocked-body` step's file read ~606-613)
- Modify: `plugin/skills/dispatch/queue-pull-script.md` (loop line 171; the node block at 174-183 and its argv; comment trims for bytes)
- Modify: `plugin/skills/dispatch/mcp-transport.md` (line 84, the `--verified-open-deps` bullet)
- Test: `tests/bin-lib/dispatch/queue-pull-oracle.js` (read only, no change — its `: > "$DISPATCH_VERIFIED_OPEN_DEPS"` … `done` span replacement (~138) still matches the edited loop; confirm it in Step 6 by the files rows running)
- Modify: `tests/bin-lib/dispatch/queue-pull-fixtures.js` (`S1LiveDep`'s `viewFails` comment and its now-unneeded extra answers, ~615-635)
- Test: `tests/bin-lib/dispatch/queue-pull.test.js` (new in-process tests; the `absent` block at ~1265-1267; `FAULT_EXPECT['F-depview']` ~3433; `FILES_EXPECT` verifiedOpenDeps rows ~3469-3470; the F-depview detail assertion ~3634; header comment ~46-50)

**Interfaces:**
- Produces: no new export. Module: inside `runBlocked`, the `verified-open-deps` step appends a dependency whose `ghRun(...).ok === false` and writes the gh Warning; the `blocked-body` step computes `verifiedOpen` as below. Fence: the node block gains a sixth argv, `"$DISPATCH_UNRESOLVED_DEPS"` (`process.argv[6]`).

- [ ] **Step 1: Write the failing tests** in `tests/bin-lib/dispatch/queue-pull.test.js`, beside the `#5227 files:` test at ~1238 (`S1LiveDep`, `S1`, `pull`, `entriesOf`, `groupNumbers`, `writeInput`, `mcpRecord`, `withBody` are already in scope there; `failGh` is bound only at ~4072, so do not use it here):

```js
const DEP_VIEW_FAILED = (n) => `Warning: gh issue view ${n} failed — dependency #${n} treated as open (fail closed) this run`;
const VERIFIED_UNREADABLE = 'Warning: verified-open-deps file missing or malformed — every unresolved dependency treated as open (fail closed) this run';
const warningsOf = (r) => r.stderr.split('\n').filter((l) => l.startsWith('Warning: gh issue view') || l.startsWith('Warning: verified-open-deps'));

test('AC1.1 (#5311): a failed dependency view excludes the dependent record as blocked and prints the line naming the view', () => {
  const r = pull(S1LiveDep({ viewFails: true }));
  assert.deepEqual(entriesOf(r, 'blocked'), entriesOf(pull(S1LiveDep()), 'blocked'), 'the same blocked entry the answered view gives');
  assert.ok(entriesOf(r, 'blocked').some((e) => e.records.includes(9002)));
  assert.ok(!groupNumbers(r).flat().includes(9002), '#9002 is not dispatchable');
  assert.deepEqual(warningsOf(r), [DEP_VIEW_FAILED(8000)]);
  assert.equal(r.text['dispatch-verified-open-deps.txt'], '8000\n');
});
```

  Plus a multi-dependency gh test (Review Focus 1): build it from `S1LiveDep()` by adding two more unresolved body dependencies to a queue record the way `S1LiveDep` drops #8000 from the open-numbers answer — one answered `CLOSED\n`, one OPEN, and #8000's view made to fail (`{ argv, stdout: '', stderr: 'gh-fault: injected failure\n', status: 1 }` in place of its entry) — and assert one Warning naming only the failed number and a file listing exactly the OPEN and failed numbers. If the fixture shape makes a third dependency impractical, two (one failed, one CLOSED) suffice; say which in the report.

  Then in the existing `#5227 files:` test, replace the `absent` block's assertions (~1265-1267):

```js
  const absent = pull(S1(), { transport: 'files', run: noGh, prepare: (own) => write(own, { verified: null }) });
  assert.deepEqual(entriesOf(absent, 'blocked'), [{ reason: 'blocked', records: [9002], detail: { blockedBy: [8000] } }], 'AC2.1 (#5311): a missing verified-open-deps file fails closed');
  assert.deepEqual(groupNumbers(absent), [[9001]]);
  assert.deepEqual(warningsOf(absent), [VERIFIED_UNREADABLE]);
  const malformed = pull(S1(), { transport: 'files', run: noGh, prepare: (own) => write(own, { verified: 'this is not json\n' }) });
  assert.deepEqual(groupNumbers(malformed), [[9001]], 'AC2.1 (#5311): a malformed file fails closed');
  assert.deepEqual(warningsOf(malformed), [VERIFIED_UNREADABLE]);
  const crlf = pull(S1(), { transport: 'files', run: noGh, prepare: (own) => write(own, { verified: '8000\r\n\n' }) });
  assert.deepEqual(groupNumbers(crlf), [[9001]]);
  assert.deepEqual(warningsOf(crlf), [], 'CRLF and a blank line are well-formed');
  const empty = pull(S1(), { transport: 'files', run: noGh, prepare: (own) => write(own, { verified: '' }) });
  assert.deepEqual(groupNumbers(empty), [[9001], [9002]], 'an empty file is a well-formed "none open" answer');
  assert.deepEqual(warningsOf(empty), []);
  assert.deepEqual(calls, []);
```

  And a files control with no unresolved dependency (Review Focus 2): the same `write` helper with `9002`'s body carrying no `Blocked by` line and `verified: null` — no Warning, both records grouped.

  Parity rows:
  - `FAULT_EXPECT['F-depview']` becomes `{ status: 0, base: 'gh-livedep', stderr: ['Warning: gh issue view 8000 failed — dependency #8000 treated as open (fail closed) this run'], drops: [] }`.
  - `FILES_EXPECT['files-verifiedOpenDeps-missing']` and `['files-verifiedOpenDeps-malformed']` become `{ status: 0, base: 'files-livedep', stderr: ['Warning: verified-open-deps file missing or malformed — every unresolved dependency treated as open (fail closed) this run'], drops: [] }`.
  - The detail assertion at ~3634 flips: `assert.ok(!groupedIn(r).includes(9002), \`F-depview ${side}: #9002 is held (fail closed)\`)`.
  - Header comment ~46-50: the files-verifiedOpenDeps bullet becomes "Fixed by #5311: a missing or malformed file fails closed (every unresolved dependency open, one Warning)"; the silent fail-opens line drops F-depview and says F-depview fails closed with one Warning since #5311.
  - `queue-pull-fixtures.js` `S1LiveDep`: with the fix #9002 no longer passes the blocked pass, so the `viewFails` branch's linked-PR alias for 9002 and landing node for 8000 are no longer reached. Remove them and update the comment (~615-620) to say the failed view now holds #9002 (#5311); if any parity row goes red without them, keep them and say why in the report.

- [ ] **Step 2: Run the new in-process tests to verify they fail**

Run: `node --test --test-name-pattern "5311|#5227 files: the queue file" tests/bin-lib/dispatch/queue-pull.test.js`
Expected: FAIL — no Warning, and #9002 grouped.

- [ ] **Step 3: Implement the module side** in `plugin/bin/lib/dispatch/queue-pull.js`:
  - `verified-open-deps` step: `if (!r.ok) { ctx.deps.stderr(\`Warning: gh issue view ${dep} failed — dependency #${dep} treated as open (fail closed) this run\n\`); fs.appendFileSync(f.verifiedOpenDeps, \`${dep}\n\`); } else if (trimNl(r.stdout) === 'OPEN') …` (unchanged append). One-line comment `// #5311: a failed view fails closed.`
  - `blocked-body` step: read the file into `lines` (`null` on ENOENT; any other error still throws); `const bad = lines === null || lines.some((l) => !/^\d+$/.test(l.trim()))`; when `bad`, read `paths['dispatch-unresolved-deps.json']` (as the `verified-open-deps` step does) and, if it is non-empty, print the files Warning once and use it as `verifiedOpen`; when not `bad`, `lines.map(Number)` as now. `lines` is `text.trim().split('\n').filter(Boolean)` as now. One-line comment naming #5311.

- [ ] **Step 4: Implement the fence side** in `plugin/skills/dispatch/queue-pull-script.md` (run `wc -c` first and quote it):
  - Line 171 becomes: `  STATE=$(gh issue view "$DEP" --json state -q .state 2>/dev/null) || { STATE=OPEN; echo "Warning: gh issue view $DEP failed — dependency #$DEP treated as open (fail closed) this run" >&2; }`
  - Line 174's `node-eval-file.js` call gains `"$DISPATCH_UNRESOLVED_DEPS"` as its last argument.
  - Lines 180-182 become the fence twin of Step 3's reader: `lines` from `fs.existsSync(process.argv[3]) ? … : null`, the same `bad` test, `const unresolved = require(process.argv[6])`, the files Warning via `process.stderr.write('…\n')` when `bad && unresolved.length`, `const verifiedOpen = bad ? unresolved : lines.map(Number)`. One `// #5311: …` comment line at most.
  - Cut comment bytes until `wc -c` ≤ 52,500, in this order, checking each candidate first with `git grep -n -F "<a phrase from it>" -- tests` (must return nothing; `tests/hooks-dispatcher.test.js` pins the line-235 grouping comment, so never touch 235-238): (a) the block's own four-line comment at 161-164 → one line, e.g. `  // A dependency outside the --limit 200 open pull is unresolved, not closed: checked live below.`; (b) the five-line #1752 comment at 45-49 → one line keeping its meaning (keep only 'firing' entries, appended by SKILL.md's Loop between re-runs, firing-exclusion.md; every other reason is recomputed); (c) the five-line ladder comment at 386-390 → one or two lines naming rank 3 with the rank-6 fallback and settle-and-merge.md's reasoning. Never lines 115-118 or 286-289 (Global Constraints).
  - Run `wc -c plugin/skills/dispatch/queue-pull-script.md` and quote it.

- [ ] **Step 5: Update the MCP contract** in `plugin/skills/dispatch/mcp-transport.md` line 84: the bullet lists each such dependency "whose `issue_read` state is open (any case) or whose `issue_read` fails (fail closed: a dependency the agent cannot read counts as open)"; keep "Plain text, one number per line; empty when there is none." and add "A missing or malformed file fails closed: the CLI counts every such dependency as open and prints a Warning." Check `wc -c` stays under `RAIL_BYTES` (it is ~27 KB).

- [ ] **Step 6: Run the tests to verify they pass**

Run: `node --test tests/bin-lib/dispatch/queue-pull.test.js` (runs the bash oracle — slow; large timeout), then every other test file that reads the fence or the MCP contract: `git grep -l -e queue-pull-script -e mcp-transport -- tests`, each with `node --test {file}`, plus the rail test (`git grep -l RAIL_BYTES -- tests`).
Expected: PASS, every file. Quote the raw `# pass` / `# fail` summary lines. The AC4 rows `F-depview`, `files-verifiedOpenDeps-missing` and `files-verifiedOpenDeps-malformed` must be green on both sides.

AC coverage: AC1.1 (gh: failed view → not eligible, Warning names the fetch) is pinned by `AC1.1 (#5311)` and the `F-depview` row; AC2.1 (files: missing or malformed `DISPATCH_VERIFIED_OPEN_DEPS` file → same) by the `AC2.1 (#5311)` assertions and the two `files-verifiedOpenDeps-*` rows.

Proof(high-risk): the `AC1.1 (#5311)` and `AC2.1 (#5311)` in-process tests and the three oracle rows pin the exclusion, the Warning and the file content on both sides; reverting Step 3's `!r.ok` branch turns `AC1.1 (#5311)` red, and reverting the fence's `|| { STATE=OPEN; … }` turns `F-depview` red on the oracle side.

- [ ] **Step 7: Prove discrimination by reverting.** Temporarily revert Step 3's `!r.ok` branch and run `node --test --test-name-pattern "5311" tests/bin-lib/dispatch/queue-pull.test.js` — FAIL; restore. Temporarily revert Step 3's `bad` branch and re-run — FAIL on AC2.1; restore. Temporarily remove the fence's `|| { … }` and run the AC4 rows (`--test-name-pattern "F-depview"`) — FAIL; restore. Quote each red line.

- [ ] **Step 8: Commit**

```bash
git add plugin/bin/lib/dispatch/queue-pull.js plugin/skills/dispatch/queue-pull-script.md plugin/skills/dispatch/mcp-transport.md tests/bin-lib/dispatch/queue-pull-fixtures.js tests/bin-lib/dispatch/queue-pull.test.js
git commit -m "Fail closed on a failed dependency view and an unreadable verified-open-deps file in the queue pull (refs #5311)"
```
