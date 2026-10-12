import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { config } from './config.js';
import { HttpError, parse } from './http.js';

export interface AuthOptions {
  adminPassword: string;
  adminApiToken: string;
  secret: string;
  sessionHours: number;
}

export function authOptionsFromConfig(): AuthOptions {
  return {
    adminPassword: config.adminPassword,
    adminApiToken: config.adminApiToken,
    secret: config.authSecret || randomBytes(32).toString('hex'),
    sessionHours: config.sessionHours,
  };
}

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/**
 * Admin access: everyone may read; writing layers and drawings needs `Authorization: Bearer <token>` with either
 * a session token from POST /auth/login (web app) or the static ADMIN_API_TOKEN (other applications).
 * Sessions are stateless "v1.<expiresMs>.<hmac>" strings; the HMAC key includes the password, so changing
 * ADMIN_PASSWORD ends every session.
 */
export class Auth {
  private readonly failures = new Map<string, { count: number; since: number }>();

  constructor(private readonly o: AuthOptions) {}

  get loginEnabled(): boolean {
    return this.o.adminPassword !== '';
  }

  private sign(payload: string): string {
    return createHmac('sha256', `${this.o.secret}\n${this.o.adminPassword}`).update(payload).digest('base64url');
  }

  issue(now = Date.now()): { token: string; expiresAt: string } {
    const expires = now + this.o.sessionHours * 3600_000;
    const payload = `v1.${expires}`;
    return { token: `${payload}.${this.sign(payload)}`, expiresAt: new Date(expires).toISOString() };
  }

  isAdmin(req: FastifyRequest, now = Date.now()): boolean {
    const header = req.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    if (!token) return false;
    if (this.o.adminApiToken && safeEqual(token, this.o.adminApiToken)) return true;
    if (!this.loginEnabled) return false;
    const m = /^(v1\.(\d+))\.([\w-]+)$/.exec(token);
    return !!m && Number(m[2]) > now && safeEqual(m[3]!, this.sign(m[1]!));
  }

  /** At most 10 wrong passwords per client IP in 5 minutes. */
  private checkRate(ip: string, now: number): void {
    const f = this.failures.get(ip);
    if (f && now - f.since > 5 * 60_000) this.failures.delete(ip);
    else if (f && f.count >= 10) throw new HttpError(429, 'Too many failed logins; try again in a few minutes');
  }

  private recordFailure(ip: string, now: number): void {
    const f = this.failures.get(ip);
    this.failures.set(ip, f ? { ...f, count: f.count + 1 } : { count: 1, since: now });
  }

  login(password: string, ip: string, now = Date.now()): { token: string; expiresAt: string } {
    if (!this.loginEnabled) throw new HttpError(403, 'Admin login is disabled (ADMIN_PASSWORD is not set)');
    this.checkRate(ip, now);
    if (!safeEqual(password, this.o.adminPassword)) {
      this.recordFailure(ip, now);
      throw new HttpError(401, 'Wrong password');
    }
    this.failures.delete(ip);
    return this.issue(now);
  }

  /** Route preHandler for write operations. */
  readonly requireAdmin = async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (!this.isAdmin(req)) {
      reply.header('WWW-Authenticate', 'Bearer');
      throw new HttpError(401, 'Admin login required');
    }
  };
}

export async function authRoutes(app: FastifyInstance, auth: Auth) {
  app.get('/auth/session', async (req) => ({ admin: auth.isAdmin(req), loginEnabled: auth.loginEnabled }));
  app.post('/auth/login', async (req) => {
    const { password } = parse(z.object({ password: z.string().max(200) }), req.body);
    return auth.login(password, req.ip);
  });
}
