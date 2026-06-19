import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "출역·노임 정산 도우미",
  description: "근로자 출역 및 월말 노임 정산 관리용 내부 업무 앱"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
