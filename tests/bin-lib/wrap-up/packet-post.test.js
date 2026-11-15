// tests/bin-lib/wrap-up/packet-post.test.js
// Acceptance-packet publish: find by marker, edit in place, label after success (#4611).
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { publishPacket, upsertLocalPacket } = require('../../../plugin/bin/lib/wrap-up/packet-post');
const { readPacket } = require('../../../plugin/bin/lib/wrap-up/packet-gather');
const { PACKET_MARKER, LOCAL_START, LOCAL_END } = require('../../../plugin/bin/lib/wrap-up/packet-contract');

const EDIT_QUERY = 'query=mutation($id:ID!,$body:String!){updateIssueComment(input:{id:$id,body:$body}){issueComment{id url}}}';
const FIRST_BODY = `${PACKET_MARKER}\n\nfirst`;
const SECOND_BODY = `${PACKET_MARKER}\n\nsecond`;
const TMP_PATH = '/session-tmp/pr-body.md';

function commentFixture(id, overrides = {}) {
  return {
    id: `IC_${id}`,
    url: `https://github.com/o/r/issues/7#issuecomment-${id}`,
    body: PACKET_MARKER,
    authorAssociation: 'OWNER',
    createdAt: `2026-10-${String(id).padStart(2, '0')}T00:00:00Z`,
    ...overrides,
  };
}

// An in-memory issue and PR behind the runner seam. Projects only the requested
// --json field, refuses --repo on `gh api` and --remove-label of an absent label the
// way real gh does, and throws on any call shape it does not know.
function fakeGh({ comments = [], labels = [], prBody = '', files = {}, fail = {} } = {}) {
  const state = { comments: [...comments], labels: [...labels], prBody, files: { ...files }, calls: [] };
  const failIf = (name) => {
    const failure = fail[name];
    if (failure !== undefined) throw new Error(failure);
  };
  const stripRepo = (args) => {
    const at = args.indexOf('--repo');
    return at === -1 ? args : [...args.slice(0, at), ...args.slice(at + 2)];
  };
  const runner = (args) => {
    state.calls.push(args);
    if (args[0] === 'api') {
      if (args.includes('--repo')) throw new Error('unknown flag: --repo');
      if (args[1] !== 'graphql') throw new Error(`unexpected ${args.join(' ')}`);
      failIf('edit');
      const id = args.find((arg) => arg.startsWith('id=')).slice(3);
      const bodyFile = args.find((arg) => arg.startsWith('body=@')).slice(6);
      const comment = state.comments.find((candidate) => candidate.id === id);
      comment.body = state.files[bodyFile];
      return JSON.stringify({ data: { updateIssueComment: { issueComment: { id: comment.id, url: comment.url } } } });
    }
    const call = stripRepo(args);
    const key = call.join(' ');
    if (key === 'issue view 7 --json comments') {
      failIf('readComments');
      if (state.commentsOutput !== undefined) return state.commentsOutput;
      return JSON.stringify({ comments: state.comments });
    }
    if (key === 'issue view 7 --json labels') {
      failIf('readLabels');
      if (state.labelsOutput !== undefined) return state.labelsOutput;
      return JSON.stringify({ labels: state.labels.map((name) => ({ name })) });
    }
    if (call[0] === 'issue' && call[1] === 'comment' && call[2] === '7' && call[3] === '--body-file') {
      failIf('post');
      const created = commentFixture(state.comments.length + 1, { body: state.files[call[4]] });
      state.comments.push(created);
      return `${created.url}\n`;
    }
    if (call[0] === 'issue' && call[1] === 'edit' && call[2] === '7' && call[3] === '--add-label') {
      failIf('addLabel');
      if (!state.labels.includes(call[4])) state.labels.push(call[4]);
      return '';
    }
    if (call[0] === 'issue' && call[1] === 'edit' && call[2] === '7' && call[3] === '--remove-label') {
      if (fail.removeLabelOnly === undefined || fail.removeLabelOnly === call[4]) failIf('removeLabel');
      if (!state.labels.includes(call[4])) throw new Error(`'${call[4]}' not found`);
      state.labels = state.labels.filter((name) => name !== call[4]);
      return '';
    }
    if (key === 'pr view 12 --json body') {
      failIf('prView');
      return JSON.stringify({ body: state.prBody });
    }
    if (call[0] === 'pr' && call[1] === 'edit' && call[2] === '12' && call[3] === '--body-file') {
      failIf('prEdit');
      state.prBody = state.files[call[4]];
      return '';
    }
    throw new Error(`unexpected ${args.join(' ')}`);
  };
  return { state, runner };
}

function publish(gh, overrides = {}) {
  return publishPacket({
    issue: 7,
    bodyFile: '/f/packet.md',
    runner: gh.runner,
    writeFile: (file, content) => { gh.state.files[file] = content; },
    tmpPath: TMP_PATH,
    ...overrides,
  });
}

