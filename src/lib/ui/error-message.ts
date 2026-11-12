/**
 * Convert client-side failures into messages that help customers recover.
 * Server responses should already be sanitized by the API layer; this helper
 * prevents browser/network/parser exceptions from being shown verbatim.
 */
const INTERNAL_ERROR_PATTERN =
  /cloudflare|workers? ai|supabase|postgrest|postgres(?:ql)?|\bsql\b|\boauth\b|\bjwt\b|environment variable|\benv var\b|api key|access token|refresh token|stack trace|internal server|failed to fetch|networkerror|load failed|unexpected token|unexpected end of json|econn(?:refused|reset)|enotfound|fetch failed/i;

export function userFacingError(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) return fallback;
  if (error instanceof TypeError || error instanceof SyntaxError) return fallback;
  if (INTERNAL_ERROR_PATTERN.test(error.message)) return fallback;
  return error.message || fallback;
}
