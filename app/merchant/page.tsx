import { MerchantConsole } from "./MerchantConsole";

export const dynamic = "force-dynamic"; // the AG Studio key is read at request time
export const metadata = { title: "Merchant console · Undo" };

export default function Page() {
  return <MerchantConsole licenseKey={process.env.AG_STUDIO_LICENSE_KEY} />;
}
