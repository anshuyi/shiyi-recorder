import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
const args=process.argv.slice(2);
const value=name=>{const index=args.indexOf(name);return index<0?'':args[index+1]??'';};
const repo=value('--repo'),tag=value('--tag'),notes=value('--notes-file');
if (!/^[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9_.-]+$/.test(repo) || !/^v\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/.test(tag)) throw new Error('需要明确的 --repo OWNER/REPO 和 --tag vVERSION');
const config=JSON.parse(fs.readFileSync('project.config.json','utf8'));
if(config.repository!==`https://github.com/${repo}`) throw new Error('目标仓库与 project.config.json 不一致；不使用原项目 remote 作为默认目标');
if (!notes || !fs.statSync(notes).isFile()) throw new Error('需要 --notes-file 指定已审阅的发行说明');
const command=['release','create',tag,'--repo',repo,'--verify-tag','--draft','--prerelease','--notes-file',notes];
console.log(JSON.stringify({action:'create draft release',command},null,2));
if(args.includes('--execute')) {
 execFileSync(process.execPath,['scripts/check-public-release.mjs'],{stdio:'inherit'});
 execFileSync('gh',command,{stdio:'inherit',windowsHide:true});
} else console.log('仅预览；--execute 才创建草稿，不会公开发行。');
