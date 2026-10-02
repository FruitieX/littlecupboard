import { defaultCatalogImage } from '../lib/catalog-artwork'

// Explicit catalog art also updates old list entries without rewriting household data.
export function FoodIcon({
  value,
  className = '',
  image,
  productId,
  name,
}: {
  value: string
  className?: string
  image?: string
  productId?: string
  name?: string
}) {
  const code = [...value]
    .map((character) => character.codePointAt(0)!.toString(16))
    .filter((part) => part !== 'fe0f')
    .join('-')
  return (
    <img
      src={
        image ||
        (productId && defaultCatalogImage(productId, name, value)) ||
        `/images/food/${code}.svg`
      }
      className={`food-icon ${className}`}
      alt=""
      aria-hidden="true"
      onError={(event) => {
        const fallback = `/images/food/${code}.svg`
        if (event.currentTarget.getAttribute('src') !== fallback)
          event.currentTarget.src = fallback
      }}
    />
  )
}
