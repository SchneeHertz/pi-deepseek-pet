import { useEffect, useState } from 'react';
import type { PetSettings } from '@pi-deepseek-pet/protocol';

export function SettingsView(): React.JSX.Element {
  const [settings, setSettings] = useState<PetSettings>();
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    void window.piPet.getBootstrap().then((bootstrap) => setSettings(bootstrap.settings));
    return window.piPet.subscribe((event) => {
      if (event.type === 'settings') setSettings(event.settings);
    });
  }, []);

  if (!settings) return <main className="settings-page">正在加载…</main>;

  const save = async (): Promise<void> => {
    const next = await window.piPet.updateSettings(settings);
    setSettings(next);
    setSaved(true);
    window.setTimeout(() => setSaved(false), 1_500);
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
          onChange={(launchAtLogin) => setSettings({ ...settings, launchAtLogin })}
        />
      </section>

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
