/**
 * 对腾讯云「录音文件识别极速版」发一次真实请求，用于验证配置与排查供应商变化。
 *
 * 它**走生产同一条码路**（`transcribeAudio`），而不是自己再写一遍请求——
 * 否则脚本跑通不代表应用里能跑通。
 *
 * 两条刻意的安全设计：
 *   - **绝不打印密钥**。签名原文与请求 URL 都含 secretid，因此都不输出、不落盘。
 *   - **会议正文不进仓库**。完整响应只写到系统临时目录；仓库里只留一份
 *     「结构摘要」，字段名与嵌套保留，长文本一律脱敏。录音内容是 4.4 定义的敏感数据。
 *
 * 用法：
 *   1. 在 .env 里填三个值（.env 已在 .gitignore 内）：
 *        TENCENT_ASR_SECRET_ID=AKID...
 *        TENCENT_ASR_SECRET_KEY=...
 *        TENCENT_ASR_APP_ID=1259220000
 *   2. pnpm asr:probe <音频路径> [engine_type]
 *      engine_type 默认 16k_zh；电话录音用 8k_zh，中英混说用 16k_zh_en。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { config } from 'dotenv';
import {
  ASR_ENGINE_TYPES,
  AUDIO_EXTENSIONS,
  DEFAULT_ASR_ENGINE,
  type AsrEngineType,
} from '../src/voice/asr-contract';
import { formatDuration, formatTranscriptMarkdown } from '../src/voice/transcript-format';
import {
  TranscriptionFailedError,
  transcribeAudio,
  type AudioBytes,
} from '../src/voice/tencent-file-asr';

config();

function fail(message: string): never {
  console.error(`\n[probe] ${message}\n`);
  process.exit(1);
}

/**
 * 结构摘要：保留字段名、嵌套与数组长度，脱敏长文本。
 * 目的是让结构变化能被看见，同时不把会议内容带进仓库。
 */
function summarize(value: unknown, key = ''): unknown {
  if (value === null) return null;
  if (Array.isArray(value)) {
    // 前两项足以看清结构与是否异构
    return { __array: value.length, __sample: value.slice(0, 2).map((item) => summarize(item, key)) };
  }
  if (typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, summarize(v, k)]));
  }
  if (typeof value === 'string') {
    if (/text|word|message|msg|content/i.test(key) || value.length > 16) return `<string:${value.length}>`;
    return value;
  }
  return value;
}

async function main(): Promise<void> {
  const [, , audioArg, engineArg] = process.argv;
  if (!audioArg) fail('用法：pnpm asr:probe <音频路径> [engine_type]');

  const credentials = {
    secretId: process.env.TENCENT_ASR_SECRET_ID?.trim() ?? '',
    secretKey: process.env.TENCENT_ASR_SECRET_KEY?.trim() ?? '',
    appId: process.env.TENCENT_ASR_APP_ID?.trim() ?? '',
  };
  const missing = [
    !credentials.secretId && 'TENCENT_ASR_SECRET_ID',
    !credentials.secretKey && 'TENCENT_ASR_SECRET_KEY',
    !credentials.appId && 'TENCENT_ASR_APP_ID',
  ].filter(Boolean);
  if (missing.length) fail(`.env 里缺少：${missing.join('、')}`);

  const audioPath = path.resolve(audioArg);
  if (!fs.existsSync(audioPath)) fail(`找不到音频文件：${audioPath}`);
  const extension = path.extname(audioPath).toLowerCase();
  if (!AUDIO_EXTENSIONS.includes(extension)) {
    fail(`不支持的扩展名 ${extension || '(无)'}；支持 ${AUDIO_EXTENSIONS.join(' / ')}`);
  }

  const engineType = (engineArg?.trim() || DEFAULT_ASR_ENGINE) as AsrEngineType;
  if (!ASR_ENGINE_TYPES.includes(engineType)) {
    fail(`不支持的引擎 ${engineType}；支持 ${ASR_ENGINE_TYPES.join(' / ')}`);
  }

  const audio = new Uint8Array(fs.readFileSync(audioPath)) as AudioBytes;
  console.log(`[probe] 文件      ${path.basename(audioPath)}`);
  console.log(`[probe] 大小      ${(audio.byteLength / 1024 / 1024).toFixed(2)} MB`);
  console.log(`[probe] 引擎      ${engineType}`);
  console.log('[probe] 说话人分离  已开启');
  console.log('\n[probe] 正在请求…');

  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sk-asr-probe-'));
  const rawPath = path.join(outDir, 'response.json');
  const transcriptPath = path.join(outDir, 'transcript.md');
  const summaryPath = path.resolve('docs/asr-flash-response-shape.json');

  const startedAt = Date.now();
  try {
    const result = await transcribeAudio({
      audio,
      extension,
      engineType,
      credentials,
      onRawBody: (body) => {
        fs.writeFileSync(rawPath, body, 'utf8');
        try {
          fs.writeFileSync(summaryPath, `${JSON.stringify(summarize(JSON.parse(body)), null, 2)}\n`, 'utf8');
        } catch {
          // 非 JSON 时保留原文即可，结构摘要写不出来不影响排查
        }
      },
    });

    const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
    console.log(`[probe] 成功，耗时 ${elapsed}s\n`);
    console.log(`[probe] 音频时长   ${formatDuration(result.durationMs)}`);
    console.log(`[probe] 句子数     ${result.sentences.length}`);
    console.log(`[probe] 说话人数   ${result.speakerCount}`);
    console.log(`[probe] 内容哈希   ${result.sourceHash.slice(0, 16)}…`);

    // 顺带验证格式化层：真实数据跑一遍逐字稿生成，产物同样不进仓库
    fs.writeFileSync(
      transcriptPath,
      formatTranscriptMarkdown(result, {
        sourceName: path.basename(audioPath),
        model: engineType,
        completedAt: Date.now(),
        diarization: result.diarization,
      }),
      'utf8',
    );
    console.log(`\n[probe] 逐字稿（含录音正文，不进仓库）：${transcriptPath}`);
  } catch (error) {
    const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
    if (error instanceof TranscriptionFailedError) {
      console.error(`[probe] 失败（${elapsed}s）：${error.message}`);
      console.error(`[probe] 错误码 ${error.code}，可重试：${error.retryable ? '是' : '否'}`);
    } else {
      console.error(`[probe] 失败（${elapsed}s）：${error instanceof Error ? error.message : String(error)}`);
    }
    if (fs.existsSync(rawPath)) console.error(`[probe] 原始响应：${rawPath}`);
    process.exit(1);
  }

  console.log(`[probe] 完整响应（含录音正文，不进仓库）：${rawPath}`);
  console.log(`[probe] 结构摘要（已脱敏，可提交）：      ${summaryPath}`);
  console.log('[probe] 看完请自行删除临时目录。');
}

main().catch((error) => {
  console.error('[probe] 失败：', error instanceof Error ? error.message : error);
  process.exit(1);
});
