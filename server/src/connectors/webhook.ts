import { z } from 'zod';
import { nanoid } from 'nanoid';
import type { NormalizedEvent } from '../shared/types.js';

export interface WebhookConnectionData {
  token: string;
}

/** Erwartetes JSON für eingehende Webhooks (Ko-fi, Streamer.bot, Zapier, eigene Tools …). */
export const webhookBody = z.object({
  id: z.string().max(100).optional(),
  type: z.enum(['follow', 'subscription', 'cheer', 'donation', 'raid', 'redemption', 'custom']).default('custom'),
  subtype: z.string().max(40).optional(),
  user: z.string().max(100).optional(),
  name: z.string().max(100).optional(),
  amount: z.coerce.number().optional(),
  currency: z.string().max(10).default('EUR'),
  message: z.string().max(500).optional(),
  count: z.coerce.number().int().optional(),
  months: z.coerce.number().int().optional(),
  tier: z.string().max(20).optional(),
  product: z.string().max(100).optional(),
});

export function normalizeWebhook(body: z.infer<typeof webhookBody>, connectionId: string): NormalizedEvent {
  return {
    id: `wh_${connectionId}_${body.id ?? nanoid(12)}`,
    platform: 'webhook',
    type: body.type,
    subtype: body.subtype,
    user: { name: body.user || body.name || 'Anonym' },
    amount: body.amount != null ? { value: body.amount, currency: body.currency } : undefined,
    message: body.message,
    count: body.count,
    months: body.months,
    tier: body.tier,
    product: body.product,
    receivedAt: new Date().toISOString(),
    raw: body,
  };
}
