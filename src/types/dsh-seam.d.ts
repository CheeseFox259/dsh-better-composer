/**
 * Type bridge for published DSH packages.
 *
 * The composer seam this plugin builds on (generic decorations, surface
 * extensions, composer actions, markdown primitives) ships in the DSH harness
 * runtime before its type declarations reach the published npm lines. This
 * file declares exactly the missing surface so the repository typechecks and
 * tests against registry packages alone. Runtime values come from the host.
 *
 * Delete declarations here once the corresponding types are published.
 */
declare module '@deepseek-ai/dsh-client-ui-conversation/client' {
  /** Branded session identity used across DSH session APIs. */
  export type ComposerSessionId = string & { readonly __dshSessionId: unique symbol }

  export interface InputState {
    readonly draft: string
    readonly draftRev: number
    readonly phase: string
    readonly occurrences: readonly { readonly offset: number; readonly length: number; readonly source: string }[]
  }

  export interface TokenSpan {
    readonly start: number
    readonly end: number
    readonly draftRev: number
  }

  export interface InputActions {
    captureInsertion(): TokenSpan
    insertText(text: string, span: TokenSpan): boolean
    setDraft(text: string): void
  }

  export interface ReferenceInsert {
    readonly source: string
    readonly ref: string
    readonly label: string
    readonly appearance?: 'session' | 'file' | 'folder'
    readonly clipboardText: string
  }

  export interface ComposerPresentationState {
    readonly focused: boolean
    readonly composing?: boolean
    readonly selectionStart: number
    readonly selectionEnd: number
    readonly activeLineStart: number
    readonly activeLineEnd: number
  }

  export interface ComposerNativeRange {
    readonly start: number
    readonly end: number
    readonly kind: string
  }

  export interface ComposerTextSegment {
    readonly start: number
    readonly end: number
    readonly text: string
  }

  export interface ComposerDecorationContext {
    readonly sessionId: ComposerSessionId
    readonly draft: string
    readonly draftRev: number
    readonly nativeRanges: readonly ComposerNativeRange[]
    readonly textSegments?: readonly ComposerTextSegment[]
    readonly presentation?: ComposerPresentationState
  }

  export type ComposerDecorationLayer = 'syntax' | 'diagnostic'
  export type ComposerDecorationTarget = 'text' | 'block'

  export interface ComposerDecorationSegment {
    readonly start: number
    readonly end: number
    readonly className: string
    readonly blockClassName?: string
  }

  export interface ComposerDecorationRange {
    readonly start: number
    readonly end: number
    readonly className: string
    readonly layer?: 'syntax' | 'diagnostic'
    readonly priority?: number
    readonly target?: 'text' | 'block'
  }

  export interface ComposerDecorationProvider {
    readonly id: string
    readonly order?: number
    decorate(context: ComposerDecorationContext): readonly ComposerDecorationRange[]
  }

  export interface ComposerEditResult {
    readonly start: number
    readonly end: number
    readonly text: string
    readonly selectionStart: number
    readonly selectionEnd: number
  }

  export interface ComposerActionSelection {
    readonly start: number
    readonly end: number
  }

  export interface ComposerActionContext {
    readonly draft: string
    readonly draftRev: number
    readonly selection: ComposerActionSelection
    readonly nativeRanges: readonly ComposerNativeRange[]
  }

  export interface ComposerActionShortcut {
    readonly key: string
    readonly mod?: boolean
    readonly shift?: boolean
    readonly alt?: boolean
  }

  export interface ComposerAction {
    readonly id: string
    readonly order?: number
    readonly input?: string
    readonly shortcut?: ComposerActionShortcut
    readonly execution?: 'generic' | 'core-aware'
    transform(context: ComposerActionContext): ComposerEditResult | undefined
  }

  export interface ComposerSurfaceExtensionContext {
    readonly draft: string
    readonly draftRev: number
    readonly selection: ComposerActionSelection
    readonly nativeRanges: readonly ComposerNativeRange[]
    readonly composing: boolean
    readonly triggerOwner: 'slash' | 'native' | 'none'
    readonly textSegments: readonly ComposerTextSegment[]
  }

  export interface ComposerSurfaceCompletionPopup {
    readonly revision: number
    readonly from: number
    readonly to: number
    readonly candidates: readonly { readonly label: string; readonly insertText: string }[]
    readonly selectedIndex: number
  }

  export interface ComposerSurfaceCompletionGhost {
    readonly revision: number
    readonly from: number
    readonly to: number
    readonly insertText: string
    readonly label?: string
  }

  export interface ComposerSurfaceDiagnostic {
    readonly start: number
    readonly end: number
    readonly className: string
    readonly message: string
  }

