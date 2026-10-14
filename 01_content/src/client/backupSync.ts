/**
 * 磁盘备份同步（DSH_HOME/worktable-backup）：源级「清除浏览数据」会把 localStorage 里的
 * projects.v1 与 .bak **一起**带走（2026-09-29 / 2026-10-14 各实测一次），同源备份救不回来；
 * 因此每次落盘后另推一份到宿主磁盘，载入时若本地比磁盘副本「更空」再采纳它。
 *
 * 纯逻辑（planBackupAdoption / parseBackupEnvelope）经 window.__dshWorktable 导出供回归评估；
 * 两条 fetch 只做传输，不含业务判断。
 */

/** 磁盘上的备份名（与 localStorage 主键同名，便于对应） */
export const BACKUP_NAME = 'dsh.worktable.projects.v1'
/** 宿主的备份路由（GET 取最新 / POST 落盘） */
export const BACKUP_PATH = '/api/worktable/backup'

/** 远端副本摘要（layouts 数 + 原始 data 文本 + 写入时间） */
export type BackupEnvelope = { layouts: number; data: string; savedAt: number }

/**
 * 是否采纳磁盘副本：**只有本地比磁盘副本更空**才采纳。
 * 刻意不按"时间新旧"判定，而是按「 layouts 数量」——因为删光项目时本地与磁盘都会被写成空档，
 * 于是"空 vs 空"不采纳（不会把用户刻意删空的工作台复活）；只有本地被清成空、磁盘还留着料才采纳。
 * @param localLayouts - 本地主键里的项目布局数
 * @param remote - 磁盘副本摘要（null = 没有副本/取不到）
 */
export function planBackupAdoption(
  localLayouts: number,
  remote: { layouts?: number } | null | undefined,
): { adopt: boolean; reason: string } {
  if (typeof localLayouts !== 'number' || !Number.isFinite(localLayouts) || localLayouts < 0) {
    return { adopt: false, reason: 'bad-local' }
  }
  if (!remote || typeof remote.layouts !== 'number' || !Number.isFinite(remote.layouts)) {
    return { adopt: false, reason: 'no-remote' }
  }
  if (remote.layouts <= 0) return { adopt: false, reason: 'remote-empty' }
  if (remote.layouts <= localLayouts) return { adopt: false, reason: 'local-not-emptier' }
  return { adopt: true, reason: 'adopt' }
}

/**
 * 校验 GET /api/worktable/backup 的响应，取出可用副本。
 * 只认「ok === true + 数值 savedAt + 可解析且含 layouts 数组的 data」；其余（含 data:null）返回 null。
 * @param input - 宿主返回的 JSON（形状未知，全部当不可信输入处理）
 */
export function parseBackupEnvelope(input: unknown): BackupEnvelope | null {
  if (typeof input !== 'object' || input === null) return null
  const o = input as Record<string, unknown>
  if (o.ok !== true) return null
  if (typeof o.savedAt !== 'number' || !Number.isFinite(o.savedAt)) return null
  if (typeof o.data !== 'string' || o.data.trim() === '') return null
  let parsed: any
  try { parsed = JSON.parse(o.data) } catch { return null }
  if (typeof parsed !== 'object' || parsed === null || !Array.isArray(parsed.layouts)) return null
  return { layouts: parsed.layouts.length, data: o.data, savedAt: o.savedAt }
}

/** 取磁盘最新副本（网络/解析失败一律 null，不打扰调用方） */
export async function fetchBackup(): Promise<BackupEnvelope | null> {
  try {
    const res = await fetch(BACKUP_PATH + '?name=' + encodeURIComponent(BACKUP_NAME), { cache: 'no-store' })
    if (!res.ok) return null
    return parseBackupEnvelope(await res.json())
  } catch { return null }
}

/** 推一份到磁盘（成功返回 true；失败静默 false——备份是加分项，不能影响落盘主流程） */
export async function pushBackup(data: string): Promise<boolean> {
  if (typeof data !== 'string' || data.trim() === '') return false
  try {
    const res = await fetch(BACKUP_PATH, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: BACKUP_NAME, data }),
    })
    return res.ok
  } catch { return false }
}
