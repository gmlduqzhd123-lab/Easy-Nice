// 한글(.hwp, HWP 5.x 바이너리) 마스킹.
//
// - 본문(BodyText/SectionN)의 문단 글자 레코드만, 같은 글자 수로 바꾼다.
// - 압축된 스트림은 다시 압축한 뒤 빈 deflate 블록을 덧붙여 원래 크기와 정확히 맞춘다.
//   그래서 파일 안 스트림 크기·위치가 모두 원본과 같다.
const zlib = require('node:zlib');
const { Cfb } = require('./cfb');
const C = require('./common');

const TAG = { PARA_TEXT: 67, CTRL_HEADER: 71, LIST_HEADER: 72, TABLE: 77 };
const CTRL_TABLE = 0x74626c20; // 'tbl '
// 1글자짜리 제어 문자. 나머지 제어 문자(0~31)는 8글자(16바이트)를 차지한다.
const CHAR_CTRL = new Set([0, 10, 13, 24, 25, 26, 27, 28, 29, 30, 31]);

function* records(buf) {
  let p = 0;
  while (p + 4 <= buf.length) {
    const h = buf.readUInt32LE(p);
    const tag = h & 0x3ff;
    const level = (h >>> 10) & 0x3ff;
    let size = h >>> 20;
    let hl = 4;
    if (size === 0xfff) {
      if (p + 8 > buf.length) throw new Error('손상된 본문 레코드예요.');
      size = buf.readUInt32LE(p + 4);
      hl = 8;
    }
    const data = p + hl;
    if (data + size > buf.length) throw new Error('손상된 본문 레코드예요.');
    yield { tag, level, data, size };
    p = data + size;
  }
}

// 문단 글자를 UTF-16 단위 수 그대로의 문자열로. 제어 문자 자리는 \u0001 로 채운다.
function paraText(buf, off, size) {
  const n = size >>> 1;
  let s = '';
  for (let i = 0; i < n;) {
    const u = buf.readUInt16LE(off + i * 2);
    if (u < 32) {
      if (CHAR_CTRL.has(u)) { s += u === 10 || u === 13 ? '\n' : ' '; i++; } else {
        const k = Math.min(8, n - i);
        s += '\u0001'.repeat(k);
        i += k;
      }
    } else { s += String.fromCharCode(u); i++; }
  }
  return s;
}

function writeParaText(buf, off, before, after) {
  for (let i = 0; i < after.length; i++) {
    if (after[i] !== before[i]) {
      if (before[i] === '\u0001' || before[i] === '\n') throw new Error('내부 오류: 제어 문자를 건드렸어요.');
      buf.writeUInt16LE(after.charCodeAt(i), off + i * 2);
    }
  }
}

// 구역 스트림을 읽어 표 칸과 모든 문단 글자를 모은다.
function scanSection(buf) {
  const tables = [];
  const paras = [];
  const stack = []; // { level, table, seenTable, cell }
  for (const r of records(buf)) {
    while (stack.length && r.level <= stack[stack.length - 1].level) stack.pop();
    const top = stack[stack.length - 1];
    if (r.tag === TAG.CTRL_HEADER && r.size >= 4 && buf.readUInt32LE(r.data) === CTRL_TABLE) {
      const t = { cells: [] };
      tables.push(t);
      stack.push({ level: r.level, table: t, seenTable: false, cell: null });
    } else if (top && r.tag === TAG.TABLE && r.level === top.level + 1) {
      top.seenTable = true;
    } else if (top && top.seenTable && r.tag === TAG.LIST_HEADER && r.level === top.level + 1 && r.size >= 12) {
      top.cell = { col: buf.readUInt16LE(r.data + 8), row: buf.readUInt16LE(r.data + 10), text: '' };
      top.table.cells.push(top.cell);
    } else if (r.tag === TAG.PARA_TEXT) {
      const text = paraText(buf, r.data, r.size);
      paras.push({ off: r.data, text });
      if (top && top.cell) {
        const t = text.replace(/\u0001/g, '').replace(/\s+/g, ' ').trim();
        if (t) top.cell.text += (top.cell.text ? ' ' : '') + t;
      }
    }
  }
  return { tables, paras };
}

