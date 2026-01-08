/**
 * Mock for codeviz/browser module used in tests.
 * This provides stub implementations of the codeviz library components and hooks.
 */

import React from 'react'
import { vi } from 'vitest'

// Mock CodeMapComponent
export const CodeMapComponent = ({
  codeMap,
  overlayPort,
}: {
  codeMap: any
  overlayPort?: any
  onNodeClick?: (nodeId: string, node: any) => void
  onZoomLevelChange?: (level: number) => void
}) =>
  React.createElement(
    'div',
    { 'data-testid': 'code-map-component' },
    React.createElement('span', { 'data-testid': 'file-count' }, codeMap?.files?.length ?? 0),
    overlayPort && React.createElement('span', { 'data-testid': 'has-overlay-port' }, 'true')
  )

// Mock useLayout hook
export const useLayout = (codeGraph: any) => ({
  codeMap: codeGraph
    ? {
        files: codeGraph.files,
        directories: codeGraph.directories,
      }
    : null,
  isComputing: false,
  error: null,
})

// Mock useOverlayPort hook
export const useOverlayPort = () => ({
  port: {
    bind: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
    clear: vi.fn(),
    getOverlays: vi.fn().mockReturnValue([]),
  },
})

// Mock ThemeProvider
export const ThemeProvider = ({ children }: { children: React.ReactNode }) =>
  React.createElement(React.Fragment, null, children)

// Utility functions
export const generateFileId = (path: string) => `file-${path}`
export const generateDirectoryId = (path: string) => `dir-${path || 'root'}`
export const detectLanguage = (ext: string) => {
  const langMap: Record<string, string> = {
    ts: 'typescript',
    tsx: 'typescript',
    js: 'javascript',
    jsx: 'javascript',
    py: 'python',
    rs: 'rust',
    go: 'go',
    java: 'java',
    md: 'markdown',
    json: 'json',
    css: 'css',
    html: 'html',
  }
  return langMap[ext] || 'unknown'
}

// Type exports (empty interfaces for mock purposes)
export type CodeGraph = any
export type FileNode = any
export type DirectoryNode = any
export type CodebaseMetadata = any
