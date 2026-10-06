export async function fetchOverview({ period = 'month', from = '', to = '', signal } = {}) {
  const params = new URLSearchParams({ period });
  if (period === 'custom') {
    params.set('from', from);
    params.set('to', to);
  }
  const response = await fetch(`/api/overview?${params}`, { cache: 'no-store', signal });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok && isOverviewPayload(payload)) {
    payload.metadata.httpStatus = response.status;
    return payload;
  }
  if (!response.ok) {
    const error = new Error(payload.error || 'Overview request failed');
    error.code = payload.code || 'OVERVIEW_REQUEST_FAILED';
    error.status = response.status;
    throw error;
  }
  if (!isOverviewPayload(payload)) {
    const error = new Error('Dữ liệu tổng quan không hợp lệ');
    error.code = 'INVALID_OVERVIEW_PAYLOAD';
    error.status = response.status;
    throw error;
  }
  return payload;
}

function isOverviewPayload(value) {
  return Boolean(value && typeof value === 'object'
    && value.period && typeof value.period === 'object'
    && value.metadata && typeof value.metadata === 'object'
    && value.crm && typeof value.crm === 'object'
    && value.marketing && typeof value.marketing === 'object');
}
