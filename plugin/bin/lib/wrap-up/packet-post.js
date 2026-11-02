// bin/lib/wrap-up/packet-post.js — publishes the acceptance packet (#4611): find the
// comment by its marker, edit it in place or post it, label only after that landed,
// and clear a pending label when it did not, so a stale packet never sits under one.
//
// `runner(args)` runs gh and throws on non-zero; the CLI injects it and the file
// writer, so this module holds no fs or child_process. No step of the sequence reads
// a file itself: gh reads the body file directly, and the body must reach it unaltered.
'use strict';

const { LOCAL_START, LOCAL_END } = require('./packet-contract');
const { readPacket } = require('./packet-gather');
const { LABELS } = require('../issues/record-vocabulary');

const EDIT_COMMENT_QUERY = 'query=mutation($id:ID!,$body:String!){updateIssueComment(input:{id:$id,body:$body}){issueComment{id url}}}';
const PENDING_LABELS = Object.freeze([LABELS.DEMO_PENDING, LABELS.ACCEPT_PENDING]);
const PR_LINK_PREFIX = 'Acceptance packet: ';

const messageOf = (err) => (err && err.message ? err.message : String(err));

function readComments(gh, issue) {
  const { comments } = JSON.parse(gh(['issue', 'view', String(issue), '--json', 'comments']));
  if (!Array.isArray(comments)) throw new Error('comments is not a list');
  return comments;
}

// gh exited 0, so the edit landed; a response it cannot read costs only the echo of
// values the comment already has, since an edit moves neither its id nor its url.
function editedComment(response, comment) {
  let edited = null;
  try {
    edited = JSON.parse(response)?.data?.updateIssueComment?.issueComment ?? null;
  } catch {
    // Falls through to the values the comment was read with.
  }
  return { url: edited?.url || comment.url, id: edited?.id || comment.id };
}

// Only labels present are removed: `--remove-label` on an absent one fails the whole
// edit. Every present spelling is tried even after one fails, so as few as possible
// stay over the stale packet.
function clearPendingLabels(gh, issue) {
  let present;
  try {
    const { labels } = JSON.parse(gh(['issue', 'view', String(issue), '--json', 'labels']));
    if (!Array.isArray(labels)) throw new Error('labels is not a list');
    const names = labels.map((label) => label?.name);
    present = PENDING_LABELS.filter((name) => names.includes(name));
  } catch (err) {
    return { labelRemoval: 'failed', failures: [messageOf(err)] };
  }
  if (present.length === 0) return { labelRemoval: 'absent', failures: [] };
  const failures = [];
  for (const name of present) {
    try {
      gh(['issue', 'edit', String(issue), '--remove-label', name]);
    } catch (err) {
      failures.push(messageOf(err));
    }
  }
  return { labelRemoval: failures.length === 0 ? 'removed' : 'failed', failures };
}

// The body with this record's link line reading `line`, or null when it has none. Only
// a line on the same `/issues/{N}#` is this record's: a multi-spec run shares one PR, so
// another record's line beside it stays. Repeats of this record's line collapse to one.
function replacePacketLine(body, issue, line) {
  const issuePath = `/issues/${issue}#`;
  let replaced = false;
  const lines = [];
  for (const raw of body.split('\n')) {
    const eol = raw.endsWith('\r') ? '\r' : '';
    const text = eol ? raw.slice(0, -1) : raw;
    if (!text.startsWith(PR_LINK_PREFIX) || !text.includes(issuePath) || /\s/.test(text.slice(PR_LINK_PREFIX.length))) {
      lines.push(raw);
    } else if (!replaced) {
      replaced = true;
      lines.push(`${line}${eol}`);
    }
  }
  return replaced ? lines.join('\n') : null;
}

function linkPullRequest({ gh, prNumber, issue, url, writeFile, tmpPath }) {
  try {
    if (url === null) throw new Error('the post printed no comment url');
    const { body } = JSON.parse(gh(['pr', 'view', String(prNumber), '--json', 'body']));
    if (typeof body !== 'string') throw new Error('the pull request view has no body');
    const line = `${PR_LINK_PREFIX}${url}`;
    const replaced = replacePacketLine(body, issue, line);
    if (replaced === body) return { ok: true, action: 'present' };
    writeFile(tmpPath, replaced ?? `${body}\n\n${line}\n`);
    gh(['pr', 'edit', String(prNumber), '--body-file', tmpPath]);
    return { ok: true, action: replaced === null ? 'appended' : 'replaced' };
  } catch (err) {
    return { ok: false, action: null, error: messageOf(err) };
  }
}

