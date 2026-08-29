function toPositiveInteger(value, name) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${name} must be a positive integer`);
  return parsed;
}

export function normalizePage(page) {
  if (!page || typeof page !== 'object' || Array.isArray(page)) throw new TypeError('page must be an object');
  if (!Array.isArray(page.items)) throw new TypeError('page items must be an array');
  const nextCursor = page.nextCursor == null || page.nextCursor === '' ? null : String(page.nextCursor);
  return Object.freeze({ items: Object.freeze([...page.items]), nextCursor });
}

export function createCursorPaginator({ fetchPage, pageSize = 50, maxPages = 100 } = {}) {
  if (typeof fetchPage !== 'function') throw new TypeError('fetchPage must be a function');
  const size = toPositiveInteger(pageSize, 'pageSize');
  const cap = toPositiveInteger(maxPages, 'maxPages');

  async function* iterate({ cursor = null } = {}) {
    let current = cursor == null || cursor === '' ? null : String(cursor);
    for (let pageIndex = 0; pageIndex < cap; pageIndex += 1) {
      const request = Object.freeze({ cursor: current, pageSize: size });
      const normalized = normalizePage(await fetchPage(request));
      yield normalized;
      if (normalized.nextCursor == null) return;
      current = normalized.nextCursor;
    }
    throw new Error(`cursor pagination exceeded hard page cap of ${cap}`);
  }

  async function collectAll({ cursor = null } = {}) {
    const items = [];
    for await (const page of iterate({ cursor })) items.push(...page.items);
    return Object.freeze(items);
  }

  return Object.freeze({ iterate, collectAll });
}
