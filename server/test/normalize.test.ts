import { describe, expect, it } from 'vitest';
import { normalizeTwitch } from '../src/connectors/twitch/normalize.js';
import { normalizeOpinion, parseFundraisingEventId } from '../src/connectors/betterplace.js';
import { normalizeWebhook, webhookBody } from '../src/connectors/webhook.js';
import { renderFormat, segmentsToText } from '../src/templates/render.js';
import { applyFilters } from '../src/events/pipeline.js';
import { DEFAULT_SETTINGS } from '../src/db.js';

describe('Twitch-Normalisierung', () => {
  it('Resub mit Monaten, Streak und Nachricht', () => {
    const e = normalizeTwitch('channel.subscription.message', {
      user_id: '1', user_login: 'max', user_name: 'Max', tier: '1000',
      message: { text: 'Hallo!' }, cumulative_months: 14, streak_months: 6, duration_months: 1,
    }, 'm1')!;
    expect(e).toMatchObject({ type: 'subscription', subtype: 'resub', months: 14, streakMonths: 6, message: 'Hallo!', tier: '1000' });
    expect(e.id).toBe('tw_m1');
  });

  it('Gift-Empfänger wird als gift_recipient markiert', () => {
    const e = normalizeTwitch('channel.subscribe', { user_name: 'Lea', tier: '1000', is_gift: true }, 'm2')!;
    expect(e.subtype).toBe('gift_recipient');
  });

  it('anonymes Community-Gift', () => {
    const e = normalizeTwitch('channel.subscription.gift', { is_anonymous: true, total: 20, tier: '2000' }, 'm3')!;
    expect(e).toMatchObject({ subtype: 'gift', count: 20, user: { name: 'Anonym' }, isAnonymous: true });
  });

  it('Raid und Kanalpunkte', () => {
    expect(normalizeTwitch('channel.raid', { from_broadcaster_user_name: 'Huebi', viewers: 120 }, 'm4')).toMatchObject({ type: 'raid', count: 120, user: { name: 'Huebi' } });
    expect(normalizeTwitch('channel.channel_points_custom_reward_redemption.add', { user_name: 'A', user_input: '', reward: { title: 'Hydrate', cost: 500 } }, 'm5'))
      .toMatchObject({ type: 'redemption', product: 'Hydrate', count: 500 });
  });

  it('unbekannte Typen liefern null', () => {
    expect(normalizeTwitch('channel.ban', {}, 'm6')).toBeNull();
  });
});

describe('betterplace', () => {
  it('rechnet Cent in Euro um und behandelt anonyme Spenden', () => {
    const e = normalizeOpinion({ id: 7, donated_amount_in_cents: 2550, author: null, message: ' Toll ', confirmed_at: '' }, '123');
    expect(e).toMatchObject({ id: 'bp_123_7', amount: { value: 25.5, currency: 'EUR' }, user: { name: 'Anonym' }, message: 'Toll' });
  });

  it('versteckter Betrag bleibt leer', () => {
    expect(normalizeOpinion({ id: 8, donated_amount_in_cents: null, author: { name: 'Till B.' }, message: null, confirmed_at: '' }, '1').amount).toBeUndefined();
  });

  it('liest die ID aus Link oder Zahl', () => {
    expect(parseFundraisingEventId('https://www.betterplace.org/de/fundraising-events/45678-frankenfinals')).toBe('45678');
    expect(parseFundraisingEventId(' 19267 ')).toBe('19267');
    expect(parseFundraisingEventId('abc')).toBeNull();
  });
});

describe('Webhook', () => {
  it('validiert und normalisiert', () => {
    const e = normalizeWebhook(webhookBody.parse({ type: 'donation', user: 'Ko-fi Fan', amount: '5', message: 'Kaffee!' }), 'c1');
    expect(e).toMatchObject({ platform: 'webhook', type: 'donation', amount: { value: 5, currency: 'EUR' } });
  });
});

describe('Vorlagen', () => {
  const ev = { id: 'x', platform: 'twitch' as const, type: 'donation' as const, user: { name: 'Max' }, amount: { value: 12.5, currency: 'EUR' }, receivedAt: '' };

  it('ersetzt Platzhalter und markiert Hervorhebungen', () => {
    const seg = renderFormat('{user} hat {amount} gespendet!', ev);
    expect(segmentsToText(seg).replace(/\u00a0/g, ' ')).toBe('Max hat 12,50 € gespendet!');
    expect(seg.filter((s) => s.highlight).map((s) => s.text.replace(/\u00a0/g, ' '))).toEqual(['Max', '12,50 €']);
  });

  it('versteht {name} wie Streamlabs und lässt Unbekanntes stehen', () => {
    expect(segmentsToText(renderFormat('{name} {foo}', ev))).toBe('Max {foo}');
  });
});

describe('Filter', () => {
  const ev = { id: 'x', platform: 'twitch' as const, type: 'donation' as const, user: { name: 'Max' }, amount: { value: 3, currency: 'EUR' }, message: 'du doofkopf', receivedAt: '' };

  it('Mindestbetrag und Sperrliste', () => {
    expect(applyFilters(ev, { ...DEFAULT_SETTINGS, minDonationAmount: 5 }).filtered).toBeTruthy();
    expect(applyFilters(ev, { ...DEFAULT_SETTINGS, blockedUsers: ['MAX'] }).filtered).toBeTruthy();
  });

  it('zensiert oder versteckt Schimpfwörter', () => {
    expect(applyFilters(ev, { ...DEFAULT_SETTINGS, badWords: ['doofkopf'] }).event.message).toBe('du ********');
    expect(applyFilters(ev, { ...DEFAULT_SETTINGS, badWords: ['doofkopf'], badWordMode: 'hide' }).event.message).toBeUndefined();
  });
});
