const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const JSZip = require('jszip');
const F = require('./fixtures');
const { maskXlsx } = require('../src/masking/xlsx');
const { maskHwpx } = require('../src/masking/hwpx');
const { maskHwp, scanSection } = require('../src/masking/hwp');
const { Cfb } = require('../src/masking/cfb');
const { maskFiles } = require('../src/masking');
const C = require('../src/masking/common');

const OPTS = { nameStyle: 'all', maskSchool: true, maskClass: false };

test('createMasker keeps length, respects word boundaries', () => {
  const m = C.createMasker(new Set(['이수', '김철수']), OPTS);
  assert.equal(m.mask('이수단위'), '이수단위');
  assert.equal(m.mask('이수'), '○○');
  assert.equal(m.mask('김철수(1번)'), '○○○(1번)');
  assert.equal(m.mask('한빛고등학교'), '○○고등학교');
  assert.equal(m.mask('○○고등학교'), '○○고등학교');
  assert.equal(m.mask('서울한빛여자중학교 2학년'), '○○○○여자중학교 2학년');
  const k = C.createMasker(new Set(['김철수']), { nameStyle: 'keep-first', maskClass: true });
  assert.equal(k.mask('김철수 2학년 3반'), '김○○ ○학년 ○반');
});

test('collectNames uses the name column only and skips non-names', () => {
  const { names, headerFound } = C.collectNames([{ cells: [
    { row: 1, col: 2, text: '성 명' }, { row: 2, col: 2, text: '홍길동' }, { row: 3, col: 2, text: '평균' },
    { row: 2, col: 3, text: '국어' }, { row: 0, col: 2, text: '교사' },
  ] }]);
  assert.ok(headerFound);
  assert.deepEqual([...names], ['홍길동']);
});

test('xlsx: names, school, teacher and author are masked', async () => {
  const r = await maskXlsx(await F.makeXlsx(), OPTS);
  const zip = await JSZip.loadAsync(r.buffer);
  const sst = await zip.file('xl/sharedStrings.xml').async('string');
  const sheet = await zip.file('xl/worksheets/sheet1.xml').async('string');
  const core = await zip.file('docProps/core.xml').async('string');
  for (const n of F.STUDENTS) assert.ok(!sst.includes(`<t>${n}</t>`), n);
  assert.ok(sst.includes('<t>○○○</t>'));
  assert.ok(sst.includes('<t>○○</t>'));
  assert.ok(sst.includes('<t>○○○○</t>'));
  assert.ok(sst.includes('○○고등학교 2학년 3반'));
  assert.ok(sst.includes('이수단위'), '이수단위 must survive');
  assert.ok(sst.includes('<t>평균</t>'));
  assert.ok(sheet.includes('담임: ○○○'));
  assert.ok(!core.includes('최선생'));
  assert.equal(r.names.size, F.STUDENTS.length + 1); // + 담임
  assert.equal(C.findLeaks(r.names, r.outTexts).size, 1); // "이수"가 "이수단위" 안에 남음 → 경고 대상
});

test('hwpx: table names, preview, metadata; mimetype first and stored', async () => {
  const r = await maskHwpx(await F.makeHwpx(), OPTS);
  const zip = await JSZip.loadAsync(r.buffer);
  const sec = await zip.file('Contents/section0.xml').async('string');
  for (const n of F.STUDENTS) assert.ok(!sec.includes(`>${n}<`), n);
  assert.ok(sec.includes('○○고등학교'));
  assert.ok(sec.includes('○○○ 학생 &amp; ○○○ 학생'));
  assert.ok(sec.includes('담임: ○○○'));
  assert.equal(await zip.file('Preview/PrvText.txt').async('string'), '○○고등학교 2학년 3반 교과 성적 일람표\r\n<번호><성명><국어>\r\n<1><○○○><90>');
  assert.deepEqual(await zip.file('Preview/PrvImage.png').async('nodebuffer'), C.BLANK_PNG);
  assert.ok(!(await zip.file('Contents/content.hpf').async('string')).includes('최선생'));
  // ZIP 첫 항목 = mimetype, 압축 방식 0(STORE)
  assert.equal(r.buffer.readUInt32LE(0), 0x04034b50);
  assert.equal(r.buffer.readUInt16LE(8), 0);
  assert.equal(r.buffer.toString('latin1', 30, 30 + r.buffer.readUInt16LE(26)), 'mimetype');
});

