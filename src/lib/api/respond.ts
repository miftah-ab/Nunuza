/**
 * API response helpers — consistent JSON shape for all Route Handlers.
 *
 * Every API route must return one of these shapes:
 *   { data: T }          — success
 *   { error: string }    — failure (safe message only, never internal details)
 *
 * Use apiError() to convert AuthError / ForbiddenError / EntitlementError
 * into the correct HTTP status code and safe JSON body.
 *
 * Never expose stack traces, SQL errors, or secrets in responses.
 */

import { NextResponse } from "next/server";
import {
  AuthError,
  ForbiddenError,
  EntitlementError,
} from "@/lib/auth/workspace";

export type ApiSuccess<T> = { data: T };
export type ApiError = { error: string };
export type ApiResponse<T> = ApiSuccess<T> | ApiError;

/** Wrap a successful response. */
export function ok<T>(data: T, status = 200): NextResponse<ApiSuccess<T>> {
  return NextResponse.json({ data }, { status });
}

/** Wrap a created-resource response. */
export function created<T>(data: T): NextResponse<ApiSuccess<T>> {
  return NextResponse.json({ data }, { status: 201 });
}

/** Convert a known domain error → safe HTTP response. */
export function apiError(err: unknown): NextResponse<ApiError> {
  if (err instanceof AuthError) {
    return NextResponse.json({ error: err.message }, { status: 401 });
  }
  if (err instanceof EntitlementError) {
    return NextResponse.json({ error: err.message }, { status: 403 });
  }
  if (err instanceof ForbiddenError) {
    return NextResponse.json({ error: err.message }, { status: 403 });
  }
  // Unexpected error — log server-side, return generic message
  console.error("[api] Unexpected error:", err);
  return NextResponse.json(
    { error: "An unexpected error occurred. Please try again." },
    { status: 500 }
  );
}

/** Parse JSON body safely. Returns null if body is missing or invalid. */
export async function parseBody<T>(request: Request): Promise<T | null> {
  try {
    return (await request.json()) as T;
  } catch {
    return null;
  }
}

/** Validate that required string fields are present and non-empty. */
export function requireFields(
  body: Record<string, unknown>,
  fields: string[]
): string | null {
  for (const field of fields) {
    const val = body[field];
    if (val === undefined || val === null || val === "") {
      return `Missing required field: ${field}`;
    }
  }
  return null;
}
