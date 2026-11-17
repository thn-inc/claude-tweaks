# Quote the target-missing Close proposal's gh comment body Implementation Plan (#5317)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The target-missing Close proposal's staged `gh issue comment` command passes its `--body` to `gh` as one POSIX single-quoted word, so a `**Doc:**` path holding `"`, `$(…)`, a backtick or `'` reaches the comment verbatim and runs nothing, identically in the queue-pull script fence and in `queue-pull.js`.

**Architecture:** The fence composes the body text unchanged, but hands it to a one-line `node -e` single-quoter inside the `echo` (`'` → `'\''`, wrapped in `'…'`); the module wraps the same text in a local `shQuote` with the same rule. The 81 bytes the fence line grows are paid for by cutting a restating comment in the neighbour-in-flight pass, and the module's `fence NNN` citations that the two removed lines shift are re-anchored.

**Tech Stack:** bash (the fence), Node 20 CommonJS (`plugin/bin/lib/dispatch/queue-pull.js`), `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-11-15T162121-spec-5304-5305-5306-5307-5309-5310-5311-5312-5313-5314-5315-5316-5317-5409/spec-5317/work/5317-spec.md` (worktree copy). Its line numbers are stale: the command is `plugin/skills/dispatch/queue-pull-script.md:453` and `plugin/bin/lib/dispatch/queue-pull.js:949` at HEAD `65d012f93d`.

Scope keywords: targetMissingProposal, Closing: the named target

## Global Constraints

