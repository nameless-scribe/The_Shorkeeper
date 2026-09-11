import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { closeDatabase, initDatabase } from '../..';
import {
  createSession,
  getSession,
  listSessions,
  setSessionAssistantMode,
} from '../sessions';
import { insertMessage } from '../messages';

let dbPath: string;

beforeEach(async () => {
  dbPath = path.join(os.tmpdir(), `sk-sessions-${Date.now()}.db`);
  await initDatabase(dbPath);
});

afterEach(async () => {
  closeDatabase();
  await fs.unlink(dbPath).catch(() => undefined);
});

describe('listSessions', () => {
  it('persists the assistant mode per session', () => {
    const session = createSession();
    expect(session.assistantMode).toBe('focus');

    setSessionAssistantMode(session.id, 'review');

    expect(getSession(session.id)?.assistantMode).toBe('review');
    expect(listSessions().sessions[0]?.assistantMode).toBe('review');
  });

  it('paginates results', () => {
    for (let i = 0; i < 5; i += 1) {
      createSession(undefined, `会话 ${i}`);
    }

    const page1 = listSessions({ limit: 2, offset: 0 });
    expect(page1.sessions).toHaveLength(2);
    expect(page1.total).toBe(5);
    expect(page1.hasMore).toBe(true);

    const page2 = listSessions({ limit: 2, offset: 2 });
    expect(page2.sessions).toHaveLength(2);
    expect(page2.hasMore).toBe(true);

    const page3 = listSessions({ limit: 2, offset: 4 });
    expect(page3.sessions).toHaveLength(1);
    expect(page3.hasMore).toBe(false);
  });

  it('searches message content', () => {
    const session = createSession(undefined, '无关标题');
    insertMessage(session.id, 'user', '伸宏贸易关账流程说明');
    insertMessage(session.id, 'assistant', '收到');

    const byTitle = listSessions({ query: '无关' });
    expect(byTitle.sessions).toHaveLength(1);

    const byMessage = listSessions({ query: '关账流程' });
    expect(byMessage.sessions).toHaveLength(1);
    expect(byMessage.sessions[0].id).toBe(session.id);

    const miss = listSessions({ query: '不存在的关键词xyz' });
    expect(miss.sessions).toHaveLength(0);
  });
});
