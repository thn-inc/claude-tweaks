---
files:
  - plugin/bin/lib/skill-audit/context-cost.js
  - tests/bin-lib/skill-audit/context-cost.test.js
  - plugin/skills/_shared/harness-health-analysis.md
  - docs/skill-authoring.md
---

# Measure Composed Bytes Per Compose Call Site

**Persona:** claude-tweaks maintainer who has just fenced a `_shared/*.md` contract with `when:` markers, or added a compose call site to a skill step, and wants to know what the reader of that step actually pays — and why the suite is red or green about it.
**Goal:** Run the composed-bytes measurement the hard gate uses, read one row per call site and one column per condition combination, and understand the per-step exception map and the per-file warning tier the gate replaced.
**Entry point:** A terminal at this repo's checkout root; `plugin/` is the plugin root (the directory with `skills/` directly beneath it) — every call below takes that, never the repo root.
**Success state:** A table of composed bytes for every call site under every combination its sources branch on, plus the `unresolved` both-branches row; a clear reading of `overComposedCeiling`'s output; and a per-file warning list that no longer fails anything.

## Steps

### 1. Print the composed-bytes table — terminal
- **URL:** `node -e 'const c=require("./plugin/bin/lib/skill-audit/context-cost.js");for(const r of c.composedBytesReport("plugin"))console.log(JSON.stringify({step:r.step,file:r.file,line:r.line,max:r.max,combinations:r.combinations,error:r.error}))'`
- **Action:** Run it and read one JSON line per call site.
- **Should feel:** One command answers "what does the merge step cost" for every combination at once.
- **Should understand:** Each row names the skill file and line the call sits on, the step, and `combinations` — one entry per combination of only the keys the sources actually use (today `integration-model` × `transport` for the `merge` bundle: four rows), plus a final row with every used key `unresolved`: that is what a standalone run with no `config.yml` reads, both branches kept, and it is the row `max` comes from. A source with no markers yields a single combination with empty conditions. Unused keys never appear — they cannot change the output.
- **Red flags:** A row with `error` (a malformed marker names its file and line; an unreadable source names its path and code; an `unparsed` call names the flag or the repo-relative path that stopped the scanner) — the gate fails on every one of these, never skips them; a combination count that is not `Π |VOCAB[key]| + 1` for the used keys; `max` below any listed row.

### 2. Ask the gate what is over its ceiling
- **URL:** `node -e 'const c=require("./plugin/bin/lib/skill-audit/context-cost.js");console.log(JSON.stringify(c.overComposedCeiling(c.composedBytesReport("plugin"))))'`
- **Action:** Run it; today it prints `[]`.
- **Should feel:** The same question the suite's hard gate asks, answered without running the suite.
- **Should understand:** Every combination is compared against `CEILING_BYTES` (40,960) unless the step carries an entry in `COMPOSED_STEP_EXCEPTIONS` — today `claims: 45 * 1024`, because the `claims` bundle is already over the ceiling under every combination (its restructuring is a separate record, #2289). The `merge` step carried its own exception (`59 * 1024`) from this gate's own landing until #2002 restructured its two sources and removed the entry — the worked example of how an exception is meant to end. An exception is provisional: the stale-exception test fails the moment the step fits under 40 KB (remove the entry) or the exception sits more than 4 KiB above the measured maximum (shrink it), so the map can never become a blank cheque. Never raise `CEILING_BYTES`; fence or restructure the sources.
- **Red flags:** An empty array while Step 1 showed a row over 40 KB with no exception entry; an exception whose step name is not a real call site (the stale-exception test catches it); a `toString`-style step name silently passing (the lookup is own-property only).

### 3. Read the per-file warning tier
- **URL:** `node -e 'const c=require("./plugin/bin/lib/skill-audit/context-cost.js");const s=[...c.measureSkills("plugin"),...c.measureSubFiles("plugin")];console.log(JSON.stringify({files:s.length,over:c.overCeilingWarnings(s),near:c.nearCeiling(s).length,markerErrors:s.filter(e=>e.markerError).length}))'`
- **Action:** Run it and compare with `node --test tests/bin-lib/skill-audit/context-cost.test.js`'s `WARNING:` lines.
- **Should feel:** The old per-file 40 KB test is still telling you about headroom — it just no longer blocks a merge.
- **Should understand:** Since #1990 the per-file ceiling is a warning tier (`overCeilingWarnings`, plus the 90 % band `nearCeiling`), because a file that carries both branches of a condition is not what a reader pays — the composed bundle is. Bytes are counted after CRLF → LF normalization and with `when:` marker lines stripped, so a `core.autocrlf` checkout and an unrendered marker never inflate the number (#1880). A malformed marker is reported on the entry as `markerError`, never thrown. The `/specify` 28 KB single-read pin and the description budgets are separate concerns and stay hard.
- **Red flags:** `markerErrors > 0` (the conformance suite will say the same); a warning line treated as a reason to trim prose that a `when:` fence would remove from the bundle instead; a raw `wc -c` used to argue with these numbers on a Windows checkout.

### 4. Add a call site and watch the gate see it
- **URL:** a scratch skill file `plugin/skills/demo/SKILL.md` containing one line: `` Read it as one bundle: `node "${CLAUDE_PLUGIN_ROOT}/bin/compose-context.js" --run "$PIPELINE_RUN_DIR" --step demo "${CLAUDE_PLUGIN_ROOT}/skills/_shared/pr-first-merge.md"` `` (delete the directory afterwards).
- **Action:** Re-run Step 1 and Step 2.
- **Should feel:** The scanner found the new site with no registration anywhere — the call line is the registration.
- **Should understand:** `findComposeCallSites` scans every `plugin/skills/**/*.md` for the single-line call form: `--run <value>` may precede `--step`, the sources are the tokens after the step name, and each must be the install-safe `"${CLAUDE_PLUGIN_ROOT}/…"` form. A call wrapped across lines is not found (keep it on one line — `docs/skill-authoring.md`'s call-site form says so); a line with `{files}`-style placeholders is documentation and is skipped; any other unknown flag or a bare repo-relative source becomes an `unparsed` row that fails the gate rather than a silently unmeasured site.
- **Red flags:** The demo step absent from Step 1's output; an over-ceiling demo bundle absent from Step 2's output; a repo-relative source resolving instead of failing.

## Origin
- Created during build of #1990 (per-step composed-bytes measurement — Phase 1 of #1987's decomposition, U3); steps 1-4 built in this session.
- Related specs: #1987 (parent design; promise F4 carries the merge bundle's byte figures), #1988 (the composer these measurements call), #1989 (the first real call site, `merge`), #1997 (retires the remaining per-file pins in `merge-size-probe.js` and `plan-audit/checks.js`), and #2002 (brings the merge bundle under the ceiling and removes its exception).
