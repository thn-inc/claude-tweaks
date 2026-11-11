---
name: verify-scope-rule-kind
description: Use when adding a rule kind or a top-level key to `.claude-tweaks/verify-scope.json` (the `impact` block and `impact: true` rules are the worked example), or adding an `impact: true` rule over a path prefix no rule covered before (`.claude/**`, `perf/**`) — lists every site the change must land in, the expand-contract rule for the committed declaration that the installed plugin build reads with older code, and the load-lazily rule for anything a rule kind reads from disk or the network. Keywords - verify-scope, declaration, rule kind, impact rule, expand-contract, readDeclaration, selectScope, lazy load, fail closed, untraced-path, first-wins, rule order.
---

# Verify-scope-rule-kind

`.claude-tweaks/verify-scope.json` is read by `plugin/bin/lib/verify/declaration.js` and acted on by
`scope.js` and `plugin/bin/verify.js`. #4024 added a rule kind (`{ "match": ..., "impact": true }`
plus a top-level `impact` block) and review found three things the build had missed, each a
site or rule that nothing wrote down. This skill is that list, so the next rule kind (or top-level
key) lands in one pass.

## The check

Before calling a new rule kind or key done, confirm each of these:

1. **Every site that reads the declaration knows the new shape.** `declaration.js` (validation and
   the parsed rule shape), `scope.js` (selection and mode), `plugin/bin/verify.js` (orchestration,
   the `report.json` fields, the stdout line, and the `verify` event's hand-listed `impact` subset
   that `plugin/bin/lib/timing/derive.js` copies into `timing.json`, pinned field-for-field by
   `tests/bin-lib/verify/impact-cli.test.js`), `plugin/skills/test/impact-selection.md` or the
   kind's own reference doc, `plugin/skills/test/verification.md`'s Re-verify scoping table with
   `tests/test-skill-affected-conformance.test.js`'s row pins, `plugin/bin/lib/init/verify-scope-starter.js`
   when `/init` should offer it, and `tests/verify-scope-declaration.test.js` for the committed file.
2. **The committed declaration stays readable by the previous release.** The installed plugin
   build reads this repo's committed `.claude-tweaks/verify-scope.json` with older code. A reader
   that predates the kind rejects a rule it does not know (for `impact`: `rules[i].suites: must be
   "*" or an array`), and `verify.js` then exits 2 for every `--scope` run. Make the new shape also
   carry the value the old reader accepts (`"suites": "*"` for an impact rule: older readers run
   everything, current ones ignore it), pin that in `tests/verify-scope-declaration.test.js`, and
   record the removal condition beside the check in `declaration.js`. Prove it by running the
   previous reader over the file: `git show {base}:plugin/bin/lib/verify/declaration.js`.
   Since #4135 `tests/verify-scope-declaration.test.js` runs that check itself: it materializes the
   newest reachable `v*` tag's `declaration.js` (plus every relative require it reaches) in a temp
   dir and fails, naming the reader's own error text, when it rejects the committed file; it skips
   with a stated reason only in a clone with no release tag.
3. **Anything the kind reads loads lazily.** A map, a fetch or a network call belongs behind a
   getter that runs only when selection reads it (`lazyImpactContext` in `plugin/bin/lib/verify/impact.js`),
   so a delta no such rule matches never pays for it; report fields for an unread input are `null`,
   not stale values. #4024's first build loaded the map, and ran `impact.fetch` (up to 120 s),
   before it knew an impact rule matched.
4. **Every unreadable or unprovable input falls back to the full command with a named reason.**
   Add the reason to the `fallback` vocabulary and to the doc's reason table in the same change.

## Adding an impact rule over a new path prefix

A rule of an existing kind adds no site, but an `impact: true` rule over a prefix outside the
source tree (#4321 added `.claude/**`, `.github/workflows/**`, `perf/**`) owes three checks:

1. **The map records reads under the prefix.** `selectImpactTests` in `plugin/bin/lib/verify/impact.js`
   falls back to the full suite as `untraced-path: {p}` for a changed path no traced read selects,
   so a rule over a prefix no test reads fails closed and saves nothing. Name the tests that read
   it before adding the rule (#4321's plan names `perf/`'s readers, such as
   `tests/wall-clock-budget-conformance.test.js`). A modified path is selected only by an `f` read
   or a covering `c` prefix; `s` and `d` select only an added or deleted one.
2. **The glob stays clear of a neighbouring prefix.** `.claude/**` does not match
   `.claude-tweaks/verify-scope.json`, but `.claude*/**` does, and rules match first-wins: the
   looser glob would turn a change to the declaration itself into an impact run instead of a full
   one, and shadow the `.claude-tweaks/pipelines/**` rule below it. Keep a neighbouring path in
   `tests/verify-scope-declaration.test.js`'s fail-closed list (it holds
   `.claude-tweaks/verify-scope.json` for this) and run that file before committing.
3. **An engine-level pin, not only a rule-shape pin.** A check that the rule exists stays green
   when an earlier rule shadows its glob. Run `selectScope` over a fixture map whose one test reads
   the new path and assert `mode: 'scoped'`, no `unmatched`, and `superseded: false`
   (`selectTracedBy` in `tests/verify-scope-declaration.test.js`).

## Anti-Patterns

| Pattern | Why It Fails |
|---|---|
| Committing a rule shape the previous release's reader rejects, because the full suite passes | Every test except the release-reader pin in `tests/verify-scope-declaration.test.js` (#4135) runs current code; a clone with no release tag skips that pin, so the break can still appear only in an installed build |
| Loading the input a rule kind reads before selection knows a rule matched | Every run pays the load (and any fetch) even when the delta never reaches that rule |
| Leaving `report.json` fields populated for a run that never read the input | A reader of the report takes stale values for what the run used |
| Adding the rule kind to `declaration.js` and `scope.js` only | `verify.js`, the docs, the Re-verify scoping table and the starter drift from the engine with every suite green |
| Treating the previous reader's rejection as a `--scope`-only break | Since #4006 a bare `verify.js --stamp-status` discovers the committed declaration too. A reader that rejects it reports `scopeError` and still exits 0, so review Step 1.5, test's Skip-if-recent and dispatch's `checkFirstCallStamp` fall back to the single-stamp verdict and lose per-suite composition and the generated-path exemption, with only that field to show for it |
| Adding a key inside an existing block (`impact`, `ci`, `concurrency`) because a new top-level block needed no compatibility value | `readDeclaration` has no unknown-key check at the top level, so an older reader ignores a new block (#4347's `ci`, #5119's `concurrency`). Each block checks its own keys (`IMPACT_KEYS`, `CI_KEYS`, `CONCURRENCY_KEYS`), so a release that knows the block rejects the committed file over one new key inside it |
