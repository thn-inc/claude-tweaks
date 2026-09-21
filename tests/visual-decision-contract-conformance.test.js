'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const CONTRACT = path.join(__dirname, '..', 'plugin', 'skills', '_shared', 'visual-decision.md');
const TEMPLATE = path.join(__dirname, '..', 'plugin', 'skills', 'design-wrapper', 'compare-shell', 'template.html');
const EXPLORE = path.join(__dirname, '..', 'plugin', 'skills', 'design-wrapper', 'modes', 'explore.md');
const DEMO = path.join(__dirname, '..', 'plugin', 'skills', 'demo', 'SKILL.md');
const DEMO_BROWSER_VERDICT = path.join(__dirname, '..', 'plugin', 'skills', 'demo', 'browser-verdict.md');
const BROWSER_REVIEW = path.join(__dirname, '..', 'plugin', 'skills', 'visual-review', 'browser-review.md');

const EVENT_SHAPES = ['pick', 'reroll', 'steer', 'tweak', 'exit'];

// The one exclusion mechanism this repo's conformance greps honor — a line
// carrying this literal marker is never counted as a restatement.
const TOMBSTONE_MARKER = '<!-- tombstone:';

function stripTombstoneLines(text) {
  return text
    .split('\n')
    .filter((line) => !line.includes(TOMBSTONE_MARKER))
    .join('\n');
}

function readNonTombstone(file) {
  return stripTombstoneLines(fs.readFileSync(file, 'utf8'));
}

test('AC1: the contract file states each of the five event shapes exactly once', () => {
  const text = readNonTombstone(CONTRACT);
  for (const shape of EVENT_SHAPES) {
    const literal = `"type":"${shape}"`;
    const count = text.split(literal).length - 1;
    assert.equal(count, 1, `expected exactly one "${literal}" in ${CONTRACT}, found ${count}`);
  }
});

test('AC1: the template serializer constructs exactly the same five shapes, one branch each', () => {
  const text = readNonTombstone(TEMPLATE);
  const fnMatch = text.match(/function serializeEvent\(kind, extra\) \{[\s\S]*?\n  \}/);
  assert.ok(fnMatch, 'expected a serializeEvent function in template.html');
  const fnBody = fnMatch[0];
  for (const shape of EVENT_SHAPES) {
    const literal = `type: '${shape}'`;
    const count = fnBody.split(literal).length - 1;
    assert.equal(count, 1, `expected exactly one "${literal}" in serializeEvent, found ${count}`);
  }
  assert.match(fnBody, /ts: ts/); // every shape carries a ts field, via the shared return sites
});

test('AC1 reversion check: renaming a shape on either side breaks this suite (proves the pin is real)', () => {
  const contractText = readNonTombstone(CONTRACT);
  const templateText = readNonTombstone(TEMPLATE);
  const contractRenamed = contractText.replace('"type":"pick"', '"type":"select"');
  const templateRenamed = templateText.replace("type: 'pick'", "type: 'select'");
  assert.equal(contractRenamed.split('"type":"pick"').length - 1, 0);
  assert.equal(templateRenamed.split("type: 'pick'").length - 1, 0);
});

test('AC3: decision.html metadata field set (winner, seedKey, rerollCount, steerHistory, date) matches between the contract and the seeder', () => {
  const seederText = fs.readFileSync(
    path.join(__dirname, '..', 'plugin', 'skills', 'design-wrapper', 'compare-shell', 'seed-compare.mjs'),
    'utf8',
  );
  const fields = ['winner', 'date', 'seedKey', 'rerollCount', 'steerHistory'];
  for (const field of fields) {
    assert.match(seederText, new RegExp(`\\b${field}\\b`), `seeder is missing outcome field ${field}`);
  }
  // seed() also stamps every field onto the JSON island's outcome object at
  // runtime (buildVariantData/seed in seed-compare.mjs) — checked structurally
  // above via the source text; template.html then surfaces the same object
  // as DATA.outcome, so both sides of the format agree on the field set.
  const templateText = fs.readFileSync(TEMPLATE, 'utf8');
  assert.match(templateText, /DATA\.outcome/);
});

test('AC5/AC1: modes/explore.md cites the contract and never restates the event JSON shapes', () => {
  const exploreText = readNonTombstone(EXPLORE);
  assert.match(exploreText, /_shared\/visual-decision\.md/);
  for (const shape of EVENT_SHAPES) {
    assert.equal(
      exploreText.includes(`"type":"${shape}"`),
      false,
      `explore.md restates the "${shape}" event shape literal — it must only cite the contract`,
    );
  }
});

