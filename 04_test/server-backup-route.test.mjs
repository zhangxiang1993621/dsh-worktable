/**
 * 磁盘备份路由回归（评估真实构建产物 lib/index.js；子进程 + 隔离 DSH_HOME，不动真实用户目录）。
 * 用法：node server-backup-route.test.mjs [lib/index.js 路径]
 *
 * 背景（2026-10-14 实测）：Chrome 级源级清空会把 localStorage 里的 projects.v1 与 .bak 一起删掉，
 * 同源备份无法幸免；因此存档另存一份到 DSH_HOME 磁盘。本测试只验服务端这一层的契约：
 *   A. POST 落盘：200 + 返回 file/savedAt/kept，信封 { v:1, name, savedAt, data } 可原样取回
 *   B. GET 取最新：返回最后写入的 data 与 savedAt
 *   C. 轮转上限：连写 7 次 → 目录里只留最近 5 份，GET 仍是最后一份
 *   D. 路径围栏：name 含 ../ 或非法字符 → 400，且不产生越界文件
 *   E. 入参校验：data 非 JSON / 超长 → 400 / 413；缺 name 或 data → 400
 *   F. 无副本：GET → 200 { ok:true, data:null }（不是错误）
 */
import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const BUNDLE_SRC = resolve(process.argv[2] ?? join(HERE, '..', '01_content', 'lib', 'index.js'))
const NAME = 'dsh.worktable.projects.v1'
const KEEP = 5

let pass = 0
const failures = []
const fail = (name, detail) => { failures.push(name + ': ' + detail); console.error('FAIL(' + name + '): ' + detail) }
const ok = (name) => { console.log('ok   ' + name); pass++ }
const projectsJson = (n) => JSON.stringify({ order: [], layouts: Array.from({ length: n }, (_, i) => ({ id: 'l' + i, title: 'P' + i, main: [] })), folders: {}, views: {}, bindings: {} })

/** 在隔离 DSH_HOME 里跑一段驱动脚本；脚本用 mod/routes 现成桩，返回其 console.log 的最后一个 JSON */
function runChild(home, body) {
  const script = [
    "import { pathToFileURL } from 'node:url'",
    "import { readdirSync, existsSync } from 'node:fs'",
    "import { join } from 'node:path'",
    "const mod = await import(pathToFileURL(process.argv[1]).href)",
    "const routes = []",
    "const fakeCtx = { webServer: { register: (r) => { routes.push(r) } }, effect: () => {}, logger: { warn() {}, info() {} }, sessions: {} }",
    "mod.apply(fakeCtx)",
    "const route = routes.find((r) => r.path === '/api/worktable/backup')",
    "const call = async (method, url, payload) => {",
    "  let status = 0, body = ''",
    "  const res = { writeHead(s) { status = s }, end(b) { body = String(b ?? '') } }",
    "  const req = { method, url, headers: {}, async *[Symbol.asyncIterator]() { if (payload !== undefined) yield Buffer.from(JSON.stringify(payload)) } }",
    "  await route.handler(req, res)",
    "  let json = null; try { json = JSON.parse(body) } catch {}",
    "  return { status, body, json }",
    "}",
    "const dir = join(process.env.DSH_HOME, 'worktable-backup', '" + NAME + "')",
    "const list = () => { try { return readdirSync(dir).sort() } catch { return [] } }",
    body,
  ].join('\n')
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', script, BUNDLE_SRC], {
    env: { ...process.env, DSH_HOME: home },
    encoding: 'utf8',
    timeout: 20000,
  })
  if (r.error) { fail('spawn', r.error.message); return null }
  if (r.status !== 0) { fail('child', 'exit=' + r.status + ' stderr=' + (r.stderr || '').slice(0, 400)); return null }
  try { return JSON.parse(r.stdout.trim().split('\n').pop()) } catch (e) { fail('child.output', (r.stdout || '').slice(0, 300)); return null }
}

function withHome(fn) {
  const home = mkdtempSync(join(tmpdir(), 'wt-backup-test-'))
  try { return fn(home) } finally { rmSync(home, { recursive: true, force: true }) }
}

