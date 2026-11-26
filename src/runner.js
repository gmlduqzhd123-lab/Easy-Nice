// 자동입력 루프. 키 입력·클립보드·진행 알림을 주입받아서 화면 없이도 테스트할 수 있다.
//
// 각 줄(row)마다:
//   - 건너뛰기 줄이 아니면 클립보드에 넣고 Ctrl+V 후 tabsPerRow 만큼 Tab
//   - 건너뛰기 줄(전출 학생 등)은 붙여넣지 않고 skipTabs 만큼만 Tab
//     (나이스 화면에 그 학생 칸이 아예 없으면 0, 칸이 있으면 tabsPerRow 와 같게)

const SPEED_FACTORS = [2.5, 1.5, 1, 0.6, 0.35]; // 1(아주 느림) ~ 5(아주 빠름)
const PASTE_WAIT_MS = 120;
const TAB_WAIT_MS = 60;

const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms));

function clampInt(v, lo, hi, dflt) {
  const n = Number.parseInt(v, 10);
  if (!Number.isFinite(n)) return dflt;
  return Math.min(hi, Math.max(lo, n));
}

function normalizeOptions(o = {}) {
  const rows = Array.isArray(o.rows) ? o.rows.map((r) => ({
    text: typeof r?.text === 'string' ? r.text : '',
    skip: Boolean(r?.skip),
  })) : [];
  return {
    rows,
    tabsPerRow: clampInt(o.tabsPerRow, 0, 20, 1),
    skipTabs: clampInt(o.skipTabs, 0, 20, 0),
    countdown: clampInt(o.countdown, 0, 30, 5),
    speed: clampInt(o.speed, 1, 5, 3),
    startIndex: clampInt(o.startIndex, 0, Math.max(0, rows.length - 1), 0),
  };
}

class Runner {
  constructor({ keys, writeClipboard, emit, sleep = defaultSleep }) {
    this.keys = keys;
    this.writeClipboard = writeClipboard;
    this.emit = emit;
    this.sleep = sleep;
    this.running = false;
    this.stopRequested = false;
  }

  stop() { if (this.running) this.stopRequested = true; }

  async run(input) {
    if (this.running) return;
    const o = normalizeOptions(input);
    if (!o.rows.length) { this.emit({ type: 'error', message: '입력할 내용이 없어요.', done: 0 }); return; }
    this.running = true;
    this.stopRequested = false;
    const f = SPEED_FACTORS[o.speed - 1];
    let done = 0;
    let pastedAny = false;
    try {
      await this.keys.start();
      for (let s = o.countdown; s > 0; s--) {
        if (this.stopRequested) return this.emit({ type: 'stopped', done });
        this.emit({ type: 'countdown', left: s });
        await this.sleep(1000);
      }
      for (let i = o.startIndex; i < o.rows.length; i++) {
        if (this.stopRequested) return this.emit({ type: 'stopped', done, index: i });
        const row = o.rows[i];
        this.emit({ type: 'row', index: i, total: o.rows.length });
        let tabs;
        if (row.skip) {
          // 첫 붙여넣기 전의 건너뛰기 줄은 Tab 없이 넘긴다. 선생님이 첫 칸을 직접 클릭해 두기 때문.
          tabs = pastedAny ? o.skipTabs : 0;
        } else {
          if (row.text) {
            this.writeClipboard(row.text);
            await this.keys.paste();
          }
          await this.sleep(PASTE_WAIT_MS * f);
          pastedAny = true;
          tabs = o.tabsPerRow;
        }
        for (let t = 0; t < tabs; t++) {
          if (this.stopRequested) return this.emit({ type: 'stopped', done, index: i });
          await this.keys.tab();
          await this.sleep(TAB_WAIT_MS * f);
        }
        done = i + 1 - o.startIndex;
      }
      this.emit({ type: 'done', done });
    } catch (e) {
      this.emit({ type: 'error', message: String((e && e.message) || e), done });
    } finally {
      this.running = false;
    }
  }
}

module.exports = { Runner, normalizeOptions, SPEED_FACTORS };
