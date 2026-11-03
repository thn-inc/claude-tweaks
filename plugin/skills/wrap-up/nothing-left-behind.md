# Phase 3's ledger gate — Nothing Left Behind (wrap-up's wrapper around the resolve gate)

Loaded by `/claude-tweaks:wrap-up`'s Phase 3 ledger gate under the same condition that gates `_shared/ledger-format.md`'s Resolve Gate section: the ledger exists and holds at least one item, of any status. Holds the requirements the resolve gate runs under here, the terminal-status bulk-resolve fast path, and the ops-acknowledgment sub-step.

The gate is item-*existence*, not open-item-existence: the bulk-resolve fast path below still stages proposals for `acknowledged` items via that file's Phase 3 `Acknowledge` disposition, and the Ops acknowledgment sub-step below applies the same disposition — both operate on items that are already terminal. Gating on `open` items alone would skip the read while those two paths still need it.

**Hard requirements:**

- Phase 1 must run before any user-facing output. The agent fixes everything that qualifies for fix-now, commits, then presents only the genuine residue.
- Phase 2 always requires explicit per-item user input for `fix` / `defer` / `accept` decisions. Status `acknowledged` (e.g., ops items the user has read — each one stages a work record proposal, resolved by the run's own Queue writes surface under `_shared/auto-mode-contract.md`'s tiered stance (Review Console "Approve all" at supervised/trusted; zero-click `consoleAutoResolve` at unattended) — see the sub-step below for which surface that is) is *staged* via `_shared/batched-item-drill.md`'s multiSelect chunking — a checkbox per item, pre-checked to Acknowledge — since the actual record creation still gets its own downstream approval per that tiered stance. Never bulk-resolve `fix` / `defer` / `accept`. Never assume "obvious" defers. Never offer a "Fix all (Recommended)" or "Defer all" shortcut — those bias the user toward whichever bulk action is easier to type. Ops-ack's per-item checkbox is not such a shortcut: unchecking an item is a real, individually-attended choice, not a shared bulk toggle.
- `auto` mode does NOT silence this gate.
- Both `parked` and `backlog` are valid stage destinations for a new work record, but every individual item requires an explicit per-item user choice — no record is ever staged autonomously.

### Bulk-resolve fast path (terminal-status only)

The fast path applies **only when every ledger item already has terminal status** (`fixed`, `deferred`, `accepted`, `acknowledged`, `observation`) and none is an incomplete deferral (`_shared/ledger-format.md`'s Resolution-text requirements) at gate entry. If a single item has status `open`, the fast path does NOT apply — Phase 1 → Phase 2 → Phase 3 must run in full sequence without exception. Before reporting completion, check every `acknowledged` item for a staged proposal (a producer can create an item pre-set to `acknowledged`, bypassing Phase 3 entirely — e.g. `build/worktree-setup.md`'s auto-mode divergence entry): stage one now, per `_shared/ledger-format.md`'s Resolve Gate Phase 3 `Acknowledge` disposition, for any that lack one.

**Incomplete deferrals (#3327).** Before reporting completion, re-check every `deferred` item against `_shared/ledger-format.md`'s incomplete-deferral definition. `pack.ledger.deferredUnstaged` / `deferredUnstagedItems` count these at pack time; if the residue sweep appended rows after the pack ran, re-check the ledger file with the same rule. Each incomplete deferral goes through the resolve gate exactly as that file defines for it, and the ledger is not fully resolved while any remain. The producer of this shape is `build/dispatch.md`'s SDD carry-forward, which writes `minor (deferred):` lines as `deferred` with no staged path or record reference. Once none remain, report: "All {N} ledger items resolved. No open items." and proceed to Phase 4.

Phase 2 is on the "What `auto` does NOT silence" list in `_shared/auto-mode-card.md` — it is never skipped, regardless of `auto` state, when any `open` item or incomplete deferral exists.

### Ops acknowledgment (when ops items exist)

Ops items represent infrastructure changes the user needs to action post-merge — bulk-acknowledging them risks the user not reading them. Present each item, and require explicit confirmation rather than a shortcut that defaults to bulk action:

```
The following ops items need acknowledgment. These represent infrastructure changes you need to action post-merge — read each one before choosing:

| # | What | Where |
|---|------|-------|
| 1 | {description} | {source} |
```

**Autonomy auto-acknowledge:** resolve the `ceiling` per `_shared/autonomy-ceiling.md`'s existing
precedence ladder. If `bookkeepingPermissions(ceiling).opsAckAutoAcknowledge === true`
(`bin/lib/issues/autonomy.js` — gated at `unattended`, the tier that also skips acknowledging a
post-merge infrastructure follow-up, not just a reversible bookkeeping item), skip the drill below
entirely — for every item, stage a record proposal and update status to `acknowledged` per
`_shared/ledger-format.md`'s Resolve Gate Phase 3 `Acknowledge` disposition, log
`AUTO {time} — Ops acknowledgment: {N} items auto-acknowledged, staged for filing. Reversibility: high.` to
`decisions.md`, and continue to Phase 4's Review Console. Otherwise, present the drill below.

Resolve each item's acknowledgment via `_shared/batched-item-drill.md`'s multiSelect chunking
(genuinely binary: Acknowledge vs. defer to a follow-up) — one `multiSelect: true`
`AskUserQuestion` call per chunk of ≤4 items, all pre-checked to `Acknowledge` (the recommended
default — these are read-and-confirm items, not judgment calls); unchecking an item defers it
instead, leaving it `open` for a later run's Phase 2 drill:

- `question`: `"These ops items need acknowledgment — you need to action them post-merge. Read each one before submitting. (checked = Acknowledge, uncheck to defer)"`, `header`: `"Ops items"`, each checkbox option's label the item's own short description

After a chunk resolves, apply `_shared/ledger-format.md`'s Resolve Gate Phase 3 `Acknowledge` disposition to every checked item — stage a record proposal per item and update status to `acknowledged` with `ledger-row --row {N}` (`_shared/ledger-format.md`'s Writer section). The actual record creation is a separate approval at the Review Console's Queue writes section — folded into "Approve all" at supervised/trusted, auto-resolved with zero `AskUserQuestion` calls under `consoleAutoResolve` at unattended, per `_shared/auto-mode-contract.md`'s tiered stance (this drill only stages the proposal; it does not silently create N records). An unchecked item's status stays `open` — it is not acknowledged, and remains subject to a later resolve-gate pass rather than silently dropped.
