# Visual Review — Discover Mode

Loaded by `/claude-tweaks:visual-review` when the resolved mode is `discover`. The goal is to identify all user and developer journeys in an existing application and create journey files for them. This is the brownfield bootstrapping mode — used when a project has features but no documented journeys.

Requires the shared prerequisites from `browser-review.md` (session naming, screenshot path convention, dev URL resolution) — load this file only AFTER those have been processed.

## Phase 1: Codebase Scan

Scan the codebase to build a map of what exists before opening the browser.

> **Parallel execution:** Use parallel tool calls aggressively — all glob/grep operations across the four scan categories below are independent and should run concurrently. Front-load all codebase reads before browser interaction.

**Routes and pages:**
- Search for route definitions (React Router, Next.js pages/app directory, Express routes, Rails routes, etc.)
- Search for navigation components (navbars, sidebars, menus) to understand the information architecture
- Search for page/view components or templates

**Entry points:**
- Public pages (landing, login, signup, pricing)
- Authenticated pages (dashboard, settings, profile)
- Admin/internal pages
- API documentation pages
- Developer-facing entry points (CLI commands, setup scripts, config files)

**User-facing features:**
- Forms (signup, settings, create/edit flows)
- CRUD operations (lists, detail views, create, edit, delete)
- Workflows (multi-step processes, wizards, checkout flows)
- Search, filtering, sorting interfaces

**Personas (infer from the codebase):**
- Are there user roles? (admin, user, guest, developer)
- Is there an onboarding flow? (implies first-time user persona)
- Is there a public-facing site vs. authenticated app? (implies visitor vs. user)
- Is there API documentation or a developer portal? (implies developer persona)

## Phase 2: Journey Candidates

**Left as prose, not a blocking prompt:** this list is dynamically sized (N candidates, no fixed cap) and the skill auto-proceeds without waiting for a reply — the "say skip {numbers}" mechanism is a free-text opt-out on an already-in-progress action, not a blocking fixed-option choice, so it isn't converted.

From the codebase scan, compile a list of candidate journeys. Each candidate is a hypothesis: "a {persona} probably does {goal} by going through {these pages}."

Present the candidates as numbered options:

```
Found {N} potential user journeys in the codebase:

1. New user signup → onboarding → first project
   Persona: First-time visitor
   Pages: /, /signup, /onboarding, /projects/new

2. Returning user creates a {thing}
   Persona: Authenticated user
   Pages: /dashboard, /{things}/new, /{things}/{id}

3. Admin manages users
   Persona: Admin
   Pages: /admin, /admin/users, /admin/users/{id}

4. Developer sets up local environment
   Persona: New developer
   Entry: README.md → install → config → first run

...

Proceeding to walk all {N} journeys in the browser. Say "skip {numbers}" to exclude any.
```

Include developer journeys when the project has CLI tools, APIs, or developer-facing setup.

### Budget cap (`--budget <n>`)

When `--budget <n>` is passed, cap this phase (and the Phase 3 browser walkthrough) to the top `n` candidates instead of walking every candidate found. Order candidates before capping: primary user-facing flows (signup, core CRUD, checkout-equivalent) first, then supporting/admin flows, then developer-facing entry points last — the same rough precedence already implied by the candidate ordering in the example above. Still present all `{N}` discovered candidates in the numbered list (so the user can see what was found and what got excluded by the cap), but change the auto-proceed line to state the cap:

```
Proceeding to walk the top {n} of {N} journeys in the browser (--budget {n}). Say "skip {numbers}" to exclude any of the {n}, or "include {numbers}" to walk a specific excluded candidate anyway.
```

Without `--budget`, behavior is unchanged — proceed to walk all `{N}` candidates as documented above. In a large brownfield app, `--budget` bounds the number of full page walks (codebase scan is unaffected — it always runs against the whole app; only the Phase 3 browser session cost scales with the cap).

## Phase 3: Browser Walkthrough

**Dispatcher column mapping (discover-mode use):** When assembling agent output for Phase 4 (journey file creation) and Phase 5 (coverage report), map the agent's `| Severity | Path:Line | Finding | Evidence |` columns as follows: Severity = recommendation urgency (`info` for documented page, `low` for nice-to-have journey, `medium` for canonical journey worth writing, `high` for broken/missing critical flow), Path:Line = the discovered route/page (`/checkout/payment`, `/admin/users/{id}`), Finding = the candidate journey + persona (`Returning user creates a new project`), Evidence = the screenshot path + key observations (`.claude-tweaks/artifacts/screenshots/browse/discover-public-pages/03_payment.png; LCP 1.8s; primary CTA at [3]`). The dispatcher merges all agents' tables into Phase 4 (journey file creation) and Phase 5 (coverage report).

