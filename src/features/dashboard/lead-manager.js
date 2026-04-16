/**
 * Lead Manager — UI logic for add/edit lead modals
 */
import { addLead, updateStatus, updateNote, checkDuplicate, getAppsScriptUrl, setAppsScriptUrl } from '../../core/api/sheets-write.js';

let currentData = null; // Reference to dashboard data
let onRefreshCallback = null;

/**
 * Initialize the lead manager
 */
export function initLeadManager({ getData, onRefresh }) {
    currentData = getData;
    onRefreshCallback = onRefresh;

    setupFAB();
    setupModals();
    setupTableRowClick();
}

// ─── FAB Button ───
function setupFAB() {
    const fab = document.getElementById('addLeadFab');
    if (fab) {
        fab.addEventListener('click', () => openAddModal());
    }
}

// ─── Modal Setup ───
function setupModals() {
    // Close modal on overlay click
    document.querySelectorAll('.modal-overlay').forEach(overlay => {
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) closeAllModals();
        });
    });

    // Close buttons
    document.querySelectorAll('.modal__close').forEach(btn => {
        btn.addEventListener('click', closeAllModals);
    });

    // Escape key closes modals
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeAllModals();
    });
    // Add Lead form submit
    const addForm = document.getElementById('addLeadForm');
    if (addForm) {
        addForm.addEventListener('submit', handleAddLead);
    }

    // Status dropdown change
    const statusSelect = document.getElementById('detailStatus');
    if (statusSelect) {
        statusSelect.addEventListener('change', handleStatusChange);
    }

    // Save note button
    const saveNoteBtn = document.getElementById('saveNoteBtn');
    if (saveNoteBtn) {
        saveNoteBtn.addEventListener('click', handleNoteUpdate);
    }
}

// ─── Table Row Click ───
function setupTableRowClick() {
    const tbody = document.getElementById('appointmentBody');
    if (tbody) {
        tbody.addEventListener('click', (e) => {
            const row = e.target.closest('tr[data-record-index]');
            if (!row) return;
            const idx = parseInt(row.dataset.recordIndex);
            const tab = row.dataset.recordTab || 'booked';
            const data = currentData ? currentData() : null;
            if (!data) return;

            let record;
            if (tab === 'booked') record = data.booked?.[idx];
            else if (tab === 'arrived') record = data.arrived?.[idx];
            else record = data.leads?.[idx];

            if (record) openDetailModal(record, tab, idx);
        });
    }
}

// ─── Add Lead Modal ───
function openAddModal() {
    if (!getAppsScriptUrl()) {
        showToast('Vui lòng nhập Apps Script URL trước', 'error');
        return;
    }
    const modal = document.getElementById('addLeadModal');
    if (modal) {
        modal.classList.add('active');
        document.getElementById('addLeadName')?.focus();
        // Clear previous duplicate warning
        const warn = document.getElementById('duplicateWarning');
        if (warn) warn.style.display = 'none';
    }
}

async function handleAddLead(e) {
    e.preventDefault();

    const name = document.getElementById('addLeadName')?.value.trim();
    const phone = document.getElementById('addLeadPhone')?.value.trim();
    const service = document.getElementById('addLeadService')?.value.trim();
    const source = document.getElementById('addLeadSource')?.value.trim();
    const note = document.getElementById('addLeadNote')?.value.trim();

    if (!name || !phone) {
        showToast('Vui lòng nhập Tên và SĐT', 'error');
        return;
    }

    // Validate phone format
    const cleanPhone = phone.replace(/\D/g, '');
    if (cleanPhone.length < 9 || cleanPhone.length > 11) {
        showToast('SĐT không hợp lệ (phải 9-11 số)', 'error');
        return;
    }

    // Check duplicate
    const data = currentData ? currentData() : null;
    if (data) {
        const dupes = checkDuplicate(phone, data);
        if (dupes.length > 0) {
            const warn = document.getElementById('duplicateWarning');
            if (warn) {
                warn.innerHTML = `⚠️ SĐT đã tồn tại: <strong>${dupes[0].name}</strong> (${dupes[0]._tab}) — Trạng thái: ${dupes[0].status || 'N/A'}`;
                warn.style.display = 'block';
            }
            // Ask for confirmation
            const forceAdd = document.getElementById('forceAddCheck');
            if (forceAdd && !forceAdd.checked) {
                showToast('SĐT đã tồn tại! Tick "Vẫn thêm" để tiếp tục', 'error');
                return;
            }
        }
    }

    // Submit
    const btn = document.getElementById('addLeadSubmitBtn');
    if (btn) { btn.disabled = true; btn.textContent = 'Đang thêm...'; }

    try {
        await addLead({ name, phone: cleanPhone, service, source, note });
        showToast(`Đã thêm lead: ${name}`, 'success');
        closeAllModals();
        document.getElementById('addLeadForm')?.reset();
        if (onRefreshCallback) onRefreshCallback();
    } catch (err) {
        showToast(`Lỗi: ${err.message}`, 'error');
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = 'Thêm Lead'; }
    }
}

