/**
 * PCM 采集 AudioWorklet：把每一帧输入原样转发到主线程。
 *
 * 之所以是独立静态文件而不是内联 blob：index.html 的 CSP 只允许 `script-src 'self'`，
 * `audioWorklet.addModule(blobUrl)` 会被拦下（报 "Unable to load a worklet's module"）。
 * 与 public/vad/ 一样，dev 与 build 都按同源路径 `worklets/pcm-collector.js` 加载。
 */
class PcmCollector extends AudioWorkletProcessor {
  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (channel && channel.length) {
      // 必须复制：底层缓冲区在 process() 返回后会被引擎复用。
      this.port.postMessage(channel.slice(0));
    }
    return true;
  }
}

registerProcessor('pcm-collector', PcmCollector);
