# dsh-worktable 项目规则

> 工作台容器插件：侧边栏里收纳 agent 级项目的「应用抽屉」。纯增量，不替换官方插件。

## 协作方式（用户定案，最高优先级）

> 与全局 `~/.dsh/AGENTS.md` 同步；外部 Agent（如 Codex）不加载全局文件，故此处保留全文。

- **设计先给最小版**：任何 UI/文案/方案先交「最少元素」版本给用户拍板，确认后再增量；
  默认克制——没有存在理由的元素不放；不一次搭「完整版」再返工。
- **长任务拆 checkpoint**：每个可验收阶段完成后停下汇报，等用户确认再进下一段；
  不一口气跑完长任务。
- **对外动作永远先审**：发布、评论、给观众的内容、任何公开操作，一律先给用户过目，
  用户不点头不执行。
- **改完必读回**：每次编辑后读回改动处的完整行/段落，确认无残留、无断尾
  （教训：改一半的 URL 留下旧尾巴，被复审抓为发布阻断）。
- **验收用最终产物，不用中间信号**：任何交付物（tgz、命令、文档、UI）的验收动作必须是
  「解包 / 复制 / 实跑用户路径」；「构建成功」「bundle 里有字符串」「退出码 0」不算验收。
- **发布前自跑最终产物清单**：干净目录安装、最终包逐文件核对、双资产哈希、关键行逐字
  grep —— 先自查再报告，不等外部复审来抓。
- **发布包验收=结构检查 + 真实安装**：标准 package/ 前缀、白名单精确 7 文件（无 src/、.map），
  再独立目录 npm install + import() 断言；仅核对文件存在不能证明包可安装。
- **声明可证伪，不许写满**：验收结论只写已验证范围。「通知全覆盖」「等价端到端」这类表述会被
  反向检查打脸——只写「版本比较逻辑上重新激活」「验证了安装与服务端模块导入」。
- **同 tag 资产不可覆盖（用户已拍板）**：坏包处理 = 发新版本号 + 旧 Release 正文标注问题，
  默认不替换旧资产；仅经用户明确批准的紧急补救例外，且须：不改名（保持原 URL 名）、
  用已验证包、不删不盖现有资产、上传后从完整 URL 下载核对、旧 Release 注明补救经过。

## 边界

- 插件包根目录 = `01_content/`；本仓库其余目录是项目文档与本地工具。
- **不替换、不禁用任何官方插件**（ui-sidebar / ui-workspace / ui-layout）。
- 项目/布局/绑定存 localStorage，媒体存 IndexedDB；文件窗、mkdir 与产物握手会读写用户配置的项目目录，权限边界见 `01_content/README.md`。
- dsh-travelatlas 是入驻项目而非本仓库的一部分；协议见 `02_process/PRD.md` §5.3/5.4。
- **平台边界**：Windows 网页端已测范围见 `01_content/README.md`，不宣称全功能验收；桌面仅列已测 Windows 0.2.0-rc.2 范围；macOS 为实验性支持（核心文件路径代码已做跨平台适配，
  尚未真机端到端验证）。路径拼接必须走 `pathutil.ts` helper 或 Node `path` API，不手写分隔符。

## 构建与验证

```powershell
cd 01_content
npm install
npm run build     # lib/index.js + lib/client.js
node --check lib/index.js
```

