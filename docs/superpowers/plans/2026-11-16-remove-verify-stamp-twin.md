# Remove the Bare-SHA Verify Stamp Twin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Delete the bare-SHA verification stamp twin (`{git-dir}/claude-tweaks-verify-pass`), its read fallback, the `deps.legacy` option, the `legacy` key of `verify.js --stamp-status`, the deprecation entry, and every sentence that describes the twin.

**Architecture:** `plugin/bin/lib/verify/stamp.js` keeps one stamp file, the JSON stamp. `writeStamp` writes only it and returns `{ jsonPath }`; `readStamp` returns the parsed JSON stamp or `null`. `plugin/bin/verify.js` stops passing the `legacy` option and stops printing the `legacy` status key. Four prose copies of the `--stamp-status` key list are aligned to the 15 keys the CLI prints.

**Tech Stack:** Node 18+ (CI runs Node 20), `node --test`, markdown skill files.

**Spec:** `.claude-tweaks/pipelines/2026-11-15T231016-spec-5534/work/5534-spec.md` (record #5534)

**Scope keywords:** STAMP_LEGACY_NAME, legacyPath, bare-SHA twin

## Global Constraints

- Search with `git grep -F`, `-w` or `-P` only. `git grep -E` with `\b` silently matches nothing on the maintainer's machine (spec Gotchas).
- One plain command per Bash call inside this worktree session: no `$(...)` around git, no compound git commands, no pipes into git.
- Non-goals, verbatim from the spec: do not remove `anchorOf`'s `sha` fallback (`stamp.js`, "It also serves a JSON stamp that has no `fullSha`"); do not delete bare-SHA files that already sit in existing checkouts' git directories; no change to what the JSON stamp contains, when it is written, or how `--scope` and `--changed-files` use it; do not change `verify.js`'s entry shape or move its CLI tests in-process; no conformance test comparing the four key lists.
- Leave history alone: `docs/incident-log.md`, `CHANGELOG.md`, archived run files, `docs/superpowers/plans`, and `tests/review-step1-5-verifiedhead-gate.test.js:24` (the hand-built pre-#1923 control string) are not edited.
- `tests/bin-lib/verify/changed-files.test.js:231-267` and `tests/bin-lib/verify/scope.test.js:109-110` keep their `legacy: true` fixtures and stay green; only their titles change (Task 3).
- Size rail: `plugin/skills/test/verification.md` is 52,038 B and `plugin/skills/review/code-mode-steps.md` is 52,358 B at base; the rail (`RAIL_BYTES`) is 52,500 B. Both edits must shrink or hold the file: measure with `wc -c` after editing (expected: verification.md about 200 B smaller, code-mode-steps.md 8 B smaller).
- Commit message style: `{Verb} {what} — {detail}`, ending with the trailer line `Claude-Session: https://claude.ai/code/session_016yg3zqn9o1W8UrrDBoVNAy`. Reference the record as `refs #5534`, never `fixes`.
- Scope and edit discipline: "Commit tests only where the task asks for them or the repo already keeps tests for this kind of change, sized like the neighboring test files; scratch checks stay scratch. Touch only what the task requires — a pre-existing bug you notice is a follow-up to report, not a fix to fold in, unless the task cannot work without it. Don't reformat or "improve" adjacent code; edit in place rather than rewrite when the result is the same."
- Governing project skill, `.claude/skills/removal-condition-execution/SKILL.md`, quoted verbatim:
  - "A condition usually names a check. … Run it and put the result in the PR. Past a sunset the removal proceeds regardless, so a hit is reported as abandoned state, not a blocker."
  - "Identifiers (the date, the step number, the guard's name) are what acceptance greps check. The concept the removed thing introduced has words of its own. … A test title is a string literal no assertion reads, so it stays green while wrong … List the framing words the removed thing used … and grep them across comments and string literals. Classify each hit: a historical mention stays."
  - "When a sentence covered the removed step and a survivor together, deleting the step can leave the survivor with a qualifier it never had. … Read each re-pointed sentence against the survivor's own conditions."
  - "A test that proves a section is excluded by asserting the removed text is absent passes vacuously once that text is deleted."
  - "Decide for each such behavior whether it goes with the removed thing or stays with a rewritten rationale, and say which in the spec."
  - Decision Framework rows: "a code comment, a test title, a test comment | rewrite; behavior unchanged unless the record says otherwise"; "a test assertion | re-anchor (a sentinel) or retarget (a pin), never only delete"; "`docs/incident-log.md`, `CHANGELOG.md`, archived run `work/*.md`, `docs/superpowers/plans/*` | leave: history, not live guidance".
- Other project skills that name these files add no rule this change can break: `gh-api-module-pattern/status-as-data.md` (`--stamp-status` exits 0 in every state — unchanged), `windows-checkout-test-parity` (fixture commands go through `nodeCmd` or the quote-free `node -e 0`; the new assertions compare file names from a directory listing, which carry no path separator), `skill-prose-conformance-tests` (the two regex pins in Task 2 keep their existing go-red control, `assertPinned`).

## Behaviours: what goes with the twin and what stays

| Behaviour | Verdict |
|---|---|
| The bare file is written beside the JSON stamp on a clean full pass | Goes |
| `readStamp` reads a lone bare file as `{sha, scope: 'full', legacy: true}` | Goes: a checkout whose only stamp is a bare-SHA file reads as having no stamp (intended, spec Technical Approach) |
| `--stamp-status` prints `legacy` | Goes |
| A stored stamp must carry `dirty: false` to cover a clean HEAD (`verify.js:347`) | Stays, on its own rationale: a stamp written against a dirty tree never proves a clean HEAD. Only the comment sentence about the bare stamp is removed |
| `anchorOf` falls back to `sha` | Stays: it serves a JSON stamp with no `fullSha` (`tests/bin-lib/verify/stamp.test.js`, "returns the JSON stamp as-is when sha is valid and fullSha is absent") |
| An unparseable JSON stamp reads as `null` | Stays; its test keeps a leftover bare file beside it to show the file is ignored |

## Evidence already recorded (controller, before any deletion)

- Recorded removal-condition check, run from the main checkout at `026e203f3`: `grep -rn 'claude-tweaks-verify-pass"' plugin/skills` → 1 hit, `plugin/skills/_shared/policy-deprecations.md:95`, the condition's own line. Expected result; no reader of the bare file exists. Output: `{run-dir}/evidence/removal-condition-check.txt`.
- Absence-grep controls, run at base `9a8f1e2d7`: `git grep -n -F "STAMP_LEGACY_NAME" -- plugin tests` matches 13 lines; `git grep -n -F "Bare-SHA verify stamp twin" -- plugin` matches 1 line; `git grep -n -i -F "legacy twin" -- plugin docs/plugin-structure.md docs/journeys` matches 4 lines (`plugin/bin/verify.js:1470`, `plugin/skills/test/verification.md:222`, `docs/plugin-structure.md:59`, `:221`). Each acceptance grep can therefore fail.
- Sole-site proofs, run at base: `git grep -n -F -e ".legacy" -e "legacyPath" -- plugin/bin` → only `stamp.js` and `verify.js:403`; `writeStamp(` has one caller, `plugin/bin/verify.js:1515`; no hook, script or workflow names the bare file.
- Key order printed by `node plugin/bin/verify.js --stamp-status --git-dir <empty dir>` at base: `present, sha, head, dirty, scope, fullSha, match, verifiedHead, baselineAdjudicated, preExistingAdjudicated, reportPath, legacy, suiteComposed, generatedExempt, liveGeneratedExempt, scopeError`.

**The 15-key list** every prose copy must carry after Task 2, in this order:

```
{present, sha, head, dirty, scope, fullSha, match, verifiedHead, baselineAdjudicated, preExistingAdjudicated, reportPath, suiteComposed, generatedExempt, liveGeneratedExempt, scopeError}
```

## Review Focus

1. A checkout whose only stamp is a leftover bare-SHA file: a `--scope` run must behave as a first run (`Scope: full`), not crash and not anchor on the bare sha. Test in Task 1 (CLI).
2. A leftover bare-SHA file beside a fresh JSON stamp: a passing full run must leave the leftover byte-identical (not rewritten, not deleted — spec Non-Goals). Test in Task 1 (unit and CLI).
3. An unparseable JSON stamp with a valid bare file beside it must still read as `null`. Existing test kept and retitled in Task 1.
4. A stray `claude-tweaks-verify-pass*` temp file left after a write: the directory-listing assertions catch any file sharing the prefix, not only the bare name. Covered by Task 1's `passStampFiles` helper.
5. A consumer of `--stamp-status` that lists keys: the four prose copies must equal what the CLI prints, checked by hand against real output once (Task 2), since no test compares them.

---

### Task 1: Remove the twin write and the bare-file read

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/verify/stamp.js` (header comment `:1-19`, `:27`, `writeStamp` `:76-100`, `readStamp` `:144-147`, exports `:150-152`)
- Modify: `plugin/bin/verify.js` (`:1469-1470` comment, `:1508-1515` comment and call)
- Modify: `tests/bin-lib/verify/cli-helpers.js` (new helper + export)
- Test: `tests/bin-lib/verify/stamp.test.js`
- Test: `tests/bin-lib/verify/cli.test.js`
- Test: `tests/bin-lib/verify/cli-baseline.test.js` (`:30`)
- Test: `tests/bin-lib/verify/cli-flaky-preexisting.test.js` (`:334`, `:347-349`)

**Interfaces:**
- Produces: `writeStamp(gitDir, stamp, deps = {})` returns `{ jsonPath }`; `deps.fsImpl` is the only option read. `readStamp(gitDir, fsImpl = fs)` returns the parsed JSON stamp or `null`. `stamp.js` exports `composeStamp, writeStamp, readStamp, anchorOf, STAMP_JSON_NAME` (no `STAMP_LEGACY_NAME`).
- Produces: `passStampFiles(gitDir)` exported from `tests/bin-lib/verify/cli-helpers.js`: `fs.readdirSync(gitDir).filter((f) => f.startsWith('claude-tweaks-verify-pass')).sort()`.
- Leaves for Task 2: `verify.js:403` still prints `legacy` (always `false` after this task), and `cli.test.js:325` still asserts it.

- [ ] **Step 1: Rewrite the unit tests in `tests/bin-lib/verify/stamp.test.js`**

Drop `STAMP_LEGACY_NAME` from the import. Add `const fs = require('fs');` and `const { tmpDir } = require('./cli-helpers');` (the real-directory test below needs both), and near the top `const LEFTOVER_BARE = 'claude-tweaks-verify-pass';` with the comment `// A bare-SHA file an older build left in a git dir. Nothing reads or writes it.`

Replace the test at `:49` (`writeStamp writes the JSON stamp and the legacy bare-SHA twin atomically`) with:

```js
test('AC2.1: writeStamp on an empty directory creates exactly one file and returns only jsonPath', () => {
  const dir = tmpDir();
  const stamp = composeStamp({
    report: REPORT, scope: 'full', fullSha: 'abc123', base: null, changedFiles: [],
    suitesRun: ['tests'], flakyRetried: [], reportPath: '/r.json', at: 't',
  });
  const out = writeStamp(dir, stamp);
  assert.deepStrictEqual(fs.readdirSync(dir), [STAMP_JSON_NAME]);
  assert.deepStrictEqual(Object.keys(out), ['jsonPath']);
  assert.strictEqual(out.jsonPath, path.join(dir, STAMP_JSON_NAME));
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(out.jsonPath, 'utf8')), stamp);
});
```

In the test at `:63` (pid-suffixed tmp file), delete the comment at `:75-78` and the three lines at `:82-85`; keep the two `jsonTmpWrite` assertions and add `assert.deepStrictEqual(writeCalls, [jsonTmpWrite], 'the JSON tmp file is the only write');`.

Replace the test at `:122` (`writeStamp with legacy:false …`) with:

```js
test('writeStamp leaves a leftover bare-SHA file untouched and writes only the JSON stamp', () => {
  const fsImpl = fakeFs({ [path.join('/g', LEFTOVER_BARE)]: 'lastfullsha\n' });
  const stamp = composeStamp({
    report: REPORT, scope: 'full', fullSha: 'abc123', base: null, changedFiles: [],
    suitesRun: ['tests'], flakyRetried: [], reportPath: '/r.json', at: 't',
  });
  const out = writeStamp('/g', stamp, { fsImpl });
  assert.deepStrictEqual(Object.keys(fsImpl.files).sort(), [path.join('/g', LEFTOVER_BARE), out.jsonPath].sort());
  assert.strictEqual(fsImpl.files[path.join('/g', LEFTOVER_BARE)], 'lastfullsha\n');
});
```

Retitle `:134` to `readStamp returns null when no stamp file exists`. In `:138` and `:147` swap `STAMP_LEGACY_NAME` for `LEFTOVER_BARE` and retitle them `readStamp reads the JSON stamp and ignores a leftover bare-SHA file` and `readStamp returns null on unparseable JSON, a leftover bare-SHA file beside it or not`.

Replace the two tests at `:170` and `:175` with one:

```js
test('AC3.1: readStamp returns null for a directory holding only a bare-SHA file', () => {
  const SHA = '0123456789abcdef0123456789abcdef01234567';
  assert.strictEqual(readStamp('/g', fakeFs({ [path.join('/g', LEFTOVER_BARE)]: `${SHA}\n` })), null);
});
```

Reword the comment at `:181-183` to `// #1922 review finding (low): the JSON branch enforces SHA_RE on sha and (when present) fullSha — fail toward absence rather than trusting an arbitrary JSON string.`

**Step 1, continued — add `passStampFiles` and retarget the CLI tests.**

In `tests/bin-lib/verify/cli-helpers.js`, add after `stampOf` and export it:

```js
// Every file in a git dir that shares the pass stamp's name prefix: the JSON stamp, plus
// anything that should not be there (a bare-SHA file, a stray tmp). Sorted for a stable compare.
const passStampFiles = (gitDir) => fs.readdirSync(gitDir).filter((f) => f.startsWith('claude-tweaks-verify-pass')).sort();
```

Import `passStampFiles` in the three CLI test files below. `STAMP` below means the literal `'claude-tweaks-verify-pass.json'`.

`tests/bin-lib/verify/cli.test.js`:

| Site | Change |
|---|---|
| `:232` title | `a passing full-set run writes the JSON stamp and no other stamp file (#1921 AC1)` |
| `:247` | `assert.deepStrictEqual(passStampFiles(gitDir), [STAMP]);` |
| `:251` title | `a failing run, a fail-fast skip, and --no-stamp write no stamp file (#1921 AC2, #1784)` |
| `:259-260` | one assertion: `assert.deepStrictEqual(passStampFiles(gitDir), [], \`stamp file written for ${JSON.stringify(args)}\`);` |
| `:275-276` | one assertion: `assert.deepStrictEqual(passStampFiles(gitDir), [], 'no stamp for a timed-out run');` |
| `:351-352` | one assertion: `assert.deepStrictEqual(passStampFiles(gitDir), [], 'no stamp for a moved tree');` |
| `:505-520` | replace the test with the two tests below (the first needs no new import) |
| `:610` title | `a passing full-set run on a DIRTY tree still writes the stamp, and --stamp-status reflects dirty:true, match:false (#1921 Gotchas)` |
| `:620` | `assert.deepStrictEqual(passStampFiles(gitDir), [STAMP]);` |
| `:654-663` | one assertion replacing all four: `assert.deepStrictEqual([passStampFiles(otherGitDir), passStampFiles(cwdGitDir)], [[], []], 'an explicit --git-dir run never stamps: not the redirected repo, not the invoking cwd\'s own');` |
| `:704`, `:707` | delete `bareSha1` and its assertion; add after `:706`: `assert.deepStrictEqual(passStampFiles(r.gitDir), [STAMP]);` |
| `:726-729` | `assert.deepStrictEqual(passStampFiles(r.gitDir), [STAMP], 'a none run writes no second stamp file');` |
| `:747-750` | `assert.deepStrictEqual(passStampFiles(r.gitDir), [STAMP], 'a scoped run writes no second stamp file');` |
| `:1119-1124` comment | replace `the legacy \`sha\`` with `the stamp's own \`sha\`` |

The two tests replacing `:505-520` (the first keeps the `--stamp-status --git-dir` coverage on a JSON stamp; the second is AC3's CLI half plus Review Focus 1 and 2):

```js
test('--stamp-status honors --git-dir naming the checkout\'s own git dir: a JSON stamp there is read and matches (#1921)', async () => {
  const { repo, git, gitDir } = tmpGitRepo();
  const head = git('rev-parse', 'HEAD').trim();
  fs.writeFileSync(path.join(gitDir, 'claude-tweaks-verify-pass.json'), JSON.stringify({
    sha: head, dirty: false, scope: 'full', fullSha: head, base: null, changedFiles: [], suitesRun: ['tests'],
    flakyRetried: [], reportPath: path.join(gitDir, 'report.json'), at: new Date().toISOString(),
  }));
  const { code, stdout } = await runCli(['--stamp-status', '--git-dir', gitDir], { cwd: repo });
  assert.strictEqual(code, 0);
  const s = JSON.parse(stdout);
  assert.strictEqual(s.present, true);
  assert.strictEqual(s.sha, head);
  assert.strictEqual(s.scope, 'full');
  assert.strictEqual(s.match, true, 'the checkout\'s own git dir is not a foreign --git-dir');
  assert.strictEqual(s.verifiedHead, true);
  assert.strictEqual(s.reportPath, path.join(gitDir, 'report.json'));
});

test('AC3.1: a git dir holding only a bare-SHA file has no stamp — --stamp-status reads present:false and a --scope run starts as full', async () => {
  const r = scopedRepo([{ match: 'src/**', suites: ['unit'], static: true }]);
  const head = r.git('rev-parse', 'HEAD').trim();
  const bare = path.join(r.gitDir, 'claude-tweaks-verify-pass');
  fs.writeFileSync(bare, `${head}\n`);
  const status = await runCli(['--stamp-status', '--git-dir', r.gitDir], { cwd: r.repo });
  assert.strictEqual(status.code, 0);
  assert.match(status.stdout, /"present":false/);
  const run = await runCli(['--scope', r.declPath, '--integration-branch', r.branch, '--cmd', `unit=${r.unitCmd}`, '--cmd', 'other=node -e 0'], { cwd: r.repo });
  assert.strictEqual(run.code, 0, run.stderr);
  assert.match(run.stdout, /^Scope: full/m);
  assert.strictEqual(fs.readFileSync(bare, 'utf8'), `${head}\n`, 'the leftover bare file is neither rewritten nor deleted');
  assert.deepStrictEqual(passStampFiles(r.gitDir), ['claude-tweaks-verify-pass', 'claude-tweaks-verify-pass.json']);
});
```

The first test keeps what the old `:505-520` test covered, the non-foreign branch of `stampStatus()` (`plugin/bin/verify.js:273-282`, `requestedGitDir === resolvedOwnGitDir`) with a stamp present, now on a JSON stamp. The foreign-directory case is already covered by the test at `cli.test.js:563`; leave that test alone.

`tests/bin-lib/verify/cli-baseline.test.js:30`: `assert.deepStrictEqual(passStampFiles(r.gitDir), ['claude-tweaks-verify-pass.json'], 'an adjudicated pass writes the JSON stamp and nothing else');`

`tests/bin-lib/verify/cli-flaky-preexisting.test.js`: retitle `:334` to end `… and the stamp carries the marker (#3129)`; replace `:347-349` (comment and assertion) with `assert.deepStrictEqual(passStampFiles(r.gitDir), ['claude-tweaks-verify-pass.json']);`.

- [ ] **Step 2: Run the tests and confirm they fail for the right reason**

Run: `node --test tests/bin-lib/verify/stamp.test.js`
Expected: FAIL — `AC2.1` (directory lists two files, `out` has `legacyPath`), the leftover-bare test, and `AC3.1` (returns a `legacy: true` object).

Run: `node --test tests/bin-lib/verify/cli.test.js tests/bin-lib/verify/cli-baseline.test.js tests/bin-lib/verify/cli-flaky-preexisting.test.js`
Expected: FAIL on the listing assertions after a clean full pass (`:232`, `:610`, the full→none→scoped test) and on `AC3.1`; the `[]` assertions and the two adjudicated-pass assertions already pass (the twin was never written on those paths).

- [ ] **Step 3: Edit `plugin/bin/lib/verify/stamp.js`**

- Header comment: replace `:4-19` so it says JSON is the only stamp file; `readStamp` returns the parsed stamp, or `null` when the file is absent, unparseable, or carries a malformed `sha`, `fullSha`, `baseline`, `preExisting`, `generatedExempt` or `source`/`ci` — fail toward absence, like `count-stamp.js`; keep the `anchorOf()` sentence. No mention of a twin, a bare file, `deps.legacy`, or a fallback order.
- Delete `STAMP_LEGACY_NAME` (`:27`) and remove it from `module.exports`.
- `writeStamp`: delete `:78`, `:80`, `:94-98`; return `{ jsonPath }`. In the comment at `:81-88` delete the last sentence (`The legacy bare-SHA twin write just below is untouched …`).
- `readStamp`: when `jsonText === null`, `return null`; delete `:144-147`. Simplest shape: `catch { return null; }` on the read, then the existing parse block un-nested or left nested — pick the smaller diff.
- `anchorOf` comment (`:102-107`): replace `else the legacy sha` with `else its sha (a stamp with no fullSha)`.

- [ ] **Step 4: Edit `plugin/bin/verify.js`**

- `:1515`: `try { writeStamp(gitDir, stamp); } catch { /* best-effort; next --stamp-status simply reads absent */ }`
- Delete the comment block `:1508-1514`.
- `:1469-1470`: `// #3757: a moved tree (treeMoved above) writes no pass stamp — the checks cannot be credited to either snapshot.`

- [ ] **Step 5: Run the tests and confirm they pass**

Run: `node --test tests/bin-lib/verify/stamp.test.js tests/bin-lib/verify/cli.test.js tests/bin-lib/verify/cli-baseline.test.js tests/bin-lib/verify/cli-flaky-preexisting.test.js`
Expected: PASS, 0 failures. Quote the runner's `# tests`, `# pass`, `# fail` lines in your report.

Run: `git grep -n -F "STAMP_LEGACY_NAME" -- plugin tests`
Expected: no output (AC1.1).

- [ ] **Step 6: Prove the retargeted assertions go red (two mutations, then restore)**

Mutation M1 — in `stamp.js` `writeStamp`, immediately before `return { jsonPath };`, temporarily add: `fsImpl.writeFileSync(path.join(gitDir, 'claude-tweaks-verify-pass'), \`${stamp.sha}\n\`);`
Run: `node --test tests/bin-lib/verify/stamp.test.js tests/bin-lib/verify/cli.test.js tests/bin-lib/verify/cli-baseline.test.js tests/bin-lib/verify/cli-flaky-preexisting.test.js`
Expected: FAIL in every test whose assertion follows a written stamp: `AC2.1`, the pid-suffixed-tmp test (`writeCalls`), the leftover-bare unit test (content rewritten), `cli.test.js` `:232`, `:610`, the full→none→scoped test, `cli-baseline.test.js`'s adjudicated pass, `cli-flaky-preexisting.test.js`'s `preExisting` test. Remove the line.

Mutation M2 — in `verify.js`, immediately before the stamp gate (`if (\n    effectivePass && fullSet && !parsed.noStamp …`), temporarily add: `if (gitDir) { try { fs.writeFileSync(path.join(gitDir, 'claude-tweaks-verify-pass'), 'x\n'); } catch { /* mutation */ } }`
Run: `node --test tests/bin-lib/verify/cli.test.js`
Expected: FAIL in the tests whose assertion is `[]` — the failing/fail-fast/`--no-stamp` loop, the `--cmd-timeout` test, the moved-tree test, the `--git-dir` run test — and in `AC3.1`'s CLI test (the leftover file's content changes). Other listing assertions go red too; that is fine. Remove the line.

Then run `git diff --stat -- plugin/bin/lib/verify/stamp.js plugin/bin/verify.js` and read the diff to confirm neither mutation line remains, and re-run Step 5's first command (expected: PASS). In your report, list for each mutation the names of the tests that went red, copied from the runner's `not ok` lines. A retargeted assertion that stayed green under both mutations is a finding: name it.

- [ ] **Step 7: Commit**

```bash
git add plugin/bin/lib/verify/stamp.js plugin/bin/verify.js tests/bin-lib/verify/cli-helpers.js tests/bin-lib/verify/stamp.test.js tests/bin-lib/verify/cli.test.js tests/bin-lib/verify/cli-baseline.test.js tests/bin-lib/verify/cli-flaky-preexisting.test.js
git commit -m "Remove the bare-SHA verify stamp twin — writeStamp writes only the JSON stamp, readStamp has no bare-file fallback (refs #5534)" -m "Claude-Session: https://claude.ai/code/session_016yg3zqn9o1W8UrrDBoVNAy"
```

(Two separate Bash calls.)

---

### Task 2: Remove the `legacy` key from `--stamp-status` and align the four key lists

**Role:** integration

**Files:**
- Modify: `plugin/bin/verify.js` (`:344-346` comment, `:403`)
- Modify: `plugin/bin/lib/verify/changed-files.js` (`:38` comment)
- Modify: `plugin/skills/review/code-mode-steps.md` (`:75`)
- Modify: `plugin/skills/test/verification.md` (`:34`)
- Modify: `docs/plugin-structure.md` (`:221`, the key list only)
- Modify: `docs/journeys/run-a-deterministic-verification-check.md` (`:82`, the key list only)
- Test: `tests/bin-lib/verify/cli.test.js` (`:325`)
- Test: `tests/bin-lib/verify/cli-stamp-discovery.test.js` (`:154-157`)
- Test: `tests/review-step1-5-verifiedhead-gate.test.js` (`:32`, `:44`)

**Interfaces:**
- Consumes: Task 1's `readStamp` (never returns a `legacy` property).
- Produces: `verify.js --stamp-status` prints the 15 keys in the plan header's order; every other key and its order is unchanged.

- [ ] **Step 1: Update the tests**

- `tests/bin-lib/verify/cli-stamp-discovery.test.js:154-157`: remove `'legacy', ` from the key-order array. Leave the test's title alone (its `AC4.1:` prefix is #4006's criterion, not this record's) and add this comment above the array: `// #5534 AC4.2: the 15 keys, in print order; no \`legacy\`.`
- `tests/bin-lib/verify/cli.test.js:325`: replace `assert.strictEqual(m.legacy, false);` with `assert.ok(!('legacy' in m), '#5534 AC4.1: --stamp-status prints no legacy key');`
- `tests/review-step1-5-verifiedhead-gate.test.js:32` and `:44`: in both regexes remove `legacy, ` so they pin the 15-key list. Leave `:24` (history).

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `node --test tests/bin-lib/verify/cli-stamp-discovery.test.js tests/review-step1-5-verifiedhead-gate.test.js tests/bin-lib/verify/cli.test.js`
Expected: FAIL — the key-order `deepStrictEqual`, the `!('legacy' in m)` assertion, and the two `assertPinned` envelope tests.

- [ ] **Step 3: Edit the code**

- `plugin/bin/verify.js:403`: delete the `legacy:` line.
- `plugin/bin/verify.js:344-346`: delete the sentence `A legacy bare-SHA stamp carries no dirty field at all — undefined is "not false", so it can never prove the tree was clean when it was recorded either (review finding, refs #1921).` and keep the rest of the comment; end it `… once the edit is discarded (review finding, refs #1921).`
- `plugin/bin/lib/verify/changed-files.js:38`: `// anchor (stamp.js's anchorOf: fullSha, or sha for a stamp with no fullSha) when — and`

- [ ] **Step 4: Edit the four key lists**

Replace each list with the 15-key list from the plan header, byte for byte:

- `plugin/skills/review/code-mode-steps.md:75` (16 keys today; remove `legacy, `).
- `plugin/skills/test/verification.md:34` (11 keys today).
- `docs/plugin-structure.md:221` (15 keys today, has `legacy`, lacks `preExistingAdjudicated`). This line is about 9 KB long: edit with an exact-string replacement of the `{present, … scopeError}` list only, never by rewriting the line.
- `docs/journeys/run-a-deterministic-verification-check.md:82` (11 keys today).

- [ ] **Step 5: Run the tests and check the lists against the CLI**

Run: `node --test tests/bin-lib/verify/cli-stamp-discovery.test.js tests/review-step1-5-verifiedhead-gate.test.js tests/bin-lib/verify/cli.test.js`
Expected: PASS.

Run: `git grep -n -o -P "\{present, sha, head[^}]*\}" -- plugin docs/plugin-structure.md docs/journeys`
Expected: four lines, each printing the identical 15-key list (AC6.1).

Hand check for AC6.2, once: make an empty scratch directory outside the repo, run `node plugin/bin/verify.js --stamp-status --git-dir <that dir>`, and compare the printed JSON's key order with the list. Quote the printed line in your report.

Run: `wc -c plugin/skills/test/verification.md plugin/skills/review/code-mode-steps.md`
Expected: code-mode-steps.md 52,350 B; verification.md at most 52,500 B (it grows by about 75 B here and shrinks in Task 3).

- [ ] **Step 6: Commit**

```bash
git add plugin/bin/verify.js plugin/bin/lib/verify/changed-files.js plugin/skills/review/code-mode-steps.md plugin/skills/test/verification.md docs/plugin-structure.md docs/journeys/run-a-deterministic-verification-check.md tests/bin-lib/verify/cli.test.js tests/bin-lib/verify/cli-stamp-discovery.test.js tests/review-step1-5-verifiedhead-gate.test.js
git commit -m "Remove the legacy key from --stamp-status — align the four key lists to the 15 keys the CLI prints (refs #5534)" -m "Claude-Session: https://claude.ai/code/session_016yg3zqn9o1W8UrrDBoVNAy"
```

---

### Task 3: Delete the deprecation entry and the twin prose; sweep the framing words

**Role:** judgment

**Files:**
- Modify: `plugin/skills/_shared/policy-deprecations.md` (`:91-96`)
- Modify: `plugin/skills/test/verification.md` (`:208`, `:222`, `:226`)
- Modify: `docs/plugin-structure.md` (`:59` three fragments, `:221` three fragments)
- Modify: `docs/journeys/run-a-deterministic-verification-check.md` (`:89`, `:126`)
- Modify: `tests/bin-lib/verify/snippet-conformance.test.js` (`:184` message)
- Modify: `tests/bin-lib/verify/changed-files.test.js` (`:231`, `:262` titles)
- Modify: `tests/bin-lib/verify/scope.test.js` (`:109` title)

**Interfaces:**
- Consumes: Tasks 1 and 2 (the code no longer writes, reads or reports the twin).
- Produces: the sweep verdict table (Step 6), which the controller copies to `{run-dir}/evidence/framing-sweep-verdicts.md` and posts to the pull request.

- [ ] **Step 1: Delete the deprecation entry**

In `plugin/skills/_shared/policy-deprecations.md` delete the heading `## Bare-SHA verify stamp twin — claude-tweaks-verify-pass (#1921)`, its two paragraphs, and one of the two blank lines around it, so `## \`worktree.always\` …`'s `Removal condition:` paragraph is followed by one blank line and then `## Dispatch-call discriminator sessionId fallback — task-call.js (#3711)`. Do not touch `:87`/`:89` (`transitional twin` there is the `worktree.always` entry's own).

- [ ] **Step 2: Edit `plugin/skills/test/verification.md`**

- `:208`: delete ` (no legacy bare-SHA twin)`.
- `:222`, four clauses:
  1. delete `, plus (for this release only — removal condition in \`_shared/policy-deprecations.md\`) the legacy bare-SHA twin \`{git-dir}/claude-tweaks-verify-pass\``, leaving `…bound to the \`report.json\` it summarizes.`
  2. `only a \`full\` run sets \`scope: "full"\`, \`base: null\`, and rewrites the legacy twin.` → `only a \`full\` run sets \`scope: "full"\` and \`base: null\`.`
  3. `…adds \`baseline: {base, baseSha, baselineFailing, flakyPassed}\` and never rewrites the legacy twin.` → `…adds \`baseline: {base, baseSha, baselineFailing, flakyPassed}\`.`
  4. `…adds \`preExisting: {declared, matched}\` under the same rule.` → `…adds \`preExisting: {declared, matched}\`.` ("the same rule" was the twin rule; the sentence would otherwise inherit a qualifier that no longer exists.)
- `:226`: `into either stamp file` → `into the stamp file`; `leaves both files untouched` → `leaves the stamp untouched`.

- [ ] **Step 3: Edit `docs/plugin-structure.md` and the journey**

Exact-string replacements only (both lines are several KB long):

`docs/plugin-structure.md:59`
- `for {git-dir}/claude-tweaks-verify-pass.json plus its one-release legacy bare-SHA twin, rewritten only by a full run via writeStamp's \`deps.legacy\`; JSON-first read with fail-toward-absence fallback; the JSON stamp's own write goes through ../atomic-write.js's writeFileAtomic, #2004 — the legacy twin keeps its own separate plain-\`.tmp\` write, untouched)` → `for {git-dir}/claude-tweaks-verify-pass.json; a missing, unparseable or malformed stamp reads as absent; the write goes through ../atomic-write.js's writeFileAtomic, #2004)`
- `the stamp's fullSha (or sha for a legacy stamp) canonicalized` → `the stamp's fullSha (or sha for a stamp with no fullSha) canonicalized`

`docs/plugin-structure.md:221`
- ` (the legacy bare-SHA twin is rewritten only by a full run, never a scoped/tool-scoped/none one)` → delete (keep one space before `or HEAD moved`).
- `a changed sha writes neither stamp file and prints` → `a changed sha writes no pass stamp and prints`
- `with a baseline-marked pass stamp (no legacy twin) and` → `with a baseline-marked pass stamp and`

`docs/journeys/run-a-deterministic-verification-check.md`
- `:89`: `and only a \`full\` run rewrites the legacy bare-SHA twin or the #881 count stamp.` → `and only a \`full\` run rewrites the #881 count stamp.`
- `:126`: `The stamp gains a \`baseline\` key (no legacy bare-SHA twin), and` → `The stamp gains a \`baseline\` key, and`

- [ ] **Step 4: Test titles and the absence sentinel**

- `tests/bin-lib/verify/changed-files.test.js:231`: `resolveBase uses stamp.sha as the anchor for a stamp that carries no fullSha, canonicalized via rev-parse (finding 11)`; `:262`: `usableAnchor falls back to stamp.sha for a stamp with no fullSha`. Fixtures unchanged.
- `tests/bin-lib/verify/scope.test.js:109`: `a stamp with no fullSha anchors on its sha`. Fixture unchanged.
- `tests/bin-lib/verify/snippet-conformance.test.js:184`: the regex `/>\s*"?\$\(git rev-parse --git-dir\)\/claude-tweaks-verify-pass/` still anchors on text that can appear — the JSON stamp's path starts with the same characters. Prove it once with a scratch one-liner (not committed) showing the regex matches `> "$(git rev-parse --git-dir)/claude-tweaks-verify-pass.json"`, quote the result in your report, and change only the message to `'a redirect into the stamp file remains'`.

- [ ] **Step 5: Run the acceptance greps and the affected suites**

Run: `git grep -n -F "Bare-SHA verify stamp twin" -- plugin`
Expected: no output (AC5.1).

Run: `git grep -n -i -F "legacy twin" -- plugin docs/plugin-structure.md docs/journeys`
Expected: no output (AC5.1).

Run: `node --test tests/policy-deprecations-pin.test.js tests/bin-lib/verify/snippet-conformance.test.js tests/bin-lib/verify/changed-files.test.js tests/bin-lib/verify/scope.test.js tests/review-step1-5-verifiedhead-gate.test.js`
Expected: PASS.

Run: `wc -c plugin/skills/test/verification.md`
Expected: below 52,038 B.

- [ ] **Step 6: Sweep the framing words and write the verdict table**

Run each of these, one command per call, and save nothing but your classification:

```
git grep -n -i -F -e "bare-SHA" -e "bare SHA" -e "legacy stamp" -e "either stamp file" -e "both files" -e "claude-tweaks-verify-pass" -- plugin docs tests .claude/skills ':!docs/incident-log.md' ':!docs/superpowers/plans' ':!docs/plans/*-ledger.md'
git grep -c -i -F -e "twin" -- plugin docs tests .claude/skills ':!docs/incident-log.md' ':!docs/superpowers/plans' ':!docs/plans/*-ledger.md'
git grep -n -i -F -e "twin" -- plugin/bin/verify.js plugin/bin/lib/verify plugin/skills/test plugin/skills/review plugin/skills/_shared/policy-deprecations.md docs/plugin-structure.md docs/journeys/run-a-deterministic-verification-check.md tests/bin-lib/verify tests/review-step1-5-verifiedhead-gate.test.js .claude/skills/removal-condition-execution
```

Pipe long lines through `cut -c1-240` (several hit lines are multi-KB).

Write the table with the Write tool to `/private/tmp/claude-501/-Users-thomasholknielsen-Code-Workspaces-claude-tweaks/9cc85f8f-fd5f-420a-918a-da262e1b61f8/scratchpad/framing-sweep-verdicts.md` (the Write tool refuses the run directory from a worktree session; the controller copies the file into the evidence path). If that write is refused too, return the table's full text in your report and say so. Its content:

1. The three commands above, verbatim.
2. A table `| File:line | Phrase | Verdict | Note |` with one row per hit of every phrase except `twin`, and one row per `twin` hit in the third command's paths. Verdicts: `remove`, `reword`, `keep (history)`, `keep (unrelated)`. After Tasks 1-3 no row may carry `remove` or `reword` still pending: apply it, then record what you did.
3. For `twin` hits outside the third command's paths: one row per file from the `-c` output, `| File | N hits | keep (unrelated) | {the concept the word names there, e.g. "prose-code twin", "sync/async twin", "transitional policy-key twin"} |`. About 250 files; a file whose `twin` you cannot name from its path alone, open it and look. Any stamp-related hit found this way gets its own row in table 2 and is fixed.

A hit in code or prose that has nothing to do with the verify stamp is `keep (unrelated)` and is not edited. `.claude/skills/removal-condition-execution/SKILL.md`'s `transitional twin` is that skill's vocabulary: `keep (unrelated)`.

- [ ] **Step 7: Commit**

```bash
git add plugin/skills/_shared/policy-deprecations.md plugin/skills/test/verification.md docs/plugin-structure.md docs/journeys/run-a-deterministic-verification-check.md tests/bin-lib/verify/snippet-conformance.test.js tests/bin-lib/verify/changed-files.test.js tests/bin-lib/verify/scope.test.js
git commit -m "Delete the verify stamp twin's deprecation entry and prose — reword the sentences and test titles that leaned on it (refs #5534)" -m "Claude-Session: https://claude.ai/code/session_016yg3zqn9o1W8UrrDBoVNAy"
```

Add any further file the sweep made you edit to the `git add`, and name it in your report.

---

## Controller evidence (after the tasks, not a dispatched task)

The controller writes one `AC evidence` entry per scratch check to the run's `decisions.md` (`log-decision.js --section "/build" --status AUTO --step "AC evidence" --text-file …`) with the full output under `{run-dir}/evidence/`: the recorded removal-condition check (`removal-condition-check.txt`, already saved), Task 1 Step 6's go-red proof (`go-red-proof.txt`), Task 2 Step 5's AC6.2 hand check (`stamp-status-keys.txt`), and Task 3 Step 6's verdict table (`framing-sweep-verdicts.md`). It then posts the removal-condition command with its hit count and the verdict table to pull request #5578.

## Acceptance-criteria coverage

| Criterion | Where |
|---|---|
| AC1.1 | Task 1 Step 5 grep; control recorded above |
| AC1.2 | The absence-grep control recorded above (13 matching lines at base, `stamp.js:27` among them) |
| AC2.1 | Task 1 Step 1, test `AC2.1: writeStamp on an empty directory…` |
| AC3.1 | Task 1 Step 1 (`readStamp`, and the CLI test's `"present":false`) |
| AC4.1 | Task 2 Step 1, `cli.test.js` `!('legacy' in m)` |
| AC4.2 | Task 2 Step 1, `cli-stamp-discovery.test.js` key-order array |
| AC5.1 | Task 3 Step 5 greps; controls recorded above |
| AC5.2 | Task 3 Step 6 verdict table, posted to the pull request by the controller |
| AC6.1 | Task 2 Step 5 `git grep -o -P` over the four lists |
| AC6.2 | Task 2 Step 5 hand check against real CLI output |
| AC7.1 | `/claude-tweaks:build` Common Step 5 (`npm test -- --full` through the verification runner), not a plan task |

Waived .claude/skills/removal-condition-execution/SKILL.md: read only — its rules are quoted in Global Constraints, and Task 3 Step 6 classifies its `twin` hits as that skill's own vocabulary.
