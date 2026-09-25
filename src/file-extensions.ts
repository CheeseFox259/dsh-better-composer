/** File extensions available for workspace delivery of pasted clips. */
export type PasteFileExtension =
  | '.md' | '.txt' | '.log' | '.rst'
  | '.json' | '.jsonl' | '.yaml' | '.yml' | '.toml' | '.xml' | '.csv'
  | '.js' | '.jsx' | '.ts' | '.tsx' | '.mjs' | '.cjs'
  | '.py' | '.pyw' | '.java' | '.kt' | '.kts' | '.go' | '.rs'
  | '.c' | '.h' | '.cc' | '.cpp' | '.hpp' | '.cs' | '.swift'
  | '.php' | '.rb' | '.sh' | '.bash' | '.zsh' | '.fish' | '.sql'
  | '.html' | '.htm' | '.css' | '.scss' | '.sass' | '.less'
  | '.vue' | '.svelte' | '.astro'
  | '.ini' | '.conf' | '.env' | '.dockerfile' | '.graphql' | '.proto'

export interface PasteFileExtensionOption {
  readonly value: PasteFileExtension
  readonly label: string
}

export const DEFAULT_PASTE_FILE_EXTENSION: PasteFileExtension = '.md'

export const PASTE_FILE_EXTENSIONS: readonly PasteFileExtensionOption[] = [
  { value: '.md', label: 'Markdown (.md)' },
  { value: '.txt', label: '纯文本 (.txt)' },
  { value: '.log', label: '日志 (.log)' },
  { value: '.rst', label: 'reStructuredText (.rst)' },
  { value: '.json', label: 'JSON (.json)' },
  { value: '.jsonl', label: 'JSON Lines (.jsonl)' },
  { value: '.yaml', label: 'YAML (.yaml)' },
  { value: '.yml', label: 'YAML (.yml)' },
  { value: '.toml', label: 'TOML (.toml)' },
  { value: '.xml', label: 'XML (.xml)' },
  { value: '.csv', label: 'CSV (.csv)' },
  { value: '.js', label: 'JavaScript (.js)' },
  { value: '.jsx', label: 'JSX (.jsx)' },
  { value: '.ts', label: 'TypeScript (.ts)' },
  { value: '.tsx', label: 'TSX (.tsx)' },
  { value: '.mjs', label: 'JavaScript Module (.mjs)' },
  { value: '.cjs', label: 'CommonJS (.cjs)' },
  { value: '.py', label: 'Python (.py)' },
  { value: '.pyw', label: 'Python Window (.pyw)' },
  { value: '.java', label: 'Java (.java)' },
  { value: '.kt', label: 'Kotlin (.kt)' },
  { value: '.kts', label: 'Kotlin Script (.kts)' },
  { value: '.go', label: 'Go (.go)' },
  { value: '.rs', label: 'Rust (.rs)' },
  { value: '.c', label: 'C (.c)' },
  { value: '.h', label: 'C Header (.h)' },
  { value: '.cc', label: 'C++ (.cc)' },
  { value: '.cpp', label: 'C++ (.cpp)' },
  { value: '.hpp', label: 'C++ Header (.hpp)' },
  { value: '.cs', label: 'C# (.cs)' },
  { value: '.swift', label: 'Swift (.swift)' },
  { value: '.php', label: 'PHP (.php)' },
  { value: '.rb', label: 'Ruby (.rb)' },
  { value: '.sh', label: 'Shell (.sh)' },
  { value: '.bash', label: 'Bash (.bash)' },
  { value: '.zsh', label: 'Zsh (.zsh)' },
  { value: '.fish', label: 'Fish (.fish)' },
  { value: '.sql', label: 'SQL (.sql)' },
  { value: '.html', label: 'HTML (.html)' },
  { value: '.htm', label: 'HTML (.htm)' },
  { value: '.css', label: 'CSS (.css)' },
  { value: '.scss', label: 'SCSS (.scss)' },
  { value: '.sass', label: 'Sass (.sass)' },
  { value: '.less', label: 'Less (.less)' },
  { value: '.vue', label: 'Vue (.vue)' },
  { value: '.svelte', label: 'Svelte (.svelte)' },
  { value: '.astro', label: 'Astro (.astro)' },
  { value: '.ini', label: 'INI (.ini)' },
  { value: '.conf', label: '配置 (.conf)' },
  { value: '.env', label: 'Environment (.env)' },
  { value: '.dockerfile', label: 'Dockerfile (.dockerfile)' },
  { value: '.graphql', label: 'GraphQL (.graphql)' },
  { value: '.proto', label: 'Protocol Buffers (.proto)' },
]

const PASTE_FILE_EXTENSION_SET = new Set<PasteFileExtension>(PASTE_FILE_EXTENSIONS.map(option => option.value))

export function normalizePasteFileExtension(value: unknown): PasteFileExtension {
  return typeof value === 'string' && PASTE_FILE_EXTENSION_SET.has(value as PasteFileExtension)
    ? value as PasteFileExtension
    : DEFAULT_PASTE_FILE_EXTENSION
}
