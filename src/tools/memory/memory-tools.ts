import type { ToolDefinition } from '../types';
import { LOCAL_UPSERT_CONTRACT, READ_ONLY_CONTRACT } from '../contract';
import { searchMemories, searchMemoriesWithEmbedding, saveMemory, upsertMemory, formatMemoriesForPrompt } from '../../memory/long-term';
import { searchWorldbook, formatWorldbookForPrompt } from '../../memory/worldbook';
import { getCurrentMemoryByKey } from '../../db/repositories/long-term-memory';
import { createMemoryCandidate } from '../../db/repositories/memory-candidates';
import {
  assessMemoryFactRelation,
  evaluateMemoryCandidate,
  isCredentialLikeMemory,
} from '../../memory/candidate-policy';
import { stageMemoryConflict } from '../../memory/personal-memory-service';

export const recallMemoryTool: ToolDefinition = {
  name: 'recall_memory',
  description: '按关键词检索长期记忆，用于回忆用户偏好、习惯或过往重要事实',
  category: 'memory',
  requiresPermission: [],
  sideEffects: READ_ONLY_CONTRACT,
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: '检索关键词或短语',
      },
      limit: {
        type: 'number',
        description: '最多返回条数，默认 5',
      },
    },
    required: ['query'],
  },
  async execute(args) {
    const { query, limit } = args as { query?: string; limit?: number };
    if (!query?.trim()) {
      return { success: false, output: '', error: '缺少 query 参数' };
    }

    const memories = await searchMemoriesWithEmbedding(query, limit ?? 5);
    if (!memories.length) {
      return { success: true, output: '未找到相关长期记忆。' };
    }

    const formatted = formatMemoriesForPrompt(memories);
    return { success: true, output: formatted ?? '' };
  },
};

export const searchWorldbookTool: ToolDefinition = {
  name: 'search_worldbook',
  description: '搜索世界观 / 角色背景设定（Worldbook）条目',
  category: 'memory',
  requiresPermission: [],
  sideEffects: READ_ONLY_CONTRACT,
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: '搜索关键词',
      },
      limit: {
        type: 'number',
        description: '最多返回条数，默认 5',
      },
    },
    required: ['query'],
  },
  async execute(args) {
    const { query, limit } = args as { query?: string; limit?: number };
    if (!query?.trim()) {
      return { success: false, output: '', error: '缺少 query 参数' };
    }

    const entries = searchWorldbook(query, limit ?? 5);
    if (!entries.length) {
      return { success: true, output: '未找到相关 Worldbook 条目。' };
    }

    const formatted = formatWorldbookForPrompt(entries);
    return { success: true, output: formatted ?? '' };
  },
};

export const saveMemoryTool: ToolDefinition = {
  name: 'save_memory',
  description: '将值得长期记住的用户相关事实写入记忆库',
  category: 'memory',
  requiresPermission: [],
  sideEffects: LOCAL_UPSERT_CONTRACT,
  parameters: {
    type: 'object',
    properties: {
      content: {
        type: 'string',
        description: '要记住的事实描述',
      },
      key: {
        type: 'string',
        description:
          '记忆键，如 user.nickname、user.preference.drink；同一 key 会更新而非重复插入',
      },
      importance: {
        type: 'number',
        description: '重要程度 0-1，默认 0.6',
      },
    },
    required: ['content'],
  },
  async execute(args, ctx) {
    const { content, importance, key } = args as {
      content?: string;
      importance?: number;
      key?: string;
    };
    if (!content?.trim()) {
      return { success: false, output: '', error: '缺少 content 参数' };
    }

    if (key?.trim()) {
      const evaluation = evaluateMemoryCandidate({
        key: key.trim(),
        content,
        confidence: importance ?? 0.6,
        reason: '助手通过 save_memory 工具提出',
      });
      if (evaluation.decision === 'deny') {
        return {
          success: false,
          output: '',
          error: '该内容无法按个人记忆安全策略保存；凭据、无法分类或过长内容会被拒绝。',
          errorCategory: 'invalid_arguments',
        };
      }

      const existing = getCurrentMemoryByKey(evaluation.key);
      if (existing) {
        const relation = assessMemoryFactRelation(
          evaluation.key,
          evaluation.content,
          existing.memoryKey ?? '',
          existing.content,
        );
        if (relation === 'duplicate') {
          return { success: true, output: '该事实已经存在，未重复保存。' };
        }
        const staged = stageMemoryConflict({
          memoryKey: evaluation.key,
          content: evaluation.content,
          category: evaluation.category,
          confidence: evaluation.confidence,
          reason: evaluation.reason,
          sourceSessionId: ctx.sessionId,
          sourceRunId: ctx.runId ?? null,
          memoryType: evaluation.memoryType,
          sensitivity: evaluation.sensitivity,
          modelUsePolicy: evaluation.modelUsePolicy,
          conflictsWithMemoryId: existing.id,
          proposedAction: relation === 'supplement' ? 'merge' : 'replace',
        });
        return staged
          ? { success: true, output: '发现与现有记忆冲突，已提交到“待确认记忆”，未覆盖原事实。' }
          : { success: true, output: '该冲突候选已处理或被拒绝，未覆盖原事实。' };
      }

      if (evaluation.decision === 'confirm') {
        const candidate = createMemoryCandidate({
          memoryKey: evaluation.key,
          content: evaluation.content,
          category: evaluation.category,
          confidence: evaluation.confidence,
          reason: evaluation.reason,
          sourceSessionId: ctx.sessionId,
          sourceRunId: ctx.runId ?? null,
          memoryType: evaluation.memoryType,
          sensitivity: evaluation.sensitivity,
          modelUsePolicy: evaluation.modelUsePolicy,
        });
        return candidate
          ? { success: true, output: '该事实需要用户确认，已提交到“待确认记忆”。' }
          : { success: true, output: '该事实候选已处理或被拒绝，未重复提交。' };
      }

      const entry = await upsertMemory(
        evaluation.key,
        evaluation.content,
        evaluation.confidence,
        ctx.sessionId,
        {
          skipEmbedding: true,
          memoryType: evaluation.memoryType,
          confidence: evaluation.confidence,
          sensitivity: evaluation.sensitivity,
          modelUsePolicy: evaluation.modelUsePolicy,
          sourceRunId: ctx.runId ?? null,
        },
      );
      return { success: true, output: `已保存记忆 [${entry.memoryKey}]：${entry.content}` };
    }

    if (isCredentialLikeMemory('user.other', content)) {
      return {
        success: false,
        output: '',
        error: '密码、Token、验证码、密钥和证件/银行卡号码不能保存为长期记忆。',
        errorCategory: 'invalid_arguments',
      };
    }
    const entry = await saveMemory(content, importance ?? 0.6, ctx.sessionId);
    if (!entry) {
      return {
        success: true,
        output: '该记忆与已有条目相近，未重复保存。',
      };
    }
    return { success: true, output: `已保存记忆：${entry.content}` };
  },
};
