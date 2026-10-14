/**
 * 项目存档防丢失回归（纯逻辑，评估真实构建产物 lib/client.js）。
 * 用法：node projects-storage.test.mjs [lib/client.js 路径]
 * 背景：2026-09-29 实测事故——Chrome 级「清除浏览数据」把 127.0.0.1:3080 源的
 *   dsh.worktable.projects.v1 整体删掉，插件把「读不到存档」当成「新装」，
 *   立刻回写默认值 → 项目列表只剩内置控制室，且旧值不可逆。
 * 覆盖：
 *   1. planProjectsLoad：主键正常 → 用主键、可写、字段规范化
 *   2. planProjectsLoad：主键缺失 + 备份有效 → 用备份恢复（wipe 场景）
 *   3. planProjectsLoad：主键损坏 → 备份可救则救；备份也不可用则默认值 + 本会话只读（不回写）
 *   4. planProjectsLoad：两边都缺失 = 真·新装 → 默认值且可写
 *   5. projectsBackupWrite：只备份可解析的旧主键值；与现有备份相同不重复写；损坏值不备份
 *   6. projectsBackupHeal：主键有料而备份缺失/为空/损坏 → 补备份（含手工恢复后的自愈）
 * 纯函数经 window.__dshWorktable 导出（src/client/index.tsx 模块装载时合并）。
 */
import { readFileSync } from 'node:fs'
import { createContext, runInNewContext } from 'node:vm'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'

const BUNDLE = resolve(process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), '..', '01_content', 'lib', 'client.js'))
const source = readFileSync(BUNDLE, 'utf8')

// —— 假 DOM（与 project-sessions.test.mjs 同构，确保 bundle 模块作用域能跑通）——
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
  getBoundingClientRect() { return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 } }
  appendChild(c) { c.parentElement = this; this.children.push(c); return c }
  insertBefore(c) { c.parentElement = this; this.children.unshift(c); return c }
  removeChild(c) { c.parentElement = null; this.children = this.children.filter((x) => x !== c); return c }
  querySelectorAll() { return [] }
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

