# Deferral Digest Reasons Policy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A policy key `deferral-digest-reasons` names the `Defer-reason:` values that always send an agent-raised deferral to the digest; `routeDeferral` honours it behind the human and severity protections, `bin/deferral-route.js` resolves it from policy (and a run's config with `--run`), and this repository sets it to `pre-existing-outside-diff, tangential`.

**Architecture:** `plugin/bin/lib/policy-schema.js` gains the key and a `defer-reason` list-element pattern built from `DEFER_REASONS`. `routeDeferral` gains a `digestReasons` input and a `policy-reason` rule between `severity` and `tangential`. The CLI calls `resolve-policy.js`'s in-process `resolvePolicy` core for the one key, splits the resolved string, and warns on an invalid value. Prose (`_shared/materiality-floor.md`'s Overrides, `CLAUDE.md`'s bullet, the policy docs) follows the code.

**Tech Stack:** Node 18+ CommonJS, `node --test`, markdown skill prose. No dependencies.

**Spec:** `.claude-tweaks/pipelines/2026-11-19T070031-spec-5930-5931-5932-5933/spec-5932/work/5932-spec.md`

Scope keywords: deferral-digest-reasons, policy-reason

Consumer sweep at plan time. A Check B walk with the wider keywords `deferral-route` and `routeDeferral` hit these files outside the Files blocks. Each was read and is no-change. The two keywords above are the ones this change introduces; the wider sweep is recorded here instead of being re-run.
- `plugin/skills/review/step3-routing.md`, `plugin/skills/reflect/full-mode.md`, `plugin/skills/visual-review/browser-review.md`, `plugin/skills/wrap-up/residue-sweep.md`, `plugin/skills/wrap-up/leftover-routing.md`, `plugin/skills/wrap-up/review-console.md` and `plugin/skills/_shared/ledger-format.md` are #5931's routing sites. They run the command form with `--agent-raised` and act on `verdict`, which this change leaves intact. They pass no `--run`, so they read `policy.yml` alone. None of them names a `rule` value.
- `tests/control-mode-console-prose.test.js` pins those sites' prose, which does not change.
- `docs/superpowers/plans/2026-11-19-deferral-route-5930.md`, `docs/superpowers/plans/2026-11-19-deferral-route-sites-5931.md` and `docs/plans/2026-11-19-spec-5930-5931-5932-5933-ledger.md` are this run's history.
- `.impeccable/hook.cache.json` is a tool cache.

## Fact-check of the spec (corrected facts, checked at plan time on base d900d9968f)

