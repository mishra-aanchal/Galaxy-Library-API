/**
 * Galaxy Digital Library API — Main Server
 * =========================================
 * Multi-protocol backend designed for Postman v12 testing.
 *
 * Protocols:  REST (Express on port 3000) + gRPC (port 50051)
 * Auth:       x-api-key header  |  Bearer token
 * Debug Bug:  PUT /api/books/:id/metadata requires X-Library-Source header (not in spec!)
 * Perf Test:  GET /api/search has simulated latency
 *
 * Usage:
 *   npm install
 *   node index.js
 */

'use strict';

const express    = require('express');
const cors       = require('cors');
const { v4: uuidv4 } = require('uuid');
const path       = require('path');
const grpc       = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');

// ── Configuration ──────────────────────────────────────────────────────────────
const REST_PORT  = process.env.PORT      || 3000;
const GRPC_PORT  = process.env.GRPC_PORT || 50051;
const API_KEY    = process.env.VALID_API_KEY || 'GALAXY-API-KEY-2024-SUPERSECRET';
const TOKENS     = (process.env.VALID_TOKENS ||
  'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.GalaxyToken1,GalaxyBearerToken-Dune-2024')
  .split(',').map(t => t.trim());

// ── In-Memory Data Store ───────────────────────────────────────────────────────
const { authors: seedAuthors, books: seedBooks } = require('./data/seed.js');

const db = {
  books:   [...seedBooks],
  authors: [...seedAuthors],
  loans:   [],
};

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 1 — REST API (Express)
// ═══════════════════════════════════════════════════════════════════════════════

const app = express();
app.use(cors());
app.use(express.json());

// ── Request Logger ─────────────────────────────────────────────────────────────
app.use((req, _res, next) => {
  console.log(`[REST] ${new Date().toISOString()} ${req.method} ${req.originalUrl}`);
  next();
});

// ── Auth Middleware: API Key ───────────────────────────────────────────────────
function requireApiKey(req, res, next) {
  const key = req.headers['x-api-key'];
  if (!key || key !== API_KEY) {
    return res.status(401).json({
      error: 'UNAUTHORIZED',
      message: 'A valid x-api-key header is required. Store it in Postman Local Vault.',
      statusCode: 401,
    });
  }
  next();
}

// ── Auth Middleware: Bearer Token ──────────────────────────────────────────────
function requireBearer(req, res, next) {
  const authHeader = req.headers['authorization'] || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token || !TOKENS.includes(token)) {
    return res.status(401).json({
      error: 'UNAUTHORIZED',
      message: 'A valid Bearer token is required. Store it in Postman Local Vault.',
      statusCode: 401,
    });
  }
  next();
}

// ── Pagination Helper ──────────────────────────────────────────────────────────
function paginate(array, page = 1, limit = 10) {
  const p = Math.max(1, parseInt(page, 10));
  const l = Math.min(100, Math.max(1, parseInt(limit, 10)));
  const start = (p - 1) * l;
  return {
    data: array.slice(start, start + l),
    pagination: {
      page: p,
      limit: l,
      total: array.length,
      totalPages: Math.ceil(array.length / l),
    },
  };
}

// ═══════════════════════════════════════
// HEALTH
// ═══════════════════════════════════════
app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    version: '1.0.0',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    services: {
      rest: `http://localhost:${REST_PORT}`,
      grpc: `localhost:${GRPC_PORT}`,
    },
    store: {
      books:   db.books.length,
      authors: db.authors.length,
      loans:   db.loans.length,
    },
  });
});

// ═══════════════════════════════════════
// BOOKS
// ═══════════════════════════════════════

// GET /api/books — List with filters
app.get('/api/books', requireApiKey, (req, res) => {
  const { genre, available, page, limit, language, minRating } = req.query;
  let results = [...db.books];

  if (genre)     results = results.filter(b => b.genre.includes(genre));
  if (available !== undefined) {
    const avail = available === 'true' || available === '1';
    results = results.filter(b => b.available === avail);
  }
  if (language)  results = results.filter(b => b.language === language);
  if (minRating) results = results.filter(b => b.rating >= parseFloat(minRating));

  res.json(paginate(results, page, limit));
});

