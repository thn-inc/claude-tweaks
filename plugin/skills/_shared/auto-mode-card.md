# Auto-Mode Operating Card

The minimal facts a **child** skill needs to implement its own auto branch correctly, without loading the full contract. This is a subset, never a redefinition — every clause below exists verbatim-or-tighter in `_shared/auto-mode-contract.md`, which stays the single source of truth for precedence disputes, the reversibility/confidence floors and severity ceiling, the Bookend Architecture rationale, the full per-skill "What `auto` silences" table, and the anti-patterns list. Cite the full contract instead of this card when: authoring a NEW auto branch (the Skill integration pattern lives there), resolving a precedence or floor dispute, or the skill is `/flow` itself (the orchestrator that owns the Manifesto/Review Console bookend).

## Mode states

| Mode | When set | Behavior |
|---|---|---|
| `auto` | **`/flow`'s default**; also explicit `auto` arg or `auto-mode: default-on` in `.claude-tweaks/policy.yml` | Bookend architecture with the begin stop as a **read-only FYI** — the only user-facing stop is the end Review Console. Pure automation in the middle. HARD-GATEs and mandatory user-input items still fire. |
| `confirm` | Explicit `confirm` arg | Same as `auto`, but the begin stop is a real **approval gate**. After approval, the rest of the pipeline runs as `auto`. |
| `hybrid` | Explicit `hybrid` arg | Begin stop is an approval gate; downstream skills also auto-resolve only when reversibility:high AND confidence:high AND severity ≤ low — everything else asks. Review Console still runs at end. |
| `interactive` | Explicit `interactive` arg, or `auto-mode: default-off` in `.claude-tweaks/policy.yml` — except a `/flow` run whose run dir is bound `dispatched: true` (`run-state.json`), which resolves `auto`; an explicit `interactive` arg still wins there | No Manifesto presented; skills present each decision in-flow as the standalone skills do. |

## Decision precedence

Highest wins:

1. **Explicit CLI arg** for this invocation — checked by the skill itself
2. **Pipeline config** — `config.yml` in the run directory (Config Manifesto answers)
3. **Project policy** — `.claude-tweaks/policy.yml`
4. **Skill default** — the skill's own fallback

Levels 2–4 execute via ONE call — `node "${CLAUDE_PLUGIN_ROOT}/bin/resolve-policy.js" --run "$PIPELINE_RUN_DIR" <key>` — whose envelope's `source` field reports which level decided (full mechanism: the contract's Decision precedence section).

## What `auto` does NOT silence (never-silenced list)

Regardless of `auto` state, these always require explicit user input — or, for the rendering bullets (failure cards, the terminal block), are always rendered — except where a bullet below states its own carve-out — see the full contract for the "why mandatory" rationale on each:

- Ledger resolve gate Phase 2 (every open item, per-item) — except the narrow `autonomy` ceiling's `ledgerNarrowing` (`trusted`+) and `ledgerRouteRemainder` (`unattended`) carve-outs
- Work-record creation (new backlog records, `Q#`) — folded into the Review Console's "Approve all" at `supervised`/`trusted`, auto-resolved under `consoleAutoResolve` at `unattended` — see the contract's tiered stance
- Ops-acknowledgment, when ops items exist — except `opsAckAutoAcknowledge` (`unattended` only)
- Memory file writes (`/wrap-up`'s Memory curation row, `M#`) — folded into the Review Console's "Approve all" at `supervised`/`trusted`, auto-resolved under `consoleAutoResolve` at `unattended` — see the contract's tiered stance
- Upstream feedback filing (`/claude-tweaks:feedback`, `U#`) — folded into the Review Console's "Approve all" at `supervised`/`trusted`, auto-resolved under `consoleAutoResolve` at `unattended` — see the contract's tiered stance
- Marking records `parked`
- `/init` Phase 4/8/9 and its scope-selection gate
- HARD-GATE / BLOCKED / STOP conditions (spec compliance, test gate, design-doc rejection, plan validation, plan-audit hard-fails)
- Any skill's own local-files Preflight-stop or equivalent explicit authorization gate
- Hard validation failures (uncommitted changes, missing prereqs, malformed input)
- Final pipeline failure cards
- Terminal `## Next Actions` block — always rendered, in every mode including `unattended`; plain markdown, outside `consoleAutoResolve`'s scope
- Code modifications outside the skill's documented scope — except the narrow, capped pointer-repair carve-out under `trusted`/`unattended` autonomy
- Resolution of merge conflicts in worktree finishing
- Design intent, when the manifesto value is `none` AND the skill detects creative work

## Log-line format

Every auto-resolution appends one line to `{run-dir}/decisions.md`, under a `## /{skill}` heading:

```
- AUTO {HH:MM:SS} — {step name}: applied {value}. Reason: {policy-source}. Reversibility: {high|med|low}.
```

When a floor fails (reversibility != high, or confidence != high, or severity > low), stage instead of applying, and surface at the Wrap-Up Review Console:

```
- STAGED {HH:MM:SS} — {step name}: {what was found}. Stage path: staged/{slug}.{ext}.
```

Full schema (per-skill sections, `AUTO`/`STAGED`/`KEPT-PROMPT` status vocabulary, archival) — `_shared/auto-decision-log.md`.
