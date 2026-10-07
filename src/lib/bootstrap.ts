import { ensureSettingsRow, isLoginConfigured } from "@/lib/auth";

export type BootstrapResult = {
  settingsReady: boolean;
  loginConfigured: boolean;
  error?: string;
};

/**
 * First-run bootstrap (UX-06).
 *
 * Runs once when the server starts: makes sure the single `UserSettings` row
 * exists on either database provider, then reports whether any login credential
 * is available. When none is, the startup log and the login page both explain
 * what to do instead of the first sign-in attempt dying on a bare 500.
 *
 * Never throws - a database that is still warming up must not abort the boot
 * sequence; the condition is reported instead.
 */
export async function bootstrapLoginState(): Promise<BootstrapResult> {
  try {
    await ensureSettingsRow();
    const loginConfigured = await isLoginConfigured();

    if (!loginConfigured) {
      console.warn(
        "[startup] No login credential is configured. Generate a hash with " +
          '`npm run password:hash -- "<password>"` and set it as APP_PASSWORD_HASH ' +
          "(or set APP_PASSWORD for local development only), then sign in as " +
          "APP_USERNAME (default: admin).",
      );
    }

    return { settingsReady: true, loginConfigured };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown database error.";
    console.error(
      `[startup] Could not initialise settings in the database: ${message}`,
    );
    return { settingsReady: false, loginConfigured: false, error: message };
  }
}
