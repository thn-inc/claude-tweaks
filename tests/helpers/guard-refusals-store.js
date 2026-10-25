'use strict';
// Copies tests/fixtures/guard-refusals/store/ into a fresh temp directory and stamps every .jsonl with
// STORE_MTIME, so a scan window can be chosen around it (a checkout gives every fixture file "now").
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'guard-refusals-store-'));
  made.push(dir);
  fs.cpSync(FIXTURE_STORE, dir, { recursive: true });
  stamp(dir);
  return dir;
}

const WINDOW = { since: STORE_MTIME - 1000, until: STORE_MTIME + 1000 };

module.exports = { FIXTURE_STORE, STORE_MTIME, WINDOW, copyStore };
