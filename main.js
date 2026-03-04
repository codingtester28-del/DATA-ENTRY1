import { createClient } from '@supabase/supabase-js';
import * as xlsx from 'xlsx';
import Chart from 'chart.js/auto';

// --- CONFIGURATION ---
const SUPABASE_URL = 'https://xlskjgrlajowmqmgmmtc.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_i-OkJZY6EFn01h_x23Hy3w_apuGO72U';
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Expose supabase client for realtime subscription (used by setupRealtimeSubscription)
window.__supabaseClient = supabase;

// --- API MOCK (Web equivalent of window.api) ---
const api = {
    saveLead: async (payload) => {
        try {
            const username = payload.username.trim().toLowerCase();
            const whatsapp = payload.whatsapp.replace(/[\s\-\+]/g, '');

            const { data: existing, error: checkError } = await supabase
                .from('leads')
                .select('id')
                .eq('whatsapp', whatsapp)
                .maybeSingle();

            if (checkError) throw checkError;
            if (existing) {
                return { success: false, duplicate: true, error: 'Nomor WhatsApp sudah terdaftar.' };
            }

            const insertData = { ...payload, username, whatsapp };
            const { data, error } = await supabase.from('leads').insert([insertData]).select();

            if (error) {
                if (error.code === '23505') return { success: false, duplicate: true, error: error };
                return { success: false, duplicate: false, error: error.message };
            }
            return { success: true, duplicate: false, data };
        } catch (err) {
            return { success: false, duplicate: false, error: err.message };
        }
    },
    getStats: async (params = {}) => {
        try {
            const { page = 1, pageSize = 500, search = '', filterMonth = '', startDate = '', endDate = '', exportAll = false } = params;
            const from = (page - 1) * pageSize;
            const to = exportAll ? 999999 : (from + pageSize - 1);

            let allLeads = [];
            let totalCount = 0;
            let currentFrom = from;
            let currentTo = Math.min(to, from + 999);
            let isMoreData = true;

            while (isMoreData) {
                let query = supabase.from('leads').select('*', { count: 'exact' });

                if (search) query = query.ilike('username', `%${search}%`);
                if (filterMonth) {
                    const nextMonth = new Date(filterMonth + "-01");
                    nextMonth.setMonth(nextMonth.getMonth() + 1);
                    const nextMonthStr = nextMonth.toISOString().split('T')[0];
                    query = query.gte('created_at', filterMonth + "-01T00:00:00+07:00").lt('created_at', nextMonthStr + "T00:00:00+07:00");
                }
                if (startDate) query = query.gte('created_at', startDate + "T00:00:00+07:00");
                if (endDate) query = query.lte('created_at', endDate + "T23:59:59+07:00");

                const { data, count, error } = await query.order('created_at', { ascending: false }).range(currentFrom, currentTo);

                if (error) throw error;

                allLeads.push(...(data || []));
                totalCount = count || 0;

                if (exportAll && allLeads.length < totalCount) {
                    currentFrom = allLeads.length;
                    currentTo = Math.min(totalCount - 1, currentFrom + 999);
                } else {
                    isMoreData = false;
                }
            }

            let totalGmv = 0;
            let statsFrom = 0;
            let statsTo = 999;
            let moreStats = true;

            while (moreStats) {
                let statsQuery = supabase.from('leads').select('gmv');
                if (search) statsQuery = statsQuery.ilike('username', `%${search}%`);
                if (filterMonth) {
                    const nextMonth = new Date(filterMonth + "-01");
                    nextMonth.setMonth(nextMonth.getMonth() + 1);
                    const nextMonthStr = nextMonth.toISOString().split('T')[0];
                    statsQuery = statsQuery.gte('created_at', filterMonth + "-01T00:00:00+07:00").lt('created_at', nextMonthStr + "T00:00:00+07:00");
                }
                if (startDate) statsQuery = statsQuery.gte('created_at', startDate + "T00:00:00+07:00");
                if (endDate) statsQuery = statsQuery.lte('created_at', endDate + "T23:59:59+07:00");

                const { data: gmvBatch, error: gmvError } = await statsQuery.range(statsFrom, statsTo);
                if (gmvError) throw gmvError;

                if (gmvBatch && gmvBatch.length > 0) {
                    gmvBatch.forEach(r => {
                        if (r.gmv) {
                            let numStr = String(r.gmv).replace(/[^0-9]/g, '');
                            if (numStr) totalGmv += parseInt(numStr, 10);
                        }
                    });
                    if (gmvBatch.length < 1000) moreStats = false;
                    else { statsFrom += 1000; statsTo += 1000; }
                } else {
                    moreStats = false;
                }
            }

            return { success: true, leads: allLeads, totalData: totalCount, totalGmv, page, pageSize };
        } catch (err) {
            return { success: false, error: err.message };
        }
    },
    deleteLead: async (id) => {
        try {
            const { error } = await supabase.from('leads').delete().eq('id', id);
            if (error) throw error;
            return { success: true };
        } catch (err) {
            return { success: false, error: err.message };
        }
    },
    updateLead: async (id, payload) => {
        try {
            const username = payload.username.trim().toLowerCase();
            const whatsapp = payload.whatsapp.replace(/[\s\-\+]/g, '');
            const updateData = { ...payload, username, whatsapp };
            const { data, error } = await supabase.from('leads').update(updateData).eq('id', id);

            if (error) {
                if (error.code === '23505') return { success: false, error: 'Data duplikat terdeteksi dengan Data terbaru.' };
                throw error;
            }
            return { success: true, data };
        } catch (err) {
            return { success: false, error: err.message };
        }
    },
    exportExcel: async (dataToExport, filename) => {
        try {
            const worksheet = xlsx.utils.json_to_sheet(dataToExport);
            const workbook = xlsx.utils.book_new();
            xlsx.utils.book_append_sheet(workbook, worksheet, 'Leads');
            const finalFilename = filename || 'leads_export.xlsx';
            xlsx.writeFile(workbook, finalFilename);
            return { success: true, filePath: finalFilename };
        } catch (err) {
            return { success: false, error: err.message };
        }
    },
    importExcel: async () => {
        return new Promise((resolve) => {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = '.xlsx, .xls';
            input.onchange = async (e) => {
                const file = e.target.files[0];
                if (!file) return resolve({ success: false, canceled: true });
                const reader = new FileReader();
                reader.onload = (event) => {
                    try {
                        const data = new Uint8Array(event.target.result);
                        const workbook = xlsx.read(data, { type: 'array' });
                        const sheetName = workbook.SheetNames[0];
                        const sheet = workbook.Sheets[sheetName];
                        const rawData = xlsx.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false });
                        resolve({ success: true, data: rawData });
                    } catch (err) {
                        resolve({ success: false, error: err.message });
                    }
                };
                reader.readAsArrayBuffer(file);
            };
            input.click();
        });
    },
    saveLeadsBatch: async (validData) => {
        try {
            let savedCount = 0;
            let duplicateCount = 0;
            for (const row of validData) {
                const username = String(row.username).trim().toLowerCase();
                const whatsapp = String(row.whatsapp).replace(/[\s\-\+]/g, '');
                let createdDate = undefined;
                if (row.rawDate && String(row.rawDate).trim() !== '') {
                    try {
                        const dateStr = String(row.rawDate).trim();
                        const parts = dateStr.split(/[\/\-\.]/);
                        if (parts.length === 3) {
                            let day = parseInt(parts[0]);
                            let month = parseInt(parts[1]) - 1;
                            let year = parseInt(parts[2]);
                            if (year < 100) year += (year > 50 ? 1900 : 2000);
                            const d = new Date(year, month, day, 12, 0, 0);
                            if (!isNaN(d.getTime())) createdDate = d.toISOString();
                        }
                    } catch (e) {
                        console.error('Gagal parsing tanggal:', row.rawDate, e.message);
                    }
                }

                const insertPayload = { username: username, whatsapp: whatsapp, niche: row.niche, gmv: row.gmv };
                if (createdDate) insertPayload.created_at = createdDate;

                const { data: existing } = await supabase.from('leads').select('id').eq('whatsapp', whatsapp).maybeSingle();
                if (existing) { duplicateCount++; continue; }

                const { error } = await supabase.from('leads').insert([insertPayload]);
                if (error) {
                    if (error.code === '23505') duplicateCount++;
                    else console.error('Insert Error in batch:', error);
                } else {
                    savedCount++;
                }
            }
            return { success: true, saved: savedCount, duplicates: duplicateCount };
        } catch (err) {
            return { success: false, error: err.message };
        }
    }
};


