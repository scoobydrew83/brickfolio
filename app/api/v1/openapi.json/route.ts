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
const layoutId = { name: 'id', in: 'path', required: true, schema: { type: 'integer' }, description: 'Layout id' };
const moduleId = { name: 'moduleId', in: 'path', required: true, schema: { type: 'integer' }, description: 'Module id (on this layout)' };
const mocNo = { name: 'mocNo', in: 'path', required: true, schema: { type: 'string', example: 'MOC-12345' } };
const KINDS = ['plain', 'road_straight', 'road_corner', 'road_t', 'road_cross', 'custom'];

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
      LotInput: {
        type: 'object',
        properties: {
          partNo: { type: 'string', example: '3001' }, colorId: { ...nullable('integer'), description: 'BrickLink colour' }, qty: { type: 'integer', minimum: 1 },
          type: { enum: ['PART', 'MINIFIG', 'GEAR', 'BOOK', 'CATALOG', 'INSTRUCTION', 'SET', 'ORIGINAL_BOX'] }, condition: { enum: ['N', 'U', null] },
          location: { ...nullable('string'), description: 'One of your locations' }, approximate: { type: 'boolean' }, name: nullable('string'), notes: nullable('string'),
        },
        description: 'partNo and qty are required to add; any subset to change.',
      },
      LayoutInput: {
        type: 'object',
        properties: { name: { type: 'string', maxLength: 80 }, cols: { type: 'integer', minimum: 1, maximum: 24 }, rows: { type: 'integer', minimum: 1, maximum: 24 }, notes: nullable('string') },
        description: 'name, cols and rows are required to create; any subset to change.',
      },
      LayoutSummary: { type: 'object', properties: { id: { type: 'integer' }, name: { type: 'string' }, cols: { type: 'integer' }, rows: { type: 'integer' }, notes: nullable('string'), modules: { type: 'integer' }, createdAt: { type: 'string' }, updatedAt: { type: 'string' } } },
      Layout: {
        type: 'object',
        properties: { id: { type: 'integer' }, name: { type: 'string' }, cols: { type: 'integer' }, rows: { type: 'integer' }, notes: nullable('string'), modules: { type: 'array', items: ref('LayoutModule') }, createdAt: { type: 'string' }, updatedAt: { type: 'string' } },
      },
      ModuleInput: {
        type: 'object',
        properties: {
          x: { type: 'integer', minimum: 0, maximum: 23, description: 'Top-left column, 0-based' }, y: { type: 'integer', minimum: 0, maximum: 23, description: 'Top-left row, 0-based' },
          w: { type: 'integer', minimum: 1, maximum: 2 }, h: { type: 'integer', minimum: 1, maximum: 2 }, rotation: { enum: [0, 90, 180, 270], description: '90 and 270 swap the footprint\'s w and h' },
          kind: { enum: KINDS }, name: { ...nullable('string'), maxLength: 60 }, notes: nullable('string'),
        },
      },
      LayoutModule: {
        type: 'object',
        properties: {
          id: { type: 'integer' }, x: { type: 'integer' }, y: { type: 'integer' }, w: { type: 'integer' }, h: { type: 'integer' }, rotation: { enum: [0, 90, 180, 270] }, kind: { enum: KINDS },
          name: nullable('string'), notes: nullable('string'),
          items: { type: 'array', items: { type: 'object', properties: { kind: { enum: ['copy', 'build'] }, refId: { type: 'integer', description: 'Set copy id or build id' }, name: { type: 'string' }, imageUrl: nullable('string'), setNo: { type: 'string' }, detail: { type: 'string' }, url: nullable('string') } } },
        },
      },
      LayoutNeeds: {
        type: 'object',
        properties: {
          lines: { type: 'array', items: { type: 'object', properties: { type: { type: 'string' }, partNo: { type: 'string' }, colorId: nullable('integer'), name: { type: 'string' }, colorName: nullable('string'), rgb: nullable('string'), need: { type: 'integer' }, inLots: { type: 'integer', description: 'Free loose parts that could cover it' }, toBuy: { type: 'integer' }, modules: { type: 'array', items: { type: 'integer' } } } } },
          totals: { type: 'object', properties: { needLots: { type: 'integer' }, needPieces: { type: 'integer' }, inLots: { type: 'integer' }, toBuyLots: { type: 'integer' }, toBuyPieces: { type: 'integer' } } },
          unmapped: { type: 'integer', description: 'Build lines without BrickLink numbers, left out' }, builds: { type: 'integer' }, copies: { type: 'integer' },
          buildsWithoutParts: { type: 'integer' }, modules: { type: 'object', additionalProperties: { type: 'integer' }, description: 'Pieces to buy per module id' },
        },
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
      ConditionGap: {
        type: 'object', nullable: true,
        description: 'BrickLink new vs. used sold averages. Null unless both have sales, in one currency, priced within 30 days of each other.',
        properties: { n: { type: 'number' }, u: { type: 'number' }, diff: { type: 'number' }, pct: { type: 'number', description: 'How much more new sells for, in %' }, nDate: { type: 'string', format: 'date' }, uDate: { type: 'string', format: 'date' }, nSample: nullable('integer'), uSample: nullable('integer') },
      },
      PriceObservationInput: {
        type: 'object', required: ['id', 'source', 'currency', 'amount'],
        properties: {
          kind: { enum: ['set', 'minifig'], default: 'set' }, id: { type: 'string', description: '75192, 75192-1, a box barcode, or an id in `scheme`' },
          scheme: { enum: ['bricklink', 'lego', 'gtin', 'brickset', 'rebrickable'] }, source: { type: 'string', description: 'retailer:<name> or manual' },
          type: { enum: ['offer', 'retail'], default: 'offer' }, condition: { enum: ['N', 'U'], default: 'N' }, currency: { type: 'string', pattern: '^[A-Za-z]{3}$' },
          amount: { type: 'number', exclusiveMinimum: 0, maximum: 1000000 }, url: { type: 'string', description: 'https, at most 500 characters' },
          observedAt: { type: 'string', format: 'date-time', description: 'Not in the future, at most 30 days old; default now' }, sampleSize: { type: 'integer' }, sourceRef: { type: 'string' },
        },
      },
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
      get: { summary: 'Get one set, with BrickLink\'s new vs. used gap', responses: { 200: ok({ type: 'object', properties: { set: ref('Set'), gap: ref('ConditionGap') } }), 404: err } },
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
    '/version': {
      get: {
        summary: 'The running version and, unless UPDATE_CHECK=off, the latest release on GitHub (checked at most once a day)',
        responses: { 200: ok({ type: 'object', properties: { current: { type: 'string' }, enabled: { type: 'boolean' }, latest: nullable('string'), updateAvailable: { type: 'boolean' }, url: nullable('string'), checkedAt: nullable('string'), error: nullable('string') } }) },
      },
    },
    '/prices': {
      post: {
        summary: 'Post retailer offers (or retail prices) found by your own flows, at most 200. Wishlist alerts follow when an offer is at or under target. Sources bricklink, brickowl, brickeconomy and brickset are refused. Send an Idempotency-Key header: the same key again returns the first answer with `replayed: true`.',
        parameters: [{ name: 'Idempotency-Key', in: 'header', required: true, schema: { type: 'string', maxLength: 100 } }],
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['observations'], properties: { observations: { type: 'array', maxItems: 200, items: ref('PriceObservationInput') } } } } } },
        responses: { 201: ok({ type: 'object', properties: { saved: { type: 'integer' }, unresolved: { type: 'array', items: { type: 'object', properties: { index: { type: 'integer' }, id: { type: 'string' } } } }, replayed: { type: 'boolean' } } }, 'Saved'), 400: err, 409: err },
      },
      get: {
        summary: 'Stored prices for one item, newest first',
        parameters: [
          { name: 'id', in: 'query', required: true, schema: { type: 'string' } }, { name: 'kind', in: 'query', schema: { enum: ['set', 'minifig'] } },
          { name: 'type', in: 'query', schema: { enum: ['sold_avg', 'asking', 'estimate', 'retail', 'offer'] } }, { name: 'source', in: 'query', schema: { type: 'string' } },
          { name: 'days', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 365, default: 14 } },
        ],
        responses: { 200: ok({ type: 'object', properties: { observations: { type: 'array', items: ref('PriceObservation') } } }), 400: err },
      },
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
    '/builds': {
      get: { summary: 'Builds (alternates of your sets, Rebrickable MOCs, your own) and how much of each you can make from set parts, free loose parts and loose parts reserved for it', parameters: [{ name: 'set', in: 'query', schema: { type: 'string' } }, { name: 'kind', in: 'query', schema: { enum: ['alternate', 'moc', 'custom'] } }], responses: { 200: ok({ type: 'object', properties: { builds: { type: 'array', items: { type: 'object' } } } }), 400: err } },
      post: { summary: "Add a Rebrickable MOC by number (its parts list comes with the next sync) or your own build", requestBody: { required: true, content: { 'application/json': { schema: { oneOf: [{ type: 'object', required: ['kind', 'mocNo'], properties: { kind: { const: 'moc' }, mocNo: { type: 'string', example: 'MOC-12345' }, name: { type: 'string' } } }, { type: 'object', required: ['kind', 'name'], properties: { kind: { const: 'custom' }, name: { type: 'string' } } }] } } } }, responses: { 201: ok({ type: 'object', properties: { mocNo: { type: 'string' } } }, 'Created'), 400: err, 404: err, 409: err } },
    },
    '/builds/{mocNo}': { delete: { summary: 'Remove a MOC or your own build, with its reservations. Alternates come from the sync and are refused (409).', parameters: [mocNo], responses: { 200: ok({ type: 'object' }), 404: err, 409: err } } },
    '/builds/{mocNo}/parts': { put: { summary: "Replace a MOC's or your own build's parts list", parameters: [mocNo], requestBody: { required: true, content: { 'application/xml': {}, 'text/csv': {} } }, responses: { 200: ok({ type: 'object', properties: { lines: { type: 'integer' }, pieces: { type: 'integer' }, unmapped: { type: 'integer' }, skipped: { type: 'integer' } } }), 400: err, 404: err, 409: err, 413: err, 415: err } } },
    '/builds/{mocNo}/reservations': {
      parameters: [mocNo],
      get: { summary: 'Loose parts reserved for the build, by lot', responses: { 200: ok({ type: 'object', properties: { reservations: { type: 'array', items: { type: 'object' } } } }), 404: err } },
      post: { summary: 'Set how many of a lot are reserved for the build (0 releases). Only parts the build uses; never more than the lot has free of other builds.', requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['lotId', 'qty'], properties: { lotId: { type: 'integer' }, qty: { type: 'integer', minimum: 0 } } } } } }, responses: { 200: ok({ type: 'object' }), 400: err, 404: err, 409: err } },
      delete: { summary: 'Release one lot, or everything reserved for the build', parameters: [{ name: 'lot', in: 'query', schema: { type: 'integer' } }], responses: { 200: ok({ type: 'object', properties: { pieces: { type: 'integer' } } }), 404: err } },
    },
    '/builds/{mocNo}/reservations/auto': { post: { summary: 'Reserve what the build still needs from free loose parts: exact counts first, then by location order, then the biggest lot', parameters: [mocNo], responses: { 200: ok({ type: 'object', properties: { reserved: { type: 'integer' }, pieces: { type: 'integer' }, short: { type: 'integer' } } }), 404: err } } },
    '/parts/lots': {
      get: { summary: 'Loose-part lots, with what is reserved on each', parameters: [{ name: 'q', in: 'query', schema: { type: 'string' } }, { name: 'location', in: 'query', schema: { type: 'string' }, description: '"-" for lots with no location' }, { name: 'limit', in: 'query', schema: { type: 'integer', maximum: 1000 } }, { name: 'offset', in: 'query', schema: { type: 'integer' } }], responses: { 200: ok({ type: 'object', properties: { lots: { type: 'array', items: { type: 'object' } }, total: { type: 'integer' }, pieces: { type: 'integer' } } }) } },
      post: { summary: 'Add a lot', requestBody: { required: true, content: { 'application/json': { schema: ref('LotInput') } } }, responses: { 201: ok({ type: 'object', properties: { id: { type: 'integer' } } }, 'Created'), 400: err } },
    },
    '/parts/lots/{id}': {
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
      patch: { summary: "Change a lot. Its qty can't go below what's reserved on it (409).", requestBody: { required: true, content: { 'application/json': { schema: ref('LotInput') } } }, responses: { 200: ok({ type: 'object' }), 400: err, 404: err, 409: err } },
      delete: { summary: 'Remove a lot. A reserved lot needs ?force=1, which releases its reservations.', parameters: [{ name: 'force', in: 'query', schema: { enum: ['1'] } }], responses: { 200: ok({ type: 'object' }), 404: err, 409: err } },
    },
    '/parts/lots/import': {
      post: {
        summary: 'Import BrickLink XML (Wanted List, inventory or Studio export) or a Rebrickable parts CSV into one location. A malformed file is refused whole.',
        parameters: [{ name: 'location', in: 'query', schema: { type: 'string' } }, { name: 'mode', in: 'query', schema: { enum: ['add', 'replace'], default: 'add' } }, { name: 'approximate', in: 'query', schema: { enum: ['1', '0'] } }],
        requestBody: { required: true, content: { 'application/xml': {}, 'text/csv': {} } },
        responses: { 201: ok({ type: 'object', properties: { batch: { type: 'string' }, lots: { type: 'integer' }, pieces: { type: 'integer' }, merged: { type: 'integer' }, unmapped: { type: 'integer' }, skipped: { type: 'integer' } } }, 'Imported'), 400: err, 409: err, 413: err, 415: err },
      },
    },
    '/parts/lots/import/{batch}': { delete: { summary: 'Undo an import', parameters: [{ name: 'batch', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: ok({ type: 'object', properties: { removed: { type: 'integer' }, restored: { type: 'integer' }, kept: { type: 'integer' } } }), 404: err, 409: err } } },
    '/layouts/{id}/reserve': { post: { summary: 'Reserve loose parts for every build on the layout', parameters: [layoutId], responses: { 200: ok({ type: 'object', properties: { builds: { type: 'integer' }, reserved: { type: 'integer' }, pieces: { type: 'integer' }, short: { type: 'integer' } } }), 404: err } } },
    '/builds/{mocNo}/wanted.xml': { get: { summary: 'Missing parts for a build as a BrickLink Wanted List', parameters: [{ name: 'mocNo', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'XML', content: { 'application/xml': {} } }, 404: err } } },
    '/layouts': {
      get: { summary: 'Your MILS layouts, with how many modules each has', responses: { 200: ok({ type: 'object', properties: { layouts: { type: 'array', items: ref('LayoutSummary') } } }) } },
      post: { summary: 'Create a layout: a grid of cols × rows modules of 32 × 32 studs', requestBody: { required: true, content: { 'application/json': { schema: ref('LayoutInput') } } }, responses: { 201: ok({ type: 'object', properties: { layout: ref('Layout') } }, 'Created'), 400: err } },
    },
    '/layouts/{id}': {
      parameters: [layoutId],
      get: { summary: 'A layout with its modules and the set copies and builds on each', responses: { 200: ok({ type: 'object', properties: { layout: ref('Layout') } }), 404: err } },
      patch: { summary: 'Rename or resize. A size that would cut off a module is refused.', requestBody: { required: true, content: { 'application/json': { schema: ref('LayoutInput') } } }, responses: { 200: ok({ type: 'object', properties: { layout: ref('Layout') } }), 400: err, 404: err, 409: err } },
      delete: { summary: 'Delete the layout with its modules and links. Set copies and builds stay.', responses: { 200: ok({ type: 'object' }), 404: err } },
    },
    '/layouts/{id}/modules': {
      parameters: [layoutId],
      post: { summary: 'Place a module on empty cells', requestBody: { required: true, content: { 'application/json': { schema: { ...ref('ModuleInput'), required: ['x', 'y'] } } } }, responses: { 201: ok({ type: 'object', properties: { module: ref('LayoutModule') } }, 'Created'), 400: err, 404: err, 409: { ...err, description: 'Overlaps another module or leaves the layout' } } },
    },
    '/layouts/{id}/modules/{moduleId}': {
      parameters: [layoutId, moduleId],
      patch: { summary: 'Move, turn, resize, retype or rename a module', requestBody: { required: true, content: { 'application/json': { schema: ref('ModuleInput') } } }, responses: { 200: ok({ type: 'object', properties: { module: ref('LayoutModule') } }), 400: err, 404: err, 409: err } },
      delete: { summary: 'Remove a module and its links', responses: { 200: ok({ type: 'object' }), 404: err } },
    },
    '/layouts/{id}/modules/{moduleId}/items': {
      parameters: [layoutId, moduleId],
      put: {
        summary: 'Replace the set copies and builds on a module. Each stands on one module at a time: one already on another is refused (409) with where it is.',
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', properties: { setCopyIds: { type: 'array', items: { type: 'integer' } }, buildIds: { type: 'array', items: { type: 'integer' } } } } } } },
        responses: { 200: ok({ type: 'object', properties: { module: ref('LayoutModule') } }), 400: err, 404: err, 409: err },
      },
    },
    '/layouts/{id}/needs': {
      parameters: [layoutId],
      get: {
        summary: "Every part the layout still needs, one line per part and colour: each build's parts list (parts in your sets are not taken off) plus parts marked missing from linked set copies",
        responses: { 200: ok(ref('LayoutNeeds')), 404: err },
      },
    },
    '/layouts/{id}/wanted.xml': { get: { summary: 'The parts to buy for a layout as a BrickLink Wanted List', parameters: [layoutId], responses: { 200: { description: 'XML', content: { 'application/xml': {} } }, 404: err } } },
    '/export.csv': { get: { summary: 'Export all sets as CSV', responses: { 200: { description: 'CSV', content: { 'text/csv': {} } } } } },
    '/import': { post: { summary: 'Import a Sets, History or Parts CSV', requestBody: { content: { 'text/csv': {} } }, responses: { 200: ok({ type: 'object', properties: { kind: { type: 'string' }, count: { type: 'integer' } } }), 400: err } } },
  },
};

export function GET() {
  return Response.json(spec);
}
