/**
 * `JoinGate` — a thin facade that binds your bot token once so call sites
 * stay clean. Every method also exists as a standalone function for a
 * functional style; both share the same core.
 */
import { tgCall, type CallOptions } from './core.js'
import { verifyBot, chatPermissions, isMember, chatTitle, type BotInfo, type ChatPermissions } from './bot.js'
import { createInvite, type InviteLink, type InviteOptions } from './invite.js'
import { kickMember, dmUser, type DmOutcome } from './member.js'

export interface JoinGateOptions extends CallOptions {}

export class JoinGate {
  private readonly token: string
  private readonly opts: JoinGateOptions

  constructor(token: string, opts: JoinGateOptions = {}) {
    this.token = token
    this.opts = opts
  }

  /** Escape hatch to any Bot API method joingate doesn't wrap (still typed errors + 429 retry). */
  raw<T>(method: string, payload?: unknown): Promise<T> {
    return tgCall<T>(this.token, method, payload, this.opts)
  }

  /** Prove the token is live; get the bot's identity. */
  verifyBot(): Promise<BotInfo> {
    return verifyBot(this.token, this.opts)
  }

  /** Does the bot hold the admin rights needed for gating in this chat? */
  chatPermissions(chatId: string): Promise<ChatPermissions> {
    return chatPermissions(this.token, chatId, this.opts)
  }

  /** Is this user currently in the chat? */
  isMember(chatId: string, userId: number | string): Promise<boolean> {
    return isMember(this.token, chatId, userId, this.opts)
  }

  /** Chat title, or null when invisible. Never throws. */
  chatTitle(chatId: string): Promise<string | null> {
    return chatTitle(this.token, chatId, this.opts)
  }

  /** Create a one-time, expiring invite link (defaults: 1 join, 24h). */
  createInvite(chatId: string, opts: InviteOptions = {}): Promise<InviteLink> {
    return createInvite(this.token, chatId, { ...this.opts, ...opts })
  }

  /** Ban + instant unban removal; "already gone" resolves as success. */
  kick(chatId: string, userId: number | string): Promise<void> {
    return kickMember(this.token, chatId, userId, this.opts)
  }

  /** Best-effort DM; never throws — see DmOutcome. */
  dm(userId: number | string, html: string): Promise<DmOutcome> {
    return dmUser(this.token, userId, html, this.opts)
  }
}
