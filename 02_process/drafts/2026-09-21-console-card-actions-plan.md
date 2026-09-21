# 控制室卡片动作（重命名 + 切换布局）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use skill `subagent-driven-development` (recommended) or skill `executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让控制室的每张项目卡片能直接重命名、切换布局预设——卡片悬停浮现「⋯」→ 本地菜单两项，宿主复用既有 `renameProject` 与「变更视图」弹层。

**Architecture:** 引擎（`split.tsx`，控制室面板）只渲染 ⋯ 按钮、本地菜单与透明 backdrop，把动作意图（`onCardAction(id, 'rename'|'layout', anchor)`）交给宿主 `index.tsx`；宿主用既有 `dsh-wt_pop` 弹层机制出 UI：改名弹层（复用 `renameProject`）、布局弹层（复用 `PRESET_DEFS` 缩略图 + ＋自定义，定位从侧栏锚点参数化为卡片锚点）。三个纯函数（`renameOverride` / `popoverPos` / `collectTabs` + `migrateTabsInto`）抽到新文件 `consoleEdit.ts`，经 `window.__dshWorktable` 导出以便对**构建产物**做回归。

**Tech Stack:** TypeScript + React（DSH 客户端插件走 `window.__ModuleLoader__.load` 握手）、esbuild（`build.mjs`）、`node:vm` 假 DOM 回归（`04_test/*.test.mjs`）。

**设计稿：** `02_process/drafts/2026-09-21-console-card-actions-design.md`（已批准，commit a69af4f）。

## 计划勘误（2026-09-21 执行期 + 评审结论，已实施）

1. **行号漂移**：Task 2/3 里引用的行号是动手前的快照。**一律以引号内的原文串（唯一）定位**，
   不要按行号改；执行期核实的对应关系：`popLeft` 2974 / `popTop` 2977 / 管理列表 🧩 3293 /
   viewPick backdrop+popover 3336-3337 / ＋自定义磁贴 3356 / viewPick 块结束 3347 /
   bindPick backdrop 3349 / 卡片 JSX 2205-2233。
2. **类型名**：`split.tsx` 里没有 `ConsoleEnv`，实际是 `SplitEnv`（`console?:` 段从 264 行起）。
3. **调试出口必须合并写入（执行期真红暴露）**：`split.tsx` 一旦 import `./consoleEdit`，
   esbuild 会把 consoleEdit 的模块体排在 split 之前执行，于是 split 末尾原来的
   `window.__dshWorktable = { splitStore, seedPaneRestore }` 会**整体覆盖**掉纯函数导出
   （现象：Task 2 后重新构建，`FAIL(export.renameOverride)`）。两处写入都必须展开既有对象。
   Task 1 Interfaces 里「装载顺序无关」的前提是**两边都合并写入**，不是天然成立。
4. **新增测试文件名**：以 `04_test/console-card-actions.test.mjs` 为准（设计稿已同步改为该名）。
5. **Task 4 探针**：预置空的 `projects.v1` 时 `wt-console` 未绑定 → 点入口卡只弹强制绑定弹层，
   面板不开就没有 `.dsh-wt_consoleCard`。已实施版先走绑定（`.dsh-wt_consoleBindPop` 里
   「加入现有对话」首项，不新建会话），并预置一个 `layouts` 项目保证有非 self 卡片可控；
   探针零依赖（Node 22 内置 `WebSocket`，本仓库无 `ws`），另断言 `data-on` 预设高亮与 Esc 关闭。

## Global Constraints

- 插件包根 = `01_content/`；**构建必须 `cd 01_content` 后执行**（误在仓库根跑会把 lib 写到仓库根，宿主仍加载旧 bundle）。
- **禁止用 PowerShell 文本管道改 `lib/*.js`**（UTF-8 中文会变乱码，bundle 直接 check 失败）；要改产物只能 `npm run build` 重建。
- 每次构建后必跑 `node --check lib/index.js` 与 `node --check lib/client.js`。
- 客户端 bundle 必须保持 `window.__ModuleLoader__.load` 握手与 external 白名单（只允许 `react` / `react/jsx-runtime`）；不得引入新的 npm 依赖。
- 状态只存 localStorage（`dsh.worktable.projects.v1` / `dsh.worktable.view.v1`）；**本次不新增键、不改现有键结构**，PRD 持久化说明无需改动。
- 文案中英同步：`locales.ts` 的 `zh` 与 `en` 两个字典都要加同一批键。
- 不替换/不禁用任何官方插件；**不改版本号、不发版**（改动 ≠ 发布）。
- 每次编辑后读回改动段落（无残留、无断尾）；提交信息用中文。
- 平台边界：Windows 是唯一完整验证平台；不手写路径分隔符（本次不碰路径）。

---

### Task 1: 抽纯逻辑模块 `consoleEdit.ts` + 对构建产物的回归（行为不变的改造）

**Files:**
- Create: `01_content/src/client/consoleEdit.ts`
- Create: `04_test/console-card-actions.test.mjs`
- Modify: `01_content/src/client/index.tsx`（import；`renameProject` 2649-2656；`applyLayoutChange` 2692-2730）
- Modify: `01_content/release-prep.mjs`（5c3 后追加 5c4 门禁）

