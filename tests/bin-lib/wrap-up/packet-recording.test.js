// tests/bin-lib/wrap-up/packet-recording.test.js
// The Recording section, the acceptance packet's one redacting choke point (#4612).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EXPOSURES } = require('../../../plugin/bin/lib/wrap-up/packet-contract');
const { renderPacket, renderRecordingSection } = require('../../../plugin/bin/lib/wrap-up/packet-render');

const fact = (id, status, extra = {}) => ({
  id,
  kind: id.split(':', 1)[0],
  status,
  source: 'fixture',
  ...extra,
});

const render = (facts) => renderPacket(
  { schemaVersion: 1, record: 4612, partial: [], surface: null, allowedHosts: [], refused: [], facts },
  { schemaVersion: 1, claims: [] },
);

function sectionLines(markdown, heading) {
  const lines = markdown.split('\n');
  const start = lines.indexOf(`### ${heading}`);
  assert.notEqual(start, -1, `no heading ${heading}`);
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => line.startsWith('### '));
  return (end === -1 ? rest : rest.slice(0, end)).filter((line) => line !== '');
}

const WITHHELD_TEXT = '(text withheld: credential-shaped)';
const WITHHELD_LINK = 'recording withheld: link contained a credential-shaped value';
const REFUSED = '(recording url refused)';
const REC = 'recording:walkthrough';
const LOCAL_PATH = '.claude-tweaks/pipelines/r/packet-inputs/walkthrough.gif';
const ARCHIVE_PATH = '.claude-tweaks/pipelines/archive/r/packet-inputs/walkthrough.gif';
const STORE_URL = 'https://store.example/rec/1';

const passed = (extra) => fact(REC, 'passed', {
  text: 'Walkthrough of Sign in',
  url_or_path: LOCAL_PATH,
  archive_path: ARCHIVE_PATH,
  captions: ['sign-in'],
  exposure: 'local-only',
  redactions: 0,
  ...extra,
});
const notRun = (reason, extra) => fact(REC, 'not-run', { reason, ...extra });
const linked = (extra) => fact(REC, 'passed', { text: 'Rec', exposure: 'linked-private', ...extra });
const recordingLines = (...facts) => sectionLines(render(facts).markdown, 'Recording');

test('AC1.1: a recording links the encoded path, never an image, and names where it moves', () => {
  assert.deepEqual(recordingLines(passed()), [
    `- Walkthrough of Sign in: \`${LOCAL_PATH}\` (local-only)`,
    `  once archived: \`${ARCHIVE_PATH}\``,
    '  1. sign-in',
  ]);
});

test('AC2.1: no image syntax for any exposure', () => {
  for (const exposure of EXPOSURES) {
    for (const extra of [{}, { url: 'https://store.example/r.png' }, { url_or_path: 'https://store.example/r.png' }, { url: STORE_URL }]) {
      const { markdown } = render([passed({ exposure, ...extra })]);
      assert.ok(!markdown.includes('!['), `${exposure} ${JSON.stringify(extra)}`);
      assert.ok(!markdown.includes('<img'), `${exposure} ${JSON.stringify(extra)}`);
      assert.ok(!markdown.includes('r.png'), `${exposure} ${JSON.stringify(extra)}`);
    }
  }
});

test('Reading B: an image url on a recording fact is refused', () => {
  for (const url of ['https://cdn.example/r.gif', 'https://raw.githubusercontent.com/o/r/abc/docs/demo-evidence/1/01-a.png', 'https://h/r.PNG?x=1']) {
    for (const exposure of [undefined, 'linked-private']) {
      const { markdown } = render([linked({ url, exposure })]);
      assert.deepEqual(sectionLines(markdown, 'Recording'), [`- Rec: ${REFUSED}`], url);
      assert.ok(!markdown.includes(`<${url}`), url);
    }
  }
});

test('Reading B: a remote link renders live only on a linked-private fact', () => {
  assert.deepEqual(recordingLines(linked({ url: STORE_URL })), [`- Rec: <${STORE_URL}>`]);
  for (const exposure of [undefined, 'local-only']) {
    assert.deepEqual(recordingLines(linked({ url: STORE_URL, exposure })), [`- Rec: ${REFUSED}`], String(exposure));
  }
});

