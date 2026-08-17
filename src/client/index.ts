/**
 * @dsh-external/dsh-archive-session — client 设置页「归档会话」面板。
 * 构建：npm run build:client（tsdown，产物 lib/client.js，ModuleLoader.load 注册）。
 * 通信：同源 fetch → host webServer API（/dsh-archive-session/api）。
 *
 * 注意：settings.section 是 React slot，必须用 React 组件注册（第二参数），
 * 不能像旧版 DOM render 对象那样把 component 塞进 options。
 * 文案通过 ctx.locale 注册命名空间，随 DSH 本体语言切换。
 */
import { createElement, useEffect, useState } from 'react'
import type { ReactElement } from 'react'
import type { SlotsService } from '@deepseek-ai/dsh-client-ui-slots'
import { en, zh, type ArchiveSessionKey } from './locales.ts'

type ClientContext = {
  slots: SlotsService
  locale: any
}

export const inject = ['slots', 'locale']

const API = '/dsh-archive-session/api'

const NS = 'dsh-archive-session'

type T = (key: ArchiveSessionKey, params?: Record<string, unknown>) => string

function fmtTime(value: number | null | undefined): string {
  if (!value) return '—'
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleString()
}

function fmtCwd(value: string | null | undefined): string {
  if (!value) return '—'
  try {
    const url = new URL('file://' + value)
    return decodeURIComponent(url.pathname)
  } catch {
    return value
  }
}

const styles = `
.asd-page{font-family:ui-monospace,monospace;font-size:12px;line-height:1.6;padding:14px 16px;max-width:860px}
.asd-page h3{margin:0 0 4px;font-size:13px}
.asd-meta{color:var(--theme-text-secondary,#888);font-size:11px;margin:0 0 12px}
.asd-msg{margin:10px 0;padding:8px 10px;border-radius:6px;background:var(--theme-input-bg,#111);border:1px solid var(--theme-border,#333);white-space:pre-wrap;max-height:180px;overflow:auto;font-size:11px}
.asd-msg.error{border-color:#d33}
.asd-list{list-style:none;margin:0;padding:0}
.asd-item{display:flex;align-items:flex-start;gap:10px;padding:10px 12px;border:1px solid var(--theme-border,#333);border-radius:8px;margin-bottom:8px}
.asd-main{flex:1;min-width:0}
.asd-title{font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.asd-sub{color:var(--theme-text-secondary,#888);font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-top:2px}
.asd-time{color:var(--theme-text-tertiary,#777)}
.asd-badge{display:inline-block;font-size:10px;padding:2px 6px;border-radius:10px;margin-right:6px}
.asd-badge.live{background:rgba(46,204,113,.15);color:#2ecc71}
.asd-badge.idle{background:rgba(149,165,166,.15);color:#95a5a6}
.asd-badge.persisted{background:rgba(52,152,219,.15);color:#3498db}
.asd-btn{background:var(--theme-input-bg,#222);border:1px solid var(--theme-border,#666);color:var(--theme-text,#eee);border-radius:6px;padding:6px 12px;cursor:pointer;font-size:12px;white-space:nowrap;transition:background .15s ease,border-color .15s ease,color .15s ease}
.asd-btn:hover:not(:disabled){border-color:var(--theme-accent,#4a9eff);color:#fff}
.asd-btn.primary{background:var(--theme-accent,#4a9eff);border-color:var(--theme-accent,#4a9eff);color:#fff}
.asd-btn.primary:hover:not(:disabled){background:var(--theme-accent-strong,#3b82d6);border-color:var(--theme-accent-strong,#3b82d6);color:#fff}
.asd-btn.danger{background:transparent;border-color:#e5484d;color:#e5484d}
.asd-btn.danger:hover:not(:disabled){background:rgba(229,72,77,.15);border-color:#ff6b70;color:#ff6b70}
.asd-btn:disabled{opacity:.4;cursor:not-allowed;background:transparent;color:var(--theme-text-secondary,#888);border-color:var(--theme-border,#333)}
.asd-actions{display:flex;gap:6px;flex-shrink:0}
.asd-empty{padding:20px;text-align:center;color:var(--theme-text-secondary,#888);border:1px dashed var(--theme-border,#444);border-radius:8px}
`

interface ArchivedItem {
  sessionId: string
  title: string | null
  cwd: string | null
  createdAt: number
  live: boolean
  running: boolean
  persisted: boolean
  logPath: string | null
}

