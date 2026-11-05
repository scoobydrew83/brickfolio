// OpenAPI 3.1 description of the REST API, for API clients and code generators (e.g. a future mobile app).
import { APP_NAME } from '@/lib/brand';

const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const ok = (schema: object, description = 'OK') => ({ description, content: { 'application/json': { schema } } });
const err = { description: 'Error', content: { 'application/json': { schema: ref('Error') } } };
const setNo = { name: 'setNo', in: 'path', required: true, schema: { type: 'string', example: '10280-1' } };
const nullable = (type: string) => ({ type: [type, 'null'] });
const copyQ = { name: 'copy', in: 'query', required: false, schema: { type: 'integer' }, description: 'Copy id. Defaults to the only copy, the only Partial copy, or the first; required for a PUT when that is ambiguous.' };
const money = { ...nullable('number'), minimum: 0, maximum: 1_000_000 };
const date = { ...nullable('string'), format: 'date' };

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
          id: { type: 'integer' }, setNo: { type: 'string' }, name: { type: 'string' }, qty: { type: 'integer', description: 'Copies that are not parted out' },
          location: { ...nullable('string'), description: 'Shared by every copy, else null (see mixed)' }, condition: { enum: ['New', 'Used', 'Partial', null], description: 'Shared by every copy, else null' }, registered: nullable('string'),
          missingPct: { ...nullable('number'), description: 'Shared by every copy, else null' }, notes: nullable('string'), blName: nullable('string'), year: nullable('integer'),
          categoryId: nullable('integer'), imageUrl: nullable('string'), pieces: nullable('integer'), partLots: nullable('integer'),
          avgSold: nullable('number'), minSold: nullable('number'), maxSold: nullable('number'), qtySold: nullable('integer'),
          estValue: { ...nullable('number'), description: 'Per copy: valueTotal ÷ qty' },
          copies: { type: 'array', items: ref('Copy') }, mixed: { type: 'object', properties: { condition: { type: 'boolean' }, location: { type: 'boolean' } } },
          valueTotal: { ...nullable('number'), description: 'Est. Value of every copy that is not parted out' },
          costBasis: { ...nullable('number'), description: 'Sum over copies with a cost' }, costCovered: { type: 'integer' }, gain: { ...nullable('number'), description: 'Value − cost basis, over the copies with a cost' }, partedOut: { type: 'integer' },
          blError: nullable('string'), lastUpdated: nullable('string'),
          theme: { ...nullable('string'), description: 'Top-level Rebrickable theme (needs REBRICKABLE_API_KEY)' },
          subtheme: nullable('string'), minifigs: nullable('integer'), hasModel: { type: 'boolean' }, missingMarked: { type: 'integer' },
        },
      },
      SetInput: {
        type: 'object',
        properties: {
          name: { type: 'string', maxLength: 120 }, condition: { enum: ['New', 'Used', 'Partial'] }, location: nullable('string'),
          registered: { enum: ['Y', 'No QR', null] }, missingPct: { ...nullable('number'), minimum: 0, maximum: 100 },
          qty: { type: 'integer', minimum: 1, maximum: 999 }, notes: nullable('string'),
          status: { enum: ['sealed', 'built', 'in_progress', 'parted_out'] }, acquiredDate: date, buildDate: date, pricePaid: money, tax: money, shipping: money, gwp: { type: 'boolean' }, copyNotes: nullable('string'),
        },
        description: 'Condition, location and Missing % apply to the copies: on add, to the new copies; on PATCH, to the only copy (409 with several). qty adds or removes copies. Copy fields (status, dates, cost, gwp, copyNotes) go on new copies.',
      },
      Copy: {
        type: 'object',
        properties: {
          id: { type: 'integer' }, setId: { type: 'integer' }, collectionId: nullable('integer'), status: { enum: ['sealed', 'built', 'in_progress', 'parted_out'] },
          condition: { enum: ['New', 'Used', 'Partial'] }, missingPct: nullable('number'), location: nullable('string'), acquiredDate: date, buildDate: date,
          pricePaid: nullable('number'), tax: nullable('number'), shipping: nullable('number'), gwp: { type: 'boolean', description: 'Gift with purchase: cost basis 0' },
          estValue: nullable('number'), estGuide: { enum: ['N', 'U', null], description: "BrickLink guide the value came from; differs from the copy's own guide when priced from the other one" },
          notes: nullable('string'), missingMarked: { type: 'integer' },
        },
      },
      CopyInput: {
        type: 'object',
        description: 'Sealed means New (and cannot be Partial). gwp sets pricePaid to 0.',
        properties: {
          status: { enum: ['sealed', 'built', 'in_progress', 'parted_out'] }, condition: { enum: ['New', 'Used', 'Partial'] }, location: nullable('string'),
          missingPct: { ...nullable('number'), minimum: 0, maximum: 100 }, acquiredDate: date, buildDate: date, pricePaid: money, tax: money, shipping: money,
          gwp: { type: 'boolean' }, notes: nullable('string'),
        },
      },
      Sync: { type: ['object', 'null'], properties: { running: { type: 'boolean' }, startedAt: { type: 'string' }, finishedAt: nullable('string'), total: { type: 'integer' }, processed: { type: 'integer' }, errors: { type: 'integer' }, message: nullable('string') } },
      InventoryItem: { type: 'object', properties: { inventoryId: { type: 'integer' }, itemNo: { type: 'string' }, name: { type: 'string' }, type: { type: 'string' }, colorId: nullable('integer'), colorName: nullable('string'), qty: { type: 'integer' }, condition: { enum: ['N', 'U'] }, unitPrice: nullable('number'), description: nullable('string'), remarks: nullable('string') } },
      Order: { type: 'object', properties: { orderId: { type: 'integer' }, direction: { enum: ['in', 'out'], description: 'in = you sold, out = you bought' }, dateOrdered: nullable('string'), status: { type: 'string' }, counterparty: nullable('string'), items: nullable('integer'), lots: nullable('integer'), currency: nullable('string'), subtotal: nullable('number'), grandTotal: nullable('number') } },
      Part: { type: 'object', properties: { matchNo: { type: 'integer' }, partNo: { type: 'string' }, name: { type: 'string' }, type: { type: 'string' }, colorId: nullable('integer'), colorName: nullable('string'), rgb: nullable('string'), qty: { type: 'integer' }, extra: { type: 'integer' }, alternate: { type: 'boolean' }, counterpart: { type: 'boolean' } } },
      PriceObservation: {
        type: 'object',
        description: 'One price from one source on one day. Sources: bricklink, brickowl, brickeconomy, brickset, manual or retailer:<slug>.',
        properties: {
          id: { type: 'integer' }, itemKind: { type: 'string', enum: ['set', 'minifig'] }, itemId: { type: 'string', description: 'BrickLink number, e.g. 75192-1 or sw0001' },
          source: { type: 'string' }, type: { type: 'string', enum: ['sold_avg', 'asking', 'estimate', 'retail', 'offer'] }, condition: { type: 'string', enum: ['N', 'U'] },
          currency: { type: 'string', description: 'ISO 4217' }, amount: { type: 'number', nullable: true, description: 'null: the source answered with no sales' },
          low: { type: 'number', nullable: true }, high: { type: 'number', nullable: true }, sampleSize: { type: 'integer', nullable: true },
          observedOn: { type: 'string', format: 'date' }, observedAt: { type: 'string', format: 'date-time' }, url: { type: 'string', nullable: true }, sourceRef: { type: 'string', nullable: true },
        },
      },
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
      delete: { summary: 'Remove the newest copy (the set goes with its last one)', responses: { 200: ok({ type: 'object', properties: { remaining: { type: 'integer' } } }), 404: err } },
    },
    '/share-links': {
      get: { summary: 'List read-only share links (never the link or its hash)', responses: { 200: ok({ type: 'object', properties: { shareLinks: { type: 'array', items: { type: 'object' } } } }) } },
      post: {
        summary: 'Create a read-only share link; the URL is returned once',
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['name'], properties: { name: { type: 'string', maxLength: 60 }, showValues: { type: 'boolean' }, showLocations: { type: 'boolean' }, showNotes: { type: 'boolean' }, showMinifigs: { type: 'boolean', default: true }, expires: { type: 'string', description: "'never', a number of days, or a date (YYYY-MM-DD), at most 5 years out" } } } } } },
        responses: { 201: ok({ type: 'object', properties: { id: { type: 'integer' }, url: { type: 'string' } } }, 'Created'), 400: err },
      },
    },
    '/share-links/{id}': { delete: { summary: 'Revoke a share link', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }], responses: { 200: ok({ type: 'object' }), 404: err } } },
    '/sets/{setNo}/copies': {
      parameters: [setNo],
      get: { summary: "The set's copies", responses: { 200: ok({ type: 'object', properties: { copies: { type: 'array', items: ref('Copy') } } }), 404: err } },
      post: { summary: 'Add a copy', requestBody: { required: true, content: { 'application/json': { schema: ref('CopyInput') } } }, responses: { 201: ok({ type: 'object', properties: { set: ref('Set'), copyId: { type: 'integer' } } }, 'Added'), 400: err, 404: err } },
    },
    '/sets/{setNo}/copies/{id}': {
      parameters: [setNo, { name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
      patch: { summary: 'Edit a copy', requestBody: { required: true, content: { 'application/json': { schema: ref('CopyInput') } } }, responses: { 200: ok({ type: 'object', properties: { set: ref('Set') } }), 400: err, 404: err } },
      delete: { summary: 'Remove a copy (the set goes with its last one)', responses: { 200: ok({ type: 'object', properties: { remaining: { type: 'integer' } } }), 404: err } },
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
    '/sets/{setNo}/missing': {
      parameters: [setNo, copyQ],
      get: { summary: 'Parts marked missing from a copy, with totals and the Missing % they give', responses: { 200: ok({ type: 'object' }), 404: err } },
      put: { summary: 'Replace the missing parts ({ items: [{ partNo, colorId, type, qty }] }); an empty list clears them', requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { items: { type: 'array', items: { type: 'object', properties: { partNo: { type: 'string' }, colorId: nullable('integer'), type: { type: 'string' }, qty: { type: 'integer' } } } } } } } } }, responses: { 200: ok({ type: 'object' }), 400: err, 404: err } },
    },
    '/sets/{setNo}/missing/wanted.xml': { parameters: [setNo, copyQ], get: { summary: "A copy's missing parts as a BrickLink Wanted List (XML)", responses: { 200: { description: 'Wanted List XML', content: { 'application/xml': {} } }, 404: err } } },
    '/ldraw/{path}': { get: { summary: 'A file from the LDraw parts library (for the 3D view)', parameters: [{ name: 'path', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'LDraw file', content: { 'text/plain': {} } }, 400: err, 404: err } } },
    '/images/{kind}/{no}': {
      get: {
        summary: "A set's or minifigure's photo from the image cache (fetched from its stored BrickLink or Rebrickable URL on first use)",
        parameters: [
          { name: 'kind', in: 'path', required: true, schema: { type: 'string', enum: ['set', 'minifig'] } },
          { name: 'no', in: 'path', required: true, schema: { type: 'string' }, description: 'Set number, or BrickLink / Rebrickable minifigure number' },
        ],
        responses: { 200: { description: 'The photo', content: { 'image/*': {} } }, 404: { description: 'Unknown item or no photo' }, 502: { description: 'The photo could not be fetched' } },
      },
    },
    '/sets/{setNo}/observations': {
      parameters: [setNo],
      get: {
        summary: 'Every stored price for a set from every source, newest first',
        parameters: [{ name: 'source', in: 'query', schema: { type: 'string' } }, { name: 'type', in: 'query', schema: { type: 'string', enum: ['sold_avg', 'asking', 'estimate', 'retail', 'offer'] } }],
        responses: { 200: ok({ type: 'object', properties: { observations: { type: 'array', items: ref('PriceObservation') } } }), 400: err, 404: err },
      },
    },
    '/minifigs/{figNo}/observations': {
      get: {
        summary: 'Every stored price for a minifigure, newest first',
        parameters: [{ name: 'figNo', in: 'path', required: true, schema: { type: 'string' } }, { name: 'source', in: 'query', schema: { type: 'string' } }, { name: 'type', in: 'query', schema: { type: 'string' } }],
        responses: { 200: ok({ type: 'object', properties: { observations: { type: 'array', items: ref('PriceObservation') } } }), 400: err, 404: err },
      },
    },
    '/settings/value-source': {
      get: { summary: 'The source Est. Value comes from, and the sources that can be chosen', responses: { 200: ok({ type: 'object', properties: { source: { type: 'string' }, options: { type: 'array', items: { type: 'string' } } } }) } },
      put: {
        summary: 'Choose the source Est. Value comes from; every set is re-valued',
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['source'], properties: { source: { type: 'string' } } } } } },
        responses: { 200: ok({ type: 'object', properties: { source: { type: 'string' } } }), 400: err },
      },
    },
    '/sets/{setNo}/prices': { parameters: [setNo], get: { summary: 'BrickLink sold prices per day (in the current currency)', responses: { 200: ok({ type: 'object' }), 404: err } } },
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
    '/sets/{setNo}/partout': {
      parameters: [setNo],
      get: { summary: 'Part-out value: the set sold as parts, from cached BrickLink part prices, next to its complete sold price. `coverage` = % of pieces with a price.', responses: { 200: ok({ type: 'object', properties: { partout: { type: 'object', properties: { value: { type: 'number' }, complete: nullable('number'), coverage: { type: 'number' }, lots: { type: 'integer' }, pricedLots: { type: 'integer' }, unpriced: { type: 'integer' }, currency: { type: 'string' } } } } }), 404: err } },
    },
    '/sets/bulk': {
      post: {
        summary: 'Add a pasted list of set numbers ("10497", "10497 x2") and BrickLink minifig numbers. Sets you have get more copies. Up to 10 new items are looked up now; more wait for the next sync.',
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['text'], properties: { text: { type: 'string', example: '10497\n21325 x2\nsw0001' }, location: { type: 'string' }, condition: { enum: ['New', 'Used', 'Partial'] } } } } } },
        responses: { 201: ok({ type: 'object', properties: { added: { type: 'integer' }, merged: { type: 'integer' }, waiting: { type: 'integer' }, figsAdded: { type: 'integer' }, figsMerged: { type: 'integer' }, invalid: { type: 'array', items: { type: 'string' } } } }, 'Added'), 400: err },
      },
    },
    '/barcodes': {
      get: { summary: 'Which barcode lookups are on (never the keys) and how many barcodes are saved, by source', responses: { 200: ok({ type: 'object', properties: { scanning: { type: 'boolean' }, brickset: { type: 'boolean' }, providers: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, name: { type: 'string' }, enabled: { type: 'boolean' } } } }, saved: { type: 'object' } } }) } },
    },
    '/barcodes/lookup': {
      post: {
        summary: 'Find the set for a box barcode (12-digit UPC or 13-digit EAN): saved barcodes first, then the configured providers in order. Two different sets come back as `ambiguous` to pick from. Errors carry a `code`: INVALID_BARCODE, UNSUPPORTED_FORMAT or RATE_LIMITED.',
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['barcode'], properties: { barcode: { type: 'string', example: '673419264150' }, format: { enum: ['UPC_A', 'EAN_13', 'EAN_8', 'UPC_E'] }, refresh: { type: 'boolean', description: 'Ask the providers again for a barcode that recently was not found' } } } } } },
        responses: {
          200: ok({
            type: 'object',
            properties: {
              status: { enum: ['matched', 'ambiguous', 'not_found'] },
              barcode: { type: 'object', properties: { raw: { type: 'string' }, format: { type: 'string' }, gtin: { type: 'string', description: 'Lookup form: UPC-A with a leading 0, EAN-13 as is' } } },
              candidates: { type: 'array', items: { type: 'object', properties: { setNo: { type: 'string' }, name: nullable('string'), year: nullable('integer'), pieces: nullable('integer'), imageUrl: nullable('string'), source: { enum: ['user', 'community', 'brickset', 'comparethebricks', 'brickeconomy'] }, verified: { type: 'boolean' }, owned: { type: ['object', 'null'], properties: { qty: { type: 'integer' } } }, wished: { type: 'boolean' } } } },
              providers: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, outcome: { type: 'string' }, message: { type: 'string' } } } },
              noProviders: { type: 'boolean' }, cachedMiss: { type: 'boolean' },
            },
          }),
          400: err, 429: err,
        },
      },
    },
    '/barcodes/mappings': {
      post: { summary: 'Save "this barcode is that set" as your own, confirmed barcode. It wins over provider answers on later scans.', requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['barcode', 'setNo'], properties: { barcode: { type: 'string' }, setNo: { type: 'string', example: '75192-1' }, format: { type: 'string' } } } } } }, responses: { 201: ok({ type: 'object', properties: { gtin: { type: 'string' }, setNo: { type: 'string' } } }, 'Saved'), 400: err } },
      delete: { summary: 'Forget a wrong barcode-to-set link (yours and any provider’s)', parameters: [{ name: 'barcode', in: 'query', required: true, schema: { type: 'string' } }, { name: 'setNo', in: 'query', required: true, schema: { type: 'string' } }], responses: { 200: ok({ type: 'object', properties: { removed: { type: 'integer' } } }), 400: err, 404: err } },
    },
    '/barcodes/minifig': {
      post: {
        summary: 'Find the figure for a Collectible Minifigures box code: the text of the square Data Matrix on the box (e.g. "6472866 444S3"). Your codes first, then the community list, then the bundled L-Scan table (fan-collected).',
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['code'], properties: { code: { type: 'string', example: '6472866 444S3' } } } } } },
        responses: { 200: ok({ type: 'object', properties: { status: { enum: ['matched', 'ambiguous', 'not_found'] }, code: { type: 'object' }, candidates: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, series: { type: 'string' }, rbFigNo: nullable('string'), source: { enum: ['user', 'community', 'lscan'] }, exact: { type: 'boolean' }, owned: { type: 'integer' } } } } } }), 400: err, 429: err },
      },
    },
    '/barcodes/export': {
      get: { summary: 'Your own confirmed barcodes and minifigure box codes in the community list format (CC0), for sharing. Codes and names only.', responses: { 200: ok({ type: 'object', properties: { license: { type: 'string' }, sets: { type: 'array', items: { type: 'object' } }, minifigs: { type: 'array', items: { type: 'object' } } } }) } },
    },
    '/barcodes/batch': {
      post: {
        summary: 'Add scanned sets to the collection (sets you own get more copies) or the wishlist, at most 200 at a time. Send an Idempotency-Key header: the same key again returns the first answer with `replayed: true` instead of adding twice.',
        parameters: [{ name: 'Idempotency-Key', in: 'header', required: true, schema: { type: 'string', maxLength: 100 } }],
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['items'], properties: { items: { type: 'array', maxItems: 200, items: { type: 'object', required: ['setNo'], properties: { setNo: { type: 'string' }, qty: { type: 'integer', minimum: 1, maximum: 999 }, target: { enum: ['collection', 'wishlist'] }, condition: { enum: ['New', 'Used', 'Partial'] }, location: nullable('string') } } } } } } } },
        responses: { 201: ok({ type: 'object', properties: { added: { type: 'integer' }, merged: { type: 'integer' }, wished: { type: 'integer' }, alreadyWished: { type: 'integer' }, waiting: { type: 'integer' }, replayed: { type: 'boolean' } } }, 'Added'), 400: err, 409: err },
      },
    },
    '/minifigs': {
      get: { summary: 'Minifigures you own as items of their own, with BrickLink sold prices and totals', responses: { 200: ok({ type: 'object', properties: { minifigs: { type: 'array', items: { type: 'object' } }, totals: { type: 'object' } } }) } },
      post: {
        summary: 'Add a minifigure by BrickLink number (sw0001) and price it. `merge: true` adds copies to one you already have instead of answering 409.',
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['figNo'], properties: { figNo: { type: 'string', example: 'sw0001' }, name: { type: 'string' }, condition: { enum: ['New', 'Used'] }, qty: { type: 'integer' }, location: { type: 'string' }, notes: { type: 'string' }, merge: { type: 'boolean' } } } } } },
        responses: { 201: ok({ type: 'object' }, 'Created'), 400: err, 409: err },
      },
    },
    '/minifigs/{figNo}': {
      parameters: [{ name: 'figNo', in: 'path', required: true, schema: { type: 'string', example: 'sw0001' }, description: 'BrickLink (sw0001) or Rebrickable (fig-000123) number' }],
      get: { summary: 'One minifigure', responses: { 200: ok({ type: 'object' }), 404: err } },
      patch: { summary: 'Change the given fields (a condition change re-prices it)', responses: { 200: ok({ type: 'object' }), 400: err, 404: err } },
      delete: { summary: 'Remove one copy (deletes the figure on the last one)', responses: { 200: ok({ type: 'object', properties: { remaining: { type: 'integer' } } }), 404: err } },
    },
    '/designer': {
      get: { summary: 'BrickLink Designer Program projects you follow, with the pre-order window (none, upcoming, open, closed) and whether you own or want the set', responses: { 200: ok({ type: 'object', properties: { projects: { type: 'array', items: { type: 'object' } } } }) } },
      post: {
        summary: 'Follow a Designer Program project',
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['name'], properties: { name: { type: 'string' }, setNo: { type: 'string', example: '910038' }, series: { type: 'string' }, designer: { type: 'string' }, stage: { enum: ['crowdfunding', 'selected', 'preorder', 'closed', 'not-made'] }, preorderStart: { type: 'string', format: 'date' }, preorderEnd: { type: 'string', format: 'date' }, price: { type: 'number' }, pieces: { type: 'integer' }, url: { type: 'string' }, notes: { type: 'string' }, watching: { type: 'boolean' } } } } } },
        responses: { 201: ok({ type: 'object' }, 'Created'), 400: err },
      },
    },
    '/designer/{id}': {
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
      patch: { summary: 'Change the given fields (new dates re-arm the alerts)', responses: { 200: ok({ type: 'object' }), 400: err, 404: err } },
      delete: { summary: 'Stop following a project', responses: { 200: ok({ type: 'object' }), 404: err } },
    },
    '/radar': {
      get: { summary: 'Retirement Radar: upcoming retirements by month (sets and wishes), retired sets you own with growth per year since retiring, and totals', responses: { 200: ok({ type: 'object', properties: { currency: { type: 'string' }, retiring: { type: 'array', items: { type: 'object' } }, retired: { type: 'array', items: { type: 'object' } }, totals: { type: 'object' } } }) } },
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
