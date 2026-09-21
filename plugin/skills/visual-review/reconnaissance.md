# Reconnaissance Procedure

Contextual pre-analysis for the visual review. Runs as Step 0 (before Step 1 Health Check) in page and journey modes to understand what the page IS before evaluating whether it's GOOD. Produces a **Review Brief** that enriches Steps 1-5 with page-specific perspectives.

## When This Runs

- Before every visual review (page mode, journey mode, full mode)
- After QA Data Loading (if applicable) but before Step 1
- Skipped in discover mode (discover mode finds pages, not evaluates them)

## Inputs

| Input | Source | Required |
|-------|--------|----------|
| URL | Mode resolution from browser-review.md | Yes |
| Browser session | Already open from mode resolution | Yes |
| QA data | QA Data Loading step (if available) | No |
| Journey file | Journey mode (if applicable) | No |
| Source code access | Local project with identifiable source files | No |

## Phase 1: Browse and Capture

Snapshot and screenshot at each scroll position act on the same live `playwright-cli` session — they are not independent in the Form-A sense and must not run as concurrent tool calls (see SKILL.md's Anti-Patterns table: "Per-step invocations during journey walks"). <!-- playwright-cli: no equivalent found for agent-browser batch — see issue Gotchas --> Run the scroll + snapshot + screenshot sequence for all three positions as separate sequential commands against the same session instead — Playwright CLI has no `batch` equivalent to bundle them into one invocation (`playwright-cli-reference.md`'s Operation vocabulary table) — one session lifecycle, no risk of racing another session's process state.

Capture the full page state before classifying. Three scroll positions maximum — this must be fast.

1. **Top of page:** Take a snapshot (accessibility tree) + screenshot at the current viewport
2. **Middle of page:** Press PageDown (or scroll to ~50% height), take snapshot + screenshot
3. **Bottom of page:** Press End, take snapshot + screenshot
4. **Scroll back to top** after capturing

From the snapshots, extract:

| Signal | What to look for |
|--------|-----------------|
| **Element inventory** | Total interactive elements (buttons, links, inputs), section count (h1-h3 headings as section markers), form count, image count |
| **Text signals** | Primary heading (h1), subheadings, CTA button text, visible pricing/social proof numbers |
| **Navigation structure** | Nav elements, breadcrumbs, tabs, sidebar presence |
| **Data fullness** | Are there visible counts (e.g., "0 reviews", "12 recipes")? Are lists populated or empty? Are social metrics zero? |
| **Auth signals** | Login/signup buttons visible? User avatar/name visible? "My account" link? Auth-gated prompts ("Sign in to...")? |
| **Visual signals** | Placeholder images? Hero area? Cards? Tables? Large empty spaces? Color usage? |

## Phase 2: Source Code Cross-Reference (conditional)

**Skip this phase when:**
- The review target is an external URL (not localhost / 127.0.0.1)
- No source files can be identified for the URL
- Log: "Source analysis skipped — {reason}." and proceed to Phase 3.

When the target is a local project with accessible source code, extract visual-review-specific signals. Use the URL-to-source mapping pattern from `source-analysis.md` in the `/claude-tweaks:stories` skill's directory for framework detection (Next.js App Router, Pages Router, SvelteKit, etc.). Follow imports up to 2 levels deep (shallower than source-analysis.md's 3 — speed matters here).

> **Parallel execution:** Use parallel tool calls aggressively — all Read operations on identified source files are independent and should run concurrently.

### Signals to Extract

These are different from `source-analysis.md` (which extracts behavioral signals for story generation). Visual review needs structural signals:

