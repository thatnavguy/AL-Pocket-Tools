import * as assert from 'assert';
import { parseAlObjects } from '../commands/renumberObjectIds';

suite('Renumber Object IDs Test Suite', () => {
    test('parses a single table declaration', () => {
        const text = 'table 50100 "My Table"\n{\n}\n';
        const objects = parseAlObjects(text);
        assert.strictEqual(objects.length, 1);
        assert.strictEqual(objects[0].type, 'table');
        assert.strictEqual(objects[0].id, 50100);
        assert.strictEqual(objects[0].name, 'My Table');
        assert.strictEqual(text.slice(objects[0].idStart, objects[0].idEnd), '50100');
    });

    test('detects same-type conflicts but not cross-type collisions', () => {
        const fileA = 'table 50100 "Foo"\n{\n}\n';
        const fileB = 'table 50100 "Bar"\n{\n}\n';
        const fileC = 'page 50100 "Baz"\n{\n}\n';

        const a = parseAlObjects(fileA);
        const b = parseAlObjects(fileB);
        const c = parseAlObjects(fileC);

        assert.strictEqual(a.length, 1);
        assert.strictEqual(b.length, 1);
        assert.strictEqual(c.length, 1);

        // Same type + id -> conflict
        assert.strictEqual(a[0].type, b[0].type);
        assert.strictEqual(a[0].id, b[0].id);

        // Different type, same id -> not a conflict
        assert.notStrictEqual(a[0].type, c[0].type);
        assert.strictEqual(a[0].id, c[0].id);
    });

    test('parses extension objects and unquoted names', () => {
        const text = 'pageextension 50101 MyPageExt extends "Customer Card"\n{\n}\n';
        const objects = parseAlObjects(text);
        assert.strictEqual(objects.length, 1);
        assert.strictEqual(objects[0].type, 'pageextension');
        assert.strictEqual(objects[0].id, 50101);
        assert.strictEqual(objects[0].name, 'MyPageExt');
    });

    test('ignores controladdin, profile, and interface (no numeric id)', () => {
        const text = 'controladdin MyAddIn\n{\n}\nprofile "My Profile"\n{\n}\ninterface IMyInterface\n{\n}\n';
        const objects = parseAlObjects(text);
        assert.strictEqual(objects.length, 0);
    });
});
