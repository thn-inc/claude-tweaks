// tests/bin-lib/wrap-up/packet-render.test.js
// Acceptance-packet rendering (#4611).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { PACKET_MARKER, SECTIONS } = require('../../../plugin/bin/lib/wrap-up/packet-contract');
const { SchemaError } = require('../../../plugin/bin/lib/wrap-up/packet-validate');
const { inline, codeSpan, renderPacket } = require('../../../plugin/bin/lib/wrap-up/packet-render');

const fact = (id, status, extra = {}) => ({
  id,
  kind: id.split(':', 1)[0],
  status,
  source: 'fixture',
  ...extra,
});

const factsDoc = (facts, extra = {}) => ({
  schemaVersion: 1,
  record: 4611,
  partial: [],
  surface: null,
  allowedHosts: ['http://localhost:3000'],
  refused: [],
  ...extra,
  facts,
});

const claim = (section, text, refs) => ({ section, text, refs });

function render(facts, claims = [], { extra, options } = {}) {
  return renderPacket(factsDoc(facts, extra), { schemaVersion: 1, claims }, options);
}

// The lines between a section's heading and the next heading, blanks removed.
function sectionLines(markdown, heading) {
  const lines = markdown.split('\n');
  const start = lines.indexOf(`### ${heading}`);
  assert.notEqual(start, -1, `no heading ${heading}`);
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => line.startsWith('### '));
  return (end === -1 ? rest : rest.slice(0, end)).filter((line) => line !== '');
}

const ROW_RE = /^- `(?:check|story):[^`]*` — /;
const rowsIn = (markdown, heading) => sectionLines(markdown, heading).filter((line) => ROW_RE.test(line));
const headingsPresent = (markdown) => SECTIONS.filter(({ key }) => key !== 'decisions')
  .every(({ heading }) => markdown.split('\n').includes(`### ${heading}`));

// Every line's code spans removed, per CommonMark's leftmost matching run, honoring
// backslash escapes outside spans. What is left is the text GitHub would autolink.
function outsideCodeSpans(line) {
  let out = '';
  let at = 0;
  while (at < line.length) {
    if (line[at] === '\\') {
      at += 2;
    } else if (line[at] === '`') {
      const run = /^`+/.exec(line.slice(at))[0];
      let close = at + run.length;
      let closed = -1;
      while (close < line.length) {
        const next = line.indexOf('`', close);
        if (next === -1) break;
        const nextRun = /^`+/.exec(line.slice(next))[0];
        if (nextRun.length === run.length) {
          closed = next;
          break;
        }
        close = next + nextRun.length;
      }
      if (closed === -1) {
        out += run;
        at += run.length;
      } else {
        at = closed + run.length;
      }
    } else {
      out += line[at];
      at += 1;
    }
  }
  return out;
}

const assertNoBareUrl = (markdown) => {
  for (const line of markdown.split('\n')) {
    assert.doesNotMatch(outsideCodeSpans(line), /https?:\/\/|www\./i, line);
  }
};

test('AC1 skipped check under Couldn\'t test, failure under Tried to break, row count matches', () => {
  const { markdown } = render([
    fact('check:unit-tests', 'failed', { reason: '3 failing' }),
    fact('check:lint', 'skipped', { reason: 'fail-fast' }),
    fact('story:login', 'passed'),
  ]);
  assert.ok(sectionLines(markdown, "Couldn't test").includes('- `check:lint` — skipped: fail-fast'));
  assert.ok(sectionLines(markdown, 'Tried to break').includes('- `check:unit-tests` — failed: 3 failing'));
  const guide = sectionLines(markdown, 'Test guide');
  assert.ok(guide.indexOf('- `story:login` — passed') > guide.indexOf('Checks that passed:'));
  assert.notEqual(guide.indexOf('Checks that passed:'), -1);
  const total = ['Test guide', "Couldn't test", 'Tried to break'].flatMap((h) => rowsIn(markdown, h)).length;
  assert.equal(total, 3);
});

test('Q3 routine passes render under Checks that passed, never Tried to break', () => {
  const { markdown } = render([
    fact('check:tests', 'passed'),
    fact('story:login', 'passed'),
    fact('story:login#negative-1', 'passed', { negative: true }),
    fact('story:login#negative-2', 'skipped', { negative: true, reason: 'no dev server' }),
    fact('check:lint', 'failed', { reason: '2 errors' }),
  ]);
  assert.deepEqual(rowsIn(markdown, 'Tried to break'), [
    '- `story:login#negative-1` — passed',
    '- `check:lint` — failed: 2 errors',
  ]);
  assert.deepEqual(rowsIn(markdown, 'Test guide'), ['- `check:tests` — passed', '- `story:login` — passed']);
  assert.deepEqual(rowsIn(markdown, "Couldn't test"), ['- `story:login#negative-2` — skipped: no dev server']);

  const routine = render([fact('check:tests', 'passed'), fact('story:login', 'passed')]).markdown;
  assert.deepEqual(sectionLines(routine, 'Tried to break'), ['not applicable: no negative stories or failures ran']);
});

test('AC2 dropped line', () => {
  const dropped = render([], [claim('what-changed', 'x', ['change:absent'])]);
  assert.match(dropped.markdown, /^1 claim was dropped for missing evidence$/m);
  assert.equal(dropped.dropped.length, 1);
  assert.equal(dropped.dropped[0].reason, 'absent fact change:absent');
  assert.match(render([]).markdown, /^0 claims were dropped for missing evidence$/m);
  const two = [claim('what-changed', 'x', []), claim('what-changed', 'y', [])];
  assert.match(render([], two).markdown, /^2 claims were dropped for missing evidence$/m);
});

test('AC2a not-run renders as not run', () => {
  const { markdown } = render([fact('check:types', 'not-run', { reason: 'no result recorded' })]);
  assert.deepEqual(rowsIn(markdown, "Couldn't test"), ['- `check:types` — not run: no result recorded']);
});

test('a row whose fact has no reason says so, with no dangling colon', () => {
  const { markdown } = render([fact('check:lint', 'skipped')]);
  assert.deepEqual(rowsIn(markdown, "Couldn't test"), ['- `check:lint` — skipped: no reason recorded']);
});

test('a moved claim citing a not-run fact uses the row wording', () => {
  const { markdown } = render(
    [fact('story:signup', 'not-run', { reason: 'no result recorded' })],
    [claim('test-guide', 'Signup verified', ['story:signup'])],
  );
  assert.ok(sectionLines(markdown, "Couldn't test").includes(
    '- Signup verified (moved: cites `story:signup` — not run: no result recorded)',
  ));
});

