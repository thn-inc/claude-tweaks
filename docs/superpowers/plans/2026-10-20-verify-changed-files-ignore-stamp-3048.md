# verify.js --changed-files --ignore-stamp Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pipeline QA story selection and the design CLI gate compare against the run's whole branch diff, not only the commits after `/build`'s verification stamp.

**Architecture:** An additive, opt-in `--ignore-stamp` flag on `verify.js --changed-files`. `changedFilesMode` passes `stamp: null` into `resolveBase` when it is set, so base resolution falls straight through to `--base` / the `--integration-branch` merge-base — the path `resolveBase` already takes when no usable stamp exists. `resolveBase` itself is not changed (the record's Key Files list it as a hypothesis; passing a null stamp already skips the anchor, and keeps `--scope`'s callers untouched). Two skill-prose call sites switch to the new form; `affected` keeps the stamp-anchored set.

**Tech Stack:** Node 18+ CommonJS, `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-10-20T124340-record-3048/work/3048-spec.md`

**Scope keywords:** --changed-files

## Global Constraints

- `--ignore-stamp` is opt-in; every existing `--changed-files` caller's behavior is unchanged.
- Outside `--changed-files` (a check run, `--stamp-status`) `--ignore-stamp` is a usage error, exit 2.
- An unresolvable base under `--ignore-stamp` is exit 1 with a message, never an empty list; the `warning: resolved base equals HEAD — diff will be empty` field still applies.
- `/claude-tweaks:test affected`, `qa affected`, and `verification.md`'s Re-verify scoping keep the stamp-anchored form.
- `plugin/skills/test/verification.md` is 48,742 B against the 52,500 B rail (`RAIL_BYTES`) — its addition stays under ~500 B (headroom after: ~3.2 KB).

## AC interpretation (logged as a premise note)

AC1's literal text puts the stamp at A with source commit B after it; a stamp-anchored set would then include B, contradicting "returns only C's files". The reporter's real scenario — and the one the tests build — is: integration-branch merge-base A, source commit B, full verify pass stamping `fullSha = B`, bookkeeping commit C. Stamp-anchored → C only; `--ignore-stamp` → B and C.

## Review Focus

1. `--ignore-stamp` with a stamp present but no `--base`/`--integration-branch` — must exit 1, not fall back to the stamp (Task 2 test).
2. `--ignore-stamp` combined with `--base` — `--base` still wins (Task 2 test).
3. `--ignore-stamp` passed to `--stamp-status` — usage error, not silently ignored (Task 1 test).
4. `--ignore-stamp` on a check run with `--scope` — still a usage error (Task 1 test).
5. A prose edit that drops `--ignore-stamp` from one of the two call sites — the conformance pin must go red (Task 3 go-red control).

---

### Task 1: Parse and validate `--ignore-stamp`

**Files:**
- Modify: `plugin/bin/lib/verify/args.js` (USAGE string `:15`, `tokenize`, `toResult`, `validateStampStatus`, `validateCheckRun`)
- Test: `tests/bin-lib/verify/args.test.js`

**Interfaces:**
- Produces: `parseArgs(argv).ignoreStamp: boolean` (always present, `false` by default). Constant `IGNORE_STAMP_MODE_CONFLICT = '--ignore-stamp applies only to --changed-files'`.

- [ ] **Step 1: Write the failing tests** in `tests/bin-lib/verify/args.test.js`:
  - Add `ignoreStamp: false` to the existing full-shape `deepStrictEqual` (line ~18) right after `changedFiles: false` — the return shape widens.
  - `test('AC3.1: --ignore-stamp parses under --changed-files', …)`: `parseArgs(['--changed-files', '--ignore-stamp', '--integration-branch', 'main']).ignoreStamp === true`.
  - `test('AC3.1: --ignore-stamp on a check run is a usage error', …)`: `assert.throws(() => parseArgs(['--cmd', 'tests=npm test', '--ignore-stamp']), { message: '--ignore-stamp applies only to --changed-files' })`; same for `['--cmd','tests=x','--scope','d.json','--ignore-stamp']`.
  - `test('AC3.1: --ignore-stamp with --stamp-status is a usage error', …)`: same message for `['--stamp-status', '--ignore-stamp']`.
  - `test('USAGE names --ignore-stamp on the --changed-files line', …)`: `assert.match(USAGE, /--changed-files \[--base <ref>\] \[--integration-branch <name>\] \[--ignore-stamp\]/)`.

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/bin-lib/verify/args.test.js`
Expected: FAIL (unknown flag: --ignore-stamp / missing `ignoreStamp` key)

- [ ] **Step 3: Implement** — `tokenize` sets `ignoreStamp` on the bare `--ignore-stamp` flag (beside `--changed-files`); `toResult` passes it through; `validateStampStatus` and `validateCheckRun` throw `IGNORE_STAMP_MODE_CONFLICT` (in `validateCheckRun`, before the `--cmd` floor so a no-`--cmd` invocation reports this message). USAGE's `--changed-files` alternative gains ` [--ignore-stamp]`. One comment line above the constant naming #3048, matching the `RUN_MODE_CONFLICT` neighbours.

- [ ] **Step 4: Run to verify they pass**

Run: `node --test tests/bin-lib/verify/args.test.js`
Expected: PASS

- [ ] **Step 5: Commit** `args.js` + `args.test.js` — `Add --ignore-stamp to verify.js arg parsing — #3048`.

