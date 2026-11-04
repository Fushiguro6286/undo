import { ClaimPage } from "./ClaimPage";

export const metadata = { title: "Claim · Undo" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  return <ClaimPage id={(await params).id} />;
}
