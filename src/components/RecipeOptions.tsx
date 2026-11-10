import type { Recipe, Product } from '../lib/data'
import {
  defaultChoices,
  type Choices,
  type RecipeOptionGroup,
} from '../lib/recipe-options'
import { NumberInput } from './NumberInput'
import { useId, useState } from 'react'

export function RecipeOptions({
  recipe,
  value,
  onChange,
  disabled = false,
}: {
  recipe: Recipe
  value: Choices
  onChange: (value: Choices) => void
  disabled?: boolean
}) {
  if (!recipe.optionGroups?.length) return null
  return (
    <div className="recipe-options">
      {recipe.optionGroups.map((group) => (
        <label key={group.id}>
          {group.name}
          {group.optional ? ' (optional)' : ''}
          <select
            aria-label={group.name}
            disabled={disabled}
            value={value[group.id] ?? defaultChoices(recipe)[group.id]}
            onChange={(e) => onChange({ ...value, [group.id]: e.target.value })}
          >
            {group.optional && (
              <option value="">Without {group.name.toLowerCase()}</option>
            )}
            {group.choices.map((choice) => (
              <option key={choice.id} value={choice.id}>
                {choice.name}
              </option>
            ))}
          </select>
        </label>
      ))}
    </div>
  )
}
export function RecipeOptionsEditor({
  groups,
  onChange,
  products,
}: {
  groups: RecipeOptionGroup[]
  onChange: (groups: RecipeOptionGroup[]) => void
  products: Product[]
}) {
  const id = useId()
  const [names, setNames] = useState<Record<string, string>>({})
  function update(index: number, group: RecipeOptionGroup) {
    onChange(groups.map((old, i) => (i === index ? group : old)))
  }
  return (
    <details className="recipe-options-editor">
      <summary>Optional parts & choices ({groups.length})</summary>
      <p className="quiet-label">
        Add optional sauces or let everyone choose one side. Only the selected
        choices go on the shopping list.
      </p>
      <datalist id={id}>
        {products.map((p) => (
          <option key={p.id} value={p.name} />
        ))}
      </datalist>
      {groups.map((group, index) => (
        <fieldset key={group.id}>
          <legend>{group.name || 'Meal choice'}</legend>
          <label>
            Choice group name
            <input
              value={group.name}
              required
              maxLength={100}
              onChange={(e) =>
                update(index, { ...group, name: e.target.value })
              }
            />
          </label>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={group.optional}
              onChange={(e) =>
                update(index, { ...group, optional: e.target.checked })
              }
            />
            Optional — off until selected
          </label>
          {group.choices.map((choice, ci) => {
            function change(next: typeof choice) {
              update(index, {
                ...group,
                choices: group.choices.map((c, i) => (i === ci ? next : c)),
              })
            }
            const nameKey = `${group.id}:${choice.id}`
            const product = products.find(
              (p) =>
                p.name.toLowerCase() ===
                (names[nameKey] ?? '').trim().toLowerCase(),
            )
            return (
              <fieldset key={choice.id}>
                <legend>{choice.name || 'Option'}</legend>
                <label>
                  Option name
                  <input
                    required
                    maxLength={100}
                    value={choice.name}
                    onChange={(e) =>
                      change({ ...choice, name: e.target.value })
                    }
                  />
                </label>
                {choice.ingredients.map((ingredient, ii) => (
                  <div className="option-ingredient" key={ii}>
                    <span>
                      {products.find((p) => p.id === ingredient.productId)
                        ?.name ?? ingredient.productId}
                    </span>
                    <NumberInput
                      aria-label={`Amount of option ingredient ${ii + 1}`}
                      required
                      min={0.001}
                      value={ingredient.quantity}
                      onValueChange={(quantity) =>
                        change({
                          ...choice,
                          ingredients: choice.ingredients.map((v, i) =>
                            i === ii ? { ...v, quantity } : v,
                          ),
                        })
                      }
                    />
                    <input
                      aria-label={`Unit of option ingredient ${ii + 1}`}
                      required
                      maxLength={30}
                      value={ingredient.unit}
                      onChange={(e) =>
                        change({
                          ...choice,
                          ingredients: choice.ingredients.map((v, i) =>
                            i === ii ? { ...v, unit: e.target.value } : v,
                          ),
                        })
                      }
                    />
                    <button
                      type="button"
                      className="text-button"
                      aria-label={`Remove option ingredient ${ii + 1}`}
                      onClick={() =>
                        change({
                          ...choice,
                          ingredients: choice.ingredients.filter(
                            (_, i) => i !== ii,
                          ),
                        })
                      }
                    >
                      Remove
                    </button>
                  </div>
                ))}
                <label>
                  Ingredient from your items
                  <input
                    list={id}
                    value={names[nameKey] ?? ''}
                    onChange={(e) =>
                      setNames({ ...names, [nameKey]: e.target.value })
                    }
                  />
                </label>
                <button
                  type="button"
                  className="chip-button"
                  disabled={!product}
                  onClick={() => {
                    if (product)
                      change({
                        ...choice,
                        ingredients: [
                          ...choice.ingredients,
                          { productId: product.id, quantity: 1, unit: 'g' },
                        ],
                      })
                    setNames({ ...names, [nameKey]: '' })
                  }}
                >
                  Add option ingredient
                </button>
                <label>
                  Extra cooking steps
                  <textarea
                    value={choice.steps.join('\n')}
                    onChange={(e) =>
                      change({ ...choice, steps: e.target.value.split('\n') })
                    }
                  />
                </label>
                {group.choices.length > 1 && (
                  <button
                    type="button"
                    className="text-button danger"
                    onClick={() =>
                      update(index, {
                        ...group,
                        choices: group.choices.filter((_, i) => i !== ci),
                      })
                    }
                  >
                    Remove option
                  </button>
                )}
              </fieldset>
            )
          })}
          <button
            type="button"
            className="chip-button"
            disabled={group.choices.length >= 12}
            onClick={() =>
              update(index, {
                ...group,
                choices: [
                  ...group.choices,
                  {
                    id: crypto.randomUUID(),
                    name: 'New option',
                    ingredients: [],
                    steps: [],
                  },
                ],
              })
            }
          >
            Add another option
          </button>
          <button
            type="button"
            className="text-button danger"
            onClick={() => onChange(groups.filter((_, i) => i !== index))}
          >
            Remove choice group
          </button>
        </fieldset>
      ))}
      <button
        type="button"
        className="secondary-button"
        disabled={groups.length >= 12}
        onClick={() =>
          onChange([
            ...groups,
            {
              id: crypto.randomUUID(),
              name: 'Sauce',
              optional: true,
              choices: [
                {
                  id: crypto.randomUUID(),
                  name: 'New sauce',
                  ingredients: [],
                  steps: [],
                },
              ],
            },
          ])
        }
      >
        Add optional part or side choice
      </button>
    </details>
  )
}
