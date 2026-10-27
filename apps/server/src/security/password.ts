import { hash, verify } from "@node-rs/argon2";

// OWASP minimum for argon2id: 19 MiB of memory, 2 iterations, 1 lane.
// The algorithm defaults to argon2id, and a test checks that.
// Every hash stores its own parameters, so raising these later still verifies old hashes.
const OPTIONS = { memoryCost: 19_456, timeCost: 2, parallelism: 1 };

export function hashPassword(password: string): Promise<string> {
  return hash(password, OPTIONS);
}

// Used when a login names an email that does not exist, so that case costs the
// same time as a wrong password and the response time does not reveal which emails exist.
let dummyHash: Promise<string> | undefined;
function getDummyHash(): Promise<string> {
  dummyHash ??= hashPassword("spitfin-timing-dummy");
  return dummyHash;
}

/**
 * Returns true only if the password matches the stored hash.
 * Pass null when the account does not exist: it still does the work, then returns false.
 * Never throws, so a corrupt stored hash counts as a failed login.
 */
export async function verifyPassword(
  storedHash: string | null,
  password: string,
): Promise<boolean> {
  try {
    if (storedHash === null) {
      await verify(await getDummyHash(), password);
      return false;
    }
    return await verify(storedHash, password);
  } catch {
    return false;
  }
}
