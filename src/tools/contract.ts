import type { ToolDefinition, ToolSideEffectContract } from './types';

/** 只读工具：检索、读取、查询。 */
export const READ_ONLY_CONTRACT: ToolSideEffectContract = {
  risk: 'read',
  idempotent: true,
  supportsPreview: false,
  reversible: 'none',
  evidence: 'output',
};

/** 写工作区文件并返回产物：相同内容重复写入不产生额外副作用，旧文件有备份或原子恢复。 */
export const WORKSPACE_WRITE_CONTRACT: ToolSideEffectContract = {
  risk: 'medium',
  idempotent: true,
  supportsPreview: false,
  reversible: 'manual',
  evidence: 'artifact',
};

/** 本机数据库的追加型写入（记账、新建待办等）：重复调用会产生重复记录。 */
export const LOCAL_APPEND_CONTRACT: ToolSideEffectContract = {
  risk: 'low',
  idempotent: false,
  supportsPreview: false,
  reversible: 'manual',
  evidence: 'output',
};

/** 本机数据库的按键更新（同键 upsert、按 id 更新）。 */
export const LOCAL_UPSERT_CONTRACT: ToolSideEffectContract = {
  risk: 'low',
  idempotent: true,
  supportsPreview: false,
  reversible: 'manual',
  evidence: 'output',
};

/**
 * 未显式声明时按权限推导保守契约。动态注册的 MCP 工具无法自描述副作用，
 * 因此默认视为中风险、非幂等、不可撤销。
 */
export function deriveToolContract(tool: Pick<ToolDefinition, 'requiresPermission'>): ToolSideEffectContract {
  const flags = new Set(tool.requiresPermission);
  if (flags.has('shell')) {
    return { risk: 'high', idempotent: false, supportsPreview: false, reversible: 'none', evidence: 'output' };
  }
  if (flags.has('mcp')) {
    return { risk: 'medium', idempotent: false, supportsPreview: false, reversible: 'none', evidence: 'output' };
  }
  if (flags.has('filesystem:write')) {
    return { ...WORKSPACE_WRITE_CONTRACT, idempotent: false, evidence: 'output' };
  }
  if (flags.has('automation')) {
    return { risk: 'medium', idempotent: false, supportsPreview: false, reversible: 'manual', evidence: 'output' };
  }
  return READ_ONLY_CONTRACT;
}

export function resolveToolContract(tool: ToolDefinition): ToolSideEffectContract {
  return tool.sideEffects ?? deriveToolContract(tool);
}

/** 本次调用的有效契约：工具级声明叠加按参数的覆盖（describeCall 抛错时忽略覆盖）。 */
export function resolveCallContract(tool: ToolDefinition, args: unknown): ToolSideEffectContract {
  const base = resolveToolContract(tool);
  if (!tool.describeCall) return base;
  try {
    return { ...base, ...tool.describeCall(args) };
  } catch {
    return base;
  }
}

/** 高风险工具无论权限策略如何都必须经过用户确认。 */
export function requiresMandatoryConfirmation(contract: ToolSideEffectContract): boolean {
  return contract.risk === 'high';
}

/** 副作用工具在同一 run 内以完全相同参数再次调用时，是否应合并而不重复执行。 */
export function shouldSuppressDuplicateCall(contract: ToolSideEffectContract): boolean {
  return contract.risk !== 'read' && !contract.idempotent;
}