const WRITE_SHAPES = [
  (args) => args[0] === 'api',
  (args) => args[0] === 'issue' && args[1] === 'comment',
  (args) => args[0] === 'issue' && args[1] === 'edit',
  (args) => args[0] === 'pr' && args[1] === 'edit',
];
const writeCalls = (gh) => gh.state.calls.filter((args) => WRITE_SHAPES.some((isWrite) => isWrite(args)));
const issueEdits = (gh) => gh.state.calls.filter((args) => args[0] === 'issue' && args[1] === 'edit');
const issueComments = (gh) => gh.state.calls.filter((args) => args[0] === 'issue' && args[1] === 'comment');
const addLabels = (gh) => gh.state.calls.filter((args) => args.includes('--add-label'));
const removeLabels = (gh) => gh.state.calls.filter((args) => args.includes('--remove-label'));
const labelReads = (gh) => gh.state.calls.filter((args) => args.includes('labels'));

describe('publishPacket: find by marker, edit in place', () => {
  test('AC3 second run edits the same comment', () => {
    const gh = fakeGh({ files: { '/f/one.md': FIRST_BODY, '/f/two.md': SECOND_BODY } });
    const first = publish(gh, { bodyFile: '/f/one.md' });
    assert.equal(first.ok, true);
    assert.equal(first.action, 'created');
    assert.equal(first.url, gh.state.comments[0].url);
    assert.equal(first.id, null, 'gh issue comment prints only a url, so a create has no node id');
    const originalId = gh.state.comments[0].id;

    const second = publish(gh, { bodyFile: '/f/two.md' });
    assert.equal(second.ok, true);
    assert.equal(second.action, 'updated');
    assert.equal(second.url, first.url);
    assert.equal(second.id, originalId);

    const carrying = gh.state.comments.filter((comment) => comment.body.startsWith(PACKET_MARKER));
    assert.equal(carrying.length, 1);
    assert.equal(carrying[0].id, originalId);
    assert.equal(carrying[0].body, SECOND_BODY);
  });

  test('a comment is read with the comments field and created from the body file, exact argv', () => {
    const gh = fakeGh({ files: { '/f/packet.md': FIRST_BODY } });
    publish(gh);
    assert.deepEqual(gh.state.calls, [
      ['issue', 'view', '7', '--json', 'comments'],
      ['issue', 'comment', '7', '--body-file', '/f/packet.md'],
    ]);
  });

  test('an edit addresses the comment by node id through graphql, exact argv', () => {
    const gh = fakeGh({ comments: [commentFixture(1)], files: { '/f/packet.md': SECOND_BODY } });
    publish(gh);
    assert.deepEqual(gh.state.calls, [
      ['issue', 'view', '7', '--json', 'comments'],
      ['api', 'graphql', '-f', EDIT_QUERY, '-f', 'id=IC_1', '-F', 'body=@/f/packet.md'],
    ]);
  });

  test('a published packet reads back: the marker stays alone on the first line', () => {
    const gh = fakeGh({ files: { '/f/packet.md': FIRST_BODY } });
    publish(gh);
    assert.equal(readPacket(gh.state.comments).status, 'found');
  });

  test('the url comes from the edit response and falls back to the comment on a blank response', () => {
    const responseUrl = 'https://github.com/o/r/issues/7#issuecomment-moved';
    const gh = fakeGh({ comments: [commentFixture(1)], files: { '/f/packet.md': SECOND_BODY } });
    const fromResponse = publishPacket({
      issue: 7,
      bodyFile: '/f/packet.md',
      runner: (args) => (args[0] === 'api'
        ? JSON.stringify({ data: { updateIssueComment: { issueComment: { id: 'IC_9', url: responseUrl } } } })
        : gh.runner(args)),
    });
    assert.equal(fromResponse.url, responseUrl);
    assert.equal(fromResponse.id, 'IC_9');

    const blank = publishPacket({
      issue: 7,
      bodyFile: '/f/packet.md',
      runner: (args) => (args[0] === 'api' ? '' : gh.runner(args)),
    });
    assert.equal(blank.ok, true, 'gh exited 0, so the edit landed');
    assert.equal(blank.url, gh.state.comments[0].url);
    assert.equal(blank.id, 'IC_1');
  });

  test('duplicates: earliest trusted is edited, extras reported', () => {
    const untrusted = commentFixture(1, { authorAssociation: 'NONE' });
    const later = commentFixture(3);
    const earliest = commentFixture(2);
    const gh = fakeGh({ comments: [untrusted, later, earliest], files: { '/f/packet.md': SECOND_BODY } });
    const result = publish(gh);
    assert.equal(result.ok, true);
    assert.equal(result.id, earliest.id);
    assert.equal(gh.state.comments.find((comment) => comment.id === earliest.id).body, SECOND_BODY);
    assert.equal(gh.state.comments.find((comment) => comment.id === later.id).body, PACKET_MARKER);
    assert.equal(gh.state.comments.find((comment) => comment.id === untrusted.id).body, PACKET_MARKER);
    assert.deepEqual(result.extras, [later.url]);
    assert.equal(result.skipped.length, 1);
    assert.equal(issueComments(gh).length, 0);
  });

  test('unreadable existing packet posts nothing', () => {
    const gh = fakeGh({
      comments: [commentFixture(1, { body: '<!-- acceptance-packet: v2 -->\n\nnewer' })],
      labels: ['demo:pending'],
      files: { '/f/packet.md': SECOND_BODY },
    });
    const result = publish(gh, { label: 'demo:pending', prNumber: 12 });
    assert.equal(result.ok, false);
    assert.equal(result.error, 'existing packet comment is unreadable (schemaVersion 2) — not posting a second packet');
    assert.equal(writeCalls(gh).length, 0);
    assert.equal(result.action, null);
    assert.equal(result.labelRemoval, null);
    assert.equal(result.stalePacket, null);
    assert.deepEqual(gh.state.labels, ['demo:pending']);
  });

  test('an unreadable comment list writes nothing', () => {
    const shapes = [
      { fail: { readComments: 'boom' }, message: 'boom' },
      { commentsOutput: 'not json' },
      { commentsOutput: JSON.stringify({ comments: 'nope' }), message: 'comments is not a list' },
      { commentsOutput: JSON.stringify({}), message: 'comments is not a list' },
      { commentsOutput: 'null' },
    ];
    for (const { fail, commentsOutput, message } of shapes) {
      const gh = fakeGh({ labels: ['demo:pending'], fail, files: { '/f/packet.md': FIRST_BODY } });
      gh.state.commentsOutput = commentsOutput;
      const result = publish(gh, { label: 'demo:pending', prNumber: 12 });
      assert.equal(result.ok, false);
      assert.match(result.error, /^could not read existing comments: /);
      if (message !== undefined) assert.equal(result.error, `could not read existing comments: ${message}`);
      assert.equal(writeCalls(gh).length, 0);
      assert.equal(labelReads(gh).length, 0);
      assert.equal(result.labelApplied, false);
      assert.equal(result.labelRemoval, null);
      assert.equal(result.action, null);
    }
  });
});

