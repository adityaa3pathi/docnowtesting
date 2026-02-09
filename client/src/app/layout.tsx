import type { Metadata } from "next";
import { Inter } from "next/font/google"; // Using Inter for premium feel
import "./globals.css";
import { cn } from "@/lib/utils";

import { LocationProvider } from "@/contexts/LocationContext";
import { AuthProvider } from "@/contexts/AuthContext";
import { CartProvider } from "@/contexts/CartContext";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "DOCNOW - Premium Health Bookings",
  description: "Book lab tests from home with our premium partners.",
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
              {children}
            </LocationProvider>
          </CartProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
