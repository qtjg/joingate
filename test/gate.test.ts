import { describe, expect, test } from 'bun:test'
import { JoinGate, verifyBot, chatPermissions, createInvite, kickMember, dmUser, isMember } from '../src/index.js'
import { TelegramError } from '../src/core.js'
import type { FetchLike } from '../src/core.js'

type Envelope = { status?: number; json: unknown }

function makeFetch(routes: Record<string, (body: any) => Envelope>): { fetch: FetchLike; calls: { url: string; body: any }[] } {
  const calls: { url: string; body: any }[] = []
  const fetch: FetchLike = async (url, init) => {
    const body = init?.body ? JSON.parse(String(init.body)) : {}
    calls.push({ url, body })
    const method = String(url).split('/').pop() as string
    const route = routes[method]
    if (!route) return new Response(JSON.stringify({ ok: false, description: `no route for ${method}`, error_code: 404 }), { status: 404 })
    const out = route(body)
    return new Response(JSON.stringify(out.json), { status: out.status ?? 200 })
  }
  return { fetch, calls }
}

const OK = (result: unknown): Envelope => ({ json: { ok: true, result } })

describe('JoinGate facade', () => {
  test('verifyBot returns identity', async () => {
    const { fetch } = makeFetch({ getMe: () => OK({ id: 1, username: 'joingate_bot', first_name: 'JoinGate' }) })
    const gate = new JoinGate('T0KEN', { fetchImpl: fetch })
    const me = await gate.verifyBot()
    expect(me.username).toBe('joingate_bot')
    expect(me.name).toBe('JoinGate')
  })

  test('chatPermissions maps admin rights', async () => {
    const { fetch } = makeFetch({
      getMe: () => OK({ id: 1, username: 'joingate_bot' }),
      getChatMember: () => OK({ status: 'administrator', can_invite_users: true, can_restrict_members: false }),
    })
    const gate = new JoinGate('T0KEN', { fetchImpl: fetch })
    const perms = await gate.chatPermissions('-100123')
    expect(perms).toEqual({ isMember: true, isAdmin: true, canInvite: true, canKick: false })
  })

  test('createInvite defaults to one-time 24h link', async () => {
    const { fetch, calls } = makeFetch({ createChatInviteLink: () => OK({ invite_link: 'https://t.me/+abc' }) })
    const gate = new JoinGate('T0KEN', { fetchImpl: fetch })
    const invite = await gate.createInvite('-100123')
    expect(invite.link).toBe('https://t.me/+abc')
    const body = calls[0]?.body
    expect(body.member_limit).toBe(1)
    expect(body.expires_at).toBeGreaterThan(Math.floor(Date.now() / 1000) + 23 * 3600)
    expect(invite.expiresAt.getTime()).toBeGreaterThan(Date.now() + 23 * 3600 * 1000)
  })

  test('createInvite honors custom ttl/limit/name', async () => {
    const { fetch, calls } = makeFetch({ createChatInviteLink: () => OK({ invite_link: 'https://t.me/+x' }) })
    const gate = new JoinGate('T0KEN', { fetchImpl: fetch })
    await gate.createInvite('-100123', { memberLimit: 5, ttlHours: 48, name: 'order_99' })
    const body = calls[0]?.body
    expect(body.member_limit).toBe(5)
    expect(body.name).toBe('order_99')
  })

  test('kick succeeds on benign already-gone error', async () => {
    const { fetch, calls } = makeFetch({
      banChatMember: () => ({ status: 400, json: { ok: false, description: 'Bad Request: PARTICIPANT_ID_INVALID', error_code: 400 } }),
    })
    const gate = new JoinGate('T0KEN', { fetchImpl: fetch })
    await gate.kick('-100123', '777')
    expect(calls.length).toBe(1) // ban failed benign → unban skipped
  })

  test('kick performs ban then unban', async () => {
    const { fetch, calls } = makeFetch({
      banChatMember: () => OK(true),
      unbanChatMember: () => OK(true),
    })
    const gate = new JoinGate('T0KEN', { fetchImpl: fetch })
    await gate.kick('-100123', 777)
    expect(calls.length).toBe(2)
    expect(calls[0]?.body).toMatchObject({ chat_id: '-100123', user_id: 777, revoke_invite_link: false })
    expect(calls[1]?.body).toMatchObject({ only_if_banned: true })
  })

  test('kick rethrows non-benign errors', async () => {
    const { fetch } = makeFetch({
      banChatMember: () => ({ status: 400, json: { ok: false, description: 'Bad Request: not enough rights to restrict/unrestrict chat member', error_code: 400 } }),
    })
    const gate = new JoinGate('T0KEN', { fetchImpl: fetch })
    try {
      await gate.kick('-100123', 777)
      expect.unreachable()
    } catch (err) {
      expect((err as TelegramError).description).toContain('not enough rights')
    }
  })

  test('dm returns rejected on Telegram refusal, ok on success', async () => {
    const bad = makeFetch({ sendMessage: () => ({ status: 403, json: { ok: false, description: 'Forbidden: bot can\'t initiate conversation with a user', error_code: 403 } }) })
    const good = makeFetch({ sendMessage: () => OK({ message_id: 5 }) })
    const gateBad = new JoinGate('T0KEN', { fetchImpl: bad.fetch })
    const gateGood = new JoinGate('T0KEN', { fetchImpl: good.fetch })
    expect(await gateBad.dm('777', '<b>welcome</b>')).toBe('rejected')
    expect(await gateGood.dm('777', '<b>welcome</b>')).toBe('ok')
  })

  test('isMember resolves membership status', async () => {
    const inside = makeFetch({ getChatMember: () => OK({ status: 'member' }) })
    const outside = makeFetch({ getChatMember: () => OK({ status: 'left' }) })
    const gateIn = new JoinGate('T0KEN', { fetchImpl: inside.fetch })
    const gateOut = new JoinGate('T0KEN', { fetchImpl: outside.fetch })
    expect(await gateIn.isMember('-100123', '777')).toBe(true)
    expect(await gateOut.isMember('-100123', '777')).toBe(false)
  })

  test('raw escape hatch hits the method directly', async () => {
    const { fetch, calls } = makeFetch({ getChat: () => OK({ id: -100123, title: 'Inner Circle' }) })
    const gate = new JoinGate('T0KEN', { fetchImpl: fetch })
    const chat = await gate.raw<{ title: string }>('getChat', { chat_id: '-100123' })
    expect(chat.title).toBe('Inner Circle')
    expect(calls[0]?.url.endsWith('/getChat')).toBe(true)
  })
})

