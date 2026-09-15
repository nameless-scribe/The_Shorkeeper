/**
 * look_at_image（P8.2，计划 §4.2）：把工作区里的图片连同问题交给视觉模型，结果落成 sidecar。
 * 没问题不看；开关关着不发；同图同问同模式命中 sidecar 就不再调接口；一次运行内最多 10 次、30 张。
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import type { ToolDefinition, ToolResult, ToolSideEffectContract } from '../types';
import { buildFileArtifact, writeWorkspaceFileAtomically } from '../file/artifact';
import { resolveWorkspacePath } from '../file/workspace-path';
import { checkVisionConfig, type VisionConfigStatus } from '../../config/vision';
import { askVisionModel, VisionRequestError, type VisionRequest, type VisionResponse } from '../../vision/bailian-vl';
import {
  formatSidecar,
  MAX_CALLS_PER_RUN,
  MAX_IMAGE_BYTES,
  MAX_IMAGES_PER_CALL,
  MAX_IMAGES_PER_RUN,
  parseLookAtImageArgs,
  parseSidecar,
  sidecarMatches,
  sidecarPathFor,
  VISION_IMAGE_EXTENSIONS,
  type LookAtImageArgs,
} from '../../vision/contract';
import { ImagePrepError, prepareImageForVision, type PreparedImage } from '../../vision/image-prep';

export const LOOK_AT_IMAGE_CONTRACT: ToolSideEffectContract = {
  risk: 'low',
  idempotent: true,
  supportsPreview: false,
  reversible: 'manual',
  evidence: 'artifact',
};

export interface VisionToolDeps {
  checkConfig(): VisionConfigStatus;
  ask(request: VisionRequest): Promise<VisionResponse>;
  prepare(buffer: Buffer, extension: string): Promise<PreparedImage>;
  now(): Date;
}

const productionDeps: VisionToolDeps = {
  checkConfig: () => checkVisionConfig(),
  ask: (request) => askVisionModel(request),
  prepare: (buffer, extension) => prepareImageForVision(buffer, extension),
  now: () => new Date(),
};

let deps: VisionToolDeps = productionDeps;

export function setVisionToolDeps(override: Partial<VisionToolDeps> | null): void {
  deps = override ? { ...productionDeps, ...override } : productionDeps;
}

/** 一次运行内的预算（§4.5）；进程内按 runId 记，超过 200 个 run 就清最早的 */
const runBudgets = new Map<string, { calls: number; images: number }>();

export function resetVisionBudgets(): void {
  runBudgets.clear();
}

function chargeBudget(runId: string | undefined, images: number): string | null {
  const key = runId ?? 'no-run';
  const current = runBudgets.get(key) ?? { calls: 0, images: 0 };
  if (current.calls + 1 > MAX_CALLS_PER_RUN) return `这次运行里看图已达 ${MAX_CALLS_PER_RUN} 次上限，请分批或另起一轮`;
  if (current.images + images > MAX_IMAGES_PER_RUN) return `这次运行里看图的图片已达 ${MAX_IMAGES_PER_RUN} 张上限，请分批`;
  runBudgets.set(key, { calls: current.calls + 1, images: current.images + images });
  if (runBudgets.size > 200) {
    const oldest = runBudgets.keys().next().value;
    if (oldest !== undefined) runBudgets.delete(oldest);
  }
  return null;
}

function failure(error: string, errorCategory: ToolResult['errorCategory'], metadata?: Record<string, unknown>): ToolResult {
  return { success: false, output: '', error, errorCategory, ...(metadata ? { metadata } : {}) };
}

async function readCached(workspaceRoot: string, args: LookAtImageArgs): Promise<{ answer: string; model: string; requestId: string | null; paths: string[] } | null> {
  const paths = args.paths.map((imagePath) => sidecarPathFor(imagePath, args.mode));
  let answer: string | null = null;
  let model = '';
  let requestId: string | null = null;
  for (const sidecarPath of paths) {
    let text: string;
    try {
      text = await fs.readFile(resolveWorkspacePath(workspaceRoot, sidecarPath), 'utf-8');
    } catch {
      return null;
    }
    const record = parseSidecar(text);
    if (!record || !sidecarMatches(record, args)) return null;
    if (answer !== null && record.answer !== answer) return null;
    answer = record.answer;
    model = record.model;
    requestId = record.requestId;
  }
  return answer === null ? null : { answer, model, requestId, paths };
}