// ---------- 정확한 길이의 deflate ----------
// 마지막을 장식하는 빈 블록 묶음. 내용은 없고 길이만 다르다.
//  - 고정 허프만 빈 블록 j개(블록당 10비트), 마지막 것만 BFINAL
//  - 고정 허프만 빈 블록 j개 뒤에 BFINAL 저장 블록(빈 것) 하나
function tailBlocks(j, storedFinal) {
  const bits = [];
  for (let k = 0; k < j; k++) {
    const final = !storedFinal && k === j - 1;
    bits.push(final ? 1 : 0, 1, 0); // BFINAL, BTYPE=01 (LSB 먼저)
    for (let e = 0; e < 7; e++) bits.push(0); // 블록 끝(256) = 0000000
  }
  if (storedFinal) {
    bits.push(1, 0, 0); // BFINAL, BTYPE=00
    while (bits.length % 8) bits.push(0);
  }
  const out = Buffer.alloc(Math.ceil(bits.length / 8) + (storedFinal ? 4 : 0));
  bits.forEach((b, i) => { if (b) out[i >> 3] |= 1 << (i & 7); });
  if (storedFinal) out.writeUInt32LE(0xffff0000, out.length - 4); // LEN=0, NLEN=0xFFFF
  return out;
}
const TAILS = (() => {
  const byLen = new Map();
  for (let j = 0; j <= 8; j++) {
    for (const sf of [false, true]) {
      if (j === 0 && !sf) continue;
      const b = tailBlocks(j, sf);
      if (!byLen.has(b.length)) byLen.set(b.length, b);
    }
  }
  return [...byLen.entries()].sort((a, b) => a[0] - b[0]);
})();
const EMPTY_STORED = Buffer.from([0x00, 0x00, 0x00, 0xff, 0xff]);

function deflateExact(data, size) {
  for (const strategy of [zlib.constants.Z_DEFAULT_STRATEGY, zlib.constants.Z_FILTERED]) {
    for (const level of [6, 9, 5, 4, 7, 8, 3, 2, 1]) {
      const body = zlib.deflateRawSync(data, { level, strategy, finishFlush: zlib.constants.Z_SYNC_FLUSH });
      const pad = size - body.length;
      if (pad < 2) continue;
      const tail = TAILS.find(([len]) => pad - len >= 0 && (pad - len) % 5 === 0);
      if (!tail) continue;
      const parts = [body];
      for (let k = 0; k < (pad - tail[0]) / 5; k++) parts.push(EMPTY_STORED);
      parts.push(tail[1]);
      const out = Buffer.concat(parts);
      if (out.length === size && zlib.inflateRawSync(out).equals(data)) return out;
    }
  }
  return null;
}

// ---------- 문서 요약 정보(작성자 등) ----------
function maskSummary(buf, mask) {
  // OLE 속성 집합. 문자열(VT_LPWSTR)만 제자리에서 바꾼다.
  const b = Buffer.from(buf);
  if (b.length < 48) return b;
  const sets = b.readUInt32LE(24);
  for (let s = 0; s < sets; s++) {
    const so = b.readUInt32LE(28 + s * 20 + 16);
    if (so + 8 > b.length) continue;
    const count = b.readUInt32LE(so + 4);
    for (let i = 0; i < count; i++) {
      const pid = b.readUInt32LE(so + 8 + i * 8);
      const po = so + b.readUInt32LE(so + 8 + i * 8 + 4);
      if (po + 8 > b.length) continue;
      const type = b.readUInt32LE(po) & 0xffff;
      if (type !== 0x1f) continue; // VT_LPWSTR
      const chars = b.readUInt32LE(po + 4);
      const start = po + 8;
      const end = Math.min(b.length, start + chars * 2);
      if (pid === 4 || pid === 8) {
        b.fill(0, start, end); // 작성자, 마지막 저장한 사람
      } else {
        const t = b.toString('utf16le', start, end);
        const m = mask(t);
        if (m !== t) Buffer.from(m, 'utf16le').copy(b, start);
      }
    }
  }
  return b;
}

