import { createFileRoute } from '@tanstack/react-router'
import { ForkBasket } from '../components/ForkBasket'
export const Route = createFileRoute('/week')({
  component: () => <ForkBasket view="week" />,
})
