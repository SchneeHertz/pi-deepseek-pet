# pi-deepseek-pet-extension

<p align="center">
  <img src="https://raw.githubusercontent.com/SchneeHertz/pi-deepseek-pet/main/assets/preview/hero-qiaoji-zhuomian.gif" alt="Pi DeepSeek Pet" width="280">
</p>

Pi Package that forwards safe Pi lifecycle phases to the local Pi DeepSeek Pet desktop app. It registers no LLM tools and is non-blocking when the desktop app is unavailable. The published `dist/index.js` bundles its protocol runtime, so no workspace package is required after installation.

The companion Windows app displays the pet. [Download the latest Pi DeepSeek Pet desktop installer from GitHub Releases](https://github.com/SchneeHertz/pi-deepseek-pet/releases/latest) and install it. You can start it manually, or independently enable **Linked start and stop with Pi** in the desktop settings so this extension starts it on Pi startup and closes the Pi-managed desktop after the last Pi process exits.

Install with `pi install npm:pi-deepseek-pet-extension`, update with `pi update npm:pi-deepseek-pet-extension`, and remove with `pi remove npm:pi-deepseek-pet-extension`.

See the [full extension guide](https://github.com/SchneeHertz/pi-deepseek-pet/blob/main/docs/PI_EXTENSION.md).

Pi DeepSeek Pet is maintained by [SchneeHertz](https://github.com/SchneeHertz) and derives from the original [PC2005-cloud/dsh-pet](https://github.com/PC2005-cloud/dsh-pet) project, with thanks to its author and contributors.

---

# 中文说明

本 Pi Package 将 Pi 运行状态的安全摘要转发给本机 Pi DeepSeek Pet 桌面应用。它不注册任何 LLM 工具，桌面应用不可用时保持静默、不阻塞 Pi。发布产物 `dist/index.js` 已打包协议运行时，安装后无需额外 workspace 包。

配套的 Windows 桌面应用负责展示桌宠。[从 GitHub Releases 下载最新安装器](https://github.com/SchneeHertz/pi-deepseek-pet/releases/latest) 并安装。可手动启动；也可在桌面应用设置中单独启用 **随 Pi 联动启动和退出**，让本扩展在 Pi 启动时自动拉起桌宠，并在最后一个 Pi 进程退出后关闭。

安装：`pi install npm:pi-deepseek-pet-extension`；更新：`pi update npm:pi-deepseek-pet-extension`；卸载：`pi remove npm:pi-deepseek-pet-extension`。

完整扩展说明见 [PI_EXTENSION.md](https://github.com/SchneeHertz/pi-deepseek-pet/blob/main/docs/PI_EXTENSION.md)。

Pi DeepSeek Pet 由 [SchneeHertz](https://github.com/SchneeHertz) 维护，重构自 [PC2005-cloud/dsh-pet](https://github.com/PC2005-cloud/dsh-pet) 项目，感谢原作者与贡献者。
