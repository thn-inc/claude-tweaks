---
name: backlog
description: Use for backlog labels (refine — human-present or headless), next-build pick (overview), or a needs-you list (attention). Keywords - backlog, triage, authorize, grant, auto:build, auto:merge, priority, related, unattended, headless, autonomy ceiling.
argument-hint: "[refine|overview|attention] [#N[,#M...]] [critical|risk-value|cleanup|trust] [--budget <n>] [--origin <origin>] [--source <human|routine|sweep>] [--reset-breaker]"
---

# Backlog — Refine Labels and Understand the Queue

Three modes over the same open work-record backlog: `refine` ensures every record carries the right `priority:*`/`**Related:**`/grant labels — a write sweep, human-confirmed when human-present, or run zero-click under its **headless posture** (`--source routine`/`--source sweep`; the grant chain there requires `work-backend: github-issues`, the labeling lanes run under either driver); `overview` renders a distribution picture and recommends what to build next (read-only); `attention` is a read-only, ranked discovery list of every open record carrying any `needs:*` label, `solution:unjustified`, an ungranted `shaped:headless` spec, or `bot:blocked` — plus two non-record rows above the list (a merge-lane circuit-breaker banner, staged-but-unapproved tidy proposals). Sits outside the main brainstorm-to-build chain, feeding judgment and authorization into it rather than gating it:

```
capture / code-health / harness-health / journey-health / docs-health   (file records)
                              │
                              v
                /claude-tweaks:specify   (shapes to ready)
                              │
                              v
              [ /claude-tweaks:backlog ]   <- utility (no fixed lifecycle position)
                              │
                              v
                    /claude-tweaks:dispatch   (selects + executes)
                              │
                              v
                    close-via-merge   (record closes)
```

## When to Use

- You want to sweep the backlog and make sure `priority:*`, `**Related:**`, and grants (`auto:build`/`auto:merge`) are all correctly set — `refine` mode.
- A record hit its retry ceiling (`bot:blocked`) and needs a human's renewed judgment before it can re-enter the autonomous queue — `refine` mode.
- You want a synthesized read of what's in the backlog — narrative + thematic clusters, a critical/risk-value/cleanup/trust view, or a recommendation for what to build next — `overview` mode.
- You want a copy-pasteable hand-off block to parallelize shaping or building a chosen batch across terminals — `overview` mode.
- A scheduled Routine, `/claude-tweaks:sweep`, or a human standing in for one needs to sweep the `ready` queue and machine-grant every record whose gate chain fully clears, with no per-record decision to answer — `refine`'s **headless posture** (`--source routine`/`--source sweep`, or the deprecated `grant` alias), `github-issues` only for the grant chain, and only once a project has deliberately opted into the `autonomy: unattended` ceiling plus its `grant-origination-enabled` policy key.
- You want one ranked list of every open record carrying any `needs:*` label, `solution:unjustified`, an ungranted `shaped:headless` spec, or `bot:blocked` — plus a merge-lane circuit-breaker banner and a staged-tidy-proposals pointer — with a per-row recommended action — `attention` mode, `github-issues` only.

Not for: shaping record bodies or stamping `risk:*`/`size:*` (`/claude-tweaks:specify`'s job), claiming records (`/claude-tweaks:flow`'s Step 2.8 job) or building anything (`/claude-tweaks:dispatch`'s hand-off to `/flow`), or filing/closing records (one exception: `refine #N`'s human-confirmed close choice — `refine-record.md`).

## Input

`$ARGUMENTS` = `[refine|overview|attention] [#N[,#M...]] [critical|risk-value|cleanup|trust] [--budget <n>] [--origin <origin>] [--source <human|routine|sweep>] [--reset-breaker]`

