# Bare `--stamp-status` Declaration Discovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bare `verify.js --stamp-status` reads `.claude-tweaks/verify-scope.json` when it exists, so per-suite chunk composition (#3002) and the live generated-path exemption (#2987) reach every gate that reads the stamp.

**Architecture:** One change in `stampStatus` (`plugin/bin/verify.js`): when no `--scope` is passed, resolve the conventional declaration path against the checkout root and, when the file exists, feed it into the existing `scopeDecl` path exactly as an explicit `--scope` would. Dispatch's note-only `checkFirstCallStamp` accepts a complete composed verdict without a single stamp. Prose and docs that state "bare never composes" are corrected.

**Tech Stack:** Node 18+, `node --test`, markdown skill prose.

**Spec:** `.claude-tweaks/pipelines/2026-10-24T121315-spec-4006/work/4006-spec.md`

Scope keywords: --stamp-status, suiteComposed, liveGeneratedExempt, checkFirstCallStamp

## Global Constraints

- Default declaration path: `.claude-tweaks/verify-scope.json`, resolved via the existing `resolveScopePath(scope, process.cwd())` (checkout-root relative, #3017).
- An explicit `--scope` always wins over discovery.
- Missing default file: silent — `scopeError: null`, `suiteComposed: null`, `liveGeneratedExempt: null` (output identical to today).
- Default file present but unreadable/invalid: `scopeError` carries `readDeclaration`'s errors joined with `; `; `verifiedHead` falls back to the single stamp; exit stays 0.
- Foreign `--git-dir` with no `--scope`: no discovery, `scopeError: null`.
- `match` keeps its strict single-full-stamp meaning; only `verifiedHead` widens.
- `plugin/skills/test/verification.md` is 52,497 B against `RAIL_BYTES` 52,500 (`plugin/bin/lib/skill-audit/budgets.js`): its edit must leave it ≤ 52,497 B. `code-mode-steps.md` 49,225 B (3,275 B headroom), `two-call-gate.md` 18,563 B, `stamp-composition.md` 5,462 B.
- Keep `two-call-gate.md`'s fragment `no runner pass stamp verifies the first call` intact (pinned by `tests/log-decision-text-file-sites-conformance.test.js:133`).
- Commits: `{Verb} {what} — {detail}`, body ends with `Refs #4006` then `Claude-Session: https://claude.ai/code/session_01VQ5xwJKNNfTkMXnRsmxndL`. Stage files by explicit path.

## Review Focus

1. Bare `--stamp-status` run from a subdirectory of the checkout must still discover the root declaration (resolveScopePath, not bare cwd) — Task 1 test `discovery resolves from a subdirectory`.
2. A default declaration whose `generated` glob covers itself (`**`) is a `readDeclaration` error — bare status must report it in `scopeError`, exit 0, single-stamp verdict — Task 1 covers it under AC5.1's unreadable branch with a second fixture.
3. Per-suite records from an older sha must not verify a moved HEAD under discovery (previously only proven with explicit `--scope`) — Task 1 test `discovery never counts a stale-sha per-suite record`.
4. Dispatch reads the stamp from the worktree cwd — discovery must use that checkout's own declaration; covered by Task 1's cwd-relative resolution plus Task 2's existing default-spawn test (cwd = worktree).
5. A complete composition with a dirty tree outside `generated` must stay unverified under bare status — covered by existing `composeSuiteCoverage` semantics; Task 1 asserts it in the AC2.1-adjacent test `discovery with a non-generated dirty path stays unverified`.

---

### Task 1: Default-declaration discovery in `stampStatus`

**Files:**
- Modify: `plugin/bin/verify.js` (`stampStatus`, ~lines 150-270)
- Test: `tests/bin-lib/verify/cli.test.js`

**Interfaces:**
- Consumes: existing `resolveScopePath`, `scopeSelfPath`, `readDeclaration`, `composeSuiteCoverage`, `generatedExemption` (unchanged).
- Produces: `--stamp-status` JSON unchanged in shape; `suiteComposed`/`liveGeneratedExempt`/`scopeError` now populated from the discovered default declaration when no `--scope` is given. Task 2 and Task 3 rely on `verifiedHead: true` + `suiteComposed.complete: true` with `present: false` being a real output.

- [ ] **Step 1: Write the failing tests** (in `cli.test.js`, after `runStampSuiteChunk`; reuse `scopedRepo`, `tmpGitRepo`, `commitFile`, `runStampSuiteChunk`, `runCli`)

```js
test('AC1.1: bare --stamp-status composes two chunked per-suite records via the discovered default declaration', async () => {
  const r = scopedRepo([{ match: 'src/**', suites: ['unit'], static: true }]);
  await runStampSuiteChunk(r, `unit=${r.unitCmd}`);
  await runStampSuiteChunk(r, 'other=node -e 0');
  const s = JSON.parse((await runCli(['--stamp-status'], { cwd: r.repo })).stdout);
  assert.strictEqual(s.verifiedHead, true);
  assert.strictEqual(s.suiteComposed.complete, true);
  assert.strictEqual(s.match, false);
  assert.strictEqual(s.present, false);
  assert.strictEqual(s.scopeError, null);
});
test('AC2.1: bare --stamp-status with one of two chunks names the uncovered check', …) // verifiedHead false, suiteComposed.missing deepEqual ['other']
test('AC3.1: bare --stamp-status re-derives the generated exemption from the discovered declaration', …)
  // scopedRepo(..., { generated: ['dist/**'] }); commitFile dist/bundle.js; full scoped run → clean stamp; then write dist/bundle.js dirty;
  // bare: verifiedHead true, liveGeneratedExempt deepEqual ['dist/bundle.js']
test('AC4.1: bare --stamp-status in a repo with no declaration is unchanged', …)
  // tmpGitRepo + one full `--cmd tests="node -e 0"` pass: suiteComposed null, liveGeneratedExempt null, scopeError null, verifiedHead true, match true,
  // and Object.keys(s) deepEqual the 16-key list read from today's output shape (present … scopeError)
test('AC5.1: an unparseable default declaration reports scopeError, exits 0, and keeps the single-stamp verdict', …)
  // scopedRepo, full scoped pass (verifiedHead true), then overwrite .claude-tweaks/verify-scope.json with '{ not json' and commit it;
  // re-run a full pass is NOT needed — assert code 0, scopeError matches /could not parse JSON/, suiteComposed null;
  // second fixture: valid JSON whose generated is ['**'] → scopeError non-null (self-covering glob), exit 0
test('AC6.1: an explicit --scope composes against that path, not the default file', …)
  // scopedRepo; copy decl to .claude-tweaks/other.json declaring only `unit`; chunk unit only;
  // `--stamp-status --scope .claude-tweaks/other.json` → suiteComposed.declared ['unit'], complete true; bare → complete false
test('AC7.1: a foreign --git-dir with no --scope skips discovery silently', …) // suiteComposed null, scopeError null
test('AC9.1: review Step 1.5\'s literal stamp-status command reads verifiedHead:true on composed records', …)
  // extract the ```bash block under "### Standalone (outside `/claude-tweaks:flow`):" from plugin/skills/review/code-mode-steps.md via readText;
  // assert it equals 'node "${CLAUDE_PLUGIN_ROOT}/bin/verify.js" --stamp-status';
  // run it with spawnSync('sh', ['-c', cmd], { cwd: r.repo, env: { ...process.env, CLAUDE_PLUGIN_ROOT: <repo>/plugin } }) on the AC1.1 fixture → verifiedHead true
test('discovery resolves from a subdirectory of the checkout', …) // AC1.1 fixture, cwd = r.repo/src (mkdir) → complete true
test('discovery never counts a stale-sha per-suite record', …) // chunk both, commit a new file, bare → verifiedHead false, missing both
test('discovery with a non-generated dirty path stays unverified', …) // AC1.1 fixture + write notes.txt → verifiedHead false
```

Invert, do not delete, the two pins that encoded the old contract:
- `--stamp-status with no --scope never looks at per-suite records (suiteComposed: null)` (~line 1548): rename to `bare --stamp-status discovers the default declaration and composes per-suite records (#4006 inverts #3002's no-scope pin)` and assert `suiteComposed.complete === true`, `verifiedHead === true`.
- `bare` block in the #2987 AC1 test (~line 1392): assert `bare.dirty === true` (live tree), `bare.match === true` and `bare.verifiedHead === true` (the discovered exemption makes `effectiveDirty` false, so `stampCoversCleanHead` holds for this full stamp), and `bare.liveGeneratedExempt` deepEqual `['dist/bundle.js']`; rewrite the comment above it to say bare status now re-derives the exemption from the discovered declaration.

Sweep every other bare `['--stamp-status']` call in this file (lines ~340-748, 1177-1261, 2244, 2572, 2648): for each, note whether its fixture is `scopedRepo` (discovery now applies) and confirm the assertion still describes intended behavior; change only those that encoded "bare ignores the declaration".

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test --test-name-pattern="AC1.1: bare|AC3.1: bare|AC9.1" tests/bin-lib/verify/cli.test.js`
Expected: FAIL after Step 1 — `suiteComposed` is `null` / `verifiedHead` false under bare status (before Step 1 the pattern matches no test and exits 0; the tests are appended to an existing file)

- [ ] **Step 3: Implement discovery in `stampStatus`**

`scopePath`: `parsed.scope` resolved as today when given; else, when `!foreignGitDir`, `resolveScopePath('.claude-tweaks/verify-scope.json', process.cwd())` kept only if `fs.existsSync`, with `const discovered = true`. `scopeError` branches: the foreign-`--git-dir` and `no declaration at` messages fire only when `parsed.scope` was given; an unreadable discovered file reports `scopeRead.errors.join('; ')`. Update the `--scope read once` comment block to name the discovery rule. No change to `args.js`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/bin-lib/verify/cli.test.js tests/bin-lib/verify/args.test.js`
Expected: PASS (0 fail)

- [ ] **Step 5: Commit**

`git add plugin/bin/verify.js tests/bin-lib/verify/cli.test.js` then commit `Discover the default verify-scope declaration in bare --stamp-status — composed and generated-exempt verdicts now reach every gate`.

---

### Task 2: `checkFirstCallStamp` accepts a complete composed verdict

**Files:**
- Modify: `plugin/bin/lib/dispatch/first-call-artifact-check.js` (`checkFirstCallStamp` + header comment, ~lines 282-330)
- Test: `tests/bin-lib/dispatch/first-call-artifact-check.test.js`

**Interfaces:**
- Consumes: Task 1's status shape (`verifiedHead`, `suiteComposed.complete`).
- Produces: `{ verified: true, reason: null, status }` for a composed-only status; reason vocabulary unchanged.

- [ ] **Step 1: Write the failing tests** (beside the existing `AC2.1`/`AC1.1` stamp tests; `stampStub`, `stampRun` exist)

```js
test('AC8.1: a complete composed verdict with no single stamp verifies HEAD', () => {
  const status = { present: false, verifiedHead: true, reportPath: null, suiteComposed: { complete: true } };
  const result = checkFirstCallStamp({ runDir: stampRun({ worktree: '/wt' }) }, { stampStatus: stampStub(status).fn, exists: () => false });
  assert.deepEqual(result, { verified: true, reason: null, status });
});
test('AC8.1: no stamp and no composition is still stamp-absent', …) // { present:false, verifiedHead:false, suiteComposed:null } → 'stamp-absent'
test('AC8.1: a single stamp whose reportPath is gone is still report-missing', …) // { present:true, verifiedHead:true, reportPath:'/r.json', suiteComposed:null }, exists:()=>false
test('an incomplete composition does not bypass the single-stamp checks', …) // { present:false, verifiedHead:false, suiteComposed:{complete:false} } → 'stamp-absent'
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test --test-name-pattern="AC8.1: a complete composed" tests/bin-lib/dispatch/first-call-artifact-check.test.js`
Expected: FAIL after Step 1 — reason `stamp-absent` (appended to an existing file; the pattern matches nothing before Step 1)

- [ ] **Step 3: Implement** — after the `stamp-read-failed` return, `if (status.verifiedHead === true && status.suiteComposed && status.suiteComposed.complete === true) return { verified: true, reason: null, status };`. Add one sentence to the header comment naming the composed path (#4006).

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/bin-lib/dispatch/first-call-artifact-check.test.js`
Expected: PASS

- [ ] **Step 5: Commit** — explicit paths; `Accept a complete composed per-suite verdict in checkFirstCallStamp — no single stamp or reportPath needed`.

---

### Task 3: Shipped prose names the composed verdict as verified HEAD

**Files:**
- Modify: `plugin/skills/test/stamp-composition.md` (line 5's "a bare `--stamp-status` never does"; line 16's last sentence)
- Modify: `plugin/skills/test/verification.md` (line 187; optionally line 32 — net bytes ≤ 0)
- Modify: `plugin/skills/review/code-mode-steps.md` (Step 1.5, ~lines 74-91)
- Modify: `plugin/skills/dispatch/two-call-gate.md` (line 17 stamp-read paragraph)
- Create: `tests/stamp-status-discovery-prose-conformance.test.js`

**Interfaces:**
- Consumes: Task 1/2 behavior (discovery rule, composed acceptance).
- Produces: nothing code-level.

- [ ] **Step 1: Write the failing conformance test** (use `readText` from `tests/helpers/read-skill`)

```js
test('AC10.1: stamp-composition.md no longer says bare --stamp-status never composes', () => {
  assert.doesNotMatch(SC, /never looks at per-suite records/);
  assert.doesNotMatch(SC, /a bare `--stamp-status` never does/);
  assert.match(SC, /with no `--scope`[^.]*`\.claude-tweaks\/verify-scope\.json`/); // the discovery rule is stated
});
test('AC10.2: verification.md, review Step 1.5 and two-call-gate.md name the composed verdict as verified HEAD', () => {
  for (const [name, text] of [['verification.md', VER], ['code-mode-steps.md Step 1.5', step15(CMS)], ['two-call-gate.md', TCG]]) {
    assert.match(text, /suiteComposed/, `${name} must name the composed verdict`);
  }
  assert.doesNotMatch(VER, /treat `present: false`, `verifiedHead: false`/);
  assert.match(TCG, /no runner pass stamp verifies the first call/);
});
test('verification.md stays under the Read rail', () => { assert.ok(Buffer.byteLength(VER) <= 52497); });
```

`step15(text)` slices from `## Step 1.5: Test Gate` to `### QA Ledger Check`. Factor the AC10.2 assertions into one function reused by a go-red control that runs it on the text with `suiteComposed` removed and expects a throw.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/stamp-status-discovery-prose-conformance.test.js`
Expected: FAIL — `never looks at per-suite records` still present

- [ ] **Step 3: Edit the prose**
  - `stamp-composition.md`: line 5 — bare status now re-derives the exemption from the discovered declaration; line 16 — replace the last sentence with the discovery rule (default path, explicit `--scope` wins, missing file silent, unreadable reports `scopeError`, foreign `--git-dir` skips).
  - `verification.md` line 187: drop `` `present: false`, `` and add that `verifiedHead: true` covers a complete `suiteComposed` (`stamp-composition.md`); `wc -c` ≤ 52,497.
  - `code-mode-steps.md` Step 1.5: both branches' `verifiedHead: true` parentheticals gain "or by complete per-suite records (`suiteComposed`, `test/stamp-composition.md`)"; the Standalone failure bullet drops `present: false,` (a composed verdict has no single stamp). Pins to keep green: `tests/review-step1-5-verifiedhead-gate.test.js` matches `verifiedHead: true[\s\S]{0,260}proceed to Step 2` (today satisfied by the Standalone bullet at ~115 chars — the added clause must keep it ≤ 260), the printed envelope `{present, sha, head, dirty, scope, fullSha, match, verifiedHead, baselineAdjudicated, reportPath, legacy}` verbatim, and the Gate-table rows unchanged.
  - `verification.md`: `tests/bin-lib/verify/snippet-conformance.test.js` requires exactly one fenced `bin/verify.js --stamp-status` block — add none.
  - `two-call-gate.md` line 17: `verified: true` also covers a complete `suiteComposed` verdict with no single stamp or `report.json`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/stamp-status-discovery-prose-conformance.test.js tests/log-decision-text-file-sites-conformance.test.js tests/review-current-state-outcome-reach.test.js tests/review-step1-5-verifiedhead-gate.test.js tests/bin-lib/verify/snippet-conformance.test.js tests/dispatch-mechanical-enforcement.test.js`
Expected: PASS

- [ ] **Step 5: Commit** — explicit paths; `Name the composed per-suite verdict as verified HEAD in the stamp-reading gates' prose — bare --stamp-status now composes`.

---

### Task 4: Journey, skill-graph and the dispatched first call reflect discovery

**Files:**
- Modify: `docs/journeys/run-a-deterministic-verification-check.md` (Step 16 red flag ~line 194; Step 17 ~lines 197-201; change log ~line 233)
- Modify: `docs/skill-graph.md` (line 248 `checkFirstCallStamp` row)
- Modify: `plugin/skills/dispatch/task-prompt.md` (line ~221: the first call's own artifact is the pass stamp "and its `report.json`" — add that a complete `suiteComposed` verdict, whose per-suite records carry their own report paths, is the same artifact; 46,562 B, ample headroom; leave line ~366's `A runner-written pass stamp matching HEAD (\`verify.js --stamp-status\`) is the raw artifact` prefix untouched — pinned by `tests/review-ac-evidence-citation-prose.test.js`; `tests/dispatch-rederive-from-artifacts-conformance.test.js` pins `verifiedHead: true` there — keep it)

**Interfaces:** none.

- [ ] **Step 1: Write the failing check** — none committed; the Step 2 probe is the check (docs carry no conformance test of their own here).

- [ ] **Step 2: Run the probe to verify it fails**

Run: `node -e "const t=require('fs').readFileSync('docs/journeys/run-a-deterministic-verification-check.md','utf8'); if (/does not yet let them skip a re-run/.test(t)) { console.error('stale Step 17 sentence present'); process.exit(1) }"`
Expected: FAIL (exit 1, "stale Step 17 sentence present")

- [ ] **Step 3: Edit**
  - Step 16 red flag: replace "a bare `--stamp-status` reading `verifiedHead: true` over a tree the declaration says is regenerated" with its inverse: a bare `--stamp-status` reading `verifiedHead: false` when the only dirty paths match the discovered declaration's `generated` globs.
  - Step 17 URL: "once more with no `--scope`" stays; Should understand: replace the two stale sentences with: with no `--scope`, the runner reads `.claude-tweaks/verify-scope.json` when present and composes the same way, so the re-verify gates (`/test`'s Skip-if-recent, `/review` Step 1.5, a dispatched group's second-call stamp read, `/flow`'s preflight `stamp` probe) skip a re-run once composition is complete (#4006).
  - Change log: add `- Step 16 and Step 17 updated by #4006 (bare --stamp-status discovers .claude-tweaks/verify-scope.json; checkFirstCallStamp accepts a complete composed verdict) — a chunked or generated-regenerating project is no longer re-verified in full at every later gate.`
  - `skill-graph.md:248`: name `suiteComposed.complete` as a second verified path alongside `verifiedHead`/`reportPath`, and that a rename of `suiteComposed` must update `checkFirstCallStamp` too.

- [ ] **Step 4: Run the probe and the journey suites**

Run: `node -e "const t=require('fs').readFileSync('docs/journeys/run-a-deterministic-verification-check.md','utf8'); if (/does not yet let them skip a re-run/.test(t)) process.exit(1)"` then `node --test tests/skill-graph-dangling-pointer.test.js tests/skill-graph-table-structure.test.js` (no test reads this journey's text by name; the full suite at Common Step 5 covers the rest)
Expected: exit 0; PASS

Also run `node --test tests/review-ac-evidence-citation-prose.test.js tests/dispatch-rederive-from-artifacts-conformance.test.js` after the `task-prompt.md` edit — Expected: PASS.

- [ ] **Step 5: Commit** — explicit paths; `Update the verification journey, skill-graph and dispatched first-call prompt for bare --stamp-status discovery — Steps 16-17, the checkFirstCallStamp row, and the composed artifact`.

---

## Scope-keyword sweep classification (plan-audit Check B, scope-creep=add-to-plan)

Every file the sweep flagged was read; only `plugin/skills/dispatch/task-prompt.md` is a reader whose rule changes (added to Task 4). The rest need no edit:

| File | Disposition |
|---|---|
| `plugin/bin/lib/flow/preflight.js`, `tests/bin-lib/flow/preflight*.test.js`, `perf/flow-preflight-concurrency.test.js` | Spawns bare `--stamp-status`; gains discovery for free; tests assert key presence only |
| `plugin/bin/lib/verify/args.js`, `tests/bin-lib/verify/args.test.js`, `plugin/bin/lib/verify/stamp.js` | Parsing and stamp storage unchanged; `--scope` stays optional |
| `plugin/skills/test/SKILL.md:73`, `docs/journeys/clear-the-two-call-gate-for-a-dispatched-group-2775.md:65`, `docs/journeys/get-one-full-suite-run-on-a-docs-touching-build-3060.md`, `docs/journeys/adopt-a-run-directory-from-one-preflight-pack-1931.md` | State "`verifiedHead: true` → skip" — still exactly true; composed verdicts now reach it |
| `plugin/skills/dispatch/sequential-execution.md`, `plugin/skills/_shared/scratch-worktree.md:261`, `plugin/skills/specify/spec-template.md:70`, `docs/plugin-structure.md` | Cite the command or #3002 as an example/usage line; no rule changes |
| `tests/review-step1-5-verifiedhead-gate.test.js`, `tests/bin-lib/verify/snippet-conformance.test.js`, `tests/dispatch-mechanical-enforcement.test.js`, `tests/log-decision-text-file-sites-conformance.test.js`, `tests/review-current-state-outcome-reach.test.js`, `tests/review-ac-evidence-citation-prose.test.js`, `tests/dispatch-rederive-from-artifacts-conformance.test.js`, `tests/specify-consumer-facing-ac.test.js` | Content pins on prose this plan edits — run in Task 3/4 Step 4, kept green, not edited |
| `CHANGELOG.md`, `docs/superpowers/plans/2026-10-24-log-decision-text-file-migration.md` | Historical records; never rewritten |

---

## AC coverage

| Clause | Covered by |
|---|---|
| AC1.1–AC7.1, AC9.1 | Task 1 tests named by id |
| AC8.1 | Task 2 tests |
| AC10.1, AC10.2 | Task 3 conformance test |

Waived AC11.1: satisfied at shaping time — #4111 closed NOT_PLANNED on 2026-10-24 with a comment pointing at #4006; no code.
Waived AC12.1: `npm test` runs centrally at build Common Step 5 (runner-verified), not inside a task.
