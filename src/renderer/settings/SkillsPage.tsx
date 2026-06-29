import { useCallback, useEffect, useState } from 'react';
import type { SkillInfo } from '@/shared/types';

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

  if (loading) {
    return <p className="text-sm text-keeper-ice/60">加载中…</p>;
  }

  return (
    <div className="space-y-4">
      <p className="text-xs leading-relaxed text-keeper-ice/65">
        技能来自项目 <code className="text-keeper-cyan">skills/*/SKILL.md</code>。启用后会把说明片段注入 system prompt，并可限制可用工具。
      </p>

      {skills.length === 0 && (
        <p className="text-xs text-keeper-ice/50">未发现技能包。可参考 skills/example/SKILL.md 添加。</p>
      )}

      <div className="space-y-2">
        {skills.map((skill) => (
          <div key={skill.id} className="keeper-glass-soft rounded-xl p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-keeper-ice">{skill.name}</p>
                <p className="mt-1 text-xs text-keeper-ice/55">{skill.description || skill.id}</p>
                {skill.allowedTools?.length ? (
                  <p className="mt-1 text-[10px] text-keeper-ice/40">
                    工具白名单：{skill.allowedTools.join(', ')}
                  </p>
                ) : null}
              </div>
              <button
                type="button"
                onClick={() => void toggle(skill)}
                className={`shrink-0 rounded-lg px-3 py-1.5 text-xs ${
                  skill.enabled
                    ? 'bg-keeper-cyan/25 text-keeper-cyan'
                    : 'bg-keeper-silver/10 text-keeper-ice/60 hover:text-keeper-ice'
                }`}
              >
                {skill.enabled ? '已启用' : '启用'}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
