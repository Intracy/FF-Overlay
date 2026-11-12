import type { NormalizedEvent } from '../../shared/types.js';

/*
 * YouTube-Live-Chat-Nachrichten (liveChatMessages.list) → einheitliche Events.
 * Relevante snippet.type-Werte: superChatEvent, superStickerEvent, newSponsorEvent,
 * memberMilestoneChatEvent, membershipGiftingEvent, giftMembershipReceivedEvent.
 * Normale Chatnachrichten (textMessageEvent) erzeugen keine Alerts.
 */

export interface YtChatMessage {
  id: string;
  snippet: {
    type: string;
    publishedAt?: string;
    displayMessage?: string;
    superChatDetails?: { amountMicros: string; currency: string; amountDisplayString?: string; userComment?: string; tier?: number };
    superStickerDetails?: { amountMicros: string; currency: string; amountDisplayString?: string; tier?: number; superStickerMetadata?: { stickerId?: string; altText?: string } };
    newSponsorDetails?: { memberLevelName?: string; isUpgrade?: boolean };
    memberMilestoneChatDetails?: { memberLevelName?: string; memberMonth?: number; userComment?: string };
    membershipGiftingDetails?: { giftMembershipsCount?: number; giftMembershipsLevelName?: string };
    giftMembershipReceivedDetails?: { memberLevelName?: string; gifterChannelId?: string };
  };
  authorDetails?: { channelId: string; displayName: string; profileImageUrl?: string };
}

const money = (micros: string, currency: string) => ({ value: Math.round(Number(micros) / 10_000) / 100, currency: currency || 'EUR' });

export function normalizeYouTube(m: YtChatMessage): NormalizedEvent | null {
  const s = m.snippet;
  const a = m.authorDetails;
  const base = {
    id: `yt_${m.id}`,
    platform: 'youtube' as const,
    user: { id: a?.channelId, name: a?.displayName ?? 'YouTube', avatar: a?.profileImageUrl },
    receivedAt: new Date().toISOString(),
    raw: m,
  };
  switch (s.type) {
    case 'superChatEvent': {
      const d = s.superChatDetails!;
      return { ...base, type: 'superchat', subtype: 'chat', amount: money(d.amountMicros, d.currency), message: d.userComment?.trim() || undefined, tier: d.tier != null ? String(d.tier) : undefined };
    }
    case 'superStickerEvent': {
      const d = s.superStickerDetails!;
      return { ...base, type: 'superchat', subtype: 'sticker', amount: money(d.amountMicros, d.currency), product: d.superStickerMetadata?.altText, tier: d.tier != null ? String(d.tier) : undefined };
    }
    case 'newSponsorEvent': {
      const d = s.newSponsorDetails ?? {};
      return { ...base, type: 'membership', subtype: 'new', tier: d.memberLevelName, product: d.memberLevelName, message: d.isUpgrade ? 'Upgrade' : undefined };
    }
    case 'memberMilestoneChatEvent': {
      const d = s.memberMilestoneChatDetails ?? {};
      return { ...base, type: 'membership', subtype: 'milestone', months: d.memberMonth, tier: d.memberLevelName, message: d.userComment?.trim() || undefined };
    }
    case 'membershipGiftingEvent': {
      const d = s.membershipGiftingDetails ?? {};
      return { ...base, type: 'membership', subtype: 'gift', count: d.giftMembershipsCount ?? 1, tier: d.giftMembershipsLevelName, gifter: a?.displayName };
    }
    case 'giftMembershipReceivedEvent': {
      const d = s.giftMembershipReceivedDetails ?? {};
      return { ...base, type: 'membership', subtype: 'gift_recipient', tier: d.memberLevelName };
    }
    default:
      return null;
  }
}

export interface YtSubscriber {
  subscriberSnippet: { channelId: string; title: string; thumbnails?: { default?: { url: string } } };
}

export function normalizeSubscriber(s: YtSubscriber): NormalizedEvent {
  return {
    id: `ytsub_${s.subscriberSnippet.channelId}`,
    platform: 'youtube',
    type: 'subscriber',
    user: { id: s.subscriberSnippet.channelId, name: s.subscriberSnippet.title, avatar: s.subscriberSnippet.thumbnails?.default?.url },
    receivedAt: new Date().toISOString(),
    raw: s,
  };
}
