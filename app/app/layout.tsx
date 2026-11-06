import type { Metadata } from "next";
import Link from "next/link";
import { isAuthenticated } from "@/lib/session";
import "./globals.css";

export const metadata: Metadata = {
  title: "career-hq",
  description: "Career Command Center",
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const authed = await isAuthenticated();
  return (
    <html lang="en">
      <body className="bg-zinc-950 text-zinc-200 antialiased min-h-screen">
        {authed && (
          <nav className="border-b border-zinc-800 px-6 py-3 flex items-center gap-6 text-sm">
            <span className="font-semibold text-zinc-100 tracking-tight">career-hq</span>
            <Link href="/" className="text-zinc-400 hover:text-zinc-100">Overview</Link>
            <Link href="/pipeline" className="text-zinc-400 hover:text-zinc-100">Pipeline</Link>
            <Link href="/calendar" className="text-zinc-400 hover:text-zinc-100">Deadlines</Link>
            <span className="ml-auto text-zinc-600 text-xs">Asia/Jakarta</span>
          </nav>
        )}
        <main className="px-6 py-6 max-w-[1400px] mx-auto">{children}</main>
      </body>
    </html>
  );
}
