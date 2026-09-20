# Dispatch — Configuration

These rows mirror `_shared/work-record-config.md`'s canonical key table (which every filing/shaping/dispatching skill is meant to cite rather than restate) — kept spelled out here too since this is the skill that actually reads and branches on them; check that file when a default or meaning changes to keep this copy in sync. Read via `node "${CLAUDE_PLUGIN_ROOT}/bin/resolve-policy.js" <key> [<key>…]` (`_shared/policy-schema.md`):

| Flag | Default | Meaning |
|---|---|---|
| `dispatch-retry-ceiling` | `3` | Consecutive failures before a dispatched record gets `bot:blocked` and stops auto-retrying. |
| `auto-merge-max-lines` | `40` | Auto-merge blast-radius guideline (lines) — a weighted input to the `merge-check` verdict, not a hard cutoff. |
| `auto-merge-max-files` | `2` | Auto-merge blast-radius guideline on changed files — same weighted-not-cutoff treatment. |
| `dispatch-batch-size` | `3` | Default drain budget — maximum groups one bare firing attempts, per Step 3's ranking; remainder stays unclaimed. **Migration (refs #1492):** was the pick-menu cap; now caps unattended dispatch directly — a high value now auto-dispatches with zero confirmation. |
| `dispatch-group-size-guard` | `10` | Caps a file-overlap group's size before headless `next` excludes it (#1228); bare/`#N` still resolve it — a present human is the required surfacing. |
| `dispatch-pick-max-concurrent` (deprecated alias) | — | Deprecated alias for `dispatch-batch-size` — same effect, one warn-tier notice. Removal condition: `deprecated-aliases.md`. |

**Per-firing CLI overrides:** `--budget <n|all>` (with `--batch-size`/`--concurrent` as deprecated aliases, `SKILL.md`'s Input table) overrides `dispatch-batch-size` for this invocation only, and `--priority <band>` filters the drain/`next` candidate pool before ranking — neither writes back to `.claude-tweaks/policy.yml`. CLI arg beats project policy, per `_shared/auto-mode-card.md`'s precedence order.

