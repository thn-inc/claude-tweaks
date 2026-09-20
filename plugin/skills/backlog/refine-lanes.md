# Backlog Refine — Step 4: Decision Lanes

Loaded by `refine-mode.md`'s Step 4 at render time — this file is the full rendering procedure the
stub there points to. Holds the one-lane-per-record precedence rule (and its Resolve/Re-authorize
exception, #1887), the eight lane table/paste-block templates (Resolve's own render lives in
`refine-record.md`, pointed at rather than restated here), the consequence-line trust and
`solution:unjustified` annotation templates, the count-summary
line, the Needs-you lane, the ceiling/skip-case footers, the closing `Next:` line rule, and the
confirm gate.

One lane per record, precedence: Resolve → Re-authorize → Grant → Flag-back (populated during the
run by Step 3.5 downgrades) → Needs-decision (populated by `grant-lane-decision.md`'s
scored-but-refused branch) → Priority (annotation-line when the record is already laned above) →
Dependency repair (annotation-line when the record is already laned) → Needs you (residual:
`needs:definition` records, then judgment-required rows; interactive launchers, no paste block). A
record that would otherwise qualify for more than one lane renders exactly once, in the earliest
lane on this list it reaches — Flag-back rows are already flag-back before this step ever reads the
worklist (Step 3's `flag back (needs scoring)` recommendation, Step 3's missing-verdict outcome
(`flag back (no verdict rendered)`), Step 3.5's body-shape auto-downgrade),
so they never also compete as Grant candidates. **Resolve and Re-authorize are the one stated
exception to this rule (#1887):** resolving a decision proposal never resolves a co-occurring
`bot:blocked`, and vice versa (independent axes), so a record carrying both renders once in
*each* lane rather than being swallowed by whichever comes first. A record already laned above
(Re-authorize/Grant/Flag-back) keeps its priority/Related suggestion as an annotation line under
its existing row rather than a full Priority-lane row — a suggestion is never silently dropped;
see the Priority lane section below for the exact template. The lanes themselves now do the job
the retired `Type` column did — keeping grant/priority/related/dependency-repair rows visually
distinguishable within one report — without a dedicated column.

Empty lanes render nothing this run: no heading, no table, no paste block. Lead with a one-line
count summary naming only the lanes that do render (adapting the old 10+-rows count-summary rule
to always fire, since the lane split needs the overview up front regardless of count), e.g.:

`24` suggestions across `8` lanes: `3` resolve, `2` re-authorize, `7` grant, `3` flag-back,
`1` needs-decision, `8` priority, `1` dependency-repair, `2` needs-you — counts are lane array
lengths, computed fresh every run. A
record carrying only a Priority or Dependency-repair *annotation* (below) is counted under its
primary lane, never double-counted under Priority or Dependency-repair too.

Resolve this run's session-scoped actions-file paths once, up front (`_shared/session-tmp-root.md`) — every lane below writes its actions to its own variable instead of a literal `/tmp` path:

```bash
eval "$(node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" ST_BACKLOG_REFINE_ACTIONS_REAUTHORIZE=backlog-refine-actions-reauthorize.json ST_BACKLOG_REFINE_ACTIONS_GRANT=backlog-refine-actions-grant.json ST_BACKLOG_REFINE_ACTIONS_FLAGBACK=backlog-refine-actions-flagback.json ST_BACKLOG_REFINE_ACTIONS_NEEDSDECISION=backlog-refine-actions-needsdecision.json ST_BACKLOG_REFINE_ACTIONS_PRIORITY=backlog-refine-actions-priority.json)"
```

## Resolve

Population: `refine-mode.md` Step 1's Resolve fetch — every record (whole-queue, or `#N[,#M...]`-
filtered) carrying an unresolved `<!-- needs-decision: … -->` comment from any producer
(backlog-refine, specify, tidy), the `backlog-refine-human-only` compatibility shim, or
`bot:blocked`. Unlike every other lane here, this one's row shape isn't a fixed
Current→Recommended action: each row's proposal is pre-filled from the record's own
`**Proposed:** {text}` line (or the shim's rationale sentence), offering the human a choice among
grant anyway / build it myself / keep / park / close / re-authorize — never a single computed
recommendation the way Grant or Priority render one. Read `refine-record.md` in this skill's
directory for the row shape, the Evidence column, the confirm gate's fixed defaults (**keep** /
**re-authorize**, since there is no machine-recommended pick here), and Step 4's per-choice apply
mechanics — this heading is a pointer, not a restatement.

## Re-authorize

Population: `.blocked` from `session-scoped backlog-refine-worklist.json` — records that hit the retry
ceiling (`bot:blocked`), unaffected by Step 3's grant-check budget. Every row recommends the same
fixed action regardless of content: a prior failure means the human's renewed judgment is the
point, never a mechanical replay (Step 3).

| # | Record | Current → Recommended | Evidence |
|---|---|---|---|
| 1 | #118: {title} | bot:blocked → re-authorize (bot:blocked) | Prior failure — human judgment required, not a mechanical replay |

  ↳ trust: producer:harness-health / elevated — insufficient-evidence

Accepted defaults, paste-ready (Step 5's Grant-rows mechanics, `bot:blocked`→`auto:build` branch —
bootstrap comment lives there, not repeated here). Write every re-authorize row's action to
`"$ST_BACKLOG_REFINE_ACTIONS_REAUTHORIZE"` (one `{issue, addLabels, removeLabels}` object per
row — `addLabels: ["auto:build"], removeLabels: ["bot:blocked"]` for every row in this lane, per
record `issue`), then apply the whole lane in one call (`bin/apply-refine-labels.js` — batch
`gh issue edit`/`gh issue comment` dispatch from a structured actions file, #844):

```bash
── Re-authorize ──
node "${CLAUDE_PLUGIN_ROOT}/bin/apply-refine-labels.js" "$ST_BACKLOG_REFINE_ACTIONS_REAUTHORIZE" --run "$PIPELINE_RUN_DIR"
```

Re-authorizing grants `auto:build` only, never `auto:merge` — restoring that too requires an
explicit override in your next message.

## Grant

Population: `.grantSlice.selected` rows Step 3's `assess-agent-autonomy grant-check` returned
`RECOMMEND_BUILD: true` for (append `+ auto:merge` when `RECOMMEND_MERGE` is also `true`). Rows
recommended `flag back (needs scoring)` or `flag back (no verdict rendered)` never land here —
Flag-back lane, below.

When `.counts.inProgress` is non-zero: "`{n}` in flight — excluded from grant checks; a grant
changes nothing mid-run." Render nothing when the count is zero — the line exists so the drop is
visible, never as a permanent fixture.

| # | Record | Current → Recommended | Evidence |
|---|---|---|---|
| 1 | #124: {title} | — → auto:build + auto:merge | {grant-check RATIONALE} |

  ↳ trust: producer:capture / low — clean, 62% coverage

Accepted defaults, paste-ready (Step 5's Grant-rows mechanics — bootstrap comment lives there, not
repeated here). Write every grant row's action to `"$ST_BACKLOG_REFINE_ACTIONS_GRANT"`
(`addLabels: ["auto:build"]`, or `["auto:build", "auto:merge"]` when `RECOMMEND_MERGE` was also
`true`, per record `issue`), then apply the whole lane in one call:

```bash
── Grant ──
node "${CLAUDE_PLUGIN_ROOT}/bin/apply-refine-labels.js" "$ST_BACKLOG_REFINE_ACTIONS_GRANT" --run "$PIPELINE_RUN_DIR"
```

**Trust consequence line.** Rendered under a Re-authorize or Grant row only when the Trust signal
section's gate (Step 3) actually ran the fetch — skip case renders no line at all anywhere (see the
skip-case footer below the lanes) — as the literal template:

```
  ↳ trust: {provenance} / {band} — {verdict}{, {coverage}% coverage}
```

sourced from `session-scoped backlog-refine-trust.json`, the coverage clause appended only when `{verdict}`
is `clean` or `mixed`. `{provenance}` is the row's full `kind:source` pair (`producer:capture`,
`side-effect:wrap-up leftover`, `human:human`) and `{verdict}` is the literal module value
(`clean`/`mixed`/`insufficient-evidence`) — do not shorten either, since a record's `by:*` label
and its resolved provenance must be readable as the same fact side by side.

