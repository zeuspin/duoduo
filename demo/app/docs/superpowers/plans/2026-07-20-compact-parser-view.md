# 解析器查看页紧凑布局 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 消除解析器查看页的大面积无效留白，让计费信息紧凑可扫读，并让完整提示词占满可用宽度。

**Architecture:** 为查看状态增加独立的语义容器，不再依赖新建表单的 `.parser-editor` 样式。模型价格组件继续复用同一数据源，但通过 CSS Grid 将价格阶梯在宽屏横排、窄屏换行。

**Tech Stack:** React 19、TypeScript、CSS Grid、Vitest、Testing Library。

## Global Constraints

- 不改动模型目录、计费数值、解析器存储结构和正式直播分析流程。
- 查看页不能出现编辑入口。
- 不新建分支、不提交或推送代码。

---

### Task 1: 固化查看页结构

**Files:**
- Modify: `src/renderer/components/ParserManagement.tsx`
- Test: `tests/unit/parser-management.test.tsx`

**Interfaces:**
- Consumes: `ModelPriceCard`、`materializeParserPrompt`
- Produces: `.parser-view`、`.parser-view-prompt` 与可验证的只读提示词结构

- [ ] **Step 1: 增加失败测试**

断言查看区域存在 `parser-view`，只读提示词占用专属 `parser-view-prompt` 容器，复制和复制新建操作仍存在。

- [ ] **Step 2: 验证测试失败**

Run: `npm test -- --run tests/unit/parser-management.test.tsx`

- [ ] **Step 3: 修改查看页 JSX**

给查看 section 增加 `parser-view`，将提示词 label 改为专属 `parser-view-prompt`，保留只读属性和原操作行为。

- [ ] **Step 4: 验证组件测试通过**

Run: `npm test -- --run tests/unit/parser-management.test.tsx`

### Task 2: 实现紧凑响应式布局

**Files:**
- Modify: `src/renderer/forms.css`

**Interfaces:**
- Consumes: Task 1 的语义类名
- Produces: 横向价格阶梯、全宽提示词与窄屏换行规则

- [ ] **Step 1: 添加查看页独立样式**

`.parser-view` 使用紧凑间距；`.model-price-tiers` 使用 `repeat(auto-fit, minmax(...))`；`.parser-view-prompt` 明确 `display:grid;width:100%`；只读 textarea 明确宽度、最小高度、padding 和 `box-sizing:border-box`。

- [ ] **Step 2: 限制新建表单样式作用域**

保留 `.parser-prompt-field` 服务新建表单，查看页不依赖会被 `parser.css` 后加载覆盖的通用规则。

- [ ] **Step 3: 运行完整验证**

Run: `npm run typecheck && npm test && npm run build && git diff --check`

Expected: 类型检查、测试、Electron 打包和差异检查全部以退出码 0 完成。