describe('publishPacket: a failed post or edit', () => {
  test('AC2c post failure applies no label', () => {
    const gh = fakeGh({ fail: { post: 'rate limited' }, files: { '/f/packet.md': FIRST_BODY } });
    const result = publish(gh, { label: 'demo:pending', prNumber: 12 });
    assert.equal(result.ok, false);
    assert.equal(result.labelApplied, false);
    assert.equal(issueEdits(gh).length, 0);
    assert.equal(result.error, 'could not post packet comment: rate limited');
    assert.equal(result.labelRemoval, 'absent');
    assert.equal(result.action, null, 'nothing was created');
    assert.equal(result.url, null);
    assert.equal(result.prLink, null);
  });

  test('edit failure posts nothing', () => {
    const gh = fakeGh({ comments: [commentFixture(1)], fail: { edit: 'denied' }, files: { '/f/packet.md': SECOND_BODY } });
    const result = publish(gh, { label: 'demo:pending', prNumber: 12 });
    assert.equal(result.ok, false);
    assert.equal(result.action, 'updated');
    assert.equal(issueComments(gh).length, 0);
    assert.equal(addLabels(gh).length, 0);
    assert.equal(result.prLink, null);
    assert.equal(result.url, null);
  });

  test('failed edit removes the pending label and names the stale packet', () => {
    const existing = commentFixture(1);
    const gh = fakeGh({
      comments: [existing],
      labels: ['demo:pending', 'type:bug'],
      fail: { edit: 'denied' },
      files: { '/f/packet.md': SECOND_BODY },
    });
    const result = publish(gh, { label: 'demo:pending' });
    assert.equal(result.ok, false);
    assert.deepEqual(gh.state.labels, ['type:bug']);
    assert.equal(result.labelRemoval, 'removed');
    assert.equal(result.stalePacket, existing.url);
    assert.equal(result.error, `could not edit packet comment ${existing.url}: denied`);
    assert.equal(result.labelApplied, false);
  });

  test('failed post removes the pending label', () => {
    const gh = fakeGh({ labels: ['demo:pending'], fail: { post: 'denied' }, files: { '/f/packet.md': FIRST_BODY } });
    const result = publish(gh, { label: 'demo:pending' });
    assert.deepEqual(gh.state.labels, []);
    assert.equal(result.labelRemoval, 'removed');
    assert.equal(result.stalePacket, null);
    assert.deepEqual(removeLabels(gh), [['issue', 'edit', '7', '--remove-label', 'demo:pending']]);
  });

  test('either spelling is removed', () => {
    const accept = fakeGh({ labels: ['accept:pending'], fail: { post: 'x' }, files: { '/f/packet.md': FIRST_BODY } });
    assert.equal(publish(accept, { label: 'demo:pending' }).labelRemoval, 'removed');
    assert.deepEqual(accept.state.labels, []);

    const both = fakeGh({ labels: ['demo:pending', 'accept:pending'], fail: { post: 'x' }, files: { '/f/packet.md': FIRST_BODY } });
    assert.equal(publish(both, { label: 'demo:pending' }).labelRemoval, 'removed');
    assert.deepEqual(both.state.labels, []);
    assert.deepEqual(removeLabels(both).map((args) => args[4]).sort(), ['accept:pending', 'demo:pending']);

    const belowFloor = fakeGh({ labels: ['demo:pending'], fail: { post: 'x' }, files: { '/f/packet.md': FIRST_BODY } });
    assert.equal(publish(belowFloor, { label: null }).labelRemoval, 'removed');
    assert.deepEqual(belowFloor.state.labels, []);
  });

  test('absent label issues no remove call', () => {
    const existing = commentFixture(1);
    const gh = fakeGh({ comments: [existing], labels: ['type:bug'], fail: { edit: 'denied' }, files: { '/f/packet.md': SECOND_BODY } });
    const result = publish(gh, { label: 'demo:pending' });
    assert.equal(issueEdits(gh).length, 0);
    assert.equal(result.labelRemoval, 'absent');
    assert.equal(result.error, `could not edit packet comment ${existing.url}: denied`);
    assert.deepEqual(gh.state.labels, ['type:bug']);
  });

  test('a failed label removal is reported', () => {
    const existing = commentFixture(1);
    const editError = `could not edit packet comment ${existing.url}: denied`;

    const readFails = fakeGh({ comments: [existing], fail: { edit: 'denied', readLabels: 'labels down' }, files: { '/f/packet.md': SECOND_BODY } });
    const onRead = publish(readFails);
    assert.equal(onRead.labelRemoval, 'failed');
    assert.equal(onRead.error, `${editError}; could not remove pending label: labels down`);
    assert.equal(onRead.ok, false);
    assert.equal(onRead.stalePacket, existing.url);

    const removeFails = fakeGh({
      comments: [existing],
      labels: ['demo:pending'],
      fail: { edit: 'denied', removeLabel: 'cannot remove' },
      files: { '/f/packet.md': SECOND_BODY },
    });
    const onRemove = publish(removeFails);
    assert.equal(onRemove.labelRemoval, 'failed');
    assert.equal(onRemove.error, `${editError}; could not remove pending label: cannot remove`);
    assert.equal(onRemove.ok, false);
    assert.deepEqual(removeFails.state.labels, ['demo:pending']);
  });

  test('a label read that does not parse is a failed removal', () => {
    for (const labelsOutput of ['not json', JSON.stringify({ labels: 'nope' }), JSON.stringify({}), 'null']) {
      const gh = fakeGh({ fail: { post: 'denied' }, files: { '/f/packet.md': FIRST_BODY } });
      gh.state.labelsOutput = labelsOutput;
      const result = publish(gh);
      assert.equal(result.labelRemoval, 'failed');
      assert.match(result.error, /^could not post packet comment: denied; could not remove pending label: /);
    }

    const notAList = fakeGh({ fail: { post: 'denied' }, files: { '/f/packet.md': FIRST_BODY } });
    notAList.state.labelsOutput = JSON.stringify({ labels: 'nope' });
    assert.equal(publish(notAList).error, 'could not post packet comment: denied; could not remove pending label: labels is not a list');
  });

  test('one failed removal does not stop the other spelling from clearing', () => {
    const gh = fakeGh({
      labels: ['demo:pending', 'accept:pending'],
      fail: { post: 'denied', removeLabel: 'cannot remove', removeLabelOnly: 'demo:pending' },
      files: { '/f/packet.md': FIRST_BODY },
    });
    const result = publish(gh);
    assert.deepEqual(gh.state.labels, ['demo:pending']);
    assert.equal(result.labelRemoval, 'failed');
    assert.equal(result.error, 'could not post packet comment: denied; could not remove pending label: cannot remove');
  });

  test('a successful publish reads no labels', () => {
    const created = fakeGh({ labels: ['demo:pending'], files: { '/f/packet.md': FIRST_BODY } });
    assert.equal(publish(created).labelRemoval, null);
    assert.equal(labelReads(created).length, 0);
    assert.deepEqual(created.state.labels, ['demo:pending']);

    const updated = fakeGh({ comments: [commentFixture(1)], labels: ['demo:pending'], files: { '/f/packet.md': SECOND_BODY } });
    assert.equal(publish(updated).labelRemoval, null);
    assert.equal(labelReads(updated).length, 0);
    assert.deepEqual(updated.state.labels, ['demo:pending']);
  });
});

