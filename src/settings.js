import { readTelegramGroup, saveTelegramGroup } from './features/dashboard/telegram-settings.js';

const byId = id => document.getElementById(id);
const input = byId('telegramGroupId');
const feedback = byId('telegramGroupFeedback');
let defaultChatId = '';
input.value = readTelegramGroup();
function showDestination() {
    byId('telegramDestination').textContent = `Nhóm nhận: ${readTelegramGroup() || defaultChatId || 'Chưa cấu hình'}`;
}
showDestination();
byId('telegramGroupForm').addEventListener('submit', event => {
    event.preventDefault();
    try {
        saveTelegramGroup(input.value);
        input.value = readTelegramGroup();
        input.removeAttribute('aria-invalid');
        feedback.textContent = input.value ? 'Đã lưu nhóm nhận trên trình duyệt này.' : 'Đã chuyển sang nhóm mặc định của server.';
        showDestination();
    } catch (error) {
        input.setAttribute('aria-invalid', 'true');
        feedback.textContent = error.message;
        input.focus();
    }
});
byId('telegramGroupDefault').addEventListener('click', () => {
    input.value = '';
    byId('telegramGroupForm').requestSubmit();
});
window.addEventListener('storage', () => { input.value = readTelegramGroup(); showDestination(); });

fetch('/api/health').then(async r => {
    if (!r.ok) throw new Error('API');
    return r.json();
}).then(s => {
    byId('apiStatus').textContent = s.ok ? 'Hoạt động' : 'Không sẵn sàng';
    byId('settingsStatus').dataset.status = s.ok ? 'success' : 'error';
    byId('settingsStatus').querySelector('.data-status__text').textContent = s.ok ? 'API đã kết nối' : 'API chưa sẵn sàng';
}).catch(() => {
    byId('apiStatus').textContent = 'Lỗi kết nối';
    byId('settingsStatus').dataset.status = 'error';
    byId('settingsStatus').querySelector('.data-status__text').textContent = 'Không kết nối được API';
});
fetch('/api/telegram/settings').then(async r => {
    if (!r.ok) throw new Error('API');
    return r.json();
}).then(s => {
    defaultChatId = s.defaultChatId;
    byId('telegramStatus').textContent = s.botConfigured ? 'Bot đã cấu hình' : 'Chưa cấu hình bot';
    byId('telegramDefaultGroup').textContent = `Nhóm mặc định server: ${defaultChatId || 'Chưa cấu hình'}`;
    showDestination();
}).catch(() => {
    byId('telegramStatus').textContent = 'Không xác định';
    byId('telegramDefaultGroup').textContent = 'Không tải được cấu hình mặc định. Kiểm tra API server.';
});
