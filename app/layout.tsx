import "./globals.css";
import { IBM_Plex_Mono, Playfair_Display, Schibsted_Grotesk } from "next/font/google";
import { STORE_NAME } from "@/src/store/catalog";

// Display serif for rulings and headlines, a newspaper grotesk for the interface, a typewriter mono for evidence.
const display = Playfair_Display({ subsets: ["latin"], weight: ["400", "500", "600"], style: ["normal", "italic"], variable: "--font-display" });
const ui = Schibsted_Grotesk({ subsets: ["latin"], variable: "--font-ui" });
const mono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-mono" });

export const metadata = { title: "Undo", description: "Who's at fault when an AI agent's purchase goes wrong, settled through PayPal." };

const TICKER = ["Judge mode", `${STORE_NAME} is a fictional store`, "PayPal sandbox only", "No real money moves"];

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${ui.variable} ${mono.variable}`}>
      <body>
        {process.env.JUDGE_MODE === "true" && (
          <div className="judge-banner" role="note">
            <span className="sr-only">Judge mode · {STORE_NAME} is a fictional store · PayPal sandbox only, no real money · </span>
            <div className="ticker" aria-hidden="true">
              {[0, 1].map((k) => (
                <span key={k} className="ticker-run">
                  {[...TICKER, ...TICKER].map((t, i) => <span key={i}>{t}<i>✶</i></span>)}
                </span>
              ))}
            </div>
            <a href="/judge">Try the live scenarios →</a>
          </div>
        )}
        <header className="site-head">
          <a href="/" className="wordmark" aria-label="Undo home">
            <span className="wordmark-glyph" aria-hidden="true">↺</span>Undo
          </a>
          <nav aria-label="Main">
            <a href="/">Store</a>
            <a href="/judge">Judge</a>
            <a href="/evals">Evals</a>
            <a href="/merchant">Merchant</a>
          </nav>
        </header>
        {children}
      </body>
    </html>
  );
}
