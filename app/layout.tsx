import "./globals.css";

export const metadata = { title: "Undo", description: "Who's at fault when an AI agent's purchase goes wrong, settled through PayPal." };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