function buildSandbox() {
  const localStorageStub = { getItem: () => null, setItem: () => {}, removeItem: () => {} }
  const documentStub = {
    body: new FakeEl('BODY'),
    documentElement: new FakeEl('HTML'),
    querySelector: () => null,
    querySelectorAll: () => [],
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
    MutationObserver: class { constructor(cb) { this.cb = cb } observe() {} disconnect() {} },
    ResizeObserver: class { constructor(cb) { this.cb = cb } observe() {} unobserve() {} disconnect() {} },
    IntersectionObserver: function () { return { observe() {}, unobserve() {}, disconnect() {} } },
    CustomEvent: class CustomEvent { constructor(type, init) { this.type = type; this.detail = init && init.detail } },
    requestAnimationFrame: () => 0,
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
  return { sandbox }
}

const { sandbox } = buildSandbox()
const hooks = sandbox.window.__dshWorktable || {}
const { planProjectsLoad, projectsBackupWrite, projectsBackupHeal } = hooks
for (const [name, fn] of Object.entries({ planProjectsLoad, projectsBackupWrite, projectsBackupHeal })) {
  if (typeof fn !== 'function') fail('export.' + name, 'window.__dshWorktable.' + name + ' 未导出')
}

/** 造一份「像真实存档」的主键值：2 个项目 + 绑定 + 文件夹 + 内置控制室 view */
const realProjects = () => JSON.stringify({
  order: ['layout-a', 42, 'layout-b'],
  lastUsed: { 'layout-a': 1789969755415 },
  hidden: ['layout-h'],
  nameOverrides: { 'layout-a': '改名后' },
  iconOverrides: { 'layout-a': '🧱' },
  removed: ['layout-gone'],
  views: { 'wt-console': { id: 'wt-console', title: '控制室', main: [] } },
  shortcuts: [],
  layouts: [
    { id: 'layout-a', title: 'AI学习', main: [{ id: 'p1', tabs: [] }] },
    { id: 'layout-b', title: '插件', main: [{ id: 'p1', tabs: [] }] },
    { id: 'bad-no-main', title: '缺 main' },
  ],
  bindings: { 'layout-a': 'session-1' },
  folders: { 'layout-a': 'D:\\proj\\a' },
})

// 1. 主键正常：用主键、可写、字段按既有语义规范化（order 只留字符串 / layouts 过滤缺 main 的项）
{
  const plan = planProjectsLoad(realProjects(), null)
  if (plan.source !== 'primary') fail('load.sourcePrimary', plan.source)
  if (plan.writable !== true) fail('load.writablePrimary', String(plan.writable))
  if (plan.restoredFromBackup !== false) fail('load.restoredPrimary', String(plan.restoredFromBackup))
  const s = plan.state
  if (s.order.join(',') !== 'layout-a,layout-b') fail('load.order', JSON.stringify(s.order))
  if (s.layouts.length !== 2) fail('load.layoutsFilter', JSON.stringify(s.layouts.map((l) => l.id)))
  if (s.bindings['layout-a'] !== 'session-1') fail('load.bindings', JSON.stringify(s.bindings))
  if (s.folders['layout-a'] !== 'D:\\proj\\a') fail('load.folders', JSON.stringify(s.folders))
  if (s.nameOverrides['layout-a'] !== '改名后') fail('load.nameOverrides', JSON.stringify(s.nameOverrides))
  if (s.hidden.join(',') !== 'layout-h' || s.removed.join(',') !== 'layout-gone') fail('load.hiddenRemoved', JSON.stringify([s.hidden, s.removed]))
  if (!s.views['wt-console']) fail('load.views', JSON.stringify(s.views))
  ok('planProjectsLoad 主键正常')
}

// 2. wipe 场景：主键整个键被删（null）+ 备份有效 → 用备份恢复，且允许继续写
{
  const plan = planProjectsLoad(null, realProjects())
  if (plan.source !== 'backup') fail('load.sourceBackup', plan.source)
  if (plan.restoredFromBackup !== true) fail('load.restoredFlag', String(plan.restoredFromBackup))
  if (plan.writable !== true) fail('load.writableBackup', String(plan.writable))
  if (plan.state.layouts.length !== 2) fail('load.backupLayouts', JSON.stringify(plan.state.layouts.map((l) => l.id)))
  // 空字符串同样视为「没有存档」（localStorage 不会存空串，但防御一下）
  if (planProjectsLoad('', realProjects()).source !== 'backup') fail('load.emptyString', planProjectsLoad('', realProjects()).source)
  ok('planProjectsLoad 主键缺失→备份恢复')
}

// 3. 主键损坏：备份可救则救（restored=true、可写）；备份也不可用 → 默认值 + 本次会话只读（绝不回写覆盖）
{
  const corrupts = ['{"order":[', 'null', '42', '"just a string"']
  for (const bad of corrupts) {
    const rescued = planProjectsLoad(bad, realProjects())
    if (rescued.source !== 'backup' || rescued.restoredFromBackup !== true || rescued.writable !== true) {
      fail('load.corruptRescue', bad + ' -> ' + JSON.stringify({ s: rescued.source, r: rescued.restoredFromBackup, w: rescued.writable }))
    }
    if (rescued.state.layouts.length !== 2) fail('load.corruptRescueLayouts', bad)
    const dead = planProjectsLoad(bad, '{"order":[')
    if (dead.source !== 'default') fail('load.corruptSource', bad + ' -> ' + dead.source)
    if (dead.writable !== false) fail('load.corruptReadonly', bad + ' -> writable=' + String(dead.writable))
    if (dead.state.layouts.length !== 0 || dead.state.order.length !== 0) fail('load.corruptDefaults', JSON.stringify(dead.state))
    // 损坏 + 备份缺失（null）同样只读
    const dead2 = planProjectsLoad(bad, null)
    if (dead2.writable !== false || dead2.source !== 'default') fail('load.corruptNoBackup', JSON.stringify({ s: dead2.source, w: dead2.writable }))
  }
  ok('planProjectsLoad 主键损坏（可救/只读）')
}

// 4. 两边都缺失 = 真·新装：默认值且可写（不能把新装也锁成只读）
{
  const plan = planProjectsLoad(null, null)
  if (plan.source !== 'default') fail('load.freshSource', plan.source)
  if (plan.writable !== true) fail('load.freshWritable', String(plan.writable))
  if (plan.restoredFromBackup !== false) fail('load.freshRestored', String(plan.restoredFromBackup))
  if (plan.state.order.length !== 0 || plan.state.layouts.length !== 0) fail('load.freshDefaults', JSON.stringify(plan.state))
  if (!plan.state.bindings || !plan.state.folders || !plan.state.views) fail('load.freshShape', JSON.stringify(plan.state))
  ok('planProjectsLoad 真·新装')
}

// 5. projectsBackupWrite：可解析的旧主键值才进备份；与现有备份相同不重复写；损坏/缺失返回 null
{
  const raw = realProjects()
  if (projectsBackupWrite(raw, null) !== raw) fail('backup.write', '首次备份应返回该值')
  if (projectsBackupWrite(raw, raw) !== null) fail('backup.same', '备份与主键相同不应重复写')
  if (projectsBackupWrite('{"order":[', null) !== null) fail('backup.corrupt', '损坏的主键值不得进备份')
  if (projectsBackupWrite('null', raw) !== null) fail('backup.nullJson', 'JSON null 不得进备份')
  if (projectsBackupWrite(null, raw) !== null) fail('backup.missing', '主键缺失时无值可备份')
  if (projectsBackupWrite('', raw) !== null) fail('backup.empty', '空串不得进备份')
  // 真实覆盖场景：备份里的旧值可解析、与主键不同 → 应更新备份
  if (projectsBackupWrite(raw, JSON.stringify({ order: [], layouts: [] })) !== raw) fail('backup.replace', '旧备份不同则应更新')
  ok('projectsBackupWrite')
}

// 6. projectsBackupHeal：主键有料而备份缺失/为空/损坏 → 用主键补备份（否则下次清空只会「恢复」出空工作台）
{
  const raw = realProjects()
  const emptyDoc = JSON.stringify({
    order: [], lastUsed: {}, hidden: [], nameOverrides: {}, iconOverrides: {}, removed: [],
    views: {}, shortcuts: [], layouts: [], bindings: {}, folders: {},
  })
  if (projectsBackupHeal(raw, null) !== raw) fail('heal.missing', '备份缺失应补')
  if (projectsBackupHeal(raw, '') !== raw) fail('heal.emptyString', '备份空串应补')
  if (projectsBackupHeal(raw, '{"order":[') !== raw) fail('heal.corrupt', '备份损坏应补')
  if (projectsBackupHeal(raw, emptyDoc) !== raw) fail('heal.emptyBak', '备份是空档（layouts=0）而主键有料时应补')
  if (projectsBackupHeal(raw, raw) !== null) fail('heal.sameRich', '备份已有料 → 不重复写')
  if (projectsBackupHeal(emptyDoc, null) !== null) fail('heal.emptyPrimary', '主键本身是空档 → 不补（避免把空工作台固化成备份）')
  if (projectsBackupHeal('{"order":[', raw) !== null) fail('heal.corruptPrimary', '主键不可解析 → 无值可备份')
  ok('projectsBackupHeal')
}

// 计数自检：新增用例块必须同步改 EXPECTED，用例块缺失时测试必须红
const EXPECTED = 6
if (pass !== EXPECTED) fail('count', '通过数 ' + pass + ' != 预期 ' + EXPECTED + '（有断言块缺失或被跳过？）')
console.log('\nprojects-storage: ' + pass + '/' + EXPECTED + ' passed')
