/** Server environment (Vercel → Settings → Environment Variables). */
declare const process: { env: Record<string, string | undefined> };

export const env = {
  /** Signs session cookies. 32+ random characters; required for sign-in. */
  sessionSecret: () => process.env.SESSION_SECRET ?? '',
  /** The site's public address: Steam returns here. */
  siteUrl: () => (process.env.SITE_URL || 'https://lastpick-pro.vercel.app').replace(/\/$/, ''),
  /** Upstash Redis REST (added by the Vercel Marketplace integration under either name). */
  redisUrl: () => process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || '',
  redisToken: () => process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || '',
};
