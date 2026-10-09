import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Chillpan",
  description: "색색의 분필로 함께 흔적을 남기는 하루짜리 칠판.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <head><link rel="stylesheet" href="/chillpan/styles.css" /></head>
      <body>{children}</body>
    </html>
  );
}
