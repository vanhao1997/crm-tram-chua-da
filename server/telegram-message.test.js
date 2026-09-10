import test from 'node:test';
import assert from 'node:assert/strict';
import { formatTelegramPhone } from './telegram-message.js';

test('phone entity points at international number with Vietnamese and emoji before it', () => {
    const result = formatTelegramPhone('Khách hàng: 🌸 Hảo\nSĐT: 0901234567\nGhi chú: <b>giữ nguyên</b>');
    const entity = result.entities[0];
    assert.equal(entity.type, 'phone_number');
    assert.equal(result.text.slice(entity.offset, entity.offset + entity.length), '+84901234567');
    assert.ok(result.text.endsWith('<b>giữ nguyên</b>'));
});

test('missing or invalid numbers remain plain text; international number stays unchanged', () => {
    for (const text of ['SĐT: Chưa có', 'SĐT: 123', 'Ghi chú: 0901234567']) {
        assert.deepEqual(formatTelegramPhone(text), { text });
    }
    assert.equal(formatTelegramPhone('SĐT: +84901234567').text, 'SĐT: +84901234567');
});
