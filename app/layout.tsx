export const metadata = { title: "Undo", description: "Who's at fault when an AI agent's purchase goes wrong, settled through PayPal." };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", margin: 0 }}>{children}</body>
    </html>
  );
}
