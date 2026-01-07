import { useMemo } from 'react'
import {
  CodeMapComponent,
  useLayout,
  ThemeProvider as CodevizThemeProvider,
  type CodeGraph,
  type FileNode as CodevizFileNode,
  type DirectoryNode as CodevizDirectoryNode,
  type CodebaseMetadata,
  generateFileId,
  generateDirectoryId,
  detectLanguage,
} from 'codeviz/browser'
import { useFileTree, type FileTreeResponse } from '@/hooks/useFileTree'
import { useTheme } from '@/contexts/ThemeContext'
import { Loader2 } from 'lucide-react'

/**
 * Transform FileTreeResponse from the server into codeviz CodeGraph format.
 */
function transformToCodeGraph(fileTree: FileTreeResponse): CodeGraph {
  const { files, directories, metadata } = fileTree

  // Build a map of directory paths to their info for quick lookup
  const directoryMap = new Map<string, { path: string; name: string; parentPath: string | null }>()
  directories.forEach((dir) => {
    directoryMap.set(dir.path, dir)
  })

  // Build directory children map
  const directoryChildren = new Map<string, string[]>()
  const directoryFiles = new Map<string, string[]>()

  // Initialize root directory (empty path)
  directoryChildren.set('', [])
  directoryFiles.set('', [])

  directories.forEach((dir) => {
    directoryChildren.set(dir.path, [])
    directoryFiles.set(dir.path, [])
  })

  // Populate children relationships
  directories.forEach((dir) => {
    if (dir.parentPath) {
      const siblings = directoryChildren.get(dir.parentPath)
      if (siblings) {
        siblings.push(generateDirectoryId(dir.path))
      }
    } else {
      // Top-level directory - add to root's children
      const rootChildren = directoryChildren.get('')
      if (rootChildren) {
        rootChildren.push(generateDirectoryId(dir.path))
      }
    }
  })

  // Transform files
  const codevizFiles: CodevizFileNode[] = files.map((file) => {
    const fileId = generateFileId(file.path)
    const dirId = file.directoryPath ? generateDirectoryId(file.directoryPath) : generateDirectoryId('')

    // Add file to directory's files list
    const dirFiles = directoryFiles.get(file.directoryPath)
    if (dirFiles) {
      dirFiles.push(fileId)
    }

    return {
      id: fileId,
      path: file.path,
      name: file.name,
      extension: file.extension,
      directoryId: dirId,
      metrics: {
        loc: 100, // Default placeholder since we don't have actual LOC
        totalLines: 100,
        exportCount: 0,
        importCount: 0,
      },
      symbols: [],
      language: detectLanguage(file.extension),
    }
  })

  // Create root directory ID
  const rootDirId = generateDirectoryId('')

  // Transform directories - all top-level dirs should have root as parent
  const codevizDirectories: CodevizDirectoryNode[] = directories.map((dir) => {
    const dirId = generateDirectoryId(dir.path)
    // Top-level directories (parentPath === null) should have root as parent
    const parentId = dir.parentPath ? generateDirectoryId(dir.parentPath) : rootDirId
    const depth = dir.path.split('/').filter(Boolean).length

    return {
      id: dirId,
      path: dir.path,
      name: dir.name,
      parentId,
      children: directoryChildren.get(dir.path) || [],
      files: directoryFiles.get(dir.path) || [],
      metrics: {
        fileCount: (directoryFiles.get(dir.path) || []).length,
        totalLoc: (directoryFiles.get(dir.path) || []).length * 100,
      },
      depth,
    }
  })

  // Always add root directory (uses pre-built children and files lists)
  const rootDir: CodevizDirectoryNode = {
    id: rootDirId,
    path: '',
    name: 'root',
    parentId: null,
    children: directoryChildren.get('') || [],
    files: directoryFiles.get('') || [],
    metrics: {
      fileCount: metadata.totalFiles,
      totalLoc: metadata.totalFiles * 100,
    },
    depth: 0,
  }

  codevizDirectories.unshift(rootDir)

  const codeGraphMetadata: CodebaseMetadata = {
    rootPath: '.',
    analyzedAt: metadata.generatedAt,
    totalFiles: metadata.totalFiles,
    totalDirectories: metadata.totalDirectories,
    totalSymbols: 0,
    languages: [...new Set(codevizFiles.map((f) => f.language))],
    analysisDurationMs: 0,
  }

  return {
    files: codevizFiles,
    directories: codevizDirectories,
    symbols: [],
    imports: [],
    calls: [],
    metadata: codeGraphMetadata,
  }
}

/**
 * Loading state component
 */
function LoadingState() {
  return (
    <div className="flex h-full items-center justify-center">
      <div className="flex flex-col items-center gap-2 text-muted-foreground">
        <Loader2 className="h-8 w-8 animate-spin" />
        <span>Loading codebase...</span>
      </div>
    </div>
  )
}

/**
 * Error state component
 */
function ErrorState({ error }: { error: Error }) {
  return (
    <div className="flex h-full items-center justify-center">
      <div className="flex flex-col items-center gap-2 text-destructive">
        <span>Failed to load codebase</span>
        <span className="text-sm text-muted-foreground">{error.message}</span>
      </div>
    </div>
  )
}

/**
 * Empty state component
 */
function EmptyState() {
  return (
    <div className="flex h-full items-center justify-center">
      <div className="text-muted-foreground">No files found in codebase</div>
    </div>
  )
}

/**
 * CodeMapContainer - Fetches file tree and renders the codeviz CodeMapComponent
 */
export function CodeMapContainer() {
  const { data: fileTree, isLoading, error } = useFileTree()
  const { theme: appTheme } = useTheme()

  // Transform file tree to CodeGraph
  const codeGraph = useMemo(() => {
    if (!fileTree) return null
    return transformToCodeGraph(fileTree)
  }, [fileTree])

  // Compute layout using codeviz hook
  const { codeMap, isComputing, error: layoutError } = useLayout(codeGraph)

  // Loading states
  if (isLoading) {
    return <LoadingState />
  }

  if (error) {
    return <ErrorState error={error} />
  }

  if (!fileTree || fileTree.files.length === 0) {
    return <EmptyState />
  }

  if (isComputing) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="flex flex-col items-center gap-2 text-muted-foreground">
          <Loader2 className="h-8 w-8 animate-spin" />
          <span>Computing layout...</span>
        </div>
      </div>
    )
  }

  if (layoutError) {
    return <ErrorState error={layoutError} />
  }

  if (!codeMap) {
    return <EmptyState />
  }

  // Map app theme to codeviz theme
  const codevizTheme = appTheme === 'dark' ? 'dark' : 'light'

  return (
    <CodevizThemeProvider initialTheme={codevizTheme}>
      <CodeMapComponent
        codeMap={codeMap}
        onNodeClick={(nodeId, node) => {
          console.log('Node clicked:', nodeId, node)
        }}
        onZoomLevelChange={(level) => {
          console.log('Zoom level:', level)
        }}
      />
    </CodevizThemeProvider>
  )
}