describe('publishPacket: the label follows the comment', () => {
  test('the label is applied after the post, and only when one is given', () => {
    const gh = fakeGh({ files: { '/f/packet.md': FIRST_BODY } });
    const result = publish(gh, { label: 'demo:pending' });
    assert.equal(result.labelApplied, true);
    assert.deepEqual(gh.state.labels, ['demo:pending']);
    assert.deepEqual(gh.state.calls.at(-1), ['issue', 'edit', '7', '--add-label', 'demo:pending']);
    assert.deepEqual(gh.state.calls.at(-2).slice(0, 2), ['issue', 'comment']);

    const belowFloor = fakeGh({ files: { '/f/packet.md': FIRST_BODY } });
    const unlabeled = publish(belowFloor, { label: null });
    assert.equal(unlabeled.ok, true);
    assert.equal(unlabeled.labelApplied, false);
    assert.equal(addLabels(belowFloor).length, 0);
  });

  test('a failed label application fails the publish and skips the PR link', () => {
    const gh = fakeGh({ fail: { addLabel: 'no such label' }, prBody: 'body', files: { '/f/packet.md': FIRST_BODY } });
    const result = publish(gh, { label: 'demo:pending', prNumber: 12 });
    assert.equal(result.ok, false);
    assert.equal(result.labelApplied, false);
    assert.match(result.error, /demo:pending/);
    assert.match(result.error, /no such label/);
    assert.equal(result.action, 'created');
    assert.equal(result.url, gh.state.comments[0].url, 'the comment did post');
    assert.equal(result.prLink, null);
    assert.equal(gh.state.prBody, 'body');
    assert.equal(result.labelRemoval, null);
  });
});

