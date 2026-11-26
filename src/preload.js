const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('helper', {
  start: (opts) => ipcRenderer.invoke('input:start', opts),
  stop: () => ipcRenderer.invoke('input:stop'),
  onProgress: (fn) => ipcRenderer.on('input:progress', (_e, d) => fn(d)),
  readClipboard: () => ipcRenderer.invoke('clipboard:read'),
  pickMaskFiles: () => ipcRenderer.invoke('mask:pick'),
  maskFiles: (files, options) => ipcRenderer.invoke('mask:run', files, options),
  openFolder: (folder) => ipcRenderer.invoke('mask:open-folder', folder),
  pathsForDroppedFiles: (files) => Array.from(files, (f) => webUtils.getPathForFile(f)).filter(Boolean),
});
