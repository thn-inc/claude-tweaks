# Record Body Template

The record body must be detailed enough for `/superpowers:writing-plans` to produce a TDD execution plan without additional context. `/superpowers:writing-plans` assumes zero codebase familiarity — the body provides the anchoring.

This template covers the record's **body** only — the GitHub issue body, or the `local-files` twin's body text (`bin/lib/issues/local-store.js`). Title and Type are separate record fields, never body content — see `## Facets` at the end of this file for what lives outside the body.

Every record body opens with a short metadata block — plain body-metadata lines, never YAML frontmatter. `Surface:`, `Design-intent:`, `Ui-stack:`, and `Design-seed:` are lifted verbatim into the materialized header by `/flow`/`/build` at build time (spec 20's contract). `Visual-reference:` (when present) stays a body-metadata line only — `/claude-tweaks:build`'s `design-prebuild.md` reads it directly from the record body, not from the materialized header (not `/claude-tweaks:design-wrapper`'s `pre-build` mode, which never references this field). Legacy `frontend` (pre-migration spec frontmatter) reads as `web`; `mixed` is retired — pick the single dominant surface per sub-issue, since a unit that is genuinely both frontend and backend at once is a decomposition smell.

**`mobile` means a native app surface** — SwiftUI, UIKit, Compose, React Native, Flutter — not a web page viewed on a phone. A responsive web layout is `web`; use `mobile` only when the code being changed is native app code. The distinction is load-bearing rather than descriptive: `/claude-tweaks:design-wrapper` routes `mobile` to Impeccable's native track and skips the two web-only surfaces (the bundled HTML detector behind `test` mode, and `live` mode) rather than running them and reporting a pass they could not have failed. Declaring `mobile` on a responsive web feature therefore turns the design CLI gate off for it. `desktop` takes the web path on a stated assumption — see the track-resolution table in `skills/design-wrapper/SKILL.md`, which is the single source of truth for how each value routes. `terminal` is a CLI/TUI surface — help text, output formatting, prompts, exit codes; it is declared only, never sniffed (no file extension implies it), and it takes the design pipeline's terminal track (`skills/design-wrapper/terminal-routing.md`). `Parent:` is decomposition-mode-only, present on a sub-issue's body only under `work-backend: github-issues` + `work-links: body-text` **and only when that decomposition kept a parent** (`/specify`'s Step 2.6 collapse decision produces parentless records — `specify/decomposition-mode.md`) — the one combination with no other way to record a sub-issue's own parent (`work-links: native`'s sub-issue relationship is queryable from either side; `work-backend: local-files` carries `facets.parent`). `/claude-tweaks:review`'s Step 1.6 (`skills/review/SKILL.md`) reads it to resolve a sub-issue's parent when checking for a `## Cross-Spec Promises` section (`_shared/work-record.md`).

`Design-seed:` is the one metadata line **`/specify` never writes**. The template declares it so the line is a recognized body-metadata field rather than stray prose when it does appear; the *value* can only be written after the build, because it comes from the direction contract Impeccable puts in the built artifact and `/specify` runs before any code exists. `/claude-tweaks:design-wrapper`'s `review` mode writes it post-build, per `_shared/design-contract.md`. Do not copy `Design-intent:`'s pattern here and go looking for a value at shaping time — there is nothing to read yet. The field is **never required**: a `ready` sub-issue without one is normal and stays valid, exactly as with `Surface:`, and no structural check may start demanding it. Most records will never carry one, since most work is not a new design surface.

`Ui-stack:` names the UI component library / styling approach a frontend build should use — e.g. `shadcn/ui + Tailwind`, or an explicit `none — no preference, defer to reference codebase` when the record's author genuinely has no opinion. `/claude-tweaks:specify`'s Step 2.5c2 (`design-pre-steps.md`, immediately after the Design-intent question) writes it, following the same auto-mode/`ui-stack` policy-key precedence Step 2.5c already uses for `Design-intent:`. Omitted for backend/infra/terminal records — the same frontend-only gate that already governs `Design-intent:`.

