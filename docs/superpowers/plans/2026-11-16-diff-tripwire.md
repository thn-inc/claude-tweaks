# Diff Tripwire Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Before the merge decision under control mode, cross-check the record's declared risk flags against what the diff actually touched, append any newly crossed category as a flag (never remove one), and switch the run to local acceptance with the reason stated in the acceptance packet.

**Architecture:** A pure evaluator, `plugin/bin/lib/accept/tripwire.js`, takes changed paths, declared flags, removal history, the `risk-path-globs` map and an optional agent classification and returns additions only. `bin/accept-park.js decide` (the decision point `_shared/pr-first-merge.md` Step 2.9, the pipeline driver and tidy's record-linked arm already call) gathers those inputs from git, the record and policy, runs the evaluator, appends new flags through a sanctioned widening writer in `record-risk-flags.js`, feeds the result to `resolveAcceptanceTarget` through a new `tripwire` input (threaded by `decideAcceptanceRoute`), and writes the packet lines to the run dir; `park` writes those lines into the packet's Deploy status section. Removal history is read from trusted record comments only (spec Decision 1), so `/specify` and `/backlog refine` always post the removal comment. `local-merge` is out of scope (spec Decision 2).

**Tech Stack:** Node 18+ CommonJS, `node --test`, `gh`/`git` through the CLI's injected `deps` seam (`gh-api-module-pattern` skill).

**Spec:** `.claude-tweaks/pipelines/2026-11-16T190426-record-4619/work/4619-spec.md`

Scope keywords: resolveAcceptanceTarget, decideAcceptanceRoute, writeParkDeployStatus, accept-park.js decide, risk-path-globs, log-removals

## Global Constraints

- Runs only under `control-mode: on`; with it off `decide` reads nothing new and prints `consulted: false` exactly as today (no git call, no new field).
- Monotonic: the tripwire may add a flag, never remove one; `result.flags` is always a superset of `declaredFlags`.
- Fail toward caution: malformed globs, a failed diff, a missing head commit, a malformed classification or a failed flag write force `local` and say so; never reported as "no crossing found". An unset or `{}` `risk-path-globs` is not a failure: the glob signal is off. An empty glob list for one category is valid (as `risk-flag-classify.js`'s `checkGlobs` accepts it) and turns that category's glob signal off.
- Exact packet copy: `tripwire could not run: {reason}`, `path globs not configured`, `agent classification not run`, and the removal sentence `you removed the {slug} flag at intent; the diff touches {path}, so this run is local`.
- Evidence is capped at 300 characters and rendered inert: reuse `inertEvidence` from `plugin/bin/lib/issues/risk-flag-classify.js`. Every packet line then has each `target:` (any case) neutralized to `target\:` so `park-grammar.js`'s `TARGET_RE` (`/(?:^|\s)target:[ \t]*([^\s,]+)/`, which matches mid-line) can never read a tripwire line as the packet's target.
- Matching reuses `isSensitivePath` from `plugin/bin/lib/issues/blast-radius.js` unmodified; the shared matcher and its other consumers are not changed.
- Removal history is read from trusted record comments only (`isTrustedComment`, `plugin/bin/lib/issues/comment-trust.js`); the tripwire does not read any run dir's `decisions.md` (spec Decision 1).
- `local-merge` is out of scope: no task wires a `local-merge` merge site (spec Decision 2).
- Scope and edit discipline: "Commit tests only where the task asks for them or the repo already keeps tests for this kind of change, sized like the neighboring test files; scratch checks stay scratch. Touch only what the task requires — a pre-existing bug you notice is a follow-up to report, not a fix to fold in, unless the task cannot work without it. Don't reformat or "improve" adjacent code; edit in place rather than rewrite when the result is the same."
- Source-scan suites over `plugin/bin/`: every `execFileSync`/`spawnSync` carries `windowsHide: true`; no bare `fs.existsSync`/`fs.realpathSync` (`tests/path-guard-conformance.test.js`).
- `gh-api-module-pattern` / `git-seam.md`, quoted: "For `git` the separator is **`--end-of-options`, not `--`**: `--` switches `rev-parse --verify` and `merge-base` into pathspec mode and silently changes what they resolve" · "**`--end-of-options` alone never resolves a revision — it needs `--verify` alongside it.**" · "An argv that asks git for a path list (`--name-only` / `--name-status`, `ls-files`, `ls-tree`, `--numstat`, `status --porcelain`) passes `-z` and splits on NUL via `plugin/bin/lib/git-z.js`, besides `--end-of-options` before any ref." · "For patch text, pass every flag explicitly" (here: `--no-color --no-ext-diff`).
- `record-body-line-addition`, quoted (governs `Risk-flags-added-by-tripwire:`): "Put the reader in a `plugin/bin/lib/issues/record-*.js` module, re-export it from `record.js`, and have every consumer call it." · "The test for "this is the line" must be wider than the exact grammar, or a variant spelling reads as absent." · "Read only the preamble (after an optional frontmatter block, before the first `## ` heading) and skip fenced lines, so a quoted example is never the record's own line." · "When the line must not be hand-edited, put its writers in the reader's module and pin them with a writer scan over `plugin/bin`" · "Writers normalize `\r\n?` to `\n` on entry and put `\r\n` back when the body was uniformly CRLF." Registration sites from that skill's table: `specify/spec-template.md`, `_shared/work-record.md`, `record.js` (re-export + header list), `local-store.js` header, `docs/plugin-structure.md`.
- `bin-source-scan-conformance`, quoted (governs Task 2's scan): "A scan reports `misparsed` and `unparseable` as an offender, with `STRIPPER_VERDICT_MESSAGES[verdict]` as the text." · assert a floor on matched sites · self-test the matcher with planted cases. A new stripper caller is added to the stem list in `tests/helpers/strip-comments.js`'s header (`tests/strip-comments-callers-twin.test.js` pins it).

## Review Focus

1. A `-z` name-status stream with a rename `R087\0old\0new\0` and a copy `C100\0a\0b\0` must yield both paths; an unrecognised status (`U`, `X`) or a record missing its path must make the parse fail (could-not-run), never drop the record. Pinned in Task 1 (`parseNameStatus` tests).
2. A path with a trailing slash, `./`, `..` segments, backslashes and mixed case must normalise before matching, and a path normalising above the repo root (`../x`) must not match `migrations/**`. Pinned in Task 1 (AC8 tests).
3. Two records in one `decide` call share one diff: git runs once, and each record gets its own crossings against its own declared flags. Pinned in Task 3.
4. A re-run of `decide` on a record whose earlier run already appended the tripwire flag finds the flag declared, appends nothing and writes the body zero times. Pinned in Task 3.
5. An agent classification entry, a git error or a flag-write error whose text carries a newline, a backtick or a `target: dev` substring renders as one inert line that never alters the park state (`parkStateOf` still reads `target: local`). Pinned in Task 1 and Task 4.

---

### Task 1: Pure tripwire evaluator

**Role:** judgment
**Review risk:** high

**Files:**
- Create: `plugin/bin/lib/accept/tripwire.js`
- Test: `tests/bin-lib/accept/tripwire.test.js`

**Interfaces:**
- Consumes: `isSensitivePath(path, globs)` from `plugin/bin/lib/issues/blast-radius.js`; `inertEvidence(text)` from `plugin/bin/lib/issues/risk-flag-classify.js`; `BUILTIN_RISK_CATEGORIES` from `plugin/bin/lib/policy-schema.js`; `parseNameStatusZ(raw)` from `plugin/bin/lib/git-z.js`.
- Produces:
  - `evaluateTripwire({ changedPaths, diffError, declaredFlags, tripwireFlags, removedFlags, globs, agentClassification, categories }) -> { status: 'ok'|'could-not-run', reason?: string, crossed: Array<{ category, via: 'glob'|'agent', evidence }>, newFlags: string[], reportedFlags: string[], flags: string[], notes: string[], removedThenCrossed: Array<{ category, evidence, path: string|null }> }`.
    - `tripwireFlags`: `string[]` (default `[]`), the slugs the record's `Risk-flags-added-by-tripwire:` line already names (Task 2's `parseTripwireFlags`), so a re-run still reports the crossing an earlier run appended.
    - `changedPaths`: `string[]`; anything else is could-not-run with `reason` = `diffError` when it is a non-empty string, else `changed paths not read`.
    - `declaredFlags`: `string[]` (the record's kept flags); not an array of strings → could-not-run `declared flags not read`.
    - `removedFlags`: `string[]` or `null` (log unreadable → no removal sentence, tripwire still fires).
    - `globs`: `undefined` or a plain object with no keys → glob signal off, `notes` gets `path globs not configured`. A plain object whose every key is in `categories` and every value is an array of strings (an empty array valid) → on. Anything else (`null`, a string, an array, a value that is not a list, a non-string glob, a key outside `categories`) → could-not-run `risk-path-globs is not a map of category to glob list`.
    - `agentClassification`: `undefined`/`null` → `notes` gets `agent classification not run`. An array of `{ category: string, evidence: string }` → each entry with `category` in `categories` crosses `via: 'agent'`; an unknown category is ignored and `notes` gets `agent classification category ignored: {inert category}`. Any other shape (not an array, an entry not an object, non-string fields) → could-not-run `agent classification malformed`.
    - `categories`: `string[]`, default `BUILTIN_RISK_CATEGORIES`.
    - Order: globs first, then agent; one `crossed` entry per category, the first match wins (a category matched by both is `via: 'glob'`). Glob evidence is `inertEvidence(\`${glob}: ${path}\`)`, the path as git printed it; agent evidence is `inertEvidence(evidence)`.
    - `crossed` lists every crossed category, declared ones included; `newFlags` is the crossed categories not in `declaredFlags`, in `crossed` order; `flags` is `declaredFlags` followed by `newFlags`. `reportedFlags` is the crossed categories that are in `newFlags` or in `tripwireFlags`, in `crossed` order (a declared category the tripwire did not add is not reported). `removedThenCrossed` is the `reportedFlags` entries present in `removedFlags`, each with its crossing's evidence and, for a glob crossing, `path` = `inertEvidence(path)` (else `null`).
    - could-not-run: `crossed: []`, `newFlags: []`, `reportedFlags: []`, `flags` a copy of `declaredFlags`, `notes: []`, `removedThenCrossed: []`.
  - `normalizeRepoPath(p: string) -> string`: backslashes to `/`, leading `./` stripped, `path.posix.normalize`, trailing `/` dropped, lowercased. Globs are lowercased the same way before `isSensitivePath`.
  - `parseNameStatus(raw: string) -> string[] | null`: the output of `git diff --name-status -z`, through `parseNameStatusZ`; a record whose status is `A|M|D|T` with exactly one non-empty path → `[path]`; `R\d*` or `C\d*` with exactly two → `[old, new]`; any other status or path count → `null`. Empty output → `[]`.
  - `REMOVAL_COMMENT_RE` and `removalLogSlugs(texts: string[]) -> string[]`: every slug of a line that is exactly `Risk flag {slug} removed by the maintainer during shaping` after trimming (slug `[a-z0-9-]+`), deduplicated, in first-seen order. The caller passes trusted comment bodies only.
  - `neutralizeTarget(text: string) -> string`: every `target:` (case-insensitive) becomes `target\:`.
  - `tripwireLines(result, { appendFailure?: string }) -> string[]`: the packet lines, each one line of inert text passed through `neutralizeTarget`:
    - could-not-run: `tripwire could not run: {inert reason}`.
    - per `reportedFlags` category not in `removedThenCrossed`: `tripwire: the diff crosses {category} ({evidence}), which nobody flagged, so this run is local`.
    - per `removedThenCrossed` entry: `tripwire: you removed the {category} flag at intent; the diff touches {path ?? evidence}, so this run is local`.
    - every `notes` entry as `tripwire: {note}`.
    - with `appendFailure`: `tripwire: the flag write failed ({inert appendFailure}), so this run is local`.

- [ ] **Step 1: Write the failing tests** in `tests/bin-lib/accept/tripwire.test.js` (compute every evidence expectation by calling `inertEvidence`, never hand-escape):
  - `AC1.1: migrations/001_add_users.sql with glob migrations/** and no declared flags crosses migrations via glob` → `status: 'ok'`, `crossed: [{ category: 'migrations', via: 'glob', evidence: inertEvidence('migrations/**: migrations/001_add_users.sql') }]`, `newFlags: ['migrations']`, `flags: ['migrations']`.
  - `AC2.1: a crossing of an already declared category adds no flag` — declared `['migrations']` → `newFlags: []`, `flags: ['migrations']`.
  - `AC3.1: agent classification naming auth with no glob match adds auth via agent` — `agentClassification: [{ category: 'auth', evidence: 'login handler changed' }]`, `globs: {}` → `crossed: [{ category: 'auth', via: 'agent', evidence: 'login handler changed' }]`, `newFlags: ['auth']`.
  - `AC4.1: declared [migrations] and a diff touching nothing sensitive keeps flags equal to declared` → `newFlags: []`, `flags: ['migrations']`.
  - `AC5.1: property — flags is a superset of declaredFlags for 500 seeded random inputs, and could-not-run leaves flags equal to declaredFlags` — a seeded linear-congruential generator (fixed seed, no `Math.random`) drawing declared subsets of the four built-ins, 0-6 paths from a pool mixing sensitive and plain paths, globs that are a valid map (empty lists included) or one of the malformed shapes, and optional classifications; assert `declaredFlags.every((f) => result.flags.includes(f))` every time and `deepEqual(result.flags, declaredFlags)` whenever `status === 'could-not-run'`.
  - `AC7.1: malformed risk-path-globs is could-not-run` — one subtest each for `'migrations/**'`, `{ migrations: 'migrations/**' }`, `{ migrations: [7] }`, `null`, `{ bogus: ['x/**'] }`: `status: 'could-not-run'`, `reason: 'risk-path-globs is not a map of category to glob list'`, `newFlags: []`; `tripwireLines(result)` deep-equals `['tripwire could not run: risk-path-globs is not a map of category to glob list']`.
  - `AC7.1: a git failure is could-not-run with its reason` — `changedPaths: null, diffError: 'git merge-base failed'` → `reason: 'git merge-base failed'`.
  - `AC7.2: absent or {} risk-path-globs is ok with the glob signal off` — `globs: undefined` and `globs: {}` with a `migrations/` path and no classification → `status: 'ok'`, `newFlags: []`, `notes` deep-equals `['path globs not configured', 'agent classification not run']`.
  - `an empty glob list is valid and matches nothing` — `globs: { migrations: [] }`, path `migrations/a.sql` → `status: 'ok'`, `newFlags: []`, `notes` deep-equals `['agent classification not run']`.
  - `AC7.3: an empty diff is ok with no crossings` — `parseNameStatus('')` → `[]`, then `crossed: []`.
  - `AC7.4: a rename from migrations/a.sql to docs/a.sql crosses migrations` — `changedPaths: parseNameStatus('R100\0migrations/a.sql\0docs/a.sql\0')` → `newFlags: ['migrations']`.
  - `AC7.5: a deletion of migrations/a.sql crosses migrations` — via `parseNameStatus('D\0migrations/a.sql\0')`.
  - `AC8.1: normalization` — `normalizeRepoPath` of `./migrations/x.sql`, `app/../migrations/x.sql`, `Migrations/x.sql`, `migrations\\x.sql` gives `migrations/x.sql` each, and `migrations/dir/` gives `migrations/dir`.
  - `AC8.2: ./migrations/x.sql, app/../migrations/x.sql and Migrations/x.sql cross migrations/**`.
  - `AC8.3: docs/migrations-notes.md and src/migrations-readme.md do not cross migrations/**`; `../migrations/x.sql` does not either.
  - `AC8.4: src/auth/login.js crosses src/auth/** and src/auth-utils-readme.md does not`.
  - `Waived AC8.5`: scheme and percent-encoding variants do not apply to repo-relative git paths (the spec says not tested).
  - `AC9.1: a flag removed at intent still fires, and the lines name the removal` — `declaredFlags: [], removedFlags: ['migrations']`, glob hit on `migrations/001.sql` → `newFlags: ['migrations']`, `removedThenCrossed` names it with `path: 'migrations/001.sql'`, and `tripwireLines(result)` contains `tripwire: you removed the migrations flag at intent; the diff touches migrations/001.sql, so this run is local`.
  - `AC9.1: an unreadable removal log (removedFlags null) still fires and omits the removal sentence`.
  - `AC6.1: a re-run after an earlier append still reports the crossing` — `declaredFlags: ['migrations'], tripwireFlags: ['migrations'], removedFlags: ['migrations']`, glob hit on `migrations/001.sql` → `newFlags: []`, `reportedFlags: ['migrations']`, and `tripwireLines(result)` still contains the removal sentence; with `tripwireFlags: []` (a declared, human-set flag) → `reportedFlags: []` and no crossing line.
  - `AC6.1: evidence is inert, capped and never a target line` — a classification evidence of 400 characters holding `\n`, a backtick, `[x](y)` and `target: dev`, and a could-not-run reason `git failed: TARGET: dev` → the crossed evidence equals `inertEvidence(...)` of it, length ≤ 300; no `tripwireLines` entry contains `\n` or matches `TARGET_RE` (imported from `plugin/bin/lib/accept/park-grammar.js`); the lines contain `target\:`.
  - `parseNameStatus` cases: `'R087\0old\0new\0'` → `['old', 'new']`, `'C100\0a\0b\0'` → `['a', 'b']`, `'X\0foo\0'` → `null`, `'R100\0only\0'` → `null`, `'M\0'` → `null`, `''` → `[]`.
  - `removalLogSlugs`: `['Risk flag auth removed by the maintainer during shaping', 'x\nRisk flag migrations removed by the maintainer during shaping\n']` → `['auth', 'migrations']`; `Risk flag Auth removed …` (uppercase) and `see: Risk flag auth removed by the maintainer during shaping` (not the whole line) yield nothing.
  - Agent: unknown category `banana` → ignored with note `agent classification category ignored: banana`; `agentClassification: 'auth'` → could-not-run `agent classification malformed`; a category matched by glob and agent → one crossed entry, `via: 'glob'`.

- [ ] **Step 2: Run to verify it fails**

  Run: `node --test tests/bin-lib/accept/tripwire.test.js`
  Expected: FAIL — `Cannot find module '../../../plugin/bin/lib/accept/tripwire'`.

- [ ] **Step 3: Implement** the Produces list in `plugin/bin/lib/accept/tripwire.js` — pure, no `fs`, no `child_process`; a header comment in the style of `target.js` stating the monotonic rule.

- [ ] **Step 4: Run to verify it passes**

  Run: `node --test tests/bin-lib/accept/tripwire.test.js`
  Expected: PASS, 0 failures.

- [ ] **Step 5: Commit**

  ```bash
  git add plugin/bin/lib/accept/tripwire.js tests/bin-lib/accept/tripwire.test.js
  git commit -m "Add the diff tripwire evaluator — additions-only crossing check over paths and agent classification, refs #4619"
  ```

### Task 2: Tripwire input to target resolution, the widening writer, and the monotonicity scan

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/accept/target.js`, `plugin/bin/lib/accept/park.js` (`decideAcceptanceRoute` threads `tripwire`)
- Modify: `plugin/bin/lib/issues/record-risk-flags.js` (add `parseTripwireFlags`, `addTripwireRiskFlags`; `removeRiskFlag` also drops the slug from the tripwire line)
- Modify: `plugin/bin/lib/issues/record.js` (re-export both; header sub-module list)
- Modify (registration sites, one sentence each): `plugin/skills/specify/spec-template.md` (the `Risk-flags-added-by-tripwire:` line: written only by the tripwire through `addTripwireRiskFlags`, never in a composed body), `plugin/skills/_shared/work-record.md` (the reader and writer), `plugin/bin/lib/issues/local-store.js` header (the line rides in `body`), `docs/plugin-structure.md` (`plugin/bin/lib/issues/` row)
- Modify: `tests/helpers/strip-comments.js` header stem list (the new caller)
- Test: `tests/bin-lib/accept/target.test.js`, `tests/bin-lib/accept/park.test.js`, `tests/bin-lib/issues/record-risk-flags.test.js`, new `tests/accept-monotonic-conformance.test.js`

**Interfaces:**
- Consumes: `addRiskFlags`, `canonicalOrder`, `editBody`, `scanPreamble`'s preamble/fence rules (same module).
- Produces:
  - `resolveAcceptanceTarget({ keptRiskFlags, itemOverride, policyDefault, tripwire })`: `tripwire` optional; `undefined` keeps today's behavior exactly. Present: must be `{ status: 'ok'|'could-not-run', newFlags: string[] }` else `invalid-input`. Precedence: input validation, then `tripwire.status === 'could-not-run'` → `{ target: 'local', reason: 'tripwire' }`, then kept risk flags or `tripwire.newFlags.length > 0` → `{ target: 'local', reason: 'risk-flag' }`, then the existing override/policy/default chain. `REASONS` gains `'tripwire'` (appended at the end).
  - `decideAcceptanceRoute({ controlMode, keptRiskFlags, itemOverride, policyDefault, tripwire })` passes `tripwire` through to `resolveAcceptanceTarget`; with control mode off it is ignored as today. `decideSeries` is unchanged (it spreads each record's `input`).
  - `parseTripwireFlags(body) -> { status: 'absent'|'ok'|'malformed', flags: string[] }`: the preamble's `Risk-flags-added-by-tripwire:` line, detected wider than the grammar (`${LINE_PREFIX}risk[-_ ]?flags[-_ ]added[-_ ]by[-_ ]tripwire[*_]*\s*:`, any case), fences skipped; exact form `Risk-flags-added-by-tripwire: {slug}, {slug}` → `ok`; any other detected spelling or a non-slug value → `malformed`, `flags: []`.
  - `addTripwireRiskFlags(body, slugs, opts) -> body`: `addRiskFlags(body, slugs, opts)` then exactly one preamble line `Risk-flags-added-by-tripwire: {slugs}` holding the union of any slugs that line already named (a malformed line contributes none and is rewritten in exact form) and `slugs`, `canonicalOrder`, placed directly below the `Risk-flags:` line and its `Risk-flags-unconfirmed:` marker when one is present; an existing line is rewritten in place. `slugs: []` returns the body unchanged. CRLF via `editBody`.
  - `removeRiskFlag(body, slug, opts)` (existing, human-confirmed path): unchanged contract, and it also drops `slug` from the `Risk-flags-added-by-tripwire:` line, removing the line when it empties, so the line never names a flag `Risk-flags:` no longer carries. Plan-review settlement: a human's removal of a tripwire-added flag does not suppress the tripwire; the next `decide` on a diff that still crosses the category re-adds it (monotonic), so the run accepts locally.

- [ ] **Step 1: Write the failing tests**
  - `target.test.js`: `tripwire could-not-run forces local by tripwire even with policyDefault dev`; `tripwire newFlags [auth] with no kept flags resolves local by risk-flag`; `tripwire ok with no newFlags and policyDefault dev resolves dev`; `a malformed tripwire ({status:'maybe'}) is invalid-input`; `REASONS ends with 'tripwire'`.
  - `park.test.js`: `decideAcceptanceRoute threads the tripwire input` — `{ controlMode: true, keptRiskFlags: [], policyDefault: 'dev', tripwire: { status: 'ok', newFlags: ['auth'] } }` → `{ consulted: true, park: true, target: 'local', reason: 'risk-flag' }`; with `tripwire: { status: 'could-not-run', newFlags: [] }` → reason `tripwire`; control mode off with a tripwire → `consulted: false`.
  - `record-risk-flags.test.js`: `addTripwireRiskFlags adds the flag and the tripwire line` — body `# T\n\nRisk-flags: none\n\n## Overview\n` + `['migrations']` → `Risk-flags: migrations` then `Risk-flags-added-by-tripwire: migrations` on the next line; `a second call unions the tripwire line` (`['auth']` after `['migrations']` → `Risk-flags: migrations, auth` and `Risk-flags-added-by-tripwire: migrations, auth`); `parseRiskFlags ignores the tripwire line` (status `ok`, flags as declared); `parseTripwireFlags reads ok, absent, a variant spelling as malformed, and ignores a fenced example`; `the line sits below an unconfirmed marker`; `[] is byte-identical`; `a uniformly CRLF body stays CRLF`; `removeRiskFlag drops the slug from the tripwire line` (`Risk-flags: migrations, auth` + `Risk-flags-added-by-tripwire: migrations, auth`, remove `auth` with `humanConfirmed: true` → `Risk-flags: migrations` and `Risk-flags-added-by-tripwire: migrations`; removing `migrations` next removes the tripwire line); `removeRiskFlag on a body with no tripwire line is byte-identical to today` (characterization, `project-maturity: established`).
  - `tests/accept-monotonic-conformance.test.js` (follow `bin-source-scan-conformance`): scans every `plugin/bin/lib/accept/*.js` plus `plugin/bin/accept-park.js`; fails on any reference to `removeRiskFlag`/`removeRiskFlags`/`confirmRiskFlags` and on any function, method or `const`-bound function declaration whose name matches `/^(?:remove|narrow|drop|strip)\w*flags?$/i`; a `stripperVerdict` mis-parse is an offender; floor: at least 6 files scanned and `tripwire.js` among them; go-red self-tests: fixture text `const { removeRiskFlag } = require('../issues/record');`, `function removeTripwireFlag() {}` and `const dropFlags = () => {};` are each reported, a reader named `removalLogSlugs` or `readRemovedFlags` is not, and the real tree reports none.

- [ ] **Step 2: Run to verify they fail**

  Run: `node --test tests/bin-lib/accept/target.test.js tests/bin-lib/accept/park.test.js tests/bin-lib/issues/record-risk-flags.test.js tests/accept-monotonic-conformance.test.js`
  Expected: FAIL on the new tests only (`addTripwireRiskFlags is not a function`, the tripwire target and route cases); the conformance real-tree check and its self-tests pass.

- [ ] **Step 3: Implement** the Produces entries and the registration-site sentences; keep `target.js` and `park.js` pure.

- [ ] **Step 4: Run to verify they pass**

  Run: `node --test tests/bin-lib/accept/target.test.js tests/bin-lib/accept/park.test.js tests/bin-lib/issues/record-risk-flags.test.js tests/accept-monotonic-conformance.test.js tests/risk-flags-writer-conformance.test.js tests/strip-comments-callers-twin.test.js tests/risk-flags-prose-conformance.test.js`
  Expected: PASS, 0 failures.

- [ ] **Step 5: Commit** — explicit paths; `Add the tripwire target input and the widening tripwire flag writer, refs #4619`.

### Task 3: Run the tripwire in `accept-park.js decide`

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/accept-park.js` (`VERBS.decide`, `parseArgs`, `runDecide`, `USAGE`, header comment)
- Test: `tests/accept-park-cli.test.js`

**Interfaces:**
- Consumes: Task 1's `evaluateTripwire`, `parseNameStatus`, `removalLogSlugs`, `tripwireLines`; Task 2's `addTripwireRiskFlags` (through `./lib/issues/record`) and the `tripwire` route input, and `parseTripwireFlags`; `resolvePolicyKeys(['risk-categories', 'risk-path-globs'], { policyRaw })` (both keys are policy-only), gated by `decide`'s own control-mode resolution — never `readRiskPolicy`, which gates on `policy.yml` alone and so reads globs as off when only the run's `config.yml` turns control mode on (this also fixes `decide`'s existing `extraCategories` read the same way); `isTrustedComment` from `plugin/bin/lib/issues/comment-trust.js`; `BUILTIN_RISK_CATEGORIES`.
- Consumers of `decide`'s output (return-shape widening, classified): `plugin/bin/lib/driver/merge.js` `acceptPark` reads `d.park` and `decisions[0].record/park/consulted` only — unaffected by an added field; `_shared/pr-first-merge.md` Step 2.9, `_shared/local-acceptance-park.md` and tidy's `actions-github-issues.md` read `park` only. `tests/accept-park-cli.test.js`'s control-mode-on `deepEqual` assertions (lines ~180-250: `decide parks a control-mode record…`, `invalid acceptance-target…`, `I1…`) widen: each gains `--head` and a fake diff, and asserts the `tripwire` field or projects the old four keys. The unreadable-record case (`#9`) keeps its exact deepEqual: no tripwire runs for it.
- Produces:
  - New optional flags on `decide`: `--head <sha>` (40 or 64 lowercase hex — a fetch by sha needs the full oid), `--base <ref>` (`/^[A-Za-z0-9._\/-]+$/`, not starting with `-`), `--classification <file>`.
  - Control mode off: unchanged — no git call, no new field.
  - Control mode on, once per invocation, the diff: no `--head` → `changedPaths: null, diffError: 'no --head given'`. Head presence: `git rev-parse --verify --quiet --end-of-options {head}^{commit}`; on failure one `git fetch --no-tags origin {head}` (GitHub serves a reachable commit by oid — this is how tidy's sweep, which runs from the main checkout, reaches a PR head it never fetched), then the check again; still absent → `diffError: 'head commit {head} not available locally'`. Base: `--base` (used as given, no fetch), else policy `integration-branch` (`resolvePolicyKeys` over the same sources) as `origin/{name}`, else the output of `git rev-parse --abbrev-ref origin/HEAD` (`origin/{name}`); a derived base is refreshed first with `git fetch --no-tags origin {name}` so a stale `origin/{name}` in the main checkout (tidy's sweep) cannot widen the diff with already-merged paths — a failed fetch → `diffError: 'git fetch of {name} failed: {first line}'`. Then `git merge-base --end-of-options {base} {head}` and `git diff --name-status -z -M --no-color --no-ext-diff --end-of-options {mergeBase}..{head}` through `ctx.git`, parsed by `parseNameStatus`; any throw or a `null` parse → `diffError` naming the failed step (`git merge-base failed: {first line}`, `git diff failed: {first line}`, `git diff output unparseable`).
  - Classification: `--classification` absent → `undefined`; present → `JSON.parse(deps.readFile(file))`; an unreadable or unparseable file → passed as the string `'unreadable'`, which `evaluateTripwire` reports as `agent classification malformed`.
  - Per record: `gh issue view {n} --json body,comments`; `removedFlags = removalLogSlugs(trusted comment bodies)` (`isTrustedComment`), `null` when `comments` is not a list; `declaredFlags` = the existing `keptRiskFlags(parseRiskFlags(...))` result; `tripwireFlags = parseTripwireFlags(body).flags`; `categories = [...BUILTIN_RISK_CATEGORIES, ...extraCategories]`; `globs` = `null` when the resolved `risk-path-globs` is `invalid`, `undefined` when its `source` is `default` (absent), else its `value`.
  - When `newFlags` is non-empty: write `addTripwireRiskFlags(body, newFlags, { extraCategories })` to a `deps.tmpPath` file and `gh issue edit {n} --body-file {file}` (`ctx.ghIssue`), temp removed in `finally`; a failure sets `appendFailure` to the error's first line and writes a stderr line, and the exit code stays 0 — the decision already resolves local through `newFlags`. This write happens at every decide call site, tidy's sweep included: arming a merge is a merge decision, and the append is idempotent (a re-run finds the flag declared and writes nothing).
  - The decision object gains `tripwire: { status, reason?, crossed, newFlags, reportedFlags, flags, notes, removedThenCrossed, appendFailed: boolean, lines }` (`lines` = `tripwireLines(result, { appendFailure })`); the record's route input gains `tripwire: { status, newFlags }`.
  - With `--run`: writes `{run}/packet-facts/tripwire-{n}.json` = `{ "record": n, "lines": [...] }` (mkdir `packet-facts` with `recursive: true`), for every consulted record whose body read, overwriting an earlier tip's file. A failed write is a stderr line and makes `decide` exit 1 (its decision still printed), which every caller already treats as fail closed (`supplier-failed`, no merge, no park), so a parked packet can never lose the tripwire's stated reason.
  - An unreadable record body keeps today's behavior (invalid-input, exit 1) and runs no tripwire for that record.

- [ ] **Step 1: Write the failing tests** in `tests/accept-park-cli.test.js`, extending its fake `gh`/`git`/`readFile` seams (git: `rev-parse --verify`, `fetch`, `merge-base`, `diff` handlers, each recorded) and a control-mode-on `policy.yml` with `risk-path-globs:\n  migrations: [migrations/**]`:
  - `AC1.1: decide appends migrations, writes the tripwire line and parks` — diff `A\0migrations/001_add_users.sql\0`; body `Risk-flags: none`; one `gh issue edit` whose body file holds `Risk-flags: migrations` and `Risk-flags-added-by-tripwire: migrations`; decision `park: true, target: 'local', reason: 'risk-flag'`, `tripwire.newFlags: ['migrations']`.
  - `AC2.1: a declared crossing writes nothing` — body `Risk-flags: migrations` → zero `issue edit` calls (Review Focus 4).
  - `AC7.1: no --head under control mode is could-not-run and parks` — `reason: 'tripwire'`, `tripwire.lines` deep-equals `['tripwire could not run: no --head given']`.
  - `AC7.1: a malformed risk-path-globs block is could-not-run` — `risk-path-globs:\n  migrations: x` → `tripwire.status: 'could-not-run'`, reason `tripwire`.
  - `AC7.1: a head missing after one fetch is could-not-run` — `rev-parse --verify` fails twice, the fetch argv is exactly `['fetch', '--no-tags', 'origin', HEAD40]` → reason `tripwire`, line names `not available locally`; and `a head present after the fetch runs the diff`.
  - `AC7.2: absent risk-path-globs with acceptance-target dev resolves dev` — plain diff, no classification → `park: false`, `target: 'dev'`, `tripwire.lines` deep-equals `['tripwire: path globs not configured', 'tripwire: agent classification not run']`.
  - `AC7.6: a failed flag append still parks local and reports it` — fake `gh issue edit` throws `HTTP 502` → exit 0, `park: true`, `tripwire.appendFailed: true`, a `lines` entry `tripwire: the flag write failed (HTTP 502), so this run is local`.
  - `AC3.1: --classification auth adds auth via agent` — classification file `[{"category":"auth","evidence":"login handler changed"}]`, plain diff.
  - `AC9.1: a trusted removal comment names the removal` — comments `[{ body: 'Risk flag migrations removed by the maintainer during shaping', authorAssociation: 'OWNER' }]` → a `lines` entry with `you removed the migrations flag at intent`; the same comment with `authorAssociation: 'NONE'` → no removal sentence, flag still added.
  - `two records share one diff` — `--record 1,2` → exactly one `merge-base` and one `diff` git call, each record decided against its own body (Review Focus 3).
  - `control mode on in config.yml only still reads the globs` — `policy.yml` holds `risk-path-globs` and no `control-mode`, the run's `config.yml` holds `control-mode: on`, diff touches `migrations/` → `tripwire.newFlags: ['migrations']`, no `path globs not configured` line.
  - `a derived base is fetched before merge-base` — the argv `['fetch', '--no-tags', 'origin', 'main']` precedes `merge-base`; a failing base fetch → reason `tripwire`, line `tripwire could not run: git fetch of main failed: …`; `--base origin/main` given → no base fetch.
  - `a failed packet-facts write exits 1 with the decision printed` — `--run` whose `packet-facts` path is a file → exit 1, stdout still one decision line, stderr names the file.
  - `a re-run after an earlier append still states the crossing` — body `Risk-flags: migrations` + `Risk-flags-added-by-tripwire: migrations`, diff touches `migrations/` → zero `issue edit` calls and `tripwire.lines` holds the crossing line.
  - `--run writes packet-facts/tripwire-{n}.json` — the file holds `{ record, lines }`.
  - `the git argv carries --end-of-options and -z` — exact argv for `merge-base` and `diff`.
  - `control mode off makes no git call and adds no tripwire field`.
  - Update the existing control-mode-on cases per the Consumers note above.

- [ ] **Step 2: Run to verify they fail**

  Run: `node --test tests/accept-park-cli.test.js`
  Expected: FAIL on the new cases (`unknown argument: --head`).

- [ ] **Step 3: Implement** the Produces list in `plugin/bin/accept-park.js`; heavy requires stay lazy inside `runDecide`.

- [ ] **Step 4: Run to verify they pass**

  Run: `node --test tests/accept-park-cli.test.js tests/bin-lib/accept/tripwire.test.js tests/accept-monotonic-conformance.test.js tests/path-guard-conformance.test.js tests/windows-hide-spawn-conformance.test.js tests/risk-flags-writer-conformance.test.js tests/gh-host-seam-conformance.test.js`
  Expected: PASS, 0 failures.

- [ ] **Step 5: Real-input probe** (scratch, uncommitted): from the main checkout, `git fetch --no-tags origin {oid}` for a real merged PR head oid that is not on any local ref (pick one with `gh pr list --state merged --limit 5 --json headRefOid`), then `git rev-parse --verify --quiet --end-of-options {oid}^{commit}` prints the oid. `mkdir -p "$PIPELINE_RUN_DIR/evidence"`, output to `$PIPELINE_RUN_DIR/evidence/fetch-by-oid-probe.txt`. If the fetch is refused, stop and report: the tidy path then needs another design.

- [ ] **Step 6: Commit** — explicit paths; `Run the diff tripwire in accept-park.js decide — append crossed flags, force local on could-not-run, refs #4619`.

### Task 4: Tripwire lines in the packet's Deploy status at park

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/accept/park.js` (`writeParkDeployStatus`), `plugin/bin/accept-park.js` (`parkSteps.writeDeployStatus`)
- Test: `tests/bin-lib/accept/park.test.js`, `tests/accept-park-cli.test.js`

**Interfaces:**
- Consumes: `{run}/packet-facts/tripwire-{n}.json` from Task 3.
- Produces:
  - `writeParkDeployStatus(packetBody, { headSha, baseSha, notes = [] })`: `notes` is `string[]`; each must be a non-empty string with no `\r`/`\n` that does not match `park-grammar.js`'s `TARGET_RE` and starts with `tripwire` — else `TypeError`. Every existing section line matching `/^tripwire[ :]/` is removed; the notes are written directly after the four park lines, before the separating blank line. `notes: []` keeps today's output byte-identical.
  - `park` step 2 reads `{runDir}/packet-facts/tripwire-{n}.json` for each parked record: absent → `notes: []`; unreadable, unparseable or `lines` not a string array → step 2 fails (`park-failed`, nothing archived), detail `tripwire lines unreadable: {reason}` — a stated reason must never be silently lost.

- [ ] **Step 1: Write the failing tests**
  - `park.test.js`: `AC6.1: notes render after the park group` — a packet from `renderPacket` (as the existing round-trip test builds it) + `notes: ['tripwire: the diff crosses migrations (migrations/\\*\\*: migrations/001.sql), which nobody flagged, so this run is local']` → the Deploy status section holds the four park lines then that note; `parkStateOf` still reads `target: local`, `reason: awaiting-local-acceptance`; `a neutralized target\: note keeps the park state` (a note holding `target\: dev` → `parkStateOf` reads `local`); `a rewrite replaces old tripwire lines`; `a note containing target: is refused`; `a note with a newline is refused`; `no notes is byte-identical to today`.
  - `accept-park-cli.test.js`: `park writes the run's tripwire lines into the packet` (the edited comment body holds the line); `an unparseable tripwire file fails step 2`; `no tripwire file parks as before`.

- [ ] **Step 2: Run to verify they fail**

  Run: `node --test tests/bin-lib/accept/park.test.js tests/accept-park-cli.test.js`
  Expected: FAIL on the new cases.

- [ ] **Step 3: Implement** both Produces entries.

- [ ] **Step 4: Run to verify they pass**

  Run: `node --test tests/bin-lib/accept/park.test.js tests/bin-lib/accept/park-run.test.js tests/accept-park-cli.test.js tests/bin-lib/issues/accept-entry.test.js`
  Expected: PASS, 0 failures.

- [ ] **Step 5: Commit** — explicit paths; `State the tripwire reason in the parked packet's Deploy status, refs #4619`.

### Task 5: Wire the callers and the prose, then probe real inputs

**Role:** integration

**Files:**
- Modify: `plugin/bin/lib/driver/merge.js` (`acceptPark`: `decide` gets `'--head', ctx.head`)
- Test: `tests/bin-lib/driver/merge.test.js` (the case asserting the `decide` argv)
- Create: `plugin/skills/_shared/tripwire-classification.md` — the agent classification procedure, read only under control mode: classify the diff (`git diff --name-status -z -M` from the merge base to `{headRefOid}`) against the risk categories (built-ins plus policy `risk-categories`), write `[{ "category", "evidence" }]` (evidence one line, at most 300 characters) with the Write tool to a session-temp file (`_shared/session-tmp-root.md`), pass it as `--classification {file}`; a classification not written is omitted, and the packet then says `agent classification not run`. The tripwire only ever adds a flag; a human removes one only through `/claude-tweaks:specify`'s or `/claude-tweaks:backlog`'s confirmed removal path, which logs it.
- Modify: `plugin/skills/_shared/pr-first-merge.md` Step 2.9 — the `decide` command gains `--head {headRefOid} [--classification {file}]` and one clause citing `_shared/tripwire-classification.md` under control mode. **Byte-neutral (headroom):** this file is in the `merge` composed bundle, which the earlier plan audit measured at 52,493 of the 52,500-byte rail. Run `wc -c plugin/skills/_shared/pr-first-merge.md` before and after, and offset every added byte by cutting restatement inside Step 2.9 and Step 3's opening fence sentence (it restates Step 2.9's exit pair), so the file's byte count does not grow. The `rail:` tests are the gate.
- Modify: `plugin/skills/_shared/local-acceptance-park.md` step 2 (the same flags on its `decide` line; one sentence that a tripwire crossing or a could-not-run parks the run and its lines land in Deploy status)
- Modify: `plugin/skills/tidy/actions-github-issues.md` (its `decide` call gains `--head {headRefOid}`, the PR's head oid; one clause: under control mode `decide` may append a tripwire flag to the record and fetches the head by oid when it is not local)
- Modify: `plugin/skills/_shared/acceptance-packet.md` item 9 Deploy status (park adds the tripwire's `tripwire…` lines, `bin/lib/accept/tripwire.js`)
- Modify: `plugin/skills/_shared/policy-schema.md` — the `risk-path-globs` row's consumer cell (line ~217, today `risk-flags.js`) gains `accept-park.js decide` (49,198 B of the 52,500 rail; a few bytes)
- Modify: `docs/driver.md` (the local acceptance park paragraph: `decide` takes `--head`)
- Modify: `docs/plugin-structure.md` (`accept/` line gains `tripwire.js`; the `accept-park.js` CLI line gains `--head/--base/--classification`)
- Modify: `docs/skill-graph.md` only where an edge text names `decide`'s arguments
- Modify: `docs/journeys/accept-a-locally-parked-pr-4615.md` (one line: the tripwire can park a run; its `decide` line gains `--head {sha}`)
- Read only, not modified (plan-audit Check B hits, reviewed): `plugin/bin/lib/risk-path-globs.js`, `plugin/bin/lib/policy.js`, `plugin/bin/lib/policy-schema.js`, `plugin/bin/resolve-policy.js`, `plugin/bin/lib/model-profiles/policy-fragment.js` (the reader and resolver this record consumes unchanged); `plugin/skills/_shared/policy-schema-coverage.md`, `plugin/skills/_shared/policy-schema-read-path.md`, `docs/journeys/resolve-a-policy-key.md` (describe the unchanged resolver); `plugin/bin/blast-radius.js` (precedent only); `docs/superpowers/plans/2026-11-16-acceptance-target-resolution.md` and `docs/plans/2026-11-02-risk-flags-at-intent-time-ledger.md` (historical); `tests/bin-lib/driver/fixtures/merge-check-verdicts.json` (record bodies mentioning the reader); `tests/bin-lib/issues/record-acceptance-target.test.js`, `tests/resolve-policy-control-mode.test.js`, `tests/risk-flags-cli.test.js` (pin the unchanged reader, resolver and `log-removals` CLI).
- Test: `tests/accept-park-prose-conformance.test.js` — update its pinned text where these edits change it, and add one assertion that Step 2.9, `local-acceptance-park.md` and tidy's arm all name `--head`.

**Interfaces:**
- Consumes: Task 3's flags.
- Produces: nothing new.

- [ ] **Step 1: Write the failing tests** — the driver test asserting `decide`'s argv includes `--head {head}`; the prose assertion above.
- [ ] **Step 2: Run to verify they fail** — `node --test tests/bin-lib/driver/merge.test.js tests/accept-park-prose-conformance.test.js`; Expected: FAIL on the new assertions.
- [ ] **Step 3: Implement** the edits. Before editing any `plugin/skills/**/*.md`, measure `wc -c` against `RAIL_BYTES` (`plugin/bin/lib/skill-audit/budgets.js`) and keep each sentence short.
- [ ] **Step 4: Run to verify they pass** — the same command, then `node --test tests/skill-*.test.js tests/bin-lib/skill-audit/context-cost.test.js` for the rail suites. Expected: PASS.
- [ ] **Step 5: Real-input probes** (scratch, uncommitted; evidence per the AC-evidence persistence rule):
  - `mkdir -p "$PIPELINE_RUN_DIR/evidence"`, then on this branch: `git merge-base origin/main HEAD` (its own call, pasted), `git diff --name-status -z -M --no-color --no-ext-diff --end-of-options {mergeBase}..HEAD` fed to `parseNameStatus` and `evaluateTripwire` with `globs: { 'public-contract': ['plugin/skills/_shared/**'] }` → expect `public-contract` crossed by a `plugin/skills/_shared/` path this branch touches; and a real rename from history (`git log --diff-filter=R --name-status -z -M -1 --format=` output) parsed to both paths. Output to `$PIPELINE_RUN_DIR/evidence/tripwire-probe.txt`.
  - `node plugin/bin/accept-park.js decide --run "$PIPELINE_RUN_DIR" --record 4619` (this repo runs control mode off) → `consulted: false`, no git call.
  - One `decisions.md` `AUTO` entry, `--step "AC evidence"`, via `--text-file`, naming AC7.4/AC1.1 and the evidence path.
- [ ] **Step 6: Commit** — explicit paths; `Pass the head and the agent classification to decide at every merge site, refs #4619`.

### Task 6: The record is the one durable removal log

**Role:** integration

**Files:**
- Modify: `plugin/skills/specify/shaping-mode-stamping.md` `### Risk flags` step 5: under `github-issues`, once the record write has landed, post one record comment per `removed` slug with exactly `Risk flag {slug} removed by the maintainer during shaping` — always, with or without a run dir, because the record is the one durable removal log the diff tripwire reads (#4619); with a run dir, also run the existing `log-removals` call for the run's `decisions.md` audit line, and its `logged: false` or non-zero exit then needs no comment fallback (the comments are already posted). `local-files` keeps today's behavior (the Gotchas bullet with no run dir, `log-removals` with one): the tripwire reads records through `gh` only. The "only once the record write has landed" and "never for a `refused` run or a failed write" clauses stay.
- Modify: `plugin/skills/backlog/refine-risk-flags.md` step 6 (cites step 5; drop its comment-fallback sentence where step 5 now always posts)
- Modify: `plugin/skills/specify/record-creation-subissues.md` — its removal-logging sentence (comments after the create, always, under `github-issues`)
- Modify: `plugin/bin/risk-flags.js` — header comment only (the `log-removals` CLI is unchanged)
- Modify: `docs/plugin-structure.md` — the `log-removals` line ("the skill then falls back to a record comment" → the skill always posts the record comment under `github-issues`)
- Modify: `docs/journeys/flag-invisible-risk-when-shaping-4618.md` — line 52
- Test: `tests/risk-flags-prose-conformance.test.js` (`LOGGING_PINS`: drop the pins whose clause no longer holds under `github-issues` — the non-zero-exit comment fallback for `/specify` and sub-issues — and pin the new clause `always, with or without a run dir`; keep the go-red controls passing)
- Test: `tests/risk-flags-refine-prose.test.js` (its `sub-file Write` pins for step 6)

**Interfaces:**
- Consumes: Task 1's `removalLogSlugs` grammar (the comment text is exactly what it reads).
- Produces: nothing new.

- [ ] **Step 1: Write the failing tests** — the new `LOGGING_PINS` entry and the refine pin; `the removal comment text is exactly what removalLogSlugs reads` (a test in `tests/bin-lib/accept/tripwire.test.js` reading the literal from `shaping-mode-stamping.md` step 5 and feeding it, with `{slug}` replaced by `auth`, to `removalLogSlugs` → `['auth']`).
- [ ] **Step 2: Run to verify they fail** — `node --test tests/risk-flags-prose-conformance.test.js tests/risk-flags-refine-prose.test.js tests/bin-lib/accept/tripwire.test.js`; Expected: FAIL on the new pins.
- [ ] **Step 3: Implement** the prose edits; measure `wc -c` before and after each `plugin/skills/**/*.md` against `RAIL_BYTES`.
- [ ] **Step 4: Run to verify they pass** — the same command plus `node --test tests/risk-flags-cli.test.js tests/skill-*.test.js tests/bin-lib/skill-audit/context-cost.test.js`. Expected: PASS.
- [ ] **Step 5: Commit** — explicit paths; `Always post the removal comment so the record is the tripwire's removal log, refs #4619`.

## Orchestrator step (not dispatched)

After the tasks, file the follow-up backlog record spec Decision 2 requires, via `/claude-tweaks:capture`, with a spec-shaped body (Current State: no `local-merge` merge site resolves an acceptance target, so neither `accept-park.js decide` nor the tripwire runs there; Deliverables: a `decide` call (with `--head` and the agent classification) before the `local-merge` merge, parking the run on `park:true`; Acceptance Criteria: under `control-mode: on` with `integration-model: local-merge`, a crossing parks the run and a `consulted:false` decision merges as today) and `Defer-reason: genuinely-larger`.

## Spec coverage notes

- Waived AC10.1: `npm test` passing is the run's verification gate (`/build` Common Step 5 and `/claude-tweaks:test`), not a task test.
- The spec's `plugin/bin/blast-radius.js` (Technical Approach, Key Files) is read-only precedent; the shared matcher is consumed from `plugin/bin/lib/issues/blast-radius.js`, unmodified.
- "`accept/` imports only `addRiskFlags`": `plugin/bin/lib/accept/` imports nothing from the flag record; `bin/accept-park.js` imports `addTripwireRiskFlags`, which is `addRiskFlags` plus the tripwire line the spec requires. The conformance scan pins the property the sentence protects: no removal in either.
- The diff read passes `-z`, `--no-ext-diff` and `--end-of-options` beyond the spec's `git diff --name-status -M --no-color` text, per the repo's git-seam rules; it reads the same paths.
- Decision 2: the agent classification and the `evaluateTripwire` call are wired in `_shared/pr-first-merge.md` Step 2.9. The driver and tidy also call `decide`, which runs the tripwire under control mode; they pass `--head` and no classification, so their packets say `agent classification not run`.
