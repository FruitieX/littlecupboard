import { useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import {
  ChevronLeft,
  ChevronRight,
  Clock3,
  Plus,
  RefreshCw,
  Check,
  ArrowUpRight,
} from 'lucide-react'
import { useApp } from '../lib/state'
import type { Recipe } from '../lib/data'
import { dateKey, mondayOfWeek, householdDate } from '../lib/shopping'
import { EmptyState, Modal } from './ui'
import { FoodIcon } from './FoodIcon'
import { recipeScore, suggestWeek } from '../lib/learning'

export function Week() {
  const { state, update, action, allRecipes } = useApp()
  const [offset, setOffset] = useState(0)
  const [pickDay, setPickDay] = useState<Date | null>(null)
  const [suggestOpen, setSuggestOpen] = useState(false)
  const [rotation, setRotation] = useState(0)
  const [feedbackDay, setFeedbackDay] = useState<string | null>(null)
  const [consume, setConsume] = useState(true)
  const [rating, setRating] = useState(4)
  const [message, setMessage] = useState('')
  const now = householdDate(state.preferences?.timeZone)
  const monday = mondayOfWeek(now, offset)
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday)
    d.setDate(d.getDate() + i)
    return d
  })
  const shortDate = (d: Date) =>
    d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
  const proposed = suggestWeek(allRecipes, state, rotation)
  const ranked = proposed
  function notify(text: string) {
    setMessage(text)
    setTimeout(() => setMessage(''), 4000)
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>
            What’s for lunch<span className="heading-dot">?</span>
          </h1>
        </div>
        <span className="week-heading-art">
          <FoodIcon value="🍋" />
        </span>
      </div>
      <div className="week-toolbar">
        <div className="week-switch">
          <button
            className="icon-button"
            aria-label="Previous week"
            disabled={offset === 0}
            onClick={() => setOffset(0)}
          >
            <ChevronLeft size={20} />
          </button>
          <div>
            <strong>{offset === 0 ? 'This week' : 'Next week'}</strong>
            <span>
              {shortDate(monday)} – {shortDate(days[6])}
            </span>
          </div>
          <button
            className="icon-button"
            aria-label="Next week"
            disabled={offset === 1}
            onClick={() => setOffset(1)}
          >
            <ChevronRight size={20} />
          </button>
        </div>
        <button
          className="secondary-button suggest-button"
          onClick={() => setSuggestOpen(true)}
        >
          <RefreshCw size={17} />
          Suggest lunches
        </button>
      </div>
      <div className="week-grid">
        {days.map((day, index) => {
          const key = dateKey(day)
          const recipe = allRecipes.find((r) => r.id === state.plan[key])
          const isToday = key === dateKey(now)
          return (
            <motion.section
              layout
              key={key}
              className={`day-card ${isToday ? 'is-today' : ''} ${!recipe ? 'unplanned' : ''}`}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.035 }}
            >
              <div className="day-heading">
                <div>
                  <span>
                    {day
                      .toLocaleDateString('en-GB', { weekday: 'short' })
                      .toUpperCase()}
                  </span>
                  <strong>{day.getDate()}</strong>
                </div>
                {isToday ? (
                  <span className="today-pill">Today</span>
                ) : (
                  <span className="day-lunch-label">LUNCH</span>
                )}
              </div>
              {recipe ? (
                <button
                  className="planned-meal"
                  onClick={() => setPickDay(day)}
                  aria-label={`Change ${day.toLocaleDateString('en-GB', { weekday: 'long' })} lunch: ${recipe.name}`}
                >
                  <div className="planned-image">
                    <img src={recipe.image} alt={recipe.name} />
                    <span className="meal-change">
                      <RefreshCw size={15} />
                    </span>
                  </div>
                  <div className="planned-body">
                    <span
                      className={`recipe-tag ${recipe.tag === 'Vegetarian' ? 'vegetarian' : ''}`}
                    >
                      {recipe.tag}
                    </span>
                    <h3>{recipe.name}</h3>
                    <span className="meal-time">
                      <Clock3 size={14} />
                      {recipe.minutes} min <span>·</span>{' '}
                      {state.servings?.[key] ??
                        state.preferences?.servings ??
                        recipe.servings}{' '}
                      servings
                    </span>
                  </div>
                </button>
              ) : (
                <button
                  className="unplanned-button"
                  onClick={() => setPickDay(day)}
                  aria-label={`Plan ${day.toLocaleDateString('en-GB', { weekday: 'long' })} lunch`}
                >
                  <span className="unplanned-icon">
                    <Plus size={23} />
                  </span>
                  <strong>No lunch planned</strong>
                  <span>Pick something tasty</span>
                </button>
              )}
              {recipe && (
                <div className="meal-feedback">
                  <label>
                    Servings
                    <input
                      aria-label={`Servings for ${day.toLocaleDateString('en-GB', { weekday: 'long' })}`}
                      type="number"
                      min={1}
                      max={100}
                      value={
                        state.servings?.[key] ??
                        state.preferences?.servings ??
                        recipe.servings
                      }
                      disabled={!!state.mealFeedback?.[key]}
                      onChange={(e) => {
                        const value = Number(e.target.value)
                        if (value > 0 && value <= 100)
                          update((s) => ({
                            ...s,
                            servings: { ...s.servings, [key]: value },
                          }))
                      }}
                    />
                  </label>
                  <button
                    className="text-button"
                    onClick={() => setFeedbackDay(key)}
                    disabled={!!state.mealFeedback?.[key]}
                  >
                    {state.mealFeedback?.[key]?.status ?? 'Cooked / skipped'}
                  </button>
                </div>
              )}
            </motion.section>
          )
        })}
      </div>
      <p className="meal-plan-sync-note">
        <Check size={15} />
        Missing ingredients go straight to your shopping list.
      </p>
      <Modal
        open={!!pickDay}
        onOpenChange={(v) => {
          if (!v) setPickDay(null)
        }}
        title={`Lunch for ${pickDay?.toLocaleDateString('en-GB', { weekday: 'long' }) ?? 'today'}`}
        description="Something quick, something cozy, something everyone loves."
      >
        <div className="recipe-picker">
          {allRecipes.map((recipe) => (
            <button
              key={recipe.id}
              onClick={() => {
                if (pickDay)
                  update((s) => ({
                    ...s,
                    plan: { ...s.plan, [dateKey(pickDay)]: recipe.id },
                    mealFeedback: Object.fromEntries(
                      Object.entries(s.mealFeedback ?? {}).filter(
                        ([day]) => day !== dateKey(pickDay),
                      ),
                    ),
                  }))
                setPickDay(null)
              }}
            >
              <img src={recipe.image} alt="" />
              <span>
                <strong>{recipe.name}</strong>
                <small>
                  {recipe.minutes} min · {recipe.tag}
                </small>
              </span>
              <ArrowUpRight size={18} />
            </button>
          ))}
        </div>
        {pickDay && state.plan[dateKey(pickDay)] && (
          <button
            className="text-button"
            onClick={() => {
              update((s) => {
                const plan = { ...s.plan }
                delete plan[dateKey(pickDay)]
                return { ...s, plan }
              })
              setPickDay(null)
            }}
          >
            Leave this day open
          </button>
        )}
      </Modal>
      <Modal
        open={suggestOpen}
        onOpenChange={setSuggestOpen}
        title="A tasty starting point"
        description="Uses your preferences, ratings, meal rotation and likely ingredients. Adjust any day afterward."
      >
        {ranked.length ? (
          <>
            <div className="plan-suggestions">
              {proposed.map((recipe, i) => (
                <div key={i}>
                  <span>
                    {days[i].toLocaleDateString('en-GB', { weekday: 'short' })}
                  </span>
                  <img src={recipe.image} alt="" />
                  <div className="plan-suggestion-details">
                    <strong>{recipe.name}</strong>
                    <small>
                      {recipeScore(recipe, state)
                        .reasons.slice(0, 2)
                        .join(' · ')}
                    </small>
                  </div>
                </div>
              ))}
            </div>
            <div className="modal-actions">
              <button
                className="secondary-button"
                onClick={() => setRotation((r) => r + 1)}
              >
                <RefreshCw size={16} />
                Mix it up
              </button>
              <button
                className="primary-button"
                onClick={() => {
                  update((s) => ({
                    ...s,
                    plan: {
                      ...s.plan,
                      ...Object.fromEntries(
                        days.map((day, i) => [dateKey(day), proposed[i].id]),
                      ),
                    },
                    mealFeedback: Object.fromEntries(
                      Object.entries(s.mealFeedback ?? {}).filter(
                        ([day]) => !days.some((date) => dateKey(date) === day),
                      ),
                    ),
                  }))
                  setSuggestOpen(false)
                  notify(
                    'Plan saved. Missing ingredients are on your shopping list.',
                  )
                }}
              >
                <Check size={17} />
                Use this plan
              </button>
            </div>
          </>
        ) : (
          <EmptyState
            icon="📖"
            title="Start with a recipe"
            text="Add a few recipes to get lunch suggestions."
          />
        )}
      </Modal>
      <Modal
        open={!!feedbackDay}
        onOpenChange={(v) => {
          if (!v) setFeedbackDay(null)
        }}
        title="How was lunch?"
        description="Cooking feedback helps future suggestions. Confirm whether to reduce estimated pantry ingredients."
      >
        <div className="editor-form">
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={consume}
              onChange={(e) => setConsume(e.target.checked)}
            />
            Used pantry ingredients
          </label>
          <label>
            Family rating
            <select
              value={rating}
              onChange={(e) => setRating(Number(e.target.value))}
            >
              {[5, 4, 3, 2, 1].map((n) => (
                <option key={n} value={n}>
                  {n} / 5
                </option>
              ))}
            </select>
          </label>
          <div className="modal-actions">
            {['cooked', 'skipped'].map((status) => (
              <button
                className="secondary-button"
                key={status}
                onClick={() => {
                  if (feedbackDay)
                    action({
                      type: 'mealFeedback',
                      day: feedbackDay,
                      recipeId: state.plan[feedbackDay],
                      status,
                      consume: status === 'cooked' && consume,
                      rating: status === 'cooked' ? rating : null,
                    })
                  setFeedbackDay(null)
                }}
              >
                {status === 'cooked' ? 'We cooked it' : 'Skipped this meal'}
              </button>
            ))}
          </div>
        </div>
      </Modal>
      <AnimatePresence>
        {message && (
          <motion.div
            className="toast"
            role="status"
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
          >
            <Check size={18} />
            {message}
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}
