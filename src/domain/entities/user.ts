export const roles = ['AUCTIONEER', 'BIDDER'] as const;

export type Role = (typeof roles)[number];

export interface User {
  id: string;
  name: string;
  email: string;
  passwordHash: string;
  role: Role;
  createdAt: Date;
}

/** Visão pública do usuário: nunca inclui o hash da senha. */
export interface PublicUser {
  id: string;
  name: string;
  email: string;
  role: Role;
}

export function toPublicUser(user: User): PublicUser {
  return { id: user.id, name: user.name, email: user.email, role: user.role };
}
