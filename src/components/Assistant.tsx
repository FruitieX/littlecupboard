import { useState } from 'react'
import { Sparkles, ArrowRight, LoaderCircle, Check } from 'lucide-react'
import { useApp } from '../lib/state'
import { post } from '../lib/http'
import type { Ingredient, Product, Recipe } from '../lib/data'
import { catalog } from '../lib/data'
import { Modal, SectionTitle } from './ui'

type Proposal = {
  id: string
  message: string
  products: Product[]
  shopping: Ingredient[]
  recipes: Recipe[]
  plan: { day: string; recipeId: string; servings: number }[]
  baseRevision: number
}
const starters = [
  'Help us plan lunches for next week',
  'Suggest a new recipe similar to our favorites',
  'What groceries might we need?',
  'Give one of our recipes a fresh twist',
]

export function Assistant() {
  const {
    session,
    action,
    state,
    allRecipes,
    pending,
    status,
    resolvePending,
  } = useApp()
  const [open, setOpen] = useState(false)
  const [prompt, setPrompt] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [proposal, setProposal] = useState<Proposal | null>(null)
  const [shopping, setShopping] = useState<number[]>([])
  const [recipes, setRecipes] = useState<string[]>([])
  const [days, setDays] = useState<string[]>([])
  const [applied, setApplied] = useState(false)
  const queuedProposal = pending.find(
    (entry) =>
      entry.operation.type === 'applyProposal' &&
      entry.operation.proposalId === proposal?.id,
  )
  if (!session.aiEnabled) return null
  async function ask() {
    if (!prompt.trim() || busy) return
    setBusy(true)
    setError('')
    setApplied(false)
    try {
      const result = await post<Proposal>('/ai/assistant', { prompt })
      setProposal(result)
      setShopping(result.shopping.map((_, index) => index))
      setRecipes(result.recipes.map((recipe) => recipe.id))
      setDays(result.plan.map((meal) => meal.day))
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Please try again.')
    } finally {
      setBusy(false)
    }
  }
  const products = [
    ...catalog,
    ...state.customProducts,
    ...(proposal?.products ?? []),
  ]
  function toggle<T>(values: T[], value: T, setter: (values: T[]) => void) {
    setter(
      values.includes(value)
        ? values.filter((item) => item !== value)
        : [...values, value],
    )
  }
  return (
    <>
      <button
        className="assistant-launch"
        onClick={() => setOpen(true)}
        aria-label="Open family assistant"
      >
        <Sparkles size={19} />
        <span>Ask ForkBasket</span>
      </button>
      <Modal
        open={open}
        onOpenChange={setOpen}
        title="A little help in the kitchen"
        description="Ask for groceries, recipes, or a plan. You choose what gets saved."
        className="assistant-modal"
      >
        <form
          className="editor-form"
          onSubmit={(event) => {
            event.preventDefault()
            void ask()
          }}
        >
          <label>
            What would help?
            <textarea
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              required
              maxLength={8000}
              rows={3}
              placeholder="Plan quick lunches with our usual favorites and one new thing to try…"
            />
          </label>
          <div className="assistant-starters">
            {starters.map((starter) => (
              <button
                key={starter}
                type="button"
                disabled={busy}
                onClick={() => setPrompt(starter)}
              >
                {starter}
              </button>
            ))}
          </div>
          <button
            className="primary-button"
            disabled={busy || status === 'offline' || !!pending.length}
          >
            {busy ? (
              <LoaderCircle size={17} className="spin" />
            ) : (
              <Sparkles size={17} />
            )}
            {busy ? 'Thinking about your household…' : 'Ask our assistant'}
          </button>
          {pending.length > 0 && (
            <p className="quiet-label">
              Finish syncing changes first so the assistant has your latest
              household.
            </p>
          )}
        </form>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        {proposal && (
          <div className="assistant-proposal">
            <p className="assistant-message">{proposal.message}</p>
            {!!proposal.shopping.length && (
              <section>
                <SectionTitle title="Shopping additions" />
                <div className="proposal-list">
                  {proposal.shopping.map((ingredient, index) => (
                    <label key={index}>
                      <input
                        type="checkbox"
                        checked={shopping.includes(index)}
                        disabled={applied}
                        onChange={() => toggle(shopping, index, setShopping)}
                      />
                      <span>
                        <strong>
                          {products.find(
                            (product) => product.id === ingredient.productId,
                          )?.name ?? ingredient.productId}
                        </strong>
                        <small>
                          {ingredient.quantity} {ingredient.unit}
                          {ingredient.note ? ` · ${ingredient.note}` : ''}
                        </small>
                      </span>
                    </label>
                  ))}
                </div>
              </section>
            )}
            {!!proposal.recipes.length && (
              <section>
                <SectionTitle title="New recipes" />
                {proposal.recipes.map((recipe) => (
                  <details className="proposal-recipe" key={recipe.id}>
                    <summary>
                      <label onClick={(event) => event.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={recipes.includes(recipe.id)}
                          disabled={applied}
                          onChange={() =>
                            toggle(recipes, recipe.id, setRecipes)
                          }
                        />
                        <strong>{recipe.name}</strong>
                      </label>
                      <span>
                        {recipe.minutes} min · {recipe.servings} servings
                      </span>
                    </summary>
                    <p>{recipe.subtitle}</p>
                    <ul>
                      {recipe.ingredients.map((ingredient, index) => (
                        <li key={index}>
                          {ingredient.quantity} {ingredient.unit}{' '}
                          {
                            products.find(
                              (product) => product.id === ingredient.productId,
                            )?.name
                          }
                          {ingredient.note ? ` · ${ingredient.note}` : ''}
                        </li>
                      ))}
                    </ul>
                    <ol>
                      {recipe.steps.map((step, index) => (
                        <li key={index}>{step}</li>
                      ))}
                    </ol>
                  </details>
                ))}
              </section>
            )}
            {!!proposal.plan.length && (
              <section>
                <SectionTitle title="Proposed lunches" />
                <div className="proposal-list">
                  {proposal.plan.map((meal) => (
                    <label key={meal.day}>
                      <input
                        type="checkbox"
                        checked={days.includes(meal.day)}
                        disabled={applied}
                        onChange={() => toggle(days, meal.day, setDays)}
                      />
                      <span>
                        <strong>
                          {new Date(`${meal.day}T12:00`).toLocaleDateString(
                            undefined,
                            { weekday: 'long', day: 'numeric', month: 'short' },
                          )}
                        </strong>
                        <small>
                          {
                            [...allRecipes, ...proposal.recipes].find(
                              (recipe) => recipe.id === meal.recipeId,
                            )?.name
                          }{' '}
                          · {meal.servings} servings
                        </small>
                      </span>
                    </label>
                  ))}
                </div>
                <p className="quiet-label">
                  Selected meals also save any new recipes they use. Missing
                  ingredients are added automatically.
                </p>
              </section>
            )}
            {!!(
              proposal.shopping.length +
              proposal.recipes.length +
              proposal.plan.length
            ) && (
              <button
                className="primary-button"
                disabled={
                  applied ||
                  busy ||
                  !!pending.length ||
                  !(shopping.length || recipes.length || days.length)
                }
                onClick={() => {
                  action({
                    type: 'applyProposal',
                    proposalId: proposal.id,
                    shoppingIndices: shopping,
                    recipeIds: recipes,
                    days,
                  })
                  setApplied(true)
                }}
              >
                {applied ? <Check size={17} /> : <ArrowRight size={17} />}
                {applied
                  ? queuedProposal?.failed
                    ? 'Proposal needs a fresh review'
                    : queuedProposal
                      ? 'Saving selected suggestions…'
                      : 'Suggestions saved'
                  : 'Save selected suggestions'}
              </button>
            )}
            <p className="quiet-label">
              Suggestions are drafts. If your household changes during review,
              create a fresh proposal before saving.
            </p>
            {queuedProposal?.failed && (
              <div className="form-error" role="alert">
                <p>{queuedProposal.failed}</p>
                <button
                  className="secondary-button"
                  onClick={() => {
                    resolvePending(queuedProposal.id, true)
                    setProposal(null)
                    setApplied(false)
                  }}
                >
                  Discard and request fresh suggestions
                </button>
              </div>
            )}
          </div>
        )}
      </Modal>
    </>
  )
}
