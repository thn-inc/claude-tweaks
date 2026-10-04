'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  listTranscriptFiles,
  extractErrorFindings,
  groupFindings,
  filterByEvidenceBar,
  composeProposalMarkdown,
  runScan,
  bashCommandVerb,
  normalizeErrorLine,
  redactPaths,
  redactSecrets,
  redact,
  MIN_SESSIONS_FLOOR,
} = require('../../../plugin/bin/lib/dream/scan');

function assistantToolUse(id, name, input, timestamp) {
  return {
    type: 'assistant', timestamp, message: { role: 'assistant', content: [{ type: 'tool_use', id, name, input }] },
  };
}

function userToolResult(toolUseId, content, timestamp, isError = true) {
  return {
    type: 'user',
    timestamp,
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: toolUseId, is_error: isError, content }] },
  };
}

function writeTranscript(filePath, events) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, events.map((e) => JSON.stringify(e)).join('\n') + '\n');
}

function tmpConfigDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'dream-'));
}

test('extractErrorFindings: correlates a tool_result error back to its tool_use and builds a signature', () => {
  const dir = tmpConfigDir();
  const file = path.join(dir, 'session-a.jsonl');
  writeTranscript(file, [
    assistantToolUse('t1', 'Bash', { command: 'mv -n a b' }, '2026-10-01T00:00:00Z'),
    userToolResult('t1', 'Exit code 0\nmv: nothing moved (target exists)', '2026-10-01T00:00:01Z'),
  ]);
  const findings = extractErrorFindings({ filePath: file, sessionId: 'session-a' });
  assert.equal(findings.length, 1);
  assert.equal(findings[0].toolName, 'Bash');
  assert.equal(findings[0].commandVerb, 'mv');
  assert.equal(findings[0].sessionId, 'session-a');
  assert.ok(findings[0].signature.startsWith('Bash:mv:'));
  assert.ok(findings[0].command.includes('mv -n a b'));
});

test('extractErrorFindings: a non-error tool_result produces no finding', () => {
  const dir = tmpConfigDir();
  const file = path.join(dir, 'session-a.jsonl');
  writeTranscript(file, [
    assistantToolUse('t1', 'Bash', { command: 'ls' }, '2026-10-01T00:00:00Z'),
    userToolResult('t1', 'file1\nfile2', '2026-10-01T00:00:01Z', false),
  ]);
  const findings = extractErrorFindings({ filePath: file, sessionId: 'session-a' });
  assert.equal(findings.length, 0);
});

test('extractErrorFindings: malformed JSON lines are skipped, not fatal', () => {
  const dir = tmpConfigDir();
  const file = path.join(dir, 'session-a.jsonl');
  fs.writeFileSync(file, 'not json at all\n{"also": "not", "closed":\n');
  assert.doesNotThrow(() => extractErrorFindings({ filePath: file, sessionId: 'session-a' }));
  assert.equal(extractErrorFindings({ filePath: file, sessionId: 'session-a' }).length, 0);
});

test('two-session evidence bar: the SAME signature across two distinct sessions qualifies', () => {
  const dir = tmpConfigDir();
  const sameCommand = 'grep -c foo bar.txt';
  const sameError = 'Exit code 1\n';
  writeTranscript(path.join(dir, 'session-1.jsonl'), [
    assistantToolUse('t1', 'Bash', { command: sameCommand }, '2026-10-01T00:00:00Z'),
    userToolResult('t1', sameError, '2026-10-01T00:00:01Z'),
  ]);
  writeTranscript(path.join(dir, 'session-2.jsonl'), [
    assistantToolUse('t1', 'Bash', { command: sameCommand }, '2026-10-02T00:00:00Z'),
    userToolResult('t1', sameError, '2026-10-02T00:00:01Z'),
  ]);
  const f1 = extractErrorFindings({ filePath: path.join(dir, 'session-1.jsonl'), sessionId: 'session-1' });
  const f2 = extractErrorFindings({ filePath: path.join(dir, 'session-2.jsonl'), sessionId: 'session-2' });
  const groups = groupFindings([...f1, ...f2]);
  assert.equal(groups.length, 1);
  const qualifying = filterByEvidenceBar(groups, 2);
  assert.equal(qualifying.length, 1);
  assert.equal(qualifying[0].sessionIds.size, 2);
});