- No mode (bare) → `overview` — the safer, non-mutating default.
- `refine` → the write/labeling-sweep mode. Read `refine-mode.md` in this skill's directory for the full procedure.
- `refine #N[,#M...]` → the same whole-queue sweep as bare `refine` (`refine-mode.md`), narrowed to the named record(s): every lane's population (Resolve, Re-authorize, Grant, Flag-back, Needs-decision, Priority, Dependency repair, Needs you) filters to just these numbers before Step 4 renders — one procedure, `#N` a filter over it, never a separate mode (#1887). Human-present only, never invoked by a scheduled Routine — same as bare `refine`'s own Resolve/Re-authorize lanes. `refine-mode.md` Step 4 reads `refine-record.md`'s Resolve-lane sub-file for that lane's batch-table rendering and Step 5's per-choice write mechanics (proposal comments, `bot:blocked` re-authorize, park/close), whether the run is whole-queue or `#N`-filtered.
- `refine --reset-breaker` → the standalone merge-lane circuit-breaker reset — human-present only, never invoked by a scheduled Routine. Runs `merge-lane-reset.md`'s existing question-and-write procedure and exits without touching any record. Read `refine-record.md` in this skill's directory.
- `--source <human|routine|sweep>` → the **presence switch**, valid only under `refine`, resolved before any worklist fetch: absent or `human` → human-present posture (a skill invoking `refine` on a human's behalf passes nothing extra) — labeling lanes render interactively, and the Grant lane's origination waits on a human batch-confirm (`refine-lanes.md`). `routine` (`backlog/routine-template.yml`'s kickoff) or `sweep` (`/claude-tweaks:sweep`'s component-step invocation) → headless posture — read `refine-headless.md` in this skill's directory, which layers the grant chain over the same zero-click labeling lanes. Presence is orthogonal to the `autonomy` ceiling: a headless firing at `supervised` still runs the labeling lanes (only the grant chain's own ceiling gate denies origination); a human-present session at `unattended` still renders the labeling lanes — `refineAutoApply`/the session-scope override governs only whether the batch-apply needs a click, never whether the lanes render at all. The `grant` deprecated alias below is the one exception to this switch: it forces headless regardless of `--source`'s value or absence (see `deprecated-aliases.md`).
- `grant` → **deprecated alias** for `refine`'s headless posture (`deprecated-aliases.md` in this skill's directory). Forces the headless posture regardless of any `--source` value or its absence — the one deliberate override of the `--source` presence switch above, cross-referenced from both this row and `deprecated-aliases.md` by name so the two can't drift apart independently. Emits one warn-tier deprecation notice per invocation, naming `refine --source routine` (or `--source sweep`, as appropriate to the caller) as the replacement spelling.
- `overview` → the read-only distribution + recommendation mode. Read `overview-mode.md` in this skill's directory for the full procedure.
- `attention` → the read-only, `github-issues`-only discovery mode over every `needs:*`/`solution:unjustified`/`bot:blocked` record and ungranted `shaped:headless` specs, plus the merge-lane breaker banner and staged-tidy-proposals row. Read `attention-mode.md` in this skill's directory for the full procedure.
- `--source` combined with `#N[,#M...]` or `--reset-breaker` → invalid; `--source` is a presence switch for the whole-queue `refine` sweep form only, never the per-record resolver or the breaker reset. Report the conflict and stop rather than silently ignoring it (mirrors the lens sub-argument rule one line down).
- `critical` / `risk-value` / `cleanup` / `trust` → lens sub-arguments, valid only under `overview` (or bare, which is `overview`). Invalid under `refine` (including its `grant` alias) and `attention` — report the conflict and stop rather than silently ignoring it.
- `--budget <n>` → caps LLM-bound processing in `refine` (the priority/Related synthesis pass and the grant-check pass, independently, default 40 each) — applies identically under any `--source` value or the `grant` alias, since the headless and human-present postures share the same grant-check pass; caps table row rendering in `overview` (default 20). No effect on `attention`, which is entirely mechanical (no per-record LLM reads) and bounds itself via each fetch's own `--limit 200`.
- `--origin <origin>` → filters `refine`'s grant-sweep worklist by `facets.origin` (`code-health|harness-health|journey-health|docs-health|capture|human`, where `human` selects records with no `by:*` label). No effect on `overview`, `attention`, or on `refine`'s priority/Related sweep — nor on the grant chain's own origin gate (`refine-headless.md`), which excludes every `human`-origin record unconditionally regardless of this flag (see Grant semantics in `_shared/work-record.md`).
- `--trust` → boolean presence flag, `refine` mode only — forces the trust-table fetch (and its Trust evidence rendering) at any ceiling; without it, `refine` fetches trust only when the `autonomy` ceiling resolves `trusted` or higher.

