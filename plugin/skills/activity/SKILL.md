---
name: activity
description: Use for a period-scoped "what shipped" markdown report — merged PRs, closed issues, commits, issues raised, reviews given, in flight — narrated for a retro, standup, or manager with citation-validated refs. Keywords - activity report, what did I ship, last week, retro, standup, accomplishments.
argument-hint: "[--period <1d|7d|14d|month|quarter|<from>..<to>>] [--register <manager|standup|retro>] [--repo <owner/name>[,...]]"
---

# Activity — Period-scoped "what shipped" report

Answers "what did I ship over the last N days?" for a human reader: a markdown report over merged PRs, closed issues, commits, issues raised, reviews given, and what is still in flight, aggregated over a period and narrated in a chosen register. Utility skill — no fixed lifecycle position:

```
gather (gh → facts.json)  →  narrate (this skill → narratives.json)  →  render (facts ⨯ narratives → report.md)
        deterministic                 judgment                         deterministic, citation-validated
```

Gathering and rendering are two separate programs, and the skill writes narration *between* them. The renderer never trusts the narrative; it trusts `facts.json`, which only `gh` wrote, and drops every citation it cannot find there — with a warning. A hallucinated issue number is structurally unpublishable.

## When to Use

- A retro, a standup, a 1:1, or release notes need prose over a period — not the state-now dashboard `/claude-tweaks:help` renders, and not one run's summary from `/claude-tweaks:flow`.
- "What did I do last week / this month / this quarter?"
- You want a paste-ready markdown summary of your GitHub activity for one or more repos.

