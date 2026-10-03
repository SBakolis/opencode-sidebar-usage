import { Rpc } from "@opencode/plugin";
import { z } from "zod";
import type { QuotaSnapshot } from "./quota/types";

const UsageWindowSchema = z
  .object({
    kind: z.enum(["five-hour", "weekly", "unknown"]),
    usedPercent: z.number(),
    windowSeconds: z.number(),
    resetsAt: z.string().nullable(),
    resetAfterSeconds: z.number().nullable(),
  })
  .strict();

const QuotaSnapshotSchema: z.ZodType<QuotaSnapshot> = z
  .object({
    status: z.enum(["ok", "stale", "unauthenticated", "unsupported", "unavailable"]),
    fetchedAt: z.string(),
    source: z.enum(["opencode", "chatgpt-wham", "none"]),
    planType: z.string().nullable(),
    fiveHour: UsageWindowSchema.nullable(),
    weekly: UsageWindowSchema.nullable(),
    unknownWindows: z.array(UsageWindowSchema),
    credits: z
      .object({
        hasCredits: z.boolean(),
        unlimited: z.boolean(),
        balance: z.string().nullable(),
      })
      .strict()
      .nullable(),
    resetCredits: z
      .object({
        availableCount: z.number(),
        credits: z
          .array(
            z
              .object({
                resetType: z.string(),
                title: z.string().nullable(),
                expiresAt: z.string().nullable(),
              })
              .strict(),
          )
          .nullable(),
      })
      .strict()
      .nullable(),
    warningCode: z.string().nullable(),
  })
  .strict();

export { QuotaSnapshotSchema };

export const CodexMeterRpc = Rpc.define({
  id: "opencode-codex-meter",
  methods: {
    quota: {
      input: z.object({}).strict(),
      output: QuotaSnapshotSchema,
    },
  },
  events: {},
});
