// 웹 페이지: 브라우저 안에서 일람표를 마스킹하고 결과를 내려받게 한다.
const JSZip = require('jszip');
const { maskBuffer, maskedName, extOf } = require('../masking/core');

const $ = (id) => document.getElementById(id);
const MIME = {
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  hwpx: 'application/hwp+zip',
  hwp: 'application/x-hwp',
};
const ALLOWED = new Set(['xlsx', 'hwpx', 'hwp']);

let done = []; // { name, blob }
let urls = [];
let busy = false;

function setStatus(msg, kind) {
  const el = $('status');
  el.textContent = msg;
  el.className = 'status' + (kind ? ' ' + kind : '');
}

function options() {
  return { nameStyle: $('namestyle').value, maskSchool: $('mask-school').checked, maskClass: $('mask-class').checked };
}

function uniqueName(name) {
  let n = 1;
  let out = maskedName(name, n);
  while (done.some((d) => d.name === out)) out = maskedName(name, ++n);
  return out;
}

function addResult(file, r, err) {
  const li = document.createElement('li');
  const title = document.createElement('div');
  title.className = 'fname';
  title.textContent = file.name;
  li.appendChild(title);
  const info = document.createElement('div');
  info.className = 'finfo';
  li.appendChild(info);

  if (err) {
    li.className = 'error';
    info.textContent = '실패: ' + err;
  } else {
    li.className = r.warnings.length ? 'warn' : 'ok';
    const c = r.counts;
    info.textContent = `이름 ${c.names}명 · 가린 곳 ${c.replaced}곳` + (c.school ? ` · 학교명 ${c.school}곳` : '') + (c.klass ? ` · 학년·반 ${c.klass}곳` : '');
    for (const w of r.warnings) {
      const p = document.createElement('div');
      p.className = 'fwarn';
      p.textContent = '⚠ ' + w;
      li.appendChild(p);
    }
    const name = uniqueName(file.name);
    const blob = new Blob([r.buffer], { type: MIME[extOf(file.name)] || 'application/octet-stream' });
    done.push({ name, blob });
    const url = URL.createObjectURL(blob);
    urls.push(url);
    const a = document.createElement('a');
    a.className = 'btn small primary';
    a.href = url;
    a.download = name;
    a.textContent = name + ' 받기';
    li.appendChild(a);
  }
  $('results').appendChild(li);
}

async function run(fileList) {
  if (busy) return;
  const files = [...fileList];
  const ok = files.filter((f) => ALLOWED.has(extOf(f.name)));
  if (!ok.length) { setStatus('xlsx, hwpx, hwp 파일만 처리할 수 있어요.', 'warn'); return; }
  busy = true;
  urls.forEach((u) => URL.revokeObjectURL(u));
  urls = [];
  done = [];
  $('results').textContent = '';
  $('zip-all').hidden = true;
  let fail = 0;
  let warned = 0;
  try {
    for (let i = 0; i < ok.length; i++) {
      const f = ok[i];
      setStatus(`${i + 1} / ${ok.length} 처리 중… ${f.name}`, 'info');
      // 화면이 먼저 그려지도록 한 박자 쉰다.
      await new Promise((r) => setTimeout(r, 0));
      try {
        const r = await maskBuffer(f.name, new Uint8Array(await f.arrayBuffer()), options());
        if (r.warnings.length) warned++;
        addResult(f, r);
      } catch (e) {
        fail++;
        addResult(f, null, String((e && e.message) || e));
      }
    }
    const skipped = files.length - ok.length;
    const parts = [`${ok.length - fail} / ${ok.length}개 완료`];
    if (warned) parts.push(`${warned}개는 확인 필요`);
    if (skipped) parts.push(`지원하지 않는 파일 ${skipped}개는 건너뜀`);
    setStatus(parts.join(' · ') + '. 받은 파일을 직접 열어 확인한 뒤 공유하세요.', fail || warned || skipped ? 'warn' : 'ok');
    $('zip-all').hidden = done.length < 2;
  } finally {
    busy = false;
    $('file').value = '';
  }
}

$('file').addEventListener('change', (e) => run(e.target.files));

const drop = $('drop');
drop.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('file').click(); } });
['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, () => drop.classList.remove('over')));
drop.addEventListener('drop', (e) => { e.preventDefault(); run(e.dataTransfer.files); });
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => e.preventDefault());

$('zip-all').addEventListener('click', async () => {
  const zip = new JSZip();
  for (const d of done) zip.file(d.name, d.blob);
  const blob = await zip.generateAsync({ type: 'blob', compression: 'STORE' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = '마스킹결과.zip';
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
});

// 배포 주소가 아직 없으면 다운로드 버튼을 막는다.
if (document.body.dataset.repoReady !== 'true') {
  for (const id of ['dl', 'rel']) {
    $(id).classList.add('disabled');
    $(id).setAttribute('aria-disabled', 'true');
    $(id).addEventListener('click', (e) => e.preventDefault());
  }
  $('dl-pending').hidden = false;
}

// 엽쌤 앱 공통: 📲 앱 설치 · 📱 QR (CSP 때문에 공통 키트 대신 dialog로)
(() => {
  let installEvent = null;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    installEvent = e;
  });
  window.addEventListener('appinstalled', () => { installEvent = null; });
  const open = (id) => { const d = $(id); if (d && !d.open) d.showModal(); };
  for (const d of document.querySelectorAll('.ys-dialog')) {
    d.addEventListener('click', (e) => { if (e.target === d || e.target.closest('[data-close]')) d.close(); });
  }
  $('ys-install').addEventListener('click', () => {
    const ready = Boolean(installEvent);
    $('ys-install-ready').hidden = !ready;
    $('ys-install-go').hidden = !ready;
    $('ys-install-steps').hidden = ready;
    open('ys-install-dialog');
  });
  $('ys-install-go').addEventListener('click', async () => {
    const e = installEvent;
    if (!e) return;
    installEvent = null;
    $('ys-install-dialog').close();
    e.prompt();
    try { await e.userChoice; } catch (_) { /* 취소 */ }
  });
  $('ys-qr').addEventListener('click', () => open('ys-qr-dialog'));
  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
  }
})();
