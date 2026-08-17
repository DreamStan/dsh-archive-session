/**
 * @dsh-external/dsh-archive-session — 归档会话浏览与删除插件。
 *
 * host 侧：
 *  - 工具 `archived_sessions_list`：列出归档会话（标题/id/cwd/时间/来源/日志路径）
 *  - 工具 `archived_session_close`：关闭仍在内存中的空闲归档会话
 *  - 工具 `archived_session_unarchive`：取消归档，让会话重新出现在侧边栏
 *  - 工具 `archived_session_delete`：删除一个已归档会话（必须 confirm: true）
 *  - webServer API：GET /dsh-archive-session/api/archived、POST /dsh-archive-session/api/delete
 *
 * client 侧：settings.section「归档会话」面板，可浏览并删除。
 */
import type { Context } from 'cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import z from 'schemastery'
import { rm } from 'node:fs/promises'
import { dirname } from 'node:path'

export const name = '@dsh-external/dsh-archive-session'
export const inject = ['tools']

export const Config = z.object({})

const API_PREFIX = '/dsh-archive-session/api'

interface ArchivedSessionView {
  sessionId: string
  title: string | null
  cwd: string | null
  createdAt: number
  live: boolean
  running: boolean
  persisted: boolean
  logPath: string | null
}

interface ListResult {
  ok: boolean
  items?: ArchivedSessionView[]
  total?: number
  missing?: string[]
  error?: string
}

interface DeleteResult {
  ok: boolean
  deleted?: boolean
  sessionId?: string
  logPath?: string
  error?: string
}

interface UnarchiveResult {
  ok: boolean
  unarchived?: boolean
  sessionId?: string
  error?: string
}

interface CloseResult {
  ok: boolean
  closed?: boolean
  sessionId?: string
  error?: string
}

/** 读取可选 Cordis 服务；ctx.get 与直接属性都兼容。 */
function svc(ctx: Context, key: string): any {
  const anyCtx = ctx as any
  const viaGet = typeof anyCtx.get === 'function' ? anyCtx.get(key) : undefined
  return viaGet ?? anyCtx[key]
}

function errText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * 列出归档会话。归档集合来自 workspaceRegistry；具体会话元数据来自
 * sessionPersistence（持久化）与 sessions（实时），标题尽量用 sessionQuery。
 */
async function listArchivedSessions(ctx: Context): Promise<ListResult> {
  const registry = svc(ctx, 'workspaceRegistry')
  const persistence = svc(ctx, 'sessionPersistence')
  if (!registry || !Array.isArray(registry.archivedSessionIds)) {
    return { ok: false, error: 'workspaceRegistry 服务不可用（无法读取归档集合）' }
  }
  if (!persistence || typeof persistence.list !== 'function') {
    return { ok: false, error: 'sessionPersistence 服务不可用（无法读取会话日志）' }
  }

  const archivedIds: string[] = [...registry.archivedSessionIds]
  if (archivedIds.length === 0) return { ok: true, items: [], total: 0, missing: [] }

  const sessionsSvc = svc(ctx, 'sessions')
  const agentsSvc = svc(ctx, 'agents')
  const liveSessions = sessionsSvc?.list?.() ?? []
  const liveBy = new Map<string, any>()
  for (const session of liveSessions) liveBy.set(session.id, session)

  let persistedHeaders: any[] = []
  try {
    persistedHeaders = await persistence.list()
  } catch (error) {
    return { ok: false, error: `读取持久化会话失败: ${errText(error)}` }
  }
  const persistedBy = new Map<string, any>(persistedHeaders.map(h => [h.id, h]))

  const items: ArchivedSessionView[] = []
  const missing: string[] = []
  const titleIds: string[] = []

  for (const id of archivedIds) {
    const live = liveBy.get(id)
    const header = live?.header ?? persistedBy.get(id)
    if (!header) {
      missing.push(id)
      continue
    }
    const loc = typeof persistence.locate === 'function' ? persistence.locate(header) : undefined
    const agent = agentsSvc?.get?.(id)
    items.push({
      sessionId: id,
      title: null,
      cwd: typeof header.cwd === 'string' ? header.cwd : null,
      createdAt: typeof header.createdAt === 'number' ? header.createdAt : 0,
      live: Boolean(live),
      running: agent?.status === 'running',
      persisted: persistedBy.has(id),
      logPath: loc && typeof loc.path === 'string' ? loc.path : null,
    })
    titleIds.push(id)
  }

  // 标题是锦上添花；sessionQuery 不可用时保留 null，UI 会回退到 id/cwd。
  const query = svc(ctx, 'sessionQuery')
  if (query && typeof query.readTitleSnapshots === 'function' && titleIds.length > 0) {
    try {
      const results = await query.readTitleSnapshots(titleIds)
      const titles = new Map<string, string | null>()
      for (const result of results) {
        if (result.status === 'fulfilled' && result.value?.title?.title) {
          titles.set(result.sessionId, result.value.title.title)
        } else {
          titles.set(result.sessionId, null)
        }
      }
      for (const item of items) item.title = titles.get(item.sessionId) ?? null
    } catch {
      // 标题读取失败不阻塞浏览
    }
  } else {
    const titleSvc = svc(ctx, 'sessionTitle')
    for (const item of items) {
      const live = liveBy.get(item.sessionId)
      if (live && titleSvc && typeof titleSvc.get === 'function') {
        const snapshot = titleSvc.get(live)
        item.title = snapshot?.title ?? null
      }
    }
  }

  return { ok: true, items, total: items.length, missing }
}

