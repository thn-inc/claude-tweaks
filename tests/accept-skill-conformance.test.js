// tests/accept-skill-conformance.test.js
//
// Conformance for #4613's packet-centric /claude-tweaks:accept: the automatic entry never
// prompts and never re-posts an existing packet, the on-demand entry reuses and refreshes a
// packet rather than posting a second one, an unresolved #N never falls back to session
// recall, every packet state accept-entry.js classifies is named with its minimal behavior,
// and the interim verdict file writes accept:* through the labels command. The skill prose is
// the contract an agent runs, so the live files are read.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { readText } = require('./helpers/read-skill');
const { PACKET_STATES } = require('../plugin/bin/lib/issues/accept-entry');

const ACCEPT_DIR = path.join(__dirname, '..', 'plugin', 'skills', 'accept');
const ACCEPT_FILES = fs.readdirSync(ACCEPT_DIR).filter((name) => name.endsWith('.md')).sort();
const read = (name) => readText(path.join(ACCEPT_DIR, name));

const AUTO_LABEL = 'accept-entry.js" auto-label';
const READ = 'accept-entry.js" read';
const REFRESH = 'accept-entry.js" refresh';
const LABELS = 'accept-entry.js" labels';
const POST = 'acceptance-packet.js" post';

const indexesOf = (text, literal) => {
  const found = [];
  for (let at = text.indexOf(literal); at !== -1; at = text.indexOf(literal, at + 1)) found.push(at);
  return found;
};

