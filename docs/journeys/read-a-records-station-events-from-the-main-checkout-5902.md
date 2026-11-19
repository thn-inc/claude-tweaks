---
files:
  - plugin/bin/lib/station-events/emit.js
  - plugin/bin/lib/station-events/stations.js
  - plugin/bin/lib/station-events/driver-mirror.js
  - plugin/bin/lib/station-events/blockers.js
  - plugin/bin/claim-targets.js
  - plugin/bin/release-claim.js
  - plugin/bin/resolve-blockers.js
  - plugin/bin/accept-park.js
  - docs/reference/station-events.md
---

# Read a Record's Station Events From the Main Checkout

**Persona:** Maintainer of the dispatch factory floor (or any tool that reads claude-tweaks pipeline state) who needs to know where a record is in the pipeline without parsing skill prose, run directories or the driver's private event log.
**Goal:** Read one append-only file, `.claude-tweaks/station-events.jsonl` in the main checkout, and trust that every line is a transition the program code actually made, that replaying a transition never double-counts it, and that an unwritable file never changes what a claim, release, blocker check or driver run does.
**Entry point:** A terminal at the plugin checkout root, with `docs/reference/station-events.md` open for the field list.
**Success state:** Two emits of one transition leave two lines with one `eventKey`; a read-only `.claude-tweaks` directory makes the emitter drop the event with one stderr line instead of throwing; and a claim from a linked worktree lands its `session_bound` line in the main checkout's file, not the worktree's.

## Steps

### 1. Emit one transition twice and read the lines — terminal, `plugin/bin/lib/station-events/emit.js` directly
- **URL:** `node -e "const fs=require('fs'),os=require('os'),path=require('path');const {appendStationEvent,stationEventPath}=require('./plugin/bin/lib/station-events/emit');const root=fs.mkdtempSync(path.join(os.tmpdir(),'se-'));const ev={repoName:'acme/widgets',recordNumber:999,kind:'session_bound',station:'build',lane:'unknown',sessionId:'sess-1',runId:'run-a',payload:{},discriminator:'claim:t0'};appendStationEvent(ev,{mainRoot:root});appendStationEvent(ev,{mainRoot:root});console.log(fs.readFileSync(stationEventPath(root),'utf8'))"`
- **Action:** Run from the checkout root. `mainRoot` is injected so the scratch directory stands in for the main checkout; the real CLIs resolve it with `mainCheckoutRoot`. The caller supplies the stable `discriminator` (a claim's `claimedAt`, a driver step index); the emitter never reads the clock for it.
- **Should feel:** Boring and exact. The file is the contract, so one line per call with no decoration.
- **Should understand:** stdout prints two JSON lines with the same key set — `v`, `eventKey`, `repoName`, `recordNumber`, `kind`, `station`, `at`, `outcome`, `lane`, `sessionId`, `runId`, `payload` — the same `eventKey` on both, `at` ending in `Z`, and `outcome` `null` because only an `exited` event carries one. The duplicate is the consumer's to drop by `eventKey`: the emitter appends, it never reads the file back.
- **Red flags:** Two different `eventKey`s for the same transition (a clock or counter leaked into the key); an extra or missing field; a non-UTC `at`; a read of the existing file before the append.

### 2. Make the file unwritable and watch the event drop without a failure — terminal, same module
- **URL:** `node -e "const fs=require('fs'),os=require('os'),path=require('path');const {appendStationEvent,stationEventPath}=require('./plugin/bin/lib/station-events/emit');const root=fs.mkdtempSync(path.join(os.tmpdir(),'se-ro-'));fs.mkdirSync(path.join(root,'.claude-tweaks'));fs.chmodSync(path.join(root,'.claude-tweaks'),0o555);appendStationEvent({repoName:'acme/widgets',recordNumber:999,kind:'session_bound',station:'build',lane:'unknown',sessionId:'s',runId:'run-a',payload:{},discriminator:'claim:t0'},{mainRoot:root});console.log('survived; file exists:',fs.existsSync(stationEventPath(root)))"`
- **Action:** Run from the checkout root. The `.claude-tweaks` directory already exists but is read-only, the realistic shape of a locked-down main checkout.
- **Should feel:** Quiet. A pipeline run must never learn that its bookkeeping file was unwritable.
- **Should understand:** stderr carries exactly one line, `claude-tweaks: station event dropped: append failed: EACCES: …station-events.jsonl`, stdout prints `survived; file exists: false`, and the process exits `0`. The same holds inside `claim-targets.js`, `release-claim.js`, `resolve-blockers.js` and a driver run: stdout and exit code are byte-identical to a run with no emitter (pinned by `tests/bin-lib/station-events/failure-isolation.test.js`).
- **Red flags:** An exception or non-zero exit; more than one stderr line per dropped event; a half-written `station-events.jsonl`; the emitter turning a failed append into a changed claim or release result.

### 3. Claim a record from a linked worktree and find the event in the main checkout — terminal inside a worktree
- **URL:** `node "$PLUGIN_ROOT/bin/claim-targets.js" 999 --run "$PIPELINE_RUN_DIR" --lane driver`, then `tail -n 1 "$(git rev-parse --path-format=absolute --git-common-dir)/../.claude-tweaks/station-events.jsonl"`
- **Action:** Run a real claim from a session whose cwd is a linked worktree (`.claude/worktrees/…`). `CLAUDE_CODE_SESSION_ID` is read from the environment. `--lane` is passed only by the driver; any other caller leaves the lane `unknown`.
- **Should feel:** The worktree stays clean. Nothing about the run shows up in `git status`.
- **Should understand:** The last line of the main checkout's file is a `session_bound` at station `build` for record 999 whose `sessionId` equals `CLAUDE_CODE_SESSION_ID`, followed by the claim's `bot:in-progress` transitions; the worktree has no `.claude-tweaks/station-events.jsonl` of its own. Claiming records 1, 2 and 3 in one session writes three `session_bound` lines with the same `sessionId`. On a driver run the worker's own `session_bound` supersedes the claim's for that record (`docs/reference/station-events.md`).
- **Red flags:** The file appearing under the worktree (`mainCheckoutRoot` bypassed); a `sessionId` of `null` when the variable is set; a `session_bound` written before the claim landed, or for a record whose claim was refused.

## Origin
- Created during build of record #5902 (station events: program code appends one line per pipeline transition to the main checkout's `.claude-tweaks/station-events.jsonl` for the factory-floor ledger).
- Steps 1 and 2 were run live in this session against the worktree's `emit.js` (two lines with one `eventKey`; a read-only `.claude-tweaks` dropped with one `EACCES` stderr line and no throw). Step 3 is pinned by `tests/bin-lib/claim-targets/cli.test.js` and the linked-worktree case in `tests/bin-lib/station-events/emit.test.js` rather than re-run against a live claim, which would write a real claim record.
