import type { Role, User } from '../entities/user.ts';

export interface CreateUserInput {
  name: string;
  email: string;
  passwordHash: string;
  role: Role;
}

export interface UsersRepository {
  findById(id: string): Promise<User | null>;
  findByEmail(email: string): Promise<User | null>;
  /** Cria o usuário. Lança EmailTakenError se o e-mail já existir. */
  create(data: CreateUserInput): Promise<User>;
}
