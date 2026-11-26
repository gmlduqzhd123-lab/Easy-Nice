// 테스트용 xlsx / hwpx / hwp 문서를 만든다. (실제 한글·엑셀로 만든 파일이 아니라 형식만 흉내 낸 것)
const JSZip = require('jszip');
const zlib = require('node:zlib');

const STUDENTS = ['김철수', '이영희', '박민준', '이수', '남궁민수'];
const TITLE = '한빛고등학교 2학년 3반 교과 성적 일람표';
const TEACHER_LINE = '담임: 최선생';

// ---------- xlsx ----------
async function makeXlsx() {
  const strings = [TITLE, '번호', '성명', '국어', '이수단위', TEACHER_LINE, ...STUDENTS, '평균'];
  const si = (s) => `<si><t>${s}</t></si>`;
  const idx = (s) => strings.indexOf(s);
  const rows = [
    `<row r="1"><c r="A1" t="s"><v>${idx(TITLE)}</v></c></row>`,
    `<row r="2"><c r="A2" t="s"><v>${idx('번호')}</v></c><c r="B2" t="s"><v>${idx('성명')}</v></c><c r="C2" t="s"><v>${idx('국어')}</v></c><c r="D2" t="s"><v>${idx('이수단위')}</v></c></row>`,
    ...STUDENTS.map((n, i) => `<row r="${i + 3}"><c r="A${i + 3}"><v>${i + 1}</v></c><c r="B${i + 3}" t="s"><v>${idx(n)}</v></c><c r="C${i + 3}"><v>${90 - i}</v></c><c r="D${i + 3}"><v>4</v></c></row>`),
    `<row r="8"><c r="B8" t="s"><v>${idx('평균')}</v></c></row>`,
    `<row r="9"><c r="A9" t="inlineStr"><is><t>${TEACHER_LINE}</t></is></c></row>`,
  ];
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>');
  zip.file('xl/workbook.xml', '<workbook><sheets><sheet name="3반" sheetId="1" r:id="rId1"/></sheets></workbook>');
  zip.file('xl/sharedStrings.xml', `<sst count="${strings.length}" uniqueCount="${strings.length}">${strings.map(si).join('')}</sst>`);
  zip.file('xl/worksheets/sheet1.xml', `<worksheet><sheetData>${rows.join('')}</sheetData></worksheet>`);
  zip.file('xl/styles.xml', '<styleSheet><fonts><font><name val="맑은 고딕"/></font></fonts></styleSheet>');
  zip.file('docProps/core.xml', '<cp:coreProperties><dc:creator>최선생</dc:creator><cp:lastModifiedBy>최선생</cp:lastModifiedBy></cp:coreProperties>');
  return zip.generateAsync({ type: 'nodebuffer' });
}

