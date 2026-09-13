import { describe, expect, it } from 'vitest';
import { createBuiltinRegistry } from '../builtin';
import {
  deriveToolContract,
  requiresMandatoryConfirmation,
  resolveCallContract,
  resolveToolContract,
  shouldSuppressDuplicateCall,
} from '../contract';
import { contractFromMcpAnnotations } from '../../mcp/client';
import type { ToolDefinition } from '../types';

describe('tool side-effect contract', () => {
  const tools = createBuiltinRegistry().list();

  it('requires every builtin tool to declare its contract explicitly', () => {
    const missing = tools.filter((tool) => !tool.sideEffects).map((tool) => tool.name);
    expect(missing).toEqual([]);
  });

  it('keeps declarations consistent with permission flags', () => {
    for (const tool of tools) {
      const contract = resolveToolContract(tool);
      const writes = tool.requiresPermission.includes('filesystem:write');
      const automation = tool.requiresPermission.includes('automation');
      if (writes || automation) {
        expect(contract.risk, `${tool.name} 声明了写权限却标记为只读`).not.toBe('read');
      }
      if (contract.risk === 'read') {
        expect(contract.idempotent, `${tool.name} 只读工具必须幂等`).toBe(true);
        expect(contract.evidence, `${tool.name} 只读工具不应要求文件产物`).not.toBe('artifact');
      }
    }
  });

  it('marks every workspace-writing tool as producing artifact evidence', () => {
    const artifactTools = tools
      .filter((tool) => resolveToolContract(tool).evidence === 'artifact')
      .map((tool) => tool.name)
      .sort();
    expect(artifactTools).toEqual([
      'convert_to_markdown',
      'gen_docx',
      'gen_markdown',
      'gen_pdf',
      'gen_xlsx',
      'replace_text',
      'travel_plan',
      'update_xlsx_cells',
      'write_file',
    ]);
  });

  it('limits dry-run support to tools that implement a revision-checked preview', () => {
    const previewable = tools
      .filter((tool) => resolveToolContract(tool).supportsPreview)
      .map((tool) => tool.name)
      .sort();
    expect(previewable).toEqual(['replace_text', 'update_xlsx_cells', 'write_file']);
  });

  it('suppresses duplicate calls only for non-idempotent side-effect tools', () => {
    const byName = new Map(tools.map((tool) => [tool.name, resolveToolContract(tool)]));
    expect(shouldSuppressDuplicateCall(byName.get('create_scheduled_task')!)).toBe(true);
    expect(shouldSuppressDuplicateCall(byName.get('bookkeeping')!)).toBe(true);
    expect(shouldSuppressDuplicateCall(byName.get('create_user_task')!)).toBe(true);
    expect(shouldSuppressDuplicateCall(byName.get('write_file')!)).toBe(false);
    expect(shouldSuppressDuplicateCall(byName.get('list_dir')!)).toBe(false);
    expect(shouldSuppressDuplicateCall(byName.get('delete_scheduled_task')!)).toBe(false);
  });

  it('derives a conservative contract for undeclared dynamic tools', () => {
    const base: Omit<ToolDefinition, 'requiresPermission'> = {
      name: 'dynamic',
      description: 'test',
      parameters: { type: 'object' },
      category: 'mcp',
      execute: async () => ({ success: true, output: '' }),
    };
    expect(deriveToolContract({ requiresPermission: ['mcp'] })).toMatchObject({
      risk: 'medium',
      idempotent: false,
      reversible: 'none',
    });
    expect(deriveToolContract({ requiresPermission: ['shell'] }).risk).toBe('high');
    expect(deriveToolContract({ requiresPermission: ['filesystem:write'] })).toMatchObject({
      risk: 'medium',
      idempotent: false,
      evidence: 'output',
    });
    expect(deriveToolContract({ requiresPermission: ['network'] }).risk).toBe('read');
    expect(resolveToolContract({ ...base, requiresPermission: ['mcp'] }).risk).toBe('medium');
    expect(
      resolveToolContract({
        ...base,
        requiresPermission: [],
        sideEffects: { risk: 'high', idempotent: false, supportsPreview: false, reversible: 'none', evidence: 'output' },
      }).risk,
    ).toBe('high');
  });

  it('lets a multiplexed tool downgrade read actions per call', () => {
    const bookkeeping = tools.find((tool) => tool.name === 'bookkeeping')!;
    expect(resolveCallContract(bookkeeping, { action: 'add', amount: 1 })).toMatchObject({ risk: 'low', idempotent: false });
    expect(resolveCallContract(bookkeeping, { action: 'summary' })).toMatchObject({ risk: 'read', idempotent: true });
    expect(shouldSuppressDuplicateCall(resolveCallContract(bookkeeping, { action: 'list' }))).toBe(false);
    expect(shouldSuppressDuplicateCall(resolveCallContract(bookkeeping, { action: 'add' }))).toBe(true);
    const throwing: ToolDefinition = {
      ...bookkeeping,
      describeCall: () => {
        throw new Error('boom');
      },
    };
    expect(resolveCallContract(throwing, {})).toEqual(resolveToolContract(bookkeeping));
  });

  it('maps MCP annotations and never merges calls of tools whose idempotency is unknown', () => {
    expect(contractFromMcpAnnotations(undefined)).toMatchObject({ risk: 'medium', idempotent: true });
    expect(shouldSuppressDuplicateCall(contractFromMcpAnnotations(undefined)!)).toBe(false);
    expect(contractFromMcpAnnotations({ readOnlyHint: true })).toMatchObject({ risk: 'read', idempotent: true });
    expect(contractFromMcpAnnotations({ idempotentHint: false })).toMatchObject({ risk: 'medium', idempotent: false });
    expect(shouldSuppressDuplicateCall(contractFromMcpAnnotations({ idempotentHint: false })!)).toBe(true);
  });

  it('only high-risk tools require confirmation regardless of policy', () => {
    expect(requiresMandatoryConfirmation({ risk: 'high', idempotent: false, supportsPreview: false, reversible: 'none', evidence: 'output' })).toBe(true);
    expect(requiresMandatoryConfirmation({ risk: 'medium', idempotent: false, supportsPreview: false, reversible: 'none', evidence: 'output' })).toBe(false);
    expect(tools.filter((tool) => resolveToolContract(tool).risk === 'high')).toEqual([]);
  });
});
