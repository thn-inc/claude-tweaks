# Curation Engine — the Phase 2 mechanism

Loaded by `/claude-tweaks:wrap-up` Phase 2 (ROUTE). Owns the plan/record/render invocation sequence, the judgment-payload contract, the parallel-dispatch rule, the vocabulary rule, and the prose fallback. Together with SKILL.md's registry table, this file is the **only** prose copy of the mechanism — a judge file never restates a gate, a scope cap, or a `SCANNED` format, and nothing here re-states a judgment criterion that belongs to a judge.

## 1. What the engine owns vs. what the model owns

| Owned by the engine (`bin/wrap-up-engine.js` + `bin/lib/wrap-up/`) | Owned by the model |
|---|---|
| Gate evaluation — which registry rows are open, and the plain-language reason each is open or closed | Reading the candidate files the worklist row points at |
| Scope selection — the cap, the fast-lane narrowing, the `--skill-budget` / `--doc-budget` override, the journey frontmatter overlap, the renamed/deleted target set | Judging those candidates against the row's judge file |
| Row ordering — registry order, always every row, always in the same sequence | Deciding, per finding, whether it is applied or staged (within the precondition in section 3) |
| The `SCANNED` audit line for every row, open and closed alike | Applying an approved edit in the working tree (a judge) — committed serially by the controller's serial-commit pass (section 4), never by the judge |
| Outcome telemetry (`.claude-tweaks/wrap-up-outcomes.tsv`) | Emitting exactly one `record` payload per open row |
| The Phase 2 phase-trace table and the Review Console's engine-fed sections | Nothing about formatting — the model never composes a trace row or a `SCANNED` line by hand |

A closed row needs no model involvement at all: `plan` pre-resolves it to `n/a`, writes its `SCANNED` line, and its telemetry entry, before the model reads anything. The model records **only** open rows.

## 2. Invocation sequence

**Step 1 — `plan`, once, at Phase 2 entry.** Signals come from Phase 1's reflection and ledger outputs; no program can compute them, so the model supplies them.

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/wrap-up-engine.js" plan \
  --run-dir "$PIPELINE_RUN_DIR" \
  --base "$BASE_SHA" \
  --ceremony "$CEREMONY_PROFILE" \
  --signals '{"dontCandidate":false,"contradictedConvention":false,"incidentRecorded":false,"adrCandidateCount":0,"d4Count":0,"d5Count":0}'
```

(Substitute the re-resolved run-dir path — env assignments do not survive between calls.)

`--run-dir` and `--base` are required; `--ceremony` defaults to `standard` (`fast-lane` narrows the domain-overlap caps). `--skill-budget n` and `--doc-budget n` override those caps outright. `--dry-run` suppresses the telemetry append. `plan` prints the worklist JSON on stdout and writes `engine-state.json` into the run dir.

Signal keys, all optional (absent reads as zero/false):

| Key | Type | Meaning |
|---|---|---|
| `dontCandidate` | boolean | Reflection or the ledger produced a don't-repeat candidate |
| `contradictedConvention` | boolean | This work's diff contradicts a convention CLAUDE.md asserts |
| `incidentRecorded` | boolean | An incident account was recorded for this work |
| `adrCandidateCount` | number | Decision candidates gathered for the ADR gate |
| `d4Count` | number | Learnings `_shared/learning-routing.md` resolved to D4 |
| `d5Count` | number | Learnings it resolved to D5 |

**Step 2 — per OPEN row, in worklist order.** For each row where `gate` is `open`: read the row's `judge` file from this skill's directory, apply it to the row's `scope`, then pipe exactly one payload JSON into `record`.

```bash
printf '%s' "$PAYLOAD" | node "${CLAUDE_PLUGIN_ROOT}/bin/wrap-up-engine.js" record --run-dir "$PIPELINE_RUN_DIR"
```

`record` reads one payload JSON from stdin, validates it, appends the row's `SCANNED` line to `decisions.md` and one telemetry line, updates `engine-state.json`, and echoes the `SCANNED` line it wrote. `--dry-run` suppresses the telemetry append only. A row may be recorded once; a second payload for the same `rowId` is rejected.

**Ordering is not advisory.** `Memory` and `Upstream feedback` are judged **last**, after every earlier row has been recorded — including `Broken references`, which sits before them in registry order. Their input is the set of learnings *no earlier row claimed*, so judging them early routes a learning to memory that CLAUDE.md, a decision record, or a skill update was about to absorb.

**Step 3 — `render`, once, at the end.**

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/wrap-up-engine.js" render --run-dir "$PIPELINE_RUN_DIR" --section trace --strict
```

