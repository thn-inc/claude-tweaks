# Focus Mode — candidate-driven scoping

Referenced from `skills/code-health/SKILL.md`'s "Focus Mode" section. This file owns the full procedure for `focus=<vertical>` runs — the candidate-driven alternative to `next-slice` directory rotation. It replaces SKILL.md Steps 1, 3, and 4 only. SKILL.md Step 2 (gather open issues) is **run by this procedure**, at F0 below — not skipped — and Steps 5 (JUDGE) onward are unmodified and apply exactly as written once this procedure hands off a criterion and a set of already-read candidate files.

## Known values

The generator registry is the single source of truth for which `focus=` values are recognized — never hand-maintain a separate list here or in SKILL.md, since a list restated in two places drifts (IL-40):

```bash
node -e "const {FOCUS_GENERATORS}=require('${CLAUDE_PLUGIN_ROOT}/bin/lib/code-health/focus-generators.js'); console.log(Object.keys(FOCUS_GENERATORS).join(', '))"
```

If `$ARGUMENTS` names a `focus=` value not in that list, fail loud and stop — report the unrecognized value and the known values printed above. Do not guess or silently fall back to the generalist mode.

`focus=` and `--area` are mutually exclusive. If `$ARGUMENTS` carries both, fail loud and stop the same way — do not pick one and proceed, since the two name incompatible scoping strategies and either choice silently discards half of what was asked for.

## Coverage

Every generator is a heuristic pre-filter, never an inventory. Its candidate set is deliberately partial in ways its own module header enumerates — for `dead-code`, the Coverage block at the top of `bin/lib/code-health/candidates-dead-code.js` (JS/TS only, the CommonJS `module.exports = { ... }` shorthand-brace shape only, identifier-bounded bare-symbol reference search, specifier-name-based orphan detection, dynamic patterns out of scope by construction). For `experiment-cleanup`, the Coverage block at the top of `bin/lib/code-health/candidates-experiment-cleanup.js` (pattern-driven only — no opinion about a flag idiom beyond the configured `experiment-flag-patterns`; JS/TS only; a brace-depth guard-block scan that does not resolve `else if` chains or ternaries; text-window heuristics for the registry/dated-comment signals). For `security-hardening`, the Coverage block at the top of `bin/lib/code-health/candidates-security-hardening.js` (JS/TS only; "client-side" and "route/handler" are both directory-name path heuristics, so a repo whose client or API code lives outside the recognized directory names is invisible to the relevant check; secret detection is pattern-based against known provider key shapes; ownership/auth/rate-limit/spend-guard detection is a bounded text-window co-occurrence check, not a structural/AST-aware analysis, so it can only flag apparent absence, never verify a present guard is correct). Read the relevant block before reporting anything about a run's reach, and state the boundary rather than implying totality: "the generator found N candidates under its stated coverage," never "the repo has N dead exports" (IL-110). An empty candidate set is evidence about the generator's coverage, not a clean bill of health for the repo.

This section names one vertical's generator specifically, so it is per-vertical prose exactly like the Criterion-pinning table below, and carries the same must-update rule: every new `FOCUS_GENERATORS` key owes this section a pointer to its own generator's Coverage block, or that focus firing reports a reach it never had.

## Criterion pinning

Each focus pins one or more criteria (see below) — no `classify`/`criteriaForArea` call, since focus-mode candidates are scattered across the whole repo rather than confined to one classified area:

