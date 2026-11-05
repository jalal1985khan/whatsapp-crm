import Link from "next/link";
import { PasswordResetForm } from "@/components/password-reset-form";

export const dynamic = "force-dynamic";

export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  if (token && token.length <= 128) return <PasswordResetForm token={token} />;
  return <main className="flex min-h-screen items-center justify-center bg-muted/30 px-4"><section className="w-full max-w-md rounded-2xl border bg-card p-8 text-center shadow-sm"><h1 className="text-xl font-semibold">Reset link unavailable</h1><p className="mt-2 text-sm text-muted-foreground">Request a new password reset link and open it from your email.</p><Link href="/login/forgot-password" className="mt-5 inline-flex text-sm font-medium text-primary">Request another link</Link></section></main>;
}