test('AC2d truncation', () => {
  const claims = Array.from({ length: 3000 }, () => claim('what-changed', 'x'.repeat(40), ['change:a']));
  const result = render([fact('change:a', 'passed')], claims);
  assert.ok(result.chars <= 60000, `chars ${result.chars}`);
  assert.equal(result.chars, result.markdown.length);
  assert.ok(result.truncated > 0);
  assert.ok(result.markdown.includes(`truncated: ${result.truncated} items omitted`));
  assert.ok(headingsPresent(result.markdown));
  const kept = sectionLines(result.markdown, 'What changed').length;
  assert.equal(kept + result.truncated, 3000);
});

test('truncation drops from the longest section and spares the marker, notes and poster', () => {
  const claims = Array.from({ length: 3000 }, () => claim('what-changed', 'x'.repeat(40), ['change:a']));
  const { markdown, truncated } = render(
    [fact('change:a', 'passed'), fact('check:lint', 'skipped', { reason: 'fail-fast' })],
    claims,
    { extra: { partial: ['verify report not found'] }, options: { poster: 'the bot' } },
  );
  assert.ok(truncated > 0);
  assert.equal(markdown.split('\n')[0], PACKET_MARKER);
  assert.ok(markdown.includes('> partial gather: verify report not found'));
  assert.deepEqual(rowsIn(markdown, "Couldn't test"), ['- `check:lint` — skipped: fail-fast']);
  assert.ok(markdown.endsWith('_Posted by the bot. Resolve with `/claude-tweaks:demo`._'));
  assert.ok(markdown.length <= 60000);
});

test('truncation counts the truncated line itself against the cap', () => {
  // Five characters under the cap once the last claim goes: too few for the note,
  // so a second item has to go with it.
  const facts = [fact('change:a', 'passed')];
  const filler = claim('what-changed', 'x'.repeat(100), ['change:a']);
  const claims = Array.from({ length: 10 }, () => filler);
  const size = render(facts, claims).chars;
  const padded = claim('what-changed', 'x'.repeat(100 + 59995 - size), ['change:a']);
  const result = render(facts, [padded, ...claims.slice(1), filler]);
  assert.equal(result.truncated, 2);
  assert.ok(result.chars <= 60000, `chars ${result.chars}`);
  assert.ok(result.markdown.includes('truncated: 2 items omitted'));
});

test('with no item left to drop, chars reports the size over the cap and the loop ends', () => {
  const result = render([], [], { options: { observationPlan: 'p'.repeat(70000) } });
  assert.equal(result.truncated, 0);
  assert.equal(result.chars, result.markdown.length);
  assert.ok(result.chars > 60000);
});

test('a section truncated to nothing keeps a line', () => {
  const huge = 'x'.repeat(70000);
  const result = render([fact('change:a', 'passed')], [claim('what-changed', huge, ['change:a'])]);
  assert.equal(result.truncated, 1);
  assert.deepEqual(sectionLines(result.markdown, 'What changed'), ['all items omitted by truncation']);
  assert.ok(result.chars <= 60000);
});

test('truncating every passed row leaves no Checks that passed label behind', () => {
  const huge = fact(`check:${'c'.repeat(70000)}`, 'passed');
  const empty = render([huge]);
  assert.equal(empty.truncated, 1);
  assert.deepEqual(sectionLines(empty.markdown, 'Test guide'), [
    'not applicable: no tested stories or links were gathered',
  ]);
  const withStep = render([fact('story:s', 'passed', { negative: true }), huge], [
    claim('test-guide', 'Step', ['story:s']),
  ]);
  assert.equal(withStep.truncated, 1);
  assert.deepEqual(sectionLines(withStep.markdown, 'Test guide'), ['1. Step (`story:s`)']);
});

test('truncation takes the longest section whatever its place, numbered items included', () => {
  const rows = Array.from({ length: 3000 }, (_, n) => fact(`check:c${n}`, 'skipped', { reason: 'r' }));
  const late = render(
    [fact('change:a', 'passed'), ...rows],
    [claim('what-changed', 'Short', ['change:a'])],
  );
  assert.ok(late.truncated > 0);
  assert.deepEqual(sectionLines(late.markdown, 'What changed'), ['- Short (`change:a`)']);

  const steps = Array.from({ length: 3000 }, (_, n) => claim('test-guide', `Step ${n} ${'x'.repeat(40)}`, ['story:s']));
  const numbered = render([fact('story:s', 'passed', { negative: true })], steps);
  assert.ok(numbered.truncated > 0);
  assert.ok(numbered.chars <= 60000);
  assert.equal(sectionLines(numbered.markdown, 'Test guide').length + numbered.truncated, 3000);
});

test('removing the passed rows leaves no doubled blank line', () => {
  const huge = fact(`check:${'c'.repeat(70000)}`, 'passed');
  assert.ok(!render([huge]).markdown.includes('\n\n\n'));
});

test('a moved claim renders inline', () => {
  const { markdown } = render(
    [fact('story:s', 'skipped', { reason: 'r' })],
    [claim('test-guide', 'It works\n## x <!-- y', ['story:s'])],
  );
  assert.ok(sectionLines(markdown, "Couldn't test").includes(
    '- It works ## x \\<!-- y (moved: cites `story:s` — skipped: r)',
  ));
});

test('a facts document with no refused list renders', () => {
  const { markdown } = render([], [], { extra: { refused: undefined } });
  assert.ok(!markdown.includes('link(s) refused'));
});

test('a blank line keeps the Checks that passed label out of the numbered list above it', () => {
  const { markdown } = render(
    [fact('story:s', 'passed')],
    [claim('test-guide', 'Step', ['story:s'])],
  );
  const lines = markdown.split('\n');
  const at = lines.indexOf('Checks that passed:');
  assert.equal(lines[at - 1], '');
  assert.equal(lines[at + 1], '- `story:s` — passed');
});

test('AC4 narrative is inert', () => {
  const { markdown } = render(
    [fact('change:a', 'passed')],
    [claim('what-changed', "ok\n## Couldn't test\n[x](https://evil.example)", ['change:a'])],
  );
  const lines = markdown.split('\n');
  assert.equal(lines.filter((line) => line.startsWith("### Couldn't test")).length, 1);
  assert.equal(lines.filter((line) => line.startsWith("## Couldn't test")).length, 0);
  assert.ok(markdown.includes('\\[x\\](`https://evil.example)`'), markdown);
  assertNoBareUrl(markdown);
});

