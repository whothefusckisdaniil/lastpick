import { beforeEach, describe, expect, it } from 'vitest';
import { analyticsUrl, beforeSend, resetAnalyticsState } from './index';

const pv = (url: string) => beforeSend({ type: 'pageview', url });

describe('analytics beforeSend', () => {
  beforeEach(() => resetAnalyticsState());

  it('drops the draft query and sends one view per page per visit', () => {
    expect(pv('https://x.app/?lang=ru')).toEqual({ type: 'pageview', url: 'https://x.app/' });
    expect(pv('https://x.app/?enemy=1,2&pos=3')).toBeNull();
    expect(pv('https://x.app/?enemy=1,2,3&rank=divine')).toBeNull();
  });

  it('marks a visit that opened a shared draft link', () => {
    expect(pv('https://x.app/?enemy=13,29&lang=ru')).toEqual({ type: 'pageview', url: 'https://x.app/?via=draft-link' });
    expect(pv('https://x.app/?enemy=13,29,8')).toBeNull();
  });
});

describe('player profile privacy', () => {
  it('a Dota ID in the address never reaches the analytics', () => {
    expect(analyticsUrl('https://lastpick.app/?player=123456789&profile', true)).toBe('https://lastpick.app/');
    expect(analyticsUrl('https://lastpick.app/?profile&pool=on', false)).toBe('https://lastpick.app/');
  });
});