function ArchivedSessionsSection({ t }: { t: T }): ReactElement {
  const [items, setItems] = useState<ArchivedItem[]>([])
  const [missingCount, setMissingCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const refresh = (): void => {
    setLoading(true)
    setError(null)
    fetch(API + '/archived')
      .then(r => r.json())
      .then((data: any) => {
        if (!data?.ok) {
          setError(data?.error ?? t('loadError'))
          setItems([])
          return
        }
        setItems(data.items ?? [])
        setMissingCount(data.missing?.length ?? 0)
      })
      .catch((err: unknown) => {
        setError(String(err instanceof Error ? err.message : err))
        setItems([])
      })
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const remove = (item: ArchivedItem): void => {
    const title = item.title || item.sessionId
    if (!window.confirm(t('confirmDelete', { title, sessionId: item.sessionId }))) return
    setBusyId(item.sessionId)
    fetch(API + '/delete', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: item.sessionId, confirm: true }),
    })
      .then(r => r.json())
      .then((data: any) => {
        if (!data?.ok) {
          window.alert(data?.error ?? t('deleteFailed'))
          return
        }
        window.alert(t('deleted', { sessionId: item.sessionId }))
        refresh()
      })
      .catch((err: unknown) => {
        window.alert(`${t('requestFailed')}: ${String(err instanceof Error ? err.message : err)}`)
      })
      .finally(() => setBusyId(null))
  }

  const unarchive = (item: ArchivedItem): void => {
    const title = item.title || item.sessionId
    setBusyId(item.sessionId)
    fetch(API + '/unarchive', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: item.sessionId }),
    })
      .then(r => r.json())
      .then((data: any) => {
        if (!data?.ok) {
          window.alert(data?.error ?? t('unarchiveFailed'))
          return
        }
        window.alert(t('unarchived', { title }))
        refresh()
      })
      .catch((err: unknown) => {
        window.alert(`${t('requestFailed')}: ${String(err instanceof Error ? err.message : err)}`)
      })
      .finally(() => setBusyId(null))
  }

  const closeSession = (item: ArchivedItem): void => {
    const title = item.title || item.sessionId
    if (!window.confirm(t('confirmClose', { title, sessionId: item.sessionId }))) return
    setBusyId(item.sessionId)
    fetch(API + '/close', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: item.sessionId }),
    })
      .then(r => r.json())
      .then((data: any) => {
        if (!data?.ok) {
          window.alert(data?.error ?? t('closeFailed'))
          return
        }
        window.alert(t('closed', { title }))
        refresh()
      })
      .catch((err: unknown) => {
        window.alert(`${t('requestFailed')}: ${String(err instanceof Error ? err.message : err)}`)
      })
      .finally(() => setBusyId(null))
  }

  const metaText = loading
    ? t('loading')
    : t('meta', { n: items.length }) + (missingCount > 0 ? t('metaMissing', { m: missingCount }) : '')

  return createElement('div', { className: 'asd-page' },
    createElement('style', { dangerouslySetInnerHTML: { __html: styles } }),
    createElement('h3', null, t('title')),
    createElement('p', { className: 'asd-meta' }, metaText),
    error !== null
      ? createElement('div', { className: 'asd-msg error' }, error)
      : null,
    !loading && items.length === 0
      ? createElement('div', { className: 'asd-empty' }, t('empty'))
      : null,
    createElement('ul', { className: 'asd-list' },
      items.map(item => createElement('li', { key: item.sessionId, className: 'asd-item' },
        createElement('div', { className: 'asd-main' },
          createElement('div', { className: 'asd-title' },
            item.running
              ? createElement('span', { className: 'asd-badge live' }, t('statusRunning'))
              : item.live
                ? createElement('span', { className: 'asd-badge idle' }, t('statusOpenIdle'))
                : item.persisted
                  ? createElement('span', { className: 'asd-badge persisted' }, t('statusPersisted'))
                  : null,
            item.title || item.sessionId,
          ),
          createElement('div', {
            className: 'asd-sub',
            title: `${item.sessionId} · ${fmtCwd(item.cwd)}`,
          },
            `${item.sessionId} · ${fmtCwd(item.cwd)}`,
          ),
          createElement('div', {
            className: 'asd-sub asd-time',
            title: fmtTime(item.createdAt),
          }, fmtTime(item.createdAt)),
          item.logPath
            ? createElement('div', { className: 'asd-sub', title: item.logPath }, item.logPath)
            : null,
        ),
        createElement('div', { className: 'asd-actions' },
          createElement('button', {
            className: 'asd-btn primary',
            disabled: busyId === item.sessionId || !item.live,
            onClick: () => closeSession(item),
          }, busyId === item.sessionId ? t('processing') : t('close')),
          createElement('button', {
            className: 'asd-btn',
            disabled: busyId === item.sessionId,
            onClick: () => unarchive(item),
          }, busyId === item.sessionId ? t('processing') : t('unarchive')),
          createElement('button', {
            className: 'asd-btn danger',
            disabled: busyId === item.sessionId || item.live,
            onClick: () => remove(item),
          }, busyId === item.sessionId ? t('processing') : t('delete')),
        ),
      )),
    ),
  )
}

export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-archive-session: dictionaries')

  ctx.effect(() => ctx.slots.inject('settings.section', () =>
    ctx.slots.register({
      name: 'settings.section',
      id: 'dsh-archive-session-archived',
      order: 60,
      locale: NS,
      label: () => ctx.locale.bind(NS)('nav'),
    }, ArchivedSessionsSection),
  ), 'dsh-archive-session: settings page')
}
