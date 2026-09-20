# Backlog Refine — Apply-pass Logging, Closing Summary, and Run Closure

Referenced by `refine-mode.md`'s Step 5 (every write type in that section logs through this
procedure once its own writes are attempted) after Step 5's per-lane write mechanics (Priority/
Related rows, Grant rows, Dependency-repair rows, Flag-back rows, Needs-decision rows) have all
been applied. Split out to keep `refine-mode.md` under the 40 KB per-file lazy-load ceiling
(`tests/bin-lib/skill-audit/context-cost.test.js`) rather than growing the same section further
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
FAILED {time} — Backlog refine: {priority | Related | grant | dependency-repair | flag-back | needs-decision} write failed on #{n}: {error}.
```

The closing summary below counts these lines by type — `FAILED` feeds the tally's `failed` count and per-failure lines; `AUTO … skipped …` (including a reverify-fetch failure) feeds `skipped` and its per-skip lines; a write with no matching line was never attempted and counts toward neither.

**Closing summary (required, rendered as assistant text — never delegated to tool output; a
shell print of the tally does not satisfy this):** after the apply pass above completes, render
a closing block from the same per-write outcomes already logged to `decisions.md` above — no
second bookkeeping channel:

1. **Per-type tally line** — one count per write type applied this run, with `skipped` and `failed` always
   present, even at zero:

   ```
   34 priority set · 2 Related updated · 7 granted · 5 flagged back · 1 dependency-repair · 1 needs-decision · 0 skipped · 0 failed
   ```

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
