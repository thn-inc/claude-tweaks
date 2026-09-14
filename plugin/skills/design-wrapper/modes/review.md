# Design Mode — review

Invoked via `/claude-tweaks:design-wrapper review <spec>`. Returns `{mode, result: "advisory", files_scanned, findings, score_trend}` or `{mode, skipped, ...}` to caller. Also writes an audit cache that `polish` mode consumes, appends to a persistent design-score history log, and — when the built artifact carries one — records the Impeccable direction contract's seed key onto the work record (Step 3.6) and dispatches upstream's own finishing-review agent against that contract (Step 3.7).

## When this runs

Called by `/claude-tweaks:review` during code review. Runs `/impeccable:impeccable critique` + `/impeccable:impeccable audit` on changed UI files, and — when the built artifact carries a direction contract — additionally dispatches Impeccable's own `impeccable-finish-reviewer` agent (Step 3.7). Findings appear in the review summary as advisory (never auto-applied).

## Preconditions

Run the universal preconditions from `../SKILL.md` (Layers 1+2+3 and availability for the Impeccable plugin — verified by `/impeccable:impeccable*` skill resolution).

That check covers the **Skill-tool commands only**. Step 3.7 dispatches an *agent* (a `subagent_type`),
a different invocation surface with its own availability check: a resolvable `/impeccable:impeccable*`
proves the plugin is installed and says nothing about which agents that plugin ships.

## Procedure

### Step 1: Run preconditions

On any skip, return the skip object.

### Step 2: Resolve changed UI files

If `<spec>` was passed and the spec lists scoped files, intersect with `git diff --name-only`. Otherwise use the full diff filtered to frontend extensions/paths (Layer 3 rules).

If zero files remain after filtering, return `{skipped: "no UI files changed"}`. If `git diff --name-only` itself fails (non-git directory, git error, mid-rebase state), return `{skipped: "unable to resolve target files (git diff failed)"}` immediately — see `../SKILL.md`'s Input section for this shared fallback-failure rule.

### Step 3: Invoke Impeccable LLM commands

> **Parallel execution:** Use parallel tool calls aggressively — `critique` and `audit` run on the identical file list with no data dependency between them (Step 4 merges both outputs afterward), so dispatch both Skill-tool calls concurrently rather than sequentially.

Invoke via the Skill tool:

- `/impeccable:impeccable critique <files>` — qualitative critique
- `/impeccable:impeccable audit <files>` — heuristic audit pass

### Step 3.5: Read Impeccable's own cached critique (Layer 0, when signals resolved)

When Layer 0 resolved (see `../impeccable-plugin.md`) and `critique.latest` is non-null, carry it into the return as `prior_critique` — Impeccable's own most recent cached critique of this project, with its score and P0/P1 counts, free (the signals call already read it; no command runs).

It is **advisory context only**:

- It never replaces the live `critique` run in Step 3. A cached score describes whatever was critiqued last, which is not necessarily the diff under review — that is exactly why Step 3 still runs.
- It never changes `result`, which stays `advisory` regardless.
- It is **not** merged into `score_trend`. That series is this wrapper's own, written by Step 4.5 from parsed report totals on a known `/40` and `/20` scale; `critique.latest.score` comes from Impeccable's `.impeccable/critique/` frontmatter, a different producer whose scale this contract does not pin. Folding one into the other would manufacture a delta between two numbers that were never on the same axis.

When Layer 0 did not resolve, or resolved with `critique.latest: null`, omit `prior_critique` from the return entirely — the same convention Step 4.5 uses for an unparseable score. Both cases mean "no cached critique to report," and neither is an error.

### Step 3.6: Read the direction contract and record its seed key

The one point where a built artifact and its work record are both in hand — Impeccable's direction
contract (and its seed key, the only thing making a non-deterministic build reproducible) is read
here and recorded onto the record as `Design-seed:`. Read `review-seed-capture.md` in this
directory and follow it in full: the locate-and-parse procedure over Step 2's resolved file list,
the three outcomes (No contract / Malformed / Contract found), the record-resolution and
`Design-seed:` write rules, and the never-gate posture. Step 3.7's gate reads this step's parse
outcome — **Contract found** is the only outcome that reaches it.

### Step 3.7: Dispatch upstream's finishing review (only when a contract was found)

Impeccable ships a reviewer for exactly this question — does the render keep the promises the
direction contract made? Upstream spawns it at the end of its own build; this step spawns it again at
**code-review** time, over the diff under review, which is a different moment and a different file
set. It is the one place this repo asks anything to *judge* a direction contract:
`../../_shared/design-contract.md` is deliberately structural and judges nothing.

