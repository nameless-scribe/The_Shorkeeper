# P8 固定样本

放三张你真正会问的图片（计划 §5 P8.0）：

| 文件名建议 | 内容 | 用途 |
|---|---|---|
| `device.jpg` | 设备照片 | `answer` 模式："这是什么设备" |
| `drawing.png` | 图纸页（或扫描件某一页） | `read_text` 模式：标题栏、材料、尺寸标注 |
| `screenshot.png` | 手机 / 电脑截图 | `describe` 模式 |

每张小于 2 MB 即可；自动化测试只用代码现生成的小图，不读这个目录。真实调用用：

```
pnpm vision:probe docs/p8-samples/device.jpg docs/p8-samples/drawing.png docs/p8-samples/screenshot.png
VISION_PROBE_MODE=read_text pnpm vision:probe docs/p8-samples/drawing.png
```

探针结果（请求 ID、token 计数与公式误差、是否接受 `enable_thinking`、大图上限）记到 `docs/P8-VISION-PLAN.md` 第 10 节。
这个目录里的图片不要提交到仓库（`.gitignore` 已排除 `docs/p8-samples/*.jpg|png|webp`）。
