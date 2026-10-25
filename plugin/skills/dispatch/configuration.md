# Dispatch — Configuration

These rows mirror `_shared/work-record-config.md`'s canonical key table (which every filing/shaping/dispatching skill is meant to cite rather than restate) — kept spelled out here too since this is the skill that actually reads and branches on them; check that file when a default or meaning changes to keep this copy in sync. Read via `node "${CLAUDE_PLUGIN_ROOT}/bin/resolve-policy.js" <key> [<key>…]` (`_shared/policy-schema.md`):

| Flag | Default | Meaning |
|---|---|---|
| `dispatch-retry-ceiling` | `3` | Consecutive failures before a dispatched record gets `bot:blocked` and stops auto-retrying. |
| `auto-merge-max-lines` | `40` | Auto-merge blast-radius guideline (lines) — a weighted input to the `merge-check` verdict, not a hard cutoff. |
| `auto-merge-max-files` | `2` | Auto-merge blast-radius guideline on changed files — same weighted-not-cutoff treatment. |
| `dispatch-batch-size` | `3` | Default drain budget — maximum groups one bare firing attempts, per Step 3's ranking; remainder stays unclaimed. **Migration (refs #1492):** was the pick-menu cap; now caps unattended dispatch directly — a high value now auto-dispatches with zero confirmation. |
| `dispatch-group-size-guard` | `10` | Caps a dispatch group's size before headless `next` excludes it (#1228) — groups are per-record, so only a fast-lane bundle larger than the guard trips it (#3278); bare/`#N` still resolve it — a present human is the required surfacing. |
| `express-lane` | `false` | Opts a project into the express lane (`_shared/express-lane.md`, shared with `/claude-tweaks:flow`): a small, low-risk singleton record builds, tests and merges-on-green in one agent instead of the full `/flow` frame. |
| `express-review-sample-every` | `5` | Sends every Nth express-lane merge through the normal review lenses after merge, filing what they find as records (`_shared/express-lane.md`, shared with `/claude-tweaks:flow`); integer `>= 1`. |
| `dispatch-pick-max-concurrent` (deprecated alias) | — | Deprecated alias for `dispatch-batch-size` — same effect, one warn-tier notice. Removal condition: `deprecated-aliases.md`. |

**Per-firing CLI overrides:** `--budget <n|all>` (with `--batch-size`/`--concurrent` as deprecated aliases, `SKILL.md`'s Input table) overrides `dispatch-batch-size` for this invocation only, and `--priority <band>` filters the drain/`next` candidate pool before ranking — neither writes back to `.claude-tweaks/policy.yml`. CLI arg beats project policy, per `_shared/auto-mode-card.md`'s precedence order.

