// TODO: Use a library for more robust detection
/**
 * Detect programming language from file path extension
 * Used for syntax highlighting in diff viewers and code displays
 */
export function detectLanguage(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase()

  const languageMap: Record<string, string> = {
    // TypeScript / JavaScript
    ts: 'typescript',
    tsx: 'typescript',
    js: 'javascript',
    jsx: 'javascript',
    mjs: 'javascript',
    cjs: 'javascript',

    // Python
    py: 'python',
    pyw: 'python',

    // Web
    html: 'html',
    htm: 'html',
    css: 'css',
    scss: 'scss',
    sass: 'sass',
    less: 'less',

    // Data formats
    json: 'json',
    jsonc: 'json',
    yaml: 'yaml',
    yml: 'yaml',
    xml: 'xml',
    toml: 'toml',

    // Markdown / Docs
    md: 'markdown',
    mdx: 'markdown',
    rst: 'restructuredtext',

    // Shell
    sh: 'bash',
    bash: 'bash',
    zsh: 'bash',
    fish: 'bash',

    // Systems programming
    c: 'c',
    h: 'c',
    cpp: 'cpp',
    cc: 'cpp',
    cxx: 'cpp',
    hpp: 'cpp',
    rs: 'rust',
    go: 'go',

    // JVM languages
    java: 'java',
    kt: 'kotlin',
    kts: 'kotlin',
    scala: 'scala',

    // Other popular languages
    rb: 'ruby',
    php: 'php',
    swift: 'swift',
    cs: 'csharp',
    sql: 'sql',
    r: 'r',
    lua: 'lua',
    perl: 'perl',
    pl: 'perl',

    // Config files
    ini: 'ini',
    cfg: 'ini',
    conf: 'ini',
    env: 'bash',

    // Docker / Infrastructure
    dockerfile: 'dockerfile',
    dockerignore: 'ignore',
    gitignore: 'ignore',

    // Build files
    makefile: 'makefile',
    gradle: 'gradle',
  }

  // Handle special cases
  const fileName = filePath.split('/').pop()?.toLowerCase() || ''
  if (fileName === 'dockerfile') return 'dockerfile'
  if (fileName === 'makefile') return 'makefile'
  if (fileName.includes('gitignore')) return 'ignore'
  if (fileName.includes('dockerignore')) return 'ignore'

  return languageMap[ext || ''] || 'plaintext'
}
