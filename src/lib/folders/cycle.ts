type Node = { id: string; parentId: string | null };

/**
 * Returns true when moving `folderId` under `newParentId` would create a
 * cycle (i.e., the new parent is the folder itself or any descendant).
 * Works on a flat list of all folders owned by one user.
 */
export function wouldCreateCycle(
  folders: Node[],
  folderId: string,
  newParentId: string | null
): boolean {
  if (newParentId === null) return false;
  if (newParentId === folderId) return true;

  const childrenByParent = new Map<string, string[]>();
  for (const f of folders) {
    if (f.parentId) {
      const list = childrenByParent.get(f.parentId) ?? [];
      list.push(f.id);
      childrenByParent.set(f.parentId, list);
    }
  }

  const queue = [folderId];
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current === newParentId) return true;
    const kids = childrenByParent.get(current);
    if (kids) queue.push(...kids);
  }
  return false;
}