// ---------- hwpx ----------
function hwpxCell(col, row, text) {
  return `<hp:tc><hp:subList><hp:p><hp:run><hp:t>${text}</hp:t></hp:run></hp:p></hp:subList><hp:cellAddr colAddr="${col}" rowAddr="${row}"/><hp:cellSpan colSpan="1" rowSpan="1"/></hp:tc>`;
}
async function makeHwpx() {
  const head = ['번호', '성명', '국어'];
  const trs = [
    `<hp:tr>${head.map((h, c) => hwpxCell(c, 0, h)).join('')}</hp:tr>`,
    ...STUDENTS.map((n, r) => `<hp:tr>${hwpxCell(0, r + 1, r + 1)}${hwpxCell(1, r + 1, n)}${hwpxCell(2, r + 1, 90 - r)}</hp:tr>`),
  ];
  const section = `<?xml version="1.0" encoding="UTF-8"?><hs:sec xmlns:hs="s" xmlns:hp="p"><hp:p><hp:run><hp:t>${TITLE}</hp:t></hp:run></hp:p>` +
    `<hp:p><hp:run><hp:tbl rowCnt="6" colCnt="3">${trs.join('')}</hp:tbl></hp:run></hp:p>` +
    `<hp:p><hp:run><hp:t>${TEACHER_LINE}</hp:t><hp:t>김철수 학생 &amp; 이영희 학생</hp:t></hp:run></hp:p></hs:sec>`;
  const zip = new JSZip();
  zip.file('mimetype', 'application/hwp+zip', { compression: 'STORE' });
  zip.file('version.xml', '<hv:HCFVersion/>');
  zip.file('Contents/header.xml', '<hh:head><hh:fontface><hh:font face="함초롬바탕"/></hh:fontface></hh:head>');
  zip.file('Contents/section0.xml', section);
  zip.file('Contents/content.hpf', '<opf:package><opf:metadata><opf:meta name="creator" content="text">최선생</opf:meta></opf:metadata></opf:package>');
  zip.file('Preview/PrvText.txt', `${TITLE}\r\n<번호><성명><국어>\r\n<1><김철수><90>`);
  zip.file('Preview/PrvImage.png', Buffer.alloc(300, 7));
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

// ---------- hwp ----------
function rec(tag, level, data) {
  if (data.length >= 0xfff) {
    const h = Buffer.alloc(8);
    h.writeUInt32LE((tag | (level << 10) | (0xfff << 20)) >>> 0, 0);
    h.writeUInt32LE(data.length, 4);
    return Buffer.concat([h, data]);
  }
  const h = Buffer.alloc(4);
  h.writeUInt32LE((tag | (level << 10) | (data.length << 20)) >>> 0, 0);
  return Buffer.concat([h, data]);
}
function paraTextData(s, { withTab = false } = {}) {
  const parts = [];
  if (withTab) {
    // 탭(9)은 8글자짜리 인라인 제어 문자
    const t = Buffer.alloc(16);
    t.writeUInt16LE(9, 0); t.writeUInt16LE(9, 14);
    parts.push(t);
  }
  parts.push(Buffer.from(s, 'utf16le'));
  const end = Buffer.alloc(2); end.writeUInt16LE(13, 0); // 문단 끝
  parts.push(end);
  return Buffer.concat(parts);
}
function para(level, text, opts) {
  return Buffer.concat([rec(66, level, Buffer.alloc(22)), rec(67, level + 1, paraTextData(text, opts))]);
}
function cellHeader(level, col, row) {
  const d = Buffer.alloc(34);
  d.writeInt32LE(1, 0); d.writeUInt32LE(0, 4); d.writeUInt16LE(col, 8); d.writeUInt16LE(row, 10);
  return rec(72, level, d);
}
function makeSectionRecords() {
  const out = [para(0, TITLE, { withTab: true })];
  // 표: 문단(0) 안의 컨트롤(1) → TABLE(2), 셀 LIST_HEADER(2) → 셀 문단(2) → 글자(3)
  out.push(rec(66, 0, Buffer.alloc(22)));
  const ctrl = Buffer.alloc(8); ctrl.writeUInt32LE(0x74626c20, 0);
  out.push(rec(71, 1, ctrl));
  out.push(rec(77, 2, Buffer.alloc(20)));
  const grid = [['번호', '성명', '국어'], ...STUDENTS.map((n, i) => [String(i + 1), n, String(90 - i)])];
  grid.forEach((cols, r) => cols.forEach((t, c) => { out.push(cellHeader(2, c, r)); out.push(para(2, t)); }));
  out.push(para(0, TEACHER_LINE));
  out.push(para(0, '이수단위 합계는 그대로 둔다. ' + '가나다라마바사 '.repeat(400))); // 긴 레코드(확장 크기)
  return Buffer.concat(out);
}

// 테스트용 최소 CFB 작성기 (512바이트 섹터, 4096 미만은 미니 스트림).
function writeCfb(streams) {
  const SS = 512;
  const MSS = 64;
  const ENDC = 0xfffffffe;
  const FREE = 0xffffffff;
  // 디렉터리 항목: 루트, 저장소, 스트림
  const entries = [{ name: 'Root Entry', type: 5, children: [] }];
  const storages = new Map();
  for (const s of streams) {
    const parts = s.path.split('/');
    let parent = entries[0];
    for (let i = 0; i < parts.length - 1; i++) {
      const key = parts.slice(0, i + 1).join('/');
      if (!storages.has(key)) {
        const e = { name: parts[i], type: 1, children: [] };
        entries.push(e); storages.set(key, e); parent.children.push(e);
      }
      parent = storages.get(key);
    }
    const e = { name: parts[parts.length - 1], type: 2, data: s.data, children: [] };
    entries.push(e); parent.children.push(e);
  }
  // 미니 스트림 배치
  const mini = [];
  const miniFat = [];
  for (const e of entries) {
    if (e.type !== 2 || e.data.length >= 4096) continue;
    const n = Math.ceil(e.data.length / MSS) || 0;
    e.start = n ? miniFat.length : ENDC;
    for (let i = 0; i < n; i++) miniFat.push(i === n - 1 ? ENDC : miniFat.length + 1);
    const padded = Buffer.alloc(n * MSS); e.data.copy(padded); mini.push(padded);
  }
  const miniStream = Buffer.concat(mini);
  const big = entries.filter((e) => e.type === 2 && e.data.length >= 4096);
  const dirSectors = Math.ceil((entries.length * 128) / SS);
  const miniFatSectors = Math.ceil((miniFat.length * 4) / SS);
  const miniStreamSectors = Math.ceil(miniStream.length / SS);
  const bigSectors = big.reduce((a, e) => a + Math.ceil(e.data.length / SS), 0);
  let fatSectors = 1;
  while (fatSectors * (SS / 4) < fatSectors + dirSectors + miniFatSectors + miniStreamSectors + bigSectors) fatSectors++;
  const total = fatSectors + dirSectors + miniFatSectors + miniStreamSectors + bigSectors;
  const fat = new Array(fatSectors * (SS / 4)).fill(FREE);
  let cur = 0;
  const alloc = (n, mark) => {
    const start = cur;
    for (let i = 0; i < n; i++) fat[cur + i] = mark ?? (i === n - 1 ? ENDC : cur + i + 1);
    cur += n;
    return n ? start : ENDC;
  };
  alloc(fatSectors, 0xfffffffd);
  const dirStart = alloc(dirSectors);
  const miniFatStart = alloc(miniFatSectors);
  const miniStreamStart = alloc(miniStreamSectors);
  for (const e of big) e.start = alloc(Math.ceil(e.data.length / SS));
  entries[0].start = miniStreamStart;
  entries[0].size = miniStream.length;

  const file = Buffer.alloc((total + 1) * SS);
  const h = file;
  Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]).copy(h, 0);
  h.writeUInt16LE(0x3e, 0x18); h.writeUInt16LE(3, 0x1a); h.writeUInt16LE(0xfffe, 0x1c);
  h.writeUInt16LE(9, 0x1e); h.writeUInt16LE(6, 0x20);
  h.writeUInt32LE(fatSectors, 0x2c); h.writeUInt32LE(dirStart, 0x30); h.writeUInt32LE(4096, 0x38);
  h.writeUInt32LE(miniFatSectors ? miniFatStart : ENDC, 0x3c); h.writeUInt32LE(miniFatSectors, 0x40);
  h.writeUInt32LE(ENDC, 0x44); h.writeUInt32LE(0, 0x48);
  for (let i = 0; i < 109; i++) h.writeUInt32LE(i < fatSectors ? i : FREE, 0x4c + i * 4);
  const sec = (s) => (s + 1) * SS;
  fat.forEach((v, i) => file.writeUInt32LE(v >>> 0, sec(Math.floor(i / (SS / 4))) + (i % (SS / 4)) * 4));

  // 디렉터리 트리: 자식들을 오른쪽 형제로 줄줄이 잇는다.
  const id = new Map(entries.map((e, i) => [e, i]));
  for (const e of entries) {
    e.child = e.children.length ? id.get(e.children[0]) : FREE;
    e.children.forEach((c, i) => { c.right = i + 1 < e.children.length ? id.get(e.children[i + 1]) : FREE; });
  }
  entries.forEach((e, i) => {
    const o = sec(dirStart) + i * 128;
    const nm = Buffer.from(e.name + '\0', 'utf16le');
    nm.copy(file, o); file.writeUInt16LE(nm.length, o + 64);
    file[o + 66] = e.type; file[o + 67] = 1;
    file.writeUInt32LE(FREE, o + 68); file.writeUInt32LE((e.right ?? FREE) >>> 0, o + 72); file.writeUInt32LE(e.child >>> 0, o + 76);
    file.writeUInt32LE((e.start ?? ENDC) >>> 0, o + 116);
    file.writeUInt32LE(e.type === 2 ? e.data.length : (e.size || 0), o + 120);
  });
  for (let i = dirSectors * (SS / 128); i > entries.length; i--) {
    const o = sec(dirStart) + (i - 1) * 128;
    file.writeUInt32LE(FREE, o + 68); file.writeUInt32LE(FREE, o + 72); file.writeUInt32LE(FREE, o + 76);
  }
  miniFat.forEach((v, i) => file.writeUInt32LE(v >>> 0, sec(miniFatStart) + i * 4));
  for (let i = miniFat.length; i < miniFatSectors * (SS / 4); i++) file.writeUInt32LE(FREE, sec(miniFatStart) + i * 4);
  miniStream.copy(file, sec(miniStreamStart));
  for (const e of big) e.data.copy(file, sec(e.start));
  return file;
}

