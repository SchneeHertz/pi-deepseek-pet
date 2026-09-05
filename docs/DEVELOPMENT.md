# 开发指南

## 环境

- Windows 10/11（首发验收平台）
- Node.js 20+
- pnpm 10.12.1
- Python 3 + ffmpeg（仅素材链需要）

```sh
corepack enable
corepack prepare pnpm@10.12.1 --activate
pnpm install
```

仓库只维护根目录一个 `pnpm-lock.yaml`。

## 常用命令

```sh
pnpm dev             # Electron + Vite
pnpm build           # protocol → core → extension → desktop
pnpm typecheck
pnpm lint
pnpm test            # unit + API integration
pnpm test:e2e        # 构建并启动真实 Electron
pnpm check           # format + typecheck + lint + unit + build
pnpm package:extension # 自包含 Pi Package tarball
pnpm package:win     # NSIS 安装器
```

所有测试临时文件写入根目录 `temp/`。

## Desktop 调试

`PI_DEEPSEEK_PET_ASSETS_DIR` 可覆盖开发素材目录；`PI_DEEPSEEK_PET_DATA_DIR` 可隔离 E2E 配置目录；`PI_DEEPSEEK_PET_BRIDGE_FILE` 可隔离 bridge 文件；`PI_DEEPSEEK_PET_LIFECYCLE_FILE` 可隔离 Pi 托管启动描述文件；`PI_DEEPSEEK_PET_ELECTRON_USER_DATA_DIR` 可隔离 Electron 单实例目录；`PI_CODING_AGENT_DIR` 可让 Desktop 测试写入隔离的 Pi 设置目录。正式用户不需要设置这些变量。

Desktop 发布包通过 `extraResources` 携带 `packages/pi-extension/dist/index.js`。Pi 集成脚本配置与联动启动分别同步：前者只增删自己管理的扩展路径，后者只管理生命周期描述文件。必须保留 `settings.json` 中其他字段和扩展；写入仍需临时文件 + rename。

Main 日志不得记录请求 body 或 Token。Renderer 无 Node 权限。新增 IPC 时必须同时：

1. 在 `src/shared.ts` 定义窄类型；
2. Preload 暴露具体方法而非通用 `send/invoke`；
3. Main 校验 sender 与 payload；
4. 添加单元或 E2E 覆盖。

## Protocol 变更

v1 请求使用严格 Schema。新增字段会改变未知字段拒绝行为，因此必须：

1. 先修改 `@pi-deepseek-pet/protocol` 和 fixture；
2. 补充双端测试与 `HTTP_API.md`；
3. 保持旧 v1 字段语义，破坏性变更使用 `/api/v2`；
4. 最后修改 Desktop 与扩展。

## 素材链

源目录位于 `media/`：

```sh
cd media/scripts
python watermark_step01.py
python chroma_step02.py          # 或 pr_import_step02.py
python normalize_step03.py
python encode_thumbs.py
python encode_preview_gifs.py
```

`encode_thumbs.py` 的最终输出是 `assets/animations/webm/`。修改清单后运行测试，确保所有清单引用与 97 个文件一致。桌面运行时只支持 VP9 Alpha WebM。

## 发布

发布前执行：

```sh
pnpm check
pnpm test:e2e
pnpm package:extension
pnpm package:win
```

发布 workflow 会上传 NSIS `.exe` 与 Pi Package `.tgz`。同时检查：安装包启动、透明度/点击穿透、多显示器与 DPI、bridge 清理、扩展离线行为、`ASSET_LICENSE.md` 展示和第三方字体/素材许可证。
