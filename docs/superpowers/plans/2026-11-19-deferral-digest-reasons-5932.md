# Deferral Digest Reasons Policy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A policy key `deferral-digest-reasons` names the `Defer-reason:` values that always send an agent-raised deferral to the digest. `routeDeferral` honours it behind the human and severity protections. `bin/deferral-route.js` resolves it from policy, and from a run's config with `--run`. Reflect's auto-mode tangential staging runs the route command. This repository sets the key to `pre-existing-outside-diff, tangential`.

**Architecture:** `plugin/bin/lib/policy-schema.js` gains the key, a `defer-reason` list-element pattern built from `DEFER_REASONS`, and an explicit empty list `[]` on the new row only (row flag `emptyList: true`). `routeDeferral` gains a `digestReasons` input and a `policy-reason` rule between `severity` and `tangential`. The CLI refuses bad input before it reads policy, then calls `resolve-policy.js`'s in-process `resolvePolicy` core for the one key, splits the resolved string, and warns on an invalid value. Prose follows the code: `_shared/materiality-floor.md`'s Overrides, `reflect/SKILL.md`'s auto-mode tangential row, `CLAUDE.md`'s bullet and the policy docs.

**Tech Stack:** Node 18+ CommonJS, `node --test`, markdown skill prose. No dependencies.

**Spec:** `.claude-tweaks/pipelines/2026-11-19T070031-spec-5930-5931-5932-5933/spec-5932/work/5932-spec.md`

Scope keywords: deferral-digest-reasons, policy-reason

Consumer sweep at plan time. A Check B walk with the wider keywords `deferral-route` and `routeDeferral` hit these files outside the Files blocks. Each was read and is no-change. The two keywords above are the ones this change introduces. The wider sweep is recorded here instead of being re-run.
- `plugin/skills/review/step3-routing.md`, `plugin/skills/reflect/full-mode.md`, `plugin/skills/visual-review/browser-review.md`, `plugin/skills/wrap-up/residue-sweep.md`, `plugin/skills/wrap-up/leftover-routing.md`, `plugin/skills/wrap-up/review-console.md` and `plugin/skills/_shared/ledger-format.md` are #5931's routing sites. They run the command form with `--agent-raised` and act on `verdict`, which this change leaves intact. They pass no `--run`, so they read `policy.yml` alone. None of them names a `rule` value.
- `tests/control-mode-console-prose.test.js` pins those sites' prose, which does not change.
- `docs/superpowers/plans/2026-11-19-deferral-route-5930.md`, `docs/superpowers/plans/2026-11-19-deferral-route-sites-5931.md` and `docs/plans/2026-11-19-spec-5930-5931-5932-5933-ledger.md` are this run's history.
- `.impeccable/hook.cache.json` is a tool cache.

## Fact-check of the spec (corrected facts, checked at plan time on base 646e7a8992)

The code lines cited below are unchanged since d900d9968f. The commits between d900d9968f and 646e7a8992 touch only the spec and this plan.

- **Gotchas ASSUMPTION 1: holds at plan time.** It was probed against the installed release, 6.173.1. The probe used a scratch git repo whose `.claude-tweaks/policy.yml` held `autonomy: trusted` and `deferral-digest-reasons: pre-existing-outside-diff, tangential`. `resolve-policy.js --values autonomy` exited 0 and printed `trusted`, with nothing on stderr. `resolve-policy.js autonomy deferral-digest-reasons` exited 0 and printed `{"autonomy":{"value":"trusted","source":"policy"},"deferral-digest-reasons":{"error":"unknown-key"}}`. `hooks.sh`'s `policy_verdict` reads only `worktree-always` lines. The build re-runs the probe in Task 6 Step 3, before it lands the `policy.yml` line. `Waived AC8.2`: the condition is Task 6 Step 3's probe, which held at plan time. `Waived AC8.3`: that is the fallback branch, taken only when Task 6 Step 3 fails. Task 6 Step 3 says what to drop then.
- **Gotchas ASSUMPTION 2: reversed** (probed at build time). The existing resolver does **not** refuse a `policy.yml` symlink that resolves outside the checkout. It reads the file. A dangling symlink reads as absent (`readFileSafe` returns `null`). `hooks.sh`'s `policy_verdict` reads it the same way (`[ -f … ]`, line 99). The route command adds no path logic of its own and inherits the resolver as it is. This plan adds no symlink guard and no test that asserts a refusal. The guard belongs to the resolver, so Task 6 Step 7 files it as a follow-up record (amendment 3b).
- **AC6 (spec Plan-review Decision 2).** `invalidValues` and `unrecognizedKeys` are fields of `auditPolicy`'s return value (`policy-schema.js` lines 1017 and 1041). They are not part of `resolvePolicyConfig`'s return. `resolvePolicyConfig` returns `{ root, policyRaw, runConfigRaw, result, policyPath, policySource }` (line 1002), and that shape does not change. It reports an invalid value on the key's entry as `{ value: <default>, source: 'default', invalid: true }` (`resolvePolicyKeys`, line 724), and passes the raw value to `onInvalid`. The AC6.1 test asserts three things: `auditPolicy(root).invalidValues` names the key, the `resolvePolicyConfig` entry carries `invalid: true`, and the return's key set is unchanged.
- A configured `list` value resolves to the **raw comma-separated string**. `resolveValue` returns `rawValue` for a list. It does not return an array. The unset default is `[]`. The CLI splits the string on `,` and trims each entry. That is the same split `isValidValue` uses (line 506).
- **An empty list in a run config (amendment 3d).** `parseFlatLines` drops a blank value (line 442). So `deferral-digest-reasons:` with nothing after it reads as unset and falls through to `policy.yml`'s list. Prior art spells an explicit empty list `[]`: `console-resolve.js` line 305, `EMPTY_LIST_RE = /^\[\s*\]$/`, with the comment "the schema's empty list". The schema resolver itself rejects `[]` on a list row with an `element` today. `[]` matches no element, so the key resolves to its default with `invalid: true`, plus a warning. Task 1 makes `[]` valid only on a list row carrying the new row flag `emptyList: true`, with inner whitespace allowed: it validates, and resolves to the array `[]` with its source. Only the new key sets the flag (plan review round 2). The three existing element-bearing rows (`risk-categories`, `owned-owners`, `trusted-authors`) are unchanged: `[]` stays invalid there, because `riskAllowedSlugs` (`policy-schema.js` lines 802-805) reads the raw value, passes it to `isValidValue`, then splits it on commas, so accepting `[]` there would make `'[]'` an allowed risk-path-globs slug. A row with no `element` still resolves `[]` to the raw string, unchanged. Return-shape widening check: the entry stays `{ value, source }`. `console-resolve.js`'s own `EMPTY_LIST_RE` reads a base-branch file without the schema resolver. It is left as it is: switching it to a shared constant changes no behaviour.
- **Refusal before `--run` (amendment 3c).** A call can carry both a refusal and a bad `--run` dir. The refusal wins. It is exit 2 with the refused JSON on stdout and its reason on stderr, and the CLI reads no policy. That covers a parse refusal such as a repeated flag, and a routing refusal: an unknown reason, a bad `--severity`, or both or neither origin flag. A refusal is a caller error that no policy value can change. `routeDeferral`'s refusal checks run before any rule that reads `digestReasons`. So routing once with `digestReasons: []` finds every refusal without touching policy. Exit 1 is therefore reserved for a well-formed call whose `--run` the resolver refuses.
- No cycle: `record-payload.js` requires only `record-vocabulary` (which requires only `facet-shape`, which requires nothing) and `markdown-blocks` (which requires nothing). `plugin/bin/lib/hooks/pre-tool-use.js` already loads `record-payload.js` (probed through `require.cache`). So the import adds no module load to the hook path.
- "A read failure is the resolver's own error exit": `resolve-policy.js`'s `readFileSafe` (line 89) swallows every read error, so an unreadable `policy.yml` reads as absent. The resolver's only error exit is an invocation failure, `{ code: 1, message }`. That happens for a `--run` dir that is missing, is not a directory, or sits in a checkout other than the main checkout (`anchoredOrOutsideMessage`, line 110). The CLI passes that through as a new **exit 1**: the message on stderr, nothing on stdout. #5930's constraint "exit codes only grow" allows a new code.
- **Not a Manifesto lever.** `_shared/policy-schema-read-path.md` line 21 says a lever "walks `_shared/auto-mode-contract.md`'s 'Adding a new policy lever' checklist when it is Manifesto-visible". `set-config.js` accepts only the 13 Manifesto levers plus the run pins. This key is project policy that the route command reads. Walking the checklist gives this result. Items 1-4 do not apply, because no Manifesto surface computes or shows the key. Those items are this contract's computed-levers list, `flow/SKILL.md` Step 3, `flow/manifesto.md`/`manifesto-overrides.md`, and `help/reference-card.md`/`help/context-flow.md`. Item 5, the enforcement files, is `bin/deferral-route.js`, `route.js`, `_shared/materiality-floor.md` and `reflect/SKILL.md` (Tasks 2-5). The closing grep is Task 6 Step 6. A run config can still set the key, because the row is not `policyOnly`. AC7 exercises that through a fixture `config.yml`.
- `tests/bin-lib/deferral-route/route.test.js` pins `## Overrides` byte-equal (lines 147-163) and pins `RULES` exactly (line 66). AC1 protects only the exhaustive rule test (lines 35-58). The prose pin and the constants test are updated on purpose, in Tasks 4 and 2.
- **Callers of `deferral-route.js`'s `run`:** `tests/deferral-route-cli.test.js` (every test) and `tests/materiality-floor-conformance.test.js` line 305 (`routeCli(argv, { stdout, stderr })`). Both run with the repository as the cwd, so once Task 6 sets the repository's list they would read it. Task 3 points both at a policy-free scratch dir. `routeDeferral` is called only by `deferral-route.js` and `route.test.js` (`git grep -n -F routeDeferral -- plugin tests tools`).
- **Reflect's auto-mode tangential staging (spec Plan-review Decision 1).** `plugin/skills/reflect/SKILL.md` Step 3's auto table stages every tangential idea as a Queue-writes record proposal (line 123), and the paragraph at line 156 describes that header. Neither runs the route command. Task 5 routes the staging through `bin/deferral-route.js` with `--agent-raised`. On `digest`, the idea goes to the digest and nothing is staged. On `file`, it is staged as today. That makes the bullet's claim, "ideas a run has go to the digest", true when this merges. No follow-up record is filed for it. Observation and convention files with a `record` Destination (line 154) are convention or observation fixes. The console applies them through `bin/reflect-apply.js`. They are outside Decision 1 and do not change. The pins on the touched text: `tests/reflect-integration-branch-probe.test.js` pins only the order of the "Without this header" paragraph, the probe paragraph and the `Number {n}` sentence. `tests/deferral-gate-conformance.test.js:158` pins the `Defer-reason: tangential` header line. Task 5 keeps both.

