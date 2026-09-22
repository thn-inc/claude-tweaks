---
files:
  - plugin/skills/feedback/SKILL.md
  - plugin/skills/feedback/session-evaluation.md
  - plugin/skills/feedback/bare-invocation.md
  - plugin/skills/_shared/feedback-objectives.md
  - plugin/skills/_shared/upstream-feedback-batch.md
  - plugin/bin/lib/transcript-judge/watermark.js
  - plugin/bin/lib/declined-learning/store.js
---

# Evaluate a Session for Upstream Feedback

**Persona:** A developer using claude-tweaks in their own project who just finished a substantial working session — pipeline or ad hoc — and wants the plugin improved from what the session actually evidenced, not from what they happen to remember.
**Goal:** Harvest everything the session evidences against the plugin's maintainer objectives — quantified where countable, each finding carrying a proposed fix — and file the keepers upstream, at the cost of exactly one confirmation stop.
**Entry point:** A terminal with `/claude-tweaks:feedback` run bare (no free-text learning), any time during or after the session being evaluated.
**Success state:** Every rubric objective has an explicit outcome (`NO FINDING`, `NOT EVALUATED — {reason}`, or findings), the avoidable-interactions count matches the transcript, and every surviving finding is filed or declined through one chunked confirmation — nothing filed without a checked box. (A run the skip check short-circuits renders no per-objective blocks at all; its success state is the one-line pointer at the prior evaluation and its filings, described in Step 1.)

## Steps

### 1. Invoke bare — terminal
- **URL:** `/claude-tweaks:feedback`
- **Action:** Invoke with no arguments. The skill resolves the session transcript (`~/.claude/projects/<project-slug>/<session-id>.jsonl`) and dispatches one judge agent with the rubric and output template inlined; it also gathers any waiting `upstream-candidate` queue items into the same batch.
- **Should feel:** Hands-off — after the invocation, nothing asks for input until the single confirmation at the end.
- **Should understand:** The judge reads the main session's transcript only — work done inside dispatched Task agents is a named coverage gap, not silently included. When `$CLAUDE_CODE_SESSION_ID` is unset and several recent transcripts exist, the report names the file it chose (with mtime) and lists the siblings it ignored. A prior run against this same transcript left a watermark (byte offset); by default this invocation evaluates only the content since that offset, omitting findings the watermark already covers. The offset clause also carries the human-legible subject text of every finding declined at a prior run's Step 7 (`bin/lib/declined-learning/store.js`'s `listDeclined({ source: 'feedback' })`, computed live at dispatch time — #1033), instructing the judge to omit any new finding matching one of them in substance, even if the wording differs. Pass `--full` to ignore the watermark, run the un-scoped judge over the whole transcript, and overwrite the watermark with the fresh result. When that offset is already the transcript's *current* size — nothing new since the last stamped evaluation — no judge agent is dispatched at all rather than one dispatched to evaluate zero new bytes: the run reports `session evaluation unchanged since {evaluatedAt} — prior filings: {issue URLs, or "none"}` and contributes nothing to the batch. `--full` bypasses that skip too, and the self-assessment path (Step 4) is never skipped — with no transcript resolved there is nothing to compare against.
- **Red flags:** A second `AskUserQuestion` appearing mid-flow; a transcript picked silently when siblings were modified within the last 24 hours; a re-run silently re-surfacing findings the watermark should have already covered with no `--full` passed; a judge agent dispatched against a transcript that has not grown since the last stamped evaluation, with no `--full` passed.

### 2. Read the evaluation — terminal
- **URL:** same session, when the judge returns
- **Action:** Read the per-objective blocks, one per rubric objective in rubric order.
- **Should feel:** Like an honest audit, not a compliance report — most objectives on a good session read `NO FINDING`, and that reads as success, not as the judge slacking.
- **Should understand:** `NO FINDING` means evaluated-and-clean; `NOT EVALUATED — {reason}` means the judge could not reach that objective and says so — the two are never interchangeable. The avoidable-interactions block always states the session's total `AskUserQuestion` count, and that number is grounded in the transcript (spot-checkable with a grep). Every finding carries symptom, transcript evidence, a proposed fix, and a one-line cost (the maintainer's triage signal; `unclear` is valid) — a finding missing any of the first three does not file.
- **Red flags:** A finding with no proposed fix reaching the confirmation; a coverage gap rendered as `NO FINDING`; a count that doesn't survive a hand grep of the transcript.

