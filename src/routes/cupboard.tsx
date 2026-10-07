import { createFileRoute } from '@tanstack/react-router'
import { LittleCupboard } from '../components/LittleCupboard'
export const Route = createFileRoute('/cupboard')({
  component: () => <LittleCupboard view="cupboard" />,
})
