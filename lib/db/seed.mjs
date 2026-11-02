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

  sqlite.transaction(() => {
    ['Display', 'Shelf', 'Storage', 'Sell'].forEach((l, i) => insertLocation.run(l, i));

    let total = 0, avgTotal = 0, pieces = 0, copies = 0;
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

    const now = new Date().toISOString();
    insertWish.run('10316-1', 'Rivendell', 'New', 430, 2023, 418, 399, 14, DEMO, now);
    insertWish.run('10307-1', 'Eiffel Tower', 'New', 520, 2022, 579, 540, 7, DEMO, now);
    insertWish.run('75313-1', 'AT-AT', 'Used', 700, 2021, 784, 690, 5, DEMO, now);
    insertWish.run('10295-1', 'Porsche 911', 'Used', 120, 2021, 131, 115, 12, DEMO, now);
  })();

  return sqlite.prepare('SELECT count(*) AS n FROM sets').get().n;
}
