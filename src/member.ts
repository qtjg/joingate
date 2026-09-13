/**
 * Member lifecycle: kick (ban + immediate unban) and best-effort DMs.
 * Kicks treat "already gone" failures as success so cleanup jobs stay
 * idempotent — safe to run on a schedule without bookkeeping.
 */
import { tgCall, type CallOptions } from './core.js'

/**
 * Remove a member WITHOUT banning them: ban + instant unban is Telegram's
 * canonical removal. They lose access now but can receive fresh invites
 * later (e.g. after renewing).
 *
 * Benign failures — user already left, never joined — resolve normally
 * instead of throwing, so re-running an expired-subscriber sweep is safe.
 */
export async function kickMember(
  token: string,
  chatId: string,
  userId: number | string,
  opts: CallOptions = {},
): Promise<void> {
  try {
    await tgCall(
      token,
      'banChatMember',
      { chat_id: chatId, user_id: Number(userId), revoke_invite_link: false },
      { timeoutMs: 15_000, ...opts },
    )
    await tgCall(
      token,
      'unbanChatMember',
      { chat_id: chatId, user_id: Number(userId), only_if_banned: true },
      { timeoutMs: 15_000, ...opts },
    )
  } catch (err) {
    if (err instanceof Error && 'benign' in err && (err as { benign?: boolean }).benign) return
    throw err
  }
}

export type DmOutcome = 'ok' | 'rejected' | 'unknown'

/**
 * Best-effort HTML message from your bot to a user. Never throws — inspect
 * the outcome instead:
 * - `ok`        delivered
 * - `rejected`  Telegram refused (typical: user never pressed Start on the bot)
 * - `unknown`   network-level ambiguity — treat as "retry later"
 */
export async function dmUser(
  token: string,
  userId: number | string,
  html: string,
  opts: CallOptions = {},
): Promise<DmOutcome> {
  try {
    await tgCall(
      token,
      'sendMessage',
      { chat_id: userId, text: html, parse_mode: 'HTML', disable_web_page_preview: true },
      { timeoutMs: 15_000, ...opts },
    )
    return 'ok'
  } catch (err) {
    if (err instanceof Error && 'method' in err) return 'rejected'
    return 'unknown'
  }
}
