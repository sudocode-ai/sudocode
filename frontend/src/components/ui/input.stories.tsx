import type { Meta, StoryObj } from '@storybook/react'
import { Input } from './input'
import { Label } from './label'

const meta: Meta<typeof Input> = {
  title: 'UI/Input',
  component: Input,
  parameters: {
    layout: 'centered',
  },
  decorators: [
    (Story) => (
      <div className="w-[300px]">
        <Story />
      </div>
    ),
  ],
}

export default meta
type Story = StoryObj<typeof Input>

export const Default: Story = {
  args: {
    placeholder: 'Enter text...',
  },
}

export const WithLabel: Story = {
  render: () => (
    <div className="grid w-full items-center gap-1.5">
      <Label htmlFor="email">Email</Label>
      <Input type="email" id="email" placeholder="Email" />
    </div>
  ),
}

export const Disabled: Story = {
  args: {
    disabled: true,
    placeholder: 'Disabled input',
  },
}

export const WithValue: Story = {
  args: {
    defaultValue: 'Hello World',
  },
}

export const Password: Story = {
  args: {
    type: 'password',
    placeholder: 'Enter password...',
  },
}

export const Search: Story = {
  args: {
    type: 'search',
    placeholder: 'Search...',
  },
}

export const File: Story = {
  args: {
    type: 'file',
  },
}

export const AllTypes: Story = {
  render: () => (
    <div className="flex flex-col gap-4">
      <div className="grid w-full items-center gap-1.5">
        <Label htmlFor="text">Text</Label>
        <Input type="text" id="text" placeholder="Text input" />
      </div>
      <div className="grid w-full items-center gap-1.5">
        <Label htmlFor="email2">Email</Label>
        <Input type="email" id="email2" placeholder="email@example.com" />
      </div>
      <div className="grid w-full items-center gap-1.5">
        <Label htmlFor="password2">Password</Label>
        <Input type="password" id="password2" placeholder="Password" />
      </div>
      <div className="grid w-full items-center gap-1.5">
        <Label htmlFor="number">Number</Label>
        <Input type="number" id="number" placeholder="0" />
      </div>
    </div>
  ),
}
