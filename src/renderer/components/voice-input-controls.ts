/**
 * 聊天框语音输入的纯逻辑：按钮状态推导、识别结果并入草稿、是否自动发送。
 * 不碰 React、IPC 与 window。
 *
 * 按 docs/DEVELOPMENT-CONTRACT.md §8：renderer 的 state 逻辑要抽成纯函数单独测，
 * 不要留在 setState 的 updater 里（见 P3 计划 §9.6 的三个 bug）。
 */
import type { VoiceInputStatus } from '../hooks/useVoiceInput';

export interface MicButtonInput {
  /** 设置里是否启用了语音输入 */
  sttEnabled: boolean;
  /** 输入框整体禁用（模型运行中 / 未配置 API） */
  disabled: boolean;
  /** 按住说话；false 表示点击开始、再点击结束 */
  pushToTalk: boolean;
  status: VoiceInputStatus;
}

export interface MicButtonState {
  /** 按钮图标 */
  icon: string;
  /** 悬浮提示，同时说明当前交互方式 */
  title: string;
  /** 是否可点击 */
  enabled: boolean;
  /** 是否正在录音（用于电平条与样式） */
  recording: boolean;
  /** 识别中：按钮转圈且不可再触发 */
  busy: boolean;
}

export function describeMicButton(input: MicButtonInput): MicButtonState {
  if (!input.sttEnabled) {
    // 保留按钮而不是隐藏：否则用户不知道有这个功能，也找不到去哪儿开。
    return { icon: '🎤', title: '语音输入已在「设置 → 语音」中关闭', enabled: false, recording: false, busy: false };
  }
  if (input.status === 'transcribing') {
    return { icon: '⏳', title: '正在识别…', enabled: false, recording: false, busy: true };
  }
  if (input.status === 'recording') {
    return {
      icon: '⏹',
      title: input.pushToTalk ? '松开结束录音' : '点击结束录音',
      // 录音中必须能结束，即使此时输入框因模型开始运行而被禁用，否则麦克风会一直占着。
      enabled: true,
      recording: true,
      busy: false,
    };
  }
  return {
    icon: '🎤',
    title: input.pushToTalk ? '按住说话' : '点击开始录音',
    enabled: !input.disabled,
    recording: false,
    busy: false,
  };
}

/**
 * 把识别结果并入已有草稿。不覆盖用户已经打出来的字——
 * 与 InputBar 处理收件箱回链草稿的既有取舍一致。
 */
export function mergeTranscript(current: string, transcript: string): string {
  const incoming = transcript.trim();
  if (!incoming) return current;
  const kept = current.replace(/\s+$/, '');
  if (!kept.trim()) return incoming;
  return `${kept} ${incoming}`;
}

export interface AutoSendInput {
  /** 设置项 sttAutoSend */
  autoSend: boolean;
  /** 本次识别出的文本 */
  transcript: string;
  /** 输入框当前是否被禁用 */
  disabled: boolean;
}

/** 识别为空（没说话、静音）时绝不自动发送，否则会发出一条空消息或把旧草稿误发。 */
export function shouldAutoSend(input: AutoSendInput): boolean {
  return input.autoSend && !input.disabled && input.transcript.trim().length > 0;
}

/** 录音电平映射到 0–100 的条宽；超出范围夹紧，避免样式溢出。 */
export function levelToPercent(level: number): number {
  if (!Number.isFinite(level) || level <= 0) return 0;
  return Math.round(Math.min(1, level) * 100);
}
