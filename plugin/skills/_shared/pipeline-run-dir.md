# Pipeline Run Directory Resolution — Shared

Operational reference for skills that need to locate the active pipeline run directory. Ownership is split three ways. **`_shared/run-dir-resolution.md` owns the Resolution order and its Bash snippet** (#2019, extracted so a call site needing only those can compose a bundle under the 40 KB ceiling) — the canonical, complete ordered algorithm for finding the active run, cited by step number from `/capture`, `/tidy`'s `scan-procedures.md`, `flow/materialize.md`, and `_shared/auto-decision-log.md`. **This file owns `resolve-run-dir`'s CLI reference, Anchoring (write-pinning, guards), and the Worktree-local `--run` fallback.** `auto-mode-contract.md`'s "Pipeline run directory: location and collision-safety" section owns everything around both — directory structure, collision-safety rationale, cleanup/archival lifecycle, and gitignore treatment — and does not restate the ordering. Consult that section for anything not covered here.

**Not the hook-side algorithm.** Hooks cannot see a skill's spec/topic, so `bin/lib/hooks/context.js`'s `resolveRun` answers a different question with different rules (ownership-scoped, no slug matching — see CLAUDE.md's Hooks section). A change to the order below does not change hook behavior, and vice versa.

## Resolution order — moved

Moved to `_shared/run-dir-resolution.md`'s "Resolution order" section (#2019), alongside the
Bash snippet that implements it. Read there.

## Resolving it: `resolve-run-dir` (preferred over composing `$RUN_ROOT` by hand)

`node "${CLAUDE_PLUGIN_ROOT}/bin/hooks.js" resolve-run-dir [--spec-slug <s>] [--mode auto] [--standalone <name>] [--create] [--root-only]`
(`bin/lib/hooks/run-dir-resolve.js`) implements steps 1, 2, and 4 above on top of
`bin/lib/hooks/worktree-detect.js`'s `mainCheckoutRoot()` — the same anchoring the Bash snippet
below computes, but as a single command every citing skill step calls instead of restating that
snippet inline (`[IL-127]`: a restated, hand-typed copy is exactly how the anchoring rule got
read and then violated in the incident this command exists to prevent). Prints the resolved
absolute path on stdout and exits `0`; exits non-zero with a message on stderr naming the problem
when nothing resolves, or when `PIPELINE_RUN_DIR` (or a candidate) resolves inside a linked
worktree instead of the main checkout — a shadow, the exact `[IL-127]` shape, refused loudly
rather than silently substituted. Never creates a directory unless `--create` is passed.

- No flags: steps 1-2 only (env var, then newest matching directory for `--spec-slug`). This is
  the read-only "where is the run I already have" call most steps need.
- `--create` with `--spec-slug <s>` and no `--standalone`: the plain mkdir-only mint shape
  `/flow` (`flow/steps-and-gates.md` case 4), `/claude-tweaks:dispatch` (`dispatch/SKILL.md` Step
  4), and `flow/claim-targets.md`'s direct-invocation mint use — `config.yml`/`decisions.md` are
  written later, by whichever step actually initializes the run.
- `--create` with `--standalone <name>`: step 4's standalone-auto-fallback shape —
  `{ISO-timestamp}-{name}-standalone/`, pre-populated with `decisions.md` and `staged/`. Pass
  `--mode auto` too when the caller is on the standalone-auto allowlist above (the command then
  refuses to create outside auto mode); omit `--mode` entirely for a caller that creates in every
  mode regardless — the two documented exceptions, `/claude-tweaks:wrap-up` and
  `/claude-tweaks:release`, each with its own clause above.
- `--root-only`: skips run resolution entirely and prints the anchored `$RUN_ROOT` itself — for a
  call site that only ever needed the main-checkout root (a `find` backstop scoped to the whole
  `pipelines/` tree, the transitional copy-out guard's destination computation), never a specific
  run's directory.

## Anchoring

Run directories live under the **main checkout's** `.claude-tweaks/pipelines/`, never a
linked worktree's. Resolve the root once, before any path is built:

```bash
RUN_ROOT=$(git rev-parse --git-common-dir)
RUN_ROOT=$(cd "$(dirname "$RUN_ROOT")" && pwd)
```

Resolved from the main checkout, `$RUN_ROOT` lands on the repo root and nothing changes —
the raw `--git-common-dir` output varies with cwd (`.git` at the root, `../../.git` from a
subdirectory), but the `cd`+`pwd` above normalizes either form to the same absolute path.
Resolved from inside a linked worktree, it lands on the main checkout instead. Every path
below is built from `$RUN_ROOT`, not from the current directory.

Two consequences, both load-bearing:

- **A worktree never holds the only copy** of `config.yml`, `decisions.md`,
  `events.jsonl` or `staged/`. Removing a worktree therefore cannot destroy pipeline
  state, which is what makes automatic reaping (`bin/lib/hooks/worktree-reap.js`, fired from
  `session-start.js`) safe. Run directories that predate anchoring are the one exception, and
  `skills/wrap-up/cleanup-procedures-execution.md` Section C step 3.5 carries the transitional guard that
  copies them out before a worktree is removed.
- **`work/{n}-spec.md` is the exception** and stays inside the worktree. It is git-tracked
  and must be committed onto the feature branch; it reaches the main checkout by merge.
- **A `*-tidy-standalone*` run's own audit files are the second exception (#1493)** — under
  `pr-first`, `decisions.md`, `report.md`, and `staged/**` are copied into the worktree's own
  copy of the run dir (`tidy/SKILL.md` Step 7.5) and committed there, the same shape as
  `work/{n}-spec.md` above; the `$RUN_ROOT` copies stay authoritative until the tidy PR merges.
  A `*-sweep-standalone*` run shares this exact exception (#1494) — sweep's Step 1 runs tidy
  inside its shared run dir, so the same Step 7.5 copy-then-commit lands the identical residue.

**The staged-file invariant.** A staged proposal (`_shared/staged-patch.md`'s Artifact
format — a review/reflect/test-fix/deepen-collapse `.patch`) lives at the **absolute**
anchored path under `$RUN_ROOT/.claude-tweaks/pipelines/{run-id}/…/staged/`, never at a
worktree-relative shadow — the same rule as the bullet above, restated as its own
paragraph because a curation judge (`wrap-up/curation-engine.md` §3/§4) runs inside the
worktree by necessity, so a path resolved relatively from that cwd is the *default*
failure mode there, not agent carelessness. The staging-time `git apply --check` gate
(`_shared/staged-patch.md`'s Staging-time gate) and the judge's own `test -f`
self-verification (`curation-engine.md` §4) both check against this same anchored path
before anything is logged as staged; the post-fan-out shadow sweep (`curation-engine.md`
§4) is the routine remedy for a staged file that ends up in the shadow anyway.

The `worktree-always` PreToolUse gate permits writes to `work/{n}-spec.md` from anywhere — see
the one exemption in `_shared/policy-schema.md`. That exemption is file-write-only, so a
`git commit` issued from the main checkout is still denied.

**The hook-level exemption above is necessary but not sufficient.** The Edit/Write/NotebookEdit
tools apply their own cross-checkout write-pinning refusal for a path under the shared main
checkout, independent of and not covered by the `worktree-always` hook exemption — a session
isolated to this worktree can still see an Edit/Write attempt against `decisions.md`,
`staged/*.md`, `manifest.yml`, or any other file under a resolved run directory refused outright.
When that happens, use `bin/log-decision.js` (`_shared/auto-decision-log.md`'s canonical
appender) for a `decisions.md` entry, or `bin/stage-item.js` for a new staged file; `bin/set-config.js`
writes a `config.yml` policy lever (`--run <run-dir> --key <lever> --value <value>`, or the
`--run <run-dir> --set <key1>=<value1>,...` batch form that writes every lever in one call,
refs #1376/#1580) the same way — none of the three are
subject to this tool-level pinning, and all work identically from a worktree session or the
main checkout. Reach for `bin/set-config.js` rather than a hand-rolled `sed -i` on `config.yml`
even from a Bash call: a `sed -i` target built from a shell variable set in an earlier command
(`"$RUN_DIR/config.yml"`) is unresolvable to the gate's own path-exemption check, since the gate
matches the literal command text and only substitutes a variable it sees assigned in that same
command — and unresolvable means the write is silently allowed unguarded, not denied —
`policy-schema-coverage.md`'s "A shell-variable path is unresolvable by construction, and
unresolvable means unguarded, not denied" note has the full mechanism.

A second, unconditional PreToolUse guard (`bin/lib/hooks/pre-tool-use.js`'s
`checkPipelineShadowGuard`, not gated on `worktree-always`) denies the opposite direction: an
Edit/Write/NotebookEdit or Bash write/mkdir that would CREATE a *new* `.claude-tweaks/pipelines/`
run directory inside a linked worktree — a shadow, the exact split this file's Anchoring section
exists to prevent. It flags only a genuinely new creation; a pre-anchoring run directory already
sitting in a worktree (`wrap-up/cleanup-procedures-execution.md` Section C step 3.5's transitional guard,
sunset 2026-11-07) is left alone.

**`work/{n}-spec.md` carve-out (#959).** The guard takes the first path segment under `pipelines/`
as the run-dir candidate and, before this fix, denied whenever that directory did not already
exist in the worktree — with no exception for the tracked `work/` path the paragraph above
documents, so even the sanctioned `bin/materialize.js` route needed its own separate anchoring fix
(below) to reach the write at all. `shadowPipelineRunDir` now checks the candidate's tail against
`WORK_SPEC_TAIL_RE` — `work[/{n}-spec.md]` or the multi-record `spec-{slug}/work[/{n}-spec.md]` —
and allows it regardless of whether the run-id directory pre-exists, so a normal `Write` tool call
or a `mkdir -p … && cat > …` heredoc now reaches the file directly, the same as `bin/materialize.js`
does. The carve-out is narrow by construction (`tests/hooks-pipeline-shadow-guard.test.js`'s `#959`
cases pin both the positive shapes and the negative controls — any other file under `work/`, one
level deeper than `work/`, or elsewhere in the run dir is still denied). Do not work around a
denial outside this one documented shape by writing the blob via git plumbing
(`hash-object`/`update-index`/`commit`) — that tunnels under every PreToolUse gate at once rather
than satisfying any of them (see the matching Don't in `docs/donts.md`).

A third guard sits at the **CLI-argument boundary** — the one path neither of the two above
covers, a run directory handed to a binary explicitly on the command line rather than inherited
or created. Four shapes live at this boundary — the first two split by whether the binary has a
documented legitimate run directory outside the repository, the third carried by the
sanctioned-write family, the fourth a single documented exception:

- **Pipeline-owned binaries** — `bin/hooks.js` (`resolveRunArg`, `--run`), `bin/wrap-up-engine.js`
  (`main`, `--run-dir`), `bin/materialize.js` (`run`, `--run-dir`), and `bin/apply-refine-labels.js`
  (`--run`) — have no such use: each resolves `mainCheckoutRoot()`/`isAnchoredUnderRoot()` from
  `bin/lib/hooks/worktree-detect.js` and refuses any value not anchored under the main checkout
  **before any filesystem write**, with exit code 2 (malformed invocation). `bin/hooks.js`'s
  `resolveRunArg` carries the one narrow exception to this rule — see **Worktree-local `--run`
  fallback (#280)** immediately below.

### Initialized-run-dir requirement (#1566)

Anchoring under the main checkout is necessary but not sufficient — `resolveRunArg`'s plain
anchored-directory branch also requires the resolved `--run` value to already be an
**initialized** run dir (carrying at least one of `decisions.md`/`run-state.json`/`config.yml`,
the same bar the `#280` fallback below already applied to its own narrower case). A real, anchored,
but wholly empty directory (a stray `--run .` from a bare repo root, a caller bug interpolating
`$RUN_ROOT` instead of the run dir) is rejected rather than silently accepted and written to.

Two of the 8 shared callers opt out of this requirement via `resolveOpts.allowUninitialized`:
**`record-worktree`**, the sole legitimate first-writer in the dispatch mint-then-claim handoff
(`dispatch/SKILL.md` Step 4 mkdir-only mints a run dir, `flow/steps-and-gates.md` case 2 adopts it
with no `config.yml` yet, `worktree-setup.md` Step 4.5's `record-worktree` call performs the actual
first write into it); and **`archive-run`**, whose own downstream logic reports a stale,
never-claimed mint with a specific orphaned-mint-sweep pointer rather than a generic rejection.
That opt-in is narrower than it sounds: an uninitialized target must also sit under
`.claude-tweaks/pipelines/` at a run-id-shaped path (the same bar the `#280` fallback below already
enforces) — without this, `allowUninitialized` would itself reopen `--run .`/`--run $RUN_ROOT`
against the main checkout root for exactly the two callers licensed to skip the initialization
check. The other 6 callers (`record-pr`, `spec-status`, `close-run`, `teardown-run`,
`check-resume-freshness`, `check-staged-inventory`) always target an already-initialized run dir in
real use, so they keep the default.

### Worktree-local `--run` fallback (#280)

`resolveRunArg` (`bin/hooks.js`, shared by `record-worktree`, `record-pr`, `spec-status`,
`close-run`, `teardown-run`, `check-resume-freshness`, `check-staged-inventory`, and `archive-run`
— every CLI verb an explicit `--run <dir>` reaches) adds one narrow exception to the
unanchored-rejection rule above.
It exists for the harness-isolation incident this record documents (flow run
`2026-08-09T140101-spec-262`): a session whose
harness refuses every write to the main checkout for the whole session has no anchored run
directory to name at all — its run dir was legitimately initialized worktree-local as the only
available option, and without this exception `--run "$RUN_DIR"` for that run can never resolve
(`record-worktree` prints `worktree not recorded` and E1 enforcement never binds).

The gating signal that separates this from an ordinary stray worktree-local directory is
**containment and initialization, not mere existence**: a `--run` candidate is adopted only
when (a) it resolves inside a linked worktree *of this same repo* — not an arbitrary directory,
and not an unrelated repo's checkout (`#1183`: an earlier version of this check verified none of
this, so any directory carrying a stray marker file was adopted); (b) that path, relative to the
worktree's own `.claude-tweaks/pipelines/`, has a run-id-shaped segment in the position that names
the run — the leading segment ordinarily, or the segment immediately after `archive/` for an
archived shadow (the same `RUN_ID_RE` shape `context.js`'s run-dir enumeration,
`iterRunDirsWithState`, uses to distinguish a real pipeline run dir from an arbitrary directory);
(c) it is already an **initialized** run dir — carries at least one of `decisions.md`,
`run-state.json`, or `config.yml`, the same bar every other resolver in this file uses to tell a
real run from a bare `mkdir`; and (d) no directory exists at the *same pipelines-relative path*
under the main checkout, which would make that copy the authoritative one instead (`#1183`: this
used to compare only the directory's basename, so a nested multi-spec shadow
(`pipelines/{parent}/spec-N`) or an archived shadow (`pipelines/archive/{id}`) computed the wrong
main-checkout candidate and was adopted even though the anchored copy existed at the correct
nested/archived path). An `archive/{id}` shadow is also checked against a *live*, non-archived
copy of the same run-id under the main checkout — a run can be live under one id while a
worktree-local session independently archived its own local copy under the same id, and checking
only the archived path would miss that (`#1183` fix-wave). The mirror direction holds too: a
*live*-shape shadow (no `archive/` prefix) is checked against an **archived** copy of the same
run-id under the main checkout — a run can be archived at the main checkout while a worktree-local
session independently kept or re-created a live copy under the same id, and checking only the
live-to-live path would miss that (`#1299`). Both twin-checks are ORed into the same condition (d):
a shadow is refused when *any* of the three main-checkout candidates — same pipelines-relative
path, live twin, archived twin — exists. A bare `mkdir` of a worktree-local pipelines path (the [IL-96]/[IL-127]
shadow shape `checkPipelineShadowGuard` exists to prevent, above) fails condition (c) and is
rejected exactly as before — an ordinary run with no worktree-local run dir at all can never
spuriously match this fallback, satisfying the "blocked vs. absent" distinction the record's
Deliverables call for. `record-worktree`'s stdout names the fallback explicitly (`resolved via
the worktree-local fallback (#280)`) rather than reporting it identically to the ordinary
anchored path, so the degraded state (this run's audit trail lives only in the worktree until
merge) is diagnosable, not silent.

**Scoped to `resolveRunArg` only — not mirrored into `bin/lib/hooks/context.js`'s
`resolveRunDir`/`resolveRun`.** That function answers a different question (this file's header
note above): an *implicit* fallback scan across every run dir for hook-event attribution, with no
caller-named target to validate against. `resolveRunArg`'s fallback is deliberately narrow because
it validates a single, explicitly-named candidate the caller already believes is theirs; the same
logic applied to `resolveRun`'s broad scan would mean every hook event silently widens its search
to a second directory tree on every invocation, for a scenario (harness-blocked main-checkout
writes) `resolveRun`'s callers have no way to detect or react to differently than the ordinary
case. If a future incident shows hook-event attribution needs the same recovery path, it should
be evaluated on its own — mirroring this fallback verbatim would import `resolveRunArg`'s
single-candidate assumption into a many-candidate scan without re-deriving whether its safety
argument still holds there.
- **Resolver CLIs with a documented sandbox use** — `bin/resolve-profile.js` (`--run-dir`) and
  `bin/resolve-policy.js` (`--run`), whose journey and test invocations legitimately point outside
  any checkout (`docs/journeys/resolve-dispatch-model-profile.md`'s `/tmp/mp-journey`) — apply the
  **anchored-or-outside** rule via `worktree-detect.js`'s `checkRunDirAnchoredOrOutside()`: a
  resolved path inside any git checkout must be anchored under the main checkout resolved from
  cwd; a path outside any checkout is accepted as-is, no flag needed. Rejection exits 1, these
  CLIs' documented invocation-failure code — a deliberate, stated deviation from the family's
  exit 2.

- **Sanctioned-write CLIs** — `bin/log-decision.js`, `bin/stage-item.js`, and `bin/set-config.js`
  (`--run`, refs #1376) — the run-dir writers a worktree-isolated session invokes when tool-level
  pinning refuses the run dir (see the tool-level pinning note above). Each applies the same
  strict anchored-under-the-main-checkout rule, but through `bin/lib/stage-item/write.js`'s
  exported `resolveTarget` rather than `worktree-detect.js` directly, and refuses with exit **3**
  — their documented run-dir-failure code, kept distinct from their exit 2 (malformed
  invocation), with its own two messages ("run dir does not exist" versus "not anchored under
  the main checkout (a worktree-local shadow)"). A fourth writer imports that `resolveTarget`
  rather than re-deriving the predicate.

- **The composer CLI** — `bin/compose-context.js` (`--run`, #1988) — writes
  `{run}/context/{step}.md` yet takes the resolver family's anchored-or-outside rule
  (`bin/lib/run-dir-guard.js`'s `anchoredOrOutsideMessage`) rather than the sanctioned-writer
  strict rule, and rejects with exit **2**, its malformed-invocation code, not 3. Deliberate, and
  narrower than it looks: its callers never branch on a run-dir code — a skill step's documented
  fallback on any non-zero exit is to read the named source files directly
  (`docs/skill-authoring.md`'s "Conditional blocks and the composer") — and its tests run the real
  binary against tmp-root fixtures outside any checkout, the same documented outside-repo use the
  two resolver CLIs have. A fifth writer copying it inherits that reasoning only if its own callers
  share it; otherwise the sanctioned-writer family above is the default.

The first two rules keep the two failure modes distinct in the message — "resolves outside the main
checkout" (a worktree-relative shadow) versus "could not determine the git repository root" (no
repo at all); collapsing them sends a reader hunting for the wrong problem — and both are
existence-independent (the walk-up runs against whichever ancestor directory exists), so they
hold for a path about to be created as well as one that already exists. The run-directory
argument reaches the check through the CLI's own `deps` seam where the binary has one — a guard
added later that reads `process.cwd()` or `worktree-detect` directly re-opens the hole the seam
exists to close — a rule scoped to the pipeline-owned binaries above: the two resolver CLIs have
no run-dir/cwd `deps` seam at all (their injectable seams serve policy-resolution, not path
handling), so their guard calls `worktree-detect` directly and their tests spawn the real binary
against real fixture repos instead. **A new `bin/*.js` that accepts a run-directory argument owes one of these two
guards** (`[IL-127]`) — the strict rule by default; anchored-or-outside only when a documented
legitimate outside-repo use exists, as it did for the two resolver CLIs (#1065).

`resolve-run-dir` above mirrors the snippet in `_shared/run-dir-resolution.md`'s "Bash snippet
(resolution)" section; a citing skill step calls the command, not that snippet directly.

## Bash snippet (resolution) — moved

Moved to `_shared/run-dir-resolution.md`'s "Bash snippet (resolution)" section (#2019), alongside
the Resolution order it implements — including the ISO-timestamp rule and SPEC_SLUG conventions.
Read there.

## See also

- `_shared/run-dir-resolution.md` — Resolution order, Bash snippet, ISO-timestamp rule, SPEC_SLUG conventions
- `_shared/auto-mode-contract.md` — full spec (directory layout, lifecycle, archive rules)
- `_shared/auto-decision-log.md` — log entry format for `decisions.md`
