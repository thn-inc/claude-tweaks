# Diff Tripwire Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Before the merge decision under control mode, cross-check the record's declared risk flags against what the diff actually touched, append any newly crossed category as a flag (never remove one), and switch the run to local acceptance with the reason stated in the acceptance packet.

**Architecture:** A pure evaluator, `plugin/bin/lib/accept/tripwire.js`, takes changed paths, declared flags, removal history, the `risk-path-globs` map and an optional agent classification and returns additions only. `bin/accept-park.js decide` (the one decision point every merge-capable site already calls at `_shared/pr-first-merge.md` Step 2.9) gathers those inputs from git, the record and policy, runs the evaluator, appends new flags through a sanctioned widening writer in `record-risk-flags.js`, feeds the result to `resolveAcceptanceTarget` through a new `tripwire` input, and writes the packet lines to the run dir; `park` writes those lines into the packet's Deploy status section.

**Tech Stack:** Node 18+ CommonJS, `node --test`, `gh`/`git` through the CLI's injected `deps` seam (`gh-api-module-pattern` skill).

**Spec:** `.claude-tweaks/pipelines/2026-11-16T173231-record-4619/work/4619-spec.md`

Scope keywords: resolveAcceptanceTarget, writeParkDeployStatus, accept-park.js decide, risk-path-globs

## Global Constraints

