import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Front Plugin",
  description: "Front webhook integration for support system",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
