import type { NextConfig } from "next";
import { assertSandbox } from "./src/paypal/client";

// Refuse to build or start against anything but the PayPal sandbox.
assertSandbox();

const nextConfig: NextConfig = {};
export default nextConfig;
