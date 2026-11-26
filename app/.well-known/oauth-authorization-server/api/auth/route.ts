// OAuth authorization server metadata for MCP clients (lib/mcp/well-known.ts). The issuer is <BETTER_AUTH_URL>/api/auth,
// so RFC 8414 puts it at this path; the root path is there for clients that don't insert the issuer's path.
import { authServerMetadata } from '@/lib/mcp/well-known';

export const GET = authServerMetadata;
