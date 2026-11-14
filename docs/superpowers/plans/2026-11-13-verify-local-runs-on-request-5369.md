# verify.js `localRuns: "on-request"` Implementation Plan (#5369)

**Goal:** A `localRuns: "on-request"` key in `.claude-tweaks/verify-scope.json` makes `verify.js` take CI-declared suites from the PR's CI job and run them on this machine only with a new `--local` flag. A scoped run that CI cannot answer exits 3 ("no verdict yet"), and an unscoped run that names a CI-declared suite without `--local` exits 2.

**Architecture:** `declaration.js` validates the key. `args.js` parses `--local` and exports the exit-3 constant. `ci-source.js` downloads the job log with `--allow-escape-sequences` (one retry without it for an older `gh`) and, under the key, turns a red job with no log into a CI failure instead of a fallback. `verify.js` acts on all of it inside its existing CI loop (`plugin/bin/verify.js` lines 861-888) and before the slot is taken, records it in the `verify` event, and `timing/derive.js` copies the new event fields into `timing.json`. Docs and one new prose-conformance suite close it out.

**Tech Stack:** Node 18+ CommonJS, `node --test`, `gh` REST through the injectable runner seam.

**Spec:** `/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude/worktrees/flow+spec-5319-5369-5370/.claude-tweaks/pipelines/2026-11-13T132412-spec-5319-5369-5370/spec-5369/work/5369-spec.md`

Scope keywords: localRuns, on-request, --local, EXIT_NO_VERDICT, local-requested, allow-escape-sequences, logUnavailable, fetchCiVerdict, readDefaultDeclaration, noVerdict, ci-log-unavailable, head-not-pushed

Risk flags: the spec carries no `Risk-flags:` line, so plan-audit Check G has nothing to prove and this plan carries no proof lines.

## Premises checked against HEAD (the spec's stamp is 25 commits behind)

- `fetchCiVerdict` downloads the log at `plugin/bin/lib/verify/ci-source.js:152` with `gh(['api', 'repos/{owner}/{repo}/actions/jobs/${id}/logs'], LOG_TIMEOUT_MS)`, and a failed red-job download returns `fallback('ci-log-unavailable')` (line 157). Confirmed.
- Live probe (run once while authoring, read-only, gh 2.103.3, job 132101098257 of test.yml run 43487351615): `gh api "repos/{owner}/{repo}/actions/jobs/132101098257/logs"` exits 1 with stderr `the response contains terminal escape sequences; pass --allow-escape-sequences to output it anyway`. The same call with `--allow-escape-sequences` appended exits 0 and writes 9,982,259 bytes, well under `LARGE_MAX_BUFFER_BYTES`. `gh api --help` lists `--allow-escape-sequences`. An unknown flag prints `unknown flag: --output-file` (probed with that flag), so the older-gh retry matches `unknown flag: --allow-escape-sequences`.
- `readDeclaration` has no unknown-top-level-key check (`declaration.js` lines 153-156 say so for `ci`), so a reader older than `localRuns` ignores it. Confirmed.
- An unscoped run reads the default declaration only through `defaultConcurrency` (`verify.js` line 191), and a nested run (`CT_TEST_SUITE_SLOT_HELD=1`) skips that read (line 795). The unscoped refusal therefore needs its own read, which this plan memoizes so the `concurrency ignored` stderr line still prints at most once.
- Branch #5319 changes nothing on these paths. `tools/run-tests.js` reads the declaration for `impact` only, and `checkoutImpactContext` (`plugin/bin/lib/verify/impact.js:322`) is not touched.
- Spec claim "The `verify` event, and through it `timing.json`'s verify entry": `timing.json`'s verify rows are hand-copied field by field at `plugin/bin/lib/timing/derive.js:239`. The new event fields reach `timing.json` only if that line copies them (Task 4).

## Global Constraints

- Key name and value, verbatim from the spec: a top-level `localRuns` key with the one value `"on-request"`, valid only together with a `ci` block. Without the key nothing changes.
- Exit 3 is new. It means "no verdict yet" and is never a test failure. It writes no pass stamp. This plan also writes no `report.json` on exit 3, because `composeReport` over zero checks reads `pass: true`, and a consumer reading that file would take it as a pass. For the same reason exit 3 removes a `report.json` an earlier run left at the run's report path (`jsonPath`, the default or `--json`): a consumer must never read a previous run's report as this run's answer. A missing file is not an error.
- The spec's three `**Decision**` paragraphs bind this plan: (1) only an unscoped run naming a CI-declared suite exits 2; (2) a `--stamp-suite` chunk of a CI-declared suite exits 2 without `--local`, never consults CI, and runs here as today with `--local`; (3) a CI-declared suite never runs on this machine without `--local`, everything else behaves as without the key, and exit 3 is decided before any check or retry starts.
- Without the key, a run without `--local` behaves exactly as before, including the local fallback when CI cannot answer. No existing test changes its expected output (AC4). Two consequences:
  - `parseArgs` adds `local: true` to its result only when `--local` was passed, so `tests/bin-lib/verify/args.test.js`'s whole-object `deepStrictEqual` (line 18) stays green. `--cmd-env`'s `env` key sets the precedent.
  - `fetchCiVerdict` adds `logUnavailable: true` to its `ci` object only in the new under-the-key case.
- `gh-api-module-pattern`, quoted: "Tests never touch real `gh`: fake runners branch on the `args` shape (`isGraphQL`, `isPost`-style lazy helpers) and `throw new Error('unexpected ' + args.join(' '))` on anything unhandled — a wrong endpoint fails loudly instead of passing silently. Record values inside the runner, assert after it returns (an `AssertionError` thrown *inside* a runner can be swallowed by the module's own try/catch)."
- `gh-api-module-pattern`, quoted: "**Every `gh` spawn wraps its options in `plugin/bin/lib/repo-resolve.js`'s `ghOptions(args, …)`.**" The retry goes through the same `gh` closure, so it inherits `defaultRunner`'s wrap. "**Bound every remote-contacting call on the seam; a local-only call owes no bound.**" The retry passes `LOG_TIMEOUT_MS` too. "**The quiet posture is owed by any call the module catches and recovers from** … and a catch that reads the error text needs stderr `'pipe'`, not `'ignore'`." `defaultRunner` already pipes stderr, and the retry reads `err.stderr`.
- `gh-api-module-pattern`, quoted: "**A fake `gh` that returns a fixed full row ignores the `--json` field list, so a test using it cannot see the list shrink.** When a module's correctness depends on a field it requests, assert the recorded argv". The flag is pinned by asserting the recorded argv exactly, with a fake that refuses the call without it.
- `verify-scope-rule-kind`, quoted: "**Every site that reads the declaration knows the new shape.** `declaration.js` (validation and the parsed rule shape), `scope.js` (selection and mode), `plugin/bin/verify.js` (orchestration, the `report.json` fields, the stdout line, and the `verify` event's hand-listed `impact` subset that `plugin/bin/lib/timing/derive.js` copies into `timing.json` …), `plugin/skills/test/impact-selection.md` or the kind's own reference doc, `plugin/skills/test/verification.md`'s Re-verify scoping table … `plugin/bin/lib/init/verify-scope-starter.js` when `/init` should offer it, and `tests/verify-scope-declaration.test.js` for the committed file." How each site is handled: `scope.js` stays unchanged, since the key changes no selection. The kind's reference doc is `ci-source.md` (Task 7). The scoping table and the committed file belong to #5370. The starter emits no `ci` block, so it gets no `localRuns`.
- `verify-scope-rule-kind`, quoted (Anti-Patterns): "Adding a key inside an existing block (`impact`, `ci`, `concurrency`) because a new top-level block needed no compatibility value | `readDeclaration` has no unknown-key check at the top level, so an older reader ignores a new block … Each block checks its own keys (`IMPACT_KEYS`, `CI_KEYS`, `CONCURRENCY_KEYS`), so a release that knows the block rejects the committed file over one new key inside it". `localRuns` is top-level, never a key inside `ci`.
- `verify-scope-rule-kind`, quoted: "**Every unreadable or unprovable input falls back to the full command with a named reason.** Add the reason to the `fallback` vocabulary and to the doc's reason table in the same change." The new `local-requested` reason is added to `ci-source.md`'s table in Task 7.
- `suite-slot-test-env`, quoted: "A helper that spawns `verify.js` and is given no env defaults the child to `{ ...process.env, CT_TEST_SUITE_SLOT_HELD: '1' }`, never bare `process.env` (`runCli` in `cli.test.js` and `impact-cli.test.js`, `fakeGhEnv` in `ci-cli.test.js` …)". "Build the child env with `slotEnv(dir, extra)` from `tests/helpers/suite-slot-env.js`" for any test that asserts the slot was or was not taken. New ci-cli tests reuse `fakeGhEnv` (HELD=1) and `withSlots` (`slotEnv`).
- `skill-prose-conformance-tests`, quoted: "Read governed markdown through `tests/helpers/read-skill.js`'s `readText()`, never a private `fs.readFileSync(p, 'utf8')`." And: "When the pinned prose is added in the same change, there is no frozen excerpt to use as a control. Prove each assertion on a mutated copy of the live text instead". And: "`tests/helpers/conformance-asserts.js` (`missingFactsOf`, `assertEachPatternGoesRed`) is the home of both … That forces each pattern to match exactly once in its slice."
- `skill-prose-conformance-tests`, quoted (Anti-Patterns): "A retirement sweep whose walk stops at `plugin/` and `docs/` | `.claude/skills/` restates plugin contracts … Add `.claude/skills/` to the walk and assert a file from it reached the list". And: "**The silent direction: new prose inside another suite's slice.** … Before adding text to a file other suites pin, grep `tests/` for the file and each suite's slice anchors; keep the new text outside the slice, or re-prove that suite's go-red controls on the edited slice." `tests/ci-skips-drafts-conformance.test.js` runs `assertEachPatternGoesRed` over `ci-source.md`'s `## CI that skips draft PRs` section and `ci-skips-drafts.md`'s `## Coexistence with the \`ci\` verification source` section. New text in either slice must not repeat `ci-job-skipped`, `waitSeconds`, `Declaring both is a misconfiguration`, `#5162`, `CI that runs on draft PRs plus a \`ci\` declaration`, `CI that skips drafts and no \`ci\` declaration`, `` `_shared/ci-skips-drafts.md` ``, `**CI on drafts plus a \`ci\` declaration:**` or `**CI skips drafts and no \`ci\` declaration:**`.
- `windows-checkout-test-parity`, quoted: "A test that puts a `#!/bin/sh` script named `gh` on `PATH` to fake the CLI | `execFileSync('gh')` never spawns an extensionless script on win32 … A test that writes such a stub skips with `{ skip: STUB_SKIP }` from `tests/helpers/path-stub.js`". `ci-cli.test.js` keeps its file-level `SKIP` for tests whose assertion depends on the fake `gh` running. New ci-cli tests whose assertion does not depend on it (the exit-2 refusals, the validation error, the read-only modes) run unskipped, and the file header comment says so. Fixture commands stay double-quoted `node -e "…"` with every path passed as a double-quoted argument (the existing `localMarkerCmd` shape), never `node -e '…'`.
- `prose-code-twin-pin`, quoted: "No such test → flag it: either the vocabulary needs a pinning test … or the 'table' isn't actually a closed vocabulary". The new `local-requested` row of `ci-source.md`'s reason table and the doc's "exit 3" are pinned against exported constants (`LOCAL_REQUESTED`, `EXIT_NO_VERDICT`). The rest of that table stays as unpinned as it is today. It is not widened here.
- Byte rail: `plugin/skills/test/verification.md` is 46,901 B against `RAIL_BYTES` 52,500 (headroom 5,599 B). Task 7 changes one sentence there, net under +200 B. `ci-source.md` is 5,599 B, `suite-slots.md` 8,740 B and `ci-skips-drafts.md` 5,022 B, all far from the rail.
- Test commands: only scoped `node --test <files>`. Never bare `npm test`, `npm test -- --full`, or an unscoped `verify.js` while executing this plan. The central verification step (`/claude-tweaks:test`) owns the full run.
- Commit style: `{Verb} {what} — {detail}, refs #5369`, ending with the session's attribution lines.

