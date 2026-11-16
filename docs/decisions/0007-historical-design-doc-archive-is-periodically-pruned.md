# 0007. Historical design-doc archive is periodically pruned, not kept forever

- **Status:** accepted
- **Narrowed by:** [0034](0034-this-repository-deletes-each-runs-plan-at-wrap-up.md) — in this repository a plan is deleted by its own run at wrap-up; design docs are still kept until `/claude-tweaks:specify` consumes them.
- **Date:** 2026-07-26
- **Context:** Conversation-based repo-hygiene work ("clear up legacy/recon/memenu noise")

## Context

CLAUDE.md documented an unconditional rule: design docs and plans under `docs/superpowers/specs/`
and `docs/superpowers/plans/` are kept forever as "permanent historical record" once a design-mode
build completes, and the repo's own accumulated history (many prior `*-design.md`/plan files still
committed) was cited as proof this was established practice.

By this session, that archive had grown to 93 plan files and 64 spec files — most describing
design work completed weeks or months earlier, several documenting a system (`recon`) renamed away
from over a month prior. The archive itself had become noise: bulk, low-signal content in a public
GitHub repo, with no per-file value beyond what git history already preserves. The user directed a
one-time bulk prune, keeping recent/in-progress docs (last ~week, or backing an active/interrupted
pipeline run) and `docs/decisions/` ADRs untouched.

This is a genuine reversal of an explicit, previously-stated policy — the kind of decision a future
reader (or a future `/wrap-up` run) would reasonably be surprised by if the repo's design-doc
archive were suddenly much smaller with no explanation on file.

## Decision

The historical design-doc archive (`docs/superpowers/plans/`, `docs/superpowers/specs/`, and the
legacy numbered `specs/{N}.md` files) is *not* kept forever. Per-build wrap-up behavior is
unchanged — a design doc/plan still isn't deleted immediately after its own build completes. But
the accumulated archive can be pruned in bulk, as a separate, deliberate, explicitly-scoped
maintenance action, once it has grown large enough to be noise itself. Tree-only removal (`git rm`
+ commit) is sufficient — git history remains the durable record; a full history rewrite is a much
larger, separate decision not taken here. Recent/in-progress docs and `docs/decisions/` ADRs are
always excluded from such a prune.

## Alternatives considered

- **Keep everything forever, unconditionally** — the pre-existing policy. Rejected: the archive's
  size had already outgrown its own value: each file is a completed, historical account with a
  live descendant elsewhere (the shipped code, the CHANGELOG, or an ADR when the decision actually
  mattered) — keeping the account after the artifact ships doesn't add reader-facing value
  proportional to the noise it accumulates in a public repo.
- **Move to a separate archive repo** — preserves full content outside this repo's tree without a
  git-history dependency. Rejected as unnecessary for this pass: git history already gives full
  recoverability for anyone who needs it, and this repo's own commit history is stable public
  infrastructure (unlike a bespoke second repo nobody would think to check).
- **Full git-history rewrite (filter-repo/BFG + force-push)** — would make old content genuinely
  unrecoverable via ordinary means. Explicitly declined for this pass — far more invasive, breaks
  existing clones/forks, and the motivating concern (a public-repo noise complaint) doesn't require
  erasing history, just tidying the current tree.

## Consequences

Makes the current `docs/superpowers/` tree easier to browse and keeps it proportionate to active
work. Makes it harder to casually skim "how did we get here" from the working tree alone — that
context now lives in `git log`/`git show` for anything pruned. Future prunes should follow the same
shape: explicit user direction, an explicit cutoff for recent/in-progress work, `docs/decisions/`
always excluded, and a cross-reference check (`grep` the kept surface for filenames about to be
removed) before deleting — the source-of-truth for the check is this session's own two-round
scoping process, documented in the CLAUDE.md Don't this ADR sits alongside.
