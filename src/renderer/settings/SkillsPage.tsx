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
        技能来自内置 <code className="rounded bg-keeper-navyDeep/60 px-1 py-0.5 text-keeper-cyan/90">skills/*/SKILL.md</code>（开发时在项目根目录，安装包内已一并打包）。
        启用后注入 system prompt。若技能配置了工具白名单，**多个技能同时启用时，可用工具为各白名单的并集**（取所有已启用技能允许的工具）；未配置白名单的技能不限制工具。
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
                    ? `工具白名单：${skill.allowedTools.join(', ')}${
                        skill.enabled
                          ? '（与其他带白名单的技能合并为并集）'
                          : ''
                      }`
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