// POST /api/books — Create
app.post('/api/books', requireApiKey, (req, res) => {
  const { title, isbn, genre, publishedYear, available, language, rating, authorIds, metadata } = req.body;
  if (!title || !isbn || !genre || !publishedYear) {
    return res.status(400).json({
      error: 'BAD_REQUEST',
      message: 'title, isbn, genre, and publishedYear are required.',
      statusCode: 400,
    });
  }
  const resolvedAuthors = (authorIds || []).map(id => {
    const a = db.authors.find(au => au.id === id);
    return a ? { id: a.id, name: a.name } : null;
  }).filter(Boolean);

  const book = {
    id: uuidv4(),
    title, isbn, genre,
    available: available !== undefined ? available : true,
    publishedYear,
    language: language || 'en',
    rating: rating || null,
    authors: resolvedAuthors,
    metadata: metadata || {},
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  db.books.push(book);
  res.status(201).json(book);
});

// GET /api/books/:id
app.get('/api/books/:id', requireApiKey, (req, res) => {
  const book = db.books.find(b => b.id === req.params.id);
  if (!book) return res.status(404).json({ error: 'NOT_FOUND', message: 'Book not found.', statusCode: 404 });
  res.json(book);
});

// PUT /api/books/:id — Full update
app.put('/api/books/:id', requireApiKey, (req, res) => {
  const idx = db.books.findIndex(b => b.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'NOT_FOUND', message: 'Book not found.', statusCode: 404 });

  const { title, isbn, genre, publishedYear, available, language, rating, authorIds, metadata } = req.body;
  if (!title || !isbn || !genre || !publishedYear) {
    return res.status(400).json({ error: 'BAD_REQUEST', message: 'title, isbn, genre, and publishedYear are required.', statusCode: 400 });
  }
  const resolvedAuthors = (authorIds || []).map(id => {
    const a = db.authors.find(au => au.id === id);
    return a ? { id: a.id, name: a.name } : null;
  }).filter(Boolean);

  db.books[idx] = {
    ...db.books[idx],
    title, isbn, genre,
    available: available !== undefined ? available : db.books[idx].available,
    publishedYear, language: language || db.books[idx].language,
    rating: rating !== undefined ? rating : db.books[idx].rating,
    authors: resolvedAuthors.length ? resolvedAuthors : db.books[idx].authors,
    metadata: metadata || db.books[idx].metadata,
    updatedAt: new Date().toISOString(),
  };
  res.json(db.books[idx]);
});

// DELETE /api/books/:id
app.delete('/api/books/:id', requireApiKey, (req, res) => {
  const idx = db.books.findIndex(b => b.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'NOT_FOUND', message: 'Book not found.', statusCode: 404 });
  db.books.splice(idx, 1);
  res.status(204).send();
});

// ── ⚠️  INTENTIONAL BUG ENDPOINT ──────────────────────────────────────────────
// PUT /api/books/:id/metadata
// This endpoint intentionally requires a secret header NOT documented in the
// OpenAPI spec: X-Library-Source: GALAXY-MAIN-CATALOG
// This is the ideal Agent Mode AI Debugging scenario for Postman v12.
// ── ⚠️  ─────────────────────────────────────────────────────────────────────
app.put('/api/books/:id/metadata', requireApiKey, (req, res) => {
  const book = db.books.find(b => b.id === req.params.id);
  if (!book) return res.status(404).json({ error: 'NOT_FOUND', message: 'Book not found.', statusCode: 404 });

  // 🐛 THE BUG: This undocumented header check is NOT in openapi.yaml
  const librarySource = req.headers['x-library-source'];
  if (!librarySource || librarySource !== 'GALAXY-MAIN-CATALOG') {
    return res.status(400).json({
      error: 'MISSING_HEADER',
      // Deliberately vague message — forces the developer to debug!
      message: 'Metadata update failed due to a configuration issue. Check request headers.',
      statusCode: 400,
      hint: 'The system requires additional provenance information to validate metadata changes.',
    });
  }

  const { coverUrl, fileSize, fileFormat, synopsis, tags } = req.body;
  book.metadata = {
    ...book.metadata,
    ...(coverUrl    !== undefined && { coverUrl }),
    ...(fileSize    !== undefined && { fileSize }),
    ...(fileFormat  !== undefined && { fileFormat }),
    ...(synopsis    !== undefined && { synopsis }),
    ...(tags        !== undefined && { tags }),
  };
  book.updatedAt = new Date().toISOString();
  res.json(book);
});

