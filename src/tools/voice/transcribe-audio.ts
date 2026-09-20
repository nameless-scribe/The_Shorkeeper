import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type { ToolDefinition, ToolResult, ToolSideEffectContract } from '../types';
import { buildFileArtifact, withFileArtifact, writeWorkspaceFileAtomically } from '../file/artifact';
import { resolveWorkspacePath } from '../file/workspace-path';
import { checkAsrConfig, resolveAsrSettings } from '../../config/asr';
import { AUDIO_EXTENSIONS, MAX_AUDIO_BYTES, validateAudioSource } from '../../voice/asr-contract';
import { formatDuration, formatTranscriptMarkdown } from '../../voice/transcript-format';
import {
  TranscriptionCancelledError,
  TranscriptionFailedError,
  transcribeAudio,
  type AudioBytes,
} from '../../voice/tencent-file-asr';
import {
  completeAudioTranscript,
  failAudioTranscript,
  findAudioTranscriptByKey,
  findReusableTranscript,
  startAudioTranscript,
} from '../../db/repositories/audio-transcripts';

/**
 * 转写的副作用比普通工作区写入重：**会把音频发给第三方识别服务并按时长计费**。
 * 因此风险不是 medium 而是 high——外发数据无法撤回。
 * 幂等由 `source_hash + 引擎 + 分离开关` 保证：同一文件同一设置重复调用直接复用已有逐字稿，不重复计费。
 */
const TRANSCRIBE_CONTRACT: ToolSideEffectContract = {
  risk: 'high',
  idempotent: true,
  supportsPreview: false,
  reversible: 'manual',
  evidence: 'artifact',
};

/** 逐字稿产物与音频同目录同名，换 .transcript.md 后缀，便于人肉对应。 */
export function transcriptPathFor(audioRelativePath: string): string {
  const directory = path.dirname(audioRelativePath);
  const base = path.basename(audioRelativePath, path.extname(audioRelativePath));
  const name = `${base}.transcript.md`;
  return directory === '.' ? name : path.join(directory, name).replace(/\\/g, '/');
}

/** 返回给模型的摘要。**绝不返回全文**：一小时会议的逐字稿轻松上万字，会把上下文撑爆。 */
export function summarizeTranscript(input: {
  transcriptPath: string;
  durationMs: number;
  sentenceCount: number;
  speakerCount: number;
  diarization: boolean;
  plainText: string;
  reused: boolean;
}): string {
  const preview = input.plainText.trim().slice(0, 200);
  return [
    input.reused ? '该音频此前已转写，直接复用已有逐字稿（未重复计费）。' : '转写完成。',
    `逐字稿：${input.transcriptPath}`,
    `时长 ${formatDuration(input.durationMs)}，共 ${input.sentenceCount} 句` +
      (input.diarization ? `，识别到 ${input.speakerCount} 位说话人` : '，未开启说话人分离'),
    preview ? `开头片段：${preview}${input.plainText.length > 200 ? '…' : ''}` : '',
    '需要具体内容时请读取逐字稿文件；正文未随本结果返回。',
  ]
    .filter(Boolean)
    .join('\n');
}

