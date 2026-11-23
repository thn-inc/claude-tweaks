# Protected-Path List as a Policy Value Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the policy key `protected-paths`, a list of globs that replaces the shipped protected-path list for the express lane and the pipeline driver. Unset or malformed keeps the shipped list, `[]` protects nothing, and the value is always read from the main checkout's `policy.yml`.

**Architecture:** `eligibility.js` swaps its 15 regexes for one frozen glob per family (`SHIPPED_PROTECTED_PATHS`), matched with `blast-radius.js`'s `globToRegExp`. `isProtectedPath(path, list)` takes the list, and every eligibility function takes it through a new `protectedPathGlobs` option (absent = shipped). `express/policy.js` turns a resolved entry into a list (`protectedPathGlobsOf`) and resolves the key from the main checkout (`resolveProtectedPathsEntry`, called by `defaultResolvePolicy`), so the express CLI, the driver and the queue pull all read the same root. `review.js`'s evidence-path guard tests the union of the shipped list and the resolved one.

**Tech Stack:** Node 18+ CommonJS, `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-11-23T084843-record-6020/work/6020-spec.md` (record #6020)

Scope keywords: isProtectedPath, PROTECTED_FAMILIES, SHIPPED_PROTECTED_PATHS, protectedPathGlobs, protected-paths, eligibilityOptions, expressGateOptions, defaultResolvePolicy, isProtectedOrSensitive

## Global Constraints

- **Decisions (maintainer, 2026-11-23, record body):** the key is spelled as a comma-separated string (`protected-paths: infra/**, deploy/**`); bracketed values in the ACs are notation for that string (`["a", "b"]` means `a, b`; `[""]` means an empty element such as `infra/**, ` or `,`); the resolver gets no YAML flow-syntax special case. Glob validity is the strict element rule below.
- Policy key: `{ key: 'protected-paths', type: 'list', default: [], element: 'glob', emptyList: true, policyOnly: true, category: 'merge-safety', tier: 'advanced' }`. Unset means `SHIPPED_PROTECTED_PATHS`. A set value replaces it, removals included. An explicit `[]` is honoured. A malformed value falls back to the shipped list, never to an empty list ("Fail closed, as `express-driver-max-size`'s unreadable value refuses rather than widening").
- **Name decisions.** The key is `protected-paths`. That follows `_shared/policy-key-naming.md` (flat kebab-case, no suffix applies) and parallels the sibling list `merge-sensitive-paths`. It contains the substring of `express-driver-protected-paths` and of `check --protected-paths reviewer`, so every test and grep for the new key anchors on the whole token (`` `protected-paths` ``, `^protected-paths:`, an exact object key), never on a substring. The eligibility option is `protectedPathGlobs`, not the spec's proposed `protectedPaths`: `evaluateDiffBounds`' result already carries a `protectedPaths` key (#6019's reported paths), and one name must not mean two things in one function.
- **Glob element** `LIST_ELEMENT_PATTERNS.glob = /^[^\s"'[\]{}?\\]+$/`, exactly the maintainer's 2026-11-23 Decision (record body): an element that is empty, or contains whitespace, a quote (`'` or `"`), `[`, `]`, `{`, `}`, `?` or a backslash, makes the whole value invalid, and the shipped list applies. Nothing else is refused: a leading `/` or `./`, or a backtick, is a well-formed glob that matches nothing (project globs match the canonical path, which never starts with `/` or `./`), and AC10 keeps a never-matching glob valid. A YAML-flow `["infra/**"]` is refused (brackets, quotes), so it can never become one literal glob protecting nothing. Accept: `infra/**`, `**/package.json`, `.claude/settings*.json`, `no/such/**`, `%2e%2e/x`, `/infra/**`, `./infra/**`. Refuse: `["infra/**"]`, `""`, `` (empty), `a b`, `x?y`, `{a`, `a]`, `app/[slug]/**`, `a\\b`, `it's`.
- The shipped list is exactly equivalent to today's regexes. Directory families use `**/{dir}/**/*`, not `**/{dir}/**`, because `globToRegExp` renders a trailing `/**` as also matching the bare parent (`hooks`), and `(^|\/)hooks\//` does not. Probed at authoring with `blast-radius.js`'s `globToRegExp`: 126 generated and named paths, bare directories included, give 0 differences against `PROTECTED_FAMILIES`' regexes at `b8811c277a`. The globs are `**/hooks/**/*`, `**/hooks.js`, `**/hooks.sh`, `**/skills/_shared/**/*`, `**/.github/**/*`, `**/.gitlab-ci.yml`, `**/.circleci/**/*`, `**/.githooks/**/*`, `**/.husky/**/*`, `**/CODEOWNERS`, `**/package.json`, `**/.claude/settings*.json`, `**/.mcp.json`, `**/.claude-tweaks/policy.yml` and `**/.claude-tweaks/verify-scope.json`, in that order, with today's `buildTime` values.
- Project globs match `canonicalPath(p)`: posix separators, `.`/`..` resolved, no leading `./`. They are root-anchored and case-sensitive. No path is URL-decoded.
- `REASONS.protectedPath(p)` stays `` `protected path: ${p}` `` (wire contract).
- #6019's build-time subset stays a fixed constant (`BUILD_TIME_PROTECTED_GLOBS`). It applies to a path only while the resolved list protects it: `protectedPathLeftForReviewer(path, sensitive, list)` is `isProtectedPath(path, list) && !isBuildTimeProtectedPath(path) && !sensitive`. A path a project adds is therefore never build-time.
- **Main-checkout root.** Authoring check of the spec's ASSUMPTION: `express/policy.js:50` calls `resolvePolicyConfig` with `defaultGit`, and `defaultGit` passes no cwd, so the root is the process cwd's `git rev-parse --show-toplevel`. `driver/run.js:685` is `resolvePolicy: (keys) => defaultResolvePolicy(keys)`. `driver/steps.js:1168-1171` runs `express-lane.js check` with `{ cwd: ctx.wt }`, the record's worktree. So today `check` reads the worktree's `policy.yml`. The new key is read from `mainCheckoutRoot(cwd)` (`plugin/bin/lib/hooks/worktree-detect.js`) inside the resolver every entry point already calls. No other key's root changes.
- **Factory decision:** `protected-paths` joins `FACTORY_REFUSED_KEYS`. It is a repository-layout list, so a user-wide value would replace every repository's list. Phase 11 will define the factory's semantics for it as a floor (the stricter-of rule). Shipping "repository replaces factory" now would leave a contract that Phase 11 has to migrate away from.
- `review-lens/facts.js`'s `riskPathTouched` keeps the shipped list (`(p) => isProtectedPath(p)`). It is a review-lens risk proxy outside the record's named scope. The conservative minimum is to leave its input unchanged.
- Nothing writes this repo's `.claude-tweaks/policy.yml`. Unset reproduces today.
- Expand-contract: the renamed exports (`BUILD_TIME_PROTECTED_RES` → `BUILD_TIME_PROTECTED_GLOBS`, `PROTECTED_PATH_RES` removed) are in-process module internals and ship together, so no run in flight reads them across versions. An older build that reads a `policy.yml` carrying the new key treats it as an unknown key. Nothing breaks.
- Commits: `{Verb} {what} — {detail}` subjects, `refs #6020` in the body, never `closes`/`fixes`.
- Governing skill `.claude/skills/policy-key-addition` (applies to `policy-schema.js`, `policy-factory.js`, `_shared/policy-schema*.md`, `docs/journeys/resolve-a-policy-key.md`), quoted:
  - "`summary`, `category` and `tier` are required (`tests/policy-schema-metadata.test.js`)."
  - "The core tier has an enforced cap of 12 (`tests/policy-schema-metadata.test.js`) and sits at it, so a new key is `advanced` unless it replaces a core one."
  - "`tests/policy-schema.test.js` pins `POLICY_KEYS.length`. Bump it in the same commit, and rewrite the `Last bump: {old} -> {new}, #{record}` line directly above the assertion — the test fails when that line's new value differs from the pin. The assertion beneath it, `new Set(POLICY_KEYS.map((k) => k.key)).size`, pins the unique-key count and takes the same bump"
  - "Every key needs a table row there that starts `` | `{key}` | `` (`tests/policy-key-naming.test.js`), and its summary must not be copied verbatim from the row's `summary` (`tests/policy-schema-metadata.test.js`). State the value the resolver returns for unset, set and malformed input, from the code, not from intent."
  - "a malformed value arrives as `source: 'default'` with `invalid: true`, never as a non-default source, so a `source !== 'default'` guard never sees it. Key such a guard on `invalid`, and build its test fixture from a real `resolvePolicyKeys` reply rather than a hand-written one"
  - "Measure `wc -c` on `_shared/policy-schema.md` against `RAIL_BYTES` … before writing the row, and plan the section move in the same task when the rows will not fit". Measured: 51,039 B against 52,500 B. Task 1 adds about 110 B, leaving about 1,350 B, so no move is needed.
  - "**A `policyOnly` key** is also named in the `policyOnly` bullet of `_shared/policy-schema-coverage.md`'s "Canonical read path carve-outs""
  - "**A `policyOnly` key** is also named in the step 3 Red flags list of `docs/journeys/resolve-a-policy-key.md`, which lists every `policyOnly` flat key with its record."
  - "**A factory-refused key** is named in `FACTORY_REFUSED_KEYS` (`plugin/bin/lib/policy-factory.js`) and in the Refused keys bullet of `_shared/policy-schema-read-path.md`'s "Factory layer" section, with its reason."
  - "The resolver reads only the checkout it runs in, so a key that a PR could rewrite in its own branch also needs its consumers to read it from the base branch. The resolver cannot do that for them" (hence `resolveProtectedPathsEntry`).
  - "**`list`** takes an optional `element` … that every comma-separated entry must match, and an empty entry never does. The unset default is `[]`. A configured list resolves to the raw comma-separated string. On a row with `emptyList: true`, the literal `[]` (`EMPTY_LIST_RE`) is the explicit empty list and resolves `[]`"
  - "**Pin each new validation branch with its own assertion.**"
  - "**A key joining a family reaches only the callers that list it.** … Grep every reader of a sibling key". Readers of `merge-sensitive-paths` and `express-driver-protected-paths` from `git grep` at authoring: `express/policy.js` `expressGateOptions`, `express/cli.js` gate (line 300) and check (`blastRadiusConfig`), `express/queue.js` `SECOND_KEYS` plus inline `expressOpts`, `driver/lane-bounds.js` `eligibilityOptions`, `driver/steps.js` `POLICY_KEYS`, `driver/plan-lane.js` `POLICY_KEYS`, and `driver/review.js` (lines 881 and 1097). Each one is a task's `Files:` entry below.
- Governing skill `.claude/skills/gh-api-module-pattern` (`cli-wrapper-contract.md`, applies to `express/cli.js`): "Logic lives in an exported `run(argv, deps)`; every side effect … goes through `deps` so tests inject fakes. **Every** `deps` call that can throw … is try/caught into the documented exit-code contract". The new `check` read goes through `deps.resolvePolicy` inside `runCheck`'s existing `try`.
- Governing skill `.claude/skills/windows-checkout-test-parity`: no new display-ID producer. `canonicalPath` already turns `\` into `/` for Key Files and is unchanged. `mainCheckoutRoot` is existing code. Nothing in this plan needs a win32 proof.
- Source-scan lint: no new `fs.existsSync`/`realpathSync`. The new reads go through `mainCheckoutRoot` and `resolvePolicyConfig`/`locatePolicyFile`.
- Rails: `express-lane.md` 18,566 B, `policy-schema-coverage.md` 44,653 B, `policy-schema-read-path.md` 15,869 B and `policy-schema-express-driver.md` 5,080 B against 52,500 B. Each gains one line or sentence.

Sole-site proofs (`git grep -n "isProtectedPath" -- plugin`, at `508ceca9f6`): `express/eligibility.js` lines 149 (def), 168, 254, 276, 324 and 334; `driver/review.js` 228 (import) and 403 (`[p, lower, p.toUpperCase()].some(isProtectedPath)`); `review-lens/facts.js` 42 (import) and 259 (`touched.some(isProtectedPath)`). Callers of the eligibility functions (`git grep -n "evaluateRecordEligibility\|evaluateDiffBounds\|widenedByFor\|eligibilityOptions\|expressGateOptions" -- plugin/bin`): `express/cli.js` 308 and 362; `express/queue.js` 80, 93, 96 and 108; `driver/steps.js` 291-297; `driver/budget.js` 87 and 155; `driver/plan-lane.js` 112-115 and 136; `driver/run.js` 687. Every path reaches the list through `expressGateOptions`, `eligibilityOptions`, queue.js's inline options or `check`'s own read. `merge.js`'s `widenings` calls (257, 1120) pass no `keyFiles`, so they are unaffected.

Read only: `plugin/bin/lib/issues/blast-radius.js` (`globToRegExp` is reused unchanged, Task 3); `plugin/bin/lib/driver/budget.js` (it reaches the list through `eligibilityOptions(shared.policy)`, Task 5); `plugin/bin/lib/driver/run.js` (`realDeps.resolvePolicy` already calls `defaultResolvePolicy`, which roots the key at the main checkout, Task 4). Unchanged: `.claude-tweaks/policy.yml` (unset reproduces today).

Classified no-change (Check B keyword hits): `plugin/bin/lib/wrap-up/pack.js` and `tests/bin-lib/wrap-up/pack.test.js` define and test an unrelated local `defaultResolvePolicy`. `docs/journeys/drive-a-named-record-to-a-draft-pr-5218.md` names the `check --protected-paths` flag and "a protected Key File", which stay true. The 2026-11-22 plans are history. `tests/bin-lib/driver/budget.test.js` builds its policy without the key, so it runs on the shipped list and needs no edit.

The auth risk flag's proof is the `Proof(auth):` line in Task 4 Step 3.

Blocking-verification note: the AC4 driver half (`drive.js --check`) feeds the policy step a `resolvePolicyKeys` reply for the fixture's `policy.yml` text through `run.test.js`'s harness. It does not spawn `drive.js` against a fixture repository: the harness's other keys (integration-model, models) would probe `gh`. The root half is proved on `defaultResolvePolicy` itself (Task 4), which is the function `run.js`'s `realDeps.resolvePolicy` calls.

## Review Focus

1. A YAML-flow or otherwise malformed value (`["infra/**"]`, `app/[slug]/**`, `x?y`) must not silently protect nothing. It resolves `invalid: true` and the shipped list applies. Task 1 tests each one, and Task 4 tests them through the real resolver.
2. A record's worktree carrying its own edited `policy.yml` while the main checkout has none (or has the key unset) must still get the shipped list, never the worktree's value. Task 4 tests a real linked worktree whose `policy.yml` sets `protected-paths: []`.
3. Under `express-driver-protected-paths: reviewer`, a project-added glob (`infra/**`) is left for the reviewer and widens by `protected-path`. A build-time family the project keeps still refuses. Task 3 tests both.
4. A run config must never shrink the list: `protected-paths: []` in `config.yml` with `policy.yml` unset resolves the unset default. Task 1 tests this.
5. A rename whose `oldPath` matches a project glob (`infra/old.tf` → `src/new.js`) is a `protected path: infra/old.tf` violation under `['infra/**']`. Task 3 tests this.

---

### Task 1: The `protected-paths` key

**Role:** integration

**Files:**
- Modify: `plugin/bin/lib/policy-schema.js:31-35` (`LIST_ELEMENT_PATTERNS.glob`, with the comment above it updated to name a glob) and the new row after `express-driver-protected-paths` (line 125), with its comment
- Modify: `plugin/skills/_shared/policy-schema.md:170-182` (the `## Express driver` stub: add `` | `protected-paths` | `` after `express-driver-protected-paths`, and change the lead sentence to "Registered by #5218, #5222, #5224, #6018, #6019 and #6020; `bin/drive.js` reads all ten, and `bin/express-lane.js` reads `protected-paths` too.")
- Create: `tests/policy-protected-paths.test.js` (shaped like `tests/policy-deferral-digest-reasons.test.js`)
- Modify: `tests/policy-schema.test.js:46-48` (count pin)

**Interfaces:**
- Produces: `LIST_ELEMENT_PATTERNS.glob` (exported). `resolvePolicyKeys(['protected-paths'], …)['protected-paths']` is `{ value: [], source: 'default' }` unset, `{ value: '<raw comma string>', source: 'policy' }` set, `{ value: [], source: 'policy' }` for `[]`, and `{ value: [], source: 'default', invalid: true }` malformed. A run-config line is ignored.

- [ ] **Step 1: Write the failing tests** (`KEY = 'protected-paths'`, `one = (opts) => resolvePolicyKeys([KEY], opts)[KEY]`)
  - `tests/policy-schema.test.js`: change the pin to `// Last bump: 123 -> 124, #6020` and assert `124` on both lines 47 and 48.
  - `test('the row: list, element glob, emptyList, default [], policyOnly, merge-safety, advanced', …)`: `POLICY_KEYS.find((k) => k.key === KEY)` matches the Global Constraints row, and its `summary` is a non-empty string.
  - `test('glob element accepts globs and refuses the spellings that would match nothing', …)`: the accept and refuse lists from Global Constraints.
  - `test('AC5.1 (resolver half): a malformed value resolves invalid, never a list', …)`: for each of `["infra/**"]`, `app/[slug]/**`, `x?y`, `a\\b` and `infra/*.{tf,yml}`, `one({ policyRaw: `${KEY}: ${v}\n` })` deep-equals `{ value: [], source: 'default', invalid: true }`.
  - `test('AC10.1 (resolver half): an empty element is invalid', …)`: the same result for `""`, `infra/**,` and `infra/**, ""`.
  - `test('AC10.2 (resolver half): a never-matching glob is valid', …)`: `no/such/**` gives `{ value: 'no/such/**', source: 'policy' }`, and so do `/infra/**` and `./infra/**` (well-formed, matching nothing).
  - `test('unset, a list and [] resolve from policy', …)`: `policyRaw: ''` gives `{ value: [], source: 'default' }`. `infra/**, **/package.json` gives `{ value: 'infra/**, **/package.json', source: 'policy' }`. `[]` gives `{ value: [], source: 'policy' }`.
  - `test('Review Focus 4: a run config never sets or shrinks the list (policyOnly)', …)`: `runConfigRaw: 'protected-paths: []\n'` with `policyRaw: ''` gives `{ value: [], source: 'default' }`. With `policyRaw: 'protected-paths: infra/**\n'` it gives `{ value: 'infra/**', source: 'policy' }`.
  - `test('policy-schema.md indexes the key', …)`: `policy-schema.md` includes `` | `protected-paths` | ``, and its size is below `RAIL_BYTES`.

- [ ] **Step 2: Run the tests to verify they fail**
Run: `node --test tests/policy-protected-paths.test.js tests/policy-schema.test.js`
Expected: FAIL (key unknown; 123 ≠ 124)

- [ ] **Step 3: Add the element and the row**
  - The row's `summary` is exactly `"Root-anchored path globs the express lane and the driver refuse to take; unset keeps the shipped list, and [] protects nothing."` (127 chars). It must not appear verbatim in any `.md` file.
  - The comment above the row: #6020; the list replaces `eligibility.js`'s `SHIPPED_PROTECTED_PATHS` when set; `policyOnly` because it decides what autonomous machinery may merge, so a `--run` config never shrinks it; consumers read it from the main checkout (`express/policy.js`'s `resolveProtectedPathsEntry`), never the record's worktree; a malformed value resolves `invalid` and the shipped list applies.

- [ ] **Step 4: Run the tests to verify they pass**
Run: `node --test tests/policy-protected-paths.test.js tests/policy-schema.test.js tests/policy-key-naming.test.js tests/policy-schema-metadata.test.js tests/policy.test.js tests/resolve-policy-control-mode.test.js tests/policy-deferral-digest-reasons.test.js`
Expected: PASS. Then delete the `element: 'glob'` from the row and confirm the AC5.1 and AC10.1 tests go red, then restore it.

- [ ] **Step 5: Commit** `Add the protected-paths policy key — a glob list that replaces the shipped protected list`

### Task 2: Refuse the key from the factory layer

**Role:** transcription

**Files:**
- Modify: `plugin/bin/lib/policy-factory.js:19-21` (append `'protected-paths'`; the comment gains "or a repository-layout list whose factory floor is Phase 11's (`protected-paths`)")
- Modify: `plugin/bin/lib/policy-schema.js` (the `protected-paths` row's comment: add "Factory decision (#6006): refused (`FACTORY_REFUSED_KEYS`); Phase 11 makes it a factory floor")
- Modify: `plugin/skills/_shared/policy-schema-read-path.md:32` (Refused keys bullet: add `protected-paths` to the opening list and the reason "`protected-paths` is a repository-layout list, and Phase 11 sets its factory semantics as a floor, not a replacement")
- Test: `tests/bin-lib/policy-factory.test.js:26`
- Test: `tests/resolve-policy-factory.test.js:66-72`

**Interfaces:**
- Consumes: Task 1's row.
- Produces: `FACTORY_REFUSED_KEYS` is `['merge-authorization', 'control-mode', 'deploy-command', 'release-hook', 'protected-paths']`.

- [ ] **Step 1: Write the failing tests** in `tests/bin-lib/policy-factory.test.js` and `tests/resolve-policy-factory.test.js`: both list pins gain `'protected-paths'`. `resolve-policy-factory.test.js`'s `lines` map gains `'protected-paths': 'protected-paths: []\n'`. The existing loop then asserts a factory `[]` resolves as with no factory layer (`source: 'default'`) and calls `onInvalid` once.

- [ ] **Step 2: Run the tests to verify they fail**
Run: `node --test tests/bin-lib/policy-factory.test.js tests/resolve-policy-factory.test.js`
Expected: FAIL (list lacks `protected-paths`)

- [ ] **Step 3: Append the key and the two prose edits**

- [ ] **Step 4: Run the tests to verify they pass**
Run: `node --test tests/bin-lib/policy-factory.test.js tests/resolve-policy-factory.test.js tests/policy-schema.test.js tests/policy-protected-paths.test.js`
Expected: PASS

- [ ] **Step 5: Commit** `Refuse protected-paths from the factory layer — Phase 11 owns its floor`

### Task 3: Glob families and the list parameter in eligibility

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/express/eligibility.js:104-169` (families, matcher, build-time subset), `:198-290` (options, `widenings`, `widenedByFor`), `:292-351` (`evaluateDiffBounds`), `:359-363` (exports)
- Modify: `plugin/bin/lib/driver/review.js:403` (`[p, lower, p.toUpperCase()].some((s) => isProtectedPath(s))`; Task 7 adds the union)
- Modify: `plugin/bin/lib/review-lens/facts.js:30-259` (lines 30-31 and 259: `touched.some((p) => isProtectedPath(p))`; the header comment says "the shipped protected list (`SHIPPED_PROTECTED_PATHS`), not a project's `protected-paths`")
- Test: `tests/bin-lib/express/eligibility.test.js`

**Interfaces:**
- Consumes: `globToRegExp` from `../issues/blast-radius` (already imported from there).
- Produces (exported from `eligibility.js`):
  - `PROTECTED_FAMILIES`: frozen, 15 frozen `{ glob, buildTime }` (the Global Constraints globs; `re` is gone).
  - `SHIPPED_PROTECTED_PATHS`: frozen `PROTECTED_FAMILIES.map((f) => f.glob)`.
  - `BUILD_TIME_PROTECTED_GLOBS`: frozen globs of the `buildTime` families (10). It replaces `BUILD_TIME_PROTECTED_RES`, and `PROTECTED_PATH_RES` is deleted.
  - `isProtectedPath(path, list = SHIPPED_PROTECTED_PATHS) -> boolean`: throws `TypeError('isProtectedPath: list must be an array of globs')` when `!Array.isArray(list)`; otherwise `list.some((g) => globToRegExp(g).test(canonicalPath(path)))`.
  - `isBuildTimeProtectedPath(path)`: `isProtectedPath(path, BUILD_TIME_PROTECTED_GLOBS)`.
  - Option `protectedPathGlobs` (destructured with default `SHIPPED_PROTECTED_PATHS`) on `evaluateRecordEligibility`, `evaluateDiffBounds` (changed paths and a rename's `oldPath`) and `widenings`. `widenedByFor` passes `opts.protectedPathGlobs`. The internal `protectedPathLeftForReviewer(path, sensitive, list)` takes it as its third argument.
  - Rewrite the "Project-agnostic …" comment's first line: these are the shipped defaults, a project replaces the list with `protected-paths` (#6020), and the per-family rationale stays.

- [ ] **Step 1: Write the failing tests** in `tests/bin-lib/express/eligibility.test.js` (reuse `OPTS`, `DRIVER`, `REVIEWER`, `withKey`, `f`, `BOUNDS`, `MERGE_TIME`, `BUILD_TIME`; `INFRA = ['infra/**']`)
  - Re-point the #6019 tests: `BUILD_TIME_PROTECTED_RES` → `BUILD_TIME_PROTECTED_GLOBS` (length 10), and `fam.re.test(q)` → `globToRegExp(fam.glob).test(q)`.
  - `TODAY_PROTECTED_RES`: the 15 regex literals copied verbatim from `git show b8811c277a:plugin/bin/lib/express/eligibility.js` lines 123-137, as the oracle.
  - `familyCorpus(glob)`: strip a leading `**/` to get `a`. If `a` ends with `/**/*`, set `d = a.slice(0, -5)` and return `[`${d}/x.js`, `a/b/${d}/x.js`, `${d}/a/b/c.js`, d, `${d}/`, `${d}x/x.js`, `x${d}/y.js`]`. Otherwise set `f = a.replace('*', '.local')` and return `[f, `a/b/${f}`, `${f}.bak`, `my-${f}`]`.
  - `test('AC1.1: the shipped glob list answers every corpus path as the pre-#6020 regexes do', …)`: the corpus is `PROTECTED_FAMILIES.flatMap((fam) => familyCorpus(fam.glob))` plus the spec's named paths (`hooks/x.js`, `a/hooks/x.js`, `hooks.js`, `a/b/hooks.sh`, `.github/workflows/ci.yml`, `CODEOWNERS`, `docs/CODEOWNERS`, `package.json`, `a/package.json`, `.claude/settings.local.json`, `.claude-tweaks/policy.yml`, `.claude-tweaks/verify-scope.json`, `hooksmith/x.js`, `package.json.bak`, `my-hooks.js`, `hooks`, `.github`, `skills/_shared`). The test asserts `TODAY_PROTECTED_RES.length === PROTECTED_FAMILIES.length === 15`, that every family's glob starts with `**/`, and that `corpus.filter((p) => isProtectedPath(p) !== TODAY_PROTECTED_RES.some((re) => re.test(p)))` deep-equals `[]`.
  - `test('AC2.1 (eligibility half): under [infra/**] package.json is not protected and infra/main.tf is', …)`: for `OPTS` and `DRIVER`, `withKey('package.json')`'s reasons exclude `protected path: package.json` and `withKey('infra/main.tf')`'s include `protected path: infra/main.tf`. Without the option, `package.json` is refused.
  - `test('AC3.1 (eligibility and bounds halves): [] protects nothing', …)`: `withKey('plugin/hooks/x.js')` under `{ ...OPTS, protectedPathGlobs: [] }` has no `protected path:` reason. `evaluateDiffBounds([f('plugin/hooks/x.js', 3)], { ...BOUNDS, keyFiles: ['plugin/hooks/x.js'], protectedPathGlobs: [] }).violations` deep-equals `[]`.
  - `test('AC6.1, AC6.2: project globs are root-anchored', …)`: under `['package.json']`, `package.json` is true and `a/package.json` is false. Under `['**/package.json']` both are true.
  - `test('AC7.1: isProtectedPath refuses a non-array list', …)`: `assert.throws` with `TypeError` for lists `'infra/**'`, `null` and `0`, and for `['hooks/x.js'].some(isProtectedPath)`, whose index argument is why every call site uses an explicit arrow.
  - `test('AC9.1: adversarial spellings answer as their canonical path', …)`: with the shipped list, `hooks/./x.js`, `a/../hooks/x.js`, `hooks\\x.js`, `./hooks/x.js` and `hooks/` are each true. With `INFRA`, `infra/./main.tf`, `x/../infra/main.tf`, `infra\\main.tf`, `./infra/main.tf` and `infra/` are each true. Each spelling as a Key File gives `` `protected path: ${p}` `` with `p` as written.
  - `test('AC9.2: eligibility is case-sensitive', …)`: `HOOKS/x.js` (shipped) and `INFRA/main.tf` (`INFRA`) are false.
  - `test('AC9.3: percent-encoding is a literal path, never decoded', …)`: `infra%2fmain.tf` under `INFRA` and `hooks%2fx.js` under the shipped list are false, and decoding would make both true. `%2e%2e/hooks/x.js` is true under the shipped list, as an ordinary path with a `hooks/` segment.
  - `test('AC10.2 (eligibility half): a never-matching glob protects nothing else', …)`: under `['no/such/**']`, `hooks/x.js` and `package.json` are false.
  - `test('Review Focus 3: reviewer mode leaves a project-added path for the reviewer and keeps a build-time family refused', …)`: `withKey('infra/main.tf')` under `{ ...REVIEWER, protectedPathGlobs: ['infra/**', '**/package.json'] }` is eligible, and `widenedByFor(labels, ['infra/main.tf'], thoseOpts)` deep-equals `['protected-path']`. `withKey('package.json')` under the same options keeps `protected path: package.json`.
  - `test('Review Focus 5: a rename from a project-protected oldPath is a violation', …)`: `evaluateDiffBounds([{ ...f('src/new.js', 2), oldPath: 'infra/old.tf' }], { ...BOUNDS, keyFiles: ['src/new.js'], protectedPathGlobs: INFRA }).violations` includes `protected path: infra/old.tf`.

- [ ] **Step 2: Run the test to verify it fails**
Run: `node --test tests/bin-lib/express/eligibility.test.js`
Expected: FAIL (`BUILD_TIME_PROTECTED_GLOBS`/`SHIPPED_PROTECTED_PATHS` undefined)

- [ ] **Step 3: Implement the Interfaces above in `eligibility.js`, then the two arrows**

- [ ] **Step 4: Run the tests to verify they pass, and prove the equivalence test can go red**
Run: `node --test tests/bin-lib/express/eligibility.test.js tests/bin-lib/driver/review.test.js tests/bin-lib/review-lens/facts.test.js tests/bin-lib/review-lens/select.test.js tests/bin-lib/driver/admission.test.js tests/bin-lib/driver/budget.test.js tests/bin-lib/express/queue.test.js tests/bin-lib/driver/plan-lane.test.js`
Expected: PASS, with every pre-existing test unchanged apart from the re-pointed #6019 names (AC1.1's unchanged-verdict half). Then edit `'**/package.json'` to `'package.json'` in the constant and confirm AC1.1 goes red on `a/b/package.json`. Delete the `Array.isArray` guard and confirm AC7.1 goes red. Restore both.

- [ ] **Step 5: Commit** `Make the protected list a glob parameter — shipped globs equal the old regexes, every caller passes the list`

### Task 4: Resolve the key from the main checkout and pass it in the express CLI

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/express/policy.js` (new `protectedPathGlobsOf`, `resolveProtectedPathsEntry`; `expressGateOptions`; `defaultResolvePolicy`; exports)
- Modify: `plugin/bin/lib/express/cli.js:300` (gate keys gain `'protected-paths'`), `:355-362` (check reads and passes the list), header comment's `check` paragraph
- Test: `tests/bin-lib/express/policy.test.js`
- Test: `tests/bin-lib/express/cli.test.js`

**Interfaces:**
- Consumes: `SHIPPED_PROTECTED_PATHS`, the `protectedPathGlobs` option (Task 3); `LIST_ELEMENT_PATTERNS.glob` (Task 1); `mainCheckoutRoot` from `../hooks/worktree-detect`.
- Produces (exported from `express/policy.js`):
  - `protectedPathGlobsOf(entry) -> string[]`: returns `SHIPPED_PROTECTED_PATHS` when `entry` is not an object, `entry.invalid === true`, `entry` has an `error` key, or `entry.source === 'default'`. An array `value` whose every element matches `LIST_ELEMENT_PATTERNS.glob` returns that array (`[]` included). A string `value` is `split(',')`, each part trimmed, and returned only when every part matches the pattern. Anything else returns `SHIPPED_PROTECTED_PATHS`. The decision keys on `invalid`/`source`, never on the value's emptiness.
  - `resolveProtectedPathsEntry(cwd = process.cwd()) -> { value, source, invalid? }`: set `main = mainCheckoutRoot(cwd)`, then `resolvePolicyConfig({ git: (args) => defaultGit(args, { cwd: main }), readFile: defaultReadFile, keys: ['protected-paths'], cwd: main }).result['protected-paths']`. When `main` is null or anything throws, it returns a fresh `{ value: [], source: 'default', invalid: true }`.
  - `defaultResolvePolicy(keys, opts)`: when `keys` includes `'protected-paths'`, that entry is `resolveProtectedPathsEntry(process.cwd())`. Every other key resolves as today. When no other key remains, no cwd-rooted read runs.
  - `expressGateOptions(policy)` adds `protectedPathGlobs: protectedPathGlobsOf(policy['protected-paths'])`.
  - `cli.js` check: inside the existing `try`, before `evaluateDiffBounds`, `const protectedPathGlobs = protectedPathGlobsOf(deps.resolvePolicy(['protected-paths'], { runDir })['protected-paths'])`, passed to `evaluateDiffBounds`. Gate reads it through `expressGateOptions`.

- [ ] **Step 1: Write the failing tests** in `tests/bin-lib/express/policy.test.js` and `tests/bin-lib/express/cli.test.js`
  - `policy.test.js` (fixtures from `gitRepo()` and `harnessWorktreeOf(main, 'rec')` in `tests/helpers/git-fixtures.js`; policy files written as plain files; `globsFrom = (dir) => { chdir(dir); try { return protectedPathGlobsOf(defaultResolvePolicy(['protected-paths'])['protected-paths']); } finally { chdir(saved); } }`):
    - `test('AC5.2: unset, absent and unreadable policy.yml all yield the shipped list through the real resolver', …)`: no `.claude-tweaks/` at all; a `policy.yml` holding `merge-verification: off` only; and `.claude-tweaks/policy.yml` created as a directory (an EISDIR read). Each `globsFrom(main)` deep-equals `SHIPPED_PROTECTED_PATHS`.
    - `test('AC5.1, AC10.1 (real resolver): malformed values yield the shipped list, never []', …)`: for `["infra/**"]`, `""`, `infra/**,` and `app/[slug]/**`, `defaultResolvePolicy(['protected-paths'])['protected-paths'].invalid === true` and `globsFrom(main)` deep-equals `SHIPPED_PROTECTED_PATHS`. `[]` yields `[]`, `infra/**` yields `['infra/**']`, and `no/such/**` yields `['no/such/**']`.
    - `test('AC8.1 (resolver half): from a linked worktree the main checkout\'s value wins', …)`: main has no `protected-paths`, and the worktree's `policy.yml` is `protected-paths: infra/**`. `globsFrom(wt)` deep-equals `SHIPPED_PROTECTED_PATHS`, and `evaluateRecordEligibility` of a record whose Key File is `package.json`, under `{ enabled: true, integrationModel: 'pr-first', protectedPathGlobs: globsFrom(wt) }`, includes `protected path: package.json`. With main `protected-paths: infra/**` and worktree `protected-paths: []`, `globsFrom(wt)` deep-equals `['infra/**']`.
    - `test('Review Focus 2: a worktree [] never reaches a main checkout with no policy.yml', …)`: main has no `.claude-tweaks/`, and the worktree has `protected-paths: []`. `resolveProtectedPathsEntry(wt)` deep-equals `{ value: [], source: 'default' }`.
    - `test('protectedPathGlobsOf keys on invalid and source, from real resolver replies', …)`: build entries with `resolvePolicyKeys(['protected-paths'], { policyRaw })` for `''`, `[]`, `infra/**, **/package.json` and `["infra/**"]`. The results are SHIPPED, `[]`, `['infra/**', '**/package.json']` and SHIPPED. `undefined`, `{ value: undefined, source: 'policy' }` and `{ value: 'a b', source: 'policy' }` give SHIPPED.
  - `cli.test.js` (a `realFixture()` with the same shape as `fixture()`: `main = gitRepo()`, `wt = harnessWorktreeOf(main, 'express-7')`, and the run dir made under `main/.claude-tweaks/pipelines/2026-10-25T090000-record-7`. Its harness `resolvePolicy` returns `resolveProtectedPathsEntry(cwdDir)` for `'protected-paths'` and the existing fake for every other key):
    - `test('AC2.1 (express CLI half): gate passes the resolved list', …)`: the fake gives `{ value: 'infra/**', source: 'policy' }` for the key. A record with Key File `package.json` has no `protected path: package.json` reason, and one with Key File `infra/main.tf` has `protected path: infra/main.tf`. `h.calls.resolvePolicy[0].keys` includes `'protected-paths'`.
    - `test('AC4.1 (express half): check reads protected-paths from the fixture repository\'s policy.yml', …)`: main's `policy.yml` is `protected-paths: infra/**` and `cwdDir = fx.main`. A diff `numstat([[1, 0, 'infra/main.tf']])` with that Key File escalates `out-of-bounds` with a detail containing `protected path: infra/main.tf`. A diff to `package.json` with that Key File proceeds. With no `policy.yml`, the `package.json` diff escalates with `protected path: package.json`.
    - `test('AC8.1 (check half): a worktree edit removing package.json from the list does not change check\'s verdict', …)`: main has no key. The diff is `package.json` plus `.claude-tweaks/policy.yml`, both Key Files, and `cwdDir = fx.wt`. The envelope with the worktree's `policy.yml` set to `protected-paths: infra/**` deep-equals the envelope without that file, and its detail contains `protected path: package.json`.

- [ ] **Step 2: Run the tests to verify they fail**
Run: `node --test tests/bin-lib/express/policy.test.js tests/bin-lib/express/cli.test.js`
Expected: FAIL (`protectedPathGlobsOf` / `resolveProtectedPathsEntry` not exported)

- [ ] **Step 3: Implement the Interfaces above**

Proof(auth): tests/bin-lib/express/policy.test.js 'AC8.1 (resolver half)' runs defaultResolvePolicy from a real linked worktree whose policy.yml sets protected-paths: infra/** while the main checkout leaves it unset, and asserts the list deep-equals SHIPPED_PROTECTED_PATHS and a package.json Key File still refuses, so a record cannot shrink its own protected list by editing policy.yml in its branch.

- [ ] **Step 4: Run the tests to verify they pass, and prove the root test can go red**
Run: `node --test tests/bin-lib/express/policy.test.js tests/bin-lib/express/cli.test.js tests/bin-lib/express/cli-plan-lane.test.js tests/bin-lib/express/queue.test.js`
Expected: PASS. Then replace `mainCheckoutRoot(cwd)` with `cwd` in `resolveProtectedPathsEntry` and confirm AC8.1 goes red. Then drop the `entry.source === 'default'` clause and confirm AC5.2 goes red. Restore both. If an existing `cli.test.js` assertion pins gate's exact key list, update it to include `'protected-paths'`.

- [ ] **Step 5: Commit** `Resolve protected-paths from the main checkout — the express gate and check pass the resolved list`

### Task 5: The driver reads and passes the key

**Role:** integration

**Files:**
- Modify: `plugin/bin/lib/driver/steps.js:118-134` (`POLICY_KEYS` gains `'protected-paths'` after `'express-driver-protected-paths'`; the comment above names it as the protected list, read from the main checkout through `defaultResolvePolicy`)
- Modify: `plugin/bin/lib/driver/lane-bounds.js:6-31` (import `protectedPathGlobsOf` at line 6; `eligibilityOptions` adds `protectedPathGlobs: protectedPathGlobsOf(policy['protected-paths'])`)
- Modify: `docs/driver.md:180` (append: "The protected list is the `protected-paths` key (#6020), read from the main checkout's `policy.yml`: unset or malformed keeps the shipped list, and a set list replaces it. Under `reviewer` a path the project adds is never build-time, and a build-time family the project removes is not protected at all.")
- Test: `tests/bin-lib/driver/run.test.js`

**Interfaces:**
- Consumes: `protectedPathGlobsOf` (Task 4); the `protectedPathGlobs` option (Task 3).
- Produces: `eligibilityOptions(policy).protectedPathGlobs`, an array. `steps.js`, `budget.js`, `plan-lane.js` and `queue.js` all inherit it.

- [ ] **Step 1: Write the failing tests** in `tests/bin-lib/driver/run.test.js`
  - `POLICY` gains `'protected-paths': undefined` after `'express-driver-protected-paths'`. The `on('policy')` mapping answers `k === 'protected-paths' && policy[k] === undefined` with `resolvePolicyKeys([k], { policyRaw: '' })[k]`, as it does for `express-driver-protected-paths`.
  - `test('AC2.1, AC4.1 (driver half): --check under protected-paths infra/** stops refusing package.json and refuses infra/main.tf', …)`: assert `resolvePolicyKeys(['protected-paths'], { policyRaw: 'protected-paths: infra/**\n' })['protected-paths']` deep-equals `{ value: 'infra/**', source: 'policy' }`, the shape the harness feeds. `widenCheck({ 'protected-paths': 'infra/**' }, ['risk:low', 'ceremony:fast-lane', ...WIDEN_LABELS], {}, ['package.json'])`'s reasons exclude `protected path: package.json`. With `['infra/main.tf']` they include `protected path: infra/main.tf`. With the key unset, `package.json` is refused.
  - `test('AC3.1 (driver half): protected-paths [] protects no Key File', …)`: `widenCheck({ 'protected-paths': [] }, …, ['plugin/hooks/x.js'])`'s reasons have no `protected path:` entry.
  - `test('AC5.1 (driver half): a malformed protected-paths keeps the shipped list', …)`: the entry is `resolvePolicyKeys(['protected-paths'], { policyRaw: 'protected-paths: ["infra/**"]\n' })['protected-paths']` (asserted `invalid: true`), fed by a custom `on('policy')` script shaped like #6018's AC10.1 test. A `package.json` Key File keeps `protected path: package.json`.

- [ ] **Step 2: Run the test to verify it fails**
Run: `node --test tests/bin-lib/driver/run.test.js`
Expected: FAIL (AC2.1 driver half: `package.json` still refused)

- [ ] **Step 3: Implement the two code edits and the `docs/driver.md` sentence**

- [ ] **Step 4: Run the tests to verify they pass**
Run: `node --test tests/bin-lib/driver/run.test.js tests/bin-lib/driver/budget.test.js tests/bin-lib/driver/admission.test.js tests/bin-lib/driver/review.test.js`
Expected: PASS

- [ ] **Step 5: Commit** `Pass protected-paths through the driver's eligibility options — POLICY_KEYS reads it once per run`

### Task 6: The plan lane and the queue pull read the key

**Role:** integration

**Files:**
- Modify: `plugin/bin/lib/driver/plan-lane.js:48-51` (`POLICY_KEYS` appends `'protected-paths'`), `:74-92` (`policyReadable` adds `isReadableSensitivePaths(value('protected-paths'))`; the generic entry check already refuses `invalid`/`error`)
- Modify: `plugin/bin/lib/express/queue.js:15` (`SECOND_KEYS` appends `'protected-paths'`), `:69` (inline `expressOpts` adds `protectedPathGlobs: protectedPathGlobsOf(policy['protected-paths'])`; the driver half gets it through `eligibilityOptions`)
- Test: `tests/bin-lib/driver/plan-lane.test.js`
- Test: `tests/bin-lib/express/cli-plan-lane.test.js`
- Test: `tests/bin-lib/express/queue.test.js`

**Interfaces:**
- Consumes: `protectedPathGlobsOf`, `expressGateOptions` (Task 4); `eligibilityOptions` (Task 5).
- Produces: plan-lane answers a malformed `protected-paths` as `policy-unreadable`, its unset reply as readable, and computes both lanes with the resolved list. The queue pull's express half and driver half both keep or bundle by the resolved list.

- [ ] **Step 1: Write the failing tests** in `tests/bin-lib/driver/plan-lane.test.js`, `tests/bin-lib/express/cli-plan-lane.test.js` and `tests/bin-lib/express/queue.test.js`
  - `plan-lane.test.js`: the `POLICY_KEYS` pin appends `'protected-paths'`. `policy()` gives `protected-paths` the real unset reply (`resolvePolicyKeys(['protected-paths'], { policyRaw: '' })['protected-paths']`) unless overridden, and the generic per-key "missing / without value / not an object" loop then covers it. Add cases `'protected-paths invalid: true'` (the real reply for `["infra/**"]`) and `'protected-paths value 5'`, both expecting `policy-unreadable`. `test('#6020: a resolved protected-paths list decides the driver and express lanes', …)`: with labels `risk:low, size:low, ceremony:fast-lane, type:task`, Key File `plugin/hooks/x.js` and `express-driver-protected-paths: refuse`, the lane is neither `driver` nor `express` when the key is unset, is `driver` or `express` under `{ value: 'infra/**', source: 'policy' }`, and Key File `infra/main.tf` is neither under that same value.
  - `cli-plan-lane.test.js`: `POLICY` gains `protected-paths` with the real unset reply (the harness's per-key source must stay `default` for this key). The existing "resolves exactly POLICY_KEYS" test then covers the call.
  - `queue.test.js`: the line 61 `SECOND_KEYS` pin appends `'protected-paths'`. `test('#6020: the express half keeps a protected Key File record only when the resolved list does not protect it', …)`: express on, driver off, an issue whose body lists `plugin/hooks/x.js`. `keepSingleton` is false with the key absent and true with `'protected-paths': 'infra/**'`. Add the same pair for the driver half (express off, `express-driver: on`, refuse mode).

- [ ] **Step 2: Run the tests to verify they fail**
Run: `node --test tests/bin-lib/driver/plan-lane.test.js tests/bin-lib/express/cli-plan-lane.test.js tests/bin-lib/express/queue.test.js`
Expected: FAIL (pins lack `protected-paths`)

- [ ] **Step 3: Implement the plan-lane and queue edits**

- [ ] **Step 4: Run the tests to verify they pass**
Run: `node --test tests/bin-lib/driver/plan-lane.test.js tests/bin-lib/express/cli-plan-lane.test.js tests/bin-lib/express/queue.test.js tests/bin-lib/driver/budget.test.js`
Expected: PASS

- [ ] **Step 5: Commit** `Read protected-paths in the plan lane and the queue pull — both lanes judge with the resolved list`

### Task 7: The evidence-path guard tests the union

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/driver/review.js:395-405` (`isProtectedOrSensitive(p, sensitivePaths = [], protectedPathGlobs)`), `:489`, `:503` (pass `optsOf(opts).protectedPathGlobs`), `:564-565`, `:1007-1015` (`writeEvidence`/`rewriteEvidence` take and thread `protectedPathGlobs`), `:881-882`, `:918`, `:1097-1100` (each step site computes `protectedPathGlobsOf(shared.policy['protected-paths'])` beside `sensitivePaths`), and the header comment at line 98 (the guard uses "the union of the shipped protected list and `protected-paths`")
- Test: `tests/bin-lib/driver/review.test.js`

**Interfaces:**
- Consumes: `SHIPPED_PROTECTED_PATHS` (Task 3), `protectedPathGlobsOf` (Task 4).
- Produces: `isProtectedOrSensitive` returns true when `protectedPathGlobs` is neither `undefined` nor an array of strings (fail closed, as `sensitivePaths` does). Otherwise it sets `union = [...SHIPPED_PROTECTED_PATHS, ...(protectedPathGlobs || [])]` and tests `[p, lower, p.toUpperCase()].some((s) => isProtectedPath(s, union))`, keeping the three case spellings. Then the existing sensitive check runs.

- [ ] **Step 1: Write the failing tests** in `tests/bin-lib/driver/review.test.js` (the file's `pathRuleViolation` and `pathOpts`)
  - `test('AC3.1 (guard half): protected-paths [] still refuses an evidence path under hooks/', …)`: `pathRuleViolation('hooks/a.test.js', pathOpts({ protectedPathGlobs: [] }))` is `'protected-or-sensitive'`.
  - `test('AC7.1, AC7.2: with a list passed the guard tests the shipped list and the list', …)`: under `{ protectedPathGlobs: ['infra/**'] }`, `hooks/a.test.js`, `infra/a.test.js` and `.github/x.test.js` are each `'protected-or-sensitive'`, and `tests/a.test.js` is not.
  - `test('AC9.2 (guard half): the union keeps the three case spellings', …)`: `INFRA/a.test.js` and `Infra/a.test.js` under `['infra/**']` are `'protected-or-sensitive'`.
  - `test('a protectedPathGlobs that is not a list of strings fails closed', …)`: `'infra/**'` and `[5]` both give `'protected-or-sensitive'` for `tests/a.test.js`.
  - Any PATH_RULES row test that builds its own opts keeps passing unchanged, since an absent list means shipped only.

- [ ] **Step 2: Run the test to verify it fails**
Run: `node --test tests/bin-lib/driver/review.test.js`
Expected: FAIL (`infra/a.test.js` not refused; `'infra/**'` not fail-closed)

- [ ] **Step 3: Implement the Interfaces above and thread the option**

- [ ] **Step 4: Run the tests to verify they pass**
Run: `node --test tests/bin-lib/driver/review.test.js tests/bin-lib/driver/run.test.js`
Expected: PASS. Then replace `union` with `protectedPathGlobs || SHIPPED_PROTECTED_PATHS` and confirm AC3.1's guard half goes red, then restore.

- [ ] **Step 5: Commit** `Guard evidence paths with the shipped list plus protected-paths — a project can never open a shipped protected path to the reviewer`

### Task 8: The key's prose row and policyOnly lists

**Role:** transcription

**Files:**
- Modify: `plugin/skills/_shared/policy-schema-express-driver.md` (new row after `express-driver-protected-paths`)
- Modify: `plugin/skills/_shared/policy-schema-coverage.md:102` (`policyOnly` bullet: add `` `protected-paths` (#6020) `` after `express-driver-protected-paths`)
- Modify: `docs/journeys/resolve-a-policy-key.md:48` (Red flags list: add `` `protected-paths` ``, #6020, after `express-driver-protected-paths`), and its history list (after line 110): `- Step 3 updated during build of #6020 (protected-paths) — the key is policyOnly, so step 3's red flag lists it`
- Test: `tests/policy-protected-paths.test.js`

**Interfaces:**
- Consumes: the resolver behavior from Tasks 1, 2 and 4.

- [ ] **Step 1: Write the failing test**: `test('AC6.3: the prose row states root-anchoring, the express-lane consequence, the main-checkout read and Phase 11', …)`. The test finds the line of `policy-schema-express-driver.md` matching `` /^\| `protected-paths` \| /m ``. It asserts the line includes each of `root-anchored`, `**/package.json`, `case-sensitive`, `on green with no human`, `main checkout`, `Phase 11`, `invalid: true`, `` `[]` ``, `SHIPPED_PROTECTED_PATHS` and `policyOnly`. The test also asserts the coverage bullet (the line containing ``are `policyOnly` ``) includes `` `protected-paths` (#6020) ``.

- [ ] **Step 2: Run the test to verify it fails**
Run: `node --test tests/policy-protected-paths.test.js`
Expected: FAIL (no row)

- [ ] **Step 3: Write the row** with canonical home `policy.yml`, owners `bin/drive.js`, `bin/express-lane.js` (#6020), and default "the shipped list (`SHIPPED_PROTECTED_PATHS`)". The meaning covers these points:
  - Comma-separated path globs, matched as `merge-sensitive-paths` globs are. They are root-anchored and case-sensitive over the canonical posix path (no leading `./`): `package.json` protects only the root file, `**/package.json` protects every depth, and a trailing `/**` also matches the bare directory.
  - A set list replaces the shipped list, removals included. `[]` protects nothing.
  - Removing an entry lets the express lane merge a change to that path on green with no human.
  - Unset or malformed (`invalid: true`: an empty entry, whitespace, a quote, bracket, brace, `?` or backslash, so the YAML-flow `["infra/**"]` is malformed; a glob with a leading `/` or `./` is valid but matches nothing) keeps the shipped list, never an empty one. The resolver returns `{ value: [], source: 'default' }` unset, the raw comma string set, `[]` for `[]`, and `{ value: [], source: 'default', invalid: true }` malformed.
  - It is always read from the main checkout's `policy.yml`, so a record's branch cannot change its own list.
  - The driver reviewer's evidence-path guard always keeps the shipped list as well.
  - Under `express-driver-protected-paths: reviewer`, a path the project adds is never build-time.
  - `policyOnly`, so a `--run` config never shrinks it. It is refused from the factory layer, and Phase 11 will let a factory set a floor.
  Then the coverage and journey edits.

- [ ] **Step 4: Run the tests to verify they pass**
Run: `node --test tests/policy-protected-paths.test.js tests/policy-schema.test.js tests/policy-schema-metadata.test.js tests/policy-key-naming.test.js tests/bin-lib/driver/run.test.js`
Expected: PASS

- [ ] **Step 5: Commit** `Document protected-paths — root-anchored globs, the express-lane consequence, main-checkout read`

### Task 9: Lane prose and the retired-name sweep

**Role:** transcription

**Files:**
- Modify: `plugin/skills/_shared/express-lane.md:7` (Eligibility: after "never override a verdict by judgment.", add "The protected-path list is a policy value, `protected-paths` (`_shared/policy-schema-express-driver.md`), read from the main checkout's `policy.yml`: unset keeps the shipped list, and a project that removes an entry lets this lane merge changes to that path on green with no human.")
- Modify: `tests/express-lane-prose.test.js:38-39` (add a row `{ section: ELIG, re: /The protected-path list is a policy value, `protected-paths`/, name: 'protected list is a policy value' }`)
- Modify: `docs/journeys/ship-a-small-record-on-the-express-lane-4025.md:43` (replace "Protected paths are the same in every project:" with "Protected paths default to a shipped list, which a project replaces with `protected-paths` in the main checkout's `policy.yml`:", keeping the list and the Key-File sentence) plus a history bullet `- Updated during the build of #6020: the protected list is the protected-paths policy value`
- Modify: `docs/journeys/ask-whether-a-record-needs-a-plan-6053.md:25` (`POLICY_KEYS` list appends `protected-paths`) plus a history bullet `- Updated during the build of #6020: the verb also resolves protected-paths`
- Modify: `docs/plugin-structure.md:123`, in `eligibility.js`'s description: `isProtectedPath(path, list)` over `SHIPPED_PROTECTED_PATHS` (one glob per `PROTECTED_FAMILIES` entry, matched with `globToRegExp`); every gate's `protectedPathGlobs` option (absent = shipped, #6020); `BUILD_TIME_PROTECTED_GLOBS` replaces `BUILD_TIME_PROTECTED_RES`. In `cli.js`'s: gate and check read `protected-paths`. In `queue.js`'s: the second resolve also reads `protected-paths`.

**Interfaces:**
- Consumes: every earlier task's names.

- [ ] **Step 1: Add the prose-test row** to `tests/express-lane-prose.test.js`

- [ ] **Step 2: Run the test to verify it fails**
Run: `node --test tests/express-lane-prose.test.js`
Expected: FAIL (the new row's regex has no match)

- [ ] **Step 3: Make the five prose edits**

- [ ] **Step 4: Verify the prose and the sweep**
Run: `node --test tests/express-lane-prose.test.js tests/risk-flags-bypass-prose.test.js`
Expected: PASS
Run: `git grep -n -e 'BUILD_TIME_PROTECTED_RES' -e 'PROTECTED_PATH_RES' -e 'same in every project' -- plugin docs tests README.md ':!docs/superpowers/plans' ':!docs/superpowers/specs' ':!docs/plans/*-ledger.md' ':!.claude-tweaks/pipelines'`
Expected: no output, exit 1. Control (recorded at authoring): `git grep -n -e 'BUILD_TIME_PROTECTED_RES' -e 'same in every project' b8811c277a -- docs/plugin-structure.md docs/journeys/ship-a-small-record-on-the-express-lane-4025.md` matches both files (`docs/plugin-structure.md:123` and the journey's line 43). The `:!` exclusions were added per #4579.
Run: `npm test -- --full > "$PIPELINE_RUN_DIR/evidence/full-suite.txt" 2>&1` (create the directory first with `mkdir -p "$PIPELINE_RUN_DIR/evidence"`)
Expected: 0 failing files. Re-run any failing file alone with `node --test <file>` before treating it as real.

- [ ] **Step 5: Commit** `Name protected-paths in the lane prose — retire the fixed-list wording and the regex export names`

## Spec coverage

| Spec item | Task |
|---|---|
| Deliverable 1 (key, unset/set/`[]`) | 1, 2 |
| Deliverable 2 (glob constant + equivalence test) | 3 |
| Deliverable 3 (`isProtectedPath(path, list)`, every caller, evidence-guard union) | 3, 4, 5, 6, 7 |
| Deliverable 4 (prose row and consequence) | 8, 9 |
| Deliverable 5 (`POLICY_KEYS`, express CLI resolved policy) | 4, 5 |
| Deliverable 6 (main-checkout root, verified) | 4 (Global Constraints' authoring check) |
| AC1.1 | 3 (equivalence; existing suites unchanged in Steps 4 of 3-7) |
| AC2.1 | 3, 4, 5 |
| AC3.1 | 3, 5, 7 |
| AC4.1 | 4, 5 |
| AC5.1, AC5.2 | 1, 4, 5 |
| AC6.1, AC6.2, AC6.3 | 3, 8 |
| AC7.1, AC7.2 | 3, 7 |
| AC8.1 | 4 |
| AC9.1, AC9.2, AC9.3 | 3, 7 |
| AC10.1, AC10.2 | 1, 3, 4 |
