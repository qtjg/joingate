/**
 * Invite links: single-use, expiring, created by your bot as the admin.
 * The one-time (`memberLimit: 1`) pattern means a leaked link can never
 * let more than the paying user in.
 */
import { tgCall, type CallOptions } from './core.js'

export interface InviteOptions {
  /**
   * How many joins the link allows before it dies. Default `1` — the whole
   * point of a gate: one payment, one seat, leak-proof.
   */
  memberLimit?: number
  /** Link validity in hours. Default `24`. */
  ttlHours?: number
  /** Optional label shown in Telegram clients managing the link. */
  name?: string
}

export interface InviteLink {
  /** t.me/... join link, ready to hand to the buyer. */
  link: string
  /** Exact expiry as a `Date` — persist this to schedule cleanup/kicks. */
  expiresAt: Date
}

/**
 * Create an invite link signed by the bot. The bot must sit in the target
 * chat as an administrator with the *Invite Users via Link* right — check
 * with `chatPermissions` first for a clear error message.
 */
export async function createInvite(
  token: string,
  chatId: string,
  opts: InviteOptions & CallOptions = {},
): Promise<InviteLink> {
  const memberLimit = opts.memberLimit ?? 1
  const ttlHours = opts.ttlHours ?? 24
  const expiresAt = new Date(Date.now() + ttlHours * 3_600_000)

  const link = await tgCall<{ invite_link: string; name?: string }>(
    token,
    'createChatInviteLink',
    {
      chat_id: chatId,
      member_limit: memberLimit,
      expires_at: Math.floor(expiresAt.getTime() / 1000),
      ...(opts.name ? { name: opts.name } : {}),
    },
    { timeoutMs: 15_000, fetchImpl: opts.fetchImpl, retries: opts.retries },
  )

  return { link: link.invite_link, expiresAt }
}