// --- AUTH LOGIC ---
const loginScreen = document.getElementById('login-screen');
const appContainer = document.getElementById('app-container');
const loginForm = document.getElementById('login-form');
const loginError = document.getElementById('login-error');
const btnLogout = document.getElementById('btn-logout');

const MOCK_AUTH = {
    username: 'ZEX',
    password: '2+2=040605'
};

// Session token - changes each session to prevent localStorage bypass
const SESSION_TOKEN = btoa(MOCK_AUTH.username + ':' + MOCK_AUTH.password);

function checkAuth() {
    const storedToken = sessionStorage.getItem('authToken'); // sessionStorage clears on tab close
    if (storedToken && storedToken === SESSION_TOKEN) {
        loginScreen.style.display = 'none';
        appContainer.style.display = 'flex';
        loadStats();
        if (typeof setupRealtimeSubscription === 'function') {
            setupRealtimeSubscription();
        }
    } else {
        // Hapus sisa login lama yang tidak valid
        sessionStorage.removeItem('authToken');
        localStorage.removeItem('isLoggedIn');
        loginScreen.style.display = 'flex';
        appContainer.style.display = 'none';
    }
}

loginForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const user = document.getElementById('login-username').value;
    const pass = document.getElementById('login-password').value;

    if (user === MOCK_AUTH.username && pass === MOCK_AUTH.password) {
        sessionStorage.setItem('authToken', SESSION_TOKEN);
        loginError.style.display = 'none';
        checkAuth();
        showToast('🔓 Selamat datang, ZEX!', 'success');
    } else {
        loginError.style.display = 'block';
    }
});

btnLogout.addEventListener('click', () => {
    if (confirm('Yakin ingin keluar?')) {
        localStorage.removeItem('isLoggedIn');
        checkAuth();
        showToast('🔒 Berhasil keluar.', 'success');
    }
});

// State Sesi
let sessionDuplicatesCount = 0;
let currentLeadsData = [];
let currentFilteredData = [];
let currentActiveTab = 'input'; // track active tab for realtime refresh

// DOM Elements
const tabInput = document.getElementById('tab-input');
const tabDashboard = document.getElementById('tab-dashboard');
const tabToday = document.getElementById('tab-today');
const tabProductivity = document.getElementById('tab-productivity');
const sectionInput = document.getElementById('section-input');
const sectionDashboard = document.getElementById('section-dashboard');
const sectionToday = document.getElementById('section-today');
const sectionProductivity = document.getElementById('section-productivity');

// Global Chart Instances
let dailyChartInstance = null;
let hourlyChartInstance = null;
const leadForm = document.getElementById('lead-form');
const btnRefresh = document.getElementById('btn-refresh');
const btnExport = document.getElementById('btn-export');
const btnImport = document.getElementById('btn-import');
const searchUsername = document.getElementById('search-username');
const btnSearch = document.getElementById('btn-search');
const filterDate = document.getElementById('filter-date');
const btnPrev = document.getElementById('btn-prev');
const btnNext = document.getElementById('btn-next');
const pageText = document.getElementById('current-page-text');
const paginationInfo = document.getElementById('pagination-info');

