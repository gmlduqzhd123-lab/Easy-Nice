// 한글(.hwpx) 마스킹. hwpx 는 ZIP 안의 XML 문서다.
const JSZip = require('jszip');
const { decodeXml, mapTextNodes, textNodes } = require('./xml');
const C = require('./common');

// 구역 XML 에서 표 칸(행·열·글자)을 뽑는다. 칸 주소(cellAddr)는 칸 내용 뒤에 나온다.
function sectionTables(xml) {
  const tables = [];
  const tblStack = [];
  const tcStack = [];
  const re = /<(\/?)hp:(tbl|tc|cellAddr|t)\b([^>]*?)(\/?)>/g;
  let m;
  while ((m = re.exec(xml))) {
    const [, close, tag, attrs, self] = m;
    if (tag === 'tbl') {
      if (close) { const t = tblStack.pop(); if (t) tables.push(t); } else if (!self) tblStack.push({ cells: [] });
    } else if (tag === 'tc') {
      if (close) {
        const c = tcStack.pop();
        if (c && c.table) c.table.cells.push({ row: c.row, col: c.col, text: c.text });
      } else if (!self) {
        tcStack.push({ table: tblStack[tblStack.length - 1], row: -1, col: -1, text: '' });
      }
    } else if (tag === 'cellAddr') {
      const c = tcStack[tcStack.length - 1];
      if (c) {
        c.col = Number((/colAddr="(\d+)"/.exec(attrs) || [])[1] ?? -1);
        c.row = Number((/rowAddr="(\d+)"/.exec(attrs) || [])[1] ?? -1);
      }
    } else if (tag === 't' && !close && !self) {
      const end = xml.indexOf('</hp:t>', re.lastIndex);
      if (end < 0) break;
      const inner = xml.slice(re.lastIndex, end).replace(/<[^>]+>/g, '');
      const c = tcStack[tcStack.length - 1];
      if (c) c.text += decodeXml(inner);
      re.lastIndex = end + 7;
    }
  }
  return tables;
}

const isTextPart = (n) => /\.(xml|hpf)$/i.test(n) && !/^(Contents\/header\.xml|version\.xml|META-INF\/manifest\.xml)$/i.test(n);

async function maskHwpx(buf, options) {
  const zip = await JSZip.loadAsync(buf);
  const mime = zip.file('mimetype');
  if (!mime || !(await mime.async('string')).includes('hwp')) throw new Error('hwpx 문서가 아니에요.');
  const sections = Object.keys(zip.files).filter((n) => /^Contents\/section\d+\.xml$/i.test(n));
  if (!sections.length) throw new Error('hwpx 본문을 찾지 못했어요.');

  const partXml = new Map();
  for (const n of Object.keys(zip.files)) {
    if (!zip.files[n].dir && isTextPart(n)) partXml.set(n, await zip.file(n).async('string'));
  }
  const tables = sections.flatMap((n) => sectionTables(partXml.get(n)));
  const allTexts = [...partXml.values()].flatMap(textNodes);

  const { names, headerFound } = C.collectNames(tables);
  for (const t of C.collectTeacherNames(allTexts)) names.add(t);
  const masker = C.createMasker(names, options);

  const outTexts = [];
  for (const [n, xml] of partXml) {
    let out = mapTextNodes(xml, masker.mask);
    if (/content\.hpf$/i.test(n)) {
      out = out.replace(/(<opf:meta\b[^>]*\bname="(?:creator|lastsaveby)"[^>]*>)[^<]*(<\/opf:meta>)/g, '$1$2');
    }
    if (out !== xml) zip.file(n, out);
    outTexts.push(...textNodes(out));
  }

  // 미리보기: 글자는 가리고, 그림은 빈 그림으로.
  const prvText = zip.file('Preview/PrvText.txt');
  if (prvText) {
    const t = await prvText.async('string');
    const masked = masker.mask(t);
    zip.file('Preview/PrvText.txt', masked);
    outTexts.push(masked);
  }
  if (zip.file('Preview/PrvImage.png')) zip.file('Preview/PrvImage.png', C.BLANK_PNG);

  // mimetype 은 압축하지 않은 첫 항목이어야 한다.
  zip.file('mimetype', await mime.async('uint8array'), { compression: 'STORE' });
  const out = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', compressionOptions: { level: 6 } }).then((u) => Buffer.from(u.buffer, u.byteOffset, u.length));
  return { buffer: out, names, headerFound, counts: masker.counts, outTexts, warnings: [] };
}

module.exports = { maskHwpx, sectionTables };
