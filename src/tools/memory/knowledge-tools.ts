import type { ToolDefinition } from '../types';
import { listIndexedDocuments } from '../../rag/documents';
import {
  formatDocumentCatalogForPrompt,
  formatRagChunksForTool,
  retrieveRelevantChunks,
} from '../../rag/retriever';

export const searchKnowledgeTool: ToolDefinition = {
  name: 'search_knowledge',
  description:
    '检索用户在设置中导入的知识库文档（RAG）。无 query 时列出已导入文档；有 query 时按语义搜索相关片段。讨论业务需求、功能清单、OA 等内容时应优先调用。',
  category: 'memory',
  requiresPermission: [],
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: '检索关键词或问题；省略则仅列出知识库中的文档清单',
      },
      limit: {
        type: 'number',
        description: '最多返回片段数，默认 5',
      },
    },
  },
  async execute(args) {
    const { query, limit } = args as { query?: string; limit?: number };
    const documents = listIndexedDocuments();

    if (!documents.length) {
      return { success: true, output: '知识库中暂无导入文档（设置 → 泰提斯终端 → 导入 MD/TXT）。' };
    }

    if (!query?.trim()) {
      const catalog = formatDocumentCatalogForPrompt(documents);
      return { success: true, output: catalog ?? '知识库为空。' };
    }

    try {
      const chunks = await retrieveRelevantChunks(query, limit ?? 5, { skipCache: true });
      if (!chunks.length) {
        return {
          success: true,
          output: `知识库中有 ${documents.length} 份文档，但未找到与「${query.trim()}」足够相关的片段。可换更具体的关键词重试。`,
        };
      }
      return { success: true, output: formatRagChunksForTool(chunks) };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, output: '', error: message };
    }
  },
};
