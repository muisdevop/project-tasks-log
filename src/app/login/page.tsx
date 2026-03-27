import { LoginForm } from "@/components/login-form";
import { getSessionUsername } from "@/lib/session";
import { redirect } from "next/navigation";

export default async function LoginPage() {
  const username = await getSessionUsername();
  if (username) {
    redirect("/projects");
  }

  return (
    <main className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-purple-50 dark:from-zinc-900 dark:via-zinc-950 dark:to-zinc-900 flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        <LoginForm />
        <div className="mt-8 text-center">
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Task Logger - Track your work efficiently
          </p>
        </div>
      </div>
    </main>
  );
}