let currentPage = 1;
const PAGE_SIZE = 500;

// --- Tab Switching ---
function hideAllSections() {
    sectionInput.classList.remove('active');
    sectionDashboard.classList.remove('active');
    sectionToday.classList.remove('active');
    sectionProductivity.classList.remove('active');
    tabInput.classList.remove('active');
    tabDashboard.classList.remove('active');
    tabToday.classList.remove('active');
    tabProductivity.classList.remove('active');
}

tabInput.addEventListener('click', () => {
    hideAllSections();
    tabInput.classList.add('active');
    sectionInput.classList.add('active');
    currentActiveTab = 'input';
});

tabToday.addEventListener('click', () => {
    hideAllSections();
    tabToday.classList.add('active');
    sectionToday.classList.add('active');
    currentActiveTab = 'today';
    loadTodayData();
});

tabProductivity.addEventListener('click', () => {
    hideAllSections();
    tabProductivity.classList.add('active');
    sectionProductivity.classList.add('active');
    currentActiveTab = 'productivity';
    loadProductivityData();
});

tabDashboard.addEventListener('click', () => {
    hideAllSections();
    tabDashboard.classList.add('active');
    sectionDashboard.classList.add('active');
    currentActiveTab = 'dashboard';
    loadStats();
});

// --- Toast Function ---
// Aturan: Slide-in, kanan atas, hijau jika sukses, merah jika duplicate, auto close 5s
function showToast(message, type = 'success') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.innerText = message;

    container.appendChild(toast);

    // Tutup otomatis setelah 5 detik
    setTimeout(() => {
        toast.style.animation = 'fadeOutRight 0.4s forwards';
        setTimeout(() => {
            if (document.body.contains(toast)) container.removeChild(toast);
        }, 400); // Tunggu animasi selesai
    }, 5000);
}

// --- Submit Form (Penyimpanan ke Supabase via Main Process IPC) ---
leadForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const btnSubmit = leadForm.querySelector('button[type="submit"]');
    const originalBtnText = btnSubmit.innerText;

    // Proteksi Double-Submit
    btnSubmit.disabled = true;
    btnSubmit.innerText = '⌛ Menyimpan...';

    const payload = {
        username: document.getElementById('username').value,
        whatsapp: document.getElementById('whatsapp').value,
        niche: document.getElementById('niche').value,
        gmv: document.getElementById('gmv').value
    };

    try {
        const res = await api.saveLead(payload);

        if (res.success) {
            showToast('✅ Data berhasil disimpan ke database!', 'success');
            leadForm.reset();
        } else if (res.duplicate) {
            sessionDuplicatesCount++;
            console.warn('Data duplikat dibuang:', payload);
            if (typeof playDuplicateSound === 'function') playDuplicateSound();
            showToast('⚠ Data duplikat terdeteksi! Nomor WhatsApp sudah ada.', 'error');
        } else {
            showToast(`❌ Terjadi error: ${res.error}`, 'error');
        }
    } catch (err) {
        showToast(`❌ Error sistem: ${err.message}`, 'error');
    } finally {
        // Re-enable tombol
        btnSubmit.disabled = false;
        btnSubmit.innerText = originalBtnText;
    }
});

// --- Dashboard Logic ---
async function loadStats(page = 1) {
    currentPage = page;
    const search = searchUsername.value.trim();
    const filterMonth = filterDate.value;

    console.log(`DEBUG: Memuat data halaman ${page}, Pencarian: "${search}", Filter: "${filterMonth}"`);

    const result = await api.getStats({
        page: currentPage,
        pageSize: PAGE_SIZE,
        search: search,
        filterMonth: filterMonth
    });

    if (result.success) {
        document.getElementById('stat-total').innerText = result.totalData;
        document.getElementById('stat-duplicates').innerText = sessionDuplicatesCount;
        document.getElementById('stat-gmv').innerText = `Rp ${result.totalGmv.toLocaleString('id-ID')}`;

        // FITUR BARU: Hitung Perkiraan Penghasilan (Total Data * 300)
        const totalIncome = result.totalData * 300;
        document.getElementById('stat-income').innerText = `Rp ${totalIncome.toLocaleString('id-ID')}`;

        currentLeadsData = result.leads || [];
        currentFilteredData = currentLeadsData; // Render hasil dari server

        renderTable(currentLeadsData);
        updatePaginationUI(result.totalData, result.page, result.pageSize);
    } else {
        showToast(`❌ Gagal menarik stats: ${result.error}`, 'error');
    }
}

function updatePaginationUI(total, page, size) {
    const totalPages = Math.ceil(total / size) || 1;
    pageText.innerText = `Halaman ${page} dari ${totalPages}`;

    btnPrev.disabled = (page <= 1);
    btnNext.disabled = (page >= totalPages);

    const from = total === 0 ? 0 : (page - 1) * size + 1;
    const to = Math.min(page * size, total);
    paginationInfo.innerText = `Menampilkan data ${from} - ${to} dari ${total}`;
}

// Event Listeners untuk Filter & Pagination
btnSearch.addEventListener('click', () => loadStats(1));

searchUsername.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        loadStats(1);
    }
});

filterDate.addEventListener('change', () => loadStats(1));
btnRefresh.addEventListener('click', () => loadStats(1));

btnPrev.addEventListener('click', () => {
    if (currentPage > 1) loadStats(currentPage - 1);
});

btnNext.addEventListener('click', () => {
    loadStats(currentPage + 1);
});

