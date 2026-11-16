# Multi-Spec — Cross-Spec Conflict Detection

Loaded from `multi-spec.md`'s "Cross-spec conflict detection" section.

When two specs in the run declare overlapping files, sequential execution can compound (spec 159 builds on spec 157's changes, possibly conflicting with what its spec assumed) and future parallel execution would conflict outright.

## Procedure

1. Collect each target's key files into a single `[{id, keyFiles}]` list: extract the `### Key Files` subsection (under `## Technical Approach`, per `spec-template.md`'s record body template) from the record body already fetched during Validation step 3 above — the same extraction `/claude-tweaks:specify` Step 1 and `help/status-scan.md`'s Conflict detection section perform. An empty `keyFiles` array is not erroring, but when the record is `ready` (spec-shaped — should have one) and `bin/lib/issues/grouping.js`'s `expectsKeyFilesSection` returns true (excludes the five health-sweep origins, whose own header shape legitimately has none), it means overlap detection is silently disabled for it — surface one warning line to `decisions.md` (`_shared/auto-decision-log.md`'s Entry schema — `AUTO {time} — Cross-spec conflict detection: record #{n} is ready but has no ### Key Files subsection — overlap detection disabled for it. Reversibility: n/a.`). A not-yet-`ready` record, or one `expectsKeyFilesSection` excludes, is the expected absence case and stays silent, as today.
2. Call the shared grouping primitive — `groupByFileOverlap` (`bin/lib/issues/grouping.js`), the same one `/claude-tweaks:help`'s dashboard conflict detection and `/claude-tweaks:specify`'s creation-time check both use — over the combined list.
3. Any group of size > 1 returned by `groupByFileOverlap` shares files across targets — record a **conflict warning** for each pair in that group.

## Presentation

Surface conflicts in the Pipeline Preview block as a dedicated footer line:

```
Conflicts: spec 157 ↔ spec 159 both modify src/auth/session.ts; spec 159 ↔ spec 160 both modify src/api/users.ts
```

This is a **warning, not a hard fail** — sequential execution is usually fine, but the user should know spec 159's plan assumed `src/auth/session.ts`'s pre-157 shape, which changes once 157 runs.

If `auto` mode is set and conflicts are detected, the Manifesto still renders (as a read-only FYI in default `auto`, or as the approval gate under `confirm` / `hybrid`) — the conflict footer just makes it visible before the pipeline proceeds. No mid-flow re-prompt.

## Anti-patterns

Never hard-fail on file overlap (specs legitimately share files — false positives block real work), never suppress the conflict footer (it is the user's only interdependency signal), and never auto-reorder to dodge a conflict — re-ordering only helps when a real `blocked-by:` edge exists; conflicts and dependencies are different things.
