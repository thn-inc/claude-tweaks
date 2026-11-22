'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { scratchDir } = require('./helpers/tmp-dir');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const SEEDER = path.join(__dirname, '..', 'plugin', 'skills', 'design-wrapper', 'compare-shell', 'seed-compare.mjs');
const FIXTURES = path.join(__dirname, 'fixtures', 'compare-shell');

function mkOut(name) {
  const dir = scratchDir('compare-shell-');
  return path.join(dir, name);
}

function loadIsland(htmlText) {
  const m = htmlText.match(/<script id="vd-data" type="application\/json">([\s\S]*?)<\/script>/);
  assert.ok(m, 'expected a vd-data JSON island in the output');
  return JSON.parse(m[1]);
}

function seedCli(args) {
  const res = spawnSync(process.execPath, [SEEDER, ...args], { encoding: 'utf8' });
  return { code: res.status, out: res.stdout || '', err: res.stderr || '' };
}

// Shared fixture for the manifest.tweaks test group below: one variant 'a'
// backed by a.html, with sensible durable-mode defaults (seedKey, outcome)
// an individual test can override — e.g. `outcome: undefined` to omit it
// for a live-mode test (JSON.stringify drops undefined properties).
function writeTweaksManifest(dirPrefix, overrides) {
  const dir = scratchDir(dirPrefix);
  fs.writeFileSync(path.join(dir, 'a.html'), '<p>A</p>');
  const manifestPath = path.join(dir, 'manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify({
    scope: 'layout',
    seedKey: 'seed-tweaks-default',
    variants: [{ id: 'a', name: 'A', files: ['a.html'] }],
    outcome: { winner: 'a', date: '2026-08-21T00:00:00.000Z' },
    ...overrides,
  }));
  return manifestPath;
}

