import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import css from './styles.css?inline'

const PLUGIN_ID = '@deepseek-ai/dsh-rich-editor'

/** Mount the plugin stylesheet for exactly the client contribution lifetime. */
export function installStyles(ctx: ClientContext): void {
  if (typeof document === 'undefined') return
  ctx.effect(() => {
    const tag = document.createElement('style')
    tag.dataset.plugin = PLUGIN_ID
    tag.dataset.pluginCss = `${PLUGIN_ID}/styles.css`
    tag.textContent = css
    document.head.appendChild(tag)
    return () => { tag.remove() }
  }, 'dsh-rich-editor: stylesheet')
}
