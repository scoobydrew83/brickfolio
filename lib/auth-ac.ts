// What each collection role may do (#90), as Better Auth access control. Pure: no server or database imports, so the
// permission checks in lib/service/permissions.ts (and client code) can use it.
//
// Each collection is a Better Auth organization; a person's role in it is their `member.role` there. Better Auth's own
// organization endpoints read the same roles (the `member`/`invitation` statements), so "owners manage members" holds
// for its API too. Admins are global: the admin plugin's `user.role = 'admin'`.
import { createAccessControl } from 'better-auth/plugins/access';
import { defaultStatements } from 'better-auth/plugins/organization/access';

export const statements = {
  ...defaultStatements,
  /** The collection's items: sets, copies, minifigures. `manage` = its members and share links. */
  collection: ['read', 'write', 'manage'],
  /** Lists every member shares (wishlist, layouts, loose parts, builds, Designer, barcodes). */
  shared: ['read', 'write'],
} as const;

export const ac = createAccessControl(statements);

export const roles = {
  viewer: ac.newRole({ collection: ['read'], shared: ['read'] }),
  editor: ac.newRole({ collection: ['read', 'write'], shared: ['read', 'write'] }),
  owner: ac.newRole({
    collection: ['read', 'write', 'manage'], shared: ['read', 'write'],
    member: ['create', 'update', 'delete'], invitation: ['create', 'cancel'],
  }),
};
export type CollectionRole = keyof typeof roles;
