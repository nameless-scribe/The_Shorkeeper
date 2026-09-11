import { completeChat } from '../models/complete-chat';
import { awaitWithAbort, createLinkedTimeoutSignal } from '../agent/abort';

const HYDE_PROMPT = `根据用户问题，写一段可能出现在知识库文档中的简短段落（2-4 句），用于检索相似内容。只输出段落正文，不要解释。`;
export const DEFAULT_HYDE_TIMEOUT_MS = 30_000;

export async function generateHydeQuery(
  userQuery: string,
  signal?: AbortSignal,
): Promise<string> {
  const timeout = createLinkedTimeoutSignal(signal, DEFAULT_HYDE_TIMEOUT_MS);
  try {
    const reply = await awaitWithAbort(completeChat([
      { role: 'system', content: HYDE_PROMPT },
      { role: 'user', content: userQuery },
    ], undefined, { signal: timeout.signal }), timeout.signal);
    return reply.trim();
  } catch (error) {
    if (timeout.didTimeout()) throw new Error('HyDE 请求超时');
    if (signal?.aborted) throw new Error('已取消');
    throw error;
  } finally {
    timeout.dispose();
  }
}
