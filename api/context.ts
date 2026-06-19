import type { FetchCreateContextFnOptions } from "@trpc/server/adapters/fetch";
import type { User } from "@db/schema";
import { authenticateRequest } from "./kimi/auth";
import { verifyToken } from "./local-auth-router";
import { getDb } from "./queries/connection";
import { localUsers } from "@db/schema";
import { eq } from "drizzle-orm";

export type TrpcContext = {
  req: Request;
  resHeaders: Headers;
  user?: User;
};

export async function createContext(
  opts: FetchCreateContextFnOptions,
): Promise<TrpcContext> {
  const ctx: TrpcContext = { req: opts.req, resHeaders: opts.resHeaders };

  // Try local auth first (username/password)
  try {
    const localToken = opts.req.headers.get("x-local-auth-token");
    if (localToken) {
      const payload = verifyToken(localToken);
      if (payload) {
        const db = getDb();
        const rows = await db.select().from(localUsers).where(eq(localUsers.id, payload.sub)).limit(1);
        const localUser = rows[0];
        if (localUser && localUser.isActive) {
          // Map local user to User type for compatibility
          ctx.user = {
            id: localUser.id,
            unionId: `local_${localUser.id}`,
            name: localUser.displayName ?? localUser.username,
            email: null,
            avatar: null,
            role: localUser.role,
            createdAt: localUser.createdAt,
            updatedAt: localUser.updatedAt,
            lastSignInAt: localUser.createdAt,
          };
          return ctx; // Return early if local auth succeeds
        }
      }
    }
  } catch {
    // Local auth failed, try OAuth
  }

  // Fall back to Kimi OAuth
  try {
    ctx.user = await authenticateRequest(opts.req.headers);
  } catch {
    // Authentication is optional
  }

  return ctx;
}
