/* global HelperText, helper */
const $ = (id) => document.getElementById(id);
const SPEED_NAMES = ['아주 느림', '느림', '보통', '빠름', '아주 빠름'];
const STORE_KEY = 'neis-input-helper:settings:v1';
const T = HelperText;

// ---------- 탭 ----------
document.querySelectorAll('.tab').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((b) => {
      b.classList.toggle('active', b === btn);
      b.setAttribute('aria-selected', String(b === btn));
    });
    $('panel-input').hidden = btn.dataset.tab !== 'input';
    $('panel-mask').hidden = btn.dataset.tab !== 'mask';
  });
});

// ---------- 설정 저장 ----------
const SETTING_IDS = ['tabs', 'skiptabs', 'countdown', 'speed', 'limit'];
function loadSettings() {
  let s = {};
  try { s = JSON.parse(localStorage.getItem(STORE_KEY)) || {}; } catch { s = {}; }
  for (const id of SETTING_IDS) if (s[id] != null) $(id).value = s[id];
}
function saveSettings() {
  const s = {};
  for (const id of SETTING_IDS) s[id] = $(id).value;
  try { localStorage.setItem(STORE_KEY, JSON.stringify(s)); } catch { /* 저장 못 해도 동작에는 문제없음 */ }
}
loadSettings();
SETTING_IDS.forEach((id) => $(id).addEventListener('change', saveSettings));

const updateSpeedName = () => { $('speed-name').textContent = SPEED_NAMES[Number($('speed').value) - 1]; };
$('speed').addEventListener('input', updateSpeedName);
updateSpeedName();

// ---------- 목록 ----------
let rows = []; // { text, skip }

function setRows(values) {
  // 끝의 빈 줄은 버린다.
  while (values.length && !values[values.length - 1]) values.pop();
  rows = values.map((text) => ({ text, skip: T.looksSkippable(text) }));
  $('startno').value = 1;
  render();
}

function render() {
  const tbody = document.querySelector('#rows tbody');
  tbody.textContent = '';
  const limit = Number($('limit').value);
  let over = 0;
  let empty = 0;
  rows.forEach((r, i) => {
    const tr = document.createElement('tr');
    const bytes = T.neisBytes(r.text);
    if (r.skip) tr.classList.add('skip');
    else if (!r.text) { tr.classList.add('empty'); empty++; }
    else if (limit && bytes > limit) { tr.classList.add('over'); over++; }

    const no = document.createElement('td');
    no.className = 'c-no';
    no.textContent = String(i + 1);
    const txt = document.createElement('td');
    txt.className = 'c-text';
    txt.textContent = r.text || '(빈 칸)';
    txt.title = r.text;
    const b = document.createElement('td');
    b.className = 'c-bytes';
    b.textContent = limit ? `${bytes} / ${limit}` : String(bytes);
    const sk = document.createElement('td');
    sk.className = 'c-skip';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = r.skip;
    cb.setAttribute('aria-label', `${i + 1}번 건너뛰기`);
    cb.addEventListener('change', () => { r.skip = cb.checked; render(); });
    sk.appendChild(cb);
    tr.append(no, txt, b, sk);
    tbody.appendChild(tr);
  });

  if (!rows.length) {
    $('summary').textContent = '불러온 내용이 없어요.';
  } else {
    const skip = rows.filter((r) => r.skip).length;
    const parts = [`${rows.length}줄`];
    if (skip) parts.push(`건너뛰기 ${skip}`);
    if (empty) parts.push(`빈 칸 ${empty}`);
    if (over) parts.push(`한도 초과 ${over}`);
    $('summary').textContent = parts.join(' · ');
    $('summary').classList.toggle('warn', over > 0);
  }
  $('startno').max = Math.max(1, rows.length);
}
$('limit').addEventListener('change', render);

$('btn-clip').addEventListener('click', async () => {
  const { text, html } = await helper.readClipboard();
  let values = T.firstColumn(text);
  if (!values.length && html) values = T.firstColumnFromHtml(html, DOMParser);
  if (!values.length) { setStatus('클립보드에 표 내용이 없어요. 엑셀에서 열을 복사한 뒤 다시 눌러 주세요.', 'warn'); return; }
  setRows(values);
  setStatus(`${values.length}줄을 불러왔어요.`);
});

$('paste').addEventListener('paste', (e) => {
  const text = e.clipboardData.getData('text/plain');
  const html = e.clipboardData.getData('text/html');
  let values = T.firstColumn(text);
  if (!values.length && html) values = T.firstColumnFromHtml(html, DOMParser);
  if (!values.length) return;
  e.preventDefault();
  $('paste').value = '';
  setRows(values);
  setStatus(`${values.length}줄을 불러왔어요.`);
});
$('paste').addEventListener('change', () => {
  const v = $('paste').value;
  if (!v.trim()) return;
  setRows(T.firstColumn(v));
  $('paste').value = '';
});

$('btn-clear').addEventListener('click', () => { rows = []; render(); setStatus('준비됐어요.'); });

// ---------- 실행 ----------
function setStatus(msg, kind) {
  const el = $('status');
  el.textContent = msg;
  el.className = 'status' + (kind ? ' ' + kind : '');
}
function setRunning(on) {
  $('btn-start').disabled = on;
  $('btn-stop').disabled = !on;
  $('btn-clip').disabled = on;
  $('btn-clear').disabled = on;
  document.body.classList.toggle('running', on);
}
function highlight(index) {
  document.querySelectorAll('#rows tbody tr').forEach((tr, i) => tr.classList.toggle('current', i === index));
  const tr = document.querySelectorAll('#rows tbody tr')[index];
  if (tr) tr.scrollIntoView({ block: 'nearest' });
}

$('btn-start').addEventListener('click', async () => {
  if (!rows.length) { setStatus('먼저 입력할 내용을 불러와 주세요.', 'warn'); return; }
  const startIndex = Math.min(rows.length, Math.max(1, Number($('startno').value) || 1)) - 1;
  setRunning(true);
  $('bar').style.width = '0%';
  try {
    await helper.start({
      rows,
      tabsPerRow: $('tabs').value,
      skipTabs: $('skiptabs').value,
      countdown: $('countdown').value,
      speed: $('speed').value,
      startIndex,
    });
  } catch (e) {
    setRunning(false);
    setStatus(String(e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), 'error');
  }
});
$('btn-stop').addEventListener('click', () => helper.stop());

helper.onProgress((e) => {
  switch (e.type) {
    case 'countdown':
      setStatus(`${e.left}초 뒤 시작해요. 나이스의 첫 입력칸을 클릭해 두세요.`, 'info');
      break;
    case 'row':
      setStatus(`${e.index + 1} / ${e.total}번 입력 중… (F8로 멈춤)`, 'info');
      $('bar').style.width = `${Math.round(((e.index + 1) / e.total) * 100)}%`;
      highlight(e.index);
      break;
    case 'done':
      setRunning(false);
      setStatus(`끝났어요. ${e.done}줄을 처리했어요. 나이스에서 저장하기 전에 내용을 꼭 확인하세요.`, 'ok');
      highlight(-1);
      break;
    case 'stopped':
      setRunning(false);
      setStatus(`멈췄어요. ${e.done}줄까지 처리했어요.` + (e.index != null ? ` 이어서 하려면 시작 번호를 ${e.index + 1}로 두세요.` : ''), 'warn');
      if (e.index != null) $('startno').value = e.index + 1;
      break;
    case 'error':
      setRunning(false);
      setStatus('오류: ' + e.message, 'error');
      break;
    default:
  }
});

render();
