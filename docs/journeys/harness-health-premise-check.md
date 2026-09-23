---
files:
  - plugin/bin/harness-health.js
  - plugin/bin/lib/harness-health/issue-payload.js
  - plugin/bin/lib/harness-health/scope.js
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

### 3. The issue is filed with (or without) the line
- **URL:** N/A
- **Action:** `specShapedBody` renders `Premise-check: {command}` right after `Verified-as-of:` when `buildPremiseCheck` returned a command, and omits it entirely (never an empty line) when it returned `undefined`.
- **Should feel:** Consistent — a filed harness-health issue looks exactly like any other health-skill issue, with one optional extra metadata line.
- **Should understand:** `finding.path` never appears as a durable field anywhere else — it isn't stored in the dedup cache, doesn't affect fingerprinting, and a judge subagent should never emit it itself (it's CLI-injected downstream of the finding JSON the judge writes).
- **Red flags:** None of the four other health skills (docs-health, journey-health, code-health) are wired to this yet — a `Premise-check:` line only ever appears on a harness-health-filed issue today.

### 4. A later build reads the stamp before planning any work
- **URL:** N/A (`/claude-tweaks:build`'s Spec Step 1/2, `materialize.js`)
- **Action:** When the record is picked up for a build, `materialize.js` runs the filed `Premise-check:` command (author-association-gated) against the checkout's live content. A non-zero exit (the check's own "resolved" polarity) sets `premise.satisfiedAtBase: true`, which routes the record straight to a staged close proposal instead of planning a build.
- **Should feel:** A relief when it fires correctly — the record closes itself instead of a human (or an implementer) rediscovering the fix was already made.
- **Should understand:** This machinery already existed and is already in production for one other filing site (`wrap-up/claude-md-curation.md`) — this feature is a second producer feeding the same consumer, not new consumer logic.
- **Red flags:** A false "already resolved" here is the one failure mode the whole feature exists to prevent — see the cross-target and fail-safe-removal red flags above. If a record with real remaining work ever gets auto-staged for close, check whether its finding's `Premise-check:` command was anchored against the wrong file or a file that couldn't be read at filing time.

## Origin
- Created during build of #2621 (thread `Premise-check:` through harness-health's `toIssuePayload`)
- All 4 steps built in this session, including a whole-branch-review fix wave (cross-target anchoring guard, fail-safe removal check on an unreadable target, `--memory-dir` wiring)
- Related: #1829 (the underlying premise-check machinery, first shipped for `claude-md-curation.md`), #2633 (follow-up: self-validate the composed command at filing time, filed as a deferred backlog item)
