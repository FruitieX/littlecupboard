import { useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import {
  ChevronLeft,
  ChevronRight,
  Clock3,
  Plus,
  RefreshCw,
  ShoppingBasket,
  Check,
  CalendarDays,
  ArrowUpRight,
} from 'lucide-react'
import { useApp } from '../lib/state'
import { addRecipes, dateKey, mondayOfWeek } from '../lib/shopping'
import { EmptyState, Eyebrow, Modal } from './ui'
import type { Recipe } from '../lib/data'
import { FoodIcon } from './FoodIcon'

export function Week() {
  const { state, update, allRecipes } = useApp()
  const [offset, setOffset] = useState(0)
  const [pickDay, setPickDay] = useState<Date | null>(null)
  const [suggestOpen, setSuggestOpen] = useState(false)
  const [rotation, setRotation] = useState(0)
  const [message, setMessage] = useState('')
  const monday = mondayOfWeek(new Date(), offset)
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday)
    d.setDate(d.getDate() + i)
    return d
  })
  const scheduled = days
    .map((d) => allRecipes.find((r) => r.id === state.plan[dateKey(d)]))
    .filter((r): r is Recipe => !!r)
  const shortDate = (d: Date) =>
    d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
  const ranked = [...allRecipes].sort((a, b) => score(b) - score(a))
  function score(recipe: Recipe) {
    return (
      recipe.ingredients.filter((i) =>
        state.items.some((item) => !item.checked && item.id === i.productId),
      ).length / Math.max(1, recipe.ingredients.length)
    )
  }
  const proposed = days.map((_, i) => ranked[(i + rotation) % ranked.length])
  function notify(text: string) {
    setMessage(text)
    setTimeout(() => setMessage(''), 4000)
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <Eyebrow>A WEEK OF GOOD THINGS</Eyebrow>
          <h1>
            What’s for lunch<span className="heading-dot">?</span>
          </h1>
          <p>Less “what should we make?” More time together.</p>
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
      <div className="week-note">
        <span>
          <FoodIcon value="🌿" />
        </span>
        <p>
          <strong>A little plan goes a long way.</strong> Your recipes, your
          family, one delicious week.
        </p>
        <span className="week-note-decoration">✳</span>
      </div>
      <div className="week-grid">
        {days.map((day, index) => {
          const key = dateKey(day)
          const recipe = allRecipes.find((r) => r.id === state.plan[key])
          const isToday = key === dateKey(new Date())
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
                      {recipe.minutes} min <span>·</span> {recipe.servings}{' '}
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
                  <strong>A little room for inspiration</strong>
                  <span>Pick something tasty</span>
                </button>
              )}
            </motion.section>
          )
        })}
      </div>
      <div className="week-bottom">
        <div>
          <span className="week-basket">
            <FoodIcon value="🧺" />
          </span>
          <div>
            <h3>From our week to our basket.</h3>
            <p>
              {scheduled.length
                ? `${scheduled.length} lunches planned. Add the ingredients together.`
                : 'Choose a few lunches, then gather everything in one tap.'}
            </p>
          </div>
        </div>
        <button
          className="primary-button"
          disabled={!scheduled.length}
          onClick={() => {
            update((s) => ({ ...s, items: addRecipes(s.items, scheduled) }))
            notify(
              'The week’s ingredients are on your list. Duplicates merged.',
            )
          }}
        >
          <ShoppingBasket size={18} />
          Shop this week
        </button>
      </div>
      <p className="gentle-note">
        <CalendarDays size={14} /> Plans change. Tap any meal to swap it.
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
        description="Suggestions from your saved recipes, favoring ingredients already on your shopping list. Adjust any day afterward."
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
                  <strong>{recipe.name}</strong>
                  <small>{recipe.minutes} min</small>
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
                  }))
                  setSuggestOpen(false)
                  notify('Your week is planned. Make it your own!')
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