// The text from `heading` up to the next heading of the same or a higher level.
function section(text, heading) {
  const start = text.indexOf(`\n${heading}\n`);
  assert.notEqual(start, -1, `heading not found: ${heading}`);
  const level = heading.match(/^#+/)[0].length;
  const rest = text.slice(start + heading.length + 2);
  const next = rest.search(new RegExp(`^#{1,${level}} `, 'm'));
  return next === -1 ? rest : rest.slice(0, next);
}

// The list item holding `literal`: from it to the next list item, numbered or bulleted.
function listItemAt(text, literal) {
  const start = text.indexOf(literal);
  assert.notEqual(start, -1, `not found: ${literal}`);
  const rest = text.slice(start + literal.length);
  const next = rest.search(/\n\s*(?:- |\d+\. )/);
  return text.slice(start, next === -1 ? undefined : start + literal.length + next);
}

// The accept/ files `name` cites by filename, followed transitively: every file a reader of
// `name` may be sent to inside this skill's directory.
function reachableFrom(name) {
  const seen = new Set([name]);
  const queue = [name];
  while (queue.length > 0) {
    const text = read(queue.shift());
    for (const cited of text.match(/[A-Za-z0-9_-]+\.md/g) || []) {
      if (ACCEPT_FILES.includes(cited) && !seen.has(cited)) {
        seen.add(cited);
        queue.push(cited);
      }
    }
  }
  seen.delete(name);
  return [...seen].sort();
}

test('AC4.4: automatic-entry.md reaches no AskUserQuestion', () => {
  const auto = read('automatic-entry.md');
  for (const literal of ['AskUserQuestion', 'Verdict', 'verdict question']) {
    assert.ok(!auto.includes(literal), `automatic-entry.md must not contain ${literal}`);
  }
  for (const name of reachableFrom('automatic-entry.md')) {
    assert.ok(!read(name).includes('AskUserQuestion'), `automatic-entry.md reaches ${name}, which calls AskUserQuestion`);
  }
  // The scan itself goes red on a citation of a prompting file.
  assert.ok(read('SKILL.md').includes('AskUserQuestion'), 'control: SKILL.md prompts');
  assert.ok(ACCEPT_FILES.includes('SKILL.md') && ACCEPT_FILES.includes('entry-paths.md'), 'control: the directory listing saw the skill');
});

test('AC4.1/AC4.2/AC4.3: automatic entry labels through auto-label', () => {
  const auto = read('automatic-entry.md');
  const autoLabel = auto.indexOf(AUTO_LABEL);
  assert.notEqual(autoLabel, -1, `automatic-entry.md must call ${AUTO_LABEL}`);
  assert.ok(auto.includes('--label accept:pending'), 'the post applies accept:pending');
  assert.ok(auto.includes('--add-label accept:pending'), 'the label-only branch applies accept:pending');
  assert.doesNotMatch(auto, /--(?:add-)?label[\s=]+demo:pending/, 'never applies demo:pending');
  assert.ok(auto.includes('--acceptance-facet'), 'local-files reads the acceptance: facet');
  const post = auto.indexOf(POST);
  assert.notEqual(post, -1, `automatic-entry.md must call ${POST}`);
  assert.ok(autoLabel < post, 'auto-label runs before the post');
  assert.ok(auto.includes('apply-pending'), 'the label keys on the auto-label action');
});

test('AC4.1: wrap-up reaches the automatic entry', () => {
  const wrapUp = (name) => readText(path.join(ACCEPT_DIR, '..', 'wrap-up', name));
  const brief = wrapUp('verification-brief.md');
  const heading = brief.indexOf('\n## Step 4: Compose and post the brief\n');
  assert.notEqual(heading, -1, 'verification-brief.md keeps its Step 4 heading');
  const step4 = brief.slice(heading);
  const handOff = step4.indexOf('accept/automatic-entry.md');
  assert.notEqual(handOff, -1, 'Step 4 hands the rendered packet to accept/automatic-entry.md');
  assert.ok(!brief.includes('--label demo:pending'), 'verification-brief.md no longer posts with --label demo:pending');
  assert.ok(!step4.includes(POST), `Step 4 no longer runs ${POST} itself: the automatic entry owns the post`);
  const render = step4.indexOf('acceptance-packet.js" render');
  assert.notEqual(render, -1, 'Step 4 still renders the packet');
  assert.ok(render < handOff, 'render runs before the hand-off');
  assert.ok(wrapUp('execution-and-verification.md').includes('automatic-entry.md'), 'Phase 4 acceptance labeling names the automatic entry');
});

test('AC4.2: an existing packet is never re-posted by the automatic entry', () => {
  const auto = read('automatic-entry.md');
  const posts = indexesOf(auto, POST);
  assert.equal(posts.length, 1, 'exactly one post call');
  const readAt = auto.indexOf(READ);
  assert.notEqual(readAt, -1, `automatic-entry.md must call ${READ}`);
  assert.ok(readAt < posts[0], 'the packet is read before the post');
  const none = auto.indexOf('status: none');
  assert.notEqual(none, -1, 'the status: none branch exists');
  const nextStatus = auto.indexOf('status:', none + 'status: none'.length);
  assert.ok(posts[0] > none && (nextStatus === -1 || posts[0] < nextStatus), 'the post sits under the status: none branch');
  const found = listItemAt(auto, 'status: found');
  assert.ok(!found.includes('acceptance-packet.js"'), `the found branch posts nothing: ${found}`);
  assert.ok(found.includes('--add-label accept:pending'), 'the found branch only labels');
});

test('AC2.1/AC2.2: on-demand reuse edits rather than posts', () => {
  const skill = read('SKILL.md');
  // Scoped to the Reuse and refresh paragraph: the No-packet build below it posts too.
  const from = skill.indexOf('**Reuse and refresh**');
  const to = skill.indexOf('**No-packet build**', from);
  assert.ok(from !== -1 && to > from, 'SKILL.md must carry Reuse and refresh before No-packet build');
  const reuse = skill.slice(from, to);
  const refresh = reuse.indexOf(REFRESH);
  assert.notEqual(refresh, -1, `Reuse and refresh must call ${REFRESH}`);
  const post = reuse.indexOf(POST, refresh);
  assert.ok(post > refresh, 'the refreshed packet is posted (edited in place) after the refresh');
  assert.match(reuse.slice(refresh), /Only when `refreshed` is non-empty/, 'the post is conditional on a refreshed field');
  assert.match(reuse.slice(post), /--body-file "\{REFRESHED\}"/, 'the post publishes the refreshed body');
  assert.match(reuse, /--add-label \{pending-label\}/, 'a failed refresh post re-applies the pending label it cleared');
  assert.ok(skill.includes(READ), 'the packet is read through accept-entry.js read');
  for (const name of ACCEPT_FILES) {
    assert.ok(!read(name).includes('gh issue comment'), `${name} must never post a comment with gh issue comment`);
  }
});

test('AC3.1: no-record path keeps session recall', () => {
  const paths = read('entry-paths.md');
  assert.ok(paths.includes('\n## No arguments: session-recall\n'), 'the session-recall heading stays');
  assert.ok(paths.replace(/\s+/g, ' ').includes('Report "Nothing awaiting sign-off." and stop'), 'the nothing-found stop stays');
});

test('AC4b.3: an unresolved #N is an error, never session recall', () => {
  const input = section(read('SKILL.md'), '## Input').replace(/\s+/g, ' ');
  assert.match(input, /does not resolve[^.]*error/);
  assert.match(input, /never falls back to (the )?(no-record|session-recall)/);
});

test('AC4b.1: every packet state is named', () => {
  const skill = read('SKILL.md');
  assert.equal(PACKET_STATES.length, 6, 'the module still has six states');
  for (const state of PACKET_STATES) assert.ok(skill.includes(`\`${state}\``), `SKILL.md must name ${state}`);
});

test('AC4b.1: each state table row carries the state\'s minimal behavior', () => {
  const rows = read('SKILL.md').split('\n').filter((line) => line.startsWith('| `'));
  const row = (state) => {
    const found = rows.find((line) => line.startsWith(`| \`${state}\` |`));
    assert.ok(found, `the state table must have a ${state} row`);
    return found;
  };
  assert.match(row('awaiting-local'), /PR branch/);
  assert.match(row('waiting-for-deploy'), /deploy status/);
  assert.match(row('waiting-for-deploy'), /skip/i);
  assert.match(row('live-on-dev'), /dev links/);
  assert.match(row('already-decided'), /stop/);
  assert.match(row('already-decided'), /no second verdict/);
  assert.match(row('already-decided'), /Changes-requested beside a pending label is a rebuilt record awaiting re-acceptance/);
  assert.match(row('no-packet'), /packet module/);
  assert.match(row('unhandled'), /`message`/);
  assert.match(row('unhandled'), /stop/);
  assert.match(read('SKILL.md'), /no recording/i, 'the no-recording case is named');
});

test('AC7a.1: Approve still closes a decomposition parent', () => {
  const interim = read('verdict-interim.md');
  assert.ok(interim.includes('gh issue close {n} --reason completed'));
  assert.ok(interim.includes('isParentIssue'));
});

test('AC4a.2: verdicts write accept:* through the labels command', () => {
  const interim = read('verdict-interim.md');
  assert.ok(interim.includes(LABELS), `verdict-interim.md must call ${LABELS}`);
  assert.ok(interim.includes('accept:approved-batch'));
  assert.doesNotMatch(interim, /--add-label[\s=]+demo:/, 'no demo:* label is added');
  assert.match(interim.split('\n').slice(0, 6).join(' '), /#4614 replaces this file wholesale/, 'the opening says #4614 replaces this file');
});

test('no standalone-only restriction', () => {
  assert.ok(!read('SKILL.md').includes('standalone-only'));
});

const REPO = path.join(__dirname, '..');
const readRepo = (rel) => readText(path.join(REPO, rel));
const firstFence = (text) => {
  const open = text.indexOf('```');
  assert.notEqual(open, -1, 'no fenced block');
  const close = text.indexOf('\n```', open + 3);
  assert.notEqual(close, -1, 'unclosed fenced block');
  return text.slice(open, close);
};

test('AC7.1: graph, help diagram and README diagram list accept', () => {
  const graph = readRepo('docs/skill-graph.md');
  assert.match(graph, /^## accept$/m, 'docs/skill-graph.md has an accept section');
  const demoRows = section(graph, '## demo').split('\n').filter((line) => line.startsWith('| `'));
  assert.deepEqual(demoRows.length, 1, '## demo keeps exactly one row');
  assert.match(demoRows[0], /^\| `\/accept` \| Deprecated alias/, 'the one demo row is the alias forwarding to /accept');
  const strayDemoRows = graph.split('\n').filter((line) => line.startsWith('| `/demo` |'));
  assert.deepEqual(strayDemoRows, [], 'no section keeps a /demo target row; it is /accept now');
  // README's lifecycle line and help's diagram line state the same label facts (CLAUDE.md keeps the two in sync).
  const LABEL_FACTS = 'resolves accept:pending (demo:pending on a decomposition parent) → accept:approved/accept:changes-requested';
  const acceptLineIn = (text, where) => {
    const line = text.split('\n').find((l) => l.includes('/claude-tweaks:accept resolves'));
    assert.ok(line, `${where} has the /claude-tweaks:accept line`);
    return line;
  };
  const readmeLine = acceptLineIn(section(readRepo('README.md'), '## How it works'), "README's lifecycle diagram");
  const helpLine = acceptLineIn(firstFence(readRepo('plugin/skills/help/SKILL.md')), "help's lifecycle diagram");
  for (const [where, line] of [['README', readmeLine], ['help', helpLine]]) {
    assert.ok(line.includes(LABEL_FACTS), `${where}'s accept line carries the pending labels, the parent note and the accept:* verdicts`);
  }
});

test('AC7.2: reference card grammar lists /claude-tweaks:accept', () => {
  const card = readRepo('plugin/skills/help/reference-card.md').split('\n');
  const acceptRow = card.find((line) => line.startsWith('| `/claude-tweaks:accept` |'));
  assert.ok(acceptRow, 'the reference card has a /claude-tweaks:accept row');
  assert.ok(acceptRow.endsWith('| `[#N[,#M...]]` |'), 'its Takes cell is the accept argument grammar');
  const demoRow = card.find((line) => line.startsWith('| `/demo` |'));
  assert.ok(demoRow && demoRow.includes('Deprecated alias'), 'the demo row is marked a deprecated alias');
});

test('AC7.3: the journey names accept', () => {
  const journey = readRepo('docs/journeys/accept-built-work-via-demo.md');
  assert.ok(journey.includes('/claude-tweaks:accept'), 'the journey names /claude-tweaks:accept');
  const front = journey.split('\n---\n')[0];
  const files = [...front.matchAll(/^ {2}- (.+)$/gm)].map((m) => m[1].trim());
  for (const required of ['plugin/skills/accept/automatic-entry.md', 'plugin/skills/accept/verdict-interim.md', 'plugin/bin/accept-entry.js']) {
    assert.ok(files.includes(required), `the journey's files list carries ${required}`);
  }
  for (const file of files) assert.ok(fs.existsSync(path.join(REPO, file)), `journey files entry exists: ${file}`);
  const success = journey.split('\n').find((line) => line.startsWith('**Success state:**'));
  assert.ok(success && success.includes('accept:approved'), 'the success state is accept:approved');
  assert.doesNotMatch(success, /`demo:approved/, 'the success state names no demo:* verdict');
});

test('AC7.4: plugin-structure lists accept, its sub-files and the accept-entry CLI', () => {
  const doc = readRepo('docs/plugin-structure.md');
  const utility = doc.split('\n').find((line) => line.startsWith('**Utility:**'));
  assert.match(utility, /\baccept\b/, 'the Utility list names accept');
  const rowFor = (skill) => doc.split('\n').find((line) => line.startsWith(`| ${skill} | `));
  const acceptRow = rowFor('accept');
  assert.ok(acceptRow, 'the sub-file table has an accept row');
  for (const name of ACCEPT_FILES.filter((n) => n !== 'SKILL.md')) {
    assert.ok(acceptRow.split(' | ')[1].includes(name), `the accept row lists ${name}`);
  }
  const demoFiles = fs.readdirSync(path.join(REPO, 'plugin', 'skills', 'demo')).filter((n) => n.endsWith('.md') && n !== 'SKILL.md');
  assert.deepEqual(rowFor('demo').split(' | ')[1].split(', ').sort(), demoFiles.sort(), 'the demo row lists exactly the alias directory');
  assert.match(doc, /^node plugin\/bin\/accept-entry\.js /m, 'the CLI list carries accept-entry.js');
});
