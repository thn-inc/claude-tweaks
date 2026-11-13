# Pipeline driver — design

Date: 2026-11-11. Status: draft for approval.

## Why

Today the pipeline is a procedure that a model carries out by reading skill prose and calling one CLI per step. Every step costs a model turn, and every turn re-reads the whole conversation. Measured over five weeks of session transcripts, 2026-10-08 to 2026-11-11:

- 663k model requests; the average request carried 302k tokens of context in a main session and 181k in a subagent.
- Requests that edited a repository file were 4.8% of spend. Harness CLIs were 12.5%, git and gh 14%, `sleep` 4.4%.
- `log-decision.js` was called about 28,000 times. For every request that edited a repository file, two and a half ran a harness CLI.
- A merged change shipped a median of 44 lines under `plugin/` and took a median of 90 minutes of wall clock per run.

The driver inverts control. A program owns the steps that need no judgment and starts a model only for the steps that do.

## What it is

A Node command-line program shipped in the plugin (`plugin/bin/drive.js`, modules under `plugin/bin/lib/driver/`). Given a record, it claims it, creates the worktree, starts a headless implementer, commits, runs the impacted tests, checks the diff bounds, pushes, opens the PR, waits for CI, and merges where the record carries merge authority. It writes every log line, label and comment itself.

