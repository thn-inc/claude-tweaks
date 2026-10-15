# Impeccable plugin contract fixtures

Replayed by `tests/impeccable-plugin-contract.test.js`. Contract documented in
`skills/design-wrapper/impeccable-plugin.md`.

## `signals-backend-repo.json` — frozen `impeccable-engine.js run signals` output (record #2985)

A **real, executed** output of `impeccable-engine.js run signals` — the
engine module (`plugin/bin/lib/impeccable-engine/index.js`, record #2979),
never a direct import of a retired per-mode script — recorded against a
throwaway git repository built to reproduce the 2026-08-06 observation: a
Node-only repo with no UI whose entire in-flight diff is `.js`.

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

**`devServer` is environment noise, not an assertion.** Re-recorded at #2985
with nothing listening on any of the seven probed ports, so this capture
carries `running: false, ports: []` — unlike the original 4.0.2-era capture,
whose recording machine happened to have something answering on 8080. Either
value is valid: the probe is a bare TCP connect that proves only "something
answered" or "nothing did," never whose server it was — see the veto asymmetry
in `modes/live.md`. No test asserts on this key.

### Re-recording it

Only when the pin moves. Build a git repo with `main` plus a `feature` branch
whose diff is the five files under `git.changedFiles` above, add a
`package.json` (so `hasCode` is true) and a `PRODUCT.md` with **no** `Platform`
section (so `platform` stays `null`), then from inside that repo run
`node plugin/bin/impeccable-engine.js run signals` (pointed at this repo's
own `plugin/bin/impeccable-engine.js` — the engine module resolves whichever
install is active for that working directory) and replace this file with the
envelope's `value` field verbatim.

## `doctor.json` — frozen `impeccable-engine.js run doctor` output (record #2981, re-recorded #2985)

A **real, executed** `{findings, ...}` payload (the `run doctor` envelope's
`value` field). Re-recorded at #2985 by running
`node plugin/bin/impeccable-engine.js run doctor` directly from this repo's
own root — the project-scope 4.5.0 install now has a cached engine binary
(0.1.11), so `resolve()` no longer falls back to a scratch directory outside
the repo the way the original #2981 capture needed to. Every field is
verbatim from that run except `projectRoot`/`repoRoot`, normalized here to
`/path/to/project` for readability. No test asserts on those two fields.

Compared field-by-field against what `modes/doctor.md:142` documents and
`skills/tidy/scan-procedures.md` reads: `findings[].id`, `.severity`,
`.summary`, and `.fix` all match (`/tidy`'s `[doctor] {id} ({severity}) —
{summary} — {fix}` row), and `productPath`/`designPath`/`platform` match the
top-level keys `modes/doctor.md:71-83` documents. No shape difference found —
`tests/bin-lib/impeccable-engine/run.test.js`'s extended `validateDoctor`
tests pin exactly this shape.

### Re-recording it

Only if the engine's `doctor` output shape changes. Run
`node plugin/bin/impeccable-engine.js run doctor` from this repo's own root
(or, if the active install has no cached engine binary, from a scratch
directory outside the repo carrying a copy of `PRODUCT.md`/`DESIGN.md`, so
`resolve()` falls back to a different, cached install) and replace this
file's `value` field with the fresh output — normalizing `projectRoot`/
`repoRoot` the same way.

## `concept-seed.txt` — frozen `impeccable-engine.js run concept-seed` output (record #2985)

A **real, executed** `value` field from
`node plugin/bin/impeccable-engine.js run concept-seed --scope surface`, run
from this repo's own root. **Recording this fixture contacts Impeccable's
catalog service** — the `concept-seed` verb is a network call, not a local
computation (`modes/explore.md`'s "Network side effect, load-bearing" note);
an offline or sandboxed session cannot record it. The committed text is
replayed by `validateConceptSeed()` (via `run()`'s own validator dispatch) to
prove the fixture still matches the documented
`CONCEPT SEED (key: ...)` header shape — never asserted on for its specific
roll, catalog ids, or prose, which vary every call by design.

### Re-recording it

Only if the engine's `concept-seed` output shape changes (the
`CONCEPT SEED (key: ...)` header line disappears or is renamed). Run
`node plugin/bin/impeccable-engine.js run concept-seed --scope surface` from
a session with network access and replace this file with the envelope's
`value` field verbatim.

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
