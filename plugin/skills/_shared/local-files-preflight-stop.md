# Local-Files Preflight Stop — Canonical Boundary Language

Every skill whose workflow, under `work-backend: local-files`, would otherwise proceed to
build, claim, or authorize application work that only `work-backend: github-issues`'s RBAC +
atomic claim mechanism actually supports MUST phrase its local-files Preflight stop using the
pattern below. Referenced by `/claude-tweaks:backlog` — three call sites: `refine` mode's grant
sub-stage (human-present or headless posture, `--source` notwithstanding), the `refine
#N[,#M...]`/`refine --reset-breaker` forms, and `attention` mode — `/claude-tweaks:dispatch`'s own
Preflight section, and `/claude-tweaks:specify`'s `next-mode.md` Preflight — each keeps its own
full paragraph (the specific unmet condition, the list of skills it would otherwise invoke, and
its own forbidden-action list are genuinely skill-specific and don't compress into one shared
template), but all call sites must stay consistent with the pattern here rather than drift toward
weaker phrasing independently.

## Why this exists

A skill in this project can be invoked headlessly, with no interactive human present to
receive a "point the user at doing X manually" message. Three separate real incidents — found
via a since-removed eval harness running against real API calls, not hypothesized —
confirmed that a live model finds a way to treat a local-files stop as inapplicable unless the
paragraph explicitly rules out each specific rationalization it reaches for:

- `/claude-tweaks:triage`'s original Preflight (now `/claude-tweaks:backlog refine`'s grant sub-stage) said "report that grants are not applicable...
  point the user at running `/claude-tweaks:flow` manually" — a live headless run instead
  built and committed real application code, reproduced twice
  (`.superpowers/sdd/task-9-report.md`). Root cause: a purely informational "point the user at
  X and stop" reads as license to do X itself when no human is there to act on the pointer.
- `/claude-tweaks:dispatch` had the identical weak phrasing, found and fixed pre-emptively
  once the triage incident established the pattern was real, then confirmed safe via a real
  run.
- `/claude-tweaks:backlog refine`'s grant sub-stage, already hardened to the enumerated
  pattern below (elements 1-5), still failed against a realistic `/init`-generated `CLAUDE.md`
  (the original fix's confirming run used a bare, never-init'd fixture) — a live headless run
  again built and shipped real application code, this time running a full build-to-close
  lifecycle (`/specify` → `/flow` → build → `/review` → `/wrap-up` → `/demo`; 18 commits, 49
  tool calls, $17.47).
  Root cause: the realistic fixture's own `## claude-tweaks Pipeline` CLAUDE.md section
  documents this project's own auto-mode/hands-off pipeline architecture ("skills MUST NOT
  invent new mid-flow stops in auto") — the model resolved the conflict between that
  documented project convention and this skill's own explicit stop instruction in favor of
  the former, treating a low-risk "ready" record as exactly the kind of work that convention
  describes running through automatically.

The fix is not persuasion, it's enumeration: state exactly what must not happen, and rule out
each specific rationalization a model has actually been observed reaching for — the absence of
a human (element 5), and this project's own documented auto-mode conventions elsewhere in
CLAUDE.md (element 6) — rather than leaving either for a plausible-sounding local context to
override.

## The pattern

A compliant local-files Preflight paragraph contains all of the following, in this order:

1. **The trigger** — read `work-backend` (per `_shared/work-record-config.md`, the key
   table's canonical home) and identify the `local-files` branch.
2. **The reason**, stated in this skill's own terms — what mechanism or grant is actually
   unavailable under `local-files` (e.g. backlog refine: the grant conditions this skill exists to
   enforce; dispatch: the claim mechanism the protocol depends on).
3. **"Stop this turn completely"**, followed by an explicit, enumerated list of forbidden
   actions — do not invoke {the specific skills this skill would otherwise hand off to}, or
   any other skill; do not write/edit/create any file (add "claim" when the skill's job
   involves claiming); do not run any build, test, or git-committing command. A vague "and
   stop" with no enumeration is exactly the phrasing that failed.
4. **The manual alternative**, framed explicitly as information for a human, not an
   instruction to act on: "Tell the user they can run {skill} manually... this is information
   for the user to act on, never an instruction for you to act on yourself."
5. **The no-exception clause** — this holds even when no interactive human is present
   (including any headless/scheduled-firing mode the skill supports): "the absence of a human
   to hand this off to is not license to do the work in their place — it means {the unmet
   condition from step 2}, so the correct behavior is to stop, not proceed."
6. **The auto-mode disclaimer** — this stop is not superseded by this project's own
   documented auto-mode or hands-off-pipeline conventions elsewhere in CLAUDE.md (e.g.
   `/claude-tweaks:flow` defaulting to `auto`, "skills MUST NOT invent new mid-flow stops," or
   any similar pipeline-architecture description): those conventions govern behavior *within*
   a pipeline run that has already been authorized to proceed — they say nothing about
   whether this gate may authorize new work in the first place, which under `local-files` it
   explicitly cannot. A record that looks low-risk, well-scoped, or "ready" is not an
   exception.

See `skills/backlog/SKILL.md` and `skills/dispatch/SKILL.md`'s own Preflight sections for two
worked instances of this pattern applied to genuinely different skill-specific reasons.

## Adding a third consumer

If a new skill needs a local-files Preflight stop, compose its paragraph from the six
elements above using its own reason/skill-list/manual-alternative — do not copy either
existing paragraph verbatim and edit nouns, since that risks silently dropping element 3's
enumeration, element 5's no-exception clause, or element 6's auto-mode disclaimer in the
edit. Add the new skill to this file's opening "Referenced by" list once done.