### Task 2: Honor `--ignore-stamp` in `changedFilesMode`

**Files:**
- Modify: `plugin/bin/verify.js:175-208` (`changedFilesMode` and its header comment)
- Test: `tests/bin-lib/verify/cli.test.js`

**Interfaces:**
- Consumes: `parsed.ignoreStamp` (Task 1). Tests sit beside the `--changed-files` tests at cli.test.js ~1229-1330, reusing `tmpGitRepo`, `commitFile`, `runCli`, `stampOf`.

- [ ] **Step 1: Write the failing tests** (one shared fixture helper `stampThenBookkeeping()` inside the file: `tmpGitRepo()`; `integration = current branch`; `git checkout -q -b feat`; `A = merge-base`; `commitFile(r, 'src/b.js', '1')` → B; full verify `runCli(['--cmd','tests=node -e 0'])` exit 0 so `stampOf(r.gitDir).fullSha === B`; `commitFile(r, 'stories/c.yaml', 'x')` → C):
  - `test('AC1.1/AC1.2: stamp-anchored --changed-files still returns only the post-stamp bookkeeping (#3048)', …)`: `['--changed-files','--integration-branch', integration]` → exit 0, `base === B`, `files` deepEqual `['stories/c.yaml']`.
  - `test('AC1.1/AC1.2: --ignore-stamp returns the merge-base diff — the build commit and the bookkeeping (#3048)', …)`: `['--changed-files','--ignore-stamp','--integration-branch', integration]` → exit 0, `base === A`, `files` deepEqual `['src/b.js','stories/c.yaml']`, no `warning` key.
  - `test('AC2.1: --ignore-stamp with a usable stamp but no --base/--integration-branch exits 1 — never falls back to the stamp, never an empty list', …)`: same fixture, `['--changed-files','--ignore-stamp']` → `code === 1`, stderr matches `/could not resolve a base/`, stdout empty.
  - `test('--ignore-stamp still honors an explicit --base', …)`: `['--changed-files','--ignore-stamp','--base', B]` → `base === B`, files `['stories/c.yaml']`.

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/bin-lib/verify/cli.test.js`
Expected: FAIL after Step 1 on the `--ignore-stamp` tests (stamp anchor still used → `base === B`); the stamp-anchored test already passes (it pins existing behavior).

- [ ] **Step 3: Implement** — in `changedFilesMode`, pass `stamp: parsed.ignoreStamp ? null : priorStamp` to `resolveBase`; nothing else changes (the HEAD-equality `warning` still applies). Extend the function's header comment by one sentence naming `--ignore-stamp` (#3048).

- [ ] **Step 4: Run to verify they pass**

Run: `node --test tests/bin-lib/verify/cli.test.js tests/bin-lib/verify/args.test.js tests/bin-lib/verify/changed-files.test.js`
Expected: PASS

- [ ] **Step 5: Commit** `verify.js` + `cli.test.js` — `Skip the stamp anchor under verify.js --changed-files --ignore-stamp — #3048`.

### Task 3: Switch pipeline QA selection and the design gate; document the flag