describe('standalone functions', () => {
  test('verifyBot rejects username-less bots', async () => {
    const { fetch } = makeFetch({ getMe: () => OK({ id: 2 }) })
    try {
      await verifyBot('T0KEN', { fetchImpl: fetch })
      expect.unreachable()
    } catch (err) {
      expect((err as TelegramError).method).toBe('getMe')
    }
  })

  test('chatTitle returns null instead of throwing when invisible', async () => {
    const { fetch } = makeFetch({}) // no getChat route → 404 envelope
    const { chatTitle: title } = await import('../src/bot.js')
    expect(await title('T0KEN', '-100123', { fetchImpl: fetch })).toBeNull()
  })

  test('functional createInvite works without the class', async () => {
    const { fetch } = makeFetch({ createChatInviteLink: () => OK({ invite_link: 'https://t.me/+f' }) })
    const invite = await createInvite('T0KEN', '-100123', { fetchImpl: fetch })
    expect(invite.link).toBe('https://t.me/+f')
  })

  test('functional kick/dm/isMember export signatures', async () => {
    const { fetch, calls } = makeFetch({
      banChatMember: () => OK(true),
      unbanChatMember: () => OK(true),
    })
    await kickMember('T0KEN', '-100123', 5, { fetchImpl: fetch })
    expect(calls.length).toBe(2)
    expect(typeof dmUser).toBe('function')
    expect(typeof isMember).toBe('function')
  })
})

describe('chatPermissions for non-admin bot', () => {
  test('plain member cannot invite or kick', async () => {
    const { fetch } = makeFetch({
      getMe: () => OK({ id: 1, username: 'b' }),
      getChatMember: () => OK({ status: 'member' }),
    })
    const perms = await chatPermissions('T0KEN', '-100', { fetchImpl: fetch })
    expect(perms.canInvite).toBe(false)
    expect(perms.canKick).toBe(false)
    expect(perms.isAdmin).toBe(false)
    expect(perms.isMember).toBe(true)
  })
})
