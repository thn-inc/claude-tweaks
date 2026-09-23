# Design Mode — polish

Invoked via `/claude-tweaks:design-wrapper polish <spec> [--dry-run]`. Returns `{mode, result: "ok" | "anomaly", commands_invoked, files_modified}` (`anomaly` — see Step 6.5 — when `commands_invoked` is non-empty but `files_modified`'s `git diff` evidence is empty) or `{mode, skipped, ...}` to caller. **First wrapper mode that modifies code** — unless `--dry-run` is passed, see Step 8.

## When this runs

Called by `/claude-tweaks:flow` in the polish phase between review and wrap-up. Dispatches three categories in order:

1. **Refinement set** — always when frontend (`polish` / `clarify` / `harden`)
2. **Suggestion-driven** — only when the audit cache holds findings, and each finding's own `suggestion` field names the command
3. **Intent-driven** — only when the record's `Design-intent:` body-metadata line (lifted into the materialized header — spec 20) declares matching values (`bolder` / `quieter` / `distill` / `delight`+`animate` / `onboard`)

The full dispatch rules for each category live in `../command-map.md`.

## Preconditions

Run the universal preconditions from `../SKILL.md` (all three detection layers + availability for the Impeccable plugin).

## Procedure

### Step 1: Run preconditions

On any skip, return the skip object — `/claude-tweaks:flow` notes the skip and proceeds to wrap-up without invoking re-verify.

### Step 2: Resolve changed files

If `<spec>` was passed and lists scoped files, intersect with `git diff --name-only`. Otherwise use the full diff filtered to frontend extensions/paths.

If zero files remain after filtering, return `{skipped: "no UI files changed"}`. If `git diff --name-only` itself fails (non-git directory, git error, mid-rebase state), return `{skipped: "unable to resolve target files (git diff failed)"}` immediately — see `../SKILL.md`'s Input section for this shared fallback-failure rule.

### Step 3: Read prior audit findings cache

The `review` mode writes findings to a per-spec cache alongside the ledger: `docs/plans/YYYY-MM-DD-{feature}-audit.json` (or `docs/plans/audit-{spec-slug}.json` when invoked outside a flow context).

Cache resolution:

- If a ledger file exists for this spec, derive the date+feature prefix from the ledger filename and use the matching `-audit.json` sibling.
- Otherwise, glob `docs/plans/*-audit.json` and `docs/plans/audit-*.json`, pick the most recently modified file matching the spec slug.
- If no cache file is found, proceed without suggestion-driven dispatch — only the refinement set and intent dispatch run.
- If the cache exists but is older than the most recent commit on the spec's branch, treat as stale and skip suggestion-driven dispatch (the audit no longer reflects current code).

Since #599 the cache also carries `source: "craft-critic"` entries with `target: "code"` (review-time
craft-critic findings normalized by `review.md` Step 4 and filtered by its Step 5; `decisions`
findings never reach this cache). The staleness rule above covers both kinds identically — a stale
`craft-critic` entry is skipped along with stale audit entries; there is no separate staleness path.

#### Four-way consumption

Every cached finding is consumed one of exactly four ways, keyed on `source`, `dispositionByReview`, and `suggestion` — **checked in this order**, `dispositionByReview` first:

| Cached finding | Consumed as | Where |
|---|---|---|
| `source: "audit"` with a `dispositionByReview` field (any value) | **Skipped entirely** — not dispatched as a Command, not staged as an unclassified observation | Step 5 |
| `source: "audit"` with a usable `suggestion` (and no `dispositionByReview`) | **Command** — suggestion-driven dispatch, unchanged | Step 5 |
| `source: "audit"` with `suggestion: null` / unresolvable (and no `dispositionByReview`) | **Staged observation** — `kind: "unclassified"`, unchanged | Step 5 |
| `source: "craft-critic"` (`target: "code"` only) | **Context** — inlined into each refinement-set dispatch prompt as a "Known craft issues" block; never selects a command, never staged, never counted in `commands_invoked` | Step 4 |

A `craft-critic` finding has no `suggestion` by construction (`review.md` Step 4 writes `null`) and is
never fed to Step 5's resolution — it is not an unclassified observation either; it is context.

