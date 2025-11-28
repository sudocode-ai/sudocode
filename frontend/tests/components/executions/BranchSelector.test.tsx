import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BranchSelector } from '@/components/executions/BranchSelector'
import { TooltipProvider } from '@/components/ui/tooltip'

const renderWithProviders = (ui: React.ReactElement) => {
  return render(<TooltipProvider>{ui}</TooltipProvider>)
}

describe('BranchSelector', () => {
  const mockBranches = ['main', 'develop', 'feature/auth', 'feature/ui-updates']
  const mockOnChange = vi.fn()

  beforeEach(() => {
    mockOnChange.mockClear()
  })

  it('renders with the selected branch value', () => {
    renderWithProviders(
      <BranchSelector branches={mockBranches} value="main" onChange={mockOnChange} />
    )

    expect(screen.getByRole('combobox')).toHaveTextContent('main')
  })

  it('renders placeholder when no value is selected', () => {
    renderWithProviders(
      <BranchSelector
        branches={mockBranches}
        value=""
        onChange={mockOnChange}
        placeholder="Select a branch..."
      />
    )

    expect(screen.getByRole('combobox')).toHaveTextContent('Select a branch...')
  })

  it('opens dropdown and shows all branches', async () => {
    const user = userEvent.setup()

    renderWithProviders(
      <BranchSelector branches={mockBranches} value="main" onChange={mockOnChange} />
    )

    await user.click(screen.getByRole('combobox'))

    // All branches should be visible (main appears twice: trigger + list)
    expect(screen.getAllByText('main').length).toBeGreaterThanOrEqual(2)
    expect(screen.getByText('develop')).toBeInTheDocument()
    expect(screen.getByText('feature/auth')).toBeInTheDocument()
    expect(screen.getByText('feature/ui-updates')).toBeInTheDocument()
  })

  it('filters branches based on search term', async () => {
    const user = userEvent.setup()

    renderWithProviders(
      <BranchSelector branches={mockBranches} value="main" onChange={mockOnChange} />
    )

    await user.click(screen.getByRole('combobox'))

    const searchInput = screen.getByPlaceholderText('Search or create branch...')
    await user.type(searchInput, 'feature')

    // Only feature branches should be visible in the list
    // main still appears in combobox trigger but not as a list option
    const mainTexts = screen.getAllByText('main')
    // Should only be one (in the combobox), not two (combobox + list)
    expect(mainTexts.length).toBe(1)
    expect(screen.getByText('feature/auth')).toBeInTheDocument()
    expect(screen.getByText('feature/ui-updates')).toBeInTheDocument()
  })

  it('calls onChange when selecting a branch', async () => {
    const user = userEvent.setup()

    renderWithProviders(
      <BranchSelector branches={mockBranches} value="main" onChange={mockOnChange} />
    )

    await user.click(screen.getByRole('combobox'))
    await user.click(screen.getByText('develop'))

    expect(mockOnChange).toHaveBeenCalledWith('develop', false)
  })

  it('shows "Create branch" option when search term is a new branch name', async () => {
    const user = userEvent.setup()

    renderWithProviders(
      <BranchSelector
        branches={mockBranches}
        value="main"
        onChange={mockOnChange}
        allowCreate={true}
      />
    )

    await user.click(screen.getByRole('combobox'))

    const searchInput = screen.getByPlaceholderText('Search or create branch...')
    await user.type(searchInput, 'new-feature')

    expect(screen.getByText(/Create/)).toBeInTheDocument()
    expect(screen.getByText('"new-feature"')).toBeInTheDocument()
  })

  it('shows current branch in create option', async () => {
    const user = userEvent.setup()

    renderWithProviders(
      <BranchSelector
        branches={mockBranches}
        value="main"
        onChange={mockOnChange}
        allowCreate={true}
        currentBranch="develop"
      />
    )

    await user.click(screen.getByRole('combobox'))

    const searchInput = screen.getByPlaceholderText('Search or create branch...')
    await user.type(searchInput, 'new-feature')

    expect(screen.getByText(/from "develop"/)).toBeInTheDocument()
  })

  it('does not show create option for existing branch names', async () => {
    const user = userEvent.setup()

    renderWithProviders(
      <BranchSelector
        branches={mockBranches}
        value="main"
        onChange={mockOnChange}
        allowCreate={true}
      />
    )

    await user.click(screen.getByRole('combobox'))

    const searchInput = screen.getByPlaceholderText('Search or create branch...')
    await user.type(searchInput, 'develop')

    // Should not show create option since 'develop' already exists
    expect(screen.queryByText(/Create/)).not.toBeInTheDocument()
  })

  it('calls onChange with isNew=true when creating a new branch', async () => {
    const user = userEvent.setup()

    renderWithProviders(
      <BranchSelector
        branches={mockBranches}
        value="main"
        onChange={mockOnChange}
        allowCreate={true}
      />
    )

    await user.click(screen.getByRole('combobox'))

    const searchInput = screen.getByPlaceholderText('Search or create branch...')
    await user.type(searchInput, 'new-feature')

    const createButton = screen.getByText(/Create/).closest('button')!
    await user.click(createButton)

    expect(mockOnChange).toHaveBeenCalledWith('new-feature', true)
  })

  it('does not show create option when allowCreate is false', async () => {
    const user = userEvent.setup()

    renderWithProviders(
      <BranchSelector
        branches={mockBranches}
        value="main"
        onChange={mockOnChange}
        allowCreate={false}
      />
    )

    await user.click(screen.getByRole('combobox'))

    const searchInput = screen.getByPlaceholderText('Search or create branch...')
    await user.type(searchInput, 'new-feature')

    expect(screen.queryByText(/Create/)).not.toBeInTheDocument()
  })

  it('is disabled when disabled prop is true', () => {
    renderWithProviders(
      <BranchSelector
        branches={mockBranches}
        value="main"
        onChange={mockOnChange}
        disabled={true}
      />
    )

    expect(screen.getByRole('combobox')).toBeDisabled()
  })

  it('validates branch name - rejects names starting with dash', async () => {
    const user = userEvent.setup()

    renderWithProviders(
      <BranchSelector
        branches={mockBranches}
        value="main"
        onChange={mockOnChange}
        allowCreate={true}
      />
    )

    await user.click(screen.getByRole('combobox'))

    const searchInput = screen.getByPlaceholderText('Search or create branch...')
    await user.type(searchInput, '-invalid-branch')

    // Should not show create option for invalid branch name
    expect(screen.queryByText(/Create/)).not.toBeInTheDocument()
  })

  it('validates branch name - rejects names with spaces', async () => {
    const user = userEvent.setup()

    renderWithProviders(
      <BranchSelector
        branches={mockBranches}
        value="main"
        onChange={mockOnChange}
        allowCreate={true}
      />
    )

    await user.click(screen.getByRole('combobox'))

    const searchInput = screen.getByPlaceholderText('Search or create branch...')
    await user.type(searchInput, 'invalid branch')

    // Should not show create option for branch name with spaces
    expect(screen.queryByText(/Create/)).not.toBeInTheDocument()
  })

  it('shows "No branches found" when filter returns empty and create is not allowed', async () => {
    const user = userEvent.setup()

    renderWithProviders(
      <BranchSelector
        branches={mockBranches}
        value="main"
        onChange={mockOnChange}
        allowCreate={false}
      />
    )

    await user.click(screen.getByRole('combobox'))

    const searchInput = screen.getByPlaceholderText('Search or create branch...')
    await user.type(searchInput, 'nonexistent-xyz')

    expect(screen.getByText('No branches found')).toBeInTheDocument()
  })
})
