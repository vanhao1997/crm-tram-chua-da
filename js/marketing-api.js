import Papa from 'https://cdn.jsdelivr.net/npm/papaparse@5.4.1/+esm';

const MKT_URL = 'https://docs.google.com/spreadsheets/d/124VcfNpFqJKv400Jj156h2aYg4eurDzfJaEvs_wbNQ4/export?format=csv&gid=1227076939';

export async function fetchMarketingData() {
    return new Promise((resolve, reject) => {
        Papa.parse(MKT_URL, {
            download: true,
            header: false,
            complete: function (results) {
                const rows = results.data;
                if (rows.length < 4) {
                    reject('Marketing sheet format incorrect');
                    return;
                }

                // Row 1 is total: rows[1]
                const totals = {
                    spend: rows[1][5], // Tổng chi phí
                    revenue: rows[1][15], // DOANH SỐ
                    roas: rows[1][25], // Tỷ lệ Chi phí/Doanh thu
                    arrivedConv: rows[1][24] // Tỷ lệ KH Tới
                };

                // Funnel arrays
                const funnelNangCo = {
                    data: parseInt(rows[1][6]) || 0,
                    booked: parseInt(rows[1][9]) || 0,
                    arrived: parseInt(rows[1][12]) || 0
                };

                const funnelMuiChi = {
                    data: parseInt(rows[1][7]) || 0,
                    booked: parseInt(rows[1][10]) || 0,
                    arrived: parseInt(rows[1][13]) || 0
                };

                // Daily rows (from index 3 onwards)
                let dailyData = [];
                for (let i = 3; i < rows.length; i++) {
                    const r = rows[i];
                    if (!r[0] || !r[0].includes('/')) continue; // Skip empty rows or summary rows

                    dailyData.push({
                        date: r[0],
                        totalSpend: r[5] || '0 đ',
                        revenue: r[15] || '0 đ',
                        dataNangCo: r[6] || 0,
                        dataMuiChi: r[7] || 0,
                        bookedNangCo: r[9] || 0,
                        bookedMuiChi: r[10] || 0,
                        arrivedNangCo: r[12] || 0,
                        arrivedMuiChi: r[13] || 0,
                        cpaArrived: r[23] || '0 đ'
                    });
                }

                resolve({ totals, funnelNangCo, funnelMuiChi, dailyData });
            },
            error: function (err) {
                reject(err);
            }
        });
    });
}

export function renderMarketingDashboard(data) {
    // 1. KPI Cards
    document.getElementById('mktTổngChiPhí').textContent = data.totals.spend;
    document.getElementById('mktTổngDoanhSố').textContent = data.totals.revenue;
    document.getElementById('mktTỷLệChiPhí').textContent = data.totals.roas;
    document.getElementById('mktTỷLệTới').textContent = data.totals.arrivedConv;

    // 2. Table
    const tbody = document.getElementById('mktTableBody');
    tbody.innerHTML = '';
    data.dailyData.forEach(row => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
      <td><strong>${row.date}</strong></td>
      <td style="color:var(--danger-color)">${row.totalSpend}</td>
      <td style="color:var(--emerald-color);font-weight:bold;">${row.revenue}</td>
      <td>${row.dataNangCo}</td>
      <td>${row.dataMuiChi}</td>
      <td>${row.bookedNangCo}</td>
      <td>${row.bookedMuiChi}</td>
      <td><span class="badge badge--success">${row.arrivedNangCo}</span></td>
      <td><span class="badge badge--success">${row.arrivedMuiChi}</span></td>
      <td>${row.cpaArrived}</td>
    `;
        tbody.appendChild(tr);
    });

    // 3. Render ApexCharts Funnels
    renderFunnel('mktFunnelNangCo', data.funnelNangCo);
    renderFunnel('mktFunnelMuiChi', data.funnelMuiChi);
}

function renderFunnel(containerId, funnelData) {
    const container = document.getElementById(containerId);
    container.innerHTML = '';

    const options = {
        series: [
            {
                name: "Phễu chuyển đổi",
                data: [funnelData.data, funnelData.booked, funnelData.arrived],
            },
        ],
        chart: {
            type: 'bar',
            height: 350,
            dropShadow: {
                enabled: true,
            },
            toolbar: { show: false }
        },
        plotOptions: {
            bar: {
                borderRadius: 0,
                horizontal: true,
                barHeight: '80%',
                isFunnel: true,
            },
        },
        dataLabels: {
            enabled: true,
            formatter: function (val, opt) {
                return opt.w.globals.labels[opt.dataPointIndex] + ':  ' + val;
            },
            dropShadow: { enabled: true }
        },
        colors: ['#6366f1', '#f59e0b', '#10b981'],
        xaxis: {
            categories: ['DATA Nhận', 'Lịch Hẹn', 'Khách Tới'],
        },
        legend: { show: false },
        theme: { model: 'light' }
    };

    const chart = new ApexCharts(container, options);
    chart.render();
}