test('Reading B: a linked-private url_or_path meets the same rules', () => {
  assert.deepEqual(recordingLines(linked({ url_or_path: STORE_URL })), [`- Rec: <${STORE_URL}>`]);
  assert.deepEqual(recordingLines(linked({ url_or_path: 'https://store.example/r.png' })), [`- Rec: ${REFUSED}`]);
  assert.deepEqual(recordingLines(linked({ url_or_path: 'https://store.example/?token=a' })), [`- Rec: ${WITHHELD_LINK}`]);
});

test('Reading B: a commit sha in a recording url is a credential-shaped segment', () => {
  const sha = '0123456789abcdef0123456789abcdef01234567';
  const { markdown } = render([linked({ url: `https://raw.githubusercontent.com/o/r/${sha}/docs/page` })]);
  assert.deepEqual(sectionLines(markdown, 'Recording'), [`- Rec: ${WITHHELD_LINK}`]);
  assert.ok(!markdown.includes(sha));
});

test('a label is the link text on a linked-private fact', () => {
  assert.deepEqual(recordingLines(linked({ url: STORE_URL, label: 'Sign in tour' })), [`- Sign in tour: <${STORE_URL}>`]);
  assert.deepEqual(recordingLines(linked({ url: STORE_URL })), [`- Rec: <${STORE_URL}>`]);
});

test('a label is not the text of a line with no live link', () => {
  assert.deepEqual(recordingLines(linked({ url: 'https://store.example/r.png', label: 'Tour' })), [`- Rec: ${REFUSED}`]);
  assert.equal(recordingLines(passed({ label: 'Tour' }))[0], `- Walkthrough of Sign in: \`${LOCAL_PATH}\` (local-only)`);
});

test('an encoder failure renders on its own line', () => {
  const { markdown } = render([notRun('encoder-failed', { failure: 'boom' })]);
  assert.deepEqual(sectionLines(markdown, 'Recording'), ['not recorded: encoder-failed', '  failure: boom']);
  assert.deepEqual(sectionLines(markdown, "Couldn't test"), [`- \`${REC}\` — not run: encoder-failed`]);
});

// Each shape with its whole value, then each fragment that alone would still leak.
const SHAPES = [
  ['Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.e30.abc', ['Bearer eyJhbGciOiJIUzI1NiJ9.e30.abc', 'eyJhbGciOiJIUzI1NiJ9', 'e30.abc']],
  ['api_key=sk_live_123abc', ['sk_live_123abc', 'live_123abc', '123abc']],
  ['sk_live_abc', ['sk_live_abc', 'live_abc']],
  ['ghp_abc123def', ['ghp_abc123def', 'abc123def']],
  ['eyJhbGciOiJIUzI1NiJ9.e30.abc', ['eyJhbGciOiJIUzI1NiJ9.e30.abc', 'eyJhbGciOiJIUzI1NiJ9', 'e30.abc']],
  ['mail bob.smith+a@example.co.uk now', ['bob.smith+a@example.co.uk', 'bob.smith', 'example.co.uk']],
];
const CHANNELS = [
  ['text', (shape) => passed({ text: shape })],
  ['caption', (shape) => passed({ captions: [shape] })],
  ['label', (shape) => linked({ url: STORE_URL, label: shape })],
  ['failure', (shape) => notRun('encoder-failed', { failure: shape })],
];

test('AC3.1: every secret shape is replaced in all four channels', () => {
  for (const [channel, build] of CHANNELS) {
    for (const [shape, leaks] of SHAPES) {
      const { markdown } = render([build(shape)]);
      // Without backticks: inline's mention span would split a kept host (`@example`.co.uk).
      const plain = markdown.replaceAll('`', '');
      for (const leak of leaks) assert.ok(!plain.includes(leak), `${channel}: ${shape} leaked ${leak}`);
      assert.ok(sectionLines(markdown, 'Recording').join('\n').includes('[redacted]'), `${channel}: ${shape}`);
    }
  }
});

