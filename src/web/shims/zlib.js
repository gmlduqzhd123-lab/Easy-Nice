// 브라우저용 node:zlib 대체. 마스킹 코드가 쓰는 함수만 pako 로 구현한다.
const pako = require('pako');

const constants = {
  Z_NO_FLUSH: pako.Z_NO_FLUSH,
  Z_SYNC_FLUSH: pako.Z_SYNC_FLUSH,
  Z_FINISH: pako.Z_FINISH,
  Z_DEFAULT_STRATEGY: pako.Z_DEFAULT_STRATEGY,
  Z_FILTERED: pako.Z_FILTERED,
};

const toBuf = (u8) => Buffer.from(u8.buffer, u8.byteOffset, u8.length);

function inflateRawSync(data) {
  return toBuf(pako.inflateRaw(data));
}

function deflateRawSync(data, opts = {}) {
  const d = new pako.Deflate({ raw: true, level: opts.level ?? 6, strategy: opts.strategy ?? pako.Z_DEFAULT_STRATEGY });
  const chunks = [];
  d.onData = (c) => chunks.push(c);
  d.push(data, opts.finishFlush ?? pako.Z_FINISH);
  if (d.err) throw new Error(d.msg || 'deflate 실패');
  return Buffer.concat(chunks.map(toBuf));
}

module.exports = { constants, inflateRawSync, deflateRawSync };