test('two-session evidence bar: a single-session anomaly (same signature, repeated, one session) is EXCLUDED', () => {
  // This is the structural-enforcement proof the record's Gotchas section
  // asks for: the pattern genuinely exists (groupFindings finds it — this
  // isn't a false negative from missing data), but the evidence-bar filter
  // must drop it because only one distinct session contributed it, even
  // though it occurred twice within that session.
  const dir = tmpConfigDir();
  const command = 'sed -i "" "s/x/y/" file.txt';
  const error = 'Exit code 1\nsed: 1: file.txt: command a expects \\ followed by text';
  writeTranscript(path.join(dir, 'session-solo.jsonl'), [
    assistantToolUse('t1', 'Bash', { command }, '2026-10-01T00:00:00Z'),
    userToolResult('t1', error, '2026-10-01T00:00:01Z'),
    assistantToolUse('t2', 'Bash', { command }, '2026-10-01T00:05:00Z'),
    userToolResult('t2', error, '2026-10-01T00:05:01Z'),
  ]);
  const findings = extractErrorFindings({ filePath: path.join(dir, 'session-solo.jsonl'), sessionId: 'session-solo' });
  const groups = groupFindings(findings);

  // Sanity: the pattern is really there (2 occurrences, exact same signature).
  assert.equal(groups.length, 1);
  assert.equal(groups[0].items.length, 2);
  assert.equal(groups[0].sessionIds.size, 1);

  // The gate: a single contributing session must never qualify, regardless
  // of how many times it repeated within that one session.
  const qualifying = filterByEvidenceBar(groups, MIN_SESSIONS_FLOOR);
  assert.equal(qualifying.length, 0);
});

test('filterByEvidenceBar: minSessions below the floor is clamped up, never weakens the gate', () => {
  const groups = [{
    signature: 'x', toolName: 'Bash', commandVerb: 'x', items: [{}], sessionIds: new Set(['only-one']),
  }];
  assert.equal(filterByEvidenceBar(groups, 1).length, 0);
  assert.equal(filterByEvidenceBar(groups, 0).length, 0);
});

test('listTranscriptFiles: bounds by window-days against a fixed `now`', () => {
  const dir = tmpConfigDir();
  const recent = path.join(dir, 'projects', 'proj', 'recent.jsonl');
  const old = path.join(dir, 'projects', 'proj', 'old.jsonl');
  fs.mkdirSync(path.dirname(recent), { recursive: true });
  fs.writeFileSync(recent, '{}\n');
  fs.writeFileSync(old, '{}\n');
  const now = Date.now();
  fs.utimesSync(recent, new Date(now - 1 * 24 * 60 * 60 * 1000), new Date(now - 1 * 24 * 60 * 60 * 1000));
  fs.utimesSync(old, new Date(now - 30 * 24 * 60 * 60 * 1000), new Date(now - 30 * 24 * 60 * 60 * 1000));

  const files = listTranscriptFiles({ configDir: dir, windowDays: 14, now });
  const names = files.map((f) => path.basename(f.filePath));
  assert.ok(names.includes('recent.jsonl'));
  assert.ok(!names.includes('old.jsonl'));
});

test('listTranscriptFiles: a missing configDir/projects returns an empty list, not a throw', () => {
  const dir = tmpConfigDir();
  assert.deepEqual(listTranscriptFiles({ configDir: path.join(dir, 'nope'), now: Date.now() }), []);
});

test('runScan: end-to-end over a tmp configDir honors the evidence bar', () => {
  const dir = tmpConfigDir();
  const command = 'git stash pop';
  const error = 'Exit code 1\nerror: Your local changes to the following files would be overwritten by merge';
  writeTranscript(path.join(dir, 'projects', 'proj', 's1.jsonl'), [
    assistantToolUse('t1', 'Bash', { command }, '2026-10-01T00:00:00Z'),
    userToolResult('t1', error, '2026-10-01T00:00:01Z'),
  ]);
  writeTranscript(path.join(dir, 'projects', 'proj', 's2.jsonl'), [
    assistantToolUse('t1', 'Bash', { command }, '2026-10-02T00:00:00Z'),
    userToolResult('t1', error, '2026-10-02T00:00:01Z'),
  ]);
  const now = Date.now();
  for (const f of ['s1.jsonl', 's2.jsonl']) {
    fs.utimesSync(path.join(dir, 'projects', 'proj', f), new Date(now), new Date(now));
  }
  const result = runScan({
    configDir: dir, windowDays: 14, minSessions: 2, now,
  });
  assert.equal(result.scannedFiles, 2);
  assert.equal(result.qualifying.length, 1);
  assert.equal(result.qualifying[0].sessionIds.size, 2);
});

test('composeProposalMarkdown: quotes evidence from distinct sessions and states the propose-only model', () => {
  const group = {
    signature: 'Bash:git:error: foo',
    toolName: 'Bash',
    commandVerb: 'git',
    items: [
      {
        sessionId: 's1', timestamp: '2026-10-01T00:00:00Z', command: 'git stash pop', errorExcerpt: 'error: foo',
      },
      {
        sessionId: 's2', timestamp: '2026-10-02T00:00:00Z', command: 'git stash pop', errorExcerpt: 'error: foo',
      },
    ],
    sessionIds: new Set(['s1', 's2']),
  };
  const md = composeProposalMarkdown(group, { windowDays: 14 });
  assert.ok(md.includes('s1'));
  assert.ok(md.includes('s2'));
  assert.ok(md.includes('git stash pop'));
  assert.ok(/nothing has been applied/i.test(md));
  assert.ok(/never edits CLAUDE\.md/i.test(md));
});

