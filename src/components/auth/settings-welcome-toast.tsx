"use client";

import { useEffect } from "react";
import { useToast } from "@/components/ui/toast";

export function SettingsWelcomeToast(): null {
  const { toast } = useToast();

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("welcome") !== "1")
      return;
    const timer = setTimeout(() => {
      toast({
        title: "Your instance is ready",
        description:
          "Setup is permanently closed. Add a passkey, then remove CONTROL_SETUP_TOKEN from your environment.",
        variant: "success",
        duration: 9_000,
      });
    }, 0);
    return () => clearTimeout(timer);
  }, [toast]);

  return null;
}
