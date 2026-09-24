import { redirect } from "next/navigation";
import { isSetupComplete } from "@/lib/auth/setup";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default function HomePage(): never {
  redirect(isSetupComplete() ? "/overview" : "/setup");
}
