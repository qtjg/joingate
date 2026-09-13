import { describe, expect, test } from 'bun:test'
import { tgCall, TelegramError, BENIGN_FRAGMENTS } from '../src/core.js'
import type { FetchLike } from '../src/core.js'

/** Build a FetchLike that answers with a Telegram envelope. */
function fakeFetch(
  responder: (url: string, body: any) => { status?: number; json: unknown } | Response,
): { fetch: FetchLike; calls: { url: string; body: any }[] } {
  const calls: { url: string; body: any }[] = []
  const fetch: FetchLike = async (url, init) => {
    const body = init?.body ? JSON.parse(String(init.body)) : {}
    calls.push({ url, body })
    const out = responder(url, body)
    if (out instanceof Response) return out
    return new Response(JSON.stringify(out.json), { status: out.status ?? 200 })
  }
  return { fetch, calls }
}

describe('tgCall', () => {
  test('unwraps a successful envelope', async () => {
    const { fetch, calls } = fakeFetch(() => ({ json: { ok: true, result: { id: 42, username: 'gate_bot' } } }))
    const result = await tgCall<{ id: number; username: string }>('T0KEN', 'getMe', {}, { fetchImpl: fetch })
    expect(result).toEqual({ id: 42, username: 'gate_bot' })
    expect(calls[0]?.url).toBe('https://api.telegram.org/botT0KEN/getMe')
  })

  test('sends JSON payload body', async () => {
    const { fetch, calls } = fakeFetch(() => ({ json: { ok: true, result: 1 } }))
    await tgCall('T0KEN', 'sendMessage', { chat_id: 7, text: 'hi' }, { fetchImpl: fetch })
    expect(calls[0]?.body).toEqual({ chat_id: 7, text: 'hi' })
  })

  test('throws TelegramError with code on ok:false', async () => {
    const { fetch } = fakeFetch(() => ({ status: 400, json: { ok: false, description: 'Bad Request: chat not found', error_code: 400 } }))
    try {
      await tgCall('T0KEN', 'getChat', {}, { fetchImpl: fetch })
      expect.unreachable()
    } catch (err) {
      expect(err).toBeInstanceOf(TelegramError)
      const e = err as TelegramError
      expect(e.method).toBe('getChat')
      expect(e.code).toBe(400)
      expect(e.benign).toBe(false)
    }
  })

  test('retries 429 respecting retry_after, then succeeds', async () => {
    let n = 0
    const { fetch, calls } = fakeFetch(() => {
      n += 1
      if (n === 1) return { status: 429, json: { ok: false, description: 'Too Many Requests: retry after 1', error_code: 429 } }
      return { json: { ok: true, result: 'fine' } }
    })
    const result = await tgCall('T0KEN', 'getUpdates', {}, { fetchImpl: fetch, retries: 2 })
    expect(result).toBe('fine')
    expect(calls.length).toBe(2)
  })

  test('gives up after retries and throws the 429 error', async () => {
    const { fetch, calls } = fakeFetch(() => ({ status: 429, json: { ok: false, description: 'Too Many Requests: retry after 1', error_code: 429 } }))
    try {
      await tgCall('T0KEN', 'getUpdates', {}, { fetchImpl: fetch, retries: 1 })
      expect.unreachable()
    } catch (err) {
      expect((err as TelegramError).rateLimited).toBe(true)
      expect(calls.length).toBe(2) // initial + 1 retry
    }
  })

  test('network failures become TelegramError', async () => {
    const fetch: FetchLike = async () => {
      throw new TypeError('fetch failed')
    }
    try {
      await tgCall('T0KEN', 'getMe', {}, { fetchImpl: fetch })
      expect.unreachable()
    } catch (err) {
      const e = err as TelegramError
      expect(e.method).toBe('getMe')
      expect(e.description).toContain('network')
    }
  })

  test('honors custom apiUrl', async () => {
    const { fetch, calls } = fakeFetch(() => ({ json: { ok: true, result: 1 } }))
    await tgCall('T0KEN', 'getMe', {}, { fetchImpl: fetch, apiUrl: 'https://tg.example.com/' })
    expect(calls[0]?.url).toBe('https://tg.example.com/botT0KEN/getMe')
  })
})

describe('TelegramError.benign', () => {
  test('flags already-gone kicks as benign', () => {
    const e = new TelegramError('banChatMember', 'Bad Request: PARTICIPANT_ID_INVALID', 400)
    expect(e.benign).toBe(true)
    expect(BENIGN_FRAGMENTS.length).toBeGreaterThan(0)
  })

  test('real failures are not benign', () => {
    const e = new TelegramError('banChatMember', 'Bad Request: not enough rights', 400)
    expect(e.benign).toBe(false)
  })
})
