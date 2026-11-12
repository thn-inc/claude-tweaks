# Queue Pull Module and CLI Implementation Plan

**Goal:** Add `plugin/bin/lib/dispatch/queue-pull.js` (`queuePull`, `PASSES`, `rankNext`) and the thin CLI `plugin/bin/queue-pull.js`. Both produce the same session-scoped files as `/claude-tweaks:dispatch`'s two embedded scripts. A parity test proves it by running the scripts and the module over the same fixtures.

**Architecture:** The module ports `plugin/skills/dispatch/queue-pull-script.md`'s bash fence step for step. Each `node-eval-file.js` block, `gh` or `git` call, and CLI call becomes one step that reads and writes the same session-scoped files, so a failing step leaves exactly the files the shell would leave. The steps are grouped into the ordered `PASSES` registry, and `queuePull` walks it in order. Every remote call, spawn, clock read and temp name goes through `deps`. The parity oracle runs the real fence under bash in a sandbox with PATH shims, runs the module CLI in an identical sandbox, and compares the files.

**Tech Stack:** Node 18+ CommonJS with no npm dependencies (CI runs Node 20). Tests use `node:test`, and the parity oracle runs under bash ≥ 4.

**Spec:** `.claude-tweaks/pipelines/2026-11-12T104256-spec-5227/work/5227-spec.md` (record #5227, in the worktree). Its Deliverables, all 11 Acceptance Criteria, Technical Approach, Gotchas and Non-Goals are binding, except where the "Corrected facts" section below overrides them.

**Scope keywords:** queuePull, rankNext, QueuePullStopped, rankFromFiles, queue-pull-oracle, queue-pull-fixtures

## Global Constraints

### Scope (AC8, Non-Goals)

- The diff touches exactly these files:
  - Created: `plugin/bin/lib/dispatch/queue-pull.js`, `plugin/bin/queue-pull.js`, `tests/bin-lib/dispatch/queue-pull.test.js`, and three test helpers, `tests/bin-lib/dispatch/queue-pull-oracle.js`, `queue-pull-fixtures.js` and `queue-pull-clock-stub.js`.
  - Modified: `docs/plugin-structure.md`.
- **No file under `plugin/skills/` changes.** That includes `queue-pull-script.md`, `next-ranking.md`, `SKILL.md`, `mcp-transport.md`, `queue-pull-notes.md`, `firing-exclusion.md` and the report sub-files. No reason, pass or reordering is added, and `drive.js --budget` is out of scope.
- The module reproduces the scripts, including behavior that looks wrong. A defect found while extracting goes to a ledger row for separate filing and is never fixed here.
- Open records edit the fence. Before each task, run `git -C <worktree> log --oneline -1 -- plugin/skills/dispatch/queue-pull-script.md`. If the fence changed, re-merge it and update the module to match.

### Corrected facts (override the spec)

- **ASSUMPTION 1 is confirmed, with harness changes.** The fence runs whole, with exit 0, in one bash process when the harness provides all of the following:
  - an explicit env: `HOME`, `PWD`, `OLDPWD` and `TMPDIR` in the sandbox, nothing inherited, `CDPATH` unset, and `GIT_CEILING_DIRECTORIES` set to the sandbox root;
  - PATH shims for `gh`, `git` and `mktemp` (macOS `mktemp` ignores `TMPDIR`);
  - a `.git` at the cwd;
  - a pre-minted `.claude-tweaks/pipelines/2026-11-12T110000-dispatch-standalone/` containing `decisions.md` and `staged/`;
  - a FRESH `CLAUDE_CODE_SESSION_ID` and `TMPDIR` for every run, because otherwise the session files leak across runs;
  - `TZ=UTC`;
  - `NODE_OPTIONS=--require <clock stub>`, which reaches every node process;
  - pinned `GIT_AUTHOR_DATE` and `GIT_COMMITTER_DATE`.
- **ASSUMPTION 2 is REVERSED.**
  - The `files` inputs also include `DISPATCH_OPEN_NUMBERS` and `DISPATCH_VERIFIED_OPEN_DEPS`. The agent writes `DISPATCH_CROSSPR_OVERLAP` as `[]`.
  - A missing or malformed in-flight pool FILE or claim-map FILE stops the pull (the oracle exits 1). Fail-open applies only to the `[]` and `{}` values the agent writes itself.
  - A missing or malformed `DISPATCH_FOREIGN_STATES` file excludes each affected record as `owner/name#N (state unreadable)`, with a fail-closed Warning.
  - AC7's fixtures assert the outcome the oracle actually produces, and the module reproduces it (Task 9).
- **Script defects are reproduced, never fixed.** Each one is already on the ledger.
  - **D1:** a stale session file is reused when a later fetch comes back empty. Asserted in Task 9.
  - **D2:** the target-missing proposal is staged with a random `mktemp` extension. The module reproduces this by naming its temp file `tmp.` plus 10 random alphanumerics. D2 is the one normalization beyond the spec's list, and the test header names it (Tasks 4 and 8).
  - **D3:** `aliasMcpTimestamps` silently turns a non-array file into `[]`. Asserted in Tasks 3 and 9.
  - **D4:** a non-JSON claim-map string is read as unreadable content, and no AUTO line is printed. Asserted in Tasks 5 and 9.

### Rulings

- **R1: PATH shims, not shell-function stubs** (Q23 vs Q24; governing-quotes "Conflicts" item 1).
  - The fence starts separate node CLIs: `resolve-linked-prs.js`, `dispatch-unlanded-blockers.js` (which runs `preflight-records.js`), `resolve-blockers.js`, `stage-item.js`, and the claim reader inside a node block. Their own `gh` and `git` calls have to reach the stub, and a shell function cannot reach a child process. So the oracle needs PATH stubs.
  - The sandbox bin holds `gh`, `git`, `mktemp` and a `node` symlink, all written by hand, which Q24 allows for multi-stub wrappers. `installStub` is not used because it mutates `process.env.PATH`, and an explicit-env spawn never reads that.
  - Every bash-oracle test takes the skip value `oracleSkip()`. It returns `'no bash oracle — ' + STUB_SKIP_REASON` on win32 (from `tests/helpers/path-stub.js`), `'no bash oracle (bash >= 4 not found)'` when no bash 4 or later is found, and `false` otherwise.
- **R2: the oracle spawn** (Q25).
  - bash runs `detached`, so it has its own process group, with stdin set to `'ignore'`. At most 64 KiB of each stream is kept, and `ulimit -f 4096` applies.
  - The timeout is 120 s, not 5 s, because one run spawns about 30 node processes. On timeout or driver exit, the harness kills the group with `process.kill(-pid, 'SIGKILL')` and repeats until `ESRCH`.
  - No `ulimit -u` is set. The input is this repo's fixed fence, not fuzzed shapes, and a relative process cap flakes when sibling sessions run.
  - The env is explicit. The only values carried over from the parent are its `NODE_OPTIONS` (placed before `--require <stub>`) and `CT_TRACE_*`, so the test-impact tracer still sees the children (Q-T4.4). Neither carries an escape hazard. If the tracer still records `c ''`, the suite is over-selected, which is accepted.
  - Every run sits inside an escape guard: the real worktree's `HEAD` and `git status --porcelain` are read before and after, and any change fails the run.
- **R3: the oracle shell.** The oracle uses the first bash ≥ 4 found among `/opt/homebrew/bin/bash`, `/usr/local/bin/bash`, `/bin/bash` and `/usr/bin/bash`. On CI Linux that is bash 5.
  - This departs from `shell-scanner-bash-differential`, which uses bash 3.2 and zsh oracles (Q-T2.53, Q-T2.56). Running those would double or triple a matrix of about 70 runs.
  - Per-pass divergence across bash and zsh is already pinned by the existing extract-and-run suites, `tests/dispatch-*-fixture.test.js`.
- **R4: exit codes** (Q17, Q18).
  - The base vocabulary is Split-1/2: 0 for success, 1 for a malformed invocation, and 2 for a missing dependency. Exit 2 means `--transport gh` with `gh` absent, and its message names `--transport files`.
  - Exit 4 means the pull stopped, with the cause on stderr.
  - Exit 3 (a remote failure) stays in the vocabulary but is never produced: every remote failure either takes its pass's fail-open path or ends in a stop, as in the script.
  - The header's decision comment names the caller that branches on 4: the cutover unit's Step 2 prose, which stops and reports on 4 and switches transport on 2. It also names the reopen condition: once the cutover lands, nothing branches on 4.
- **R5: the `files` transport departs from rules (1) and (2) of `.claude/skills/gh-api-module-pattern/cli-wrapper-contract.md` L53.** Both file headers record this.
  - On `files`, the module makes zero `gh` calls and never probes for `gh`.
  - It still spawns the CLIs that the script's MCP path runs as written: `resolve-linked-prs.js`, `resolve-blockers.js` (under native), and `dispatch-unlanded-blockers.js`. Their `gh` calls fail the way `mcp-transport.md` documents.
  - A problem with an input file takes the script's outcome: a stop, or the documented fail-open or fail-closed line. It never becomes exit 1 or 2.
- **R6: step-for-step port.**
  - Each fence step is one function. A throw is caught (Q19) and printed to stderr as `queue-pull: <step>: <message>`. The run then continues or stops exactly where the fence has an RC check or a `grep -q 'appendExclusion:'` check.
  - Stop and Warning texts are copied from the fence byte for byte.
  - The default deps bound every remote call by importing `GH_TIMEOUT_MS`, `GH_BATCH_TIMEOUT_MS`, `GIT_TIMEOUT_MS` and `LARGE_MAX_BUFFER_BYTES` from `plugin/bin/lib/shared-primitives.js` (`gh-api-module-pattern` SKILL.md L31, read). The script's own calls are unbounded, so the module behaves differently only when a call hangs.
- **R7: registry semantics.**
  - Each entry is `{ id, kind, reason, removes, bypass, runsOnCacheHit, failOpen, mcp }`. `id` and `kind` are added beyond the spec's six fields. `kind` is `setup`, `exclusion` or `informational`, and `reason` is `null` unless `kind` is `exclusion`.
  - `failOpen` is the pass's posture when its remote fetch fails. `n/a` means the pass makes no remote fetch.
  - `malformed-blocker` and `unlanded-blocker` share `id: 'blocker-landing'`, because one `dispatch-unlanded-blockers.js` call writes both. The loop runs each id once, at its first entry.
  - `omit` accepts reasons or ids. Omitting a pass removes that reason's filtering and appends and nothing else, so shared steps such as the grouping block still run. Omitting either blocker-landing reason skips the whole call, and omitting a `setup` pass throws `TypeError`.
  - No string array literal leads with `'status'` or holds `'ls-files'` (`bin-source-scan-conformance`, Q-T2.63, read).
- **R8: missing in-flight handoff files stop the pull.** Q-T2.28's "missing handoff file crashes the compute step" row describes what the script does with the in-flight raw and claims files (mcp-transport step 4). The module reproduces it (Non-Goals), and it stays on the ledger.

### Platform, CI, runtime

- CI runs Node 20 on Linux. `windows-regression.yml` covers win32.
  - On win32, every bash-oracle test reports the explicit `no bash oracle` skip.
  - The in-process module fixtures, the `rankNext` table and the CLI tests run on every platform. They use fake runners, never PATH stubs, and build paths with `path.join`.
  - After the last code change, dispatch `windows-regression.yml` on the branch and confirm those tests ran.
- **Runtime budget.**
  - One oracle run spawns about 30 node processes and takes about 2-3 s. One module CLI run spawns about 10-15 and takes about 1 s.
  - The matrix has about 36 pairs. Task 8 adds 12 AC1 runs plus 4 more. Task 9 adds 15 faults, 14 files-input faults and 2 defect runs.
  - Pairs run in an async pool of `Math.max(1, Math.min(4, os.availableParallelism() - 1))` inside each parity `describe`'s `before`, and tests then assert over the stored results. One run serves every assertion made on it: the S1 runs feed AC1, AC2.3, AC3, AC7.1 and the real-writer pins.
  - `queue-pull.test.js` should take 40-60 s on a 4-core runner, or about 150 s serially. Each parity `describe` sets `{ timeout: 600_000 }`. The in-process fixtures finish in under 3 s.

### Guard inventory (Q5)

| Fence conditional | Task: test |
|---|---|
| 500 / 200 / 100 cap Warnings | 3, 5: cap-warning tests (text equals the fence's echo line) |
| `persisted` absent; `cacheUsable` false; `[ -n "$DISPATCH_DEP_NUMBERS" ]` | 3: cache hit / miss |
| `WORK_LINKS = native`; `[ -n "$NATIVE_NUMS" ]`; resolve-blockers failure Warning | 3: native |
| `existsSync` reads (verified-open-deps, shipped-pr-files) become read-and-catch `ENOENT` → `[]` | 3, 4: absent-file cases |
| `grep -q 'appendExclusion:'` decides stop vs Warning | 4: stop vs Warning |
| `[ -n "$DISPATCH_GROUP_NUMS" ]`; linked-PR failure gives Warning + `{}` | 4: open-pr |
| `INTEGRATION_BRANCH` empty falls back to `git remote show origin` | 4: portability; 9: F-intbranch |
| no mentions; `weak` + `predatesClaimRelease`; probe cap 5 | 4: shipped |
| `[ -n "$DISPATCH_FIRING_RUN_DIR" ]` | 4: empty run-dir answer |
| each RC check (cache-hit, grouping, target-missing, shipped, unlanded, neighbour) | 3-5: stop tests; 9: fault parity |

### Governing quotes (verbatim)

These quotes come from `/private/tmp/claude-501/-Users-thomasholknielsen-Code-Workspaces-claude-tweaks/2de9dc65-ffc1-4252-8094-6170efc994f3/scratchpad/governing-quotes.md`. Each keeps that file's heading, its `Section`/`Governs` tag, and its `Source:` path with line range. The `> ` lines are byte-for-byte copies. Where a heading names more than is quoted, the omitted part does not apply: Q25's caps and stub-only-PATH bullets are superseded by R2.

The following rules were read but not quoted, because a scan or a task step already enforces them mechanically:

| Rules | Enforced by |
|---|---|
| Q12, Q13, Q16, Q20 (`ghOptions`, `windowsHide`, `process.exitCode`, path-guard) | The Task 2/3/4/5/7 source-scan step: `gh-host-seam`, `windows-hide-spawn`, `exit-code` and `path-guard` conformance |
| Q15, Q-T2.16 (`run(argv, deps)`, malformed-flag classes) | Task 7's AC9 tests |
| Q19 | R6 |
| Q11 | R6 |
| Q10 rules 1, 3-5, 9 | Reusing `in-flight-neighbours.js` and `aliasMcpTimestamps` unchanged |
| Q27 | Reusing `partitionByOpenBodyBlockers`/`bodyForeignBlockers`/`cacheUsable` unchanged, plus Task 3's foreign-blocker tests |
| Q-T2.1 | `fakeRun` throws on an unhandled argv |
| Q-T2.27, Q-T2.28 | R5, R8 and Task 9 |
| Q6 | The native posture is reproduced unchanged |
| Q8 | No per-driver check exists |
| Q9 | R5 |
| Q14 | The deps defaults |
| Q21, Q22 | No new parser; claims go through `createClaimReader` |
| Q26 | `extractFence` |
| Q-T2.53, Q-T2.55, Q-T2.56 | R3, and test titles that start with `#5227` or an AC id |
| Q-T2.63 | R7 |
| Q-T3.1–Q-T3.3 | Task 7 |
| Q-T4.4 | R2 |

The remaining entries govern shapes this build does not create.

#### Q1 — `appendExclusion` is the one sanctioned writer
**Section:** Overview · **Governs:** F1
Source: `.claude/skills/dispatch-queue-exclusion-addition/SKILL.md` L10

> Each exclusion pass in `plugin/skills/dispatch/queue-pull-script.md` writes `{reason, records, detail}` entries through `plugin/bin/lib/dispatch/exclusions.js`'s `appendExclusion`, the one sanctioned writer (#3110: it refuses a corrupt file rather than clobbering earlier passes' entries). The pass is the easy part. Every selection form, report and doc that names the reasons must learn the new one too, and the earlier additions missed sites: #3084 fixed the `#N` forms misreporting a `not-spec-shaped` record as an open PR, and #3085 restored the shipped-candidate report.

#### Q2 — never `fs.writeFileSync` the exclusions file
**Section:** Anti-Patterns (table row) · **Governs:** F1
Source: `.claude/skills/dispatch-queue-exclusion-addition/SKILL.md` L54

> | Writing the entry with `fs.writeFileSync` instead of `appendExclusion` | It clobbers every earlier pass's entries for this firing (#3110) |

#### Q3 — decisions each pass owes: removing, order, cache hit, fail open vs stop, screening
**Section:** Decisions each pass owes · **Governs:** F1 (the `PASSES` registry order and per-pass posture), F3 (per-reason fixtures)
Source: `.claude/skills/dispatch-queue-exclusion-addition/SKILL.md` L28-32

> 1. **Removing or not?** A removing reason drops the record from `dispatch-groups.json` before any selection form reads it, so even a named `#N` cannot dispatch it. `oversized` and `neighbour-in-flight` stay in the file and only bare drain's ranking skips them, because a person naming the record accepts that risk. Choose removing only when no one could accept the risk, because a later gate would stop the record anyway after a claim and a spent retry.
> 2. **Where in the order?** Run a pure pass (no `gh`, such as `not-spec-shaped`) before the `gh`-backed probes, so an excluded candidate costs none of their calls. A pass that judges the remaining pool goes after the passes whose exclusions it should not re-check.
> 3. **Cache hit too?** Run the pass on a queue-order cache hit when the state it reads can change without touching the records' `updatedAt` (an open PR, a blocker's commit landing). Skipping it there brings back the bug the pass exists to fix. A pass whose verdict a hit replays instead of re-running needs the cache to miss whenever its inputs carry such state: the `blocked` pass reads foreign blocker states the freshness signal cannot see, so `cacheUsable` in `plugin/bin/lib/dispatch/queue-order.js` refuses a hit while any `auto:build` body declares a `Blocked by owner/name#N` line or a persisted exclusion names a foreign blocker (#4793).
> 4. **Fail open or stop?** A pass whose judgment a later gate repeats before any claim (`/flow` Step 2.7b re-checks blocker landing) fails open with one `Warning:` or `AUTO` line. Only a refused `appendExclusion` write or an unreadable `$DISPATCH_GROUPS` stops the pull.
> 5. **Can one record turn the pass off?** When the pass batches every candidate into one call that fails as a whole on a single bad input, screen that input out under its own reason first (#4792's `malformed-blocker`). See `gh-api-module-pattern`'s `batching-failure-posture.md`.

#### Q4 — the parity test must run one table through both the snippet and the module, reaching every branch
**Section:** Anti-Patterns (table row) · **Governs:** F3 (PARITY test), F1
Source: `.claude/skills/prose-code-twin-pin/SKILL.md` L362

> | Accepting an extract-and-run test of a reference snippet as its pin when a `bin/` function implements the same rule | Running the snippet proves it executes, not that it agrees with the code, so a rule changed on one side leaves both suites green. `_shared/run-dir-resolution.md`'s "Bash snippet (resolution)" is the reference implementation that `bin/lib/hooks/run-dir-resolve.js` mirrors. #3865 narrowed `newestMatch` from a substring to a whole-segment slug match (`hasSegment`), and the snippet's Step-2 `find -name "*${SPEC_SLUG}*"` glob stayed a substring match with every suite green. The build deferred the snippet to its ledger, and `/claude-tweaks:review` then fixed it and found `wrap-up/merge-mode.md` still calling `--spec-slug` a substring match. The pair is still unpinned: `tests/pipeline-run-dir-adoption-anchoring.test.js` runs the extracted snippet and `tests/hooks-run-dir-resolve.test.js` calls `resolve()`, each over its own fixtures. The pin is one table of directory names and slugs run through both (`runResolutionWith(extractSnippet(), …)` and `resolve(…)`), asserting the same basename. Leave out of the table the cases where the code diverges on purpose (the dead-candidate skip, #1962) and name them in the test. The table has to reach every branch the snippet carries, not only Step 2: `runResolutionWith` hardcodes `MODE: ''` and `STANDALONE_SKILL: ''`, so the step-4 standalone mint never runs. #4807 stopped `resolve({ standalone })` doubling a trailing `-standalone`, and the snippet kept doubling it with every suite green until a review commit aligned it by hand (`caa61fbd6`). Add standalone-name rows (`backlog`, `backlog-standalone`, bare `standalone`) run with `MODE=auto` against `resolve({ standalone, create: true })`. When either side changes, also grep the flag or function name across `plugin/skills/` and `docs/` for sentences that restate the old rule |

#### Q5 — a CLI that replaces a prose procedure inherits every guard the reader's view enforced
**Section:** The CLI wrapper contract · **Governs:** F1, F2, F3
Source: `.claude/skills/gh-api-module-pattern/cli-wrapper-contract.md` L54

> - **A CLI that replaces a prose procedure inherits every guard the reader's view of the data used to enforce — inventory them before writing it.** `plugin/bin/pr-checklist.js` (#3263) took over the PR phase-checklist flip. The prose it replaced removed a skipped phase's row only "if present and still unchecked", a condition the agent met by reading the body; on the CLI path the agent never sees the body, so the first `--remove` deleted an already-checked row (found at the whole-branch review, fixed in `plugin/bin/lib/flow/pr-checklist.js` with a test that pins a checked row surviving `--remove`). The spec's acceptance criteria had not named the guard. Before the first line of the CLI, list each conditional the prose leaves to what the reader could see ("if present", "still unchecked", "when nothing changed"), give each its own branch and its own status value in the envelope, and add a test per branch.

#### Q7 — an outcome on a two-transport seam is specified and tested per transport
**Section:** The injectable runner · **Governs:** F1 (`gh` and `files` transports), F3
Source: `.claude/skills/gh-api-module-pattern/SKILL.md` L44

> - **An outcome added to a seam with two transports is specified and tested per transport; an "X holds on the git transport only" deviation needs proof the other leg cannot reach it.** #4495's branchless-remote outcome was first scoped to the git leg, and the contents-API leg of `plugin/bin/lib/release-claim/release.js` read a branchless remote as a plain absent claim and posted a false "Released by run" comment, found by six review lenses. `readClaimBlob` now probes `claimsBranchExists` whenever the read was not git-sourced. Write one test per leg, each asserting the comment-and-label side effects as well as the return value, before accepting a one-transport carve-out in a build deviation.

#### Q17 — the exit-code vocabularies (Split-1/2 is F2's base); never mix them
**Section:** The CLI wrapper contract · **Governs:** F2. (The *Sanctioned-writer* and *Payload-1/Invocation-2* sub-bullets, lines 12-13, are left out: F2 is not in those families.)
Source: `.claude/skills/gh-api-module-pattern/cli-wrapper-contract.md` L9-11

> - Exit codes are a documented contract, and this repo ships **four** base vocabularies — pick the one the CLI's sibling and its consuming prose already use, then spell it out in the file's header comment and `USAGE`:
>   - *Combined-2* (`plugin/bin/link-records.js`): 0 success or partial-with-`failed`, 1 upstream resolution failure, 2 malformed invocation **or** missing dependency.
>   - *Split-1/2* (`plugin/bin/resolve-blockers.js`, `plugin/bin/fetch-sub-issues.js`): 0 success, 1 malformed invocation, 2 missing dependency or unresolvable owner/repo, 3 the remote call itself failed.

Source: `.claude/skills/gh-api-module-pattern/cli-wrapper-contract.md` L15

>   Never mix them inside one family: a caller that branches on a sibling's codes reads the wrong branch silently.

#### Q18 — codes above the base vocabulary are per-CLI and must be spelled out; a new code needs a caller that branches on it
**Section:** The CLI wrapper contract · **Governs:** F2 (exit 4 "pull stopped")
Source: `.claude/skills/gh-api-module-pattern/cli-wrapper-contract.md` L24-25

> - **Codes above the base vocabulary are per-CLI domain outcomes and are not portable.** `plugin/bin/claim-targets.js` ships 3 (contested or in-flight), 4 (transient `gh` failure), 5 (unverified write), 6 (claims branch uncreatable) and 7 (claim permission denied), branched on by `plugin/skills/flow/claim-targets.md` Step 2.8; `plugin/bin/fetch-sub-issues.js` ships 4 for "the capability probe says the GraphQL field is unavailable — take the documented fallback". Spell each one out in that CLI's own `USAGE` and in the prose that branches on it; never assume a number carries its meaning across CLIs.
> - **The inverse decision needs the same evidence: a domain outcome no caller can act on differently stays on the base code, overloaded and documented.** A new code is earned by a caller that *branches* on it (the bullet above: `claim-targets.js`'s 3-7, branched on by `plugin/skills/flow/claim-targets.md` Step 2.8; `fetch-sub-issues.js`'s 4), not by the outcome being conceptually distinct — so "this is really two different failures" is not by itself a reason to allocate a fourth number. `plugin/bin/lib/compose-subject.js` (#2319) keeps *Split-1/2*'s exit 1 deliberately overloaded across a malformed invocation **and** an uncomposable record, because every merge site that calls it treats every non-zero exit identically and stops before any merge; splitting them would mean editing every one of those fences for a distinction nothing reads. The header's decision comment is where that call-site inventory lives (it has moved once already, when #4073 folded four local-merge fences into `_shared/local-merge-sequence.md`), so read it there rather than counting sites here. Say so in the file's header comment beside the vocabulary, with the condition that would reopen it (compose-subject.js names its own: a caller that needs to park a shaping defect differently from reporting a bad call), so the next reader finds a decision rather than re-filing it as a missing code.

#### Q23 — a fence that calls `gh` runs against a shell-function stub, not a PATH shim (conflicts with the task's "PATH shims")
**Section:** Binding an executable snippet to a test · **Governs:** F3
Source: `.claude/skills/skill-prose-conformance-tests/executable-snippet-pins.md` L31

> **A fence that calls `gh` runs against a shell-function stub, not a PATH shim.** Prepend a `gh() { … }` definition to the extracted fence inside the same `bash -c`. The function shadows the binary, so no network is touched and no stub file has to sit on `PATH`. Dispatch on `"$*"` to serve one fixture per call, and pass the fixture paths through the spawn env, forward-slashed, never into the script text. `runClosedFence` in `tests/acceptance-scan-server-filter.test.js` (#4598) is the instance: `gh() { case "$*" in *'closed:>'*) cat "$FAKE_NEW" ;; *) cat "$FAKE_OLD" ;; esac; }` serves the newer date slice to the call whose `--search` carries `closed:>` and the older slice to the other. #4598's review found that fence pinned only by regex and by single guard lines run through `new Function`. Running the whole extracted fence this way is what exercised the slice wiring, the per-slice cap at 999 and 1000 rows, and the number-keyed merge. Keep the expression variant for a fence whose correctness depends on what `gh` itself does (exit codes, pagination, search semantics), which a fixture would only fake.

#### Q24 — a `#!/bin/sh` `gh` stub on PATH skips with `STUB_SKIP` from `tests/helpers/path-stub.js`
**Section:** Anti-Patterns (table row) · **Governs:** F3
Source: `.claude/skills/windows-checkout-test-parity/SKILL.md` L183

> | A test that puts a `#!/bin/sh` script named `gh` on `PATH` to fake the CLI | `execFileSync('gh')` never spawns an extensionless script on win32, so the test fails there for a reason that has nothing to do with the code under test. A test that writes such a stub skips with `{ skip: STUB_SKIP }` from `tests/helpers/path-stub.js` (#4285), not with a per-file constant, and a new single-stub test installs it with that file's `installStub`. The multi-stub `gh` wrappers in `pr-state`, `release-merged` and `archive-merged` (`tests/bin-lib/reconcile/`) still write theirs by hand; they carry `STUB_SKIP` all the same. A test that needs a `PATH` holding only real binaries (`git` but not `gh`) builds it with `pathWithOnly` from the same helper, and keeps running on Windows. Leave the tests that remove `gh` from `PATH` running: they pass on Windows. `tests/path-stub-helper.test.js` keeps `:`-joined PATHs out of `tests/`: join with `path.delimiter`. Judge each test by whether it writes a stub and whether its assertion depends on the stub running, not by its title |

#### Q25 — the bounded bash verdict: caps, process group, timeout, stdin, stub-only PATH, no inherited env
**Section:** Bounded bash verdict; Anti-Patterns · **Governs:** F3 (the bash oracle)
Source: `.claude/skills/shell-scanner-bash-differential/SKILL.md` L103-108

> - **Process group, timeout, kills:** bash runs as its own process group with a 5 s timeout. The group is reaped in these cases: on timeout, 300 ms after bash exits (so a backgrounded writer has opened its target), on a spawn error, and on driver exit or SIGTERM/SIGINT/SIGHUP. Reaping means stop, then kill, repeated until the kernel reports the group empty. A single SIGKILL races a group that keeps forking: in 11 of 60 trials here it left 44 to 167 members of such a group alive (#4716). On macOS, `kill` on a group of zombies only fails with EPERM, which counts as empty. A group still alive after 2 s rejects the run with `SURVIVORS:`.
> - **Stdin and output:** stdin is closed, and at most 64 KiB of each stream is kept.
> - **Environment and escape check:** a spawn's `cwd` does not keep a case in its scratch tree. bash 5's `cd -` reads an imported OLDPWD (3.2 ignores it), a bare `cd` and `~` read HOME, `cd sub` searches CDPATH, BASH_ENV runs a file before the command, and git finds a repo by climbing from the cwd. So the child gets no inherited environment: only PATH, OLDPWD and PWD pinned to `cwd`, HOME pinned to `root` (the scratch tree, which must contain `cwd`), and GIT_CEILING_DIRECTORIES set to `root`'s parent. When `guardRepo` names the real checkout, its HEAD and `git status --porcelain` are read before and after each run, and any change rejects the run. After a fuzz run, check `git log <fix-base>..HEAD` for foreign authors too.

Source: `.claude/skills/shell-scanner-bash-differential/SKILL.md` L320

> | Spawning the oracle with `{ ...process.env }` and only PATH replaced | #4303 round 5: fuzz seed 99's `(cd - && git commit -qm "work on #12")` ran under bash 5 in the session's worktree, which the imported OLDPWD named, and put four empty commits on the live branch |

#### Q28 — preserve `firing` entries across re-pulls; a persisted consumer (the queue-order cache) keeps its own schema, converted at the boundary
**Section:** Variant: consolidating runtime sidecar files, not prose · **Governs:** F1
Source: `.claude/skills/shared-contract-extraction/SKILL.md` L58-59

> - **The file boundary was carrying lifecycle differences for free — re-encode them explicitly.** Separate files can have separate lifetimes without anyone deciding so; one merged file cannot. Five of dispatch's reasons are recomputed on every re-pull, while `firing` entries are appended *between* re-runs within one firing (`firing-exclusion.md`) and must survive them — so `queue-pull-script.md` now opens with an explicit truncate-preserving-`firing` step. Omitting it would have silently restored the infinite re-dispatch loop that file exists to prevent. Enumerate each merged input's reset cadence before writing the reset step, and pin the preserved class (`tests/bin-lib/dispatch/exclusions.test.js`). The shipped analog one level up is `wrap-up/cleanup-procedures-execution.md`'s carve-out of `score-history.jsonl` from a bulk cleanup.
> - **A persisted consumer keeps its own schema; convert at the boundary and say so there.** Not every reader of the old shape is in scope. The queue-order disk cache (`bin/lib/dispatch/queue-order.js`) keeps its pre-#1752 `{number, blockedBy}[]` `excluded` field, and `queue-pull-script.md` converts in both directions at exactly the two points the schemas meet — cache-hit materialization and write-back — each with a comment saying that is what it is. Migrating the persisted blob instead would have invalidated every existing cache, for a file that is rebuilt from scratch on every miss anyway.

## Review Focus

1. **A foreign blocker on `gh`.** A `Blocked by owner/name#N` line sends `bodyForeignBlockers` through `gh`, so `cacheUsable` must miss. The record is held, with one Warning when its state is unreadable. Tests: the Task 3 foreign-blocker cases and S2 in Task 8.
2. **No session id.** With `CLAUDE_CODE_SESSION_ID` unset, paths fall back to `os.tmpdir()/<name>`, and the CLI must write those same paths. Test: Task 2 `sessionPaths fallback`.
3. **The integration branch cannot be resolved.** With no policy key and a failing `git remote show origin`, every named-target candidate is checked against `origin/` and excluded. That is the script's behavior. It is reproduced here and is a ledger candidate. Test: Task 9 F-intbranch.
4. **A pull exactly at its `--limit` cap** (500, 200 or 100) produces the same cap Warning text as the script. Tests: Tasks 3 and 5.
5. **MCP-shaped records on `files`**, meaning `labels` as `[{name}]`, lowercase `state` and snake_case timestamps, get the same verdicts as the gh shape. Tests: Task 8's files configs use the MCP shape, and Task 3 asserts the in-place aliasing.

---

## Interfaces (shared by every task)

`plugin/bin/lib/dispatch/queue-pull.js` exports:

```js
PASSES                 // deep-frozen array; position = run position (table below)
PASS_FIELD_VALUES      // { kind, failOpen: ['open','stop','n/a'], mcp: ['same','skipped-empty','fails-open','agent-fetched'] }
SESSION_FILES          // the fence's 26 --value names in fence order, then 'dispatch-next-pick.json'
sessionPaths(sessionId) -> { [name]: absPath }  // sessionTmpPath(id, name) || path.join(os.tmpdir(), name)
class QueuePullStopped extends Error            // .line = the exact 'dispatch: queue-pull stopped -- …' text printed
runPasses(passes, ctx) -> void                  // walks a registry in array order (exported for the order test)
queuePull(options, deps) -> { groups, exclusions }   // throws QueuePullStopped on a stop
rankNext(groups, exclusionEntries, { priority } = {}) -> group | null
rankFromFiles({ sessionId, priority }, deps) -> group | null  // writes dispatch-next-pick.json
defaultDeps() -> deps
```

- `options` is `{ transport: 'gh'|'files', sessionId, cwd, env, inputs: { queueRaw, depFreshness, openNumbers, verifiedOpenDeps, inFlightRaw, inFlightClaims, foreignStates }, omit: [] }`.
  - `inputs` is read only on the `files` transport. Each input defaults to its session path, and `foreignStates` defaults to `env.DISPATCH_FOREIGN_STATES`.
- `deps`:
  - `run(cmd, args, opts) -> stdout` runs `gh` or `git` and throws `{status, stdout, stderr}` on failure. The default uses `execFileSync`, with `gh` wrapped in `ghOptions` and `windowsHide: true` written literally at each call site.
  - `spawnCli(name, args, { input }) -> { status, stdout, stderr }` is `spawnSync(process.execPath, [path.join(BIN_DIR, name), ...args], { windowsHide: true, … })`.
  - `stdout`, `stderr`, `now() -> Date`, and `tmpName()`, which returns `<os.tmpdir()>/tmp.<10 alnum>` (D2).
  - `sleep`, `queueOrder: { readOrder, writeOrder }`, `createClaimReader`, `expressQueuePolicy`, `foreignDeps`, and an optional `onPass(id)`.

`PASSES` values are seeds. Task 9 asserts `failOpen` against the oracle. If they differ, change the row here and in the module, never the oracle.

| # | id | kind | reason | removes | bypass | runsOnCacheHit | failOpen | mcp |
|---|---|---|---|---|---|---|---|---|
| 1 | truncate | setup | null | false | false | true | n/a | same |
| 2 | fetch | setup | null | false | false | true | stop | agent-fetched |
| 3 | blocked | exclusion | blocked | true | false | true | open | agent-fetched |
| 4 | oversized | exclusion | oversized | false | true | true | n/a | same |
| 5 | write-back | setup | null | false | false | false | open | same |
| 6 | not-spec-shaped | exclusion | not-spec-shaped | true | false | true | n/a | same |
| 7 | open-pr | exclusion | open-pr | true | false | true | open | fails-open |
| 8 | target-missing | exclusion | target-missing | true | false | true | n/a | same |
| 9 | shipped | exclusion | shipped | true | false | true | open | skipped-empty |
| 10 | blocker-landing | exclusion | malformed-blocker | true | false | true | n/a | same |
| 11 | blocker-landing | exclusion | unlanded-blocker | true | false | true | open | fails-open |
| 12 | neighbour-in-flight | exclusion | neighbour-in-flight | false | true | true | open | agent-fetched |
| 13 | cross-pr-overlap | informational | null | false | false | true | open | skipped-empty |
| 14 | near-dup-pairs | informational | null | false | false | true | n/a | same |

Which fence lines each pass owns:

- `fetch`: lines 71-151, covering the queue pull, aliasing, the 500-cap Warning, dependency freshness and the cache check. On a cache miss it also owns line 155's open-numbers pull.
- `blocked`: lines 159-205 on a miss. On a hit it replays `persisted.excluded`.
- `oversized`: the grouping block, lines 206-258. It writes the groups, then the bundles, then the `blocked` appends, then the `oversized` appends. On a hit it runs the size guard over the persisted groups and keeps the persisted bundles.
- `write-back`: lines 266-303.
- Every other pass follows the fence's comments in order.

`plugin/bin/queue-pull.js` usage:

```text
queue-pull.js --transport gh|files [--queue-raw <p>] [--dep-freshness <p>] [--open-numbers <p>]
              [--verified-open-deps <p>] [--in-flight-raw <p>] [--in-flight-claims <p>] [--foreign-states <p>]
queue-pull.js --rank [--priority high|medium|low]
queue-pull.js --help
```

- `run(argv, deps) -> exitCode`, where deps is `{ env, cwd, ghAvailable, queuePull, rankFromFiles, stdout, stderr }`.
- The input-path flags are valid only with `--transport files`.
- The session id comes from `env.CLAUDE_CODE_SESSION_ID`.

Test helpers, all committed under `tests/bin-lib/dispatch/`:

- `queue-pull-oracle.js`:
  - `oracleSkip(platform = process.platform, bash = findBash())` and `findBash()`.
  - `extractFence(mdText, firstLine)` returns the ```` ```bash ```` block whose first line equals `firstLine`. It splits on `/\r?\n/` and throws `anchor not found` when no fence matches.
  - `createSandbox(scenario, { transport, origin })`, `runOracle(sandbox, script)`, `runModuleCli(sandbox, argv)` and `withEscapeGuard(repoRoot, fn)`.
  - `normalize`, `reported`, `assertParity(a, b, { files })` and `runAll(jobs, limit)`.
  - `filesOracleScript(fence, mcpText)` and `runPair(cfg) -> { oracle, module }`, both added in Task 8. `runPair` builds two sandboxes from one scenario: it runs the oracle in one and `runModuleCli` in the other, giving each its own origin copy and the same staged inputs.
- `queue-pull-fixtures.js`:
  - The scenario builders `S0`, `S1`, `S2`, `SEmpty`, `SMalformed` and `SPortable`, plus the fault overlays.
  - `fakeRun(scenario)`, `fakeSpawnCli(scenario)` and `shimTable(scenario)`.
  - The shims and `fakeRun` both answer from one `scenario.gh` list. Each entry is either an exact argv or `{ graphql: 'linked'|'native'|'landing'|'foreign', aliases }`. An unmatched call fails on both sides: the shim exits 97, and the fake throws `'unexpected gh ' + args.join(' ')` (Q-T2.1).
- `queue-pull-clock-stub.js` freezes `Date` and `Date.now` at `2026-11-12T12:00:00.000Z`.

Comparison rules:

- A run returns `{ status, stdout, stderr, files, staged, decisions, orderBlob, ghArgv, gitArgv }`.
- `reported(text)` keeps the lines matching `/^(AUTO — dispatch: |- AUTO \d{2}:\d{2}:\d{2} — |Warning: |dispatch: queue-pull stopped -- |Queue-order cache |express-lane: |resolve-policy: )/`. These are the AUTO and Warning lines that AC1 compares on each channel.
- `normalize` makes exactly three substitutions:
  - the sandbox root becomes `<SCR>`;
  - the run-dir basename becomes `<RUN>`;
  - the D2 suffix `dispatch-target-missing-<N>.<10 alnum>` becomes `.<mktemp>`.
  The clock is frozen by the stub, not normalized.

---

### Task 1: Oracle harness — the fence runs whole in a sandbox

**Role:** judgment
**Review risk:** high

**Files:**
- Create: `tests/bin-lib/dispatch/queue-pull-oracle.js`
- Create: `tests/bin-lib/dispatch/queue-pull-fixtures.js`
- Create: `tests/bin-lib/dispatch/queue-pull-clock-stub.js`
- Create: `tests/bin-lib/dispatch/queue-pull.test.js`
- Reference only (uncommitted; never cite these paths in code): `/private/tmp/claude-501/-Users-thomasholknielsen-Code-Workspaces-claude-tweaks/2de9dc65-ffc1-4252-8094-6170efc994f3/scratchpad/oracle-probe/harness/`, which holds `run.js`, `gh-shim.js`, `git-shim.js` and `clock-stub.js`, and `…/scratchpad/assumption-probe-report.md`

**Interfaces:**
- Consumes: `tests/helpers/path-stub.js` (`STUB_SKIP_REASON`), `tests/helpers/read-skill.js` (`readText`), `tests/helpers/git-fixtures.js` (`fixtureGit`).
- Produces: every `queue-pull-oracle.js` export except `filesOracleScript` and `runModuleCli`, plus `S0`, `fakeRun` and `shimTable`.

The sandbox follows the probe design:

- The root holds `home`, `tmp`, `proj`, `bin` and `logs`.
- `proj/.claude-tweaks/policy.yml` is built from `scenario.policy`.
- `proj` is a real git repo whose `origin` is `<root>/origin.git`. The origin is seeded from `scenario.origin.branches`: it always has `main`, has `claims-registry` when a claim is fixtured, and never has `health-state` at the start.
- The run dir is pre-minted.
- `bin/` holds:
  - `gh`: a node script with an absolute `#!<process.execPath>` shebang. It answers from `QP_SHIM_TABLE`, logs each argv to `logs/gh-argv.jsonl`, and applies the `effect`s `corrupt-exclusions`, `corrupt-groups` and `delete-session-file:<name>`. It never calls the real gh. On a miss it exits 97 with `gh-shim: no canned response for: …`.
  - `git`: runs the real git (absolute path resolved at harness start) only when the realpath of the cwd and of every `-C` lies under `<root>`. It refuses when `GIT_DIR` or `GIT_WORK_TREE` is set. It answers `remote get-url origin` with `scenario.remoteUrl`, defaulting to `https://github.com/fixture-owner/fixture-repo.git`, fails the argv prefixes listed in `scenario.gitFail`, and logs every call.
  - `mktemp`: with no args it runs `exec /usr/bin/mktemp "$TMPDIR/tmp.XXXXXXXXXX"`, and it refuses any args.
  - `node`: a symlink.
- Env (R2):
  - `PATH=<bin>:/usr/bin:/bin`, `TMPDIR=<root>/tmp/<fresh>`, `TZ=UTC` and `LANG=C`.
  - `CLAUDE_PLUGIN_ROOT=<worktree>/plugin`, forward-slashed.
  - `CLAUDE_CODE_SESSION_ID=qp-<random>`.
  - The git isolation set: `GIT_CEILING_DIRECTORIES`, `GIT_CONFIG_NOSYSTEM=1`, `GIT_CONFIG_GLOBAL`, and `GIT_AUTHOR_DATE`/`GIT_COMMITTER_DATE` set to `2026-11-12T12:00:00Z`.
  - `QP_SHIM_TABLE`, `QP_LOG_DIR` and `NODE_OPTIONS`.

- [ ] **Step 1: Write the failing tests** in `queue-pull.test.js`:

```js
test('#5227 oracle: queue-pull-script.md runs whole over a one-record fixture', { skip: oracleSkip() }, async () => {
  const r = await withEscapeGuard(REPO, () => runOracle(createSandbox(S0()), FENCE));
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.files['dispatch-groups.json']).flat().map((c) => c.number), [9001]);
  assert.deepEqual(JSON.parse(r.files['dispatch-exclusions.json']), []);
  assert.equal(r.ghArgv.filter((a) => a.tag === 'UNHANDLED').length, 0);
});
test('#5227 oracle: an unmatched gh call fails loudly (go-red control for the shim table)', { skip: oracleSkip() }, async () => {
  const s = S0(); s.gh = s.gh.filter((e) => !(Array.isArray(e.argv) && e.argv.includes('number') && e.argv.includes('200')));
  const r = await runOracle(createSandbox(s), FENCE);
  assert.match(r.stderr, /gh-shim: no canned response for: issue list --state open --json number --limit 200/);
});
test('#5227 oracle: oracleSkip names "no bash oracle" on win32 and without bash >= 4', () => {
  assert.match(oracleSkip('win32', '/bin/bash'), /no bash oracle/);
  assert.match(oracleSkip('linux', null), /no bash oracle/);
  assert.equal(oracleSkip('linux', '/bin/bash'), false);
});
test('#5227 oracle: extractFence anchors on the fence first line and reads CRLF text', () => {
  const lf = readText(SCRIPT_MD);
  assert.equal(extractFence(lf.replace(/\n/g, '\r\n'), FENCE_FIRST_LINE), extractFence(lf, FENCE_FIRST_LINE));
  assert.throws(() => extractFence(lf, 'NOT_A_LINE'), /anchor not found/);
});
```

- `FENCE_FIRST_LINE` is the fence's line 18: `DISPATCH_QUEUE_RAW="$(node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" --value dispatch-queue-raw.json)"`.
- `S0` is a single spec-shaped `auto:build` record, #9001.
- Build S0's table by running the oracle against an empty table, then adding one answer per `UNHANDLED` argv until none remain. The argv list in the probe report is the expected end state.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test --test-name-pattern="#5227 oracle" tests/bin-lib/dispatch/queue-pull.test.js`
Expected: FAIL (`Cannot find module './queue-pull-oracle'`)

- [ ] **Step 3: Implement** the three helpers.
  - The oracle spawns `spawn(bash, ['--noprofile', '--norc', '-c', 'ulimit -f 4096; exec "$0" --noprofile --norc "$1"', bash, scriptFile], { cwd: proj, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] })`.
  - `files` reads every `SESSION_FILES` name from the session dir, with `null` for an absent file.
  - `orderBlob` is the parsed output of `git -C <origin.git> show health-state:queue-order/order.json`, or `null`.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test --test-name-pattern="#5227 oracle" tests/bin-lib/dispatch/queue-pull.test.js`
Expected: PASS (4 tests). Without bash ≥ 4, three of them SKIP with `no bash oracle`.

- [ ] **Step 5: Commit**

```bash
git add tests/bin-lib/dispatch/queue-pull-oracle.js tests/bin-lib/dispatch/queue-pull-fixtures.js tests/bin-lib/dispatch/queue-pull-clock-stub.js tests/bin-lib/dispatch/queue-pull.test.js
git commit -m "Add queue-pull bash oracle harness — sandboxed whole-fence runs under PATH shims (#5227)

Claude-Session: https://claude.ai/code/session_01UwjosEusBiNWBiJFRWNNmQ"
```

---

### Task 2: `PASSES` registry, session paths, truncate pass, `queuePull` loop

**Role:** integration

**Files:**
- Create: `plugin/bin/lib/dispatch/queue-pull.js`
- Modify: `tests/bin-lib/dispatch/queue-pull.test.js`

**Interfaces:**
- Consumes: `exclusions.js` (`readExclusions`, `appendExclusion`) and `session-tmp.js` (`sessionTmpPath`).
- Produces: `PASSES`, `PASS_FIELD_VALUES`, `SESSION_FILES`, `sessionPaths`, `QueuePullStopped`, `runPasses`, `defaultDeps`, and `queuePull` with only the truncate pass implemented. Any pass that has no runner yet throws `queue-pull: pass not implemented: <id>`.

- [ ] **Step 1: Write the failing tests**

```js
// One assertion function serves the positive test and the go-red controls (Go-red control check).
function assertRegistryMatchesBullets(passes, scriptText) {
  const bullets = scriptText.split(/\r?\n/).map((l) => ({ l, m: l.match(/^- `reason: '([a-z-]+)'`/) })).filter((x) => x.m);
  assert.ok(bullets.length >= 9, 'header bullet pattern no longer matches queue-pull-script.md');
  assert.deepEqual([...new Set(passes.map((p) => p.reason).filter(Boolean))].sort(), bullets.map((b) => b.m[1]).sort());
  for (const { l, m } of bullets) assert.equal(passes.find((p) => p.reason === m[1]).removes, !l.includes('stay IN `dispatch-groups.json`'), m[1]);
}
test('AC11.1: the set of reasons in PASSES equals the script header bullets, plus nothing', () => assertRegistryMatchesBullets(PASSES, SCRIPT_TEXT));
test('AC11.1 go-red: a reason missing from either side fails', () => {
  assert.throws(() => assertRegistryMatchesBullets(PASSES.filter((p) => p.reason !== 'shipped'), SCRIPT_TEXT));
  assert.throws(() => assertRegistryMatchesBullets(PASSES, SCRIPT_TEXT.replace(/^- `reason: 'shipped'`.*$/m, '')));
});
test('AC11.1: runPasses walks a registry in array order and runs a shared id once', () => { /* reversed PASSES copy, stub runners via ctx, onPass order = unique ids of the reversed copy */ });
test('AC11.2: every registry field has a fixed value set', () => { /* booleans; kind/failOpen/mcp ⊆ PASS_FIELD_VALUES; reason null iff kind !== 'exclusion'; ids unique except blocker-landing */ });
test('#5227 truncate keeps only firing entries (Q28)', () => { /* real appendExclusion writes firing+blocked+oversized → runPasses([truncate]) → only the firing entry */ });
test('#5227 SESSION_FILES equals the fence --value list in fence order', () => {});
test('#5227 sessionPaths fallback: no session id gives path.join(os.tmpdir(), name)', () => {});
test('#5227 omit: unknown reason or a setup pass throws TypeError; malformed-blocker maps to blocker-landing', () => {});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test --test-name-pattern="AC11|truncate keeps|SESSION_FILES|sessionPaths|omit:" tests/bin-lib/dispatch/queue-pull.test.js`
Expected: FAIL (`Cannot find module '../../../plugin/bin/lib/dispatch/queue-pull'`)

- [ ] **Step 3: Implement** the exports above.
  - The header comment names the fence being ported, R6 and R7.
  - The truncate runner reproduces fence lines 50-55 exactly. As in the fence, it is the only direct write to the exclusions file.
  - `ghOptions` comes from `../repo-resolve`.
  - Existence checks use `../path-guard`'s `lstatType`, never `fs.existsSync`.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test --test-name-pattern="AC11|truncate keeps|SESSION_FILES|sessionPaths|omit:" tests/bin-lib/dispatch/queue-pull.test.js`
Expected: PASS

- [ ] **Step 5: Run the source scans**

Run: `node --test tests/windows-hide-spawn-conformance.test.js tests/gh-host-seam-conformance.test.js tests/path-guard-conformance.test.js tests/git-status-optional-locks.test.js tests/git-path-read-conformance.test.js tests/bin-lib/exit-code-conformance.test.js`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add plugin/bin/lib/dispatch/queue-pull.js tests/bin-lib/dispatch/queue-pull.test.js
git commit -m "Add queue-pull PASSES registry and pass loop — truncate keeps firing entries (#5227)

Claude-Session: https://claude.ai/code/session_01UwjosEusBiNWBiJFRWNNmQ"
```

---

### Task 3: fetch, blocked, oversized (grouping) and write-back passes, both transports

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/dispatch/queue-pull.js`
- Modify: `tests/bin-lib/dispatch/queue-pull.test.js`
- Modify: `tests/bin-lib/dispatch/queue-pull-fixtures.js` (S1 #9001-#9003, `fakeSpawnCli`)

**Interfaces:**
- Consumes: Task 2's loop and deps.
- Produces: the runners for `fetch`, `blocked`, `oversized` and `write-back`.
  - Policy is read with `deps.spawnCli('resolve-policy.js', ['--values', key])`, using the fence's keys in the fence's order: `dispatch-group-size-guard` (also read before the cache check), then `work-links`, then `dispatch-fastlane-bundle-cap`. Its stderr is forwarded.

- [ ] **Step 1: Write the failing tests.** All of them run in-process with `fakeRun(S1)`, `fakeSpawnCli(S1)`, a fake `queueOrder` store that records the blobs written to it, and a fixed `now`. Each reason has one assertion function, and both its positive run and its omitted run go through that function; the omitted run must make it throw.
  - `AC2.1 blocked`: #9002 is `Blocked by` #8000, which is open. It gets `{reason:'blocked', records:[9002], detail:{blockedBy:[8000]}}` and leaves the groups. With `omit:['blocked']` it stays in the groups and no entry is written.
  - `AC2.2 oversized`: with a guard of 2, three fast-lane singletons bundle into one group. That group stays in `dispatch-groups.json` with `{size:3, threshold:2}`, and `dispatch-fastlane-bundles.json` names the bundle. With `omit`, no entry is written.
  - `#5227 native`: `work-links native` spawns `resolve-blockers.js "<numbers>"` and excludes through `openBlockerRefs`. On a non-zero exit it prints the fence's native Warning and filters nothing. The expected text is extracted from the fence's echo line, with `$(cat …)` replaced by the fake's stderr.
  - `#5227 unresolved dependency`: a blocker outside the open-numbers pull is checked with `gh issue view <n> --json state -q .state`, and `OPEN` blocks.
  - `#5227 foreign blocker`: a body line `Blocked by acme-corp/other#12` holds the record as `acme-corp/other#12` while the blocker is OPEN and releases it once the blocker closes. An unreadable states file gives `(state unreadable)` and one fail-closed Warning (Review Focus 1).
  - `#5227 cache hit`: a `composeOrderBlob` blob over the same freshness replays the groups, the blocked entries and the bundles, and recomputes `oversized`. It prints `Queue-order cache hit — using persisted groups/excluded, skipping dependency verification and native blocker query (#1571).` and makes no open-numbers call.
  - `AC4.5 write-back`: a miss writes `composeOrderBlob` with `computedAt` from `now`, `runId` set to `basename(PIPELINE_RUN_DIR)` or `null`, and `excluded` in `{number, blockedBy}` shape. When `writeOrder` returns `{ok:false}`, it prints `Queue-order cache write-back failed (non-blocking): <error>` and the pull continues.
  - `#5227 cap warning: a 500-record queue` prints the fence's 500-cap Warning byte for byte.
  - `#5227 files: the queue file is aliased in place`:
    - camelCase keys are added next to the snake_case ones;
    - `dispatch-verified-open-deps.txt` replaces the `gh issue view` loop;
    - no `gh` call is made (`fakeRun` throws on any).
  - `#5227 D3`: a non-array queue file such as `{issues:[…]}` reads as an empty queue, with no Warning.
  - `#5227 stop: a grouping-block throw` first truncates `dispatch-groups.json` to 0 bytes, as the fence's `>` redirect does, then throws `QueuePullStopped` with the fence's group-building stop line.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test --test-name-pattern="AC2.1 blocked|AC2.2 oversized|native|unresolved dependency|foreign blocker|cache hit|AC4.5 write-back|cap warning: a 500|files: the queue|D3|stop: a grouping" tests/bin-lib/dispatch/queue-pull.test.js`
Expected: FAIL (`queue-pull: pass not implemented: fetch`)

- [ ] **Step 3: Implement** fence lines 71-303 step by step (R6).
  - Call `cacheUsable(persisted, current, deps.expressQueuePolicy().grouping)`.
  - Call `partitionByOpenBodyBlockers(…, bodyForeignBlockers(eligiblePreDep, { statesFile: inputs.foreignStates, ...deps.foreignDeps }))` (Q27 rule 3).
  - The dependency-freshness fetches drop stderr and write `[]` on failure.
  - On `files`, read `inputs.*` at the same step positions.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test --test-name-pattern="AC2.1 blocked|AC2.2 oversized|native|unresolved dependency|foreign blocker|cache hit|AC4.5 write-back|cap warning: a 500|files: the queue|D3|stop: a grouping" tests/bin-lib/dispatch/queue-pull.test.js`
Expected: PASS

- [ ] **Step 5: Run the Task 2 source scans.** Same command, same expected result.

- [ ] **Step 6: Commit**

```bash
git add plugin/bin/lib/dispatch/queue-pull.js tests/bin-lib/dispatch/queue-pull.test.js tests/bin-lib/dispatch/queue-pull-fixtures.js
git commit -m "Port queue-pull fetch, blocked, grouping and write-back passes — both transports (#5227)

Claude-Session: https://claude.ai/code/session_01UwjosEusBiNWBiJFRWNNmQ"
```

---

### Task 4: not-spec-shaped, open-pr, target-missing and shipped passes

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/dispatch/queue-pull.js`
- Modify: `tests/bin-lib/dispatch/queue-pull.test.js`
- Modify: `tests/bin-lib/dispatch/queue-pull-fixtures.js` (S1 #9004-#9010, #9016)

**Interfaces:**
- Consumes: Task 3's groups file and `deps.spawnCli`.
- Produces: the runners for `not-spec-shaped`, `open-pr`, `target-missing` and `shipped`. Each CLI argv matches the fence exactly:
  - `resolve-linked-prs.js "<n,…>"`.
  - `hooks.js resolve-run-dir --spec-slug dispatch-standalone`, called twice as in the fence.
  - `log-decision.js --run <dir> --status AUTO --text "<…>" --reversibility n/a`.
  - `stage-item.js --run <dir> --id dispatch-target-missing-<N> --file <tmpName()>`, with its stdout forwarded.
  - `stage-item.js --run <dir> --id shipped-close-<N> --file <dirname(exclusions)>/shipped-close-proposal-<N>.md`, with stdout dropped and any failure ignored.
  - The integration branch comes from `resolve-policy.js --values integration-branch`. When that is empty, the module reads `git remote show origin`'s `HEAD branch:` line. These are the fence's own resolvers, which the Consumer-portability check asks for.

- [ ] **Step 1: Write the failing tests** (in-process, S1). Each reason has one assertion function, shared by its positive run and its omitted run.
  - `AC2.1 not-spec-shaped`: #9007 has no Acceptance Criteria. It gets `{missing:[…]}` and leaves the groups; `omit` keeps it.
  - `AC2.1 open-pr`: #9008's linked-PR entry has `openPR` 77, so it gets `{pr:77}`. When `resolve-linked-prs.js` fails, the run prints the fence's linked-PR Warning and writes `{}`.
  - `AC2.1 target-missing`: #9009 is a `by:docs-health` record whose `docs/gone.md` is absent at `origin/main`.
    - It gets `{path:'docs/gone.md'}`.
    - log-decision receives the fence's text.
    - The staged body equals the fence's echo lines.
    - The `--file` name matches `/tmp\.[A-Za-z0-9]{10}$/` (D2).
  - `AC2.1 shipped`:
    - #9010 has a strong mention. It is excluded with `{pr, signals}`, prints the strong AUTO line, and stages `shipped-close-9010`.
    - #9016 has a weak mention. It prints the weak AUTO line, is probed with `gh pr view <pr> --json files -q [.files[].path]` (at most 5 probes), and stays.
  - `AC3.1`:
    - #9004 is not spec-shaped and also has an open PR, a missing target and a strong mention. It gets only `not-spec-shaped`, and the `resolve-linked-prs.js` argv leaves out 9004.
    - #9005 has an open PR and a strong mention. It gets only `open-pr`.
    - #9006 has a missing target and a strong mention. It gets only `target-missing`.
  - `#5227 portability`:
    - The policy value `integration-branch: release/next` turns the probe into `git cat-file -e origin/release/next:docs/gone.md`.
    - With no policy value, the branch comes from `git remote show origin` (`HEAD branch: trunk`).
  - `AC4.6 (in-process)`: a corrupt exclusions file before the open-pr append throws `QueuePullStopped` with the fence's open-linked-PR corrupt-file stop line. No later pass runs (checked through `onPass`), and the file's bytes are unchanged.
  - `#5227 not-spec-shaped non-append failure` prints `Warning: not-spec-shaped pass skipped — <err>` and filters nothing.
  - `#5227 shipped: an empty hooks.js resolve-run-dir answer` stages no shipped proposal.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test --test-name-pattern="AC2.1 not-spec|AC2.1 open-pr|AC2.1 target-missing|AC2.1 shipped|AC3.1|portability|AC4.6 \(in-process\)|non-append failure|empty hooks.js" tests/bin-lib/dispatch/queue-pull.test.js`
Expected: FAIL (`queue-pull: pass not implemented: not-spec-shaped`)

- [ ] **Step 3: Implement** fence lines 307-580 step by step (R6).
  - The `shipped-pr-files` read catches `ENOENT`.
  - `writeReleaseTimes` and `readReleaseTimes` are called at the same points as in the fence.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test --test-name-pattern="AC2.1 not-spec|AC2.1 open-pr|AC2.1 target-missing|AC2.1 shipped|AC3.1|portability|AC4.6 \(in-process\)|non-append failure|empty hooks.js" tests/bin-lib/dispatch/queue-pull.test.js`
Expected: PASS

- [ ] **Step 5: Run the Task 2 source scans.** Same command, same expected result.

- [ ] **Step 6: Commit**

```bash
git add plugin/bin/lib/dispatch/queue-pull.js tests/bin-lib/dispatch/queue-pull.test.js tests/bin-lib/dispatch/queue-pull-fixtures.js
git commit -m "Port queue-pull spec-shape, open-PR, target-missing and shipped passes — fence order kept (#5227)

Claude-Session: https://claude.ai/code/session_01UwjosEusBiNWBiJFRWNNmQ"
```

---

### Task 5: blocker-landing, neighbour-in-flight, cross-PR overlap and near-duplicate passes; the omit sweep

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/dispatch/queue-pull.js`
- Modify: `tests/bin-lib/dispatch/queue-pull.test.js`
- Modify: `tests/bin-lib/dispatch/queue-pull-fixtures.js` (S1 #9011-#9015, in-flight #7001, claims)

**Interfaces:**
- Consumes: Task 4's integration branch and `work-links`.
- Produces: the runners for `blocker-landing`, `neighbour-in-flight`, `cross-pr-overlap` and `near-dup-pairs`. With these, `queuePull` is complete.
  - `blocker-landing` spawns `dispatch-unlanded-blockers.js --groups <p> --exclusions <p> --integration-branch <b> --work-links <w>`. On exit 0 its stdout replaces the groups file; any non-zero exit produces the fence's stop line.
  - `neighbour-in-flight` reads claims through `deps.createClaimReader().read` on `gh`, and through `claimReaderFromMap(...)` over `inputs.inFlightClaims` on `files`. A missing or malformed in-flight-raw or claims FILE stops the pull (A2, R8).

- [ ] **Step 1: Write the failing tests** (in-process, S1):
  - `AC2.1 malformed-blocker`: #9012 is blocked by #0 and is excluded with `{cause}`.
  - `AC2.1 unlanded-blocker`: #9011 is excluded with `{blockers:[{blocker:8001, commit}]}`. Both blocker reasons use the canned CLI output, and omitting either one skips the call (R7).
  - `AC2.2 neighbour-in-flight`: #9013 shares a Key File with in-flight #7001, whose claim reads live. The entry is written and #9013 stays in `dispatch-groups.json`. With `omit`, nothing is written.
  - `#5227 neighbour`:
    - an unreadable claim prints the fence's `claim read failed … treated as not in flight` AUTO line;
    - a failed pool fetch writes `[]` and prints the pool AUTO line;
    - a 200-record pool prints the 200-cap Warning.
  - `#5227 files neighbour`: claims come from the map. A missing claims file throws `QueuePullStopped` with the neighbour stop line.
  - `#5227 D4`: a non-JSON claim string excludes nothing and prints no AUTO line.
  - `#5227 cross-PR`:
    - `gh pr list --state open --json number,files,closingIssuesReferences --limit 100` feeds `detectCrossPRFileOverlap`;
    - a failure writes `[]`;
    - on `files` the pass writes `[]` and makes no gh call;
    - a 100-PR list prints the 100-cap Warning.
  - `#5227 near-dup`: a strong cross-group pair prints its AUTO line, and only strong pairs are written to `dispatch-near-dup-pairs.json`.
  - `AC2.1: every registry entry that writes a reason, and each informational pass, goes red when omitted`. For each non-`setup` entry, run S1 with `omit: [p.reason || p.id]` and assert that the reason's entries, or the pass's output file, differ from the full run. Also assert that the sweep covered 12 entries.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test --test-name-pattern="AC2.1 malformed|AC2.1 unlanded|AC2.2 neighbour|neighbour|D4|cross-PR|near-dup|AC2.1: every registry" tests/bin-lib/dispatch/queue-pull.test.js`
Expected: FAIL (`queue-pull: pass not implemented: blocker-landing`)

- [ ] **Step 3: Implement** fence lines 583-671. On `files`, follow `mcp-transport.md` steps 2 and 4 (R5, R6).

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test --test-name-pattern="AC2.1 malformed|AC2.1 unlanded|AC2.2 neighbour|neighbour|D4|cross-PR|near-dup|AC2.1: every registry" tests/bin-lib/dispatch/queue-pull.test.js`
Expected: PASS

- [ ] **Step 5: Run the Task 2 source scans.** Same command, same expected result.

- [ ] **Step 6: Commit**

```bash
git add plugin/bin/lib/dispatch/queue-pull.js tests/bin-lib/dispatch/queue-pull.test.js tests/bin-lib/dispatch/queue-pull-fixtures.js
git commit -m "Port queue-pull blocker-landing, neighbour, overlap and near-dup passes — omit sweep over PASSES (#5227)

Claude-Session: https://claude.ai/code/session_01UwjosEusBiNWBiJFRWNNmQ"
```

---

### Task 6: `rankNext` and `rankFromFiles`

**Role:** integration

**Files:**
- Modify: `plugin/bin/lib/dispatch/queue-pull.js`
- Modify: `tests/bin-lib/dispatch/queue-pull.test.js`

**Interfaces:**
- Consumes: `readExclusions`, `groupIsExcluded` and `aliasMcpTimestamps`.
- Produces:
  - `rankNext`, which reproduces `next-ranking.md`'s fence expression for expression:
    - `RANK = {high:0, medium:1, low:2}`, with band 3 for an unprioritized group;
    - `groupIsExcluded(g, entries, ['oversized', 'firing', 'neighbour-in-flight'])`;
    - the representative is chosen by a stable sort on band, then `new Date(createdAt)`;
    - the priority filter applies to `rep.facets.priority`;
    - it returns `null` when nothing remains.
  - `rankFromFiles`, which reads exclusions with `readExclusions` (an absent or unreadable file reads as `[]`) and writes `JSON.stringify(pick) + '\n'`.

- [ ] **Step 1: Write the failing tests.** `RANK_CASES` is one table of `{ name, groups, exclusions, priority, expected }` rows. The rows cover:
  - every band;
  - a tie within a band;
  - a group whose best member is not its first;
  - one group excluded by each of `oversized`, `firing` and `neighbour-in-flight`;
  - a `--priority` that matches nothing;
  - an empty pool;
  - two groups whose best members share a `createdAt`.

  Each `expected` is a literal, never computed by `rankNext` (Q4).

```js
for (const c of RANK_CASES) {
  test(`AC6.1: rankNext matches next-ranking.md — ${c.name}`, () => assert.deepEqual(rankNext(c.groups, c.exclusions, { priority: c.priority }), c.expected));
  test(`AC6.1 oracle: next-ranking.md's fence picks the same — ${c.name}`, { skip: oracleSkip() }, () => assert.deepEqual(runRankingFence(c), c.expected));
}
test('AC6.2: equal createdAt ranks in the script sort order, and a snake_case pool aliased with aliasMcpTimestamps ranks as its camelCase twin', () => {});
test('AC6.3: rankFromFiles reads an absent and a corrupt dispatch-exclusions.json as no exclusions', () => {});
```

`runRankingFence(c)` writes the case files into a fresh session dir and runs `extractFence(readText(NEXT_RANKING_MD), 'DISPATCH_GROUPS="$(node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" --value dispatch-groups.json)"')` under `findBash()`, with R2's env and `PRIORITY_FILTER`. It then parses `dispatch-next-pick.json`.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test --test-name-pattern="AC6" tests/bin-lib/dispatch/queue-pull.test.js`
Expected: FAIL (`rankNext is not a function`)

- [ ] **Step 3: Implement** `rankNext` and `rankFromFiles`.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test --test-name-pattern="AC6" tests/bin-lib/dispatch/queue-pull.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/dispatch/queue-pull.js tests/bin-lib/dispatch/queue-pull.test.js
git commit -m "Add queue-pull rankNext — one table run through next-ranking.md and the module (#5227)

Claude-Session: https://claude.ai/code/session_01UwjosEusBiNWBiJFRWNNmQ"
```

---

### Task 7: CLI `plugin/bin/queue-pull.js` and `docs/plugin-structure.md`

**Role:** integration

**Files:**
- Create: `plugin/bin/queue-pull.js`
- Modify: `docs/plugin-structure.md`: the line-70 `plugin/bin/lib/dispatch/` entry, and a command line beside `dispatch-unlanded-blockers.js` (around line 234)
- Modify: `tests/bin-lib/dispatch/queue-pull.test.js`
- Modify: `tests/bin-lib/dispatch/queue-pull-oracle.js` (`runModuleCli`)

**Interfaces:**
- Consumes: `queuePull`, `rankFromFiles`, `QueuePullStopped`, and `repo-resolve.js`'s `ghAvailable`.
- Produces: `run(argv, deps)`, `parseArgs`, `USAGE` and `EXIT = { OK: 0, USAGE: 1, MISSING_DEPENDENCY: 2, REMOTE_FAILED: 3, STOPPED: 4 }`, plus `runModuleCli(sandbox, argv)`, which spawns `node <worktree>/plugin/bin/queue-pull.js` with the sandbox env and cwd.
  - The header states every exit code, R4's decision comment with its reopen condition, and R5's departure.
  - `--help` and `-h` print `USAGE` and return 0 before any `deps` call.
  - A `QueuePullStopped` returns 4. Any other throw prints `queue-pull: <message>` and also returns 4, because the run cannot vouch for its files. That direction is stated next to the catch (Q19).

- [ ] **Step 1: Write the failing tests**
  - `AC9.1: --help exits 0 and prints USAGE before any probe`. The `ghAvailable`, `queuePull` and `env` getters throw if they are touched.
  - `AC9.2: a malformed invocation exits 1 and prints USAGE`, for each of these:
    - `--bogus`;
    - a trailing `--transport`;
    - `--transport ''`;
    - `--transport sideways`;
    - `--priority` with no value;
    - `--queue-raw` with `--transport gh`;
    - `--rank` together with `--transport`;
    - no mode at all.
  - `AC9.3: the header comment and USAGE each state exit codes 0, 1, 2, 3 and 4`. The file is read through `readText`.
  - `AC7.3: --transport gh with gh absent exits 2 with a message naming --transport files`.
  - `AC7.4: --transport gh with gh absent never calls queuePull`.
  - `AC4.6: a corrupt dispatch-exclusions.json makes the CLI exit 4; no pass after the stop runs; the file is unchanged`. This uses the real module with fake deps, and corrupts the file at open-pr.
  - `#5227 --rank writes dispatch-next-pick.json and exits 0`.
  - `AC10.1: docs/plugin-structure.md names queue-pull.js in the command reference and the plugin/bin/lib/dispatch/ entry`. Through `readText`, a line starts with `node plugin/bin/queue-pull.js`, and the line starting `plugin/bin/lib/dispatch/` contains `queue-pull.js`.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test --test-name-pattern="AC9|AC7.3|AC7.4|AC4.6: a corrupt|--rank writes|AC10" tests/bin-lib/dispatch/queue-pull.test.js`
Expected: FAIL (`Cannot find module '../../../plugin/bin/queue-pull'`)

- [ ] **Step 3: Implement** the CLI.
  - Use a `require.main === module` guard that sets `process.exitCode`, never `process.exit` (Q16).
  - Every value flag rejects `undefined`, an empty or blank value, and a value with a leading `-` (Q-T2.16).
  - For the docs:
    - Run `git grep -n -F 'dispatch-unlanded-blockers.js' -- docs plugin .claude/skills`. Add the sibling line to every hit in `docs/` that lists the dispatch CLIs. `plugin/skills/` stays out of scope (AC8).
    - Add `queue-pull.js (#5227: …)` to the line-70 module entry.
    - `docs/skill-graph.md` gains no edge, because no skill calls the CLI before the cutover unit. Say so in the commit body.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test --test-name-pattern="AC9|AC7.3|AC7.4|AC4.6: a corrupt|--rank writes|AC10" tests/bin-lib/dispatch/queue-pull.test.js`
Expected: PASS

- [ ] **Step 5: Run the Task 2 source scans, plus `node --test tests/raw-markdown-read-conformance.test.js`.**
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add plugin/bin/queue-pull.js docs/plugin-structure.md tests/bin-lib/dispatch/queue-pull.test.js tests/bin-lib/dispatch/queue-pull-oracle.js
git commit -m "Add queue-pull CLI — Split-1/2 exits plus 4 for a stopped pull, docs listed (#5227)

Claude-Session: https://claude.ai/code/session_01UwjosEusBiNWBiJFRWNNmQ"
```

---

### Task 8: Parity — the AC1 matrix, multi-reason, empty and malformed queues, portability, real-writer pins

**Role:** judgment
**Review risk:** high

**Files:**
- Modify: `tests/bin-lib/dispatch/queue-pull-oracle.js` (`filesOracleScript`)
- Modify: `tests/bin-lib/dispatch/queue-pull-fixtures.js` (complete `S1`; add `S2`, `SEmpty`, `SMalformed`, `SPortable`)
- Modify: `tests/bin-lib/dispatch/queue-pull.test.js`
- Modify: `plugin/bin/lib/dispatch/queue-pull.js` (only where the matrix shows a divergence)

**Interfaces:**
- Consumes: everything above.
- Produces: `runPair(cfg)`, and `filesOracleScript(fence, mcpText)`. The latter applies `mcp-transport.md`'s documented substitutions to the gh fence. Each substitution first asserts that its anchor line exists, and throws `anchor not found: <line>` if it doesn't.
  - (a) Line 71's queue pull and line 155's open-numbers pull become the agent's write: `if [ -f "$QP_AGENT_DIR/<name>" ]; then cp …; else rm -f "$DISPATCH_X"; fi`.
  - (b) The `--search` dependency-freshness lines (104 and 275) become the same kind of write.
  - (c) The `gh issue view` loop (lines 174-178) becomes the agent's write of `dispatch-verified-open-deps.txt`.
  - (d) Lines 596-618 become mcp-transport's four steps:
    1. The agent writes the in-flight raw file.
    2. That file's first fence runs.
    3. The agent writes the claims map.
    4. The second fence runs, followed by a stop on any non-zero exit. The stop text is copied from the fence's `NEIGHBOUR_RC` line.
  - (e) Lines 635-652 become `echo '[]' > "$DISPATCH_CROSSPR_OVERLAP"`.
  - (f) The `files` sandbox bin has no `gh`.
  - `DISPATCH_FOREIGN_STATES` is exported when the scenario sets it.
  - The module run gets the same staged inputs, copied to the session paths.

Scenarios:

- **S1** (body-text, size guard 2): records #9001-#9016. That is one record per reason, #9004-#9006 for AC3, and a near-duplicate pair across groups (#9014/#9015). `main` holds `docs/present.md` and has no `docs/gone.md`. `claims-registry` holds a live claim for #7001.
- **S2** (`work-links: native`): one native-blocked record and one body that says `Blocked by acme-corp/other#12`.
- **SEmpty:** an empty queue.
- **SMalformed:** #9020 with `labels: "auto:build"`, #9021 with `body: 42`, #9022 blocked by #99999999999, and the clean record #9001.
- **SPortable:** `integration-branch: release/next`, the remote `https://github.com/acme-corp/widgets.git`, and an origin HEAD of `trunk`.

Fill in the S1 and S2 tables with Task 1's UNHANDLED loop. This covers the `b<N>` landing GraphQL and the compare calls that `preflight-records.js --blocker-landing` makes. Record the final argv list in the fixture file's header comment.

- [ ] **Step 1: Write the failing tests.**
  - `MATRIX` has six configs: `S1-gh-miss`, `S1-gh-hit`, `S1-files-miss`, `S1-files-hit`, `S2-gh-miss` and `S2-files-miss`.
  - Each hit config reuses its miss sandbox's origin, oracle with oracle and module with module.
  - `AC1_FILES` lists the files AC1.1 compares: `dispatch-groups.json`, `dispatch-exclusions.json`, `dispatch-fastlane-bundles.json`, `dispatch-near-dup-pairs.json`, `dispatch-crosspr-overlap.json`, `dispatch-linked-prs.json` and `dispatch-shipped-releases.json`. The comparison also covers `staged`, `decisions`, `orderBlob`, and `reported(stdout)` and `reported(stderr)`.

```js
describe('#5227 parity (AC1)', { skip: oracleSkip(), timeout: 600_000 }, () => {
  const R = {};
  before(async () => Object.assign(R, await runAll(MATRIX.map((cfg) => () => runPair(cfg)), POOL)));
  for (const cfg of MATRIX) test(`AC1.1 [${cfg.name}]: groups, exclusions and every other output equal the script's`, () => assertParity(R[cfg.name].oracle, R[cfg.name].module, { files: AC1_FILES }));
  test('AC1.2: normalize substitutes only the sandbox root, the run id and the D2 mktemp suffix', () => {});
  test('AC1.1 go-red: assertParity throws when the module result drops one exclusion entry', () => {});
  test('AC2.3: removing reasons are absent from dispatch-groups.json while oversized and neighbour-in-flight are present, both sides', () => {});
  test('AC3.1 parity: #9004/#9005/#9006 carry one reason each and the linked-PR GraphQL names no #9004 alias, both sides', () => {});
  test('AC7.1: the files transport writes dispatch-crosspr-overlap.json as [] and dispatch-linked-prs.json as {}, both sides', () => {});
  test('#5227 real-writer: fakeSpawnCli canned stdout equals what the real CLIs printed in S1-gh-miss', () => {});
});
describe('#5227 parity (AC5, portability)', { skip: oracleSkip(), timeout: 600_000 }, () => {
  test('AC5.1: an empty queue yields the same files as the script', () => {});
  test('AC5.2: non-array labels, a non-string body and an invalid Blocked-by number are handled as the script handles them, and #9001 keeps its verdict', () => {});
  test('#5227 portability: release/next and acme-corp/widgets reach git cat-file, --integration-branch and the GraphQL owner/repo on both sides', () => {});
});
```

- The real-writer pin keeps the in-process fixtures from Tasks 3-5 from drifting away from the real CLIs.
- AC5.2 asserts whatever the oracle does. If one malformed candidate changes #9001's verdict in the oracle, the module reproduces that, and the build adds a ledger row naming the second half of AC5.2 as unmet by the script.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test --test-name-pattern="parity \(AC1\)|parity \(AC5" tests/bin-lib/dispatch/queue-pull.test.js`
Expected: FAIL (`filesOracleScript is not a function`)

- [ ] **Step 3: Implement** `filesOracleScript` and the scenarios, then fix each module divergence. Fix only the module, never the oracle or `normalize`. When a script defect causes a divergence, reproduce it in the module and name it in the test header.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test --test-name-pattern="parity \(AC1\)|parity \(AC5" tests/bin-lib/dispatch/queue-pull.test.js`
Expected: PASS

- [ ] **Step 5: Real-input probe.** This is scratch work; its evidence goes to the run dir.
  1. Set `PIPELINE_RUN_DIR=/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude-tweaks/pipelines/2026-11-12T104256-spec-5227` and run `mkdir -p "$PIPELINE_RUN_DIR/evidence"`.
  2. Capture these read-only, each with a plain redirect into `evidence/`:
     - `gh issue list --label auto:build --state open --json number,title,body,labels,createdAt,updatedAt,state --limit 500` into `real-queue.json`. At authoring, `gh issue list --label auto:build --state open --json number --limit 500 --jq length` printed `162`.
     - `gh issue list --state open --json number --limit 200` into `real-open-numbers.json`.
     - `gh issue list --label bot:in-progress --state open --json number,title,body,labels --limit 200` into `real-in-flight.json`.
  3. A scratch script in the session scratchpad builds a scenario from those files with `work-links: native`, this repo's live value. At authoring, `resolve-policy.js --values integration-branch work-links` printed an empty line and `native`. The script answers every GraphQL alias with "no PRs, no blockers", runs one pair, and writes the `assertParity` outcome to `evidence/real-input-parity.txt`.
  4. Make an independent count and reconcile it in the same file. `jq length real-queue.json` must equal the sum of three counts:
     - the records in `dispatch-groups.json`;
     - the records named by removing exclusion entries;
     - the records dropped at eligibility, counted with `jq` over labels (`bot:in-progress`, `bot:blocked`, `bot:parked`, or no `auto:build`).
  5. Run `node "${CLAUDE_PLUGIN_ROOT}/bin/log-decision.js" --run "$PIPELINE_RUN_DIR" --section "/build" --status AUTO --step "AC evidence" --text-file "{text-file}"`. The `{text-file}` holds one line naming AC1.1 (real-input parity), the command shape, the counts and the evidence path.

- [ ] **Step 6: Commit**

```bash
git add tests/bin-lib/dispatch/queue-pull-oracle.js tests/bin-lib/dispatch/queue-pull-fixtures.js tests/bin-lib/dispatch/queue-pull.test.js plugin/bin/lib/dispatch/queue-pull.js
git commit -m "Add queue-pull parity matrix — script and module agree on both transports and cache paths (#5227)

Claude-Session: https://claude.ai/code/session_01UwjosEusBiNWBiJFRWNNmQ"
```

---

### Task 9: Parity — fetch-failure faults (AC4), files-input faults (AC7.2), defect reproductions, AC8 evidence

**Role:** judgment
**Review risk:** high

**Files:**
- Modify: `tests/bin-lib/dispatch/queue-pull-fixtures.js` (fault overlays)
- Modify: `tests/bin-lib/dispatch/queue-pull.test.js`
- Modify: `plugin/bin/lib/dispatch/queue-pull.js` (registry rows, only where the oracle differs from the seed)

**Interfaces:**
- Consumes: S1, `runPair` and `filesOracleScript`.
- Produces: `FAULTS` and `FILES_FAULTS`. Each fault overlay makes one fetch fail on both sides through the shared table, using a gh entry with `status: 1`, a `gitFail` prefix, or an `effect`.

`FAULTS` (gh transport):

| id | pass | what fails |
|---|---|---|
| F-queue | fetch | the auto:build list |
| F-opennum | fetch | the open-numbers list |
| F-depfresh | fetch | `--search` with a warm cache |
| F-depview | blocked | `issue view 8100` |
| F-native | blocked | native GraphQL (S2) |
| F-linked | open-pr | linked-PR GraphQL |
| F-intbranch | target-missing | no policy key, and `git remote show origin` fails |
| F-prview | shipped | `pr view` |
| F-landing | blocker-landing | `b<N>` GraphQL |
| F-inflight | neighbour-in-flight | the in-progress list |
| F-claim | neighbour-in-flight | both the claims fetch and the contents API |
| F-openprs | cross-pr-overlap | `pr list` |
| F-writeback | write-back | `git push` |
| F-corrupt | (stop) | `corrupt-exclusions` on the linked-PR call |
| F-groups | (stop) | `corrupt-groups` on the linked-PR call |

`FILES_FAULTS`: seven inputs, each with a `missing` case and a `malformed` case (`this is not json`). The inputs are the queue raw file, dependency freshness (with a warm cache), the open numbers, verified-open-deps, the in-flight raw file, the claims map and the foreign-states file. The queue also gets a `wrapper` case (D3), and the claims map gets a `non-JSON string` value (D4).

- [ ] **Step 1: Write the failing tests**

```js
describe('#5227 parity (AC4 fetch failures)', { skip: oracleSkip(), timeout: 600_000 }, () => {
  for (const f of FAULTS) test(`AC4.1 [${f.id}]: the module takes the script's path — exit category, reported lines per channel, exclusions and groups`, () => {});
  test('AC4.2: each PASSES failOpen equals the posture observed in its fault run', () => {});
  test('AC4.3: F-corrupt and F-groups stop the pull on both sides (oracle exit 1, CLI exit 4)', () => {});
  test('AC4.4: the oracle stops on exactly the observed stop set, and every other fault exits 0', () => {});
  test('AC4.5: F-writeback exits 0 on both sides with the non-blocking write-back line', () => {});
  test('AC4.6 parity: after F-corrupt the CLI exits 4, the exclusions file is byte-identical to the oracle\'s, and no later pass wrote its file', () => {});
});
describe('#5227 parity (AC7.2 files inputs)', { skip: oracleSkip(), timeout: 600_000 }, () => {
  for (const f of FILES_FAULTS) test(`AC7.2 [${f.input} ${f.mode}]: module and oracle agree on the outcome`, () => {});
  test('AC7.2: in-flight raw and claims FILE missing or malformed stop the pull; [] and {} values fail open; a bad foreign-states file excludes as (state unreadable) with a fail-closed Warning (A2 reversal)', () => {});
  test('#5227 D3: a wrapper-object queue file yields an empty pool, exit 0, no Warning, both sides', () => {});
  test('#5227 D4: a non-JSON claim string yields no exclusion and no AUTO line, both sides', () => {});
  test('#5227 D1: a second pull in the same session whose open-numbers fetch returns empty reuses the first pull\'s eligible files, both sides', () => {});
});
```

- **AC4.1's "one line" takes the oracle as truth.** If the oracle answers a fail-open fault with zero lines, the test asserts zero lines and the build adds a ledger row.
  - F-depfresh, F-depview, F-prview and F-openprs are expected to be silent, because of the fence's `2>/dev/null || echo '[]'`.
  - F-intbranch is expected to exclude every named-target candidate against `origin/` (Review Focus 3).
- **A2 reverses AC7.2's fail-open wording.** The test titles state the outcome actually observed.
- **D1 reuses one session id** for two runs per side. It is the only deliberate reuse.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test --test-name-pattern="parity \(AC4|parity \(AC7.2" tests/bin-lib/dispatch/queue-pull.test.js`
Expected: FAIL (`FAULTS is not iterable`)

- [ ] **Step 3: Implement** the overlays, then fix each module divergence.
  - When the observed `failOpen` differs from the seed, correct it in `PASSES`.
  - A stop the census finds beyond Q3's two gets a module stop at the same step (AC4.5).

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/bin-lib/dispatch/queue-pull.test.js`
Expected: PASS for the whole file. On win32, or without bash ≥ 4, the parity describes SKIP with `no bash oracle`.

- [ ] **Step 5: AC8 evidence.** This is scratch work. Run each command as a plain separate command, never inside `$(…)`.
  1. Run `node plugin/bin/resolve-policy.js --values integration-branch`. If it prints nothing, take the `HEAD branch:` line of `git -C <worktree> remote show origin`. At authoring this gave `main`.
  2. Run `git -C <worktree> merge-base HEAD origin/<branch>`. At authoring this printed `14b75326844902431fd53989b9a28f6d4a2946bd`; re-run it after any upstream merge.
  3. Run `git -C <worktree> diff --name-only <merge-base> -- plugin/skills > "$PIPELINE_RUN_DIR/evidence/ac8-plugin-skills-diff.txt"`. Expected: an empty file, which satisfies AC8.1 and AC8.2.
  4. Absence control, recorded at authoring: the same command shape over a commit that did touch skills, `git -C <worktree> diff --name-only 364bda3dc~1 364bda3dc -- plugin/skills`, printed 7 paths, the first being `plugin/skills/_shared/ceremony-profile.md`.
  5. Run `node "${CLAUDE_PLUGIN_ROOT}/bin/log-decision.js" --run "$PIPELINE_RUN_DIR" --section "/build" --status AUTO --step "AC evidence" --text-file "{text-file}"`. The `{text-file}` names AC8.1 and AC8.2, the command shapes, the count (0), the control count (7) and the evidence path.

- [ ] **Step 6: Commit**

```bash
git add tests/bin-lib/dispatch/queue-pull-fixtures.js tests/bin-lib/dispatch/queue-pull.test.js plugin/bin/lib/dispatch/queue-pull.js
git commit -m "Add queue-pull fault parity — fetch failures, files inputs and reproduced script defects (#5227)

Claude-Session: https://claude.ai/code/session_01UwjosEusBiNWBiJFRWNNmQ"
```

---

## Coverage map

| Clause | Covered by |
|---|---|
| AC8.1, AC8.2 | Task 9 Step 5: the scratch diff check, with run-dir evidence (`evidence/ac8-plugin-skills-diff.txt` and an `AC evidence` entry in decisions.md) |
