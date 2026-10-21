// The filesystem half of rule (f)'s citable listing: load.js's walkCitable is
// pure over an injected readdir(relDir) => [{ name, isDirectory }], and this is
// the one real implementation both CLIs inject (bin/load-delta.js at head,
// bin/skill-load-report.js per root). A missing or non-directory path lists as
// [] — "nothing citable there", not a crash; any other error (permissions,
// I/O) rethrows. Dirent.isDirectory() is false for a symlink, so a linked
// directory is never walked.
'use strict';

const fs = require('fs');
const path = require('path');

function readdirUnder(baseAbs) {
  return (rel) => {
    try {
      return fs.readdirSync(path.join(baseAbs, rel), { withFileTypes: true })
        .map((d) => ({ name: d.name, isDirectory: d.isDirectory() }));
    } catch (err) {
      if (['ENOENT', 'ENOTDIR'].includes(err.code)) return [];
      throw err;
    }
  };
}

module.exports = { readdirUnder };
