import { badRequest } from './errors.js';

export function asObject(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw badRequest('Expected a JSON object body');
  return body as Record<string, unknown>;
}

export function requireString(body: Record<string, unknown>, field: string, max = 500): string {
  const value = body[field];
  if (typeof value !== 'string' || value.trim() === '') throw badRequest(`"${field}" is required`);
  if (value.length > max) throw badRequest(`"${field}" must be at most ${max} characters`);
  return value.trim();
}

export function optionalString(
  body: Record<string, unknown>,
  field: string,
  max = 5000,
): string | undefined {
  const value = body[field];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') throw badRequest(`"${field}" must be a string`);
  if (value.length > max) throw badRequest(`"${field}" must be at most ${max} characters`);
  return value.trim();
}

export function optionalEnum<T extends string>(
  body: Record<string, unknown>,
  field: string,
  allowed: readonly T[],
): T | undefined {
  const value = body[field];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    throw badRequest(`"${field}" must be one of: ${allowed.join(', ')}`);
  }
  return value as T;
}

export function requireEnum<T extends string>(
  body: Record<string, unknown>,
  field: string,
  allowed: readonly T[],
): T {
  const value = optionalEnum(body, field, allowed);
  if (value === undefined) throw badRequest(`"${field}" must be one of: ${allowed.join(', ')}`);
  return value;
}

export function optionalInt(
  body: Record<string, unknown>,
  field: string,
  min: number,
  max: number,
): number | null | undefined {
  const value = body[field];
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  const num = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(num) || !Number.isInteger(num)) throw badRequest(`"${field}" must be an integer`);
  if (num < min || num > max) throw badRequest(`"${field}" must be between ${min} and ${max}`);
  return num;
}

export function optionalTags(body: Record<string, unknown>, field: string): string[] | undefined {
  const value = body[field];
  if (value === undefined || value === null) return undefined;
  const raw = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(',')
      : (() => {
          throw badRequest(`"${field}" must be an array of strings`);
        })();
  const tags = raw
    .map((tag) => String(tag).trim().toLowerCase())
    .filter((tag) => tag.length > 0 && tag.length <= 40);
  return [...new Set(tags)].slice(0, 50);
}

export function optionalIdentifiers(
  body: Record<string, unknown>,
  field: string,
): Record<string, string> | undefined {
  const value = body[field];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'object' || Array.isArray(value)) throw badRequest(`"${field}" must be an object`);
  const out: Record<string, string> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (raw === undefined || raw === null || raw === '') continue;
    out[key.slice(0, 40)] = String(raw).slice(0, 200);
  }
  return out;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export function requireEmail(body: Record<string, unknown>, field = 'email'): string {
  const value = requireString(body, field, 320).toLowerCase();
  if (!EMAIL_RE.test(value)) throw badRequest('Enter a valid email address');
  return value;
}

const HANDLE_RE = /^[a-z0-9_]{3,30}$/;
export function normalizeHandle(raw: string): string {
  const handle = raw.trim().toLowerCase().replace(/^@/, '');
  if (!HANDLE_RE.test(handle)) {
    throw badRequest('Handle must be 3-30 characters: lowercase letters, numbers or underscore');
  }
  return handle;
}
