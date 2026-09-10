const KEY = 'bsn-telegram-group-id';
export const validGroupId = value => /^-[1-9]\d{0,15}$/.test(value) && Number.isSafeInteger(Number(value));
export function readTelegramGroup() {
    try { return localStorage.getItem(KEY) || ''; } catch { return ''; }
}
export function saveTelegramGroup(value) {
    const id = value.trim();
    if (id && !validGroupId(id)) throw new Error('Nhập Group ID dạng số âm, ví dụ -5278774970 hoặc -1001234567890.');
    if (id) localStorage.setItem(KEY, id);
    else localStorage.removeItem(KEY);
    return id;
}
