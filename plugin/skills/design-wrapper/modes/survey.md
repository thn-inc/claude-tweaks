# Design Mode — survey

Invoked via `/claude-tweaks:design-wrapper survey <files> [--screenshots <paths>] [--limit <n>]` (`--screenshots` when called from `/visual-review`; `--limit` overrides the default recommendation cap). Returns `{mode, result: "ok", context, recommendations, suppressed}` or `{mode, skipped, ...}` to caller.

## When this runs

Called by `/visual-review` (after browser review) and by `/flow` (in the pipeline summary). Survey produces ranked **Creative Opportunities** recommendations — read-only. It never invokes Impeccable commands; it only suggests them. Callers render the recommendations in their respective output blocks.

The full "would help" criteria table and command-recommendation mapping live in `../command-map.md` (Survey-mode section).

## Preconditions

Survey has a relaxed precondition set compared to dispatching modes:

- **Layer 1 (kill-switch)** applies — `disabled` returns skip.
- **Layer 2 (the record's `Surface:` body-metadata line, lifted into the materialized header — spec 20)** applies only when a spec is resolvable from the file list (caller may pass it explicitly).
- **Layer 3 (file-extension sniff)** applies.
- **Availability check** is **informational only** — survey does not require Impeccable's LLM commands or CLI. An unavailable Impeccable surfaces in the recommendations as "install Impeccable to apply."

## Procedure

### Step 1: Run preconditions (Layer 1 + Layer 3; Layer 2 conditional)

On any skip, return the skip object — the caller omits the Creative Opportunities block.

### Step 2: Resolve invocation context

The caller signals which surface produced the call:

- **From `/visual-review`** — caller passes `--screenshots <paths>` plus the file list. Survey analyzes each screenshot for opportunities matching creative-command "would help" criteria. Per-screenshot analysis is an LLM-grade observation, not a heuristic.
- **From `/flow` pipeline summary** — caller passes the full diff file list (no screenshots). Survey applies heuristic per-file checks (e.g., file with motion-related imports but zero `transition`/`animate` references → animate could help; page component with no error/empty-state JSX → delight could help).
- **From a user invocation directly** — same as the `/flow` path (heuristic, no screenshots) unless `--screenshots` is provided.

When no file list is passed (and no `--screenshots`), the file list defaults to `git diff --name-only`; if that command itself fails, return `{skipped: "unable to resolve target files (git diff failed)"}` immediately — see `../SKILL.md`'s Input section for this shared fallback-failure rule.

### Step 3: Apply the "would help" criteria

Produce raw observations. Each observation maps to one creative command per the criteria table in `../command-map.md` (Survey-mode section). Summary of mapped commands: `bolder`, `quieter`, `distill`, `delight`, `animate`, `colorize`, `onboard`, `extract`, `overdrive`.

### Step 4: Suppress declined recommendations

Read the per-spec declined-recommendations cache from `docs/plans/YYYY-MM-DD-{feature}-declined.json` (path resolution mirrors the audit cache from `review` mode — see Step 3 of polish mode).

Cache shape:

```json
{
  "spec": "<spec id or path>",
  "declined": [
    { "command": "/impeccable:impeccable bolder", "page": "/pricing", "decline_count": 2, "first_surfaced": "<ISO>", "last_surfaced": "<ISO>" }
  ]
}
```

Suppress any observation whose `(command, page)` pair has `decline_count >= 2`. This mode never increments `decline_count` itself — see "Ownership" below for who does and when.

### Step 5: Rank the surviving observations

Rank by signal strength:

- Per-screenshot LLM-graded observations rank above heuristic ones.
- Among heuristics, file-pattern matches with multiple supporting signals (e.g., motion-imports AND zero transitions) rank above single-signal matches.

Cap output at 5 recommendations to avoid noise, or at `--limit <n>` when the caller passes it (e.g. `--limit 1` for a quick-glance summary during `/flow`'s pipeline summary, or a higher `--limit` for a deliberately thorough standalone pass via `/visual-review`'s Boost gate). An omitted or invalid (non-positive, non-integer) `--limit` falls back to the default of 5.

### Step 6: Write the recommendations cache

Write at `docs/plans/YYYY-MM-DD-{feature}-recommendations.json` (mirrors the audit cache co-location — keeps survey state out of `~/.claude-tweaks/` per CLAUDE.md).

Shape:

```json
{
  "spec": "<spec id or path>",
  "written_at": "<ISO timestamp>",
  "recommendations": [
    { "command": "/impeccable:impeccable bolder", "page": "/pricing", "rationale": "..." }
  ]
}
```

The next `/flow` run on the same spec compares the new diff against this cache to detect declines (a recommended command was not invoked → its expected file changes do not appear in the new diff → increment `decline_count` in the declined cache).

**Ownership:** the decline-detection algorithm lives in `/flow` (see `flow/survey.md` "Decline detection"). `/flow` is the only writer of `docs/plans/...-declined.json`. This wrapper is a read-only consumer — it reads the declined cache and uses it to filter observations in Step 4, and surfaces `suppressed` as an integer count back to the caller. It never writes the declined cache itself, even when invoked directly by a user.

## Output to caller

```json
{
  "mode": "survey",
  "result": "ok",
  "context": "visual-review" | "flow-summary" | "manual",
  "recommendations": [
    { "page": "/pricing", "observation": "Hero feels generic — pure black on white", "command": "/impeccable:impeccable bolder pricing", "rationale": "..." }
  ],
  "suppressed": <int>
}
```

`suppressed` is the count of observations dropped due to the declined cache — surfaced informationally so callers can mention "N suggestions hidden (previously declined)" if useful. When `recommendations` is empty, the caller omits the Creative Opportunities block entirely.

**Return to caller:** this output is consumed by the calling skill — control returns to the caller, whose next step runs in this same turn; never end the turn on this render.
