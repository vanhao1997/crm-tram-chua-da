import test from 'node:test';
import assert from 'node:assert/strict';
import { getOverdueAppointments } from '../../features/appointments/appointments.js';

test('overdue appointments use Vietnam day and do not treat a previous visit as a new booking arrival', () => {
    const booking = { phone: '0841234567', date: '2026-10-01', aptDate: '2026-10-05', status: 'Đặt Hẹn' };
    const oldVisit = { phone: '0841234567', date: '2026-09-01', aptDate: '2026-09-05' };
    const now = new Date('2026-10-05T18:00:00Z'); // October 6 in Vietnam.
    assert.equal(getOverdueAppointments([booking], [oldVisit], now).length, 1);
    assert.equal(getOverdueAppointments([booking], [{ ...booking, aptDate: '2026-10-06' }], now).length, 0);
    assert.equal(getOverdueAppointments([{ ...booking, status: 'Dời Lịch' }], [], now).length, 0);
    assert.equal(getOverdueAppointments([{ ...booking, phone: '' }], [{ ...booking, phone: '' }], now).length, 1);
});
