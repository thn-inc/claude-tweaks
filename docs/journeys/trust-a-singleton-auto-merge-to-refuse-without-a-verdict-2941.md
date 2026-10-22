---
files:
  - plugin/skills/wrap-up/auto-merge-short-circuit.md
  - plugin/bin/lib/dispatch/merge-verdict.js
  - plugin/skills/dispatch/settle-and-merge.md
  - plugin/bin/lib/console/resolve.js
  - plugin/bin/log-decision.js
---

# Trust a Singleton Auto-Merge to Refuse Without a Verdict

**Persona:** A claude-tweaks maintainer who granted `auto:merge` on a single record, let `/claude-tweaks:dispatch` (or a direct `/claude-tweaks:flow #N`) run it unattended overnight, and the next morning reads `decisions.md` and `git log` to decide whether the fast lane can keep that grant — after once finding a PR merged with no `merge-check` ever run (#2938).
**Goal:** The single-record fast lane merges only when this record's own `assess-agent-autonomy merge-check` verdict is confirmed `auto-merge` in this run's `decisions.md`; when it isn't, the run lands in the Review Console exactly as a `needs-human` verdict would — no acceptance brief posted, no ledger deletion pushed, no merge.
**Entry point:** `/claude-tweaks:wrap-up`'s Review Console reaching `wrap-up/auto-merge-short-circuit.md` for a record whose live labels carry `auto:merge` (or a matured `auto:merge-pending`, or a `merge-authorization: pre-authorized` run).
**Success state:** `decisions.md` shows `Auto-merge short-circuit: #N assess-agent-autonomy verdict auto-merge` before any acceptance-labeling or merge line, and the merge landed — or it shows `Auto-merge short-circuit: #N merge-check verdict not confirmed in decisions.md (latest: …) — treated as needs-human` and the PR is still open, awaiting the maintainer, with the console resolved to `leave-open`.

## Steps

### 1. Layer 2 runs and logs its verdict — pass or fail
- **URL:** `node "${CLAUDE_PLUGIN_ROOT}/bin/log-decision.js" --run "$PIPELINE_RUN_DIR" --status AUTO --step "Auto-merge short-circuit" --reversibility n/a --text "#{n} assess-agent-autonomy verdict auto-merge"`
- **Action:** After Authorization clears, the run invokes `assess-agent-autonomy merge-check` and writes the verdict to `decisions.md` on either outcome — the pass gets its own line, a `needs-human` keeps the existing "Any layer fails" line.
- **Should feel:** Like a receipt — the morning reader can point at one line that proves Content judgment ran for this record, in this run.
- **Should understand:** The marker text is owned by `bin/lib/dispatch/merge-verdict.js` (`VERDICT_STEPS.shortCircuit` + `verdictText`), the same module the bundle path's `Auto-merge gate:` marker comes from.
- **Red flags:** A merge or a `demo:pending` label on the record with no `assess-agent-autonomy verdict` line for `#N` anywhere in `decisions.md`.

### 2. The Verdict backstop re-reads the log before any side effect
- **URL:** the `node -e` one-read snippet under **Verdict backstop — re-read before any merge (#2941)** in `wrap-up/auto-merge-short-circuit.md` (`confirmFromFile("$PIPELINE_RUN_DIR/decisions.md", [N])`)
- **Action:** Only when Layer 2's verdict was `auto-merge` — a `needs-human` verdict skips the backstop and goes straight to "Any layer fails", whose own line is already the record. Before acceptance labeling and before the ledger-deletion commit, the run re-reads `decisions.md` and gets `N=1 latest=auto-merge`, or anything else (`N=0`, a missing line, a non-zero exit, an `error=` suffix).
- **Should feel:** Mechanical and boring — a check that cannot be talked past by the agent's own narration.
- **Should understand:** Only `N=1` proceeds. The latest verdict line for this record wins (a later `needs-human` overrides an earlier pass), another record's line never counts (`#29` never satisfies `#2941`), and the post-merge `Fast-lane auto-merge:` line never satisfies the pre-merge check. Only a real log-decision entry counts: each line is parsed with `log-decision/append.js`'s `parseEntry` and the verdict must open the entry's action, so a `/review` or `/reflect` narrative line that merely quotes the marker never satisfies it. A pass must also match the whole entry the writer emits: a pass line with extra text after the verdict, or one cut short mid-write, prints `latest=unparsed` and does not proceed. A pass line whose `Reversibility:` carries a parenthesized note — `Reversibility: n/a (a policy read, not a code mutation).`, the form `log-decision.js` accepts — still confirms, with or without a `[lever: …]` suffix. The note may hold periods and nested parens, but never the sequence `). `: `Reversibility: n/a (x). trailing narrative (y).` prints `latest=unparsed`, because a tail riding behind a note must not relax the merge gate (#3870).
- **Red flags:** A noted pass line printing `latest=unparsed` (the reader has drifted from the writer's note grammar again), or a noted line with narrative after its closing `).` printing `latest=auto-merge` (the tail guard regressed). `latest=none` with an `error=` suffix (carried into the refusal line as `, error: …`) — the run dir or `decisions.md` path is wrong, not Layer 2 skipped; fix the path before trusting the refusal's cause. A merge whose only `#N … verdict auto-merge` text sits inside a narrative line rather than an `Auto-merge short-circuit:` entry — the anchoring has regressed.

### 3a. Confirmed — the merge proceeds, re-checked at the merge call
- **URL:** the branch openers ("run the Verdict backstop above first") on the `pr-first` branch (before `_shared/pr-first-merge.md`), the `local-merge` branch (before `close-run` and `git merge --no-ff`), and the dispatch-call `local-merge` relay (before `OUTCOME: ready-to-merge`)
- **Action:** Acceptance labeling and ledger deletion run, then each merging branch re-runs the same check immediately before its own merge call or relay, and merges.
- **Should feel:** Identical to the fast lane before #2941 — no added prompts, no added waits.
- **Should understand:** A dispatched singleton under `local-merge` relays `ready-to-merge` to `dispatch/settle-and-merge.md`'s local-merge fallback, which re-runs the same module and accepts the singleton's `Auto-merge short-circuit:` marker.
- **Red flags:** A singleton relayed as `ready-to-merge` that the dispatching session then refuses with `=0` despite a pass line being present — the two paths have drifted on the marker text.

### 3b. Not confirmed — the run refuses and falls through to the console
- **URL:** `node "${CLAUDE_PLUGIN_ROOT}/bin/log-decision.js" … --text "#{n} merge-check verdict not confirmed in decisions.md (latest: {latest}{detail}) — treated as needs-human, Review Console renders normally"`
- **Action:** The run logs the refusal (and does not also write a fabricated `assess-agent-autonomy verdict needs-human` line), skips acceptance labeling, ledger deletion, and the merge, and renders the Review Console normally.
- **Should feel:** Safe and legible — the record is exactly where a real `needs-human` would have left it, and the refusal line says why.
- **Should understand:** The refusal line carries both `merge-check` and `needs-human`, so `bin/console-resolve.js`'s `needsHumanVerdict` resolves the merge half to `leave-open` even under `consoleAutoResolve`. `{detail}` is `, error: {error}` when `decisions.md` was unreadable, `, snippet exited {code} with no output` when the check crashed, and empty otherwise — so the morning reader can tell a broken path or a crash from a Layer 2 that never ran.
- **Red flags:** A posted Verification Brief or `demo:pending` label on a record whose run refused — the backstop ran after the pass branch's side effects instead of before them.

## Origin
- Created during build of #2941
- Steps 1-3b built in this session
- Related specs: #2429 (bundle-path backstop this ports), #2853 / PR #2938 (the incident)
- Updated during build of #3870: Step 2 now covers a noted `Reversibility:` on the pass line, which confirms, and a tail after the note, which is rejected. Both are pinned in `tests/bin-lib/dispatch/merge-verdict.test.js`.
