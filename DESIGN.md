# Pi DeepSeek Pet 设计与实现

## 1. 产品边界

Pi DeepSeek Pet 由两个单向协作的产品组成：独立 Electron 桌面应用和 Pi TypeScript 扩展。扩展只观测状态，桌面应用不会向 Pi 提交 prompt、执行工具或反向控制会话。

桌面应用在没有 Pi 时仍运行随机动画；扩展在桌面应用离线时不阻塞、不抛出未处理异常，也不持续刷日志。

## 2. 进程边界

```text
Pi Extension
  ├─ PiStatusMapper：生命周期 → phase/event
  └─ PiPetTransport：快照合并、事件队列、心跳、退避
          │ HTTP / Bearer / JSON
Electron Main
  ├─ PetApiServer：回环、安全边界、Schema、限流
  ├─ SourceRegistry：sequence、TTL、多源仲裁
  ├─ PetWindowManager：窗口、显示器、位置、漫游
  └─ pet-asset://：清单白名单与 Range 响应
          │ 窄 IPC
Sandboxed Preload
          │
React Renderer
  ├─ PetController（@pi-deepseek-pet/core）
  └─ 双 video 缓冲、气泡、点击与拖拽
```

Main 启用 `contextIsolation`，关闭 `nodeIntegration`，Preload 使用 sandbox，只暴露明确的窗口交互和状态订阅方法。Renderer 无文件系统、Shell、任意 IPC 或 HTTP Server 权限。

## 3. 动画状态机

优先级固定为：

```text
拖拽 > HTTP 手动动作 > 点击 > Pi 瞬时事件 > Pi 持续状态 > 空闲随机链
```

`PetController` 保存最新持续状态。高优先级动作结束后回到最新状态，而不是无条件 idle；拖拽释放先播放一次待机缓冲，再恢复状态链。每次播放分配 generation，旧 video 的 `loadeddata`/`ended`/`error` 回调不能覆盖新状态。

`offline` 和 `idle` 在环境动作开启时共用待机随机链。分类动作结束后先强制插入一次待机呼吸动画，再继续随机。任何 idle（包括初始状态、拖拽缓冲、随机抽取和强制插入）结束后，下一次随机都不会再抽到 idle，权重会重新归一化到 turn/move/category，避免连续播放 idle。

所有随机源与时钟都可注入，因此权重、过滤、优先级和竞态测试可重复。Core 不导入 DOM、React 或 Electron。

## 4. 本机协议

API 只绑定 `127.0.0.1`。除 health 外，路由要求启动期随机 256-bit Bearer Token。描述文件通过同目录临时文件和 rename 原子替换，退出时仅删除当前 `appInstanceId` 所有的文件。

安全层包括：

- 严格 Zod Schema 与未知字段拒绝
- 16KB 请求上限、JSON-only body、请求限流
- 拒绝浏览器 Origin，不返回 CORS
- 动画清单白名单，不拼接调用方文件路径
- 气泡长度、控制字符和时长限制
- 日志仅包含 request ID、方法、路径和状态，不包含 Token 或载荷

## 5. 状态源与一致性

每个扩展会话生成随机 `sourceId`。状态快照幂等，旧快照不能覆盖新快照；事件按 `eventId` 去重。官方扩展使用同一个单调 sequence，Desktop 分别维护状态流和事件流的水位，从而允许重连时先恢复最新快照、再补投仍有效的瞬时事件。

持续状态使用 latest-wins 节拍：首条立即发送，后续快照先经过 150ms 收敛窗口且至少间隔 1.5 秒，冷却期内反复变化只发送最后一个 phase。这样每段状态动画都有可感知的播放时间，同时不会把已经过时的中间动作排成长队。瞬时事件仍使用独立 FIFO；source 已注册时，同批事件会先投递，尾随状态不会在事件动画前制造一次无意义切换。

10 秒心跳，30 秒离线，60 秒移除。固定 source 优先；否则选择最近进入 busy 的 source，全部 idle 时选择最近心跳。2 秒选择冷却避免多个忙碌会话高速闪烁。

## 6. 资源与持久化

WebM 通过 `extraResources` 放在 asar 外。`pet-asset://animation/` 仅接受清单中且实际存在的文件，支持 byte Range。缺少映射资源会在启动时报告；单个文件运行时失败时，Controller 标记不可用并回退待机。

`~/.pi-deepseek-pet/config.json` 保存大小、置顶、环境动作、气泡、登录启动、固定 source 和归一化显示器位置，不保存活动历史或 Pi 内容。

## 7. 扩展生命周期

Factory 只注册事件和命令。`session_start` 创建 mapper/transport/heartbeat；`session_shutdown` 停止 timer、取消请求并尽力删除 source。完成事件只来自 `agent_settled`，不来自可能继续 retry、compact 或 follow-up 的 `agent_end`。并行工具以 `toolCallId` Map 维护。

## 8. 平台与发布

Windows 是首发平台。透明窗口、点击穿透、多显示器/DPI、托盘和 VP9 Alpha 在 Windows 验收。平台差异集中在 Main 的窗口适配层。安装包只在 release workflow 构建，不包含自动更新功能。
