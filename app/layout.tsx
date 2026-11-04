import type { Metadata, Viewport } from "next";
import { Archivo } from "next/font/google";
import "./globals.css";
import { APP_DESCRIPTION, APP_NAME } from "@/lib/brand";
import { THEME_SCRIPT } from "@/components/shell/ThemeToggle";
import { InlineScript } from "@/components/shell/InlineScript";

// One workhorse face with weight and width axes: heavy, wide numerals for values, normal width for UI text.
const archivo = Archivo({
  variable: "--font-archivo",
  subsets: ["latin"],
  axes: ["wdth"],
});

export const metadata: Metadata = {
  title: { default: APP_NAME, template: `%s · ${APP_NAME}` },
  description: APP_DESCRIPTION,
  appleWebApp: { title: APP_NAME, statusBarStyle: "default" },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#14212b" },
    { media: "(prefers-color-scheme: dark)", color: "#0a1116" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // The inline script may set data-theme before React hydrates, so <html> attributes can differ.
    <html
      lang="en"
      suppressHydrationWarning
      className={`${archivo.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col bg-canvas text-fg">
        <InlineScript html={THEME_SCRIPT} />
        {children}
      </body>
    </html>
  );
}
