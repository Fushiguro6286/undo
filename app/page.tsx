import { BuyerPage } from "./BuyerPage";
import { PRODUCTS, VARIANTS } from "@/src/store/catalog";

export default function Home() {
  return <BuyerPage products={PRODUCTS} variants={VARIANTS} />;
}
