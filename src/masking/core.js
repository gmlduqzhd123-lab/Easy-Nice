// 파일 입출력 없이 바이트 → 바이트로 마스킹한다. 데스크톱 앱(Node)과 웹 페이지(브라우저)가 함께 쓴다.
const C = require('./common');
const { maskXlsx } = require('./xlsx');
const { maskHwpx } = require('./hwpx');
const { maskHwp } = require('./hwp');

const HANDLERS = { xlsx: maskXlsx, hwpx: maskHwpx, hwp: maskHwp };
const MAX_BYTES = 200 * 1024 * 1024;

const extOf = (name) => (String(name).match(/\.([^.\\/]+)$/) || [])[1]?.toLowerCase() || '';

function normalizeOptions(options = {}) {
  return {
    nameStyle: options.nameStyle === 'keep-first' ? 'keep-first' : 'all',
    maskSchool: options.maskSchool !== false,
    maskClass: Boolean(options.maskClass),
  };
}

// fileName 은 형식 판별용. bytes 는 Buffer 또는 Uint8Array.
async function maskBuffer(fileName, bytes, options) {
  const opts = normalizeOptions(options);
  const handler = HANDLERS[extOf(fileName)];
  if (!handler) throw new Error('xlsx, hwpx, hwp 파일만 처리할 수 있어요.');
  if (bytes.length > MAX_BYTES) throw new Error('파일이 너무 커요 (200MB 초과).');
  const input = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes.buffer, bytes.byteOffset, bytes.length);

  const r = await handler(input, opts);

  const warnings = [];
  if (!r.headerFound) warnings.push('"성명" 또는 "이름" 열을 찾지 못해서 학생 이름을 가리지 못했어요.');
  else if (!r.names.size) warnings.push('이름 열은 찾았지만 그 아래에서 이름을 찾지 못했어요.');
  warnings.push(...r.warnings);
  warnings.push(...C.leakWarnings(C.findLeaks(r.names, r.outTexts), opts.maskSchool && C.hasSchoolLeft(r.outTexts)));

  return {
    buffer: r.buffer,
    warnings,
    counts: { names: r.names.size, replaced: r.counts.replaced, school: r.counts.school, klass: r.counts.klass },
  };
}

// "일람표.xlsx" → "일람표_마스킹.xlsx"
function maskedName(fileName, n = 1) {
  const ext = extOf(fileName);
  const base = String(fileName).replace(/^.*[\\/]/, '').replace(/\.[^.]+$/, '');
  return `${base}_마스킹${n > 1 ? ` (${n})` : ''}.${ext}`;
}

module.exports = { maskBuffer, maskedName, normalizeOptions, extOf };