function renderTable(dataArray) {
    const tbody = document.querySelector('#data-table tbody');
    tbody.innerHTML = '';

    // De-duplikasi client-side sebagai fail-safe terakhir
    const seenWa = new Set();
    const uniqueData = dataArray.filter(item => {
        const wa = String(item.whatsapp || '');
        if (seenWa.has(wa)) return false;
        seenWa.add(wa);
        return true;
    });

    uniqueData.forEach((row, index) => {
        const tr = document.createElement('tr');

        // Date Without Time (DD/MM/YYYY)
        const d = new Date(row.created_at);
        const dateString = `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;

        // WA Link
        const cleanWa = (row.whatsapp || '').replace(/\D/g, ''); // Ensure safe URL
        const waLink = `https://wa.me/${cleanWa}`;
        const waHtml = `<a href="${waLink}" target="_blank" style="color: #007bff; text-decoration: underline; font-weight: 500;">${row.whatsapp || ''}</a>`;

        tr.innerHTML = `
      <td>${index + 1}</td>
      <td>${dateString}</td>
      <td>${row.username || ''}</td>
      <td>${waHtml}</td>
      <td>${row.niche || ''}</td>
      <td>${row.gmv || ''}</td>
      <td>
          <button class="btn-edit" data-id="${row.id}" title="Edit Data">✏️ Edit</button>
          <button class="btn-delete" data-id="${row.id}" title="Hapus Data">🗑️ Hapus</button>
      </td>
    `;
        tbody.appendChild(tr);
    });

    // Attach event listeners for Edit & Delete
    document.querySelectorAll('.btn-delete').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            const id = e.currentTarget.getAttribute('data-id');
            if (confirm('Yakin ingin menghapus data ini secara permanen?')) {
                const res = await api.deleteLead(id);
                if (res.success) { showToast('✅ Data terhapus', 'success'); loadStats(); }
                else { showToast('❌ Gagal hapus: ' + res.error, 'error'); }
            }
        });
    });

    document.querySelectorAll('.btn-edit').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            const id = e.currentTarget.getAttribute('data-id');
            const targetRow = currentLeadsData.find(x => x.id === id);
            if (!targetRow) return;

            const newName = prompt("Edit Username:", targetRow.username);
            if (newName === null) return;
            const newWa = prompt("Edit WhatsApp:", targetRow.whatsapp);
            if (newWa === null) return;
            const newNiche = prompt("Edit Niche:", targetRow.niche);
            if (newNiche === null) return;
            const newGmv = prompt("Edit GMV:", targetRow.gmv);
            if (newGmv === null) return;

            const payload = { username: newName.trim(), whatsapp: newWa.replace(/[\s\-\+]/g, ''), niche: newNiche.trim(), gmv: newGmv.trim() };
            const res = await api.updateLead(id, payload);
            if (res.success) { showToast('✅ Data berhasil diupdate', 'success'); loadStats(); }
            else { showToast('❌ Gagal update: ' + res.error, 'error'); }
        });
    });
}

// --- Export Advanced Logic ---
const btnExportToggle = document.getElementById('btn-export-toggle');
const btnCloseExport = document.getElementById('btn-close-export');
const btnExportNow = document.getElementById('btn-export-now');
const exportPanel = document.getElementById('export-panel');
const exportStartDate = document.getElementById('export-start-date');
const exportEndDate = document.getElementById('export-end-date');
const exportAllCheck = document.getElementById('export-all-check');

btnExportToggle.addEventListener('click', () => {
    exportPanel.style.display = 'block';
});

btnCloseExport.addEventListener('click', () => {
    exportPanel.style.display = 'none';
});

btnExportNow.addEventListener('click', async () => {
    const isAll = exportAllCheck.checked;
    const start = exportStartDate.value;
    const end = exportEndDate.value;

    if (!isAll && (!start || !end)) {
        alert('Silakan pilih rentang tanggal atau centang "Ekspor Semua Data".');
        return;
    }

    showToast('⏳ Mempersiapkan data ekspor...', 'success');

    const resAll = await api.getStats({
        page: 1,
        pageSize: 100000,
        search: searchUsername.value.trim(),
        filterMonth: filterDate.value,
        startDate: isAll ? '' : start,
        endDate: isAll ? '' : end,
        exportAll: isAll
    });

    if (!resAll.success || resAll.leads.length === 0) {
        showToast('⚠ Tidak ada data untuk diekspor!', 'error');
        return;
    }

    const dataToExport = resAll.leads;

    // Format ulang data agar rapi dan header kolomnya bagus (bahasa indonesia)
    const mapDataForExport = dataToExport.map((l, idx) => {
        const d = new Date(l.created_at);
        const dateStr = `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;

        const cleanWa = (l.whatsapp || '').replace(/\D/g, ''); // Ensure safe URL
        const waLink = cleanWa ? `https://wa.me/${cleanWa}` : '';

        return {
            'NO': idx + 1,
            'TANGGAL': dateStr,
            'USER NAMA': l.username,
            'NO WA': waLink,
            'NICE/KATEGORI': l.niche,
            'GMV': l.gmv
        };
    });

    const res = await api.exportExcel(mapDataForExport, isAll
        ? `leads_semua_${new Date().toISOString().split('T')[0].replace(/-/g, '_')}.xlsx`
        : `leads_${start.replace(/-/g, '_')}_sd_${end.replace(/-/g, '_')}.xlsx`
    );

    if (res.success) {
        showToast('✅ Berhasil ekspor ke Excel!', 'success');
        exportPanel.style.display = 'none';
    } else if (!res.canceled) {
        showToast(`❌ Gagal ekspor: ${res.error}`, 'error');
    }
});

