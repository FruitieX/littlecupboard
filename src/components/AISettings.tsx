import { useEffect, useState } from 'react'
import { Check, LoaderCircle, Sparkles, Trash2 } from 'lucide-react'
import { useApp } from '../lib/state'
import { api, post } from '../lib/http'
import { Modal, SectionTitle } from './ui'
import { IconGenerationSettings } from './IconGenerationSettings'

type ProviderConfig = {
  transport: 'api' | 'companion'
  reasoningEffort: string
  enabled: boolean
  baseUrl: string
  model: string
  imageModel: string
  imageSize: string
  autoItemIcons: boolean
  responseFormat: string
  tokenParameter: string
  prompts: { assistant: string; itemImage: string; recipeImage: string }
}
export function AISettings() {
  const { session, refreshSession } = useApp()
  const [config, setConfig] = useState<ProviderConfig | null>(null)
  const [retry, setRetry] = useState(0)
  const [apiKey, setApiKey] = useState('')
  const [hasKey, setHasKey] = useState(false)
  const [models, setModels] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [companion, setCompanion] = useState({ paired: false, online: false })
  const [pairingToken, setPairingToken] = useState('')
  const [confirmation, setConfirmation] = useState<
    'remove' | 'revoke' | 'replace' | null
  >(null)
  useEffect(() => {
    if (session.user.role !== 'owner') return
    let active = true
    setConfig(null)
    setError('')
    void api<{
      config: ProviderConfig
      hasKey: boolean
      companion: typeof companion
    }>('/ai/config')
      .then((result) => {
        if (!active) return
        setConfig(result.config)
        setHasKey(result.hasKey)
        setCompanion(result.companion)
      })
      .catch((error) => {
        if (active) setError(error.message)
      })
    return () => {
      active = false
    }
  }, [session.user.id, session.user.role, retry])
  useEffect(() => {
    const online = () => {
      if (!config) setRetry((value) => value + 1)
    }
    window.addEventListener('online', online)
    return () => window.removeEventListener('online', online)
  }, [config])
  useEffect(() => {
    if (config?.transport !== 'companion' || session.user.role !== 'owner')
      return
    const timer = setInterval(() => {
      void api<{ companion: typeof companion }>('/ai/config')
        .then((result) => setCompanion(result.companion))
        .catch(() => {})
    }, 10000)
    return () => clearInterval(timer)
  }, [config?.transport, session.user.role])
  async function run(action: () => Promise<void>) {
    setBusy(true)
    setError('')
    setMessage('')
    try {
      await action()
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Please try again.')
    } finally {
      setBusy(false)
    }
  }
  function field<K extends keyof ProviderConfig>(
    key: K,
    value: ProviderConfig[K],
  ) {
    setConfig((current) => (current ? { ...current, [key]: value } : current))
    setMessage('')
  }
  async function pairCompanion() {
    const result = await post<{ token: string }>('/ai/companion', {})
    setPairingToken(result.token)
    setCompanion({ paired: true, online: false })
    setMessage('New pairing token created. Previous worker access was revoked.')
  }
  if (session.user.role !== 'owner')
    return (
      <section className="settings-card">
        <SectionTitle title="AI assistant" />
        <p className="settings-description">
          Your household owner manages provider configuration.{' '}
          {session.aiEnabled
            ? 'The assistant is connected and available to everyone in your household.'
            : 'The assistant appears when a provider is connected.'}
        </p>
      </section>
    )
  if (!config)
    return (
      <section className="settings-card ai-provider-card">
        <SectionTitle title="AI assistant">
          <Sparkles size={20} />
        </SectionTitle>
        {error ? (
          <>
            <p className="form-error" role="alert">
              {error}
            </p>
            <button
              className="secondary-button"
              type="button"
              onClick={() => setRetry((value) => value + 1)}
            >
              Retry loading assistant settings
            </button>
          </>
        ) : (
          <p className="settings-description" role="status">
            Loading assistant settings…
          </p>
        )}
      </section>
    )
  return (
    <section className="settings-card ai-provider-card">
      <SectionTitle title="AI assistant">
        <Sparkles size={20} />
      </SectionTitle>
      <p className="settings-description">
        {session.aiEnabled
          ? 'Connected for this household.'
          : 'Not configured.'}{' '}
        Provider settings are managed by the owner.
      </p>
      <details className="settings-disclosure ai-setup">
        <summary>Configure AI assistant</summary>
        <form
          className="editor-form"
          onSubmit={(event) => {
            event.preventDefault()
            void run(async () => {
              const result = await api<{
                config: ProviderConfig
                hasKey: boolean
              }>('/ai/config', {
                method: 'PUT',
                body: JSON.stringify({ config, apiKey: apiKey || null }),
              })
              setConfig(result.config)
              setHasKey(result.hasKey)
              setApiKey('')
              await refreshSession()
              setMessage('Provider saved. The assistant is ready when enabled.')
            })
          }}
        >
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={config.enabled}
              onChange={(event) => field('enabled', event.target.checked)}
            />
            Enable the household assistant
          </label>
          <label>
            Connection
            <select
              aria-label="Connection"
              value={config.transport}
              onChange={(event) => {
                const transport = event.target
                  .value as ProviderConfig['transport']
                setConfig({
                  ...config,
                  transport,
                  ...(transport === 'companion'
                    ? {
                        model: 'gpt-6-luna',
                        reasoningEffort: 'xhigh',
                        imageModel: 'gpt-image-2-medium',
                        responseFormat: 'schema',
                        tokenParameter: 'omit',
                      }
                    : {}),
                })
                setMessage('')
              }}
            >
              <option value="api">OpenAI-compatible API</option>
              <option value="companion">Personal Hermes companion</option>
            </select>
          </label>
          {config.transport === 'companion' ? (
            <div className="companion-connection">
              <p className="settings-description">
                Your ChatGPT login stays on your agent machine. The companion
                handles chat and images for your household.
              </p>
              <p role="status">
                {companion.online
                  ? 'Companion online'
                  : companion.paired
                    ? 'Paired · companion offline'
                    : 'No companion paired'}
              </p>
              <button
                type="button"
                className="secondary-button"
                disabled={busy}
                onClick={() =>
                  companion.paired
                    ? setConfirmation('replace')
                    : void run(pairCompanion)
                }
              >
                {companion.paired
                  ? 'Replace companion token'
                  : 'Create pairing token'}
              </button>
              {pairingToken && (
                <label>
                  One-time pairing token
                  <input
                    type="password"
                    readOnly
                    value={pairingToken}
                    aria-label="Companion pairing token"
                    autoComplete="off"
                  />
                  <small>
                    Run the companion setup command on your agent machine and
                    paste this token at its masked prompt.
                  </small>
                  <button
                    type="button"
                    className="text-button"
                    onClick={() =>
                      void run(async () => {
                        await navigator.clipboard.writeText(pairingToken)
                        setMessage('Pairing token copied.')
                      })
                    }
                  >
                    Copy pairing token
                  </button>
                </label>
              )}
              {companion.paired && (
                <button
                  type="button"
                  className="text-button danger"
                  disabled={busy}
                  onClick={() => setConfirmation('revoke')}
                >
                  Revoke companion access
                </button>
              )}
            </div>
          ) : (
            <>
              <label>
                Provider base URL
                <input
                  aria-label="Provider base URL"
                  type="url"
                  value={config.baseUrl}
                  onChange={(event) => field('baseUrl', event.target.value)}
                  required
                  maxLength={500}
                  placeholder="https://your-provider.example/v1"
                />
                <small>
                  OpenAI-compatible Chat Completions endpoint. Local HTTP
                  servers are supported.
                </small>
              </label>
              <label>
                API key
                <input
                  type="password"
                  value={apiKey}
                  onChange={(event) => setApiKey(event.target.value)}
                  autoComplete="new-password"
                  placeholder={
                    hasKey
                      ? 'Saved securely · leave blank to keep'
                      : 'Optional for local providers'
                  }
                  maxLength={2048}
                />
                <small>
                  {hasKey
                    ? 'A key is already saved; its value is never sent back to your browser.'
                    : 'Enter a key if your provider requires one.'}
                </small>
              </label>
            </>
          )}
          <label>
            Chat model
            <input
              list="provider-models"
              value={config.model}
              onChange={(event) => field('model', event.target.value)}
              required={config.enabled}
              placeholder="Your provider’s model ID"
              maxLength={200}
            />
            <datalist id="provider-models">
              {models.map((model) => (
                <option key={model} value={model} />
              ))}
            </datalist>
          </label>
          <label>
            Reasoning effort
            <select
              aria-label="Reasoning effort"
              value={config.reasoningEffort}
              onChange={(event) => field('reasoningEffort', event.target.value)}
            >
              <option value="">Model default</option>
              {['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'].map(
                (effort) => (
                  <option key={effort} value={effort}>
                    {effort}
                  </option>
                ),
              )}
            </select>
            <small>
              Higher effort gives the model more time to think. Supported levels
              depend on the model.
            </small>
          </label>
          <button
            className="text-button"
            type="button"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                const result = await api<{ models: string[] }>('/ai/models')
                setModels(result.models)
                setMessage(
                  `${result.models.length} models loaded from the saved provider.`,
                )
              })
            }
          >
            Load available models from saved provider
          </button>
          <details className="settings-disclosure">
            <summary>Compatibility & image generation</summary>
            <label>
              Structured responses
              <select
                value={config.responseFormat}
                onChange={(event) =>
                  field('responseFormat', event.target.value)
                }
              >
                <option value="json">JSON mode · broad compatibility</option>
                <option value="schema">Strict JSON Schema</option>
                <option value="text">Prompted JSON · basic servers</option>
              </select>
              <small>
                Every proposal is validated on the server, in all modes.
              </small>
            </label>
            <label>
              Output token parameter
              <select
                value={config.tokenParameter}
                onChange={(event) =>
                  field('tokenParameter', event.target.value)
                }
              >
                <option value="max_completion_tokens">
                  max_completion_tokens
                </option>
                <option value="max_tokens">
                  max_tokens · older compatible servers
                </option>
                <option value="omit">Provider default</option>
              </select>
            </label>
            <label>
              Image model
              <input
                aria-label="Image model"
                value={config.imageModel}
                onChange={(event) => field('imageModel', event.target.value)}
                maxLength={200}
                placeholder="Optional · supported image model ID"
              />
              <small>
                {config.transport === 'companion'
                  ? 'Uses Hermes’s native image provider. Chat reasoning does not affect images.'
                  : 'Uses this provider’s /images/generations endpoint.'}{' '}
                Leave blank to hide generation controls.
              </small>
            </label>
            <label>
              Generated image size
              <select
                value={config.imageSize}
                onChange={(event) => field('imageSize', event.target.value)}
              >
                {['816x816', '1024x1024', '1536x1024', '1024x1536', 'auto'].map(
                  (size) => (
                    <option key={size}>{size}</option>
                  ),
                )}
              </select>
              <small>
                Recipe photo size; your model must support it. GPT Image 2 item
                icons request 816 × 816 and are saved at 256 × 256. The personal
                companion may return a different generation size.
              </small>
            </label>
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={config.autoItemIcons}
                disabled={!config.imageModel.trim()}
                onChange={(event) =>
                  field('autoItemIcons', event.target.checked)
                }
              />
              Automatically generate icons for new items
            </label>
            <small>
              Applies after saving to new items with the generic cart
              placeholder. Uses your image provider’s quota. Existing artwork is
              kept.
            </small>
            <IconGenerationSettings />
          </details>
          <details className="settings-disclosure advanced-prompts">
            <summary>Advanced prompts</summary>
            <p className="quiet-label">
              Control assistant behavior and image style. Recipe details are
              appended automatically. Required response structure, validation,
              and the review step remain in place. Start with the defaults below
              and edit them as needed.
            </p>
            {(
              [
                ['assistant', 'Assistant system instructions'],
                ['itemImage', 'Item and shop icon instructions'],
                ['recipeImage', 'Recipe photo instructions'],
              ] as const
            ).map(([key, label]) => (
              <label key={key}>
                {label}
                <textarea
                  aria-label={label}
                  rows={key === 'itemImage' ? 8 : 6}
                  maxLength={8000}
                  required
                  value={config.prompts[key]}
                  onChange={(event) =>
                    field('prompts', {
                      ...config.prompts,
                      [key]: event.target.value,
                    })
                  }
                />
              </label>
            ))}
            <button
              className="secondary-button"
              type="button"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const result = await api<{
                    promptDefaults: ProviderConfig['prompts']
                  }>('/ai/config')
                  field('prompts', result.promptDefaults)
                  setMessage(
                    'Default prompts restored in this form. Save provider to apply.',
                  )
                })
              }
            >
              Restore default prompts
            </button>
          </details>
          <div className="modal-actions">
            <button
              className="secondary-button"
              disabled={busy}
              type="button"
              onClick={() =>
                void run(async () => {
                  await post('/ai/test', { config, apiKey: apiKey || null })
                  setMessage(
                    'Connected. Your chat model responded successfully.',
                  )
                })
              }
            >
              {busy ? (
                <LoaderCircle size={16} className="spin" />
              ) : (
                <Check size={16} />
              )}
              Test connection
            </button>
            <button className="primary-button" disabled={busy}>
              Save provider
            </button>
          </div>
          {message && (
            <p className="success-message" role="status">
              {message}
            </p>
          )}
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          {(hasKey || companion.paired || session.aiEnabled) && (
            <button
              type="button"
              className="text-button danger"
              disabled={busy}
              onClick={() => setConfirmation('remove')}
            >
              <Trash2 size={15} />
              Disconnect and remove credentials
            </button>
          )}
        </form>
      </details>
      <Modal
        open={confirmation !== null}
        onOpenChange={(open) => {
          if (!open && !busy) setConfirmation(null)
        }}
        title={
          confirmation === 'replace'
            ? 'Replace companion token?'
            : confirmation === 'revoke'
              ? 'Revoke companion access?'
              : 'Disconnect AI assistant?'
        }
        description={
          confirmation === 'replace'
            ? 'The current companion will stop working until you install the new pairing token on your agent machine.'
            : confirmation === 'revoke'
              ? 'This stops the companion for your whole family. You will need to pair it again to reconnect.'
              : 'This removes the saved provider settings and credentials and revokes companion access for your whole family. You will need to configure the assistant again. Recipes and shopping lists are kept.'
        }
      >
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="modal-actions">
          <button
            className="secondary-button"
            type="button"
            autoFocus
            disabled={busy}
            onClick={() => setConfirmation(null)}
          >
            Cancel
          </button>
          <button
            className="secondary-button danger"
            type="button"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                if (confirmation === 'replace') {
                  await pairCompanion()
                } else if (confirmation === 'revoke') {
                  await api('/ai/companion', { method: 'DELETE' })
                  setCompanion({ paired: false, online: false })
                  setPairingToken('')
                  setMessage('Companion access revoked.')
                } else if (confirmation === 'remove') {
                  await api('/ai/config', { method: 'DELETE' })
                  const reset = await api<{ config: ProviderConfig }>(
                    '/ai/config',
                  )
                  setConfig(reset.config)
                  setHasKey(false)
                  setApiKey('')
                  setCompanion({ paired: false, online: false })
                  setPairingToken('')
                  await refreshSession()
                  setMessage('Provider configuration and credentials removed.')
                }
                setConfirmation(null)
              })
            }
          >
            {confirmation === 'replace'
              ? 'Replace token'
              : confirmation === 'revoke'
                ? 'Revoke access'
                : 'Disconnect and delete credentials'}
          </button>
        </div>
      </Modal>
    </section>
  )
}
