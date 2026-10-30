// bin/lib/hooks/post-tool-use-failure.js — log tier only (#2783 Deliverable 2).
// Claude Code's own worktree-isolation Bash guard refuses a command in a
// worktree-isolated session or agent ("This session|This agent is isolated in the
// worktree … Refusing to run it|there …"; the text lives in harness-refusal.js,
// which #3819 widened to the agent noun and the worktree-gone template). No PreToolUse/PostToolUse
// consumer sees that refusal; the harness reports it as a PostToolUseFailure whose
// `error` is the full refusal text (measured 2026-10-16 with a headless probe — the
// hooks docs do not state it). Every ordinary non-zero exit fires the same event,
// so only the refusal-text signature counts. Never surfaces a message; never breaks
// a session.
'use strict';
const ctxLib = require('./context');

const { HARNESS_ISOLATION_REFUSAL_RE, classifyRefusal } = require('./harness-refusal');
const COMMAND_EXCERPT_CHARS = 200;

function run(ctx) {
  try {
    const input = (ctx && ctx.input) || {};
    if (input.tool_name !== 'Bash') return {};
    const refusal = classifyRefusal(input.error);
    if (!refusal) return {};
    const toolInput = input.tool_input || {};
    const command = typeof toolInput.command === 'string' ? toolInput.command.slice(0, COMMAND_EXCERPT_CHARS) : null;
    const { dir, attribution } = ctxLib.resolveDenialRunDir(ctx);
    const testTag = process.env.CT_HOOKS_TEST_MODE === '1' ? { test: true } : null;
    ctxLib.appendEvent(dir, 'wd-guard-refusal', { tool: 'Bash', reason: 'harness-worktree-isolation', actor: refusal.actor, variant: refusal.variant, command, ...testTag }, attribution);
  } catch { /* never break a session over bookkeeping */ }
  return {};
}

module.exports = { run, HARNESS_ISOLATION_REFUSAL_RE };
