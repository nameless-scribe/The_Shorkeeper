import { describe, expect, it } from 'vitest';
import {
  describeMicButton,
  levelToPercent,
  mergeTranscript,
  shouldAutoSend,
  type MicButtonInput,
} from '../voice-input-controls';

function mic(overrides: Partial<MicButtonInput> = {}): MicButtonInput {
  return { sttEnabled: true, disabled: false, pushToTalk: true, status: 'idle', ...overrides };
}

describe('chat voice input controls', () => {
  it('keeps the button visible but disabled when STT is switched off in settings', () => {
    const state = describeMicButton(mic({ sttEnabled: false }));
    expect(state.enabled).toBe(false);
    expect(state.title).toContain('设置');
  });

  it('describes the interaction that actually applies in each mode', () => {
    expect(describeMicButton(mic({ pushToTalk: true })).title).toBe('按住说话');
    expect(describeMicButton(mic({ pushToTalk: false })).title).toBe('点击开始录音');
    expect(describeMicButton(mic({ pushToTalk: true, status: 'recording' })).title).toBe('松开结束录音');
    expect(describeMicButton(mic({ pushToTalk: false, status: 'recording' })).title).toBe('点击结束录音');
  });

  it('stays clickable while recording even if the input bar became disabled', () => {
    // 模型在录音途中开始运行会禁用输入框；此时仍必须能结束录音，否则麦克风一直被占用。
    const state = describeMicButton(mic({ disabled: true, status: 'recording' }));
    expect(state.enabled).toBe(true);
    expect(state.recording).toBe(true);
  });

  it('blocks re-triggering while transcribing', () => {
    const state = describeMicButton(mic({ status: 'transcribing' }));
    expect(state.enabled).toBe(false);
    expect(state.busy).toBe(true);
  });

  it('is disabled when the input bar is disabled and nothing is being recorded', () => {
    expect(describeMicButton(mic({ disabled: true })).enabled).toBe(false);
  });

  it('appends the transcript without clobbering what the user already typed', () => {
    expect(mergeTranscript('', '你好')).toBe('你好');
    expect(mergeTranscript('   ', '你好')).toBe('你好');
    expect(mergeTranscript('帮我', '查一下天气')).toBe('帮我 查一下天气');
    expect(mergeTranscript('帮我   ', '  查一下天气  ')).toBe('帮我 查一下天气');
  });

  it('leaves the draft untouched when nothing was recognized', () => {
    expect(mergeTranscript('已经打的字', '')).toBe('已经打的字');
    expect(mergeTranscript('已经打的字', '   ')).toBe('已经打的字');
  });

  it('never auto-sends an empty recognition result', () => {
    expect(shouldAutoSend({ autoSend: true, transcript: '走吧', disabled: false })).toBe(true);
    expect(shouldAutoSend({ autoSend: true, transcript: '   ', disabled: false })).toBe(false);
    expect(shouldAutoSend({ autoSend: true, transcript: '走吧', disabled: true })).toBe(false);
    expect(shouldAutoSend({ autoSend: false, transcript: '走吧', disabled: false })).toBe(false);
  });

  it('clamps the level meter to 0-100', () => {
    expect(levelToPercent(0)).toBe(0);
    expect(levelToPercent(-1)).toBe(0);
    expect(levelToPercent(0.5)).toBe(50);
    expect(levelToPercent(1)).toBe(100);
    expect(levelToPercent(4)).toBe(100);
    expect(levelToPercent(Number.NaN)).toBe(0);
  });
});
