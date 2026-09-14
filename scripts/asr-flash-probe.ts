/**
 * P4.2 第一步的一次性验证脚本：对腾讯云「录音文件识别极速版」发一次真实请求。
 *
 * 它要一次确认四件事（见 P4 计划 2.5）：
 *   1. 签名能否通过服务端校验
 *   2. 连通性与服务是否已开通
 *   3. 说话人分离实际支持几人
 *   4. 真实响应的 JSON 结构——后续映射按它来写，不再对着文档猜
 *
 * 两条刻意的安全设计：
 *   - **绝不打印密钥**。签名原文里含 secretid，因此原文也不打印、不落盘。
 *   - **会议正文不进仓库**。完整响应只写到系统临时目录；仓库里只留一份
 *     「结构摘要」，字段名与嵌套保留，长文本一律脱敏。录音内容是 4.4 定义的敏感数据。
 *
 * 用法：
 *   1. 在 .env 里填三个值（.env 已在 .gitignore 内）：
 *        TENCENT_ASR_SECRET_ID=AKID...
 *        TENCENT_ASR_SECRET_KEY=...
 *        TENCENT_ASR_APP_ID=1259220000
 *   2. pnpm tsx scripts/asr-flash-probe.ts <音频路径> [engine_type]
 *      engine_type 默认 16k_zh；电话录音用 8k_zh，中英混说用 16k_zh_en。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { config } from 'dotenv';
import { signFlashRequest } from '../src/voice/tencent-flash-signature';

config();

/** 扩展名 → 接口要求的 voice_format 取值。 */
const VOICE_FORMAT_BY_EXT: Record<string, string> = {
  '.wav': 'wav',
  '.mp3': 'mp3',
  '.m4a': 'm4a',
  '.aac': 'aac',
  '.amr': 'amr',
  '.flac': 'flac',
  '.ogg': 'ogg-opus',
  '.opus': 'ogg-opus',
  '.silk': 'silk',
  '.pcm': 'pcm',
};

const MAX_BYTES = 100 * 1024 * 1024;

function fail(message: string): never {
  console.error(`\n[probe] ${message}\n`);
  process.exit(1);
}

/**
 * 结构摘要：保留字段名、嵌套与数组长度，脱敏长文本。
 * 目的是让映射能对着真实结构写，同时不把会议内容带进仓库。
 */
function summarize(value: unknown, key = ''): unknown {
  if (value === null) return null;
  if (Array.isArray(value)) {
    return {
      __array: value.length,
      // 前两项足以看清结构与是否异构
      __sample: value.slice(0, 2).map((item) => summarize(item, key)),
    };
  }
  if (typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, summarize(v, k)]));
  }
  if (typeof value === 'string') {
    const sensitiveKey = /text|word|message|msg|content/i.test(key);
    if (sensitiveKey || value.length > 16) return `<string:${value.length}>`;
    return value;
  }
  return value;
}

