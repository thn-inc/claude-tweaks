# Multi-Spec — Scaffold the Per-Spec Subdirectory

Loaded by `multi-spec.md`'s "Execution" section — it lives here rather than inline so
`multi-spec.md` stays focused on orchestration, with this scaffolding step lazily-loaded on its
own.

## The gap this closes

`multi-spec.md` previously asserted that each `spec-{N}/` subdirectory carries a byte-for-byte
copy of the parent's `config.yml`, "written by `/flow` in the same step that creates the
subdirectory (Step 3)." That citation was wrong: Step 3 is the parent-level Manifesto
(`SKILL.md` Step 3), which writes only the **parent's** `config.yml` and never touches a
`spec-{N}/` subdirectory. No step anywhere in `flow/SKILL.md` or `flow/multi-spec.md` actually
performed the per-spec copy the assertion described.

The practical effect: every downstream skill inside a spec's own pipeline resolves policy via
`resolve-policy.js --run "$PIPELINE_RUN_DIR"`, where `PIPELINE_RUN_DIR` is that spec's
`{parent}/spec-{N}/` subdirectory. `resolve-policy.js` reads `{runDir}/config.yml` with no
parent-directory fallback (`bin/resolve-policy.js`) — this is correct, existing behavior, not a
bug in the CLI itself (pinned by `tests/resolve-policy-cli.test.js`'s "existing `--run` dir
WITHOUT config.yml" case). An unscaffolded `spec-{N}/` therefore has nothing to read, and the
call silently resolves every Manifesto-set lever to `source: default` — the run's own answers
are dropped with no error. Observed live on the `#678` run: `review-auto-apply-ceiling` read
`default` from `spec-678/` while the parent held `run-config: medium`. The underlying prose gap
— an assertion with no step performing it — persisted until `#925`.

## The scaffolding step

Immediately before starting each spec's own pipeline — **not** upfront for all specs, and
**not** during the parent-level Manifesto — create that spec's subdirectory and copy the
parent's `config.yml` into it verbatim:

```bash
mkdir -p "{parent}/spec-{N}/staged"
cp "{parent}/config.yml" "{parent}/spec-{N}/config.yml"
touch "{parent}/spec-{N}/decisions.md"
```

This is a byte-for-byte copy, not a symlink or a deferred write — a mid-run in-place lever edit
(the ceremony escape hatch) then lands in one spec's own copy and scopes to that spec, never
touching its siblings or the parent.

Do this **before** the `PIPELINE_RUN_DIR` env var is exported for that spec (`multi-spec.md`'s
environment-variable table) — every downstream skill invocation for that spec depends on
`{parent}/spec-{N}/config.yml` already existing by the time it first calls `resolve-policy.js
--run "$PIPELINE_RUN_DIR"`.
