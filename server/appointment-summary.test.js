import test from 'node:test';
import assert from 'node:assert/strict';
import { appointmentSummary } from './appointment-summary.js';
import { overviewPeriod } from './overview.js';

const reference = new Date('2026-10-05T18:30:00Z'); // 06/10/2026 01:30 in Vietnam.
const period = overviewPeriod({ period: 'month' }, reference);
function row({ day, time = '9h', status = 'Đặt Hẹn', name = 'Khách', service = 'Nâng cơ', phone = '0901234567' }) {
    const value = Array(26).fill('');
    value[2] = name; value[3] = phone; value[4] = service; value[8] = status; value[9] = time; value[10] = day;
    return value;
}
function source(values, identities = []) {
    return { values, identities, metadata: { stale: false } };
}

test('appointment summary separates upcoming, recent past and selected-period past KPI', () => {
    const sources = {
        leads: source([['header']]),
        booked: source([
            ['header'],
            row({ day: '05/10/2026', time: '8h30', name: 'Đã qua' }),
            row({ day: '06/10/2026', time: '16h', name: 'Hôm nay' }),
            row({ day: '07/10/2026', time: '13h', name: 'Sắp tới' }),
            row({ day: '03/10/2026', status: 'DỜI LỊCH', name: 'Đổi lịch' }),
            row({ day: '02/10/2026', status: 'HỦY LỊCH', name: 'Đã hủy' }),
            row({ day: '20/09/2026', name: 'Ngoài cửa sổ' }),
            row({ day: '30/09/2026', name: 'Đầu cửa sổ' }),
            row({ day: '29/09/2026', name: 'Trước cửa sổ' })
        ], [null, null, null, null, null, null]),
        arrived: source([['header']])
    };
    const result = appointmentSummary(sources, period, reference);
    assert.equal(result.pastInPeriod, 3);
    assert.equal(result.upcoming.total, 2);
    assert.equal(result.upcoming.items[0].name, 'Hôm nay');
    assert.equal(result.recentPast.total, 4);
    assert.deepEqual(result.recentPast.items.map(item => item.name), ['Đã qua', 'Đổi lịch', 'Đã hủy', 'Đầu cửa sổ']);
    assert.equal(result.recentPast.items[0].timeConfirmed, true);
    assert.ok(result.recentPast.items.every(item => !('phone' in item)));
});

test('appointment summary keeps schedule available when arrivals fail and matches visits only on exact event identity', () => {
    const sources = {
        booked: source([
            ['header'],
            row({ day: '05/10/2026', name: 'Gốc', phone: '0901111111' }),
            row({ day: '06/10/2026', time: '16h', name: 'Tương lai', phone: '0902222222' })
        ], [null, { appointmentId: 'a1' }, null]),
        arrived: undefined
    };
    const result = appointmentSummary(sources, period, reference);
    assert.equal(result.available, true);
    assert.equal(result.pastInPeriod, 1);
    assert.equal(result.recentPast.total, 1);
    assert.equal(result.recentPast.items[0].status, 'Đặt Hẹn');
});

test('appointment summary caps lists and excludes canceled, rescheduled and completed events from upcoming', () => {
    const values = [['header'], ...Array.from({ length: 24 }, (_, index) => row({ day: `${String(index + 7).padStart(2, '0')}/10/2026`, name: `N${index}` }))];
    values.splice(1, 1, row({ day: '07/10/2026', status: 'HỦY LỊCH' }));
    values.splice(2, 1, row({ day: '08/10/2026', status: 'DỜI LỊCH' }));
    values.splice(3, 1, row({ day: '09/10/2026', status: 'ĐÃ ĐẾN' }));
    const result = appointmentSummary({ booked: source(values), arrived: source([['header']]) }, period, reference);
    assert.equal(result.upcoming.total, 21);
    assert.equal(result.upcoming.items.length, 20);
    assert.equal(result.upcoming.omitted, 1);
});

test('same-day times distinguish elapsed hours without inventing time for ranges, ambiguous hours or invalid values', () => {
    const now = new Date('2026-10-06T06:30:00Z');
    const times = ['12:00', '13h', '16h', '13:30', '1h', '2h30', '16-17h', '', '24:00', '11:99'];
    const result = appointmentSummary({ booked: source(times.map(time => row({ day: '06/10/2026', time, name: time || 'Blank' }))) }, period, now);
    assert.equal(result.pastInPeriod, 2);
    assert.deepEqual(result.recentPast.items.map(item => item.name), ['13h', '12:00']);
    assert.equal(result.upcoming.total, 8);
    assert.equal(result.upcoming.items[0].time, '13:30');
    assert.equal(result.upcoming.items[1].time, '16:00');
    assert.ok(result.upcoming.items.slice(2).every(item => !item.timeConfirmed));
});

test('visits match exact normalized phone and day or appointment ID, never an old visit or blank phone', () => {
    const bookings = [
        row({ day: '05/10/2026', name: 'Exact', phone: '0901111111' }),
        row({ day: '06/10/2026', name: 'Old visit', phone: '0902222222' }),
        row({ day: '06/10/2026', name: 'Blank phone', phone: '' }),
        row({ day: '05/10/2026', name: 'By ID', phone: '' })
    ];
    const arrivals = [
        row({ day: '05/10/2026', phone: '84901111111' }),
        row({ day: '01/10/2026', phone: '0902222222' }),
        row({ day: '06/10/2026', phone: '' }),
        row({ day: '05/10/2026', phone: '' })
    ];
    const result = appointmentSummary({
        booked: source(bookings, [null, null, null, { appointmentId: 'a1' }]),
        arrived: source(arrivals, [null, null, null, { appointmentId: 'a1' }])
    }, period, reference);
    assert.deepEqual(result.upcoming.items.map(item => item.name), ['Old visit', 'Blank phone']);
    assert.ok(result.recentPast.items.every(item => item.visitRecorded && item.kind === 'completed'));
    assert.ok(result.recentPast.items.every(item => item.status === 'Đặt Hẹn'));
    assert.doesNotMatch(JSON.stringify(result), /0901111111|appointmentId|sourceRow/);
});

test('unavailable booked source returns unavailable counts while stale schedules are labeled', () => {
    const unavailable = appointmentSummary({}, period, reference);
    assert.equal(unavailable.pastInPeriod, null);
    assert.equal(unavailable.upcoming.total, null);
    assert.deepEqual(unavailable.recentPast.items, []);
    const stale = appointmentSummary({ booked: { ...source([row({ day: '05/10/2026' })]), metadata: { stale: true } } }, period, reference);
    assert.equal(stale.stale, true);
    assert.equal(stale.recentPast.total, 1);
});
