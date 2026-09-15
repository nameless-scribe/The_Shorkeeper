/**
 * 对百炼视觉模型发几次真实请求（P8.0，计划 §2.5），复核四件事：
 *   1. base64 单图的大小上限（拿一张大 PNG 试）；
 *   2. 业务空间专属接入点是否已开通 VL 模型（不通就换 dashscope.aliyuncs.com/compatible-mode/v1）；
 *   3. `enable_thinking: false` 在兼容模式下是否被接受；
 *   4. usage.prompt_tokens 与公式 宽×高/1024+2 的误差。
 * 走生产同一条码路（prepareImageForVision + askVisionModel）。不打印 Key，不打印图片数据，回答只打印前 200 字。
 *
 * 用法：在 .env 或环境里给 VISION_API_KEY / VISION_BASE_URL（留空则用 OPENAI_API_KEY / OPENAI_BASE_URL），VISION_MODEL 可选；
 *   pnpm vision:probe <图片路径> [<图片路径> ...]   每张各调一次，mode=describe
 *   VISION_PROBE_MODE=read_text pnpm vision:probe 图纸.png
 */
import fs from 'node:fs';
import path from 'node:path';
import { config } from 'dotenv';
import { askVisionModel, VisionRequestError } from '../src/vision/bailian-vl';
import { estimateImageTokens, isVisionImageExtension, VISION_MODES, type VisionMode } from '../src/vision/contract';
import { prepareImageForVision } from '../src/vision/image-prep';

config();

function env(name: string, fallback = ''): string {
  return process.env[name]?.trim() || fallback;
}

async function main(): Promise<void> {
  const files = process.argv.slice(2);
  if (!files.length) {
    console.error('[vision:probe] 用法：pnpm vision:probe <图片路径> [...]');
    process.exit(2);
  }
  const apiKey = env('VISION_API_KEY') || env('OPENAI_API_KEY');
  const baseUrl = env('VISION_BASE_URL') || env('OPENAI_BASE_URL');
  const model = env('VISION_MODEL', 'qwen3-vl-plus');
  const modeRaw = env('VISION_PROBE_MODE', 'describe');
  const mode = (VISION_MODES as readonly string[]).includes(modeRaw) ? (modeRaw as VisionMode) : 'describe';
  if (!apiKey || !baseUrl) {
    console.error('[vision:probe] 缺少 VISION_API_KEY / VISION_BASE_URL（或 OPENAI_API_KEY / OPENAI_BASE_URL）');
    process.exit(2);
  }
  console.info(`[vision:probe] 接入点 ${baseUrl}，模型 ${model}，模式 ${mode}，${files.length} 张图`);

  let failures = 0;
  for (const file of files) {
    const extension = path.extname(file).toLowerCase();
    if (!isVisionImageExtension(extension)) {
      console.warn(`[vision:probe] 跳过 ${file}：不是支持的图片格式`);
      continue;
    }
    const buffer = fs.readFileSync(file);
    const started = Date.now();
    try {
      const prepared = await prepareImageForVision(buffer, extension);
      console.info(`[vision:probe] ${path.basename(file)}：${prepared.width}×${prepared.height}，${(prepared.bytes / 1024 / 1024).toFixed(2)} MB 送出${prepared.converted ? '，已转 PNG' : ''}${prepared.resized ? '，已缩' : ''}，公式估算 ${prepared.estimatedTokens} token`);
      const response = await askVisionModel({
        images: [{ name: path.basename(file), dataUrl: prepared.dataUrl }],
        question: mode === 'read_text' ? '抄录全部文字' : '这是什么？',
        mode,
        endpoint: { baseUrl, apiKey, model },
      });
      const formula = estimateImageTokens(prepared.width, prepared.height);
      const drift = response.promptTokens ? Math.round((Math.abs(response.promptTokens - formula) / response.promptTokens) * 100) : null;
      console.info(`[vision:probe]   OK ${Date.now() - started} ms，requestId=${response.requestId ?? '?'}，prompt_tokens=${response.promptTokens ?? '?'}（含提示词；与公式差 ${drift ?? '?'}%），completion_tokens=${response.completionTokens ?? '?'}`);
      console.info(`[vision:probe]   回答：${response.answer.replace(/\s+/g, ' ').slice(0, 200)}${response.answer.length > 200 ? '…' : ''}`);
    } catch (error) {
      failures += 1;
      if (error instanceof VisionRequestError) {
        console.error(`[vision:probe]   失败（${error.kind}${error.status ? ` ${error.status}` : ''}，requestId=${error.requestId ?? '?'}）：${error.message}`);
        if (error.status === 400 && /enable_thinking/i.test(error.message)) console.error('[vision:probe]   → 兼容模式不接受 enable_thinking，需在客户端去掉该参数');
        if (error.status === 404 || /model/i.test(error.message)) console.error('[vision:probe]   → 这个接入点可能没开通该模型，试 https://dashscope.aliyuncs.com/compatible-mode/v1');
        if (error.status === 413 || /too large|payload/i.test(error.message)) console.error('[vision:probe]   → 单图 base64 超过上限，记下这张图的字节数');
      } else {
        console.error(`[vision:probe]   失败：${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }
  process.exitCode = failures ? 1 : 0;
}

void main();
