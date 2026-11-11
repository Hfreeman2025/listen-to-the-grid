import { z } from 'zod';

/**
 * What the deploy script reads from wrangler, validated: who it is logged
 * in as (an allowlist of exactly one email), the Pages projects that exist,
 * and where a deployment landed.
 */

const whoami = z.object({
  loggedIn: z.literal(true),
  email: z.email(),
  accounts: z.array(z.looseObject({ id: z.string().regex(/^[0-9a-f]{32}$/), name: z.string() })),
});

export interface Account {
  readonly email: string;
  readonly id: string;
  readonly name: string;
}

/**
 * The account to deploy to, from `wrangler whoami --json`, only when its
 * email is exactly the allowed one and it has exactly one account. Anything
 * else, including output that is not what it expects, is a refusal.
 */
export function allowedAccount(whoamiJson: string, allowedEmail: string): Account {
  let parsed: unknown;
  try {
    parsed = JSON.parse(whoamiJson);
  } catch {
    throw new Error('wrangler whoami did not answer in JSON: is wrangler logged in? (npm exec --prefix tools/deploy wrangler login)');
  }
  const result = whoami.safeParse(parsed);
  if (!result.success) throw new Error('wrangler is not logged in with a user email (an API token, or no login): refusing');
  const { email, accounts } = result.data;
  if (email !== allowedEmail) throw new Error(`wrangler is logged in as ${email}, not ${allowedEmail}: refusing`);
  const [account, ...others] = accounts;
  if (!account || others.length > 0) throw new Error(`${email} has ${accounts.length} Cloudflare accounts; expected exactly one: refusing`);
  return { email, id: account.id, name: account.name };
}

const projects = z.array(z.looseObject({ 'Project Name': z.string() }));

/** Project names from `wrangler pages project list --json`. */
export function projectNames(listJson: string): string[] {
  return projects.parse(JSON.parse(listJson)).map((p) => p['Project Name']);
}

/** The deployment's own URL, from what `wrangler pages deploy` prints. */
export function deploymentUrl(output: string): string | null {
  return /Take a peek over at (https:\/\/\S+)/.exec(output)?.[1]?.replace(/[.,]$/, '') ?? null;
}
