import { useCallback, useEffect, useState } from 'react';
import type { McpServerInfo } from '@/shared/types';

const EMPTY_FORM = {
  name: '',
  command: '',
  args: '',
  env: '',
};

export function McpPage() {
  const [servers, setServers] = useState<McpServerInfo[]>([]);
  const [form, setForm] = useState(EMPTY_FORM);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const list = await window.shorekeeper.mcp.list();
    setServers(list);
  }, []);

  useEffect(() => {
    load().catch(console.error);
  }, [load]);

  const handleCreate = async () => {
    if (!form.name.trim() || !form.command.trim()) return;
    setSaving(true);
    try {
      let args: string[] = [];
      let env: Record<string, string> = {};
      if (form.args.trim()) args = JSON.parse(form.args) as string[];
      if (form.env.trim()) env = JSON.parse(form.env) as Record<string, string>;

      await window.shorekeeper.mcp.create({
        name: form.name.trim(),
        command: form.command.trim(),
        args,
        env,
        enabled: true,
      });
      setForm(EMPTY_FORM);
      await load();
    } catch (err) {
      alert(err instanceof Error ? err.message : '创建失败');
    } finally {
      setSaving(false);
    }
  };

  const toggleEnabled = async (server: McpServerInfo) => {
    await window.shorekeeper.mcp.update(server.id, { enabled: !server.enabled });
    await load();
  };

  const remove = async (id: string) => {
    await window.shorekeeper.mcp.delete(id);
    await load();
  };

  const test = async (id: string) => {
    setTestingId(id);
    setTestResult(null);
    try {
      const result = await window.shorekeeper.mcp.test(id);
      if (result.ok) {
        setTestResult(`连接成功，发现 ${result.tools.length} 个工具：${result.tools.join(', ') || '无'}`);
      } else {
        setTestResult(result.error ?? '连接失败');
      }
    } finally {
      setTestingId(null);
    }
  };

  return (
    <div className="space-y-4">
      <p className="text-xs leading-relaxed text-keeper-ice/65">
        MCP Server 通过 stdio 启动，工具名会以 <code className="text-keeper-cyan">mcp__服务器__工具</code> 注册到 Agent。
      </p>

      <div className="keeper-glass-soft space-y-3 rounded-2xl p-4">
        <p className="text-xs font-medium text-keeper-ice/80">添加 MCP Server</p>
        <input
          className="no-drag w-full rounded-lg border border-keeper-silver/20 bg-keeper-navyDeep/50 px-3 py-2 text-xs text-keeper-ice outline-none focus:border-keeper-cyan/40"
          placeholder="名称，如 filesystem"
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
        />
        <input
          className="no-drag w-full rounded-lg border border-keeper-silver/20 bg-keeper-navyDeep/50 px-3 py-2 text-xs text-keeper-ice outline-none focus:border-keeper-cyan/40"
          placeholder="命令，如 npx"
          value={form.command}
          onChange={(e) => setForm({ ...form, command: e.target.value })}
        />
        <input
          className="no-drag w-full rounded-lg border border-keeper-silver/20 bg-keeper-navyDeep/50 px-3 py-2 text-xs text-keeper-ice outline-none focus:border-keeper-cyan/40"
          placeholder='参数 JSON 数组，如 ["-y","@modelcontextprotocol/server-filesystem","D:\\workspace"]'
          value={form.args}
          onChange={(e) => setForm({ ...form, args: e.target.value })}
        />
        <input
          className="no-drag w-full rounded-lg border border-keeper-silver/20 bg-keeper-navyDeep/50 px-3 py-2 text-xs text-keeper-ice outline-none focus:border-keeper-cyan/40"
          placeholder='环境变量 JSON，如 {"KEY":"value"}（可选）'
          value={form.env}
          onChange={(e) => setForm({ ...form, env: e.target.value })}
        />
        <button
          type="button"
          disabled={saving}
          onClick={() => void handleCreate()}
          className="rounded-lg bg-keeper-cyan/20 px-4 py-2 text-xs text-keeper-cyan hover:bg-keeper-cyan/30 disabled:opacity-50"
        >
          {saving ? '保存中…' : '添加'}
        </button>
      </div>

      {testResult && (
        <p className="rounded-lg border border-keeper-cyan/20 bg-keeper-cyan/5 px-3 py-2 text-xs text-keeper-ice/75">
          {testResult}
        </p>
      )}

      <div className="space-y-2">
        {servers.length === 0 && (
          <p className="text-xs text-keeper-ice/50">暂无 MCP Server</p>
        )}
        {servers.map((server) => (
          <div
            key={server.id}
            className="keeper-glass-soft flex flex-col gap-2 rounded-xl p-3 text-xs text-keeper-ice/80"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium text-keeper-ice">{server.name}</span>
              <span className={server.enabled ? 'text-emerald-400' : 'text-keeper-ice/40'}>
                {server.enabled ? '已启用' : '已禁用'}
              </span>
            </div>
            <p className="break-all text-keeper-ice/55">
              {server.command} {server.args.join(' ')}
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void toggleEnabled(server)}
                className="rounded-md bg-keeper-cyan/10 px-2 py-1 text-keeper-cyan hover:bg-keeper-cyan/20"
              >
                {server.enabled ? '禁用' : '启用'}
              </button>
              <button
                type="button"
                disabled={testingId === server.id}
                onClick={() => void test(server.id)}
                className="rounded-md bg-keeper-cyan/10 px-2 py-1 text-keeper-cyan hover:bg-keeper-cyan/20 disabled:opacity-50"
              >
                {testingId === server.id ? '测试中…' : '测试连接'}
              </button>
              <button
                type="button"
                onClick={() => void remove(server.id)}
                className="rounded-md bg-red-500/10 px-2 py-1 text-red-300 hover:bg-red-500/20"
              >
                删除
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
