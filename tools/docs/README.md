# 图文文档构建

输入源：`docs/human/*.md`、`docs/human/figures/*.svg`。PDF 由 Markdown 解析生成，不维护第二份正文。

```bash
python3 tools/docs/build_figures.py
python3 tools/docs/fill_upgrade_tables.py
python3 tools/docs/build_pdfs.py
python3 tools/docs/package_delivery.py
```

依赖 Python 的 reportlab 与 Pillow。当前渲染脚本使用 macOS `/System/Library/Fonts/STHeiti Medium.ttc` 并将字体嵌入 PDF；换系统需调整 `build_pdfs.py` 的 FONT 路径为可嵌入的中文 TrueType 字体。

- `build_figures.py` 生成原生 SVG 流程/键位/架构图；角色来自实际 PNG 精灵，通过逐行同色像素转换成 SVG 矩形，不修改原游戏图片。
- `fill_upgrade_tables.py` 读取真实强化配置，更新 Markdown 中标记的 24 张强化表。
- `build_pdfs.py` 读取 Markdown 与 SVG，生成 `output/pdf/` 下三份 PDF。`<!-- pagebreak -->` 控制章节分页。
- `package_delivery.py` 需要已生成的离线 HTML、许可说明和 PDF，按明确白名单打包，不携带 AI 记录或私人配置。
- PDF 修改后需用 Poppler 渲染并人工查看；不要把“脚本退出0”当作排版验收。

本机实际使用的 Python 由 Codex workspace dependencies 提供；上述命令也可换成具备这些依赖的本机 Python。
