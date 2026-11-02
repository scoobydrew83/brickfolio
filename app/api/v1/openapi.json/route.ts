// OpenAPI 3.1 description of the REST API, for API clients and code generators (e.g. a future mobile app).
import { APP_NAME } from '@/lib/brand';

const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const ok = (schema: object, description = 'OK') => ({ description, content: { 'application/json': { schema } } });
const err = { description: 'Error', content: { 'application/json': { schema: ref('Error') } } };
const setNo = { name: 'setNo', in: 'path', required: true, schema: { type: 'string', example: '10280-1' } };
const nullable = (type: string) => ({ type: [type, 'null'] });

const spec = {
  openapi: '3.1.0',
  info: { title: `${APP_NAME} API`, version: '1.0.0', description: 'Create a token in Settings → API tokens and send it as `Authorization: Bearer <token>`. Send request bodies as `application/json` (import: `text/csv`); other types get 415.' },
  servers: [{ url: '/api/v1' }],
  security: [{ bearer: [] }],
  components: {
    securitySchemes: { bearer: { type: 'http', scheme: 'bearer' } },
    schemas: {
      Error: { type: 'object', properties: { error: { type: 'string' }, existing: { type: 'object', properties: { name: { type: 'string' }, qty: { type: 'integer' } } } } },
      Set: {
        type: 'object',
        properties: {
          id: { type: 'integer' }, setNo: { type: 'string' }, name: { type: 'string' }, qty: { type: 'integer' },
          location: nullable('string'), condition: { enum: ['New', 'Used', 'Partial', null] }, registered: nullable('string'),
          missingPct: nullable('number'), notes: nullable('string'), blName: nullable('string'), year: nullable('integer'),
          categoryId: nullable('integer'), imageUrl: nullable('string'), pieces: nullable('integer'), partLots: nullable('integer'),
          avgSold: nullable('number'), minSold: nullable('number'), maxSold: nullable('number'), qtySold: nullable('integer'),
          estValue: { ...nullable('number'), description: 'Per copy: avg sold for the condition, less Missing % on Partial sets' },
          blError: nullable('string'), lastUpdated: nullable('string'),
          theme: { ...nullable('string'), description: 'Top-level Rebrickable theme (needs REBRICKABLE_API_KEY)' },
          subtheme: nullable('string'), minifigs: nullable('integer'),
        },
      },
      SetInput: {
        type: 'object',
        properties: {
          name: { type: 'string', maxLength: 120 }, condition: { enum: ['New', 'Used', 'Partial'] }, location: nullable('string'),
          registered: { enum: ['Y', 'No QR', null] }, missingPct: { ...nullable('number'), minimum: 0, maximum: 100 },
          qty: { type: 'integer', minimum: 1, maximum: 999 }, notes: nullable('string'),
        },
      },
      Sync: { type: ['object', 'null'], properties: { running: { type: 'boolean' }, startedAt: { type: 'string' }, finishedAt: nullable('string'), total: { type: 'integer' }, processed: { type: 'integer' }, errors: { type: 'integer' }, message: nullable('string') } },
      InventoryItem: { type: 'object', properties: { inventoryId: { type: 'integer' }, itemNo: { type: 'string' }, name: { type: 'string' }, type: { type: 'string' }, colorId: nullable('integer'), colorName: nullable('string'), qty: { type: 'integer' }, condition: { enum: ['N', 'U'] }, unitPrice: nullable('number'), description: nullable('string'), remarks: nullable('string') } },
      Order: { type: 'object', properties: { orderId: { type: 'integer' }, direction: { enum: ['in', 'out'], description: 'in = you sold, out = you bought' }, dateOrdered: nullable('string'), status: { type: 'string' }, counterparty: nullable('string'), items: nullable('integer'), lots: nullable('integer'), currency: nullable('string'), subtotal: nullable('number'), grandTotal: nullable('number') } },
      Part: { type: 'object', properties: { matchNo: { type: 'integer' }, partNo: { type: 'string' }, name: { type: 'string' }, type: { type: 'string' }, colorId: nullable('integer'), colorName: nullable('string'), rgb: nullable('string'), qty: { type: 'integer' }, extra: { type: 'integer' }, alternate: { type: 'boolean' }, counterpart: { type: 'boolean' } } },
      History: { type: 'object', properties: { date: { type: 'string', format: 'date' }, sets: { type: 'integer' }, copies: { type: 'integer' }, estValue: { type: 'number' }, avgSold: { type: 'number' }, pieces: { type: 'integer' } } },
    },
  },
  paths: {
    '/sets': {
      get: { summary: 'List sets', responses: { 200: ok({ type: 'object', properties: { sets: { type: 'array', items: ref('Set') }, currency: { type: 'string' } } }), 401: err } },
      post: {
        summary: 'Add a set (looks it up on BrickLink)',
        requestBody: { required: true, content: { 'application/json': { schema: { allOf: [ref('SetInput'), { type: 'object', required: ['setNo', 'name', 'condition'], properties: { setNo: { type: 'string' }, another: { type: 'boolean', description: 'Add a copy if already in stock' } } }] } } } },
        responses: { 201: ok({ type: 'object', properties: { set: ref('Set') } }, 'Added'), 400: err, 409: err },
      },
    },
    '/sets/{setNo}': {
      parameters: [setNo],
      get: { summary: 'Get one set', responses: { 200: ok({ type: 'object', properties: { set: ref('Set') } }), 404: err } },
      patch: { summary: 'Edit a set', requestBody: { required: true, content: { 'application/json': { schema: ref('SetInput') } } }, responses: { 200: ok({ type: 'object', properties: { set: ref('Set') } }), 400: err, 404: err } },
      delete: { summary: 'Remove one copy', responses: { 200: ok({ type: 'object', properties: { remaining: { type: 'integer' } } }), 404: err } },
    },
    '/sets/{setNo}/lookup': { parameters: [setNo], post: { summary: 'Re-run the BrickLink lookup', responses: { 200: ok({ type: 'object', properties: { set: ref('Set') } }), 400: err, 404: err } } },
    '/sets/{setNo}/parts': { parameters: [setNo], get: { summary: "The set's parts list", responses: { 200: ok({ type: 'object', properties: { parts: { type: 'array', items: ref('Part') }, pieces: nullable('integer'), partLots: nullable('integer') } }), 404: err } } },
    '/sets/{setNo}/parts/refresh': { parameters: [setNo], post: { summary: 'Fetch the parts list from BrickLink again', responses: { 200: ok({ type: 'object', properties: { set: ref('Set') } }), 400: err, 404: err } } },
    '/parts': {
      get: {
        summary: 'Search parts across every set',
        parameters: [
          { name: 'q', in: 'query', schema: { type: 'string' }, description: 'Part #, name, color or set #' },
          { name: 'type', in: 'query', schema: { type: 'string' } },
          { name: 'limit', in: 'query', schema: { type: 'integer', maximum: 1000, default: 200 } },
          { name: 'offset', in: 'query', schema: { type: 'integer', default: 0 } },
        ],
        responses: { 200: ok({ type: 'object', properties: { parts: { type: 'array', items: { allOf: [ref('Part'), { type: 'object', properties: { setNo: { type: 'string' }, setName: { type: 'string' } } }] } }, total: { type: 'integer' } } }) },
      },
    },
    '/sets/{setNo}/model': {
      parameters: [setNo],
      get: { summary: "The set's LDraw model (text)", responses: { 200: { description: 'LDraw file', content: { 'text/plain': {} } }, 404: err } },
      put: { summary: 'Upload or replace the LDraw model (?name=file.mpd, body = file text, ≤ 2 MB)', requestBody: { content: { 'text/plain': {} } }, responses: { 200: ok({ type: 'object' }), 400: err, 404: err } },
      delete: { summary: 'Remove the model', responses: { 200: ok({ type: 'object' }), 404: err } },
    },
    '/ldraw/{path}': { get: { summary: 'A file from the LDraw parts library (for the 3D view)', parameters: [{ name: 'path', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'LDraw file', content: { 'text/plain': {} } }, 400: err, 404: err } } },
    '/sets/{setNo}/prices': { parameters: [setNo], get: { summary: 'Sold prices per day', responses: { 200: ok({ type: 'object' }), 404: err } } },
    '/sync': {
      get: { summary: 'Latest sync status', responses: { 200: ok({ type: 'object', properties: { sync: ref('Sync') } }) } },
      post: { summary: 'Start a full BrickLink sync (sets, then store inventory and orders)', responses: { 202: ok({ type: 'object', properties: { runId: { type: 'integer' } } }, 'Started'), 400: err, 409: err } },
    },
    '/history': { get: { summary: 'Collection totals per day', responses: { 200: ok({ type: 'object', properties: { history: { type: 'array', items: ref('History') } } }) } } },
    '/locations': {
      get: { summary: 'List locations', responses: { 200: ok({ type: 'object', properties: { locations: { type: 'array', items: { type: 'string' } } } }) } },
      post: { summary: 'Add a location', requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { name: { type: 'string' } } } } } }, responses: { 201: ok({ type: 'object' }), 409: err } },
    },
    '/store': { get: { summary: 'BrickLink store inventory (as of the last sync)', responses: { 200: ok({ type: 'object', properties: { items: { type: 'array', items: ref('InventoryItem') }, totals: { type: 'object' } } }) } } },
    '/orders': {
      get: {
        summary: 'BrickLink orders (as of the last sync)',
        parameters: [{ name: 'direction', in: 'query', schema: { enum: ['in', 'out'] } }],
        responses: { 200: ok({ type: 'object', properties: { orders: { type: 'array', items: ref('Order') }, totals: { type: 'object' } } }), 400: err },
      },
    },
    '/wishlist': {
      get: { summary: 'Your wishlist with targets and BrickLink sold prices', responses: { 200: ok({ type: 'object', properties: { wishlist: { type: 'array', items: { type: 'object' } } } }) } },
      post: { summary: 'Add a wish: { setNo, target?, condition?: New|Used, name?, notes? }', requestBody: { content: { 'application/json': {} } }, responses: { 201: ok({ type: 'object' }), 400: err, 409: err } },
    },
    '/wishlist/{setNo}': {
      parameters: [setNo],
      get: { summary: 'One wish', responses: { 200: ok({ type: 'object' }), 404: err } },
      patch: { summary: 'Change target, condition, name or notes', requestBody: { content: { 'application/json': {} } }, responses: { 200: ok({ type: 'object' }), 400: err, 404: err } },
      delete: { summary: 'Remove from the wishlist', responses: { 200: ok({ type: 'object' }), 404: err } },
    },
    '/builds': { get: { summary: 'Alternate builds of your sets (Rebrickable) and how much of each you can make', parameters: [{ name: 'set', in: 'query', schema: { type: 'string' } }], responses: { 200: ok({ type: 'object', properties: { builds: { type: 'array', items: { type: 'object' } } } }) } } },
    '/builds/{mocNo}/wanted.xml': { get: { summary: 'Missing parts for a build as a BrickLink Wanted List', parameters: [{ name: 'mocNo', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'XML', content: { 'application/xml': {} } }, 404: err } } },
    '/export.csv': { get: { summary: 'Export all sets as CSV', responses: { 200: { description: 'CSV', content: { 'text/csv': {} } } } } },
    '/import': { post: { summary: 'Import a Sets, History or Parts CSV', requestBody: { content: { 'text/csv': {} } }, responses: { 200: ok({ type: 'object', properties: { kind: { type: 'string' }, count: { type: 'integer' } } }), 400: err } } },
  },
};

export function GET() {
  return Response.json(spec);
}
