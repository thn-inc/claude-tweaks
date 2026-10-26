# Backlog Refine — Apply-pass Logging, Closing Summary, and Run Closure

Referenced by `refine-mode.md`'s Step 5 (every write type in that section logs through this
procedure once its own writes are attempted) after Step 5's per-lane write mechanics (Priority/
Related rows, Grant rows, Dependency-repair rows, Flag-back rows, Needs-decision rows) have all
been applied. Split out to keep `refine-mode.md` lean rather than growing the same section further
inline (#1512; #1488's own Task 7 already split the `RECOMMEND_BUILD: false` branch out to
`grant-lane-decision.md` for the identical reason).

Check each write's own result before logging it — a non-zero exit from any `gh`/`writeRecord` call
above is a failure, not a success, regardless of which lane produced it (a reverify fetch above
is not itself a write; it follows its own skip rule instead). Log every action to this
run's `decisions.md` (standalone-auto run dir per `_shared/run-dir-resolution.md`) via the matching
template below, success, failure, or skipped-before-write:

```
AUTO {time} — Backlog refine: set priority:{tier} on #{n}.
AUTO {time} — Backlog refine: updated **Related:** on #{n} to reference #{m}.
AUTO {time} — Backlog refine: granted auto:build{ + auto:merge} to #{n} (risk:{riskTier}, size:{sizeTier}). Rationale: {grant-check RATIONALE}.
AUTO {time} — Backlog refine: re-authorized #{n} — stripped bot:blocked, granted auto:build{ + auto:merge}.
AUTO {time} — Backlog refine: repaired dependency on #{n} — {wired native blocked-by referencing #{m} | appended Blocked by #{m} line}.
AUTO {time} — Backlog refine: flagged back #{n} — {missing sections | needs scoring | no verdict rendered}.
AUTO {time} — Backlog refine: stamped needs:decision on #{n} — {grant-check RATIONALE}.
AUTO {time} — Backlog refine: skipped #{n} — premise changed since confirmation ({what changed}); dropped without writing.
AUTO {time} — Backlog refine: skipped #{n} — premise changed since confirmation (concurrent grant agreed: live {live grant}, this run RECOMMEND_MERGE={true|false}); dropped without writing.
AUTO {time} — Backlog refine: skipped #{n} — premise changed since confirmation (concurrent grant DIVERGED: live {live grant}, this run discarded RECOMMEND_MERGE={true|false} — {grant-check RATIONALE}); dropped without writing.
AUTO {time} — Backlog refine: skipped #{n} — premise changed since confirmation (flag-back concurrent grant agreed: live {live grant}, this run RECOMMEND_BUILD=true); dropped without writing.
AUTO {time} — Backlog refine: skipped #{n} — premise changed since confirmation (flag-back concurrent grant DIVERGED: live {live grant}, this run discarded RECOMMEND_BUILD=false — {grant-check RATIONALE}); dropped without writing.
FAILED {time} — Backlog refine: {priority | Related | grant | dependency-repair | flag-back | needs-decision} write failed on #{n}: {error}.
```

The closing summary below counts these lines by type — `FAILED` feeds the tally's `failed` count and per-failure lines; `AUTO … skipped …` (including a reverify-fetch failure) feeds `skipped` and its per-skip lines; a write with no matching line was never attempted and counts toward neither.

