import bcrypt from 'bcryptjs';

/** Custo do bcrypt (hash adaptativo, RNF-07). */
export const PASSWORD_HASH_COST = 10;

export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, PASSWORD_HASH_COST);
}

export function verifyPassword(password: string, passwordHash: string): Promise<boolean> {
  return bcrypt.compare(password, passwordHash);
}
