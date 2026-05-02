/** @typedef {{ id: string; url: string; createdAt: number }} FeedItem */

const MAX_ITEMS = 24;

export class FeedStore {
  constructor() {
    /** @type {FeedItem[]} */
    this.items = [];
  }

  /**
   * @param {Blob} blob
   * @returns {FeedItem | null}
   */
  push(blob) {
    if (!(blob instanceof Blob) || blob.size === 0) {
      return null;
    }

    try {
      const id = crypto.randomUUID();
      const url = URL.createObjectURL(blob);

      /** @type {FeedItem} */
      const row = {
        id,
        url,
        createdAt: Date.now(),
      };

      this.items.unshift(row);

      while (this.items.length > MAX_ITEMS) {
        const removed = this.items.pop();
        if (removed) this.revoke(removed.url);
      }

      return row;
    } catch {
      return null;
    }
  }

  revoke(url) {
    try {
      URL.revokeObjectURL(url);
    } catch {
      // ignore invalid URL revocation
    }
  }

  /**
   * @param {string} id
   * @returns {boolean}
   */
  remove(id) {
    const idx = this.items.findIndex((x) => x.id === id);
    if (idx === -1) return false;
    const removed = this.items.splice(idx, 1)[0];
    if (!removed) return false;
    this.revoke(removed.url);
    return true;
  }
}
