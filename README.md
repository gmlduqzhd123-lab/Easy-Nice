# 나이스 입력 도우미

- **웹 페이지 (GitHub Pages)**: 성적 일람표 마스킹을 브라우저에서 바로 사용 + 설치 파일 다운로드 안내
- **Windows 프로그램**: 엑셀 내용을 나이스 입력칸에 차례로 붙여넣는 자동입력 + 마스킹, 자동 업데이트

자동입력(다른 창에 키 보내기)은 브라우저에서 할 수 없어서 설치형으로만 제공합니다.

## GitHub 연결하기 (처음 한 번)

1. GitHub에 새 저장소를 만들고 이 폴더를 올립니다.
2. **`repo.config.json`** 에 저장소 주인과 이름을 적습니다. 주소를 고치는 곳은 여기 한 곳뿐이에요.
   ```json
   { "owner": "내-깃허브-아이디", "repo": "저장소-이름" }
   ```
3. 저장소 **Settings → Pages → Build and deployment → Source** 를 **GitHub Actions** 로 바꿉니다.
4. `main` 브랜치에 올리면 웹 페이지가 `https://<owner>.github.io/<repo>/` 에 배포됩니다. (`.github/workflows/pages.yml`)

## 새 버전 배포하기

1. `package.json` 의 `version` 을 올립니다. (예: `1.0.1`)
2. 같은 이름의 태그를 올립니다.
   ```
   git tag v1.0.1
   git push origin v1.0.1
   ```
3. GitHub Actions(`release.yml`)가 Windows 설치 파일을 만들어 **Releases** 에 올립니다.
   - 웹 페이지의 "설치 파일 받기" 버튼은 항상 최신 Releases 의 `neis-input-helper-setup.exe` 를 가리킵니다.
   - 이미 설치된 프로그램은 다음 실행 때 새 버전을 받아 두고, 끌 때 설치합니다.

## 일람표 마스킹
- 지원 형식: `.xlsx`, `.hwpx`, `.hwp`(HWP 5.x, 암호·배포용 문서 제외)
- "성명/이름" 열 아래의 이름을 모아서 문서 전체에서 ○로 바꿉니다. "담임: ○○○" 같은 교사 이름, 학교명(○○고등학교), 작성자 정보, 미리보기 글자·그림도 정리합니다.
- 모든 치환은 글자 수를 그대로 유지합니다. hwp는 본문 스트림만 원래 크기로 다시 압축해서 제자리에 덮어쓰므로 문서 구조가 원본과 같습니다.
- 웹 페이지는 보안 정책(CSP `connect-src 'none'`)으로 외부 전송이 막혀 있어 파일이 업로드되지 않습니다.
- 문서 안 그림, 엑셀 시트 이름은 바꾸지 않습니다(경고로 알려 줌). **공유 전에 결과 파일을 꼭 직접 열어 확인하세요.**

## 자동입력 (설치형)
1. 엑셀·한셀에서 입력할 열 하나를 학생 순서대로 복사 → [클립보드에서 불러오기]
2. 전출 학생처럼 넘어갈 줄은 "건너뛰기" 체크 (`전출`, `자퇴` 같은 값은 자동 체크)
3. [시작] → 대기 시간 안에 나이스의 첫 입력칸 클릭 → 붙여넣기 + Tab 반복
4. **F8** = 비상정지. 멈춘 위치가 "시작 번호"에 들어가 있어 이어서 할 수 있습니다.

## 개발
```
npm install
node node_modules/electron/install.js   # npm 11에서 Electron 바이너리가 자동으로 받아지지 않을 때
npm run build:keys                     # keysender.exe 빌드 (Windows 기본 csc.exe)
npm start                              # 프로그램 실행
npm run build:web                      # 웹 페이지를 site/ 에 빌드
node scripts/serve-site.js             # site/ 미리 보기 (http://localhost:4173)
npm test                               # 단위 테스트 (웹용 마스킹 코어 포함)
npm run dist                           # 설치 파일을 로컬에서 빌드 (경로가 길면 NSIS가 실패하므로 짧은 경로에서)
```

| 위치 | 내용 |
|---|---|
| `src/masking/core.js` | 마스킹 코어 (프로그램·웹 공용) |
| `src/web/` | 웹 페이지와 브라우저용 대체 모듈(zlib→pako, Buffer) |
| `src/main.js`, `src/renderer/` | 프로그램 |
| `repo.config.json` | 저장소 주소 (배포 링크·자동 업데이트에 사용) |
| `.github/workflows/` | Pages 배포, 설치 파일 릴리스 |