**Interfaces:**
- Produces（`consoleEdit.ts` 具名导出，后续任务直接 import）：
  - `renameOverride(map: Record<string, string>, id: string, name: string): Record<string, string>`
  - `popoverPos(rect: { right: number; top: number }, size: { w: number; h: number }, viewport: { w: number; h: number }): { x: number; y: number }`
  - `collectTabs(spec: LayoutSpec | null | undefined): PaneTab[][]`
  - `migrateTabsInto(next: LayoutSpec, sources: PaneTab[][]): LayoutSpec`
  - 模块装载时把四个函数合并进 `window.__dshWorktable`（与 `split.tsx` 的 `{ splitStore, seedPaneRestore }` 并存，装载顺序无关）。
- Consumes: `split.tsx` 的类型 `LayoutSpec` / `PaneTab` / `SplitPane`（`import type`，编译期擦除，不产生运行时环）。

- [ ] **Step 1: 写失败测试 `04_test/console-card-actions.test.mjs`**

脚手架（假 DOM sandbox）**照抄**已验证能跑通 bundle 的 `04_test/anchor-dom.test.mjs` 第 13–171 行（`import` / `StyleProxy` / `universalStub` / `FakeEl` / `matches` / `buildSandbox`），删掉 `FakeEl` 场景构造；断言体换成下面这段（`buildSandbox()` 返回 `{ sandbox, splitStore }`，其中 `sandbox.window.__dshWorktable` 即调试出口）：

```js
const { sandbox } = buildSandbox()
const hooks = sandbox.window.__dshWorktable || {}
const { renameOverride, popoverPos, collectTabs, migrateTabsInto } = hooks
for (const [name, fn] of Object.entries({ renameOverride, popoverPos, collectTabs, migrateTabsInto })) {
  if (typeof fn !== 'function') fail('export.' + name, 'window.__dshWorktable.' + name + ' 未导出')
}

// 1. renameOverride：非空写入 / 纯空白删除 / 不改原对象
{
  const src = { a: '旧名' }
  const w1 = renameOverride(src, 'a', '新名')
  if (w1.a !== '新名') fail('rename.write', JSON.stringify(w1))
  if (src.a !== '旧名') fail('rename.pure', '原对象被改动')
  const w2 = renameOverride(w1, 'a', '   ')
  if ('a' in w2) fail('rename.revert', '空白提交应删除覆盖：' + JSON.stringify(w2))
  const w3 = renameOverride(w1, 'b', '乙')
  if (w3.b !== '乙' || w3.a !== '新名') fail('rename.add', JSON.stringify(w3))
  ok('renameOverride')
}

// 2. popoverPos：右侧越界 / 顶部越界 / 底部越界三种 clamp
{
  const vp = { w: 1000, h: 800 }
  const right = popoverPos({ right: 900, top: 300 }, { w: 320, h: 540 }, vp)
  if (right.x !== Math.max(16, 1000 - 320)) fail('pos.right', 'x=' + right.x)
  const top = popoverPos({ right: 100, top: 10 }, { w: 240, h: 132 }, vp)
  if (top.y !== 56) fail('pos.top', 'y=' + top.y)
  const bottom = popoverPos({ right: 100, top: 790 }, { w: 320, h: 540 }, vp)
  if (bottom.y !== Math.max(56, 800 - 540)) fail('pos.bottom', 'y=' + bottom.y)
  const normal = popoverPos({ right: 100, top: 300 }, { w: 240, h: 132 }, vp)
  if (normal.x !== 108 || normal.y !== 296) fail('pos.normal', JSON.stringify(normal))
  ok('popoverPos')
}

// 3. collectTabs：左栏 → 顶行 → 主行顺序；只收非空窗格；空 spec = []
{
  const tabs = (n) => [{ id: 't' + n, title: 'T' + n, content: { kind: 'builtin', type: 'tasks' } }]
  const spec = {
    id: 'x', title: 'x', chatWidth: { default: 360, min: 240, max: 600 },
    left: { id: 'L', title: 'L', min: 200, tabs: tabs(1) },
    top: [{ id: 'T1', title: 'T1', min: 200, tabs: tabs(2) }, { id: 'T2', title: 'T2', min: 200, tabs: [] }],
    main: [{ id: 'M1', title: 'M1', min: 200, tabs: tabs(3) }],
  }
  const groups = collectTabs(spec)
  if (groups.length !== 3) fail('collect.len', 'len=' + groups.length + '（空窗格不应计入）')
  if (groups[0][0].id !== 't1' || groups[1][0].id !== 't2' || groups[2][0].id !== 't3') {
    fail('collect.order', JSON.stringify(groups.map((g) => g[0].id)))
  }
  if (collectTabs(undefined).length !== 0 || collectTabs(null).length !== 0) fail('collect.none', '空 spec 应为 []')
  ok('collectTabs')
}

// 4. migrateTabsInto：按序填窗格（active=0、清空 content）/ 溢出并入最后窗格 / 无标签无副作用
{
  const tabs = (n) => [{ id: 't' + n, title: 'T' + n, content: { kind: 'builtin', type: 'tasks' } }]
  const mk = () => ({ id: 'x', title: 'x', chatWidth: { default: 360, min: 240, max: 600 }, top: null, main: [
    { id: 'p1', title: '窗口1', min: 200, content: { kind: 'builtin', type: 'tasks' }, active: 3 },
    { id: 'p2', title: '窗口2', min: 200, content: null },
  ] })
  const next1 = migrateTabsInto(mk(), [tabs(1), tabs(2)])
  if (next1.main[0].tabs[0].id !== 't1' || next1.main[1].tabs[0].id !== 't2') fail('migrate.order', JSON.stringify(next1.main))
  if (next1.main[0].active !== 0 || next1.main[0].content !== null) fail('migrate.reset', 'active/content 未归一')
  const next2 = migrateTabsInto(mk(), [tabs(1), tabs(2), tabs(3)])
  if (next2.main[1].tabs.length !== 2 || next2.main[1].tabs[1].id !== 't3') fail('migrate.overflow', JSON.stringify(next2.main[1].tabs))
  const next3 = migrateTabsInto(mk(), [])
  if (next3.main[0].tabs !== undefined || next3.main[0].active !== 3) fail('migrate.noop', '无标签时不应改动目标窗格')
  ok('migrateTabsInto')
}

console.log('\nconsole-card-actions: ' + pass + '/4 passed')
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd D:\agent-workspace\dsh-plugin\dsh-worktable; node 04_test/console-card-actions.test.mjs`
Expected: `FAIL(export.renameOverride): window.__dshWorktable.renameOverride 未导出`（此时 `consoleEdit.ts` 还不存在）。

