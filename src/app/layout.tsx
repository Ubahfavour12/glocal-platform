import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "Glocal, Autonomous Marketing",
    template: "%s · Glocal",
  },
  description:
    "Upload a product photo, fund a wallet, approve once a day. The agent does the rest.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        {/*
          Applies the saved theme before first paint. This has to run
          synchronously in <head>, ahead of React: anything later means the
          browser paints the default palette first and the user sees a flash of
          the wrong theme on every page load. Deliberately tiny and dependency
          free; it fails silently in private mode and falls back to the system
          preference, which is the correct default anyway.
        */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var c=localStorage.getItem('glocal:theme');if(c==='light'||c==='dark'){document.documentElement.setAttribute('data-theme',c);}}catch(e){}})();`,
          }}
        />
      </head>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
