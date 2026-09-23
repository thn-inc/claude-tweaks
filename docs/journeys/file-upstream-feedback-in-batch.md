---
files:
  - plugin/skills/_shared/upstream-feedback-batch.md
  - plugin/skills/feedback/SKILL.md
  - plugin/skills/feedback/session-evaluation.md
  - plugin/skills/feedback/pre-confirmed.md
  - plugin/skills/wrap-up/review-console.md
  - plugin/skills/wrap-up/upstream-feedback.md
  - plugin/bin/lib/declined-learning/store.js
---

# File Upstream Feedback in Batch

**Persona:** A claude-tweaks maintainer who just let a headless health-sweep Routine run overnight and now has several `upstream-candidate` issues waiting in this project's own backlog, plus a `/claude-tweaks:flow` run that surfaced a couple more D5 (upstream) learnings during wrap-up.
**Goal:** Clear all the waiting upstream-feedback candidates — decide which get filed against `thn-inc/claude-tweaks` and which get declined — without answering one confirmation prompt per candidate.
**Entry point:** A terminal with `/claude-tweaks:feedback --queue` run bare (no free-text learning), or the Wrap-Up Review Console rendered at the end of a `/claude-tweaks:flow`/`/claude-tweaks:wrap-up` run that staged `U#` items.
**Success state:** Every candidate has an explicit disposition — filed (a real upstream issue URL) or declined (a comment on the local `upstream-candidate` issue, or a logged decline) — reached via one `multiSelect` confirmation per group of up to 4 on the `--queue` path, or via the Review Console's single terminal decision on the console path.

## Steps

