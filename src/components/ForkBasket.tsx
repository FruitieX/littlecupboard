import { Link } from '@tanstack/react-router'
import { ShoppingBasket, CalendarDays, BookOpen, Settings2 } from 'lucide-react'
import { Shopping } from './Shopping'
import { Week } from './Week'
import { Recipes } from './Recipes'
import { Settings } from './Settings'
import { Brand } from './ui'
import { MotionConfig } from 'motion/react'
import { FoodIcon } from './FoodIcon'
import { useApp } from '../lib/state'
import { ConnectionStatus } from './ConnectionStatus'
import { Assistant } from './Assistant'

export type View = 'shopping' | 'week' | 'recipes' | 'settings'
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
    view: 'settings',
    to: '/settings',
    label: 'Settings',
    short: 'Settings',
    icon: Settings2,
  },
] as const

export function ForkBasket({ view = 'shopping' }: { view?: View }) {
  const { session, error, clearError } = useApp()
  return (
    <MotionConfig reducedMotion="user">
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
            {view === 'settings' && <Settings />}
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
    </MotionConfig>
  )
}