```markdown
Surface: {web | mobile | desktop | backend | infra | terminal}
Design-intent: {bold | quiet | minimal | delightful | onboarding | none}
Ui-stack: {free-form component-library/styling-approach string (e.g. "shadcn/ui + Tailwind"), or an explicit no-preference answer — omitted for backend/infra/terminal, same as Design-intent:}
Design-seed: {the seed key from the built artifact's Impeccable direction contract, copied verbatim — NOT written by /specify; see below}
Visual-reference: {path to an accepted shape-time scaffold file — omitted when /specify's Step 2.5b-ii variant-exploration step was skipped, declined, or not offered (non-frontend records)}
Parent: {#N — decomposition-mode sub-issues under work-links: body-text only, and only when Step 2.6 kept a parent; omitted otherwise (a collapsed decomposition, native links, work-backend: local-files, and Shaping mode)}

## Overview

{1-2 paragraphs describing what this work unit delivers and why. Absorb key decisions and rationale from the design doc — the design doc will be deleted after this step.}

**Complexity:** {Low | Medium | High}
**Estimated tasks:** {3-8}

## Non-Goals

{Explicit boundaries. What this spec does NOT cover. Prevents `/superpowers:writing-plans` from scope-creeping beyond the work unit boundary.}

- {Thing that might seem in scope but isn't}
- {Related work that belongs in a different spec}

## Prerequisites

| Spec | Title | Status |
|------|-------|--------|
| {N} | {title} | {status} |

## Current State

{What already exists in the codebase that this work builds on. Not a code dump — pointers that give `/superpowers:writing-plans` its starting points.}

- Data: `{path}` — {what tables/models exist}
- API: `{path}` — {what endpoints exist}
- UI: `{path}` — {what components exist}
- Tests: `{path}` — {what test patterns to follow}

Every existing-code claim above carries either an inline evidence citation (`path:line`, or the `git ls-files` hit) or the `ASSUMPTION — verify at build:` marker (`## Gotchas`) — never neither. Probe forms/caps: `_shared/premise-verification.md`.

## Deliverables

- [ ] {Concrete deliverable 1}
- [ ] {Concrete deliverable 2}
- [ ] ...

When a Deliverable adds a new Manifesto policy lever — a new `auto`-mode behavior surfaced through the Pipeline Config Manifesto and configurable via `.claude-tweaks/policy.yml` — cite `_shared/auto-mode-contract.md`'s "Adding a new policy lever" checklist by reference (name the file and heading) rather than restating its five touch points or naming only one of them. A lever's addition touches more files than its own logic; the checklist exists because a past lever-adding spec named only one file and three of the checklist's five items were missed until whole-branch review.

## Acceptance Criteria

1. {Specific, testable criterion that `/superpowers:writing-plans` can convert to a TDD step}
2. {Specific, testable criterion}
3. ...

## Technical Approach

