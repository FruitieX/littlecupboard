import type { ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import {
  ArrowLeft,
  ChevronRight,
  MapPin,
  Tags,
  ShoppingBasket,
  BookOpen,
} from 'lucide-react'

const pages = [
  {
    to: '/settings/stores',
    title: 'Stores',
    label: 'Manage stores',
    description: 'Shops, pictures & aisle order',
    icon: MapPin,
  },
  {
    to: '/settings/groups',
    title: 'Item groups',
    label: 'Manage item groups',
    description: 'Categories & organization',
    icon: Tags,
  },
  {
    to: '/settings/items',
    title: 'Items',
    label: 'Manage items',
    description: 'Names, icons & consumption rates',
    icon: ShoppingBasket,
  },
  {
    to: '/settings/recipes',
    title: 'Recipes',
    label: 'Manage recipes',
    description: 'Edit your family recipe book',
    icon: BookOpen,
  },
] as const

export function SettingsNavigation({ cards = false }: { cards?: boolean }) {
  return (
    <nav
      aria-label="Settings pages"
      className={cards ? 'settings-navigation-cards' : 'settings-page-tabs'}
    >
      {pages.map(({ to, title, label, description, icon: Icon }) => (
        <Link
          key={to}
          to={to}
          aria-label={label}
          activeProps={{ className: 'selected' }}
        >
          <Icon size={cards ? 23 : 17} />
          <span>
            <strong>{title}</strong>
            {cards && <small>{description}</small>}
          </span>
          {cards && <ChevronRight size={18} />}
        </Link>
      ))}
    </nav>
  )
}

export function SettingsPage({
  title,
  description,
  children,
}: {
  title: string
  description?: string
  children: ReactNode
}) {
  return (
    <>
      <Link to="/settings" className="text-button settings-back">
        <ArrowLeft size={16} />
        Settings
      </Link>
      <div className="page-heading">
        <div>
          <h1>{title}</h1>
          {description && <p>{description}</p>}
        </div>
      </div>
      <SettingsNavigation />
      <div className="settings-page-content">{children}</div>
    </>
  )
}
