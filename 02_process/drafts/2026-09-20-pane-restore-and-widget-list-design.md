# 窗格内容恢复 + 项目产物清单（最小版设计）

> 2026-09-20 · dsh-worktable · 状态：**已实现（方案 1 + 方案 2 入口 A），实机点击验收待重启 dsh web**

## 0. 实施记录（2026-09-20）

**第二轮追加（用户反馈「AI学习 项目的窗口2没有选择产物的图标」）**：
- 诊断：① 插件原本没有任何"按窗格选产物"的入口（产物只按清单声明的窗口走）；②
  `D:\agent-workspace\AI学习` 项目文件夹里**没有 widget-result.json**（只有 java面试 / deepseek-harness 两份），
  其产物实为 `widget/index.html`（README：窗口1 产物）与 `widget/knowledge-lab.html`（README：窗口2 学习台）。
- 落地：窗格选择器新增「📦 产物」组（`pane.productTitle` / `pane.products`）；`env.widgets.products` +
  `mountProduct`（挂到**本窗格**，lockPane 语义）；产物来源 = 清单优先，无清单时
  `scanHtmlProducts`（`/api/worktable/fs`，顶层 + 一层子目录）→ 纯函数 `htmlProductCandidates`
  （导出便于回归；滤非 html、标题带子目录名、封顶 12）；`productCache` 在 notifyWidgets 时失效；
  选择器最多展示 6 条（PRODUCT_SHOW）；`PRODUCT_SHOW`/样式/文案同步。
- 回归：`pane-restore` 由 4 场景扩到 **5 场景**（第 5 例 `htmlProductCandidates`）——先红
  （`FAIL(5.export): htmlProductCandidates 未导出`）后绿。

落地文件：`01_content/src/client/split.tsx`（closedTabs / restoreClosedTab / seedPaneRestore /
mutatePane / PanePicker 恢复与产物按钮 / 标题栏 📦 + WidgetMenu）、`index.tsx`（清单缓存与订阅、
listWidgetEntries / mountWidgetEntry / listProducts / mountProductInto / seedRestoreFromManifest /
htmlProductCandidates + scanHtmlProducts、自愈扫挂回填、env.widgets）、
`locales.ts`、`styles.ts`、`04_test/pane-restore.test.mjs`（新）、`release-prep.mjs`（门禁 5c3）。

自动化验证（均评估构建产物 `lib/client.js`，2026-09-20）：
- `node 04_test/pane-restore.test.mjs` → **5/5**（红→绿两处：先暴露「未命中历史仍持久化」，
  加 `mutatePane` 守卫后转绿；再加无清单产物候选用例，先红后绿）
- `node 04_test/anchor-dom.test.mjs` → 8/8；`node 04_test/session-switch-compat.test.mjs` → 4/4；
  `npm run test:gate` → 10/10
- `node 04_test/server-home.test.mjs` → 3/3（评估 lib/index.js，本次未改动服务端源）
- `node --check lib/client.js` → 通过

尚未验证（需要重启 dsh web，客户端 bundle 启动时定版）：真实点击路径（关标签 → 选择器出现
「↩ 恢复」→ 还原；空窗格选择器出现「📦 产物：widget/knowledge-lab.html」→ 点一下挂到本窗格；
标题栏 📦 → 清单 → 点行挂载）。前提：该项目必须已设「项目文件夹」（产物候选从这里解析）。

## 1. 问题（用户实测）

- 窗格内容 = 标签列表（`SplitPane.tabs`）；点标签 ✕ → `splitStore.closeTab` **直接从 spec 删除并持久化，不留任何历史**；标签关完 → 窗格退化成「浏览器/动画站/资源管理器/终端/自定义」5 图标选择器。
- 结果：AI 产物（`widget-result.json` 自动挂载的 HTML）被误关后，用户**找不到任何可点击的恢复入口**（本次场景：java面试项目「窗口1」）。
- 自动挂载不会救场：自愈扫挂按清单原文指纹去重（`dsh.worktable.mountedWidget.v1`），同一清单已挂过就不再补挂——这是刻意的（避免与用户「手动关掉就是不想要」对抗）。

## 2. 目标 / 非目标

目标：
1. 窗格选择器里一键**原样**恢复最近关闭的标签（不重新生成内容）。
2. 项目级**产物清单**：能看到该项目 `widget-result.json` 里有哪些产物，点一下重挂到对应窗口。
3. 存量救援：**本次已经关掉**的 AI 产物也能通过上面两个入口找回。

