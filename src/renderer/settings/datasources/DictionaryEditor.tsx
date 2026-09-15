import { useEffect, useMemo, useState } from 'react';
import type { ColumnManual, DataDictionary, DictionaryJoin, EnumProposal, JoinCardinality, TableManual } from '@/shared/types';
import {
  SettingsActionLink,
  SettingsBadge,
  SettingsEmpty,
  SettingsErrorBanner,
  SettingsField,
  SettingsPanel,
  SettingsPrimaryButton,
  SettingsRow,
  SettingsSecondaryButton,
  SETTINGS_INPUT_CLASS,
  SETTINGS_SELECT_CLASS,
  SETTINGS_TEXTAREA_CLASS,
} from '../components/settings-ui';
import { SettingsSegmented } from '../components/SettingsSegmented';
import { SettingsToggle } from '../components/SettingsToggle';
import { formatEnumText, joinLabel, orderTimeColumnCandidates, parseEnumText, tableMatchesSearch } from './datasource-view';

interface DictionaryEditorProps {
  sourceId: string;
  dictionary: DataDictionary;
  onChange: (dictionary: DataDictionary) => void;
}

const CARDINALITY_OPTIONS: Array<{ value: JoinCardinality; label: string }> = [
  { value: 'N:1', label: '多对一' },
  { value: '1:1', label: '一对一' },
  { value: '1:N', label: '一对多' },
];

/** 一个失焦即保存的文本框；值从字典来，改了才发请求 */
function BlurInput({
  value,
  placeholder,
  mono,
  onCommit,
}: {
  value: string;
  placeholder?: string;
  mono?: boolean;
  onCommit: (next: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <input
      value={draft}
      placeholder={placeholder}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (draft.trim() !== value.trim()) onCommit(draft);
      }}
      className={`${SETTINGS_INPUT_CLASS} ${mono ? 'font-mono text-[12px]' : ''}`}
    />
  );
}

function BlurTextarea({ value, placeholder, rows, onCommit }: { value: string; placeholder?: string; rows?: number; onCommit: (next: string) => void }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <textarea
      value={draft}
      rows={rows ?? 3}
      placeholder={placeholder}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (draft.trim() !== value.trim()) onCommit(draft);
      }}
      className={`${SETTINGS_TEXTAREA_CLASS} font-mono text-[12px]`}
    />
  );
}

