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
// `member` puts the bundle, spec and scratch under that spec-{N} member; `scope` replaces the diff scope line.
function lensPrompt({ mainRoot, worktree, run, lens, scratch, B, H, extra = [], member = null, scope = `Diff scope: base ${B} (merge-base) ... HEAD ${H}` }) {
  const runDir = `${mainRoot}/.claude-tweaks/pipelines/${run}${member ? `/${member}` : ''}`;
  return [
    `You are a read-only code reviewer for lens ${lens} on record #9's branch.`,
    '',
    `WORKTREE: ${worktree}`,
    `Before your first file operation run \`pwd\` and \`git -C "${worktree}" rev-parse --show-toplevel\`; the toplevel must be that path.`,
    '',
    scope,
    `Shared context bundle (the full diff first, then per-file sections): ${runDir}/review-ctx/context.md — Read it in chunks.`,
    `Record spec (Deliverables, ACs, Gotchas): ${worktree}/.claude-tweaks/pipelines/${run}${member ? `/${member}` : ''}/work/9-spec.md.`,
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
//   edges:     one dispatch per remaining exclusion reason (e-noside unlabelled, e-tier no-archived-tier, e-notx
//              no-transcript, e-nosha no-sha-range, e-gone unknown commit, e-leak a main-checkout path no rewrite
//              covers), a fast/low slot naming origin/main and only the head (e-fast), a standard slot with no
//              recorded effort (e-high), a spec-2 member whose own timing.json holds one slot (e-m2), and a spec-10
//              member with no decisions.md of its own (e-m10)
//   twin:      with edges, e-m10 reviews lens 3g side A as e-m2 does, in its own unit
//   lead:      an excluded first dispatch before l3a-a (l3a-a0, report-unparsed) and before l3b-a (l3b-a0, no-transcript)
//   memberLead: with edges, an excluded first dispatch per member slot: e-m2-0 (3g A, report-unparsed) listed in the
//              run's own timing.json but whose prompt names spec-2, and e-m10-0 (3i A, no transcript) listed in spec-10's
function buildReviewsFixture(root, { decisions = false, gone = false, repeat = false, edges = false, twin = false, lead = false, memberLead = false } = {}) {
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
  // The worktree the prompts name exists on disk, as an archived run's worktrees directory does.
  fs.mkdirSync(worktree, { recursive: true });

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
    // Run-directory paths that are no input of any slot: each one becomes [run-directory path removed] in a copy.
    `Verdicts: ${mainRoot}/.claude-tweaks/pipelines/${RUN}/decisions.md`,
    `Worktree verdicts: ${worktree}/.claude-tweaks/pipelines/${RUN}/decisions.md`,
    `Earlier run: ${mainRoot}/.claude-tweaks/pipelines/2025-01-01T000000-spec-1/review-ctx/context.md`,
    'diff --git a/src/a.js b/src/a.js',
    '+see .claude-tweaks/pipelines/2025-01-01T000000-spec-1/decisions.md',
    '',
  ].join('\n'));
  put(path.join(runDir, 'work', '9-spec.md'), '# 9: the fixture spec\n\nAcceptance: src/a.js line 10 is no longer null-unsafe.\n');
  put(path.join(runDir, 'packet-inputs', 'manifest.json'), `${JSON.stringify({ mergeBase: B })}\n`);

  const subagents = path.join(transcripts, 'slug', 'sess', 'subagents');
  const items = [];
  // One lens dispatch: its timing.json item and its transcript (the prompt, then a reply recorded at effort medium).
  const dispatch = (dir, { agentId, description, lens, scratch, reply, run = RUN, extra, tier = 'standard', effort = 'medium', member, scope, transcript = true }) => {
    dir.push({ agentId, description, tier, role: 'lens reviewer', tokens: { output: 1 } });
    if (!transcript) return;
    const prompt = lensPrompt({ mainRoot, worktree, run, lens, scratch, B, H, extra, member, scope });
    put(path.join(subagents, `agent-${agentId}.jsonl`), jsonl([
      { type: 'user', message: { role: 'user', content: prompt } },
      { type: 'assistant', ...(effort === null ? {} : { effort }), message: { role: 'assistant', content: [{ type: 'text', text: reply }] } },
    ]));
  };
  const table = (...rows) => ['| Severity | Path:Line | Finding | Evidence |', '|---|---|---|---|', ...rows].join('\n');

  if (lead) {
    dispatch(items, { agentId: 'l3a-a0', description: 'Review lens 3a correctness A', lens: '3a', scratch: '3a-a0', reply: 'I looked around.' });
    dispatch(items, { agentId: 'l3b-a0', description: 'Review lens 3b security A', lens: '3b', scratch: '3b-a0', reply: '', transcript: false });
  }
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
  if (edges) {
    const e = (agentId, lens, over) => dispatch(items, { agentId, description: `Review lens ${lens} edge A`, lens, scratch: `${lens}-a`, reply: 'No findings.', ...over });
    e('e-tier', '3e', { tier: 'turbo' });
    e('e-notx', '3e', { transcript: false });
    e('e-nosha', '3e', { scope: 'SCOPE: the diff origin/main...HEAD in that worktree.' });
    e('e-gone', '3e', { scope: `Diff scope: base ${'d'.repeat(40)} (merge-base) ... HEAD ${H}` });
    e('e-leak', '3e', { extra: [`Notes: ${mainRoot}/notes/review.md`] });
    e('e-noside', '3e', { description: 'Review lens 3e edge' });
    // The prompt names only the head: the base comes from the run's recorded merge base.
    e('e-fast', '3f', { tier: 'fast', effort: 'low', scope: `SCOPE: git diff origin/main...HEAD (HEAD ${H}).` });
    // No effort recorded: the archived effort is the tier's own (standard: high).
    e('e-high', '3h', { effort: null });
    if (memberLead) dispatch(items, { agentId: 'e-m2-0', description: 'Review lens 3g ownability A', lens: '3g', scratch: '3g-a0', member: 'spec-2', reply: 'I looked around.' });
    const memberDir = path.join(runDir, 'spec-2');
    put(path.join(memberDir, 'decisions.md'), '- AUTO 12:00:00 — Reproduction: lens "3g" finding src/b.js:2 reproduced. Confirmed. Reversibility: high.\n');
    put(path.join(memberDir, 'review-ctx', 'context.md'), `Member bundle at ${H}\n`);
    put(path.join(memberDir, 'work', '9-spec.md'), '# 9: the member spec\n');
    const memberItems = [];
    dispatch(memberItems, { agentId: 'e-m2', description: 'Review lens 3g ownability A', lens: '3g', scratch: '3g-a', member: 'spec-2', reply: 'No findings.' });
    put(path.join(memberDir, 'timing.json'), `${JSON.stringify({ dispatches: { items: memberItems } }, null, 2)}\n`);
    // spec-10 sorts after spec-2 by number, and has no decisions.md of its own.
    const member10 = path.join(runDir, 'spec-10');
    put(path.join(member10, 'review-ctx', 'context.md'), `Member 10 bundle at ${H}\n`);
    put(path.join(member10, 'work', '9-spec.md'), '# 9: the member-10 spec\n');
    const member10Items = [];
    if (memberLead) dispatch(member10Items, { agentId: 'e-m10-0', description: 'Review lens 3i ux A', lens: '3i', scratch: '3i-a0', member: 'spec-10', reply: '', transcript: false });
    const m10 = twin ? { description: 'Review lens 3g ownability A', lens: '3g', scratch: '3g-a' } : { description: 'Review lens 3i ux A', lens: '3i', scratch: '3i-a' };
    dispatch(member10Items, { agentId: 'e-m10', ...m10, member: 'spec-10', reply: 'No findings.' });
    put(path.join(member10, 'timing.json'), `${JSON.stringify({ dispatches: { items: member10Items } }, null, 2)}\n`);
  }
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

const RUN_BRANCH = '2026-11-03T000000-spec-7';

// A task-review prompt in the shape of the archived task-review prompts: the brief under the worktree, the reviewed
// range as `Base {sha}, Head {sha}` and an Effort line.
function taskPrompt({ worktree, n, base, head }) {
  return [
    `You are reviewing task ${n} of record #7; a broad whole-branch review happens separately once every task is done.`,
    '',
    `WORKTREE: ${worktree}`,
    `Task brief: ${worktree}/.superpowers/sdd/x/task-${n}-brief.md — read it first.`,
    `Base ${base}, Head ${head}. Review that range only.`,
    '[Effort: medium — apply medium-level reasoning depth to this task.]',
    '',
    'End with `Task quality: Approved` or `Task quality: Needs fixes`.',
  ].join('\n');
}

// buildBranchFixture(root, opts) -> { mainRoot, runsRoot, transcripts, runName, worktree, B, T1, T2, F, M, W }
// History (on branch `work`): B (src/x.js, src/y.js), T1 (edits src/y.js), T2 (src/x.js line 10 null-unsafe), F (fixes
// it). Dispatches: t1 (task review of B..T1, Approved), t2 (task review of T1..T2, Needs fixes with a located Important
// and an unlocated Minor item), rr2 (the re-review of T2..F), wb (the whole-branch review of B..F, one Minor item).
//   pointer:         null, or a task review tp whose prompt points at {worktree}/.superpowers/sdd/x/task-2-review-prompt.md;
//                    'present' writes that file with t2's prompt, 'gone' does not
//   pointerShas:     with pointer, tp's pointer prompt also names its own `Base {B}, Head {F}` line
//   catchUp:         a side commit M off B (adds src/z.js) merged into the branch at F as W; wb reviews M..W
//   noWholeBranch:   wb has no transcript
//   wbUnusableFirst: an extra whole-branch item wb0 with no transcript, before wb
//   boldLabel:       a task review t3 of T1..T2 whose Needs fixes reply has bold-label severities only
//   hybrid:          a task review th whose prompt says "in this file" over a lone path to an existing template with
//                    no sha pair, and carries its own `Base {T1}, Head {T2}` line: a full prompt, not a pointer
function buildBranchFixture(root, { pointer = null, catchUp = false, noWholeBranch = false, wbUnusableFirst = false, boldLabel = false, hybrid = false, pointerShas = false } = {}) {
  const mainRoot = path.join(root, 'main checkout', 'repo');
  const runsRoot = path.join(mainRoot, '.claude-tweaks', 'pipelines');
  const transcripts = path.join(root, 'projects');
  const worktree = `${mainRoot}/.claude/worktrees/flow-spec-7`;
  const git = (...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...args], { cwd: mainRoot, env: cleanEnv(), encoding: 'utf8', windowsHide: true }).trim();
  const commit = (message) => {
    git('add', '-A');
    git('commit', '-q', '-m', message);
    return git('rev-parse', 'HEAD');
  };
  const xLines = (nullAt) => Array.from({ length: 20 }, (_, i) => `const x${i + 1} = ${i + 1 === nullAt ? 'null.value' : i + 1};`).join('\n') + '\n';

  // Every commit first: the run directory, the worktree and the transcripts are written after the last one.
  fs.mkdirSync(mainRoot, { recursive: true });
  git('init', '-q', '-b', 'work');
  put(path.join(mainRoot, 'src', 'x.js'), xLines(null));
  put(path.join(mainRoot, 'src', 'y.js'), 'let y1 = 1;\nlet y2 = 2;\n');
  const B = commit('B');
  put(path.join(mainRoot, 'src', 'y.js'), 'let y1 = 1;\nlet y2 = 2;\nlet y3 = 3;\n');
  const T1 = commit('T1');
  put(path.join(mainRoot, 'src', 'x.js'), xLines(10));
  const T2 = commit('T2');
  put(path.join(mainRoot, 'src', 'x.js'), xLines(null));
  const F = commit('F');
  let M = null;
  let W = null;
  if (catchUp) {
    git('checkout', '-q', '-b', 'side', B);
    put(path.join(mainRoot, 'src', 'z.js'), 'const z = 1;\n');
    M = commit('M');
    git('checkout', '-q', 'work');
    git('merge', '-q', '--no-ff', '-m', 'W', 'side');
    W = git('rev-parse', 'HEAD');
  }

  fs.mkdirSync(worktree, { recursive: true });
  const runDir = path.join(runsRoot, RUN_BRANCH);
  put(path.join(runDir, 'work', '7-spec.md'), '# 7: the branch fixture spec\n\nAcceptance: src/x.js line 10 is never null-unsafe.\n');

  const subagents = path.join(transcripts, 'slug', 'sess', 'subagents');
  const items = [];
  const dispatch = ({ agentId, description, role, tier, prompt, reply, effort, transcript = true }) => {
    items.push({ agentId, description, tier, role, tokens: { output: 1 } });
    if (!transcript) return;
    put(path.join(subagents, `agent-${agentId}.jsonl`), jsonl([
      { type: 'user', message: { role: 'user', content: prompt } },
      { type: 'assistant', effort, message: { role: 'assistant', content: [{ type: 'text', text: reply }] } },
    ]));
  };
  const t2Prompt = taskPrompt({ worktree, n: 2, base: T1, head: T2 });
  const t2Reply = `### Issues\n#### Important\n- ${worktree}/src/x.js:10: null deref when y is unset\n#### Minor\n- naming could be clearer\n\nTask quality: Needs fixes`;

  dispatch({ agentId: 't1', description: 'Review task 1', role: 'task review', tier: 'standard', effort: 'medium', prompt: taskPrompt({ worktree, n: 1, base: B, head: T1 }), reply: 'The change is small and correct.\n\nTask quality: Approved' });
  dispatch({ agentId: 't2', description: 'Review task 2', role: 'task review', tier: 'capable', effort: 'high', prompt: t2Prompt, reply: t2Reply });
  dispatch({ agentId: 'rr2', description: 'Re-review task 2 fixes', role: 're-review', tier: 'standard', effort: 'medium', prompt: `Fix diff (${T2}..${F}) for ${worktree}.`, reply: 'ADDRESSED src/x.js:10' });
  if (pointer) {
    const promptFile = `${worktree}/.superpowers/sdd/x/task-2-review-prompt.md`;
    if (pointer === 'present') put(promptFile, t2Prompt);
    dispatch({
      agentId: 'tp', description: 'Review task 2 (pointer)', role: 'task review', tier: 'standard', effort: 'medium',
      prompt: `Your full review instructions are in this file (it is your prompt): ${promptFile}${pointerShas ? `\nBase ${B}, Head ${F}.` : ''}`, reply: t2Reply,
    });
  }
  if (boldLabel) {
    dispatch({
      agentId: 't3', description: 'Review task 2 again', role: 'task review', tier: 'standard', effort: 'medium',
      prompt: taskPrompt({ worktree, n: 2, base: T1, head: T2 }), reply: '**Important**\n- src/x.js:4 off by one\n\nTask quality: Needs fixes',
    });
  }
  if (hybrid) {
    const template = `${worktree}/.superpowers/sdd/x/reviewer-template.md`;
    put(template, 'TEMPLATE-TEXT: review [BRIEF_FILE] between [BASE_SHA] and [HEAD_SHA].\n');
    dispatch({
      agentId: 'th', description: 'Review task 2 (template)', role: 'task review', tier: 'standard', effort: 'medium',
      prompt: `Follow the reviewer instructions in this file exactly:\n${template}\n\n[BRIEF_FILE]: ${worktree}/.superpowers/sdd/x/task-2-brief.md\nBase ${T1}, Head ${T2}.`,
      reply: t2Reply,
    });
  }
  const wbPrompt = [
    'You are a Senior Code Reviewer reviewing the whole branch of record #7.',
    '[Effort: high — apply high-level reasoning depth to this task.]',
    '',
    '## What Was Implemented',
    'A null guard in src/x.js and a new binding in src/y.js.',
    '',
    `WORKTREE: ${worktree}`,
    `Spec: ${worktree}/.claude-tweaks/pipelines/${RUN_BRANCH}/work/7-spec.md`,
    catchUp ? `Base ${M} (the review base). Head ${W}.` : `Base ${B} (the review base). Head ${F}.`,
  ].join('\n');
  const wbReply = '#### Critical (Must Fix)\nNone.\n#### Important (Should Fix)\nNone.\n#### Minor (Nice to Have)\n1. src/y.js:2 could be const';
  if (wbUnusableFirst) dispatch({ agentId: 'wb0', description: 'Whole-branch review', role: 'whole-branch review', tier: 'capable', effort: 'high', prompt: wbPrompt, reply: wbReply, transcript: false });
  dispatch({ agentId: 'wb', description: 'Whole-branch review', role: 'whole-branch review', tier: 'capable', effort: 'high', prompt: wbPrompt, reply: wbReply, transcript: !noWholeBranch });
  put(path.join(runDir, 'timing.json'), `${JSON.stringify({ dispatches: { items } }, null, 2)}\n`);

  return { mainRoot, runsRoot, transcripts, runName: RUN_BRANCH, worktree, B, T1, T2, F, M, W };
}

module.exports = { buildReviewsFixture, buildBranchFixture, RUN, RUN_GONE, RUN_BRANCH, cleanEnv };
