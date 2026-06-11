# DOCNOW - Client Handover Walkthrough

Welcome to the DOCNOW Frontend Client. This document maps out the Next.js React architecture, state management, and API integration strategy used in this project.

## 1. Framework & Structure

The frontend is built on **Next.js 16.x** using the **App Router** (`src/app/`), written entirely in TypeScript, and styled with **Tailwind CSS v4** and **Radix UI**.

### Directory Layout (`client/src/`)
- **`app/`:** Contains all the pages and routing logic (Next.js App Router).
  - e.g., `app/packages/page.tsx`, `app/manager/dashboard/page.tsx`
- **`components/`:** Reusable UI elements (buttons, inputs, modals, layouts).
- **`contexts/`:** React Context providers for global state (e.g., `AuthContext.tsx`, `CartContext.tsx`).
- **`hooks/`:** Custom React hooks for shared logic.
- **`lib/`:** Core libraries and configurations, notably the global Axios API client (`api.ts`).
- **`utils/`:** Helper functions (formatting, date parsing, etc.).

## 2. Core Concepts & Flows

### A. API Integration & The Axios Client (`lib/api.ts`)
Instead of using native `fetch` everywhere, the application centralizes all API calls through a custom Axios instance in `lib/api.ts`.
- **Why?** It automatically handles attaching Bearer tokens, CSRF tokens (`x-docnow-csrf`), and globally catches network errors.
- **Silent Refresh:** If an API call fails with a `401 Unauthorized`, the interceptor automatically attempts to hit `/auth/refresh`, gets a new token, and retries the original request *without* the user noticing.

### B. Global State (React Contexts)
We avoid heavy state managers like Redux in favor of React Contexts for specific domains:
- **`AuthContext.tsx`:** Bootstraps on app load to fetch user details. It exposes `login`, `logout`, and the current `user` object. It does *not* store the raw JWT (which is handled by `api.ts` in memory and HTTP-only cookies).
- **`CartContext.tsx`:** Manages the user's shopping cart. It is synchronized with `AuthContext` so that logging out immediately clears the cart.

### C. Styling & UI Components
- **Tailwind CSS:** Used for all styling.
- **Radix UI:** Used for complex, accessible interactive components (Dropdowns, Dialogs, Selects) to save time on accessibility wiring. We wrap these primitives in our own Tailwind classes.
- **Animations:** We use `framer-motion` for smooth UI transitions (like route changes, modals opening, or hover effects on the landing page).

## 3. Coding Practices & Comments
Just like the server, we adhere to strict commenting guidelines:
- **Contexts & Libs:** Get file-level `/** === */` headers explaining their global role.
- **Hooks & API Utils:** Use TSDoc to explain parameters and return values (e.g., `downloadAuthenticatedFile` in `api.ts`).
- **Components:** Avoid over-commenting JSX. The component name and prop interfaces should be self-documenting. Use inline comments to explain complex `useEffect` logic or specific visual hacks (like Tailwind overrides).

## 4. Local Development
- Run the client with `npm run dev` (starts on port 3000).
- Environment variables are located in `.env.local` or `.env.development`. Ensure `NEXT_PUBLIC_API_URL` points to your local Express server (usually `http://localhost:5000/api`).

---
**Handover Note:** When creating new protected pages (e.g., in the manager or admin panel), make sure to utilize the `useAuth()` hook to redirect users if they are not authenticated, rather than relying solely on server-side protection.
