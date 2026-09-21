---
record: 255
origin: human
risk: low
size: low
ceremony: fast-lane
grants: [build, merge]
surface: backend
---
# 255: ops: CHANGELOG note for effort:*→size:* label rename (specs 216-218)

Surface: backend

## Current State

On 2026-08-09, the `effort:low`/`effort:medium`/`effort:high` GitHub labels on `thomasholknielsen/claude-tweaks` were renamed in place to `size:low`/`size:medium`/`size:high` (via `gh label edit --name`), matching the record-facet rename shipped in code by spec `#217` (`effort` → `size`). Release v6.73.0 had already shipped before this rename executed, so no CHANGELOG/release-summary entry captured it. The rename is repo-local only: it renamed this repo's own labels, not any other project's or fork's — a project that bootstrapped `effort:*` labels from an earlier plugin version keeps the old names until it re-runs label bootstrap (`_shared/label-bootstrap.md`) or renames them manually.

## Deliverables

- The next `node bin/release.js <minor|patch> "<summary>"` invocation's `<summary>` string includes a line noting the `effort:*`→`size:*` GitHub label rename, scoped explicitly to this repo — not presented as a migration this plugin pushes to other repos or forks.

## Acceptance Criteria

- [ ] The CHANGELOG entry produced by the next release contains a line describing the `effort:*`→`size:*` label rename.
- [ ] That line states the rename applied to `thomasholknielsen/claude-tweaks` only, and that other projects/forks keep the old `effort:*` label names until they re-run label bootstrap (`_shared/label-bootstrap.md`) or rename them manually.

## Technical Approach

Fold one clause into the `<summary>` argument passed to `node bin/release.js <minor|patch> "<summary>"` the next time a release ships — no code change and no file edit beyond the generated CHANGELOG entry itself. No worktree, build, or test steps are required; this is release-authoring guidance consumed at release time by whoever runs `bin/release.js` next.

## Gotchas

- This is a one-time historical note, not a recurring release-process change — once the next release's CHANGELOG captures it, the record is done and needn't recur.
- Don't conflate this with actually re-running label bootstrap on other projects — that's explicitly out of scope; this plugin cannot push the label rename to forks or other repos automatically.

## Original request

ops: CHANGELOG note for effort:*→size:* label rename (specs 216-218)

**Summary:** The next release's summary (fed to `bin/release.js`) must mention the `effort:*`→`size:*` GitHub label rename.

**Origin:** ledger resolve gate (acknowledged) — `docs/plans/2026-08-08-flow-spec-216-217-218-ledger.md` item 4, from the specs 216/217/218 multi-spec run.

**What happened:** On 2026-08-09, `effort:low`/`effort:medium`/`effort:high` were renamed in place to `size:low`/`size:medium`/`size:high` (via `gh label edit --name`) on `thomasholknielsen/claude-tweaks`, matching the record-facet rename `#217` shipped in code (`effort` → `size`). v6.73.0 had already shipped before this rename executed, so no CHANGELOG entry captured it.

**Requirement:** Whoever authors the next `node bin/release.js <minor|patch> "<summary>"` invocation should fold in a line noting the label rename — specifically that it renamed labels in place on **this** repo only; any other project or fork that bootstrapped its own `effort:*` labels from an earlier plugin version keeps the old names until it re-runs label bootstrap (`_shared/label-bootstrap.md`) or renames them manually. This is a heads-up for readers, not a functional migration this plugin can push to other repos automatically.

**Type:** task

---
Filed via `/claude-tweaks:wrap-up` (ledger resolve gate, Acknowledge disposition, standalone mode).

