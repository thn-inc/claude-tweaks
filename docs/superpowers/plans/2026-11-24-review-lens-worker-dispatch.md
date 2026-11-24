# Review Lens Worker Dispatch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a third `review-lens-dispatch` value, `worker`, under which `/claude-tweaks:review` Step 3 runs lenses 3a–3e and 3g as headless `lens-reviewer` workers through `bin/review-lens-workers.js` (#6000), falls back to the Task path per lens, and settles every reply set in one `settle-lens-replies` call.

**Architecture:** `policy-schema.js` gains the enum value; `lens-dispatch.json` gains a `worker` path value; `review-coordination.js` gains one verb, `merge-lens-replies`, that folds Task-path replies (lens 3f, re-dispatched lenses) into the launcher's reply file so one `settle-lens-replies` call settles everything; the Step 3 procedure lives in a new sub-file `step3-worker-dispatch.md`, reached by one pointer paragraph in `step3-lens-dispatch.md`. The launcher runs detached and is awaited with `wait-for.js pid`, since a dispatched agent's foreground call has a 180-second ceiling and the launcher can run for up to an hour.

**Tech Stack:** Node 18+ (CommonJS), `node --test`, markdown skill prose.

**Spec:** `.claude-tweaks/pipelines/2026-11-24T061032-record-6003/work/6003-spec.md` (re-materialized with the two plan-review Decisions: question 1 Reading B — this plan's existing AC4 reading; question 2 Reading A — Task 4's stubbed-launcher test)

Scope keywords: review-lens-dispatch, merge-lens-replies

## Global Constraints