/**
 * 删除一个归档会话。
 * 仅删除已归档且不在内存中运行的会话；JSONL 后端通过 session 目录物理删除，
 * SQLite 后端因 persistence.locate 不返回文件路径而明确拒绝。
 */
async function deleteArchivedSession(
  ctx: Context,
  sessionId: string,
  confirm: boolean,
): Promise<DeleteResult> {
  if (!sessionId || typeof sessionId !== 'string') {
    return { ok: false, error: 'sessionId 必填' }
  }
  if (confirm !== true) {
    return { ok: false, error: '危险操作：必须传 confirm: true 确认删除' }
  }

  const registry = svc(ctx, 'workspaceRegistry')
  const persistence = svc(ctx, 'sessionPersistence')
  const sessionsSvc = svc(ctx, 'sessions')
  if (!registry || !Array.isArray(registry.archivedSessionIds)) {
    return { ok: false, error: 'workspaceRegistry 服务不可用（无法校验归档状态）' }
  }
  if (!persistence || typeof persistence.list !== 'function') {
    return { ok: false, error: 'sessionPersistence 服务不可用（无法定位会话日志）' }
  }

  const archivedIds: string[] = [...registry.archivedSessionIds]
  if (!archivedIds.includes(sessionId)) {
    return { ok: false, error: `会话 ${sessionId} 不在归档集合中，拒绝删除` }
  }

  if (sessionsSvc?.get) {
    const live = sessionsSvc.get(sessionId)
    if (live) {
      return { ok: false, error: `会话 ${sessionId} 仍处于打开状态，不能删除（请先关闭/结束该会话）` }
    }
  }

  let header: any
  try {
    const headers = await persistence.list() as any[]
    header = headers.find((h: any) => h.id === sessionId)
  } catch (error) {
    return { ok: false, error: `读取持久化会话失败: ${errText(error)}` }
  }
  if (!header) {
    return { ok: false, error: `归档会话 ${sessionId} 没有可删除的持久化日志（可能已被外部删除）` }
  }

  const loc = typeof persistence.locate === 'function' ? persistence.locate(header) : undefined
  if (!loc || typeof loc.path !== 'string' || loc.path.length === 0) {
    return {
      ok: false,
      error: '当前 sessionPersistence 后端不支持文件删除（locate 未返回路径）；本插件当前支持 JSONL 后端',
    }
  }

  const sessionDirPath = dirname(loc.path)
  try {
    await rm(sessionDirPath, { recursive: true, force: true })
  } catch (error) {
    return { ok: false, error: `删除会话目录失败: ${errText(error)}` }
  }

  return { ok: true, deleted: true, sessionId, logPath: loc.path }
}

/**
 * 取消归档一个会话：把它从 workspaceRegistry 的全局归档集合中移除，
 * 让会话重新出现在侧边栏/分组视图，之后就可以正常关闭/结束。
 * 注意：DSH 官方没有公开 unarchive API，这里使用 workspaceRegistry 的内部
 * state 写入（与 archiveSession 相同的持久化 domain 通道），运行时可生效。
 */