> **Parallel execution (conditional):** When multiple candidate journeys share no pages, dispatch each as a parallel Task agent — each agent runs its own session and its own sequence of `playwright-cli` commands independently. Journeys that share state (login, form data) must remain sequential to avoid interference. A single journey's steps are always sequential within its own command sequence.
>
> **Contract:** Each agent follows `_shared/subagent-output-contract.md` — minimal input, trailing status line, output template inlined verbatim below.
>
> **Model profile:** [Use: Standard] — discover-mode journey walkers do multi-step navigation, snapshot interpretation, and "should feel" inference from live experience. Upgrade to Capable only when the candidate journey hinges on subjective UX synthesis that Standard would flatten. Resolve via `node "${CLAUDE_PLUGIN_ROOT}/bin/resolve-profile.js" standard` (contract § Model Selection).
>
> **Output template (each agent must follow exactly):**
>
> ```markdown
> OUTPUT FORMAT (required):
> Return ONLY a markdown table, no preamble:
>
> | Severity | Path:Line | Finding | Evidence |
> |---|---|---|---|
> | high | /checkout/payment | Returning user payment flow — broken: form clears on validation error | .claude-tweaks/artifacts/screenshots/browse/discover-payment/04_error.png; LCP 1.8s; missing "save card" affordance |
> | medium | /admin/users/{id} | Admin user-detail journey worth documenting | .claude-tweaks/artifacts/screenshots/browse/discover-admin/02_user.png; 6 actions per page |
> | low | /settings/notifications | Notifications page reachable but no journey covers it | .claude-tweaks/artifacts/screenshots/browse/discover-settings/01_landing.png |
>
> Severity scale: critical / high / medium / low / info
> If no findings: return literal text "No findings."
> Return at most 15 rows, highest severity first; if more were found, append a final row reading "+N more" with the count in place of N — never omit this row when findings exceed the cap.
> Do not add narration, headers, or summaries before or after the table.
> ```
>
> Each agent's reply must open with the table verbatim, then end with its last non-empty line reading exactly `STATUS: DONE` (or DONE_WITH_CONCERNS / NEEDS_CONTEXT / BLOCKED).

<!-- playwright-cli: no equivalent found for agent-browser batch — see issue Gotchas -->
For each approved candidate, open a session and walk the candidate journey via a sequence of individual `playwright-cli` commands (`open`/`goto`, `snapshot`, `screenshot`) against one named session — Playwright CLI has no `batch` equivalent, so what was previously one bundled invocation is now a script of separate commands run against the same `-s=<name>` session, following the exact pattern `journey-mode.md`'s "Assemble the sequence" section establishes (see its worked example). This is where the codebase skeleton gets filled with experiential details.

<!-- playwright-cli: no equivalent found for agent-browser vitals — see issue Gotchas -->
**Vitals capability gap:** Playwright CLI has no `vitals` command or equivalent (`browser-review.md`'s Shared review contract, "Vitals interpretation (Step 1)"). Omit the `vitals` capture the pre-migration form issued after each screenshot — Performance findings cannot be produced for this walk until a replacement capture mechanism is designed.

For each step in the candidate journey (review the sequential command output):

1. **Apply the First Impressions test** (`browser-review.md`'s Shared review contract, "First Impressions (Step 2)") — capture the raw "should feel" for this step from the screenshot
2. **Note interaction needs as the persona** — when the candidate requires actual interaction (form fill, click flow), run those ops as additional individual commands against the same session, interleaved with the sequence wherever the step calls for them, then continue the sequence for subsequent pages
3. **Discover adjacent steps** — the codebase scan may have missed steps. If a page leads naturally to another page not in the candidate, add it to the next slice of the command sequence.
4. **Write the "should feel" and "red flags"** — these come from actually experiencing the page (snapshot + screenshot), not guessing from code — per the Vitals capability gap above, vitals data is not available for this write-up

## Phase 4: Write Journey Files

For each walked journey, create a file at `docs/journeys/{journey-name}.md` using the standard journey format (see `journey-template.md` in the `/claude-tweaks:journeys` skill's directory for the template).

Key differences from build-created journeys:
- **Origin section** says "Created during journey discovery (brownfield)" instead of referencing a spec
- **"Should feel" comes from actual browser experience**, not from spec intentions
- **Steps may reference features built across many past commits** — no single spec to reference

## Phase 5: Coverage Report

After creating all journey files, present a coverage report:

```markdown
## Journey Discovery Report

### Journeys Created
| Journey | Persona | Steps | Coverage |
|---------|---------|-------|----------|
| {name} | {persona} | {count} | {which pages/features are covered} |

### Pages Not Covered by Any Journey
| Page/Route | Reason |
|-----------|--------|
| {route} | {no clear user goal identified / admin-only / deprecated / utility page} |

### Gaps Identified
| Gap | Description |
|-----|-------------|
| {what's missing} | {e.g., "no error recovery journey", "no mobile journey", "no developer onboarding journey"} |
```

Present uncovered pages and gaps as a batch:

```
| # | Gap | Recommended |
|---|-----|-------------|
| 1 | {page/route} | Not a journey — utility page |
| 2 | {missing flow} | Capture |
| 3 | {page/route} | Create a journey — needs exploration |
```

The table renders as markdown, as above. Immediately below it, call `AskUserQuestion` with:

- `question`: `"How do you want to handle these findings?"`, `header`: `"Findings"`, `multiSelect`: `false`
- Option 1 — `label`: `"Apply all (Recommended)"`, `description`: `"Apply all recommendations"`
- Option 2 — `label`: `"Override specific items"`, `description`: `"tell me which #s to change"`

**Hard gate.** Check the response you are about to send: does it already contain the uncovered-pages-and-gaps table above as literal rendered markdown, with a row for every gap? If not, render it now, in this response, before the tool call — "Apply all" with no table above it leaves the user approving an unnamed set of findings.

## Phase 6: Handoff

Commit journey files with message: "Add {N} user journeys from discovery (brownfield)"

## Next Actions (discover mode)

Discover mode emphasises journey-walk follow-up because it just created journey files. Render this block in place of the canonical SKILL.md `## Next Actions` when reporting discover-mode results; otherwise defer to SKILL.md.

Render as plain markdown (docs/skill-authoring.md's Skill handoffs convention):

**`/claude-tweaks:visual-review journey:{name}`** — test a specific journey against its expectations (recommended)
`/claude-tweaks:visual-review {url}` — review a specific page