// —— A+B. POST 落盘 + GET 取最新 ——
withHome((home) => {
  const data = projectsJson(3)
  const out = runChild(home, [
    `const a = await call('POST', '/api/worktable/backup', { name: ${JSON.stringify(NAME)}, data: ${JSON.stringify(data)} })`,
    `const b = await call('GET', '/api/worktable/backup?name=' + encodeURIComponent(${JSON.stringify(NAME)}))`,
    "console.log(JSON.stringify({ a, b, files: list(), dirExists: existsSync(dir), escaped: existsSync(join(process.env.DSH_HOME, 'evil')) }))",
  ].join('\n'))
  if (!out) return
  if (out.a.status !== 200 || !out.a.json || out.a.json.ok !== true) fail('A.post', JSON.stringify(out.a).slice(0, 200))
  if (!out.dirExists || (out.files || []).length !== 1) fail('A.file', 'files=' + JSON.stringify(out.files) + ' dirExists=' + out.dirExists)
  if (typeof out.a.json?.savedAt !== 'number' || out.a.json?.kept !== 1) fail('A.meta', JSON.stringify(out.a.json))
  if (out.b.status !== 200 || out.b.json?.data !== data) fail('B.get', JSON.stringify(out.b).slice(0, 200))
  if (out.b.json?.savedAt !== out.a.json?.savedAt) fail('B.savedAt', 'GET 与 POST 的 savedAt 不一致')
  ok('POST 落盘 + GET 取最新（信封带 savedAt/kept）')
})

// —— C. 轮转上限 5 ——
withHome((home) => {
  const out = runChild(home, [
    "let last = null",
    "for (let i = 1; i <= 7; i++) {",
    "  const d = JSON.stringify({ order: [], layouts: Array.from({ length: i }, (_, k) => ({ id: 'l' + k, title: 'P' + k, main: [] })), folders: {}, views: {}, bindings: {} })",
    `  last = await call('POST', '/api/worktable/backup', { name: ${JSON.stringify(NAME)}, data: d })`,
    "}",
    `const g = await call('GET', '/api/worktable/backup?name=' + encodeURIComponent(${JSON.stringify(NAME)}))`,
    "console.log(JSON.stringify({ lastStatus: last.status, files: list(), gotLayouts: (JSON.parse(g.json.data).layouts || []).length }))",
  ].join('\n'))
  if (!out) return
  if ((out.files || []).length !== KEEP) fail('C.rotate', '目录应留 ' + KEEP + ' 份，实际 ' + JSON.stringify(out.files))
  if (out.lastStatus !== 200) fail('C.post', String(out.lastStatus))
  if (out.gotLayouts !== 7) fail('C.newest', 'GET 应取到最后一次（7 个布局），实际 ' + out.gotLayouts)
  ok('轮转上限：连写 7 次只留最近 5 份，GET 仍是最后一份（同毫秒写入不互相覆盖）')
})

// —— D+E+F. 围栏与校验 ——
withHome((home) => {
  const data = projectsJson(2)
  const out = runChild(home, [
    `const bad1 = await call('POST', '/api/worktable/backup', { name: '../evil', data: ${JSON.stringify(data)} })`,
    `const bad2 = await call('POST', '/api/worktable/backup', { name: 'a/b', data: ${JSON.stringify(data)} })`,
    `const bad3 = await call('POST', '/api/worktable/backup', { name: ${JSON.stringify(NAME)}, data: '{"order":[' })`,
    `const big = 'x'.repeat(1.5 * 1024 * 1024)`,
    `const bad4 = await call('POST', '/api/worktable/backup', { name: ${JSON.stringify(NAME)}, data: big })`,
    `const bad5 = await call('POST', '/api/worktable/backup', { data: ${JSON.stringify(data)} })`,
    `const bad6 = await call('POST', '/api/worktable/backup', { name: ${JSON.stringify(NAME)} })`,
    `const empty = await call('GET', '/api/worktable/backup?name=nomatch.v1')`,
    "console.log(JSON.stringify({ bad1, bad2, bad3, bad4, bad5, bad6, empty, files: list(), dirExists: existsSync(dir), evil: existsSync(join(process.env.DSH_HOME, 'evil')) }))",
  ].join('\n'))
  if (!out) return
  if (out.bad1.status !== 400 || out.bad2.status !== 400) fail('D.fence', 'bad1=' + out.bad1.status + ' bad2=' + out.bad2.status)
  if (out.evil || out.dirExists) fail('D.leak', 'evil=' + out.evil + ' dirExists=' + out.dirExists)
  if (out.bad3.status !== 400) fail('E.corrupt', String(out.bad3.status))
  if (out.bad4.status !== 413) fail('E.oversize', String(out.bad4.status))
  if (out.bad5.status !== 400 || out.bad6.status !== 400) fail('E.missing', 'bad5=' + out.bad5.status + ' bad6=' + out.bad6.status)
  if (out.empty.status !== 200 || out.empty.json?.data !== null) fail('F.empty', JSON.stringify(out.empty).slice(0, 160))
  ok('路径围栏（../ 与 / → 400 且不落盘）+ 入参校验（非 JSON 400 / 超长 413 / 缺字段 400）+ 无副本返回 data:null')
})

if (failures.length) {
  console.error('\nserver-backup-route: ' + failures.length + ' 项失败')
  process.exitCode = 1
} else {
  console.log('\nserver-backup-route: ' + pass + ' 组场景全部通过')
}