## Preflight

Read the project's `work-backend` config key (per `_shared/work-record-config.md`, the key table's canonical home, written by `/claude-tweaks:init`). Preflight is **mode-conditional**, not skill-wide:

**`overview` mode (either driver):** under `work-backend: github-issues`, run the Detection Ladder from `_shared/forge-detection.md` (checks 1-3) before any `gh` command — treat any ladder failure as a hard gate (there is no meaningful degraded mode when the whole fetch depends on `gh`). Report the specific failing check and stop. Under `work-backend: local-files`, skip the Detection Ladder entirely.

**`refine` mode, priority/Related sub-stage (either driver):** identical to `overview` mode's preflight above — both drivers supported, Detection Ladder hard gate under `github-issues`.

**`refine` mode, grant sub-stage (any `--source`, `github-issues` only):** before any `gh`/MCP command for this sub-stage, run the same Detection Ladder as a hard gate. Checks 1 and 3 are hard gates on either transport; check 2 (`gh` installed) does not gate on its own, per `_shared/forge-detection.md`'s escape hatch for a transport-aware consumer: `gh` present → proceed via the `gh` CLI calls this sub-stage documents (the interactive Grant lane, or `refine-headless.md`'s chain under the headless posture); `gh` absent → read `mcp-transport.md` in this skill's directory and proceed via its documented (unverified — see that file's header) MCP-tool equivalents instead. Under `work-backend: local-files`, this sub-stage's stop follows `_shared/local-files-preflight-stop.md`'s canonical pattern in full (trigger, reason, enumerated forbidden actions, manual alternative, no-exception clause, auto-mode disclaimer): **stop the grant sub-stage completely**, human-present or headless, `--source` notwithstanding — no `auto:build`/`auto:merge` write or suggestion, no invoking `/claude-tweaks:flow`/`/claude-tweaks:build`/`/claude-tweaks:dispatch`/any other skill, no claiming or building anything; tell the user they can run `/claude-tweaks:flow`/`/claude-tweaks:build` manually against a chosen record instead — information for the user to act on, never an instruction for you to act on yourself. This stop is scoped to the grant sub-stage only: the priority/Related sub-stage above — and, under the headless posture, the rest of `refine-headless.md`'s labeling-lanes preamble (Flag-back, mechanical Dependency-repair) — is a separate, still-valid half of the run and continues regardless of `--source` — except under the `grant` deprecated alias, which runs no labeling lanes at all (`deprecated-aliases.md`), so its stop is the whole invocation's behavior for this turn — writing `priority:*`/`**Related:**` via the local-files fallback path (`refine-mode.md`'s Step 5 Apply / `refine-headless.md`'s own labeling-lanes preamble). Nothing in that half is licensed by this paragraph to write application code, invoke another skill, or touch anything beyond those facets — real evidence for why this enumeration must stay explicit: a live run once treated a low-risk-looking record as license to run a full build-to-close lifecycle anyway (`evals/scenarios/backlog-refine-permission-matrix-compliance.yaml`).

**`attention` mode (`github-issues` only):** run the Detection Ladder as a hard gate before any `gh` command. Under `work-backend: local-files`, this mode's stop follows `_shared/local-files-preflight-stop.md`'s canonical pattern in full — **stop this mode completely**, since no local-files fetch is implemented (`needs:*`/`bot:blocked` come from the session-scoped record snapshot's read-fresh-or-fetch, and `solution:unjustified` plus `ready`+`shaped:headless` are each their own direct `gh issue list --label` call — `attention-mode.md`'s Step 1 — none with a local-files analog); tell the user this mode isn't available under `local-files` and that `/claude-tweaks:help`'s Needs Attention table still surfaces the `needs:definition`/`solution:unjustified` pair per-record via its own Definition/Framing flags, but has no equivalent flag for the `shaped:headless (no grant)` type — a known gap, not parity.

