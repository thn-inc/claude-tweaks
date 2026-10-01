---
files:
  - plugin/bin/lib/code-health/candidates-prelaunch.js
  - plugin/bin/lib/code-health/focus-generators.js
  - plugin/bin/lib/code-health/criteria.js
  - plugin/skills/_shared/criteria-prelaunch.md
  - plugin/skills/code-health/focus-mode.md
---

# Run a Pre-launch Check

**Persona:** A developer who built a marketing site or small web app with an AI agent and is about to point a real domain at it. They know the code runs; they don't know what an experienced launcher would notice is missing.
**Goal:** Get one report that says, item by item, which launch basics the site has, which it lacks, and which need a human look — without the report pretending it checked what it could not.
**Entry point:** Typing `/claude-tweaks:code-health focus=prelaunch` in a session at the site's repo root.
**Success state:** A 17-row checklist table — 9 automated rows marked pass or fail, 8 manual rows marked for a human — plus a filed record for each real gap the judge confirmed.

## Steps

### 1. Kick off the check
- **URL:** N/A (slash command)
- **Action:** The developer types `/claude-tweaks:code-health focus=prelaunch`. `focus-mode.md` resolves `prelaunch` from the generator registry and pins the `prelaunch` criterion and `criteria-prelaunch.md`.
- **Should feel:** Like asking a launch-experienced colleague for a once-over.
- **Should understand:** This is a presence check over the repo's files, not a render of the live site.
- **Red flags:** `focus=prelaunch` is rejected as an unknown focus, or the run falls back to the generalist directory sweep.

### 2. Read the checklist
- **URL:** N/A
- **Action:** The generator (`candidates-prelaunch.js`) finds the site's pages, checks the site-level files (sitemap, robots, favicon, custom 404, OG image), each page's title and description (its own or an ancestor layout's), `<img>` alt attributes, and image weight. The summary renders every checklist row as `| Item | Group | Status | Evidence |`.
- **Should feel:** Complete. Every item the developer has heard of is on the table, including the ones no tool can check.
- **Should understand:** A `pass` means "the file or tag is present", never "it is good" — a `sitemap.xml` with no URLs still passes. A `manual` row is not a pass; it is a to-do for a person.
- **Red flags:** The table shows only failures, so everything else reads as verified. Or a manual row such as the privacy policy shows `pass`.

### 3. See real gaps filed, and non-sites left alone
- **URL:** N/A
- **Action:** The judge confirms or rejects each candidate against `criteria-prelaunch.md`'s severity calibration, and confirmed gaps are filed exactly like any other code-health finding. On a repo with no web pages — only a library, or only HTML test fixtures and templates — the run reports `focus=prelaunch: not applicable — no web pages detected` and stops.
- **Should feel:** Proportionate. A missing 404 page is high severity; a missing favicon is low.
- **Should understand:** Files under test, fixture, example, and build-output directories never count as the site, so a fixture's `robots.txt` or a 2 MB test image changes nothing.
- **Red flags:** A non-website repo gets the five site-level "missing" issues (sitemap, robots, favicon, custom 404, OG image) filed against it.

## Origin
- Created during build of #2693 (pre-launch checklist lens for AI/vibe-coded sites), 2026-09-30
- Related: #2624 (sibling `focus=security-hardening` vertical this one mirrors)
