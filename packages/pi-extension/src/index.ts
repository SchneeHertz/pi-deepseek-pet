import { randomUUID } from 'node:crypto';
import { basename } from 'node:path';
import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import { PiDesktopLifecycle } from './desktop-lifecycle.js';
import { PiStatusMapper, createSafeSource, type PiStopReason } from './status-mapper.js';
import { PiPetTransport } from './transport.js';

export default function piPetExtension(pi: ExtensionAPI): void {
  let transport: PiPetTransport | undefined;
  let mapper: PiStatusMapper | undefined;
  const desktopLifecycle = new PiDesktopLifecycle({
    bridgeFile: process.env.PI_DEEPSEEK_PET_BRIDGE_FILE,
    lifecycleFile: process.env.PI_DEEPSEEK_PET_LIFECYCLE_FILE,
    debug: process.env.PI_DEEPSEEK_PET_DEBUG === '1',
  });

  const notify = (ctx: ExtensionContext, message: string, level: 'info' | 'warning' | 'error' = 'info'): void => {
    if (ctx.hasUI) ctx.ui.notify(message, level);
  };

  pi.on('session_start', async (_event, ctx) => {
    const previousTransport = transport;
    transport = undefined;
    mapper = undefined;
    await previousTransport?.stop();
    await desktopLifecycle.ensureStarted();

    const sourceId = randomUUID();
    transport = new PiPetTransport({
      sourceId,
      bridgeFile: process.env.PI_DEEPSEEK_PET_BRIDGE_FILE,
      debug: process.env.PI_DEEPSEEK_PET_DEBUG === '1',
    });
    mapper = new PiStatusMapper({
      sink: transport,
      source: createSafeSource(basename(ctx.cwd), pi.getSessionName()),
      model: ctx.model
        ? { provider: ctx.model.provider, id: ctx.model.id, thinkingLevel: ctx.thinkingLevel }
        : undefined,
    });
    transport.start();
    mapper.start();
  });

  pi.on('session_info_changed', (event) => mapper?.setSessionName(event.name));
  pi.on('model_select', (event, ctx) => mapper?.setModel(event.model.provider, event.model.id, ctx.thinkingLevel));
  pi.on('thinking_level_select', (event) => mapper?.setThinkingLevel(event.level));
  pi.on('agent_start', () => mapper?.agentStart());
  pi.on('message_update', (event) => mapper?.messageUpdate(event.assistantMessageEvent.type));
  pi.on('tool_execution_start', (event) => mapper?.toolStart(event.toolCallId, event.toolName));
  pi.on('tool_execution_end', (event) => mapper?.toolEnd(event.toolCallId, event.toolName, event.isError));
  pi.on('session_before_compact', () => mapper?.beforeCompact());
  pi.on('session_compact', () => mapper?.compacted());
  pi.on('session_compact_failed', (event) => mapper?.compactFailed(event.aborted));
  pi.on('agent_end', (event) => {
    const assistant = [...event.messages]
      .reverse()
      .find((message) => 'role' in message && message.role === 'assistant');
    mapper?.agentEnd(assistant && 'stopReason' in assistant ? (assistant.stopReason as PiStopReason) : undefined);
  });
  pi.on('agent_settled', () => mapper?.agentSettled());

  pi.on('session_shutdown', async (event) => {
    const current = transport;
    transport = undefined;
    mapper = undefined;
    const quitDesktopIfIdle = event.reason === 'quit' && (await desktopLifecycle.isEnabled());
    await current?.stop({ quitDesktopIfIdle });
  });

  pi.registerCommand('pet-status', {
    description: '显示 Pi DeepSeek Pet bridge 与队列状态',
    handler: async (_args, ctx) => {
      const status = transport?.diagnostics;
      if (!status) {
        notify(ctx, 'Pi DeepSeek Pet transport 尚未启动', 'warning');
        return;
      }
      const summary = [
        status.connected ? '已连接' : '未连接',
        status.enabled ? '已启用' : '已禁用',
        `phase=${mapper?.phase ?? 'unknown'}`,
        `queue=${Number(status.stateQueued) + status.eventQueueLength}`,
        `bridge=${status.bridgeFile}`,
        status.lastError ? `error=${status.lastError}` : undefined,
      ]
        .filter(Boolean)
        .join(' · ');
      notify(ctx, summary, status.connected ? 'info' : 'warning');
    },
  });

  pi.registerCommand('pet-reconnect', {
    description: '立即重新读取 Pi DeepSeek Pet bridge 文件并重连',
    handler: async (_args, ctx) => {
      transport?.forceReconnect();
      mapper?.resend();
      notify(ctx, '已请求 Pi DeepSeek Pet 立即重连');
    },
  });

  pi.registerCommand('pet-test', {
    description: '发送一次 Pi DeepSeek Pet 测试完成事件',
    handler: async (_args, ctx) => {
      mapper?.emitEvent('completed', { code: 'manual_test' });
      notify(ctx, '已发送 Pi DeepSeek Pet 测试事件');
    },
  });

  pi.registerCommand('pet-enable', {
    description: '启用本 Pi 进程的 Pi DeepSeek Pet 状态上报',
    handler: async (_args, ctx) => {
      await desktopLifecycle.ensureStarted();
      transport?.enable();
      mapper?.resend();
      notify(ctx, 'Pi DeepSeek Pet 状态上报已启用');
    },
  });

  pi.registerCommand('pet-disable', {
    description: '禁用本 Pi 进程的 Pi DeepSeek Pet 状态上报',
    handler: async (_args, ctx) => {
      await transport?.disable();
      notify(ctx, 'Pi DeepSeek Pet 状态上报已禁用');
    },
  });
}