| Signal | What to look for | Why it matters |
|--------|-----------------|----------------|
| **Component render order** | Sequence of JSX elements/components in the return statement | Reveals intended information hierarchy — does visual order match code order? |
| **Spacing/layout patterns** | Tailwind classes (`gap-*`, `space-*`, `mb-*`, `grid-cols-*`), CSS patterns | Reveals whether density/rhythm is intentional or uniform |
| **Auth conditionals** | `{isAuthenticated && ...}`, `{session ? ... : ...}`, route guards | Reveals what differs between public and logged-in views |
| **Empty state handling** | Conditionals checking `.length === 0`, `!data`, fallback components | Reveals whether empty states were designed or neglected |
| **Component count** | Number of distinct component imports rendered on the page | Reveals complexity — 20+ components may indicate section bloat |
| **Conditional sections** | `{showSection && ...}`, feature flags, viewport-conditional rendering | Reveals hidden content that may affect the review |

Do NOT extract: input constraints, validation schemas, API call patterns, error handling paths, state variables, toast triggers. Those belong to `source-analysis.md` for story generation.

### Source Summary Output

```
Source files: {file list}
Components rendered: {count} ({count rendering visible output})
Auth-conditional sections: {count} ({brief description of what's gated})
Empty state handlers: {count designed} of {count potential empty states}
Layout system: {Tailwind grid/flex | CSS modules | styled-components | unknown}
Spacing pattern: {uniform mb-N | varied | grid-based | unknown}
```

## Phase 3: Classify the Page

Using browse captures (Phase 1) and optional source analysis (Phase 2), classify the page along 6 dimensions. Select exactly one value per dimension.

### Dimension 1: Page Type

| Value | Signals |
|-------|---------|
| **Content/Detail** | Single item display, article/post layout, media-heavy, comments section, share buttons |
| **Landing/Marketing** | Hero section, value propositions, testimonials, CTA-heavy, pricing table, no app navigation |
| **List/Dashboard** | Tables, card grids, filters, sorting controls, pagination, metrics/stats widgets |
| **Form/Wizard** | Multi-field forms, step indicators, progress bars, validation messages, submit buttons |
| **Utility** | Settings, profile, account, preferences — functional but not a primary destination |

### Dimension 2: Authentication Context

| Value | Signals |
|-------|---------|
| **Public-facing** | No auth UI visible for the user, login/signup buttons present, SEO-relevant content |
| **Authenticated** | User avatar/name visible, personalized content, "My ..." links, no login button |
| **Mixed** | Both public content and auth-gated sections visible, or login prompts within content |
| **Auth-wall** | Page is entirely behind authentication — cannot be viewed without login |

### Dimension 3: Business Stage (inferred)

| Value | Signals |
|-------|---------|
| **Pre-launch / Early** | Zero-count metrics (0 reviews, 0 users), placeholder content, missing features, "coming soon" badges, waitlist CTAs |
| **Growth** | Some populated data but sparse, feature flags visible, beta badges, incomplete sections alongside polished ones |
| **Mature** | Rich populated content, consistent polish, full feature set, no placeholder content |

### Dimension 4: Data State

| Value | Signals |
|-------|---------|
| **Rich** | Lists with 5+ items, populated metrics, full content areas, real images |
| **Sparse** | Lists with 1-3 items, some empty sections alongside populated ones |
| **Empty** | Zero-count metrics, empty lists, "get started" prompts, placeholder images |
| **Mixed** | Some sections rich, others empty — common in multi-section pages |

### Dimension 5: Component Complexity

| Value | Signals |
|-------|---------|
| **Simple** | 1-3 visible sections, minimal interaction points, single-purpose page |
| **Moderate** | 4-7 visible sections, multiple interaction types, clear structure |
| **Complex** | 8-12 visible sections, many interaction types, tabs/accordions/nested navigation |
| **Overloaded** | 13+ visible sections, so many interactions that the page feels like multiple pages stitched together |

### Dimension 6: Audience

| Value | Signals |
|-------|---------|
| **Consumer** | Friendly language, imagery-heavy, emotional CTAs, social proof, consumer pricing |
| **Enterprise** | Formal language, "contact sales," team/org features, compliance mentions, role-based UI |
| **Developer** | Code snippets, API references, CLI commands, technical jargon, documentation links |
| **Internal/Admin** | Data tables, management controls, system status, no marketing language |

### Classification Output

```
Page: {URL}
Type: {value} | Auth: {value} | Stage: {value} | Data: {value} | Complexity: {value} | Audience: {value}
```

