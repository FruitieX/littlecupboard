import { createFileRoute } from '@tanstack/react-router'
import { LittleCupboard } from '../components/LittleCupboard'
export const Route = createFileRoute('/recipes')({
  component: () => <LittleCupboard view="recipes" />,
})
