import { describe, it, expect } from 'vitest'
import { screen } from '@testing-library/react'
import { renderWithProviders } from '@/test/test-utils'
import { ProviderIcon, getProviderDisplayName } from '@/components/import/ProviderIcon'

describe('ProviderIcon', () => {
  it('should render GitHub icon for github provider', () => {
    renderWithProviders(<ProviderIcon provider="github" />)
    // GitHub icon uses SVG from lucide-react
    const svg = document.querySelector('svg')
    expect(svg).toBeInTheDocument()
    expect(svg).toHaveClass('h-5', 'w-5')
  })

  it('should render Jira icon for jira provider', () => {
    renderWithProviders(<ProviderIcon provider="jira" />)
    expect(screen.getByText('J')).toBeInTheDocument()
  })

  it('should render Linear icon for linear provider', () => {
    renderWithProviders(<ProviderIcon provider="linear" />)
    expect(screen.getByText('L')).toBeInTheDocument()
  })

  it('should render Notion icon for notion provider', () => {
    renderWithProviders(<ProviderIcon provider="notion" />)
    expect(screen.getByText('N')).toBeInTheDocument()
  })

  it('should render generic icon for unknown provider', () => {
    renderWithProviders(<ProviderIcon provider="unknown" />)
    // Cloud icon from lucide-react
    const svg = document.querySelector('svg')
    expect(svg).toBeInTheDocument()
    expect(svg).toHaveClass('text-muted-foreground')
  })

  it('should apply size classes correctly', () => {
    const { container, rerender } = renderWithProviders(
      <ProviderIcon provider="github" size="sm" />
    )
    let svg = container.querySelector('svg')
    expect(svg).toHaveClass('h-4', 'w-4')

    rerender(<ProviderIcon provider="github" size="md" />)
    svg = container.querySelector('svg')
    expect(svg).toHaveClass('h-5', 'w-5')

    rerender(<ProviderIcon provider="github" size="lg" />)
    svg = container.querySelector('svg')
    expect(svg).toHaveClass('h-6', 'w-6')
  })

  it('should handle case-insensitive provider names', () => {
    renderWithProviders(<ProviderIcon provider="GITHUB" />)
    // Should render GitHub icon (SVG)
    const svg = document.querySelector('svg')
    expect(svg).toBeInTheDocument()
  })

  it('should apply custom className', () => {
    const { container } = renderWithProviders(
      <ProviderIcon provider="github" className="custom-class" />
    )
    const svg = container.querySelector('svg')
    expect(svg).toHaveClass('custom-class')
  })
})

describe('getProviderDisplayName', () => {
  it('should return proper display name for known providers', () => {
    expect(getProviderDisplayName('github')).toBe('GitHub')
    expect(getProviderDisplayName('jira')).toBe('Jira')
    expect(getProviderDisplayName('linear')).toBe('Linear')
    expect(getProviderDisplayName('beads')).toBe('Beads')
    expect(getProviderDisplayName('notion')).toBe('Notion')
  })

  it('should return original name for unknown providers', () => {
    expect(getProviderDisplayName('unknown')).toBe('unknown')
    expect(getProviderDisplayName('custom-provider')).toBe('custom-provider')
  })

  it('should handle case-insensitive lookup', () => {
    expect(getProviderDisplayName('GITHUB')).toBe('GitHub')
    expect(getProviderDisplayName('GitHub')).toBe('GitHub')
  })
})
