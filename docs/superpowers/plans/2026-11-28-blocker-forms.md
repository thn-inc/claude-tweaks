# One Blocked-by grammar and a ready-grant gate — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One module defines the three `Blocked by` line forms. A ready-grant gate keeps `ready` off every path while a `Blocked by: {part} (left for owner/name)` line remains, and every blocker reader holds a record with such a line and names the blocker the same way.

**Architecture:** A new pure module, `plugin/bin/lib/issues/blocker-lines.js`, owns the grammar of all three forms. `record-dependencies.js`, `cross-repo-refs.js`, `design-session/parts.js` and `plan-line.js` import their regexes and the symbolic-ref writer from it. A symbolic blocker has no issue and no state, so it does not ride the stateful foreign-entry plumbing (`crossRepoKey`, `foreignEntries` and the state lookups all assume `owner/name#N`). Each reader appends `symbolicBlockerRefs(body)`, plain blocker strings, at its verdict layer instead, so the record always holds and the blocker is named identically everywhere. `readyGate(body)` sits beside `shapeGate` in `ambiguity-resolve.js`, `readyRestorable` delegates to it, and a new `plugin/bin/ready-gate.js` CLI exposes it to the prose paths that add `ready`. `recordPayload` refuses `ready: true` on a body carrying a symbolic line.

**Tech Stack:** Node 18+ CommonJS, `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-11-28T100319-spec-6374/work/6374-spec.md`

Scope keywords: SYMBOLIC_LINE_RE, CROSS_REPO_DEP_RE, BLOCKED_BY_RE, readyRestorable

## Global Constraints

- The grammar of each form is unchanged: `Blocked by #N` and `Blocked by owner/name#N` stay line-anchored on the whole body, exactly as `DEP_RE` and `CROSS_REPO_DEP_RE` are today. The symbolic form keeps `parts.js`'s `SYMBOLIC_LINE_RE` grammar (optional indent, optional `-`/`*` bullet, `Blocked by: {part} (left for {owner/name})`, where `{owner/name}` is `[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+`). It is read from the authored text only, meaning before `## Original request` with code spans and fences stripped, as `readyRestorable` reads it today: a code-span-quoted line is prose, not a blocker (`tests/bin-lib/issues/ambiguity-resolve.test.js:105`).
- A symbolic blocker is named `{part} (left for {owner/name})`, which is the text after `Blocked by: ` and the same string `parts.js`'s `symbolicRef` writes. One function (`symbolicBlockerRef`) produces it, and every surface prints it.
- Load order: `materialize-format.js` loads `record-payload.js` at load time (it requires `policy-schema.js`, which requires `record-payload.js`). `record-payload.js` must therefore require `blocker-lines.js` lazily, inside `recordPayload`, never at the top of the file, or the load cycle hands it a partial export.
- No local paths, account names, emails or person names in any committed text, PR or comment (public repository).
- Quoted verbatim from `.claude/skills/blocker-surface-parity/SKILL.md` (the governing skill for every reader file in this plan):
  - "1. **One predicate decides.** Every surface calls `foreignBlockerBlocks` / `openBlockerRefs` rather than restating the rule: only an exact CLOSED releases; open and unreadable both hold (fail closed)."
  - "2. **Name it the same everywhere.** A foreign blocker reads `owner/name#N`, or `owner/name#N (state unreadable)` with one `Warning:` line naming the cause. No surface reads a qualified ref as this repository's bare number."
  - "3. **Make the new input a required argument.** `filterCandidates` and `partitionByOpenBodyBlockers` throw `TypeError` without a foreign `Map` (`new Map()` for none), so a caller that never learned the rule fails loudly instead of reading every foreign blocker as absent."
  - "5. **Cover both `work-links` modes and both transports** on every row of the table, or say in the row's prose which one the surface does not support and what it prints instead."
  - "7. **A blocker form no reader parses keeps `ready` off on every path that sets it.** … List the restore paths with `git grep -n -l -e "add-label ready" -e readyRestorable -- plugin`, not from memory."
