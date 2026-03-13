# P2-01: 主图生成 Prompt 质量升级 — 达到商业大片级效果

## 问题诊断

对比 PicSet (picsetai.com) 和 Shopix 的主图生成效果，同样以粉底液为例：
- **PicSet**: 有丝绸质感背景、动态构图、柔和侧逆光、前景装饰元素 → 商业大片感
- **Shopix**: 产品居中、背景空白、光线平淡、无场景层次 → 平平无奇

### 根因分析（5 层）

| # | 根因 | 影响 | 严重度 |
|---|------|------|--------|
| 1 | **分析系统提示词缺乏商业摄影具体指令** | 蓝图产出的 design_content 抽象空洞，缺少具体构图比例、光线角度、场景层次描述 | 🔴 Critical |
| 2 | **Prompt 结构太机械** | `Subject: ... Composition: ... Background: ...` 标签式拼接，模型无法自然理解场景意图 | 🔴 Critical |
| 3 | **E-commerce Prefix 重保真轻创意** | 7 行 prefix 中 5 行说"不要改产品"，模型把注意力全放在保真上，忽略创意表现 | 🟡 High |
| 4 | **默认图片尺寸 1K 太小** | PicSet 默认 2K，分辨率差异直接影响细节丰富度和质感渲染 | 🟡 High |
| 5 | **缺少场景丰富度指令** | 无前景装饰元素、无多层景深、无动态角度模板 | 🟡 High |

---

## 修改范围

### 文件清单

| 文件 | 修改内容 | 风险 |
|------|---------|------|
| `supabase/functions/process-generation-job/index.ts` | ① 分析系统提示词增强 ② ecomPrefix 重写 | 中 — 核心路径 |
| `supabase/functions/generate-prompts-v2/index.ts` | ③ `buildGenesisPicsetPromptObjects()` 重构 prompt 结构 ④ 蓝图系统提示词增强 | 中 — 核心路径 |
| `supabase/functions/_shared/generation-config.ts` | ⑤ 默认 imageSize 改为 2K | 低 — 配置变更 |

### 不动的部分
- 前端 UI（StudioGenesisForm.tsx）— 无需改
- 任务调度逻辑（claim/retry）— 无关
- 计费逻辑 — 2K 已有定价（8 credits）
- 其他模块（clothing、refinement、style replicate）— 不涉及

---

## 任务分解

### Task 1: 分析系统提示词增强（Critical）

**文件**: `supabase/functions/process-generation-job/index.ts` — `processAnalysisJob()` 中的分析系统提示词

**目标**: 让 Kimi 分析模型产出的 design_specs 和 design_content 更加具体、可执行

**改动要点**:

在现有分析系统提示词中增加**商业摄影参数要求**：

```
你必须在每张图片的 design_content 中包含以下具体参数（不能用模糊描述）：

**构图参数**：
- 产品在画面中的占比（如 60%、75%）
- 具体构图方式（居中/三分法/对角线/黄金分割）
- 产品倾斜角度（如 "微微向右倾斜15°"）

**光线参数**：
- 主光源方向和角度（如 "左上方45°柔光箱"）
- 是否有轮廓光/逆光/反射光
- 阴影特征（如 "产品底部有柔和渐变投影"）

**场景层次**：
- 前景元素（如 "前景有虚化的花瓣/丝绸/水滴"）
- 中景（产品主体及其摆放方式）
- 背景类型和质感（如 "暖灰色大理石纹理" 而非仅"灰色背景"）

**氛围营造**：
- 装饰元素（如 "飘散的金粉粒子"、"流动的丝绸"）
- 色温倾向（暖调/冷调/中性）
- 整体风格关键词（如 "高端奢华"、"清新自然"、"科技未来"）

**摄影参数参考**：
- 推荐镜头焦段（如 85mm/100mm 微距）
- 推荐光圈范围（如 f/5.6-f/8）
- 景深描述（如 "中浅景深，背景适度虚化"）
```

**验证**: 用粉底液产品图测试，检查蓝图产出是否包含具体的百分比、角度、场景层次描述

---

### Task 2: Prompt 结构重构（Critical）

**文件**: `supabase/functions/generate-prompts-v2/index.ts` — `buildGenesisPicsetPromptObjects()`

**目标**: 从标签式 `Subject: ... Composition: ...` 改为自然语言段落式 prompt

**当前结构**（有问题的）:
```
Subject: A foundation bottle with glass body...
Composition: Product occupies 70% of frame, centered layout...
Background: Warm marble texture surface...
Lighting: Soft side-backlight...
Color scheme: Primary nude beige, champagne gold accent...
Material details: Glass transparency, liquid silk texture...
Text layout: No typography...
Atmosphere: Luxurious, premium...
Style: Commercial photography, f/5.6...
Quality: 4K, hyper-realistic...
```

**改为**（自然语言段落式）:
```
A sleek glass foundation bottle (nude beige #E8C9A0, champagne gold cap)
stands on a warm gray marble surface with subtle veining,
tilted 15° to the right to catch a soft side-backlight from the upper left at 45°.

The product occupies 70% of the frame using a slightly off-center composition.
In the foreground, a flowing cream silk fabric drapes softly, partially out of focus.
Behind the bottle, a gentle gradient fades from warm beige to soft cream.

Rim lighting traces the glass contour, revealing the liquid's silky translucence inside.
A diffused golden highlight appears on the cap surface.
The product casts a delicate shadow on the marble, adding depth.

Fine scattered gold dust particles float in the upper portion of the frame,
catching the light and creating a luxurious atmosphere.

Keep the exact product identity: glass bottle shape, nude beige liquid color (#E8C9A0),
champagne gold cap, brand logo placement — no changes allowed.

Shot with 85mm lens at f/5.6, medium-shallow depth of field.
8K resolution, hyper-realistic commercial photography, zero artifacts.
```