- [ ] **Step 3: 新建 `01_content/src/client/consoleEdit.ts`**

```ts
/**
 * 控制室卡片动作（重命名 / 切换布局）的纯逻辑与几何。
 * 引擎（split.tsx）与宿主（index.tsx）共用；不依赖 React，模块装载时不碰 DOM。
 * 纯函数经 window.__dshWorktable 导出，供 04_test/console-card-actions.test.mjs 断言构建产物。
 */
import type { LayoutSpec, PaneTab, SplitPane } from './split'

/** 显示名覆盖：非空写入；纯空白删除（回退原名，与文件改名语义一致） */
export function renameOverride(map: Record<string, string>, id: string, name: string): Record<string, string> {
  const next = { ...map }
  if (name.trim()) next[id] = name
  else delete next[id]
  return next
}

/** 弹层锚点定位：优先落在锚点右侧，视口内钳制（最小顶距 56 = 既有 MIN_TOP 约定） */
export function popoverPos(
  rect: { right: number; top: number },
  size: { w: number; h: number },
  viewport: { w: number; h: number },
): { x: number; y: number } {
  const x = Math.min(rect.right + 8, Math.max(16, viewport.w - size.w))
  const y = Math.max(56, Math.min(rect.top - 4, viewport.h - size.h))
  return { x: Math.round(x), y: Math.round(y) }
}

/** 旧布局的有效标签组：按「左栏 → 顶行 → 主行」收集非空窗格的标签（空窗格不占位） */
export function collectTabs(spec: LayoutSpec | null | undefined): PaneTab[][] {
  if (!spec) return []
  const panes: SplitPane[] = [...(spec.left ? [spec.left] : []), ...(spec.top ?? []), ...spec.main]
  return panes.map((p) => p.tabs ?? []).filter((tabs) => tabs.length > 0)
}

/** 标签迁入新拓扑：按序填窗格（active=0、清空旧单内容声明）；多出的标签并入最后一个窗格 */
export function migrateTabsInto(next: LayoutSpec, sources: PaneTab[][]): LayoutSpec {
  const targets: SplitPane[] = [...(next.left ? [next.left] : []), ...(next.top ?? []), ...next.main]
  let si = 0
  for (const pane of targets) {
    if (si < sources.length) {
      pane.tabs = sources[si]
      pane.active = 0
      pane.content = null
      si++
    }
  }
  const overflow = sources.slice(si).flat()
  if (overflow.length > 0 && targets.length > 0) {
    const last = targets[targets.length - 1]
    last.tabs = [...(last.tabs ?? []), ...overflow]
    last.active = 0
  }
  return next
}

/** 调试出口（自动化验证用）：与 split.tsx 的同名对象合并，装载顺序无关 */
try {
  const w = window as any
  w.__dshWorktable = { ...(w.__dshWorktable ?? {}), renameOverride, popoverPos, collectTabs, migrateTabsInto }
} catch {}
```

- [ ] **Step 4: `index.tsx` 接入（行为不变的抽取）**

4a. 第 5 行的 `./split` import 之后新增一行：

```ts
import { renameOverride, popoverPos, collectTabs, migrateTabsInto } from './consoleEdit'
```

4b. `renameProject`（原 2649-2656）整体替换为：

```ts
  const renameProject = (id: string, name: string) => {
    persistProjects((prev) => ({ ...prev, nameOverrides: renameOverride(prev.nameOverrides, id, name) }))
  }
```

4c. `applyLayoutChange`（原 2692-2730）整体替换为（**行为等价**：`sources` 由 `collectTabs` 收集，迁移交由 `migrateTabsInto`；注意 `collectTabs` 额外纳入 `current.left`，而当前所有预设 `leftCount` 均为 0，故对现有存档无行为变化，只是补上未来左栏预设会丢标签的缺口）：

```ts
  const applyLayoutChange = (id: string, presetId: string) => {
    const layout = projects.layouts.find((l) => l.id === id)
    const meta = metas[id]
    const current = layout ?? projects.views[id]
    const next = buildLayout(presetId, layout ? layout.title : (meta?.name ?? id))
    next.id = id
    next.icon = layout ? layout.icon : (projects.iconOverrides[id] ?? meta?.icon)
    migrateTabsInto(next, collectTabs(current))
    persistProjects((prev) => layout
      ? { ...prev, layouts: prev.layouts.map((l) => (l.id === id ? next : l)) }
      : { ...prev, views: { ...prev.views, [id]: next } })
    // 该视图当前打开时：关旧开新，工作区即时变为新视图
    const wasOpen = splitStore.active && splitStore.spec?.id === id
    if (wasOpen) {
      splitStore.close()
      openSplit(next)
    }
    setViewPickFor(null)
  }
```

