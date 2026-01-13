import type { Preview } from '@storybook/react-vite'
import '../src/index.css'
import React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { ProjectProvider } from '../src/contexts/ProjectContext'
import { ThemeProvider } from '../src/contexts/ThemeContext'
import { WebSocketProvider } from '../src/contexts/WebSocketContext'

// Create a client for React Query
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      staleTime: 5 * 60 * 1000,
    },
  },
})

const preview: Preview = {
  parameters: {
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
    backgrounds: {
      default: 'dark',
      values: [
        { name: 'dark', value: '#0a0a0a' },
        { name: 'light', value: '#ffffff' },
      ],
    },
  },
  decorators: [
    (Story) =>
      React.createElement(
        QueryClientProvider,
        { client: queryClient },
        React.createElement(
          ThemeProvider,
          null,
          React.createElement(
            ProjectProvider,
            { defaultProjectId: 'storybook-project', skipValidation: true },
            React.createElement(
              WebSocketProvider,
              { reconnect: false },
              React.createElement(
                MemoryRouter,
                null,
                React.createElement(
                  'div',
                  { className: 'bg-background text-foreground p-4' },
                  React.createElement(Story)
                )
              )
            )
          )
        )
      ),
  ],
}

export default preview
