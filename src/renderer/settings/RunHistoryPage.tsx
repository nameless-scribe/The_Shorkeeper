import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  ApprovalInfo,
  TaskRunDetail,
  TaskRunInfo,
  TaskRunStepInfo,
  TaskRunContextSourceInfo,
  ContextSourceDetailInfo,
} from '@/shared/types';
import { FileAttachmentCard } from '../components/FileAttachmentCard';
import { toolDisplayName } from '../components/tool-labels';
import {
  SettingsActionLink,
  SettingsBadge,
  SettingsEmpty,
  SettingsErrorBanner,
  SettingsIntro,
  SettingsListCard,
  SettingsLoading,
  SettingsPageShell,
  SettingsPanel,
  SettingsSection,
  SETTINGS_SELECT_CLASS,
} from './components/settings-ui';
import {
  formatRunDuration,
  formatApprovalDecider,
  formatErrorCategory,
  formatRunIssue,
  formatRiskLevel,
  formatRunTime,
  RUN_KIND_LABELS,
  RUN_PHASE_LABELS,
  runMatchesFilter,
  runPhaseTone,
  type RunFilter,
} from './run-history-view';

const STEP_STATUS_LABELS: Record<TaskRunStepInfo['status'], string> = {
  running: '执行中',
  succeeded: '成功',
  failed: '失败',
  cancelled: '已取消',
  skipped: '已合并',
  interrupted: '已中断',
};

const APPROVAL_STATUS_LABELS: Record<ApprovalInfo['status'], string> = {
  pending: '等待确认',
  approved: '已允许',
  denied: '已拒绝',
  expired: '已超时',
  cancelled: '已取消',
  interrupted: '已中断',
};

function shortId(value: string): string {
  return value.length > 16 ? `${value.slice(0, 8)}…${value.slice(-6)}` : value;
}

function StepList({ steps }: { steps: TaskRunStepInfo[] }) {
  if (!steps.length) return <SettingsEmpty title="本次运行没有调用工具" />;
  return (
    <div className="space-y-2">
      {steps.map((step) => (
        <SettingsListCard
          key={step.id}
          title={`${step.seq}. ${toolDisplayName(step.toolName)}`}
          subtitle={step.errorSummary ?? undefined}
          meta={[
            step.riskLevel ? `风险：${formatRiskLevel(step.riskLevel)}` : null,
            `幂等：${step.idempotent ? '是' : '否'}`,
            step.errorCategory ? `错误类别：${formatErrorCategory(step.errorCategory)}` : null,
          ].filter(Boolean).join(' · ')}
          badge={
            <SettingsBadge tone={step.status === 'succeeded' ? 'green' : step.status === 'failed' || step.status === 'interrupted' ? 'amber' : 'muted'}>
              {STEP_STATUS_LABELS[step.status]}
            </SettingsBadge>
          }
        />
      ))}
    </div>
  );
}

const CONTEXT_SOURCE_LABELS: Record<TaskRunContextSourceInfo['sourceType'], string> = {
  memory: '记忆', document: '文档', goal: '目标', commitment: '承诺',
};

