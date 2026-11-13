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
    effect: z.string().regex(/^[a-z]{0,20}$/),
    effectSpeed: z.number().min(0.25).max(5),
    effectColors: z.enum(['effect', 'text']),
    outro: animName,
  }),
  message: z.object({
    show: z.boolean(),
    font: z.string().max(80),
    size: z.number().min(8).max(200),
    weight: z.number().min(100).max(900),
    color,
    minAmount: z.number().min(0),
    allowEmotes: z.boolean(),
  }),
  tts: z.object({
    enabled: z.boolean(),
    voice: z.string().max(200),
    lang: z.string().max(20),
    minAmount: z.number().min(0),
    volume: z.number().min(0).max(1),
    includeTemplate: z.boolean(),
    security: z.number().int().min(0).max(3),
    repetitionBlock: z.number().int().min(0).max(100),
  }),
  custom: z.object({
    enabled: z.boolean(),
    html: z.string().max(50_000),
    css: z.string().max(50_000),
    js: z.string().max(50_000),
    fields: z.string().max(10_000).refine((f) => {
      try {
        const v = JSON.parse(f || '{}');
        return v && typeof v === 'object' && !Array.isArray(v);
      } catch {
        return false;
      }
    }, 'muss ein JSON-Objekt sein'),
  }),
  animation: z.object({ enabled: z.boolean(), in: animName, out: animName, speedMs: z.number().min(100).max(5000) }),
  duration: z.number().min(1000).max(120000),
  textDelay: z.number().min(0).max(60000),
});

const eventType = z.enum(['follow', 'subscription', 'cheer', 'donation', 'raid', 'redemption', 'power_up', 'charity', 'milestone', 'superchat', 'membership', 'subscriber', 'stream_status', 'custom']);

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
  profileId: z.string().max(40).optional(),
  kind: z.enum(['default', 'variation']).optional(),
});

export const settingsSchema = z.object({
  minDonationAmount: z.number().min(0),
  blockedUsers: z.array(z.string().max(100)).max(1000),
  badWords: z.array(z.string().max(100)).max(1000),
  badWordMode: z.enum(['censor', 'hide']),
  useDefaultBadWords: z.boolean(),
  anonymizeNames: z.boolean(),
  censorEventLog: z.boolean(),
  autoResetSession: z.boolean(),
  betterplaceTestMode: z.boolean(),
});

export const overlayPatchSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  width: z.number().int().min(100).max(7680).optional(),
  height: z.number().int().min(100).max(4320).optional(),
  alertDelay: z.number().int().min(0).max(60000).optional(),
  volume: z.number().min(0).max(1).optional(),
  muted: z.boolean().optional(),
  moderationDelay: z.number().int().min(-1).max(600_000).optional(),
  interruptMode: z.boolean().optional(),
  interruptDelay: z.number().int().min(0).max(60_000).optional(),
  disabledTypes: z.array(z.string().max(40)).max(50).optional(),
  activeProfileId: z.string().max(40).optional(),
  previewBackground: z.string().regex(/^#[0-9a-fA-F]{3,8}$/).optional(),
  portrait: z
    .object({
      scale: z.number().min(50).max(400),
      align: z.enum(['top', 'center', 'bottom']),
      safeTop: z.number().min(0).max(45),
      safeBottom: z.number().min(0).max(45),
      stackSideBySide: z.boolean(),
    })
    .partial()
    .optional(),
});

export const testEventSchema = z.object({
  type: eventType,
  subtype: z.string().max(40).optional(),
  user: z.string().max(100).optional(),
  amount: z.number().optional(),
  count: z.number().optional(),
  months: z.number().optional(),
  message: z.string().max(500).optional(),
  product: z.string().max(100).optional(),
});
