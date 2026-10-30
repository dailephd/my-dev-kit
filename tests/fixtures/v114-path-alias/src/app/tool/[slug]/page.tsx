import { ToolPageTemplate } from "@/component/tool/ToolPageTemplate";
import { getToolBySlug } from "@/module/tool/registry";

export default function ToolPage() {
  return <ToolPageTemplate tool={getToolBySlug("example")} />;
}
