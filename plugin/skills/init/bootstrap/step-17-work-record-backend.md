# Step 17 — Work-Record Backend (detailed procedure)

*Optional Enhancement step — see `../SKILL.md`'s `## Input` for when this group is offered or filtered, and `../bootstrap-steps.md` for its ordering and renumbering conventions.*

`/claude-tweaks:capture`, `/claude-tweaks:specify`, `/claude-tweaks:backlog`,
`/claude-tweaks:dispatch`, `/claude-tweaks:tidy`, and every health skill
(`/claude-tweaks:code-health`, `/claude-tweaks:harness-health`,
`/claude-tweaks:journey-health`, `/claude-tweaks:docs-health`) all file, shape, gate, dispatch, or sweep against
the same **work record** — the one durable unit each of them acts on. A work record
is backed by either a GitHub issue or, under the `local-files` driver, one local
record file per record (`specs/{id}-{slug}.md`, read and written by
`bin/lib/issues/local-store.js`). Decide the backend once here so every future
filing/shaping/dispatching run is consistent — no split-brain between issue-backed
and file-backed records for the same repo. `_shared/work-record.md` is the canonical
home of the full record taxonomy (the axes, the label families, and the
config-key table) — every consumer skill cites it rather than restating it, and this
step is where its config keys first get written.

**Gate:** same two-tier check Step 9 documents.

**Confirmed against #469's alternative-visibility report.** As currently written, this step never renders a batch-table row for this decision at all: the gate-succeeds path below writes `github-issues` silently with no prompt or table, and the gate-fails path (below) renders the choice as two full `AskUserQuestion` options with their own labels/descriptions — the tool's own option list already surfaces both values natively. Neither path exhibits the "table row shows only the recommendation" pattern the canonical `docs/skill-authoring.md` convention fix addresses; re-verified live against this file at v6.82.0 rather than assumed from the original report (filed against v6.81.0). No change needed here.