test('AC1 / AC9: live mode — one variant per manifest entry referencing its served path, /events + /stream wiring, focus-view indicator + grid selection affordances', () => {
  const out = mkOut('live-layout.html');
  const res = seedCli(['--manifest', path.join(FIXTURES, 'layout', 'manifest.json'), '--mode', 'live', '--out', out]);
  assert.equal(res.code, 0, res.err);
  const html = fs.readFileSync(out, 'utf8');
  const data = loadIsland(html);
  assert.equal(data.mode, 'live');
  assert.equal(data.variants.length, 4);
  assert.equal(data.variants.filter((v) => !v.degraded).map((v) => v.src).sort().join(','), 'variant-a.html,variant-b.html,variant-hostile.html'.split(',').sort().join(','));
  assert.match(html, /fetch\('\/events'/);
  assert.match(html, /new EventSource\('\/stream'\)/);
  assert.match(html, /id="focus-indicator"/);
  assert.match(html, /classList\.toggle\('selected'/);
});

test('review fix: identity-scope live mode assembles a real page per variant, never src=a raw skin CSS file', () => {
  const out = mkOut('live-identity.html');
  const res = seedCli(['--manifest', path.join(FIXTURES, 'identity', 'manifest.json'), '--mode', 'live', '--out', out]);
  assert.equal(res.code, 0, res.err);
  const data = loadIsland(fs.readFileSync(out, 'utf8'));
  const byId = Object.fromEntries(data.variants.map((v) => [v.id, v]));
  for (const id of ['a', 'b', 'c']) {
    assert.equal(/\.css$/.test(byId[id].src), false, `variant ${id}'s live src must not be a bare CSS file`);
    const assembledPath = path.join(path.dirname(out), byId[id].src);
    assert.equal(fs.existsSync(assembledPath), true, `expected an assembled file at ${assembledPath}`);
    const assembledText = fs.readFileSync(assembledPath, 'utf8');
    assert.match(assembledText, /SENTINEL_SHARED_MARKUP/);
  }
  assert.match(fs.readFileSync(path.join(path.dirname(out), byId.a.src), 'utf8'), /SENTINEL_SKIN_A/);
  assert.doesNotMatch(fs.readFileSync(path.join(path.dirname(out), byId.a.src), 'utf8'), /SENTINEL_SKIN_B/);
  assert.match(fs.readFileSync(path.join(path.dirname(out), byId.b.src), 'utf8'), /SENTINEL_SKIN_B/);
});

test('AC2 / AC7: durable mode — zero http(s), embeds every variant sentinel safely, stamps outcome metadata', () => {
  const out = mkOut('durable-layout.html');
  const res = seedCli(['--manifest', path.join(FIXTURES, 'layout', 'manifest.json'), '--mode', 'durable', '--out', out]);
  assert.equal(res.code, 0, res.err);
  const html = fs.readFileSync(out, 'utf8');
  assert.equal(/https?:\/\//.test(html), false, 'durable output must not reference http(s)');

  const data = loadIsland(html);
  assert.equal(data.mode, 'durable');
  const byId = Object.fromEntries(data.variants.map((v) => [v.id, v]));
  assert.match(byId.a.content, /SENTINEL_LAYOUT_A/);
  assert.match(byId.b.content, /SENTINEL_LAYOUT_B/);
  assert.match(byId.hostile.content, /SENTINEL_HOSTILE/);
  // the hostile sentinel survives round-trip through the JSON island without
  // ever appearing as raw, unescaped page-breaking markup
  assert.match(byId.hostile.content, /<\/textarea><\/iframe>"'/);
  assert.equal(html.includes('</script><\\/script'), false);

  assert.equal(data.outcome.winner, 'a');
  assert.equal(data.outcome.seedKey, 'seed-layout-1');
  assert.equal(data.outcome.rerollCount, 0);
  assert.deepEqual(data.outcome.steerHistory, []);
  assert.ok(data.outcome.date);
});

test('AC4: degraded variant renders in both scopes — labeled, counted, never a pick target', () => {
  const out = mkOut('durable-degraded.html');
  const res = seedCli(['--manifest', path.join(FIXTURES, 'layout', 'manifest.json'), '--mode', 'durable', '--out', out]);
  assert.equal(res.code, 0, res.err);
  const data = loadIsland(fs.readFileSync(out, 'utf8'));
  const degraded = data.variants.find((v) => v.id === 'd');
  assert.equal(degraded.degraded, true);
  assert.equal(degraded.reason, 'render timed out');
  assert.equal(degraded.content, undefined);
  assert.equal(data.variants.length, 4); // indicator's {N} counts every slot, degraded included
  const html = fs.readFileSync(out, 'utf8');
  assert.match(html, /v\.degraded/); // pick-target/grid-selection code paths check this flag
});

test('AC5: refusal cases exit non-zero naming the offending variant/field; a size warning still writes the file', () => {
  const missing = seedCli(['--manifest', path.join(FIXTURES, 'refusals', 'missing-file-manifest.json'), '--mode', 'live', '--out', mkOut('x.html')]);
  assert.notEqual(missing.code, 0);
  assert.match(missing.err, /missing artifact file/);
  assert.match(missing.err, /does-not-exist\.html/);

  const dup = seedCli(['--manifest', path.join(FIXTURES, 'refusals', 'duplicate-id-manifest.json'), '--mode', 'live', '--out', mkOut('x.html')]);
  assert.notEqual(dup.code, 0);
  assert.match(dup.err, /duplicate variant id: a/);

  const noOutcome = seedCli(['--manifest', path.join(FIXTURES, 'refusals', 'no-outcome-manifest.json'), '--mode', 'durable', '--out', mkOut('x.html')]);
  assert.notEqual(noOutcome.code, 0);
  assert.match(noOutcome.err, /requires manifest\.outcome/);

  const badWinner = seedCli(['--manifest', path.join(FIXTURES, 'refusals', 'unknown-winner-manifest.json'), '--mode', 'durable', '--out', mkOut('x.html')]);
  assert.notEqual(badWinner.code, 0);
  assert.match(badWinner.err, /outcome\.winner "nonexistent" not found/);
});

test('AC5 (size warning): oversized output still writes, with a stderr warning', async () => {
  const bigDir = scratchDir('compare-shell-big-');
  const bigFile = path.join(bigDir, 'big.html');
  fs.writeFileSync(bigFile, `<!doctype html><body>${'x'.repeat(3 * 1024 * 1024)}</body>`);
  const manifestPath = path.join(bigDir, 'manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify({
    scope: 'layout',
    seedKey: 'seed-big',
    variants: [{ id: 'a', name: 'A', files: ['big.html'] }],
    outcome: { winner: 'a', date: '2026-08-21T00:00:00.000Z' },
  }));
  const out = mkOut('big-out.html');
  const res = seedCli(['--manifest', manifestPath, '--mode', 'durable', '--out', out]);
  assert.equal(res.code, 0, res.err);
  assert.match(res.err, /over the .* size guideline/);
  assert.equal(fs.existsSync(out), true);
});

test('AC6: identity scope — 1 markup + 3 skins produces 3 variant frames; each srcdoc carries shared + its own skin, never a sibling\'s', () => {
  const out = mkOut('durable-identity.html');
  const res = seedCli(['--manifest', path.join(FIXTURES, 'identity', 'manifest.json'), '--mode', 'durable', '--out', out]);
  assert.equal(res.code, 0, res.err);
  const data = loadIsland(fs.readFileSync(out, 'utf8'));
  assert.equal(data.variants.length, 3);
  const byId = Object.fromEntries(data.variants.map((v) => [v.id, v]));
  assert.match(byId.a.content, /SENTINEL_SHARED_MARKUP/);
  assert.match(byId.a.content, /SENTINEL_SKIN_A/);
  assert.doesNotMatch(byId.a.content, /SENTINEL_SKIN_B/);
  assert.doesNotMatch(byId.a.content, /SENTINEL_SKIN_C/);
  assert.match(byId.b.content, /SENTINEL_SHARED_MARKUP/);
  assert.match(byId.b.content, /SENTINEL_SKIN_B/);
  assert.doesNotMatch(byId.b.content, /SENTINEL_SKIN_A/);
});

test('AC6: layout scope — 3 whole markups produce 3 variant frames', () => {
  const out = mkOut('durable-layout-scope.html');
  const res = seedCli(['--manifest', path.join(FIXTURES, 'layout', 'manifest.json'), '--mode', 'durable', '--out', out]);
  assert.equal(res.code, 0, res.err);
  const data = loadIsland(fs.readFileSync(out, 'utf8'));
  assert.equal(data.variants.filter((v) => !v.degraded).length, 3);
});

test('AC8: durable-mode verdict buttons carry disabled, and listener attachment never runs under the durable flag', () => {
  const out = mkOut('durable-buttons.html');
  const res = seedCli(['--manifest', path.join(FIXTURES, 'layout', 'manifest.json'), '--mode', 'durable', '--out', out]);
  assert.equal(res.code, 0, res.err);
  const html = fs.readFileSync(out, 'utf8');
  assert.match(html, /var MODE = "durable";/);
  assert.match(html, /if \(MODE === 'live'\) \{\s*\n\s*attachVerdictHandlers\(\);/);
  assert.match(html, /btnPick\.disabled = true;/);
  assert.match(html, /btnReroll\.disabled = true;/);
});

test('AC10: npm test picks up this suite (self-check — file lives under tests/)', () => {
  assert.match(__filename, /tests[\\/]compare-shell-seeder\.test\.js$/);
});

test('#1229: variant data containing $$, $&, $`, $\' round-trips intact through the seeded template (function replacer, not string replacer)', () => {
  const dollarDir = scratchDir('compare-shell-dollar-');
  fs.writeFileSync(path.join(dollarDir, 'variant-a.html'), '<!doctype html><body>A</body>');
  const hostileName = 'Special pricing $$29 special $& deal $` and $\' too';
  fs.writeFileSync(path.join(dollarDir, 'manifest.json'), JSON.stringify({
    scope: 'layout',
    seedKey: 'seed-dollar-1',
    variants: [{ id: 'a', name: hostileName, files: ['variant-a.html'] }],
    outcome: { winner: 'a', date: '2026-08-21T00:00:00.000Z' },
  }));
  const out = mkOut('durable-dollar.html');
  const res = seedCli(['--manifest', path.join(dollarDir, 'manifest.json'), '--mode', 'durable', '--out', out]);
  assert.equal(res.code, 0, res.err);
  const data = loadIsland(fs.readFileSync(out, 'utf8'));
  const variant = data.variants.find((v) => v.id === 'a');
  assert.equal(
    variant.name,
    hostileName,
    'a string replacer would corrupt $-pattern sequences ($$ -> $, $& -> matched substring); the function replacer must leave them intact',
  );
});

test('unit: assembleIdentityDoc inlines skin CSS before </head>', async () => {
  const mod = await import(require('node:url').pathToFileURL(SEEDER).href);
  const doc = mod.assembleIdentityDoc('<html><head><title>t</title></head><body>x</body></html>', 'body{color:red}');
  assert.match(doc, /<style>body\{color:red\}<\/style><\/head>/);
});

test('#1435: assembleIdentityDoc — skin CSS containing $`, $&, $$ survives intact (function replacer, not string replacer)', async () => {
  // Regression for the String.replace self-splicing bug (same shape as
  // #1229's __VARIANT_DATA__ fix, applied here to the other string-replace
  // call site in this file): a raw `$`-prefixed sequence in a *string*
  // replacement argument is a splice directive, not literal text
  // ('abc'.replace('b', '$`') === 'aac'). Before the fix, this hostile CSS
  // would splice the preceding shared-markup text back into the document in
  // place of the CSS itself.
  const mod = await import(require('node:url').pathToFileURL(SEEDER).href);
  const shared = '<html><head><title>SENTINEL_SHARED_MARKUP</title></head><body>x</body></html>';
  const hostileCss = 'body{content:"$`$&$$"}';
  const doc = mod.assembleIdentityDoc(shared, hostileCss);
  assert.match(doc, /<style>body\{content:"\$`\$&\$\$"\}<\/style><\/head>/, 'a string replacer would corrupt the $-pattern sequences inside the CSS');
  const sharedTextCount = (doc.match(/SENTINEL_SHARED_MARKUP/g) || []).length;
  assert.equal(sharedTextCount, 1, 'the preceding shared markup must not be spliced in a second time');
});

test('unit: escapeForInlineScript neutralizes </script regardless of case', async () => {
  const mod = await import(require('node:url').pathToFileURL(SEEDER).href);
  const escaped = mod.escapeForInlineScript('before </SCRIPT> after </script src="x">');
  assert.equal(/<\/script/i.test(escaped), false);
  assert.match(escaped, /<\\\/script/i);
});

test('AC1207-D3: durable mode bakes manifest.tweaks into outcome.tweaks', () => {
  const manifestPath = writeTweaksManifest('compare-shell-tweaks-', {
    seedKey: 'seed-tweaks-1',
    tweaks: [{ token: 'hue', value: '210' }, { token: 'corner-radius', value: '4' }],
  });
  const out = mkOut('durable-tweaks.html');
  const res = seedCli(['--manifest', manifestPath, '--mode', 'durable', '--out', out]);
  assert.equal(res.code, 0, res.err);
  const html = fs.readFileSync(out, 'utf8');
  const data = loadIsland(html);
  assert.deepEqual(data.outcome.tweaks, [{ token: 'hue', value: '210' }, { token: 'corner-radius', value: '4' }]);
  assert.match(html, /dataset\.tweaks = JSON\.stringify\(DATA\.outcome\.tweaks \|\| \[\]\)/);
});

test('AC1207-D3: durable mode with no manifest.tweaks defaults outcome.tweaks to []', () => {
  const out = mkOut('durable-no-tweaks.html');
  const res = seedCli(['--manifest', path.join(FIXTURES, 'layout', 'manifest.json'), '--mode', 'durable', '--out', out]);
  assert.equal(res.code, 0, res.err);
  const data = loadIsland(fs.readFileSync(out, 'utf8'));
  assert.deepEqual(data.outcome.tweaks, []);
});

test('AC1207-D3: a non-array manifest.tweaks is a refusal', () => {
  const manifestPath = writeTweaksManifest('compare-shell-bad-tweaks-', {
    seedKey: 'seed-bad-tweaks',
    tweaks: { token: 'hue', value: '210' },
  });
  const res = seedCli(['--manifest', manifestPath, '--mode', 'durable', '--out', mkOut('x.html')]);
  assert.notEqual(res.code, 0);
  assert.match(res.err, /manifest\.tweaks must be an array/);
});

test('#1207 finding 6: a manifest.tweaks entry missing string token/value fields is a refusal, not a silent pass', () => {
  const manifestPath = writeTweaksManifest('compare-shell-malshaped-tweaks-', {
    seedKey: 'seed-malshaped-tweaks',
    tweaks: ['hello', 42],
  });
  const res = seedCli(['--manifest', manifestPath, '--mode', 'durable', '--out', mkOut('x.html')]);
  assert.notEqual(res.code, 0, 'a tweaks array of non-{token,value} entries must be refused, not silently accepted');
  assert.match(res.err, /manifest\.tweaks entry .* must have string token and value fields/);
});

test('#1207 finding 6: a manifest.tweaks entry with non-string token/value fields is a refusal', () => {
  const manifestPath = writeTweaksManifest('compare-shell-numeric-tweaks-', {
    seedKey: 'seed-numeric-tweaks',
    tweaks: [{ token: 'hue', value: 210 }],
  });
  const res = seedCli(['--manifest', manifestPath, '--mode', 'durable', '--out', mkOut('x.html')]);
  assert.notEqual(res.code, 0, 'a numeric value field must be refused — the shape contract is string token, string value');
  assert.match(res.err, /must have string token and value fields/);
});

test('review finding: a null manifest.tweaks entry is a SeedError refusal, not a raw TypeError', () => {
  const manifestPath = writeTweaksManifest('compare-shell-null-tweaks-', {
    seedKey: 'seed-null-tweaks',
    tweaks: [null],
  });
  const res = seedCli(['--manifest', manifestPath, '--mode', 'durable', '--out', mkOut('x.html')]);
  assert.notEqual(res.code, 0, 'a null tweaks entry must be refused, not crash with a raw TypeError');
  assert.match(res.err, /manifest\.tweaks entry .* must have string token and value fields/);
});

test('#1207 finding 7: manifest.tweaks is validated only in durable mode — a malshaped tweaks entry does not block live mode', () => {
  const manifestPath = writeTweaksManifest('compare-shell-live-tweaks-', {
    seedKey: 'seed-live-tweaks',
    outcome: undefined,
    tweaks: ['not', 'shaped', 'right'],
  });
  const res = seedCli(['--manifest', manifestPath, '--mode', 'live', '--out', mkOut('x.html')]);
  assert.equal(res.code, 0, res.err);
});
