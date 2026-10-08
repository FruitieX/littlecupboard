import {
  createRootRoute,
  HeadContent,
  Outlet,
  Scripts,
} from '@tanstack/react-router'
import stylesheet from '../styles.css?url'
import { AppProvider } from '../lib/state'
import { APP_NAME } from '../lib/brand'
import { AppUpdate } from '../components/AppUpdate'

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      {
        name: 'viewport',
        // App-like: no pinch or double-tap zoom. System text size and
        // accessibility zoom still apply.
        content:
          'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover',
      },
      { title: `${APP_NAME} · Shopping, recipes & meals` },
      { name: 'theme-color', content: '#1e4938' },
      {
        name: 'description',
        content:
          'Shared shopping lists, recipes, weekly meals and pantry supplies.',
      },
    ],
    links: [
      { rel: 'stylesheet', href: stylesheet },
      { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' },
      { rel: 'manifest', href: '/manifest.webmanifest' },
      { rel: 'apple-touch-icon', href: '/icon-192.png' },
    ],
  }),
  component: () => (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        <AppProvider>
          <Outlet />
        </AppProvider>
        <AppUpdate />
        <Scripts />
      </body>
    </html>
  ),
})
