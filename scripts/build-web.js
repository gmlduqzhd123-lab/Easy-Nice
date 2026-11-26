// GitHub Pages 용 정적 사이트를 site/ 에 만든다.
//   node scripts/build-web.js            → site/
//   node scripts/build-web.js --test     → 테스트용으로 마스킹 코어만 브라우저 방식(cjs)으로 묶음
const esbuild = require('esbuild');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const out = path.join(root, 'site');
const pkg = require(path.join(root, 'package.json'));
const repo = require(path.join(root, 'repo.config.json'));

const common = {
  bundle: true,
  platform: 'browser',
  target: ['chrome100', 'edge100', 'firefox100', 'safari15'],
  alias: { 'node:zlib': path.join(root, 'src/web/shims/zlib.js'), zlib: path.join(root, 'src/web/shims/zlib.js') },
  inject: [path.join(root, 'src/web/shims/buffer.js')],
  define: { 'process.env.NODE_ENV': '"production"' },
  logLevel: 'warning',
};

async function main() {
  if (process.argv.includes('--test')) {
    await esbuild.build({
      ...common,
      entryPoints: [path.join(root, 'src/masking/core.js')],
      format: 'cjs',
      outfile: path.join(root, 'test/.web-core.cjs'),
    });
    console.log('built test/.web-core.cjs');
    return;
  }

  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(path.join(out, 'assets'), { recursive: true });
  await esbuild.build({
    ...common,
    entryPoints: [path.join(root, 'src/web/main.js')],
    format: 'iife',
    minify: true,
    sourcemap: false,
    outfile: path.join(out, 'assets', 'app.js'),
  });

  const repoSet = Boolean(repo.owner && repo.repo);
  const html = fs.readFileSync(path.join(root, 'src/web/index.html'), 'utf8')
    .replaceAll('{{VERSION}}', pkg.version)
    .replaceAll('{{DOWNLOAD_URL}}', repoSet
      ? `https://github.com/${repo.owner}/${repo.repo}/releases/latest/download/neis-input-helper-setup.exe`
      : '#download-not-ready')
    .replaceAll('{{RELEASES_URL}}', repoSet ? `https://github.com/${repo.owner}/${repo.repo}/releases` : '#download-not-ready')
    .replaceAll('{{REPO_READY}}', repoSet ? 'true' : 'false');
  fs.writeFileSync(path.join(out, 'index.html'), html);
  fs.copyFileSync(path.join(root, 'src/web/style.css'), path.join(out, 'assets', 'style.css'));
  // Jekyll 처리 끄기 (밑줄로 시작하는 파일 등을 그대로 배포)
  fs.writeFileSync(path.join(out, '.nojekyll'), '');
  console.log('built site/ (repo ' + (repoSet ? `${repo.owner}/${repo.repo}` : '미설정') + ')');
}

main().catch((e) => { console.error(e); process.exit(1); });
