import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { config } from '../src/config.js';
import { isMyInstantsSound, looksLikeMp3 } from '../src/routes/media.js';

describe('MyInstants', () => {
  it('lässt nur MP3s von myinstants.com zu', () => {
    expect(isMyInstantsSound('https://www.myinstants.com/media/sounds/faaah.mp3')).toBe(true);
    expect(isMyInstantsSound('https://myinstants.com/media/sounds/x.mp3')).toBe(true);
    expect(isMyInstantsSound('http://www.myinstants.com/media/sounds/x.mp3')).toBe(false);
    expect(isMyInstantsSound('https://evil.example/media/sounds/x.mp3')).toBe(false);
    expect(isMyInstantsSound('https://www.myinstants.com.evil.example/media/sounds/x.mp3')).toBe(false);
    expect(isMyInstantsSound('https://www.myinstants.com/admin/secret')).toBe(false);
    expect(looksLikeMp3(Buffer.from('ID3\x04\x00\x00', 'binary'))).toBe(true);
    expect(looksLikeMp3(Buffer.from([0xff, 0xfb, 0x90, 0x00, 0x00]))).toBe(true);
    expect(looksLikeMp3(Buffer.from('<html>nope</html>'))).toBe(false);
  });

  describe('Suche und Übernahme', () => {
    let app: FastifyInstance;
    const realFetch = globalThis.fetch;
    beforeAll(async () => {
      config.adminPassword = '';
      config.mediaDir = fs.mkdtempSync(path.join(process.env.TMPDIR ?? '/tmp', 'ffo-media-'));
      ({ app } = await buildApp({ dbFile: ':memory:', logger: false }));
      globalThis.fetch = vi.fn(async (url: string | URL | Request) => {
        const u = String(url);
        if (u.startsWith('https://www.myinstants.com/api/v1/instants/')) {
          return new Response(JSON.stringify({
            count: 35, next: 'https://www.myinstants.com/api/v1/instants/?name=faaah&page=2', previous: null,
            results: [
              { name: 'FAAAH', slug: 'faaah-63455', sound: 'https://www.myinstants.com/media/sounds/faaah.mp3', color: '000000', image: null, description: 'Faaaah', tags: 'Funny MEME' },
              { name: 'böse', slug: 'x-1', sound: 'https://evil.example/x.mp3', color: 'zzz', image: null, description: '', tags: '' },
            ],
          }), { status: 200, headers: { 'content-type': 'application/json' } });
        }
        if (u === 'https://www.myinstants.com/media/sounds/faaah.mp3') return new Response(Buffer.from('ID3\x04\x00\x00\x00\x00audio', 'binary'), { status: 200, headers: { 'content-type': 'audio/mpeg' } });
        return new Response('nope', { status: 404 });
      }) as typeof fetch;
    });
    afterAll(async () => {
      globalThis.fetch = realFetch;
      await app.close();
      config.adminPassword = 'pw';
    });

    it('sucht, filtert fremde Adressen und übernimmt den Sound lokal', async () => {
      const r = (await app.inject({ method: 'GET', url: '/api/myinstants/search?q=faaah' })).json();
      expect(r).toMatchObject({ count: 35, hasMore: true, items: [{ slug: 'faaah-63455', color: '#000000', name: 'FAAAH' }] });
      expect(r.items).toHaveLength(1);
      const m = (await app.inject({ method: 'POST', url: '/api/media/myinstants', payload: { slug: 'faaah-63455', name: 'FAAAH', sound: r.items[0].sound } })).json();
      expect(m).toMatchObject({ kind: 'audio', source: 'myinstants', url: '/media/mi_faaah-63455.mp3' });
      expect(fs.existsSync(path.join(config.mediaDir, 'mi_faaah-63455.mp3'))).toBe(true);
      // zweites Mal: kein Duplikat
      const again = (await app.inject({ method: 'POST', url: '/api/media/myinstants', payload: { slug: 'faaah-63455', name: 'FAAAH', sound: r.items[0].sound } })).json();
      expect(again.id).toBe(m.id);
      expect((await app.inject({ method: 'POST', url: '/api/media/myinstants', payload: { slug: 'x-1', name: 'x', sound: 'https://evil.example/x.mp3' } })).statusCode).toBe(400);
    });
  });
});
