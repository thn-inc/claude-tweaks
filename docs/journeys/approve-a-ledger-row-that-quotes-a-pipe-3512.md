---
files:
  - plugin/bin/lib/wrap-up/ledger-cells.js
  - plugin/bin/lib/wrap-up/ledger-write.js
  - plugin/bin/lib/wrap-up/pack.js
  - plugin/bin/claude-tweaks-statusline.js
  - plugin/bin/wrap-up-engine.js
  - plugin/skills/_shared/ledger-format.md
  - plugin/skills/ledger/SKILL.md
  - plugin/skills/build/dispatch.md
  - plugin/skills/review/step3-routing.md
---

# Approve a Ledger Row That Quotes a Pipe

**Persona:** A claude-tweaks maintainer reaching the Wrap-Up Review Console at the end of a `/flow` run. During the build an agent carried an SDD ruling into the open-items ledger, and that ruling's text quotes a regex alternation (`a|b|c`) or a table fragment.
**Goal:** Choose Approve all and have every step of `finish-console --approve-all` land, the ledger flip included, without first editing the ledger by hand to remove pipes.
**Entry point:** An agent appending a ledger row (`/claude-tweaks:ledger` Add Item, `build/dispatch.md`'s SDD carry-forward, or `review/step3-routing.md`'s finding append) whose Item or Resolution text contains `|`.
**Success state:** The row stays a 5-column table row: the pipe is written `\|`, GitHub renders it as a literal `|`, and every reader gets the original text back. Approve all completes all three `finish-console` steps: `verify-expectations.json`, the decision log, and the ledger flip. The statusline's `ledger: N open` count and the wrap-up pack's `parseLedger` counts both read the row correctly.

## Steps

### 1. Write the row with the pipe escaped
- **URL:** `docs/plans/{date}-{slug}-ledger.md` (or `{run-dir}/ledger.md`)
- **Action:** Append the row as usual, writing every `|` inside an Item or Resolution cell as `\|`, per `_shared/ledger-format.md`'s Format section. Each writer's own instructions cite that rule rather than restating it.
- **Should feel:** Like writing any other row. One escape, applied once, and the file still reads naturally on GitHub.
- **Should understand:** A raw `|` inside a cell creates an extra column. A row with a raw pipe no longer has five columns, and nothing downstream can tell which cell is which.
- **Red flags:** A ruling one-liner copied in with a raw `a|b`. A double-escaped `\\|` written by hand into a `finish-console` payload (the payload's `resolution` is passed raw; the CLI escapes it).

### 2. See the row counted correctly before wrap-up
- **URL:** the statusline's `ledger: N open` segment, and `jq .ledger.value "$PIPELINE_RUN_DIR/wrap-up-pack.json"`
- **Action:** Glance at the open count, then read the pack's `open` / `total` / `unrecognized` / `missingDeferReason` fields.
- **Should feel:** Unremarkable. An escaped pipe changes nothing about how the row is counted.
- **Should understand:** Both readers split a row only on an unescaped `|` (`bin/lib/wrap-up/ledger-cells.js`'s `splitLedgerRow` / `ledgerRowCells`), so the Status cell is always the fourth column. `parseLedger` still finds a `Defer-reason:` in a Resolution that quotes a pipe.
- **Red flags:** An open row missing from the statusline count. `unrecognized > 0` for a row whose Status reads `open` or `deferred`.

### 3. Approve all at the Review Console
- **URL:** the console's terminal `AskUserQuestion`, then `wrap-up-engine.js finish-console --run-dir <dir> --approve-all`
- **Action:** Choose Approve all. The console pipes its payload, including `ledger: [{item, status, resolution}]` entries, into `finish-console`.
- **Should feel:** One click, one result. The console finishes, with no step-3 failure message and no half-applied state to reconcile.
- **Should understand:** `flipLedgerRow` rewrites only the Status and Resolution cells. It escapes any `|` in the resolution it writes and collapses line breaks to one space, so the flipped row stays a single 5-column line. The Item cell, `\|` included, is left byte-for-byte as it was.
- **Red flags:** `finish-console: ledger pre-flight failed at ledger[i]: ledger row for item #N does not have the expected 5-column shape … — nothing written`. The error names the `\|` rule and the Format section: it means some writer appended a raw pipe. `finish-console` checks every flip before its first write, so the refusal leaves `verify-expectations.json`, `decisions.md` and the ledger untouched. Fix that row by escaping the pipe, then re-run Approve all; the re-run logs the console's decision lines once.

### 4. Confirm the flipped row reads back as written
- **URL:** the same ledger file, the row the payload named
- **Action:** Check the row: Status is the approved value, Resolution is the console's text, and the Item cell still shows the original quoted alternation.
- **Should feel:** Closed-loop. The ruling's own words survived the round trip.
- **Should understand:** Escape and unescape are exact inverses, even for text that already contained a literal `\|` such as a `grep` pattern. That is why a ruling quoting a sed or grep command reads back unchanged.
- **Red flags:** A Resolution split across two lines. An Item cell that lost its backslash or gained an extra one.

## Origin
- Created during the build of #3512 (make ledger rows pipe-safe — a `|` in an Item or Resolution cell broke `finish-console`'s step-3 flip), run `2026-10-19T232504-record-3512`.
- All steps were built in this session. The producer that made this common is #3401's SDD ruling carry-forward, whose `Ruling:` one-liners routinely quote regexes.
- Updated during the build of #3684, run `2026-10-20T185239-record-3684`. A row written *without* the rule (a raw pipe) used to make step 3 fail after steps 1-2 had landed. `finish-console` now pre-flights every flip before step 1, so the same row refuses with nothing written (step 3's Red flags).
- Related: `docs/journeys/ratify-or-reverse-an-sdd-ruling-at-the-review-console-3401.md` (the ruling rows this protects) and `docs/journeys/close-a-run-whose-ledger-holds-an-incomplete-deferral-3327.md` (the same `parseLedger` reader).