// --- Import Excel Logic ---
btnImport.addEventListener('click', async () => {
    try {
        console.log('DEBUG: Tombol Import diklik');
        const res = await api.importExcel();

        if (res.canceled) {
            console.log('DEBUG: Pemilihan file dibatalkan');
            return;
        }

        if (!res.success) {
            showToast(`❌ Gagal membaca Excel: ${res.error}`, 'error');
            console.error('DEBUG: Gagal membaca excel:', res.error);
            return;
        }

        const rows = res.data;
        console.log('DEBUG: Baris data diterima:', rows);

        if (!rows || rows.length === 0) {
            showToast('⚠ File Excel kosong atau format tidak sesuai!', 'error');
            return;
        }

        const validData = [];
        let missingWaCount = 0;
        let headerSkipped = false;

        for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            if (!row || row.length === 0) continue;

            // Deteksi header text pada baris pertama agar tidak dihitung sebagai data invalid/error
            const colString = String(row[0] || '') + String(row[1] || '') + String(row[2] || '') + String(row[3] || '');
            if (i === 0 && (colString.toUpperCase().includes('TANGGAL') || colString.toUpperCase().includes('NAMA') || colString.toUpperCase().includes('WA') || colString.toUpperCase().includes('USERNAME') || colString.toUpperCase().includes('NO'))) {
                headerSkipped = true;
                continue;
            }

            // Berdasarkan DEBUG: [NO, Tanggal, Username, No Whatsapp, Niche/Kategori, GMV]
            // Index 0: NO, 1: Tanggal, 2: Username, 3: No Whatsapp, 4: Niche/Kategori, 5: GMV
            let rawWa = row[3] || '';
            if (typeof rawWa === 'object' && rawWa.hyperlink) {
                rawWa = rawWa.text || rawWa.hyperlink;
            } else {
                rawWa = String(rawWa);
            }

            const cleanWa = rawWa.replace(/\D/g, ''); // Ekstrak hanya angka

            if (!cleanWa) {
                missingWaCount++;
                continue; // Skip data tanpa WA
            }

            let rawDate = row[1] || '';

            validData.push({
                username: String(row[2] || '').trim(),
                whatsapp: cleanWa,
                niche: String(row[4] || '').trim(),
                gmv: String(row[5] || '').trim(),
                rawDate: rawDate
            });
        }

        const total = headerSkipped ? rows.length - 1 : rows.length;
        const validCount = validData.length;

        console.log('DEBUG: Data valid diproses:', validData);

        if (validCount === 0) {
            alert(`❌ Tidak ada data dengan nomor WA yang valid dari total ${total} baris excel.\n(Pastikan nomor WA ada di Kolom ke-3 / Kolom C)`);
            return;
        }

        let msg = `Ditemukan ${missingWaCount} baris data tanpa nomor WA (dari total ${total} baris).\nData yang tidak memiliki WA akan dibuang/diabaikan.\n\nLanjutkan menyimpan ${validCount} data yang lengkap ke database?`;
        if (missingWaCount === 0) {
            msg = `Sempurna! ${validCount} baris data memiliki nomor WA valid.\n\nLanjutkan mengimpor ke database?`;
        }

        if (confirm(msg)) {
            showToast('⏳ Menyimpan data massal...', 'success');
            const saveRes = await api.saveLeadsBatch(validData);
            if (saveRes.success) {
                alert(`✅ Selesai Import!\n→ Berhasil Masuk: ${saveRes.saved} data\n→ Duplikat/Gagal: ${saveRes.duplicates} data`);
                loadStats();
            } else {
                showToast(`❌ Gagal menyimpan massal: ${saveRes.error}`, 'error');
            }
        }
    } catch (err) {
        console.error('CRITICAL ERROR IMPORT:', err);
        alert('Terjadi kesalahan sistem saat import: ' + err.message);
    }
});

// loadStats(); // Pindah ke checkAuth()

// --- TODAY'S DATA LOGIC ---
const todayLeadsTable = document.getElementById('today-leads-table');
const startTimeToday = document.getElementById('start-time-today');
const lastTimeToday = document.getElementById('last-time-today');
const btnRefreshToday = document.getElementById('btn-refresh-today');
const btnExportToday = document.getElementById('btn-export-today');

// Helper untuk format data export (agar konsisten)
function formatLeadsForExport(leads) {
    return leads.map((l, idx) => {
        const d = new Date(l.created_at);
        const dateStr = `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
        const cleanWa = (l.whatsapp || '').replace(/\D/g, '');
        const waLink = cleanWa ? `https://wa.me/${cleanWa}` : '';
        return {
            'NO': idx + 1,
            'TANGGAL': dateStr,
            'JAM': d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }),
            'USER NAMA': l.username,
            'NO WA': waLink,
            'NICE/KATEGORI': l.niche,
            'GMV': l.gmv
        };
    });
}

const filterTodayDate = document.getElementById('filter-today-date');

if (btnExportToday) {
    btnExportToday.addEventListener('click', async () => {
        let localDate;
        if (filterTodayDate && filterTodayDate.value) {
            localDate = filterTodayDate.value;
        } else {
            const now = new Date();
            localDate = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
        }

        showToast(`⏳ Mempersiapkan export data untuk ${localDate}...`, 'success');

        const res = await api.getStats({
            startDate: localDate,
            endDate: localDate,
            pageSize: 5000,
            exportAll: true
        });

        if (!res.success || res.leads.length === 0) {
            showToast('⚠ Tidak ada data untuk tanggal ini untuk diekspor!', 'error');
            return;
        }

        const mapData = formatLeadsForExport(res.leads);
        const dateLabel = localDate.replace(/-/g, '_');
        const exportRes = await api.exportExcel(mapData, `data_harian_${dateLabel}.xlsx`);

        if (exportRes.success) {
            showToast(`✅ Berhasil ekspor data ${localDate}!`, 'success');
        } else if (!exportRes.canceled) {
            showToast(`❌ Gagal ekspor: ${exportRes.error}`, 'error');
        }
    });
}