- Quoted verbatim from `.claude/skills/record-body-line-addition/SKILL.md`'s Registration sites table, `plan-line.js` row: "a line that can sit inside the spec-hash range … and that a pipeline step rewrites without changing what the spec builds joins the list by its exact prefix, only when the spec says so, or every rewrite marks the record's stored plan stale". The decomposition write-back rewrites the symbolic line to `Blocked by owner/name#N` without changing what the spec builds. Both forms are already excluded from the hash for the `#N` lines, so the symbolic line joins that exclusion through `isBlockerLine`.
- Quoted verbatim from `.claude/skills/gh-api-module-pattern/cli-wrapper-contract.md`: "Logic lives in an exported `run(argv, deps)`; every side effect … goes through `deps` so tests inject fakes." and "`require.main === module` guard sets `process.exitCode = run(...)` (never `process.exit`, which can truncate piped stdout)." `ready-gate.js` uses the *Payload-1/Invocation-2* family: 0 the body may carry `ready`, 1 the body was read but must not carry `ready`, 2 malformed invocation or an unreadable file.
- Scope and edit discipline: "Commit tests only where the task asks for them or the repo already keeps tests for this kind of change, sized like the neighboring test files; scratch checks stay scratch. Touch only what the task requires — a pre-existing bug you notice is a follow-up to report, not a fix to fold in, unless the task cannot work without it. Don't reformat or "improve" adjacent code; edit in place rather than rewrite when the result is the same."
- `project-maturity: established`: "For any task modifying pre-existing behavior, write a full characterization test covering edge cases before changing it — published or external consumers may depend on them."
- Prose files: the rail is `RAIL_BYTES` = 52,500 B. Every prose file this plan edits has at least 14 KB of headroom (largest: `shaping-mode-stamping.md` at 38,454 B).

## Review Focus

