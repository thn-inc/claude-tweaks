---
files:
  - plugin/skills/feedback/SKILL.md
  - plugin/skills/feedback/upstream-draft.md
  - plugin/skills/_shared/learning-routing.md
  - plugin/skills/intake/SKILL.md
  - plugin/skills/reflect/SKILL.md
---

# Draft Third-Party Upstream Feedback

**Persona:** A developer using claude-tweaks who hit a defect or gap in a dependency the plugin wraps (superpowers, agent-browser, an MCP server, another plugin) — not in claude-tweaks itself — and wants to report it without claude-tweaks writing to a repository whose conventions and consent expectations it can't read.
**Goal:** Get a scrubbed, adapted draft written to disk plus a paste-ready `gh issue create` command, without claude-tweaks ever filing, commenting, or labelling anything against the third-party repository on the developer's behalf.
**Entry point:** A terminal with `/claude-tweaks:feedback "<learning text>" --upstream <owner/name>` (a resolvable slug, a GitHub URL, or a bare dependency name) — typed directly, or handed off inline from `/claude-tweaks:intake`'s `upstream:<owner/name>` verdict or `/claude-tweaks:reflect`'s "Classify first" routing.
**Success state:** A scrubbed draft file at a reported absolute path, plus a rendered `gh issue create --repo <owner/name> --title '<title>' --body-file <path>` command and a web fallback URL. Nothing is published — the human decides whether and how to send it.

## Steps

### 1. Invoke with `--upstream` — a resolvable target
- **URL:** `/claude-tweaks:feedback "agent-browser exposes no screencast or frame-capture operation" --upstream vercel-labs/agent-browser`
- **Action:** The skill gathers the summary, affected component, and repro/use case, classifies `defect`/`gap`, then dispatches into `upstream-draft.md`'s self-target guard, which normalizes the value and confirms it isn't claude-tweaks itself before continuing. `--upstream` exists because `_shared/learning-routing.md`'s "Non-claude-tweaks upstream" rule hands a third-party-owned learning here instead of dead-ending at "report it and stop" — typing the flag directly is the explicit form of the same handoff the classifier performs automatically.
- **Should feel:** The same low-friction, single-invocation flow as an ordinary `/feedback` filing — not a separate command to learn.
- **Should understand:** Nothing is filed anywhere yet. The dedup search against the third-party tracker is advisory only and uses the affected-component name alone — never the draft's own symptom or summary text — so nothing unscrubbed reaches a public search API before the scrub gate runs.
- **Red flags:** A `gh issue create` actually executed against the third-party repo; the dedup search sending free-text summary/symptom content before the scrub gate.

### 2. Scrub gate — terminal
- **URL:** same session, immediately after the draft is composed
- **Action:** The same `[Use: Capable]` scrub dispatch `feedback/SKILL.md` Step 6 already runs for a claude-tweaks filing runs unconditionally on the adapted third-party draft too — one singleton dispatch, reused rather than duplicated.
- **Should feel:** Exactly as strict as filing against claude-tweaks itself — a human pasting a leaked credential leaks it exactly as well as a CLI filing it would.
- **Should understand:** If the learning cannot survive the scrub, nothing is written to disk at all — not even a partial draft.
- **Red flags:** A draft persisted despite an unscrubbable finding; a second scrub dispatch spun up instead of reusing the one singleton the claude-tweaks filing path already uses.

### 3. Receive the hand-off — terminal
- **URL:** same session, once the scrubbed draft persists
- **Action:** Read the absolute path the draft was written to, the rendered `gh issue create --repo vercel-labs/agent-browser --title '…' --body-file <path>` command, and the web fallback `https://github.com/vercel-labs/agent-browser/issues/new`.
- **Should feel:** Like being handed a finished, safe-to-paste artifact — not a half-done task.
- **Should understand:** They are the filer. Pasting the command (or using the web form) is their own act, under their own GitHub identity — honoring the target's issue template and judging whether an existing thread is really the same bug both stay with them.
- **Red flags:** A prefilled `?title=&body=` URL instead of the file-based hand-off (bodies routinely exceed a URL's length and truncate silently); a command rendered without the `'\''` escaping rule, letting a `$(...)` or backtick in the title execute when pasted.

### 4. Unresolved target — terminal (a bare dependency name)
- **URL:** `/claude-tweaks:feedback "<learning>" --upstream agent-browser`
- **Action:** Same flow, but the classifier (often `/intake` or `/reflect`, which know the dependency's name but not its repository) could not resolve a slug. The hand-off renders the literal placeholder `<owner/name>`, the dedup search is skipped with a one-line note, and the persisted file's header records `target: unresolved (agent-browser)`.
- **Should feel:** Still complete, not a dead end — the draft is just as usable, only missing one fact the human fills in when they paste.
- **Should understand:** An interactive session asks exactly one `AskUserQuestion` — "Which GitHub repository owns `agent-browser`?" — before the draft persists; a headless run (a scheduled Routine, a `claude -p` invocation) skips the question and keeps the placeholder rather than blocking.
- **Red flags:** No draft produced just because the repository is unknown; a headless run blocking on a question nobody is present to answer.

### 5. Self-target — terminal (the value actually names claude-tweaks)
- **URL:** `/claude-tweaks:feedback "<learning>" --upstream thomasholknielsen/claude-tweaks` (or an equivalent `https://github.com/...` or `git@github.com:...` form)
- **Action:** The self-target guard recognizes the normalized slug, states that the learning names claude-tweaks itself, and returns control to `feedback/SKILL.md`'s own Step 3 — the ordinary filing path (dedup, draft, scrub, confirm, file) runs to completion instead of drafting.
- **Should feel:** No dead end and no silent misfire — the `--upstream` flag never accidentally suppresses a real claude-tweaks filing.
- **Should understand:** This is neither an error nor a draft. The learning is filed at `thomasholknielsen/claude-tweaks` exactly as it would have been without `--upstream`.
- **Red flags:** The self-target case producing a draft-and-hand-off instead of a real filing; a differently-cased or trailing-`.git`/`/`-suffixed form of the same URL failing to normalize to a match.

## Origin
- Created during build of #2759 (draft-only `--upstream <owner/name>` path for third-party learnings, routing `_shared/learning-routing.md`'s third-party rule instead of stopping)
- Steps 1-5 built in this session
- Related journeys: `evaluate-a-session-for-upstream-feedback`, `file-upstream-feedback-in-batch` — both document `/feedback`'s claude-tweaks-owned filing flows (bare session evaluation and batch confirmation); this journey documents the sibling draft-only path for a learning `/feedback` never files itself
- Related specs: #2759
