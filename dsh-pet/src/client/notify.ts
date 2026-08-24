// 系统通知引擎（client 半侧）：订阅 DSH 事件流（mux + host），按「聚焦不弹」规则
// 发出系统级 toast（Web Notification API，Windows 为右下角原生通知）。
// 单一总开关：读 config.jsonc 的 notificationsEnabled；纯副作用模块，无 react 依赖，
// 由 app.ts 装配层启动。
//
// 触发清单（与 DSH 事件契约一一对应）：
//   - 对话完成：mux session/event → turn/end，reason.kind === 'completed'
//   - 生成失败：同上，reason.kind === 'error'（含无回合位置的 host/agent-error）
//   - 输出截断：同上，reason.kind === 'max-tokens'
//   - 权限申请：mux approval/requested
//   - 用户选择：mux question/requested
// 过滤：aborted / interrupted 不弹；重连重放的 approval/question 帧按 rpcId 去重。

import { assertClientConfig, stripJsonc } from './config';

// ---------- 聚焦门：仅在页面不可见/失焦时弹 ----------

let pageVisible = typeof document !== 'undefined' && !document.hidden;
let pageFocused = typeof document !== 'undefined' && document.hasFocus();

function refreshVisible(): void {
  pageVisible = !document.hidden;
}
function refreshFocused(): void {
  pageFocused = document.hasFocus();
}

/** 注册聚焦/可见性监听，返回解绑函数 */
function initFocusTracking(): () => void {
  if (typeof document === 'undefined') return () => {};
  document.addEventListener('visibilitychange', refreshVisible);
  window.addEventListener('focus', refreshFocused);
  window.addEventListener('blur', refreshFocused);
  return () => {
    document.removeEventListener('visibilitychange', refreshVisible);
    window.removeEventListener('focus', refreshFocused);
    window.removeEventListener('blur', refreshFocused);
  };
}

/** 用户是否在看本页（页面可见且持有焦点）——是则跳过通知 */
function isPageActive(): boolean {
  return pageVisible && pageFocused;
}

// ---------- 发送 ----------

const MAX_BODY = 80;

function truncate(text: string): string {
  return text.length > MAX_BODY ? text.slice(0, MAX_BODY) + '…' : text;
}

/** 发一条系统通知；环境不支持 / 未授权 / 聚焦本页 时静默跳过。
 * 日志（【弹窗】类型：内容）在两道门之后记录——只有真正发出通知时才记，被门拦下的触发不产生日志。 */
function toast(title: string, body?: string): void {
  if (isPageActive()) return;
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  console.log('【弹窗】' + title + (body ? '：' + body : ''));
  try {
    const opts: NotificationOptions = {};
    if (body) opts.body = truncate(body);
    new Notification(title, opts);
  } catch {
    /* 个别环境（e.g. 部分桌面壳）可能在构造时抛错：忽略，不打断业务 */
  }
}

/** 申请浏览器通知权限的结果：ok=true 已授予；ok=false 带失败原因（供设置页红字展示） */
export type PermissionResult =
  { ok: true } | { ok: false; reason: 'unsupported' | 'denied' | 'rejected' | 'error'; message?: string };

/** 申请浏览器通知权限。务必在用户手势（点击）下调用——无手势的自动申请可能被浏览器静默压制；
 * 失败时区分原因：unsupported=环境无 Notification、denied=浏览器已标记阻止、
 * rejected=用户在询问弹窗里选了阻止、error=申请过程异常/弹窗被跳过。 */
export async function requestNotificationPermission(): Promise<PermissionResult> {
  if (typeof Notification === 'undefined') return { ok: false, reason: 'unsupported' };
  if (Notification.permission === 'granted') return { ok: true };
  if (Notification.permission === 'denied') return { ok: false, reason: 'denied' };
  try {
    const p = await Notification.requestPermission();
    if (p === 'granted') return { ok: true };
    if (p === 'denied') return { ok: false, reason: 'rejected' };
    // 弹窗被直接关掉/未选择：浏览器仍是 default
    return { ok: false, reason: 'error', message: '权限未授予（' + p + '）' };
  } catch (e) {
    return { ok: false, reason: 'error', message: e instanceof Error ? e.message : String(e) };
  }
}