Not for: reporting how the harness itself performed (`/claude-tweaks:feedback`'s session judge owns that), HTML output, cross-organization aggregation, or anything on a host other than the one `gh` is authenticated to by default.

## Input

`$ARGUMENTS` is parsed as `[--period <1d|7d|14d|month|quarter|<from>..<to>>] [--register <manager|standup|retro>] [--repo <owner/name>[,...]]`:

| Argument | Default | Behavior |
|---|---|---|
| `--period` | `7d` | Presets are rolling day counts ending today (`1d`=1, `7d`=7, `14d`=14, `month`=30, `quarter`=90 — never calendar-aligned); `<from>..<to>` (`YYYY-MM-DD..YYYY-MM-DD`) is inclusive of both days. Any other form stops with the gather CLI's own message naming the accepted forms. |
| `--register` | `retro` | Changes tone and detail, never facts: `retro` is terse and technical for the person who did the work; `standup` names mechanisms for teammates who know the codebase, refs on everything; `manager` is plain business language with no commit-speak. |
| `--repo` | the `origin` remote | One or more `owner/name` slugs, comma-joined, all on `gh`'s default host; a host-qualified name stops with exit 1. |

## Step 1: Gather the facts

Resolve this run's session-scoped temp paths (`_shared/session-tmp-root.md`), then run the gather CLI — the only place `gh` is called:

```bash
eval "$(node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" ACTIVITY_FACTS=activity-facts.json ACTIVITY_NARRATIVES=activity-narratives.json ACTIVITY_REPORT=activity-report.md)"
```

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/activity-gather.js" --period {period} --out "$ACTIVITY_FACTS"
```

Add `--repo {owner/name}[,...]` when `--repo` was given. Branch on the exit code: `0` → read `$ACTIVITY_FACTS`; its `failures[]` is non-empty on a partial gather — carry on, the renderer prints them as a **Partial gather** section. `1` → relay the CLI's message (an unrecognized period, a host-qualified repo) and stop. `2` → `gh` is absent or unauthenticated, or no repo resolved: relay the CLI's stderr verbatim and stop — there is no MCP fallback for this skill. `3` → every query failed: relay the first error and stop.

Read the facts file in full before narrating. Note the three standing caveats the file's producer documents (search-index lag; `reviews_given` is an updated-in-window proxy that also drops your own PRs; commits are matched by linked GitHub login) — the renderer restates them in the report footer, so you never have to.

## Step 2: Narrate

Write `$ACTIVITY_NARRATIVES` with the Write tool (never `echo` — zsh mangles `\n`), in this shape:

```json
{
  "schemaVersion": 1,
  "register": "retro",
  "sections": [
    { "heading": "Shipped", "items": [{ "text": "…", "refs": ["owner/name#123", "owner/name@abc1234"] }] },
    { "heading": "Reviewed", "items": [] },
    { "heading": "In flight", "items": [] }
  ]
}
```

Narration rules:

- **never invent PRs, issues, numbers, dates, or people** — every claim traces to a row in `$ACTIVITY_FACTS`, and every item carries `refs` naming the rows it rests on (`{owner/name}#{N}` for a PR or issue, `{owner/name}@{sha7+}` for a commit). A ref the renderer cannot find in the facts is dropped from the report with a warning you relay; it is not a typo to fix by hand — re-read the facts and re-cite.
- The register changes tone and detail, never facts. `manager` prose names outcomes, not commits; `standup` and `retro` name mechanisms and cite every item.
- Group by the three headings above; drop a heading's items to `[]` when the period has nothing for it. Never pad an empty period — the renderer produces the honest one-line empty report on its own.
- Refs live in `refs[]` only. A `#123` typed inside `text` is prose to the renderer and stays unlinked and unvalidated.

## Step 3: Render — mandatory

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/activity-render.js" --facts "$ACTIVITY_FACTS" --narratives "$ACTIVITY_NARRATIVES" --out "$ACTIVITY_REPORT"
```

The report shown to the user is always the renderer's output, never the skill's own prose — read `$ACTIVITY_REPORT` back and show it verbatim. Relay every `warning:` line the CLI printed on stderr, verbatim, above the report; each names a citation that was dropped (absent from the facts) or ambiguous (a commit prefix matching more than one sha). Exit `2` means the narratives file failed schema validation (the path is named on stderr) — fix the narratives file and re-run this step; exit `1` is a malformed invocation to correct.

## Step 4: Save location

After showing the report, call `AskUserQuestion` once — `question`: `"Where should this report go?"`, `header`: `"Save report"`, `multiSelect`: `false`:

- Option 1 — `label`: `"Archive path (Recommended)"`, `description`: `"Write to docs/reports/activity-{from}-{to}.md (creates docs/reports/ if absent)"`
- Option 2 — `label`: `"Current directory"`, `description`: `"Write to ./activity-{from}-{to}.md"`
- Option 3 — `label`: `"Don't save"`, `description`: `"Keep it in this conversation only — nothing written"`

An explicit path comes through `Other`. `{from}`/`{to}` are the facts file's `period.from`/`period.to`. Copy `$ACTIVITY_REPORT` to the chosen path with the Write tool. Nothing is written into the repository without this choice, nothing is ever committed on the user's behalf, and nothing lands under the disposable `.claude-tweaks/` artifact tree — a report the user asked to keep must live where `/claude-tweaks:tidy` will not prune it. This question runs even inside a pipeline: the report is user-facing output, not a decision `auto` mode may silence.

**Edits.** "Make it shorter", "switch to manager register", "drop the reviews section" re-run Step 2 and Step 3 only, against the same `$ACTIVITY_FACTS`. A different period or repo set is a new run from Step 1 — never an edit.

## Next Actions

Render as plain markdown (docs/skill-authoring.md's Skill handoffs convention):

**`/claude-tweaks:activity --period {period} --register {other register}`** — the same period in another register (recommended when the user asked for a second audience)
`/claude-tweaks:activity --period 14d` — widen the window
`/claude-tweaks:help` — full pipeline status

## Component-Skill Contract

`/claude-tweaks:activity` is a **standalone-only** skill — no lifecycle skill invokes it. There is no `PIPELINE_RUN_DIR` signal to check; the `## Next Actions` block always renders, and Step 4's save-location question always runs.

## Anti-Patterns

| Pattern | Why It Fails |
|---------|-------------|
| Showing your own prose instead of the renderer's output | Only the renderer validated the citations — prose that skipped it can carry a number nothing backs |
| "Fixing" a dropped-citation warning by retyping the number | The warning means the facts do not contain it; re-read the facts and cite a row that exists, or drop the claim |
| Switching to whole-repo `--state all` list scans to catch a just-merged PR the search index has not indexed yet | Blows the 200-row cap on a busy repo; the footer already states the lag |
| Writing the report under the disposable `.claude-tweaks/` artifact tree, or committing it | That tree is disposable by declaration, and nothing is committed on the user's behalf in any mode |