- **Gotchas ASSUMPTION 1: confirmed** (probed at build time). The installed resolver ignores an unknown policy key and resolves the others, and `hooks.sh`'s `policy_verdict` reads only `worktree-always` lines. So the `.claude-tweaks/policy.yml` line lands in this PR and AC8 applies (Task 5). `Waived AC8.2`: the condition held. `Waived AC8.3`: the fallback branch is not taken.
- **Gotchas ASSUMPTION 2: reversed** (probed at build time). The existing resolver does **not** refuse a `policy.yml` symlink that resolves outside the checkout. It reads the file. A dangling symlink reads as absent (`readFileSafe` returns `null`). The route command adds no path logic of its own and inherits the resolver as it is. This plan adds no symlink guard and no test that asserts a refusal.
- `invalidValues` and `unrecognizedKeys` are fields of `auditPolicy`'s return value (`policy-schema.js` lines 1017 and 1041). They are not part of `resolvePolicyConfig`'s return. `resolvePolicyConfig` reports an invalid value as `{ value: <default>, source: 'default', invalid: true }` on the key's entry (`resolvePolicyKeys`, line 724), and passes the raw value to `onInvalid`. The test for AC6.1 asserts both: `auditPolicy(root).invalidValues` names the key, and the `resolvePolicyConfig` entry carries `invalid: true`.
- A configured `list` value resolves to the **raw comma-separated string**. `resolveValue` returns `rawValue` for a list. It does not return an array. The unset default is `[]`. The CLI splits the string on `,` and trims each entry. This is the same split `isValidValue` uses (line 506).
- No cycle: `record-payload.js` requires only `record-vocabulary` (which requires only `facet-shape`, which requires nothing) and `markdown-blocks` (which requires nothing). `plugin/bin/lib/hooks/pre-tool-use.js` already loads `record-payload.js` (probed through `require.cache`), so the import adds no module load to the hook path.
- "A read failure is the resolver's own error exit": `resolve-policy.js`'s `readFileSafe` swallows every read error, so an unreadable `policy.yml` reads as absent. The resolver's only error exit is an invocation failure, `{ code: 1, message }`, which happens for a `--run` dir that is missing, is not a directory, or sits in a checkout other than the main checkout (`anchoredOrOutsideMessage`). The CLI passes that through as a new **exit 1**: the message on stderr, nothing on stdout. #5930's constraint "exit codes only grow" allows a new code.
- **Not a Manifesto lever.** `_shared/policy-schema-read-path.md` line 21: a lever "walks `_shared/auto-mode-contract.md`'s 'Adding a new policy lever' checklist when it is Manifesto-visible". `set-config.js` accepts only the 13 Manifesto levers plus the run pins. This key is project policy that the route command reads. Walking the checklist gives: items 1-4 (this contract's computed-levers list, `flow/SKILL.md` Step 3, `flow/manifesto.md`/`manifesto-overrides.md`, `help/reference-card.md`/`help/context-flow.md`) do not apply, because no Manifesto surface computes or shows the key. Item 5, the enforcement files, is `bin/deferral-route.js`, `route.js` and `_shared/materiality-floor.md` (Tasks 2-4). The closing grep is Task 5 Step 5. A run config can still set the key, because the row is not `policyOnly`. AC7 exercises that through a fixture `config.yml`.
- `tests/bin-lib/deferral-route/route.test.js` pins `## Overrides` byte-equal (lines 147-163) and `RULES` exactly (line 66). AC1 protects only the exhaustive rule test (lines 35-58). The prose pin and the constants test are updated deliberately, in Tasks 4 and 2.
- **Callers of `deferral-route.js`'s `run`:** `tests/deferral-route-cli.test.js` (every test) and `tests/materiality-floor-conformance.test.js` line 305 (`routeCli(argv, { stdout, stderr })`). Both run with the repository as the cwd, so once Task 5 sets the repository's list they would read it. Task 3 makes both read a policy-free scratch dir. Callers of `routeDeferral`: `deferral-route.js` and `route.test.js` only (`git grep -n -F routeDeferral -- plugin tests tools`).
- **A routing path the CLAUDE.md bullet's claim depends on but no site runs the command at:** `plugin/skills/reflect/SKILL.md` Step 3's auto-mode table stages every tangential idea straight to a Queue-writes record proposal (line 123). Observation and convention files with a `record` Destination (line 153) also become records without the command. The floor's `tangential` override used to make that the right answer every time. With this policy it no longer is. Moving those paths, and the Review Console's Queue-writes creation step that consumes them, is a new routing site with its own design (who writes the digest entry, and whether the console or the producer runs the command). This plan does not fold it in. Task 5 Step 6 files it as a follow-up record. Until that record ships, the bullet's "ideas a run has go to the digest" holds at the command's sites (`_shared/materiality-floor.md`'s Applying the floor), and not at reflect's auto-mode staging.

## Global Constraints

- Key name `deferral-digest-reasons` (final). `type: 'list'`, `element: 'defer-reason'`, `default: []`. Precedence: run config, then `policy.yml`, then the default. One flat comma-separated line. One bad element makes the whole value invalid.
- Precedence in `routeDeferral`, in exactly this order: `refused`, `human`, `severity`, `policy-reason`, `tangential`, `not-low`, `floor`. `policy-reason` gives `digest` whatever the three axes are, for an agent-raised item only. The verdict set stays `file`, `digest`, `refused`.
- With the key unset, every verdict and rule is what it is today. `routeDeferral` treats an absent or non-array `digestReasons` as `[]`.
- The digest list is read from policy, never from a flag. The CLI adds no policy-file path logic of its own: it calls `resolvePolicy` from `plugin/bin/resolve-policy.js` (which locates the file through `plugin/bin/lib/policy-file.js`).
- `defer-reason` element pattern: built from the imported `DEFER_REASONS` (`require('./issues/record-payload')`), never retyped.
- Exit codes: 0 a verdict or `--help`; 1 the resolver refused `--run` (stderr only, no verdict); 2 refused. Output keys and the `rule` vocabulary only grow.
- Commit messages: `{Verb} {what} — {detail} (#5932)`, then the session's `Claude-Session:` attribution line as a second `-m`. Stage files by path only. Never `git add -A`, never `git stash`, never `git reset`.
- Tests: one file with `node --test <file>`. Several files with `node tools/run-tests.js <files…>` (the repo's guard refuses a multi-file `node --test`). Never the full suite.
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
- Sizes (`wc -c`, rail `RAIL_BYTES` = 52,500, `plugin/bin/lib/skill-audit/budgets.js`):

  | File | Start | End (planned text) | Headroom |
  |---|---|---|---|
  | `plugin/skills/_shared/policy-schema.md` | 51129 | 51297 (+168, stub measured) | 1203 (97.7% of rail) |
  | `plugin/skills/_shared/materiality-floor.md` | 15373 | 15775 (Overrides 781 → 1183) | 36725 |
  | `plugin/skills/_shared/policy-schema-deferral-routing.md` | new | ~1.4 KB | — |
  | `CLAUDE.md` (bullet, line 62) | 545 | 545 (measured) | file total unchanged |

  `policy-schema.md` is within 10% of the rail. The remedy this plan applies is the one the spec names: a key-only stub in the index and the full row in a new sub-file. The next key that does not fit moves a section out (`policy-key-addition` site 4). This plan moves none, because the stub fits.

## Review Focus

1. A blank `--run` (`--run ""`, or the unset `$PIPELINE_RUN_DIR` a shell expands to) → `refused`, `--run needs a value`, exit 2. It never reads the cwd's `config.yml`. Pinned by Task 3's `review focus 1` test.
2. A `--run` dir that does not exist → exit 1, nothing on stdout, stderr starting `deferral-route: --run dir does not exist or is not a directory:`. Never a verdict over a silently dropped overlay. Pinned by Task 3's `review focus 2` test.
3. A run config holding an invalid value while `policy.yml` holds a valid list → `[]` with `invalid: true`, never a cascade to `policy.yml`'s list. Pinned by Task 1's resolver test and Task 3's CLI test.
4. A near-miss element (`Tangential`, `tangential,` with its trailing comma's empty entry) → the whole value is invalid, the default applies, and the warning names `"Tangential"` / `""`. Pinned by Task 1 (resolver) and Task 3 (warning text).
5. `digestReasons` passed in-process as a string (`'pre-existing-outside-diff, tangential'`) → never digests by substring match. Routes as if unset. Pinned by Task 2's guard test.

---

### Task 1: The `deferral-digest-reasons` key and the `defer-reason` list element

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/policy-schema.js` (requires, lines 8-11; `LIST_ELEMENT_PATTERNS` lines 21-26; a new last `POLICY_KEYS` row after `verify-suite-slots`, line 305)
- Modify: `plugin/skills/_shared/policy-schema.md` (a new `## Deferral routing` stub between `## Efficiency budgets` and `## Control mode`, before line 198)
- Create: `plugin/skills/_shared/policy-schema-deferral-routing.md`
- Modify: `.claude/skills/policy-key-addition/SKILL.md:35` (the `list` bullet's element kinds)
- Modify: `tests/policy-schema.test.js:46-47` (count 112 → 113)
- Test: `tests/policy-deferral-digest-reasons.test.js` (new; precedent `tests/policy-verify-suite-slots.test.js`)

**Interfaces:**
- Produces: `LIST_ELEMENT_PATTERNS['defer-reason']`: a RegExp matching exactly one `DEFER_REASONS` value. The `POLICY_KEYS` row `{ key: 'deferral-digest-reasons', type: 'list', default: [], element: 'defer-reason', summary, category: 'pipeline-behavior', tier: 'advanced' }`, with no `policyOnly` and no `policySourceExcluded`.

- [ ] **Step 1: Write the failing tests** in `tests/policy-deferral-digest-reasons.test.js` (const `KEY = 'deferral-digest-reasons'`; pure calls to `resolvePolicyKeys([KEY], { policyRaw, runConfigRaw, onInvalid })` unless noted):
  - `defer-reason element accepts exactly the DEFER_REASONS values`: every `DEFER_REASONS` entry matches. `'not-a-reason'`, `'Tangential'`, `''`, `' tangential'`, `'xtangential'`, `'tangentialx'` and `'tangential|genuinely-larger'` do not.
  - `defer-reason element is built from DEFER_REASONS`: `LIST_ELEMENT_PATTERNS['defer-reason'].source === `^(?:${DEFER_REASONS.join('|')})$``.
  - `the row: list, element defer-reason, default [], advanced, set by policy or run config`: `type`, `element`, `default` deepEqual `[]`, `tier`, `category: 'pipeline-behavior'`, `policyOnly` and `policySourceExcluded` both falsy.
  - `unset resolves the empty default`: `policyRaw: 'autonomy: trusted\n'` → `{ value: [], source: 'default' }`.
  - `a valid list resolves to the raw comma-separated string`: `policyRaw: 'deferral-digest-reasons: pre-existing-outside-diff, tangential\n'` → `{ value: 'pre-existing-outside-diff, tangential', source: 'policy' }`.
  - `AC6.1 an element outside the vocabulary, alone or beside valid reasons, resolves [] and is reported`: for each raw in `['not-a-reason', 'pre-existing-outside-diff, not-a-reason', 'Tangential', 'tangential,']`: the entry deepEquals `{ value: [], source: 'default', invalid: true }` and `onInvalid` received `[KEY, raw]`. Then for `not-a-reason` and `pre-existing-outside-diff, not-a-reason` in a `scratchDir()` project (`.claude-tweaks/policy.yml` written, removed in `after`): `auditPolicy(dir).invalidValues` holds exactly one row with `key === KEY` and `value === raw`, and `resolvePolicyConfig({ git: () => { throw new Error('no git'); }, readFile: (p) => (fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null), keys: [KEY], cwd: dir }).result[KEY].invalid === true`.
  - `AC7.1 a run config overrides policy.yml (the key is not policyOnly)`: `policyRaw` `…: tangential`, `runConfigRaw` `…: genuinely-larger` → `{ value: 'genuinely-larger', source: 'run-config' }`.
  - `review focus 3: an invalid run-config value never cascades to policy.yml's list`: `runConfigRaw` `…: not-a-reason`, `policyRaw` `…: tangential` → `{ value: [], source: 'default', invalid: true }`.

  Guard discrimination: deleting `element: 'defer-reason'` from the row turns the AC6.1 test red, because a list with no element accepts anything. Deleting the `defer-reason` pattern makes `isValidValue` throw on `undefined.test`.

- [ ] **Step 2: Run and see it fail**

Run: `node --test tests/policy-deferral-digest-reasons.test.js`
Expected: FAIL. At plan time the file does not exist. After Step 1: `LIST_ELEMENT_PATTERNS['defer-reason']` is undefined and `POLICY_KEYS` has no row for the key.

- [ ] **Step 3: Implement in `plugin/bin/lib/policy-schema.js`**:
  - Add `const { DEFER_REASONS } = require('./issues/record-payload');` beside the other requires.
  - Add the `LIST_ELEMENT_PATTERNS` entry `'defer-reason': new RegExp(`^(?:${DEFER_REASONS.join('|')})$`)`, with a one-line comment: a `Defer-reason:` value (#5932), built from `DEFER_REASONS` so the two never drift. Update the comment above the object to name the three kinds.
  - Append the row after `verify-suite-slots`, with this comment above it: `// #5932: read by bin/deferral-route.js (routeDeferral's policy-reason rule) through resolve-policy.js's resolvePolicy, so a run's config.yml overlays it via --run: neither policyOnly nor policySourceExcluded. Each element must be a DEFER_REASONS value. Not a Manifesto lever.` Summary (≤ 140 chars, without the key itself): `"Defer-reasons that send an agent-raised deferral to the digest instead of a record; human input and high severity still file."` No `Not yet used` marker: the consumer lands in Task 3 of this PR.
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

  - Create `plugin/skills/_shared/policy-schema-deferral-routing.md`. Follow `policy-schema-efficiency-budgets.md`'s shape: a first-line HTML comment naming it the sibling of `_shared/policy-schema.md`'s "## Deferral routing" section, split out so the index keeps headroom under the rail. Then `## Deferral routing`, one intro sentence (registered by #5932; read by `bin/deferral-route.js` through `bin/resolve-policy.js`'s resolver, from `policy.yml`, overlaid by a run's `config.yml` when the call passes `--run {dir}`; not `policyOnly`; not a Manifesto lever; `_shared/materiality-floor.md`'s Overrides section gives its place in the precedence), and the five-column table (`Key | Canonical home | Owner skill(s) | Default | Meaning`) with one row: `` `deferral-digest-reasons` `` | `policy.yml` (or a run's `config.yml` via `--run`) | `bin/deferral-route.js` | `[]` | `Defer-reason:` values (`_shared/deferral-gate.md`'s vocabulary) that send an agent-raised deferral to the digest whatever its size, priority and risk; human input and a `high`/`critical` severity still file. Unset resolves `[]`. `pre-existing-outside-diff, tangential` resolves to that raw comma-separated string. An element outside the vocabulary (`not-a-reason`, `Tangential`, a trailing comma's empty entry) makes the whole value invalid: it resolves to `[]` with `invalid: true`, and `bin/deferral-route.js` prints one stderr warning naming the key and the bad element, then routes as if unset.
  - `.claude/skills/policy-key-addition/SKILL.md` line 35: replace `` (`login` or `slug` in `LIST_ELEMENT_PATTERNS`) `` with `` (`login`, `slug` or `defer-reason` in `LIST_ELEMENT_PATTERNS`; `defer-reason` is built from `DEFER_REASONS`) ``.

- [ ] **Step 5: Run and see it pass**

Run: `node tools/run-tests.js tests/policy-deferral-digest-reasons.test.js tests/policy-schema.test.js tests/policy-key-naming.test.js tests/policy-schema-metadata.test.js tests/resolve-policy-control-mode.test.js tests/resolve-policy-lib.test.js tests/bin-lib/issues/risk-flag-classify.test.js tests/skill-size-single-source.test.js`
Expected: PASS, every file. `wc -c plugin/skills/_shared/policy-schema.md` prints 51297.

- [ ] **Step 6: Commit**

```bash
git add plugin/bin/lib/policy-schema.js plugin/skills/_shared/policy-schema.md plugin/skills/_shared/policy-schema-deferral-routing.md .claude/skills/policy-key-addition/SKILL.md tests/policy-schema.test.js tests/policy-deferral-digest-reasons.test.js
git commit -m "Add the deferral-digest-reasons policy key — a list of Defer-reason values validated against DEFER_REASONS (#5932)" -m "{the session's Claude-Session line}"
```

### Task 2: The `policy-reason` rule in `routeDeferral`

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/deferral-route/route.js` (header comment lines 7-19, `RULES` line 25, `routeDeferral` lines 31-49)
- Test: `tests/bin-lib/deferral-route/route.test.js` (the `constants` test, line 66; new tests after `not-low`, line 133). The `AC7.1 exhaustive` block (lines 35-58) is **not edited**.

**Interfaces:**
- Consumes: nothing from Task 1. The function takes the list already split.
- Produces: `routeDeferral({ deferReason, severity, size, priority, risk, agentRaised, digestReasons }) -> { verdict, rule, reason? }`. `digestReasons` is optional and treated as `[]` unless `Array.isArray`. `RULES` is frozen `['refused','human','severity','policy-reason','tangential','not-low','floor']`.

- [ ] **Step 1: Write the failing tests** in `route.test.js`:
  - Change the `constants` test's `RULES` expectation to the seven-rule list above.
  - `AC1.1 an explicit empty digestReasons routes exactly as #5930`: the same 5376-case loop as the exhaustive test, passing `digestReasons: []` and comparing with the unchanged `oracle(c)`. Assert the count is 5376.
  - `exhaustive with a digest list: every combination matches the policy oracle`: for each list in `[[], ['pre-existing-outside-diff', 'tangential'], [...DEFER_REASONS], ['genuinely-larger']]` × the same 5376 combinations (21504 cases, assert the count). Compare with:

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
  - `AC4.1 a listed reason at severity high files by severity` (also `critical`) → `file`/`severity`.
  - `AC5.1 an unlisted genuinely-larger at not-low axes files by not-low` → `file`/`not-low`.
  - `review focus 5: a string digestReasons never digests by substring`: `digestReasons: 'pre-existing-outside-diff, tangential'` with `pre-existing-outside-diff` at all-low axes → `digest`/`floor`, and with `tangential` → `file`/`tangential`. The `tangential` case is red if the `Array.isArray` guard is deleted.
  - `a non-DEFER_REASONS entry in digestReasons is inert`: `digestReasons: ['not-a-reason']` with `genuinely-larger` at all-low axes → `digest`/`floor`, and at `size: 'high'` → `file`/`not-low`.

- [ ] **Step 2: Run and see it fail**

Run: `git grep -n -F "policy-reason" -- plugin/bin/lib/deferral-route/route.js`
Expected: FAIL. Exit 1, no match (probed at plan time: exit 1).
Run: `node --test tests/bin-lib/deferral-route/route.test.js`
Expected: FAIL after Step 1. The `constants` test, the policy-oracle exhaustive test, AC2.1 and AC3.1 fail. `AC7.1 exhaustive`, `AC1.1`, AC3.2, AC4.1, AC5.1, the two guard tests and the prose pins pass: the rules those tests check already hold before the clause exists.

- [ ] **Step 3: Implement** in `route.js`. Add `digestReasons` to the destructured input. After the `severity` clause, add `if (Array.isArray(digestReasons) && digestReasons.includes(deferReason)) return { verdict: 'digest', rule: 'policy-reason' };`. Insert `'policy-reason'` into `RULES` after `'severity'`. In the header comment, add the input and a line `policy-reason — deferReason in digestReasons (policy key deferral-digest-reasons) -> digest`, and note that `materiality-floor.md`'s Overrides section explains it. The function stays pure.

- [ ] **Step 4: Run, and prove the public contract unchanged**

Run: `node --test tests/bin-lib/deferral-route/route.test.js`
Expected: PASS, every test. Then delete the `Array.isArray(digestReasons) &&` guard in a scratch copy and re-run: `review focus 5`'s `tangential` case goes red. Restore the guard.
Run: `git diff d900d9968f -- tests/bin-lib/deferral-route/route.test.js`
Expected: no hunk touches lines 35-58 (the `AC7.1 exhaustive` block). The only hunks are the `RULES` expectation and the added tests.

Proof(public-contract): with `deferral-digest-reasons` unset (no `digestReasons` passed), #5930's `AC7.1 exhaustive` test passes byte-unmodified over all 5376 combinations. `AC1.1` proves the same for an explicit `[]`. Every pre-existing verdict and rule is therefore unchanged. The one rule added (`policy-reason`) fires only for a listed reason.

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/deferral-route/route.js tests/bin-lib/deferral-route/route.test.js
git commit -m "Add the policy-reason rule to routeDeferral — a listed reason digests an agent-raised item behind the human and severity protections (#5932)" -m "{the session's Claude-Session line}"
```

### Task 3: The CLI resolves the key, accepts `--run`, and warns on an invalid value

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/deferral-route.js` (header lines 1-15, `USAGE`/`ACCEPTED` lines 20-22, `parseArgs` lines 28-65, `realDeps` lines 67-70, `run` lines 72-82)
- Test: `tests/deferral-route-cli.test.js` (the `call` helper, lines 20-26; exact-text rows at lines 141 and 153; `AC8.2`, line 211; `AC8.3`'s `deps`, line 234; new tests)
- Modify: `tests/materiality-floor-conformance.test.js:305` (`routeVerdict`'s `routeCli` deps: policy-free cwd)
- Modify: `docs/plugin-structure.md:390` (the `deferral-route.js` command entry)
- Modify: `docs/journeys/route-a-deferred-finding-in-code-5930.md` (front-matter `files:`, step 1 lines 32-36, step 2 lines 45-46)
- Read, no change: `plugin/bin/resolve-policy.js` (consumed as-is: `resolvePolicy`, `callerDeps`, `EXIT_OK`) and `plugin/bin/lib/policy-file.js` (reached only through `resolvePolicy`).

**Interfaces:**
- Consumes: `LIST_ELEMENT_PATTERNS['defer-reason']` (Task 1). `routeDeferral({…, digestReasons})` (Task 2). `resolvePolicy({ keys, runDir }, deps) -> { code: 0, result, invalidRaw } | { code: 1, message }` and `callerDeps({ cwd, env })` from `plugin/bin/resolve-policy.js`.
- Produces: `realDeps = { stdout, stderr, cwd: () => process.cwd(), env: process.env }`. `parseArgs(argv) -> { help, reason, input, runDir }` (`runDir` is `null` when absent; it is not echoed in `input`). `ACCEPTED = '--defer-reason, --severity, --size, --priority, --risk, --agent-raised, --human, --run, --help'`. New `USAGE`: `usage: deferral-route.js --defer-reason <reason> (--agent-raised | --human) [--severity <critical|high|medium|low|info>] [--size <v>] [--priority <v>] [--risk <v>] [--run <dir>] [--help]\nexit codes: 0 a verdict (file or digest) or --help; 1 the policy resolver refused --run (stderr only, no verdict); 2 refused.\n`.

`run` order: parse, then `--help`, then a parse refusal (exit 2, with no policy read and no `deps.cwd()` read). Then `resolvePolicy({ keys: ['deferral-digest-reasons'], runDir }, callerDeps({ cwd: deps.cwd(), env: deps.env }))`. On `code !== EXIT_OK`: `deps.stderr(`deferral-route: ${message}\n`)` and return 1, with nothing on stdout. On `entry.invalid`: one stderr line, `deferral-route: warning: deferral-digest-reasons has invalid element "{bad}" — using the default (no reasons)\n`. `{bad}` is the first trimmed comma-separated entry of `invalidRaw.get(key)` that the `defer-reason` pattern rejects. Then route with `digestReasons` `[]`. Otherwise `digestReasons` is the resolved value split on `,` and trimmed (`[]` when the value is the array default). Then `routeDeferral` and the same print and exit as today. `--run` parsing: a missing next token, one starting with `--`, or a blank or whitespace-only value is refused with `--run needs a value`. A second `--run` is refused with `--run given more than once`.

- [ ] **Step 1: Write the failing tests** in `tests/deferral-route-cli.test.js`:
  - At the top: `const NO_POLICY = scratchDir('ct-deferral-route-nopolicy-')`, removed in `after` (`removeScratchDir`). `call(...argv)` passes `{ cwd: NO_POLICY }` to `runCliSync`, so every existing verdict assertion runs against no policy. Add `project({ policy, runConfig })`: a `scratchDir` with `.claude-tweaks/policy.yml` and/or `run/config.yml`, registered for cleanup, returning `{ dir, runDir }`. Add `callIn(dir, ...argv)`, the same as `call` with that cwd. Add `const LISTED = 'deferral-digest-reasons: pre-existing-outside-diff, tangential\n'`.
  - Retarget the exact texts: lines 141 and 153 gain `--run, ` before `--help` in the accepted list. `AC8.2` expects `['cwd', 'env', 'stderr', 'stdout']`. `AC8.3`'s `deps` becomes `{ stdout, stderr: () => {}, cwd: () => NO_POLICY, env: {} }`, and its expected `codes` and `calls` are unchanged.
  - `AC2.1 CLI: listed pre-existing-outside-diff at --size high --risk medium digests by policy-reason`: `callIn(project({ policy: LISTED }).dir, '--defer-reason', 'pre-existing-outside-diff', '--size', 'high', '--risk', 'medium', '--agent-raised')` → exit 0, `digest`/`policy-reason`, stderr `''`.
  - `AC3.1 CLI: listed tangential digests` → `digest`/`policy-reason`. `AC3.2 CLI: the same with --human files` → `file`/`human`.
  - `AC4.1 CLI: listed reason with --severity high files` → `file`/`severity`.
  - `AC5.1 CLI: genuinely-larger at --size high --priority medium --risk high files` → `file`/`not-low`.
  - `AC6.1 CLI: an invalid list warns once and still prints a verdict`: for each policy in `['deferral-digest-reasons: not-a-reason\n', 'deferral-digest-reasons: pre-existing-outside-diff, not-a-reason\n']`, call `pre-existing-outside-diff --size high --agent-raised` → exit 0, `file`/`not-low` (the empty default), and stderr exactly `deferral-route: warning: deferral-digest-reasons has invalid element "not-a-reason" — using the default (no reasons)\n`.
  - `review focus 4: a near-miss element is named in the warning`: the policy `…: Tangential` gives a warning naming `"Tangential"`, and the policy `…: tangential,` gives one naming `""`. Both give `tangential` → `file`/`tangential`.
  - `AC7.1 CLI: a run config overrides the repository's list for a call with --run`: policy `…: tangential`, run config `…: genuinely-larger`. `genuinely-larger --size high --agent-raised --run {runDir}` → `digest`/`policy-reason`. The same call without `--run` → `file`/`not-low`. `tangential --agent-raised --run {runDir}` → `file`/`tangential` (replaced, not merged).
  - `review focus 3 CLI: an invalid run-config value never falls back to policy.yml's list`: policy `LISTED`, run config `…: not-a-reason`. `tangential --agent-raised --run {runDir}` → `file`/`tangential`, plus one warning line.
  - `review focus 1: a blank --run is refused`: `--run ''` and `--run '   '` → exit 2, `refused`, reason `--run needs a value`. `--run` as the last token gives the same. `--run a --run b` → `--run given more than once`.
  - `review focus 2: a missing --run dir is the resolver's exit 1, no verdict`: `--run {dir}/missing` → code 1, stdout `''`, and stderr starts with `deferral-route: --run dir does not exist or is not a directory:`. Call `runCliSync` directly, because `call` expects a stdout line.
  - In `tests/materiality-floor-conformance.test.js`, give `routeVerdict`'s `routeCli` call the deps `{ stdout, stderr, cwd: () => NO_POLICY_DIR, env: {} }` (a `scratchDir` created once at the top of the file and removed in `after`). Its expected verdicts stay as they are.

- [ ] **Step 2: Run and see it fail**

Run: `git grep -n -F "deferral-digest-reasons" -- plugin/bin/deferral-route.js`
Expected: FAIL. Exit 1, no match (probed at plan time: exit 1).
Run: `node --test tests/deferral-route-cli.test.js`
Expected: FAIL after Step 1. The AC2.1, AC3.1, AC6.1, AC7.1, review-focus 1-4, accepted-list and `AC8.2` tests fail. The other pre-existing tests pass.

- [ ] **Step 3: Implement `plugin/bin/deferral-route.js`** per the Interfaces block. The header comment gains the policy read (key, resolver, `--run` overlay), the warning line, and exit 1. It replaces "There is no exit 1". Keep "Writes nothing and makes no gh call." Import `{ resolvePolicy, callerDeps, EXIT_OK }` from `./resolve-policy` and `{ LIST_ELEMENT_PATTERNS }` from `./lib/policy-schema`. The last statement stays `if (require.main === module) process.exitCode = run(process.argv.slice(2), realDeps);`.

- [ ] **Step 4: Docs.** Replace `docs/plugin-structure.md` line 390 with one line:
  `node plugin/bin/deferral-route.js --defer-reason <reason> (--agent-raised | --human) [--severity <s>] [--size <v>] [--priority <v>] [--risk <v>] [--run <dir>]   # Deferral route CLI (#5930, #5932) — decides in code whether a legitimately-deferred item files as a record or appends to the digest, reproducing _shared/materiality-floor.md's floor and overrides (plugin/bin/lib/deferral-route/route.js's routeDeferral, pure); reads policy key deferral-digest-reasons through resolve-policy.js's resolvePolicy (policy.yml, overlaid by {dir}/config.yml with --run) and digests an agent-raised item whose reason it lists (rule policy-reason); an invalid value prints one stderr warning and routes as if unset; prints one JSON line {verdict: file|digest|refused, rule: refused|human|severity|policy-reason|tangential|not-low|floor, reason (refused only), input}; writes nothing, no gh call; exit 0 file or digest, 1 the resolver refused --run (its message on stderr, nothing on stdout), 2 refused (an unknown reason, both or neither origin flag, a bad --severity, a flag without its value, a repeated or unknown flag) with the JSON still on stdout (tests in tests/bin-lib/deferral-route/route.test.js and tests/deferral-route-cli.test.js)`
  In the journey: add `plugin/bin/lib/policy-schema.js` to `files:`. Rewrite line 32 to say `digest` comes from rule `floor` (every floor condition held) or rule `policy-reason` (the reason is listed in policy key `deferral-digest-reasons`, whatever the axes). Line 33's order becomes `refused`, `human`, `severity`, `policy-reason`, `tangential`, `not-low`, `floor`. Line 36's red flags become: a `floor` digest with any axis other than `low`; a `digest` for `--human` or a `high`/`critical` severity; a `tangential` digest whose rule is not `policy-reason`; the command creating a file or a record. Step 2 gains two bullets: exit 1 with nothing on stdout means the resolver refused `--run`, with its message on stderr; and an invalid `deferral-digest-reasons` value prints one stderr warning naming the bad element and routes as if the key were unset.

- [ ] **Step 5: Run and see it pass**

Run: `node tools/run-tests.js tests/deferral-route-cli.test.js tests/bin-lib/deferral-route/route.test.js tests/materiality-floor-conformance.test.js tests/bin-lib/cli-entry-conformance.test.js tests/bin-lib/exit-code-conformance.test.js tests/path-guard-conformance.test.js tests/windows-hide-spawn-conformance.test.js tests/claude-plugin-root-require-conformance.test.js tests/helpers-run-cli.test.js`
Expected: PASS, every file.

- [ ] **Step 6: Commit**

```bash
git add plugin/bin/deferral-route.js tests/deferral-route-cli.test.js tests/materiality-floor-conformance.test.js docs/plugin-structure.md docs/journeys/route-a-deferred-finding-in-code-5930.md
git commit -m "Resolve deferral-digest-reasons in the deferral-route CLI — --run overlays a run's config, an invalid value warns and routes as unset (#5932)" -m "{the session's Claude-Session line}"
```

### Task 4: The Overrides section states the precedence and the digest lifecycle it relies on

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/skills/_shared/materiality-floor.md:21-31` (the `## Overrides` section, replaced whole)
- Test: `tests/bin-lib/deferral-route/route.test.js` (`OVERRIDES_SECTION`, lines 147-158; header comment lines 6-9; the go-red `tangentialLine`, line 175)
- Test: `tests/materiality-floor-conformance.test.js` (line 74 retargeted; a new block after line 75)
- Read, no change: `plugin/skills/tidy/digest-sweep.md`, for the lifecycle facts (line 81: three entries sharing an area; line 103: 90 days).

Pin inventory (`git grep -n -F` over `tests plugin docs .claude/skills` for each Overrides phrase): `always clears the floor` and `ideas are intent` appear only in `materiality-floor.md` and `route.test.js`. `A finding carrying severity \`high\` or \`critical\` always clears the floor` at `tests/materiality-floor-conformance.test.js:74` is retargeted to `A finding carrying severity \`high\` or \`critical\` files as an ordinary issue`. `/tangential/` and `/capture` at lines 69-70 are kept. The health-sweep files' "always clears the materiality floor" (`harness-health/filing.md:31`) is a different sentence in a different file: no change. The `## Applying the floor` section and its `FLOOR_NEEDLES` are not touched.

- [ ] **Step 1: Write the failing tests.**
  - In `route.test.js`, set `OVERRIDES_SECTION` to Step 3's replacement block, byte for byte, with backticks escaped (copied out of this plan's text, never retyped). Change the header comment's "base commit 05a65b7353" to name the Overrides text as rewritten by #5932. Set the go-red `tangentialLine` to `` '4. `Defer-reason: tangential` files as an ordinary issue — a tangential finding is a new idea the\n' ``.
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

  (`flexible` is the helper the file already defines at line 221. The new block sits after it, beside the other `#5932`/`#5931` blocks: place it after line 363.)

- [ ] **Step 2: Run and see it fail**

Run: `git grep -n -F "deferral-digest-reasons" -- plugin/skills/_shared/materiality-floor.md`
Expected: FAIL. Exit 1, no match (probed at plan time: exit 1).
Run: `node tools/run-tests.js tests/materiality-floor-conformance.test.js tests/bin-lib/deferral-route/route.test.js`
Expected: FAIL after Step 1. `AC9.1` reports every needle missing plus `Overrides still says "always clears the floor"`. The retargeted line-74 test fails. Each move-out control fails on its missing anchor. Both prose pins in `route.test.js` fail.

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

(The "ideas are intent" clause is gone. "Intent, never exhaust" now names human input only, in item 1.)

- [ ] **Step 4: Run and see it pass**

Run: `node tools/run-tests.js tests/materiality-floor-conformance.test.js tests/bin-lib/deferral-route/route.test.js tests/deferral-gate-conformance.test.js`
Expected: PASS, every file. `wc -c plugin/skills/_shared/materiality-floor.md` prints 15775.

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/_shared/materiality-floor.md tests/bin-lib/deferral-route/route.test.js tests/materiality-floor-conformance.test.js
git commit -m "State the deferral precedence in the materiality floor's Overrides — human, severity, policy reason, tangential, and the digest lifecycle the policy relies on (#5932)" -m "{the session's Claude-Session line}"
```

### Task 5: This repository adopts the policy, and CLAUDE.md says so

**Role:** integration

**Files:**
- Modify: `.claude-tweaks/policy.yml` (one line appended after `superpowers-plans-retention: prune-after-wrapup`)
- Modify: `CLAUDE.md:62` (the "No implicit deferrals" bullet, replaced in place)
- Test: `tests/deferral-gate-conformance.test.js` (one test after line 536)
- Waived `plugin/skills/init/claude-md-template.md`: it writes other projects' CLAUDE.md and keeps today's rule on purpose (spec Gotchas). The existing both-copies test at `tests/deferral-gate-conformance.test.js:529` still reads it.

- [ ] **Step 1: Write the failing test** in `tests/deferral-gate-conformance.test.js`: `#5932 CLAUDE.md's no-implicit-deferrals bullet names the route command and this repo's digest reasons`. Find the CLAUDE.md line holding `**No implicit deferrals.**` and assert it includes `bin/deferral-route.js`, `outside its diff` and `ideas a run has go to the digest`. A go-red control strips each literal from that line, re-runs the same assertion function, and expects a throw.

- [ ] **Step 2: Run and see it fail**

Run: `git grep -n -F "deferral-digest-reasons" -- .claude-tweaks/policy.yml`
Expected: FAIL. Exit 1, no match (probed at plan time: exit 1).
Run: `node --test tests/deferral-gate-conformance.test.js`
Expected: FAIL after Step 1. Only the new test fails.

- [ ] **Step 3: Edit.** Append `deferral-digest-reasons: pre-existing-outside-diff, tangential` to `.claude-tweaks/policy.yml`. Replace `CLAUDE.md` line 62 with exactly this line (545 bytes with its newline, the same as the line it replaces; measured):

````text
- **No implicit deferrals.** When something needs doing, do it now. When `_shared/deferral-gate.md` says it cannot be, give it a `Defer-reason:` and `bin/deferral-route.js` decides between a backlog record via `/claude-tweaks:capture` (a spec-shaped body when an agent holds the context; a stub is for a human typing an idea) and the digest (`_shared/materiality-floor.md`). In this repo, what a run notices outside its diff and ideas a run has go to the digest. Never silently skip work or leave TODO comments without a record or digest entry.
````

- [ ] **Step 4: Run, probe AC8.1, record the evidence**

Run: `node tools/run-tests.js tests/deferral-gate-conformance.test.js tests/claude-md-budget.test.js tests/materiality-floor-conformance.test.js tests/deferral-route-cli.test.js tests/policy-deferral-digest-reasons.test.js`
Expected: PASS, every file. (The CLI and conformance suites read a policy-free scratch dir, so this repository's new value does not change them.)
Run: `sed -n 62p CLAUDE.md | wc -c`
Expected: `545`.
Run: `node plugin/bin/resolve-policy.js --values deferral-digest-reasons`
Expected: `pre-existing-outside-diff, tangential` (AC8.1), and nothing on stderr.
Run: `node plugin/bin/deferral-route.js --defer-reason tangential --agent-raised`
Expected: `{"verdict":"digest","rule":"policy-reason",…}`, exit 0.
Write both probes' output to `$PIPELINE_RUN_DIR/evidence/5932-ac8-probe.txt` (run `mkdir -p "$PIPELINE_RUN_DIR/evidence"` first, with the run dir's absolute path substituted, and write with a plain Bash redirect). Then log one entry: `node "${CLAUDE_PLUGIN_ROOT}/bin/log-decision.js" --run "$PIPELINE_RUN_DIR" --section "/build" --status AUTO --step "AC evidence" --text-file "{text-file}"`, with the text file (written by the Write tool) holding one line: `AC8.1: In this repository, resolve-policy.js --values deferral-digest-reasons prints the two reasons — node plugin/bin/resolve-policy.js --values deferral-digest-reasons printed "pre-existing-outside-diff, tangential"; deferral-route.js tangential --agent-raised printed digest/policy-reason; log at evidence/5932-ac8-probe.txt`.

- [ ] **Step 5: The checklist's closing grep**

Run: `git grep -n -F "deferral-digest-reasons" -- plugin/skills plugin/bin CLAUDE.md .claude-tweaks/policy.yml docs/plugin-structure.md docs/journeys`
Expected: hits in `policy-schema.js`, `deferral-route.js`, `_shared/policy-schema.md`, `_shared/policy-schema-deferral-routing.md`, `_shared/materiality-floor.md`, `.claude-tweaks/policy.yml`, `docs/plugin-structure.md` and the journey. `CLAUDE.md` describes the behaviour without naming the key: that is intended, since the key's home is `policy.yml`. A `plugin/skills` file that should hit and does not is a red step.

- [ ] **Step 6: Commit, then file the follow-up record (controller)**

```bash
git add .claude-tweaks/policy.yml CLAUDE.md tests/deferral-gate-conformance.test.js
git commit -m "Send this repo's outside-the-diff and idea deferrals to the digest — policy line and the CLAUDE.md bullet that states it (#5932)" -m "{the session's Claude-Session line}"
```

Then file one backlog record via `/claude-tweaks:capture` with a spec-shaped body, `--defer-reason=genuinely-larger --source build`, refs #5932. Title: "Route reflect's auto-mode record proposals through deferral-route.js". Current State: `reflect/SKILL.md` Step 3's auto table stages every tangential idea as a Queue-writes record proposal (line 123), and `record` Destinations become records (line 153), without running `bin/deferral-route.js`. In a project that lists `tangential` in `deferral-digest-reasons`, those ideas still file. Deliverables: the staging point (or the Review Console's Queue-writes creation step) runs the command and digests on `digest`. A `materiality-floor-conformance` deferral-site test pins it. Acceptance Criteria: with `tangential` listed, an auto-mode reflect tangential idea produces a digest entry and no staged record proposal; with the key unset, nothing changes. Key Files: `plugin/skills/reflect/SKILL.md`, `plugin/skills/wrap-up/review-console.md`, `tests/materiality-floor-conformance.test.js`.

## Behavior-change prose sweep (classified)

Grep of the old rule's phrases (`always clears the floor`, `non-\`tangential\``, `not \`tangential\``, `only ever comes from the`, `tangential`+`digest`) over `plugin/skills docs/journeys README.md`:
- `docs/journeys/route-a-deferred-finding-in-code-5930.md:32,33,36`: changed (Task 3).
- `docs/journeys/route-a-declined-reflection-insight.md:28` and `docs/journeys/route-a-review-finding-the-release-gate-can-see-4488.md:38`: no change. Both describe the default (an empty list), which is still every other project's behaviour.
- `plugin/skills/harness-health/filing.md:31` and `plugin/skills/journey-health/SKILL.md:153`: no change. "Clears the materiality floor" is the health sweeps' own floor prose, and they carry no gate `Defer-reason:`.
- `plugin/skills/reflect/SKILL.md:123,153`: the unrouted path, filed as the follow-up record (Task 5 Step 6).
- `plugin/skills/_shared/materiality-floor.md`'s Audit line ("routed below floor (…, rule={rule})"): no change. `rule=` names `policy-reason` for a policy digest, and the `AUDIT_RULE` pin stays green.

## Spec coverage

| Spec item | Task |
|---|---|
| Deliverable 1 (key, `defer-reason` element, checklist) | Task 1 (checklist walk in the Fact-check; grep in Task 5 Step 5) |
| Deliverable 2 (`routeDeferral` takes the list, rule `policy-reason`) and 3 (precedence) | Task 2 |
| Deliverable 4 (CLI resolves the key, `--run`, warning, resolver error passthrough) | Task 3 |
| Deliverable 5 (closed rule) | Task 1 (AC6.1 resolver), Task 2 (verdict set unchanged, inert unknown entries) |
| Deliverable 6 (Overrides: key, precedence, lifecycle) | Task 4 |
| Deliverable 7 (this repo's `policy.yml`) and 8 (CLAUDE.md bullet) | Task 5 |
| Deliverable 9 (tests) | Tasks 1-4 |
| AC1.1 | Task 2 (unmodified exhaustive test + `AC1.1` test + the Proof line) |
| AC2.1, AC3.1, AC3.2, AC4.1, AC5.1 | Task 2 (function) and Task 3 (CLI) |
| AC6.1 | Task 1 (resolver, `auditPolicy`, `resolvePolicyConfig`) and Task 3 (CLI warning) |
| AC7.1 | Task 1 (resolver) and Task 3 (CLI `--run`) |
| AC8.1 | Task 5 Step 4 (probe + AC evidence entry); AC8.2/AC8.3 waived above |
| AC9.1 | Task 4 |
