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
        if (!window.bootstrap || !window.Chart || !window.jspdf || !window.saveAs || !window.supabase) {
            console.error('Dependencias faltantes: Bootstrap, Chart.js, jsPDF, FileSaver.js o Supabase');
            this.showAlert('Error: Faltan dependencias necesarias. Contacte al administrador.', 'danger', null);
            return;
        }

        if (!window.SUPABASE_CONFIG) {
            console.error('Configuración de Supabase no encontrada. Verifique config.js');
            this.showAlert('Error: Configuración de base de datos no encontrada.', 'danger', null);
            return;
        }

        // Inicializar cliente de Supabase
        window.sb = supabase.createClient(window.SUPABASE_CONFIG.url, window.SUPABASE_CONFIG.key);
        console.log('Cliente Supabase inicializado');

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
        if (!form) return;
        if (!form.checkValidity()) {
            form.classList.add('was-validated');
            return;
        }
        const username = document.getElementById('username-input')?.value || '';
        const password = document.getElementById('login-password-input')?.value || '';

        if (username === this.data.config.username && password === this.data.config.password) {
            sessionStorage.setItem('loggedIn', 'true');
            bootstrap.Modal.getInstance(document.getElementById('loginModal')).hide();
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
        const phoneInput = document.getElementById('phone-input');
        if (phoneInput) phoneInput.value = '';
        modal.show();
    },

    recoverPassword(event) {
        event.preventDefault();
        const form = document.getElementById('forgot-password-form');
        if (!form || !form.checkValidity()) {
            form?.classList.add('was-validated');
            return;
        }
        const phone = document.getElementById('phone-input')?.value || '';
        if (phone === this.data.config.phone) {
            this.isRecoveryMode = true;
            bootstrap.Modal.getInstance(document.getElementById('forgotPasswordModal')).hide();
            this.showChangePasswordModal(true);
            this.showAlert('Número verificado. Proceda a cambiar la contraseña.', 'success', null);
        } else {
            this.showAlert('Número de celular incorrecto.', 'danger', null);
        }
        form.classList.remove('was-validated');
    },

    promptChangeUsername() {
        const modal = new bootstrap.Modal(document.getElementById('changeUsernameModal'));
        const passwordInput = document.getElementById('current-password-for-username');
        const usernameInput = document.getElementById('new-username-input');
        if (passwordInput) passwordInput.value = '';
        if (usernameInput) usernameInput.value = '';
        modal.show();
    },

    async changeUsername(event) {
        event.preventDefault();
        const form = document.getElementById('change-username-form');
        if (!form || !form.checkValidity()) {
            form?.classList.add('was-validated');
            return;
        }
        const currentPassword = document.getElementById('current-password-for-username')?.value || '';
        const newUsername = this.sanitizeInput(document.getElementById('new-username-input')?.value.trim() || '');

        if (currentPassword !== this.data.config.password) {
            this.showAlert('Contraseña actual incorrecta.', 'danger', 'config');
            return;
        }
        if (!newUsername) {
            this.showAlert('Por favor, ingrese un usuario válido.', 'danger', 'config');
            return;
        }

        this.data.config.username = newUsername;
        await this.saveData();
        bootstrap.Modal.getInstance(document.getElementById('changeUsernameModal')).hide();
        this.showAlert('Usuario cambiado exitosamente. Inicie sesión nuevamente.', 'success', 'config');
        this.logout();
        form.classList.remove('was-validated');
    },

    promptChangePassword() {
        this.isRecoveryMode = false;
        this.showChangePasswordModal(false);
    },

    showChangePasswordModal(hideCurrentPassword) {
        const modal = new bootstrap.Modal(document.getElementById('changePasswordModal'));
        const currentPasswordInput = document.getElementById('current-password-input');
        const newPasswordInput = document.getElementById('new-password-input');
        const confirmPasswordInput = document.getElementById('confirm-new-password-input');
        const currentPasswordDiv = document.getElementById('current-password-div');
        if (currentPasswordInput) currentPasswordInput.value = '';
        if (newPasswordInput) newPasswordInput.value = '';
        if (confirmPasswordInput) confirmPasswordInput.value = '';
        if (currentPasswordDiv) currentPasswordDiv.style.display = hideCurrentPassword ? 'none' : 'block';
        if (currentPasswordInput) {
            if (hideCurrentPassword) {
                currentPasswordInput.removeAttribute('required');
            } else {
                currentPasswordInput.setAttribute('required', '');
            }
        }
        modal.show();
    },

    async changePassword(event) {
        event.preventDefault();
        const form = document.getElementById('change-password-form');
        if (!form || !form.checkValidity()) {
            form?.classList.add('was-validated');
            return;
        }
        const currentPassword = document.getElementById('current-password-input')?.value || '';
        const newPassword = document.getElementById('new-password-input')?.value || '';
        const confirmNewPassword = document.getElementById('confirm-new-password-input')?.value || '';

        if (newPassword !== confirmNewPassword) {
            this.showAlert('Las nuevas contraseñas no coinciden.', 'danger', this.isRecoveryMode ? null : 'config');
            return;
        }
        if (!this.isRecoveryMode && currentPassword !== this.data.config.password) {
            this.showAlert('Contraseña actual incorrecta.', 'danger', 'config');
            return;
        }

        this.data.config.password = newPassword;
        await this.saveData();
        bootstrap.Modal.getInstance(document.getElementById('changePasswordModal')).hide();
        this.showAlert('Contraseña cambiada exitosamente. Inicie sesión nuevamente.', 'success', this.isRecoveryMode ? null : 'config');
        this.logout();
        form.classList.remove('was-validated');
    },

    async loadData() {
        try {
            this.showSpinner(true);

            // Cargar configuración (settings)
            const { data: settingsData, error: settingsError } = await sb
                .from('settings')
                .select('value')
                .eq('key', 'config')
                .single();

            let config = settingsData ? settingsData.value : { floors: ['1', '2', '3'], username: 'master', password: '12345', phone: '945426574' };

            // Cargar recibos
            const { data: receiptsData, error: receiptsError } = await sb
                .from('receipts')
                .select('*');

            let luz = {};
            let agua = {};

            if (receiptsData) {
                receiptsData.forEach(r => {
                    const { service, floor, year, month, data } = r;
                    const target = service === 'luz' ? luz : agua;
                    if (!target[floor]) target[floor] = {};
                    if (!target[floor][year]) target[floor][year] = {};
                    target[floor][year][month] = data;
                });
            }

            this.data = { luz, agua, config };
            this.floors = this.data.config.floors;

            if (settingsError && settingsError.code !== 'PGRST116') throw settingsError;
            if (receiptsError) throw receiptsError;

        } catch (e) {
            console.error('Error cargando datos de Supabase:', e);
            this.showAlert('Error al cargar datos. Usando valores por defecto.', 'warning', null);
            this.data = { luz: {}, agua: {}, config: { floors: ['1', '2', '3'], username: 'master', password: '12345', phone: '945426574' } };
            this.floors = this.data.config.floors;
        } finally {
            this.showSpinner(false);
        }
    },

    async saveData() {
        try {
            this.showSpinner(true);
            const { error: settingsError } = await sb
                .from('settings')
                .upsert({ key: 'config', value: this.data.config }, { onConflict: 'key' });

            if (settingsError) throw settingsError;
            this.updateDashboard();
        } catch (e) {
            console.error('Error al guardar en Supabase:', e);
            this.showAlert('Error al conectar con la base de datos.', 'danger', null);
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
        alert.role = 'alert';
        alert.innerHTML = `
            ${this.sanitizeInput(message)}
            <button type="button" class="btn-close" data-bs-dismiss="alert" aria-label="Close"></button>
        `;
        const target = tabId ? document.getElementById(tabId) : document.getElementById('main-content') || document.body;
        if (target) {
            target.insertBefore(alert, target.firstChild);
            setTimeout(() => alert.remove(), 5000);
        }
    },

    validateNumberInput(value, fieldName, tabId) {
        const num = parseFloat(value);
        if (isNaN(num)) {
            this.showAlert(`El campo ${fieldName} debe ser un número válido.`, 'danger', tabId);
            return false;
        }
        if (fieldName !== 'Consumo Anterior' && fieldName !== 'Consumo Actual' && num < 0) {
            this.showAlert(`El campo ${fieldName} debe ser un número no negativo.`, 'danger', tabId);
            return false;
        }
        return true;
    },

    sanitizeInput(input) {
        return typeof input === 'string' ? input.replace(/[<>&"']/g, '') : input;
    },

    updateFloors() {
        const floorOptions = this.floors.map(f => `<option value="${f}">Piso ${f}</option>`).join('');
        const idMap = {
            'luz-floor': '<option value="" disabled selected>Seleccione un piso</option>' + floorOptions,
            'agua-floor': '<option value="" disabled selected>Seleccione un piso</option>' + floorOptions,
            'report-floor': '<option value="">Todos los Pisos</option>' + floorOptions
        };

        Object.entries(idMap).forEach(([id, html]) => {
            const el = document.getElementById(id);
            if (el) el.innerHTML = html;
        });

        const floorList = document.getElementById('floor-list');
        if (floorList) {
            floorList.innerHTML = this.floors.map(f => `
                <li class="list-group-item d-flex justify-content-between align-items-center">
                    Piso ${f}
                    <button class="btn btn-sm btn-danger" onclick="RecibosSystem.promptPassword('removeFloor', ['${f}'])">Eliminar</button>
                </li>
            `).join('');
        }
        this.updateDashboard();
    },

    setupMonthOptions() {
        const monthOptions = MONTHS.map((m, i) => `<option value="${i + 1}">${m}</option>`).join('');
        const luzMonth = document.getElementById('luz-month');
        const aguaMonth = document.getElementById('agua-month');
        if (luzMonth) luzMonth.innerHTML = '<option value="" disabled selected>Seleccione un mes</option>' + monthOptions;
        if (aguaMonth) aguaMonth.innerHTML = '<option value="" disabled selected>Seleccione un mes</option>' + monthOptions;
    },

    setupEventListeners() {
        const handlers = {
            'luz-form': (e) => this.calculate('luz', e),
            'agua-form': (e) => this.calculate('agua', e),
            'report-form': (e) => this.generateReport(e),
            'login-form': (e) => this.login(e),
            'forgot-password-form': (e) => this.recoverPassword(e),
            'change-password-form': (e) => this.changePassword(e),
            'change-username-form': (e) => this.changeUsername(e),
            'password-form': (e) => this.verifyPassword(e),
            'edit-receipt-form': (e) => this.saveEditedReceipt(e)
        };

        Object.entries(handlers).forEach(([id, handler]) => {
            const form = document.getElementById(id);
            if (form) form.addEventListener('submit', handler);
        });
    },

    promptPassword(action, args = []) {
        if (this.lockoutUntil && Date.now() < this.lockoutUntil) {
            const remaining = Math.ceil((this.lockoutUntil - Date.now()) / 1000 / 60);
            this.showAlert(`Bloqueado. Intente en ${remaining} min.`, 'danger', 'report');
            return;
        }
        this.pendingAction = action;
        this.pendingActionArgs = args;
        const modal = new bootstrap.Modal(document.getElementById('passwordModal'));
        const input = document.getElementById('password-input');
        if (input) input.value = '';
        modal.show();
    },

    verifyPassword(event) {
        event.preventDefault();
        const passwordInput = document.getElementById('password-input');
        const password = passwordInput?.value || '';

        if (password === this.data.config.password) {
            this.passwordAttempts = 0;
            this.lockoutUntil = null;
            bootstrap.Modal.getInstance(document.getElementById('passwordModal')).hide();
            if (this.pendingAction) {
                this[this.pendingAction](...this.pendingActionArgs);
                this.pendingAction = null;
                this.pendingActionArgs = null;
            }
        } else {
            this.passwordAttempts++;
            if (this.passwordAttempts >= this.maxAttempts) {
                this.lockoutUntil = Date.now() + this.lockoutDuration;
                this.showAlert('Bloqueo de seguridad activado.', 'danger', 'report');
                bootstrap.Modal.getInstance(document.getElementById('passwordModal')).hide();
            } else {
                this.showAlert(`Incorrecta. Quedan ${this.maxAttempts - this.passwordAttempts} intentos.`, 'danger', 'report');
            }
        }
    },

    async addFloor() {
        const input = document.getElementById('new-floor');
        const newFloor = this.sanitizeInput(input?.value.trim());
        if (!newFloor || this.floors.includes(newFloor)) return;

        this.floors.push(newFloor);
        this.data.config.floors = this.floors;
        await this.saveData();
        this.updateFloors();
        if (input) input.value = '';
        this.showAlert('Piso agregado.', 'success', 'config');
    },

    async removeFloor(floor) {
        if (!confirm(`¿Eliminar Piso ${floor}?`)) return;
        try {
            await sb.from('receipts').delete().eq('floor', floor);
            this.floors = this.floors.filter(f => f !== floor);
            this.data.config.floors = this.floors;
            delete this.data.luz[floor];
            delete this.data.agua[floor];
            await this.saveData();
            this.updateFloors();
            this.showAlert(`Piso ${floor} eliminado.`, 'success', 'config');
        } catch (e) {
            this.showAlert('Error al eliminar el piso.', 'danger', 'config');
        }
    },

    updateDashboard() {
        let lTotal = 0, aTotal = 0;
        const sumR = (recs) => {
            let s = 0;
            Object.values(recs || {}).forEach(y => {
                Object.values(y || {}).forEach(r => s += r.total || 0);
            });
            return s;
        };

        this.floors.forEach(f => {
            lTotal += sumR(this.data.luz[f]);
            aTotal += sumR(this.data.agua[f]);
        });

        const elL = document.getElementById('total-luz');
        const elA = document.getElementById('total-agua');
        const elF = document.getElementById('total-floors');
        if (elL) elL.textContent = lTotal.toFixed(2);
        if (elA) elA.textContent = aTotal.toFixed(2);
        if (elF) elF.textContent = this.floors.length;
    },

    async calculate(service, event) {
        event.preventDefault();
        const form = document.getElementById(`${service}-form`);
        if (!form?.checkValidity()) {
            form?.classList.add('was-validated');
            return;
        }

        const gV = (id) => document.getElementById(id)?.value || '0';
        const inps = {
            floor: gV(`${service}-floor`),
            year: parseInt(gV(`${service}-year`)),
            month: parseInt(gV(`${service}-month`)),
            prev: parseFloat(gV(`${service}-prev`)),
            curr: parseFloat(gV(`${service}-curr`)),
            price: parseFloat(gV(`${service}-price`)),
            fixedAporte: parseFloat(gV(`${service}-fixed-aporte`)),
            fixedCargo: parseFloat(gV(`${service}-fixed-cargo`))
        };

        const res = { ...inps, consumption: inps.curr - inps.prev };

        if (service === 'agua') {
            inps.sewerage = parseFloat(gV('agua-sewerage'));
            res.waterCost = res.consumption * inps.price;
            res.sewerageCost = res.consumption * inps.sewerage;
            res.subTotal = res.waterCost + res.sewerageCost;
        } else {
            inps.fixedAlumbrado = parseFloat(gV('luz-fixed-alumbrado'));
            inps.fixedLey = parseFloat(gV('luz-fixed-ley'));
            res.subTotal = res.consumption * inps.price;
            res.gastosFijos = inps.fixedCargo + inps.fixedAlumbrado + inps.fixedLey + inps.fixedAporte;
        }

        res.impuesto = res.subTotal * 0.18;
        res.total = res.subTotal + res.impuesto + (service === 'agua' ? (inps.fixedCargo + inps.fixedAporte) : res.gastosFijos);

        try {
            this.showSpinner(true);
            const { error } = await sb.from('receipts').upsert({
                service, floor: inps.floor, year: inps.year, month: inps.month, data: res
            }, { onConflict: 'service, floor, year, month' });

            if (error) throw error;

            if (!this.data[service][inps.floor]) this.data[service][inps.floor] = {};
            if (!this.data[service][inps.floor][inps.year]) this.data[service][inps.floor][inps.year] = {};
            this.data[service][inps.floor][inps.year][inps.month] = res;

            this.showAlert('Guardado.', 'success', service);
            this.updateDashboard();
            form.reset();
            const yearEl = document.getElementById(`${service}-year`);
            if (yearEl) yearEl.value = this.currentYear;
        } catch (e) {
            this.showAlert('Error al guardar.', 'danger', service);
        } finally {
            this.showSpinner(false);
        }
    },

    generateReport(event) {
        if (event) event.preventDefault();
        const service = document.getElementById('report-service').value;
        const floor = document.getElementById('report-floor').value;
        const year = document.getElementById('report-year').value;

        let results = [];
        const floorList = floor ? [floor] : this.floors;

        floorList.forEach(f => {
            const fData = this.data[service][f];
            if (!fData) return;
            const yList = year ? [year] : Object.keys(fData);
            yList.forEach(y => {
                const mData = fData[y];
                if (!mData) return;
                Object.entries(mData).forEach(([m, d]) => {
                    results.push({ floor: f, year: y, month: m, ...d });
                });
            });
        });

        results.sort((a, b) => b.year - a.year || b.month - a.month);
        this.renderTable(results, service);
        this.updateChart(results, service, floor, year);
    },

    renderTable(data, service) {
        const container = document.getElementById('report-result');
        if (!container) return;

        if (data.length === 0) {
            container.innerHTML = '<p class="text-center p-4">Sin registros.</p>';
            return;
        }

        let h = `<div class="table-responsive"><table class="table table-hover">
            <thead><tr><th>Piso</th><th>Periodo</th><th>Consumo</th><th>Total</th><th>Acciones</th></tr></thead><tbody>`;

        data.forEach(r => {
            h += `<tr>
                <td>Piso ${r.floor}</td>
                <td>${MONTHS[r.month - 1]} ${r.year}</td>
                <td>${r.consumption.toFixed(2)}</td>
                <td>S/ ${r.total.toFixed(2)}</td>
                <td>
                    <button class="btn btn-sm btn-outline-primary" onclick="RecibosSystem.editReceipt('${service}', '${r.floor}', ${r.year}, ${r.month})">Edit</button>
                    <button class="btn btn-sm btn-outline-danger" onclick="RecibosSystem.promptPassword('deleteReceipt', ['${service}', '${r.floor}', ${r.year}, ${r.month}])">X</button>
                </td>
            </tr>`;
        });
        h += '</tbody></table></div>';
        container.innerHTML = h;
    },

    async deleteReceipt(service, floor, year, month) {
        if (!confirm('¿Eliminar?')) return;
        try {
            await sb.from('receipts').delete().match({ service, floor, year, month });
            delete this.data[service][floor][year][month];
            this.generateReport();
            this.updateDashboard();
            this.showAlert('Eliminado.', 'success', 'report');
        } catch (e) {
            this.showAlert('Error.', 'danger', 'report');
        }
    },

    updateChart(data, service, floor, year) {
        const ctx = document.getElementById('consumption-chart');
        if (!ctx) return;
        if (this.chart) this.chart.destroy();

        const cD = data.slice(0, 12).reverse();
        this.chart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: cD.map(r => `${MONTHS[r.month - 1].substring(0, 3)} ${r.year}`),
                datasets: [{
                    label: 'Consumo', data: cD.map(r => r.consumption), borderColor: '#3b82f6', yAxisID: 'y'
                }, {
                    label: 'Total (S/)', data: cD.map(r => r.total), borderColor: '#10b981', yAxisID: 'y1'
                }]
            },
            options: { scales: { y: { position: 'left' }, y1: { position: 'right', grid: { drawOnChartArea: false } } } }
        });
    }
};

window.onload = () => RecibosSystem.init();