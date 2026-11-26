// 웹 페이지에 들어가는 마스킹 코어(브라우저용 Buffer·pako로 묶은 것)가 Node 버전과 같은 결과를 내는지 확인한다.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const zlib = require('node:zlib');
const JSZip = require('jszip');
const F = require('./fixtures');
const nodeCore = require('../src/masking/core');
const { Cfb } = require('../src/masking/cfb');
const { scanSection } = require('../src/masking/hwp');

execFileSync(process.execPath, [path.join(__dirname, '..', 'scripts', 'build-web.js'), '--test'], { stdio: 'ignore' });
const webCore = require('./.web-core.cjs');

const OPTS = { nameStyle: 'all', maskSchool: true };
const asU8 = (b) => new Uint8Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.length));

async function zipTexts(buf) {
  const zip = await JSZip.loadAsync(buf);
  const out = {};
  for (const n of Object.keys(zip.files).sort()) if (!zip.files[n].dir) out[n] = await zip.file(n).async('string');
  return out;
}

test('web core: xlsx output matches Node', async () => {
  const input = await F.makeXlsx();
  const a = await nodeCore.maskBuffer('a.xlsx', input, OPTS);
  const b = await webCore.maskBuffer('a.xlsx', asU8(input), OPTS);
  assert.deepEqual(b.counts, a.counts);
  assert.deepEqual(b.warnings, a.warnings);
  assert.deepEqual(await zipTexts(Buffer.from(b.buffer)), await zipTexts(a.buffer));
});

test('web core: hwpx output matches Node', async () => {
  const input = await F.makeHwpx();
  const a = await nodeCore.maskBuffer('a.hwpx', input, OPTS);
  const b = await webCore.maskBuffer('a.hwpx', asU8(input), OPTS);
  assert.deepEqual(b.counts, a.counts);
  assert.deepEqual(await zipTexts(Buffer.from(b.buffer)), await zipTexts(a.buffer));
});

test('web core: hwp masked in place with pako', async () => {
  const input = F.makeHwp();
  const a = await nodeCore.maskBuffer('a.hwp', input, OPTS);
  const b = await webCore.maskBuffer('a.hwp', asU8(input), OPTS);
  assert.deepEqual(b.counts, a.counts);
  const out = Buffer.from(b.buffer);
  assert.equal(out.length, input.length);
  const cfb = new Cfb(out);
  const body = zlib.inflateRawSync(cfb.read('BodyText/Section0'));
  const ref = zlib.inflateRawSync(new Cfb(a.buffer).read('BodyText/Section0'));
  assert.ok(body.equals(ref), '본문 내용이 Node 결과와 같아야 함');
  assert.equal(scanSection(body).tables[0].cells.find((c) => c.row === 1 && c.col === 1).text, '○○○');
});

test('maskedName', () => {
  assert.equal(nodeCore.maskedName('C:\\a\\일람표.hwp'), '일람표_마스킹.hwp');
  assert.equal(nodeCore.maskedName('표.v2.xlsx', 3), '표.v2_마스킹 (3).xlsx');
});