test('a bare URL in a claim is not a link', () => {
  const { markdown } = render(
    [fact('change:a', 'passed'), fact('check:lint', 'failed', { reason: 'see www.evil.example/r and https://evil.example/r' })],
    [claim('what-changed', 'See https://evil.example/x?a=1 now and www.evil.example', ['change:a'])],
  );
  assert.ok(markdown.includes('See `https://evil.example/x?a=1` now and `www.evil.example` (`change:a`)'));
  assert.ok(markdown.includes('see `www.evil.example/r` and `https://evil.example/r`'));
  assertNoBareUrl(markdown);
});

test('inline wraps an uppercase scheme too', () => {
  assert.equal(inline('see HTTPS://EVIL.example'), 'see `HTTPS://EVIL.example`');
});

test('a stray or balanced backtick cannot unwrap a URL out of its code span', () => {
  for (const text of [
    '`https://evil.example',
    '`see https://evil.example`',
    'a ``https://evil.example`` b',
    '\\`https://evil.example',
    '\\\\`https://evil.example`',
  ]) {
    const line = inline(text);
    assert.doesNotMatch(outsideCodeSpans(line), /https?:\/\//, `${text} -> ${line}`);
  }
  assert.equal(inline('`https://evil.example'), '\\``https://evil.example`');
});

test('a backslash in the text cannot cancel an escape', () => {
  assert.equal(inline('\\[x\\](/settings/tokens)'), '\\\\\\[x\\\\\\](/settings/tokens)');
  assert.equal(inline('\\<!-- hidden'), '\\\\\\<!-- hidden');
  assert.equal(inline('C:\\temp'), 'C:\\\\temp');
});

test('a comment opener in a narrative cannot hide later sections', () => {
  const { markdown } = render(
    [fact('change:a', 'passed')],
    [
      claim('what-changed', 'ok <!-- hidden', ['change:a']),
      claim('what-changed', '<img src=x>', ['change:a']),
    ],
  );
  assert.ok(markdown.includes('\\<!-- hidden'));
  assert.equal([...markdown.matchAll(/(^|[^\\])<!--/g)].length, 1);
  assert.ok(markdown.startsWith(PACKET_MARKER));
  assert.ok(headingsPresent(markdown));
  assert.ok(markdown.includes('\\<img src=x>'));
});

test('a multi-line QA error stays one inert row', () => {
  const reason = "Locator not found\n## Couldn't test\n<!-- x";
  const failed = render([fact('story:login', 'failed', { reason })]).markdown;
  assert.deepEqual(rowsIn(failed, 'Tried to break'), [
    "- `story:login` — failed: Locator not found ## Couldn't test \\<!-- x",
  ]);
  assert.equal(failed.split('\n').filter((line) => line.startsWith("### Couldn't test")).length, 1);

  const skipped = render([fact('check:lint', 'skipped', { reason })]).markdown;
  assert.deepEqual(rowsIn(skipped, "Couldn't test"), [
    "- `check:lint` — skipped: Locator not found ## Couldn't test \\<!-- x",
  ]);
  assert.equal(skipped.split('\n').filter((line) => line.startsWith("### Couldn't test")).length, 1);
});

test('decision and deploy text render inline', () => {
  const { markdown } = render([
    fact('decision:a', 'passed', { text: 'a\n## b [x]' }),
    fact('deploy:status', 'passed', { text: 'a\n## b [x]' }),
  ]);
  assert.deepEqual(sectionLines(markdown, 'Decisions left for you'), ['- a ## b \\[x\\]']);
  assert.deepEqual(sectionLines(markdown, 'Deploy status'), ['a ## b \\[x\\]']);
});

test('a command with backticks stays in its span', () => {
  assert.equal(codeSpan('echo `date`\nrm x'), '``echo `date` rm x``');
  assert.equal(codeSpan('`date` x'), '`` `date` x ``');
  assert.equal(codeSpan('x `date`'), '`` x `date` ``');
  assert.equal(codeSpan('a ``` b'), '````a ``` b````');
  assert.equal(codeSpan('plain'), '`plain`');
  const { markdown } = render(
    [fact('story:s', 'passed'), fact('link:cmd', 'passed', { command: 'echo `date`\nrm x' })],
    [claim('test-guide', 'Run it', ['story:s', 'link:cmd'])],
  );
  assert.ok(sectionLines(markdown, 'Test guide')[0].includes('``echo `date` rm x``'));
});

test('an observation-plan line cannot hide later text', () => {
  const { markdown } = render([], [], {
    options: { observationPlan: '# Open\n<!-- x\n```\n~~~\nsee https://evil.example', poster: 'bot' },
  });
  assert.deepEqual(sectionLines(markdown, 'Observation plan').slice(0, 5), [
    '\\# Open',
    '\\<!-- x',
    '\\`\\`\\`',
    '\\~~~',
    'see `https://evil.example`',
  ]);
  assert.ok(markdown.endsWith('_Posted by bot. Resolve with `/claude-tweaks:demo`._'));
});

test('the observation plan comes after every section and is absent when blank', () => {
  const { markdown } = render([], [], { options: { observationPlan: 'Step one\r\nStep two\rStep three' } });
  const lines = markdown.split('\n');
  assert.ok(lines.indexOf('### Observation plan') > lines.indexOf('### Deploy status'));
  assert.deepEqual(sectionLines(markdown, 'Observation plan'), ['Step one', 'Step two', 'Step three']);
  assert.ok(!render([], [], { options: { observationPlan: '  \n ' } }).markdown.includes('### Observation plan'));
  assert.ok(!render([]).markdown.includes('### Observation plan'));
});

test('AC5 infra lists commands, no links', () => {
  const { markdown } = render(
    [
      fact('story:s', 'passed'),
      fact('link:cli', 'passed', { command: 'node plugin/bin/acceptance-packet.js --help' }),
      fact('link:web', 'passed', { url: 'http://localhost:3000/x' }),
    ],
    [claim('test-guide', 'Run the CLI', ['story:s', 'link:cli', 'link:web'])],
    { extra: { surface: 'infra' } },
  );
  assert.ok(markdown.includes('`node plugin/bin/acceptance-packet.js --help`'));
  assert.ok(!markdown.includes('http://localhost:3000/x'));
  const backend = render(
    [fact('link:web', 'passed', { url: 'http://localhost:3000/x' })],
    [claim('test-guide', 'Open it', ['link:web'])],
    { extra: { surface: 'backend' } },
  ).markdown;
  assert.ok(!backend.includes('http://localhost:3000/x'));
});

test('AC5 one-line reason for empty sections', () => {
  const { markdown } = render([fact('deploy:status', 'passed', { text: 'target: local' })]);
  assert.deepEqual(sectionLines(markdown, 'What changed'), ['not applicable: no change facts were gathered']);
  assert.deepEqual(sectionLines(markdown, 'Recording'), ['not recorded']);
  assert.deepEqual(sectionLines(markdown, 'Test guide'), ['not applicable: no tested stories or links were gathered']);
  assert.deepEqual(sectionLines(markdown, "Couldn't test"), ['not applicable: every expected check ran']);
  assert.deepEqual(sectionLines(markdown, 'Tried to break'), ['not applicable: no negative stories or failures ran']);
  assert.deepEqual(sectionLines(markdown, 'Least confident'), ['not applicable: no low-confidence review findings']);
  assert.deepEqual(sectionLines(markdown, 'Risk proofs'), ['not applicable: no kept risk flags']);
  assert.deepEqual(sectionLines(markdown, 'Deploy status'), ['target: local']);
  const content = markdown.split('\n').filter((line) => line !== '');
  content.forEach((line, index) => {
    if (line.startsWith('### ')) assert.ok(index + 1 < content.length && !content[index + 1].startsWith('#'), line);
  });
});

test('Deploy status reads target: local with no deploy fact', () => {
  assert.deepEqual(sectionLines(render([]).markdown, 'Deploy status'), ['target: local']);
});

test('a deploy fact with no text states its own target', () => {
  const { markdown } = render([fact('deploy:status', 'passed', { target: 'dev', live: true })]);
  assert.deepEqual(sectionLines(markdown, 'Deploy status'), ['target: dev']);
});

test('a decision or recording with blank text falls back to its id', () => {
  const { markdown } = render([
    fact('decision:a', 'passed', { text: '  ' }),
    fact('recording:b', 'passed', { url: 'https://cdn.example/b.gif' }),
  ]);
  assert.deepEqual(sectionLines(markdown, 'Decisions left for you'), ['- `decision:a`']);
  assert.deepEqual(sectionLines(markdown, 'Recording'), ['- `recording:b`: <https://cdn.example/b.gif>']);
});

test('kept claims cite their ids in the three narrated sections', () => {
  const { markdown } = render(
    [
      fact('change:a', 'passed'),
      fact('change:b', 'passed'),
      fact('finding:1', 'passed'),
      fact('flag:auth', 'passed'),
      fact('check:unit', 'passed'),
    ],
    [
      claim('what-changed', 'Changed things', ['change:a', 'change:b']),
      claim('least-confident', 'Unsure', ['finding:1']),
      claim('risk-proofs', 'Auth covered', ['flag:auth', 'check:unit']),
    ],
  );
  assert.deepEqual(sectionLines(markdown, 'What changed'), ['- Changed things (`change:a`, `change:b`)']);
  assert.deepEqual(sectionLines(markdown, 'Least confident'), ['- Unsure (`finding:1`)']);
  assert.deepEqual(sectionLines(markdown, 'Risk proofs'), ['- Auth covered (`flag:auth`, `check:unit`)']);
});

test('Q9 plain step stays under Test guide', () => {
  const facts = [
    fact('story:signup', 'not-run', { reason: 'no result recorded' }),
    fact('link:signup', 'passed', { url: 'http://localhost:3000/signup' }),
  ];
  const plain = render(facts, [claim('test-guide', 'Open the signup page', ['story:signup', 'link:signup'])]).markdown;
  assert.equal(
    sectionLines(plain, 'Test guide')[0],
    '1. Open the signup page (`story:signup`, `link:signup`): <http://localhost:3000/signup>',
  );
  assert.deepEqual(rowsIn(plain, "Couldn't test"), ['- `story:signup` — not run: no result recorded']);

  const asserted = render(facts, [claim('test-guide', 'Signup verified', ['story:signup', 'link:signup'])]).markdown;
  assert.ok(sectionLines(asserted, "Couldn't test").includes(
    '- Signup verified (moved: cites `story:signup` — not run: no result recorded)',
  ));
  assert.deepEqual(sectionLines(asserted, 'Test guide'), ['not applicable: no tested stories or links were gathered']);
});

test('test-guide claims are numbered in order', () => {
  const { markdown } = render(
    [fact('story:a', 'passed'), fact('story:b', 'passed', { negative: true })],
    [claim('test-guide', 'First', ['story:a']), claim('test-guide', 'Second', ['story:b'])],
  );
  const guide = sectionLines(markdown, 'Test guide');
  assert.equal(guide[0], '1. First (`story:a`)');
  assert.equal(guide[1], '2. Second (`story:b`)');
});

test('Q12 tried-to-break claim on skipped negatives renders under Couldn\'t test', () => {
  const { markdown } = render(
    [fact('story:login#negative-2', 'skipped', { negative: true, reason: 'no dev server' })],
    [claim('tried-to-break', 'Submitted an expired session', ['story:login#negative-2'])],
  );
  assert.ok(sectionLines(markdown, "Couldn't test").includes(
    '- Submitted an expired session (moved: cites `story:login#negative-2` — skipped: no dev server)',
  ));
  assert.ok(!sectionLines(markdown, 'Tried to break').join('\n').includes('Submitted an expired session'));
});

test('tried-to-break holds kept claims, then moved claims, then rows', () => {
  const { markdown } = render(
    [
      fact('story:neg', 'passed', { negative: true }),
      fact('story:bad', 'failed', { reason: 'boom' }),
    ],
    [
      claim('test-guide', 'It works', ['story:bad']),
      claim('tried-to-break', 'Broke it', ['story:neg']),
    ],
  );
  assert.deepEqual(sectionLines(markdown, 'Tried to break'), [
    '- Broke it (`story:neg`)',
    '- It works (moved: cites `story:bad` — failed: boom)',
    '- `story:neg` — passed',
    '- `story:bad` — failed: boom',
  ]);
});

test('unverified link suffix', () => {
  const link = fact('link:x', 'passed', { url: 'http://localhost:3000/x' });
  const step = [claim('test-guide', 'Open', ['link:x'])];
  const suffix = '(link unverified: deploy not confirmed live)';
  const withDeploy = (deploy) => render([link, fact('deploy:status', 'passed', deploy)], step).markdown;

  assert.ok(withDeploy({ target: 'dev', live: false }).includes(`<http://localhost:3000/x> ${suffix}`));
  assert.ok(withDeploy({ target: 'dev', live: null }).includes(suffix));
  assert.ok(!withDeploy({ target: 'dev', live: true }).includes(suffix));
  const local = withDeploy({ target: 'local', live: null, text: 'target: local' });
  assert.ok(!local.includes(suffix));
  assert.deepEqual(sectionLines(local, 'Deploy status'), ['target: local']);
  assert.ok(!render([link], step).markdown.includes(suffix));
});

test('note lines in fixed order', () => {
  const many = Array.from({ length: 3000 }, () => claim('what-changed', 'x'.repeat(40), ['change:a']));
  const { markdown, truncated, screened } = render([fact('change:a', 'passed')], [
    ...many,
    claim('what-changed', 'gone', ['change:absent']),
    claim('test-guide', 'Log in with password=hunter2', []),
  ]);
  assert.equal(screened.length, 1);
  const lines = markdown.split('\n');
  const at = lines.indexOf('1 claim was dropped for missing evidence');
  assert.notEqual(at, -1);
  assert.equal(lines[at + 1], '1 Test guide entry omitted for credential-shaped content: password');
  assert.equal(lines[at + 2], `truncated: ${truncated} items omitted`);
});

test('first line is the marker', () => {
  const lines = render([]).markdown.split('\n');
  assert.equal(lines[0], PACKET_MARKER);
  assert.equal(lines[1], '');
  assert.equal(lines[2], '## Acceptance packet — #4611');
});

test('Decisions left for you omitted when empty', () => {
  assert.ok(!render([]).markdown.includes('Decisions left for you'));
  const { markdown } = render([fact('decision:a', 'passed', { text: 'Pick one' })]);
  assert.deepEqual(sectionLines(markdown, 'Decisions left for you'), ['- Pick one']);
});

test('sections render in the contract order', () => {
  const { markdown } = render([fact('decision:a', 'passed', { text: 'Pick one' })]);
  const headings = markdown.split('\n').filter((line) => line.startsWith('### '));
  assert.deepEqual(headings, SECTIONS.map(({ heading }) => `### ${heading}`));
});

test('screened entries render as an omission line, never their text', () => {
  const result = render(
    [],
    [claim('test-guide', 'Log in with password=hunter2', [])],
    { extra: { refused: [{ id: 'link:deploy', reason: 'credential key in command: token' }] } },
  );
  const { markdown, screened } = result;
  assert.ok(markdown.includes('1 Test guide entry omitted for credential-shaped content: password'));
  assert.ok(markdown.includes('- 1 link(s) refused: link:deploy (credential key in command: token)'));
  assert.ok(!markdown.includes('hunter2'));
  assert.ok(headingsPresent(markdown));
  assert.equal(screened[0].key, 'password');

  const two = render([], [
    claim('test-guide', 'a password=1', []),
    claim('test-guide', 'b token=2', []),
  ]).markdown;
  assert.ok(two.includes('2 Test guide entries omitted for credential-shaped content: password; token'));
  assert.ok(!render([]).markdown.includes('omitted for credential-shaped content'));
});

test('several refused links share one inert line', () => {
  const { markdown } = render([], [], {
    extra: {
      refused: [
        { id: 'link:a', reason: 'host not allowed: evil.example' },
        { id: 'link:b\n<c', reason: 'bad\n## x <!-- y' },
      ],
    },
  });
  assert.ok(sectionLines(markdown, 'Test guide').includes(
    '- 2 link(s) refused: link:a (host not allowed: evil.example); link:b \\<c (bad ## x \\<!-- y)',
  ));
});

test('a link fact holding a command renders the command, not its url', () => {
  const { markdown } = render(
    [fact('link:both', 'passed', { command: 'npm start', url: 'http://localhost:3000/x' })],
    [claim('test-guide', 'Run', ['link:both'])],
  );
  assert.equal(sectionLines(markdown, 'Test guide')[0], '1. Run (`link:both`): `npm start`');
});

test('every cited link renders, each with its own suffix, and a story citation renders none', () => {
  const { markdown } = render(
    [
      fact('story:s', 'passed'),
      fact('link:a', 'passed', { url: 'http://localhost:3000/a' }),
      fact('link:b', 'passed', { url: 'http://localhost:3000/b' }),
      fact('deploy:status', 'passed', { target: 'dev', live: false, text: 'target: dev' }),
    ],
    [claim('test-guide', 'Open', ['story:s', 'link:a', 'link:b'])],
  );
  const suffix = '(link unverified: deploy not confirmed live)';
  assert.equal(
    sectionLines(markdown, 'Test guide')[0],
    `1. Open (\`story:s\`, \`link:a\`, \`link:b\`): <http://localhost:3000/a> ${suffix}; <http://localhost:3000/b> ${suffix}`,
  );
});

test('a link that fails the recheck renders its refusal, not its url', () => {
  const { markdown } = render(
    [fact('link:evil', 'passed', { url: 'https://evil.example/x' })],
    [claim('test-guide', 'Open', ['link:evil'])],
  );
  assert.equal(
    sectionLines(markdown, 'Test guide')[0],
    '1. Open (`link:evil`): (link refused: host not allowed: evil.example)',
  );
  assert.ok(!markdown.includes('https://evil.example'));
});

test('a command carrying a credential is refused at render too, never shown', () => {
  const { markdown } = render(
    [fact('link:cmd', 'passed', { command: 'curl --token hunter2 http://localhost' })],
    [claim('test-guide', 'Run', ['link:cmd'])],
  );
  assert.ok(markdown.includes('(link refused: credential key in command: token)'));
  assert.ok(!markdown.includes('hunter2'));
});

test('a link that needs no render still cites its id', () => {
  const { markdown } = render(
    [fact('link:web', 'passed', { url: 'http://localhost:3000/x' })],
    [claim('test-guide', 'Open', ['link:web'])],
    { extra: { surface: 'infra' } },
  );
  assert.equal(sectionLines(markdown, 'Test guide')[0], '1. Open (`link:web`)');
});

test('a link url that checkLink accepts stays one inert, well-formed link', () => {
  const urls = new Map([
    ['http://localhost:3000/a)[click](https://evil.example', '<http://localhost:3000/a)[click](https://evil.example>'],
    ['http://localhost:3000/a\n[click](https://evil.example)', '<http://localhost:3000/a[click](https://evil.example)>'],
    ['http://localhost:3000/a b', '<http://localhost:3000/a%20b>'],
    ['http://localhost:3000/a<b>c?d<e>#f<g>', '<http://localhost:3000/a%3Cb%3Ec?d%3Ce%3E#f%3Cg%3E>'],
    ['http://localhost:3000/a`b', '<http://localhost:3000/a%60b>'],
    ['http://localhost:3000/a\n## Heading', '<http://localhost:3000/a##%20Heading>'],
  ]);
  for (const [url, rendered] of urls) {
    const { markdown } = render(
      [fact('link:x', 'passed', { url })],
      [claim('test-guide', 'Open', ['link:x'])],
    );
    const lines = sectionLines(markdown, 'Test guide');
    assert.equal(lines[0], `1. Open (\`link:x\`): ${rendered}`);
    assert.doesNotMatch(rendered.slice(1, -1), /[\s<>]/);
    assert.equal(markdown.split('\n').filter((line) => line.startsWith('## ')).length, 1);
  }
});

test('an allowed IPv6 host renders as a link', () => {
  const { markdown } = render(
    [fact('link:x', 'passed', { url: 'http://[::1]:3000/x' })],
    [claim('test-guide', 'Open', ['link:x'])],
    { extra: { allowedHosts: ['http://[::1]:3000'] } },
  );
  assert.ok(markdown.includes('<http://[::1]:3000/x>'));
});

test('recording rows render an http(s) url inert and refuse the rest', () => {
  const { markdown } = render([
    fact('recording:a', 'passed', { text: 'Walkthrough [x]', url: 'https://cdn.example/a.gif' }),
    fact('recording:b', 'passed', { text: 'Bad', url: 'javascript:alert(1)' }),
    fact('recording:c', 'passed', { text: 'Junk', url: 'not a url' }),
    fact('recording:d', 'passed', { text: 'Shaped', url: 'https://cdn.example/a)[click](https://evil.example' }),
    fact('recording:e', 'passed', { text: 'None' }),
  ]);
  assert.deepEqual(sectionLines(markdown, 'Recording'), [
    '- Walkthrough \\[x\\]: <https://cdn.example/a.gif>',
    '- Bad: (recording url refused)',
    '- Junk: (recording url refused)',
    '- Shaped: <https://cdn.example/a)[click](https://evil.example>',
    '- None: (recording url refused)',
  ]);
});

test('partial notes render inline on one quoted line, set off from the dropped line', () => {
  const { markdown } = render([], [], { extra: { partial: ['verify report not found', 'bad\n<!-- x'] } });
  const lines = markdown.split('\n');
  const at = lines.indexOf('> partial gather: verify report not found; bad \\<!-- x');
  assert.notEqual(at, -1);
  assert.equal(lines[at + 1], '');
  assert.equal(lines[at + 2], '0 claims were dropped for missing evidence');
  assert.ok(!render([]).markdown.includes('partial gather'));
});

test('the poster closes the packet, inline', () => {
  const { markdown } = render([], [], { options: { poster: 'a\n<b>' } });
  const lines = markdown.split('\n');
  assert.equal(lines.at(-2), '---');
  assert.equal(lines.at(-1), '_Posted by a \\<b>. Resolve with `/claude-tweaks:demo`._');
  assert.equal(lines.at(-3), '');
  assert.ok(!render([]).markdown.includes('Posted by'));
  assert.ok(!render([], [], { options: { poster: '  ' } }).markdown.includes('Posted by'));
});

test('a plan line of only = or - cannot underline the line above into a heading', () => {
  const { markdown } = render([], [], { options: { observationPlan: "Couldn't test\n---\nReal\n===\n-\n=" } });
  assert.deepEqual(sectionLines(markdown, 'Observation plan'), [
    "Couldn't test",
    '\\---',
    'Real',
    '\\===',
    '\\-',
    '\\=',
  ]);
});

test('an underline escape is whole-line only, on every path through inline', () => {
  assert.equal(inline('- item'), '\\- item', 'a list marker is escaped for its own reason, not as an underline');
  assert.equal(inline('--- x'), '--- x');
  assert.equal(inline('a ---'), 'a ---');
  assert.equal(inline('=-='), '=-=');
  assert.equal(inline('  ---  '), '\\---');
  const { markdown } = render([
    fact('deploy:status', 'passed', { text: '===' }),
    fact('decision:a', 'passed', { text: '---' }),
  ]);
  assert.deepEqual(sectionLines(markdown, 'Deploy status'), ['\\===']);
  assert.deepEqual(sectionLines(markdown, 'Decisions left for you'), ['- \\---']);
});

test('a recording url carrying a credential is refused, never shown', () => {
  const urls = [
    'https://u:p@cdn.example/a.gif?X-Amz-Signature=abc&token=def',
    'https://u@cdn.example/a.gif',
    'https://cdn.example/a.gif?X-Amz-Signature=abc',
    'https://cdn.example/a.gif?token=def',
    'https://cdn.example/a.gif#sig=abc',
  ];
  for (const url of urls) {
    const { markdown } = render([fact('recording:a', 'passed', { text: 'Rec', url })]);
    assert.deepEqual(sectionLines(markdown, 'Recording'), ['- Rec: (recording url refused)'], url);
    assert.ok(!markdown.includes('cdn.example'), url);
  }
});

test('a recording url needs no allowed host', () => {
  const { markdown } = render(
    [
      fact('recording:a', 'passed', { text: 'A', url: 'https://cdn.example/a.gif?t=1#start' }),
      fact('recording:b', 'passed', { text: 'B', url: 'http://[::1]:3000/b.webm' }),
    ],
    [],
    { extra: { allowedHosts: [] } },
  );
  assert.deepEqual(sectionLines(markdown, 'Recording'), [
    '- A: <https://cdn.example/a.gif?t=1#start>',
    '- B: <http://[::1]:3000/b.webm>',
  ]);
});

const manyClaims = () => Array.from({ length: 3000 }, () => claim('what-changed', 'x'.repeat(40), ['change:a']));

test('deploy text shaped like a list item is never dropped', () => {
  const text = `- target: ${'d'.repeat(70000)}`;
  const { markdown, truncated, chars } = render([fact('deploy:status', 'passed', { text })]);
  assert.equal(truncated, 0);
  assert.deepEqual(sectionLines(markdown, 'Deploy status'), [`\\${text}`]);
  assert.ok(chars > 60000);
});

test('the refused-links line is a note: a long reason never removes it', () => {
  const reason = 'r'.repeat(70000);
  const { markdown, truncated, chars } = render(
    [fact('change:a', 'passed')],
    [claim('what-changed', 'One', ['change:a'])],
    { extra: { refused: [{ id: 'link:a', reason }] } },
  );
  assert.equal(truncated, 1);
  assert.ok(sectionLines(markdown, 'Test guide').includes(`- 1 link(s) refused: link:a (${reason})`));
  assert.ok(chars > 60000);
});

test('plan lines shaped like list items are never dropped', () => {
  const { markdown, truncated } = render([fact('change:a', 'passed')], manyClaims(), {
    options: { observationPlan: '- first\n1. second\nthird' },
  });
  assert.ok(truncated > 0);
  assert.deepEqual(sectionLines(markdown, 'Observation plan'), ['- first', '1. second', 'third']);
});

test('decision rows are items truncation may drop', () => {
  const decisions = Array.from({ length: 3000 }, (_, n) => fact(`decision:d${n}`, 'passed', { text: 'x'.repeat(40) }));
  const { truncated, chars } = render(decisions);
  assert.ok(truncated > 0);
  assert.ok(chars <= 60000);
});

test('a plan longer than the cap loses no line, and the items still go first', () => {
  const plan = Array.from({ length: 3000 }, (_, n) => `- step ${n} ${'p'.repeat(40)}`).join('\n');
  const { markdown, truncated } = render(
    [fact('change:a', 'passed')],
    [claim('what-changed', 'One', ['change:a'])],
    { options: { observationPlan: plan } },
  );
  assert.equal(truncated, 1);
  assert.equal(sectionLines(markdown, 'Observation plan').length, 3000);
});

test('line collapsing matches the original rule on every whitespace shape', () => {
  const original = (s) => s.replace(/\s*[\r\n]+\s*/g, ' ');
  for (const s of ['a \n b', '\n a', 'a\n', 'a\n \nb', ' \n \n ', '\r\n\r\n', 'a\r\tb', 'a\t b', 'a\u00a0\nb', '  a  ', 'a  b', '']) {
    assert.equal(codeSpan(s), `\`${original(s)}\``, JSON.stringify(s));
    assert.equal(inline(s), original(s).trim(), JSON.stringify(s));
  }
});

test('every other autolink shape renders as a code span', () => {
  const cases = new Map([
    ['see ftp://x.y now', 'see `ftp://x.y` now'],
    ['see FTP://X.Y now', 'see `FTP://X.Y` now'],
    ['ssh://git@host/a', '`ssh://git@host/a`'],
    ['mail mailto:a@b.co now', 'mail `mailto:a@b.co` now'],
    ['xmpp:a@b.co', '`xmpp:a@b.co`'],
    ['tel:+4512345678', '`tel:+4512345678`'],
    ['write to a.b+c@d.example.co.', 'write to `a.b+c@d.example.co`.'],
    ['ping @octocat now', 'ping `@octocat` now'],
    ['(@octocat)', '(`@octocat`)'],
    ['@org/team', '`@org/team`'],
    ['fixes #12 today', 'fixes `#12` today'],
    ['(#12)', '(`#12`)'],
    ['#12', '`#12`'],
    ['see owner/repo#12.', 'see `owner/repo#12`.'],
    ['see octocat#12', 'see `octocat#12`'],
    ['(.owner/repo#12)', '(.`owner/repo#12`)'],
  ]);
  for (const [input, expected] of cases) assert.equal(inline(input), expected);
});

test('ordinary prose near an autolink shape stays untouched', () => {
  for (const prose of [
    'C#',
    'C# is fine',
    'a@',
    'a @ b',
    'foo@bar',
    'issue 12',
    'a#b',
    'see #12abc',
    'x#12y',
    'note#',
    'target: dev',
    'link:deploy',
    'localhost:3000',
    'key:value',
    '12:30',
    'a/b/c',
    'src/lib/a#12',
    '://x',
  ]) {
    assert.equal(inline(prose), prose);
  }
  assert.equal(inline('# 12'), '\\# 12');
  assert.equal(inline('C:\\temp'), 'C:\\\\temp');
});

test('a token right after a token stays out of live text', () => {
  assert.equal(inline('#12@octocat'), '`#12@octocat`');
  assert.equal(inline('@a/b@1.2.3'), '`@a/b@1`.2.3');
  assert.equal(inline('see a@b.co@octocat now'), 'see `a@b.co@octocat` now');
  assert.equal(inline('#12 @octocat'), '`#12` `@octocat`');
});

test('an underscore on either side of a token leaves it no live text', () => {
  assert.equal(inline('_@octocat_'), '_`@octocat`_');
  assert.equal(inline('_#12_'), '_`#12`_');
  assert.equal(inline('_owner/repo#12_'), '_`owner/repo#12`_');
});

test('a scheme with no slashes needs a boundary on its left', () => {
  assert.equal(inline('hotel:5'), 'hotel:5');
  assert.equal(inline('Xmailto:a@b.co'), 'Xmailto:`a@b.co`');
  assert.equal(inline('a tel:5 b'), 'a `tel:5` b');
  assert.equal(inline('(sms:5)'), '(`sms:5)`');
});

test('a character reference stays inert, its digits left alone', () => {
  assert.equal(inline('it&#39;s'), 'it\\&#39;s');
  assert.equal(inline('&#35;12'), '\\&#35;12', 'would render as a live #12');
  assert.equal(inline('&#x40;octocat'), '\\&#x40;octocat', 'would render as a live mention');
  assert.equal(inline('&commat;octocat'), '\\&commat;octocat', 'would render as a live mention');
  assert.equal(inline('AT&T & co'), 'AT&T & co');
  assert.equal(inline('&#12 today'), '&`#12` today', 'no semicolon, so not an entity: a live reference');
  assert.equal(inline('&#12345678;'), '&`#12345678`;', 'too long to be an entity');
});

// Every leading container marker CommonMark would open, one layer at a time, unescaped.
const CONTAINER_RE = /^ {0,3}(?:>[ \t]?|[-+*][ \t]+|\d{1,9}[.)][ \t]+)/;
// What a line's block content opens with once its containers are taken off: a forged
// heading nests inside a list item or a blockquote and still renders as a heading.
function blockContent(line) {
  let rest = line;
  for (let match = CONTAINER_RE.exec(rest); match; match = CONTAINER_RE.exec(rest)) rest = rest.slice(match[0].length);
  return rest;
}
const FORGED_HEADING_RE = /^ {0,3}#{1,6}(?:\s|$)/;
const FORGERIES = ['- ## Couldn\'t test', '+ # x', '* # x', '> ## Forged', '>## Forged', '1. ## Forged two', '1) # x', '- - ## x', '> > ## x', '1. - > ## x'];