## Plan-review amendments (round 1)

| Row | Where |
|---|---|
| 3a. Probe the installed release before the `policy.yml` line | Task 6 Step 3 (ahead of Step 4's edit) |
| 3b. File a follow-up record for the resolver reading an outside-the-checkout symlink | Task 6 Step 7 |
| 3c. A refusal wins over a `--run` failure | Fact-check above; Task 3 Interfaces and its `review focus 2` test |
| 3d. A run config holding `[]` overrides a non-empty repository list | Task 1 (`[]` valid and resolver tests) and Task 3 (`AC7.2` CLI test) |

## Global Constraints

- Key name `deferral-digest-reasons` (final). `type: 'list'`, `element: 'defer-reason'`, `default: []`. Precedence: run config, then `policy.yml`, then the default. One flat comma-separated line. One bad element makes the whole value invalid. The literal `[]` is the explicit empty list.
- Precedence in `routeDeferral`, in exactly this order: `refused`, `human`, `severity`, `policy-reason`, `tangential`, `not-low`, `floor`. `policy-reason` gives `digest` whatever the three axes are, for an agent-raised item only. The verdict set stays `file`, `digest`, `refused`.
- With the key unset, every verdict and rule is what it is today. `routeDeferral` treats an absent or non-array `digestReasons` as `[]`.
- The digest list is read from policy, never from a flag. The CLI adds no policy-file path logic of its own. It calls `resolvePolicy` from `plugin/bin/resolve-policy.js`, which finds the file through `plugin/bin/lib/policy-file.js`.
- `defer-reason` element pattern: built from the imported `DEFER_REASONS` (`require('./issues/record-payload')`), never retyped.
- Exit codes: 0 means a verdict or `--help`. 1 means the resolver refused `--run` on a well-formed call (stderr only, no verdict). 2 means refused, and a refusal wins over a `--run` failure. Output keys and the `rule` vocabulary only grow.
- Commit messages: `{Verb} {what} — {detail} (#5932)`, then the session's `Claude-Session:` attribution line as a second `-m`. Stage files by path only. Never `git add -A`, never `git stash`, never `git reset`.
- Tests: one file with `node --test <file>`. Several files with `node tools/run-tests.js <files…>`, because the repo's guard refuses a multi-file `node --test`. Never the full suite.
- Governing skill `.claude/skills/policy-key-addition/SKILL.md`, quoted verbatim:
  - "`tests/policy-schema.test.js` pins `POLICY_KEYS.length`. Bump it in the same commit, and rewrite the `Last bump: {old} -> {new}, #{record}` line directly above the assertion — the test fails when that line's new value differs from the pin."
  - "Every key needs a table row there that starts `` | `{key}` | `` (`tests/policy-key-naming.test.js`), and its summary must not be copied verbatim from the row's `summary` (`tests/policy-schema-metadata.test.js`). State the value the resolver returns for unset, set and malformed input, from the code, not from intent."
  - "\"Lands\" means merges: a key whose first consumer arrives in a later task of the same PR merges together with it, so it takes no marker".
  - "Every new key gets this decision, even when the answer is neither flag. … Say the decision in the comment above the row, as both of those do."
  - "**`list`** takes an optional `element` (`login` or `slug` in `LIST_ELEMENT_PATTERNS`) that every comma-separated entry must match, and an empty entry never does. The unset default is `[]`. A configured list resolves to the raw comma-separated string."
  - "**Pin each new validation branch with its own assertion.**"
  - "The core tier has an enforced cap of 12 … so a new key is `advanced` unless it replaces a core one."
- Governing skill `.claude/skills/gh-api-module-pattern/cli-wrapper-contract.md`, quoted verbatim: "The standard io keys, each present only when the CLI uses it, are `stdout(text)`, `stderr(text)`, `cwd()`, `env` (a plain object, read-only), `stdin()` (the whole input as a string) and `homeDir()`." "Read `deps.cwd()` only where a relative path or a child process needs it: `realDeps.cwd()` is `process.cwd()`, which throws in a deleted working directory."
- Governing skill `.claude/skills/skill-prose-conformance-tests/SKILL.md`, quoted verbatim: "Read governed markdown through `tests/helpers/read-skill.js`'s `readText()`, never a private `fs.readFileSync(p, 'utf8')`." "When the assertion and the prose it pins are authored in the same change … copy the pinned literal out of the edit's own replacement text, never from memory of what that edit says." "Prove the assertion can go red before trusting its green: negate the prose and assert the regex *fails*, one claim per test." "**A clause pinned to its row or paragraph owes a move-out control, not only a deletion.**"
- No source scan is added, so `bin-source-scan-conformance` does not apply. No new spawn is added: `callerDeps`' `gitRoot` already passes `windowsHide`. Tests assert no path text. The `--run` error is matched by its fixed prefix only, so `windows-checkout-test-parity` has nothing to pin.
- Sizes (`wc -c`; rail `RAIL_BYTES` = 52,500 and `RAIL_LINES` = 2,000, `plugin/bin/lib/skill-audit/budgets.js`, applied to every skill file, a `SKILL.md` included):

  | File | Start | End (planned text) | Headroom |
  |---|---|---|---|
  | `plugin/skills/_shared/policy-schema.md` | 51129 | 51297 (+168, stub measured) | 1203 (97.7% of rail) |
  | `plugin/skills/_shared/materiality-floor.md` | 15373 | 15775 (Overrides 781 → 1183) | 36725 |
  | `plugin/skills/_shared/policy-schema-deferral-routing.md` | new | ~1.6 KB | — |
  | `plugin/skills/reflect/SKILL.md` | 26840 (238 lines) | 28203 (240 lines; +1079 paragraph, +284 on lines 123/126/156, measured from the planned text) | 24297 |
  | `CLAUDE.md` (bullet, line 62) | 545 | 545 (measured) | file total unchanged |

  `policy-schema.md` is within 10% of the rail. This plan applies the remedy the spec names: a key-only stub in the index, and the full row in a new sub-file. The next key that does not fit moves a section out (`policy-key-addition` site 4). This plan moves none, because the stub fits. `reflect/SKILL.md` stays at 54% of the rail and needs no remedy. The addition is kept to one paragraph and three edited lines.

## Review Focus

1. A blank `--run` (`--run ""`, or the unset `$PIPELINE_RUN_DIR` a shell expands to) → `refused`, `--run needs a value`, exit 2, and never a read of the cwd's `config.yml`. A `--run` dir that does not exist → exit 1, nothing on stdout, stderr starting `deferral-route: --run dir does not exist or is not a directory:`, never a verdict over a silently dropped overlay. Pinned by Task 3's `review focus 1` tests.
2. A refusal and a bad `--run` in one call, such as `--defer-reason not-a-reason --agent-raised --run {missing}` → the refusal wins: exit 2, refused JSON on stdout, its reason alone on stderr. Pinned by Task 3's `review focus 2` test.
3. A run config overriding `policy.yml`'s valid list. An invalid value → `[]` with `invalid: true`, never a cascade to `policy.yml`'s list. `[]` → `[]` from `run-config`, so today's verdicts apply. A blank value → unset, so `policy.yml` applies. Pinned by Task 1's resolver tests and Task 3's CLI tests.
4. A near-miss element (`Tangential`, or `tangential,` with the empty entry after its trailing comma) → the whole value is invalid, the default applies, and the warning names `"Tangential"` or `""`. Pinned by Task 1 (resolver) and Task 3 (warning text).
5. `digestReasons` passed in-process as a string (`'pre-existing-outside-diff, tangential'`) → never digests by substring match, and routes as if unset. Pinned by Task 2's guard test.

---

### Task 1: The `deferral-digest-reasons` key, the `defer-reason` list element, and the explicit empty list

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/policy-schema.js` (requires, lines 8-11; `LIST_ELEMENT_PATTERNS`, lines 21-26; `isValidValue`'s `list` case, lines 501-506; `resolveValue`, lines 570-573; a new last `POLICY_KEYS` row after `verify-suite-slots`, line 305)
- Modify: `plugin/skills/_shared/policy-schema.md` (a new `## Deferral routing` stub between `## Efficiency budgets` and `## Control mode`, before line 198)
- Create: `plugin/skills/_shared/policy-schema-deferral-routing.md`
- Modify: `.claude/skills/policy-key-addition/SKILL.md:35` (the `list` bullet)
- Modify: `tests/policy-schema.test.js:46-47` (count 112 → 113)
- Test: `tests/policy-deferral-digest-reasons.test.js` (new; precedent `tests/policy-verify-suite-slots.test.js`)

**Interfaces:**
- Produces: `LIST_ELEMENT_PATTERNS['defer-reason']`, a RegExp matching exactly one `DEFER_REASONS` value. `EMPTY_LIST_RE = /^\[\s*\]$/`, exported. The `POLICY_KEYS` row `{ key: 'deferral-digest-reasons', type: 'list', default: [], element: 'defer-reason', emptyList: true, summary, category: 'pipeline-behavior', tier: 'advanced' }`, with no `policyOnly` and no `policySourceExcluded`. On a list row with `emptyList: true`, a trimmed value matching `EMPTY_LIST_RE` is valid and resolves to a new `[]`. If any schema test enumerates the allowed row fields, register `emptyList` there.

- [ ] **Step 1: Write the failing tests** in `tests/policy-deferral-digest-reasons.test.js`. Use `const KEY = 'deferral-digest-reasons'` and `const LISTED = 'deferral-digest-reasons: pre-existing-outside-diff, tangential\n'`. Tests are pure calls to `resolvePolicyKeys([KEY], { policyRaw, runConfigRaw, onInvalid })` unless noted.
  - `defer-reason element accepts exactly the DEFER_REASONS values`: every `DEFER_REASONS` entry matches. `'not-a-reason'`, `'Tangential'`, `''`, `' tangential'`, `'xtangential'`, `'tangentialx'`, `'[]'` and `'tangential|genuinely-larger'` do not.
  - `defer-reason element is built from DEFER_REASONS`: `LIST_ELEMENT_PATTERNS['defer-reason'].source === `^(?:${DEFER_REASONS.join('|')})$``.
  - `the row: list, element defer-reason, default [], advanced, set by policy or run config`: check `type`, `element`, `default` deepEqual `[]`, `tier` and `category: 'pipeline-behavior'`, with `policyOnly` and `policySourceExcluded` both falsy.
  - `unset resolves the empty default`: `policyRaw: 'autonomy: trusted\n'` → `{ value: [], source: 'default' }`.
  - `a valid list resolves to the raw comma-separated string`: `policyRaw: LISTED` → `{ value: 'pre-existing-outside-diff, tangential', source: 'policy' }`.
  - `AC6.1 an element outside the vocabulary, alone or beside valid reasons, resolves [] and is reported`. For each raw in `['not-a-reason', 'pre-existing-outside-diff, not-a-reason', 'Tangential', 'tangential,', '[], tangential']`: the entry deepEquals `{ value: [], source: 'default', invalid: true }`, and `onInvalid` received `[KEY, raw]`. Then for `not-a-reason` and `pre-existing-outside-diff, not-a-reason`, in a `scratchDir()` project with `.claude-tweaks/policy.yml` written and removed in `after`:
    - `auditPolicy(dir).invalidValues` holds exactly one row with `key === KEY` and `value === raw`.
    - Call `const out = resolvePolicyConfig({ git: () => { throw new Error('no git'); }, readFile: (p) => (fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null), keys: [KEY], cwd: dir })`. Then `out.result[KEY]` deepEquals `{ value: [], source: 'default', invalid: true }`.
    - `Object.keys(out).sort()` deepEquals `['policyPath', 'policyRaw', 'policySource', 'result', 'root', 'runConfigRaw']`, because the return shape is unchanged (spec Plan-review Decision 2).
  - `an explicit [] is the empty list, valid, not reported`: for each raw in `['[]', '[ ]', '[\t]']`, `policyRaw: `deferral-digest-reasons: ${raw}\n`` → `{ value: [], source: 'policy' }`, and `onInvalid` is never called. In a `scratchDir()` project holding `deferral-digest-reasons: []`, `auditPolicy(dir).invalidValues` has no row for `KEY`.
  - `an element-less list keeps [] as its raw string`: `resolvePolicyKeys(['port-services'], { policyRaw: 'port-services: []\n' })['port-services']` deepEquals `{ value: '[]', source: 'policy' }`. This pins the scope of the new branch.
  - `[] stays invalid on an element-bearing row without emptyList (plan review round 2)`: `resolvePolicyKeys(['risk-categories'], { policyRaw: 'risk-categories: []\n', onInvalid })['risk-categories']` deepEquals `{ value: [], source: 'default', invalid: true }` with `onInvalid` called once; and in a `scratchDir()` project holding `risk-categories: []`, `riskAllowedSlugs` returns exactly `BUILTIN_RISK_CATEGORIES` (no `'[]'` slug).
  - `AC7.1 a run config overrides policy.yml (the key is not policyOnly)`: `policyRaw` `…: tangential` and `runConfigRaw` `…: genuinely-larger` → `{ value: 'genuinely-larger', source: 'run-config' }`.
  - `AC7.2 a run config [] overrides a non-empty policy.yml list (amendment 3d)`: `policyRaw: LISTED` and `runConfigRaw: 'deferral-digest-reasons: []\n'` → `{ value: [], source: 'run-config' }`, with no `onInvalid` call.
  - `a blank run-config value reads as unset and falls through to policy.yml`: `policyRaw: LISTED` and `runConfigRaw: 'deferral-digest-reasons:\n'` → `{ value: 'pre-existing-outside-diff, tangential', source: 'policy' }`.
  - `review focus 3: an invalid run-config value never cascades to policy.yml's list`: `runConfigRaw` `…: not-a-reason` and `policyRaw` `…: tangential` → `{ value: [], source: 'default', invalid: true }`.

  Guard discrimination:
  - Deleting `element: 'defer-reason'` from the row turns the AC6.1 test red, because a list with no element accepts anything.
  - Deleting the `defer-reason` pattern makes `isValidValue` throw on `undefined.test`.
  - Deleting the `EMPTY_LIST_RE` branch in `isValidValue` turns `an explicit [] …` and `AC7.2` red (invalid instead).
  - Deleting it in `resolveValue` leaves the value as `'[]'`, which is also red.
  - Dropping the `element !== undefined` condition turns `an element-less list …` red.
  - Dropping the `emptyList === true` condition turns `[] stays invalid on an element-bearing row …` red.

- [ ] **Step 2: Run and see it fail**

Run: `node --test tests/policy-deferral-digest-reasons.test.js`
Expected: FAIL. At plan time the file does not exist. After Step 1, `LIST_ELEMENT_PATTERNS['defer-reason']` is undefined, `POLICY_KEYS` has no row for the key, and `EMPTY_LIST_RE` is not exported.

- [ ] **Step 3: Implement in `plugin/bin/lib/policy-schema.js`**:
  - Add `const { DEFER_REASONS } = require('./issues/record-payload');` beside the other requires.
  - Add the `LIST_ELEMENT_PATTERNS` entry `'defer-reason': new RegExp(`^(?:${DEFER_REASONS.join('|')})$`)`, with a one-line comment: a `Defer-reason:` value (#5932), built from `DEFER_REASONS` so the two never drift. Update the comment above the object to name the three kinds.
  - Add `const EMPTY_LIST_RE = /^\[\s*\]$/;` with a comment: the explicit empty list on a list row with `emptyList: true` (#5932). A blank value reads as unset (`parseFlatLines`), so `[]` is the only way a run config can override a configured list with nothing. This is the same spelling as `console-resolve.js`'s reader. Export it.
  - In `isValidValue`'s `list` case, after the `element === undefined` return: `if (schemaEntry.emptyList === true && EMPTY_LIST_RE.test(value.trim())) return true;`. In `resolveValue`, after the `isValidValue` check: `if (entry.type === 'list' && entry.element !== undefined && entry.emptyList === true && EMPTY_LIST_RE.test(strValue.trim())) return [];`.
  - Append the row after `verify-suite-slots`, with this comment above it: `// #5932: read by bin/deferral-route.js (routeDeferral's policy-reason rule) through resolve-policy.js's resolvePolicy, so a run's config.yml overlays it via --run: neither policyOnly nor policySourceExcluded. Each element must be a DEFER_REASONS value; [] is the explicit empty list. Not a Manifesto lever.` Summary, at most 140 chars and without the key itself: `"Defer-reasons that send an agent-raised deferral to the digest instead of a record; human input and high severity still file."` Add no `Not yet used` marker: the consumer lands in Task 3 of this PR.
  - In `tests/policy-schema.test.js`, change line 46 to `// Last bump: 112 -> 113, #5932` and line 47 to `113`.

- [ ] **Step 4: Write the docs**
  - In `plugin/skills/_shared/policy-schema.md`, insert this block (168 bytes, measured) directly before `## Control mode`:

````text
## Deferral routing

Registered by #5932; read by `bin/deferral-route.js`. Full row: `policy-schema-deferral-routing.md`.

| Key |
|---|
| `deferral-digest-reasons` |

````

  - Create `plugin/skills/_shared/policy-schema-deferral-routing.md` in the shape of `policy-schema-efficiency-budgets.md`. It holds three things.
    - A first-line HTML comment. It names the file as the sibling of `_shared/policy-schema.md`'s "## Deferral routing" section, split out so the index keeps headroom under the rail.
    - `## Deferral routing` and one intro sentence. The sentence says the key was registered by #5932. `bin/deferral-route.js` reads it through `bin/resolve-policy.js`'s resolver, from `policy.yml`, overlaid by a run's `config.yml` when the call passes `--run {dir}`. It is not `policyOnly` and not a Manifesto lever. `_shared/materiality-floor.md`'s Overrides section gives its place in the precedence.
    - The five-column table (`Key | Canonical home | Owner skill(s) | Default | Meaning`) with one row:
      - Key: `` `deferral-digest-reasons` ``.
      - Canonical home: `policy.yml` (or a run's `config.yml` via `--run`).
      - Owner: `bin/deferral-route.js`.
      - Default: `[]`.
      - Meaning: `Defer-reason:` values (`_shared/deferral-gate.md`'s vocabulary) that send an agent-raised deferral to the digest whatever its size, priority and risk; human input and a `high`/`critical` severity still file. Unset resolves `[]`. `pre-existing-outside-diff, tangential` resolves to that raw comma-separated string. `[]` is the explicit empty list: it resolves `[]` from its own source, so a run's `config.yml` holding `[]` overrides a repository list. A blank value reads as unset and falls through. An element outside the vocabulary (`not-a-reason`, `Tangential`, a trailing comma's empty entry) makes the whole value invalid: it resolves to `[]` with `invalid: true`, and `bin/deferral-route.js` prints one stderr warning naming the key and the bad element, then routes as if unset. The run-config overlay is a resolver capability: `set-config.js` writes no such key (it accepts only the Manifesto levers and run pins), and no routing site passes `--run`, so in a pipeline run the repository value applies.
  - `.claude/skills/policy-key-addition/SKILL.md` line 35: replace `` (`login` or `slug` in `LIST_ELEMENT_PATTERNS`) `` with `` (`login`, `slug` or `defer-reason` in `LIST_ELEMENT_PATTERNS`; `defer-reason` is built from `DEFER_REASONS`) ``. After `A configured list resolves to the raw comma-separated string.`, add `On a row with \`emptyList: true\`, the literal \`[]\` (\`EMPTY_LIST_RE\`) is the explicit empty list and resolves \`[]\`; elsewhere \`[]\` stays invalid on an element-bearing row, and a blank value reads as unset.`

- [ ] **Step 5: Run and see it pass**

Run: `node tools/run-tests.js tests/policy-deferral-digest-reasons.test.js tests/policy-schema.test.js tests/policy-key-naming.test.js tests/policy-schema-metadata.test.js tests/resolve-policy-control-mode.test.js tests/resolve-policy-lib.test.js tests/bin-lib/console/control-mode-cli.test.js tests/bin-lib/issues/risk-flag-classify.test.js tests/skill-size-single-source.test.js tests/bin-lib/skill-audit/context-cost.test.js`
Expected: PASS, every file. `wc -c plugin/skills/_shared/policy-schema.md` prints 51297.

- [ ] **Step 6: Commit**

```bash
git add plugin/bin/lib/policy-schema.js plugin/skills/_shared/policy-schema.md plugin/skills/_shared/policy-schema-deferral-routing.md .claude/skills/policy-key-addition/SKILL.md tests/policy-schema.test.js tests/policy-deferral-digest-reasons.test.js
git commit -m "Add the deferral-digest-reasons policy key — a list of Defer-reason values validated against DEFER_REASONS, with [] as the explicit empty list (#5932)" -m "{the session's Claude-Session line}"
```

### Task 2: The `policy-reason` rule in `routeDeferral`

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/deferral-route/route.js` (header comment lines 7-19, `RULES` line 25, `routeDeferral` lines 31-49)
- Test: `tests/bin-lib/deferral-route/route.test.js` (the `constants` test, line 66; new tests after `not-low`, line 133). The `AC7.1 exhaustive` block (lines 35-58) is **not edited**.

**Interfaces:**
- Consumes: nothing from Task 1. The function takes the list already split.
- Produces: `routeDeferral({ deferReason, severity, size, priority, risk, agentRaised, digestReasons }) -> { verdict, rule, reason? }`. `digestReasons` is optional, and treated as `[]` unless `Array.isArray`. The refusal checks run before any rule reads it. `RULES` is frozen `['refused','human','severity','policy-reason','tangential','not-low','floor']`.

- [ ] **Step 1: Write the failing tests** in `route.test.js`:
  - Change the `constants` test's `RULES` expectation to the seven-rule list above.
  - `AC1.1 an explicit empty digestReasons routes exactly as #5930`: the same 5376-case loop as the exhaustive test, passing `digestReasons: []` and comparing with the unchanged `oracle(c)`. Assert the count is 5376.
  - `exhaustive with a digest list: every combination matches the policy oracle`: for each list in `[[], ['pre-existing-outside-diff', 'tangential'], [...DEFER_REASONS], ['genuinely-larger']]`, run the same 5376 combinations (21504 cases; assert the count). Compare with:

```js
function policyOracle(c, list) {
  if (!c.agentRaised) return { verdict: 'file', rule: 'human' };
  if (['high', 'critical'].includes(c.severity)) return { verdict: 'file', rule: 'severity' };
  if (list.includes(c.deferReason)) return { verdict: 'digest', rule: 'policy-reason' };
  return oracle(c);
}
```

  - `AC2.1 a listed pre-existing-outside-diff at size high, risk medium digests by policy-reason`: `{ deferReason: 'pre-existing-outside-diff', size: 'high', risk: 'medium', agentRaised: true, digestReasons: LIST }` (`LIST = ['pre-existing-outside-diff', 'tangential']`, priority omitted) → `{ verdict: 'digest', rule: 'policy-reason' }`.
  - `AC3.1 a listed tangential digests by policy-reason` → `digest`/`policy-reason`. `AC3.2 the same item from a human files by human` (`agentRaised: false`) → `file`/`human`.
  - `AC4.1 a listed reason at severity high files by severity` (and `critical` too) → `file`/`severity`.
  - `AC5.1 an unlisted genuinely-larger at not-low axes files by not-low` → `file`/`not-low`.
  - `a refusal ignores digestReasons`: `{ deferReason: 'not-a-reason', agentRaised: true, digestReasons: [...DEFER_REASONS] }` → `refused`, the same object as with `digestReasons: []`. The CLI's refusal-first order (Task 3) relies on this.
  - `review focus 5: a string digestReasons never digests by substring`: `digestReasons: 'pre-existing-outside-diff, tangential'`. With `pre-existing-outside-diff` at all-low axes → `digest`/`floor`. With `tangential` → `file`/`tangential`. The `tangential` case goes red if the `Array.isArray` guard is deleted.
  - `a non-DEFER_REASONS entry in digestReasons is inert`: `digestReasons: ['not-a-reason']` with `genuinely-larger` at all-low axes → `digest`/`floor`, and at `size: 'high'` → `file`/`not-low`.

- [ ] **Step 2: Run and see it fail**

Run: `git grep -n -F "policy-reason" -- plugin/bin/lib/deferral-route/route.js`
Expected: FAIL. Exit 1, no match (probed at plan time: exit 1).
Run: `node --test tests/bin-lib/deferral-route/route.test.js`
Expected: FAIL after Step 1. The `constants` test, the policy-oracle exhaustive test, AC2.1 and AC3.1 fail. These pass: `AC7.1 exhaustive`, `AC1.1`, AC3.2, AC4.1, AC5.1, the refusal test, the two guard tests and the prose pins. The rules those tests check already hold before the clause exists.

- [ ] **Step 3: Implement** in `route.js`.
  - Add `digestReasons` to the destructured input.
  - After the `severity` clause, add `if (Array.isArray(digestReasons) && digestReasons.includes(deferReason)) return { verdict: 'digest', rule: 'policy-reason' };`.
  - Insert `'policy-reason'` into `RULES` after `'severity'`.
  - In the header comment, add the input and the line `policy-reason — deferReason in digestReasons (policy key deferral-digest-reasons) -> digest`. Note that `materiality-floor.md`'s Overrides section explains it.
  - The function stays pure.

- [ ] **Step 4: Run, and prove the public contract unchanged**

Run: `node --test tests/bin-lib/deferral-route/route.test.js`
Expected: PASS, every test. Then delete the `Array.isArray(digestReasons) &&` guard in a scratch copy and re-run: `review focus 5`'s `tangential` case goes red. Restore the guard.
Run: `git diff 646e7a8992 -- tests/bin-lib/deferral-route/route.test.js`
Expected: no hunk touches lines 35-58, the `AC7.1 exhaustive` block. The only hunks are the `RULES` expectation and the added tests.

Proof(public-contract): with `deferral-digest-reasons` unset (no `digestReasons` passed), #5930's `AC7.1 exhaustive` test passes byte-unmodified over all 5376 combinations. `AC1.1` proves the same for an explicit `[]`, and Task 3's `AC7.2` proves it end to end for a run config holding `[]`. So every pre-existing verdict and rule is unchanged, and the one rule added (`policy-reason`) fires only for a listed reason.

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/deferral-route/route.js tests/bin-lib/deferral-route/route.test.js
git commit -m "Add the policy-reason rule to routeDeferral — a listed reason digests an agent-raised item behind the human and severity protections (#5932)" -m "{the session's Claude-Session line}"
```

### Task 3: The CLI resolves the key, accepts `--run`, refuses first, and warns on an invalid value

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/deferral-route.js` (header lines 1-15, `USAGE`/`ACCEPTED` lines 20-22, `parseArgs` lines 28-65, `realDeps` lines 67-70, `run` lines 72-82)
- Test: `tests/deferral-route-cli.test.js` (the `call` helper, lines 20-26; exact-text rows at lines 141 and 153; `AC8.2`, line 211; `AC8.3`'s `deps`, line 234; new tests)
- Modify: `tests/materiality-floor-conformance.test.js:305` (`routeVerdict`'s `routeCli` deps get a policy-free cwd)
- Modify: `docs/plugin-structure.md:390` (the `deferral-route.js` command entry)
- Modify: `docs/journeys/route-a-deferred-finding-in-code-5930.md` (front-matter `files:`, step 1 lines 32-36, step 2 lines 45-46)
- Read, no change: `plugin/bin/resolve-policy.js` (consumed as-is: `resolvePolicy`, `callerDeps`, `EXIT_OK`) and `plugin/bin/lib/policy-file.js` (reached only through `resolvePolicy`).

**Interfaces:**
- Consumes: `LIST_ELEMENT_PATTERNS['defer-reason']` (Task 1). `routeDeferral({…, digestReasons})` (Task 2). `resolvePolicy({ keys, runDir }, deps) -> { code: 0, result, invalidRaw } | { code: 1, message }` and `callerDeps({ cwd, env })` from `plugin/bin/resolve-policy.js`.
- Produces:
  - `realDeps = { stdout, stderr, cwd: () => process.cwd(), env: process.env }`.
  - `parseArgs(argv) -> { help, reason, input, runDir }`. `runDir` is `null` when absent, and it is not echoed in `input`.
  - `ACCEPTED = '--defer-reason, --severity, --size, --priority, --risk, --agent-raised, --human, --run, --help'`.
  - New `USAGE`: `usage: deferral-route.js --defer-reason <reason> (--agent-raised | --human) [--severity <critical|high|medium|low|info>] [--size <v>] [--priority <v>] [--risk <v>] [--run <dir>] [--help]\nexit codes: 0 a verdict (file or digest) or --help; 1 the policy resolver refused --run (stderr only, no verdict); 2 refused, which wins over a --run failure.\n`.

`run` order (amendment 3c: a refusal wins over a `--run` failure):
1. Parse, then handle `--help`.
2. Handle a parse refusal: exit 2, with no policy read and no `deps.cwd()` read.
3. `const pre = routeDeferral({ ...input, digestReasons: [] })`, with input nulls mapped to `undefined` as today. On `pre.verdict === 'refused'`, print it and exit 2 as today, again with no policy read and no `deps.cwd()` read.
4. Call `resolvePolicy({ keys: ['deferral-digest-reasons'], runDir }, callerDeps({ cwd: deps.cwd(), env: deps.env }))`. On `code !== EXIT_OK`: `deps.stderr(`deferral-route: ${message}\n`)` and return 1, with nothing on stdout.
5. On `entry.invalid`: print one stderr line, `deferral-route: warning: deferral-digest-reasons has invalid element "{bad}" — using the default (no reasons)\n`. `{bad}` is the first trimmed comma-separated entry of `invalidRaw.get(key)` that the `defer-reason` pattern rejects. Then route with `digestReasons` `[]`.
6. Otherwise `digestReasons` is `[]` when the value is an array (the default, or an explicit `[]`). Else it is the resolved string split on `,` and trimmed.
7. Then `routeDeferral`, with the same print and exit as today.

`--run` parsing: a missing next token, one starting with `--`, or a blank or whitespace-only value is refused with `--run needs a value`. A second `--run` is refused with `--run given more than once`.

- [ ] **Step 1: Write the failing tests** in `tests/deferral-route-cli.test.js`:
  - Add helpers at the top:
    - `const NO_POLICY = scratchDir('ct-deferral-route-nopolicy-')`, removed in `after` (`removeScratchDir`). `call(...argv)` passes `{ cwd: NO_POLICY }` to `runCliSync`, so every existing verdict assertion runs against no policy.
    - `project({ policy, runConfig })`: a `scratchDir` with `.claude-tweaks/policy.yml` and/or `run/config.yml`, registered for cleanup, returning `{ dir, runDir }`.
    - `callIn(dir, ...argv)`: the same as `call`, with that cwd.
    - `const LISTED = 'deferral-digest-reasons: pre-existing-outside-diff, tangential\n'`.
  - Retarget the exact texts:
    - Lines 141 and 153 gain `--run, ` before `--help` in the accepted list.
    - `AC8.2` expects `['cwd', 'env', 'stderr', 'stdout']`.
    - `AC8.3`'s `deps` becomes `{ stdout, stderr: () => {}, cwd: () => NO_POLICY, env: {} }`. Its expected `codes` and `calls` are unchanged.
  - `AC2.1 CLI: listed pre-existing-outside-diff at --size high --risk medium digests by policy-reason`: `callIn(project({ policy: LISTED }).dir, '--defer-reason', 'pre-existing-outside-diff', '--size', 'high', '--risk', 'medium', '--agent-raised')` → exit 0, `digest`/`policy-reason`, stderr `''`.
  - `AC3.1 CLI: listed tangential digests` → `digest`/`policy-reason`. `AC3.2 CLI: the same with --human files` → `file`/`human`.
  - `AC4.1 CLI: listed reason with --severity high files` → `file`/`severity`.
  - `AC5.1 CLI: genuinely-larger at --size high --priority medium --risk high files` → `file`/`not-low`.
  - `AC6.1 CLI: an invalid list warns once and still prints a verdict`: for each policy in `['deferral-digest-reasons: not-a-reason\n', 'deferral-digest-reasons: pre-existing-outside-diff, not-a-reason\n']`, call `pre-existing-outside-diff --size high --agent-raised` → exit 0, `file`/`not-low` (the empty default). Stderr is exactly `deferral-route: warning: deferral-digest-reasons has invalid element "not-a-reason" — using the default (no reasons)\n`.
  - `review focus 4: a near-miss element is named in the warning`: the policy `…: Tangential` gives a warning naming `"Tangential"`, and the policy `…: tangential,` gives one naming `""`. Both give `tangential` → `file`/`tangential`.
  - `AC7.1 CLI: a run config overrides the repository's list for a call with --run`: policy `…: tangential`, run config `…: genuinely-larger`.
    - `genuinely-larger --size high --agent-raised --run {runDir}` → `digest`/`policy-reason`.
    - The same call without `--run` → `file`/`not-low`.
    - `tangential --agent-raised --run {runDir}` → `file`/`tangential` (replaced, not merged).
  - `AC7.2 CLI: a run config [] overrides a non-empty repository list (amendment 3d)`: policy `LISTED`, run config `deferral-digest-reasons: []\n`.
    - With `--run {runDir}`: `pre-existing-outside-diff --size high --agent-raised` → `file`/`not-low`, `pre-existing-outside-diff --size low --priority low --risk low --agent-raised` → `digest`/`floor`, and `tangential --agent-raised` → `file`/`tangential`. These are today's verdicts, with stderr `''` on all three.
    - The same three calls without `--run` give `digest`/`policy-reason`. That shows the repository list is live, and the run config's `[]` is what removed it.
  - `review focus 3 CLI: an invalid run-config value never falls back to policy.yml's list`: policy `LISTED`, run config `…: not-a-reason`. `tangential --agent-raised --run {runDir}` → `file`/`tangential`, plus one warning line.
  - `review focus 1: a blank --run is refused`: `--run ''` and `--run '   '` → exit 2, `refused`, reason `--run needs a value`. `--run` as the last token gives the same. `--run a --run b` → `--run given more than once`.
  - `review focus 1: a missing --run dir is the resolver's exit 1, no verdict`: `--run {dir}/missing` on a well-formed call → code 1, stdout `''`, stderr starting `deferral-route: --run dir does not exist or is not a directory:`. Call `runCliSync` directly, because `call` expects a stdout line.
  - `review focus 2: a refusal wins over a missing --run dir (amendment 3c)`, each with `--run {dir}/missing`:
    - `--defer-reason not-a-reason --agent-raised` → code 2, stdout JSON `verdict` `refused`, and stderr is one line starting `--defer-reason "not-a-reason" is not one of:`. It must not contain `--run dir does not exist`.
    - `--defer-reason tangential` (no origin flag) → code 2, reason `exactly one of --agent-raised or --human is required`.
    - `--defer-reason tangential --agent-raised --severity bogus` → code 2, reason starting `--severity "bogus" is not one of:`.
    - `--defer-reason tangential --agent-raised --size` followed by the `--run` pair (a flag missing its value) → code 2, reason `--size needs a value`.
    - A go-red check: the same in-process call with a `deps.cwd` that throws still returns 2. That proves no policy read and no `deps.cwd()` read happened.
  - In `tests/materiality-floor-conformance.test.js`, give `routeVerdict`'s `routeCli` call the deps `{ stdout, stderr, cwd: () => NO_POLICY_DIR, env: {} }`. `NO_POLICY_DIR` is a `scratchDir` created once at the top of the file and removed in `after`. Its expected verdicts stay as they are.

- [ ] **Step 2: Run and see it fail**

Run: `git grep -n -F "deferral-digest-reasons" -- plugin/bin/deferral-route.js`
Expected: FAIL. Exit 1, no match (probed at plan time: exit 1).
Run: `node --test tests/deferral-route-cli.test.js`
Expected: FAIL after Step 1. These fail: AC2.1, AC3.1, AC6.1, AC7.1, AC7.2, review focus 1 (blank and missing dir), 3 and 4, the accepted-list texts and `AC8.2`. Review focus 2's first three calls also fail: today's CLI refuses them with `unknown flag --run`, not their own reason. These pass: the other pre-existing tests, review focus 2's `--size` call (its parse refusal comes first today too), and its throwing-`cwd` check (today's CLI never calls `deps.cwd()`). Those two are kept as regression pins for the order Step 3 builds.

- [ ] **Step 3: Implement `plugin/bin/deferral-route.js`** per the Interfaces block.
  - The header comment gains the policy read (key, resolver, `--run` overlay), the warning line, the refusal-first order and exit 1. These replace "There is no exit 1". Keep "Writes nothing and makes no gh call."
  - Import `{ resolvePolicy, callerDeps, EXIT_OK }` from `./resolve-policy` and `{ LIST_ELEMENT_PATTERNS }` from `./lib/policy-schema`.
  - The last statement stays `if (require.main === module) process.exitCode = run(process.argv.slice(2), realDeps);`.

- [ ] **Step 4: Docs.** Replace `docs/plugin-structure.md` line 390 with one line:
  `node plugin/bin/deferral-route.js --defer-reason <reason> (--agent-raised | --human) [--severity <s>] [--size <v>] [--priority <v>] [--risk <v>] [--run <dir>]   # Deferral route CLI (#5930, #5932) — decides in code whether a legitimately-deferred item files as a record or appends to the digest, reproducing _shared/materiality-floor.md's floor and overrides (plugin/bin/lib/deferral-route/route.js's routeDeferral, pure); reads policy key deferral-digest-reasons through resolve-policy.js's resolvePolicy (policy.yml, overlaid by {dir}/config.yml with --run; [] there is the explicit empty list) and digests an agent-raised item whose reason it lists (rule policy-reason); an invalid value prints one stderr warning and routes as if unset; prints one JSON line {verdict: file|digest|refused, rule: refused|human|severity|policy-reason|tangential|not-low|floor, reason (refused only), input}; writes nothing, no gh call; exit 0 file or digest, 1 the resolver refused --run on a well-formed call (its message on stderr, nothing on stdout), 2 refused (an unknown reason, both or neither origin flag, a bad --severity, a flag without its value, a repeated or unknown flag) with the JSON still on stdout, checked before any policy read so a refusal wins over a --run failure (tests in tests/bin-lib/deferral-route/route.test.js and tests/deferral-route-cli.test.js)`
  Changes to the journey:
  - Add `plugin/bin/lib/policy-schema.js` to `files:`.
  - Rewrite line 32: `digest` comes from rule `floor` (every floor condition held) or rule `policy-reason` (the reason is listed in policy key `deferral-digest-reasons`, whatever the axes).
  - Line 33's order becomes `refused`, `human`, `severity`, `policy-reason`, `tangential`, `not-low`, `floor`.
  - Line 36's red flags become: a `floor` digest with any axis other than `low`; a `digest` for `--human` or a `high`/`critical` severity; a `tangential` digest whose rule is not `policy-reason`; the command creating a file or a record.
  - Step 2 gains three bullets. Exit 1 with nothing on stdout means the resolver refused `--run`, with its message on stderr. A refusal is exit 2 even when `--run` is also bad. An invalid `deferral-digest-reasons` value prints one stderr warning naming the bad element, and routes as if the key were unset.

- [ ] **Step 5: Run and see it pass**

Run: `node tools/run-tests.js tests/deferral-route-cli.test.js tests/bin-lib/deferral-route/route.test.js tests/materiality-floor-conformance.test.js tests/bin-lib/cli-entry-conformance.test.js tests/bin-lib/exit-code-conformance.test.js tests/path-guard-conformance.test.js tests/windows-hide-spawn-conformance.test.js tests/claude-plugin-root-require-conformance.test.js tests/helpers-run-cli.test.js`
Expected: PASS, every file.

- [ ] **Step 6: Commit**

```bash
git add plugin/bin/deferral-route.js tests/deferral-route-cli.test.js tests/materiality-floor-conformance.test.js docs/plugin-structure.md docs/journeys/route-a-deferred-finding-in-code-5930.md
git commit -m "Resolve deferral-digest-reasons in the deferral-route CLI — --run overlays a run's config, a refusal wins over a bad --run, an invalid value warns and routes as unset (#5932)" -m "{the session's Claude-Session line}"
```

### Task 4: The Overrides section states the precedence and the digest lifecycle it relies on

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/skills/_shared/materiality-floor.md:21-31` (the `## Overrides` section, replaced whole)
- Test: `tests/bin-lib/deferral-route/route.test.js` (`OVERRIDES_SECTION`, lines 147-158; header comment lines 6-9; the go-red `tangentialLine`, line 175)
- Test: `tests/materiality-floor-conformance.test.js` (line 74 retargeted; a new block after line 363)
- Read, no change: `plugin/skills/tidy/digest-sweep.md`, for the lifecycle facts (line 81: three entries sharing an area; line 103: 90 days).

Pin inventory, from `git grep -n -F` over `tests plugin docs .claude/skills` for each Overrides phrase:
- `always clears the floor` and `ideas are intent` appear only in `materiality-floor.md` and `route.test.js`.
- `A finding carrying severity \`high\` or \`critical\` always clears the floor` at `tests/materiality-floor-conformance.test.js:74` is retargeted to `A finding carrying severity \`high\` or \`critical\` files as an ordinary issue`.
- `/tangential/` and `/capture` at lines 69-70 are kept.
- The health-sweep files' "always clears the materiality floor" (`harness-health/filing.md:31`) is a different sentence in a different file: no change.
- The `## Applying the floor` section and its `FLOOR_NEEDLES` are not touched.

- [ ] **Step 1: Write the failing tests.**
  - In `route.test.js`:
    - Set `OVERRIDES_SECTION` to Step 3's replacement block, byte for byte, with backticks escaped. Copy it out of this plan's text; never retype it.
    - Change the header comment's "base commit 05a65b7353" to name the Overrides text as rewritten by #5932.
    - Set the go-red `tangentialLine` to `` '4. `Defer-reason: tangential` files as an ordinary issue — a tangential finding is a new idea the\n' ``.
  - In `materiality-floor-conformance.test.js`, retarget line 74 as listed above. Then add:

```js
// #5932 AC9: Overrides lists the precedence in order, names the digest lifecycle the policy relies on,
// and no longer says a tangential reason "always clears the floor".
const OVERRIDE_ORDER = [
  '1. Human-typed `/capture` input files',
  '2. A finding carrying severity `high` or `critical` files',
  '3. An agent-raised item whose `Defer-reason:` is listed in policy key `deferral-digest-reasons`',
  '4. `Defer-reason: tangential` files',
];
const OVERRIDE_LIFECYCLE = ['`tidy/digest-sweep.md`', 'promotion when three entries share an area', 'expiry after 90 days', "Changing either changes this policy's effect"];
function overridesProblems(text) {
  const section = sectionOf(text, '## Overrides').replace(/\s+/g, ' ');
  const problems = [...OVERRIDE_ORDER, ...OVERRIDE_LIFECYCLE].filter((n) => !section.includes(n)).map((n) => `Overrides lacks ${n}`);
  if (problems.length === 0) {
    const at = OVERRIDE_ORDER.map((n) => section.indexOf(n));
    if (at.some((i, k) => k > 0 && i < at[k - 1])) problems.push('Overrides lists the precedence out of order');
  }
  if (section.includes('always clears the floor')) problems.push('Overrides still says "always clears the floor"');
  return problems;
}
const OVERRIDES = () => sectionOf(FLOOR, '## Overrides');
test('AC9.1 Overrides lists the precedence in order and no longer says always clears the floor', () => {
  assert.deepStrictEqual(overridesProblems(FLOOR), []);
});
for (const needle of [...OVERRIDE_ORDER, ...OVERRIDE_LIFECYCLE]) {
  test(`#5932 go-red: ${needle} moved out of Overrides fails the check`, () => {
    const sec = OVERRIDES();
    const cut = sec.replace(flexible(needle), '');
    assert.notEqual(cut, sec, `anchor ${needle} not in Overrides`);
    const moved = `${FLOOR.replace(sec, () => cut)}\n${needle}\n`;
    assert.deepStrictEqual(overridesProblems(moved), [`Overrides lacks ${needle}`]);
  });
}
test('#5932 go-red: the policy item after the tangential item fails the order check', () => {
  const sec = OVERRIDES();
  const i3 = sec.indexOf('3. An agent-raised');
  const i4 = sec.indexOf('4. `Defer-reason: tangential`');
  assert.ok(i3 > 0 && i4 > i3);
  const swapped = `${sec.slice(0, i3)}${sec.slice(i4)}\n${sec.slice(i3, i4)}`;
  assert.deepStrictEqual(overridesProblems(FLOOR.replace(sec, () => swapped)), ['Overrides lists the precedence out of order']);
});
test('#5932 go-red: "always clears the floor" back in Overrides fails the check', () => {
  const mutated = FLOOR.replace('files as an ordinary issue — a tangential', 'files as an ordinary issue and always clears the floor — a tangential');
  assert.notEqual(mutated, FLOOR);
  assert.deepStrictEqual(overridesProblems(mutated), ['Overrides still says "always clears the floor"']);
});
```

  `flexible` is the helper the file already defines at line 221. Place the new block after it, beside the other `#5932`/`#5931` blocks: after line 363.

- [ ] **Step 2: Run and see it fail**

Run: `git grep -n -F "deferral-digest-reasons" -- plugin/skills/_shared/materiality-floor.md`
Expected: FAIL. Exit 1, no match (probed at plan time: exit 1).
Run: `node tools/run-tests.js tests/materiality-floor-conformance.test.js tests/bin-lib/deferral-route/route.test.js`
Expected: FAIL after Step 1. `AC9.1` reports every needle missing, plus `Overrides still says "always clears the floor"`. The retargeted line-74 test fails. Each move-out control fails on its missing anchor. Both prose pins in `route.test.js` fail.

- [ ] **Step 3: Replace `## Overrides`** (lines 21-31, up to the blank line before `## Applying the floor`) with exactly:

````text
## Overrides

Checked in this order, ahead of the floor; the first that applies decides:

1. Human-typed `/capture` input files as an ordinary issue and is out of this contract's scope
   entirely — human input is intent, never exhaust, and never routes to the digest.
2. A finding carrying severity `high` or `critical` files as an ordinary issue. The three axes
   score the record's filing size, not the finding's severity, so without this a small fix to a
   high-severity finding could be digested where no gate that blocks on it (release Step 3's
   `high-severity finding` token) ever looks again.
3. An agent-raised item whose `Defer-reason:` is listed in policy key `deferral-digest-reasons`
   (default empty; `_shared/policy-schema-deferral-routing.md`) goes to the digest whatever its
   three axes, rule `policy-reason`. This relies on the digest lifecycle in `tidy/digest-sweep.md`:
   promotion when three entries share an area, expiry after 90 days un-promoted. Changing either
   changes this policy's effect.
4. `Defer-reason: tangential` files as an ordinary issue — a tangential finding is a new idea the
   finding suggests, not residue of the current work.
````

The "ideas are intent" clause is gone. "Intent, never exhaust" now names human input only, in item 1.

- [ ] **Step 4: Run and see it pass**

Run: `node tools/run-tests.js tests/materiality-floor-conformance.test.js tests/bin-lib/deferral-route/route.test.js tests/deferral-gate-conformance.test.js`
Expected: PASS, every file. `wc -c plugin/skills/_shared/materiality-floor.md` prints 15775.

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/_shared/materiality-floor.md tests/bin-lib/deferral-route/route.test.js tests/materiality-floor-conformance.test.js
git commit -m "State the deferral precedence in the materiality floor's Overrides — human, severity, policy reason, tangential, and the digest lifecycle the policy relies on (#5932)" -m "{the session's Claude-Session line}"
```

### Task 5: Reflect's auto-mode tangential staging runs the route command

**Role:** integration
**Review risk:** high

This task implements spec Plan-review Decision 1. A `digest` verdict puts the idea in the digest and stages nothing, so it never reaches the Review Console's Queue writes section. A `file` verdict stages the candidate as today. No follow-up record is filed for it.

**Files:**
- Modify: `plugin/skills/reflect/SKILL.md` (line 123, the "Tangential idea" table row; line 126, the "Default behavior" sentence; a new paragraph directly before line 156; line 156's lead clause)
- Test: `tests/materiality-floor-conformance.test.js` (`ADOPTERS`, lines 174-186, and `DEFERRAL_SITES`, lines 211-218, each gain `'plugin/skills/reflect/SKILL.md'`; a new block after Task 4's block)
- Read, no change: `plugin/skills/wrap-up/review-console.md` (Queue writes reads only staged files, so nothing is staged means no row) and `plugin/skills/review/step3-routing.md`'s "Below the materiality floor" paragraph (the auto-mode digest-append shape this mirrors).

**Interfaces:**
- Consumes: the CLI form `node "${CLAUDE_PLUGIN_ROOT}/bin/deferral-route.js" --defer-reason {reason} --size {size} --priority {priority} --risk {risk} --agent-raised`, as #5931 wrote it in `reflect/full-mode.md:397` and `_shared/materiality-floor.md:40`. Task 3's policy-free `routeVerdict` deps. Task 4's Overrides text.
- Produces: `reflect/SKILL.md` as a #5931 deferral site. Its command paragraph passes `deferralSiteProblems`, and its command span routes through the real CLI in `routeVerdict`.

- [ ] **Step 1: Write the failing tests** in `tests/materiality-floor-conformance.test.js`:
  - Add `'plugin/skills/reflect/SKILL.md'` to `ADOPTERS` and to `DEFERRAL_SITES`. The existing loops then give it three tests: `cites materiality-floor.md at its filing point`, the `#5931 deferral site … carries the deferral-route.js command form` check (which also rejects `--human` and any restated override anywhere in the file), and `#5931 every deferral-route.js form … routes through the real CLI`.
  - After Task 4's block, add:

```js
// #5932 Decision 1: reflect's auto-mode tangential staging runs the route command; digest stages nothing.
const REFLECT = read('plugin/skills/reflect/SKILL.md');
const REFLECT_ROUTE_NEEDLES = [
  '`{reason}` being `tangential`',
  'stage nothing: no `staged/reflect-{n}.md`',
  "never reaches the Review Console's Queue writes section",
  'A digest write that fails is staged as on `file` instead',
  'On `file`, stage it as the next paragraph describes',
  '"Digest URL and count surfacing"',
];
const REFLECT_ROW_NEEDLES = ['Routed first by `bin/deferral-route.js`', 'On `digest`: a digest entry, nothing staged'];
function reflectRouteProblems(text) {
  const para = text.split(/\n[ \t]*\n/).map((p) => p.replace(/\s+/g, ' ')).find((p) => p.includes(ROUTE_COMMAND)) || '';
  const row = text.split('\n').find((l) => l.startsWith('| Tangential idea')) || '';
  return [
    ...REFLECT_ROUTE_NEEDLES.filter((n) => !para.includes(n)).map((n) => `the routing paragraph lacks ${n}`),
    ...REFLECT_ROW_NEEDLES.filter((n) => !row.includes(n)).map((n) => `the tangential row lacks ${n}`),
  ];
}
test('#5932 reflect routes a tangential idea before staging it, and a digest verdict stages nothing', () => {
  assert.deepStrictEqual(reflectRouteProblems(REFLECT), []);
});
for (const needle of [...REFLECT_ROUTE_NEEDLES, ...REFLECT_ROW_NEEDLES]) {
  test(`#5932 go-red: ${needle} moved out of its paragraph or row fails the reflect check`, () => {
    const cut = REFLECT.replace(flexible(needle), '');
    assert.notEqual(cut, REFLECT, `anchor ${needle} not in reflect/SKILL.md`);
    const where = REFLECT_ROW_NEEDLES.includes(needle) ? 'the tangential row' : 'the routing paragraph';
    assert.deepStrictEqual(reflectRouteProblems(`${cut}\n\n${needle}\n`), [`${where} lacks ${needle}`]);
  });
}
```

- [ ] **Step 2: Run and see it fail**

Run: `git grep -n -F "deferral-route.js" -- plugin/skills/reflect/SKILL.md`
Expected: FAIL. Exit 1, no match (probed at plan time: exit 1).
Run: `node --test tests/materiality-floor-conformance.test.js`
Expected: FAIL after Step 1. Three things fail: reflect's `cites materiality-floor.md` test, its deferral-site test (`no paragraph holds the deferral-route.js command form`), and its real-CLI test (`documents no deferral-route.js command form`). `#5932 reflect routes …` reports every needle missing. Each go-red fails on its missing anchor.

- [ ] **Step 3: Edit `plugin/skills/reflect/SKILL.md`.** Copy each text below exactly.
  - Line 123 becomes:

````text
| Tangential idea (new feature, alternative design) | Routed first by `bin/deferral-route.js` (the routing paragraph below). On `digest`: a digest entry, nothing staged. Otherwise STAGED → backlog work-record candidate. Surfaces at the Wrap-Up Review Console's Queue writes section, following `_shared/auto-mode-contract.md`'s tiered stance — folded into the batch "Approve all" at `supervised`/`trusted`, auto-resolved with zero `AskUserQuestion` calls under `consoleAutoResolve` at `unattended`. | `STAGED {time} — Step 3: tangential idea "{summary}" — backlog candidate — landing: {born-ready|needs:definition} (defer-reason: tangential). Surface at the Queue writes gate.` On `digest`, `_shared/materiality-floor.md`'s Audit line instead. |
````

  - Line 126 becomes:

````text
Default behavior: **defer everything** to the Review Console. The exceptions are safety regressions, which always surface inline, and a tangential idea `bin/deferral-route.js` routes `digest`.
````

  - Insert this paragraph and one blank line directly before line 156, which starts `For a **tangential** finding specifically`:

````text
**Route a tangential idea before staging it (#5932).** Apply `_shared/materiality-floor.md`'s floor test with `node "${CLAUDE_PLUGIN_ROOT}/bin/deferral-route.js" --defer-reason {reason} --size {size} --priority {priority} --risk {risk} --agent-raised`, `{reason}` being `tangential` and each axis judged as the record would be scored (`high` when it cannot be judged). On `digest`, append the idea to the digest container per that file (its Dedup check, then `materialityEntryLine`, `{file refs}` the files the finding names), log that file's Audit line through `log-decision.js --text-file`, and stage nothing: no `staged/reflect-{n}.md`, so the idea never reaches the Review Console's Queue writes section. A digest write that fails is staged as on `file` instead. On `file`, stage it as the next paragraph describes. On `refused` or any other outcome, stage it the same way, its `STAGED` line quoting what the command printed. Reflect's end-of-run summary states the digest comment URL and the count routed this run, per that file's "Digest URL and count surfacing" section.
````

  - In line 156, replace `For a **tangential** finding specifically — the one category` with `For a **tangential** finding the route command above does not digest — the one category`. The rest of that paragraph is unchanged.

  Deictic check: the new paragraph says "the next paragraph", meaning line 156's paragraph, which follows it directly. Line 156 says "the route command above", meaning the new paragraph. The row at line 123 says "the routing paragraph below", meaning the new paragraph at line ~157. The integration-branch probe paragraph (line 188, "Before staging a tangential record") still sits after the "Without this header" paragraph and before the `Number {n}` sentence, and it applies only on the staging path.

- [ ] **Step 4: Run and see it pass**

Run: `node tools/run-tests.js tests/materiality-floor-conformance.test.js tests/reflect-integration-branch-probe.test.js tests/reflect-destination-format-conformance.test.js tests/reflect-apply-console-conformance.test.js tests/deferral-gate-conformance.test.js tests/absence-grep-control-check-prose.test.js tests/build-micro-plan-conformance.test.js tests/bin-lib/skill-audit/context-cost.test.js tests/skill-size-single-source.test.js`
Expected: PASS, every file. `wc -c plugin/skills/reflect/SKILL.md` prints 28203, and `wc -l` prints 240.

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/reflect/SKILL.md tests/materiality-floor-conformance.test.js
git commit -m "Route reflect's auto-mode tangential staging through deferral-route.js — a digest verdict appends to the digest and stages no Queue write (#5932)" -m "{the session's Claude-Session line}"
```

### Task 6: This repository adopts the policy, and CLAUDE.md says so

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `.claude-tweaks/policy.yml` (one line appended after `superpowers-plans-retention: prune-after-wrapup`)
- Modify: `CLAUDE.md:62` (the "No implicit deferrals" bullet, replaced in place)
- Test: `tests/deferral-gate-conformance.test.js` (one test after line 536)
- Waived `plugin/skills/init/claude-md-template.md`: it writes other projects' CLAUDE.md and keeps today's rule on purpose (spec Gotchas). The existing both-copies test at `tests/deferral-gate-conformance.test.js:529` still reads it.

- [ ] **Step 1: Write the failing test** in `tests/deferral-gate-conformance.test.js`: `#5932 CLAUDE.md's no-implicit-deferrals bullet names the route command and this repo's digest reasons`. Find the CLAUDE.md line holding `**No implicit deferrals.**`. Assert it includes `bin/deferral-route.js`, `outside its diff` and `ideas a run has go to the digest`. A go-red control strips each literal from that line, re-runs the same assertion function, and expects a throw.

- [ ] **Step 2: Run and see it fail**

Run: `git grep -n -F "deferral-digest-reasons" -- .claude-tweaks/policy.yml`
Expected: FAIL. Exit 1, no match (probed at plan time: exit 1).
Run: `node --test tests/deferral-gate-conformance.test.js`
Expected: FAIL after Step 1. Only the new test fails.

- [ ] **Step 3: Probe the installed release before the `policy.yml` line (amendment 3a).**
  - Write a scratch node script with the Write tool, into the build session's scratchpad directory. The script does five things:
    1. Makes a fresh temp dir and runs `git init -q` in it.
    2. Writes `.claude-tweaks/policy.yml` holding `autonomy: trusted\ndeferral-digest-reasons: pre-existing-outside-diff, tangential\n`.
    3. Runs the installed release's resolver, `process.argv[2]`, with `spawnSync(process.execPath, [resolver, ...args], { cwd: dir, encoding: 'utf8' })` for `['--values', 'autonomy']` and for `['autonomy', 'deferral-digest-reasons']`.
    4. Prints each exit code, stdout and stderr.
    5. Removes the dir.
  - Run it as one command: `node "{script}" "${CLAUDE_PLUGIN_ROOT}/bin/resolve-policy.js"`. That is the release this repo's sessions load, 6.173.1 at plan time.
  - Expected: both calls exit 0. The first prints `trusted\n` with stderr `""`. The second prints `"autonomy":{"value":"trusted","source":"policy"}`, and the new key reads `{"error":"unknown-key"}`. This matches the plan-time run on 6.173.1.
  - If either call exits non-zero, or `autonomy` does not resolve to `trusted`:
    - Leave the `policy.yml` line out of Step 4.
    - Drop AC8.1 and Step 5's AC8 probes.
    - Leave out the bullet's sentence `In this repo, what a run notices outside its diff and ideas a run has go to the digest.`, because it would state a value no file sets, and drop the `outside its diff` and `ideas a run has go to the digest` needles from Step 1's test.
    - Name the release the line waits for in the PR body.
  - Either way, log the result as one `AUTO` entry: `node "${CLAUDE_PLUGIN_ROOT}/bin/log-decision.js" --run "$PIPELINE_RUN_DIR" --section "/build" --status AUTO --step "policy.yml probe" --text-file "{text-file}"`.

- [ ] **Step 4: Edit.**
  - Append `deferral-digest-reasons: pre-existing-outside-diff, tangential` to `.claude-tweaks/policy.yml`, only when Step 3 passed.
  - Replace `CLAUDE.md` line 62 with exactly this line (545 bytes with its newline, the same as the line it replaces; measured):

````text
- **No implicit deferrals.** When something needs doing, do it now. When `_shared/deferral-gate.md` says it cannot be, give it a `Defer-reason:` and `bin/deferral-route.js` decides between a backlog record via `/claude-tweaks:capture` (a spec-shaped body when an agent holds the context; a stub is for a human typing an idea) and the digest (`_shared/materiality-floor.md`). In this repo, what a run notices outside its diff and ideas a run has go to the digest. Never silently skip work or leave TODO comments without a record or digest entry.
````

- [ ] **Step 5: Run, probe AC8.1, record the evidence**

Run: `node tools/run-tests.js tests/deferral-gate-conformance.test.js tests/claude-md-budget.test.js tests/materiality-floor-conformance.test.js tests/deferral-route-cli.test.js tests/policy-deferral-digest-reasons.test.js`
Expected: PASS, every file. The CLI and conformance suites read a policy-free scratch dir, so this repository's new value does not change them.
Run: `sed -n 62p CLAUDE.md`, then `wc -c` on a scratch copy of that line.
Expected: `545`.
Run: `node plugin/bin/resolve-policy.js --values deferral-digest-reasons`
Expected: `pre-existing-outside-diff, tangential` (AC8.1), and nothing on stderr.
Run: `node plugin/bin/deferral-route.js --defer-reason tangential --agent-raised`
Expected: `{"verdict":"digest","rule":"policy-reason",…}`, exit 0.

Record the evidence:
- Write both probes' output to `$PIPELINE_RUN_DIR/evidence/5932-ac8-probe.txt`. Run `mkdir -p "$PIPELINE_RUN_DIR/evidence"` first, with the run dir's absolute path substituted, and write with a plain Bash redirect.
- Then log one entry: `node "${CLAUDE_PLUGIN_ROOT}/bin/log-decision.js" --run "$PIPELINE_RUN_DIR" --section "/build" --status AUTO --step "AC evidence" --text-file "{text-file}"`. Write the text file with the Write tool, holding one line: `AC8.1: In this repository, resolve-policy.js --values deferral-digest-reasons prints the two reasons — node plugin/bin/resolve-policy.js --values deferral-digest-reasons printed "pre-existing-outside-diff, tangential"; deferral-route.js tangential --agent-raised printed digest/policy-reason; log at evidence/5932-ac8-probe.txt`.

- [ ] **Step 6: The checklist's closing grep**

Run: `git grep -n -F "deferral-digest-reasons" -- plugin/skills plugin/bin CLAUDE.md .claude-tweaks/policy.yml docs/plugin-structure.md docs/journeys`
Expected: hits in `policy-schema.js`, `deferral-route.js`, `_shared/policy-schema.md`, `_shared/policy-schema-deferral-routing.md`, `_shared/materiality-floor.md`, `.claude-tweaks/policy.yml`, `docs/plugin-structure.md` and the journey. `CLAUDE.md` and `reflect/SKILL.md` describe the behaviour without naming the key. That is intended, since the key's home is `policy.yml` and the route command reads it. A `plugin/skills` file that should hit and does not is a red step.

- [ ] **Step 7: Commit, then file the follow-up record (controller; amendment 3b)**

```bash
git add .claude-tweaks/policy.yml CLAUDE.md tests/deferral-gate-conformance.test.js
git commit -m "Send this repo's outside-the-diff and idea deferrals to the digest — policy line and the CLAUDE.md bullet that states it (#5932)" -m "{the session's Claude-Session line}"
```

Then route and file one follow-up record, for the resolver reading a `policy.yml` symlink that resolves outside the checkout (spec Gotchas ASSUMPTION 2, reversed at build probe).

Run the gate first, as the new bullet requires: `node plugin/bin/deferral-route.js --defer-reason genuinely-larger --size medium --priority low --risk medium --agent-raised`. Expected: `file`/`not-low`. Any other verdict files nothing: report it in the PR body instead, quoting what the command printed.

`Defer-reason: genuinely-larger` (`_shared/deferral-gate.md`): the guard spans two unrelated readers outside this diff. One is the JS resolver (`policy-file.js`'s `locatePolicyFile`, `resolve-policy.js`'s `readFileSafe`, `policy-schema.js`'s `readLocatedPolicy`). The other is `hooks.sh`'s shell `policy_verdict`. That fails the fix-now "spans unrelated systems" criterion. It is not `pre-existing-outside-diff`: this repository's new list would digest that reason, and the finding is a guard decision across every policy reader, not a defect local to one file.

Invoke `/claude-tweaks:capture` with a spec-shaped body and `--defer-reason=genuinely-larger --source build`, referencing #5932. Title: "Refuse a policy.yml symlink that resolves outside the checkout".
- Current State: `resolve-policy.js`, `auditPolicy` and `hooks.sh`'s `policy_verdict` all read a `.claude-tweaks/policy.yml` symlink whose target lies outside the checkout. A dangling symlink reads as absent. This was confirmed by #5932's build probe, which reversed that spec's assumption. Cite the probe's fixtures and output.
- Deliverables: one shared rule for every policy reader. A `policy.yml` whose real path is outside the checkout (or the main checkout, for a linked worktree) is refused. It reads as absent, with one stderr warning naming the path. The shell copy in `hooks.sh` does the same. A test drives each reader against an outside-target symlink and a dangling symlink.
- Acceptance Criteria:
  1. An outside-target symlink resolves every key to its default and prints one warning.
  2. `policy_verdict` prints `off` for it.
  3. A dangling symlink still reads as absent, with no warning.
  4. An in-checkout symlink still reads normally.
- Key Files: `plugin/bin/lib/policy-file.js`, `plugin/bin/resolve-policy.js`, `plugin/bin/lib/policy-schema.js`, `plugin/bin/hooks.sh`, `tests/resolve-policy-lib.test.js`.

Record the filed number in the PR body.

## Behavior-change prose sweep (classified)

Grep of the old rule's phrases (`always clears the floor`, `non-\`tangential\``, `not \`tangential\``, `only ever comes from the`, `tangential`+`digest`) over `plugin/skills docs/journeys README.md`:
- `docs/journeys/route-a-deferred-finding-in-code-5930.md:32,33,36`: changed (Task 3).
- `docs/journeys/route-a-declined-reflection-insight.md:28` and `docs/journeys/route-a-review-finding-the-release-gate-can-see-4488.md:38`: no change. Both describe the default (an empty list), which is still every other project's behaviour.
- `plugin/skills/harness-health/filing.md:31` and `plugin/skills/journey-health/SKILL.md:153`: no change. "Clears the materiality floor" is the health sweeps' own floor prose, and they carry no gate `Defer-reason:`.
- `plugin/skills/reflect/SKILL.md:123,126,156`: changed (Task 5). `reflect/SKILL.md:154` (`record` Destinations): no change, outside Decision 1 (Fact-check).
- `plugin/skills/_shared/materiality-floor.md`'s Audit line ("routed below floor (…, rule={rule})"): no change. `rule=` names `policy-reason` for a policy digest, and the `AUDIT_RULE` pin stays green.

## Spec coverage

| Spec item | Task |
|---|---|
| Deliverable 1 (key, `defer-reason` element, checklist) | Task 1 (checklist walk in the Fact-check; grep in Task 6 Step 6) |
| Deliverable 2 (`routeDeferral` takes the list, rule `policy-reason`) and 3 (precedence) | Task 2 |
| Deliverable 4 (CLI resolves the key, `--run`, `auditPolicy`/`invalid: true` reporting, warning, resolver error passthrough) | Task 1 (`auditPolicy`, `resolvePolicyConfig`) and Task 3 (CLI) |
| Deliverable 5 (closed rule) | Task 1 (AC6.1 resolver), Task 2 (verdict set unchanged, inert unknown entries) |
| Deliverable 6 (Overrides: key, precedence, lifecycle) | Task 4 |
| Deliverable 7 (this repo's `policy.yml`) | Task 6 Steps 3 and 4 |
| Deliverable 8 (CLAUDE.md bullet) | Task 6 Step 4; its claim made true by Task 5 |
| Deliverable 9 (tests) | Tasks 1-6 |
| Plan-review Decision 1 (reflect's auto-mode tangential staging routed; no follow-up record) | Task 5 |
| Plan-review Decision 2 (AC6: `auditPolicy(root).invalidValues` plus `invalid: true`; return shape unchanged) | Task 1 (AC6.1) |
| Amendments 3a, 3b, 3c, 3d | Task 6 Step 3, Task 6 Step 7, Task 3 (`review focus 2`), Tasks 1 and 3 (`AC7.2`) |
| AC1.1 | Task 2 (the unmodified exhaustive test, the `AC1.1` test and the Proof line) |
| AC2.1, AC3.1, AC3.2, AC4.1, AC5.1 | Task 2 (function) and Task 3 (CLI) |
| AC6.1 | Task 1 (resolver, `auditPolicy`, `resolvePolicyConfig`) and Task 3 (CLI warning) |
| AC7.1 | Task 1 (resolver) and Task 3 (CLI `--run`); the empty-list override is `AC7.2` in both |
| AC8.1 | Task 6 Step 5 (probe and AC evidence entry); AC8.2/AC8.3 waived above, gated by Task 6 Step 3 |
| AC9.1 | Task 4 |