- [ ] **Step 5: 构建 + 跑测试确认通过**

Run:
```powershell
cd D:\agent-workspace\dsh-plugin\dsh-worktable\01_content
npm run build
node --check lib/client.js
node --check lib/index.js
cd ..
node 04_test/console-card-actions.test.mjs
```
Expected: `[dsh-worktable build] done: lib/index.js, lib/client.js`；两条 `node --check` 静默通过；`console-card-actions: 4/4 passed`。

- [ ] **Step 6: 现有回归不许红**

Run:
```powershell
cd D:\agent-workspace\dsh-plugin\dsh-worktable\01_content
npm run test:gate
cd ..
node 04_test/anchor-dom.test.mjs
node 04_test/session-switch-compat.test.mjs
node 04_test/pane-restore.test.mjs
node 04_test/server-home.test.mjs
```
Expected: gate 10/10；anchor 8/8；session-switch 5/5；pane-restore 5/5；server-home 3/3。

- [ ] **Step 7: 把新回归挂进发布门禁 `01_content/release-prep.mjs`**

在 5c3 段结束（`console.log('[release-prep] pane restore tests passed ...')`，约 218 行）之后、5d 段之前插入：

```js
// ---------- 5c4. 控制室卡片动作回归（重命名覆盖语义 / 标签迁入新拓扑 / 弹层锚点钳制） ----------
const cardActionTest = join(HERE, '..', '04_test', 'console-card-actions.test.mjs')
if (!existsSync(cardActionTest)) {
  console.error('[release-prep] FAIL: console-card-actions.test.mjs missing')
  process.exit(1)
}
const cardActionRun = spawnSync(process.execPath, [cardActionTest, join(inst, 'node_modules', 'dsh-worktable', 'lib', 'client.js')], { cwd: HERE, stdio: 'pipe', encoding: 'utf8' })
if (cardActionRun.status !== 0) {
  console.error('[release-prep] FAIL: console-card-actions.test.mjs')
  console.error(cardActionRun.stderr || cardActionRun.stdout)
  process.exit(1)
}
console.log('[release-prep] console card action tests passed (4 scenarios, on installed artifact)')
```

- [ ] **Step 8: 提交**

```powershell
cd D:\agent-workspace\dsh-plugin\dsh-worktable
git add 01_content/src/client/consoleEdit.ts 01_content/src/client/index.tsx 01_content/release-prep.mjs 04_test/console-card-actions.test.mjs 01_content/lib/client.js
git commit -m "refactor(console): 控制室卡片动作纯逻辑抽到 consoleEdit.ts（重命名/标签迁入/锚点钳制）+ 产物回归"
```

---

### Task 2: 卡片「⋯」入口 + 重命名弹层

**Files:**
- Modify: `01_content/src/client/split.tsx`（顶部 import；`SplitEnv.console` 类型 262-295 区；`ConsolePane` state 1777 区；mask 行 2164；卡片 JSX 2191-2233）
- Modify: `01_content/src/client/index.tsx`（state 1399 区；`env.console` 1648-1653 区；弹层 JSX 3371 区）
- Modify: `01_content/src/client/locales.ts`（zh 180 区；en 422 区）
- Modify: `01_content/src/client/styles.ts`（594 行后）

**Interfaces:**
- Consumes: Task 1 的 `popoverPos`（split.tsx）、`renameOverride`（已接入 `renameProject`）。
- Produces: `SplitEnv.console.onCardAction(id: string, action: 'rename' | 'layout', anchor: { right: number; top: number }): void`；`index.tsx` 的 `cardRename` 弹层。

- [ ] **Step 1: `split.tsx` 加 import 与 env 类型**

1a. 文件顶部 import 区（`import ... from './updateCheck'` 之后）新增：

```ts
import { popoverPos } from './consoleEdit'
```

1b. `type SplitEnv` 的 `console` 段里，`onAdd: () => void`（约 273 行）之后新增：

```ts
    /** 控制室卡片动作：重命名 / 切换布局（anchor = 触发按钮的视口坐标 right/top） */
    onCardAction: (id: string, action: 'rename' | 'layout', anchor: { right: number; top: number }) => void
```

- [ ] **Step 2: `ConsolePane` 加菜单 state**

在 `const [openMenu, setOpenMenu] = useState<string | null>(null)`（1777 行）之后新增：

```ts
  /** 卡片 ⋯ 菜单：项目 id + 菜单坐标 + 触发按钮锚点（供后续弹层定位） */
  const [cardMenu, setCardMenu] = useState<{ id: string; x: number; y: number; right: number; top: number } | null>(null)
```

- [ ] **Step 3: 渲染菜单与 backdrop**

在 `{openMenu !== null && <div className="dsh-wt_dropMask" onClick={() => setOpenMenu(null)} />}`（2164 行）之后新增：

```tsx
      {cardMenu && <div className="dsh-wt_dropMask" onClick={() => setCardMenu(null)} />}
      {cardMenu && (
        <div className="dsh-wt_menu dsh-wt_consoleCardMenu" style={{ position: 'fixed', left: cardMenu.x, top: cardMenu.y, width: 168, zIndex: 82 }}>
          <button type="button" className="dsh-wt_cardMenuItem" onClick={() => {
            const it = cardMenu
            setCardMenu(null)
            env?.onCardAction(it.id, 'rename', { right: it.right, top: it.top })
          }}>{T('console.rename')}</button>
          <button type="button" className="dsh-wt_cardMenuItem" onClick={() => {
            const it = cardMenu
            setCardMenu(null)
            env?.onCardAction(it.id, 'layout', { right: it.right, top: it.top })
          }}>{T('console.changeLayout')}</button>
        </div>
      )}
```

