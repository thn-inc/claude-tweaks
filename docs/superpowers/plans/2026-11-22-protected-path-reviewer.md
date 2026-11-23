# Protected Path Behind the Driver's Reviewer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the policy key `express-driver-protected-paths` (`refuse` default, `reviewer`) so the pipeline driver, with its reviewer on, admits a record whose protected Key Files are all merge-time families, lets the post-build `check` report (not refuse) merge-time protected paths, and always leaves such a record at `pending-review`; build-time families keep refusing under every value.

**Architecture:** Same shape as #6018. `eligibility.js` gains `BUILD_TIME_PROTECTED_RES` and `isBuildTimeProtectedPath`, a driver-only `protectedPathsNeedReviewer` eligibility option, a `protected-path` value from `widenings()`, and a `reportProtectedPaths` option on `evaluateDiffBounds` that moves merge-time protected matches into a `protectedPaths` field. `express-lane.js check` gains `--protected-paths reviewer`. `steps.js` resolves the key, derives the eligibility option and the widening from it, passes the check flag only when the key is `reviewer` and `ctx.reviewer.on === true`, and adds `protected-path` to `ctx.widenedBy` when check reports protected paths, so `merge.js`'s existing `widened-admission` entry stop (unchanged) ends the record at `pending-review`.

**Tech Stack:** Node 18+ CommonJS, `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-11-22T163434-record-6019/work/6019-spec.md` (record #6019)

Scope keywords: widenings, eligibilityOptions, reviewerOffWidened

## Global Constraints

- New policy key: `{ key: 'express-driver-protected-paths', type: 'enum', values: ['refuse', 'reviewer'], default: 'refuse', policyOnly: true, category: 'merge-safety', tier: 'advanced' }`. The default `refuse` reproduces today on every path.
- `REASONS` in `eligibility.js` is a wire contract: `REASONS.protectedPath(p)` stays `` `protected path: ${p}` `` (the funnel in `tools/pipeline-cost-report/funnel.js` keys it by its head; no funnel edit).
- Build-time families keep refusing under `reviewer`, in eligibility and in `check`: `.github/`, `.gitlab-ci.yml`, `.circleci/`, `.githooks/`, `.husky/`, `package.json`, `.claude/settings*.json`, `.mcp.json`. Only the merge-time families pass behind the reviewer: `hooks/`, `hooks.js`, `hooks.sh`, `skills/_shared/`, `CODEOWNERS`, `.claude-tweaks/policy.yml`, `.claude-tweaks/verify-scope.json`. The build-time subset is a frozen constant in `eligibility.js`, applied only to a path `isProtectedPath` also protects.
- `merge-sensitive-paths` is unchanged: a merge-sensitive path refuses in eligibility and in `check` under every value, and a path both protected and merge-sensitive keeps its `protected path:` violation under the flag.
- The express lane must not change: `express-lane.js check` without the new flag, the `gate` verb, the express half of `queue.js` and every express eligibility call pass no new option, and absent means today's rule. `evaluateDiffBounds` returns `protectedPaths` only when `reportProtectedPaths === true`, so its express return shape is byte-identical.
- `review.js`'s evidence-path guard (`isProtectedOrSensitive`, `PATH_RULES`) is not changed.
- `.claude-tweaks/policy.yml` must not change (the trial sub-issue sets the trial values).
- The `check` flag takes a value (`parseArgs` makes every flag take one): `--protected-paths reviewer`; any other value is a usage error (exit 2). A `check` that rejects the flag (an older build) exits non-zero, which `checkStep` already turns into a `blocked` failure, so the path is never passed.
- Commits: `{Verb} {what} — {detail}` subjects, `refs #6019` in the body, never `closes`/`fixes`.
- Governing skill `.claude/skills/policy-key-addition` (applies to `policy-schema.js`, `_shared/policy-schema*.md`, `policy-schema-coverage.md`, `docs/journeys/resolve-a-policy-key.md`), quoted:
  - "`key` (flat kebab-case, `tests/policy-key-naming.test.js`), `type` (`boolean`, `enum`, `integer`, `string`, `list` or `map`), `values` for an enum, and `default` unless the default is derived … `summary`, `category` and `tier` are required (`tests/policy-schema-metadata.test.js`)."
  - "An enum that gates a code table gets a test asserting its `values` equal that table's keys" — this key gates no code table (its two values select a boolean option), so no twin test applies.
  - "The core tier has an enforced cap of 12 (`tests/policy-schema-metadata.test.js`) and sits at it, so a new key is `advanced` unless it replaces a core one."
  - "`tests/policy-schema.test.js` pins `POLICY_KEYS.length`. Bump it in the same commit, and rewrite the `Last bump: {old} -> {new}, #{record}` line directly above the assertion — the test fails when that line's new value differs from the pin."
  - "Every key needs a table row there that starts `` | `{key}` | `` (`tests/policy-key-naming.test.js`), and its summary must not be copied verbatim from the row's `summary` (`tests/policy-schema-metadata.test.js`). State the value the resolver returns for unset, set and malformed input, from the code, not from intent."
  - "**A `policyOnly` key** is also named in the `policyOnly` bullet of `_shared/policy-schema-coverage.md`'s "Canonical read path carve-outs", which lists every key carrying the flag"
  - "**A `policyOnly` key** is also named in the step 3 Red flags list of `docs/journeys/resolve-a-policy-key.md`, which lists every `policyOnly` flat key with its record."
  - "Add the key to `FACTORY_REFUSED_KEYS` in `plugin/bin/lib/policy-factory.js` when it is a per-run human decision, the human-in-control switch, or an executed string specific to one repository … A key outside the list is settable from the factory layer, so check that a user-wide default is safe for it." — decision: factory-settable, as `express-driver-max-risk`; a `reviewer` default admits nothing without the reviewer on and always ends at a human merge. Say so in the comment above the row.
  - "Say the decision in the comment above the row, as both of those do." (the who-may-set-it decision)
  - "**A key joining a family reaches only the callers that list it.** … Grep every reader of a sibling key, in `plugin/bin/` and in the `node -e` fences under `plugin/skills/`." — readers of the `express-driver-*` family: `steps.js` `POLICY_KEYS`/`eligibilityOptions`, and `queue.js` `SECOND_KEYS` (its driver half calls `eligibilityOptions`, which throws on a key the resolver was not asked for); `budget.js` reaches it through `eligibilityOptions` (git grep, this plan's authoring).
- Governing skill `.claude/skills/driver-step-addition` (applies to `steps.js`, `docs/driver.md`): no step is added; its `docs/driver.md` row applies: "Copied by hand. A few tests in `run.test.js` pin named rules in it (the `AC9.1` docs tests, and #5454's tree-stop test), so a change to a pinned rule's wording updates its test too; nothing checks the rest."
- Governing skill `.claude/skills/gh-api-module-pattern` (applies to the `express-lane.js check` fake in `tests/bin-lib/driver/run.test.js`): "**A fake for a `plugin/bin` CLI that a module runs on its `deps.node` seam refuses what the real CLI refuses.** An accept-anything fake keeps a call green that production rejects on every run." — Task 4's check fakes return exit 2 for a `--protected-paths` value other than `reviewer`.
- Rail: `plugin/skills/_shared/policy-schema.md` is 49,227 B and `policy-schema-coverage.md` 44,554 B against `RAIL_BYTES` 52,500 B; each gains one short line, no split needed.

Waived .claude-tweaks/policy.yml: the spec forbids changing it here (Gotchas); no task writes it.
Waived plugin/bin/lib/driver/merge.js: read only — its entry stop reads `ctx.widenedBy` (any non-empty list stops at `widened-admission` before the supplier); Task 4's AC4 test drives it unchanged.
Waived plugin/bin/drive.js: read only — the `--check` line prints `ctx.widenedBy` (run.js line 530); Task 4's AC7.2 test reads it.
Waived tools/pipeline-cost-report/funnel.js: read only — keys `protected path` by its head; the refusal string is unchanged.

The auth risk flag's proof is the proof line in Task 4 Step 3.

## Review Focus

1. A Key File spelled to dodge the build-time match (`./.github/workflows/ci.yml`, `plugin/x/../../.github/ci.yml`, `.github\\ci.yml`) must still refuse under `reviewer`: `isBuildTimeProtectedPath` canonicalises like `isProtectedPath` — Task 2 adds these three spellings to the AC9 test.
2. A rename from a build-time path to a merge-time Key File (`.github/workflows/ci.yml` → `plugin/hooks/ci.js`) must stay a violation under the flag, while a merge-time `oldPath` is reported: Task 2 adds the build-time `oldPath` case beside AC5.
3. A record that is also risk-widened lists both widenings, in the order `['risk', 'protected-path']`, and a check-time widening is never pushed twice: Task 2 (`widenings`) and Task 4 (a protected Key File record whose check also reports a protected path keeps one `protected-path`).
4. A check envelope under the flag that lacks an array `protectedPaths` (malformed or older output that still exited 0) must fail closed to `pending-review`, never read as "none": Task 4 adds `protected-path` to `ctx.widenedBy` in that case and tests it.
5. The queue pull's driver half must ask the same question as the eligibility step, or a protected-Key-File record is bundled when the driver would take it (or kept when it would refuse): Task 5's tests under `reviewer` with the reviewer on and off.

---

### Task 1: The `express-driver-protected-paths` key

**Role:** integration

**Files:**
- Modify: `plugin/bin/lib/policy-schema.js` (new row after `express-driver-max-risk`, line 121, with its comment)
- Modify: `plugin/skills/_shared/policy-schema-express-driver.md` (new row after `express-driver-max-risk`)
- Modify: `plugin/skills/_shared/policy-schema.md:179` (stub `| Key |` table: add the key after `express-driver-max-risk`)
- Modify: `plugin/skills/_shared/policy-schema-coverage.md:102` (policyOnly bullet)
- Modify: `docs/journeys/resolve-a-policy-key.md:48` (step 3 Red flags) and its history list (line 107 area)
- Test: `tests/policy-schema.test.js` (count pin lines 46-47; policyOnly table near line 947; new resolve test beside the AC8 #6018 one at line 982)

**Interfaces:**
- Produces: `resolvePolicyKeys(['express-driver-protected-paths'], …)` returns `{ value: 'refuse', source: 'default' }` unset, `{ value: v, source: 'policy' }` for `refuse|reviewer`, `{ value: 'refuse', source: 'default', invalid: true }` for anything else.

- [ ] **Step 1: Write the failing tests** in `tests/policy-schema.test.js`
  - Change the pin to `// Last bump: 119 -> 120, #6019` / `assert.strictEqual(POLICY_KEYS.length, 120);`.
  - Add `{ id: 'AC1 (#6019)', key: 'express-driver-protected-paths', def: 'refuse', other: 'reviewer', policyVal: 'reviewer' }` to the policyOnly table near line 947 (match the neighbouring rows' `other`/`policyVal` semantics: read two rows above it first).
  - `test('AC1.1 (#6019): express-driver-protected-paths resolves refuse unset, each enum value from policy, and a malformed value to refuse with invalid', …)`: unset (`policyRaw: ''`) deep-equals `{ value: 'refuse', source: 'default' }`; `refuse` and `reviewer` each give `{ value: v, source: 'policy' }`; `Reviewer`, `on`, `true` each give `{ value: 'refuse', source: 'default', invalid: true }`; `policy-schema-express-driver.md` contains a line matching `` /^\| `express-driver-protected-paths` \| /m ``; `policy-schema.md` contains `` | `express-driver-protected-paths` | ``.

- [ ] **Step 2: Run the tests to verify they fail**
Run: `node --test tests/policy-schema.test.js`
Expected: FAIL after Step 1 (count 119 ≠ 120; key unknown to the resolver)

- [ ] **Step 3: Add the row and its prose**
  - `policy-schema.js`: the Global Constraints row; a fresh `summary` (not copied into any `.md`); comment above it: #6019; `policyOnly` because it decides whether autonomous machinery may take a protected path, so a `--run` config never loosens it; factory-settable (not in `FACTORY_REFUSED_KEYS`) because a `reviewer` default admits nothing without the reviewer on and always ends at a human merge; build-time families refuse under both values.
  - `policy-schema-express-driver.md` row: canonical home `policy.yml`, owner `bin/drive.js` (#6019), default `refuse`; meaning: what a protected path does in the driver: `refuse` (today) or `reviewer`, under which a record whose protected Key Files are all merge-time families (name them) is admitted only with the reviewer step on, `check` reports such paths instead of refusing them, and the record always stops at `pending-review` for a human merge; build-time families (name them) refuse under both values; unset or malformed (`invalid: true`, e.g. `Reviewer`, `on`) gives `refuse`; `policyOnly`, for the same reason as its siblings.
  - Add the key (#6019) to the `policyOnly` list in `policy-schema-coverage.md:102` after `express-driver-max-risk` (#6018), and to the Red flags list in `docs/journeys/resolve-a-policy-key.md:48` after `express-driver-max-risk`, #6018, plus a history bullet `- Step 3 updated during build of #6019 (express-driver-protected-paths) — the key is policyOnly, so step 3's red flag lists it`.

- [ ] **Step 4: Run the tests to verify they pass**
Run: `node --test tests/policy-schema.test.js tests/policy-key-naming.test.js tests/policy-schema-metadata.test.js tests/policy.test.js tests/resolve-policy-control-mode.test.js`
Expected: PASS

- [ ] **Step 5: Commit** `Add the express-driver-protected-paths policy key — refuse by default, reviewer lets merge-time paths through`

### Task 2: Eligibility and diff bounds behind the reviewer

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/express/eligibility.js`
- Modify: `docs/plugin-structure.md:122` (the `eligibility.js` description: name the new option, `widenings`' `protected-path`, `evaluateDiffBounds`' `reportProtectedPaths`/`protectedPaths`, `BUILD_TIME_PROTECTED_RES`/`isBuildTimeProtectedPath`)
- Test: `tests/bin-lib/express/eligibility.test.js`

**Interfaces:**
- Produces (exported from `eligibility.js`):
  - `BUILD_TIME_PROTECTED_RES`: frozen array of the eight build-time regexes, each with the same `source` as its `PROTECTED_PATH_RES` entry (`.github/`, `.gitlab-ci.yml`, `.circleci/`, `.githooks/`, `.husky/`, `package.json`, `.claude/settings*.json`, `.mcp.json`).
  - `isBuildTimeProtectedPath(path) -> boolean`: `isProtectedPath(path)` and a `BUILD_TIME_PROTECTED_RES` match on `canonicalPath(path)`.
  - `evaluateRecordEligibility(issue, { …existing, protectedPathsNeedReviewer })`: only a literal `true` relaxes; then a protected Key File pushes `REASONS.protectedPath(p)` only when `isBuildTimeProtectedPath(p)`. The merge-sensitive check is unchanged.
  - `widenings({ labels, riskCeiling, anyCeremony, keyFiles, protectedPathsNeedReviewer }) -> Array<'risk'|'ceremony'|'protected-path'>`: `'protected-path'` (last) when `protectedPathsNeedReviewer === true`, `keyFiles` is an array and some element `isProtectedPath`.
  - `evaluateDiffBounds(files, { …existing, reportProtectedPaths })`: when `reportProtectedPaths === true`, each protected `f.path` (and protected `oldPath` of a rename) that is neither `isBuildTimeProtectedPath` nor merge-sensitive (`f.isSensitive` for the path, `isSensitivePath(oldPath, sensitivePaths)` for the old path) goes into `protectedPaths` (in encounter order, no duplicates) instead of `violations`; every other protected match stays a `REASONS.protectedPath` violation. The result carries `protectedPaths: string[]` only when `reportProtectedPaths === true`.

- [ ] **Step 1: Write the failing tests** (reuse the file's `OPTS`/`DRIVER`/`ELIGIBLE_LABELS`/`issue`/`f`/`BOUNDS` helpers; `REVIEWER = { ...DRIVER, protectedPathsNeedReviewer: true }`; `MERGE_TIME = ['plugin/hooks/x.js', 'hooks.js', 'a/hooks.sh', 'plugin/skills/_shared/a.md', 'CODEOWNERS', '.claude-tweaks/policy.yml', '.claude-tweaks/verify-scope.json']`; `BUILD_TIME = ['.github/workflows/ci.yml', '.gitlab-ci.yml', '.circleci/config.yml', '.githooks/pre-commit', '.husky/pre-commit', 'package.json', '.claude/settings.json', '.mcp.json']`)
  - `test('AC1.1 (#6019, eligibility half): without the option, or with it false, a hooks/, .github/ or package.json Key File gives today\'s verdict', …)`: for each of `plugin/hooks/x.js`, `.github/workflows/ci.yml`, `package.json` as the record's one Key File, `evaluateRecordEligibility(r, { ...DRIVER, protectedPathsNeedReviewer: false })` and `…{ protectedPathsNeedReviewer: 'true' }` deep-equal `evaluateRecordEligibility(r, DRIVER)`, whose reasons include `` `protected path: ${p}` ``; `evaluateRecordEligibility(r, OPTS)` too.
  - `test('AC10.1 (#6019, eligibility half): under the option each merge-time Key File is eligible and widens by protected-path', …)`: for each `MERGE_TIME` path, `evaluateRecordEligibility(r, REVIEWER).eligible === true` and `widenings({ labels: r.labels, keyFiles: [p], protectedPathsNeedReviewer: true })` deep-equals `['protected-path']`.
  - `test('AC9.1 (#6019, eligibility half): under the option each build-time Key File still refuses with protected path', …)`: for each `BUILD_TIME` path and for `./.github/workflows/ci.yml`, `plugin/x/../../.github/ci.yml`, `.github\\ci.yml` (Review Focus 1), the reasons include `` `protected path: ${p}` ``; `isBuildTimeProtectedPath` is true for every `BUILD_TIME` path and false for every `MERGE_TIME` path and for `src/a.js`.
  - `test('BUILD_TIME_PROTECTED_RES is frozen and inside the protected list (#6019)', …)`: `Object.isFrozen(BUILD_TIME_PROTECTED_RES)`, length 8, every `BUILD_TIME` path is `isProtectedPath`, and the `MERGE_TIME` plus `BUILD_TIME` paths together match every one of the 15 protected families (each `MERGE_TIME`/`BUILD_TIME` path is protected, and the two lists are disjoint under `isBuildTimeProtectedPath`).
  - `test('AC6.1 (#6019): a merge-sensitive Key File refuses under the option exactly as without it', …)`: with `sensitivePaths: ['src/**']` and Key File `src/a.js`, `REVIEWER` and `DRIVER` give equal reasons, including `merge-sensitive path: src/a.js`.
  - `test('widenings protected-path (#6019)', …)`: `[]` when the option is absent/false or `keyFiles` has no protected path or is not an array; `['risk', 'protected-path']` for `labels: ['risk:medium']`, `riskCeiling: 'medium'`, `keyFiles: ['plugin/hooks/x.js']`, option true (Review Focus 3).
  - `test('AC3.1 (#6019, bounds half): reportProtectedPaths moves a merge-time Key File into protectedPaths', …)`: `evaluateDiffBounds([f('plugin/skills/_shared/a.md', 10)], { ...BOUNDS, keyFiles: ['plugin/skills/_shared/a.md'], reportProtectedPaths: true })` gives `withinBounds: true`, `protectedPaths: ['plugin/skills/_shared/a.md']`, `violations: []`; without the option the same call has `violations` `['protected path: plugin/skills/_shared/a.md']` and no `protectedPaths` key (`'protectedPaths' in out === false`).
  - `test('AC4.1 (#6019, bounds half): a protected test file no Key File named is reported under the option', …)`: `[f('src/a.js', 5), f('plugin/hooks/x.test.js', 30)]` with Key File `src/a.js` → `withinBounds: true`, `protectedPaths: ['plugin/hooks/x.test.js']`.
  - `test('AC5.1 (#6019): a rename whose oldPath is protected is reported under the option and refused without it', …)`: entry `{ ...f('src/new.js', 3), oldPath: 'plugin/hooks/old.js' }` with Key File `src/new.js` → under the option `withinBounds: true`, `protectedPaths: ['plugin/hooks/old.js']`; without it `violations` includes `protected path: plugin/hooks/old.js`. Review Focus 2: `oldPath: '.github/workflows/ci.yml'` stays a violation under the option.
  - `test('AC7.1 (#6019): a path both protected and merge-sensitive stays a violation under the option', …)`: `sensitivePaths: ['plugin/hooks/**']`, file and Key File `plugin/hooks/x.js` → `violations` includes both `protected path: plugin/hooks/x.js` and `merge-sensitive path: plugin/hooks/x.js`, `protectedPaths: []`.
  - `test('AC9.2 (#6019, bounds half): build-time paths stay violations under the option', …)`: each `BUILD_TIME` path as a changed Key File gives `` `protected path: ${p}` `` in `violations` and `protectedPaths: []`.

- [ ] **Step 2: Run the tests to verify they fail**
Run: `node --test tests/bin-lib/express/eligibility.test.js`
Expected: FAIL after Step 1 (`BUILD_TIME_PROTECTED_RES` / `isBuildTimeProtectedPath` not exported)

- [ ] **Step 3: Implement** in `eligibility.js` per the Interfaces block. Extend the comment above `PROTECTED_PATH_RES` with the harm model (build-time families act at push/build time, before any merge; merge-time ones only once merged) and the header comment of `evaluateRecordEligibility` with the new driver-only option. Update `docs/plugin-structure.md:122`.

- [ ] **Step 4: Run the tests to verify they pass**
Run: `node --test tests/bin-lib/express/eligibility.test.js tests/bin-lib/express/cli.test.js tests/bin-lib/express/queue.test.js`
Expected: PASS

- [ ] **Step 5: Commit** `Let eligibility and the diff bounds pass merge-time protected paths behind an option — build-time families keep refusing`

### Task 3: `express-lane.js check --protected-paths reviewer`

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/express/cli.js` (USAGE lines 56-60, `VERB_FLAGS.check` line 98, `parseArgs` value check, `runCheck` lines 342-351)
- Modify: `docs/plugin-structure.md:122` (the `cli.js` clause: name `check --protected-paths reviewer`)
- Test: `tests/bin-lib/express/cli.test.js` (beside the `check --max-lines (#5224)` block at line 842)

**Interfaces:**
- Consumes: `evaluateDiffBounds(files, { …, reportProtectedPaths })` (Task 2).
- Produces: `check … [--protected-paths reviewer]`; with it, the proceed envelope's `bounds` carries `protectedPaths: string[]`; without it, the envelope is unchanged. Any value other than `reviewer` exits 2 with `--protected-paths` on stderr.

- [ ] **Step 1: Write the failing tests** (reuse `checkArgv`, the check fixture builder and `run` from the `--max-lines` tests)
  - `test('AC3.1 (#6019): check --protected-paths reviewer on a diff changing a listed _shared Key File proceeds and reports the path', …)`: diff `plugin/skills/_shared/a.md` (within the line bound), record Key File `plugin/skills/_shared/a.md` → exit 0, `action: 'proceed'`, `bounds.withinBounds === true`, `bounds.protectedPaths` deep-equals `['plugin/skills/_shared/a.md']`.
  - `test('AC3.2 (#6019): the same diff without the flag escalates out-of-bounds naming the protected path', …)`: the escalation detail includes `protected path: plugin/skills/_shared/a.md`.
  - `test('#6019: a --protected-paths value other than reviewer is a usage error', …)`: `refuse`, `Reviewer`, `on` → exit 2, stderr matches `/--protected-paths/`; `--protected-paths` with no value → exit 2.
  - `test('AC9.3 (#6019, check half): with the flag a build-time Key File change still escalates', …)`: diff `.github/workflows/ci.yml` as Key File → escalate, detail includes `protected path: .github/workflows/ci.yml`.
  - `test('#6019: the USAGE check line names --protected-paths reviewer as the driver flag', …)`: `USAGE` includes `[--max-lines <n>] [--protected-paths reviewer]` and a line beginning `       --protected-paths reviewer:`.

- [ ] **Step 2: Run the tests to verify they fail**
Run: `node --test tests/bin-lib/express/cli.test.js`
Expected: FAIL after Step 1 (`unknown argument for check: --protected-paths`)

- [ ] **Step 3: Implement** — add the flag to `VERB_FLAGS.check` and the USAGE check line, plus one USAGE line: `       --protected-paths reviewer: the pipeline driver's flag (bin/drive.js); merge-time protected paths are reported in bounds.protectedPaths, not refused`; validate the value in `parseArgs` (`UsageError` naming `--protected-paths`); pass `reportProtectedPaths: flags['--protected-paths'] === 'reviewer'` to `evaluateDiffBounds`; when `bounds.protectedPaths` is non-empty, append `; protected path(s) left for the reviewer and a human merge: {comma-joined}` to the proceed decision text.

- [ ] **Step 4: Run the tests to verify they pass**
Run: `node --test tests/bin-lib/express/cli.test.js`
Expected: PASS

- [ ] **Step 5: Commit** `Give express-lane.js check a --protected-paths reviewer flag — the driver's, reporting merge-time protected paths`

### Task 4: The driver reads the key, widens and passes the flag

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/driver/steps.js` (`POLICY_KEYS` line 125-131 and its comment; `eligibilityOptions` line 281; `eligibilityStep` line 311; new `driverProtectedPathsFlag(ctx)` beside `driverLineBound`; `checkStep` lines 1170-1218)
- Modify: `plugin/bin/lib/express/queue.js:15` (`SECOND_KEYS` gains `'express-driver-protected-paths'` after `'express-driver-max-risk'`, so the driver half's `eligibilityOptions` call never throws; Task 5 does the rest)
- Modify: `plugin/bin/lib/driver/admission.js` (`ADMISSION_REASONS.reviewerOffWidened` text and the header comment's widened-record lines 36-42)
- Modify: `plugin/bin/lib/driver/review.js` (comment lines 79-81 and 321: `widenedBy` may also carry `protected-path`; no code change — `reviewRequired` already turns on for any non-empty `widenedBy`)
- Modify: `docs/driver.md` (line 19 `widenedBy` sentence; Lane bounds section lines 167-178: the new key and its behaviour)
- Modify: `plugin/skills/dispatch/driver-route.md:24` (`widenedBy` lists `risk`, `ceremony` and/or `protected-path`)
- Test: `tests/bin-lib/driver/run.test.js`
- Test: `tests/bin-lib/driver/budget.test.js` (`POLICY_RESOLVED` line 25)
- Test: `tests/bin-lib/driver/admission.test.js` (line 81)
- Test: `tests/bin-lib/driver/review.test.js`
- Test: `tests/bin-lib/express/queue.test.js` (line 61)
- Test: `tests/bin-lib/driver/merge.test.js` (regression run only, no edit)
- Read (no change): `plugin/bin/lib/driver/merge.js` (entry stop reads `ctx.widenedBy`; its live-label recompute has no Key Files and needs none, since the union keeps the run's `protected-path`), `plugin/bin/lib/driver/budget.js` (inherits the option through `eligibilityOptions`), `plugin/bin/drive.js`

**Interfaces:**
- Consumes: Task 1's key; Task 2's `widenings({ …, keyFiles, protectedPathsNeedReviewer })` and `evaluateRecordEligibility(…, { protectedPathsNeedReviewer })`; Task 3's `--protected-paths reviewer` and `bounds.protectedPaths`.
- Produces:
  - `eligibilityOptions(policy)` adds `protectedPathsNeedReviewer: policy['express-driver-protected-paths'].value === 'reviewer'` (the budget pre-screen inherits it).
  - `eligibilityStep` computes `ctx.widenedBy` with `widenings({ labels, riskCeiling, anyCeremony, keyFiles: ctx.keyFiles, protectedPathsNeedReviewer: opts.protectedPathsNeedReviewer })`.
  - `driverProtectedPathsFlag(ctx) -> boolean`: `ctx.shared.policy['express-driver-protected-paths'].value === 'reviewer' && ctx.reviewer && ctx.reviewer.on === true`.
  - `checkStep` appends `['--protected-paths', 'reviewer']` when the flag is true; on `proceed` with the flag, when `bounds.protectedPaths` is a non-empty array, or is not an array at all (Review Focus 4, fail closed), it adds `'protected-path'` to `ctx.widenedBy` if absent.
  - `ADMISSION_REASONS.reviewerOffWidened = 'record is admitted widened (above low risk, with a non-fast-lane ceremony or a protected Key File) and the reviewer step is off for it'`.

- [ ] **Step 1: Write the failing tests**
  - Fixtures: add `'express-driver-protected-paths': 'refuse'` to `run.test.js`'s `POLICY` after `'express-driver-max-risk'`, and `'express-driver-protected-paths': { value: 'refuse' }` to `budget.test.js`'s `POLICY_RESOLVED`; generalise `widenIssue(labels, keyFiles = 1)` to accept an array of Key File paths; make the default check reply (line 456) and any check fake these tests add return `{ code: 2, stderr: 'express-lane.js: --protected-paths must be reviewer' }` when `--protected-paths` is followed by anything but `reviewer` (gh-api-module-pattern rule). `test('#6019: a check that rejects --protected-paths as an unknown argument (an older build) ends the record blocked with no push', …)`: under `REVIEWER_ON` with an unprotected Key File, a check fake returning `{ code: 2, stderr: 'express-lane.js: unknown argument for check: --protected-paths' }` whenever the args carry the flag → the record ends `blocked` and the push step never runs (spec Gotcha: an older build makes the driver refuse, never pass the path).
  - `REVIEWER_ON = { 'express-driver-protected-paths': 'reviewer', 'express-driver-review': 'on' }`; `FAST = ['risk:low', 'ceremony:fast-lane', ...WIDEN_LABELS]`.
  - `test('AC1.2 (#6019): with the key unset or refuse, --check refuses a hooks/, .github/ or package.json Key File exactly as before', …)`: for each of the three paths, `widenCheck({ 'express-driver-protected-paths': v }, FAST, …)` with v `refuse` and `undefined` (key absent) give equal verdicts, `admitted: false`, reasons including `` `protected path: ${p}` ``, `widenedBy: []`.
  - `test('AC2.1, AC7.2 (#6019): with reviewer and the reviewer on, --check admits a protected Key File with widenedBy [protected-path]', …)`: Key File `plugin/hooks/x.js` → `{ record: 7, admitted: true, reasons: [], widenedBy: ['protected-path'] }`.
  - `test('AC2.2 (#6019): with reviewer and express-driver-review off, --check refuses with the widened reviewer-off reason', …)`: `reasons` deep-equals `[ADMISSION_REASONS.reviewerOffWidened]`, `widenedBy: ['protected-path']`.
  - `test('AC2.3 (#6019): under beyond-express the protected-path widening turns the reviewer on', …)`: `{ 'express-driver-protected-paths': 'reviewer', 'express-driver-review': 'beyond-express' }`, Key File `plugin/hooks/x.js` → admitted, `widenedBy: ['protected-path']`, and `h.reviewerCalls.map((o) => o.widenedBy)` deep-equals `[['protected-path']]`.
  - `test('AC10.2 (#6019): each merge-time family Key File is admitted under reviewer with the reviewer on', …)`: loop over Task 2's `MERGE_TIME` → admitted, `widenedBy: ['protected-path']`.
  - `test('AC9.4 (#6019): each build-time family Key File refuses under reviewer with the reviewer on', …)`: loop over Task 2's `BUILD_TIME` → `admitted: false`, reasons include `` `protected path: ${p}` ``.
  - `test('AC8.1 (#6019): check gets --protected-paths reviewer only when the key is reviewer and the reviewer is on', …)`: harnesses with `reviewRequired: () => ({ on: true|false, reason: 'sentinel' })` × key `reviewer|refuse`, unprotected Key File → only `reviewer` + on passes `['--protected-paths', 'reviewer']` to the check call; the other three pass no `--protected-paths`.
  - `test('AC4.2 (#6019): a check that reports a protected test file adds protected-path and the merge step stops at widened-admission without the supplier', …)`: `mergeHarness` with `REVIEWER_ON`, Key File `src/f0.js`, labels `[...FAST, 'auto:merge']`, a check reply (when the args carry the flag) whose `bounds.protectedPaths` is `['plugin/hooks/x.test.js']`, and a `judgments` supplier recording calls → supplier never called, `final.merge.reason === 'widened-admission'`, the `merge-entry` stop detail is `widened-admission: admitted widened by protected-path`. Same test, second case (spec AC4's rename input): a check reply whose `bounds.protectedPaths` is `['plugin/hooks/old.js']` (a rename's protected `oldPath`, Key File `src/f0.js` the new path) → the same three assertions.
  - `test('#6019: a protected Key File record whose check also reports protected paths keeps one protected-path', …)` (Review Focus 3): eligibility widening plus a check reply with `protectedPaths: ['plugin/hooks/x.js']` → the eligibility and final `widenedBy` both deep-equal `['protected-path']`.
  - `test('#6019: under the flag a check envelope with no protectedPaths array fails closed to protected-path', …)` (Review Focus 4): proceed reply with `bounds` lacking `protectedPaths` → `ctx.widenedBy` ends `['protected-path']` and merge stops at `widened-admission`.
  - `test('budget pre-screen: eligibilityOptions is exactly what the eligibility step passes', …)` (existing, line 6500) stays green; `budget.test.js` stays green with the new `POLICY_RESOLVED` entry.
  - `admission.test.js:81`: assert the new `reviewerOffWidened` text; add `evaluateAdmission` with `widenedBy: ['protected-path'], reviewerOn: false` → reasons include `R.reviewerOffWidened`, and `reviewerOn: true` → no such reason.
  - `review.test.js`: `reviewRequired({ issue: { labels: [{ name: 'size:low' }] }, keyFiles: ['plugin/hooks/x.js'], policyValue: 'beyond-express', widenedBy: ['protected-path'] })` deep-equals `{ on: true, reason: 'admitted widened by protected-path' }` (AC2.3).
  - `queue.test.js:61`: the second call's expected keys gain `'express-driver-protected-paths'` after `'express-driver-max-risk'`.

- [ ] **Step 2: Run the tests to verify they fail**
Run: `node --test tests/bin-lib/driver/run.test.js tests/bin-lib/driver/admission.test.js tests/bin-lib/driver/review.test.js tests/bin-lib/driver/budget.test.js tests/bin-lib/express/queue.test.js`
Expected: FAIL after Step 1 (key not in `POLICY_KEYS`; no `protected-path` widening; reason text differs)

- [ ] **Step 3: Implement** per the Interfaces block, so this holds:
  Proof(auth): a protected path never passes without the reviewer: the eligibility option follows the key alone, but admission's widened rule refuses a `protected-path` widening when `reviewerOn` is false (Task 4 AC2.2 test, `express-driver-review: off`), the `check` flag is passed only when the key is `reviewer` and `ctx.reviewer.on === true` (Task 4 AC8 test), a check without the flag refuses the path (Task 3 AC3.2 test), and a build-time family path (`.github/`, `package.json`, `.claude/settings*.json`, `.mcp.json`, git hooks, CI config) refuses under every value in both gates (Task 2 AC9 tests).
  Comments: `POLICY_KEYS`' comment names the new key (#6019); `checkStep`'s header names the flag rule, the fail-closed widening, and that a check-time widening reads `admitted widened by` in merge-entry's detail; the `eligibilityOptions` comment says the option follows the key alone, admission and `reviewRequired` supply the reviewer requirement. `docs/driver.md`: line 19's `widenedBy` lists `risk`, `ceremony` and/or `protected-path`; Lane bounds gets a paragraph (not a table row — the key is not a bound) stating the key, its two values, the two family lists, that `check` gets `--protected-paths reviewer` only when the key is `reviewer` and the reviewer step is on, that a protected path `check` reports (a protected test file or a rename's old path, since `outside Key Files` already refuses any other unlisted path) also widens by `protected-path`, and the reworded admission reason, and that a check-time `protected-path` reads `admitted widened by protected-path` in the merge-entry detail like an eligibility-time one (merge.js is unchanged; the check's proceed line in `decisions.md` names the reported paths); change "admitted above `risk:low`, or with a non-fast-lane ceremony, is widened" to include a protected Key File. `driver-route.md:24`: same `widenedBy` wording.

- [ ] **Step 4: Run the tests to verify they pass**
Run: `node --test tests/bin-lib/driver/run.test.js tests/bin-lib/driver/admission.test.js tests/bin-lib/driver/review.test.js tests/bin-lib/driver/budget.test.js tests/bin-lib/driver/merge.test.js tests/bin-lib/express/queue.test.js tests/dispatch-express-routing-prose.test.js tests/accept-park-prose-conformance.test.js`
Expected: PASS

- [ ] **Step 5: Commit** `Let the driver take a protected path behind its reviewer — widen by protected-path and pass check's flag only with the reviewer on`

### Task 5: The queue pull's driver half asks the protected-path question

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/express/queue.js:96` (the `widenings` call)
- Modify: `docs/plugin-structure.md:122` (queue.js clause: the widened-reviewer rule also covers a protected-path widening; the resolved key list gains `express-driver-protected-paths`)
- Test: `tests/bin-lib/express/queue.test.js` (beside the #6018 tests at line 281)

**Interfaces:**
- Consumes: `eligibilityOptions(policy).protectedPathsNeedReviewer` (Task 4); `widenings({ …, keyFiles, protectedPathsNeedReviewer })` (Task 2).
- Produces: `driverRoutable` passes `keyFiles` and `protectedPathsNeedReviewer: driver.eligibility.protectedPathsNeedReviewer` to `widenings`.

- [ ] **Step 1: Write the failing tests** (`PROTECTED_POLICY = { ...WIDENED_POLICY, 'express-driver-max-risk': 'low', 'express-driver-protected-paths': 'reviewer' }`; a fast-lane `risk:low` record whose one Key File is `plugin/hooks/x.js`)
  - `test('#6019: under reviewer with the reviewer on, a protected-Key-File record is driver-routable', …)`: `express-driver-review: 'on'` → `keepSingleton(rec)` true, no `driver modules failed to load` line.
  - `test('#6019: under reviewer with the reviewer off, the protected-Key-File record is not driver-routable', …)`: `express-driver-review: 'off'` → false (the widened-reviewer rule refuses it; without Step 3 the record would be routable, since eligibility no longer refuses).
  - `test('#6019: with the key refuse the protected-Key-File record keeps today\'s answer', …)`: `'express-driver-protected-paths': 'refuse'` → false.
  - `test('#6019: a build-time Key File is never driver-routable under reviewer', …)`: Key File `.github/workflows/ci.yml`, reviewer `on` → false.

- [ ] **Step 2: Run the tests to verify they fail**
Run: `node --test tests/bin-lib/express/queue.test.js`
Expected: FAIL after Step 1 (the reviewer-off case reads routable)

- [ ] **Step 3: Implement** the one-call change in `queue.js` and the `docs/plugin-structure.md` clause.

- [ ] **Step 4: Run the tests to verify they pass**
Run: `node --test tests/bin-lib/express/queue.test.js tests/bin-lib/express/eligibility.test.js`
Expected: PASS

- [ ] **Step 5: Commit** `Ask the protected-path widening in the queue pull's driver half — the same question the eligibility step asks`
