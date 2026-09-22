# Browser Review Procedures

Shared procedures for every `/claude-tweaks:visual-review` mode that opens the browser. This
file holds what those modes need: prerequisites, mode resolution, QA enrichment,
reconnaissance, and the review contract they report against. The per-mode procedures live in
their own files — `page-mode.md`, `journey-mode.md`, and `discover-mode.md` in this skill's
directory — so a run loads only the mode it resolved to.

## Prerequisites

`playwright-cli` must be installed. There is no persistent background daemon — each `open`/`attach` call starts or reuses a named browser process directly, and `list`/`close-all`/`kill-all` operate on that set of processes this CLI invocation tree manages, not on a daemon (`_shared/browser-detection.md`'s Session/process lifecycle section). If `playwright-cli` is unavailable, **stop** and report the missing dependency per `SKILL.md` Step 1 (Browser Prerequisites). <!-- playwright-cli: no equivalent found for agent-browser doctor — see issue Gotchas --> Recovery from a stuck session: there is no diagnostic command; run `playwright-cli close-all` (or `kill-all` if that doesn't clear it) to reset the process set, then re-open the session.

Use the `/claude-tweaks:browse` skill's operation vocabulary and conventions for all browser operations throughout this document. Concrete commands live in `playwright-cli-reference.md` in that skill's directory; `browse` is the single source of truth for the operation table.

### Session naming

Derive a kebab-case session name from the review target: `pricing-page-review`, `checkout-journey-review`, `discover-public-pages`. One session per page review or per journey walk.

### Screenshot path convention

All screenshots in this skill carry no overlay annotation (see the Element-reference convention below) and are written to:

```
.claude-tweaks/artifacts/screenshots/browse/<session>/<NN>_<description>.png
```

`<NN>` is a zero-padded sequence number per session (`01_landing`, `02_pricing`, ...).

