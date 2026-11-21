# Factory Policy Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a factory policy layer (env var `CLAUDE_TWEAKS_FACTORY_POLICY` + user file `~/.claude-tweaks/factory-policy.yml`) that resolves below a repository's `policy.yml` and above the schema default, with `source: 'factory'`.

**Architecture:** One new reader module (`plugin/bin/lib/policy-factory.js`) owns every env/file read and the env-over-file merge, and hands policy text to the pure resolver as `factoryRaw`. `resolvePolicyKeys` gains a third source after `policy`; block keys merge per row, repository over factory. `resolvePolicyConfig` / `resolvePolicy` thread `env` and the home directory to the reader and surface `factoryOrigin` plus stderr lines through `warningLines`.

**Tech Stack:** Node 18+ CommonJS, `node --test`, no npm deps.

**Spec:** `.claude-tweaks/pipelines/2026-11-21T181802-spec-6006/work/6006-spec.md` (record #6006)

**Scope keywords:** resolvePolicyKeys, resolvePolicyConfig, source === 'default', source !== 'default', CONFIG_SOURCES

## Global Constraints

- Names are final (the spec's proposal, checked against `.claude/skills/policy-key-addition`: no policy key is added, so its naming test does not apply): `FACTORY_POLICY_ENV = 'CLAUDE_TWEAKS_FACTORY_POLICY'`, `FACTORY_POLICY_REL_PATH = '.claude-tweaks/factory-policy.yml'` (relative to the home directory), `FACTORY_REFUSED_KEYS = ['merge-authorization', 'control-mode', 'deploy-command', 'release-hook']` (`release-hook` decided by the user at plan review — the spec's `## Plan Review Clarifications`), all exported from `plugin/bin/lib/policy-factory.js`.
- The multi-line variable format stands (decided at plan review); the Dispatch storage check already ran at Spec Step 3 and is in the spec's clarifications — no task re-probes it.
- Precedence per key: run-config (skipped for a `policyOnly` row) → policy → factory → schema default. Every key, ceiling keys included, keeps repository over factory (#6008 changes ceilings, not this record).
- `resolvePolicyKeys` stays pure: it takes `factoryRaw` as a string argument and never reads `process.env`, the home directory or the file system. Only `policy-factory.js` touches env and files.
- No variable and no file → every existing assertion passes unchanged and `resolve-policy.js --all` output is byte-identical (AC5).
- Exact stderr copy (newline-terminated, written only through `resolve-policy.js`'s `warningLines`, never a bare `process.stderr.write` — `.claude/skills/gh-api-module-pattern/cli-wrapper-contract.md`):
  - `resolve-policy: note — factory layer ({origin}) supplied {keys}` — `{keys}` comma+space joined, request order; only when ≥1 requested key resolved `source: 'factory'`; every output mode.
  - `resolve-policy: warning: {key} is not settable from the factory layer — ignored` — once per requested refused key present in the factory text; every output mode.
  - `resolve-policy: warning: could not read ~/.claude-tweaks/factory-policy.yml ({code}) — factory file ignored` — non-ENOENT read error; every output mode.
  - `resolve-policy: warning: {key} has invalid value "{first line of the dropped block}" in CLAUDE_TWEAKS_FACTORY_POLICY — using ~/.claude-tweaks/factory-policy.yml's block` — both sources carry block `{key}` and the variable's does not parse; every output mode.
- `factoryOrigin` is never added to stdout JSON; `--all` entries change only by the new `source` value.
- Governing-skill rules, verbatim:
  - `policy-key-addition`: "A consumer that guards a resolved value reads the same output: a malformed value arrives as `source: 'default'` with `invalid: true`, never as a non-default source, so a `source !== 'default'` guard never sees it. Key such a guard on `invalid`, and build its test fixture from a real `resolvePolicyKeys` reply rather than a hand-written one". Every consumer test in Task 5 builds its entry from a real `resolvePolicyKeys(..., { factoryRaw })` reply.
  - `policy-key-addition`: "**A `map` row resolves nothing from `policy.yml` until `resolvePolicyKeys` has a branch for it.**" Block merges live in those branches and in `modelProfilesEntry`.
  - `hook-event-in-process-tests` rule 2: "A helper that a verb or another CLI also calls takes an optional `env` whose default is the inherited environment, and a call without it builds exactly the options it built before … Every call from an event module passes `env`." `resolvePolicyConfig` and `resolveIntegrationModel` take optional `env`; `pre-tool-use.js`'s two calls pass it.
  - `hook-event-in-process-tests` rule 5: "`runCli`'s leak guard reports `os.homedir()` under an injected `HOME`". The library never calls `os.homedir()`: home is `homeDir()` when a function is passed, else `env.HOME || env.USERPROFILE`, else no file is read.
  - `lib-module-split` (require cycles): `policy-factory.js` requires `policy-schema.js` at top level; `policy-schema.js` reads `FACTORY_REFUSED_KEYS` and `readFactoryPolicy` only through a lazy `require('./policy-factory')` inside the functions that use them, so neither module's exports are read while partly initialized.
  - `.claude/skills/bin-source-scan-conformance` / path-guard: the reader uses `fs.readFileSync` only (no `fs.existsSync` / `fs.realpathSync`); ENOENT is the absent signal.

## Review Focus

1. A Dispatch/CI shell that already exports `CLAUDE_TWEAKS_FACTORY_POLICY` runs this repo's suite — expected: tests unaffected. Task 4 strips the variable in `tools/run-tests.js`'s `runnerChildEnv` and pins it in `tests/run-tests-isolation.test.js`. (A real `~/.claude-tweaks/factory-policy.yml` on a dev machine still reaches spawned CLI tests that inherit `HOME`; logged to the ledger as an observation, since moving the suite's `HOME` is outside this record.)
2. The factory text uses CRLF line endings or a trailing comment on a flat line — expected: resolves exactly as the same text in `policy.yml` does (one parser). Task 1 test `CRLF factory text resolves like policy.yml`.
3. A factory value is set and the repository value is malformed — expected: `invalid: true` default, never the factory value (no cascade). Task 2 test `invalid policy value does not cascade to factory`.
4. A factory-only `integration-model` pin — expected: no forge detection runs (`policy-derived-defaults.js` lines 78/95 gate on `source === 'default'`). Task 5 test.
5. A factory variable holding a refused key alongside a legal key — expected: the legal key applies, the refused one is ignored with its warning. Task 2 + Task 4 tests.

---

### Task 1: Factory reader and merge (`policy-factory.js`)

**Role:** integration
**Review risk:** high

**Files:**
- Create: `plugin/bin/lib/policy-factory.js`
- Modify: `plugin/bin/lib/policy-schema.js` (export `riskAllowedSlugs` only)
- Test: `tests/bin-lib/policy-factory.test.js`

**Interfaces:**
- Produces: `readFactoryPolicy({ env, homeDir, readFile }) -> { raw: string|null, origin: 'env'|'file'|'env+file'|null, warnings: string[] }` — `homeDir` optional function, `readFile(path) -> string` optional (default `fs.readFileSync(p, 'utf8')`), throws on error with `err.code`. `warnings` are complete newline-terminated lines (copy in Global Constraints). Exports `FACTORY_POLICY_ENV`, `FACTORY_POLICY_REL_PATH`, `FACTORY_REFUSED_KEYS`, `readFactoryPolicy`, `splitTopLevelChunks`.
- `splitTopLevelChunks(text) -> Array<{ key: string, text: string }>` — a chunk is a column-0 `key:` line (key may be wrapped in `"`/`'`, as `parseRiskPathGlobs` accepts) plus every following blank, comment or indented line, until the next column-0 non-comment line. Leading comment/blank lines before the first key are dropped.

Rules the tests pin:
- Variable empty or whitespace-only → absent. Home unresolvable → file absent, no read.
- Only one source present → `raw` is that source's text **verbatim** (no re-serialization), `origin` `env` or `file`.
- Both present → merge on canonical key name: a chunk's key maps through `RENAMED_KEYS` (`replacedBy` non-null → that name; retired `replacedBy: null` keeps its own name), and the winning chunk keeps its original text so the resolver still migrates and tags `renamed-from`. Per canonical key the variable's chunks win over the file's: every chunk of a source for that key is kept, in order (the resolver applies its own within-source rules — Ruling, SDD ledger), and the variable having the key drops all of the file's chunks for it. Exception: for a `type: 'map'` key present in both, when the variable's chunks for it (joined) do not parse (`express-driver-models` → `parseDriverModels(…).ok === false`; `model-profiles` → `modelProfilesEntry(…).invalid === true`) **and** the file's do, the variable's chunks are dropped, the file's win, and the block warning line is pushed. `raw` = winning chunks joined with `\n` (variable-order first, then file-only keys in file order) plus a trailing `\n`; `origin` names the sources that supplied winning chunks (`env`, `file` or `env+file`), and a single contributing source's text is returned verbatim.
- File ENOENT (including a dangling symlink) → absent, silent. Any other error code (EISDIR, EACCES) → absent plus the could-not-read warning with that code. A symlink to a readable file is read.
- `risk-path-globs` is never dropped here: the reader cannot see `policy.yml`'s `risk-categories`, so the variable's block always wins over the file's and Task 3 validates its rows against the resolved categories.
- Refusal is not applied here — `raw` carries refused keys; Task 2 refuses them.

- [ ] **Step 1: Write the failing tests** in `tests/bin-lib/policy-factory.test.js` (temp dirs via `fs.mkdtempSync(os.tmpdir())`, homeDir injected as `() => dir`):
  - `env only: raw is the variable verbatim, origin env` — `env: { CLAUDE_TWEAKS_FACTORY_POLICY: 'model-stance: economy' }`, no file → `{ raw: 'model-stance: economy', origin: 'env', warnings: [] }`.
  - `file only: raw is the file verbatim, origin file`.
  - `whitespace-only variable counts as absent` (`'  \n '`) → `origin: null` with no file; `origin: 'file'` with a file.
  - `env wins per flat key, file-only keys kept` — env `model-stance: economy`, file `model-stance: max-rigor\nautonomy: trusted\n` → `parseFlatLines(raw)` deep-equals `{ 'model-stance': 'economy', autonomy: 'trusted' }`, origin `env+file`.
  - `whole block key in the variable replaces the file's` — both carry `express-driver-models:` blocks (valid) → only the variable's rows appear in `parseDriverModels(raw).value`.
  - `alias in the file and new name in the variable merge as one key` — file `automerge-max-lines: 10`, env `auto-merge-max-lines: 20` → `raw` contains `auto-merge-max-lines: 20` and not `automerge-max-lines`.
  - `malformed variable block is dropped for the file's, with the warning` — env `express-driver-models:\n  bogus: fast\n`, file valid block → `parseDriverModels(raw).ok === true` with the file's rows, `warnings` equals `['resolve-policy: warning: express-driver-models has invalid value "express-driver-models:" in CLAUDE_TWEAKS_FACTORY_POLICY — using ~/.claude-tweaks/factory-policy.yml\'s block\n']`.
  - `directory at the file path: absent plus one could-not-read warning` (AC7) — `warnings` deep-equals `['resolve-policy: warning: could not read ~/.claude-tweaks/factory-policy.yml (EISDIR) — factory file ignored\n']`, no throw.
  - `dangling symlink reads as absent, silent`; `symlink to a readable file is read` (skip both on win32 when `fs.symlinkSync` throws EPERM).
  - `no homeDir function: home comes from env.HOME, then env.USERPROFILE; neither → no read` (assert via an injected `readFile` that records paths).
  - `CRLF factory text resolves like policy.yml` — `resolvePolicyKeys(['model-stance'], { factoryRaw: readFactoryPolicy({ env: { CLAUDE_TWEAKS_FACTORY_POLICY: 'model-stance: economy # note\r\n' } }).raw })` — written now, goes green in Task 2.
  - `splitTopLevelChunks`: `'# lead\na: 1\nb:\n  x: y\n\n"c": 2\n'` → keys `['a','b','c']`, `b`'s text `'b:\n  x: y\n'`.

- [ ] **Step 2: Run test to verify it fails**
  Run: `node --test tests/bin-lib/policy-factory.test.js`
  Expected: FAIL — `Cannot find module '../../plugin/bin/lib/policy-factory'`.

- [ ] **Step 3: Implement** `plugin/bin/lib/policy-factory.js` per Interfaces/Rules; add `riskAllowedSlugs` to `policy-schema.js`'s `module.exports`. Header comment names #6006, the precedence slot, and that only this module reads the variable or the file.

- [ ] **Step 4: Run** `node --test tests/bin-lib/policy-factory.test.js` — Expected: PASS except the CRLF test (needs Task 2's `factoryRaw`).

- [ ] **Step 5: Commit** — `git add plugin/bin/lib/policy-factory.js plugin/bin/lib/policy-schema.js tests/bin-lib/policy-factory.test.js` then `git commit -m "Add the factory policy reader — env variable over user file, merged per key (#6006)"`.

### Task 2: Third source in `resolvePolicyKeys` (flat keys, derived defaults, refusal)

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/policy-schema.js:604-845` (`resolvePolicyKeys` + its header comment's `source` enum), `:1042-1049` (`resolveIntegrationModel`)
- Test: `tests/resolve-policy-factory.test.js` (new; library section)

**Interfaces:**
- Consumes: `FACTORY_REFUSED_KEYS`, `readFactoryPolicy` (Task 1), lazily required.
- Produces: `resolvePolicyKeys(keys, { policyRaw, runConfigRaw, factoryRaw, onInvalid })` — `factoryRaw` string|null; entry `source` gains `'factory'`. `resolveIntegrationModel(repoRoot, opts)` honours `opts.env` (default `process.env`) and `opts.homeDir` for the factory read.

Rules:
- The `sources` array becomes `[run-config, policy, factory]`, factory parsed and alias-normalized by the same `.map` body. `policyOnly` skips only `run-config`, so factory applies to `policyOnly` keys (AC12).
- A canonical key in `FACTORY_REFUSED_KEYS`: before the per-source loop, if the factory source holds it, call `onInvalid(requested, thatRaw)` and skip the factory source for this key; the entry resolves exactly as with no factory layer (AC11).
- `deriveHousekeepingAutoMerge` / `deriveExpressDriverMaxLines` already walk `sources`; they now see factory (AC8). Derived entries keep `source: 'default'` (invariant 3 of the comment above them — unchanged).
- An invalid policy value still resolves `default` + `invalid: true`, never the factory value (no cascade); an invalid factory value with no repo value resolves default + `invalid: true` + `onInvalid` (AC3).
- `resolveIntegrationModel`: pass `factoryRaw: readFactoryPolicy({ env: opts.env || process.env, homeDir: opts.homeDir }).raw`; its `source !== 'default'` early return then treats a factory pin as explicit. Comment the line.

- [ ] **Step 1: Write the failing tests** in `tests/resolve-policy-factory.test.js`, section `resolvePolicyKeys`, IDs in names:
  - `AC1.1: factory value resolves with source factory` — `factoryRaw: 'model-stance: economy\n'`, no policy → `{ value: 'economy', source: 'factory' }`.
  - `AC1.2: policy.yml beats factory` — policy `model-stance: max-rigor` → `{ value: 'max-rigor', source: 'policy' }`.
  - `AC1.3: run-config beats both` — run config `model-stance: default` → `source: 'run-config'`.
  - `AC3.1: invalid factory value resolves default, invalid, onInvalid` — `factoryRaw: 'model-stance: nonsense\n'` → entry `{ value: <schema default>, source: 'default', invalid: true }` and `onInvalid` called with `('model-stance', 'nonsense')`.
  - `invalid policy value does not cascade to factory` — policy `model-stance: bogus`, factory `economy` → `source: 'default', invalid: true`.
  - `AC8.2: factory-only autonomy trusted derives housekeeping-auto-merge true` — `{ value: true, source: 'default' }`.
  - `AC11.1-3: refused keys resolve as with no factory layer` — for each of `merge-authorization: pre-authorized`, `control-mode: on`, `deploy-command: echo hi`, `release-hook: echo hi`: entry deep-equals `resolvePolicyKeys([k], {})[k]` and `onInvalid` called once with that key.
  - `refused key beside a legal key: legal key applies` — `factoryRaw: 'control-mode: on\nmodel-stance: economy\n'`.
  - `AC12.1: owned-owners from the factory layer only` — `factoryRaw: 'owned-owners: acme\n'` → `{ value: 'acme', source: 'factory' }` (the list key's resolved shape is the raw string; assert against `resolvePolicyKeys(['owned-owners'], { policyRaw: 'owned-owners: acme\n' })`'s value with `source` swapped).
  - `renamed alias in factory text tags renamed-from` — `factoryRaw: 'automerge-max-lines: 12\n'` → `{ value: 12, source: 'factory', 'renamed-from': 'automerge-max-lines' }`.
  - `resolveIntegrationModel honours a factory pin without detection` — temp non-repo root, `opts.env: { CLAUDE_TWEAKS_FACTORY_POLICY: 'integration-model: local-merge' }`, `opts.homeDir: () => emptyDir` → `'local-merge'`.

- [ ] **Step 2: Run test to verify it fails**
  Run: `node --test tests/resolve-policy-factory.test.js`
  Expected: FAIL — entries resolve `source: 'default'`, not `'factory'`.

- [ ] **Step 3: Implement** per Rules. Update the `resolvePolicyKeys` header comment: enum `"run-config" | "policy" | "factory" | "default"`, precedence line, and that `factory` is an explicit value like `policy`.

- [ ] **Step 4: Run** `node --test tests/resolve-policy-factory.test.js tests/bin-lib/policy-factory.test.js tests/resolve-policy-lib.test.js tests/policy-schema.test.js` — Expected: PASS.

- [ ] **Step 5: Commit** — `git commit -m "Resolve the factory layer as a third source below policy.yml (#6006)"` with the touched files added by path.

### Task 3: Per-row block-key merge

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/policy-schema.js` (`risk-path-globs` and `express-driver-models` branches in `resolvePolicyKeys`)
- Modify: `plugin/bin/lib/model-profiles/policy-fragment.js` (`modelProfilesEntry`)
- Test: `tests/resolve-policy-factory.test.js` (block section)

**Interfaces:**
- Produces: `modelProfilesEntry(policyRaw, factoryRaw = null)` — same return shape. Every existing one-argument caller (`resolve-policy.js`, `plugin/bin/lib/express/policy.js`) keeps its result when `factoryRaw` is null.

Rules (all three keys; "repo side" = parsed from `policyRaw`, "factory side" = parsed from `factoryRaw`):
- Rows merge repo row over factory row: `express-driver-models` per role (`{ ...POLICY_DRIVER_DEFAULTS, ...factoryRows, ...repoRows }`), `risk-path-globs` per category, `model-profiles` per profile (a whole profile row, not per field).
- `source`: `'factory'` when every configured row came from the factory side, `'policy'` otherwise.
- Factory side malformed → `onInvalid(key, factoryParsed.raw)` (policy-fragment: no onInvalid — just ignore the factory side), result from the repo side as today (never drops repo rows, no `invalid` flag when the repo side resolved).
- Repo side absent or malformed, factory side valid → factory rows, `source: 'factory'`; a malformed repo side still calls `onInvalid` with its raw.
- Both malformed, **or repo side absent and factory side malformed** → today's invalid shape (`null`, `source: 'default'`, `invalid: true`) with `onInvalid(key, factoryParsed.raw)` (for `model-profiles`: `{ value: null, source: 'default', invalid: true }`), matching AC3's flat-key rule. Neither present → today's unset shape.
- `risk-path-globs` allowed slugs for both sides: `riskAllowedSlugs` over the resolved `risk-categories` text — `policyRaw` if it holds a valid `risk-categories`, else `factoryRaw`'s (unchanged when factoryRaw is null).

- [ ] **Step 1: Write the failing tests** (block section):
  - `AC4.1: express-driver-models merges per role` — factory `express-driver-models:\n  implementer: fast\n  reviewer: capable\n`, policy `express-driver-models:\n  reviewer: standard\n` → `value.implementer === 'fast'`, `value.reviewer === 'standard'`, `source === 'policy'`.
  - `express-driver-models from factory only reports source factory`.
  - `AC4.2: model-profiles keeps a factory profile and a repo profile` — factory profile `fast` with `model: haiku`, repo profile `capable` with `effort: high` → `modelProfilesEntry(policyRaw, factoryRaw).value` has both keys, `source: 'policy'`.
  - `risk-path-globs merges per category` and `malformed factory block never drops repo rows` (repo `migrations: [db/**]`, factory malformed → repo value, `source: 'policy'`, `onInvalid` called with `risk-path-globs`).
  - `malformed repo block resolves from factory rows` → `source: 'factory'`, no `invalid`.
  - `malformed factory block with no repo block resolves invalid` — each of the three keys → `invalid: true`, `onInvalid` called (not the silent unset shape).
  - `factory risk-path-globs row naming a category defined only in policy.yml is accepted` — policy `risk-categories: payments`, factory `risk-path-globs:\n  payments: [src/pay/**]\n` → `value.payments` deep-equals `['src/pay/**']`, `source: 'factory'`; and through `readFactoryPolicy` with the same block in both the variable and the file, the variable's block is kept (no drop warning).
  - `AC10.1: a variable with an indented block resolves both rows` — `readFactoryPolicy({ env: { CLAUDE_TWEAKS_FACTORY_POLICY: 'express-driver-models:\n  implementer: fast\n  reviewer: capable' } }).raw` fed as `factoryRaw` → both roles set.
  - `modelProfilesEntry(policyRaw) one-argument result unchanged` for a valid, a malformed and an absent block.

- [ ] **Step 2: Run test to verify it fails**
  Run: `node --test tests/resolve-policy-factory.test.js`
  Expected: FAIL — the block tests resolve the repository side only.

- [ ] **Step 3: Implement** per Rules; keep each branch's existing comment and add one line naming the row merge.

- [ ] **Step 4: Run** `node --test tests/resolve-policy-factory.test.js tests/resolve-policy-lib.test.js tests/bin-lib/model-profiles/*.test.js tests/policy-schema.test.js` — Expected: PASS.

- [ ] **Step 5: Commit** — `git commit -m "Merge factory block-key rows under the repository's, per row (#6006)"`.

### Task 4: Wire the layer through `resolvePolicyConfig`, `resolvePolicy`, the CLI, the manifest and the runner

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/policy-schema.js:1050-1082` (`resolvePolicyConfig`)
- Modify: `plugin/bin/resolve-policy.js` (`resolvePolicy`, `warningLines`, header comment)
- Modify: `plugin/bin/lib/hooks/pre-tool-use.js:854` (`readConsoleCeiling` passes `env`), `:1791` (`resolveRunPinnedIntegrationModel` passes `opts.env`, `opts.homeDir`)
- Modify: `plugin/bin/lib/express/policy.js:39-42` (take `factoryRaw` from `resolvePolicyConfig`'s return and call `modelProfilesEntry(policyRaw, factoryRaw)`, so one express run reads one policy)
- Modify: `tools/run-tests.js:751-753` (`runnerChildEnv` drops `CLAUDE_TWEAKS_FACTORY_POLICY`)
- Test: `tests/resolve-policy-factory.test.js` (CLI section), `tests/bin-lib/run-manifest/facts.test.js`, `tests/run-tests-isolation.test.js`
- Waived plugin/skills/_shared/policy-schema.md: never edited — 51,537 B against the rail; Task 6 documents the layer in policy-schema-read-path.md instead.
- Waived plugin/bin/lib/skill-audit/budgets.js: read only, for `RAIL_BYTES` in Task 6 Step 3's size check.
- Waived .claude/skills/gh-api-module-pattern/cli-wrapper-contract.md: read only; its stderr-through-`warningLines` rule is quoted in Global Constraints and applied in this task's Step 3.
- Note on `plugin/bin/lib/run-manifest/facts.js`: Step 1's AC6/AC9 tests read it; AC9 currently holds through `gatherFacts`'s `env = process.env` default (`initRunManifest` at `run-dir-resolve.js:338` passes no `env`). Modify only if the AC9 test goes red.

**Interfaces:**
- Consumes: `readFactoryPolicy` (Task 1), `resolvePolicyKeys` `factoryRaw` (Task 2), `modelProfilesEntry(policyRaw, factoryRaw)` (Task 3).
- Produces: `resolvePolicyConfig({ git, readFile, runDir, keys, onInvalid, cwd, env, homeDir })` → adds `factoryRaw`, `factoryOrigin`, `factoryWarnings` to its return. `env` defaults to `process.env` (hook rule 2); `homeDir` optional; an optional `factoryReadFile` (throwing reader, Task 1's contract) defaults to Task 1's `fs.readFileSync` default. The factory read **never** uses the caller's `readFile`: `resolve-policy.js`'s `readFileSafe` (and `policy-schema.js:428`'s) swallows every error, so EISDIR would read as absent and AC7's warning would never fire. `resolvePolicy` passes `deps.factoryReadFile` through when present. `resolvePolicy(...)` returns `factoryOrigin`, `factoryWarnings`, `factoryRefused` (requested keys in `FACTORY_REFUSED_KEYS` present in `parseFlatLines(factoryRaw)`), passing `env: deps.env, homeDir: deps.homeDir`. `warningLines` order: main-checkout note, factory reader warnings, refused-key warnings, factory note, degraded lines, `--values` invalid lines.

- [ ] **Step 1: Write the failing tests:**
  - CLI section of `tests/resolve-policy-factory.test.js`, in-process via `run(argv, deps)` with a temp git repo (`tests/resolve-policy-entry.test.js`'s fixture pattern) and `deps = { ...realDeps, cwd: () => repo, env: { ...ENV, CLAUDE_TWEAKS_FACTORY_POLICY: … }, homeDir: () => home, stdout, stderr }` capturing output:
    - `AC1: CLI prints the factory envelope` — `run(['model-stance'])` stdout `{"model-stance":{"value":"economy","source":"factory"}}\n`, stderr contains `resolve-policy: note — factory layer (env) supplied model-stance\n`; the two repo/run-config cases print `max-rigor`/`policy` and `default`/`run-config` (with `--run`) and no note line.
    - `AC2.1: the same three cases from factory-policy.yml under the injected home, no variable` — same stdout as AC1, note says `(file)`.
    - `AC2.2: both present and disagreeing, the variable wins` — variable `economy`, file `model-stance: max-rigor\nautonomy: trusted\n` → `economy`; requesting `model-stance,autonomy` the note says `(env+file)` (the file supplies a winning chunk for `autonomy`), and requesting `model-stance` alone with a file holding only `model-stance: max-rigor` the note says `(env)` (origin names contributing sources — Task 1 fix round 1).
    - `AC3.2: --values names the invalid factory value` — stderr contains `resolve-policy: warning: model-stance has invalid value "nonsense" — using default "default"\n`.
    - `AC5.1: --all is byte-identical with no variable and no file` — `run(['--all'])` stdout compared against the same call with `deps.env` minus the variable and `homeDir` pointing at an empty dir, and against the parsed `resolvePolicyKeys`-only expectation: every `source` in `run-config | policy | default`.
    - `AC7.1, AC7.2: unreadable factory file resolves as absent, one warning line, nothing throws, exit 0`.
    - `AC11: refused keys warn once each, in JSON mode and --values mode`.
    - `factoryOrigin never appears on stdout`.
  - `tests/bin-lib/express/policy.test.js`: `express policy merges a factory model-profiles row` — injected env carries a `model-profiles` block → the express policy's `model-profiles` value holds the factory profile.
  - `tests/bin-lib/run-manifest/facts.test.js`:
    - `AC6.1: a factory-set hashed key changes policyHash` — `gatherFacts({ cwd: repo, env: { ...base, CLAUDE_TWEAKS_FACTORY_POLICY: 'tidy-aggressiveness: aggressive' } })` vs without → hashes differ.
    - `AC9.1: driver mint records the policyHash resolvePolicy computes with the parent's variable` — `// real process: the criterion is about the minting process's own environment`: spawn `node -e` (one script file under the test's temp dir) that calls `require(runDirResolve).resolveRunDir({ cwd: repo, env: {}, specSlug: 'drive-1', create: true })` with `CLAUDE_TWEAKS_FACTORY_POLICY` set in the child env; compare the written `manifest.json`'s `policyHash` with in-process `gatherFacts({ cwd: repo, env: sameEnv }).policyHash`.
  - `tests/run-tests-isolation.test.js`: `runnerChildEnv drops CLAUDE_TWEAKS_FACTORY_POLICY` — input env carrying it → output has no such key.

- [ ] **Step 2: Run test to verify it fails**
  Run: `node --test tests/resolve-policy-factory.test.js tests/bin-lib/run-manifest/facts.test.js tests/run-tests-isolation.test.js`
  Expected: FAIL — the CLI prints `source: 'default'` and the runner keeps the variable.

- [ ] **Step 3: Implement** per Interfaces. `resolvePolicy` overwrites `model-profiles` with `modelProfilesEntry(policyRaw, factoryRaw)`. Header comment of `resolve-policy.js`: document the factory note, the refused-key and factory-read warning lines, and that every one writes in every mode.

- [ ] **Step 4: Run** `node --test tests/resolve-policy-factory.test.js tests/resolve-policy-*.test.js tests/bin-lib/run-manifest/*.test.js tests/run-tests-isolation.test.js tests/hooks-event-env-conformance.test.js` and the pre-tool-use suites `node --test tests/hooks-pre-tool-use*.test.js` — Expected: PASS, no tripwire report.

- [ ] **Step 5: Commit** — `git commit -m "Read the factory layer in resolvePolicyConfig and report it on stderr (#6006)"`.

### Task 5: Every `source` consumer

**Role:** judgment
**Review risk:** high

**Files** (each read; either a one-line comment saying why `factory` is handled correctly, or the named change; each gets a test whose entry comes from a real `resolvePolicyKeys(…, { factoryRaw })` reply, in that module's existing test file):
- Modify: `plugin/bin/lib/release-preflight/pack.js` — line 29, **change** `CONFIG_SOURCES` to `new Set(['policy', 'run-config', 'factory'])`: line 210 reads `integration-model` as the release engine only from a configured source, and a factory pin is configured (update the "Either config source counts" comment to name three).
- Modify: `plugin/bin/lib/driver/steps.js` — comment at lines 215 and 272 (`!== 'default'`: a factory value is explicit).
- Modify: `plugin/bin/lib/hooks/pre-tool-use.js` — comment at line 1796.
- Modify: `plugin/bin/lib/issues/autonomy.js` — comment at line 89.
- Modify: `plugin/bin/lib/policy-derived-defaults.js` — comments at lines 47 (`=== 'run-config'` reads the run overlay only), 78 and 95 (a factory pin is not `default`, so no forge detection).
- Modify: `plugin/bin/lib/flow/manifesto-write.js` — comment at lines 126/131/136 (the Source column shows `factory`).
- Modify: `plugin/bin/lib/release-tip/check.js` — comment at line 105 (pass-through).
- Modify: `plugin/bin/lib/driver/merge.js` — comment at line 175 (pass-through to the event line).
- Modify: `plugin/bin/lib/flow/preflight.js` — comment at line 286 (pass-through into `preflight.json`).
- Modify: `plugin/bin/lib/policy-schema.js` — comment at line 839 (`policySourceExcluded` compares `'policy'`; `merge-authorization` is factory-refused, so no factory value reaches it).
- Modify: `plugin/bin/lib/compose-context/resolve-conditions.js` — comment at line 57 only, no test (`factoryRaw` is not passed until #6007).
- Modify: `plugin/bin/accept-park.js` — comment at lines 506 and 515 only, no test (same reason).
- Re-derive before closing the task: `git grep -nP "\.source\b|\bsource:" -- plugin/bin` and `git grep -nE "source ?(===|!==) ?'(policy|default|run-config)'" -- plugin/bin`; add any policy-entry consumer not listed above. #5963 (symlink refusal) and #4685 (base-branch trust keys) are open and not in the tree: no site treats `'policy'` as proof of repository origin today — record that ruling in the Task 6 doc paragraph.

- [ ] **Step 1: Write the tests**, each entry from a real `resolvePolicyKeys(…, { factoryRaw })` reply, in the module's existing test file:
  - `release-preflight: a factory integration-model pin is a configured engine` (fails before Step 3).
  - `AC8.1: factory-only autonomy trusted is an explicit ceiling` — `effectiveCeiling({ autonomyEntry: resolvePolicyKeys(['autonomy'], { factoryRaw: 'autonomy: trusted\n' }).autonomy }).source === 'explicit'`.
  - `factory integration-model pin runs no forge detection` — `computeDerivedDefaults` with an injected detection stub that throws.
  - `driver steps: a factory express-driver-max-lines bound is explicit` (steps.js:215) and `a factory reviewer model is used` (steps.js:272).
  - `manifesto-write: a factory lever renders Source factory`.
- [ ] **Step 2: Run the release-preflight test**
  Run: `node --test tests/bin-lib/release-preflight/pack.test.js`
  Expected: FAIL — the factory pin resolves `engine unresolved`.
- [ ] **Step 3: Implement** the `CONFIG_SOURCES` change and the comments.
- [ ] **Step 4: Run** every touched module's test file — Expected: PASS.
- [ ] **Step 5: Commit** — `git commit -m "Treat a factory value as explicit at every source consumer (#6006)"`.

Proof(auth): FACTORY_REFUSED_KEYS keeps merge-authorization, control-mode, deploy-command and release-hook out of the factory layer (AC11 tests in Task 2 and Task 4), autonomy and the trust lists come only from the factory's own environment or the user's home file — never from pull-request content — and refuse/precedence tests pin repository-over-factory for every key.
Proof(public-contract): the resolver envelope's source enum widens by one value, 'factory'; AC5.1 pins --all byte-identical with no variable and no file, Task 5 updates every consumer that branches on source (CONFIG_SOURCES gains 'factory'), and Task 6 documents the value in every prose enum.

### Task 6: Documentation

**Role:** integration

**Files:**
- Modify: `plugin/skills/_shared/policy-schema-read-path.md` (9,786 B; headroom ~42.7 KB to the 52,500 B rail) — line 9's enum and precedence, plus a new `## Factory layer` section: variable and file names, env-over-file merge per key (whole block from the variable), new precedence, `source: 'factory'` is explicit like `policy`, per-row block merge and its source rule, the four refused keys and why (the spec's three reasons verbatim, plus `release-hook`: "an executed string specific to one repository", decided at plan review), the stderr lines, that `.claude-tweaks/policy.yml` stays the only repository config home, and the #5963/#4685 ruling from Task 5.
- Modify: `plugin/skills/_shared/auto-decision-log.md:126` (`run-config | policy | factory | default`), `plugin/skills/_shared/auto-mode-contract.md:63` (47,704 B; +11 B stays under the rail), `plugin/skills/flow/manifesto.md:80` (pack source enum) and its `## Source values` table (new row: `` | `factory` | From the factory layer — `CLAUDE_TWEAKS_FACTORY_POLICY` or `~/.claude-tweaks/factory-policy.yml` (resolver envelope `source: "factory"`) | ``).
- Modify: `docs/plugin-structure.md` — one `plugin/bin/lib/policy-factory.js` line beside `policy-file.js` (line 145).
- Never `plugin/skills/_shared/policy-schema.md` (51,537 B against the rail).

- [ ] **Step 1: Pin check** — `git grep -n -F "run-config | policy | default" -- tests plugin` and `git grep -n -F "No other source words" -- tests`; any test hit is re-pointed in this task. (At plan time: no test pins either phrase.)
- [ ] **Step 2: Edit** the files above.
- [ ] **Step 3: Run** `node --test tests/skill-*.test.js tests/bin-lib/skill-audit/*.test.js tests/policy-*.test.js` — Expected: PASS; `wc -c` each edited skill file is under 52,500.
- [ ] **Step 4: Commit** — `git commit -m "Document the factory policy layer (#6006)"`.
