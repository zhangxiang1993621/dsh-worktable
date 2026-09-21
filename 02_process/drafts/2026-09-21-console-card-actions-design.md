# 控制室卡片动作：重命名 + 切换布局（最小版设计）

> 2026-09-21 · dsh-worktable · 状态：**已实现（自动化全绿；实机点击验收待重启 dsh web）**

## 0. 实施记录（2026-09-21）

落地文件：`01_content/src/client/consoleEdit.ts`（新，纯逻辑/几何 + `window.__dshWorktable` 合并导出）、
`index.tsx`（import、`renameProject`/`applyLayoutChange` 改调纯函数、`cardRename` 弹层、`onCardAction`、
`viewPickAnchor`/`setViewPick`/`viewPickPos`）、`split.tsx`（`onCardAction` 类型、卡片 ⋯ 按钮、本地菜单 +
Esc、`popoverPos` 调用、调试出口改合并写入）、`locales.ts`（zh/en 各 4 键）、`styles.ts`（⋯/菜单/改名弹层
样式含 circle 与浅色覆写）、`04_test/console-card-actions.test.mjs`（新）、
`04_test/probe-console-card-actions.cjs`（新，实机）、`release-prep.mjs`（5c4 门禁）。

自动化验证（均评估构建产物 `lib/client.js`；2026-09-21）：
- `node 04_test/console-card-actions.test.mjs`：**先红**（`FAIL(export.renameOverride)`）→ 实现后 **4/4 passed**。
  红→绿之间暴露一个真问题：`split.tsx` 的调试出口原是**整体覆盖**写入，而它现在 import `consoleEdit`
  （后者先于本模块体求值），把纯函数冲掉——已改为合并写入，并写进 AGENTS.md 领域约定。
- `node client-factory-gate.test.mjs` 10/10；`anchor-dom` 8/8；`session-switch-compat` 5/5；
  `pane-restore` 5/5；`server-home` 3/3（该套件与 `npm run build` 都需要子进程/命名管道，
  沙箱下 `spawnSync`/esbuild 报 EPERM，本机以 `danger-full-access` 一次性授权跑通，非代码回归）；
  `node --check lib/client.js` / `lib/index.js` 通过。
- 构建入口：`node build.mjs`（cwd = `01_content`；`npm run build` 在沙箱下会被 npm 子进程管道拦掉）。

尚未验证（需重启 dsh web，客户端 bundle 启动时定版）：真实点击路径 `node 04_test/probe-console-card-actions.cjs`
（侧栏 → 控制室入口卡 → 强制绑定「加入现有对话」→ 卡片 ⋯ → 菜单两项 → Esc → 改名 → 切换布局并断言
`data-on` 高亮与拓扑变化）。探针用独立 headless Chrome + 私有 user-data-dir，不改用户浏览器状态。


## 1. 问题（用户诉求）

用户原话：「worktable 工作台的控制室可以修改项目的布局，和修改名称」。

现状（已核对源码）：

- 控制室卡片（`split.tsx` `ConsolePane`，2190–2234 行）每张只有 `onClick → env.onOpen(id)`；
  `self`（控制室自己）卡片点击无操作；「＋创建卡片」恒在最后一位。
- 改名只在「设置 → 管理项目」列表：`RenameInput`（index.tsx 1257）+ `renameProject`（2649，
  写 `projects.nameOverrides`）。
- 改布局只在同一列表的 🧩 按钮：`applyLayoutChange`（2692）+ 弹层（3346–3371，
  `PRESET_DEFS` 缩略图 + 末尾「＋自定义」）。
- 结论：能力都已存在，缺的是**控制室里的入口**。

## 2. 目标 / 非目标

目标（用户三次选择确认的口径）：

1. 控制室卡片上直接**切换该项目布局预设**（等同管理列表的「变更视图」）。
2. 控制室卡片上直接**修改项目显示名**。
3. 入口 = **卡片悬停**时右上角浮现的「⋯」按钮 → 下拉菜单。
4. 菜单只放「重命名 / 切换布局」两项；`self`（控制室）卡片不显示 ⋯。

非目标（YAGNI）：

- 不做可视化布局编辑器（增删窗格 / 拖分隔比例）。
- 不把「隐藏 / 删除」搬上卡片（继续留在设置面板）。
- 不新增设置项、不新增 localStorage 键、不动「变更视图」既有语义、不发版。

