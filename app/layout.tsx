import type { Metadata, Viewport } from "next";
import { Suspense } from "react";
import { DM_Mono, Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";
import { LangProvider } from "@/components/lang";
import { Toast } from "@/components/toast";
import { getLang } from "@/lib/lang-server";

const jakarta = Plus_Jakarta_Sans({ subsets: ["latin"], variable: "--font-jakarta", weight: ["500", "600", "700", "800"] });
const mono = DM_Mono({ subsets: ["latin"], variable: "--font-dm-mono", weight: ["400", "500"] });

export async function generateMetadata(): Promise<Metadata> {
  return (await getLang()) === "zh" ? { title: "营销检查", description: "给新客户做的营销检查." } : { title: "Marketing Audit", description: "Marketing checks for new leads." };
}
export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: "#f3f6fb" }; // design-ok: the browser meta tag needs a literal colour
export const dynamic = "force-dynamic";

// Every page draws its own top bar (G look: no side menu). The language (English or 中文) comes from the switch.
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const lang = await getLang();
  return (
    <html lang={lang === "zh" ? "zh-Hans" : "en"} className={`${jakarta.variable} ${mono.variable}`}>
      <body>
        <LangProvider lang={lang}>
          {children}
          <Suspense>
            <Toast />
          </Suspense>
        </LangProvider>
      </body>
    </html>
  );
}
