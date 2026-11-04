import { SAMPLE_POLICY_TEXT } from "@/src/policy/compiler";
import { PolicyEditor } from "./PolicyEditor";

export const metadata = { title: "Return policy · Undo" };

export default function Page() {
  return <PolicyEditor sample={SAMPLE_POLICY_TEXT} />;
}
