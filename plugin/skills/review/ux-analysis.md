# UX Analysis Procedure

Invoked by `/claude-tweaks:review` lens 3h when QA data is available. Consumes qa-agent outputs (screenshots, page inventories, caveats) and produces actionable UX findings for the code review batch table.

## Inputs

Collect inputs from the most recent QA run:

1. **Report:** Read `report.json` from the latest QA run directory (or the run specified in pipeline context). Extract:
   - `caveats` array — observations from PASS_WITH_CAVEATS stories
   - `stories` array — status, screenshot directories, step counts
   - `page_inventories` array — structured page data from each unique URL visited (from individual story REPORT_JSON entries)
2. **Screenshots:** List screenshot files across all story subdirectories in the QA run directory
3. **Page inventories:** Collect all `page_inventories` entries from story-level REPORT_JSON data. Each entry contains element counts, form structure, navigation patterns, accessibility attributes, and layout measurements.

If no report.json exists, no caveats exist, and no screenshots exist, skip the UX analysis entirely — there is no QA data to analyze.

## Per-Page Analysis

For each unique page in the collected page inventories, analyze the following dimensions. Use the inventory counts and caveats as primary input — do not re-browse pages or perform additional queries.

> **Parallel execution:** Use parallel tool calls aggressively — all Read operations for report.json, screenshot directories, and story reports are independent and should run concurrently. Front-load all reads before analysis.

### Navigation

- **Breadcrumbs:** If `navigation.breadcrumbs` is `false` and the page is not a top-level page (inferred from URL depth), flag: "No breadcrumbs on nested page — users may lose orientation."
- **Tab count:** If `navigation.tabs` > 5, flag: "Page has {N} tabs — consider adding tab search/filter for discoverability."
- **Nav elements:** If `navigation.nav_elements` is 0, flag: "No navigation elements detected — check if the page has an escape path (back button, home link)."

### Forms

- **Labels:** If `accessibility.missing_labels` > 0 and `forms.count` > 0, flag: "Form has {N} unlabeled input(s) — add visible labels or aria-label attributes."
- **Required field markers:** Check caveats for observations about form fields. If a form has more than 3 fields (`fields_per_form` entry > 3) and no required markers are mentioned in the snapshot context, note: "Form with {N} fields — verify required fields are visually marked."
- **Submit button states:** If the page has forms and buttons, note for review: "Verify submit buttons show disabled/loading states during submission."
- **Inline validation:** For forms with more than 5 fields, note: "Large form ({N} fields) — inline validation recommended to reduce submission errors."

### Accessibility

- **ARIA landmarks:** If `accessibility.aria_landmarks` is 0, flag: "No ARIA landmarks detected — add landmark roles (main, nav, banner) for screen reader navigation."
- **Heading hierarchy:** If `accessibility.heading_levels` skips levels (e.g., has h1 and h3 but no h2), flag: "Heading hierarchy skips level(s) — expected sequential heading levels for screen reader structure."
- **Missing labels:** If `accessibility.missing_labels` > 0, flag: "Missing accessible labels on {N} interactive element(s) — buttons, links, and inputs need descriptive labels."
- **Contrast observations:** Check caveats for any contrast-related observations and include them.

### Consistency

When page inventories from multiple pages are available, compare patterns across pages:

- **Button counts:** If one page has significantly more buttons than others (3x+), flag the discrepancy for review.
- **Navigation patterns:** If some pages have breadcrumbs and others do not, flag: "Inconsistent breadcrumb usage — present on {pages} but missing on {pages}."
- **Form patterns:** If forms across pages have different field counts or structures, note for consistency review.

### Responsive

- **Viewport overflow:** If `layout.viewport_overflow` is `true`, flag: "Horizontal overflow detected — content extends beyond viewport width."
- **Scroll height:** If `layout.scroll_height` is unusually large (>3000px), note: "Very tall page ({N}px) — consider if content can be paginated or collapsed."
- **Touch targets:** If the page has many small interactive elements (high `interactive_elements` counts with low spacing), note: "Dense interactive elements — verify touch target sizes meet minimum 44x44px."

## Screenshot Review

> **Parallel execution (conditional):** When more than 5 screenshots exist across the QA run, dispatch a screenshot review Task agent that reads the screenshots using the Read tool (multimodal) and returns visual observations. When 5 or fewer, review screenshots inline in the main thread.
>
> **Model profile:** [Use: Capable] — judgment-heavy visual/UX synthesis across screenshots, matching lens 3h's profile in `skills/review/code-mode-steps.md`. Resolve via `node "${CLAUDE_PLUGIN_ROOT}/bin/resolve-profile.js" capable` (contract § Model Selection).
>
> **Output template (inline this into the Task() prompt verbatim):**
>
> ```markdown
> OUTPUT FORMAT (required):
> Per observation:
> - [Severity] {path/screenshot.png} — {observation} — Evidence: {what you saw}
>   Suggested fix: {one line}
>
> Severity scale: critical / high / medium / low / info — but the UX lens ceiling is `high`, so use only high / medium / low / info here
> If no observations: return literal text "No observations."
> Do not add narration or grouping headers.
> Status line (required): the last non-empty line of your reply must read exactly `STATUS: DONE` (or DONE_WITH_CONCERNS / NEEDS_CONTEXT / BLOCKED).
> ```

For each screenshot (or the subset reviewed by the Task agent), observe:

- **Visual consistency:** Do pages share a consistent visual language (colors, typography, spacing)?
- **Visual hierarchy:** Is the most important content visually prominent? Are CTAs clearly distinguishable?
- **Spacing and alignment:** Are elements evenly spaced? Any misalignment or cramped areas?
- **Empty states:** If any screenshot shows an empty or minimal state, is there guidance or does it feel blank?

The screenshot review produces observations, not a separate report. Observations feed into the findings table below.

## Output Format

Produce findings in the standard format for Step 3 Routing integration. Each finding includes a concrete, implementable recommendation — not generic advice.

```
| # | Finding | Severity | Category | Affected | Recommended |
|---|---------|----------|----------|----------|-------------|
| 1 | Settings page has 7 tabs but no search/filter | Medium | UX | /settings | Add tab search for 5+ tabs |
| 2 | Missing ARIA landmarks on dashboard | Medium | UX | /dashboard | Add main, nav, banner landmark roles |
| 3 | Form on /profile has 6 unlabeled inputs | High | UX | /profile | Add visible labels or aria-label to all inputs |
| 4 | Inconsistent breadcrumbs — present on /settings but missing on /profile | Low | UX | /settings, /profile | Add breadcrumbs to all nested pages |
| 5 | Horizontal overflow on /reports at current viewport | Medium | UX | /reports | Fix layout to prevent horizontal scroll |
```

**Severity guidelines for UX findings:**
- **High** — accessibility barriers (missing labels on forms, no keyboard navigation), broken layouts (overflow, overlapping elements)
- **Medium** — usability gaps (too many tabs without search, missing breadcrumbs on deep pages, large forms without validation)
- **Low** — consistency observations (cross-page pattern mismatches), minor polish (spacing, visual hierarchy)

UX findings are routed through the same fix/defer/capture mechanism as code review findings in Step 3 Routing. They appear in the batch table with category "UX" alongside findings from lenses 3a-3f.