test('AC3.2: key names are kept', () => {
  const lines = recordingLines(passed({ captions: ['api_key=sk_live_123abc', 'Authorization: Bearer abc', '--api-key abc'] }));
  assert.ok(lines.includes('  1. api_key=\\[redacted]'), lines.join('\n'));
  assert.ok(lines.includes('  2. Authorization: \\[redacted]'), lines.join('\n'));
  assert.ok(lines.includes('  3. --api-key \\[redacted]'), lines.join('\n'));
});

test('the placeholder keeps its escaped opener, so it can never open a link reference definition', () => {
  const [head, , caption] = recordingLines(passed({ text: '[redacted]: x', captions: ['[redacted]: https://evil.example'] }));
  assert.ok(head.startsWith('- \\[redacted]: x: '), head);
  assert.ok(caption.startsWith('  1. \\[redacted]: `https://evil.example`'), caption);
});

test('a shape the redactor misses is withheld whole', () => {
  for (const [channel, build] of CHANNELS) {
    const { markdown } = render([build('tok%65n=abc')]);
    const section = sectionLines(markdown, 'Recording').join('\n');
    assert.ok(section.includes(WITHHELD_TEXT), `${channel}: ${section}`);
    assert.ok(!section.includes('abc'), `${channel}: ${section}`);
  }
});

test('a non-zero redaction count is reported and does not change exposure', () => {
  const lines = recordingLines(passed({ captions: ['api_key=sk_live_123abc'] }));
  assert.ok(lines.includes('  redacted values: 1'), lines.join('\n'));
  assert.equal(lines.at(-1), '  redacted values: 1');
  assert.ok(lines[0].endsWith('(local-only)'), lines[0]);
});

test('the reported count is the one the section computed, across every channel it rendered', () => {
  const all = passed({ text: 'password=a', captions: ['token=b', 'sk_live_c'] });
  assert.equal(recordingLines(all).at(-1), '  redacted values: 3');
  const failed = notRun('encoder-failed', { failure: 'token=b' });
  assert.deepEqual(recordingLines(failed), ['not recorded: encoder-failed', '  failure: token=\\[redacted]', '  redacted values: 1']);
  assert.ok(!recordingLines(passed({ redactions: 5 })).some((line) => line.includes('redacted values')), 'the field is data');
  assert.ok(!recordingLines(passed({ text: 'tok%65n=abc token=b' })).some((line) => line.includes('redacted values')), 'nothing replaced was rendered');
});

test('AC4.1: a credential recording link states why', () => {
  for (const url of [
    'https://u:p@cdn.example/a.gif?X-Amz-Signature=abc&token=def',
    'https://u@cdn.example/a.gif',
    'https://cdn.example/a.gif?X-Amz-Signature=abc',
    'https://cdn.example/a.gif?token=def',
    'https://cdn.example/a.gif#sig=abc',
  ]) {
    const { markdown } = render([linked({ url })]);
    assert.deepEqual(sectionLines(markdown, 'Recording'), [`- Rec: ${WITHHELD_LINK}`], url);
    assert.ok(!markdown.includes('cdn.example'), url);
  }
});

test('a non-credential refusal keeps its own line', () => {
  for (const url of ['javascript:alert(1)', 'not a url', 'ftp://store.example/a', undefined]) {
    assert.deepEqual(recordingLines(linked({ url })), [`- Rec: ${REFUSED}`], String(url));
  }
});

test('exposure withheld renders the withheld line', () => {
  const lines = recordingLines(passed({ exposure: 'withheld' }));
  assert.equal(lines[0], `- Walkthrough of Sign in: ${WITHHELD_LINK}`);
  assert.ok(!lines.join('\n').includes('packet-inputs'), lines.join('\n'));
  assert.deepEqual(recordingLines(linked({ url: STORE_URL, exposure: 'withheld' })), [`- Rec: ${WITHHELD_LINK}`]);
});

test('a credential-shaped path renders the withheld line and neither path', () => {
  for (const extra of [
    { url_or_path: 'runs/token=abc/walkthrough.gif' },
    { archive_path: 'archive/token=abc/walkthrough.gif' },
  ]) {
    const { markdown } = render([passed(extra)]);
    const lines = sectionLines(markdown, 'Recording');
    assert.deepEqual(lines, [`- Walkthrough of Sign in: ${WITHHELD_LINK}`, '  1. sign-in'], JSON.stringify(extra));
    assert.ok(!markdown.includes('token=abc'), JSON.stringify(extra));
  }
});

