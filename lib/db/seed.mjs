// Demo data for screenshots, a public demo, or trying the app without BrickLink keys. Used by
// scripts/seed.mjs and, with DEMO_MODE=on, by the server on first start. Expects a migrated database.
// Prices are illustrative, not real BrickLink figures. Every set is marked "Demo data" in its notes.

/** Adds the demo sets, history, a parts list and a wishlist. Returns the number of sets afterwards. */
export function seedDemo(sqlite) {
  const DEMO = 'Demo data: prices are illustrative.';
  const day = (offset) => new Date(Date.now() - offset * 86_400_000).toLocaleDateString('en-CA');

  // [setNo, name, year, pieces, location, condition, missing %, qty, avg, min, max, qty sold]
  const SETS = [
    ['10497-1', 'Galaxy Explorer', 2022, 1254, 'Display', 'New', null, 1, 119.5, 99, 149, 22],
    ['10280-1', 'Flower Bouquet', 2021, 756, 'Display', 'New', null, 2, 59.99, 48, 72, 40],
    ['10305-1', "Lion Knights' Castle", 2022, 4514, 'Display', 'New', null, 1, 389, 360, 430, 9],
    ['21318-1', 'Tree House', 2019, 3036, 'Shelf', 'Used', 5, 1, 231.2, 190, 270, 15],
    ['75192-1', 'Millennium Falcon', 2017, 7541, 'Shelf', 'New', null, 1, 812.4, 720, 950, 9],
    ['71043-1', 'Hogwarts Castle', 2018, 6020, 'Shelf', 'Used', null, 1, 402.7, 360, 460, 7],
    ['10294-1', 'Titanic', 2021, 9090, 'Shelf', 'New', null, 1, 612, 560, 690, 11],
    ['21325-1', 'Medieval Blacksmith', 2021, 2164, 'Shelf', 'Used', null, 1, 205, 180, 240, 13],
    ['10270-1', 'Bookshop', 2020, 2504, 'Shelf', 'Used', null, 1, 214, 190, 250, 10],
    ['42115-1', 'Lamborghini Sián FKP 37', 2020, 3696, 'Sell', 'Used', null, 1, 289.9, 250, 330, 12],
    ['42143-1', 'Ferrari Daytona SP3', 2022, 3778, 'Sell', 'New', null, 1, 371, 340, 410, 8],
    ['10265-1', 'Ford Mustang', 2019, 1471, 'Storage', 'Partial', 15, 1, 88.4, 70, 110, 18],
    ['6080-1', "King's Castle", 1984, 673, 'Storage', 'Partial', 10, 1, 145.1, 120, 190, 6],
    ['6929-1', 'Starfleet Voyager', 1985, 213, 'Storage', 'Used', null, 1, 64, 50, 80, 14],
    ['10283-1', 'NASA Space Shuttle Discovery', 2021, 2354, 'Display', 'New', null, 1, 182, 165, 205, 19],
    ['31120-1', 'Medieval Castle', 2021, 1426, 'Storage', 'Used', null, 1, 92, 80, 110, 21],
    ['21330-1', 'Home Alone', 2021, 3955, 'Shelf', 'New', null, 1, 268, 245, 300, 6],
    ['76139-1', '1989 Batmobile', 2019, 3306, 'Shelf', 'Used', null, 1, 259, 230, 290, 9],
    ['10300-1', 'Back to the Future Time Machine', 2022, 1872, 'Display', 'New', null, 1, 171, 155, 190, 16],
    ['40516-1', 'Everyone Is Awesome', 2021, 346, 'Display', 'New', null, 3, 41, 35, 52, 30],
  ];

  const insertSet = sqlite.prepare(`INSERT INTO sets (set_no, name, location, condition, missing_pct, qty, notes, year, pieces, part_lots, avg_sold, min_sold, max_sold, qty_sold, est_value, last_updated)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(set_no) DO NOTHING`);
  const insertLocation = sqlite.prepare('INSERT INTO locations (name, sort) VALUES (?, ?) ON CONFLICT DO NOTHING');
  const insertSnap = sqlite.prepare(`INSERT INTO price_snapshots (set_id, date, guide, avg_sold, min_sold, max_sold, qty_sold) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(set_id, date) DO NOTHING`);
  const insertHistory = sqlite.prepare(`INSERT INTO history (date, sets, copies, est_value, avg_sold, pieces) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(date) DO NOTHING`);
  const insertColor = sqlite.prepare('INSERT INTO colors (id, name, rgb) VALUES (?, ?, ?) ON CONFLICT(id) DO NOTHING');
  const insertPart = sqlite.prepare(`INSERT INTO set_parts (set_id, match_no, part_no, name, type, color_id, qty, extra, alternate, counterpart)
    VALUES (?, 0, ?, ?, ?, ?, ?, ?, 0, 0)`);
  const insertWish = sqlite.prepare(`INSERT INTO wishlist (set_no, name, condition, target, year, avg_sold, min_sold, qty_sold, notes, last_updated)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(set_no) DO NOTHING`);

  // Same rule as the copies migration (drizzle/0019_copies_backfill.sql): New → sealed, the rest built.
  const addCopies = () => sqlite.prepare(`WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < (SELECT coalesce(max(qty), 1) FROM sets))
    INSERT INTO set_copies (set_id, status, condition, missing_pct, location, est_value, est_guide)
    SELECT s.id, CASE s.condition WHEN 'New' THEN 'sealed' ELSE 'built' END, coalesce(s.condition, 'Used'), s.missing_pct, s.location, s.est_value,
           CASE s.condition WHEN 'New' THEN 'N' ELSE 'U' END
    FROM sets s JOIN n ON n.i <= max(s.qty, 1) WHERE NOT EXISTS (SELECT 1 FROM set_copies c WHERE c.set_id = s.id) ORDER BY s.id, n.i`).run();

  sqlite.transaction(() => {
    ['Display', 'Shelf', 'Storage', 'Sell'].forEach((l, i) => insertLocation.run(l, i));

    let total = 0, avgTotal = 0, pieces = 0, copies = 0; // total is recomputed from the copies below
    for (const [no, name, year, pcs, loc, cond, missing, qty, avg, min, max, sold] of SETS) {
      const est = Math.round(avg * (1 - (missing ?? 0) / 100) * 100) / 100;
      insertSet.run(no, name, loc, cond, missing, qty, DEMO, year, pcs, null, avg, min, max, sold, est, new Date().toISOString());
      total += est * qty; avgTotal += avg * qty; pieces += pcs * qty; copies += qty;
      // Six weekly price snapshots drifting up to today's average.
      const id = sqlite.prepare('SELECT id FROM sets WHERE set_no = ?').get(no).id;
      for (let w = 5; w >= 0; w--) {
        const f = 1 - w * 0.025 + (w % 2) * 0.01;
        insertSnap.run(id, day(w * 7), cond === 'New' ? 'N' : 'U', Math.round(avg * f * 100) / 100, min, max, sold);
      }
    }

    // One copy per unit of qty, as the copies migration does; then a few copies made more interesting.
    addCopies();
    const copiesOf = (no) => sqlite.prepare('SELECT c.id FROM set_copies c JOIN sets s ON s.id = c.set_id WHERE s.set_no = ? ORDER BY c.id').all(no).map((r) => r.id);
    const setCopy = (id, fields) => {
      const keys = Object.keys(fields);
      sqlite.prepare(`UPDATE set_copies SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).run(...keys.map((k) => fields[k]), id);
    };
    // Flower Bouquet: one sealed, one built (valued from a recent used-price snapshot).
    const fb = copiesOf('10280-1');
    const fbId = sqlite.prepare("SELECT id FROM sets WHERE set_no = '10280-1'").get().id;
    insertSnap.run(fbId, day(3), 'U', 44.5, 36, 55, 25);
    setCopy(fb[0], { acquired_date: '2021-02-14', price_paid: 49.99, tax: 4.12, shipping: 0 });
    if (fb[1]) setCopy(fb[1], { status: 'built', condition: 'Used', est_value: 44.5, est_guide: 'U', acquired_date: '2021-06-01', build_date: '2021-06-02', price_paid: 44.99, tax: 3.71, shipping: 0, location: 'Shelf' });
    // Everyone Is Awesome: three copies, one a gift with purchase.
    const ea = copiesOf('40516-1');
    setCopy(ea[0], { acquired_date: '2021-06-01', price_paid: 34.99, tax: 2.89, shipping: 0 });
    setCopy(ea[1], { acquired_date: '2021-07-20', price_paid: 29.99, tax: 0, shipping: 4.99 });
    setCopy(ea[2], { acquired_date: '2021-11-26', gwp: 1, price_paid: 0, notes: 'Gift with purchase' });
    setCopy(copiesOf('75192-1')[0], { acquired_date: '2019-11-29', price_paid: 679.99, tax: 54.4, shipping: 0 });
    setCopy(copiesOf('10305-1')[0], { acquired_date: '2022-08-03', price_paid: 399.99, tax: 32.99, shipping: 0 });
    setCopy(copiesOf('21318-1')[0], { status: 'built', acquired_date: '2019-08-01', build_date: '2019-08-10', price_paid: 199.99, tax: 0, shipping: 0 });
    total = sqlite.prepare("SELECT coalesce(sum(est_value), 0) AS v FROM set_copies WHERE status <> 'parted_out'").get().v;

    // 30 days of collection totals, rising toward today's value with some noise.
    for (let d = 29; d >= 0; d--) {
      const f = 1 - d * 0.0015 + Math.sin(d) * 0.004;
      insertHistory.run(day(d), SETS.length, copies, Math.round(total * f * 100) / 100, Math.round(avgTotal * f * 100) / 100, pieces);
    }

    // A short parts list for Galaxy Explorer, so the parts views have something to show.
    [[11, 'Black', '212121'], [86, 'Light Bluish Gray', 'A0A5A9'], [7, 'Blue', '0055BF'], [3, 'Yellow', 'F2CD37'], [12, 'Trans-Clear', 'FCFCFC']]
      .forEach(([id, n, rgb]) => insertColor.run(id, n, rgb));
    const ge = sqlite.prepare("SELECT id FROM sets WHERE set_no = '10497-1'").get().id;
    sqlite.prepare('DELETE FROM set_parts WHERE set_id = ?').run(ge);
    [['3001', 'Brick 2 x 4', 'PART', 7, 6, 1], ['3023', 'Plate 1 x 2', 'PART', 86, 24, 2], ['3069b', 'Tile 1 x 2', 'PART', 11, 12, 1],
     ['3024', 'Plate 1 x 1', 'PART', 3, 16, 2], ['3065', 'Brick 1 x 2 without Bottom Tube', 'PART', 12, 8, 0], ['sp047', 'Classic Space Astronaut, Blue', 'MINIFIG', null, 1, 0]]
      .forEach(([p, n, t, c, q, e]) => insertPart.run(ge, p, n, t, c, q, e));
    sqlite.prepare("UPDATE sets SET part_lots = 6 WHERE id = ?").run(ge);

    // Themes as Rebrickable would fill them in, so the theme filter has something to show.
    const insertTheme = sqlite.prepare('INSERT INTO themes (id, parent_id, name) VALUES (?, ?, ?) ON CONFLICT(id) DO NOTHING');
    [[721, null, 'Icons'], [722, 721, 'Botanical Collection'], [724, 721, 'Modular Buildings'], [576, null, 'Ideas'], [158, null, 'Star Wars'],
     [171, 158, 'Ultimate Collector Series'], [246, null, 'Harry Potter'], [1, null, 'Technic'], [186, null, 'Castle'], [126, null, 'Space'],
     [672, null, 'Creator 3 in 1'], [695, null, 'DC Super Heroes']].forEach(([id, parent, name]) => insertTheme.run(id, parent, name));
    const themeOf = { '10497-1': 721, '10280-1': 722, '10305-1': 721, '21318-1': 576, '75192-1': 171, '71043-1': 246, '10294-1': 721,
      '21325-1': 576, '10270-1': 724, '42115-1': 1, '42143-1': 1, '10265-1': 721, '6080-1': 186, '6929-1': 126, '10283-1': 721,
      '31120-1': 672, '21330-1': 576, '76139-1': 695, '10300-1': 721, '40516-1': 721 };
    const setTheme = sqlite.prepare('UPDATE sets SET theme_id = ?, rb_synced_at = ? WHERE set_no = ? AND theme_id IS NULL');
    for (const [no, id] of Object.entries(themeOf)) setTheme.run(id, new Date().toISOString(), no);

    // Retail prices and retirement dates as Brickset would fill them in (illustrative), so the retail views have data.
    const inDays = (n) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
    const retail = {
      '10497-1': [99.99, inDays(70)], '10280-1': [49.99, inDays(400)], '10305-1': [399.99, inDays(120)], '21318-1': [199.99, '2021-12-31'],
      '75192-1': [799.99, inDays(800)], '71043-1': [399.99, inDays(500)], '10294-1': [629.99, '2024-12-31'], '21325-1': [179.99, '2023-12-31'],
      '10270-1': [179.99, '2023-12-31'], '42115-1': [379.99, '2022-12-31'], '42143-1': [399.99, '2024-12-31'], '10265-1': [149.99, '2021-12-31'],
      '10283-1': [199.99, '2024-12-31'], '31120-1': [99.99, '2022-12-31'], '21330-1': [249.99, '2023-07-31'], '76139-1': [249.99, '2021-12-31'],
      '10300-1': [169.99, '2024-12-31'], '40516-1': [34.99, '2022-12-31'],
    };
    const setRetail = sqlite.prepare('UPDATE sets SET retail_price = ?, retail_currency = ?, exit_date = ?, retired = ?, brickset_at = ? WHERE set_no = ? AND brickset_at IS NULL');
    const today = new Date().toISOString().slice(0, 10);
    for (const [no, [price, exit]] of Object.entries(retail)) setRetail.run(price, 'USD', exit, exit < today ? 1 : 0, new Date().toISOString(), no);

    const now = new Date().toISOString();
    insertWish.run('10316-1', 'Rivendell', 'New', 430, 2023, 418, 399, 14, DEMO, now);
    insertWish.run('10307-1', 'Eiffel Tower', 'New', 520, 2022, 579, 540, 7, DEMO, now);
    insertWish.run('75313-1', 'AT-AT', 'Used', 700, 2021, 784, 690, 5, DEMO, now);
    insertWish.run('10295-1', 'Porsche 911', 'Used', 120, 2021, 131, 115, 12, DEMO, now);
    const wishRetail = sqlite.prepare('UPDATE wishlist SET retail_price = ?, retail_currency = ?, exit_date = ?, retired = ?, brickset_at = ? WHERE set_no = ? AND brickset_at IS NULL');
    wishRetail.run(499.99, 'USD', inDays(90), 0, now, '10316-1');
    wishRetail.run(629.99, 'USD', inDays(300), 0, now, '10307-1');
    wishRetail.run(849.99, 'USD', '2023-12-31', 1, now, '75313-1');
    wishRetail.run(149.99, 'USD', '2023-12-31', 1, now, '10295-1');

    // A BrickLink Designer Program set (retired), so the Retirement Radar's flags have something to show.
    insertTheme.run(9001, null, 'BrickLink');
    insertTheme.run(9002, 9001, 'Designer Program Series 6');
    insertSet.run('910038-1', 'Lunar Research Base', 'Display', 'New', null, 1, DEMO, 2025, 2133, null, 389, 340, 450, 8, 389, now);
    sqlite.prepare("UPDATE sets SET theme_id = 9002, rb_synced_at = ?, retail_price = 269.99, retail_currency = 'USD', exit_date = ?, retired = 1, brickset_at = ? WHERE set_no = '910038-1'").run(now, '2025-09-30', now);
    addCopies();

    // Loose minifigures, and one Collectible Minifigures series cached as Rebrickable would return it.
    const insertFig = sqlite.prepare(`INSERT INTO minifigs (fig_no, rb_fig_no, name, qty, condition, location, notes, year, avg_sold, min_sold, max_sold, qty_sold, last_updated)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`);
    insertFig.run('sw0001a', null, 'Battle Droid', 4, 'Used', 'Storage', DEMO, 1999, 3.1, 1.5, 6, 120, now);
    insertFig.run('sp047', null, 'Classic Space Astronaut, Blue', 1, 'Used', 'Display', DEMO, 1984, 12.4, 8, 18, 40, now);
    insertFig.run('hp150', null, 'Harry Potter, Gryffindor Robe', 1, 'New', 'Display', DEMO, 2018, 9.8, 7, 14, 25, now);
    insertFig.run(null, 'fig-013520', 'Mermaid', 1, 'New', 'Display', DEMO, null, null, null, null, null, null);
    insertTheme.run(535, null, 'Collectible Minifigures');
    insertTheme.run(9003, 535, 'Series 25');
    const insertCmf = sqlite.prepare('INSERT INTO cmf_figs (rb_fig_no, theme_id, name, num_parts, image_url, fetched_at) VALUES (?, 9003, ?, ?, NULL, ?) ON CONFLICT DO NOTHING');
    [['fig-013520', 'Mermaid', 6], ['fig-013521', 'Goatherd', 5], ['fig-013522', 'Fitness Instructor', 4], ['fig-013523', 'Wolf Costume Fan', 5],
     ['fig-013524', 'Vampire Knight', 6], ['fig-013525', 'Film Noir Detective', 5], ['fig-013526', 'Harpy', 5], ['fig-013527', 'Martial Arts Boy', 4],
     ['fig-013528', 'Brick Costume Fan', 5], ['fig-013529', 'Pet Groomer', 6], ['fig-013530', 'Snow Guardian', 6], ['fig-013531', 'Triceratops Costume Fan', 5]]
      .forEach(([no, n, parts]) => insertCmf.run(no, n, parts, now));

    // Designer Program projects being followed: one pre-order open now, one coming, one still crowdfunding.
    const insertBdp = sqlite.prepare(`INSERT INTO designer_projects (name, set_no, series, designer, stage, preorder_start, preorder_end, price, pieces, notes)
      SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM designer_projects WHERE name = ?)`);
    [['Harbour Lighthouse', '910045-1', 'Series 9', 'Demo designer', 'preorder', inDays(-5), inDays(2), 229.99, 2380],
     ['Alpine Railway Station', '910047-1', 'Series 9', 'Demo designer', 'selected', inDays(6), inDays(40), 279.99, 3120],
     ['Clockwork Observatory', null, 'Series 10', 'Demo designer', 'crowdfunding', null, null, null, 2650]]
      .forEach(([n, no, series, d, stage, a, b, price, pcs]) => insertBdp.run(n, no, series, d, stage, a, b, price, pcs, DEMO, n));

    // Saved barcodes, so the scanner finds something in the demo. These are made-up codes in GS1's in-store range (200…),
    // not the real barcodes on the boxes: type one on the Scan page (Type a barcode) to try it.
    const insertBarcode = sqlite.prepare(`INSERT INTO identifiers (kind, scheme, value, canonical, source, verified, verified_at)
      VALUES ('set', 'gtin', ?, ?, 'user', 1, ?) ON CONFLICT DO NOTHING RETURNING id`);
    const insertDetails = sqlite.prepare(`INSERT INTO barcode_details (identifier_id, barcode, format) VALUES (?, ?, 'EAN_13') ON CONFLICT DO NOTHING`);
    [['2000000104973', '10497-1'], ['2000000751924', '75192-1'], ['2000000103167', '10316-1']]
      .forEach(([code, no]) => { const row = insertBarcode.get(code, no, now); if (row) insertDetails.run(row.id, code); });

    // Part prices for Galaxy Explorer's parts, so part-out value has something to show.
    const insertPrice = sqlite.prepare(`INSERT INTO part_prices (type, part_no, color_id, guide, currency, avg_sold, qty_sold, fetched_at)
      VALUES (?, ?, ?, 'N', 'USD', ?, ?, ?) ON CONFLICT DO NOTHING`);
    [['PART', '3001', 7, 0.21], ['PART', '3023', 86, 0.04], ['PART', '3069b', 11, 0.05], ['PART', '3024', 3, 0.03], ['PART', '3065', 12, 0.18], ['MINIFIG', 'sp047', -1, 14.5]]
      .forEach(([t, p, c, v]) => insertPrice.run(t, p, c, v, 50, now));
  })();

  return sqlite.prepare('SELECT count(*) AS n FROM sets').get().n;
}
