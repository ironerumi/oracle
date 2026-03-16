import { describe, expect, test } from 'vitest';
import { isCloudflareCookie } from '../../src/perplexity-browser/constants.js';
import { validateAndFilterCookies } from '../../src/perplexity-browser/cookieFilter.js';
import { BrowserAutomationError } from '../../src/oracle/errors.js';

// ---------------------------------------------------------------------------
// isCloudflareCookie
// ---------------------------------------------------------------------------
describe('isCloudflareCookie', () => {
  test.each([
    ['cf_clearance', true],
    ['__cf_bm', true],
    ['__cflb', true],
    ['_cfuvid', true],
    ['CF_AppSession', true],
    ['cf_anything', true],
    ['__Secure-next-auth.session-token', false],
    ['session_id', false],
    ['', false],
  ])('isCloudflareCookie(%s) => %s', (name, expected) => {
    expect(isCloudflareCookie(name)).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// validateAndFilterCookies
// ---------------------------------------------------------------------------
describe('validateAndFilterCookies', () => {
  const AUTH_NAME = '__Secure-next-auth.session-token';
  const futureExpires = Math.floor(Date.now() / 1000) + 86400; // +1 day
  const pastExpires = Math.floor(Date.now() / 1000) - 86400;   // -1 day

  const makeAuth = (overrides: Record<string, unknown> = {}) => ({
    name: AUTH_NAME,
    value: 'tok',
    domain: '.perplexity.ai',
    path: '/',
    expires: futureExpires,
    ...overrides,
  });

  test('throws when auth token is missing', () => {
    expect(() => validateAndFilterCookies([
      { name: 'other', value: 'x', domain: '.perplexity.ai' },
    ])).toThrow(BrowserAutomationError);
  });

  test('error message mentions cookie name when auth missing', () => {
    try {
      validateAndFilterCookies([{ name: 'other', value: 'x' }]);
    } catch (e: any) {
      expect(e.message).toContain(AUTH_NAME);
      expect(e.details?.stage).toBe('cookie-validation');
    }
  });

  test('throws when auth token is expired', () => {
    expect(() => validateAndFilterCookies([
      makeAuth({ expires: pastExpires }),
    ])).toThrow(BrowserAutomationError);
  });

  test('accepts auth token with expires=0 (session cookie)', () => {
    const { authCookies } = validateAndFilterCookies([makeAuth({ expires: 0 })]);
    expect(authCookies).toHaveLength(1);
  });

  test('accepts auth token with expires=-1 (session cookie)', () => {
    const { authCookies } = validateAndFilterCookies([makeAuth({ expires: -1 })]);
    expect(authCookies).toHaveLength(1);
  });

  test('strips Cloudflare cookies', () => {
    const { authCookies, droppedCount } = validateAndFilterCookies([
      makeAuth(),
      { name: 'cf_clearance', value: 'abc', domain: '.perplexity.ai', expires: futureExpires },
      { name: '__cf_bm', value: 'def', domain: '.perplexity.ai', expires: futureExpires },
    ]);
    expect(authCookies).toHaveLength(1);
    expect(authCookies[0].name).toBe(AUTH_NAME);
    expect(droppedCount).toBe(2);
  });

  test('strips expired non-auth cookies', () => {
    const { authCookies, droppedCount } = validateAndFilterCookies([
      makeAuth(),
      { name: 'tracking', value: 'old', domain: '.perplexity.ai', expires: pastExpires },
    ]);
    expect(authCookies).toHaveLength(1);
    expect(droppedCount).toBe(1);
  });

  test('preserves session cookies (expires <= 0)', () => {
    const { authCookies, droppedCount } = validateAndFilterCookies([
      makeAuth(),
      { name: 'session_id', value: 'abc', domain: '.perplexity.ai', expires: 0 },
      { name: 'csrf', value: 'xyz', domain: '.perplexity.ai', expires: -1 },
    ]);
    expect(authCookies).toHaveLength(3);
    expect(droppedCount).toBe(0);
  });

  test('duplicate auth tokens: expired first, valid second — keeps valid', () => {
    const { authCookies, droppedCount } = validateAndFilterCookies([
      makeAuth({ expires: pastExpires, value: 'stale' }),
      makeAuth({ expires: futureExpires, value: 'fresh' }),
    ]);
    expect(authCookies).toHaveLength(1);
    expect(authCookies[0].value).toBe('fresh');
    expect(droppedCount).toBe(1);
  });

  test('all auth tokens expired — throws expired error', () => {
    expect(() => validateAndFilterCookies([
      makeAuth({ expires: pastExpires }),
      makeAuth({ expires: pastExpires - 100 }),
    ])).toThrow('expired');
  });

  test('combined: strips CF + expired, keeps valid + session', () => {
    const { authCookies, droppedCount } = validateAndFilterCookies([
      makeAuth(),
      { name: 'cf_clearance', value: 'x', domain: '.perplexity.ai', expires: futureExpires },
      { name: 'expired_one', value: 'y', domain: '.perplexity.ai', expires: pastExpires },
      { name: 'good_session', value: 'z', domain: '.perplexity.ai', expires: 0 },
      { name: 'good_future', value: 'w', domain: '.perplexity.ai', expires: futureExpires },
    ]);
    expect(authCookies).toHaveLength(3); // auth + good_session + good_future
    expect(droppedCount).toBe(2);        // cf_clearance + expired_one
  });
});