- 客户端 bundle 必须保持 `window.__ModuleLoader__.load` 握手与 external react/@deepseek-ai/*。
- 变更视图状态结构时同步更新 PRD 的持久化说明。
- **构建必须 `cd 01_content` 后执行**：误在仓库根跑会把 lib 写到仓库根 `lib/`，宿主仍加载
  `01_content/lib` 旧 bundle，出现「改完不生效」假象（已有教训，见工作日志）。
- **禁止用 PowerShell 文本管道改 `lib/*.js`**：`Get-Content -Raw` + `Set-Content/WriteAllText`
  这类往返会把 UTF-8 中文写成乱码（本机实测：markdown-it 内联源码里的 `…` 被写成 `鈥?`，
  正则闭合斜杠被吞，bundle 直接 `node --check` 失败）。要改产物只能 `npm run build` 重建；
  应急用 `Copy-Item` 字节级还原备份。构建后必跑 `node --check lib/client.js`。
- **发布打包唯一入口 = `npm run pack`（01_content/release-prep.mjs）**：身份断言（package/manifest/cordis.patch.yml 严格结构）→
  版本一致性 → **会话/输入/传输/挂载回归**（test:input / test:session / test:details / test:transport / test:widget 共 98 项，评估源码契约）→ 构建（cwd 固定 01_content）→ node --check → npm pack → 结构清单断言（package/ 前缀 + 精确 7 文件，
  无 src/、无 .map）→ 独立临时目录 npm install + import() 断言（apply 函数/inject 含 webServer+sessions/name/
  HEALTH_PATH/包内双 bundle 版本）→ **客户端工厂求值门禁**（ModuleLoader 恰好注册一次 + ID 校验 + 精确外部依赖
  白名单 react/react/jsx-runtime + apply/inject 断言）→ **分栏锚点 DOM 回归**（8 场景，评估安装产物 lib/client.js；
  测试接受包路径参数）→ **主视图会话切换兼容回归**（5 场景：0.1.6 uiWorkspace / 老宿主 sessions.open / 两通道优先级 / 无通道静默 / pickProjectSession 四判）→ **窗格恢复回归**（3 场景：关闭留档 / 原样恢复 + 未命中无操作 / 活通道闭环）→ **项目会话联动回归**（6 例：列表过滤 / 决策三分支 / 并发去重 / 失败静默；评估安装产物 lib/client.js）→ **项目存档防丢失回归**（10 例：主键正常 / 主键缺失→备份恢复 / 主键损坏可救与只读 / 真·新装 / 备份写入决策 / 备份自愈 / 磁盘副本采纳判定 / 备份响应解析 / 备份传输契约 / 磁盘推送门控；评估安装产物 lib/client.js）→ **磁盘备份路由回归**（3 组场景：落盘+取最新 / 轮转 5 份 / 路径围栏与入参校验；评估安装产物 lib/index.js）→ **服务端数据目录回归**（3 组场景，评估安装产物 lib/index.js）→ dist/v版本号/ 双资产（终态恰好 2 文件 + 双 SHA 同源）。
  脚本零 git/gh 动作，发布上传由 gh 手动完成。
  **发布禁止裸 npm pack 或手工 tar 生成发布包**；脚本从仓库任意目录调用均安全（以自身位置解析）。
- **配套检查入口**：`npm run test:gate` = 工厂门禁 10 个失败/正向用例；
  `npm run test:widget` = 项目/会话归属、共目录、延迟结果与补挂重试 26 项回归（执行实际函数，不等于模型生成端到端验收）；
  `node 04_test/anchor-dom.test.mjs [lib/client.js 路径]` = 分栏锚点 8 场景（缺省用工作目录构建产物）；
  `node 04_test/session-switch-compat.test.mjs [lib/client.js 路径]` = 主视图会话切换 5 场景
  （0.1.6 无 sessions.open → uiWorkspace；老宿主回落 sessions.open；两通道优先级；无通道静默；
  pickProjectSession 绑定优先 / 同目录工作区第一个对话 / 跳过归档与子代理 / 无匹配不切换）；
`node 04_test/pane-restore.test.mjs [lib/client.js 路径]` = 窗格恢复 3 场景
（closeTab 留档 / restoreClosedTab 原样放回 + 未命中无操作 / 活通道闭环）；
  `node 04_test/server-home.test.mjs [lib/index.js 路径]` = 数据目录解析 3 组场景（子进程隔离夹具；
  **突变体验证法**：把 loadPkg 兜底的 baseDshHome() 故意改回 resolveDshHomeSafe() 恢复循环，测试必须红）；
  `node 04_test/console-card-actions.test.mjs [lib/client.js 路径]` = 控制室卡片动作 4 场景
  （renameOverride 覆盖语义 / popoverPos 钳制 / collectTabs 顺序与过滤 / migrateTabsInto 迁入与溢出）。
  `node 04_test/project-sessions.test.mjs [lib/client.js 路径]` = 项目会话联动 6 例
  （列表过滤（归档/子代理/悬空/去重/trim）/ 弹层模型（占位/打勾/补行）/ 打开决策三分支 / 未载入语义 pin /
  并发去重与 key 作用域 / 失败静默与 open 抛错静默）。
  `node 04_test/projects-storage.test.mjs [lib/client.js 路径]` = 项目存档防丢失 10 例
  （主键正常 / 主键缺失→备份恢复 / 主键损坏（可救 & 只读）/ 真·新装 / 备份写入决策 / 备份自愈 /
  磁盘副本采纳判定 planBackupAdoption / 备份响应解析 parseBackupEnvelope / 备份传输契约（桩 fetch）/
  磁盘推送门控 planDiskPush）。
  `node 04_test/server-backup-route.test.mjs [lib/index.js 路径]` = 磁盘备份路由 3 组场景（子进程隔离 DSH_HOME；
  落盘 + 取最新 / 轮转只留 5 份（同毫秒写入不互相覆盖）/ 路径围栏（../ 与 / → 400 不落盘）+ 入参校验（非 JSON 400、超长 413、缺字段 400）+ 无副本返回 data:null）。
  `npm run verify:remote -- --expect-sha <release-prep 输出的 SHA> [tag]` = 发布后只读核对
  （远端固定名+版本化双资产文件名/结构/版本/双 SHA 同源且等于本地验收 SHA/安装/导入；
  远端只读，本地仅临时目录）。上传后必须跑 verify:remote 并用 --expect-sha 比对，
  防「双资产同错」；tag 模式断言 tag==='v'+包内版本。

## 领域约定（会话中必须遵守）

| 实现参考 | 对应材料 |
| --- | --- |
| 控制室 UI、预设/模型、提醒、产物握手、更新状态 | `02_process/PRD.md` §14（修改对应组件时对照源码，不以历史 API 示例替代新旧桥接） |

- **Desktop 兼容边界**：0.4.0 保留客户端 platform=web（Desktop 0.2.0-rc.2 也按此契约加载）。终端 WebSocket 经 `hostTransport.ts` 使用宿主 `__DSH_TRANSPORT__.streamBaseUrl`，不能由 dsh-app://app 拼 ws://app；更新提示须指向 desktop profile 与桌面端自带 CLI，不能修改 web profile。页面点测与源码回归不能替代完整桌面端业务验收，不宣称桌面全功能兼容。
- **0.3.4 网页端兼容**：声明已测版本 0.1.1-rc.2 / 0.1.2-rc.1 / 0.2.0-rc.2 / **0.2.1-alpha.2**（2026-10-14 实测：插件在 0.2.1-alpha.2 宿主上完整加载、侧栏 4 张项目卡渲染、宿主路由 200、磁盘备份写入/读回/灾难演练恢复闭环；**仅此范围，不等于全功能验收**），不外推 Desktop 或未测宿主。当前会话走 `currentSessionOf`（旧 current / 新 mainView），导航走 `openHostSession`（新 uiWorkspace / 旧 sessions.open），标注走 `appendHostInput`。Cordis 可选服务用 `ctx.get` 探测；返回 undefined 后不得再访问未 inject 的同名属性。旧 current 契约的引用坐标是显示文本位置，新 mainView 契约按单字符 chip 投影；不得因旧版也有 input.for 就误用新版坐标。`npm run test:input` 为 15 项定向回归。
- **0.2 会话状态/发送**：可选订阅 `uiSession.sessionStatus`，只读归一化列表与 subagentCatalog；completionUnread 不是任务成功证明，打开主会话会清除。已观察到的 running→false 供原产物握手使用，下一轮 running 清除；停止不等于成功。新会话发送通过 `sessions.using` 临时持有，等待 ready 后发送并由宿主释放；业务拒绝/超时不得再换通道重发。`npm run test:session` 为 20 项回归；0.2.0-rc.2 已实测短文本发送/回复，真实待决/子代理仍未验收。
- **0.2 新建/预览/选择接口**：`createHostSession` 必须区分显式未分组（第四参数 `none`）与隐式默认（`auto`）。自定义窗口显式未分组仅传 cwd（无目录则空选项），禁止注册/复用工作区或 initializeDefault；新版控制室空未分组会话输入区禁用，必须提示并阻止创建，由用户选组/加入可用现有会话，不偷偷改组、不发激活消息。现有分组未选 ID 同样拒绝；显式现有/新建组才传 workspaceId。分组列表晚返回不得覆盖用户已选分组。隐式默认保留此前工作区兜底，旧宿主保留原分支，不移动既有会话。预览读临时持有的 eventSource，模型目录在持有期间使用，结束即释放；预设接 remote.agentPresets。`npm run test:details` 为 30 项回归，含两处真实调用接线与延迟默认分组；不能替代真实输入区/模型会话验收。

- **窗口编号**：用户说「窗口1/2/3…」指布局里按「左栏 → 顶行 → 主行」顺序的第 N 个内容窗。
  例：田字格预设（g4）窗口1/2 = 顶行左右、窗口3/4 = 底行左右；l13 窗口1 = 顶部大窗，
  窗口2/3/4 = 底部三小窗（从左到右）。需要定位时按此映射，不要凭猜测。
- **预设追加规则**：新布局预设只允许追加到 `PRESET_DEFS` 末尾（选择器里的「＋自定义」磁贴
  永远是最后一个）；字段 leftCount/topCount/contentCount/chatFull/topHeightDefault/topHeightRatio，
  聊天窗恒在右侧；缩略图在 presetThumb() 加分支。
- **分栏引擎双版本锚点（v0.3.3 兼容契约，0.1.1-rc.2 与 0.1.2-rc.1）**：会话根三种结构——
  0.1.1 active = [头部, 滚动区]；空会话 hero = [隐藏头部(headerHidden), 内容区]；0.1.2 无会话
  hero = [内容区]（单子元素）。resolveAnchor：仅「存在第二个子元素」且第一个可见（自身有高度，
  或零高槽位包装内第一个可见后代——visibleHeaderIn）才作头部；否则顶部取根顶部。phase 排序
  active > hero > settling，settling 等待不关闭。**同根重锚（hero↔active）只在锚点元素真正
  更换时才更新 saved 原值**，否则关闭时泄漏已应用的 margin/宽度变量。改锚点必须跑
  anchor-dom 8 场景（含 H：0.1.2 零高包装+内部头部）。0.1.2 的 children[0] 是 display:contents
  式零高包装、真实标题栏在内部——不要凭 0.1.1 的结构想当然。
- **数据目录解析无循环（v0.3.3 红线）**：resolveDshHomeSafe = 官方 @deepseek-ai/dsh-home-paths
  （可用时）→ baseDshHome 兜底；**loadPkg 的 profiles 兜底只能用 baseDshHome，禁止回调
  resolveDshHomeSafe（会成环）**。baseDshHome 规则对齐官方：DSH_HOME 优先、空/纯空白视为未设、
  ~ 与 ~/ 与 ~\ 展开、相对路径按 cwd、默认 ~/.dsh；trim 只用于空白判断、路径保留原字符串。
  **不把 dsh-home-paths 声明为生产依赖**（其 peer cordis ^4.0.2 不满足 0.1.1-rc.2 的 4.0.1，
  已试过并撤回）。改这块必须跑 server-home 3 组场景 + 突变体验证（恢复循环测试必须红）。
- **新会话预设修复**：新建会话（createCustomSession / bindConsoleNew）创建后调用
  ensureSessionPreset——用宿主 api.agentPresets.list/select 显式应用「部署默认预设」
  （isDefault ?? 首个，失败逐个尝试其余预设；select 仅对 blank 会话生效）。
- **新会话模型修复（真根因）**：会话级模型选择独立于预设、随默认选择持久化——用户删掉
  provider 后新会话继承失效选择，prompt 报 model-unavailable。ensureSessionModel：
  ① 无条件继承「当前会话」正在用的模型（用户控制用哪个就用哪个，相同则跳过）；
  ② 无当前会话且新会话不可用时 → 最近会话众数 → 失效选择的家族词匹配 → 目录首个。
  session.selectModel 同时把新选择存为默认（继承的 Pro 会写回默认）。失败静默、缺 API 跳过。
- **对话绑定**：projects.v1.bindings = { 项目id → 会话id }；打开项目时引擎自动
  切换主视图会话到**归属对话**（openSplit / DOM 桥 / 收起态图标 / 控制室 onOpen 四处入口）；
  归属对话 = 显式绑定优先；**未绑定 = 项目文件夹「同目录」工作区的第一个可用对话**
  （`pickProjectSession` + `normProjectFolder` 纯函数：按工作区 sessionIds 顺序取第一个，
  跳过归档与子代理，优先已载入会话；找不到同目录工作区 = 不切换）。自动解析**不写盘**
  （保持未绑定语义，每次打开重解析；要固定请显式绑定）。回归：
  `node 04_test/session-switch-compat.test.mjs`（第 5 例）。
  **会话切换统一走上游 sessionCompat（2026-10-14 合并定案）**：新增/切换主视图一律经 `openHostSession(ctx, sessions, id)`（新宿主 uiWorkspace / 老宿主 sessions.open 都在里面）、`currentSessionOf(snapshot)`（0.1 的 list.current / 0.2 的 mainView）、`sendHostSession`（0.2 临时持有发送）。本地保留的 `openMainSession`/`currentMainSessionId` 只是薄壳（旧调用点不改名），**不得再新增自研通道**。回归：`node 04_test/session-compat.test.mjs` + `node 04_test/session-switch-compat.test.mjs`。
- **项目×对话联动**：打开项目记录「打开前会话」（projectAttachRef.sessionId）；项目打开期间切到
  非绑定会话 = 自动关项目（suppressRestoreRef 跳过回切）；✕/反选关项目 = 回切「打开前会话」。
  未绑定项目的归属会话 = 打开前会话。
  **例外**：插件自身发起的会话切换（新建对话 sessions.open(新会话)、发送到会话）不得触发
  自动关项目——createCustomSession/sendCustomToSession 用 markPluginSessionOpen 豁免
  （pluginOpenedSessionsRef），用户要继续在项目里跟新对话沟通；同时 CustomPane 在发送成功后
  调用 autoBind：项目未绑定则自动绑定到新建/选中的会话。
- **项目会话联动**：切项目时归属对话解析顺序 = 绑定 → 项目文件夹「同目录」第一个可用会话 →
  （都没有且项目已设文件夹）**兜底自动新建**：宿主有该文件夹的同目录工作区且 `uiWorkspace.connectWorkspace`
  可用 → `connectWorkspace(wsId)`（宿主语义：复用该工作区空会话/新建，返回 sessionId 且**不切主视图**）；
  否则回落 `sessions.create({cwd: 项目文件夹})`。两条通道都：`afterSessionCreated`（mark 豁免 + 可选绑定）→
  `ensureSessionPreset` → `ensureSessionModel`，**都不切主视图**；切换统一由调用方的
  `applyProjectOpen(io.open)` 完成（先同步 `projectAttachRef.attached` 再切，避免"切换早于 attached"
  与双重切换）。**兜底自动新建不写绑定**（保持「未绑定 =
  每次重解析」），并发去重走模块级单例 `projectCreateInFlight`，失败静默为 `'failed'`（不抛给调用方，
  `io.open` 抛错同样静默）。**不要读 `uiWorkspace.selection` 当"新建会话 id"**：它是宿主私有字段，
  superseded 时会拿到"当前选择"（0.1.7-rc.1 已踩过：假 created + 抢主视图）。
  分栏标题栏「💬 会话」（非控制室、项目已设文件夹才渲染）= 本项目会话列表（同目录工作区顺序，跳过归档/
  子代理/悬空；当前项打勾，未命中时补只读「当前：…」行）+「＋ 新建会话」；点会话 = 切换并豁免
  「切会话关项目」（markPluginSessionOpen），点新建 = **自动绑定**该项目（分层绑定语义）。
  数据与动作经 `env.projectSessions`（hasFolder/list/current/open/create/subscribe）注入，引擎不含业务；
  `subscribe` 仅在弹层打开期间挂到 `consoleListeners`（保活池里的隐藏层不订阅）。纯逻辑
  `listProjectSessions` / `sessionsMenuModel` / `decideProjectOpen` / `applyProjectOpen` 经
  `window.__dshWorktable` 导出。回归：`node 04_test/project-sessions.test.mjs`（6 例，已挂 release-prep 5c5）。
  未载入语义（**pin 住，别改**）：`decideProjectOpen` 对"工作区存在但全未载入"返回 `{action:'open', id: ids[0]}`、
  绑定到未知 id 仍返回该绑定；菜单侧才按"悬空 = 不显示"过滤。
- **项目存档防丢失（2026-09-29 实测事故，红线）**：浏览器级「清除浏览数据」会把整个源的
  localStorage 一起删掉（实测一次批量删了 ~30 个源 / 338 条记录，含 `dsh.worktable.projects.v1`、
  `split.v2`、`mountedWidget.v1` —— 同一批次连续 seq，任何单页脚本都做不到跨源删除，故不是插件行为）。
  旧实现把"读不到存档"当"新装"，挂载后的自愈/持久化立刻回写默认值 → 项目列表只剩内置控制室且旧值不可逆。
  现在的契约：
  ① 每次写主键前，把「上一份**可解析**的旧值」留档到 `dsh.worktable.projects.v1.bak`
  （`projectsBackupWrite`：损坏值不备份、与现有备份相同不重复写）；
  ② 载入走 `planProjectsLoad`（纯函数）：主键可用 → 用主键；主键**缺失或损坏**但备份可用 → 用备份，
  立即写回主键 + 渲染一行可关闭提示（`recover.notice`）；主键缺失且无备份 → 默认值（真·新装，可写）；
  主键损坏且无备份 → 默认值 + **本会话只读（writable=false），绝不回写**；
  ③ 只读模式只 `console.warn` 一次，改动仅留在内存（宁可本次不落盘，也不覆盖可能可恢复的数据）；
  ④ 备份自愈（`projectsBackupHeal`）：挂载时若「主键有料（layouts>0）而备份缺失/空档/损坏」，
  立即把主键补进备份 —— 覆盖「手工把存档恢复回主键后，备份仍停在空档」这种情形，
  否则下一次清空只会从空备份「恢复」出空工作台；主键本身是空档时不补（不把空工作台固化）。
  回归：`node 04_test/projects-storage.test.mjs`（10 例，已挂 release-prep 5c6；磁盘副本 4 例随 5c7 一并跑）；
  突变实证：把 `planProjectsLoad` 损坏分支的 `writable` 改成 `true`，测试必须翻红。
- **磁盘备份（2026-10-14 根治，红线）**：**同源备份救不了源级清空**——`projects.v1` 与 `.bak` 同在
  127.0.0.1:3080 这一个源里，一次「清除浏览数据」会把两者一起删掉（2026-10-14 实测：主键与 .bak 双双成空档，
  LevelDB 里 split.v2/view.v1/mountedWidget.v1 全是删除墓碑；9/29 那次同型）。所以每次落盘后再推一份到**宿主磁盘**：
  ① 宿主路由 `GET/POST /api/worktable/backup`（`src/index.ts`）把信封 `{ v, name, savedAt, data }` 写到
  `<DSH_HOME>/worktable-backup/<name>/<savedAt>-<rand>.json`，**保留最近 5 份**；name 只允许
  `[A-Za-z0-9._-]{1,80}`（防路径穿越）、body 上限 1MB（超限 413）、data 必须是 JSON 对象（否则 400）；
  ② 客户端（`src/client/backupSync.ts`）在 persist 后**防抖 2.5s 推送**（同内容去重、失败静默，不影响本地落盘）；
  **推送门控 `planDiskPush`：空档只有来源权威（primary/backup）时才推** —— 主键缺失时启动自愈会 persist 一次
  默认空档，若推上去就成了"最新一份"、把有料副本顶掉（2026-10-14 演练实测），故 source='default' 的空档一律不推；
  用户主动删光项目时来源是 primary → 空档照推，下次不会被复活；
  ③ 载入时 `planBackupAdoption` 判定：**只有本地比磁盘副本更空（remote.layouts > local.layouts）才采纳**，
  采纳后写回主键 + `.bak`、把本会话来源改记为权威、复用 `recover.notice` 提示；远端为空/缺失/更少一律不动；
  ④ 只备份 `projects.v1` 这一层（项目 + 布局 + 文件夹 + 绑定），不备份 split.v2/view.v1（纯视图几何）。
  回归：`node 04_test/server-backup-route.test.mjs`（3 组场景，已挂 release-prep 5c7）+ projects-storage 第 7-10 例；
  **宿主半新增路由，生效需重启 dsh web**。
- **项目文件夹**：projects.v1.folders = { 项目id → 绝对路径 }；新建项目强制填写（父目录必填，
  文件夹名留空 = 用项目名），保存时走 /api/worktable/mkdir 建目录；绑定面板可改。自定义窗口
  新建会话（未选分组时）用 sessions.create({cwd: 项目文件夹})，提示词携带文件夹与「所有产出
  放进该文件夹」指令——用户要求项目产出文件不得落到默认位置。
- **窗口任务提示词**：buildWindowTaskText 统一组装（窗口身份「项目+窗口N」+ 项目文件夹 +
  插件知识包）；知识包注明「不要重新侦察插件源码」，改提示词时保持这个原则。
- **产物自动挂载 v2（2026-10-14 合并上游 v0.4.0 握手）**：`prepareWidgetTask` 生成 `WidgetBinding`（projectId/paneId/bindingId/window），窗口任务提示词第 6 条要求 agent 把结果写到 `widgetManifestPath(binding)` 指向的文件（内容含 version/projectId/paneId/bindingId/path/kind）；客户端经 `widgetRegistry` 归属校验后才挂载：项目没开着记入 `pendingMountRef`（localStorage `dsh.worktable.pendingMount.v2`），下次打开重读复验；成功才清待办，失败保留重试。**锁死语义**：挂载用 splitStore.lockPane——清空该窗格原有标签，把产物作为唯一固定标签（active 0），onSpecMutated 立即持久化。**禁止按文件夹认项目、禁止扫旧根清单、禁止回退窗口1**（`widgetMount.ts` 校验）。
- **窗格内容恢复（v0.3.4）**：标签 ✕ 关闭时 closeTab 把原标签（原 id/标题/内容）压入该窗格
  `closedTabs`（≤5、最近在前、随 spec 持久化）→ 标签关空后选择器顶部渲染「↩ 恢复：<标题>」
  （最多 3 条）→ restoreClosedTab 原样放回并移出历史。**无操作必须是真无操作**：窗格变更统一走
  `mutatePane`（窗格不存在或返回同一对象 = null），否则「未命中历史」也会触发 onSpecMutated/persist。
 非 AI 类标签（网址/终端/文件夹）只在关闭后可从历史恢复。
  回归：`node 04_test/pane-restore.test.mjs`。


- **原生皮肤模板**：01_content/template/dshell.css + dshell.html（esbuild text loader 嵌入服务端
  bundle，/api/worktable/template 路由下发）；知识包要求产出 HTML 一律引用该样式表，组件类
  参考模板。新增组件样式只加到 dshell.css，保持单一来源。
- **新会话策略**：创建后应用默认预设与有效模型；桥接保持原选择策略，持有结束即释放。失败不重复发送；插件导航须 markPluginSessionOpen，未绑定项目成功任务会 autoBind。
- **项目文件夹**：保存要求绝对路径，mkdir 非 2xx 必须中止；自定义任务带项目 cwd，产出落该目录。
- **窗口任务**：buildWindowTaskText 统一携带窗口身份/项目目录/通用知识；不重复侦察插件源码。
- **产物握手 v2**：目录不是项目身份。`widgetMount.ts` 校验 projectId/paneId/bindingId，禁止扫旧根清单或回退窗口1。提示词与完成读取限本会话；补挂重读并复验归属，成功后才清待办。手工关闭/替换撤销关联，追改可复用，完成不证明成功。协议见 PRD §14。
- **原生皮肤**：template/dshell.css + dshell.html 为单一来源，经 /api/worktable/template 下发；新增样式只加模板。
- **提示词零泄漏（硬约束）**：所有对外生成的提示词（buildWindowTaskText 窗口任务提示词、
  buildCustomLayoutPrompt 剪贴板布局提示词）禁止写入用户的个人工作区分组名（如 Projects /
  DeepseekHarness）、其他用户的项目名与私人路径。剪贴板提示词会发给别人的 DSH，必须只含
  插件通用知识；窗口任务提示词只发用户自己的会话，允许携带该项目自己的文件夹路径。
  分组下拉只是会话创建工作区的选择，绝不进入任何提示词文本。
- **任务完成/待决提醒镜像**：绑定会话在宿主快照 byId 里 completed=true → 项目卡双圆点变
  绿色发光（data-bound=done）；pendingInteraction != null → 黄色发光（data-bound=need）；
  点开项目 = ack（notifyAck.v1 按会话存状态）恢复常态实心。数据源 = sessionsSnapshotStore
  （syncSessionScope 写入完整快照并通知监听者）；跨状态（done↔need）会重新点亮。
  **工作中（busy）**：byId[sid].running === true → data-bound=busy，蓝色 #4f8ef7 发光 +
  dsh-wt-busyA/B 关键帧两圆交替亮灭（对应 DSH 转圈标记）；优先级 need > done > busy——等待判断时 pendingInteraction 与 running 同时为真，
  原生 UI 以黄点优先，镜像必须一致；busy 无需 ack，running 变 false 自动切换。
  **子代理聚合**：待决状态常挂在子代理会话上（父会话只有 running）——bindNotifyMap 用
  collectKids（byId.parentId + subagentsByParent 双通道）聚合父会话及其子代理的 pending；
  会话面 binding(id).session.getSnapshot().pending 非空也判 need（列表不映射时的兜底）；
  ackProjectNotify 同步 ack 子代理。
  **ack 生命周期**：ack 只在「同一轮待决未解决」期间压制提醒；状态转移（needNow 真↔假）时
  clearNotifyAck 自动清除旧 ack——原生 UI 每个新问题都重新亮黄，镜像必须同样重新点亮。
- **「工作台」控制室项目（默认自带）**：
  - 固定 id `wt-console`（CONSOLE_ID），卡片恒排项目列表第一位（order 0）、不可删除
    （不进设置管理列表 + removeProject 兜底拒绝）；图标 🖥️，名称走 locale console.name。
  - 点开：已绑定 → openConsole（默认布局 buildConsoleSpec：单一大窗格 content
    {kind:'builtin',type:'console'} + 右侧对话，spec 持久化在 views['wt-console']）；
    未绑定 → 强制绑定弹窗（左「加入现有对话」列表 / 右「新建对话」：分组 无/现有/新建，
    建空会话 sessions.create 后自动绑定并打开控制室）。绑定也走 projects.v1.bindings。
  - 控制室面板（split.tsx ConsolePane）：卡片网格每行 3 张、超出换行；每卡 = 图标/名称/
    状态大字与三色光效（need>done>busy>idle，不过滤 ack，永远显示事实状态）/运行时长
    （后台任务 JobView.startedAt 或会话面 turnTimings 未结束轮次）/最近消息预览。数据组装
    = index.tsx getConsoleCards（env.console 注入），刷新走 consoleListeners（项目/会话
    快照变化推送）+ 面板每秒 tick。
  - 卡片动作：点卡片 = 打开该项目（openSplit 或入驻项目切绑定对话）；工作台自己的卡片
    点击无操作。💬 跳转按钮已删除（用户定案无意义）。
  - 卡片动作（重命名 / 切换布局）：非 self 卡片悬停（或键盘 focus-within）时右上角浮现 ⋯ →
    面板本地菜单两项「重命名 / 切换布局」；菜单与后续弹层一律 `position:fixed`（卡片
    overflow:hidden 会裁掉内部菜单）。菜单 Esc 可关（keydown 挂 window）、首项 autoFocus。
    重命名 = 宿主弹层（autoFocus + 全选，Enter 提交 / Esc 取消）→ 既有 `renameProject`
    （空白提交删除覆盖回退原名；`nameOverrides` 是全局显示名，卡片/侧栏/管理列表同步变）。
    切换布局 = 复用「变更视图」缩略图弹层（含末尾「＋自定义」）：卡片入口用 `popoverPos`
    锚点定位，管理列表仍用侧栏锚点 popLeft/popTop；选中即 `applyLayoutChange`（标签按序迁入）。
    纯逻辑与几何在 `src/client/consoleEdit.ts`（renameOverride / popoverPos / collectTabs /
    migrateTabsInto），经 `window.__dshWorktable` 导出（**split.tsx 与 consoleEdit.ts 的
    调试出口都必须合并写入**，整体覆盖会把对方冲掉）；回归
    `node 04_test/console-card-actions.test.mjs [lib/client.js 路径]`（已挂 release-prep 5c4）。
  - 主题：面板三选一开关（图标按钮 🌙/☀️/🖥️，title/aria 保留文字；存 view.v1 consoleTheme）；
    system 读宿主 html 的 color-scheme（DSH 深色/白色/跟随系统设置都会反映到它）+
    prefers-color-scheme 兜底；落成 .dsh-wt_console[data-wt-theme=dark|light] 作用域变量
    --wt-*（宿主不发布 --dsw-alias-*，工作台全站一直靠回退色渲染——控制室自带主题作用域，
    不受其影响）。
  - 状态光效（整卡霓虹描边，参考侧栏双圆点发光质感）：工作=蓝色彗星式光点顺时针绕卡旋转
    （.dsh-wt_consoleCard-busy ::before conic-gradient + @property --consoleAngle +
    consoleAngleSpin；环 inset -4/padding 4、高亮段 #dcebff→#9cc6ff、filter drop-shadow
    rgba(140,190,255,.85) 光点自带辉光、外发光双层 10px+34px）；完成=绿光、待决=黄光
    （-glowDone/-glowNeed：亮色描边 + 双层外发光 + 微弱内辉光；glow 字段 = done/need 且
    本轮未 ack，点卡片先 onAck 熄光再进入，与提醒 ack 生命周期一致）。
  - 命名：侧栏区块标题 = 「工作台」（title locale，整个插件）；默认项目卡名与面板标题 =
    「控制室」（console.name/console.title locale，工作台的控制室）。
  - 控制室标签不可关：PaneBody 对 content.type==='console' 的标签 locked（不渲染 ✕、
    禁拖拽）——关掉会退化成窗格选择器，不可逆。
  - 布局尺度：网格 gap 64px（4 倍间距）不变、max-width 856px 左右居中；卡片 1:1（面积
    2×边长 1.4，实测 236px：名字 20/状态 22/预览 8.5 四行截断）；标题下横向分隔线；无子代理
    徽章、无 💬 跳转按钮；网格最后一位恒为「创建卡片」（虚线＋）→ openAddPanel；入口卡无描边。
  - 背景三选一（data-wt-bg）：纯色/流光/自定义，各自独立记忆——色相/饱和度/明度（-180..180/0..200，纯色随主题默认：深 #0a0d13、浅 #eef1f5）、
    贴片模糊 B（0-20；预设 纯色0/流光8/自定义8）、网格线不透明度 T（0-30；纯色/流光各自）、
    流光速度 S（0-100，0=完全不动，默认50=原速，consoleGlowSpeed；--wt-glowScale=50/速度；恢复初始一并复位）、
    照片网格开关（consoleBgPhotoGrid）+ 网格透明度（consoleBgGridOpacity）；卡片 glass 底含 backdrop-filter blur(var(--wt-cardBlur))。
  - 自定义背景 = 媒体库（照片+视频）：IndexedDB photoRecords（id/createdAt/kind/blob/order）；
    首用预置两张默认图（defaultBg.ts SVG 极光 + waveBg.ts JPEG 181KB，标记 defaultBgSeeded.v1）；
    缩略图类型角标/全行删除/抓手拖拽（槽位制+FLIP，photoStore.reorder）；视频背景双轨首尾帧交叉渐融（ConsoleVideo ≥1.2s 最长2s、备轨就绪才淡入）。
  - 底部操作台：5 个 ghost 按钮玻璃 dock（主题/形状/背景/每行数量/更新公告）；菜单点选保持打开、点空白关闭；
    下拉宽度 = dock 总宽 186px（媒体宽版 264px）。
  - 顶部标题克制：控制室页只保留侧栏入口卡一个「控制室」——分栏标题栏对 wt-console
    不渲染 title（保留 ⇄/✕）、PaneBody singleConsole 不渲染标签栏；控制项集中在底部操作台 5 键。
  - 更新公告（第 5 键，反选切换大磁片替代网格视图）：顶部=当前版本/检查更新/自动检查开关；
    新版本横幅=复制升级指令（点击变绿并提示「请在任意对话中发送」）/查看发布页（蓝 hover）/忽略此版本（红 hover）+
    CHANGELOG_V030 正文（changelog.ts 纯文本，不做 md 渲染）；
    检查核心 = updateCheck.ts（updateCache.v1 缓存，与设置面板旧更新卡共用 lastUpdateCheck/skipVersion/updateCheck 键，
    旧卡暂保留未去重）；铃铛按钮发现新版本时右上角琥珀呼吸灯（dockBadge）。
  - 指哪打哪标注：窗格折叠键旁 annotBtn——蓝泡光标→点选/拖框（小拖=点）→输入→✓ 注入宿主 textarea（不发送，失败回退剪贴板）。
    payload v3.2：窗口身份（编号+窗格标题+内容类型/URL）+ 主目标（caretPositionFromPoint 取字 + computed style 字号）+ 整行 + 候选；
    同源 iframe 下钻取字（boxPayload），跨域输出「读取受限」+ src；提示词含「禁止编造，缺失时如实说明，建议截图或视觉模型」；
    知识包含标注协议行（窗口编号+处理方式）；回退锚点 tag：pre-annotate-v3 / pre-annotate-v3.1 / pre-annotate-v3.2。
  - 分隔线：DIVIDER=4（分栏可拖分隔条更细）。
  - 冷会话消息预览（方案 A）：binding() 对冷会话不载入文本；预热走 face.history({maxMessages:6})
    （运行期内建方法、非公开接口，只读无副作用）尾部扫 user/message 与 assistant/message 的
    text 块 → cleanPreviewText（滤除 ```围栏与行内代码、压缩空白；不足 8 字符回退更早消息）→
    previewCache；sweepPreviews 在打开控制室时 + 控制室开着且会话快照变化防抖 6s 触发；
    失败静默回退内存路径 lastTextOf。拉取是带宽成本不是 Token 成本。
  - 状态指示：卡片右上角小圆点已删（整卡光效表达状态）；状态计算不变。
- **更新检查（v0.2.2）**：客户端直连 GitHub Releases API 比版本（只读 GET；自动每天最多
  一次，手动「立即检查」绕过节流；单次 8s 超时（AbortController）+ 最多 3 次重试，
  in-flight 防重入、检查中按钮禁用、组件卸载后停止重试与状态更新；失败后状态行显示「上次检查未成功」）。
  状态四态 idle/checking/uptodate/failed；徽标 = 「工作台」标题右侧琥珀呼吸小圆（SVG 同步
  图标、不显示版本号），仅发现更新时出现；更新卡在设置面板顶部（复制 AI 提示词 + 忽略此
  版本 + 命令框供终端用户手抄），版本号与自动检查开关在面板底部；设置弹窗右上角 ✕ 关闭、
  底部防溢出钳制（POP_BOTTOM_MARGIN=12，贴底后向上生长；按钮与开关必须平级防冒泡）。
  localStorage 键 lastUpdateCheck.v1 / skipVersion.v1 / updateCheck.v1（控制室第 5 键公告页共用，另缓存 updateCache.v1）。
  **发布纪律**：改动≠发布，只有 tag+Release 才触发提醒；新版本 = 新 tag + 新 Release，每个
  Release 必须同时附固定名资产 `dsh-worktable.tgz`（供 releases/latest/download 永久链接）
  与版本化资产。版本注入：build.mjs 把 package.json version 打进 __WT_VERSION__，发版前
  改 version 再构建；升级动作（执行 add + 重启）永远留给用户或其 Agent，插件不自更新。
- **提醒红线**：need > done > busy，聚合父/子会话。ack 只存 opaque key/kind，不存正文；身份更换重新亮，读取副本与持久化同步清理，确认先记已见身份；旧无 key 退路无法识别直接替换。
- **控制室红线**：wt-console 固定首位、不可删除、唯一 console 标签不可关；隐藏项目不入网格。状态/计时/预览只镜像宿主，不为计时激活冷会话，不把完成标记当成功证明；业务临时持有结束释放。
- **更新检查/发布**：设置与控制室检查暂未去重，共用 updateCheck/lastUpdateCheck/skipVersion.v1，updateCache.v1 仅控制室。单次 8s、最多 3 次尝试；失败不可报最新。版本从 package.json 构建注入；新版本需 tag+Release，双资产固定名 dsh-worktable.tgz + 版本化名同 SHA。插件仅提示不自升级，安装/重启留给用户。

## 旧版 link 加载兼容边界

- 特定旧版 0.1.1-rc.2 的裸包 import / link peer 解析曾使用上级 node_modules junction 兜底，不是通用修法。
  本机 0.2.0-rc.2 经无旧链接冷启动与真实工作台/控制室检查后已移除该链接，原目标目录保留。
  重新遇到加载失败时先查实际宿主、profile、插件及第一条完整错误；不得直接创建更高层级链接或删除它指向的依赖目录。

## 宿主 bug 跟踪（UTF-16 路径截断）

- 官方 native picker 的 readUtf16 只看 UTF-16LE 低字节，含 U+XX00 字符（开/一/言/Ā/🀀 等）的路径被截断。非我们插件问题。
  修复与回归测试存档：`02_process/upstream/utf16-picker-fix.patch`；官方 Discussions #580 已接单。
  待办：官方修 master 后核验对应 npm 版本是否含修复，随后可清理 patch 存档。

## 安装 / 重启

- 注册：`dsh plugin --profile web add "link:<repo>/01_content"`（写 ~/.dsh，需用户授权）。
- 发布版安装（给用户）：`dsh plugin --profile web add "https://github.com/Aisland-SJL/dsh-worktable/releases/latest/download/dsh-worktable.tgz"`（依赖每个 Release 的固定名资产）。
- Desktop：用实际安装目录 resources/runtime/cli/bin/dsh.cmd 对 desktop profile 安装；不得以网页 CLI 或不固定 npx 替代。安装前用户完整退出，安装后用户手动重开。
- bundle 启动时组合：网页重启 dsh web 并刷新；桌面完整退出/手动重开。不得自动重启正式宿主。