### 1. Gather the local queue — terminal
- **URL:** `/claude-tweaks:feedback --queue`
- **Action:** Invoke the skill bare (or with `--queue`); it lists every open `upstream-candidate` issue and, for each, runs Steps 1-6 (gather, classify, self-reference check, dedup search, draft, scrub) non-interactively before rendering anything. A bare invocation now also runs the session evaluation (`session-evaluation.md` — see the `evaluate-a-session-for-upstream-feedback` journey) and concatenates its findings into this same batch, so the confirmation in Step 2 covers both gathers in one stop.
- **Should feel:** Like triage, not paperwork — the maintainer reads finished drafts, not raw issue bodies they'd have to interpret themselves.
- **Should understand:** Each candidate's fully scrubbed draft renders as literal text above the confirmation call, including a `**possible duplicate:** #{N}` flag inline wherever the dedup search found a plausible match — a duplicate never gets its own separate prompt. If the candidate's own fingerprint (`computeFingerprint({ fingerprintBasis })`) matches an exact prior decline (#1033), the draft also carries a `_(previously declined {declinedAt date}: {reason})_` annotation — a hint for the decision below, never a filter.
- **Red flags:** A candidate's draft missing from the rendered text before the confirmation call; a dedup match silently omitted instead of flagged; a previously-declined candidate's annotation silently missing from its draft.

### 2. Approve a chunk — terminal
- **URL:** same session, immediately after Step 1's drafts render
- **Action:** Answer the `multiSelect` confirmation. With 6 candidates this is exactly 2 calls (4 items, then 2) — never one call per candidate, never one 6-option call (the tool caps options at 4 per question). Every option renders **unchecked**; checking an item is the one explicit act that authorizes filing it.
- **Should feel:** Fast and deliberate at once — one screen per group of up to 4, and checking a box is unambiguously "file this now," not "shortlist this for later."
- **Should understand:** The question text states plainly that a checked item will be filed, and restates the edit escape hatch ("describe the change and which item it applies to, by title, in your next message") — the maintainer never has to already know about the tool's undocumented `Other` field. Each option's `description` also carries the same `**previously declined:** {date}: {reason}` line (#1033) whenever that candidate is annotated, so the reminder survives the compression from full draft down to one option line.
- **Red flags:** An item filing without ever having been checked; a chunk boundary splitting one candidate's draft from its own confirmation.

### 2a. Decline one, edit another — terminal
- **URL:** same session
- **Action:** Leave one candidate's box unchecked, and reply in the next message naming a different candidate by title with a requested change instead of checking or unchecking it.
- **Should feel:** Safe to be selective — nothing gets filed by default, and correcting a draft doesn't mean starting the whole batch over.
- **Should understand:** The unchecked candidate's local `upstream-candidate` issue gets a comment — "Declined via /claude-tweaks:feedback batch review, {date}" — and stays open for a future run; nothing is silently dropped. In addition, the candidate's fingerprint (`bin/lib/feedback/file-feedback.js`'s `computeFingerprint(draft)`) is now recorded in the declined-learning store (`bin/lib/declined-learning/store.js`, `source: 'feedback'`, plus `subject: draft.fingerprintBasis.summary` (#1033) — human-legible text, not just the hash) — a later session's judge dispatch composes its offset clause by calling `listDeclined({ source: 'feedback' })` live (never reading a stale watermark snapshot), so the same finding re-surfacing carries a "previously declined" signal instead of arriving as a brand-new, unrecognized finding. The named-edit candidate re-drafts and re-renders for a fresh confirmation. If a checked (filed) candidate carried a `priorDecline` annotation, that stale entry is cleared via `clearDecline` immediately after filing — a re-affirmation, not a new decline.
- **Red flags:** A declined candidate's local issue closing or losing its label; an edit request being ignored or silently applied without a fresh confirmation; a declined candidate's fingerprint (or `subject`) missing from the store on a later re-check; a re-affirmed (filed) candidate's stale decline never cleared, leaving it annotated forever.

### 3. Approve staged items from the Wrap-Up Review Console — terminal
- **URL:** the Review Console rendered at the end of `/claude-tweaks:wrap-up` (or `/claude-tweaks:flow`'s consolidated multi-spec console)
- **Action:** Review the console's `Upstream feedback` section (staged during the run's upstream curation). At `supervised`/`trusted` autonomy, a plain "Approve all" resolves every staged `U#` row to its *declined* default — nothing is filed, and there are zero further `AskUserQuestion` calls. To file any of them, choose Override: it renders the same chunked `multiSelect` confirmation(s) as Step 2, one call per group of up to 4, every option unchecked. The only path that files without a checkbox is the `unattended`-only `consoleAutoResolve` short-circuit, where every `U#` row auto-resolves to filed.
- **Should feel:** Safe by default — walking away from the console never publishes anything outward; filing is always an act the maintainer performs, either by checking a box under Override or by having deliberately set the `unattended` ceiling beforehand.
- **Should understand:** Each row was staged earlier in this same run, before the console ever rendered — `/claude-tweaks:wrap-up`'s upstream curation step already drafted and scrubbed it (the same "stage, never file during the run" rule Step 1's `--queue` gather follows). A declined row is logged as declined in the run's `decisions.md`, never silently dropped, and its fingerprint is recorded in the declined-learning store the same way Step 2a's `--queue`-path decline is. Whichever path files it, filing invokes `/claude-tweaks:feedback --pre-confirmed`, which re-reads the staged file fresh and diffs it against the exact snapshot the console rendered before filing; on drift, that one item falls back to a normal confirm showing the diff. The scrub itself always reruns as a separate safety net either way.
- **Red flags:** A `U#` row filing under a human-answered "Approve all" (that is the `consoleAutoResolve` exception, not this path); a declined row leaving no decline entry in `decisions.md`; the drift check not catching staged content that changed since rendering; the scrub not rerunning on the content that's actually about to be filed.

## Origin
- Created during build of #294 (batch upstream-feedback filing into one multiSelect decision, collapse /feedback's double-ask)
- Steps 1-3 built in this session
- Related specs: #290 (sibling — batches Q#/M# the same way, U# carved out to this sub-issue)
- Updated during build of #509 (bare invocation now also runs the session evaluation; both gathers feed the one batch)
- Corrected during build of #674/#675 — Step 3 had described "Approve all" as filing every `U#` row by default; the console's actual default has been *declined* since #350, with filing reached via Override or the `unattended`-only `consoleAutoResolve` short-circuit.
- Updated during build of #849 — declining a candidate (Step 2a or Step 3) now also records its fingerprint in the declined-learning store, consumed by a later bare `/feedback` run's watermark payload.
- Updated during build of #1033 — the store now also carries human-legible `subject` text (not just the hash), the judge's offset clause reads it live via `listDeclined` rather than a watermark snapshot, and a candidate previously declined now carries a visible `**previously declined**` annotation in its Step 1 draft and its Step 2 chunk option, with re-affirming it (checking a previously-declined candidate) clearing the stale entry.
