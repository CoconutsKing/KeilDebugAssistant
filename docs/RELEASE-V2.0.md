# Keil Debug Assistant V2.0

作者 oyhy。适用于 Windows + Keil µVision，需已安装 Node.js 20 或以上。

下载 `KeilDebugAssistant-v2.0.0-windows.zip`，解压至可写目录，双击 `start.cmd`。
工具只连接本机，网页内置完整的新手教程；先选择演示数据可无硬件体验。
双击 `stop.bat` 关闭工具，Keil 和 MCU 不会因此退出。

## 多窗口使用

每个 Keil 窗口在 Edit → Configuration → Other 中启用 UVSOCK，并使用不同端口（如 4823、4824）。
工具自动发现所有 Keil 监听端口，包含非默认端口。在自动模式下寻找 Debug 中的窗口，保留当前有效会话；也可在窗口列表固定目标。
若多个窗口共用同一端口，Windows 只允许其中一个监听，工具会标记无端口窗口，并提示配置。

## 新界面

Watch 来源置顶，自动跟随所选工程；可更换来源。导入与添加按钮前置。
支持松林绿、海湾蓝、鸢尾紫、暖砂金、深空黑五种主题，侧栏可收起。
内置连接、导入、搜索、数组/类成员、滑条/滚轮、目标值切换、自由排版和迁移教程。

## 迁移与初始状态

`app/` 为程序，`scripts/` 为启动关闭脚本，`userdata/` 为用户配置，`data/` 为运行信息。
发行包不包含任何 panel.json、工程路径、Watch 列表、输入历史或运行凭证。
首次打开未连接、零变量、默认主题、教程展开；不会自动连接或写入硬件。
升级请先关闭工具，保留原 userdata；旧版根目录 panel.json 可自动导入。

数组及类的完整成员列表需要已编译且包含调试信息的 AXF，以及 PATH 中的 `arm-none-eabi-readelf`。
Keil 图标用于标识兼容的 µVision 软件，相关商标属于其权利人。本工具是独立辅助软件。

官方接口配置说明：[UVSOCK Settings](https://www.keil.com/support/man/docs/uv4cl/uv4cl_dg_other.htm)。
官方独立端口启动参数：[Command Line -s port](https://www.keil.com/support/man/docs/uv4/uv4_commandline.asp)。
