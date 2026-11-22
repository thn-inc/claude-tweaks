# #5584 PR notes — audit, backlog report, parked record, rulings

These sections go into the PR body. Measured at branch commit `f4bde86bfa` unless a row names another commit. The section "Filings for the controller" holds the records the controller files. The controller filed them as #5714 (A), #5715 (B) and #5716 (C, parked).

## Grant-label sites audit (AC21)

Command: `git grep -n -E "auto:build|grants\.build" -- plugin`. It gives 213 hits in 76 files: 21 under `plugin/bin`, 55 under `plugin/skills`. Local `main` (`82c1184abd`) has 72 files, the count the spec quotes. The four new files are this record's own sites.

The table lists each hit that removes a grant label or acts on a record a run has claimed. Hits that only grant (`/backlog refine`, its headless posture, `grant-gate.js`, `autonomy.js`) are left out: a typed record never reaches them as a claimed record. So are descriptions and keyword lists.

Marks:
- `reads live labels`: the site reads the record's current labels before it acts.
- `best-effort per label`: one removal per label; a failed removal never blocks anything.
- `report only`: the site reads or prints, and changes nothing.
- `fixed here`: changed by this record.

### Removal sites

| Site | What it does for a claimed record with no grant | Mark |
|---|---|---|
| `plugin/bin/release-claim.js --remove-grants` → `plugin/bin/lib/release-claim/release.js` `removeLabel` over `GRANT_LABELS` | Sends one `gh issue edit --remove-label` per label, and every failure is caught. An absent label makes `gh` exit 1 ("not found"). The CLI then prints `warning — could not remove label {label} … (best-effort, continuing)` and logs `label removal failed: auto:build, auto:merge-pending, auto:merge` to `decisions.md`. For a typed record all three labels are reported as failed although none was there, which is misleading. A granted `auto:build`-only record already gets the same false report for the two merge labels. | `best-effort per label` — misleading output filed as #5714 |
| `plugin/bin/lib/reconcile/release-merged.js` `removeGrantLabels` + `logGrantRemoval` | Sends one DELETE per `GRANT_LABELS` entry, and the result is ignored. On a `merged:` release it always logs `stripped auto:build/auto:merge grants on convergent release`, even when the record had no grant. The log is skipped when the run directory is already archived. | `best-effort per label` — unconditional log line filed as #5714 |
| `plugin/skills/dispatch/settle-and-merge.md` Settle step 3 | Runs `LIVE_LABELS=$(gh issue view …)` and removes only an `auto:merge`/`auto:merge-pending` it finds. | `reads live labels` |
| `plugin/skills/dispatch/settle-and-merge.md` Settle step 6 (retry ceiling) | It used to remove `auto:build` without reading the labels, so on a typed record `bot:blocked` would not land. It now reads the live labels and passes `--remove-label` only for the grant labels present (`fedaf01b32`, pinned without a fixed-commit size check in `29f7dcb879`; `tests/dispatch-settle-ceiling-live-labels.test.js`). | `fixed here` |
| `plugin/skills/build/plan-review.md:162` (headless needs-human stop) | Removes "whichever of `auto:build`, `auto:merge`, `auto:merge-pending` is present — read live labels first", and uses `mergeLabelNames` on MCP. | `reads live labels` |
| `plugin/skills/wrap-up/cleanup-procedures-execution.md` Section E step 6 | Calls `release-claim.js --remove-grants`. The prose says "an issue carrying no `auto:*` label is a harmless no-op". The effect is harmless, but the CLI prints three warnings and a "label removal failed" log line. | `best-effort per label` (via the CLI) — prose claim covered by #5714 |
| `plugin/skills/flow/multispec-review-console.md` step 4; `multispec-console-template.md` rows 18, 21 | Each issue gets `--remove-grants` ("best-effort per label", "if present"). | `best-effort per label` (via the CLI) |
| `plugin/skills/flow/multi-spec.md:162` (Mixed execution, spec B) | "Remove B's `auto:build` grant before the pass" names no read first. On a typed B, a literal `gh issue edit --remove-label auto:build` exits 1. Nothing is lost, because the edit carries only that removal, but the agent sees an error. | covered by #5714 (prose: "if present") |
| `plugin/skills/_shared/auto-mode-contract.md:212`, `_shared/issue-claims.md:490`, `dispatch/routine-template.yml:28,33`, `help/context-flow.md:67` | Describe the headless plan-review stop, the release grant removal and the retry ceiling. The steps they cite are the rows above. | `report only` |

