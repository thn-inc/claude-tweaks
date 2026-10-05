# Impeccable plugin contract fixtures

Replayed by `tests/impeccable-plugin-contract.test.js`. Contract documented in
`skills/design-wrapper/impeccable-plugin.md`.

## `signals-backend-repo.json` — frozen `gatherSignals()` output

A **real, executed** output of `gatherSignals()` from the pinned Impeccable
plugin (4.0.2), recorded against a throwaway git repository built to reproduce
the 2026-08-06 observation: a Node-only repo with no UI whose entire in-flight
diff is `.js`.

It is frozen — never re-derived from live `git diff` state — for two reasons:

1. An assertion that *this* repo currently produces N targets is a scheduled
   failure timed to the next commit (`[IL-80]`).
2. `git.changedFiles` has no injection point (see the contract doc's
   "Arguments resolution"), so a live run asserts over whatever happens to be
   uncommitted at that moment.

**What it proves.** All four `scan.targets` entries are `.js` files that
Layer 3 must reject — `.js` outside any trigger path is a documented negative
case in `frontend-detection.md`. `scan.targets` is therefore a *scannability*
predicate, not the *frontend* predicate, and cannot replace Layer 3.
`docs/notes.md` appears in `changedFiles` but not in `targets`: `.md` is
outside Impeccable's `SCANNABLE_EXT`, so the fixture records that boundary too.

**`devServer` is environment noise, not an assertion.** The recording machine
had something listening on 8080 that had nothing to do with the fixture repo.
That is preserved deliberately — it is the evidence behind the veto asymmetry
in `modes/live.md` (`running: true` proves only that *something* answered).
No test asserts on this key.

### Re-recording it

Only when the pin moves. Build a git repo with `main` plus a `feature` branch
whose diff is the five files under `git.changedFiles` above, add a
`package.json` (so `hasCode` is true) and a `PRODUCT.md` with **no** `Platform`
section (so `platform` stays `null`), then run the pinned
`gatherSignals(<repo>)` and replace this file with its output verbatim.

## `doctor.json` — frozen `impeccable-engine.js run doctor` output (record #2981)

A **real, executed** `{findings, ...}` payload (the `run doctor` envelope's
`value` field), captured on the authoring machine by copying this repo's own
`PRODUCT.md`/`DESIGN.md` into a scratch directory outside the repo (so
`resolve()` falls back to the cached user-scope 4.4.0 install rather than this
repo's own project-scope pin, which has no cached engine binary here) and
running `node plugin/bin/impeccable-engine.js run doctor` from inside it.
Every field is verbatim from that run except `projectRoot`/`repoRoot`, which
were the scratch directory's own throwaway absolute path — normalized here to
`/tmp/impeccable-doctor-capture` for readability. No test asserts on those two
fields.

Compared field-by-field against what `modes/doctor.md:142` documents and
`skills/tidy/scan-procedures.md` reads: `findings[].id`, `.severity`,
`.summary`, and `.fix` all match (`/tidy`'s `[doctor] {id} ({severity}) —
{summary} — {fix}` row), and `productPath`/`designPath`/`platform` match the
top-level keys `modes/doctor.md:71-83` documents. No shape difference found —
`tests/bin-lib/impeccable-engine/run.test.js`'s extended `validateDoctor`
tests pin exactly this shape, and `skills/tidy/scan-procedures.md` /
`step-6-auto.md` needed no restructuring, only their stray `doctor.mjs`
wording updated.

### Re-recording it

Only if the engine's `doctor` output shape changes. Copy a `PRODUCT.md`/
`DESIGN.md` pair into a scratch directory outside this repo (so `resolve()`
uses a cached install), run `node plugin/bin/impeccable-engine.js run doctor`
from inside it, and replace this file's `value` field with the fresh output —
normalizing `projectRoot`/`repoRoot` the same way.

## `cache/` — a fake plugin cache tree

Two candidates at deliberately **non-pinned** versions, laid out exactly like a
real `~/.claude/plugins/cache`:

```
cache/<marketplace>/impeccable/<version>/.claude-plugin/plugin.json
```

This is how the version-mismatch branch is exercised. Pointing the resolver's
search root here — rather than mutating, hiding, or pointing at the
developer's real `~/.claude/plugins/cache` — is the whole reason that search
root is a parameter with a default instead of a constant.

Two candidates, not one, because the mismatch reason must name **every**
version found. A single-candidate fixture would let a reason that reports only
the first one pass.
