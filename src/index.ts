/**
 * joingate — one-time invite links, member gating and kick automation for
 * Telegram groups & channels. Zero dependencies, any JS runtime.
 */

export {
  tgCall,
  TelegramError,
  BENIGN_FRAGMENTS,
  API_BASE,
  type CallOptions,
  type FetchLike,
} from './core.js'

export {
  verifyBot,
  chatPermissions,
  isMember,
  chatTitle,
  type BotInfo,
  type ChatPermissions,
} from './bot.js'

export { createInvite, type InviteOptions, type InviteLink } from './invite.js'

export { kickMember, dmUser, type DmOutcome } from './member.js'

export { JoinGate, type JoinGateOptions } from './gate.js'
