# 模型配置：阿里云百炼 Qwen3.6-Plus

The Shorekeeper 通过 **OpenAI 兼容接口** 调用百炼模型，无需改代码。

## 1. 在百炼控制台获取信息

打开 [阿里云百炼 → API Key](https://bailian.console.aliyun.com/)，记录：

| 项 | 说明 |
|----|------|
| **API Key** | `sk-` 开头，点击「查看」复制完整密钥 |
| **OpenAI compatible 接入点** | 形如 `https://llm-xxxx.cn-beijing.maas.aliyuncs.com/compatible-mode/v1` |
| **模型名称** | API 模型 ID：`qwen3.6-plus`（小写，不是界面上的 `Qwen3.6-Plus`） |

> 接入点域名中的 `llm-xxxx` 每人不同，必须从你自己的控制台复制，不要用别人的。

## 2. 配置方式

### 方式 A：应用内设置（推荐）

1. 启动应用 → **设置 → API 设置**
2. 可保存**多套**接入配置（名称、Base URL、模型 ID、API Key、协议），点击切换「当前使用」
3. 保存后立即生效，无需重启

应用内配置优先于 `.env`。

### 方式 B：`.env` 文件

在项目根目录：

```powershell
copy .env.example .env
```

编辑 `.env`：

```env
OPENAI_API_KEY=sk-你的完整Key
OPENAI_BASE_URL=https://llm-o3kz1vn36c7rl7o7.cn-beijing.maas.aliyuncs.com/compatible-mode/v1
DEFAULT_MODEL=qwen3.6-plus
INCLUDE_STREAM_USAGE=false
```

将 `OPENAI_BASE_URL` 换成你控制台显示的 **OpenAI compatible** 地址。

## 3. 启动验证

```powershell
pnpm dev
```

顶栏应显示 `Qwen3.6-Plus 已连接`，发送消息可流式回复。

## 4. 常见问题

| 现象 | 处理 |
|------|------|
| `401 Unauthorized` | 检查 API Key 是否完整、是否过期 |
| `404 / model not found` | 模型 ID 必须用小写 API 名，如 `qwen3.6-plus`，不要用 `Qwen3.6-Plus` |
| `400 stream_options` | 保持 `INCLUDE_STREAM_USAGE=false` |
| 缓存始终未命中 | 免费额度通常不返回 `cached_tokens`；按量付费后若 API 支持隐式缓存才可能显示 |
| 显式缓存 | 默认关闭；仅在 `.env` 设 `ENABLE_EXPLICIT_CACHE=true` 时发送 `cache_control` |
| 请求超时 | 检查网络；北京区域接入点需能访问阿里云 |

## 5. 切换其他百炼模型

在 **设置 → API 设置** 修改模型 ID，或改 `.env` 中的 `DEFAULT_MODEL`，例如：

```env
DEFAULT_MODEL=qwen-max
```

应用内已保存的配置优先；仅改 `.env` 时需重启 `pnpm dev`。

---

## 6. Claude 对话 + RAG 知识库（双 API）

第三方 Claude 代理（如 Nuoda）通常只提供 `/v1/chat/completions`，**不提供** `/v1/embeddings`。若要用 Claude 做需求设计、同时检索知识库，需**分开配置**：

| 用途 | 配置位置 | 示例 |
|------|----------|------|
| **对话** | 设置 → API 设置 | Base URL `https://api.nuoda.vip/v1`，模型 `claude-opus-4-8`，协议 **OpenAI** |
| **向量（RAG）** | 设置 → 文档 → 向量 API | 选「单独配置」，填百炼 Base URL + Key + `text-embedding-v3` |

也可在 `.env` 中配置向量（应用内「单独配置」优先）：

```env
EMBEDDING_API_KEY=sk-你的百炼Key
EMBEDDING_BASE_URL=https://llm-xxxx.cn-beijing.maas.aliyuncs.com/compatible-mode/v1
EMBEDDING_MODEL=text-embedding-v3
```

**推荐流程：**

1. API 设置：启用 Nuoda Claude  
2. 文档 → 向量 API：选「单独配置」，保存百炼 Embedding  
3. 文档 → 导入 `docs/oa-management-system-requirements-v2.md`  
4. 对话中提问（带文档相关词），如：「根据 OA 功能清单，设计报销模块的接口方案」

导入与每次检索都走 Embedding API；生成回答仍走 Claude。
