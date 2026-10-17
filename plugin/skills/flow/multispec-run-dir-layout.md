# Multi-Spec run directory — per-spec config, slug convention, and `manifest.yml`

Read from `multi-spec.md`'s "Run directory layout" section (which keeps the anchoring rule and the tree diagram). This file carries the field-level detail.

The parent dir uses a single `spec-` prefix at the start of the slug segment so `find -name "*spec-${N}*"` reliably disambiguates record/spec IDs from timestamp digits.

**Each `spec-{N}/` carries its own `config.yml`** — a byte-for-byte copy of the parent's, written immediately before that spec's pipeline starts. Per-spec skills resolve levers via `resolve-policy.js --run "$PIPELINE_RUN_DIR"` where `PIPELINE_RUN_DIR` is the subdirectory — without its own `config.yml` that call resolves `source: default` and silently drops the Manifesto's answers for the whole spec. The step that writes it, its ordering rule, and the `#678`/`#925` history behind it are under "Scaffold the per-spec subdirectory" in `multi-spec.md`.

`manifest.yml` lists the records in execution order plus their status as the run progresses. It has two writers, both `hooks.js` subcommands. `node "${CLAUDE_PLUGIN_ROOT}/bin/hooks.js" manifest-init --run "{parent}" --specs {N1},{N2},...` creates it (every spec `pending`, `subdir: spec-{N}/`) and is idempotent: on an existing manifest it appends only new spec ids and never touches a listed spec's `status`, `startedAt` or `phases[]`. `spec-status` (see "Phase-progress banner and per-spec completion summary" in `multi-spec.md`) transitions entries, and refuses with `no-manifest` until `manifest-init` has run. Nothing else writes this file. A legacy `baseSha:` key is no longer written and nothing reads it (batch curation and boundary freshness derive from `git merge-base`, `multispec-freshness.md`); an older manifest that carries one keeps it on rewrite:

```yaml
multispec:
  parent: .claude-tweaks/pipelines/2026-05-16T143207-spec-157-159-160/
  specs:
    - id: 157             # record id
      status: complete    # pending | running | complete | failed | not-run
      subdir: spec-157/
      startedAt: 2026-05-16T14:32:07.000Z   # set once, on this spec's FIRST running transition
      phase: wrap-up        # latest phase named by spec-status (#1928)
      phases:
        - phase: build
          status: running
          at: 2026-05-16T14:32:07.000Z
        - phase: wrap-up
          status: complete
          at: 2026-05-16T14:47:40.000Z
    - id: 159
      status: complete
      subdir: spec-159/
      startedAt: 2026-05-16T14:48:11.000Z
    - id: 160
      status: complete
      subdir: spec-160/
      startedAt: 2026-05-16T15:05:44.000Z
```

`phase` and `phases[]` (#1928) are written by every `spec-status` call — `phase` is the latest, `phases[]` is append-only (a re-entered phase adds another entry, never rewrites one). `bin/phase-timing.js` reads `phases[]` as the manifest-side boundary source for the run's Timing table; nothing else consumes it.

Under the opt-in `parallel` token (#2677), a wave member's build and test also write `spec-{N}/ledger.md` — the run-dir-scoped ledger — which is folded into the shared ledger at merge-back (`multispec-parallel-waves.md`).
