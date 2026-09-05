import { useEffect, useState } from 'react';
import type { PetSettings } from '@pi-deepseek-pet/protocol';
import type { PiIntegrationStatus } from '../shared.js';

export function SettingsView(): React.JSX.Element {
  const [settings, setSettings] = useState<PetSettings>();
  const [piIntegration, setPiIntegration] = useState<PiIntegrationStatus>();
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string>();

  useEffect(() => {
    void window.piPet.getBootstrap().then((bootstrap) => {
      setSettings(bootstrap.settings);
      setPiIntegration(bootstrap.piIntegration);
    });
    return window.piPet.subscribe((event) => {
      if (event.type === 'settings') setSettings(event.settings);
      if (event.type === 'pi-integration') setPiIntegration(event.status);
    });
  }, []);

  if (!settings) return <main className="settings-page">正在加载…</main>;

  const save = async (): Promise<void> => {
    setSaveError(undefined);
    try {
      const next = await window.piPet.updateSettings(settings);
      setSettings(next);
      setSaved(true);
      window.setTimeout(() => setSaved(false), 1_500);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <main className="settings-page" data-testid="settings-view">
      <header>
        <img src="./icon.png" alt="" onError={(event) => (event.currentTarget.style.display = 'none')} />
        <div>
          <h1>Pi DeepSeek Pet 设置</h1>
          <p>本机状态仅通过 127.0.0.1 接收。</p>
        </div>
      </header>

      <section>
        <label htmlFor="pet-size">桌宠宽度：{settings.size}px</label>
        <input
          id="pet-size"
          type="range"
          min="160"
          max="800"
          step="2"
          value={settings.size}
          onChange={(event) => setSettings({ ...settings, size: Number(event.currentTarget.value) })}
        />
      </section>

      <section className="pi-integration-section">
        <h2>Pi 集成</h2>
        <div className="integration-part">
          <Toggle
            label="随 Pi 联动启动和退出"
            checked={settings.manageWithPi}
            onChange={(manageWithPi) =>
              setSettings({
                ...settings,
                manageWithPi,
                launchAtLogin: manageWithPi ? false : settings.launchAtLogin,
              })
            }
          />
          <p className="setting-help">
            保存后允许 Pi 启动桌宠，并在最后一个 Pi 退出时关闭由 Pi 启动的桌宠。此功能需要 Pi 已加载集成脚本。
          </p>
          {piIntegration?.launch.state === 'enabled' && <p className="integration-status success">联动启动已配置</p>}
          {piIntegration?.launch.state === 'error' && (
            <p className="integration-status error">联动启动配置失败：{piIntegration.launch.message}</p>
          )}
        </div>
        <div className="integration-part">
          <Toggle
            label="自动配置 Pi 集成脚本"
            checked={settings.configurePiExtension}
            onChange={(configurePiExtension) => setSettings({ ...settings, configurePiExtension })}
          />
          <p className="setting-help">
            将内置扩展加入 Pi 全局设置；若已安装 Pi Package 则直接复用。此项只负责状态连接，不改变桌宠启动方式。已运行的
            Pi 可执行 <code>/reload</code>，否则下次启动生效。
          </p>
          {piIntegration?.extension.state === 'enabled' && (
            <p className="integration-status success">
              集成脚本已配置（
              {piIntegration.extension.extensionSource === 'package' ? '现有 Pi Package' : '内置扩展'}）
            </p>
          )}
          {piIntegration?.extension.state === 'error' && (
            <p className="integration-status error">集成脚本配置失败：{piIntegration.extension.message}</p>
          )}
        </div>
      </section>

      <section className="toggle-list">
        <Toggle
          label="始终置顶"
          checked={settings.alwaysOnTop}
          onChange={(alwaysOnTop) => setSettings({ ...settings, alwaysOnTop })}
        />
        <Toggle
          label="启用环境随机动作"
          checked={settings.ambientActions}
          onChange={(ambientActions) => setSettings({ ...settings, ambientActions })}
        />
        <Toggle
          label="显示状态气泡"
          checked={settings.bubblesEnabled}
          onChange={(bubblesEnabled) => setSettings({ ...settings, bubblesEnabled })}
        />
        <Toggle
          label="登录后自动启动"
          checked={settings.launchAtLogin}
          onChange={(launchAtLogin) =>
            setSettings({
              ...settings,
              launchAtLogin,
              manageWithPi: launchAtLogin ? false : settings.manageWithPi,
            })
          }
        />
      </section>

      {saveError && <p className="save-error">保存失败：{saveError}</p>}
      <div className="settings-actions">
        <button type="button" className="secondary" onClick={() => setSettings({ ...settings, position: null })}>
          恢复默认位置
        </button>
        <button type="button" className="primary" onClick={() => void save()}>
          {saved ? '已保存' : '保存'}
        </button>
      </div>
      <button type="button" className="close-button" onClick={() => window.piPet.closeSettings()}>
        关闭
      </button>
      <footer>
        不会保存 prompt、回复、工具参数或完整项目路径。动画素材仅限非商业使用，详见 ASSET_LICENSE.md。
        <br />由 SchneeHertz 维护；基于 PC2005-cloud/dsh-pet 重构，感谢原作者与贡献者。
      </footer>
    </main>
  );
}

function Toggle(props: { label: string; checked: boolean; onChange: (checked: boolean) => void }): React.JSX.Element {
  return (
    <label className="toggle-row">
      <span>{props.label}</span>
      <input
        type="checkbox"
        checked={props.checked}
        onChange={(event) => props.onChange(event.currentTarget.checked)}
      />
    </label>
  );
}
