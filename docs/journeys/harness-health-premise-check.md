---
files:
  - plugin/bin/harness-health.js
  - plugin/bin/lib/harness-health/issue-payload.js
  - plugin/bin/lib/harness-health/scope.js
  - plugin/bin/lib/health-core/premise-self-check.js
  - plugin/skills/harness-health/SKILL.md
---

# Harness-Health Premise-Check Filing

**Persona:** Developer or scheduled Routine maintaining the claude-tweaks plugin who runs `/claude-tweaks:harness-health`, and the later `/claude-tweaks:build` session that picks up a filed finding.
**Goal:** A filed harness-health patch finding carries a `Premise-check:` command so `materialize.js` can auto-detect, before a build starts, that the finding's Current State claim no longer holds — without relying solely on the `Verified-as-of` staleness age or a manual grep.
**Entry point:** `/claude-tweaks:harness-health`'s own Step 6 (`validate-findings`), invoked once per audited target after the judge subagent writes its findings JSON.
**Success state:** A qualifying patch finding's filed GitHub issue body contains a `Premise-check:` line whose command correctly reflects whether the finding is still open; a finding that can't be safely anchored (new-skill, unresolvable target, oversized/multi-line content, or a cross-target mismatch) carries no such line rather than a wrong one.

## Steps

### 1. `validate-findings` resolves the target's file path
- **URL:** N/A (CLI: `node bin/harness-health.js validate-findings <findings.json> --root <dir> --target <id> --kind <kind> [--memory-dir <path>]`)
- **Action:** `harness-health/SKILL.md`'s Step 6 command line invokes this CLI, forwarding `${MEMORY_DIR:+--memory-dir "$MEMORY_DIR"}` alongside `--target`/`--kind` whenever `MEMORY_DIR` is set. Before processing any finding, the CLI resolves those flags to the real file `scope.js`'s `resolveTargetPath` scanned it from — once for the whole batch, not per finding.
- **Should feel:** Invisible — this is plumbing a finding's own JSON never carries (only an asset-type + id, never a path).
- **Should understand:** A finding only resolves a path when its own `assetType`/`target` match the CLI's `--kind`/`--target` — a gap-scan's new-skill candidates folded into another target's findings file (a documented SKILL.md shape) never get anchored against the wrong file.
- **Red flags:** If the target can't be resolved (unknown id, or `--memory-dir` omitted for a memory audit), the path stays unresolved for every finding in the batch — this must degrade silently to no `Premise-check:` line downstream, never throw or crash the run.

### 2. A patch finding's `Premise-check:` command is composed
- **URL:** N/A
- **Action:** `toIssuePayload` calls `buildPremiseCheck(finding, finding.path)`. An additive finding (proposing new/replacement text) gets `! grep -qF -- '<newString>' '<path>'` — exits 0 while the string is absent (unresolved), non-zero once present (resolved). A removal finding (`intent: "remove"`) gets the mirrored `! test -r '<path>' || grep -qF -- '<oldString>' '<path>'` — exits 0 while the old string is still present *or* the file can't be read (both read as "unresolved"), non-zero only once the string is genuinely gone.
- **Should feel:** Exact — the composed command is a real, safe shell command, not a description of one.
- **Should understand:** Every interpolated value (the anchor string, the path) is single-quote-escaped (`shQuote`), and `grep -F --` prevents both shell injection and a leading-dash anchor being read as a flag.
- **Check:** for a hand-built finding, run the composed `Premise-check:` command's text directly (`sh -c '<command>'; echo $?`) against the actual target file and confirm the exit code matches the finding's real resolved/unresolved state.
- **Red flags:** A `kind: "new-skill"` finding must never carry a `Premise-check:` line (no existing content to check against) — regardless of `finding.path`. An anchor string that's empty, contains a newline, or exceeds ~400 characters must degrade to no line rather than a malformed or falsely-passing one.

