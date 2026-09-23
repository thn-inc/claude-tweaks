# Visual Review — QA-Accelerated Paths

Lazy-loaded by `page-mode.md` (and by `journey-mode.md` for its per-step checks) when `QA_DATA_AVAILABLE = true`. Contains the abbreviated variants of Steps 1, 3, and 4 that consume QA data instead of re-running mechanical inspection.

When `QA_DATA_AVAILABLE = false`, ignore this file and run the full-inspection paths inline in `page-mode.md`.

Steps 2 (First Impressions) and 5 (Reimagine) always run at full depth — Step 2 captures raw reactions that must be QA-free, and Step 5 is judgment-based. Step 6 (Report & Route) is unchanged. Step 5 does have a QA-informed addendum, which remains inline in `page-mode.md` under "QA-informed reimagining."

---

## Step 1 — QA-accelerated path

QA health data becomes the baseline. The visual check verifies no **new** issues since the QA run:

1. The session's snapshot and screenshot are already captured (page mode warm-up); vitals are unavailable from this session (Vitals unavailability accepted, `browser-review.md`'s Shared review contract).
2. Check console errors and network failures from the snapshot — compare against `QA_FINDINGS` with category `code-bug` or `flaky-env`. Report only **new** errors not present in QA data.
3. Summarize in one sentence: "Health: {matches QA baseline | N new issues since QA run}"

Skip the full "Check for obvious problems" checklist — QA already ran it.

Vitals interpretation (thresholds, severity, Performance heading in the report) still applies whenever a vitals source is available (e.g. QA data) — see "Vitals interpretation (Step 1)" in `browser-review.md`'s Shared review contract.

---

## Step 3 — QA-accelerated path

QA stories already executed happy paths as specific personas. Instead of rotating through 2+ personas from scratch:

1. **Check QA coverage:** Review `QA_STORIES` to identify which persona-like behaviors QA already tested (form submissions, navigation flows, error states from failure stories).
2. **Skip covered personas:** If QA executed a checkout flow successfully, the "first-time visitor" and "returning user" personas for that flow are partially covered. Do not re-walk what QA validated.
3. **Focus on uncovered perspectives:** Pick the ONE persona QA is least likely to have covered. Typically: **Distracted mobile user** (QA runs at desktop viewport) or **Impatient power user** (QA follows scripted steps, not shortcuts). Walk the page from that single persona.
4. **Interaction feel:** Still assess speed (cross-reference INP from vitals when a vitals source is available), feedback, transitions, flow, and recovery — these require human judgment that QA cannot provide.

Skip the full persona rotation and "What to test" sections — the single-persona + interaction-feel pass is sufficient when QA covered the happy paths.

---

## Step 4 — QA-accelerated path

QA page inventories already captured mechanical measurements. Skip the following checks that QA confirmed:
- Element counts and form field counts (from `QA_PAGE_INVENTORIES`)
- Missing ARIA labels count (from `accessibility.missing_labels`)
- ARIA landmarks presence (from `accessibility.aria_landmarks`)
- Heading hierarchy (from `accessibility.heading_levels`)
- Viewport overflow (from `layout.viewport_overflow`)
- Tab counts and breadcrumb presence (from `navigation`)

**Focus only on visual qualities QA cannot assess:**
- **Visual weight and balance** — is the layout coherent? Does content hierarchy make visual sense? Reference `eN` refs (paired with a short description, per `browser-review.md`'s Element-reference convention).
- **Spacing and alignment feel** — not pixel counts, but whether spacing *feels* right
- **Content and microcopy quality** — are labels descriptive? Do error messages explain AND guide? Is the tone human?
- **Visual polish** — do hover/focus states feel right? Are interactive elements obviously clickable? Are fonts/icons crisp?
- **Responsive feel** (if applicable) — resize the viewport to mobile and re-capture: `playwright-cli -s=<session> resize 375 667` then a fresh screenshot at an absolute `--filename=` path. Check feel, not measurements QA already captured.
- **Performance feel** — when a vitals source is available (e.g. QA data; not this session's own capture — see the Vitals unavailability note), cross-reference Web Vitals. Does the LCP/CLS/INP match the lived experience?

Note QA-confirmed issues briefly (e.g., "QA confirmed 3 missing ARIA labels") without re-analyzing them. Any QA issue that feels worse visually than its data suggests gets elevated.

> **Deduplication (full mode):** When running as part of a full review (code + visual), the UX Analysis lens (3h) has already produced systematic findings from QA data in the code review step. In the Analyze step, focus on what the live browser reveals that data analysis cannot: visual weight, interaction feel, animation quality, emotional tone. Reference UX Analysis findings where they confirm visual observations, but do not re-list them as new findings.
