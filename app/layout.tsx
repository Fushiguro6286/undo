import "./globals.css";
import { STORE_NAME } from "@/src/store/catalog";

export const metadata = { title: "Undo", description: "Who's at fault when an AI agent's purchase goes wrong, settled through PayPal." };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        {process.env.JUDGE_MODE === "true" && (
          <div className="judge-banner" role="note">
            Judge mode · {STORE_NAME} is a fictional store · PayPal sandbox only, no real money · <a href="/judge">Try the live scenarios</a>
          </div>
        )}
        {children}
      </body>
    </html>
  );
}
