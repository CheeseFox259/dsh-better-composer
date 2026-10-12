import { useEffect, useRef } from 'react'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import { CONTEXT_MAP_TAB_KIND } from './context-map-panel.tsx'
import { ContextDoctorPanel } from './context-doctor/panel.tsx'
import type { ContextDoctorPanelProps, WorkspacePage } from './context-doctor/panel.tsx'
import { Button } from './context-doctor/ui.tsx'

function workspacePage(params: unknown): WorkspacePage | undefined {
  const page = params !== null && typeof params === 'object' ? (params as { page?: unknown }).page : undefined
  return page === 'overview' || page === 'diagnosis' || page === 'analysis' || page === 'feedback' ? page : undefined
}

/** Native tab information stays in its own hook-owning adapter. */
export function ContextWorkspaceTab({ useTabInfo, ...props }: PropsRuntime<'sidebar.right.pane.tab'> & ContextDoctorPanelProps) {
  const { tab } = useTabInfo()
  return <ContextDoctorPanel {...props} active={tab.visible} navigationPage={workspacePage(tab.navigation.params)} navigationRevision={tab.navigation.revision} />
}

/** Restore the old Doctor address through the native replacement action. */
export function LegacyDoctorTab({ useTabInfo }: PropsRuntime<'sidebar.right.pane.tab'>) {
  const { tab } = useTabInfo()
  const redirected = useRef(false)
  const open = () => tab.actions.openTab(CONTEXT_MAP_TAB_KIND, { replaceTab: true, params: { page: 'diagnosis' } })
  useEffect(() => { if (tab.visible && !redirected.current) { redirected.current = true; open() } }, [tab.visible])
  return <div className="doctor-empty"><p>Context Doctor 已整合到上下文地图。</p><Button variant="outline" onClick={open}>打开上下文地图</Button></div>
}

declare module '@deepseek-ai/dsh-client-ui-sidebar-right/client' {
  interface SidebarRightTabParamsMap {
    'better-composer.contextmap': { readonly page?: WorkspacePage }
  }
}