**Element-reference convention (settled, #2671):** `playwright-cli screenshot` has no `--annotate`-style flag — captured screenshots carry no bounding-box/numbered-marker overlay (confirmed during #2645's migration, `playwright-cli-reference.md`'s Screenshot row), so the pre-migration "overlay number" convention (e.g. "element [3]") has no equivalent and is retired. Every instruction below that references a specific element does so by its `eN` ref from the most recent `snapshot`, paired with a short plain-language description captured at the same moment (e.g. `e12 (primary CTA button)`) — the pairing matters because `eN` refs are ephemeral and regenerate on every snapshot (`playwright-cli-reference.md`'s Cautions section), so capture the ref and its description together at the moment of finding, not after the fact, or a written report can reference a ref that no longer resolves to anything by the time it's read.

## Mode Resolution

`SKILL.md`'s own Modes table is canonical for the full mode list — it also covers
`recommendation` mode, which short-circuits in `SKILL.md` Step 0.5 without ever opening the
browser or reading this file. The browser-opening modes this file serves:

| Mode | Input | What happens |
|------|-------|-------------|
| **Page mode** | URL or description | Review a single page or flow. Full creative framework applies. Vitals captured for the page. |
| **Journey mode** | `journey:{name}` | Walk a documented journey via a sequence of `playwright-cli` commands against one session (no `batch` equivalent — see `journey-mode.md`). Each step is reviewed against its "should feel" / "red flags." Vitals captured per page. Overall arc assessed. |
| **Discover mode** | `discover` | Explore the running app to identify and document undocumented user journeys. Codebase scan + browser walkthrough. Vitals captured per discovered page. |

Page mode is for quick checks or pages that aren't part of a defined journey yet. Journey mode is the richer review — it has defined personas, goals, and experiential expectations at every step. Discover mode is for brownfield projects that need journey coverage bootstrapped.

### Dev URL Resolution

Run the canonical procedure in `dev-url-detection.md` in `skills/_shared/` — it probes `stories/servers.yml` (`servers.default.url`) first and falls back to detection heuristics. This eliminates the "Enter URL" prompt on subsequent runs when the dev server is running at the same address.

### Ensure the app is running

Before navigating, confirm the application is accessible. Dev URL resolution — including what to do when the URL doesn't respond — is handled by `SKILL.md` Step 2 (Dev URL Resolution) before this file's mode-specific procedures run; it covers both auto mode (ephemeral worktree server, pre-authorized) and interactive mode (`AskUserQuestion` offering to start the dev server, try a different URL, or wait — consent-gated). If a page open still fails mid-session after that resolution (e.g., the server died between steps), treat it as a health-check failure per Step 1: capture a trace, close the session, and report — don't re-prompt with a different option set than Step 2 already offered.

---


## QA Data Loading (optional enrichment)

Before starting the review steps, check whether QA data is available from a recent `/claude-tweaks:test qa` or `/claude-tweaks:test all` run. QA data enriches the structured review steps (Health Check, Analyze, Reimagine) but is not required — the full visual review works without it. Intuitive steps (First Impressions) are deliberately kept QA-free to preserve raw reactions.

> **Parallel execution:** Use parallel tool calls aggressively — all Glob and Read operations below are independent and should run concurrently.

1. **Find the latest QA run directory:** Glob for `.claude-tweaks/artifacts/screenshots/qa/*/report.json` and take the most recent by timestamp prefix.
2. **Read `report.json`:** Extract `page_inventories`, `caveats`, `findings`, and `stories` (for screenshot directories).
3. **Collect screenshots:** List screenshot files across story subdirectories in the QA run directory.

If no QA run directory or `report.json` exists, set `QA_DATA_AVAILABLE = false` and proceed — every QA integration point in the mode procedure that follows is skipped silently.

If QA data is found, set `QA_DATA_AVAILABLE = true` and store:
- `QA_PAGE_INVENTORIES` — structured page data (element counts, forms, navigation, accessibility, layout)
- `QA_CAVEATS` — observations from PASS_WITH_CAVEATS stories
- `QA_SCREENSHOTS` — paths to pre-captured screenshots
- `QA_FINDINGS` — classified findings from failures (code-bug, stale-selector, ux-issue, flaky-env, story-bug)

---


## QA-Accelerated Mode

When `QA_DATA_AVAILABLE = true`, the visual review shifts from comprehensive inspection to **verify + discover**. QA already performed mechanical checks (element counts, accessibility attributes, layout measurements, happy-path execution). The visual review focuses on what QA cannot assess: raw human reactions, visual feel, interaction quality, and creative ideas.

Steps 1, 3, and 4 have QA-accelerated variants that are shorter. Steps 2 (First Impressions) and 5 (Reimagine) run at full depth regardless — Step 2 captures raw reactions that must be QA-free, and Step 5 is judgment-based. Step 6 (Report & Route) is unchanged.

When `QA_DATA_AVAILABLE = false`, run all steps at full depth as documented in the resolved mode's own procedure file.

---


## Step 0: Reconnaissance

Before the structured review steps, understand what the page IS to generate contextual review perspectives instead of applying generic checklists.

Read `reconnaissance.md` in this skill's directory and run the full procedure. The output is a **Review Brief** containing: page classification (6 dimensions), selected review perspectives (6-10, trigger-scored), source code analysis (when accessible), and a central question framing the core tension.

Carry the Review Brief through all subsequent steps. Each step consults the brief's **Step Enrichment Map** for perspectives that inform that step's analysis.

**Gate:** If the page is broken or blank during reconnaissance browsing, abort and proceed directly to Step 1 (Health Check) — the health check will catch and report the failure.

**In journey mode:** Pass the journey's persona and goal to the reconnaissance procedure. These override the Audience and Auth dimension inference and weight perspective selection toward journey-relevant perspectives.

**In QA-accelerated mode:** Reconnaissance runs at full depth regardless — it is lightweight and classification quality does not depend on QA data.

---


## Journey Mode

When the resolved mode is `journey:{name}`, read `journey-mode.md` in this skill's directory for the full Journey Mode procedure (load journey → command sequence → per-step review → arc assessment → journey-mode report → journey-file updates → trace-on-failure).

---


## Discover Mode

When the resolved mode is `discover`, read `discover-mode.md` in this skill's directory for the full Discover Mode procedure (codebase scan → journey candidates → browser walkthrough → write journey files → coverage report → handoff).

---


## Page Mode

When the resolved mode is a URL or description (no journey), read `page-mode.md` in this
skill's directory for the full Page Mode procedure (warm-up → health check → first
impressions → use it → analyze → reimagine → report).

