// 엑셀(.xlsx) 마스킹.
const JSZip = require('jszip');
const { decodeXml, mapTextNodes, textNodes } = require('./xml');
const C = require('./common');

const colNum = (letters) => [...letters].reduce((n, ch) => n * 26 + (ch.charCodeAt(0) - 64), 0);

function sharedStrings(xml) {
  if (!xml) return [];
  const out = [];
  for (const si of xml.matchAll(/<((?:\w+:)?)si\b[^>]*?(?:\/>|>([\s\S]*?)<\/\1si>)/g)) {
    const body = si[2] || '';
    // 읽는 법 안내(rPh)는 칸 값이 아니다.
    const visible = body.replace(/<((?:\w+:)?)rPh\b[\s\S]*?<\/\1rPh>/g, '');
    let t = '';
    for (const m of visible.matchAll(/<((?:\w+:)?)t\b[^>]*>([\s\S]*?)<\/\1t>/g)) t += decodeXml(m[2]);
    out.push(t);
  }
  return out;
}

function sheetCells(xml, sst) {
  const cells = [];
  const re = /<((?:\w+:)?)c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/\1c>)/g;
  for (const m of xml.matchAll(re)) {
    const attrs = m[2];
    const body = m[3] || '';
    const ref = /\br="([A-Z]+)(\d+)"/.exec(attrs);
    if (!ref) continue;
    const type = (/\bt="(\w+)"/.exec(attrs) || [])[1];
    let text = '';
    if (type === 's') {
      const v = /<(?:\w+:)?v>(\d+)</.exec(body);
      if (v) text = sst[Number(v[1])] || '';
    } else if (type === 'inlineStr') {
      for (const t of body.matchAll(/<((?:\w+:)?)t\b[^>]*>([\s\S]*?)<\/\1t>/g)) text += decodeXml(t[2]);
    } else if (type === 'str') {
      const v = /<(?:\w+:)?v>([\s\S]*?)</.exec(body);
      if (v) text = decodeXml(v[1]);
    }
    if (text) cells.push({ row: Number(ref[2]), col: colNum(ref[1]), text });
  }
  return cells;
}

// 이름이 나올 수 있는 xml 부분인지 (스타일·테마 등은 건너뛴다).
const isTextPart = (name) => /\.xml$/i.test(name) && !/^xl\/(styles|theme\/|calcChain)/i.test(name) && !/\.rels$/i.test(name);

async function maskXlsx(buf, options) {
  const zip = await JSZip.loadAsync(buf);
  const sstFile = zip.file('xl/sharedStrings.xml');
  const sst = sharedStrings(sstFile ? await sstFile.async('string') : '');
  const sheetNames = Object.keys(zip.files).filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(n));
  if (!sheetNames.length) throw new Error('엑셀 시트를 찾지 못했어요.');

  const tables = [];
  for (const n of sheetNames) tables.push({ cells: sheetCells(await zip.file(n).async('string'), sst) });

  const parts = Object.keys(zip.files).filter((n) => !zip.files[n].dir && isTextPart(n));
  const partXml = new Map();
  for (const n of parts) partXml.set(n, await zip.file(n).async('string'));
  const allTexts = [...partXml.values()].flatMap(textNodes);

  const { names, headerFound } = C.collectNames(tables);
  for (const t of C.collectTeacherNames(allTexts)) names.add(t);
  const masker = C.createMasker(names, options);

  const outTexts = [];
  for (const [n, xml] of partXml) {
    let out = mapTextNodes(xml, masker.mask);
    if (/^xl\/pivotCache\//i.test(n)) {
      // 피벗 캐시는 값이 속성(v="...")에 들어 있다.
      out = out.replace(/(<(?:\w+:)?s\b[^>]*?\bv=")([^"]*)(")/g, (m, a, v, b) => a + masker.mask(v) + b);
    }
    if (n === 'docProps/core.xml') {
      // 작성자·마지막 수정자 지우기.
      out = out.replace(/(<(dc:creator|cp:lastModifiedBy)\b[^>]*>)[\s\S]*?(<\/\2>)/g, '$1$3');
    }
    if (out !== xml) zip.file(n, out);
    outTexts.push(...textNodes(out));
  }

  // 시트 이름은 수식이 참조하므로 바꾸지 않고 알려만 준다.
  const warnings = [];
  const wb = partXml.get('xl/workbook.xml') || '';
  const sheetTitles = [...wb.matchAll(/<(?:\w+:)?sheet\b[^>]*?\bname="([^"]*)"/g)].map((m) => decodeXml(m[1]));
  if (sheetTitles.some((s) => masker.mask(s) !== s)) warnings.push('시트 이름에 이름·학교명이 들어 있어요. 시트 이름은 직접 바꿔 주세요.');

  const out = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', compressionOptions: { level: 6 } }).then((u) => Buffer.from(u.buffer, u.byteOffset, u.length));
  return { buffer: out, names, headerFound, counts: masker.counts, outTexts, warnings };
}

module.exports = { maskXlsx, sharedStrings, sheetCells };
