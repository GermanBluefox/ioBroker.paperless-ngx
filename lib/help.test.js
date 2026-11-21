'use strict';

const { expect } = require('chai');
const { describe, it } = require('mocha');
const fs = require('node:fs');
const path = require('node:path');
const { COMMANDS, HELP } = require('./help');

/** The commands of onMessage in main.js */
function answeredCommands() {
    const source = fs.readFileSync(path.join(__dirname, '../main.js'), 'utf8');
    const start = source.indexOf('async onMessage(');
    const end = source.indexOf('inProgress() {');
    expect(start).to.be.greaterThan(0);
    expect(end).to.be.greaterThan(start);
    return [...source.slice(start, end).matchAll(/obj\.command === '([^']+)'/g)].map(m => m[1]);
}

describe('help', () => {
    it('lists exactly the commands onMessage answers, each once', () => {
        const listed = COMMANDS.map(entry => entry.command);
        expect(new Set(listed).size).to.equal(listed.length);
        expect([...listed].sort()).to.deep.equal(answeredCommands().sort());
    });

    it('marks the searches and the refresh as write, help and dashboardInfo as read', () => {
        const write = Object.fromEntries(COMMANDS.map(entry => [entry.command, entry.write]));
        expect(write).to.deep.equal({
            help: false,
            searchDocuments: false,
            dashboardInfo: false,
            dashboardSearch: true,
            dashboardGlobalSearch: true,
            dashboardRefresh: true,
        });
    });

    it('marks the commands of the shared catalog and names them in the help', () => {
        const standard = Object.fromEntries(
            COMMANDS.filter(entry => entry.standard).map(entry => [entry.command, entry.standard]),
        );
        expect(standard).to.deep.equal({ searchDocuments: 'docs.searchDocuments' });
        expect(HELP).to.include('Standard command docs.searchDocuments of the shared catalog');
    });

    it('names every command and keeps the lines short', () => {
        for (const { command } of COMMANDS.filter(entry => entry.command !== 'help')) {
            expect(HELP, command).to.include(command);
        }
        expect(HELP).to.include('Commands (sendTo paperless-ngx.0');
        expect(HELP).to.include('How to talk to the user:');
        for (const line of HELP.split('\n')) {
            expect(line.length, line).to.be.at.most(120);
        }
    });
});