async function main(): Promise<void> {
  const [, , audioArg, engineArg] = process.argv;
  if (!audioArg) fail('用法：pnpm tsx scripts/asr-flash-probe.ts <音频路径> [engine_type]');

  const secretId = process.env.TENCENT_ASR_SECRET_ID?.trim() ?? '';
  const secretKey = process.env.TENCENT_ASR_SECRET_KEY?.trim() ?? '';
  const appId = process.env.TENCENT_ASR_APP_ID?.trim() ?? '';
  const missing = [
    !secretId && 'TENCENT_ASR_SECRET_ID',
    !secretKey && 'TENCENT_ASR_SECRET_KEY',
    !appId && 'TENCENT_ASR_APP_ID',
  ].filter(Boolean);
  if (missing.length) fail(`.env 里缺少：${missing.join('、')}`);

  const audioPath = path.resolve(audioArg);
  if (!fs.existsSync(audioPath)) fail(`找不到音频文件：${audioPath}`);
  const audio = fs.readFileSync(audioPath);
  const ext = path.extname(audioPath).toLowerCase();
  const voiceFormat = VOICE_FORMAT_BY_EXT[ext];
  if (!voiceFormat) {
    fail(`不支持的扩展名 ${ext}；支持 ${Object.keys(VOICE_FORMAT_BY_EXT).join(' / ')}`);
  }
  if (audio.byteLength > MAX_BYTES) {
    fail(`音频 ${(audio.byteLength / 1024 / 1024).toFixed(1)} MB，超过极速版 100 MB 上限`);
  }

  const engineType = engineArg?.trim() || '16k_zh';
  console.log(`[probe] 文件     ${path.basename(audioPath)}`);
  console.log(`[probe] 大小     ${(audio.byteLength / 1024 / 1024).toFixed(2)} MB`);
  console.log(`[probe] 格式     ${voiceFormat}`);
  console.log(`[probe] 引擎     ${engineType}`);
  console.log(`[probe] 说话人分离  已开启\n`);

  const signed = signFlashRequest({
    secretId,
    secretKey,
    appId,
    timestampSeconds: Math.floor(Date.now() / 1000),
    params: {
      engine_type: engineType,
      voice_format: voiceFormat,
      speaker_diarization: 1,
      first_channel_only: 1,
      word_info: 0,
    },
  });

  // 只打印不含密钥的部分：signingString 与 url 都带 secretid，一律不输出。
  console.log('[probe] 正在请求（30 分钟音频约需 10 秒）…');
  const startedAt = Date.now();

  let response: Response;
  try {
    response = await fetch(signed.url, {
      method: 'POST',
      headers: {
        Authorization: signed.authorization,
        'Content-Type': 'application/octet-stream',
      },
      body: new Uint8Array(audio),
    });
  } catch (error) {
    fail(`请求发送失败（网络或域名不可达）：${error instanceof Error ? error.message : String(error)}`);
  }

  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
  const raw = await response.text();
  console.log(`[probe] HTTP ${response.status}，耗时 ${elapsed}s\n`);

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    fail(`响应不是 JSON（前 300 字）：\n${raw.slice(0, 300)}`);
  }

  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sk-asr-probe-'));
  const rawPath = path.join(outDir, 'response.json');
  fs.writeFileSync(rawPath, raw, 'utf8');

  const summaryPath = path.resolve('docs/asr-flash-response-shape.json');
  fs.writeFileSync(summaryPath, `${JSON.stringify(summarize(parsed), null, 2)}\n`, 'utf8');

  const record = parsed as Record<string, unknown>;
  const code = record.code ?? record.Code;
  const message = record.message ?? record.Message;
  if (code !== undefined && code !== 0) {
    console.error(`[probe] 接口返回错误 code=${String(code)} message=${String(message ?? '')}`);
    console.error('[probe] 常见原因：服务未开通、AppID 填成了账号ID、子账号缺少 ASR 权限、签名不通过。');
  } else {
    console.log('[probe] 接口调用成功。');
  }

  // 说话人分离的实测结论：看结果里出现了几个不同的 speaker_id。
  const speakers = new Set<string>();
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (node && typeof node === 'object') {
      for (const [k, v] of Object.entries(node)) {
        if (/^speaker_?id$/i.test(k) && (typeof v === 'number' || typeof v === 'string')) {
          speakers.add(String(v));
        } else walk(v);
      }
    }
  };
  walk(parsed);
  console.log(`[probe] 结果中出现的不同 speaker_id 数量：${speakers.size}` +
    (speakers.size ? `（${[...speakers].join(', ')}）` : '（未出现该字段）'));

  console.log(`\n[probe] 完整响应（含录音正文，不进仓库）：${rawPath}`);
  console.log(`[probe] 结构摘要（已脱敏，可提交）：      ${summaryPath}`);
  console.log('[probe] 看完请自行删除完整响应。');
}

main().catch((error) => {
  console.error('[probe] 失败：', error instanceof Error ? error.message : error);
  process.exit(1);
});
