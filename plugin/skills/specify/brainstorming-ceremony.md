# Brainstorming Ceremony — design-ceremony handoff

Cited by `SKILL.md`'s cases 1, 4, and 5 (case 5 reads "see case 1 for the
full procedure" and inherits this by that existing pointer, so it carries
no separate citation of its own). Case 1's own citation of this file
avoids the literal word `fast-lane` in its wording — that paragraph
already contains `skip` elsewhere, and `tests/ceremony-profile-roster.test.js`
flags any skill-file line pairing those two words; if you reword case 1's
citation, keep it clear of both words on the same line, or check that
test. Before invoking `/superpowers:brainstorming` at any of those three
sites:

1. Resolve the policy value — no `--run` flag, the same timing
   `specify-auto-continue` (`_shared/policy-schema.md`) already uses,
   since brainstorming completes before any pipeline run directory exists:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/bin/resolve-policy.js" --values design-ceremony
   ```

2. Write the exact text that would otherwise be passed as the Skill
   tool's `args` (case 1/5: the record's title + body; case 4: the bare
   topic string) to a file under your session's scratchpad directory
   (never `/tmp` directly — a Bash write there can land in a per-process
   overlay a later call reads back empty), then compose the actual
   `args` value:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/bin/compose-brainstorm-args.js" \
     --design-ceremony "{resolved value}" --input-file "{temp file path}"
   ```

3. Pass that command's stdout, verbatim, as the `/superpowers:brainstorming`
   Skill tool call's `args`.

On `fast-lane`, the composed `args` gains one prepended sentence asking
brainstorming's Architectural path to present its remaining design
sections as one consolidated block once the decision-carrying clarifying
questions are answered and the approach is chosen — brainstorming's own
final approval gate (its `Do NOT invoke any implementation skill... until
approved` HARD-GATE) is never removed by this instruction; it only
reduces how many times mid-design approval is asked, never whether. On
`standard` (the default) or any other value, the composed `args` is
byte-identical to the record's title+body or topic string alone.

## The "just go" ad-hoc convention

Independent of the `design-ceremony` policy default, a user may say "just
go" (or similar) mid-brainstorm to ask for the same section-consolidation
for that single session only — this already works today as ordinary
LLM-instruction-following inside `/superpowers:brainstorming` itself, and
needs no code change; it is documented here so it is discoverable rather
than something a user finds only by trial. It applies equally to a
`/superpowers:brainstorming` session started standalone, outside any of
`/specify`'s three call sites above — this file's Step 1-3 procedure is
`/specify`'s own way of reaching the same effect by policy default, not
the only way to reach it.
