'use strict';

// Answers a `git -C <root> cat-file --batch` call for a fake git runner whose
// rules are written per file as `git show <ref>:<path>`: each object name on
// the batch's stdin is dispatched to showOne as the equivalent show argv, and
// the answers are framed the way real cat-file frames them (a `<sha> blob
// <bytes>` header, the content, a newline; `<object> missing` for an object
// showOne cannot produce). Lets a fake keep its per-file show rules while the
// code under test reads every file in one batch process.

// (cmd, args) -> true for the batch read this helper answers.
function isCatFileBatch(cmd, args) {
  return cmd === 'git' && args.includes('cat-file') && args.includes('--batch');
}

// (args, opts, showOne) -> Buffer. showOne(showArgs) returns the file's text,
// or throws / returns undefined or null for a file that does not exist.
function answerCatFileBatch(args, opts, showOne) {
  const root = args[args.indexOf('-C') + 1];
  const objects = String(opts && opts.input !== undefined ? opts.input : '').split('\n').filter((line) => line !== '');
  const parts = objects.map((obj) => {
    let value;
    try {
      value = showOne(['-C', root, 'show', obj]);
    } catch {
      value = undefined;
    }
    if (value === undefined || value === null) return `${obj} missing\n`;
    const text = String(value);
    return `${'0'.repeat(40)} blob ${Buffer.byteLength(text)}\n${text}\n`;
  });
  return Buffer.from(parts.join(''), 'utf8');
}

module.exports = { isCatFileBatch, answerCatFileBatch };
