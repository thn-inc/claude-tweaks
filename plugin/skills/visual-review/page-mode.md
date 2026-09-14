# Page Mode — Visual Review Procedure

The standard creative review flow for a single page or feature (a URL or description, no
journey). Loaded from `browser-review.md`'s Page Mode dispatch.

Requires the shared procedures in `browser-review.md` (prerequisites, mode resolution, QA
data loading, Step 0 reconnaissance) and its **Shared review contract** — this file's Steps
1, 2, and 6 reach into that contract rather than restating it.

Open the session, navigate to the URL, take a snapshot and an annotated screenshot, capture vitals — then proceed through the structured steps. A typical page-mode warm-up:

```
agent-browser --session <session> open <url>
agent-browser --session <session> trace start
agent-browser --session <session> snapshot -i -c
agent-browser --session <session> screenshot --annotate .claude-tweaks/artifacts/screenshots/browse/<session>/01_landing.png
agent-browser --session <session> vitals
```

Or as a single batch:

```
agent-browser batch --session <session> \
  "open <url>" \
  "trace start" \
  "snapshot -i -c" \
  "screenshot --annotate .claude-tweaks/artifacts/screenshots/browse/<session>/01_landing.png" \
  "vitals"
```

(`trace start` begins Chrome DevTools trace recording — tracing is record-then-stop, so a later failure can only be saved if recording started here.)

**Dispatcher column mapping (page-review use):** When assembling agent output into the Step 6 Report & Route table, map the agent's `| Severity | Path:Line | Finding | Evidence |` columns as follows: Severity = severity/impact (`critical` for broken page or failed health check, `high`/`medium` for major UX or perf issues, `low` for cosmetic, `info` for ideas), Path:Line = the page URL + overlay ref (`/pricing#[3]`, `/checkout#[7]`), Finding = the issue or idea (`Primary CTA at [3] competes visually with [5]` / `LCP 3.1s exceeds 2.5s threshold`), Evidence = the screenshot path + raw measurement (`.claude-tweaks/artifacts/screenshots/browse/pricing-review/02_above-fold.png; LCP 3.1s; persona: distracted mobile`). The dispatcher merges all agents' tables into the Step 6 Report & Route table, filling Source from the lens that produced each finding (Health / Performance / First Impression / Persona / Analyze / Reimagine).

