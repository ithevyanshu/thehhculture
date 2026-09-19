import { z, type ZodTypeAny } from 'zod';

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export const badRequest = (msg = 'Bad request', details?: unknown) => new HttpError(400, msg, details);
export const unauthorized = (msg = 'Authentication required') => new HttpError(401, msg);
export const forbidden = (msg = 'Forbidden') => new HttpError(403, msg);
export const notFound = (what = 'Resource') => new HttpError(404, `${what} not found`);
export const conflict = (msg: string) => new HttpError(409, msg);

/** Validate input with a zod schema; throws a 400 with field errors on failure. */
export function parse<S extends ZodTypeAny>(schema: S, data: unknown): z.infer<S> {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw badRequest('Validation failed', result.error.flatten().fieldErrors);
  }
  return result.data;
}

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(24),
});

export function paginate(page: number, limit: number) {
  return { skip: (page - 1) * limit, take: limit };
}

export function pageMeta(page: number, limit: number, total: number) {
  return { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) };
}

/** Read a single route param (Express 5 types widen params to string | string[]). */
export function param(req: { params: Record<string, string | string[] | undefined> }, name: string): string {
  const value = req.params[name];
  return (Array.isArray(value) ? value[0] : value) ?? '';
}