{Key architectural decisions absorbed from the design doc, specific to this work unit. When a `/claude-tweaks:research` report already exists for this topic — prior-art lookup, dependency behavior, or an existing convention elsewhere in the codebase — cite its finding directly here (or in Gotchas below) rather than re-deriving it; `docs/skill-graph.md`'s `## specify` section names this as the advisory research↔specify edge.}

### Data / API Surface

{If this spec involves data model or API changes, define the contract surface. Table/model names, field types, endpoint signatures, validation schemas. Not full implementation — just enough for `/superpowers:writing-plans` to generate exact code.}

### Key Files

- `{path}` — {what changes or new file purpose}
- `{path}` — {what changes}

Each bullet names a concrete file path, never a bare directory (`tests/`, `plugin/skills/`): `groupByFileOverlap` (`bin/lib/issues/grouping.js`) excludes every entry ending in `/` from file-overlap bridging outright, so a directory entry contributes nothing to the cross-spec conflict detection `/claude-tweaks:flow`, `/claude-tweaks:dispatch`, and `/claude-tweaks:help` run over this section — and, unlike an absent section, it raises no warning.

When this work **renames** a contract surface — a report section heading, a check name, an exported symbol, or any other name other files reference by literal text — grep the repo for the surface's exact old literal text. List every consumer file the grep finds here — each one that binds to the name and must be updated, including files this work does not otherwise touch. Skip historical mentions: archived run specs, other records' bodies, the incident log. A file that only *reads* the old name never appears in the diff you're imagining, so it's easy to omit without this step. Example: spec #518 renamed `/claude-tweaks:tidy`'s report sections and listed only the files it would write (`skills/tidy/SKILL.md`, `skills/tidy/step-6-auto.md`, `skills/tidy/step-6-interactive.md`). It omitted `skills/tidy/scan-procedures.md`, whose Collection routing table bound each scan tag to a report section by that section's literal old name — the rename shipped with the routing table still pointing at the retired names, caught only in whole-branch review (`docs/incident-log.md` `[IL-132]`).

Run the **generated-file grep** for every entry above, rename or not — the rename-grep's mirror: it finds an entry's *producer*, where the rename-grep finds a surface's *consumers*. Incident: #326 (filed as #1321) — the spec listed only `.github/workflows/track-issue-fixes.yml`, never its source of truth, `plugin/bin/lib/issue-branch-tracking.js`'s `generateWorkflowYaml()` (whose header comment names that path), so the build edited the generated file. Grep the four conventional executable-code locations — the closed set for this check — for the entry's basename:

```bash
grep -rln "{basename}" plugin/bin plugin/hooks scripts tools 2>/dev/null
```

When the basename matches more than one tracked file (`git ls-files | grep -c "/{basename}$"` prints more than 1 — e.g. `cache.js`, 6 today) or the bare-basename grep returns too many hits to read, re-grep with the entry's repo-relative path instead — the pinned snippet above is the basename form only. Skip the entry itself and the same historical mentions the rename-grep skips (one shared skip list — the rename-grep's, above — adding generator-specific entries only if build-time hits show the need). Read each remaining hit and classify: a module that generates or writes the entry's content is its **source of truth** — a hit that both reads and writes still counts as a producer — so list that module here as the primary edit target and annotate the generated entry's own bullet `— generated by \`{module}\`: edit the generator, not this file` (`extractKeyFilesSection` reads only the bullet's first backticked span, so the annotation never pollutes file-overlap detection). A hit that merely *reads* the entry is a consumer — the rename-grep's territory — skip it. Accepted misses, by design: a generator that assembles the target path by string concatenation, and a generator outside the four directories above.

When a deliverable documents a newly-discovered limitation or constraint of an existing pattern, also check canonical example files demonstrating that pattern, not only reference-doc tables — an example built before the constraint was known is exactly as likely to go stale. Incident: spec #1503 documented that `find role <role>` only reliably resolves the `button` role in a pinned agent-browser version; its Key Files list named only the reference-doc file, and a sibling example file (`plugin/skills/stories/story-examples.md`) still demonstrated the now-known-broken `role: link` pattern until review caught it independently.

### Package Dependencies

- `{package}` — {what's needed from it}

## Gotchas

{Things learned during brainstorming, from past experience, or from project memory that `/superpowers:writing-plans` won't know. These prevent common subagent mistakes.}

- {e.g., "Use upsert, not delete+insert for this operation"}
- {e.g., "The status enum values are exactly: draft, published, archived"}
- {e.g., "This mutation needs a transaction — it modifies two tables atomically"}
- {e.g., "Import shared types from the contracts package, don't redeclare inline"}
- {e.g., "ASSUMPTION — verify at build: sibling unit N's module already exports `dequeue()` — confirm with `git grep -n -F dequeue {path}`"} — an unsettled Current State/Key Files claim (`_shared/premise-verification.md`) moves here in this literal form.

## Decision Rationale (optional)

{Absorbed from the design doc. Why this approach was chosen, what alternatives were rejected, and key tradeoffs accepted. Only included in the first spec of a decomposition — subsequent specs reference "See Spec {N} Decision Rationale."}

## Open Questions (optional)

{Populated by /specify Step 5 multi-persona red-team. Each row is a question raised by a persona during red-team review. When empty, this section is omitted from the spec entirely — do not emit an empty header.}

| Persona | Finding | Suggested Resolution |
|---------|---------|---------------------|
| {Implementer | Maintainer | Skeptical Reviewer} | {finding text} | {resolution or "—"} |

{Resolve each row during Step 6 Self-Review: edit the spec to remove the ambiguity, or explicitly accept the finding inline. When all rows are resolved, delete the section.}

## Manual Steps

Operations that **cannot be automated by a capable CLI user** — not things that merely live outside the codebase. `/build` Step 2.5 probes each item at execution time; items with a CLI/API and credentials are run inline, not seeded as manual.

Only list an item here if at least one is true:
- **No CLI/API exists** — dashboard-only action, physical task, or vendor-side
- **Requires human judgment** — a name, value, or copy decision someone must make at execution time
- **Requires out-of-band signoff** — security review, legal approval, change-management ticket

State the reason in each entry using the `reason-not-auto` qualifier (see `_shared/ledger-format.md`'s Required-for-ops section).

**Do not list** items like these — they have CLIs and will be auto-executed by `/build` Step 2.5:
- ~~"Set `STRIPE_SECRET_KEY` in production"~~ → `gh secret set` / `vercel env add` / `fly secrets set`
- ~~"Run `terraform apply`"~~ → shell command
- ~~"Register a Stripe webhook"~~ → `stripe webhooks create`
- ~~"Create a LaunchDarkly flag"~~ → `ldcli flags create`

Examples that **do belong here**:
- "Approve renewed Stripe terms of service in the dashboard (reason-not-auto: no-cli)"
- "Choose final display name for the meal-planning feature before launch copy is locked (reason-not-auto: requires-judgment)"
- "Get security review signoff on the new third-party data flow (reason-not-auto: requires-signoff)"

{If none: delete this section.}
```

## No Placeholders

Every spec section must contain content that `/superpowers:writing-plans` can act on without guessing. These are **spec failures, never write them**:

- `TBD`, `TODO`, `(to be filled in)`, incomplete sections, or vague requirements
- "Works correctly", "handles edge cases", "with appropriate validation" — without naming the specific behavior, the specific edge cases, or the specific validation rule
- "Similar to spec N" (cross-reference if the rationale carries; otherwise repeat the substance — the engineer may be reading specs out of order)
- Acceptance criteria that can't be converted to a TDD test (`"feels fast"` ≠ `"p95 < 200ms on the journey defined in spec 41"`)
- "Standard error handling" — name the error class, the user-facing message, the log format
- Types, models, endpoints, or files referenced anywhere in the spec that aren't defined in `Data / API Surface` or `Key Files`
- Gotchas that say "be careful" without saying what to do (`"watch out for races"` ≠ `"use upsert, not delete+insert"`)
- A Current State/Key Files claim about existing code with neither an evidence citation nor the `ASSUMPTION — verify at build:` marker (`_shared/premise-verification.md`)
- An AC asserting "styling/classes are unchanged" as literal string equality (`className === "flex p-4 text-sm"` ≠ class-*set* equivalence or a rendered/visual check) — a class-sorting formatter such as `prettier-plugin-tailwindcss` reorders class tokens on every commit, making literal-string equality structurally unenforceable

If you would need `/superpowers:writing-plans` to guess, the spec is incomplete — finish it before handing off. Vagueness here compounds into plan failures downstream.

## Delete + Tombstone Acceptance Criteria

A spec that both (a) requires deleting a symbol and asserting a grep for it returns zero matches, and (b) requires leaving a tombstone comment naming that symbol (e.g., `// removed: parseLegacyConfig — see spec 311`) is structurally self-defeating: the tombstone comment is itself a match for the grep it's supposed to satisfy. This is not a one-off — any "delete + tombstone comment" acceptance criterion pair hits it.

When a spec calls for both deletion and a tombstone comment, do one of:
- **Scope the grep to exclude the tombstone** — e.g., `grep -rn "parseLegacyConfig" src/ | grep -v "// removed:"` returns zero matches. Default to this: it keeps the tombstone's full diagnostic value (naming exactly what was removed and why) without weakening the "fully deleted" guarantee the AC exists to provide.
- **Word the tombstone without the exact symbol name** (e.g., "see CHANGELOG.md for what was removed here") only when the exact name isn't operationally necessary for future readers — this is the fallback, not the default, since it loses the tombstone's specificity.

Never write a bare "zero matches anywhere" AC alongside a tombstone requirement without picking one of these — it fails at review time every time.

## Empirical Premise-Check Deliverables

When a spec's technical approach rests on an assumption about how an external system, harness, or tool actually behaves — an undocumented payload shape, an unconfirmed API contract, an assumed invocation path — write a blocking first deliverable ("Task 0") that captures the real behavior before any other deliverable's fixtures are written. Word its scope as an enumeration, not a single check, and cover every path that reaches the feature, not just every shape the resulting payload can take:

- **Who initiates it** — a person typing the trigger directly (a slash command, a manual action), the model invoking it as part of its own reasoning, a Task-dispatched subagent invoking it on the model's behalf, and a headless/non-interactive run (`claude -p`, a scheduled Routine) invoking it with no one watching. These are different code paths through the harness and can diverge in whether an event fires at all, not just in what it contains.
- **Every shape the payload can take once it does fire** — qualified vs. bare identifiers, success vs. failure, nested vs. top-level invocation.

Enumerating only the second list and skipping the first is the failure mode to design against: it reads as thorough (every input shape is covered) while silently leaving out an entire initiation path that never produces an event to shape-check in the first place — a gap no fixture built from the captured shapes can catch, because the missing case never got captured. Name each initiator path explicitly in the Task 0 deliverable's own text; do not let "covers all invocation shapes" stand in for it.

A Task 0 deliverable's captured behavior — or any other flagged-but-unvalidated assumption in this
spec's `## Gotchas` section, an inline `<!-- ambiguity: -->` marker, or an `## Open Questions` row —
is not fully resolved just because implementation happened. `skills/review/code-mode-steps.md`
Step 1's **Risk-Marker Verification** sub-check independently re-checks every such marker against
the artifact's real external validator/schema/tool at whole-branch review time, and routes an
unresolved one to `BLOCKED` — the review-side half of the same rule this section states from the
spec-authoring side.

**Plan-authoring corollary.** When a deliverable itself adds new *binding* skill prose to a
review/build gate — a Gate-table row, a forced-disposition instruction, not merely descriptive
prose — include a deliverable that pins it with a conformance test (`skill-prose-conformance-tests`'
"documented convention this project wants enforced against every future addition" case), the same
way a code path earns regression coverage. A plan that adds a Gate-table row with no test task is
the same brief-compliance gap this section already exists to close, one layer further in.

### Third-Party CLI/API Behavior Task 0

When the premise being checked is specifically how a **third-party CLI or API** behaves — not this project's own harness — name a blocking empirical Task 0 as a deliberate option rather than letting it get rediscovered per-record. Its three constituent parts, all required:

- **Safe probe target** — a throwaway/disposable target the probe can act against without touching real state (a scratch repo, an unprotected test branch, a sandboxed resource) — never the project's own production data or an artifact anyone else depends on.
- **Mandatory teardown** — the Task 0 deliverable itself includes tearing the probe target back down, unconditionally, whether the probe confirmed or reversed the assumed premise.
- **Literal-capture rule** — record the actually-observed behavior verbatim (the exact output, timing, or status — not a paraphrase) in the spec's `## Gotchas` or `## Technical Approach`, so a later reader can check the captured fact rather than re-trust the original assumption.

Example: #560's Task 0 probed `gh pr merge --auto`'s actual merge timing against a throwaway PR opened on a disposable base branch, tore that branch down unconditionally after capturing the result, and recorded the literal observed behavior — which reversed the plan's assumed premise (`gh pr merge --auto` does not wait for anything on an unprotected repo; it merges immediately) before any other deliverable's fixtures were written.

## Gate-Authoring Deliverables

When a spec's plan adds a new gate — a PreToolUse/PostToolUse hook check, a permission rule, or a teardown/cleanup guard — write a plan-time deliverable that traces the gate's proposed condition against two enumerations before implementation begins, not after:

- **Every sanctioned caller of the operation being gated** — every documented or in-repo code path that legitimately invokes the operation the gate is about to restrict (a cleanup procedure, a companion skill's step, a CLI the operation is wrapped by).
- **Every non-destructive/safe mode of the gated tool or operation** — a flag or field value that makes an otherwise-gated call harmless (e.g. a read-only or `keep`-style mode).

For every item in both lists, check it against the proposed gate condition and confirm it is not denied.

Spec #373's plan skipped this trace, and its whole-branch review had to catch — after implementation — two collisions the enumeration above would have caught at plan time: the new teardown gate denied the plugin's own documented cleanup sequence (a sanctioned caller), and it separately denied a non-destructive mode of the gated tool that an earlier task in the same plan had already pinned. Both collisions are already fixed in the current codebase; this section exists so the trace happens while the plan is being written, not after review finds what it missed.

## Why Each Section Matters for `/superpowers:writing-plans`

| Section | What `/superpowers:writing-plans` does with it |
|---------|-------------------------------|
| **Overview** | Sets the goal and context for the plan header |
| **Non-Goals** | Prevents scope creep in task decomposition |
| **Current State** | Gives starting points — avoids blind codebase exploration |
| **Deliverables** | Maps to plan tasks (roughly 1 deliverable = 1-2 tasks) |
| **Acceptance Criteria** | Becomes the "verify" step in each TDD cycle |
| **Data / API Surface** | Enables exact code generation — names, types, endpoints |
| **Key Files** | Exact paths for the plan's "Files" section |
| **Gotchas** | Injected as constraints into subagent prompts |
| **Open Questions** | Reviewed during Step 6 Self-Review — must be resolved (clarified or accepted) before the spec is handed to `/superpowers:writing-plans`. The section is appended by Step 5 multi-persona red-team and is optional (omitted when red-team finds no general-location ambiguities). |
| **Manual Steps** | Classified at build start (Step 2.5) — auto-executable items run inline; only items that fail the triage (no-cli, requires-judgment, requires-signoff, auth-not-configured) seed the ledger as `ops` |

## Facets

Type, stage/scoring labels, and parent/dependency links are **record facets** — tracked on the record itself, never as free-form prose in the body's narrative. Type and stage/scoring are always native labels/frontmatter, outside the body entirely. Parent/dependency links follow the driver: native labels/frontmatter under `work-links: native` (or `local-files`), but under `work-links: body-text` they ARE literal body lines (`Parent: #N`, `Blocked by #N`) — structured, parseable markers, not narrative text, but body text nonetheless. The table below is the source of truth for which representation applies; the canonical taxonomy (the axes, the label names, who may set what) is `_shared/work-record.md`.

| Facet | `github-issues` | `local-files` |
|-------|------------------|----------------|
| Type | Native GitHub Issue Type (`work-types: native`) or a `type:*` label (`work-types: labels`) | `type:` frontmatter line |
| Stage + scoring | `ready`, `risk:*`, `size:*` labels | `stage:`, `risk:`, `size:` frontmatter lines |
| Parent marker (`isParentIssue`) — decomposition parent; carries the acceptance gate for its sub-issues | `parent-issue` label (a retired name is still read on the read side only — see `_shared/work-record.md`'s Label taxonomy) | `is-parent-issue: true` frontmatter line |
| Parent link | Sub-issue relationship (`work-links: native`) or a parent task-list entry (`- [ ] #{subIssueNum}`) + the sub-issue's own `Parent: #N` body line (`work-links: body-text`) | `parent:` frontmatter line |
| Dependency links | Blocked-by dependency API (`work-links: native`) or `Blocked by #N` body lines (`work-links: body-text`) | `blocked-by: [...]` frontmatter line |
| Related cross-link — non-dependency sibling reference; written by `/capture`'s body template and by `/specify`'s independent-2-unit collapse (`record-creation-linking.md` Step 4, #1346's split of `record-creation.md`), maintained by `/backlog refine` | `**Related:** #N` body line (both `work-links` values) | `**Related:** {id}` body line (no frontmatter facet) |

The `local-files` frontmatter keys above are exactly `local-store.js`'s documented set (`bin/lib/issues/local-store.js`) — don't invent new keys here.

`/specify` adds `ready`, `risk:*`/`size:*` (when unstamped), and Type (when absent), and removes `parked` on promotion (plus the parent-guard residue strip on a parent-marked record — `_shared/work-record.md`'s matrix carries the carve-out); it never touches `auto:*`/`bot:*`. See `_shared/work-record.md`'s permission matrix for the complete rule set.