### Sites that act on a claimed record

| Site | Behaviour | Mark |
|---|---|---|
| `plugin/bin/lib/dispatch/queue-pull.js:523` (+ `plugin/bin/queue-pull.js --named`) | Admits `typedNumbers` beside `grants.build`. | `fixed here` |
| `plugin/bin/lib/dispatch/resume-eligibility.js:345-357` (at `42490b3066`) | `authority` from the rule; `not-granted` only on `none`, naming the first reason word's remedy. | `fixed here` |
| `plugin/bin/lib/driver/admission.js:125`, `steps.js:332-368` (the admission step's rule call and refusal), `run.js:479` (`checkRecord`, `--check`) and `run.js:607` (the drive loop), at `ad5e0db550` | `noBuildGrant` only when the rule answers `none`; both command-line paths name their record, `--budget` never does. | `fixed here` |
| `plugin/skills/dispatch/settle-and-merge.md` Auto-merge gate (Authorization layer, lines 246-261, 354) | Reads fresh labels per member. A member with no `auto:merge` and no matured `auto:merge-pending` sends the whole group to pending-review. A typed record never merges unattended. | `reads live labels` |
| `plugin/skills/dispatch/grant-maturation-gate.md` | For a typed record `evaluateMaturation` reads `not-pending`, and the group falls back to pending-review. | `reads live labels` |
| `plugin/skills/wrap-up/auto-merge-short-circuit.md` | The Authorization layer reads live labels. With no grant it renders the console as an `auto:build`-only record would. | `reads live labels` |
| `plugin/skills/wrap-up/review-console.md:83` (Ungranted-member carve-out) | Live labels without `auto:merge` lead to "leave the PR open". | `reads live labels` |
| `plugin/skills/dispatch/reporting.md:27` | "A non-headless block keeps `auto:build` with the claim released" is untrue for a typed record, which has no label to keep. Its next step, "re-run `/claude-tweaks:dispatch #{n}`", works for a typed record, so nothing breaks. | `report only` (below the materiality floor; digest note below) |
| `plugin/skills/flow/materialize.md:109`, `flow/failure-cards.md:39`, `flow/claim-targets.md:100`, `dispatch/sequential-execution.md:16`, `dispatch/resume-confirmation.md:48` | `materialize.md` always emits `grants: []`, including for an ungranted record. The other four describe grants and do not touch them. | `report only` |
| `plugin/skills/dispatch/SKILL.md`, `queue-pull-notes.md`, `resume.md`, `_shared/work-record.md`, `_shared/headless-self-report.md`, `plugin/bin/lib/issues/build-authority.js` | This record's prose and rule. | `fixed here` |
| `plugin/bin/lib/dispatch/stuck-open-pr.js`, `plugin/bin/stuck-open-prs.js`, `plugin/bin/lib/record-graph/encode.js`, `plugin/bin/lib/issues/materialize-format.js`, `backlog.js`, `pending-authorization.js`, `backlog-grant-gate.js`, `closing-tally.js`, `plugin/skills/help/status-scan.md:68-69`, `backlog/attention-mode.md` | They report or sort and change nothing. What they show for a typed record at pending-review is in the next section. | `report only` (backlog/help listing filed as #5715) |

Below the materiality floor, so a digest note and no record: `dispatch/reporting.md:27` describes keeping a label that a typed record does not carry. The remedy it prints is still correct.

## Backlog report for a typed record at pending-review (AC17)

The fixture is in the scratchpad (`t14-fixture.json`). Record `#9001` is OPEN with `ready`, `type:task`, `priority:medium`, `risk:low` and `size:small`, no `auto:*`, no `bot:*`, and an open linked PR. Record `#9003` is the same plus `shaped:headless` and `by:code-health`, which is the born-headless variant. The list code is the shipped modules plus the `attention-mode.md` label filters, copied verbatim.

Command, run from the worktree root (`SP` is the session scratchpad):

```
FIX="$SP/t14-fixture.json" node -e "
const { parseRecordFacets } = require('./plugin/bin/lib/issues/record.js');
const { refineWorklist } = require('./plugin/bin/lib/issues/backlog.js');
const { isPendingAuthorization } = require('./plugin/bin/lib/issues/pending-authorization.js');
const { stuckCandidates } = require('./plugin/bin/lib/dispatch/stuck-open-pr.js');
const raw = require(process.env.FIX);
const rows = raw.map((i) => ({ ...i, facets: parseRecordFacets(i.labels) }));
const w = refineWorklist({ allRows: rows, readyRows: rows, priorityBudget: 40, grantBudget: 40 });
console.log('refine fresh:', w.fresh.map((r) => r.number), 'grantSlice:', w.grantSlice.selected.map((r) => r.number), 'blocked:', w.blocked.map((r) => r.number), 'inProgress:', w.inProgress.map((r) => r.number));
console.log('attention needs:*:', raw.filter((r) => r.labels.some((l) => l.name.startsWith('needs:'))).map((r) => r.number));
console.log('attention bot:blocked:', raw.filter((r) => r.labels.some((l) => l.name === 'bot:blocked')).map((r) => r.number), 'bot:parked:', raw.filter((r) => r.labels.some((l) => l.name === 'bot:parked')).map((r) => r.number));
console.log('attention shaped:headless (no grant):', raw.filter((r) => r.labels.some((l) => l.name === 'ready') && r.labels.some((l) => l.name === 'shaped:headless')).filter((r) => !r.labels.some((l) => l.name === 'auto:build')).map((r) => r.number));
console.log('attention stuck:open-pr candidates:', stuckCandidates(raw));
console.log('isPendingAuthorization:', rows.map((r) => [r.number, isPendingAuthorization(r.facets)]));
"
```

Output:

```
refine fresh: [ 9001, 9003 ] grantSlice: [ 9001, 9003 ] blocked: [] inProgress: []
attention needs:*: []
attention bot:blocked: [] bot:parked: []
attention shaped:headless (no grant): [ 9003 ]
attention stuck:open-pr candidates: []
isPendingAuthorization: [ [ 9001, true ], [ 9003, true ] ]
```

What each mode lists:
- **`/claude-tweaks:backlog refine`** puts both records in the Grant lane (`fresh`, `grantSlice`), so it offers them for an `auto:build` grant. Its grant fetch (`gh issue list --label ready`) has no linked-PR filter, and `refineWorklist` filters on grant absence only. A grant applied there does not rebuild the record. The dispatch queue's open-linked-PR pass (#1224) would exclude it as `open-pr`. The offer is still wrong: the record is built and waiting for review, not waiting for authorization.
- **`/claude-tweaks:backlog attention`** does not list `#9001` at all. `stuck:open-pr` takes only granted records (`stuckCandidates` requires `auto:build`), and the record carries none of the other attention labels. It lists `#9003` only as `shaped:headless (no grant)`, with the remedy "run `/claude-tweaks:backlog refine` to grant via the sweep's Grant lane", which is again an offer to grant.
- `/claude-tweaks:help`'s status scan (`help/status-scan.md:69`) and `isPendingAuthorization` count both records as pending authorization. That leads to the same "grant at refine" recommendation (`help/SKILL.md:74`).

Refine lists the record for granting, so the follow-up record is filed as #5715.

## Parked measurement record (AC14, Deliverable 9)

Filed as #5716: a parked record whose trigger is "both releases installed". It carries:
- the probe cases (a), (g), (h) and (d) to re-run with `tools/typed-command-probe.js`;
- the `CC_LAUNCHED_BY` check;
- the expected result;
- the wake condition.

The body is under Filings, entry C.

## Probe cases, #5232, and Decision-rule choices

**Reported cases (b), (c), (i): all three accepted.** They were judged by the same check, as decided 2026-11-16 (`work/5584-probe.md`, Part 1, Claude Code 2.1.325). Each had one row that passed both the markers and the command part, so the verdict was `typed`. (b) carried none of the queue keys the spec's gotcha expected (no `queueSkipSlashCommands`). For (c) and (i), every key except ids and times has the same presence and value as in (a). The transcript therefore cannot tell a launch line from a typed line, and condition 4 is the only refusal for a launcher. `docs/hooks.md` says so in those words.

**Gating cases.** Part 1 found (a) `typed`, (g) `not-typed` and (h) `not-typed`. Part 2 ran the shipped hook and `tools/typed-command-probe.js` at `418be37f26` and found the same answers: (g) and (h) were `none` with `not-typed` (`ea77adad11`).

**#5232's route: landed with the catch-up merge; the 30-minute bound not observed.** #5232 reached this branch with the catch-up merge `3ada44a643`. Until `ad5e0db550` its `drive.js --check` route refused every typed record. `checkRecord` built its context unnamed, so the rule answered `not-named` and the check printed `record lacks auto:build` for a record that `drive.js #N` admits (the final review's Important 1). Since that commit `--check #N` names its record, as the drive loop does. A refused check also prints the typed-command words as its last reason (`typed command not accepted: …`), and the driver route's `SKIP` line carries them. The 30-minute bound cannot be observed live on that route in this build. No driver-route run over a typed list was made, so no later member reached `--check` past the bound. The `expired` refusal is shown only by unit tests (`tests/bin-lib/issues/typed-command.test.js`) and by `--check`'s injected-check tests. Nothing past the bound was observed.

**Measured sizes. No size test is committed, by ruling.** Controller ruling (2026-11-16): AC13 and AC16 mean "this change does not grow the file". They are measured against the current merge base `51a042653b`, which is what the PR diff shows, not against the spec's original base.
- AC16: `plugin/skills/dispatch/settle-and-merge.md` is 51,143 bytes at the merge base `51a042653b` and 51,120 on this branch (23 under).
- AC13: `plugin/skills/dispatch/SKILL.md` is 51,668 bytes at the merge base and 51,664 on this branch (4 under). After the catch-up merge `3ada44a643` the file was 51,833, 165 bytes over the merge base, because this branch's earlier trims overlapped upstream's own trims of the same text. The size-trim commit then cut two restatements: the typed-command clause in the headless self-report skip, which `queue-pull-notes.md`'s Typed command section carries, and the drain paragraph's console history, which the heading and `design-notes.md` carry.
- Before the merge, measured against the spec's base: `SKILL.md` went from 52,088 to 52,083 (`dda1ef7aa`) and `settle-and-merge.md` from 50,974 to 50,951 (`29f7dcb879`).

**Choices made under the Decision rule, and other build rulings.** These come from the SDD ledger's Ruling lines and the run's `decisions.md`.

| # | Choice | Reading taken | Cost if wrong |
|---|---|---|---|
| 1 | Plan review: the closed-record spec gap (the reviewer marked it needs-human) | Treated as intent-resolvable (spec: "a plan review that finds another state adds its row as a plan amendment"; "Every gate a granted record passes still runs"). Reading A: the queue pull refuses a non-OPEN named record before the rule runs, so AC3's 21 reason words are unchanged. Reading B, a new `not-open` reason word, was not taken. | A closed named record gets the queue's existing refusal, not a reason word of its own |
| 2 | `--named` without `--run` | Exits 1 under either transport (AC7 has no transport carve-out). | One extra flag on a files-transport call |
| 3 | `readPromptRows` with `chunkBytes <= 0` | Returns `[]`. No caller passes it, and the default is fixed at 65536. | A silent empty read for a caller passing a non-positive chunk size |
| 4 | A symlinked session-root directory | Not handled. The spec's link rule is file-level (the pointer file), and the root path is followed. | A followed link at the session root |
| 5 | Command-row ARGS | ARGS must contain no `\r`/`\n` and must equal its own trim, so the check refuses more rather than less. | A typed row is refused if Claude Code ever pads command-args |
| 6 | Driver stop detail separator | Reason words are joined with `, `, as `formatAuthorityLine` joins them, not with the plan's `,`. Pinned in `dda1ef7aaa`. | A consumer that parsed `,` |
| 7 | AC16 / AC13 size clauses | Measured once and carried here, not committed as a fixed-commit size test. | A later growth on this branch goes unnoticed |
| 8 | Task 6, an extra stderr line on an already-failed pool pull | Left as is. | Harmless; only on a failed pull |
| 9 | Typed-command linearity bound | Moved from a wall-clock assertion in `tests/` to `perf/` (wall-clock-budget-conformance). | The perf bound misses a native-speed quadratic (about 0.3 s) |
| 10 | Process: implementers ran the suites for touched paths, not `verify.js` | `verify.js` queued on the single suite slot behind sibling sessions. The full impact-selected verify runs once at Common Step 5. Mutation probes used `git archive` extracts. | An indirect reader missed until Step 5 |
| 11 | Catch-up merge `3ada44a643` of `origin/main` (`51a042653b`, which carries #5232) before the final review | Conflicts in six files: `plugin/bin/lib/driver/steps.js`, `plugin/skills/dispatch/SKILL.md`, `docs/driver.md`, `docs/hooks.md`, `tests/bin-lib/driver/run.test.js` and `tests/bin-lib/timing/transcript.test.js`. Both sides were kept. In `steps.js` the admission step keeps #5584's `authority` extra and typed-command suffix, built on #5232's `ctx.admissionReasons`. The final review checked that resolution. It did not cover #5232's `checkRecord`, which still built an unnamed context; that was fixed in `ad5e0db550`. | A side's line dropped in another resolved hunk |
| 12 | Final-review fix wave | `--check` names its record and appends the typed-command words after `ctx.admissionReasons`, whose contract is unchanged (`ad5e0db550`, `0390a77d61`). Resume's not-granted line names the first reason word's remedy (`42490b3066`). `docs/driver.md` and `docs/hooks.md` say the session path is the default for a model-run `drive.js`, and that spoofing from a session's Bash child is not prevented (`e906dc3ab3`). | A `--check` consumer that took the last reason for an admission reason |

Review Minors left as they are:
- Task 7: the `held` cross-check. The real rule runs in `runVerdict`, and Task 3's suite pins `held`.
- Task 9 (probe tool): raw marker values, no basename recheck, and a swallowed candidate error. It is a maintainer-only diagnostic whose answer comes from the shipped check.
- Task 3: `formatAuthorityLine` returns `null` for `label`, and its callers handle that.

## Filings for the controller

### A. Grant-removal sites report removals of labels a record never carried

**Title:** Report only the grant labels a record carried when `release-claim` and `release-merged` strip grants

**Defer-reason:** needs-human-decision. Every fix-now criterion holds. #5584's spec stops it: a site outside its Key Files "is filed through `/claude-tweaks:capture` …, not fixed here".

### Current State

- `plugin/bin/lib/release-claim/release.js` `releaseClaim` with `removeGrants: true` sends one `gh issue edit --remove-label` per `GRANT_LABELS` entry (`auto:build`, `auto:merge-pending`, `auto:merge`).
  - An absent label makes `gh` exit 1 ("not found"), and the call lands in `labelsFailed`.
  - `plugin/bin/release-claim.js` then prints `warning — could not remove label {label} on #N (best-effort, continuing)` per label, and appends `label removal failed: …` to the run's `decisions.md`.
  - A granted `auto:build`-only record gets two such false failures on every `merged:`/`pr-opened:` release.
  - A record built on a typed `/claude-tweaks:dispatch` command (#5584) carries no grant and gets three.
  - `tests/bin-lib/release-claim/cli.test.js:227` pins the warning for a real failure. Nothing separates "not carried" from "failed".
- `plugin/bin/lib/reconcile/release-merged.js` `removeGrantLabels` sends one DELETE per label and ignores the result. `logGrantRemoval` then always appends `stripped auto:build/auto:merge grants on convergent release (…)`, whatever was there.
- `plugin/skills/wrap-up/cleanup-procedures-execution.md` Section E step 6 says "an issue carrying no `auto:*` label is a harmless no-op". The CLI's output says otherwise.
- `plugin/skills/flow/multi-spec.md:162` says "Remove B's `auto:build` grant before the pass" with no read first. A literal `gh issue edit --remove-label auto:build` on an ungranted B exits 1.

### Deliverables

1. `release.js`: read the record's labels once (`gh issue view N --json labels`) before the grant removals, and remove only the `GRANT_LABELS` present. A label that is not carried lands in neither `labelsRemoved` nor `labelsFailed`. A failed read keeps today's per-label attempts and reports them as today. `bot:in-progress` handling is unchanged.
2. `release-merged.js`: read the labels through the same `api` seam, DELETE only the grant labels present, and log only when at least one was removed, naming those labels.
3. Reword `cleanup-procedures-execution.md` Section E step 6 and `multi-spec.md:162` so that grant removal reads "whichever are present" and matches the code.

### Acceptance Criteria

- [ ] `release-claim.js N --remove-grants` on a record carrying only `auto:build` removes it, prints no warning, and logs `labels removed: auto:build` with no `label removal failed` part.
- [ ] The same call on a record carrying no grant label sends no `--remove-label` for a grant, prints no warning, and logs no grant label.
- [ ] A real removal failure (the edit throws for a carried label) still warns and logs `label removal failed: {label}`. The existing test at `cli.test.js:227` stays green.
- [ ] A failed label read falls back to today's three attempts and never blocks the release (exit code unchanged).
- [ ] `release-merged.js` on a `merged:` release of an ungranted record sends no grant DELETE and appends no `stripped …` line. With `auto:build` present it removes it and logs a line naming `auto:build`.
- [ ] Each new test is shown to go red against the old code.

### Key Files

- `plugin/bin/lib/release-claim/release.js`
- `plugin/bin/release-claim.js`
- `plugin/bin/lib/reconcile/release-merged.js`
- `plugin/skills/wrap-up/cleanup-procedures-execution.md`
- `plugin/skills/flow/multi-spec.md`
- `tests/bin-lib/release-claim/cli.test.js`
- `tests/bin-lib/release-claim/release.test.js` (or that module's existing suite)
- the `release-merged` reconcile suite under `tests/`

Refs #5584.

### B. Backlog offers a built, pending-review typed record for granting, and attention never shows it

**Title:** Show a ready record with an open PR and no grant as pending review in `/backlog` and `/help`

**Defer-reason:** needs-human-decision. How such a record should be shown is a product call, and #5584's spec says "do not widen this change to fix that" (AC17 reports only).

### Current State

A run built on a typed `/claude-tweaks:dispatch #N` command (#5584) that ends `pending-review` leaves an open `ready` record with an open linked PR, no `auto:*` and no `bot:*`. Running the shipped list code over that fixture (#5584's PR notes, AC17) gives:
- `refineWorklist` (`plugin/bin/lib/issues/backlog.js:408`) puts the record in `fresh` and `grantSlice`. `/claude-tweaks:backlog refine`'s Grant lane offers it for an `auto:build` grant. Its grant fetch (`gh issue list --label ready`, `backlog/refine-mode.md`) has no linked-PR filter. A grant there does not rebuild the record, because the dispatch queue's open-linked-PR pass excludes it as `open-pr`. It would also be a grant nobody needed.
- `/claude-tweaks:backlog attention` does not list the record at all. `stuckCandidates` (`plugin/bin/lib/dispatch/stuck-open-pr.js`) requires `auto:build`, and the record carries no other attention label. A `shaped:headless` record is listed only as `shaped:headless (no grant)`, with a remedy to grant.
- `isPendingAuthorization` (`plugin/bin/lib/issues/pending-authorization.js`) and `/claude-tweaks:help`'s status scan (`help/status-scan.md:69`) count it as pending authorization, and `help/SKILL.md:74` recommends granting.

### Deliverables

1. Decide how such a record is shown. The candidate is a row like `stuck:open-pr` for an ungranted `ready` record whose open PR closes it: a row with the `dispatch-resume.js` verdict's remedy, and not a grant offer.
2. Keep a ready record whose open PR closes it out of refine's Grant lane (`fresh`/`grantSlice`), or tag it in the lane as pending review rather than recommending a grant.
3. Keep `/help`'s pending-authorization count and recommendation away from such a record, or name it as pending review there.

### Acceptance Criteria

- [ ] Over a fixture of an open `ready` record with an open linked PR and no `auto:*`/`bot:*`, refine's Grant lane does not recommend `auto:build`.
- [ ] `/claude-tweaks:backlog attention` lists that record with a remedy that names its PR (resume, review or close-out), never a grant.
- [ ] `/claude-tweaks:help` does not count it as pending authorization.
- [ ] A `ready` record with no open PR is listed for granting exactly as today.
- [ ] Each new test is shown to go red against the old code.

### Key Files

- `plugin/bin/lib/issues/backlog.js`
- `plugin/bin/lib/issues/pending-authorization.js`
- `plugin/bin/lib/dispatch/stuck-open-pr.js`
- `plugin/bin/stuck-open-prs.js`
- `plugin/skills/backlog/refine-mode.md`
- `plugin/skills/backlog/attention-mode.md`
- `plugin/skills/help/status-scan.md`
- `plugin/skills/help/SKILL.md`

Refs #5584.

### C. Parked measurement record (AC14, Deliverable 9)

**Title:** Re-measure the typed-dispatch check and `CC_LAUNCHED_BY` once both releases are installed

**Labels:** `parked` (no `ready`)

**Trigger (wake condition):** both releases are installed:
- the claude-tweaks release that ships #5584, as the installed plugin;
- the `cc` launcher release that exports `CC_LAUNCHED_BY` (thn-inc/claude-user-config#50).

**Defer-reason:** blocked-external. The check can only be observed after both releases are installed. The `cc` release is in another repository.

### Current State

#5584 lets a typed `/claude-tweaks:dispatch #N` stand in for `auto:build` for one run. The check (`plugin/bin/lib/issues/typed-command.js`) reads transcript fields Claude Code does not document: `turnOrigin`, `origin.kind`, `promptSource`, `isMeta`, the scheduled/queue keys and the command form. It was probed on Claude Code 2.1.325 only (`docs/hooks.md`, "Typed dispatch command"):
- Part 1 found (a) `typed`, (g) `not-typed` and (h) `not-typed`.
- Part 2, through the shipped hook and `tools/typed-command-probe.js`, found the same.
- Row (d), `claude -p`, comes from the first probe (`sdk-cli`/`0`) and was not captured this build.

Condition 4 needs `CC_LAUNCHED_BY` to be exactly `user` whenever `CC_POSTURE` or `CC_LAUNCHED_BY` is set. Until the `cc` launcher exports it, every `cc`-launched session refuses a typed command with `launcher`. Neither the probe re-run nor the launcher check can run before the releases are installed.

### Deliverables

1. On the Claude Code version installed at wake time, re-run the probe steps in `docs/hooks.md` ("Re-running the probe after a Claude Code upgrade") for:
   - (a) typed at an idle prompt;
   - (g) a `ScheduleWakeup` prompt holding the line;
   - (h) `cc hub send <target> "/claude-tweaks:dispatch #N"`;
   - (d) `claude -p "/claude-tweaks:dispatch #N"`.

   Use a closed record `N`. For (d), log the hook process's `CLAUDE_CODE_ENTRYPOINT` and `CLAUDE_CODE_SESSION_ATTENDED` with a scratch `UserPromptSubmit` hook, as `docs/hooks.md` step 4 says. After each case run `node tools/typed-command-probe.js --session <id> --record N [--config-dir <dir>] [--tmpdir <dir>]`, and record the version and the printed pointer, candidate marker fields and answer.
2. Run the `CC_LAUNCHED_BY` check:
   - Read the variable in a session a person launched with `cc`, and in one that `cc hub spawn` opened.
   - In the person-launched session, type `/claude-tweaks:dispatch #N` for an open `ready` record with no `auto:build`.
   - Start the same line with `cc hub spawn`.
3. Post the results on this record and update `docs/hooks.md`'s probe table with the new version's row. If any result differs from the expected one, file the defect before closing this record.

### Acceptance Criteria

- [ ] (a) prints `typed`. (g) and (h) print `none` with `not-typed`. The Claude Code version is named.
- [ ] (d): the hook process of a `claude -p "/claude-tweaks:dispatch #N"` run sees `CLAUDE_CODE_ENTRYPOINT=sdk-cli` and `CLAUDE_CODE_SESSION_ATTENDED=0`. That is the rule's `entrypoint`/`not-attended` refusal, and the probe tool's printout is recorded too. A headless run that reports `cli` and `1` would widen the typed path and is filed as a defect.
- [ ] `CC_LAUNCHED_BY` reads `user` in the session a person launched and `hub` in the `cc hub spawn` session.
- [ ] The typed line in the person-launched session builds the record. The queue pull prints `#N has no auto:build label — built on the typed /claude-tweaks:dispatch command`.
- [ ] The `cc hub spawn` line does not build. The pull prints the refusal line `#N has no auto:build label — not built: typed command not accepted (…)` with `hub-run` or `launcher` among the reason words.
- [ ] The results are posted on this record, and `docs/hooks.md`'s probe table carries the re-run version.

### Key Files

- `tools/typed-command-probe.js`
- `plugin/bin/lib/issues/typed-command.js`
- `plugin/bin/lib/issues/build-authority.js`
- `plugin/bin/lib/hooks/user-prompt-submit.js`
- `docs/hooks.md`

Refs #5584.
