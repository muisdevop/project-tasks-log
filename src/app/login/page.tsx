import { LoginForm } from "@/components/login-form";
import { getSessionUsername } from "@/lib/session";
import { isLoginConfigured } from "@/lib/auth";
import { redirect } from "next/navigation";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[] | undefined }>;
}) {
  const username = await getSessionUsername();
  if (username) {
    redirect("/dashboard");
  }

  const { next } = await searchParams;
  // UX-06: on a fresh install with no credential configured, say so up front
  // instead of letting the first sign-in attempt fail with an opaque 500.
  const setupRequired = !(await isLoginConfigured());

  return (
    <main className="min-h-screen bg-linear-to-br from-blue-50 via-white to-purple-50 dark:from-zinc-900 dark:via-zinc-950 dark:to-zinc-900 flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        <LoginForm next={next} setupRequired={setupRequired} />
        <div className="mt-8 text-center">
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            GID Task Flow - Track your work efficiently
          </p>
        </div>
      </div>
    </main>
  );
}
