/**
 * Tests for language detection utility
 */

import { describe, it, expect } from 'vitest'
import { detectLanguage } from '@/utils/languageDetector'

describe('detectLanguage', () => {
  it('detects TypeScript files', () => {
    expect(detectLanguage('component.ts')).toBe('typescript')
    expect(detectLanguage('component.tsx')).toBe('typescript')
    expect(detectLanguage('path/to/file.ts')).toBe('typescript')
  })

  it('detects JavaScript files', () => {
    expect(detectLanguage('script.js')).toBe('javascript')
    expect(detectLanguage('component.jsx')).toBe('javascript')
    expect(detectLanguage('config.mjs')).toBe('javascript')
    expect(detectLanguage('config.cjs')).toBe('javascript')
  })

  it('detects Python files', () => {
    expect(detectLanguage('script.py')).toBe('python')
    expect(detectLanguage('module.pyw')).toBe('python')
  })

  it('detects web languages', () => {
    expect(detectLanguage('page.html')).toBe('html')
    expect(detectLanguage('styles.css')).toBe('css')
    expect(detectLanguage('styles.scss')).toBe('scss')
    expect(detectLanguage('styles.sass')).toBe('sass')
    expect(detectLanguage('styles.less')).toBe('less')
  })

  it('detects config/data formats', () => {
    expect(detectLanguage('config.json')).toBe('json')
    expect(detectLanguage('data.yaml')).toBe('yaml')
    expect(detectLanguage('data.yml')).toBe('yaml')
    expect(detectLanguage('data.xml')).toBe('xml')
    expect(detectLanguage('config.toml')).toBe('toml')
  })

  it('detects shell scripts', () => {
    expect(detectLanguage('script.sh')).toBe('bash')
    expect(detectLanguage('script.bash')).toBe('bash')
    expect(detectLanguage('script.zsh')).toBe('bash')
  })

  it('detects compiled languages', () => {
    expect(detectLanguage('Main.java')).toBe('java')
    expect(detectLanguage('main.cpp')).toBe('cpp')
    expect(detectLanguage('lib.c')).toBe('c')
    expect(detectLanguage('lib.h')).toBe('c')
    expect(detectLanguage('main.rs')).toBe('rust')
    expect(detectLanguage('main.go')).toBe('go')
  })

  it('detects special filenames without extensions', () => {
    expect(detectLanguage('Dockerfile')).toBe('dockerfile')
    expect(detectLanguage('dockerfile')).toBe('dockerfile')
    expect(detectLanguage('Makefile')).toBe('makefile')
    expect(detectLanguage('makefile')).toBe('makefile')
  })

  it('detects config files', () => {
    expect(detectLanguage('.gitignore')).toBe('ignore')
    expect(detectLanguage('.env')).toBe('bash')
    expect(detectLanguage('.dockerignore')).toBe('ignore')
  })

  it('detects markdown and documentation', () => {
    expect(detectLanguage('README.md')).toBe('markdown')
    expect(detectLanguage('docs.mdx')).toBe('markdown')
  })

  it('returns plaintext for unknown extensions', () => {
    expect(detectLanguage('file.unknown')).toBe('plaintext')
    expect(detectLanguage('no-extension')).toBe('plaintext')
  })

  it('handles paths with multiple dots', () => {
    expect(detectLanguage('component.test.ts')).toBe('typescript')
    expect(detectLanguage('config.production.json')).toBe('json')
  })

  it('is case-insensitive for extensions', () => {
    expect(detectLanguage('FILE.TS')).toBe('typescript')
    expect(detectLanguage('FILE.JSON')).toBe('json')
  })

  it('handles paths with directories', () => {
    expect(detectLanguage('src/components/Button.tsx')).toBe('typescript')
    expect(detectLanguage('/absolute/path/to/file.js')).toBe('javascript')
  })
})
