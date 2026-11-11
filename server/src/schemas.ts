import { z } from 'zod';

const color = z.string().regex(/^#[0-9a-fA-F]{3,8}$/);
const pct = z.number().min(0).max(100);
const animName = z.string().regex(/^[a-zA-Z]*$/).max(40);
const url = z.string().max(2000).refine((u) => u === '' || u.startsWith('/media/') || /^https:\/\//.test(u), 'nur https:// oder /media/');

export const templateSchema = z.object({
  id: z.string().min(1).max(40),
  name: z.string().min(1).max(80),
  layout: z.enum(['above', 'below', 'left', 'textOnly']),
  positioning: z.object({
    mode: z.enum(['preset', 'manual']),
    image: z.object({ x: pct, y: pct }),
    text: z.object({ x: pct, y: pct }),
  }),
  media: z.object({
    kind: z.enum(['none', 'image', 'video']),
    url,
    size: z.number().min(1).max(200),
    volume: z.number().min(0).max(1),
    giphyId: z.string().max(100).optional(),
  }),
  sound: z.object({ url, volume: z.number().min(0).max(1) }),
  text: z.object({
    format: z.string().max(300),
    font: z.string().max(80),
    size: z.number().min(8).max(300),
    weight: z.number().min(100).max(900),
    color,
    highlightColor: color,
    strokeColor: color,
    strokeWidth: z.number().min(0).max(20),
    shadow: z.boolean(),
    intro: animName,
    letterAnimation: z.enum(['none', 'bounce', 'pulse', 'rubberBand', 'tada', 'wave', 'wiggle', 'wobble']),
    outro: animName,
  }),
  message: z.object({
    show: z.boolean(),
    font: z.string().max(80),
    size: z.number().min(8).max(200),
    weight: z.number().min(100).max(900),
    color,
    minAmount: z.number().min(0),
  }),
  animation: z.object({ in: animName, out: animName, speedMs: z.number().min(100).max(5000) }),
  duration: z.number().min(1000).max(120000),
  textDelay: z.number().min(0).max(60000),
});

const eventType = z.enum(['follow', 'subscription', 'cheer', 'donation', 'raid', 'redemption', 'stream_status', 'custom']);

export const ruleSchema = z.object({
  id: z.string().min(1).max(40),
  overlayId: z.string().min(1).max(40),
  name: z.string().min(1).max(80),
  trigger: z.object({
    type: eventType,
    subtype: z.string().max(40).optional(),
    platform: z.enum(['twitch', 'betterplace', 'webhook', 'test']).optional(),
  }),
  conditions: z.array(
    z.object({
      field: z.string().max(60),
      op: z.enum(['eq', 'neq', 'gte', 'lte', 'between', 'contains', 'regex', 'empty', 'notEmpty', 'largestOfStream', 'firstFromUser', 'random']),
      value: z.union([z.string().max(200), z.number()]).optional(),
      value2: z.union([z.string().max(200), z.number()]).optional(),
    }),
  ).max(20),
  priority: z.number().int().min(0).max(10000),
  weight: z.number().min(0).max(1000),
  templateId: z.string().min(1).max(40),
  enabled: z.boolean(),
  onlyWhenLive: z.boolean(),
});

export const settingsSchema = z.object({
  minDonationAmount: z.number().min(0),
  blockedUsers: z.array(z.string().max(100)).max(1000),
  badWords: z.array(z.string().max(100)).max(1000),
  badWordMode: z.enum(['censor', 'hide']),
});

export const overlayPatchSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  width: z.number().int().min(100).max(7680).optional(),
  height: z.number().int().min(100).max(4320).optional(),
  alertDelay: z.number().int().min(0).max(60000).optional(),
  volume: z.number().min(0).max(1).optional(),
  muted: z.boolean().optional(),
});

export const testEventSchema = z.object({
  type: eventType,
  subtype: z.string().max(40).optional(),
  user: z.string().max(100).optional(),
  amount: z.number().optional(),
  count: z.number().optional(),
  months: z.number().optional(),
  message: z.string().max(500).optional(),
});
