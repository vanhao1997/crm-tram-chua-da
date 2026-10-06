import dotenv from 'dotenv';
import { loadConfig } from '../server/config.js';
import { createGoogleSheetsClient } from '../server/google-sheets.js';
import { createSheetsService } from '../server/sheets-service.js';
import { calendarDay, isCustomerRow } from '../server/integrity.js';

dotenv.config({ path: '.env.local', quiet: true });
const config = loadConfig();
const service = createSheetsService({ ...config, client: createGoogleSheetsClient(config), logger: { info() {}, warn() {} } });
const [leads, booked, arrived, marketing, integrity] = await Promise.all([
    service.getSource('leads'), service.getSource('booked'), service.getSource('arrived'),
    service.getSource('marketing'), service.getIntegrity()
]);
const parts = new Intl.DateTimeFormat('en-CA', { timeZone: config.timezone, year: 'numeric', month: '2-digit' }).formatToParts(new Date());
const month = `${parts.find(p => p.type === 'year').value}-${parts.find(p => p.type === 'month').value}`;
const count = (result, column) => result.values.filter(row => isCustomerRow(row) && calendarDay(row[column])?.startsWith(month)).length;
const days = marketing.values.filter(row => calendarDay(row[0])?.startsWith(month));
const sum = column => days.reduce((total, row) => total + (typeof row[column] === 'number' ? row[column] : 0), 0);
const codes = Object.fromEntries([...new Set(integrity.issues.map(issue => issue.code))]
    .map(code => [code, integrity.issues.filter(issue => issue.code === code).length]));
console.log(JSON.stringify({ month, counts: { leads: count(leads, 1), appointments: count(booked, 10), visits: count(arrived, 10),
    derivedAppointments: booked.metadata.derivedCount,
    derivedCurrent: booked.identities.flatMap((identity, index) => identity?.derived && calendarDay(booked.values[index][10])?.startsWith(month)
        ? [{ sourceRow: identity.sourceRow, leadDate: calendarDay(booked.values[index][1]), appointmentDate: calendarDay(booked.values[index][10]) }] : []) }, finance: { received: sum(2), ads: sum(3), fee: sum(4), cost: sum(5),
        receivedMinusCost: sum(2) - sum(5), revenue: sum(15) },
    source: marketing.metadata.calculationSource, integrity: { ok: integrity.ok, codes,
        critical: integrity.issues.filter(issue => issue.severity === 'critical').map(issue => ({ code: issue.code, source: issue.source, row: issue.row, dateKey: issue.dateKey })) } }, null, 2));
