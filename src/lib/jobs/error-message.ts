const INTERNAL_JOB_ERROR_PATTERN =
  /cloudflare|workers? ai|groq|openrouter|supabase|postgrest|postgres(?:ql)?|sql|oauth|jwt|environment variable|api key|access token|refresh token|stack trace|internal server|database error|connection refused|econn(?:refused|reset)|enotfound|unrecognized job type|illegal job transition|worker lease|execution lease|claim_due_agent_jobs|failed to record attempt/i;

export function safeJobErrorMessage(message: string): string {
  const normalized = message.trim();
  if (!normalized || INTERNAL_JOB_ERROR_PATTERN.test(normalized)) {
    return "Nunuza couldn’t complete this task. Please try again. If the problem continues, contact support.";
  }
  return normalized.slice(0, 180);
}
