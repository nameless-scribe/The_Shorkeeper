import { useState } from 'react';
import type { CreateDataSourceInput, DataSourceInfo, UpdateDataSourcePatch } from '@/shared/types';
import { sslWarning } from '@/datasources/mysql-helpers';
import {
  SettingsErrorBanner,
  SettingsField,
  SettingsInlineActions,
  SettingsPanel,
  SettingsPrimaryButton,
  SettingsRow,
  SettingsSecondaryButton,
  SETTINGS_INPUT_CLASS,
} from '../components/settings-ui';
import { SettingsToggle } from '../components/SettingsToggle';

interface DataSourceFormProps {
  initial?: DataSourceInfo | null;
  saving: boolean;
  onCreate: (input: CreateDataSourceInput) => Promise<void>;
  onUpdate: (id: string, patch: UpdateDataSourcePatch) => Promise<void>;
  onCancel: () => void;
}

interface Draft {
  name: string;
  host: string;
  port: string;
  database: string;
  user: string;
  password: string;
  ssl: boolean;
  timeZone: string;
  sampleValues: boolean;
}

function draftFrom(initial?: DataSourceInfo | null): Draft {
  return {
    name: initial?.name ?? '',
    host: initial?.host ?? '',
    port: String(initial?.port ?? 3306),
    database: initial?.database ?? '',
    user: initial?.user ?? '',
    password: '',
    ssl: initial?.options.ssl === true,
    timeZone: initial?.options.timeZone ?? '',
    sampleValues: initial?.options.sampleValues !== false,
  };
}

/** 新增 / 编辑数据源。密码框永远不回填；编辑时留空即不改。 */
export function DataSourceForm({ initial, saving, onCreate, onUpdate, onCancel }: DataSourceFormProps) {
  const [draft, setDraft] = useState<Draft>(() => draftFrom(initial));
  const [error, setError] = useState<string | null>(null);
  const editing = Boolean(initial);
  const warning = sslWarning(draft.host, draft.ssl);

  const update = (patch: Partial<Draft>) => setDraft((current) => ({ ...current, ...patch }));

  const submit = async () => {
    setError(null);
    const port = Number(draft.port);
    if (!draft.name.trim() || !draft.host.trim() || !draft.database.trim() || !draft.user.trim()) {
      setError('名称、主机、数据库名、用户名都要填。');
      return;
    }
    if (!Number.isInteger(port) || port < 1 || port > 65_535) {
      setError('端口要是 1–65535 的整数。');
      return;
    }
    if (!editing && !draft.password) {
      setError('新建数据源要填密码。');
      return;
    }
    const options = { ssl: draft.ssl, timeZone: draft.timeZone.trim(), sampleValues: draft.sampleValues };
    try {
      if (editing && initial) {
        await onUpdate(initial.id, {
          name: draft.name.trim(),
          host: draft.host.trim(),
          port,
          database: draft.database.trim(),
          user: draft.user.trim(),
          ...(draft.password ? { password: draft.password } : {}),
          options,
        });
      } else {
        await onCreate({
          name: draft.name.trim(),
          host: draft.host.trim(),
          port,
          database: draft.database.trim(),
          user: draft.user.trim(),
          password: draft.password,
          options,
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败');
    }
  };

  return (
    <SettingsPanel title={editing ? `编辑 ${initial?.name ?? ''}` : '添加数据源'} subtitle="目前只支持 MySQL；应用只读，不会写库" icon="🗄">
      <SettingsField label="名称" hint="对话里会用这个名字称呼它，如「生产库」">
        <input value={draft.name} onChange={(e) => update({ name: e.target.value })} placeholder="生产库" className={SETTINGS_INPUT_CLASS} />
      </SettingsField>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_120px]">
        <SettingsField label="主机">
          <input value={draft.host} onChange={(e) => update({ host: e.target.value })} placeholder="192.168.1.10 或 db.example.com" className={SETTINGS_INPUT_CLASS} />
        </SettingsField>
        <SettingsField label="端口">
          <input value={draft.port} onChange={(e) => update({ port: e.target.value })} inputMode="numeric" className={SETTINGS_INPUT_CLASS} />
        </SettingsField>
      </div>
      <SettingsField label="数据库名">
        <input value={draft.database} onChange={(e) => update({ database: e.target.value })} placeholder="erp" className={SETTINGS_INPUT_CLASS} />
      </SettingsField>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <SettingsField label="用户名" hint="建议用只读账号">
          <input value={draft.user} onChange={(e) => update({ user: e.target.value })} className={SETTINGS_INPUT_CLASS} autoComplete="off" />
        </SettingsField>
        <SettingsField label="密码" hint={editing ? '留空表示不修改' : '保存后加密存储，不再回显'}>
          <input
            type="password"
            value={draft.password}
            onChange={(e) => update({ password: e.target.value })}
            className={SETTINGS_INPUT_CLASS}
            autoComplete="new-password"
          />
        </SettingsField>
      </div>
      <SettingsRow label="SSL 加密连接">
        <SettingsToggle checked={draft.ssl} onChange={(ssl) => update({ ssl })} />
      </SettingsRow>
      {warning && <p className="rounded-xl border border-amber-400/25 bg-amber-950/25 px-3 py-2 text-xs text-amber-200">{warning}</p>}
      <SettingsRow label="抓取样例值（每列前 3 个）">
        <SettingsToggle checked={draft.sampleValues} onChange={(sampleValues) => update({ sampleValues })} />
      </SettingsRow>
      <SettingsField label="时区（可选）" hint="留空则按数据库服务器自己的时区解释时间。先测试连接看实际值，再决定要不要固定成 +08:00 这样">
        <input value={draft.timeZone} onChange={(e) => update({ timeZone: e.target.value })} placeholder="留空跟随服务器" className={SETTINGS_INPUT_CLASS} />
      </SettingsField>
      {error && <SettingsErrorBanner message={error} />}
      <SettingsInlineActions>
        <SettingsPrimaryButton className="flex-1 px-4" disabled={saving} onClick={() => void submit()}>
          {saving ? '保存中…' : editing ? '保存修改' : '添加数据源'}
        </SettingsPrimaryButton>
        <SettingsSecondaryButton onClick={onCancel}>取消</SettingsSecondaryButton>
      </SettingsInlineActions>
    </SettingsPanel>
  );
}
