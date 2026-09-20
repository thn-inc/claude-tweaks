# Full Mode

Knowledge-capture procedures for full mode (invoked by `/claude-tweaks:wrap-up` Phase 1, or standalone with no mode keyword).

Full mode is a superset of hindsight — see `hindsight-mode.md` for the shared baseline (the Approach lens below covers the same five evaluations).

## Step 2: Run Lenses — Full Mode (5 lenses + tradeoff review)

Runs all five reflection lenses plus a tradeoff review.

| Lens | Question | Surfaces |
|------|----------|----------|
| **1. Surprises** | "What surprised us?" — Unexpected constraints, library behavior, shape changes | Don'ts, skill updates |
| **2. Approach** | "What would we do differently?" — Better patterns discovered midway, over/under-engineering. Same evaluations as hindsight mode (Approach, Structure, Consolidation, Convention, Skills) — see `hindsight-mode.md`. | Skill updates, conventions, spec adjustments |
| **3. Near-misses** | "What broke or almost broke?" — Unexpected test failures, type errors, cross-platform ripples | Don'ts, testing patterns, gotchas |
| **4. Fresh start** | "If we started fresh?" — Would we choose the same approach? What would v2 look like? | Architectural alternatives; route via _shared/learning-routing.md |
| **5. Friction** | "Did the pipeline itself get in the way?" — Was every hook denial and AskUserQuestion stop this run actually necessary? | Upstream feedback (D5) via `_shared/learning-routing.md` |

### Finding Shape (Evidence + Cost)

Every finding any lens produces carries two lines beyond its description: an `Evidence:` line and a `Cost this session:` line (one line; `unclear` is valid — retries, hand-work, a reverted decision). **"No finding" is the expected common answer** — a lens that cannot be evidenced renders that explicitly rather than manufacturing an insight to look thorough.

