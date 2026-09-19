# 资源登记

运行时外部资源的唯一台账（agent.md §3：`assets/` 放运行时美术资源）。
每个文件必须登记来源与授权，防止日后不明不白地躺在仓库里。

## assets/textures/ —— HD 材质皮肤（v1.3）

由 Meowa game-assets skill（`nano-banana-run`，1K 1:1）生成的无缝材质贴图。
几何体仍然全部程序化，贴图只用于大面积台面（见 `src/render/skins.ts`）。

| 文件 | 用途 | 生成提示词（摘要） |
| --- | --- | --- |
| `deck_teak.webp` | 船甲板 | aged teak ship decking, vertical planks, rope caulk, nails |
| `hull_oak_dark.webp` | 棋盘外框、船体侧面 | dark weathered oak hull planks, damp stains |
| `paper_parchment.webp` | 桌面（棋盘之下的大台面） | aged parchment map paper, tea-stain edges |
| `water_teal.webp` | 棋盘水面 | deep teal ocean surface, small ripples |
| `dock_pine_light.webp` | 马尼拉港 / 修船场台面 | light honey dock floorboards with rope seams |

授权：Meowa 生成内容，随账户条款授予使用权限（试用积分生成，2026-09-19）。
生成原始 PNG（1024×1024）保留在 `tmp/meowa/out/`（gitignored），仓库内为 WebP（q82）。
