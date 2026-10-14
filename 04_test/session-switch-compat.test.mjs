/**
 * 主视图会话切换兼容层回归（DSH 0.1.6-alpha.2 起宿主移除 sessions.open 的回归）。
 *
 * 背景（2026-09-20 实测 0.1.6-alpha.2）：
 *   - `ctx.sessions.open` 已不存在（sessions 服务原型上只有 create/fork/binding/…）；
 *   - `ctx.sessions.list.getSnapshot()` 快照不再带 `current`（只剩 ids/byId/phase/…）；
 *   - 主视图会话切换改由 `uiWorkspace` 服务负责：openSession() → replaceMain() →
 *     selection 快照（持久化键 dsh.sessions.current）。
 *   插件原先只调 sessions.open + 读 list 快照 current → 在 0.1.6 上「切换项目室后右侧对话
 *   不跟着切」且「当前会话恒为空」。
 *
 * 用例（不走 React，只驱动 apply() 暴露的会话切换通道）：
 *   1. 0.1.6 宿主：无 sessions.open、有 uiWorkspace → openSession 必须被调用
 *   2. 老宿主：有 sessions.open、无 uiWorkspace → sessions.open 必须被调用（不回归）
 *   3. 两者都在 → 优先 uiWorkspace（新宿主口径）
 *   4. 当前会话读取：0.1.6 取 uiWorkspace.selection.sessionId；老宿主取 list 快照 current
 *   5. 桥与 uiWorkspace 都缺席 → 不抛异常（静默不改，与「未绑定 = 不切换」一致）
 *
 * 用法：node 04_test/session-switch-compat.test.mjs [lib/client.js 路径]
 *   缺省评估工作目录构建产物 01_content/lib/client.js。
 */
import { readFileSync } from 'node:fs'
import { createContext, runInNewContext } from 'node:vm'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'

const BUNDLE = resolve(process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), '..', '01_content', 'lib', 'client.js'))
const source = readFileSync(BUNDLE, 'utf8')

let pass = 0
const fail = (name, detail) => { console.error('FAIL(' + name + '): ' + detail); process.exit(1) }
const ok = (name) => { console.log('ok   ' + name); pass++ }

const localStorageStub = { getItem: () => null, setItem: () => {}, removeItem: () => {} }

// 万能桩：未实现的 DOM API（canvas getContext 等）返回自身同型桩（对齐 anchor-dom 测试）
const universalStub = new Proxy(function () { return universalStub }, {
  get: (_t, k) => (k === Symbol.toPrimitive ? () => 'stub' : universalStub),
  apply: () => universalStub,
  construct: () => universalStub,
})
/** 万能元素：任何未实现的方法/属性都走同型桩，避免模块级代码在评估期炸掉。 */
function makeEl(tag = 'DIV') {
  const el = {
    tagName: String(tag).toUpperCase(),
    className: '',
    style: {},
    children: [],
    dataset: {},
    parentElement: null,
    appendChild(c) { this.children.push(c); return c },
    removeChild() {},
    insertBefore(c) { this.children.unshift(c); return c },
    remove() {},
    setAttribute() {}, getAttribute() { return null }, removeAttribute() {},
    addEventListener() {}, removeEventListener() {},
    querySelector: () => null,
    querySelectorAll: () => [],
    closest: () => null,
    contains: () => false,
    getBoundingClientRect: () => ({ left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 }),
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    focus() {}, blur() {}, click() {},
  }
  return new Proxy(el, {
    get(t, k) {
      if (k in t) return t[k]
      if (k === Symbol.toPrimitive) return () => 'stub'
      return universalStub
    },
  })
}