## Decisions this plan makes where the spec leaves a choice

1. **Unscoped refusal scope (spec Decision 1).** An unscoped run without `--local` exits 2 only when one of its `--cmd` names is a key of the declaration's `ci` block. An unscoped `--cmd types=… --cmd lint=…` run names no suite whose verdict CI owns, so it runs as today. AC3's case (`--cmd tests=…` with `tests` CI-declared) is refused.
2. **Stop at the first unanswered suite, and decide exit 3 before any retry (spec Decision 3).** With several CI-declared suites, the loop stops polling at the first one CI cannot answer and exits 3 naming it. It does not wait out every other suite's `waitSeconds` first. Under the key the loop only collects verdicts: a red CI job's local flaky retry (`retryHook`) is deferred until after the no-verdict check, so a red first suite followed by an unanswered second suite exits 3 with no retry run on this machine. Without the key the retry stays inside the loop, exactly as today.
3. **`--local` is recorded, not silent.** A `--local` run skips `fetchCiVerdict` for each selected CI-declared suite and records it in `report.ci` with fallback `local-requested`, so stdout prints `CI: tests — ran locally (local-requested)`. That holds with or without the key. Without `--local` nothing changes.
4. **Exit 3 writes the `verify` event** (when `--run` is anchored) with `pass: null` and `noVerdict: true`, so the audit trail counts the runs CI could not answer. It writes neither `report.json` nor any stamp, and removes a stale `report.json` at `jsonPath` (Global Constraints).
5. **A red job with no log under the key** carries `retryDecision: {retry: false, reason: 'ci-log-unavailable'}`. The flaky retry hook would otherwise report `no-parse` and print "whole-suite re-run applies", which under the key is false.
6. **`--stamp-suite` under the key (spec Decision 2).** A chunk still never consults CI. Under the key, a chunk whose `--cmd` set names a CI-declared suite exits 2 without `--local`, naming `--local` (Task 6). With `--local` it runs here as today. A chunk naming only suites with no `ci` source, or `types`/`lint`, is unaffected. Without the key nothing changes.
7. **The no-verdict and refusal text goes to stderr.** That is where every other non-check exit prints, and `plugin/bin/lib/driver/steps.js:695` reports `firstLine(r.stderr)` for any exit other than 0 and 1.

## Review Focus

1. **An exit-3 consumer that reads only the first stderr line.** `plugin/bin/lib/driver/steps.js`'s `testStep` maps any exit other than 0 and 1 to `fail` with `firstLine(r.stderr)`. Its run is pre-push, so under the key it always gets `head-not-pushed`. The first stderr line must therefore name the suite, the reason and "no verdict yet" by itself. Pinned in Task 5 (`AC1.1` test asserts line 1 alone). The driver passing `--local` is not in this record or in #5370's Key Files (see Out of scope).
2. **Two CI-declared suites, the first answered, the second not.** A reasonable person expects exit 3 naming the second suite and no local run of either. Pinned in Task 5 (`two CI suites` test).
3. **A dirty tree under the key without `--local`.** CI never saw the edits, so the run must exit 3 with `dirty-tree` and call no `gh`. It must not run the suite here. Pinned in Task 5.
4. **An invalid default declaration on an unscoped run.** It must not refuse the run, and the `verify.js: concurrency ignored — …` line must still print exactly once, not twice now that a second reader exists. Pinned in Task 6 with `withSlots` (no HELD, so the concurrency read happens).
5. **An unscoped run naming only non-CI checks under the key** (`--cmd types=…`, or a suite with no `ci` source). It runs as today. Pinned in Task 6.

## Out of scope (stated, not deferred silently)

- **#5370 owns the consumers.** The pipeline skills, the scoping table, the opt-in of this repo's `.claude-tweaks/verify-scope.json`, `residue.js`'s close-time suite probe, `plugin/bin/lib/driver/steps.js`'s `testStep` (runs `verify.js --scope` pre-push and maps exit 3 to `fail`), and the decision doc. #5370's body now names the driver test step and the residue probe as deliverables, so neither is changed here: without the key no project reaches either.
- plan-audit Check B's keyword walk hits, classified no-change: `docs/superpowers/plans/2026-10-27-ci-backed-verification.md` and `docs/superpowers/plans/2026-10-31-acceptance-packet.md` are history. `plugin/bin/acceptance-packet.js`, `plugin/bin/lib/hooks/git-exec.js`, `plugin/skills/wrap-up/verification-brief.md`, `tests/acceptance-packet-cli.test.js` and `tests/acceptance-packet-wrap-up-conformance.test.js` match the keyword `--local` only as a prefix of other flags: acceptance-packet's `--local-base-url`, and git's `--local-env-vars` in a `git-exec.js` comment. None names `localRuns`, verify.js's `--local`, or a CI fallback reason (checked with `git grep -F`). `docs/journeys/take-the-full-suite-verdict-from-ci-4347.md` is a real hit and is edited in Task 7.
- `plugin/bin/lib/flow/preflight.js` calls only `--stamp-status` and `--changed-files`, which AC6 keeps unaffected. No change.
- Waived plugin/bin/lib/verify/report.js: `composeReport` gains no field. The event fields are composed in `plugin/bin/verify.js` (Task 4), and `report.ci` keeps its existing per-attempt shape (`logUnavailable` rides on the attempt object `fetchCiVerdict` returns, Task 3).

---

### Task 1: Validate the `localRuns` declaration key

**Files:**
- Modify: `plugin/bin/lib/verify/declaration.js` (new block after the `ci` block, lines 153-186; add `localRuns` to the returned `decl`, line 329)
- Test: `tests/bin-lib/verify/declaration.test.js`

**Interfaces:**
- Produces: `readDeclaration(...).decl.localRuns` is `'on-request' | null`, always present on a parsed declaration.

- [ ] **Step 1: Write the failing tests.** Append to `tests/bin-lib/verify/declaration.test.js` (reuse its `readJson` and `EXAMPLE`; `CI = { api: { workflow: 'test.yml', job: 'test' } }`):