**实现方式**: 重写 `buildGenesisPicsetPromptObjects()` 函数：
1. 提取各个 section 的内容（保持现有解析逻辑）
2. 用自然语言模板拼接，而非 `Key: Value` 格式
3. 确保场景层次（前景/中景/背景）都被描述
4. 在末尾追加产品保真锚点（简短版）
5. 在末尾追加摄影参数和画质要求

---

### Task 3: E-commerce Prefix 重写（High）

**文件**: `supabase/functions/process-generation-job/index.ts` — line 3436

**当前 prefix**（7 行，5 行是保真指令）:
```
Professional e-commerce product photography. High-end commercial catalog quality.
Clean, premium aesthetic. Product is the hero — sharp focus, realistic materials and textures.
Use the uploaded product images as hard references for the exact same SKU.
Preserve the exact same product identity, colorway, material, texture, silhouette, proportions, logo, print, hardware, stitching, trims, and all key design details.
Do not recolor, redesign, simplify, replace, or invent new product features.
Only scene, composition, camera angle, crop, lighting, and background styling may change.
4K ultra-detailed rendering.
```

**新 prefix**（创意优先，保真精简）:
```
Cinematic commercial product photography with dramatic lighting and rich scene depth.
Create a visually striking hero image with layered foreground elements,
textured backgrounds, and purposeful lighting that evokes luxury and desire.
The uploaded product image is the exact reference — preserve its identity
(shape, color, material, logo, all details) while placing it in an elevated,
magazine-quality setting. 4K ultra-detailed rendering.
```

**关键变化**:
- 从"不要做X" → "要做Y"（正向指令更有效）
- 前 2 行全是创意指令（dramatic lighting, rich scene depth, layered foreground）
- 保真指令压缩为 1 行
- 加入"magazine-quality setting"作为品质锚点

---

### Task 4: 默认图片尺寸改为 2K（High）

**文件**: `supabase/functions/_shared/generation-config.ts`

**改动**: 将 `or-gemini-3.1-flash` 和 `or-gemini-2.5-flash` 的 `defaultSize` 从 `"1K"` 改为 `"2K"`

**信用消耗变化**: 5 credits → 8 credits（已有定价，无需改计费逻辑）

**风险**: 用户可能因为信用消耗增加而不满 → 可在前端提示"已升级为2K默认"

---

### Task 5: 蓝图系统提示词增强（High）

**文件**: `supabase/functions/generate-prompts-v2/index.ts` — `genesisBlueprintSystemPromptZh` / `genesisBlueprintSystemPromptEn`

**目标**: 让 LLM 生成 prompt 时自动加入场景丰富度

**在系统提示词末尾增加**:
```
商业大片级视觉要求：
- 每张图必须有至少 2 层场景深度（前景装饰 + 产品主体 + 背景质感）
- 禁止空白背景或纯色背景（除非是白底精修图类型）
- 光线必须有方向性和层次感（主光 + 辅光 + 轮廓光/环境光）
- 构图必须有动态感（产品可微微倾斜、使用对角线或三分法构图）
- 装饰元素要与产品品类关联（如：美妆 → 花瓣/丝绸/水滴，电子 → 光线/反射/几何线条）
- prompt 必须用自然英文段落描述完整场景，而不是罗列关键词
```

---

## 实施顺序

```
Task 1 (分析提示词增强) ──┐
                           ├──→ Task 2 (Prompt 结构重构) ──→ 冒烟测试
Task 3 (ecomPrefix 重写) ──┘
Task 4 (默认 2K) ── 独立可并行
Task 5 (蓝图系统提示词) ── 与 Task 2 一起测试
```

**依赖关系**:
- Task 1 和 Task 3 可以并行
- Task 2 依赖 Task 1（分析产出影响 prompt 拼接）
- Task 4 独立
- Task 5 与 Task 2 一起测试

---

## 验证方案

### 冒烟测试（每个 Task 完成后）
1. 使用粉底液产品图在 studio-genesis-2 生成 3 张图
2. 对比改前/改后效果
3. 检查项：
   - ✅ 是否有场景层次（前景/中景/背景）
   - ✅ 光线是否有方向性和层次感
   - ✅ 产品是否保真（颜色、形状、logo）
   - ✅ 是否有装饰元素
   - ✅ 构图是否有动态感（非方方正正）
   - ✅ 整体是否达到商业广告级品质

### 回归测试
1. 用不同品类产品测试（电子产品、食品、服装配件）
2. 确认 prompt 质量对不同品类都有效
3. 确认 2K 默认不影响其他模型的计费

---

## 风险

| 风险 | 缓解 |
|------|------|
| 分析模型 Kimi 不遵循新增的参数要求 | 用 few-shot 示例 + 强约束语气 |
| 自然语言 prompt 太长导致超 token | 控制段落数量，设置 prompt 长度上限 |
| 2K 默认导致用户信用消耗投诉 | 前端提示 + 允许用户手动选 1K |
| 改动太大导致已有 prompt profile 失效 | ta-pro 的 identity lock 逻辑保持不变 |
| 过于华丽的场景抢走产品焦点 | 在 prompt 中明确"产品是视觉焦点" |

---

## 预期效果

**改前**: 产品居中 + 空白/纯色背景 + 平面光 + 无场景层次 = 淘宝普通卖家图
**改后**: 产品微倾 + 质感背景 + 多层场景 + 方向性灯光 + 装饰元素 = 商业大片 / 杂志广告级
