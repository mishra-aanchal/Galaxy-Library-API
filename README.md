# 🌌 Galaxy Digital Library API

A multi-protocol backend built to showcase **Postman v12** features including Local Vault, Git Versioning, AI-Assisted Debugging, and Local Performance Testing.

---

## Architecture

| Protocol | Port  | Purpose                              |
|----------|-------|--------------------------------------|
| REST     | 3000  | Books, Authors, Loans, Search (HTTP) |
| gRPC     | 50051 | Asset streaming (book covers, manuscripts) |

---

## Quick Start

### 1. Install dependencies
```bash
npm install
```

### 2. Configure environment
```bash
cp .env.example .env
# Edit .env if you want to change ports or credentials
```

### 3. Run the server
```bash
node index.js
# or for hot-reload:
npx nodemon index.js
```

You should see:
```
  ✦ ✦ ✦  Galaxy Digital Library API  ✦ ✦ ✦

  REST  → http://localhost:3000
  gRPC  → localhost:50051
  Spec  → http://localhost:3000/health

  Postman v12 Local Vault Credentials:
    x-api-key   : GALAXY-API-KEY-2024-SUPERSECRET
    Bearer Token: eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.GalaxyToken1
```

---

## Postman v12 Setup Guide

### 1. Import the OpenAPI Spec
- Open Postman → **Import** → select `openapi.yaml`
- Postman will auto-generate a Collection with all endpoints

### 2. Configure the Local Vault (Authentication)
Go to **Postman Vault** and add two secrets:
| Secret Name         | Value                                                        |
|---------------------|--------------------------------------------------------------|
| `galaxy_api_key`    | `GALAXY-API-KEY-2024-SUPERSECRET`                            |
| `galaxy_bearer_token` | `eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.GalaxyToken1`       |

Reference them in your requests as `{{vault:galaxy_api_key}}`.

### 3. Point the Local Mock / Workbench at the server
- Base URL: `http://localhost:3000`
- gRPC server address: `localhost:50051`
- Proto file: `protos/library.proto`

---

## REST API Reference

### Authentication
| Endpoint Group | Method       |
|---------------|--------------|
| Books, Authors, Search | `x-api-key: GALAXY-API-KEY-2024-SUPERSECRET` |
| Loans          | `Authorization: Bearer eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.GalaxyToken1` |

### Endpoints

```
GET    /health                        → Health check (no auth)

GET    /api/books                     → List books (genre, available, minRating, language)
POST   /api/books                     → Create a book
GET    /api/books/:id                 → Get book by ID
PUT    /api/books/:id                 → Update a book
DELETE /api/books/:id                 → Delete a book
PUT    /api/books/:id/metadata        → ⚠️  Update metadata (debug scenario)

GET    /api/authors                   → List authors
POST   /api/authors                   → Create an author
GET    /api/authors/:id               → Get author by ID
PUT    /api/authors/:id               → Update an author
DELETE /api/authors/:id               → Delete an author

GET    /api/loans                     → List loans (Bearer auth)
POST   /api/loans                     → Create a loan (Bearer auth)
GET    /api/loans/:id                 → Get loan by ID (Bearer auth)
PATCH  /api/loans/:id                 → Return a book (Bearer auth)

GET    /api/search?q=dune             → ⚡ Search (has simulated latency)
```

### Complex Query Examples
```
# Filter by genre + availability
GET /api/books?genre=sci-fi&available=true

# Filter by minimum rating
GET /api/books?genre=dystopian&minRating=4.5

# Paginate
GET /api/books?page=2&limit=5

# Full-text search
GET /api/search?q=hitchhiker&type=books&genre=comedy
```

---

## 🐛 Debug Scenario — For Postman AI Agent Mode

**Endpoint:** `PUT /api/books/:id/metadata`

This endpoint has an intentional bug: it requires a **non-spec header** that is not documented in `openapi.yaml`.

**What happens:**
```json
// Response when the header is missing (400):
{
  "error": "MISSING_HEADER",
  "message": "Metadata update failed due to a configuration issue. Check request headers.",
  "hint": "The system requires additional provenance information to validate metadata changes."
}
```

**The Fix:** Add the undocumented header:
```
X-Library-Source: GALAXY-MAIN-CATALOG
```

Use Postman's **Agent Mode** to debug this — ask it: *"Why is my metadata update returning 400?"*

---

## ⚡ Performance Testing — GET /api/search

The search endpoint has a simulated latency of **150–600ms** per request. Under concurrent load this compounds effectively.

**In Postman v12:**
1. Open the `GET /api/search` request
2. Go to **Performance** → set virtual users and duration
3. Watch how latency degrades under load

---

## gRPC Services

Server: `localhost:50051` | Proto: `protos/library.proto`

| Service                 | Type             | Description                         |
|------------------------|------------------|-------------------------------------|
| `DownloadAsset`        | Server-streaming | Stream book asset chunks            |
| `GetAssetInfo`         | Unary            | Get asset metadata                  |
| `StreamCatalogUpdates` | Server-streaming | Live catalog mutation events        |

**Example `DownloadAsset` request:**
```json
{
  "book_id": "b0000003-0000-0000-0000-000000000003",
  "type": "FULL_MANUSCRIPT",
  "chunk_size": 65536
}
```

---

## Git Setup

This project is repo-ready. To initialize:
```bash
cd "Galaxy Library API"
git init
git add .
git commit -m "feat: initial Galaxy Digital Library API"
```

Then connect to Postman's Native Git integration from the **Workbench → Version Control** panel.

---

## Project Structure

```
Galaxy Library API/
├── index.js              ← Main server (REST + gRPC)
├── openapi.yaml          ← OpenAPI 3.0 specification
├── package.json
├── .env.example          ← Copy to .env to configure
├── .gitignore
├── data/
│   └── seed.js           ← Interstellar seed data (10 books, 8 authors)
└── protos/
    └── library.proto     ← gRPC protobuf definition
```

---

## Seed Data

The following books are pre-loaded:

| Title                                  | Author            | Genre              |
|----------------------------------------|-------------------|--------------------|
| The Hitchhiker's Guide to the Galaxy   | Douglas Adams     | sci-fi, comedy     |
| The Restaurant at the End of the Universe | Douglas Adams  | sci-fi, comedy     |
| Dune                                   | Frank Herbert     | sci-fi, epic       |
| Foundation                             | Isaac Asimov      | sci-fi, epic       |
| I, Robot                               | Isaac Asimov      | sci-fi, AI         |
| 2001: A Space Odyssey                  | Arthur C. Clarke  | sci-fi             |
| The Left Hand of Darkness              | Ursula K. Le Guin | sci-fi, feminist   |
| Fahrenheit 451                         | Ray Bradbury      | sci-fi, dystopian  |
| The Martian                            | Andy Weir         | sci-fi, survival   |
| The Three-Body Problem                 | Liu Cixin         | sci-fi, hard-sci-fi|