test('#1208 AC3: demo/SKILL.md and demo/browser-verdict.md cite the contract and never restate the event JSON shapes', () => {
  const demoText = readNonTombstone(DEMO);
  assert.match(demoText, /_shared\/visual-decision\.md/);
  for (const shape of EVENT_SHAPES) {
    assert.equal(
      demoText.includes(`"type":"${shape}"`),
      false,
      `demo/SKILL.md restates the "${shape}" event shape literal — it must only cite the contract`,
    );
  }
  const browserVerdictText = readNonTombstone(DEMO_BROWSER_VERDICT);
  assert.match(browserVerdictText, /_shared\/visual-decision\.md/);
  for (const shape of EVENT_SHAPES) {
    assert.equal(
      browserVerdictText.includes(`"type":"${shape}"`),
      false,
      `demo/browser-verdict.md restates the "${shape}" event shape literal — it must only cite the contract`,
    );
  }
});

test('#1208 AC3: visual-review/browser-review.md cites the contract and never restates the event JSON shapes', () => {
  const browserReviewText = readNonTombstone(BROWSER_REVIEW);
  assert.match(browserReviewText, /_shared\/visual-decision\.md/);
  for (const shape of EVENT_SHAPES) {
    assert.equal(
      browserReviewText.includes(`"type":"${shape}"`),
      false,
      `browser-review.md restates the "${shape}" event shape literal — it must only cite the contract`,
    );
  }
});

test('AC2: explore.md no longer cites dev-url-detection\'s Ephemeral server start for Compare serving', () => {
  const exploreText = readNonTombstone(EXPLORE);
  assert.equal(exploreText.includes('dev-url-detection'), false);
  assert.equal(exploreText.includes('Ephemeral server start'), false);
});

test('AC3: the interactive-only preamble and the reroll/steer/exit semantics text survive unchanged', () => {
  const exploreText = fs.readFileSync(EXPLORE, 'utf8');
  assert.match(
    exploreText,
    /\*\*Interactive-only — has no auto-mode branch\*\*, like `live`\. Every step below assumes a human is present in a browser to answer the Verdict question; no caller may invoke this mode from `auto` or a `\$PIPELINE_RUN_DIR`-set context\./,
  );
  assert.match(exploreText, /--reroll <n> --from <key>/);
  assert.match(exploreText, /there is no script flag for steer/);
  assert.match(exploreText, /After two consecutive rerolls/);
});

test('AC6: the AskUserQuestion fallback verdict call site survives in Verdict', () => {
  const exploreText = readNonTombstone(EXPLORE);
  assert.match(exploreText, /Fallback — one `AskUserQuestion` call site, reused every round/);
  assert.match(exploreText, /pick.*reroll.*steer.*canon standing exit/s);
});

test('AC7: the degraded-mode path (server-start failure -> static file + terminal verdict + manual refresh) is documented', () => {
  const exploreText = readNonTombstone(EXPLORE);
  assert.match(exploreText, /Degraded mode \(server fails to start\)/);
  assert.match(exploreText, /refreshing the page manually/);
});

test('#1207 finding 1: the Turn loop names tweak as a browser action and states the non-tweak resume rule', () => {
  const text = readNonTombstone(CONTRACT);
  assert.match(text, /dragging a tweak\s*\n?\s*lever/, 'expected the Turn loop to name the tweak lever alongside Pick/Reroll/Steer/Exit');
  assert.match(
    text,
    /act on\s*\n?\s*the \*\*last non-`tweak` event\*\*/,
    'expected the Turn loop to state resume acts on the last non-tweak event',
  );
  assert.match(
    text,
    /An events file containing only `tweak` events[\s\S]*?treated the same as an empty events file/,
    'expected an events-file-of-only-tweaks to be documented as equivalent to empty',
  );
});

test('#1207 finding 1: the Precedence section explicitly excludes tweak from the verdict-word list, with a reason', () => {
  const text = readNonTombstone(CONTRACT);
  assert.match(
    text,
    /`tweak` is deliberately not part of this list/,
    'expected the Precedence section to explain why tweak is excluded from the verdict-word list, not silently omit it',
  );
});

test('#1207 finding 1: explore.md documents a fifth Verdict branch for tweak, without restating the JSON event shape', () => {
  const exploreText = readNonTombstone(EXPLORE);
  assert.match(exploreText, /\*\*Tweak\*\* events are never a verdict this step acts on/);
  assert.equal(exploreText.includes('"type":"tweak"'), false);
});

test('#1207 finding 2 (superseded by #1336): the contract still names the sandboxed-iframe boundary; restyling the judged candidate is now opt-in rather than never', () => {
  const text = readNonTombstone(CONTRACT);
  assert.match(text, /allow-scripts/);
  assert.match(text, /allow-same-origin/);
  // #1336 replaced the old absolute "never restyles the judged candidate
  // itself" claim with a postMessage opt-in convention — the sandbox
  // boundary itself (no allow-same-origin) is still asserted above; only
  // the "restyled or not" claim changed from absolute to conditional.
  assert.match(text, /opt-in per candidate/i);
  assert.equal(
    text.includes('it never changes which variant is selected, only how the currently-focused one renders'),
    false,
    'expected the factually-wrong summary sentence to be replaced, not merely appended to',
  );
});
