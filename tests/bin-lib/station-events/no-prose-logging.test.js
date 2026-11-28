'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { execFileSync } = require('child_process');
const { readText } = require('../../helpers/read-skill');

// #5902: station events are written by code only. No skill prose may tell
// anyone to log one, so the only skill file that names the station-event
// file is init's gitignore suggestion, which tells projects to ignore it.

const ROOT = path.join(__dirname, '..', '..', '..');
const SUGGESTIONS = 'plugin/skills/init/bootstrap/step-04-gitignore-suggestions.md';
const ENTRIES = ['.claude-tweaks/station-events.jsonl', '.claude-tweaks/station-events.jsonl.lock'];

function skillFilesNamingStationEvents() {
  try {
    const out = execFileSync('git', ['grep', '-l', 'station-events', '--', 'plugin/skills'], {
      cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
    });
    return out.split('\n').map((l) => l.trim()).filter(Boolean);
  } catch (err) {
    if (err.status === 1) return []; // git grep: no match
    throw err;
  }
}

function assertOnlySuggestionsFile(files) {
  const unexpected = files.filter((f) => f !== SUGGESTIONS);
  const missing = files.includes(SUGGESTIONS) ? [] : [SUGGESTIONS];
  assert.ok(
    unexpected.length === 0 && missing.length === 0,
    `skill files naming station-events must be exactly ${SUGGESTIONS}; `
      + `unexpected: [${unexpected.join(', ')}], missing: [${missing.join(', ')}]`,
  );
}

function suggestionBlock() {
  const text = readText(path.join(ROOT, SUGGESTIONS));
  const start = text.indexOf('```gitignore');
  assert.ok(start >= 0, 'fenced gitignore block must exist');
  const end = text.indexOf('```', start + 3);
  assert.ok(end > start, 'fenced gitignore block must be closed');
  return text.slice(start, end);
}

const lineRe = (entry) => new RegExp(`^${entry.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\r?$`, 'm');

test('only the gitignore suggestion file names station-events under plugin/skills', () => {
  assertOnlySuggestionsFile(skillFilesNamingStationEvents());
});

test('the matcher is red on an extra skill file and on a missing suggestions file', () => {
  assert.throws(
    () => assertOnlySuggestionsFile([SUGGESTIONS, 'plugin/skills/x.md']),
    (err) => /unexpected: \[plugin\/skills\/x\.md\]/.test(err.message),
  );
  assert.throws(
    () => assertOnlySuggestionsFile([]),
    (err) => err.message.includes(`missing: [${SUGGESTIONS}]`),
  );
  assertOnlySuggestionsFile([SUGGESTIONS]);
});

test('the root .gitignore carries both station-event entries', () => {
  const gitignore = readText(path.join(ROOT, '.gitignore'));
  for (const entry of ENTRIES) assert.match(gitignore, lineRe(entry), `.gitignore lacks ${entry}`);
});

test('the gitignore suggestion block names both station-event entries', () => {
  const block = suggestionBlock();
  for (const entry of ENTRIES) assert.match(block, lineRe(entry), `suggestion block lacks ${entry}`);
});
