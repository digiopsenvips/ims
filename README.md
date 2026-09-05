# Enactus VIPS-TC Inventory & Sales Management System (IMS)

A full-stack, production-grade web application built for **Enactus VIPS-TC**, managing inventory, pop-up events, real-time sales, and analytics for the **Tahsin** and **Upcycle** product lines.

---

## 🌟 Key Features

1. **Role-Based Access Control (RBAC)**:
   - **Developer** (Full system control, account management, password resets, raw PII view, Head permission checklist).
   - **Admin** (Catalog, inventory, and event management; account creation/deletion restricted).
   - **Head** (Configurable granular permission checklist: Inventory, Revenue, Customer PII, Analytics, Event breakdown, Inventory editing, Event editing, CSV Export).
   - **Member** (Streamlined offline-capable PWA sales portal; pre-sale volunteer identity verification).
2. **Auto-Generated Product IDs**:
   - System auto-generates product identifiers on creation (e.g. `TAH-001`, `TAH-002`, `UPC-001`, `UPC-002`) based on project code prefixes.
3. **Bulk Inventory Intake & Live Counts**:
   - Multi-row bulk stock feeding form.
   - Real-time stock decrements and increments powered by **Socket.IO** WebSockets.
4. **Events with Inline Allocations & Pricing**:
   - Create and edit pop-up events with inline product stock allocation and per-event price overrides.
   - **"End Event"** action: Finalizes the event and automatically returns remaining unsold allocated stock to main inventory.
5. **Offline PWA Member Sales Portal**:
   - Installable Progressive Web App (PWA) with Service Worker and Web App Manifest.
   - Offline-first IndexedDB transaction queue with background sync and retry.
   - Visible **"X entries pending sync"** indicator.
   - Idempotent sync (`clientTxId`) preventing duplicate sales entries.
6. **Analytics & Dashboards**:
   - Recharts visualisations: Product share pie chart (with project toggle), daily sales timeline, and stall performance breakdown.
   - Permission-gated: Automatically masks customer PII and hides revenue metrics if permissions are not granted.

---

## 🏗️ Architecture & Tech Stack

```
ims/
├── backend/                  # Node.js + Express + Prisma + Socket.IO + JWT
│   ├── prisma/
│   │   ├── schema.prisma    # PostgreSQL Schema (users, permissions, projects, products, inventory, events, allocations, sales)
│   │   └── seed.ts          # Seed script with demo accounts & initial catalog
│   ├── src/
│   │   ├── config/          # Prisma & environment configs
│   │   ├── middleware/      # JWT auth, RBAC, Head permissions, PII sanitization
│   │   ├── routes/          # REST API endpoints (auth, users, projects, products, inventory, events, sales, analytics)
│   │   ├── sockets/         # Socket.IO WebSocket handlers & real-time broadcasts
│   │   └── server.ts        # Express app entrypoint
│   ├── .env.example
│   └── package.json
│
├── frontend/                 # React 18 + Vite + Tailwind CSS + Recharts + PWA
│   ├── public/
│   │   ├── manifest.json    # PWA web app manifest
│   │   ├── sw.js            # Service worker caching app shell
│   │   └── favicon.svg
│   ├── src/
│   │   ├── components/      # UI components, layout, sync status indicator
│   │   ├── context/         # AuthContext & SocketContext
│   │   ├── lib/             # API client, IndexedDB storage, sync manager
│   │   ├── pages/           # Login, Member confirmation, Sales portal, Dashboard, Inventory, Events, Analytics, Users
│   │   ├── App.tsx          # Route definitions & guards
│   │   └── main.tsx
│   ├── .env.example
│   └── package.json
│
├── README.md
└── package.json              # Root orchestrator
```

---

## 🚀 Getting Started

### 1. Prerequisites
- **Node.js**: v18 or higher (v20+ recommended)
- **npm**: v9 or higher
- **PostgreSQL**: Local instance running on port `5432`

---

### 2. Database Setup (PostgreSQL)

If PostgreSQL is not already running or the database does not exist:

1. **Start PostgreSQL**:
   ```bash
   # macOS (Homebrew)
   brew services start postgresql@18
   # or Linux
   sudo systemctl start postgresql
   ```

2. **Create the `ims` Database**:
   ```bash
   psql -U postgres -h localhost -c "CREATE DATABASE ims;"
   ```

3. **Verify Database Credentials**:
   Default local configuration uses:
   - **Host**: `localhost:5432`
   - **Database**: `ims`
   - **User**: `postgres`
   - **Password**: `Param@123`

---

### 3. Environment Configuration

Copy the example environment files:

#### Backend (`backend/.env`):
```env
PORT=5001
DATABASE_URL="postgresql://postgres:Param@123@localhost:5432/ims?schema=public"
JWT_SECRET="enactus-vips-tc-jwt-secret-secure-key"
CORS_ORIGIN="http://localhost:5173"
```

#### Frontend (`frontend/.env`):
```env
VITE_API_URL=http://localhost:5001/api
VITE_SOCKET_URL=http://localhost:5001
```

---

### 4. Install Dependencies, Migrate & Seed

Run the automated root setup command:

```bash
# Installs backend & frontend dependencies, pushes Prisma schema, and seeds data
npm run setup
```

Or manually:

```bash
# 1. Backend setup
cd backend
npm install
npx prisma db push
npm run db:seed

# 2. Frontend setup
cd ../frontend
npm install
cd ..
```

---

### 5. Running the Application

Run both frontend and backend concurrently from the root directory:

```bash
npm run dev
```

- **Frontend Application**: [http://localhost:5173](http://localhost:5173)
- **Backend API & WebSockets**: [http://localhost:5001](http://localhost:5001)
- **API Health Check**: [http://localhost:5001/api/health](http://localhost:5001/api/health)

To run services independently:
```bash
# Terminal 1: Backend
npm run dev:backend

# Terminal 2: Frontend
npm run dev:frontend
```

---

## 🔑 Default Seeded Login Credentials

The database seed creates accounts for each role with pre-configured permissions:

| Role | Username | Password | Notes / Permissions |
| :--- | :--- | :--- | :--- |
| **Developer** | `developer` | `Admin@123` | Full access, user management, password resets, unmasked data |
| **Admin** | `admin` | `Admin@123` | Catalog, inventory, events, sales management |
| **Finance Head** | `head_finance` | `Head@123` | Can view revenue & export data; customer PII masked |
| **Marketing Head** | `head_marketing` | `Head@123` | Can edit events & view revenue; customer PII masked |
| **Production Head** | `head_production` | `Head@123` | Can edit inventory; revenue & PII hidden |
| **Sales Member** | `aarav_sharma` | `Member@123` | Volunteer name confirmation, offline PWA sales form |
| **Sales Member** | `diya_verma` | `Member@123` | Volunteer name confirmation, offline PWA sales form |

*Tip: The login page also features a "Quick Role Switcher" button row to test any role with one click!*

---

## 📱 PWA & Offline Testing Instructions

1. Log in as a member (e.g. `aarav_sharma` / `Member@123`).
2. Verify your volunteer name on the confirmation screen.
3. In Chrome/Edge DevTools, open the **Application** tab:
   - Check **Manifest**: shows "Enactus IMS" with standalone configuration.
   - Check **Service Workers**: active and caching static assets.
   - Check **IndexedDB** -> `enactus_ims_offline_db` -> `offline_sales`.
4. Open the **Network** tab in DevTools and toggle throttling to **Offline**.
5. Notice the network indicator changes to **Offline Mode**.
6. Record 2-3 sales of allocated products.
7. Observe the sticky **"X entries pending sync"** indicator update in real-time.
8. Toggle Network back to **Online**.
9. The sync manager immediately pushes queued sales to `/api/sales/sync`, clears the IndexedDB queue, and the indicator displays **Synced**.
10. Open an Admin or Developer dashboard in another window to see the transactions appear in the live ledger without manual refresh!

---

## 📄 License & Attribution

Built for **Enactus VIPS-TC** (Vivekananda Institute of Professional Studies - Technical Campus).
All rights reserved &copy; 2026 Enactus VIPS-TC.
