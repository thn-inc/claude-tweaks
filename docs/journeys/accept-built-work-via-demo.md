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
  - plugin/skills/_shared/try-it.md
  - plugin/skills/_shared/pr-run-comments.md
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
- **Should feel:** Zero re-derivation — the brief's `### Try it` walkthrough (`plugin/skills/_shared/try-it.md`; a parent brief's `### Try it — end to end`) renders first, the same text the Pipeline Summary and the PR showed, then the brief `/claude-tweaks:wrap-up` wrote at build time, `### The ask` through `### Observation plan`, with that block hoisted out rather than shown twice.
- **Should understand:** The `### Observation plan` section is builder-authored at wrap-up time (kinds: `rendered-page | app-route | cli | flow | diff` — schema in `plugin/skills/_shared/observation-plan.md`); demo executes it mechanically rather than classifying paths itself. A parent-linked sub-issue's own plan may additionally carry an optional `Full verification:` block — composed by `/demo` itself, not wrap-up, pointing at the parent's eventual end-to-end check and naming which siblings still gate it. Under `pr-first` the brief and the walkthrough live on the run's PR, so demo follows the issue's `Verification Brief posted to PR #…` pointer — or, for a below-floor record with no brief, the PR that closed it — and reads the `try-it` / `brief` run comment there — in a multi-spec bundle, whose specs share one PR, this record's own `try-it:{N}` / `brief:{N}` comment first, then the plain one; it composes a fresh Try it block from the record's ACs only when none is found. Only a comment from an owner, member or collaborator counts as found, on the issue and on the PR alike: a stranger's lookalike brief, pointer or `try-it` comment reads as absent and is named in one skip line above the verdict (`ignore-a-planted-marker-comment-3358.md`).
- **Red flags:** Prepare/Validate output appearing before the Try it walkthrough; an empty or placeholder Try it block; a freshly composed walkthrough while the PR still carries one posted by an owner, member or collaborator; a walkthrough or brief taken from a stranger's comment, or one skipped with no skip line; `/claude-tweaks:demo #N` on a bundled spec rendering a sibling spec's brief (`brief:{M}` never counts for `#N`); a backlog sweep (demo resolves exactly the item(s) you named — `#N`, or a `#N,#M` list one at a time — never a scan for what's outstanding); a "See it yourself"/"Verify it yourself" option in the verdict question (that flow is retired — only briefs posted before the schema shipped walk it, via `legacy-brief-compatibility.md`).

### 2. Watch the plan execute — Prepare → Validate → Show
- **URL:** *(no command — demo drives)*
- **Action:** Nothing. Demo runs Prepare commands (`none` → skipped), silently validates URL surfaces with playwright-cli when available (session closed afterward), then Shows: opens the deep link in your browser (`open`/`xdg-open`), runs the `cli` command, walks `flow` Inspect pointers in order (regenerating missing artifacts, stating-and-continuing on failures), or renders the `diff`.
- **Should feel:** Show-first — the work appears in front of you before any question is asked.
- **Should understand:** A Prepare or Validate failure is *evidence for Request changes*, not a debugging detour — demo never fixes the application. A Parent-Gate parent brief (no plan section, walkthrough in its `### Try it — end to end` section) and a no-path-list session-recall entry legitimately skip straight to the verdict. When recall cannot name an entry point either, that entry's Try it block is omitted too, with one plain line saying so where it would render — never an invented entry point. When the plan carries a `Full verification:` block, it renders right after Show, before the verdict question — a pointer to the parent's eventual end-to-end check, not a substitute for it; the verdict you give still concerns only this slice. When the changed artifacts carry an Impeccable direction contract, demo also renders `### The design contract this was built against` above the verdict — the five blocks verbatim plus a `Design-seed:` line, per `plugin/skills/demo/design-contract-section.md`; when nothing resolves there is no heading and no "not found" note, and a malformed contract leaves one plain trace line instead of a section.
- **Red flags:** Demo asking which way you'd like to verify before showing anything; a browser validation session left open; a stale `flow` pointer blocking the walk instead of being stated and passed over; a `Full verification:` block silently missing on a parent-linked record after a failed parent or sibling lookup (a `gh` failure omits the block but must say so in one plain line above the verdict, naming which lookup failed).

### 3. Give the verdict — one question
- **URL:** *(AskUserQuestion rendered by demo)*
- **Action:** Pick Approve, Request changes (a one-line reason files a linked follow-up record), or Skip for now.
- **Should feel:** One decision, fully informed — the only question the walkthrough asks.
- **Should understand:** Approve swaps `demo:pending` → `demo:approved` (and closes a decomposition parent); a batch-sourced Approve (Step 1's `#N,#M` shape) additionally applies `demo:approved-batch` alongside it, so `bin/lib/issues/trust.js`'s coverage/verdict computation can tell a batch sign-off apart from this step's own per-record walkthrough — no extra question, nothing to decide here. Request changes ends this record's walkthrough — a later re-demo is a fresh invocation with fresh preparation. On a `rendered-page`/`app-route` plan with browser tools available, this question is asked in the browser first, on a single-variant recap page (`plugin/skills/demo/browser-verdict.md`): a pick *is* Approve, applied immediately; an exit falls back to the terminal question with Approve omitted; every other event falls back to it unchanged. A `cli`/`flow`/`diff` plan, or a run with no browser tools, goes straight to the terminal question.
- **Red flags:** More than one question per record on the happy path; a verdict written for a session-recall entry (nothing is persisted for those except a Request-changes follow-up).

### 4. Next ref, same shape — `#N,#M` batches only
- **URL:** *(no command — demo advances to the next ref in the list)*
- **Action:** Nothing. Once this ref's verdict has landed (label swap or follow-up filed), demo re-enters Step 1 for the next ref — a fresh, independent lookup with its own brief, its own walkthrough, its own single verdict question. `## Next Actions` renders once, after the last ref.
- **Should feel:** Like paste-once, decide-per-record — no cross-record table, no apply-all, nothing lost if you stop halfway (every verdict already given is already applied).
- **Should understand:** A batch is your own explicit list, never a backlog scan — what is outstanding is still `/claude-tweaks:help` Stage 4.7's job; the once-per-item scope-fork checkpoint resets for each ref.
- **Red flags:** One combined verdict question spanning several records; a batch table asking for apply-all; the second ref starting before the first ref's label swap landed; a Next Actions block after every item instead of once at the end.

## Origin
- Steps 1-3 created during the show-first demo build; Step 4 and the batch clauses in Step 1 added during build of #695 (specify + demo `#N,#M` batch argument); Step 3's batch-provenance clause added during build of #431 (demo verdict provenance); the `Full verification:` clauses in Steps 1 and 2 added during build of #1194 (demo full-verification pointer on decomposed sub-issues); Step 1's Try it-first and PR read-back clauses, and Step 2's Try it — end to end parent clause, added during build of #2821 (human Try it walkthrough on every finished run); Step 1's trusted-author clause and red flag added during build of #3358 (marker comments count only from an owner, member or collaborator); Step 1's bundled-spec read order and red flag added during build of #3333 (demo reads the record's own `brief:{N}` before the plain `brief` on a shared multi-spec PR)
- Related specs: #695, #685 (tidy's command-grouped Yours section, the batch line's producer), #431 (batch sign-off provenance in the trust table), #365 (the originating finding), #1194 (full-verification pointer for parent-linked sub-issues), #2821 (the shared Try it walkthrough; see `try-what-a-finished-run-built-2821.md`)
