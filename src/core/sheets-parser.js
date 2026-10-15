/**
 * Bộ phân tích cú pháp CSV & Chuẩn hóa dữ liệu từ Google Sheet
 * Đã loại bỏ hoàn toàn việc trích xuất Doanh số (Cột W) để bảo mật nội bộ.
 */

export function parseCsvToRows(csvText) {
  const rows = [];
  let currentRow = [];
  let currentCell = '';
  let inQuotes = false;

  const text = String(csvText || '')
    .replace(/^\uFEFF/, '')
    .normalize('NFC');

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const nextCh = text[i + 1];

    if (inQuotes) {
      if (ch === '"' && nextCh === '"') {
        currentCell += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        currentCell += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      currentRow.push(currentCell);
      currentCell = '';
    } else if (ch === '\r' && nextCh === '\n') {
      currentRow.push(currentCell);
      rows.push(currentRow);
      currentRow = [];
      currentCell = '';
      i++;
    } else if (ch === '\n' || ch === '\r') {
      currentRow.push(currentCell);
      rows.push(currentRow);
      currentRow = [];
      currentCell = '';
    } else {
      currentCell += ch;
    }
  }

  if (currentCell.length > 0 || currentRow.length > 0) {
    currentRow.push(currentCell);
    rows.push(currentRow);
  }

  return rows;
}

export function normalizePhone(rawPhone) {
  const raw = String(rawPhone || '').trim();
  if (!raw) return '';
  const digits = raw.replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('0084') && digits.length === 13) {
    return `0${digits.slice(4)}`;
  }
  if (digits.startsWith('84') && digits.length === 11) {
    return `0${digits.slice(2)}`;
  }
  if (digits.length === 9 && !digits.startsWith('0')) {
    return `0${digits}`;
  }
  return digits;
}

export function formatPhoneDisplay(phone) {
  const norm = normalizePhone(phone);
  if (norm.length === 10) {
    return `${norm.slice(0, 4)} ${norm.slice(4, 7)} ${norm.slice(7)}`;
  }
  return norm || String(phone || '').trim();
}

