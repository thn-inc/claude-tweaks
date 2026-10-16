# Critics — track-keyed roster of project-local craft critics

The single, curated roster of project-local design critics that `/claude-tweaks:design-wrapper`'s `review` mode dispatches at Step 3.8 (`modes/review.md`, #598). It is read only there. Adding a critic provider means adding a row to the table below; there is deliberately **no per-project manifest**. An open manifest (the shape #573 proposed) was rejected because it reverses `skills/_shared/design-craft.md`'s posture — upstream skills are wired by deliberate choice, not accident — and because arbitrary skills' output shapes cannot be normalized at the boundary; a curated row is the only place a critic's reply shape is known well enough to normalize.

## Roster

| Track | Critic | Trigger |
|---|---|---|
| `web` | `emil-design-eng` | Lever `full` → every web-track UI diff; `auto` → decisions present, or motion signal, or `Design-intent:` set on the record; `off` → never |
| `web` | `review-animations` | Motion signal, lever ≠ `off`. Deliberately not forced by `full` — the skill is motion-scoped; without a motion signal there is nothing for it to review |
| `ios` / `android` / `adaptive` | *none* | Deliberate: Impeccable's `critique`/`audit` already run natively with the platform named (`native-routing.md`); Emil is web-only (`design-craft.md` Gating). No decisions pushback on native until a row exists — a stated gap, not a hole; see the unblocking condition below the table |
| `terminal` | `_shared/terminal-ux.md` | Lever `full` → every terminal-track diff; `auto` → the record's spec/description names CLI/TTY UX work — help/usage text, CLI output formatting or `--json`/quiet/verbose modes, progress/spinner output, error messages or exit codes, interactive prompts — or carries a `Design-intent:` line (value other than `none`); consumer judgment, the same posture as `design-craft.md`'s motion signal; `off` → never. No decisions layer on this track — the critic emits `code` rows only |

`Track` values come from `SKILL.md`'s track-resolution table plus `terminal`. `Critic` is an upstream skill name resolvable via the lookup cited under Resolution below, or the literal `none` / `pending`. `Trigger` prose references only the three signals defined next, plus the `Design-intent:` record line cited below them.

## Trigger signals

Exactly three signals feed the Trigger column, plus the `Design-intent:` record line defined below them. None is defined here — each is cited to its one home:

- **Motion signal** — the motion signal defined in `skills/_shared/design-craft.md`'s **Relevance map** section (the `animate`/`animation-vocabulary` row's trigger). Cited by section name, never restated: it is an LLM judgment call there and stays one here.
- **Decisions present** — Layer 0's `hasDesign` signal (`skills/design-wrapper/SKILL.md` Layer 0, `impeccable-plugin.md`'s `setup.hasDesign`). When Layer 0 is degraded (absent plugin, version mismatch, execution failure — no signals), fall back to a direct `DESIGN.md` existence check using `skills/_shared/visual-html-output.md`'s three-path lookup.
- **Lever** — the resolved `design-critique` policy value: `off | auto | full` (schema entry owned by #595; read via `bin/resolve-policy.js` by the Step 3.8 procedure, #598). `full` and `off` are the two escape hatches; `auto` conditions on the other two signals as the table states per row.

`Design-intent:` in the table is the record body-metadata line defined in `skills/specify/spec-template.md`'s metadata block.

## Resolution

Every critic name in the table resolves through `skills/_shared/design-craft.md`'s **Emil skill resolution** lookup, per skill name — `review-animations` is an Emil skill from the same upstream set and resolves exactly the same way as `emil-design-eng`. A name resolving at none of that lookup's paths is absent — handled per that file's **Degradation posture** (never a gate, never a stop); how the Step 3.8 dispatch records an absent critic is defined by `modes/review.md` (#598), not here. The one exception is the `terminal` row: `_shared/terminal-ux.md` is plugin-authored and resolves at `${CLAUDE_PLUGIN_ROOT}/skills/_shared/terminal-ux.md` — no multi-path lookup, never absent.

## Native row — unblocking condition

A native critic row is added only if a native-track craft-principles source ships upstream (an Emil-equivalent for SwiftUI/Compose), or Impeccable's native `critique`/`audit` prove insufficient in dogfooding — never by copying the web rows onto the native track, which `design-craft.md`'s Gating forbids.
