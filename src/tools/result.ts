import type { ToolErrorCategory, ToolResult } from './types';

const TOOL_ERROR_CATEGORIES = new Set<ToolErrorCategory>([
  'invalid_arguments',
  'permission_denied',
  'path_out_of_scope',
  'network_failure',
  'external_service_failure',
  'timeout',
  'cancelled',
  'internal_error',
]);

export function classifyToolError(message: string): ToolErrorCategory {
  if (/已取消|取消|abort|aborted|cancelled/i.test(message)) return 'cancelled';
  if (/超时|timeout|timed out/i.test(message)) return 'timeout';
  if (/权限|拒绝|permission|denied/i.test(message)) return 'permission_denied';
  if (/越界|工作区外|workspace.*(?:外|outside)|path.*outside/i.test(message)) {
    return 'path_out_of_scope';
  }
  if (/网络|network|fetch|dns|连接失败|connection/i.test(message)) {
    return 'network_failure';
  }
  if (/HTTP\s*\d{3}|API|MCP|外部服务|服务不可用|未配置.*Key/i.test(message)) {
    return 'external_service_failure';
  }
  if (/参数|JSON|格式|无效|缺少|需要|未知 action|unknown tool/i.test(message)) {
    return 'invalid_arguments';
  }
  return 'internal_error';
}

export function createToolError(
  error: string,
  errorCategory: ToolErrorCategory = classifyToolError(error),
  metadata?: Record<string, unknown>,
): ToolResult {
  return {
    success: false,
    output: '',
    error: error || '工具执行失败',
    errorCategory,
    ...(metadata ? { metadata } : {}),
  };
}

function isToolErrorCategory(value: unknown): value is ToolErrorCategory {
  return typeof value === 'string' && TOOL_ERROR_CATEGORIES.has(value as ToolErrorCategory);
}

/** 统一收口工具边界，避免工具返回 malformed result 或无分类错误。 */
export function normalizeToolResult(value: unknown, fallbackError = '工具执行失败'): ToolResult {
  if (!value || typeof value !== 'object') {
    return createToolError(fallbackError, 'internal_error');
  }

  const candidate = value as Partial<ToolResult>;
  const output = typeof candidate.output === 'string' ? candidate.output : '';
  const metadata = candidate.metadata && typeof candidate.metadata === 'object'
    ? candidate.metadata as Record<string, unknown>
    : undefined;
  const artifacts = Array.isArray(candidate.artifacts) ? candidate.artifacts : undefined;

  if (candidate.success === true) {
    return {
      success: true,
      output,
      ...(metadata ? { metadata } : {}),
      ...(artifacts ? { artifacts } : {}),
    };
  }

  const error = typeof candidate.error === 'string' && candidate.error.trim()
    ? candidate.error
    : fallbackError;
  return {
    success: false,
    output,
    error,
    errorCategory: isToolErrorCategory(candidate.errorCategory)
      ? candidate.errorCategory
      : classifyToolError(error),
    ...(metadata ? { metadata } : {}),
    ...(artifacts ? { artifacts } : {}),
  };
}
