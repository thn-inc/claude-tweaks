# Tiebreak Resolver and Verdict Coverage (#3945) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a deterministic resolver for one review-tiebreak agent's reply, plus a run-dir findings artifact and a verdict-coverage check that archival enforces. Nothing in the review skill calls these yet.

**Architecture:** A new pure module, `plugin/bin/lib/tiebreak.js`, sits beside `coordination.js` and holds the finding id, the reply parser, the resolver with evidence verification through an injected `readFile`, and the verdict-line builders. It also holds the findings-artifact reader and validator and the coverage check, which reads `decisions.md` for `tiebreak:{id}` markers. `plugin/bin/review-coordination.js` exposes three new subcommands. The archive path enforces coverage in two places: an optional 5th parameter on `decideArchiveCore` for the reconcile sweep, and an inline check in `hooks.js`'s `archive-run` verb, which never calls `decideArchiveCore`. A run with no findings artifact archives exactly as before.

**Tech Stack:** Node 18+ CommonJS, `node:crypto` (SHA-1), `node:test`.

**Spec:** `.claude-tweaks/pipelines/2026-10-22T110840-spec-3926-3817-3945-3947/spec-3945/work/3945-spec.md`. One assumption was corrected at build: `archive-run` does not consult `decideArchiveCore`, so both are wired (`premise reversed:` line in spec-3945 `decisions.md`).

## Global Constraints

- **Fail toward scrutiny (IL-50).** Every unrecognized, missing, empty or unverifiable input resolves to can't-tell, never to `drop` or `confirmed`. Only the literal verdicts `confirmed` / `refuted`, *with verified evidence and status `DONE`*, leave can't-tell.
- **Parse-signal discipline.** `parse: 'could-not-parse'` is a distinct field value. It is never the same object shape as a legitimate cant-tell verdict (that one has `parse: 'ok'`, `reason: 'verdict:cant-tell'`).
- **Severities.** The valid set is `critical | high | medium | low | info`. Anything else, compared case-insensitively after trimming, is unknown. Rank them with `severityRank` from `coordination.js` (`info`=0 … `critical`=4).
- **Evidence window.** ±5 lines. Use `LINE_TOLERANCE_REPRODUCTION_WIDE` from `coordination.js`; never hard-code `5`.
- **Finding id.** The first 12 hex characters of `sha1([lens, path, String(line), normClaim].join('\n'))`, where `normClaim = claim.replace(/\s+/g, ' ').trim()`.
- **Every verdict line carries `tiebreak:{id}`.** No non-confirmed line may contain the case-sensitive word `Confirmed`.
- **Archive guard order.** The #3668, #3370 and #3503 guards keep their order and behavior. The new coverage check runs after all of them, and only when a `review-findings.json` exists. Their existing tests must pass unchanged.
- **Run-dir writes** go through the anchoring-aware writer (`plugin/bin/lib/stage-item/write.js`'s `resolveTarget` plus `plugin/bin/lib/run-artifact/write.js`'s `writeArtifact`). Never write a bare relative path (IL-127).
- Commits follow `{Verb} {what} — {detail}` and end with `refs #3945` plus the session trailer. Never "closes". Never `git stash`.
- Prove each fail-toward-scrutiny guard by reverting it and quoting the red run in the task report (AC4, AC10).

## Review Focus

- A reply where `Verdict:` is valid but the `STATUS:` line is not the last non-empty line, with narration after it. Expect could-not-parse (Task 1 test).
- An `Evidence:` path that differs from the finding's path, for example the right quote cited from a sibling file. Expect can't-tell with reason `evidence-path-mismatch` (Task 2 test).
- A `line` given as a range (`"40-44"`) or as absent. A range resolves to its first line; absent resolves to can't-tell with reason `no-line` (Task 2 test).
- A multi-spec parent run whose findings artifact lives in `spec-{N}/`, not the parent. The archive coverage must scan the run dir and every `spec-*` subdir (Tasks 5 and 6 tests).
- A `review-findings.json` that is valid JSON but the wrong shape: a non-array, or an entry missing `id`/`lens`/`path`. Expect `artifactValid: false`, which refuses with its own reason (Tasks 3, 5 and 6 tests).

---

### Task 1: Finding id and reply parser

**Files:**
- Create: `plugin/bin/lib/tiebreak.js`
- Create: `tests/bin-lib/tiebreak.test.js`