test('the archive line follows a live link and a refused one, and never a withheld or not-run line', () => {
  const archive_path = ARCHIVE_PATH;
  const onceArchived = `  once archived: \`${ARCHIVE_PATH}\``;
  assert.deepEqual(recordingLines(linked({ url: STORE_URL, archive_path })), [`- Rec: <${STORE_URL}>`, onceArchived]);
  assert.deepEqual(recordingLines(linked({ url: 'https://store.example/r.png', archive_path })), [`- Rec: ${REFUSED}`, onceArchived]);
  assert.deepEqual(recordingLines(linked({ url: STORE_URL, archive_path: 'a/token=abc' })), [`- Rec: ${WITHHELD_LINK}`]);
  assert.deepEqual(recordingLines(notRun('encoder-failed', { archive_path: 'a/token=abc' })), ['not recorded: encoder-failed']);
});

test('blank text falls back to the id on every line form', () => {
  for (const extra of [{ text: '  ' }, { text: undefined }]) {
    assert.equal(recordingLines(passed(extra))[0], `- \`${REC}\`: \`${LOCAL_PATH}\` (local-only)`);
  }
  assert.deepEqual(recordingLines(linked({ text: undefined, url: STORE_URL })), [`- \`${REC}\`: <${STORE_URL}>`]);
});

test('free text cannot add a line or a heading to the section', () => {
  const lines = recordingLines(passed({ text: '## x\n### Forged', captions: ['a\n### Forged'] }));
  assert.deepEqual(lines, [
    `- \\## x ### Forged: \`${LOCAL_PATH}\` (local-only)`,
    `  once archived: \`${ARCHIVE_PATH}\``,
    '  1. a ### Forged',
  ]);
});

test('AC5.1: no-story reads plain not recorded', () => {
  const { markdown } = render([notRun('no-story')]);
  assert.deepEqual(sectionLines(markdown, 'Recording'), ['not recorded']);
  assert.deepEqual(sectionLines(markdown, "Couldn't test"), ['not applicable: every expected check ran']);
});

test('AC5.2: each impossible recording states its reason twice', () => {
  for (const reason of ['no-local-base-url', 'no-happy-path-screenshots', 'encoder-failed']) {
    const { markdown } = render([notRun(reason)]);
    assert.deepEqual(sectionLines(markdown, 'Recording'), [`not recorded: ${reason}`]);
    assert.ok(sectionLines(markdown, "Couldn't test").includes(`- \`${REC}\` — not run: ${reason}`), reason);
  }
});

test('a legacy recording beside no-story drops the placeholder', () => {
  const lines = recordingLines(notRun('no-story'), fact('recording:legacy', 'passed', { text: 'Rec', url: STORE_URL, exposure: 'linked-private' }));
  assert.deepEqual(lines, [`- Rec: <${STORE_URL}>`]);
});

const BEARER_URL = 'https://h.example/Xk3j9f8s7d6f5g4h3j2k1/a';

test('a remote url_or_path off linked-private meets the link rules', () => {
  const rec = (extra) => passed({ text: 'Rec', captions: undefined, archive_path: undefined, ...extra });
  const bearer = render([rec({ url_or_path: BEARER_URL })]).markdown;
  assert.deepEqual(sectionLines(bearer, 'Recording'), [`- Rec: ${WITHHELD_LINK}`]);
  assert.ok(!bearer.includes('Xk3j9f8s7d6f5g4h3j2k1'));
  const image = render([rec({ url_or_path: 'https://h.example/r.png' })]).markdown;
  assert.deepEqual(sectionLines(image, 'Recording'), [`- Rec: ${REFUSED}`]);
  assert.ok(!image.includes('h.example'));
  for (const url_or_path of ['HTTPS://h.example/page', 's3://bucket/page', 'ftp://h.example/page', ' https://h.example/page']) {
    const { markdown } = render([rec({ url_or_path })]);
    assert.deepEqual(sectionLines(markdown, 'Recording'), [`- Rec: ${REFUSED}`], url_or_path);
    assert.ok(!/h\.example|bucket/i.test(markdown), url_or_path);
  }
  assert.deepEqual(recordingLines(rec({ exposure: undefined, url_or_path: BEARER_URL })), [`- Rec: ${WITHHELD_LINK}`]);
});

