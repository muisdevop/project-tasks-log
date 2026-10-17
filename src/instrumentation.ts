export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { assertStartupConfig } = await import("@/lib/startup-checks");
    assertStartupConfig();
    // UX-06: idempotently create the settings row and warn when no credential
    // exists, so a fresh container is explainable rather than a silent 500.
    const { bootstrapLoginState } = await import("@/lib/bootstrap");
    await bootstrapLoginState();
  }
}
