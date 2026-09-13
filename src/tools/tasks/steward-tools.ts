import { claimBriefing, updateBriefing } from '../../db/repositories/briefings';
import {
  buildEveningReviewData,
  buildMorningBriefData,
  formatEveningReview,
  formatMorningBrief,
  summarizeEveningReview,
  summarizeMorningBrief,
} from '../../tasks/daily-steward';
import { formatLocalDate } from '../../tasks/due-date';
import type { ToolDefinition, ToolResult, ToolSideEffectContract } from '../types';
import type { BriefingKind } from '../../shared/types';

/** 只写 briefings 幂等记录与 missed 标记，本机可撤销。 */
const STEWARD_CONTRACT: ToolSideEffectContract = {
  risk: 'low',
  idempotent: true,
  supportsPreview: false,
  reversible: 'manual',
  evidence: 'output',
};

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function clockOf(timestamp: number): string {
  const date = new Date(timestamp);
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

interface StewardRunInput {
  kind: BriefingKind;
  label: string;
  force: boolean;
  runId?: string;
  build: () => { text: string; summary: string };
}

function runSteward(input: StewardRunInput): ToolResult {
  const briefDate = formatLocalDate();
  const claim = claimBriefing({ briefDate, kind: input.kind, runId: input.runId ?? null });
  if (!claim.created && !input.force) {
    return {
      success: true,
      output:
        `今天（${briefDate}）的${input.label}已在 ${clockOf(claim.briefing.createdAt)} 生成过` +
        `${claim.briefing.summary ? `：${claim.briefing.summary}` : ''}。如需重新生成，请传 force=true。`,
      metadata: { alreadyGenerated: true, briefingId: claim.briefing.id, briefDate },
    };
  }

  const built = input.build();
  updateBriefing(claim.briefing.id, {
    status: 'generated',
    summary: built.summary,
    ...(input.runId ? { runId: input.runId } : {}),
  });
  return {
    success: true,
    output: built.text,
    metadata: { alreadyGenerated: false, briefingId: claim.briefing.id, briefDate, regenerated: !claim.created },
  };
}

function readForce(args: unknown): boolean {
  return Boolean(args && typeof args === 'object' && (args as { force?: unknown }).force === true);
}

export const buildDailyBriefTool: ToolDefinition = {
  name: 'build_daily_brief',
  description:
    '聚合早间简报所需的数据：逾期与今日待办、今日提醒、到期与待确认承诺、目标进度，以及天气城市提示。' +
    '每天只生成一次；已生成时返回说明，用户明确要求重做时传 force=true。本工具不修改待办或提醒。',
  category: 'life',
  requiresPermission: [],
  sideEffects: STEWARD_CONTRACT,
  parameters: {
    type: 'object',
    properties: {
      force: { type: 'boolean', description: '今天已生成过时是否重新生成，默认 false' },
    },
  },
  async execute(args, ctx) {
    try {
      return runSteward({
        kind: 'morning',
        label: '早间简报',
        force: readForce(args),
        runId: ctx.runId,
        build: () => {
          const data = buildMorningBriefData();
          return { text: formatMorningBrief(data), summary: summarizeMorningBrief(data) };
        },
      });
    } catch (error) {
      return { success: false, output: '', error: error instanceof Error ? error.message : String(error) };
    }
  },
};

export const buildEveningReviewTool: ToolDefinition = {
  name: 'build_evening_review',
  description:
    '聚合晚间复盘所需的数据：今日完成与未完成的待办、兑现与错过的承诺、今日运行与产物清单。' +
    '会把到期仍未完成的承诺标为 missed。每天只生成一次；用户明确要求重做时传 force=true。',
  category: 'life',
  requiresPermission: [],
  sideEffects: STEWARD_CONTRACT,
  parameters: {
    type: 'object',
    properties: {
      force: { type: 'boolean', description: '今天已生成过时是否重新生成，默认 false' },
    },
  },
  async execute(args, ctx) {
    try {
      return runSteward({
        kind: 'evening',
        label: '晚间复盘',
        force: readForce(args),
        runId: ctx.runId,
        build: () => {
          const data = buildEveningReviewData();
          return { text: formatEveningReview(data), summary: summarizeEveningReview(data) };
        },
      });
    } catch (error) {
      return { success: false, output: '', error: error instanceof Error ? error.message : String(error) };
    }
  },
};
