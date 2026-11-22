'use strict';
// Test-time builder for the lens-reviewer replay (extract-reviews). Archived lens prompts carry absolute paths of the
// machine that ran the review (the main checkout, its worktrees), so the fixture is built under a scratch root at test
// time rather than kept as a static directory. The main checkout sits under a path with a space in it, as this
// repository's own does.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const RUN = '2026-11-01T000000-spec-9';
const RUN_GONE = '2026-11-02T000000-spec-9';

const cleanEnv = () => Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_')));

function put(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

const jsonl = (entries) => `${entries.map((e) => JSON.stringify(e)).join('\n')}\n`;

// A lens prompt in the shape of the 2026-11-21 lens prompts: the worktree inside `git -C "…"`, the diff scope, the
// context bundle, the spec under the worktree, a per-agent SCRATCH path and an Effort line.
function lensPrompt({ mainRoot, worktree, run, lens, scratch, B, H, extra = [] }) {
  const runDir = `${mainRoot}/.claude-tweaks/pipelines/${run}`;
  return [
    `You are a read-only code reviewer for lens ${lens} on record #9's branch.`,
    '',
    `WORKTREE: ${worktree}`,
    `Before your first file operation run \`pwd\` and \`git -C "${worktree}" rev-parse --show-toplevel\`; the toplevel must be that path.`,
    '',
    `Diff scope: base ${B} (merge-base) ... HEAD ${H}`,
    `Shared context bundle (the full diff first, then per-file sections): ${runDir}/review-ctx/context.md — Read it in chunks.`,
    `Record spec (Deliverables, ACs, Gotchas): ${worktree}/.claude-tweaks/pipelines/${run}/work/9-spec.md.`,
    ...extra,
    `SCRATCH: ${runDir}/review-ctx/agent-scratch/${scratch} — any probe script or fixture goes there, never in the repository tree.`,
    '[Effort: medium — apply medium-level reasoning depth to this task.]',
    '',
    'Report a `| Severity | Path:Line | Finding | Evidence |` table, or No findings.',
  ].join('\n');
}

// buildReviewsFixture(root, { decisions, gone, repeat }) -> { mainRoot, runsRoot, transcripts, runName, B, H, worktree }
//   decisions: a fifth dispatch (l3c-a) whose prompt names the run's decisions.md
//   gone:      a second run dir whose one dispatch (l3d-a) names a context bundle that was never written
//   repeat:    a second `Review lens 3a correctness A` dispatch (l3a-a2)
function buildReviewsFixture(root, { decisions = false, gone = false, repeat = false } = {}) {
  const mainRoot = path.join(root, 'main checkout', 'repo');
  const runsRoot = path.join(mainRoot, '.claude-tweaks', 'pipelines');
  const transcripts = path.join(root, 'projects');
  const worktree = `${mainRoot}/.claude/worktrees/flow-spec-9`;
  const git = (...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...args], { cwd: mainRoot, env: cleanEnv(), encoding: 'utf8', windowsHide: true }).trim();

  fs.mkdirSync(mainRoot, { recursive: true });
  git('init', '-q');
  put(path.join(mainRoot, 'src', 'a.js'), Array.from({ length: 20 }, (_, i) => `const a${i + 1} = ${i + 1};`).join('\n') + '\n');
  git('add', '-A');
  git('commit', '-q', '-m', 'B');
  const B = git('rev-parse', 'HEAD');
  put(path.join(mainRoot, 'src', 'a.js'), Array.from({ length: 20 }, (_, i) => `const a${i + 1} = ${i === 9 ? 'null' : i + 1};`).join('\n') + '\n');
  put(path.join(mainRoot, 'src', 'b.js'), Array.from({ length: 10 }, (_, i) => `const b${i + 1} = ${i + 1};`).join('\n') + '\n');
  git('add', '-A');
  git('commit', '-q', '-m', 'H');
  const H = git('rev-parse', 'HEAD');

  // The run directory: written after both commits, so neither commit holds it.
  const runDir = path.join(runsRoot, RUN);
  put(path.join(runDir, 'decisions.md'), [
    '- AUTO 10:00:00 — Reproduction: lens "3a correctness" finding src/a.js:10 reproduced. Confirmed. Reversibility: high.',
    '- AUTO 10:05:00 — Reproduction: lens "3b security" finding src/b.js:4 confirmed by tiebreak:abcdefabcdef. Confirmed. Reversibility: high.',
    '',
  ].join('\n'));
  put(path.join(runDir, 'review-ctx', 'context.md'), [
    `Review head: ${H}`,
    `Spec: ${mainRoot}/.claude-tweaks/pipelines/${RUN}/work/9-spec.md`,
    'diff --git a/src/a.js b/src/a.js',
    '+see .claude-tweaks/pipelines/2025-01-01T000000-spec-1/decisions.md',
    '',
  ].join('\n'));
  put(path.join(runDir, 'work', '9-spec.md'), '# 9: the fixture spec\n\nAcceptance: src/a.js line 10 is no longer null-unsafe.\n');
  put(path.join(runDir, 'packet-inputs', 'manifest.json'), `${JSON.stringify({ mergeBase: B })}\n`);

  const subagents = path.join(transcripts, 'slug', 'sess', 'subagents');
  const items = [];
  // One lens dispatch: its timing.json item and its transcript (the prompt, then a reply recorded at effort medium).
  const dispatch = (dir, { agentId, description, lens, scratch, reply, run = RUN, extra }) => {
    dir.push({ agentId, description, tier: 'standard', role: 'lens reviewer', tokens: { output: 1 } });
    const prompt = lensPrompt({ mainRoot, worktree, run, lens, scratch, B, H, extra });
    put(path.join(subagents, `agent-${agentId}.jsonl`), jsonl([
      { type: 'user', message: { role: 'user', content: prompt } },
      { type: 'assistant', effort: 'medium', message: { role: 'assistant', content: [{ type: 'text', text: reply }] } },
    ]));
  };
  const table = (...rows) => ['| Severity | Path:Line | Finding | Evidence |', '|---|---|---|---|', ...rows].join('\n');

  dispatch(items, { agentId: 'l3a-a', description: 'Review lens 3a correctness A', lens: '3a', scratch: '3a-a', reply: table('| high | src/a.js:10 | archived-row-alpha | e |') });
  dispatch(items, { agentId: 'l3a-b', description: 'Review lens 3a correctness B', lens: '3a', scratch: '3a-b', reply: 'No findings.' });
  dispatch(items, { agentId: 'l3b-a', description: 'Review lens 3b security A', lens: '3b', scratch: '3b-a', reply: table(`| medium | ${worktree}/src/b.js:4 | archived-row-beta | e |`) });
  dispatch(items, { agentId: 'l3b-b', description: 'Review lens 3b security B', lens: '3b', scratch: '3b-b', reply: 'I looked around and the change seems fine overall.' });
  // Not a lens reviewer: never a slot, never an exclusion.
  items.push({ agentId: 'impl-1', description: 'Implement task 1', tier: 'standard', role: 'implementer' });
  if (decisions) {
    dispatch(items, {
      agentId: 'l3c-a', description: 'Review lens 3c tests A', lens: '3c', scratch: '3c-a',
      extra: [`Earlier verdicts: ${mainRoot}/.claude-tweaks/pipelines/${RUN}/decisions.md`],
      reply: table('| low | src/b.js:7 | archived-row-gamma | e |'),
    });
  }
  if (repeat) dispatch(items, { agentId: 'l3a-a2', description: 'Review lens 3a correctness A', lens: '3a', scratch: '3a-a2', reply: 'No findings.' });
  put(path.join(runDir, 'timing.json'), `${JSON.stringify({ dispatches: { items } }, null, 2)}\n`);

  if (gone) {
    const goneDir = path.join(runsRoot, RUN_GONE);
    put(path.join(goneDir, 'decisions.md'), '- AUTO 11:00:00 — Reproduction: lens "3d docs" finding src/a.js:3 reproduced. Confirmed. Reversibility: high.\n');
    const goneItems = [];
    dispatch(goneItems, { agentId: 'l3d-a', description: 'Review lens 3d docs A', lens: '3d', scratch: '3d-a', run: RUN_GONE, reply: 'No findings.' });
    put(path.join(goneDir, 'timing.json'), `${JSON.stringify({ dispatches: { items: goneItems } }, null, 2)}\n`);
  }

  return { mainRoot, runsRoot, transcripts, runName: RUN, B, H, worktree };
}

module.exports = { buildReviewsFixture, RUN, RUN_GONE };