## 3. 方案取舍

| 方案 | 做法 | 结论 |
|---|---|---|
| **1（选定）引擎出菜单，宿主出弹层** | ⋯ 与两项菜单在 `ConsolePane` 本地渲染；点项后把 `{id, 锚点}` 交给 `index.tsx`，复用现成布局弹层与 `renameProject` | 零重复 UI；符合「引擎不含业务逻辑、`env.console` 注入」既有约定 |
| 2 全部在控制室面板内完成 | `env.console` 增 `getLayoutOptions/renderLayoutThumb/setLayout` | 引擎层引入布局业务与 JSX 渲染回调（缩略图结构 `dsh-wt_thumb` 在 index 侧），样式需复刻，违背分层 |
| 3 ⋯ 只改名，换布局跳设置面板 | 最省代码 | 不满足「在控制室改布局」 |

## 4. 设计（方案 1）

### 4.1 卡片 ⋯ 按钮（split.tsx）

- 非 `self` 卡片右上角新增 ⋯ 按钮：默认 `opacity:0; pointer-events:none`；
  卡片 `:hover` 或 `:focus-within` 时 `opacity:1; pointer-events:auto`（键盘可达）。
- 圆形卡（`[data-wt-shape=circle]`）覆写位置 `top/right:26px`——按钮中心
  (198,38) 到圆心 (118,118) 距离 ≈113 < 半径 118，仍落在圆内。
- `onClick` 必须 `stopPropagation`：不得触发卡片自身的「打开项目」，也不得改 `activeTab`。
- 点 ⋯ 弹**面板本地**小菜单（复用 `dsh-wt_pop` 样式语境）：两项
  「重命名」/「切换布局」（最终版去掉了草稿里的 ✏️/🧩 前缀：菜单是纯文字项，与插件其余菜单语言一致，
  符合「默认克制」）；新 locale 键 `console.rename` / `console.changeLayout`（zh + en）。
- **菜单必须 `position:fixed`**（坐标由 `popoverPos` 算出）：卡片自身是 `overflow:hidden`
  （styles.ts 586 行），任何挂在卡片内部的 absolute 菜单都会被裁掉。
- 菜单关闭条件：选中任一项、点背景、Esc、控制室重渲染。关闭靠一层面板内透明 backdrop
  （捕获点击，`stopPropagation` 后 `setCardMenu(null)`），与 dock 菜单「点空白关闭」同构。

### 4.2 重命名（宿主弹层）

- 点「重命名」→ `env.console.onCardAction(id, 'rename', { x, y })`。
- `index.tsx` 弹 `dsh-wt_pop` 小弹层（宽 240，输入框复用 `.dsh-wt_manageInput` 样式）：
  自动聚焦并全选；Enter / 「确定」提交；Esc / 点背景 / 「取消」放弃。
- 提交走**现有** `renameProject`：非空 = 写 `nameOverrides[id]`，空白 = 删除覆盖回退原名。
- 语义与设置面板一致：`nameOverrides` 是全局显示名 → 控制室卡片、侧栏、管理列表同步变。
  「改完必读回」：卡片名来源于 `getConsoleCards`，落盘后需经 `consoleListeners` 通知重渲染
  （实施时核对 `persistProjects` → `notifyConsole` 链路，缺则补）。

### 4.3 切换布局（复用「变更视图」弹层）

- 点「切换布局」→ `env.console.onCardAction(id, 'layout', { x, y })`。
- 复用 3346 行的预设弹层（`PRESET_DEFS` 缩略图 + 末尾「＋自定义」→ 自定义布局提示词流程）：
  把定位由「侧栏锚点」参数化为「卡片锚点」——`viewPick` 增可选坐标，缺省仍走
  `popLeft/popTop`，**管理列表行为零变化**。
- 选中后走现有 `applyLayoutChange`：已有标签按序迁入新拓扑、溢出并入末窗格；
  该项目正打开则关旧开新；`presetOf` 高亮当前预设。

### 4.4 定位复用

抽纯函数 `popoverPos(rect, size, viewport)`（沿用 `openIconPick` 的 clamp 公式，`MIN_TOP=56`），
图标选择器、重命名弹层、布局弹层共用：

