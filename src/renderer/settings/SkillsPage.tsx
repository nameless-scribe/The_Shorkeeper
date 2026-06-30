import { useCallback, useEffect, useState } from 'react';
import type { SkillInfo } from '@/shared/types';
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

export function SkillsPage() {
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const list = await window.shorekeeper.skills.list();
    setSkills(list);
    setLoading(false);
  }, []);

  useEffect(() => {
    load().catch(console.error);
  }, [load]);

  const toggle = async (skill: SkillInfo) => {
    const updated = await window.shorekeeper.skills.toggle(skill.id, !skill.enabled);
    setSkills(updated);
  };

  if (loading) return <SettingsLoading />;

  return (
    <SettingsPageShell>
      <SettingsIntro>
        技能来自项目 <code className="rounded bg-keeper-navyDeep/60 px-1 py-0.5 text-keeper-cyan/90">skills/*/SKILL.md</code>。
        启用后注入 system prompt，并可限制可用工具；白名单外的工具（如定时提醒）将不可用。
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
                  skill.enabled ? (
                    <SettingsBadge tone="cyan">已启用</SettingsBadge>
                  ) : (
                    <SettingsBadge tone="muted">未启用</SettingsBadge>
                  )
                }
                meta={
                  skill.allowedTools?.length
                    ? `工具白名单：${skill.allowedTools.join(', ')}${skill.enabled ? '（启用后仅以上工具可用）' : ''}`
                    : undefined
                }
                actions={
                  <SettingsToggle
                    checked={skill.enabled}
                    onChange={() => void toggle(skill)}
                  />
                }
              />
            ))}
          </div>
        )}
      </SettingsSection>
    </SettingsPageShell>
  );
}