1. **A body whose only blocker is the symbolic line, under `work-links: body-text`.** /flow 2.7b is skipped when `materialize.js --check` reports `bodyBlockedBy: []`, so the symbolic ref must appear in `bodyBlockedBy` (Task 5).
2. **The same symbolic line written twice, or with differently-cased repositories.** It is one blocker, named once (Task 1's dedupe, pinned there).
3. **A symbolic line quoted in a code span, a fence or `## Original request`.** It is not a blocker on any surface (Task 1; each surface reads through `symbolicBlockerRefs`).
4. **A record carrying both a foreign `owner/name#N` line and a symbolic line.** Both are named, and the foreign state lookup is never handed the symbolic ref (Tasks 3, 5 and 6 each pin a mixed body).
5. **The wrap-up newly-unblocked probe with a symbolic dependent.** It must drop that one dependent, not throw and fail the whole probe (Task 6).

Note on AC1.2: the grammar AC's grep also matches `ranking.js`'s `PROSE_DEP_RE` (`/blocked by\b[^\n#]*#\d+/i`). That regex is the unwired-prose detector, deliberately wider than the grammar (its own comment says so), not a grammar of a `Blocked by` line. Task 1's verification grep lists it as the one classified exception.

---

### Task 1: The blocker-lines grammar module

**Role:** integration
**Review risk:** high

**Files:**
- Create: `plugin/bin/lib/issues/blocker-lines.js`
- Modify: `plugin/bin/lib/issues/materialize-format.js` (add and export `authoredText`)
- Modify: `plugin/bin/lib/issues/ambiguity-resolve.js` (import `authoredText` from materialize-format and delete its local copy; `SYMBOLIC_LINE_RE` now comes from blocker-lines)
- Modify: `plugin/bin/lib/issues/record-dependencies.js` (lines 12 and 27: `DEP_RE`, `DEP_ASSUMPTION_RE` imported)
- Modify: `plugin/bin/lib/issues/cross-repo-refs.js:28` (`CROSS_REPO_DEP_RE` imported)
- Modify: `plugin/bin/lib/design-session/parts.js` (lines 313-319 and 361: `symbolicRef` delegates to `symbolicBlockerRef`; the local `SYMBOLIC_LINE_RE` and its export are removed)
- Modify: `plugin/bin/lib/issues/plan-line.js` (lines 46-47 and 79: `BLOCKED_BY_RE.test(line)` becomes `isBlockerLine(line)`)
- Modify: `plugin/bin/lib/issues/record.js` (re-export blocker-lines; add it to the header's sub-module list)
- Modify: `docs/plugin-structure.md` (the `plugin/bin/lib/issues/` row names `blocker-lines.js`)
- Modify: `perf/cross-repo-dependency-linearity.test.js` (one case for the symbolic regex)
- Create: `tests/bin-lib/issues/blocker-lines.test.js`
- Create: `tests/helpers/symbolic-blocker-fixture.js`
- Test: `tests/bin-lib/issues/plan-line-body-parsers.test.js` (or the plan-line spec-hash suite, whichever holds `specHash` cases)

**Interfaces:**
- Produces, from `plugin/bin/lib/issues/blocker-lines.js`:
  - `LOCAL_BLOCKER_LINE_RE` = `/^Blocked by #(\d+)\b/gm` (today's `DEP_RE`, byte for byte)
  - `LOCAL_BLOCKER_ASSUMPTION_RE` = today's `DEP_ASSUMPTION_RE`, byte for byte
  - `FOREIGN_BLOCKER_LINE_RE` = today's `CROSS_REPO_DEP_RE`, byte for byte
  - `SYMBOLIC_BLOCKER_LINE_RE`: the global-multiline form of `parts.js`'s pattern, with capture groups 1 = part and 2 = repository
  - `isBlockerLine(line: string) -> boolean`: one line matches any of the three forms (for `plan-line.js`; the `#N` forms need `#\d+\b` well-formed, as `BLOCKED_BY_RE` does today)
  - `symbolicBlockerRef({ part, repository }) -> string`: `${part} (left for ${repository})`
  - `symbolicBlockers(body: string) -> Array<{ part, repository }>`: from `authoredText(body)`, in first-appearance order, deduplicated on `part` plus case-insensitive `repository`; `[]` for a non-string or empty body
  - `symbolicBlockerRefs(body: string) -> string[]`: `symbolicBlockers(body).map(symbolicBlockerRef)`
  - `hasSymbolicBlocker(body: string) -> boolean`
- Produces, from `materialize-format.js`: `authoredText(body: string) -> string`, moved unchanged from `ambiguity-resolve.js:27-30`
- Produces, from `tests/helpers/symbolic-blocker-fixture.js`: `SYMBOLIC_LINE` = `'Blocked by: Skill steps (left for thn-inc/other)'`, `SYMBOLIC_REF` = `'Skill steps (left for thn-inc/other)'`, and `symbolicBody(extraLines = [])`, a full spec-shaped body (it passes `shapeGate`) whose only blocker is `SYMBOLIC_LINE`, with `extraLines` inserted beside it. Every later task's surface test uses this fixture.

- [ ] **Step 1: Write the failing tests** in `tests/bin-lib/issues/blocker-lines.test.js`:
  - `AC1.1: the three line regexes equal the ones they replace, and the old modules import them`: assert `LOCAL_BLOCKER_LINE_RE.source === '^Blocked by #(\\d+)\\b'` with flags `gm`, and likewise for the foreign regex's source.
  - `symbolicBlockers reads the part and repository, bullets and indent allowed`: `'- Blocked by: Skill steps (left for Thn-Inc/Other)'` → `[{ part: 'Skill steps', repository: 'Thn-Inc/Other' }]`.
  - `symbolicBlockers dedupes one blocker spelled twice, case-insensitively on the repository`: two lines differing only in repository case → one entry, keeping the first spelling.
  - `symbolicBlockers ignores a code span, a fence and the Original request`: each of the three placements → `[]`.
  - `symbolicBlockerRefs names the blocker as parts.js writes it`: `symbolicBlockerRefs(SYMBOLIC_LINE)` deep-equals `[SYMBOLIC_REF]`, and `require('…/design-session/parts')`'s `planFiling` writeBack `line` equals `'Blocked by: ' + symbolicBlockerRef(...)` for the same part and repository (use the smallest parts table `tests/bin-lib/design-session/parts.test.js` already builds for writeBack).
  - `isBlockerLine accepts all three forms and rejects prose`: true for `Blocked by #7`, `Blocked by a/b#7` and `SYMBOLIC_LINE`; false for `Blocked by nothing` and `See Blocked by #7`.
  - In the spec-hash suite: `a symbolic Blocked-by line rewritten to owner/name#N leaves the spec hash unchanged`: hash a body containing `SYMBOLIC_LINE` inside the hashed range, hash it again with the line replaced by `Blocked by thn-inc/other#7004`, and assert the two hashes are equal. Control: a changed Deliverables sentence changes the hash.

- [ ] **Step 2: Run them to verify they fail**
  Run: `node --test tests/bin-lib/issues/blocker-lines.test.js`
  Expected: FAIL, `Cannot find module '…/blocker-lines'`. The spec-hash case fails on unequal hashes.

- [ ] **Step 3: Implement `blocker-lines.js`** (pure; it requires only `./materialize-format` for `authoredText`) and rewire the four parsers to import from it. `parts.js` keeps exporting `symbolicRef(name, repository)`, which returns `symbolicBlockerRef({ part: name, repository })`. Drop `SYMBOLIC_LINE_RE` from `parts.js` exports; `git grep -n SYMBOLIC_LINE_RE -- plugin tests` must then show only `blocker-lines.js` and its tests. `ambiguity-resolve.js`'s `readyRestorable` keeps its current verdict here and uses `hasSymbolicBlocker(body)` (Task 2 replaces it). Add a symbolic-regex case to `perf/cross-repo-dependency-linearity.test.js` in that file's existing shape: a 60 KB single line of repeated `(left for a/a` with no closing `)`.

- [ ] **Step 4: Run the tests and the neighbouring suites**
  Run: `node --test tests/bin-lib/issues/blocker-lines.test.js tests/bin-lib/issues/cross-repo-refs.test.js tests/bin-lib/issues/record.test.js tests/bin-lib/issues/ambiguity-resolve.test.js tests/bin-lib/issues/plan-line-body-parsers.test.js tests/bin-lib/design-session/parts.test.js`
  Expected: PASS
  Run: `node --test perf/cross-repo-dependency-linearity.test.js`
  Expected: PASS
  Run (AC1.2): `git grep -n -E "/\^?\\\\?[Bb]locked by|RegExp\(.*Blocked by" -- plugin/bin`
  Expected: regex definitions only in `plugin/bin/lib/issues/blocker-lines.js`, plus `ranking.js`'s `PROSE_DEP_RE` (the waived detector).
  Run: `node -e "for (const m of ['issues/record-payload','issues/materialize-format','issues/blocker-lines','issues/record','design-session/parts','issues/plan-line']) { const x = require('./plugin/bin/lib/' + m); if (!Object.keys(x).length) throw new Error(m + ' loaded empty'); } console.log('ok')"`
  Expected: `ok` (no load cycle).

- [ ] **Step 5: Commit** with `git add` on each listed file and the message `Parse the three Blocked by forms in one module — blocker-lines.js (#6374)`.

### Task 2: The ready-grant gate

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/issues/ambiguity-resolve.js` (add `readyGate`; `readyRestorable` delegates to it; header comment)
- Modify: `plugin/bin/lib/issues/record-payload.js` (`recordPayload` refuses `ready: true` with a symbolic blocker, via a lazy require)
- Create: `plugin/bin/ready-gate.js`
- Modify: `plugin/bin/resolve-ambiguity.js` header (readyRestorable now means the ready-grant gate passes)
- Modify: `docs/plugin-structure.md` (CLI row for `ready-gate.js`; the `resolve-ambiguity.js` row's readyRestorable clause names the symbolic-line condition)
- Test: `tests/bin-lib/issues/ambiguity-resolve.test.js`, `tests/bin-lib/issues/record.test.js`
- Test: `tests/resolve-ambiguity-cli.test.js` (its `readyRestorable` output cases must pass unchanged)
- Create: `tests/ready-gate-cli.test.js`

**Interfaces:**
- Consumes: `hasSymbolicBlocker`, `symbolicBlockerRefs` (Task 1); `shapeGate` (`materialize-format.js`); `hasOpenQuestionsSection` (same file).
- Produces: `readyGate(body: string) -> { ok: boolean, reasons: string[] }`. `reasons` is, in order: shapeGate's `missing` entries, `'open-questions-section'` when that heading survives, and one `'symbolic-blocker: {ref}'` per `symbolicBlockerRefs(body)` entry. `ok` is `reasons.length === 0`. A non-string body gives `{ ok: false, reasons: ['body-not-a-string'] }`.
- Produces: `readyRestorable(body) === readyGate(body).ok`, so the signature is unchanged.
- Produces: `node plugin/bin/ready-gate.js <body-file>`. It prints one JSON line, `{"ready":true|false,"reasons":[…]}`, and exits 0 (may carry `ready`), 1 (must not), or 2 (malformed invocation or an unreadable file). It exports `run(argv, deps)` and `realDeps` (`readFile`, `stdout`, `stderr`, `cwd`), and resolves a relative path against `deps.cwd()`.
- Produces: `recordPayload({ ready: true, body })` throws `Error('a record cannot be ready while a Blocked by: … (left for owner/name) line remains: {ref}')` when `hasSymbolicBlocker(body)`.

- [ ] **Step 1: Write the failing tests**
  - `ambiguity-resolve.test.js`, `AC2.1: readyGate names every reason ready must stay off`: `readyGate(symbolicBody())` deep-equals `{ ok: false, reasons: ['symbolic-blocker: ' + SYMBOLIC_REF] }`; a body with both an Open Questions heading and the line lists both reasons in order; `readyGate(symbolicBody())` with the line rewritten to `Blocked by thn-inc/other#7004` gives `{ ok: true, reasons: [] }`. The existing `readyRestorable` cases stay unchanged and must still pass (characterization).
  - `record.test.js`, `AC2.1: recordPayload refuses ready on a body with a symbolic blocker`: `assert.throws(() => recordPayload({ title: 't', body: symbolicBody(), type: 'task', ready: true }), /left for/)`. The same call with `ready: false` does not throw (create-time filing unchanged, AC3.1).
  - `tests/ready-gate-cli.test.js` (in-process through `tests/helpers/run-cli.js`'s `runCliSync`, following an existing in-process CLI test's shape): exit 1 with `ready:false` and the symbolic reason for a `symbolicBody()` file; exit 0 with `{"ready":true,"reasons":[]}` for the rewritten body; exit 2 for no argument and for a missing file; a relative path resolves against the injected `cwd`; a one-line test that `realDeps` carries each key.
  - `compose-record` (AC3.1): in the existing `compose-record` CLI suite, `--check` on a `symbolicBody()` file exits 0 (validateShaped still accepts the line).

- [ ] **Step 2: Run them to verify they fail**
  Run: `node --test tests/bin-lib/issues/ambiguity-resolve.test.js tests/bin-lib/issues/record.test.js tests/ready-gate-cli.test.js`
  Expected: FAIL (`readyGate is not a function`, no throw, `Cannot find module`).

- [ ] **Step 3: Implement** `readyGate` and the `readyRestorable` delegation in `ambiguity-resolve.js`. Add the `recordPayload` refusal: `const { hasSymbolicBlocker, symbolicBlockerRefs } = require('./blocker-lines')` inside the function, guarded by `ready === true`, with a comment naming the load cycle from Global Constraints. Write `plugin/bin/ready-gate.js` under the CLI wrapper contract, with its exit codes in the header comment and `USAGE`.

- [ ] **Step 4: Run the tests**
  Run: `node --test tests/bin-lib/issues/ambiguity-resolve.test.js tests/bin-lib/issues/record.test.js tests/ready-gate-cli.test.js tests/resolve-ambiguity-cli.test.js tests/bin-lib/cli-entry-conformance.test.js tests/bin-lib/exit-code-conformance.test.js`
  Expected: PASS

- [ ] **Step 5: Commit** with the message `Add the ready-grant gate beside shapeGate — readyGate, ready-gate.js, recordPayload refusal (#6374)`.

### Task 3: Dispatch surfaces hold and name a symbolic blocker

**Role:** integration

**Files:**
- Modify: `plugin/bin/lib/issues/record-dependencies.js` (`partitionByOpenBodyBlockers`: append `symbolicBlockerRefs(c.body)` after the foreign refs). The queue pull's body pass runs under both `work-links` values (`queue-pull.js:767-772`), so this one change covers both modes.
- Modify: `plugin/bin/dispatch-resume.js` (`readOpenBlockers`: append `symbolicBlockerRefs(body)` to `foreign` after `bodyForeignBlockerRefs`; never pass it to `fetchCrossRepoStates`)
- Modify: `plugin/skills/dispatch/queue-pull-notes.md` and `plugin/skills/dispatch/blocked-exclusion-report.md`: where each names the foreign blocker's spelling in an exclusion, add one sentence that a `Blocked by: {part} (left for owner/name)` line excludes the record, named `{part} (left for owner/name)` (#6374), under either `work-links` value
- No change: `plugin/bin/lib/dispatch/queue-pull.js` (its body pass calls `partitionByOpenBodyBlockers`) and `plugin/bin/lib/dispatch/resume-eligibility.js` (it refuses any non-empty `openBlockers` and prints strings as they are)
- Test: `tests/bin-lib/issues/record.test.js`, `tests/bin-lib/dispatch/queue-pull.test.js`, `tests/dispatch-resume-cli.test.js`

**Interfaces:**
- Consumes: `symbolicBlockerRefs` (Task 1), `SYMBOLIC_LINE`, `SYMBOLIC_REF`, `symbolicBody` (Task 1 fixture).
- Produces: `partitionByOpenBodyBlockers(...).excluded` entries whose `blockedBy` may include a symbolic ref string. `queue-order.js`'s cache needs no change, because a symbolic verdict is a function of the body alone and a body edit moves `updatedAt`. Pin that claim with the test below.

- [ ] **Step 1: Write the failing tests**
  - `record.test.js`, `AC2.2: partitionByOpenBodyBlockers excludes a record whose only blocker is a symbolic line, naming it`: candidate `{ number: 9, body: symbolicBody() }`, `new Map()` → `excluded` deep-equals `[{ number: 9, blockedBy: [SYMBOLIC_REF] }]`. A mixed body with an open foreign entry in the Map lists the foreign ref, then `SYMBOLIC_REF`.
  - `queue-pull.test.js`, beside the `#5227 foreign blocker` fixture: `AC2.2: a symbolic Blocked-by line excludes the record from the queue under body-text and native, named in the exclusion`. Run the in-process queue pull with one `auto:build` candidate whose body is `symbolicBody()`, once per `work-links` value, and assert the candidate is absent from the eligible output and its exclusion names `SYMBOLIC_REF`. Assert the foreign-state lookup seam was never asked about `SYMBOLIC_REF`.
  - `queue-order.test.js`, beside `#4793: the same queue is a cache hit…`: `a symbolic line rewritten to owner/name#N is a cache miss`. The same queue with the record's body and `updatedAt` changed → `cacheUsable` false.
  - `dispatch-resume-cli.test.js`, beside `'a body-declared OPEN foreign blocker refuses resume, named owner/name#N'`: `AC2.2: a symbolic blocker refuses resume, named as written`. Assert a `blocked-by` refusal naming `SYMBOLIC_REF`, and that the `ghBatch` fake was not called for it.

- [ ] **Step 2: Run them to verify they fail**
  Run: `node --test tests/bin-lib/issues/record.test.js tests/bin-lib/dispatch/queue-pull.test.js tests/bin-lib/dispatch/queue-order.test.js tests/dispatch-resume-cli.test.js`
  Expected: FAIL. The record stays eligible and resume is allowed. The queue-order case may already pass, because it characterizes `updatedAt`; keep it as the pin.

- [ ] **Step 3: Implement** both appends, then write the two prose sentences.

- [ ] **Step 4: Run the tests**
  Run: `node --test tests/bin-lib/issues/record.test.js tests/bin-lib/dispatch/queue-pull.test.js tests/bin-lib/dispatch/queue-order.test.js tests/dispatch-resume-cli.test.js tests/dispatch-cross-repo-blocker-exclusion-fixture.test.js tests/bin-lib/dispatch/resume-eligibility.test.js`
  Expected: PASS

- [ ] **Step 5: Commit** with the message `Hold a symbolic blocker in the dispatch queue pull and resume (#6374)`.

### Task 4: Backlog surfaces count and filter a symbolic blocker

**Role:** integration

**Files:**
- Modify: `plugin/bin/lib/issues/backlog.js` (`attachBodyForeignBlockers`: also attach `symbolicBlockerRefs(r.body)`, both when the record has no foreign entries and when it has a tier already. Dedupe against strings already in the tier, so a second pass adds nothing. Overview's native path re-applies this function after its native attach, so both `work-links` values are covered.)
- Modify: `plugin/bin/lib/backlog-grant-gate/backlog-grant-gate.js` (`filterCandidates`: drop a candidate when `hasSymbolicBlocker(i.body)`, after the `parseDependencies` filter; update the header comment's rule list)
- Modify: `plugin/skills/backlog/overview-mode.md` and `plugin/skills/backlog/machine-grant-outlook.md`: in the sentence that lists what blocks a record, add the symbolic line, named `{part} (left for owner/name)` (#6374)
- Test: `tests/bin-lib/issues/backlog.test.js`, `tests/bin-lib/backlog-grant-gate/backlog-grant-gate.test.js` (path per `git grep -l filterCandidates -- tests`)

**Interfaces:**
- Consumes: `symbolicBlockerRefs`, `hasSymbolicBlocker` (Task 1); fixture.
- Produces: `funnelBuckets` counts the record blocked, because `blockersOf` keeps string blockers (`backlog.js:249`).

- [ ] **Step 1: Write the failing tests**
  - `backlog.test.js`, `AC2.3: attachBodyForeignBlockers attaches a symbolic blocker with no foreign entry, so funnelBuckets files the record under granted, not dispatchable`. Mirror the test at line 385 with an empty Map and `symbolicBody()`. Then: `…merges a symbolic blocker into an already-attached tier once, across two passes`.
  - Grant-gate suite, `AC2.4: filterCandidates drops a candidate whose body carries a symbolic blocker`: mirror the `#4793` case at line 259 with `new Map()`.

- [ ] **Step 2: Run them to verify they fail**
  Run: `node --test tests/bin-lib/issues/backlog.test.js` plus the grant-gate suite
  Expected: FAIL

- [ ] **Step 3: Implement** both changes and the two prose sentences.

- [ ] **Step 4: Run the tests**
  Run: the two suites plus `node --test tests/cross-repo-blocker-readers-conformance.test.js tests/bin-lib/issues/ranking.test.js`
  Expected: PASS

- [ ] **Step 5: Commit** with the message `Count and filter a symbolic blocker in the backlog funnel and grant pre-pass (#6374)`.

### Task 5: /flow pre-flight and materialize stop on a symbolic blocker

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/materialize.js` (lines 437 and 632: `bodyBlockedBy` and `blockedBy` each append `...symbolicBlockerRefs(record.body)` after the foreign refs)
- Modify: `plugin/bin/preflight-records.js` (after `addBodyForeignBlockers`, each record's `blockerLanding` appends one `{ blocker: ref, verdict: 'open', via: 'symbolic-blocker', repository }` per `symbolicBlockers(issue.body)` entry, where `ref` is `symbolicBlockerRef(entry)`. Never hand a symbolic entry to `addBodyForeignBlockers`, `crossRepoKey` or `fetchCrossRepoStates`. This runs under both `work-links` values and under `--records-json`.)
- No change: `plugin/bin/lib/preflight-records/blocker-landing.js` (`open` already stops; the symbolic entry is appended in `plugin/bin/preflight-records.js`)
- Modify: `plugin/skills/flow/multispec-dependency-ordering.md` (one sentence beside the `owner/name#N` rule: a `{part} (left for owner/name)` entry in `blocked-by:` never adds an edge, and pre-flight reads it as an `open` out-of-run blocker, a STOP). Also `plugin/skills/flow/validation.md`'s 2.7b item 3 (body-text no-op): a symbolic line lands in `bodyBlockedBy`, so the call runs.
- Test: `tests/materialize-design-intent.test.js` (beside `'Q7 (#4793): blocked-by lists…'`), `tests/preflight-records.test.js` (beside the `:957` body-declared OPEN foreign case; path per `git grep -l "body-declared OPEN foreign blocker reads open" -- tests`), `tests/flow-cross-repo-header-conformance.test.js` (one fact for the new prose sentence, proven red)

**Interfaces:**
- Consumes: `symbolicBlockers`, `symbolicBlockerRef`, `symbolicBlockerRefs` (Task 1); fixture.
- Produces: the `blockerLanding` entry shape `{ blocker: string, verdict: 'open', via: 'symbolic-blocker', repository: string }`. `validation.md`'s rule "`open` … is BLOCKED" already stops on it.

- [ ] **Step 1: Write the failing tests**
  - `AC2.5: --check reports a symbolic-only body's blocker in bodyBlockedBy, and the header lists it after this repository's numbers and foreign refs`: `bodyBlockedBy` deep-equals `[SYMBOLIC_REF]`, and with `Blocked by #12` and `Blocked by a/b#3` added, the header reads `blocked-by: [12, a/b#3, Skill steps (left for thn-inc/other)]`.
  - `AC2.5: a symbolic blocker reads open in blockerLanding under body-text, native and --records-json, with no state lookup for it`: each run's record has one entry `{ blocker: SYMBOLIC_REF, verdict: 'open', via: 'symbolic-blocker', repository: 'thn-inc/other' }`, and the fake runner received no query naming `Skill steps`.
  - Header conformance: the multispec-dependency-ordering sentence fact, proven red per `skill-prose-conformance-tests`.

- [ ] **Step 2: Run them to verify they fail**
  Run: `node --test tests/materialize-design-intent.test.js tests/preflight-records.test.js tests/flow-cross-repo-header-conformance.test.js`
  Expected: FAIL

- [ ] **Step 3: Implement** the code and both prose sentences.

- [ ] **Step 4: Run the tests**
  Run: the three suites plus `node --test tests/flow-blocker-landing-conformance.test.js tests/bin-lib/dispatch/unlanded-blockers.test.js`
  Expected: PASS

- [ ] **Step 5: Commit** with the message `Stop /flow pre-flight on a symbolic blocker and list it in the blocked-by header (#6374)`.

### Task 6: Wrap-up never reports a symbolic-blocked record newly unblocked

**Role:** integration

**Files:**
- Modify: `plugin/bin/lib/wrap-up/pack.js` (both `work-links` branches of the newly-unblocked probe drop a dependent with `hasSymbolicBlocker(r.body)` before `dropForeignBlocked`, so no symbolic ref reaches `distinctCrossRepoRefs`, `foreignEntries` or the spawn; the `local-files` `unblockedLocal` branch drops it too)
- Modify: `plugin/skills/wrap-up/unblocked-records.md` (the prose twin: one sentence in each pass that a dependent carrying a `Blocked by: {part} (left for owner/name)` line stays blocked, and is never looked up)
- Test: `tests/bin-lib/wrap-up/pack.test.js` (beside `:749` and `:604`)

**Interfaces:**
- Consumes: `hasSymbolicBlocker` (Task 1); fixture.

- [ ] **Step 1: Write the failing tests**
  - `AC2.6: a dependent whose other blocker is a symbolic line is never reported newly unblocked (body-text)`: the dependent's body is `symbolicBody(['Blocked by #{closed}'])`; the probe result excludes it and `ok` is true.
  - The same for native, with a mixed sibling dependent carrying a CLOSED foreign ref. The sibling is still reported, which shows the probe did not fail as a whole.
  - The same for `local-files`.

- [ ] **Step 2: Run them to verify they fail**
  Run: `node --test tests/bin-lib/wrap-up/pack.test.js`
  Expected: FAIL. The dependent is listed, or the probe fails on `distinct` being null.

- [ ] **Step 3: Implement** and write the prose sentences.

- [ ] **Step 4: Run the tests**
  Run: `node --test tests/bin-lib/wrap-up/pack.test.js`, plus every suite `git grep -l "unblocked-records" -- tests` lists
  Expected: PASS

- [ ] **Step 5: Commit** with the message `Keep a symbolic-blocked dependent out of wrap-up's newly-unblocked report (#6374)`.

### Task 7: Every prose path that adds ready runs the gate

**Role:** integration

**Files:**
- Derive the list first: `git grep -n -l -e "add-label ready" -e readyRestorable -e "ready: true" -- plugin/skills`. As of this plan it is these files:
- Modify: `plugin/skills/specify/shaping-mode-stamping.md`: before the compose-then-write-once `gh issue edit`, run `node "${CLAUDE_PLUGIN_ROOT}/bin/ready-gate.js" "$SPECIFY_SHAPED_BODY"`. On exit 1, drop `--add-label ready` from that call (add `--remove-label ready` when the record carries it) and name the printed reasons in the run's summary. Exit 2 stops. The gh-absent and `local-files` variants in the same file follow the same rule.
- Modify: `plugin/skills/specify/planning-answer.md` (d): add `ready` only when the label was removed and `ready-gate.js "{body}"` exits 0; on exit 1 the outcome names the reasons.
- Modify: `plugin/skills/specify/decomposition-mode-closeout.md` Step 4 write-back: replace the restated "no other `Blocked by: … (left for …)` line … no `<!-- ambiguity:` marker or `## Open Questions` heading" condition with "`ready-gate.js` exits 0 on the composed body". The Step 9 `readyRestorable` paragraph (around line 156) says `readyRestorable` is the ready-grant gate's verdict (`readyGate`), keeping its three named conditions.
- Modify: `plugin/skills/specify/red-team.md` step 5: where it restores `ready`, cite `readyRestorable` as the ready-grant gate's verdict. If step 5 has no restore wording of its own (it delegates to the closeout), change nothing there and record that in the commit message.
- Modify: `plugin/skills/specify/record-creation-subissues.md` (line 15): one clause saying `recordPayload` now refuses `ready: true` on such a body, so the create call fails loud if the drop is missed.
- No change: `plugin/skills/specify/next-mode-shape.md`: no edit, because its `ready` rides `shaping-mode-stamping.md`'s call (lines 238-246). Classify it no-change in the commit message.
- Any further file the grep lists: classify it as covered or as needing the same gate call.
- Modify: `.claude/skills/blocker-surface-parity/SKILL.md`: the table's Parse row names `plugin/bin/lib/issues/blocker-lines.js` (`symbolicBlockers`, `symbolicBlockerRefs`, `isBlockerLine`). Add a Ready gate row (`ambiguity-resolve.js`'s `readyGate`, `plugin/bin/ready-gate.js`, `recordPayload`'s refusal). Rule 7 is rewritten to say what is true now: every reader holds the symbolic line and names it `{part} (left for owner/name)`, and every path that adds `ready` runs `readyGate`. Keep its `git grep` derivation.
- Create: `tests/ready-gate-callers-conformance.test.js`
- Test: `tests/specify-approved-parts-conformance.test.js` (it pins the closeout write-back prose this task rewrites; update its facts to the gate wording, keeping each assertion able to go red)
- Test: the existing suites that pin these files' prose (`git grep -l -e shaping-mode-stamping -e planning-answer -e decomposition-mode-closeout -- tests`)

**Interfaces:**
- Consumes: `plugin/bin/ready-gate.js` and its exit codes (Task 2).

- [ ] **Step 1: Write the failing test** `tests/ready-gate-callers-conformance.test.js`. For each file that adds `ready` (shaping-mode-stamping, planning-answer, decomposition-mode-closeout), assert that the region holding its `add-label ready` (or its restore sentence) names `ready-gate.js` and says what exit 1 does. Use `tests/helpers/conformance-asserts.js`'s `missingFactsOf` and `assertEachPatternGoesRed`, following `tests/cross-repo-blocker-readers-conformance.test.js`'s shape. Name the test `AC5.1: every prose path that adds ready runs ready-gate.js`.

- [ ] **Step 2: Run it to verify it fails**
  Run: `node --test tests/ready-gate-callers-conformance.test.js`
  Expected: FAIL (facts missing)

- [ ] **Step 3: Edit the prose** as listed. Re-run `wc -c` on each edited file and confirm it is under 52,500.

- [ ] **Step 4: Run the tests**
  Run: `node --test tests/ready-gate-callers-conformance.test.js tests/specify-approved-parts-conformance.test.js tests/specify-staged-for-caller.test.js`, plus each suite the Files grep listed
  Expected: PASS

- [ ] **Step 5: Commit** with the message `Run the ready-grant gate on every prose path that adds ready (#6374)`.

## Spec coverage

| Spec item | Task |
|---|---|
| Deliverable 1 (one parser), AC1.1 | Task 1 |
| Deliverable 2 (ready-grant gate), AC2 (every ready path refuses), AC3.1 (validateShaped unchanged) | Tasks 2, 7 |
| Deliverable 3 (every reader holds and names it), AC2 (each reader) | Tasks 3–6 |
| Deliverable 4 (blocker-surface-parity skill) | Task 7 |
| AC4.1, AC4.2 (`#N` and `owner/name#N` behaviour unchanged; the blocker-surface-parity Tests suites pass unmodified) | Task 1 Step 4 and each task's neighbour suites (existing suites pass unmodified) |
| AC5.1 (each prose path cites the gate, pinned red) | Task 7 |
