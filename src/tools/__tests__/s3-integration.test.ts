import { describe, expect, it } from 'vitest';
import { createBuiltinRegistry } from '../builtin';

describe('S3 tool integration contract', () => {
  it('exposes the core file, document, RAG and automation tools', () => {
    const registry = createBuiltinRegistry();
    const tools = new Map(registry.list().map((tool) => [tool.name, tool]));

    for (const name of [
      'read_file',
      'write_file',
      'replace_text',
      'read_xlsx',
      'gen_xlsx',
      'update_xlsx_cells',
      'gen_docx',
      'gen_pdf',
      'convert_to_markdown',
      'search_knowledge',
      'create_scheduled_task',
      'delete_scheduled_task',
    ]) {
      expect(tools.has(name), `missing tool: ${name}`).toBe(true);
    }

    expect(tools.get('read_file')?.requiresPermission).toEqual(['filesystem:read']);
    expect(tools.get('write_file')?.requiresPermission).toEqual(['filesystem:write']);
    expect(tools.get('create_scheduled_task')?.requiresPermission).toEqual(['automation']);
    expect(tools.get('delete_scheduled_task')?.requiresPermission).toEqual(['automation']);
  });

  it('produces unique OpenAI schemas for every registered tool', () => {
    const schemas = createBuiltinRegistry().toOpenAITools();
    const names = schemas.map((schema) => schema.function.name);

    expect(new Set(names).size).toBe(names.length);
    expect(schemas.every((schema) => schema.type === 'function')).toBe(true);
  });
});
