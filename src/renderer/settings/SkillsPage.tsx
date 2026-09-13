import { useCallback, useEffect, useState } from 'react';
import type { SkillInfo } from '@/shared/types';
import type { RunTelemetrySnapshot } from '@/agent/run-observability';
import { SettingsToggle } from './components/SettingsToggle';
import {
  SettingsBadge,
  SettingsEmpty,
  SettingsIntro,
  SettingsListCard,
  SettingsLoading,
  SettingsPageShell,
  SettingsSection,
} from './components/settings-ui';

function triggerLabel(trigger: SkillInfo['trigger']): string {
  return trigger === 'auto' ? '按需' : '常驻';
}

const RUN_PHASE_LABELS: Record<RunTelemetrySnapshot['phase'], string> = {
  created: '已创建',
  running: '运行中',
  waiting_tool: '调用工具',
  finalizing: '收尾中',
  finished: '完成',
  cancelled: '取消',
  error: '失败',
};

export function SkillsPage() {
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [runs, setRuns] = useState<RunTelemetrySnapshot[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const list = await window.shorekeeper.skills.list();
    setSkills(list);
    setLoading(false);
  }, []);

  const loadDiagnostics = useCallback(async () => {
    const result = await window.shorekeeper.agent.diagnostics({ limit: 5 });
    setRuns(Array.isArray(result) ? result : result ? [result] : []);
  }, []);

  useEffect(() => {
    load().catch(console.error);
    loadDiagnostics().catch(console.error);
    const off = window.shorekeeper.agent.onEvent((event) => {
      const item = event as { type?: string };
      if (item.type === 'run_finished' || item.type === 'run_error') {
        loadDiagnostics().catch(console.error);
      }
    });
    return off;
  }, [load, loadDiagnostics]);

  const toggle = async (skill: SkillInfo) => {
    const updated = await window.shorekeeper.skills.toggle(skill.id, !skill.enabled);
    setSkills(updated);
  };

  if (loading) return <SettingsLoading />;

  return (
    <SettingsPageShell>
      <SettingsIntro>
        技能来自内置 <code className="rounded bg-keeper-navyDeep/60 px-1 py-0.5 text-keeper-cyan/90">skills/*/SKILL.md</code>（开发时在项目根目录，安装包内已一并打包）。
        <strong>常驻</strong>技能启用后每轮注入；<strong>按需</strong>技能仅在用户消息命中明确意图时注入。
        若技能配置了工具白名单，**多个技能同时启用时，可用工具为各白名单的并集**；未配置白名单的技能不限制工具。
      </SettingsIntro>

      <SettingsSection title="已安装技能" hint={`${skills.length} 个`}>
        {skills.length === 0 ? (
          <SettingsEmpty title="未发现技能包" hint="可参考 skills/example/SKILL.md 添加" />
        ) : (
          <div className="space-y-2">
            {skills.map((skill) => (
              <SettingsListCard
                key={skill.id}
                title={skill.name}
                subtitle={skill.description || skill.id}
                badge={
                  <>
                    {skill.enabled ? (
                      <SettingsBadge tone="cyan">已启用</SettingsBadge>
                    ) : (
                      <SettingsBadge tone="muted">未启用</SettingsBadge>
                    )}
                    <SettingsBadge tone={skill.trigger === 'auto' ? 'muted' : 'cyan'}>
                      {triggerLabel(skill.trigger)}
                    </SettingsBadge>
                    {skill.validationErrors.length > 0 && (
                      <SettingsBadge tone="amber">配置无效</SettingsBadge>
                    )}
                  </>
                }
                meta={[
                  skill.trigger === 'auto' && skill.matchKeywords?.length
                    ? `触发词：${skill.matchKeywords.join('、')}`
                    : null,
                  skill.allowedTools?.length
                    ? `工具白名单：${skill.allowedTools.join(', ')}${
                        skill.enabled
                          ? '（与其他带白名单的技能合并为并集）'
                          : ''
                      }`
                    : null,
                  skill.requiredTools?.length
                    ? `必需工具：${skill.requiredTools.join(', ')}`
                    : null,
                  skill.validationErrors.length
                    ? `错误：${skill.validationErrors.join('；')}`
                    : null,
                  skill.id === 'example' && skill.enabled
                    ? '演示技能建议单独启用，与其他带白名单技能并存会放宽工具限制'
                    : null,
                ]
                  .filter(Boolean)
                  .join(' · ') || undefined}
                actions={
                  <SettingsToggle
                    checked={skill.enabled && skill.validationErrors.length === 0}
                    disabled={skill.validationErrors.length > 0}
                    onChange={() => void toggle(skill)}
                  />
                }
              />
            ))}
          </div>
        )}
      </SettingsSection>

      <SettingsSection
        title="最近运行诊断"
        hint="仅保存在本次应用运行期间，不记录用户正文"
      >
        {runs.length === 0 ? (
          <SettingsEmpty title="暂无运行记录" hint="完成一次对话后可在这里查看 Skill 路由和工具结果" />
        ) : (
          <div className="space-y-2">
            {runs.map((run) => {
              const decisions = run.skillDecisions
                .filter((decision) => decision.status !== 'not_matched')
                .map((decision) => `${decision.skillName}：${decision.reason}`);
              return (
                <SettingsListCard
                  key={run.runId}
                  title={`${RUN_PHASE_LABELS[run.phase]} · ${run.durationMs ?? 0}ms`}
                  subtitle={`工具 ${run.toolCallCount} 次，失败 ${run.toolFailureCount} 次`}
                  badge={
                    <SettingsBadge tone={run.phase === 'finished' ? 'cyan' : run.phase === 'error' ? 'amber' : 'muted'}>
                      {run.activeSkillIds.length ? run.activeSkillIds.join(' + ') : '无 Skill'}
                    </SettingsBadge>
                  }
                  meta={[
                    ...decisions,
                    ...run.skillWarnings,
                    run.errorCategory ? `错误类别：${run.errorCategory}` : null,
                  ].filter(Boolean).join(' · ') || '本轮没有 Skill 路由或运行警告'}
                />
              );
            })}
          </div>
        )}
      </SettingsSection>
    </SettingsPageShell>
  );
}
