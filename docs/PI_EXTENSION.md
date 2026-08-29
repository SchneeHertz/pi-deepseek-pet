# Pi DeepSeek Pet Extension

`packages/pi-extension` 是标准事件型 Pi Package。它不注册 LLM tool，不修改系统提示，也不依赖 TUI。

## 安装

仓库开发：

```sh
pnpm install
pnpm build
pi -e ./packages/pi-extension/src/index.ts
```

本地持久安装（先执行 `pnpm build`，安装入口为已构建的 `dist/index.js`）：

```sh
pi install ./packages/pi-extension
```

自包含发布包与 npm 安装：

```sh
pnpm package:extension
pi install npm:pi-deepseek-pet-extension
```

发布 tarball 已内联 protocol/Zod 运行时代码，不要求用户另装 workspace package。升级与卸载：

```sh
pi update npm:pi-deepseek-pet-extension
pi remove npm:pi-deepseek-pet-extension
```

项目本地安装遵循 Pi project trust；全局安装对所有项目生效。移除扩展不影响桌宠离线运行，关闭或卸载桌宠也不影响 Pi。

## 生命周期

- Factory：只注册事件和命令，不启动 timer、watcher 或 socket。
- `session_start`：生成随机 sourceId，创建 transport，启动 10 秒心跳并发送 idle 快照。
- `agent_start`：thinking。
- thinking/text stream：只在 phase 变化时发送，不发送 delta。
- tool start/end：以 toolCallId Map 支持并行工具；ask 类工具进入 waiting。
- compaction：compacting，成功后按 agent 是否活跃恢复，失败发安全事件并恢复旧 phase。
- `agent_end`：只记录 stopReason。
- `agent_settled`：发送 completed/failed/cancelled/truncated/attention，再回 idle。
- `session_shutdown`：停止 timer、取消请求，并在短超时内尽力 DELETE source。

这保证自动 retry、overflow compaction、steering 和 follow-up 不会提前显示“完成”。

## 可靠性

- HTTP 超时默认 450ms；事件 handler 仅入队并立即返回。
- Bridge 请求通过 `node:http` 直连 `127.0.0.1`，不继承 Pi/Undici 的 provider 全局代理。
- 状态首条立即发送，后续快照先经过 150ms 收敛窗口且至少间隔 1.5 秒；冷却期只保留最新快照，避免短暂 phase 让动画连续重启，也不会积压过时动作。
- 瞬时事件独立排队，最多 20 条、保留 2 分钟；source 已注册时不受状态冷却阻塞。
- 退避：1s → 2s → 5s → 10s → 30s。
- 每次尝试重读 bridge 文件。
- Desktop 实例变化时先重发当前完整快照，再补投事件。
- 默认不记录连接错误；`PI_DEEPSEEK_PET_DEBUG=1` 最多每 30 秒输出一次脱敏诊断。

## 命令

| 命令             | 用途                                |
| ---------------- | ----------------------------------- |
| `/pet-status`    | bridge、连接、phase、队列和最近错误 |
| `/pet-reconnect` | 清除退避并立即重读 bridge           |
| `/pet-test`      | 发送测试完成事件                    |
| `/pet-enable`    | 启用本进程上报                      |
| `/pet-disable`   | 禁用本进程上报并删除 source         |

命令只在 `ctx.hasUI` 时通知；核心传输适用于 TUI、RPC、JSON 和 print 模式。

## 故障排查

旧版扩展若在启用 provider HTTP 代理时显示 `desktop API returned HTTP 502`，通常是全局代理误接管了回环请求。升级扩展后执行 `/reload` 或重启 Pi，再运行 `/pet-reconnect`。临时方案是在启动 Pi 前设置 `NO_PROXY=127.0.0.1,localhost`。

## 环境变量

- `PI_DEEPSEEK_PET_BRIDGE_FILE`：覆盖 bridge 路径。
- `PI_DEEPSEEK_PET_DISABLED=1`：本进程默认禁用。
- `PI_DEEPSEEK_PET_DEBUG=1`：开启限频脱敏诊断。

## 隐私

上报字段只有 phase、项目 basename、可选会话显示名、模型 provider/id、thinking level、工具名和活动工具数。不会读取或发送 prompt、回复、完整 cwd、会话文件路径、tool args/result 或文件内容。
