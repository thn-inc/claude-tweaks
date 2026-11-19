# Run Manifest Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Write a `manifest.json` into every pipeline run directory claude-tweaks mints, so dispatch's factory floor can copy the plugin version, lane, ceremony profile, policy hash, base commit and model profile into each station visit.

**Architecture:** One new module family, `plugin/bin/lib/run-manifest/`, owns the format. `facts.js` gathers the mint-time facts (each independently, each best-effort); `write.js` exports `initRunManifest` (mint, never overwrites) and `fillRunManifest` (fill-only-null, with the `ceremonyProfile` exception). The mint chokepoint `resolve()` in `run-dir-resolve.js` calls init at its two creating branches; the Manifesto (`lane`), `setConfigLever` (`ceremonyProfile`), the express `gate` verb and the driver's `adoptRun` (`lane`) call fill. Every call is best-effort and never changes a caller's outcome.

**Tech Stack:** Node 18+ (CommonJS, no dependencies), `node --test`, `node:crypto` for the hash, `plugin/bin/lib/atomic-write.js` for writes.

**Spec:** `.claude-tweaks/pipelines/2026-11-19T073130-spec-5903/work/5903-spec.md` (record #5903; the record body is the spec — read it first). Design context: thn-inc/dispatch `docs/superpowers/specs/2026-11-18-factory-floor-design.md`, Phase 3.

Scope keywords: run-manifest, initRunManifest, fillRunManifest

## Global Constraints

- File `{run-dir}/manifest.json`, one JSON object, version `v: 1`, keys sorted at every nesting level, two-space indentation, trailing newline. Fields are only ever added, never renamed or retyped; a reader ignores unknown fields.
- Fields: `v`, `runId` (run directory basename), `createdAt` (ISO-8601 UTC, first write), `pluginVersion` (string or `null`), `lane` (`standard | express | driver | unknown`), `ceremonyProfile` (`fast-lane | standard | null`), `policyHash` (`"sha256:" + hex` or `null`), `baseCommit` (40-hex or `null`), `modelProfile` (`{ "stance": "economy|default|max-rigor", "ceiling": "<profile name>|null" }` or `null`).
- `policyHash` is over canonical JSON (keys sorted, no whitespace) of `{key: resolved value}` for every `POLICY_KEYS` entry except `integration-model` and `merge-verification`, with no per-run `config.yml` overlay. No `gh` call anywhere at mint.
- Never throws, never changes a caller's outcome: a failed write is dropped with one stderr line. `resolve-run-dir` still prints only the directory path on stdout with unchanged exit codes.
- `manifest.json` is not run initialization: `resolveRunArg`'s initialized check (`decisions.md` / `run-state.json` / `config.yml`) and the orphaned-mint sweep keep reading only the files they read today.
- The new module lives only under `plugin/bin/lib/run-manifest/`. Never reuse `manifest.yml`, `plugin/bin/lib/flow/manifest.js`, or `plugin/bin/acceptance-packet.js`'s unrelated `manifest.json`.
- No skill instruction writes the file: `git grep -n "manifest\.json" -- plugin/skills` must match none.
- Minimal footprint in `plugin/bin/lib/hooks/run-dir-resolve.js` (a parallel session, #5902, may touch it): one helper line plus two call lines, no restructuring.
- New tests live beside their neighbours: `tests/bin-lib/run-manifest/*.test.js`, plus the existing files named per task. A test that asserts a path uses `path.join`, never a hard-coded `/`.
- Commit messages: `{Verb} {what} — {detail}`, ending with the line `Claude-Session: https://claude.ai/code/session_01JHXvgYA9d1NStH4hi5YENq`. Stage specific files only, never `git add -A`.
- Single test files run as `node --test <file>`; the full suite is run centrally, not by implementers.

## Review Focus

- A fill aimed at a run directory that no longer exists (archived or reaped mid-run) must not recreate the directory; it drops the write with one stderr line. Pinned in Task 2.
- An existing `manifest.json` that is corrupt, empty, or not a JSON object is never overwritten by fill or init. Pinned in Task 2.
- A manifest written by a newer version (`v: 2`, extra unknown fields) keeps both through a fill; `v` is never downgraded. Pinned in Task 2.
- Two fills of different fields in sequence (Manifesto lane, then set-config ceremony) both survive; neither read-modify-write drops the other's field. Pinned in Task 2.
- An out-of-vocabulary `lane` or `ceremonyProfile` passed to fill is ignored, never written. Pinned in Task 2.

---

### Task 1: Fact gatherers (`facts.js`)

**Files:**
- Create: `plugin/bin/lib/run-manifest/facts.js`
- Test: `tests/bin-lib/run-manifest/facts.test.js`

**Interfaces:**
- Consumes: `resolvePolicy`, `callerDeps` from `plugin/bin/resolve-policy.js`; `POLICY_KEYS` from `plugin/bin/lib/policy-schema.js`; `resolvePluginVersion(env)` from `plugin/bin/lib/plugin-version.js`; `runGit(cwd, args, opts)`-style wrapper from `plugin/bin/lib/hooks/git-exec.js` (read its real signature first: it returns `{ stdout, failure }`); `mainCheckoutRoot(cwd)` from `plugin/bin/lib/hooks/worktree-detect.js`.
- Produces: `FORGE_DERIVED_POLICY_KEYS` (frozen `['integration-model', 'merge-verification']`, the one constant to edit if a key's resolution ever gains a network probe); `canonicalJson(value) -> string`; `gatherFacts({ cwd, env }, deps?) -> { pluginVersion: string|null, policyHash: string|null, baseCommit: string|null, modelProfile: {stance, ceiling}|null }` — each field computed independently inside its own try/catch, never throws.

- [ ] **Step 1: Write the failing tests** in `tests/bin-lib/run-manifest/facts.test.js`, using `gitRepo()` from `tests/helpers/git-fixtures.js` for a real repo with a `.claude-tweaks/policy.yml` written per case:
  - `policyHash starts sha256: and is 64 hex after the prefix`.
  - `two policies resolving to the same values hash equal` (one writes `project-maturity: greenfield` explicitly, one omits it: the schema default is `greenfield`).
  - `changing project-maturity changes the hash`.
  - `changing only integration-model does not change the hash` (`integration-model: pr-first` vs `local-merge`).
  - `canonicalJson sorts keys at every depth and emits no whitespace`.
  - `pluginVersion is null with CLAUDE_PLUGIN_ROOT unset, and the string version with a fixture plugin.json`.
  - `policyHash is null when policy.yml exists but cannot be read` (inject `deps.readFile` that throws a non-ENOENT error for the policy path; the real `readFileSafe` swallows errors, so the gatherer passes its own reader that returns `null` on ENOENT and rethrows otherwise).
  - `baseCommit is the 40-hex tip of origin/<pinned integration-branch>` (fixture: bare remote clone with `refs/remotes/origin/main` and `integration-branch: main` pinned), `falls back to origin/HEAD when unpinned`, `is null with no remote refs`, `is null outside a git repo`.
  - `modelProfile reads model-stance and model-ceiling` (`{stance:'default', ceiling:null}` by default; pinned values come through).
  - `gatherFacts never throws and the other fields survive when one gatherer throws` (inject a throwing git dep).

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/bin-lib/run-manifest/facts.test.js`
Expected: FAIL with "Cannot find module '../../../plugin/bin/lib/run-manifest/facts'"

- [ ] **Step 3: Implement `gatherFacts` and helpers in `plugin/bin/lib/run-manifest/facts.js`.** One `resolvePolicy({ keys }, deps)` call (`keys` = every `POLICY_KEYS` key not in `FORGE_DERIVED_POLICY_KEYS`, plus `model-stance`/`model-ceiling` are already in that list) feeds `policyHash` (sha256 over `canonicalJson` of `{key: entry.value ?? null}`), `modelProfile` and the `integration-branch` value for `baseCommit`. A non-zero `code` or a throw → `policyHash` and `modelProfile` both `null`. Policy is read from `deps.cwd` (the caller's checkout, so a worktree-local policy is honoured like every other resolve), via `callerDeps`-shaped deps with the ENOENT-tolerant reader. `baseCommit`: git in the main checkout (`mainCheckoutRoot(cwd)`), pinned branch → `rev-parse --verify --quiet refs/remotes/origin/{name}^{commit}`, else `symbolic-ref --quiet refs/remotes/origin/HEAD` then rev-parse that ref; accept only `/^[0-9a-f]{40}$/`, else `null`. Probe first (one scratch call) that listing the `map`-type keys (`model-profiles`, `risk-path-globs`) in `keys` does not make `resolvePolicy` error; if one does, hash it as `null` rather than dropping it from the key list.

- [ ] **Step 4: Run to verify it passes**

Run: `node --test tests/bin-lib/run-manifest/facts.test.js`
Expected: PASS, all tests listed in Step 1.

- [ ] **Step 5: Prove the exclusion test discriminates.** Temporarily change `FORGE_DERIVED_POLICY_KEYS` to `[]`, run the facts test, confirm `changing only integration-model does not change the hash` goes red, restore it, confirm green again.

- [ ] **Step 6: Commit**

```bash
git add plugin/bin/lib/run-manifest/facts.js tests/bin-lib/run-manifest/facts.test.js
git commit -m "Add run-manifest fact gatherers — plugin version, policy hash, base commit, model profile (refs #5903)"
```
(append the `Claude-Session:` trailer line to the message)

---

### Task 2: Manifest writer (`write.js`)

**Files:**
- Create: `plugin/bin/lib/run-manifest/write.js`
- Test: `tests/bin-lib/run-manifest/write.test.js`

**Interfaces:**
- Consumes: `gatherFacts`, `canonicalJson` from Task 1; `writeFileAtomic` from `plugin/bin/lib/atomic-write.js`.
- Produces:
  - `MANIFEST_FILE = 'manifest.json'`, `MANIFEST_VERSION = 1`, `LANES = ['standard','express','driver','unknown']`, `CEREMONY_PROFILES = ['fast-lane','standard']`.
  - `initRunManifest(runDir: string, facts: { lane?: string, cwd?: string, env?: object }, deps?) -> { written: boolean }`. Writes `{runDir}/manifest.json` atomically with `v:1`, `runId`, `createdAt`, gathered facts, `lane` (default `'unknown'`, vocabulary-checked), `ceremonyProfile: null`. Never overwrites an existing file; never throws.
  - `fillRunManifest(runDir: string, fields: { lane?, ceremonyProfile?, pluginVersion?, policyHash?, baseCommit?, modelProfile? }, deps?) -> { changed: string[] }`. Sets only fields currently `null` (and `lane` when it is `'unknown'`, since the mint writes `unknown` rather than `null`; the first known lane wins and a known lane is never overwritten), except `ceremonyProfile`, which is overwritten when the new value differs. Out-of-vocabulary `lane`/`ceremonyProfile` values are ignored. A missing manifest in an existing run directory is created by it with unknown fields `null` (facts gathered with `cwd = runDir`); a missing run directory is never created. Unknown fields and `v` in an existing file are preserved. A corrupt/non-object existing file is left untouched. Never throws.
  - `deps`: `{ gatherFacts, writeFileAtomic, readFileSync, existsSync, now, stderr }`, all defaulted, all injectable.

- [ ] **Step 1: Write the failing tests** in `tests/bin-lib/run-manifest/write.test.js` (temp dirs, `os.tmpdir()` + `fs.mkdtempSync`, cleaned in `test.after`):
  - `init writes the v1 file with exactly the documented key set` (assert `Object.keys` equals the sorted nine; `v === 1`; `runId === path.basename(dir)`; `createdAt` ISO; `lane === 'unknown'`; `ceremonyProfile === null`; trailing newline; two-space indent; keys sorted including nested `modelProfile`). Inject `gatherFacts` returning fixed facts.
  - `init with lane driver writes driver`; `init with an out-of-vocabulary lane writes unknown`.
  - `init never overwrites an existing manifest` (pre-existing bytes identical afterwards, `written:false`).
  - `init uses the atomic writer and leaves no tmp file`.
  - `init on a read-only directory returns written:false, throws nothing, and writes exactly one stderr line` (chmod `0o555`; skip on `win32` and when `process.getuid && process.getuid() === 0`).
  - `fill sets a null pluginVersion/policyHash/baseCommit/modelProfile and leaves a populated one`.
  - `fill replaces lane unknown with standard but never replaces driver or express`.
  - `fill overwrites ceremonyProfile when the value differs and changes no other field` (the downgrade case).
  - `fill ignores an out-of-vocabulary lane and ceremonyProfile`.
  - `fill creates a missing manifest in an existing run dir with unknown fields null` and `fill does not create a missing run dir` (no directory appears; one stderr line).
  - `fill leaves a corrupt manifest untouched` (garbage bytes, empty file, a JSON array) with one stderr line each.
  - `fill preserves v:2 and unknown fields` (file with `v:2, x:{a:1}`; fill lane; both survive).
  - `two sequential fills of different fields both survive`.
  - `a directory holding only manifest.json still has no decisions.md, run-state.json or config.yml` (plain `fs.existsSync` assertions on what `init` leaves behind).

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/bin-lib/run-manifest/write.test.js`
Expected: FAIL with "Cannot find module '../../../plugin/bin/lib/run-manifest/write'"

- [ ] **Step 3: Implement `initRunManifest` and `fillRunManifest` in `plugin/bin/lib/run-manifest/write.js`.** Serialise through `canonicalJson`-style sorted keys with `JSON.stringify(sorted, null, 2) + '\n'`. Read-modify-write via one `readFileSync` + one `writeFileAtomic`; wrap each public function in a single outer try/catch whose catch writes one `claude-tweaks: run-manifest: {message}\n` stderr line and returns the no-op result. `existsSync(runDir)` guards the missing-directory case before any write.

- [ ] **Step 4: Run to verify it passes**

Run: `node --test tests/bin-lib/run-manifest/write.test.js`
Expected: PASS, all tests listed in Step 1.

- [ ] **Step 5: Prove the key discriminators go red.** Temporarily (a) remove the `existsSync(runDir)` guard, (b) let fill overwrite non-null fields, run the file, confirm the matching tests fail (`fill does not create a missing run dir`, `fill sets only null…`), restore both, confirm green.

- [ ] **Step 6: Commit**

```bash
git add plugin/bin/lib/run-manifest/write.js tests/bin-lib/run-manifest/write.test.js
git commit -m "Add run-manifest writer — initRunManifest and fill-only-null fillRunManifest (refs #5903)"
```
(append the `Claude-Session:` trailer line)

---

### Task 3: Mint hook in `run-dir-resolve.js`

**Files:**
- Modify: `plugin/bin/lib/hooks/run-dir-resolve.js` (the two creating branches of `resolve()`, lines ~352 and ~371 at base; one helper line)
- Test: `tests/hooks-run-dir-resolve.test.js`
- Test: `tests/hooks-resolve-run-dir-cli.test.js`

**Interfaces:**
- Consumes: `initRunManifest(runDir, { lane, cwd, env })` from Task 2.
- Produces: no new exports. After the directory exists, both creating branches call the init helper: standalone → `lane: 'unknown'`; spec-slug → `'driver'` when `/^drive-\d+$/.test(opts.specSlug)` else `'unknown'`. A call that returns `created:false` writes nothing (the init calls sit only inside the creating branches).

- [ ] **Step 1: Write the failing tests.**
  - `tests/hooks-run-dir-resolve.test.js`: extend the mkdir-only mint test (near `mkdir-only mints a bare run directory`) so it still asserts no `decisions.md`/`staged` and now also asserts `manifest.json` exists with `v:1`, `runId` equal to the basename, `lane:'unknown'`, `ceremonyProfile:null`; add `--spec-slug drive-5 writes lane driver`; `standalone mint still pre-populates staged/ and decisions.md and writes lane unknown`; `re-resolving an existing run writes no manifest and leaves an existing one byte-identical` (resolution steps 1-2); `a manifest write failure does not change the resolve result` (`t.mock.method(fs, 'renameSync', ...)` throwing `EACCES` only when the source path ends in `manifest.json.tmp-<pid>` shape, `ok` stays true and `path` unchanged).
  - `tests/hooks-resolve-run-dir-cli.test.js`: add `--create stdout is exactly the directory path with the manifest present, exit 0` (stdout equals `dir + '\n'` and `manifest.json` exists beside it).

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/hooks-run-dir-resolve.test.js`
Expected: FAIL with an assertion that `manifest.json` does not exist.

- [ ] **Step 3: Add the hook.** In `resolve()` inside `if (opts.create) {`, define one helper `const mintManifest = (dir, lane) => require('../run-manifest/write').initRunManifest(dir, { lane, cwd, env });` (lazy require so hook hot paths that never mint do not load the policy resolver), call it right after `fs.mkdirSync(...)` / the `decisions.md` touch in the standalone branch and after `fs.mkdirSync(dir, { recursive: true })` in the spec-slug branch, before each `ok(dir, true)`. Update the spec-slug branch comment's "mkdir only" sentence to say it also writes `manifest.json`.

- [ ] **Step 4: Run to verify it passes**

Run: `node --test tests/hooks-run-dir-resolve.test.js`
Expected: PASS.
Run: `node --test tests/hooks-resolve-run-dir-cli.test.js`
Expected: PASS.

- [ ] **Step 5: Check the diff stays small.** `git diff --stat plugin/bin/lib/hooks/run-dir-resolve.js` shows a single-digit changed-line count (helper + two calls + one comment); a larger diff means restructuring that #5902 will conflict with.

- [ ] **Step 6: Commit**

```bash
git add plugin/bin/lib/hooks/run-dir-resolve.js tests/hooks-run-dir-resolve.test.js tests/hooks-resolve-run-dir-cli.test.js
git commit -m "Write manifest.json at the run-directory mint — both creating branches of resolve() (refs #5903)"
```
(append the `Claude-Session:` trailer line)

---

### Task 4: Pin that `manifest.json` is not run initialization

**Files:**
- Test: the existing test that asserts `not an initialized run dir` (find it with `grep -rln "not an initialized run dir" tests`)
- Test: the existing `classifyRunDir` orphaned-mint test (find it with `grep -rln "orphaned-mint" tests/bin-lib/reconcile tests`)
- Test: the existing `isUnadoptedMint` test (find it with `grep -rln "isUnadoptedMint" tests`)

**Interfaces:**
- Consumes: the three production behaviours named in the Global Constraints, unchanged. Produces: three regression pins, no production code.

- [ ] **Step 1: Write the pins**, each in its neighbour's style: a run directory holding only `manifest.json` (a) is rejected by `hooks.js`'s `resolveRunArg` with the `not an initialized run dir` message; (b) classifies `orphaned-mint` once older than `ORPHAN_MINT_TTL_MS` (back-date the directory mtime with `fs.utimesSync`; note `isStaleDir`'s mtime source — read it first); (c) `isUnadoptedMint(dir, null)` is `true`.

- [ ] **Step 2: Run to verify they pass** (they pin existing behaviour; "red" is not expected on current code)

Run each located file with `node --test <file>`.
Expected: PASS.

- [ ] **Step 3: Prove each pin discriminates.** For (a), temporarily add `manifest.json` to the initialized-file list in `plugin/bin/hooks.js` near line 624; for (b), temporarily make the orphaned-mint condition also require `!fs.existsSync(path.join(dir, 'manifest.json'))`; for (c), temporarily treat a present `manifest.json` as adopted in `isUnadoptedMint`. Each mutation must turn its pin red; restore all three and confirm green. Verify with `git diff` that no production file remains modified.

- [ ] **Step 4: Commit**

```bash
git add <the three located test files>
git commit -m "Pin manifest.json as not run initialization — resolveRunArg, orphaned-mint, unadopted-mint (refs #5903)"
```
(append the `Claude-Session:` trailer line)

---

### Task 5: Fill hooks — set-config `ceremonyProfile` and the Manifesto `lane`

**Files:**
- Modify: `plugin/bin/lib/set-config/write.js` (`setConfigLever`, after the config.yml write)
- Modify: `plugin/bin/lib/flow/manifesto-write.js` (`writeManifesto`, after the lever loop)
- Test: `tests/bin-lib/set-config/write.test.js` (locate with `ls tests/bin-lib/set-config` or `grep -rln setConfigLever tests`; create beside neighbours only if no suite exists)
- Test: `tests/bin-lib/flow/manifesto-write.test.js`

**Interfaces:**
- Consumes: `fillRunManifest` from Task 2.
- Produces: `setConfigLever({ runDir, key, value })` additionally calls `fillRunManifest(runDir, { ceremonyProfile: value })` when `key === 'ceremony-profile'` and the write succeeded; `writeManifesto` additionally calls `fillRunManifest(runDir, { lane: 'standard' })` after it writes `config.yml`. `writeManifesto` already writes `ceremony-profile` through `setConfigLever`, so the Manifesto's `ceremonyProfile` arrives through the set-config hook; the Manifesto fills only `lane`. Neither return value nor thrown errors change.

- [ ] **Step 1: Write the failing tests.**
  - set-config: `setting ceremony-profile fills manifest ceremonyProfile`, `a later ceremony-profile change overwrites ceremonyProfile and changes no other field`, `setting another key leaves manifest.json untouched`, `a fill failure does not change the set-config result` (inject/mock a throwing writer).
  - manifesto-write (real set-config, real run dir from the existing `fixture()`; seed `manifest.json` via `initRunManifest`): after `writeManifesto` the manifest has `ceremonyProfile` equal to the `ceremony-profile` lever and `lane: 'standard'`; with no pre-existing manifest it is created with the rest `null`; an express/driver-known lane is not overwritten.

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/bin-lib/flow/manifesto-write.test.js`
Expected: FAIL after Step 1 (the manifest has no `lane: 'standard'`; the file passes today because the new tests are appended in Step 1).

- [ ] **Step 3: Add the two fill calls.** In `setConfigLever`, after `fs.writeFileSync(file, ...)`: a guarded one-liner calling `require('../run-manifest/write').fillRunManifest(runDir, { ceremonyProfile: value })` when `key === 'ceremony-profile'` (lazy require keeps `setConfigLever`'s callers light). In `writeManifesto`, after the `try { for (...) set(...) }` block succeeds, one `fillRunManifest(runDir, { lane: 'standard' })`. A `deps`-injected `setConfigLever` stub in existing tests must keep passing untouched.

- [ ] **Step 4: Run to verify they pass**

Run: `node --test tests/bin-lib/flow/manifesto-write.test.js`
Expected: PASS. Then run the located set-config test file with `node --test`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/set-config/write.js plugin/bin/lib/flow/manifesto-write.js tests/bin-lib/flow/manifesto-write.test.js <set-config test file>
git commit -m "Fill manifest ceremonyProfile from set-config and lane from the Manifesto (refs #5903)"
```
(append the `Claude-Session:` trailer line)

---

### Task 6: Fill hooks — express `gate` lane and driver `adoptRun` lane

**Files:**
- Modify: `plugin/bin/lib/express/cli.js` (`runGate`, after the verdicts are computed)
- Modify: `plugin/bin/lib/driver/adopt.js` (`adoptRun`'s success return; update the "It writes nothing" header sentence)
- Test: `tests/bin-lib/express/cli.test.js`
- Test: `tests/bin-lib/driver/run.test.js` (the suite that exercises `adoptRun`; confirm with `grep -n adoptRun tests/bin-lib/driver/run.test.js`)

**Interfaces:**
- Consumes: `fillRunManifest` from Task 2.
- Produces: `runGate` calls `fillRunManifest(runDir, { lane: 'express' })` when `--run` was given and every verdict is `eligible: true` (an `--issue` run has one verdict), where `runDir` is `path.dirname(decisionsFile)` from `anchoredDecisions`; an `eligible: false` verdict leaves the manifest untouched. `adoptRun` calls `fillRunManifest(real, { lane: 'driver' })` on its `ok: true` path. Stdout envelopes, exit codes and the `ok`/`why` result shape are unchanged.

- [ ] **Step 1: Write the failing tests.**
  - express cli: `gate --run with eligible:true sets lane express`; `eligible:false leaves lane untouched`; `gate without --run writes no manifest`; `a manifest fill failure leaves stdout and exit code unchanged`. Follow the file's existing fake-deps style for `gate`.
  - driver: `adoptRun on a dispatch-minted run fills lane driver`; `a refused adoption writes nothing`.

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/bin-lib/express/cli.test.js`
Expected: FAIL after Step 1 (lane stays `unknown`/absent; the file passes today because the new tests are appended in Step 1).

- [ ] **Step 3: Add the fill calls.** In `runGate`, after `verdicts` is built and before the `deps.stdout` line, a guarded call as above. In `adoptRun`, just before the final `return { ok: true, ... }`. Rewrite the header's "It writes nothing" sentence to: "It refuses before writing anything; its one write is the best-effort `lane: 'driver'` fill of the run's manifest.json (#5903)." Check that no existing `adoptRun` test asserts the run directory is left byte-identical; if one does, update it to exclude `manifest.json`.

- [ ] **Step 4: Run to verify they pass**

Run: `node --test tests/bin-lib/express/cli.test.js`
Expected: PASS. Then `node --test tests/bin-lib/driver/run.test.js`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/express/cli.js plugin/bin/lib/driver/adopt.js tests/bin-lib/express/cli.test.js tests/bin-lib/driver/run.test.js
git commit -m "Fill manifest lane from the express gate and the driver's run adoption (refs #5903)"
```
(append the `Claude-Session:` trailer line)

---

### Task 7: Reference page, structure doc, negative sweep

**Files:**
- Create: `docs/reference/run-manifest.md`
- Modify: `docs/plugin-structure.md` (add a `plugin/bin/lib/run-manifest/` line in the lib listing, in the style of its neighbours, e.g. beside the `set-config/` and `run-artifact/` lines)

**Interfaces:**
- Consumes: the final field set and writer behaviour from Tasks 1-6. Produces: the contract page dispatch points at.

- [ ] **Step 1: Write `docs/reference/run-manifest.md`.** Cover: purpose and who reads it (dispatch copies the object into each visit's `manifest`); the nine fields with type, meaning and which writer sets each (mint `initRunManifest` in `run-dir-resolve.js`; Manifesto lane; `setConfigLever` ceremonyProfile; express gate; driver adoption); the null/`unknown` = "not known yet or never known" reader rule; the fill rules (only-null, `lane: unknown` counts as unset and the first known lane wins, `ceremonyProfile` may change on a downgrade); the additive-only rule and `v`; `policyHash` is a fingerprint of resolved values at mint, excludes `integration-model` and `merge-verification` (forge-derived, can call `gh`), and does not reflect a mid-run `policy.yml` edit; `baseCommit` is the tip of `origin/{integration-branch}` at mint (the worktree itself starts from local HEAD plus a catch-up merge, so this is the integration tip the run builds on, not necessarily the worktree's first commit); archival moves the file with the run directory to `archive/{run-id}/`, readers must check both; it holds no secrets; it is not run initialization; the name is distinct from the multi-spec `manifest.yml`.

- [ ] **Step 2: Add the structure-doc line** and keep the style of the neighbouring lines (module names, one-clause purpose, `#5903`).

- [ ] **Step 3: Negative sweep and doc checks**

Run: `git grep -n "manifest\.json" -- plugin/skills`
Expected: no output (no skill instructs writing it).
Run: each suite under `tests/bin-lib/doc-conventions/` plus every test file that `grep -rln "plugin-structure\|docs/reference" tests` lists, one `node --test <file>` per file.
Expected: PASS.

- [ ] **Step 4: State the contract proof.**

Proof(public-contract): `docs/reference/run-manifest.md` documents all nine v1 fields with their writers and the additive-only rule, `tests/bin-lib/run-manifest/write.test.js` pins the exact sorted key set, `v: 1`, the null/`unknown` fill semantics and the `v: 2` unknown-field round trip, and `tests/hooks-resolve-run-dir-cli.test.js` pins that `resolve-run-dir --create` still prints exactly the directory path with exit 0.

- [ ] **Step 5: Commit**

```bash
git add docs/reference/run-manifest.md docs/plugin-structure.md
git commit -m "Document the run manifest — field reference and lib directory entry (refs #5903)"
```
(append the `Claude-Session:` trailer line)