- Runs only under `control-mode: on`; with it off `decide` reads nothing new and prints `consulted: false` exactly as today.
- Monotonic: the tripwire may add a flag, never remove one; `result.flags` is always a superset of `declaredFlags`.
- Fail toward caution: malformed globs, a failed diff, a malformed classification or a failed flag write force `local` and say so; never reported as "no crossing found". An unset or `{}` `risk-path-globs` is not a failure: the glob signal is off.
- Exact packet copy: `tripwire could not run: {reason}`, `path globs not configured`, `agent classification not run`, and the removal sentence `you removed the {slug} flag at intent; the diff touches {path}, so this run is local`.
- Evidence is capped at 300 characters and rendered inert: reuse `inertEvidence` from `plugin/bin/lib/issues/risk-flag-classify.js`.
- Matching reuses `isSensitivePath` from `plugin/bin/lib/issues/blast-radius.js` unmodified; the shared matcher and its other consumers are not changed.
- No line written into the Deploy status section by this record may contain `target:` (`park-grammar.js`'s `TARGET_RE` matches it mid-line).
- Scope and edit discipline: "Commit tests only where the task asks for them or the repo already keeps tests for this kind of change, sized like the neighboring test files; scratch checks stay scratch. Touch only what the task requires — a pre-existing bug you notice is a follow-up to report, not a fix to fold in, unless the task cannot work without it. Don't reformat or "improve" adjacent code; edit in place rather than rewrite when the result is the same."
- Source-scan suites over `plugin/bin/`: every `execFileSync`/`spawnSync` carries `windowsHide: true`; no bare `fs.existsSync`/`fs.realpathSync` (`tests/path-guard-conformance.test.js`); a git argv takes `--end-of-options` before a caller-supplied ref where git accepts it.

## Review Focus

1. A rename line `R087\told\tnew` (similarity score not 100) and a copy line `C100\ta\tb` from `git diff --name-status -M` must yield both paths; an unrecognised status letter must make the parse fail (could-not-run), never drop the line. Pinned in Task 1 (`parseNameStatus` tests).
2. A path with a trailing slash, `./`, `..` segments, backslashes and mixed case must normalise before matching, and a path normalising above the repo root (`../x`) must not match `migrations/**`. Pinned in Task 1 (AC8 tests).
3. Two records in one `decide` call share one diff: git runs once, and each record gets its own crossings against its own declared flags. Pinned in Task 3.
4. A re-run of `decide` on a record whose earlier run already appended the tripwire flag finds the flag declared, appends nothing and writes the body zero times. Pinned in Task 3.
5. An agent classification entry whose evidence carries a newline, a backtick or a `target:` substring renders as one inert line that never alters the park state. Pinned in Task 1 and Task 4.

---

### Task 1: Pure tripwire evaluator

**Role:** judgment
**Review risk:** high

**Files:**
- Create: `plugin/bin/lib/accept/tripwire.js`
- Test: `tests/bin-lib/accept/tripwire.test.js`

**Interfaces:**
- Consumes: `isSensitivePath(path, globs)` from `plugin/bin/lib/issues/blast-radius.js`; `inertEvidence(text)` from `plugin/bin/lib/issues/risk-flag-classify.js`; `BUILTIN_RISK_CATEGORIES` from `plugin/bin/lib/policy-schema.js`.
- Produces:
  - `evaluateTripwire({ changedPaths, diffError, declaredFlags, removedFlags, globs, agentClassification, categories }) -> { status: 'ok'|'could-not-run', reason?: string, crossed: Array<{ category, via: 'glob'|'agent', evidence }>, newFlags: string[], flags: string[], notes: string[], removedThenCrossed: Array<{ category, evidence }> }`.
    - `changedPaths`: `string[]`; anything else is could-not-run with `reason` = `diffError` when it is a non-empty string, else `changed paths not read`.
    - `declaredFlags`: `string[]` (the record's kept flags); not an array of strings → could-not-run `declared flags not read`.
    - `removedFlags`: `string[]` or `null` (log unreadable → no removal sentence, tripwire still fires).
    - `globs`: `undefined` or a plain object with no keys → glob signal off, `notes` gets `path globs not configured`. A plain object whose every key is in `categories` and every value is a non-empty array of non-empty strings → on. Anything else (`null`, a string, an array, a value that is not a list, a non-string glob, a key outside `categories`) → could-not-run `risk-path-globs is not a map of category to glob list`.
    - `agentClassification`: `undefined`/`null` → `notes` gets `agent classification not run`. An array of `{ category: string, evidence: string }` → each entry with `category` in `categories` crosses `via: 'agent'`; an unknown category is ignored and `notes` gets `agent classification category ignored: {inert category}`. Any other shape (not an array, an entry not an object, non-string fields) → could-not-run `agent classification malformed`.
    - `categories`: `string[]`, default `BUILTIN_RISK_CATEGORIES`.
    - Order: globs first, then agent; one `crossed` entry per category, the first match wins (a category matched by both is `via: 'glob'`). Glob evidence is `inertEvidence(\`${glob}: ${path}\`)`, the path as git printed it; agent evidence is `inertEvidence(evidence)`.
    - `crossed` lists every crossed category, declared ones included; `newFlags` is the crossed categories not in `declaredFlags`, in `crossed` order; `flags` is `declaredFlags` followed by `newFlags`. `removedThenCrossed` is the `newFlags` entries present in `removedFlags`, each with its crossing's evidence.
    - could-not-run: `crossed: []`, `newFlags: []`, `flags` a copy of `declaredFlags`, `notes: []`, `removedThenCrossed: []`.
  - `normalizeRepoPath(p: string) -> string`: backslashes to `/`, leading `./` stripped, `path.posix.normalize`, trailing `/` dropped, lowercased. Globs are lowercased the same way before `isSensitivePath`.
  - `parseNameStatus(text: string) -> string[] | null`: lines of `git diff --name-status -M --no-color`; `A|M|D|T\tpath` → `[path]`, `R\d*\told\tnew` and `C\d*\told\tnew` → `[old, new]`; blank lines skipped; any other line → `null`. Empty text → `[]`.
  - `removedFlagsFrom(texts: string[]) -> string[]`: every slug in a line containing exactly `Risk flag {slug} removed by the maintainer during shaping` (slug `[a-z0-9-]+`), deduplicated, in first-seen order.
  - `tripwireLines(result, { appendFailure?: string }) -> string[]`: the packet lines, each one line of inert text, none containing `target:`:
    - could-not-run: `tripwire could not run: {reason}`.
    - per `newFlags` category not in `removedThenCrossed`: `tripwire: the diff crosses {category} ({evidence}), which nobody flagged, so this run is local`.
    - per `removedThenCrossed` entry: `tripwire: you removed the {category} flag at intent; the diff touches {evidence path}, so this run is local` — for a glob crossing `{evidence path}` is the path, for an agent crossing it is the evidence.
    - every `notes` entry as `tripwire: {note}`.
    - with `appendFailure`: `tripwire: the flag write failed ({inert appendFailure}), so this run is local`.

- [ ] **Step 1: Write the failing tests** in `tests/bin-lib/accept/tripwire.test.js`:
  - `AC1.1: migrations/001_add_users.sql with glob migrations/** and no declared flags crosses migrations via glob` — `evaluateTripwire({ changedPaths: ['migrations/001_add_users.sql'], declaredFlags: [], removedFlags: [], globs: { migrations: ['migrations/**'] } })` → `status: 'ok'`, `crossed: [{ category: 'migrations', via: 'glob', evidence: 'migrations/\\*\\*: migrations/001_add_users.sql' }]` (the evidence value as `inertEvidence` returns it — compute the expectation by calling `inertEvidence`, never hand-escape), `newFlags: ['migrations']`, `flags: ['migrations']`.
  - `AC2.1: a crossing of an already declared category adds no flag` — declared `['migrations']`, same diff → `newFlags: []`, `flags: ['migrations']`.
  - `AC3.1: agent classification naming auth with no glob match adds auth via agent` — `agentClassification: [{ category: 'auth', evidence: 'login handler changed' }]`, `globs: {}` → `crossed: [{ category: 'auth', via: 'agent', evidence: 'login handler changed' }]`, `newFlags: ['auth']`.
  - `AC4.1: declared [migrations] and a diff touching nothing sensitive keeps flags equal to declared` → `newFlags: []`, `flags: ['migrations']`.
  - `AC5.1: property — flags is a superset of declaredFlags for 500 seeded random inputs, and could-not-run leaves flags equal to declaredFlags` — a seeded linear-congruential generator (fixed seed, no `Math.random`) drawing declared subsets of the four built-ins, 0-6 paths from a pool mixing sensitive and plain paths, globs that are either a valid map or one of the malformed shapes, and optional classifications; assert `declaredFlags.every((f) => result.flags.includes(f))` every time and `deepEqual(result.flags, declaredFlags)` whenever `status === 'could-not-run'`.
  - `AC7.1: malformed risk-path-globs is could-not-run` — one subtest each for `'migrations/**'` (a string), `{ migrations: 'migrations/**' }` (a non-list), `{ migrations: [7] }` (a non-string glob), `null`, and `{ bogus: ['x/**'] }` (unknown category): `status: 'could-not-run'`, `reason: 'risk-path-globs is not a map of category to glob list'`, `newFlags: []`; and `tripwireLines(result)` deep-equals `['tripwire could not run: risk-path-globs is not a map of category to glob list']`.
  - `AC7.1: a git failure is could-not-run with its reason` — `changedPaths: null, diffError: 'git merge-base failed'` → `reason: 'git merge-base failed'`.
  - `AC7.2: absent or {} risk-path-globs is ok with the glob signal off` — `globs: undefined` and `globs: {}` with a `migrations/` path and no classification → `status: 'ok'`, `newFlags: []`, `notes` deep-equals `['path globs not configured', 'agent classification not run']`.
  - `AC7.3: an empty diff is ok with no crossings`.
  - `AC7.4: a rename from migrations/a.sql to docs/a.sql crosses migrations` — `evaluateTripwire({ changedPaths: parseNameStatus('R100\tmigrations/a.sql\tdocs/a.sql\n'), … })` → `newFlags: ['migrations']`.
  - `AC7.5: a deletion of migrations/a.sql crosses migrations` — via `parseNameStatus('D\tmigrations/a.sql\n')`.
  - `AC8.1: normalization` — `normalizeRepoPath` of `./migrations/x.sql`, `app/../migrations/x.sql`, `Migrations/x.sql`, `migrations\\x.sql`, `migrations/dir/` gives `migrations/x.sql` ×4 and `migrations/dir`.
  - `AC8.2: ./migrations/x.sql, app/../migrations/x.sql and Migrations/x.sql cross migrations/**`.
  - `AC8.3: docs/migrations-notes.md and src/migrations-readme.md do not cross migrations/**`; also `../migrations/x.sql` does not.
  - `AC8.4: src/auth/login.js crosses src/auth/** and src/auth-utils-readme.md does not`.
  - `Waived AC8.5`: scheme and percent-encoding variants do not apply to repo-relative git paths (spec says not tested).
  - `AC9.1: a flag removed at intent still fires, and the lines name the removal` — `declaredFlags: [], removedFlags: ['migrations']`, glob hit on `migrations/001.sql` → `newFlags: ['migrations']`, `removedThenCrossed` names it, and `tripwireLines(result)` contains `tripwire: you removed the migrations flag at intent; the diff touches migrations/001.sql, so this run is local`.
  - `AC9.1: an unreadable removal log (removedFlags null) still fires and omits the removal sentence`.
  - `AC6.1: evidence is inert and capped` — a classification evidence of 400 characters holding `\n`, a backtick, `[x](y)` and `target: dev` → the crossed evidence equals `inertEvidence(...)` of it, has length ≤ 300, and no `tripwireLines` entry contains `\n` or matches `/(?:^|\s)target:/`.
  - `parseNameStatus` cases: `R087\told\tnew` → `['old', 'new']`, `C100\ta\tb` → `['a', 'b']`, `X\tfoo` → `null`, `''` → `[]`.
  - `removedFlagsFrom`: a decisions.md line `- KEPT-PROMPT 10:00:00 — Risk flags: Risk flag auth removed by the maintainer during shaping. Reversibility: low.` and a bare comment `Risk flag migrations removed by the maintainer during shaping` → `['auth', 'migrations']`; a line `Risk flag Auth removed …` (uppercase) yields nothing.
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

**Files:**
- Modify: `plugin/bin/lib/accept/target.js`
- Modify: `plugin/bin/lib/issues/record-risk-flags.js` (add `addTripwireRiskFlags`), `plugin/bin/lib/issues/record.js` (re-export it)
- Test: `tests/bin-lib/accept/target.test.js`, `tests/bin-lib/issues/record-risk-flags.test.js`, new `tests/accept-monotonic-conformance.test.js`

**Interfaces:**
- Consumes: `addRiskFlags`, `parseRiskFlags` (same module).
- Produces:
  - `resolveAcceptanceTarget({ keptRiskFlags, itemOverride, policyDefault, tripwire })`: `tripwire` optional; `undefined` keeps today's behavior exactly. Present: must be `{ status: 'ok'|'could-not-run', newFlags: string[] }` else `invalid-input`. Precedence: input validation, then `tripwire.status === 'could-not-run'` → `{ target: 'local', reason: 'tripwire' }`, then kept risk flags or `tripwire.newFlags.length > 0` → `{ target: 'local', reason: 'risk-flag' }`, then the existing override/policy/default chain. `REASONS` gains `'tripwire'` (append at the end).
  - `addTripwireRiskFlags(body, slugs, opts) -> body`: `addRiskFlags(body, slugs, opts)` then exactly one preamble line `Risk-flags-added-by-tripwire: {slugs}` holding the union of any slugs that line already named and `slugs`, canonical order (the module's `canonicalOrder`), placed directly below the `Risk-flags:` line and its `Risk-flags-unconfirmed:` marker when one is present; an existing line is rewritten in place. `slugs: []` returns the body unchanged. CRLF handling as the other writers (`editBody`).

- [ ] **Step 1: Write the failing tests**
  - `target.test.js`: `tripwire could-not-run forces local by tripwire even with policyDefault dev`; `tripwire newFlags [auth] with no kept flags resolves local by risk-flag` (AC1.1/AC3.1 target half); `tripwire ok with no newFlags and policyDefault dev resolves dev`; `a malformed tripwire ({status:'maybe'}) is invalid-input`; `REASONS ends with 'tripwire'`.
  - `record-risk-flags.test.js`: `addTripwireRiskFlags adds the flag and the tripwire line` — body `# T\n\nRisk-flags: none\n\n## Overview\n` + `['migrations']` → `Risk-flags: migrations` then `Risk-flags-added-by-tripwire: migrations` on the next line; `a second call unions the tripwire line` (`['auth']` after `['migrations']` → `Risk-flags: migrations, auth` and `Risk-flags-added-by-tripwire: migrations, auth`); `parseRiskFlags ignores the tripwire line` (status `ok`, flags as declared); `the line sits below an unconfirmed marker`; `[] is byte-identical`; `a uniformly CRLF body stays CRLF`.
  - `tests/accept-monotonic-conformance.test.js` (follow the `bin-source-scan-conformance` skill: `stripComments`/`stripperVerdict` from `tests/helpers/strip-comments`, a mis-parse is an offender): scans every `plugin/bin/lib/accept/*.js` plus `plugin/bin/accept-park.js`; fails on any reference to `removeRiskFlag`/`removeRiskFlags`/`confirmRiskFlags` and on any function or method declaration whose name matches `/remove\w*flag|narrow\w*flag/i`; floor: at least 6 files scanned and `tripwire.js` among them; go-red self-tests: a fixture text `const { removeRiskFlag } = require('../issues/record');` and `function removeTripwireFlag() {}` are each reported, and the real tree reports none.

- [ ] **Step 2: Run to verify they fail**

  Run: `node --test tests/bin-lib/accept/target.test.js tests/bin-lib/issues/record-risk-flags.test.js tests/accept-monotonic-conformance.test.js`
  Expected: FAIL on the new tests only (`addTripwireRiskFlags is not a function`, the tripwire target cases); the conformance real-tree check passes, its self-tests pass.

- [ ] **Step 3: Implement** the two Produces entries; keep `target.js` pure.

- [ ] **Step 4: Run to verify they pass**

  Run: `node --test tests/bin-lib/accept/target.test.js tests/bin-lib/issues/record-risk-flags.test.js tests/accept-monotonic-conformance.test.js tests/risk-flags-writer-conformance.test.js tests/bin-lib/accept/park.test.js`
  Expected: PASS, 0 failures.

- [ ] **Step 5: Commit** — explicit paths; `Add the tripwire target input and the widening tripwire flag writer, refs #4619`.

### Task 3: Run the tripwire in `accept-park.js decide`

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/accept-park.js` (`VERBS.decide`, `parseArgs`, `runDecide`, `USAGE`, header comment)
- Test: `tests/accept-park-cli.test.js`

**Interfaces:**
- Consumes: Task 1's `evaluateTripwire`, `parseNameStatus`, `removedFlagsFrom`, `tripwireLines`; Task 2's `addTripwireRiskFlags` (through `./lib/issues/record`) and the `tripwire` input; `readRiskPolicy` (`pathGlobs`, `globsInvalid`, `extraCategories`); `isTrustedComment` from `plugin/bin/lib/issues/comment-trust.js`; `BUILTIN_RISK_CATEGORIES`.
- Consumers of `decide`'s output (classified for the widened shape): `plugin/bin/lib/driver/merge.js` `acceptPark` reads `d.park`, `decisions[0].record/park/consulted` only — unaffected by added fields; `_shared/local-acceptance-park.md` and tidy's `actions-github-issues.md` read `park` only; `tests/accept-park-cli.test.js` assertions with control mode on are updated in this task.
- Produces:
  - New optional flags on `decide`: `--head <sha>` (HEAD_SHA_RE), `--base <ref>` (`/^[A-Za-z0-9._\/-]+$/`, not starting with `-`), `--classification <file>`.
  - Control mode off: unchanged — no git call, no new field.
  - Control mode on, once per invocation: the diff. No `--head` → `changedPaths: null, diffError: 'no --head given'`. Base: `--base`, else policy `integration-branch` (`resolvePolicyKeys` over the same sources) as `origin/{name}`, else the output of `git rev-parse --abbrev-ref origin/HEAD`; then `git merge-base --end-of-options {base} {head}` and `git diff --name-status -M --no-color {mergeBase}..{head}` through `ctx.git`, parsed by `parseNameStatus`; any throw or a `null` parse → `diffError` naming the failed step (`git merge-base failed: {first line}`, `git diff output unparseable`).
  - Classification: `--classification` absent → `undefined`; present → `JSON.parse(deps.readFile(file))`; an unreadable or unparseable file → passed as the string `'unreadable'`, which `evaluateTripwire` reports as `agent classification malformed`.
  - Per record: `gh issue view {n} --json body,comments`; `removedFlags = removedFlagsFrom([...trusted comment bodies, run decisions.md text when --run])`, `null` when the comments are not a list; `declaredFlags` = the existing `keptRiskFlags(parseRiskFlags(...))` result; `categories = [...BUILTIN_RISK_CATEGORIES, ...extraCategories]`; `globs = globsInvalid ? null : pathGlobs`.
  - When `newFlags` is non-empty: write `addTripwireRiskFlags(body, newFlags, { extraCategories })` to a `deps.tmpPath` file and `gh issue edit {n} --body-file {file}` (`ctx.ghIssue`), temp removed in `finally`; a failure sets `appendFailure` to the error's first line and writes a stderr line, and the exit code stays 0 — the decision already resolves local through `newFlags`.
  - The decision object gains `tripwire: { status, reason?, crossed, newFlags, flags, notes, removedThenCrossed, appendFailed: boolean, lines }` (`lines` = `tripwireLines(result, { appendFailure })`); `decideSeries` receives `input.tripwire = { status, newFlags }` and the record's input otherwise as today.
  - With `--run`: writes `{run}/packet-facts/tripwire-{n}.json` = `{ "record": n, "lines": [...] }` (mkdir the `packet-facts` directory with `recursive: true`); a failed write is a stderr line and changes nothing else.
  - An unreadable record body keeps today's behavior (invalid-input, exit 1) and runs no tripwire for that record.

- [ ] **Step 1: Write the failing tests** in `tests/accept-park-cli.test.js`, using its existing fake `gh`/`git`/`readFile` seams and a control-mode-on `policy.yml` fixture with `risk-path-globs:\n  migrations: [migrations/**]`:
  - `AC1.1: decide appends migrations, writes the tripwire line and parks` — fake git returns a merge-base sha and `A\tmigrations/001_add_users.sql`; body `Risk-flags: none`; expect one `gh issue edit` whose body file holds `Risk-flags: migrations` and `Risk-flags-added-by-tripwire: migrations`, and decision `park: true, target: 'local', reason: 'risk-flag'`, `tripwire.newFlags: ['migrations']`.
  - `AC2.1: a declared crossing writes nothing` — body `Risk-flags: migrations` → zero `issue edit` calls (Review Focus 4).
  - `AC7.1: no --head under control mode is could-not-run and parks` — `reason: 'tripwire'`, `tripwire.lines` deep-equals `['tripwire could not run: no --head given']`.
  - `AC7.1: a malformed risk-path-globs block is could-not-run` — `risk-path-globs:\n  migrations: x` → `tripwire.status: 'could-not-run'`, reason `tripwire`.
  - `AC7.2: absent risk-path-globs with policyDefault dev resolves dev` — no globs, no classification, plain diff → `park: false`, `target: 'dev'`, `tripwire.lines` deep-equals `['tripwire: path globs not configured', 'tripwire: agent classification not run']`.
  - `AC7.6: a failed flag append still parks local and reports it` — fake `gh issue edit` throws `HTTP 502` → exit 0, `park: true`, `tripwire.appendFailed: true`, a `lines` entry `tripwire: the flag write failed (HTTP 502), so this run is local`.
  - `AC3.1: --classification auth adds auth via agent` — classification file `[{"category":"auth","evidence":"login handler changed"}]`, plain diff.
  - `AC9.1: a trusted removal comment names the removal` — comments `[{ body: 'Risk flag migrations removed by the maintainer during shaping', authorAssociation: 'OWNER' }]` → a `lines` entry with `you removed the migrations flag at intent`; the same comment with `authorAssociation: 'NONE'` → no removal sentence, flag still added.
  - `two records share one diff` — `--record 1,2` → exactly one `merge-base` and one `diff` git call, each record decided against its own body (Review Focus 3).
  - `--run writes packet-facts/tripwire-{n}.json` — the file holds `{ record, lines }`.
  - `control mode off makes no git call and adds no tripwire field`.
  - Update existing control-mode-on cases that expect `dev` to pass `--head` and a fake git diff with no sensitive path.

- [ ] **Step 2: Run to verify they fail**

  Run: `node --test tests/accept-park-cli.test.js`
  Expected: FAIL on the new cases (`unknown argument: --head`).

- [ ] **Step 3: Implement** the Produces list in `plugin/bin/accept-park.js`; heavy requires stay lazy inside `runDecide`.

- [ ] **Step 4: Run to verify they pass**

  Run: `node --test tests/accept-park-cli.test.js tests/bin-lib/accept/tripwire.test.js tests/accept-monotonic-conformance.test.js tests/path-guard-conformance.test.js tests/windows-hide-spawn-conformance.test.js tests/risk-flags-writer-conformance.test.js`
  Expected: PASS, 0 failures.

- [ ] **Step 5: Commit** — explicit paths; `Run the diff tripwire in accept-park.js decide — append crossed flags, force local on could-not-run, refs #4619`.

### Task 4: Tripwire lines in the packet's Deploy status at park

**Role:** integration

**Files:**
- Modify: `plugin/bin/lib/accept/park.js` (`writeParkDeployStatus`), `plugin/bin/accept-park.js` (`parkSteps.writeDeployStatus`)
- Test: `tests/bin-lib/accept/park.test.js`, `tests/accept-park-cli.test.js`

**Interfaces:**
- Consumes: `{run}/packet-facts/tripwire-{n}.json` from Task 3.
- Produces:
  - `writeParkDeployStatus(packetBody, { headSha, baseSha, notes = [] })`: `notes` is `string[]`; each must be a non-empty string with no `\r`/`\n` that does not match `park-grammar.js`'s `TARGET_RE` and starts with `tripwire` — else `TypeError`. Every existing section line matching `/^tripwire[ :]/` is removed; the notes are written directly after the four park lines, before the separating blank line. `notes: []` keeps today's output byte-identical.
  - `park` step 2 reads `{runDir}/packet-facts/tripwire-{n}.json` for each parked record: absent → `notes: []`; unreadable, unparseable or `lines` not a string array → step 2 fails (`park-failed`, nothing archived), detail `tripwire lines unreadable: {reason}` — a stated reason must never be silently lost.

- [ ] **Step 1: Write the failing tests**
  - `park.test.js`: `AC6.1: notes render after the park group` — a packet from `renderPacket` (as the existing round-trip test builds it) + `notes: ['tripwire: the diff crosses migrations (migrations/\\*\\*: migrations/001.sql), which nobody flagged, so this run is local']` → the Deploy status section holds the four park lines then that note; `parkStateOf` still reads `target: local`, `reason: awaiting-local-acceptance`; `a rewrite replaces old tripwire lines`; `a note containing target: is refused`; `a note with a newline is refused`; `no notes is byte-identical to today`.
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
- Modify: `plugin/bin/lib/driver/merge.js` (`acceptPark`: `decide` gets `'--head', ctx.head`), `tests/bin-lib/driver/merge.test.js` (the case asserting the `decide` argv)
- Create: `plugin/skills/_shared/tripwire-classification.md` — the agent classification procedure, read only under control mode: classify the diff (`git diff --name-status -M` from the merge base to `{headRefOid}`) against the risk categories (built-ins plus policy `risk-categories`), write `[{ "category", "evidence" }]` (evidence one line, at most 300 characters) with the Write tool to a session-temp file (`_shared/session-tmp-root.md`), pass it as `--classification {file}`; a classification not written is omitted, and the packet then says `agent classification not run`. The tripwire only ever adds a flag; a human removes one only through `/claude-tweaks:specify`'s or `/claude-tweaks:backlog`'s confirmed removal path, which logs it.
- Modify: `plugin/skills/_shared/pr-first-merge.md` Step 2.9 — the `decide` command gains `--head {headRefOid} [--classification {file}]` and one clause citing `_shared/tripwire-classification.md` under control mode. **Byte-neutral (headroom):** this file is in the `merge` composed bundle, which plan audit measured at 52,493 of a 52,500-byte rail. Run `wc -c plugin/skills/_shared/pr-first-merge.md` before and after, and offset every added byte by cutting restatement inside Step 2.9 and Step 3's opening fence sentence (it restates Step 2.9's exit pair), so the file's byte count does not grow. The `rail:` tests are the gate.
- Modify: `plugin/skills/_shared/local-acceptance-park.md` step 2 (the same flags on its `decide` line; one sentence that a tripwire crossing or a could-not-run parks the run and its lines land in Deploy status)
- Modify: `plugin/skills/tidy/actions-github-issues.md` (its `decide` call gains `--head {headRefOid}`)
- Modify: `plugin/skills/_shared/acceptance-packet.md` item 9 Deploy status (park adds the tripwire's `tripwire…` lines, `bin/lib/accept/tripwire.js`)
- Modify: `plugin/skills/_shared/policy-schema-read-path.md` / `policy-schema.md` — `risk-path-globs`'s consumer cell gains `bin/accept-park.js decide (#4619)` wherever that table names its consumers
- Modify: `docs/driver.md` (the local acceptance park paragraph: `decide` takes `--head`), `docs/plugin-structure.md` (`accept/` line gains `tripwire.js`; the `accept-park.js` CLI line gains `--head/--base/--classification`), `docs/skill-graph.md` only where an edge text names `decide`'s arguments
- Read only, not modified (plan-audit Check B hits for the scope keywords, reviewed): `plugin/bin/lib/risk-path-globs.js`, `plugin/bin/lib/policy.js`, `plugin/bin/lib/policy-schema.js`, `plugin/bin/resolve-policy.js` (the `risk-path-globs` reader and resolver this record consumes unchanged), `plugin/bin/blast-radius.js` (precedent only, per the spec's Key Files), the `#4615` plan and journeys, and the policy/risk-flag test suites (they pin the reader, which is unchanged). `docs/journeys/accept-a-locally-parked-pr-4615.md` gets one line noting the tripwire can park a run (its `decide` URL line gains `--head {sha}`).
- Test: any prose-conformance suite pinning these files (`tests/accept-park-prose-conformance.test.js`, `tests/risk-flags-prose-conformance.test.js`) — update its pinned text, and add one assertion that Step 2.9 and `local-acceptance-park.md` both name `--head`.

**Interfaces:**
- Consumes: Task 3's flags.
- Produces: nothing new.

- [ ] **Step 1: Write the failing tests** — the driver test asserting `decide`'s argv includes `--head {head}`; the prose assertion above.
- [ ] **Step 2: Run to verify they fail** — `node --test tests/bin-lib/driver/merge.test.js tests/accept-park-prose-conformance.test.js`; Expected: FAIL on the new assertions.
- [ ] **Step 3: Implement** the edits. Before editing any `plugin/skills/**/*.md`, measure `wc -c` against `RAIL_BYTES` (`plugin/bin/lib/skill-audit/budgets.js`) and keep each sentence short.
- [ ] **Step 4: Run to verify they pass** — the same command, then `node --test tests/skill-*.test.js` for the rail suites. Expected: PASS.
- [ ] **Step 5: Real-input probes** (scratch, uncommitted; evidence per the AC-evidence persistence rule):
  - `mkdir -p "$PIPELINE_RUN_DIR/evidence"`, then on this branch: `git diff --name-status -M --no-color $(merge-base)..HEAD` (merge-base run as its own call and pasted) fed to `parseNameStatus` and `evaluateTripwire` with `globs: { 'public-contract': ['plugin/skills/_shared/**'] }` → expect `public-contract` crossed by a `plugin/skills/_shared/` path this branch touches; and a real rename from history (`git log --diff-filter=R --name-status -M -1 --format=` output) parsed to both paths. Output to `$PIPELINE_RUN_DIR/evidence/tripwire-probe.txt`.
  - `node plugin/bin/accept-park.js decide --run "$PIPELINE_RUN_DIR" --record 4619` (this repo runs control mode off) → `consulted: false`, no git call.
  - One `decisions.md` `AUTO` entry, `--step "AC evidence"`, via `--text-file`, naming AC7.4/AC1.1 and the evidence path.
- [ ] **Step 6: Commit** — explicit paths; `Pass the head and the agent classification to decide at every merge site, refs #4619`.

## Spec coverage notes

- Waived AC10.1: `npm test` passing is the run's verification gate (`/build` Common Step 5 and `/claude-tweaks:test`), not a task test.
- The spec's `plugin/bin/blast-radius.js` (Technical Approach, Key Files) is read-only precedent; the shared matcher is consumed from `plugin/bin/lib/issues/blast-radius.js`, unmodified.
- `local-merge` path: no merge site under `integration-model: local-merge` runs `accept-park.js` today (#4615 wired Step 2.9 only), so this record wires the tripwire at every site that decides acceptance; the spec's mention of the local-merge path names where the classification is produced, and there is no decide call there to feed.