- `task` stays the default of `review-lens-dispatch`; `worker` is additive (spec Deliverable 1). Unset and any malformed value keep resolving `task`.
- Lens 3f is never sent to the launcher (#6000's launcher fails its sides with reason `excluded`); it runs on the Task path in the same review.
- The unit of fallback is the lens: only lenses with a launcher-failed side re-dispatch on the Task path; succeeded lenses are never run twice.
- The two fail-closed reply shapes (#5599 comment: a one-line `No findings` plus prose → `needsSession`; a `[skill]` tag in the severity cell → `skipped`) are not loosened and are not worker-fallback conditions.
- This repository's committed `.claude-tweaks/policy.yml` must not set `worker` in this change (spec AC6, Decision Rationale: not before #5825 rules and a release carrying the value is installed).
- `step3-lens-dispatch.md` is 49,616 B against the 52,500 B rail (`RAIL_BYTES`): it gets one pointer paragraph only (≤ 600 B, leaving ≥ 2,284 B headroom); every other new prose goes in the new sub-file.
- `_shared/policy-schema.md` is 51,604 B: its row edit adds ≤ 450 B (headroom ≥ 446 B). If the edit would pass 52,500 B, shorten the row's own wording; never cut another row.
- policy-key-addition (quoted): "State the value the resolver returns for unset, set and malformed input, from the code, not from intent." and "Changing what an existing value does needs two greps, not one." — grep `review-lens-dispatch` across `plugin/skills/`, `docs/journeys/` and `README.md`; the key has no Manifesto display name (it is not a Manifesto lever).
- policy-key-addition (quoted): "Every new key gets this decision, even when the answer is neither flag." — `review-lens-dispatch` keeps neither `policyOnly` nor `policySourceExcluded` (Step 3 resolves it with `--run`, so a run config may set `worker` for one review); `worker` adds no new route.
- skill-prose-conformance-tests / the existing workflow conformance suite's rule (quoted from `tests/review-lens-workflow-dispatch-conformance.test.js`): "Both texts are new in this change, so every go-red control mutates the live text in memory and matches the throw to its own message".
- Source-scan suites over `plugin/bin/`: file writes go through `lib/atomic-write`'s `writeFileAtomic`; existence checks through `lib/path-guard` (`lstatType`), never bare `fs.existsSync`.
- Commit messages: `{Verb} {what} — {detail}`, ending `refs #6003` (never `closes`/`fixes`).

## Review Focus

1. A launcher that prints nothing on stdout (exit 2, or killed with SIGTERM → exit 143) — the session must read that as condition `launch error`, never as an empty reply set (Task 5 conformance fact + Task 3 test of `merge-lens-replies --into` on an empty file exits 2).
2. A reply text holding JSON-hostile characters (quotes, backslashes, a NUL-free control char, a trailing newline) — `merge-lens-replies` must carry it byte-exact into the merged file (Task 3 test `merge keeps the reply text byte-exact`).
3. `--out` equal to `--into` (the second merge call reuses the merged file) — must read before it writes, atomically (Task 3 test `merge in place`).
4. A launcher reply where one side of a lens failed and the other succeeded — the whole lens re-dispatches, never a half-Task, half-worker pair (Task 3 test AC3.1 + Task 5 fact).
5. A review on a platform outside `SANDBOX_PROBED_PLATFORMS` (every side fails `platform`) — must take `every worker failed`, not settle an empty review (Task 5 fact).

---

### Task 1: `worker` value for `review-lens-dispatch`

**Role:** integration

**Files:**
- Modify: `plugin/bin/lib/policy-schema.js:91-93` (row + comments)
- Modify: `plugin/skills/_shared/policy-schema.md:162` (doc row)
- Modify: `docs/getting-started.md:59` (one clause on `worker`)
- Test: `tests/policy-schema.test.js:1183-1200`

**Interfaces:**
- Produces: `resolve-policy.js --values review-lens-dispatch` prints `worker` when policy or a run's `config.yml` sets it.

- [ ] **Step 1: Extend the existing test** `'review-lens-dispatch resolves task by default and for an invalid value, workflow when set (#5599)'`: rename it to add `, worker when set (#6003)` and add the case `['review-lens-dispatch: worker\n', 'worker']`; add a run-overlay case writing `review-lens-dispatch: worker\n` to the run's `config.yml` and asserting the `--run` read prints `worker`. Add `test('AC6.3: the review-lens-dispatch removal condition names worker and #5825', …)` reading `policy-schema.js` as text and asserting the comment block directly above the row matches `/worker/` and `/#5825/`.
- [ ] **Step 2: Run the test to verify it fails**

  Run: `node --test --test-name-pattern "review-lens-dispatch|AC6.3" tests/policy-schema.test.js`
  Expected: FAIL (`worker` resolves `task`; comment lacks `worker`).
- [ ] **Step 3: Implement** — `values: ['task', 'workflow', 'worker']`; `summary` becomes one sentence naming all three ("…parallel Task agents, one plugin workflow script, or headless lens workers (both opt-in, while measured)."). Rewrite the removal-condition comment: `worker` is a permanent third value; if #5825 flips the default to `workflow`, `worker` stays only if #6003's parked measurement record shows it cheaper than `workflow` with no fewer confirmed findings, otherwise it is removed one minor release after that ruling; an older build reading `worker` resolves `task` with a stderr warning (probed on 6.177.0). Doc row: add `worker` to the values cell with what it does (`step3-worker-dispatch.md`, headless `lens-reviewer` workers through `review-lens-workers.js`, usable inside a dispatched Task agent, darwin only today — elsewhere every review falls back to Task) and the removal sentence; keep the row's existing unset/malformed wording. getting-started: append one clause after the workflow clause: "`review-lens-dispatch: worker` runs them as headless lens workers instead, which also works inside a dispatched agent".
- [ ] **Step 4: Run** `node --test tests/policy-schema.test.js tests/policy-key-naming.test.js tests/policy-schema-metadata.test.js` — Expected: PASS. `wc -c plugin/skills/_shared/policy-schema.md` — Expected: ≤ 52500.
- [ ] **Step 5: AC evidence (AC6.1, AC6.6).**

Proof(public-contract): an installed 6.177.0 build resolves `review-lens-dispatch: worker` to `task` with one stderr warning and exit 0 (scratch-repo probe), `task`/`workflow` resolution and the workflow-path conformance suite stay green, and `lens-dispatch.json` only gains an additive `worker` path value. Write the probe output (`resolve-policy.js --values review-lens-dispatch` run by the installed `6.177.0` build in a scratch git repo whose `.claude-tweaks/policy.yml` holds `review-lens-dispatch: worker`) to `$PIPELINE_RUN_DIR/evidence/ac6-older-build.txt` with a plain Bash redirect, plus `git grep -n "review-lens-dispatch" -- .claude-tweaks/policy.yml` (expected: no match, exit 1; control: the same grep on `plugin/bin/lib/policy-schema.js` matches).

  Then log one `AC evidence` entry via `log-decision.js --text-file` citing AC6.1 and AC6.6, the command shapes and the file path.
- [ ] **Step 6: Commit** — `git add` the four files, `git commit -m "Add the worker value to review-lens-dispatch — headless lens workers, task stays default, refs #6003"`.

### Task 2: `worker` path in `lens-dispatch.json`

**Role:** integration

**Files:**
- Modify: `plugin/bin/lib/review-lens/dispatch-record.js` (`PATHS` at line 36 + header line 16)
- Modify: `plugin/bin/review-coordination.js` (the three `--path task|workflow` usage strings, lines 9, 135, 614)
- Modify: `plugin/skills/review/step3-lens-dispatch-record.md` (`--path` values)
- Modify: `docs/plugin-structure.md:75` (`PATHS task|workflow|worker`)
- Test: `tests/bin-lib/review-lens/dispatch-record.test.js`
- Test: `tests/review-lens-dispatch-record-conformance.test.js` (pins the doc's `--path` list equal to `PATHS`; no edit expected)

**Interfaces:**
- Produces: `record-lens-dispatch --path worker` accepted; `PATHS` is `['task', 'workflow', 'worker']`.

- [ ] **Step 1: Write the failing test** `test('a worker-path entry appends and reads back', …)` in `dispatch-record.test.js`: `appendLensDispatch` with `{ ...BASE, path: 'worker' }`, then `readLensDispatch` returns `state: 'ok'` holding it; and `entryProblem({ ...BASE, path: 'driver' })` names `task, workflow, worker`.
- [ ] **Step 2: Run the test to verify it fails**

  Run: `node --test tests/bin-lib/review-lens/dispatch-record.test.js`
  Expected: FAIL (`path must be one of task, workflow`).
- [ ] **Step 3: Implement** — add `'worker'` to `PATHS`; header line: `'worker' (headless lens-reviewer workers, review-lens-workers.js)`, plus one sentence that an older build reads a file holding a `worker` entry as an `error` state (history skips that run, never a crash). `step3-lens-dispatch-record.md`: command shows `--path {task|workflow|worker}`; add a `worker` bullet ("a lens `settle-lens-replies` settled from launcher replies on the worker path, `step3-worker-dispatch.md`"), and extend the `task` bullet with "and every lens the worker path sent to the Task path (3f, a re-dispatched lens, every lens after a worker fallback)".
- [ ] **Step 4: Run** `node --test tests/bin-lib/review-lens/ tests/review-lens-dispatch-record-conformance.test.js tests/bin-lib/review-coordination/cli.test.js` — Expected: PASS.
- [ ] **Step 5: Commit** — `git commit -m "Record worker-path lens dispatches — PATHS gains worker, refs #6003"`.

### Task 3: `review-coordination.js merge-lens-replies`

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/review-coordination.js` (verb, header comment, `USAGE`, dispatch line)
- Modify: `docs/plugin-structure.md:413` (verb list)
- Test: `tests/bin-lib/review-coordination/merge-lens-replies.test.js` (create)

**Interfaces:**
- Consumes: `settleInputProblem(value, file)` and `readJson` (same file).
- Produces: `node bin/review-coordination.js merge-lens-replies --out <file> --lens <id> --reviewers <1|2> --side-a <text-file|-> [--side-b <text-file|->] [--into <reply.json>]`. Reads `--into` (bare or under `result`, as `settle-lens-replies` reads it) when given; drops every `lenses`/`reviewers` entry for `--lens`; appends `{lens, reviewers}` and one `{lens, side, text, failed}` per side — `text` the file's whole content read as UTF-8 byte-exact, `failed: false`; `-` gives `text: null, failed: true`; validates the result with `settleInputProblem`; writes `{ lenses, reviewers }` to `--out` with `writeFileAtomic` (`--out` may equal `--into`); prints `{"out":…,"lenses":[…],"replaced":true|false}`. Exit 2, nothing written, on: a missing flag, `--reviewers` not 1/2, side flags not matching `--reviewers` (1 → `--side-a` only; 2 → both), an unreadable text file, an empty `--into` file or one `settleInputProblem` refuses, a lens token outside `FINDING_LENS_CLASS`.

- [ ] **Step 1: Write the failing tests** (spawn the CLI as `cli.test.js` does; fixtures via `scratchDir`):
  - `AC3.1: a failed lens is replaced whole and the others keep their worker texts` — `--into` a launcher-shaped reply (`{started:true, lenses:[3a,3b], reviewers:[3a A ok, 3a B ok, 3b A failed:true text:null, 3b B ok]}`), merge 3b from two text files; assert the 3a entries are deep-equal to the input's and 3b's two entries carry the new texts with `failed:false`.
  - `AC3.2: one settle-lens-replies call settles the merged set` — run `settle-lens-replies <out> --ctx-id t` on that output; assert exit 0 and `settled` lists `3a` and `3b`.
  - `AC7.1: a mixed review settles 3f from the Task path beside worker lenses in one call` — `--into` a reply holding only 3a, merge `--lens 3f`; one settle call settles both.
  - `merge keeps the reply text byte-exact` — a text with `"`, `\\`, a tab, CRLF and a trailing newline round-trips unchanged.
  - `merge in place` — `--out` equal to `--into`; result holds the old and new lens.
  - `- marks a failed side`; `exit 2 on mismatched sides`, `exit 2 on an empty --into`, `exit 2 on an unreadable text file` — each asserting no `--out` file exists afterwards.
- [ ] **Step 2: Run the test to verify it fails**

  Run: `node --test tests/bin-lib/review-coordination/merge-lens-replies.test.js`
  Expected: FAIL (unknown command).
- [ ] **Step 3: Implement `mergeLensReplies(rest, deps)`** beside `settleLensReplies`, flags parsed with `parseValueFlags(rest, ['--out','--lens','--reviewers','--side-a','--side-b','--into'], deps, { brief: true })`, no positionals; every refusal before any write. Add the header comment block (format as the `settle-lens-replies` block), the `USAGE` line, and `if (command === 'merge-lens-replies') return mergeLensReplies(rest, deps);`.
- [ ] **Step 4: Run** `node --test tests/bin-lib/review-coordination/ tests/path-guard-conformance.test.js tests/windows-hide-spawn-conformance.test.js` — Expected: PASS.
- [ ] **Step 5: Commit** — `git commit -m "Add merge-lens-replies — fold Task-path lens replies into one settle set, refs #6003"`.

### Task 4: Stubbed-launcher test (AC2, AC3, AC7 — spec Decision 2, Reading A)

**Role:** integration
**Review risk:** high

The spec's Decision 2 defines "a test with a stubbed launcher": the reply is produced by `plugin/bin/review-lens-workers.js` (in-process through `runCli`, `deps.runner` a fake runner — the injectable-runner seam `tests/bin-lib/driver/review-lens-workers-cli.test.js` already uses), never hand-written launcher-shaped JSON. Each reply is then fed through `merge-lens-replies` and `settle-lens-replies`. Task 3's fixture-JSON tests and Task 5's prose pins stay beside it; neither stands in for it.

**Files:**
- Test: `tests/bin-lib/review-coordination/lens-worker-launcher-settle.test.js` (create; reuse the fixture/`fakeRunner`/`deps` shapes of `tests/bin-lib/driver/review-lens-workers-cli.test.js` — copy the minimal helpers it needs, or move them to `tests/helpers/` only if both files then import them)
- Waived `plugin/bin/review-lens-workers.js`, `plugin/bin/lib/driver/lens-workers.js`: exercised, unchanged.

**Interfaces:**
- Consumes: `review-lens-workers.js` `run(argv, deps)` via `runCli` with `deps.runner`; Task 3's `merge-lens-replies`; `settle-lens-replies <file> --ctx-id <id>`.

- [ ] **Step 1: Write the tests** — four cases, each: run the launcher in-process with a fake runner answering per (lens, side) with a Template A reply text (`resultOut(text)`) or a failure (`{ code: 1, stdout: '' }` / blank text), write the launcher's stdout to a session-temp reply file, run the merge(s) the worker-path procedure (Task 5 `## Read the reply` / `## Merge`) prescribes for that reply, then one `settle-lens-replies` call (cases 3 and 4 instead show the reply reads as a whole-fallback condition; the review then completes on the existing Task path, which settles its own pairs — Task 5 `## Fallback` — so these two cases assert no merged settle):
  - `AC3.1/AC3.2: one lens failed — only that lens is merged from the Task path, one settle call settles all` — lenses 3a, 3b (2 reviewers each); the runner fails both of 3b's sides; assert the launcher reply marks only 3b failed, merge 3b from two Task-reply text files, settle exit 0 with `settled` covering 3a and 3b, and the 3a reviewer texts in the merged file are byte-equal to the launcher's (3a not run twice — the runner saw exactly 4 calls, none re-run).
  - `AC3.1: one side failed — the whole lens is replaced, never a half pair` — 3b side B only fails; merge 3b (both sides) from Task replies; settle as above.
  - `AC2.2: every side failed — the reply reads as every worker failed` — every runner call fails; assert every `reviewers[].failed` is `true` (the `every worker failed` condition), and that `settle-lens-replies` on that reply exits 0 settling nothing (every lens in `needsSession`) — why the procedure takes `every worker failed` before any settle.
  - `AC2.2: nothing on stdout — the reply reads as a launch error` — launcher exit non-zero with empty stdout (an argv refusal, e.g. a `--bundle` path that does not exist, exit 2); assert stdout is empty and `merge-lens-replies --into {that empty file}` exits 2 writing no `--out` (the `launch error` read), and `settle-lens-replies` on the same empty file exits 2.
  - `AC7.1: mixed review — 3f from the Task path beside worker lenses in one settle call` — lenses 3a, 3b on the launcher (both succeed); merge `--lens 3f --reviewers 2` from Task replies `--into` the launcher reply; one settle call settles 3a, 3b, 3f.
- [ ] **Step 2: Run** `node --test tests/bin-lib/review-coordination/lens-worker-launcher-settle.test.js` — Expected: PASS once Task 3 has landed (this task follows it; Check C: it depends on Task 3's verb, so it is not a red-first test of new production code — it proves the seam end-to-end). Prove discrimination: temporarily delete `merge-lens-replies`'s dispatch line in `review-coordination.js`, re-run and confirm every case that merges goes red, then restore the line (`git diff` on that file empty) before committing.
- [ ] **Step 3: Commit** — `git commit -m "Test the worker path end to end through a stubbed launcher — merge and one settle call, refs #6003"`.

### Task 5: Step 3 worker-path procedure

**Role:** judgment
**Review risk:** high

**Files:**
- Create: `plugin/skills/review/step3-worker-dispatch.md`
- Modify: `plugin/skills/review/step3-lens-dispatch.md:95` (one pointer paragraph, inserted immediately before the workflow pointer)
- Modify: `plugin/skills/_shared/subagent-output-contract.md:153` (one paragraph: worker-dispatched agents)
- Modify: `docs/plugin-structure.md` (review sub-file table row at line 201: `step3-worker-dispatch.md`)
- Modify: `docs/skill-graph.md` (line 593: one sentence — since #6003, the `worker` path through `review-lens-workers.js` and `merge-lens-replies`)
- Test: `tests/review-lens-workflow-dispatch-conformance.test.js` (unchanged; must stay green — AC1.1)
- Test: `tests/review-lens-worker-dispatch-conformance.test.js` (create)
- Waived `plugin/skills/review/step3-workflow-dispatch.md`: read and cited by the new sub-file (Settle, `needsSession`, Then); unchanged.
- Waived `plugin/bin/review-lens-workers.js`: read for its interface; unchanged.

**Interfaces:**
- Consumes: Task 1's `worker` value, Task 2's `--path worker`, Task 3's `merge-lens-replies`, `review-lens-workers.js --run <dir> --lenses-file <json> --cwd <worktree> --bundle <file>` (stdout: reply JSON on exit 0, nothing otherwise; stderr: `review-lens-workers: lens {lens} {side} failed: {reason}` lines), `wait-for.js pid --pid {pid} --max-seconds 150`.

The sub-file's sections and the decisions they carry (prose is the implementer's; these facts are what the test pins):
- `## When this applies` — key resolved `worker`; agent lenses 3a–3e, 3g in scope at the tier (under `adaptive`, `selected`); lens 3f always on the Task path in the same review; 3h dispatched as the Task path does; any diff size. Standalone (no run directory) the launcher cannot run (`--run` is required): use the Task path and say so in the review report; no `SKIP` line.
- `## Availability` — one plain call `command -v claude`; no output → condition `no claude binary`. Off darwin every side fails `platform` (reaches `every worker failed`).
- `## Compose` — each brief exactly as the Task path composes it, except: no `SCRATCH:` line — instead `READ-ONLY: you have no scratch path and no Write tool; create no file.`; the context bundle is inlined ahead of the brief inside `<review-context>`, so the brief says to read it there, never from disk; an elided hunk is read with `git diff --no-ext-diff --no-textconv {base}...{branch} -- '{path}'` (the role's admitted form). Model per lens via `resolve-profile.js` (`fast` 3a, `standard` 3b–3e, 3g); `reviewers` 2 at `medium`+, 1 at `low`. Resolve `L=`, `O=`, `E=`, `M=` with one `session-tmp-resolve.js` call (`review-{ctx-id}-worker-lenses.json`, `-worker-out.json`, `-worker-err.txt`, `-worker-merged.json`); `Write` `{ "lenses": [{lens, brief, model, reviewers}] }` to `{path-L}`.
- `## Start` — one Bash call: `nohup node "${CLAUDE_PLUGIN_ROOT}/bin/review-lens-workers.js" --run "$PIPELINE_RUN_DIR" --lenses-file "{path-L}" --cwd "{worktree}" --bundle "{contextPath}" > "{path-O}" 2> "{path-E}" < /dev/null & echo $!` (`{worktree}` = `git rev-parse --show-toplevel`, `{contextPath}` = `build-review-context.js`'s printed field); in the next message dispatch lens 3f's pair (and 3h when in scope) as Task agents; then wait with `wait-for.js pid --pid {pid} --max-seconds 150` (foreground, no `timeout`), windows of 20 minutes, at most 3 (60 minutes: 4 waves of the launcher's 15-minute worker ceiling at concurrency 4); at the ceiling, `kill {pid}` (its own PID only) and take `launch error` with message `wait bound reached`.
- `## Read the reply` — `{path-O}` empty or not JSON with `started: true` → `launch error` (message: `{path-E}`'s first line); every reviewer `failed: true` → `every worker failed`; some failed → re-dispatch each lens with a failed side, all of that lens's reviewers (its `reviewers` count, 1 at `low`), on the Task path (same brief as the Task path composes it), one `SKIP` line by `log-decision.js … --step "Step 3 lens dispatch (worker lens re-dispatch)"`, text `workers failed: {lens}/{side}[, …] → fallback: Task dispatch of those lenses` — its own label, never `worker fallback` (spec Plan Review Clarification), so the parked record's fallback-by-condition count holds only the four named conditions. This Task re-dispatch is the lens's one retry: a re-dispatched reviewer that itself fails is merged as `-` and goes straight to `step3-tier-variants.md`'s partner-died single-read degrade, never a second re-dispatch through the inherited `needsSession` rule.
- `## Merge` — for each Task-path lens (3f, re-dispatched): `Write` each reviewer's whole reply, verbatim, to a session-temp text file, then `merge-lens-replies --into {first: path-O, then path-M} --out "{path-M}" --lens {lens} --reviewers {n} --side-a "{file|-}" [--side-b …]` (`-` for a reviewer that failed or never replied). The settle file is `{path-M}` when anything merged, else `{path-O}`.
- `## Settle` — `step3-workflow-dispatch.md`'s Settle, `needsSession` and Then sections apply with the settle file in place of `{run-file}` and the `worker fallback` label in place of `workflow fallback`; a first-call exit 2 is condition `settle exit 2` → `## Fallback`'s Task dispatch (already-paid replies noted). The two fail-closed shapes reach `needsSession` (reviewer re-dispatch) and `skipped` exactly as on the workflow path and are never a worker-fallback condition. Record each lens settled from launcher replies `--path worker`, every Task-path lens `--path task`.
- `## Fallback` — conditions `no claude binary`, `launch error`, `every worker failed`, `settle exit 2` → whole Task dispatch of the review's lens set — the in-scope agent lenses at the tier, or `selected` under `adaptive` (never a hard-coded 3a–3g) — minus 3f and 3h when `## Start` already dispatched them (under `no claude binary`, decided before Start, 3f and 3h are in the set); the kept 3f/3h replies settle on that same Task path exactly as the Task path settles them (its own per-pair route, unchanged), never through `settle-lens-replies`; one `SKIP` line by `log-decision.js --run "$PIPELINE_RUN_DIR" --section "/review" --status SKIP --step "Step 3 lens dispatch (worker fallback)" --text-file "{path-S}" --reversibility n/a`, text `condition: {label}[: {message}] → fallback: Task lens dispatch`; the partial `workers failed` line uses its own label, `worker lens re-dispatch` (`## Read the reply`). Token and fallback counts for the parked measurement record come from `worker-dispatches.jsonl` (timing) and these `SKIP` lines.
- Pointer in `step3-lens-dispatch.md` (≤ 600 B, its own blockquote paragraph immediately before `> **Workflow dispatch (opt-in, #5599).**`): `> **Worker dispatch (opt-in, #6003).**` — when the key (already resolved once, as the workflow pointer says) prints `worker`, read `step3-worker-dispatch.md` and run lenses 3a–3e and 3g as headless `lens-reviewer` workers through `review-lens-workers.js`; read it only then.
- Contract paragraph: under `## Workflow-dispatched agents`, one paragraph: under `worker`, `review-lens-workers.js` runs each brief as a headless worker; the brief (with the bundle inlined) is the only input, the reply is the worker's free text carrying the brief's `STATUS:` line and Template A, and the model is the lens's resolved `model`; the Task dispatch stays the fallback.

- [ ] **Step 1: Write the failing conformance test** in the style of its sibling `tests/review-lens-workflow-dispatch-conformance.test.js`: `checkPointer` (anchor present, ≤ 600 B, names `step3-worker-dispatch.md` and `review-lens-workers.js`, `only when`…`worker`, sits immediately before the workflow pointer anchor) and `checkSubFile` with a `FACTS` table, each matched exactly once: the four whole-fallback labels as numbered items, the `worker fallback` log-decision command, the separate `Step 3 lens dispatch (worker lens re-dispatch)` label for a partial re-dispatch, the one-retry rule (`partner-died`), the `nohup node … review-lens-workers.js … & echo $!` start line with all four flags, `wait-for.js" pid --pid {pid} --max-seconds 150`, `command -v claude`, the `merge-lens-replies` call, `--path worker`, `Lens 3f`…`Task path`, the fail-closed sentence (`never a worker-fallback condition`), the `READ-ONLY:` brief line. Test names cite `AC2.1` (launcher call + settle), `AC2.2` (one fallback SKIP line → Task path), `AC3.1` (per-lens re-dispatch), `AC4.1` (fail-closed shapes are not fallback), `AC4.2` (every first-call settle exit 2 is the fallback condition `settle exit 2` — the `## Settle` fact naming it as a numbered whole-fallback label). AC1.1 is covered by Step 4 running the unchanged workflow-path suites. Go-red controls via `assertEachPatternGoesRed` for every fact and pointer needle, each matched to its own message.
- [ ] **Step 2: Run the test to verify it fails**

  Run: `node --test tests/review-lens-worker-dispatch-conformance.test.js`
  Expected: FAIL (file missing).
- [ ] **Step 3: Write** the sub-file, pointer, contract paragraph and the two docs lines.
- [ ] **Step 4: Run** `node --test tests/review-lens-worker-dispatch-conformance.test.js tests/review-lens-workflow-dispatch-conformance.test.js tests/review-lens-dispatch-record-conformance.test.js tests/review-procedure-bundles.test.js tests/subagent-contract-clauses.test.js tests/review-dispatch-composition.test.js` — Expected: PASS (AC1.1: the workflow-path suites unchanged and green). `wc -c plugin/skills/review/step3-lens-dispatch.md` — Expected: ≤ 50216.
- [ ] **Step 5: Commit** — `git commit -m "Add review Step 3's worker lens dispatch — headless lens workers with per-lens Task fallback, refs #6003"`.

### Task 6: Live run on the worker path (orchestrator-run)

**Role:** judgment
**Review risk:** high

Run by the orchestrating session, after Tasks 1–5, against this branch's own diff, using this worktree's `plugin/` code. AC5's probe is "a Task agent runs the review with `worker` set": the session dispatches one `general-purpose` Task agent that runs `/claude-tweaks:review` Step 3 (the pointer and `step3-worker-dispatch.md`, read from this worktree's `plugin/`) for lenses 3a–3c against a probe run directory — a fresh anchored dir under `.claude-tweaks/pipelines/` whose `config.yml` sets `review-lens-dispatch: worker`, never this run's directory, so this run's own later review is untouched. The key is resolved through the worktree's `resolve-policy.js --run {probe-dir}` and must print `worker`. The evidence records that the probe ran inside a Task agent (the dispatch itself), the agent's `command -v claude` output, and the resolved key.

**Files:**
- Test: none committed; evidence under `$PIPELINE_RUN_DIR/evidence/`.

- [ ] **Step 1: Preconditions.** Record in `$PIPELINE_RUN_DIR/evidence/worker-live.txt`: `command -v claude` output, `uname -s` (darwin required), and the expected outcome when either fails (`no claude binary` → one `worker fallback` SKIP and the Task path; non-darwin or no inherited auth → every side `platform`/`auth` → `every worker failed`).
- [ ] **Step 2: Worker run (AC5.1, AC8.1).** The probe agent builds the review context for `origin/main...HEAD` with `--run {probe-dir}`, composes medium-tier briefs for 3a (haiku), 3b, 3c (sonnet) at 2 reviewers per Task 5's Compose, runs the worktree's `review-lens-workers.js` per Task 5's Start and settles per Task 5's Settle. Evidence: the launcher's stdout/stderr, the settle output, and per-lens `firstTurnTokens`, `tokens` total and `costUsd` from `{probe-dir}/worker-dispatches.jsonl`; no `worker fallback` line in `{probe-dir}/decisions.md` (or, if one was written, its condition). Copy the evidence under `$PIPELINE_RUN_DIR/evidence/`.
- [ ] **Step 3: Paired Task run (Deliverable 4).** Dispatch the same three lenses' briefs as Task pairs (with the Task path's `SCRATCH:` line), settle them through `merge-lens-replies` + one `settle-lens-replies` call into a standalone (no `--run`) settle, and record each agent's reported total tokens and the confirmed findings per lens.
- [ ] **Step 4: AC evidence.** One `AC evidence` entry (`log-decision.js --text-file`) citing AC5.1 and AC8.1/AC8.2 (every Haiku worker under 100k total tokens, or which was over and by how much — an overrun is reported, not a failure), the evidence path, and a per-lens table line; quote the table in the PR body labelled "single sample, anecdotal".

### Task 7: Parked measurement record (orchestrator-run)

**Role:** integration

- [ ] **Step 1:** Invoke `/claude-tweaks:capture` with a spec-shaped body (Defer-reason: blocked-external; trigger: 20 worker-path reviews after this repository opts in, or 30 days; per lens pair, confirmed findings and total tokens on the worker path against the Task path, the Haiku-lens 100k ceiling, the fallback share by condition read from `worker fallback` `SKIP` lines; outcome a default-flip record or a stated reason to keep the current default; Related #6003, #5825; Key Files `plugin/skills/review/step3-worker-dispatch.md`, `plugin/bin/lib/driver/lens-workers.js`). Under `auto` capture stages it for the Review Console; AC9.1 completes when the console files it and the PR links it.

## Scope sweep (Check B)

`review-lens-dispatch` / `merge-lens-replies` also appear in files this plan leaves unchanged: `docs/journeys/run-review-lenses-through-a-workflow-5599.md` (the workflow path's journey; a worker-path journey, if any, is Common Step 6's), the historical plans/specs under `docs/superpowers/`, `docs/plans/2026-11-24-review-lens-worker-dispatch-ledger.md` (this run's ledger), `tests/fixtures/review-lens-workers/smoke-bundle.md` (an archived bundle fixture), and `plugin/skills/review/step3-workflow-dispatch.md` (cited, unchanged).

## Spec coverage map

| Spec item | Task |
|---|---|
| Deliverable 1, AC6.1–AC6.6 | Task 1 |
| Deliverable 2, AC2.1, AC7.1 | Tasks 3, 4, 5 |
| Deliverable 3, AC2.2, AC3.1, AC3.2, AC4.1 | Tasks 3, 4, 5 |
| Deliverable 4, AC5.1, AC8.1, AC8.2 | Task 6 |
| Deliverable 5, AC9.1 | Task 7 |
| AC1.1 | Task 5 Step 4 |
| Gotcha: removal-condition comment, older-build audit | Task 1 Steps 3, 5 |
| Key File `review-coordination.js` (only if needed) | Task 3 (needed: one settle call over Task + worker replies) |
| Key File `tests/` pins and rail | Tasks 1–5; the new sub-file is its own file under the rail |

Waived AC6.2: a statement of status ("permanent third value"), carried by Task 1's comment and covered by the AC6.3 test.
Waived AC6.4: a conditional future ruling recorded in Task 1's comment, covered by the AC6.3 test.
Waived AC6.5: as AC6.4.
