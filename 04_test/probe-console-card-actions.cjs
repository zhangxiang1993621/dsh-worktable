// probe-console-card-actions.cjs — 实机验收：控制室卡片 ⋯ → 重命名 / 切换布局
//
// 前提：dsh web 已重启（客户端 bundle 启动时定版），GUI 在 http://127.0.0.1:3080/。
// 做法：起一个独立 headless Chrome（私有 --user-data-dir），localStorage 与用户浏览器隔离，
//       预置数据不会改用户的工作台状态；CDP 用 Node 22 内置 WebSocket（本仓库无 ws 依赖）。
// 断言链：
//   0) window.__dshWorktable 存在（新 bundle 已加载）
//   1) 侧栏 → 控制室入口卡 → （首次未绑定）强制绑定弹层「加入现有对话」
//   2) 存在一张非 self 项目卡，且卡片上有 ⋯ 按钮
//   3) ⋯ → 菜单恰好两项且顺序 = [重命名, 切换布局]；Esc 能关闭菜单
//   4) 重命名：输入 → Enter → 卡片文本与 localStorage nameOverrides 同步
//   5) 切换布局：预设弹层出现、有高亮当前预设的 data-on 磁贴、选中后该项目的拓扑真的变了
// 输出：`RESULT {...}`；任一步失败抛错并打印 RESULT（含 steps），不吞错。
const http = require('http')
const os = require('os')
const { spawn } = require('child_process')

const PORT = 9387
const GUI = 'http://127.0.0.1:3080/'
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const PROFILE = (process.env.TEMP || os.tmpdir()) + '\\wt-chrome-cardactions'

const proc = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--window-size=1440,900', '--force-device-scale-factor=1',
  '--remote-debugging-port=' + PORT,
  '--user-data-dir=' + PROFILE,
  'about:blank',
], { stdio: 'ignore' })

const getJSON = (p) => new Promise((res, rej) => {
  http.get({ host: '127.0.0.1', port: PORT, path: p }, (r) => {
    let d = ''
    r.on('data', (c) => { d += c })
    r.on('end', () => { try { res(JSON.parse(d)) } catch (e) { rej(e) } })
  }).on('error', rej)
})
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// 预置：控制室未绑定 + 一个用户自建布局项目（保证有非 self 卡片可控）
const SEED = "try{ if(location.origin==='http://127.0.0.1:3080'){"
  + "localStorage.setItem('dsh.worktable.view.v1', JSON.stringify({query:'',searchOpen:false,orderBy:'manual',dock:'footer',floatTop:null,sortMigratedV2:true}));"
  + "localStorage.setItem('dsh.worktable.projects.v1', JSON.stringify({order:['probe-layout'],lastUsed:{},hidden:[],nameOverrides:{},iconOverrides:{},shortcuts:[],"
  + "layouts:[{id:'probe-layout',title:'探针项目',top:null,main:[{id:'p1',title:'窗口1',min:200,content:null}],left:null,"
  + "leftWidth:{default:260,min:160,max:480},chatWidth:{default:360,min:240,max:600},topHeight:{default:200,min:120,max:480},"
  + "topHeightRatio:0.35,chatSide:'right',chatFullHeight:false}],bindings:{},folders:{},views:{},removed:[]}));"
  + "} }catch(e){}"