export const lookAtImageTool: ToolDefinition = {
  name: 'look_at_image',
  description:
    `看工作区里的图片（${VISION_IMAGE_EXTENSIONS.join(' ')}，一次最多 ${MAX_IMAGES_PER_CALL} 张）并就它提问：answer 回答问题、describe 描述内容、read_text 逐字抄录文字（图纸标题栏、表格、票据）。` +
    '结果写成图片旁的 .vision.md / .ocr.md，同图同问不重复付费；没有问题不要调用',
  category: 'doc',
  requiresPermission: ['filesystem:read', 'filesystem:write', 'network'],
  sideEffects: LOOK_AT_IMAGE_CONTRACT,
  parameters: {
    type: 'object',
    properties: {
      paths: { type: 'array', items: { type: 'string' }, description: '工作区内图片的相对路径，1 到 6 张' },
      question: { type: 'string', description: '要问的问题或关注点（必填）' },
      mode: { type: 'string', enum: ['answer', 'describe', 'read_text'], description: '默认 answer' },
      refresh: { type: 'boolean', description: '已有识别结果时强制重新看' },
    },
    required: ['paths', 'question'],
  },
  async execute(rawArgs, ctx): Promise<ToolResult> {
    const parsed = parseLookAtImageArgs(rawArgs);
    if (!parsed.ok) return failure(parsed.error, 'invalid_arguments');
    const args = parsed.value;

    if (!args.refresh) {
      const cached = await readCached(ctx.workspaceRoot, args);
      if (cached) {
        const artifacts = await Promise.all(cached.paths.map((sidecarPath) => buildFileArtifact(ctx.workspaceRoot, sidecarPath)));
        return {
          success: true,
          output: `${cached.answer}\n\n（这张图这个问题此前已看过，直接复用 ${cached.paths[0]}；要重新看请传 refresh）`,
          metadata: { model: cached.model, requestId: cached.requestId, promptTokens: null, completionTokens: null, cached: true, images: args.paths.length },
          artifacts,
        };
      }
    }

    const config = deps.checkConfig();
    if (!config.ok) return failure(config.reason, config.disabled ? 'permission_denied' : 'invalid_arguments', { disabled: config.disabled });

    const prepared: Array<{ name: string; image: PreparedImage }> = [];
    for (const imagePath of args.paths) {
      let buffer: Buffer;
      try {
        const absolute = resolveWorkspacePath(ctx.workspaceRoot, imagePath);
        const stat = await fs.stat(absolute);
        if (!stat.isFile()) return failure(`${imagePath} 不是文件`, 'invalid_arguments');
        if (stat.size > MAX_IMAGE_BYTES) return failure(`${imagePath} 超过 ${MAX_IMAGE_BYTES / 1024 / 1024} MB`, 'invalid_arguments');
        buffer = await fs.readFile(absolute);
      } catch (error) {
        return failure(`读不到图片 ${imagePath}：${error instanceof Error ? error.message : String(error)}`, 'invalid_arguments');
      }
      try {
        prepared.push({ name: path.basename(imagePath), image: await deps.prepare(buffer, path.extname(imagePath)) });
      } catch (error) {
        if (error instanceof ImagePrepError) return failure(`${imagePath}：${error.message}`, 'invalid_arguments');
        throw error;
      }
    }

    const budgetError = chargeBudget(ctx.runId, prepared.length);
    if (budgetError) return failure(budgetError, 'invalid_arguments');

    const estimatedTokens = prepared.reduce((sum, item) => sum + item.image.estimatedTokens, 0);
    let response: VisionResponse;
    try {
      response = await deps.ask({
        images: prepared.map((item) => ({ name: item.name, dataUrl: item.image.dataUrl })),
        question: args.question,
        mode: args.mode,
        endpoint: config.endpoint,
        signal: ctx.signal,
      });
    } catch (error) {
      if (error instanceof VisionRequestError) {
        const category = error.kind === 'timeout' ? 'timeout' : error.kind === 'cancelled' ? 'cancelled' : error.kind === 'network' ? 'network_failure' : 'external_service_failure';
        return failure(error.message, category, { status: error.status ?? null, requestId: error.requestId ?? null, estimatedTokens });
      }
      throw error;
    }

    const at = deps.now().toISOString();
    const sidecar = formatSidecar({
      model: response.model,
      requestId: response.requestId,
      question: args.question,
      mode: args.mode,
      images: args.paths,
      at,
      promptTokens: response.promptTokens,
      completionTokens: response.completionTokens,
      answer: response.answer,
    });
    const artifacts = [];
    for (const imagePath of args.paths) {
      const sidecarPath = sidecarPathFor(imagePath, args.mode);
      await writeWorkspaceFileAtomically(ctx.workspaceRoot, sidecarPath, (temporaryPath) => fs.writeFile(temporaryPath, sidecar, 'utf-8'));
      artifacts.push(await buildFileArtifact(ctx.workspaceRoot, sidecarPath));
    }
    const notes = prepared
      .filter((item) => item.image.converted || item.image.resized)
      .map((item) => `${item.name}${item.image.converted ? ' 已转成 PNG' : ''}${item.image.resized ? ` 已缩到 ${item.image.width}×${item.image.height}` : ''}`);
    return {
      success: true,
      output: `${response.answer}${notes.length ? `\n\n（${notes.join('；')}）` : ''}\n\n识别结果已存为 ${artifacts.map((artifact) => artifact.relativePath).join('、')}`,
      metadata: {
        model: response.model,
        requestId: response.requestId,
        promptTokens: response.promptTokens,
        completionTokens: response.completionTokens,
        estimatedTokens,
        cached: false,
        images: prepared.length,
        mode: args.mode,
        credentialsSource: config.credentialsSource,
      },
      artifacts,
    };
  },
};