function publishPacket({ issue, bodyFile, repo, prNumber = null, label = null, runner, writeFile, tmpPath }) {
  // `gh api` has no --repo: graphql addresses the comment by node id.
  const gh = (args) => runner(repo ? [...args, '--repo', repo] : args);
  const result = {
    ok: false,
    action: null,
    url: null,
    id: null,
    extras: [],
    skipped: [],
    labelApplied: false,
    labelRemoval: null,
    stalePacket: null,
    prLink: null,
  };

  let packet;
  try {
    packet = readPacket(readComments(gh, issue));
  } catch (err) {
    return { ...result, error: `could not read existing comments: ${messageOf(err)}` };
  }
  result.extras = packet.extras;
  result.skipped = packet.skipped;
  if (packet.status === 'unreadable') {
    return { ...result, error: `existing packet comment is unreadable (schemaVersion ${packet.version}) — not posting a second packet` };
  }

  let failure = null;
  if (packet.status === 'found') {
    result.action = 'updated';
    try {
      const response = runner(['api', 'graphql', '-f', EDIT_COMMENT_QUERY, '-f', `id=${packet.comment.id}`, '-F', `body=@${bodyFile}`]);
      Object.assign(result, editedComment(response, packet.comment));
    } catch (err) {
      result.stalePacket = packet.comment.url;
      failure = `could not edit packet comment ${packet.comment.url}: ${messageOf(err)}`;
    }
  } else {
    try {
      result.url = gh(['issue', 'comment', String(issue), '--body-file', bodyFile]).trim() || null;
      result.action = 'created';
    } catch (err) {
      failure = `could not post packet comment: ${messageOf(err)}`;
    }
  }

  if (failure !== null) {
    const { labelRemoval, failures } = clearPendingLabels(gh, issue);
    const notes = failures.map((message) => `; could not remove pending label: ${message}`);
    return { ...result, labelRemoval, error: `${failure}${notes.join('')}` };
  }

  if (label) {
    try {
      gh(['issue', 'edit', String(issue), '--add-label', label]);
      result.labelApplied = true;
    } catch (err) {
      return { ...result, error: `could not apply label ${label}: ${messageOf(err)}` };
    }
  }

  result.ok = true;
  if (prNumber) result.prLink = linkPullRequest({ gh, prNumber, issue, url: result.url, writeFile, tmpPath });
  return result;
}

// The line spans an upsert replaces, in order. Delimiters count only as whole lines,
// whatever whitespace surrounds them, so prose naming one in a code span is not an anchor
// but an indented one is. An end closes the nearest start above it. Any other start is an
// orphan, a span of its own delimiter line alone: nothing marks where its text stops, and
// what follows may be a human's. An end with no start stays as text.
function findLocalSpans(lines) {
  const spans = [];
  let open = null;
  for (const [index, line] of lines.entries()) {
    const text = line.trim();
    if (text === LOCAL_START) {
      if (open !== null) spans.push({ start: open, end: open });
      open = index;
    } else if (text === LOCAL_END && open !== null) {
      spans.push({ start: open, end: index });
      open = null;
    }
  }
  if (open !== null) spans.push({ start: open, end: open });
  return spans;
}

function renderLocalBlock(packetMarkdown, eol) {
  return `${LOCAL_START}\n${packetMarkdown}\n${LOCAL_END}`.replace(/\r?\n/g, eol);
}

function upsertLocalPacket(recordBody, packetMarkdown) {
  const lines = recordBody.split('\n');
  const spans = findLocalSpans(lines);
  if (spans.length > 0) {
    // The one block takes the first span's place; every other span only goes.
    const [first] = spans;
    const eol = lines[first.start].endsWith('\r') ? '\r\n' : '\n';
    const closing = lines[first.end].endsWith('\r') ? '\r' : '';
    const kept = [...lines.slice(0, first.start), `${renderLocalBlock(packetMarkdown, eol)}${closing}`];
    let at = first.end + 1;
    for (const { start, end } of spans.slice(1)) {
      kept.push(...lines.slice(at, start));
      at = end + 1;
    }
    return [...kept, ...lines.slice(at)].join('\n');
  }
  const eol = recordBody.includes('\r\n') ? '\r\n' : '\n';
  const head = recordBody.replace(/[\r\n]+$/, '');
  const block = renderLocalBlock(packetMarkdown, eol);
  if (head === '') return block;
  return `${head}${eol}${eol}${block}${head === recordBody ? '' : eol}`;
}

module.exports = { publishPacket, upsertLocalPacket };
