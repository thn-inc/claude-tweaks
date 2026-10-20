---
name: run-directory-fact-packs
description: Use when adding a fact pack for a pipeline phase, adding a probe to an existing one, or changing what a skill's prose reads out of one — the anchored read-only CLI, the per-field {ok, value | error} envelope, the 0/2/3 exit vocabulary, and the location/freshness/phase trace every field owes before it is written. Keywords - fact pack, pack.js, preflight.js, wrap-up-pack, flow-preflight, probe, envelope, run dir, anchored, degraded field, consumer timing.
---

# Run-Directory Fact Packs

A fact pack replaces N ad-hoc reads scattered through a skill's prose with one deterministic
process: a CLI gathers everything that phase needs, writes one JSON document into the run dir,
and the prose reads fields out of it. The runner owns execution and bounding; the skill owns
judgment. Three are shipped — `plugin/bin/lib/wrap-up/pack.js` + `plugin/bin/wrap-up-pack.js`
(wrap-up Phases 3-4, eight probes), `plugin/bin/lib/flow/preflight.js` +
`plugin/bin/flow-preflight.js` (`/flow`'s second call) and
`plugin/bin/lib/release-preflight/pack.js` + `plugin/bin/release-preflight.js`
(release preflight, eight probes) — and they agree on every rule below except
selective-probe filtering (see the `--only` bullet), the preamble-failure
envelope and the timeout-kill label (see their own bullets), the last two of
which exactly one of the three implements.
Read them before writing a fourth.

## The shape

- **Module and CLI split.** The gathering module (`lib/<phase>/pack.js`) exports `gatherPack`-style
  entry points and a `PROBE_NAMES` list; the `bin/` CLI owns argument parsing, anchoring and the
  exit code. Every fs read, git call and subprocess goes through `deps` so tests inject fakes —
  the injectable-runner rules in `gh-api-module-pattern` apply here unchanged.
- **Per-field envelope, per-field degradation.** Each probe returns `{ok, value}` or `{ok: false,
  error}`. A probe that fails degrades its own field and nothing else; the pack is still produced.
  This is why the CLI exits 0 "whenever the pack was produced" — a BLOCKED freshness verdict or an
  unavailable `gh` is *data the skill acts on*, never an exit code.
- **The preamble is inside the envelope too — but only one pack implements it today.** A gather's
  setup stage (policy, root, branch, tip ref) runs before any probe, so a throw there has no field
  of its own to degrade and the per-field rule above does not reach it. `release-preflight/pack.js`
  catches it and substitutes a `preamble failed: …` thrower for *every* selected probe, so the pack
  is still written at exit 0 with `branch`/`tipRef` null (its "Ruling 13" comment); #2422's fix
  added a real `throw` to `prepare()` and is safe only because of it. `wrap-up/pack.js`'s
  `resolveInputs` call is uncaught — a preamble throw there exits 1. A fourth pack copies the former.
- **A subprocess the exec bound kills degrades its field with an error naming the timeout — but
  only one pack implements it today.** All three bound every subprocess at `EXEC_OPTS`'s 30000 ms,
  and Node reports that kill as the generic `Command failed: …`, which reads in the degraded field
  as a crash: it hid a residue probe running within 0.5 s of its bound (#3479). `wrap-up/pack.js`'s
  `execBounded` routes every `deps.execFile` call through `shared-primitives.js`'s `isTimeoutError`
  and rethrows `timeout after 30000ms: node residue.js (killed by SIGTERM)` with the original error
  as `cause`; any other rejection (`ENOENT` for gh-absent, a maxBuffer overflow) passes through
  unchanged. `flow/preflight.js` and `release-preflight/pack.js` still surface `Command failed:`.
  A fourth pack copies `execBounded`.
- **Exit vocabulary: 0 / 2 / 3 for decided outcomes, no 1 among them.** 0 the pack was produced, 2
  malformed invocation, 3 the `--run` directory (or `--json`'s parent) does not resolve under the
  main checkout. Both CLIs get the anchoring predicate by importing `lib/stage-item/write.js`'s
  `resolveTarget` rather than re-deriving it, and both decide on the *real* path ([IL-127],
  [IL-150]). This is the sanctioned-writer vocabulary, and a fourth pack must not invent a
  decided-outcome 1. An **undecided crash** — a throw that reaches the top level instead of one of
  those three decided outcomes — is exit 1 on all three packs; a fourth pack's top-level handler
  should follow the same convention rather than inventing its own.
- **Read-only apart from the pack file**, and say so in the header. Nothing in a pack releases a
  claim, archives, posts, or edits a record — a pack is re-runnable at any point in the phase.
- **Write atomically** (`lib/atomic-write.js`), because a consumer may be reading the previous
  pack while this one is written.
- **`--only <probe,...>`** so a consumer that needs one field does not pay for eight —
  `wrap-up-pack.js`/`pack.js` and `release-preflight.js` only; `flow-preflight.js` has no `--only` flag, and
  `flow/preflight.js`'s `gatherPreflight` computes every probe unconditionally regardless of
  `--steps` (its own parse-error text calls `--steps` "metadata — every field is computed
  regardless"), since `/flow`'s second call always needs the full set. An empty list after
  filtering (`--only ,`) is a usage error (exit 2) on both CLIs that accept the flag — it asks for
  zero probes, and gathering every probe instead would silently answer a different question than
  the one asked. A subset pack produced as a stand-in for a skipped phase (a `cleanup-only` run
  skips Phase 3) must name the probes its later readers consume: a present pack with a missing key
  reads as that reader's failure path, not as an absent file. `cleanup-procedures-execution.md`'s
  production step therefore runs `--only claim` (item 7's `pack.claim`), not `--only ledger`
  (#3399's final review).
- **`--print <probe>`** (`wrap-up-pack.js` only, #2544/#2546) is `--only` narrowed to one probe with
  a different stdout: just that probe's `{ok, value | error}` envelope, so a prose step reads one
  field without dumping the whole pack and extracting it by hand
  (`plugin/skills/wrap-up/summary-template.md`'s `--print state` is the shipped call site). It
  still writes the pack file, and that file now holds only the one probe — so a `--print` run
  replaces an existing full pack with a one-probe subset, exactly as `--only` does. Call it only
  when the pack file is absent, or accept that later readers fall back per the absent-field rule
  below. An unknown probe name, or combining it with `--only`, is a usage error (exit 2).
- **A pack proposes; it never decides.** Any field an engine or a forge will later own — a version,
  a merge state, a PR number — is labelled a *proposal* in the consumer's prose, is re-read from
  that engine after the engine acts, and the reconciliation is written **once**, at the consumer,
  never per use site. `release-preflight`'s `proposedVersion` is the shipped instance (#2256): the
  pack never fetches, release-please reads config the pack does not, and a sibling release can land
  between the gather and the engine's run, so the pack's number is the *gating* version and the
  engine's return is the *shipped* one (`plugin/skills/release/execute.md`'s "Two versions"
  section). Treating the proposal as the number to verify and to book cost two fix waves on one
  confusion; this is the freshness question of the next section asked one level up — not "is the
  value stale?" but "whose value is it?".
- **A list of ids a probe aggregates across several files is file-qualified at the aggregation.**
  Row numbers, line numbers and item ids restart in each file, so a bare `["2","3","4","5"]` from
  one file cannot be told from another file's rows with the same numbers. `wrap-up/pack.js`'s
  `ledgerProbe` (#3327) merges every candidate ledger's `deferredUnstagedItems` and emits
  `{file}#{id}`; the first version emitted bare ids, and the whole-branch review read a live pack
  whose ids belonged to an unrelated ledger while a second counted file also had rows 2-5. Qualify
  where the files are merged, keep the per-file parser returning bare ids, and pin it with a
  two-file fixture whose ids collide.
- **A shared directory's "whose file is this" rule has one definition, used by the probe that reads
  and the writer that mutates.** `docs/plans/` holds inherited ledgers beside the run's own;
  `ledgerProbe` filtered by ownership (#2887) while `resolveLedgerPath` still treated a lone
  `*-ledger.md` as the run's, so a flip or delete could hit another run's record (#3566).
  `wrap-up/ledger-ownership.js`'s `ownedPlansFiles` is now the one definition, and the writer fails
  closed (`unattributable`) when ownership cannot be computed. A new reader or writer of such a
  directory imports it rather than re-deriving a filename heuristic.

## Every field owes a location, a freshness, and a phase — traced before it is written

This is the expensive rule; it cost #1930 three fix rounds and two removed probes. For each
proposed field, answer three questions against the code, at plan-authoring time:

1. **Where does this data live at gather time?** Not where it lives conceptually. #1930's records
   probe read `work/`, which never exists in the main-checkout run dir.
   - **Multi-spec per-spec dirs.** A `{parent-run-id}/spec-{N}/` dir carries its own `status`, but
     the run's shared `worktree` and `pr` stamps live on the **parent** run dir, because run-dir
     enumeration is top-level only (`context.js` `iterRunDirsWithState`).
   - **Reading the stamps.** Call `hooks/context.js`'s `readRunStateWithParent(runDir)` (#2858). It
     reads per-spec first, then fills a missing `worktree`, `pr` or `prExempt` field by field from
     the parent, behind the `spec-` basename gate. Pass `requireRunIdParent: true` to also require
     a run-id-shaped parent, the same rule `perSpecPathspec` uses. `wrap-up/pack.js`
     `resolveState`, `wrap-up/engine-verify.js` `resolvePrNumber` and
     `pr-bookkeeping/precondition.js` all read through it, so do not hand-roll another copy. The
     parent's PR-early degrade line in `decisions.md` is not part of the helper:
     `precondition.js` reads it itself from the returned `parentRunDir`.
   - **A stamp the close clears.** `closeRunState` nulls `worktree` and keeps the prior path as
     `worktreeAtClose` (#3023). A reader that runs after close-run, such as `engine-verify.js`'s
     `worktree-removed`, falls back to `worktreeAtClose`, its own and then the parent's. Reading
     `worktree` alone there sees `null` and skips the check.
   - **A stamp scoped to the run, not the call.** `dispatched: true` is written only by
     `plugin/bin/hooks.js record-worktree --dispatch` and is permanent for the run's lifetime (a
     plain re-stamp never clears it), so it says /dispatch once bound this run, never that the
     current call is one of dispatch's Task calls: a human resuming a dispatched run inherits it.
     For the per-call question, call `plugin/bin/lib/dispatch/task-call.js`'s
     `isDispatchTaskCallForRun` (#3711) rather than re-deriving it; it compares the
     `--dispatch`-only `dispatchSessionId` against `CLAUDE_CODE_SESSION_ID`. Its fallback to
     `sessionId` when `dispatchSessionId` is absent (a run state older than the field) is sound
     only because `--dispatch` writes the key on every path, `null` when there is no session id.
     #3711's first build omitted it in that case, which sent new run states down the legacy branch
     until review caught it. A reader that falls back on a stamp's absence owes the same check of
     every writer of that stamp.
   - **A file the parent writes with a placeholder value.** A multi-spec parent run dir (one
     holding `manifest.yml`) has its own `console.json`, but its `merge.resolution` always reads
     `leave-open` (`members-unresolved`): the parent-level call has no members, and
     `flow/multispec-review-console.md` discards that value. `engine-verify.js`'s
     `consoleMergeResolution` therefore returns `null` when `manifest.yml` is present (#3373), so a
     parent dir never downgrades a teardown fail to the pending-review skip. Before keying behavior
     off a run-dir file, list which writer produces it in each run shape (single-spec, per-spec
     `spec-{N}/`, multi-spec parent) and whether that writer's value is authoritative there.
   - **A location teardown removes.** A materialized spec header is committed in the worktree only,
     so before merge it lives in the worktree's mirror of the run dir, not in the main checkout's
     `work/`; `pack.js`'s `resolveRecords` reads own `work/`, then that mirror (#3365). A reader
     that runs after cleanup removes the worktree, such as `engine-verify.js`'s `carrier-commit`,
     cannot re-read it. So the Review Console's step 11 persists the set while the mirror still
     exists (`set-verify-expectations.js --issues`, or the `issues` key of `finish-console`'s
     payload under Approve all), and verify falls back to
     `verify-expectations.json`'s `issues` when no header resolves. When a location is gone by the
     time a late reader runs, persist a copy from an earlier step instead of re-reading.
   - **Why it matters.** #2664's first trace got this wrong by following the writers alone.
2. **Does the consumer mandate a freshness step first?** `mergeSize` was dropped from the wrap-up
   pack because its consumer must measure *after its own fetch* — a pre-gathered value is stale by
   construction.
3. **Does the consumer run before or after the gather?** `release` was dropped because its consumer
   runs post-merge; the pack is gathered pre-merge.

A field failing any of the three is not a pack field. Plan and code will agree with each other
regardless — the defect surfaces only when the pack is run against a real run directory, so run it
against one before the review does.

**A probe that classifies a run's stage from what the run dir already holds owes a list of every
writer that runs before it.** `flow/preflight.js`'s `computeAdoption` reads a run dir holding no
more than a fresh mint as case 2 (fresh) and anything more as case 3 (repair with backfills). Each
compliant step that logs into `decisions.md` before Step 3 reads it has made a fresh run look like
a repair. Step 2.8's claim lines did it first (#2861, fixed by recognising those lines through
`log-decision/claim-log.js`). Step 1.8's ledger line did it again (#3242, fixed for a dispatched
call 1 by keying on the `dispatched: true` marker `/dispatch` already stamps in `run-state.json`,
with a recorded `pr` keeping the call-2 repair in case 3). A direct, non-dispatched `/flow` run
still reaches case 3 on that same line, and open #3036 moves the writer after the probe. A
recogniser of known lines has to grow with every new early writer; a stamp the writer already sets,
or moving the writer after the probe, does not. List the pre-gather writers when the probe is
planned, and give each one a test fixture that holds its output (`tests/bin-lib/flow/preflight.test.js`'s
`CLAIM_ONLY` and `CLAIM_AND_LEDGER`).

## The prose half

- **Every field needs a named prose consumer.** A field nothing reads is context nobody spends;
  #1930 walked the pack field-by-field and cut the ones with no reader.
- **Every field read carries an absent-file fallback.** The pack may be missing (an older run, a
  `--only` subset, a degraded probe), so each reading sentence states what the skill does without
  it — never "read `pack.residue`" with no else-branch.
- **Live where liveness matters.** A field whose value can change between gather and use is read
  live at the point of use, not out of the pack. Say which fields those are.
- **Pin the literals to one source.** Where the pack carries note text or adoption-case wording the
  prose quotes, that text lives in the module (`flow/preflight.js` owns the five adoption-case note
  literals) and a conformance test pins the prose against it — not two copies drifting.
- **A filter every reader must apply is a field the pack owes.** When a field is usable only under a
  condition, compute the filtered value in the module and expose it as its own field for readers to
  cite. `inputs.records` names this run's closing records only when `inputs.sources.records` is
  `headers` or `worktree-headers` (#3365's Ruling R1); a manifest rung names sibling specs, whose
  PR-body line is `Refs`, not `Fixes`. #3365 needed that gate at four readers and wrote it by hand
  into three (`engine-verify.js`'s `HEADER_SOURCES`, `cleanup-procedures-execution.md`'s Section C
  step 2, `review-console.md`'s step 11); review found `execution-and-verification.md`'s
  current-branch `Fixes` set reading the field without it. Before adding a reader of a conditional
  field, check whether the pack exposes the filtered value; if it does not, add that field rather
  than restate the condition. #3399 did so: `inputs.closingRecords` (`pack.js`'s `closingRecords`,
  empty on a manifest rung) is now what `engine-verify.js` and the prose readers cite, and
  `HEADER_SOURCES` and the hand-written clauses are gone. Its sibling `inputs.parkedAtShaping`
  (record number to boolean, `{}` on a manifest rung) answers the location-teardown question above:
  the pack reads the header while the worktree mirror still exists, so Section E's late restore
  reads no file. `tests/wrap-up-record-resolution-conformance.test.js` pins that no
  `plugin/skills/wrap-up/*.md` file restates the gate.

## When to use

- Adding a fact pack for a pipeline phase, or a probe to an existing one.
- Changing which pack field a skill's prose reads, or removing a field.
- Reviewing a plan that proposes a pack: check every proposed field against the three questions.

## When not to use

- A single read a single sentence needs — one `node -e` or one `git` call is not a pack.
- Anything that mutates. A pack is read-only; a writer belongs with the sanctioned writers
  (`log-decision.js`, `stage-item.js`, `set-config.js`, `set-verify-expectations.js`, `write-run-artifact.js`).

## Origin

Derived at wrap-up from the multi-spec run that shipped #1930 (`wrap-up-pack.js`) and #1931
(`flow-preflight.js`) — ledger rows 52 and 56 of
`docs/plans/2026-09-05-spec-1921-…-1929-ledger.md`.
