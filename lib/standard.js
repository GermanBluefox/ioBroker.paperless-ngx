'use strict';

/*
 * The commands of the shared catalog of ioBroker.assistant (family "docs"): the same names, parameters and answers in
 * every adapter of the family. They only read Paperless and leave the result states of the dashboard searches alone.
 */

/** Default and maximal number of documents searchDocuments answers */
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 100;

/**
 * A date of Paperless as ms since 1970; a date without a time is the local midnight
 *
 * @param value e.g. "2026-11-19" or "2026-11-19T08:00:00+01:00"
 */
function toTimestamp(value) {
    if (typeof value !== 'string' || !value) {
        return undefined;
    }
    const ts = new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00` : value).getTime();
    return Number.isFinite(ts) ? ts : undefined;
}

/**
 * The names in the states <kind>.detailed.<NNN>.name by id (only there if the settings read <kind> "detailed")
 *
 * @param adapter the adapter
 * @param kind tags or correspondents
 */
async function readNames(adapter, kind) {
    const names = new Map();
    try {
        const states = await adapter.getStatesAsync(`${kind}.detailed.*.name`);
        for (const [id, state] of Object.entries(states || {})) {
            const match = id.match(/\.detailed\.(\d+)\.name$/);
            if (match && state && state.val !== null && state.val !== undefined && state.val !== '') {
                names.set(Number(match[1]), String(state.val));
            }
        }
    } catch {
        // without names the ids are still answered
    }
    return names;
}

/**
 * docs.searchDocuments {query, limit?}: the documents of the full-text search of Paperless
 *
 * @param adapter the adapter (reads the names of tags and correspondents)
 * @param communication the paperlessCommunication of the adapter
 * @param message the message: query and the optional limit
 * @returns the documents and the total number of hits, or error and reason
 */
async function searchDocuments(adapter, communication, message) {
    const query = typeof message?.query === 'string' ? message.query.trim() : '';
    if (!query) {
        return { error: 'query is missing', reason: 'BAD_REQUEST' };
    }
    if (!communication?.baseUrl) {
        return { error: 'No Paperless server configured or the adapter is not ready', reason: 'NOT_CONNECTED' };
    }
    const limit = Math.min(Math.max(parseInt(message.limit, 10) || DEFAULT_LIMIT, 1), MAX_LIMIT);
    const url = new URL(`${communication.address}${communication.api.address}${communication.documents.address}`);
    url.searchParams.set('query', query);

    const found = [];
    let total;
    try {
        let page = await communication.fetchJson(url.toString(), communication.config);
        total = page?.count;
        while (page) {
            found.push(...(page.results || []));
            if (found.length >= limit || !page.next) {
                break;
            }
            page = await communication.fetchJson(communication.resolvePaginationUrl(page.next), communication.config);
        }
    } catch (error) {
        if (communication.isForbiddenError(error)) {
            return { error: 'Paperless does not allow this search (403)', reason: 'NOT_ALLOWED' };
        }
        return { error: `Paperless is not reachable: ${error?.message || error}`, reason: 'NOT_CONNECTED' };
    }

    const correspondents = await readNames(adapter, 'correspondents');
    const tags = await readNames(adapter, 'tags');
    const documents = found.slice(0, limit).map(document => {
        const entry = { id: document.id, title: document.title };
        const date = toTimestamp(document.created);
        if (date !== undefined) {
            entry.date = date;
        }
        if (document.correspondent !== null && document.correspondent !== undefined) {
            if (correspondents.has(document.correspondent)) {
                entry.correspondent = correspondents.get(document.correspondent);
            }
            entry.correspondentId = document.correspondent;
        }
        const tagIds = Array.isArray(document.tags) ? document.tags : [];
        entry.tags = tagIds.filter(id => tags.has(id)).map(id => tags.get(id));
        entry.tagIds = tagIds;
        return entry;
    });
    return { documents, total: typeof total === 'number' ? total : documents.length };
}

module.exports = { searchDocuments, toTimestamp, DEFAULT_LIMIT, MAX_LIMIT };
