"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { login } from "@/lib/api";

export default function LoginPage() {
  const router = useRouter();
  const [status, setStatus] = useState("Checking…");

  useEffect(() => {
    // If already logged in, skip straight to dashboard
    const uid = localStorage.getItem("uid");
    const storedEmail = localStorage.getItem("email");
    if (uid && storedEmail) {
      router.replace("/dashboard");
      return;
    }

    // Auto-generate a random email and login silently
    async function autoLogin() {
      try {
        setStatus("Accessing the platform…");

        // Generate a random long email
        const rand = crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");
        const email = `user_${rand}@shape.local`;

        const data = await login(email);
        localStorage.setItem("uid", data.uid);
        localStorage.setItem("email", data.email);

        setStatus("Welcome to Shape");

        // Brief pause so the user sees the welcome message
        setTimeout(() => {
          router.push("/dashboard");
        }, 600);
      } catch {
        setStatus("Something went wrong. Please refresh.");
      }
    }

    autoLogin();
  }, [router]);

  return (
    <div className="relative flex min-h-screen w-full items-center justify-center font-sans">
      {/* Fixed background */}
      <div className="bg-hero" />

      <div className="relative z-10 flex flex-col items-center gap-5">
        <span className="text-lg font-semibold tracking-widest text-white/90 uppercase">
          shape
        </span>

        <div className="flex items-center gap-3">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-white/20 border-t-white/80" />
          <span className="text-sm font-medium text-white/60">{status}</span>
        </div>
      </div>
    </div>
  );
}
