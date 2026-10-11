---
files:
  - plugin/skills/reflect/full-mode.md
  - plugin/bin/lib/declined-learning/store.js
  - plugin/bin/lib/health-core/fingerprint.js
---

# Route a Declined Reflection Insight

**Persona:** A claude-tweaks maintainer running `/claude-tweaks:wrap-up` at the end of a build who has seen essentially this same reflect insight before — a prior run's "don't capture" call they still stand by — and doesn't want to re-litigate it every single time.
**Goal:** See the batch table flag which insights are re-surfacing a prior decline, with the stated reason from that decline, so the "don't capture" call from before is a one-glance confirmation rather than a fresh judgment call — while staying free to capture it this time if circumstances have actually changed.
**Entry point:** `/claude-tweaks:wrap-up` (or standalone `/claude-tweaks:reflect`) reaching Step 3's interactive-mode batch routing, `### Reflection Insights` table about to render. Under wrap-up (reflect runs with `--source wrap-up`), reflect stages that table to `{run-dir}/staged/wrap-up-reflect-insights.md` instead of asking, and the decision happens at the Review Console.
**Success state:** Every insight in the table has an explicit routing decision; a re-surfacing insight the maintainer already declined once carries a visible "(previously declined {date}: {reason})" annotation in its row, and the maintainer's decision on it — reaffirm the decline, or capture it after all — is recorded so the next run's table reflects the current state, not a stale one.

## Steps

### 1. Insights are fingerprinted and checked against prior declines — before the table renders
- **URL:** same session, immediately before the `### Reflection Insights` table
- **Action:** For each insight the five lenses (plus the tradeoff review) produced, `full-mode.md`'s Prior-decline annotation step computes a fingerprint from the insight's own description text and looks it up in the declined-learning store in one command — `printf '%s' '{"description":"..."}' | node "${CLAUDE_PLUGIN_ROOT}/bin/declined-learning.js" lookup --source reflect`, which prints `{fingerprint, decline}` (`decline` is `null` when nothing was recorded); it wraps `createFingerprint('reflect', ['description'])` and `lookupDecline(fingerprint)`. When that exact-hash lookup finds nothing, a subject scan (#1033) also runs: `listDeclined({ source: 'reflect' })` returns every declined entry's human-legible `subject` text (an entry recorded before #1033 has none — skipped), and the agent judges — not a mechanical string match — whether the current insight is materially the same point as any listed subject, even where the wording differs. This is what makes near-miss matching no longer fingerprint-only: a rephrased repeat of a prior decline now annotates too, not just a byte-identical one.
- **Should feel:** Invisible when there's no history — a first-time insight renders exactly as it always has, no extra clause, no delay.
- **Should understand:** Nothing is filtered or hidden at this step — every insight still gets a full table row and a real recommendation, matched or not (by either path). The lookup only decides whether to append an annotation, never whether to include the row at all. The subject scan is a judgment call, not a second deterministic lookup — genuine uncertainty means no annotation, not a forced match.
- **Red flags:** A previously-declined insight silently dropped from the table instead of rendered with its annotation; either lookup running against live text instead of the frozen description that was actually declined, producing a match that shouldn't exist; the subject scan annotating on a superficial wording echo rather than a genuinely material match.

### 2. The batch table renders with the annotation visible
- **URL:** same session, `### Reflection Insights` table
- **Action:** The maintainer reads the table. A matched insight's cell reads `{insight text} _(previously declined {declinedAt date}: {reason})_` — the exact reason recorded when it was declined, not a generic "seen before" marker.
- **Should feel:** Like being handed the earlier judgment call back, not asked to re-derive it — the annotation is a memory aid, not friction.
- **Should understand:** The annotation is advisory. The recommendation column still shows a real, independent call (Implement now / Defer / Capture / Digest / Don't capture) — the maintainer is free to disagree with the earlier decline and capture the insight this time, especially if the annotation's reason no longer applies. "Digest — below floor" is a real recommendation like any other, not a refusal to judge: an insight that misses `_shared/materiality-floor.md`'s floor with a non-`tangential` `Defer-reason:` is routed to the rolling digest container instead of a new record, and the digest entry is written only once the row is approved.
- **Red flags:** An annotation with a missing or generic reason (the stored `reason` should be the actual free-text the maintainer gave, per the "Don't capture" step's "must state why" rule); an annotation on an insight whose text only superficially resembles the declined one but means something materially different.

### 3. Resolve the batch — reaffirm the decline, or capture it after all
- **URL:** same session, immediately after `AskUserQuestion`'s "Apply all" / "Override specific items" answer (standalone reflect, or `--source review`); under wrap-up, the Review Console's "On approval" step 10 (Reflection insights) — Approve all, or Override's per-insight drill
- **Action:** For each annotated insight: if it resolves to "Don't capture" again, the decline is (re-)recorded via `printf '%s' '{"description":"...","reason":"..."}' | node "${CLAUDE_PLUGIN_ROOT}/bin/declined-learning.js" record-decline --source reflect` (wrapping `recordDecline(fingerprint, { reason, source: 'reflect', subject: description })`) (#1033 added `subject` — the insight's own one-line description, so a future run's subject scan has something to compare against) — same fingerprint, fresh `declinedAt`/`reason`/`subject`. If it resolves to anything else (Implement now, Defer, Capture — the maintainer decided the earlier "don't capture" no longer holds), the stale entry is cleared: for an exact-hash match, via `clearDecline(fingerprint)` using that same fingerprint; for a subject-scan match, via `clearDecline` on **the matched `listDeclined` entry's own fingerprint**, not one freshly computed from the current insight's differently-worded text — that fresh fingerprint isn't a key in the store, so clearing it would silently no-op.
- **Should feel:** Like the system is tracking the maintainer's own standing decisions, not overriding them — reaffirming costs nothing extra, and reversing is a first-class outcome, not a workaround.
- **Should understand:** A decline-write failure degrades open (logged, batch resolution proceeds) — losing the annotation on a future run is a minor inconvenience, never a reason this step blocks.
- **Red flags:** A re-declined insight's `declinedAt`/`reason` not updating (stale timestamp implies the store isn't actually being re-written); a captured insight's annotation still showing up on the very next run because `clearDecline` wasn't called, or was called on the wrong (freshly-computed) fingerprint for a subject-scan match.

## Origin
- Created during build of #849 (declined-learning fingerprint store shared by `/feedback` session evaluation and `/wrap-up` curation)
- Updated for #1033 (this journey's core premise: near-miss matching is no longer fingerprint-only — a subject scan over `listDeclined` now judges reworded repeats too, alongside the store's new `subject` field)
- Related journeys: `file-upstream-feedback-in-batch` (the analogous decline-tracking behavior on the `/feedback` side of the same store)
