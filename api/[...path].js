import { handler } from '../server.mjs';

// Catch-all Serverless Function. Vercel keeps the original request path in
// req.url, so /api/state, /api/admin/users, etc. reach the same handler.
export default function entrypoint(req, res) {
  return handler(req, res);
}