### 3. The composed command is self-checked once, at filing time
- **URL:** N/A (`validate-findings` injects `health-core/premise-self-check.js`'s `premiseReadsUnresolved` into `toIssuePayload`)
- **Action:** Before the issue body is composed, the CLI runs the command from step 2 once via `/bin/sh -c` from `--root`, with the same 5 s bound `materialize.js` uses. Exit 0 ("still unresolved") keeps the line exactly as composed; a non-zero exit, a timeout, or a spawn error drops it.
- **Should feel:** Invisible when the finding is genuine; a quiet guard when it isn't — a finding whose proposed text already appears in the target file (a short, generic anchor) is filed without a `Premise-check:` line instead of auto-closing on its very first materialize.
- **Should understand:** The drop always errs toward "no auto-close" — losing the line only costs the automatic close-detection for that one record, while keeping a line that already reads "resolved" would close a finding whose work was never done. `buildPremiseCheck` itself stays pure; only the CLI injects the real shell runner, so `toIssuePayload`'s own unit tests never spawn a shell.
- **Check:** file a finding whose `newString` already exists in the target skill file and confirm the emitted payload body has no `Premise-check:` line; a finding whose `newString` is absent still carries the line byte-for-byte. A dropped line is never silent on the sweep's own terminal: `validate-findings` writes one stderr line per drop, `[harness-health] validate-findings: dropped Premise-check: line for finding {id} — the command does not read "unresolved" at filing time (non-zero exit, timeout, or spawn error)` — the first place to look when a filed issue is missing its `Premise-check:` line.
- **Red flags:** A kept line whose target path isn't absolute. `validate-findings` resolves `--root` to an absolute path first, so a relative `--root` can't leave the self-check (run with `cwd: --root`) reading the wrong file. Every other health skill still files without this step, since none composes a `Premise-check:` line.

### 4. The issue is filed with (or without) the line
- **URL:** N/A
- **Action:** `specShapedBody` renders `Premise-check: {command}` right after `Verified-as-of:` when a command survived steps 2-3, and omits it entirely (never an empty line) when `buildPremiseCheck` returned `undefined` or the self-check dropped it.
- **Should feel:** Consistent — a filed harness-health issue looks exactly like any other health-skill issue, with one optional extra metadata line.
- **Should understand:** `finding.path` never appears as a durable field anywhere else — it isn't stored in the dedup cache, doesn't affect fingerprinting, and a judge subagent should never emit it itself (it's CLI-injected downstream of the finding JSON the judge writes).
- **Red flags:** None of the four other health skills (docs-health, journey-health, code-health) are wired to this yet — a `Premise-check:` line only ever appears on a harness-health-filed issue today.

### 5. A later build reads the stamp before planning any work
- **URL:** N/A (`/claude-tweaks:build`'s Spec Step 1/2, `materialize.js`)
- **Action:** When the record is picked up for a build, `materialize.js` runs the filed `Premise-check:` command (author-association-gated) against the checkout's live content. A non-zero exit (the check's own "resolved" polarity) sets `premise.satisfiedAtBase: true`, which routes the record straight to a staged close proposal instead of planning a build.
- **Should feel:** A relief when it fires correctly — the record closes itself instead of a human (or an implementer) rediscovering the fix was already made.
- **Should understand:** This machinery already existed and is already in production for one other filing site (`wrap-up/claude-md-curation.md`) — this feature is a second producer feeding the same consumer, not new consumer logic.
- **Red flags:** A false "already resolved" here is the one failure mode the whole feature exists to prevent — see the cross-target, fail-safe-removal, and filing-time self-check red flags above. If a record with real remaining work ever gets auto-staged for close, check whether its finding's `Premise-check:` command was anchored against the wrong file, a file that couldn't be read at filing time, or an anchor that only became present after filing (the self-check in step 3 already rules out one that was present *at* filing time). The opposite failure is quiet: the filed command carries the absolute target path of the checkout that filed it, and `materialize.js` runs it from whichever checkout builds the record, so a finding filed from a scheduled Routine's sandbox or another machine always reads "unresolved" there — it fails safe, but the auto-close never fires. A record that never closes itself despite the fix being on the base branch is this known limitation (tracked in #2857), not a broken self-check.

## Origin
- Created during build of #2621 (thread `Premise-check:` through harness-health's `toIssuePayload`)
- All 4 steps built in this session, including a whole-branch-review fix wave (cross-target anchoring guard, fail-safe removal check on an unreadable target, `--memory-dir` wiring)
- Related: #1829 (the underlying premise-check machinery, first shipped for `claude-md-curation.md`)
- Updated during build of #2633: added step 3 (filing-time self-check via `health-core/premise-self-check.js`) and renumbered the filing/build steps to 4-5
