'use strict';
// tools/count-node-procs-preload.js — the node-process logger behind tools/count-node-procs.js (#5374).
//
// A `--require` preload carried by NODE_OPTIONS into every node process of a counted run. Inert
// unless CT_COUNT_NODE_LOG is set. It appends one JSON line per process start and one per exit, and
// writes nothing to stdout or stderr. Like tools/test-impact/tracer.js it never throws into the
// process it loads into: the whole body is inside try/catch.

try {
  const logFile = process.env.CT_COUNT_NODE_LOG;
  // a worker thread runs this preload too, with the host's pid: only the main thread is a process
  if (logFile && require('worker_threads').isMainThread) {
    const fs = require('fs');
    fs.appendFileSync(logFile, JSON.stringify({
      ev: 'start',
      pid: process.pid,
      ppid: process.ppid,
      t: Date.now(),
      argv: process.argv.slice(1, 6),
      execArgv: process.execArgv.slice(0, 3),
    }) + '\n');
    process.on('exit', () => {
      try {
        fs.appendFileSync(logFile, JSON.stringify({ ev: 'exit', pid: process.pid, t: Date.now() }) + '\n');
      } catch (_) {
        // never break the counted process
      }
    });
  }
} catch (_) {
  // never break the counted process
}
