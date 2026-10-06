import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import JSON5 from 'json5';

const root = path.resolve(import.meta.dirname, '..');
const read = name => JSON.parse(fs.readFileSync(path.join(root, name), 'utf8'));
const project = read('project.config.json'), pkg = read('package.json');
const builder = JSON5.parse(fs.readFileSync(path.join(root, 'electron-builder.json5'), 'utf8'));
const problems = [];
if (pkg.name !== project.name || pkg.productName !== project.displayName || builder.appId !== project.appId || builder.productName !== project.displayName) problems.push('项目身份配置不一致');
if (project.autoUpdates || builder.publish) problems.push('首发前应关闭自动更新与隐式发布');
for (const name of ['LICENSE.md', 'THIRD_PARTY_NOTICES.md', 'SECURITY.md', 'branding/shiyi.ico']) if (!fs.existsSync(path.join(root, name))) problems.push(`缺少 ${name}`);
// Audit current publication candidates, including tracked files now covered by ignore rules.
const files = [...new Set(execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }).split('\0').filter(Boolean))];
const privatePath = /^(outputs|recordings|\.tmp|node_modules|release)\/|(^|\/)\.env($|\.)|\.(pfx|p12|pem)$/i;
const secretPatterns = [/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/, /\b(?:ghp|gho|ghs|ghu)_[A-Za-z0-9]{30,}\b/, /\bgithub_pat_[A-Za-z0-9_]{50,}\b/];
let scanned = 0;
for (const file of files) {
  const full = path.join(root, file);
  if (!fs.existsSync(full)) continue;
  if (privatePath.test(file) && !file.endsWith('.env.example')) { problems.push(`私人文件仍在候选内容中：${file}`); continue; }
  const stat = fs.lstatSync(full);
  if (stat.isSymbolicLink()) { problems.push(`需人工确认符号链接：${file}`); continue; }
  if (!stat.isFile() || stat.size > 2 * 1024 * 1024) continue;
  const data = fs.readFileSync(full);
  if (data.includes(0)) continue;
  scanned++;
  const text = data.toString('utf8');
  if (secretPatterns.some(pattern => pattern.test(text))) problems.push(`疑似凭据（不打印内容）：${file}`);
  if (/C:[/\\]Users[/\\](?!Public\b|Default\b|test\b|demo\b|example\b|music\b|Egg\b|\.\.\.)[^/\\\s"']+/i.test(text)) problems.push(`需脱敏的用户目录：${file}`);
}
if (!process.argv.includes('--source-only')) {
  if (!project.repository) problems.push('GitHub 仓库尚未建立并接入');
  for (const [key, passed] of Object.entries(project.releaseReview)) if (!passed) problems.push(`发布验收尚未完成：${key}`);
}
console.log(`检查 ${files.length} 个候选路径、${scanned} 个文本文件；不替代完整历史秘密审计。`);
if (problems.length) { problems.forEach(problem => console.error(`- ${problem}`)); process.exitCode = 1; }
else console.log('当前检查范围通过。');
