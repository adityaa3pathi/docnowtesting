import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";

import { LocationProvider } from "@/contexts/LocationContext";
import { AuthProvider } from "@/contexts/AuthContext";
import { CartProvider } from "@/contexts/CartContext";
import { Toaster } from "react-hot-toast";
import { GlobalHeader } from "@/components/GlobalHeader";

const inter = localFont({
  src: "./fonts/InterVariable.woff2",
  variable: "--font-inter",
  display: "swap",
});

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
      <body className={inter.className}>
        <AuthProvider>
          <CartProvider>
            <LocationProvider>
              {/* Global sticky navbar — excluded on /manager and /super-admin by GlobalHeader */}
              <GlobalHeader />
              {children}
              <Toaster position="top-right" />
            </LocationProvider>
          </CartProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
