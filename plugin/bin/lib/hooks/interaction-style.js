// bin/lib/hooks/interaction-style.js — the single source of the
// Interaction-style directive, injected into every session's context once
// by session-start.js rather than restated verbatim in each SKILL.md
// (#1909: 35+ byte-identical 501B copies moved to this one file + the
// SessionStart hook that injects it). docs/skill-authoring.md's
// "Interaction style directive" section documents the convention this
// constant implements.
'use strict';

const INTERACTION_STYLE_DIRECTIVE =
  '> **Interaction style:** Single decisions → one `AskUserQuestion` call, one option marked ' +
  'Recommended. Multi-item → batch table with recommendations pre-filled, then one ' +
  '`AskUserQuestion` for apply-all/override. Never more than one call per decision; resolve each ' +
  'before the next. Terminal `## Next Actions` → plain markdown: paste-ready fully-qualified ' +
  'commands, recommended first and bold, one per line — `AskUserQuestion` there only for a ' +
  'documented machine-consumed decision, named inline.';

module.exports = { INTERACTION_STYLE_DIRECTIVE };