describe('publishPacket: the PR link', () => {
  test('PR link appended once', () => {
    const gh = fakeGh({ prBody: 'Summary', files: { '/f/packet.md': FIRST_BODY, '/f/two.md': SECOND_BODY } });
    const first = publish(gh, { prNumber: 12 });
    assert.deepEqual(first.prLink, { ok: true, action: 'appended' });
    assert.equal(gh.state.prBody, `Summary\n\nAcceptance packet: ${first.url}\n`);
    assert.equal(gh.state.files[TMP_PATH], gh.state.prBody);
    assert.ok(gh.state.calls.some((args) => args.join(' ') === `pr edit 12 --body-file ${TMP_PATH}`));

    const second = publish(gh, { prNumber: 12, bodyFile: '/f/two.md' });
    assert.deepEqual(second.prLink, { ok: true, action: 'present' });
    assert.equal(gh.state.prBody.split(`Acceptance packet: ${first.url}`).length - 1, 1);
  });

  test('the link is matched as a whole line', () => {
    const url = commentFixture(1).url;
    const longerUrl = fakeGh({ prBody: `Acceptance packet: ${url}9`, files: { '/f/packet.md': FIRST_BODY } });
    const replaced = publish(longerUrl, { prNumber: 12 });
    assert.equal(replaced.prLink.action, 'replaced', 'a differing url of this record is the same line, not a second one');
    assert.equal(longerUrl.state.prBody, `Acceptance packet: ${url}`);

    const inProse = fakeGh({ prBody: `See Acceptance packet: ${url} above`, files: { '/f/packet.md': FIRST_BODY } });
    assert.equal(publish(inProse, { prNumber: 12 }).prLink.action, 'appended');

    const trailingProse = fakeGh({ prBody: `Acceptance packet: ${url} is above`, files: { '/f/packet.md': FIRST_BODY } });
    assert.equal(publish(trailingProse, { prNumber: 12 }).prLink.action, 'appended');

    const crlf = fakeGh({ prBody: `Summary\r\nAcceptance packet: ${url}\r\nMore`, files: { '/f/packet.md': FIRST_BODY } });
    assert.equal(publish(crlf, { prNumber: 12 }).prLink.action, 'present');
  });

  test('a stale link of this record is replaced in place, its line ending kept', () => {
    const stale = 'https://github.com/o/r/issues/7#issuecomment-old';
    const url = commentFixture(1).url;
    const gh = fakeGh({ prBody: `Summary\r\nAcceptance packet: ${stale}\r\nMore`, files: { '/f/packet.md': FIRST_BODY } });
    assert.deepEqual(publish(gh, { prNumber: 12 }).prLink, { ok: true, action: 'replaced' });
    assert.equal(gh.state.prBody, `Summary\r\nAcceptance packet: ${url}\r\nMore`);
    assert.equal(gh.state.files[TMP_PATH], gh.state.prBody);
  });

  test('repeats of this record\'s link collapse to one line', () => {
    const url = commentFixture(1).url;
    const gh = fakeGh({
      prBody: `Acceptance packet: ${url}\nMiddle\nAcceptance packet: https://github.com/o/r/issues/7#issuecomment-old\n`,
      files: { '/f/packet.md': FIRST_BODY },
    });
    assert.equal(publish(gh, { prNumber: 12 }).prLink.action, 'replaced');
    assert.equal(gh.state.prBody, `Acceptance packet: ${url}\nMiddle\n`);
  });

  test('a shared PR keeps one link per record: another record\'s line stays', () => {
    const other = 'https://github.com/o/r/issues/8#issuecomment-5';
    const url = commentFixture(1).url;
    const gh = fakeGh({ prBody: `Summary\n\nAcceptance packet: ${other}\n`, files: { '/f/packet.md': FIRST_BODY } });
    assert.deepEqual(publish(gh, { prNumber: 12 }).prLink, { ok: true, action: 'appended' });
    assert.ok(gh.state.prBody.includes(`Acceptance packet: ${other}\n`), 'the other record\'s link survives');
    assert.ok(gh.state.prBody.includes(`Acceptance packet: ${url}\n`), 'this record has its own');

    // A prefix of this record's number is another record too.
    const prefix = fakeGh({ prBody: 'Acceptance packet: https://github.com/o/r/issues/77#issuecomment-5', files: { '/f/packet.md': FIRST_BODY } });
    assert.equal(publish(prefix, { prNumber: 12 }).prLink.action, 'appended');
  });

  test('no PR number means no PR calls', () => {
    const gh = fakeGh({ files: { '/f/packet.md': FIRST_BODY } });
    assert.equal(publish(gh, { prNumber: null }).prLink, null);
    assert.equal(gh.state.calls.filter((args) => args[0] === 'pr').length, 0);
  });

  test('PR link failures never fail the publish', () => {
    const shapes = [
      { fail: { prView: 'pr view down' }, message: 'pr view down' },
      { fail: { prEdit: 'pr edit down' }, message: 'pr edit down' },
    ];
    for (const { fail, message } of shapes) {
      const gh = fakeGh({ fail, prBody: 'Summary', files: { '/f/packet.md': FIRST_BODY } });
      const result = publish(gh, { prNumber: 12, label: 'demo:pending' });
      assert.equal(result.ok, true);
      assert.equal(result.labelApplied, true);
      assert.deepEqual(result.prLink, { ok: false, action: null, error: message });
      assert.equal(result.error, undefined);
    }

    const unwritable = fakeGh({ prBody: 'Summary', files: { '/f/packet.md': FIRST_BODY } });
    const result = publish(unwritable, { prNumber: 12, writeFile: () => { throw new Error('disk full'); } });
    assert.equal(result.ok, true);
    assert.deepEqual(result.prLink, { ok: false, action: null, error: 'disk full' });
    assert.equal(unwritable.state.calls.filter((args) => args[0] === 'pr' && args[1] === 'edit').length, 0);
  });

  test('a PR view without a body string is a link failure, not an empty body', () => {
    const gh = fakeGh({ prBody: null, files: { '/f/packet.md': FIRST_BODY } });
    const result = publish(gh, { prNumber: 12 });
    assert.equal(result.ok, true);
    assert.deepEqual(result.prLink, { ok: false, action: null, error: 'the pull request view has no body' });
    assert.equal(gh.state.calls.filter((args) => args[0] === 'pr' && args[1] === 'edit').length, 0);
  });

  test('a post that prints no url states it instead of linking a blank', () => {
    const gh = fakeGh({ prBody: 'Summary', files: { '/f/packet.md': FIRST_BODY } });
    const result = publishPacket({
      issue: 7,
      bodyFile: '/f/packet.md',
      prNumber: 12,
      writeFile: () => {},
      tmpPath: TMP_PATH,
      runner: (args) => (args[1] === 'comment' ? '\n' : gh.runner(args)),
    });
    assert.equal(result.ok, true);
    assert.equal(result.url, null);
    assert.equal(result.prLink.ok, false);
    assert.equal(gh.state.prBody, 'Summary');
  });
});

