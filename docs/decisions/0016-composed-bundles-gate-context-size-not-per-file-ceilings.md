# 0016. Composed per-run bundles gate context size, not per-file ceilings

- **Status:** accepted
- **Date:** 2026-09-07
- **Context:** #1987 (skill context composer decomposition, sub-issues #1988–#1997); the design doc that reasoned this through was deleted at decomposition (`4c6e76733`), so the trade-off is recorded here

## Context

The 40 KB per-file ceiling (#102) held every skill file under 40 KB while the corpus doubled: shared contracts carry every branch of a condition the run has already resolved once (`pr-first` and `local-merge`, `gh` and MCP transport, auto and interactive), so every reader pays for the untaken branch, and the reflex when a file nears the cap was to split it into more sub-files — fewer bytes per file, more Read calls per run. Roughly 165 commits and 25 issues in five weeks were reactive trim work; 349 of 500 test files pin skill prose, so every trim moved pins (`[IL-70]`, `[IL-140]`, `[IL-144]`, `[IL-153]`).

## Decision

`<!-- when: key=value --> … <!-- /when -->` markers fence a branch inside the existing shared-contract prose, in place; `bin/compose-context.js` resolves the run's already-known condition set from the run directory and assembles the sources a step names into one `{run}/context/{step}.md` bundle, stripping the untaken branches. The hard size gate is the composed bundle at each call site, measured under every combination of the keys its sources branch on (`context-cost.js`'s `overComposedCeiling`, with a per-step exception map); the per-file 40 KB number is a warning tier only. A key the run cannot resolve keeps both branches. Every call site keeps a stated fallback to the raw sources.

## Alternatives considered

- **Raise the per-file cap** — addresses the maintenance tax but not the shape of the problem (untaken branches still loaded), and fails the instruction-fidelity and speed criteria.
- **More sub-files (fragmentation)** — lowers bytes per file while raising Read calls per run; serves bytes and nothing else. Rejected as the standing response to ceiling pressure; a sub-file is warranted only when it is a genuinely lazy unit some runs never read.
- **Author-time rendering of the payload** — the shipped tree diverges from the source tree and every prose-pinning test has to choose which copy it pins.
- **Per-read slicing** — still one call per need, and the model still has to know to reach for it.
- **An external manifest of "what loads when"** — a second place that drifts from the prose it describes and breaks silently on heading renames; in-source markers keep one coherent source that reads correctly with both branches when no composer runs.

## Consequences

Easy: a file nearing a budget gets markers or a compose call site instead of another sub-file; a fenced source reads correctly (both branches) in a session with no composer; the composed gate catches a multi-spec run that grows a bundle regardless of which spec touched which source first (`plan-audit`'s composed headroom rows). Hard: every citation must resolve in every composition (`docs/skill-authoring.md`), so a fenced span can never hold the only copy of a heading or step another file cites; six skill files now sit over 40,000 B with no hard `npm test` guard (`[IL-153]` lists them and the removal condition); the audit-derived premise that shared contracts carry large fenceable branches measured false or near-zero for five of the six fencing records, so the realized saving on the merge path was ~4.5%, and the decision's payoff depends on #1996's post-release measurement of subagent reads. Revisit if that measurement shows no drop, or if the composed gate starts accumulating per-step exceptions instead of restructurings (#2002 is the first).