**Interfaces:**
- Produces:
  - `findingId({ lens, path, line, claim }) -> string`, 12 lowercase hex characters.
  - `parseTiebreakReply(text) -> { parse: 'ok'|'could-not-parse', verdict: 'confirmed'|'refuted'|'cant-tell'|null, evidence: { path, line, quote }|null, severity: string|null, recommendation: 'file'|'drop'|null, recommendationReason: string|null, status: string|null }`.
  - `VERDICTS = ['confirmed','refuted','cant-tell']`.
  - `SEVERITIES = ['critical','high','medium','low','info']`.
- Reply grammar. The implementer documents it in a header comment:
  - Lines are matched case-insensitively on the field name, after trimming. Each line is `Field: value`.
  - `Verdict: confirmed|refuted|cant-tell`, value lowercased.
  - `Evidence: {path}:{line} {quote}`. The quote is everything after the first whitespace following `path:line`. One wrapping pair of backticks or double quotes is stripped.
  - `Severity: {sev}`, lowercased. A value outside `SEVERITIES` gives `severity: null`.
  - `Recommendation: file|drop` plus an optional reason after ` — `, ` - ` or `:`.
  - The **last non-empty line** must be `STATUS: {WORD}`, uppercased.

- [ ] **Step 1: Write the failing tests** in `tests/bin-lib/tiebreak.test.js`:
  - `findingId is stable and claim-sensitive (AC7.1)`: the same input returns the same id. Claims that differ only in whitespace give the same id. A different claim at the same lens and `path:line` gives a different id. The id matches `/^[0-9a-f]{12}$/`.
  - `parses a well-formed reply (AC1.1)`: a full five-field reply ending `STATUS: DONE` gives `parse:'ok'` and each field.
  - `could-not-parse: empty reply (AC6.1)`, `could-not-parse: no Verdict line (AC6.1)`, `could-not-parse: Verdict value outside the set (AC6.1)`, `could-not-parse: no trailing STATUS line (AC6.1)`: one test each. The last one includes a reply whose `STATUS:` line is followed by narration.
  - `non-DONE status parses ok (AC6.1)`: `STATUS: BLOCKED` gives `parse:'ok'` and `status:'BLOCKED'`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/bin-lib/tiebreak.test.js`
Expected: FAIL with `Cannot find module '../../plugin/bin/lib/tiebreak'`.

- [ ] **Step 3: Implement `findingId` and `parseTiebreakReply` in `plugin/bin/lib/tiebreak.js`.**

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/bin-lib/tiebreak.test.js`
Expected: PASS, 0 failures.

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/tiebreak.js tests/bin-lib/tiebreak.test.js
git commit -m "Add tiebreak finding id and reply parser — could-not-parse is its own signal, refs #3945"
```

### Task 2: The resolver: outcomes, severity, verified evidence, verdict lines

**Files:**
- Modify: `plugin/bin/lib/tiebreak.js`
- Test: `tests/bin-lib/tiebreak.test.js` (append)

**Interfaces:**
- Consumes: `findingId` and `parseTiebreakReply` (Task 1), plus `severityRank` and `LINE_TOLERANCE_REPRODUCTION_WIDE` from `./coordination`.
- Produces `resolveTiebreak(finding, replyText, { readFile, now } = {})`.
  - `finding` is `{ lens, path, line, claim, reporterSeverity, kind: 'unconfirmed'|'contested', positions? }`.
  - `readFile(path) -> string` may throw. When it is absent, evidence is unverified.
  - `now` is a `Date` used for the `HH:MM:SS` stamp, local time and zero-padded. Default `new Date()`.
  - The return value is `{ id, outcome: 'confirmed'|'drop'|'digest'|'console', severity, evidence, recommendation, reason, logLine, listInConsole, parse }`.
- Resolution rules:
  - **Reporter severity.** For `kind:'contested'` with `positions: [{severity}, …]`, it is the highest known position severity. Otherwise it is `finding.reporterSeverity`. An unknown value counts as absent.
  - **Line.** An integer, a numeric string, or `"a-b"` uses the first number. A missing or unparseable line gives can't-tell with reason `no-line`.
  - **Can't-tell causes.** Each reason is taken in this order:
    1. `could-not-parse` gives `reason:'could-not-parse'`.
    2. `status !== 'DONE'` gives `` `status:${WORD}` ``.
    3. Verdict `cant-tell` gives `'verdict:cant-tell'`.
    4. A `confirmed` or `refuted` verdict with no `Evidence:` gives `'no-evidence'`.
    5. An evidence path that is not equal to `finding.path` gives `'evidence-path-mismatch'`.
    6. No reader, a reader that throws, a cited line outside the file, or a whitespace-normalized quote that is not a substring of the whitespace-normalized join of the file's lines `[line−5 … line+5]` (clamped) gives `'evidence-unverified'`.
  - **Can't-tell outcome.** The threshold severity is the higher of the known reporter and tiebreak severities, or `medium` when neither is known. `low` or `info` gives `digest`. `medium` and above gives `console`, carrying `recommendation` verbatim (it may be null).
  - **`confirmed` with verified evidence.** Severity is the lower of the two when both are known, else whichever is known, else `medium`.
  - **`refuted` with verified evidence.** The outcome is `drop`, and `severity` is the higher of the known two, else `medium`. `listInConsole` is `severity` ∈ {`high`,`critical`}. It is false for every other outcome.
  - A contradicting `Recommendation:` is carried verbatim and never changes the outcome.
- Verdict lines (exact):
  - confirmed: `` `AUTO ${t} — Reproduction: lens "${lens}" finding ${path}:${line} confirmed by tiebreak:${id}. Confirmed. Reversibility: high.` ``
  - drop: `` `AUTO ${t} — Tiebreak tiebreak:${id}: lens "${lens}" finding ${path}:${line} dropped: ${reason}. Evidence: ${path}:${evLine} "${quote}". Severity: ${sev}. Reversibility: high.` ``, where `reason` is `refuted by tiebreak`.
  - digest: `` `AUTO ${t} — Tiebreak tiebreak:${id}: lens "${lens}" finding ${path}:${line} digested: ${reason}. Severity: ${sev}. Reversibility: high.` ``
  - console: `` `STAGED ${t} — Tiebreak tiebreak:${id}: lens "${lens}" finding ${path}:${line} console: ${reason}. Severity: ${sev}. Recommendation: ${rec ?? 'none'}. Reversibility: high.` ``

- [ ] **Step 1: Append the failing tests** (each named with its AC id):
  - `confirmed with verified evidence → confirmed at the lower severity (AC2.1)`.
  - `confirmed line supersedes the real-emitter STAGED line in resolve.js (AC2.1, AC9.1)`. Use the verbatim STAGED fixture line from `tests/bin-lib/console/resolve.test.js:551` (`- STAGED 23:44:20 — spec #3412 — … lens "3a" finding plugin/bin/lib/reconcile/pr-state.js:158 not reproduced. …`) as a module-level constant labeled as captured from a real `decisions.md`. Build the confirmed line for the same lens, path and line. Feed both, as `- `-prefixed lines in that order, through `resolve.js`'s exported console classification, exactly as `tests/bin-lib/console/resolve.test.js` does around line 551. Assert that no coordination item remains.
  - `refuted with verified evidence → drop at every severity; listInConsole only at high/critical (AC3.1)`. Use a table over the five severities.
  - `cant-tell paths (AC4.1)`, one test each: verdict cant-tell; confirmed with no Evidence; malformed reply; `STATUS: BLOCKED`. Each asserts `outcome ∈ {digest, console}` and never `confirmed` or `drop`.
  - `can't-tell threshold (AC5.1)`, one test per branch:
    - low gives digest.
    - medium gives console with the recommendation.
    - tiebreak severity absent uses the reporter's.
    - neither known gives `medium` and console.
    - a contested finding uses its higher position.
    - an unknown severity string counts as unknown.
    - confirmed with the tiebreak severity absent uses the reporter's.
    - confirmed with neither known gives `medium`.
    - drop with a low tiebreak and high reporter is listed in the console.
  - `parse signals are distinguishable (AC6.1)`: compare a could-not-parse result with a legitimate cant-tell verdict. `parse` and `reason` both differ.
  - `evidence verification (AC10.1)`, one test each: a fabricated quote is unverified; a quote 6+ lines away is unverified; a whitespace-only difference verifies; with no reader, `confirmed` and `refuted` both give can't-tell; an evidence path mismatch is unverified; range and absent `line` behave as in Review Focus.
  - `no non-confirmed line contains "Confirmed" (AC2.1)`: assert this over the drop, digest and console lines.
  - `every verdict line carries tiebreak:{id} (AC7.1)`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/bin-lib/tiebreak.test.js`
Expected: FAIL with `resolveTiebreak is not a function`.

- [ ] **Step 3: Implement `resolveTiebreak` and the line builders in `plugin/bin/lib/tiebreak.js`.**

- [ ] **Step 4: Run the tests to verify they pass, then prove the guards**

Run: `node --test tests/bin-lib/tiebreak.test.js tests/bin-lib/console/resolve.test.js`
Expected: PASS, 0 failures. Then, one at a time, revert each fail-toward-scrutiny guard to a fail-open variant: the status check, the no-evidence check, the could-not-parse mapping, and the evidence window or substring check. Run the file and quote the red test names in the report. Restore each guard afterwards.

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/tiebreak.js tests/bin-lib/tiebreak.test.js
git commit -m "Resolve tiebreak replies deterministically — verified evidence or can't-tell, refs #3945"
```

