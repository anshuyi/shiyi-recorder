# 来源与第三方组件

十一录屏（Shiyi Recorder）是 Recordly 的独立衍生项目，不代表原作者。

- Recordly：Copyright (C) 2026 webadderall；来源 https://github.com/webadderallorg/Recordly 。保留仓库原有 LICENSE.md 全文，包括 AGPLv3 以及项目署名与品牌说明。
- OpenScreen：Copyright (c) 2025 Siddharth Vaddem；原始 MIT 声明保留在 LICENSE.md。
- Electron、React、Vite 等依赖的版本以 package-lock.json 为准；各包保留自身许可，不以本项目许可覆盖它们。
- MediaPipe Tasks Vision：Apache-2.0；随包许可位于 assets/mediapipe/LICENSE-APACHE-2.0.txt。分割模型校验值由 scripts/prepare-mediapipe-assets.mjs 固定。
- Windows 安装包的 FFmpeg 和 FFprobe 均使用 [ffmpeg-static b6.1.1 发布资产](https://github.com/eugeneware/ffmpeg-static/releases/tag/b6.1.1)，版本为 Gyan 6.1.1 essentials build，GPLv3。打包脚本验证固定 SHA256；FFprobe 的 JavaScript 包保持原有接口，但 Windows 二进制改为这个同版本资产，不分发其中旧的 4.0.2 二进制。完整构建配置、外部库版本清单和 GPL 文本随安装包放在 `resources/licenses/third-party/FFmpeg-6.1.1-README.txt` 与 `FFmpeg-6.1.1-LICENSE.txt`。
- 对应 FFmpeg 源码为 [e38092ef93](https://github.com/FFmpeg/FFmpeg/commit/e38092ef93)，构建方为 [Gyan](https://www.gyan.dev/ffmpeg/builds/)。源码入口、构建说明及第三方库版本见上述原始构建说明；本项目未修改 FFmpeg/FFprobe 源码。
- whisper.cpp 1.8.4 与 ggml：MIT，源码 [ggml-org/whisper.cpp v1.8.4](https://github.com/ggml-org/whisper.cpp/tree/v1.8.4)。安装包从该版本编译 CPU 运行库，随包提供该归档根目录的 LICENSE（Copyright 2023–2026 The ggml authors）。Windows x64 构建通过 `scripts/lib/public-windows-profile.mjs` 去掉本目标未使用的通用汇编语言检测，并用 `#line` 保留原始行号、将诊断文件名改为相对路径，避免泄露编译者目录；补丁和 CPU/静态运行库编译参数均在本仓库构建脚本中。
- Windows 录屏、光标和 Direct3D/Media Foundation 导出辅助程序的源文件与构建脚本位于本仓库 `electron/native` 和 `scripts`；遵循保留的项目许可。首发 Windows 包不包含 NVIDIA CUDA 合成辅助程序或 Video Codec SDK。
- 安装包包含 Electron 自身的许可和 Chromium 第三方声明；`resources/licenses/third-party/npm` 与 `npm-license-index.json` 提供安装依赖的许可文本、版本和来源记录。
- uiohook-napi 1.5.4：包装层 MIT；其中 libuiohook 使用 LGPLv3，GPL/LGPL 文本单独随包保留。使用包中原有 Windows Node-API 预编译模块，未修改该模块；对应 C 源文件、`binding.gyp` 和包装层源码可从 [uiohook-napi 1.5.4 npm 源码归档](https://registry.npmjs.org/uiohook-napi/-/uiohook-napi-1.5.4.tgz) 获取，安装包也保留该包的源文件。

新增的几何应用图标由 branding/generate-icons.py 生成，其源文件随项目提供。纸纹拼贴背景由项目维护者提供，并于 2026-10-07 明确确认可随软件公开分享。Windows 安装包仅包含该背景，原有图库未核实的图片和视频不打包；已有项目选择未包含的内置背景时会回退到纸纹背景，仍可自行导入图片。

源码版本与安装包版本对应同一发布标签；当前版本的测试范围和限制见 docs/release-readiness.md。以上说明针对首发 Windows x64 构建，不代表其他平台或未打包组件已经通过发行验收。
