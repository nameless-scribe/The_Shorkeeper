import { useCallback, useEffect, useState } from 'react';
import type { CreateDataSourceInput, DataDictionary, DataSourceInfo, MetricInfo, UpdateDataSourcePatch } from '@/shared/types';
import {
  SettingsActionLink,
  SettingsBadge,
  SettingsEmpty,
  SettingsErrorBanner,
  SettingsInlineActions,
  SettingsIntro,
  SettingsListCard,
  SettingsPageShell,
  SettingsPanel,
  SettingsPrimaryButton,
} from './components/settings-ui';
import { DataSourceForm } from './datasources/DataSourceForm';
import { DictionaryEditor } from './datasources/DictionaryEditor';
import { MetricsEditor } from './datasources/MetricsEditor';
import { describeRefreshResult, describeTestResult, formatCheckedAt, sourceStatus } from './datasources/datasource-view';

type FormState = { mode: 'closed' } | { mode: 'create' } | { mode: 'edit'; source: DataSourceInfo };

/** 设置 → 数据源（计划 §3.10）：增删改、测试连接、刷新骨架、字典与指标。 */
export function DataSourcesPage() {
  const [sources, setSources] = useState<DataSourceInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState<FormState>({ mode: 'closed' });
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState<{ id: string; action: 'test' | 'refresh' } | null>(null);
  const [notice, setNotice] = useState<{ id: string; lines: string[]; tone: 'ok' | 'error' } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dictionary, setDictionary] = useState<DataDictionary | null>(null);
  const [metrics, setMetrics] = useState<MetricInfo[]>([]);

  const load = useCallback(async () => {
    const list = await window.shorekeeper.datasources.list();
    setSources(list);
    setLoading(false);
  }, []);

  useEffect(() => {
    load().catch((err) => {
      setError(err instanceof Error ? err.message : '读取数据源失败');
      setLoading(false);
    });
  }, [load]);

  const loadDictionary = useCallback(async (id: string) => {
    const [dict, list] = await Promise.all([
      window.shorekeeper.datasources.getDictionary(id),
      window.shorekeeper.datasources.listMetrics(id),
    ]);
    setDictionary(dict);
    setMetrics(list);
  }, []);

  useEffect(() => {
    if (!selectedId) {
      setDictionary(null);
      setMetrics([]);
      return;
    }
    loadDictionary(selectedId).catch((err) => setError(err instanceof Error ? err.message : '读取字典失败'));
  }, [selectedId, loadDictionary]);

  const create = async (input: CreateDataSourceInput) => {
    setSaving(true);
    try {
      const created = await window.shorekeeper.datasources.create(input);
      setForm({ mode: 'closed' });
      await load();
      setSelectedId(created.id);
    } finally {
      setSaving(false);
    }
  };

  const update = async (id: string, patch: UpdateDataSourcePatch) => {
    setSaving(true);
    try {
      await window.shorekeeper.datasources.update(id, patch);
      setForm({ mode: 'closed' });
      await load();
    } finally {
      setSaving(false);
    }
  };

  const remove = async (source: DataSourceInfo) => {
    if (!window.confirm(`删除数据源「${source.name}」？字典、指标与命名查询会一起删除，查询记录保留。`)) return;
    await window.shorekeeper.datasources.delete(source.id);
    if (selectedId === source.id) setSelectedId(null);
    await load();
  };

  const test = async (source: DataSourceInfo) => {
    setBusy({ id: source.id, action: 'test' });
    setNotice(null);
    try {
      const result = await window.shorekeeper.datasources.test(source.id);
      setNotice({ id: source.id, lines: describeTestResult(result), tone: result.ok ? 'ok' : 'error' });
      await load();
    } catch (err) {
      setNotice({ id: source.id, lines: [err instanceof Error ? err.message : '测试失败'], tone: 'error' });
    } finally {
      setBusy(null);
    }
  };

  const refresh = async (source: DataSourceInfo) => {
    setBusy({ id: source.id, action: 'refresh' });
    setNotice(null);
    try {
      const result = await window.shorekeeper.datasources.refreshSchema(source.id);
      setNotice({ id: source.id, lines: [describeRefreshResult(result)], tone: 'ok' });
      await load();
      if (selectedId === source.id) await loadDictionary(source.id);
      else setSelectedId(source.id);
    } catch (err) {
      setNotice({ id: source.id, lines: [err instanceof Error ? err.message : '刷新失败'], tone: 'error' });
      await load();
    } finally {
      setBusy(null);
    }
  };

  const selected = sources.find((source) => source.id === selectedId) ?? null;

  return (
    <SettingsPageShell>
      <SettingsIntro>
        只读连接你的业务数据库。对话里问"上个月哪个客户买得最多"时，助手按这里的字典与指标把问题翻成查询，先给你看方案再执行；
        任何写操作都会被拦下。密码加密保存，不进日志。
      </SettingsIntro>

      {error && <SettingsErrorBanner message={error} />}

      {form.mode !== 'closed' ? (
        <DataSourceForm
          key={form.mode === 'edit' ? form.source.id : 'create'}
          initial={form.mode === 'edit' ? form.source : null}
          saving={saving}
          onCreate={create}
          onUpdate={update}
          onCancel={() => setForm({ mode: 'closed' })}
        />
      ) : (
        <SettingsPrimaryButton className="w-full" onClick={() => setForm({ mode: 'create' })}>
          添加数据源
        </SettingsPrimaryButton>
      )}

      <SettingsPanel title="已配置的数据源" subtitle={`${sources.length} 个`} icon="🗄">
        {loading ? (
          <p className="text-xs text-keeper-ice/45">读取中…</p>
        ) : sources.length === 0 ? (
          <SettingsEmpty title="还没有数据源" hint="添加后先测试连接，再刷新结构，最后花十分钟确认关注表的字典" />
        ) : (
          <div className="space-y-2">
            {sources.map((source) => {
              const status = sourceStatus(source);
              const isBusy = busy?.id === source.id;
              return (
                <div key={source.id} className="space-y-2">
                  <SettingsListCard
                    title={source.name}
                    subtitle={`${source.user}@${source.host}:${source.port}/${source.database}${source.options.ssl ? ' · SSL' : ''}${
                      source.options.timeZone ? ` · 时区 ${source.options.timeZone}` : ''
                    }`}
                    meta={source.lastError ? `上次失败：${source.lastError}` : formatCheckedAt(source.lastOkAt)}
                    badge={<SettingsBadge tone={status.tone}>{status.label}</SettingsBadge>}
                    onClick={() => setSelectedId(source.id === selectedId ? null : source.id)}
                    actions={
                      <SettingsInlineActions>
                        <SettingsActionLink disabled={isBusy} onClick={() => void test(source)}>
                          {isBusy && busy?.action === 'test' ? '测试中…' : '测试连接'}
                        </SettingsActionLink>
                        <SettingsActionLink disabled={isBusy} onClick={() => void refresh(source)}>
                          {isBusy && busy?.action === 'refresh' ? '读取中…' : '刷新结构'}
                        </SettingsActionLink>
                        <SettingsActionLink onClick={() => setForm({ mode: 'edit', source })}>编辑</SettingsActionLink>
                        <SettingsActionLink onClick={() => void remove(source)} danger>
                          删除
                        </SettingsActionLink>
                      </SettingsInlineActions>
                    }
                  />
                  {notice?.id === source.id && (
                    <div
                      className={`space-y-1 rounded-xl border px-3 py-2 text-xs ${
                        notice.tone === 'ok' ? 'border-keeper-cyan/20 bg-keeper-cyan/5 text-keeper-ice/80' : 'border-red-400/25 bg-red-950/30 text-red-200'
                      }`}
                    >
                      {notice.lines.map((line, index) => (
                        <p key={index}>{line}</p>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </SettingsPanel>

      {selected && dictionary && (
        <>
          <DictionaryEditor sourceId={selected.id} dictionary={dictionary} onChange={setDictionary} />
          <MetricsEditor sourceId={selected.id} metrics={metrics} onChange={setMetrics} />
        </>
      )}
    </SettingsPageShell>
  );
}
