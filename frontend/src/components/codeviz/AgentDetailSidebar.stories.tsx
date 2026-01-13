import React from 'react'
import type { Meta, StoryObj } from '@storybook/react'
import { AgentDetailSidebar } from './AgentDetailSidebar'

const meta: Meta<typeof AgentDetailSidebar> = {
  title: 'CodeViz/AgentDetailSidebar',
  component: AgentDetailSidebar,
  parameters: {
    layout: 'fullscreen',
  },
  args: {
    onClose: () => console.log('onClose'),
    onFileHover: (path: string) => console.log('onFileHover', path),
    onFileLeave: (path: string) => console.log('onFileLeave', path),
  },
}

export default meta
type Story = StoryObj<typeof AgentDetailSidebar>

export const Open: Story = {
  args: {
    executionId: 'exec-001',
    isOpen: true,
  },
  parameters: {
    docs: {
      description: {
        story: 'Sidebar in open state. In a real app, this would fetch execution data from the API.',
      },
    },
  },
}

export const Closed: Story = {
  args: {
    executionId: 'exec-001',
    isOpen: false,
  },
}

// Show sidebar alongside a simulated map area
export const WithMapLayout: Story = {
  render: (args) => (
    <div className="flex h-screen">
      <div
        className="flex-1 flex items-center justify-center bg-muted/20 transition-all duration-300"
        style={{ marginRight: args.isOpen ? '350px' : '0' }}
      >
        <div className="text-muted-foreground text-center">
          <p className="text-lg font-medium">Code Map Area</p>
          <p className="text-sm">This area would contain the interactive code map.</p>
          <p className="text-sm mt-2">The sidebar slides in from the right.</p>
        </div>
      </div>
      <AgentDetailSidebar {...args} />
    </div>
  ),
  args: {
    executionId: 'exec-001',
    isOpen: true,
  },
}

export const ToggleDemo: Story = {
  render: function ToggleDemo() {
    const [isOpen, setIsOpen] = React.useState(true)
    return (
      <div className="flex h-screen">
        <div
          className="flex-1 flex flex-col items-center justify-center bg-muted/20 transition-all duration-300"
          style={{ marginRight: isOpen ? '350px' : '0' }}
        >
          <div className="text-muted-foreground text-center mb-4">
            <p className="text-lg font-medium">Code Map Area</p>
            <p className="text-sm">Click the button to toggle the sidebar</p>
          </div>
          <button
            onClick={() => setIsOpen(!isOpen)}
            className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90"
          >
            {isOpen ? 'Close Sidebar' : 'Open Sidebar'}
          </button>
        </div>
        <AgentDetailSidebar executionId="exec-001" isOpen={isOpen} onClose={() => setIsOpen(false)} />
      </div>
    )
  },
}