- `x = min(rect.right + 8, max(16, vw - size.w))`
- `y = max(MIN_TOP, min(rect.top - 4, vh - size.h))`

### 4.5 边界

- `self` 卡片无 ⋯；创建卡片无 ⋯；未安装的入驻项目本就不在 `getConsoleCards` 输出里。
- 入驻项目（`aliveRegisteredIds`）与用户自建布局（`layouts`）都走 `applyLayoutChange` 的双写分支
  （`views[id]` / `layouts` 条目），语义不变。
- 不改任何 localStorage 键结构：`dsh.worktable.projects.v1` 的
  `nameOverrides` / `views` / `layouts` 全部复用，PRD 持久化说明无需新增键。

## 5. 验收

**TDD（先红后绿）**：抽取纯函数并新增 `04_test/console-card-actions.test.mjs`，断言对象 = 构建产物
`lib/client.js`（沿用 `anchor-dom.test.mjs` 的假 DOM sandbox + `window.__dshWorktable` 导出钩子）：

1. `collectTabs(spec)` + `migrateTabsInto(next, sources)`：已有标签按序迁入各窗格 / 溢出并入最后一个窗格 /
   无标签时不产生副作用 / 目标窗格为空时安全 / 空窗格不占位。
2. `renameOverride(map, id, name)`：非空写覆盖；纯空白删除覆盖（回退原名）；不改原对象。
3. `popoverPos(rect, size, viewport)`：右侧越界、顶部越界、底部越界三种 clamp + 常规值。

**构建门禁**：`cd 01_content` → `npm run build` → `node --check lib/client.js` →
`node --check lib/index.js`。

**现有回归不许红**：`npm run test:gate`（10）、`anchor-dom.test.mjs`（8）、
`session-switch-compat.test.mjs`（5）、`pane-restore.test.mjs`（5）、`server-home.test.mjs`（3）。

**真实产物验收**（沿用 `04_test/probe-batch*.cjs` 的 CDP 套路新增
`04_test/probe-console-card-actions.cjs`）：在 `http://127.0.0.1:3080/` 实机
hover 卡片 → 点 ⋯ → 改名（断言卡片文本 + `localStorage` 的 `nameOverrides`）→
切换布局（断言预设高亮与项目 spec）。**前提：重启 dsh web**（客户端 bundle 启动时定版），
重启动作单独向用户确认，不擅自执行。

## 6. 风险与取舍

- 悬停才显示的按钮在触屏/纯键盘下可能不可发现：以 `:focus-within` + 焦点可见兜底，
  触屏场景不在本次范围（桌面 DSH Web 为唯一验证平台）。
- 改名是全局显示名，不是项目文件夹改名；文件夹与产物路径不受影响（既有语义）。
- 布局切换会重建拓扑，标签按序迁入但窗格归属可能变化——与设置面板「变更视图」完全同源，
  本次不改变该行为。
- 文档同步：完成后更新 `AGENTS.md` 控制室段（卡片动作一行）与本设计稿状态。

## 7. 落地文件（实际）

- `01_content/src/client/consoleEdit.ts`（新）：`renameOverride` / `popoverPos` / `collectTabs` /
  `migrateTabsInto` + `window.__dshWorktable` 合并导出。
- `01_content/src/client/split.tsx`：卡片 ⋯ 按钮 + 本地 fixed 菜单（Esc 关闭）+ 类型 `onCardAction`
  + `popoverPos` 调用 + 调试出口改**合并**写入。
- `01_content/src/client/index.tsx`：纯函数抽取接线、`onCardAction` 注入、改名弹层（autoFocus + 全选）、
  `viewPickAnchor` / `setViewPick` / `viewPickPos`。
- `01_content/src/client/styles.ts`：⋯/菜单/改名弹层样式（circle 与浅色主题覆写）。
- `01_content/src/client/locales.ts`：`console.actions` / `console.rename` / `console.renameOk` /
  `console.changeLayout`（zh + en）。
- `04_test/console-card-actions.test.mjs`（新）、`04_test/probe-console-card-actions.cjs`（新，实机，
  零依赖：Node 22 内置 `WebSocket` + CDP）。
- `01_content/release-prep.mjs`（5c4 门禁）、`AGENTS.md`（控制室卡片动作约定 + 配套检查入口）。