// ═══════════════════════════════════════
// AUTHORS
// ═══════════════════════════════════════

app.get('/api/authors', requireApiKey, (req, res) => {
  const { page, limit } = req.query;
  res.json(paginate(db.authors, page, limit));
});

app.post('/api/authors', requireApiKey, (req, res) => {
  const { name, bio, birthYear, nationality } = req.body;
  if (!name) return res.status(400).json({ error: 'BAD_REQUEST', message: 'name is required.', statusCode: 400 });
  const author = {
    id: uuidv4(),
    name,
    bio: bio || '',
    birthYear: birthYear || null,
    nationality: nationality || null,
    books: [],
    createdAt: new Date().toISOString(),
  };
  db.authors.push(author);
  res.status(201).json(author);
});

app.get('/api/authors/:id', requireApiKey, (req, res) => {
  const author = db.authors.find(a => a.id === req.params.id);
  if (!author) return res.status(404).json({ error: 'NOT_FOUND', message: 'Author not found.', statusCode: 404 });
  res.json(author);
});

app.put('/api/authors/:id', requireApiKey, (req, res) => {
  const idx = db.authors.findIndex(a => a.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'NOT_FOUND', message: 'Author not found.', statusCode: 404 });
  const { name, bio, birthYear, nationality } = req.body;
  if (!name) return res.status(400).json({ error: 'BAD_REQUEST', message: 'name is required.', statusCode: 400 });
  db.authors[idx] = { ...db.authors[idx], name, bio, birthYear, nationality };
  res.json(db.authors[idx]);
});

app.delete('/api/authors/:id', requireApiKey, (req, res) => {
  const idx = db.authors.findIndex(a => a.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'NOT_FOUND', message: 'Author not found.', statusCode: 404 });
  db.authors.splice(idx, 1);
  res.status(204).send();
});

// ═══════════════════════════════════════
// LOANS
// ═══════════════════════════════════════

app.get('/api/loans', requireBearer, (req, res) => {
  const { page, limit, status } = req.query;
  let results = [...db.loans];
  if (status) results = results.filter(l => l.status === status);
  res.json(paginate(results, page, limit));
});

app.post('/api/loans', requireBearer, (req, res) => {
  const { bookId, userId, dueDate } = req.body;
  if (!bookId || !userId || !dueDate) {
    return res.status(400).json({ error: 'BAD_REQUEST', message: 'bookId, userId, and dueDate are required.', statusCode: 400 });
  }
  const book = db.books.find(b => b.id === bookId);
  if (!book) return res.status(404).json({ error: 'NOT_FOUND', message: 'Book not found.', statusCode: 404 });
  if (!book.available) {
    return res.status(409).json({ error: 'CONFLICT', message: `"${book.title}" is already on loan.`, statusCode: 409 });
  }
  const loan = {
    id: uuidv4(),
    bookId,
    userId,
    status: 'active',
    loanedAt: new Date().toISOString(),
    dueDate,
    returnedAt: null,
  };
  book.available = false;
  db.loans.push(loan);
  res.status(201).json(loan);
});

app.get('/api/loans/:id', requireBearer, (req, res) => {
  const loan = db.loans.find(l => l.id === req.params.id);
  if (!loan) return res.status(404).json({ error: 'NOT_FOUND', message: 'Loan not found.', statusCode: 404 });
  res.json(loan);
});

app.patch('/api/loans/:id', requireBearer, (req, res) => {
  const loan = db.loans.find(l => l.id === req.params.id);
  if (!loan) return res.status(404).json({ error: 'NOT_FOUND', message: 'Loan not found.', statusCode: 404 });
  if (loan.status === 'returned') {
    return res.status(400).json({ error: 'BAD_REQUEST', message: 'This loan has already been returned.', statusCode: 400 });
  }
  loan.status = 'returned';
  loan.returnedAt = new Date().toISOString();
  const book = db.books.find(b => b.id === loan.bookId);
  if (book) book.available = true;
  res.json(loan);
});