test('bashCommandVerb: strips a leading env-var assignment', () => {
  assert.equal(bashCommandVerb('FOO=1 git status'), 'git');
  assert.equal(bashCommandVerb('git status'), 'git');
  assert.equal(bashCommandVerb(undefined), 'bash');
});

test('redactPaths: replaces absolute-path-looking tokens', () => {
  assert.equal(redactPaths('fatal: /Users/alice/repo/file.txt not found'), 'fatal: <path> not found');
});

test('redactSecrets: known credential shapes become <secret>, ordinary text is untouched', () => {
  const cases = [
    ['curl -H "Authorization: Bearer abcDEF1234567890xyz" x', 'curl -H "Authorization: Bearer <secret>" x'],
    ['GITHUB_TOKEN=ghp_abcdefghijklmnopqrstuvwxyz0123 gh api user', 'GITHUB_TOKEN=<secret> gh api user'],
    ['export AWS_SECRET_ACCESS_KEY="wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"', 'export AWS_SECRET_ACCESS_KEY=<secret>'],
    ['mysql --password=hunter22 -u root', 'mysql --password=<secret> -u root'],
    ['tool --api-key sk-proj-abcdefghijklmnopqrstuvwx run', 'tool --api-key <secret> run'],
    ['aws s3 ls # AKIAIOSFODNN7EXAMPLE', 'aws s3 ls # <secret>'],
    ['git stash pop', 'git stash pop'],
  ];
  for (const [input, expected] of cases) assert.equal(redactSecrets(input), expected, input);
});

test('redact: applies secret redaction, then path redaction', () => {
  assert.equal(
    redact('GITHUB_TOKEN=ghp_abcdefghijklmnopqrstuvwxyz0123 node /Users/alice/repo/bin/x.js'),
    'GITHUB_TOKEN=<secret> node <path>',
  );
});

test('extractErrorFindings: the quoted command and a path-shaped verb are redacted', () => {
  const dir = tmpConfigDir();
  const file = path.join(dir, 'session-r.jsonl');
  writeTranscript(file, [
    assistantToolUse('t1', 'Bash', { command: 'GITHUB_TOKEN=ghp_abcdefghijklmnopqrstuvwxyz0123 /Users/alice/bin/deploy --to /Users/alice/repo/out' }, '2026-10-01T00:00:00Z'),
    userToolResult('t1', 'Exit code 1\ndeploy: failed', '2026-10-01T00:00:01Z'),
  ]);
  const [finding] = extractErrorFindings({ filePath: file, sessionId: 'session-r' });
  assert.ok(!finding.command.includes('/Users/alice'), finding.command);
  assert.ok(!finding.command.includes('ghp_'), finding.command);
  assert.ok(finding.command.includes('<path>') && finding.command.includes('<secret>'), finding.command);
  assert.equal(finding.commandVerb, '<path>');
  assert.ok(!finding.signature.includes('/Users/alice'), finding.signature);
});

test('normalizeErrorLine: a secret in the first error line never reaches the signature', () => {
  const line = normalizeErrorLine('Exit code 1\nauth failed for GITHUB_TOKEN=ghp_abcdefghijklmnopqrstuvwxyz0123');
  assert.ok(!line.includes('ghp_'), line);
  assert.ok(line.includes('<secret>'), line);
});

test('composeProposalMarkdown: a proposal built from real findings quotes no raw path or token', () => {
  const dir = tmpConfigDir();
  const events = (sid) => [
    assistantToolUse('t1', 'Bash', { command: 'curl -H "Authorization: Bearer abcDEF1234567890xyz" -o /Users/alice/tmp/out.json https://example.com' }, '2026-10-01T00:00:00Z'),
    userToolResult('t1', 'Exit code 22\ncurl: (22) The requested URL returned error: 401', '2026-10-01T00:00:01Z'),
  ];
  writeTranscript(path.join(dir, 'a.jsonl'), events('a'));
  writeTranscript(path.join(dir, 'b.jsonl'), events('b'));
  const findings = [
    ...extractErrorFindings({ filePath: path.join(dir, 'a.jsonl'), sessionId: 'a' }),
    ...extractErrorFindings({ filePath: path.join(dir, 'b.jsonl'), sessionId: 'b' }),
  ];
  const [group] = groupFindings(findings);
  const md = composeProposalMarkdown(group, { windowDays: 14 });
  assert.ok(!md.includes('/Users/alice'), md);
  assert.ok(!md.includes('abcDEF1234567890xyz'), md);
  assert.ok(md.includes('Bearer <secret>'), md);
});

test('redact: a huge keyword-bearing tool output stays fast (input is capped before the secret regexes run)', () => {
  // Uncapped, SECRET_NAME's unbounded runs backtrack quadratically here (~2 s at 120k chars).
  const huge = 'TOKEN'.repeat(24000);
  const started = Date.now();
  const out = redact(huge);
  assert.ok(Date.now() - started < 500, `redact took ${Date.now() - started} ms`);
  assert.ok(out.startsWith('TOKEN'), out.slice(0, 20));
});
