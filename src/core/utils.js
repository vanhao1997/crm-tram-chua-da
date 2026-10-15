export function escapeHtml(str) {
  return String(str ?? '')
    .normalize('NFC')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Chuyển ngày DD/MM/YYYY, DD/MM/YY hoặc DD/MM sang YYYY-MM-DD cho thẻ <input type="date">
 */
export function vnDateToIso(dateStr) {
  const clean = String(dateStr || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(clean)) return clean;
  const match = clean.match(/^(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?$/);
  if (!match) return '';
  const dd = match[1].padStart(2, '0');
  const mm = match[2].padStart(2, '0');
  let yyyy = match[3];
  if (!yyyy) {
    yyyy = String(new Date().getFullYear());
  } else if (yyyy.length === 2) {
    yyyy = `20${yyyy}`;
  }
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Chuyển ngày YYYY-MM-DD từ <input type="date"> sang DD/MM/YYYY để lưu vào Google Sheet (Cột K)
 */
export function isoToVnDate(isoStr) {
  const clean = String(isoStr || '').trim();
  if (!clean) return '';
  const match = clean.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return clean;
  return `${match[3]}/${match[2]}/${match[1]}`;
}

/**
 * Lấy ngày hiện tại (hoặc cộng/trừ số ngày) theo định dạng YYYY-MM-DD (giờ địa phương)
 */
export function getLocalIsoDate(offsetDays = 0, baseDate = new Date()) {
  const d = new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate() + offsetDays);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

