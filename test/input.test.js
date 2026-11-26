const test = require('node:test');
const assert = require('node:assert/strict');
const { Runner } = require('../src/runner');
const T = require('../src/shared/text');

function harness() {
  const log = [];
  const events = [];
  const keys = { start: async () => {}, paste: async () => { log.push('V'); }, tab: async () => { log.push('T'); } };
  const runner = new Runner({
    keys,
    writeClipboard: (t) => log.push('clip:' + t),
    emit: (e) => events.push(e),
    sleep: async () => {},
  });
  return { runner, log, events };
}

test('runner pastes each row then tabs; skip rows only tab', async () => {
  const { runner, log, events } = harness();
  await runner.run({
    rows: [{ text: '', skip: true }, { text: 'A' }, { text: '전출', skip: true }, { text: 'B' }],
    tabsPerRow: 2, skipTabs: 1, countdown: 2, speed: 3,
  });
  // 첫 건너뛰기 줄은 Tab 없음, 중간 건너뛰기 줄은 skipTabs(1)
  assert.deepEqual(log, ['clip:A', 'V', 'T', 'T', 'T', 'clip:B', 'V', 'T', 'T']);
  assert.equal(events.filter((e) => e.type === 'countdown').length, 2);
  assert.deepEqual(events.at(-1), { type: 'done', done: 4 });
});

test('runner empty text rows still tab without pasting', async () => {
  const { runner, log } = harness();
  await runner.run({ rows: [{ text: 'A' }, { text: '' }, { text: 'C' }], tabsPerRow: 1, countdown: 0 });
  assert.deepEqual(log, ['clip:A', 'V', 'T', 'T', 'clip:C', 'V', 'T']);
});

test('runner stops mid-way and reports where', async () => {
  const { runner, log, events } = harness();
  runner.keys.paste = async () => { log.push('V'); if (log.filter((x) => x === 'V').length === 2) runner.stop(); };
  await runner.run({ rows: [{ text: 'A' }, { text: 'B' }, { text: 'C' }], tabsPerRow: 1, countdown: 0 });
  const last = events.at(-1);
  assert.equal(last.type, 'stopped');
  assert.equal(last.index, 1);
  assert.ok(!log.includes('clip:C'));
  assert.equal(runner.running, false);
});

test('runner startIndex resumes and clamps options', async () => {
  const { runner, log } = harness();
  await runner.run({ rows: [{ text: 'A' }, { text: 'B' }], tabsPerRow: 99, countdown: -5, speed: 9, startIndex: 1 });
  assert.equal(log[0], 'clip:B');
  assert.equal(log.filter((x) => x === 'T').length, 20);
});

test('runner reports key tool failures', async () => {
  const { runner, events } = harness();
  runner.keys.start = async () => { throw new Error('없음'); };
  await runner.run({ rows: [{ text: 'A' }], countdown: 0 });
  assert.equal(events.at(-1).type, 'error');
  assert.equal(runner.running, false);
});

test('firstColumn parses Excel TSV with quoted multi-line cells', () => {
  const tsv = '첫째 줄\t무시\r\n"두 줄\n짜리 ""따옴표"""\tx\r\n\r\n셋째\r\n';
  assert.deepEqual(T.firstColumn(tsv), ['첫째 줄', '두 줄 짜리 "따옴표"', '', '셋째']);
  assert.deepEqual(T.firstColumn('"열린 따옴표\n다음'), ['열린 따옴표', '다음']);
  assert.deepEqual(T.firstColumn(''), []);
});

test('neisBytes counts Korean 3, ASCII 1, newline 2', () => {
  assert.equal(T.neisBytes('가a 1'), 6);
  assert.equal(T.neisBytes('가\n나'), 8);
  assert.ok(T.looksSkippable(' 전출 '));
  assert.ok(!T.looksSkippable('전출 후 복귀'));
});