## Phase 4: Generate Review Perspectives

Select 6-10 perspectives from the library below based on the classification. Each perspective has relevance triggers — classification values that make it applicable.

### Selection Algorithm

1. Score each perspective: count how many of its relevance triggers match the classification
2. Include all perspectives with 2+ matching triggers
3. If fewer than 6 qualify, include the highest-scoring 1-trigger perspectives until 6 is reached
4. If more than 10 qualify, keep only the top 10 by score
5. Order by score descending (most relevant first)

### Perspective Library

| # | Perspective | One-line description | Relevance triggers |
|---|-------------|---------------------|--------------------|
| 1 | **First Impression / Squint Test** | Does the page communicate its purpose in 3 seconds with blurred vision? | Content/Detail, Landing/Marketing, Consumer, Public-facing |
| 2 | **Information Hierarchy** | Does the visual weight match the content importance? | Complex, Overloaded, Content/Detail, List/Dashboard |
| 3 | **Conversion Funnel** | Does the page guide visitors toward the primary action without friction? | Landing/Marketing, Public-facing, Consumer, Growth, Pre-launch / Early |
| 4 | **Content Density vs. Breathing Room** | Is the page too packed or too sparse for its content type? | Complex, Overloaded, List/Dashboard, Rich |
| 5 | **Mobile Readiness** | Would this page survive a thumb-only, small-screen interaction? | Consumer, Public-facing, Content/Detail, Complex |
| 6 | **Empty State Design** | Do zero-data states guide users toward value or show a void? | Empty, Mixed (data), Pre-launch / Early, Sparse |
| 7 | **Social Proof / Trust** | Does the page earn credibility through evidence, not claims? | Landing/Marketing, Consumer, Public-facing, Pre-launch / Early |
| 8 | **CTA Clarity** | Is there one clear primary action, or do competing actions dilute focus? | Landing/Marketing, Form/Wizard, Public-facing, Consumer |
| 9 | **Component Bloat / Section Count** | Does every section earn its place, or is this a feature dump? | Complex, Overloaded, Moderate (borderline) |
| 10 | **Visual Rhythm** | Do sections flow with a consistent pace, or is the page arrhythmic? | Content/Detail, Complex, Overloaded, Rich |
| 11 | **Form Friction** | Can a user complete this form without confusion, error, or abandonment? | Form/Wizard, Authenticated, Consumer, Enterprise |
| 12 | **Data Scan-ability** | Can a user find what they need in a table/list without reading every row? | List/Dashboard, Rich, Enterprise, Internal/Admin |
| 13 | **Onboarding Clarity** | Does a new user know where to start and what to do first? | Empty, Pre-launch / Early, Growth, Authenticated |
| 14 | **Power User Efficiency** | Can an experienced user accomplish repeated tasks without ceremony? | Authenticated, List/Dashboard, Enterprise, Internal/Admin, Mature |
| 15 | **Error Recovery** | When something goes wrong, does the page help the user recover? | Form/Wizard, Authenticated, Complex |
| 16 | **Auth State Coherence** | Does the page make sense in both logged-in and logged-out states? | Mixed (auth), Public-facing, Growth |
| 17 | **Loading / Skeleton States** | During data fetches, does the page show meaningful structure or just a spinner? | List/Dashboard, Complex, Rich, Authenticated |
| 18 | **Settings Sprawl** | Are configuration options organized, prioritized, and discoverable? | Utility, Authenticated, Complex, Enterprise |
| 19 | **Accessibility as Experience** | Beyond compliance — does the page feel equally good for keyboard, screen reader, and low-vision users? | Form/Wizard, Public-facing, Enterprise, Content/Detail |
| 20 | **Developer Experience** | Are code samples copyable, APIs documented inline, and concepts explained progressively? | Developer, Content/Detail, Public-facing |

### Perspective Output

For each selected perspective, generate context-specific guidance tailored to THIS page — not the generic one-liner from the library:

```
### Perspective {N}: {Name}
**Why this page:** {one sentence explaining why this perspective matters for this specific page and classification}
**Look for:** {2-3 specific things to examine, referencing classification details and source analysis when available}
**Informs steps:** {which review steps — e.g., "First Impressions (Step 2), Analyze (Step 4)"}
```

## Phase 5: Formulate the Central Question

Based on the classification and selected perspectives, formulate a single question that captures the core tension for this page. This is the thread connecting all perspectives.

The central question is NOT generic — it must reference the specific page context.

**Examples by classification:**
- Content/Detail + Pre-launch / Early + Empty: "Does this page serve the business goal or the developer's feature checklist?"
- Landing/Marketing + Consumer + Public-facing: "Would a visitor who doesn't know this product understand what it does and want to try it?"
- List/Dashboard + Authenticated + Complex: "Can a user find what they need and take action without being overwhelmed?"
- Form/Wizard + Consumer + Authenticated: "Would a user complete this form on the first attempt without help?"
- Utility + Enterprise + Mature: "Can a user change what they need and be confident nothing else broke?"
- Content/Detail + Public-facing + Pre-launch / Early + Mixed: "Would a Google searcher who lands here trust this enough to engage and sign up?"

## Output: The Review Brief

Assemble all findings into the brief that the reviewer carries through Steps 1-5:

```markdown
## Review Brief: {page description}

**URL:** {url}
**Classification:** {Type} | {Auth} | {Stage} | {Data} | {Complexity} | {Audience}

### Source Analysis
{Source summary from Phase 2, or "Source analysis skipped — {reason}"}

### The Central Question
> {The formulated central question}

### Review Perspectives ({count})

| # | Perspective | Why This Page | Informs Steps |
|---|-------------|---------------|---------------|
| 1 | {name} | {one-line context} | {step numbers} |
| 2 | {name} | {one-line context} | {step numbers} |
| ... | ... | ... | ... |

### Perspective Guidance

{Full perspective blocks from Phase 4}

### Step Enrichment Map

| Step | Standard Focus | Added by Reconnaissance |
|------|---------------|------------------------|
| 1 (Health Check) | Console errors, network, rendering | {reconnaissance-specific health signals, or "No additions"} |
| 2 (First Impressions) | 5-second test, raw reaction | {e.g., "Apply Squint Test and CTA Clarity lenses"} |
| 3 (Use It) | Persona rotation, interaction feel | {e.g., "Prioritize Distracted Mobile User (Mobile Readiness selected)"} |
| 4 (Analyze) | Layout, content, polish, responsive, accessibility | {e.g., "Focus on Component Bloat, Visual Rhythm, Content Density"} |
| 5 (Reimagine) | Best version, alternatives | {e.g., "Empty State Design and Social Proof are primary reimagine targets"} |
```

## Speed Constraint

The entire reconnaissance (Phases 1-5) should complete within ~60 seconds of active work:
- Phase 1 (Browse): ~15s (3 scroll positions, parallel captures)
- Phase 2 (Source): ~15s (file identification + parallel reads) or 0s if skipped
- Phase 3 (Classify): ~5s (pattern matching against captured data)
- Phase 4 (Perspectives): ~15s (selection + tailored guidance)
- Phase 5 (Central Question + Assembly): ~10s

Do not iterate, re-browse, or ask for user input. Classify and move on. The review steps are where depth happens.

## Graceful Degradation

| Missing Input | Behavior |
|--------------|----------|
| No source code access | Skip Phase 2. Classify from DOM-only signals. Note "DOM-only classification" in the brief. |
| No QA data | No impact — reconnaissance does not depend on QA data. |
| External URL (not localhost) | Skip Phase 2. Classify from DOM-only. |
| Journey mode | Use journey persona and goal to weight perspective selection — these override Audience and Auth dimension inference. |
| Page is broken/blank | Abort reconnaissance. Proceed directly to Step 1 (Health Check) which will catch the breakage. |
| SPA with dynamic routing | URL-to-source mapping may fail. Degrade to DOM-only. Log: "Source mapping failed — SPA with dynamic routing." |
