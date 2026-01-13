import type { Meta, StoryObj } from '@storybook/react'
import { DiffViewer } from './DiffViewer'

const meta: Meta<typeof DiffViewer> = {
  title: 'Executions/DiffViewer',
  component: DiffViewer,
  parameters: {
    layout: 'padded',
  },
}

export default meta
type Story = StoryObj<typeof DiffViewer>

const oldTypeScript = `interface User {
  id: string
  name: string
}

function getUser(id: string): User {
  return { id, name: 'John' }
}`

const newTypeScript = `interface User {
  id: string
  name: string
  email: string
  createdAt: Date
}

function getUser(id: string): User | null {
  if (!id) return null
  return {
    id,
    name: 'John',
    email: 'john@example.com',
    createdAt: new Date()
  }
}`

export const TypeScriptDiff: Story = {
  args: {
    filePath: 'src/types/user.ts',
    oldContent: oldTypeScript,
    newContent: newTypeScript,
  },
}

export const SideBySide: Story = {
  args: {
    filePath: 'src/types/user.ts',
    oldContent: oldTypeScript,
    newContent: newTypeScript,
    sideBySide: true,
  },
}

const oldPython = `def hello(name):
    print(f"Hello, {name}")

hello("World")`

const newPython = `def hello(name: str) -> None:
    """Greet a user by name."""
    if not name:
        raise ValueError("Name cannot be empty")
    print(f"Hello, {name}!")

def goodbye(name: str) -> None:
    """Say goodbye to a user."""
    print(f"Goodbye, {name}!")

if __name__ == "__main__":
    hello("World")
    goodbye("World")`

export const PythonDiff: Story = {
  args: {
    filePath: 'main.py',
    oldContent: oldPython,
    newContent: newPython,
  },
}

const oldJson = `{
  "name": "my-app",
  "version": "1.0.0"
}`

const newJson = `{
  "name": "my-app",
  "version": "1.1.0",
  "description": "My awesome application",
  "dependencies": {
    "react": "^18.2.0",
    "typescript": "^5.0.0"
  }
}`

export const JSONDiff: Story = {
  args: {
    filePath: 'package.json',
    oldContent: oldJson,
    newContent: newJson,
  },
}

export const NewFile: Story = {
  args: {
    filePath: 'src/utils/helpers.ts',
    oldContent: '',
    newContent: `export function formatDate(date: Date): string {
  return date.toLocaleDateString()
}

export function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1)
}`,
  },
}

export const DeletedFile: Story = {
  args: {
    filePath: 'src/deprecated/oldCode.ts',
    oldContent: `// This file is no longer needed
export const LEGACY_CONSTANT = 'old value'

export function deprecatedFunction() {
  console.warn('This function is deprecated')
}`,
    newContent: '',
  },
}

export const LargeDiff: Story = {
  args: {
    filePath: 'src/components/LargeComponent.tsx',
    oldContent: Array.from({ length: 100 }, (_, i) => `// Line ${i + 1}`).join('\n'),
    newContent: Array.from({ length: 100 }, (_, i) => `// Updated line ${i + 1}`).join('\n'),
    maxLines: 50,
  },
}