**When the gate succeeds** (a GitHub-flavored remote is reachable): skip the prompt
below entirely and go straight to "Write the flag to CLAUDE.md" with
`work-backend: github-issues`. GitHub issues is the richer, proven path
(filterable, visible outside the repo, works with `/claude-tweaks:backlog refine` for
authorization and headless dispatch) — asking a neutral A/B question when the
better option is
unambiguously available is unnecessary friction, not a meaningful decision. A user
who wants local record files anyway (e.g. a public repo where work records
shouldn't be GitHub-visible) can still hand-edit CLAUDE.md's `work-backend` value
afterward — every consumer skill always honors whatever the flag says, regardless
of how it was set.

**When the gate fails** (no GitHub-flavored remote): present the choice below,
defaulted to option 2 — unchanged from today.

**Call `AskUserQuestion` (gate-fails case only):**

- `question`: `"How should claude-tweaks store work records (captured ideas, specs, and everything /claude-tweaks:backlog, /claude-tweaks:dispatch, and /claude-tweaks:tidy act on)?"`, `header`: `"Work-record backend"`, `multiSelect`: `false`
- Option 1 — `label`: `"GitHub issues (Recommended when a GitHub remote is available)"`, `description`: `"Filterable, visible outside the repo, works with /claude-tweaks:backlog refine for authorization and headless dispatch."`
- Option 2 — `label`: `"Local record files"`, `description`: `"specs/{id}-{slug}.md, one file per record — no GitHub dependency."`

**Write the flag to CLAUDE.md.** Add (or update) a `## Work records` section:

```markdown
## Work records

work-backend: github-issues
```

Use the appropriate value:

| Choice | Flag value |
|--------|-----------|
| Option 1 (GitHub issues) | `github-issues` |
| Option 2 (Local record files) | `local-files` |

A missing `work-backend` flag is treated identically to `local-files` by every
consumer skill that reads it — matching `design-integration`'s missing-flag
convention. That is a read-time fallback, separate from what `/init` itself does
when it finds the flag missing at provisioning time — see "Re-run behavior" below.

**Sub-step 17b — Capability probe.** Runs immediately after Step 17 writes
`work-backend` fresh (either branch above) — not on a re-run where the flag was
already set; see "Re-run behavior" below.

Under `work-backend: github-issues`, resolve the owner/repo and run
`probeCapabilities()` (`bin/lib/issues/capabilities-probe.js`) in one `node -e`
snippet:

```bash
read -r OWNER REPO <<< "$(gh repo view --json owner,name -q '.owner.login + " " + .name')"
node -e "
  const { probeCapabilities } = require('${CLAUDE_PLUGIN_ROOT}/bin/lib/issues/capabilities-probe.js');
  console.log(JSON.stringify(probeCapabilities({ owner: process.argv[1], repo: process.argv[2] })));
" -- "$OWNER" "$REPO"
```

Write the results to **two different files** — the two keys no longer share a home:

- `work-types` goes beside the flag in CLAUDE.md: `work-types: native` when the
  result's `types` is true, else `work-types: labels`.
- `work-links` goes in `.claude-tweaks/policy.yml` (create the file if absent):
  `work-links: native` when BOTH `subIssues` and `dependencies` are true, else
  `work-links: body-text`.

**Writing `work-links` to CLAUDE.md instead silently discards the probe.** Every
consumer — `/claude-tweaks:dispatch`, `/claude-tweaks:wrap-up`,
`/claude-tweaks:visualize`, `/claude-tweaks:specify` — greps
`.claude-tweaks/policy.yml` alone and falls back to `body-text` when the key is
absent there. A project whose org has sub-issues and dependencies enabled would be
probed as `native`, recorded in the file nobody reads, and then run on `body-text`
with nothing objecting; the next `/claude-tweaks:init --update` would flag the key
this step just wrote as Config Home Drift. `work-backend` and `work-types` stay in
CLAUDE.md deliberately — see `_shared/work-record-config.md`'s "Where these live."

Filing and shaping skills read these keys and branch — they never re-probe mid-flow
(`_shared/work-record.md`'s config-key table).

Under `work-backend: local-files`, skip the probe entirely and write
`work-types: labels` plus `work-links: body-text` directly — those are the only
expressions a plain file store supports, so there is nothing to detect.

**Sub-step 17c — Label provisioning offer** (`work-backend: github-issues` only).
Call `AskUserQuestion`:

- `question`: `"Provision all core work-record labels now?"`, `header`:
  `"Label bootstrap"`, `multiSelect`: `false`
- Option 1 (Recommended) — `label`: `"Yes — provision all labels now"`,
  `description`: `"Runs _shared/label-bootstrap.md's canonical LABELS_JSON whole —
  the core label families plus the optional priority:* family (see
  _shared/work-record.md's Label taxonomy table for the current per-family and
  total counts) — plus, when work-types reads labels, the three type:* labels
  (record.js's TYPE_LABELS), which the canonical LABELS_JSON structurally
  excludes. That file's own note names this offer as the one caller allowed
  to use the full list, rather than bootstrapping only what's about to be applied.
  Front-loads label creation so the first health-skill firing or
  /claude-tweaks:capture call never pays the lazy-create path."`
- Option 2 — `label`: `"No — create labels lazily as each skill needs them"`,
  `description`: `"Every filing/shaping/dispatching skill already bootstraps its
  own labels via the same check-then-create loop on first use
  (_shared/label-bootstrap.md). Both are valid — this only changes when labels
  first appear on GitHub, not whether the system works."`

On option 1, run the check-then-create loop from `_shared/label-bootstrap.md` with
its canonical `LABELS_JSON`. When `work-types: labels` (per Sub-step 17b's probe
result), also run the same loop with `record.js`'s `TYPE_LABELS` — the canonical
`LABELS_JSON` structurally excludes `type:*`, so without this second pass the
option's "never pays the lazy-create path" promise would be false for Type labels
the first time `/claude-tweaks:capture` or a health skill files one. Skip this second
pass under `work-types: native` — there's nothing to bootstrap. See
`_shared/work-record.md` for the taxonomy each label expresses (the axes:
type, origin, scoring, stage, authorization, bot state, acceptance).

**Pre-existing artifacts.** Projects that used the earlier two-file backlog design
may still have `specs/backlog/*.md` entries, or live GitHub issues carrying retired
`tier:*`/`status:*`/`backlog` vocabulary. Migrating that pre-existing content into
the unified work-record taxonomy is the separate migration plan's scope, not this
step's — `/init` provisions the backend going forward; it does not touch existing
records. Until that migration plan runs, `/claude-tweaks:tidy` surfaces the gap on
its own: an unsynced local record under `work-backend: github-issues` becomes a
Sync finding, and a live issue still carrying retired vocabulary is flagged for
re-triage.

**Re-run behavior (keyed to `work-backend`).** When `/init` is re-run on a project
where `work-backend: github-issues` is already set, this step — including
sub-steps 17b and 17c — is a no-op; ongoing capability re-probing on an
already-provisioned project is Update-Mode's job (see `update-mode.md`'s
Work-Record Backend Drift), not a repeat of this bootstrap step. When
`work-backend: local-files` is set, re-run the Gate check — if a GitHub remote has
since become available (the project was local-only at the last `/init` and has
since been pushed), offer the upgrade path back to `github-issues`, running 17b/17c
as part of that upgrade. When `work-backend` is **missing**, this counts as a true fresh init:
apply the same Gate-based handling described above — silently set `github-issues`
(running 17b/17c) when the gate succeeds, present the gate-fails prompt otherwise.

See `_shared/work-record.md` for the full record taxonomy and config-key table that
this flag, and the two keys it provisions alongside it, govern.

**Failure handling:** if writing the CLAUDE.md section fails, surface the failure and
continue `/init` — never abort the rest of bootstrap on this step.