// ─── Detail Modal ───
let currentDetail = { record: null, tab: '', row: -1 };

function openDetailModal(record, tab, rowIndex) {
    if (!getAppsScriptUrl()) {
        showToast('Vui lòng nhập Apps Script URL để chỉnh sửa', 'error');
        return;
    }
    currentDetail = { record, tab, row: rowIndex };

    document.getElementById('detailName').textContent = record.name || '--';
    document.getElementById('detailPhone').textContent = record.phone || '--';
    document.getElementById('detailService').textContent = record.service || '--';
    document.getElementById('detailSource').textContent = record.source || '--';
    document.getElementById('detailDate').textContent = record.aptDate
        ? `${record.aptDate.getDate()}/${record.aptDate.getMonth() + 1}/${record.aptDate.getFullYear()}`
        : record.date ? `${record.date.getDate()}/${record.date.getMonth() + 1}/${record.date.getFullYear()}` : '--';
    document.getElementById('detailStaff').textContent = record.staff || '--';

    // Set current status in dropdown
    const statusSelect = document.getElementById('detailStatus');
    if (statusSelect) {
        statusSelect.value = record.status || '';
    }

    // Set note
    const noteArea = document.getElementById('detailNote');
    if (noteArea) {
        noteArea.value = record.note || '';
    }

    const modal = document.getElementById('detailModal');
    if (modal) modal.classList.add('active');
}

async function handleStatusChange() {
    const newStatus = document.getElementById('detailStatus')?.value;
    if (!newStatus || !currentDetail.record) return;

    try {
        await updateStatus({
            phone: currentDetail.record.phone,
            tab: currentDetail.tab,
            row: currentDetail.row,
            status: newStatus
        });
        showToast(`Trạng thái → ${newStatus}`, 'success');
        if (onRefreshCallback) onRefreshCallback();
    } catch (err) {
        showToast(`Lỗi: ${err.message}`, 'error');
    }
}

async function handleNoteUpdate() {
    const note = document.getElementById('detailNote')?.value.trim();
    if (!currentDetail.record) return;

    const btn = document.getElementById('saveNoteBtn');
    if (btn) { btn.disabled = true; btn.textContent = 'Đang lưu...'; }

    try {
        await updateNote({
            phone: currentDetail.record.phone,
            tab: currentDetail.tab,
            row: currentDetail.row,
            note
        });
        showToast('Đã lưu ghi chú', 'success');
        if (onRefreshCallback) onRefreshCallback();
    } catch (err) {
        showToast(`Lỗi: ${err.message}`, 'error');
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = 'Lưu ghi chú'; }
    }
}

// ─── Helpers ───
function closeAllModals() {
    document.querySelectorAll('.modal-overlay').forEach(m => m.classList.remove('active'));
}

function showToast(msg, type = 'info') {
    const container = document.getElementById('toastContainer');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = `toast toast--${type}`;
    toast.textContent = msg;
    container.appendChild(toast);
    setTimeout(() => {
        toast.style.animation = 'toastOut 0.3s ease-in forwards';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}