- [ ] **Step 4: 卡片加 ⋯ 按钮**

在卡片 JSX 的预览块 `</div>`（2220 行，`dsh-wt_consolePreview` 那个 div 结束）之后、卡片根 `</div>` 之前新增：

```tsx
            {!c.self && (
              <button
                type="button"
                className="dsh-wt_consoleCardMore"
                title={T('console.actions')}
                aria-label={T('console.actions')}
                onClick={(e) => {
                  e.stopPropagation() // 绝不触发卡片「打开项目」
                  const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
                  const pos = popoverPos(r, { w: 168, h: 84 }, { w: window.innerWidth, h: window.innerHeight })
                  setCardMenu((prev) => (prev && prev.id === c.id ? null : { id: c.id, x: pos.x, y: pos.y, right: r.right, top: r.top }))
                }}
              >⋯</button>
            )}
```

- [ ] **Step 5: `index.tsx` 加 state**

在 `const [viewPickFor, setViewPickFor] = useState<string | null>(null)`（1399 行）之后新增：

```ts
  /** 控制室卡片改名弹层：项目 id + 锚点坐标 + 草稿（onCardAction('rename') 打开） */
  const [cardRename, setCardRename] = useState<{ id: string; x: number; y: number; draft: string } | null>(null)
```

- [ ] **Step 6: `index.tsx` 注入 `onCardAction`**

在 `env.console` 的 `onAdd: () => openAddPanel(),`（1653 行）之后新增：

```ts
        onCardAction: (id, action, anchor) => {
          if (id === CONSOLE_ID) return // 控制室自身无卡片动作（界面不提供，这里兜底）
          const pr = projectsRef.current
          const layout = pr.projects.layouts.find((l) => l.id === id)
          const display = pr.projects.nameOverrides[id] ?? pr.metas[id]?.name ?? layout?.title ?? id
          const vp = { w: window.innerWidth, h: window.innerHeight }
          if (action === 'rename') {
            const pos = popoverPos(anchor, { w: 240, h: 132 }, vp)
            setCardRename({ id, x: pos.x, y: pos.y, draft: display })
            return
          }
          setViewPickFor(id) // Task 3 接管锚点定位
        },
```

- [ ] **Step 7: `index.tsx` 渲染改名弹层**

在 `viewPick` 弹层块结束（3371 行 `)}`）之后、`bindPick` backdrop（3373 行）之前新增：

```tsx
      {cardRename && <div className="dsh-wt_popBackdrop" style={{ zIndex: 87 }} onClick={() => setCardRename(null)} />}
      {cardRename && (
        <div className="dsh-wt_menu dsh-wt_pop" style={{ position: 'fixed', left: cardRename.x, top: cardRename.y, width: 240, zIndex: 88 }}>
          <span className="dsh-wt_menuLabel">{t('console.rename')}</span>
          <div className="dsh-wt_renameField">
            <input
              className="dsh-wt_manageInput"
              autoFocus
              value={cardRename.draft}
              placeholder={t('manage.renamePh')}
              onChange={(e) => setCardRename({ ...cardRename, draft: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { renameProject(cardRename.id, cardRename.draft); setCardRename(null) }
                else if (e.key === 'Escape') setCardRename(null)
              }}
            />
          </div>
          <div className="dsh-wt_renameRow">
            <button type="button" className="dsh-wt_renameBtn" onClick={() => setCardRename(null)}>{t('confirm.cancel')}</button>
            <button type="button" className="dsh-wt_renameBtn dsh-wt_renameBtnGo" onClick={() => { renameProject(cardRename.id, cardRename.draft); setCardRename(null) }}>{t('console.renameOk')}</button>
          </div>
        </div>
      )}
```

- [ ] **Step 8: 补 locale 键（zh 与 en 各一组）**

`locales.ts` 的 zh 字典里 `'console.addProject': '添加项目',`（180 行）之后新增：

```ts
  'console.actions': '项目操作',
  'console.rename': '重命名',
  'console.renameOk': '确定',
  'console.changeLayout': '切换布局',
```

en 字典里 `'console.addProject': 'Add project',`（422 行）之后新增：

```ts
  'console.actions': 'Project actions',
  'console.rename': 'Rename',
  'console.renameOk': 'OK',
  'console.changeLayout': 'Change layout',
```

- [ ] **Step 9: 加样式（`styles.ts`，`.dsh-wt_consoleCardSelf` 规则后，594 行后）**

