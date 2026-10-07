import type { ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import {
  ShoppingBasket,
  CalendarDays,
  BookOpen,
  Settings2,
  Archive,
} from 'lucide-react'
import { Shopping } from './Shopping'
import { Week } from './Week'
import { Recipes } from './Recipes'
import { Cupboard } from './Cupboard'
import { LearningProvider } from '../lib/learning'
import { Settings } from './Settings'
import { Brand } from './ui'
import { MotionConfig } from 'motion/react'
import { FoodIcon } from './FoodIcon'
import { useApp } from '../lib/state'
import { ConnectionStatus } from './ConnectionStatus'
import { Assistant } from './Assistant'
import { APP_ORIGIN, LEGACY_ORIGIN } from '../lib/brand'

export type View = 'shopping' | 'week' | 'recipes' | 'cupboard' | 'settings'
const navigation = [
  {
    view: 'shopping',
    to: '/',
    label: 'Shopping list',
    short: 'Shop',
    icon: ShoppingBasket,
  },
  {
    view: 'week',
    to: '/week',
    label: 'Meal planner',
    short: 'Week',
    icon: CalendarDays,
  },
  {
    view: 'recipes',
    to: '/recipes',
    label: 'Our recipes',
    short: 'Recipes',
    icon: BookOpen,
  },
  {
    view: 'cupboard',
    to: '/cupboard',
    label: 'Our cupboard',
    short: 'Cupboard',
    icon: Archive,
  },
  {
    view: 'settings',
    to: '/settings',
    label: 'Settings',
    short: 'Settings',
    icon: Settings2,
  },
] as const

export function LittleCupboard({
  view = 'shopping',
  children,
}: {
  view?: View
  children?: ReactNode
}) {
  const { session, error, clearError, pending, status } = useApp()
  return (
    <MotionConfig reducedMotion="user">
      <LearningProvider>
        <div
          className={`app-shell ${view === 'shopping' ? 'shopping-screen' : ''}`}
        >
          <a href="#main-content" className="skip-link">
            Skip to content
          </a>
          <aside className="sidebar">
            <Link to="/" className="brand-link" aria-label="Shopping list home">
              <Brand />
            </Link>
            <div className="household">
              <div className="household-icon">
                <FoodIcon value="🏡" />
              </div>
              <div>
                <strong>{session.householdName}</strong>
                <span>{session.user.name}</span>
                <ConnectionStatus />
              </div>
            </div>
            <nav aria-label="Main navigation">
              {navigation.map(({ view: tab, to, label, icon: Icon }) => (
                <Link
                  key={tab}
                  to={to}
                  className={`nav-link ${view === tab ? 'active' : ''}`}
                  aria-current={view === tab ? 'page' : undefined}
                >
                  <Icon size={21} strokeWidth={1.8} />
                  {label}
                  {view === tab && <span className="nav-dot" />}
                </Link>
              ))}
            </nav>
          </aside>
          <div className="main-shell">
            <header className="topbar">
              <Link
                to="/"
                className="mobile-brand"
                aria-label="Shopping list home"
              >
                <Brand />
              </Link>
              <div className="topbar-right">
                <ConnectionStatus />
                {view !== 'shopping' && (
                  <div className="avatars" aria-label="Household members">
                    {session.members.slice(0, 3).map((member, index) => (
                      <span
                        key={member.id}
                        className={`avatar ${['avatar-peach', 'avatar-green', 'avatar-yellow'][index]}`}
                        title={member.name}
                      >
                        {member.name.slice(0, 1).toUpperCase()}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </header>
            <main id="main-content" className={`main-content view-${view}`}>
              {typeof location !== 'undefined' &&
                location.origin === LEGACY_ORIGIN && (
                  <div className="address-notice" role="status">
                    <span>
                      LittleCupboard has a new address. Finish syncing here,
                      then switch.
                    </span>
                    {pending.length === 0 && status === 'live' ? (
                      <a href={APP_ORIGIN}>Open LittleCupboard</a>
                    ) : (
                      <span>Waiting for your changes to sync…</span>
                    )}
                  </div>
                )}
              {error && (
                <div className="form-error app-error" role="alert">
                  {error}
                  <button className="text-button" onClick={clearError}>
                    Dismiss
                  </button>
                </div>
              )}
              {view === 'shopping' && <Shopping />}
              {view === 'week' && <Week />}
              {view === 'recipes' && <Recipes />}
              {view === 'cupboard' && <Cupboard />}
              {view === 'settings' && (children ?? <Settings />)}
            </main>
          </div>
          <nav className="bottom-nav" aria-label="Mobile navigation">
            {navigation.map(({ view: tab, to, short, icon: Icon }) => (
              <Link
                key={tab}
                to={to}
                className={view === tab ? 'active' : ''}
                aria-current={view === tab ? 'page' : undefined}
              >
                <span>
                  <Icon size={22} strokeWidth={view === tab ? 2.2 : 1.7} />
                </span>
                {short}
              </Link>
            ))}
          </nav>
        </div>
        <Assistant />
      </LearningProvider>
    </MotionConfig>
  )
}
