import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { LoginForm } from "@/components/auth/login-form";
import { getOwnerSession } from "@/lib/auth/server";
import { safeLoginDestination } from "@/lib/auth/destination";
import { isSetupComplete } from "@/lib/auth/setup";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<React.JSX.Element> {
  if (!isSetupComplete()) redirect("/setup");
  const parameters = await searchParams;
  const destination = safeLoginDestination(parameters.next);
  const reauthenticate =
    parameters.reauth === "1" || destination !== "/overview";
  if (!reauthenticate && (await getOwnerSession(await headers())))
    redirect("/overview");
  return (
    <LoginForm destination={destination} reauthenticate={reauthenticate} />
  );
}