> **Parallel execution (conditional):** When the review covers 3+ independent pages (different URLs with no shared state or navigation dependency), dispatch page reviews as parallel Task agents. Each agent owns its own session, runs its own batch, and returns findings in the `| Severity | Path:Line | Finding | Evidence |` format (see the output template below). The dispatcher maps these rows into the Step 6 Report & Route table using the column mapping documented immediately above. When pages share state (form submission on page A affects page B) or there are fewer than 3 pages, review sequentially.
>
> **Contract:** Each agent follows `_shared/subagent-output-contract.md` — minimal input, status line first, output template inlined verbatim below. Dispatch shape: single-assistant-message rule (`_shared/subagent-dispatch-core.md`'s fan-out section) applies.
>
> **Model profile:** [Use: Standard] — per-page review agents run Steps 1-5 (health, first impressions, persona walk, structured analysis, reimagine) which require integration across snapshot, screenshot, vitals, and source context. Upgrade to Capable only when the page's "reimagine" pass is the primary deliverable and creative synthesis dominates the work. Resolve via `node "${CLAUDE_PLUGIN_ROOT}/bin/resolve-profile.js" standard` (contract § Model Selection).
>
> **Output template (each agent must follow exactly):**
>
> ```markdown
> OUTPUT FORMAT (required):
> Return ONLY a markdown table, no preamble:
>
> | Severity | Path:Line | Finding | Evidence |
> |---|---|---|---|
> | critical | /checkout#[7] | Submit button is disabled on valid input | .claude-tweaks/artifacts/screenshots/browse/checkout-review/03_form.png; INP 240ms; persona: returning user |
> | medium | /pricing#[3] | Hero feels generic — pure black on white, no brand voice | .claude-tweaks/artifacts/screenshots/browse/pricing-review/01_landing.png |
> | low | /dashboard#[12] | Tertiary CTA dominates visual weight over primary | .claude-tweaks/artifacts/screenshots/browse/dashboard-review/02_above-fold.png |
>
> Severity scale: critical / high / medium / low / info
> If no findings: return literal text "No findings."
> Return at most 15 rows, highest severity first; if more were found, append a final row reading "+N more" with the count in place of N — never omit this row when findings exceed the cap.
> Do not add narration, headers, or summaries before or after the table.
> ```
>
> Each agent's first reply line must be one of `DONE / DONE_WITH_CONCERNS / NEEDS_CONTEXT / BLOCKED`, then the table.

---


## Step 1: Health Check

> **Review Brief:** Consult the Step Enrichment Map for reconnaissance-added health signals.

Verify the page is functional before investing in a deeper review.

**Gate:** Page must be functional to proceed. If broken, capture a trace (see "Trace on failure" in Journey Mode), close the session, and report.

> When `QA_DATA_AVAILABLE = true`, use the QA-accelerated path — see `qa-accelerated.md` in this skill's directory.

### Full inspection (when QA not available):

#### Capture (already done in warm-up):
- Snapshot (accessibility tree) for interaction context
- Annotated screenshot for visual reference
- Vitals (LCP, CLS, INP, TTFB, FCP)
- Page title, visible state, immediate errors

#### Check for obvious problems:
- Console errors visible in the snapshot output
- Failed network requests visible in the snapshot output
- Blank or broken page rendering (visible in screenshot)
- Missing assets (images, fonts, styles)

If the page is broken or blank, save the trace via `trace stop .claude-tweaks/artifacts/traces/<session>/<timestamp>.zip`, then `close`, then report immediately — no point continuing a visual review on a non-functional page.


For vitals thresholds and how to report them, apply **Vitals interpretation (Step 1)** in
`browser-review.md`'s Shared review contract.

---

## Step 2: First Impressions

Apply **First Impressions (Step 2)** in `browser-review.md`'s Shared review contract — the
5-second test, its questions, and its tone rule. It is shared because discover mode applies
the same test per discovered page.

---

## Step 3: Use It

> **Review Brief:** If reconnaissance selected personas based on page classification (e.g., Mobile Readiness selected Distracted Mobile User), prioritize those personas.

Now interact with the page — but not as a QA tester checking boxes. Use it as a *person trying to accomplish something*.

> When `QA_DATA_AVAILABLE = true`, use the QA-accelerated path — see `qa-accelerated.md` in this skill's directory.

### Full persona rotation (when QA not available):

Experience the page from at least two of these perspectives. Pick the most relevant ones:

| Persona | What they care about | What they notice |
|---------|---------------------|-----------------|
| **First-time visitor** | "What is this? What should I do?" | Missing onboarding, unclear CTAs, jargon |
| **Impatient power user** | "Let me do the thing fast" | Unnecessary steps, slow feedback, no keyboard shortcuts |
| **Distracted mobile user** | "I have 10 seconds and one thumb" | Touch targets, information density, scroll depth |
| **Error-prone user** | "I'll get this wrong" | Recovery paths, error messages, undo capability |
| **Returning user** | "Where was that thing I used before?" | Navigation consistency, state persistence, discoverability |

For each persona, actually walk through the flow. Don't just imagine it — click, type, navigate using the session's interactive ops. Note what each persona would struggle with. After each material interaction, take a fresh annotated screenshot so the report can reference the new state with overlay numbers.

### Interaction feel

Beyond "does it work," notice *how it feels*:

- **Speed** — Does the app feel snappy or sluggish? Cross-check against the captured INP metric — values > 200ms confirm a "sluggish" gut reaction.
- **Feedback** — When you click something, do you know it registered? Loading states, button state changes, progress indicators?
- **Transitions** — Are there animations? Are they smooth or janky? Too slow? Too fast? Distracting?
- **Flow** — Does one step lead naturally to the next, or do you have to figure out where to go?
- **Recovery** — You made a mistake. Now what? Is there undo? Back? Cancel? Or are you stuck?

### What to test (full inspection only)

- Exercise the primary flow (happy path)
- Try at least one edge case from each persona's perspective (empty input, very long text, rapid clicks, back button)
- Check what happens when things go wrong — error states, empty states, loading states. Capture an annotated screenshot of each notable state.
- Watch the snapshot for JavaScript errors triggered by interactions

---


## Step 4: Analyze

> **Review Brief:** Focus the structured analysis on perspectives mapped to Step 4. Source analysis signals (component count, spacing patterns, auth conditionals) provide code-grounded anchors for visual observations.

Now shift to structured inspection. This is the analytical pass — systematic where Steps 2-3 were intuitive.

> When `QA_DATA_AVAILABLE = true`, use the QA-accelerated path — see `qa-accelerated.md` in this skill's directory.

### Full structured analysis (when QA not available):

#### Layout & Visual Structure
- Is the page layout coherent and balanced?
- Are elements aligned properly?
- Is spacing consistent (margins, padding, gaps)?
- Does content hierarchy make sense (headings, sections, groupings)?
- Is the visual weight distributed intentionally (or does it feel lopsided)?

Reference annotated overlay numbers when calling out specific elements.

#### Content & Microcopy
- **Labels and headings** — Are they descriptive or generic? Would a new user understand them?
- **Button text** — Do buttons say what they'll do? ("Save changes" vs "Submit", "Delete account" vs "Delete")
- **Error messages** — Do they explain what went wrong AND how to fix it?
- **Empty states** — When there's no data, is there helpful guidance? Or just blank space?
- **Placeholder text** — Helpful examples or useless "Enter text here"?
- **Tone** — Is the voice consistent? Does it match the brand? Does it feel human?

#### Visual Polish
- Are interactive elements obviously clickable (buttons look like buttons)?
- Do hover/focus states exist and feel right?
- Are images/icons displaying at correct size and resolution?
- Is the color scheme consistent?
- Are fonts loading correctly?

#### Responsive Behavior (if applicable)
Set viewport to common breakpoints and re-capture an annotated screenshot at each:

```
agent-browser --session <session> set viewport 375 667    # Mobile
agent-browser --session <session> screenshot --annotate .claude-tweaks/artifacts/screenshots/browse/<session>/<NN>_mobile.png
agent-browser --session <session> set viewport 768 1024   # Tablet
agent-browser --session <session> screenshot --annotate .claude-tweaks/artifacts/screenshots/browse/<session>/<NN>_tablet.png
agent-browser --session <session> set viewport 1280 800   # Desktop
agent-browser --session <session> screenshot --annotate .claude-tweaks/artifacts/screenshots/browse/<session>/<NN>_desktop.png
```

Check for overflow, cramped layouts, or hidden content at each size. Only test responsive if the project is expected to support it — ask if unsure.

#### Performance
- Reference vitals captured in Step 1.
- LCP > 2.5s, CLS > 0.1, INP > 200ms → flag as Major performance findings.
- TTFB > 800ms, FCP > 1.8s → flag as Minor.

#### Accessibility (quick check)
- Can you tab through interactive elements in a logical order?
- Are form inputs labeled (check the snapshot)?
- Is there sufficient color contrast?
- Do images have alt text?

> **Note:** This is a quick pass, not a WCAG compliance review. Flag obvious issues only.

---


## Step 5: Reimagine

> **Review Brief:** Perspectives mapped to Step 5 are the primary reimagine targets. The Central Question frames what "great" means for this specific page.

This is the creative step. Analysis found what's wrong. Now ask: **what would make this great?**

### The "best version" exercise

For the page or feature you reviewed, brainstorm what a truly excellent version would look like. Not just "fix the bugs" — think about what would make a user *prefer* this over alternatives.

Consider:

- **What would make someone smile using this?** Small delights — a clever interaction, a helpful shortcut, a moment of "oh that's nice." Not gratuitous animation, but genuine thoughtfulness.
- **What would a 10x simpler version look like?** If you had to cut half the UI, what would stay? That's probably what matters most — is it prominent enough?
- **What's the invisible friction?** Things users tolerate but shouldn't have to. Extra clicks, unnecessary fields, information in the wrong place, having to remember something the app should remember.
- **What would the next version add?** Not a feature wishlist — what's the one thing that would make the biggest difference to the user experience?

### "Steal like an artist"

Think about well-known products that solve similar problems. What do they do well that this could learn from? Be specific — not "be more like Notion" but "Notion's empty state has a template picker that makes blank pages feel like opportunities, not dead ends."

### Propose alternatives

For the most important finding from the reimagine exercise, sketch out 1-2 concrete alternatives:

```
Current: {what it is now} (annotated overlay [N])
Alternative A: {a different approach} — {why it might be better}
Alternative B: {another approach} — {the tradeoff}
```

These aren't prescriptions — they're conversation starters. The goal is to expand the solution space, not narrow it.

> **Constraint:** Keep this grounded. Ideas should be implementable in the current tech stack within a reasonable scope. "Rewrite in a different framework" is not helpful. "Add a skeleton loader to the list view" is.

### QA-informed reimagining (when QA_DATA_AVAILABLE)

QA findings, caveats, and the captured vitals can spark ideas that pure visual inspection might miss:

- **Accessibility caveats** reveal where the experience is broken for some users. "Missing aria-label on 3 elements" isn't just a compliance issue — it's a design opportunity. What would the experience feel like if every interaction was narrated?
- **Slow LCP or FCP** suggests a perception problem. The "best version" exercise should consider: what would users see during the wait? A skeleton loader? An instant optimistic update? A progress bar with real information?
- **High CLS** signals a stability problem. What would the page feel like if it never jumped during load?
- **Console warnings** often indicate technical shortcuts that degrade experience over time. These are signals of where the implementation diverges from the ideal.
- **Page inventories** reveal structural opportunities. A page with 8 tabs and 20+ buttons may benefit from progressive disclosure. A form with 6 fields and no labels is a redesign candidate, not just an accessibility fix.

Use QA data and vitals as creative fuel for the "best version" exercise, not as a bug list. The reimagine step asks "what would make this great?" — those signals tell you where "great" is furthest from the current state.

---


## Step 6: Report & Route

Apply **Report & Route (Step 6)** in `browser-review.md`'s Shared review contract — the
report header, the findings-and-ideas table, recommendation rules, verdict, Creative
Opportunities block, and the mode-specific Next Actions resolution. It is shared because
journey mode reports against the same structure with journey sections added.
