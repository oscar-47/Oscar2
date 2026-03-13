# P3-01: Genesis ANALYSIS 速度优化

## 目标
Genesis ANALYSIS 从当前 avg 30-35s 降到 avg 15-20s，不降低蓝图质量。

## 现状分析

| 指标 | Genesis | Ecom-Detail |
|------|---------|-------------|
| 平均耗时 | 30-35s | 13-25s |
| System prompt (ZH) | 1,662 字 / 18 条规则 | 535 字 / 9 条规则 |
| User prompt (ZH) | 3,498 字 | ~1,200 字 |
| 输入 token (EN) | ~9,980 | ~3,000 |
| maxTokens | 2,400 | 2,048 |

**瓶颈**：输入 token 太多 + 输出 JSON 结构臃肿 → 模型生成慢。

## 优化方案（4 步，可逐步上线）

### Step 1: 压缩 prompt — 去重 + 精简（预期 -30% token）

**问题**：System prompt 和 User prompt 之间有大量重复规则。
- 产品身份锁定：重复 3 次（system rule 3 + user 提取规则 + user 分析规则）
- 构图多样性：重复 2 次（system rule 16 + user 分析规则）
- 场景深度：重复 2 次（system rule 15 + user 分析规则）
- 禁止抽象词：重复 2 次（system rule 14 + user 分析规则）

**方案**：
- System prompt：保留核心身份定义 + 输出格式约束（~8 条浓缩规则）
- User prompt：保留 JSON schema + 具体约束条件（去掉与 system 重叠的）
- 合并同义规则，用更简洁的表述

**改动文件**：`process-generation-job/index.ts` (genesis system/user prompt 文本)
**风险**：低 — 只改文字，不改代码逻辑。先改 ZH 版，验证质量后改 EN 版。

---

### Step 2: 精简输出 JSON — 砍掉冗余字段（预期 -20% 输出 token）

**问题**：模型被要求输出很多实际无用/总是空的字段：
- `copy_analysis.shared_copy` — 规则要求**必须为空字符串**，但模型每次都要输出它
- `copy_analysis.can_clear_to_visual_only` — 总是 true
- `copy_analysis.per_plan_adaptations` — 可以从 images 推断，不需要单独输出
- `style_directions` — 3 个维度各 3 个标签 + recommended，实际 UI 只用 recommended

**方案**：
- 删除 `shared_copy`（代码侧硬编码为空）
- 删除 `can_clear_to_visual_only`（代码侧硬编码为 true）
- 简化 `per_plan_adaptations` 为可选
- `style_directions` 每个维度只要 1 个推荐值 + 1 个备选

**改动文件**：`process-generation-job/index.ts` (prompt + normalizeGenesisAnalysis)
**风险**：低 — 下游代码已经对这些字段做了 fallback

---

### Step 3: 降低 design_content 详细度（预期 -25% 输出 token）

**问题**：每张图的 `design_content` 要求 7 个固定章节，含大量细节（主光方向/角度、焦段/光圈、前景/中景/背景层次...），而下游 `generate-prompts-v2` 只用其中一部分。

**方案**：
- 分析 `generate-prompts-v2` 实际读取了 design_content 的哪些字段
- 只要求模型输出实际被消费的字段
- 把 7 个章节压缩为 4 个关键章节：设计目标 / 产品+场景 / 构图+光影 / 文字内容

**改动文件**：`process-generation-job/index.ts` (prompt), `generate-prompts-v2/index.ts` (parser 适配)
**风险**：中 — 需要确认 generate-prompts-v2 的依赖关系

---

### Step 4: maxTokens 动态调整（预期 -10% 延迟）

**问题**：当前 maxTokens=2400 固定。imageCount=1 时输出远不需要 2400 token，但模型仍按上限预留计算资源。

**方案**：
- `imageCount=1` → maxTokens=1200
- `imageCount<=3` → maxTokens=1800
- `imageCount<=7` → maxTokens=2400
- `imageCount>7` → maxTokens=3072

**改动文件**：`process-generation-job/index.ts` (callQnChatAPI 调用处)
**风险**：低 — 加 fallback，如果输出被截断则用更高 maxTokens 重试

---

## 预期效果

| 步骤 | Token 削减 | 预期耗时 |
|------|-----------|---------|
| 现状 | — | 30-35s |
| Step 1 完成 | 输入 -30% | ~25s |
| Step 2 完成 | 输出 -20% | ~22s |
| Step 3 完成 | 输出再 -25% | ~18s |
| Step 4 完成 | 动态适配 | ~15-18s |

## 执行顺序

1. **Step 1 + Step 4** 先做（改动小、风险低、见效快）
2. **Step 2** 次做（需要验证下游兼容）
3. **Step 3** 最后做（需要分析 generate-prompts-v2 依赖）

## 质量验证

每步完成后：
- 用同一组测试图片（太阳能逆变器 6 图、包包 1 图、服装 1 图）跑 genesis
- 对比优化前后的蓝图质量（product_visual_identity 准确性、design_content 可执行性）
- 耗时必须下降，质量不能明显退步
