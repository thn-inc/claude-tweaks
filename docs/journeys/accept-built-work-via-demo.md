---
files:
  - plugin/skills/demo/SKILL.md
  - plugin/skills/demo/entry-paths.md
  - plugin/skills/demo/legacy-brief-compatibility.md
  - plugin/skills/demo/browser-verdict.md
  - plugin/skills/demo/design-contract-section.md
  - plugin/skills/demo/follow-up-record.md
  - plugin/skills/wrap-up/verification-brief.md
  - plugin/skills/_shared/observation-plan.md
---

# Accept Built Work Show-First via /demo

**Persona:** claude-tweaks user (or a maintainer of a project using the plugin) returning days after a build shipped, who owes the record a human verdict and does not want to re-derive "how do I test this" from the diff.
**Goal:** Reach an Approve / Request changes / Skip decision on one record after being *shown* the work — the observation plan executed in front of them — rather than being asked to choose how to verify it first.
**Entry point:** A terminal in a session with the plugin loaded, holding a record number from `/claude-tweaks:help`'s outstanding list (Stage 4.7) or a `demo:pending` notification.
**Success state:** The record carries `demo:approved` (or `demo:changes-requested` plus a linked follow-up record), and the human never had to answer a how-do-you-want-to-check-this question. For a `#N,#M` list, every ref that resolved carries its own verdict, applied as that verdict was given — an Approve verdict from a list also carries `demo:approved-batch` alongside `demo:approved` (Step 3); a ref that resolved to nothing was reported and skipped without stopping the rest.

## Steps

### 1. Resolve the one item — `/claude-tweaks:demo #N`
- **URL:** `/claude-tweaks:demo #N` (or bare `/claude-tweaks:demo` for this session's own unrecorded work; or `/claude-tweaks:demo #N,#M` — a `/tidy` Yours group head or a hand-typed list — to take several records one at a time)
- **Action:** Invoke against a record whose wrap-up posted a Verification Brief. A `#N,#M` list is an explicit batch: the first ref runs Steps 1-3 to completion before the second begins.
- **Should feel:** Zero re-derivation — the brief `/claude-tweaks:wrap-up` wrote at build time renders immediately, `### The ask` through `### Observation plan`.
- **Should understand:** The `### Observation plan` section is builder-authored at wrap-up time (kinds: `rendered-page | app-route | cli | flow | diff` — schema in `plugin/skills/_shared/observation-plan.md`); demo executes it mechanically rather than classifying paths itself. A parent-linked sub-issue's own plan may additionally carry an optional `Full verification:` block — composed by `/demo` itself, not wrap-up, pointing at the parent's eventual end-to-end check and naming which siblings still gate it.
- **Red flags:** A backlog sweep (demo resolves exactly the item(s) you named — `#N`, or a `#N,#M` list one at a time — never a scan for what's outstanding); a "See it yourself"/"Verify it yourself" option in the verdict question (that flow is retired — only briefs posted before the schema shipped walk it, via `legacy-brief-compatibility.md`).

### 2. Watch the plan execute — Prepare → Validate → Show
- **URL:** *(no command — demo drives)*
- **Action:** Nothing. Demo runs Prepare commands (`none` → skipped), silently validates URL surfaces with playwright-cli when available (session closed afterward), then Shows: opens the deep link in your browser (`open`/`xdg-open`), runs the `cli` command, walks `flow` Inspect pointers in order (regenerating missing artifacts, stating-and-continuing on failures), or renders the `diff`.
- **Should feel:** Show-first — the work appears in front of you before any question is asked.
- **Should understand:** A Prepare or Validate failure is *evidence for Request changes*, not a debugging detour — demo never fixes the application. A Parent-Gate parent brief (no plan section, walkthrough inline in `### Confirmed`) and a no-path-list session-recall entry legitimately skip straight to the verdict. When the plan carries a `Full verification:` block, it renders right after Show, before the verdict question — a pointer to the parent's eventual end-to-end check, not a substitute for it; the verdict you give still concerns only this slice.
- **Red flags:** Demo asking which way you'd like to verify before showing anything; a browser validation session left open; a stale `flow` pointer blocking the walk instead of being stated and passed over; a `Full verification:` block silently missing on a parent-linked record after a failed parent or sibling lookup (a `gh` failure omits the block but must say so in one plain line above the verdict, naming which lookup failed).

### 3. Give the verdict — one question
- **URL:** *(AskUserQuestion rendered by demo)*
- **Action:** Pick Approve, Request changes (a one-line reason files a linked follow-up record), or Skip for now.
- **Should feel:** One decision, fully informed — the only question the walkthrough asks.
- **Should understand:** Approve swaps `demo:pending` → `demo:approved` (and closes a decomposition parent); a batch-sourced Approve (Step 1's `#N,#M` shape) additionally applies `demo:approved-batch` alongside it, so `bin/lib/issues/trust.js`'s coverage/verdict computation can tell a batch sign-off apart from this step's own per-record walkthrough — no extra question, nothing to decide here. Request changes ends this record's walkthrough — a later re-demo is a fresh invocation with fresh preparation.
- **Red flags:** More than one question per record on the happy path; a verdict written for a session-recall entry (nothing is persisted for those except a Request-changes follow-up).

### 4. Next ref, same shape — `#N,#M` batches only
- **URL:** *(no command — demo advances to the next ref in the list)*
- **Action:** Nothing. Once this ref's verdict has landed (label swap or follow-up filed), demo re-enters Step 1 for the next ref — a fresh, independent lookup with its own brief, its own walkthrough, its own single verdict question. `## Next Actions` renders once, after the last ref.
- **Should feel:** Like paste-once, decide-per-record — no cross-record table, no apply-all, nothing lost if you stop halfway (every verdict already given is already applied).
- **Should understand:** A batch is your own explicit list, never a backlog scan — what is outstanding is still `/claude-tweaks:help` Stage 4.7's job; the once-per-item scope-fork checkpoint resets for each ref.
- **Red flags:** One combined verdict question spanning several records; a batch table asking for apply-all; the second ref starting before the first ref's label swap landed; a Next Actions block after every item instead of once at the end.

## Origin
- Steps 1-3 created during the show-first demo build; Step 4 and the batch clauses in Step 1 added during build of #695 (specify + demo `#N,#M` batch argument); Step 3's batch-provenance clause added during build of #431 (demo verdict provenance); the `Full verification:` clauses in Steps 1 and 2 added during build of #1194 (demo full-verification pointer on decomposed sub-issues)
- Related specs: #695, #685 (tidy's command-grouped Yours section, the batch line's producer), #431 (batch sign-off provenance in the trust table), #365 (the originating finding), #1194 (full-verification pointer for parent-linked sub-issues)
