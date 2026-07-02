import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { ThemeProvider } from "next-themes";
import { ThemedToaster } from "@/components/ui/themed-toaster";
import "./globals.css";

export const metadata: Metadata = {
  title: "loomola",
  applicationName: "loomola",
  description: "Self-hosted screen recording by loomola",
  icons: {
    icon: [
      {
        url: "/branding/favicon-32.png",
        sizes: "32x32",
        type: "image/png",
      },
      {
        url: "/branding/loomola-logo-mark-192.png",
        sizes: "192x192",
        type: "image/png",
      },
    ],
    apple: [
      {
        url: "/branding/loomola-logo-mark.png",
        sizes: "512x512",
        type: "image/png",
      },
    ],
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${GeistSans.variable} ${GeistMono.variable}`}
    >
      <body>
        <ThemeProvider
          attribute="class"
          defaultTheme="dark"
          enableSystem
          disableTransitionOnChange
        >
          {children}
          <ThemedToaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
