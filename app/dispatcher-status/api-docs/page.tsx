import type { Metadata } from "next"
import { SwaggerDocs } from "@/components/swagger-docs"

export const metadata: Metadata = {
  title: "Dispatcher API Docs",
  description: "Interactive OpenAPI / Swagger reference for the BESS dispatcher control and health endpoints.",
}

export default function ApiDocsPage() {
  return <SwaggerDocs specUrl="/api/dispatcher/openapi.json" />
}
