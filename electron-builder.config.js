// 설치 파일 빌드 설정. 저장소 주소는 repo.config.json 한 곳에서만 고친다.
const repo = require('./repo.config.json');

const repoSet = Boolean(repo.owner && repo.repo);

module.exports = {
  appId: 'local.neis-input-helper',
  productName: '나이스 입력 도우미',
  executableName: 'neis-input-helper',
  directories: { output: 'dist' },
  files: ['src/**/*', '!src/web/**', 'package.json'],
  extraResources: [{ from: 'native/keysender.exe', to: 'keysender.exe' }],
  win: { target: [{ target: 'nsis', arch: ['x64'] }] },
  nsis: {
    oneClick: false,
    perMachine: false,
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true,
    shortcutName: '나이스 입력 도우미',
    // 버전 없는 고정 이름 → GitHub Pages 의 "releases/latest/download/..." 링크가 늘 최신을 가리킨다.
    artifactName: 'neis-input-helper-setup.${ext}',
  },
  // 저장소가 정해지면 GitHub Releases 로 배포하고, 앱은 거기서 자동 업데이트를 확인한다.
  publish: repoSet ? [{ provider: 'github', owner: repo.owner, repo: repo.repo, releaseType: 'release' }] : null,
};
