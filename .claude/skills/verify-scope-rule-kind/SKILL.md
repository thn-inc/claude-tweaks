---
name: verify-scope-rule-kind
description: Use when adding a rule kind or a top-level key to `.claude-tweaks/verify-scope.json` (the `impact` block and `impact: true` rules are the worked example) — lists every site the change must land in, the expand-contract rule for the committed declaration that the installed plugin build reads with older code, and the load-lazily rule for anything a rule kind reads from disk or the network. Keywords - verify-scope, declaration, rule kind, impact rule, expand-contract, readDeclaration, selectScope, lazy load, fail closed.
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
   the `report.json` fields, the stdout line), `plugin/skills/test/impact-selection.md` or the
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
3. **Anything the kind reads loads lazily.** A map, a fetch or a network call belongs behind a
   getter that runs only when selection reads it (`lazyImpactContext` in `plugin/bin/lib/verify/impact.js`),
   so a delta no such rule matches never pays for it; report fields for an unread input are `null`,
   not stale values. #4024's first build loaded the map, and ran `impact.fetch` (up to 120 s),
   before it knew an impact rule matched.
4. **Every unreadable or unprovable input falls back to the full command with a named reason.**
   Add the reason to the `fallback` vocabulary and to the doc's reason table in the same change.

## Anti-Patterns

| Pattern | Why It Fails |
|---|---|
| Committing a rule shape the previous release's reader rejects, because the full suite passes | The suite runs current code; nothing runs the previous reader over the committed file, so the break only appears in an installed build |
| Loading the input a rule kind reads before selection knows a rule matched | Every run pays the load (and any fetch) even when the delta never reaches that rule |
| Leaving `report.json` fields populated for a run that never read the input | A reader of the report takes stale values for what the run used |
| Adding the rule kind to `declaration.js` and `scope.js` only | `verify.js`, the docs, the Re-verify scoping table and the starter drift from the engine with every suite green |