**Gate.** Run this step **only** when Step 3.6's parse returned **Contract found**. No-contract and
Malformed both skip it silently — no dispatch, no finding, no extra log line (Malformed already wrote
its `SCANNED` entry in Step 3.6). That parse is the detection signal; this step never re-derives it
and never applies a looser test of its own.

**Availability, at the agent level.** The Preconditions check resolves *skill* commands and does not
answer this. Resolve the plugin with `resolveImpeccablePlugin({searchRoot})`
(`../impeccable-plugin.md`), then check that `{root}/agents/impeccable-finish-reviewer.md` exists —
the same derive-your-own-path-from-`root` pattern `doctor` mode uses for its script. Agents are added
and removed between versions of one plugin (`impeccable-documenter` exists at 4.0.4 and not at the
pinned 4.0.2), so plugin presence proves nothing about this agent.

If the resolver returns `null` or the agent file is absent, **skip and continue**: the critique + audit
path from Step 3 stands on its own and the review proceeds normally. This is never a hard failure. Log
one `SCANNED` entry naming the missing agent — "a contract existed and nothing could review the render
against it" is a different state from "no contract," and only the log tells them apart.

**Dispatch.** One `Task()` call, `subagent_type: impeccable-finish-reviewer`. Do **not** pass
`isolation: "worktree"` — this mode routinely runs inside a worktree already set up for the task, and a
second one orphans everything written into it. Do not override the model: the agent declares
`model: inherit` along with its own effort and turn budget, and those are upstream's calls.

This agent is **exempt from the Subagent Contract's agent-side protocol** — its definition ships
outside this plugin's `agents/` directory, which is the whole of the condition
(`../../_shared/subagent-output-contract.md`, "Exemption: third-party agents"). Do not ask it for a
`DONE` status line, do not inline Template A, and do not re-prompt it for format. It has its own output
contract; this step adapts to that contract instead of overwriting it.

The dispatcher's side still binds. Send only:

1. **The artifact path(s)** — Step 2's resolved file list, absolute, with the file Step 3.6 found the
   contract in named first. Never the conversation, never this mode's own findings so far.
2. **The direction contract** — the five blocks from Step 3.6's parse, verbatim. Its input contract
   asks for them by name and it cannot re-derive them.
3. **The detector findings already in hand** — Step 3's `audit` output. Upstream tells this agent not
   to run a second detector pass, so withholding what we already ran is what makes it run one.
4. **`PRODUCT.md` / `DESIGN.md` paths**, when Layer 0 resolved them (`setup.hasProduct` /
   `setup.hasDesign`), since its first check is persistence. Omit the line when Layer 0 did not
   resolve — omitting is honest; guessing a path is not.

Working-directory discipline applies as to any dispatch: the agent runs `Read`/`Bash`/`Glob`/`Grep`, so
substitute the **resolved absolute** repository path into the prompt before dispatching, never an
unexpanded placeholder.

**The four outcomes this step must tell apart.** The exemption removes the status line, so the caller
carries what that line would have routed. None of these may be reported as a clean design review:

| Outcome | How it looks | What this step does |
|---|---|---|
| **Unavailable** | Resolver returned `null`, or no agent file | Skip; `SCANNED` log; omit `finish_review` from the return |
| **Failed** | The dispatch errored, or the agent returned nothing | `finish_review: {ran: true, parsed: false, reason}`; no findings; `SCANNED` log |
| **Unparseable** | A reply yielding none of the four sections | Same as Failed. Do **not** mine prose for something finding-shaped |
| **Parsed** | The four sections are present | Adapt per Step 4 |

A parsed reply with an empty `material_fixes` list is a real, clean result and is reported as one —
that is the only case that may say the render met its contract. Absence of output is not absence of
findings, and the distinction lives in `parsed`, never in the finding count.

### Step 3.8: Dispatch project-local craft critics

