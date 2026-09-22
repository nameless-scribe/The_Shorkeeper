import { useCallback, useEffect, useState } from 'react';
import type { ErpConnectionInfo, ErpSettingsInfo, ErpSettingsPatch } from '@/shared/types';
import {
  SETTINGS_INPUT_CLASS,
  SETTINGS_SELECT_CLASS,
  SettingsBadge,
  SettingsErrorBanner,
  SettingsField,
  SettingsInlineActions,
  SettingsIntro,
  SettingsLoading,
  SettingsPageShell,
  SettingsPanel,
  SettingsPrimaryButton,
  SettingsSecondaryButton,
} from './components/settings-ui';
import { SettingsToggle } from './components/SettingsToggle';

interface ErpForm {
  enabled: boolean;
  origin: string;
  apiPrefix: string;
  browserChannel: 'msedge' | 'chrome';
  username: string;
  password: string;
}

function formFromSettings(settings: ErpSettingsInfo): ErpForm {
  return { ...settings, password: '' };
}

export function ErpPage() {
  const [settings, setSettings] = useState<ErpSettingsInfo | null>(null);
  const [form, setForm] = useState<ErpForm | null>(null);
  const [connection, setConnection] = useState<ErpConnectionInfo | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [nextSettings, nextConnection] = await Promise.all([
      window.shorekeeper.erp.getSettings(), window.shorekeeper.erp.status(),
    ]);
    setSettings(nextSettings);
    setForm(formFromSettings(nextSettings));
    setConnection(nextConnection);
  }, []);

  useEffect(() => { load().catch((reason) => setError(reason instanceof Error ? reason.message : '读取 ERP 设置失败')); }, [load]);

  const run = async (label: string, operation: () => Promise<ErpConnectionInfo>) => {
    setBusy(label); setError(null); setNotice(null);
    try {
      const value = await operation();
      setConnection(value); setNotice(value.message);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : `${label}失败`);
    } finally { setBusy(null); }
  };

  const save = async () => {
    if (!form) return;
    setBusy('save'); setError(null); setNotice(null);
    const patch: ErpSettingsPatch = { ...form, password: form.password || undefined };
    try {
      const value = await window.shorekeeper.erp.saveSettings(patch);
      setSettings(value); setForm(formFromSettings(value));
      setConnection(await window.shorekeeper.erp.status());
      setNotice('ERP 设置已保存');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '保存 ERP 设置失败');
    } finally { setBusy(null); }
  };

  if (!settings || !form || !connection) return <SettingsLoading />;
  const connected = connection.state !== 'disconnected';

  return (
    <SettingsPageShell>
      <SettingsIntro>
        守岸人会在独立的可见浏览器中打开 ERP。账号密码只在主进程中使用；已启用看图能力时会尝试识别算术验证码，识别失败则保留窗口供你接管。提交报工前仍会展示日期、任务、工时和内容供你确认。
      </SettingsIntro>
      {error && <SettingsErrorBanner message={error} />}
      {notice && <div className="rounded-xl border border-keeper-cyan/20 bg-keeper-cyan/5 px-3 py-2 text-xs text-keeper-ice/75">{notice}</div>}

      <SettingsPanel
        title="ERP 报工"
        subtitle="当前仅开放连接与只读核对；写入会在完整确认链路通过后启用"
        icon="🧾"
        badge={<SettingsBadge tone={settings.enabled ? 'green' : 'muted'}>{settings.enabled ? '已开启' : '未开启'}</SettingsBadge>}
      >
        <div className="flex items-center justify-between gap-4 rounded-xl border border-keeper-silver/10 bg-keeper-navyDeep/30 px-3 py-2.5">
          <div><p className="text-sm text-keeper-ice/85">启用 ERP 报工</p><p className="text-[11px] text-keeper-ice/40">关闭时 Agent 和连接入口都不会操作 ERP</p></div>
          <SettingsToggle checked={form.enabled} disabled={busy !== null} onChange={(enabled) => setForm({ ...form, enabled })} />
        </div>
        <SettingsField label="ERP 站点" hint="只保存站点 origin，不允许查询参数、片段或内嵌凭据">
          <input className={SETTINGS_INPUT_CLASS} value={form.origin} onChange={(event) => setForm({ ...form, origin: event.target.value })} placeholder="http://49.7.10.65:9024" />
        </SettingsField>
        <div className="grid gap-3 sm:grid-cols-2">
          <SettingsField label="浏览器">
            <select className={SETTINGS_SELECT_CLASS} value={form.browserChannel} onChange={(event) => setForm({ ...form, browserChannel: event.target.value as 'msedge' | 'chrome' })}>
              <option value="msedge">Microsoft Edge</option><option value="chrome">Google Chrome</option>
            </select>
          </SettingsField>
          <SettingsField label="API 前缀" hint="当前 ERP 生产环境为 /prod-api">
            <input className={SETTINGS_INPUT_CLASS} value={form.apiPrefix} onChange={(event) => setForm({ ...form, apiPrefix: event.target.value })} />
          </SettingsField>
        </div>
        <SettingsField label="账号">
          <input className={SETTINGS_INPUT_CLASS} value={form.username} onChange={(event) => setForm({ ...form, username: event.target.value })} autoComplete="off" />
        </SettingsField>
        <SettingsField label="密码" hint={settings.passwordConfigured ? '密码已加密保存；留空则不修改' : '可留空并在专用浏览器中人工输入'}>
          <input type="password" className={SETTINGS_INPUT_CLASS} value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} placeholder={settings.passwordConfigured ? '已配置，留空不修改' : '可选'} autoComplete="new-password" />
        </SettingsField>
        <SettingsPrimaryButton className="w-full" disabled={busy !== null} onClick={() => void save()}>{busy === 'save' ? '保存中…' : '保存设置'}</SettingsPrimaryButton>
      </SettingsPanel>

      <SettingsPanel title="专用浏览器" subtitle={connection.message} icon="🌐" badge={<SettingsBadge tone={connection.state === 'authenticated' ? 'green' : connected ? 'amber' : 'muted'}>{connection.state === 'authenticated' ? '已登录' : connected ? '等待登录' : '未连接'}</SettingsBadge>}>
        <SettingsInlineActions>
          <SettingsPrimaryButton disabled={busy !== null || !settings.enabled || !settings.configured} onClick={() => void run('connect', () => window.shorekeeper.erp.connect())}>{busy === 'connect' ? '打开中…' : connected ? '重新检测' : '打开 ERP'}</SettingsPrimaryButton>
          {connected && <SettingsSecondaryButton onClick={() => void run('refresh', () => window.shorekeeper.erp.refresh())}>检测登录</SettingsSecondaryButton>}
          {connected && <SettingsSecondaryButton onClick={() => void run('front', () => window.shorekeeper.erp.bringToFront())}>显示浏览器</SettingsSecondaryButton>}
          {connected && <SettingsSecondaryButton onClick={() => void run('disconnect', () => window.shorekeeper.erp.disconnect())}>断开</SettingsSecondaryButton>}
        </SettingsInlineActions>
        {!settings.configured && <p className="text-xs text-amber-200/80">{settings.reason}</p>}
        {connection.userName && <p className="text-xs text-keeper-ice/60">当前身份：{connection.userName}（ID {connection.userId}）</p>}
      </SettingsPanel>
    </SettingsPageShell>
  );
}
