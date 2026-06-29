import { describe, expect, it } from 'vitest';
import { mcpToolName } from '../client';

describe('mcpToolName', () => {
  it('prefixes server and tool names', () => {
    expect(mcpToolName('filesystem', 'read_file')).toBe('mcp__filesystem__read_file');
  });

  it('sanitizes unsafe characters', () => {
    expect(mcpToolName('my server!', 'tool/name')).toBe('mcp__my_server__tool_name');
  });
});
