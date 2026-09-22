import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { config } from './config.js';

export class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
  ) {
    super(message);
  }
}

export function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new HttpError(400, z.prettifyError(result.error));
  return result.data;
}

/** Absolute base URL clients should use (PUBLIC_URL, else derived from the request / reverse proxy headers). */
export function publicBase(req: FastifyRequest): string {
  if (config.publicUrl) return config.publicUrl.replace(/\/$/, '');
  return `${req.protocol}://${req.host}`;
}

export const IdParams = z.object({ id: z.uuid() });

export const Bbox = z
  .string()
  .transform((s) => s.split(',').map(Number))
  .refine((a) => a.length === 4 && a.every(Number.isFinite) && a[0]! <= a[2]! && a[1]! <= a[3]!, 'bbox must be minLon,minLat,maxLon,maxLat')
  .transform((a) => a as [number, number, number, number]);
