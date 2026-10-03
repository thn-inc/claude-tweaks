# Visual-Plan Evaluate-Then-Prototype Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolve GitHub issue #2689 — judge whether `/visualize`'s existing diagram-suggestion capability already covers the value of a "visual plan" feature, prototype a visual-plan artifact for one in-flight record (this one), and record the standing-step-vs-opt-in decision the Acceptance Criteria require.

**Architecture:** No new skill or hook. Task 1 hand-authors one themed HTML+SVG diagram (per `plugin/skills/_shared/visual-html-output.md`'s baseline core-fragment/wrapper pattern — `/claude-tweaks:visualize`'s own Step 4 baseline path) depicting this record's own evaluate → prototype → decide flow, saved under `docs/plans/`. Task 2 writes an ADR at `docs/decisions/0021-visual-plan-stays-opt-in-via-visualize.md` recording the evaluation finding and the decision.

**Tech Stack:** Plain HTML + inline SVG + scoped `<style>` (no build step, no JS framework) — matches every other `/claude-tweaks:visualize` output.

**Spec:** `.claude-tweaks/pipelines/2026-10-03T173920-record-2689/work/2689-spec.md` (GitHub issue #2689)

## Global Constraints

- No new standing skill, no new hook wired into `/specify` or `/writing-plans` — the evaluation (see Task 2) found the described capability substantially pre-exists via `/specify` Step 2.5d + `/claude-tweaks:visualize`; building a parallel mechanism would violate the spec's own Gotchas.
- Diagram must follow `plugin/skills/_shared/visual-html-output.md`'s token/theming/scoping rules: tokens from this repo's `DESIGN.md`, a unique per-diagram class-name slug, light/dark `:root` blocks.
- This is an evaluation record (surface: infra, size: low) — no application code changes, no tests in the `node --test` sense; verification is "does the file exist and render/parse as valid HTML/SVG."

## Review Focus

- A reviewer opening the diagram HTML file directly (no server) must see it render — no relative asset references that 404 under `file://`.
- The ADR's "Decision" section must state the AC #2 answer explicitly (stays opt-in via `/visualize`), not just describe the evaluation.
- The diagram's SVG must bind colors through `var(--token-name)`, never a hardcoded hex, matching the project's own anti-pattern table in `visualize/SKILL.md`.
- The ADR must cite the concrete evidence files (`plugin/skills/visualize/SKILL.md`, `plugin/skills/specify/decomposition-mode.md` Step 2.5d) by path, not just describe them in prose, so a future reader can re-verify the claim.
- Neither new file should silently exceed any governed-corpus size ceiling — N/A here (both are new files outside `plugin/skills/**`, so no ceiling applies), stated explicitly so no task skips a real check believing this line requires one.

---

### Task 1: Generate the visual-plan diagram artifact

**Files:**
- Create: `docs/plans/2689-visual-plan-flowchart.html`

**Interfaces:**
- Consumes: color tokens from this repo's `DESIGN.md` frontmatter (`graphite-ink`, `graphite-ink-muted`, `graphite-surface`, `graphite-surface-muted`, `graphite-border`, `signal-amber`, `signal-amber-deep` — read directly, no tooling needed for 7 static values).
- Produces: a standalone `.html` file Task 2's ADR cites by path as the prototype artifact.

- [ ] **Step 1: Author the core SVG fragment**

Write a flowchart-shaped core fragment (4 boxes + 3 arrows) depicting this record's own evaluate → prototype → decide flow: `Evaluate /visualize + /specify coverage` → `Prototype: diagram for #2689's own plan` → `Record ADR decision` → `Stays opt-in via /visualize`. Every class is prefixed `vz-2689-` (the per-diagram slug, per `visual-html-output.md` Step 3's scoping rule). Colors bind via `var(--token-name)`, never a literal hex, per that file's Step 3.

```html
<svg class="vz-2689-root" viewBox="0 0 880 220" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Evaluate, prototype, decide flow for issue 2689">
  <style>
    .vz-2689-root { font-family: var(--font-body-family); }
    .vz-2689-box { fill: var(--graphite-surface-muted); stroke: var(--graphite-border); stroke-width: 1.5; rx: 8; }
    .vz-2689-box--decision { fill: var(--signal-amber); stroke: var(--signal-amber-deep); }
    .vz-2689-label { fill: var(--graphite-ink); font-size: 13px; font-weight: 500; }
    .vz-2689-label--decision { fill: var(--graphite-surface); }
    .vz-2689-arrow { stroke: var(--graphite-ink-muted); stroke-width: 2; marker-end: url(#vz-2689-arrowhead); fill: none; }
  </style>
  <defs>
    <marker id="vz-2689-arrowhead" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--graphite-ink-muted)" />
    </marker>
  </defs>

  <rect class="vz-2689-box" x="10" y="70" width="190" height="80" />
  <text class="vz-2689-label" x="105" y="104" text-anchor="middle">Evaluate</text>
  <text class="vz-2689-label" x="105" y="124" text-anchor="middle">/visualize + /specify</text>
  <text class="vz-2689-label" x="105" y="140" text-anchor="middle">coverage</text>

  <line class="vz-2689-arrow" x1="200" y1="110" x2="235" y2="110" />

  <rect class="vz-2689-box" x="240" y="70" width="190" height="80" />
  <text class="vz-2689-label" x="335" y="104" text-anchor="middle">Prototype: diagram</text>
  <text class="vz-2689-label" x="335" y="124" text-anchor="middle">for #2689's own</text>
  <text class="vz-2689-label" x="335" y="140" text-anchor="middle">plan (this file)</text>

  <line class="vz-2689-arrow" x1="430" y1="110" x2="465" y2="110" />

  <rect class="vz-2689-box" x="470" y="70" width="190" height="80" />
  <text class="vz-2689-label" x="565" y="104" text-anchor="middle">Record ADR</text>
  <text class="vz-2689-label" x="565" y="124" text-anchor="middle">0021 — decision +</text>
  <text class="vz-2689-label" x="565" y="140" text-anchor="middle">rationale</text>

  <line class="vz-2689-arrow" x1="660" y1="110" x2="695" y2="110" />

  <rect class="vz-2689-box vz-2689-box--decision" x="700" y="70" width="170" height="80" />
  <text class="vz-2689-label vz-2689-label--decision" x="785" y="104" text-anchor="middle">Stays opt-in</text>
  <text class="vz-2689-label vz-2689-label--decision" x="785" y="124" text-anchor="middle">via /visualize</text>
  <text class="vz-2689-label vz-2689-label--decision" x="785" y="140" text-anchor="middle">(not standing)</text>
</svg>
```

- [ ] **Step 2: Wrap in a standalone HTML document with tokens, per `visual-html-output.md` Steps 1-5**

Write `docs/plans/2689-visual-plan-flowchart.html`. `DESIGN.md`'s colors have no light/dark-family naming pattern (Step 2's rule 2 of that file), so the same values are used in both the base `:root` and the `:root[data-theme="dark"]`/`@media (prefers-color-scheme: dark)` blocks — a safe default per that rule. Includes the unconditional MDX-handshake script (Step 5) before `</body>`.

```html
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Issue 2689 — Evaluate, Prototype, Decide</title>
<style>
  :root {
    --graphite-ink: #1c1f24;
    --graphite-ink-muted: #5b6472;
    --graphite-surface: #f7f7f5;
    --graphite-surface-muted: #ececea;
    --graphite-border: #dcdcda;
    --signal-amber: #b8720f;
    --signal-amber-deep: #8f5a0c;
    --font-body-family: "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
  }
  :root[data-theme="dark"] {
    --graphite-ink: #1c1f24;
    --graphite-ink-muted: #5b6472;
    --graphite-surface: #f7f7f5;
    --graphite-surface-muted: #ececea;
    --graphite-border: #dcdcda;
    --signal-amber: #b8720f;
    --signal-amber-deep: #8f5a0c;
  }
  @media (prefers-color-scheme: dark) {
    :root:not([data-theme="light"]) {
      --graphite-ink: #1c1f24;
      --graphite-ink-muted: #5b6472;
      --graphite-surface: #f7f7f5;
      --graphite-surface-muted: #ececea;
      --graphite-border: #dcdcda;
      --signal-amber: #b8720f;
      --signal-amber-deep: #8f5a0c;
    }
  }
  body { background: var(--graphite-surface); margin: 0; padding: 24px; }
</style>
</head>
<body>
<!-- core fragment from Step 1 goes here, verbatim -->
<script>
(function () {
  if (window.parent === window) return;
  function reportHeightNow() {
    window.parent.postMessage(
      { type: 'height', height: document.documentElement.scrollHeight },
      window.location.origin
    );
  }
  window.addEventListener('message', function (event) {
    if (event.origin !== window.location.origin) return;
    var data = event.data;
    if (data && data.type === 'theme' && (data.theme === 'dark' || data.theme === 'light')) {
      document.documentElement.dataset.theme = data.theme;
      reportHeightNow();
    }
  });
  var heightReportPending = false;
  new ResizeObserver(function () {
    if (heightReportPending) return;
    heightReportPending = true;
    requestAnimationFrame(function () {
      heightReportPending = false;
      reportHeightNow();
    });
  }).observe(document.body);
})();
</script>
</body>
</html>
```

- [ ] **Step 3: Verify the file is well-formed**

Run: `node -e "const fs=require('fs'); const s=fs.readFileSync('docs/plans/2689-visual-plan-flowchart.html','utf8'); const svgEnd=s.indexOf('</svg>'); const svgPart=s.slice(s.indexOf('<svg'), svgEnd); const hexCount=(s.match(/#[0-9a-fA-F]{6}/g)||[]).length; if(!s.includes('<svg') || !s.includes('var(--graphite-ink)') || hexCount !== 21 || /#[0-9a-fA-F]{6}/.test(svgPart)) throw new Error('check failed: hexCount='+hexCount); console.log('ok, bytes:', s.length)"`
Expected: `ok, bytes: {n}` — exactly 21 hex literals total (7 `DESIGN.md` tokens × 3 `:root`/`@media` blocks), and zero hex literals inside the `<svg>...</svg>` span itself (it must bind every color through `var(--token-name)`, per Step 1).

- [ ] **Step 4: Commit**

```bash
git add docs/plans/2689-visual-plan-flowchart.html
git commit -m "Prototype a visual-plan diagram artifact for #2689

refs #2689"
```

---

### Task 2: Record the evaluation decision as an ADR

**Files:**
- Create: `docs/decisions/0021-visual-plan-stays-opt-in-via-visualize.md`

**Interfaces:**
- Consumes: Task 1's artifact path (`docs/plans/2689-visual-plan-flowchart.html`) as cited evidence of the prototype.
- Produces: nothing consumed by a later task — this is the plan's terminal deliverable.

- [ ] **Step 1: Write the ADR**

Follow this repo's existing ADR shape (`docs/decisions/0015-*.md` as the reference template: `# {n}. {title}`, a metadata block, `## Context`, `## Decision`, `## Alternatives considered`, `## Consequences`).

```markdown
# 0021. Visual-plan diagramming stays opt-in via `/visualize`, not a standing `/specify` step

- **Status:** accepted
- **Date:** 2026-10-03
- **Context:** #2689 (evaluate-then-prototype record)

## Context

#2689 asked whether claude-tweaks should grow a "/visual-plan"-style skill — generating a rich,
visual implementation plan alongside the text spec, inspired by a similar feature described for
other coding agents. Before building anything new, the record's own Gotchas required checking
whether this was already substantially solved.

It is. Two existing pieces already cover the described value:

- `plugin/skills/visualize/SKILL.md` already generates themed, self-contained HTML+SVG diagrams
  (architecture, flowchart, sequence, state, ER, tree, and seven other types) from this project's
  own `DESIGN.md` tokens, and is already invoked as a soft-hook by `/journeys`, `/specify`, and
  `/review` — not only standalone.
- `plugin/skills/specify/decomposition-mode.md`'s Step 2.5d ("Diagram Suggestion") already folds
  diagram suggestions into `/specify`'s own output, for every surface (backend and infra
  included, not just frontend): it scans the design doc and decomposed record titles against a
  structural-signal table (state machines, ER schemas, multi-actor sequences, branching
  flowcharts, multi-component architectures, parent-child taxonomies), emits up to two
  recommendations with a ready-to-run `/claude-tweaks:visualize {type} {spec-slug} --source
  specify` command, and places them under a `### Diagram suggestions` block in the Step 9
  summary. It already respects this repo's own `diagram-suggestions: enabled` CLAUDE.md flag, and
  is purely advisory — it never blocks decomposition and never auto-invokes `/visualize`.

The one real gap found: Step 2.5d's hook fires during `/specify`'s *design-doc decomposition*
path, not for a single record's *implementation plan* written by `/superpowers:writing-plans`.
There is no existing hook suggesting a diagram for an individual record's execution plan — the
narrower claim #2689's Deliverables actually named ("folding visual-plan-style diagramming into
`/specify` **or** `/writing-plans` output").

**Prototype.** As the record's own Technical Approach specified, one in-flight record was used as
the prototype subject — #2689 itself, since it was already being specified and built. Its text
spec (`.claude-tweaks/pipelines/2026-10-03T173920-record-2689/work/2689-spec.md`) and its
implementation plan (`docs/superpowers/plans/2026-10-03-visual-plan-evaluate-prototype.md`) were
both produced through the existing pipeline unchanged. A companion visual-plan artifact was then
hand-authored for the same record's plan, following `/visualize`'s own baseline-path construct
(`plugin/skills/_shared/visual-html-output.md`'s core-fragment/wrapper pattern) rather than a new
mechanism: `docs/plans/2689-visual-plan-flowchart.html` — a four-box flowchart of this record's
own evaluate → prototype → decide flow, themed from this repo's `DESIGN.md` tokens.

## Decision

**Visual-plan diagramming stays opt-in via `/claude-tweaks:visualize`. It does not become a
standing, always-run step in `/specify` or `/superpowers:writing-plans`.**

The existing design is already correct for the common case: `/specify`'s Step 2.5d only suggests
a diagram when a structural signal actually matches (3+ components, a named state machine, a
multi-table schema, and so on), and it caps itself at two suggestions per design doc. A mandatory
step would instead run — and cost a model turn plus file write — on every plan regardless of
whether a diagram adds any value, which contradicts the structural-signal gating the existing
hook already uses. The prototype in this record confirms the manual path is cheap and fast when a
diagram is actually warranted (one hand-authored SVG fragment, reusing an existing themed
wrapper), so there is no efficiency case for forcing it into every build.

This record did **not** extend Step 2.5d (or add an equivalent step) to `/superpowers:writing-plans`
for single-record implementation plans, despite that being the one real gap found above. The gap
is real, but closing it is a separate, narrower follow-up (a small addition to an existing hook's
trigger surface), not a reason to build a new "/visual-plan" skill — filed as a backlog idea
rather than folded into this record's scope, per the record's own instruction to keep the
prototype scoped to one record.

## Alternatives considered

- **Build a new `/visual-plan` skill wrapping both the text spec and a diagram in one unified
  output.** Rejected: duplicates `/visualize` + Step 2.5d's existing structural-signal detection
  and themed rendering, with no described capability the two together don't already provide.
- **Promote Step 2.5d (or a clone of it) to a mandatory step in `/writing-plans`, always emitting
  a diagram for every plan.** Rejected: fires regardless of whether a diagram would help,
  inverting the existing advisory, signal-gated design for no demonstrated review-speed gain.
- **Extend Step 2.5d's trigger surface to also cover `/writing-plans`-authored single-record
  plans, closing the one real gap.** Not rejected — plausible future work — but out of scope for
  this record; captured as a follow-up idea rather than built here, consistent with keeping this
  record's prototype scoped to one record.

## Consequences

No code or skill behavior changes as a result of this record. `/claude-tweaks:visualize` and
`/specify`'s Step 2.5d continue exactly as before. The prototype artifact
(`docs/plans/2689-visual-plan-flowchart.html`) demonstrates the opt-in path is usable today for
any record's plan, by hand, without new tooling.

Revisit if a future record demonstrates review speed or clarity actually suffers from the
opt-in boundary found here — at which point extending Step 2.5d's trigger surface to
`/writing-plans`-authored plans (the one real gap this record identified) is the narrower
follow-up to pursue first, before a new standing skill.
```

- [ ] **Step 2: Verify required sections are present**

Run: `node -e "const fs=require('fs'); const s=fs.readFileSync('docs/decisions/0021-visual-plan-stays-opt-in-via-visualize.md','utf8'); ['## Context','## Decision','## Alternatives considered','## Consequences','docs/plans/2689-visual-plan-flowchart.html','stays opt-in'].forEach(k => { if(!s.includes(k)) throw new Error('missing: '+k) }); console.log('ok')"`
Expected: `ok`

- [ ] **Step 3: Commit**

```bash
git add docs/decisions/0021-visual-plan-stays-opt-in-via-visualize.md
git commit -m "Record ADR-0021 — visual-plan diagramming stays opt-in via /visualize

refs #2689"
```