```ts
  // 控制室卡片动作：⋯ 按钮（悬停/聚焦浮现）+ 本地菜单 + 改名弹层
  '.dsh-wt_consoleCardMore{position:absolute;top:10px;right:10px;z-index:2;width:24px;height:24px;display:flex;align-items:center;justify-content:center;padding:0;border:none;border-radius:6px;background:rgba(255,255,255,.14);color:var(--wt-text);font:inherit;font-size:16px;line-height:1;cursor:pointer;opacity:0;pointer-events:none;transition:opacity .12s ease}',
  '.dsh-wt_consoleCard:hover .dsh-wt_consoleCardMore,.dsh-wt_consoleCard:focus-within .dsh-wt_consoleCardMore{opacity:1;pointer-events:auto}',
  '.dsh-wt_consoleCardMore:hover{background:rgba(255,255,255,.26)}',
  '.dsh-wt_console[data-wt-theme=light] .dsh-wt_consoleCardMore{background:rgba(27,31,36,.10)}',
  '.dsh-wt_console[data-wt-theme=light] .dsh-wt_consoleCardMore:hover{background:rgba(27,31,36,.20)}',
  '.dsh-wt_console[data-wt-shape=circle] .dsh-wt_consoleCardMore{top:26px;right:26px}',
  '.dsh-wt_consoleCardMenu{background:var(--wt-menuBg,#0b0e14);border-color:var(--wt-menuBorder,#3a4150)}',
  '.dsh-wt_console[data-wt-theme=light] .dsh-wt_consoleCardMenu{--wt-menuBg:#ffffff;--wt-menuBorder:rgba(27,31,36,.16)}',
  '.dsh-wt_cardMenuItem{display:block;width:100%;padding:7px 10px;border:none;border-radius:6px;background:transparent;color:var(--wt-text);font:inherit;font-size:12.5px;line-height:18px;text-align:left;cursor:pointer}',
  '.dsh-wt_cardMenuItem:hover{background:rgba(255,255,255,.08)}',
  '.dsh-wt_console[data-wt-theme=light] .dsh-wt_cardMenuItem:hover{background:rgba(27,31,36,.06)}',
  '.dsh-wt_renameField{display:flex;align-items:center;padding:4px 8px;border:1px solid var(--dsw-alias-border-l2,#3a4150);border-radius:6px}',
  '.dsh-wt_renameRow{display:flex;justify-content:flex-end;gap:6px;margin-top:6px}',
  '.dsh-wt_renameBtn{padding:5px 12px;border:1px solid var(--dsw-alias-border-l2,#3a4150);border-radius:6px;background:transparent;color:var(--dsw-alias-label-primary,#e6e8eb);font:inherit;font-size:12px;cursor:pointer}',
  '.dsh-wt_renameBtn:hover{background:var(--dsw-alias-bg-l2,rgba(255,255,255,.08))}',
  '.dsh-wt_renameBtnGo{background:#3b82f6;border-color:#3b82f6;color:#fff}',
  '.dsh-wt_renameBtnGo:hover{background:#2f74e0}',
```

- [ ] **Step 10: 构建 + 全量回归**

```powershell
cd D:\agent-workspace\dsh-plugin\dsh-worktable\01_content
npm run build
node --check lib/client.js
node --check lib/index.js
npm run test:gate
cd ..
node 04_test/console-card-actions.test.mjs
node 04_test/anchor-dom.test.mjs
node 04_test/session-switch-compat.test.mjs
node 04_test/pane-restore.test.mjs
node 04_test/server-home.test.mjs
```
Expected: 与 Task 1 相同（全绿；新回归 4/4）。

- [ ] **Step 11: 读回改动段落确认无残留**

逐个 `read`：`split.tsx` 2160-2240（mask/菜单/卡片）、`index.tsx` 1650-1670 与 3370-3410、`locales.ts` 178-186 与 420-428、`styles.ts` 592-615。确认标签闭合、无重复键、无半截 URL/字符串。

- [ ] **Step 12: 提交**

```powershell
cd D:\agent-workspace\dsh-plugin\dsh-worktable
git add 01_content/src/client/split.tsx 01_content/src/client/index.tsx 01_content/src/client/locales.ts 01_content/src/client/styles.ts 01_content/lib/client.js
git commit -m "feat(console): 控制室卡片悬停 ⋯ 菜单 + 重命名弹层（复用 nameOverrides 覆盖语义）"
```

---

### Task 3: 「切换布局」复用变更视图弹层 + 卡片锚点定位

**Files:**
- Modify: `01_content/src/client/index.tsx`（state 1399 区；`applyLayoutChange` 尾部；`popLeft/popTop` 2983 区；管理列表 🧩 3302；`＋自定义` 3364；viewPick 弹层 3345-3370；`onCardAction` 的 layout 分支）

**Interfaces:**
- Consumes: Task 1 的 `popoverPos`；Task 2 的 `onCardAction` 与 `cardMenu`。
- Produces: `setViewPick(id: string | null, anchor?: { right: number; top: number }) => void`；`viewPickAnchor` state；`viewPickPos` 计算。

- [ ] **Step 1: 状态与 setter 参数化**

把 `const [viewPickFor, setViewPickFor] = useState<string | null>(null)`（1399 行）替换为：

```ts
  /** 变更视图：正在挑选新拓扑的布局 id + 可选锚点（控制室卡片入口传锚点；管理列表不传 = 侧栏锚点） */
  const [viewPickFor, setViewPickFor] = useState<string | null>(null)
  const [viewPickAnchor, setViewPickAnchor] = useState<{ right: number; top: number } | null>(null)
  const setViewPick = (id: string | null, anchor?: { right: number; top: number }) => {
    setViewPickFor(id)
    setViewPickAnchor(anchor ?? null)
  }
```

- [ ] **Step 2: 三处既有调用点改为 `setViewPick`**

- `applyLayoutChange` 末尾 `setViewPickFor(null)` → `setViewPick(null)`
- 管理列表 🧩 按钮（3302 行）`onClick={() => setViewPickFor(id)}` → `onClick={() => setViewPick(id)}`
- 弹层里「＋自定义」磁贴（3364-3365 行）`onClick={() => { setViewPickFor(null); setCustomOpen(true) }}` → `onClick={() => { setViewPick(null); setCustomOpen(true) }}`

