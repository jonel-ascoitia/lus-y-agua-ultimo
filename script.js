if (!window.localStorage) {
    window.localStorage = {
        getItem: () => null,
        setItem: () => { },
        removeItem: () => { }
    };
}

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

        await this.loadData();

        // Initial sync from localStorage to Supabase if Supabase is empty but localStorage has data
        const localStoredData = localStorage.getItem('recibosData');
        if (localStoredData && (!this.data || (Object.keys(this.data.luz).length === 0 && Object.keys(this.data.agua).length === 0))) {
            try {
                this.data = JSON.parse(localStoredData);
                await this.saveData();
                console.log('Datos migrados de localStorage a Supabase');
            } catch (e) {
                console.error('Error migrando datos locales:', e);
            }
        }

        if (!this.data.config.username || !this.data.config.password || !this.data.config.phone) {
            this.data.config.username = 'master';
            this.data.config.password = '12345';
            this.data.config.phone = '945426574';
            await this.saveData();
        }
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
        if (!loginModal) {
            console.error('Elemento loginModal no encontrado');
            this.showAlert('Error: No se puede mostrar el formulario de inicio de sesión.', 'danger', null);
            return;
        }
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
        bootstrap.Modal.getInstance(document.getElementById('loginModal')).hide();
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

    changeUsername(event) {
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
        this.saveData();
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

    changePassword(event) {
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
        this.saveData();
        bootstrap.Modal.getInstance(document.getElementById('changePasswordModal')).hide();
        this.showAlert('Contraseña cambiada exitosamente. Inicie sesión nuevamente.', 'success', this.isRecoveryMode ? null : 'config');
        this.logout();
        form.classList.remove('was-validated');
    },

    async loadData() {
        try {
            // Cargar configuración (settings)
            const { data: settingsData, error: settingsError } = await sb
                .from('settings')
                .select('value')
                .eq('key', 'config')
                .single();

            let config = { floors: ['1', '2', '3'], username: '', password: '', phone: '' };
            if (settingsData) {
                config = settingsData.value;
            }

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

            if (settingsError && settingsError.code !== 'PGRST116') { // PGRST116 is "no rows found"
                console.warn('Error cargando configuración:', settingsError);
            }
        } catch (e) {
            console.error('Error al cargar datos de Supabase:', e);
            this.showAlert('Error al cargar datos. Usando valores por defecto.', 'warning', null);
            this.data = { luz: {}, agua: {}, config: { floors: ['1', '2', '3'], username: '', password: '', phone: '' } };
            this.floors = this.data.config.floors;
        }
    },

    async saveData() {
        try {
            this.showSpinner(true);
            // Guardar configuración
            const { error: settingsError } = await sb
                .from('settings')
                .upsert({ key: 'config', value: this.data.config }, { onConflict: 'key' });

            if (settingsError) throw settingsError;

            // Nota: Los recibos se guardan individualmente en calculate/edit/delete
            // para evitar sobrescribir todo el JSONB si creáramos una tabla de "datos globales"

            this.updateDashboard();
        } catch (e) {
            console.error('Error al guardar datos en Supabase:', e);
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
        } else {
            console.warn('No se encontró el contenedor para mostrar la alerta');
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
        return input.replace(/[<>&"']/g, '');
    },

    updateFloors() {
        const floorOptions = this.floors.map(f => `<option value="${f}">Piso ${f}</option>`).join('');
        const luzFloor = document.getElementById('luz-floor');
        const aguaFloor = document.getElementById('agua-floor');
        const reportFloor = document.getElementById('report-floor');
        const floorList = document.getElementById('floor-list');
        if (luzFloor) luzFloor.innerHTML = '<option value="" disabled selected>Seleccione un piso</option>' + floorOptions;
        if (aguaFloor) aguaFloor.innerHTML = '<option value="" disabled selected>Seleccione un piso</option>' + floorOptions;
        if (reportFloor) reportFloor.innerHTML = '<option value="">Todos los Pisos</option>' + floorOptions;
        if (floorList) {
            floorList.innerHTML = this.floors.map(f => `
                <li class="list-group-item d-flex justify-between align-items-center">
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
        const forms = {
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
        Object.entries(forms).forEach(([id, handler]) => {
            const form = document.getElementById(id);
            if (form) form.addEventListener('submit', handler);
        });
    },

    promptPassword(action, args = []) {
        if (this.lockoutUntil && Date.now() < this.lockoutUntil) {
            const remaining = Math.ceil((this.lockoutUntil - Date.now()) / 1000 / 60);
            this.showAlert(`Demasiados intentos fallidos. Intente de nuevo en ${remaining} minuto(s).`, 'danger', 'report');
            return;
        }
        this.pendingAction = action;
        this.pendingActionArgs = args;
        const passwordModal = document.getElementById('passwordModal');
        if (passwordModal) {
            const modal = new bootstrap.Modal(passwordModal);
            const passwordInput = document.getElementById('password-input');
            if (passwordInput) passwordInput.value = '';
            modal.show();
        } else {
            console.error('Elemento passwordModal no encontrado');
            this.showAlert('Error: No se puede mostrar el formulario de contraseña.', 'danger', 'report');
        }
    },

    verifyPassword(event) {
        event.preventDefault();
        const form = document.getElementById('password-form');
        if (!form || !form.checkValidity()) {
            form?.classList.add('was-validated');
            return;
        }
        if (this.lockoutUntil && Date.now() < this.lockoutUntil) {
            const remaining = Math.ceil((this.lockoutUntil - Date.now()) / 1000 / 60);
            this.showAlert(`Demasiados intentos fallidos. Intente de nuevo en ${remaining} minuto(s).`, 'danger', 'report');
            return;
        }
        const passwordInput = document.getElementById('password-input');
        const password = passwordInput?.value || '';
        if (password === this.data.config.password) {
            this.passwordAttempts = 0;
            this.lockoutUntil = null;
            form.reset();
            form.classList.remove('was-validated');
            bootstrap.Modal.getInstance(document.getElementById('passwordModal')).hide();
            if (this.pendingAction && typeof this[this.pendingAction] === 'function') {
                this[this.pendingAction](...this.pendingActionArgs);
                this.pendingAction = null;
                this.pendingActionArgs = null;
            }
        } else {
            this.passwordAttempts++;
            if (passwordInput) passwordInput.value = '';
            form.classList.add('was-validated');
            if (this.passwordAttempts >= this.maxAttempts) {
                this.lockoutUntil = Date.now() + this.lockoutDuration;
                this.showAlert(`Demasiados intentos fallidos. Bloqueado por 5 minutos.`, 'danger', 'report');
                bootstrap.Modal.getInstance(document.getElementById('passwordModal')).hide();
            } else {
                this.showAlert(`Contraseña incorrecta. Intentos restantes: ${this.maxAttempts - this.passwordAttempts}.`, 'danger', 'report');
            }
        }
    },

    async addFloor() {
        const newFloorInput = document.getElementById('new-floor');
        if (!newFloorInput) return;
        const newFloor = this.sanitizeInput(newFloorInput.value.trim());
        if (!newFloor) {
            this.showAlert('Por favor, ingrese un nombre de piso válido.', 'danger', 'config');
            return;
        }
        if (this.floors.includes(newFloor)) {
            this.showAlert('El piso ya existe.', 'warning', 'config');
            return;
        }
        this.floors.push(newFloor);
        this.data.config.floors = this.floors;
        await this.saveData();
        this.updateFloors();
        newFloorInput.value = '';
        this.showAlert('Piso agregado exitosamente.', 'success', 'config');
    },

    async removeFloor(floor) {
        if (!confirm(`¿Eliminar Piso ${floor}? Esto borrará todos los datos asociados.`)) return;

        try {
            this.showSpinner(true);
            // 1. Eliminar recibos asociados
            const { error: receiptsError } = await sb
                .from('receipts')
                .delete()
                .eq('floor', floor);

            if (receiptsError) throw receiptsError;

            // 2. Actualizar configuración
            this.floors = this.floors.filter(f => f !== floor);
            this.data.config.floors = this.floors;
            delete this.data.luz[floor];
            delete this.data.agua[floor];

            await this.saveData();
            this.updateFloors();
            this.showAlert(`Piso ${floor} eliminado.`, 'success', 'config');
        } catch (e) {
            console.error('Error al eliminar piso:', e);
            this.showAlert('Error al eliminar el piso de la base de datos.', 'danger', 'config');
        } finally {
            this.showSpinner(false);
        }
    },

    async clearData() {
        if (!confirm('¿Limpiar todos los datos? Esta acción es irreversible.')) return;

        try {
            this.showSpinner(true);
            // 1. Eliminar todos los recibos
            const { error: receiptsError } = await sb
                .from('receipts')
                .delete()
                .neq('service', 'undefined'); // Truco para borrar todo

            if (receiptsError) throw receiptsError;

            // 2. Reiniciar configuración
            this.data = { luz: {}, agua: {}, config: { floors: ['1', '2', '3'], username: 'master', password: '12345', phone: '945426574' } };
            this.floors = this.data.config.floors;

            await this.saveData();
            this.updateFloors();

            if (this.chart) {
                this.chart.destroy();
                this.chart = null;
            }
            const reportResult = document.getElementById('report-result');
            if (reportResult) reportResult.innerHTML = '';

            this.showAlert('Datos limpiados exitosamente.', 'success', 'config');
        } catch (e) {
            console.error('Error al limpiar datos:', e);
            this.showAlert('Error al limpiar la base de datos.', 'danger', 'config');
        } finally {
            this.showSpinner(false);
        }
    },

    backupData() {
        const dataStr = JSON.stringify(this.data, null, 2);
        const blob = new Blob([dataStr], { type: 'application/json' });
        saveAs(blob, `recibos_backup_${new Date().toISOString().split('T')[0]}.json`);
        this.showAlert('Respaldo descargado exitosamente.', 'success', 'config');
    },

    restoreData() {
        const fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.accept = '.json';
        fileInput.onchange = (e) => {
            const file = e.target.files[0];
            if (!file) {
                this.showAlert('Por favor, seleccione un archivo JSON.', 'warning', 'config');
                return;
            }
            const reader = new FileReader();
            reader.onload = (e) => {
                try {
                    const restoredData = JSON.parse(e.target.result);
                    if (!restoredData.luz || !restoredData.agua || !restoredData.config || !Array.isArray(restoredData.config.floors)) {
                        throw new Error('Formato de datos inválido');
                    }
                    this.data = restoredData;
                    this.floors = this.data.config.floors;
                    this.saveData();
                    this.updateFloors();
                    this.showAlert('Datos restaurados exitosamente.', 'success', 'config');
                } catch (error) {
                    console.error('Error al restaurar datos:', error);
                    this.showAlert('Error al restaurar datos. Asegúrese de que el archivo sea válido.', 'danger', 'config');
                }
            };
            reader.readAsText(file);
        };
        fileInput.click();
    },

    updateDashboard() {
        let totalLuz = 0, totalAgua = 0;
        this.floors.forEach(floor => {
            if (this.data.luz[floor]) {
                Object.values(this.data.luz[floor]).forEach(year => {
                    Object.values(year).forEach(record => {
                        totalLuz += record.total || 0;
                    });
                });
            }
            if (this.data.agua[floor]) {
                Object.values(this.data.agua[floor]).forEach(year => {
                    Object.values(year).forEach(record => {
                        totalAgua += record.total || 0;
                    });
                });
            }
        });
        const totalLuzElement = document.getElementById('total-luz');
        const totalAguaElement = document.getElementById('total-agua');
        const totalFloorsElement = document.getElementById('total-floors');
        if (totalLuzElement) totalLuzElement.textContent = totalLuz.toFixed(2);
        if (totalAguaElement) totalAguaElement.textContent = totalAgua.toFixed(2);
        if (totalFloorsElement) totalFloorsElement.textContent = this.floors.length;
    },

    async calculate(service, event) {
        event.preventDefault();
        const form = document.getElementById(`${service}-form`);
        if (!form || !form.checkValidity()) {
            form?.classList.add('was-validated');
            return;
        }

        const inputs = {
            floor: document.getElementById(`${service}-floor`)?.value || '',
            year: document.getElementById(`${service}-year`)?.value || '',
            month: document.getElementById(`${service}-month`)?.value || '',
            prev: document.getElementById(`${service}-prev`)?.value || '',
            curr: document.getElementById(`${service}-curr`)?.value || '',
            price: document.getElementById(`${service}-price`)?.value || '',
            sewerage: service === 'agua' ? document.getElementById('agua-sewerage')?.value || '' : null,
            fixedCargo: document.getElementById(`${service}-fixed-cargo`)?.value || '0',
            fixedAlumbrado: document.getElementById(`${service}-fixed-alumbrado`)?.value || '0',
            fixedLey: document.getElementById(`${service}-fixed-ley`)?.value || '0',
            fixedAporte: document.getElementById(`${service}-fixed-aporte`)?.value || '0'
        };

        if (!inputs.floor || !inputs.year || !inputs.month) {
            this.showAlert('Por favor, complete todos los campos requeridos.', 'danger', service);
            return;
        }

        if (!this.validateNumberInput(inputs.prev, 'Consumo Anterior', service) ||
            !this.validateNumberInput(inputs.curr, 'Consumo Actual', service) ||
            !this.validateNumberInput(inputs.price, service === 'agua' ? 'Precio por m³ - Agua' : 'Precio por kWh', service) ||
            (service === 'agua' && !this.validateNumberInput(inputs.sewerage, 'Precio por m³ - Alcantarillado', service)) ||
            !this.validateNumberInput(inputs.fixedCargo, 'Gastos Fijos', service) ||
            (service === 'luz' && !this.validateNumberInput(inputs.fixedAlumbrado, 'Alumbrado Público', service)) ||
            (service === 'luz' && !this.validateNumberInput(inputs.fixedLey, 'Aporte a Ley', service)) ||
            !this.validateNumberInput(inputs.fixedAporte, 'Interés/Mora', service)) {
            return;
        }

        const floor = inputs.floor;
        const year = parseInt(inputs.year);
        const month = parseInt(inputs.month);
        const prev = parseFloat(inputs.prev);
        const curr = parseFloat(inputs.curr);
        const price = parseFloat(inputs.price);
        const fixedAporte = parseFloat(inputs.fixedAporte);

        let consumption, subTotal, impuesto, total, resultHTML, receiptData;

        if (service === 'agua') {
            const sewerage = parseFloat(inputs.sewerage);
            const fixedCargo = parseFloat(inputs.fixedCargo);
            consumption = curr - prev;
            const waterCost = consumption * price;
            const sewerageCost = consumption * sewerage;
            subTotal = waterCost + sewerageCost;
            impuesto = subTotal * 0.18;
            total = subTotal + impuesto + fixedCargo + fixedAporte;

            receiptData = {
                prev, curr, consumption, price, sewerage, waterCost, sewerageCost, subTotal, impuesto, total, fixedCargo, fixedAporte
            };

            const monthName = MONTHS[month - 1];
            resultHTML = `
                <h4 class="text-lg font-semibold">RECIBO DE AGUA  .P ${this.sanitizeInput(floor)} - ${monthName} / ${year}</h4>
                <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <p><strong>Consumo Anterior:</strong> ${prev.toFixed(2)} m³</p>
                    <p><strong>Consumo Actual:</strong> ${curr.toFixed(2)} m³</p>
                    <p><strong>Total de Consumo:</strong> ${consumption.toFixed(2)} m³</p>
                    <p><strong>Costo Agua:</strong> S/ ${waterCost.toFixed(2)}</p>
                    <p><strong>Costo Alcantarillado:</strong> S/ ${sewerageCost.toFixed(2)}</p>
                    <p><strong>Sub Total:</strong> S/ ${subTotal.toFixed(2)}</p>
                    <p><strong>Impuesto 18%:</strong> S/ ${impuesto.toFixed(2)}</p>
                    <p><strong>Gastos Fijos:</strong> S/ ${fixedCargo.toFixed(2)}</p>
                    <p><strong>Interés/Mora:</strong> S/ ${fixedAporte.toFixed(2)}</p>
                    <h1 style="color: green;">IMPORTE TOTAL: S/ ${total.toFixed(2)}</h1>
                </div>
            `;
        } else {
            const fixedCargo = parseFloat(inputs.fixedCargo);
            const fixedAlumbrado = parseFloat(inputs.fixedAlumbrado);
            const fixedLey = parseFloat(inputs.fixedLey);
            consumption = curr - prev;
            subTotal = consumption * price;
            impuesto = subTotal * 0.18;
            const gastosFijos = fixedCargo + fixedAlumbrado + fixedLey + fixedAporte;
            total = subTotal + impuesto + gastosFijos;

            receiptData = {
                prev, curr, consumption, price, subTotal, impuesto, gastosFijos, total, fixedCargo, fixedAlumbrado, fixedLey, fixedAporte
            };

            const monthName = MONTHS[month - 1];
            resultHTML = `
                <h4 class="text-lg font-semibold">RECIBO DE LUZ  .P ${this.sanitizeInput(floor)} - ${monthName} / ${year}</h4>
                <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <p><strong>Consumo Anterior:</strong> ${prev.toFixed(2)} kWh</p>
                    <p><strong>Consumo Actual:</strong> ${curr.toFixed(2)} kWh</p>
                    <p><strong>Consumo kWh:</strong> ${consumption.toFixed(2)}</p>
                    <p><strong>Sub Total:</strong> S/ ${subTotal.toFixed(2)}</p>
                    <p><strong>Impuesto 18%:</strong> S/ ${impuesto.toFixed(2)}</p>
                    <p><strong>Gastos Fijos:</strong> S/ ${gastosFijos.toFixed(2)}</p>
                    <p><strong>Detalles Gastos:</strong> Cargo: ${fixedCargo.toFixed(2)}, Alumbrado: ${fixedAlumbrado.toFixed(2)}, Aporte a Ley: ${fixedLey.toFixed(2)}, Interés/Mora: ${fixedAporte.toFixed(2)}</p>
                    <h1 style="color: green;">TOTAL A PAGAR: S/ ${total.toFixed(2)}</h1>
                </div>
            `;
        }

        try {
            this.showSpinner(true);
            const { error } = await sb
                .from('receipts')
                .upsert({
                    service, floor, year, month,
                    data: receiptData
                }, { onConflict: 'service, floor, year, month' });

            if (error) throw error;

            if (!this.data[service][floor]) this.data[service][floor] = {};
            if (!this.data[service][floor][year]) this.data[service][floor][year] = {};
            this.data[service][floor][year][month] = receiptData;

            const resultElement = document.getElementById(`${service}-result`);
            if (resultElement) resultElement.innerHTML = resultHTML;
            this.showAlert('Cálculo guardado exitosamente.', 'success', service);
            form.reset();
            if (document.getElementById(`${service}-year`)) document.getElementById(`${service}-year`).value = this.currentYear;
            form.classList.remove('was-validated');
            this.updateDashboard();
        } catch (e) {
            console.error('Error al guardar recibo:', e);
            this.showAlert('Error al guardar en la base de datos.', 'danger', service);
        } finally {
            this.showSpinner(false);
        }
    },

    generateChartConfig(chartData, unit, service, selectedFloor, selectedYear) {
        return {
            type: 'line',
            data: {
                labels: chartData.labels,
                datasets: [
                    {
                        label: `Consumo (${unit})`,
                        data: chartData.consumption,
                        borderColor: '#3b82f6',
                        backgroundColor: 'rgba(59, 130, 246, 0.2)',
                        fill: true,
                        yAxisID: 'y',
                        pointStyle: 'circle',
                        pointRadius: 5,
                        pointHoverRadius: 8
                    },
                    {
                        label: 'Total (S/)',
                        data: chartData.totals,
                        borderColor: '#10b981',
                        backgroundColor: 'rgba(16, 185, 129, 0.2)',
                        fill: true,
                        yAxisID: 'y1',
                        pointStyle: 'circle',
                        pointRadius: 5,
                        pointHoverRadius: 8
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { position: 'top' },
                    title: {
                        display: true,
                        text: `Consumo y Costos de ${this.sanitizeInput(service.toUpperCase())} ${selectedFloor ? '- Piso ' + this.sanitizeInput(selectedFloor) : '- Todos los Pisos'} ${selectedYear ? '- Año ' + selectedYear : ''}`,
                        font: { size: 14 }
                    },
                    tooltip: {
                        callbacks: {
                            label: function (context) {
                                let label = context.dataset.label || '';
                                if (label) label += ': ';
                                label += context.parsed.y.toFixed(2);
                                return label;
                            }
                        }
                    }
                },
                scales: {
                    y: {
                        type: 'linear',
                        position: 'left',
                        title: { display: true, text: `Consumo (${unit})` },
                        beginAtZero: true,
                        grid: { color: '#e5e7eb' }
                    },
                    y1: {
                        type: 'linear',
                        position: 'right',
                        title: { display: true, text: 'Total (S/)' },
                        beginAtZero: true,
                        grid: { drawOnChartArea: false }
                    },
                    x: {
                        title: { display: true, text: 'Período' },
                        grid: { color: '#e5e7eb' }
                    }
                }
            }
        };
    },

    generateReport(event) {
        event.preventDefault();
        const form = document.getElementById('report-form');
        if (!form || !form.checkValidity()) {
            form?.classList.add('was-validated');
            return;
        }
        const service = document.getElementById('report-service')?.value || '';
        const selectedFloor = document.getElementById('report-floor')?.value || '';
        const selectedYearInput = document.getElementById('report-year')?.value || '';
        const selectedYear = selectedYearInput ? parseInt(selectedYearInput) : '';
        const unit = service === 'luz' ? 'kWh' : 'm³';
        let totalGlobal = 0;
        let totalConsumption = 0;
        let recordCount = 0;
        let chartData = { labels: [], consumption: [], totals: [] };

        // Summary and table header
        let reportHTML = `
            <h4 class="text-lg font-semibold mb-3">Reporte para ${this.sanitizeInput(service.toUpperCase())} ${selectedFloor ? '- Piso ' + this.sanitizeInput(selectedFloor) : '- Todos los Pisos'} ${selectedYear ? '- Año ' + selectedYear : ''}</h4>
        `;
        const table = document.createElement('table');
        table.className = 'table table-striped table-bordered table-hover table-sm';
        table.innerHTML = `
            <thead class="table-dark">
                <tr>
                    <th>Piso</th>
                    <th>Año</th>
                    <th>Mes</th>
                    <th>Consumo (${unit})</th>
                    <th>Sub Total (S/)</th>
                    <th>Impuesto (S/)</th>
                    <th>${service === 'luz' ? 'Gastos Fijos (S/)' : 'Costo Agua (S/) / Alcantarillado (S/)'}</th>
                    <th>Total (S/)</th>
                    <th>Acciones</th>
                </tr>
            </thead>
            <tbody></tbody>
        `;
        const tbody = table.querySelector('tbody');

        const selectedFloors = selectedFloor ? [selectedFloor] : this.floors;
        selectedFloors.forEach(floor => {
            if (!this.data[service][floor]) return;
            let years = selectedYear ? [selectedYear] : Object.keys(this.data[service][floor]).map(y => parseInt(y)).sort((a, b) => a - b);
            years.forEach(y => {
                const months = Object.keys(this.data[service][floor][y] || {}).map(m => parseInt(m)).sort((a, b) => a - b);
                months.forEach(m => {
                    const d = this.data[service][floor][y][m];
                    const monthName = MONTHS[m - 1];
                    const extraField = service === 'luz'
                        ? `${(d.gastosFijos || 0).toFixed(2)} (Cargo: ${(d.fixedCargo || 0).toFixed(2)}, Alumbrado: ${(d.fixedAlumbrado || 0).toFixed(2)}, Aporte a Ley: ${(d.fixedLey || 0).toFixed(2)}, Interés/Mora: ${(d.fixedAporte || 0).toFixed(2)})`
                        : `${(d.waterCost || 0).toFixed(2)} / ${(d.sewerageCost || 0).toFixed(2)}`;
                    const row = `
                        <tr>
                            <td>${this.sanitizeInput(floor)}</td>
                            <td>${y}</td>
                            <td>${monthName}</td>
                            <td>${(d.consumption || 0).toFixed(2)}</td>
                            <td>${(d.subTotal || 0).toFixed(2)}</td>
                            <td>${(d.impuesto || 0).toFixed(2)}</td>
                            <td>${extraField}</td>
                            <td>${(d.total || 0).toFixed(2)}</td>
                            <td>
                                <button class="btn btn-sm btn-warning mr-1" onclick="RecibosSystem.promptPassword('editReceipt', ['${this.sanitizeInput(service)}', '${this.sanitizeInput(floor)}', ${y}, ${m}])">Editar</button>
                                <button class="btn btn-sm btn-danger" onclick="RecibosSystem.promptPassword('deleteReceipt', ['${this.sanitizeInput(service)}', '${this.sanitizeInput(floor)}', ${y}, ${m}])">Eliminar</button>
                            </td>
                        </tr>`;
                    tbody.innerHTML += row;
                    totalGlobal += d.total || 0;
                    totalConsumption += d.consumption || 0;
                    recordCount++;
                    chartData.labels.push(`${monthName} ${y}`);
                    chartData.consumption.push(d.consumption || 0);
                    chartData.totals.push(d.total || 0);
                });
            });
        });

        if (tbody.innerHTML === '') {
            reportHTML = '<p class="text-muted">No hay datos disponibles para los criterios seleccionados.</p>';
            const chartContainer = document.querySelector('.chart-container');
            if (chartContainer) chartContainer.style.display = 'none';
        } else {
            // Add summary section
            reportHTML += `
                <div class="alert alert-info mb-4">
                    <h5>Resumen</h5>
                    <p><strong>Total Registros:</strong> ${recordCount}</p>
                    <p><strong>Consumo Total:</strong> ${totalConsumption.toFixed(2)} ${unit}</p>
                    <p><strong>Costo Total:</strong> S/ ${totalGlobal.toFixed(2)}</p>
                </div>`;
            reportHTML += table.outerHTML;
            reportHTML += `<p class="font-semibold mt-3"><strong>Total General:</strong> S/ ${totalGlobal.toFixed(2)}</p>`;
            const chartContainer = document.querySelector('.chart-container');
            if (chartContainer) chartContainer.style.display = 'block';
        }
        const reportResult = document.getElementById('report-result');
        if (reportResult) reportResult.innerHTML = reportHTML;

        // Chart generation
        if (this.chart) {
            this.chart.destroy();
            this.chart = null;
        }
        if (chartData.labels.length === 0) {
            this.showAlert('No hay datos para mostrar en el gráfico.', 'warning', 'report');
            form.classList.remove('was-validated');
            return;
        }

        // Validate chart data
        if (!Array.isArray(chartData.labels) || !Array.isArray(chartData.consumption) || !Array.isArray(chartData.totals) ||
            chartData.labels.length !== chartData.consumption.length || chartData.labels.length !== chartData.totals.length) {
            this.showAlert('Datos del gráfico inválidos. No se puede generar el gráfico.', 'danger', 'report');
            form.classList.remove('was-validated');
            return;
        }

        const canvas = document.getElementById('consumption-chart');
        if (!canvas) {
            console.error('Canvas consumption-chart no encontrado');
            this.showAlert('Error: Elemento de gráfico no encontrado en la página.', 'danger', 'report');
            form.classList.remove('was-validated');
            return;
        }

        const ctx = canvas.getContext('2d');
        if (!ctx) {
            console.error('No se pudo obtener el contexto 2D del canvas');
            this.showAlert('Error: No se pudo inicializar el gráfico.', 'danger', 'report');
            form.classList.remove('was-validated');
            return;
        }

        try {
            const chartConfig = this.generateChartConfig(chartData, unit, service, selectedFloor, selectedYear);
            this.chart = new Chart(ctx, chartConfig);
        } catch (error) {
            console.error('Error al generar el gráfico:', error);
            this.showAlert('Error al generar el gráfico: ' + error.message, 'danger', 'report');
        }

        this.showAlert('Reporte generado exitosamente.', 'success', 'report');
        form.classList.remove('was-validated');
    },

    editReceipt(service, floor, year, month) {
        if (!this.data[service]?.[floor]?.[year]?.[month]) {
            this.showAlert('Recibo no encontrado.', 'danger', 'report');
            return;
        }
        const receipt = this.data[service][floor][year][month];
        const fields = {
            'edit-service': service,
            'edit-floor': floor,
            'edit-year': year,
            'edit-month': month,
            'edit-prev': receipt.prev || 0,
            'edit-curr': receipt.curr || 0,
            'edit-price': receipt.price || 0,
            'edit-fixed-cargo': receipt.fixedCargo || 0,
            'edit-fixed-aporte': receipt.fixedAporte || 0
        };
        Object.entries(fields).forEach(([id, value]) => {
            const element = document.getElementById(id);
            if (element) element.value = value;
        });

        const sewerageContainer = document.getElementById('edit-sewerage-container');
        const fixedCargoContainer = document.getElementById('edit-fixed-cargo-container');
        const fixedAlumbradoContainer = document.getElementById('edit-fixed-alumbrado-container');
        const fixedLeyContainer = document.getElementById('edit-fixed-ley-container');
        const fixedAporteContainer = document.getElementById('edit-fixed-aporte-container');

        if (service === 'agua') {
            if (sewerageContainer) sewerageContainer.style.display = 'block';
            const sewerageInput = document.getElementById('edit-sewerage');
            if (sewerageInput) {
                sewerageInput.value = receipt.sewerage || 0;
                sewerageInput.setAttribute('required', '');
            }
            if (fixedCargoContainer) fixedCargoContainer.style.display = 'block';
            const fixedCargoInput = document.getElementById('edit-fixed-cargo');
            if (fixedCargoInput) fixedCargoInput.setAttribute('required', '');
            if (fixedAlumbradoContainer) fixedAlumbradoContainer.style.display = 'none';
            if (fixedLeyContainer) fixedLeyContainer.style.display = 'none';
            if (fixedAporteContainer) fixedAporteContainer.style.display = 'block';
        } else {
            if (sewerageContainer) sewerageContainer.style.display = 'none';
            const sewerageInput = document.getElementById('edit-sewerage');
            if (sewerageInput) sewerageInput.removeAttribute('required');
            if (fixedCargoContainer) fixedCargoContainer.style.display = 'block';
            const fixedCargoInput = document.getElementById('edit-fixed-cargo');
            if (fixedCargoInput) fixedCargoInput.setAttribute('required', '');
            if (fixedAlumbradoContainer) fixedAlumbradoContainer.style.display = 'block';
            if (fixedLeyContainer) fixedLeyContainer.style.display = 'block';
            if (fixedAporteContainer) fixedAporteContainer.style.display = 'block';
            const fixedAlumbradoInput = document.getElementById('edit-fixed-alumbrado');
            if (fixedAlumbradoInput) fixedAlumbradoInput.value = receipt.fixedAlumbrado || 0;
            const fixedLeyInput = document.getElementById('edit-fixed-ley');
            if (fixedLeyInput) fixedLeyInput.value = receipt.fixedLey || 0;
        }

        const modal = new bootstrap.Modal(document.getElementById('editReceiptModal'));
        modal.show();
    },

    async saveEditedReceipt(event) {
        event.preventDefault();
        const form = document.getElementById('edit-receipt-form');
        if (!form || !form.checkValidity()) {
            form?.classList.add('was-validated');
            return;
        }

        const inputs = {
            service: document.getElementById('edit-service')?.value || '',
            floor: document.getElementById('edit-floor')?.value || '',
            year: parseInt(document.getElementById('edit-year')?.value || 0),
            month: parseInt(document.getElementById('edit-month')?.value || 0),
            prev: parseFloat(document.getElementById('edit-prev')?.value || 0),
            curr: parseFloat(document.getElementById('edit-curr')?.value || 0),
            price: parseFloat(document.getElementById('edit-price')?.value || 0),
            fixedCargo: parseFloat(document.getElementById('edit-fixed-cargo')?.value || 0),
            fixedAporte: parseFloat(document.getElementById('edit-fixed-aporte')?.value || 0)
        };

        if (!inputs.service || !inputs.floor || !inputs.year || !inputs.month) {
            this.showAlert('Por favor, complete todos los campos requeridos.', 'danger', 'report');
            return;
        }

        if (!this.validateNumberInput(inputs.prev, 'Consumo Anterior', 'report') ||
            !this.validateNumberInput(inputs.curr, 'Consumo Actual', 'report') ||
            !this.validateNumberInput(inputs.price, inputs.service === 'agua' ? 'Precio por m³ - Agua' : 'Precio por kWh', 'report') ||
            !this.validateNumberInput(inputs.fixedCargo, 'Gastos Fijos', 'report') ||
            !this.validateNumberInput(inputs.fixedAporte, 'Interés/Mora', 'report')) {
            return;
        }

        let receiptData;
        if (inputs.service === 'agua') {
            const sewerage = parseFloat(document.getElementById('edit-sewerage')?.value || 0);
            if (!this.validateNumberInput(sewerage, 'Precio por m³ - Alcantarillado', 'report')) return;

            const consumption = inputs.curr - inputs.prev;
            const waterCost = consumption * inputs.price;
            const sewerageCost = consumption * sewerage;
            const subTotal = waterCost + sewerageCost;
            const impuesto = subTotal * 0.18;
            const total = subTotal + impuesto + inputs.fixedCargo + inputs.fixedAporte;

            receiptData = {
                prev: inputs.prev,
                curr: inputs.curr,
                consumption,
                price: inputs.price,
                sewerage,
                waterCost,
                sewerageCost,
                subTotal,
                impuesto,
                total,
                fixedCargo: inputs.fixedCargo,
                fixedAporte: inputs.fixedAporte
            };
        } else {
            const fixedAlumbrado = parseFloat(document.getElementById('edit-fixed-alumbrado')?.value || 0);
            const fixedLey = parseFloat(document.getElementById('edit-fixed-ley')?.value || 0);
            if (!this.validateNumberInput(fixedAlumbrado, 'Alumbrado Público', 'report') ||
                !this.validateNumberInput(fixedLey, 'Aporte a Ley', 'report')) {
                return;
            }

            const consumption = inputs.curr - inputs.prev;
            const subTotal = consumption * inputs.price;
            const impuesto = subTotal * 0.18;
            const gastosFijos = inputs.fixedCargo + fixedAlumbrado + fixedLey + inputs.fixedAporte;
            const total = subTotal + impuesto + gastosFijos;

            receiptData = {
                prev: inputs.prev,
                curr: inputs.curr,
                consumption,
                price: inputs.price,
                subTotal,
                impuesto,
                gastosFijos,
                total,
                fixedCargo: inputs.fixedCargo,
                fixedAlumbrado,
                fixedLey,
                fixedAporte: inputs.fixedAporte
            };
        }

        try {
            this.showSpinner(true);
            const { error } = await sb
                .from('receipts')
                .upsert({
                    service: inputs.service,
                    floor: inputs.floor,
                    year: inputs.year,
                    month: inputs.month,
                    data: receiptData
                }, { onConflict: 'service, floor, year, month' });

            if (error) throw error;

            if (!this.data[inputs.service][inputs.floor]) this.data[inputs.service][inputs.floor] = {};
            if (!this.data[inputs.service][inputs.floor][inputs.year]) this.data[inputs.service][inputs.floor][inputs.year] = {};
            this.data[inputs.service][inputs.floor][inputs.year][inputs.month] = receiptData;

            bootstrap.Modal.getInstance(document.getElementById('editReceiptModal')).hide();
            this.showAlert('Recibo editado exitosamente.', 'success', 'report');
            form.classList.remove('was-validated');
            const reportForm = document.getElementById('report-form');
            if (reportForm) reportForm.dispatchEvent(new Event('submit'));
            this.updateDashboard();
        } catch (e) {
            console.error('Error al editar recibo:', e);
            this.showAlert('Error al actualizar en la base de datos.', 'danger', 'report');
        } finally {
            this.showSpinner(false);
        }
    },

    async deleteReceipt(service, floor, year, month) {
        if (!confirm(`¿Eliminar recibo de ${this.sanitizeInput(service)} para Piso ${this.sanitizeInput(floor)}, ${MONTHS[month - 1]} ${year}?`)) return;

        try {
            this.showSpinner(true);
            const { error } = await sb
                .from('receipts')
                .delete()
                .match({ service, floor, year, month });

            if (error) throw error;

            if (this.data[service]?.[floor]?.[year]?.[month]) {
                delete this.data[service][floor][year][month];
                if (Object.keys(this.data[service][floor][year]).length === 0) {
                    delete this.data[service][floor][year];
                }
                if (Object.keys(this.data[service][floor]).length === 0) {
                    delete this.data[service][floor];
                }
                this.showAlert('Recibo eliminado exitosamente.', 'success', 'report');
                const reportForm = document.getElementById('report-form');
                if (reportForm) reportForm.dispatchEvent(new Event('submit'));
                this.updateDashboard();
            }
        } catch (e) {
            console.error('Error al eliminar recibo:', e);
            this.showAlert('Error al eliminar de la base de datos.', 'danger', 'report');
        } finally {
            this.showSpinner(false);
        }
    },

    exportToPDF() {
        if (!window.jspdf) {
            console.error('jsPDF no está disponible');
            this.showAlert('Error: No se puede exportar a PDF.', 'danger', 'report');
            return;
        }
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF({
            orientation: 'portrait',
            unit: 'mm',
            format: 'a4'
        });
        const service = document.getElementById('report-service')?.value || '';
        const selectedFloor = document.getElementById('report-floor')?.value || '';
        const selectedYear = document.getElementById('report-year')?.value ? parseInt(document.getElementById('report-year').value) : '';
        const title = `Reporte de ${this.sanitizeInput(service.toUpperCase())} ${selectedFloor ? '- Piso ' + this.sanitizeInput(selectedFloor) : '- Todos los Pisos'} ${selectedYear ? '- Año ' + selectedYear : ''}`;
        const unit = service === 'luz' ? 'kWh' : 'm³';
        let totalGlobal = 0;

        const tableData = [];
        const selectedFloors = selectedFloor ? [selectedFloor] : this.floors;
        selectedFloors.forEach(floor => {
            if (!this.data[service][floor]) return;
            let years = selectedYear ? [selectedYear] : Object.keys(this.data[service][floor]).map(y => parseInt(y)).sort((a, b) => a - b);
            years.forEach(y => {
                const months = Object.keys(this.data[service][floor][y] || {}).map(m => parseInt(m)).sort((a, b) => a - b);
                months.forEach(m => {
                    const d = this.data[service][floor][y][m];
                    const monthName = MONTHS[m - 1];
                    const extraField = service === 'luz'
                        ? `${(d.gastosFijos || 0).toFixed(2)} (Cargo: ${(d.fixedCargo || 0).toFixed(2)}, Alumbrado: ${(d.fixedAlumbrado || 0).toFixed(2)}, Aporte a Ley: ${(d.fixedLey || 0).toFixed(2)}, Interés/Mora: ${(d.fixedAporte || 0).toFixed(2)})`
                        : `${(d.waterCost || 0).toFixed(2)} / ${(d.sewerageCost || 0).toFixed(2)}`;
                    tableData.push([
                        this.sanitizeInput(floor),
                        y,
                        monthName,
                        (d.consumption || 0).toFixed(2),
                        (d.subTotal || 0).toFixed(2),
                        (d.impuesto || 0).toFixed(2),
                        extraField,
                        (d.total || 0).toFixed(2)
                    ]);
                    totalGlobal += d.total || 0;
                });
            });
        });

        doc.setFontSize(16);
        doc.text(title, 14, 20);
        doc.setFontSize(10);
        doc.autoTable({
            head: [['Piso', 'Año', 'Mes', `Consumo (${unit})`, 'Sub Total (S/)', 'Impuesto (S/)', service === 'luz' ? 'Gastos Fijos (S/)' : 'Costo Agua / Alcantarillado (S/)', 'Total (S/)']],
            body: tableData,
            startY: 30,
            theme: 'grid',
            styles: {
                fontSize: 8,
                cellPadding: 1.5,
                overflow: 'linebreak'
            },
            headStyles: {
                fillColor: [59, 130, 246],
                textColor: [255, 255, 255],
                fontSize: 8
            },
            columnStyles: {
                0: { cellWidth: 15 },
                1: { cellWidth: 15 },
                2: { cellWidth: 25 },
                3: { cellWidth: 25 },
                4: { cellWidth: 20 },
                5: { cellWidth: 20 },
                6: { overflow: 'linebreak' },
                7: { cellWidth: 20 }
            },
            margin: { left: 14, right: 14 },
            didParseCell: (data) => {
                if (data.column.index === 6) {
                    data.cell.styles.valign = 'top';
                }
            }
        });
        doc.text(`Total General: S/ ${totalGlobal.toFixed(2)}`, 14, doc.lastAutoTable.finalY + 10);
        doc.save(`reporte_${this.sanitizeInput(service)}_${new Date().toISOString().split('T')[0]}.pdf`);
        this.showAlert('Reporte exportado a PDF exitosamente.', 'success', 'report');
    },

    exportToWord() {
        const service = document.getElementById('report-service')?.value || '';
        const selectedFloor = document.getElementById('report-floor')?.value || '';
        const selectedYear = document.getElementById('report-year')?.value ? parseInt(document.getElementById('report-year').value) : '';
        const unit = service === 'luz' ? 'kWh' : 'm³';
        let totalGlobal = 0;

        let htmlContent = `
            <html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'>
            <head><meta charset='utf-8'><title>Reporte</title></head>
            <body>
                <h1>Reporte de ${this.sanitizeInput(service.toUpperCase())} ${selectedFloor ? '- Piso ' + this.sanitizeInput(selectedFloor) : '- Todos los Pisos'} ${selectedYear ? '- Año ' + selectedYear : ''}</h1>
                <table border='1' style='border-collapse: collapse; width: 100%;'>
                    <tr style='background-color: #3b82f6; color: white;'>
                        <th>Piso</th><th>Año</th><th>Mes</th><th>Consumo (${unit})</th><th>Sub Total (S/)</th><th>Impuesto (S/)</th>
                        <th>${service === 'luz' ? 'Gastos Fijos (S/)' : 'Costo Agua / Alcantarillado (S/)'}</th><th>Total (S/)</th>
                    </tr>`;

        const selectedFloors = selectedFloor ? [selectedFloor] : this.floors;
        selectedFloors.forEach(floor => {
            if (!this.data[service][floor]) return;
            let years = selectedYear ? [selectedYear] : Object.keys(this.data[service][floor]).map(y => parseInt(y)).sort((a, b) => a - b);
            years.forEach(y => {
                const months = Object.keys(this.data[service][floor][y] || {}).map(m => parseInt(m)).sort((a, b) => a - b);
                months.forEach(m => {
                    const d = this.data[service][floor][y][m];
                    const monthName = MONTHS[m - 1];
                    const extraField = service === 'luz'
                        ? `${(d.gastosFijos || 0).toFixed(2)} (Cargo: ${(d.fixedCargo || 0).toFixed(2)}, Alumbrado: ${(d.fixedAlumbrado || 0).toFixed(2)}, Aporte a Ley: ${(d.fixedLey || 0).toFixed(2)}, Interés/Mora: ${(d.fixedAporte || 0).toFixed(2)})`
                        : `${(d.waterCost || 0).toFixed(2)} / ${(d.sewerageCost || 0).toFixed(2)}`;
                    htmlContent += `
                        <tr>
                            <td>${this.sanitizeInput(floor)}</td>
                            <td>${y}</td>
                            <td>${monthName}</td>
                            <td>${(d.consumption || 0).toFixed(2)}</td>
                            <td>${(d.subTotal || 0).toFixed(2)}</td>
                            <td>${(d.impuesto || 0).toFixed(2)}</td>
                            <td>${extraField}</td>
                            <td>${(d.total || 0).toFixed(2)}</td>
                        </tr>`;
                    totalGlobal += d.total || 0;
                });
            });
        });

        htmlContent += `
                </table>
                <p><strong>Total General: S/ ${totalGlobal.toFixed(2)}</strong></p>
            </body></html>`;

        const blob = new Blob(['\ufeff', htmlContent], { type: 'application/msword' });
        saveAs(blob, `reporte_${this.sanitizeInput(service)}_${new Date().toISOString().split('T')[0]}.doc`);
        this.showAlert('Reporte exportado a Word exitosamente.', 'success', 'report');
    },

    exportToExcel() {
        const service = document.getElementById('report-service')?.value || '';
        const selectedFloor = document.getElementById('report-floor')?.value || '';
        const selectedYear = document.getElementById('report-year')?.value ? parseInt(document.getElementById('report-year').value) : '';
        const unit = service === 'luz' ? 'kWh' : 'm³';
        let totalGlobal = 0;

        const title = `Reporte de ${this.sanitizeInput(service.toUpperCase())} ${selectedFloor ? '- Piso ' + this.sanitizeInput(selectedFloor) : '- Todos los Pisos'} ${selectedYear ? '- Año ' + selectedYear : ''}`;
        let csvContent = `\ufeff${title}\n\n`;

        const headers = service === 'luz'
            ? [
                'Piso', 'Año', 'Mes', `Consumo (${unit})`, 'Sub Total (S/)', 'Impuesto (S/)',
                'Cargo Fijo (S/)', 'Alumbrado Público (S/)', 'Aporte a Ley (S/)', 'Interés/Mora (S/)', 'Total Gastos Fijos (S/)', 'Total (S/)'
            ]
            : [
                'Piso', 'Año', 'Mes', `Consumo (${unit})`, 'Costo Agua (S/)', 'Costo Alcantarillado (S/)',
                'Sub Total (S/)', 'Impuesto (S/)', 'Cargo Fijo (S/)', 'Interés/Mora (S/)', 'Total (S/)'
            ];
        csvContent += headers.map(h => `"${h}"`).join(',') + '\n';

        const selectedFloors = selectedFloor ? [selectedFloor] : this.floors;
        selectedFloors.forEach(floor => {
            if (!this.data[service][floor]) return;
            let years = selectedYear ? [selectedYear] : Object.keys(this.data[service][floor]).map(y => parseInt(y)).sort((a, b) => a - b);
            years.forEach(y => {
                const months = Object.keys(this.data[service][floor][y] || {}).map(m => parseInt(m)).sort((a, b) => a - b);
                months.forEach(m => {
                    const d = this.data[service][floor][y][m];
                    const monthName = MONTHS[m - 1];
                    const row = service === 'luz'
                        ? [
                            this.sanitizeInput(floor),
                            y,
                            monthName,
                            (d.consumption || 0).toFixed(2),
                            (d.subTotal || 0).toFixed(2),
                            (d.impuesto || 0).toFixed(2),
                            (d.fixedCargo || 0).toFixed(2),
                            (d.fixedAlumbrado || 0).toFixed(2),
                            (d.fixedLey || 0).toFixed(2),
                            (d.fixedAporte || 0).toFixed(2),
                            (d.gastosFijos || 0).toFixed(2),
                            (d.total || 0).toFixed(2)
                        ]
                        : [
                            this.sanitizeInput(floor),
                            y,
                            monthName,
                            (d.consumption || 0).toFixed(2),
                            (d.waterCost || 0).toFixed(2),
                            (d.sewerageCost || 0).toFixed(2),
                            (d.subTotal || 0).toFixed(2),
                            (d.impuesto || 0).toFixed(2),
                            (d.fixedCargo || 0).toFixed(2),
                            (d.fixedAporte || 0).toFixed(2),
                            (d.total || 0).toFixed(2)
                        ];
                    csvContent += row.map(val => `"${String(val).replace(/"/g, '""')}"`).join(',') + '\n';
                    totalGlobal += d.total || 0;
                });
            });
        });

        if (service === 'luz') {
            csvContent += `,,,,,,Total General,,,${totalGlobal.toFixed(2)},,\n`;
        } else {
            csvContent += `,,,,,Total General,,${totalGlobal.toFixed(2)},,,\n`;
        }

        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        saveAs(blob, `reporte_${this.sanitizeInput(service)}_${new Date().toISOString().split('T')[0]}.csv`);
        this.showAlert('Reporte exportado a Excel exitosamente.', 'success', 'report');
    }
};

document.addEventListener('DOMContentLoaded', () => {
    if (typeof Chart === 'undefined' || typeof bootstrap === 'undefined' || typeof jspdf === 'undefined' || typeof saveAs === 'undefined') {
        console.error('Faltan dependencias: Chart.js, Bootstrap, jsPDF o FileSaver.js');
        alert('Error: Faltan dependencias necesarias. Contacte al administrador.');
        return;
    }
    RecibosSystem.init();
});