**Concurrent-grant comparison (#2719).** When Step 5's pre-write reverify drops a grant row because the record's live labels gained `auto:build` and/or `auto:merge`/`auto:merge-pending` since Step 1, compare that live grant (`{live grant}`: `auto:build`, `auto:build + auto:merge`, `auto:build + auto:merge-pending`, or `auto:merge`/`auto:merge-pending` alone — the headless grant chain (`refine-headless.md`'s Grant rows) writes `auto:build` + `auto:merge-pending`, never `auto:merge` directly, so both count as merge-present here) against this run's own `RECOMMEND_MERGE` verdict for the row before logging — the grant-check verdict itself, not the session-wide "Grant auto:build only, hold merge" override, which changes only what this run would have written. A re-authorize row (`bot:blocked`; Step 3 skips its grant-check call entirely, so no `RECOMMEND_MERGE`/RATIONALE exists to compare) keeps the generic skip line instead, with `{what changed}` = `concurrent grant: live {live grant}; re-authorize row, no grant-check verdict to compare` — never "agreed"/"DIVERGED" for these rows. For every other grant row, it **agreed** when live carries `auto:build` and live `auto:merge`-or-`auto:merge-pending` presence equals `RECOMMEND_MERGE`; anything else **diverged**. Log the matching line above: the DIVERGED form carries this run's discarded `RECOMMEND_MERGE` value and its grant-check RATIONALE verbatim, so a reader of `decisions.md` sees the live grant differs from this run's own verdict instead of assuming they repeated each other — this compares this run's verdict against the other actor's *write*, not necessarily its own verdict (a concurrent hold-merge choice or human override writes `auto:build` only). A grant row skipped for any other reason (lost `ready`, a live-state fetch failure) keeps the generic line, as does every non-grant row except the flag-back case below. Both forms count as `skipped`. Every divergence of one sweep is listed by `grep 'concurrent grant DIVERGED' "$PIPELINE_RUN_DIR/decisions.md"`, and the closing summary's per-skip lines (item 3) carry the same text.

**Flag-back concurrent-grant comparison (#3324).** When Step 5's pre-write reverify drops a flag-back row because the record's live labels gained `auto:build` since Step 1 (with or without another of the reverify's flag-back labels), compare that live grant (`{live grant}`: `auto:build`, `auto:build + auto:merge`, or `auto:build + auto:merge-pending`) against this run's own `RECOMMEND_BUILD` verdict for the row before logging. That means the grant-check verdict itself, not the reason the row was flagged back: a Step 3.5 body-shape downgrade or a human override in Step 4 can flag back a row whose verdict was `RECOMMEND_BUILD: true`, while a needs-scoring row always carries `RECOMMEND_BUILD: false`. A flag-back row with no `RECOMMEND_BUILD` verdict — Step 3's `no verdict rendered` outcome, or a re-authorize (`bot:blocked`) row a human flagged back in Step 4, which Step 3 never grant-checked — keeps the generic skip line, with `{what changed}` = `concurrent grant: live {live grant}; flag-back row, no grant-check verdict to compare`. It never reads "agreed" or "DIVERGED". For every other flag-back row, the live grant always carries `auto:build`, so the verdict alone decides: **agreed** when `RECOMMEND_BUILD` is `true`, **diverged** when it is `false`. Log the matching flag-back line above. The DIVERGED form carries this run's grant-check RATIONALE verbatim, carrying the same write-versus-verdict caveat as the grant-row form. A flag-back row that gained `risk:*`/`size:*`/`bot:in-progress` without `auto:build`, or that hit a live-state fetch failure, keeps the generic line. Both forms count as `skipped`. Every flag-back divergence of one sweep is listed by `grep 'flag-back concurrent grant DIVERGED' "$PIPELINE_RUN_DIR/decisions.md"`. The grant-row grep above also matches these lines, so one `grep 'concurrent grant DIVERGED'` lists every divergence of either kind.

**Closing summary (required, rendered as assistant text — never delegated to tool output; a
shell print of the tally does not satisfy this):** after the apply pass above completes, render
a closing block from the same per-write outcomes already logged to `decisions.md` above — no
second bookkeeping channel:

1. **Per-type tally line (mechanical, #2729) — never hand-composed.** Run
   `node "${CLAUDE_PLUGIN_ROOT}/bin/closing-tally.js" --run "$PIPELINE_RUN_DIR"` against this run's
   own `decisions.md` (the file just written above) and render its JSON envelope's `line` field
   verbatim as this bullet's tally line — one count per write type, `skipped` and `failed` always
   present, even at zero:

   ```
   34 priority set · 2 Related updated · 7 granted · 5 flagged back · 1 dependency-repair · 1 needs-decision · 0 skipped · 0 failed
   ```

   The CLI's field set (`plugin/bin/lib/closing-tally/closing-tally.js`'s `FIELDS`/`LABELS`) is the
   only vocabulary this bullet may ever render — a count for anything not in that list (e.g. a
   `collision-reconciled` field) requires updating that module (and this file) first, never
   inventing a field ad hoc in the rendered text. The CLI counts both forms a write can be logged
   in — the templates above and `bin/apply-refine-labels.js`'s own per-action lines (`#{n}: applied
   {labels}`, typed by the labels applied) — per record and field it takes the larger of the two
   forms' counts, so a write logged both ways counts once while distinct writes on the same record
   (a priority and a Related write that both failed) still count separately; a flag-back or
   needs-decision whose label landed but whose comment failed counts once, under `failed` only
   (#3267). The envelope's `unclassified` array lists any `decisions.md` line that
   reads as a Backlog-refine action, or any `AUTO`/`FAILED` line under `## /backlog`, that matched
   no known field — a drifted log template or a genuinely new write type; surface it as a one-line
   caveat under the tally ("`{n}` logged action(s) did not match a known tally field — see `{line
   text}`") rather than silently omitting it from the count.

   **Disclose a substituted detection method inline (#2721).** A lane whose documented detection
   has more than one implementation path — dependency-repair's `findUnresolvedDependencyProse`
   native-link+prose-scan pipeline (`refine-mode.md`'s "Dependency-repair rows") is the one lane
   this applies to today — can diverge in confidence depending on which path actually ran: a
   mechanized pass and a manual body read can both find nothing, but they do not warrant the same
   trust in that "nothing." When this run's dependency-repair count was produced by reading record
   bodies manually instead of running the documented mechanism (a human/agent substitution, not
   the probe-unavailability degrade already narrated inline per-record above), state that inline
   next to the count rather than rendering the same bare number a fully-mechanized run would
   produce:

   ```
   0 dependency-repair (manual body read, not the native-link+prose-scan pipeline)
   ```

   A run that executed the documented mechanism in full renders the bare count unchanged — this
   disclosure exists only to flag a divergence, never to annotate the common case.

2. **One line per failed write** — the record ref and the error, followed by a paste-ready retry
   command on its own line (this repo's report-line convention: no inline/same-line comments).
   The retry command reproduces that write type's own Step 5 mechanics above, not a generic
   `gh issue edit --add-label`:

   ```
   #123 — priority write failed: {error}
   gh issue edit 123 --add-label priority:high
   ```

   (assumes the removal already landed and only the add failed — see the caveat below before
   pasting this literally)

   For a priority write, re-derive the conditional swap from the failure point: re-read the
   record's current `priority:*` label state and emit the add-only form only when no prior-tier
   label remains — safe when the removal already landed and only the add failed; before any
   removal it leaves two contradictory labels, exactly what the swap above exists to prevent.
   Grant rows (up to four chained `gh` calls) and Related/Flag-back rows (a `--body-file` edit)
   retry as the single failed call from that row's own mechanics, not the whole row.

3. **One line per skipped write** — the record ref and what changed, informational only (no retry command needed — the human re-runs refine to pick it up fresh next time):

   ```
   #123 — skipped: premise changed since confirmation (lost ready label)
   #124 — skipped: premise changed since confirmation (concurrent grant DIVERGED: live auto:build + auto:merge, this run discarded RECOMMEND_MERGE=false — {grant-check RATIONALE})
   ```

4. **Filter/posture exclusion lines (#1887)** — never silent, one line each, naming what was
   excluded and the exact command that covers it:

   - **`#N` filter excluded rows.** When this run resolved a named-record filter (`refine
     #N[,#M...]`) and any lane's whole-queue population held rows outside that filter, name the
     count and the bare command that would cover them: `{n} record(s) outside this run's #N
     filter also have refine work pending — run /claude-tweaks:backlog refine to sweep the whole
     queue.` Omit when the filter excluded nothing (every lane's whole-queue population equaled
     the filtered population — the common case on a small backlog).
   - **Posture skipped the Resolve lane.** Under the headless posture, this line is
     `refine-headless.md`'s own Resolve-skip line (Step 5 there) — do not duplicate it here; a
     human-present run never skips Resolve, so this case never applies to this file's own closing
     summary.

5. **The run-directory path, absolute** — never relative (a bare relative
   `.claude-tweaks/pipelines/` path silently shadows the main-checkout copy when run from a
   worktree):

   ```
   Audit trail: /abs/path/to/.claude-tweaks/pipelines/{run-id}/decisions.md
   ```

A fully clean run still renders `0 failed` explicitly (and `0 skipped` alongside it), omitting
both the per-failure and per-skip lines — that's the only signal a clean run needs.

**Close the run dir.** After the closing summary above renders, close this run's standalone run
directory so resume/reconcile paths can classify it as terminal instead of `status: unknown`:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/hooks.js" close-run --run <absolute-run-dir>
```

Run it only for a directory this run created — one that did not exist before this run's own resolution ran. A directory the resolver returned from `$PIPELINE_RUN_DIR` (the parent pipeline, `--source sweep`) or a most-recent-matching (step 2) match is inherited: An **inherited** directory is never closed here, so skip this call.

**Narrate completion only after the call actually ran and exited 0 (#2729) — never
preemptively.** A sentence claiming a specific action completed ("closing the run," "writing the
watermark," or any equally specific past-tense claim) must describe an action this step already
executed, confirmed by this command's own exit code — not a planned or assumed next step stated
before it runs. This matters most on the self-assessment degradation path (fewer of the usual
actions actually execute there), where it's easiest for a generic closing narration template to
outrun what was actually done. If the call fails or is skipped, say so plainly instead of claiming
closure.

Always pass an explicit `--run <absolute-run-dir>` — the run directory itself: the closing summary's
audit-trail line above names the `decisions.md` *file* inside it, so strip the trailing
`/decisions.md` to get the directory `close-run` requires (it rejects a file path outright).
Omitting `--run` now resolves via `close-run`'s unambiguous-only implicit resolution
(`docs/hooks.md`'s Ownership section, `#1012`) — it acts only when the caller's own composite
identity (`classifyOwnership`, session id AND worktree binding) resolves to exactly one non-foreign
candidate among this project's non-terminal runs, and refuses outright — listing every candidate as
a paste-ready `--run` line — on any ambiguity or foreign-only match, rather than guessing. Passing
an explicit `--run` still avoids that refusal path entirely and is the more direct route. `close-run`
creates `run-state.json` when the run dir never had one — every refine standalone run — and stamps
it `status: clean`, so no separate direct write is needed. A "no recorded wrap-up invocation"
warning line is expected here and not an error; refine runs standalone and never invokes
`/claude-tweaks:wrap-up`.
