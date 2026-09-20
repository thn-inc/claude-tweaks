const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.join(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(REPO_ROOT, relativePath), 'utf8');
}

function mdFilesUnder(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...mdFilesUnder(full));
    else if (entry.name.endsWith('.md')) out.push(full);
  }
  return out;
}

test('claim-outcomes.md is deleted', () => {
  assert.strictEqual(fs.existsSync(path.join(REPO_ROOT, 'plugin/skills/dispatch/claim-outcomes.md')), false);
});

test('flow/claim-targets.md exists and is referenced by flow/SKILL.md Step 2.8', () => {
  assert.strictEqual(fs.existsSync(path.join(REPO_ROOT, 'plugin/skills/flow/claim-targets.md')), true);
  const skillMd = read('plugin/skills/flow/SKILL.md');
  assert.match(skillMd, /2\.8 — Claim the targets/);
  assert.match(skillMd, /claim-targets\.md/);
});

test('claim-targets.md skip-guard keys on run-identity match and the local-files backend', () => {
  const content = read('plugin/skills/flow/claim-targets.md');
  assert.match(content, /claim\.runId === basename\(\$PIPELINE_RUN_DIR\)/);
  assert.match(content, /work-backend.*local-files/);
});

test('dispatch/SKILL.md Step 4 is mint-only — no claim-only modifier remains', () => {
  const content = read('plugin/skills/dispatch/SKILL.md');
  assert.doesNotMatch(content, /claim-only/);
  assert.match(content, /Mint the selected group's run directory/);
  assert.doesNotMatch(content, /bootstrap-then-add `bot:in-progress`/);
});

test('dispatch/SKILL.md argument-hint drops --claim-only', () => {
  const hintLine = read('plugin/skills/dispatch/SKILL.md')
    .split('\n')
    .find((l) => l.startsWith('argument-hint:'));
  assert.ok(hintLine, 'argument-hint line should exist');
  assert.doesNotMatch(hintLine, /claim-only/);
  assert.match(hintLine, /--budget/);
});

test('task-prompt.md first template no longer claims "already-claimed"; second still does', () => {
  const content = read('plugin/skills/dispatch/task-prompt.md');
  assert.match(content, /Execute claude-tweaks build\+test for this file-overlap group of/);
  assert.doesNotMatch(content, /Execute claude-tweaks build\+test for this already-claimed/);
  assert.match(content, /Execute claude-tweaks review\+polish\+wrap-up for this already-claimed/);
});

test('task-prompt.md documents DISPATCH_HEADLESS for headless firings', () => {
  assert.match(read('plugin/skills/dispatch/task-prompt.md'), /DISPATCH_HEADLESS/);
});

test('task-prompt.md keys DISPATCH_HEADLESS on Routine-fired presence, not the next form (refs #1492)', () => {
  const content = read('plugin/skills/dispatch/task-prompt.md');
  assert.match(content, /Add it when this firing came from a scheduled Routine/);
  assert.doesNotMatch(content, /Add it only when the dispatching session's own firing was `next`-form/);
});

test('_shared/headless-self-report.md documents the Step 2.8 contest trigger', () => {
  const content = read('plugin/skills/_shared/headless-self-report.md');
  assert.match(content, /flow-step-2\.8-claim-contest|Step 2\.8 claim contest/);
});

test('settle-and-merge.md documents the claim-contest special case', () => {
  const content = read('plugin/skills/dispatch/settle-and-merge.md');
  assert.match(content, /Claim-contest special case/);
  assert.match(content, /DISPATCH_HEADLESS/);
});

test('issue-claims.md "The lock" step 4 checks for an in-flight PR before a tombstone/stale reclaim (#315, #974)', () => {
  const content = read('plugin/skills/_shared/issue-claims.md');
  const step4Start = content.indexOf("4. **`state: 'tombstone'` or `'stale'`**");
  assert.ok(step4Start !== -1, 'step 4 heading should exist');
  const step5Start = content.indexOf("5. **`state: 'live'`**", step4Start);
  assert.ok(step5Start !== -1, "step 5 heading should exist after step 4");
  const step4 = content.slice(step4Start, step5Start);
  assert.match(step4, /pr-opened:/);
  assert.match(step4, /mcp__github__pull_request_read/);
  assert.match(step4, /OPEN/);
  assert.match(step4, /fail-open/);
});

test('claim-targets.md in-flight card routes into resume-confirmation.md, gated on DISPATCH_HEADLESS (#958)', () => {
  const content = read('plugin/skills/flow/claim-targets.md');
  const cardStart = content.indexOf('## Flow: Claim in-flight');
  assert.ok(cardStart !== -1, 'in-flight card region should exist');
  const sectionEnd = content.indexOf('\n- **4** —', cardStart);
  assert.ok(sectionEnd !== -1, 'in-flight section should end before the exit-4 bullet');
  const section = content.slice(cardStart, sectionEnd);
  // The stale "Known gap ... unimplemented" framing must be gone, replaced by an actual route.
  assert.doesNotMatch(section, /Known gap/);
  assert.doesNotMatch(section, /hook-in is unimplemented/);
  assert.match(section, /DISPATCH_HEADLESS/);
  assert.match(section, /dispatch\/resume-confirmation\.md/);
  assert.match(section, /claude-tweaks-run: \{run-id\}/);
  assert.match(section, /check-resume-freshness/);
});

test('resume-confirmation.md documents claim-targets.md as a second caller (#958)', () => {
  const content = read('plugin/skills/dispatch/resume-confirmation.md');
  assert.match(content, /flow\/claim-targets\.md/);
  assert.match(content, /#958/);
});

test('settle-and-merge.md Claim-contest special case also covers the Claim in-flight stop, with a distinct failing-check-name (review finding, #958)', () => {
  const content = read('plugin/skills/dispatch/settle-and-merge.md');
  const sectionStart = content.indexOf('**Claim-contest special case');
  assert.ok(sectionStart !== -1, 'Claim-contest special case section should exist');
  const sectionEnd = content.indexOf('\n1. The CLI in step 2', sectionStart);
  assert.ok(sectionEnd !== -1, 'special-case section should end before the numbered steps');
  const section = content.slice(sectionStart, sectionEnd);
  assert.match(section, /Claim in-flight/);
  assert.match(section, /flow-step-2\.8-claim-in-flight/);
  // both failing-check-names must be distinct and both present
  assert.match(section, /flow-step-2\.8-claim-contest/);
});

test('mcp-transport.md no longer carries claim-write sections', () => {
  const content = read('plugin/skills/dispatch/mcp-transport.md');
  assert.doesNotMatch(content, /## Step 4 — claiming a group/);
  assert.doesNotMatch(content, /## Step 4 — `--claim-only` release/);
});

test('claim-targets.md claim read cites issue-claims.md steps 1-2 — no raw base64 -d pipe (#720)', () => {
  const content = read('plugin/skills/flow/claim-targets.md');
  assert.doesNotMatch(content, /base64 -d/);
  assert.match(content, /__ABSENT__/);
  assert.match(content, /@base64d/);
});

test('every base64 -d claim read under skills/ handles the absent-file case, not just cites issue-claims.md (#720, #780)', () => {
  const offenders = [];
  for (const file of mdFilesUnder(path.join(REPO_ROOT, 'plugin', 'skills'))) {
    const text = fs.readFileSync(file, 'utf8');
    if (!/ref=claims-registry/.test(text) || !/base64 -d/.test(text)) continue;
    // A citation to issue-claims.md is no longer sufficient on its own (#780) — the read
    // itself must show it handles the absent/404 case, via the __ABSENT__ sentinel or an
    // equivalent explicit `|| null` / not-found branch.
    const absentBranch = /__ABSENT__|\|\| null|404/.test(text);
    if (!absentBranch) offenders.push(path.relative(REPO_ROOT, file));
  }
  assert.deepStrictEqual(offenders, []);
});

test('issue-claims.md step 1 spells out the 404->__ABSENT__ exit-status branch as a shell snippet (#780)', () => {
  const content = read('plugin/skills/_shared/issue-claims.md');
  const step1Start = content.indexOf('1. Read the claim file at the payload');
  assert.ok(step1Start !== -1, 'step 1 heading should exist');
  const step2Start = content.indexOf('2. **Extract the content before classifying', step1Start);
  assert.ok(step2Start !== -1, 'step 2 heading should exist after step 1');
  const step1 = content.slice(step1Start, step2Start);
  assert.match(step1, /```bash/);
  assert.match(step1, /404/);
  assert.match(step1, /__ABSENT__/);
});

test('issue-claims.md step 2 extracts .content before classifying — never passes the wrapper object (#780)', () => {
  const content = read('plugin/skills/_shared/issue-claims.md');
  const step2Start = content.indexOf('2. **Extract the content before classifying');
  assert.ok(step2Start !== -1, 'step 2 heading should exist');
  const step3Start = content.indexOf("3. **`state:", step2Start);
  assert.ok(step3Start !== -1, 'step 3 heading should exist after step 2');
  const step2 = content.slice(step2Start, step3Start);
  assert.match(step2, /field's value/i);
  assert.match(step2, /never the wrapper object/i);
  assert.match(step2, /jq -r '\.content'|jq -r \.content/);
});

test('issue-claims.md "Reading claim state" section does not restate the old wrapper-object bug (#780)', () => {
  const content = read('plugin/skills/_shared/issue-claims.md');
  const sectionStart = content.indexOf('## Reading claim state');
  assert.ok(sectionStart !== -1, 'Reading claim state section should exist');
  const sectionEnd = content.indexOf('## TTL and staleness');
  assert.ok(sectionEnd !== -1, 'TTL and staleness section should exist after it');
  const section = content.slice(sectionStart, sectionEnd);
  assert.match(section, /"The lock" step 1-2 above/);
  assert.match(section, /already-extracted/);
});

test('scan-procedures.md claim read no longer pipes to bare base64 -d with no absent branch (#780)', () => {
  const content = read('plugin/skills/tidy/scan-procedures.md');
  assert.doesNotMatch(content, /-q '\.content' \| base64 -d/);
  assert.match(content, /__ABSENT__/);
});

test('contest card renders holder liveness — three verdict variants, each with a next step (#722)', () => {
  const content = read('plugin/skills/flow/claim-targets.md');
  assert.match(content, /Live sibling on this machine/);
  assert.match(content, /Remote holder/);
  assert.match(content, /Stale holder — no activity since/);
  assert.match(content, /sessionId/);
  assert.match(content, /git worktree list/);
  assert.match(content, /~\/\.claude\/projects\//);

  // Extract the card region (the fenced ```markdown block for "## Flow: Claim contested")
  // and confirm each of the three verdict variants carries its own "Next:" step.
  const cardStart = content.indexOf('## Flow: Claim contested');
  assert.ok(cardStart !== -1, 'card region should exist');
  const cardEnd = content.indexOf('```', cardStart);
  const card = content.slice(cardStart, cardEnd);
  const nextCount = (card.match(/Next:/g) || []).length;
  assert.strictEqual(nextCount, 3, 'card should carry exactly one "Next:" step per verdict variant');
  assert.match(card, /Live sibling on this machine[\s\S]*?Next: wait for it to finish or release/);
  assert.match(card, /Remote holder \(\{holder-host\}\)\. Next: inspect that session/);
  assert.match(card, /Stale holder — no activity since[\s\S]*?Next: \{if step 3 matched a worktree/);
});

test('contest card weighs worktree evidence before recommending reclaim on a Stale-holder verdict (#722)', () => {
  const content = read('plugin/skills/flow/claim-targets.md');
  // Step 5's verdict rule must not let a matched (possibly-live) worktree be reclaimed on the
  // strength of an absent transcript alone.
  assert.match(content, /Stale-holder next step must not recommend reclaim/);
  assert.match(content, /inspect the matched worktree/);
  // The card's Stale variant must render that softened next step conditionally rather than
  // unconditionally pointing at /tidy reclaim.
  assert.match(content, /inspect it\s*\n\s*before any reclaim; a locked worktree usually means a live session/);
});

test('contest liveness lookup is evidence-gathering, never a gate or a prompt (#722)', () => {
  const content = read('plugin/skills/flow/claim-targets.md');
  assert.match(content, /never block on the lookup|evidence, not an error/);
  assert.match(content, /session-evaluation\.md/);
  // the card remains a stop: the section still forbids AskUserQuestion
  assert.match(content, /No `AskUserQuestion`/);
});

test('claim step invokes bin/claim-targets.js — no per-target gh api snippet remains (#723)', () => {
  const content = read('plugin/skills/flow/claim-targets.md');
  assert.match(content, /bin\/claim-targets\.js/);
  const claimSection = content.split('## Claim every named target')[1];
  assert.ok(claimSection, 'claim section heading must exist');
  assert.doesNotMatch(claimSection, /gh api "repos/);
  assert.doesNotMatch(claimSection, /gh issue edit "\$ISSUE"/);
  // the canonical-read citation tokens survive (pinned by the #720 tests too)
  assert.match(content, /__ABSENT__/);
  assert.match(content, /@base64d/);
});

test('multi-spec pre-flight and dispatch cite bin/preflight-records.js (#723)', () => {
  assert.match(read('plugin/skills/flow/multi-spec.md'), /bin\/preflight-records\.js/);
  assert.match(read('plugin/skills/dispatch/SKILL.md'), /bin\/preflight-records\.js/);
});

test('claim-targets.md mandates a decisions.md log line on successful claim, and names the missing mechanical backstop (#2492)', () => {
  const content = read('plugin/skills/flow/claim-targets.md');
  const claimSection = content.split('## Claim every named target')[1];
  assert.ok(claimSection, 'claim section heading must exist');
  // The mandatory post-claim log-decision.js call — a local, durable trace
  // independent of a fresh gh/MCP read against claims-registry.
  assert.match(claimSection, /Log the claim \(mandatory, #2492\)/);
  assert.match(claimSection, /bin\/log-decision\.js.*--run "\$PIPELINE_RUN_DIR" --status AUTO/s);
  assert.match(claimSection, /--step "Step 2\.8"/);
  // The known-gap note: no mechanical backstop exists yet, unlike the
  // sibling worktree/PR bookkeeping stamps checkBookkeepingStampsGate already
  // enforces — this must stay an honest "not yet enforced" note, not a claim
  // that the gap is closed.
  assert.match(claimSection, /Known gap: this step has no mechanical backstop today/);
  assert.match(claimSection, /checkBookkeepingStampsGate/);
  assert.match(claimSection, /claims\/issue-\{n\}\.json/);
});
