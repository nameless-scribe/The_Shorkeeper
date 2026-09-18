import { useRef, useCallback, useEffect, useMemo, useState } from 'react';
import type {
  AudioTranscriptInfo,
  ApprovalInfo,
  TaskRunDetail,
  TaskRunInfo,
  TaskRunStepInfo,
  TaskRunContextSourceInfo,
  ContextSourceDetailInfo,
} from '@/shared/types';
import { FileAttachmentCard } from '../components/FileAttachmentCard';
import {
  canOpenTranscript,
  formatTranscriptIssue,
  formatTranscriptMeta,
  transcriptStatusView,
} from './transcript-history-view';

/** transcript-history-view 的语义色 → SettingsBadge 的既有取值，不新增配色。 */
const TRANSCRIPT_BADGE_TONE = {
  running: 'cyan',
  success: 'green',
  error: 'amber',
  muted: 'muted',
} as const;
import { toolDisplayName } from '../components/tool-labels';
import { SettingsSegmented } from './components/SettingsSegmented';
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
  const latestRef = useRef<string | null>(null);

  const open = async (source: TaskRunContextSourceInfo) => {
    if (expandedRef === source.sourceRef) {
      setExpandedRef(null);
      latestRef.current = null;
      return;
    }
    setExpandedRef(source.sourceRef);
    latestRef.current = source.sourceRef;
    setDetail(null);
    setError(null);
    try {
      const loaded = await window.shorekeeper.agent.sourceDetail(source.sourceRef);
      if (latestRef.current !== source.sourceRef) return;
      setDetail(loaded);
    } catch (loadError) {
      if (latestRef.current !== source.sourceRef) return;
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
  const { run, steps, approvals, artifacts } = detail;
  const [checkpoint, setCheckpoint] = useState(detail.checkpoint);
  const [confirmContinue, setConfirmContinue] = useState(false);
  const [continuing, setContinuing] = useState(false);
  const [continueMessage, setContinueMessage] = useState<string | null>(null);
  const continueLock = useRef(false);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const continueRun = async () => {
    if (!checkpoint?.available || continueLock.current) return;
    continueLock.current = true;
    setContinuing(true);
    setContinueMessage(null);
    try {
      const currentSession = await window.shorekeeper.sessions.current();
      if (currentSession.id !== run.sessionId) throw new Error('请先在历史会话中切换到这条运行所属的会话，再继续。');
      const result = await window.shorekeeper.agent.send({
        sessionId: run.sessionId, message: '确认继续一段', resumeCheckpointId: checkpoint.id,
      });
      const latest = await window.shorekeeper.agent.runDetail(run.id);
      if (!alive.current) return;
      setCheckpoint(latest?.checkpoint);
      setContinueMessage(result?.ok ? '本段已结束，可返回列表查看新的运行记录。'
        : result?.error ?? '未能继续，请刷新运行详情后核对。');
    } catch (error) {
      if (alive.current) setContinueMessage(error instanceof Error ? error.message : String(error));
    } finally {
      continueLock.current = false;
      if (alive.current) { setContinuing(false); setConfirmContinue(false); }
    }
  };
  // 旧版本主进程可能不返回来源列表：按空处理，不让整页崩溃。
  const contextSources = detail.contextSources ?? [];
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

      {checkpoint && <SettingsSection title="检查点与继续" hint={`有效期至 ${formatRunTime(checkpoint.expiresAt)}`}>
        <SettingsPanel title={checkpoint.claimedRunId ? '检查点已使用' : checkpoint.available ? '可确认继续一段' : '检查点不可继续'}>
          {checkpoint.unavailableReason && <p className="text-xs text-amber-200/80">{checkpoint.unavailableReason}</p>}
          {checkpoint.totals && <p className="text-xs text-keeper-ice/60">任务累计：{checkpoint.totals.segments} 段 · {checkpoint.totals.rounds} 次工作请求 · {checkpoint.totals.toolCalls} 次工具调度 · 约 {checkpoint.totals.tokens} token（含保守收尾预留）</p>}
          <p className="text-xs leading-relaxed text-keeper-ice/65">继续前会核对权限和文件；写入、发送等操作需重新确认。旧查询结果仅代表上段时间，可能需要重新核对。</p>
          {confirmContinue && <p className="text-xs leading-relaxed text-keeper-ice/75">确认新增最多 20 次模型工作请求、120 次工具调用、15 分钟主动执行和 60 万 token 额度？工具审批仍需单独确认。</p>}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <SettingsActionLink disabled={!checkpoint.available || continuing} onClick={() => confirmContinue ? void continueRun() : setConfirmContinue(true)}>
              {continuing ? '继续中…' : confirmContinue ? '确认额度并继续' : '继续一段'}
            </SettingsActionLink>
            {confirmContinue && !continuing && <SettingsActionLink onClick={() => setConfirmContinue(false)}>取消</SettingsActionLink>}
          </div>
          {continueMessage && <p role="status" className="break-words text-xs text-keeper-ice/70">{continueMessage}</p>}
        </SettingsPanel>
      </SettingsSection>}

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
  const [transcripts, setTranscripts] = useState<AudioTranscriptInfo[]>([]);
  const [filter, setFilter] = useState<RunFilter>('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<TaskRunDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadTranscripts = useCallback(async () => {
    try {
      setTranscripts(await window.shorekeeper.transcripts.list(50));
    } catch {
      // 转写记录只是附加信息，读不到不该让整页报错遮住运行记录
      setTranscripts([]);
    }
  }, []);

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
    void loadTranscripts();
    const off = window.shorekeeper.agent.onEvent((event) => {
      const item = event as { type?: string };
      if (item.type === 'run_finished' || item.type === 'run_error') {
        void loadRuns();
        // 转写由工具发起，结束时机与 run 一致，顺带刷新
        void loadTranscripts();
      }
    });
    return off;
  }, [loadRuns, loadTranscripts]);

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
        <SettingsSegmented<RunFilter>
          value={filter}
          options={[
            { value: 'all', label: '全部' },
            { value: 'active', label: '进行中' },
            { value: 'finished', label: '已完成' },
            { value: 'attention', label: '失败或中断' },
          ]}
          onChange={setFilter}
        />
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

      {transcripts.length > 0 && (
        <SettingsSection title="录音转写" hint={`${transcripts.length} 条`}>
          <div className="space-y-2">
            {transcripts.map((item) => {
              const status = transcriptStatusView(item.status);
              const issue = formatTranscriptIssue(item);
              return (
                <SettingsListCard
                  key={item.id}
                  title={item.sourcePath}
                  subtitle={issue ?? (canOpenTranscript(item) ? `逐字稿：${item.transcriptPath}` : '尚未产出逐字稿')}
                  meta={formatTranscriptMeta(item)}
                  badge={<SettingsBadge tone={TRANSCRIPT_BADGE_TONE[status.tone]}>{status.label}</SettingsBadge>}
                />
              );
            })}
          </div>
        </SettingsSection>
      )}
    </SettingsPageShell>
  );
}