/** 评估客户端 bundle，返回 factory 产物（module.exports：apply / WorktableSection）。 */
function loadBundle() {
  const sandbox = {
    window: {},
    console: { log() {}, warn() {}, error() {}, info() {} },
    setTimeout, clearTimeout, setInterval, clearInterval,
    localStorage: localStorageStub,
    document: {
      body: makeEl('BODY'),
      documentElement: makeEl('HTML'),
      head: makeEl('HEAD'),
      querySelector: () => null,
      querySelectorAll: () => [],
      createElement: (tag) => makeEl(tag),
      addEventListener() {}, removeEventListener() {},
    },
    atob: (s) => Buffer.from(String(s), 'base64').toString('binary'),
    btoa: (s) => Buffer.from(String(s), 'binary').toString('base64'),
    Blob: function Blob() {},
    URL: { createObjectURL: () => 'blob:stub', revokeObjectURL: () => {} },
    MutationObserver: class { constructor(cb) { this.cb = cb } observe() {} disconnect() {} },
    ResizeObserver: class { constructor(cb) { this.cb = cb } observe() {} unobserve() {} disconnect() {} },
    IntersectionObserver: class { observe() {} unobserve() {} disconnect() {} },
    CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init && init.detail } },
    requestAnimationFrame: (cb) => 0,
    cancelAnimationFrame: () => {},
    navigator: { userAgent: 'test', platform: 'Win32', language: 'zh-CN' },
    fetch: () => Promise.reject(new Error('fetch unavailable')),
    indexedDB: undefined,
  }
  sandbox.window.__ModuleLoader__ = { load: (reg) => { sandbox.__captured = reg } }
  sandbox.window.addEventListener = () => {}
  sandbox.window.removeEventListener = () => {}
  sandbox.window.dispatchEvent = () => {}
  sandbox.window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} })
  sandbox.window.localStorage = localStorageStub
  sandbox.window.document = sandbox.document
  sandbox.self = sandbox.window
  createContext(sandbox)
  runInNewContext(source, sandbox, { filename: 'client.js', timeout: 20000 })
  if (!sandbox.__captured || typeof sandbox.__captured.factory !== 'function') fail('load', 'ModuleLoader.load 未被调用')

  const makeStub = () => {
    const stub = function () { return makeStub() }
    return new Proxy(stub, {
      get: (_t, k) => (k === Symbol.toPrimitive ? () => 'stub' : makeStub()),
      apply: () => makeStub(),
      construct: () => makeStub(),
    })
  }
  const requireStub = (id) => {
    if (id === 'react' || id === 'react/jsx-runtime' || id === 'react-dom' || id === 'react/jsx-dev-runtime' || id === 'scheduler') return makeStub()
    if (id.startsWith('@deepseek-ai/')) return makeStub()
    throw new Error('unexpected external require: ' + id)
  }
  const runSandbox = { __factory: sandbox.__captured.factory, __requireStub: requireStub }
  createContext(runSandbox)
  const mod = runInNewContext('__factory(__requireStub)', runSandbox, { timeout: 20000 })
  if (!mod || typeof mod.apply !== 'function') fail('load', 'module.exports.apply 缺失')
  return { sandbox, mod }
}

/** 最小 ctx 桩：apply() 只做注册，不驱动 React 与 effect。 */
function makeCtx(opts) {
  const uw = opts.uiWorkspace
  return {
    sessions: opts.sessions ?? null,
    conversation: null,
    workspaces: null,
    get: (name) => (name === 'uiWorkspace' ? uw : undefined),
    effect: () => () => {},
    inject: () => {},
    slots: { entries: () => [], subscribe: () => () => {}, inject: () => {}, register: () => {} },
    locale: { register: () => {} },
  }
}

function sessionsStub(extra = {}) {
  return {
    list: {
      getSnapshot: () => ({ ids: [], byId: {}, phase: 'ready' }),
      subscribe: () => () => {},
    },
    ...extra,
  }
}

function uiWorkspaceStub(onOpen, current) {
  return {
    openSession: (id) => { onOpen(id) },
    selection: { getSnapshot: () => ({ sessionId: current }) },
  }
}

// —— 1. 0.1.6 宿主：sessions.open 缺失 → 必须走 uiWorkspace.openSession ——
{
  const { sandbox, mod } = loadBundle()
  const opened = []
  const ctx = makeCtx({ sessions: sessionsStub(), uiWorkspace: uiWorkspaceStub((id) => opened.push(id), 's-cur') })
  mod.apply(ctx)
  if (typeof sandbox.window.__dshOpenSession !== 'function') fail('1.hook', '__dshOpenSession 未暴露')
  sandbox.window.__dshOpenSession('s-bound')
  if (opened.length !== 1 || opened[0] !== 's-bound') fail('1.open', 'uiWorkspace.openSession 未被调用: ' + JSON.stringify(opened))
  ok('1. 0.1.6（无 sessions.open）→ uiWorkspace.openSession（当前会话统一由 sessionCompat 读会话快照，见上游 session-compat 回归）')
}

// —— 2. 老宿主：无 uiWorkspace → 仍走 sessions.open / list.current ——
{
  const { sandbox, mod } = loadBundle()
  const opened = []
  const sessions = sessionsStub({ open: (id) => opened.push(id) })
  sessions.list.getSnapshot = () => ({ ids: [], byId: {}, current: 's-old' })
  const ctx = makeCtx({ sessions, uiWorkspace: null })
  mod.apply(ctx)
  sandbox.window.__dshOpenSession('s-x')
  if (opened.length !== 1 || opened[0] !== 's-x') fail('2.open', 'sessions.open 未被调用: ' + JSON.stringify(opened))
  if (sandbox.window.__dshCurrentMainSession() !== 's-old') fail('2.current', 'list.current 未被读取')
  ok('2. 老宿主（无 uiWorkspace）→ sessions.open + list.current 不回归')
}

