import type { ToolDefinition } from '../types';
import { READ_ONLY_CONTRACT } from '../contract';

interface MyMemoryResponse {
  responseData?: { translatedText?: string };
  responseStatus?: number;
  responseDetails?: string;
}

export const translateTool: ToolDefinition = {
  name: 'translate',
  description: '将文本翻译为目标语言（支持常见语言对，如 en↔zh）',
  category: 'web',
  requiresPermission: ['network'],
  sideEffects: READ_ONLY_CONTRACT,
  parameters: {
    type: 'object',
    properties: {
      text: {
        type: 'string',
        description: '待翻译文本',
      },
      target_lang: {
        type: 'string',
        description: '目标语言代码，如 zh-CN、en、ja',
      },
      source_lang: {
        type: 'string',
        description: '源语言代码，默认自动检测（auto）',
      },
    },
    required: ['text', 'target_lang'],
  },
  async execute(args, ctx) {
    const { text, target_lang, source_lang = 'auto' } = args as {
      text?: string;
      target_lang?: string;
      source_lang?: string;
    };

    if (!text?.trim()) {
      return { success: false, output: '', error: '缺少 text 参数' };
    }
    if (!target_lang?.trim()) {
      return { success: false, output: '', error: '缺少 target_lang 参数' };
    }

    if (ctx.signal.aborted) {
      return { success: false, output: '', error: '已取消' };
    }

    try {
      const langpair = `${source_lang}|${target_lang.trim()}`;
      const url =
        `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}` +
        `&langpair=${encodeURIComponent(langpair)}`;

      const response = await fetch(url, { signal: ctx.signal });
      if (!response.ok) {
        return { success: false, output: '', error: `翻译请求失败: HTTP ${response.status}` };
      }

      const data = (await response.json()) as MyMemoryResponse;
      const translated = data.responseData?.translatedText?.trim();

      if (!translated || data.responseStatus !== 200) {
        return {
          success: false,
          output: '',
          error: data.responseDetails ?? '翻译失败',
        };
      }

      return {
        success: true,
        output: translated,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, output: '', error: message };
    }
  },
};