```js
test('AC5: localRuns "on-request" with a ci block parses; no key parses to null (#5369)', () => {
  assert.strictEqual(readJson({ ...EXAMPLE, ci: CI, localRuns: 'on-request' }).decl.localRuns, 'on-request');
  assert.strictEqual(readJson({ ...EXAMPLE, ci: CI }).decl.localRuns, null);
  assert.strictEqual(readJson(EXAMPLE).decl.localRuns, null);
});

test('AC5.1: localRuns with no ci block fails validation, naming the key (#5369)', () => {
  const r = readJson({ ...EXAMPLE, localRuns: 'on-request' });
  assert.strictEqual(r.ok, false);
  assert.deepStrictEqual(r.errors, ['localRuns: needs a ci block — "on-request" keeps CI-declared suites off this machine, and no suite declares a ci source']);
});

test('AC5.2: any localRuns value other than "on-request" fails validation, naming the key (#5369)', () => {
  for (const bad of ['always', 'On-Request', '', true, 1, null, ['on-request'], {}]) {
    const r = readJson({ ...EXAMPLE, ci: CI, localRuns: bad });
    assert.strictEqual(r.ok, false, JSON.stringify(bad));
    assert.deepStrictEqual(r.errors, [`localRuns: must be "on-request" when present, got ${JSON.stringify(bad)}`], JSON.stringify(bad));
  }
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/bin-lib/verify/declaration.test.js`
Expected: FAIL after Step 1 — `decl.localRuns` is `undefined` and the two invalid shapes parse `ok: true`.

- [ ] **Step 3: Implement the `localRuns` block in `readDeclaration`.** Check the value first (a wrong value reports only the value error), then that `raw.ci !== undefined`. Use the two error strings exactly as in Step 1. Add `localRuns` to the returned `decl` object. Add a comment that the key is top-level so an older reader ignores it (same expand-contract note as `ci`), and that it is valid only beside a `ci` block.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/bin-lib/verify/declaration.test.js`
Expected: PASS, every test in the file (the pre-existing ones unchanged).

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/verify/declaration.js tests/bin-lib/verify/declaration.test.js
git commit -m "Validate the localRuns declaration key — on-request only, beside a ci block, refs #5369"
```

### Task 2: Parse `--local` and export the no-verdict exit code

**Files:**
- Modify: `plugin/bin/lib/verify/args.js` (tokenize, `toResult`, both read-only validators, USAGE, exports)
- Test: `tests/bin-lib/verify/args.test.js`

**Interfaces:**
- Produces: `parseArgs([...,'--local'])` returns `local: true`. Without the flag the result has **no** `local` key. `EXIT_NO_VERDICT === 3` exported from `args.js`. USAGE names `[--local]`.

- [ ] **Step 1: Write the failing tests.** Append to `tests/bin-lib/verify/args.test.js`:

```js
test('#5369: --local parses to local: true on a check run, scoped or not', () => {
  assert.strictEqual(parseArgs(['--cmd', 'tests=npm test', '--local']).local, true);
  assert.strictEqual(parseArgs(['--scope', 'v.json', '--local']).local, true);
});

test('AC4.2: without --local the parsed result carries no local key (#5369)', () => {
  assert.strictEqual(Object.hasOwn(parseArgs(['--cmd', 'tests=npm test']), 'local'), false);
});

test('#5369: --local is a usage error in the read-only modes', () => {
  const conflict = (err) => err instanceof UsageError
    && err.message === '--local applies to a check run — not to --stamp-status or --changed-files';
  assert.throws(() => parseArgs(['--stamp-status', '--local']), conflict);
  assert.throws(() => parseArgs(['--changed-files', '--local']), conflict);
});

test('#5369: USAGE names --local and EXIT_NO_VERDICT is 3', () => {
  assert.ok(USAGE.includes('[--local]'));
  assert.match(USAGE, /note: --local runs every selected suite on this machine and never consults a declared ci source/);
  assert.strictEqual(EXIT_NO_VERDICT, 3);
});
```

Destructure `EXIT_NO_VERDICT` in the file's existing `require` on line 6.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/bin-lib/verify/args.test.js`
Expected: FAIL after Step 1 — `unknown flag: --local`, and `EXIT_NO_VERDICT` is undefined.

- [ ] **Step 3: Implement.** In `tokenize`, add `if (flag === '--local') { local = true; continue; }` beside `--stamp-suite`, and return `local`. In `toResult`, spread `...(raw.local ? { local: true } : {})`. Add `const LOCAL_MODE_CONFLICT = '--local applies to a check run — not to --stamp-status or --changed-files';` and throw it in `validateStampStatus` and `validateChangedFiles` after their `defaultSuiteSlots` check. In USAGE, insert `[--local] ` after `[--stamp-suite] ` on the check-run line, and append the note `'\nnote: --local runs every selected suite on this machine and never consults a declared ci source; under a declaration with localRuns "on-request" a CI-declared suite runs here only with it, a --scope run CI cannot answer exits 3 (no verdict yet, never a test failure), and a run naming a CI-declared suite with neither --scope nor --local exits 2 (#5369).'`. Export `EXIT_NO_VERDICT = 3`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/bin-lib/verify/args.test.js`
Expected: PASS, including the unchanged line-18 whole-object `deepStrictEqual`.

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/verify/args.js tests/bin-lib/verify/args.test.js
git commit -m "Parse verify.js --local — a check-run flag, absent from the result when not passed, refs #5369"
```

### Task 3: Download the CI job log with `--allow-escape-sequences`, and fail a logless red job under the key

**Review risk:** high (decision logic: the retry-once branch and the under-the-key red-job outcome)

**Files:**
- Modify: `plugin/bin/lib/verify/ci-source.js` (log download at lines 149-162, signature at line 67, exports)
- Test: `tests/bin-lib/verify/ci-source.test.js`

**Interfaces:**
- Consumes: `decl.localRuns` (Task 1), passed in by Task 5.
- Produces: `fetchCiVerdict({ ..., localRuns = null })`. Exports `LOG_ESCAPE_FLAG = '--allow-escape-sequences'` and `LOCAL_REQUESTED = 'local-requested'` (the reason string Task 5's `skipCi` writes and Task 7's doc test pins). Under `localRuns === 'on-request'`, a `failure` job whose log cannot be downloaded returns `{ used: true, ci: { ..., used: true, conclusion: 'failure', logUnavailable: true }, result: { exitCode: 1, logPath, ... } }`. The log file body names the run URL, as AC9.3 asks: `CI run {ci.runUrl || run id} failed (job {job.html_url || job.id}); its log could not be fetched ({errText(err)}). Run verify.js with --local to reproduce the failure on this machine.\n`. Without the key, that case still returns `fallback('ci-log-unavailable')`.

- [ ] **Step 1: Write the failing tests.** In `tests/bin-lib/verify/ci-source.test.js`, change the log routes so they behave like gh 2.103.3: add a helper and use it in place of every `[/\/jobs\/99\/logs$/, …]` route.

```js
// gh 2.103.3 refuses a job log carrying terminal escapes unless --allow-escape-sequences is passed (#5369).
const ESCAPE_REFUSAL = 'the response contains terminal escape sequences; pass --allow-escape-sequences to output it anyway';
function logRoute(body) {
  return [/\/jobs\/99\/logs$/, (args) => {
    if (!args.includes('--allow-escape-sequences')) return Object.assign(new Error(ESCAPE_REFUSAL), { stderr: ESCAPE_REFUSAL });
    return body;
  }];
}
```

Then add:

```js
test('AC9.1: the job-log download passes --allow-escape-sequences after the path, and the escape-refusing fake answers it (#5369)', async () => {
  const { runner, calls } = fakeGh([PULLS, PR, RUNS, jobs('success'), logRoute('ok\n')]);
  const { v } = await call({}, { runner });
  assert.strictEqual(v.used, true);
  assert.strictEqual(calls.filter((c) => c.includes('/logs')).length, 1);
  assert.strictEqual(calls.find((c) => c.includes('/logs')), 'api repos/{owner}/{repo}/actions/jobs/99/logs --allow-escape-sequences');
});

test('AC9.2: a gh that rejects the flag as unknown gets exactly one retry without it (#5369)', async () => {
  const unknown = 'unknown flag: --allow-escape-sequences';
  const { runner, calls } = fakeGh([PULLS, PR, RUNS, jobs('failure'), [/\/jobs\/99\/logs$/, (args) => (args.includes('--allow-escape-sequences') ? Object.assign(new Error(unknown), { stderr: unknown }) : LOG)]]);
  const { v, logDir } = await call({}, { runner });
  assert.deepStrictEqual(calls.filter((c) => c.includes('/logs')), [
    'api repos/{owner}/{repo}/actions/jobs/99/logs --allow-escape-sequences',
    'api repos/{owner}/{repo}/actions/jobs/99/logs',
  ]);
  assert.strictEqual(v.used, true);
  assert.match(fs.readFileSync(path.join(logDir, 'tests.log'), 'utf8'), /\/local\/root\/tests\/a\.test\.js/);
});

test('#5369: a refusal other than the unknown-flag one is not retried', async () => {
  const { runner, calls } = fakeGh([PULLS, PR, RUNS, jobs('failure'), [/\/jobs\/99\/logs$/, new Error('HTTP 410')]]);
  await call({}, { runner });
  assert.strictEqual(calls.filter((c) => c.includes('/logs')).length, 1);
});

test('AC9.3: under localRuns "on-request" a red job with no downloadable log is a CI failure naming the run URL (#5369)', async () => {
  const { runner } = fakeGh([PULLS, PR, RUNS, jobs('failure'), [/\/jobs\/99\/logs$/, new Error('HTTP 410')]]);
  const { v, logDir } = await call({ localRuns: 'on-request' }, { runner });
  assert.strictEqual(v.used, true);
  assert.strictEqual(v.ci.logUnavailable, true);
  assert.strictEqual(v.ci.fallback, null);
  assert.strictEqual(v.result.exitCode, 1);
  assert.strictEqual(fs.readFileSync(path.join(logDir, 'tests.log'), 'utf8'),
    'CI run https://example.test/runs/41 failed (job https://example.test/job/99); its log could not be fetched (HTTP 410). Run verify.js with --local to reproduce the failure on this machine.\n');
});

test('AC4.1: without the key a red job with no log still falls back, and a green one carries no logUnavailable (#5369)', async () => {
  const red = await call({}, { runner: fakeGh([PULLS, PR, RUNS, jobs('failure'), [/\/jobs\/99\/logs$/, new Error('HTTP 410')]]).runner });
  assert.strictEqual(red.v.ci.fallback, 'ci-log-unavailable');
  const green = await call({ localRuns: 'on-request' }, { runner: fakeGh([PULLS, PR, RUNS, jobs('success'), logRoute('ok\n')]).runner });
  assert.strictEqual(Object.hasOwn(green.v.ci, 'logUnavailable'), false);
});
```

