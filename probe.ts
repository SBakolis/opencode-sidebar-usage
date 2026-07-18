/**
 * Compile-only probe. Verifies that the pinned OpenCode plugin/SDK
 * packages expose the pinned contracts used by this package.
 *
 * This file is NOT shipped. It exists so Checkpoint 0 can prove every
 * SDK type we rely on is present and structurally what we expect.
 */

import type { Plugin, Hooks, ToolContext, ToolResult, AuthOAuthResult } from "@opencode-ai/plugin"
import { tool } from "@opencode-ai/plugin"
import type {
  Event,
  EventMessageUpdated,
  EventMessageRemoved,
  EventSessionIdle,
  EventSessionCompacted,
  EventSessionDeleted,
  AssistantMessage,
  Message,
  OAuth,
  Auth,
  SessionMessagesData,
  SessionMessagesResponses,
  TuiShowToastData,
  TuiShowToastResponses,
} from "@opencode-ai/sdk"
import type { z } from "zod"

// 1. Plugin shape: Plugin is a function (input) => Promise<Hooks>
export const CodexMeterPlugin: Plugin = async (ctx) => {
  void ctx
  const hooks: Hooks = {
    event: async ({ event }) => {
      switch (event.type) {
        case "message.updated": {
          const e: EventMessageUpdated = event
          const info: Message = e.properties.info
          if (info.role === "assistant") {
            const a: AssistantMessage = info
            const tokens = a.tokens
            const _input: number = tokens.input
            const _output: number = tokens.output
            const _reasoning: number = tokens.reasoning
            const _cacheRead: number = tokens.cache.read
            const _cacheWrite: number = tokens.cache.write
            const _providerID: string = a.providerID
            const _modelID: string = a.modelID
          }
          break
        }
        case "message.removed": {
          const e: EventMessageRemoved = event
          const _sessionID: string = e.properties.sessionID
          const _messageID: string = e.properties.messageID
          break
        }
        case "session.idle": {
          const e: EventSessionIdle = event
          const _sessionID: string = e.properties.sessionID
          break
        }
        case "session.compacted": {
          const e: EventSessionCompacted = event
          const _sessionID: string = e.properties.sessionID
          break
        }
        case "session.deleted": {
          const e: EventSessionDeleted = event
          const _sessionID: string = e.properties.info.id
          break
        }
        default:
          break
      }
    },
    tool: {
      codex_usage: tool({
        description: "Report Codex subscription quota and per-model session token usage.",
        args: {
          sessionID: tool.schema.string().optional(),
        },
        async execute(args, ctx): Promise<ToolResult> {
          const sid: string = args.sessionID ?? ctx.sessionID
          const _messageID: string = ctx.messageID
          const _agent: string = ctx.agent
          const _directory: string = ctx.directory
          const _worktree: string = ctx.worktree
          return `codex-meter probe: session ${sid}`
        },
      }),
    },
  }
  return hooks
}

// 2. Event union narrowing
const _eventUnion: Event = {} as Event
if (_eventUnion.type === "message.updated") {
  const _info: Message = _eventUnion.properties.info
}

// 3. session.messages() request/response types
type MessagesCallOptions = {
  path: { id: string }
  query?: SessionMessagesData["query"]
}
const _messagesCall: MessagesCallOptions = { path: { id: "probe" } }
type MessagesResponseBody = SessionMessagesResponses[200]
type MessageWithParts = MessagesResponseBody[number]
const _info: Message = {} as MessageWithParts["info"]

// 4. TUI toast API
const _toastCall: { body: TuiShowToastData["body"] } = {
  body: { message: "probe", variant: "info", duration: 1000 },
}
type ToastResponse = TuiShowToastResponses[200]
const _toastOk: ToastResponse = true

// 5. Auth types
const _oauth: OAuth = {
  type: "oauth",
  refresh: "rt_probe",
  access: "ey_probe",
  expires: 0,
}
const _apiAuth: Auth = { type: "api", key: "sk_probe" }
const _oauthAuth: Auth = _oauth

// 6. AuthOAuthResult includes accountId (even though OAuth SDK type omits it)
const _oauthResult: AuthOAuthResult = {
  url: "https://example.com",
  instructions: "visit",
  method: "auto",
  async callback() {
    return {
      type: "success",
      refresh: "rt",
      access: "at",
      expires: 1,
      accountId: "acct_probe",
    }
  },
}

// 7. ToolContext.sessionID is a string (not optional)
const _sessionIDFromCtx: string = ({} as ToolContext).sessionID

// 8. tool.schema is zod
const _schema: typeof z = tool.schema
const _argSchema = tool.schema.object({
  sessionID: tool.schema.string().optional(),
})
type _ArgType = z.infer<typeof _argSchema>