async function maskHwp(input, options) {
  const buf = Buffer.from(input); // 복사본에 쓴다
  const cfb = new Cfb(buf);
  if (!cfb.has('FileHeader')) throw new Error('hwp 문서가 아니에요.');
  const fh = cfb.read('FileHeader');
  if (!fh.toString('latin1', 0, 17).startsWith('HWP Document File')) throw new Error('hwp 5.0 문서가 아니에요. (hwp 3.0 이하는 지원하지 않아요)');
  const props = fh.readUInt32LE(36);
  if (props & 2) throw new Error('암호가 걸린 문서예요. 암호를 푼 뒤 다시 시도해 주세요.');
  if (props & 4) throw new Error('배포용 문서는 처리할 수 없어요.');
  const compressed = Boolean(props & 1);

  const sections = cfb.list().filter((p) => /^BodyText\/Section\d+$/.test(p))
    .sort((a, b) => Number(a.match(/\d+$/)[0]) - Number(b.match(/\d+$/)[0]));
  if (!sections.length) throw new Error('본문을 찾지 못했어요.');

  const secs = sections.map((path) => {
    const raw = cfb.read(path);
    const data = compressed ? zlib.inflateRawSync(raw) : Buffer.from(raw);
    return { path, rawSize: raw.length, data, ...scanSection(data) };
  });

  const allTexts = secs.flatMap((s) => s.paras.map((p) => p.text));
  const { names, headerFound } = C.collectNames(secs.flatMap((s) => s.tables));
  for (const t of C.collectTeacherNames(allTexts)) names.add(t);
  const masker = C.createMasker(names, options);

  const outTexts = [];
  for (const s of secs) {
    let changed = false;
    for (const p of s.paras) {
      const m = masker.mask(p.text);
      if (m !== p.text) { writeParaText(s.data, p.off, p.text, m); changed = true; }
      outTexts.push(m);
    }
    if (!changed) continue;
    if (compressed) {
      const packed = deflateExact(s.data, s.rawSize);
      if (!packed) throw new Error('본문을 원래 크기로 다시 압축하지 못했어요.');
      cfb.write(s.path, packed);
    } else {
      cfb.write(s.path, s.data);
    }
  }

  // 미리보기 글자(UTF-16)와 그림
  if (cfb.has('PrvText')) {
    const raw = cfb.read('PrvText');
    const t = raw.toString('utf16le', 0, raw.length & ~1);
    const m = masker.mask(t);
    if (m !== t) {
      const out = Buffer.from(raw);
      Buffer.from(m, 'utf16le').copy(out, 0);
      cfb.write('PrvText', out);
    }
    outTexts.push(m);
  }
  if (cfb.has('PrvImage')) {
    const raw = cfb.read('PrvImage');
    const out = Buffer.alloc(raw.length);
    if (raw.length >= C.BLANK_PNG.length) C.BLANK_PNG.copy(out, 0);
    cfb.write('PrvImage', out);
  }

  const summaryPath = cfb.list().find((p) => /HwpSummaryInformation$/.test(p));
  const warnings = [];
  if (summaryPath) {
    try {
      cfb.write(summaryPath, maskSummary(cfb.read(summaryPath), masker.mask));
    } catch {
      warnings.push('문서 정보(작성자 등)를 정리하지 못했어요. 한글에서 [파일]-[문서 정보]를 확인해 주세요.');
    }
  }
  if (cfb.list().some((p) => p.startsWith('BinData/'))) warnings.push('문서 안 그림·개체는 바꾸지 않았어요. 그림 속 글자는 직접 확인해 주세요.');

  // 다시 열어서 본문이 정상적으로 풀리는지 확인
  const check = new Cfb(buf);
  for (const s of secs) {
    const raw = check.read(s.path);
    const data = compressed ? zlib.inflateRawSync(raw) : raw;
    if (!data.equals(s.data)) throw new Error('내부 오류: 결과 검증에 실패했어요.');
    for (const r of records(data)) void r;
  }

  return { buffer: buf, names, headerFound, counts: masker.counts, outTexts, warnings };
}

module.exports = { maskHwp, deflateExact, paraText, scanSection, records };