Note: the fake's route function returns an `Error`, which `fakeGh` throws (line 26). That keeps the gh-api rule: record inside the runner, assert after it returns.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/bin-lib/verify/ci-source.test.js`
Expected: FAIL after Step 1 — the green and red log tests and AC9.1 fail on the escape refusal, AC9.2 sees one call, AC9.3 gets `fallback: 'ci-log-unavailable'`.

- [ ] **Step 3: Implement in `ci-source.js`.**
  - Add `localRuns = null` to `fetchCiVerdict`'s destructured parameters.
  - Replace the single log `gh(...)` call with `gh([...logArgs, LOG_ESCAPE_FLAG], LOG_TIMEOUT_MS)`. When that throws and `/unknown flag: --allow-escape-sequences/` matches `err.stderr || err.message`, retry once with `gh(logArgs, LOG_TIMEOUT_MS)`. `logArgs` is `['api', \`repos/{owner}/{repo}/actions/jobs/${Number(job.id)}/logs\`]`. The flag goes after the path, so `args[1]` stays the endpoint for every fake that keys on it.
  - Keep the `gh-unavailable` rethrow. In the red-job catch, branch on `localRuns === 'on-request'`: with the key, set `ci.logUnavailable = true` and write the Step 1 body (keep the caught error for `errText`). Without it, keep `return fallback('ci-log-unavailable')`.
  - Update the file's header comment: under the key, a red job with no log is CI's verdict, not a fallback.
  - Export `LOG_ESCAPE_FLAG`, `LOCAL_REQUESTED` and `NOT_CONSULTED = 'not-consulted'` (the reason Task 5 records for a selected CI-declared suite after the one that stopped the run).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/bin-lib/verify/ci-source.test.js`
Expected: PASS, every test (the pre-existing ones now use `logRoute`).

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/verify/ci-source.js tests/bin-lib/verify/ci-source.test.js
git commit -m "Download CI job logs with --allow-escape-sequences — one retry for an older gh, a logless red job fails under localRuns, refs #5369"
```

### Task 4: Record the CI outcome and `--local` in the `verify` event and `timing.json`

**Files:**
- Modify: `plugin/bin/verify.js` (the event block at lines 1223-1246: extract `writeVerifyEvent`, add the fields)
- Modify: `plugin/bin/lib/timing/derive.js:239` (the verify-row copy)
- Test: `tests/bin-lib/timing/derive.test.js`, `tests/bin-lib/verify/ci-cli.test.js`

