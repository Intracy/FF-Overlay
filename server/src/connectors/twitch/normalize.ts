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

    case 'stream.online':
      return { ...base, type: 'stream_status', subtype: 'online', user: user(e.broadcaster_user_id, e.broadcaster_user_name) };

    case 'stream.offline':
      return { ...base, type: 'stream_status', subtype: 'offline', user: user(e.broadcaster_user_id, e.broadcaster_user_name) };

    default:
      return null;
  }
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
    { type: 'stream.online', version: '1', condition: b },
    { type: 'stream.offline', version: '1', condition: b },
  ];
}

export const TWITCH_SCOPES = [
  'moderator:read:followers',
  'channel:read:subscriptions',
  'bits:read',
  'channel:read:redemptions',
];
