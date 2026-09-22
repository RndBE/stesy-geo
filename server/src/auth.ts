// Autentikasi sesi & role (F-USR-01/02). Password di-hash dengan scrypt (node:crypto);
// PRD meminta Argon2 — diganti saat deployment produksi (lihat README).
import crypto from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import { getDb } from './db.js';

export type Role = 'admin' | 'engineer' | 'surveyor' | 'viewer';
export const ROLE_RANK: Record<Role, number> = { viewer: 0, surveyor: 1, engineer: 2, admin: 3 };

export interface User { id: number; email: string; name: string; role: Role }

export function hashPassword(pw: string): string {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(pw, salt, 32, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

export function verifyPassword(pw: string, stored: string): boolean {
  const [alg, saltHex, hashHex] = stored.split('$');
  if (alg !== 'scrypt') return false;
  const hash = crypto.scryptSync(pw, Buffer.from(saltHex, 'hex'), 32, { N: 16384, r: 8, p: 1 });
  return crypto.timingSafeEqual(hash, Buffer.from(hashHex, 'hex'));
}

export async function login(email: string, password: string): Promise<{ token: string; user: User } | null> {
  const db = await getDb();
  const u = await db.prepare('SELECT * FROM app_user WHERE email = ?').get(email.trim().toLowerCase()) as any;
  if (!u || !verifyPassword(password, u.password_hash)) return null;
  const token = crypto.randomBytes(32).toString('hex');
  await db.prepare('INSERT INTO session(token, user_id, expires_at) VALUES (?,?,?)').run(token, u.id, Date.now() + 7 * 86400e3);
  return { token, user: { id: u.id, email: u.email, name: u.name, role: u.role } };
}

export async function logout(token: string) {
  await (await getDb()).prepare('DELETE FROM session WHERE token = ?').run(token);
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request { user?: User }
  }
}

function tokenOf(req: Request): string | null {
  const h = req.headers.authorization;
  if (h?.startsWith('Bearer ')) return h.slice(7);
  if (typeof req.query.token === 'string') return req.query.token; // untuk EventSource & unduhan
  return null;
}

export async function authenticate(req: Request, _res: Response, next: NextFunction) {
  const t = tokenOf(req);
  if (t) {
    const u = await (await getDb()).prepare(
      `SELECT u.id, u.email, u.name, u.role FROM session s JOIN app_user u ON u.id = s.user_id WHERE s.token = ? AND s.expires_at > ?`,
    ).get(t, Date.now()) as User | undefined;
    if (u) req.user = u;
  }
  next();
}

export function requireRole(min: Role) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) return res.status(401).json({ error: 'Perlu masuk terlebih dahulu' });
    if (ROLE_RANK[req.user.role] < ROLE_RANK[min]) return res.status(403).json({ error: `Butuh role ${min} atau lebih tinggi` });
    next();
  };
}

/** Hak akses per proyek (F-USR-02). Admin melihat semua proyek. */
export async function canAccessProject(user: User, projectId: number): Promise<boolean> {
  if (user.role === 'admin') return true;
  return !!(await (await getDb()).prepare('SELECT 1 FROM project_member WHERE project_id = ? AND user_id = ?').get(projectId, user.id));
}
