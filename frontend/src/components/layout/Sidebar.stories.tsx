import React from 'react'
import type { Meta, StoryObj } from '@storybook/react'
import Sidebar from './Sidebar'

const meta: Meta<typeof Sidebar> = {
  title: 'Layout/Sidebar',
  component: Sidebar,
  parameters: {
    layout: 'fullscreen',
  },
  decorators: [
    (Story) => (
      <div className="flex h-screen">
        <Story />
        <div className="flex-1 bg-muted/20 p-4">
          <p className="text-muted-foreground">Main content area</p>
        </div>
      </div>
    ),
  ],
}

export default meta
type Story = StoryObj<typeof Sidebar>

export const Expanded: Story = {
  args: {
    open: true,
    collapsed: false,
  },
}

export const Collapsed: Story = {
  args: {
    open: true,
    collapsed: true,
  },
}

export const MobileOpen: Story = {
  args: {
    open: true,
    collapsed: false,
    onClose: () => console.log('Close clicked'),
  },
  parameters: {
    viewport: {
      defaultViewport: 'mobile1',
    },
  },
}

export const MobileClosed: Story = {
  args: {
    open: false,
    collapsed: false,
  },
  parameters: {
    viewport: {
      defaultViewport: 'mobile1',
    },
  },
}

export const ToggleDemo: Story = {
  render: function ToggleDemo() {
    const [collapsed, setCollapsed] = React.useState(false)
    return (
      <div className="flex h-screen">
        <Sidebar open={true} collapsed={collapsed} />
        <div className="flex-1 bg-muted/20 p-4">
          <button
            onClick={() => setCollapsed(!collapsed)}
            className="px-4 py-2 bg-primary text-primary-foreground rounded-md"
          >
            {collapsed ? 'Expand' : 'Collapse'} Sidebar
          </button>
        </div>
      </div>
    )
  },
}
