---
files:
  - plugin/bin/console-resolve.js
  - plugin/bin/lib/console/decision-facts.js
  - plugin/bin/lib/console/residue-convergence.js
  - plugin/bin/lib/console/memory-write.js
  - plugin/bin/lib/console/resolve.js
  - plugin/bin/lib/issues/autonomy.js
  - plugin/bin/lib/stage-item/ledger.js
  - plugin/bin/lib/wrap-up/packet-gather.js
  - plugin/skills/wrap-up/review-console.md
  - plugin/skills/_shared/autonomy-ceiling.md
  - plugin/skills/_shared/ledger-format.md
  - plugin/skills/_shared/acceptance-packet.md
  - plugin/bin/deferral-route.js
  - plugin/skills/_shared/materiality-floor.md
---

# Carry Undecidable Console Items Into the Acceptance Packet

**Persona:** the claude-tweaks maintainer who turned on `control-mode: on` so they only decide at two points, intent and acceptance. They want a finished run to leave nothing behind: no `pending` console items, no `keep-staged` files, no `open` ledger rows. A second persona is the wrap-up agent running the Review Console and the ledger gate in that run.
**Goal:** every item the console or the ledger could not settle by policy ends as a decision the maintainer sees in the acceptance packet, instead of residue they have to find later.
**Entry point:** a `/claude-tweaks:flow` or `/claude-tweaks:dispatch` run whose `.claude-tweaks/policy.yml` sets `control-mode: on` (a run config cannot — the key is `policyOnly`, #5830), reaching `/claude-tweaks:wrap-up`.
**Success state:** the acceptance packet's Decisions left for you lists one line per carried item, `console-residue.js --run` reports nothing for the run, and every ledger row is `fixed`, `accepted` (digested) or `deferred` naming a staged proposal or a `carried to the acceptance packet as {factId}` fact.

## Steps

### 1. (Wrap-up agent) Read the ceiling once
- **URL:** `node "${CLAUDE_PLUGIN_ROOT}/bin/console-resolve.js" --ceiling --run "$PIPELINE_RUN_DIR"`
- **Action:** **Wrap-up agent** runs the query and reads its one line, `ceiling {tier} consoleAutoResolve {true|false} control-mode {on|off} source {...}`.
- **Should feel:** one answer every later step reuses. The console, the ledger gate, the insights step and the memory writes all branch on the same two words.
- **Should understand:**
  - Control mode applies when the line reads `control-mode on` and `consoleAutoResolve true`, whatever the `source`. An explicit `autonomy` value wins over control mode and reports `source explicit`; an explicit lower tier turns the carry route off.
  - Control mode implies the `unattended` capability set and adds exactly one capability, `ownedUpstreamFiling` (#4621), which holds at every ceiling.
  - An invalid `autonomy` value resolves `supervised` with `source invalid-autonomy`. An unreadable policy exits 3.
- **Red flags:**
  - the ledger gate converging while the console renders a human prompt in the same run
  - a `control-mode on` run with an explicit `supervised` treated as control mode

### 2. (Wrap-up agent) Resolve the console and carry what policy cannot decide
- **URL:** the console's one resolve call, then `console-resolve.js --set-item {id} --resolution carried --reason '{why}' [--ledger "{ledger path}"] --run "{item-run-dir}"`
- **Action:** the resolve call settles every policy-resolvable item as at `unattended`. Every item it would have left `pending`, `keep-staged` or `refused` resolves `carried` and is written as a `decision` fact to `{run-dir}/packet-facts/decisions.json`. For a Queue-write, `ledger-record-*` or can't-tell item that carried or whose create failed, the agent runs `--set-item … carried`; a `ledger-record-*` item adds `--ledger`, which settles its row `deferred` with `carried to the acceptance packet as {factId}`.
- **Should feel:** no "Needs a human" block and no question. The console report is informational and every row reads resolved or carried.
- **Should understand:**
  - Can't-tell items still file as records; #3944's tiebreak still runs first.
  - `--resolution carried` and `--ledger` outside control mode exit 2. The ledger writer refuses a `carried` Resolution until its decision fact exists.
  - Exit 6 means a carried fact could not be written; exit 2, 3, 5 or 6 stops with the Generic gate failure card naming each item, never a question.
- **Red flags:**
  - a carried item with no entry in `decisions.json`
  - a `ledger-record-*` row still reading `deferred → staged/…` after its item carried
  - a refusal message saying "nothing written" after the fact landed

### 3. (Wrap-up agent) Converge the remaining ledger rows and insights
- **URL:** `node "${CLAUDE_PLUGIN_ROOT}/bin/console-resolve.js" --converge "{items.json}" --run "$PIPELINE_RUN_DIR"`
- **Action:** **Wrap-up agent** writes every still-`open` ledger row (`ledger-{N}`) and every refused or failed reflection insight (`insight-{row}`) to a JSON file with its `deferReason` and `belowFloor`, runs `--converge` before writing any `carried` row, and acts on each printed `state`: `filed` stages the printed proposal, `digested` appends the digest entry and writes the row `accepted`, `carried` writes the row `deferred` naming the fact id.
- **Should feel:** finite. One call, one state per item, and an AUTO line per item in `decisions.md` (SKIP for a failed one).
- **Should understand:**
  - `--converge` and `--memory-write` hold the same gate as the resolve call in code: with control mode off or `consoleAutoResolve` not granted they exit 4 and write nothing.
  - The four terminal states are `resolved`, `filed`, `digested` and `carried`.
  - `belowFloor` is `true` only when `node "${CLAUDE_PLUGIN_ROOT}/bin/deferral-route.js" … --agent-raised`, run on the item's `deferReason`, prints `digest`, by any rule; it is `false` on `file`, `refused` or any other outcome, and an item with no `deferReason` gets no call and `false`. The agent never judges the floor from prose (#5931). A `digested` ledger row's `accepted` Resolution is the one `_shared/materiality-floor.md`'s digest-label table gives the printed `rule` (#5933).
  - An insight writes no ledger row; a carried insight needs nothing more.
  - A staged `filed` item that later fails to create takes `--set-item … carried --ledger`, never `--converge` again.
- **Red flags:**
  - an `open` ledger row at the end of a control-mode run
  - a `carried` row written before `--converge` wrote its fact

### 4. (Wrap-up agent) Write memory without an approval step
- **URL:** `node "${CLAUDE_PLUGIN_ROOT}/bin/console-resolve.js" --memory-write "{file}" --memory-dir "{memory dir}" --content-file "{temp file}" --run "$PIPELINE_RUN_DIR"`
- **Action:** each `M#` Apply writes the memory file, then `MEMORY.md` with the whole current index plus the new line.
- **Should feel:** reversible. The `decisions.md` entry logs the path, the prior sha256 and a whole-file diff the maintainer can revert from.
- **Should understand:**
  - writes outside the memory directory, through a symlinked parent, or to a missing parent outside it are refused with exit 5 naming the path; exit 3 is an unreadable target or a failed write.
  - the entry tells the maintainer to strip the diff's indent into a patch file and run `git -c core.autocrlf=false apply -R --unidiff-zero {patch}` from the memory directory. The `-c core.autocrlf=false` matters on Windows: `git apply` honours `core.autocrlf` even outside a repository, and Git for Windows defaults it on, so without it the revert would restore CRLF bytes (#5694).
- **Red flags:**
  - a `MEMORY.md` write holding only the one new line
  - a memory write with no logged prior hash
  - a reverted memory file whose bytes differ from the prior content (CRLF line endings after a revert on Windows)

### 5. (Maintainer) Decide the carried items at acceptance
- **URL:** the acceptance packet comment on the record (`acceptance-packet.js gather` reads `{run}/packet-facts/decisions.json` when no `--decision-items` is passed)
- **Action:** **Maintainer** reads Decisions left for you — one line per carried item with its section, why it carried, an evidence path and a suggested resolution — and gives the verdict.
- **Should feel:** the one place to look. Nothing undecided is hiding in `staged/`, the ledger or the next session's residue banner.
- **Should understand:**
  - An `approved` verdict files every open decision the packet lists (`settleOpenDecisions`), so accepting never silently ratifies one, and it never blocks the merge.
  - HARD-GATEs still stop a control-mode run with the Generic gate failure card; the carry route never applies to them.
  - An unreadable `decisions.json` shows as a `partial` note in the packet rather than an empty Decisions section.
- **Red flags:**
  - a packet with an empty Decisions section while `decisions.json` holds entries
  - an accepted packet whose decisions were neither filed nor answered

## Origin
- Created during the build of #4620 (run `2026-11-16T000749-record-4620`): `console-resolve.js --ceiling`, `--set-item … carried`, `--converge` and `--memory-write`, `lib/console/decision-facts.js`, `lib/console/residue-convergence.js`, `lib/console/memory-write.js`, and the control-mode branches in `wrap-up/review-console.md` and `_shared/ledger-format.md`.
- Updated during the build of #5694 (run `2026-11-16T094458-record-5694`): Step 4 names the printed revert command, now read from `MEMORY_REVERT_COMMAND` in `lib/console/memory-write.js`, with `core.autocrlf` off.
- Updated at the wrap-up of #5930-#5933: step 3 says how `belowFloor` is set (a `deferral-route.js` `digest` verdict, any rule) and that a digested row's Resolution follows the digest-label table; `files:` gains `plugin/bin/deferral-route.js` and `plugin/skills/_shared/materiality-floor.md`.
- Related journeys: `recover-a-queue-write-the-unattended-console-could-not-file-4170.md` covers the non-control-mode `keep-staged` rewrite this route replaces. `accept-built-work-via-demo.md` covers the acceptance verdict itself.
