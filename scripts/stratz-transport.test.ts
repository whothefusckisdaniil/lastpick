import { describe, expect, it } from 'vitest';
import { STRATZ_USER_AGENT, StratzTransport } from './update-data-stratz.mjs';

type Call = { url: string; init: { headers: Record<string, string>; body: string } };
const reply = (status: number, body: unknown) => ({ status, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) });

function transport(responses: Array<ReturnType<typeof reply> | Error>) {
  const calls: Call[] = [];
  const sleeps: number[] = [];
  const t = new StratzTransport('secret-token', {
    fetchImpl: async (url: string, init: Call['init']) => {
      calls.push({ url, init });
      const next = responses.shift();
      if (next instanceof Error) throw next;
      return next;
    },
    sleep: async (ms: number) => { sleeps.push(ms); },
  });
  return { t, calls, sleeps };
}

describe('StratzTransport (plain HTTPS, no browser)', () => {
  it('identifies itself as STRATZ_API with the bearer token — no browser, no spoofed UA', async () => {
    const { t, calls } = transport([reply(200, { data: { ok: 1 } })]);
    await t.init();
    expect(await t.query('{ ok }')).toEqual({ data: { ok: 1 } });
    expect(calls[0].url).toBe('https://api.stratz.com/graphql');
    expect(calls[0].init.headers['User-Agent']).toBe(STRATZ_USER_AGENT);
    expect(calls[0].init.headers.Authorization).toBe('Bearer secret-token');
    expect(JSON.parse(calls[0].init.body)).toEqual({ query: '{ ok }' });
    await t.close();
  });

  it('retries rate limits and server errors with back-off, then succeeds', async () => {
    const { t, calls, sleeps } = transport([reply(429, 'slow down'), reply(502, 'bad gateway'), reply(200, { data: {} })]);
    await t.query('{ x }');
    expect(calls).toHaveLength(3);
    expect(sleeps).toEqual([15000, 6000]);
  });

  it('retries a network error', async () => {
    const { t, calls } = transport([new Error('ECONNRESET'), reply(200, { data: {} })]);
    await t.query('{ x }');
    expect(calls).toHaveLength(2);
  });

  it('gives up after the last attempt with a clear rate-limit error', async () => {
    const { t } = transport([reply(429, 'a'), reply(429, 'b'), reply(429, 'c'), reply(429, 'd')]);
    await expect(t.query('{ x }')).rejects.toThrow(/429 rate limited/);
  });

  it('does not retry or work around a Cloudflare challenge — it fails with an explanation', async () => {
    const { t, calls } = transport([reply(403, '<title>Just a moment...</title>')]);
    await expect(t.query('{ x }')).rejects.toThrow(/Cloudflare.*STRATZ_API/);
    expect(calls).toHaveLength(1);
  });

  it('reports a rejected token as such', async () => {
    const { t } = transport([reply(401, 'A bearer token is required')]);
    await expect(t.query('{ x }')).rejects.toThrow(/token rejected.*stratz\.com\/api/);
  });

  it('surfaces GraphQL errors', async () => {
    const { t } = transport([reply(200, { errors: [{ message: 'bad field' }] })]);
    await expect(t.query('{ x }')).rejects.toThrow(/bad field/);
  });

  it('refuses to run without a token', () => {
    expect(() => new StratzTransport('')).toThrow(/STRATZ_API_TOKEN/);
  });
});

describe('StratzTransport: STRATZ "database busy"', () => {
  const busyBody = { errors: [{ message: 'Statistics are temporarily unavailable - the analytics database did not free a slot within 5s. Please retry in a moment.', extensions: { code: 'SERVER_BUSY' } }] };

  it('waits and retries a SERVER_BUSY answer (HTTP 200 with GraphQL errors)', async () => {
    const calls: number[] = [];
    const sleeps: number[] = [];
    const answers = [busyBody, busyBody, { data: { ok: 1 } }];
    const t = new StratzTransport('tok', {
      fetchImpl: async () => { calls.push(1); return reply(200, answers.shift()); },
      sleep: async (ms: number) => { sleeps.push(ms); },
      log: () => {},
    });
    expect(await t.query('{ ok }')).toEqual({ data: { ok: 1 } });
    expect(calls).toHaveLength(3);
    expect(sleeps).toEqual([10_000, 20_000]);
  });

  it('gives up after the last pause, with the STRATZ message', async () => {
    const t = new StratzTransport('tok', {
      fetchImpl: async () => reply(200, busyBody),
      sleep: async () => {},
      busyPauses: [1, 1],
      log: () => {},
    });
    await expect(t.query('{ ok }')).rejects.toThrow(/SERVER_BUSY/);
  });

  it('does not retry other GraphQL errors', async () => {
    let n = 0;
    const t = new StratzTransport('tok', {
      fetchImpl: async () => { n += 1; return reply(200, { errors: [{ message: 'Cannot query field "x"' }] }); },
      sleep: async () => {},
      log: () => {},
    });
    await expect(t.query('{ x }')).rejects.toThrow(/Cannot query field/);
    expect(n).toBe(1);
  });
});
