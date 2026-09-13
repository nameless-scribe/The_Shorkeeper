import type { PermissionFlag } from '../agent/types';
import type { WorkspaceAttachment } from '../shared/types';

export interface JSONSchema {
  type: string;
  properties?: Record<string, unknown>;
  required?: string[];
  description?: string;
  [key: string]: unknown;
}

export interface ToolResult {
  success: boolean;
  output: string;
  error?: string;
  errorCategory?: ToolErrorCategory;
  metadata?: Record<string, unknown>;
  artifacts?: WorkspaceAttachment[];
}

export type ToolErrorCategory =
  | 'invalid_arguments'
  | 'permission_denied'
  | 'path_out_of_scope'
  | 'network_failure'
  | 'external_service_failure'
  | 'timeout'
  | 'cancelled'
  | 'internal_error';

export interface ToolContext {
  sessionId: string;
  workspaceRoot: string;
  signal: AbortSignal;
  runId?: string;
  /** 为 true 时工具只应描述将要发生的变更，不得产生副作用（需 sideEffects.supportsPreview）。 */
  preview?: boolean;
}

/**
 * 风险等级：
 * - read：无副作用，只读取或计算。
 * - low：只改变本机可随时修改/撤回的数据（记忆、记账、待办）。
 * - medium：改写工作区文件、创建后台任务或调用外部 MCP。
 * - high：发送、购买、删除外部数据等难以撤回的动作；无论策略如何都必须确认。
 */
export type ToolRiskLevel = 'read' | 'low' | 'medium' | 'high';

/** none：不可撤销；manual：留有备份/可反向操作；automatic：失败时自动回滚。 */
export type ToolReversibility = 'none' | 'manual' | 'automatic';

/** 工具完成后应提供的证据类型：artifact 表示必须返回可读回校验的工作区文件。 */
export type ToolEvidenceKind = 'none' | 'output' | 'artifact';

export interface ToolSideEffectContract {
  risk: ToolRiskLevel;
  /** 相同参数重复执行不会产生额外副作用；为 false 时同一 run 内重复调用会被合并。 */
  idempotent: boolean;
  supportsPreview: boolean;
  reversible: ToolReversibility;
  evidence: ToolEvidenceKind;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: JSONSchema;
  category: 'file' | 'web' | 'doc' | 'memory' | 'life' | 'mcp' | 'skill';
  requiresPermission: PermissionFlag[];
  /** 副作用契约；内置工具必须显式声明，动态工具（MCP）缺省时按权限推导保守值。 */
  sideEffects?: ToolSideEffectContract;
  /**
   * 一个工具多路复用多种动作（如 bookkeeping 的 add/list/summary）时，
   * 按本次参数覆盖契约字段，让只读动作不被当成副作用调用合并。
   */
  describeCall?(args: unknown): Partial<ToolSideEffectContract>;
  execute(args: unknown, ctx: ToolContext): Promise<ToolResult>;
}

export interface OpenAIToolSchema {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: JSONSchema;
  };
}