### 3. Confirm once — terminal
- **URL:** same session, immediately after the drafts render
- **Action:** Answer the chunked `multiSelect` confirmation (groups of up to 4, per the shared batch contract). Checked items file upstream with `**Objective:**`, `**Cost this session:**`, and — for countable lenses — `**Measurement:**` fields in the issue body; unchecked items are declined, never silently dropped.
- **Should feel:** One deliberate stop that covers the whole harvest — session findings and queue candidates together.
- **Should understand:** The scrub reran on exactly the content being filed, whichever model judged it; `--dry-run` would have stopped before this point with everything rendered and nothing filed. Any drafted item — session finding or queue candidate — whose own fingerprint exactly matches a prior decline (feedback/SKILL.md Step 4's Prior-decline annotation, #1033) renders with a `_(previously declined {date}: {reason})_` line in its draft and its chunk option, distinct from Step 1's substance-level offset-clause suppression: this is the mechanical, exact-hash counterpart, catching a finding that reached drafting at all rather than one the judge omitted before drafting. Checking a previously-declined item files it and clears the stale entry.
- **Red flags:** An item filing without being checked; separate confirmation stops for session findings vs queue candidates.

### 4. Degraded environment — terminal (cloud sandboxes)
- **URL:** `/claude-tweaks:feedback` in an environment with no local transcript
- **Action:** Invoke bare where no transcript file resolves — or where the judge dispatch terminally fails (format retry spent, or a hard model error such as a usage limit); either way the evaluation runs in the main thread instead of a dispatched judge, never silently dropped.
- **Should feel:** The same flow, visibly labeled — not a silent downgrade.
- **Should understand:** Every block's header carries `(self-assessment)`; the label is the whole mitigation, because the human confirmation in Step 3 still gates every filing identically.
- **Red flags:** Self-assessed output rendered without the tag; a degraded run filing anything without the Step 3 confirmation.

## Origin
- Created during build of #509 (bare `/claude-tweaks:feedback` evaluates the session against the maintainer-objective rubric via a dispatched transcript judge)
- Steps 1-4 built in this session
- Updated during build of #679 (`plugin/bin/lib/feedback/watermark.js` — evaluation watermark read/write) — Step 1 now documents the default incremental-since-watermark behavior and the `--full` override.
- Updated while addressing #785 — terminal judge failure now degrades to self-assessment instead of dropping the evaluation (Step 4), and findings carry a one-line cost (Steps 2-3).
- Updated during build of #701 (`session-evaluation.md`'s Skip check + the watermark's `issueUrls`/`findingsFiled`/`sessionId` payload fields) — Step 1 now documents that an unchanged transcript skips the judge dispatch outright and reports the prior stamp's filings, and the Success state names that outcome.
- Related journeys: `file-upstream-feedback-in-batch` (the batch confirmation contract this flow shares)
- Updated during build of #849 — the watermark's offset clause now also carries fingerprints declined at a prior run's Step 7, read from `bin/lib/declined-learning/store.js`.
- Updated during build of #1033 — the offset clause now carries human-legible `subject` text via a live `listDeclined` call, replacing #849's opaque-fingerprint `dismissedFingerprints`, and Step 3 now documents the separate exact-hash Prior-decline annotation (feedback/SKILL.md Step 4) that renders on a drafted item's own confirmation.
- Related specs: #679