// —— 3. 两者都在：优先 uiWorkspace（新宿主口径） ——
{
  const { sandbox, mod } = loadBundle()
  const opened = []
  const sessions = sessionsStub({ open: (id) => opened.push('legacy:' + id) })
  const ctx = makeCtx({ sessions, uiWorkspace: uiWorkspaceStub((id) => opened.push('uw:' + id), 's-uw') })
  mod.apply(ctx)
  sandbox.window.__dshOpenSession('s-both')
  if (opened.length !== 1 || opened[0] !== 'uw:s-both') fail('3.prefer', '应优先 uiWorkspace: ' + JSON.stringify(opened))
  ok('3. 两通道并存 → 优先 uiWorkspace')
}

// —— 4. 通道全缺：静默（不抛异常） ——
{
  const { sandbox, mod } = loadBundle()
  const ctx = makeCtx({ sessions: sessionsStub(), uiWorkspace: null })
  mod.apply(ctx)
  let threw = null
  try { sandbox.window.__dshWorktable.openMainSession('s-none') } catch (e) { threw = String(e) }
  if (threw) fail('4.silent', '切换通道缺失时应静默: ' + threw)
  if (sandbox.window.__dshCurrentMainSession() !== '') fail('4.current', '无通道时当前会话应为空串')
  ok('4. 无任何切换通道 → 静默不改')
}

// —— 5. pickProjectSession：绑定优先、未绑定 = 项目文件夹「同目录」工作区的第一个可用对话 ——
{
  const { mod } = loadBundle()
  const fn = mod.pickProjectSession
  if (typeof fn !== 'function') fail('5.export', 'pickProjectSession 未导出（切换目标无法按同目录工作区解析）')
  const sub = new Set(['session-sub'])
  const ws = {
    items: [
      { path: 'D:\\agent-workspace\\java面试', sessionIds: ['session-a', 'session-b'] },
      { path: 'D:\\agent-workspace\\AI学习\\', sessionIds: ['session-c'] },
    ],
    archivedSessionIds: [],
  }
  const byId = { 'session-a': {}, 'session-b': {}, 'session-c': {} }
  if (fn('D:\\agent-workspace\\java面试', 'session-bound', ws, byId, sub) !== 'session-bound') fail('5.bind', '显式绑定应优先')
  if (fn('D:\\agent-workspace\\java面试', 'session-sub', ws, byId, sub) !== 'session-a') fail('5.subBind', '绑定到子代理应视为无绑定 → 回落工作区第一个')
  if (fn('d:/agent-workspace/java面试/', null, ws, byId, sub) !== 'session-a') fail('5.folder', '同目录匹配（分隔符/盘符大小写/尾斜杠）失败')
  if (fn('D:\\agent-workspace\\AI学习', null, ws, byId, sub) !== 'session-c') fail('5.trailing', '工作区 path 带尾分隔符应视为同目录')
  const ws2 = { items: [{ path: 'D:\\p\\x', sessionIds: ['session-arch', 'session-sub', 'session-ok'] }], archivedSessionIds: ['session-arch'] }
  if (fn('D:\\p\\x', null, ws2, { 'session-ok': {} }, sub) !== 'session-ok') fail('5.skip', '归档/子代理未跳过')
  const ws3 = { items: [{ path: 'D:\\p\\y', sessionIds: ['session-x', 'session-y'] }], archivedSessionIds: [] }
  if (fn('D:\\p\\y', null, ws3, { 'session-y': {} }, sub) !== 'session-y') fail('5.loaded', '应优先已载入（侧栏可见）的会话')
  if (fn('D:\\p\\none', null, ws3, { 'session-x': {} }, sub) !== null) fail('5.none', '无同目录工作区应返回 null（不切换）')
  if (fn(null, null, ws3, { 'session-x': {} }, sub) !== null) fail('5.nofolder', '无项目文件夹应返回 null')
  const ws4 = { items: [{ path: 'D:\\p\\z', sessionIds: ['session-arch'] }], archivedSessionIds: ['session-arch'] }
  if (fn('D:\\p\\z', null, ws4, {}, sub) !== null) fail('5.archivedOnly', '只有归档会话应返回 null')
  if (typeof mod.normProjectFolder !== 'function' || mod.normProjectFolder('D:\\a\\b\\') !== 'd:/a/b') fail('5.norm', 'normProjectFolder 规范化错')
  ok('5. pickProjectSession（绑定优先 / 同目录工作区第一个对话 / 跳过归档与子代理 / 无匹配不切换）')
}

console.log('\n' + pass + ' 个用例通过（session-switch-compat）')