const IN_PAGE = `(async function(){
  var out = { steps: [] };
  var sleep = function(ms){ return new Promise(function(r){ setTimeout(r, ms); }); };
  var q = function(sel){ return document.querySelector(sel); };
  var qa = function(sel){ return [].slice.call(document.querySelectorAll(sel)); };
  var vis = function(sel){ return qa(sel).filter(function(el){ var r = el.getBoundingClientRect(); return r.height > 0 && r.width > 0; })[0] || null; };
  var click = function(el){ el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); };
  var readProjects = function(){ return JSON.parse(localStorage.getItem('dsh.worktable.projects.v1') || '{}'); };
  if (!window.__dshWorktable) throw new Error('插件未加载：window.__dshWorktable 缺失（bundle 需重启 dsh web 才生效）');
  // 1. 侧栏 + 控制室入口卡
  var rail = q('button[title="Open sidebar"],button[aria-label="Open sidebar"]');
  if (rail) { click(rail); await sleep(1000); }
  var entry = vis('.dsh-wt_projects .dsh-wt_consoleEntry');
  if (!entry) throw new Error('控制室入口卡未找到（侧栏工作台区块未渲染）');
  click(entry); await sleep(900);
  out.steps.push('entryClicked');
  // 2. 首次未绑定 → 强制绑定弹层 → 加入现有对话（不新建会话，避免副作用）
  var bpop = vis('.dsh-wt_consoleBindPop');
  if (bpop) {
    var join = bpop.querySelector('.dsh-wt_consoleBindList .dsh-wt_selectItem');
    if (!join) throw new Error('强制绑定弹层里没有可加入的现有对话');
    click(join); await sleep(1400);
    out.steps.push('boundExisting');
  }
  // 3. 等一张可操作的项目卡（非 self / 非创建卡）
  var pick = function(){ return qa('.dsh-wt_consoleCard').filter(function(el){
    return !el.classList.contains('dsh-wt_consoleCardSelf') && !el.classList.contains('dsh-wt_consoleAdd');
  })[0] || null; };
  var card = pick();
  for (var i = 0; i < 20 && !card; i++) { await sleep(300); card = pick(); }
  if (!card) throw new Error('没有可操作的项目卡片（前置：预置至少一个 layouts 项目）');
  out.projectId = card.getAttribute('data-flip');
  out.cardNameBefore = (card.querySelector('.dsh-wt_consoleName') || {}).textContent;
  var more = card.querySelector('.dsh-wt_consoleCardMore');
  if (!more) throw new Error('⋯ 按钮未渲染');
  // 4. ⋯ → 菜单两项 + Esc 关闭
  click(more); await sleep(300);
  var items = qa('.dsh-wt_cardMenuItem');
  if (items.length !== 2) throw new Error('菜单项数量 = ' + items.length);
  out.menu = items.map(function(b){ return b.textContent; });
  if (out.menu[0] !== '重命名' || out.menu[1] !== '切换布局') throw new Error('菜单文案/顺序不符：' + JSON.stringify(out.menu));
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await sleep(250);
  out.escClosed = qa('.dsh-wt_cardMenuItem').length === 0;
  if (!out.escClosed) throw new Error('Esc 未关闭卡片菜单');
  // 5. 重命名
  click(more); await sleep(300);
  click(qa('.dsh-wt_cardMenuItem')[0]); await sleep(350);
  var input = q('.dsh-wt_renameField input');
  if (!input) throw new Error('改名输入框未渲染');
  var setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(input, '探针改名');
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await sleep(150);
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  await sleep(600);
  var nameAfter = (card.querySelector('.dsh-wt_consoleName') || {}).textContent;
  out.cardNameAfter = nameAfter;
  out.nameOverrides = readProjects().nameOverrides || {};
  if (nameAfter !== '探针改名') throw new Error('卡片名未更新：' + nameAfter);
  out.steps.push('renamed');
  // 6. 切换布局（复用变更视图弹层）
  var specOf = function(){ var a = readProjects().layouts || []; for (var i = 0; i < a.length; i++) if (a[i].id === out.projectId) return a[i]; return null; };
  var s0 = specOf();
  if (!s0) throw new Error('预置布局条目丢失：' + out.projectId);
  var shape = function(s){ return ((s.top || []).length * 100) + s.main.length; };
  out.shapeBefore = shape(s0);
  click(more); await sleep(300);
  click(qa('.dsh-wt_cardMenuItem')[1]); await sleep(500);
  var presets = qa('.dsh-wt_presets .dsh-wt_preset');
  if (presets.length < 2) throw new Error('预设弹层未出现：' + presets.length);
  var onIdx = -1;
  for (var j = 0; j < presets.length; j++) if (presets[j].getAttribute('data-on') === 'true') { onIdx = j; break; }
  out.presetOnIndex = onIdx;
  if (onIdx < 0) throw new Error('没有高亮当前预设的磁贴（data-on）');
  var specIdBefore = specOf().id;
  click(presets[onIdx === 0 ? 1 : 0]);
  await sleep(900);
  var s1 = specOf();
  if (!s1) throw new Error('切换后布局条目丢失：' + out.projectId);
  out.shapeAfter = shape(s1);
  out.specIdPreserved = s1.id === specIdBefore;
  if (out.shapeAfter === out.shapeBefore) throw new Error('布局拓扑未变化：' + out.shapeBefore + ' → ' + out.shapeAfter);
  if (!out.specIdPreserved) throw new Error('切换后项目 id 变了（应保持 ' + specIdBefore + '）');
  out.steps.push('layoutSwitched');
  return out;
})()`

;(async () => {
  let list = null
  for (let i = 0; i < 40; i++) {
    try { list = await getJSON('/json/list'); if (list && list.length) break } catch {}
    await sleep(500)
  }
  if (!list || !list.length) { console.error('PROBE FAIL: 无法连接 headless Chrome'); proc.kill(); process.exit(1) }
  const target = list.find((t) => t.type === 'page') || list[0]
  const ws = new WebSocket(target.webSocketDebuggerUrl)
  let id = 0
  const pending = new Map()
  const send = (method, params) => new Promise((res) => { const mid = ++id; pending.set(mid, res); ws.send(JSON.stringify({ id: mid, method, params })) })
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(String(ev.data))
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) }
  })
  await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej) })
  await send('Runtime.enable')
  await send('Page.enable')
  await send('Page.addScriptToEvaluateOnNewDocument', { source: SEED })
  await send('Page.navigate', { url: GUI })
  const evaluate = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })
    if (r.result && r.result.exceptionDetails) {
      const d = r.result.exceptionDetails
      throw new Error((d.exception && d.exception.description) || d.text)
    }
    return r.result && r.result.result ? r.result.result.value : undefined
  }
  let ready = false
  for (let i = 0; i < 30; i++) { await sleep(1000); ready = await evaluate('!!window.__dshWorktable'); if (ready === true) break }
  if (ready !== true) { console.error('PROBE FAIL: window.__dshWorktable 未就绪（bundle 未重启生效？）'); try { ws.close() } catch {} proc.kill(); process.exit(1) }
  await sleep(1500)
  try {
    const out = await evaluate(IN_PAGE)
    console.log('RESULT ' + JSON.stringify(out))
    console.log('PROBE PASS')
  } catch (e) {
    console.error('PROBE FAIL: ' + (e && e.message ? e.message : String(e)))
    process.exitCode = 1
  } finally {
    try { ws.close() } catch {}
    proc.kill()
  }
})().catch((e) => { console.error('PROBE FAIL', e); try { proc.kill() } catch {} process.exit(1) })