async function unarchiveArchivedSession(
  ctx: Context,
  sessionId: string,
): Promise<UnarchiveResult> {
  if (!sessionId || typeof sessionId !== 'string') {
    return { ok: false, error: 'sessionId 必填' }
  }

  const registry = svc(ctx, 'workspaceRegistry')
  if (!registry || !Array.isArray(registry.archivedSessionIds)) {
    return { ok: false, error: 'workspaceRegistry 服务不可用（无法取消归档）' }
  }

  const archivedIds: string[] = [...registry.archivedSessionIds]
  if (!archivedIds.includes(sessionId)) {
    return { ok: false, error: `会话 ${sessionId} 不在归档集合中，无需取消归档` }
  }

  const anyReg = registry as any
  const state = typeof anyReg.requireState === 'function' ? anyReg.requireState() : undefined
  if (!state || typeof anyReg.setState !== 'function') {
    return { ok: false, error: '当前 workspaceRegistry 不支持取消归档（内部 state 不可用）' }
  }

  try {
    const nextState = {
      ...state,
      archivedSessionIds: state.archivedSessionIds.filter((id: string) => id !== sessionId),
    }
    await anyReg.setState(nextState)
  } catch (error) {
    return { ok: false, error: `取消归档失败: ${errText(error)}` }
  }

  return { ok: true, unarchived: true, sessionId }
}

/**
 * 关闭一个已归档但仍在内存中的空闲会话：先把未落盘事件 flush 到持久化，
 * 再从内存 session/agent 注册表中 detach，使其变为 persisted-only。
 * 这是对 DSH 内部生命周期的受控操作，仅允许 idle（非 running）会话。
 */
async function closeArchivedSession(
  ctx: Context,
  sessionId: string,
): Promise<CloseResult> {
  if (!sessionId || typeof sessionId !== 'string') {
    return { ok: false, error: 'sessionId 必填' }
  }

  const sessionsSvc = svc(ctx, 'sessions')
  const agentsSvc = svc(ctx, 'agents')
  if (!sessionsSvc || typeof sessionsSvc.get !== 'function') {
    return { ok: false, error: 'sessions 服务不可用（无法关闭会话）' }
  }

  const live = sessionsSvc.get(sessionId)
  if (!live) {
    return { ok: false, error: `会话 ${sessionId} 不在内存中，无需关闭` }
  }

  const agent = agentsSvc?.get?.(sessionId)
  if (agent?.status === 'running') {
    return { ok: false, error: `会话 ${sessionId} 正在运行，不能关闭` }
  }

  // 先 flush，确保内存中的最新事件已写入持久化日志。
  try {
    if (typeof sessionsSvc.flush === 'function') {
      await sessionsSvc.flush(live)
    }
  } catch (error) {
    return { ok: false, error: `关闭前 flush 失败，已中止: ${errText(error)}` }
  }

  try {
    // 从 agent 注册表 detach（如果存在）
    const agentsAny = agentsSvc as any
    const agentEntry = agentsAny?.store?.get?.(sessionId)
    if (agentEntry && typeof agentsAny.detachEntered === 'function') {
      agentsAny.detachEntered(agentEntry)
    }

    // 从 session 注册表 detach
    const sessionsAny = sessionsSvc as any
    const sessionEntry = sessionsAny?.store?.get?.(sessionId)
    if (sessionEntry && typeof sessionEntry.detach === 'function') {
      sessionEntry.detach()
    }
  } catch (error) {
    return { ok: false, error: `关闭会话失败: ${errText(error)}` }
  }

  return { ok: true, closed: true, sessionId }
}

async function readBody(req: any): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(Buffer.from(chunk))
  return Buffer.concat(chunks).toString('utf8')
}

