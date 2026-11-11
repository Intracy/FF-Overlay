import type { NormalizedEvent } from '../../shared/types.js';

/* Übersetzt Twitch-EventSub-Benachrichtigungen in das einheitliche Event-Format.
   Felder laut https://dev.twitch.tv/docs/eventsub/eventsub-subscription-types/ */

type TwitchEvent = Record<string, any>;

export function normalizeTwitch(subscriptionType: string, e: TwitchEvent, messageId: string, receivedAt = new Date().toISOString()): NormalizedEvent | null {
  const base = { id: `tw_${messageId}`, platform: 'twitch' as const, receivedAt, raw: e };
  const user = (id?: string, name?: string, login?: string) => ({ id, name: name || login || 'Unbekannt' });

  switch (subscriptionType) {
    case 'channel.follow':
      return { ...base, type: 'follow', user: user(e.user_id, e.user_name, e.user_login) };

    case 'channel.subscribe':
      // is_gift=true: Empfänger eines Gift-Subs – das zugehörige Gift-Event erzeugt den Alert.
      return {
        ...base, type: 'subscription', subtype: e.is_gift ? 'gift_recipient' : 'sub',
        user: user(e.user_id, e.user_name, e.user_login), tier: e.tier, months: 1,
      };

    case 'channel.subscription.message':
      return {
        ...base, type: 'subscription', subtype: 'resub',
        user: user(e.user_id, e.user_name, e.user_login), tier: e.tier,
        months: e.cumulative_months ?? undefined, streakMonths: e.streak_months ?? undefined,
        message: e.message?.text ?? undefined,
        emotes: (e.message?.emotes ?? []).map((x: { id: string; begin: number; end: number }) => ({ id: String(x.id), begin: x.begin, end: x.end })),
      };

    case 'channel.subscription.gift':
      return {
        ...base, type: 'subscription', subtype: 'gift',
        user: e.is_anonymous ? { name: 'Anonym' } : user(e.user_id, e.user_name, e.user_login),
        gifter: e.is_anonymous ? 'Anonym' : e.user_name, isAnonymous: !!e.is_anonymous,
        tier: e.tier, count: e.total ?? 1,
      };

    case 'channel.cheer':
      return {
        ...base, type: 'cheer',
        user: e.is_anonymous ? { name: 'Anonym' } : user(e.user_id, e.user_name, e.user_login),
        isAnonymous: !!e.is_anonymous, count: e.bits, amount: { value: e.bits, currency: 'BITS' }, message: e.message || undefined,
      };

    case 'channel.raid':
      return {
        ...base, type: 'raid',
        user: user(e.from_broadcaster_user_id, e.from_broadcaster_user_name, e.from_broadcaster_user_login), count: e.viewers,
      };

    case 'channel.channel_points_custom_reward_redemption.add':
      return {
        ...base, type: 'redemption',
        user: user(e.user_id, e.user_name, e.user_login), product: e.reward?.title, count: e.reward?.cost,
        message: e.user_input || undefined,
      };

    case 'channel.bits.use': {
      // Deckt auch normale Cheers ab – die kommen schon über channel.cheer. Hier nur Power-Ups.
      if (e.type !== 'power_up') return null;
      const labels: Record<string, string> = {
        message_effect: 'Nachrichteneffekt', celebration: 'Bildschirm-Feier', gigantify_an_emote: 'Emote vergrößern',
      };
      const p = e.power_up ?? {};
      return {
        ...base, type: 'power_up', user: user(e.user_id, e.user_name, e.user_login),
        product: labels[p.type] ?? p.type ?? 'Power-Up', count: e.bits, amount: { value: e.bits, currency: 'BITS' },
        message: e.message?.text || undefined,
        emotes: fragmentEmotes(e.message?.fragments),
      };
    }

    case 'channel.charity_campaign.donate': {
      const a = e.amount ?? {};
      return {
        ...base, type: 'charity', user: user(e.user_id, e.user_name, e.user_login),
        amount: { value: Number(a.value ?? 0) / 10 ** Number(a.decimal_places ?? 0), currency: a.currency ?? 'USD' },
        product: e.charity_name,
      };
    }

    case 'stream.online':
      return { ...base, type: 'stream_status', subtype: 'online', user: user(e.broadcaster_user_id, e.broadcaster_user_name) };

    case 'stream.offline':
      return { ...base, type: 'stream_status', subtype: 'offline', user: user(e.broadcaster_user_id, e.broadcaster_user_name) };

    default:
      return null;
  }
}

/** Emote-Positionen aus Twitch-„fragments“ (Text + Emote-Stücke) berechnen. */
export function fragmentEmotes(fragments: Array<{ type: string; text: string; emote?: { id: string } }> | undefined) {
  if (!fragments?.length) return undefined;
  const out: Array<{ id: string; begin: number; end: number }> = [];
  let pos = 0;
  for (const f of fragments) {
    const len = Array.from(f.text ?? '').length;
    if (f.type === 'emote' && f.emote?.id && len) out.push({ id: f.emote.id, begin: pos, end: pos + len - 1 });
    pos += len;
  }
  return out.length ? out : undefined;
}

/** Subscriptions, die der Connector anlegt, mit Version und benötigtem Scope. */
export function twitchSubscriptions(broadcasterId: string) {
  const b = { broadcaster_user_id: broadcasterId };
  return [
    { type: 'channel.follow', version: '2', condition: { ...b, moderator_user_id: broadcasterId } },
    { type: 'channel.subscribe', version: '1', condition: b },
    { type: 'channel.subscription.message', version: '1', condition: b },
    { type: 'channel.subscription.gift', version: '1', condition: b },
    { type: 'channel.cheer', version: '1', condition: b },
    { type: 'channel.raid', version: '1', condition: { to_broadcaster_user_id: broadcasterId } },
    { type: 'channel.channel_points_custom_reward_redemption.add', version: '1', condition: b },
    { type: 'channel.bits.use', version: '1', condition: b },
    { type: 'channel.charity_campaign.donate', version: '1', condition: b },
    { type: 'stream.online', version: '1', condition: b },
    { type: 'stream.offline', version: '1', condition: b },
  ];
}

export const TWITCH_SCOPES = [
  'moderator:read:followers',
  'channel:read:subscriptions',
  'bits:read',
  'channel:read:redemptions',
  'channel:read:charity',
];