for (const compressed of [true, false]) {
  test(`hwp (${compressed ? 'compressed' : 'uncompressed'}): body masked in place, sizes unchanged`, async () => {
    const input = F.makeHwp({ compressed });
    const r = await maskHwp(input, OPTS);
    assert.equal(r.buffer.length, input.length);
    const before = new Cfb(input);
    const after = new Cfb(r.buffer);
    assert.deepEqual(after.list(), before.list());
    for (const p of before.list()) assert.equal(after.read(p).length, before.read(p).length, p);
    // 본문 이외 스트림은 그대로
    assert.ok(after.read('FileHeader').equals(before.read('FileHeader')));
    assert.ok(after.read('DocInfo').equals(before.read('DocInfo')));

    const raw = after.read('BodyText/Section0');
    const body = compressed ? zlib.inflateRawSync(raw) : raw;
    const { tables, paras } = scanSection(body);
    const all = paras.map((p) => p.text).join('\n');
    for (const n of F.STUDENTS) assert.ok(!new RegExp(`(?<![가-힣])${n}(?![가-힣])`).test(all), n);
    assert.ok(all.includes('○○고등학교 2학년 3반'));
    assert.ok(all.includes('담임: ○○○'));
    assert.ok(all.includes('이수단위 합계는 그대로 둔다.'));
    assert.equal(tables.length, 1);
    assert.equal(tables[0].cells.find((c) => c.row === 1 && c.col === 1).text, '○○○');
    // 제어 문자(탭) 위치 보존
    assert.equal(body.readUInt16LE(paras[0].off), 9);

    const prv = after.read('PrvText').toString('utf16le');
    assert.ok(prv.includes('<○○○>') && prv.includes('○○고등학교'));
    assert.ok(!after.read('\u0005HwpSummaryInformation').toString('utf16le').includes('최선생'));
    assert.ok(after.read('PrvImage').subarray(0, 8).equals(C.BLANK_PNG.subarray(0, 8)));
    assert.equal(r.counts.replaced >= F.STUDENTS.length, true);
  });
}

test('hwp: encrypted documents are rejected', async () => {
  const input = F.makeHwp();
  const cfb = new Cfb(Buffer.from(input));
  const fh = cfb.read('FileHeader');
  fh.writeUInt32LE(3, 36);
  cfb.write('FileHeader', fh);
  await assert.rejects(maskHwp(cfb.buf, OPTS), /암호/);
});

test('maskFiles writes copies into 마스킹결과 and never overwrites', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mask-'));
  const x = path.join(dir, '일람표.xlsx');
  const h = path.join(dir, '일람표.hwp');
  await fs.writeFile(x, await F.makeXlsx());
  await fs.writeFile(h, F.makeHwp());
  const bad = path.join(dir, '깨진.hwp');
  await fs.writeFile(bad, Buffer.from('not a hwp'));
  const r1 = await maskFiles([x, h, bad], OPTS);
  assert.equal(r1.items[0].ok, true);
  assert.equal(r1.items[1].ok, true);
  assert.equal(r1.items[2].ok, false);
  assert.equal(path.basename(r1.items[0].output), '일람표_마스킹.xlsx');
  assert.equal(path.dirname(r1.items[0].output), path.join(dir, '마스킹결과'));
  const r2 = await maskFiles([x], OPTS);
  assert.equal(path.basename(r2.items[0].output), '일람표_마스킹 (2).xlsx');
  assert.deepEqual(await fs.readFile(x), await F.makeXlsx().then(() => fs.readFile(x))); // 원본 그대로
  await fs.rm(dir, { recursive: true, force: true });
});
