// Telegram entity offsets use UTF-16 code units, matching JavaScript indices.
export function formatTelegramPhone(text) {
    const match = /^SĐT: (0\d{9,10}|\+84\d{9,10})$/m.exec(text);
    if (!match) return { text };
    const phone = match[1].startsWith('0') ? `+84${match[1].slice(1)}` : match[1];
    const offset = match.index + 'SĐT: '.length;
    return {
        text: text.slice(0, offset) + phone + text.slice(offset + match[1].length),
        entities: [{ type: 'phone_number', offset, length: phone.length }]
    };
}