It grows out of the express lane (#4025, `_shared/express-lane.md`, `bin/lib/express/`). That procedure is the smallest complete pipeline in the plugin and its gates are already code. The driver executes the same procedure with the same gates; what changes is who performs each step.

## Goals

1. For an express-sized record: under $5 of tokens at list prices and under 15 minutes of wall clock, not counting time spent waiting on CI. Today a run takes a median of 90 minutes across all lanes, at more than ten times that token cost per merged change.
2. Rework no worse than today. Rework means a later fix or revert that names the PR it repairs, within 14 days.
3. No bookkeeping done by a model. A worker's transcript contains no harness CLI calls, no `gh` calls and no `git` writes.
4. Every stop is visible: an event line, and a note on the PR or the record.

## Non-goals

- No change to `/claude-tweaks:flow`, the standard lane, the review lenses, or the hooks.
- No change to the existing prose express lane. It stays as it is and serves as the comparison baseline.
- No hub code. How the dispatch hub starts the driver and shows its results is a separate design in the dispatch repository. This design only fixes the event lines the driver emits.
- No GitHub-triggered entry.
- No parallel records in the first phases. One record at a time.
- No move of run state onto the PR. See "Run directory" below.
- No trimming of project instructions. Workers receive `CLAUDE.md` whole; trimming it is a later experiment judged by the scoreboard.

## Anti-goals

These would make the driver a failure even if it works:

- It retries a denied action with wider rights, or tries to fix a red test run by itself.
- It merges on anything other than a green, fully read check state.
- It grows its own prose contract. For the driver, the code is the statement of record. It gets a usage page in `docs/` and nothing under `plugin/skills/_shared/`, and no test pins its prose. This departs from the plugin's "prose statement of record plus code twin" convention on purpose; that convention is what makes a model re-read the contract on every run.
- It becomes another six-figure-byte module. Each step is a small function over an injected runner, in the shape `.claude/skills/gh-api-module-pattern` describes.

## How a record moves through it

Steps and their owners. "Driver" means program code with no model involved.

| # | Step | Owner | Reuses |
|---|---|---|---|
| 1 | Eligibility | Driver | `bin/lib/express/eligibility.js` |
| 2 | Claim | Driver | `bin/claim-targets.js` |
| 3 | Run directory and worktree | Driver | `hooks.js resolve-run-dir --create`, `hooks.js record-worktree` |
| 4 | Write the change | Implementer worker | — |
| 5 | Commit by explicit path | Driver | — |
| 6 | Impacted tests | Driver | `bin/verify.js` scoped invocation |
| 7 | Stamp and diff bounds | Driver | `express-lane.js check` |
| 8 | Push, draft PR, record PR, write config | Driver | `compose-pr-body.js --express`, `hooks.js record-pr`, `set-config.js` |
| 9 | Wait for CI | Driver | `bin/pr-checks.js` |
| 10 | Merge, when authorized | Driver, with one judgment call | express step 9 |
| 11 | Report | Driver | — |

The order, the escalation rules and the outcome words (`merged`, `armed`, `pending-review`, `express-escalated`, `blocked`) are the express lane's, unchanged. In particular:

- A red test run is never fixed on the lane. It escalates.
- Escalation is possible only before the push, leaves the worktree, branch, claim and run directory in place, and is written with `express-lane.js escalate` so the normal path can pick the record up.
- The PR body carries the express marker so the existing post-merge sampling (`express-lane.js samples`) covers driver merges.

## Eligibility

The driver lane uses the express gates with one difference. A record with no ceremony label is accepted; a record labelled `ceremony:standard` is still refused. Everything else is unchanged: risk low, size low, a `type:*` label, one to three Key Files, no frontend surface, no protected or merge-sensitive path, spec-shaped, not `auto:merge-pending`.

`evaluateRecordEligibility` takes this as an option (the rule is one line, `bin/lib/express/eligibility.js:110`; an absent label parses to `null`). Its default behaviour, and therefore the prose lane, does not change. `enabled` is supplied by the caller, so the driver lane does not need `express-lane` to be on.

**Authorization and record state.** The express gate checks neither, because dispatch's queue pull filters first. The driver has no queue pull in front of it when a record is named, so it applies these itself, on the record's live labels and state, for every entry point:

- the record carries `auto:build`. Naming a record on the command line is not authorization; a human who wants an ungranted record driven grants it first;
- it has no open blocker, is not parked or blocked, and has no open PR. These use the shared helpers `.claude/skills/blocker-surface-parity` lists, so the verdicts match dispatch's.

Over the 484 records open on 2026-11-11 the prose gates accept 14 and the driver gates accept 73, of which 23 carry `auto:build`.

**Policy key.** A new key (my call on the name: `express-driver`) with three values, registered the way `.claude/skills/policy-key-addition` describes:

- `off` (default): the driver refuses to run.
- `split`: the driver takes eligible records with an even issue number; odd ones go where they go today (the prose lane if it accepts them, otherwise the standard path). This gives a concurrent comparison on like records.
- `on`: the driver takes every record it accepts.

`split` is temporary. It is removed, in favour of `on` or `off`, when the scoreboard has enough records to decide.

## Workers

A worker is a headless `claude -p` process started by the driver in the record's worktree. Three rules apply to every worker.

**Narrow rights, never bypass mode.** A spawned process inherits the user-level settings of whoever starts it, and those can carry broad allow rules; `--allowedTools` cannot narrow that because allow rules add up. Probed on CLI 2.1.322:

| Role | Launch | Probe result |
|---|---|---|
| Implementer | `--setting-sources project --settings <driver-owned file>` with `dontAsk` and a narrow allow list, `--permission-prompts none` | File write ran; `echo > file` and `curl` were denied without hanging and appeared in the result's `permission_denials` |
| Reviewer, explorer (later phases) | `--restricted` with read-only tools | No Bash tool exists |

The implementer may read, edit and write inside the worktree, run the project's test command on named files, and run read-only git commands. It may not run `gh`, `git push`, `git commit` or network commands. A denial is never answered by widening rights; the driver counts denials and reports them, and the allow list is tuned from that data between runs.

**Small starting context.** Workers launch with `--safe-mode`, a short tool list, `--disable-slash-commands` and `--strict-mcp-config`. Measured in an empty directory this starts a worker at 5,000 to 7,000 tokens, against about 31,000 for a default headless launch and about 50,000 for an in-session subagent. `--safe-mode` also drops `CLAUDE.md`, so the driver passes the project's `CLAUDE.md` text explicitly with the system-prompt flags. `--bare` is not usable: it requires an API key.

**Structured result, never trusted.** The implementer is given the record body, the Key Files and its limits, and returns a small JSON object (`--json-schema`): a status, a one-line change title, a one-to-two-sentence summary. The driver takes the changed files from git, not from the worker, and applies the diff bounds to what is actually on disk.

The record body is untrusted input. The narrow rights and the bounds check contain the worker; worker-authored code at the test step is contained separately (an allow-listed environment, an empty gh config dir, a refused scope file), with a named residual risk (record #5267; see the header comment at the top of `plugin/bin/lib/driver/steps.js`).

These rules bind every worker in every phase, including the Phase 2 judgment workers: no worker runs `gh`, writes a label, posts a comment or merges. A judgment worker reads and returns a verdict or a text; the driver acts on it.

## When a run stops

The express lane leaves this to the dispatch session around it (`dispatch/settle-and-merge.md`'s Settle, and the re-bind in `dispatch/SKILL.md`'s express paragraph). A run started from a terminal or the hub has no such session, so the driver settles its own stops, in code, with no judgment call:

| Stop | What the driver does |
|---|---|
| Refused before the claim (not eligible, not authorized, wrong state) | Nothing is written. The event line names every reason. |
| `express-escalated` (before the push) | Writes the escalation line with `express-lane.js escalate`, comments on the record with the reason, releases the claim, and removes the worktree and its local branch. The record returns to the queue as if never started and the standard path builds it fresh. |
| `blocked` (after the push, or a failed claim or check call) | Comments on the PR and the record with the failed step, labels the record `bot:blocked`, releases the claim. The draft PR, branch and worktree stay for a human. |
| `pending-review` | Leaves the PR for a human; the claim follows the express lane's existing rule for this outcome. |

Discarding the partial work on escalation is deliberate: an express-sized change is cheap to redo, and a standalone run that leaves a claimed record and an orphaned worktree behind is the costlier failure. Settle's `failure-check` judgment and its tombstone that closes the PR are not carried over.

When the driver is started from `/claude-tweaks:dispatch` (Phase 3), the dispatch session's own hand-back and Settle apply as they do for the prose lane, and the driver does not settle.

## Run directory

The driver keeps using the existing run directory under the main checkout. Every CLI it reuses takes `--run` and reads `run-state.json`, and `express-lane.js verify` reads the bookend artifacts there. Replacing that is a separate, later decision.

What changes is the writer. The driver is an ordinary process, so the worktree-isolation refusals that a model meets when it writes across that boundary (about 8,500 in the measured window) do not arise. The driver also appends its event lines to a file in the run directory.

## Event lines

One JSON object per line on stdout, and the same lines in `{run-dir}/driver-events.jsonl`:

`{ ts, run, record, step, status, ms, model?, usage?, denials?, detail? }`

`usage` is the worker result's usage block, present on worker steps. `status` is `ok`, `stop` or `fail`. The final line carries the outcome word, total milliseconds with and without CI wait, and the PR number. This is the contract the hub design builds on; fields may be added, never renamed.

## Ceilings

Each record has a wall-clock ceiling and a spend ceiling, both policy values with defaults. Reaching either ends the worker and counts as a failure of that step, escalated or blocked by the same rules as any other failure. `claude -p` has `--max-budget-usd`; whether it works under subscription login is unverified and must be probed. The wall-clock ceiling is enforced by the driver regardless.

## Entry points

- `drive.js #N [#M…]` from a terminal: the thing this design builds.
- The dispatch hub starts the same command as a job. That is the normal day. Designed in the dispatch repository.
- `/claude-tweaks:dispatch` routes an eligible singleton to the same command as one background call. Phase 3.

## Phase 1 — Through to a green PR

## Phase 1: Specified

Records: parent #5215; sub-issues #5216 (lane admission and policy keys), #5217 (worker launcher), #5218 (`drive.js` to a green draft PR), #5219 (standalone settle, ceilings, usage page).

Steps 1 to 9 and 11 for explicitly named records. Every run ends `pending-review`, `express-escalated` or `blocked`; nothing merges.

Done when three real eligible records have each been driven to a draft PR with green CI, and for each the report shows cost, wall clock with and without CI wait, worker turns and denials, and the worker transcript contains no harness CLI, `gh` or `git` write call.

## Phase 2 — Merge

## Phase 2: Specified

Records: parent #5223; sub-issues #5226 (merge step in code), #5228 (read-only judgment workers).

Step 10 for records whose live labels carry `auto:merge`. The three obligations of express step 9 hold unchanged: the content judgment (`assess-agent-autonomy merge-check`), acceptance labeling (`wrap-up/verification-brief.md`), and the closing-link check before `_shared/pr-first-merge.md`'s merge.

The merge itself is driver code: mark ready, read the checks, merge, and the post-merge steps. No model holds merge rights. That means porting the deterministic parts of `_shared/pr-first-merge.md` Steps 2 to 3 and its post-merge file, reusing `pr-checks.js`, `compose-subject.js` and `closing-links.js`; this is the bulk of the phase.

The two judgments stay with a model, each as a read-only worker under the worker rules above. The merge-check worker is given the record and the diff and returns a verdict. The acceptance worker returns the brief's text and the labels it calls for. The driver records the verdict, posts the brief and applies the labels. Whether a judgment worker's prompt is the existing skill file's text or a shorter one is left to the builder, with the constraint that verdicts and labels match today's on the same inputs.

Done when a driven record merges with all three obligations on record and `express-lane.js verify` exits 0 for it.

## Phase 3 — Entry from `/claude-tweaks:dispatch`

## Phase 3: Specified

Record: #5232 (route driver-admitted singletons from dispatch to `drive.js`); one unit, so no parent.

An eligible singleton in a drain is handed to the driver as one background call, according to the `express-driver` value, and the session reads only the final event line. Dispatch's existing drain keeps owning queue selection in this phase.

Done when a drain with at least one driver-eligible record completes it through the driver, and the session's own token use for that record is the launch and the summary read.

## Phase 4 — One reviewer, wider lane

## Phase 4: Specified

Records: parent #5221; sub-issues #5222 (evidence-based reviewer step), #5224 (lane bounds as policy values).

A single reviewer worker after the tests pass and before the push. A finding counts only if it comes with a test file that fails; the driver runs that test and discards a finding it cannot reproduce. It never runs a command a reviewer supplies. With the reviewer in place the lane's bounds widen one step (size medium, more Key Files). The exact new bounds are decided from the scoreboard, not in this document.

Done when the scoreboard shows the widened lane's rework rate is no worse than the standard path's over the same period.

## Phase 5 — Queue selection in the driver

## Phase 5: Specified

Records: parent #5225; sub-issues #5227 (queue pull and ranking as a module and CLI), #5229 (`drive.js --budget N`), #5230 (cut dispatch over to the CLI), #5231 (remove the embedded scripts).

`drive.js --budget N` picks its own records, so the hub can start a drain with no Claude session at all. Queue selection today is a script embedded in `plugin/skills/dispatch/queue-pull-script.md`; this phase extracts it to a module that both the skill and the driver call, per `.claude/skills/shared-contract-extraction`. Until then the hub starts the driver with named records, or starts a dispatch session that hands records to it.

Done when a hub-started `--budget` run selects the same records, in the same order, as a dispatch drain would on the same queue.

## Dependency: the scoreboard

The scoreboard is a view in the dispatch hub, designed and built in the dispatch repository, not here. Per record it shows cost, wall clock, attempts, shipped lines, lane and plugin version; rework (a later fix or revert that names the PR it repairs, within 14 days) is its second version.

- Phases 1 to 3 do not need it. They are judged from the driver's own event lines and the PRs.
- Goal 2 and Phase 4's done criterion need its rework figure. Phase 4 cannot close before that exists.
- The `split` value's removal and any later trimming of worker instructions are decided from it.

## Repository facts the plan can rely on

- CI runs on draft PRs: `.github/workflows/test.yml` triggers on a bare `pull_request`.
- A run with no session id is accepted: `record-worktree` omits the owner block and `claim-targets.js` defaults it to empty.
- `express-lane.js check` takes `--record-json`, so the driver's one record fetch serves both the gate and the check.
- `express-lane.js verify` needs three things on record: the claim log, an unsuperseded proceed line, and the recorded PR.
- This repository has `.claude-tweaks/verify-scope.json`, so step 6 is the scoped test invocation here.
- The worker launch flags named above all exist in `claude --help` on CLI 2.1.322. Their behaviour was probed only as the Workers table states.

## Left to the builder

- Module layout under `plugin/bin/lib/driver/`, exit codes, and the usage text, following the existing CLI wrapper contract.
- The worktree's name and location, following `_shared/worktree-setup.md`.
- The implementer prompt wording and the JSON schema's field names.
- The implementer allow list for this repository, and where a consumer project declares its own test command for it.
- Windows: how the `claude` launcher is spawned, per `.claude/skills/windows-checkout-test-parity`.
- Tests sized like the neighbouring `tests/bin-lib/express/` suites, over a fake runner; no test that reads skill prose.

## Decisions made while specifying

Each came out of a record's red-team pass and is written into the record named.

1. `split` ends at 20 merged records per arm; the Phase 4 parent (#5221) owns removing it (#5216).
2. The implementer keeps its test command and its Bash runs under Claude Code's sandbox, subject to an escape probe; if a test can still reach `curl`, `gh` or `git push`, the test command is dropped from its allow list. Stated residual: the driver's own test step runs worker-written code with the driver's rights, as every lane does today (#5217); #5267 later narrowed that residual by running the test step under an allow-listed environment, an empty gh config dir and a refused scope file.
3. An escalation comment carries a marker and admission refuses a record that has one, so an escalated record is not driven again until a human removes the comment (#5219).
4. The judgment-parity criterion needs at least 30 recorded verdicts, at least 10 of them not `auto-merge`, or a recorded waiver; a later change to a judgment prompt, its source skill file or the role's model re-runs it (#5228).
5. Acceptance labels are derived by driver code from the parent gate and the oversight-floor gate; the acceptance worker returns text only (#5228).
6. On the dispatch route the driver applies the drain-overlap hold itself: it is handed the drain's in-flight PR list and ends `pending-review` on any shared path before marking its PR ready (#5232).
7. Reviewer evidence is a test file only, all confirmed findings share one fix round, and a second failure escalates (#5222).
8. A drain's order comes from two embedded scripts, the queue pull and the ranking; Phase 5 covers both. Removing them (#5231) waits for a maintainer comment stating the release, the drains observed and the defects filed.

## Calls made in this document that were not discussed

1. The driver keeps the existing run directory in these phases. An earlier sketch said it would not.
2. Phase 1 stops before the merge; merging is Phase 2.
3. The 15-minute target excludes time waiting on CI.
4. Workers get `CLAUDE.md` whole, passed explicitly, so that the smaller starting context costs no project knowledge.
5. The driver has no prose contract under `_shared/` and no prose-pinning tests.
6. The policy key `express-driver` with values `off` (default), `split` and `on`; `split` sends even-numbered records to the driver so the prose lane and standard path keep receiving like records for comparison.
7. The driver commits; the implementer has no git write access.
8. The driver requires `auto:build` on every record, including one a human names on the command line.
9. A standalone run that escalates discards its partial work: it releases the claim and removes the worktree and branch, and the standard path starts fresh.
10. A standalone `blocked` run labels the record `bot:blocked`, releases the claim and leaves the draft PR open; Settle's failure judgment and PR-closing tombstone are not carried over.
11. In Phase 2 the merge is driver code and the two judgments are read-only workers; no model holds merge rights.
12. `--budget` queue selection in the driver is its own last phase; until then the hub starts the driver with named records or through a dispatch session.
