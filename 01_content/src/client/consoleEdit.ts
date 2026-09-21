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