export const transcribeAudioTool: ToolDefinition = {
  name: 'transcribe_audio',
  description: '把工作区里的录音文件转写成带时间戳与说话人的逐字稿，产物写入工作区',
  category: 'voice',
  requiresPermission: ['filesystem:read', 'filesystem:write'],
  sideEffects: TRANSCRIBE_CONTRACT,
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: `工作区内的音频相对路径，支持 ${AUDIO_EXTENSIONS.join(' / ')}`,
      },
      diarization: {
        type: 'boolean',
        description: '是否区分说话人，默认按设置（通常开启）',
      },
    },
    required: ['path'],
  },
  async execute(args, ctx): Promise<ToolResult> {
    const { path: audioPath, diarization } = (args ?? {}) as { path?: string; diarization?: boolean };
    if (!audioPath?.trim()) return { success: false, output: '', error: '缺少 path 参数' };

    const settings = resolveAsrSettings();
    const config = checkAsrConfig(settings);
    if (!config.configured) return { success: false, output: '', error: config.reason };

    const useDiarization = diarization ?? settings.diarization;
    const relativePath = audioPath.trim().replace(/\\/g, '/');
    const extension = path.extname(relativePath).toLowerCase();

    let audio: AudioBytes;
    try {
      const absolute = resolveWorkspacePath(ctx.workspaceRoot, relativePath);
      audio = new Uint8Array(await fs.readFile(absolute)) as AudioBytes;
    } catch (error) {
      return { success: false, output: '', error: `无法读取音频文件：${error instanceof Error ? error.message : String(error)}` };
    }

    // 发请求前先拦格式与体积，别浪费一次调用与免费额度
    const validation = validateAudioSource({ extension, sizeBytes: audio.byteLength });
    if (!validation.ok) return { success: false, output: '', error: validation.reason };

    const sourceHash = createHash('sha256').update(audio).digest('hex');
    const key = { sourceHash, engineType: settings.engineType, diarization: useDiarization };

    // 幂等：同一文件同一设置已转写且产物仍在，直接复用，不重复计费
    const reusable = findReusableTranscript(key, (transcriptPath) => {
      try {
        return Boolean(resolveWorkspacePath(ctx.workspaceRoot, transcriptPath));
      } catch {
        return false;
      }
    });
    if (reusable?.transcriptPath) {
      const stillThere = await fs
        .readFile(resolveWorkspacePath(ctx.workspaceRoot, reusable.transcriptPath), 'utf8')
        .catch(() => null);
      if (stillThere !== null) {
        const artifact = await buildFileArtifact(ctx.workspaceRoot, reusable.transcriptPath);
        return withFileArtifact({
          success: true,
          output: summarizeTranscript({
            transcriptPath: reusable.transcriptPath,
            durationMs: reusable.durationMs ?? 0,
            sentenceCount: reusable.sentenceCount ?? 0,
            speakerCount: reusable.speakerCount ?? 0,
            diarization: reusable.diarization,
            plainText: '',
            reused: true,
          }),
        }, artifact);
      }
    }

    const existing = findAudioTranscriptByKey(key);
    const claim = startAudioTranscript({
      sourcePath: relativePath,
      sourceHash,
      sizeBytes: audio.byteLength,
      engineType: settings.engineType,
      diarization: useDiarization,
      retrySucceededUpdatedAt: existing?.status === 'succeeded' ? existing.updatedAt : undefined,
    });
    if (!claim.claimed || !claim.attemptId) {
      if (claim.record.status === 'succeeded' && claim.record.transcriptPath) {
        const stillThere = await fs
          .readFile(resolveWorkspacePath(ctx.workspaceRoot, claim.record.transcriptPath), 'utf8')
          .catch(() => null);
        if (stillThere !== null) {
          const artifact = await buildFileArtifact(ctx.workspaceRoot, claim.record.transcriptPath);
          return withFileArtifact({
            success: true,
            output: summarizeTranscript({
              transcriptPath: claim.record.transcriptPath,
              durationMs: claim.record.durationMs ?? 0,
              sentenceCount: claim.record.sentenceCount ?? 0,
              speakerCount: claim.record.speakerCount ?? 0,
              diarization: claim.record.diarization,
              plainText: '',
              reused: true,
            }),
          }, artifact);
        }
      }
      return {
        success: false,
        output: '',
        error: '同一音频正在转写，请等待当前转写完成后再试',
        errorCategory: 'external_service_failure',
      };
    }
    const record = claim.record;
    const attemptId = claim.attemptId;

    try {
      const result = await transcribeAudio({
        audio,
        extension,
        engineType: settings.engineType,
        diarization: useDiarization,
        credentials: config.credentials,
        signal: ctx.signal,
      });

      const transcriptPath = transcriptPathFor(relativePath);
      const markdown = formatTranscriptMarkdown(result, {
        sourceName: path.basename(relativePath),
        model: result.engineType,
        completedAt: Date.now(),
        diarization: result.diarization,
      });
      const artifact = await writeWorkspaceFileAtomically(ctx.workspaceRoot, transcriptPath, async (temporaryPath) => {
        await fs.writeFile(temporaryPath, markdown, 'utf8');
      });

      const completed = completeAudioTranscript(record.id, attemptId, {
        transcriptPath,
        durationMs: result.durationMs,
        sentenceCount: result.sentences.length,
        speakerCount: result.speakerCount,
        providerRequestId: result.requestId,
      });
      if (!completed) throw new Error('转写结果已过期，未覆盖较新的转写状态');

      return withFileArtifact(
        {
          success: true,
          output: summarizeTranscript({
            transcriptPath,
            durationMs: result.durationMs,
            sentenceCount: result.sentences.length,
            speakerCount: result.speakerCount,
            diarization: result.diarization,
            plainText: result.plainText,
            reused: false,
          }),
        },
        artifact,
      );
    } catch (error) {
      if (error instanceof TranscriptionCancelledError) {
        // 用户主动取消不是故障，单独记 cancelled，否则运行记录里会堆满并非错误的“失败”
        failAudioTranscript(record.id, attemptId, { error: error.message, cancelled: true });
        return { success: false, output: '', error: '转写已取消' };
      }
      if (error instanceof TranscriptionFailedError) {
        failAudioTranscript(record.id, attemptId, {
          error: error.message,
          providerCode: error.code || null,
          providerRequestId: error.requestId,
        });
        return {
          success: false,
          output: '',
          error: error.retryable ? `${error.message}（可重试）` : error.message,
        };
      }
      const message = error instanceof Error ? error.message : String(error);
      failAudioTranscript(record.id, attemptId, { error: message });
      return { success: false, output: '', error: `转写失败：${message}` };
    }
  },
};

export { MAX_AUDIO_BYTES };