Run: `cd D:\agent-workspace\dsh-plugin\dsh-worktable; Select-String -Path 01_content\src\client\index.tsx -Pattern 'setViewPickFor'`
Expected: 只剩 1399 行附近的 `useState`（定义）与 `setViewPick` 内部那一处，共 2 处匹配。

- [ ] **Step 3: 计算 `viewPickPos`**

在 `const popTop = clamp(sectionTop, MIN_TOP, Math.max(MIN_TOP, window.innerHeight - 540))`（2986 行）之后新增：

```ts
  // 变更视图弹层定位：控制室卡片入口用卡片锚点，管理列表沿用侧栏锚点（行为不变）
  const viewPickPos = viewPickAnchor
    ? popoverPos(viewPickAnchor, { w: 320, h: 540 }, { w: window.innerWidth, h: window.innerHeight })
    : { x: popLeft, y: popTop }
```

- [ ] **Step 4: 弹层改用 `viewPickPos`**

3345-3347 行两处替换：

```tsx
      {viewPickFor && <div className="dsh-wt_popBackdrop" style={{ zIndex: 81 }} onClick={() => setViewPick(null)} />}
      {viewPickFor && (
        <div className="dsh-wt_menu dsh-wt_pop" style={{ position: 'fixed', left: viewPickPos.x, top: viewPickPos.y, width: 320, zIndex: 82 }}>
```

（弹层内部的 `PRESET_DEFS.map` 缩略图、「＋自定义」磁贴、`applyLayoutChange` 调用**一律不动**。）

- [ ] **Step 5: `onCardAction` 的 layout 分支改用锚点**

把 Task 2 里写的 `setViewPickFor(id) // Task 3 接管锚点定位` 替换为：

```ts
          setViewPick(id, popoverPos(anchor, { w: 320, h: 540 }, vp))
```

- [ ] **Step 6: 构建 + 全量回归**

```powershell
cd D:\agent-workspace\dsh-plugin\dsh-worktable\01_content
npm run build
node --check lib/client.js
node --check lib/index.js
npm run test:gate
cd ..
node 04_test/console-card-actions.test.mjs
node 04_test/anchor-dom.test.mjs
node 04_test/session-switch-compat.test.mjs
node 04_test/pane-restore.test.mjs
node 04_test/server-home.test.mjs
```
Expected: 全绿（gate 10/10；anchor 8/8；session-switch 5/5；pane-restore 5/5；server-home 3/3；card-actions 4/4）。

- [ ] **Step 7: 提交**

```powershell
cd D:\agent-workspace\dsh-plugin\dsh-worktable
git add 01_content/src/client/index.tsx 01_content/lib/client.js
git commit -m "feat(console): 控制室卡片切换布局复用变更视图弹层（卡片锚点定位，管理列表行为不变）"
```

---

### Task 4: 文档同步 + 实机验收（checkpoint：需用户同意重启 dsh web）

**Files:**
- Modify: `dsh-worktable/AGENTS.md`（「『工作台』控制室项目」段，约 204-206 行卡片动作区）
- Modify: `dsh-worktable/02_process/drafts/2026-09-21-console-card-actions-design.md`（顶部状态行 + 实施记录）
- Create: `dsh-worktable/04_test/probe-console-card-actions.cjs`

- [ ] **Step 1: `AGENTS.md` 补领域约定**

在 `- 卡片动作：点卡片 = 打开该项目（openSplit 或入驻项目切绑定对话）；工作台自己的卡片`
`点击无操作。💬 跳转按钮已删除（用户定案无意义）。` 之后追加：

```
    - 卡片动作（重命名 / 切换布局）：非 self 卡片悬停（或键盘 focus-within）时右上角浮现 ⋯ →
      面板本地菜单两项；菜单/后续弹层一律 `position:fixed`（卡片 overflow:hidden 会裁掉内部菜单）。
      重命名 = 宿主弹层 → 既有 `renameProject`（空白提交删除覆盖回退原名，全局显示名语义）；
      切换布局 = 复用「变更视图」缩略图弹层（卡片锚点定位；管理列表仍用侧栏锚点 popLeft/popTop）。
      纯逻辑与几何在 `src/client/consoleEdit.ts`（renameOverride / popoverPos / collectTabs /
      migrateTabsInto），经 `window.__dshWorktable` 导出；回归 `node 04_test/console-card-actions.test.mjs`
      （已挂进 `npm run pack` 的 5c4 门禁）。
```

- [ ] **Step 2: 写实机探针 `04_test/probe-console-card-actions.cjs`**

以 `04_test/probe-batch18.cjs` 的 CDP 骨架为准（headless Chrome + `--remote-debugging-port` +
`Page.addScriptToEvaluateOnNewDocument` 预置空的 `dsh.worktable.projects.v1` + `Page.navigate` 到
`http://127.0.0.1:3080/` + 轮询 `!!window.__dshWorktable`），在页面内执行下面这段断言逻辑
（选择器只用稳定类名）：

