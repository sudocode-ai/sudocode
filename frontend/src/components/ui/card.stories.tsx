import type { Meta, StoryObj } from '@storybook/react'
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from './card'
import { Button } from './button'
import { Input } from './input'
import { Label } from './label'

const meta: Meta<typeof Card> = {
  title: 'UI/Card',
  component: Card,
  parameters: {
    layout: 'centered',
  },
  decorators: [
    (Story) => (
      <div className="w-[350px]">
        <Story />
      </div>
    ),
  ],
}

export default meta
type Story = StoryObj<typeof Card>

export const Default: Story = {
  render: () => (
    <Card>
      <CardHeader>
        <CardTitle>Card Title</CardTitle>
        <CardDescription>Card Description</CardDescription>
      </CardHeader>
      <CardContent>
        <p>Card Content</p>
      </CardContent>
      <CardFooter>
        <p className="text-sm text-muted-foreground">Card Footer</p>
      </CardFooter>
    </Card>
  ),
}

export const WithForm: Story = {
  render: () => (
    <Card>
      <CardHeader>
        <CardTitle>Create project</CardTitle>
        <CardDescription>Deploy your new project in one-click.</CardDescription>
      </CardHeader>
      <CardContent>
        <form>
          <div className="grid w-full items-center gap-4">
            <div className="flex flex-col space-y-1.5">
              <Label htmlFor="name">Name</Label>
              <Input id="name" placeholder="Name of your project" />
            </div>
          </div>
        </form>
      </CardContent>
      <CardFooter className="flex justify-between">
        <Button variant="outline">Cancel</Button>
        <Button>Deploy</Button>
      </CardFooter>
    </Card>
  ),
}

export const Simple: Story = {
  render: () => (
    <Card className="p-6">
      <p>A simple card with just content and padding.</p>
    </Card>
  ),
}

export const Interactive: Story = {
  render: () => (
    <Card className="cursor-pointer transition-shadow hover:shadow-lg">
      <CardHeader>
        <CardTitle>Clickable Card</CardTitle>
        <CardDescription>Hover over me to see the effect</CardDescription>
      </CardHeader>
      <CardContent>
        <p>This card has hover effects applied.</p>
      </CardContent>
    </Card>
  ),
}