describe('publishPacket: --repo', () => {
  const REPO_FLAG = ['--repo', 'o/r'];

  test('--repo goes on every gh issue and gh pr call, never on gh api', () => {
    const updating = fakeGh({
      comments: [commentFixture(1)],
      prBody: 'Summary',
      files: { '/f/packet.md': SECOND_BODY },
    });
    const updated = publish(updating, { repo: 'o/r', label: 'demo:pending', prNumber: 12 });
    assert.equal(updated.ok, true, 'real gh refuses --repo on api, so an edit under --repo would fail');
    assert.equal(updated.action, 'updated');
    assert.deepEqual(updating.state.labels, ['demo:pending'], 'a landed edit keeps the label');
    const apiCalls = updating.state.calls.filter((args) => args[0] === 'api');
    assert.equal(apiCalls.length, 1);
    assert.deepEqual(apiCalls[0], ['api', 'graphql', '-f', EDIT_QUERY, '-f', 'id=IC_1', '-F', 'body=@/f/packet.md']);
    const nonApi = updating.state.calls.filter((args) => args[0] !== 'api');
    assert.ok(nonApi.length >= 4);
    for (const args of nonApi) assert.deepEqual(args.slice(-2), REPO_FLAG, args.join(' '));

    const creating = fakeGh({ prBody: 'Summary', files: { '/f/packet.md': FIRST_BODY } });
    publish(creating, { repo: 'o/r', label: 'demo:pending', prNumber: 12 });
    assert.equal(creating.state.calls.length, 5);
    for (const args of creating.state.calls) assert.deepEqual(args.slice(-2), REPO_FLAG, args.join(' '));
  });

  test('the failure path carries --repo too', () => {
    const gh = fakeGh({ labels: ['demo:pending'], fail: { post: 'denied' }, files: { '/f/packet.md': FIRST_BODY } });
    publish(gh, { repo: 'o/r' });
    assert.deepEqual(gh.state.calls, [
      ['issue', 'view', '7', '--json', 'comments', ...REPO_FLAG],
      ['issue', 'comment', '7', '--body-file', '/f/packet.md', ...REPO_FLAG],
      ['issue', 'view', '7', '--json', 'labels', ...REPO_FLAG],
      ['issue', 'edit', '7', '--remove-label', 'demo:pending', ...REPO_FLAG],
    ]);
  });

  test('no repo means no flag', () => {
    const gh = fakeGh({ prBody: 'Summary', files: { '/f/packet.md': FIRST_BODY } });
    publish(gh, { label: 'demo:pending', prNumber: 12 });
    assert.ok(gh.state.calls.every((args) => !args.includes('--repo')));
  });
});

