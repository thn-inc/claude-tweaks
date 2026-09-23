---
files:
  - plugin/skills/activity/SKILL.md
  - plugin/bin/activity-gather.js
  - plugin/bin/lib/activity/gather.js
  - plugin/bin/activity-render.js
  - plugin/bin/lib/activity/render.js
  - plugin/bin/session-tmp-resolve.js
  - plugin/bin/lib/repo-resolve.js
---

# Produce a "What Shipped" Report for a Period

**Persona:** A maintainer of a `gh`-authenticated GitHub repository — the person who did the work — preparing for a Monday standup, a sprint retro, or a 1:1 with their manager, who wants a paste-ready markdown summary of what they shipped over the last week and refuses to hand-assemble it from `git log` and the PR list.
**Goal:** One markdown report over the period's merged PRs, closed issues, commits, issues raised, reviews given, and in-flight PRs, narrated in the register the reader needs (`retro`, `standup`, or `manager`), in which every citation is a real PR, issue, or commit the CLI actually gathered.
**Entry point:** `/claude-tweaks:activity` (defaults: `--period 7d --register retro`, repo from the `origin` remote), or `/claude-tweaks:activity --period month --register manager --repo owner/name`.
**Success state:** The rendered report opens `# Activity — {from} to {to} ({register})`, every bullet's citations are markdown links to the gathered facts, every warning the renderer printed was relayed verbatim, the footer states the counts and the three standing caveats (search-index lag, `reviews_given` proxy, commit identity) plus any row-cap truncation, and the report is saved where the maintainer chose — by default `docs/reports/activity-{from}-{to}.md` — with nothing committed on their behalf.

## Steps

### 1. Gather the facts — `bin/activity-gather.js`
- **URL:** `node "${CLAUDE_PLUGIN_ROOT}/bin/activity-gather.js" --period 7d --out "$ACTIVITY_FACTS"` (paths resolved by `bin/session-tmp-resolve.js`; `--repo owner/name[,...]` and `--actor login` when given)
- **Action:** The skill runs the gather CLI, the only place `gh` is called. The CLI resolves the actor via `gh api user`, the repo from `origin` via `bin/lib/repo-resolve.js`, canonicalizes every slug via `gh repo view --json nameWithOwner` (a renamed or transferred repo would otherwise search under its stale name and return nothing), then runs six queries per repo — each independently fail-safe — and writes `facts.json` with `schemaVersion: 1`.
- **Should feel:** Mechanical and complete — a partial gather still exits 0 and names the failed query in `failures[]` rather than aborting; a redirect is a one-line stderr note, not a surprise empty report.
- **Should understand:** Exit 1 is a malformed invocation (an unrecognized period form, a host-qualified `--repo`, a mis-shaped `--actor`), exit 2 is `gh` absent or unauthenticated or an unresolvable repository, exit 3 means every query failed; each stops the skill with the CLI's own message. A `truncated[]` entry means a query hit its `--limit` row cap and the period holds more than the count shows.
- **Red flags:** A report that silently shows zero merged PRs on a busy repo (the stale-origin symptom the canonicalization step exists to prevent); a `reviews_given` count treated as a review tally rather than the updated-in-window proxy it is.

### 2. Narrate between the facts and the renderer — `plugin/skills/activity/SKILL.md` Step 2
- **URL:** `$ACTIVITY_NARRATIVES` (written with the Write tool as `{"schemaVersion": 1, "register": "retro", "sections": [{"heading": "Shipped", "items": [{"text": "…", "refs": ["owner/name#123", "owner/name@abc1234"]}]}, …]}`)
- **Action:** The skill reads `facts.json` in full and writes the narrative under the `Shipped` / `Reviewed` / `In flight` headings in the chosen register, every item carrying `refs[]` naming the facts it rests on — and **never invents PRs, issues, numbers, dates, or people**.
- **Should feel:** Like a colleague who read the PR list, not a template — the register changes tone and detail, never facts; an empty period is left empty rather than padded.
- **Should understand:** A ref is one whitespace-free token (`owner/name#N` or `owner/name@sha7+`); a `#123` typed inside `text` is prose to the renderer and stays unlinked. Newlines inside an item's text are collapsed to a single space.
- **Red flags:** A ref that does not come from `facts.json`; a `manager`-register report that reads like a commit log.

### 3. Render with citation validation — `bin/activity-render.js`
- **URL:** `node "${CLAUDE_PLUGIN_ROOT}/bin/activity-render.js" --facts "$ACTIVITY_FACTS" --narratives "$ACTIVITY_NARRATIVES" --out "$ACTIVITY_REPORT"`
- **Action:** The renderer validates both files' `schemaVersion`, resolves every ref against the citable set derived from the facts (issue/PR numbers by exact match, commits by unique sha prefix), renders each surviving ref as a link to the fact's own URL, and prints one `warning:` line per citation it could not honor: `dropped citation` (well-formed, absent from the facts), `ambiguous citation` (a commit prefix matching several shas), or `unparseable citation` (wrong shape). The skill shows the renderer's output verbatim, warnings first.
- **Should feel:** Trustworthy — a hallucinated citation is structurally unpublishable, and the reader sees exactly which claims lost their backing rather than a silently cleaned report.
- **Should understand:** Exit 2 names the failing schema path (`facts.*` → re-run Step 1; `narratives.*` → fix the narratives file and re-render). Free text, headings, and gather failure messages are neutralized before insertion, so no channel other than `refs[]` can render a link. A fully failed gather never renders as "No activity found" — the `## Partial gather` section lists the failures instead.
- **Red flags:** The skill presenting its own prose instead of the rendered file; a warning "fixed" by retyping the number rather than re-reading the facts; a `## Partial gather` section missing from a report whose facts carry failures.

### 4. Choose where the report lives — `plugin/skills/activity/SKILL.md` Step 4
- **URL:** One `AskUserQuestion` — `Archive path (Recommended)` (`docs/reports/activity-{from}-{to}.md`, creating `docs/reports/` if absent), `Current directory` (`./activity-{from}-{to}.md`), `Don't save`, or an explicit path via `Other`
- **Action:** The maintainer picks a destination; the skill copies the rendered file there with the Write tool, or keeps it in the conversation only.
- **Should feel:** In control — nothing lands in the repository without this answer, and nothing is ever committed on the maintainer's behalf. Edits ("shorter", "switch to manager register") re-run only Steps 2-3 against the same facts; a different period or repo set is a fresh run.
- **Should understand:** The report never lands under the disposable `.claude-tweaks/` artifact tree, so a kept report survives `/claude-tweaks:tidy`; this question runs even inside a pipeline because the report is user-facing output, not a silenceable decision.
- **Red flags:** A report written into `.claude-tweaks/artifacts/`; a `git commit` made by the skill; the question skipped under `auto` mode.

## Origin
- Created during build of #2757 (`/claude-tweaks:activity` — period-scoped "what shipped" report with citation-validated rendering)
- Steps 1-4 built in this session
- Related specs: none — standalone utility skill; `/claude-tweaks:help` lists it, `/claude-tweaks:feedback`'s session judge remains the owner of harness-performance reporting
