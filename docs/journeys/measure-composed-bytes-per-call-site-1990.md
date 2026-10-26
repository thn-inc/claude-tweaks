---
files:
  - plugin/bin/lib/skill-audit/context-cost.js
  - plugin/bin/lib/compose-context/phases.js
  - plugin/skills/dispatch/task-prompt.md
  - tests/bin-lib/skill-audit/context-cost.test.js
  - plugin/skills/_shared/harness-health-analysis.md
  - docs/skill-authoring.md
---

# Measure Composed Bytes Per Compose Call Site

**Persona:** claude-tweaks maintainer who has just fenced a `_shared/*.md` contract with `when:` markers, or added a compose call site to a skill step, and wants to know what the reader of that step actually pays — and why the suite is red or green about it.
**Goal:** Run the composed-bytes measurement the hard gate uses, read one row per call site and one column per condition combination, and understand how the Read rail judges each row.
**Entry point:** A terminal at this repo's checkout root; `plugin/` is the plugin root (the directory with `skills/` directly beneath it) — every call below takes that, never the repo root.
**Success state:** A table of composed bytes for every call site under every combination its sources branch on, plus the `unresolved` both-branches row; and a clear reading of `rail.js`'s `composedRailViolations` output.

## Steps

### 1. Print the composed-bytes table — terminal
- **URL:** `node -e 'const c=require("./plugin/bin/lib/skill-audit/context-cost.js");for(const r of c.composedBytesReport("plugin"))console.log(JSON.stringify({step:r.step,file:r.file,line:r.line,max:r.max,combinations:r.combinations,error:r.error}))'`
- **Action:** Run it and read one JSON line per call site.
- **Should feel:** One command answers "what does the merge step cost" for every combination at once.
- **Should understand:** Each row names the skill file and line the call sits on, the step, and `combinations` — one entry per combination of only the keys the sources actually use (today `integration-model` × `transport` for the `merge` bundle: four rows), plus a final row with every used key `unresolved`: that is what a standalone run with no `config.yml` reads, both branches kept, and it is the row `max` comes from. A source with no markers yields a single combination with empty conditions. Unused keys never appear — they cannot change the output. A `--phase` line is not one row but one per bundle its phase registers in `plugin/bin/lib/compose-context/phases.js`, all at the line's own file and line: `dispatch/task-prompt.md`'s `--phase first-call` line gives a `claims` row, its `--phase second-call` line a `claims` row and a `merge` row, and `review/step3-lens-dispatch.md` gives `review-dispatch` — so each registered bundle meets the rail on its own and a phase never hides a large bundle behind a small one. Each source is read CRLF → LF normalized before composing (#3871), so a `core.autocrlf` Windows checkout prints the same bytes as an LF one.
- **Red flags:** A row with `error` (a malformed marker names its file and line; an unreadable source names its path and code; an `unparsed` call names the flag or the repo-relative path that stopped the scanner) — the gate fails on every one of these, never skips them; a combination count that is not `Π |VOCAB[key]| + 1` for the used keys; `max` below any listed row; a row's `file` containing `\` — it is a repo-display ID, `/`-separated on every platform since #2767, so a backslash means a producer bypassed `toPosix` (a row's `sources` are native absolute paths and legitimately carry `\` on Windows); a `--phase` line whose row count differs from the number of bundles `phases.js` registers for that phase.

### 2. Ask the rail what is over it
- **URL:** `node -e 'console.log(JSON.stringify(require("./plugin/bin/lib/skill-audit/rail.js").composedRailViolations("plugin")))'`
- **Action:** Run it; today it prints `[]`.
- **Should feel:** The same question the suite's hard gate asks, answered without running the suite.
- **Should understand:** Each row's `max` is compared against `RAIL_BYTES` (52,500 B, in `plugin/bin/lib/skill-audit/budgets.js` — the Read tool's 25,000-token cap at a calibrated 2.1 B/token), the same bound every raw skill file meets, with no per-step exceptions. `rail.js` is the only reader of composed rows: never call `budgets.js`'s `overRail` on them directly, since they carry `max`, not `bytes`, and `overRail` fails closed. An `error` row comes back as a violation too, so an unmeasured bundle never passes. The `merge` step once carried its own exception until #2002 restructured its two sources — the worked example of the standing response: fence or restructure the sources, never raise the bound.
- **Red flags:** An empty array while Step 1 showed a row over `RAIL_BYTES`; an `error` row from Step 1 missing here; every row reported as a violation — the sign that composed rows went to `overRail` by hand.

### 3. Read the per-file rail check
- **URL:** `node -e 'const r=require("./plugin/bin/lib/skill-audit/rail.js");const c=require("./plugin/bin/lib/skill-audit/context-cost.js");const s=[...c.measureSkills("plugin"),...c.measureSubFiles("plugin")];console.log(JSON.stringify({files:s.length,overRail:r.skillFileRailViolations("plugin"),markerErrors:s.filter(e=>e.markerError).length}))'`
- **Action:** Run it and compare with `node --test tests/bin-lib/skill-audit/context-cost.test.js`'s `rail:` results.
- **Should feel:** One number to watch per file, the Read rail, with nothing below it that can tip a merge red.
- **Should understand:** There is no per-file ceiling or warning tier anymore (decision 0024). A raw file fails only when it cannot be read in one Read call: over `RAIL_BYTES` (52,500 measured bytes) or `RAIL_LINES` (2,000). Bytes are counted after CRLF → LF normalization and with `when:` marker lines stripped, so a `core.autocrlf` checkout and an unrendered marker never inflate them. A file near the rail is cut, or has a genuinely lazy section moved out. Fencing does not shrink a raw file.
- **Red flags:** `markerErrors > 0` (the conformance suite will say the same); a non-empty `overRail` array on a tree whose `rail:` suite passes; a raw `wc -c` used to argue with these numbers on a Windows checkout.

### 4. Add a call site and watch the gate see it
- **URL:** a scratch skill file `plugin/skills/demo/SKILL.md` containing one line: `` Read it as one bundle: `node "${CLAUDE_PLUGIN_ROOT}/bin/compose-context.js" --run "$PIPELINE_RUN_DIR" --step demo "${CLAUDE_PLUGIN_ROOT}/skills/_shared/pr-first-merge.md"` `` (delete the directory afterwards).
- **Action:** Re-run Step 1 and Step 2.
- **Should feel:** The scanner found the new site with no registration anywhere — the call line is the registration.
- **Should understand:** `findComposeCallSites` scans every `plugin/skills/**/*.md` for the single-line call form: `--run <value>` may precede `--step`, the sources are the tokens after the step name, and each must be the install-safe `"${CLAUDE_PLUGIN_ROOT}/…"` form. A call wrapped across lines is not found (keep it on one line — `docs/skill-authoring.md`'s call-site form says so); a line with `{files}`-style placeholders is documentation and is skipped; any other unknown flag or a bare repo-relative source becomes an `unparsed` row that fails the gate rather than a silently unmeasured site.
- **Red flags:** The demo step absent from Step 1's output; an over-rail demo bundle absent from Step 2's output; a repo-relative source resolving instead of failing.

### 5. Add a phase call site and watch the gate expand it
- **URL:** a scratch skill file `plugin/skills/demo/SKILL.md` containing one line per case (delete the directory afterwards): `` `node "${CLAUDE_PLUGIN_ROOT}/bin/compose-context.js" --run "$PIPELINE_RUN_DIR" --phase second-call` ``, then the same line with `--phase nope`, with `--phase second-call extra`, and with `--run "{run}" --phase {phase}`.
- **Action:** Re-run Step 1 and Step 2 after each variant.
- **Should feel:** A phase line costs nothing to register and nothing to forget — the registry names the sources, so the line cannot list the wrong ones.
- **Should understand:** `second-call` gives two rows, `claims` then `merge`, both at `demo/SKILL.md` and the line's number, each measured on its own sources through the same combinations as a `--step` row. The line carries no source tokens: they come from `phases.js`, so a placeholder elsewhere on the line (`--run "{run}"`) does not null it out, whereas a placeholder phase name (`--phase {phase}`) is documentation and yields no row. `--phase nope` gives one `unparsed` row with the error `unknown phase nope`, and `--phase second-call extra` one with `unexpected token after --phase second-call: extra` — both fail the gate rather than going unmeasured. A phase row does not name its phase: it is told apart by `step`, `file` and `line`.
- **Red flags:** The demo's `merge` row absent from Step 1's output; an unknown phase silently producing no row; a phase line measured as a `--step` call with zero sources; a registry edit (a source added to a phase) that does not move the rows without touching any skill file.

## Origin
- Created during build of #1990 (per-step composed-bytes measurement — Phase 1 of #1987's decomposition, U3); steps 1-4 built in this session.
- Related specs: #1987 (parent design; promise F4 carries the merge bundle's byte figures), #1988 (the composer these measurements call), #1989 (the first real call site, `merge`), #1997 (retires the remaining per-file pins), #2002 (restructures the merge bundle's sources and removes its exception), and #3310 (cuts every size consumer over to the rail).
- Updated during build of #3871: step 1 notes composed bytes are CRLF-normalized per source (a Windows checkout measured the `merge` bundle ~670 B over its LF size before the fix).
- Updated during build of #4027: steps 1 and 5. `findComposeCallSites` expands a `--phase` line into one row per bundle in the phase registry (`compose-context.js --phase`, journey `compose-a-per-run-context-bundle-1988.md` step 12), so the `dispatch/task-prompt.md` and `review/step3-lens-dispatch.md` phase lines are measured call sites.
