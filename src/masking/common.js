// 형식과 무관한 마스킹 규칙.
//
// 원칙: 모든 치환은 글자 수(UTF-16 단위 수)를 바꾸지 않는다.
// 그래서 hwp 레코드 크기·hwpx 줄 배치 정보 등을 고치지 않아도 문서 구조가 유지된다.

const MASK = '○';

const NAME_HEADERS = new Set(['성명', '이름', '학생명', '학생이름', '학생성명', '성명(한글)']);

// 이름 열 아래에 자주 오는, 이름이 아닌 2~5글자 낱말.
const NOT_NAMES = new Set([
  '성명', '이름', '학생', '학생명', '번호', '평균', '합계', '총점', '총계', '소계', '비고', '담임', '교사', '석차', '등급',
  '순위', '과목', '점수', '원점수', '표준편차', '성취도', '학점', '단위수', '미이수', '전출', '전입', '전학',
  '자퇴', '유예', '면제', '결시', '결석', '응시', '인원', '수강자', '수강자수', '반평균', '학년', '학기', '확인', '서명',
  '남자', '여자', '최고', '최저', '최고점', '최저점', '중앙값', '표준', '편차', '학급', '학급평균', '과목평균', '계',
  '남', '여', '합', '반', '없음', '해당없음', '휴학', '제적', '퇴학', '재적', '재적수', '출석', '지각', '조퇴', '결과',
]);

const isNameLike = (s) => /^[가-힣]{2,5}$/.test(s) && !NOT_NAMES.has(s);
const squash = (s) => String(s || '').replace(/\s+/g, '');

// 표 목록에서 학생 이름을 모은다.
// tables: [{ cells: [{ row, col, text }] }]
function collectNames(tables) {
  const names = new Set();
  let headerFound = false;
  for (const t of tables) {
    const headers = t.cells.filter((c) => NAME_HEADERS.has(squash(c.text)));
    for (const h of headers) {
      headerFound = true;
      for (const c of t.cells) {
        if (c.col === h.col && c.row > h.row) {
          const v = squash(c.text);
          if (isNameLike(v)) names.add(v);
        }
      }
    }
  }
  return { names, headerFound };
}

// 본문 텍스트에서 "담임: 홍길동" 같은 교사 이름을 찾는다.
function collectTeacherNames(texts) {
  const out = new Set();
  const re = /(담임|담임교사|담당교사|교과담당|작성자|확인자|교사)\s*[:：]?\s*([가-힣]{2,4})(?![가-힣])/g;
  for (const t of texts) {
    for (const m of String(t).matchAll(re)) if (isNameLike(m[2])) out.add(m[2]);
  }
  return out;
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function maskName(name, style) {
  if (style === 'keep-first') return name[0] + MASK.repeat(name.length - 1);
  return MASK.repeat(name.length);
}

// "한빛고등학교" → "○○고등학교". 이미 ○로 가려진 이름은 앞에 한글이 없으니 다시 걸리지 않는다.
const SCHOOL_RE = /([가-힣]{1,20}?)((?:여자|남자)?(?:초등학교|중학교|고등학교))/g;
const CLASS_RE = /(\d{1,2})(\s*학년\s*)(\d{1,2})(\s*반)/g;

// 같은 길이를 유지하는 마스커를 만든다.
function createMasker(names, options = {}) {
  const style = options.nameStyle === 'keep-first' ? 'keep-first' : 'all';
  const list = [...names].sort((a, b) => b.length - a.length);
  // 앞뒤가 한글이 아닐 때만 이름으로 본다. "이수"라는 이름이 "이수단위"를 망치지 않게.
  const nameRe = list.length ? new RegExp(`(?<![가-힣])(${list.map(escapeRe).join('|')})(?![가-힣])`, 'g') : null;
  const counts = { replaced: 0, school: 0, klass: 0 };

  function mask(text) {
    if (!text) return text;
    let out = text;
    if (nameRe) {
      out = out.replace(nameRe, (m) => { counts.replaced++; return maskName(m, style); });
    }
    if (options.maskSchool !== false) {
      out = out.replace(SCHOOL_RE, (m, pre, suf) => {
        counts.school++;
        return MASK.repeat(pre.length) + suf;
      });
    }
    if (options.maskClass) {
      out = out.replace(CLASS_RE, (m, g, a, k, b) => { counts.klass++; return MASK.repeat(g.length) + a + MASK.repeat(k.length) + b; });
    }
    if (out.length !== text.length) throw new Error('내부 오류: 마스킹 후 글자 수가 달라졌어요.');
    return out;
  }
  return { mask, counts };
}

// 결과 텍스트에 이름이 남았는지 센다(경계 무시: 다른 낱말의 일부여도 센다).
function findLeaks(names, texts) {
  const left = new Map();
  for (const n of names) {
    let c = 0;
    for (const t of texts) {
      let i = -1;
      while ((i = t.indexOf(n, i + 1)) !== -1) c++;
    }
    if (c) left.set(n, c);
  }
  return left;
}

function leakWarnings(leaks, hasSchool) {
  const w = [];
  if (leaks.size) {
    const total = [...leaks.values()].reduce((a, b) => a + b, 0);
    w.push(`이름과 같은 글자가 ${total}곳 남아 있어요. 다른 낱말의 일부일 수 있으니 직접 확인해 주세요.`);
  }
  if (hasSchool) w.push('학교 이름으로 보이는 글자가 남아 있어요. 직접 확인해 주세요.');
  return w;
}

function hasSchoolLeft(texts) {
  return texts.some((t) => new RegExp(SCHOOL_RE.source).test(t));
}

// 1x1 흰색 PNG (미리보기 이미지 대체용).
const BLANK_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4//8/AAX+Av4N70a4AAAAAElFTkSuQmCC',
  'base64',
);

module.exports = {
  MASK, NAME_HEADERS, isNameLike, squash, collectNames, collectTeacherNames, createMasker, findLeaks,
  leakWarnings, hasSchoolLeft, BLANK_PNG, maskName,
};
