/**
 * Locale dictionaries for the archived-session management UI.
 * `zh` is the source-of-truth key set; `en` mirrors every key.
 */

export const zh = {
  nav: '归档会话',
  title: '归档会话管理',
  meta: '共 {n} 个归档会话',
  metaMissing: '，{m} 个已失效 id 已忽略',
  loading: '加载中…',
  empty: '没有归档会话',
  loadError: '加载失败',
  close: '关闭会话',
  unarchive: '取消归档',
  delete: '删除',
  processing: '处理中…',
  statusRunning: '运行中',
  statusOpenIdle: '已打开（空闲）',
  statusPersisted: '已持久化',
  confirmClose: '关闭会话「{title}」？\n\n{sessionId}\n将把它从内存中移除，变为已持久化状态。',
  confirmDelete: '确认永久删除归档会话「{title}」？\n\n{sessionId}\n此操作不可恢复。',
  closed: '已关闭「{title}」，现在可以删除。',
  unarchived: '已取消归档「{title}」，现在可以在侧边栏找到并关闭它。',
  deleted: '已删除：{sessionId}',
  closeFailed: '关闭失败',
  unarchiveFailed: '取消归档失败',
  deleteFailed: '删除失败',
  requestFailed: '请求失败',
} as const

export const en: Record<keyof typeof zh, string> = {
  nav: 'Archived Sessions',
  title: 'Archived Sessions Management',
  meta: '{n} archived session(s)',
  metaMissing: ', {m} stale ID(s) ignored',
  loading: 'Loading…',
  empty: 'No archived sessions',
  loadError: 'Failed to load',
  close: 'Close Session',
  unarchive: 'Unarchive',
  delete: 'Delete',
  processing: 'Processing…',
  statusRunning: 'Running',
  statusOpenIdle: 'Open (idle)',
  statusPersisted: 'Persisted',
  confirmClose: 'Close session "{title}"?\n\n{sessionId}\nIt will be detached from memory and become persisted-only.',
  confirmDelete: 'Permanently delete archived session "{title}"?\n\n{sessionId}\nThis action cannot be undone.',
  closed: 'Closed "{title}". You can now delete it.',
  unarchived: 'Unarchived "{title}". You can now find and close it in the sidebar.',
  deleted: 'Deleted: {sessionId}',
  closeFailed: 'Failed to close',
  unarchiveFailed: 'Failed to unarchive',
  deleteFailed: 'Failed to delete',
  requestFailed: 'Request failed',
}

export type ArchiveSessionKey = keyof typeof zh
