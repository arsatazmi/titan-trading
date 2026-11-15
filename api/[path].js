import { handler } from '../server.mjs';

// One-segment API route. Every Titan Vault endpoint is flat (/api/<name>) so
// Vercel's filesystem routing resolves it deterministically without rewrites.
export default function entrypoint(req, res) {
  return handler(req, res);
}
