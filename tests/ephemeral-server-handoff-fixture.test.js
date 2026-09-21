'use strict';
// #1937 AC4 — a replay of the reported sequence: call 1's ephemeral dev server dies (the
// original incident: an un-detached background process owned by a Task call that ended)
// part-way through call 2's browser-driving walk. This fixture exercises the documented
// recovery mechanism with real child processes and real sockets -- no Task-tool dispatch, no
// nested `claude -p` process, nothing this build's standing no-subagent-dispatch policy
// forbids -- and proves the walk completes on a restarted server, producing exactly one
// restart log line in the exact schema `dispatch/task-prompt.md`'s second-call template and
// `bin/lib/log-decision/append.js`'s `formatEntry` both use.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const net = require('node:net');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { formatEntry } = require('../plugin/bin/lib/log-decision/append');

const TASK_PROMPT = path.join(__dirname, '..', 'plugin', 'skills', 'dispatch', 'task-prompt.md');

// Derives the restart-log text from dispatch/task-prompt.md's own documented template rather
// than hardcoding an independent copy of the wording -- this is what makes the fixture below
// discriminate: if the template is ever reworded or the whole paragraph reverted, this throws
// (a distinguishable failure, never a silent pass) instead of the fixture quietly asserting
// against a copy of today's wording that no longer matches what the plugin actually documents.
function buildRestartTextFromDocumentedTemplate({ old, replacement, port }) {
  const text = fs.readFileSync(TASK_PROMPT, 'utf8');
  const openIdx = text.indexOf('`AUTO {time} -- ephemeral server restarted:');
  if (openIdx === -1) {
    throw new Error(
      "could not find the restart log-line template ('AUTO {time} -- ephemeral server restarted:') "
      + 'in dispatch/task-prompt.md -- AC4 fixture cannot derive its expected output',
    );
  }
  const closeIdx = text.indexOf('`', openIdx + 1);
  if (closeIdx === -1) {
    throw new Error('found the restart log-line anchor but its backtick span never closes');
  }
  const rawTemplate = text.slice(openIdx + 1, closeIdx).replace(/\s+/g, ' ').trim();
  const prefixMatch = rawTemplate.match(/^AUTO \{time\} --\s*/);
  if (!prefixMatch) {
    throw new Error(`restart log-line template lost its expected 'AUTO {time} -- ' prefix: ${rawTemplate}`);
  }
  const templateBody = rawTemplate.slice(prefixMatch[0].length);
  if (!templateBody.includes('{old}') || !templateBody.includes('{new}') || !templateBody.includes('{port}')) {
    throw new Error(`restart log-line template is missing an expected {old}/{new}/{port} placeholder: ${templateBody}`);
  }
  return templateBody
    .replace('{old}', String(old))
    .replace('{new}', String(replacement))
    .replace('{port}', String(port));
}

test('the documented restart-log template still names {old}/{new}/{port} (discrimination: rewording or reverting the template makes this throw, not pass)', () => {
  const derived = buildRestartTextFromDocumentedTemplate({ old: 111, replacement: 222, port: 33333 });
  assert.equal(derived, 'ephemeral server restarted: recorded pid 111 dead, new pid 222 on port 33333');
});

const SERVER_SCRIPT = `
const http = require('http');
const port = Number(process.argv[2]);
const srv = http.createServer((req, res) => { res.end('ok'); });
srv.listen(port);
`;

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

function probe(port, timeout = 500) {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path: '/', timeout }, (res) => {
      res.resume();
      resolve(true);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

async function waitForUp(port, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    // eslint-disable-next-line no-await-in-loop
    if (await probe(port, 200)) return;
    if (Date.now() > deadline) throw new Error(`server on port ${port} never came up`);
    // eslint-disable-next-line no-await-in-loop
    await new Promise((r) => setTimeout(r, 30));
  }
}

function isAlive(pid) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