**Interfaces:**
- Consumes: `parsed.local` (Task 2).
- Produces:
  - In `verify.js`, `writeVerifyEvent(runArg, fields)`. It resolves `--run` through `resolveTarget`, prints today's exact refusal line on a refused target and returns `null`, else calls `appendEvent(target.dir, 'verify', fields)` and returns `target`. The flaky-allowlist staging loop that follows keeps using the returned target.
  - Also `ciEventEntries(ciAttempts)`, which returns `[{ suite, used, fallback }]`.
  - Event fields added: `ci` (only when `ciAttempts.length`), `local: parsed.local === true` (always), and `noVerdict: true` (only on exit 3, Task 5).
  - `derive.js` copies `ci` when it is an array, `local` when it is a boolean, and `noVerdict` when it is `true`.
  - Decided: a `noVerdict` verify event still closes the tasks span (`derive.js:163`'s `verifies.find`, unchanged). Verification was attempted at that moment, and the test phase it opens is where the exit-3 row is listed. Pinned by the derive test below.

- [ ] **Step 1: Write the failing tests.**
  - In `tests/bin-lib/timing/derive.test.js`, beside the #4321 impact tests:

```js
test('AC7: a verify row keeps ci, local and noVerdict only when the event carries them (#5369)', () => {
  const ci = [{ suite: 'tests', used: false, fallback: 'head-not-pushed' }];
  const events = fixtureEvents().map((e) => (e.type === 'verify' && e.mode === 'full' ? { ...e, ci, local: false, noVerdict: true } : e));
  const p = byName(derivePhases({ events, manifest: fixtureManifest(), now: new Date('2026-09-05T14:13:00.000Z') }));
  assert.deepEqual(p.test.verify[0].ci, ci);
  assert.equal(p.test.verify[0].local, false);
  assert.equal(p.test.verify[0].noVerdict, true);
  for (const k of ['ci', 'local', 'noVerdict']) assert.equal(Object.hasOwn(p.tasks.verify[0], k), false, k);
});

test('#5369: a noVerdict verify event closes the tasks span like any other verify event', () => {
  /* the fixture with its first post-SDD verify event marked { noVerdict: true, pass: null, suitesRun: [] }:
     the tasks phase ends at that event's ts, and p.test.verify[0].noVerdict === true */
});

test('#5369: a verify row drops a ci that is not an array and a local that is not a boolean', () => {
  const events = fixtureEvents().map((e) => (e.type === 'verify' && e.mode === 'full' ? { ...e, ci: 'x', local: 'yes', noVerdict: 1 } : e));
  const p = byName(derivePhases({ events, manifest: fixtureManifest(), now: new Date('2026-09-05T14:13:00.000Z') }));
  for (const k of ['ci', 'local', 'noVerdict']) assert.equal(Object.hasOwn(p.test.verify[0], k), false, k);
});
```

  - In `tests/bin-lib/verify/ci-cli.test.js`, add a run-dir helper and a `timingEntry` helper. The helper excludes the run dir from git status, or the tree reads dirty and CI is skipped as `dirty-tree`. Import `anchoredRunDir` from `./cli-helpers` and `derivePhases` from `plugin/bin/lib/timing/derive.js`.

```js
function ciRunDir(r) {
  fs.mkdirSync(path.join(r.gitDir, 'info'), { recursive: true });
  fs.appendFileSync(path.join(r.gitDir, 'info', 'exclude'), '.claude-tweaks/pipelines/\n');
  return anchoredRunDir(r.repo);
}
const eventsOf = (runDir) => fs.readFileSync(path.join(runDir, 'events.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
function timingEntry(runDir) {
  const events = [{ type: 'skill_invoked', skill: 'claude-tweaks:test', ts: '2000-01-01T00:00:00.000Z' }, ...eventsOf(runDir)];
  return derivePhases({ events, now: new Date(Date.now() + 60000) }).phases.find((p) => p.phase === 'test').verify[0];
}

test('AC7: a CI-answered run\'s verify event and timing entry carry ci and local: false (#5369)', { skip: SKIP }, async () => {
  const r = repoWith();
  const { env } = fakeGhEnv('green', ciLogOf(r, ['tests/ok.test.js']));
  const runDir = ciRunDir(r);
  const res = await runCli(['--run', runDir, '--scope', '.claude-tweaks/verify-scope.json', '--integration-branch', r.branch, '--cmd', localMarkerCmd(path.join(tmpDir(), 'm'))], { cwd: r.repo, env });
  assert.strictEqual(res.code, 0, res.stdout + res.stderr);
  const [ev] = eventsOf(runDir).filter((e) => e.type === 'verify');
  assert.deepStrictEqual(ev.ci, [{ suite: 'tests', used: true, fallback: null }]);
  assert.strictEqual(ev.local, false);
  assert.strictEqual(Object.hasOwn(ev, 'noVerdict'), false);
  assert.deepStrictEqual(timingEntry(runDir).ci, ev.ci);
  assert.strictEqual(timingEntry(runDir).local, false);
});

test('AC7: a run with no ci block carries local but no ci key (#5369)', async () => {
  const r = repoWith({ ci: false });
  const runDir = ciRunDir(r);
  const { env } = fakeGhEnv('green', '');
  const res = await runCli(['--run', runDir, '--scope', '.claude-tweaks/verify-scope.json', '--integration-branch', r.branch, '--local', '--cmd', localMarkerCmd(path.join(tmpDir(), 'm'))], { cwd: r.repo, env });
  assert.strictEqual(res.code, 0, res.stdout + res.stderr);
  const [ev] = eventsOf(runDir).filter((e) => e.type === 'verify');
  assert.strictEqual(ev.local, true);
  assert.strictEqual(Object.hasOwn(ev, 'ci'), false);
});
```

The second test needs no `gh` (no ci block) and runs on win32 too.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/bin-lib/timing/derive.test.js tests/bin-lib/verify/ci-cli.test.js`
Expected: FAIL after Step 1 — the derive rows lack `ci`/`local`/`noVerdict`, and the events lack `ci`/`local`.

- [ ] **Step 3: Implement.**
  - In `verify.js`, extract the `if (parsed.run) { … appendEvent … }` head into `writeVerifyEvent(runArg, fields)` with the refusal stderr text byte-identical. Build `fields` exactly as today, plus `...(ciAttempts.length ? { ci: ciEventEntries(ciAttempts) } : {})` and `local: parsed.local === true`. The flaky-allowlist staging loop moves under `if (target)` with the target the helper returned.
  - In `derive.js:239`, append the three conditional spreads after the `impact` one.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/bin-lib/timing/derive.test.js tests/bin-lib/verify/ci-cli.test.js tests/bin-lib/verify/cli.test.js tests/bin-lib/verify/impact-cli.test.js`
Expected: PASS. `cli.test.js` and `impact-cli.test.js` run unchanged, covering the #1928 event tests and the #4321 timing-entry pins.

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/verify.js plugin/bin/lib/timing/derive.js tests/bin-lib/timing/derive.test.js tests/bin-lib/verify/ci-cli.test.js
git commit -m "Record each CI-declared suite's outcome and --local in the verify event — timing.json copies both, refs #5369"
```

### Task 5: Scoped runs under the key — `--local`, exit 3, and the logless red job

**Review risk:** high (decision logic and async ordering: which outcome a run takes, and the deferred retry)

**Files:**
- Modify: `plugin/bin/verify.js` (CI loop at lines 861-888, the stdout `CI:` line at 1449-1453, a new no-verdict exit between the loop and the slot hold at line 898)
- Test: `tests/bin-lib/verify/ci-cli.test.js`, `tests/bin-lib/verify/impact-cli.test.js`

**Interfaces:**
- Consumes: `decl.localRuns` (Task 1), `parsed.local` and `EXIT_NO_VERDICT` (Task 2), `fetchCiVerdict({ localRuns })`, `LOCAL_REQUESTED`, `NOT_CONSULTED` and `ci.logUnavailable` (Task 3), `writeVerifyEvent` and `ciEventEntries` (Task 4).
- Produces:
  - `noVerdictLines(attempt)` returns three lines, exact text:
    1. `` verify.js: no verdict yet for suite "${suite}" — CI could not answer (${fallback}), and the declaration's localRuns "on-request" keeps it off this machine; no check ran and no pass stamp was written. ``
    2. `  Either push the branch (commit first if the tree is dirty) so HEAD is the head of an open PR, then re-run this command,`
    3. `  or re-run it with --local to run the suite on this machine.`
  - The logless-red stdout line: `` CI: ${suite} — taken from ${workflow} / ${job} run ${runId} on HEAD (failure, ${runUrl}; its log could not be downloaded — pass --local to reproduce the failure here) ``.

- [ ] **Step 1: Write the failing tests.**
  - In `tests/bin-lib/verify/ci-cli.test.js`, extend `FAKE_GH`:
    - Add a mode `unpushed`. The `commits/{sha}/pulls` endpoint writes `gh: No commit found for SHA: x (HTTP 422)` to stderr and exits 1.
    - A job named in `FAKE_GH_JOBS` (comma list, default `test`) is listed in the jobs response. Every other name is absent.
    - `FAKE_GH_LOG=gone` makes the logs endpoint exit 1 with `HTTP 410: Gone`.
    - The logs endpoint, with `FAKE_GH_LOG` unset, refuses a call without `--allow-escape-sequences` with the gh 2.103.3 text. With `FAKE_GH_LOG=old` it refuses one *with* the flag as `unknown flag: --allow-escape-sequences`.
  - Add `fakeGhEnv(mode, logFile, extra = {})` so `extra` is spread into the env.
  - Add a `markerCommand(marker)` helper (the command half of `localMarkerCmd`) and `const KEY = { localRuns: 'on-request' }`. The pre-existing tests keep their mode names and pass unchanged.

```js
const SCOPE = (r) => ['--scope', '.claude-tweaks/verify-scope.json', '--integration-branch', r.branch];

test('AC1.1: under the key an unpushed HEAD exits 3 before any check, prints head-not-pushed and both ways on, writes no stamp (#5369)', { skip: SKIP }, async () => {
  const r = repoWith({ declExtra: KEY });
  const { env } = fakeGhEnv('unpushed', '');
  const marker = path.join(tmpDir(), 'm');
  // A previous run's report must not survive an exit 3 (it would read as this run's answer).
  fs.mkdirSync(path.join(r.gitDir, 'claude-tweaks-verify'), { recursive: true });
  fs.writeFileSync(path.join(r.gitDir, 'claude-tweaks-verify', 'report.json'), '{"pass":true}\n');
  const res = await runCli([...SCOPE(r), '--cmd', localMarkerCmd(marker)], { cwd: r.repo, env });
  assert.strictEqual(res.code, 3, res.stdout + res.stderr);
  assert.ok(!fs.existsSync(marker), 'no check may run');
  const [first, second, third] = res.stderr.split('\n');
  assert.strictEqual(first, 'verify.js: no verdict yet for suite "tests" — CI could not answer (head-not-pushed), and the declaration\'s localRuns "on-request" keeps it off this machine; no check ran and no pass stamp was written.');
  assert.match(second, /push the branch/);
  assert.match(third, /re-run it with --local/);
  assert.ok(!fs.existsSync(path.join(r.gitDir, 'claude-tweaks-verify-pass.json')));
  assert.ok(!fs.existsSync(path.join(r.gitDir, 'claude-tweaks-verify', 'report.json')), 'exit 3 writes no report and removes the stale one');
});

test('AC1.2: under the key a green CI job on HEAD is taken from CI and the suite never runs here (#5369)', { skip: SKIP }, async () => { /* green mode, KEY; code 0, marker absent, stamp.source === 'ci' */ });

test('AC2.1: under the key --local makes no gh call and runs the suite here (#5369)', { skip: SKIP }, async () => { /* green mode, KEY, --local; code 0, marker present, calls file absent, report.ci[0].fallback === 'local-requested', stdout has "CI: tests — ran locally (local-requested)" */ });

test('AC4.1: without the key an unpushed HEAD still runs the suite here and exits 0 (#5369)', { skip: SKIP }, async () => { /* unpushed mode, no KEY; code 0, marker present, report.ci[0].fallback === 'head-not-pushed' */ });

test('AC6.1: under the key a suite with no ci source runs here without --local (#5369)', { skip: SKIP }, async () => {
  /* declExtra: { ...KEY, checks: { tests: { tests: 'npm test', other: markerCommand(otherMarker) } }, retry: { tests: '…{file}' } };
     ci stays keyed on tests; green mode; --cmd overrides tests with localMarkerCmd(testsMarker);
     code 0, testsMarker absent (CI answered), otherMarker present */
});

test('two CI suites under the key, the first unanswered: exit 3 names it, the second is not-consulted and never fetched (#5369)', { skip: SKIP }, async () => {
  /* unpushed mode + KEY + both suites CI-declared, with --run ciRunDir(r); code 3, stderr line 1 names suite "tests" and (head-not-pushed),
     the verify event's ci deepStrictEqual [{ suite: 'tests', used: false, fallback: 'head-not-pushed' }, { suite: 'other', used: false, fallback: 'not-consulted' }],
     and the calls file holds no request for job "other" (its runs/jobs endpoint was never queried) */
});

test('two CI suites under the key: the second unanswered one exits 3 naming it, neither runs here (#5369)', { skip: SKIP }, async () => {
  /* declExtra: { ...KEY, checks: { tests: { tests: …, other: … } }, ci: { tests: {workflow:'test.yml', job:'test', waitSeconds:5, pollSeconds:1}, other: {workflow:'test.yml', job:'other', waitSeconds:5, pollSeconds:1} } };
     green mode (FAKE_GH_JOBS unset, so job "other" is absent → ci-job-not-found);
     code 3, stderr line 1 names suite "other" and (ci-job-not-found), both markers absent */
});

test('a red first suite and an unanswered second suite under the key exit 3 before any local retry (#5369)', { skip: SKIP }, async () => {
  /* declExtra: { ...KEY, checks: { tests: { tests: …, other: … } }, ci: { tests: {workflow:'test.yml', job:'test', …}, other: {workflow:'test.yml', job:'other', …} },
       flaky: { files: [<the fixture's failing file>], maxRetries: 1 }, retry: { tests: markerCommand(retryMarker) + ' {file}' } };
     red mode (job "test" fails with a log naming the allowlisted file, so without the key retryHook would spawn the retry), job "other" absent;
     code 3, stderr line 1 names suite "other" and (ci-job-not-found), retryMarker absent (no retry ran), both suite markers absent.
     Control in the same test: the identical repo without KEY exits as today and retryMarker is present, proving the fixture reaches the retry. */
});

test('a dirty tree under the key exits 3 with dirty-tree and calls no gh (#5369)', { skip: SKIP }, async () => { /* KEY, edit tests/ok.test.js; code 3, stderr line 1 has (dirty-tree), calls file absent */ });

test('AC9.3: under the key a red CI job with no downloadable log exits 1, names the run URL, and runs nothing here (#5369)', { skip: SKIP }, async () => {
  /* red mode, FAKE_GH_LOG=gone, KEY; code 1, marker absent,
     stdout matches /^CI: tests — taken from test\.yml \/ test run 41 on HEAD \(failure, https:\/\/example\.test\/runs\/41; its log could not be downloaded — pass --local to reproduce the failure here\)$/m,
     report.checks.tests.retryDecision deepStrictEqual { retry: false, reason: 'ci-log-unavailable' }, no stamp */
});

test('AC9.2: an older gh that rejects --allow-escape-sequences still takes the red verdict from CI (#5369)', { skip: SKIP }, async () => { /* red mode, FAKE_GH_LOG=old, real-failure fixture as #4347 AC3; code 1, stdout names "brand new check" */ });

test('AC7: an exit-3 run writes a verify event with noVerdict and pass null; a --local run records local-requested (#5369)', { skip: SKIP }, async () => {
  /* unpushed + KEY with --run ciRunDir(r): event.noVerdict === true, event.pass === null, event.suitesRun deepStrictEqual [], event.ci deepStrictEqual [{ suite: 'tests', used: false, fallback: 'head-not-pushed' }];
     then the same repo with --local: second event local === true, ci deepStrictEqual [{ suite: 'tests', used: false, fallback: 'local-requested' }] */
});

test('an exit-3 run takes no suite slot (#5369)', { skip: SKIP }, async () => { /* unpushed + KEY with withSlots(env, dir); code 3, fs.existsSync(dir) === false */ });
```

  - In `tests/bin-lib/verify/impact-cli.test.js`, add two tests. They use `impactRepo(declOf({}, { ci: { tests: { workflow: 'test.yml', job: 'test', waitSeconds: 5, pollSeconds: 1 } }, localRuns: 'on-request' }))` and pass `--local`, so no `gh` is ever spawned and they run on every platform. `local-requested` is written only on the path that skips `fetchCiVerdict`.

```js
test('AC2.1: under the key --local runs the impact subset here and never consults CI (#5369)', async () => {
  /* writeMap(r); commitFile(r, 'src/x.js', 'x2\n'); runCli([...ARGS, '--local'], r.repo);
     code 0; r.marker() === 'tests/a.test.js\n'; r.report().ci deepStrictEqual [{ suite: 'tests', workflow: 'test.yml', job: 'test', used: false, fallback: 'local-requested', prNumber: null, runId: null, runUrl: null, jobId: null, conclusion: null, waitedMs: 0 }] */
});

test('AC2.2: under the key --local runs the full command here when selection falls back (#5369)', async () => {
  /* no writeMap (map-missing); commitFile(r, 'src/x.js', 'x2\n'); runCli([...ARGS, '--local'], r.repo);
     code 0; r.marker() === 'FULL'; r.report().scope.impact.fallback === 'map-missing' */
});
```

The executor writes each commented body as real assertions with the values given. Every `runCli` call passes `{ cwd: r.repo, env }` from `fakeGhEnv`, whose env carries HELD=1.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/bin-lib/verify/ci-cli.test.js tests/bin-lib/verify/impact-cli.test.js`
Expected: FAIL after Step 1 — the unpushed run under the key exits 0 and runs the suite, `--local` still calls gh, and the logless red job falls back locally.

- [ ] **Step 3: Implement in `verify.js`.**
  - Compute `const onRequest = Boolean(decl && decl.localRuns === 'on-request');` before the CI loop.
  - Inside the loop:
    - `if (parsed.local) { skipCi(LOCAL_REQUESTED); continue; }` comes first.
    - After the dirty-tree `skipCi`, and after a `!verdict.used` push, stop consulting CI when `onRequest`: every later selected CI-declared suite (one whose name is in `cmds`) gets `skipCi(NOT_CONSULTED)` and no `gh` call, so the `verify` event still carries one entry per selected CI-declared suite (AC7). A suite the selection left out of `cmds` is not part of the run and gets no entry, as today.
    - Pass `localRuns: decl.localRuns` to `fetchCiVerdict`.
    - For a used verdict with `verdict.ci.logUnavailable`, push `{ ...ciResult, retryDecision: { retry: false, reason: 'ci-log-unavailable' } }` and skip `retryHook`.
    - Under the key, a red used verdict is pushed to `ciResults` without calling `retryHook` inside the loop, and marked for a deferred retry. Without the key the in-loop `await retryHook(...)` stays exactly as today.
  - After the loop, `const noVerdict = onRequest ? ciAttempts.find((a) => !a.used && a.fallback !== LOCAL_REQUESTED && a.fallback !== NOT_CONSULTED) : undefined;` (the first unanswered suite, never a `not-consulted` one). Only when it is unset, run the deferred `retryHook` calls (same arguments as today's in-loop call, in suite order) and replace each marked entry with the hook's result. When it is set:
    1. Write `noVerdictLines(noVerdict).join('\n')` plus `\n` to stderr, then remove `jsonPath` (`fs.rmSync(jsonPath, { force: true })`).
    2. Call `writeVerifyEvent` with `{ mode: sel.mode, suitesRun: [], durationMs: Date.now() - startMs, slotWaitedMs: 0, pass: null, noVerdict: true, baselineAdjudicated: null, preExistingAdjudicated: null, sha: startSha, flakyRetried: [], reportPath: null, ...impact subset as in the normal event, ci: ciEventEntries(ciAttempts), local: false }`.
    3. Set `process.exitCode = EXIT_NO_VERDICT` and `return`.

    This sits before `holdFor`, so no slot is taken. Factor the normal event's `impact` subset into one small helper so both writers share it.
  - In the stdout `CI:` loop, render the logless-red line for an attempt with `a.logUnavailable`.
  - Update the #4347 comment above the loop: under the key, an unanswered suite stops the run instead of falling back.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/bin-lib/verify/ci-cli.test.js tests/bin-lib/verify/impact-cli.test.js tests/bin-lib/verify/cli.test.js tests/bin-lib/verify/cli-slot.test.js`
Expected: PASS. Every pre-existing test in these files passes unchanged (AC4.2).

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/verify.js tests/bin-lib/verify/ci-cli.test.js tests/bin-lib/verify/impact-cli.test.js
git commit -m "Stop a scoped verify CI cannot answer under localRuns — exit 3 with both ways on, --local runs here, a logless red job fails, refs #5369"
```

### Task 6: Refuse an unscoped run, or a `--stamp-suite` chunk, of a CI-declared suite under the key

**Review risk:** high (decision logic: which runs are refused)

**Files:**
- Modify: `plugin/bin/verify.js` (`defaultConcurrency` at line 191 split into a memoized `readDefaultDeclaration` plus the existing printer; a new refusal right after the `--cwd` check, line 456; a `--stamp-suite` refusal through `scopeUsageExit` just before the `if (!parsed.stampSuite)` block, line 598)
- Test: `tests/bin-lib/verify/ci-cli.test.js`

**Interfaces:**
- Consumes: `decl.localRuns`/`decl.ci` (Task 1), `parsed.local` (Task 2).
- Produces:
  - `readDefaultDeclaration(cwd)` returns `{ decl: object | null, error: string | null }`. It is memoized per process, and `error` carries the exact text `defaultConcurrency` prints today (the discovery error, or `read.errors[0]`). `defaultConcurrency` keeps its stderr line and return shape and reads through it.
  - Refusal text, then `USAGE`, exit 2: `` verify.js: ${DECLARATION_PATH} sets localRuns "on-request", so the CI-declared suite "${name}" runs on this machine only when asked: pass --scope ${DECLARATION_PATH} to take it from CI, or --local to run it here. ``

- [ ] **Step 1: Write the failing tests** in `tests/bin-lib/verify/ci-cli.test.js`. None of these depends on `gh` running, so none takes `SKIP`:

```js
test('AC3.1: under the key an unscoped --cmd tests run exits 2 naming --scope and --local, and runs nothing (#5369)', async () => {
  const r = repoWith({ declExtra: KEY });
  const { env } = fakeGhEnv('green', '');
  const marker = path.join(tmpDir(), 'm');
  const res = await runCli(['--cmd', localMarkerCmd(marker)], { cwd: r.repo, env });
  assert.strictEqual(res.code, 2, res.stdout + res.stderr);
  assert.strictEqual(res.stderr.split('\n')[0], 'verify.js: .claude-tweaks/verify-scope.json sets localRuns "on-request", so the CI-declared suite "tests" runs on this machine only when asked: pass --scope .claude-tweaks/verify-scope.json to take it from CI, or --local to run it here.');
  assert.ok(!fs.existsSync(marker));
});

test('AC3.2: under the key an unscoped --local run runs the full command here (#5369)', async () => { /* KEY, ['--local', '--cmd', localMarkerCmd(m)]; code 0, marker present */ });

test('AC6.1: under the key --stamp-status and --changed-files need no --local (#5369)', async () => {
  /* KEY; ['--stamp-status'] → code 0 and stdout parses as JSON with typeof .verifiedHead === 'boolean';
     ['--changed-files', '--integration-branch', r.branch] → code 0 and JSON with Array.isArray(.files) */
});

test('an unscoped run naming only non-CI checks runs under the key (#5369)', async () => { /* KEY, ['--cmd', 'lint=' + markerCommand(m)]; code 0, marker present */ });

test('Decision 2: under the key a --stamp-suite chunk of a CI-declared suite exits 2 naming --local, calls no gh and runs nothing (#5369)', async () => {
  /* KEY; [...SCOPE(r), '--no-stamp', '--stamp-suite', '--cmd', localMarkerCmd(m)]; code 2, marker absent, calls file absent,
     stderr line 1 === 'verify.js: .claude-tweaks/verify-scope.json sets localRuns "on-request", so the --stamp-suite chunk of the CI-declared suite "tests" is a run on this machine: pass --local to run it here.' */
});

test('Decision 2: under the key a --stamp-suite chunk with --local runs here, and a chunk naming only non-CI checks needs no --local (#5369)', async () => {
  /* KEY; with '--local': code 0, marker present, calls file absent. Without '--local' and '--cmd', 'lint=' + markerCommand(m2): code 0, m2 present */
});

test('Decision 2: without the key a --stamp-suite chunk runs as today (#5369)', async () => { /* no KEY, no --local; code 0, marker present */ });

test('an invalid default declaration never refuses an unscoped run (#5369)', async () => { /* declExtra: { localRuns: 'on-request', ci: undefined } with ci: false; code 0, marker present */ });

test('an invalid default declaration prints its concurrency-ignored line exactly once (#5369)', async () => {
  /* repoWith({ ci: false, declExtra: { localRuns: 'on-request' } }); env withSlots(fakeGhEnv('green','').env, path.join(tmpDir(), 'slots'));
     ['--cmd', localMarkerCmd(m)]; code 0; (res.stderr.match(/verify\.js: concurrency ignored — /g) || []).length === 1;
     stderr includes 'localRuns: needs a ci block' */
});
```

  - Update the file's header comment: tests that do not depend on the fake `gh` running are not skipped on win32.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/bin-lib/verify/ci-cli.test.js`
Expected: FAIL after Step 1 — the unscoped `--cmd tests` run under the key exits 0 and runs the suite, and so does the `--stamp-suite` chunk without `--local`.

- [ ] **Step 3: Implement in `verify.js`.**
  - Split `defaultConcurrency` into `readDefaultDeclaration` (memoized, no printing) and the printer, with today's stderr text unchanged.
  - After the `--cwd` foreign-checkout check, when `!parsed.scope && parsed.local !== true`, read `readDefaultDeclaration(parsed.cwd || process.cwd()).decl`. If `decl.localRuns === 'on-request'`, find the first `parsed.cmds` entry whose name is an own key of `decl.ci` (`Object.hasOwn`). If one exists, write the refusal and `USAGE` to stderr, set exit 2 and return.
  - An unreadable or invalid declaration has `decl: null` and is never refused.
  - In the `--scope` branch, just before `if (!parsed.stampSuite) {` (line 598): when `parsed.stampSuite && decl.localRuns === 'on-request' && parsed.local !== true`, find the first `cmds` entry whose name is an own key of `decl.ci`. If one exists, call `scopeUsageExit` with the Step 1 text (`${parsed.scope}` as given, matching the other `--scope` errors) and return. This runs before any `gh` call, check or slot hold.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/bin-lib/verify/ci-cli.test.js tests/bin-lib/verify/cli-slot.test.js tests/bin-lib/verify/cli-stamp-discovery.test.js tests/bin-lib/verify/cli.test.js`
Expected: PASS. `cli-slot.test.js` covers the `concurrency ignored` line (#5150), unchanged.

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/verify.js tests/bin-lib/verify/ci-cli.test.js
git commit -m "Refuse an unscoped verify or a --stamp-suite chunk of a CI-declared suite under localRuns — exit 2 naming the way on, refs #5369"
```

### Task 7: Document the key, the flag and exit 3, and retire the always-falls-back wording

**Files:**
- Modify: `plugin/skills/test/ci-source.md` (new `## Local runs on request` section after `## When CI answers`. Qualify line 40's "Every other outcome runs the suite locally" to a declaration without the key. Add a `local-requested` row to the reason table. Add the logless-red `CI:` line to line 56. Rewrite line 64's "the caller runs verify.js without `--scope`, which never consults `ci`". `## CI that skips draft PRs` is not touched.)
- Modify: `plugin/skills/test/suite-slots.md` (one bullet under `## Lanes`)
- Modify: `plugin/skills/test/stamp-composition.md` (one sentence appended to the **Chunked verification (#3002).** paragraph, outside every fenced snippet: `tests/bin-lib/verify/snippet-conformance.test.js` byte-pins the snippets and `tests/stamp-status-discovery-prose-conformance.test.js` reads the file, so run both in Step 4; 6,132 B, far from the rail)
- Modify: `plugin/skills/test/verification.md:100` (qualify "falls back to the local run with a named reason otherwise")
- Modify: `plugin/skills/_shared/ci-skips-drafts.md:51` (append one sentence to the Coexistence paragraph, repeating none of that slice's pinned tokens listed in Global Constraints)
- Modify: `docs/plugin-structure.md` (line 58's `ci-source.js` entry, line 204's `verify.js` synopsis and description)
- Modify: `docs/journeys/take-the-full-suite-verdict-from-ci-4347.md:24` (the "Should understand" line says an unpushed HEAD "runs the suite locally"; qualify it. Found by plan-audit Check B's keyword walk; no test pins this file)
- Create: `tests/verify-local-runs-docs-conformance.test.js`
- Test (Step 6 regression pass): the verify, timing and source-scan suites listed there

**Interfaces:**
- Consumes: `LOCAL_REQUESTED`, `LOG_ESCAPE_FLAG` (Task 3), `EXIT_NO_VERDICT` (Task 2).

Content each file must state:
- **`ci-source.md`, `## Local runs on request`.**
  - The declaration line `"localRuns": "on-request"` and that it is valid only with a `ci` block.
  - A `--scope` run takes every selected CI-declared suite from CI. One CI cannot answer exits 3 before any check, with no `report.json` and no pass stamp, naming the suite and the reason, and the way on is to push and re-run or pass `--local`.
  - Exit 3 is never a test failure.
  - `--local` never consults CI and runs each selected suite here, the impact subset or the full command.
  - With neither `--scope` nor `--local`, a run naming a CI-declared suite exits 2.
  - A red job whose log cannot be downloaded fails the suite and names the run URL.
  - The job-log download passes `--allow-escape-sequences`.
  - `--local` means the same without the key.
  - A `--stamp-suite` chunk never consults CI; under the key, a chunk naming a CI-declared suite exits 2 without `--local` and runs here with it (spec Decision 2).
- **`stamp-composition.md` appended sentence.** "Under the declaration's `localRuns: "on-request"` (`ci-source.md`), a chunk whose `--cmd` set names a CI-declared suite is a run on this machine, so it needs `--local` and exits 2 without it; a chunk of `types`, `lint` or a suite with no `ci` source is unaffected."
- **`ci-source.md` line 64, last sentence.** "A change whose risk is platform-specific still runs locally: the caller passes `--local`, and CI is not consulted (under `localRuns`, a run without `--scope` that names a CI-declared suite needs `--local` too)."
- **The 4347 journey, line 24.** After "runs the suite locally", insert "(without the declaration's `localRuns` key; under it the run exits 3 with no verdict, `plugin/skills/test/ci-source.md`)".
- **`ci-source.md` reason table.** The row `` | `local-requested` | `--local` was passed, so CI was not consulted. | `` and the row `` | `not-consulted` | Under `localRuns`, an earlier suite already left the run with no verdict, so CI was not asked about this one. | ``. Line 40 becomes "Without `localRuns`, every other outcome runs the suite locally…" plus "under it, the run exits 3 (`## Local runs on request`)". The `ci-log-unavailable` row gains "(without `localRuns`)".
- **`suite-slots.md` Lanes bullet.** Under `localRuns: "on-request"` (`ci-source.md`) a CI-declared suite runs here only with `--local`. A run that exits 3 has taken no slot.
- **`verification.md:100`.** "…and, without the declaration's `localRuns` key, falls back to the local run with a named reason otherwise (under it the run exits 3 or needs `--local`)."
- **`ci-skips-drafts.md:51` appended sentence.** "Under `localRuns: "on-request"` (`test/ci-source.md`) neither shape degrades quietly: each of those verifies stops with exit 3 instead of running the suite here."
- **`docs/plugin-structure.md`.**
  - Line 58: replace "or returns a named fallback reason and the suite runs locally)" with "or returns a named fallback reason — the suite then runs locally, or, under the declaration's `localRuns: "on-request"` (#5369), verify.js exits 3 with no verdict; the job-log download passes `--allow-escape-sequences`, retried once without it for a gh that rejects the flag)".
  - Line 204: insert `[--local] ` after `[--stamp-suite] ` in the synopsis, and append a clause: "`--local` (#5369) runs every selected suite here and never consults a `ci` source; under `localRuns: "on-request"` a `--scope` run CI cannot answer exits 3 (no verdict yet, never a test failure; no report.json, no pass stamp) and a run naming a CI-declared suite with neither `--scope` nor `--local` exits 2 (skills/test/ci-source.md)".

- [ ] **Step 1: Write the failing test** `tests/verify-local-runs-docs-conformance.test.js`. It reads through `readText`, slices with `sectionOf`/`lineStartingWith`, and uses `missingFactsOf` and `assertEachPatternGoesRed` from `tests/helpers/conformance-asserts.js`.
  - **Facts for `ci-source.md`'s `## Local runs on request` section**, each matching exactly once in the slice:
    - `/"localRuns": "on-request"/`
    - `/only with a `ci` block|valid only together with a `ci` block/` — pick the wording the prose uses and pin that one.
    - `/exits 3/`
    - `/never a test failure/`
    - `/`--local`/` — scoped to its defining sentence; choose the anchor so it matches once.
    - `/exits 2/`
    - `/--allow-escape-sequences/`
    - `/names the run URL/`
    - `/--stamp-suite/`
  - **Facts for `stamp-composition.md`'s Chunked verification paragraph** (sliced from `**Chunked verification (#3002).**` to the next blank line): `/localRuns: "on-request"/` and `/needs `--local`/`.
  - **Facts for the `## Fallback reasons` section**: the `local-requested` and `not-consulted` rows.
  - **Facts for `suite-slots.md`'s `## Lanes` section**: the `localRuns` bullet.
  - **Facts for `docs/plugin-structure.md`**: the `node plugin/bin/verify.js` line (via `lineStartingWith`) holds `[--local]`, `exits 3` and `exits 2`, and line 58's `ci-source.js (#4347` entry holds `localRuns` and `--allow-escape-sequences`.
  - **Twin pins:** `` assert.ok(reasonTable.includes(`| \`${LOCAL_REQUESTED}\` |`)) ``, the same for `NOT_CONSULTED`, and `assert.strictEqual(EXIT_NO_VERDICT, 3)` beside a literal `/exits 3/` pin.
  - **Retirement sweep.** Walk every `.md` under `plugin/skills/` and `.claude/skills/`, plus `docs/plugin-structure.md`, whitespace-collapsed. Assert none contains any of these retired sentences, case-sensitive:
    - `Every other outcome runs the suite locally, exactly as selected`
    - `and falls back to the local run with a named reason otherwise.`
    - `the caller runs verify.js without \`--scope\`, which never consults \`ci\``
    - `or returns a named fallback reason and the suite runs locally)`
  - Assert the walked list holds at least one `.claude/skills/` file, and plant each retired sentence in a copy of one file to prove the sweep catches it.
  - **Go-red controls:** one `assertEachPatternGoesRed(slice, FACTS, missing)` call per fact list. Each control is preceded by `assert.notEqual(mutated, original)` inside the helper.

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/verify-local-runs-docs-conformance.test.js`
Expected: FAIL — `sectionOf` throws on the missing `## Local runs on request` heading, and the retired sentences are still present.

- [ ] **Step 3: Edit the seven files** with the content listed above. Before saving `ci-skips-drafts.md` and `ci-source.md`, re-read the pinned token list in Global Constraints. The appended Coexistence sentence must repeat none of them, and `ci-source.md`'s `## CI that skips draft PRs` section stays byte-identical.

- [ ] **Step 4: Run the tests to verify they pass, sibling pins included**

Run: `node --test tests/verify-local-runs-docs-conformance.test.js tests/ci-skips-drafts-conformance.test.js tests/bin-lib/verify/snippet-conformance.test.js tests/stamp-status-discovery-prose-conformance.test.js tests/pr-first-merge.test.js tests/verify-scope-declaration.test.js`
Expected: PASS. `ci-skips-drafts-conformance` still finds each Coexistence and CI-source fact exactly once.

Then check the byte rail and the moved-prose pins:

Run: `wc -c plugin/skills/test/verification.md plugin/skills/test/ci-source.md plugin/skills/test/suite-slots.md plugin/skills/_shared/ci-skips-drafts.md`
Expected: `verification.md` under 47,101 B. The rest are far under 52,500.

Run: `git grep -n -F -e "falls back to the local run" -e "Every other outcome runs the suite locally" -e "which never consults" -e "degrades harmlessly" -- tests plugin .claude/skills docs/plugin-structure.md`
Expected: only `plugin/skills/_shared/ci-skips-drafts.md:51` ("degrades harmlessly", kept and qualified by the appended sentence) and the new test file's retired-sentence list. The control was run while authoring against HEAD: the same grep lists `plugin/skills/test/ci-source.md:40`, `:64`, `plugin/skills/test/verification.md:100` and `plugin/skills/_shared/ci-skips-drafts.md:51`, so it can match its targets.

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/test/ci-source.md plugin/skills/test/suite-slots.md plugin/skills/test/stamp-composition.md plugin/skills/test/verification.md plugin/skills/_shared/ci-skips-drafts.md docs/plugin-structure.md docs/journeys/take-the-full-suite-verdict-from-ci-4347.md tests/verify-local-runs-docs-conformance.test.js
git commit -m "Document localRuns, --local and exit 3 — ci-source, suite-slots, plugin-structure; no doc says a CI suite always runs locally, refs #5369"
```

- [ ] **Step 6: Run the touched and adjacent verify suites together (scoped regression pass)**

Run: `node --test tests/bin-lib/verify/declaration.test.js tests/bin-lib/verify/args.test.js tests/bin-lib/verify/ci-source.test.js tests/bin-lib/verify/ci-cli.test.js tests/bin-lib/verify/impact-cli.test.js tests/bin-lib/verify/cli.test.js tests/bin-lib/verify/cli-slot.test.js tests/bin-lib/verify/cli-slot-queue.test.js tests/bin-lib/verify/cli-stamp-discovery.test.js tests/bin-lib/verify/cli-scope-integration.test.js tests/bin-lib/verify/cli-baseline.test.js tests/bin-lib/verify/cli-flaky-preexisting.test.js tests/bin-lib/timing/derive.test.js tests/verify-local-runs-docs-conformance.test.js tests/ci-skips-drafts-conformance.test.js tests/windows-hide-spawn-conformance.test.js tests/gh-host-seam-conformance.test.js tests/raw-markdown-read-conformance.test.js tests/path-stub-helper.test.js`
Expected: PASS, with 0 failing and the raw `# fail 0` line quoted in the handoff. This proves AC4.2: no pre-existing test in these files was edited except `ci-source.test.js`'s log routes and `ci-cli.test.js`'s fake. Those changed only how the fake answers, never an expected output. Any other change to a pre-existing assertion is a defect.

- [ ] **Step 7: No driver hand-off is owed.** #5370's record body already names `plugin/bin/lib/driver/steps.js`'s `testStep` as a deliverable (added after the first plan review). The implementer posts nothing and writes nothing for this step.

## Acceptance-criterion coverage

| AC clause | Task(s) | Test that proves it |
|---|---|---|
| AC1.1 — unpushed HEAD under the key exits 3 before any check, prints `head-not-pushed` and both ways on, no pass stamp | 5 | ci-cli `AC1.1: under the key an unpushed HEAD exits 3 …` |
| AC1.2 — CI answer available under the key: verdict from CI, no local test of that suite | 5 | ci-cli `AC1.2: under the key a green CI job …` |
| AC2.1 — `--local` makes no gh call and runs the impact subset here | 5 | ci-cli `AC2.1: under the key --local makes no gh call …`; impact-cli `AC2.1: … runs the impact subset here …` |
| AC2.2 — selection falls back: full command here | 5 | impact-cli `AC2.2: … runs the full command here when selection falls back` |
| AC3.1 — unscoped `--cmd tests=…` under the key exits 2 naming both flags | 6 | ci-cli `AC3.1: …` |
| AC3.2 — with `--local` it runs the full command | 6 | ci-cli `AC3.2: …` |
| AC4.1 — without the key, behavior as before incl. the local fallback | 3, 5 | ci-source `AC4.1: …`; ci-cli `AC4.1: without the key an unpushed HEAD still runs the suite here …`; the pre-existing #4347 tests unchanged |
| AC4.2 — no existing test changes its expected output | 2, 7 | args `AC4.2: without --local the parsed result carries no local key`; Task 7 Step 6's unchanged-suite run |
| AC5.1 — `localRuns` with no `ci` fails validation naming the key | 1 | declaration `AC5.1: …` |
| AC5.2 — any other value fails validation naming the key | 1 | declaration `AC5.2: …` |
| AC6.1 — under the key a suite with no ci source runs here without `--local`; `--stamp-status`/`--changed-files` unaffected | 5, 6 | ci-cli `AC6.1: under the key a suite with no ci source …`; ci-cli `AC6.1: under the key --stamp-status and --changed-files need no --local` |
| AC7.1 — the verify event carries, per CI-declared suite, whether CI answered and the reason, and whether `--local` was passed | 4, 5 | derive `AC7: …`; ci-cli `AC7: a CI-answered run's verify event …`, `AC7: a run with no ci block …`, `AC7: an exit-3 run writes a verify event …` |
| AC8.1 — ci-source.md, suite-slots.md, plugin-structure.md name the key, the flag and exit 3; no shipped doc says a CI suite always falls back locally | 7 | `tests/verify-local-runs-docs-conformance.test.js` (facts, twin pins and retirement sweep) |
| AC9.1 — the log download's argv carries `--allow-escape-sequences`, pinned by a fake that fails without it and answers with it | 3 | ci-source `AC9.1: …` (plus every log test through `logRoute`) |
| AC9.2 — a runner rejecting the flag as unknown gets one retry without it | 3, 5 | ci-source `AC9.2: …`; ci-cli `AC9.2: an older gh …` |
| AC9.3 — under the key a red job with no downloadable log exits 1, names the run URL, runs nothing here | 3, 5 | ci-source `AC9.3: …`; ci-cli `AC9.3: …` |
| Decision 1 — only an unscoped run naming a CI-declared suite exits 2 | 6 | ci-cli `AC3.1: …`; `an unscoped run naming only non-CI checks runs under the key` |
| Decision 2 — a `--stamp-suite` chunk of a CI-declared suite needs `--local`; docs say so | 6, 7 | ci-cli `Decision 2: …` (three tests); docs conformance `stamp-composition.md` and `ci-source.md` facts |
| Decision 3 — exit 3 decided before any check or retry; a stale `report.json` never survives it | 5 | ci-cli `a red first suite and an unanswered second suite …`; `AC1.1: …` (stale report removed) |