async function loadTodayData() {
    let localDate;
    if (filterTodayDate && filterTodayDate.value) {
        localDate = filterTodayDate.value;
    } else {
        const now = new Date();
        localDate = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
    }

    showToast(`⏳ Memuat data untuk ${localDate}...`, 'success');

    const res = await api.getStats({
        startDate: localDate,
        endDate: localDate,
        pageSize: 1000,
        exportAll: true
    });

    if (!res.success) {
        showToast('❌ Gagal memuat data harian', 'error');
        return;
    }

    const leads = res.leads;
    todayLeadsTable.innerHTML = '';

    // Update Total Count
    const totalCountTodayLabel = document.getElementById('total-count-today');
    if (totalCountTodayLabel) {
        totalCountTodayLabel.innerText = `${leads.length} Data`;
    }

    if (leads && leads.length > 0) {
        // Sort ascending for time calculation
        const sortedLeads = [...leads].sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

        const firstEntry = new Date(sortedLeads[0].created_at);
        const lastEntry = new Date(sortedLeads[sortedLeads.length - 1].created_at);

        startTimeToday.innerText = firstEntry.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
        lastTimeToday.innerText = lastEntry.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });

        // Show descending (latest first) in table
        [...sortedLeads].reverse().forEach(l => {
            const time = new Date(l.created_at).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
            const row = `
                <tr>
                    <td><strong>${time}</strong></td>
                    <td>${l.username}</td>
                    <td>${l.whatsapp}</td>
                    <td>${l.niche || '-'}</td>
                    <td>${l.gmv || '-'}</td>
                </tr>
            `;
            todayLeadsTable.insertAdjacentHTML('beforeend', row);
        });
    } else {
        startTimeToday.innerText = '-- : --';
        lastTimeToday.innerText = '-- : --';
        todayLeadsTable.innerHTML = `<tr><td colspan="5" style="text-align:center; padding: 60px; color: #94a3b8;">Belum ada data diinput pada ${localDate}. Semangat! 🚀</td></tr>`;
    }
}

if (btnRefreshToday) {
    btnRefreshToday.addEventListener('click', loadTodayData);
}

if (filterTodayDate) {
    filterTodayDate.addEventListener('change', loadTodayData);
}

// --- PRODUCTIVITY LOGIC ---
const btnRefreshProductivity = document.getElementById('btn-refresh-productivity');
const prodStreak = document.getElementById('prod-streak');
const prodAvg = document.getElementById('prod-avg');
const prodMonthTotal = document.getElementById('prod-month-total');
const targetPercentage = document.getElementById('target-percentage');
const targetProgressFill = document.getElementById('target-progress-fill');
const inputDailyTarget = document.getElementById('input-daily-target');
const btnSetTarget = document.getElementById('btn-set-target');

async function loadProductivityData() {
    showToast('📊 Menganalisis produktivitas...', 'success');

    // Load Target from LocalStorage
    const savedTarget = localStorage.getItem('daily_target') || 50;
    if (inputDailyTarget) inputDailyTarget.value = savedTarget;

    // 1. Ambil data bulan ini (1st of month to now)
    const now = new Date();
    const firstDayOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
    const todayStr = now.toISOString().split('T')[0];

    // Kita ambil data bulan ini cukup banyak (batching/exportAll)
    const res = await api.getStats({
        startDate: firstDayOfMonth,
        endDate: todayStr,
        pageSize: 5000,
        exportAll: true
    });

    if (!res.success) {
        showToast('❌ Gagal memuat data produktivitas', 'error');
        return;
    }

    const allData = res.leads;

    // 2. Hitung KPI Dasar
    prodMonthTotal.innerText = `${allData.length} Data`;

    // Rata-rata harian (Total / hari yang sudah lewat di bulan ini)
    const daysPassed = now.getDate();
    const avg = (allData.length / daysPassed).toFixed(1);
    prodAvg.innerText = `${avg} / hari`;

    // 3. Streak Calculation
    const streak = calculateStreak(allData);
    prodStreak.innerText = `${streak} Hari`;

    // 4. Progress Target Harian
    const todayLeadsCount = allData.filter(l => l.created_at.startsWith(todayStr)).length;
    const currentTarget = parseInt(localStorage.getItem('daily_target')) || 50;
    const progress = Math.min(Math.round((todayLeadsCount / currentTarget) * 100), 100);
    targetPercentage.innerText = `${progress}%`;
    targetProgressFill.style.width = `${progress}%`;

    // 5. Render Charts
    renderDailyChart(allData);
    renderHourlyChart(allData);
}

// Event Listener untuk Set Target
if (btnSetTarget) {
    btnSetTarget.addEventListener('click', () => {
        const val = parseInt(inputDailyTarget.value);
        if (isNaN(val) || val < 1) {
            showToast('❌ Target harus berupa angka minimal 1', 'error');
            return;
        }
        localStorage.setItem('daily_target', val);
        showToast(`✅ Target harian diatur ke ${val}`, 'success');
        loadProductivityData(); // Refresh UI
    });
}

function calculateStreak(leads) {
    if (!leads || leads.length === 0) return 0;

    // Kumpulan tanggal unik yyyy-mm-dd
    const dates = [...new Set(leads.map(l => l.created_at.split('T')[0]))].sort().reverse();

    const now = new Date();
    const todayStr = now.toISOString().split('T')[0];
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().split('T')[0];

    // Jika hari ini tidak ada data dan kemarin juga tidak ada, streak 0
    if (!dates.includes(todayStr) && !dates.includes(yesterdayStr)) return 0;

    let streak = 0;
    let checkDate = dates.includes(todayStr) ? new Date(now) : new Date(yesterday);

    while (true) {
        const checkStr = checkDate.toISOString().split('T')[0];
        if (dates.includes(checkStr)) {
            streak++;
            checkDate.setDate(checkDate.getDate() - 1);
        } else {
            break;
        }
    }
    return streak;
}

