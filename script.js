/**
 * SUREC - Sistema de Recibos Profesional
 * Built with Supabase & Modern JS
 */

const MONTHS = [
    'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
    'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
];

const RecibosSystem = {
    data: { luz: {}, agua: {}, config: null },
    floors: [],
    chart: null,
    currentYear: new Date().getFullYear(),
    pendingAction: null,
    pendingActionArgs: [],

    // Status Trackers
    isInitialized: false,

    async init() {
        if (this.isInitialized) return;

        console.log('SUREC: Iniciando sistema...');
        this.showSpinner(true);

        try {
            // Validar dependencias
            this.validateDependencies();

            // Inicializar Supabase
            if (!window.SUPABASE_CONFIG) throw new Error('Configuración de base de datos ausente.');
            window.sb = supabase.createClient(window.SUPABASE_CONFIG.url, window.SUPABASE_CONFIG.key);

            // Cargar Datos
            await this.loadData();

            // Preparar UI
            this.setupUI();
            this.setupEventListeners();

            // Login Check
            this.checkLogin();

            this.isInitialized = true;
            console.log('SUREC: Sistema listo.');
        } catch (e) {
            this.handleGlobalError(e);
        } finally {
            this.showSpinner(false);
        }
    },

    validateDependencies() {
        const deps = {
            bootstrap: window.bootstrap,
            chart: window.Chart,
            supabase: window.supabase,
            jspdf: window.jspdf,
            xlsx: window.XLSX,
            saveAs: window.saveAs || (window.FileSaver && window.FileSaver.saveAs)
        };

        Object.entries(deps).forEach(([name, ref]) => {
            if (!ref) console.warn(`Dependencia faltante: ${name}`);
        });
    },

    async loadData() {
        try {
            const { data: sData, error: sErr } = await sb.from('settings').select('value').eq('key', 'config').single();
            const { data: rData, error: rErr } = await sb.from('receipts').select('*');

            if (sErr && sErr.code !== 'PGRST116') throw sErr;
            if (rErr) throw rErr;

            // Default Config
            this.data.config = sData ? sData.value : {
                floors: ['1', '2', '3'],
                username: 'master',
                password: '12345',
                phone: '945426574'
            };
            this.floors = this.data.config.floors;

            // Reset Records
            this.data.luz = {};
            this.data.agua = {};

            if (rData) {
                rData.forEach(r => {
                    const target = r.service === 'luz' ? this.data.luz : this.data.agua;
                    if (!target[r.floor]) target[r.floor] = {};
                    if (!target[r.floor][r.year]) target[r.floor][r.year] = {};
                    target[r.floor][r.year][r.month] = r.data;
                });
            }
        } catch (e) {
            console.error('SUREC: Error en carga ->', e);
            throw e;
        }
    },

    setupUI() {
        // Populate Floors
        this.updateFloorsUI();

        // Populate Months
        const mHtml = MONTHS.map((m, i) => `<option value="${i + 1}">${m}</option>`).join('');
        ['luz-month', 'agua-month'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.innerHTML = '<option value="" disabled selected>Seleccione mes</option>' + mHtml;
        });

        // Set Years
        ['luz-year', 'agua-year'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.value = this.currentYear;
        });

        // Dashboard
        this.updateDashboard();

        // Settings Display
        const userDisp = document.getElementById('current-username-display');
        if (userDisp) userDisp.textContent = this.data.config.username;
    },

    updateFloorsUI() {
        const opt = this.floors.map(f => `<option value="${f}">Piso ${f}</option>`).join('');
        ['luz-floor', 'agua-floor'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.innerHTML = '<option value="" disabled selected>Elegir piso...</option>' + opt;
        });

        const repFloor = document.getElementById('report-floor');
        if (repFloor) repFloor.innerHTML = '<option value="">Todos los Pisos</option>' + opt;

        const list = document.getElementById('floor-list');
        if (list) {
            list.innerHTML = this.floors.map(f => `
                <div class="flex items-center justify-between p-4 bg-white rounded-xl mb-2 shadow-sm group">
                    <span class="font-bold text-slate-700">Piso ${f}</span>
                    <button onclick="RecibosSystem.promptPassword('removeFloor', ['${f}'])" class="p-2 text-slate-300 hover:text-red-500 transition-colors">
                        <svg xmlns="http://www.w3.org/2000/svg" class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
                    </button>
                </div>
            `).join('');
        }
    },

    setupEventListeners() {
        const forms = {
            'luz-form': (e) => this.handleCalculate('luz', e),
            'agua-form': (e) => this.handleCalculate('agua', e),
            'report-form': (e) => this.handleReport(e),
            'login-form': (e) => this.handleLogin(e),
            'password-form': (e) => this.handleVerifyPassword(e),
            'edit-receipt-form': (e) => this.handleSaveEdit(e)
        };

        Object.entries(forms).forEach(([id, fn]) => {
            const el = document.getElementById(id);
            if (el) el.addEventListener('submit', fn);
        });
    },

    // --- Authentication Logic ---

    checkLogin() {
        if (sessionStorage.getItem('surec_auth') === 'true') {
            this.unlockApp();
        } else {
            this.lockApp();
        }
    },

    lockApp() {
        const modalEl = document.getElementById('loginModal');
        const modal = new bootstrap.Modal(modalEl, { backdrop: 'static', keyboard: false });
        modal.show();
    },

    unlockApp() {
        document.getElementById('main-container').style.display = 'block';
        document.getElementById('logout-btn').classList.remove('hidden');
    },

    handleLogin(e) {
        e.preventDefault();
        const u = document.getElementById('username-input').value;
        const p = document.getElementById('login-password-input').value;

        if (u === this.data.config.username && p === this.data.config.password) {
            sessionStorage.setItem('surec_auth', 'true');
            bootstrap.Modal.getInstance(document.getElementById('loginModal')).hide();
            this.unlockApp();
            this.showAlert('Sistema desbloqueado.', 'success');
        } else {
            this.showAlert('Acceso denegado.', 'danger');
        }
    },

    logout() {
        sessionStorage.removeItem('surec_auth');
        window.location.reload();
    },

    promptPassword(action, args = []) {
        this.pendingAction = action;
        this.pendingActionArgs = args;
        const modal = new bootstrap.Modal(document.getElementById('passwordModal'));
        document.getElementById('password-input').value = '';
        modal.show();
    },

    handleVerifyPassword(e) {
        e.preventDefault();
        const p = document.getElementById('password-input').value;
        if (p === this.data.config.password) {
            bootstrap.Modal.getInstance(document.getElementById('passwordModal')).hide();
            if (this.pendingAction) {
                this[this.pendingAction](...this.pendingActionArgs);
                this.pendingAction = null;
                this.pendingActionArgs = [];
            }
        } else {
            this.showAlert('Contraseña incorrecta.', 'danger');
        }
    },

    // --- Administrative Functions ---

    promptChangeUsername() {
        // Since we are already logged in, we can proceed or ask for password again.
        // For professional feel, let's just ask for password first.
        this.promptPassword('changeUsernameFlow');
    },

    async changeUsernameFlow() {
        const newU = prompt("Ingrese nuevo nombre de usuario:");
        if (newU && newU.trim()) {
            this.data.config.username = newU.trim();
            await this.saveData();
            document.getElementById('current-username-display').textContent = this.data.config.username;
            this.showAlert('Usuario actualizado.', 'success');
        }
    },

    promptChangePassword() {
        this.promptPassword('changePasswordFlow');
    },

    async changePasswordFlow() {
        const newP = prompt("Ingrese nueva contraseña maestra:");
        if (newP && newP.trim()) {
            this.data.config.password = newP.trim();
            await this.saveData();
            this.showAlert('Contraseña actualizada.', 'success');
        }
    },

    showForgotPasswordModal() {
        alert("Para recuperar su acceso, verifique su número registrado: " + this.data.config.phone + "\nContacte al soporte técnico.");
    },

    async addFloor() {
        const val = document.getElementById('new-floor').value.trim();
        if (!val) return;
        if (this.floors.includes(val)) return this.showAlert('Piso ya existe.', 'warning');

        this.floors.push(val);
        this.data.config.floors = this.floors;
        await this.saveData();
        this.updateFloorsUI();
        document.getElementById('new-floor').value = '';
        this.showAlert('Piso añadido.', 'success');
    },

    async removeFloor(floor) {
        if (!confirm(`¿Eliminar definitivamente el Piso ${floor} y todos sus registros?`)) return;

        try {
            this.showSpinner(true);
            await sb.from('receipts').delete().eq('floor', floor);
            this.floors = this.floors.filter(f => f !== floor);
            this.data.config.floors = this.floors;
            await this.saveData();
            this.updateFloorsUI();
            this.showAlert(`Piso ${floor} eliminado.`, 'info');
        } catch (e) {
            this.showAlert('Error al eliminar piso.', 'danger');
        } finally {
            this.showSpinner(false);
        }
    },

    async saveData() {
        try {
            this.showSpinner(true);
            const { error } = await sb.from('settings').upsert({ key: 'config', value: this.data.config }, { onConflict: 'key' });
            if (error) throw error;
        } catch (e) {
            this.showAlert('Error al sincronizar ajustes.', 'danger');
        } finally {
            this.showSpinner(false);
        }
    },

    async handleCalculate(service, e) {
        e.preventDefault();
        this.showSpinner(true);

        try {
            const gV = (id) => document.getElementById(`${service}-${id}`).value;
            const floor = gV('floor');
            const year = parseInt(gV('year'));
            const month = parseInt(gV('month'));
            const prev = parseFloat(gV('prev') || 0);
            const curr = parseFloat(gV('curr') || 0);
            const price = parseFloat(gV('price') || 0);

            const consumption = curr - prev;
            const subTotal_raw = consumption * price;

            let fixedCosts = 0;
            let resultData = { floor, year, month, prev, curr, price, consumption };

            if (service === 'luz') {
                const cargo = parseFloat(gV('fixed-cargo') || 0);
                const alumbrado = parseFloat(gV('fixed-alumbrado') || 0);
                const ley = parseFloat(gV('fixed-ley') || 0);
                const aporte = parseFloat(gV('fixed-aporte') || 0);
                fixedCosts = cargo + alumbrado + ley + aporte;
                resultData = { ...resultData, fixedCargo: cargo, fixedAlumbrado: alumbrado, fixedLey: ley, fixedAporte: aporte, subTotal: subTotal_raw, totalFixed: fixedCosts };
            } else {
                const sew_rate = parseFloat(document.getElementById('agua-sewerage').value || 0);
                const cargo = parseFloat(gV('fixed-cargo') || 0);
                const aporte = parseFloat(gV('fixed-aporte') || 0);
                const subTotal_full = subTotal_raw + (consumption * sew_rate);
                fixedCosts = cargo + aporte;
                resultData = { ...resultData, sewerage: sew_rate, fixedCargo: cargo, fixedAporte: aporte, subTotal: subTotal_full, totalFixed: fixedCosts };
            }

            resultData.impuesto = resultData.subTotal * 0.18;
            resultData.total = resultData.subTotal + resultData.impuesto + fixedCosts;

            // Database Sync
            const { error } = await sb.from('receipts').upsert({
                service, floor, year, month, data: resultData
            }, { onConflict: 'service, floor, year, month' });

            if (error) throw error;

            // Local Sync
            if (!this.data[service][floor]) this.data[service][floor] = {};
            if (!this.data[service][floor][year]) this.data[service][floor][year] = {};
            this.data[service][floor][year][month] = resultData;

            this.updateDashboard();
            this.showAlert(`Registro de ${service} guardado.`, 'success');
            document.getElementById(`${service}-form`).reset();
            document.getElementById(`${service}-year`).value = this.currentYear;
        } catch (e) {
            this.showAlert('Error al guardar registro.', 'danger');
        } finally {
            this.showSpinner(false);
        }
    },

    handleReport(e) {
        if (e) e.preventDefault();
        const s = document.getElementById('report-service').value;
        const fl = document.getElementById('report-floor').value;
        const yr = document.getElementById('report-year').value;

        let results = [];
        const floorList = fl ? [fl] : this.floors;

        floorList.forEach(f => {
            const fData = this.data[s][f];
            if (!fData) return;
            const yKeys = yr ? [yr] : Object.keys(fData);
            yKeys.forEach(y => {
                const mData = fData[y];
                if (mData) {
                    Object.entries(mData).forEach(([m, d]) => {
                        results.push({ ...d, service: s, floor: f, year: parseInt(y), month: parseInt(m) });
                    });
                }
            });
        });

        results.sort((a, b) => b.year - a.year || b.month - a.month);
        this.renderTable(results);
        this.updateChart(results);
    },

    renderTable(data) {
        const container = document.getElementById('report-result');
        if (data.length === 0) {
            container.innerHTML = '<div class="text-center py-20 text-slate-400 italic">No hay registros para este filtro.</div>';
            return;
        }

        let html = `
            <table class="w-full text-left" id="report-table">
                <thead>
                    <tr>
                        <th>Piso</th>
                        <th>Periodo</th>
                        <th>Lecturas</th>
                        <th>Consumo</th>
                        <th>Subtotal</th>
                        <th>Taxes</th>
                        <th>Total</th>
                        <th>Acción</th>
                    </tr>
                </thead>
                <tbody class="divide-y divide-slate-100">
        `;

        data.forEach(r => {
            html += `
                <tr class="group">
                    <td class="py-4 font-bold">Piso ${r.floor}</td>
                    <td>${MONTHS[r.month - 1]} ${r.year}</td>
                    <td class="text-slate-500 text-xs">${r.prev} → ${r.curr}</td>
                    <td class="font-medium">${r.consumption.toFixed(2)}</td>
                    <td>S/ ${r.subTotal.toFixed(2)}</td>
                    <td class="text-slate-400">S/ ${r.impuesto.toFixed(2)}</td>
                    <td class="text-primary font-bold">S/ ${r.total.toFixed(2)}</td>
                    <td>
                        <div class="flex gap-2">
                            <button onclick="RecibosSystem.editReceipt('${r.service}', '${r.floor}', ${r.year}, ${r.month})" class="p-2 hover:bg-blue-50 text-blue-600 rounded-lg"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"/></svg></button>
                            <button onclick="RecibosSystem.promptPassword('deleteReceipt', ['${r.service}', '${r.floor}', ${r.year}, ${r.month}])" class="p-2 hover:bg-red-50 text-red-600 rounded-lg"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg></button>
                        </div>
                    </td>
                </tr>
            `;
        });

        container.innerHTML = html + '</tbody></table>';
    },

    editReceipt(service, floor, year, month) {
        const r = this.data[service][floor][year][month];
        if (!r) return;

        document.getElementById('edit-service').value = service;
        document.getElementById('edit-floor').value = floor;
        document.getElementById('edit-year').value = year;
        document.getElementById('edit-month').value = month;
        document.getElementById('edit-prev').value = r.prev;
        document.getElementById('edit-curr').value = r.curr;
        document.getElementById('edit-price').value = r.price;
        document.getElementById('edit-fixed-aporte').value = r.fixedAporte;
        document.getElementById('edit-fixed-cargo').value = r.fixedCargo;

        const isA = service === 'agua';
        document.getElementById('edit-sewerage-container').style.display = isA ? 'block' : 'none';
        document.getElementById('edit-fixed-alumbrado-container').style.display = isA ? 'none' : 'block';
        document.getElementById('edit-fixed-ley-container').style.display = isA ? 'none' : 'block';

        if (isA) document.getElementById('edit-sewerage').value = r.sewerage;
        else {
            document.getElementById('edit-fixed-alumbrado').value = r.fixedAlumbrado;
            document.getElementById('edit-fixed-ley').value = r.fixedLey;
        }

        new bootstrap.Modal(document.getElementById('editReceiptModal')).show();
    },

    async handleSaveEdit(e) {
        e.preventDefault();
        this.showSpinner(true);

        try {
            const gV = (id) => document.getElementById('edit-' + id).value;
            const s = gV('service'), fl = gV('floor'), y = parseInt(gV('year')), m = parseInt(gV('month'));

            const prev = parseFloat(gV('prev')), curr = parseFloat(gV('curr')), price = parseFloat(gV('price'));
            const consumption = curr - prev;
            const subTotal_raw = consumption * price;

            let resultData = { floor: fl, year: y, month: m, prev, curr, price, consumption };

            if (s === 'luz') {
                const cargo = parseFloat(gV('fixed-cargo')), alumbrado = parseFloat(gV('fixed-alumbrado')), ley = parseFloat(gV('fixed-ley')), aporte = parseFloat(gV('fixed-aporte'));
                resultData = { ...resultData, fixedCargo: cargo, fixedAlumbrado: alumbrado, fixedLey: ley, fixedAporte: aporte, subTotal: subTotal_raw, totalFixed: cargo + alumbrado + ley + aporte };
            } else {
                const sew = parseFloat(gV('sewerage')), cargo = parseFloat(gV('fixed-cargo')), aporte = parseFloat(gV('fixed-aporte'));
                resultData = { ...resultData, sewerage: sew, fixedCargo: cargo, fixedAporte: aporte, subTotal: subTotal_raw + (consumption * sew), totalFixed: cargo + aporte };
            }

            resultData.impuesto = resultData.subTotal * 0.18;
            resultData.total = resultData.subTotal + resultData.impuesto + resultData.totalFixed;

            await sb.from('receipts').upsert({ service: s, floor: fl, year: y, month: m, data: resultData }, { onConflict: 'service, floor, year, month' });
            this.data[s][fl][y][m] = resultData;

            bootstrap.Modal.getInstance(document.getElementById('editReceiptModal')).hide();
            this.handleReport();
            this.updateDashboard();
            this.showAlert('Registro actualizado.', 'success');
        } catch (e) {
            this.showAlert('Error al actualizar.', 'danger');
        } finally {
            this.showSpinner(false);
        }
    },

    // --- Export Module ---

    exportToPDF() {
        const table = document.getElementById('report-table');
        if (!table) return this.showAlert('Genere un reporte primero.', 'warning');

        try {
            const { jsPDF } = window.jspdf;
            const doc = new jsPDF('l', 'mm', 'a4'); // Landscape
            const service = document.getElementById('report-service').value.toUpperCase();

            // Background Header
            doc.setFillColor(30, 27, 75); // Dark Navy
            doc.rect(0, 0, 297, 40, 'F');

            doc.setTextColor(255, 255, 255);
            doc.setFontSize(24);
            doc.text('REPORTE DE CONSUMO ' + service, 15, 25);

            doc.setFontSize(10);
            doc.text('Generado por SUREC - ' + new Date().toLocaleString(), 15, 33);

            doc.autoTable({
                html: '#report-table',
                startY: 50,
                theme: 'striped',
                headStyles: { fillColor: [79, 70, 229], textColor: [255, 255, 255], fontStyle: 'bold' },
                columns: [0, 1, 2, 3, 4, 5, 6].map(i => ({ header: '', dataKey: i })), // Exclude actions
                didParseCell: (data) => {
                    if (data.column.index === 7) data.cell.text = ''; // Hide last column text
                }
            });

            doc.save(`SUREC_${service}_${Date.now()}.pdf`);
        } catch (e) {
            console.error('PDF Error:', e);
            this.showAlert('Falla en generación de PDF.', 'danger');
        }
    },

    exportToExcel() {
        const table = document.getElementById('report-table');
        if (!table) return this.showAlert('Genere un reporte primero.', 'warning');

        try {
            const wb = XLSX.utils.book_new();
            // Clonar tabla y eliminar columna de acciones
            const tempTable = table.cloneNode(true);
            tempTable.querySelectorAll('tr').forEach(tr => {
                if (tr.lastElementChild) tr.removeChild(tr.lastElementChild);
            });

            const ws = XLSX.utils.table_to_sheet(tempTable);
            XLSX.utils.book_append_sheet(wb, ws, 'Reporte');

            const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
            saveAs(new Blob([wbout], { type: 'application/octet-stream' }), `SUREC_Reporte_${Date.now()}.xlsx`);
        } catch (e) {
            console.error('Excel Error:', e);
            this.showAlert('Falla en exportación Excel.', 'danger');
        }
    },

    exportToWord() {
        const table = document.getElementById('report-table');
        if (!table) return this.showAlert('Genere un reporte primero.', 'warning');

        try {
            const service = document.getElementById('report-service').value.toUpperCase();
            let content = `
                <html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'>
                <head><meta charset='utf-8'><style>
                    body { font-family: sans-serif; }
                    table { border-collapse: collapse; width: 100%; }
                    th, td { border: 1px solid #ccc; padding: 8px; }
                    th { background: #f4f4f4; }
                </style></head>
                <body>
                    <h1>SUREC - REPORTE ${service}</h1>
                    <p>Fecha: ${new Date().toLocaleString()}</p>
                    ${table.outerHTML}
                </body></html>
            `;
            // Remove actions column via regex
            content = content.replace(/<button.*?<\/button>/g, '').replace(/<td>\s*<\/td>/g, '').replace(/<th>Acción<\/th>/g, '');

            const blob = new Blob(['\ufeff', content], { type: 'application/msword' });
            saveAs(blob, `SUREC_Reporte_${Date.now()}.doc`);
        } catch (e) {
            this.showAlert('Falla en exportación Word.', 'danger');
        }
    },

    // --- Utilities ---

    updateDashboard() {
        let lT = 0, aT = 0;
        const sumAll = (scope) => {
            let s = 0;
            Object.values(scope || {}).forEach(y => {
                Object.values(y || {}).forEach(r => s += r.total || 0);
            });
            return s;
        };

        this.floors.forEach(f => {
            lT += sumAll(this.data.luz[f]);
            aT += sumAll(this.data.agua[f]);
        });

        document.getElementById('total-luz').textContent = lT.toFixed(2);
        document.getElementById('total-agua').textContent = aT.toFixed(2);
        document.getElementById('total-floors').textContent = this.floors.length;
    },

    updateChart(data) {
        const ctx = document.getElementById('consumption-chart');
        if (!ctx) return;
        if (this.chart) this.chart.destroy();

        const d = data.slice(0, 8).reverse();
        this.chart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: d.map(r => `${MONTHS[r.month - 1].substring(0, 3)} ${r.year}`),
                datasets: [{
                    label: 'Consumo', data: d.map(r => r.consumption), borderColor: '#4f46e5', tension: 0.4, fill: true, backgroundColor: 'rgba(79, 70, 229, 0.05)'
                }, {
                    label: 'Total (S/)', data: d.map(r => r.total), borderColor: '#10b981', tension: 0.4
                }]
            },
            options: { responsive: true, plugins: { legend: { position: 'top' } } }
        });
    },

    showSpinner(show) {
        const s = document.getElementById('spinner');
        if (s) {
            if (show) {
                s.classList.add('opacity-100');
                s.classList.remove('opacity-0');
            } else {
                s.classList.add('opacity-0');
                s.classList.remove('opacity-100');
            }
        }
    },

    showAlert(msg, type) {
        // Simple toast style alert
        const t = document.createElement('div');
        t.className = `fixed bottom-8 right-8 z-[10000] p-4 rounded-2xl shadow-2xl text-white font-bold transition-all transform translate-y-20 border-l-4 ${type === 'success' ? 'bg-secondary border-emerald-700' : 'bg-red-500 border-red-700'}`;
        t.textContent = msg;
        document.body.appendChild(t);

        setTimeout(() => t.classList.remove('translate-y-20'), 100);
        setTimeout(() => {
            t.classList.add('translate-y-20');
            setTimeout(() => t.remove(), 500);
        }, 3000);
    },

    handleGlobalError(e) {
        console.error('SUREC Error:', e);
        this.showAlert('Falla crítica en el sistema.', 'danger');
    }
};

// Global Exposure for Callbacks
window.RecibosSystem = RecibosSystem;
document.addEventListener('DOMContentLoaded', () => RecibosSystem.init());