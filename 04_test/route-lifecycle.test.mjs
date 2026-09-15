// 路由生命周期回归：host 半注册的 HTTP 路由必须随插件行的 fiber 一起注销。
// 背景（2026-09-15）：路由曾以裸 webServer.register(...) 注册，行被禁用后路由泄漏，
// 再次启用命中 "duplicate exact route /api/worktable/health" 而激活失败——
// 表现为「原始模式 → 工作台模式 → 原始模式 → 工作台模式」第二次进不去。
// 用法：node --experimental-test-isolation=none --test 04_test/route-lifecycle.test.mjs [lib/index.js 路径]
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { existsSync } from 'node:fs'

// 缺省评估 01_content 的构建产物（包根在 01_content/，仓库根没有 lib/）。
const DEFAULT_ENTRY = existsSync('01_content/lib/index.js') ? '01_content/lib/index.js' : 'lib/index.js'
const ENTRY = pathToFileURL(resolve(process.argv[2] ?? DEFAULT_ENTRY)).href
const mod = await import(ENTRY)

/** 假宿主：记录注册的路由、effect 与注销调用。 */
function fakeCtx() {
  const routes = []
  const disposed = []
  const effectDisposers = []
  const ctx = {
    logger: { warn() {}, info() {}, error() {}, debug() {} },
    effect(fn, label) {
      const disposer = fn()
      if (typeof disposer === 'function') effectDisposers.push({ label, disposer })
    },
    webServer: {
      register(route) {
        routes.push(route)
        let gone = false
        return () => { if (gone) return; gone = true; disposed.push(route.path) }
      },
    },
    on() {}, inject() {}, get() { return undefined },
  }
  return { ctx, routes, disposed, effectDisposers }
}

test('apply 注册了 /api/worktable/health 在内的 HTTP 路由', () => {
  const h = fakeCtx()
  mod.apply(h.ctx)
  const paths = h.routes.map((r) => r.path)
  assert.ok(paths.includes(mod.HEALTH_PATH), '应注册健康路由: ' + JSON.stringify(paths))
  assert.ok(h.routes.length >= 9, '应注册至少 9 条 HTTP 路由，实际 ' + h.routes.length)
})

test('销毁插件行时全部 HTTP 路由都被注销（这是防重复注册的关键）', () => {
  const h = fakeCtx()
  mod.apply(h.ctx)
  const registered = h.routes.map((r) => r.path).sort()
  assert.ok(h.effectDisposers.length >= 1, '应至少有一个可注销的 effect')
  for (const { disposer } of h.effectDisposers) disposer()
  assert.deepEqual([...h.disposed].sort(), registered, '注销的路径集合必须等于注册的路径集合')
})

test('路由注销是幂等的（重复销毁不抛错、不重复记账）', () => {
  const h = fakeCtx()
  mod.apply(h.ctx)
  for (const { disposer } of h.effectDisposers) { disposer(); disposer() }
  assert.equal(h.disposed.length, h.routes.length)
})