// 최소한의 복합 문서(CFB/OLE) 읽기·제자리 덮어쓰기.
// 스트림 크기는 바꾸지 않는다. 그래서 컨테이너 구조(FAT·디렉터리)는 원본 그대로 남는다.

const SIG = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
const ENDOFCHAIN = 0xfffffffe;
const FREESECT = 0xffffffff;
const NOSTREAM = 0xffffffff;

class Cfb {
  constructor(buf) {
    if (buf.length < 512 || !buf.subarray(0, 8).equals(SIG)) throw new Error('복합 문서(OLE) 형식이 아니에요.');
    this.buf = buf;
    this.ss = 1 << buf.readUInt16LE(0x1e);
    this.mss = 1 << buf.readUInt16LE(0x20);
    this.cutoff = buf.readUInt32LE(0x38);
    if (this.ss !== 512 && this.ss !== 4096) throw new Error('지원하지 않는 섹터 크기예요.');
    this.fat = this.#readFat();
    this.dir = this.#readDir();
    const root = this.dir[0];
    this.miniChain = root.start === ENDOFCHAIN ? [] : this.chain(root.start);
    this.minifat = this.#readMiniFat();
    this.paths = this.#buildPaths();
  }

  off(sector) {
    const o = (sector + 1) * this.ss;
    if (o + this.ss > this.buf.length + this.ss) throw new Error('손상된 문서예요 (섹터 범위).');
    return o;
  }

  #readFat() {
    const b = this.buf;
    const nFat = b.readUInt32LE(0x2c);
    const difat = [];
    for (let i = 0; i < 109 && difat.length < nFat; i++) {
      const s = b.readUInt32LE(0x4c + i * 4);
      if (s !== FREESECT) difat.push(s);
    }
    let next = b.readUInt32LE(0x44);
    let guard = 0;
    while (next !== ENDOFCHAIN && next !== FREESECT && difat.length < nFat) {
      if (++guard > 100000) throw new Error('손상된 문서예요 (DIFAT).');
      const o = this.off(next);
      const per = this.ss / 4 - 1;
      for (let i = 0; i < per && difat.length < nFat; i++) difat.push(b.readUInt32LE(o + i * 4));
      next = b.readUInt32LE(o + per * 4);
    }
    const fat = [];
    for (const s of difat) {
      const o = this.off(s);
      for (let i = 0; i < this.ss / 4; i++) fat.push(b.readUInt32LE(o + i * 4));
    }
    return fat;
  }

  chain(start, table = this.fat) {
    const out = [];
    let s = start;
    const seen = new Set();
    while (s !== ENDOFCHAIN) {
      if (s >= table.length || seen.has(s)) throw new Error('손상된 문서예요 (섹터 체인).');
      seen.add(s);
      out.push(s);
      s = table[s];
    }
    return out;
  }

  #readDir() {
    const entries = [];
    for (const s of this.chain(this.buf.readUInt32LE(0x30))) {
      const base = this.off(s);
      for (let i = 0; i < this.ss / 128; i++) {
        const o = base + i * 128;
        const nameLen = this.buf.readUInt16LE(o + 64);
        const name = nameLen >= 2 ? this.buf.toString('utf16le', o, o + nameLen - 2) : '';
        entries.push({
          name,
          type: this.buf[o + 66],
          left: this.buf.readUInt32LE(o + 68),
          right: this.buf.readUInt32LE(o + 72),
          child: this.buf.readUInt32LE(o + 76),
          start: this.buf.readUInt32LE(o + 116),
          size: this.buf.readUInt32LE(o + 120),
        });
      }
    }
    return entries;
  }

  #readMiniFat() {
    const first = this.buf.readUInt32LE(0x3c);
    if (first === ENDOFCHAIN || first === FREESECT) return [];
    const out = [];
    for (const s of this.chain(first)) {
      const o = this.off(s);
      for (let i = 0; i < this.ss / 4; i++) out.push(this.buf.readUInt32LE(o + i * 4));
    }
    return out;
  }

  #buildPaths() {
    const paths = new Map();
    const visit = (id, prefix, depth) => {
      if (id === NOSTREAM || id >= this.dir.length || depth > 64) return;
      const stack = [id];
      const seen = new Set();
      while (stack.length) {
        const i = stack.pop();
        if (i === NOSTREAM || i >= this.dir.length || seen.has(i)) continue;
        seen.add(i);
        const e = this.dir[i];
        const p = prefix ? prefix + '/' + e.name : e.name;
        if (e.type === 2) paths.set(p, i);
        if (e.type === 1) visit(e.child, p, depth + 1);
        stack.push(e.left, e.right);
      }
    };
    visit(this.dir[0].child, '', 0);
    return paths;
  }

  list() { return [...this.paths.keys()]; }
  has(path) { return this.paths.has(path); }

  // 스트림이 파일에서 차지하는 [오프셋, 길이] 구간들.
  segments(path) {
    const id = this.paths.get(path);
    if (id == null) throw new Error('스트림이 없어요: ' + path);
    const e = this.dir[id];
    const segs = [];
    let left = e.size;
    if (e.size < this.cutoff) {
      for (const m of this.chain(e.start, this.minifat)) {
        if (left <= 0) break;
        const pos = m * this.mss;
        const sec = this.miniChain[Math.floor(pos / this.ss)];
        if (sec == null) throw new Error('손상된 문서예요 (미니 스트림).');
        const len = Math.min(this.mss, left);
        segs.push([this.off(sec) + (pos % this.ss), len]);
        left -= len;
      }
    } else {
      for (const s of this.chain(e.start)) {
        if (left <= 0) break;
        const len = Math.min(this.ss, left);
        segs.push([this.off(s), len]);
        left -= len;
      }
    }
    if (left > 0) throw new Error('손상된 문서예요 (스트림 길이).');
    for (const [o, l] of segs) if (o + l > this.buf.length) throw new Error('손상된 문서예요 (파일 끝).');
    return segs;
  }

  read(path) {
    return Buffer.concat(this.segments(path).map(([o, l]) => this.buf.subarray(o, o + l)));
  }

  // 같은 길이의 내용으로만 덮어쓴다.
  write(path, data) {
    const segs = this.segments(path);
    const total = segs.reduce((a, [, l]) => a + l, 0);
    if (data.length !== total) throw new Error('내부 오류: 스트림 길이가 달라요.');
    let p = 0;
    for (const [o, l] of segs) { data.copy(this.buf, o, p, p + l); p += l; }
  }
}

module.exports = { Cfb };
