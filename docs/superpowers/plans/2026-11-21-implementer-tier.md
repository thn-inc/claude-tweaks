# Implementer Tier From The Record — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a pure function that picks a build's implementer work profile from its record (size + Key File count), a one-step escalation function, an `implementer-tier` policy key choosing between that rule and today's size-only mapping, and a CLI that exposes both to skill prose — consumed later by #5997 and #5999, changing no build here.

**Architecture:** One pure module (`plugin/bin/lib/model-profiles/implementer-tier.js`) owns the decision and its closed-input validation. The policy key is registered in `plugin/bin/lib/policy-schema.js` as a run-config-settable enum. A thin CLI (`plugin/bin/implementer-tier.js`, `run(argv, deps)` entry contract) reads a materialized spec's header and Key Files, resolves the key through `resolve-policy.js`'s exported `resolvePolicy` core (which calls `resolvePolicyConfig`, so it inherits the `--run` anchoring guard and the `onInvalid` side channel), and prints one JSON line.

**Tech Stack:** Node 18+ CommonJS, `node:test`, `tests/helpers/run-cli.js` (`runCliSync`, `spawnCli`).

**Spec:** `.claude-tweaks/pipelines/2026-11-22T083122-record-5996/work/5996-spec.md` (record #5996)

Scope keywords: implementerProfile, stepUp

(`implementer-tier` and `keyFileCount` were dropped from the keywords after the first audit: their only unplanned hits are name collisions — `tests/plan-task-markers-conformance.test.js`'s "implementer-tier mapping" test title for dispatch.md's existing marker mapping, which the spec's Current State names, and `tests/bin-lib/driver/admission.test.js`'s local `keyFileCount` fixture parameter — neither reads or is read by this record's code.)

Waived plugin/bin/lib/model-profiles/profiles.js: read only — `PROFILES` is imported; `PROFILE_ORDER` is not exported because it is not reused (Global Constraints).
Waived tests/bin-lib/model-profiles/cli.test.js: the spec allows a new sibling CLI test file; the CLI cases go in `tests/bin-lib/model-profiles/implementer-tier-cli.test.js` and this file (resolve-profile.js's tests) is untouched.
Waived tests/bin-lib/model-profiles/table-pinning.test.js: untouched — `PROFILES` does not change.
Waived _shared/subagent-dispatch-core.md: untouched — the profile table it holds does not change.

## Global Constraints

- Values copied from the spec: key `implementer-tier`; values `lane` and `record`; default `lane`; not `policyOnly`. Profiles returned: `'fast' | 'standard' | 'capable' | null`; `stepUp` never returns `frontier`.
- CLI JSON line, keys in exactly this order: `{"profile","stepUp","rule","size","keyFileCount"}`.
- No input falls back silently to another rule: an invalid `rule`, `size`, `keyFileCount`, `--rule`, `--from`, header value or resolved policy value is refused, naming the value.
- `plugin/bin/lib/model-profiles/profiles.js` stays untouched (the spec allows exporting `PROFILE_ORDER` only if reused; this plan does not reuse it — `PROFILE_ORDER` includes `frontier`, which `stepUp` must never return). `tests/bin-lib/model-profiles/table-pinning.test.js`'s table is not edited.
- Byte budget: `plugin/skills/_shared/policy-schema.md` is 51,537 B against `RAIL_BYTES` 52,500 B (963 B headroom); Task 2 adds about 110 B there (key-only row plus one clause), leaving about 850 B. The full row goes in `plugin/skills/_shared/policy-schema-model-profiles.md` (3,789 B; about 4,600 B after).
- Test commands use the repo runner: `node tools/run-tests.js {file}` (a bare `node --test` is denied by the repo guard).
- Commit style: `{Verb} {what} — {detail}`, ending `refs #5996`, plus the trailer `Claude-Session: https://claude.ai/code/session_019fFofWb6WhRbkTgvMCDnKP`.

Governing skills, quoted verbatim:

From `.claude/skills/policy-key-addition`:

> 1. **The `POLICY_KEYS` row.** `key` (flat kebab-case, `tests/policy-key-naming.test.js`), `type` (`boolean`, `enum`, `integer`, `string`, `list` or `map`), `values` for an enum, and `default` unless the default is derived (`_shared/policy-schema-read-path.md`'s Derived-default keys, Shapes A and B). [...] `summary`, `category` and `tier` are required (`tests/policy-schema-metadata.test.js`).
> 2. **The tier.** The core tier has an enforced cap of 12 (`tests/policy-schema-metadata.test.js`) and sits at it, so a new key is `advanced` unless it replaces a core one.
> 3. **The key count.** `tests/policy-schema.test.js` pins `POLICY_KEYS.length`. Bump it in the same commit, and rewrite the `Last bump: {old} -> {new}, #{record}` line directly above the assertion — the test fails when that line's new value differs from the pin.
> 4. **The doc row** in `_shared/policy-schema.md`. Every key needs a table row there that starts `` | `{key}` | `` (`tests/policy-key-naming.test.js`), and its summary must not be copied verbatim from the row's `summary` (`tests/policy-schema-metadata.test.js`). State the value the resolver returns for unset, set and malformed input, from the code, not from intent. [...] A consumer that guards a resolved value reads the same output: a malformed value arrives as `source: 'default'` with `invalid: true`, never as a non-default source, so a `source !== 'default'` guard never sees it. Key such a guard on `invalid`, and build its test fixture from a real `resolvePolicyKeys` reply rather than a hand-written one.
> 7. **A key that lands before its consumer** opens its `summary` with `Not yet used. ` or `Not yet used; ` and joins `NOT_YET_USED` in `tests/resolve-policy-control-mode.test.js`. That file pins both directions: every listed key carries the marker, and no unlisted key does. The record that wires a key's first consumer drops the marker and the list entry in the same commit.
> Every new key gets this decision, even when the answer is neither flag. [...] Say the decision in the comment above the row, as both of those do.
> **Pin each new validation branch with its own assertion.**

Sites 5, 6, 8, 9 do not apply: the key is new (no rename), not a Manifesto lever (so `_shared/auto-mode-contract.md`'s "Adding a new policy lever" checklist does not apply — say so in the comment above the row), and not `policyOnly`.

From `.claude/skills/gh-api-module-pattern/cli-wrapper-contract.md`:

> **A CLI that tests call in-process meets the entry contract** (#5374; `plugin/bin/resolve-policy.js` is the worked example). It exports `run` and `realDeps`; `argv` is `process.argv.slice(2)`, and `run` returns an integer exit code or a Promise of one. The script entry is the file's last statement: `if (require.main === module) process.exitCode = run(process.argv.slice(2), realDeps);`. [...] Above the guard and in everything `run` calls there is no `process.exitCode`, `process.exit()`, `process.chdir()` or write to `process.env`. A relative path is resolved against `deps.cwd()`, never left to `path.resolve` or `fs` [...] (`resolveAgainst(deps.cwd(), p)`, `plugin/bin/lib/health-core/io.js`) [...] each converted CLI keeps one or two `spawnCli` smoke tests for the script entry, shebang and exit code. The helper's `env` defaults to `{}` and is the whole environment the CLI sees, so a CLI that starts `git` or `gh` needs `PATH` (and `SystemRoot` on Windows) in the `env` the test passes.
> *Payload-1/Invocation-2* (`plugin/bin/wrap-up-engine.js`, `plugin/bin/declined-learning.js`): 0 success, 1 the invocation was well-formed but the stdin/file payload was not (unparseable JSON, a payload that fails validation), 2 malformed invocation (missing/unknown flags, an unknown verb).

This CLI uses the *Payload-1/Invocation-2* family: the spec file and the policy files are its payload.

`.claude/skills/prose-code-twin-pin` does not apply: the doc row restates a two-value enum the registration test already pins against `POLICY_KEYS`. `.claude/skills/regex-scan-linearity` does not apply: the header scan is one anchored per-line match over a bounded header block.

## Review Focus

- A Key Files bullet naming a directory (`plugin/skills/foo/`) on a `size: low` record — must never qualify for Fast (Task 1 test: directory entry); likewise a glob (`*.md`) or brace-list (`{a,b}`) entry (Task 1 tests: glob, wildcard, brace list).
- A header `size:` value with trailing whitespace (`size: low  `) — reads as `low`, not as malformed (Task 3 test: trailing whitespace).
- A `size:` line appearing in the body (below the first `#` heading), not the header — must not be read as the record's size (Task 3 test: body size line ignored).
- `--run` naming a directory that does not exist (a typo'd run id) — refused, never read as "no run config" (Task 3 test: missing `--run` dir exits 2 via `resolvePolicy`'s existence check).
- `--run` passed together with `--rule` — still validated (the spec's Decision, Reading B, AC 12): a missing run dir exits 2 even though `--rule` skips the policy value (Task 3 test: AC12.1).
- A flag given twice (`--rule lane --rule record`) — a malformed invocation (exit 2), never last-value-wins (Task 3 test: AC12.2).
- A relative `--spec-file` path — resolved against the injected cwd, not the process cwd (Task 3 test: relative path).

---

### Task 1: The pure decision module

**Role:** integration
**Review risk:** high

**Files:**
- Create: `plugin/bin/lib/model-profiles/implementer-tier.js`
- Test: `tests/bin-lib/model-profiles/implementer-tier.test.js`

**Interfaces:**
- Consumes: `extractKeyFilesSection(body) -> string[]` from `plugin/bin/lib/issues/grouping.js`; `PROFILES` from `plugin/bin/lib/model-profiles/profiles.js` (to recognise `frontier` as a known profile).
- Produces:
  - `POLICY_KEY` = `'implementer-tier'`
  - `RULES` = `['lane', 'record']`
  - `SIZES` = `['low', 'medium', 'high']`
  - `keyFileCount(body: string) -> number`
  - `implementerProfile({ size, keyFileCount, rule }) -> 'fast' | 'standard' | 'capable' | null`
  - `stepUp(profile: string | null) -> 'standard' | 'capable' | null`

- [ ] **Step 1: Write the failing tests** in `tests/bin-lib/model-profiles/implementer-tier.test.js` (`node:test`, `node:assert`), requiring `../../../plugin/bin/lib/model-profiles/implementer-tier`:

```js
const KF = (...items) => `# T\n\n### Key Files\n\n${items.map((i) => `- ${i}`).join('\n')}\n`;
test('AC10.1: keyFileCount counts a repeated path once', () => assert.strictEqual(keyFileCount(KF('`a.js` — x', '`a.js` — again', '`b.js`')), 2));
test('AC10.2: keyFileCount is at least 3 for a list naming a directory', () => assert.strictEqual(keyFileCount(KF('`plugin/skills/foo/`')), 3));
test('keyFileCount: a directory beside four files reports 5, never less than the distinct count', () => assert.strictEqual(keyFileCount(KF('`d/`', '`a`', '`b`', '`c`', '`e`')), 5));
test('keyFileCount: a glob entry counts like a directory (plan-review clarification)', () => assert.strictEqual(keyFileCount(KF('`plugin/skills/flow/*.md`')), 3));
test('keyFileCount: a ? wildcard entry counts like a directory', () => assert.strictEqual(keyFileCount(KF('`a/file?.js`')), 3));
test('keyFileCount: a brace-list entry counts like a directory', () => assert.strictEqual(keyFileCount(KF('`bin/lib/{a,b}-health/x.js`')), 3));
test('keyFileCount: a lone brace with no comma is a plain path', () => assert.strictEqual(keyFileCount(KF('`a/{x}.js`', '`b.js`')), 2));
test('keyFileCount: a test file counts like any other path', () => assert.strictEqual(keyFileCount(KF('`tests/x.test.js`', '`a.js`')), 2));
test('AC10.3: keyFileCount is 0 for a body with no Key Files section', () => assert.strictEqual(keyFileCount('# T\n\n## Overview\n\ntext\n'), 0));
test('keyFileCount: bullets with no backticked path count 0', () => assert.strictEqual(keyFileCount(KF('plain words', 'more words')), 0));
```

Matrix tests — every size (`'low'`, `'medium'`, `'high'`, `undefined`) × `keyFileCount` 0, 1, 2, 3, under both rules:
- `AC1.1`: `implementerProfile({ size: 'low', keyFileCount: 2, rule: 'record' })` → `'fast'` (and `keyFileCount: 1` → `'fast'`).
- `AC1.2`: same with `keyFileCount: 3` → `'standard'`.
- `AC1.3`: same with `keyFileCount: 0` → `'standard'`.
- `AC2.1`: under `record`, `'medium'` and `'high'` → `'standard'` for every count 0–3, and `size: undefined` → `'standard'` for every count (also `size: null` → `'standard'`).
- `AC3.1`: under `lane`, `'low'`/`'medium'`/`'high'` → `'fast'`/`'standard'`/`'capable'` for every count 0–3, and `size: undefined` (and `null`) → `null`.

`stepUp` tests:
- `AC4.1`: `stepUp('fast') === 'standard'`, `stepUp('standard') === 'capable'`, `stepUp('capable') === null`, `stepUp('frontier') === null`, `stepUp(null) === null`.
- `AC4.2`: `assert.throws(() => stepUp('huge'), /huge/)`; also `stepUp(undefined)` throws (`/undefined/`) — only `null` means "no profile".

Closed-rule refusals, one assertion each (each validation branch pinned separately):
- `AC5.1`: `assert.throws(() => implementerProfile({ size: 'low', keyFileCount: 1, rule: 'sometimes' }), /sometimes/)`; `implementerProfile({ size: 'huge', keyFileCount: 1, rule: 'record' })` throws `/huge/`; `implementerProfile({ size: 'low', keyFileCount: -1, rule: 'record' })` throws `/-1/`.
- `keyFileCount` values `1.5`, `'2'`, `NaN`, `Number.MAX_SAFE_INTEGER + 1` each throw; a missing `rule` (undefined) throws.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node tools/run-tests.js tests/bin-lib/model-profiles/implementer-tier.test.js`
Expected: FAIL — `Cannot find module '../../../plugin/bin/lib/model-profiles/implementer-tier'`.

- [ ] **Step 3: Implement `plugin/bin/lib/model-profiles/implementer-tier.js`**

Pure module (no fs, no process). Header comment names #5996, the two consumers (#5997 driver, #5999 standard lane) and that a throw is the consumer's to act on (never a fallback).
- `keyFileCount(body)`: `const paths = new Set(extractKeyFilesSection(body))`; if any path names several files — it ends in `/` (a directory), contains `*` or `?` (a glob), or matches `/\{[^}]*,[^}]*\}/` (a brace list; the spec's Plan Review Clarifications) — return `Math.max(paths.size, 3)`, else `paths.size`.
- `implementerProfile`: validate `rule` ∈ `RULES`, `size` ∈ `SIZES` or `undefined`/`null`, `keyFileCount` a non-negative `Number.isSafeInteger`; each refusal throws an `Error` whose message names the bad value via `JSON.stringify` (e.g. `implementer-tier: unknown rule "sometimes" — expected lane or record`). Under `record`: `size === 'low' && (keyFileCount === 1 || keyFileCount === 2)` → `'fast'`, else `'standard'`. Under `lane`: `{ low: 'fast', medium: 'standard', high: 'capable' }[size]`, `null` when size is missing.
- `stepUp(profile)`: a local ladder `['fast', 'standard', 'capable']`; `null` and `'frontier'` → `null`; `'capable'` → `null`; any value that is not `null` and not a key of `PROFILES` throws naming it.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node tools/run-tests.js tests/bin-lib/model-profiles/implementer-tier.test.js`
Expected: PASS, 0 failures.

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/model-profiles/implementer-tier.js tests/bin-lib/model-profiles/implementer-tier.test.js
git commit -m "Add the implementer-tier decision module — record rule, lane rule, one-step escalation, refs #5996"
```

### Task 2: Register the `implementer-tier` policy key and opt this repository in

**Role:** integration

**Files:**
- Modify: `plugin/bin/lib/policy-schema.js` (the `models` rows, after `express-driver-models`, about line 281)
- Modify: `tests/policy-schema.test.js:46-47` (key-count pin)
- Modify: `tests/resolve-policy-control-mode.test.js:312` (`NOT_YET_USED`)
- Modify: `tests/bin-lib/model-profiles/policy-keys-registration.test.js`
- Modify: `plugin/skills/_shared/policy-schema.md` (`## Model profiles` section, about lines 174-185)
- Modify: `plugin/skills/_shared/policy-schema-model-profiles.md` (table, after the `express-driver-models` row)
- Modify: `.claude-tweaks/policy.yml`

**Interfaces:**
- Consumes: `POLICY_KEY`, `RULES` from Task 1's module.
- Produces: `POLICY_KEYS` entry `{ key: 'implementer-tier', type: 'enum', values: ['lane', 'record'], default: 'lane', category: 'models', tier: 'advanced' }` (no `policyOnly`, no `policySourceExcluded`), resolvable via `resolvePolicyKeys(['implementer-tier'], …)`.

- [ ] **Step 1: Write the failing registration test** — append to `tests/bin-lib/model-profiles/policy-keys-registration.test.js`:

```js
const { POLICY_KEY, RULES } = require('../../../plugin/bin/lib/model-profiles/implementer-tier');
test('AC9.1: implementer-tier is registered as a run-settable lane|record enum defaulting to lane', () => {
  const row = POLICY_KEYS.find((entry) => entry.key === POLICY_KEY);
  assert.ok(row, `${POLICY_KEY} is missing from POLICY_KEYS`);
  assert.strictEqual(row.type, 'enum');
  assert.deepStrictEqual(row.values, RULES);
  assert.strictEqual(row.default, 'lane');
  assert.notStrictEqual(row.policyOnly, true);
  assert.notStrictEqual(row.policySourceExcluded, true);
});
```

Plus one resolver test in the same file, built from a real `resolvePolicyKeys` reply: `resolvePolicyKeys(['implementer-tier'], { policyRaw: 'implementer-tier: record\n', runConfigRaw: 'implementer-tier: lane\n' })` → `{ value: 'lane', source: 'run-config' }` (run config beats policy), and `policyRaw: 'implementer-tier: sometimes\n'` → `{ value: 'lane', source: 'default', invalid: true }` with `onInvalid` receiving `('implementer-tier', 'sometimes')`.

- [ ] **Step 2: Run it to verify it fails**

Run: `node tools/run-tests.js tests/bin-lib/model-profiles/policy-keys-registration.test.js`
Expected: FAIL — `implementer-tier is missing from POLICY_KEYS`.

- [ ] **Step 3: Add the `POLICY_KEYS` row** in `plugin/bin/lib/policy-schema.js`, directly after the `express-driver-models` row, preceded by a comment stating: #5996; read by `plugin/bin/implementer-tier.js` (resolved per run, so not `policyOnly`: one run may try `record` through its `config.yml` without changing the project file; not `policySourceExcluded`: a standing project opt-in is the point); not a Manifesto lever, so `_shared/auto-mode-contract.md`'s new-lever checklist does not apply; no build calls the CLI yet — #5997 (driver) and #5999 (standard lane) wire the first consumers and drop the `Not yet used` marker and the `NOT_YET_USED` entry. Row:

```js
{ key: 'implementer-tier', type: 'enum', values: ['lane', 'record'], default: 'lane', summary: "Not yet used. Picks an implementer's work profile from the record's size and Key File count, or from size alone as today.", category: 'models', tier: 'advanced' },
```

- [ ] **Step 4: Update the pins** — `tests/policy-schema.test.js`: `// Last bump: 116 -> 117, #5996` and `assert.strictEqual(POLICY_KEYS.length, 117);`. `tests/resolve-policy-control-mode.test.js`: add `'implementer-tier'` to the end of `NOT_YET_USED`.

- [ ] **Step 5: Document the key.** In `plugin/skills/_shared/policy-schema.md`'s `## Model profiles` section, change the intro's "reads four of these six" to "reads four of these seven", insert after the `express-driver-models` clause `; `implementer-tier` (#5996) chooses whether a build's implementer profile comes from the record's size and Key Files or from size alone`, and add the key-only row `` | `implementer-tier` | `` after the `` | `express-driver-models` | `` row. In `plugin/skills/_shared/policy-schema-model-profiles.md`, add after the `express-driver-models` row:

```markdown
| `implementer-tier` | `policy.yml`, or the run's `config.yml` (not `policyOnly`) | `bin/implementer-tier.js`, `bin/lib/model-profiles/implementer-tier.js` — no build calls it yet (#5997 driver, #5999 standard lane) | `lane` | `lane`: today's size-only mapping, `low`→`fast`, `medium`→`standard`, `high`→`capable`, and no `size` → `null` (no override). `record`: `fast` for a `size: low` record whose Key Files name one or two distinct paths and no directory, `standard` for every other record (a missing `size` and zero Key Files included); `size: high` no longer reaches Capable except through the CLI's one-step `stepUp`. Unset resolves `lane` with `source: default`; a value other than `lane`/`record` resolves `lane` with `source: default` and `invalid: true`, which `bin/implementer-tier.js` refuses (exit 1, naming the value) instead of running on `lane` |
```

Measure after editing: `wc -c plugin/skills/_shared/policy-schema.md` must print below 52500.

- [ ] **Step 6: Opt this repository in** — in `.claude-tweaks/policy.yml`, directly after `express-driver: on`, add:

```yaml
# implementer-tier (#5995): record runs a size:low record with one or two Key Files on Fast, every other record on Standard.
# Revert signal: over the first 20 implementation tasks on Fast, a share needing a fix round higher than Standard's over
# the same runs (tools/pipeline-cost-report.js's review-results-by-role-and-tier table) means set this back to lane.
implementer-tier: record
```

- [ ] **Step 7: Run the affected suites to verify they pass**

Run: `node tools/run-tests.js tests/bin-lib/model-profiles/policy-keys-registration.test.js tests/policy-schema.test.js tests/policy-schema-metadata.test.js tests/policy-key-naming.test.js tests/resolve-policy-control-mode.test.js`
Expected: PASS, 0 failures.

Go-red check for AC9.1 (scratch, not committed): remove the new row from `policy-schema.js` with the Edit tool, re-run `node tools/run-tests.js tests/bin-lib/model-profiles/policy-keys-registration.test.js`, confirm the AC9.1 test fails with `implementer-tier is missing from POLICY_KEYS`, then put the row back with the Edit tool (never `git checkout`/`git restore`) and re-run to green. Quote both runs' fail/pass lines in the task report.

- [ ] **Step 8: Commit**

```bash
git add plugin/bin/lib/policy-schema.js tests/policy-schema.test.js tests/resolve-policy-control-mode.test.js tests/bin-lib/model-profiles/policy-keys-registration.test.js plugin/skills/_shared/policy-schema.md plugin/skills/_shared/policy-schema-model-profiles.md .claude-tweaks/policy.yml
git commit -m "Register the implementer-tier policy key — lane default, this repository opts into record, refs #5996"
```

### Task 3: The `implementer-tier.js` CLI

**Role:** integration
**Review risk:** high

**Files:**
- Create: `plugin/bin/implementer-tier.js`
- Test: `tests/bin-lib/model-profiles/implementer-tier-cli.test.js`
- Modify: `docs/plugin-structure.md` (the `plugin/bin/lib/model-profiles/` entry, line 39, and a command line directly after `resolve-profile.js`'s, line 401)

**Interfaces:**
- Consumes: Task 1's `keyFileCount`, `implementerProfile`, `stepUp`, `POLICY_KEY`, `RULES`, `SIZES`; `resolvePolicy({ keys, runDir }, deps) -> { code: 0, result, invalidRaw } | { code: 1, message }` and `realDeps` from `plugin/bin/resolve-policy.js`; `resolveAgainst(cwd, p)` from `plugin/bin/lib/health-core/io.js`; `PROFILES` from `profiles.js` (valid `--from` values).
- Produces: `run(argv, deps) -> 0 | 1 | 2`, `realDeps`, `EXIT_OK = 0`, `EXIT_PAYLOAD = 1`, `EXIT_INVOCATION = 2`. Usage: `implementer-tier.js --spec-file <path> [--rule lane|record] [--run <dir>] [--from <profile>]`. Stdout on success: one line, `JSON.stringify({ profile, stepUp, rule, size, keyFileCount })` + `\n`, `size` `null` when the header has none.

- [ ] **Step 1: Write the failing tests** in `tests/bin-lib/model-profiles/implementer-tier-cli.test.js`, calling the CLI in-process through `runCliSync(CLI, args, { env, cwd })` (absolute `CLI` path), where `env` is `{ PATH: process.env.PATH }` plus `SystemRoot: process.env.SystemRoot` only when that variable is defined (Windows) — `resolvePolicy` starts `git rev-parse --show-toplevel` with this env, plus one `spawnCli` smoke test. Fixtures are written into `fs.mkdtempSync(path.join(os.tmpdir(), 'impl-tier-'))` dirs, removed in `afterEach`. A fixture helper writes materialize.js's layout:

```js
const spec = ({ header, keyFiles = [] }) =>
  `---\nrecord: 1\n${header}---\n# 1: Title\n\n## Overview\n\ntext\n\n### Key Files\n\n${keyFiles.map((f) => `- \`${f}\``).join('\n')}\n`;
```

(`header` is a string of lines, each ending `\n`, e.g. `'size: low\n'`.) A scratch project is a tmp dir holding `.claude-tweaks/policy.yml` (not a git repo, so `resolvePolicy`'s root falls back to the cwd).

Tests (each asserts exit code, and for success the parsed JSON; for failure `stdout === ''` and the stderr substring):
- `AC6.1`: `size: low` + two Key Files, `--rule record` → exit 0, `profile: 'fast'`, `stepUp: 'standard'`.
- `AC6.2`: same fixture, `--rule lane` → `profile: 'fast'`.
- `AC6.3`: `size: high` + two Key Files, `--rule lane` → `profile: 'capable'`, `stepUp: null`.
- `AC7.1`: `--spec-file {tmp}/missing.md` → exit 1, stdout `''`, stderr includes the path.
- `AC7.2`: header `size: huge` → exit 1, stderr includes `huge`; scratch project whose `policy.yml` is `implementer-tier: sometimes\n`, no `--rule` → exit 1, stdout `''`, stderr includes `sometimes`.
- `AC8.1`: cwd = this repository's root (`path.join(__dirname, '..', '..', '..')`), no `--rule`, a tmp fixture by absolute path → `rule: 'record'`.
- `AC8.2`: scratch project with an empty `policy.yml` (key unset), no `--rule` → `rule: 'lane'`.
- `AC8.3`: scratch project `policy.yml` `implementer-tier: record\n`, a tmp run dir (outside any checkout) whose `config.yml` is `implementer-tier: lane\n`, `--run {runDir}` → `rule: 'lane'`.
- `AC11.1`: header `effort: low` (no `size:`), one Key File, `--rule lane` → `size: 'low'`, `profile: 'fast'`.
- `AC11.2`: same fixture with `--from capable` → `stepUp: null`; with `--from fast` → `stepUp: 'standard'` (and `profile` still `'fast'`).
- Neither `size:` nor `effort:` under `--rule lane` → `size: null`, `profile: null`, `stepUp: null`; under `--rule record` → `profile: 'standard'`.
- Two `size:` lines → exit 1, stderr names `size`.
- Review Focus: `size: low  ` (trailing spaces) → `size: 'low'`; a `size: high` line placed in the body below `# 1: Title` with the header carrying `size: low` → `size: 'low'`; a relative `--spec-file spec.md` with `cwd` = its tmp dir resolves; `--run {tmp}/no-such-run` (a directory that does not exist, outside any checkout) with no `--rule` → exit 2, stdout `''`, stderr includes `does not exist` (`resolvePolicy`'s existence refusal — deterministic in a worktree and in a main checkout alike, unlike the anchored-or-outside guard, whose verdict on an in-repo path depends on which checkout runs the suite).
- `AC12.1`: the `size: low` + two-file fixture with `--rule lane --run {tmp}/no-such-run` (a directory that does not exist, outside any checkout) → exit 2, stdout `''`, stderr includes `{tmp}/no-such-run` — `--run` is validated even when `--rule` skips the policy value (the spec's Decision, Reading B).
- `AC12.2`: `--rule lane --rule record` → exit 2, stdout `''`, stderr includes `--rule`; likewise a repeated `--spec-file`, `--run` and `--from` each exit 2 naming the flag.
- `--rule lane --run {runDir}` where `{runDir}` exists (outside any checkout) and its `config.yml` says `implementer-tier: record` → exit 0, `rule: 'lane'` (a valid `--run` passes and `--rule` still wins).
- Invocation errors → exit 2, stdout `''`: no `--spec-file`; `--rule sometimes`; `--from huge`; an unknown flag `--bogus`; `--rule` with no value.
- Spawned smoke test: `spawnCli(CLI, ['--spec-file', fixture, '--rule', 'lane'], …)` on the `size: low` + two-file fixture → exit 0, stderr `''`, stdout exactly `'{"profile":"fast","stepUp":"standard","rule":"lane","size":"low","keyFileCount":2}\n'`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node tools/run-tests.js tests/bin-lib/model-profiles/implementer-tier-cli.test.js`
Expected: FAIL — the CLI file `plugin/bin/implementer-tier.js` does not exist (`Cannot find module`).

- [ ] **Step 3: Implement `plugin/bin/implementer-tier.js`** (`#!/usr/bin/env node`, `'use strict'`).

Header comment: purpose (#5996), usage line, the JSON shape, the *Payload-1/Invocation-2* exit family (0 printed; 1 unreadable spec file, malformed header — a `size:`/`effort:` value outside `low`/`medium`/`high` or a repeated line — or an invalid resolved `implementer-tier` from `policy.yml` or the run's `config.yml`; 2 malformed invocation — missing `--spec-file`, unknown flag, flag without value, a flag given twice, invalid `--rule`/`--from`, or a `--run` that `resolvePolicy` refuses), and that `--run` is validated even when `--rule` is passed (the spec's Decision, Reading B: a mistyped run id never passes silently), while the resolved policy value is then ignored.

Behaviour:
- Parse flags `--spec-file`, `--rule`, `--run`, `--from` (each takes a value; a missing value, a value starting `--`, or a blank value is exit 2, as `resolve-profile.js`'s `requireValue` does; a flag seen a second time is exit 2 `implementer-tier: {flag} given more than once`). Validate `--rule` ∈ `RULES` and `--from` ∈ `Object.keys(PROFILES)` before any read.
- Read the spec with `fs.readFileSync(resolveAgainst(deps.cwd(), specFile), 'utf8')` in a try/catch → exit 1 `implementer-tier: cannot read spec file {specFile}: {err.message}`.
- Header block: the CRLF-normalized lines before the first blank line or the first line matching `/^#{1,6}\s/`. Collect the `^size:\s*(.*?)\s*$` matches; if none, the `^effort:\s*(.*?)\s*$` matches. More than one match of the line read → exit 1 naming the field; a value not in `SIZES` → exit 1 naming the value; none → `size` `undefined` (printed as `null`).
- `rule`: call `resolvePolicy({ keys: [POLICY_KEY], runDir: run ?? null }, deps)` whenever `--rule` is absent **or** `--run` is given — one validator for `--run` (its anchored-or-outside guard and existence check), never a second copy of them in this CLI. `code !== 0` → exit 2 with its `message` (this is how `--rule lane --run {missing}` exits 2, AC 12). Then, when `--rule` was given, `rule` is `--rule` and the resolved policy value is ignored (an invalid `policy.yml` value does not fail a `--rule` call); otherwise `result[POLICY_KEY].invalid === true` → exit 1 `implementer-tier: invalid implementer-tier value "{invalidRaw.get(POLICY_KEY)}" — expected lane or record`; else `result[POLICY_KEY].value`. With `--rule` and no `--run`, `resolvePolicy` is not called.
- Compute `keyFileCount(text)`, `profile = implementerProfile({ size, keyFileCount, rule })`, `stepUp(from ?? profile)`; print the JSON line in the fixed key order; exit 0. Any throw from Task 1's functions → exit 1 with its message.
- `realDeps` = `{ ...require('./resolve-policy').realDeps }` (cwd, env, homeDir, git, readFile, stdout, stderr). Entry guard as the contract states.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node tools/run-tests.js tests/bin-lib/model-profiles/implementer-tier-cli.test.js tests/bin-lib/cli-entry-conformance.test.js tests/bin-lib/exit-code-conformance.test.js tests/path-guard-conformance.test.js tests/windows-hide-spawn-conformance.test.js`
Expected: PASS, 0 failures.

Proof(public-contract): the new `implementer-tier` key (values `lane`/`record`, default `lane`, run-config settable) is pinned by Task 2's AC9.1 registration test, and this CLI's JSON key order, `null` handling and exit codes 0/1/2 are pinned byte-exact by this task's spawned script-entry test and per-exit tests; the installed 6.175.0 resolver was probed against a scratch `policy.yml` holding `implementer-tier: record` and kept resolving every other key (this run's `decisions.md`, Spec Step 3 assumption check), so the committed opt-in line cannot break a run on the previous release.

- [ ] **Step 5: Real-input probe** (record each printed line in the task report):

Run: `node plugin/bin/implementer-tier.js --spec-file ".claude-tweaks/pipelines/2026-11-22T083122-record-5996/work/5996-spec.md"`
Expected: `{"profile":"standard","stepUp":"capable","rule":"record","size":"medium","keyFileCount":9}`

Run: `node plugin/bin/implementer-tier.js --spec-file ".claude-tweaks/pipelines/2026-11-16T063159-record-5541/work/5541-spec.md" --rule lane`
Expected: `{"profile":"fast","stepUp":"standard","rule":"lane","size":"low","keyFileCount":7}`

Run: `node plugin/bin/implementer-tier.js --spec-file ".claude-tweaks/pipelines/archive/2026-07-15T094113-record-19/work/19-spec.md" --rule lane`
Expected: `{"profile":"standard","stepUp":"capable","rule":"lane","size":"medium","keyFileCount":0}` (a pre-rename `effort: medium` header, no Key Files section)

- [ ] **Step 6: Document the CLI** in `docs/plugin-structure.md`: append to the `plugin/bin/lib/model-profiles/` entry (line 39) a sentence naming `implementer-tier.js` (#5996: `keyFileCount`, `implementerProfile`, `stepUp`, consumed by `plugin/bin/implementer-tier.js`), and add a command line after `resolve-profile.js`'s:

```
node plugin/bin/implementer-tier.js --spec-file <path> [--rule lane|record] [--run <dir>] [--from <profile>]   # Implementer-tier CLI (#5996) — picks a build's implementer work profile from a materialized spec's header `size:` (pre-rename `effort:` fallback) and its distinct `### Key Files` count under the `implementer-tier` rule (`--rule`, else the run's `config.yml` via `--run`, else `policy.yml`, else `lane`); prints one JSON line `{profile, stepUp, rule, size, keyFileCount}`, `stepUp` being one profile up from `--from` or the computed profile (`null` from `capable`, `frontier` or `null`); exit 0 printed, 1 unreadable spec file, malformed header or invalid resolved `implementer-tier` value, 2 malformed invocation or a refused `--run`; no build calls it yet (#5997, #5999) (tests in `tests/bin-lib/model-profiles/implementer-tier-cli.test.js`)
```

- [ ] **Step 7: Commit**

```bash
git add plugin/bin/implementer-tier.js tests/bin-lib/model-profiles/implementer-tier-cli.test.js docs/plugin-structure.md
git commit -m "Add the implementer-tier CLI — profile and step-up from a materialized spec, refs #5996"
```

## Acceptance-criterion coverage

| AC | Covered by |
|---|---|
| AC1.1–AC1.3, AC2.1, AC3.1, AC4.1, AC4.2, AC5.1, AC10.1–AC10.3 | Task 1 tests |
| AC9.1 | Task 2 registration test + go-red check |
| AC6.1–AC6.3, AC7.1, AC7.2, AC8.1–AC8.3, AC11.1, AC11.2, AC12.1, AC12.2 | Task 3 tests |

Waived AC8.4: the Gotchas' installed-release check passed (6.175.0 tolerates the unknown key — this run's `decisions.md`), so the `policy.yml` line ships and the `"rule":"lane"` fallback clause never applies.