// ═══════════════════════════════════════
// SEARCH — with simulated latency
// ═══════════════════════════════════════
app.get('/api/search', requireApiKey, async (req, res) => {
  const { q, type = 'all', genre, available, page, limit } = req.query;
  if (!q) {
    return res.status(400).json({ error: 'BAD_REQUEST', message: 'Query parameter "q" is required.', statusCode: 400 });
  }

  // ⚡ Performance Testing: Simulate realistic search latency (150–600ms).
  // Under load this delay is cumulative — ideal for Postman Local Performance Testing.
  const startTime = Date.now();
  const simulatedDelay = Math.floor(Math.random() * 450) + 150; // 150–600ms
  await new Promise(resolve => setTimeout(resolve, simulatedDelay));

  const query = q.toLowerCase();
  let books = [];
  let foundAuthors = [];

  if (type === 'books' || type === 'all') {
    books = db.books.filter(b =>
      b.title.toLowerCase().includes(query)       ||
      b.isbn.includes(query)                       ||
      b.genre.some(g => g.toLowerCase().includes(query)) ||
      (b.metadata?.synopsis || '').toLowerCase().includes(query) ||
      (b.metadata?.tags || []).some(t => t.toLowerCase().includes(query))
    );
    if (genre)     books = books.filter(b => b.genre.includes(genre));
    if (available !== undefined) {
      const avail = available === 'true' || available === '1';
      books = books.filter(b => b.available === avail);
    }
  }

  if (type === 'authors' || type === 'all') {
    foundAuthors = db.authors.filter(a =>
      a.name.toLowerCase().includes(query) ||
      (a.bio || '').toLowerCase().includes(query)
    );
  }

  const paginatedBooks   = paginate(books, page, limit);
  const paginatedAuthors = paginate(foundAuthors, page, limit);

  res.json({
    query: q,
    books: paginatedBooks.data,
    authors: paginatedAuthors.data,
    pagination: paginatedBooks.pagination,
    latencyMs: Date.now() - startTime,
  });
});

