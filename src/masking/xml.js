// 정규식 기반의 가벼운 XML 텍스트 처리 (xlsx·hwpx 공용).

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function decodeXml(s) {
  return String(s).replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (m, e) => {
    if (e[0] === '#') {
      const cp = e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(cp) ? String.fromCodePoint(cp) : m;
    }
    return ENT[e];
  });
}

// 태그 사이 텍스트 노드마다 fn 을 적용한다. 주석·CDATA·처리 지시문은 건드리지 않는다.
// fn 은 디코딩된 텍스트를 받아 같은 길이의 텍스트를 돌려준다. 엔터티가 없는 노드는 그대로 다시 쓴다.
function mapTextNodes(xml, fn) {
  return xml.replace(/>([^<]+)</g, (m, text) => {
    if (!/[가-힣0-9]/.test(text)) return m;
    if (!text.includes('&')) return '>' + fn(text) + '<';
    const decoded = decodeXml(text);
    const masked = fn(decoded);
    if (masked === decoded) return m;
    return '>' + masked.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') + '<';
  });
}

function textNodes(xml) {
  const out = [];
  for (const m of xml.matchAll(/>([^<]+)</g)) if (/[가-힣]/.test(m[1])) out.push(decodeXml(m[1]));
  return out;
}

module.exports = { decodeXml, mapTextNodes, textNodes };