**Evidence format is path-specific:**
- **Inline path** (this lens ran in the main thread, no transcript read) — a pointer into the session's own context: a named tool call, an error message, a file:line, or a user turn. Never a transcript byte offset — there is no transcript read on this path.
- **Dispatched path** (the standalone `[Use: Frontier]` singleton, which reads the transcript via `_shared/transcript-judge.md`, #857) — a transcript-anchored pointer: a quoted excerpt or a precise location reference, since this path (unlike inline) has an actual transcript to point into.

### Near-misses Chain Walk

Before routing (Step 3), walk each Near-misses finding through `_shared/causal-depth.md`'s why-chain: the near-miss is the input, the chain asks "why was this possible?" up to 3 times, and the resulting `CAUSAL: terminal | systemic` verdict travels with the finding into Step 3's routing — a `systemic` verdict is itself insight-worthy alongside the near-miss it came from, not a separate item.

### Friction Lens

Unlike the other lenses, Friction evaluates the pipeline's own behavior toward the operator
during this run, not the code that got built.

**Input:** run `node "${CLAUDE_PLUGIN_ROOT}/bin/friction-events.js" --run "$PIPELINE_RUN_DIR"`
rather than reading `events.jsonl` directly — it returns this run's own events UNIONED with any
other non-terminal run dir recorded against the same worktree (a JSON array on stdout; `[]` when
none exist), filtered to: `wd-deny`, `gate-denial` and `bookkeeping-stamp-deny` (logged by
`bin/lib/hooks/pre-tool-use.js`), `contract-violation` and `zero-tool-use-verdict` (logged by
`bin/lib/hooks/subagent-stop.js`), and `ask-user-question` (logged by
`bin/lib/hooks/post-tool-use.js`). `contract-violation` specifically can under-report — the
SubagentStop hook it depends on fires unreliably for Task dispatches
(`_shared/subagent-output-contract.md`, claude-code#27755) — so the lens should not treat its
*absence* as proof of a clean run.

**The genuine `contract-violation` count (#2344).** `subagent-stop.js` tags every logged
`contract-violation` event with a `variant`: `'lenient'` (an old-shape but still-compliant reply,
#2265), `'foreign-contract'` (the reply's first line is exactly a verdict word from ANOTHER
dispatch site's own declared contract — e.g. a review-lens/fix-verification dispatch replying
`APPROVED`/`NEEDS_FIXES`/`ADDRESSED`/`VERIFIED` — never a real breach of THIS contract), or
`'violation'` (a genuine breach; legacy events with no `variant` field at all are also genuine).
`friction-events.js`'s own read boundary already drops `'lenient'` and `'foreign-contract'`
variants before this lens ever sees them (the identical precedent #2350 established for
`'lenient'`) — **judge this lens's aggregate `contract-violation` volume as the genuine count**,
not a mix of three unrelated populations. One population `friction-events.js` cannot filter:
mid-turn/non-final narration graded as if it were the dispatch's terminal reply
(claude-code#27755's unreliable firing) — that population's own fix is #2041's scope, not this
lens's; until it lands, treat a surprisingly high genuine count as a prompt to sample a few
entries' `firstLine` before concluding the run was actually non-compliant that often.

**`zero-tool-use-verdict` (#2345).** A dispatched agent's verdict/findings/pass-fail reply whose
transcript carries zero tool-use blocks anywhere — it read nothing, so its content is a failed
dispatch, never evidence, independent of whether its status line was otherwise well-formed. This
is real friction the operator (or a downstream reviewer trusting the reply) would have hit had it
gone unnoticed — count it at face value, no variant filtering.

**Ad-hoc-session fallback (#500, widened #1333).** An ad-hoc worktree dev session — implementing
a change directly at the user's request, outside any `/claude-tweaks:build`/`/claude-tweaks:flow`
pipeline — has no run dir of its own until this very wrap-up run creates one, so friction incurred
earlier in that session would otherwise have nowhere it was ever logged to. `bin/lib/hooks/
post-tool-use.js`'s `stampAdHocRunDir` closes that gap at the source: on the first `PostToolUse`
event where this session owns no run dir yet AND either an `EnterWorktree` call just fired, or
`ctx.cwd` resolves to a worktree entry distinct from the main repo root (a worktree created by a
tool other than claude-tweaks' own `EnterWorktree` — another plugin's worktree-management skill, or
a raw `git worktree add`), it mints a lightweight standalone one (`{ts}-adhoc-standalone`,
`run-state.json` stamped with this session's id and the worktree path) so every `appendEvent(...)`
call from that point on has somewhere to land — no changes to any gate's own deny logic or message
text. The non-`EnterWorktree` path is rate-limited to at most one `git worktree list` per session
(a session-scoped marker, `bin/session-tmp.js`'s convention), since this hook fires on every
`PostToolUse` event across every session in the harness. `friction-events.js` is the read side: it
finds that ad-hoc run dir back by its recorded `worktree` field (`bin/lib/hooks/context.js`'s
`findRunsByWorktreePath` — the plural sibling of the teardown gate's `findRunByWorktreePath`, since
a session can leave behind more than one such stamp before it finally reaches wrap-up) and merges
its events into the output alongside this run's own. A genuinely frictionless ad-hoc session still
returns `[]` — nothing is manufactured. A formal `/claude-tweaks:build`/`/claude-tweaks:flow` run is
unaffected: its own `PIPELINE_RUN_DIR` is set (or `record-worktree` stamps ownership) before either
trigger fires, so `stampAdHocRunDir` sees an already-owned run and never mints a second, competing
one.

**Lifecycle: surviving the orphan-mint sweep (#1117).** An ad-hoc dir never gets a `config.yml` in
practice either (`/flow`'s Manifesto is what writes one; `bin/set-config.js`'s `setConfigLever`
also creates the file in whatever run dir its `--run` names, but no caller ever points it at an
ad-hoc dir), which is also the signal the background reconcile sweep
(`bin/lib/reconcile/archive-merged.js`'s `isOrphanedMint`) uses to detect an abandoned
`/flow`/`/dispatch` pre-Manifesto mint and silently archive it after 24h of no mtime activity — a
real dev session left untouched for that long before wrap-up finally runs would otherwise lose its
whole friction record with no error, reopening exactly the blind spot this section exists to close.
`isOrphanedMint` exempts any `-adhoc-standalone`-suffixed dir from that mtime sweep entirely
(`isAdHocStandaloneMint`) rather than racing it against a blind age heuristic built for a
different case. It carries a real `worktree` in its `run-state.json`, unlike a genuine orphaned
mint, which has none — but the ordinary merged-PR archival path `archiveMerged` runs for every
other run dir requires both a still-registered worktree at sweep time and a `console.json`
written into that exact directory, and nothing in this codebase writes one there. **A genuinely-
abandoned ad-hoc dir (its recorded worktree no longer resolves in `git worktree list` at all) is
swept separately once `ADHOC_SUPERSEDED_TTL_MS` (30 days) has elapsed since it was last touched
(`isAdHocStandaloneSuperseded`, #1604) — a still-live one (worktree still registered) is never
swept by this path, no matter its age, preserving this section's own invariant.**

**This block is the single machine-checked statement of the vocabulary above** (`tests/reflect-friction-lens-vocab.test.js` pins it against the real `appendEvent(...)` call sites in `bin/lib/hooks/*.js` — a drift here is a test failure, not a silent doc rot, per `#452`'s post-mortem):

<!-- friction-lens-vocab:begin -->
- `wd-deny`: `bin/lib/hooks/pre-tool-use.js`
- `gate-denial`: `bin/lib/hooks/pre-tool-use.js`
- `bookkeeping-stamp-deny`: `bin/lib/hooks/pre-tool-use.js`
- `contract-violation`: `bin/lib/hooks/subagent-stop.js`
- `ask-user-question`: `bin/lib/hooks/post-tool-use.js`
- `zero-tool-use-verdict`: `bin/lib/hooks/subagent-stop.js`
<!-- friction-lens-vocab:end -->

**Membership rule:** an event qualifies only when it describes friction experienced by the run's
own operator — a denied action, a forced stop. `wd-foreign-session` is excluded on this basis: it
is logged when a *different* session than this run's owner attempts a wrong-checkout action, so
it describes that other session's friction, not this run's. `bookkeeping-stamp-deny` is the same
gate's own-operator counterpart — `stampCheckOutcome`'s non-foreign branch, a real denied write or
push against the run that owns it — and is therefore *included*, not excluded, for the mirror
image of that same reason. `wd-foreign-teardown` is excluded for
the same bystander reason — it's written when a *different* session attempts a teardown, not this
run's own operator's friction. `wd-ambiguous` and `wd-push-mismatch` are excluded on a different
basis: both resolve to allow, not a denial, and emit no `systemMessage` — they're silent
breadcrumbs, not friction.

**Per-event avoidability.** For each qualifying event, judge whether it was necessary or whether
it indicates a claude-tweaks defect (a gate that shouldn't have fired) or gap (a decision the
plugin should have had a default for):

- *Avoidable* — a `gate-denial` firing on an action the gate's own stated policy condition
  doesn't actually match (a false positive); an `ask-user-question` whose header and options were
  fully answerable from CLAUDE.md content already in context.
- *Not avoidable* — a `wd-deny` firing exactly as `worktree-always` documents it should (a
  provable wrong-checkout commit); an `ask-user-question` posing a genuine judgment call with no
  stated project preference either way.

**Aggregate volume.** Independent of any single event's verdict, judge whether this run's total
stop count looks disproportionate to its own scope — weighed against the record's own `Estimated
tasks`/Deliverables count as a rough proportionality anchor (a 2-task record with 8 stops reads
differently than an 8-task record with 8 stops), never against a hardcoded number.

A finding from either judgment is an ordinary reflect insight from here on — route it through
Step 3's `_shared/learning-routing.md` classifier exactly like every other lens's finding. A
false-positive denial resolves to defect (rule 1); a recurring missing default resolves to gap
(rule 7). No new routing table.

### Seed from Review Learnings (pipeline context)

When invoked by `/wrap-up`, check the `/claude-tweaks:review` summary for the **Key Learnings** section. Use these as starting points for the five lenses rather than re-deriving from scratch. If the review summary has no Key Learnings section (it may not always be rendered), say so explicitly and fall back to deriving the five lenses from scratch — don't silently skip the seed step with no signal that it was unavailable.

### Tradeoff Review

Check the `/claude-tweaks:review` summary for the **Tradeoffs Accepted** section. For each accepted tradeoff, assess whether it represents:

- A **project-wide pattern** worth documenting (e.g., "we always choose X over Y because Z") -> route to CLAUDE.md or a skill
- A **one-off decision** specific to this work -> no action needed
- A **known limitation** others should be aware of -> route to Don'ts or memory

## Step 3: Route Findings — Full Mode

### Auto mode (policy-driven routing)

Auto-mode routing is shared across every mode — see the auto-routing table in SKILL.md Step 3. Every auto-resolution writes an entry per `_shared/auto-decision-log.md` (the canonical entry schema lives there).

### Interactive mode (batch user routing)

### Prior-decline annotation

Before rendering the table, compute each insight's fingerprint —
`bin/lib/health-core/fingerprint.js`'s `createFingerprint('reflect', ['description']).fingerprint({ description })`,
where `description` is the insight's own one-line text — and look it up via
`bin/lib/declined-learning/store.js`'s `lookupDecline(fingerprint)`. A match means a human
already declined an equivalent insight before; render it with a prior-decline annotation
appended to its `Insight` cell, never silently suppressed:

```
{insight text} _(previously declined {declinedAt date}: {reason})_
```

**Subject scan for a near-miss (#1033).** The exact-hash lookup above only catches an insight
whose text is byte-identical (modulo `normalizeText`'s whitespace/case collapse) to a prior
decline — free-form insight prose rarely reproduces that exactly across runs even when it means
the same thing, so this catches few real repeats. When the hash lookup above found nothing, also
call `bin/lib/declined-learning/store.js`'s `listDeclined({ source: 'reflect' })` and read each
returned entry's `subject` text (an entry recorded before #1033 may have no `subject` — skip
those; there is nothing to compare). Judge — as the agent already forming this table, not via any
mechanical string match — whether the current insight is materially the same point as any listed
subject, even where the wording differs (a rephrasing, a different concrete example of the same
underlying observation). On a judged match, apply the identical annotation above, sourcing
`{declinedAt date}: {reason}` from that entry rather than the hash-matched one. This is a judgment
call, not a second deterministic lookup — when genuinely uncertain whether two insights are "the
same point," do not annotate; a missed annotation costs the human one redundant decline, a false
one hides a genuinely new insight behind stale framing.

The insight still gets a full row and a real recommendation — the annotation is a hint for the
human's decision, not a filter. If the human resolves an annotated insight to anything other
than "Don't capture" (i.e. approves it — Implement now, Defer, or Capture), clear the stale
decline via `bin/lib/declined-learning/store.js`'s `clearDecline(fingerprint)` immediately after
applying that resolution, so the same insight text doesn't stay annotated once a human has
re-affirmed it. For a subject-scan match (no exact-hash match), clear the matched entry's own
fingerprint — the one the `listDeclined` entry carries — not a fingerprint freshly computed from
the current insight's differently-worded text; that fresh fingerprint doesn't exist as a key in
the store yet, so clearing it would silently no-op and leave the stale entry annotating future
runs forever.

Collect all insights from the five lenses and the tradeoff review into a single table:

```
### Reflection Insights

| # | Insight | Causal | Recommended Destination |
|---|---------|--------|------------------------|
| 1 | {description} | {terminal/systemic/—} | Implement now -> CLAUDE.md Don'ts |
| 2 | {description} | {terminal/systemic/—} | Implement now -> Skill: {name} |
| 3 | {description} | {terminal/systemic/—} | Defer — bigger, not relevant now |
| 4 | {description} | {terminal/systemic/—} | Capture — needs brainstorming |
```

The table renders as markdown, as above. Immediately below it, call `AskUserQuestion` with:

- `question`: `"How do you want to handle these insights?"`, `header`: `"Insights"`, `multiSelect`: `false`
- Option 1 — `label`: `"Apply all (Recommended)"`, `description`: `"Apply all recommendations"`
- Option 2 — `label`: `"Override specific items"`, `description`: `"tell me which #s to change"`

**Hard gate.** Check the response you are about to send: does it already contain the `### Reflection Insights` table as literal rendered markdown, with a row for every insight? If not, this is not "the table was presented earlier" or "the user can infer the list from context" — render it now, in this response, before the tool call. `AskUserQuestion` cannot carry the table itself (`docs/skill-authoring.md`'s Multi-item decisions convention), so a response with the tool call but no table above it has shown the user "Apply all" with nothing to apply it to.

**Routing guide.** Classify every insight through the ordered procedure in
`skills/_shared/learning-routing.md` — that file is the single source of truth
for destinations and their precedence. Do not restate its table here.

Two of its outcomes are newer than this skill's previous behavior and deserve
naming explicitly:

- **D4 (memory)** — the insight is about the user, or is an environment fact
  with no owning artifact. Written per the contract's memory write procedure,
  staged for approval and applied only via its own gate. **Approving this
  insights batch (even "Apply all") only approves routing the insight to D4 —
  it is not approval to write the memory file.** The write always waits for
  its own separate gate (`wrap-up/memory-curation.md` stages it;
  `wrap-up/review-console.md`'s Memory updates section takes the `M#`
  decision — the Review Console's batch "Approve all" at
  `supervised`/`trusted`, or auto-resolution under `consoleAutoResolve` at
  `unattended`) — never perform the write as part of applying this batch's
  result.
- **D5 (upstream)** — the insight is about a claude-tweaks skill or contract and
  would hold in any project using the plugin. Routed to
  `/claude-tweaks:feedback`.

The contract is first-match-wins: one insight yields one destination. An insight
that genuinely serves two audiences is two insights, stated separately.

**Writing a Don't: narrative first, then compress.** When an insight routes to CLAUDE.md's Don'ts, write the incident account *first* — the specific build, how it was caught, what it cost — wherever this project keeps that evidence (an incident log if it has one, otherwise the work record or the commit message). Only then compress it to the rule that lands in CLAUDE.md: one sentence of rule, one clause of why. Doing it in this order matters. Write the rule first and you pad it — the incident is vivid, every detail feels load-bearing, and the justification gets smuggled into the always-loaded file a clause at a time. Giving the evidence a home where it is allowed to be long removes the pressure to do that. A Don't that needs three sentences of background to be believed is a compressed rule plus an account that belongs somewhere else, not a long rule.

**Recommendation rules:**
- **Implement now** — the strong default. If an insight leads to a concrete change (update CLAUDE.md, update a skill, add a rule), make the change. A D4 memory outcome is staged via wrap-up's Memory curation row instead of applied inline — **but only when this run will actually reach wrap-up.** Standalone `/claude-tweaks:reflect`'s Next Actions (`reflect/SKILL.md:183`) only *offer* `/claude-tweaks:wrap-up`, they never require it, so a run that ends here leaves a `staged/` file no Review Console will ever open — a lesson with no consumer. When this is a standalone run and the user does not continue to `/claude-tweaks:wrap-up`, present the D4 proposal inline instead, for the same per-item approval, then write it directly per the contract's "Memory write procedure (D4)" on approval — the same resolution `_shared/ledger-format.md`'s Resolve Gate section applies to a standalone ledger item ("no Review Console will ever read a staged file, so create the record directly instead"). Never leave a D4 proposal staged with no consumer.
- **Defer** (new work record, `parked`) — the insight leads to a known improvement but it's bigger and not relevant to the current work. Gated by `_shared/deferral-gate.md`: run its fix-now criteria first, and name the `Defer-reason:` in the batch table's Recommended column (e.g. `Defer — genuinely-larger`), chosen per that file's vocabulary — same mapping review Step 3 uses (`review/step3-routing.md`). Compose the body via `specShapedBody` (the insight → Current State, the known improvement → Deliverables, the observable outcome → Acceptance Criteria; `header: 'Trigger: {condition}'`; `filedBy: 'reflect'`; `provenance: { origin: 'reflect {mode} from #{n}', deferReason }`; footer `_Filed by \`reflect\` via specShapedBody._`), then create it directly via the unified record contract (`_shared/work-record.md`) — `gh issue create` (`work-backend: github-issues`) or `local-store.js`'s `writeRecord` (`work-backend: local-files`) — with `recordPayload({ …, risk, size, parked: true })` (scored per the Scoring axis; `parked`, never `ready` alongside a Trigger). An insight naming an open choice takes the `openQuestion` variant (`needs:definition` — a label with no `recordPayload` parameter, appended at the create call — no scoring). An insight with no valid reason cannot be recommended Defer. Before this recommendation is rendered, apply `_shared/materiality-floor.md`'s floor test to the insight: when it fails to clear the materiality floor (and its `Defer-reason:` is not `tangential`), the batch table's Recommended column shows "Digest — below floor" instead of "Defer — {reason}", and the digest entry is written only when the human approves that row (or an auto path applies it) — never before this recommendation reaches a human, per the contract's recommend-only-path rule. This mode's own insight-routing summary states the digest comment URL and the count routed this run, per `_shared/materiality-floor.md`'s "Digest URL and count surfacing" section.
- **Capture** — the insight is complex or uncertain and needs brainstorming/exploration before it can be acted on. Routes to `/claude-tweaks:capture`, which files it as a fresh backlog work record — the recommendation names its reason the same way (`Capture — tangential`), invoked with the shaped body and `--defer-reason={value} --source reflect` (capture's Shaped-body branch — `capture/SKILL.md`). An insight with no valid reason cannot be recommended Capture. A Capture recommendation's `Defer-reason:` is usually `tangential`, which `_shared/materiality-floor.md`'s override always clears — a Capture-routed insight with reason `tangential` renders "Capture — tangential" as above, never a "Digest" recommendation. A Capture-routed insight carrying a different `Defer-reason:` (the rarer case) is still subject to the same materiality-floor test as the Defer bullet above, and may render "Digest — below floor" instead.
- **Don't capture** — only for insights that are genuinely not actionable (one-off observations, context-specific facts, things already documented elsewhere). Must state why. Record the decline via `bin/lib/declined-learning/store.js`'s `recordDecline(fingerprint, { reason, source: 'reflect', subject: description })` — `fingerprint` from the Prior-decline annotation step above, `reason` the stated why, `subject` (#1033) the insight's own one-line `description` text (the same text the fingerprint was computed from), so a later run's subject-scan step above has something to compare against for an insight that re-surfaces reworded rather than byte-identical. `source: 'reflect'` names this skill regardless of whether it ran standalone or from `/claude-tweaks:wrap-up` (#1399) — every reader below filters on this same literal. A decline write failure degrades open — log a one-line note and continue; never block the batch resolution over it.

If any insight is "Implement now", handle it after the user approves the batch table, before returning control to the parent or presenting Next Actions — **except a D4 outcome**, whose write is gated separately as described above; do not write a memory file at this point.

> **Always present the batch table in interactive mode**, even when every insight routes to "Implement now." Interactive mode means *ask the user* — the confirmation is the contract, not a formality. Skipping it (because the routing looks uniform or obvious) would be contract drift: auto-apply behavior belongs in auto mode, governed by the `Reflect insight routing` row of `_shared/auto-mode-contract.md`'s silences table.
