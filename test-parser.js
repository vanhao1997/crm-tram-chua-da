const url = "https://docs.google.com/spreadsheets/d/124VcfNpFqJKv400Jj156h2aYg4eurDzfJaEvs_wbNQ4/gviz/tq?tqx=out:json&gid=1227076939";

function parseCellValue(cell) {
    if (!cell || cell.v === null || cell.v === undefined) return null;
    return cell.v;
}

function parseGvizDate(cell) {
    if (!cell || !cell.v) return null;
    if (typeof cell.v === 'string' && cell.v.startsWith('Date(')) {
        const match = cell.v.match(/Date\((\d+),\s*(\d+),\s*(\d+)/);
        if (match) {
            return new Date(parseInt(match[1]), parseInt(match[2]), parseInt(match[3]));
        }
    }
    if (cell.v instanceof Date) return cell.v;
    if (typeof cell.v === 'string') {
        const d = new Date(cell.v);
        return isNaN(d.getTime()) ? null : d;
    }
    return null;
}

function parseCurrencyStr(str) {
    if (!str) return 0;
    if (typeof str === 'number') return str;
    const cleanStr = String(str).replace(/[đ₫\s,.]/g, '');
    const num = parseFloat(cleanStr);
    return isNaN(num) ? 0 : num;
}

async function run() {
    try {
        const response = await fetch(url);
        const text = await response.text();
        const jsonMatch = text.match(/google\.visualization\.Query\.setResponse\(([\s\S]+)\);?\s*$/);
        const data = JSON.parse(jsonMatch[1]);
        const rows = data.table.rows;

        console.log(`Found ${rows.length} rows.`);
        if (rows.length > 0) {
            console.log("Row 0 cells:", JSON.stringify(rows[0].c, null, 2));
            console.log("Row 5 cells:", JSON.stringify(rows[5].c, null, 2));
        }

        const results = [];
        for (const row of rows) {
            const cells = row.c || [];
            const dateStrObj = cells[0];
            if (!dateStrObj || !dateStrObj.v) continue;

            const dateStr = String(dateStrObj.v).trim();
            if (dateStr.toUpperCase().includes('TỔNG') || dateStr.toUpperCase().includes('THÁNG') || dateStr === '') continue;

            const dateObj = parseGvizDate(dateStrObj);
            if (!dateObj) continue;

            results.push({
                date: dateObj,
                cost: parseCurrencyStr(parseCellValue(cells[5])),
                revenue: parseCurrencyStr(parseCellValue(cells[15]))
            });
        }

        console.log(`Parsed ${results.length} valid marketing records.`);
    } catch (err) {
        console.error(err);
    }
}
run();
