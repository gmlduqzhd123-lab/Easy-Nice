// 엑셀·한셀에서 복사한 표 텍스트 해석과 나이스 바이트 계산.
// 브라우저(화면)와 Node(테스트) 양쪽에서 쓴다.
(function (root) {
  // 칸 안 줄바꿈은 나이스 입력칸에서 문제가 되므로 공백 하나로 바꾼다.
  const cleanCell = (s) => String(s).replace(/\s*\n\s*/g, ' ').replace(/ /g, ' ').trim();

  // TSV(따옴표 규칙 포함)를 2차원 배열로.
  function parseTsv(input) {
    const text = String(input == null ? '' : input).replace(/\r\n?/g, '\n');
    const rows = [];
    let cell = '';
    let row = [];
    let quoted = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (quoted) {
        if (c === '"') {
          if (text[i + 1] === '"') { cell += '"'; i++; } else quoted = false;
        } else cell += c;
        continue;
      }
      if (c === '"' && cell === '') { quoted = true; continue; }
      if (c === '\t') { row.push(cell); cell = ''; continue; }
      if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; continue; }
      cell += c;
    }
    if (quoted) {
      // 닫히지 않은 따옴표: 따옴표 규칙을 버리고 줄 단위로 나눈다.
      return text.split('\n').filter((l, i, a) => i < a.length - 1 || l.trim())
        .map((l) => l.replace(/"/g, '').split('\t'));
    }
    row.push(cell);
    rows.push(row);
    const last = rows[rows.length - 1];
    if (rows.length > 1 && last.length === 1 && !last[0].trim()) rows.pop();
    return rows;
  }

  // 첫 번째 열만 꺼낸다(나이스에 넣을 내용은 한 열씩 복사하는 게 보통).
  function firstColumn(text) {
    if (!String(text || '').trim()) return [];
    return parseTsv(text).map((r) => cleanCell(r[0] || ''));
  }

  // 클립보드에 HTML 표만 있을 때(일부 한셀 복사).
  function firstColumnFromHtml(html, DOMParserCtor) {
    const doc = new DOMParserCtor().parseFromString(String(html || ''), 'text/html');
    return [...doc.querySelectorAll('tr')].map((tr) => {
      const td = tr.querySelector('td,th');
      return td ? cleanCell(td.textContent || '') : '';
    });
  }

  // 나이스 기준: 한글 등 3바이트, 영문·숫자·공백 1바이트, 줄바꿈 2바이트.
  function neisBytes(s) {
    let n = 0;
    for (const ch of String(s || '')) {
      const cp = ch.codePointAt(0);
      if (ch === '\n') n += 2;
      else if (cp < 0x80) n += 1;
      else if (cp < 0x800) n += 2;
      else if (cp < 0x10000) n += 3;
      else n += 4;
    }
    return n;
  }

  // 입력하지 않고 건너뛸 줄로 보이는 값.
  const SKIP_WORDS = /^(전출|전학|전출생|자퇴|유예|면제|휴학|제적|퇴학|-|―|—)$/;
  const looksSkippable = (s) => SKIP_WORDS.test(String(s || '').trim());

  const api = { parseTsv, firstColumn, firstColumnFromHtml, neisBytes, looksSkippable, cleanCell };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.HelperText = api;
})(typeof window !== 'undefined' ? window : globalThis);
