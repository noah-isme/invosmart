import { vi } from "vitest";

class UserDelegate {
  findUnique = vi.fn();
  create = vi.fn();
  upsert = vi.fn();
}

export class PrismaClient {
  user = new UserDelegate();
}
