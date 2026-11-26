const { app, BrowserWindow, ipcMain, globalShortcut, clipboard, shell, dialog } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const { Keys } = require('./keys');
const { Runner } = require('./runner');
const { maskFiles } = require('./masking');

const keysExe = app.isPackaged
  ? path.join(process.resourcesPath, 'keysender.exe')
  : path.join(__dirname, '..', 'native', 'keysender.exe');

let win = null;
let maskBusy = false;
const resultFolders = new Set();
const keys = new Keys(keysExe);
const runner = new Runner({
  keys,
  writeClipboard: (t) => clipboard.writeText(t),
  emit: (e) => { if (win && !win.isDestroyed()) win.webContents.send('input:progress', e); },
});

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!win || win.isDestroyed()) return;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  });
  app.whenReady().then(() => {
    createWindow();
    // 나이스 창이 앞에 있어도 F8로 멈춘다.
    globalShortcut.register('F8', () => runner.stop());
    checkForUpdates();
  });
}

// GitHub Releases 에 새 버전이 있으면 내려받아 두고, 앱을 끌 때 설치한다.
// 설치 파일을 배포 설정 없이 만들었으면(app-update.yml 없음) 조용히 건너뛴다.
function checkForUpdates() {
  if (!app.isPackaged || process.env.HELPER_SMOKE) return;
  if (!require('node:fs').existsSync(path.join(process.resourcesPath, 'app-update.yml'))) return;
  try {
    const { autoUpdater } = require('electron-updater');
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.on('error', () => {}); // 오프라인 등은 무시
    autoUpdater.checkForUpdatesAndNotify().catch(() => {});
  } catch { /* 업데이트 확인 실패는 앱 사용에 영향 없음 */ }
}

function createWindow() {
  win = new BrowserWindow({
    width: 720,
    height: 860,
    minWidth: 600,
    minHeight: 640,
    show: false,
    backgroundColor: '#f6f7f9',
    title: '나이스 입력 도우미',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.setMenu(null);
  win.once('ready-to-show', () => win.show());
  setTimeout(() => { if (win && !win.isDestroyed() && !win.isVisible()) win.show(); }, 4000);
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  // 앱 안에서 새 창이나 외부 이동은 막는다.
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault());

  // 빌드 확인용: HELPER_SMOKE=1 이면 화면을 불러온 뒤 상태를 출력하고 끝낸다.
  if (process.env.HELPER_SMOKE) {
    win.webContents.on('console-message', (e) => console.log('[renderer]', e.level, e.message));
    win.webContents.once('did-finish-load', async () => {
      const r = await win.webContents.executeJavaScript(
        'JSON.stringify({ buttons: document.querySelectorAll("button").length, text: typeof HelperText, bridge: typeof helper, summary: document.getElementById("summary").textContent })');
      console.log('SMOKE', r, 'keys:', require('node:fs').existsSync(keysExe));
      const shot = process.env.HELPER_SMOKE_SHOT;
      if (shot) {
        await win.webContents.executeJavaScript(`(() => {
          const p = document.getElementById('paste');
          p.value = '창의적 체험활동에서 학급 회의를 이끌며\\n\\n전출\\n' + '수업 시간에 적극적으로 질문하고 '.repeat(60) + '\\n과학 탐구 보고서를 작성함';
          p.dispatchEvent(new Event('change'));
        })()`);
        await new Promise((r2) => setTimeout(r2, 300));
        require('node:fs').writeFileSync(shot + '-input.png', (await win.webContents.capturePage()).toPNG());
        await win.webContents.executeJavaScript('document.querySelector(\'[data-tab="mask"]\').click()');
        await new Promise((r2) => setTimeout(r2, 300));
        require('node:fs').writeFileSync(shot + '-mask.png', (await win.webContents.capturePage()).toPNG());
      }
      app.exit(0);
    });
  }
}

ipcMain.handle('input:start', (_e, opts) => {
  if (maskBusy) throw new Error('마스킹이 끝난 뒤 시작해 주세요.');
  if (runner.running) throw new Error('이미 입력 중이에요.');
  runner.run(opts);
  return true;
});
ipcMain.handle('input:stop', () => { runner.stop(); return true; });

ipcMain.handle('clipboard:read', () => ({ text: clipboard.readText(), html: clipboard.readHTML() }));

ipcMain.handle('mask:pick', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: '마스킹할 성적 일람표 선택',
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: '일람표 (xlsx, hwpx, hwp)', extensions: ['xlsx', 'hwpx', 'hwp'] }],
  });
  return r.canceled ? [] : r.filePaths;
});

ipcMain.handle('mask:run', async (_e, files, options) => {
  if (runner.running) throw new Error('자동입력이 끝난 뒤 다시 시도해 주세요.');
  if (maskBusy) throw new Error('이미 처리 중이에요.');
  if (!Array.isArray(files) || !files.length || files.length > 200 ||
      files.some((f) => typeof f !== 'string' || !path.isAbsolute(f))) {
    throw new Error('파일을 1~200개 선택해 주세요.');
  }
  maskBusy = true;
  try {
    const result = await maskFiles(files, options || {});
    for (const it of result.items) if (it.outdir) resultFolders.add(it.outdir);
    return result;
  } finally {
    maskBusy = false;
  }
});

ipcMain.handle('mask:open-folder', async (_e, folder) => {
  if (!resultFolders.has(folder)) throw new Error('결과 폴더를 찾을 수 없어요.');
  const st = await fs.stat(folder);
  if (!st.isDirectory()) throw new Error('결과 폴더를 찾을 수 없어요.');
  const err = await shell.openPath(folder);
  if (err) throw new Error(err);
  return true;
});

app.on('will-quit', () => { globalShortcut.unregisterAll(); keys.stop(); });
app.on('window-all-closed', () => app.quit());
