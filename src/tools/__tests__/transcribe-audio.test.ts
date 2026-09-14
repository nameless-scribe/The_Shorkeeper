import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { closeDatabase, initDatabase } from '../../db';
import { listAudioTranscripts } from '../../db/repositories/audio-transcripts';
import { summarizeTranscript, transcribeAudioTool, transcriptPathFor } from '../voice/transcribe-audio';

const ENV_KEYS = ['TENCENT_ASR_SECRET_ID', 'TENCENT_ASR_SECRET_KEY', 'TENCENT_ASR_APP_ID'] as const;

describe('transcriptPathFor', () => {
  it('puts the transcript beside the audio with a recognisable suffix', () => {
    expect(transcriptPathFor('周会.m4a')).toBe('周会.transcript.md');
    expect(transcriptPathFor('audio/2026/周会.m4a')).toBe('audio/2026/周会.transcript.md');
  });

  it('keeps a stable name so repeat runs overwrite instead of piling up', () => {
    expect(transcriptPathFor('a/b.wav')).toBe(transcriptPathFor('a/b.wav'));
  });
});

describe('summarizeTranscript', () => {
  it('returns a summary and a path, never the full text', () => {
    const output = summarizeTranscript({
      transcriptPath: 'a/周会.transcript.md',
      durationMs: 612137,
      sentenceCount: 95,
      speakerCount: 5,
      diarization: true,
      plainText: '很长的正文'.repeat(500),
      reused: false,
    });
    expect(output).toContain('a/周会.transcript.md');
    expect(output).toContain('10 分 12 秒');
    expect(output).toContain('95 句');
    expect(output).toContain('5 位说话人');
    // 一小时会议的逐字稿上万字，整段回给模型会把上下文撑爆
    expect(output.length).toBeLessThan(600);
    expect(output).toContain('正文未随本结果返回');
  });

  it('says so when the result was reused, so nobody thinks it was charged twice', () => {
    const output = summarizeTranscript({
      transcriptPath: 'a.md', durationMs: 1000, sentenceCount: 1, speakerCount: 0,
      diarization: false, plainText: '', reused: true,
    });
    expect(output).toContain('未重复计费');
    expect(output).toContain('未开启说话人分离');
  });
});

describe('transcribe_audio tool contract', () => {
  it('declares the side effects honestly', () => {
    // 会把音频发给第三方并按时长计费：外发数据无法撤回，风险不是 medium
    expect(transcribeAudioTool.sideEffects).toMatchObject({
      risk: 'high',
      idempotent: true,
      reversible: 'manual',
      evidence: 'artifact',
    });
    expect(transcribeAudioTool.requiresPermission).toContain('filesystem:read');
    expect(transcribeAudioTool.requiresPermission).toContain('filesystem:write');
  });

  it('lists the supported formats in the parameter description', () => {
    const properties = transcribeAudioTool.parameters.properties as Record<string, { description?: string }>;
    expect(properties.path.description).toContain('.m4a');
    expect(transcribeAudioTool.parameters.required).toEqual(['path']);
  });
});

describe('transcribe_audio execution guards', () => {
  let tempDir: string;
  let workspace: string;
  const saved: Record<string, string | undefined> = {};

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sk-p4-tool-'));
    workspace = path.join(tempDir, 'workspace');
    fs.mkdirSync(workspace, { recursive: true });
    await initDatabase(path.join(tempDir, 'p4.db'));
    for (const key of ENV_KEYS) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    closeDatabase();
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  const ctx = () => ({
    sessionId: 's1',
    workspaceRoot: workspace,
    signal: new AbortController().signal,
  });

  it('refuses without a path', async () => {
    const result = await transcribeAudioTool.execute({}, ctx());
    expect(result).toMatchObject({ success: false });
    expect(result.error).toContain('path');
  });

  it('names exactly which credential is missing', async () => {
    // 三个值少任何一个，服务端给的都是同一个笼统的鉴权失败，所以必须本地先说清楚
    process.env.TENCENT_ASR_SECRET_ID = 'AKIDEXAMPLE';
    const result = await transcribeAudioTool.execute({ path: 'a.m4a' }, ctx());
    expect(result.success).toBe(false);
    expect(result.error).toContain('SecretKey');
    expect(result.error).toContain('AppID');
    expect(result.error).not.toContain('SecretId');
  });

  it('rejects an AppID that is not numeric, hinting at the common mix-up', async () => {
    process.env.TENCENT_ASR_SECRET_ID = 'AKIDEXAMPLE';
    process.env.TENCENT_ASR_SECRET_KEY = 'SECRET';
    process.env.TENCENT_ASR_APP_ID = 'AKIDEXAMPLE';
    const result = await transcribeAudioTool.execute({ path: 'a.m4a' }, ctx());
    expect(result.success).toBe(false);
    expect(result.error).toContain('纯数字');
    expect(result.error).toContain('账号ID');
  });

  describe('with credentials present', () => {
    beforeEach(() => {
      process.env.TENCENT_ASR_SECRET_ID = 'AKIDEXAMPLE';
      process.env.TENCENT_ASR_SECRET_KEY = 'SECRET';
      process.env.TENCENT_ASR_APP_ID = '1259220000';
    });

    it('reports a missing audio file instead of calling the provider', async () => {
      const result = await transcribeAudioTool.execute({ path: 'missing.m4a' }, ctx());
      expect(result.success).toBe(false);
      expect(result.error).toContain('无法读取音频文件');
      expect(listAudioTranscripts({})).toHaveLength(0);
    });

    it('rejects an unsupported format before spending a request or a ledger row', async () => {
      fs.writeFileSync(path.join(workspace, 'clip.mp4'), Buffer.from([1, 2, 3]));
      const result = await transcribeAudioTool.execute({ path: 'clip.mp4' }, ctx());
      expect(result.success).toBe(false);
      expect(result.error).toContain('不支持的音频格式');
      // 拦在发请求之前，不该留下账本记录
      expect(listAudioTranscripts({})).toHaveLength(0);
    });

    it('rejects an empty audio file before spending a request', async () => {
      fs.writeFileSync(path.join(workspace, 'empty.m4a'), Buffer.alloc(0));
      const result = await transcribeAudioTool.execute({ path: 'empty.m4a' }, ctx());
      expect(result.success).toBe(false);
      expect(result.error).toContain('为空');
      expect(listAudioTranscripts({})).toHaveLength(0);
    });
  });
});
