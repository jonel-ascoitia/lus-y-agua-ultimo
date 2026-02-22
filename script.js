const MONTHS = [
    'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
    'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
];

const RecibosSystem = {
    data: null,
    floors: null,
    chart: null,
    currentYear: new Date().getFullYear(),
    pendingAction: null,
    pendingActionArgs: null,
    passwordAttempts: 0,
    maxAttempts: 3,
    lockoutUntil: null,
    lockoutDuration: 5 * 60 * 1000, // 5 minutos
    isRecoveryMode: false,

    async init() {
        if (!window.bootstrap || !window.Chart || !window.supabase) {
            console.error('Dependencias básicas faltantes: Bootstrap, Chart.js o Supabase');
            this.showAlert('Error: Faltan dependencias críticas.', 'danger', null);
            return;
        }

        // Inicializar cliente de Supabase
        if (window.SUPABASE_CONFIG) {
            window.sb = supabase.createClient(window.SUPABASE_CONFIG.url, window.SUPABASE_CONFIG.key);
        } else {
            this.showAlert('Error: Configuración de base de datos no encontrada.', 'danger', null);
            return;
        }

        await this.loadData();

        this.updateFloors();
        this.setupMonthOptions();
        this.setupEventListeners();
        this.updateDashboard();

        const luzYear = document.getElementById('luz-year');
        const aguaYear = document.getElementById('agua-year');
        if (luzYear) luzYear.value = this.currentYear;
        if (aguaYear) aguaYear.value = this.currentYear;

        this.checkLogin();
    },

    checkLogin() {
        if (sessionStorage.getItem('loggedIn') !== 'true') {
            this.showLoginModal();
        } else {
            this.showMainContent();
        }
    },

    showLoginModal() {
        const loginModal = document.getElementById('loginModal');
        if (!loginModal) return;
        const modal = new bootstrap.Modal(loginModal, { backdrop: 'static', keyboard: false });
        const usernameInput = document.getElementById('username-input');
        const passwordInput = document.getElementById('login-password-input');
        if (usernameInput) usernameInput.value = '';
        if (passwordInput) passwordInput.value = '';
        modal.show();
    },

    login(event) {
        event.preventDefault();
        const form = document.getElementById('login-form');
        if (!form?.checkValidity()) {
            form?.classList.add('was-validated');
            return;
        }
        const username = document.getElementById('username-input')?.value || '';
        const password = document.getElementById('login-password-input')?.value || '';

        if (username === this.data.config.username && password === this.data.config.password) {
            sessionStorage.setItem('loggedIn', 'true');
            const instance = bootstrap.Modal.getInstance(document.getElementById('loginModal'));
            if (instance) instance.hide();
            this.showMainContent();
            this.showAlert('Inicio de sesión exitoso.', 'success', null);
        } else {
            this.showAlert('Usuario o contraseña incorrectos.', 'danger', null);
        }
        form.classList.remove('was-validated');
    },

    showMainContent() {
        const mainContainer = document.getElementById('main-container');
        const logoutBtn = document.getElementById('logout-btn');
        if (mainContainer) mainContainer.style.display = 'block';
        if (logoutBtn) logoutBtn.style.display = 'block';
    },

    logout() {
        sessionStorage.removeItem('loggedIn');
        const mainContainer = document.getElementById('main-container');
        const logoutBtn = document.getElementById('logout-btn');
        if (mainContainer) mainContainer.style.display = 'none';
        if (logoutBtn) logoutBtn.style.display = 'none';
        this.showLoginModal();
        this.showAlert('Sesión cerrada.', 'info', null);
    },

    showForgotPasswordModal() {
        const loginModal = document.getElementById('loginModal');
        const instance = bootstrap.Modal.getInstance(loginModal);
        if (instance) instance.hide();
        const modal = new bootstrap.Modal(document.getElementById('forgotPasswordModal'));
        modal.show();
    },

    recoverPassword(event) {
        event.preventDefault();
        const phone = document.getElementById('phone-input')?.value || '';
        if (phone === this.data.config.phone) {
            this.isRecoveryMode = true;
            bootstrap.Modal.getInstance(document.getElementById('forgotPasswordModal')).hide();
            this.showChangePasswordModal(true);
            this.showAlert('Número verificado.', 'success', null);
        } else {
            this.showAlert('Número incorrecto.', 'danger', null);
        }
    },

    promptChangeUsername() {
        new bootstrap.Modal(document.getElementById('changeUsernameModal')).show();
    },

    async changeUsername(event) {
        event.preventDefault();
        const currentPassword = document.getElementById('current-password-for-username')?.value || '';
        const newUsername = this.sanitizeInput(document.getElementById('new-username-input')?.value.trim());

        if (currentPassword !== this.data.config.password) {
            this.showAlert('Contraseña incorrecta.', 'danger', 'config');
            return;
        }

        this.data.config.username = newUsername;
        await this.saveData();
        bootstrap.Modal.getInstance(document.getElementById('changeUsernameModal')).hide();
        this.showAlert('Usuario actualizado. Re-inicie sesión.', 'success', 'config');
        this.logout();
    },

    promptChangePassword() {
        this.isRecoveryMode = false;
        this.showChangePasswordModal(false);
    },

    showChangePasswordModal(hideCurrentPassword) {
        const modal = new bootstrap.Modal(document.getElementById('changePasswordModal'));
        const currentDiv = document.getElementById('current-password-div');
        if (currentDiv) currentDiv.style.display = hideCurrentPassword ? 'none' : 'block';
        modal.show();
    },

    async changePassword(event) {
        event.preventDefault();
        const current = document.getElementById('current-password-input')?.value;
        const nPass = document.getElementById('new-password-input')?.value;
        const cPass = document.getElementById('confirm-new-password-input')?.value;

        if (nPass !== cPass) {
            this.showAlert('Contraseñas no coinciden.', 'danger', 'config');
            return;
        }
        if (!this.isRecoveryMode && current !== this.data.config.password) {
            this.showAlert('Contraseña actual incorrecta.', 'danger', 'config');
            return;
        }

        this.data.config.password = nPass;
        await this.saveData();
        bootstrap.Modal.getInstance(document.getElementById('changePasswordModal')).hide();
        this.showAlert('Contraseña actualizada. Re-inicie sesión.', 'success', 'config');
        this.logout();
    },

    async loadData() {
        try {
            this.showSpinner(true);
            const { data: sData, error: sErr } = await sb.from('settings').select('value').eq('key', 'config').single();
            const { data: rData, error: rErr } = await sb.from('receipts').select('*');

            if (sErr && sErr.code !== 'PGRST116') throw sErr;
            if (rErr) throw rErr;

            this.data = { luz: {}, agua: {}, config: sData ? sData.value : { floors: ['1', '2', '3'], username: 'master', password: '12345', phone: '945426574' } };
            this.floors = this.data.config.floors;

            if (rData) {
                rData.forEach(r => {
                    const target = r.service === 'luz' ? this.data.luz : this.data.agua;
                    if (!target[r.floor]) target[r.floor] = {};
                    if (!target[r.floor][r.year]) target[r.floor][r.year] = {};
                    target[r.floor][r.year][r.month] = r.data;
                });
            }
        } catch (e) {
            console.error('Error cargando:', e);
            this.showAlert('Error de carga de datos.', 'warning', null);
            this.data = { luz: {}, agua: {}, config: { floors: ['1', '2', '3'], username: 'master', password: '12345', phone: '945426574' } };
            this.floors = this.data.config.floors;
        } finally {
            this.showSpinner(false);
        }
    },

    async saveData() {
        try {
            this.showSpinner(true);
            const { error } = await sb.from('settings').upsert({ key: 'config', value: this.data.config }, { onConflict: 'key' });
            if (error) throw error;
            this.updateDashboard();
        } catch (e) {
            this.showAlert('Error al guardar en base de datos.', 'danger', null);
        } finally {
            this.showSpinner(false);
        }
    },

    showSpinner(show) {
        const spinner = document.getElementById('spinner');
        if (spinner) spinner.style.display = show ? 'flex' : 'none';
    },

    showAlert(message, type, tabId = null) {
        const alert = document.createElement('div');
        alert.className = `alert alert-${type} alert-dismissible fade show rounded-lg shadow-sm`;
        alert.innerHTML = `${this.sanitizeInput(message)}<button type="button" class="btn-close" data-bs-dismiss="alert"></button>`;
        const target = tabId ? document.getElementById(tabId) : document.getElementById('main-content') || document.body;
        if (target) {
            target.insertBefore(alert, target.firstChild);
            setTimeout(() => alert.remove(), 5000);
        }
    },

    sanitizeInput(input) {
        return typeof input === 'string' ? input.replace(/[<>&"']/g, '') : input;
    },

    updateFloors() {
        const floorOptions = this.floors.map(f => `<option value="${f}">Piso ${f}</option>`).join('');
        document.getElementById('luz-floor').innerHTML = '<option value="" disabled selected>Seleccion Piso</option>' + floorOptions;
        document.getElementById('agua-floor').innerHTML = '<option value="" disabled selected>Seleccion Piso</option>' + floorOptions;
        document.getElementById('report-floor').innerHTML = '<option value="">Todos los Pisos</option>' + floorOptions;

        document.getElementById('floor-list').innerHTML = this.floors.map(f => `
            <li class="list-group-item d-flex justify-content-between align-items-center">
                Piso ${f}
                <button class="btn btn-sm btn-danger" onclick="RecibosSystem.promptPassword('removeFloor', ['${f}'])">Eliminar</button>
            </li>
        `).join('');
        this.updateDashboard();
    },

    setupMonthOptions() {
        const monthOptions = MONTHS.map((m, i) => `<option value="${i + 1}">${m}</option>`).join('');
        document.getElementById('luz-month').innerHTML = '<option value="" disabled selected>Seleccione</option>' + monthOptions;
        document.getElementById('agua-month').innerHTML = '<option value="" disabled selected>Seleccione</option>' + monthOptions;
    },

    setupEventListeners() {
        document.getElementById('luz-form').addEventListener('submit', (e) => this.calculate('luz', e));
        document.getElementById('agua-form').addEventListener('submit', (e) => this.calculate('agua', e));
        document.getElementById('report-form').addEventListener('submit', (e) => this.generateReport(e));
        document.getElementById('login-form').addEventListener('submit', (e) => this.login(e));
        document.getElementById('forgot-password-form').addEventListener('submit', (e) => this.recoverPassword(e));
        document.getElementById('change-password-form').addEventListener('submit', (e) => this.changePassword(e));
        document.getElementById('change-username-form').addEventListener('submit', (e) => this.changeUsername(e));
        document.getElementById('password-form').addEventListener('submit', (e) => this.verifyPassword(e));
        document.getElementById('edit-receipt-form').addEventListener('submit', (e) => this.saveEditedReceipt(e));
    },

    promptPassword(action, args = []) {
        if (this.lockoutUntil && Date.now() < this.lockoutUntil) {
            this.showAlert('Sistema bloqueado.', 'danger', 'report');
            return;
        }
        this.pendingAction = action;
        this.pendingActionArgs = args;
        new bootstrap.Modal(document.getElementById('passwordModal')).show();
    },

    verifyPassword(event) {
        event.preventDefault();
        const pInput = document.getElementById('password-input');
        if (pInput.value === this.data.config.password) {
            this.passwordAttempts = 0;
            bootstrap.Modal.getInstance(document.getElementById('passwordModal')).hide();
            if (this.pendingAction) {
                this[this.pendingAction](...this.pendingActionArgs);
                this.pendingAction = null;
            }
        } else {
            this.passwordAttempts++;
            if (this.passwordAttempts >= this.maxAttempts) {
                this.lockoutUntil = Date.now() + this.lockoutDuration;
                this.showAlert('Bloqueo de seguridad activado.', 'danger', 'report');
                bootstrap.Modal.getInstance(document.getElementById('passwordModal')).hide();
            } else {
                this.showAlert('Incorrecta.', 'danger', 'report');
            }
        }
    },

    async addFloor() {
        const val = document.getElementById('new-floor').value.trim();
        if (!val || this.floors.includes(val)) return;
        this.floors.push(val);
        this.data.config.floors = this.floors;
        await this.saveData();
        this.updateFloors();
        document.getElementById('new-floor').value = '';
    },

    async removeFloor(floor) {
        try {
            await sb.from('receipts').delete().eq('floor', floor);
            this.floors = this.floors.filter(f => f !== floor);
            this.data.config.floors = this.floors;
            delete this.data.luz[floor];
            delete this.data.agua[floor];
            await this.saveData();
            this.updateFloors();
        } catch (e) {
            this.showAlert('Error al eliminar.', 'danger', 'config');
        }
    },

    updateDashboard() {
        let lT = 0, aT = 0;
        const sum = (o) => {
            let s = 0;
            Object.values(o || {}).forEach(y => Object.values(y || {}).forEach(r => s += r.total || 0));
            return s;
        };
        this.floors.forEach(f => {
            lT += sum(this.data.luz[f]);
            aT += sum(this.data.agua[f]);
        });
        document.getElementById('total-luz').textContent = lT.toFixed(2);
        document.getElementById('total-agua').textContent = aT.toFixed(2);
        document.getElementById('total-floors').textContent = this.floors.length;
    },

    async calculate(service, event) {
        event.preventDefault();
        const gV = (id) => document.getElementById(id).value || '0';
        const res = {
            floor: gV(`${service}-floor`),
            year: parseInt(gV(`${service}-year`)),
            month: parseInt(gV(`${service}-month`)),
            prev: parseFloat(gV(`${service}-prev`)),
            curr: parseFloat(gV(`${service}-curr`)),
            price: parseFloat(gV(`${service}-price`)),
            fixedAporte: parseFloat(gV(`${service}-fixed-aporte`)),
            fixedCargo: parseFloat(gV(`${service}-fixed-cargo`)),
            consumption: parseFloat(gV(`${service}-curr`)) - parseFloat(gV(`${service}-prev`))
        };

        if (service === 'agua') {
            res.sewerage = parseFloat(gV('agua-sewerage'));
            res.subTotal = (res.consumption * res.price) + (res.consumption * res.sewerage);
        } else {
            res.fixedAlumbrado = parseFloat(gV('luz-fixed-alumbrado'));
            res.fixedLey = parseFloat(gV('luz-fixed-ley'));
            res.subTotal = res.consumption * res.price;
            res.gastosFijos = res.fixedCargo + res.fixedAlumbrado + res.fixedLey + res.fixedAporte;
        }
        res.impuesto = res.subTotal * 0.18;
        res.total = res.subTotal + res.impuesto + (service === 'agua' ? (res.fixedCargo + res.fixedAporte) : res.gastosFijos);

        try {
            this.showSpinner(true);
            const { error } = await sb.from('receipts').upsert({ service, floor: res.floor, year: res.year, month: res.month, data: res }, { onConflict: 'service, floor, year, month' });
            if (error) throw error;
            if (!this.data[service][res.floor]) this.data[service][res.floor] = {};
            if (!this.data[service][res.floor][res.year]) this.data[service][res.floor][res.year] = {};
            this.data[service][res.floor][res.year][res.month] = res;
            this.updateDashboard();
            this.showAlert('Guardado.', 'success', service);
            document.getElementById(`${service}-form`).reset();
            document.getElementById(`${service}-year`).value = this.currentYear;
        } catch (e) {
            this.showAlert('Error al guardar.', 'danger', service);
        } finally {
            this.showSpinner(false);
        }
    },

    generateReport(event) {
        if (event) event.preventDefault();
        const serv = document.getElementById('report-service').value;
        const fl = document.getElementById('report-floor').value;
        const yr = document.getElementById('report-year').value;
        let res = [];
        (fl ? [fl] : this.floors).forEach(f => {
            if (!this.data[serv][f]) return;
            (yr ? [yr] : Object.keys(this.data[serv][f])).forEach(y => {
                const mData = this.data[serv][f][y];
                if (mData) Object.entries(mData).forEach(([m, d]) => res.push({ floor: f, year: parseInt(y), month: parseInt(m), ...d }));
            });
        });
        res.sort((a, b) => b.year - a.year || b.month - a.month);
        this.renderTable(res, serv);
        this.updateChart(res);
    },

    renderTable(data, service) {
        const container = document.getElementById('report-result');
        if (data.length === 0) {
            container.innerHTML = '<p class="text-center p-4">Sin registros.</p>';
            return;
        }
        let h = `<div class="table-responsive"><table id="report-table" class="table table-hover">
            <thead><tr><th>Piso</th><th>Periodo</th><th>Consumo</th><th>Total</th><th>Acciones</th></tr></thead><tbody>`;
        data.forEach(r => {
            h += `<tr>
                <td>Piso ${r.floor}</td><td>${MONTHS[r.month - 1]} ${r.year}</td><td>${r.consumption.toFixed(2)}</td><td>S/ ${r.total.toFixed(2)}</td>
                <td>
                    <button class="btn btn-sm btn-outline-primary" onclick="RecibosSystem.editReceipt('${service}', '${r.floor}', ${r.year}, ${r.month})">Editar</button>
                    <button class="btn btn-sm btn-outline-danger" onclick="RecibosSystem.promptPassword('deleteReceipt', ['${service}', '${r.floor}', ${r.year}, ${r.month}])">X</button>
                </td>
            </tr>`;
        });
        container.innerHTML = h + '</tbody></table></div>';
    },

    async deleteReceipt(service, floor, year, month) {
        try {
            await sb.from('receipts').delete().match({ service, floor, year, month });
            delete this.data[service][floor][year][month];
            this.generateReport();
            this.updateDashboard();
        } catch (e) {
            this.showAlert('Error al eliminar.', 'danger', 'report');
        }
    },

    editReceipt(service, floor, year, month) {
        const r = this.data[service][floor][year][month];
        if (!r) return;
        ['service', 'floor', 'year', 'month', 'prev', 'curr', 'price', 'fixed-aporte', 'fixed-cargo'].forEach(f => {
            const el = document.getElementById('edit-' + f);
            if (el) el.value = r[f.replace('-', '')] || r[f] || '';
        });
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

    async saveEditedReceipt(event) {
        event.preventDefault();
        const gV = (id) => document.getElementById(id).value;
        const s = gV('edit-service'), fl = gV('edit-floor'), y = parseInt(gV('edit-year')), m = parseInt(gV('edit-month'));
        const res = { floor: fl, year: y, month: m, prev: parseFloat(gV('edit-prev')), curr: parseFloat(gV('edit-curr')), price: parseFloat(gV('edit-price')), fixedAporte: parseFloat(gV('edit-fixed-aporte')), fixedCargo: parseFloat(gV('edit-fixed-cargo')), consumption: parseFloat(gV('edit-curr')) - parseFloat(gV('edit-prev')) };
        if (s === 'agua') { res.sewerage = parseFloat(gV('edit-sewerage')); res.subTotal = (res.consumption * res.price) + (res.consumption * res.sewerage); }
        else { res.fixedAlumbrado = parseFloat(gV('edit-fixed-alumbrado')); res.fixedLey = parseFloat(gV('edit-fixed-ley')); res.subTotal = res.consumption * res.price; res.gastosFijos = res.fixedCargo + res.fixedAlumbrado + res.fixedLey + res.fixedAporte; }
        res.impuesto = res.subTotal * 0.18;
        res.total = res.subTotal + res.impuesto + (s === 'agua' ? (res.fixedCargo + res.fixedAporte) : res.gastosFijos);

        try {
            this.showSpinner(true);
            await sb.from('receipts').upsert({ service: s, floor: fl, year: y, month: m, data: res }, { onConflict: 'service, floor, year, month' });
            this.data[s][fl][y][m] = res;
            bootstrap.Modal.getInstance(document.getElementById('editReceiptModal')).hide();
            this.generateReport();
            this.updateDashboard();
        } catch (e) {
            this.showAlert('Error al editar.', 'danger', 'report');
        } finally {
            this.showSpinner(false);
        }
    },

    updateChart(data) {
        const ctx = document.getElementById('consumption-chart');
        if (this.chart) this.chart.destroy();
        const d = data.slice(0, 12).reverse();
        this.chart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: d.map(r => `${MONTHS[r.month - 1].substring(0, 3)} ${r.year}`),
                datasets: [{ label: 'Consumo', data: d.map(r => r.consumption), borderColor: '#3b82f6' }, { label: 'Total (S/)', data: d.map(r => r.total), borderColor: '#10b981' }]
            }
        });
    },

    exportToPDF() {
        try {
            const table = document.getElementById('report-table');
            if (!table) return this.showAlert('Genere un reporte primero.', 'warning', 'report');
            const { jsPDF } = window.jspdf;
            const doc = new jsPDF();
            doc.text('REPORTE DE CONSUMO', 14, 20);
            doc.autoTable({ html: '#report-table', startY: 30, didParseCell: (d) => { if (d.column.index === 4) d.cell.text = ''; } });
            doc.save('reporte.pdf');
        } catch (e) {
            console.error(e);
            this.showAlert('Error al exportar PDF: ' + e.message, 'danger', 'report');
        }
    },

    exportToExcel() {
        try {
            const table = document.getElementById('report-table');
            if (!table) return this.showAlert('Genere un reporte primero.', 'warning', 'report');
            let csv = [];
            table.querySelectorAll('tr').forEach(tr => {
                let row = [];
                tr.querySelectorAll('th, td').forEach((cell, i) => { if (i < 4) row.push('"' + cell.innerText.trim() + '"'); });
                csv.push(row.join(','));
            });
            const blob = new Blob(["\uFEFF" + csv.join('\n')], { type: 'text/csv;charset=utf-8;' });
            (window.saveAs || window.FileSaver?.saveAs)(blob, 'reporte.csv');
        } catch (e) {
            this.showAlert('Error al exportar Excel.', 'danger', 'report');
        }
    },

    exportToWord() {
        try {
            const table = document.getElementById('report-table');
            if (!table) return this.showAlert('Genere un reporte primero.', 'warning', 'report');
            let content = `<html><body><h1>REPORTE</h1><table border="1">${table.innerHTML}</table></body></html>`;
            content = content.replace(/<button.*?<\/button>/g, '').replace(/<th>Acciones<\/th>/g, '');
            const blob = new Blob(['\ufeff', content], { type: 'application/msword' });
            (window.saveAs || window.FileSaver?.saveAs)(blob, 'reporte.doc');
        } catch (e) {
            this.showAlert('Error al exportar Word.', 'danger', 'report');
        }
    }
};
window.onload = () => RecibosSystem.init();