```js
// 在页面里执行（evaluate 表达式内的核心断言；探针文件负责把它包成 async IIFE 并打印结果）
var sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms) }) }
var out = { steps: [] }
// 1. 打开控制室：侧栏工作台入口卡
var entry = [].slice.call(document.querySelectorAll('.dsh-wt_consoleEntry, .dsh-wt_layout'))
  .find(function (el) { return (el.textContent || '').indexOf('控制室') >= 0 })
if (!entry) throw new Error('控制室入口卡未找到')
entry.click(); await sleep(1200)
// 2. 悬停第一张非 self 卡片（无项目时先断言只有创建卡）
var card = [].slice.call(document.querySelectorAll('.dsh-wt_consoleCard'))
  .find(function (el) { return !el.classList.contains('dsh-wt_consoleCardSelf') && !el.classList.contains('dsh-wt_consoleAdd') })
if (!card) throw new Error('没有可操作的项目卡片（探针前提：至少存在一个项目）')
var more = card.querySelector('.dsh-wt_consoleCardMore')
if (!more) throw new Error('⋯ 按钮未渲染')
more.click(); await sleep(300)
var items = [].slice.call(document.querySelectorAll('.dsh-wt_cardMenuItem')).map(function (b) { return b.textContent })
if (items.length !== 2) throw new Error('菜单项数量 = ' + items.length + ' ' + JSON.stringify(items))
out.steps.push({ menu: items })
// 3. 重命名
items[0] && [].slice.call(document.querySelectorAll('.dsh-wt_cardMenuItem'))[0].click(); await sleep(300)
var input = document.querySelector('.dsh-wt_renameField input')
if (!input) throw new Error('改名输入框未渲染')
var setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
setter.call(input, '探针改名'); input.dispatchEvent(new Event('input', { bubbles: true })); await sleep(120)
input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); await sleep(400)
var saved = JSON.parse(localStorage.getItem('dsh.worktable.projects.v1') || '{}')
var cardName = (card.querySelector('.dsh-wt_consoleName') || {}).textContent
out.steps.push({ nameOverrides: saved.nameOverrides || {}, cardName: cardName })
if (cardName !== '探针改名') throw new Error('卡片名未更新：' + cardName)
// 4. 切换布局：点菜单第二项 → 预设弹层出现 → 选第一个预设
more.click(); await sleep(300)
var menu2 = [].slice.call(document.querySelectorAll('.dsh-wt_cardMenuItem'))
menu2[1].click(); await sleep(400)
var presets = [].slice.call(document.querySelectorAll('.dsh-wt_presets .dsh-wt_preset'))
if (presets.length < 2) throw new Error('预设弹层未出现：' + presets.length)
presets[1].click(); await sleep(600)
var after = JSON.parse(localStorage.getItem('dsh.worktable.projects.v1') || '{}')
out.steps.push({ views: Object.keys(after.views || {}), layouts: (after.layouts || []).length })
return out
```

- [ ] **Step 3: checkpoint —— 先向用户汇报，并确认是否重启 dsh web**

自动化（Task 1–3 的 Step）已全绿即可汇报；**实机验收的硬前提是重启 dsh web**（客户端 bundle 启动时定版，
`link:` 安装的插件不会热更）。把「重启会中断当前 GUI 会话」讲清楚，拿到用户明确同意后再执行
`dsh web` 重启 + 刷新页面，然后：

Run: `cd D:\agent-workspace\dsh-plugin\dsh-worktable; node 04_test/probe-console-card-actions.cjs`
Expected: 打印 `PASS` 与 `{ menu: ['重命名','切换布局'], cardName: '探针改名', ... }`；`nameOverrides` 含该项目；
`views` 含切换后的项目 id。失败时把探针返回的 `steps` 原样贴出来，不猜。

- [ ] **Step 4: 收尾：状态行 + 提交**

设计稿顶部状态行改为 `已实现（自动化全绿；实机点击验收见下）`，并把 Task 1–4 的实际命令与输出
（红→绿确认、套件计数、探针结果）追加成「## 0. 实施记录」段落（格式照抄
`2026-09-20-pane-restore-and-widget-list-design.md` 第 5–35 行）。

```powershell
cd D:\agent-workspace\dsh-plugin\dsh-worktable
git add AGENTS.md 02_process/drafts/2026-09-21-console-card-actions-design.md 04_test/probe-console-card-actions.cjs
git commit -m "docs(console): 控制室卡片动作领域约定 + 实施记录 + 实机探针"
```

---

## 自查（自查清单，写完计划后逐条对照设计稿）

- **Spec coverage**：设计稿 §4.1 卡片 ⋯（Task 2 Step 2-4）✓；§4.2 重命名（Task 2 Step 5-7，语义走 `renameOverride` Task 1）✓；§4.3 切布局复用弹层 + 锚点参数化（Task 3 全部）✓；§4.4 `popoverPos` 复用（Task 1 + Task 2/3 调用）✓；§4.5 边界（self 无 ⋯ Task 2 Step 4；无新存储键 —— 全程未改 `loadProjects`/`persistProjects` 结构）✓；§5 验收（Task 1 Step 5-7 + Task 2/3 Step 6 + Task 4）✓；§6 风险（菜单 fixed 定位 Task 2 Step 3 注释 + 样式）✓；§7 落地文件（全部覆盖，另加 release-prep 门禁 → 已写入 Task 1 Step 7）✓。
- **Placeholder scan**：无 TBD/TODO；唯一的「条件分支」是 Task 4 Step 3 的实机步骤，其前提（重启）与失败上报方式都已写明。
- **Type consistency**：`onCardAction(id, action, anchor: { right, top })` 在 `SplitEnv.console`（Task 2 Step 1b）、面板调用（Step 3）、宿主实现（Step 6）三处签名一致；`popoverPos(rect, size, viewport)` 在 Task 1 定义、Task 2/3 调用一致；`setViewPick(id, anchor?)` 三处调用点统一（Task 3 Step 2 有 grep 校验）。
