/**
 * Server-side environment configuration and validation.
 *
 * This module is imported only in server components, API routes, and
 * server-side utilities. It MUST NOT be imported in client components,
 * as it references secret environment variables that would be leaked
 * to the browser bundle.
 *
 * Call `getServerConfig()` to get a validated config object.
 * It throws at startup if any required variable is missing.
 */

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `[env] Required environment variable "${name}" is missing. ` +
        `Copy .env.example to .env.local and set all required values.`
    );
  }
  return value;
}

function optionalEnv(name: string, fallback: string = ""): string {
  return process.env[name] ?? fallback;
}

let _config: ReturnType<typeof buildConfig> | null = null;

function buildConfig() {
  return {
    // ─── Supabase ──────────────────────────────────────────────────────────
    supabase: {
      url:            requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
      publishableKey: requireEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"),
      serviceRoleKey: requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
    },

    // ─── AI providers ──────────────────────────────────────────────────────
    groq: {
      apiKey:       requireEnv("GROQ_API_KEY"),
      defaultModel: optionalEnv("GROQ_DEFAULT_MODEL", "llama-3.3-70b-versatile"),
    },
    openRouter: {
      apiKey:       requireEnv("OPENROUTER_API_KEY"),
      defaultModel: optionalEnv("OPENROUTER_DEFAULT_MODEL", "anthropic/claude-3-haiku"),
    },

    // ─── LinkedIn ──────────────────────────────────────────────────────────
    linkedin: {
      clientId:        requireEnv("LINKEDIN_CLIENT_ID"),
      clientSecret:    requireEnv("LINKEDIN_CLIENT_SECRET"),
      redirectUri:     requireEnv("LINKEDIN_REDIRECT_URI"),
      encryptionKey:   requireEnv("LINKEDIN_TOKEN_ENCRYPTION_KEY"),
      /** Current supported LinkedIn API version. Change here to update globally. */
      apiVersion:      optionalEnv("LINKEDIN_API_VERSION", "202410"),
    },

    // ─── Telegram ──────────────────────────────────────────────────────────
    telegram: {
      botToken:       requireEnv("TELEGRAM_BOT_TOKEN"),
      webhookSecret:  requireEnv("TELEGRAM_WEBHOOK_SECRET"),
    },

    // ─── Polar billing ─────────────────────────────────────────────────────
    polar: {
      accessToken:    requireEnv("POLAR_ACCESS_TOKEN"),
      webhookSecret:  requireEnv("POLAR_WEBHOOK_SECRET"),
      productId:      requireEnv("POLAR_PRODUCT_ID"),
      priceId:        requireEnv("POLAR_PRICE_ID"),
    },

    // ─── App ───────────────────────────────────────────────────────────────
    app: {
      env:     optionalEnv("NEXT_PUBLIC_APP_ENV", "development"),
      url:     optionalEnv("NEXT_PUBLIC_APP_URL", "http://localhost:3000"),
      isDev:   optionalEnv("NEXT_PUBLIC_APP_ENV", "development") === "development",
    },
  } as const;
}

/**
 * Returns the validated server-side configuration.
 * Cached after first call. Throws if any required variable is missing.
 */
export function getServerConfig() {
  if (!_config) {
    _config = buildConfig();
  }
  return _config;
}

// ─── Public (browser-safe) config ────────────────────────────────────────────
// Only NEXT_PUBLIC_* variables are safe in client components.

export const publicConfig = {
  supabaseUrl:          process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
  supabasePublishableKey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "",
  appEnv:               process.env.NEXT_PUBLIC_APP_ENV ?? "development",
  appUrl:               process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
  isDev:                process.env.NEXT_PUBLIC_APP_ENV === "development",
} as const;
