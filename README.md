# 十一录屏 · Shiyi Recorder

面向内容创作者的本地录屏与编辑工具，基于 [Recordly](https://github.com/webadderallorg/Recordly) 修改，保留原作者 webadderall 和 OpenScreen 作者 Siddharth Vaddem 的署名。

当前公开 **0.1.0-beta.1 测试版源码**：[anshuyi/shiyi-recorder](https://github.com/anshuyi/shiyi-recorder)。可以下载源码或克隆仓库，暂未提供公开安装包。Windows x64 优先；macOS/Linux 尚未验证。

## 已有能力

- 鼠标自由选择录屏区域，编辑时拖动与缩放录屏画面。
- 独立摄像头画面，支持移动、缩放与裁剪。
- 背景、光标效果、时间线编辑和视频导出。
- 麦克风伴随音频完整保存后才加载；保存完成及明确重试会刷新同路径声音，避免播放器沿用半成品的错误时长。
- 麦克风开启但启动失败时取消录制启动；不会自动降级为无声录制。重启后按当前设备重新确认选择，无法唯一匹配时要求重选。

自动测试已通过 956 项；合成音频回放与导出检查通过，包含 8 分钟连续回放。这不替代真实麦克风、摄像头和干净环境的发行验收。

这些能力需按 [发行验收表](docs/release-readiness.md) 区分自动化检查与实际设备验收；预览版不能视为已经可靠发行。

## 下载源码

在仓库页面点击 **Code → Download ZIP**，或执行：

```powershell
git clone https://github.com/anshuyi/shiyi-recorder.git
cd shiyi-recorder
```

下载源码后需要按下方步骤安装依赖才能运行；ZIP 是源码，不是双击安装程序。

## 开发与构建

Windows 10/11 x64、Node.js 22、npm、Git，以及 Visual Studio 2022 C++ 桌面开发工具和 Windows SDK、CMake。原生运行时构建需要网络；可选 CUDA 加速取决于构建环境。

```powershell
npm ci --ignore-scripts
node node_modules/electron/install.js
node node_modules/ffmpeg-static/install.js
npx electron-builder install-app-deps
npm run dev
```

本地预览安装包：`npm run build:public:win -- --preview`。脚本会准备 MediaPipe、编译原生辅助程序、检查类型、构建界面与 Electron、校验 CJS 入口、生成 Windows NSIS 安装包和 SHA256 清单。预览构建不上传。

正式候选包：`npm run build:public:win`，需要仓库、素材及实机验收记录齐全。输出在 `release/`。自动更新暂时关闭，避免跳转到原项目。

开发检查：`npm test`、`npx tsc --noEmit`、`npm run check:public -- --source-only`。重启变更地址的模拟麦克风测试：`npm run smoke:recording-audio-restart`，使用虚拟设备并静音输出，不记录私人声音。

## 旧项目与数据

新版使用独立应用身份及数据目录，不覆盖原 Recordly 的录制素材。保留 `.recordly` 项目文件格式；需要从新版打开原项目文件。首次使用请在麦克风菜单选好设备，先短录一次并确认回放。

不要把整个工作文件夹直接上传。私人录音、诊断证据、`.tmp`、`outputs`、安装包和签名凭据不属于源码。详见 [发布步骤](RELEASING.md) 与 [隐私说明](SECURITY.md)。

## 来源与许可

遵循保留的 [LICENSE.md](LICENSE.md)，其中包含 AGPLv3、原项目品牌与署名要求、OpenScreen 的 MIT 声明。第三方组件和待核实素材见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。原项目介绍另存于 [上游 README](docs/UPSTREAM_README.md)，不代表本衍生版已支持或验证相同的发行渠道。