`--section` is `trace` (the Phase 2 table, default) or `console` (the Review Console's engine-fed sections); `--start-at n` seeds the console's global row numbering. `--strict` prints the table **first**, then exits 2 if any worklist row has no recorded result — the hole is visible *and* fatal. Insert the output verbatim; never compose it by hand.

**Exit codes.** `0` success. `1` the invocation was fine but the payload was not — a `record` payload that fails validation or does not parse, with the reason on stderr; fix the payload and re-pipe it, do not re-read usage. `2` a malformed invocation — missing or unknown flags, an unknown verb, unparseable `--signals`, or a run dir with no `engine-state.json` (meaning `plan` never ran) — plus the one deliberate exception above, `render --strict` with missing rows.

## 3. The payload contract

One payload per open row, on stdin:

```json
{
  "version": 1,
  "rowId": "skills",
  "result": "findings",
  "read": [
    { "path": "skills/upstream-drift/SKILL.md", "mode": "full" },
    { "path": "skills/browse/SKILL.md", "mode": "bounded" }
  ],
  "findings": [
    {
      "kind": "patch",
      "summary": "Record the fetch-first rule in the Gotchas table",
      "targetPath": "skills/upstream-drift/SKILL.md",
      "action": "applied",
      "stagePath": null,
      "commit": "a1b2c3d"
    }
  ],
  "gapDetection": "run",
  "detail": "Read 2: upstream-drift, browse"
}
```

| Field | Required | Contract |
|---|---|---|
| `version` | documented, not validated (reserved) | Always `1`. The engine stores named fields into a fresh object and never spreads the payload `[IL-01]`, so an unknown key is dropped, not honored. |
| `rowId` | yes | Non-empty string matching an **open**, not-yet-recorded worklist row. |
| `result` | yes | `clean` or `findings`. Nothing else validates. `n/a` is the engine's word for a closed row and is never sent by a judge. |
| `read` | no | Array of `{ path, mode }`, `mode` being `full` or `bounded`. Omitted reads as `[]` and renders as `read 0 (none)`. Send it even when the row found nothing — it is the evidence that the row was actually looked at. |
| `findings` | when `result` is `findings` | Non-empty array. Every entry is validated: `action` is `applied` or `staged`, `kind` is a non-empty string, `summary` is a non-empty string. |
| `findings[].targetPath` | in practice | The file the finding is about. Not validated, but rendered into the console table — omit it and the cell prints `undefined`. |
| `findings[].stagePath` | staged findings | The **absolute** anchored path of the `staged/` file holding the proposal, per the staged-file invariant whose single owner is `_shared/pipeline-run-dir.md`'s Anchoring section, exactly as the judge verified it with `test -f` (section 4). A relative value is a contract violation the controller rejects before `record` — see section 4. Same rendering caveat. The engine renders it as given — the console's Disposition cell shows the absolute path, deliberately, so a reader can open it from any cwd. |
| `findings[].commit` | applied findings | Short hash of the finding's own commit, written by the **controller's serial-commit pass** (section 4) after the payload returns — a judge never commits and never fills this field, and a judge-filled value is a payload violation the serial-commit pass rejects. Same rendering caveat. |
| `gapDetection` | yes | `run` or `not-run` — did this row run its missing-artifact detection, as opposed to only judging what already exists. |
| `detail` | no | One short reader-facing phrase for the trace's Detail column. Subject to section 5. |

**The `applied` precondition.** A finding may carry `"action": "applied"` only when **all** of these hold:

1. The row's `disposition` is `apply-or-stage` (`Skills`, `Docs`, `Journeys`, `Broken references`).
2. The finding is **additive** — new examples, new anti-patterns, a new section appended. Anything **restructural** — changing existing wording, moving content, renaming sections, splitting or merging files — stages.
3. `reversibility: high`.
4. `confidence: high`.

Fail any one and the finding stages. An applied finding is committed on its own — by the controller's serial-commit pass (section 4), never by the judge — which is what the `SCANNED` line's `Reversibility: high (separate commit)` asserts; the controller writes its hash into `commit`.

**These four are necessary, not sufficient.** A judge file may impose stricter conditions of its own, and clearing this precondition never overrides them — the standing example is `reference-sweep.md`, whose repairs additionally bind to the `autonomy` ceiling and the `_shared/initiative-budget.md` floor rule. When a judge's own conditions and this precondition disagree, the finding stages.

**Stage-only and stage rows.** `CLAUDE.md & rules` (`stage-only`), `Decision records`, `Memory`, and `Upstream feedback` (`stage`) emit **every** finding with `"action": "staged"`. The engine enforces this — `record` rejects an `applied` finding on a `stage`/`stage-only` row outright (`engine-record.js`'s `validateDispositionForRow`, exit 1, with a message naming the row's disposition) — and each of those judge files restates the discipline in its own header too, so a fallback run (section 6, where nothing calls `record`) honors it as well.

**The `SCANNED` line.** The engine writes it, one per row, to `decisions.md`. Reproduced here only so the prose fallback (section 6) can write it by hand:

```
SCANNED {ISO-time} — {target}: gate {open|closed} ({gateReason}); read {N} ({paths or 'none'}); gap detection: {run|not run}. Result: {clean | n/a | {A} applied, {S} staged}. Reversibility: {high (separate commit)|N/A}.
```

## 4. Parallel dispatch and the learning-capture singleton

> **Parallel execution (conditional):** When the worklist has 3+ open fact-gated rows, dispatch each row's judgment as a parallel Task agent per skills/_shared/subagent-output-contract.md, at `[Use: Capable]` — the dispatch prompt inlines the row's worklist entry, the judge file's full text, the literal payload JSON template, the `stagePath` self-verification instruction below, and the staged-patch artifact format below (with `{ABS_STAGE_DIR}` substituted); the agent returns the payload as its Template output. Signal-gated rows (Memory, Upstream feedback) always run after the fan-out completes, in the main thread. This branch is a genuine fan-out (N parallel agents) and stays Capable unconditionally — Frontier is singleton-only and structurally forbidden in a parallel fan-out (`_shared/subagent-dispatch-core.md`'s Model Selection section). Dispatch shape: single-assistant-message rule (`_shared/subagent-dispatch-core.md`'s fan-out section) applies.

**Fewer than 3 open rows — `[Use: Frontier]` singleton.** This is wrap-up's self-improvement judgment site (record #221): the main thread assembles one artifact bundle — every still-open row's worklist entry and judge-file text, the run dir's `decisions.md` and `events.jsonl`, the ledger file, and `git log` for this run's commits — and dispatches **one** Task agent (never a loop, never a parallel batch) to judge all of them in a single pass. Resolve the model via `node "${CLAUDE_PLUGIN_ROOT}/bin/resolve-profile.js" frontier --run-dir "$PIPELINE_RUN_DIR"` (degrades to Capable per the resolver's own preconditions — cap exhausted, non-interactive, or stance below `default` — logged in its `source`; this file never re-enumerates those preconditions). The dispatch structure is identical regardless of which model the resolver returns — only the model differs, never the shape of the call. The singleton returns one payload JSON per row it judged (section 3's contract, one object per open row, in worklist order); the main thread pipes each through `record` in the main thread exactly as in the fan-out branch. This is the same "learning capture and skill updates" surface `/claude-tweaks:wrap-up`'s own description names — output that compounds across every future session, which is what justifies Frontier's premium over Capable's here.

**No judge-side git mutations — the controller's serial-commit pass.** Every dispatch prompt — the fan-out and the singleton alike — inlines this instruction verbatim: *never run `git add`, `git commit`, or any other git mutation; an auto-apply-eligible finding is made as a working-tree edit only, its payload names the edited file as `targetPath`, and its `commit` field is left absent — the controller commits.* The fan-out shares one worktree, so concurrent judge commits raced on the shared git index (#1140 — observed in run 2026-08-20T153031-spec-1065: a judge reported its edit "swept into a sibling's commit" with a fabricated hash while the edit sat uncommitted in the tree). After every payload has returned and the shadow sweep below has run, and **before any `record` call**, the controller runs the serial-commit pass, one finding at a time in worklist order, for each finding with `"action": "applied"`: (1) **audit** — first check whether an earlier finding in this same pass already committed this same `targetPath`: if so, attribute that earlier commit's hash to this finding's `findings[].commit` too (and write its own `AUTO … commit: {hash}` log line) instead of auditing it as a violation — two applied findings sharing one file were swept into a single commit, which is expected, not a payload defect; otherwise run `git status --porcelain -- {targetPath}`, which must show a real modification or new file — a finding claiming `applied` over a clean path with no such earlier same-pass commit, or arriving with a judge-filled `commit`, is a payload violation: re-prompt that judge once, and if the second payload still violates, disposition it explicitly rather than leaving the edit orphaned — **DROP** it when no staged artifact exists: first run `git checkout -- {targetPath}` to revert the uncommitted edit so it is never swept into a later phase's catch-all commit, then log `AUTO {time} — {row}: applied claim failed the commit audit ({reason}); dropped. Reversibility: high.`; **DOWNGRADE** it to `staged` when a staged artifact exists: leave the working-tree edit as it stands and log `STAGED {time} — {row}: applied claim failed the commit audit ({reason}); downgraded — the edit already sits applied in the working tree, not merely pending. Reversibility: high.`; (2) **commit** — `git add {targetPath}` then `git commit` for exactly that file, one commit per finding, so the `SCANNED` line's `Reversibility: high (separate commit)` stays literally true — for a finding from the `references` row, this commit additionally carries the `Initiative-Fix: {run-id}` trailer per `_shared/initiative-budget.md`'s Commit discipline: the trailer moves with the commit to the controller, it is never dropped; (3) **attribute** — write the resulting short hash into the payload's `findings[].commit`, and write the judge file's own `AUTO … commit: {hash}` log line now (the controller is the only party that ever knows the hash). One committer, serialized, creating every hash it records: an interleaved or swept commit is structurally impossible, and so is a fabricated attribution.

**Staged-patch artifact format (both branches).** Every dispatch prompt — the fan-out and the singleton alike — inlines `_shared/staged-patch.md`'s Artifact format section verbatim: for any finding staged as a concrete file edit, the payload's staged file must open with the `Target:` / `Invariant:` / `Finding:` / `Staged-at:` preamble followed by a literal `diff --git` block — not a free-text before/after description. A description-only staged file is not the artifact format: the console's fast `git apply --check` path needs the diff bytes, and a judge that returns prose instead forces `staged-patch.md`'s slower re-derivation fallback even for a trivial single-clause insertion (#1123, observed in record #701's wrap-up: two of three Docs findings came back description-only with no `diff --git` section).

**Judge self-verification of `stagePath` (both branches).** A judge that stages a finding runs inside the worktree by necessity — it reads and edits repo files there, so a relatively-resolved path is the default failure mode, exactly as the staged-file invariant in `_shared/pipeline-run-dir.md`'s Anchoring section (its single owner) names it. Not agent carelessness — the guard here is structural. Every dispatch prompt — the fan-out and the singleton alike — inlines this instruction verbatim: *after writing a staged file, run `test -f {ABS_STAGE_DIR}/{your-file}` — where `{ABS_STAGE_DIR}` is the literal absolute `…/staged/` directory the controller substituted into this prompt before dispatch — and echo that absolute path as the finding's `stagePath`; if the test fails, move the file there and re-run it before reporting.* The controller replaces `{ABS_STAGE_DIR}` with the literal anchored path when composing each prompt — never an unexpanded `$VAR`, per `_shared/subagent-dispatch-core.md`'s Working Directory Discipline (a judge's shell does not share the dispatcher's variables). On the controller side, before piping a payload to `record`: a `stagePath` that is not absolute, or does not start with the anchored `$PIPELINE_RUN_DIR`, is a payload violation — re-prompt once (that judge, with the absolute path spelled out); if the second payload still carries a relative or unanchored value, treat the finding as **unstaged**: drop it from the payload's `findings[]` before piping (the row's `result` becomes `clean` when nothing else remains, and its `detail` names the dropped finding), log `STAGED {time} — {row}: judge returned an unanchored stagePath twice ({value}); finding surfaced unstaged. Reversibility: high.` to `decisions.md` — that STAGED line is what surfaces it (the console's Pending review grouping), since the engine-fed sections render only what `engine-state.json` holds. The row's own `SCANNED` line will then read `Result: clean` (or one finding fewer); the STAGED line carries the truth.

**Post-fan-out shadow sweep (routine, after every judged fan-out or singleton).** It runs after the agents return and **before any `record` call** — it can rewrite a payload's `stagePath` (below), and `record` must see the final value. Independently of what the payloads claim, sweep the current worktree's shadow of the run-dir path for stray staged files and relocate them to the anchored run directory — from the worktree, with `PIPELINE_RUN_DIR` set to the anchored run dir and `WORKTREE` to the worktree root:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/hooks.js" sweep-shadow --run "$PIPELINE_RUN_DIR" --worktree "$WORKTREE"
```

Same semantics documented below: `pwd -P`-style normalization on both paths, a same-path no-op when run from the main checkout (the `-ef` guard, ported), and every diagnostic line prefixed `sweep:`. One line per action on stdout — `relocated: {name}`, `collision: {name} (kept as {name}.shadow-dup[-N])`, or a `sweep: …` diagnostic — exit `0` on a clean or partial sweep, exit `1` iff any diagnostic line printed (`bin/lib/hooks/sweep-shadow.js` is the implementation; `bin/hooks.js sweep-shadow` its CLI wiring — this is a run-dir state operation, so it lives under the same `bin/hooks.js` verb dispatcher as `record-worktree`/`record-pr`/`close-run`, CLAUDE.md's Hooks section).

The sweep targets `staged/` and a stray shadow `decisions.md` (whose `- ` entry lines are appended to the anchored log; its headers are dropped, and a headers-only file is reported as `had no entries — dropped`, never as appended) only — never `work/`, whose materialized `{n}-spec.md` legitimately lives in the worktree and reaches the main checkout by merge. Log one line per relocated file to the anchored `decisions.md` — `AUTO {time} — Shadow sweep: relocated staged/{name} from the worktree shadow to the anchored run dir. Reversibility: high.` — and, when a relocated file's name matches a payload's `stagePath` basename, treat that payload's `stagePath` as the anchored path from then on. Paths are normalized with `pwd -P` (a physical-path normalization of `_shared/pipeline-run-dir.md`'s Anchoring resolution) so trailing slashes and symlinked roots cannot defeat the prefix strip, and the same-path guard uses `-ef`, so running the sweep from the main checkout (where the shadow *is* the anchored dir) is a clean no-op that never touches the anchored `staged/`. A misconfiguration is never silent: an unset or missing `PIPELINE_RUN_DIR`/`WORKTREE`, or a run dir outside `$RUN_ROOT`, prints a `sweep: … — not swept` diagnostic. Every `sweep:` diagnostic line — not swept, `FAILED to move`, `skipped … not a regular file`, `shadow staged/ not empty after sweep` — is a tooling failure with no artifact to approve, so it is never logged `STAGED`: log `AUTO {time} — Shadow sweep: {diagnostic}; fan-out treated as unswept. Reversibility: n/a.` and add a wrap-up ledger item (status `open`) naming the diagnostic, so Phase 3's nothing-left-behind gate forces a decision rather than the console rendering a pending item with nothing to apply. A well-configured no-op sweep (nothing in the shadow) prints and logs nothing. A same-basename collision (staged names are per-row counters, so a shadow write and an anchored write of the same row collide by default) never overwrites the anchored file and never leaves the artifact in the shadow: the sweep moves the shadow copy to the anchored `staged/{name}.shadow-dup` (or `.shadow-dup-1`, `-2`, … when that slot is already taken — a repeated collision never overwrites an earlier, still-pending copy) and prints `collision: {name} (kept as {name}.shadow-dup)`; a shadow entry that is not a regular file (a symlink, a directory) is never moved or read — it is skipped with a `sweep: skipped … not a regular file` diagnostic and the shadow `staged/` is left for inspection; log it as `STAGED {time} — Shadow sweep: staged/{name} existed at both the anchored run dir and the worktree shadow; shadow copy kept as staged/{name}.shadow-dup for a human decision. Reversibility: high; stage path staged/{name}.shadow-dup.` so the console renders it as a pending item with the artifact safely anchored. In a multi-spec run the sweep runs once per `spec-{N}/` run dir the fan-out wrote to, plus the parent (`multispec-batch-curation.md`'s registry pass).

The `record` calls stay in the main thread regardless of which branch ran — agents return payloads, they do not pipe them. That keeps the ordering rule in section 2 intact and keeps one writer on `engine-state.json`.

## 5. Vocabulary rule

Internal identifiers never reach rendered output. The routing codes `D0`–`D5`, the scan-mechanism names (`domain-overlap`, `gap detection`), the retired `Step 7.x` numbers, and `[route: …]` tags are engine and classifier vocabulary — a reader of the report has no way to resolve them. `renderTrace`, `renderConsoleSections`, and `renderConsoleSectionsMulti` post-check their own output against exactly that list and **throw** on a match, so a payload that smuggles one into `summary`, `detail`, or `targetPath` fails the render rather than shipping jargon.

Write those fields as a reader would say them: the target's name, what changes, why. Full detail — the routing code, the scan scope, the candidates considered and rejected, the reason a gate opened — goes to `decisions.md`, which is the audit trail and is deliberately exempt from the guard (its own `SCANNED` format contains `gap detection:` by design).

## 6. Prose fallback

**When the engine fails for any reason, execute this same mechanism manually.** This is unconditional and takes no diagnosis `[IL-14]`: enumerate the failure modes and the enumeration will be missing one.

1. Walk SKILL.md's registry table top to bottom, in the order printed there.
2. Evaluate each row's gate by the condition stated in that table. A closed row resolves to `n/a` with the stated reason.
3. For each open row, apply its judge file to its scope — using the table's own cap where one is stated, narrowed under `fast-lane`.
4. Write the row's `SCANNED` line by hand in the section 3 format, into `decisions.md`.
5. Compose the phase-trace row by hand: `| {target} | {n/a | Clean | {n} applied | {n} staged | {a} applied, {s} staged} | {detail} |`.
6. Honor sections 3 and 5 unchanged — the stage-only-rows check and the vocabulary rule are engine-enforced; the remaining three clauses of the applied precondition (additive-only, reversibility, confidence) are judgment-only and not engine-validated — under the fallback all of them bind the judge directly. The fallback runs as a single thread, so that one thread plays both roles section 1's ownership cell splits under the engine: it applies each `"action": "applied"` finding as a judge would, then commits it serially per section 4's discipline (audit, commit, attribute) — the same "never a judge-side commit" rule still holds, it is simply the same thread that steps into the controller role afterward rather than a separate committer.

**The report MUST state `(engine unavailable — prose fallback ran)` in the Phase 2 table caption.** A hand-composed trace that looks engine-produced is worse than no trace: the trace's whole value is that it is mechanical, and a reader cannot tell the two apart from the table alone.

Engine failure is never permission to skip a row. The silent skip is the failure this architecture exists to prevent; a fallback that quietly curates less than the engine would has reintroduced it.
