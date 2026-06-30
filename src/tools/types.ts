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
  artifacts?: WorkspaceAttachment[];
}

export interface ToolContext {
  sessionId: string;
  workspaceRoot: string;
  signal: AbortSignal;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: JSONSchema;
  category: 'file' | 'web' | 'doc' | 'memory' | 'life' | 'mcp' | 'skill';
  requiresPermission: PermissionFlag[];
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
