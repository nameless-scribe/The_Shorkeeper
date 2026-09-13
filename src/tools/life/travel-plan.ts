import fs from 'node:fs/promises';
import path from 'node:path';
import type { ToolDefinition } from '../types';
import { WORKSPACE_WRITE_CONTRACT } from '../contract';
import { withFileArtifact, writeWorkspaceFileAtomically } from '../file/artifact';
import { resolveWorkspacePath } from '../file/workspace-path';

function buildItineraryMarkdown(input: {
  destination: string;
  days: number;
  budget?: string;
  interests?: string;
  notes?: string;
}): string {
  const lines = [
    `# ${input.destination} ${input.days} 日旅行规划`,
    '',
    `> 生成时间：${new Date().toLocaleString('zh-CN')}`,
    '',
    '## 概览',
    `- 目的地：${input.destination}`,
    `- 天数：${input.days} 天`,
  ];

  if (input.budget?.trim()) lines.push(`- 预算参考：${input.budget.trim()}`);
  if (input.interests?.trim()) lines.push(`- 兴趣偏好：${input.interests.trim()}`);
  if (input.notes?.trim()) lines.push(`- 备注：${input.notes.trim()}`);

  lines.push('', '## 每日行程（模板）');
  for (let d = 1; d <= input.days; d += 1) {
    lines.push(
      '',
      `### Day ${d}`,
      '- 上午：',
      '- 下午：',
      '- 晚上：',
      '- 交通 / 住宿提示：',
    );
  }

  lines.push(
    '',
    '## 行前清单',
    '- [ ] 证件与预订确认',
    '- [ ] 天气与穿衣',
    '- [ ] 常用 App / 离线地图',
    '',
    '## 灵活调整建议',
    '可根据实际天气、体力和当地活动动态调整行程密度。',
  );

  return lines.join('\n');
}

export const travelPlanTool: ToolDefinition = {
  name: 'travel_plan',
  description: '生成结构化旅行规划 Markdown 并保存到工作区',
  category: 'life',
  requiresPermission: ['filesystem:write'],
  sideEffects: WORKSPACE_WRITE_CONTRACT,
  parameters: {
    type: 'object',
    properties: {
      destination: { type: 'string', description: '目的地城市或地区' },
      days: { type: 'number', description: '旅行天数（1-30）' },
      budget: { type: 'string', description: '预算说明（可选）' },
      interests: { type: 'string', description: '兴趣偏好，如美食、博物馆（可选）' },
      notes: { type: 'string', description: '其他要求（可选）' },
      output_path: {
        type: 'string',
        description: '输出路径，默认 travel/{destination}-plan.md',
      },
    },
    required: ['destination', 'days'],
  },
  async execute(args, ctx) {
    const { destination, days, budget, interests, notes, output_path } = args as {
      destination?: string;
      days?: number;
      budget?: string;
      interests?: string;
      notes?: string;
      output_path?: string;
    };

    if (!destination?.trim()) {
      return { success: false, output: '', error: '缺少 destination' };
    }
    if (!days || days < 1 || days > 30) {
      return { success: false, output: '', error: 'days 需在 1-30 之间' };
    }

    const safeName = destination.trim().replace(/[^\w\u4e00-\u9fff-]+/g, '-');
    const filePath = output_path?.trim() || `travel/${safeName}-${days}d-plan.md`;
    const content = buildItineraryMarkdown({
      destination: destination.trim(),
      days,
      budget,
      interests,
      notes,
    });

    try {
      const artifact = await writeWorkspaceFileAtomically(
        ctx.workspaceRoot,
        filePath,
        (temporaryPath) => fs.writeFile(temporaryPath, content, 'utf-8'),
      );
      return withFileArtifact(
        {
          success: true,
          output: `已生成旅行规划：${filePath}\n\n${content}`,
        },
        artifact,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, output: '', error: message };
    }
  },
};
