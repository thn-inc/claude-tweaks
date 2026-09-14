# Work Record — Config Keys

Canonical home of the work-record system's config keys. The table below is the single source
of truth for every key's name, accepted values, and default; `_shared/work-record.md` — the
record taxonomy's home — keeps a `## Config keys` stub pointing here rather than a second copy.
This file exists as its own lazy-load unit because most citations of that contract need one
key, not the taxonomy around it.

Referenced by every skill in `_shared/work-record.md`'s Consumers table, plus the `_shared/`
fragments those skills inline (`record-queue-fetch.md`, `local-files-preflight-stop.md`,
`health-finding-shapes.md`, `policy-schema.md`, `harness-health-analysis.md`).

Written by `/init` (probe + policy), read by every filing/shaping/dispatching skill **by
these literal names** — per-skill aliases and env-var renames are forbidden:

| Key | Values / default | Meaning |
|---|---|---|
| `work-backend` | `github-issues` \| `local-files` | Which driver stores work records |
| `work-types` | `native` \| `labels` | How Type is expressed (native Issue Types vs `type:*` labels) |
| `work-links` | `native` \| `body-text` | How parent/dependency links are expressed (sub-issue + blocked-by APIs vs `Blocked by #N` body lines) |
| `dispatch-retry-ceiling` | `3` | Failed autonomous attempts before `auto:*` removal + `bot:blocked` |
| `auto-merge-max-lines` | `40` | Auto-merge blast-radius guideline: implementation diff lines `/claude-tweaks:assess-agent-autonomy`'s `merge-check` verdict mode weighs, not a hard cutoff |
| `auto-merge-max-files` | `2` | Auto-merge blast-radius guideline: implementation files touched, same weighted-not-cutoff treatment |
| `dispatch-batch-size` | `3` | Default drain budget — max groups one bare `/dispatch` drain firing attempts **sequentially**, one after another (never concurrently — see #155); the remainder stays unclaimed in the queue for a later firing to select. Per-firing override: `--budget <n\|all>`. Deprecated alias `dispatch-pick-max-concurrent` still resolves, with one warn-tier notice per invocation |
| `dispatch-group-size-guard` | `10` | Caps how many members a file-overlap dispatch group may have before the drain's ranking (bare, or its deprecated `next` alias) excludes it — still resolvable by explicit `#N`/`#N,#M,...` naming |
| `dispatch-fastlane-bundle-cap` | `3` | Caps how many non-overlapping `ceremony:fast-lane` singleton groups Step 2's queue-pull script folds into one multi-spec group, sharing one preflight/wrap-up tail (#1910); `0` disables bundling |
| `merge-sensitive-paths` | `[]` | Path globs `/claude-tweaks:assess-agent-autonomy`'s `merge-check` verdict mode treats as a hard `needs-human` floor, regardless of diff size or content judgment. Empty by default — project-agnostic, each project populates its own list. |
| `backlog-fetch-limit` | `1000` | Cap on `gh issue list --limit` for every `_shared/record-queue-fetch.md` consumer (`/help`, `/tidy`, `/backlog`) — `gh` auto-paginates internally regardless of size; this bounds how many rows before a truncation warning fires, not a hard cutoff on backlog size |
| `record-staleness-weeks` | `4` | Staleness threshold (in weeks) `_shared/record-queue-fetch.md`'s Threshold resolution section reads for `/help`'s backlog-stale sub-count and `/tidy`'s Shape 1/Shape 2 backlog/parked staleness classification — converted to ms and passed to `bin/lib/issues/record-buckets.js`'s `classifyStaleness` |

**Where these live.** Every key above that `_shared/policy-schema.md` also indexes resolves from
`.claude-tweaks/policy.yml`, the single home for project config. Three do not: `work-backend`,
`work-types`, and `record-staleness-weeks` are still read from CLAUDE.md, and are absent from
`policy-schema.js`'s `POLICY_KEYS` — so `auditPolicy()` cannot see them and `/claude-tweaks:init`'s
Config Home Drift check never offers to move them. This is deliberate, not an oversight: CLAUDE.md
is ambient in every session while `policy.yml` requires an explicit read, and `work-backend` gates
two "stop this turn completely" paths (`/claude-tweaks:dispatch` Preflight,
`/claude-tweaks:backlog refine`'s grant sub-stage) where a key that silently reads as absent would
stop real work. Moving them is tracked separately.

**No aliases.** Every key above has exactly one name. A key read under two names drifts into
being half-supported — the state where most consumers silently fall back to a default while a
few honor the alias, which reads as a configuration bug rather than an error (`[IL-85]`).

See `_shared/work-record.md` for the taxonomy these keys govern — the lifecycle spine, the
axes, the label contract, the permission matrix, and the Consumers table naming every skill
that reads this file. `_shared/policy-schema.md` indexes every *other* project-config lever
claude-tweaks skills read; where its defaults overlap with the table above, this file wins —
it is the work-record contract's own table, and the most-cited source for these keys.