**Files:**
- Modify: `plugin/skills/test/SKILL.md:70` (pipeline `VERIFICATION_PASSED=true` + stories bullet), `plugin/skills/test/SKILL.md:142` (`qa affected` step 1 — its "so the three never disagree" claim becomes false)
- Modify: `plugin/skills/test/design-gate.md:9`
- Modify: `plugin/skills/test/verification.md` (one ≤500 B paragraph after the Re-verify scoping table, ~line 78)
- Modify: `docs/plugin-structure.md:169` (verify CLI usage line: `--changed-files [--base <ref>] [--integration-branch <name>] [--ignore-stamp]`)
- Modify: `docs/skill-graph.md:571` (`/design-wrapper` row: the set is the `--ignore-stamp` branch diff `/test`'s pipeline QA selection reads, not the `affected` set)
- Test: `tests/test-skill-affected-conformance.test.js`

**Consumer classification (`--changed-files` readers):** `test/SKILL.md:70` pipeline selection → switch; `design-gate.md:9` → switch; `test/SKILL.md:39/121` `affected` → keep; `test/SKILL.md:44/142` `qa affected` (also reached from `review/code-mode-steps.md:360`) → keep, reword the "never disagree" sentence; `plugin/bin/lib/flow/preflight.js:314` pack fact → keep (informational, not QA selection).

- [ ] **Step 1: Write the failing test** in `tests/test-skill-affected-conformance.test.js`: one assertion function `assertIgnoreStampSites(skill, gate)` that (a) slices `skill`'s pipeline bullet (from ``- `VERIFICATION_PASSED=true` + stories exist`` to the next newline) and asserts it contains `` --changed-files --ignore-stamp --integration-branch {ref}` ``; (b) asserts `gate` contains the same substring; (c) slices the `- **`affected`**` bullet and the `qa affected` step 1 line and asserts neither contains `--ignore-stamp`. Tests:
  - `test('AC4.1/AC4.2: pipeline QA selection and design-gate.md name --ignore-stamp; affected and qa affected do not (#3048)', …)` — calls it on the live files.
  - `test('go-red: dropping --ignore-stamp from design-gate.md fails the AC4 pin', …)` — `assert.throws(() => assertIgnoreStampSites(skill, gate.replace('--changed-files --ignore-stamp', '--changed-files')))`.
  - `test('go-red: adding --ignore-stamp to the affected bullet fails the AC4 pin', …)` — mutate the `affected` bullet's `--changed-files --integration-branch` to the `--ignore-stamp` form, expect throw.

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/test-skill-affected-conformance.test.js`
Expected: FAIL (live prose has no `--ignore-stamp`)

- [ ] **Step 3: Edit the prose.** `SKILL.md:70`: insert `--ignore-stamp` into the command and, right after it, one clause: `` — `--ignore-stamp` (#3048): the run's branch diff, since `/build` Common Step 5 stamps before bookkeeping commits (a new story YAML) land and a stamp-anchored set would see only those ``. `SKILL.md:142`: replace "the same `{base, files}` the `affected` argument and the pipeline story filter read, so the three never disagree" with "the same `{base, files}` the `affected` argument reads (the pipeline story filter adds `--ignore-stamp` for the whole branch diff)". `design-gate.md:9`: same `--ignore-stamp` insertion and the "same shared changed-file set" wording re-pointed to `test/SKILL.md`'s pipeline story selection. `verification.md`: the one paragraph — `--ignore-stamp` skips the stamp anchor and resolves from `--base`/`--integration-branch` (same exit-1 and base-equals-HEAD warning); `affected`/`qa affected`/re-verify keep the anchor; pipeline QA selection and `design-gate.md` pass it. Docs lines as listed in Files.

- [ ] **Step 4: Run to verify it passes, then measure**

Run: `node --test tests/test-skill-affected-conformance.test.js tests/test-skill-qa-stamp-conformance.test.js tests/design-wrapper-caller-precheck.test.js`
Expected: PASS
Run: `wc -c plugin/skills/test/verification.md plugin/skills/test/SKILL.md plugin/skills/test/design-gate.md`
Expected: every file < 52500

- [ ] **Step 5: Commit** the five prose/doc files + the test — `Select pipeline QA stories against the branch diff via --ignore-stamp — #3048`.

## Spec coverage

| Spec item | Task |
|---|---|
| Deliverable 1 / AC3.1 | Task 1 |
| Deliverable 1 / AC1.1, AC1.2, AC2.1 | Task 2 |
| Deliverables 2-4 / AC4.1, AC4.2 | Task 3 |
| AC5.1 (existing verify suites pass) | Task 2 Step 4 + Common Step 5's full `npm test` |
| Gotcha: usage string + `--changed-files` mentions | Task 1 (USAGE), Task 3 (verification.md, docs) |
