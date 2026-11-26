---
files:
  - plugin/bin/drive.js
  - plugin/bin/lib/driver/budget.js
  - plugin/bin/lib/driver/worker.js
  - plugin/bin/lib/driver/settle.js
  - plugin/bin/lib/driver/claim-exit.js
  - plugin/bin/lib/driver/run.js
  - plugin/bin/lib/driver/steps.js
  - plugin/bin/lib/driver/events.js
  - plugin/bin/lib/driver/merge.js
  - plugin/bin/lib/dispatch/queue-pull.js
  - plugin/bin/lib/express/eligibility.js
---

# Let the Driver Pick Records Under a Budget

**Persona:** a maintainer, or the hub acting on their behalf, with a queue of authorized `auto:build` records and no time to choose among them. They want the driver to take the next few eligible records itself, in the queue's own order, and to say afterwards how many it drove, how many it passed over and why it stopped. Picking a record by hand would be wasted effort.
**Goal:** run one command with a budget and get back the usual per-record event lines for each driven record, followed by one summary line that accounts for every record the run handled.
**Entry point:** `node plugin/bin/drive.js --budget 3` (or `--budget all`, optionally with `--no-settle`) in the main checkout of a repository whose `.claude-tweaks/policy.yml` enables `express-driver`.
**Success state:** the last stdout line is the `step: "budget"` summary. Its `ended` is `budget` or `exhausted` (or `worker-stop`, when implementer launches cannot launch: the run ends early with `status: stop` and exit 0), and its counters sum to every record the run handled. Each driven record has its own final line, as a named run would (journey `drive-a-named-record-to-a-draft-pr-5218`). The exit code is 0.

## Steps

### 1. Give a budget instead of names — a terminal
- **URL:** `node plugin/bin/drive.js --budget 3`, `--budget all`, or `--help`
- **Action:** pass a positive integer (no leading zero) or `all`, once, with no record numbers.
- **Should feel:** like handing over a quota, not a list. One number decides how much work the run may take on.
- **Should understand:**
  - `--budget` and named records are exclusive. Each of these is a usage error, exits 2, and makes no call at all (no policy read, no `gh`):
    - `--budget 0`, a negative or non-integer value, an empty value, or `--budget` as the last argument;
    - `--budget` given twice, or beside a named record;
    - `--in-flight-prs` or `--near-dup-pairs` beside `--budget`: the loop builds both inputs itself (step 3).
  - `--no-settle` applies to each driven record exactly as it does for a named run.
- **Red flags:** a bad budget value that reaches the policy read or `gh`; `--budget 2 #12` silently driving #12.

### 2. Watch it choose — the queue pull and the pre-screen
- **URL:** stderr while the run starts. Per-record event lines on stdout appear only for records the loop hands to the per-record path.
- **Action:** let the loop pull the queue and rank it. Each round is a fresh pull, followed by the module's `next` ranking. The order is dispatch's own, and the grouping is the one dispatch applies under the project's `express-lane` and `express-driver` values (with `express-driver` `split` or `on`, a fast-lane record the driver would take stays a singleton, #6011).
- **Should feel:** cheap where it can be. Records that the pulled data already rules out cost no live fetch, no claim and no budget.
- **Should understand:**
  - The pre-screen calls the eligibility function with the per-record path's own options. It can skip a record but never admit one: an admitted record still goes through fetch, eligibility, admission and claim.
  - A record whose pulled data the pre-screen cannot read takes the full path, and stderr says `drive.js: pre-screen could not read #N (…); taking the full path`.
  - Each counted pre-screen skip writes `drive.js: pre-screen skipped #N (…); no live fetch` to stderr, naming the eligibility reasons. A skipped record leaves no event line, so this line is where to learn which records the summary's `skipped` counted and why.
  - A group the pull excluded as `oversized` or `neighbour-in-flight` is never pre-screened or counted.
  - The queue pull's own side effects are the ones dispatch's pull has: decision lines and Close proposals in the newest `dispatch-standalone` run directory, and a rewrite of the queue-order cache. Its stdout chatter goes to the driver's stderr, so stdout stays JSON lines only.
- **Red flags:**
  - A record driven out of the ranking's order, or driven twice in one invocation.
  - A non-JSON line on stdout.
  - A record skipped that the full path would have admitted.
  - A counted pre-screen skip with no `pre-screen skipped #N` line on stderr.