/** 字典编辑器（计划 §3.1 / §3.10）：左边选表，右边填表与列的人工层。 */
export function DictionaryEditor({ sourceId, dictionary, onChange }: DictionaryEditorProps) {
  const tableNames = useMemo(() => Object.keys(dictionary.tables).sort(), [dictionary]);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [proposing, setProposing] = useState(false);
  const [proposals, setProposals] = useState<EnumProposal[] | null>(null);
  const [proposalNote, setProposalNote] = useState<string | null>(null);
  const [joinDraft, setJoinDraft] = useState<{ fromColumn: string; toTable: string; toColumn: string; cardinality: JoinCardinality }>({
    fromColumn: '',
    toTable: '',
    toColumn: '',
    cardinality: 'N:1',
  });

  const current = selected && dictionary.tables[selected] ? selected : tableNames[0] ?? null;
  const table = current ? dictionary.tables[current] : null;

  useEffect(() => {
    setProposals(null);
    setProposalNote(null);
  }, [current]);

  const visible = tableNames.filter((name) => tableMatchesSearch(name, dictionary.tables[name].manual.businessName, search));
  const focusedCount = tableNames.filter((name) => dictionary.tables[name].manual.focused).length;

  const saveTable = async (patch: Partial<TableManual>) => {
    if (!current) return;
    setError(null);
    try {
      onChange(await window.shorekeeper.datasources.updateTableManual(sourceId, current, patch));
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败');
    }
  };

  const saveColumn = async (column: string, patch: Partial<ColumnManual>) => {
    if (!current) return;
    setError(null);
    try {
      onChange(await window.shorekeeper.datasources.updateColumnManual(sourceId, current, column, patch));
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败');
    }
  };

  const addJoin = async () => {
    if (!table || !current) return;
    if (!joinDraft.fromColumn || !joinDraft.toTable || !joinDraft.toColumn.trim()) {
      setError('连接要填本表列、目标表和目标列。');
      return;
    }
    const join: DictionaryJoin = {
      id: `${current}.${joinDraft.fromColumn}->${joinDraft.toTable}.${joinDraft.toColumn.trim()}`,
      fromTable: current,
      fromColumn: joinDraft.fromColumn,
      toTable: joinDraft.toTable,
      toColumn: joinDraft.toColumn.trim(),
      cardinality: joinDraft.cardinality,
    };
    if (table.manual.joins.some((item) => item.id === join.id)) {
      setError('这条连接已经有了。');
      return;
    }
    await saveTable({ joins: [...table.manual.joins, join] });
    setJoinDraft({ fromColumn: '', toTable: '', toColumn: '', cardinality: 'N:1' });
  };

  const removeJoin = async (id: string) => {
    if (!table) return;
    await saveTable({ joins: table.manual.joins.filter((item) => item.id !== id) });
  };

  const propose = async () => {
    if (!current) return;
    setProposing(true);
    setError(null);
    setProposalNote(null);
    try {
      const result = await window.shorekeeper.datasources.proposeEnumMeanings(sourceId, current);
      setProposals(result.proposals);
      if (result.candidateCount === 0) setProposalNote('这张表没有待解释的枚举列：要么都填过了，要么还没刷新结构建取值表。');
      else if (result.proposals.length === 0) setProposalNote('模型没有给出可用的提议，请手动填写。');
    } catch (err) {
      setError(err instanceof Error ? err.message : '提议失败');
    } finally {
      setProposing(false);
    }
  };

  const acceptProposal = async (proposal: EnumProposal) => {
    const existing = table?.columns[proposal.column]?.enumValues ?? {};
    await saveColumn(proposal.column, { enumValues: { ...existing, ...proposal.values } });
    setProposals((list) => (list ?? []).filter((item) => item.column !== proposal.column));
  };

  if (!tableNames.length) {
    return (
      <SettingsPanel title="数据字典" icon="📚">
        <SettingsEmpty title="还没有读取过结构" hint="先点上面的「刷新结构」，把表和列读进来" />
      </SettingsPanel>
    );
  }

  return (
    <SettingsPanel
      title="数据字典"
      subtitle={`${tableNames.length} 张表，关注 ${focusedCount} 张。表注释已自动填成业务名，改成你平时的叫法即可`}
      icon="📚"
    >
      {error && <SettingsErrorBanner message={error} />}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-[180px_1fr]">
        <div className="space-y-2">
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="搜表名或业务名" className={SETTINGS_INPUT_CLASS} />
          <ul className="max-h-[420px] space-y-0.5 overflow-y-auto pr-1">
            {visible.map((name) => {
              const item = dictionary.tables[name];
              const active = name === current;
              return (
                <li key={name}>
                  <button
                    type="button"
                    onClick={() => setSelected(name)}
                    className={`w-full rounded-lg px-2 py-1.5 text-left text-xs transition ${
                      active ? 'bg-keeper-cyan/15 text-keeper-cyan' : 'text-keeper-ice/65 hover:bg-white/5 hover:text-keeper-ice'
                    }`}
                  >
                    <span className="block truncate">{item.manual.businessName || name}</span>
                    <span className="block truncate text-[10px] opacity-60">
                      {item.manual.focused ? '★ ' : ''}
                      {name}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>

        {table && current && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <p className="font-mono text-sm text-keeper-ice">{current}</p>
              {typeof table.auto.rowCountEstimate === 'number' && <SettingsBadge tone="muted">约 {table.auto.rowCountEstimate} 行</SettingsBadge>}
              {table.auto.comment && <SettingsBadge tone="muted">注释：{table.auto.comment}</SettingsBadge>}
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <SettingsField label="业务名">
                <BlurInput value={table.manual.businessName ?? ''} placeholder="订单" onCommit={(businessName) => void saveTable({ businessName })} />
              </SettingsField>
              <SettingsField label="时间基准列" hint="事实表必填：按哪一列算「哪个月」">
                <select
                  value={table.manual.timeColumn ?? ''}
                  onChange={(e) => void saveTable({ timeColumn: e.target.value })}
                  className={SETTINGS_SELECT_CLASS}
                >
                  <option value="">（不是事实表 / 未定）</option>
                  {orderTimeColumnCandidates(table.auto.columns).map((column) => (
                    <option key={column.name} value={column.name}>
                      {column.name}
                      {column.likely ? '' : `（${column.type}）`}
                    </option>
                  ))}
                </select>
              </SettingsField>
            </div>
            <SettingsField label="一句话说明">
              <BlurInput value={table.manual.description ?? ''} placeholder="每笔订单一行，退款也在这张表里" onCommit={(description) => void saveTable({ description })} />
            </SettingsField>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <SettingsRow label="关注这张表">
                <SettingsToggle checked={table.manual.focused === true} onChange={(focused) => void saveTable({ focused })} />
              </SettingsRow>
              <SettingsRow label="同类表里的真源">
                <SettingsToggle checked={table.manual.isSource === true} onChange={(isSource) => void saveTable({ isSource })} />
              </SettingsRow>
            </div>

            <div className="space-y-2">
              <p className="text-xs font-medium text-keeper-ice/75">合法连接</p>
              {table.manual.joins.length === 0 && <p className="text-[11px] text-keeper-ice/40">没有外键时在这里手动登记，如 orders.customer_id → customers.id</p>}
              {table.manual.joins.map((join) => (
                <div key={join.id} className="flex items-center justify-between gap-2 rounded-xl border border-keeper-silver/10 bg-keeper-navyDeep/30 px-3 py-2">
                  <span className="font-mono text-[11px] text-keeper-ice/80">{joinLabel(join)}</span>
                  <SettingsActionLink onClick={() => void removeJoin(join.id)} danger>
                    删除
                  </SettingsActionLink>
                </div>
              ))}
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr_1fr]">
                <select value={joinDraft.fromColumn} onChange={(e) => setJoinDraft({ ...joinDraft, fromColumn: e.target.value })} className={SETTINGS_SELECT_CLASS}>
                  <option value="">本表列</option>
                  {table.auto.columns.map((column) => (
                    <option key={column.name} value={column.name}>
                      {column.name}
                    </option>
                  ))}
                </select>
                <select value={joinDraft.toTable} onChange={(e) => setJoinDraft({ ...joinDraft, toTable: e.target.value })} className={SETTINGS_SELECT_CLASS}>
                  <option value="">目标表</option>
                  {tableNames
                    .filter((name) => name !== current)
                    .map((name) => (
                      <option key={name} value={name}>
                        {dictionary.tables[name].manual.businessName ? `${dictionary.tables[name].manual.businessName}（${name}）` : name}
                      </option>
                    ))}
                </select>
                <select value={joinDraft.toColumn} onChange={(e) => setJoinDraft({ ...joinDraft, toColumn: e.target.value })} className={SETTINGS_SELECT_CLASS} disabled={!joinDraft.toTable}>
                  <option value="">目标列</option>
                  {(dictionary.tables[joinDraft.toTable]?.auto.columns ?? []).map((column) => (
                    <option key={column.name} value={column.name}>
                      {column.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <SettingsSegmented value={joinDraft.cardinality} options={CARDINALITY_OPTIONS} onChange={(cardinality) => setJoinDraft({ ...joinDraft, cardinality })} />
                <SettingsSecondaryButton onClick={() => void addJoin()}>登记连接</SettingsSecondaryButton>
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs font-medium text-keeper-ice/75">列（{table.auto.columns.length}）</p>
                <SettingsSecondaryButton onClick={() => void propose()}>{proposing ? '模型思考中…' : '让模型提议枚举含义'}</SettingsSecondaryButton>
              </div>
              {proposalNote && <p className="text-[11px] text-keeper-ice/45">{proposalNote}</p>}
              {proposals && proposals.length > 0 && (
                <div className="space-y-2 rounded-2xl border border-keeper-cyan/20 bg-keeper-cyan/5 p-3">
                  <p className="text-xs text-keeper-ice/75">模型的提议，逐列确认后才会写进字典：</p>
                  {proposals.map((proposal) => (
                    <div key={proposal.column} className="rounded-xl border border-keeper-silver/10 bg-keeper-navyDeep/40 p-2">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <p className="font-mono text-xs text-keeper-ice">{proposal.column}</p>
                          <p className="mt-1 whitespace-pre-wrap font-mono text-[11px] text-keeper-ice/70">{formatEnumText(proposal.values)}</p>
                          {proposal.note && <p className="mt-1 text-[10px] text-keeper-ice/40">{proposal.note}</p>}
                        </div>
                        <div className="flex shrink-0 gap-2">
                          <SettingsActionLink onClick={() => void acceptProposal(proposal)}>采用</SettingsActionLink>
                          <SettingsActionLink onClick={() => setProposals((list) => (list ?? []).filter((item) => item.column !== proposal.column))}>忽略</SettingsActionLink>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <div className="space-y-2">
                {table.auto.columns.map((column) => {
                  const manual = table.columns[column.name] ?? {};
                  const known = manual.knownValues ?? column.knownValues;
                  return (
                    <div key={column.name} className="space-y-2 rounded-xl border border-keeper-silver/10 bg-keeper-navyDeep/30 p-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-xs text-keeper-ice">{column.name}</span>
                        <span className="text-[10px] text-keeper-ice/40">{column.type}</span>
                        {column.primaryKey && <SettingsBadge tone="muted">主键</SettingsBadge>}
                        {column.comment && <span className="text-[10px] text-keeper-ice/45">注释：{column.comment}</span>}
                      </div>
                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                        <BlurInput value={manual.businessName ?? ''} placeholder="业务名" onCommit={(businessName) => void saveColumn(column.name, { businessName })} />
                        <BlurInput value={manual.description ?? ''} placeholder="一句话说明（可选）" onCommit={(description) => void saveColumn(column.name, { description })} />
                      </div>
                      {known && known.length > 0 && (
                        <p className="text-[10px] text-keeper-ice/45">
                          取值：{known.slice(0, 12).join(' / ')}
                          {known.length > 12 ? ` …共 ${known.length} 个` : ''}
                        </p>
                      )}
                      {!known?.length && column.samples.length > 0 && <p className="text-[10px] text-keeper-ice/40">样例：{column.samples.join(' / ')}</p>}
                      {(known?.length || manual.enumValues) && (
                        <BlurTextarea
                          value={formatEnumText(manual.enumValues)}
                          placeholder={'枚举含义，每行一条：\n1=待付款\n2=已付款'}
                          rows={Math.min(6, Math.max(2, Object.keys(manual.enumValues ?? {}).length + 1))}
                          onCommit={(text) => void saveColumn(column.name, { enumValues: parseEnumText(text) })}
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
            <SettingsPrimaryButton className="w-full" onClick={() => setSelected(null)}>
              回到第一张表
            </SettingsPrimaryButton>
          </div>
        )}
      </div>
    </SettingsPanel>
  );
}
