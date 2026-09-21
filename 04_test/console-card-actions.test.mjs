/**
 * 控制室卡片动作回归（纯逻辑，评估真实构建产物 lib/client.js）。
 * 用法：node console-card-actions.test.mjs [lib/client.js 路径]
 * 缺省用工作目录构建产物；发布脚本传入「已安装包内」的 lib/client.js。
 * 覆盖：
 *   1. renameOverride：非空写入 / 纯空白删除（回退原名）/ 不改原对象
 *   2. popoverPos：右侧越界 / 顶部越界 / 底部越界 / 常规值四种钳制
 *   3. collectTabs：左栏 → 顶行 → 主行顺序、只收非空窗格、空 spec = []
 *   4. migrateTabsInto：标签按序迁入（active=0、清空 content）/ 溢出并入最后窗格 / 无标签无副作用
 * 纯函数经 window.__dshWorktable 导出（src/client/consoleEdit.ts 模块装载时合并）。
 */
import { readFileSync } from 'node:fs'
import { createContext, runInNewContext } from 'node:vm'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'

const BUNDLE = resolve(process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), '..', '01_content', 'lib', 'client.js'))
const source = readFileSync(BUNDLE, 'utf8')

// —— 假 DOM（与 anchor-dom.test.mjs 同构，确保 bundle 模块作用域能跑通）——
class StyleProxy {
  constructor() {
    return new Proxy(this, {
      get(t, k) {
        if (k === Symbol.toPrimitive) return () => 'style'
        return k in t ? t[k] : ''
      },
    })
  }
  getPropertyValue(k) { return Object.prototype.hasOwnProperty.call(this, k) ? this[k] : '' }
  setProperty(k, v) { this[k] = v }
  removeProperty(k) { delete this[k] }
}
const universalStub = new Proxy(function () { return universalStub }, {
  get: (_t, k) => (k === Symbol.toPrimitive ? () => 'stub' : universalStub),
  apply: () => universalStub,
  construct: () => universalStub,
})
class FakeEl {
  constructor(tag = 'DIV', cls = '', attrs = {}) {
    this.tagName = tag
    this.className = cls
    this.dataset = {}
    for (const [k, v] of Object.entries(attrs)) this.dataset[k] = v
    this.children = []
    this.parentElement = null
    this.style = new StyleProxy()
    this._rect = { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 }
    this._connected = true
    return new Proxy(this, {
      get(t, k) {
        if (k in t) return t[k]
        if (k === Symbol.toPrimitive) return () => 'stub'
        return universalStub
      },
    })
  }
  get isConnected() { return this._connected }
  getBoundingClientRect() { return { ...this._rect } }
  setRect(o) {
    Object.assign(this._rect, o)
    this._rect.width = this._rect.right - this._rect.left
    this._rect.height = this._rect.bottom - this._rect.top
    return this
  }
  appendChild(c) { c.parentElement = this; this.children.push(c); return c }
  insertBefore(c) { c.parentElement = this; this.children.unshift(c); return c }
  removeChild(c) { c.parentElement = null; this.children = this.children.filter((x) => x !== c); return c }
  _walk(out) { for (const c of this.children) { out.push(c); c._walk(out) } return out }
  querySelectorAll() { return this._walk([]) }
  querySelector() { return null }
  closest() { return null }
  addEventListener() {}
  removeEventListener() {}
  setAttribute(k, v) { this.dataset[k] = v }
  getAttribute(k) { return this.dataset[k] }
  removeAttribute(k) { delete this.dataset[k] }
}

let pass = 0
const fail = (name, detail) => { console.error('FAIL(' + name + '): ' + detail); process.exit(1) }
const ok = (name) => { console.log('ok   ' + name); pass++ }

function matches(el, sel) {
  if (sel === '[data-phase]') return el.dataset && el.dataset.phase != null
  if (sel.startsWith('.')) {
    const cls = String(el.className || '').split(/\s+/)
    return cls.includes(sel.slice(1))
  }
  return false
}

function buildSandbox() {
  const allEls = []
  const moInstances = []
  class MOCtor {
    constructor(cb) { this.cb = cb; moInstances.push(this) }
    observe(target) { this._target = target }
    disconnect() {}
  }
  class ROCtor {
    constructor(cb) { this.cb = cb }
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  const localStorageStub = { getItem: () => null, setItem: () => {}, removeItem: () => {} }
  const documentStub = {
    body: new FakeEl('BODY'),
    documentElement: new FakeEl('HTML'),
    querySelector: (sel) => allEls.find((e) => matches(e, sel)) || null,
    querySelectorAll: (sel) => allEls.filter((e) => matches(e, sel)),
    createElement: (tag) => new FakeEl(String(tag).toUpperCase()),
    addEventListener() {},
    removeEventListener() {},
  }
  const sandbox = {
    window: {},
    console: { log() {}, warn() {}, error() {} },
    setTimeout, clearTimeout,
    localStorage: localStorageStub,
    document: documentStub,
    atob: (s) => Buffer.from(String(s), 'base64').toString('binary'),
    btoa: (s) => Buffer.from(String(s), 'binary').toString('base64'),
    Blob: function Blob() {},
    URL: { createObjectURL: () => 'blob:stub', revokeObjectURL: () => {} },
    MutationObserver: MOCtor,
    ResizeObserver: ROCtor,
    IntersectionObserver: function () { return { observe() {}, unobserve() {}, disconnect() {} } },
    CustomEvent: class CustomEvent { constructor(type, init) { this.type = type; this.detail = init && init.detail } },
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
  sandbox.window.document = documentStub
  sandbox.self = sandbox.window
  createContext(sandbox)
  runInNewContext(source, sandbox, { filename: 'client.js', timeout: 20000 })
  if (!sandbox.__captured || typeof sandbox.__captured.factory !== 'function') fail('load', 'factory not captured')
  const makeStub = () => {
    const stub = function () { return makeStub() }
    return new Proxy(stub, {
      get: (_t, k) => (k === Symbol.toPrimitive ? () => 'stub' : makeStub()),
      apply: () => makeStub(),
      construct: () => makeStub(),
    })
  }
  const requireStub = (id) => {
    if (id === 'react' || id === 'react/jsx-runtime') return makeStub()
    throw new Error('unexpected external require: ' + id)
  }
  const runSandbox = { __factory: sandbox.__captured.factory, __requireStub: requireStub }
  createContext(runSandbox)
  runInNewContext('__factory(__requireStub)', runSandbox, { timeout: 20000 })
  return { sandbox, allEls, moInstances }
}

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

// 2. popoverPos：右侧越界 / 顶部越界 / 底部越界 / 常规值
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
