/**
 * Low-level Telegram Bot API plumbing shared by every joingate helper:
 * typed errors, request timeouts, automatic 429 retry and "benign" failure
 * mapping (failures that actually mean the goal is already achieved).
 *
 * Zero dependencies — uses the platform `fetch`, so joingate runs on
 * Node 18+, Bun, Deno and edge/workers runtimes unchanged.
 */

export const API_BASE = 'https://api.telegram.org'

/** A fetch-compatible function — inject your own for tests or proxies. */
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

export interface CallOptions {
  /** Per-request timeout in milliseconds. Default 15 000. */
  timeoutMs?: number
  /** How many times to retry when Telegram answers 429 Too Many Requests. Default 2. */
  retries?: number
  /** Override the fetch implementation. Defaults to globalThis.fetch. */
  fetchImpl?: FetchLike
  /** API root override — point at a self-hosted Bot API server. */
  apiUrl?: string
}

/**
 * Failure descriptions that mean the desired end-state already holds, so the
 * caller should treat the operation as successful instead of retrying:
 * - `USER_NOT_PARTICIPANT` / `PARTICIPANT_ID_INVALID` — kicking someone who
 *   already left or never joined; the member is gone either way.
 * - `USER_ALREADY_PARTICIPANT` — approving an add that already happened.
 */
export const BENIGN_FRAGMENTS = [
  'PARTICIPANT_ID_INVALID',
  'USER_NOT_PARTICIPANT',
  'USER_ALREADY_PARTICIPANT',
  'user not found',
  'participant not found',
] as const

export class TelegramError extends Error {
  /** Bot API method that failed, e.g. `createChatInviteLink`. */
  readonly method: string
  /** Human-readable description from Telegram (or joingate itself). */
  readonly description: string
  /** Telegram `error_code` / HTTP status when known. */
  readonly code: number | undefined

  constructor(method: string, description: string, code?: number) {
    super(`Telegram \`${method}\` failed: ${description}`)
    this.name = 'TelegramError'
    this.method = method
    this.description = description
    this.code = code
  }

  /**
   * True when the failure means "goal already achieved" — safe to swallow.
   * e.g. kicking a user who already left the chat.
   */
  get benign(): boolean {
    return BENIGN_FRAGMENTS.some((frag) => this.description.includes(frag))
  }

  /** True when Telegram rate-limited us (`error_code === 429`). */
  get rateLimited(): boolean {
    return this.code === 429
  }

  /** Seconds Telegram asked us to wait after a 429, when present. */
  get retryAfterSeconds(): number | undefined {
    const m = /retry after (\d+)/i.exec(this.description)
    return m ? Number(m[1]) : undefined
  }
}

interface TelegramEnvelope<T> {
  ok: boolean
  result?: T
  description?: string
  error_code?: number
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/**
 * Call a Telegram Bot API method and unwrap the envelope.
 * Throws {@link TelegramError} on every hard failure so callers can retry
 * with their own backoff or persist an accurate error state.
 *
 * 429 responses are retried automatically (respecting `retry_after`) up to
 * `opts.retries` times before the error propagates.
 */
export async function tgCall<T>(
  token: string,
  method: string,
  payload?: unknown,
  opts: CallOptions = {},
): Promise<T> {
  const timeoutMs = opts.timeoutMs ?? 15_000
  const retries = opts.retries ?? 2
  const doFetch = opts.fetchImpl ?? globalThis.fetch
  const base = (opts.apiUrl ?? API_BASE).replace(/\/$/, '')

  let res: Response | undefined
  let attempts = 0

  // The loop only repeats for 429s; every other outcome returns or throws.
  for (;;) {
    try {
      res = await doFetch(`${base}/bot${token}/${method}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload ?? {}),
        signal: AbortSignal.timeout(timeoutMs),
      })
    } catch (err) {
      throw new TelegramError(method, `network: ${String(err).slice(0, 160)}`)
    }

    const json = (await res.json().catch(() => null)) as TelegramEnvelope<T> | null
    if (!json) throw new TelegramError(method, `unparseable response (http ${res.status})`, res.status)

    if (json.ok) return json.result as T

    const error = new TelegramError(method, json.description ?? 'unknown error', json.error_code ?? res.status)
    if (error.rateLimited && attempts < retries) {
      const waitMs = Math.min((error.retryAfterSeconds ?? 1) * 1000, 15_000)
      attempts += 1
      await sleep(waitMs)
      continue
    }
    throw error
  }
}