**Why the `dispositionByReview` check comes first.** `review/code-mode-steps.md`'s Step 6.7 (Late
Findings Routing) writes this field back onto a cache entry once it has already routed that finding
under the run's `review-auto-apply-ceiling` — auto-applying it, staging it for a human, or prompting
inline. Without this branch, this step's own suggestion-driven dispatch would independently re-derive
a command from the same finding's `suggestion` field and could auto-apply what review had just staged
for a human, bypassing the ceiling entirely. The check is presence-only (any `dispositionByReview`
value means "review already decided") — this step never needs to know *which* terminal status review
chose, only that review already handled it. This makes review's ceiling-aware routing authoritative
over this step's suggestion-driven dispatch. A cache with no `dispositionByReview` field on any entry
(standalone `/claude-tweaks:design-wrapper polish`, where review's Step 6.7 never ran) behaves exactly
as it did before this field existed — the three original branches apply unchanged.

### Step 4: Refinement-set dispatch (always invoked when frontend)

Invoke each via the Skill tool, in order:

- `/impeccable:impeccable polish <files>` — final design system alignment
- `/impeccable:impeccable clarify <files>` — UX copy improvement
- `/impeccable:impeccable harden <files>` — error handling, i18n, edge cases

**Job-statement suffix.** All three targets carry a fixed job-statement suffix appended after the file list — see `../command-map.md`'s `### Step 1 — Refinement set` section for the exact text and the reason it is not job-type inference. It is not optional, does not vary by record, and is appended on every refinement-set dispatch, exactly as `animate`'s Frequency Gate suffix is.

**Known craft issues (from review-time critics).** The refinement dispatch already receives the
assembled design-craft principles per `_shared/design-craft.md` (the assembly `skills/flow/polish-execution.md`
carries). When the cache from Step 3 holds `source: "craft-critic"` entries, add a **sibling** block
beside those principles in each refinement-set dispatch — never a replacement, and never above them:
`design-craft.md`'s authority rule (decisions win over principles) stays exactly as the executing
agent receives it. Per dispatch, filter the cached `craft-critic` findings to those whose `file` is
in that dispatch's target file list; render at most 15 rows, highest severity first, each row the
finding's `file`, `severity`, and `message` verbatim; when more than 15 match, append a final line
`+N more` with the count. Head the block literally:

```
Known craft issues (from review-time critics) — context, not commands:
| File | Severity | Finding |
```

The block informs the refinement commands; it never selects one, is never staged, and is never
counted in `commands_invoked`. A dispatch whose file list matches no cached `craft-critic` finding
carries no block.

**File-target convention:** The wrapper passes the file list as a single space-separated argument. If a command rejects multi-file input, the wrapper falls back to looping per file and records the per-command preference once per session in the in-memory marker (same marker pattern as the availability skip de-dupe). Do not surface the looping as a finding — it is a normalization detail, not user-facing behavior. The canonical per-command argument shape is documented alongside each command in `../command-map.md`.

### Step 5: Suggestion-driven dispatch (only when the audit cache holds findings)

Read the audit findings from Step 3 — the cache entries with `source: "audit"` only; `source: "craft-critic"` entries are Step 4's context (four-way consumption table) and never enter this loop. Before reading a finding's `suggestion`, check the finding for a `dispositionByReview` field first — any value means review's Step 6.7 already routed this finding, so skip it entirely (see the four-way consumption table above). For every remaining finding, its own `suggestion` field names the command that remediates it — `audit` writes one on each issue it reports. Dispatch what the finding names. Do not derive a command from the finding's `category`, `rule`, or `description` text; the wrapper does no keyword matching of any kind here.

For each finding, in cache order:

1. **Resolve the `suggestion`.** Normalize it to a bare command name (upstream writes it as `/impeccable <command>`), then look it up in `../command-map.md`'s Full command map table.

2. **Manual-only → stage.** If the named command is one of the manual-only commands (see `../command-map.md`'s Full command map table for current membership), do not dispatch it. Append one `kind: "manual-only"` entry to `staged_suggestions` (see Output to caller below), which `/claude-tweaks:flow`'s polish-phase execution writes to `{run-dir}/staged/` and logs to `decisions.md`, so the user sees it at the Wrap-Up Review Console rather than the pipeline applying an aggressive creative change silently.

3. **No usable `suggestion` → stage as an unclassified observation.** If the field is absent, `null`, empty, or resolves to nothing in that table, append one `kind: "unclassified"` entry to `staged_suggestions` carrying the finding's `id` and `category` verbatim, plus its `message` as the entry's `description`. (The cache field is `message`; the staged field is `description` — see `review.md`'s Step 5 cache shape, which is the producer of both.) Never fall back to keyword-mapping the finding onto a command — that is the mechanism this step replaced — and never drop it silently. It reaches the Review Console as an observation for a human to route.

4. **Anything else → dispatch normally.**

**Batching, across all findings regardless of category.** When several findings name the **same** command, dispatch it once with the union of their affected files, de-duplicated. When findings name **different** commands, dispatch each named command once, each scoped to the union of the files whose findings named it. Staged entries follow the same union rule per command; an unclassified entry is never merged with another, since it names no command to merge on.

**`category` selects no command.** It travels as metadata on staged entries so a human can group related findings at the Review Console, and it populates the `trigger` field of a dispatched entry (`audit:{category}`) for the audit trail. It never picks the command.

### Step 6: Intent-driven dispatch

Read `Design-intent:` from the record's body-metadata line (lifted into the materialized header — spec 20; written by `/claude-tweaks:specify`; the canonical field definition lives in `skills/specify/spec-template.md`; the dispatch table is in `../command-map.md` Step 3). For each declared intent value, invoke the matching command via the Skill tool on the same scoped file list used in Steps 4–5.

**Multi-intent ordering.** When the user declared comma-separated intents (e.g., `design-intent: bold, delightful`), invoke commands in the order declared. The fixed `delight` → `animate` pairing for `delightful` is preserved even when interleaved with other intents — treat `delightful` as a single dispatch unit that produces two commands. The wrapper does not run a re-verify cycle between intent commands; the polish phase as a whole shares a single re-verify cycle (capped by `/flow`'s polish phase, see flow's polish-phase decision tree).

**Frequency Gate guardrail.** The `animate` command's target argument always carries a fixed Frequency Gate guardrail suffix, appended after the file list — see `../command-map.md`'s `### Step 3 — Intent-driven` section for the exact text and rationale. Do not treat `animate`'s target as a bare file list when reasoning about this dispatch; the suffix is not optional and is not gated by audit findings or `design-intent` value. It applies to a Step 5 dispatch of `animate` too, now that a finding's `suggestion` can name it — `animate` is in the palette `audit` draws its suggestions from.

**Manual-only commands.** The manual-only commands (see `../command-map.md`'s Full command map table for current membership) are not intent-driven in this phase — they surface via `survey` mode recommendations only (`extract`'s additional discoverability channel is noted on its row in `../command-map.md`). Do not auto-dispatch them from `polish`.

**No declined-recommendation suppression in polish.** Declined-recommendation tracking applies to `survey` mode only — `polish` always honors the explicit `design-intent:` declaration. The user changes intent dispatch behavior by editing the record's `Design-intent:` body-metadata line (lifted into the materialized header — spec 20 — at the next materialization), not by declining recommendations.

### Step 6.5: Verify against git diff evidence (#886)

`commands_invoked` is a claim — this step checks it against what actually landed on disk before the output leaves this mode. Skip this step entirely when `commands_invoked` is empty (nothing was claimed to run — the empty-`commands_invoked` output shape below already covers that case) or when running under Step 8's `--dry-run` short-circuit (nothing was actually dispatched, so there is nothing to diff).

Run `git diff --stat -- <files>`, scoped to the union of every `files` entry across `commands_invoked` (not the full working-tree diff — a change elsewhere in the tree from an unrelated concurrent process must not mask a genuine no-op here, and must not be misattributed to this dispatch either). Set `files_modified` from `git diff --name-only` over that same scoped set — the actual observed diff, not a narrated list — so `files_modified` is always ground truth from here on, never a claim.

- **Non-empty diff** — proceed to Step 7 normally. `result` stays `"ok"`.
- **Empty diff** (`commands_invoked` non-empty, `git diff --stat` over the scoped file set shows nothing) — this is the anomaly this step exists to catch. Set `result: "anomaly"` (never `"ok"` — a caller must not read this as a clean success) and add a top-level `anomaly` field: `"commands_invoked non-empty but git diff shows zero changes across the scoped files — verify this is expected (already-conformant code, a command that legitimately found nothing to change) rather than a dispatch that silently no-op'd."` The wording is evidence-neutral by design: an empty diff after a real dispatch is *usually* the record already being conformant, not fabricated output, but the status must still be distinct and visible every time — never silently folded back into `"ok"` on the assumption of the benign case. `commands_invoked`, `staged_suggestions`, and `decision_summary` are still computed and returned unchanged; only `result` and the new `anomaly` field change.

If `git diff --stat`/`git diff --name-only` itself fails (non-git directory, git error, mid-rebase state) — the same fallback-failure class Step 2 already handles — treat as the empty-diff anomaly case above rather than silently trusting the narrated `files_modified`: a diff command that cannot run provides no evidence either way, and "no evidence" must not read as "verified."

### Step 7: Build `decision_summary`

When `commands_invoked` is non-empty, build a single-sentence summary for the caller to log to the auto-decision log: `"Dispatched {N} Impeccable commands on {M} files — {category list}."` where `N` is the total count of entries in `commands_invoked`, `M` is the count of unique files across all invoked commands, and `{category list}` is built by grouping `commands_invoked` entries by their `category` field, semicolon-separated, in the order refinement-set, suggestion-driven, intent-driven — skip any category with zero entries:

- **refinement-set** clause: `refinement-set: {comma-separated command names}` (no trigger — the refinement set never has one)
- **suggestion-driven** clause: `suggestion-driven: {command} ({trigger})` per distinct command, comma-separated within the clause when more than one dispatched
- **intent-driven** clause: same shape as suggestion-driven — `intent-driven: {command} ({trigger})`, comma-separated within the clause when more than one dispatched

Worked example — the 3 refinement-set commands (`polish`, `clarify`, `harden`), 1 suggestion-driven (`typeset`, from a finding whose `suggestion` named it, `category: typography`), 1 intent-driven (`bolder`, triggered by `intent:bold`), across 3 files:

```
Dispatched 5 Impeccable commands on 3 files — refinement-set: polish, clarify, harden; suggestion-driven: typeset (audit:typography); intent-driven: bolder (intent:bold).
```

Staged entries are **not** counted in `N` and do not appear in the category list — nothing was dispatched. They are logged separately by the caller as `STAGED` entries.

When at least one cached `craft-critic` finding was inlined into a refinement dispatch (Step 4's
"Known craft issues" block), append the trailing clause `; craft-context: {N} critic findings inlined`
to the sentence, where `{N}` is the **run-total of distinct cached `craft-critic` findings inlined
into at least one refinement dispatch** this polish invocation (a finding inlined into two dispatches
counts once). Emit the clause once per polish invocation, exactly as `decision_summary` itself is;
omit it when `N` is zero. Example: `Dispatched 3 Impeccable commands on 2 files — refinement-set:
polish, clarify, harden; craft-context: 4 critic findings inlined.`

When `commands_invoked` is empty, do not build `decision_summary` — omit the field entirely from the output.

### Step 8: `--dry-run` short-circuit

When the caller passes `--dry-run`, run Steps 1-7 exactly as above to compute the full `commands_invoked` (including each entry's `category`/`trigger`) and `staged_suggestions` lists and the `decision_summary`, but stop before Step 4's actual Skill-tool invocations — do not dispatch any Impeccable command, and do not modify any file. Return the same output shape as a normal run (see Output to caller below) with `files_modified: []` unconditionally and `dry_run: true` added to the top level, so callers can distinguish a real no-op (`files_modified: []` with no `dry_run` key) from a dry-run preview. `staged_suggestions` and `decision_summary` still reflect what *would* run — callers must not append `decision_summary` to the auto-decision log or write `staged_suggestions` to `{run-dir}/staged/` for a dry-run response, since nothing was actually decided or staged.

## Output to caller

```json
{
  "mode": "polish",
  "result": "ok",
  "commands_invoked": [
    { "command": "/impeccable:impeccable polish", "files": ["..."], "category": "refinement-set" },
    { "command": "/impeccable:impeccable typeset", "files": ["..."], "category": "suggestion-driven", "trigger": "audit:typography" },
    { "command": "/impeccable:impeccable bolder", "files": ["..."], "category": "suggestion-driven", "trigger": "audit:slop" },
    { "command": "/impeccable:impeccable bolder", "files": ["..."], "category": "intent-driven", "trigger": "intent:bold" },
    { "command": "/impeccable:impeccable delight", "files": ["..."], "category": "intent-driven", "trigger": "intent:delightful" },
    { "command": "/impeccable:impeccable animate", "files": ["..."], "category": "intent-driven", "trigger": "intent:delightful" }
  ],
  "staged_suggestions": [
    { "kind": "manual-only", "command": "/impeccable:impeccable overdrive", "files": ["..."], "trigger": "audit:slop" },
    { "kind": "unclassified", "id": "<finding id>", "category": "slop", "description": "<finding description>", "files": ["..."], "trigger": "audit:slop" }
  ],
  "files_modified": [ "<path>", ... ],
  "decision_summary": "Dispatched 6 Impeccable commands on 3 files — refinement-set: polish; suggestion-driven: typeset (audit:typography), bolder (audit:slop); intent-driven: bolder (intent:bold), delight (intent:delightful), animate (intent:delightful); craft-context: 2 critic findings inlined."
}
```

`staged_suggestions` is an array of entries that were **not** dispatched — omit the field entirely when empty, same convention as `decision_summary`. Every entry carries `kind`, `files`, and `trigger`; `kind` discriminates the two reasons an entry is staged rather than run, and consumers must branch on it:

| `kind` | Also carries | Meaning |
|--------|--------------|---------|
| `manual-only` | `command` | A finding's `suggestion` named a manual-only command. There is a command to run; the wrapper declined to run it automatically. |
| `unclassified` | `id`, `category`, `description` | The finding had no usable `suggestion`. There is **no** command — the entry is an observation for a human to route. |

An `unclassified` entry has no `command` field at all, by construction: inventing one is the keyword-mapping this mode retired. A consumer that renders staged entries must not assume `command` is present — `skills/flow/polish-execution.md`'s `{command} {files} — ...` template predates the `unclassified` kind and needs the branch added. That is tracked as part of the cross-skill sweep in record #148; until it lands, an `unclassified` entry still reaches `{run-dir}/staged/` and `decisions.md`, but renders with an empty command slot.

Or, when no commands ran (skip from preconditions, or zero files in scope, or no findings + no refinement set applicable):

```json
{
  "mode": "polish",
  "result": "ok",
  "commands_invoked": [],
  "files_modified": [],
  "note": "Refinement set ran with zero net changes" | "No frontend files in scope"
}
```

Note `decision_summary` is absent from the empty-`commands_invoked` case above — there is nothing to log.

Or, when Step 6.5 catches the empty-diff anomaly (`commands_invoked` non-empty but nothing landed):

```json
{
  "mode": "polish",
  "result": "anomaly",
  "commands_invoked": [
    { "command": "/impeccable:impeccable polish", "files": ["..."], "category": "refinement-set" }
  ],
  "files_modified": [],
  "anomaly": "commands_invoked non-empty but git diff shows zero changes across the scoped files — verify this is expected (already-conformant code, a command that legitimately found nothing to change) rather than a dispatch that silently no-op'd.",
  "decision_summary": "Dispatched 1 Impeccable commands on 1 files — refinement-set: polish."
}
```

Note `decision_summary` is absent from the empty-`commands_invoked` case above — there is nothing to log.

`polish` is the **first wrapper mode that modifies code** — unless invoked with `--dry-run` (Step 8), in which case `dry_run: true` is present and `files_modified` is always `[]`. Callers (`/flow` polish phase) must follow up with re-verification (types/lint/tests) when `files_modified` is non-empty. When `decision_summary` is present *and* `dry_run` is absent, callers must also append it to the auto-decision log (see `_shared/auto-mode-card.md`). When `staged_suggestions` is non-empty *and* `dry_run` is absent, callers must also write one file per entry to `{run-dir}/staged/` and log a `STAGED` entry per entry to `decisions.md` (see `_shared/auto-decision-log.md`) — otherwise the suggestion is silently dropped instead of surfacing at the Wrap-Up Review Console. A `dry_run: true` response is a preview only — callers must not log or stage anything from it. **When `result: "anomaly"` (Step 6.5), the caller must render it distinctly from a clean `"ok"` result** — surface the `anomaly` text in the pipeline's failure/warning surface (`/flow`'s ledger, per `_shared/auto-decision-log.md`'s entry schema — an `AUTO` entry is wrong here since nothing was verified as landed; log a `KEPT-PROMPT`-shaped note instead) rather than treating the response as a successful polish pass; `decision_summary`, if present, must not be silently appended to the auto-decision log as if the dispatch were confirmed to have worked.

## Anti-Patterns

| Pattern | Why It Fails |
|---------|-------------|
| Deriving a command from a `craft-critic` finding | It has no `suggestion` by construction — it is refinement **context**, never a dispatch key; keyword-mapping a finding onto a command is the mechanism Step 5 retired. |