describe('upsertLocalPacket', () => {
  const block = (packet) => `${LOCAL_START}\n${packet}\n${LOCAL_END}`;

  test('appends after one blank line when absent', () => {
    assert.equal(upsertLocalPacket('# Record', 'PACKET'), `# Record\n\n${block('PACKET')}`);
    assert.equal(upsertLocalPacket('# Record\n', 'PACKET'), `# Record\n\n${block('PACKET')}\n`);
    assert.equal(upsertLocalPacket('# Record\n\n\n', 'PACKET'), `# Record\n\n${block('PACKET')}\n`);
    assert.equal(upsertLocalPacket('', 'PACKET'), block('PACKET'));
    assert.equal(upsertLocalPacket('\n', 'PACKET'), block('PACKET'));
  });

  test('replaces in place when present, content around the delimiters unchanged', () => {
    const before = '# Record\n\nintro\n\n';
    const after = '\n\n## Later\n\ntail\n';
    const result = upsertLocalPacket(`${before}${block('OLD\nLINES')}${after}`, 'NEW');
    assert.equal(result, `${before}${block('NEW')}${after}`);
    assert.equal(result.split(LOCAL_START).length - 1, 1);
    assert.equal(result.includes('OLD'), false);
  });

  test('a second upsert over its own append is stable', () => {
    const once = upsertLocalPacket('# Record\n', 'ONE');
    assert.equal(upsertLocalPacket(once, 'TWO'), `# Record\n\n${block('TWO')}\n`);
  });

  test('replacement text is literal', () => {
    const packet = "costs $& and $1 and $` and $'";
    assert.equal(upsertLocalPacket(block('OLD'), packet), block(packet));
  });

  test('a delimiter named in prose is not a delimiter', () => {
    const prose = `Do not edit between \`${LOCAL_START}\` and \`${LOCAL_END}\`.`;
    assert.equal(upsertLocalPacket(prose, 'PACKET'), `${prose}\n\n${block('PACKET')}`);

    const shaped = `${prose}\n\n${block('OLD')}\n`;
    assert.equal(upsertLocalPacket(shaped, 'NEW'), `${prose}\n\n${block('NEW')}\n`);

    // A start named in prose opens nothing, so a lone end line below it stays put.
    const proseStart = `Opens at \`${LOCAL_START}\`.\nnotes\n${LOCAL_END}`;
    assert.equal(upsertLocalPacket(proseStart, 'PACKET'), `${proseStart}\n\n${block('PACKET')}`);

    // An end named in prose closes nothing, so the block runs on to the real end line.
    const proseEnd = block(`Closes at \`${LOCAL_END}\`.\nOLD`);
    assert.equal(upsertLocalPacket(proseEnd, 'NEW'), block('NEW'));
  });

  test('a CRLF body keeps its line endings', () => {
    const crlfBlock = (packet) => `${LOCAL_START}\r\n${packet}\r\n${LOCAL_END}`;
    assert.equal(
      upsertLocalPacket(`# Record\r\n\r\n${crlfBlock('OLD')}\r\ntail\r\n`, 'A\nB'),
      `# Record\r\n\r\n${crlfBlock('A\r\nB')}\r\ntail\r\n`,
    );
    assert.equal(upsertLocalPacket('# Record\r\n', 'A\nB'), `# Record\r\n\r\n${crlfBlock('A\r\nB')}\r\n`);
  });

  test('a CRLF body whose orphan last line has no final newline keeps no bare CR', () => {
    const crlfBlock = (packet) => `${LOCAL_START}\r\n${packet}\r\n${LOCAL_END}`;
    assert.equal(
      upsertLocalPacket(`${crlfBlock('OLD')}\r\ntext\r\n${LOCAL_START}`, 'NEW'),
      `${crlfBlock('NEW')}\r\ntext`,
    );
    assert.equal(
      upsertLocalPacket(`${crlfBlock('OLD')}\r\ntext\r\n${LOCAL_START}\r\n`, 'NEW'),
      `${crlfBlock('NEW')}\r\ntext\r\n`,
    );
  });

  test('a long newline run after the record text is trimmed whole', () => {
    for (const eol of ['\n', '\r\n']) {
      const run = eol.repeat(200000);
      const result = upsertLocalPacket(`${run}x`, 'PACKET');
      assert.equal(result, `${run}x${eol}${eol}${LOCAL_START}${eol}PACKET${eol}${LOCAL_END}`);
      assert.equal(upsertLocalPacket(`x${run}`, 'PACKET'), `x${eol}${eol}${LOCAL_START}${eol}PACKET${eol}${LOCAL_END}${eol}`);
    }
  });

  test('an orphan start is the block start, and never swallows the text after it', () => {
    const stray = `${LOCAL_START}\nhuman notes\n`;
    const first = upsertLocalPacket(stray, 'ONE');
    assert.equal(first, `${block('ONE')}\nhuman notes\n`);
    assert.equal(first.split(LOCAL_START).length - 1, 1, 'one packet, no stray delimiter left');
    assert.equal(upsertLocalPacket(first, 'TWO'), `${block('TWO')}\nhuman notes\n`);
  });

  test('an orphan start below a lone end delimiter is still the block start', () => {
    assert.equal(
      upsertLocalPacket(`${LOCAL_END}\nnotes\n${LOCAL_START}\nmore\n`, 'NEW'),
      `${LOCAL_END}\nnotes\n${block('NEW')}\nmore\n`,
    );
  });

  test('near-delimiter lines are delimiters, so a re-run never leaves two packets', () => {
    for (const body of [
      `${LOCAL_START} \nOLD\n${LOCAL_END}  `,
      `  ${LOCAL_START}\nOLD\n    ${LOCAL_END}`,
      `\t${LOCAL_START}\t\nOLD\n${LOCAL_END}`,
    ]) {
      const result = upsertLocalPacket(body, 'NEW');
      assert.equal(result, block('NEW'), JSON.stringify(body));
    }
  });

  test('a block then an orphan start leaves one block, no stray start, and the text kept', () => {
    const body = `${block('A')}\nhuman\n${LOCAL_START}\nB\n`;
    const once = upsertLocalPacket(body, 'NEW');
    assert.equal(once, `${block('NEW')}\nhuman\nB\n`);
    assert.equal(upsertLocalPacket(once, 'NEWER'), `${block('NEWER')}\nhuman\nB\n`);
  });

  test('a stray start above a complete block goes alone, and the text between stays', () => {
    assert.equal(upsertLocalPacket(`${LOCAL_START}\nnotes\n${block('A')}\ntail`, 'NEW'), `${block('NEW')}\nnotes\ntail`);
  });

  test('two complete blocks collapse into the first one\'s place, keeping the text between them', () => {
    const result = upsertLocalPacket(`intro\n${block('A')}\nbetween\n${block('B')}\ntail\n`, 'NEW');
    assert.equal(result, `intro\n${block('NEW')}\nbetween\ntail\n`);
    const crlf = upsertLocalPacket(`${LOCAL_START}\r\nA\r\n${LOCAL_END}\r\n${LOCAL_START}\r\nB\r\n${LOCAL_END}\r\ntail\r\n`, 'NEW');
    assert.equal(crlf, `${LOCAL_START}\r\nNEW\r\n${LOCAL_END}\r\ntail\r\n`);
  });

  test('an end delimiter ahead of the block is not an anchor', () => {
    assert.equal(
      upsertLocalPacket(`${LOCAL_END}\nnotes\n\n${block('OLD')}\n`, 'NEW'),
      `${LOCAL_END}\nnotes\n\n${block('NEW')}\n`,
    );
  });
});