---

## Shared review contract

Definitions every mode reports against. Page mode reaches them through its own Steps 1, 2,
and 6; journey and discover mode cite them directly. They live here rather than in
`page-mode.md` so a journey or discover run never loads the page-mode procedure to get them.

### Vitals interpretation (Step 1)

<!-- playwright-cli: no equivalent found for agent-browser vitals — see issue Gotchas -->
**Vitals unavailability accepted (settled, #2671):** `playwright-cli` has no `vitals` command or equivalent — no built-in surface captures LCP/CLS/INP/TTFB/FCP (confirmed against the CLI's own published documentation during #2647's migration; `playwright-cli-reference.md`'s Operation vocabulary table). A hand-written `eval` script against `PerformanceObserver`/the `web-vitals` library was evaluated as a workaround and rejected: it needs per-target bespoke script maintenance and async-callback plumbing with no first-class support from this CLI, a reliability and maintenance cost judged not worth carrying for a text-only wrapper skill. Web Vitals capture was previously this skill's first-class Performance finding category; that category is now unavailable until Playwright CLI (or `browse`) ships a first-class metric-capture command — omit the Performance line from the Step 6 report header entirely. This is settled behavior, not a pending gap to close. The thresholds table below is retained as interpretation guidance for whenever a capture mechanism becomes available.

Read the vitals output captured during warm-up (or per-step in journey mode). Flag findings against these thresholds — they flow into the Step 6 findings table with **Source = Performance**:

| Metric | Threshold | Severity | What to flag |
|---|---|---|---|
| LCP (Largest Contentful Paint) | > 2.5s | Major | Slow primary content render — hero image, main heading, large text block |
| CLS (Cumulative Layout Shift) | > 0.1 | Major | Layout jumping during load — unsized images, late-injected banners, font swaps |
| INP (Interaction to Next Paint) | > 200ms | Major | Sluggish interaction response — heavy event handlers, blocking JS |
| TTFB (Time to First Byte) | > 800ms | Minor | Slow server response — backend or CDN issue |
| FCP (First Contentful Paint) | > 1.8s | Minor | Slow paint of any content — render-blocking resources |

Report values verbatim under a **Performance** heading in the report (e.g., `LCP 3.1s, CLS 0.04, INP 180ms, TTFB 410ms, FCP 1.4s`). Even values within thresholds are worth recording — they become the baseline for future reviews.


---

### Step 2: First Impressions

> **Review Brief:** Apply the reconnaissance-selected perspectives mapped to Step 2. Answer the Central Question from your gut reaction.

This is the most important step. Before any structured analysis, just *look* and *react*.

#### The 5-second test

Look at the screenshot for 5 seconds (no scrolling or extra clicking yet). Then answer:

- **What's the first thing your eye goes to?** Is that the right thing to notice first?
- **What's the overall feeling?** Cluttered? Clean? Sparse? Overwhelming? Inviting? Cold?
- **What's confusing?** Anything that makes you pause or wonder "what does this do?"
- **What's missing?** Not bugs — expectations. What did you expect to see that isn't there?
- **If you had to describe this page in one sentence to a friend, what would you say?**

Reference `eN` refs (paired with a short description, per the Element-reference convention above) when calling out specific elements (e.g., "e7 (secondary badge) dominates the visual weight even though it's a tertiary action").

#### Why this matters

Structured checklists catch known issue types. First impressions catch the things users *actually feel* — the vague sense that something's off, the moment of hesitation, the slight confusion. These reactions disappear once you start analyzing systematically, so capture them first.

> **Tone:** Be honest, not diplomatic. "This feels cluttered and I'm not sure where to look" is more useful than "layout could be improved." Write like you're texting a colleague, not filing a bug report.

---

---

### Step 6: Report & Route

Present findings from the review in a single structure that serves as both the report and the routing table.

#### Header

```markdown
## Visual Review: {page/feature description}

**URL:** {url}
**Session:** {session name}
**Classification:** {Type} | {Auth} | {Stage} | {Data} | {Complexity} | {Audience}
**Central Question:** {The central question from the Review Brief}
**Health:** {functional / N console errors / N failed requests / broken}
**Performance:** LCP {value} | CLS {value} | INP {value} | TTFB {value} | FCP {value}
**First Impression:** {The honest 5-second reaction in 1-2 sentences. Keep the raw tone.}
**Interaction Feel:** Speed: {snappy/acceptable/sluggish} | Feedback: {clear/inconsistent/missing} | Transitions: {smooth/janky/none}
**Screenshots:** {paths under .claude-tweaks/artifacts/screenshots/browse/<session>/}
**Trace (if failure):** {path under .claude-tweaks/artifacts/traces/<session>/ — omit if no failure}
**QA context:** {QA run dir, stories covering this page, QA status — or "No QA data"}
```

**Strengths** (before the findings table): When something is genuinely good, note it in one sentence: "Strengths: {1-2 specific things that work well and should be preserved}." Do not create a separate section — this anchors what to protect while fixing issues.

#### Findings & Ideas

Present all findings and ideas in a single batch table. Findings reference `eN` refs (paired with a short description) from the screenshots:

```
| # | Finding | Type | Source | Severity/Impact | Recommended |
|---|---------|------|--------|-----------------|-------------|
| 1 | {description with eN refs e.g. "e3 (primary CTA) competes with e5 (secondary link)"} | Issue | Health | Critical | Fix now |
| 2 | LCP 3.1s exceeds 2.5s threshold | Issue | Performance | Major | Fix now |
| 3 | CLS 0.18 — hero image lacks dimensions | Issue | Performance | Major | Fix now |
| 4 | {description} | Issue | Analyze | Minor | Fix now |
| 5 | {description} | Issue | Persona | Cosmetic | Fix now |
| 6 | {description} | Idea | Reimagine | High | Fix now — add to current spec |
| 7 | {description} | Idea | Reimagine | Medium | Defer — not relevant now |
| 8 | {description} | Idea | Reimagine | Low | Capture — needs brainstorming |
```

The table renders as markdown, as above. Immediately below it, call `AskUserQuestion` with:

- `question`: `"How do you want to handle these findings?"`, `header`: `"Findings"`, `multiSelect`: `false`
- Option 1 — `label`: `"Apply all (Recommended)"`, `description`: `"Apply all recommendations"`
- Option 2 — `label`: `"Override specific items"`, `description`: `"tell me which #s to change"`

**Hard gate.** Check the response you are about to send: does it already contain the Findings & Ideas table above as literal rendered markdown, with a row for every finding? If not, render it now, in this response, before the tool call — "Apply all" with no table above it leaves the user approving an unnamed set of UI findings.

**Evaluated against `_shared/visual-decision.md` — not adopted (#1208).** This step's decision is
an N-row findings triage (Apply all / Override specific items), not a single-target accept/reject
and not an N-variant comparison — the two shapes that contract's pick/reroll/steer/exit vocabulary
is built for. There is no "candidate" here to render as a compare-shell frame: findings are text
rows referencing `eN` refs already shown inline in this report, not rendered variants
competing for a pick. Unlike `/claude-tweaks:demo`'s Show step (which hands the browser to the
human directly, making a browser-hosted verdict control a natural fit — see that skill's Verdict
step), this report's findings are already fully rendered in the terminal conversation the human is
reading, so there is no separate browser tab already holding their attention to relocate the
verdict into. Wrapping this table in a one-candidate compare-shell round would relocate an
identical two-option question into the browser for no functional gain. This terminal
`AskUserQuestion` stays exactly as it is above.

The **Source** column traces each finding to its origin step (Health, Performance, First Impression, Persona, Analyze, Reimagine). This replaces the separate "Functional Issues," "Visual & Content Issues," and "UX Observations" report sections.

**Recommendation rules for Issues:**
- **All severities** — default "Fix now." Close the gap now.
- **Defer** (new work record — born-ready, or `parked` on a concrete wake condition) — the fix is understood but bigger and not relevant to the current work. Gated by `_shared/deferral-gate.md` (fix-now first; a valid `Defer-reason:` or the item stays open). Compose via `specShapedBody` exactly as review Step 3's Defer does (`review/step3-routing.md`), with `filedBy: 'visual review'`, `provenance: { origin: 'visual review', deferReason }` and footer `_Filed by \`visual review\` via specShapedBody._`, then create it via the unified record contract (`_shared/work-record.md`). Before creating the record, apply `_shared/materiality-floor.md`'s floor test: an item that fails to clear the materiality floor, with a non-`tangential` `Defer-reason:`, shows "Digest — below floor" in the Recommended column instead, and only writes the digest entry once the human approves that row (or an auto path applies it). This skill's own end-of-run summary states the digest comment URL and the count routed this run, per `_shared/materiality-floor.md`'s "Digest URL and count surfacing" section.
- **Capture** — the issue is complex or uncertain and needs brainstorming/exploration before it can be acted on. Invoke `/claude-tweaks:capture` with the shaped body and `--defer-reason={value} --source visual-review` (capture's Shaped-body branch — `capture/SKILL.md`), plus `--needs-definition` when it names an open choice. This branch is subject to `_shared/materiality-floor.md`'s floor test like any other filing branch: `Defer-reason: tangential` always clears the materiality floor per that contract's Overrides section, but a different reason applies the ordinary test before invoking capture, same as the Issues Defer bullet above.
- **"Accept as-is"** — only for intentional design choices. If it's a genuine defect, fix it or route it.

**Recommendation rules for Ideas:**
- **Fix now** — the strong default. If the idea can be implemented in the current session, do it. Add to the current spec scope if applicable.
- **Defer** (new work record, `parked`) — the idea is clear but bigger and not relevant to the current work. Same gate and composition as the Issues Defer above (`_shared/deferral-gate.md`; an idea is by nature `tangential` unless it blocks on something concrete — a concrete wake condition makes it `parked` with a `Trigger:` header). Since an Ideas-Defer item is `tangential` by default, `_shared/materiality-floor.md`'s override clears the materiality floor for the common case; only the less-common `parked`-with-Trigger path (a non-`tangential` reason) is ever eligible for "Digest — below floor" in the Recommended column, following the same before-render check as the Issues Defer bullet above.
- **Capture** — the idea is complex or uncertain and needs brainstorming/exploration before it can be acted on. Invoke `/claude-tweaks:capture` with the shaped body and `--defer-reason={value} --source visual-review` (capture's Shaped-body branch — `capture/SKILL.md`), plus `--needs-definition` when it names an open choice (an idea's usual reason is `tangential`, which always clears the materiality floor per `_shared/materiality-floor.md`'s Overrides section; a non-`tangential` Capture-routed idea, the rarer case, is still subject to the ordinary floor test before invoking capture, same as the Ideas Defer bullet above).

> **Routing bias:** Fix it now — always the recommended default. Defer when the fix is bigger and not relevant now. Capture when the issue/idea needs exploration. Cosmetic issues accumulate into a feeling of low quality — fix them while they're fresh.

Group related cosmetic issues into a single row rather than listing each individually. Every idea goes to a durable destination. "Note for later" without a destination means "lose forever."

#### Verdict

After the findings table:
- **CLEAN** — No significant issues. Ideas are enhancements, not fixes.
- **ISSUES FOUND** — {count} issues need attention.
- **BROKEN** — Page is non-functional. (Trace path attached above.)

#### Creative Opportunities (survey integration)

After the verdict, the parent `SKILL.md` Step 4 invokes `/claude-tweaks:design-wrapper survey` with the captured screenshot paths and renders a Creative Opportunities block from the wrapper's recommendations. The block is appended verbatim to this report — it lives below the verdict and above Next Actions.

The survey block is a separate concern from the findings table: the findings table catalogs issues and idea routing; the Creative Opportunities block surfaces ranked Impeccable command suggestions per the survey "would help" criteria → command mapping in `design-wrapper/command-map.md` (the single source of truth for that set). Recommendations are never auto-applied — the user runs any command manually if it resonates.

When the survey wrapper returns no recommendations or a skip (non-frontend, Impeccable not installed, integration disabled), omit the block entirely. Do not surface "no creative opportunities found" as a positive signal — survey is heuristic and an empty result means "nothing matched the criteria," not "design is complete."

See `SKILL.md` Step 4 for the exact template, return-shape handling, and the suppression-note convention when the wrapper reports `suppressed > 0`.

#### Next Actions

This mode-specific table supplements the canonical handoff in SKILL.md `## Next Actions` — "supplements" here means *substitutes when more specific*, not *merges line sets*. This section renders its own independent markdown block, resolved dynamically from the signal table below exactly as `design/SKILL.md`'s Return-shape table resolves — render it (with its own lines, including `/claude-tweaks:wrap-up {N}`, which is not one of SKILL.md's 4 static lines) when the review-source signals (full review mode, missing code review, "fix now" items, standalone) usefully refine the standalone block. It renders *instead of* SKILL.md's canonical Next Actions block, never alongside or merged with it. When in doubt, defer to SKILL.md `## Next Actions`.

The signal-to-option lookup table below stays as-is — the assistant's own logic for picking which options apply this run, never itself shown to the user:

| Signal | Option |
|--------|--------|
| Coming from full review mode | `/claude-tweaks:wrap-up {N}` — capture learnings and clean up |
| Not yet code-reviewed | `/claude-tweaks:review {N}` — run code review before wrapping up |
| "Fix now" items exist | Address fixes first, then re-run this review |
| Standalone | `/claude-tweaks:capture` — save ideas surfaced during the session |

Once the signals are resolved, render as plain markdown (docs/skill-authoring.md's Skill handoffs convention):

**`/claude-tweaks:wrap-up {N}`** — capture learnings and clean up (recommended) — when coming from full review mode
`/claude-tweaks:review {N}` — run code review before wrapping up — when not yet code-reviewed
Address fixes first, then re-run this review — when "fix now" items exist
`/claude-tweaks:capture` — save ideas surfaced during the session — standalone

---


## Important Notes

- This review requires `playwright-cli` — install with `npm install -g @playwright/cli` if missing
- Snapshots are ephemeral; screenshots and traces are persistent — findings reference screenshot/trace paths plus the `eN` ref captured at finding time (screenshots carry no overlay-number markers — see the Element-reference convention note above)
- <!-- playwright-cli: no equivalent found for agent-browser vitals — see issue Gotchas --> Web Vitals capture has no Playwright CLI equivalent (see "Vitals interpretation (Step 1)" above) — this was previously a first-class finding category; its unavailability is a settled decision (#2671), so omit Performance findings rather than fabricate or skip silently without noting the absence
- Always capture a screenshot per state — bare page states with no screenshot leave findings unverifiable
- <!-- playwright-cli: no equivalent found for agent-browser batch — see issue Gotchas --> Journey walks run as a sequence of individual commands against one session for the lifecycle slice (no `batch` equivalent) — never spread a journey across many separately-opened sessions
- When a step fails, stop the trace first (`tracing-stop` — recording must have been started at session open via `tracing-start`, then relocated from `.playwright-cli/traces/` to an absolute path per `playwright-cli-reference.md`'s caution), then `close` — failure reports without a trace path are not actionable
- The review is scoped to the current work — don't review the entire application (except in journey mode, where the full journey is in scope, and discover mode, which scans the whole app)
- Journey mode auto-detects when invoked with no arguments by checking `docs/journeys/` against recent changes
- Journey files are living documents — update them when visual review reveals gaps or inaccuracies
- Console errors and network failures are often the fastest signal — check them in the snapshot output during health check
- Resize testing is optional and should be skipped unless layout changes are in scope; use `resize` rather than env vars
- The step order matters: reconnaissance → reaction → experience → analysis → imagination. Don't rearrange.
- Reconnaissance (Step 0) is a fast pre-step — it classifies and moves on. The review steps are where depth happens. If reconnaissance takes more than 60 seconds, something is wrong.
