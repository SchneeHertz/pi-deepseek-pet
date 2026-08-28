# Pi DeepSeek Pet HTTP API v1

## 连接发现

Desktop 只监听 `127.0.0.1`。默认尝试端口 `17340`，冲突时使用随机空闲端口。成功后写入：

```text
~/.pi-deepseek-pet/bridge-v1.json
```

```json
{
  "schemaVersion": 1,
  "baseUrl": "http://127.0.0.1:17340",
  "token": "<64 个十六进制字符>",
  "appInstanceId": "<uuid>",
  "pid": 12345,
  "createdAt": "2026-01-01T00:00:00.000Z"
}
```

Token 每次启动变化。客户端每次重连都必须重读文件，不应缓存到磁盘、日志或项目配置中。`PI_DEEPSEEK_PET_BRIDGE_FILE` 可覆盖文件位置。

## 通用要求

除 `GET /api/v1/health` 外：

```http
Authorization: Bearer <token>
```

PUT/POST/PATCH body 还必须使用 `Content-Type: application/json`。请求体最大 16KB。未知字段、控制字符、旧协议版本和非法枚举值均被拒绝。

统一错误：

```json
{
  "error": {
    "code": "INVALID_REQUEST",
    "message": "body: validation summary",
    "requestId": "uuid"
  }
}
```

主要状态码：`400`、`401`、`403`、`404`、`409`、`413`、`415`、`429`、`500`。

## 路由

| 方法   | 路径                                  | 说明                                    |
| ------ | ------------------------------------- | --------------------------------------- |
| GET    | `/api/v1/health`                      | 无秘密的版本与实例健康信息              |
| GET    | `/api/v1/state`                       | 当前展示、source 诊断和设置             |
| GET    | `/api/v1/animations`                  | 实际可用动画与状态池                    |
| PUT    | `/api/v1/sources/:sourceId/state`     | 持续状态快照                            |
| POST   | `/api/v1/sources/:sourceId/heartbeat` | 延长 TTL                                |
| POST   | `/api/v1/sources/:sourceId/events`    | 瞬时事件                                |
| DELETE | `/api/v1/sources/:sourceId`           | 正常下线                                |
| POST   | `/api/v1/pet/actions`                 | 手动动作、气泡、显隐、位置和固定 source |
| PATCH  | `/api/v1/pet/settings`                | 修改允许的持久化设置                    |

`sourceId` 为 1–64 位字母、数字、下划线或连字符，不能使用会话路径。

## 持续状态

```json
{
  "protocolVersion": 1,
  "sequence": 42,
  "sentAt": "2026-01-01T00:00:00.000Z",
  "phase": "tool",
  "source": {
    "kind": "pi",
    "label": "Pi",
    "projectName": "my-project"
  },
  "model": {
    "provider": "openai",
    "id": "gpt-5.4",
    "thinkingLevel": "high"
  },
  "activity": {
    "toolName": "edit",
    "activeToolCount": 2
  }
}
```

Phase：`idle | thinking | responding | tool | waiting | compacting`。同一状态 sequence 和内容可安全重试；更旧或同 sequence 不同内容返回 `409`。

## 心跳

```json
{
  "protocolVersion": 1,
  "sentAt": "2026-01-01T00:00:10.000Z"
}
```

未知 source 返回 `404`，客户端应重新发送完整快照。30 秒无心跳变为 offline，60 秒移除。

## 瞬时事件

```json
{
  "protocolVersion": 1,
  "eventId": "194c3884-26fb-453f-a66c-a0209b5f0880",
  "sequence": 43,
  "occurredAt": "2026-01-01T00:00:01.000Z",
  "type": "tool_failed",
  "metadata": { "toolName": "edit" }
}
```

类型：`completed | failed | cancelled | truncated | tool_failed | attention`。事件短期按 `eventId` 去重。

## 手动动作

```json
{ "type": "play", "animation": "点击回应-开心跃动" }
{ "type": "bubble", "text": "测试气泡", "durationMs": 5000 }
{ "type": "set-visibility", "visible": true }
{ "type": "reset-position" }
{ "type": "pin-source", "sourceId": null }
```

动画必须来自 `/animations`。气泡最长 240 字符，时长 500–30000ms。

## 设置

可 PATCH 字段：

```json
{
  "size": 462,
  "alwaysOnTop": true,
  "ambientActions": true,
  "bubblesEnabled": true,
  "launchAtLogin": false,
  "pinnedSourceId": null,
  "position": null
}
```

`position` 也可为 `{ "displayId": "...", "xRatio": 0.8, "yRatio": 0.2 }`。

## PowerShell 示例

```powershell
$bridge = Get-Content "$HOME/.pi-deepseek-pet/bridge-v1.json" | ConvertFrom-Json
$headers = @{ Authorization = "Bearer $($bridge.token)" }
Invoke-RestMethod "$($bridge.baseUrl)/api/v1/state" -Headers $headers

$body = @{ type = "bubble"; text = "Hello Pi DeepSeek Pet"; durationMs = 3000 } | ConvertTo-Json
Invoke-RestMethod "$($bridge.baseUrl)/api/v1/pet/actions" -Method Post `
  -Headers $headers -ContentType "application/json" -Body $body
```
