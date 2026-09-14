import type {
  AgentSendPayload,
  AppearanceAssetSlot,
  BackgroundFitMode,
  EmbeddingSettingsPatch,
  ModelProfileInput,
  ModelProfilePatch,
  ModelProtocol,
  ModelSettingsPatch,
  WorkspaceAttachment,
} from './types';

export const MAX_AGENT_MESSAGE_CHARS = 100_000;
export const MAX_AGENT_ATTACHMENTS = 100;
export const MAX_WORKSPACE_ATTACHMENT_BYTES = 20 * 1024 * 1024;
/** 录音附件单独上限，与转写服务硬上限一致 */
export const MAX_WORKSPACE_AUDIO_ATTACHMENT_BYTES = 100 * 1024 * 1024;
const WORKSPACE_ATTACHMENT_KINDS = ['text', 'office', 'audio'] as const;

export function requireRecord(value: unknown, label = '参数'): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label}必须是对象`);
  }
  return value as Record<string, unknown>;
}

export function requireString(
  value: unknown,
  label: string,
  options: { allowEmpty?: boolean; maxLength?: number } = {},
): string {
  if (typeof value !== 'string') {
    throw new TypeError(`${label}必须是字符串`);
  }
  if (!options.allowEmpty && !value.trim()) {
    throw new TypeError(`${label}不能为空`);
  }
  if (options.maxLength !== undefined && value.length > options.maxLength) {
    throw new RangeError(`${label}超过长度限制`);
  }
  return value;
}

export function requireBoolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') {
    throw new TypeError(`${label}必须是布尔值`);
  }
  return value;
}

export function requireFiniteNumber(
  value: unknown,
  label: string,
  options: { min?: number; max?: number } = {},
): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(`${label}必须是有限数值`);
  }
  if (options.min !== undefined && value < options.min) {
    throw new RangeError(`${label}低于允许范围`);
  }
  if (options.max !== undefined && value > options.max) {
    throw new RangeError(`${label}超过允许范围`);
  }
  return value;
}

export function requireEnum<T extends string>(
  value: unknown,
  label: string,
  allowed: readonly T[],
): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    throw new TypeError(`${label}无效`);
  }
  return value as T;
}

function optionalString(
  input: Record<string, unknown>,
  key: string,
  maxLength: number,
): string | undefined {
  return input[key] === undefined
    ? undefined
    : requireString(input[key], key, { allowEmpty: true, maxLength });
}

function optionalProtocol(
  input: Record<string, unknown>,
): ModelProtocol | undefined {
  return input.protocol === undefined
    ? undefined
    : requireEnum(input.protocol, 'protocol', ['openai', 'anthropic'] as const);
}

export function parseModelProtocol(value: unknown): ModelProtocol {
  return requireEnum(value, 'protocol', ['openai', 'anthropic'] as const);
}

export function parseModelSettingsPatch(value: unknown): ModelSettingsPatch {
  const input = requireRecord(value, '模型设置');
  return {
    name: optionalString(input, 'name', 200),
    apiKey: optionalString(input, 'apiKey', 20_000),
    baseUrl: optionalString(input, 'baseUrl', 2_048),
    model: optionalString(input, 'model', 200),
    protocol: optionalProtocol(input),
  };
}

export function parseModelProfileInput(value: unknown): ModelProfileInput {
  const input = requireRecord(value, '模型配置');
  return {
    name: requireString(input.name, 'name', { allowEmpty: true, maxLength: 200 }),
    baseUrl: requireString(input.baseUrl, 'baseUrl', { allowEmpty: true, maxLength: 2_048 }),
    model: requireString(input.model, 'model', { allowEmpty: true, maxLength: 200 }),
    apiKey: optionalString(input, 'apiKey', 20_000),
    protocol: optionalProtocol(input),
  };
}

export function parseModelProfilePatch(value: unknown): ModelProfilePatch {
  return parseModelSettingsPatch(value);
}

export function parseEmbeddingSettingsPatch(value: unknown): EmbeddingSettingsPatch {
  const input = requireRecord(value, 'Embedding 设置');
  return {
    useChatApi: input.useChatApi === undefined
      ? undefined
      : requireBoolean(input.useChatApi, 'useChatApi'),
    baseUrl: optionalString(input, 'baseUrl', 2_048),
    model: optionalString(input, 'model', 200),
    apiKey: optionalString(input, 'apiKey', 20_000),
  };
}

export function parseBackgroundFit(value: unknown): BackgroundFitMode {
  return requireEnum(value, '背景适配方式', ['cover', 'contain'] as const);
}

export function parseAppearanceAssetSlot(value: unknown): AppearanceAssetSlot {
  return requireEnum(
    value,
    '外观资源位',
    ['background', 'keeperAvatar', 'userAvatar'] as const,
  );
}

function parseAttachment(value: unknown, index: number): WorkspaceAttachment {
  const input = requireRecord(value, `attachments[${index}]`);
  const relativePath = requireString(
    input.relativePath,
    `attachments[${index}].relativePath`,
    { maxLength: 1_000 },
  );
  const originalName = requireString(
    input.originalName,
    `attachments[${index}].originalName`,
    { maxLength: 255 },
  );
  const kind = input.kind === undefined
    ? undefined
    : requireEnum(input.kind, `attachments[${index}].kind`, WORKSPACE_ATTACHMENT_KINDS);
  const size = requireFiniteNumber(input.size, `attachments[${index}].size`, {
    min: 0,
    max: kind === 'audio' ? MAX_WORKSPACE_AUDIO_ATTACHMENT_BYTES : MAX_WORKSPACE_ATTACHMENT_BYTES,
  });
  return kind === undefined ? { relativePath, originalName, size } : { relativePath, originalName, size, kind };
}

export function parseAgentSendPayload(value: unknown): AgentSendPayload {
  const input = requireRecord(value, 'agent:send payload');
  const message = requireString(input.message, '消息', {
    allowEmpty: true,
    maxLength: MAX_AGENT_MESSAGE_CHARS,
  });
  const sessionId = input.sessionId === undefined
    ? undefined
    : requireString(input.sessionId, '会话 ID', { maxLength: 200 });

  if (input.attachments !== undefined && !Array.isArray(input.attachments)) {
    throw new TypeError('attachments必须是数组');
  }
  const rawAttachments = input.attachments ?? [];
  if (rawAttachments.length > MAX_AGENT_ATTACHMENTS) {
    throw new RangeError(`单次最多携带 ${MAX_AGENT_ATTACHMENTS} 个附件`);
  }
  const attachments = rawAttachments.map(parseAttachment);
  if (!message.trim() && attachments.length === 0) {
    throw new TypeError('消息和附件不能同时为空');
  }

  return { sessionId, message, attachments };
}

const WINDOW_KINDS = new Set(['chat', 'status', 'schedule', 'call']);

export type WindowKind = 'chat' | 'status' | 'schedule' | 'call';

export function parseWindowKind(value: unknown): WindowKind {
  if (typeof value !== 'string' || !WINDOW_KINDS.has(value)) {
    throw new TypeError('无效的窗口类型');
  }
  return value as WindowKind;
}

export function parsePermissionResponse(value: unknown): {
  requestId: string;
  approved: boolean;
} {
  const input = requireRecord(value, 'permission:respond payload');
  return {
    requestId: requireString(input.requestId, '权限请求 ID', { maxLength: 200 }),
    approved: requireBoolean(input.approved, '权限回复'),
  };
}
