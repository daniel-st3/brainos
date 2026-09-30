import { redirect } from "next/navigation";
import { authClient } from "@/server/auth";
import { isConnected } from "@/server/repository";
async function signIn(data: FormData) {
  "use server";
  if (!isConnected()) redirect("/");
  const c = await authClient();
  const { data: session, error } = await c.auth.signInWithPassword({
    email: String(data.get("email")),
    password: String(data.get("password")),
  });
  if (error || session.user?.id !== process.env.CONTENT_OS_EDITOR_ID) {
    await c.auth.signOut();
    redirect("/login?error=1");
  }
  redirect("/");
}
export default async function Login({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  return (
    <section className="panel login-panel">
      <div className="eyebrow">PRIVATE NEWSROOM</div>
      <h1>Back to the desk.</h1>
      <p>
        Sign in with the single editor account configured for this workspace.
      </p>
      <form action={signIn}>
        <label>
          Email
          <input name="email" type="email" required autoComplete="username" />
        </label>
        <label>
          Password
          <input
            name="password"
            type="password"
            required
            autoComplete="current-password"
          />
        </label>
        {error && (
          <p className="form-error">
            Unable to sign in with an authorized editor account.
          </p>
        )}
        <button className="button">Sign in</button>
      </form>
    </section>
  );
}
