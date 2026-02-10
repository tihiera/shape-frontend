"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

export default function Home() {
  const router = useRouter();
  const [checking, setChecking] = useState(true);

  // If already logged in, skip landing → go straight to dashboard
  useEffect(() => {
    const uid = localStorage.getItem("uid");
    const email = localStorage.getItem("email");
    if (uid && email) {
      router.replace("/dashboard");
    } else {
      setChecking(false);
    }
  }, [router]);

  if (checking) {
    return (
      <div className="flex h-screen items-center justify-center bg-[#0E1A2A]">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-white/20 border-t-[#6BB7FF]" />
      </div>
    );
  }

  return (
    <div className="relative h-screen w-full overflow-hidden font-sans">
      {/* Fixed background — defined in globals.css, never moves */}
      <div className="bg-hero" />

      {/* Top Bar */}
      <header className="relative z-10 flex items-center justify-between px-8 py-6 sm:px-12 md:px-16">
        <span className="text-base font-semibold tracking-widest text-white/90 uppercase">
          shape
        </span>

        <div className="flex items-center gap-3">
          <a
            href="https://github.com/tihiera/shape"
            target="_blank"
            rel="noopener noreferrer"
            className="flex h-9 w-9 items-center justify-center rounded-full border border-white/25 text-white/70 transition-colors hover:border-white/50 hover:text-white"
            aria-label="GitHub"
          >
            <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z" />
            </svg>
          </a>
          <Link
            href="/login"
            className="flex h-9 w-9 items-center justify-center rounded-full border border-white/25 text-white/70 transition-colors hover:border-white/50 hover:text-white"
            aria-label="Account"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
              <circle cx="12" cy="7" r="4" />
            </svg>
          </Link>
          <Link
            href="/login"
            className="rounded-full border border-white/25 px-5 py-2 text-sm font-medium text-white/90 transition-colors hover:border-white/50 hover:bg-white/10"
          >
            Try Shape
          </Link>
        </div>
      </header>

      {/* Bottom-left content */}
      <div className="absolute bottom-0 left-0 z-10 px-8 pb-12 sm:px-12 md:px-16">
        <h1 className="animate-fade-in-up text-3xl font-bold leading-tight tracking-tight text-white sm:text-5xl md:text-[3.5rem]">
          From mesh to meaning.
        </h1>
        <p className="animate-fade-in-up-delayed mt-4 max-w-lg text-sm leading-relaxed text-[#C9D4E0] sm:text-base">
          Upload a mesh. Ask questions. Explore structure in real time.
        </p>
        <div className="animate-fade-in-up-delayed-2 mt-8">
          <Link
            href="/login"
            className="inline-flex items-center gap-2.5 rounded-full bg-white/95 px-6 py-3 text-sm font-semibold text-[#0E1A2A] transition-all hover:bg-white hover:shadow-lg"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <polygon points="5,3 19,12 5,21" />
            </svg>
            Try Shape
          </Link>
        </div>
      </div>
    </div>
  );
}
