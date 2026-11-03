# Settle Blocker-Landing Stop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A dispatched record stopped by `/flow`'s pre-claim blocker-landing check (#4553) settles as a non-failing stop: no retry counted, no `auto:merge` revoked, no `bot:blocked`. A claim and draft PR are released and tombstoned only when an earlier call of the same run took them, and the dispatching session's `cleanup-only` teardown never posts a second (or false) release comment. A second-call handoff continuation that re-runs Step 2.7b and stops reports `OUTCOME: blocked` and takes the same teardown skip (`two-call-gate.md` §6 as well as §5). Dispatch's queue pull also stops selecting a record whose out-of-run blocker is `unlanded` until that blocker lands. A record whose blocker declaration cannot be checked (a `Blocked by` number that is no valid issue number or is above 2147483647, or no entry in the native dependency response) is excluded from that pull as `malformed-blocker` and not dispatched, and every other record in the pull is still checked.

**Architecture:** Two halves. (1) Prose contract, pinned by `node --test` conformance suites: `/flow` names the stop's gate (`blocker-landing`) and its dispatch report line in `failure-cards.md`. Dispatch's Settle Step 6 gains a special case keyed on `ISSUE #{n}: failed:blocker-landing`, beside its existing pre-flight special cases. In the claimed case it runs steps 1-2 and step 5's PR tombstone only. `failure-check` learns how to classify the stop, and the headless self-report gets the name `flow-step-2.7b-blocker-landing`. `two-call-gate.md` §5 (first call) and §6 (a second call's continuation, which reports `blocked`) append `(blocker-landing: skip the claim release)` to the teardown call, §8 item 4 routes the second call's stop to §6, and wrap-up Section E skips its release on that phrase, mirroring #4899. (2) A selection-time exclusion. `preflight-records.js` gains `--prefetched-json` (records already fetched over `gh`, so it skips only the per-record `gh issue view`), and its native dependency call hands `gh`'s NOT_FOUND-only exit-1 response back to `fetchNativeDependencies`, so a candidate missing from that response is named (`missing dependency data for #n`) instead of buried in a raw exec error. A new CLI, `bin/dispatch-unlanded-blockers.js`, over `bin/lib/dispatch/unlanded-blockers.js`, screens out the records whose blocker declaration cannot be checked (`malformedRecords`), hands the rest to one `preflight-records.js --prefetched-json - --blocker-landing` call, and, when that call exits 1 naming candidates missing from the native dependency response (`nativeMissingRecords`), screens those out too and re-runs once without them. It appends a `reason: 'malformed-blocker'` entry per screened record and a `reason: 'unlanded-blocker'` entry per record with an `unlanded` blocker, and prints the pool without either. `queue-pull-script.md` runs it in a 9-line block, and its size headroom comes from moving three passes' rationale comments into `queue-pull-notes.md`.

**Tech Stack:** Markdown skill files; Node CLIs under `plugin/bin/`; `node --test` (built-in), `node:assert/strict`, `tests/helpers/read-skill.js`'s `readText`, `tests/helpers/conformance-asserts.js`.

