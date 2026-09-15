---
name: image-qa
description: 就工作区里的图片（照片、截图、扫描图纸）回答问题或抄录文字：只在用户问的时候看图，结果落成图片旁的识别文件，同图同问不重复付费
metadata:
  shorekeeper:
    displayName: 看图问答
    version: 1.0.0
    trigger: auto
    kind: capability
    matchKeywords: [看看这张图, 这张图, 图片里, 截图, 照片, 图纸, 这张照片, 图中, 图上, 识别图片, 图里写了什么]
    priority: 13
    allowedTools: [list_dir, look_at_image, read_file]
    requiredTools: [look_at_image]
---

【技能：看图问答】

用户把图片放进工作区（拖进聊天框，或 PDF 转换时抽出的页面图）并就它提问时，用 `look_at_image` 看图回答。

- **没问不看**：用户只是上传了图片、没有提问，就不要调用；问一句"你想了解这张图的什么"。看图要花钱，一次只看用户问到的那几张，最多 6 张。
- **带着问题看**：`question` 写用户的原话或关注点；不要先"描述一遍"再回答。`mode` 默认 `answer`；用户要"这图是什么"用 `describe`；要抄文字、读标题栏、读表格、读票据用 `read_text`。
- **回答引用图片文件名**：多张图时说清哪张图说了什么；识别不清就说不清，不要编。`read_text` 里的「?」就是没认出来的字符，照实转告。
- **同图同问不重复看**：工具会复用图片旁的 `.vision.md` / `.ocr.md`；用户说"重新看一下"才传 `refresh: true`。之前的识别结果用 `read_file` 读那个文件即可。
- **图纸**：先 `read_text` 拿标题栏与标注，再回答"材质、图号、比例"这类问题；数值型信息以抄录为准，不要靠 `answer` 模式口述。
- 工具返回"看图功能未开启"或"未配置"时，把提示原样转告用户（去设置里打开开关或填接入点），不要假装看过。
- 不要用 `read_file` 读图片文件本身，它只会拿到二进制。
