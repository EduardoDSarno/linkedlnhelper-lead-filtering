import assert from 'node:assert/strict';
import test from 'node:test';


import { saveOriginalCsv } from '../processing.js';
import { readFile, rm } from 'node:fs/promises';



const buf = Buffer.from('\uFEFFpublic_id;full_name\r\nabc;Ada Lovelace\r\n', 'utf-8'); // simulating a CSV file with a UTF-8 BOM

const id: string = 'test-1234';


test('saveOriginalCsv', async () => {
    const result = await saveOriginalCsv(id, buf);
    const written = await readFile(result.originalPath); // no encoding → Buffer
    assert.deepStrictEqual(written, buf);

    await rm(`data/processing/${id}`, { recursive: true, force: true });
});

