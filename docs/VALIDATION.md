# Pi DeepSeek Pet 验收记录

## 自动化基线

- Protocol：严格字段、版本、phase、文本边界、bridge loopback。
- Pet Core：权重、noMirror、移动边界、优先级、事件回退、拖拽恢复、generation。
- Desktop API：认证、Origin、body 上限、动画白名单、sequence、TTL、多 source。
- Bridge/设置：原子替换、实例所有权、持久化校验。
- Pi Mapper：stream 降频、并行工具、waiting、compaction、agent_settled。
- Transport：快照合并、事件上限、退避、bridge 重载、Desktop 重启恢复。
- Electron E2E：真实透明窗口、WebM 流式资源、认证 API → Renderer 气泡、IPC 拖拽、位置保存/重置、退出清理。

执行命令：

```text
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm test:e2e
pnpm package:extension
pnpm package:win
```

## 本次自动验收结果

- `pnpm check`：format、typecheck、lint、10 个测试文件 / 50 个测试、四个 workspace build 全部通过。
- `pnpm test:e2e`：真实 Electron 测试通过，动画可播放，bridge 退出后清理。
- Pi Package：生成约 30 KB 的自包含 `.tgz`；解包后可直接 import，并由真实 Pi `0.84.3` 通过 `-e dist/index.js` 加载。
- Windows NSIS：生成约 159 MB 安装器；已完成静默安装 → 启动已安装应用 → WebM 就绪 → `/api/v1/health` 200 → 静默卸载烟测。
- 安装内容：97 个 WebM、代码许可证和素材许可证均存在；两个应用图标为 512×512。
- `pnpm licenses list --prod`：生产依赖许可证均为 MIT；素材继续受 `ASSET_LICENSE.md` 的非商业限制。
- 残留审计：仅一个根 `pnpm-lock.yaml`；无 `@deepseek-ai/*`、Cordis、DSH Loader 运行时、MOV/HEVC 运行时文件。

## Windows 手工发布清单

- [ ] 点击五次无黑帧，旧动画不覆盖新动画。
- [ ] 拖拽超过 5px 播放悬空反馈，松手后随机链恢复。
- [ ] 透明命中框外可点击下方窗口。
- [ ] 右键菜单、托盘、大小、置顶、环境动作、设置和退出正常。
- [ ] 断开一个显示器或改变 DPI 后窗口仍可见。
- [ ] Desktop 先启动、后启动和运行中重启时扩展均恢复。
- [ ] 两个 Pi 会话同时 busy 时选择稳定，固定 source 生效。
- [ ] Pi `/reload`、`/new`、`/resume`、`/fork` 后无旧 heartbeat/timer。
- [ ] 真实完成、错误、取消、截断、并行工具和 compaction 映射正确。
- [ ] 安装器、设置页和发布说明保留素材非商业许可提示。

自动测试不能完全证明透明点击穿透、DPI 和不同 GPU 的 VP9 Alpha 表现，发布签名前必须在目标 Windows 机器完成上述手工项。
