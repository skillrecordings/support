import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Slack Bot",
  description: "Support approval bot for Slack",
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
