import type { UserRole } from "./prisma-exports";

declare global {
  namespace Express {
    interface Request {
      auth?: {
        id: string;
        role: UserRole;
        email: string;
        name: string;
      };
    }
  }
}

export {};
