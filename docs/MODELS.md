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

## 2. 配置 `.env`

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
| 请求超时 | 检查网络；北京区域接入点需能访问阿里云 |

## 5. 切换其他百炼模型

只改 `.env` 中的 `DEFAULT_MODEL`，例如：

```env
DEFAULT_MODEL=qwen-max
```

保存后重启 `pnpm dev`。
