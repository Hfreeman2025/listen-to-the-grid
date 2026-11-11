import { z } from 'zod';

/**
 * hosting.config.json: where the piece is hosted, the one Cloudflare login a
 * deploy accepts, and whether search engines may index it. Validated, so a
 * typo fails the build rather than shipping the wrong origin or indexing.
 */
const hostingConfig = z.object({
  $comment: z.string().optional(),
  origin: z.string().regex(/^https:\/\/[a-z0-9.-]+$/, 'must be an https:// origin with no path or trailing slash'),
  project: z.string().regex(/^[a-z0-9][a-z0-9-]{0,57}$/, 'must be a Cloudflare Pages project name'),
  branch: z.literal('main'),
  account: z.email(),
  SITE_INDEXABLE: z.boolean(),
});

export type HostingConfig = z.infer<typeof hostingConfig>;

export function parseHostingConfig(input: unknown): HostingConfig {
  const result = hostingConfig.safeParse(input);
  if (!result.success) {
    const issue = result.error.issues[0];
    const at = issue?.path.join('.') || '(root)';
    throw new Error(`hosting.config.json is invalid at ${at}: ${issue?.message ?? 'unknown problem'}`);
  }
  return result.data;
}