// ═══════════════════════════════════════
// Start REST Server
// ═══════════════════════════════════════
app.listen(REST_PORT, () => {
  console.log('');
  console.log('  ✦ ✦ ✦  Galaxy Digital Library API  ✦ ✦ ✦');
  console.log('');
  console.log(`  REST  → http://localhost:${REST_PORT}`);
  console.log(`  gRPC  → localhost:${GRPC_PORT}`);
  console.log(`  Spec  → http://localhost:${REST_PORT}/health`);
  console.log('');
  console.log('  Postman v12 Local Vault Credentials:');
  console.log(`    x-api-key        : ${API_KEY}`);
  console.log(`    Bearer Token     : ${TOKENS[0]}`);
  console.log('');
  console.log('  ⚠ Debug Scenario: PUT /api/books/:id/metadata');
  console.log('    Add header → X-Library-Source: GALAXY-MAIN-CATALOG');
  console.log('');
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 2 — gRPC Server
// ═══════════════════════════════════════════════════════════════════════════════

const PROTO_PATH = path.join(__dirname, 'protos', 'library.proto');
const pkgDef = protoLoader.loadSync(PROTO_PATH, {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
});
const protoDescriptor = grpc.loadPackageDefinition(pkgDef);
const libraryProto = protoDescriptor.galaxy.library;

// ── gRPC Implementations ───────────────────────────────────────────────────────

/**
 * DownloadAsset — Server-side streaming
 * Simulates streaming a digital book asset in chunks.
 */
function downloadAsset(call) {
  const { book_id, type, chunk_size } = call.request;
  const book = db.books.find(b => b.id === book_id);

  if (!book) {
    call.emit('error', {
      code: grpc.status.NOT_FOUND,
      message: `Book with id "${book_id}" not found.`,
    });
    return;
  }

  const CHUNK_SIZE   = chunk_size > 0 ? chunk_size : 65536;
  const totalBytes   = book.metadata?.fileSize || 1048576; // fallback 1MB
  const totalChunks  = Math.ceil(totalBytes / CHUNK_SIZE);

  console.log(`[gRPC] DownloadAsset: ${book.title} | type=${type} | chunks=${totalChunks}`);

  let bytesSent = 0;

  // Stream chunks with a realistic interval
  let sequence = 0;
  const interval = setInterval(() => {
    if (sequence >= totalChunks || call.cancelled) {
      clearInterval(interval);
      return;
    }

    const chunkBytes = Math.min(CHUNK_SIZE, totalBytes - bytesSent);
    bytesSent += chunkBytes;

    // Simulate binary data (repeating pattern for demo)
    const data = Buffer.alloc(chunkBytes, sequence % 256);

    call.write({
      data,
      sequence,
      total_bytes:   totalBytes.toString(),
      bytes_sent:    bytesSent.toString(),
      checksum:      `md5-chunk-${sequence}`,
      is_last_chunk: sequence === totalChunks - 1,
    });

    if (sequence === totalChunks - 1) {
      clearInterval(interval);
      call.end();
      console.log(`[gRPC] DownloadAsset complete: ${book.title} (${bytesSent} bytes streamed)`);
    }

    sequence++;
  }, 50); // 50ms between chunks ~= 1.3MB/s throughput for testing
}

/**
 * GetAssetInfo — Unary RPC
 * Returns metadata about a book's digital asset.
 */
function getAssetInfo(call, callback) {
  const { book_id } = call.request;
  const book = db.books.find(b => b.id === book_id);

  if (!book) {
    return callback({
      code: grpc.status.NOT_FOUND,
      message: `Book with id "${book_id}" not found.`,
    });
  }

  callback(null, {
    book_id:     book.id,
    title:       book.title,
    type:        'FULL_MANUSCRIPT',
    file_size:   (book.metadata?.fileSize || 0).toString(),
    file_format: book.metadata?.fileFormat || 'epub',
    cover_url:   book.metadata?.coverUrl || '',
    checksum:    `md5-${book.id.replace(/-/g, '').slice(0, 16)}`,
    last_updated: Date.now().toString(),
  });
}

/**
 * StreamCatalogUpdates — Server-side streaming
 * Streams a live feed of catalog events (new books, availability changes, etc.)
 */
function streamCatalogUpdates(call) {
  const { genres } = call.request;
  console.log(`[gRPC] StreamCatalogUpdates: genres=${genres.join(',') || 'all'}`);

  let eventCount = 0;
  const MAX_EVENTS = 20;

  const events = db.books
    .filter(b => genres.length === 0 || b.genre.some(g => genres.includes(g)))
    .flatMap(b => [
      {
        event_type: 'BOOK_ADDED',
        book_id:    b.id,
        title:      b.title,
        timestamp:  b.createdAt,
        details:    `"${b.title}" was added to the Galaxy catalog.`,
      },
      {
        event_type: 'BOOK_AVAILABILITY',
        book_id:    b.id,
        title:      b.title,
        timestamp:  new Date().toISOString(),
        details:    `"${b.title}" is currently ${b.available ? 'available' : 'on loan'}.`,
      },
    ]);

  const interval = setInterval(() => {
    if (eventCount >= Math.min(events.length, MAX_EVENTS) || call.cancelled) {
      clearInterval(interval);
      call.end();
      return;
    }
    call.write(events[eventCount]);
    eventCount++;
  }, 200); // 200ms between events
}

// ── Start gRPC Server ─────────────────────────────────────────────────────────
const grpcServer = new grpc.Server();
grpcServer.addService(libraryProto.AssetDownload.service, {
  DownloadAsset: downloadAsset,
  GetAssetInfo:  getAssetInfo,
  StreamCatalogUpdates: streamCatalogUpdates,
});

grpcServer.bindAsync(
  `0.0.0.0:${GRPC_PORT}`,
  grpc.ServerCredentials.createInsecure(),
  (err, port) => {
    if (err) {
      console.error('[gRPC] Failed to start gRPC server:', err.message);
      return;
    }
    console.log(`  gRPC server listening on port ${port} (insecure — for local dev)`);
  }
);
