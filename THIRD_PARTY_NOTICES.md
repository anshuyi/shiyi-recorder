# 来源与第三方组件

十一录屏（Shiyi Recorder）是 Recordly 的独立衍生项目，不代表原作者。

- Recordly：Copyright (C) 2026 webadderall；来源 https://github.com/webadderallorg/Recordly 。保留仓库原有 LICENSE.md 全文，包括 AGPLv3 以及项目署名与品牌说明。
- OpenScreen：Copyright (c) 2025 Siddharth Vaddem；原始 MIT 声明保留在 LICENSE.md。
- Electron、React、Vite 等依赖的版本以 package-lock.json 为准；各包保留自身许可，不以本项目许可覆盖它们。
- MediaPipe Tasks Vision：Apache-2.0；随包许可位于 assets/mediapipe/LICENSE-APACHE-2.0.txt。分割模型校验值由 scripts/prepare-mediapipe-assets.mjs 固定。
- FFmpeg、FFprobe：二进制由 ffmpeg-static、ffprobe-static 提供。具体构建选项、对应许可证及源码获取说明必须在正式发布前核验；不把 JavaScript 包的许可等同于其中二进制的许可。
- whisper.cpp、原生辅助程序和其他运行时：正式发布前需要收齐实际打包版本的许可及源码说明。

新增的几何应用图标由 branding/generate-icons.py 生成，其源文件随项目提供。原有背景图库和用户提供的纸纹背景仍待逐项确认再分发来源；当前构建仅作本地预览，不能据此认定这些素材已获公开再分发授权。

当前状态：第三方清单是核验起点，不是已完成的发行合规声明。核验结果记录在 docs/release-readiness.md，检查未完成时公开发行门禁保持关闭。
