'use strict';
// Copies tests/fixtures/guard-refusals/store/ into a fresh temp directory and stamps every .jsonl with
// STORE_MTIME, so a scan window can be chosen around it (a checkout gives every fixture file "now").
const fs = require('node:fs');
const { scratchDir } = require('./tmp-dir');
const os = require('node:os');
const path = require('node:path');
const { ISOLATION_CLAUSE } = require('../../plugin/bin/lib/hooks/harness-refusal');

const FIXTURE_STORE = path.join(__dirname, '..', 'fixtures', 'guard-refusals', 'store');
const STORE_MTIME = Date.parse('2026-10-20T12:00:00Z');

function stamp(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) stamp(p);
    else fs.utimesSync(p, STORE_MTIME / 1000, STORE_MTIME / 1000);
  }
}

const made = [];
process.on('exit', () => {
  for (const dir of made) fs.rmSync(dir, { recursive: true, force: true });
});

function copyStore() {
  const dir = scratchDir('guard-refusals-store-');
  made.push(dir);
  fs.cpSync(FIXTURE_STORE, dir, { recursive: true });
  stamp(dir);
  return dir;
}

const WINDOW = { since: STORE_MTIME - 1000, until: STORE_MTIME + 1000 };

// #5587: hand-written refusal rows. A store of one session file, removed at exit like copyStore's.
const HARNESS_BASH = `This session${ISOLATION_CLAUSE}/wt, but this command is too complex to verify that it stays inside the worktree. Refusing to run it.`;
const HARNESS_FILE = `This session${ISOLATION_CLAUSE}/wt. Edit the worktree copy of this file instead of the shared-checkout path.`;
const WORKTREE_ALWAYS = 'PreToolUse:Bash hook error: claude-tweaks: this project requires an isolated worktree for this command.';

function writeStore(entries) {
  const dir = scratchDir('guard-refusals-rows-');
  made.push(dir);
  const slug = path.join(dir, '-Users-me-guards');
  fs.mkdirSync(slug, { recursive: true });
  const file = path.join(slug, 's1.jsonl');
  fs.writeFileSync(file, `${entries.map((e) => JSON.stringify(e)).join('\n')}\n`);
  fs.utimesSync(file, STORE_MTIME / 1000, STORE_MTIME / 1000);
  return dir;
}

// The tool_use entry; `cwd` null leaves the field off.
const use = (id, name, input, cwd = '/wt') => {
  const e = { type: 'assistant', timestamp: '2026-10-20T11:00:00.000Z', message: { content: [{ type: 'tool_use', id, name, input }] } };
  if (cwd !== null) e.cwd = cwd;
  return e;
};
const result = (id, content, isError = true) => ({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, is_error: isError, content }] } });

module.exports = { FIXTURE_STORE, STORE_MTIME, WINDOW, copyStore, HARNESS_BASH, HARNESS_FILE, WORKTREE_ALWAYS, writeStore, use, result };
