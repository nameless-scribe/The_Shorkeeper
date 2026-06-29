import { useCallback, useEffect, useState } from 'react';
import type { ModelProtocol } from '@/shared/types';

export function ModelPage() {
  const [protocol, setProtocol] = useState<ModelProtocol>('openai');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const value = await window.shorekeeper.model.getProtocol();
    setProtocol(value);
    setLoading(false);
  }, []);

  useEffect(() => {
    load().catch(console.error);
  }, [load]);

  const handleChange = async (next: ModelProtocol) => {
    const value = await window.shorekeeper.model.setProtocol(next);
    setProtocol(value);
  };

  if (loading) {
    return <p className="text-sm text-keeper-ice/60">加载中…</p>;
  }

  return (
    <div className="space-y-4">
      <p className="text-xs leading-relaxed text-keeper-ice/65">
        API Key 与模型 ID 仍在 <code className="text-keeper-cyan">.env</code> 配置。此处选择请求协议格式。
      </p>

      <div className="space-y-2">
        <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-keeper-silver/15 p-3">
          <input
            type="radio"
            name="protocol"
            checked={protocol === 'openai'}
            onChange={() => void handleChange('openai')}
            className="mt-0.5"
          />
          <div>
            <p className="text-sm text-keeper-ice">OpenAI 兼容</p>
            <p className="mt-1 text-xs text-keeper-ice/55">
              百炼 Qwen 等默认格式，POST /chat/completions
            </p>
          </div>
        </label>

        <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-keeper-silver/15 p-3">
          <input
            type="radio"
            name="protocol"
            checked={protocol === 'anthropic'}
            onChange={() => void handleChange('anthropic')}
            className="mt-0.5"
          />
          <div>
            <p className="text-sm text-keeper-ice">Anthropic 兼容</p>
            <p className="mt-1 text-xs text-keeper-ice/55">
              Claude 风格 Messages API，POST /messages（含 tool_use 转换）
            </p>
          </div>
        </label>
      </div>
    </div>
  );
}
