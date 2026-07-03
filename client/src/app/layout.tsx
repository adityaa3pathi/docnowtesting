import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";

import { LocationProvider } from "@/contexts/LocationContext";
import { AuthProvider } from "@/contexts/AuthContext";
import { CartProvider } from "@/contexts/CartContext";
import { AuthGateProvider } from "@/contexts/AuthGateContext";
import { Toaster } from "react-hot-toast";
import { GlobalHeader } from "@/components/GlobalHeader";

import { LegacyCookieCleanup } from "@/components/LegacyCookieCleanup";

const inter = localFont({
  src: "./fonts/InterVariable.woff2",
  variable: "--font-inter",
  display: "swap",
});

import Script from "next/script";

export const metadata: Metadata = {
  title: "DOCNOW - Premium Health Bookings",
  description: "Book lab tests from home with our premium partners.",
  icons: {
    icon: "/docnow-logo.png",
    shortcut: "/docnow-logo.png",
    apple: "/docnow-logo.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        {/* Google Tag Manager */}
        <Script id="gtm" strategy="afterInteractive">{`
          (function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':
          new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],
          j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src=
          'https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);
          })(window,document,'script','dataLayer','GTM-N2ZN3K33');
        `}</Script>
      </head>
      <body className={inter.className}>
        {/* Google Tag Manager (noscript) */}
        <noscript>
          <iframe
            src="https://www.googletagmanager.com/ns.html?id=GTM-N2ZN3K33"
            height="0"
            width="0"
            style={{ display: 'none', visibility: 'hidden' }}
          />
        </noscript>
        <LegacyCookieCleanup />
        <AuthProvider>
          <CartProvider>
            <AuthGateProvider>
            <LocationProvider>
              {/* Global sticky navbar — excluded on /manager and /super-admin by GlobalHeader */}
              <GlobalHeader />
              {children}
              <Toaster position="top-right" />
            </LocationProvider>
            </AuthGateProvider>
          </CartProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