function makeSummary(author) {
  // 속성 집합 1개, 속성 2개 (제목, 작성자)
  const str = (s) => {
    const t = Buffer.from(s + '\0', 'utf16le');
    const b = Buffer.alloc(8 + Math.ceil(t.length / 4) * 4);
    b.writeUInt32LE(0x1f, 0); b.writeUInt32LE(t.length / 2, 4); t.copy(b, 8);
    return b;
  };
  const p1 = str(TITLE);
  const p2 = str(author);
  const sectionHead = 8 + 2 * 8;
  const section = Buffer.alloc(sectionHead + p1.length + p2.length);
  section.writeUInt32LE(section.length, 0); section.writeUInt32LE(2, 4);
  section.writeUInt32LE(2, 8); section.writeUInt32LE(sectionHead, 12);
  section.writeUInt32LE(4, 16); section.writeUInt32LE(sectionHead + p1.length, 20);
  p1.copy(section, sectionHead); p2.copy(section, sectionHead + p1.length);
  const head = Buffer.alloc(48);
  head.writeUInt16LE(0xfffe, 0); head.writeUInt32LE(1, 24); head.writeUInt32LE(48, 44);
  return Buffer.concat([head, section]);
}

function makeHwp({ compressed = true } = {}) {
  const fh = Buffer.alloc(256);
  fh.write('HWP Document File', 0, 'latin1');
  fh.writeUInt32LE(0x05000300, 32);
  fh.writeUInt32LE(compressed ? 1 : 0, 36);
  const body = makeSectionRecords();
  const section = compressed ? zlib.deflateRawSync(body) : body;
  return writeCfb([
    { path: 'FileHeader', data: fh },
    { path: 'DocInfo', data: compressed ? zlib.deflateRawSync(Buffer.alloc(100)) : Buffer.alloc(100) },
    { path: 'BodyText/Section0', data: section },
    { path: '\u0005HwpSummaryInformation', data: makeSummary('최선생') },
    { path: 'PrvText', data: Buffer.from(`${TITLE}\r\n<번호><성명><국어>\r\n<1><김철수><90>`, 'utf16le') },
    { path: 'PrvImage', data: Buffer.alloc(200, 9) },
  ]);
}

module.exports = { STUDENTS, TITLE, makeXlsx, makeHwpx, makeHwp, writeCfb };
