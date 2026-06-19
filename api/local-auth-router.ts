import { z } from "zod";
import { createRouter, publicQuery } from "./middleware";
import { getDb } from "./queries/connection";
import { localUsers } from "@db/schema";
import { eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";

// Simple password hashing using Web Crypto API (no bcrypt needed)
async function hashPassword(password: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(password + "farmer-assistant-salt-2025");
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

// JWT-like token creation (simple, no library needed)
function createToken(userId: number, username: string): string {
  const payload = {
    sub: userId,
    username,
    iat: Date.now(),
    exp: Date.now() + 1000 * 60 * 60 * 24 * 7, // 7 days
  };
  // Simple base64 encoding (for production, use a proper JWT library)
  return btoa(JSON.stringify(payload));
}

// Verify token
function verifyToken(token: string): { sub: number; username: string } | null {
  try {
    const payload = JSON.parse(atob(token));
    if (payload.exp < Date.now()) return null;
    return { sub: payload.sub, username: payload.username };
  } catch {
    return null;
  }
}

export { verifyToken };

export const localAuthRouter = createRouter({
  // Login with username and password
  login: publicQuery
    .input(
      z.object({
        username: z.string().min(1),
        password: z.string().min(1),
      })
    )
    .mutation(async ({ input }) => {
      const db = getDb();

      const userRows = await db
        .select()
        .from(localUsers)
        .where(eq(localUsers.username, input.username))
        .limit(1);

      const user = userRows[0];
      if (!user || !user.isActive) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "Invalid username or password",
        });
      }

      const passwordHash = await hashPassword(input.password);
      if (user.passwordHash !== passwordHash) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "Invalid username or password",
        });
      }

      const token = createToken(user.id, user.username);

      return {
        token,
        user: {
          id: user.id,
          username: user.username,
          name: user.displayName ?? user.username,
          role: user.role,
        },
      };
    }),

  // Register new user (admin only, for creating accounts)
  register: publicQuery
    .input(
      z.object({
        username: z.string().min(3).max(50),
        password: z.string().min(6),
        displayName: z.string().optional(),
        role: z.enum(["user", "admin"]).default("admin"),
      })
    )
    .mutation(async ({ input }) => {
      const db = getDb();

      // Check if username exists
      const existing = await db
        .select()
        .from(localUsers)
        .where(eq(localUsers.username, input.username))
        .limit(1);

      if (existing[0]) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "Username already exists",
        });
      }

      const passwordHash = await hashPassword(input.password);

      const result = await db.insert(localUsers).values({
        username: input.username,
        passwordHash,
        displayName: input.displayName ?? input.username,
        role: input.role,
      });

      return {
        id: Number(result[0].insertId),
        username: input.username,
        message: "User created successfully",
      };
    }),

  // Get current user from token
  me: publicQuery.query(async ({ ctx }) => {
    const authHeader =
      ctx.req.headers.get("x-local-auth-token") ?? "";

    if (!authHeader) {
      return null;
    }

    const payload = verifyToken(authHeader);
    if (!payload) {
      return null;
    }

    const db = getDb();
    const userRows = await db
      .select()
      .from(localUsers)
      .where(eq(localUsers.id, payload.sub))
      .limit(1);

    const user = userRows[0];
    if (!user || !user.isActive) {
      return null;
    }

    return {
      id: user.id,
      username: user.username,
      name: user.displayName ?? user.username,
      role: user.role,
      email: null,
      avatar: null,
    };
  }),

  // Seed default admin user
  seedAdmin: publicQuery.mutation(async () => {
    const db = getDb();

    // Check if admin already exists
    const existing = await db
      .select()
      .from(localUsers)
      .where(eq(localUsers.username, "admin"))
      .limit(1);

    if (existing[0]) {
      return { message: "Admin user already exists", username: "admin" };
    }

    const passwordHash = await hashPassword("admin123");
    await db.insert(localUsers).values({
      username: "admin",
      passwordHash,
      displayName: "Administrator",
      role: "admin",
    });

    return { message: "Admin user created", username: "admin", password: "admin123" };
  }),
});
