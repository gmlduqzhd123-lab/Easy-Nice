// native/keysender.cs 를 Windows 기본 .NET Framework 컴파일러(csc.exe)로 빌드한다.
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const out = path.join(root, 'native', 'keysender.exe');
const src = path.join(root, 'native', 'keysender.cs');
const csc = path.join(process.env.WINDIR || 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe');

if (!fs.existsSync(csc)) {
  console.error('csc.exe를 찾지 못했어요: ' + csc);
  process.exit(1);
}
execFileSync(csc, ['/nologo', '/optimize+', '/target:winexe', '/platform:anycpu', '/out:' + out, src], { stdio: 'inherit' });
console.log('built ' + out);