Two absences render differently and must not be conflated: "no cell yet" — the `no-cell` module
value reworded for the reader, since `no-cell` beside real verdicts would read like a fourth
verdict — when the record's class has closed no records, and "not fetched" when the record is
missing from `session-scoped backlog-refine-trust.json` entirely. The second is reachable: Step 1's worklist
is `--state open` while the trust fetch is `--state all` against the same `backlog-fetch-limit`, so
a long history can push an old open record out of the trust fetch while it stays in the worklist.
Silence there would read as "no evidence" when the truth is "not looked at."

**This line is advisory and is never the reason a row is recommended.** It describes how the
record's *class* has historically turned out; the Recommended value comes from a content-aware read
of *this record* (Step 3's `assess-agent-autonomy` call). A class with no evidence is the normal
state, not a warning: on a repo that has not been running `/claude-tweaks:demo`, every line reads
`insufficient-evidence`, and its only job is to make that visible at the moment a human is granting
anyway.

Omit trust consequence lines entirely under `work-backend: local-files`, where the grant sub-stage
does not run.

**`solution:unjustified` annotation.** Any lane's row whose record carries the `solution:unjustified` label
(github — or its pre-rename spelling `framing:baked`, still read) / `facets.solutionUnjustified === true` (local-files) gets one annotation line beneath it, the literal
template:

```
  # solution:unjustified — read the record's Gotchas before approving
```

Like the trust consequence line, this is informational only — it rides along with whichever lane
the row is in, is never gated behind its own confirm, and is never written by this skill. An `unjustified`
row is not a reason to withhold a grant; it is a prompt to read the record's `## Gotchas` before
approving one.

## Flag-back

Population: rows that reached this lane before Step 4 ever rendered — Step 3's
`RECOMMEND_BUILD: false` recommendation (`flag back (needs scoring)`; the human may instead supply
`risk:*`/`size:*` inline as a free-text override rather than accepting the flag-back — Step 5),
Step 3's missing-verdict outcome (`flag back (no verdict rendered)` — `grant-check` rendered no
`RECOMMEND_BUILD`/`RECOMMEND_MERGE` line at all, per `_shared/untrusted-record-content.md`'s
verdict-source rule), and Step 3.5's body-shape auto-downgrade (a row Step 3 recommended granting
whose body failed the spec-shape re-check immediately before Step 4).

