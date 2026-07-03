import { completeChat } from '../models/complete-chat';

const HYDE_PROMPT = `根据用户问题，写一段可能出现在知识库文档中的简短段落（2-4 句），用于检索相似内容。只输出段落正文，不要解释。`;

export async function generateHydeQuery(userQuery: string): Promise<string> {
  const reply = await completeChat([
    { role: 'system', content: HYDE_PROMPT },
    { role: 'user', content: userQuery },
  ]);
  return reply.trim();
}