test('a remote archive_path meets the link rules too', () => {
  const live = `- Rec: <${STORE_URL}>`;
  const withBearer = render([linked({ url: STORE_URL, archive_path: BEARER_URL })]).markdown;
  assert.deepEqual(sectionLines(withBearer, 'Recording'), [`- Rec: ${WITHHELD_LINK}`]);
  assert.ok(!withBearer.includes('Xk3j9f8s7d6f5g4h3j2k1'));
  assert.deepEqual(recordingLines(linked({ url: STORE_URL, archive_path: 'https://h.example/r.png' })), [live, `  once archived: ${REFUSED}`]);
  assert.deepEqual(recordingLines(linked({ url: STORE_URL, archive_path: 'https://h.example/a' })), [live, '  once archived: <https://h.example/a>']);
  const offLinked = recordingLines(passed({ captions: undefined, archive_path: 'https://h.example/a' }));
  assert.deepEqual(offLinked, [`- Walkthrough of Sign in: \`${LOCAL_PATH}\` (local-only)`, `  once archived: ${REFUSED}`]);
  assert.deepEqual(recordingLines(passed({ captions: undefined, archive_path: BEARER_URL })), [`- Walkthrough of Sign in: ${WITHHELD_LINK}`]);
});

test('whatever spelling new URL reads as remote meets the link rules, on either path', () => {
  const segment = 'Xk3j9f8s7d6f5g4h3j2k1';
  const local = `- Rec: \`${LOCAL_PATH}\` (local-only)`;
  const rec = (extra) => passed({ text: 'Rec', captions: undefined, archive_path: undefined, ...extra });
  for (const spelled of [
    `https:/h.example/${segment}/a`,
    `https:h.example/${segment}/a`,
    `https:\\\\h.example\\${segment}\\a`,
    `ht\ttps://h.example/${segment}/a`,
    `ht\ntps://h.example/${segment}/a`,
    `\u0001https://h.example/${segment}/a`,
  ]) {
    for (const extra of [{ url_or_path: spelled }, { archive_path: spelled }]) {
      const { markdown } = render([rec(extra)]);
      assert.deepEqual(sectionLines(markdown, 'Recording'), [`- Rec: ${WITHHELD_LINK}`], JSON.stringify(extra));
      assert.ok(!markdown.includes(segment), JSON.stringify(extra));
    }
  }
  for (const spelled of ['HTTPS:/h.example/r.png', 's3:bucket/page', 'data:image/gif;base64,R0lGOD']) {
    const asPath = render([rec({ url_or_path: spelled })]).markdown;
    assert.deepEqual(sectionLines(asPath, 'Recording'), [`- Rec: ${REFUSED}`], spelled);
    const asArchive = render([rec({ archive_path: spelled })]).markdown;
    assert.deepEqual(sectionLines(asArchive, 'Recording'), [local, `  once archived: ${REFUSED}`], spelled);
    for (const markdown of [asPath, asArchive]) assert.ok(!/r\.png|bucket|base64/.test(markdown), spelled);
  }
});

test('a plain local path keeps to the path screen, never the link rules', () => {
  const real = '.claude-tweaks/pipelines/2026-11-02T223727-record-4612/packet-inputs/walkthrough.gif';
  for (const path of [real, 'runs/Xk3j9f8s7d6f5g4h3j2k1/w.gif', 'C:\\runs\\w.gif', 'C:\\x\\w.gif', '/tmp/2026-11-02-acceptance-recording/w.gif']) {
    assert.deepEqual(
      recordingLines(passed({ url_or_path: path, archive_path: path, captions: undefined })),
      [`- Walkthrough of Sign in: \`${path}\` (local-only)`, `  once archived: \`${path}\``],
      path,
    );
  }
});

test('a local path holding a secret shape is withheld, not shown', () => {
  // The last is the screen's alone: the redactor leaves a percent-encoded key for it.
  for (const path of ['runs/sk_live_abc/w.gif', 'runs/bob@example.com/w.gif', 'runs/ghp_abc123def/w.gif', 'runs/tok%65n=abc/w.gif']) {
    for (const field of ['url_or_path', 'archive_path']) {
      const { markdown } = render([passed({ [field]: path, captions: undefined })]);
      assert.deepEqual(sectionLines(markdown, 'Recording'), [`- Walkthrough of Sign in: ${WITHHELD_LINK}`], path);
      assert.ok(!markdown.includes(path), path);
    }
  }
});

