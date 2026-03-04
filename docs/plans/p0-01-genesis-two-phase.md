# Feature Plan: P0-01 Studio Genesis 两阶段流程 (Analyze→Select→Generate)

## 问题/需求
当前 preview 阶段所有 ImagePlanCard 都会进入生成，用户无法勾选/取消/删除卡片。需要增加 checkbox 选择 + 删除功能，Generate 时只提交勾选项，未勾选则拦截。

## 现状分析
- 已有 5 阶段 phase 系统 (input→analyzing→preview→generating→complete) ✅
- 已有 DesignBlueprint + ImagePlanCard 编辑 UI ✅
- **缺少**: 卡片勾选(checkbox)、删除、选择计数、生成前校验

## 影响范围
- 修改文件:
  1. `components/studio/ImagePlanCard.tsx` — 添加 checkbox + delete 按钮
  2. `components/studio/DesignBlueprint.tsx` — 传递 selection/delete 回调，显示选中计数
  3. `components/studio/StudioGenesisForm.tsx` — 管理选择状态，Generate 只提交选中项，校验
- 无新增/删除文件
- 无后端变更

## 实现方案

### Step 1: ImagePlanCard — 添加 checkbox + delete
- Props 新增: `selected: boolean`, `onToggleSelect: () => void`, `onDelete: () => void`
- 卡片左侧 checkbox 替代序号圆圈（选中时显示）
- 卡片右侧添加 Trash2 删除按钮（ChevronDown 旁边）
- 未选中时 `opacity-60` + border 变灰

### Step 2: DesignBlueprint — 传递 selection 状态
- Props 新增: `selectedIndices: Set<number>`, `onToggleSelect: (index: number) => void`, `onDeletePlan: (index: number) => void`
- 传给 ImagePlanCard
- 标题计数: "已选 X / 共 Y 张"
- 全选/取消全选按钮

### Step 3: StudioGenesisForm — 状态管理 + 校验
- 新增 `selectedPlanIndices: Set<number>` state，默认全选
- `handleAnalyze` 完成后初始化全选
- `handleGenerate` 只取选中 plans
- `selectedPlanIndices.size === 0` → 禁用 Generate + 提示
- 按钮文案基于 selectedCount
- 积分计算基于 selectedCount
- 删除卡片: 移除 plan + 重映射 selectedPlanIndices

### Step 4: i18n 翻译 keys
- 添加: selectAll, deselectAll, noCardsSelected, selectedCount

## 注意事项
- 删除后 index 变化需重映射 selectedPlanIndices
- 会话恢复不在此 scope（P2-01）
- 不改后端

## 验证方式
- [ ] tsc 通过
- [ ] 分析后卡片默认全选
- [ ] 取消勾选 → 只生成选中项
- [ ] 全取消 → Generate 禁用 + 提示
- [ ] 删除卡片后计数正确
- [ ] 积分基于选中数量
