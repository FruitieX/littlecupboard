import { Link } from '@tanstack/react-router'
import {
  ShoppingBasket,
  CalendarDays,
  BookOpen,
  Settings2,
  Leaf,
  ArrowUpRight,
} from 'lucide-react'
import { Shopping } from './Shopping'
import { Week } from './Week'
import { Recipes } from './Recipes'
import { Settings } from './Settings'
import { Brand } from './ui'
import { MotionConfig } from 'motion/react'
import { FoodIcon } from './FoodIcon'

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
              <strong>Our family</strong>
              <span>Demo household</span>
            </div>
          </div>
          <span className="sidebar-label">A LITTLE MORE TOGETHER</span>
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
          {view !== 'shopping' && (
            <div className="sidebar-bottom">
              <span className="little-plant">
                <FoodIcon value="🌱" />
              </span>
              <h3>
                Good food.
                <br />
                Less fuss.
              </h3>
              <p>
                A little less planning.
                <br />A little more living.
              </p>
              <span className="prototype-label">
                INTERACTIVE PROTOTYPE <ArrowUpRight size={12} />
              </span>
            </div>
          )}
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
            {view !== 'shopping' && (
              <span className="topbar-greeting">
                <Leaf size={15} /> A little more room for family time
              </span>
            )}
            <div className="topbar-right">
              <span className="preview-badge">Prototype</span>
              {view !== 'shopping' && (
                <div className="avatars" aria-label="Demo family">
                  <span className="avatar avatar-peach">R</span>
                  <span className="avatar avatar-green">A</span>
                  <span className="avatar avatar-yellow">+2</span>
                </div>
              )}
            </div>
          </header>
          <main id="main-content" className={`main-content view-${view}`}>
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
    </MotionConfig>
  )
}
