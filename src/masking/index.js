// 데스크톱 앱용: 파일 여러 개를 마스킹해서 원본 옆 "마스킹결과" 폴더에 저장한다.
const fs = require('node:fs/promises');
const path = require('node:path');
const { maskBuffer, maskedName, normalizeOptions } = require('./core');

async function uniquePath(dir, file) {
  for (let i = 1; i < 1000; i++) {
    const p = path.join(dir, maskedName(path.basename(file), i));
    try { await fs.access(p); } catch { return p; }
  }
  throw new Error('결과 파일 이름을 정하지 못했어요.');
}

async function maskOne(file, options) {
  const st = await fs.stat(file);
  if (!st.isFile()) throw new Error('파일이 아니에요.');
  const r = await maskBuffer(file, await fs.readFile(file), options);
  const outdir = path.join(path.dirname(file), '마스킹결과');
  await fs.mkdir(outdir, { recursive: true });
  const output = await uniquePath(outdir, file);
  await fs.writeFile(output, r.buffer, { flag: 'wx' });
  return { file, ok: true, output, outdir, warnings: r.warnings, counts: r.counts };
}

async function maskFiles(files, options = {}) {
  const opts = normalizeOptions(options);
  const items = [];
  for (const f of files) {
    try {
      items.push(await maskOne(f, opts));
    } catch (e) {
      items.push({ file: f, ok: false, error: String((e && e.message) || e), warnings: [] });
    }
  }
  return { items };
}

module.exports = { maskFiles, maskOne };
