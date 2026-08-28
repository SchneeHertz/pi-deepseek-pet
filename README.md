# Pi DeepSeek Pet 🐾

Pi DeepSeek Pet 是一个独立的 Windows 桌面宠物，并通过本机 HTTP bridge 展示 [Pi](https://pi.dev) 的运行状态。

- 透明、无边框、置顶的 Electron 窗口
- 97 个 640×360 VP9 Alpha WebM 动画
- 待机随机链、转向、漫游、点击反馈、拖拽和气泡
- `thinking`、`responding`、`tool`、`waiting`、`compacting` 等 Pi 状态映射
- 仅监听 `127.0.0.1`、每次启动随机 Token、严格 Schema 的 `/api/v1`
- Pi 不可达或桌宠未启动时，扩展保持静默且不阻塞 Pi

## 架构

```text
Pi
 └─ pi-deepseek-pet-extension（生命周期归一化、心跳、重连）
      └─ HTTP/JSON → 127.0.0.1
           └─ pi-deepseek-pet-desktop（认证、状态源仲裁、Electron）
                └─ IPC → React + @pi-deepseek-pet/core
```

仓库采用 pnpm workspace：

- `apps/desktop`：Electron Main / sandboxed Preload / React Renderer
- `packages/protocol`：v1 DTO、Zod Schema、错误码
- `packages/pet-core`：无 DOM/Electron 依赖的动画控制器与移动几何
- `packages/pi-extension`：标准 Pi Package，不注册模型 tool
- `assets`：动画清单、WebM、字体与图片
- `media`：提示词、透明素材生产脚本和源视频目录

## 开发运行

要求 Node.js 20+ 与 pnpm 10：

```powershell
corepack enable
corepack prepare pnpm@10.12.1 --activate
pnpm install
pnpm build
pnpm dev
```

另开终端加载 Pi 扩展：

```powershell
pi -e ./packages/pi-extension/src/index.ts
```

> 本地 `-e` 前先执行 `pnpm build`，以生成 workspace 依赖的发布产物。

## 安装

### 桌面应用

发布构建：

```powershell
pnpm package:win
```

安装器输出到 `apps/desktop/release/`。应用可独立离线使用；不需要先启动 Pi。升级时直接运行新版安装器；卸载使用 Windows“设置 → 应用 → 已安装的应用 → Pi DeepSeek Pet”。卸载器保留 `~/.pi-deepseek-pet/` 中的用户设置，若不再需要可手动删除。

### Pi 扩展

开发安装（先执行 `pnpm build`）：

```powershell
pi install ./packages/pi-extension
```

生成自包含发布包，或从 npm 安装：

```powershell
pnpm package:extension
pi install npm:pi-deepseek-pet-extension
```

升级与卸载：

```powershell
pi update npm:pi-deepseek-pet-extension
pi remove npm:pi-deepseek-pet-extension
```

命令：`/pet-status`、`/pet-reconnect`、`/pet-test`、`/pet-enable`、`/pet-disable`。

## 隐私与安全

默认上报只包含：项目目录 basename、可选会话名、模型标识、thinking level、phase、工具名和活动工具数量。**不会上报** prompt、回复、完整 cwd、工具参数、工具结果或文件内容。

Bridge 描述文件位于 `~/.pi-deepseek-pet/bridge-v1.json`，包含短期连接 Token；请勿共享。控制 API 不开放局域网，不返回 CORS 许可，并拒绝浏览器 `Origin` 请求。

详见：

- [HTTP API](docs/HTTP_API.md)
- [Pi 扩展](docs/PI_EXTENSION.md)
- [开发指南](docs/DEVELOPMENT.md)
- [设计](DESIGN.md)
- [验收记录](docs/VALIDATION.md)

## 测试

```powershell
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm test:e2e
```

## 致谢与来源

本项目由 [SchneeHertz](https://github.com/SchneeHertz) 维护，基于 [PC2005-cloud/dsh-pet](https://github.com/PC2005-cloud/dsh-pet) 的原始桌宠插件、动画素材与制作工具重构而来。感谢原作者及贡献者提供初始实现和素材基础。

当前仓库将原插件重构为独立 Pi Desktop 应用和 Pi TypeScript 扩展；原项目的版权声明继续保留在 [LICENSE](LICENSE) 中。

## 许可

代码采用 [MIT](LICENSE)。动画、提示词、源视频与衍生视觉素材另见 [ASSET_LICENSE.md](ASSET_LICENSE.md)，默认仅允许非商业使用。设置页与发布文档必须保留该提示。

迁移前实现保存在 Git tag `legacy-dsh-plugin`，当前分支不包含其运行时代码或兼容层。