test('a forged section heading renders no heading in any free text', () => {
  for (const text of FORGERIES) {
    const { markdown } = render(
      [
        fact('change:a', 'passed'),
        fact('story:s', 'passed'),
        fact('check:c', 'failed', { reason: text }),
        fact('decision:d', 'passed', { text }),
        fact('recording:r', 'passed', { text, url: 'https://cdn.example/r.gif' }),
        fact('deploy:status', 'passed', { text }),
      ],
      [claim('what-changed', text, ['change:a']), claim('test-guide', text, ['story:s'])],
    );
    const forged = markdown.split('\n').filter((line) => !line.startsWith('### ') && !line.startsWith('## '))
      .filter((line) => FORGED_HEADING_RE.test(blockContent(line)));
    assert.deepEqual(forged, [], text);
    assert.equal(markdown.split('\n').filter((line) => line === "### Couldn't test").length, 1, text);
  }
});

test('inline escapes one leading block marker and leaves the look-alikes', () => {
  const cases = new Map([
    ['- x', '\\- x'],
    ['+ x', '\\+ x'],
    ['* x', '\\* x'],
    ['> x', '\\> x'],
    ['>x', '\\>x'],
    ['1. x', '1\\. x'],
    ['12) x', '12\\) x'],
    ['1.', '1\\.'],
    ['+', '\\+'],
    ['-', '\\-'],
    ['1.5 seconds', '1.5 seconds'],
    ['**bold** x', '**bold** x'],
    ['-x', '-x'],
    ['+1', '+1'],
    ['1234567890. x', '1234567890. x'],
    ['a > b', 'a > b'],
  ]);
  for (const [input, expected] of cases) assert.equal(inline(input), expected, input);
});

