# 十一录屏 0.1.0-beta.1 · Windows 64 位测试版

下载下方附件 **Shiyi-Recorder-0.1.0-beta.1-windows-x64-Setup.exe**，双击安装，即可使用。无需编程环境。`Source code (zip)` 是源码，请不要把它当作安装包。

本版提供鼠标自由选区录屏、独立人像移动/缩放/裁剪、纸纹背景、时间线编辑及视频导出，包含最近的完整音轨发布与回放刷新修复。

面向 Windows 10/11 x64。新版本使用独立应用身份和数据目录，不覆盖旧 Recordly 的个人录制资料；可从新版本打开原 `.recordly` 项目。首次使用请选择麦克风并先做短录制。

这是未签名的公开测试版，Windows 可能显示未知发布者。可对照 SHA256SUMS-windows.txt 核验下载文件。本版关闭自动更新，暂不提供 macOS/Linux 包；专用 NVIDIA CUDA 合成模块未打包，普通导出可用。摄像头硬件兼容性与其他电脑的音画同步仍需要反馈，详细测试范围以 docs/release-readiness.md 为准。

源码对应标签 v0.1.0-beta.1。保留 Recordly（webadderall）、OpenScreen（Siddharth Vaddem）的来源和署名，以及 LICENSE.md 中的许可声明；实际打包的运行库说明见 THIRD_PARTY_NOTICES.md 和安装目录 resources/licenses。


## 已验证范围与剩余限制

112 个测试文件、956 项自动测试通过；本机真实麦克风阵列连续录制约 481 秒未检测到中断；独立目录安装版通过完整音轨保存、回放与 MP4 导出末段声音的 10 项检查；实际从 GitHub 下载的安装文件 SHA256 与本机验收文件一致。

Windows Server 上的自动安装/声音/导出验收尚未全部通过：初次声音输出检查失败，后续一次作业挂起且未取得日志，已改用测试专用虚拟音频输出并补充超时与阶段日志。该服务器测试不替代 Windows 10/11 的实机验收；本版暂不承诺所有设备兼容，摄像头硬件仍未实测。

