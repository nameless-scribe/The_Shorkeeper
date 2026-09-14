/**
 * PCM 定长分帧的纯逻辑。流式 STT 要求每帧字节数固定，
 * 而录音回调给的块大小不固定，必须先缓冲再切分，余数留到下一块。
 *
 * 单独抽出来是因为分帧一旦差一个字节，音频会整体错位，
 * 表现是识别结果变成噪音——这种问题在真机上很难定位，但用纯函数一测就明。
 */

/** 固定用独立的 ArrayBuffer：帧最终要经 IPC 结构化克隆，不能是 SharedArrayBuffer 视图。 */
export type PcmBytes = Uint8Array<ArrayBuffer>;

export interface PcmFrameSplit {
  /** 已凑满的定长帧，按顺序发送 */
  frames: PcmBytes[];
  /** 不足一帧的余数，留给下一次 */
  remainder: PcmBytes;
}

export function concatPcm(buffered: PcmBytes, incoming: PcmBytes): PcmBytes {
  if (buffered.byteLength === 0) return incoming;
  if (incoming.byteLength === 0) return buffered;
  const merged = new Uint8Array(buffered.byteLength + incoming.byteLength);
  merged.set(buffered, 0);
  merged.set(incoming, buffered.byteLength);
  return merged;
}

export function splitPcmFrames(buffered: PcmBytes, incoming: PcmBytes, frameBytes: number): PcmFrameSplit {
  if (!Number.isInteger(frameBytes) || frameBytes <= 0) {
    throw new Error(`帧长必须是正整数字节数，收到 ${frameBytes}`);
  }
  let rest = concatPcm(buffered, incoming);
  const frames: PcmBytes[] = [];
  while (rest.byteLength >= frameBytes) {
    frames.push(rest.slice(0, frameBytes));
    rest = rest.slice(frameBytes);
  }
  return { frames, remainder: rest };
}