export function apply(ctx: Context): void {
  // 工具：浏览归档会话
  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'archived_sessions_list',
    description: '浏览归档会话：列出 workspaceRegistry 归档集合中仍存在的会话（含标题、cwd、创建时间、实时/持久化状态）。',
    parameters: {},
    output: {
      schema: { type: 'json' },
      render: (_args: unknown, value: unknown) => {
        const v = value as ListResult
        if (!v.ok) return [{ type: 'text', text: `ERROR: ${v.error ?? '未知错误'}` }]
        const items = v.items ?? []
        if (items.length === 0) return [{ type: 'text', text: '（没有归档会话）' }]
        const lines = items.map(item => {
          const title = item.title || item.sessionId
          const time = item.createdAt ? new Date(item.createdAt).toLocaleString() : '?'
          const state = item.running ? 'running' : item.live ? 'live-idle' : item.persisted ? 'persisted' : 'missing'
          return `- ${title}  [${item.sessionId}]  ${time}  ${state}  ${item.cwd ?? ''}`
        })
        return [{ type: 'text', text: `归档会话 ${items.length} 个：\n` + lines.join('\n') }]
      },
    },
    async execute() {
      return listArchivedSessions(ctx) as any
    },
  })), 'dsh-archive-session: list tool')

  // 工具：删除归档会话（必须显式确认）
  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'archived_session_delete',
    description: '删除一个已归档会话（不可恢复）。要求 sessionId 在归档集合中且会话未在内存中打开；必须传 confirm: true。',
    parameters: {
      sessionId: { type: 'string', required: true, description: '要删除的归档会话 id' },
      confirm: { type: 'boolean', required: true, description: '必须为 true，表示确认删除' },
    },
    output: {
      schema: { type: 'json' },
      render: (_args: unknown, value: unknown) => {
        const v = value as DeleteResult
        return [{ type: 'text', text: v.ok
          ? `已删除归档会话 ${v.sessionId ?? ''}`
          : `ERROR: ${v.error ?? '删除失败'}` }]
      },
    },
    async execute(args: { sessionId?: string; confirm?: boolean }) {
      return deleteArchivedSession(ctx, String(args.sessionId ?? ''), args.confirm === true) as any
    },
  })), 'dsh-archive-session: delete tool')

  // 工具：取消归档（让会话重新出现在侧边栏，便于关闭/结束）
  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'archived_session_unarchive',
    description: '取消归档一个会话：把它从归档集合移除，使会话重新出现在侧边栏/分组视图，之后可正常关闭或结束。',
    parameters: {
      sessionId: { type: 'string', required: true, description: '要取消归档的会话 id' },
    },
    output: {
      schema: { type: 'json' },
      render: (_args: unknown, value: unknown) => {
        const v = value as UnarchiveResult
        return [{ type: 'text', text: v.ok
          ? `已取消归档会话 ${v.sessionId ?? ''}（现在可以在侧边栏找到并关闭）`
          : `ERROR: ${v.error ?? '取消归档失败'}` }]
      },
    },
    async execute(args: { sessionId?: string }) {
      return unarchiveArchivedSession(ctx, String(args.sessionId ?? '')) as any
    },
  })), 'dsh-archive-session: unarchive tool')

  // 工具：关闭仍在内存中的空闲归档会话（无需重启 DSH）
  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'archived_session_close',
    description: '关闭一个仍在内存中但已空闲的归档会话：flush 后从内存 detach，使其变为已持久化状态，无需重启 DSH。',
    parameters: {
      sessionId: { type: 'string', required: true, description: '要关闭的归档会话 id' },
    },
    output: {
      schema: { type: 'json' },
      render: (_args: unknown, value: unknown) => {
        const v = value as CloseResult
        return [{ type: 'text', text: v.ok
          ? `已关闭会话 ${v.sessionId ?? ''}（现在为已持久化状态，可以删除）`
          : `ERROR: ${v.error ?? '关闭失败'}` }]
      },
    },
    async execute(args: { sessionId?: string }) {
      return closeArchivedSession(ctx, String(args.sessionId ?? '')) as any
    },
  })), 'dsh-archive-session: close tool')

  // 可选 webServer：给 client 面板提供 JSON API
  ctx.inject(['webServer'], httpCtx => {
    const webServer = (httpCtx as any).webServer
    httpCtx.effect(() => webServer.register({
      kind: 'prefix',
      path: API_PREFIX,
      handler: async (req: any, res: any) => {
        const send = (code: number, obj: unknown): void => {
          res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' })
          res.end(JSON.stringify(obj))
        }
        try {
          const url = new URL(req.url ?? '/', 'http://localhost')
          const path = url.pathname.replace(/^\/dsh-archive-session\/api/, '') || '/'
          if (req.method === 'GET' && path === '/archived') {
            return send(200, await listArchivedSessions(ctx))
          }
          if (req.method === 'POST' && path === '/delete') {
            const body = JSON.parse(await readBody(req) || '{}')
            const result = await deleteArchivedSession(
              ctx,
              String(body?.sessionId ?? ''),
              body?.confirm === true,
            )
            return send(result.ok ? 200 : 400, result)
          }
          if (req.method === 'POST' && path === '/unarchive') {
            const body = JSON.parse(await readBody(req) || '{}')
            const result = await unarchiveArchivedSession(ctx, String(body?.sessionId ?? ''))
            return send(result.ok ? 200 : 400, result)
          }
          if (req.method === 'POST' && path === '/close') {
            const body = JSON.parse(await readBody(req) || '{}')
            const result = await closeArchivedSession(ctx, String(body?.sessionId ?? ''))
            return send(result.ok ? 200 : 400, result)
          }
          return send(404, { ok: false, error: 'not found: ' + path })
        } catch (error) {
          return send(500, { ok: false, error: errText(error) })
        }
      },
    }), 'dsh-archive-session: web api')
  })
}