- The script and the module stay byte-identical: the #5227 parity suite compares every staged file (`assertParity` includes `staged`).
- `plugin/skills/dispatch/queue-pull-script.md` must stay at or under the 52,500-byte rail (`RAIL_BYTES`, `plugin/bin/lib/skill-audit/budgets.js`). It is 52,487 bytes at HEAD; the new command line is +81 bytes (229 → 310, measured). Pay for it only by cutting restatement — the cut is fixed in Task 1 Step 3; quote `wc -c` after the edit.
- The comment text the console posts is unchanged apart from quoting: `Closing: the named target {path} no longer exists at {ref} — this record's Acceptance Criteria has no remaining target. Filed by /claude-tweaks:dispatch (queue pull).`
- The `gh issue close {n} --reason "not planned"` line and every other proposal line stay byte for byte as they are.
- Tests that spawn `bash` skip on `win32` (CI runs on ubuntu; Windows has no bash on the runner path); the in-process tests must not need bash.
- Run targeted test files in the foreground with an explicit timeout: `node --test tests/bin-lib/dispatch/queue-pull.test.js` (a backgrounded run can wait ~45 minutes behind another worktree's suite slot). Never `npm test` in the background.
- Shell constraint for every agent: one plain command per Bash call — no `&&`/`;` chains, no `cd … &&`, no heredoc, no loop, no `$(…)`; use `git -C "<worktree>"` and absolute paths; write file content with Write/Edit.

Proof(shell-injection): Task 1's module test and Task 2's oracle test run the staged `gh issue comment` line under real bash with a stub `gh` that records its argv and a stub `id` that leaves a marker file, and assert one `gh` call with the exact body and no marker.

## Review Focus

1. A path holding a single quote (`it's`) — the escape `'\''` must close and reopen the quoted word; pinned by the hostile path in both tasks' bash runs.
2. The fixed text's own apostrophe (`record's`) — it now sits inside a single-quoted word and needs the same escape; pinned by the exact `--body` argv assertion.
3. `$(id)` and `` `id` `` in the path must not execute — pinned by the stub `id` marker staying absent.
4. Windows: the in-process `fenceTargetProposal` helper must mirror the substitution in JS, not shell out — pinned by Task 1's in-process test running with no bash skip.
5. The `gh issue close` line after it is unchanged — pinned by Task 1's assertion on that line.

---

### Task 1: Single-quote the body in the fence and the module

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/skills/dispatch/queue-pull-script.md:453` (the comment `echo`), `:581-585` (the neighbour-in-flight comment)
- Modify: `plugin/bin/lib/dispatch/queue-pull.js:939-952` (`targetMissingProposal`), and the `fence NNN` comments citing lines after 583 (lines 1135, 1169, 1184, 1223, 1225, 1228, 1259 at HEAD)
- Test: `tests/bin-lib/dispatch/queue-pull.test.js` (`fenceTargetProposal` at 1572-1581; new tests after the target-missing tests ending near 1795)

**Interfaces:**
- Produces (test file, used by Task 2): `HOSTILE_DOC` (a `const` string, `docs/q"$(id)` + "`id`" + `"it's.md` — holds `"`, `$(id)`, a backtick and `'`; its two `"` are deliberate: they keep the pre-fix double-quoted line parseable, so bash really runs `id` and splits the argv there — with an odd count the pre-fix line is a syntax error, bash expands nothing, and `idRan === false` would pass on the unfixed code), `runStagedComment(proposalText, num) -> { status, ghCalls: string[][], idRan: boolean, stderr }`, and `CLOSING_BODY(tpath, ref) -> string` (the unquoted comment text from Global Constraints).

- [ ] **Step 1: Write the failing tests**

Add `HOSTILE_DOC`, `CLOSING_BODY` and `runStagedComment` near `fenceTargetProposal`. `runStagedComment`: in a fresh `fs.mkdtempSync` dir write executable `bin/gh` (`#!/bin/sh` that runs `node -e` appending `JSON.stringify(process.argv.slice(1))` plus `\n` to `$QP_GH_LOG`, passing `-- "$@"`) and `bin/id` (`#!/bin/sh` touching `$QP_ID_MARKER`); take the one line of `proposalText` that starts with `gh issue comment ${num} `; run `spawnSync('bash', ['-c', line], { env: { ...process.env, PATH: bin + path.delimiter + process.env.PATH, QP_GH_LOG, QP_ID_MARKER }, encoding: 'utf8' })`; return the parsed log lines and whether the marker exists; remove the dir.

Tests (in-process, using the existing `pull4`/`FULL` machinery with #9009's `**Doc:** docs/gone.md` replaced by `HOSTILE_DOC` in the queue answer — the fake git probe treats it as absent like `docs/gone.md`):

```js
test('#5317 target-missing: a hostile Doc path is staged as one single-quoted --body word, equal to the fence', () => {
  // r = in-process pull over FULL() with #9009 naming HOSTILE_DOC
  const body = staged['dispatch-target-missing-9009'].body;   // the module's staged proposal
  assert.equal(body, fenceTargetProposal(9009, HOSTILE_DOC, 'origin/main'));
  assert.ok(body.includes(`gh issue comment 9009 --body ${shQuote(CLOSING_BODY(HOSTILE_DOC, 'origin/main'))}\n`));
  assert.ok(body.includes('gh issue close 9009 --reason "not planned"\n'), 'the close line is unchanged');
});

test('#5317 AC1 (module): run by bash, the staged comment posts the path verbatim and runs nothing else',
  { skip: process.platform === 'win32' && 'no bash' }, () => {
  const run = runStagedComment(body, 9009);
  assert.equal(run.status, 0, run.stderr);
  assert.deepEqual(run.ghCalls, [['issue', 'comment', '9009', '--body', CLOSING_BODY(HOSTILE_DOC, 'origin/main')]]);
  assert.equal(run.idRan, false, 'neither $(id) nor the backtick ran');
});
```

Use the real ref the in-process scenario resolves (read it from the staged title line if not `origin/main`). `shQuote` is already imported from `./queue-pull-oracle`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test --test-name-pattern "#5317" tests/bin-lib/dispatch/queue-pull.test.js` (foreground, timeout 600000)
Expected: FAIL after Step 1 — the staged line holds `--body "Closing: … docs/q"$(id)…"`; the bash run exits 0 having run the stub `id` (`idRan: true`) and records a `--body` argv without the `$(id)`/backtick text (`Closing: the named target docs/qit's.md …`).

- [ ] **Step 3: Change the fence**

Replace line 453 with exactly (run once under bash in the plan's probe; output `gh issue comment 9050 --body 'Closing: the named target docs/a"$(id)`id`it'\''s.md no longer exists at origin/main — this record'\''s Acceptance Criteria has no remaining target. Filed by /claude-tweaks:dispatch (queue pull).'`):

```bash
    echo "gh issue comment ${NUM} --body $(node -e "console.log(\"'\"+process.argv[1].replace(/'/g,\"'\\\\''\")+\"'\")" -- "Closing: the named target ${TPATH} no longer exists at ${INTEGRATION_REF} — this record's Acceptance Criteria has no remaining target. Filed by /claude-tweaks:dispatch (queue pull).")"
```

Replace the five comment lines at 581-585 with these three (the cut sentences — "Records stay in $DISPATCH_GROUPS; only bare drain's ranking skips them." and "Fail open: an unreadable claim or a failed fetch excludes nothing." — restate line 7's bullet word for word in meaning; nothing in `tests/` pins them, grep-verified):

```bash
# #3278: neighbour-in-flight pass. Neighbour: a linking Key File or a strong
# near-duplicate (isStrongNearDuplicate, #3520). Claim blobs chain one fetch via the first git-tip read.
# MCP transport: mcp-transport.md's neighbour-in-flight section replaces this pass.
```

Run `wc -c plugin/skills/dispatch/queue-pull-script.md`; expected at most 52,500 (about 52,440).

- [ ] **Step 4: Change the module and the test helper**

In `queue-pull.js` add a local `shQuote(s)` (POSIX single-quoting, the same rule as `queue-pull-oracle.js`'s `shQuote`: `'` → `'\''`, wrapped in `'…'`) and make `targetMissingProposal`'s comment line `` `gh issue comment ${num} --body ${shQuote(`Closing: … (queue pull).`)}` `` with the text unchanged; one comment line naming #5317 (the fence's node quoter). Re-anchor every `fence NNN` comment that cites a fence line after 583 by −2 (1135 `581-653`→`581-651`, 1169 `592`→`590`, 1184 `581-619`→`581-617`, 1223 `628`→`626`, 1225 `625`→`623`, 1228 `621-642`→`619-640`, 1259 `644-653`→`642-651`), reading each target line in the edited fence to confirm it names the cited code.

In `fenceTargetProposal`, before the existing unescaping, replace a `$(node -e "…" -- "TEXT")` substitution in the echo body with `shQuote(TEXT with ${NUM}/${TPATH}/${INTEGRATION_REF} substituted)`, and assert that line held exactly one such substitution, so the helper fails loudly if the fence's quoter changes shape.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node --test tests/bin-lib/dispatch/queue-pull.test.js` (foreground, timeout 1200000)
Expected: PASS, 0 failures (the existing AC2.1 fence-derived proposal test included). Quote the summary lines.

- [ ] **Step 6: Commit**

```bash
git -C "<worktree>" add plugin/skills/dispatch/queue-pull-script.md plugin/bin/lib/dispatch/queue-pull.js tests/bin-lib/dispatch/queue-pull.test.js
git -C "<worktree>" commit -F <message file>   # "Single-quote the target-missing Close proposal's gh comment body in the fence and the module — ... (refs #5317)"
```

### Task 2: Parity fixture with a hostile named-target path

**Role:** integration

**Files:**
- Modify: `tests/bin-lib/dispatch/queue-pull-fixtures.js` (new `SHostileTarget`, exported)
- Test: `tests/bin-lib/dispatch/queue-pull.test.js` (new oracle test after the `#5227 parity (AC1)` describe)

**Interfaces:**
- Consumes: `HOSTILE_DOC`, `runStagedComment`, `CLOSING_BODY` (Task 1).
- Produces: `SHostileTarget({ doc }) -> scenario` — `withRecord(S1({ parity: true }), ghRecord(9050, { body: `**Doc:** ${doc} | **Section:** fixture\n\n${withBody(9050)}`, labels: ['auto:build', 'ready', 'by:docs-health'] }))` (pick another free number if 9050 is used; `HOSTILE_DOC` is passed in so the fixture file does not import the test file).

- [ ] **Step 1: Write the test**

```js
describe('#5317 parity: a hostile named-target path', { skip: oracleSkip(), timeout: 600_000 }, () => {
  let pair;
  before(async () => { pair = await memoPair({ name: 'S1-hostile-target', scenario: SHostileTarget({ doc: HOSTILE_DOC }), transport: 'gh' }); });
  test('AC2: the script and the module stage byte-identical proposals, and the rest of the run matches', () => {
    assertClean(pair, 'S1-hostile-target');
    assert.equal(pair.oracle.status, 0, pair.oracle.stderr.slice(-3000));
    assertParity(pair.oracle, pair.module, { files: AC1_FILES });
    assert.equal(pair.module.staged['dispatch-target-missing-9050.md'], pair.oracle.staged['dispatch-target-missing-9050.md']);
  });
  for (const side of ['oracle', 'module']) {
    test(`AC1 (${side}): run by bash, the staged comment posts the path verbatim and runs nothing else`, () => {
      const run = runStagedComment(pair[side].staged['dispatch-target-missing-9050.md'], 9050);
      assert.equal(run.status, 0, run.stderr);
      assert.deepEqual(run.ghCalls, [['issue', 'comment', '9050', '--body', CLOSING_BODY(HOSTILE_DOC, 'origin/main')]]);
      assert.equal(run.idRan, false);
    });
  }
});
```

If `assertParity` normalizes staged text, the explicit raw `assert.equal` above is what pins the bytes.

- [ ] **Step 2: Run it against the pre-fix fence and module to see it red**

In a `git archive` extract of the commit before Task 1 (never a linked worktree), with this task's test and fixture copied in: the AC1 rows fail (`idRan: true`, split argv). Then on the branch head:

Run: `node --test --test-name-pattern "#5317" tests/bin-lib/dispatch/queue-pull.test.js` (foreground, timeout 1200000)
Expected: PASS for all three rows. Quote the summary lines.

- [ ] **Step 3: Commit**

```bash
git -C "<worktree>" add tests/bin-lib/dispatch/queue-pull-fixtures.js tests/bin-lib/dispatch/queue-pull.test.js
git -C "<worktree>" commit -F <message file>   # "Pin a hostile named-target path through the queue-pull parity oracle — ... (refs #5317)"
```

## Acceptance coverage

- AC1.1 (run by bash, the path reaches the comment verbatim and nothing else runs, on both the script and the module): Task 1 Step 1's `#5317 AC1 (module)` test and Task 2 Step 1's `AC1 (oracle)` / `AC1 (module)` rows, each running `runStagedComment` under real bash.
- AC2.1 (parity stays green, byte-identical proposals): Task 2 Step 1's `AC2` row plus the existing `#5227 parity (AC1)` matrix.

## Not changed (swept)

- A failing `node -e` quoter inside the fence's `echo` would stage `--body ` with no argument and the module has no such path. Out of scope: the same loop runs two `node -e` calls first (fence lines 440-441, `NUM`/`TPATH`), so a node that cannot start fails there before this line; no guard is added (plan review, low).

- `docs/superpowers/plans/2026-11-17-queue-pull-target-missing-md-5316.md` matches the scope keywords only as #5316's own finished plan; no change.

- `docs/reference/gh-issue-write-inventory.md:394` quotes the old line — a declared snapshot ("nothing tests it", fence line 492 already stale); no change.
- `docs/journeys/select-the-dispatch-queue-with-the-queue-pull-cli-5227.md` — updated by `/build` Common Step 6 (`/claude-tweaks:journeys`), not by a task.
- The shipped pass's Close proposal (fence 542-569) interpolates only numbers; no change.
