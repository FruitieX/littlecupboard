import * as Dialog from '@radix-ui/react-dialog'
import { X, ArrowUpRight } from 'lucide-react'
import type { ReactNode } from 'react'
import { APP_NAME } from '../lib/brand'
import { FoodIcon } from './FoodIcon'

export function Brand() {
  return (
    <span className="brand" aria-label={APP_NAME}>
      <span className="brand-mark">
        <img src="/icon.svg" width="40" height="40" alt="" />
      </span>
      <span className="brand-wordmark" aria-hidden="true">
        <span className="brand-little">Little</span>
        <span className="brand-cupboard">Cupboard</span>
      </span>
    </span>
  )
}
export function Modal({
  open,
  onOpenChange,
  title,
  description,
  children,
  className = '',
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: string
  children: ReactNode
  className?: string
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="modal-overlay" />
        <Dialog.Content className={`modal-content ${className}`}>
          {/* The header stays put while long dialogs scroll their body. */}
          <div className="modal-header">
            <Dialog.Close
              className="icon-button modal-close"
              aria-label="Close dialog"
            >
              <X size={20} />
            </Dialog.Close>
            <Dialog.Title className="modal-title">{title}</Dialog.Title>
            <Dialog.Description className="modal-description">
              {description}
            </Dialog.Description>
          </div>
          <div className="modal-body">{children}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
export function Eyebrow({ children }: { children: ReactNode }) {
  return <span className="eyebrow">{children}</span>
}
export function SectionTitle({
  title,
  count,
  children,
}: {
  title: string
  count?: number
  children?: ReactNode
}) {
  return (
    <div className="section-heading">
      <h2>
        {title} {count !== undefined && <span className="count">{count}</span>}
      </h2>
      {children}
    </div>
  )
}
export function EmptyState({
  icon,
  title,
  text,
  children,
}: {
  icon: string
  title: string
  text: string
  children?: ReactNode
}) {
  return (
    <div className="empty-state">
      <span className="empty-icon">
        <FoodIcon value={icon} />
      </span>
      <h3>{title}</h3>
      <p>{text}</p>
      {children}
    </div>
  )
}
export function SmallArrow() {
  return <ArrowUpRight size={17} />
}