> **Track carve-outs:** This step has six lettered sub-steps (a)-(f) forming a sequential gating
> chain — a later sub-step's correctness can depend on an earlier one (e.g. (c) Availability gates
> whether a critic dispatches at all). A spec/task brief adding or modifying a track's behavior here
> must state which of (a)-(f) were checked and which need a carve-out — e.g. "checked (a) through
> (f), carve-out needed at: (c), (d)" — not just the one sub-step the author already has in mind.
> Naming only that one risks silently missing an earlier gating sub-step and breaking a track's
> availability or dispatch without anyone noticing (#672).

The finishing review above judges the render against Impeccable's own direction contract. This step
asks a different question of a different reviewer: do the changed files meet the *project-local craft
principles* the record's track has wired — the curated roster in `../critics.md` — and does the
project's decisions layer (`DESIGN.md` + `.impeccable/design.json`) hold up against those principles?
Each critic is an upstream skill dispatched as an ordinary contract subagent, **not** a third-party
agent: the full Subagent Contract applies (status line, Template A, Standard profile), and nothing
here is modelled on Step 3.7's exemption. Routing of what comes back — polish, `staged/`, the review
summary — is deliberately not this step's concern; it produces findings and a return field, and #599
routes them.

**(a) Lever.** Resolve the `design-critique` policy value —
`node "${CLAUDE_PLUGIN_ROOT}/bin/resolve-policy.js" --run "$PIPELINE_RUN_DIR" design-critique` — the JSON envelope (`{"design-critique":{"value":…,"source":…}}`), not `--values`, because the log line below needs `source`
(omit `--run "$PIPELINE_RUN_DIR"` when it is unset). Log one line per `../../_shared/auto-decision-log.md`:
`AUTO {time} — review Step 3.8: design-critique resolved to {value} (source: {source}). Reversibility: n/a (a policy read).`
`off` → skip the whole step: no roster read, no dispatch, no nudge, and `craft_critics` is **omitted**
from the return. `auto` and `full` continue.

**(b) Roster selection.** Read `../critics.md` and select every row whose `Track` equals the resolved
`surface_track` and whose `Trigger` holds given the four inputs that file defines and cites:

- **Lever** — the value from (a).
- **Motion signal** — consumer judgment per `../../_shared/design-craft.md`'s Relevance map, applied to
  the record's spec/description (does it name motion work, or is `Design-intent: delightful`?) — never
  inferred from file content.
- **Decisions present** — `hasDesign` from the preconditions' Layer 0 signals object; when Layer 0
  degraded (empty object), fall back to a direct `DESIGN.md` existence check via
  `../../_shared/visual-html-output.md`'s three-path lookup.
- **`Design-intent:` set** — the record body-metadata line is present with a value other than `none`
  (`none` is unset for this purpose).

A `*pending*` or `*none*` cell in the roster selects nothing, and this step never invents a critic for a
track the roster leaves empty. Worked example, web track:

| Lever | Decisions present | Motion signal | `Design-intent:` | Selected |
|---|---|---|---|---|
| `auto` | yes | no | unset | `emil-design-eng` |
| `auto` | no | no | unset | none — and the absence-nudge (Step 4) fires on its own conditions |
| `auto` | no | yes | unset | `emil-design-eng` + `review-animations` |
| `full` | no | no | unset | `emil-design-eng` (`review-animations` needs the motion signal even under `full`) |

If the selection is empty, skip (c)–(f): no dispatch, and `craft_critics` is **omitted** from the return
(the nudge in Step 4 still applies on its own conditions). Otherwise continue with the selected rows.

**(c) Availability.** For each selected critic, resolve its `SKILL.md` per
`../../_shared/design-craft.md`'s **Emil skill resolution** — the per-skill-name two-path lookup
(`{project}/.claude/skills/{name}/SKILL.md`, then `~/.claude/skills/{name}/SKILL.md`; read through
symlinks). A name resolving at neither path is unavailable: record
`{provider: "<name>", ran: false, missed: "not installed at either path"}` in `craft_critics`, dispatch
nothing for it, and log
`SCANNED {time} — review Step 3.8: critic <name> unavailable (not installed at either path). Reversibility: n/a.`
Availability is per critic; one missing critic never skips the others. On `surface_track === "terminal"`, skip this lookup for the terminal critic — it resolves at `${CLAUDE_PLUGIN_ROOT}/skills/_shared/terminal-ux.md` directly and is never unavailable (`../critics.md`'s Resolution exception).

**(d) Decisions layer.** Resolve `DESIGN.md` (three-path lookup, as in (b)) and the root sidecar
`.impeccable/design.json` per `../../_shared/design-craft.md`'s **The two source classes** (its Decisions row). Read both
verbatim when present — they are inlined into every critic's prompt in (e). On `surface_track === "terminal"`, skip this resolution — no decisions layer is inlined; (e) item 3 sends the literal absence sentence, and the critic resolves at the plugin path per `../terminal-routing.md`. When neither exists, note
it: (e) sends the literal absence sentence instead, and Step 4's absence-nudge conditions read this
result.

**(e) Dispatch.** One `Task()` per available critic.

> **Parallel execution:** Dispatch the available critics as parallel Task agents — each runs independently and returns findings in Template A format (with the extra `Target` column below). Assemble results after all agents complete.
> **Contract:** Each agent follows the Subagent Contract (`../../_shared/subagent-output-contract.md`) — minimal input (scope + paths + output template, no conversation), one of {DONE / DONE_WITH_CONCERNS / NEEDS_CONTEXT / BLOCKED} as its first line, then the table. Profile: Standard (`node "${CLAUDE_PLUGIN_ROOT}/bin/resolve-profile.js" standard` — the placeholder is model-resolved per `docs/skill-authoring.md`'s Plugin-root references; `../../_shared/subagent-dispatch-core.md` §Model Selection) — a review-style fan-out, never Frontier. Dispatch shape: single-assistant-message rule (`../../_shared/subagent-dispatch-core.md`'s fan-out section) applies. Inline the template literally; reject and re-prompt on format violations.

`subagent_type: general-purpose`. Do **not** pass `isolation: "worktree"` — this mode routinely runs
inside a worktree already set up for the task, and a second one orphans everything written into it
(Step 3.7's reason, and it holds here). Working-directory discipline: substitute the **resolved
absolute** repository path into the prompt; never an unexpanded placeholder.

The prompt body contains **only** the following, in this order — never conversation history, never
this mode's other findings, never a path *to* the critic skill in place of its text:

1. The critic's `SKILL.md` content, inlined verbatim (a path string reaches nothing — see
   `../../_shared/design-craft.md`'s Subagent Contract compliance). For the `terminal` critic this is
   `_shared/terminal-ux.md`'s content, resolved per (c)'s exception — not a `SKILL.md`.
2. The resolved absolute repository path (the working-directory anchor), then Step 2's resolved file list as absolute paths.
3. The decisions layer from (d), inlined verbatim (`DESIGN.md`, then `.impeccable/design.json`) — or,
   when absent, the literal sentence: "No DESIGN.md or sidecar exists for this project — emit no
   `decisions` rows".
4. The two questions, verbatim:
   "1. Conformance: for each file, where does the diff fall short of what DESIGN.md decided, or of your
   craft principles where DESIGN.md is silent? Report as `Target: code`. 2. Pushback: where is DESIGN.md
   silent on a sub-topic this diff exercised, or where does a decision it records fall below your
   principles? Report as `Target: decisions`, with `Path:Line` = `DESIGN.md` or `.impeccable/design.json`."
5. The status-line protocol and the findings template — this literal block:

```
OUTPUT FORMAT (required):
Return ONLY a markdown table, no preamble:

| Severity | Target | Path:Line | Finding | Evidence |
|---|---|---|---|---|
| high | code | src/routes/+page.svelte:42 | Body copy set at 13px, below DESIGN.md's 14px floor | `font-size: 13px` on `.lede` |
| medium | decisions | DESIGN.md:18 | Type scale records no small-text floor while this diff ships captions | `typography:` block has no `min` |

Target must be exactly `code` or `decisions`.
Severity scale: critical / high / medium / low / info
If no findings: return literal text "No findings."
Return at most 15 rows, highest severity first; if more were found, append a final row reading "+N more" with the count in place of N — never omit this row when findings exceed the cap.
Do not add narration, headers, or summaries before or after the table.

After the table, on its own trailing line — the last non-empty line of your reply — write exactly
one of: DONE / DONE_WITH_CONCERNS / NEEDS_CONTEXT / BLOCKED.

[Use: Standard]
```

6. The read-only constraint, verbatim: "Read-only: report findings only — modify no file, run no formatter, stage nothing. This is an advisory review; the fixes belong to a later step."

**(f) Parse and encode — four outcomes.** Every dispatched critic gets exactly one `craft_critics`
entry; the outcomes are distinct encodings, and none of them may be reported as a clean design review:

| Outcome | How it looks | `craft_critics` entry | Log |
|---|---|---|---|
| **Failed** | `Task()` errored, or returned nothing | `{provider, ran: true, parsed: false, reason: "dispatch failed: <error text or 'empty reply'>"}` | `SCANNED` naming provider + reason |
| **Refused** | First line `BLOCKED` or `NEEDS_CONTEXT` | `{provider, ran: true, parsed: false, reason: "<status>: <agent's own text>"}` | `SCANNED` naming provider + reason |
| **Unparseable** | `DONE`/`DONE_WITH_CONCERNS`, but no table with the header above and no literal "No findings." | `{provider, ran: true, parsed: false, reason: "unparseable"}` — do **not** mine prose for something finding-shaped | `SCANNED` naming provider + reason |
| **Parsed** | The table (or the literal "No findings.") | `{provider, ran: true, parsed: true}` — "No findings." is a real, clean result | — |

Row hygiene on a parsed reply: a row whose `Target` cell is not exactly `code` or `decisions` is
**dropped** and counted in `dropped_rows: <n>` on that critic's entry — never coerced, since a
mis-targeted row could otherwise reach polish. If every row was dropped, encode the entry as
`{provider, ran: true, parsed: false, reason: "unparseable"}` with the count still present. Surviving
rows go to Step 4. Absence of output is not absence of findings, and the distinction lives in
`parsed`, never in the finding count.

Log lines for this step follow `../../_shared/auto-decision-log.md`: the one `AUTO` line from (a),
and one `SCANNED` line for every non-`parsed` outcome in (c) and (f) —
`SCANNED {time} — review Step 3.8: critic <provider> <unavailable | dispatch failed | refused | unparseable>: <reason>. Reversibility: n/a.`

### Step 4: Normalize findings

Parse each output into a normalized findings list:

```json
{
  "source": "critique" | "audit" | "finish-review" | "craft-critic",
  "provider": "<critic name>" | "wrapper",   // craft-critic rows only; "wrapper" is reserved for the absence-nudge
  "target": "code" | "decisions",            // craft-critic rows only
  "file": "...",
  "category": "...",
  "severity": "info" | "warning" | "error",
  "message": "...",
  "suggestion": "..."
}
```

**Adapting the finishing review (Step 3.7).** Its output contract is four named sections rather than a
findings table — `persistence`, `ceiling`, `material_fixes`, `keep` — so the mapping is stated here
rather than left to be inferred:

| Section | Becomes | `category` | `severity` |
|---|---|---|---|
| `persistence`, when it fails | One finding per missing or mismatched file | `persistence` | `error` |
| `ceiling`, when it is not `"reached"` | One finding naming the unused native devices | `ceiling` | `info` |
| `material_fixes` | One finding each, **in the order given** | `contract` | `warning` |
| `keep` | Not a finding — see below | — | — |

Three rules on this mapping:

- **`severity` is assigned, not parsed.** Upstream emits no severity scale. These three values are this
  wrapper's, chosen so the enum `/review` already maps (`info` → low, `warning` → medium, `error` →
  high) keeps working. Do not manufacture a gradient from a fix's rank: `material_fixes` is ordered
  most material first, and that ordering is preserved as **array order** in `findings`, which is the
  whole of what upstream promised.
- **`suggestion` is `null`.** The field exists to name an Impeccable command for `polish` mode to
  dispatch, and the finishing review names none. `null` rather than omitted, for the reason Step 5
  gives.
- **`file`** is whichever file the section names; when a fix names none, attribute it to the artifact
  Step 3.6 found the contract in.

**`keep` is not a finding, and must not be dropped.** It is one line naming what must *not* be diluted
while fixing — a constraint on the other findings rather than an issue of its own. Filing it as a
finding would invite someone to "resolve" it; discarding it strips the fixes of the one thing keeping
them from flattening the design. It travels in the return as `finish_review.keep`, and the Design
Quality section renders it above the findings it qualifies.

`result` stays `advisory` whatever comes back. An `error`-severity persistence finding is advisory like
every other design finding — this mode gates nothing, exactly as Step 3.6 does not.

**Adapting the craft critics (Step 3.8).** Each surviving table row from a parsed critic becomes one
finding:

```json
{ "source": "craft-critic", "provider": "<critic name>", "target": "code" | "decisions", "file": "<Path from Path:Line>", "category": "craft", "severity": "info" | "warning" | "error", "message": "<Finding> — <Evidence>", "suggestion": null }
```

- **`severity` is assigned at the boundary**, exactly as for the finishing review: the table's
  critical/high → `error`, medium → `warning`, low/info → `info` — the same three values `/review`
  already maps (`info` → low, `warning` → medium, `error` → high), so no `/review`-side change.
- **`target`** is copied verbatim (`code` | `decisions`); a `decisions` row keeps `DESIGN.md` or the
  sidecar path as `file`.
- **`suggestion` is `null`** (not omitted), per Step 5's rule — a critic names no Impeccable command.
- These findings join the same `findings` array as critique / audit / finish-review. Step 5's cache filter admits the `code` findings (`source === "audit" || (source === "craft-critic" && target === "code")`) as polish context; a `decisions` finding never enters the cache — Step 5.5 stages it for a human instead.

**Absence-nudge (wrapper-emitted).** When **all** of: the lever from Step 3.8 (a) is `auto`;
`surface_track === "web"`; Step 2 resolved ≥ 1 file; and decisions are absent (Step 3.8 (b)/(d)) —
append exactly one finding:

```json
{ "source": "craft-critic", "provider": "wrapper", "target": "decisions", "file": "DESIGN.md", "category": "craft", "severity": "info", "message": "UI shipping without a locked direction — run /claude-tweaks:design-wrapper explore to lock one", "suggestion": null }
```

`provider: "wrapper"` is a reserved value — no skill of that name is ever dispatched, and the nudge
never gets a `craft_critics` entry (it is not a critic). It never fires on the native track (this
design expects no `DESIGN.md` there), never when Step 2 resolved zero files (no UI is shipping), and
never under `full` or `off`. De-duplication is by construction, not by cache: it is emitted once per
review invocation, #599 stages it under a fixed filename that is overwritten on re-review, and a
project that does not want it says so once with `design-critique: off`.

Also extract each command's Total score from its report text, independently of findings parsing:

- **Critique** report ends with a `| **Total** | | **??/40** | **[Rating band]** |` row ("Design Health Score"). Extract the numeric fraction from the `??/40` cell.
- **Audit** report ends with a `| **Total** | | **??/20** | **[Rating band]** |` row ("Audit Health Score"). Extract the numeric fraction from the `??/20` cell.

If a command's output has no matching Total row (malformed report, drifted format, missing table), treat that score as **absent** for this run — this does not affect findings normalization above, which always proceeds independently of score parsing.

### Step 4.5: Capture score + compute trend

1. Resolve the history file path: `.claude-tweaks/design/score-history.jsonl` (relative to project root). Create the `.claude-tweaks/design/` directory if it does not exist.
2. Before appending anything, read the existing file (if present) to find:
   - The most recent line containing a `critique_score` field → this becomes `score_trend.critique.previous`.
   - Independently, the most recent line containing an `audit_score` field → this becomes `score_trend.audit.previous`.

   Each score type tracks its own most-recent value independently — the last line carrying `audit_score` is not necessarily the same line as the last one carrying `critique_score`, since either can be absent on any given prior run. Skip any line that fails to parse as JSON while scanning; do not fail the whole read over one malformed line.
3. For each score type where both a current value (from Step 4) and a previous value (from the scan above) exist, compute `delta = current - previous`. If no prior line carries that score type's field, set `previous: null` and `delta: null` for it — first-ever capture reports as "first captured score" downstream.
4. Append one new line to the history file (create the file if it does not exist):

   ```json
   {"timestamp": "<ISO 8601 timestamp>", "spec": "<spec id or path, same value Step 5 uses for the audit cache>", "critique_score": 32, "critique_max": 40, "audit_score": 16, "audit_max": 20, "files_scanned": 3}
   ```

   Omit `critique_score`/`critique_max` (or `audit_score`/`audit_max`) entirely from the line — not `null` — when that score wasn't parseable this run (Step 4). A partial capture (one score present, one absent) still writes a partial line rather than being dropped entirely.
5. If the append fails (disk full, permission denied), surface as a one-time skip and continue — same recovery rule as Step 5's cache-write failure below. A history-write failure never blocks the review gate; scores are informational only.

### Step 5: Write audit findings cache for polish mode

Persist the **audit findings and the craft critics' `code` findings** (not critique, not the finishing review, not `decisions` findings) to a JSON file alongside the ledger. Filter by `source === "audit" || (source === "craft-critic" && target === "code")`, never by "everything that isn't critique." A `finish-review` finding names no command, so admitting one would only add an unclassified observation. A `craft-critic` `code` finding names no command either — it enters the cache as **context** for polish's refinement dispatch (`modes/polish.md`'s three-way consumption table), never as a dispatch key. A `target: "decisions"` finding is **excluded** on purpose: it challenges `DESIGN.md`, which is upstream-owned and which polish must never act on; Step 5.5 routes it to a human instead.

- **Primary path:** `docs/plans/YYYY-MM-DD-{feature}-audit.json` (matches the ledger filename `docs/plans/YYYY-MM-DD-{feature}-ledger.md`).
- **Fallback (review invoked outside a flow context):** derive from the spec slug — `docs/plans/audit-{spec-slug}.json`.

Cache shape:

```json
{
  "spec": "<spec id or path>",
  "written_at": "<ISO timestamp>",
  "findings": [
    { "id": "audit-1", "source": "audit", "file": "...", "category": "...", "severity": "...", "message": "...", "suggestion": "..." },
    { "id": "craft-emil-design-eng-1", "source": "craft-critic", "provider": "emil-design-eng", "target": "code", "file": "...", "category": "craft", "severity": "...", "message": "...", "suggestion": null }
  ]
}
```

Two fields exist for `polish` mode's benefit and must be written even when they look redundant:

- **`suggestion`** — the command `audit` named for this finding, normalized to a bare command name. It is the *only* thing that selects a command in `polish` mode's suggestion-driven dispatch, so a finding cached without it is downgraded to an unclassified observation. When `audit`'s output gives no suggested command for an issue, write the field as `null` rather than omitting it, so the downgrade is visibly deliberate rather than looking like a cache-shape bug.
- **`id`** — a per-run identifier, stable within one cache file: use the finding's own identifier when `audit` emits one, otherwise assign `audit-{n}` by position, 1-based; a `craft-critic` entry gets `craft-{provider}-{n}`, 1-based per provider and **reset on every cache write** (the file is overwritten per invocation, so numbers never accumulate). `polish` mode stages unclassified findings by `id`, and a human at the Review Console needs it to find the finding this cache came from.

Cache entries are stale after one flow run; they get overwritten on the next `review` invocation for the same spec. Cleanup is handled by `/claude-tweaks:wrap-up`'s Phase 4 cleanup alongside the ledger.

If the cache write fails (disk full, permission denied), surface the failure as a one-time skip and continue — with the cache absent, `polish` mode runs its refinement set and intent dispatch, and skips suggestion-driven dispatch entirely.

### Step 5.5: Stage decisions findings (pipeline runs only)

Runs only when `$PIPELINE_RUN_DIR` is set. When it is unset (standalone `/claude-tweaks:review`), stage
nothing — the `decisions` findings render in the review summary's **Decisions** sub-heading instead
(`skills/review/review-summary-template.md`), no run dir to stage into, no backlog record
auto-filed — the human acts on the `Remedy:` line or not. Never invent a mid-flow prompt for it.

For each `target: "decisions"` finding from Step 4 (never a `code` finding, never a critique/audit
finding), write one file to `{run-dir}/staged/` carrying: `Provider:`, `File:`, `Severity:`,
`Message:`, `Evidence:`, and a `Remedy:` line. Step 4 folds the Evidence cell into
`message` as `<Finding> — <Evidence>`: split on that ` — ` separator (`Message:` before it,
`Evidence:` after); omit `Evidence:` for `provider: wrapper` — the nudge has no table row, and its
message's em dash is not a separator.

**Filename and idempotency.**

- The wrapper's absence-nudge (`provider: wrapper`, Step 4) always writes
  `design-decision-nudge.md` — a fixed name, overwritten on every write. That is the nudge's whole
  de-duplication mechanism (per Step 4 — once per invocation; opt out with `design-critique: off`).
- Every other `decisions` finding writes `design-decision-{n}.md`, `n` 1-based per Step 5.5
  invocation. Before allocating a number, look for an existing `design-decision-*.md` in this run
  dir with identical `Provider:` + `File:` + `Message:` — if one exists, overwrite it in place rather
  than allocating a new number (dedupe by content, so a re-review after polish's re-verify cycle never
  duplicates a finding).
- The `design-decision-` prefix is distinct from `polish-suggestion-{n}.md` by design; the Review
  Console reads every file under `staged/` generically.

**Remedy is mechanical, keyed on `provider` — never on message text:**

| `provider` | `Remedy:` line |
|---|---|
| `wrapper` | `Remedy: /claude-tweaks:design-wrapper explore` — no scope argument; the nudge means no direction is locked at all |
| any critic | `Remedy: /impeccable:impeccable document` — upstream's own `DESIGN.md` editor, the one command that can address silence or a weak decision on any sub-topic |

No classification of the finding's prose into a command. The remedy names an *upstream* (or wrapper)
command for a **human** to run; this mode never invokes either — the wrapper writes no design artifact
— no `DESIGN.md`, no sidecar, nothing under `.impeccable/`; `DESIGN.md` stays upstream-owned under
every condition.

Log one line per file written to `decisions.md`, per `../../_shared/auto-decision-log.md`:
`STAGED {time} — review Step 5.5: decisions finding from {provider} on {file} staged at staged/{filename}. Remedy: {remedy}. Reversibility: high (staged only). Surface at Review Console.`

If a stage write fails, surface a one-time skip and continue (Step 5's cache-write recovery rule);
the finding still renders in the summary, and `decisions_staged` counts only files actually written.

The return gains `decisions_staged: <int>` — the number of files written this invocation — omitted
entirely when zero (see Output to caller).

## Output to caller

```json
{
  "mode": "review",
  "result": "advisory",
  "files_scanned": <int>,
  "findings": [ ... combined critique + audit findings ... ],
  "score_trend": {
    "critique": { "current": 32, "max": 40, "previous": 28, "delta": 4 },
    "audit": { "current": 16, "max": 20, "previous": null, "delta": null }
  },
  "prior_critique": { "slug": "dashboard", "score": 78, "p0": 1, "p1": 4, "timestamp": "...", "file": ".impeccable/critique/..." },
  "design_contract": { "found": true, "file": "src/routes/+page.svelte", "seed": "a1b2c3d4", "recorded_on": 152 },
  "finish_review": { "ran": true, "parsed": true, "keep": "The masthead's asymmetry — do not centre it while fixing spacing." },
  "craft_critics": [ { "provider": "emil-design-eng", "ran": true, "parsed": true }, { "provider": "review-animations", "ran": false, "missed": "not installed at either path" } ],
  "decisions_staged": 2
}
```

`finish_review` is built from Step 3.7 and is **omitted entirely** when that step did not run — no
contract found, or the agent unavailable — the same omission convention `design_contract` and
`prior_critique` use. When the step *did* run it is always present, including on the Failed and
Unparseable outcomes, where `parsed: false` and a `reason` carry why. That is the field a caller reads
to learn that an absence of contract findings is an absence of *evidence* rather than a clean bill;
without it, the two are indistinguishable in `findings`. `keep` is present only on a parsed reply that
carried the section.

`craft_critics` is built from Step 3.8 and is **omitted entirely** when that step did not dispatch —
lever `off`, or the roster selected zero critics for the resolved track — the same omission
convention `finish_review` uses. When it *did* select critics it is always present, with one entry
per selected critic (unavailable ones included: `ran: false, missed`), and on the Failed, Refused and
Unparseable outcomes `parsed: false` and a `reason` carry why; `dropped_rows` counts mis-targeted rows
on a parsed reply. That is the field a caller reads to learn that an absence of craft findings is an
absence of *evidence* rather than a clean bill; without it, the two are indistinguishable in
`findings`. The wrapper's absence-nudge is a finding, never an entry here.

`decisions_staged` is built from Step 5.5 and is **omitted entirely** when that step wrote nothing —
standalone `/claude-tweaks:review` (no run dir), lever `off`, or no `target: "decisions"` finding
this invocation. When present it is the count of `staged/design-decision-*.md` files written (the
fixed-name nudge counts once); `/claude-tweaks:review` Step 6.5 reads it to say "staged for the
Review Console" versus "rendered below" in the Design Quality section.

`design_contract` is built from Step 3.6 and is **omitted entirely** whenever that step's parse
returned No-contract or Malformed — the two cases are one absence to a caller, and neither is an
error. `seed` is omitted when the contract carried none; `recorded_on` is omitted when there was no
record to write to, or when the value was already present and unchanged. The `blocks` themselves are
deliberately **not** in the return: `/claude-tweaks:demo` re-reads them from the shipped artifact at
acceptance time (`../../_shared/design-contract.md`), so passing a copy through here would create a
second, staler source of the same text.

`prior_critique` is built from Step 3.5 and is omitted entirely when Layer 0 did not resolve or reported `critique.latest: null`. It is passed through verbatim from `gatherSignals()` — see `../impeccable-plugin.md`'s field reference for its shape and for the fields that can be `null`. Its `score` is on Impeccable's own scale, deliberately not the `/40` of `score_trend.critique`.

`score_trend` is built from Step 4.5. A score type's key (`critique` or `audit`) is omitted entirely from `score_trend` if that command's Total row didn't parse this run (Step 4). If **neither** score parsed, omit `score_trend` entirely from the output — same pattern as other inapplicable fields elsewhere in this contract.

`result: advisory` signals the findings inform the review verdict but do not auto-modify code. The `polish` mode (invoked separately by `/flow`) is the code-modifying counterpart that consumes the cached audit findings to drive suggestion-driven dispatch. Each cached finding's `suggestion` field is what selects the command there, so preserve it verbatim when writing the cache — dropping it turns a dispatchable finding into an unclassified observation.
