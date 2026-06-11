# DOCNOW - Technical Details and Practices

## 1. Technology Stack

### Frontend (Client)
- **Framework:** Next.js (16.x) with React 19.
- **Styling:** Tailwind CSS v4, CLSX, Tailwind Merge for dynamic class building.
- **UI Components:** Radix UI primitives for accessible, unstyled UI components.
- **Animations:** Framer Motion for rich, smooth interactions.
- **Data Visualization & Carousels:** Recharts for charts, React Slick for carousels.
- **HTTP Client:** Axios for API communication.
- **Icons:** Lucide React.
- **Language:** TypeScript.

### Backend (Server)
- **Framework:** Express.js (v5.x) on Node.js.
- **Database ORM:** Prisma.
- **Authentication & Security:** JWT (jsonwebtoken), bcryptjs for hashing, Helmet for secure HTTP headers, CSRF protection, and CORS.
- **Validation:** Zod for schema validation.
- **Payments:** Razorpay integration.
- **PDF Generation:** PDFKit and PDF-lib for document generation (e.g., invoices, reports).
- **Cloud & Storage:** AWS SDK (S3).
- **Rate Limiting & Caching:** Upstash Redis & Ratelimit.
- **Task Scheduling:** Node-cron for background jobs.
- **Language:** TypeScript.

## 2. Core Practices and Architecture
- **Project Structure:** Segmented into a `client` (Next.js frontend) and `server` (Express backend) structure.
- **Type Safety:** Comprehensive TypeScript usage ensures robust type-checking and developer experience across the stack.
- **Database Management:** Prisma is used for schema definitions, migrations, and type-safe database queries.
- **API Integration:** Client-server communication is handled via RESTful endpoints using Axios.
- **Security Posture:** Built-in safeguards including rate limiting (Upstash), robust authentication (JWT), password hashing (bcrypt), and HTTP security headers (Helmet).
- **Extensibility:** The use of Radix UI allows for building a custom, accessible design system without being locked into a specific component library's styles.
