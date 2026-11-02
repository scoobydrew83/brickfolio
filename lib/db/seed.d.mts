import type Database from 'better-sqlite3';

/** Adds the demo sets, history, a parts list and a wishlist. Returns the number of sets afterwards. */
export declare function seedDemo(sqlite: Database.Database): number;