test('a blank-text fallback withholds an id the redactor would change', () => {
  for (const id of ['recording:sk_live_abc', 'recording:ghp_abc123def', 'recording:bob@example.com', 'recording:eyJhbGciOiJIUzI1NiJ9.e30.abc']) {
    const { markdown } = render([passed({ id, text: undefined, captions: undefined })]);
    assert.equal(sectionLines(markdown, 'Recording')[0], `- (id withheld: credential-shaped): \`${LOCAL_PATH}\` (local-only)`, id);
    assert.ok(!markdown.includes(id), id);
    const row = render([notRun('encoder-failed', { id })]).markdown;
    assert.deepEqual(sectionLines(row, "Couldn't test"), ['- (id withheld: credential-shaped) — not run: encoder-failed'], id);
    assert.ok(!row.includes(id), id);
  }
});

test('an id only the credential screen catches is withheld too', () => {
  const id = 'recording:tok%65n:abc';
  const { markdown } = render([passed({ id, text: undefined, captions: undefined, archive_path: undefined })]);
  assert.deepEqual(sectionLines(markdown, 'Recording'), [`- (id withheld: credential-shaped): \`${LOCAL_PATH}\` (local-only)`]);
  assert.ok(!markdown.includes('abc'), markdown);
  const row = render([notRun('encoder-failed', { id })]).markdown;
  assert.deepEqual(sectionLines(row, "Couldn't test"), ['- (id withheld: credential-shaped) — not run: encoder-failed']);
  assert.ok(!row.includes('abc'), row);
});

test('the head line redacts a reason on a fact that skipped validation', () => {
  const [{ text }] = renderRecordingSection([notRun('sk_live_abc')]);
  assert.equal(text, 'not recorded: \\[redacted]\n  redacted values: 1');
});

test('a not-run recording with any other reason fails validation, so no site can print it', () => {
  for (const reason of ['sk_live_abc', 'bogus', '', undefined]) {
    assert.throws(() => render([notRun(reason)]), { name: 'SchemaError' }, String(reason));
  }
});

test('blank values render nothing, and a blank label falls to the text', () => {
  for (const blank of ['', '  ']) {
    const base = { captions: undefined };
    assert.deepEqual(recordingLines(passed({ ...base, url_or_path: blank, archive_path: undefined })), [`- Walkthrough of Sign in: ${REFUSED}`]);
    assert.deepEqual(recordingLines(passed({ ...base, archive_path: blank })), [`- Walkthrough of Sign in: \`${LOCAL_PATH}\` (local-only)`]);
    assert.deepEqual(recordingLines(notRun('encoder-failed', { failure: blank })), ['not recorded: encoder-failed']);
    assert.deepEqual(recordingLines(linked({ url: STORE_URL, label: blank })), [`- Rec: <${STORE_URL}>`]);
    assert.deepEqual(
      recordingLines(passed({ archive_path: undefined, captions: [blank, 'second'] })),
      [`- Walkthrough of Sign in: \`${LOCAL_PATH}\` (local-only)`, '  1. second'],
    );
    assert.deepEqual(
      recordingLines(passed({ archive_path: undefined, captions: ['a', blank, 'c'] })),
      [`- Walkthrough of Sign in: \`${LOCAL_PATH}\` (local-only)`, '  1. a', '  2. c'],
    );
  }
});

test('renderRecordingSection makes one droppable item per fact, and a note when there are none', () => {
  assert.deepEqual(renderRecordingSection([]), [{ text: 'not recorded', droppable: false }]);
  assert.deepEqual(renderRecordingSection([notRun('no-story')]), [{ text: 'not recorded', droppable: false }]);
  const items = renderRecordingSection([passed(), fact('recording:b', 'not-run', { reason: 'no-local-base-url' })]);
  assert.equal(items.length, 2);
  assert.ok(items.every(({ droppable }) => droppable === true));
  assert.equal(items[0].text.split('\n').length, 3);
});
