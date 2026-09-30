// Bundled Twemoji SVG illustrations give all browsers the same food artwork.
export function FoodIcon({
  value,
  className = '',
}: {
  value: string
  className?: string
}) {
  const code = [...value]
    .map((character) => character.codePointAt(0)!.toString(16))
    .filter((part) => part !== 'fe0f')
    .join('-')
  return (
    <img
      src={`/images/food/${code}.svg`}
      className={`food-icon ${className}`}
      alt=""
      aria-hidden="true"
    />
  )
}