export function parseVnDateToIso(dateStr) {
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

function isMoneyCell(rawVal) {
  const str = String(rawVal || '').trim();
  if (!str) return false;
  return str.includes('₫') || /^\d{1,3}(\.\d{3})+$/.test(str);
}

export function classifyStatus(rawStatus) {
  const clean = String(rawStatus || '')
    .normalize('NFC')
    .trim();
  const upper = clean.toUpperCase();

  if (!clean || upper === 'CHƯA GỌI' || upper === 'MỚI') {
    return {
      status: clean || 'Chưa gọi',
      canonicalStatus: '',
      statusLabel: 'Chưa gọi',
      statusGroup: 'new',
      badgeColor: 'amber',
    };
  }
  if (upper.includes('ĐẶT HẸN') || upper === 'ĐẶT LỊCH') {
    return {
      status: clean,
      canonicalStatus: 'ĐẶT HẸN',
      statusLabel: 'Đặt Hẹn',
      statusGroup: 'booked',
      badgeColor: 'emerald',
    };
  }
  if (upper.includes('DỜI LỊCH')) {
    return {
      status: clean,
      canonicalStatus: 'DỜI LỊCH',
      statusLabel: 'Dời Lịch',
      statusGroup: 'booked',
      badgeColor: 'purple',
    };
  }
  if (upper === 'ĐÃ ĐẾN') {
    return {
      status: clean,
      canonicalStatus: 'ĐÃ ĐẾN',
      statusLabel: 'Đã Đến',
      statusGroup: 'arrived',
      badgeColor: 'teal',
    };
  }
  if (upper.includes('ĐẾN VÀ VỀ')) {
    return {
      status: clean,
      canonicalStatus: 'ĐẾN VÀ VỀ',
      statusLabel: 'Đến Và Về',
      statusGroup: 'followup',
      badgeColor: 'indigo',
    };
  }
  if (upper.includes('CHƯA ĐẾN')) {
    return {
      status: clean,
      canonicalStatus: 'CHƯA ĐẾN',
      statusLabel: 'Chưa Đến',
      statusGroup: 'followup',
      badgeColor: 'indigo',
    };
  }
  if (upper.includes('HẸN GỌI LẠI')) {
    return {
      status: clean,
      canonicalStatus: 'Hẹn Gọi Lại',
      statusLabel: 'Hẹn Gọi Lại',
      statusGroup: 'followup',
      badgeColor: 'blue',
    };
  }
  if (upper.includes('NHU CẦU')) {
    return {
      status: clean,
      canonicalStatus: 'Nhu Cầu',
      statusLabel: 'Nhu Cầu',
      statusGroup: 'followup',
      badgeColor: 'indigo',
    };
  }
  if (upper.includes('KHÔNG NGHE MÁY') || upper === 'KNM') {
    return {
      status: clean,
      canonicalStatus: 'Không Nghe Máy',
      statusLabel: 'Không Nghe Máy',
      statusGroup: 'unreachable',
      badgeColor: 'orange',
    };
  }
  if (upper.includes('THUÊ BAO')) {
    return {
      status: clean,
      canonicalStatus: 'Thuê Bao',
      statusLabel: 'Thuê Bao',
      statusGroup: 'unreachable',
      badgeColor: 'orange',
    };
  }
  if (upper.includes('HỦY LỊCH')) {
    return {
      status: clean,
      canonicalStatus: 'HỦY LỊCH',
      statusLabel: 'Hủy Lịch',
      statusGroup: 'lost',
      badgeColor: 'rose',
    };
  }
  if (upper.includes('TỪ CHỐI')) {
    return {
      status: clean,
      canonicalStatus: 'Từ Chối',
      statusLabel: 'Từ Chối',
      statusGroup: 'lost',
      badgeColor: 'rose',
    };
  }
  if (upper.includes('KHÔNG HOÀN THÀNH')) {
    return {
      status: clean,
      canonicalStatus: 'Không Hoàn Thành',
      statusLabel: 'Không Hoàn Thành',
      statusGroup: 'lost',
      badgeColor: 'slate',
    };
  }
  if (upper.includes('Ở XA')) {
    return {
      status: clean,
      canonicalStatus: 'Ở xa',
      statusLabel: 'Ở Xa',
      statusGroup: 'lost',
      badgeColor: 'slate',
    };
  }
  if (upper.includes('SAI SỐ')) {
    return {
      status: clean,
      canonicalStatus: 'Sai Số',
      statusLabel: 'Sai Số',
      statusGroup: 'lost',
      badgeColor: 'red',
    };
  }

  return {
    status: clean,
    canonicalStatus: clean,
    statusLabel: clean,
    statusGroup: 'followup',
    badgeColor: 'slate',
  };
}

export function columnIndexToLetter(zeroBasedIndex) {
  let temp = zeroBasedIndex + 1;
  let letter = '';
  while (temp > 0) {
    const rem = (temp - 1) % 26;
    letter = String.fromCharCode(65 + rem) + letter;
    temp = Math.floor((temp - 1) / 26);
  }
  return letter;
}

function extractTelesaleAndNoteM(rawColL, rawColM, knownTelesales = []) {
  const colL = String(rawColL || '').trim();
  const colM = String(rawColM || '').trim();
  const upperL = colL.toUpperCase();
  const knownSet = new Set(knownTelesales.map((s) => String(s || '').trim().toUpperCase()));

  if (!colL) {
    return { telesale: '', noteM: colM, legacyColLNote: '' };
  }

  if (knownSet.has(upperL)) {
    return { telesale: upperL, noteM: colM, legacyColLNote: '' };
  }

  const looksLikeNote =
    colL.length > 18 ||
    /\d{1,2}\/\d{1,2}/.test(colL) ||
    /\d{1,2}h\d{0,2}/i.test(colL) ||
    colL.includes(',') ||
    colL.split(/\s+/).length > 4;

  if (!looksLikeNote) {
    return { telesale: upperL, noteM: colM, legacyColLNote: '' };
  }

  return {
    telesale: '',
    noteM: colM || colL,
    legacyColLNote: colM ? colL : '',
  };
}

export function parseSheetRecords(csvText, sheetKey = 'mkt', knownTelesales = []) {
  const rawRows = parseCsvToRows(csvText);
  const records = [];
  let currentSection = '';
  let emptyTemplateRowsCount = 0;
  let firstEmptyTemplateRowIndex = null;

  for (let i = 0; i < rawRows.length; i++) {
    const sheetRowIndex = i + 1;
    const row = rawRows[i];

    const colA = String(row[0] || '').trim();
    const colB = String(row[1] || '').trim();
    const colC = String(row[2] || '').trim();
    const colD = String(row[3] || '').trim();
    const colE = String(row[4] || '').trim();
    const colF = String(row[5] || '').trim();
    const colG = String(row[6] || '').trim();

    if (
      sheetRowIndex === 1 ||
      colB.toUpperCase() === 'NGÀY DATA' ||
      colC.toUpperCase() === 'TÊN KHÁCH HÀNG'
    ) {
      continue;
    }

    const joinedHeaderCheck = `${colB} ${colE} ${colG}`.toUpperCase();
    if (
      !colC &&
      !colD &&
      (joinedHeaderCheck.includes('THÁNG') || colB.toUpperCase() === 'DATA NGÀY')
    ) {
      const monthMatch = joinedHeaderCheck.match(/THÁNG\s*(\d{1,2})/i);
      if (monthMatch) {
        currentSection = `THÁNG ${monthMatch[1]}`;
      }
      continue;
    }

    const normalizedPhone = normalizePhone(colD);
    const hasCustomerIdentity = Boolean(colC || normalizedPhone.length >= 8);

    if (!hasCustomerIdentity) {
      if (colF) {
        emptyTemplateRowsCount++;
        if (firstEmptyTemplateRowIndex === null) {
          firstEmptyTemplateRowIndex = sheetRowIndex;
        }
      }
      continue;
    }

    const customerInfo = String(row[7] || '').trim();
    const rawStatus = String(row[8] || '').trim();
    const apptTime = String(row[9] || '').trim();
    const apptDate = String(row[10] || '').trim();
    const rawColL = row[11];
    const rawColM = row[12];

    const { telesale, noteM, legacyColLNote } = extractTelesaleAndNoteM(
      rawColL,
      rawColM,
      knownTelesales
    );

    const careHistory = [];
    if (legacyColLNote) {
      careHistory.push({
        text: legacyColLNote,
      });
    }

    for (let colIdx = 13; colIdx < row.length; colIdx++) {
      const cellVal = String(row[colIdx] || '').trim();
      if (!cellVal) continue;

      const isWeekdayCell =
        colIdx >= 20 &&
        colIdx <= 23 &&
        /^(thứ\s*\d|chúa\s*nhật|chủ\s*nhật|cn)$/i.test(cellVal);

      // Ẩn hoàn toàn các cột Thứ (V) và Doanh số (W) chứa số tiền ₫
      if (isWeekdayCell || isMoneyCell(cellVal)) {
        continue;
      }

      careHistory.push({
        text: cellVal,
      });
    }

    const statusInfo = classifyStatus(
      sheetKey === 'arrived' && !rawStatus ? 'ĐÃ ĐẾN' : rawStatus
    );
    const dataDateIso = parseVnDateToIso(colB);
    const apptDateIso = parseVnDateToIso(apptDate);
    const monthKey = dataDateIso
      ? `${dataDateIso.slice(5, 7)}/${dataDateIso.slice(0, 4)}`
      : apptDateIso
      ? `${apptDateIso.slice(5, 7)}/${apptDateIso.slice(0, 4)}`
      : currentSection;

    records.push({
      id: `${sheetKey}-row-${sheetRowIndex}`,
      sheetKey,
      sheetRowIndex,
      section: currentSection,
      monthKey,
      stt: colA,
      dataDate: colB,
      dataDateIso,
      name: colC || 'Khách chưa rõ tên',
      phone: normalizedPhone,
      rawPhone: colD,
      phoneDisplay: formatPhoneDisplay(normalizedPhone || colD),
      service: colE,
      source: colF || 'Ads FB Mess',
      customerInfo,
      status: statusInfo.status,
      canonicalStatus: statusInfo.canonicalStatus,
      statusLabel: statusInfo.statusLabel,
      statusGroup: statusInfo.statusGroup,
      badgeColor: statusInfo.badgeColor,
      apptTime,
      apptDate,
      apptDateIso,
      telesale,
      noteM,
      careHistory,
    });
  }

  return {
    sheetKey,
    totalRawRows: rawRows.length,
    emptyTemplateRowsCount,
    firstEmptyTemplateRowIndex,
    records,
  };
}