### Task 3: Findings artifact and verdict coverage

**Files:**
- Modify: `plugin/bin/lib/run-artifact/write.js:20` (`ARTIFACT_NAMES` gains `'review-findings.json'`)
- Modify: `plugin/bin/lib/tiebreak.js`
- Test: `tests/bin-lib/tiebreak.test.js` (append); `tests/bin-lib/run-artifact/` (only if a test pins `ARTIFACT_NAMES` exactly; update that test's expected list)

**Interfaces:**
- Consumes: `findingId` (Task 1).
- Produces:
  - `FINDINGS_ARTIFACT = 'review-findings.json'`.
  - `buildFindingsArtifact(findings) -> Array<{ id, lens, path, line, claim, reporterSeverity, kind }>`. It computes each id and throws `TypeError` on an entry missing `lens`, `path` or `claim`, or with `kind` outside the two values.
  - `readFindingsArtifact(dir) -> { present: boolean, valid: boolean, findings: Array|null }`. Absent gives `{present:false, valid:true, findings:null}`. Present and unreadable, invalid JSON, a non-array, or an entry lacking `id`/`lens`/`path` all give `{present:true, valid:false, findings:null}`.
  - `checkTiebreakCoverage(dir) -> { artifactPresent, artifactValid, missing: string[] }`. It reads `dir/decisions.md`; an absent file counts as no lines. An id is covered when any line contains the literal `tiebreak:${id}`.
  - `checkRunTiebreakCoverage(runDir, specDirs) -> { artifactPresent, artifactValid, missing }`. It aggregates over `runDir` plus each `path.join(runDir, s)` for `s` in `specDirs`. `artifactPresent` is any present, `artifactValid` is all present ones valid, and `missing` is concatenated as `spec-N/id` for subdirs and a bare `id` at the top level.

- [ ] **Step 1: Append the failing tests:**
  - `artifact round-trips (AC7.1)`: build, write to a tmp dir, then read.
  - `coverage returns exactly the uncovered ids (AC7.1)`.
  - `empty missing when every id has a line (AC7.1)`.
  - `same lens+path:line, different claims → two ids, two lines needed (AC7.1)`. This also documents that `resolve.js`'s `findingKey` gives both the same key.
  - `malformed artifact → artifactValid false (AC8.1)`: non-array, bad JSON, entry missing `id`.
  - `absent artifact → artifactPresent false, nothing missing`.
  - `run-level aggregation includes spec-* subdirs`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/bin-lib/tiebreak.test.js`
Expected: FAIL with `buildFindingsArtifact is not a function`.

- [ ] **Step 3: Implement it.** Add `'review-findings.json'` to `ARTIFACT_NAMES` and update that file's header comment list.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/bin-lib/tiebreak.test.js tests/bin-lib/run-artifact`
Expected: PASS, 0 failures. If `tests/bin-lib/run-artifact` does not exist, run `node --test tests/bin-lib/tiebreak.test.js` alone and grep `tests/` for `ARTIFACT_NAMES` to find the pinning test.

- [ ] **Step 5: Commit** with `git add` of the three touched files and the message `Add the review-findings run artifact and tiebreak verdict coverage check — refs #3945`.

### Task 4: review-coordination.js subcommands and command reference

**Files:**
- Modify: `plugin/bin/review-coordination.js` (header comment, `USAGE`, `run`)
- Modify: `docs/plugin-structure.md:214` (the `review-coordination.js` command-reference line)
- Test: `tests/bin-lib/review-coordination/cli.test.js` (append)

**Interfaces:**
- Consumes: `resolveTiebreak`, `buildFindingsArtifact`, `checkTiebreakCoverage` and `FINDINGS_ARTIFACT` (Tasks 2 and 3). It also uses `resolveTarget` (`./lib/stage-item/write`) and `writeArtifact` (`./lib/run-artifact/write`), called the same way `plugin/bin/write-run-artifact.js` calls them.
- Produces these CLI forms. All print one JSON line on success.
  - `resolve-tiebreak <finding.json> <reply-file> [--root <dir>]`. The reader is `(p) => fs.readFileSync(path.resolve(root, p), 'utf8')`, with `root` defaulting to `process.cwd()`. It exits 0 for every well-formed invocation, including a could-not-parse reply. It exits 2 for an unreadable file, a malformed finding (not an object, missing `lens`/`path`/`claim`, or bad `kind`), or wrong arity.
  - `write-findings <run-dir> <findings.json>`. It builds through `buildFindingsArtifact`, writes `review-findings.json` through the anchoring-aware writer, and prints `{ path, count }`. It exits 2 on unreadable or invalid input. It exits 3 when the run dir is missing or not anchored, matching `write-run-artifact.js`'s code.
  - `check-coverage <run-dir>`. It prints the `checkTiebreakCoverage` result and exits 0 even when ids are missing.
- The header comment's exit-code line gains `3 run dir missing/unanchored (write-findings only)`.

- [ ] **Step 1: Append the failing CLI tests** (use the file's existing `run(argv, deps)` capture pattern; read it first):
  - resolve-tiebreak on a could-not-parse reply exits 0 with `parse:"could-not-parse"`.
  - resolve-tiebreak with a malformed finding exits 2.
  - resolve-tiebreak with an unreadable reply file exits 2.
  - resolve-tiebreak with `--root` verifies evidence against a tmp file.
  - write-findings to an unanchored tmp dir exits 3.
  - check-coverage on a tmp run dir reports the missing ids and exits 0.
  - `--help` lists all three new forms.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/bin-lib/review-coordination/cli.test.js`
Expected: FAIL after Step 1 — the new tests fail with `unknown command: resolve-tiebreak` (the file's existing tests pass today).

- [ ] **Step 3: Implement the three subcommands.** Extend the `docs/plugin-structure.md` line 214 command form to `…|resolve-tiebreak|write-findings|check-coverage …`, with one sentence each on what it prints and that `check-coverage`'s exit code never refuses, because archival does.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/bin-lib/review-coordination/cli.test.js tests/bin-lib/tiebreak.test.js`
Expected: PASS, 0 failures.

- [ ] **Step 5: Commit** with `git add` of the three files and the message `Expose tiebreak resolve, findings write and coverage check on review-coordination.js — refs #3945`.

### Task 5: Coverage refusal on the reconcile path (`decideArchiveCore`)

**Files:**
- Modify: `plugin/bin/lib/reconcile/archive-merged.js:341-382` (`decideArchiveCore`) and its three callers (~:1646, ~:1810, ~:1855)
- Test: `tests/bin-lib/reconcile/archive-merged.test.js` (append)

**Interfaces:**
- Consumes: `checkRunTiebreakCoverage` (Task 3) and `listSpecDirs` (same file).
- Produces `decideArchiveCore(prState, consoleState, hasStagedPending, recordCheck, coverage)`.
  - `coverage` is `{ artifactPresent, artifactValid, missing }` or absent. Absent, or `artifactPresent:false`, behaves byte-for-byte as today.
  - The coverage check runs only where the function would otherwise return `{ action:'archive' }`, which is both of today's archive returns. That puts it after every existing guard.
  - `artifactValid:false` returns `{ action:'skip', reason:'tiebreak-artifact-invalid' }`.
  - A non-empty `missing` returns `{ action:'skip', reason:'tiebreak-coverage-missing', missing }`.
  - Each caller that has a `dir` passes `checkRunTiebreakCoverage(dir, listSpecDirs(dir))`.
  - A `refusal`/skip hint names the recovery: "re-run the review step's findings writer for this run, or delete review-findings.json if the run predates the tiebreak". Add the two reasons wherever reason codes get their hint text. Find that place via `grep -n "console-never-rendered-staged-pending" plugin/bin/lib/reconcile/archive-merged.js`, and do not add them to `STRUCTURALLY_STUCK_REASONS` unless the spec requires it (it does not).

- [ ] **Step 1: Append the failing tests:**
  - `decideArchiveCore refuses a listed finding with no verdict line (AC8.1)`.
  - `… refuses an invalid artifact with its own reason (AC8.1)`.
  - `… archives when every listed finding has a line (AC8.1)`.
  - `… archives with no artifact exactly as before (AC8.1)`: deepEqual with the 4-arg call over a table of existing inputs.
  - `… coverage is evaluated after the #3668/#3370/#3503 guards (AC8.1)`: an `unresolved` console and a `merged-partial` input still return their own reason even when coverage is missing.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/bin-lib/reconcile/archive-merged.test.js`
Expected: FAIL after Step 1 — the three new refusal and archive assertions fail (the file's existing tests pass today).

- [ ] **Step 3: Implement the parameter and the caller wiring.**

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/bin-lib/reconcile/archive-merged.test.js tests/bin-lib/reconcile/archive-merged-work-boundary.test.js tests/bin-lib/reconcile/residue-summary.test.js`
Expected: PASS, 0 failures. Existing tests are unchanged.

- [ ] **Step 5: Commit** with the message `Refuse reconcile archival of a run with an unresolved tiebreak finding — refs #3945`.

### Task 6: Coverage refusal on the `archive-run` verb

**Files:**
- Modify: `plugin/bin/hooks.js:1152-1257` (the `archive-run` branch). Insert after the #3668 block (line ~1205) and before `mainCheckoutRoot`.
- Test: `tests/archive-run-verb.test.js` (append; read its fixture helpers first)

**Interfaces:**
- Consumes: `checkRunTiebreakCoverage` (Task 3) and `listSpecDirs` (already imported there).
- Produces two stdout refusal lines, each exiting 0 like their siblings:
  - Missing ids: `` `claude-tweaks: archival refused — tiebreak-coverage-missing (${missing.length} listed finding(s) have no tiebreak verdict line: ${missing.join(', ')}) — re-run the review step's findings writer for this run, or delete review-findings.json if the run predates the tiebreak, then re-run archive-run\n` ``
  - Invalid artifact: `` `claude-tweaks: archival refused — tiebreak-artifact-invalid (review-findings.json is present but unreadable or malformed) — re-run the review step's findings writer for this run, or delete review-findings.json if the run predates the tiebreak, then re-run archive-run\n` ``

- [ ] **Step 1: Append the failing tests:**
  - A terminal run with a resolved console and an artifact listing one uncovered id prints `tiebreak-coverage-missing` and the run dir stays in place (AC8.1).
  - A malformed artifact prints `tiebreak-artifact-invalid` (AC8.1).
  - Full coverage archives (AC8.1).
  - No artifact archives as before (AC8.1).
  - An artifact inside `spec-3945/` of a multi-spec run is enforced (Review Focus).

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/archive-run-verb.test.js`
Expected: FAIL after Step 1 — the new refusal assertions fail (the file's existing tests pass today).

- [ ] **Step 3: Implement the inline check.**

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/archive-run-verb.test.js tests/hooks-archive-terminal.test.js tests/hooks-archive-run-1452.test.js`
Expected: PASS, 0 failures.

- [ ] **Step 5: Commit** with the message `Refuse archive-run on a run with an unresolved tiebreak finding — refs #3945`.

Acceptance-criteria coverage:

| AC | Task(s) |
|---|---|
| AC1.1, AC1.2, AC1.3, AC1.4, AC1.5, AC1.6 | 1 (parser fields + well-formed parse) |
| AC2.1, AC2.2 | 2 (confirmed outcome + resolve.js supersede test) |
| AC3.1, AC3.2 | 2 (drop table over five severities) |
| AC4.1, AC4.2 | 2 (four cant-tell tests + Step 4 revert proofs) |
| AC5.1, AC5.2, AC5.3, AC5.4, AC5.5, AC5.6, AC5.7, AC5.8, AC5.9 | 2 (one test per threshold/fallback branch) |
| AC6.1, AC6.2, AC6.3, AC6.4 | 1 (could-not-parse classes), 2 (status/no-evidence reasons, distinguishability) |
| AC7.1, AC7.2, AC7.3 | 1 (id), 3 (round-trip, coverage, same-key collision) |
| AC8.1, AC8.2 | 3 (invalid artifact), 5 (decideArchiveCore incl. guard order), 6 (archive-run) |
| AC9.1, AC9.2 | 2 (real-emitter fixture; range/absent line) |
| AC10.1, AC10.2, AC10.3, AC10.4, AC10.5 | 2 (evidence verification tests + Step 4 no-check revert proofs) |
| AC11.1 | `npm test` passes; the build's Common Step 5 full suite |