| Focus | Criterion id(s) | Fragment |
|---|---|---|
| `dead-code` | `dead-code` | none (`fragment: null` in `criteria.js` — judge from SKILL.md Step 5's guidance alone, same as any other `fragment: null` criterion) |
| `abstraction-police` | `architecture-depth` | `criteria-architecture-depth.md` — its "Cross-file calibration (duplicate abstractions)" section, added specifically for this focus |
| `test-hygiene` | `missing-tests`, `test-quality` | `criteria-missing-tests.md` (for `missing-tests`); none for `test-quality` (`fragment: null`) — judge `coverage-gap` candidates against `missing-tests`, `useless-test` candidates against `test-quality`, per each candidate's own `kind` |
| `experiment-cleanup` | `experiment-cleanup` | `criteria-experiment-cleanup.md` |
| `security-hardening` | `security-hardening` | `criteria-security-hardening.md` |

This table is per-vertical data, not a second copy of the registry's key list: a generator carries no criterion field, so the mapping has to live somewhere and this is its only home. It must gain a row whenever `FOCUS_GENERATORS` gains a key. A `focus=` value the registry recognizes but this table has no row for is the same fail-loud stop as an unrecognized value — report the gap and stop rather than falling back to `criteriaForArea`.

Most foci pin exactly one criterion. A focus MAY pin more than one (comma-separated in the table's Criterion id(s) column) when the vertical's candidate stream mixes two genuinely different judgment questions that don't share a criterion — `test-hygiene` above is the shipped example (coverage-gap candidates need `missing-tests`; useless-test candidates need the pre-existing `test-quality`). F4 hands the judge every criterion pinned for the fired focus, each with its own fragment (if any) embedded per SKILL.md Step 4's convention; a candidate is judged only against the criterion matching its own `kind`, never against every pinned criterion indiscriminately.

Look each pinned criterion up via `getCriterion` (`bin/lib/code-health/criteria.js`) rather than hand-copying its fields, exactly as SKILL.md Step 4 already does for the generalist path:

```bash
node -e "const {getCriterion}=require('${CLAUDE_PLUGIN_ROOT}/bin/lib/code-health/criteria.js'); console.log(JSON.stringify(getCriterion('dead-code')))"
```

## F0 — Gather open issues (SKILL.md Step 2, unchanged)

Before anything below, run **SKILL.md Step 2 (GATHER OPEN ISSUES) exactly as written**, populating `ISSUES_FILE` (this run's session-scoped `code-health-open.json`, `_shared/session-tmp-root.md`) — the `gh issue list` query, the `extractFingerprint` parse, the `_shared/health-issue-index.md` transport rules, and the digest-mode fold all apply verbatim. Focus mode replaces Steps 1, 3, and 4; it never replaces Step 2.

This is a sequencing requirement, not a formality. `ISSUES_FILE` is the only input to Step 8's `validate-findings --issues "$ISSUES_FILE"` dedup against GitHub. Leave it unset and dedup falls back to the local cache alone — which a Routine's fresh container recreates empty on every firing, so a focus routine re-files the same issues every single run.

## F1 — Run the generator

`$FOCUS` and `$ROOT` are passed as `process.argv` arguments after `--`, never spliced into the JS source itself — a `--root` value containing a single quote (a realistic path like `O'Brien's-repo`) would otherwise break out of a string literal. Resolve this run's session-scoped destination first (`_shared/session-tmp-root.md`):

```bash
eval "$(node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" CODE_HEALTH_FOCUS_SCAN=code-health-focus-scan.json)"
node -e "
const { FOCUS_GENERATORS } = require('${CLAUDE_PLUGIN_ROOT}/bin/lib/code-health/focus-generators.js');
const focus = process.argv[1];
const root = process.argv[2];
const gen = FOCUS_GENERATORS[focus];
if (!gen) {
  console.error('focus-mode: unrecognized focus: ' + focus + '. Known values: ' + Object.keys(FOCUS_GENERATORS).join(', '));
  process.exit(1);
}
console.log(JSON.stringify(gen(root)));
" -- "$FOCUS" "${ROOT:-$PWD}" > "$CODE_HEALTH_FOCUS_SCAN"
```

The `if (!gen)` guard makes the documented "an unrecognized `focus=` value fails loud, naming the known values" contract self-enforcing here, rather than depending on the "Known values" lookup above having actually been run first — if `$FOCUS` is somehow still unrecognized when F1 fires, this reports the same known-values list and exits non-zero instead of throwing a raw `TypeError` out of `gen(...)`.

Read `$CODE_HEALTH_FOCUS_SCAN`. It is `{ candidates, scannedFiles, skippedFiles, discoveryFailed, discoveryReason? }` — always the rich shape, never the bare `candidatesDeadCode(rootDir, opts) → [...]` array (that narrower signature exists too, for direct unit testing, but this wiring always goes through the registry's richer generator function so scan coverage is always reportable, per the zero-candidates contract below). `scannedFiles` is a count of every tracked source file the scan considered; `skippedFiles` is an array of `{ file, reason }` naming the subset it then skipped, so `scannedFiles - skippedFiles.length` is what was actually examined. `discoveryFailed` is `true` only when file discovery itself errored (see F2); `discoveryReason` is present only then. Each candidate is `{ file, kind, evidence }` plus a `symbol` on the `unreferenced-export` kind.

## F2 — Zero candidates is a clean no-op, not an error

Check `discoveryFailed` first. If it is `true`, file discovery itself errored (git timeout, permission denied, repo corruption, non-git root, or output past the discovery call's `maxBuffer`) — this is NOT a clean tree, and `scannedFiles: 0` here means "discovery never ran," not "nothing to scan." Report exactly:

```
focus=<vertical>: discovery failed: <discoveryReason>
```

and stop. Do not write a clean no-op run record for this case — it is a scan failure needing investigation, not a firing to log and move past.

Otherwise, if `candidates` is an empty array, this firing is done. Do not treat it as a failure and do not retry. A generator MAY set `noIdiomConfigured: true` on its rich result to report a vertical-specific no-op message instead of the generic one below — `experiment-cleanup` does this (`bin/lib/code-health/candidates-experiment-cleanup.js`): when `experiment-flag-patterns` is empty/absent, report exactly `focus=experiment-cleanup: no flag idiom configured — set experiment-flag-patterns to enable` and stop, never falling back to a whole-repo scan (IL-115: absence of configuration is not a resolution failure). Otherwise, for a generator with no `noIdiomConfigured` carve-out (or one that ran but still found nothing), report exactly:

```
focus=<vertical>: no candidates this firing (scanned: <scannedFiles> files, skipped: <skippedFiles.length>)
```

For `experiment-cleanup` specifically, once patterns ARE configured, report `sitesMatched` and `flagsMatched` alongside the standard counts — "patterns configured but missing the repo's real idiom" is `sitesMatched: 0`, distinct from "sites found, none decided" (`sitesMatched` > 0, `candidates: []`).

Write the run record via the same convention the generalist run already uses (Step 8's `validate-findings` with an empty findings array, `--slice "focus:<vertical>"`, so the run-log entry exists) and stop. Reporting both counts is what makes a genuinely clean tree distinguishable from a silent total skip (IL-115) — `discoveryFailed: false` with `scannedFiles: 0` is what makes that a legitimately empty tracked tree rather than a broken scan wearing the same sentinel.

Both counts are reported the same way on a **non-empty** firing too — they are the focus-mode substitute for the slice-coverage line SKILL.md Step 10 asks for. This section only fixes their wording; they always come from F1's output.

## F3 — Read candidate files

Stamp the freshness marker first, exactly as SKILL.md Step 3 does for the generalist path — Step 7.5 is unmodified under focus mode and reads this marker, and a missing marker makes its `find -newer` check silently pass every finding. Resolve the session-scoped marker path the same way (`_shared/session-tmp-root.md`):

```bash
eval "$(node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" CODE_HEALTH_READ_MARKER=code-health-read-marker)"
touch "$CODE_HEALTH_READ_MARKER"
```

Then, for every distinct `file` named across `candidates`, read it in full under SKILL.md Step 3's existing 60 KB read-budget discipline — the byte-tracking, the bounded-read fallback past budget, and the "never silently skip, report deferred" rule all apply unchanged.

**The budget can still be exhausted on a large enough repo, and that should be said when it happens.** A generator's candidate set is repo-wide, not slice-sized, so a repo with many genuine candidates can outgrow the 60 KB budget even without noise. Because candidates arrive sorted file-then-symbol, a deferred tail is an *alphabetical* tail, not a low-value one: a run's genuine finding can sort past the cutoff and never reach the judge at all. Measured on this repo (2026-08, after `isGlobDiscoveredTestFile` excluded glob-discovered test files from orphan-file candidacy — `docs/plans/2026-08-09-code-health-focus-mode-dead-code-ledger.md` item #1): `focus=dead-code` returns 9 candidates, well inside the budget — the 219-candidate/~99%-test-file-noise problem this repo hit before that fix is resolved, not merely worked around.

Report every deferred file per Step 3's rule and per Step 10 whenever the budget IS exhausted, and never present a focus firing's findings as coverage of the candidate set: the judge saw the files that were actually read, not the ones the generator named.

## F4 — Judge

Hand the judge: the criterion pinned above (with its fragment, if any, embedded per SKILL.md Step 4's existing convention), and the candidate list itself as the material to judge — each candidate's `file`, `symbol` (if present), `kind`, and `evidence` field is a starting pointer, not a finding. The judge still applies the criterion holistically (SKILL.md Step 5) and may reject a candidate outright — a candidate the judge rejects files nothing. Continue at SKILL.md Step 6 (EMIT FINDINGS) exactly as written — including its `areaId` definition, which focus mode does **not** override.

**`areaId` is the candidate file's directory, never the file itself.** Emit `path.dirname(file)` relative to root — `bin/lib` for `bin/lib/color.js`, `.` for a root-level file. That is exactly what the generalist path emits for the same file: `classify`'s `areaId` is the directory-shaped slice id (`bin`, `bin/lib`, `bin/lib/issues` — see `bin/lib/code-health/scope.js`'s `splitOversized`), and SKILL.md Step 6 already specifies `areaId` as "directory path relative to root".

Getting this wrong forks dedup. `areaId` is one of the three fingerprint inputs (`criterion + areaId + normalizeAnchor(anchor)` — `bin/lib/code-health/fingerprint.js`), so a file-shaped `areaId` gives one real finding two different fingerprints depending on which mode found it: `dead-code` at `bin/lib/color.js#dim` files twice, and a `wontfix` suppression recorded under one mode's fingerprint is invisible to the other.

## F5 — Everything from Step 7 onward is unmodified

VERIFY GATE, FRESHNESS RE-CHECK, VALIDATE/FINGERPRINT/DEDUP, FILE/REOPEN, and SUMMARIZE all run exactly as SKILL.md documents them. Use `--slice "focus:<vertical>"` as the `SLICE_ID` for Step 8's `validate-findings` call — a stable, non-colliding cursor key distinct from every directory-shaped generalist slice id.

`SLICE_ID` and `areaId` are two different identities and must not be reconciled. `SLICE_ID` is a **cursor key only**: it names this firing's scope, is never hashed, and never reaches a finding. `areaId` is per-finding, travels into the fingerprint, and must match what the generalist path would emit for the same file (F4). Do not substitute `focus:<vertical>` for `areaId`, and do not substitute a directory for `SLICE_ID`.

## Cursor neutrality

A focus firing never touches `next-slice`'s rotation cursor or content-hash state — those belong to the generalist path and are keyed by directory-shaped slice ids, never by `focus:<vertical>`. Nothing in this procedure calls `next-slice`, so there is nothing to accidentally advance. `validate-findings` does record a cursor entry under the `focus:<vertical>` key itself, which is the point: that key names no real directory, so `next-slice`'s rotation — which only ever considers ids returned by `listSlices` — never sees it and never has its own ordering perturbed by it.

## Routine framing

A focus-mode routine sweeps the generator's whole repo-wide candidate set on every firing, rather than one directory slice per firing. Two consequences a generalist routine does not have:

- **Cost does not self-limit.** There is no `--budget` knob holding a firing to one slice (SKILL.md's `## Input`: `--budget` has no consumer under focus mode, since Step 1 is skipped). What bounds a firing is the generator's own candidate count and F3's 60 KB read budget — so a focus routine's cost tracks the repo, not a fixed sip.
- **Nothing goes stale-then-due.** There is no rotation to fall behind, so a skipped firing costs nothing but a delay: the next one re-derives the same candidate set from scratch. Dedup against open `by:code-health` issues (F0, running SKILL.md Step 2) is what keeps a repeatedly-derived candidate from re-filing — which is exactly why F0 is not optional on a routine firing.

No shipped routine template sets a `focus` field today — see `skills/_shared/routine-template-schema.md`.
