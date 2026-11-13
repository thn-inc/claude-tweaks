---
files:
  - plugin/bin/queue-pull.js
  - plugin/bin/lib/dispatch/queue-pull.js
  - plugin/skills/dispatch/queue-pull-script.md
  - plugin/skills/dispatch/next-ranking.md
  - plugin/skills/dispatch/mcp-transport.md
  - tests/bin-lib/dispatch/queue-pull.test.js
  - tests/bin-lib/dispatch/queue-pull-oracle.js
---

# Select the Dispatch Queue with the queue-pull CLI

**Persona:** the maintainer building the cutover unit after #5227, who wants a program, not a model reading a 52 KB script, to produce `/claude-tweaks:dispatch`'s queue. Also the pipeline driver (`drive.js`) that will call the CLI once that cutover lands, and the agent in a `gh`-absent cloud sandbox that has to feed it MCP-fetched files.
**Goal:** get the same `dispatch-groups.json`, `dispatch-exclusions.json` and next pick that the embedded `queue-pull-script.md` and `next-ranking.md` scripts produce, from one command with a fixed exit-code contract.
**Entry point:** `node plugin/bin/queue-pull.js --transport gh` (or `--transport files` with the agent's input files), then `node plugin/bin/queue-pull.js --rank`, under the session whose `CLAUDE_CODE_SESSION_ID` the session-scoped files belong to.
**Success state:** the session-scoped files match what the scripts would have written for the same inputs, including every exclusion entry in order, the fast-lane bundles, the near-duplicate pairs, the cross-PR overlap file, the staged Close proposals and the `AUTO`/`Warning:` lines on the script's own streams. `dispatch-next-pick.json` holds the group the ranking script would pick, or `null`. The CLI exits 0, and its stdout carries only what the script prints.

## Steps

### 1. Pull the queue through gh
- **URL:** `plugin/bin/queue-pull.js --transport gh`; `plugin/bin/lib/dispatch/queue-pull.js` (`queuePull`, `PASSES`)
- **Action:** The maintainer runs the CLI with `--transport gh`. It runs the passes in `PASSES` order, the order the script runs them: truncate (keeping `firing` entries), fetch and the queue-order cache check, `blocked`, grouping and `oversized`, the cache write-back, `not-spec-shaped`, `open-pr`, `target-missing`, `shipped`, `unlanded-blocker`/`malformed-blocker`, `neighbour-in-flight`, then the cross-PR overlap and near-duplicate passes. Every exclusion goes through `appendExclusion`.
- **Should feel:** Like running the script, minus the script. Same files, same lines, no extra stdout to read.
- **Should understand:** Parity with the scripts is the contract, defects included. A behaviour that looks wrong (a stale session file reused, a string `labels` stopping the whole pull) is reproduced on purpose and filed as its own record, never fixed in the module alone. The paginated `gh` list calls get the batched timeout (`GH_BATCH_TIMEOUT_MS`), so a slow but healthy queue fetch completes as it would under the unbounded script.
- **Red flags:** An exclusion file written with anything but `appendExclusion` (earlier passes' entries and the Loop's `firing` entries vanish). A queue fetch that stops the pull with exit 4 on a large, healthy queue, which means the 5 s single-call bound came back.

### 2. Pick the next group
- **URL:** `plugin/bin/queue-pull.js --rank [--priority high|medium|low]`; `plugin/bin/lib/dispatch/queue-pull.js` (`rankNext`, `rankFromFiles`)
- **Action:** The maintainer runs `--rank`. It drops every group with a member under an `oversized`, `firing` or `neighbour-in-flight` entry, takes each group's best member (priority band, then oldest `createdAt`) as its representative, applies the optional `--priority` filter, and writes the top group or `null` to `dispatch-next-pick.json`.
- **Should feel:** Silent and exact. Stdout stays empty, because the pick is a whole group of full records that must not reach an agent's context. The pick matches `next-ranking.md` expression for expression.
- **Should understand:** A missing or unreadable `dispatch-exclusions.json` reads as no exclusions, as the script reads it. An unknown `--priority` value exits 1 instead of quietly picking nothing. Omit the flag when no filter is wanted, because an empty value exits 1 too.
- **Red flags:** Anything on stdout from `--rank`. A pick that differs from the script's for snake_case `created_at` timestamps, which means the alias step was skipped.

### 3. Pull from a gh-absent sandbox
- **URL:** `plugin/bin/queue-pull.js --transport files --queue-raw … --dep-freshness … --open-numbers … --verified-open-deps … --in-flight-raw … --in-flight-claims … --foreign-states …`; `plugin/skills/dispatch/mcp-transport.md`
- **Action:** The **agent** fetches the records through MCP tools and writes each input file (the flags default to the session-scoped paths). The claims file covers the claim of every record in the in-flight pool file. It then runs the CLI with `--transport files`. The module copies the queue file into the session file before aliasing its timestamps, so the agent's own file is left as written.
- **Should feel:** Like the gh path, with the agent doing the fetching and Node doing the computing.
- **Should understand:** The documented MCP gaps are behaviour. `dispatch-crosspr-overlap.json` is `[]`, `dispatch-linked-prs.json` stays `{}`, and `open-pr`, `shipped` and `unlanded-blocker` cannot fire on this transport. A missing or malformed in-flight pool or claims file stops the pull (exit 4). A bad `--foreign-states` file (the states file the MCP path passes on the call) excludes each foreign-blocked record as `owner/name#N (state unreadable)`, with fail-closed `Warning:` lines.
- **Red flags:** `--transport gh` silently falling back to files. With `gh` absent it must exit 2 and name the files transport. A claims file covering only the queue's targets, which leaves in-flight neighbours read as not in flight.

### 4. Read a stop and recover
- **URL:** `plugin/bin/queue-pull.js` (exit codes in the header and USAGE)
- **Action:** A pull that cannot continue exits 4 and prints its stop line on stderr. That happens on a corrupt `dispatch-exclusions.json` (left as it was, and no later pass runs), an unreadable `dispatch-groups.json`, a failed queue or open-numbers fetch, or any internal throw, which prints as `queue-pull: <message>`. A fetch the script fails open on prints the script's zero or one `Warning:`/`AUTO` line and the pull exits 0. A failed cache write-back never fails the pull.
- **Should feel:** Diagnosable from the exit code and one stderr line, with no guessing whether a partial run is safe to rank.
- **Should understand:** Exit 3 is reserved and never produced: every remote failure either fails open or stops with 4, exactly as the script does. Exit 1 is a malformed invocation and prints the usage.
- **Red flags:** A partial `dispatch-groups.json` ranked after an exit 4. An exit 4 on a fetch the script fails open on.

### 5. Keep the two implementations equal
- **URL:** `tests/bin-lib/dispatch/queue-pull.test.js` (the parity describes); `tests/bin-lib/dispatch/queue-pull-oracle.js`; the oracle's two bash fences, `plugin/skills/dispatch/queue-pull-script.md` and `plugin/skills/dispatch/next-ranking.md`
- **Action:** A **maintainer editing either script** runs the parity suite. It runs the embedded script under PATH shims for `gh` and `git` and the module over the same canned-response table, on both transports and both cache paths, plus every fetch-failure and files-input fault. It then compares the exit status, every session file, the staged proposals, `decisions.md`, the queue-order cache blob, and the reported lines on both streams: the stop, `AUTO`, `Warning:`, cache, `express-lane:` and `resolve-policy:` lines. Other lines on either stream are not compared as text. A change to a pass lands with the matching module change in the same pull request until the removal unit lands.
- **Should feel:** Like a tripwire. A script edit without the module edit turns the suite red, naming the pair and the file that differ.
- **Should understand:** On win32, or without bash 4 or later, the parity describes skip with `no bash oracle`, and the module's in-process fixtures still run. A `queue-pull: <step>:` diagnostic from the module also fails parity when the script's stderr for the same run shows no error, so a module step that throws and carries on cannot pass as equal.
- **Red flags:** A parity failure fixed by loosening `normalize` or the comparison instead of changing the module. The only permitted exception is the four Node-crash-tail lines, which are compared by their fixed prefix.

## Origin
- Created during `/claude-tweaks:build` of record #5227 (2026-11-12), step 1 of 3 of the queue-selection strangler-fig in `docs/superpowers/specs/2026-11-11-pipeline-driver-design.md`, "Phase 5 — Queue selection in the driver". `/claude-tweaks:dispatch` still runs the embedded scripts; the cutover and the scripts' removal are later records.
- Updated during #5230 (the cutover): `/claude-tweaks:dispatch` now runs this CLI, and step 3's MCP path passes the foreign states as `--foreign-states` rather than `DISPATCH_FOREIGN_STATES`.
- Related journeys: `dispatch-the-oldest-record-from-a-gh-absent-sandbox-3691.md` (the MCP timestamp alias this module reproduces), `drain-the-queue-past-a-chain-of-overlapping-records-3278.md`.
