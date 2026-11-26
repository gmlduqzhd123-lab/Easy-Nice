// keysender.exe 를 하나 띄워 두고 줄 단위 명령으로 키를 보낸다.
const { spawn } = require('node:child_process');

class Keys {
  constructor(exePath) {
    this.exePath = exePath;
    this.proc = null;
    this.waiters = [];
    this.buf = '';
  }

  start() {
    if (this.proc) return Promise.resolve();
    return new Promise((resolve, reject) => {
      let ready = false;
      const proc = spawn(this.exePath, [], { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
      this.proc = proc;
      proc.once('error', (e) => { this.proc = null; if (!ready) reject(new Error('키 입력 도구를 실행하지 못했어요: ' + e.message)); });
      proc.on('exit', () => {
        if (this.proc === proc) this.proc = null;
        this.waiters.splice(0).forEach((w) => w());
      });
      proc.stdin.on('error', () => {});
      proc.stdout.setEncoding('utf8');
      proc.stdout.on('data', (d) => {
        this.buf += d;
        let i;
        while ((i = this.buf.indexOf('\n')) >= 0) {
          const line = this.buf.slice(0, i).trim();
          this.buf = this.buf.slice(i + 1);
          if (!ready && line === 'ready') { ready = true; resolve(); continue; }
          const w = this.waiters.shift();
          if (w) w();
        }
      });
    });
  }

  send(cmd) {
    return new Promise((resolve) => {
      if (!this.proc) return resolve();
      this.waiters.push(resolve);
      this.proc.stdin.write(cmd + '\n');
    });
  }

  paste() { return this.send('PASTE'); }
  tab() { return this.send('TAB'); }

  stop() {
    if (!this.proc) return;
    try { this.proc.stdin.write('EXIT\n'); } catch { /* 이미 끝남 */ }
    const p = this.proc;
    this.proc = null;
    setTimeout(() => { try { p.kill(); } catch { /* 무시 */ } }, 500);
  }
}

module.exports = { Keys };