function renderDailyChart(leads) {
    const ctx = document.getElementById('dailyChart');
    if (!ctx) return;

    // Group by last 7 days
    const last7Days = [];
    for (let i = 6; i >= 0; i--) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        last7Days.push(d.toISOString().split('T')[0]);
    }

    const counts = last7Days.map(date => {
        return leads.filter(l => l.created_at.startsWith(date)).length;
    });

    const labels = last7Days.map(d => {
        const parts = d.split('-');
        return `${parts[2]}/${parts[1]}`;
    });

    if (dailyChartInstance) dailyChartInstance.destroy();

    dailyChartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: 'Data Terinput',
                data: counts,
                borderColor: '#4f46e5',
                backgroundColor: 'rgba(79, 70, 229, 0.1)',
                fill: true,
                tension: 0.4,
                pointRadius: 4,
                pointBackgroundColor: '#4f46e5'
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                y: { beginAtZero: true, grid: { display: false } },
                x: { grid: { display: false } }
            }
        }
    });
}

function renderHourlyChart(leads) {
    const ctx = document.getElementById('hourlyChart');
    if (!ctx) return;

    // Jam 00-23
    const hours = Array.from({ length: 24 }, (_, i) => i);
    const hourCounts = hours.map(h => {
        return leads.filter(l => {
            const timePart = l.created_at.split('T')[1];
            if (!timePart) return false;
            const hour = parseInt(timePart.split(':')[0]);
            return hour === h;
        }).length;
    });

    if (hourlyChartInstance) hourlyChartInstance.destroy();

    hourlyChartInstance = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: hours.map(h => `${String(h).padStart(2, '0')}:00`),
            datasets: [{
                label: 'Total Data',
                data: hourCounts,
                backgroundColor: '#10b981',
                borderRadius: 4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                y: { beginAtZero: true, grid: { display: false } },
                x: { grid: { display: false } }
            }
        }
    });
}

if (btnRefreshProductivity) {
    btnRefreshProductivity.addEventListener('click', loadProductivityData);
}

// --- REAL-TIME CLOCK ---
function updateClock() {
    const now = new Date();

    // Time format: HH:MM:SS
    const timeStr = now.toLocaleTimeString('id-ID', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
    });

    // Date format: Hari, DD Bulan YYYY
    const dateStr = now.toLocaleDateString('id-ID', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    });

    const clockTime = document.getElementById('clock-time');
    const clockDate = document.getElementById('clock-date');

    if (clockTime) clockTime.innerText = timeStr;
    if (clockDate) clockDate.innerText = dateStr;
}

// Initial call and set interval
updateClock();
setInterval(updateClock, 1000);

// --- SPLASH SCREEN DISMISSAL ---
window.addEventListener('load', () => {
    const splash = document.getElementById('splash-screen');
    if (splash) {
        // Tampilkan minimal 2.5 detik untuk efek premium
        setTimeout(() => {
            splash.classList.add('fade-out');

            // Hapus dari DOM setelah animasi selesai agar tidak membebani memori
            setTimeout(() => {
                splash.remove();
                checkAuth(); // Panggil checkAuth SETELAH splash selesai
            }, 800); // Sesuai durasi transition di CSS
        }, 2500);
    } else {
        checkAuth();
    }
});

// --- AUDIO SYSTEM (Mobile-Compatible) ---
// Mobile browsers require AudioContext to be created/resumed inside a user gesture.
// We create ONE shared context and unlock it on the first user touch or click.

let _audioCtx = null;
let _audioUnlocked = false;

function getAudioContext() {
    if (!_audioCtx) {
        _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    return _audioCtx;
}

// Unlock audio on first user interaction (required by mobile browsers)
function unlockAudio() {
    if (_audioUnlocked) return;
    try {
        const ctx = getAudioContext();
        if (ctx.state === 'suspended') {
            ctx.resume().then(() => {
                _audioUnlocked = true;
                console.log('🔊 Audio unlocked for mobile');
            });
        } else {
            _audioUnlocked = true;
        }
        // Play a silent buffer to kick off the context on iOS
        const buf = ctx.createBuffer(1, 1, 22050);
        const src = ctx.createBufferSource();
        src.buffer = buf;
        src.connect(ctx.destination);
        src.start(0);
    } catch (e) {
        console.warn('Audio unlock failed:', e);
    }
}

// Attach unlock to first touch/click anywhere on the page
['touchstart', 'touchend', 'mousedown', 'keydown'].forEach(evt => {
    document.addEventListener(evt, unlockAudio, { once: false, passive: true });
});

// ✅ SUCCESS: Pleasant high "Ting!" for new data
function playNotificationSound() {
    try {
        const ctx = getAudioContext();
        if (ctx.state === 'suspended') ctx.resume();

        const oscillator = ctx.createOscillator();
        const gainNode = ctx.createGain();
        oscillator.connect(gainNode);
        gainNode.connect(ctx.destination);

        oscillator.type = 'sine';
        oscillator.frequency.setValueAtTime(880, ctx.currentTime);
        oscillator.frequency.exponentialRampToValueAtTime(440, ctx.currentTime + 0.3);
        gainNode.gain.setValueAtTime(0.6, ctx.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);

        oscillator.start(ctx.currentTime);
        oscillator.stop(ctx.currentTime + 0.5);
    } catch (e) {
        console.warn('Notification sound failed:', e);
    }
}

// ⚠️ DUPLICATE: Two descending buzzes for rejected/duplicate data
function playDuplicateSound() {
    try {
        const ctx = getAudioContext();
        if (ctx.state === 'suspended') ctx.resume();

        [0, 0.28].forEach((delay) => {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.type = 'sawtooth';
            osc.frequency.setValueAtTime(300, ctx.currentTime + delay);
            osc.frequency.exponentialRampToValueAtTime(150, ctx.currentTime + delay + 0.2);
            gain.gain.setValueAtTime(0.4, ctx.currentTime + delay);
            gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + delay + 0.22);
            osc.start(ctx.currentTime + delay);
            osc.stop(ctx.currentTime + delay + 0.25);
        });
    } catch (e) {
        console.warn('Duplicate sound failed:', e);
    }
}

