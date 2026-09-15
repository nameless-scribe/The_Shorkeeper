import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createCanvas } from '@napi-rs/canvas';
import type { VisionRequest } from '../../../vision/bailian-vl';
import { VisionRequestError } from '../../../vision/bailian-vl';
import { MAX_CALLS_PER_RUN, parseSidecar } from '../../../vision/contract';
import { lookAtImageTool, resetVisionBudgets, setVisionToolDeps } from '../look-at-image';

let workspace: string;
let requests: VisionRequest[];

const okConfig = () => ({ ok: true as const, endpoint: { baseUrl: 'https://x', apiKey: 'k', model: 'qwen3-vl-plus' }, credentialsSource: 'shared' as const, maxPixels: 16_000_000 });

beforeEach(async () => {
  workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'sk-vision-'));
  requests = [];
  resetVisionBudgets();
  setVisionToolDeps({
    checkConfig: okConfig,
    ask: async (request) => {
      requests.push(request);
      return { answer: `看到 ${request.images.length} 张图：${request.question}`, requestId: `req-${requests.length}`, model: request.endpoint.model, promptTokens: 1500, completionTokens: 20 };
    },
    now: () => new Date('2026-09-15T02:00:00.000Z'),
  });
  await fs.writeFile(path.join(workspace, 'a.png'), createCanvas(8, 8).toBuffer('image/png'));
  await fs.writeFile(path.join(workspace, 'b.png'), createCanvas(4, 4).toBuffer('image/png'));
});

afterEach(async () => {
  setVisionToolDeps(null);
  await fs.rm(workspace, { recursive: true, force: true });
});

const ctx = (runId = 'run-1') => ({ sessionId: 's1', workspaceRoot: workspace, signal: new AbortController().signal, runId });

describe('look_at_image', () => {
  it('asks the model with prepared data urls, writes a sidecar and reports usage', async () => {
    const result = await lookAtImageTool.execute({ paths: ['a.png'], question: '这是什么？' }, ctx());
    expect(result.success).toBe(true);
    expect(result.output).toContain('看到 1 张图：这是什么？');
    expect(result.artifacts?.map((item) => item.relativePath)).toEqual(['a.vision.md']);
    expect(result.metadata).toMatchObject({ cached: false, requestId: 'req-1', promptTokens: 1500, completionTokens: 20, images: 1, estimatedTokens: 3, credentialsSource: 'shared' });
    expect(requests[0].images[0].dataUrl.startsWith('data:image/png;base64,')).toBe(true);
    const sidecar = parseSidecar(await fs.readFile(path.join(workspace, 'a.vision.md'), 'utf-8'));
    expect(sidecar).toMatchObject({ question: '这是什么？', mode: 'answer', images: ['a.png'], requestId: 'req-1', at: '2026-09-15T02:00:00.000Z' });
  });

  it('serves the same question from the sidecar without a second request, and refresh forces a new one', async () => {
    await lookAtImageTool.execute({ paths: ['a.png'], question: '这是什么？' }, ctx());
    const cached = await lookAtImageTool.execute({ paths: ['a.png'], question: '这是什么？' }, ctx('run-2'));
    expect(cached.success).toBe(true);
    expect(cached.metadata).toMatchObject({ cached: true });
    expect(cached.output).toContain('此前已看过');
    expect(requests).toHaveLength(1);

    const other = await lookAtImageTool.execute({ paths: ['a.png'], question: '有几个按钮？' }, ctx('run-3'));
    expect(other.metadata).toMatchObject({ cached: false });
    expect(requests).toHaveLength(2);

    const refreshed = await lookAtImageTool.execute({ paths: ['a.png'], question: '有几个按钮？', refresh: true }, ctx('run-4'));
    expect(refreshed.metadata).toMatchObject({ cached: false });
    expect(requests).toHaveLength(3);
  });

  it('writes one sidecar per image for multi-image questions and uses the ocr suffix for read_text', async () => {
    const result = await lookAtImageTool.execute({ paths: ['a.png', 'b.png'], question: '抄录文字', mode: 'read_text' }, ctx());
    expect(result.artifacts?.map((item) => item.relativePath)).toEqual(['a.ocr.md', 'b.ocr.md']);
    expect(requests[0].images).toHaveLength(2);
    const cached = await lookAtImageTool.execute({ paths: ['b.png', 'a.png'], question: '抄录文字', mode: 'read_text' }, ctx('run-2'));
    expect(cached.metadata).toMatchObject({ cached: true });
  });

  it('refuses when the switch is off or the endpoint is missing, before touching the network', async () => {
    setVisionToolDeps({ checkConfig: () => ({ ok: false, disabled: true, reason: '看图功能未开启' }), ask: async () => { throw new Error('should not be called'); } });
    const off = await lookAtImageTool.execute({ paths: ['a.png'], question: 'q' }, ctx());
    expect(off).toMatchObject({ success: false, errorCategory: 'permission_denied', error: '看图功能未开启' });
    setVisionToolDeps({ checkConfig: () => ({ ok: false, disabled: false, reason: '没有可用的百炼接入点' }), ask: async () => { throw new Error('should not be called'); } });
    expect(await lookAtImageTool.execute({ paths: ['a.png'], question: 'q' }, ctx())).toMatchObject({ success: false, errorCategory: 'invalid_arguments' });
  });

  it('maps provider failures to categories and never leaves a sidecar behind', async () => {
    setVisionToolDeps({ checkConfig: okConfig, ask: async () => { throw new VisionRequestError('视觉模型返回 400：bad', 'http', 400, 'req-x'); } });
    const http = await lookAtImageTool.execute({ paths: ['a.png'], question: 'q' }, ctx());
    expect(http).toMatchObject({ success: false, errorCategory: 'external_service_failure', metadata: { status: 400, requestId: 'req-x' } });
    setVisionToolDeps({ checkConfig: okConfig, ask: async () => { throw new VisionRequestError('超时', 'timeout'); } });
    expect((await lookAtImageTool.execute({ paths: ['a.png'], question: 'q' }, ctx('run-2'))).errorCategory).toBe('timeout');
    setVisionToolDeps({ checkConfig: okConfig, ask: async () => { throw new VisionRequestError('已取消', 'cancelled'); } });
    expect((await lookAtImageTool.execute({ paths: ['a.png'], question: 'q' }, ctx('run-3'))).errorCategory).toBe('cancelled');
    await expect(fs.access(path.join(workspace, 'a.vision.md'))).rejects.toBeTruthy();
  });

  it('validates arguments and files, and enforces the per-run budget', async () => {
    expect((await lookAtImageTool.execute({ paths: ['a.png'] }, ctx())).error).toContain('question');
    expect((await lookAtImageTool.execute({ paths: ['missing.png'], question: 'q' }, ctx())).error).toContain('读不到图片');
    expect((await lookAtImageTool.execute({ paths: ['../a.png'], question: 'q' }, ctx())).success).toBe(false);
    for (let i = 0; i < MAX_CALLS_PER_RUN; i += 1) {
      const result = await lookAtImageTool.execute({ paths: ['a.png'], question: `第 ${i} 问` }, ctx('budget'));
      expect(result.success).toBe(true);
    }
    const over = await lookAtImageTool.execute({ paths: ['a.png'], question: '再问一次' }, ctx('budget'));
    expect(over.success).toBe(false);
    expect(over.error).toContain(`${MAX_CALLS_PER_RUN} 次上限`);
    expect((await lookAtImageTool.execute({ paths: ['a.png'], question: '另一轮' }, ctx('fresh'))).success).toBe(true);
  });
});
