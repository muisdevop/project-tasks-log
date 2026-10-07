export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { assertStartupConfig } = await import("@/lib/startup-checks");
    assertStartupConfig();
  }
}
