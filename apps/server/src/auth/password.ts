import { hash, verify } from "@node-rs/argon2";

/**
 * Argon2id at the defaults recommended by the OWASP password storage cheat
 * sheet. Brigid has one account, so the cost of a login is irrelevant next to
 * the value of the manuscript behind it.
 */
const OPTIONS = {
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

export function hashPassword(password: string): Promise<string> {
  return hash(password, OPTIONS);
}

export async function verifyPassword(stored: string, password: string): Promise<boolean> {
  try {
    return await verify(stored, password);
  } catch {
    // A malformed hash is a failed login, not a 500.
    return false;
  }
}

/** Minimum viable policy. The threat model is one person on their own server. */
export function assertPasswordAcceptable(password: string): string | null {
  if (password.length < 10) return "password must be at least 10 characters";
  if (password.length > 1024) return "password must be at most 1024 characters";
  return null;
}