**`refine #N[,#M...]` and `refine --reset-breaker`:** same Detection Ladder hard gate under `work-backend: github-issues` as the grant sub-stage above — both forms are pure `gh`-issue writes (comment/label edits, or the breaker's CAS write), with no meaningful degraded mode. Under `work-backend: local-files`, the identical canonical-pattern stop applies — no `auto:*`/label/comment write, no exceptions when unattended, tell the user to act manually instead. See `refine-record.md` for the full procedure once Preflight clears.

## Workflow

Read `refine-mode.md` in this skill's directory for the full `refine` procedure, `overview-mode.md` for the full `overview` procedure, or `attention-mode.md` for the full `attention` procedure, per the resolved mode from Input above. When Input's `--source` presence switch resolves headless (`routine`/`sweep`, or the `grant` alias), also read `refine-headless.md` in this skill's directory — it layers the grant chain over the same labeling lanes `refine-mode.md`/`refine-lanes.md` document, replacing only the interactive Grant lane's human batch-confirm.

## Routine Configuration

`/backlog` ships a routine template (`skills/backlog/routine-template.yml`) whose prompt is `/claude-tweaks:backlog refine --source routine` — `refine`'s headless posture, the only form of this skill a scheduled Routine ever fires (the rest are human-only, per the Component-Skill Contract below). It is the conditional grant unit in `routine/fleet.md`'s fleet composition table, scheduled weekdays in the off-peak window between the finder routines and the dispatch drain. Instantiate it for the current project with:

```
/claude-tweaks:routine create backlog
```

Scheduling it does not make it grant anything, but it is no longer a pure no-op below the two-key threshold either: every firing runs the labeling lanes (Priority/Related/Flag-back/mechanical Dependency-repair) zero-click regardless of ceiling, writing `priority:*`/`**Related:**` changes every time there's anything to label. Only the grant chain itself stays gated — it reports "nothing to do" (`refine-headless.md` Step 0) until a human has set **both** `autonomy: unattended` and `grant-origination-enabled: true` in `.claude-tweaks/policy.yml`. That two-key opt-in is the security boundary this skill's Anti-Patterns table describes; the grant chain only goes live once a human turns both keys on.

## Next Actions

**After `refine`** (human-present posture — `--source` absent or `human`): render as plain markdown (docs/skill-authoring.md's Skill handoffs convention):

**`/claude-tweaks:dispatch {#-prefixed, comma-joined numbers of every record this run granted a build authorization to, e.g. #201,#202,#205}`** — skips re-selection, claims and builds them directly (recommended) — omit this line entirely if nothing was granted this run
**`/claude-tweaks:dispatch --budget 1`** — claim and build the single highest-priority authorized record (recommended) — bold and suffix `(recommended)` only when the dispatch line above is omitted
`/claude-tweaks:backlog refine` — review anything still left needing labels

**After `overview`:** The rendered recommendation is never a static tag on one line — it is computed fresh each run and MUST be attached to exactly the line whose action matches the report's closing `Next:` line (Step 4's two-channel contract — the close-out block carries this-session moves only, never other-terminal command lists), resolving through the three-level precedence (needs-you first, then executable Dispatch entry, then fallback ladder): whichever line that resolves to renders first, bolded, with `(recommended)`, ahead of the lines below in their listed order. Render as plain markdown (docs/skill-authoring.md's Skill handoffs convention):

`{the top item's launcher — /claude-tweaks:specify #N or /claude-tweaks:challenge #N}` — the one move only the human can make — omit this line when `needsYou` is empty
`/claude-tweaks:flow {top-ranked executable Dispatch entry's refs, comma-joined}` — run the report's top Dispatch terminal in this session — omit when the Dispatch block contains no executable entry
`/claude-tweaks:backlog refine` — apply the priority/Related/grant suggestions this overview surfaced — omit when nothing surfaced needs refining
`/claude-tweaks:specify #{n}` — shape the single highest-priority backlog record this run surfaced — omit when the run surfaced no unshaped backlog record to shape (the `#{n}` placeholder must always resolve to a real record)
`/claude-tweaks:backlog refine` — grant sweep over the whole ready queue, human-present flow (one batch-confirm click): applies auto:build (+auto:merge where its own checks clear) to every ready-but-ungranted record whose gate chain clears — omit when the fallback ladder's grant rung isn't what the report's `Next:` line names. Paste-ready human lines never carry `--source` — the headless posture (`--source routine`, Routine-fired) has no single-record form and is never itself a paste-ready human line
`/claude-tweaks:backlog overview {other-mode}` — {one-line description of that mode} — only after a named-lens run, naming exactly one of the named lenses not yet run this session

When situational filtering leaves **zero** lines, or the report's closing `Next:` line reads `backlog is empty` (even when the named-lens line could technically still render — the terminal takes precedence over it), restate the report's own closing `Next:` line as the terminal statement instead of rendering a markdown block. Restate, never substitute a fresh claim: the report's `Next:` line — not this block's line count — owns the queue-state verdict, and the two can diverge (an all-in-flight queue also filters every line out, but its backlog is anything but empty; whatever the report's line says there is what this block mirrors).

**After `refine`'s headless posture** (`--source routine`/`--source sweep`, or the `grant` alias): render only when a human is present to answer — mirrors `/claude-tweaks:dispatch`'s own bare-drain form rule (`dispatch/SKILL.md`'s Next Actions — `next` is its deprecated alias) exactly, since this posture is the same headless-unit shape: a human typed `/claude-tweaks:backlog refine --source routine`/`grant` directly, or a prior skill invoked it on a human's behalf → render; a scheduled Routine fired it → never render (nobody is present to answer, and an unanswered question at the end of a headless run is noise — the durable trace is the label state, the audit comments, and `decisions.md`, per `_shared/run-dir-resolution.md`'s standalone-auto allowlist). `--source sweep` is reserved for `/claude-tweaks:sweep`'s component-step invocation and NEVER renders Next Actions, regardless of who typed it — the parent owns the handoff (sweep's own close-out and Next Actions are the surface); a human standing in for a Routine types `--source routine`, not `--source sweep`. When rendering, render as plain markdown (docs/skill-authoring.md's Skill handoffs convention):

**`/claude-tweaks:dispatch {#-prefixed, comma-joined numbers of every record this run granted a build authorization to}`** — skips re-selection, claims and builds them directly (recommended) — omit this line entirely if nothing was granted this run
**`/claude-tweaks:backlog refine`** — sweep anything still eligible since this run's --budget cap or new ready records (recommended) — bold and suffix `(recommended)` only when the dispatch line above is omitted; bare form, since a paste-ready human line never carries `--source`

`/claude-tweaks:routine create backlog` — instantiate this sweep as a live weekday scheduled Routine (see Routine Configuration above); useful even before the two-key opt-in, since every firing still runs the labeling lanes zero-click — omit this line only when this project already has a live instance

**After `attention`:** render as plain markdown (docs/skill-authoring.md's Skill handoffs convention):

**`{the exact recommended-action command for the record named in attention-mode.md's 'Pick up next' line}`** — act on the top pick (recommended) — omit this line entirely when the list was empty
`/claude-tweaks:backlog attention` — re-check after acting on one or more records

If the list was empty, state that directly instead of rendering this block — there is nothing to act on.

## Component-Skill Contract

`/claude-tweaks:backlog` is human-only for `refine`, `overview`, and `attention` when invoked human-present — no pipeline orchestrator ever invokes any of the three as a component step; a human runs them directly, every time, and they always render `## Next Actions`. `refine`'s `#N[,#M...]` and `--reset-breaker` forms carry this same human-present-only posture exactly, never Routine-fired. `refine`'s grant-originating and re-authorizing lanes require a present human or the two-key headless opt-in; `refine` may be invoked headlessly by a Routine or by `/claude-tweaks:sweep`, and by no skill that claims, builds, or merges — mirroring `/claude-tweaks:dispatch`'s Routine-fired bare drain form (`--budget 1`; `next` is its deprecated alias) exactly, down to the "render Next Actions only when a human is present" rule above (`refine-headless.md`). `$PIPELINE_RUN_DIR` may be set during any mode's run, but only because this skill resolves its own standalone run dir per `_shared/run-dir-resolution.md`'s allowlist to write `decisions.md` — for `refine`/`overview`/`attention` that resolution is for logging only and never suppresses interactivity or the Next Actions block; for `refine`'s headless posture it is also where every skip reason lands when no pipeline run dir otherwise exists (`refine-headless.md`'s own Step 4 Apply / Audit format section). A sweep-parented firing (`--source sweep`) is the one headless case where that resolution finds an existing shared run dir rather than minting its own: `## Next Actions` never renders there either way, counts report to the parent, and entries log to that shared `decisions.md`.

## Anti-Patterns

| Pattern | Why It Fails |
|---------|--------------|
| Granting `auto:build`/`auto:merge` from `refine`'s human-present posture with no interactive human present in the session at all | `auto:*` labels from human-present `refine` come only from a human-confirmed batch-apply, or from that same human's own standing `unattended`-ceiling authorization applying without a per-batch click (`refine-lanes.md`'s `refineAutoApply`/session-scope override — a human-present, unattended-session origination, distinct from the headless path below). `refine`'s **headless posture** (`--source routine`/`--source sweep`, or the deprecated `grant` alias) is the one **headless, no-human-present** machine-origination path — the `autonomy` ceiling's `unattended` tier plus its `grant-origination-enabled` opt-in (both human-set project policy, off by default), gated further by per-record trust/origin/grant-check/floor checks. `docs/skill-graph.md`'s `/backlog`→`/dispatch` edge names where the third machine-adjacent actor (`/dispatch`'s headless `next` form) sits relative to these two — not restated here |
| Granting from `refine`'s headless posture on any record whose gate chain hasn't fully cleared, or on a human-filed record regardless of other keys | `bin/lib/issues/grant-gate.js`'s chain is exhaustive and ordered; a human-filed record (no `by:*`) is refused unconditionally — see `refine-headless.md` |
| Skipping or bulk-bypassing the batch-confirm in `refine` mode outside `refineAutoApply`/the session-scope override | Where neither applies, the human click is the load-bearing security signature — never skip it, even for an all-recommended batch. Where either applies, the click is replaced by a standing, logged, human-authorized policy (never silently dropped) — see `refine-lanes.md`'s confirm-gate section |
| Adding any `bot:*` label from this skill | `bot:*` is `/claude-tweaks:dispatch`'s visibility layer — this skill only *strips* `bot:blocked` on re-grant |
| Reading every candidate record's body in one unbounded pass, ignoring `--budget` | Defeats the bounded-synthesis design — see `refine-mode.md`'s Steps 1-3 |
| Fixing (rather than surfacing) `unsynced: true` local fallback records' sync state | `/claude-tweaks:tidy`'s job (Shape 3) — this skill tags them and in `refine` may apply `priority:*` via the local-files fallback, never mirroring to GitHub |
| Claiming or building a record from this skill | Out of scope — `/claude-tweaks:dispatch`'s job |
| Deriving a grant, priority bump, or "next step" from `overview` mode's Trust Table | Read-only reporting — `overview` writes nothing, and the `autonomy` ceiling's one effect on this skill is which records arrive born-`ready` (`refine-mode.md` Step 3.6), never what a verdict recommends for one already here |
| Treating `refine`'s `Trust` column as the reason to grant, or withholding a grant because a class reads `insufficient evidence` | Trust describes a class's history; the grant is about this record's content and shape, which `grant-check` reads directly. Every class reads `insufficient evidence` until `/claude-tweaks:demo` has run enough times, and that must never become a de facto freeze on granting |
| A scheduled Routine firing `refine #N` or `refine --reset-breaker` | Both are human-present-only forms, same posture as bare `refine` — see `refine-record.md`'s own Anti-Patterns table |
