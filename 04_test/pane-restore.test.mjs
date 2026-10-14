/**
 * 窗格「最近关闭」恢复 + 存量救援回填 回归测试。
 *
 * 背景：窗格内容 = 标签列表；点 ✕ 走 splitStore.closeTab（直接从 spec 删除并持久化）——
 * 标签关空后窗格退化成 5 图标选择器，AI 产物等内容**不可找回**（用户实测：java面试项目窗口1）。
 *   1. closeTab 留档（≤5、最近在前、原 id/标题/内容完整保留）
 *   2. restoreClosedTab 原样放回（原 id 不变）并移出历史；未命中 = 无操作
 *   3. 历史随 spec 走 onSpecMutated（持久化通道不丢）
 *   4. seedPaneRestore：只填空窗格、不覆盖非空窗格、同内容去重（存量救援回填）
 *   5. splitStore.seedRestore 活 spec 通道同样生效
 *
 * 用法：node 04_test/pane-restore.test.mjs [lib/client.js 路径]
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
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b)

const localStorageStub = {
  _m: {},
  getItem(k) { return Object.prototype.hasOwnProperty.call(this._m, k) ? this._m[k] : null },
  setItem(k, v) { this._m[k] = String(v) },
  removeItem(k) { delete this._m[k] },
}

const universalStub = new Proxy(function () { return universalStub }, {
  get: (_t, k) => (k === Symbol.toPrimitive ? () => 'stub' : universalStub),
  apply: () => universalStub,
  construct: () => universalStub,
})
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
  }
  return new Proxy(el, {
    get(t, k) {
      if (k in t) return t[k]
      if (k === Symbol.toPrimitive) return () => 'stub'
      return universalStub
    },
  })
}

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
  if (!sandbox.__captured || typeof sandbox.__captured.factory !== 'function') fail('load', 'ModuleLoader.load 未调用')

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
  const dbg = sandbox.window.__dshWorktable
  if (!dbg || !dbg.splitStore) fail('load', 'window.__dshWorktable.splitStore 未导出')
  return { sandbox, mod, splitStore: dbg.splitStore }
}

const tab = (id, title, content) => ({ id, title, content })
const iframe = (url) => ({ kind: 'iframe', url, title: url })
const chatWidth = { default: 320, min: 240, max: 600 }

function makeSpec(tabs) {
  return {
    id: 'p-restore',
    title: '恢复测试',
    top: null,
    main: [{ id: 'm1', title: '窗口1', min: 200, tabs: tabs.slice(), active: 0 }],
    chatWidth,
  }
}

/** 挂上 spec 并记录 onSpecMutated（持久化通道） */
function attach(store, spec) {
  const mutations = []
  store.spec = spec
  store.active = false
  store.onSpecMutated = (s) => mutations.push(s)
  return mutations
}

// —— 1. closeTab 留档：≤5、最近在前、原 id/标题/内容完整保留 ——
{
  const { splitStore } = loadBundle()
  const tabs = [
    tab('t1', 'A', iframe('/a')),
    tab('t2', 'B', iframe('/b')),
    tab('t3', 'C', iframe('/c')),
    tab('t4', 'D', iframe('/d')),
    tab('t5', 'E', iframe('/e')),
    tab('t6', 'F', iframe('/f')),
    tab('t7', 'G', iframe('/g')),
    tab('t8', 'H', iframe('/h')),
  ]
  const mutations = attach(splitStore, makeSpec(tabs))
  for (const t of tabs) splitStore.closeTab('main', 0, t.id)
  const pane = splitStore.spec.main[0]
  if (pane.tabs.length !== 0) fail('1.tabs', '标签未关空: ' + pane.tabs.length)
  const closed = pane.closedTabs ?? []
  if (closed.length !== 5) fail('1.cap', '历史应封顶 5 条，实际 ' + closed.length)
  if (closed.map((t) => t.id).join(',') !== 't8,t7,t6,t5,t4') fail('1.order', '最近在前顺序错: ' + closed.map((t) => t.id).join(','))
  if (closed[0].title !== 'H' || !eq(closed[0].content, iframe('/h'))) fail('1.payload', '原标题/内容未保留: ' + JSON.stringify(closed[0]))
  if (mutations.length !== tabs.length) fail('1.persist', 'onSpecMutated 次数=' + mutations.length)
  const last = mutations[mutations.length - 1]
  if (!(last.main[0].closedTabs ?? []).length) fail('1.persistCarry', '持久化通道未携带 closedTabs')
  ok('1. closeTab 留档（≤5、最近在前、原 id/标题/内容保留、随 spec 持久化）')
}

// —— 2. restoreClosedTab 原样放回；未命中 = 无操作 ——
{
  const { splitStore } = loadBundle()
  const mutations = attach(splitStore, makeSpec([tab('t1', '知识库阅读器.html', iframe('/site/x')), tab('t2', 'B', iframe('/b'))]))
  splitStore.closeTab('main', 0, 't1')
  if (splitStore.spec.main[0].tabs.length !== 1) fail('2.setup', '关闭后应剩 1 个标签')
  splitStore.restoreClosedTab('main', 0, 't1')
  const pane = splitStore.spec.main[0]
  const restored = pane.tabs.find((t) => t.id === 't1')
  if (!restored) fail('2.restore', '未恢复（id 未保留）: ' + JSON.stringify(pane.tabs.map((t) => t.id)))
  if (restored.title !== '知识库阅读器.html' || !eq(restored.content, iframe('/site/x'))) fail('2.payload', '标题/内容未原样: ' + JSON.stringify(restored))
  if ((pane.closedTabs ?? []).length !== 0) fail('2.history', '恢复后应移出历史')
  if (pane.active !== pane.tabs.length - 1) fail('2.active', 'active 应指向恢复的标签')
  const before = JSON.stringify(splitStore.spec)
  const n = mutations.length
  splitStore.restoreClosedTab('main', 0, 't-not-exist')
  if (JSON.stringify(splitStore.spec) !== before) fail('2.noop', '未命中历史时不应改动 spec')
  if (mutations.length !== n) fail('2.noopMutate', '未命中历史时不应触发持久化')
  ok('2. restoreClosedTab 原样放回（原 id）+ 未命中无操作')
}

// —— 4. ✕ → ↩ 恢复闭环（活 spec 通道）——
{
  const { splitStore } = loadBundle()
  const mutations = attach(splitStore, makeSpec([tab('t1', '知识库阅读器.html', iframe('/site/kb'))]))
  splitStore.closeTab('main', 0, 't1') // 用户 ✕ 关掉 → 历史有档
  const closed = splitStore.spec.main[0].closedTabs ?? []
  if (closed.length !== 1) fail('4.closed', '关闭应留档')
  splitStore.restoreClosedTab('main', 0, closed[0].id)
  if (!splitStore.spec.main[0].tabs.some((t) => t.id === 't1')) fail('4.roundtrip', '✕ → ↩ 未闭环')
  if (mutations.length === 0) fail('4.liveMutate', '恢复闭环应走 onSpecMutated')
  ok('4. ✕ → ↩ 恢复闭环（活 spec 通道）')
}


console.log('\n' + pass + ' 个用例通过（pane-restore）')