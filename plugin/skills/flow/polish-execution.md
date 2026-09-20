# Flow — Polish + Re-Verify Execution

Loaded by `/claude-tweaks:flow` Step 4 only when the polish phase actually dispatches — `polish` survived Step 1's step-list resolution (`no-polish` unset) and `steps-and-gates.md`'s polish-phase decision tree selects at least one command. A skipped polish phase (non-frontend spec, `no-polish`, `ceremony-profile: fast-lane`, Impeccable not installed, nothing to fit) never needs this file, and neither does a run that never reaches the polish step.

Follow the polish-phase decision tree in `steps-and-gates.md`. Mechanics specific to /flow:

- Invoke `/claude-tweaks:design-wrapper polish <spec>` via the Skill tool. Wrapper errors stop the pipeline with a "Polish wrapper error" failure card — do not assume partial-and-recoverable.
- Before the polish dispatch, assemble craft context per `_shared/design-craft.md` at runtime and inline the assembled result into what the executing agent receives — this citation is the file's only carrier of that instruction; all assembly logic (source classes, lookup, selection) lives in the contract. Motion-scoped Emil skills (`animate`, `animation-vocabulary`) ride along exactly when the materialized header's `Design-intent:` includes `delightful`; a header carrying no `Design-intent:` skips the motion add-on — the ambient baseline still applies. The refinement dispatch's assembled context now also carries the cached `craft-critic` `code` findings as a sibling "Known craft issues" block, per `skills/design-wrapper/modes/polish.md`'s three-way consumption table — no new staging kind and no new file writes; `decision_summary` may carry a trailing `craft-context` clause, logged unchanged. On the terminal track the assembly is `_shared/terminal-ux.md` + `_shared/design-craft.md` only — no Emil skills, no motion add-on (see `skills/design-wrapper/terminal-routing.md`).
- Append a ledger entry per command invoked (phase: `design`, status: `fixed` for each `commands_invoked` entry, `observation` for each `staged_suggestions` entry — nothing ran for a staged entry, so it is an observation awaiting a human, never a fix). Ledger entries flow through to wrap-up's skill update analysis.
- When `/design-wrapper polish` returns a non-empty `commands_invoked` (and therefore a `decision_summary` field — see `skills/design-wrapper/modes/polish.md` Step 7), append one entry to the auto-decision log at `{run-dir}/decisions.md`, under a `## /flow` heading (create the heading if absent, per the append-only protocol in `_shared/auto-decision-log.md`):
  ```
  - AUTO {HH:MM:SS} — Polish phase: {decision_summary} Files: {files_modified, comma-joined}. Reversibility: high (worktree file edits, revertible via git).
  ```
  This is one entry per polish-phase dispatch, not one per command — `decision_summary` already summarizes every command that ran. Skip this entirely when `commands_invoked` is empty (no `decision_summary` was returned, so there is nothing to log). No commit ref is included — polish's changes are uncommitted at this point (Impeccable edits the working tree directly; see `impeccable-cli.md`).
- When `/design-wrapper polish` returns a non-empty `staged_suggestions`, compose the body for each
  entry, write it to `/tmp/polish-suggestion-{n}.md`, and stage it via
  `node "${CLAUDE_PLUGIN_ROOT}/bin/stage-item.js" --run "$PIPELINE_RUN_DIR" --id "polish-suggestion-{n}" --file "/tmp/polish-suggestion-{n}.md"`
  (`stage-item.js` takes the staged file's extension from `--file`'s own extension, so the temp path
  must end in `.md` — this writes `{run-dir}/staged/polish-suggestion-{n}.md`, same filename as
  before, now anchored the same way `bin/log-decision.js` anchors `decisions.md`), then append one
  `STAGED` entry per entry to `decisions.md` under the same `## /flow` heading. **Branch on the entry's `kind`** — `polish.md` Step 5 stages for two different reasons and its output contract requires consumers to distinguish them; writing every entry as manual-only mislabels the other kind as a command that exists when none was named:

  | `kind` | Staged file body | `decisions.md` line |
  |---|---|---|
  | `manual-only` | `{command} {files} — named by an audit finding's suggestion, manual-only, not auto-dispatched` | `- STAGED {HH:MM:SS} — Polish phase: audit suggested {command} on {files} (manual-only, not auto-dispatched). Staged at staged/polish-suggestion-{n}.md. Reversibility: high (staged only). Surface at Review Console.` |
  | `unclassified` | `{category} finding {id} on {files} — no usable suggestion, no command named: {description}` | `- STAGED {HH:MM:SS} — Polish phase: audit finding {id} ({category}) on {files} had no usable suggestion — no command dispatched. Staged at staged/polish-suggestion-{n}.md. Reversibility: high (staged only). Surface at Review Console for routing.` |

  This fulfills the "so the caller can surface it" promise `design-wrapper/modes/polish.md` Step 5 makes — the Wrap-Up Review Console (`wrap-up/review-console.md`) reads every file under `staged/` generically, so this is the same pattern already used for other staged proposals (e.g. review findings' `.patch` files).
- When polish modified code, set the in-memory `re_verify_ran: true` marker and invoke `/claude-tweaks:test skip-qa`. The wrapper runs types + lint + tests, skips QA story validation (irrelevant after stylistic-only polish), but still runs the Design CLI gate (CLI is not QA).
- One-cycle cap: if the marker is already set, surface "re-verify cycle cap exceeded" and stop — defensive against the decision tree re-entering re-verify.