### 3. Spend the budget — per-record runs
- **URL:** each driven record's event lines (`policy` … `final`) on stdout and in its own `{run-dir}/driver-events.jsonl`
- **Action:** watch records run one at a time, each through the Phase 1 per-record path. A bundle's members run one at a time, in the bundle's order.
- **Should feel:** like a named run, repeated. Nothing about a driven record differs from naming it by hand.
- **Should understand:**
  - Only a record whose claim was obtained and run directory minted consumes budget (`driven`), whatever its outcome.
  - A driven record takes the whole per-record path, its `review` and `merge` steps included wherever the policy turns them on, so its final line can carry `merged` or `armed` as well as `pending-review`, `express-escalated` or `blocked`. Every one of them counts `driven`: the summary has no per-outcome counter, so each record's final line is where its outcome is read.
  - A refusal, a pre-screen skip, a contested claim (`claim-targets.js` exit 3) and any other per-record claim failure cost nothing, and the loop goes on. The other failures are exits 4 and 5, an exit 0 that claimed nothing, a killed claim and a failed mint.
  - A claim stop ends the whole run, because every later claim would meet the same cause: exit 7 is `permission-stop`, and exits 2 and 6 are `claim-stop`. That record gets the claim row's settle, and the rest of the budget goes unused.
  - An implementer launch that cannot launch ends the run as `worker-stop` (#6118): at once when its cause is shared (a launch error, or an authentication, permission, rate-limit or not-logged-in failure), or after two counting launch failures in a row. The record gets a marker-free `shared-cause` comment for a shared cause, and the first record of a two-in-a-row streak has its escalation comment deleted.
  - The run keeps its own list of the PRs it has opened (`dispatch-drain-prs.json` in its `drive-{ts}-{pid}` session temp directory, written `[]` before the first record) and hands it, with the latest pull's `dispatch-near-dup-pairs.json` when one exists, to every record it drives. So a record's merge step holds the merge (`pending-review`, reason `drain-overlap` or `near-duplicate`) while a PR this run opened earlier is still open and shares a changed path or closes a strong near-duplicate partner, as a dispatch drain does. Only this run's own PRs are listed.
  - A list the run cannot trust (a failed write, or a driven record that returned no final line) makes every later record hold as `in-flight-unreadable`, with one stderr line naming the cause. The list file is left in place when the run ends.
- **Red flags:**
  - A refused or contested record that consumed budget.
  - The loop continuing after a claim-targets exit 2, 6 or 7.
  - A pre-screened record that triggered a live fetch.
  - A `merged` or `armed` record counted anywhere but `driven`.
  - A record merged while a PR this run opened earlier is still open and changes the same files.
  - A later record running unheld after the list failed to write.

### 4. Read the summary — the last line
- **URL:** the final stdout line `{ ts, run: null, record: null, step: "budget", status, ms, detail?, budget, driven, refused, skipped, contested, claimFailed, permissionStopped, ended }`
- **Action:** read `ended` to learn why the run stopped, and the six counters to learn what happened to every record the run handled.
- **Should feel:** complete. One line tells an empty queue (`exhausted`, all counters 0) apart from a queue of refused or skipped records. The hub can act on it without reading any other line.
- **Should understand:**
  - `status` follows from `ended`:
    - `ok` for `budget`, `exhausted` and `policy-refused`;
    - `stop` for `permission-stop`, `claim-stop` and `worker-stop`;
    - `fail` for `pull-failed`, which also exits 1.
  - `detail` names the exit code and record for a claim stop, the record or records and closed reason for a `worker-stop`, and the first line of the failure for a failed pull.
  - `express-driver: off` refuses before any pull. A `policy` stop line comes first, then a summary with `ended: policy-refused`, then exit 0.
  - The summary is stdout only. It is never written to a run directory's jsonl.
  - Fields are added and never renamed.
- **Red flags:**
  - A record counted in two counters, or a handled record in none.
  - An empty queue indistinguishable from an all-refused queue.
  - A failed or malformed pull (an empty group included) reported as `exhausted`.

### 5. Know when there is no summary — exit codes and signals
- **URL:** the exit code, or the process's death by signal
- **Action:** when the last stdout line is not a `budget` summary, read the exit code instead.
- **Should feel:** honest. The run never writes a summary it cannot stand behind.
- **Should understand:**
  - An unreadable policy or a refused origin exits 1 with no summary line.
  - An interrupt (Ctrl-C, or a signal to the process group) ends the process by its signal with no summary line. The loop checks for a pending signal after the policy step, before and after each pull, and after each driven record. A record interrupted mid-run gets the named run's interrupt handling (journey `drive-a-named-record-to-a-draft-pr-5218`, step 6).
- **Red flags:**
  - A summary line written after a signal arrived.
  - A summary line on the unreadable-policy path.
  - A `--budget` run that never ends on a queue whose records keep coming back.

## Origin
- Created during the build of #5229 (run `2026-11-13T061542-spec-5229`). The record adds `drive.js --budget <n|all>`, so the driver picks its own records through the dispatch queue-pull module, `rankNext` and the express eligibility pre-screen, and closes with one run-level `budget` summary line.
- The plan review settled three questions (PRC1–3 in the spec): claim exits 2 and 6 end the run (`claim-stop`); the queue pull's side effects are accepted as dispatch has them; and no summary line is written on the exit-1 and interrupt paths.
- Updated at the wrap-up of #5229. Step 2 now names the `pre-screen skipped #N` stderr line the review fix added (b73613a45). Step 3 now says a driven record can also end `merged` or `armed`, since the driver's `review` and `merge` steps landed upstream after this journey was written.
- Updated at the wrap-up of the driver's claim-exit deepening (daa4a8f87): `files:` now lists `plugin/bin/lib/driver/claim-exit.js`, which holds what each `claim-targets.js` exit means. Step 3's counters and run-ending stops are read from its table, so a change there now flags this journey. No step changed.
- Updated during the build of #6118 (run `2026-11-26T065910-record-6118`): the run can end `worker-stop` when implementer launches cannot launch (a shared-cause launch, or two counting launch failures in a row). `files:` now lists `worker.js`, which classifies the launch, and `settle.js`, which settles that stop without the escalation marker and deletes the first record's escalation comment in a two-record stop.
- Updated during the build of #6117 (run `2026-11-26T053027-record-6117`). Step 3 now says the run keeps its own drain-PR list and the pull's near-duplicate pairs, so each driven record's merge gets the drain-overlap hold, and fails closed to `in-flight-unreadable`; step 1 adds the two hold flags to the usage errors. `files:` adds `plugin/bin/lib/driver/merge.js`, which reads the list.
