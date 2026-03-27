import { LoginForm } from "@/components/login-form";
import { getSessionUsername } from "@/lib/session";
import { redirect } from "next/navigation";

export default async function LoginPage() {
  const username = await getSessionUsername();
  if (username) {
    redirect("/projects");
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md items-center px-4">
      <LoginForm />
    </main>
  );
}