function startServer(port, scriptPath) {
  return spawn(process.execPath, [scriptPath, String(port)], { stdio: 'ignore' });
}

test('replay: call 1 ends (killing its un-detached server) while call 2 walks -- liveness recheck restarts it and the walk completes on the new server, logging one restart line', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ephemeral-server-fixture-'));
  const scriptPath = path.join(tmp, 'server.js');
  fs.writeFileSync(scriptPath, SERVER_SCRIPT);
  const recordPath = path.join(tmp, 'ephemeral-server.txt');
  let child1;
  let child2;

  try {
    // --- Call 1: dev-url-detection.md's Ephemeral server start runs, un-detached (this
    // record's reported incident never detached it). Record it per the four-field line.
    const port1 = await freePort();
    child1 = startServer(port1, scriptPath);
    await waitForUp(port1);
    fs.writeFileSync(recordPath, `${child1.pid} ${port1} ${tmp} detached:no\n`);
    assert.equal(await probe(port1), true, 'precondition: call 1\'s server must actually be reachable');

    // --- Call 1's Task-tool turn ends. A background task belongs to the turn that spawned
    // it (the Ownership rule) -- when it is not detached, it dies with the turn.
    const deadPid = child1.pid;
    child1.kill('SIGKILL');
    await new Promise((resolve) => child1.on('exit', resolve));
    assert.equal(isAlive(deadPid), false, 'precondition: call 1\'s server must actually be dead once its turn ends');

    // --- Call 2, before its first browser-driving step: verify the recorded pid answers on
    // the recorded port.
    const [, recordedPortStr, recordedRoot] = fs.readFileSync(recordPath, 'utf8').trim().split(' ');
    const recordedPort = Number(recordedPortStr);
    const stillUp = await probe(recordedPort);
    assert.equal(stillUp, false, 'the recorded port must not answer -- this is the dead-pid branch the second-call template handles');

    // --- Dead pid: re-run the Ephemeral server start procedure (fresh port-lease read, fresh
    // server) and rewrite the liveness-handle record -- the second call's own template.
    const port2 = await freePort();
    child2 = startServer(port2, scriptPath);
    await waitForUp(port2);
    fs.writeFileSync(recordPath, `${child2.pid} ${port2} ${recordedRoot} detached:no\n`);

    // Built from task-prompt.md's own template (see buildRestartTextFromDocumentedTemplate above)
    // rather than a copy of the wording hardcoded here -- reverting or rewording that paragraph
    // makes this call throw instead of letting the fixture silently keep passing.
    const restartText = buildRestartTextFromDocumentedTemplate({ old: deadPid, replacement: child2.pid, port: port2 });
    const logLine = formatEntry({ status: 'AUTO', now: Date.now(), text: restartText });

    // Exactly the schema `dispatch/task-prompt.md`'s second-call template names.
    assert.match(logLine, /^- AUTO \d{2}:\d{2}:\d{2} — log-decision: ephemeral server restarted: recorded pid \d+ dead, new pid \d+ on port \d+\. Reversibility: n\/a\.$/);

    // --- The walk (13 screenshots in the reported incident; a handful of GETs here) completes
    // in full against the restarted server.
    const WALK_STEPS = 5;
    let completed = 0;
    for (let i = 0; i < WALK_STEPS; i++) {
      // eslint-disable-next-line no-await-in-loop
      const ok = await probe(port2);
      assert.equal(ok, true, `walk step ${i} must succeed against the restarted server`);
      completed++;
    }
    assert.equal(completed, WALK_STEPS, 'the walk must complete in full after the restart -- the original incident lost the walk mid-way, this replay must not');

    // Quoted verbatim in this record's PR description (AC4):
    // eslint-disable-next-line no-console
    console.log(`[#1937 fixture] restart log line: ${logLine}`);
  } finally {
    if (child1 && isAlive(child1.pid)) child1.kill('SIGKILL');
    if (child2 && isAlive(child2.pid)) child2.kill('SIGKILL');
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
