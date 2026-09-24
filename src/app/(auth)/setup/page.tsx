import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { SetupForm } from "@/components/auth/setup-form";
import { isSetupComplete } from "@/lib/auth/setup";

export const metadata: Metadata = { title: "Set up your instance" };

export default function SetupPage(): React.JSX.Element {
  if (isSetupComplete()) redirect("/login");
  return <SetupForm />;
}