function ContextSourcesList({ sources }: { sources: TaskRunContextSourceInfo[] }) {
  const [expandedRef, setExpandedRef] = useState<string | null>(null);
  const [detail, setDetail] = useState<ContextSourceDetailInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  const open = async (source: TaskRunContextSourceInfo) => {
    if (expandedRef === source.sourceRef) {
      setExpandedRef(null);
      return;
    }
    setExpandedRef(source.sourceRef);
    setDetail(null);
    setError(null);
    try {
      setDetail(await window.shorekeeper.agent.sourceDetail(source.sourceRef));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    }
  };

  if (!sources.length) return <SettingsEmpty title="本次运行没有注入可追踪来源" />;
  return <div className="space-y-2">{sources.map((source) => (
    <div key={source.id}>
      <SettingsListCard
        title={source.label}
        subtitle={source.summary ?? undefined}
        meta={`${source.sourceRef}${source.documentVersion ? ` · 文档 v${source.documentVersion}` : ''}${source.sourceUpdatedAt ? ` · ${formatRunTime(source.sourceUpdatedAt)}` : ''}`}
        badge={<SettingsBadge tone={source.sourceType === 'document' ? 'cyan' : 'muted'}>{CONTEXT_SOURCE_LABELS[source.sourceType]}</SettingsBadge>}
        onClick={() => void open(source)}
      />
      {expandedRef === source.sourceRef && (
        <div className="mx-2 rounded-b-xl border border-t-0 border-keeper-cyan/15 bg-keeper-navyDeep/35 px-3 py-2 text-xs leading-relaxed">
          {error && <p className="text-red-300/80">来源读取失败：{error}</p>}
          {!error && !detail && <p className="text-keeper-ice/45">正在读取来源…</p>}
          {detail && <>
            {detail.content && <p className="max-h-44 overflow-y-auto whitespace-pre-wrap text-keeper-ice/75">{detail.content}</p>}
            {detail.meta && <p className="mt-1 text-[10px] text-keeper-ice/45">{detail.meta}</p>}
          </>}
        </div>
      )}
    </div>
  ))}</div>;
}

function RunDetailView({ detail, onBack }: { detail: TaskRunDetail; onBack: () => void }) {
  const { run, steps, approvals, artifacts, contextSources } = detail;
  const runIssue = formatRunIssue(run);
  return (
    <SettingsPageShell>
      <SettingsSection
        title={`${RUN_KIND_LABELS[run.kind]} · ${RUN_PHASE_LABELS[run.phase]}`}
        hint={`运行 ID：${shortId(run.id)}`}
        action={<SettingsActionLink onClick={onBack}>返回列表</SettingsActionLink>}
      >
        <SettingsPanel
          title="运行摘要"
          subtitle={formatRunTime(run.startedAt)}
          icon="📋"
          badge={<SettingsBadge tone={runPhaseTone(run.phase)}>{RUN_PHASE_LABELS[run.phase]}</SettingsBadge>}
        >
          <div className="grid grid-cols-2 gap-2 text-xs">
            <p className="rounded-xl bg-keeper-navyDeep/30 px-3 py-2 text-keeper-ice/60">耗时<br /><span className="text-keeper-ice">{formatRunDuration(run)}</span></p>
            <p className="rounded-xl bg-keeper-navyDeep/30 px-3 py-2 text-keeper-ice/60">工具步骤<br /><span className="text-keeper-ice">{run.stepCount}，失败 {run.failedStepCount}</span></p>
            <p className="col-span-2 break-all rounded-xl bg-keeper-navyDeep/30 px-3 py-2 text-keeper-ice/60">模型<br /><span className="text-keeper-ice">{run.modelId ?? '未记录'}</span></p>
          </div>
          {runIssue && (
            <p className="rounded-xl border border-amber-400/20 bg-amber-500/8 px-3 py-2 text-xs leading-relaxed text-amber-100/80">
              {runIssue}
            </p>
          )}
        </SettingsPanel>
      </SettingsSection>

      <SettingsSection title="工具步骤" hint={`${steps.length} 项`}>
        <StepList steps={steps} />
      </SettingsSection>

      <SettingsSection title="使用的上下文" hint={`${contextSources.length} 项`}>
        <ContextSourcesList sources={contextSources} />
      </SettingsSection>

      <SettingsSection title="审批记录" hint={`${approvals.length} 项`}>
        {approvals.length === 0 ? (
          <SettingsEmpty title="本次运行没有审批请求" />
        ) : (
          <div className="space-y-2">
            {approvals.map((approval) => (
              <SettingsListCard
                key={approval.id}
                title={toolDisplayName(approval.toolName)}
                subtitle={approval.argsSummary}
                meta={`${formatRunTime(approval.requestedAt)} · 风险：${formatRiskLevel(approval.riskLevel)}${approval.decidedBy ? ` · 决定方式：${formatApprovalDecider(approval.decidedBy)}` : ''}`}
                badge={<SettingsBadge tone={approval.status === 'approved' ? 'green' : approval.status === 'pending' ? 'cyan' : 'amber'}>{APPROVAL_STATUS_LABELS[approval.status]}</SettingsBadge>}
              />
            ))}
          </div>
        )}
      </SettingsSection>

      <SettingsSection title="完成产物" hint={`${artifacts.length} 项`}>
        {artifacts.length === 0 ? (
          <SettingsEmpty title="本次运行没有文件产物" />
        ) : (
          <div className="space-y-2">
            {artifacts.map((artifact) => (
              <FileAttachmentCard
                key={artifact.id}
                file={{
                  relativePath: artifact.relativePath,
                  originalName: artifact.originalName,
                  size: artifact.size,
                  ...(artifact.sha256 ? { sha256: artifact.sha256 } : {}),
                }}
              />
            ))}
          </div>
        )}
      </SettingsSection>
    </SettingsPageShell>
  );
}

