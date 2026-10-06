# 发布十一录屏

1. 对照 docs/release-readiness.md 完成当前版本验收，保留可复查的测试记录。
2. 核实实际打包的第三方运行库、模型与背景图片的再分发条件及对应源码说明。不要只把检查开关改为 true。
3. 建立自己的 GitHub 仓库，并在 project.config.json 和 package.json 接入其实际地址。首次发行保持自动更新关闭。
4. 运行 `npm run check:public`。审阅 `git status --short` 和逐文件 diff，显式选择源码文件；不要 `git add .`。`.gitignore` 不会移除历史里已经存在的秘密。发布既有历史前须完成全历史扫描；若使用干净导出目录建立新历史，仍须保留来源及许可。
5. 用干净检出按 README 构建，运行 `npm run build:public:win`。安装到独立目录，在第二个干净 Windows 用户环境完成麦克风、屏幕、摄像头、回放、导出、卸载保留项目验收。
6. 推送源码后创建版本 tag，源码必须对应安装包。`node scripts/create-release.mjs --repo OWNER/REPO --tag v0.1.0-beta.1 --notes-file RELEASE_NOTES.md` 默认只显示操作预览；加 `--execute` 才创建草稿 Release，仍不公开。
7. 将已验证安装包、SHA256SUMS-windows.txt、第三方声明和对应源码信息附到草稿。复查下载与签名状态后公开 Release。

预览方式：`npm run build:public:win -- --preview` 允许独立于未完成的发布验收在本地构建，但不会上传，也不表示可以再分发。

GitHub Actions 的 CI 只做检查；手动 Windows 构建只保存 Artifact。已停用原项目 Homebrew、winget、自动发布及赞助入口。
