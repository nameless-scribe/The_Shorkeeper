import { getDatabase } from '../db';
import { embedText } from '../rag/embedding';
import { serializeEmbedding } from '../rag/vector';

const reembedQueue = new Map<string, Promise<void>>();

/** 异步补全 memory_key 对应 embedding，不阻塞主流程。 */
export function queueMemoryReembed(memoryKey: string, content: string): void {
  const key = memoryKey.trim();
  const trimmed = content.trim();
  if (!key || !trimmed) return;

  const prev = reembedQueue.get(key);
  const job = (async () => {
    if (prev) await prev.catch(() => undefined);
    try {
      const vec = await embedText(trimmed);
      const blob = serializeEmbedding(vec);
      getDatabase()
        .prepare(`UPDATE long_term_memory SET embedding = ? WHERE memory_key = ?`)
        .run(blob, key);
    } catch (err) {
      console.warn('[memory] 异步 re-embed 失败:', key, err);
    }
  })();

  reembedQueue.set(key, job);
  void job.finally(() => {
    if (reembedQueue.get(key) === job) {
      reembedQueue.delete(key);
    }
  });
}
