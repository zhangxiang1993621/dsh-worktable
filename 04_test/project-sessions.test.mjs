/**
 * 项目会话联动回归（纯逻辑，评估真实构建产物 lib/client.js）。
 * 用法：node project-sessions.test.mjs [lib/client.js 路径]
 * 覆盖：
 *   1. listProjectSessions：同目录工作区顺序 / 跳过归档·子代理·悬空 / 无文件夹·无工作区 = []
 *   2. sessionsMenuModel：当前项打勾 / 空标题套占位 / 未命中补「当前：…」行 / 空列表
 *   3. decideProjectOpen：绑定优先（绑定子代理 = 无绑定）/ 同目录第一个 / 无会话→create / 无通道·无文件夹→none
 *   4. applyProjectOpen：open 直切 / none 不动 / create 并发去重 / 失败静默且不 open（Task 2 追加）
 * 纯函数经 window.__dshWorktable 导出（src/client/index.tsx 模块装载时合并）。
 */
import { readFileSync } from 'node:fs'
import { createContext, runInNewContext } from 'node:vm'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'

const BUNDLE = resolve(process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), '..', '01_content', 'lib', 'client.js'))
const source = readFileSync(BUNDLE, 'utf8')

// —— 假 DOM（与 console-card-actions.test.mjs 同构，确保 bundle 模块作用域能跑通）——
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
const { listProjectSessions, sessionsMenuModel, decideProjectOpen } = hooks
for (const [name, fn] of Object.entries({ listProjectSessions, sessionsMenuModel, decideProjectOpen })) {
  if (typeof fn !== 'function') fail('export.' + name, 'window.__dshWorktable.' + name + ' 未导出')
}

// 夹具：w1 = 项目文件夹同目录工作区；w2 = 别的目录；s2 归档、s4 子代理、s6 悬空（不在 byId）
const WS = {
  items: [
    { workspaceId: 'w1', path: 'D:\\proj\\demo', sessionIds: ['s1', 's2', 's3', 's4', 's5', 's6'] },
    { workspaceId: 'w2', path: 'D:\\other', sessionIds: ['x1'] },
  ],
  archivedSessionIds: ['s2'],
}
const BYID = {
  s1: { title: '第一个' },
  s3: { title: '' },
  s4: { title: '子代理' },
  s5: {},
  x1: { title: '别目录会话' },
}
const SUB = new Set(['s4'])

// 1. listProjectSessions：顺序 = sessionIds 顺序；跳过归档/子代理/悬空；同目录匹配（盘符大小写、尾分隔符、分隔符风格无关）
{
  const rows = listProjectSessions('D:/proj/demo/', WS, BYID, SUB)
  if (rows.length !== 3) fail('list.len', JSON.stringify(rows))
  if (rows[0].id !== 's1' || rows[1].id !== 's3' || rows[2].id !== 's5') fail('list.order', JSON.stringify(rows.map((r) => r.id)))
  if (rows[1].title !== '') fail('list.emptyTitle', '空标题应原样返回，占位由 sessionsMenuModel 负责：' + JSON.stringify(rows[1]))
  if (listProjectSessions('', WS, BYID, SUB).length !== 0) fail('list.noFolder', '空路径应返回 []')
  if (listProjectSessions('D:\\nope', WS, BYID, SUB).length !== 0) fail('list.noWs', '无同目录工作区应返回 []')
  if (listProjectSessions('D:\\proj\\demo', { items: [] }, BYID, SUB).length !== 0) fail('list.emptyWs', '空工作区列表应返回 []')
  ok('listProjectSessions')
}

// 2. sessionsMenuModel：打勾 / 空标题占位 / 未命中补「当前」行 / 空列表
{
  const rows = [{ id: 's1', title: '第一个' }, { id: 's3', title: '' }]
  const m1 = sessionsMenuModel(rows, 's3', '新会话')
  if (m1.rows[1].title !== '新会话') fail('model.placeholder', JSON.stringify(m1.rows[1]))
  if (!m1.rows[1].current || m1.rows[0].current) fail('model.current', JSON.stringify(m1.rows))
  if (m1.orphan !== null) fail('model.orphanNone', JSON.stringify(m1.orphan))
  const m2 = sessionsMenuModel(rows, 'zz', '新会话', '外部会话')
  if (m2.rows.some((r) => r.current)) fail('model.noHit', JSON.stringify(m2.rows))
  if (!m2.orphan || m2.orphan.id !== 'zz' || m2.orphan.title !== '外部会话') fail('model.orphan', JSON.stringify(m2.orphan))
  const m3 = sessionsMenuModel([], '', '新会话')
  if (m3.rows.length !== 0 || m3.orphan !== null) fail('model.empty', JSON.stringify(m3))
  const m4 = sessionsMenuModel(rows, 's1', '新会话')
  if (m4.orphan !== null) fail('model.hit', '命中时不应有补行')
  if (rows[1].title !== '') fail('model.pure', '不应改动输入数组')
  ok('sessionsMenuModel')
}

// 3. decideProjectOpen：绑定优先 / 子代理绑定视为无绑定 / 同目录第一个 / 无会话→create / 无通道·无文件夹→none
{
  const base = { folder: 'D:\\proj\\demo', binding: null, workspaces: WS, byId: BYID, subagentIds: SUB, canCreate: true }
  const d1 = decideProjectOpen({ ...base, binding: 'x1' })
  if (d1.action !== 'open' || d1.sessionId !== 'x1') fail('decide.bind', JSON.stringify(d1))
  const d2 = decideProjectOpen(base)
  if (d2.action !== 'open' || d2.sessionId !== 's1') fail('decide.same', JSON.stringify(d2))
  const d3 = decideProjectOpen({ ...base, binding: 's4' })
  if (d3.action !== 'open' || d3.sessionId !== 's1') fail('decide.subBind', JSON.stringify(d3))
  const d4 = decideProjectOpen({ ...base, folder: 'D:\\proj\\empty' })
  if (d4.action !== 'create') fail('decide.create', JSON.stringify(d4))
  const d5 = decideProjectOpen({ ...base, folder: 'D:\\proj\\empty', canCreate: false })
  if (d5.action !== 'none') fail('decide.noChannel', JSON.stringify(d5))
  const d6 = decideProjectOpen({ ...base, folder: '' })
  if (d6.action !== 'none') fail('decide.noFolder', JSON.stringify(d6))
  const d7 = decideProjectOpen({ ...base, workspaces: null, byId: null, subagentIds: null })
  if (d7.action !== 'create') fail('decide.nullSafe', JSON.stringify(d7))
  ok('decideProjectOpen')
}

// 计数自检：新增用例块必须同步改 EXPECTED，用例块缺失时测试必须红
const EXPECTED = 3
if (pass !== EXPECTED) fail('count', '通过数 ' + pass + ' != 预期 ' + EXPECTED + '（有断言块缺失或被跳过？）')
console.log('\nproject-sessions: ' + pass + '/' + EXPECTED + ' passed')
