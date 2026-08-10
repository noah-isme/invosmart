# 1. Use Next.js 15 with App Router

## Status
Accepted

## Context
For the development of the InvoSmart invoice SaaS platform, we need a robust full-stack framework. Key requirements include Server-Side Rendering (SSR) for optimal initial load times, API routes for backend functionality, intuitive file-based routing, and support for modern React paradigms like React Server Components. The application will be highly dynamic but must remain performant and scalable.

## Decision
We will use **Next.js 15 with App Router** as our primary full-stack framework.

## Consequences
### Positive
*   **Performance**: React Server Components and SSR will ensure extremely fast page loads by offloading work to the server.
*   **SEO Optimization**: Pre-rendered pages will be highly SEO-friendly.
*   **Developer Experience**: File-based routing and co-location of server/client code simplify development.

### Negative / Trade-offs
*   **Vendor Lock-in**: Tight coupling to the Vercel ecosystem for optimal deployment features.
*   **Learning Curve**: The App Router paradigm and Server Components require developers to adapt to new patterns compared to older Next.js versions.
