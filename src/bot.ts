/**
 * Bot & chat inspection: prove a token is live, verify the bot holds the
 * admin rights your gating flow needs, and read chat metadata.
 */
import { tgCall, TelegramError, type CallOptions } from './core.js'

export interface BotInfo {
  id: number
  username: string
  /** Display name of the bot, when Telegram returns one. */
  name?: string
}

type RawChatMember = {
  status: string
  can_invite_users?: boolean
  can_restrict_members?: boolean
}

export interface ChatPermissions {
  /** Bot is present in the chat (any member-ish status). */
  isMember: boolean
  /** Bot is an administrator. */
  isAdmin: boolean
  /** Administrator with the "Invite Users via Link" right — needed to create invite links. */
  canInvite: boolean
  /** Administrator with the "Ban Users" right — needed to kick/revoke. */
  canKick: boolean
}

/** `getMe` — proves the token is live and returns the bot's real identity. */
export async function verifyBot(token: string, opts?: CallOptions): Promise<BotInfo> {
  const me = await tgCall<{ id: number; username: string; first_name?: string }>(
    token,
    'getMe',
    {},
    { timeoutMs: 10_000, ...opts },
  )
  if (!me?.username) throw new TelegramError('getMe', 'bot has no username')
  return { id: me.id, username: me.username, name: me.first_name }
}

/**
 * Inspect the BOT's own membership in a chat (not a human user's):
 * admin status and the two rights a gating flow depends on.
 * - `canInvite` — required by {@link createInvite}
 * - `canKick`  — required by {@link kickMember}
 */
export async function chatPermissions(token: string, chatId: string, opts?: CallOptions): Promise<ChatPermissions> {
  const me = await verifyBot(token, opts)
  const member = await tgCall<RawChatMember>(
    token,
    'getChatMember',
    { chat_id: chatId, user_id: me.id },
    { timeoutMs: 10_000, ...opts },
  )
  const isAdmin = member?.status === 'administrator'
  return {
    isMember: ['creator', 'administrator', 'member'].includes(member?.status ?? ''),
    isAdmin,
    canInvite: isAdmin && member.can_invite_users === true,
    canKick: isAdmin && member.can_restrict_members === true,
  }
}

/**
 * Check whether a specific user is currently in the chat.
 * Useful for re-entry checks before issuing a fresh invite.
 * A revoked/kicked user resolves as `false`, not an error.
 */
export async function isMember(token: string, chatId: string, userId: number | string, opts?: CallOptions): Promise<boolean> {
  const member = await tgCall<{ status: string }>(
    token,
    'getChatMember',
    { chat_id: chatId, user_id: Number(userId) },
    { timeoutMs: 10_000, ...opts },
  )
  return ['creator', 'administrator', 'member'].includes(member?.status ?? '')
}

/** Public title of a chat; `null` when the bot cannot see it (never throws). */
export async function chatTitle(token: string, chatId: string, opts?: CallOptions): Promise<string | null> {
  try {
    const chat = await tgCall<{ title?: string }>(token, 'getChat', { chat_id: chatId }, { timeoutMs: 10_000, ...opts })
    return chat?.title ?? null
  } catch {
    return null
  }
}