// ---------- 总开关：读 config.jsonc 的 notificationsEnabled ----------

/** 读取系统通知总开关；配置拉取/解析失败时不阻塞（默认开启） */
async function readNotificationsEnabled(): Promise<boolean> {
  try {
    const res = await fetch('/dsh-pet-7340/config.jsonc');
    if (!res.ok) return true;
    const cfg = assertClientConfig(JSON.parse(stripJsonc(await res.text())));
    return cfg.notificationsEnabled;
  } catch {
    return true;
  }
}

type Frame = { type: string; [k: string]: unknown };
type SessionEventLike = { type: string; data?: Record<string, unknown> };

// ---------- mux 流：会话事件 + 权限 + 问题 ----------

async function runMuxLoop(
  api: { events: { mux: (req: unknown, signal: AbortSignal) => AsyncIterable<{ rpcId: unknown; payload: Frame }> } },
  signal: AbortSignal,
): Promise<void> {
  // 重连时服务器会重放仍 pending 的 approval/question 帧（rpcId 保持不变）——按 rpcId 去重
  const seen = new Set<unknown>();
  for await (const env of api.events.mux({}, signal)) {
    const frame = env?.payload;
    if (!frame) continue;
    switch (frame.type) {
      case 'session/event': {
        const ev = (frame.event ?? {}) as SessionEventLike;
        if (ev.type !== 'turn/end') break;
        const reason = (ev.data?.reason ?? {}) as { kind?: string; error?: { message?: string } };
        const kind = reason.kind;
        if (kind === 'completed') toast('对话完成');
        else if (kind === 'error') toast('生成失败', reason.error?.message ?? '');
        else if (kind === 'max-tokens') toast('输出被截断', '已达到输出 token 上限');
        // aborted（用户/父代理取消）、interrupted（崩溃恢复）：不弹
        break;
      }
      case 'approval/requested': {
        if (seen.has(env.rpcId)) break;
        seen.add(env.rpcId);
        const toolName = String(frame.toolName ?? '');
        const reason = typeof frame.reason === 'string' && frame.reason ? (frame.reason as string) : '';
        toast('正在申请权限', (toolName ? '工具「' + toolName + '」' : '') + (reason ? '：' + reason : ''));
        break;
      }
      case 'question/requested': {
        if (seen.has(env.rpcId)) break;
        seen.add(env.rpcId);
        const q =
          (Array.isArray(frame.questions) && (frame.questions as Array<{ question?: string }>)[0]?.question) || '';
        toast('模型在等你回答', q);
        break;
      }
      default:
        break;
    }
  }
}

// ---------- host 流：无回合位置的失败 ----------

async function runHostLoop(
  api: { events: { host: (req: unknown, signal: AbortSignal) => AsyncIterable<{ rpcId: unknown; payload: Frame }> } },
  signal: AbortSignal,
): Promise<void> {
  for await (const env of api.events.host({}, signal)) {
    const frame = env?.payload;
    if (!frame) continue;
    if (frame.type === 'host/agent-error') {
      toast('生成失败', typeof frame.message === 'string' ? (frame.message as string) : '');
    }
  }
}

/**
 * 启动系统通知。总开关（config.jsonc notificationsEnabled）关闭时直接退出；
 * 开启时申请一次权限（若尚未决定），并行消费 mux + host 两条流。
 * 流关闭/出错即整体静默退出：DSH 连接层自身负责重连，页面刷新或下个 socket 代际会重新启动。
 */
export async function startNotify(
  api: {
    events: {
      mux: (req: unknown, signal: AbortSignal) => AsyncIterable<{ rpcId: unknown; payload: Frame }>;
      host: (req: unknown, signal: AbortSignal) => AsyncIterable<{ rpcId: unknown; payload: Frame }>;
    };
  },
  signal: AbortSignal,
): Promise<void> {
  const enabled = await readNotificationsEnabled();
  if (!enabled) return;
  void requestNotificationPermission(); // 兜底申请（无手势时浏览器可能压制；真正的申请在设置页开关点击处）
  const disposeFocus = initFocusTracking();
  try {
    await Promise.allSettled([runMuxLoop(api, signal), runHostLoop(api, signal)]);
  } finally {
    disposeFocus();
  }
}