test('codeSpan handles more backtick runs than a call can take arguments', () => {
  const text = '`a'.repeat(300000);
  const span = codeSpan(text);
  assert.ok(span.startsWith('`` `a'), span.slice(0, 8));
  assert.ok(span.endsWith('a ``') || span.endsWith('a``'), span.slice(-8));
});

const PLAN = [
  '### Observation plan',
  '- Surface: app-route',
  '- Entry point: http://localhost:3000/settings',
  '- Prepare:',
  '  - `npm run seed -- --flag [x]`',
  '- Inspect:',
  '  - open [settings](/settings) and check #12',
  '    Regenerate: `node x.js`',
  '- Full verification:',
  '  - Parent: #898 the parent',
  '',
].join('\n');

test('a plan in observation-plan grammar round-trips to /demo', () => {
  const { markdown } = render([], [], { options: { observationPlan: PLAN } });
  const lines = markdown.split('\n');
  assert.equal(lines.filter((line) => /^#+ Observation plan$/.test(line)).length, 1, 'the heading is not doubled');
  const at = lines.indexOf('### Observation plan');
  assert.deepEqual(lines.slice(at + 1), [
    '- Surface: app-route',
    '- Entry point: `http://localhost:3000/settings`',
    '- Prepare:',
    '  - `npm run seed -- --flag [x]`',
    '- Inspect:',
    '  - open \\[settings\\](/settings) and check `#12`',
    '    Regenerate: `node x.js`',
    '- Full verification:',
    '  - Parent: `#898` the parent',
  ]);
  assert.ok(!markdown.includes('\\`'), 'a whole span keeps its backticks');
});

test('a plan heading counts only on the first line, any level, and a plan of only one is no section', () => {
  const later = render([], [], { options: { observationPlan: 'Step\n### Observation plan' } }).markdown;
  assert.deepEqual(sectionLines(later, 'Observation plan'), ['Step', '\\### Observation plan'], 'a later one is escaped text');
  const level = render([], [], { options: { observationPlan: '\n## observation PLAN\n\n- a' } }).markdown;
  assert.deepEqual(sectionLines(level, 'Observation plan'), ['- a']);
  assert.ok(!render([], [], { options: { observationPlan: '### Observation plan\n\n' } }).markdown.includes('### Observation plan'));
});

test('plan indentation is capped so no line becomes an indented code block', () => {
  const plan = ['        top', '- item', '          deep', '  - nested', '            deeper', 'back', '        again'].join('\n');
  const { markdown } = render([], [], { options: { observationPlan: plan } });
  assert.deepEqual(sectionLines(markdown, 'Observation plan'), [
    '   top',
    '- item',
    '     deep',
    '  - nested',
    '       deeper',
    'back',
    '   again',
  ]);
  const tabs = render([], [], { options: { observationPlan: '- a\n\t- b' } }).markdown;
  assert.deepEqual(sectionLines(tabs, 'Observation plan'), ['- a', '    - b']);
});

test('plan lines keep their marker and forge nothing after it', () => {
  const plan = ['- ## Couldn\'t test', '> ## Forged', '1. ## Forged two', '- - ## x', '- > ## y', '-    wide', '+ plus', '2) two', '# top', '`a` # b'].join('\n');
  const { markdown } = render([], [], { options: { observationPlan: plan } });
  assert.deepEqual(sectionLines(markdown, 'Observation plan'), [
    "- \\## Couldn't test",
    '\\> ## Forged',
    '1. \\## Forged two',
    '- \\- ## x',
    '- \\> ## y',
    '- wide',
    '+ plus',
    '2) two',
    '\\# top',
    '`a` # b',
  ]);
  for (const line of sectionLines(markdown, 'Observation plan')) assert.doesNotMatch(blockContent(line), FORGED_HEADING_RE, line);
});

test('a backtick span in a plan line holds only a whole span', () => {
  for (const [input, expected] of [
    ['run `a [b]` now', 'run `a [b]` now'],
    ['`https://evil.example`', '`https://evil.example`'],
    ['a `b', 'a \\`b'],
    ['``a``', '\\`\\`a\\`\\`'],
    ['`a` and `b`', '`a` and `b`'],
    ['`a`@octocat', '`a``@octocat`'],
  ]) {
    assert.deepEqual(sectionLines(render([], [], { options: { observationPlan: input } }).markdown, 'Observation plan'), [expected], input);
  }
});

test('a recording on another scheme is refused at render', () => {
  const { markdown } = render([fact('recording:a', 'passed', { text: 'Ftp', url: 'ftp://cdn.example/a.gif' })]);
  assert.deepEqual(sectionLines(markdown, 'Recording'), ['- Ftp: (recording url refused)']);
  assert.ok(!markdown.includes('cdn.example'));
});

test('autolink shapes in a claim and a fact reason stay out of live text', () => {
  const { markdown } = render(
    [fact('change:a', 'passed'), fact('check:lint', 'failed', { reason: 'see @octocat and #12' })],
    [claim('what-changed', 'mail a@b.co, ftp://x.y', ['change:a'])],
  );
  assert.ok(markdown.includes('- mail `a@b.co`, `ftp://x.y` (`change:a`)'));
  assert.ok(markdown.includes('- `check:lint` — failed: see `@octocat` and `#12`'));
});

test('invalid input throws SchemaError', () => {
  assert.throws(() => renderPacket({ schemaVersion: 2 }, { schemaVersion: 1, claims: [] }), SchemaError);
  for (const refused of [null, 'link:a', [null], [{ id: 'link:a' }]]) {
    assert.throws(() => render([], [], { extra: { refused } }), SchemaError, JSON.stringify(refused));
  }
});

test('the return reports every field', () => {
  const result = render([]);
  assert.deepEqual(Object.keys(result).sort(), ['chars', 'dropped', 'markdown', 'screened', 'truncated']);
  assert.equal(result.truncated, 0);
  assert.ok(!result.markdown.includes('truncated:'));
});
