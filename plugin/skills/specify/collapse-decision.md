# Specify — Decomposition Mode, Step 2.6: Collapse Decision

Loaded from `decomposition-mode.md`'s Step 2.6 stub — the full collapse-decision rules (#1263), extracted here (#611's sub-file sizing) the same way Step 2.5 delegates to `design-pre-steps.md`.

With Step 2's work-unit list final and Implicit Dependency Detection's overlap/dependency signals computed, decide whether this decomposition needs a parent record at all. `--granularity` never overrides this decision — that flag tunes Step 2's sizing targets only (see `SKILL.md`'s Input section).

**The unit set counted here is Step 2's own design-doc-derived work-unit list for this run** — per `phase-N` scope when the run is phase-scoped, so a multi-phase doc decomposed one phase at a time counts each phase's units on their own and may legitimately keep a parent for one phase and collapse another. A unit a prior partial run already created still counts as exactly that one unit, never double-counted as both a work unit and an open record — Step 2's input-set assembly (above) excludes fingerprint-matched records for exactly this reason, so a resumed run re-derives the same verdict as the run it resumes.

**1 work unit — always collapses.** No parent is created. The single unit becomes a standalone ready record (or, when `$ORIGIN_RECORD_NUM` is set, the origin record is shaped in place as that unit's create — see Step 3, `record-creation-subissues.md`'s Sub-issues section, #1346's split of `record-creation.md`).

**2 work units — collapses only when independent.** Read Implicit Dependency Detection's own outputs for these two units (never re-derive dependency-ness from prose, and never read the adjacent Rail-headroom flag, which is a byte-budget annotation from the same grouping pass, not a dependency signal):

- A `Blocked by #N` flag between the two units (from Overlap Analysis or the Implicit Dependency Detection table) → **dependency-ordered — keep the parent.**
- An internal-conflict row (Overlap-Type table: "grouped with another new work unit from this decomposition") between the two units → **dependency-ordered — keep the parent.**
- The strangler-fig `early-production` two-sub-issue shape (Decomposition Heuristics table: implement-behind-a-flag, then remove-the-old-path) → **always parent-keeping** — the parent tracks the flag-then-remove sequence; this shape never collapses regardless of the two signals above.
- Neither signal present, and not the strangler-fig shape → **independent — collapses.** No parent is created; the two units become two ordinary ready records, cross-linked via a `**Related:** #N` body line on each (see `record-creation-linking.md`'s Linking section for the exact format, #1346's split of `record-creation.md`).
- **Ambiguous** (a signal exists but this step cannot confidently classify it as dependency-ordering the two units) → **keep the parent.** Ambiguity resolves toward tracking, never toward collapse.

**3+ work units — never collapses.** Unchanged: a parent is always created, exactly as today. The strangler-fig `established` three-sub-issue shape is one instance of this — it is 3+ units by construction and was never in scope for collapse.

Carry this decision forward as this run's collapse verdict — `parent kept` / `2-unit collapse` / `1-unit collapse` — for Step 3's record creation (`record-creation.md` + `record-creation-subissues.md`, split #1346), Step 9's origin-closure and summary (below), and every other step that references "the parent."
