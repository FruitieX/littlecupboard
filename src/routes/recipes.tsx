import { createFileRoute } from '@tanstack/react-router'
import { ForkBasket } from '../components/ForkBasket'
export const Route = createFileRoute('/recipes')({
  component: () => <ForkBasket view="recipes" />,
})