  export interface ComposerSurfaceHint {
    readonly revision: number
    readonly kind: string
    readonly start: number
    readonly end: number
    readonly message: string
  }

  export interface ComposerSurfaceExtensionPresentation {
    readonly revision: number
    readonly popup?: ComposerSurfaceCompletionPopup
    readonly ghost?: ComposerSurfaceCompletionGhost
    readonly diagnostics: readonly ComposerSurfaceDiagnostic[]
    readonly hints?: readonly ComposerSurfaceHint[]
  }

  export interface ComposerSurfaceExtensionKeyRequest {
    readonly key: string
    readonly shift: boolean
    readonly context: ComposerSurfaceExtensionContext
    readonly presentation: ComposerSurfaceExtensionPresentation
    readonly apply: (edit: ComposerEditResult, draftRev: number) => boolean
  }

  export interface ComposerSurfaceExtension {
    readonly id: string
    present(context: ComposerSurfaceExtensionContext): ComposerSurfaceExtensionPresentation | undefined
    handleKey?(request: ComposerSurfaceExtensionKeyRequest): 'consumed' | 'pass'
  }

  export type RegisterComposerSurfaceExtension = (extension: ComposerSurfaceExtension) => () => void

  /** Owner share of the `conversation.input.editor` slot. */
  export interface ComposerEditorProps {
    runAction: (id: string) => void
    applyEdit: (edit: ComposerEditResult, draftRev: number) => boolean
    expanded: boolean
    setExpanded: (expanded: boolean) => void
    registerSurfaceExtension?: RegisterComposerSurfaceExtension
    surfaceKey?: string
    surfacePresentation?: ComposerSurfaceExtensionPresentation | undefined
    decorationContext?: ComposerDecorationContext | undefined
  }
}

declare module '@deepseek-ai/dsh-client-ui-primitives' {
  import type { Root } from 'mdast'

  export function parseGfm(source: string): Root

  export interface HighlightSpan {
    readonly text: string
    readonly style: { readonly color?: string }
  }

  export function highlightLines(code: string, lang: string | undefined): readonly (readonly HighlightSpan[])[] | undefined
  export function grammarLoadCount(): number
  export function subscribeGrammarLoaded(listener: () => void): () => void
  export function writeClipboard(text: string): Promise<boolean>
}

declare module '@deepseek-ai/dsh-client-ui-settings/client' {
  /** Accepted values and serialized writes shared by editors of one Host entry. */
  export interface ConfigForm<T> {
    getSnapshot(): { readonly value: unknown }
    subscribe(listener: () => void): () => void
    set(field: string, value: unknown): Promise<boolean>
    unset(field: string): Promise<boolean>
  }

  /** Settings scope bound to one namespace. */
  export interface SettingsScope<T> {
    getSnapshot(): { readonly value: unknown }
    subscribe(listener: () => void): () => void
    set(field: string, value: unknown): Promise<void>
    unset(field: string): Promise<void>
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Shared configuration forms service. */
    configForms: {
      get<T = unknown>(entryId: string): import('@deepseek-ai/dsh-client-ui-settings/client').ConfigForm<T>
    }
    /** Slot registry seat (declared by the renderer host at runtime). */
    slots: {
      register(options: unknown, component: unknown): () => void
      inject(name: string, factory: () => () => void): void
    }
    /** Client Remote mount face (declared by the api-gateway host at runtime). */
    remote: {
      $mount(contribution: unknown): Promise<() => Promise<void>>
    }
    /** Fiber-bound effect registration (see cordis Fiber.effect). */
    effect(callback: () => unknown, label?: string): () => void
    /** Deferred dependency injection block. */
    inject(deps: readonly string[], fn: (scoped: Context) => void): void
    /** Service lookup by name. */
    get(name: string, strict?: boolean): unknown
    /** Settings scope factory seat (declared by the settings host at runtime). */
    settingsScope: {
      bind(namespace: unknown): import('@deepseek-ai/dsh-client-ui-settings/client').SettingsScope<never>
    }
  }

  /** Service base members this plugin relies on. */
  interface Service {
    readonly ctx: Context
    readonly name: string
  }
}

declare module '@deepseek-ai/dsh-settings' {
  export interface SettingsProvider {
    installSection(owner: unknown, ns: string, schema: unknown, entry: unknown, hooks: unknown): void
  }
}

declare module '@deepseek-ai/dsh-settings' {
  export interface SettingsForms {
    /** Section installation performed by the settings host at runtime. */
    installSection(owner: unknown, ns: string, schema: unknown, entry: unknown, hooks: unknown): void
  }
}
