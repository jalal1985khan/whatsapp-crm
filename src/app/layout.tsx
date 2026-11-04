import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Relay CRM",
  description: "A shared WhatsApp inbox and customer workspace.",
  referrer: "no-referrer",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