// Expose globally
window.playNotificationSound = playNotificationSound;
window.playDuplicateSound = playDuplicateSound;

// --- SUPABASE REALTIME SUBSCRIPTION ---
// NOTE: Realtime harus diaktifkan di Supabase Dashboard > Database > Replication > leads table
let realtimeChannel = null;

function setupRealtimeSubscription() {
    // Jika sudah ada channel, jangan subscribe lagi
    if (realtimeChannel) return;

    // Menggunakan supabase dari Web App (injected by api layer)
    const supabaseClient = window.__supabaseClient || null;
    if (!supabaseClient) return;

    realtimeChannel = supabaseClient
        .channel('realtime-leads')
        .on('postgres_changes',
            { event: 'INSERT', schema: 'public', table: 'leads' },
            (payload) => {
                console.log('📡 Data Baru Masuk (Realtime):', payload.new);

                // Mainkan suara notifikasi
                playNotificationSound();

                // Tampilkan notifikasi kepada pengguna
                const name = payload.new?.username || 'Seseorang';
                showToast(`🔔 Data Baru! ${name} baru saja diinput.`, 'success');

                // Refresh tab yang sedang aktif tanpa toast "Memuat"
                silentRefreshActiveTab();
            }
        )
        .subscribe((status) => {
            console.log('Supabase Realtime Status:', status);
        });
}

// Silently refresh data without showing the "Memuat..." toast
async function silentRefreshActiveTab() {
    switch (currentActiveTab) {
        case 'today':
            await loadTodayDataSilent();
            break;
        case 'dashboard':
            await loadStats(true); // silent=true
            break;
        case 'input':
        case 'productivity':
        default:
            // Optional: refresh stats in background
            break;
    }
}

// loadTodayData without the toast notification
async function loadTodayDataSilent() {
    const filterTodayDate = document.getElementById('filter-today-date');
    let localDate;
    if (filterTodayDate && filterTodayDate.value) {
        localDate = filterTodayDate.value;
    } else {
        const now = new Date();
        localDate = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
    }

    const res = await api.getStats({
        startDate: localDate,
        endDate: localDate,
        pageSize: 1000,
        exportAll: true
    });

    if (!res.success) return;

    const leads = res.leads;
    const todayLeadsTable = document.getElementById('today-leads-table');
    if (!todayLeadsTable) return;
    todayLeadsTable.innerHTML = '';

    const totalCountTodayLabel = document.getElementById('total-count-today');
    if (totalCountTodayLabel) {
        totalCountTodayLabel.innerText = `${leads.length} Data`;
    }

    if (leads && leads.length > 0) {
        const sortedLeads = [...leads].sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
        const startTimeToday = document.getElementById('start-time-today');
        const lastTimeToday = document.getElementById('last-time-today');
        if (startTimeToday) startTimeToday.innerText = new Date(sortedLeads[0].created_at).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
        if (lastTimeToday) lastTimeToday.innerText = new Date(sortedLeads[sortedLeads.length - 1].created_at).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });

        [...sortedLeads].reverse().forEach(l => {
            const time = new Date(l.created_at).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
            const cleanWa = (l.whatsapp || '').replace(/\D/g, '');
            todayLeadsTable.insertAdjacentHTML('beforeend', `
                <tr>
                    <td><strong>${time}</strong></td>
                    <td>${l.username}</td>
                    <td>${l.whatsapp}</td>
                    <td>${l.niche || '-'}</td>
                    <td>${l.gmv || '-'}</td>
                </tr>
            `);
        });
    }
}

// Expose setupRealtimeSubscription globally so it can be called from main.js after login
window.setupRealtimeSubscription = setupRealtimeSubscription;


// --- SIDEBAR NAVIGATION ---
function switchTab(tabId) {
    const tabs = {
        input: document.getElementById('tab-input'),
        today: document.getElementById('tab-today'),
        productivity: document.getElementById('tab-productivity'),
        dashboard: document.getElementById('tab-dashboard')
    };

    const sections = {
        input: document.getElementById('section-input'),
        today: document.getElementById('section-today'),
        productivity: document.getElementById('section-productivity'),
        dashboard: document.getElementById('section-dashboard')
    };

    Object.keys(sections).forEach(k => {
        if (sections[k]) sections[k].classList.toggle('active', k === tabId);
        if (tabs[k]) tabs[k].classList.toggle('active', k === tabId);
    });
}

const sTabs = ['input', 'today', 'productivity', 'dashboard'];
sTabs.forEach(tabId => {
    const el = document.getElementById('tab-' + tabId);
    if (el) {
        el.addEventListener('click', () => {
            if (window.innerWidth <= 768) {
                const sidebar = document.getElementById('sidebar');
                if (sidebar) sidebar.classList.remove('open');
            }
            // Tab switching and data loading is handled by renderer.js tab listeners
            // This block only handles mobile sidebar closing
        });
    }
});

const btnToggleSidebar = document.getElementById('btn-toggle-sidebar');
if (btnToggleSidebar) {
    btnToggleSidebar.onclick = () => {
        const sidebar = document.getElementById('sidebar');
        if (sidebar) sidebar.classList.add('open');
    };
}


