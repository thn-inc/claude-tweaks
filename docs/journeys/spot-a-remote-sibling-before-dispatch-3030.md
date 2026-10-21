---
files:
  - plugin/bin/lib/hooks/sibling-sessions.js
  - plugin/bin/hooks.js
  - plugin/skills/dispatch/sibling-session-check.md
  - plugin/skills/_shared/run-resume-freshness.md
---

# Spot a Sibling on Another Machine Before Dispatch Sets Up a Worktree

**Persona:** A maintainer who runs `/claude-tweaks:dispatch #{n}` from a laptop while a cloud session or a second machine may already have claimed the same record, sometimes without any worktree on this host.
**Goal:** Learn that someone already holds the record before dispatch mints a run directory, creates a worktree and launches a Task, rather than finding out only when flow Step 2.8's claim is contested inside that Task.
**Entry point:** `/claude-tweaks:dispatch #{n}` (or a bare drain). Step 4 runs `node "${CLAUDE_PLUGIN_ROOT}/bin/hooks.js" check-sibling-sessions --record {n}` for each group member.
**Success state:** When another session holds a live claim on the record, the check prints one `sibling session may already hold record {n}` line that names the holding run, session, host and claim time, and dispatch stops the automated claim for that group. Nothing is minted and no worktree is created.

## Steps

### 1. Dispatch runs the sibling check per group member (terminal)
- **URL:** `node "${CLAUDE_PLUGIN_ROOT}/bin/hooks.js" check-sibling-sessions --record {n}`
- **Action:** Dispatch runs the check before any run-dir mint or claim write. It checks local locked worktrees first. Only when none matches does it read the record's claims-registry blob: one single-ref `git fetch` of `claims-registry`, with a contents-API fallback.
- **Should feel:** Like the usual quick check when nothing is wrong. The extra read happens only when no local sibling was found.
- **Should understand:** The worktree-lock line still wins and prints unchanged when a local locked worktree names the record. The claim read is the remote-facing half for siblings this host cannot see. `--record` accepts the record as `{n}` or `#{n}`. One leading `#` on a numeric ref is stripped before both halves run, so `--record "#77"` finds a live worktree on `worktree-dispatch-record-77` exactly as `--record 77` does. A slug ref is matched as written.
- **Red flags:**
  - The claim read running even though a local worktree already matched.
  - The worktree-lock line's wording changing.
  - A slug ref (`flow-spec-12`) triggering any network read.
  - `--record "#{n}"` printing `no sibling-session conflict found` (or reaching the claim read) while `--record {n}` reports a live worktree for the same record.

### 2. Read the live-claim line (terminal)
- **URL:** the check's stdout, `claude-tweaks: sibling session may already hold record {n} — live claim by run {run-id} (session {id}, host {host}, claimed {iso}); verify before claiming`
- **Action:** **The maintainer** reads the holder identity. Dispatch stops the automated claim for this group, as it does on the worktree-lock line, because both lines share the same prefix.
- **Should feel:** Specific and actionable. The line names a run and a host to go look at, not just "something is locked".
- **Should understand:** The check is advisory and fails open. Offline, an auth failure, an unresolved repo slug, an unreadable blob, a tombstone, a stale claim past its TTL, or this session's own claim all print the ordinary `no sibling-session conflict found` line. Flow Step 2.8's atomic claim stays the correctness boundary.
- **Red flags:**
  - `(unknown)` placeholders when the blob carries the fields.
  - The check blocking or erroring instead of failing open when GitHub is unreachable.
  - A false "may already hold" for this session's own claim.
  - A claim field breaking the one-line output: a newline or escape sequence from the blob starting a second line, or a non-string value printing as `[object Object]`. The blob is free text any pusher can write, so each field prints with control characters replaced by spaces and capped at 200 characters. A missing, empty or non-string field prints `(unknown)`, which is correct and not the placeholder defect above.

### 3. Resume an interrupted run without mistaking its own claim for a sibling (terminal)
- **URL:** `plugin/skills/_shared/run-resume-freshness.md`, `locked` case
- **Action:** **A new session** resuming an interrupted record-backed run runs the same check. It may see `live claim by run {run-id}` where the run id is the run being resumed, because the interrupted session's claim is still live.
- **Should feel:** Clear rather than alarming. The line itself carries the discriminator.
- **Should understand:** A claim naming this run's own run id is the earlier session's claim on this same run, so treat it as clear. Any other run id is a genuine sibling. This matches flow Step 2.8, which treats a claim carrying this run's run id as already owned.
- **Red flags:** A headless resume stalling on its own run's claim.

## Origin
- Created during `/claude-tweaks:build` of record #3030 (2026-10-19). #3131 was a live instance of the late contest: the sibling's claim surfaced only at flow Step 2.8, after dispatch had minted a run dir, created a worktree and launched the Task.
- Updated during `/claude-tweaks:build` of record #3768 (2026-10-21). The worktree-lock half now strips a leading `#` from a numeric `--record`. Before this, `#{n}` silently missed a live local worktree.
- Related specs: #308 (added the worktree-lock check), #2838 (worktree-resume window), #3393 (unresolved-slug claim reads), #3768 (`#`-prefixed ref normalization)
