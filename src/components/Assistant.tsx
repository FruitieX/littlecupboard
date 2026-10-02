import { getProducts } from '../lib/catalog'
import { useEffect, useState } from 'react'
import {
  Sparkles,
  ArrowRight,
  LoaderCircle,
  Check,
  ImagePlus,
  Camera,
  ClipboardPaste,
  X,
} from 'lucide-react'
import { useApp } from '../lib/state'
import { post, uploadImage } from '../lib/http'
import { generateIconBatches, needsItemIcon } from '../lib/icon-batches'
import { Markdown } from './Markdown'
import { FoodIcon } from './FoodIcon'
import type { Ingredient, Product, Recipe } from '../lib/data'
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
    lastAppliedProposal,
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
  const [images, setImages] = useState<{ url: string; name: string }[]>([])
  const [uploading, setUploading] = useState(false)
  const [generating, setGenerating] = useState<string | null>(null)
  const queuedProposal = pending.find(
    (entry) =>
      entry.operation.type === 'applyProposal' &&
      entry.operation.proposalId === proposal?.id,
  )
  useEffect(() => {
    if (applied && proposal?.id === lastAppliedProposal) {
      setOpen(false)
      setProposal(null)
      setImages([])
      setPrompt('')
      setApplied(false)
      setError('')
    }
  }, [applied, proposal?.id, lastAppliedProposal])
  if (!session.aiEnabled) return null
  async function attach(files: File[]) {
    if (busy || uploading || generating || status === 'offline') return
    if (files.length + images.length > 4) {
      setError('Attach up to four recipe images at a time.')
      return
    }
    setUploading(true)
    setError('')
    try {
      for (const file of files) {
        if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type))
          throw new Error('Choose a JPG, PNG or WebP image.')
        if (file.size > 8 * 1024 * 1024)
          throw new Error('Choose an image under 8 MB.')
        const url = await uploadImage(file, true)
        setImages((current) => [
          ...current,
          {
            url,
            name: [...(file.name || 'Recipe image')].slice(0, 100).join(''),
          },
        ])
      }
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : 'The image could not be attached.',
      )
    } finally {
      setUploading(false)
    }
  }
  async function pasteImage() {
    try {
      if (!navigator.clipboard?.read)
        throw new Error('Use Ctrl+V / Cmd+V here, or choose an image file.')
      const files: File[] = []
      for (const item of await navigator.clipboard.read()) {
        const type = item.types.find((type) =>
          ['image/png', 'image/jpeg', 'image/webp'].includes(type),
        )
        if (type)
          files.push(
            new File([await item.getType(type)], 'Pasted recipe', { type }),
          )
      }
      if (!files.length)
        throw new Error('Copy an image first, or use Choose images.')
      await attach(files)
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : 'Clipboard access was unavailable. Use Ctrl+V / Cmd+V here, or choose a file.',
      )
    }
  }
  async function generatePhoto(recipe: Recipe) {
    if (!proposal || generating) return
    setGenerating(recipe.id)
    setError('')
    try {
      const result = await post<{ url: string }>('/ai/image', {
        kind: 'recipe',
        proposalId: proposal.id,
        recipeId: recipe.id,
      })
      setProposal((current) =>
        current
          ? {
              ...current,
              recipes: current.recipes.map((entry) =>
                entry.id === recipe.id
                  ? { ...entry, image: result.url }
                  : entry,
              ),
            }
          : current,
      )
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : 'The photo could not be generated.',
      )
    } finally {
      setGenerating(null)
    }
  }
  async function generateIcon(product: Product) {
    if (!proposal || generating) return
    setGenerating(product.id)
    setError('')
    try {
      const result = await post<{ url: string }>('/ai/image', {
        kind: 'item',
        proposalId: proposal.id,
        productId: product.id,
      })
      setProposal((current) =>
        current
          ? {
              ...current,
              products: current.products.map((entry) =>
                entry.id === product.id
                  ? { ...entry, image: result.url }
                  : entry,
              ),
            }
          : current,
      )
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : 'The icon could not be generated.',
      )
    } finally {
      setGenerating(null)
    }
  }
  async function generateMissingIcons() {
    if (!proposal || generating) return
    setGenerating('batch')
    setError('')
    try {
      await generateIconBatches(
        proposal.products.filter(needsItemIcon),
        (icons) => {
          setProposal((current) =>
            current
              ? {
                  ...current,
                  products: current.products.map((product) => {
                    const image = icons.find((icon) => icon.id === product.id)
                    return image && needsItemIcon(product)
                      ? { ...product, image: image.url }
                      : product
                  }),
                }
              : current,
          )
        },
        proposal.id,
      )
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : 'The icons could not be generated.',
      )
    } finally {
      setGenerating(null)
    }
  }
  async function ask() {
    if ((!prompt.trim() && !images.length) || busy || uploading || generating)
      return
    setBusy(true)
    setError('')
    setApplied(false)
    try {
      const result = await post<Proposal>('/ai/assistant', {
        prompt,
        images: images.map((image) => image.url),
        imageNames: images.map((image) => image.name),
      })
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
  const products = [...getProducts(state), ...(proposal?.products ?? [])]
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
        <span>Ask LittleCupboard</span>
      </button>
      <Modal
        open={open}
        onOpenChange={setOpen}
        title="Assistant"
        description="Ask for groceries, recipes, or a plan. You choose what gets saved."
        className="assistant-modal"
      >
        <form
          className="editor-form"
          onPaste={(event) => {
            const files = [...event.clipboardData.items]
              .filter((item) => item.kind === 'file')
              .map((item) => item.getAsFile())
              .filter((file): file is File => !!file)
            if (files.length) {
              event.preventDefault()
              void attach(files)
            }
          }}
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
              required={!images.length}
              disabled={busy || !!generating}
              maxLength={8000}
              rows={3}
              placeholder="Plan quick lunches with our usual favorites and one new thing to try…"
            />
          </label>
          <fieldset className="assistant-attachments">
            <legend>
              Recipe images <span className="optional">optional</span>
            </legend>
            <div className="image-field-actions">
              <label className="secondary-button">
                <ImagePlus size={16} /> Choose images
                <input
                  aria-label="Attach recipe images"
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  multiple
                  disabled={
                    busy ||
                    uploading ||
                    !!generating ||
                    images.length >= 4 ||
                    status === 'offline'
                  }
                  onChange={(event) => {
                    void attach([...(event.target.files ?? [])])
                    event.target.value = ''
                  }}
                />
              </label>
              <label className="secondary-button">
                <Camera size={16} /> Take photo
                <input
                  aria-label="Take recipe photo"
                  type="file"
                  accept="image/*"
                  capture="environment"
                  disabled={
                    busy ||
                    uploading ||
                    !!generating ||
                    images.length >= 4 ||
                    status === 'offline'
                  }
                  onChange={(event) => {
                    void attach([...(event.target.files ?? [])])
                    event.target.value = ''
                  }}
                />
              </label>
              <button
                type="button"
                className="secondary-button"
                disabled={
                  busy ||
                  uploading ||
                  !!generating ||
                  images.length >= 4 ||
                  status === 'offline'
                }
                onClick={() => void pasteImage()}
              >
                <ClipboardPaste size={16} /> Paste image
              </button>
            </div>
            <p className="quiet-label">
              Upload a recipe or screenshot, take a photo, or paste with Ctrl+V
              / Cmd+V. Up to four pages. Review the transcription before saving;
              your configured AI provider receives the images.
            </p>
            {!!images.length && (
              <div className="attachment-list">
                {images.map((image, index) => (
                  <div className="attachment" key={image.url}>
                    <img
                      src={image.url}
                      alt={`Recipe page ${index + 1}: ${image.name}`}
                    />
                    <span>{image.name}</span>
                    <button
                      type="button"
                      className="icon-button"
                      aria-label={`Remove recipe image ${index + 1}`}
                      disabled={busy || uploading || !!generating}
                      onClick={() =>
                        setImages((current) =>
                          current.filter((entry) => entry.url !== image.url),
                        )
                      }
                    >
                      <X size={16} />
                    </button>
                  </div>
                ))}
              </div>
            )}
            {uploading && (
              <p role="status" className="quiet-label">
                Uploading recipe images…
              </p>
            )}
          </fieldset>
          <div className="assistant-starters">
            {starters.map((starter) => (
              <button
                key={starter}
                type="button"
                disabled={busy || !!generating}
                onClick={() => setPrompt(starter)}
              >
                {starter}
              </button>
            ))}
          </div>
          <button
            className="primary-button"
            disabled={
              busy ||
              uploading ||
              !!generating ||
              (!prompt.trim() && !images.length) ||
              status === 'offline' ||
              !!pending.length
            }
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
            {!!proposal.products.length && (
              <section>
                <SectionTitle title="New items" />
                {session.imageEnabled &&
                  proposal.products.filter(needsItemIcon).length > 1 && (
                    <button
                      type="button"
                      className="secondary-button"
                      disabled={
                        applied ||
                        busy ||
                        uploading ||
                        !!generating ||
                        !!pending.length ||
                        status === 'offline'
                      }
                      onClick={() => void generateMissingIcons()}
                    >
                      {generating === 'batch' ? (
                        <LoaderCircle size={16} className="spin" />
                      ) : (
                        <Sparkles size={16} />
                      )}
                      {generating === 'batch'
                        ? 'Generating icons…'
                        : `Generate missing icons (${proposal.products.filter(needsItemIcon).length})`}
                    </button>
                  )}
                <div className="proposal-products">
                  {proposal.products.map((product) => (
                    <div key={product.id}>
                      <FoodIcon value={product.icon} image={product.image} />
                      <strong>{product.name}</strong>
                      {session.imageEnabled && (
                        <button
                          className="secondary-button"
                          disabled={
                            applied ||
                            busy ||
                            uploading ||
                            !!generating ||
                            !!pending.length ||
                            status === 'offline'
                          }
                          onClick={() => void generateIcon(product)}
                        >
                          {generating === product.id ? (
                            <LoaderCircle size={16} className="spin" />
                          ) : (
                            <Sparkles size={16} />
                          )}
                          {generating === product.id
                            ? 'Generating…'
                            : product.image
                              ? 'Regenerate icon'
                              : 'Generate icon'}
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </section>
            )}
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
                    <Markdown>{recipe.subtitle}</Markdown>
                    {recipe.mealPlanEligible === false && (
                      <p className="quiet-label">
                        Recipe library only · excluded from meal planning
                      </p>
                    )}
                    {recipe.image.startsWith('/api/images/') && (
                      <img
                        className="proposal-dish-photo"
                        src={recipe.image}
                        alt={`Generated illustration of ${recipe.name}`}
                      />
                    )}
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
                        <li key={index}>
                          <Markdown>{step}</Markdown>
                        </li>
                      ))}
                    </ol>
                    {session.imageEnabled && (
                      <button
                        type="button"
                        className="secondary-button"
                        disabled={
                          applied ||
                          busy ||
                          uploading ||
                          !!generating ||
                          !!pending.length ||
                          status === 'offline'
                        }
                        onClick={() => void generatePhoto(recipe)}
                      >
                        {generating === recipe.id ? (
                          <LoaderCircle size={16} className="spin" />
                        ) : (
                          <Sparkles size={16} />
                        )}
                        {generating === recipe.id
                          ? 'Generating dish photo…'
                          : recipe.image.startsWith('/api/images/')
                            ? 'Regenerate dish photo'
                            : 'Generate dish photo'}
                      </button>
                    )}
                    <p className="quiet-label">
                      Check quantities and any unclear text. Generated dish
                      photos are illustrative.
                    </p>
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
                  uploading ||
                  !!generating ||
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
                      : lastAppliedProposal === proposal.id
                        ? 'Suggestions saved'
                        : 'Save canceled. Ask for fresh suggestions.'
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
