/* global helper */
(function () {
  const $ = (id) => document.getElementById(id);
  const ALLOWED = /\.(xlsx|hwpx|hwp)$/i;
  let busy = false;

  function setStatus(msg, kind) {
    const el = $('mask-status');
    el.textContent = msg;
    el.className = 'status' + (kind ? ' ' + kind : '');
  }

  function options() {
    return {
      nameStyle: $('namestyle').value,
      maskSchool: $('mask-school').checked,
      maskClass: $('mask-class').checked,
    };
  }

  function renderResult(result) {
    const ul = $('mask-results');
    ul.textContent = '';
    for (const it of result.items) {
      const li = document.createElement('li');
      li.className = it.ok ? (it.warnings.length ? 'warn' : 'ok') : 'error';
      const name = document.createElement('div');
      name.className = 'fname';
      name.textContent = it.file.split(/[\\/]/).pop();
      li.appendChild(name);

      const info = document.createElement('div');
      info.className = 'finfo';
      if (it.ok) {
        const c = it.counts;
        info.textContent = `이름 ${c.names}명 · 가린 곳 ${c.replaced}곳` + (c.school ? ` · 학교명 ${c.school}곳` : '') +
          (c.klass ? ` · 학년·반 ${c.klass}곳` : '') + ` → ${it.output.split(/[\\/]/).pop()}`;
      } else {
        info.textContent = '실패: ' + it.error;
      }
      li.appendChild(info);

      for (const w of it.warnings || []) {
        const p = document.createElement('div');
        p.className = 'fwarn';
        p.textContent = '⚠ ' + w;
        li.appendChild(p);
      }
      if (it.ok && it.outdir) {
        const b = document.createElement('button');
        b.className = 'btn ghost small';
        b.textContent = '결과 폴더 열기';
        b.addEventListener('click', () => helper.openFolder(it.outdir).catch((e) => setStatus(String(e.message || e), 'error')));
        li.appendChild(b);
      }
      ul.appendChild(li);
    }
  }

  async function run(files) {
    if (busy) return;
    files = files.filter((f) => ALLOWED.test(f));
    if (!files.length) { setStatus('xlsx, hwpx, hwp 파일만 처리할 수 있어요.', 'warn'); return; }
    busy = true;
    setStatus(`${files.length}개 파일을 처리하는 중…`, 'info');
    try {
      const result = await helper.maskFiles(files, options());
      renderResult(result);
      const ok = result.items.filter((i) => i.ok).length;
      const warned = result.items.filter((i) => i.ok && i.warnings.length).length;
      setStatus(`${ok} / ${result.items.length}개 완료.` + (warned ? ` ${warned}개는 확인이 필요해요.` : '') +
        ' 공유하기 전에 결과 파일을 직접 열어 확인하세요.', ok === result.items.length && !warned ? 'ok' : 'warn');
    } catch (e) {
      setStatus(String(e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), 'error');
    } finally {
      busy = false;
    }
  }

  $('btn-pick').addEventListener('click', async () => {
    const files = await helper.pickMaskFiles();
    if (files.length) run(files);
  });

  const drop = $('drop');
  ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, () => drop.classList.remove('over')));
  drop.addEventListener('drop', (e) => {
    e.preventDefault();
    run(helper.pathsForDroppedFiles(e.dataTransfer.files));
  });
  // 창 다른 곳에 떨어뜨려도 파일이 열리지 않게.
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => e.preventDefault());
})();