**Spec:** `.claude-tweaks/pipelines/2026-11-03T163449-record-4792/work/4792-spec.md` (record #4792; Decisions Q1-Q5)

**Scope keywords:** blocker-landing, failed:blocker-landing, flow-step-2.7b, unlanded-blocker, malformed-blocker, dispatch-unlanded-blockers, prefetched-json, issuesFromRecordsJson, recoveredResponse, nativeMissingRecords, appendExclusion, queue-pull-notes, malformedRecords, skip the claim release

## Global Constraints

- Every `/claude-tweaks:{skill}` reference inside actionable instruction text is fully qualified; bare `/{skill}` only in descriptive prose (CLAUDE.md Cross-references).
- Relationships between skills are stated once, in `docs/skill-graph.md` (CLAUDE.md Cross-references) — add the new edges there (Tasks 2 and 7), never as a restated edge in a SKILL.md.
- **Q3 + Q4 containment (spec Decisions; Q4 Reading B, one rule for every single-record blocker fault).** A record whose blocker declaration cannot be checked is **excluded** from that pull with reason `malformed-blocker` (its own `dispatch-exclusions.json` entry, `detail: {cause}`, and its own report line), is not dispatched, and every other record in the pull is still checked. It is eligible again on the first pull after its `Blocked by` line is fixed (the queue pull truncates every non-`firing` entry each pull, `queue-pull-script.md` line 3). The faults, each pinned through the real `run` of `plugin/bin/preflight-records.js` (Task 5):
  - **Screened before the call** (`malformedRecords`, in this order): a record `number` that is not a positive integer (`run()`'s positional check, `plugin/bin/preflight-records.js:360`, and `issuesFromRecordsJson`'s `Number.isInteger`); a non-string `body` or non-array, non-null `labels` (`issuesFromRecordsJson`, `plugin/bin/lib/preflight-records/preflight-records.js:90-100`); and, only when work-links is not `native`, a `parseDependencies(body)` number that is not a positive integer at most `GRAPHQL_INT_MAX = 2147483647`. The first three make the call exit 2 for every candidate. `Blocked by #0` exits 2 at `blockerLandingFromGh`'s `Number.isSafeInteger(n) && n > 0` check (`plugin/bin/preflight-records.js:321`); a 20-digit number parses to a non-safe integer and exits 2 there too. **A number above 2147483647 that is still a safe integer passes that check and is interpolated into the landing query.** The GraphQL spec's `Int` is 32-bit, but a live probe (2026-11-03, `gh api graphql` against `thn-inc/claude-tweaks` with `issue(number:3000000000)`, `issue(number:2147483648)` and `issue(number:9007199254740991)`) showed github.com returns a `NOT_FOUND` error on that alias with exit 1, which `blocker-landing.js`'s NOT_FOUND-only recovery reads as `undetermined`/`not-found`. So, unscreened, such a record is kept and dispatched, and `/flow` Step 2.7b proceeds on `undetermined` too. The screen is therefore what keeps it out. A host that enforces the 32-bit limit would instead fail the whole query (exit 1). Either way the screen decides, and Task 5 pins the observed github.com shape. Such a number is never a positional number, so it is always out-of-run.
  - **Named by the call** (`nativeMissingRecords`): under `native`, a candidate with no `i{n}` entry in the native dependency response. `fetchNativeDependencies` throws `missing dependency data for #a, #b` (plus ` (GraphQL: …)` when the response carried errors) for the whole call (`plugin/bin/lib/issues/native-dependencies.js:48-54`), and `preflight-records.js` prints it as `preflight-records.js: {message}` and exits 1 (`plugin/bin/preflight-records.js:207-210`). Real `gh` reaches that message only after Task 4: a live probe (2026-11-03, `i99999999: issue(number:99999999)`) showed `gh api graphql` exits 1 on a `NOT_FOUND` alias and prints the partial data on stdout, so today the runner throws and the exec error, not the named message, reaches stderr. Task 4 wraps the native call's runner with `blocker-landing.js`'s NOT_FOUND-only recovery, generalised to alias names, so that response comes back as stdout and `fetchNativeDependencies` names the record. **Mechanism:** the CLI reads the child's stderr line by line (split on `'\n'`, a trailing `\r` stripped, never the `m` flag). A line matching `^preflight-records\.js: missing dependency data for (#\d+(?:, #\d+)*)(?: \(GraphQL: |$)` names records. When every named number is a candidate of that call, those records are excluded as `malformed-blocker` (cause `the native dependency response has no entry for it`) and the call is re-run exactly once over the rest. Any other exit-1 output is a whole-call failure, and so is a named number outside the call. That includes `missing repository — no dependency data for …` (a whole-response failure) and a re-run that fails again. A whole-call failure keeps the whole-pass fail-open for `unlanded-blocker`, but the `malformed-blocker` entries already found stand.
  - **Not a fault under `native`:** under `native`, `buildRecords` reads `blockedBy` from the native call (`plugin/bin/lib/preflight-records/preflight-records.js:147`), so a `Blocked by #0` body line is never read and never fails the call. The CLI therefore takes `--work-links "$WORK_LINKS"` (resolved at `queue-pull-script.md:153`; this repo resolves `native`, probed 2026-11-03) and forwards it, so the screen and the call read blockers from the same source. An empty value screens bodies (a garbage `Blocked by` line is still worth fixing) and forwards nothing. This is the one place the plan reads Q4 narrowly (a body line is a blocker declaration only where something reads it); Review Focus names it so a reviewer can overrule it.
  - Whole-call failures that no record can be blamed for keep the whole-pass fail-open for `unlanded-blocker`. They are: an exit-1 query failure other than the named native-missing line, a non-zero exit from the origin-host gate or repo resolution, an unparseable envelope, or an empty integration branch.
- **Release idempotency finding (Task 8).** `release-claim.js` is not idempotent on an already-released claim: on an absent blob or a tombstone the library sets `already-released` and still posts the release comment (`plugin/bin/lib/release-claim/release.js:254-276`; header `plugin/bin/release-claim.js:29-31`, "comment still posted in both cases"; pinned by `tests/bin-lib/release-claim/release.test.js`'s `an absent or tombstoned blob is already-released: no PUT, comment posted, labels still processed`). Only a missing `claims-registry` branch suppresses it. So Section E's release would post a false comment in the unclaimed case and a duplicate in the claimed case (Settle already released): the teardown parenthetical applies in both cases, and on §6's second-call path (always the claimed case: the first call claimed the record). The same finding makes `two-call-gate.md` §6 item 2's and §7's "finds an already-released claim and no-ops" wrong for their own paths. That is pre-existing and is **not** fixed here (see Follow-ups).
- **Size rail (blocks):** `RAIL_BYTES` = 52,500 B and `RAIL_LINES` = 2,000 (`plugin/bin/lib/skill-audit/budgets.js`), enforced by `tests/bin-lib/skill-audit/context-cost.test.js`'s `rail: every shipped skill .md fits one Read call`. Measured base bytes (`wc -c` re-run at `6c430595d`, after the origin/main merge `65bee9ec7` that brought in `0ef220b75`; all twelve files are byte-identical to the `03903e7a1` measurement, and the merge touched none of them) and planned results, from byte counts of this plan's own insertion texts (two scratch node scripts applied Task 6's edits (a)-(e) and (g) to the live `queue-pull-script.md` and `SKILL.md`, and summed every other task's insertion text):

  | File | Base | Planned | Headroom |
  |---|---|---|---|
  | `plugin/skills/flow/failure-cards.md` | 6,277 | ~7,095 | ~45.4 KB |
  | `plugin/skills/flow/multispec-dependency-ordering.md` | 5,289 | ~5,444 | ~47 KB |
  | `plugin/skills/dispatch/settle-and-merge.md` | 48,902 | 50,784 | 1,716 B (96.7%) |
  | `plugin/skills/assess-agent-autonomy/failure-check.md` | 3,935 | ~4,331 | ~48 KB |
  | `plugin/skills/dispatch/queue-pull-script.md` | 52,091 | 51,339 | 1,161 B (97.8%) |
  | `plugin/skills/dispatch/queue-pull-notes.md` | 6,123 | ~11,100 | ~41.4 KB |
  | `plugin/skills/dispatch/SKILL.md` | 51,877 | 52,033 | 467 B (99.1%) |
  | `plugin/skills/dispatch/blocked-exclusion-report.md` | 2,109 | ~2,810 | ~49.7 KB |
  | `plugin/skills/dispatch/mcp-transport.md` | 21,383 | ~22,634 | ~29.9 KB |
  | `plugin/skills/dispatch/two-call-gate.md` | 24,021 | ~25,909 | ~26.6 KB |
  | `plugin/skills/wrap-up/cleanup-procedures-execution.md` | 46,427 | 47,245 | 5,255 B |
  | `plugin/skills/wrap-up/flags.md` | 4,758 | 4,822 | 47,678 B |

  `queue-pull-script.md` has 409 B of headroom at base. The new pass adds 1,836 B: the `unlanded-blocker` bullet (677 B), the `malformed-blocker` bullet (610 B) and the script block (549 B). The remedy is fixed up front in Task 6. The pass's logic lives in the unit-tested CLI (Tasks 4-5), so the script carries one call. Three rationale-only comment blocks move out to `queue-pull-notes.md`: #2829's 18 lines (1,261 B), #1224's 14 lines (948 B) and #1983's 9 lines (642 B). Each leaves one 85-95 B pointer line, which nets 51,339 B. `SKILL.md` gets the two reason names in each of two bullets plus one queue-definition clause: 156 B, measured, against 623 B of base headroom. Do not add anything else to it. **Remedy if a later rebase leaves under 156 B:** shorten the queue-definition clause to `+ no \`unlanded\` or malformed blocker (#4792)` before touching any other text. The two bullets' reason names are pinned by `tests/dispatch-named-form-exclusion-reasons.test.js` and cannot be cut. None of the touched files is in a composed bundle: no `compose-context.js` call site names any of them (`grep -rn "compose-context.js" plugin/skills` | grep for each file — none).
- Commit style: `{Verb} {what} — {detail}, refs #4792`, never `closes`/`fixes`. End each commit message with the line `Claude-Session: https://claude.ai/code/session_01UwjosG5JjuyaA68VwC69Gs` (a second `-m`).
- Fixed literals: gate token `blocker-landing`; report line `ISSUE #{n}: failed:blocker-landing`; a first call (or its continuation) reports `OUTCOME: build-test-blocked`, a second call's continuation reports `OUTCOME: blocked` (`dispatch/task-prompt.md`'s second-call OUTCOME vocabulary: `merged | armed | pending-review | ready-to-merge | failed | blocked | handoff`); self-report name `flow-step-2.7b-blocker-landing`; release reason `failed: blocker-landing` (`_shared/issue-claims.md`'s Release triggers table: `failed: {gate}`); exclusion reasons `unlanded-blocker` and `malformed-blocker`; CLI `plugin/bin/dispatch-unlanded-blockers.js`; preflight flag `--prefetched-json`; teardown phrase `(blocker-landing: skip the claim release)`; `GRAPHQL_INT_MAX = 2147483647`; native-missing cause `the native dependency response has no entry for it`; per-record CLI line `AUTO — dispatch: #{n} excluded — malformed blocker declaration: {cause}; the other candidates are still checked`; report line `#{number} excluded — malformed blocker declaration: {cause} — eligible again once its Blocked by line is fixed`.
- Governing project skill `.claude/skills/skill-prose-conformance-tests/SKILL.md` (every task's tests), quoted verbatim:
  - "When the pinned prose is added in the same change, there is no frozen excerpt to use as a control. Prove each assertion on a mutated copy of the live text instead: delete or alter only the pinned clause, then assert the shared assertion helper throws **with that assertion's own message** … preceded by `assert.notEqual(mutated, original)` so a replace that matched nothing cannot pass as a control."
  - "**When one region must state many facts, use a missing-facts predicate and prove each fact returns exactly itself.** … `tests/helpers/conformance-asserts.js` (`missingFactsOf`, `assertEachPatternGoesRed`) is the home of both … Keep the patterns non-global".
  - "Build the control by **permutation, not deletion**: take the live text, splice the later block above the earlier one, and assert the same helper *throws* on the permuted string".
  - "Slice with `tests/helpers/conformance-asserts.js`'s `sectionOf(text, '## Heading')` and `lineStartingWith(text, prefix)` instead of writing another local copy" — **import** them; never copy them (the #4827 helper superseded the old per-suite copies; `tests/no-dispatch-host-preflight-conformance.test.js` now imports them).
  - "Read governed markdown through `tests/helpers/read-skill.js`'s `readText()`, never a private `fs.readFileSync(p, 'utf8')`."
  - From `executable-snippet-pins.md`: "**Run a snippet the Bash tool executes under both `bash --noprofile --norc` and `zsh -f`.** … Skip the zsh case with a visible reason when zsh is not on PATH (ubuntu CI), never silently". "**A `node -e` fence that spawns a plugin CLI runs against a stub CLI, with the plugin root passed through the environment.**" "Pass `CLAUDE_PLUGIN_ROOT` with forward slashes (`path.join(ROOT, 'plugin').split(path.sep).join('/')`)".
  - Anti-pattern row: "Pinning a skill file's size against a byte literal … Import `RAIL_BYTES` from `budgets.js` and assert against it".
- Governing project skill `.claude/skills/gh-api-module-pattern/SKILL.md` and its `cli-wrapper-contract.md` (Tasks 4-5, `plugin/bin/**`), quoted verbatim:
  - "Logic lives in an exported `run(argv, deps)`; every side effect (`runner`, `ghAvailable`, `remoteUrl`, `stdout`, `stderr`) goes through `deps` so tests inject fakes. **Every** `deps` call that can throw … is try/caught into the documented exit-code contract".
  - "**A fail-closed branch around an injected dependency needs one test of the real dependency's failure shape, not only a stub that throws.**"
  - "`require.main === module` guard sets `process.exitCode = run(...)` (never `process.exit`, which can truncate piped stdout)."
  - "**Every real spawn passes `windowsHide: true` in a form `tests/windows-hide-spawn-conformance.test.js` can see.**"
  - "**Bound every remote-contacting call on the seam; a local-only call owes no bound.**" and "**A seam that pipes a child whose output the module does not control sets `maxBuffer: LARGE_MAX_BUFFER_BYTES`**".
  - "**A seam that writes a body widens to `runner(args, input)` and pipes it on stdin, instead of staging a temp file.**" (why `--prefetched-json -` reads stdin).
  - "Tests never touch real `gh`: fake runners branch on the `args` shape … and `throw new Error('unexpected ' + args.join(' '))` on anything unhandled".
- Governing project skill `.claude/skills/claim-targets-stop-addition/SKILL.md` (Task 8 only; it names `two-call-gate.md`, Section E, `flags.md` and `release-claim`). This stop is not a `claim-targets.js` exit, so rows 1-10, 12 and 13 do not apply (the firing continues, and the queue pull's `unlanded-blocker` line in Task 7 is what a person sees next). Quoted verbatim, the parts that do apply:
  - Row 11: "`plugin/skills/dispatch/two-call-gate.md` section 5, `plugin/skills/wrap-up/cleanup-procedures-execution.md` Section E, `plugin/skills/wrap-up/flags.md` | Only when teardown must not release: the phrase the `cleanup-only` call appends, Section E's skip with its log line, and the `cleanup-only` flag entry that strips the phrase before input classification". Q5 extends "section 5" to section 6 as well: the same `cleanup-only` call is made from §6 item 1 for a second call's continuation.
  - Decision 3: "Trace what `release-claim.js` would do at Settle step 2 and at Section E for this stop's blob state."
  - Anti-patterns: "Stopping the skip at Settle | `two-call-gate.md` section 5 calls `cleanup-only` afterwards, and its Section E releases again. A skip has to name every release site" and "Adding the Section E phrase without declaring it in `flags.md` | The `cleanup-only` argument parser would read the parenthetical as input, not as a flag it strips".
  - Every release site, from its Common Operations grep (`git grep -n 'release-claim\.js' -- plugin/skills/dispatch plugin/skills/wrap-up`, run at authoring): `settle-and-merge.md:113` (plan-review, not this stop), `settle-and-merge.md:118` (Settle step 2, Task 2), `two-call-gate.md:39` and `cleanup-procedures-execution.md:335` (#4899's skip, prose), `cleanup-procedures-execution.md:423` (Section E's release, Task 8).
- `.claude/skills/bin-source-scan-conformance/SKILL.md` does not apply: no task adds or changes a source-scan suite. The new `plugin/bin` code must still pass the existing scans (`tests/path-guard-conformance.test.js`: no `fs.existsSync`/`fs.realpathSync`; `tests/windows-hide-spawn-conformance.test.js`; `tests/bin-lib/exit-code-conformance.test.js`), so Tasks 4-5 run them. `malformedRecords` reuses `parseDependencies` (no new body regex).
- `.claude/skills/regex-scan-linearity/SKILL.md` and `.claude/skills/parse-signal-discipline/SKILL.md` apply to the one new regex, `nativeMissingRecords`'s line recogniser (Task 5). It runs on a child's stderr, split on `'\n'` and matched per line without `m` (regex-scan-linearity's "A line under `m` is JS's line, not git's"). It is anchored at `^`, with no lazy group and no `\s` run, so each line costs one attempt. Its end is anchored to the writer's two shapes, end of line or ` (GraphQL: ` (parse-signal-discipline item 6: a positive recogniser anchors both ends against what the writer emits; the writer is `native-dependencies.js:52-53`). It returns `null` ("could not attribute") rather than `[]` whenever a named number is not a candidate of the call (item 1). Task 5 pins a tail-carrying line and a truncated list. The input is one child's bounded stderr, never unbounded text, so no `perf/` pin is owed; Task 5's step 4 still times the skill's probe input shape once (`'#1, '.repeat(50000)`) and records the milliseconds.
- Scope and edit discipline (CLAUDE.md Working Approach): "Commit tests only where the task asks for them or the repo already keeps tests for this kind of change, sized like the neighboring test files; scratch checks stay scratch. Touch only what the task requires — a pre-existing bug you notice is a follow-up to report, not a fix to fold in, unless the task cannot work without it."

## Review Focus

- A handoff continuation of either call (`/flow #{n} test…` with the run's `PIPELINE_RUN_DIR`) re-runs Step 2.7b while this run already holds the claim and its draft PR. Settle must release the claim (steps 1-2) and close the PR via step 5's tombstone (Q2 Reading A), but not post step 5's failure comment on the issue. Task 2 pins both halves and that the tombstone pointer never matches `retry.js`'s `ATTEMPT_RE`. A second call's continuation reports `OUTCOME: blocked`, not `build-test-blocked` (Q5), before reaching wrap-up, so nothing tears its worktree down unless §8 item 4 routes it to §6. Task 1 pins the outcome in the failure-cards row; Task 8 pins the §8 routing, §6's paragraph and the phrase.
- A first call that stops at 2.7b holds no claim and has opened no PR (`/build` Spec Step 1 opens it, after Step 2.8). Neither Settle nor the dispatching session's `cleanup-only` teardown may run `release-claim.js`, which on an absent blob still posts a release comment (a false one), and in the claimed case would post a duplicate. Task 2 pins "Otherwise … skip steps 1-2 and the tombstone"; Task 8 pins the teardown phrase (§5 and §6), Section E's skip and its `flags.md` declaration.
- One record's blocker fault must never turn the selection-time pass off for the pool (Q3), and that record must not be dispatched (Q4). A `Blocked by #0` line, a non-string body, non-array labels or a non-integer number each make `preflight-records.js` exit 2 for the whole call. A candidate missing from the native dependency response makes it exit 1. A `Blocked by` number above 2147483647 reads `undetermined` on github.com and would dispatch. Task 5 runs each fault through the real `preflight-records.js` `run`: unscreened, it proves the whole-call exit (or the kept-and-dispatched `undetermined`); through the CLI, it proves the record lands in a `malformed-blocker` entry, is absent from the printed pool, and that the pool's `unlanded` record is still excluded. Under `work-links: native` a body `Blocked by #0` line is not a fault (Task 5 pins it). This is the plan's narrow reading of Q4; a reviewer who reads Q4 as covering an unread body line too should change `malformedRecords` check 4 to run under every `work-links` value. A record whose blocker is a screened-out record reads that blocker `open` and is kept.
- The pass must otherwise fail open. Step 2.7b re-checks before any claim, so a skipped exclusion costs one dispatch that ends in this record's non-failing stop. A pass that stopped the firing on a probe failure would block every unrelated record. Only a refused exclusions write or an unreadable `$DISPATCH_GROUPS` stops (#3110). A whole-call failure never drops the `malformed-blocker` entries already found. `undetermined` keeps the candidate, because Step 2.7b proceeds on `undetermined` too (`flow/validation.md` item 6); `open` is the `blocked` pass's. Task 5 pins each fail-open branch with an input that only that branch decides.
- Cost: this repo runs `work-links: native` with 189 open `auto:build` records (probed 2026-11-03). Plain `preflight-records.js` would make one `gh issue view` per candidate on every queue pull, and the drain Loop re-pulls each iteration. `--prefetched-json` keeps the pass at one native-dependency GraphQL call plus one landing GraphQL call plus one compare per distinct candidate commit, and one more `preflight-records.js` run only on a pull where a candidate is missing from the native response (never a loop: the re-run is not re-run). Task 5's AC3.1 test asserts zero `issue view` calls, and its native-missing tests assert exactly two calls.
- The Settle special case must precede Settle step 1 in the linear procedure, or the generic path runs first. Task 2 pins placement with a permutation control. The queue-pull pass must sit after the shipped Close-proposal staging and before the neighbour-in-flight pass. Task 6 pins that the same way.

## Follow-ups (not fixed in this plan)

- **Release-claim idempotency wording.** `two-call-gate.md` §6 item 2 ("`cleanup-only`'s Section E release step finds an already-released claim and no-ops") and §7 (the same sentence) are wrong: `release-claim.js` posts a release comment on an absent blob or a tombstone (`plugin/bin/lib/release-claim/release.js:254-276`), so those paths post a duplicate release comment. This is pre-existing and outside the blocker-landing stop. It stays unedited here by the record's plan-review ruling. `two-call-gate.md` is in this diff, so pre-existence alone would not defer it (`_shared/deferral-gate.md`'s Bad reasons). What defers it is that the fix has two shapes and choosing between them is a design call: make `release-claim.js` skip the comment on an already-released blob (a contract change for every caller), or correct the prose and add the skip phrase on §6/§7. During this build, file it with `/claude-tweaks:capture`, with a spec-shaped body (Current State / Deliverables / Acceptance Criteria), `Defer-reason: needs-human-decision`, Key Files `plugin/skills/dispatch/two-call-gate.md` and `plugin/bin/lib/release-claim/release.js`, and the evidence above. Log the captured record number in `decisions.md`. The build files it; this plan revision does not.

---

### Task 1: Name the `blocker-landing` gate in /flow

**Role:** integration

**Files:**
- Modify: `plugin/skills/flow/failure-cards.md` (line 3, the line starting `Loaded by`; routing table, append a row after the line starting `| Step 3 Manifesto ceremony-check returned no`)
- Modify: `plugin/skills/flow/multispec-dependency-ordering.md` (insert after the paragraph starting `` `{text-file}` holds one line, `` and before the line starting `A failed blocker query is not \`undetermined\``)
- Test: `tests/flow-blocker-landing-conformance.test.js` (append)

**Interfaces:**
- Produces: the failure-cards routing row starting `| Step 2.7b blocker landing`, naming gate `blocker-landing`, the report line `ISSUE #{n}: failed:blocker-landing`, and both callers' outcomes: `build-test-blocked` for a first call (or its continuation) and `blocked` for a second call's continuation. Task 2's Settle paragraph cites it as "`flow/failure-cards.md`'s blocker-landing row". Task 8's §6 paragraph relies on its `blocked` clause.
- Q5 facts (checked against the source): the second call's OUTCOME vocabulary is `merged | armed | pending-review | ready-to-merge | failed | blocked | handoff` (`plugin/skills/dispatch/task-prompt.md:499`). Its per-issue line is `ISSUE #{n}: {failed:{gate} | blocked:retry-ceiling}` (`task-prompt.md:506`). `SECOND_CALL_STEPS` includes `test` (`two-call-gate.md` §8 item 1), and `flow/validation.md` 2.7b item 2 skips only a step list with neither `build` nor `test`. So a second call's continuation whose `NEXT_STEPS` starts at `test` re-runs 2.7b in the claimed case.

- [ ] **Step 1: Write the failing test** — append to `tests/flow-blocker-landing-conformance.test.js`. Its existing `readText`, `path`, `assert`, `FLOW_DIR`, `ORDERING`, `outOfRunSection`, `mutate` and `requireOrder` (a hoisted function declaration) are in scope. Add `const { missingFactsOf, assertEachPatternGoesRed, lineStartingWith } = require('./helpers/conformance-asserts');` and `const FAILURE_CARDS = path.join(FLOW_DIR, 'failure-cards.md');`.

  `CARD_ROW_PREFIX = '| Step 2.7b blocker landing'`. `cardRow(text)` returns `lineStartingWith(text, CARD_ROW_PREFIX)` after `assert.ok(row, 'failure-cards.md has no line starting "| Step 2.7b blocker landing"')`. `CARD_FACTS` (non-global, each matching once in the row):
  - `/`open` or `unlanded` out-of-run blocker/` — 'AC1.1: the row names both stopping verdicts'
  - `/gate `blocker-landing`/` — 'AC1.1: the row names the gate'
  - `/when the run already holds claims \(a continuation re-running the pre-claim checks\), the claims rules below still apply/` — 'AC5.1: a continuation\'s held claims keep the claims rules'
  - `/`OUTCOME: build-test-blocked`, one `ISSUE #\{n\}: failed:blocker-landing` line per target, and `STATUS: BLOCKED`/` — 'AC2.1: the dispatch report line'
  - `/a second call's handoff continuation \(its step list includes `test`\) reports `OUTCOME: blocked` with the same `ISSUE` line/` — 'AC6.1: a second call\'s continuation reports blocked'
  - `/Settle treats it as a non-failing stop \(`dispatch\/settle-and-merge\.md`'s Blocker-landing special case\)/` — 'AC2.1: cites the Settle special case'

  `GATE_SENTENCE = "An \`open\` or \`unlanded\` verdict's stop is gate \`blocker-landing\`"`. Factor `assertRoutesToGate(text)`: `const section = outOfRunSection(text)`; `assert.match(section, /An `open` or `unlanded` verdict's stop is gate `blocker-landing`; under `\/claude-tweaks:dispatch` report it per `failure-cards\.md`'s blocker-landing row\./, 'ordering section routes the open and unlanded stops to the blocker-landing gate')`; then `requireOrder(section, ['| \`undetermined\` |', GATE_SENTENCE, 'A failed blocker query is not'])`, so the sentence sits after the verdict table and can never be read as covering a failed blocker query.

  Tests:
  - `test('AC1.1 AC2.1 AC5.1 AC6.1: failure-cards.md names the blocker-landing gate and both calls\' dispatch reports (#4792)')` — `assert.deepEqual(missingFactsOf(CARD_FACTS)(cardRow(readText(FAILURE_CARDS))), [])`.
  - `test('AC6.1: the row\'s second-call outcome is one the second call\'s template can report')` — read `plugin/skills/dispatch/task-prompt.md`, take the line starting `OUTCOME: {merged` (assert it exists) and assert it contains `| blocked |`. Then assert the row's first-call outcome `build-test-blocked` is on the line starting `OUTCOME: {build-test-ok`. Control: a copy of the row with `OUTCOME: blocked` replaced by `OUTCOME: stopped` (`assert.notEqual` first) fails the AC6.1 fact in `missingFactsOf`, so the row cannot drift to a word the template lacks.
  - `test('AC1.2: each failure-cards blocker-landing fact can go red')` — `assertEachPatternGoesRed(row, CARD_FACTS, missingFactsOf(CARD_FACTS))`.
  - `test('AC1.1: failure-cards.md is loaded on the blocker-landing stop')` — line 3 (the line starting `Loaded by`) matches `/or Step 2's blocker-landing stop\) \*\*only when a gate fails\*\*/`. Control: `mutate(text, ", or Step 2's blocker-landing stop", '')` fails the same factored check.
  - `test('AC1.1: the out-of-run section names the open and unlanded stops as gate blocker-landing, after the verdict table and before the failed-query line (#4792)')` — `assertRoutesToGate(readText(ORDERING))` passes. Deletion control: `mutate(text, /An `open` or `unlanded` verdict's stop is gate[^\n]*\n\n/, '')` makes it throw `/ordering section routes the open and unlanded stops/`. Permutation control: cut the sentence's line (and its trailing blank line) and re-insert it directly after the line starting `A failed blocker query is not` (`assert.notEqual` first) → it throws `/must come after the previous marker/`.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/flow-blocker-landing-conformance.test.js`
Expected: FAIL — `failure-cards.md has no line starting "| Step 2.7b blocker landing"`, the loaded-on test, and `ordering section routes the open and unlanded stops to the blocker-landing gate`; every pre-existing test still passes.

- [ ] **Step 3: Edit the prose**

  In `failure-cards.md` line 3, replace `Loaded by \`/claude-tweaks:flow\` Step 4 (or Step 3's Manifesto ceremony-check) **only when a gate fails**.` with `Loaded by \`/claude-tweaks:flow\` Step 4 (or Step 3's Manifesto ceremony-check, or Step 2's blocker-landing stop) **only when a gate fails**.` Append this row as the last row of the routing table (directly after the `| Step 3 Manifesto ceremony-check returned no` row):

  ```
  | Step 2.7b blocker landing (or multi-spec Validation step 3) stopped on an `open` or `unlanded` out-of-run blocker — gate `blocker-landing` | No template: the stop message (`multispec-dependency-ordering.md`'s verdict table and its `unlanded` card) is the whole report; when the run already holds claims (a continuation re-running the pre-claim checks), the claims rules below still apply. Under `/claude-tweaks:dispatch` the call reports `OUTCOME: build-test-blocked`, one `ISSUE #{n}: failed:blocker-landing` line per target, and `STATUS: BLOCKED`; a second call's handoff continuation (its step list includes `test`) reports `OUTCOME: blocked` with the same `ISSUE` line. Settle treats it as a non-failing stop (`dispatch/settle-and-merge.md`'s Blocker-landing special case) |
  ```

  In `multispec-dependency-ordering.md`, after the paragraph starting `` `{text-file}` holds one line, `` (it ends `then rewrite it for the next blocker.`) and before the line `A failed blocker query is not \`undetermined\` — the call exits non-zero and the run stops before claiming (\`multispec-preflight-failure.md\`).`, insert a blank line and:

  ```
  An `open` or `unlanded` verdict's stop is gate `blocker-landing`; under `/claude-tweaks:dispatch` report it per `failure-cards.md`'s blocker-landing row.
  ```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/flow-blocker-landing-conformance.test.js tests/flow-manifesto-ceremony-fallback-conformance.test.js tests/multispec-preflight-failure-conformance.test.js tests/dispatch-handoff-continuation-conformance.test.js tests/bin-lib/skill-audit/house-structure.test.js tests/skill-graph-table-structure.test.js`
Expected: PASS (all tests, old and new).

- [ ] **Step 5: Commit**

  ```bash
  git -C "/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude/worktrees/dispatch-record-4792" add plugin/skills/flow/failure-cards.md plugin/skills/flow/multispec-dependency-ordering.md tests/flow-blocker-landing-conformance.test.js
  git -C "/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude/worktrees/dispatch-record-4792" commit -m "Name the blocker-landing gate in /flow — both calls' dispatch report for the pre-claim stop, refs #4792" -m "Claude-Session: https://claude.ai/code/session_01UwjosG5JjuyaA68VwC69Gs"
  ```

### Task 2: Settle the blocker-landing stop as a non-failing stop

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/skills/dispatch/settle-and-merge.md` (new paragraph directly after the paragraph starting `**No-dispatch-host special case (#4555).**`, before the line starting `1. The CLI in step 2 performs the ownership read itself`)
- Modify: `docs/skill-graph.md` (`## dispatch` table: new row directly after the row starting `| \`build/execution-mode-policy.md\` | Since #4555`)
- Create: `tests/settle-blocker-landing-stop-conformance.test.js`

**Interfaces:**
- Consumes: Task 1's failure-cards row (it must contain `failed:blocker-landing`).
- Produces: the Settle paragraph starting `**Blocker-landing special case (#4792).**`. Task 3's failure-check bullet and Task 8's teardown paragraph cite it as "`dispatch/settle-and-merge.md`'s Blocker-landing special case".
- Behavioral claims and their mechanisms: "claim released" is `bin/release-claim.js` (Settle step 2), run only in the claimed case; "`auto:merge` still present" holds because step 3 (the only revoking site in Settle, besides step 6's ceiling removal) is skipped; "closes the draft PR with its resume command" is step 5's tombstone (`gh pr close`, after the `failure`-kind pointer per `_shared/pr-run-comments.md`), where the resume command is the PR body's `### Resume` section (`_shared/pr-early-run-lifecycle.md`); "no retry counted" holds because `countFailedAttempts` (`bin/lib/issues/retry.js`) counts only bodies matching `/^Attempt (\d+) failed: /`, and the pointer opens with `<!-- run-comment: failure -->`.

- [ ] **Step 1: Write the failing test** — create `tests/settle-blocker-landing-stop-conformance.test.js`, header comment naming #4792 and what it pins. Import `missingFactsOf`, `assertEachPatternGoesRed`, `lineStartingWith` from `./helpers/conformance-asserts`, `readText` from `./helpers/read-skill`, and `countFailedAttempts` from `../plugin/bin/lib/issues/retry`. Constants: `SETTLE = plugin/skills/dispatch/settle-and-merge.md`, `FAILURE_CARDS = plugin/skills/flow/failure-cards.md`, `SKILL_GRAPH = docs/skill-graph.md`, `SETTLE_PREFIX = '**Blocker-landing special case (#4792).**'`, `SETTLE_STEP1 = '1. The CLI in step 2 performs the ownership read itself'`. `requireLine(text, prefix, name)` = `lineStartingWith` plus `assert.ok(line, \`${name} has no line starting "${prefix}"\`)`.

  `SETTLE_FACTS` (non-global, each matching exactly once in the paragraph):
  - `/`ISSUE #\{n\}: failed:blocker-landing`/` — 'AC1.1: Settle recognizes the stop by its gate line'
  - `/on an `open` or `unlanded` out-of-run blocker/` — 'AC1.1: names both stopping verdicts'
  - `/treat it as a non-failing stop: the blocker, not the record, is at fault/` — 'AC1.1: non-failing stop'
  - `/The claimed case is when this run's `decisions\.md` already carries a `Step 2\.8: claimed #\{n\}` line/` — 'AC5.1: the claimed case keys on the Step 2.8 claim line'
  - `/a handoff continuation of either call re-ran the pre-claim checks/` — 'AC6.1: the claimed case covers a second call\'s continuation too'
  - `/In the claimed case, run steps 1-2 with `--reason "failed: blocker-landing"`/` — 'AC2.1: the claimed case releases the claim'
  - `/then step 5's PR tombstone and nothing else of step 5/` — 'AC5.1: the claimed case runs only step 5\'s tombstone'
  - `/post the `failure`-kind pointer with the sentence `Stopped: an out-of-run blocker has not landed\. Resume with the ### Resume command in this PR body once it lands\.`/` — 'AC5.1: the pointer carries the resume command' (the sentence says "Stopped", not "Stopped before build": a second call's continuation stops after the build)
  - `/then `gh pr close` the PR, so the record is not stranded behind the `open-pr` exclusion/` — 'AC5.1: the claimed case closes the draft PR'
  - `/Otherwise the stop came before any claim of this run's, so skip steps 1-2 and the tombstone/` — 'AC2.1: no release or tombstone without a claim of this run\'s'
  - `/no `failure-check` classification/` — 'AC2.1: no failure-check'
  - `/no `auto:merge`\/`auto:merge-pending` revocation/` — 'AC2.1: auto:merge stays'
  - `/no attempt counted against `dispatch-retry-ceiling`/` — 'AC1.1: does not count toward the retry ceiling'
  - `/no failure comment on the issue/` — 'AC1.1: no failure comment'
  - `/never reaches `bot:blocked` on this stop/` — 'AC1.1: never bot:blocked'
  - `/When `DISPATCH_HEADLESS=1` was set, read `_shared\/headless-self-report\.md`/` — 'self-report gated on DISPATCH_HEADLESS=1'
  - `/failing-check-name `flow-step-2\.7b-blocker-landing`/` — 'self-report name'
  - `/with the stop message as the diagnostic body \(the `unlanded` card, or the `open` verdict's one-line stop, which has no card\)/` — 'the self-report body exists for both verdicts: an `open` stop has no card'

  Factor `assertSettle(text)` = `assert.deepEqual(missingFactsOf(SETTLE_FACTS)(requireLine(text, SETTLE_PREFIX, 'settle-and-merge.md')), [], 'the Settle special case must state every fact (#4792)')`.

  Tests:
  - `test('AC1.1 AC2.1 AC5.1 AC6.1: Settle settles a blocker-landing stop as a non-failing stop (#4792)')` — `assertSettle(readText(SETTLE))`.
  - `test('AC1.2: each Settle blocker-landing fact can go red')` — `assertEachPatternGoesRed(paragraph, SETTLE_FACTS, missingFactsOf(SETTLE_FACTS))`.
  - `test('AC1.2: reverting the Settle paragraph turns the suite red')` — split the live text on `'\n\n'`, filter out the chunk starting with `SETTLE_PREFIX`, and assert exactly one chunk was removed. Rejoin it, `assert.notEqual(reverted, text)`, then `assert.throws(() => assertSettle(reverted), /settle-and-merge\.md has no line starting/)`.
  - `test('AC1.1: the special case sits before Settle step 1')` — copy the placement test and its move-after-step-1 control from `tests/no-dispatch-host-preflight-conformance.test.js` (`AC12.1: the special case sits before Settle step 1`), using this file's prefix.
  - `test('AC1.1: Settle and failure-cards name the same gate')` — the token `failed:blocker-landing` is in both the Settle paragraph and the failure-cards line starting `| Step 2.7b blocker landing`. Control: the Settle paragraph with `replaceAll('blocker-landing', 'blocker-landed')` (`assert.notEqual` first) fails the same `includes` check.
  - `test('AC5.2: step 5 still carries the tombstone the claimed case runs')` — factor `assertTombstone(text)`. It slices from the line starting `5. Compose the failure comment` to the line starting `6. **If \`ceilingHit\`` (assert both indexes are not -1 before slicing). The slice must include `` **`run-state.json` carries a `pr` object — this is the failure tombstone** ``, `Attempt failed — see the full comment on #%s.` and `gh pr close {pr-number} --repo {owner}/{repo}`. Each check gets its own message. Control: a copy with the `gh pr close {pr-number}` line removed (`assert.notEqual` first) throws that check's message.
  - `test('AC5.1: the claimed-case pointer never counts as a failed attempt')` — capture the sentence from the paragraph with `/pointer with the sentence `([^`]+)`/` (assert a match), build `body = '<!-- run-comment: failure -->\n\n' + sentence`, and assert `countFailedAttempts([{ body }]) === 0`. Counter control: `countFailedAttempts([{ body: 'Attempt 1 failed: x' }]) === 1`.
  - `test('skill-graph names the blocker-landing Settle edge (#4792)')` — the `docs/skill-graph.md` line starting `| \`flow/failure-cards.md\` |` exists and contains `failed:blocker-landing`, `flow-step-2.7b-blocker-landing` and `PR tombstone`. Control: a copy with that line removed (`assert.notEqual` first) fails the existence check.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/settle-blocker-landing-stop-conformance.test.js`
Expected: FAIL — `settle-and-merge.md has no line starting "**Blocker-landing special case (#4792).**"` (and the skill-graph test); the AC5.2 step-5 test and the counter control already pass.

- [ ] **Step 3: Edit the prose** — insert after the No-dispatch-host paragraph, separated by blank lines, this exact paragraph:

  ```
  **Blocker-landing special case (#4792).** When the failure this call is settling is `/flow`'s pre-claim blocker-landing stop (`ISSUE #{n}: failed:blocker-landing` — Step 2.7b, or multi-spec Validation step 3, on an `open` or `unlanded` out-of-run blocker; `flow/failure-cards.md`'s blocker-landing row), treat it as a non-failing stop: the blocker, not the record, is at fault, and no retry changes the outcome until the blocker lands. The claimed case is when this run's `decisions.md` already carries a `Step 2.8: claimed #{n}` line — an earlier call of this run claimed the record and opened its draft PR, and a handoff continuation of either call re-ran the pre-claim checks. In the claimed case, run steps 1-2 with `--reason "failed: blocker-landing"`, then step 5's PR tombstone and nothing else of step 5: when `run-state.json` carries a `pr` object, post the `failure`-kind pointer with the sentence `Stopped: an out-of-run blocker has not landed. Resume with the ### Resume command in this PR body once it lands.` in place of `Attempt failed — see the full comment on #%s.`, then `gh pr close` the PR, so the record is not stranded behind the `open-pr` exclusion. Otherwise the stop came before any claim of this run's, so skip steps 1-2 and the tombstone. Either way, skip the rest of steps 3-7: no `failure-check` classification, no `auto:merge`/`auto:merge-pending` revocation, no attempt counted against `dispatch-retry-ceiling`, and no failure comment on the issue — the record keeps every grant and never reaches `bot:blocked` on this stop. When `DISPATCH_HEADLESS=1` was set, read `_shared/headless-self-report.md` and follow its dedup-and-file procedure (caller = `dispatch`), failing-check-name `flow-step-2.7b-blocker-landing`, with the stop message as the diagnostic body (the `unlanded` card, or the `open` verdict's one-line stop, which has no card).
  ```

  In `docs/skill-graph.md`'s `## dispatch` table, insert after the `build/execution-mode-policy.md` row (the one starting `| \`build/execution-mode-policy.md\` | Since #4555`, line 274 at authoring; the `## flow` table's row of the same file at line 345 is a different row):

  ```
  | `flow/failure-cards.md` | Since #4792, `settle-and-merge.md`'s Blocker-landing special case recognizes the `blocker-landing` gate that file's routing table names for `/flow`'s pre-claim blocker-landing stop (`ISSUE #{n}: failed:blocker-landing`) and settles it as a non-failing stop — no `failure-check`, no `auto:merge` revocation, no retry count, no failure comment on the issue. Only when an earlier call of the run claimed the record (a handoff continuation of either call) does it release that claim and run step 5's PR tombstone, closing the draft PR with its resume command; headless, it files through `_shared/headless-self-report.md` as `flow-step-2.7b-blocker-landing`. |
  ```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/settle-blocker-landing-stop-conformance.test.js tests/no-dispatch-host-preflight-conformance.test.js tests/flow-claim-preflight.test.js tests/plan-review-dispatch-relay-conformance.test.js tests/claim-mcp-projection-conformance.test.js tests/pr-run-comments.test.js tests/dispatch-retry-prior-attempt-conformance.test.js tests/dispatch-settle-and-merge-lazy-read.test.js tests/skill-graph-table-structure.test.js tests/skill-graph-dangling-pointer.test.js tests/bin-lib/skill-audit/context-cost.test.js`
Expected: PASS. The new paragraph lands inside `tests/flow-claim-preflight.test.js`'s Claim-contest slice (to `\n1. The CLI in step 2`); it carries none of that slice's needles (`Claim in-flight`, `flow-step-2.8-claim-*`), so those pins keep their meaning. `wc -c plugin/skills/dispatch/settle-and-merge.md` prints under 52,500 (planned 50,784).

- [ ] **Step 5: Commit**

  ```bash
  git -C "/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude/worktrees/dispatch-record-4792" add plugin/skills/dispatch/settle-and-merge.md docs/skill-graph.md tests/settle-blocker-landing-stop-conformance.test.js
  git -C "/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude/worktrees/dispatch-record-4792" commit -m "Settle a blocker-landing stop as a non-failing stop in dispatch — no retry count, auto:merge kept, claimed-case PR tombstone, refs #4792" -m "Claude-Session: https://claude.ai/code/session_01UwjosG5JjuyaA68VwC69Gs"
  ```

### Task 3: Teach failure-check the blocker-landing stop

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/skills/assess-agent-autonomy/failure-check.md` (Step 2: Judge — new bullet after the `- **Ambiguous**:` bullet, which spans three wrapped lines, and before the line starting `- **\`NOTIFY_NOW\`**:`)
- Test: `tests/settle-blocker-landing-stop-conformance.test.js` (append)

**Interfaces:**
- Consumes: Task 2's paragraph name "Blocker-landing special case".

- [ ] **Step 1: Write the failing test** — append. `FAILURE_CHECK = plugin/skills/assess-agent-autonomy/failure-check.md`. The bullet is hard-wrapped to match the file, so `bulletOf(text)` takes the lines from the one starting `- **Blocker-landing stop**:` up to, but not including, the next line starting `- **` or `## `, joins them, and collapses whitespace (`.replace(/\s+/g, ' ')`). It asserts the start line exists with the message `failure-check.md has no line starting "- **Blocker-landing stop**:"`. Facts:
  - `/`ISSUE #\{n\}: failed:blocker-landing`/` — 'failure-check keys on the gate line'
  - `/Settle skips this mode for it \(`dispatch\/settle-and-merge\.md`'s Blocker-landing special case\)/` — 'failure-check cites the Settle special case'
  - `/classify it `transient`/` — 'AC2.1: a stray stop classifies transient, so auto:merge is preserved'
  - `/no build or test ran, so no diff is at fault/` — 'failure-check states why'

  Tests: `test('AC2.1: failure-check.md classifies the blocker-landing stop (#4792)')` (`missingFactsOf` → `[]`), and `test('each failure-check blocker-landing fact can go red')` (`assertEachPatternGoesRed` over `bulletOf(text)`). Placement: `test('the bullet sits inside Step 2: Judge')` — the bullet's start index is after `## Step 2: Judge` and before `## Step 3: Render`. Control: a copy with the bullet's lines moved to just after the `## Step 3: Render` line (`assert.notEqual` first) fails the same factored check.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/settle-blocker-landing-stop-conformance.test.js`
Expected: FAIL — `failure-check.md has no line starting "- **Blocker-landing stop**:"`; Task 2's tests still pass.

- [ ] **Step 3: Edit the prose** — insert the bullet, wrapped like its neighbours:

  ```
  - **Blocker-landing stop**: `/flow`'s pre-claim blocker-landing stop (`ISSUE #{n}: failed:blocker-landing`)
    is not a failure this mode judges — Settle skips this mode for it (`dispatch/settle-and-merge.md`'s
    Blocker-landing special case). If one reaches this mode anyway, classify it `transient`: no build
    or test ran, so no diff is at fault, and the stop clears once the blocker lands.
  ```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/settle-blocker-landing-stop-conformance.test.js tests/assess-agent-autonomy-transport-pin.test.js tests/github-rate-limit-conformance.test.js tests/component-return-to-caller-conformance.test.js tests/bin-lib/skill-audit/anti-patterns.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

  ```bash
  git -C "/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude/worktrees/dispatch-record-4792" add plugin/skills/assess-agent-autonomy/failure-check.md tests/settle-blocker-landing-stop-conformance.test.js
  git -C "/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude/worktrees/dispatch-record-4792" commit -m "Teach failure-check the blocker-landing stop — transient, never judged by Settle, refs #4792" -m "Claude-Session: https://claude.ai/code/session_01UwjosG5JjuyaA68VwC69Gs"
  ```

### Task 4: Let preflight-records.js take already-fetched records over gh (`--prefetched-json`) and name a candidate missing from the native response

**Role:** integration

**Files:**
- Modify: `plugin/bin/preflight-records.js` (`parseArgs`, `USAGE`, header comment, `loadFromGh`, `realDeps`; the native call's runner wrapper)
- Modify: `plugin/bin/lib/preflight-records/preflight-records.js` (`issuesFromRecordsJson` gains a trailing `flag = '--records-json'` parameter used in every error message)
- Modify: `plugin/bin/lib/preflight-records/blocker-landing.js` (`notFoundOnlyRepository` and `recoveredResponse` take alias names instead of blocker numbers; `recoveredResponse` is exported)
- Modify: `docs/plugin-structure.md` (line starting `node plugin/bin/preflight-records.js <n>`)
- Test: `tests/bin-lib/preflight-records/preflight-records.test.js` (append)

**Interfaces:**
- Produces: `node bin/preflight-records.js <n> [<n> ...] … --prefetched-json <path|-> …`. The file, or stdin when the value is `-` (read through a new `deps.readStdin()`; `realDeps.readStdin = () => fs.readFileSync(0, 'utf8')`), holds the requested records as the caller already fetched them over `gh`, in the `--records-json` shape (`{number, title, body, labels}`, validated by `issuesFromRecordsJson(raw, numbers, '--prefetched-json')`). Repo resolution, the origin-host gate, `work-links: native`'s dependency GraphQL call, and `--blocker-landing`'s query all run exactly as on the plain `gh` path. Only `fetchIssues` is skipped. Exit codes: every `--prefetched-json` input problem (unreadable, not JSON, wrong shape, a requested number missing, duplicated or extra) is exit 2, the same as `--records-json`'s. `--prefetched-json` together with `--records-json` is exit 2 (mutually exclusive). `--blocker-states-json` still requires `--records-json`. Task 5 consumes this.
- Implementation shape: extract `loadFromRecordsJson`'s read-parse-validate lines into one helper, `readRecordsInput(value, flag, numbers, deps)` → `{ ok: Map }` | `{ code: 2 }`, which reads `deps.readStdin()` for `-` and `deps.readFile(value)` otherwise. Call it from both paths, so the two flags cannot drift.
- Return-shape widening check: none (`issuesFromRecordsJson`'s return is unchanged; the new parameter defaults to today's literal, so every existing message test still passes). Its only caller is `plugin/bin/preflight-records.js:237` (`git grep -n issuesFromRecordsJson -- plugin tests`: lib definition, lib export, that call).
- **Native-missing naming (Q4, consumed by Task 5).** `blocker-landing.js`'s module-private `notFoundOnlyRepository(parsed, blockers)` and `recoveredResponse(err, blockers)` (lines 169-187) become `notFoundOnlyRepository(parsed, aliases)` and `recoveredResponse(err, aliases)`, where `aliases: string[]` holds the alias names. `queryRepository` passes `blockers.map((n) => \`b${n}\`)`, so its behavior is unchanged, and `recoveredResponse` joins the module's exports. In `plugin/bin/preflight-records.js`, add `nativeRecoveringRunner(runner, numbers)` → `(args) => string`. It calls `runner(args)`. On a throw, when `recoveredResponse(err, numbers.map((n) => \`i${n}\`))` is non-null, it returns `String(err.stdout)`; otherwise it rethrows `err` unchanged. `loadFromGh` passes it as the `runner` of its `preflight.fetchNativeDependencies` call only. `fetchIssues` and the landing call keep `deps.runner`. Effect: `gh api graphql` exits 1 on a NOT_FOUND alias but prints the partial data (live probe, 2026-11-03: `{"data":{"repository":{"i4792":{…},"i99999999":null}},"errors":[{"type":"NOT_FOUND","path":["repository","i99999999"],…,"message":"Could not resolve to an Issue with the number of 99999999."}]}` on stdout, exit 1). That response now reaches `fetchNativeDependencies`, which throws its own `missing dependency data for #99999999 (GraphQL: Could not resolve to an Issue with the number of 99999999.)`. The exit code stays 1, as before; only the stderr line changes from the raw exec error to the named one. Any other thrown error (non-NOT_FOUND errors, no stdout, unparseable stdout, an alias outside the request) is rethrown, so its message is unchanged. No import cycle: `plugin/bin/preflight-records.js` already imports `blocker-landing.js` (line 61); the lib `preflight-records.js` does not.

- [ ] **Step 1: Write the failing tests** — append to `tests/bin-lib/preflight-records/preflight-records.test.js`, reusing its `cliDeps`, `landingFixture`, `closedBlocker`, `isIssueView`, `isGraphQL`, `isCompare`, `issue`, `specBody`, `noGh`. Give `cliDeps` an optional `stdin` that it serves through `readStdin`.
  - `test('AC3.1: --prefetched-json - reads the records from stdin and makes no gh issue view call; the envelope equals the gh-fetched one')` — run `['10', '11']` through the plain gh path (landingFixture runner) and `['10', '11', '--prefetched-json', '-']` with `stdin` = the same two issues as JSON. The second makes zero `isIssueView` calls, and both print byte-identical stdout.
  - `test('AC3.1: --prefetched-json with --blocker-landing still judges landing over gh')` — `['10', '11', '--prefetched-json', '-', '--blocker-landing', '--integration-branch', 'dev']`, repository `{ b5: closedBlocker('eee555') }`, statuses `{ eee555: 'diverged\n' }`. `records['11'].blockerLanding` deep-equals `[{ blocker: 5, verdict: 'unlanded', commit: 'eee555', via: 'closer-pr' }]`, with exactly one GraphQL and one compare call (`compare/dev...eee555`), and zero issue views.
  - `test('--prefetched-json <path> reads the named file')` — `files: { '/p.json': … }`, the same envelope as the stdin case.
  - `test('--prefetched-json under work-links: native still makes the native dependency call')` — `workLinks: 'native'`, `--repo acme/w`; one native GraphQL call is recorded (the `isGraphQL` shape whose query is not `CLOSED_EVENT`), no issue view, and `envelope.workLinks === 'native'` with no `nativeLinksUnchecked` key.
  - `test('--prefetched-json input problems are exit 2, naming the flag')` — a table over: unreadable path; not JSON; not an array; a requested number missing; an extra number. Each exits 2, prints no stdout, and its stderr matches `/--prefetched-json/` with no `--records-json` in the line.
  - `test('--prefetched-json and --records-json together are a malformed invocation')` — exit 2, stderr names both flags, and the runner is never called.
  - `test('--prefetched-json with no value is a malformed invocation')` — `['10', '--prefetched-json']` and `['10', '--prefetched-json', '--waves']` exit 2.
  - `test('--help usage names --prefetched-json')` — usage matches `/\[--records-json <path>\] \[--prefetched-json <path>\]/`, while the existing `/\[--blocker-landing\] \[--blocker-states-json <path>\]/` pin still holds.
  - `test('issuesFromRecordsJson keeps its --records-json messages by default and names the given flag')` — `issuesFromRecordsJson({}, [1]).error === '--records-json must be a JSON array'` and `issuesFromRecordsJson({}, [1], '--prefetched-json').error === '--prefetched-json must be a JSON array'`.
  - `test('AC4.3: native mode names a candidate gh reported NOT_FOUND (exit 1 with partial data) as missing dependency data (#4792)')` — under `workLinks: 'native'`, run `['720', '721']`. The runner serves both issue views. On the native GraphQL call it throws an `Error('Command failed: gh api graphql …')` whose `stdout` is `JSON.stringify({ data: { repository: { i720: { number: 720, blockedBy: { nodes: [] } }, i721: null } }, errors: [{ type: 'NOT_FOUND', path: ['repository', 'i721'], message: 'Could not resolve to an Issue with the number of 721.' }] })`, the shape the 2026-11-03 probe printed. Expect exit 1, no stdout, and stderr matching `/^preflight-records\.js: missing dependency data for #721 \(GraphQL: Could not resolve to an Issue with the number of 721\.\)$/m`. Control: comment out the wrapper (pass `deps.runner` straight through). The same test then fails on the `missing dependency data` match, because the stderr carries the raw `Command failed` text.
  - `test('a native-call throw that is not NOT_FOUND-only is rethrown unchanged')` — a table of three throws, each still exit 1 with stderr containing the original message and no `missing dependency data`: an error with no `stdout`; `stdout` JSON whose error is `{ type: 'FORBIDDEN', path: ['repository', 'i721'] }`; and a NOT_FOUND naming `i999`, an alias outside the request.
  - `test('blocker-landing NOT_FOUND recovery still reads a b{n} alias undetermined/not-found')` — the existing landing tests stay green unedited (they cover `queryRepository`'s recovery). This test adds `recoveredResponse` direct checks: it returns the parsed object for a NOT_FOUND on `['b5']` given aliases `['b5']`, and `null` for the same error given aliases `['i5']`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/bin-lib/preflight-records/preflight-records.test.js`
Expected: FAIL — the `--prefetched-json` CLI tests exit 2 with `unknown argument: --prefetched-json`, the usage test fails, the `issuesFromRecordsJson` flag test fails on the second assertion, the AC4.3 test fails its `missing dependency data` match, and the `recoveredResponse` test fails (not exported); the rethrow table and every pre-existing test still pass.

- [ ] **Step 3: Implement** — per the Interfaces block. Header comment: add a paragraph after the `--records-json` one, stating the flag, the stdin form, that only `fetchIssues` is skipped, the exit-2 input rule, and mutual exclusion. Add one sentence to the Exit-codes paragraph: under native, a candidate `gh` reports NOT_FOUND is named as `missing dependency data for #n` (still exit 1), the line `bin/dispatch-unlanded-blockers.js` reads (#4792). `blocker-landing.js`'s header paragraph on the NOT_FOUND-only recovery gains: "`recoveredResponse` is exported for `bin/preflight-records.js`'s native call, which recovers `i{n}` aliases the same way (#4792)." `USAGE` (and the header's usage line): insert ` [--prefetched-json <path>]` directly after `[--records-json <path>]`. In `docs/plugin-structure.md`'s `node plugin/bin/preflight-records.js` line, insert the same token after `[--records-json <path>]` in the synopsis, and insert, directly before that line's final clause `; under --records-json, --blocker-states-json supplies the MCP-fetched blocker states`: `; --prefetched-json <path|-> (#4792) reads records the caller already fetched over gh (\`-\` = stdin) and skips only the per-record fetch — native dependencies and blocker landing still query gh; its input problems are exit 2, and it is mutually exclusive with --records-json; under native, a candidate gh reports NOT_FOUND exits 1 as \`missing dependency data for #n\` (#4792)`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/bin-lib/preflight-records/preflight-records.test.js tests/bin-lib/preflight-records/blocker-landing.test.js tests/gh-host-seam-behavior.test.js tests/gh-host-seam-conformance.test.js tests/multispec-preflight-failure-conformance.test.js tests/flow-blocker-landing-conformance.test.js tests/path-guard-conformance.test.js tests/bin-lib/exit-code-conformance.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

  ```bash
  git -C "/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude/worktrees/dispatch-record-4792" add plugin/bin/preflight-records.js plugin/bin/lib/preflight-records/preflight-records.js plugin/bin/lib/preflight-records/blocker-landing.js docs/plugin-structure.md tests/bin-lib/preflight-records/preflight-records.test.js
  git -C "/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude/worktrees/dispatch-record-4792" commit -m "Add --prefetched-json to preflight-records — judge already-fetched records over gh without a per-record fetch, and name a NOT_FOUND native candidate, refs #4792" -m "Claude-Session: https://claude.ai/code/session_01UwjosG5JjuyaA68VwC69Gs"
  ```

### Task 5: The unlanded-blocker and malformed-blocker exclusion CLI

**Role:** integration
**Review risk:** high

**Files:**
- Create: `plugin/bin/lib/dispatch/unlanded-blockers.js`
- Create: `plugin/bin/dispatch-unlanded-blockers.js`
- Create: `tests/bin-lib/dispatch/unlanded-blockers.test.js`
- Modify: `docs/plugin-structure.md` (new CLI line directly after the line starting `node plugin/bin/dispatch-resume.js`, line 227 at `6c430595d`; append to the end of the `plugin/bin/lib/dispatch/` entry, the line starting `plugin/bin/lib/dispatch/          →` (line 68), after its last `)`. That line ends with `stuck-open-pr.js (#4849 — … Consumed by plugin/bin/stuck-open-prs.js)`, so "before its closing `)`" would land inside `stuck-open-pr.js`'s parenthetical.)

**Interfaces:**
- Consumes: Task 4's `--prefetched-json` and its native-missing stderr line, `preflight-records.js: missing dependency data for #a, #b` optionally followed by ` (GraphQL: …)`.
- `plugin/bin/lib/dispatch/unlanded-blockers.js` (pure, no I/O) exports:
  - `UNLANDED_REASON = 'unlanded-blocker'`, `MALFORMED_REASON = 'malformed-blocker'`, `GRAPHQL_INT_MAX = 2147483647`, `NATIVE_MISSING_CAUSE = 'the native dependency response has no entry for it'`.
  - `poolRecords(groups)` — `groups.flat()` projected to `{number, title, body, labels}`, deduped by number, ascending. This is the `--prefetched-json` shape.
  - `malformedRecords(pool, workLinks)` — `[{ number, cause }]` in pool order, one entry per record whose blocker declaration cannot be checked (Global Constraints' Q3 + Q4 bullet). The first failing check wins, in this order, with these exact causes:
    1. `!(Number.isInteger(r.number) && r.number > 0)` → `'its number is not a positive integer'`
    2. `typeof r.body !== 'string'` → `'its body is not a string'`
    3. `r.labels != null && !Array.isArray(r.labels)` → `'its labels are not an array'`
    4. only when `workLinks !== 'native'`: `invalid = parseDependencies(r.body).filter((n) => !(Number.isInteger(n) && n > 0 && n <= GRAPHQL_INT_MAX))`, non-empty → `` `a Blocked by line names no valid issue number (#${invalid.join(', #')})` ``
    Import `parseDependencies` from `../issues/record-dependencies` (never re-implement `DEP_RE`).
  - `nativeMissingRecords(stderr, numbers)` → `number[] | null`. Split `String(stderr)` on `'\n'`, strip one trailing `'\r'` per line, and match each line against `NATIVE_MISSING_LINE = /^preflight-records\.js: missing dependency data for (#\d+(?:, #\d+)*)(?: \(GraphQL: |$)/` (no `g`, no `m`). Collect every number from every matching line. Return `null` when no line matches or any collected number is not in `numbers`, else the deduped numbers ascending. `null` means "this exit cannot be pinned on records"; there is no empty-array return.
  - `malformedExclusion({ number, cause })` → `{ reason: MALFORMED_REASON, records: [number], detail: { cause } }`.
  - `landingExclusions(envelope, numbers)` — `{ exclusions, undetermined }`. There is one `{ reason: UNLANDED_REASON, records: [n], detail: { blockers: [{ blocker, commit }] } }` per requested record with at least one `unlanded` verdict, its blockers in `blockerLanding` order. `undetermined` is `[{ record, blocker, via }]` for every `undetermined` verdict. `open`, `landed` and `not-applicable` contribute nothing. It throws a `TypeError` naming the record when `envelope.records[String(n)].blockerLanding` is not an array.
  - `withoutExcluded(groups, numbers)` — `groups` with every member whose number is in the `Set` removed, and empty groups dropped (a fast-lane bundle keeps its other members, as the other removing passes do).
- `plugin/bin/dispatch-unlanded-blockers.js`: `usage: dispatch-unlanded-blockers.js --groups <path> --exclusions <path> --integration-branch <name> --work-links <native|body-text>`. It exports `run(argv, deps)`, `parseArgs` and `realDeps`, and its guard is `if (require.main === module) process.exitCode = run(process.argv.slice(2), realDeps);`. `parseArgs(argv)` returns `{ groups, exclusions, integrationBranch, workLinks }` (all strings) or `{ error }`. All four flags are required. `--groups` and `--exclusions` need a non-empty value. `--integration-branch` and `--work-links` take any value including `''` (an unresolved queue-pull variable), but a flag at the end of argv, or one followed by an argument starting with `--`, has no value. `--work-links` must be `native`, `body-text` or `''`. Any other argument is unknown. `deps`: `readFile(path)`, `preflight(args, input) → { status, stdout, stderr, error }`, `stdout(s)`, `stderr(s)`. `realDeps.preflight` is `spawnSync(process.execPath, [PREFLIGHT_JS, ...args], { input, encoding: 'utf8', timeout: PREFLIGHT_TIMEOUT_MS, maxBuffer: LARGE_MAX_BUFFER_BYTES, windowsHide: true })`, with `PREFLIGHT_JS = path.join(__dirname, 'preflight-records.js')`, `PREFLIGHT_TIMEOUT_MS = 300000` (a stated bound; each `gh` call inside is already bounded at 30 s by `GH_CALL_TIMEOUT_MS`) and `LARGE_MAX_BUFFER_BYTES` from `lib/shared-primitives.js`. Exclusions are written through `bin/lib/dispatch/exclusions.js`'s `appendExclusion` (the one sanctioned writer of `dispatch-exclusions.json`).
- `run` order and exit codes (documented in the header and `USAGE`):
  1. Malformed invocation (a missing flag, a flag with no value, a bad `--work-links` value, an unknown argument) → usage on stderr, **exit 2**.
  2. `--groups` unreadable, not JSON, or not an array of arrays → `dispatch-unlanded-blockers.js: cannot read --groups {path}: {reason}`, **exit 1**.
  3. Empty pool → print the groups unchanged, exit 0, no `preflight` call, no exclusions write.
  4. **Screen (Q3 + Q4).** `malformed = malformedRecords(pool, workLinks)`, and `checked` = the pool without those records. The screen runs before every skip below, so a screened record is excluded even when the landing call never runs.
  5. `--integration-branch` value empty or whitespace (the queue pull's `$INTEGRATION_BRANCH` failed to resolve) → `Warning: unlanded-blocker pass skipped — no integration branch resolved; no unlanded-blocker exclusions this pull`, no `preflight` call; go to step 9.
  6. Empty `checked` → no `preflight` call; go to step 9.
  7. Call `deps.preflight([...checked numbers as strings, '--prefetched-json', '-', '--blocker-landing', '--integration-branch', branch, ...(workLinks ? ['--work-links', workLinks] : [])], JSON.stringify(checked))`. Forward the child's stderr to ours unchanged, so its compare-failure causes are never lost. **Native-missing re-run:** when `status === 1` and `nativeMissingRecords(stderr, checkedNumbers)` is non-null, append `{ number, cause: NATIVE_MISSING_CAUSE }` to `malformed` for each named number and remove them from `checked`. If any remain, call `deps.preflight` exactly once more over them, built the same way, and forward its stderr. That second call decides steps 8-9; there is never a third. If none remain, go to step 9.
  8. Whole-call failure of the deciding call → no `unlanded-blocker` entries, groups printed without the `malformed-blocker` records only, exit 0. The cases: a non-zero or null `status`, or a thrown `preflight` dep → `Warning: unlanded-blocker pass skipped — preflight-records.js exited {status|signal|error}; no unlanded-blocker exclusions this pull`. Stdout that is not JSON, or `landingExclusions(envelope, checkedNumbers)` throwing → `Warning: unlanded-blocker pass skipped — preflight-records.js printed no usable envelope ({reason}); no unlanded-blocker exclusions this pull`.
  9. Write: `appendExclusion(exclusionsPath, malformedExclusion(m))` per `malformed` entry (screened records in pool order, then native-missing ones ascending), then `appendExclusion(exclusionsPath, e)` per `unlanded-blocker` exclusion. A throw (`appendExclusion: … unreadable`) → `dispatch-unlanded-blockers.js: {message}` and **exit 1**, with nothing printed on stdout. Print on stderr, per malformed entry, `AUTO — dispatch: #{n} excluded — malformed blocker declaration: {cause}; the other candidates are still checked`, and per unlanded exclusion, `AUTO — dispatch: #{n} excluded, blocker #{b} closed but its closing commit {commit} is not on origin/{branch}`.
  10. Per undetermined verdict: `AUTO — dispatch: #{n} kept — blocker #{b} landing undetermined (via {via})` on stderr.
  11. Print `JSON.stringify(withoutExcluded(groups, new Set([...malformed numbers, ...unlanded numbers])))` on stdout as one write, exit 0.
- Consumer classification (Consumer-enumeration check) of the new `reason: 'unlanded-blocker'` and `reason: 'malformed-blocker'` entries. The `#N`/`#N,#M` bullets and `exclusions-unreadable-report.md` are list-all readers by reason name; Task 6 names both reasons. `blocked-exclusion-report.md` is a list-all renderer; Task 7 adds a line for each. `next-ranking.md` and `firing-exclusion.md` filter by their own reason lists (`oversized`, `neighbour-in-flight`, `firing`), so they never see these reasons. Excluded records are already out of `dispatch-groups.json`, so those two need no change. `queue-pull-script.md`'s queue-order write-back (`reason === 'blocked'` only) and its truncate step (keeps `firing` only) run before this pass or ignore it, so they need no change either.
- Inserted-guard re-proof check: steps 4 and 7's re-run are new preconditions ahead of step 8. Every fail-open fixture below uses well-formed records under `body-text`, whose stub or world never prints a `missing dependency data` line, so neither precondition fires. Steps 5 and 8 still decide those tests. Each of them is re-proved by deleting its own branch, not the screen (see the Guard-branch bullet).

- [ ] **Step 1: Write the failing tests** — create `tests/bin-lib/dispatch/unlanded-blockers.test.js`. Its fixture world copies `preflight-records.test.js`'s `landingFixture` shape locally (never import from another test file). It holds records `10` (no edges) and `11` (body `Blocked by #5`), a GraphQL repository `{ b5: closedBlocker(sha) }`, a compare map, and a runner that throws `'unexpected ' + args.join(' ')` on anything else, including any `issue view`. A world built with `native: { … }` also answers the native dependency query (an `api graphql` call whose query contains `blockedBy(first:25)`). It reads the requested `i{n}` aliases from the query text and serves each from that map; a `missing` option either omits an alias (gh exit 0) or throws an `Error` whose `stdout` carries the partial data plus a NOT_FOUND on that alias (gh exit 1, the 2026-11-03 probe's shape). **Real writer:** `realPreflight(world)` returns a `deps.preflight` that calls `require('../../../plugin/bin/preflight-records').run(args, { runner: world.runner, resolveWorkLinks: () => 'body-text', remoteUrl: () => 'https://github.com/acme/w.git', readFile: () => { throw new Error('no file reads'); }, readStdin: () => input, stdout, stderr })`. It records `{ args, input }` in a `calls` array and returns `{ status, stdout, stderr }`, so every envelope and every stderr line the CLI reads comes from the real `preflight-records.js` code. `positionals(args)` = the args before `'--prefetched-json'`. Files (groups, exclusions) live in a `fs.mkdtempSync` scratch dir removed in `t.after`. Unless a test says otherwise, argv is `--groups G --exclusions E --integration-branch dev --work-links body-text`.
  - `test('AC3.1: a pool with an unlanded out-of-run blocker excludes that record as unlanded-blocker, and includes it once the blocker lands (#4792)')` — groups `[[#10], [#11]]`. Run 1: compare `{ sha1: 'diverged\n' }` → exit 0, stdout groups `[[#10]]`, and the exclusions file deep-equals `[{ reason: 'unlanded-blocker', records: [11], detail: { blockers: [{ blocker: 5, commit: 'sha1' }] } }]`. The recorded argv contains `'--prefetched-json', '-'`, `'--blocker-landing'`, `'--integration-branch', 'dev'` and `'--work-links', 'body-text'`, and the world records zero `issue view` calls. Run 2 (fresh exclusions file, same pool, compare `{ sha1: 'behind\n' }`) → stdout groups contain `#11`, and the exclusions file is absent or holds no `unlanded-blocker` entry.
  - `test('AC4.1 AC4.2 AC4.3: a Blocked by #0 record is excluded as malformed-blocker, the unlanded-blocker record is still excluded, and a clean record is kept, through the real preflight-records run (#4792)')` — groups `[[#10], [#11], [#13]]`, `#13` body `'Blocked by #0\n'`, compare `{ sha1: 'diverged\n' }` → exit 0. Stdout groups are `[[#10]]`. The exclusions file deep-equals `[{ reason: 'malformed-blocker', records: [13], detail: { cause: 'a Blocked by line names no valid issue number (#0)' } }, { reason: 'unlanded-blocker', records: [11], detail: { blockers: [{ blocker: 5, commit: 'sha1' }] } }]`. Stderr matches `/AUTO — dispatch: #13 excluded — malformed blocker declaration: a Blocked by line names no valid issue number \(#0\); the other candidates are still checked/` and does not match `/unlanded-blocker pass skipped —/` (no whole-pass skip). `calls.length === 1`, `positionals(calls[0].args)` deep-equals `['10', '11']`, and `JSON.parse(calls[0].input).map((r) => r.number)` deep-equals `[10, 11]`.
  - `test('AC4.2: unscreened, the same pool makes the real preflight-records run exit 2 — the screen is what keeps the check alive')` — call `realPreflight(world)(['10', '11', '13', '--prefetched-json', '-', '--blocker-landing', '--integration-branch', 'dev', '--work-links', 'body-text'], JSON.stringify(poolRecords(groups)))` directly → `status === 2`, stderr matches `/not a valid issue number: 0/`. With this test green, deleting step 4 (or check 4 of `malformedRecords`) turns the AC4.1 test red: the whole call exits 2, step 8 keeps `#11`, and the whole-pass warning prints.
  - `test('AC4.3: each screened fault, unscreened, fails the whole call or reads undetermined; through the CLI it is a malformed-blocker exclusion and the rest are still checked')` — a table of five bad records, each paired with `#10` (clean) and `#11` (unlanded):
    - `{ number: 1.5, body: '', labels: [] }`
    - `{ number: 13, body: null, labels: [] }`
    - `{ number: 13, body: '', labels: 'x' }`
    - `{ number: 13, body: 'Blocked by #0\n', labels: [] }`
    - `{ number: 13, body: 'Blocked by #3000000000\n', labels: [] }`

    Unscreened (the real `run`, numbers and input as above), the first four exit 2. For the fifth, the world's landing runner answers a query naming `b3000000000` the way github.com did on 2026-11-03: it throws an `Error` whose `stdout` is `{"data":{"repository":{"b5":…,"b3000000000":null}},"errors":[{"type":"NOT_FOUND","path":["repository","b3000000000"],"message":"Could not resolve to an Issue with the number of 3000000000."}]}`. The run exits 0, and `records['13'].blockerLanding` deep-equals `[{ blocker: 3000000000, verdict: 'undetermined', commit: null, via: 'not-found' }]`: kept and dispatchable. Through the CLI, every row behaves the same way. The bad record is in one `malformed-blocker` entry with that row's exact cause, and absent from stdout's groups. `#11` is still excluded as `unlanded-blocker`, `#10` is kept, and the call's positionals are `['10', '11']`. Deleting any one check in `malformedRecords` turns only its row red (Guard-branch discrimination); lowering `GRAPHQL_INT_MAX`'s comparison to `Number.isSafeInteger` turns only the fifth row red.
  - `test('AC4.3: a candidate missing from the native dependency response is excluded as malformed-blocker and the call re-run once without it, through the real run')` — argv `--work-links native`, a native world `{ i10: no edges, i11: blockedBy [{ number: 5, state: 'CLOSED' }] }`, groups `[[#10], [#11], [#13]]`, compare `{ sha1: 'diverged\n' }`. Two rows: `#13` omitted from the response (gh exit 0), and `#13` NOT_FOUND with partial data on a thrown error (gh exit 1; this row needs Task 4's wrapper). Each row: exit 0, `calls.length === 2`, `positionals(calls[0].args)` `['10', '11', '13']`, `positionals(calls[1].args)` `['10', '11']`, the exclusions file deep-equals `[{ reason: 'malformed-blocker', records: [13], detail: { cause: 'the native dependency response has no entry for it' } }, { reason: 'unlanded-blocker', records: [11], detail: { blockers: [{ blocker: 5, commit: 'sha1' }] } }]`, stdout groups `[[#10]]`, and stderr carries both the forwarded `preflight-records.js: missing dependency data for #13` line and the `#13` AUTO line.
  - `test('native-missing never loops and never blames a record it cannot attribute')` — three rows, each through the real run under `native`, groups `[[#10], [#11], [#13]]`:
    - The response has no `data.repository`, so the forwarded line is `missing repository — no dependency data for …`. Result: one call, the whole-pass `exited 1` warning, no exclusions entry, and stdout groups equal to the input.
    - `#13` is missing on the first call and `#11` is missing on the re-run. Result: exactly two calls. The `#13` `malformed-blocker` entry stands. The `exited 1` warning prints and there is no `unlanded-blocker` entry. Stdout groups are `[[#10], [#11]]`.
    - A stub `preflight` returns `{ status: 1, stderr: 'preflight-records.js: missing dependency data for #99\n' }`, and `#99` is not a candidate. Result: one call, the whole-pass warning, and no `malformed-blocker` entry.
  - `test('nativeMissingRecords recognises only the writer\'s whole line')` — pure, with `numbers = [13, 14]`:
    - `'preflight-records.js: missing dependency data for #13\n'` → `[13]`.
    - The same line ending ` (GraphQL: Could not resolve to an Issue with the number of 13.)` → `[13]`.
    - `'… for #14, #13'` → `[13, 14]`.
    - A CRLF line → `[13]`.
    - Each of these → `null`: a tail-carrying `'… for #13 trailing'`, a truncated `'… for #13, #'`, `'preflight-records.js: missing repository — no dependency data for #13'`, `'… for #99'`, the prefix after other text on the same line (`'x preflight-records.js: missing dependency data for #13'`), and `''`.
  - `test('a record blocked by a screened-out record reads that blocker open and is kept')` — groups `[[#13], [#14]]`, `#13` body `'Blocked by #0\n'`, `#14` body `'Blocked by #13\n'`, repository `{ b13: { state: 'OPEN', … } }` (the open-blocker node shape of the open test below) → exit 0. Stdout is `[[#14]]`; the exclusions file holds only `#13`'s `malformed-blocker` entry; there is one call with `positionals` `['14']`.
  - `test('an all-malformed pool makes no preflight call and still excludes')` — groups `[[#13]]` (`Blocked by #0`) → stdout `[]`, the `#13` `malformed-blocker` entry and AUTO line, and the `preflight` dep (throwing `'must not be called'`) never called.
  - `test('malformedRecords: each cause, in order; native reads no body blockers; the 32-bit bound')` — pure:
    - One record per cause returns exactly that cause, and a record failing checks 2 and 4 returns only check 2's.
    - `[{ number: 13, body: 'Blocked by #0', labels: [] }]` returns `[]` under `'native'` and one entry under `'body-text'` and under `''`.
    - Under `'body-text'`, `Blocked by #2147483647` is not flagged, while `#2147483648`, `#3000000000` and `#99999999999999999999` are each flagged.
    - `{ labels: null }` and an absent `labels` are not flagged.
  - `test('--work-links is forwarded; native leaves a body Blocked by #0 to the call, an empty value screens it')` — uses a recording stub `preflight` that returns a valid empty-landing envelope, with pool `[[#11], [#13]]` and `#13` body `'Blocked by #0\n'`. Under `--work-links native`, the call's args end with `'--work-links', 'native'`, `13` is among its positionals, and no `malformed-blocker` entry is written. Under `--work-links ''`, the call's args contain no `'--work-links'`, and `#13` gets its `malformed-blocker` entry and is absent from stdout. (Empty-value probe: the queue pull passes `"$WORK_LINKS"`.)
  - `test('AC3.1: an undetermined verdict keeps the candidate and logs one AUTO line')` — the compare throws (preflight: `undetermined`/`probe-failed`) → `#11` kept, no entry, stderr matches `/AUTO — dispatch: #11 kept — blocker #5 landing undetermined \(via probe-failed\)/`.
  - `test('an open blocker is left to the blocked pass')` — `b5` `state: 'OPEN'` → `#11` kept, no `unlanded-blocker` entry.
  - `test('a bundle keeps its other members; an all-excluded group disappears')` — groups `[[#10, #11], [#12]]`, where `#12` is also blocked by `#5` (unlanded) → stdout `[[#10]]`, with two entries in pool order.
  - `test('fail open: a whole-call failure (non-zero preflight exit) excludes no unlanded-blocker record')` — the stub `preflight` returns `{ status: 1, stdout: '', stderr: 'preflight-records.js: blocker landing query failed: x\n' }`. Pool: well-formed records only → exit 0, stdout byte-equal to the input groups' `JSON.stringify`, stderr carries both the forwarded line and `Warning: unlanded-blocker pass skipped — preflight-records.js exited 1`, and no exclusions file is created.
  - `test('a whole-call failure keeps the malformed-blocker exclusions already found')` — the same stub, pool `[[#11], [#13]]` with `#13` body `'Blocked by #0\n'` → stdout `[[#11]]`, and the exclusions file holds only `#13`'s `malformed-blocker` entry.
  - `test('fail open: unparseable or envelope-less output excludes nothing')` — stdout `'not json'`, then `'{"records":{}}'` → exit 0, groups unchanged, `printed no usable envelope`.
  - `test('fail open: an empty integration branch skips the landing call but still excludes a malformed record')` — `--integration-branch ''`. Pool `[[#11]]`: exit 0, unchanged, the `no integration branch resolved` warning, and the `preflight` dep never called. Pool `[[#11], [#13]]` with `#13` body `'Blocked by #0\n'`: stdout `[[#11]]` and `#13`'s `malformed-blocker` entry, still with no `preflight` call. This is the Empty-value probe: the queue pull passes `"$INTEGRATION_BRANCH"`, which is `''` when both resolution rungs fail.
  - `test('an empty pool makes no preflight call')` — groups `[]` → stdout `[]`, exit 0.
  - `test('a corrupt exclusions file stops the pass (exit 1)')` — exclusions file containing `{ not json`, an unlanded world → exit 1, stderr matches `/appendExclusion:/`, stdout empty. A second row uses a malformed-only pool (no `preflight` call) and gets the same exit 1: the malformed write goes through the same writer.
  - `test('an unreadable --groups is exit 1; a malformed invocation is exit 2')` — a missing groups path → 1; `[]` argv, `--groups` with no value, `--work-links bogus`, a missing `--work-links`, and `--bogus` → 2 with usage.
  - `test('parseArgs returns the four values')` — `parseArgs(['--groups', 'g', '--exclusions', 'e', '--integration-branch', 'main', '--work-links', 'native'])` deep-equals `{ groups: 'g', exclusions: 'e', integrationBranch: 'main', workLinks: 'native' }`, and `parseArgs([... '--work-links', ''])` keeps `workLinks: ''`.
  - Guard-branch discrimination: each fail-open test above uses an input that only its own branch decides. Deleting branch 4, 5, 7's re-run, or 8 turns its test red:
    - branch 4: the AC4.1 and per-fault tests, through the real `run`;
    - branch 5: the `preflight` dep throws `'must not be called'`;
    - 7's re-run: the two-call native-missing test, whose single call would exit 1;
    - branch 8: no exclusions file and unchanged stdout, which an unguarded parse of `''` would turn into a crash; and a missing `blockerLanding` would throw out of `run`.
  - `test('realDeps.preflight returns the real child failure shape')` — `realDeps.preflight(['--bogus'], '')` spawns the real `preflight-records.js` (no `gh` reached: `parseArgs` rejects first) and returns `status === 2` with stderr matching `/unknown argument: --bogus/` (cli-wrapper-contract: one test of the real dependency's failure shape).
  - Pure-function tests: `poolRecords` dedupes and sorts across groups and projects exactly the four keys; `landingExclusions` throws a `TypeError` naming `#11` when its `blockerLanding` is missing; `withoutExcluded` leaves the input arrays unmutated; `malformedExclusion({ number: 13, cause: 'c' })` deep-equals `{ reason: 'malformed-blocker', records: [13], detail: { cause: 'c' } }`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/bin-lib/dispatch/unlanded-blockers.test.js`
Expected: FAIL — `Cannot find module '../../../plugin/bin/dispatch-unlanded-blockers'` (and `…/lib/dispatch/unlanded-blockers`).

- [ ] **Step 3: Implement** — the two modules per the Interfaces block. The CLI's header comment states:
  - its purpose (#4792) and the `run` order above;
  - the exit-code vocabulary: 0 = pool on stdout, filtered, or unchanged apart from `malformed-blocker` records on a fail-open skip; 1 = the pass could not complete; 2 = malformed invocation;
  - why a record whose blocker declaration cannot be checked is excluded rather than kept: one bad record never turns the check off for the pool (Q3), and it is not dispatched (Q4);
  - why the native-missing re-run happens once and only on the attributable line;
  - why the pass otherwise fails open: Step 2.7b re-checks before any claim.

  `NATIVE_MISSING_LINE`'s comment names its writer (`plugin/bin/lib/issues/native-dependencies.js`'s throw, printed by `plugin/bin/preflight-records.js`) and what keeps it linear: per line, anchored, no lazy group. No `fs.existsSync`/`fs.realpathSync` (path-guard scan); read files inside `try`. In `docs/plugin-structure.md`, insert after the `node plugin/bin/dispatch-resume.js` line:

  ```
  node plugin/bin/dispatch-unlanded-blockers.js --groups <path> --exclusions <path> --integration-branch <name> --work-links <native|body-text>   # Unlanded-blocker exclusion CLI (#4792) — `queue-pull-script.md`'s selection-time pass: hands every remaining candidate (already fetched) to one `preflight-records.js --prefetched-json - --blocker-landing` call, appends one `reason: 'unlanded-blocker'` entry (`detail: {blockers: [{blocker, commit}]}`) per candidate with an `unlanded` out-of-run blocker through `exclusions.js`'s `appendExclusion`, and prints the pool without them; a record whose blocker declaration cannot be checked (a non-integer number, a non-string body, non-array labels, or, unless `--work-links native`, a `Blocked by` number that is no valid issue number or is above 2147483647) is screened out of that call, and a candidate the call names as missing from the native dependency response is dropped and the call re-run once — each gets a `reason: 'malformed-blocker'` entry (`detail: {cause}`) and one `AUTO` line, so it is not dispatched and every other candidate is still checked; an `undetermined` verdict keeps the candidate, and a whole-call failure (a non-zero `preflight-records.js` exit it cannot pin on a record, an unusable envelope, or an empty integration branch) excludes no `unlanded-blocker` record, with one `Warning:` line; exit 0 pool printed, 1 unreadable `--groups` or a refused exclusions write, 2 malformed invocation (tests in `tests/bin-lib/dispatch/unlanded-blockers.test.js`)
  ```

  Append to the end of the `plugin/bin/lib/dispatch/` entry line (after its final `)`): `; unlanded-blockers.js (#4792 — the pure half of plugin/bin/dispatch-unlanded-blockers.js: poolRecords projects the candidate pool to preflight-records.js's --prefetched-json shape, malformedRecords and nativeMissingRecords name the records whose blocker declaration cannot be checked so the CLI excludes them as malformed-blocker (malformedExclusion) and keeps them out of that call, landingExclusions turns its --blocker-landing envelope into unlanded-blocker entries plus the undetermined verdicts it keeps, withoutExcluded drops excluded members and empty groups)`.

- [ ] **Step 4: Run tests to verify they pass, then probe real input**

Run: `node --test tests/bin-lib/dispatch/unlanded-blockers.test.js tests/bin-lib/dispatch/exclusions.test.js tests/bin-lib/preflight-records/preflight-records.test.js tests/bin-lib/preflight-records/blocker-landing.test.js tests/path-guard-conformance.test.js tests/windows-hide-spawn-conformance.test.js tests/bin-lib/exit-code-conformance.test.js tests/gh-host-seam-conformance.test.js tests/path-containment-conformance.test.js tests/package-json-test-script.test.js`
Expected: PASS.

  **Linearity probe** (regex-scan-linearity, scratch only): time `nativeMissingRecords` on `'preflight-records.js: missing dependency data for ' + '#1, '.repeat(50000) + 'x'` and on `'a'.repeat(200000)`. Each must return `null` in single-digit milliseconds; at authoring, the same regex took 0-1 ms on both in a scratch probe. Record the milliseconds in `decisions.md`'s AC-evidence line below.

  **Real-input probe** (read-only `gh`; writes only scratch files). Fetch real records whose bodies carry `Blocked by` lines, with `gh issue list --state open --search "\"Blocked by #\" in:body" --json number,title,body,labels --limit 15`, into a scratch file. Wrap them as per-record groups (`[[r1],[r2],…]`) with a scratchpad node script. Then run `node plugin/bin/dispatch-unlanded-blockers.js --groups {scratch-groups} --exclusions {scratch-exclusions} --integration-branch main --work-links native`. `main` and `native` are the derived values: `resolve-policy.js --values integration-branch` printed `''` here (and `git remote show origin` reports `HEAD branch: main`), and `resolve-policy.js --values work-links` printed `native` (both probed 2026-11-03). **Independent count:** run plain `node plugin/bin/preflight-records.js {same numbers} --blocker-landing --integration-branch main --work-links native` (the `gh issue view` path, not `--prefetched-json`), and count `verdict === 'unlanded'` records with a `node -e` over its envelope. Three checks must hold. The count must equal the CLI's `unlanded-blocker` entry count. The CLI must write no `malformed-blocker` entry: real open records are in the native response, and native reads no body line. The CLI's kept set must equal the input set minus the excluded records. At authoring (2026-11-03), the plain call over `4127 4499 4591 4624 4703 4929` printed `landed` for #4127's #4024, `open` for the rest's blockers, and `[]` for #4703/#4929: zero `unlanded`, so expect 0 = 0 unless the live state moved. Record both counts and the command in `decisions.md` per the AC-evidence persistence check: `log-decision.js --run "$PIPELINE_RUN_DIR" --section "/build" --status AUTO --step "AC evidence" --text-file "{text-file}"`, with the full output at `$PIPELINE_RUN_DIR/evidence/unlanded-blockers-real-input.txt` (`mkdir -p "$PIPELINE_RUN_DIR/evidence"` first, plain Bash redirect).

- [ ] **Step 5: Commit**

  ```bash
  git -C "/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude/worktrees/dispatch-record-4792" add plugin/bin/lib/dispatch/unlanded-blockers.js plugin/bin/dispatch-unlanded-blockers.js tests/bin-lib/dispatch/unlanded-blockers.test.js docs/plugin-structure.md
  git -C "/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude/worktrees/dispatch-record-4792" commit -m "Add the unlanded-blocker exclusion CLI — drop candidates whose out-of-run blocker never landed or whose blocker declaration cannot be checked, fail open otherwise, refs #4792" -m "Claude-Session: https://claude.ai/code/session_01UwjosG5JjuyaA68VwC69Gs"
  ```

### Task 6: Run the unlanded-blocker pass in dispatch's queue pull

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/skills/dispatch/queue-pull-script.md` (two new reason bullets after the line starting ``- `reason: 'shipped'` `` (line 11); three comment blocks cut to one line each (lines 301-318, 349-362, 408-416 at `6c430595d`); new pass block before the line `# #3278: neighbour-in-flight pass. Neighbour: a linking Key File or a strong` (line 617))
- Modify: `plugin/skills/dispatch/queue-pull-notes.md` (append one section at end of file)
- Modify: `plugin/skills/dispatch/SKILL.md` (Step 2's queue-definition text ending `+ not already shipped by a \`strong\`-tier merged-PR mention (#1984) + unclaimed**`, line 115; the `#N` bullet, line 192; the `#N[,#M,#O...]` bullet, line 194)
- Modify: `docs/journeys/learn-why-a-named-record-wont-dispatch-3084.md` (Success state, line 21; Step 1's Should understand, line 29; `files:`; Origin)
- Create: `tests/dispatch-unlanded-blocker-exclusion-fixture.test.js`

**Interfaces:**
- Consumes: Task 5's CLI (`dispatch-unlanded-blockers.js`, its `parseArgs` → `{ groups, exclusions, integrationBranch, workLinks }` | `{ error }`). The block passes `"$WORK_LINKS"`, set at `queue-pull-script.md:153`, well before this pass, and `"$INTEGRATION_BRANCH"`, set at line 423.
- Moved-prose pin check (comment blocks moved to `queue-pull-notes.md`). The distinctive phrases of each moved block were grepped across `tests plugin .claude/skills docs`: `#2786's evidence`, `No gh/network call`, `bypass -- the exclusion is computed once`, `independent of $WORK_LINKS`, `transient state the freshness signal`, `One batched aliased GraphQL call`, `unsatisfiable by construction`, `a dirty tree must not hide`. There were no hits outside `queue-pull-script.md`. The `Materialization hard gate`, `Named-location drift` and `fetchLinkedPRs)` hits are other files' own text, read by suites that never open `queue-pull-script.md`. The anchors suites use are kept byte-identical: `# #1224: open-linked-PR exclusion.` (`tests/dispatch-not-spec-shaped-exclusion-fixture.test.js` #3086, and `tests/dispatch-shipped-candidate-prose.test.js` uses `#1224: open-linked-PR exclusion`), the not-spec-shaped `START_ANCHOR` code line, and every `#1984` comment line (not moved: `tests/dispatch-shipped-candidate-prose.test.js` reads `#4314` and `opened before the record was created` from its first 2000 chars).
- Renumbering-completeness check (a sixth and a seventh removing reason). Three greps, all re-run at `6c430595d` with the same hits as at `03903e7a1`:
  1. The reason list: ``git grep -n -e "target-missing., .shipped." -e "target-missing./.shipped." -- plugin docs README.md .claude/skills ':!docs/superpowers/plans'``. It hits the journey's line 29 and `SKILL.md` lines 192/194, plus `queue-pull-script.md:8`'s `open-pr`/`target-missing`/`shipped` placement clause, which stays true. The journey's line 21 (`` `target-missing`, or `shipped` ``) is the same list in another form and is edited too.
  2. The count word: `git grep -n -i -e "five reasons" -e "five removing" -e "fifth removing" -- plugin docs tests ':!docs/superpowers/plans'`. Its only relevant hits are in the journey: line 29 is changed, and line 70 is history and stays. The other two hits, `docs/reconcile-checks.md:646` and `design-wrapper/impeccable-plugin.md:55`, count unrelated things.
  3. The derived count: `tests/dispatch-named-form-exclusion-reasons.test.js` derives `REMOVING_REASONS` from the bullets and requires the journey's count word to equal its length (`seven` after this task).

- [ ] **Step 1: Write the failing test** — create `tests/dispatch-unlanded-blocker-exclusion-fixture.test.js` (header: #4792, extract-and-run of the pass block plus the move pins). Use `readText` and `missingFactsOf`/`assertEachPatternGoesRed`/`lineStartingWith`/`sectionOf` from the shared helpers. `QUEUE_PULL` = `plugin/skills/dispatch/queue-pull-script.md`, `NOTES` = `plugin/skills/dispatch/queue-pull-notes.md`. Define a local `requireOrder(text, markers)` that asserts each index is not -1 (`marker missing: …`) before asserting the order (`… must come after …`). `PASS_ANCHOR = '# #4792: unlanded-blocker and malformed-blocker exclusions.'`.
  - `extractPassBlock(text)` — from `PASS_ANCHOR` to the first `\nfi` after it (inclusive). Assert start and end, with the messages `` `extraction start anchor not found: ${PASS_ANCHOR}` `` and `closing fi not found after the #4792 anchor`.
  - `runBlock(shell, { exit, out })` — scratch dir with `dispatch-groups.json` (`[[{"number":1}],[{"number":2}]]`), `dispatch-exclusions.json` (`[]`), and a stub plugin root holding `bin/dispatch-unlanded-blockers.js`. The stub writes `JSON.stringify(process.argv.slice(2))` to `process.env.STUB_ARGV`, writes `process.env.STUB_OUT` to stdout, and sets `process.exitCode = Number(process.env.STUB_EXIT)`. Spawn `[shell, [...flags, '-c', block]]` (`bash --noprofile --norc`, `zsh -f`) with env `CLAUDE_PLUGIN_ROOT` (the stub root, forward-slashed), `DISPATCH_GROUPS`, `DISPATCH_EXCLUSIONS`, `INTEGRATION_BRANCH=main`, `WORK_LINKS=body-text`, `STUB_*`. Return `{ status, stderr, groups, tmpLeft }`, where `tmpLeft` is whether `dispatch-groups.json.tmp` still exists.
  - `test('AC3.1: the pass block replaces dispatch-groups.json with the CLI\'s pool on exit 0, under bash and zsh')` — `STUB_EXIT=0`, `STUB_OUT='[[{"number":1}]]'` → status 0, groups `[[{number:1}]]`, `tmpLeft === false`. The recorded argv equals `['--groups', G, '--exclusions', E, '--integration-branch', 'main', '--work-links', 'body-text']`, and `require('../plugin/bin/dispatch-unlanded-blockers').parseArgs(argv)` returns no `error`. Skip zsh with `t.skip('zsh not on PATH')` when `spawnSync('zsh', ['-f', '-c', 'true']).error`.
  - `test('the pass block stops the queue pull on a non-zero CLI exit and leaves dispatch-groups.json untouched')` — `STUB_EXIT=1` → status 1, stderr matches `/queue-pull stopped -- unlanded-blocker exclusion pass failed/`, groups byte-equal to the input, `tmpLeft === false`.
  - `test('the pass sits after the shipped Close-proposal staging and before the neighbour-in-flight pass')` — `requireOrder(text, [SHIPPED_STAGE, PASS_ANCHOR, NEIGHBOUR])`, with `SHIPPED_STAGE = '--id "shipped-close-$NUM"'` and `NEIGHBOUR = '# #3278: neighbour-in-flight pass.'`. Permutation control: splice the extracted block out and re-insert it just above the line containing `SHIPPED_STAGE`'s `for`-loop opener (`DISPATCH_FIRING_RUN_DIR=$(node`), with `assert.notEqual` first → throws `/must come after/`. Deletion control: remove the anchor line → throws `/marker missing/`.
  - `test('AC3.1: the unlanded-blocker reason bullet states its posture')` — the bullet is `lineStartingWith(text, "- \`reason: 'unlanded-blocker'\`")` (asserted present). Facts:
    - `/`preflight-records\.js --blocker-landing` judges `unlanded`/` — 'judged by preflight-records'
    - `/This one DOES remove excluded candidates from `dispatch-groups\.json`, with no `#N`\/`#N,#M,\.\.\.` bypass/` — 'removing, no bypass'
    - `/eligible again on the first pull after its blocker lands/` — 'AC3.1: eligible again once landed'
    - `/fails open: an `undetermined` verdict keeps the candidate,/` — 'undetermined keeps the candidate'
    - `/and a failed `preflight-records\.js` call excludes nothing/` — 'a whole-call failure excludes nothing'

    `missingFactsOf` → `[]`, plus `assertEachPatternGoesRed`. Also assert the bullet does not contain `stay IN \`dispatch-groups.json\``, so `tests/dispatch-named-form-exclusion-reasons.test.js` counts it as removing.
  - `test('AC4.2 AC4.3: the malformed-blocker reason bullet states its faults and that the rest are still checked')` — the bullet is `lineStartingWith(text, "- \`reason: 'malformed-blocker'\`")` (asserted present), and it sits directly after the unlanded-blocker bullet. Facts:
    - `/whose blocker declaration that pass cannot check, because it would fail the pass's `preflight-records\.js` call for the whole pull or names no issue that can exist/` — 'AC4.3: why it is excluded'
    - `/a `Blocked by` line naming no valid issue number \(`#0`, or above 2147483647; bodies are not read under `work-links: native`\)/` — 'AC4.3: the body fault and its bound'
    - `/no entry in the native dependency response/` — 'AC4.3: the native fault'
    - `/Removed the same way, with no bypass/` — 'AC4.3: not dispatched'
    - `/eligible again on the first pull after its `Blocked by` line is fixed/` — 'AC4.3: eligible again once fixed'
    - `/every other candidate is still checked/` — 'AC4.2: no other record loses the check'

    `missingFactsOf` → `[]`, plus `assertEachPatternGoesRed`, plus the same not-`stay IN` assertion.
  - `test('three passes\' rationale moved to queue-pull-notes.md, one pointer line each')` — the lines starting `# #2829: not-spec-shaped exclusion.`, `# #1224: open-linked-PR exclusion.` and `# #1983: named-target existence exclusion.` each exist and end with `queue-pull-notes.md.`. `sectionOf(readText(NOTES), '## Where four exclusion passes sit, and why')` carries `**Not-spec-shaped pass (#2829).**`, `**Open-linked-PR pass (#1224).**`, `**Named-target existence pass (#1983).**` and `**Unlanded-blocker pass (#4792).**`. The last paragraph matches each of:
    - `/is excluded as `malformed-blocker` instead/`
    - `/the call re-run once without it/`
    - `/every other candidate is still checked/`
    - `/Only a whole-call failure/`
    - `/the `malformed-blocker` exclusions stand/`

    Absence (whitespace-collapsed haystack): `queue-pull-script.md` no longer contains `(#2786's evidence)`, `transient state the freshness signal` or `unsatisfiable by construction`. **Absence-grep control (re-run at `6c430595d`):** each of the three literals matches exactly once in the base file (`grep -c -F` printed `1`, `1`, `1`), so the absence check can fail. The test also proves this in memory: appending each literal to a copy makes that check report it.
  - `test('queue-pull-script.md and SKILL.md fit the Read rail after the pass and the move')` — `Buffer.byteLength(readText(QUEUE_PULL)) <= RAIL_BYTES` and the same for `plugin/skills/dispatch/SKILL.md`, with `RAIL_BYTES` imported from `plugin/bin/lib/skill-audit/budgets.js` (never a byte literal).

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/dispatch-unlanded-blocker-exclusion-fixture.test.js`
Expected: FAIL — `extraction start anchor not found: # #4792: unlanded-blocker and malformed-blocker exclusions.`, both bullet tests, and the moved-rationale test; the rail test passes (52,091 B and 51,877 B at base).

- [ ] **Step 3: Edit the prose**

  (a) In `queue-pull-script.md`, insert directly after the ``- `reason: 'shipped'` `` bullet line, in this order:

  ```
  - `reason: 'unlanded-blocker'` (`detail: {blockers: [{blocker, commit}]}`, #4792) — every remaining candidate with an out-of-run blocker that `preflight-records.js --blocker-landing` judges `unlanded` (closed, its closing commit not on `origin/{integration-branch}`), the verdict `/flow` Step 2.7b stops on before claiming. This one DOES remove excluded candidates from `dispatch-groups.json`, with no `#N`/`#N,#M,...` bypass, and the record is eligible again on the first pull after its blocker lands. `bin/dispatch-unlanded-blockers.js` runs the pass and fails open: an `undetermined` verdict keeps the candidate, and a failed `preflight-records.js` call excludes nothing.
  - `reason: 'malformed-blocker'` (`detail: {cause}`, #4792) — every remaining candidate whose blocker declaration that pass cannot check, because it would fail the pass's `preflight-records.js` call for the whole pull or names no issue that can exist: a `Blocked by` line naming no valid issue number (`#0`, or above 2147483647; bodies are not read under `work-links: native`), no entry in the native dependency response, or a record the call cannot read. Removed the same way, with no bypass, and eligible again on the first pull after its `Blocked by` line is fixed; every other candidate is still checked.
  ```

  (b) Replace the 18-line comment from `# #2829: not-spec-shaped exclusion. Runs unconditionally, right after` through `# reads $DISPATCH_GROUPS.` (the line before `if node "${CLAUDE_PLUGIN_ROOT}/bin/node-eval-file.js" "$DISPATCH_GROUPS" "$DISPATCH_EXCLUSIONS" > "${DISPATCH_GROUPS}.tmp" 2>"$DISPATCH_SHAPE_GATE_ERR" <<NODE_EVAL_EOF`) with:

  ```
  # #2829: not-spec-shaped exclusion. Why here, and why no #N bypass: queue-pull-notes.md.
  ```

  (c) Replace the 14-line comment from `# #1224: open-linked-PR exclusion. Runs unconditionally (both the cache-hit` through `# fetchLinkedPRs).` (the line before `DISPATCH_GROUP_NUMS=$(node`) with:

  ```
  # #1224: open-linked-PR exclusion. Why it runs unconditionally: queue-pull-notes.md.
  ```

  (d) Replace the 9-line comment from `# #1983: named-target existence exclusion. Runs unconditionally, right after` through `# tree may lag, and a dirty tree must not hide a deletion.` with the line below. Keep the following `DISPATCH_STANDALONE_DIR=$(node` line and the `# {integration-branch} resolution follows …` comment unchanged.

  ```
  # #1983: named-target existence exclusion. Why at the integration tip: queue-pull-notes.md.
  ```

  (e) Insert directly before the line `# #3278: neighbour-in-flight pass. Neighbour: a linking Key File or a strong` (after the shipped Close-proposal staging block's closing `fi` and its blank line):

  ```
  # #4792: unlanded-blocker and malformed-blocker exclusions. Why here, and why it fails open: queue-pull-notes.md.
  if node "${CLAUDE_PLUGIN_ROOT}/bin/dispatch-unlanded-blockers.js" --groups "$DISPATCH_GROUPS" --exclusions "$DISPATCH_EXCLUSIONS" --integration-branch "$INTEGRATION_BRANCH" --work-links "$WORK_LINKS" > "${DISPATCH_GROUPS}.tmp"; then
    mv "${DISPATCH_GROUPS}.tmp" "$DISPATCH_GROUPS"
  else
    rm -f "${DISPATCH_GROUPS}.tmp"
    echo "dispatch: queue-pull stopped -- unlanded-blocker exclusion pass failed; see error above." >&2
    exit 1
  fi

  ```

  (f) Append to `queue-pull-notes.md` (a blank line, then):

  ```
  ## Where four exclusion passes sit, and why

  These paragraphs moved here from the comments heading each pass in `queue-pull-script.md` (#4792), which now keep one line apiece pointing at this section. Read them when changing a pass's position or posture; running the script needs none of them.

  **Not-spec-shaped pass (#2829).** It runs unconditionally, right after grouping and bundling complete (both the cache-hit and cache-miss branches leave `$DISPATCH_GROUPS` populated by then), and before every `gh`-backed probe: a candidate whose cached body fails `/flow`'s Materialization hard gate (`shapeGate`) would otherwise be claimed and handed to `/flow`, where it fails mid-build — the failure counts against `dispatch-retry-ceiling`, and a correctness-classified failure makes Settle revoke `auto:merge` (#2786's evidence). It makes no `gh` or network call: `shapeGate` is pure, run against the body already fetched into `$DISPATCH_GROUPS`. It sits ahead of the #1224 open-PR pass and the #1984 shipped-candidate classification so an excluded candidate costs neither pass's `gh` calls (the open-PR pass's batched GraphQL call, the shipped pass's up-to-5 live `gh pr view` calls) and never gets a staged Close proposal from the shipped pass. Like the open-pr, target-missing and shipped passes (and unlike oversized), it removes the excluded candidate from `$DISPATCH_GROUPS` unconditionally, with no `#N`/`#N,#M,...` bypass — the exclusion is computed once, before any selection form reads `$DISPATCH_GROUPS`.

  **Open-linked-PR pass (#1224).** It runs unconditionally (both cache branches leave `$DISPATCH_GROUPS` populated) and independent of `$WORK_LINKS`: unlike the native blocked-by check, PR linkage is not a dependency-tracking policy choice, and unlike the queue-order cache (#1571) a PR opening or closing after the cache was written is exactly the kind of transient state the freshness signal (built from `auto:build` issues' own `updatedAt`/`state`) never observes, so skipping it on a cache hit would silently reintroduce the bug #1224 fixed. It makes one batched aliased GraphQL call across every candidate still in `$DISPATCH_GROUPS` (after blocked-by, native, oversized and not-spec-shaped filtering — there is no point checking a candidate already excluded for another reason), via `bin/resolve-linked-prs.js` (`record.js`'s `buildLinkedPRQuery` + `bin/lib/issues/linked-prs.js`'s `fetchLinkedPRs`).

  **Named-target existence pass (#1983).** It runs unconditionally, right after the open-linked-PR exclusion and before the read-only cross-PR overlap report: a record whose named target no longer exists at the integration tip is not merely unlikely to build, its Acceptance Criteria is unsatisfiable by construction (the observed shape: a `by:docs-health` ledger correction whose flagged doc a since-merged tidy sweep already deleted). It checks the integration tip, not the working tree (`flow/materialize.md`'s Named-location drift note): a worktree session's tree may lag, and a dirty tree must not hide a deletion.

  **Unlanded-blocker pass (#4792).** It runs unconditionally, after the shipped-candidate classification and its Close-proposal staging and before the neighbour-in-flight pass, so a candidate an earlier pass removed adds nothing to its query and a removed candidate is never checked for in-flight neighbours. Landing state is transient — a blocker's closing commit can reach `origin/{integration-branch}` at any moment — so, like the open-linked-PR pass, it runs on a cache hit too. `bin/dispatch-unlanded-blockers.js` hands the remaining candidates, already fetched, to one `preflight-records.js --prefetched-json --blocker-landing --work-links "$WORK_LINKS"` call (no per-record `gh issue view`), so the verdicts are exactly the ones `/flow` Step 2.7b computes before claiming. All candidates are that call's positional numbers, so a blocker that is itself a candidate is in-run and not judged; such a blocker is open, and the `blocked` pass already removed its dependents. One record's blocker fault never turns the pass off for the pull, and that record is not dispatched (#4792's Q3 and Q4): a record whose blocker declaration cannot be checked is excluded as `malformed-blocker` instead. The CLI screens it out of the call first (`malformedRecords`: a `Blocked by` number that is no valid issue number or is above 2147483647 when `work-links` is not `native`, a non-string body, non-array labels), and a record the call names as missing from the native dependency response is dropped with the call re-run once without it. Every other candidate is still checked, and the record is eligible again on the first pull after its `Blocked by` line is fixed. Otherwise the pass fails open, because Step 2.7b re-checks before any claim: an `undetermined` verdict keeps the candidate (2.7b proceeds on it too) with one `AUTO` line. Only a whole-call failure — a non-zero `preflight-records.js` exit the CLI cannot pin on a record, unparseable output, or an empty `$INTEGRATION_BRANCH` — prints one `Warning:` line and excludes no `unlanded-blocker` record (the `malformed-blocker` exclusions stand), and only a refused exclusions write (`appendExclusion` on a corrupt file) or an unreadable `$DISPATCH_GROUPS` stops the pull (#3110). An `open` verdict is not this pass's to exclude: the `blocked` pass owns open blockers.
  ```

  (g) In `SKILL.md`: in the queue-definition text, replace `+ not already shipped by a \`strong\`-tier merged-PR mention (#1984) + unclaimed**` with `+ not already shipped by a \`strong\`-tier merged-PR mention (#1984) + no \`unlanded\` out-of-run blocker or malformed blocker declaration (#4792) + unclaimed**`. In the `#N` bullet, replace ``` `blocked`/`open-pr`/`target-missing`/`shipped` as their Step 3 report lines ``` with ``` `blocked`/`open-pr`/`target-missing`/`shipped`/`unlanded-blocker`/`malformed-blocker` as their Step 3 report lines ```. In the `#N[,#M,#O...]` bullet, replace ``` (`blocked`, `open-pr`, `not-spec-shaped`, `target-missing`, `shipped`) ``` with ``` (`blocked`, `open-pr`, `not-spec-shaped`, `target-missing`, `shipped`, `unlanded-blocker`, `malformed-blocker`) ```. Add nothing else: the three edits add 156 B, measured, leaving 467 B (99.1%). If `wc -c` prints more than 52,500, apply the Global Constraints remedy (the short queue-definition clause) and nothing else.

  (h) In the journey, make four edits:
  - In the Success state, replace `` `target-missing`, or `shipped` — and `` with `` `target-missing`, `shipped`, `unlanded-blocker` with the blocker and closing commit that never landed, or `malformed-blocker` with the cause — and ``.
  - In Step 1's Should understand, replace ``for five reasons (`blocked`, `open-pr`, `not-spec-shaped`, `target-missing`, `shipped`)`` with ``for seven reasons (`blocked`, `open-pr`, `not-spec-shaped`, `target-missing`, `shipped`, `unlanded-blocker`, `malformed-blocker`)``.
  - Add `  - plugin/bin/dispatch-unlanded-blockers.js` to `files:` after the `  - plugin/bin/dispatch-resume.js` entry (line 13).
  - Append to Origin: `- Updated during build of #4792: names \`unlanded-blocker\` (a closed out-of-run blocker whose closing commit never reached the integration branch) and \`malformed-blocker\` (a blocker declaration that cannot be checked), the sixth and seventh removing exclusions, in Step 1 and the Success state; \`dispatch-unlanded-blockers.js\` added to \`files:\``.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/dispatch-unlanded-blocker-exclusion-fixture.test.js tests/dispatch-named-form-exclusion-reasons.test.js tests/dispatch-not-spec-shaped-exclusion-fixture.test.js tests/dispatch-named-target-exclusion-fixture.test.js tests/dispatch-tidy-named-target-coordination.test.js tests/dispatch-shipped-candidate-prose.test.js tests/dispatch-per-record-groups-prose.test.js tests/dispatch-mcp-timestamp-alias.test.js tests/dispatch-neighbour-in-flight-mcp.test.js tests/dispatch-near-dup-pairs-script.test.js tests/skill-fence-guard-shapes.test.js tests/node-eval-file-heredoc-syntax.test.js tests/node-e-snippet-syntax.test.js tests/session-tmp-root-migration.test.js tests/bin-lib/dispatch/reporting-fastlane-bundle-citation.test.js tests/bin-lib/skill-audit/context-cost.test.js tests/skill-size-single-source.test.js`
Expected: PASS. `tests/dispatch-named-form-exclusion-reasons.test.js` now derives seven removing reasons, including `unlanded-blocker` and `malformed-blocker`, and finds them in both `SKILL.md` bullets and the journey's `seven reasons`. `wc -c plugin/skills/dispatch/queue-pull-script.md plugin/skills/dispatch/SKILL.md` prints under 52,500 each (planned 51,339 and 52,033).

- [ ] **Step 5: Commit**

  ```bash
  git -C "/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude/worktrees/dispatch-record-4792" add plugin/skills/dispatch/queue-pull-script.md plugin/skills/dispatch/queue-pull-notes.md plugin/skills/dispatch/SKILL.md docs/journeys/learn-why-a-named-record-wont-dispatch-3084.md tests/dispatch-unlanded-blocker-exclusion-fixture.test.js
  git -C "/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude/worktrees/dispatch-record-4792" commit -m "Exclude unlanded-blocker and malformed-blocker records at dispatch's queue pull — selection-time pass, three passes' rationale moved to queue-pull-notes, refs #4792" -m "Claude-Session: https://claude.ai/code/session_01UwjosG5JjuyaA68VwC69Gs"
  ```

### Task 7: Report the unlanded-blocker and malformed-blocker exclusions and cover the gh-absent path

**Role:** integration

**Files:**
- Modify: `plugin/skills/dispatch/blocked-exclusion-report.md` (after the `target-missing` line, the line starting ``` `#{number} excluded — named target {path} ``` (line 19), before `**Exception — the headless drain steady state.**` (line 21))
- Modify: `plugin/skills/dispatch/mcp-transport.md` (new section directly before the heading `## Step 2 — open-linked-PR exclusion (#1224)`, line 154)
- Modify: `docs/skill-graph.md` (`## dispatch` table: new row directly after the row starting `| \`bin/dispatch-resume.js\` (\`bin/lib/dispatch/resume-eligibility.js\`) |`, line 272 at `6c430595d`)
- Modify: `docs/plugin-structure.md` (the `dispatch` sub-file row, line 124, the sentence starting `queue-pull-notes.md holds Step 2's queue-build rationale`)
- Create: `tests/dispatch-unlanded-blocker-consumers-conformance.test.js`

**Interfaces:**
- Consumes: Task 5's CLI path (the skill-graph row and the MCP section name it). It does not depend on Task 6's test file.
- Degrade-clause convention check: the gh-absent clause cites `mcp-transport.md`'s own established conventions instead of restating a new one: the #2523 "no generic GraphQL bridge" section, the cross-PR overlap section's fail-open skip, and `flow/multispec-preflight-failure.md`'s `**Blocker landing.**` paragraph (the gh-absent `--blocker-states-json` path, under which a closed blocker reads `undetermined`, `classifyFromState` in `bin/lib/preflight-records/blocker-landing.js`). **Q4 changes this section from "skip the block" to "run it as written".** The `malformed-blocker` screen (`malformedRecords`) reads only the bodies already in `dispatch-groups.json` and needs no `gh`, so skipping the block would let a `Blocked by #0` record dispatch on this transport. Run as written, the landing call reaches `gh` only when a candidate has an out-of-run blocker, or under `native`. When it does, `execFileSync('gh')` throws, `preflight-records.js` exits 1 with a line that is not the native-missing one, and the CLI fails open (Task 5 step 8). The screened `malformed-blocker` entries still stand.

- [ ] **Step 1: Write the failing test** — create `tests/dispatch-unlanded-blocker-consumers-conformance.test.js` (header: #4792). Use the shared helpers and `readText`; define a local `requireOrder` as in Task 6.
  - `REPORT_FACTS` over the paragraph from the line starting ``Then read the same file's `reason: 'unlanded-blocker'` `` through the `malformed-blocker` report line. Slice it on blank-line boundaries (`split('\n\n')`: the chunk starting with that prefix plus the next three chunks), with whitespace collapsed. Facts:
    - `/`reason: 'unlanded-blocker'` entries \(`records: \[number\], detail: \{blockers: \[\{blocker, commit\}\]\}` each, #4792/` — 'reads the unlanded-blocker entries'
    - `/under the same exception and empty-array rules below/` — 'inherits the headless-silence and empty rules'
    - `` /`#\{number\} excluded — blocker not landed: #\{blocker\} \(closing commit \{commit\}\), … — eligible again once it reaches the integration branch`/ `` — 'AC3.1: the report line names blocker, commit and when it is eligible again'
    - `/Then its `reason: 'malformed-blocker'` entries \(`records: \[number\], detail: \{cause\}` each, #4792/` — 'AC4.3: reads the malformed-blocker entries'
    - `` /`#\{number\} excluded — malformed blocker declaration: \{cause\} — eligible again once its Blocked by line is fixed`/ `` — 'AC4.2 AC4.3: the malformed record has its own report line'

    Tests: `missingFactsOf` → `[]` (`'AC3.1 AC4.3: blocked-exclusion-report.md renders unlanded-blocker and malformed-blocker entries (#4792)'`), plus `assertEachPatternGoesRed`. Placement: the paragraph's index is after the `target-missing` line and before `**Exception — the headless drain steady state.**`. The control moves the paragraph below the Exception paragraph (`assert.notEqual` first) and the same check throws.
  - `test('AC4.3: the malformed-blocker report line\'s cause is a cause the CLI writes')` — `require('../plugin/bin/lib/dispatch/unlanded-blockers')`'s `NATIVE_MISSING_CAUSE` and `malformedRecords([{ number: 13, body: 'Blocked by #0', labels: [] }], 'body-text')[0].cause` each, with `13` spliced into `{number}` and the cause into `{cause}`, yield a line containing no `{`. This is a cheap twin: the line's only placeholders are the entry's own `records[0]` and `detail.cause`. Control: a copy of the report line with `{cause}` renamed `{reason}` fails it.
  - `MCP_FACTS` over `sectionOf(readText(mcp-transport.md), '## Step 2 — unlanded-blocker exclusion (#4792)')`:
    - `/Run the pass's `if node … dispatch-unlanded-blockers\.js … fi` block as written anyway/` — 'MCP path runs the block'
    - `/its `malformed-blocker` screen reads only the bodies already in `dispatch-groups\.json`, so it still excludes/` — 'AC4.3: the screen needs no gh'
    - `/the GitHub MCP server has no generic GraphQL bridge \(the #2523 section below\)/` — 'cites the #2523 convention'
    - `/reads every closed blocker `undetermined`, so it can never return the `unlanded` verdict/` — 'why no MCP substitute'
    - `/`\/claude-tweaks:flow` Step 2\.7b has the same blind spot on this transport/` — 'same blind spot as /flow'
    - `/the CLI prints one `Warning:` line and excludes no `unlanded-blocker` record/` — 'run as written, the landing call fails open'

    Tests: `[]` plus go-red. Also assert the section does not contain `skip the pass's`, the pre-Q4 instruction. Placement: the heading sits after `## Step 2 — cross-PR overlap report (#1579)` and before `## Step 2 — native blocked-by / linked-PR batching: no generic GraphQL bridge (#2523)`, so its "above"/"below" deictics resolve (Deictic-reference check). Permutation control: move the section after the #2523 heading → `requireOrder` throws `/must come after/`.
  - `test('skill-graph names the unlanded-blocker queue-pull edge (#4792)')` — the line starting ``| `bin/dispatch-unlanded-blockers.js` (`bin/lib/dispatch/unlanded-blockers.js`) |`` exists and contains each of: `queue-pull-script.md`, `--prefetched-json`, `reason: 'unlanded-blocker'`, `reason: 'malformed-blocker'`, `every other candidate is still checked`, `blocked-exclusion-report.md` and `mcp-transport.md`. Control: removing the line fails the existence check.
  - `test('plugin-structure.md describes queue-pull-notes.md\'s pass-placement section')` — the `dispatch` row contains `and where the not-spec-shaped, open-linked-PR, named-target and unlanded-blocker passes sit and why (#4792)`. Control: a copy with that clause removed fails the check.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/dispatch-unlanded-blocker-consumers-conformance.test.js`
Expected: FAIL — the report paragraph is not found, `heading not found: ## Step 2 — unlanded-blocker exclusion (#4792)`, the skill-graph and plugin-structure lines are missing, and the cause-twin test finds no `malformed-blocker` report line.

- [ ] **Step 3: Edit the prose**

  In `blocked-exclusion-report.md`, after the `target-missing` report line and its blank line, insert:

  ```
  Then read the same file's `reason: 'unlanded-blocker'` entries (`records: [number], detail:
  {blockers: [{blocker, commit}]}` each, #4792 — `queue-pull-script.md`'s unlanded-blocker pass) and
  render one line per record, under the same exception and empty-array rules below:

  `#{number} excluded — blocker not landed: #{blocker} (closing commit {commit}), … — eligible again once it reaches the integration branch`

  Then its `reason: 'malformed-blocker'` entries (`records: [number], detail: {cause}` each, #4792 —
  the same pass), one line per record, under the same rules:

  `#{number} excluded — malformed blocker declaration: {cause} — eligible again once its Blocked by line is fixed`

  ```

  In `mcp-transport.md`, insert directly before `## Step 2 — open-linked-PR exclusion (#1224)`:

  ```
  ## Step 2 — unlanded-blocker exclusion (#4792)

  `queue-pull-script.md`'s unlanded-blocker pass needs `gh` for its landing judgment: `bin/dispatch-unlanded-blockers.js` calls `preflight-records.js --blocker-landing`, whose landing check is a batched GraphQL query plus REST compare calls, and the GitHub MCP server has no generic GraphQL bridge (the #2523 section below). Run the pass's `if node … dispatch-unlanded-blockers.js … fi` block as written anyway: its `malformed-blocker` screen reads only the bodies already in `dispatch-groups.json`, so it still excludes, and the landing call fails open the same way the cross-PR overlap fetch above does — `preflight-records.js` exits non-zero at its first `gh` call, if it makes one, and the CLI prints one `Warning:` line and excludes no `unlanded-blocker` record. No MCP substitute exists for that judgment: `preflight-records.js`'s gh-free `--blocker-states-json` path reads every closed blocker `undetermined`, so it can never return the `unlanded` verdict this pass excludes on, and `/claude-tweaks:flow` Step 2.7b has the same blind spot on this transport (`flow/multispec-preflight-failure.md`'s Blocker landing paragraph) — the lost exclusion is one `/flow` would not enforce either.

  ```

  In `docs/skill-graph.md`'s `## dispatch` table, insert after the `bin/dispatch-resume.js` row (line 272):

  ```
  | `bin/dispatch-unlanded-blockers.js` (`bin/lib/dispatch/unlanded-blockers.js`) | Since #4792, `queue-pull-script.md`'s unlanded-blocker pass runs it over the remaining candidate pool: it hands the already-fetched candidates to `preflight-records.js --prefetched-json - --blocker-landing`, the judgment `/flow` Step 2.7b runs before claiming, and drops each candidate with an `unlanded` out-of-run blocker as `reason: 'unlanded-blocker'` until that blocker lands. A candidate whose blocker declaration cannot be checked is dropped as `reason: 'malformed-blocker'` instead of failing the call, and every other candidate is still checked. Otherwise it fails open (an `undetermined` verdict keeps the candidate; a failed `preflight-records.js` call excludes no `unlanded-blocker` record); `blocked-exclusion-report.md` renders both reasons' entries, and `mcp-transport.md` runs the pass as written on a `gh`-absent firing, where only the malformed-blocker screen can exclude. |
  ```

  In `docs/plugin-structure.md`'s `dispatch` row (line 124), replace `queue-pull-notes.md holds Step 2's queue-build rationale — the two pulls' \`--limit\` truncation behavior and the \`work-links: native\` GraphQL dependency filter — read only under \`work-links: native\` or when diagnosing a capped pull.` with `queue-pull-notes.md holds Step 2's queue-build rationale — the two pulls' \`--limit\` truncation behavior, the \`work-links: native\` GraphQL dependency filter, and where the not-spec-shaped, open-linked-PR, named-target and unlanded-blocker passes sit and why (#4792) — read only under \`work-links: native\`, when diagnosing a capped pull, or when changing one of those passes.`

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/dispatch-unlanded-blocker-consumers-conformance.test.js tests/dispatch-named-form-exclusion-reasons.test.js tests/dispatch-neighbour-in-flight-mcp.test.js tests/dispatch-mcp-timestamp-alias.test.js tests/flow-claim-preflight.test.js tests/skill-graph-table-structure.test.js tests/skill-graph-dangling-pointer.test.js tests/tidy-subfile-table-completeness.test.js tests/skill-catalog-completeness.test.js tests/bin-lib/skill-audit/context-cost.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

  ```bash
  git -C "/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude/worktrees/dispatch-record-4792" add plugin/skills/dispatch/blocked-exclusion-report.md plugin/skills/dispatch/mcp-transport.md docs/skill-graph.md docs/plugin-structure.md tests/dispatch-unlanded-blocker-consumers-conformance.test.js
  git -C "/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude/worktrees/dispatch-record-4792" commit -m "Report unlanded-blocker and malformed-blocker exclusions and run the pass on the MCP transport — report lines, gh-absent section, skill-graph edge, refs #4792" -m "Claude-Session: https://claude.ai/code/session_01UwjosG5JjuyaA68VwC69Gs"
  ```

### Task 8: Skip the teardown's claim release after a blocker-landing stop (§5 and §6)

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/skills/dispatch/two-call-gate.md`:
  - §5: a new paragraph directly after the paragraph starting `   Settle has already released this group's claim and adjusted its labels by this point` (line 41), before the line starting `Only once that cleanup call returns does this session enter the next group's worktree` (line 43).
  - §6: a new paragraph directly after item 3, which ends `what performs it correctly either way.` (line 87), and before `## 7. Terminal path when the first call reports \`already-shipped\`` (line 89).
  - §8 item 4: the clause `section 6 for a missing or malformed status line)` (line 167).
- Modify: `plugin/skills/wrap-up/cleanup-procedures-execution.md` (Section E: new paragraph directly after the line starting `**Skip this whole section when the invocation names \`claim-permission-denied: skip the claim release\` (#4899)**`, line 335, and before the line starting `This spec's record is identified whenever this section runs`)
- Modify: `plugin/skills/wrap-up/flags.md` (the `cleanup-only` entry, line 6: the sentence starting `It also recognises one context phrase from the dispatching teardown`)
- Modify: `docs/journeys/gather-the-wrap-up-fact-pack-1930.md` (line 36: the clause `unless its invocation names \`claim-permission-denied: skip the claim release\` (#4899), which skips Section E and the pack with it`)
- Test: `tests/settle-blocker-landing-stop-conformance.test.js` (append)

**Interfaces:**
- Consumes: Task 2's paragraph name "Blocker-landing special case" (the teardown paragraphs and Section E cite it); Task 1's row clause naming the second call's `OUTCOME: blocked`.
- Release-idempotency finding and why the phrase applies in both cases: Global Constraints' Release idempotency bullet (`plugin/bin/lib/release-claim/release.js:254-276`).
- **Q5 path, traced against the source.** A second call that hands off (`OUTCOME: handoff`) is continued per §8 item 2 with `NEXT_STEPS` from `SECOND_CALL_STEPS` (`test`, `review`, `polish`, `re-verify`, `wrap-up`). When that list includes `test`, the continuation's `/flow` re-runs Step 2.7b (`flow/validation.md` 2.7b item 2 skips only a list with neither `build` nor `test`). Because the first call claimed the record, this is always the claimed case. On an `open`/`unlanded` verdict, the continuation's own Settle runs the claimed case: release, then the PR tombstone. `task-prompt.md:459-461` says Settle's step 2 has already released the claim for `failed`/`blocked`. The continuation then reports `OUTCOME: blocked`, `ISSUE #{n}: failed:blocker-landing`, `STATUS: BLOCKED` (`task-prompt.md:499` and `:506`) without reaching wrap-up, so the group's worktree is still up. Today §8 item 4 routes a second call's `OUTCOME` "like any second call's (`SKILL.md` Step 6; section 6 for a missing or malformed status line)", and `sequential-execution.md:58` assumes the second call's own wrap-up tears the worktree down. Nothing tears it down on this path. So §8 item 4 gains a route to §6, and §6 gains a paragraph that makes item 1's `cleanup-only` call with the same phrase §5 uses. The phrase is required here because Section E's release would otherwise post a duplicate comment on the tombstone Settle just wrote. `firing-exclusion.md:30-31` already appends `firing` for a second call's `blocked`, so it needs no change.
- Placement and deictics (Deictic-reference re-resolution check):
  - §5: the #4899 paragraph says "the paragraph below does not apply", meaning the `Settle has already released…` overlap paragraph directly below it. Inserting the new §5 paragraph between those two would re-point that "below" at it, so it goes after the overlap paragraph and refers to it as "the paragraph above".
  - §6: the new paragraph follows item 3 and names "item 1" and "item 2" by number, so it must not sit inside the numbered list (it is unindented, after the list).
  - Section E: the new clause sits after #4899's skip clause and reads "Skip it too", so the word "it" resolves to "this whole section" from the clause above it.
- Pins this edit must keep (Moved-prose pin check, phrases grepped across `tests plugin docs` at `6c430595d`):
  - `tests/flow-claim-preflight.test.js` lines 406-421 slice the #4899 paragraph to its next `\n\n` (unchanged; a blank line separates it from the overlap paragraph). They match `Skip this whole section when the invocation names \`claim-permission-denied: skip the claim release\``, #4899's SKIP log command, and `/`\(claim-permission-denied: skip the claim release\)`[^\n]*stripped before input classification[^\n]*never read as a record reference/` in `flags.md`. The new `flags.md` wording keeps that regex matching.
  - Line 426's pin (`next group's worktree (none after a Claim permission stop: the firing ends, \`SKILL.md\`).\n\n## 8.`) is §7's text and untouched.
  - `tests/build-already-shipped-exit.test.js:52-53` anchors on the `## 7. Terminal path` heading, which the §6 paragraph leaves byte-identical.
  - `tests/dispatch-handoff-continuation-conformance.test.js:206-209` reads §8's closing note from `A handoff refused for a malformed \`NEXT_STEPS\`` and requires it not to match `/item 1 or 3|bound/`. The item 4 edit sits above that note and adds neither.
  - No test pins §6's items or §8 item 4's `section 6 for a missing or malformed status line` clause (grep, no hits outside `two-call-gate.md`).
- Prohibition-vs-existing-mandate check: the release mandates this skip overrides are Section E's own release (carved out by the new clause), §5's overlap paragraph (carved out by "does not apply"), and §6 item 2 (carved out by the new §6 paragraph's "item 2 does not apply"). §7 ("finds an already-released claim and no-ops") never carries this stop (`already-shipped`), so it stays unedited. §6 item 2's and §7's wrong "no-ops" wording for their own paths is the Follow-ups record, not folded in.
- Release sites covered: Settle step 2 (Task 2) and Section E, reached from §5 and §6 (this task). The claim-targets-stop-addition grep's other hits are not this stop's (Global Constraints). There is no change to `firing-exclusion.md` or `next-ranking.md`: `firing-exclusion.md`'s rule already appends `firing` for any first call whose `OUTCOME` is not `build-test-ok` (lines 27-28) and for a second call's `failed`/`blocked` (lines 30-31). A first call's continuation reaches §5 through §8, which judges §2's gate on the last continuation's report.

- [ ] **Step 1: Write the failing test** — append to `tests/settle-blocker-landing-stop-conformance.test.js`. `TWO_CALL_GATE = plugin/skills/dispatch/two-call-gate.md`, `SECTION_E = plugin/skills/wrap-up/cleanup-procedures-execution.md`, `FLAGS = plugin/skills/wrap-up/flags.md`, `PACK_JOURNEY = docs/journeys/gather-the-wrap-up-fact-pack-1930.md`. Define a local `requireOrder` as in Task 6. `TEARDOWN_PREFIX = '   **Blocker-landing stop (#4792).**'` (§5, indented); `SECOND_CALL_PREFIX = '**Blocker-landing stop (#4792).** A second call\'s handoff continuation'` (§6, unindented); `teardownParagraph(text)` = `requireLine(text, TEARDOWN_PREFIX, 'two-call-gate.md')`; `secondCallParagraph(text)` = `requireLine(text, SECOND_CALL_PREFIX, 'two-call-gate.md')`. `sectionBetween(text, start, end)` slices from the line starting `start` to the line starting `end` (assert both indexes are not -1). `TEARDOWN_FACTS` (non-global):
  - `/`ISSUE #\{n\}: failed:blocker-landing`/` — 'the teardown keys on the gate line'
  - `/its last handoff continuation \(section 8\)/` — 'AC5.1: covers the claimed case reached through a continuation'
  - `/so the paragraph above, on Settle's already-released claim, does not apply/` — 'the overlap paragraph does not apply'
  - `/Append the parenthetical `\(blocker-landing: skip the claim release\)` to the cleanup-only invocation above, in both cases/` — 'AC2.1: the phrase, in both cases'
  - `/`release-claim\.js` posts a release comment on an absent blob or a tombstone too \(`bin\/lib\/release-claim\/release\.js`\)/` — 'states the non-idempotent mechanism'
  - `/a false one when this run never claimed the record, a duplicate when Settle already released it/` — 'names both wrong comments'
  - `/the firing goes on to the next group/` — 'not a firing stop'

  `SECOND_CALL_FACTS` (non-global):
  - `/A second call's handoff continuation \(section 8\) whose step list includes `test` re-runs `\/flow`'s pre-claim checks/` — 'AC6.1: names the path'
  - `/reports `OUTCOME: blocked` with `ISSUE #\{n\}: failed:blocker-landing` before reaching wrap-up, so the group's worktree is still up/` — 'AC6.1: the outcome, and why a teardown is owed'
  - `/Make item 1's call for it too, with the parenthetical `\(blocker-landing: skip the claim release\)` appended/` — 'AC6.1: the same skip as the first-call path'
  - `/the same phrase section 5's Blocker-landing stop paragraph appends/` — 'AC6.1: one phrase for both sections'
  - `/the continuation's own Settle already released the claim and closed the draft PR \(`settle-and-merge\.md`'s Blocker-landing special case, claimed case\)/` — 'AC5.1 AC6.1: always the claimed case'
  - `/item 2 does not apply/` — 'AC6.1: carves out item 2\'s overlap'
  - `/`release-claim\.js` would post a duplicate release comment on the tombstone/` — 'AC6.1: the mechanism'

  `SECTION_E_PREFIX = '**Skip it too when the invocation names \`blocker-landing: skip the claim release\` (#4792)**'`. Tests:
  - `test('AC2.1 AC5.1: two-call-gate.md §5 tells the teardown to skip the claim release after a blocker-landing stop (#4792)')` — `missingFactsOf(TEARDOWN_FACTS)(teardownParagraph(readText(TWO_CALL_GATE)))` → `[]`, plus `assertEachPatternGoesRed`.
  - `test('the teardown paragraph sits after the overlap paragraph, so both "below" and "above" resolve')` — `requireOrder(text, ['**Claim permission stop (#4899).**', "Settle has already released this group's claim", '**Blocker-landing stop (#4792).**', 'Only once that cleanup call returns'])`. Permutation control: move the new paragraph to just after the #4899 paragraph (`assert.notEqual` first) → throws `/must come after/`.
  - `test('AC6.1: two-call-gate.md §6 gives a second call\'s continuation the same teardown skip (#4792)')` — `missingFactsOf(SECOND_CALL_FACTS)(secondCallParagraph(text))` → `[]`, plus `assertEachPatternGoesRed`. The paragraph lies inside `sectionBetween(text, '## 6. Terminal path', '## 7. Terminal path')`, after the line starting `3. **Worktree teardown is unaffected by which call reached it.**`. Permutation control: move it to just after §5's `   **Blocker-landing stop (#4792).**` paragraph (`assert.notEqual` first) → the section check throws. Deletion control: a copy with the paragraph removed throws `two-call-gate.md has no line starting "**Blocker-landing stop (#4792).** A second call's handoff continuation"`.
  - `test('AC6.1: §8 item 4 routes a second call\'s blocker-landing blocked to §6 (#4792)')` — the text from the line starting `## 8. Continuing a handed-off call` to the end of the file (§8 is the file's last section; assert the heading exists), whitespace-collapsed, matches `/section 6 for a missing or malformed status line, or for a blocker-landing stop's `blocked`, per its Blocker-landing stop paragraph\)/`. Control: the pre-edit clause (`section 6 for a missing or malformed status line)`) fails it.
  - `test('AC6.1: the phrase both sections append is the one Section E and flags.md declare')` — extract the parenthetical from the §5 paragraph and from the §6 paragraph with `/`\((blocker-landing: skip the claim release)\)`/`, assert both captures are equal, and assert Section E's clause names the same capture and `flags.md` declares it in parentheses. Control: a §6 copy with the phrase spelled `blocker-landing: skip claim release` (`assert.notEqual` first) fails the equality.
  - `test('AC2.1 AC6.1: Section E skips its release on the blocker-landing phrase and logs the skip (#4792)')` — the line starting `SECTION_E_PREFIX` exists (message `cleanup-procedures-execution.md has no line starting "**Skip it too when the invocation names …"`). Whitespace-collapsed, it matches:
    - `/`dispatch\/two-call-gate\.md` §5 or §6/`
    - `/log-decision\.js" --run "\$PIPELINE_RUN_DIR" --status SKIP --section "\/wrap-up" --step "Section E" --text "condition: blocker-landing named by the cleanup-only call → fallback: claim release skipped" --reversibility n\/a/`
    - `/`flags\.md`'s `cleanup-only` entry declares the phrase/`

    Placement: `requireOrder(text, ['## E. Issue claim release', 'Skip this whole section when the invocation names \`claim-permission-denied', SECTION_E_PREFIX, "This spec's record is identified whenever this section runs"])`. Control: a copy with the clause line removed (`assert.notEqual` first) throws the existence message.
  - `test('flags.md declares the blocker-landing phrase beside #4899\'s')` — `flags.md` matches `/`\(blocker-landing: skip the claim release\)` \(#4792\), each stripped before input classification like a flag and never read as a record reference/` and still matches #4899's regex above. Control: `mutate`-style removal of ` and \`(blocker-landing: skip the claim release)\` (#4792)` fails the first match.
  - `test('the fact-pack journey names both phrases that skip Section E and the pack')` — the journey contains `` `claim-permission-denied: skip the claim release` (#4899) or `blocker-landing: skip the claim release` (#4792), either of which skips Section E and the pack with it ``. Control: the pre-edit sentence fails it.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/settle-blocker-landing-stop-conformance.test.js`
Expected: FAIL. The failures are `two-call-gate.md has no line starting "   **Blocker-landing stop (#4792).**"`, the §6 paragraph's existence message, the §8 item 4 route, the phrase-equality test, the Section E existence message, the `flags.md` match and the journey check. Tasks 2-3's tests still pass.

- [ ] **Step 3: Edit the prose**

  In `two-call-gate.md` §5, after the overlap paragraph (`   Settle has already released this group's claim …`) and its blank line, insert (three-space indent, like its neighbours):

  ```
     **Blocker-landing stop (#4792).** When the first call, or its last handoff continuation (section 8), reported `ISSUE #{n}: failed:blocker-landing`, Settle released a claim only when an earlier call of this run had taken one (`settle-and-merge.md`'s Blocker-landing special case), so the paragraph above, on Settle's already-released claim, does not apply. Append the parenthetical `(blocker-landing: skip the claim release)` to the cleanup-only invocation above, in both cases; `wrap-up/cleanup-procedures-execution.md` Section E skips its release when the invocation names that, because `release-claim.js` posts a release comment on an absent blob or a tombstone too (`bin/lib/release-claim/release.js`): a false one when this run never claimed the record, a duplicate when Settle already released it. Unlike a Claim permission stop, the firing goes on to the next group.
  ```

  In `two-call-gate.md` §6, after item 3 and its blank line, before `## 7.`, insert (unindented):

  ```
  **Blocker-landing stop (#4792).** A second call's handoff continuation (section 8) whose step list includes `test` re-runs `/flow`'s pre-claim checks, and when Step 2.7b stops it, the continuation reports `OUTCOME: blocked` with `ISSUE #{n}: failed:blocker-landing` before reaching wrap-up, so the group's worktree is still up. Make item 1's call for it too, with the parenthetical `(blocker-landing: skip the claim release)` appended, the same phrase section 5's Blocker-landing stop paragraph appends. The first call claimed the record, so the continuation's own Settle already released the claim and closed the draft PR (`settle-and-merge.md`'s Blocker-landing special case, claimed case), and item 2 does not apply: `wrap-up/cleanup-procedures-execution.md` Section E skips its release on that phrase, because `release-claim.js` would post a duplicate release comment on the tombstone (`bin/lib/release-claim/release.js`).
  ```

  In `two-call-gate.md` §8 item 4, replace `section 6 for a missing or malformed status line). A handoff` with `section 6 for a missing or malformed status line, or for a blocker-landing stop's \`blocked\`, per its Blocker-landing stop paragraph). A handoff`. Keep the hard wrap: let the edited line run long rather than re-wrap the paragraph.

  In `cleanup-procedures-execution.md` Section E, after the #4899 skip line and its blank line, insert:

  ```
  **Skip it too when the invocation names `blocker-landing: skip the claim release` (#4792)** — `/claude-tweaks:dispatch`'s teardown after `/flow`'s pre-claim blocker-landing stop (`dispatch/two-call-gate.md` §5 or §6): Settle already released any claim this run took (`dispatch/settle-and-merge.md`'s Blocker-landing special case), and `release-claim.js` would post a release comment anyway — a false one for a record this run never claimed, a duplicate for one Settle already released. Log the skip: `node "${CLAUDE_PLUGIN_ROOT}/bin/log-decision.js" --run "$PIPELINE_RUN_DIR" --status SKIP --section "/wrap-up" --step "Section E" --text "condition: blocker-landing named by the cleanup-only call → fallback: claim release skipped" --reversibility n/a` (`flags.md`'s `cleanup-only` entry declares the phrase).
  ```

  In `flags.md`, replace `It also recognises one context phrase from the dispatching teardown, \`(claim-permission-denied: skip the claim release)\` (#4899), stripped before input classification` with `It also recognises two context phrases from the dispatching teardown, \`(claim-permission-denied: skip the claim release)\` (#4899) and \`(blocker-landing: skip the claim release)\` (#4792), each stripped before input classification`.

  In the journey, replace `unless its invocation names \`claim-permission-denied: skip the claim release\` (#4899), which skips Section E and the pack with it` with `unless its invocation names \`claim-permission-denied: skip the claim release\` (#4899) or \`blocker-landing: skip the claim release\` (#4792), either of which skips Section E and the pack with it`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/settle-blocker-landing-stop-conformance.test.js tests/flow-claim-preflight.test.js tests/flow-cleanup-only-conformance.test.js tests/wrap-up-record-resolution-conformance.test.js tests/dispatch-sequential-execution-conformance.test.js tests/dispatch-handoff-continuation-conformance.test.js tests/dispatch-mechanical-enforcement.test.js tests/build-already-shipped-exit.test.js tests/log-decision-text-file-sites-conformance.test.js tests/bin-lib/release-claim/release.test.js tests/bin-lib/skill-audit/context-cost.test.js`
Expected: PASS, including `tests/bin-lib/release-claim/release.test.js`'s `an absent or tombstoned blob is already-released: no PUT, comment posted, labels still processed` (the premise both paragraphs state). `wc -c plugin/skills/dispatch/two-call-gate.md plugin/skills/wrap-up/cleanup-procedures-execution.md plugin/skills/wrap-up/flags.md` prints under 52,500 each (planned ~25,909, 47,245 and 4,822).

- [ ] **Step 5: Commit**

  ```bash
  git -C "/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude/worktrees/dispatch-record-4792" add plugin/skills/dispatch/two-call-gate.md plugin/skills/wrap-up/cleanup-procedures-execution.md plugin/skills/wrap-up/flags.md docs/journeys/gather-the-wrap-up-fact-pack-1930.md tests/settle-blocker-landing-stop-conformance.test.js
  git -C "/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude/worktrees/dispatch-record-4792" commit -m "Skip the cleanup-only claim release after a blocker-landing stop — first-call and second-call teardowns, no false or duplicate release comment, refs #4792" -m "Claude-Session: https://claude.ai/code/session_01UwjosG5JjuyaA68VwC69Gs"
  ```

## Spec coverage map

Labels follow the spec's Acceptance Criteria in order; AC4.3 and AC6.1 are the two criteria added with Decisions Q4 and Q5.

| AC clause | Covered by |
|---|---|
| AC1.1 (a conformance test over `settle-and-merge.md` asserts Step 6 names the blocker-landing stop and states it does not count toward the retry ceiling) | Task 2 `AC1.1 AC2.1 AC5.1 AC6.1` test (gate line, both verdicts, `no attempt counted against dispatch-retry-ceiling`), the placement test and the same-gate test; Task 1 row facts and the ordering-section gate sentence (after the verdict table, naming `open`/`unlanded`) |
| AC1.2 (reverting the Step 6 text turns it red) | Task 2 `AC1.2` revert test (the paragraph removed → `assertSettle` throws) and the per-fact go-red test; Task 1 `AC1.2` go-red |
| AC2.1 (an `unlanded`-blocker record ends one Settle pass with the claim released and `auto:merge` still present) | Task 2 facts: the claimed case runs steps 1-2 (`release-claim.js`, `--reason "failed: blocker-landing"`), the unclaimed case holds no claim to release, steps 3-7 are skipped (no `failure-check`, no `auto:merge`/`auto:merge-pending` revocation), and the pointer never counts as an attempt; Task 1 report line; Task 3's `transient` fallback (which preserves `auto:merge`); Task 8's teardown phrase and Section E skip, so no later release posts a false or duplicate comment |
| AC3.1 (a queue pull over a pool with an `unlanded` out-of-run blocker excludes that record with its own reason, and includes it once the blocker lands) | Task 5 `AC3.1` behavioral test (real `preflight-records.js` `run`, fake `gh`: `diverged` → excluded as `unlanded-blocker`, `behind` → included) plus its undetermined, open, bundle and fail-open tests; Task 4 `--prefetched-json` landing test; Task 6 extract-and-run of the queue-pull block (bash and zsh), order pin and bullet facts; Task 7 report line |
| AC4.1 (a queue pull whose pool also contains a record with a malformed or unreadable blocker declaration still excludes the `unlanded`-blocker record) | Task 5 `AC4.1 AC4.2 AC4.3` test through the real `preflight-records.js` `run` (`#11` excluded beside a `Blocked by #0` record, one call, positionals `['10', '11']`), the per-fault table and the native-missing test (each still excludes `#11`) |
| AC4.2 (the malformed record is reported, and no other record loses the check) | Task 5: the `#13` `AUTO … malformed blocker declaration …; the other candidates are still checked` line, no whole-pass warning, `#10` kept; the unscreened-pool discrimination test (real `run` exits 2); the screened-out-blocker test; the whole-call-failure-keeps-malformed test; Task 6 malformed-blocker bullet and notes paragraph; Task 7 report line and skill-graph row |
| AC4.3 (a record with an unparseable blocker line, a blocker number above 2147483647, or no entry in the native dependency response is excluded with reason `malformed-blocker`, is not dispatched, and every other record in that pull is still checked; each fault case pinned through the real `run`) | Task 5: the per-fault table (number, body, labels, `Blocked by #0`, `Blocked by #3000000000`), each through the real `run` unscreened (exit 2, or `undetermined`/`not-found` and kept for the 32-bit case) and through the CLI (a `malformed-blocker` entry, absent from the printed pool, `#11` still excluded, `#10` kept); the native-missing test in both gh shapes (exit 0 alias omitted; exit 1 NOT_FOUND, via Task 4's wrapper) with exactly two calls; the never-loops / never-blames test; `malformedRecords`' 32-bit bound test; Task 4's AC4.3 NOT_FOUND-naming test; Task 6 bullet facts; Task 7 report line, cause twin and MCP section (the screen runs without `gh`) |
| AC5.1 (in the claimed case, Settle closes the run's draft PR with its resume command) | Task 2 facts (`Step 2.8: claimed #{n}` key, a continuation of either call, `then step 5's PR tombstone and nothing else of step 5`, the `### Resume` pointer sentence, `gh pr close` the PR), and the pointer-never-counts test; Task 1 row fact for a continuation's held claims; Task 8's continuation clauses (§5 and §6) |
| AC5.2 (a test or conformance check pins that step) | Task 2 `AC5.2` test (step 5's tombstone block — the `run-state.json` `pr` condition, the replaced `printf` sentence and `gh pr close {pr-number}` — still exists, with a removal control) plus the AC5.1 facts' go-red proofs |
| AC6.1 (a second-call handoff continuation that stops at Step 2.7b reports `blocked`, its failure-cards row names that outcome, and its teardown takes the same skip as the first-call path, `two-call-gate.md` §6 as well as §5; a test pins it) | Task 1 row fact (`a second call's handoff continuation … reports \`OUTCOME: blocked\``) and the template-vocabulary twin (`task-prompt.md:499`); Task 2's "continuation of either call" fact; Task 8's §6 paragraph facts, placement and deletion controls, the §8 item 4 route test, the phrase-equality test across §5, §6, Section E and `flags.md`, and Section E's `§5 or §6` fact |
