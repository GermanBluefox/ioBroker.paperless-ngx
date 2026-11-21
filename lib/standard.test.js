'use strict';

const { expect } = require('chai');
const { describe, it } = require('mocha');
const PaperlessCommunication = require('./modules/paperlessCommunication');
const { searchDocuments, toTimestamp } = require('./standard');

/**
 * An adapter with the given states, and a communication whose fetchJson answers the given pages
 *
 * @param pages the answers of fetchJson, one per call (an Error is thrown)
 * @param states the values of the states of the instance by id
 */
function setup(pages, states = {}) {
    const adapter = {
        config: { ipUrl: 'http://paperless.local:8000', useToken: true, token: 'x' },
        log: { debug: () => undefined, warn: () => undefined, error: () => undefined },
        getStatesAsync: async pattern => {
            const prefix = pattern.split('*')[0];
            return Object.fromEntries(
                Object.entries(states)
                    .filter(([id]) => id.startsWith(`paperless-ngx.0.${prefix}`))
                    .map(([id, val]) => [id, { val }]),
            );
        },
    };
    const communication = new PaperlessCommunication(adapter);
    const urls = [];
    communication.fetchJson = async url => {
        urls.push(url);
        const page = pages.shift();
        if (page instanceof Error) {
            throw page;
        }
        return page;
    };
    return { adapter, communication, urls };
}

describe('docs.searchDocuments', () => {
    it('asks the full-text search of Paperless and answers the documents with names', async () => {
        const { adapter, communication, urls } = setup(
            [
                {
                    count: 2,
                    next: null,
                    results: [
                        { id: 7, title: 'Invoice fridge', created: '2026-03-02', correspondent: 3, tags: [1, 2] },
                        { id: 9, title: 'Warranty', created: '2026-03-05T10:00:00Z', correspondent: null, tags: [] },
                    ],
                },
            ],
            {
                'paperless-ngx.0.tags.detailed.001.name': 'invoice',
                'paperless-ngx.0.correspondents.detailed.003.name': 'Electro shop',
            },
        );
        const answer = await searchDocuments(adapter, communication, { query: ' fridge ' });
        expect(urls).to.deep.equal(['http://paperless.local:8000/api/documents/?query=fridge']);
        expect(answer).to.deep.equal({
            documents: [
                {
                    id: 7,
                    title: 'Invoice fridge',
                    date: new Date(2026, 2, 2).getTime(),
                    correspondent: 'Electro shop',
                    correspondentId: 3,
                    tags: ['invoice'],
                    tagIds: [1, 2],
                },
                { id: 9, title: 'Warranty', date: Date.UTC(2026, 2, 5, 10), tags: [], tagIds: [] },
            ],
            total: 2,
        });
    });

    it('follows the pages only up to the limit', async () => {
        const results = Array.from({ length: 25 }, (_, i) => ({ id: i + 1, title: `D${i + 1}`, tags: [] }));
        const { adapter, communication, urls } = setup([
            { count: 60, next: 'http://paperless:8000/api/documents/?page=2&query=x', results },
            { count: 60, next: 'http://paperless:8000/api/documents/?page=3&query=x', results },
        ]);
        const answer = await searchDocuments(adapter, communication, { query: 'x', limit: 30 });
        expect(answer.documents).to.have.length(30);
        expect(answer.total).to.equal(60);
        expect(urls).to.have.length(2);
        expect(urls[1]).to.equal('http://paperless.local:8000/api/documents/?page=2&query=x');

        const small = setup([{ count: 60, next: 'http://paperless:8000/api/documents/?page=2', results }]);
        expect((await searchDocuments(small.adapter, small.communication, { query: 'x' })).documents).to.have.length(
            10,
        );
    });

    it('answers {error, reason} without a query, without a server and when Paperless fails', async () => {
        const { adapter, communication } = setup([new Error('HTTP 403: url'), new Error('fetch failed')]);
        expect(await searchDocuments(adapter, communication, {})).to.include({ reason: 'BAD_REQUEST' });
        expect(await searchDocuments(adapter, undefined, { query: 'x' })).to.include({ reason: 'NOT_CONNECTED' });
        expect(await searchDocuments(adapter, communication, { query: 'x' })).to.include({ reason: 'NOT_ALLOWED' });
        expect(await searchDocuments(adapter, communication, { query: 'x' })).to.include({ reason: 'NOT_CONNECTED' });
    });

    it('reads a date without a time as the local midnight', () => {
        expect(toTimestamp('2026-11-19')).to.equal(new Date(2026, 10, 19).getTime());
        expect(toTimestamp('nonsense')).to.equal(undefined);
        expect(toTimestamp(undefined)).to.equal(undefined);
    });
});
