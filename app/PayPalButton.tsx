"use client";
// PayPal JS SDK v6 one-time payment button (developer.paypal.com/sdk/js/). The script is loaded in BuyerPage.
import { useEffect, useRef, useState } from "react";

declare global {
  interface Window {
    paypal?: any;
  }
}

type Props = {
  sdkReady: boolean;
  createOrder: () => Promise<{ orderId: string }>;
  onApprove: (orderId: string) => Promise<void>;
  onError: (message: string) => void;
  label: string;
};

export function PayPalButton({ sdkReady, createOrder, onApprove, onError, label }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const handlers = useRef({ createOrder, onApprove, onError });
  handlers.current = { createOrder, onApprove, onError };
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!sdkReady || !host.current) return;
    let button: HTMLElement | undefined;
    let cancelled = false;
    (async () => {
      try {
        const sdk = await window.paypal.createInstance({ clientId: process.env.NEXT_PUBLIC_PAYPAL_CLIENT_ID, components: ["paypal-payments"], pageType: "checkout" });
        const session = await sdk.createPayPalOneTimePaymentSession({
          onApprove: async (data: { orderId: string }) => handlers.current.onApprove(data.orderId),
          onCancel: () => handlers.current.onError("You closed PayPal before approving. Nothing was charged."),
          onError: (e: { message?: string }) => handlers.current.onError(e?.message ?? "PayPal reported an error"),
        });
        if (cancelled || !host.current) return;
        button = document.createElement("paypal-button");
        button.setAttribute("type", "pay");
        button.addEventListener("click", async () => {
          try {
            // Not awaited before start(): awaiting first can break the browser's popup permission.
            await session.start({ presentationMode: "auto" }, handlers.current.createOrder());
          } catch (e) {
            handlers.current.onError((e as Error).message);
          }
        });
        host.current.append(button);
        setReady(true);
      } catch (e) {
        handlers.current.onError(`Could not load PayPal: ${(e as Error).message}`);
      }
    })();
    return () => {
      cancelled = true;
      button?.remove();
    };
  }, [sdkReady]);

  return (
    <div className="paypal-slot" aria-label={label}>
      <div ref={host} />
      {!ready && <p className="muted">Loading PayPal…</p>}
    </div>
  );
}