| # | Record | Current → Recommended | Evidence |
|---|---|---|---|
| 1 | #201: {title} | ready → flag back (needs scoring) | RECOMMEND_BUILD: false — {grant-check RATIONALE} |
| 2 | #205: {title} | ready → flag back (not spec-shaped) | missing/empty: `## Acceptance Criteria` |
| 3 | #212: {title} | ready → flag back (no verdict rendered) | grant-check rendered no RECOMMEND_BUILD/RECOMMEND_MERGE line |

Accepted defaults, paste-ready (Step 5's Flag-back-rows mechanics — bootstrap comment lives there,
not repeated here). Write every flag-back row's action to `"$ST_BACKLOG_REFINE_ACTIONS_FLAGBACK"`
(`removeLabels: ["ready"], commentFile: "$BACKLOG_REFINE_FLAGBACK"` per record —
the per-record flagback body file is still written exactly as before, just referenced by path
instead of pasted as its own `gh issue comment` line), then apply the whole lane in one call:

```bash
── Flag-back ──
node "${CLAUDE_PLUGIN_ROOT}/bin/apply-refine-labels.js" "$ST_BACKLOG_REFINE_ACTIONS_FLAGBACK" --run "$PIPELINE_RUN_DIR"
```

Flag-back is the one lane whose action sets both `removeLabels` and `commentFile` in the same
call — every other lane's action sets labels only. Since `apply-refine-labels.js` logs the label
edit and the comment as two independent steps (#1073), one successful flag-back write appends
**two** separate AUTO `decisions.md` lines (`#{issue}: applied -ready`, then
`#{issue}: comment posted`) instead of the single combined line every other lane's write
produces. When rendering `refine-mode.md`'s Step 5 closing summary, tally that pair as one
flagged-back write, not two.

The same split makes a *partial* flag-back visible for the first time: when the label edit lands
but the comment call fails, the record now gets an AUTO line **and** a FAILED line (before #1073
the comment failure erased the edit's AUTO line, so the record surfaced only as failed). Count
that record once, under `failed` — `ready` is off but no explanation was posted, so the row is
not flagged back until the comment retry lands. Counting it under both would make the tally's
counts exceed the number of rows applied, which the per-row tally does not mean.

## Needs-decision

Population: rows `grant-lane-decision.md`'s branch routes to `needs:decision` — a scored,
spec-shaped record `grant-check` refused for a content reason, not a scoring gap (`refine-mode.md`
Step 3 / Step 3.5). Rows already carrying an unresolved `<!-- needs-decision: backlog-refine -->`
comment (`grant-lane-decision.md`'s Idempotence check) render one annotation line instead of a
fresh row and write nothing this run. Unlike the Priority/Dependency-repair annotation lines, which
attach beneath a record's row in a higher-precedence lane, this one has no such row to attach
to — a record on this branch is idempotent by construction, not newly laned elsewhere this run —
so it renders as its own bare line directly under this `## Needs-decision` heading, above the table
when both render this run.

| # | Record | Current → Recommended | Evidence |
|---|---|---|---|
| 1 | #301: {title} | ready → ready + needs:decision | RECOMMEND_BUILD: false, already scored — {grant-check RATIONALE} |

Accepted defaults, paste-ready (`grant-lane-decision.md`'s Write mechanics — bootstrap comment
lives there, not repeated here). Write every needs-decision row's action to
`"$ST_BACKLOG_REFINE_ACTIONS_NEEDSDECISION"` (`addLabels: ["needs:decision"], commentFile:
"$BACKLOG_NEEDS_DECISION"` per record), then apply the whole lane in one call:

```bash
── Needs-decision ──
node "${CLAUDE_PLUGIN_ROOT}/bin/apply-refine-labels.js" "$ST_BACKLOG_REFINE_ACTIONS_NEEDSDECISION" --run "$PIPELINE_RUN_DIR"
```

Unlike Flag-back, this lane never removes `ready` — `apply-refine-labels.js`'s action carries only
`addLabels` + `commentFile`, no `removeLabels`.

## Priority

Population: `.prioritySlice.selected` (Step 2's synthesis, bounded to `--budget`) — every
missing-priority record's tier suggestion, plus any `**Related:**` cross-reference Step 2 detected
among the same selected set.

**Already-laned records get an annotation, never a dropped suggestion.** A selected record that
already has a row in the Re-authorize, Grant, or Flag-back lane above does not get a second,
full row here — the common case, since a record ready enough to be a grant/re-authorize candidate
frequently also lacks a `priority:*` label. Instead it gets one annotation line under its existing
row in that earlier lane, the literal template:

```
  ↳ priority: {suggested tier} — {one-line rationale}
```

and, when Step 2 also detected a `**Related:**` cross-reference for that same record:

```
  ↳ related: add **Related:** #{n}
```

The corresponding apply command (`gh issue edit … --add-label priority:{tier}` / the Related body
rewrite) folds into that same earlier lane's paste block — Step 5 applies it together with whatever
that lane already applies, in one edit per record where possible. Only records with no row in any
lane above get a full Priority-lane row below.

| # | Record | Current → Recommended | Evidence |
|---|---|---|---|
| 1 | #123: {title} | (none) → priority:high | {synthesis rationale} |
| 2 | #16: {title} | (none) → Add **Related:** #23 | {synthesis rationale} |

Accepted defaults, paste-ready (Step 5's Priority/Related-rows mechanics — bootstrap comment lives
there, not repeated here). Write every priority row's action to
`"$ST_BACKLOG_REFINE_ACTIONS_PRIORITY"` (`addLabels: ["priority:{tier}"]` per record — a
Related-only row with no priority tier omits `addLabels` and only sets whatever the Related body
rewrite needs, per that row's own mechanics), then apply the whole lane in one call:

```bash
── Priority ──
node "${CLAUDE_PLUGIN_ROOT}/bin/apply-refine-labels.js" "$ST_BACKLOG_REFINE_ACTIONS_PRIORITY" --run "$PIPELINE_RUN_DIR"
```

Rows also carry Step 2's non-binding tier guess in the Evidence column — the old `Suggested Tier`
column is retired in favor of this one sentence: render a real `ceremony:*` label plainly
(`fast-lane`/`standard`), and this pass's own LLM guess suffixed (`quick? (guess)`/`full? (guess)`),
so a human scanning the batch never mistakes the guess for `/specify`'s authoritative
verdict — informational only, never gated behind its own confirm, never itself written anywhere.

If `.prioritySlice.remaining > 0`, Step 2 already states it plainly in the report — not repeated
here.

## Dependency repair

Population: `findUnresolvedDependencyProse`'s `{ flags }` output (Step 5's Dependency-repair-rows
section names the detection and both `work-links` branches) — records whose prose names a blocker
with no resolved `blockedBy`. A flagged record already carrying a row in an earlier lane above gets
one annotation line under that row instead of a row here — one-lane-per-record; the repair need
rides along as context, the literal shape:

```
  # dependency-repair: Wire blocked-by #419 — prose cites #419 but resolved blockers were empty
```

Records with no other lane render their own row:

| # | Record | Current → Recommended | Evidence |
|---|---|---|---|
| 1 | #420: {title} | (none) → Wire blocked-by #419 | Flagged by this run's dependency-mismatch detection — prose cites #419 but resolved blockers were empty |

Accepted defaults, paste-ready (Step 5's Dependency-repair-rows mechanics, both `work-links`
branches — not repeated here). This lane's `work-links: body-text` mechanic is a **body rewrite**
(`--body-file` on `gh issue edit`), not a label/comment action — `apply-refine-labels.js`'s actions
contract (`addLabels`/`removeLabels`/`commentFile`) doesn't cover that shape, so this lane keeps
its own per-record paste-ready form rather than a forced batch call (#844: batching a body-rewrite
`gh` shape is out of scope for this CLI's first version):

```bash
── Dependency repair ──
# Terminal — #420 (work-links: body-text)
gh issue edit 420 --body-file "$BACKLOG_REFINE_BODY"  # this run's session-scoped backlog-refine-body-420.md, per _shared/session-tmp-root.md
```

A judgment-required repair — evidence too ambiguous for a mechanical wire (e.g. a cyclic or
multiply-mentioned prose match) — carries no paste-ready command and moves to the Needs-you lane
instead.

## Needs you

Population, in order: records carrying `needs:definition` in this run's fetch, then
judgment-required rows with no batchable command anywhere above — `solution:unjustified` confirmations,
judgment-required dependency repairs (previous lane). Exempt from paste blocks. Mirrors
`/claude-tweaks:backlog overview`'s Needs-you lane (`skills/backlog/overview-mode.md`'s Needs you
section) — read that for row format and ordering; not restated here. Every row carries an
interactive launcher, fully qualified:

- `needs:definition` → `/claude-tweaks:specify #{n}`, with a `#`-comment naming the label and
  waiting-age.
- `solution:unjustified` confirmation → `/claude-tweaks:challenge #{n}` (the evidence-or-accept-risk mode: per-assumption evidence findings, then supply-evidence / accept-risk / leave — either resolving choice clears the label), with a `#`-comment naming the
  one-line evidence call pending.
- Judgment-required dependency repair → `/claude-tweaks:backlog refine #{n}`, with a `#`-comment
  naming why the repair can't apply mechanically.

**`Next:`** one line, closing the report: names the top Needs-you item when that lane is non-empty,
else the highest-value batch among the lanes above — recomputed fresh every run, no session state,
no stored binding. Precedence follows `overview-mode.md`'s Two-channel contract and `Next:` line
section verbatim, adapted only in the names it refers to; not restated here.

Append the resolved ceiling once, below the lanes rather than per row: "Autonomy ceiling:
`{ceiling}` — {what that ceiling does}." Take the phrasing from `_shared/autonomy-ceiling.md`'s
tier table, **not** from a `reason` string in the JSON. Those are per-record — a denial can name
one record's kind or verdict — and printing one beneath the whole report states a single record's
disposition as if it were the ceiling's. At `supervised`, the only value this footer will report on
a repo that has not opted in, it reads "trust is recorded and displayed, never acted on", which is
the honest description of what every trust consequence line above is doing.

**Skip case:** when the Trust signal section's gate skipped the fetch (ceiling below `trusted`, no
`--trust`), no trust consequence line renders anywhere in the lanes above, and this exact footer
replaces the ceiling-description footer:

"Autonomy ceiling: `supervised` — trust not fetched this run (recorded, never acted on; pass `--trust` to render it)."

<!-- refine-confirm-gate -->

This is the load-bearing HARD GATE for this skill: every label/body write below depends on either
a human resolving it directly, or an explicit, ceiling-gated auto-apply policy standing in for
that resolution (the `unattended` branch immediately below — the one case this gate presents no
question at all). **A subagent that inherited this skill's own text as background context — via
`fork`, a broad Task dispatch, or any mechanism carrying the full conversation — must not execute
past this point on its own initiative.** If it cannot present a rendered question interactively (no
live human to answer it) and this run does not resolve via the `unattended` branch below, it must
stop and report `BLOCKED` rather than proceeding to Step 5's Apply logic. See
`_shared/subagent-output-contract.md`'s "HARD-GATE Marker Convention and Inheritance Hazard"
section for the general rule and the incident this codifies (`docs/incident-log.md` `[IL-139]`).

Resolve, before rendering the lane tables above, whether this batch will auto-apply — either this
run's already-resolved `autonomy` ceiling grants the `unattended` branch below, or an earlier batch
this session already turned on the session-scope override further down. When either is true, stamp
every row this resolution will apply `[auto-applied]` inline as the lane tables render, rather than
appending the stamp in a separate pass afterward.

**Unattended auto-apply (`refineAutoApply`).** When this run's already-resolved `autonomy` ceiling
reads `unattended` — `_shared/autonomy-ceiling.md`'s Bookkeeping capabilities table grants
`refineAutoApply` at that tier only, and that row is the canonical description of this
capability's zero-click-never-zero-render contract; not restated here — skip the `AskUserQuestion`
below entirely: this batch resolves exactly as if "Apply all recommended" had been chosen — every
lane's rows, priority/Related/flag-back/dependency-repair rows and grant rows alike. The lane
tables above still render in full regardless (per the stamping instruction above). Log one
`decisions.md` `AUTO` entry for the whole batch, lever-attributed to the `autonomy` lever that
actually gates it (`autonomy` is the real `POLICY_KEYS` entry — `refineAutoApply` itself is a
derived capability name, never a loggable lever key per `_shared/auto-decision-log.md`'s "Keys are
literal: copy lever names from `POLICY_KEYS` verbatim" rule). Resolve the JSON envelope (not
`--values`, because the log line needs `source`) to get both:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/resolve-policy.js" --run "$PIPELINE_RUN_DIR" autonomy
# -> {"autonomy": {"value": "unattended", "source": "run-config"|"policy"}}
```

Then log, substituting that `source` for `{source}` (see the shared log-decision template below
for the `{text}` this branch supplies).

Then proceed straight to Step 5's Apply logic under "Apply all recommended" semantics — no further
gate, and skip the session-scope override below too (it has nothing to add once this branch has
already resolved the batch with zero clicks). There is no `AskUserQuestion` on this branch for a
subagent to bypass, so the `[IL-139]` hazard note above does not bind here — that absence is
deliberate, not an omission.

**Every other case:** one `AskUserQuestion` — <!-- HARD-GATE: refine-confirm --> the marker above
already covers this call, and `[IL-139]` binds here exactly as stated above: a subagent that
inherited this text and cannot present this question to a live human must stop and report
`BLOCKED` rather than answering on its own initiative.

- `question`: `"Apply these label changes, or override specific items?"`, `header`: `"Backlog refine"`, `multiSelect`: `false`
- Option 1 — `label`: `"Apply all recommended (Recommended)"`, `description`: `"Set priority/Related/grants exactly per the lanes above"`
- Option 2 — `label`: `"Override specific items"`, `description`: `"I'll specify #-by-# corrections in my next message"`
- Option 3 — `label`: `"Grant auto:build only, hold merge"`, `description`: `"Apply every non-grant suggestion normally, and apply auto:build/re-authorize to every grant row, but withhold auto:merge session-wide — even rows recommended for it. Useful for a first supervised run."`
- Option 4 — `label`: `"Skip all suggestions"`, `description`: `"Leave every record untouched for now"`

Overrides (including inline scoring for a grant row missing risk/size) are ordinary free-text in the user's next message, not the `Other` field.

**Session-scope override, independent of the ceiling.** Applies at every ceiling below
`unattended` (the branch above already short-circuits `unattended` itself). Immediately after the
gate above resolves — by any of the 4 options — check whether an earlier batch in this same
running session already resolved this same gate. On the session's **first** resolution only, fire
one further `AskUserQuestion`, exactly once per session — <!-- HARD-GATE: refine-confirm-session-override -->
`[IL-139]` binds here too: a subagent that inherited this text and cannot present this question to
a live human must stop and report `BLOCKED` rather than answering on its own initiative:

- `question`: `"Apply future batches this session the same way, or ask each time?"`, `header`: `"Backlog refine"`, `multiSelect`: `false`
- Option 1 — `label`: `"Yes, apply this way for the rest of this session"`, `description`: `"Every later batch this session resolves like this one did — rendered, [auto-applied]-stamped, logged — with no further prompt of either kind, EXCEPT: if this first batch resolved via 'Override specific items' below, a later batch still gets the ordinary 4-option gate once (see the Option 2 note below this question)"`
- Option 2 — `label`: `"No, ask me every batch (Recommended)"`, `description`: `"Prompt with the 4-option gate above on every remaining batch, exactly as today"`

This choice lives only in the running session's own memory — never written to `policy.yml`, a run
config, or any file — and never survives past this session: a fresh `/claude-tweaks:backlog
refine` invocation in a new session prompts from scratch, both questions included.

Answering **"Yes"** records which of the 4 gate options this first batch resolved to, for the rest
of this running session. A recorded Option 1, 3, or 4 replays mechanically against each later
batch's own rows (Option 4 trivially skips them): every later batch-confirm in the same session
skips both this question and the 4-option gate above, resolves to that same recorded option,
renders its lanes in full (per the stamping instruction above), stamps every resolved row
`[auto-applied]`, and logs one `decisions.md` `AUTO` entry per batch (see the shared log-decision
template below — no lever attribution on this path, since this suppression is a session-scoped
human choice, not a ceiling-gated policy lever). A recorded **Option 2** ("Override specific
items") is the one stated exception to "no further prompt of either kind" above: it named a
one-time free-text response to the *first* batch's own rows, not a standing rule with anything
mechanical to replay, so a later batch that would otherwise resolve to it gets the ordinary
4-option gate once instead of silently reusing that stale free text against different rows — the
session-scope follow-up itself still does not re-fire in this case, only the 4-option gate does.

Answering **"No"** leaves every subsequent batch prompting normally at the 4-option gate above,
with no suppression and no further logging change. Either way, this follow-up question itself
never fires again for the remainder of the session — decided once, never re-asked.

**Shared log-decision template.** Both auto-apply paths above (the `unattended` branch and a
session-override-suppressed batch) log through the same call shape, differing only in `{text}` and
whether `--lever` is present:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/log-decision.js" --run "$PIPELINE_RUN_DIR" --status AUTO \
  --section "/backlog" --step "refine confirm-gate" --text "{text}" --reversibility high \
  [--lever "autonomy={value} ({source})"]
```

- Unattended branch: `{text}` = `"Backlog refine: batch auto-applied — {n} rows across {m} lanes, all recommended values"`, with `--lever` present using this run's already-resolved `autonomy` value/source (above).
- Session-override branch: `{text}` = `"Backlog refine: batch auto-applied — {n} rows across {m} lanes, per this session's standing override (chosen at the first batch-confirm)"`, with `--lever` omitted.