非目标（YAGNI）：
- 不自动重挂（不做无人值守补挂）。
- 不新增全局面板 / toast / 快捷键。
- 不改其它窗格与既有挂载语义（`lockPane` 锁窗语义保持不变）。

## 3. 方案 1：窗格「最近关闭」历史 + 选择器「↩ 恢复」

数据模型：`SplitPane.closedTabs?: PaneTab[]`（最近在前，最多 5 条）

- **持久化**：随 spec 走（`projects.views[id]` / `layouts`），不新增 localStorage 键；老存档无该字段 = 无历史（兼容）。
- **记录**：`closeTab` 时把被删标签（原 `id` / `title` / `content`）`unshift` 进 `closedTabs`，超过 5 条截断。
- **恢复**：`splitStore.restoreClosedTab(row, i, tabId)` —— 从历史取出并重新插入 `tabs`（保留原 id/title/content），`active` 指向它；未命中 = 无操作。
- **UI**：`PanePicker` 在 `pane.closedTabs?.length > 0` 时，顶部渲染「↩ 恢复：<标题>」按钮 —— 最多渲染 3 颗（最近在前，即最近 1 条 + 更早的 2 条），点击某颗 → 恢复该条。无历史时 UI 零变化。

### 3.1 存量救援（回填，专治「已经关掉了」）

- **时机**：项目打开时（`openSplit` / `openConsole`）与插件加载后的自愈扫描（已有 useEffect）。
- **逻辑**：读项目文件夹的 `widget-result.json`；对清单里每个条目解析目标窗格（复用 `windowLabelToPane`）；**若该窗格当前 `tabs` 为空**，把该条目转成 content 并登记进该窗格 `closedTabs`（同 content 去重）。
- **边界**：只登记、**不挂载**（不 `lockPane`、不覆盖非空窗格）；项目未设文件夹 = 无清单，跳过。
- **效果**：打开 java面试 → 窗口1 选择器出现「↩ 恢复：知识库阅读器.html」→ 点一下内容回来。

## 4. 方案 2：项目产物清单（分栏标题栏「📦」）

**推荐入口 A**：项目打开时，分栏标题栏（`dsh-wt_splitBar`）标题右侧新增「📦 产物」按钮，**仅当该项目清单非空时出现**。

- 点击 → 弹出清单：每行 = `窗口N · 产物名 · kind 图标`；点一行 = 把该产物挂到对应窗口（沿用既有 `lockPane` 语义，可反复挂）。
- 目标窗口在当前布局中不存在 → 该行置灰并说明原因。
- 数据源：`widget-result.json`（项目文件夹），点开时按需重新读取（`cache: 'no-store'`）。
- 实现位置：`split.tsx` 标题栏按钮 + 清单 popup；数据与动作由 `index.tsx` 经 `env.widgets` 注入（与 `env.console` / `env.custom` 同构，引擎保持不含业务逻辑）。

**备选入口 B**：侧栏项目卡加「📦」按钮（未打开项目也能看清单；点行需先打开项目再挂）。

## 5. 验收

自动化（评估构建产物 `lib/client.js`，沿用 anchor-dom 的假 DOM 夹具）：

- 新增 `04_test/pane-restore.test.mjs`：
  1. `closeTab` 记录历史：≤5 条、最近在前、原 id/title/content 保留；
  2. `restoreClosedTab` 原样还原（id 不变）、未命中无操作；
  3. 历史随 spec 持久化（`onSpecMutated` + persist）；
  4. 回填只写空窗格、不覆盖非空窗格。
- 现有回归不许红：`anchor-dom`（8）、`session-switch-compat`（4）、`server-home`（3）、`test:gate`（10）。

真实路径（**需用户重启 dsh web**，客户端 bundle 在启动时定版）：

- 关掉窗口1 的标签 → 选择器出现「↩ 恢复」→ 点击还原为原内容；
- 标题栏「📦」→ 清单 → 点行挂载到对应窗口。

## 6. 风险与取舍

- spec 增字段：需同步 PRD 的持久化说明与 AGENTS.md 领域约定。
- `lockPane`（自动挂载）清空标签**不**进历史（v1 只记用户 ✕）——需要时后续增量。
- 回填依赖项目文件夹与 `widget-result.json`；非 AI 类标签（网址/终端）本次救不回，只有关闭后的历史可救。
