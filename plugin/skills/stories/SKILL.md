---
name: stories
description: Use for generating or updating user-story YAML for UI testing — browses with agent-browser and creates semantic-locator (schema v2) stories, with diff-aware updates. Keywords - stories, generate, create, user journey, persona, QA, testing, semantic-locators.
argument-hint: "[<url>] [persona=<name>] [dir=<path>] [focus=<area>] [pages=<n>] [refine=false] [negative=false] [journey=<name>]"
---

# Stories — Generate, refine, and update user-story YAML (semantic locators, journey + source aware)

Browse a website, understand its structure and flows, and generate user story YAML files for UI testing. Stories describe journeys for any persona — customers, admins, developers, operators.

Lifecycle: `/claude-tweaks:build` → **`/claude-tweaks:stories`** → `/claude-tweaks:test` (conditional — only when UI files change).

## When to Use

- After `/claude-tweaks:build` when UI files changed (lifecycle recommendation)
- Against any URL to create regression suites (standalone)
- When existing stories need updating after UI changes (diff-aware)
- The user says "generate stories," "create user stories," or "write QA stories"

## Input

Parse `$ARGUMENTS` to extract:

- **URL:** (required, auto-detected if omitted) the site to browse and generate stories for. When no URL is provided, auto-detect using `dev-url-detection.md` in `skills/_shared/`.
- **PERSONA:** (optional) `persona=<name>` — the type of user to generate stories for (e.g. "customer", "admin", "developer"). If not specified, infer appropriate personas from the site's structure.
- **OUTPUT_DIR:** (optional) `dir=<path>` — directory to write stories to. Default: `stories/`
- **FOCUS:** (optional) `focus=<area>` — specific area or flow to focus on (e.g. "checkout", "settings", "onboarding"). Narrows Step 2 discovery (prioritizes pages/sections matching the area within the page-discovery budget) and Step 3 story design (scopes full story generation to matching pages/flows).
- **PAGES:** (optional) `pages=<n>` — override the default page-discovery cap (5-8) used in Step 2. Raise for a large app that needs broader first-pass coverage (e.g. `pages=15`); lower for a fast, narrowly-scoped regeneration run (e.g. `pages=3`).
- **REFINE:** (optional) `refine=true|false` — validate sample stories and self-correct. Default: `true`.
- **NEGATIVE:** (optional) `negative=true|false` — generate failure-path negative stories. Default: `true`.
- **JOURNEY_FILTER:** (optional) `journey=<name>` — scope generation to pages covered by the named journey. When set, only generates stories for pages documented in that journey file (`docs/journeys/{name}.md`).
- **Update mode:** If `{OUTPUT_DIR}/*.yaml` or `{OUTPUT_DIR}/*.yml` files already exist, automatically enter diff-aware mode. No keyword needed — the skill detects existing stories and only generates new or changed ones.
- **v1 detection:** If any existing YAML lacks `schema_version: 2` at the top, the v1 detection / regeneration UX (Step 1's "v1 Detection and Regeneration" subsection) runs before update-mode comparison.

## Story schema (v2)

All generated stories use `schema_version: 2`. Locators are semantic only — no CSS, no XPath:

```yaml
schema_version: 2
stories:
  - id: checkout-happy-path
    description: Complete a purchase from cart to confirmation
    journey: checkout
    auth: { vault: "default-user" }   # optional — see Auth Vault section
    steps:
      - action: click
        locator: { role: button, name: "Add to cart" }
      - action: fill
        locator: { testid: "email-input" }
        value: "user@example.com"
      - action: assert_visible
        locator: { text: "Order confirmed", exact: true }
```

Locators are always semantic (one of: ARIA role, `data-testid`, visible text, form label, input placeholder) — never CSS, XPath, or `@eN` snapshot refs. At runtime, a locator and its step's action execute as **one** command — `agent-browser --session <name> find <locator> <value> <action> [text]` (the action argument is mandatory: a bare `find` with no action defaults to clicking, so `find` is never used as an existence probe) — with `snapshot`-derived `@eN` refs as the fallback path; refs are NEVER stored in the YAML — they regenerate each snapshot. See `agent-browser-reference.md` in the `/claude-tweaks:browse` skill directory for the full operation vocabulary.

See locator types and preference order in `story-examples.md`.

A file may also carry file-level blocks alongside `stories`: `setup` (viewport, shared auth, pre-steps), `teardown` (post-run steps), and `target_env` (the Target Environment Guard's recorded classification — see Step 2). Complete worked examples of every block live in `story-examples.md`; this schema section is canonical for field semantics and is not restated elsewhere in this file.

## Auth Vault

Stories that require login reference an Auth Vault entry via the story-level `auth: { vault: "<name>" }` field. The vault stores credentials encrypted, locally. The LLM never sees passwords.

**Setup (user runs once):**

```
agent-browser auth save <vault-name> --url <login-page-url> --username <username> --password <password>
```

(`--password-stdin` instead of `--password` keeps the password out of shell history.)

**In the story runtime, after `open` and before the first action:**

```
agent-browser --session <story-id> auth login <vault-name>
```

`auth login` navigates to the vault's saved login URL, waits for the form fields, and submits. This replaces the cookie-injection path used in earlier versions: credentials live in the encrypted Auth Vault, never in a file under `{OUTPUT_DIR}`.

## Step 1: Ingest

Gather pre-existing information before browsing.

> **Parallel execution:** Use parallel tool calls aggressively — all Glob and Read operations across existing YAML files in Step 1 are independent and should run concurrently.

### Diff-Aware Ingestion (auto-detected)

1. Use the Glob tool to check for existing YAML files in OUTPUT_DIR matching `{OUTPUT_DIR}/*.yaml` AND `{OUTPUT_DIR}/*.yml` (both extensions — projects may use either).
2. **Update mode.** If existing YAML files were found, enter update mode:
   a. Parse the `stories` array from each file.
   b. Build an EXISTING_STORIES map: `{ storyId -> { url, locators[], steps[], sourceFile } }` — extract all semantic locators from each story's steps.
   c. Build an EXISTING_URLS set: all unique `url` values across existing stories.
   d. Log: "Update mode: found {N} existing stories across {M} files in {OUTPUT_DIR}."
3. If no YAML files were found, log: "No existing stories in {OUTPUT_DIR}. Generating all stories from scratch." Proceed with full generation.

### v1 Detection and Regeneration

Runs before update-mode comparison whenever any existing YAML file lacks `schema_version: 2` at the top.

1. **Never parse v1 story bodies into EXISTING_STORIES.** v1 files carry CSS/XPath selectors, which are forbidden in v2 — silently comparing against them produces stories that mix locator generations. Extract only each v1 story's `id` and `url` (identity, so regeneration preserves IDs that may be referenced in CI or `depends_on` chains).
2. **Interactive mode:** render a one-line summary per v1 file (`{file}: {N} stories, schema v1`), then call `AskUserQuestion` — `question`: `"Found {N} schema-v1 story file(s). Regenerate as v2?"`, `header`: `"v1 stories"`, `multiSelect`: `false`; Option 1 `label`: `"Regenerate (Recommended)"`, `description`: `"Treat all v1 stories as STALE — regenerate with semantic locators, preserving story IDs"`; Option 2 `label`: `"Skip v1 files"`, `description`: `"Leave them untouched and exclude them from this run"`.
3. **Auto mode:** never a mid-flow stop. When the v1 file is git-tracked (reversible), auto-choose Regenerate and log to the auto-decision log (`AUTO {time} — v1 detection: regenerating {N} v1 file(s) as v2, IDs preserved. Reversibility: high (git)`). When it is NOT git-tracked, regeneration would be unrecoverable — leave the file untouched, exclude it from the run, and stage the recommendation for the Review Console instead.
4. Regenerated v1 stories enter Step 3 as STALE (full regeneration); skipped v1 files are excluded from update-mode comparison and noted in the Step 6 report.

## Step 1.1: Journey Ingest (conditional)

Use the Glob tool to check whether any `docs/journeys/*.md` files exist.

- **None found:** log "No journey files found in docs/journeys/. Proceeding with full discovery mode." and skip to Step 1.5.
- **At least one found:** read `journey-ingest.md` in this skill's directory for the full ingest procedure (discover, parse, build JOURNEY_MAP + JOURNEY_URL_INDEX, cross-reference with existing stories). Populates JOURNEY_MAP and JOURNEY_URL_INDEX for Step 2; populates JOURNEY_LINK_SUGGESTIONS in update mode.

## Step 1.5: Source Analysis

Identify and read component source files to extract behavioral contracts that are not visible from the rendered DOM alone — input constraints, validation schemas, state transitions, conditional rendering, error handling, and API patterns. Produces a per-page SourceContract that feeds into Step 3 design.

For the full procedure (component-file identification, journey-seeded source files, behavioral-signal extraction, graceful degradation), read `source-aware-design.md` in this skill's directory. For framework-specific extraction patterns (Zod/yup/Joi schemas, JSX heuristics, React introspection) and the SourceContract schema, read `source-analysis.md` in this skill's directory.

## Step 2: Explore

> **Parallel execution:** Use parallel tool calls aggressively — all independent agent-browser session operations in Step 2's exploration are independent and should run concurrently, one session per page (`agent-browser --session <name> batch ...`), each in its own process (not a Task agent). Use a single batch per session to bundle `open + snapshot + screenshot`. Pages that share state (login → dashboard → settings) must run sequentially within a single session instead.

### Availability Check

Before browsing, check `agent-browser` availability per `_shared/browser-detection.md`'s Detect procedure. If available, proceed with the numbered steps below.

If unavailable, follow `_shared/browser-detection.md`'s Install branch (interactive mode: offer install; auto mode: stage the recommendation to the auto-decision log and continue without installing). If the user skips install (or auto mode stages it), degrade gracefully: skip browse-exploration (the rest of this Step) and Step 5 Refine entirely, generate stories from JOURNEY_MAP (Step 1.1) and SourceContract (Step 1.5) data only, and note "agent-browser unavailable — generated from journey/source data only" in the Step 6 report.

### Target Environment Guard

Before browsing, classify the target host from the resolved URL:

- **Local** — loopback targets (`localhost`, `127.0.0.1`, `::1`, `*.localhost`): proceed freely; record `classification: local`.
- **Remote** — any other host. Negative stories submit injection payloads (`DROP TABLE`, XSS strings) and walk failure paths against whatever is listening, and exploration itself clicks through a live app — against a shared, staging, or production host that is not obviously harmless.
  - **Interactive mode:** one `AskUserQuestion` — `question`: `"Target {host} is not local. Generate stories against it?"`, `header`: `"Target env"`, `multiSelect`: `false`; Option 1 `label`: `"Proceed, no negatives (Recommended)"`, `description`: `"Explore and generate positive stories only — set NEGATIVE=false for this run"`; Option 2 `label`: `"Proceed with negatives"`, `description`: `"Include injection/failure-path stories — I own this environment"`; Option 3 `label`: `"Stop"`, `description`: `"Wrong target — abort story generation"`.
  - **Auto mode:** never a mid-flow stop — set `NEGATIVE=false` for this run, log the downgrade to the auto-decision log (`AUTO {time} — Target Environment Guard: {host} is non-local; negative-story generation disabled for this run. Reversibility: high (re-run with an acknowledged target)`), and continue.

Record the outcome in every written story file as a file-level block — `/test qa` re-checks it at execution time before running `negative`-tagged stories:

```yaml
target_env: { host: "app.example.com", classification: remote, negatives_acknowledged: false }
```

1. Create the output directory if it doesn't exist (use `mkdir -p` via the Bash tool — `-p` creates parent directories and silently no-ops if the directory already exists; plain `mkdir` does NOT create parents on macOS/Linux). Then run `agent-browser close --all` once — an idempotent residue sweep so sessions leaked by an interrupted earlier run cannot accumulate (a no-op when nothing is open).
2. Use the `/claude-tweaks:browse` skill to open the site. The concrete command is `agent-browser --session <session-name> open <url>`. Choose `<session-name>` per the kebab-case convention (e.g., `stories-explore`, `stories-checkout`). Use `agent-browser batch --session <name>` to bundle open + initial snapshot + reconnaissance screenshot in one process invocation.
3. Capture an accessibility-tree snapshot via `agent-browser --session <name> snapshot -i -c` to understand the page structure. The snapshot returns elements with role, accessible name, text, label, placeholder, and `data-testid` — these are the only attributes used to build v2 locators.
4. Identify the main navigation, key pages, and interactive elements from the snapshot.
5. Follow links to discover major sections (limit to PAGES pages if `pages=<n>` was set, otherwise 5-8, to stay efficient). When FOCUS is set, prioritize discovery toward pages/sections whose URL path, nav label, or page content matches the focus area — pages outside that area are still noted for navigation context but are not prioritized within the discovery budget.

### Per-Page Data Capture

6. For each page visited, note:
    - What the page is for
    - Key interactive elements (forms, buttons, links, menus)
    - **Semantic locator candidates** for each interactive element. See locator types and preference order in `story-examples.md`. Do NOT capture CSS classes, IDs, or XPath — schema v2 forbids them.
    - What a user would do here
    - What success/failure looks like
    - Whether the page has forms (for negative story generation)
    - Whether the page requires authentication

### Journey-Aware Exploration

When JOURNEY_MAP is non-empty (Step 1.1 found journeys):

For each page visited during exploration, check JOURNEY_URL_INDEX:

- **Page matches a journey step URL:** This page is already documented. Browsing is **enrichment-only**:
  - Capture semantic locator candidates from the accessibility-tree snapshot (same as standard exploration)
  - Verify the page structure matches the journey step description
  - Do NOT re-discover what the page is for, what success/failure looks like, or what the user does here — use the journey step's `action`, `should_feel`, and `should_understand` fields for that context
  - Log: "Page {url} matches journey '{journey_name}' step {N} — enrichment mode."

- **Page does NOT match any journey step URL:** Full discovery (existing behavior). This page has no journey context and gets standard exploration.

**Journey-guided navigation:** When a journey has step URLs that the standard exploration (items 4-5) would not naturally visit, add those URLs to the exploration queue. This ensures all journey-documented pages get enrichment passes. Journey enrichment pages are counted separately from the PAGES discovery cap (5-8 by default, or the `pages=<n>` override) — they are verification, not discovery.

### Auth Resolution (conditional)

If no discovered page requires authentication, skip this section entirely.

If at least one auth-gated page was found, read `auth-resolution.md` in this skill's directory for the full procedure (vault listing, vault-name convention, interactive/auto branches).

### URL-to-Source-File Mapping

For each page visited during exploration, map its URL to the source files that render it. The mapping produces a `SOURCE_FILES` array per URL (relative paths, empty `[]` if none identified) that feeds into Step 3 design.

For the full procedure (route-path extraction, framework detection for Next.js App/Pages Router and SvelteKit/Remix, local-import discovery) and the gotchas (route groups, dynamic routes, monorepo subdirectories), read `source-aware-design.md` in this skill's directory.

## Step 3: Design Stories

1. Based on the exploration, design user stories grouped by persona. Each story must have:
    - **`id`** — a stable kebab-case identifier (e.g. `front-page-loads`, `checkout-flow-completes`)
    - **`description`** — a human-readable description of the journey (also accepted as `name` for back-compat)
    - **`url`** — the starting URL (the qa-agent auto-navigates here, so no "Navigate to X" step needed)
    - **`tags`** — categorize by type: `navigation`, `core`, `form`, `error-handling`, `smoke`, `critical`
    - **`priority`** — `high` for happy-path core flows, `medium` for secondary flows, `low` for edge cases
    - **`source_files`** — array of relative file paths from the URL-to-Source-File Mapping (Step 2). Populate from the `SOURCE_FILES` data collected during exploration for the story's URL. Use an empty array `[]` if no mapping was found.
    - **`auth`** — (optional) `{ vault: "<vault-name>" }` for stories that require login. See Auth Vault section.
    - **`steps`** — structured step array with `action`, semantic `locator`, optional `value`, and optional `verify` per the v2 schema

### Source-Aware Story Design

When a page has a non-empty SourceContract (from Step 1.5), use its signals to generate deeper stories — boundary-value stories for input constraints, state-transition stories, error-path stories, and conditional-rendering coverage. When the SourceContract is empty, generate stories from DOM exploration data only.

For the full per-signal generation rules (input boundaries, state transitions, error paths, conditional rendering), read `source-aware-design.md` in this skill's directory.

### Journey-Aware Story Design

When JOURNEY_MAP is non-empty (Step 1.1 found journeys), read `journey-aware-design.md` in this skill's directory for the full design rules (journey-to-story mapping, the mandatory `journey:` field, source-file inheritance, assertion derivation from `should_feel`/`should_understand`/`red_flags`, step ordering, and negatives). Pages with no journey context get DOM + source-analysis design only.

### Diff-Aware Design (when update mode is active)

2. Compare discovered pages against EXISTING_STORIES to classify each as **NEW**, **EXISTING** (unchanged → skip), or **STALE** (locators unresolvable, source files modified, or behavioral contracts changed → regenerate). Log the diff summary and emit STALE_LOCATORS / STALE_SOURCE_FILES warnings.

For the full staleness procedure (locator-resolution checks via `agent-browser find`, `git diff` source-file checks, behavioral-contract comparison against re-extracted SourceContract) and the warning templates, read `source-aware-design.md` in this skill's directory.

### Negative Story Generation (when NEGATIVE=true)

4. Read `negative-stories.md` in this skill's directory for the per-page generation rules (form-validation, navigation, interaction, auth, and search negatives) and the `neg-` ID/tag/priority conventions. NEGATIVE may have been forced to `false` for this run by the Target Environment Guard (Step 2) — in that case skip this file entirely and note the downgrade in the Step 6 report.

### Standard Design (all modes)

6. For stories that share common prerequisites:
    - Identify shared setup steps (e.g. authentication, navigation to a section)
    - Extract these into a file-level `setup` block
    - Use `requires` labels to indicate prerequisites (e.g. `requires: [auth]`)

    **Auth Vault references (v2):** When the story requires authentication, set the story-level `auth: { vault: "<vault-name>" }` field — see the top-level Auth Vault section for the setup command, runtime invocation, and the "LLM never sees passwords" guarantee.


7. Identify `depends_on` relationships between stories:
    - If story B only makes sense after story A passes (e.g. "view cart" depends on "add to cart"), set `depends_on: add-to-cart` on story B
    - Keep dependency chains short — prefer independent stories where possible

8. Story categories to consider:
    - **Navigation flows** — can the user find their way around?
    - **Core workflows** — the main thing each persona does (purchase, configure, create)
    - **Form interactions** — search, login, signup, data entry
    - **State transitions** — adding to cart, changing settings, submitting forms
    - **Error handling** — what happens with bad input, missing pages, unauthorized access

9. If PERSONA was specified, focus stories on that persona. If not, generate stories for the most obvious personas the site serves.
10. If FOCUS was specified, scope full story generation to pages/flows matching that area. Pages discovered outside FOCUS during navigation get, at most, a single `smoke`-tagged story verifying the page loads — they do not get the full core/form/error-handling story set that in-focus pages get. If FOCUS was not specified, generate stories across all discovered pages/flows as normal.

## Step 4: Write

1. Write one YAML file per persona or logical grouping, following the canonical Story schema (v2) section at the top of this file: `schema_version: 2` first, then the file-level blocks that apply (`setup`, `teardown`, and the Target Environment Guard's `target_env` — always written when Step 2 classified the target), then the `stories` array. Complete worked examples of every block and field live in `story-examples.md`.

**Locators** in `locator:` must be semantic. CSS selectors, XPath, and snapshot refs (`@eN`) are forbidden in YAML. See locator types and preference order in `story-examples.md`.

### Update Mode Write Rules

2. When update mode is active (existing stories detected in Step 1):
    - **EXISTING stories (unchanged):** Do NOT rewrite. Leave as-is in the YAML file.
    - **STALE stories (regenerated):** Read the existing YAML file. Replace only the regenerated stories, preserving unchanged stories in the same file. Preserve file-level `setup` and `teardown` blocks unless exploration found they need updating.
    - **NEW stories:** If a file for the same persona/grouping already exists, append the new stories to that file's `stories` array. If no file exists for this grouping, create a new file.
    - **NEVER** delete existing stories that were not regenerated — they may cover flows the exploration didn't re-encounter.
    - **ALWAYS** preserve existing story IDs exactly — they may be referenced in CI pipelines or dependency chains.
    - **Clear healed repair tags.** Remove `needs-auth-vault` from stories whose vault now exists (per `auth-resolution.md`'s Tag self-heal section) and `needs-review` (plus its `# REFINEMENT_WARNING` comment) from stories that pass this run's validation (per `refine.md` 5c) — a repair tag that outlives its condition makes `/test qa`'s Story Hygiene section re-report a solved problem forever.

### Negative Story Write Rules

3. When NEGATIVE is true:
    - Place negative stories AFTER all positive stories in the `stories` array.
    - If there are more than 5 negative stories for a single persona/grouping, write them to a separate file: `{OUTPUT_DIR}/{site-name}-{persona}-negative.yaml`.
    - In update mode, existing negative stories (IDs starting with `neg-`) are included in the diff comparison — they get the same stale-selector treatment as positive stories.

4. File naming: `{OUTPUT_DIR}/{site-name}-{persona-or-area}.yaml`
    - Examples: `stories/myapp-customer.yaml`, `stories/myapp-admin.yaml`, `stories/myapp-customer-negative.yaml`
    - **Multi-spec shared worktree (#786):** when this invocation is running inside a multi-spec `/flow` run's shared worktree (`MULTISPEC_SHARED_WORKTREE=1` is set, or `$PIPELINE_RUN_DIR`'s basename is `spec-{N}`), suffix the filename with `-{N}` before the extension — `{OUTPUT_DIR}/{site-name}-{persona-or-area}-{N}.yaml` — so two specs generating stories for the same site/persona in the same run never overwrite each other's file. `{N}` is the record id, same as `flow/multi-spec.md`'s `spec-{N}/` subdirectory keying. Outside a multi-spec shared worktree, write the unsuffixed filename exactly as before.

5. Close all browser sessions when done writing (Step 5 re-opens fresh sessions for refinement).

## Step 4.5: Story Self-Review

After writing, look at the YAML with fresh eyes. Fix issues inline — this is the cheap pass before Step 5's DOM-validation pass.

1. **Selector quality** — every locator must use a semantic attribute (`role`, `label`, `text`, `placeholder`) or `testid`. CSS selectors, XPath, class names, IDs, and `@eN` snapshot refs are forbidden in schema v2 — brittle structural paths like `div > div:nth-child(3) > button` get caught here before they break in CI.
2. **Assertion specificity** — every step asserts something concrete. "Page loads" is too vague; "URL contains `/dashboard` and `text:Welcome` is visible" is actionable.
3. **Persona coherence** — each story's actions are consistent with its persona's permissions. Don't have a logged-out persona clicking a settings link that requires auth.
4. **Source-aware integrity** — when stories are source-aware (Step 1.5 ran), the asserted outcomes match what the SourceContract said the code does. A story that asserts a behavior the source doesn't implement is a placeholder story.

If REFINE=true, Step 5 will catch DOM-level issues this pass missed. If REFINE=false, this is your only check — fix anything you find.

## Step 5: Refine (conditional — when REFINE=true)

If `refine=false` was passed in `$ARGUMENTS`, skip this step entirely and proceed to Step 6.

Otherwise read `refine.md` in this skill's directory for the full Refine procedure: 5a Quick Validation Pass (sample selection, locator resolution, trace-on-failure), 5b Self-Correction Round (regenerate failed stories from a fresh snapshot, one round max), and 5c Persistent Failure Handling (`REFINEMENT_WARNING` comment + `needs-review` tag).

## Step 6: Report and Handoff

1. Report what was generated:
    - Number of story files created or updated
    - Number of stories per file
    - Summary of personas/areas covered
    - The output directory path

    **Source analysis additions:**
    - Number of pages with non-empty SourceContracts
    - Number of source-aware stories generated (boundary-value, state transition, error path, conditional rendering)
    - Pages where source analysis was skipped (unsupported framework, no source files found) with reason

    **Update mode additions:**
    - Number of existing stories unchanged
    - Number of stories regenerated (with reasons: stale locators, modified source files, behavioral contract changes)
    - Number of new stories added
    - Stale locator warnings (full list with story IDs and locator specs)
    - Behavioral contract change warnings (full list with story IDs and change descriptions)

    **Negative additions:**
    - Number of negative stories generated
    - Categories covered (form validation, 404, auth, search, etc.)
    - Note: "Filter negative stories in validation: `/claude-tweaks:test qa tag=negative`"

    **Refine additions:**
    - Stories validated in the refinement pass, stated as a sample: "validated {N} of {M} total stories (sample: all high-priority + up to 3 medium)" — never a bare "all stories validated", which overclaims whole-suite health from a capped sample
    - Number corrected; number of stale `needs-review`/`needs-auth-vault` tags cleared by self-heal
    - Number with persistent failures (tagged `needs-review`) and their trace paths — traces are Chrome DevTools traces, opened via Chrome DevTools → Performance → Load profile

    **Target environment (when the guard classified a remote target):**
    - The recorded `target_env` line, and whether negative-story generation was downgraded for this run

    **Journey coverage (when journeys exist):**

    When JOURNEY_MAP is non-empty, build the coverage report per `coverage-report.md` in this skill's directory — produce the Journey Coverage table, the Orphaned Stories list, and (in update mode) the JOURNEY_LINK_SUGGESTIONS auto/interactive flow as a separate batch decision.

### Actions Performed

| Action | Detail | Ref |
|--------|--------|-----|
| Operational | {Generated/Updated/Deleted} {story description} — `{yaml file}` | — |

One row per story file written, updated, or deleted. Omit unchanged files. `Operational` is CLAUDE.md's canonical Action type for this kind of tooling/test-artifact write — the same type `wrap-up/SKILL.md` and `specify/SKILL.md` use for non-implementation file changes.

## Examples

For complete YAML examples covering DOM-only stories, source-aware stories (with boundary-value and error-path coverage), and journey-aware stories, read `story-examples.md` in this skill's directory.

## Guidelines

Judgment rules the numbered steps don't already state (mechanical rules live in their own steps and sub-files — this list does not restate them):

- Keep stories focused — one journey per story, 3-8 steps each
- Use concrete element names and text found during exploration, not generic descriptions
- Prefer verifiable assertions ("Verify at least 3 items visible") over vague ones ("Verify page looks right")
- Use `depends_on` sparingly — only when story B literally cannot run without story A succeeding first
- Don't generate stories for flows that require real credentials unless an Auth Vault entry exists or the user has agreed to save one
- `.claude-tweaks/artifacts/` (the screenshots/traces home) is tooling residue, not project content — ensure it is gitignored (init's suggested block covers it; add the entry if missing), and never commit trace zips

## Next Actions

When invoked by a parent skill (e.g., `/claude-tweaks:flow`), omit this block — the parent owns the handoff. When invoked directly by a user, resolve 1-4 lines based on context — include the smoke line only when at least one story is tagged `smoke`; include the `affected` line only when update mode regenerated stories; include the journey line only when a journey was the dominant story source.

Render as plain markdown (docs/skill-authoring.md's Skill handoffs convention):

**`/claude-tweaks:test qa`** — validate all {N} stories against the running app (recommended)
`/claude-tweaks:test qa tag=smoke` — quick pass on {N} smoke stories first (when smoke stories exist)
`/claude-tweaks:test qa affected` — validate only changed stories (when update mode regenerated stories)
`/claude-tweaks:test qa journey={name}` — validate {N} stories for the {name} journey (when journeys exist)

## Component-Skill Contract

This skill is a **component skill** — invoked by `/claude-tweaks:flow` (auto-triggered between build and test when UI files change, unless `no-stories`). Parent invocation is signaled by `$PIPELINE_RUN_DIR` being set (set by `/flow`, `/build`, or other pipeline orchestrators). Direct invocations may pass `--source <parent>` as an explicit fallback. When invoked by a parent, omit the `## Next Actions` block — the parent owns the handoff. When invoked directly by a user, render Next Actions as shown above.

## Anti-Patterns

| Pattern | Why It Fails |
|---------|-------------|
| Generating stories without browsing the site first | Must be grounded in actual page structure and the live accessibility-tree snapshot |
| Using CSS selectors, XPath, IDs, or class names in v2 schema | Semantic-only schema; CSS is brittle and forbidden — locator types in `story-examples.md` |
| Storing `@eN` snapshot refs in story YAML | Refs are session-scoped and regenerate every snapshot — store the semantic locator, execute at runtime via `find <locator> <value> <action>` |
| Running an action-less `find` as an existence probe | A bare `find` with no action defaults to CLICKING the element — assertions and staleness checks go through `snapshot`, never `find` |
| Generating negative stories against a non-local target without acknowledgment | Injection payloads and failure-path walks hit whatever is listening — the Target Environment Guard (Step 2) downgrades or confirms first |
| Skipping the v1 detection prompt and silently parsing legacy files | v1 CSS selectors are forbidden in v2, so silent parsing breaks stories — run the v1 detection / regeneration UX whenever `schema_version: 2` is missing |
| Inlining credentials in story YAML | Risks accidental commits — use `auth: { vault: "<name>" }` so the LLM never sees passwords |
| Deleting existing stories in update mode | They may cover flows the exploration didn't re-encounter |
| Vague verify assertions ("page looks right") | QA agents need concrete, testable assertions |
| Including "Navigate to URL" as a first step | The `url` field already handles initial navigation |
| Skipping form-page negative coverage when NEGATIVE=true | Forms with user input always get validation-failure stories — they catch real security and UX bugs. (`negative=false` is an explicit opt-out.) |
| Running more than one refinement correction round | Diminishing returns and high token cost — cap at one round |
| Closing a session on step failure without saving the trace first | Failure records without a trace path aren't actionable — `trace stop <path>` before `close`, with recording started via `trace start` at session open (no retroactive capture) |
| Blocking story generation when source analysis fails | Source analysis is never a hard gate — degrade gracefully to DOM-only |
| Following imports beyond 3 levels of depth | Signal-to-noise drops, analysis time grows — use what you have at the limit |
| Generating source-aware stories for non-user-triggerable conditionals | Server-config and feature-flag branches cannot be exercised through the browser |
| Browsing from scratch when journey files document the same pages | Journeys already carry URLs, personas, steps, and success states — ingest in Step 1.1 and enrich with locators and assertions |
| Auto-linking existing stories to journeys without user confirmation | Step 6 presents journey links as recommendations — the user decides whether to add `journey:` fields |