export function RunHistoryPage() {
  const [runs, setRuns] = useState<TaskRunInfo[]>([]);
  const [filter, setFilter] = useState<RunFilter>('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<TaskRunDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadRuns = useCallback(async () => {
    setError(null);
    try {
      setRuns(await window.shorekeeper.agent.runHistory({ limit: 100 }));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadRuns();
    const off = window.shorekeeper.agent.onEvent((event) => {
      const item = event as { type?: string };
      if (item.type === 'run_finished' || item.type === 'run_error') void loadRuns();
    });
    return off;
  }, [loadRuns]);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      return;
    }
    let active = true;
    setDetailLoading(true);
    setError(null);
    window.shorekeeper.agent.runDetail(selectedId)
      .then((value) => {
        if (!active) return;
        if (!value) setError('未找到这条运行记录，可能已被清理');
        setDetail(value);
      })
      .catch((loadError) => {
        if (active) setError(loadError instanceof Error ? loadError.message : String(loadError));
      })
      .finally(() => {
        if (active) setDetailLoading(false);
      });
    return () => { active = false; };
  }, [selectedId]);

  const filtered = useMemo(
    () => runs.filter((run) => runMatchesFilter(run, filter)),
    [filter, runs],
  );

  if (loading || detailLoading) return <SettingsLoading />;
  if (detail) return <RunDetailView detail={detail} onBack={() => setSelectedId(null)} />;

  return (
    <SettingsPageShell>
      <SettingsIntro>
        这里展示跨重启保留的 Agent 运行记录。可以检查工具步骤、失败原因、审批结论与完成产物；记录只保存脱敏摘要，不保存完整工具输出。
      </SettingsIntro>

      {error && <SettingsErrorBanner message={error} />}

      <SettingsPanel
        title="筛选运行记录"
        subtitle={`最近 ${runs.length} 条`}
        icon="🔎"
        footer={<SettingsActionLink onClick={() => void loadRuns()}>刷新记录</SettingsActionLink>}
      >
        <select
          value={filter}
          onChange={(event) => setFilter(event.target.value as RunFilter)}
          className={SETTINGS_SELECT_CLASS}
        >
          <option value="all">全部状态</option>
          <option value="active">正在运行</option>
          <option value="finished">已完成</option>
          <option value="attention">失败或中断</option>
        </select>
      </SettingsPanel>

      <SettingsSection title="运行列表" hint={`${filtered.length} 条`}>
        {filtered.length === 0 ? (
          <SettingsEmpty title="没有符合条件的运行记录" hint="完成一次对话或定时任务后会显示在这里" />
        ) : (
          <div className="space-y-2">
            {filtered.map((run) => (
              <SettingsListCard
                key={run.id}
                title={`${RUN_KIND_LABELS[run.kind]} · ${RUN_PHASE_LABELS[run.phase]}`}
                subtitle={run.errorSummary ?? `${run.stepCount} 个工具步骤，耗时 ${formatRunDuration(run)}`}
                meta={`${formatRunTime(run.startedAt)} · ${run.modelId ?? '未记录模型'} · ${shortId(run.id)}`}
                badge={<SettingsBadge tone={runPhaseTone(run.phase)}>{RUN_PHASE_LABELS[run.phase]}</SettingsBadge>}
                onClick={() => setSelectedId(run.id)}
              />
            ))}
          </div>
        )}
      </SettingsSection>
    </SettingsPageShell>
  );
}
