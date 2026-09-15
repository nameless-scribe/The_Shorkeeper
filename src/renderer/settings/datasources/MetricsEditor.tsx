import { useState } from 'react';
import type { MetricInfo } from '@/shared/types';
import {
  SettingsActionLink,
  SettingsBadge,
  SettingsEmpty,
  SettingsErrorBanner,
  SettingsField,
  SettingsListCard,
  SettingsPanel,
  SettingsPrimaryButton,
  SETTINGS_INPUT_CLASS,
} from '../components/settings-ui';

interface MetricsEditorProps {
  sourceId: string;
  metrics: MetricInfo[];
  onChange: (metrics: MetricInfo[]) => void;
}

const EMPTY = { name: '', sqlFragment: '', grain: '', notes: '' };

/** 指标定义（计划 §3.2）：名称、SQL 片段（事实表别名 f）、粒度、口径说明。 */
export function MetricsEditor({ sourceId, metrics, onChange }: MetricsEditorProps) {
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = async () => onChange(await window.shorekeeper.datasources.listMetrics(sourceId));

  const save = async () => {
    if (!form.name.trim() || !form.sqlFragment.trim()) {
      setError('指标名和 SQL 片段都要填。');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await window.shorekeeper.datasources.upsertMetric(sourceId, {
        name: form.name.trim(),
        sqlFragment: form.sqlFragment.trim(),
        grain: form.grain.trim() || undefined,
        notes: form.notes.trim() || undefined,
      });
      setForm(EMPTY);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (name: string) => {
    await window.shorekeeper.datasources.deleteMetric(sourceId, name);
    await reload();
  };

  const edit = (metric: MetricInfo) =>
    setForm({ name: metric.name, sqlFragment: metric.sqlFragment, grain: metric.grain ?? '', notes: metric.notes ?? '' });

  return (
    <SettingsPanel title="指标" subtitle="对话里出现「销售额」这类词时按这里的口径算；没定义的会先问你" icon="📐">
      {metrics.length === 0 ? (
        <SettingsEmpty title="还没有指标" hint="也可以先不填：对话里确认过口径后会自动存进来" />
      ) : (
        <div className="space-y-2">
          {metrics.map((metric) => (
            <SettingsListCard
              key={metric.id}
              title={metric.name}
              subtitle={[metric.grain ? `粒度 ${metric.grain}` : null, metric.notes].filter(Boolean).join(' · ') || undefined}
              meta={metric.sqlFragment}
              badge={<SettingsBadge tone={metric.source === 'query' ? 'cyan' : 'muted'}>{metric.source === 'query' ? '来自确认过的查询' : '手填'}</SettingsBadge>}
              actions={
                <div className="flex gap-2">
                  <SettingsActionLink onClick={() => edit(metric)}>编辑</SettingsActionLink>
                  <SettingsActionLink onClick={() => void remove(metric.name)} danger>
                    删除
                  </SettingsActionLink>
                </div>
              }
            />
          ))}
        </div>
      )}
      <div className="space-y-3 rounded-2xl border border-keeper-silver/12 bg-keeper-navyDeep/30 p-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <SettingsField label="指标名">
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="销售额" className={SETTINGS_INPUT_CLASS} />
          </SettingsField>
          <SettingsField label="粒度（可选）">
            <input value={form.grain} onChange={(e) => setForm({ ...form, grain: e.target.value })} placeholder="订单 / 客户 / 日" className={SETTINGS_INPUT_CLASS} />
          </SettingsField>
        </div>
        <SettingsField label="SQL 片段" hint="聚合表达式，事实表用别名 f，如 SUM(f.paid_amount - f.refund_amount)">
          <input
            value={form.sqlFragment}
            onChange={(e) => setForm({ ...form, sqlFragment: e.target.value })}
            className={`${SETTINGS_INPUT_CLASS} font-mono text-[12px]`}
          />
        </SettingsField>
        <SettingsField label="口径说明（可选）" hint="含税？扣退款？剔除测试账号？写在这里，回复里会注明">
          <input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} className={SETTINGS_INPUT_CLASS} />
        </SettingsField>
        {error && <SettingsErrorBanner message={error} />}
        <SettingsPrimaryButton className="w-full" disabled={saving} onClick={() => void save()}>
          {saving ? '保存中…' : '保存指标'}
        </SettingsPrimaryButton>
      </div>
    </SettingsPanel>
  );
}
