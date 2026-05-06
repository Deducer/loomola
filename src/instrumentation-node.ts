/**
 * Node-runtime-only side of the instrumentation boot hook. Imports
 * pg-boss + pg, which only work under Node — never bundled for Edge
 * because instrumentation.ts only dynamically imports this file when
 * NEXT_RUNTIME === "nodejs".
 */

import { getBoss } from "@/lib/queue/boss";

try {
  await getBoss();
  console.log("[instrumentation] pg-boss workers warmed at boot");
} catch (err) {
  console.error("[instrumentation] pg-boss warm-start failed:", err);
}
