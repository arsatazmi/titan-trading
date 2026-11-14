import { handler } from '../server.mjs';

export default function entrypoint(req, res) {
  return handler(req, res);
}
