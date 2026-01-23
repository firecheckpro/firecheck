// FireCheck Pro - Application PWA de vérification sécurité incendie
// Version optimisée avec jsPDF pour la génération de PDF
// ==================== CONFIGURATION ====================
const CONFIG = {
    localStorageKeys: {
        clients: 'firecheck_clients',
        interventions: 'firecheck_interventions',
        factures: 'firecheck_factures',
        calendarEvents: 'calendarEvents'
    },
    pdfSettings: {
        pageSize: 'a4',
        margin: 20,
        fontSizes: {
            title: 20,
            subtitle: 12,
            normal: 10,
            small: 8
        },
        colors: {
            primary: [26, 54, 93],
            secondary: [100, 100, 100],
            success: [50, 168, 82],
            danger: [220, 53, 69],
            warning: [255, 193, 7]
        }
    },
    responsiveBreakpoints: {
        mobile: 768,
        tablet: 1024
    },
    familyFilters: ['all', 'extincteur', 'ria', 'baes', 'alarme'],
    
    // Configurations IndexedDB
    indexedDB: {
        name: 'FireCheckProDB',
        version: 3,
        stores: {
            clients: 'clients',
            materials: 'materials',
            interventions: 'interventions',
            factures: 'factures',
            settings: 'settings',
            syncQueue: 'syncQueue'
        }
    },
    
    // Synchronisation
    sync: {
        enabled: true,
        interval: 300000, // 5 minutes
        retryAttempts: 3,
        retryDelay: 5000
    },
    
    // Sauvegarde automatique (DÉSACTIVÉE)
    autoSave: {
        enabled: false,
        interval: 60000,
        onUnload: false
    },
    
    // Gestion hors ligne
    offline: {
        cachePages: ['clients', 'materials', 'verification', 'signature'],
        maxRetentionDays: 30,
        syncOnReconnect: true
    }
};

// ==================== ÉTAT DE L'APPLICATION ====================
const AppState = {
    currentClient: null,
    clients: [],
    currentPage: 'clients',
    currentMonth: new Date().getMonth(),
    currentYear: new Date().getFullYear(),
    currentEditingMaterialIndex: -1,
    currentInterventions: [],
    factureItems: [],
    fraisDeplacement: 0,
    factureNumero: '',
    currentEditingInterventionId: null,
    currentFamilyFilter: ['all'],
    currentAlarmePhotos: [],
    materials: [],
    currentVerificationIndex: null,
    currentVerificationPhotos: [],
    
    // Nouvelles propriétés
    db: null,
    isOnline: navigator.onLine,
    unsavedChanges: false,
    lastSaveTime: null,
    syncQueue: [],
    offlineMode: false,
    
    // Variables pour le calendrier
    calendarEvents: []
};

// ==================== PADS DE SIGNATURE ====================
let clientSignaturePad = null;
let technicianSignaturePad = null;

// ==================== INDEXEDDB ====================
class DatabaseManager {
    constructor() {
        this.db = null;
        this.initPromise = null;
    }
    
    async init() {
        if (this.initPromise) {
            return this.initPromise;
        }
        
        this.initPromise = new Promise((resolve, reject) => {
            if (!window.indexedDB) {
                console.warn('IndexedDB non supporté, utilisation de localStorage uniquement');
                this.db = { isIndexedDB: false };
                resolve(this.db);
                return;
            }
            
            const request = indexedDB.open(CONFIG.indexedDB.name, CONFIG.indexedDB.version);
            
            request.onerror = (event) => {
                console.error('Erreur IndexedDB:', event.target.error);
                this.db = { isIndexedDB: false };
                resolve(this.db);
            };
            
            request.onsuccess = (event) => {
                this.db = event.target.result;
                console.log('IndexedDB initialisé');
                
                // Migrer les données depuis localStorage
                this.migrateFromLocalStorage().then(() => {
                    resolve(this.db);
                }).catch(() => resolve(this.db));
            };
            
            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                const stores = CONFIG.indexedDB.stores;
                
                Object.values(stores).forEach(storeName => {
                    if (!db.objectStoreNames.contains(storeName)) {
                        const store = db.createObjectStore(storeName, { keyPath: 'id' });
                        
                        switch(storeName) {
                            case 'clients':
                                store.createIndex('name', 'name', { unique: false });
                                store.createIndex('createdDate', 'createdDate', { unique: false });
                                break;
                            case 'materials':
                                store.createIndex('clientId', 'clientId', { unique: false });
                                store.createIndex('type', 'type', { unique: false });
                                store.createIndex('verified', 'verified', { unique: false });
                                break;
                            case 'interventions':
                                store.createIndex('clientId', 'clientId', { unique: false });
                                store.createIndex('date', 'start', { unique: false });
                                break;
                            case 'syncQueue':
                                store.createIndex('status', 'status', { unique: false });
                                store.createIndex('timestamp', 'timestamp', { unique: false });
                                break;
                        }
                    }
                });
            };
        });
        
        return this.initPromise;
    }
    
    async migrateFromLocalStorage() {
        try {
            const localStorageKeys = [
                'firecheck_clients',
                'firecheck_interventions',
                'firecheck_factures',
                'calendarEvents'
            ];
            
            for (const key of localStorageKeys) {
                const data = localStorage.getItem(key);
                if (data) {
                    try {
                        const parsedData = JSON.parse(data);
                        const storeName = this.getStoreNameFromKey(key);
                        
                        if (storeName && parsedData) {
                            const items = Array.isArray(parsedData) ? parsedData : [parsedData];
                            if (items.length > 0) {
                                await this.saveAll(storeName, items);
                            }
                        }
                    } catch (e) {
                        console.warn(`Erreur parsing ${key}:`, e);
                    }
                }
            }
        } catch (error) {
            console.warn('Erreur migration:', error);
        }
    }
    
    getStoreNameFromKey(key) {
        const mapping = {
            'firecheck_clients': 'clients',
            'firecheck_interventions': 'interventions',
            'firecheck_factures': 'factures',
            'calendarEvents': 'interventions'
        };
        return mapping[key];
    }
    
    async save(storeName, data) {
        try {
            if (!data || !data.id) {
                console.error('Données invalides pour sauvegarde:', data);
                return;
            }
            
            if (this.db && this.db.isIndexedDB !== false) {
                return new Promise((resolve, reject) => {
                    try {
                        const transaction = this.db.transaction([storeName], 'readwrite');
                        const store = transaction.objectStore(storeName);
                        const request = store.put(data);
                        
                        request.onsuccess = () => {
                            this.saveToLocalStorage(storeName, data);
                            resolve();
                        };
                        
                        request.onerror = (event) => {
                            console.warn(`Erreur IndexedDB ${storeName}:`, event.target.error);
                            this.saveToLocalStorage(storeName, data);
                            resolve();
                        };
                    } catch (e) {
                        this.saveToLocalStorage(storeName, data);
                        resolve();
                    }
                });
            } else {
                this.saveToLocalStorage(storeName, data);
                return Promise.resolve();
            }
        } catch (error) {
            console.error(`Erreur sauvegarde ${storeName}:`, error);
            this.saveToLocalStorage(storeName, data);
            return Promise.resolve();
        }
    }
    
    async saveAll(storeName, items) {
        try {
            if (!Array.isArray(items)) {
                console.error('Items doit être un tableau:', items);
                return;
            }
            
            const validItems = items.filter(item => item && item.id);
            
            if (validItems.length === 0) return;
            
            if (this.db && this.db.isIndexedDB !== false) {
                return new Promise((resolve) => {
                    try {
                        const transaction = this.db.transaction([storeName], 'readwrite');
                        const store = transaction.objectStore(storeName);
                        
                        validItems.forEach(item => {
                            store.put(item);
                        });
                        
                        transaction.oncomplete = () => {
                            this.saveAllToLocalStorage(storeName, validItems);
                            resolve();
                        };
                        
                        transaction.onerror = () => {
                            this.saveAllToLocalStorage(storeName, validItems);
                            resolve();
                        };
                    } catch (e) {
                        this.saveAllToLocalStorage(storeName, validItems);
                        resolve();
                    }
                });
            } else {
                this.saveAllToLocalStorage(storeName, validItems);
                return Promise.resolve();
            }
        } catch (error) {
            console.error(`Erreur saveAll ${storeName}:`, error);
            this.saveAllToLocalStorage(storeName, items.filter(i => i && i.id));
            return Promise.resolve();
        }
    }
    
    async get(storeName, id) {
        try {
            if (this.db && this.db.isIndexedDB !== false) {
                return new Promise((resolve) => {
                    try {
                        const transaction = this.db.transaction([storeName], 'readonly');
                        const store = transaction.objectStore(storeName);
                        const request = store.get(id);
                        
                        request.onsuccess = (event) => {
                            resolve(event.target.result || null);
                        };
                        
                        request.onerror = () => {
                            resolve(this.getFromLocalStorage(storeName, id));
                        };
                    } catch (e) {
                        resolve(this.getFromLocalStorage(storeName, id));
                    }
                });
            } else {
                return this.getFromLocalStorage(storeName, id);
            }
        } catch (error) {
            console.error(`Erreur get ${storeName}:`, error);
            return this.getFromLocalStorage(storeName, id);
        }
    }
    
    async getAll(storeName, indexName = null, indexValue = null) {
        try {
            if (this.db && this.db.isIndexedDB !== false) {
                return new Promise((resolve) => {
                    try {
                        const transaction = this.db.transaction([storeName], 'readonly');
                        const store = transaction.objectStore(storeName);
                        
                        let request;
                        if (indexName && indexValue !== null) {
                            const index = store.index(indexName);
                            request = index.getAll(indexValue);
                        } else {
                            request = store.getAll();
                        }
                        
                        request.onsuccess = (event) => {
                            resolve(event.target.result || []);
                        };
                        
                        request.onerror = () => {
                            resolve(this.getAllFromLocalStorage(storeName));
                        };
                    } catch (e) {
                        resolve(this.getAllFromLocalStorage(storeName));
                    }
                });
            } else {
                return this.getAllFromLocalStorage(storeName);
            }
        } catch (error) {
            console.error(`Erreur getAll ${storeName}:`, error);
            return this.getAllFromLocalStorage(storeName);
        }
    }
    
    async delete(storeName, id) {
        try {
            if (this.db && this.db.isIndexedDB !== false) {
                return new Promise((resolve) => {
                    try {
                        const transaction = this.db.transaction([storeName], 'readwrite');
                        const store = transaction.objectStore(storeName);
                        const request = store.delete(id);
                        
                        request.onsuccess = () => {
                            this.deleteFromLocalStorage(storeName, id);
                            resolve();
                        };
                        
                        request.onerror = () => {
                            this.deleteFromLocalStorage(storeName, id);
                            resolve();
                        };
                    } catch (e) {
                        this.deleteFromLocalStorage(storeName, id);
                        resolve();
                    }
                });
            } else {
                this.deleteFromLocalStorage(storeName, id);
                return Promise.resolve();
            }
        } catch (error) {
            console.error(`Erreur delete ${storeName}:`, error);
            this.deleteFromLocalStorage(storeName, id);
            return Promise.resolve();
        }
    }
    
    // ==================== GESTION DU STORAGE ====================
    
    cleanupLocalStorage() {
        try {
            console.log('🧹 Nettoyage du localStorage...');
            
            const essentialKeys = [
                'user_session',
                'current_client',
                'materials_to_verify',
                'verification_data'
            ];
            
            const keysToClean = [];
            
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                
                if (!essentialKeys.includes(key)) {
                    if (key.includes('syncQueue') || key.includes('history_old') || key.includes('temp_')) {
                        keysToClean.push(key);
                    }
                }
            }
            
            keysToClean.forEach(key => {
                localStorage.removeItem(key);
                console.log(`🗑️ Supprimé: ${key}`);
            });
            
            console.log(`✅ Nettoyage terminé. ${keysToClean.length} éléments supprimés.`);
            return true;
        } catch (error) {
            console.error('❌ Erreur lors du nettoyage:', error);
            return false;
        }
    }
    
    saveToLocalStorage(storeName, data) {
        try {
            const dataSize = new Blob([JSON.stringify(data)]).size;
            const currentUsage = this.getLocalStorageUsage();
            
            if (currentUsage + dataSize > 4.5 * 1024 * 1024) {
                console.warn('⚠️ Quota localStorage approchant - Nettoyage en cours...');
                this.cleanupLocalStorage();
            }
            
            const key = this.getLocalStorageKey(storeName);
            const existing = this.getAllFromLocalStorage(storeName);
            const index = existing.findIndex(item => item.id === data.id);
            
            if (index !== -1) {
                existing[index] = data;
            } else {
                existing.push(data);
            }
            
            localStorage.setItem(key, JSON.stringify(existing));
            return true;
        } catch (error) {
            console.error(`❌ Erreur saveToLocalStorage ${storeName}:`, error);
            
            if (error.name === 'QuotaExceededError') {
                console.log('🔄 Tentative de récupération après erreur de quota...');
                this.cleanupLocalStorage();
                
                try {
                    const key = this.getLocalStorageKey(storeName);
                    const existing = this.getAllFromLocalStorage(storeName);
                    const index = existing.findIndex(item => item.id === data.id);
                    
                    if (index !== -1) {
                        existing[index] = data;
                    } else {
                        existing.push(data);
                    }
                    
                    localStorage.setItem(key, JSON.stringify(existing));
                    console.log(`✅ Données sauvegardées après nettoyage: ${storeName}`);
                    return true;
                } catch (retryError) {
                    console.error(`❌ Échec après nettoyage:`, retryError);
                    this.saveEssentialDataOnly(storeName, data);
                    return false;
                }
            }
            return false;
        }
    }
    
    saveEssentialDataOnly(storeName, data) {
        try {
            const key = this.getLocalStorageKey(storeName);
            
            if (storeName === 'syncQueue' && Array.isArray(data) && data.length > 50) {
                const essentialData = data.slice(-50);
                localStorage.setItem(key, JSON.stringify(essentialData));
                console.log(`⚠️ Sauvegarde réduite: ${storeName} (${essentialData.length} éléments au lieu de ${data.length})`);
                return true;
            }
            
            const compressedData = this.compressData(data);
            localStorage.setItem(key, JSON.stringify(compressedData));
            console.log(`⚠️ Données compressées: ${storeName}`);
            return true;
        } catch (error) {
            console.error(`❌ Impossible de sauvegarder même les données essentielles:`, error);
            return false;
        }
    }
    
    compressData(data) {
        if (Array.isArray(data)) {
            return data.map(item => {
                if (typeof item === 'object') {
                    const { id, type, status, timestamp, ...rest } = item;
                    return { id, type, status, timestamp };
                }
                return item;
            });
        }
        return data;
    }
    
    getLocalStorageUsage() {
        let total = 0;
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            const value = localStorage.getItem(key);
            total += key.length + value.length;
        }
        return total * 2;
    }
    
    saveAllToLocalStorage(storeName, items) {
        try {
            const key = this.getLocalStorageKey(storeName);
            
            const dataSize = new Blob([JSON.stringify(items)]).size;
            const currentUsage = this.getLocalStorageUsage();
            
            if (currentUsage + dataSize > 4.5 * 1024 * 1024) {
                this.cleanupLocalStorage();
            }
            
            localStorage.setItem(key, JSON.stringify(items));
            return true;
        } catch (error) {
            console.error(`Erreur saveAllToLocalStorage ${storeName}:`, error);
            
            if (error.name === 'QuotaExceededError') {
                this.cleanupLocalStorage();
                try {
                    const key = this.getLocalStorageKey(storeName);
                    localStorage.setItem(key, JSON.stringify(items));
                    return true;
                } catch (retryError) {
                    console.error('Échec après nettoyage:', retryError);
                    return false;
                }
            }
            return false;
        }
    }
    
    getFromLocalStorage(storeName, id) {
        try {
            const items = this.getAllFromLocalStorage(storeName);
            return items.find(item => item && item.id === id) || null;
        } catch (error) {
            console.error(`Erreur getFromLocalStorage ${storeName}:`, error);
            return null;
        }
    }
    
    getAllFromLocalStorage(storeName) {
        try {
            const key = this.getLocalStorageKey(storeName);
            const data = localStorage.getItem(key);
            return data ? JSON.parse(data) : [];
        } catch (error) {
            console.error(`Erreur getAllFromLocalStorage ${storeName}:`, error);
            return [];
        }
    }
    
    deleteFromLocalStorage(storeName, id) {
        try {
            const items = this.getAllFromLocalStorage(storeName);
            const filtered = items.filter(item => item && item.id !== id);
            const key = this.getLocalStorageKey(storeName);
            localStorage.setItem(key, JSON.stringify(filtered));
        } catch (error) {
            console.error(`Erreur deleteFromLocalStorage ${storeName}:`, error);
        }
    }
    
    getLocalStorageKey(storeName) {
        return `firecheck_${storeName}`;
    }
    
    async clearStore(storeName) {
        try {
            const key = this.getLocalStorageKey(storeName);
            localStorage.removeItem(key);
            
            if (this.db && this.db.isIndexedDB !== false) {
                return new Promise((resolve) => {
                    try {
                        const transaction = this.db.transaction([storeName], 'readwrite');
                        const store = transaction.objectStore(storeName);
                        store.clear();
                        transaction.oncomplete = () => resolve();
                        transaction.onerror = () => resolve();
                    } catch (e) {
                        resolve();
                    }
                });
            }
        } catch (error) {
            console.error(`Erreur clearStore ${storeName}:`, error);
        }
    }
    
    async getStats() {
        const stores = Object.values(CONFIG.indexedDB.stores);
        const stats = {};
        
        for (const storeName of stores) {
            const items = await this.getAll(storeName);
            stats[storeName] = items.length;
        }
        
        return stats;
    }
}

const dbManager = new DatabaseManager();

// ==================== INITIALISATION ====================
document.addEventListener('DOMContentLoaded', function() {
    initApp();
});

async function initApp() {
    try {
        showLoading('Initialisation...');
        
        await dbManager.init();
        
        await loadData();
        initComponents();
        initPWA();
        addLogoutButtonCSS();
        addLogoutButton();
        addDataManagementCSS();
        
        navigateTo(AppState.currentPage || 'clients');
        
        setTimeout(addDataManagementUI, 1000);
        
        closeLoading();
        showDataStats();
        
        console.log('FireCheck Pro initialisé avec succès');
        
    } catch (error) {
        console.error('Erreur initialisation:', error);
        showError('Erreur lors de l\'initialisation');
        closeLoading();
    }
}

function initComponents() {
    initNavigation();
    initSignaturePads();
    initResponsiveHandlers();
    setTodayDate();
    generateCalendar(AppState.currentMonth, AppState.currentYear);
    loadCalendarEvents();
    generateFactureNumber();
}

function initPWA() {
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('service-worker.js')
            .then(registration => {
                console.log('Service Worker enregistré:', registration.scope);
            })
            .catch(error => {
                console.error('Échec Service Worker:', error);
            });
    }
}

// ==================== BOUTON DE DÉCONNEXION ====================
function addLogoutButton() {
    const headerControls = document.querySelector('.header-controls');
    if (!headerControls) return;
    
    const oldMenuBtn = headerControls.querySelector('.menu-toggle');
    if (oldMenuBtn) oldMenuBtn.remove();
    
    const menuButtons = headerControls.querySelectorAll('[data-menu-toggle]');
    menuButtons.forEach(btn => btn.remove());
    
    const logoutBtn = document.createElement('button');
    logoutBtn.className = 'btn btn-sm btn-danger logout-btn';
    logoutBtn.innerHTML = '<i class="fas fa-sign-out-alt"></i> <span class="logout-text">Déconnexion</span>';
    logoutBtn.title = 'Se déconnecter';
    logoutBtn.onclick = logoutUser;
    
    const dataBtn = headerControls.querySelector('[onclick*="showDataManagementModal"]');
    if (dataBtn) {
        headerControls.insertBefore(logoutBtn, dataBtn);
    } else {
        headerControls.appendChild(logoutBtn);
    }
}

function logoutUser() {
    if (confirm('Voulez-vous vraiment vous déconnecter ?')) {
        saveCurrentClientChanges();
        saveInterventions();
        
        AppState.currentClient = null;
        AppState.clients = [];
        AppState.currentInterventions = [];
        AppState.calendarEvents = [];
        
        showSuccess('Déconnexion réussie');
        setTimeout(() => {
            window.location.reload();
        }, 1500);
    }
}

function addLogoutButtonCSS() {
    const style = document.createElement('style');
    style.textContent = `
        .logout-btn {
            background: linear-gradient(135deg, #dc3545 0%, #c82333 100%);
            border: none;
            color: white;
            padding: 8px 16px;
            border-radius: 6px;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.3s ease;
            display: flex;
            align-items: center;
            gap: 8px;
            margin-right: 10px;
            box-shadow: 0 2px 4px rgba(220, 53, 69, 0.3);
        }
        
        .logout-btn:hover {
            background: linear-gradient(135deg, #c82333 0%, #bd2130 100%);
            transform: translateY(-1px);
            box-shadow: 0 4px 8px rgba(220, 53, 69, 0.4);
        }
        
        @media (max-width: 768px) {
            .logout-btn {
                padding: 6px 12px;
                font-size: 0.9em;
            }
        }
        
        @media (max-width: 600px) {
            .logout-text {
                display: none;
            }
        }
    `;
    document.head.appendChild(style);
}

// ==================== FONCTIONS DE STOCKAGE ====================
function loadFromStorage(key) {
    try {
        const item = localStorage.getItem(key);
        return item ? JSON.parse(item) : null;
    } catch (error) {
        console.error('Erreur loadFromStorage:', error);
        return null;
    }
}

function saveToStorage(key, data) {
    try {
        localStorage.setItem(key, JSON.stringify(data));
        return true;
    } catch (error) {
        console.error('Erreur saveToStorage:', error);
        return false;
    }
}

function saveCalendarEvents() {
    try {
        saveToStorage('calendarEvents', AppState.calendarEvents);
        console.log(`${AppState.calendarEvents.length} événement(s) sauvegardé(s)`);
        return true;
    } catch (error) {
        console.error('Erreur sauvegarde événements:', error);
        return false;
    }
}

function loadCalendarEvents() {
    try {
        const storedEvents = loadFromStorage('calendarEvents');
        
        if (storedEvents && Array.isArray(storedEvents)) {
            AppState.calendarEvents = storedEvents;
            console.log(`${AppState.calendarEvents.length} événement(s) chargé(s)`);
        } else {
            AppState.calendarEvents = [];
        }
        
        mergeCalendarEventsWithInterventions();
        
    } catch (error) {
        console.error('Erreur chargement événements:', error);
        AppState.calendarEvents = [];
    }
}

function mergeCalendarEventsWithInterventions() {
    AppState.calendarEvents.forEach(event => {
        const existingIntervention = AppState.currentInterventions.find(i => i.id === event.id);
        if (!existingIntervention) {
            AppState.currentInterventions.push(event);
        }
    });
    
    saveCalendarEvents();
    saveInterventions();
}

// ==================== CHARGEMENT DONNÉES ====================
async function loadData() {
    try {
        await dbManager.init();
        
        AppState.clients = await dbManager.getAll('clients');
        AppState.currentInterventions = await dbManager.getAll('interventions');
        
        loadCalendarEvents();
        
        const stats = await dbManager.getStats();
        console.log('Données chargées:', stats);
        
    } catch (error) {
        console.error('Erreur chargement données:', error);
        
        const savedClients = localStorage.getItem('firecheck_clients');
        const savedInterventions = localStorage.getItem('firecheck_interventions');
        
        if (savedClients) {
            AppState.clients = JSON.parse(savedClients);
        }
        
        if (savedInterventions) {
            AppState.currentInterventions = JSON.parse(savedInterventions);
        }
        
        loadCalendarEvents();
    }
}

// ==================== GESTION RESPONSIVE ====================
function initResponsiveHandlers() {
    adaptInterfaceToScreenSize();
    
    window.addEventListener('resize', debounce(() => {
        resizeSignatureCanvases();
        adaptInterfaceToScreenSize();
    }, 250));
    
    preventIOSZoom();
}

function adaptInterfaceToScreenSize() {
    const width = window.innerWidth;
    const html = document.documentElement;
    
    if (width < CONFIG.responsiveBreakpoints.mobile) {
        html.className = 'mobile small-screen';
        html.style.fontSize = '14px';
    } else if (width < CONFIG.responsiveBreakpoints.tablet) {
        html.className = 'tablet medium-screen';
        html.style.fontSize = '15px';
    } else {
        html.className = 'desktop large-screen';
        html.style.fontSize = '16px';
    }
    
    adjustMobileNavigation(width);
    adjustModals(width);
    adjustLogoutButton(width);
}

function adjustMobileNavigation(width) {
    const navTabs = document.querySelector('.nav-tabs');
    if (!navTabs) return;
    
    if (width < CONFIG.responsiveBreakpoints.mobile) {
        navTabs.classList.add('mobile-nav');
    } else {
        navTabs.classList.remove('mobile-nav', 'mobile-visible');
    }
}

function adjustModals(width) {
    const modals = document.querySelectorAll('.modal-content');
    modals.forEach(modal => {
        if (width < CONFIG.responsiveBreakpoints.mobile) {
            modal.classList.add('mobile-modal');
        } else if (width < CONFIG.responsiveBreakpoints.tablet) {
            modal.classList.add('tablet-modal');
            modal.classList.remove('mobile-modal');
        } else {
            modal.classList.remove('mobile-modal', 'tablet-modal');
        }
    });
}

function adjustLogoutButton(width) {
    const logoutBtn = document.querySelector('.logout-btn');
    if (!logoutBtn) return;
    
    const logoutText = logoutBtn.querySelector('.logout-text');
    
    if (width < 600) {
        if (logoutText) logoutText.style.display = 'none';
        logoutBtn.style.padding = '6px';
    } else if (width < 768) {
        if (logoutText) {
            logoutText.style.display = 'inline';
            logoutText.style.fontSize = '0.9em';
        }
        logoutBtn.style.padding = '6px 12px';
    } else {
        if (logoutText) {
            logoutText.style.display = 'inline';
            logoutText.style.fontSize = '1em';
        }
        logoutBtn.style.padding = '8px 16px';
    }
}

function preventIOSZoom() {
    document.addEventListener('touchstart', function(e) {
        const target = e.target;
        if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') {
            target.style.fontSize = '16px';
        }
    }, { passive: true });
}

function resizeSignatureCanvases() {
    const canvases = [
        { pad: clientSignaturePad, id: 'client-signature-canvas' },
        { pad: technicianSignaturePad, id: 'technician-signature-canvas' }
    ];
    
    canvases.forEach(({ pad, id }) => {
        if (!pad) return;
        
        const canvas = document.getElementById(id);
        if (!canvas) return;
        
        const data = pad.toData();
        const container = canvas.parentElement;
        
        if (container) {
            canvas.width = container.clientWidth;
            canvas.height = container.clientHeight;
            pad.clear();
            
            if (data && data.length > 0) {
                pad.fromData(data);
            }
        }
    });
}

// ==================== NAVIGATION ====================
function initNavigation() {
    document.querySelectorAll('.nav-tab').forEach(tab => {
        tab.addEventListener('click', function(e) {
            e.preventDefault();
            const page = this.getAttribute('data-page');
            navigateTo(page);
        });
    });
    
    const menuToggle = document.getElementById('menu-toggle');
    if (menuToggle) {
        menuToggle.addEventListener('click', function() {
            const navTabs = document.querySelector('.nav-tabs');
            if (navTabs) {
                navTabs.classList.toggle('mobile-visible');
            }
        });
    }
    
    initSwipeNavigation();
}

function navigateTo(page) {
    saveCurrentClientChanges();
    AppState.currentPage = page;
    updateActiveTab(page);
    showPage(page);
    executePageActions(page);
    closeMobileMenu();
    scrollToTopOnMobile();
}

function updateActiveTab(page) {
    document.querySelectorAll('.nav-tab').forEach(tab => {
        const tabPage = tab.getAttribute('data-page');
        tab.classList.toggle('active', tabPage === page);
    });
}

function showPage(page) {
    document.querySelectorAll('.page').forEach(pageEl => {
        pageEl.classList.remove('active');
    });
    
    const targetPage = document.getElementById(`page-${page}`);
    if (targetPage) {
        targetPage.classList.add('active');
    }
}

function executePageActions(page) {
    switch(page) {
        case 'clients':
            displayClientsList();
            break;
        case 'materials':
            updateClientInfoBadge();
            displayMaterialsList();
            break;
        case 'verification':
            updateClientInfoBadge();
            resetVerificationsForNewYear();
            displayVerificationList();
            break;
        case 'signature':
            setSignatureDate();
            updateFactureTotal();
            break;
        case 'history':
            loadHistory();
            break;
        case 'planning':
            generateCalendar(AppState.currentMonth, AppState.currentYear);
            break;
    }
}

function closeMobileMenu() {
    const navTabs = document.querySelector('.nav-tabs');
    if (navTabs && navTabs.classList.contains('mobile-visible')) {
        navTabs.classList.remove('mobile-visible');
    }
}

function scrollToTopOnMobile() {
    if (window.innerWidth < CONFIG.responsiveBreakpoints.mobile) {
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }
}

// ==================== NAVIGATION PAR SWIPE ====================
function initSwipeNavigation() {
    let touchStartX = 0;
    let touchEndX = 0;
    const swipeThreshold = 50;
    
    document.addEventListener('touchstart', e => {
        if (isInputElement(e.target)) return;
        touchStartX = e.changedTouches[0].screenX;
    }, { passive: true });
    
    document.addEventListener('touchend', e => {
        if (isInputElement(e.target)) return;
        touchEndX = e.changedTouches[0].screenX;
        handleSwipeGesture(touchStartX, touchEndX, swipeThreshold);
    }, { passive: true });
}

function isInputElement(element) {
    return element.tagName === 'INPUT' || 
           element.tagName === 'TEXTAREA' || 
           element.tagName === 'SELECT' || 
           element.isContentEditable;
}

function handleSwipeGesture(startX, endX, threshold) {
    const diff = startX - endX;
    
    if (Math.abs(diff) > threshold) {
        if (diff > 0) {
            navigateToNextPage();
        } else {
            navigateToPreviousPage();
        }
    }
}

function navigateToNextPage() {
    const pages = ['clients', 'materials', 'verification', 'signature', 'history', 'planning'];
    const currentIndex = pages.indexOf(AppState.currentPage);
    
    if (currentIndex < pages.length - 1) {
        navigateTo(pages[currentIndex + 1]);
    }
}

function navigateToPreviousPage() {
    const pages = ['clients', 'materials', 'verification', 'signature', 'history', 'planning'];
    const currentIndex = pages.indexOf(AppState.currentPage);
    
    if (currentIndex > 0) {
        navigateTo(pages[currentIndex - 1]);
    }
}

// ==================== GESTION DES CLIENTS ====================
function createClient() {
    const formData = getClientFormData();
    
    if (!validateClientForm(formData)) {
        return;
    }
    
    const newClient = createClientObject(formData);
    AppState.clients.push(newClient);
    
    saveClients();
    selectClient(newClient);
    resetClientForm();
    
    showSuccess('Client créé avec succès !');
    displayClientsList();
}

function getClientFormData() {
    return {
        name: getElementValue('client-name'),
        contact: getElementValue('client-contact'),
        address: getElementValue('client-address'),
        technician: getElementValue('technician-name'),
        email: getElementValue('client-email'),
        phone: getElementValue('client-phone'),
        notes: getElementValue('client-notes')
    };
}

function validateClientForm(data) {
    const requiredFields = ['name', 'contact', 'address', 'technician'];
    
    for (const field of requiredFields) {
        if (!data[field] || data[field].trim() === '') {
            showError(`Le champ ${fieldName(field)} est obligatoire`);
            focusElement(`client-${field}`);
            return false;
        }
    }
    
    return true;
}

function fieldName(field) {
    const names = {
        name: 'Nom du client',
        contact: 'Contact',
        address: 'Adresse',
        technician: 'Technicien'
    };
    return names[field] || field;
}

function createClientObject(formData) {
    return {
        id: generateId(),
        name: formData.name.trim(),
        contact: formData.contact.trim(),
        address: formData.address.trim(),
        technician: formData.technician.trim(),
        email: formData.email.trim(),
        phone: formData.phone.trim(),
        notes: formData.notes.trim(),
        createdDate: new Date().toISOString(),
        materials: [],
        interventions: []
    };
}

function resetClientForm() {
    const fields = ['client-name', 'client-contact', 'client-address', 'client-email', 'client-phone', 'client-notes'];
    fields.forEach(field => {
        const element = document.getElementById(field);
        if (element) element.value = '';
    });
}

function displayClientsList() {
    const clientsList = document.getElementById('clients-list');
    if (!clientsList) return;
    
    const searchTerm = getElementValue('client-search')?.toLowerCase() || '';
    const filteredClients = filterClients(searchTerm);
    
    if (filteredClients.length === 0) {
        showEmptyState(clientsList, 'clients');
        return;
    }
    
    clientsList.innerHTML = filteredClients.map(client => createClientListItem(client)).join('');
}

function filterClients(searchTerm) {
    if (!searchTerm) return AppState.clients;
    
    return AppState.clients.filter(client => 
        client.name.toLowerCase().includes(searchTerm) ||
        client.contact.toLowerCase().includes(searchTerm) ||
        client.address.toLowerCase().includes(searchTerm)
    );
}

function createClientListItem(client) {
    const materialsCount = client.materials?.length || 0;
    const isSelected = AppState.currentClient && AppState.currentClient.id === client.id;
    
    return `
        <div class="compact-material-item client-item ${isSelected ? 'selected' : ''}" 
             onclick="selectClient(${JSON.stringify(client).replace(/"/g, '&quot;')})">
            <div class="compact-material-info">
                <div class="compact-material-name">
                    <i class="fas fa-user"></i>
                    ${escapeHtml(client.name)}
                    ${isSelected ? '<span class="status-badge status-ok">Sélectionné</span>' : ''}
                </div>
                <div class="compact-material-details">
                    ${escapeHtml(client.contact)} • ${escapeHtml(client.address)}
                    <br>
                    <small>${materialsCount} matériel(s) • Créé le ${formatDate(client.createdDate)}</small>
                </div>
            </div>
            <div class="compact-material-actions">
                <button class="btn btn-sm btn-danger" onclick="deleteClient('${client.id}', event)" 
                        title="Supprimer">
                    <i class="fas fa-trash"></i>
                </button>
            </div>
        </div>
    `;
}

function showEmptyState(container, type) {
    const messages = {
        clients: {
            icon: 'fa-users',
            title: 'Aucun client trouvé',
            subtitle: 'Créez votre premier client ci-dessus'
        },
        materials: {
            icon: 'fa-clipboard-list',
            title: 'Aucun matériel dans la liste',
            subtitle: 'Ajoutez des matériels ci-dessus'
        },
        verification: {
            icon: 'fa-clipboard-check',
            title: 'Aucun matériel à vérifier',
            subtitle: 'Retournez à la page précédente pour ajouter des matériels'
        },
        history: {
            icon: 'fa-history',
            title: 'Aucun historique de vérification',
            subtitle: 'Les rapports générés apparaîtront ici'
        }
    };
    
    const message = messages[type] || messages.clients;
    
    container.innerHTML = `
        <div class="empty-state">
            <i class="fas ${message.icon}"></i>
            <p>${message.title}</p>
            <p class="empty-state-sub">${message.subtitle}</p>
        </div>
    `;
}

function searchClients() {
    displayClientsList();
}

function selectClient(client) {
    if (AppState.currentClient) {
        saveCurrentClientChanges();
    }
    
    AppState.currentClient = JSON.parse(JSON.stringify(client));
    
    displayClientsList();
    updateClientInfoBadge();
    
    if (AppState.currentPage === 'materials') {
        displayMaterialsList();
    }
    
    if (AppState.currentPage === 'verification') {
        displayVerificationList();
    }
    
    updateInterventionClientList();
    
    showSuccess(`Client ${client.name} sélectionné`);
}

async function saveClients() {
    if (AppState.clients.length > 0) {
        await dbManager.saveAll('clients', AppState.clients);
    }
}

function saveCurrentClientChanges() {
    if (!AppState.currentClient) return;
    
    const clientIndex = AppState.clients.findIndex(c => c.id === AppState.currentClient.id);
    if (clientIndex !== -1) {
        AppState.clients[clientIndex] = JSON.parse(JSON.stringify(AppState.currentClient));
        saveClients();
    }
}

function deleteClient(clientId, event) {
    if (event) event.stopPropagation();
    
    if (!confirm('Êtes-vous sûr de vouloir supprimer ce client ?')) {
        return;
    }
    
    const index = AppState.clients.findIndex(c => c.id === clientId);
    if (index !== -1) {
        AppState.clients.splice(index, 1);
        saveClients();
        
        if (AppState.currentClient && AppState.currentClient.id === clientId) {
            AppState.currentClient = null;
            updateClientInfoBadge();
            
            if (AppState.currentPage === 'materials' || AppState.currentPage === 'verification') {
                displayMaterialsList();
                displayVerificationList();
            }
        }
        
        displayClientsList();
        showSuccess('Client supprimé avec succès');
    }
}

function updateClientInfoBadge() {
    updateBadge('client-info-badge', AppState.currentClient, 'Sélectionnez un client');
    updateBadge('verification-client-badge', AppState.currentClient, 'Sélectionnez un client', true);
}

function updateBadge(badgeId, client, defaultText, showCount = false) {
    const badge = document.getElementById(badgeId);
    if (!badge) return;
    
    if (client) {
        const materialsCount = client.materials?.length || 0;
        badge.innerHTML = showCount 
            ? `<i class="fas fa-user"></i> ${escapeHtml(client.name)} <span class="badge-count">${materialsCount} matériel(s)</span>`
            : `<i class="fas fa-user"></i> ${escapeHtml(client.name)}`;
        badge.className = 'status-badge status-ok';
    } else {
        badge.innerHTML = `<i class="fas fa-user"></i> ${defaultText}`;
        badge.className = 'status-badge status-warning';
    }
}

// ==================== GESTION DES MATÉRIELS ====================
function openMaterialModal(type) {
    if (!AppState.currentClient) {
        showError('Veuillez d\'abord sélectionner un client');
        return;
    }
    
    AppState.currentEditingMaterialIndex = -1;
    
    switch(type) {
        case 'extincteur':
            resetExtincteurForm();
            showModal('add-extincteur-modal');
            break;
        case 'ria':
            resetRIAForm();
            showModal('add-ria-modal');
            break;
        case 'baes':
            resetBAESForm();
            showModal('add-baes-modal');
            break;
        case 'alarme':
            resetAlarmeForm();
            showModal('add-alarme-modal');
            break;
    }
}

function resetExtincteurForm() {
    const today = new Date().toISOString().split('T')[0];
    const nextYear = new Date(new Date().setFullYear(new Date().getFullYear() + 1)).toISOString().split('T')[0];
    
    setElementValue('extincteur-id', '');
    setElementValue('extincteur-location', '');
    setElementValue('extincteur-type', '');
    setElementValue('extincteur-fabricant', '');
    setElementValue('extincteur-modele', '');
    setElementValue('extincteur-annee', new Date().getFullYear());
    setElementValue('extincteur-capacite', '');
    setElementValue('extincteur-pesee', '');
    setElementValue('extincteur-observations', '');
    setElementValue('extincteur-etat-general-comment', '');
    setElementValue('extincteur-date-controle', today);
    setElementValue('extincteur-prochain-controle', nextYear);
    
    resetOkNokFields(['etat-general', 'lisibilite', 'panneau', 'goupille', 'pression', 'joints', 'accessibilite']);
    setCheckboxValue('extincteur-maa', false);
    setCheckboxValue('extincteur-eiee', false);
    setCheckboxValue('extincteur-recharge', false);
    setCheckboxValue('extincteur-scelle', false);
    setCheckboxValue('extincteur-remplacement-joint', false);
    
    selectExtincteurInterventionType('verification');
    clearPhotoGallery('extincteur-photo-gallery');
    updateModalButton('add-extincteur-modal', 'Ajouter', addExtincteurToList);
}

function addExtincteurToList() {
    if (!validateMaterialForm('extincteur')) {
        return;
    }
    
    const extincteur = createExtincteurObject();
    addMaterialToList(extincteur);
    closeModal('add-extincteur-modal');
    showSuccess('Extincteur ajouté avec succès');
}

function createExtincteurObject() {
    return {
        type: 'extincteur',
        id: getElementValue('extincteur-id'),
        localisation: getElementValue('extincteur-location'),
        typeExtincteur: getElementValue('extincteur-type'),
        fabricant: getElementValue('extincteur-fabricant'),
        modele: getElementValue('extincteur-modele'),
        annee: getElementValue('extincteur-annee'),
        capacite: getElementValue('extincteur-capacite'),
        dateControle: getElementValue('extincteur-date-controle'),
        prochainControle: getElementValue('extincteur-prochain-controle'),
        etatGeneral: getElementValue('extincteur-etat-general'),
        etatGeneralComment: getElementValue('extincteur-etat-general-comment'),
        lisibilite: getElementValue('extincteur-lisibilite'),
        panneau: getElementValue('extincteur-panneau'),
        goupille: getElementValue('extincteur-goupille'),
        pression: getElementValue('extincteur-pression'),
        pesee: getElementValue('extincteur-pesee'),
        joints: getElementValue('extincteur-joints'),
        accessibilite: getElementValue('extincteur-accessibilite'),
        observations: getElementValue('extincteur-observations'),
        scelle: getCheckboxValue('extincteur-scelle'),
        remplacementJoint: getCheckboxValue('extincteur-remplacement-joint'),
        interventionType: getElementValue('extincteur-intervention-type'),
        interventions: {
            maa: getCheckboxValue('extincteur-maa'),
            eiee: getCheckboxValue('extincteur-eiee'),
            recharge: getCheckboxValue('extincteur-recharge')
        },
        photos: [],
        verified: false,
        dateVerification: null
    };
}

function validateMaterialForm(type) {
    const requiredFields = {
        extincteur: ['extincteur-id', 'extincteur-location', 'extincteur-type'],
        ria: ['ria-id', 'ria-location', 'ria-type'],
        baes: ['baes-id', 'baes-location', 'baes-type'],
        alarme: ['alarme-id', 'alarme-location', 'alarme-type']
    };
    
    const fields = requiredFields[type] || [];
    for (const field of fields) {
        if (!getElementValue(field)) {
            showError('Veuillez remplir tous les champs obligatoires');
            focusElement(field);
            return false;
        }
    }
    
    return true;
}

function addMaterialToList(material) {
    if (!AppState.currentClient) return;
    
    if (!AppState.currentClient.materials) {
        AppState.currentClient.materials = [];
    }
    
    AppState.currentClient.materials.push(material);
    saveCurrentClientChanges();
    displayMaterialsList();
}

function displayMaterialsList() {
    const materialsList = document.getElementById('materials-list');
    const materialsCountBadge = document.getElementById('materials-count-badge');
    
    if (!materialsList) return;
    
    if (!AppState.currentClient || !AppState.currentClient.materials || AppState.currentClient.materials.length === 0) {
        showEmptyState(materialsList, 'materials');
        if (materialsCountBadge) {
            materialsCountBadge.textContent = '0';
        }
        return;
    }
    
    const materials = AppState.currentClient.materials;
    if (materialsCountBadge) {
        materialsCountBadge.textContent = materials.length;
    }
    
    materialsList.innerHTML = materials.map((material, index) => createMaterialListItem(material, index)).join('');
}

function createMaterialListItem(material, index) {
    const materialInfo = getMaterialInfo(material.type);
    const isVerified = material.verified;
    
    return `
        <div class="compact-material-item ${materialInfo.class}">
            <div class="compact-material-info">
                <div class="compact-material-name">
                    <i class="fas ${materialInfo.icon}"></i>
                    ${materialInfo.text} - ${material.id || material.numero}
                    ${isVerified ? '<span class="status-badge status-ok"><i class="fas fa-check-circle"></i> Vérifié</span>' : ''}
                </div>
                <div class="compact-material-details">
                    ${material.localisation || material.location || 'Non spécifié'}
                    ${material.interventionType === 'installation' 
                        ? '<span class="status-badge status-purple"><i class="fas fa-wrench"></i> Installation</span>' 
                        : '<span class="status-badge status-info"><i class="fas fa-clipboard-check"></i> Vérification</span>'}
                </div>
            </div>
            <div class="compact-material-actions">
                <button class="btn btn-sm btn-danger" onclick="removeMaterial(${index})" 
                        title="Supprimer">
                    <i class="fas fa-trash"></i>
                </button>
            </div>
        </div>
    `;
}

function getMaterialInfo(type) {
    const types = {
        extincteur: { class: 'extincteur', icon: 'fa-fire-extinguisher', text: 'Extincteur' },
        ria: { class: 'ria', icon: 'fa-faucet', text: 'RIA' },
        baes: { class: 'baes', icon: 'fa-lightbulb', text: 'BAES' },
        alarme: { class: 'alarme', icon: 'fa-bell', text: 'Alarme' }
    };
    
    return types[type] || { class: '', icon: 'fa-question', text: 'Matériel' };
}

function removeMaterial(index) {
    if (!AppState.currentClient || !AppState.currentClient.materials || !AppState.currentClient.materials[index]) {
        showError("Matériel non trouvé");
        return;
    }
    
    const material = AppState.currentClient.materials[index];
    if (!confirm(`Voulez-vous vraiment supprimer ${material.id || material.numero} ?`)) {
        return;
    }
    
    AppState.currentClient.materials.splice(index, 1);
    saveCurrentClientChanges();
    displayMaterialsList();
    
    if (AppState.currentPage === 'verification') {
        displayVerificationList();
    }
    
    showSuccess("Matériel supprimé avec succès");
}

// ==================== VÉRIFICATION DES MATÉRIELS ====================
function displayVerificationList() {
    const verificationList = document.getElementById('verification-list');
    const materialsCount = document.getElementById('materials-count');
    const completeBtn = document.getElementById('complete-btn');
    
    if (!verificationList) return;
    
    updateClientInfoBadge();
    
    if (!AppState.currentClient || !AppState.currentClient.materials || AppState.currentClient.materials.length === 0) {
        showEmptyState(verificationList, 'verification');
        updateMaterialsCount(materialsCount, completeBtn, 0, 0, 0);
        return;
    }
    
    const filteredMaterials = filterMaterialsForVerification();
    verificationList.innerHTML = createVerificationListHTML(filteredMaterials);
    
    const verifiedCount = filteredMaterials.filter(m => isVerifiedForCurrentYear(m)).length;
    const toVerifyCount = filteredMaterials.length - verifiedCount;
    
    updateMaterialsCount(materialsCount, completeBtn, verifiedCount, toVerifyCount, filteredMaterials.length);
}

function filterMaterialsForVerification() {
    const searchTerm = getElementValue('verification-search')?.toLowerCase() || '';
    const materials = AppState.currentClient.materials;
    
    return materials.filter(material => {
        if (!AppState.currentFamilyFilter.includes('all')) {
            if (AppState.currentFamilyFilter.length === 0) return false;
            if (!AppState.currentFamilyFilter.includes(material.type)) return false;
        }
        
        const searchFields = [
            material.id || material.numero || '',
            material.localisation || material.location || '',
            material.type || '',
            material.typeExtincteur || ''
        ];
        
        return searchFields.some(field => field.toLowerCase().includes(searchTerm));
    }).sort(sortMaterialsByTypeAndId);
}

function sortMaterialsByTypeAndId(a, b) {
    const typeOrder = { 'extincteur': 1, 'ria': 2, 'baes': 3, 'alarme': 4 };
    const typeComparison = (typeOrder[a.type] || 4) - (typeOrder[b.type] || 4);
    
    if (typeComparison !== 0) {
        return typeComparison;
    }
    
    const aId = a.id || a.numero || '';
    const bId = b.id || b.numero || '';
    
    const aNum = parseInt(aId.replace(/\D/g, '')) || 0;
    const bNum = parseInt(bId.replace(/\D/g, '')) || 0;
    
    return aNum - bNum;
}

function createVerificationListHTML(materials) {
    return `
        <div class="family-filters">
            ${createFamilyFilterHTML()}
        </div>
        ${materials.map((material, index) => createVerificationItemHTML(material, index)).join('')}
    `;
}

function createFamilyFilterHTML() {
    const filters = CONFIG.familyFilters;
    
    return `
        <div class="family-filter-header">
            <i class="fas fa-filter"></i> Filtrer par famille :
        </div>
        <div class="family-filter-buttons">
            ${filters.map(family => createFamilyFilterButton(family)).join('')}
        </div>
        <div class="family-filter-stats">
            ${createFamilyFilterStats()}
        </div>
    `;
}

function createFamilyFilterButton(family) {
    const isActive = AppState.currentFamilyFilter.includes(family);
    const icon = getFamilyIcon(family);
    const text = getFamilyText(family);
    
    return `
        <button class="family-filter-btn ${isActive ? 'active' : ''}" 
                onclick="toggleFamilyFilter('${family}')"
                aria-pressed="${isActive}">
            <i class="fas ${icon}"></i> ${text}
        </button>
    `;
}

function getFamilyIcon(family) {
    const icons = {
        'all': 'fa-layer-group',
        'extincteur': 'fa-fire-extinguisher',
        'ria': 'fa-faucet',
        'baes': 'fa-lightbulb',
        'alarme': 'fa-bell'
    };
    return icons[family] || 'fa-question';
}

function getFamilyText(family) {
    const texts = {
        'all': 'Tous',
        'extincteur': 'Extincteurs',
        'ria': 'RIA',
        'baes': 'BAES',
        'alarme': 'Alarmes'
    };
    return texts[family] || family;
}

function createFamilyFilterStats() {
    if (!AppState.currentClient || !AppState.currentClient.materials) return '';
    
    const materials = AppState.currentClient.materials;
    const filteredCount = filterMaterialsForVerification().length;
    
    let stats = `
        <span class="filter-stat">
            <i class="fas fa-list"></i> ${filteredCount} matériel(s) filtré(s)
        </span>
    `;
    
    CONFIG.familyFilters.slice(1).forEach(family => {
        const count = materials.filter(m => m.type === family).length;
        if (count > 0) {
            stats += `
                <span class="filter-stat">
                    <i class="fas ${getFamilyIcon(family)}"></i> ${count} ${getFamilyText(family).toLowerCase()}
                </span>
            `;
        }
    });
    
    if (AppState.currentFamilyFilter.length > 0 && !AppState.currentFamilyFilter.includes('all')) {
        const activeFilters = AppState.currentFamilyFilter.map(f => getFamilyText(f)).join(', ');
        stats += `
            <span class="filter-stat filter-active">
                <i class="fas fa-filter"></i> Filtre actif: ${activeFilters}
            </span>
        `;
    }
    
    return stats;
}

function createVerificationItemHTML(material, originalIndex) {
    const materialInfo = getMaterialInfo(material.type);
    const isVerified = isVerifiedForCurrentYear(material);
    const etatConformite = getEtatConformite(material);
    
    let statusBadge = '';
    let verificationYearInfo = '';
    
    if (isVerified) {
        statusBadge = `<span class="status-badge status-ok">
            <i class="fas fa-check-circle"></i> Vérifié ${new Date().getFullYear()}
        </span>`;
    } else if (material.dateVerification) {
        const previousYear = new Date(material.dateVerification).getFullYear();
        statusBadge = `<span class="status-badge status-warning">
            <i class="fas fa-history"></i> À re-vérifier (dernière vérif: ${previousYear})
        </span>`;
        verificationYearInfo = `<small class="verification-info">
            <i class="fas fa-info-circle"></i> Dernière vérification: ${formatDate(material.dateVerification)}
        </small>`;
    } else {
        statusBadge = `<span class="status-badge status-warning">
            <i class="fas fa-clock"></i> Jamais vérifié
        </span>`;
    }
    
    return `
        <div class="compact-material-item ${materialInfo.class}" id="verif-material-${originalIndex}">
            <div class="compact-material-info">
                <div class="compact-material-name">
                    <i class="fas ${materialInfo.icon}"></i>
                    ${materialInfo.text} - ${material.id || material.numero}
                    ${statusBadge}
                    <span class="status-badge ${etatConformite === 'Conforme' ? 'status-ok' : 'status-danger'}">
                        <i class="fas ${etatConformite === 'Conforme' ? 'fa-check' : 'fa-times'}"></i> ${etatConformite}
                    </span>
                </div>
                <div class="compact-material-details">
                    ${material.localisation || material.location || 'Non spécifié'}
                    ${material.interventionType === 'installation' 
                        ? '<span class="status-badge status-purple"><i class="fas fa-wrench"></i> Installation</span>' 
                        : '<span class="status-badge status-info"><i class="fas fa-clipboard-check"></i> Vérification</span>'}
                    ${verificationYearInfo}
                </div>
            </div>
            <div class="compact-material-actions">
                <button class="btn btn-sm" onclick="editMaterialForVerification(${originalIndex})" 
                        title="Modifier">
                    <i class="fas fa-edit"></i>
                </button>
                ${!isVerified 
                    ? `<button class="btn btn-sm btn-success" onclick="verifyMaterial(${originalIndex})" 
                           title="Valider la vérification">
                        <i class="fas fa-check"></i>
                       </button>`
                    : `<button class="btn btn-sm btn-danger" onclick="unverifyMaterial(${originalIndex})" 
                           title="Marquer à vérifier">
                        <i class="fas fa-redo"></i>
                       </button>`
                }
                <button class="btn btn-sm btn-danger" onclick="removeMaterialFromVerification(${originalIndex})" 
                        title="Supprimer">
                    <i class="fas fa-trash"></i>
                </button>
            </div>
        </div>
    `;
}

function getEtatConformite(material) {
    switch(material.type) {
        case 'extincteur':
            return isExtincteurConforme(material) ? 'Conforme' : 'Non conforme';
        case 'ria':
            return isRIAConforme(material) ? 'Conforme' : 'Non conforme';
        case 'baes':
            return isBAESConforme(material) ? 'Conforme' : 'Non conforme';
        case 'alarme':
            return isAlarmeConforme(material) ? 'Conforme' : 'Non conforme';
        default:
            return 'Non vérifié';
    }
}

function isVerifiedForCurrentYear(material) {
    if (!material.verified || !material.dateVerification) return false;
    
    const verificationYear = new Date(material.dateVerification).getFullYear();
    const currentYear = new Date().getFullYear();
    
    return verificationYear === currentYear;
}

function updateMaterialsCount(materialsCountElement, completeButton, verifiedCount, toVerifyCount, totalFiltered) {
    if (materialsCountElement) {
        const totalMaterials = AppState.currentClient ? AppState.currentClient.materials.length : 0;
        materialsCountElement.innerHTML = `<i class="fas fa-list"></i> ${totalMaterials} matériel(s)`;
    }
    
    if (completeButton) {
        if (toVerifyCount === 0 && verifiedCount > 0) {
            completeButton.disabled = false;
            completeButton.innerHTML = `<i class="fas fa-check-double"></i> Terminer la vérification (${verifiedCount} vérifié(s))`;
        } else if (toVerifyCount > 0) {
            completeButton.disabled = true;
            completeButton.innerHTML = `<i class="fas fa-check-double"></i> Vérifiez tous les matériels d'abord (${toVerifyCount} restant(s))`;
        } else {
            completeButton.disabled = true;
            completeButton.innerHTML = `<i class="fas fa-check-double"></i> Aucun matériel à vérifier`;
        }
    }
}

function toggleFamilyFilter(family) {
    if (family === 'all') {
        AppState.currentFamilyFilter = ['all'];
    } else {
        AppState.currentFamilyFilter = AppState.currentFamilyFilter.filter(f => f !== 'all');
        
        const index = AppState.currentFamilyFilter.indexOf(family);
        if (index === -1) {
            AppState.currentFamilyFilter.push(family);
        } else {
            AppState.currentFamilyFilter.splice(index, 1);
        }
        
        if (AppState.currentFamilyFilter.length === 0) {
            AppState.currentFamilyFilter = ['all'];
        }
    }
    
    displayVerificationList();
}

function verifyAllInFamily(family) {
    if (!AppState.currentClient || !AppState.currentClient.materials) {
        showError('Aucun matériel à vérifier');
        return;
    }
    
    const familyMaterials = AppState.currentFamilyFilter.includes('all') 
        ? AppState.currentClient.materials 
        : AppState.currentClient.materials.filter(m => AppState.currentFamilyFilter.includes(m.type));
    
    const currentYear = new Date().getFullYear();
    const notVerifiedMaterials = familyMaterials.filter(m => !isVerifiedForCurrentYear(m));
    
    if (notVerifiedMaterials.length === 0) {
        const filterNames = getActiveFilterNames();
        showSuccess(`Tous les ${filterNames} sont déjà vérifiés pour cette année !`);
        return;
    }
    
    const filterNames = getActiveFilterNames();
    if (!confirm(`Voulez-vous valider ${filterNames} (${notVerifiedMaterials.length}) pour l'année ${currentYear} ?`)) {
        return;
    }
    
    const technicianName = getElementValue('technician-name') || 'Technicien';
    const today = new Date().toISOString().split('T')[0];
    
    notVerifiedMaterials.forEach(material => {
        material.verified = true;
        material.dateVerification = today;
        material.verifiedBy = technicianName;
    });
    
    saveCurrentClientChanges();
    displayVerificationList();
    showSuccess(`${notVerifiedMaterials.length} matériel(s) validés pour l'année ${currentYear} !`);
}

function getActiveFilterNames() {
    if (AppState.currentFamilyFilter.includes('all')) {
        return 'tous les matériels';
    }
    
    return AppState.currentFamilyFilter.map(f => {
        const names = {
            'extincteur': 'extincteurs',
            'ria': 'RIA',
            'baes': 'BAES',
            'alarme': 'alarmes'
        };
        return names[f] || f;
    }).join(', ');
}

function verifyMaterial(index) {
    if (!AppState.currentClient || !AppState.currentClient.materials || !AppState.currentClient.materials[index]) {
        showError("Matériel non trouvé");
        return;
    }
    
    const currentYear = new Date().getFullYear();
    if (!confirm(`Voulez-vous vraiment valider la vérification de ce matériel pour l'année ${currentYear} ?`)) {
        return;
    }
    
    AppState.currentClient.materials[index].verified = true;
    AppState.currentClient.materials[index].dateVerification = new Date().toISOString().split('T')[0];
    AppState.currentClient.materials[index].verifiedBy = getElementValue('technician-name') || 'Technicien';
    
    saveCurrentClientChanges();
    displayVerificationList();
    showSuccess(`Matériel validé pour l'année ${currentYear}`);
}

function unverifyMaterial(index) {
    if (!AppState.currentClient || !AppState.currentClient.materials || !AppState.currentClient.materials[index]) {
        showError("Matériel non trouvé");
        return;
    }
    
    if (!confirm("Voulez-vous re-marquer ce matériel comme 'à vérifier' ?")) {
        return;
    }
    
    AppState.currentClient.materials[index].verified = false;
    AppState.currentClient.materials[index].dateVerification = null;
    AppState.currentClient.materials[index].verifiedBy = '';
    
    saveCurrentClientChanges();
    displayVerificationList();
    showSuccess("Matériel marqué comme 'à vérifier'");
}

function removeMaterialFromVerification(index) {
    if (!AppState.currentClient || !AppState.currentClient.materials || !AppState.currentClient.materials[index]) {
        showError("Matériel non trouvé");
        return;
    }
    
    const material = AppState.currentClient.materials[index];
    if (!confirm(`Voulez-vous vraiment supprimer ${material.id || material.numero} de la liste ?`)) {
        return;
    }
    
    AppState.currentClient.materials.splice(index, 1);
    saveCurrentClientChanges();
    displayMaterialsList();
    displayVerificationList();
    showSuccess("Matériel supprimé de la liste");
}

function completeVerification() {
    if (!AppState.currentClient || !AppState.currentClient.materials || AppState.currentClient.materials.length === 0) {
        showError("Aucun matériel à vérifier");
        return;
    }
    
    const materialsToCheck = AppState.currentFamilyFilter.includes('all') 
        ? AppState.currentClient.materials 
        : AppState.currentClient.materials.filter(m => AppState.currentFamilyFilter.includes(m.type));
    
    const verifiedMaterials = materialsToCheck.filter(m => m.verified && isVerifiedForCurrentYear(m));
    
    if (verifiedMaterials.length === 0) {
        showError("Aucun matériel n'a été validé !");
        return;
    }
    
    const filterNames = getActiveFilterNames();
    showSuccess(`Vérification terminée pour ${filterNames} ! ${verifiedMaterials.length} matériel(s) vérifié(s) pour ${new Date().getFullYear()}.`);
    
    AppState.currentFamilyFilter = ['all'];
    navigateTo('signature');
}

function resetVerificationsForNewYear() {
    if (!AppState.currentClient || !AppState.currentClient.materials) return;
    
    const currentYear = new Date().getFullYear();
    
    AppState.currentClient.materials.forEach(material => {
        if (material.dateVerification) {
            const verificationYear = new Date(material.dateVerification).getFullYear();
            if (verificationYear < currentYear) {
                material.verified = false;
                material.verifiedBy = '';
            }
        }
    });
    
    saveCurrentClientChanges();
}

// ==================== SIGNATURES ====================
function initSignaturePads() {
    initSignaturePad('client-signature-canvas', 'clientSignaturePad');
    initSignaturePad('technician-signature-canvas', 'technicianSignaturePad');
}

function initSignaturePad(canvasId, padVariable) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    
    const container = canvas.parentElement;
    if (container) {
        canvas.width = container.clientWidth;
        canvas.height = container.clientHeight;
    }
    
    const signaturePad = new SignaturePad(canvas, {
        backgroundColor: 'white',
        penColor: 'rgb(26, 54, 93)',
        minWidth: 1,
        maxWidth: 3,
        onEnd: function() {
            hideSignaturePlaceholder(canvasId.replace('-canvas', '-placeholder'));
        }
    });
    
    canvas.addEventListener('touchstart', function(e) {
        e.preventDefault();
    }, { passive: false });
    
    canvas.style.touchAction = 'none';
    
    if (padVariable === 'clientSignaturePad') {
        clientSignaturePad = signaturePad;
    } else {
        technicianSignaturePad = signaturePad;
    }
}

function hideSignaturePlaceholder(placeholderId) {
    const placeholder = document.getElementById(placeholderId);
    if (placeholder) {
        placeholder.style.display = 'none';
    }
}

function clearSignature(type) {
    const pad = type === 'client' ? clientSignaturePad : technicianSignaturePad;
    const placeholderId = `${type}-signature-placeholder`;
    
    if (pad) {
        pad.clear();
        showSignaturePlaceholder(placeholderId);
    }
}

function showSignaturePlaceholder(placeholderId) {
    const placeholder = document.getElementById(placeholderId);
    if (placeholder) {
        placeholder.style.display = 'block';
    }
}

function undoSignature(type) {
    const pad = type === 'client' ? clientSignaturePad : technicianSignaturePad;
    const placeholderId = `${type}-signature-placeholder`;
    
    if (pad) {
        const data = pad.toData();
        if (data && data.length > 0) {
            data.pop();
            pad.fromData(data);
            
            if (data.length === 0) {
                showSignaturePlaceholder(placeholderId);
            }
        }
    }
}

function setSignatureDate() {
    setElementValue('signature-date', new Date().toISOString().split('T')[0]);
}

// ==================== FACTURATION ====================
function generateFactureNumber() {
    const date = new Date();
    const year = date.getFullYear().toString().substr(-2);
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const day = date.getDate().toString().padStart(2, '0');
    const random = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
    
    AppState.factureNumero = `FACT-${year}${month}${day}-${random}`;
    setElementValue('facture-numero', AppState.factureNumero);
}

function toggleFraisDeplacement() {
    const container = document.getElementById('frais-deplacement-container');
    const checkbox = document.getElementById('frais-deplacement');
    
    if (!container || !checkbox) return;
    
    if (checkbox.checked) {
        container.classList.remove('hidden');
        container.style.display = 'flex';
    } else {
        container.classList.add('hidden');
        AppState.fraisDeplacement = 0;
    }
    
    updateFactureTotal();
}

function addFactureItem() {
    const description = prompt('Description de l\'article :');
    if (!description) return;
    
    const quantity = parseFloat(prompt('Quantité :', '1'));
    if (isNaN(quantity) || quantity <= 0) {
        showError('Quantité invalide');
        return;
    }
    
    const price = parseFloat(prompt('Prix unitaire HT :', '0'));
    if (isNaN(price) || price < 0) {
        showError('Prix invalide');
        return;
    }
    
    const item = {
        id: generateId(),
        description: description.trim(),
        quantity: quantity,
        price: price,
        total: quantity * price
    };
    
    AppState.factureItems.push(item);
    updateFactureItemsList();
    updateFactureTotal();
}

function updateFactureItemsList() {
    const list = document.getElementById('facture-items-list');
    if (!list) return;
    
    list.innerHTML = AppState.factureItems.map((item, index) => createFactureItemHTML(item, index)).join('');
}

function createFactureItemHTML(item, index) {
    return `
        <div class="facture-item">
            <div class="facture-item-desc">${escapeHtml(item.description)}</div>
            <div class="facture-item-qty">${item.quantity}</div>
            <div class="facture-item-price">${item.price.toFixed(2)} €</div>
            <div class="facture-item-total">${item.total.toFixed(2)} €</div>
            <button class="btn btn-sm btn-danger" onclick="removeFactureItem(${index})">
                <i class="fas fa-trash"></i>
            </button>
        </div>
    `;
}

function removeFactureItem(index) {
    AppState.factureItems.splice(index, 1);
    updateFactureItemsList();
    updateFactureTotal();
}

function updateFactureTotal() {
    let totalHT = AppState.factureItems.reduce((sum, item) => sum + item.total, 0);
    
    const deplacementCheckbox = document.getElementById('frais-deplacement');
    if (deplacementCheckbox && deplacementCheckbox.checked) {
        const montantInput = document.getElementById('frais-deplacement-montant');
        if (montantInput) {
            AppState.fraisDeplacement = parseFloat(montantInput.value) || 0;
            totalHT += AppState.fraisDeplacement;
        }
    }
    
    const tva = totalHT * 0.20;
    const totalTTC = totalHT + tva;
    
    updateElementText('facture-total-ht', `${totalHT.toFixed(2)} €`);
    updateElementText('facture-tva', `${tva.toFixed(2)} €`);
    updateElementText('facture-total-ttc', `${totalTTC.toFixed(2)} €`);
}

// ==================== CALENDRIER ====================
function generateCalendar(month, year) {
    const monthNames = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 
                       'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];
    
    updateElementText('current-month', `${monthNames[month]} ${year}`);
    
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const daysInMonth = lastDay.getDate();
    const startingDay = firstDay.getDay() === 0 ? 6 : firstDay.getDay() - 1;
    
    const calendarDays = document.getElementById('calendar-days');
    if (!calendarDays) return;
    
    calendarDays.innerHTML = '';
    
    for (let i = 0; i < startingDay; i++) {
        const day = new Date(year, month, 0).getDate() - startingDay + i + 1;
        calendarDays.appendChild(createCalendarDay(day, true, month, year));
    }
    
    const today = new Date();
    for (let day = 1; day <= daysInMonth; day++) {
        const isToday = day === today.getDate() && 
                       month === today.getMonth() && 
                       year === today.getFullYear();
        
        calendarDays.appendChild(createCalendarDay(day, false, month, year, isToday));
    }
    
    if (month === today.getMonth() && year === today.getFullYear()) {
        selectTodayInCalendar(calendarDays);
    }
}

function createCalendarDay(day, isOtherMonth, month, year, isToday = false) {
    const dayElement = document.createElement('div');
    dayElement.className = 'calendar-day';
    
    if (isOtherMonth) {
        dayElement.classList.add('other-month');
    }
    
    if (isToday) {
        dayElement.classList.add('today');
    }
    
    const events = getEventsForDay(day, month, year);
    if (events.length > 0) {
        dayElement.classList.add('has-events');
    }
    
    dayElement.innerHTML = `
        <div class="calendar-day-number">${day}</div>
        <div class="calendar-day-events">
            ${events.slice(0, 3).map(event => 
                `<div class="calendar-event-dot ${event.type}"></div>`
            ).join('')}
        </div>
    `;
    
    if (!isOtherMonth) {
        dayElement.addEventListener('click', () => {
            selectCalendarDay(dayElement, day, month, year);
        });
    }
    
    return dayElement;
}

function selectCalendarDay(dayElement, day, month, year) {
    document.querySelectorAll('.calendar-day').forEach(d => d.classList.remove('selected'));
    dayElement.classList.add('selected');
    displayEventsForDay(day, month, year);
}

function selectTodayInCalendar(calendarDays) {
    const todayElement = calendarDays.querySelector('.today');
    if (todayElement) {
        todayElement.click();
    }
}

function getEventsForDay(day, month, year) {
    return AppState.calendarEvents.filter(event => {
        const eventDate = new Date(event.start);
        return eventDate.getDate() === day && 
               eventDate.getMonth() === month && 
               eventDate.getFullYear() === year;
    });
}

function displayEventsForDay(day, month, year) {
    const container = document.getElementById('calendar-events');
    const buttonContainer = document.getElementById('planning-verif-btn-container');
    
    if (!container) return;
    
    const events = getEventsForDay(day, month, year);
    
    if (events.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <i class="fas fa-calendar-day"></i>
                <p>Aucune intervention prévue</p>
            </div>
        `;
        
        if (buttonContainer) {
            buttonContainer.style.display = 'none';
        }
        return;
    }
    
    container.innerHTML = `
        <h3 class="calendar-events-title">Interventions du ${day}/${month + 1}/${year}</h3>
        ${events.map(event => createCalendarEventHTML(event)).join('')}
    `;
    
    if (buttonContainer) {
        buttonContainer.style.display = 'block';
    }
}

function createCalendarEventHTML(event) {
    const start = new Date(event.start);
    const end = new Date(event.end);
    
    return `
        <div class="calendar-event-item" id="event-${event.id}">
            <div class="calendar-event-header">
                <div>
                    <div class="calendar-event-time">
                        <i class="far fa-clock"></i> ${formatTime(start)} - ${formatTime(end)}
                    </div>
                    <div class="calendar-event-title">
                        ${escapeHtml(event.title)}
                    </div>
                    <div class="calendar-event-client">
                        <i class="fas fa-user"></i> ${escapeHtml(event.clientName || 'Client')}
                    </div>
                </div>
                <div class="compact-material-actions">
                    <button class="btn btn-sm" onclick="editIntervention('${event.id}')" 
                            title="Modifier">
                        <i class="fas fa-edit"></i>
                    </button>
                    <button class="btn btn-sm btn-danger" onclick="deleteIntervention('${event.id}')" 
                            title="Supprimer">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            </div>
            <div class="calendar-event-footer">
                <span class="status-badge ${event.type === 'verification' ? 'status-ok' : 'status-purple'}">
                    ${event.type === 'verification' ? 'Vérification' : 'Installation'}
                </span>
                ${event.technician ? `
                    <span class="status-badge status-technician">
                        <i class="fas fa-user-cog"></i> ${escapeHtml(event.technician)}
                    </span>
                ` : ''}
            </div>
            ${event.description ? `
                <div class="calendar-event-desc">
                    ${escapeHtml(event.description)}
                </div>
            ` : ''}
        </div>
    `;
}

function changeMonth(delta) {
    AppState.currentMonth += delta;
    
    if (AppState.currentMonth < 0) {
        AppState.currentMonth = 11;
        AppState.currentYear--;
    } else if (AppState.currentMonth > 11) {
        AppState.currentMonth = 0;
        AppState.currentYear++;
    }
    
    generateCalendar(AppState.currentMonth, AppState.currentYear);
}

function goToToday() {
    const today = new Date();
    AppState.currentMonth = today.getMonth();
    AppState.currentYear = today.getFullYear();
    generateCalendar(AppState.currentMonth, AppState.currentYear);
}

// ==================== INTERVENTIONS ====================
function addIntervention() {
    updateInterventionClientList();
    
    const now = new Date();
    const startDate = now.toISOString().slice(0, 16);
    const endDate = new Date(now.getTime() + 2 * 60 * 60 * 1000).toISOString().slice(0, 16);
    
    setElementValue('intervention-title', '');
    setElementValue('intervention-type', 'verification');
    setElementValue('intervention-start', startDate);
    setElementValue('intervention-end', endDate);
    setElementValue('intervention-technician', getElementValue('technician-name') || '');
    setElementValue('intervention-description', '');
    
    AppState.currentEditingInterventionId = null;
    showModal('add-intervention-modal');
    updateInterventionColor();
}

function updateInterventionClientList() {
    const select = document.getElementById('intervention-client');
    if (!select) return;
    
    select.innerHTML = '<option value="">Sélectionner un client</option>';
    
    AppState.clients.forEach(client => {
        const option = document.createElement('option');
        option.value = client.id;
        option.textContent = client.name;
        select.appendChild(option);
    });
}

function updateInterventionColor() {
    const type = getElementValue('intervention-type');
    const color = type === 'verification' ? 'var(--verification-color)' : 'var(--installation-color)';
    setElementValue('intervention-color', color);
}

function editIntervention(interventionId) {
    const intervention = AppState.currentInterventions.find(i => i.id === interventionId);
    if (!intervention) {
        showError('Intervention non trouvée');
        return;
    }
    
    setElementValue('intervention-client', intervention.clientId || '');
    setElementValue('intervention-title', intervention.title || '');
    setElementValue('intervention-type', intervention.type || 'verification');
    setElementValue('intervention-start', intervention.start ? new Date(intervention.start).toISOString().slice(0, 16) : '');
    setElementValue('intervention-end', intervention.end ? new Date(intervention.end).toISOString().slice(0, 16) : '');
    setElementValue('intervention-technician', intervention.technician || '');
    setElementValue('intervention-description', intervention.description || '');
    
    AppState.currentEditingInterventionId = interventionId;
    
    const modal = document.getElementById('add-intervention-modal');
    const saveButton = modal.querySelector('.btn-success');
    if (saveButton) {
        saveButton.innerHTML = '<i class="fas fa-save"></i> Enregistrer les modifications';
        saveButton.onclick = () => saveEditedIntervention(interventionId);
    }
    
    showModal('add-intervention-modal');
    updateInterventionColor();
}

function saveEditedIntervention(interventionId) {
    const formData = getInterventionFormData();
    
    if (!validateInterventionForm(formData)) {
        return;
    }
    
    const client = AppState.clients.find(c => c.id === formData.clientId);
    if (!client) {
        showError('Client non trouvé');
        return;
    }
    
    const index = AppState.currentInterventions.findIndex(i => i.id === interventionId);
    if (index === -1) {
        showError('Intervention non trouvé');
        return;
    }
    
    const updatedIntervention = {
        ...AppState.currentInterventions[index],
        ...formData,
        clientName: client.name,
        updated: new Date().toISOString()
    };
    
    AppState.currentInterventions[index] = updatedIntervention;
    
    if (client.interventions) {
        const clientInterventionIndex = client.interventions.findIndex(i => i.id === interventionId);
        if (clientInterventionIndex !== -1) {
            client.interventions[clientInterventionIndex] = updatedIntervention;
        }
    }
    
    const calendarIndex = AppState.calendarEvents.findIndex(e => e.id === interventionId);
    if (calendarIndex !== -1) {
        AppState.calendarEvents[calendarIndex] = updatedIntervention;
    } else {
        AppState.calendarEvents.push(updatedIntervention);
    }
    
    saveInterventions();
    saveCalendarEvents();
    saveClients();
    closeModal('add-intervention-modal');
    generateCalendar(AppState.currentMonth, AppState.currentYear);
    showSuccess('Intervention modifiée avec succès');
    AppState.currentEditingInterventionId = null;
}

async function saveInterventions() {
    if (AppState.currentInterventions.length > 0) {
        await dbManager.saveAll('interventions', AppState.currentInterventions);
    }
}

function saveIntervention() {
    const formData = getInterventionFormData();
    
    if (!validateInterventionForm(formData)) {
        return;
    }
    
    const client = AppState.clients.find(c => c.id === formData.clientId);
    if (!client) {
        showError('Client non trouvé');
        return;
    }
    
    const interventionId = AppState.currentEditingInterventionId || generateId();
    
    const intervention = {
        id: interventionId,
        clientId: formData.clientId,
        clientName: client.name,
        title: formData.title,
        type: formData.type,
        start: formData.start,
        end: formData.end,
        technician: formData.technician,
        description: formData.description,
        color: formData.color,
        created: new Date().toISOString()
    };
    
    if (AppState.currentEditingInterventionId) {
        const index = AppState.currentInterventions.findIndex(i => i.id === interventionId);
        if (index !== -1) {
            AppState.currentInterventions[index] = intervention;
        }
    } else {
        AppState.currentInterventions.push(intervention);
    }
    
    if (!client.interventions) {
        client.interventions = [];
    }
    
    const existingIndex = client.interventions.findIndex(i => i.id === interventionId);
    if (existingIndex !== -1) {
        client.interventions[existingIndex] = intervention;
    } else {
        client.interventions.push(intervention);
    }
    
    const calendarIndex = AppState.calendarEvents.findIndex(e => e.id === interventionId);
    if (calendarIndex !== -1) {
        AppState.calendarEvents[calendarIndex] = intervention;
    } else {
        AppState.calendarEvents.push(intervention);
    }
    
    saveInterventions();
    saveCalendarEvents();
    saveClients();
    closeModal('add-intervention-modal');
    generateCalendar(AppState.currentMonth, AppState.currentYear);
    
    if (AppState.currentEditingInterventionId) {
        showSuccess('Intervention modifiée avec succès');
    } else {
        showSuccess('Intervention ajoutée au planning');
    }
    
    resetInterventionForm();
}

function getInterventionFormData() {
    return {
        clientId: getElementValue('intervention-client'),
        title: getElementValue('intervention-title'),
        type: getElementValue('intervention-type'),
        start: getElementValue('intervention-start'),
        end: getElementValue('intervention-end'),
        technician: getElementValue('intervention-technician'),
        description: getElementValue('intervention-description'),
        color: getElementValue('intervention-color')
    };
}

function validateInterventionForm(formData) {
    const requiredFields = ['clientId', 'title', 'type', 'start', 'end'];
    
    for (const field of requiredFields) {
        if (!formData[field]) {
            showError('Veuillez remplir tous les champs obligatoires');
            return false;
        }
    }
    
    return true;
}

function resetInterventionForm() {
    const modal = document.getElementById('add-intervention-modal');
    const saveButton = modal.querySelector('.btn-success');
    if (saveButton) {
        saveButton.innerHTML = '<i class="fas fa-save"></i> Enregistrer';
        saveButton.onclick = saveIntervention;
    }
    AppState.currentEditingInterventionId = null;
}

function deleteIntervention(interventionId) {
    if (!confirm('Êtes-vous sûr de vouloir supprimer cette intervention ?')) {
        return;
    }
    
    const intervention = AppState.currentInterventions.find(i => i.id === interventionId);
    if (!intervention) {
        showError('Intervention non trouvée');
        return;
    }
    
    AppState.currentInterventions = AppState.currentInterventions.filter(i => i.id !== interventionId);
    
    const client = AppState.clients.find(c => c.id === intervention.clientId);
    if (client && client.interventions) {
        client.interventions = client.interventions.filter(i => i.id !== interventionId);
        saveClients();
    }
    
    AppState.calendarEvents = AppState.calendarEvents.filter(e => e.id !== interventionId);
    
    saveInterventions();
    saveCalendarEvents();
    generateCalendar(AppState.currentMonth, AppState.currentYear);
    showSuccess('Intervention supprimée avec succès');
}

function goToVerificationFromPlanning() {
    navigateTo('verification');
}

// ==================== HISTORIQUE ====================
function loadHistory() {
    const historyList = document.getElementById('history-list');
    if (!historyList) return;
    
    const searchTerm = getElementValue('history-search')?.toLowerCase() || '';
    const verifiedClients = getVerifiedClients(searchTerm);
    
    if (verifiedClients.length === 0) {
        showEmptyState(historyList, 'history');
        return;
    }
    
    historyList.innerHTML = verifiedClients.map(client => createHistoryItemHTML(client)).join('');
}

function getVerifiedClients(searchTerm) {
    return AppState.clients.filter(client => {
        const hasVerifications = client.verificationCompleted || 
                                (client.materials && client.materials.some(m => m.verified));
        
        if (!hasVerifications) return false;
        
        if (searchTerm) {
            return client.name.toLowerCase().includes(searchTerm) ||
                   client.contact.toLowerCase().includes(searchTerm) ||
                   client.address.toLowerCase().includes(searchTerm);
        }
        
        return true;
    });
}

function createHistoryItemHTML(client) {
    const verifiedMaterials = client.materials?.filter(m => m.verified) || [];
    const lastVerification = getLastVerificationDate(client);
    
    return `
        <div class="compact-material-item client-item">
            <div class="compact-material-info">
                <div class="compact-material-name">
                    <i class="fas fa-user"></i>
                    ${escapeHtml(client.name)}
                    <span class="status-badge status-ok">
                        ${verifiedMaterials.length} matériel(s) vérifié(s)
                    </span>
                </div>
                <div class="compact-material-details">
                    ${escapeHtml(client.contact)} • ${escapeHtml(client.address)}
                    <br>
                    <small>Dernière vérification : ${lastVerification ? formatDate(lastVerification) : 'Non spécifiée'}</small>
                </div>
            </div>
            <div class="compact-material-actions">
                <button class="btn btn-sm btn-primary" onclick="viewClientHistory('${client.id}')" 
                        title="Voir détails">
                    <i class="fas fa-eye"></i>
                </button>
            </div>
        </div>
    `;
}

function getLastVerificationDate(client) {
    if (client.lastVerificationDate) {
        return client.lastVerificationDate;
    }
    
    if (client.materials) {
        const verifiedMaterials = client.materials.filter(m => m.verified && m.dateVerification);
        if (verifiedMaterials.length > 0) {
            return verifiedMaterials[0].dateVerification;
        }
    }
    
    return null;
}

function searchHistory() {
    loadHistory();
}

function viewClientHistory(clientId) {
    const client = AppState.clients.find(c => c.id === clientId);
    if (client) {
        selectClient(client);
        navigateTo('verification');
    }
}

// ==================== UTILITAIRES ====================
function generateId() {
    return '_' + Math.random().toString(36).substr(2, 9);
}

function formatDate(dateString) {
    if (!dateString) return '';
    
    try {
        const date = new Date(dateString);
        return date.toLocaleDateString('fr-FR', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric'
        });
    } catch (error) {
        console.error('Erreur de formatage de date:', error);
        return dateString;
    }
}

function formatTime(date) {
    return date.toLocaleTimeString('fr-FR', { 
        hour: '2-digit', 
        minute: '2-digit',
        hour12: false
    });
}

function showSuccess(message) {
    const modal = document.getElementById('success-modal');
    const messageElement = document.getElementById('modal-message');
    
    if (messageElement) {
        messageElement.textContent = message;
    }
    
    if (modal) {
        modal.classList.add('active');
    }
}

function showError(message) {
    const modal = document.getElementById('error-modal');
    const messageElement = document.getElementById('error-message');
    
    if (messageElement) {
        messageElement.textContent = message;
    }
    
    if (modal) {
        modal.classList.add('active');
    }
}

function closeSuccessModal() {
    const modal = document.getElementById('success-modal');
    if (modal) {
        modal.classList.remove('active');
    }
}

function closeErrorModal() {
    const modal = document.getElementById('error-modal');
    if (modal) {
        modal.classList.remove('active');
    }
}

function setTodayDate() {
    const today = new Date().toISOString().split('T')[0];
    document.querySelectorAll('input[type="date"]').forEach(input => {
        if (!input.value) {
            input.value = today;
        }
    });
}

function getElementValue(id) {
    const element = document.getElementById(id);
    return element ? element.value : '';
}

function setElementValue(id, value) {
    const element = document.getElementById(id);
    if (element) {
        element.value = value;
    }
}

function updateElementText(id, text) {
    const element = document.getElementById(id);
    if (element) {
        element.textContent = text;
    }
}

function setFormValues(fields) {
    Object.entries(fields).forEach(([id, value]) => {
        setElementValue(id, value);
    });
}

function getCheckboxValue(id) {
    const checkbox = document.getElementById(id);
    return checkbox ? checkbox.checked : false;
}

function setCheckboxValue(id, value) {
    const checkbox = document.getElementById(id);
    if (checkbox) {
        checkbox.checked = value;
    }
}

function focusElement(id) {
    const element = document.getElementById(id);
    if (element) {
        element.focus();
    }
}

function resetOkNokFields(fields) {
    fields.forEach(field => {
        const selector = document.querySelector(`[onclick*="${field}"]`);
        if (selector) {
            const options = selector.parentElement.querySelectorAll('.ok-nok-option');
            options.forEach(opt => opt.classList.remove('selected'));
        }
        setElementValue(`extincteur-${field}`, '');
    });
}

function clearPhotoGallery(galleryId) {
    const gallery = document.getElementById(galleryId);
    if (gallery) {
        gallery.innerHTML = '';
    }
}

function updateModalButton(modalId, text, onclick) {
    const modal = document.getElementById(modalId);
    if (!modal) return;
    
    const button = modal.querySelector('.btn-success');
    if (button) {
        button.innerHTML = `<i class="fas fa-plus"></i> ${text}`;
        button.onclick = onclick;
    }
}

function showModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.classList.add('active');
    }
}

function closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.classList.remove('active');
    }
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

// ==================== MODALS INTERACTION ====================
function selectOkNok(element, field) {
    const parent = element.parentElement;
    parent.querySelectorAll('.ok-nok-option').forEach(opt => {
        opt.classList.remove('selected');
    });
    
    element.classList.add('selected');
    const value = element.textContent.trim();
    setElementValue(`extincteur-${field}`, value);
    
    if (field === 'joints' && value === 'Non OK') {
        const container = document.getElementById('remplacement-joint-container');
        if (container) container.style.display = 'block';
    } else if (field === 'joints') {
        const container = document.getElementById('remplacement-joint-container');
        if (container) container.style.display = 'none';
    }
}

function selectRIANok(element, field) {
    selectGenericOkNok(element, `ria-${field}`);
}

function selectBAESNok(element, field) {
    selectGenericOkNok(element, `baes-${field}`);
}

function selectGenericOkNok(element, fieldId) {
    const parent = element.parentElement;
    parent.querySelectorAll('.ok-nok-option').forEach(opt => {
        opt.classList.remove('selected');
    });
    
    element.classList.add('selected');
    setElementValue(fieldId, element.textContent.trim());
}

function selectExtincteurInterventionType(type) {
    selectMaterialInterventionType('extincteur', type);
}

function selectRIAInterventionType(type) {
    selectMaterialInterventionType('ria', type);
}

function selectBAESInterventionType(type) {
    selectMaterialInterventionType('baes', type);
}

function selectMaterialInterventionType(material, type) {
    const selector = document.getElementById(`${material}-intervention-type-selector`);
    if (!selector) return;
    
    selector.querySelectorAll('.material-type-option').forEach(opt => {
        opt.classList.remove('selected');
    });
    
    const selectedOption = selector.querySelector(`[onclick*="${type}"]`);
    if (selectedOption) {
        selectedOption.classList.add('selected');
    }
    
    setElementValue(`${material}-intervention-type`, type);
}

function checkExtincteurAge() {
    const annee = getElementValue('extincteur-annee');
    const type = getElementValue('extincteur-type');
    const container = document.getElementById('age-warning-container');
    const warningText = document.getElementById('age-warning-text');
    
    if (!container || !warningText) return;
    
    if (annee && type) {
        const currentYear = new Date().getFullYear();
        const age = currentYear - parseInt(annee);
        
        if (age >= 10) {
            warningText.textContent = `Attention : l'extincteur a ${age} ans !`;
            container.style.display = 'block';
        } else {
            container.style.display = 'none';
        }
    }
}

function generateExtincteurId() {
    if (!AppState.currentClient) return;
    
    const currentCount = AppState.currentClient.materials 
        ? AppState.currentClient.materials.filter(m => m.type === 'extincteur').length + 1 
        : 1;
    
    setElementValue('extincteur-id', `EXT-${currentCount.toString().padStart(3, '0')}`);
}

// ==================== ALARMES ====================
function initAlarmeEvents() {
    const today = new Date().toISOString().split('T')[0];
    const nextYear = new Date();
    nextYear.setFullYear(nextYear.getFullYear() + 1);
    
    const dateVerifInput = document.getElementById('alarme-date-verif');
    if (dateVerifInput && !dateVerifInput.value) {
        dateVerifInput.value = today;
    }
    
    const dateProchaineInput = document.getElementById('alarme-date-prochaine');
    if (dateProchaineInput && !dateProchaineInput.value) {
        dateProchaineInput.value = nextYear.toISOString().split('T')[0];
    }
    
    const yearInput = document.getElementById('alarme-annee');
    if (yearInput && !yearInput.value) {
        yearInput.value = new Date().getFullYear();
    }
    
    const idInput = document.getElementById('alarme-id');
    if (idInput && !idInput.value) {
        idInput.value = generateAlarmeId();
    }
}

function generateAlarmeId() {
    const count = AppState.materials.filter(m => m.type === 'alarme').length + 1;
    return `AL-${count.toString().padStart(3, '0')}`;
}

function selectRegistreSecurite(element, value) {
    const parent = element.parentElement;
    parent.querySelectorAll('.ok-nok-option').forEach(opt => {
        opt.classList.remove('selected');
    });
    element.classList.add('selected');
    setElementValue('registre-securite', value);
    
    const status = document.getElementById('registre-securite-status');
    if (status) {
        status.style.color = 'var(--success)';
        status.innerHTML = `<i class="fas fa-check-circle"></i> ${value === 'oui' ? 'Registre signé' : value === 'non' ? 'Registre non signé' : 'Registre indisponible'}`;
    }
}

// ==================== SERVICE WORKER ====================
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', event => {
        const message = event.data;
        switch(message.type) {
            case 'UPDATE_AVAILABLE':
                if (confirm('Une nouvelle version de l\'application est disponible. Voulez-vous recharger ?')) {
                    window.location.reload();
                }
                break;
        }
    });
}

// ==================== FONCTIONS MANQUANTES ====================
function openAddExtincteurModal() {
    const modal = document.getElementById('add-extincteur-modal');
    if (modal) {
        modal.classList.add('active');
        document.body.style.overflow = 'hidden';
    }
}

function openAddRIAModal() {
    const modal = document.getElementById('add-ria-modal');
    if (modal) {
        modal.classList.add('active');
        document.body.style.overflow = 'hidden';
    }
}

function openAddBAESModal() {
    const modal = document.getElementById('add-baes-modal');
    if (modal) {
        modal.classList.add('active');
        document.body.style.overflow = 'hidden';
    }
}

function openAddAlarmeModal() {
    const modal = document.getElementById('add-alarme-modal');
    if (modal) {
        modal.classList.add('active');
        document.body.style.overflow = 'hidden';
    }
}

function closeExtincteurModal() {
    const modal = document.getElementById('add-extincteur-modal');
    if (modal) {
        modal.classList.remove('active');
        document.body.style.overflow = '';
    }
}

function closeRIAModal() {
    const modal = document.getElementById('add-ria-modal');
    if (modal) {
        modal.classList.remove('active');
        document.body.style.overflow = '';
    }
}

function closeBAESModal() {
    const modal = document.getElementById('add-baes-modal');
    if (modal) {
        modal.classList.remove('active');
        document.body.style.overflow = '';
    }
}

function closeAlarmeModal() {
    const modal = document.getElementById('add-alarme-modal');
    if (modal) {
        modal.classList.remove('active');
        document.body.style.overflow = '';
    }
}

function closeInterventionModal() {
    const modal = document.getElementById('add-intervention-modal');
    if (modal) {
        modal.classList.remove('active');
        document.body.style.overflow = '';
    }
}

function closePreview() {
    const modal = document.getElementById('preview-modal');
    if (modal) {
        modal.classList.remove('active');
        document.body.style.overflow = '';
    }
}

function closeFacture() {
    const modal = document.getElementById('facture-modal');
    if (modal) {
        modal.classList.remove('active');
        document.body.style.overflow = '';
    }
}

// ==================== GESTION DES DONNÉES UI ====================
function addDataManagementUI() {
    const headerControls = document.querySelector('.header-controls');
    if (!headerControls) return;
    
    const dataMenu = document.createElement('div');
    dataMenu.className = 'data-management-menu';
    dataMenu.innerHTML = `
        <button class="btn btn-sm" onclick="showDataManagementModal()" 
                title="Gestion des données">
            <i class="fas fa-database"></i>
        </button>
    `;
    
    headerControls.appendChild(dataMenu);
}

function showDataManagementModal() {
    const modalContent = `
        <div class="modal-body">
            <div class="data-management-options">
                <div class="data-option">
                    <h4><i class="fas fa-save"></i> Sauvegarde</h4>
                    <button class="btn btn-block" onclick="exportAllDataManual()">
                        <i class="fas fa-download"></i> Exporter toutes les données
                    </button>
                    <button class="btn btn-block" onclick="createBackupNow()">
                        <i class="fas fa-copy"></i> Créer un backup maintenant
                    </button>
                </div>
                
                <div class="data-option">
                    <h4><i class="fas fa-upload"></i> Restauration</h4>
                    <button class="btn btn-block" onclick="triggerImport()">
                        <i class="fas fa-upload"></i> Importer des données
                    </button>
                </div>
            </div>
        </div>
        <div class="modal-footer">
            <button class="btn btn-danger" onclick="closeModal('data-management-modal')">
                <i class="fas fa-times"></i> Fermer
            </button>
        </div>
    `;
    
    showCustomModal('data-management-modal', 'Gestion des données', modalContent);
}

function showCustomModal(id, title, content) {
    let modal = document.getElementById(id);
    if (!modal) {
        modal = document.createElement('div');
        modal.id = id;
        modal.className = 'modal';
        modal.innerHTML = `
            <div class="modal-content">
                <div class="modal-header" style="display: flex; justify-content: space-between; align-items: center; padding: 1.2rem; border-bottom: 2px solid var(--danger); background: linear-gradient(135deg, #ffffff 0%, #fff5f5 100%);">
                    <h3 style="margin: 0; color: var(--danger); font-size: 1.4rem; display: flex; align-items: center; gap: 10px;">
                        <i class="fas fa-database" style="color: var(--danger);"></i>
                        ${title}
                    </h3>
                    <button class="btn btn-danger btn-sm" onclick="closeModal('${id}')" 
                            style="display: flex; align-items: center; gap: 5px; padding: 0.5rem 1rem; font-weight: 600;">
                        <i class="fas fa-times"></i> Fermer
                    </button>
                </div>
                ${content}
            </div>
        `;
        document.body.appendChild(modal);
    }
    modal.classList.add('active');
}

function exportAllDataManual() {
    const importExportManager = new ImportExportManager();
    importExportManager.exportAllData(false);
}

function createBackupNow() {
    const importExportManager = new ImportExportManager();
    importExportManager.exportAllData(true).then(() => {
        showSuccess('Backup créé avec succès');
    });
}

function triggerImport() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = (event) => {
        const file = event.target.files[0];
        if (file) {
            const importExportManager = new ImportExportManager();
            importExportManager.importData(file);
        }
    };
    input.click();
}

// ==================== CSS ADDITIONNEL ====================
function addDataManagementCSS() {
    const style = document.createElement('style');
    style.textContent = `
        .offline-notification {
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            background: #f8d7da;
            color: #721c24;
            padding: 10px 20px;
            z-index: 10000;
            text-align: center;
            border-bottom: 2px solid #f5c6cb;
        }
        
        .offline-content {
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 10px;
        }
        
        .offline-content button {
            background: none;
            border: none;
            color: #721c24;
            cursor: pointer;
            font-size: 1.2em;
        }
        
        .status-indicator {
            display: inline-block;
            padding: 3px 8px;
            border-radius: 12px;
            font-size: 0.8em;
            font-weight: bold;
        }
        
        .status-indicator.online {
            background: #d4edda;
            color: #155724;
        }
        
        .status-indicator.offline {
            background: #f8d7da;
            color: #721c24;
        }
        
        .data-management-menu {
            display: inline-block;
            margin-left: 10px;
        }
        
        .data-management-options {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
            gap: 20px;
            padding: 20px 0;
        }
        
        .data-option {
            background: #f8f9fa;
            padding: 15px;
            border-radius: 8px;
            border: 1px solid #dee2e6;
        }
        
        .data-option h4 {
            margin-top: 0;
            color: #2c3e50;
            border-bottom: 2px solid #3498db;
            padding-bottom: 5px;
        }
        
        .sync-status, .storage-info {
            background: white;
            padding: 10px;
            border-radius: 5px;
            margin: 10px 0;
            font-size: 0.9em;
        }
        
        #sync-status-indicator {
            font-weight: bold;
        }
        
        .online #sync-status-indicator {
            color: #28a745;
        }
        
        .offline #sync-status-indicator {
            color: #dc3545;
        }
        
        @media (max-width: 768px) {
            .data-management-options {
                grid-template-columns: 1fr;
            }
        }
    `;
    document.head.appendChild(style);
}

// ==================== FONCTIONS D'UTILITÉ SUPPLÉMENTAIRES ====================
function showLoading(message) {
    let loading = document.getElementById('loading-overlay');
    if (!loading) {
        loading = document.createElement('div');
        loading.id = 'loading-overlay';
        loading.className = 'loading-overlay';
        loading.innerHTML = `
            <div class="loading-content">
                <div class="spinner"></div>
                <p>${message || 'Chargement...'}</p>
            </div>
        `;
        document.body.appendChild(loading);
    }
    loading.classList.add('active');
}

function closeLoading() {
    const loading = document.getElementById('loading-overlay');
    if (loading) {
        loading.classList.remove('active');
        setTimeout(() => {
            if (loading.parentElement) {
                loading.remove();
            }
        }, 300);
    }
}

function showDataStats() {
    setTimeout(async () => {
        const stats = await dbManager.getStats();
        const message = `
            📊 Statistiques données:
            • ${stats.clients || 0} client(s)
            • ${stats.materials || 0} matériel(s)
            • ${stats.interventions || 0} intervention(s)
            • ${stats.factures || 0} facture(s)
        `;
        console.log(message);
    }, 1000);
}

// ==================== JSPDF FONCTIONS ====================
let jsPDFLoaded = false;

function ensureJSPDF() {
    return new Promise((resolve, reject) => {
        if (typeof jsPDF !== 'undefined') {
            jsPDFLoaded = true;
            resolve(true);
            return;
        }
        
        console.log('📦 Chargement de jsPDF...');
        
        const script = document.createElement('script');
        script.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
        script.integrity = 'sha512-qZvrmS2ekKPF2mSznTQsxqPgnpkI4DNTlrdUmTzrDgektczlKNRRhy5X5AAOnx5S09ydFYWWNSfcEqDTTHgtNA==';
        script.crossOrigin = 'anonymous';
        
        script.onload = () => {
            console.log('✅ jsPDF chargé avec succès');
            jsPDFLoaded = true;
            resolve(true);
        };
        
        script.onerror = (error) => {
            console.error('❌ Échec du chargement de jsPDF:', error);
            reject(new Error('Impossible de charger jsPDF'));
        };
        
        document.head.appendChild(script);
    });
}

// ==================== FONCTIONS DE VÉRIFICATION DE CONFORMITÉ ====================
function isExtincteurConforme(material) {
    // Vérifier l'âge
    if (material.annee) {
        const currentYear = new Date().getFullYear();
        const age = currentYear - parseInt(material.annee);
        if (age >= 10) {
            return false;
        }
    }
    
    // Vérifier les observations pour "non conforme"
    if (material.observations && material.observations.toLowerCase().includes('non conforme')) {
        return false;
    }
    
    // Vérifier les champs OK/NOK
    const champsVerification = [
        'etatGeneral',
        'lisibilite',
        'panneau',
        'goupille',
        'pression',
        'joints',
        'accessibilite'
    ];
    
    for (const champ of champsVerification) {
        if (material[champ] === 'Non OK') {
            return false;
        }
    }
    
    return true;
}

function isRIAConforme(material) {
    // Vérifier les observations pour "non conforme"
    if (material.observations && material.observations.toLowerCase().includes('non conforme')) {
        return false;
    }
    
    // Vérifier les champs OK/NOK
    const champsVerification = [
        'etatGeneral',
        'lisibilite',
        'panneau',
        'accessibilite'
    ];
    
    for (const champ of champsVerification) {
        if (material[champ] === 'Non OK') {
            return false;
        }
    }
    
    return true;
}

function isBAESConforme(material) {
    // Vérifier les observations pour "non conforme"
    if (material.observations && material.observations.toLowerCase().includes('non conforme')) {
        return false;
    }
    
    // Vérifier les champs OK/NOK
    const champsVerification = [
        'etatGeneral',
        'fonctionnement',
        'chargeur',
        'accessibilite'
    ];
    
    for (const champ of champsVerification) {
        if (material[champ] === 'Non OK') {
            return false;
        }
    }
    
    return true;
}

function isAlarmeConforme(material) {
    // Vérifier les observations pour "non conforme"
    if (material.observations && material.observations.toLowerCase().includes('non conforme')) {
        return false;
    }
    
    // Vérifier les champs de vérification
    if (!material.batterie || !material.fonctionnement || !material.accessibilite) {
        return false;
    }
    
    return true;
}

// ==================== GÉNÉRATION RAPPORT PDF OPTIMISÉ ====================
async function generatePDFReport() {
    console.log('🔄 Début génération rapport PDF optimisé...');
    
    if (!AppState.currentClient) {
        showError('Veuillez d\'abord sélectionner un client');
        return;
    }
    
    const materials = AppState.currentClient.materials?.filter(m => m.verified) || [];
    
    if (materials.length === 0) {
        showError('Aucun matériel vérifié à exporter');
        return;
    }
    
    showLoading('Génération du rapport PDF en cours...');
    
    try {
        await ensureJSPDF();
        
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF({
            orientation: 'portrait',
            unit: 'mm',
            format: 'a4'
        });
        
        // ============== CONFIGURATIONS ==============
        const margin = 15;
        const pageWidth = doc.internal.pageSize.getWidth();
        const pageHeight = doc.internal.pageSize.getHeight();
        const contentWidth = pageWidth - (2 * margin);
        let currentY = margin;
        
        // ============== FONCTIONS UTILITAIRES ==============
        const addText = (text, x, y, fontSize = 10, style = 'normal', align = 'left', color = [0, 0, 0]) => {
            doc.setFontSize(fontSize);
            doc.setFont('helvetica', style);
            doc.setTextColor(color[0], color[1], color[2]);
            doc.text(text, x, y, { align: align });
        };
        
        const addLine = (y, color = [200, 200, 200], width = 1) => {
            doc.setDrawColor(color[0], color[1], color[2]);
            doc.setLineWidth(width);
            doc.line(margin, y, pageWidth - margin, y);
        };
        
        const addBox = (x, y, width, height, fillColor = null, strokeColor = [0, 0, 0]) => {
            if (fillColor) {
                doc.setFillColor(fillColor[0], fillColor[1], fillColor[2]);
                doc.rect(x, y, width, height, 'F');
            }
            doc.setDrawColor(strokeColor[0], strokeColor[1], strokeColor[2]);
            doc.rect(x, y, width, height, 'S');
        };
        
        // ============== EN-TÊTE ==============
        addText('RAPPORT DE VÉRIFICATION ANNUEL', margin, currentY, 20, 'bold', 'left', [26, 54, 93]);
        currentY += 10;
        
        addText('Vérification des équipements de sécurité incendie', margin, currentY, 14, 'normal', 'left', [44, 62, 80]);
        currentY += 8;
        
        // Date et référence
        const today = new Date().toLocaleDateString('fr-FR');
        addText(`Date: ${today}`, margin, currentY, 10);
        addText(`Référence: RAP-${new Date().getFullYear()}-${AppState.currentClient.id?.substr(0, 8) || '000000'}`, pageWidth - margin, currentY, 10, 'normal', 'right');
        currentY += 10;
        
        addLine(currentY);
        currentY += 5;
        
        // ============== INFORMATIONS CLIENT ==============
        addText('INFORMATIONS CLIENT', margin, currentY, 14, 'bold', 'left', [26, 54, 93]);
        currentY += 8;
        
        const client = AppState.currentClient;
        const technician = getElementValue('technician-name') || 'Technicien';
        
        addText(`Nom: ${escapeHtml(client.name)}`, margin, currentY, 10);
        currentY += 5;
        addText(`Contact: ${escapeHtml(client.contact)}`, margin, currentY, 10);
        currentY += 5;
        addText(`Adresse: ${escapeHtml(client.address)}`, margin, currentY, 10);
        currentY += 5;
        addText(`Technicien: ${escapeHtml(technician)}`, margin, currentY, 10);
        currentY += 5;
        
        // Registre de sécurité
        const registreSecurite = getElementValue('registre-securite');
        if (registreSecurite) {
            const statutRegistre = registreSecurite === 'oui' ? 'Signé et conforme' : 
                                  registreSecurite === 'non' ? 'Non signé' : 'Indisponible';
            addText(`Registre de sécurité: ${statutRegistre}`, margin, currentY, 10);
            currentY += 5;
        }
        
        currentY += 10;
        
        // ============== ÉTAT GLOBAL DE CONFORMITÉ ==============
        // Calculer les statistiques
        const materialsByType = groupMaterialsByType(materials);
        let totalConforme = 0;
        let totalNonConforme = 0;
        const nonConformesParType = {};
        
        Object.entries(materialsByType).forEach(([type, items]) => {
            const conformeCount = items.filter(m => {
                switch(type) {
                    case 'extincteur': return isExtincteurConforme(m);
                    case 'ria': return isRIAConforme(m);
                    case 'baes': return isBAESConforme(m);
                    case 'alarme': return isAlarmeConforme(m);
                    default: return true;
                }
            }).length;
            const nonConformeCount = items.length - conformeCount;
            
            totalConforme += conformeCount;
            totalNonConforme += nonConformeCount;
            
            if (nonConformeCount > 0) {
                nonConformesParType[type] = nonConformeCount;
            }
        });
        
        // Affichage sobre de l'état de conformité
        const isGlobalConforme = totalNonConforme === 0;
        const conformiteText = isGlobalConforme ? 'ÉTAT CONFORME' : 'ÉTAT NON CONFORME';
        const conformiteColor = isGlobalConforme ? [50, 168, 82] : [220, 53, 69];
        
        addText(conformiteText, pageWidth / 2, currentY, 16, 'bold', 'center', conformiteColor);
        currentY += 8;
        
        const sousTitre = isGlobalConforme 
            ? `Tous les ${materials.length} matériels vérifiés sont conformes`
            : `${totalNonConforme} matériel(s) non conforme(s) sur ${materials.length}`;
        addText(sousTitre, pageWidth / 2, currentY, 12, 'normal', 'center', [73, 80, 87]);
        
        currentY += 15;
        
        // ============== RÉSUMÉ STATISTIQUES ==============
        addText('SYNTHÈSE DES VÉRIFICATIONS', margin, currentY, 14, 'bold', 'left', [26, 54, 93]);
        currentY += 8;
        
        // Tableau de statistiques simple
        const statX = margin;
        const statWidth = contentWidth / 4;
        
        // Total matériels
        addBox(statX, currentY, statWidth, 20, [248, 249, 250]);
        addText('TOTAL', statX + statWidth/2, currentY + 8, 10, 'bold', 'center', [73, 80, 87]);
        addText(materials.length.toString(), statX + statWidth/2, currentY + 15, 16, 'bold', 'center', [26, 54, 93]);
        
        // Conformes
        addBox(statX + statWidth, currentY, statWidth, 20, [232, 245, 233]);
        addText('CONFORMES', statX + statWidth + statWidth/2, currentY + 8, 10, 'bold', 'center', [73, 80, 87]);
        addText(totalConforme.toString(), statX + statWidth + statWidth/2, currentY + 15, 16, 'bold', 'center', [50, 168, 82]);
        
        // Non conformes
        addBox(statX + statWidth*2, currentY, statWidth, 20, [248, 215, 218]);
        addText('NON CONFORMES', statX + statWidth*2 + statWidth/2, currentY + 8, 10, 'bold', 'center', [73, 80, 87]);
        addText(totalNonConforme.toString(), statX + statWidth*2 + statWidth/2, currentY + 15, 16, 'bold', 'center', [220, 53, 69]);
        
        // Taux de conformité
        const taux = materials.length > 0 ? Math.round((totalConforme / materials.length) * 100) : 0;
        addBox(statX + statWidth*3, currentY, statWidth, 20, [220, 237, 253]);
        addText('TAUX', statX + statWidth*3 + statWidth/2, currentY + 8, 10, 'bold', 'center', [73, 80, 87]);
        addText(`${taux}%`, statX + statWidth*3 + statWidth/2, currentY + 15, 16, 'bold', 'center', [13, 110, 253]);
        
        currentY += 25;
        
        // ============== DÉTAIL PAR TYPE ==============
        currentY += 5;
        
        Object.entries(materialsByType).forEach(([type, items]) => {
            if (items.length === 0) return;
            
            // Nouvelle page si nécessaire
            if (currentY > pageHeight - 60) {
                doc.addPage();
                currentY = margin;
            }
            
            const materialInfo = getMaterialInfo(type);
            const conformeCount = items.filter(m => {
                switch(type) {
                    case 'extincteur': return isExtincteurConforme(m);
                    case 'ria': return isRIAConforme(m);
                    case 'baes': return isBAESConforme(m);
                    case 'alarme': return isAlarmeConforme(m);
                    default: return true;
                }
            }).length;
            const nonConformeCount = items.length - conformeCount;
            const isTypeConforme = nonConformeCount === 0;
            
            // En-tête de type
            addText(`${materialInfo.text.toUpperCase()}`, margin, currentY, 14, 'bold', 'left', [26, 54, 93]);
            
            // Badge de conformité pour le type
            const typeConformiteColor = isTypeConforme ? [50, 168, 82] : [220, 53, 69];
            const typeConformiteText = isTypeConforme ? 'Conforme' : `${nonConformeCount} non conforme(s)`;
            
            addText(typeConformiteText, pageWidth - margin, currentY, 10, 'bold', 'right', typeConformiteColor);
            currentY += 7;
            
            addText(`${items.length} matériel(s) vérifié(s)`, margin, currentY, 10, 'normal', 'left', [108, 117, 125]);
            currentY += 5;
            
            // Tableau détaillé
            const headers = ['ID', 'Localisation', 'Type/Modèle', 'Année', 'Date vérif.', 'État'];
            const colWidths = [20, 35, 30, 15, 20, 30];
            
            // En-têtes du tableau
            doc.setFillColor(26, 54, 93);
            doc.setTextColor(255, 255, 255);
            doc.setFont('helvetica', 'bold');
            
            let xPos = margin;
            headers.forEach((header, i) => {
                doc.rect(xPos, currentY, colWidths[i], 8, 'F');
                addText(header, xPos + colWidths[i]/2, currentY + 5, 9, 'bold', 'center', [255, 255, 255]);
                xPos += colWidths[i];
            });
            
            currentY += 8;
            doc.setTextColor(0, 0, 0);
            doc.setFont('helvetica', 'normal');
            
            // Données du tableau
            items.forEach((material, index) => {
                if (currentY > pageHeight - 20) {
                    doc.addPage();
                    currentY = margin;
                    
                    // Redessiner les en-têtes
                    doc.setFillColor(26, 54, 93);
                    doc.setTextColor(255, 255, 255);
                    doc.setFont('helvetica', 'bold');
                    
                    xPos = margin;
                    headers.forEach((header, i) => {
                        doc.rect(xPos, currentY, colWidths[i], 8, 'F');
                        addText(header, xPos + colWidths[i]/2, currentY + 5, 9, 'bold', 'center', [255, 255, 255]);
                        xPos += colWidths[i];
                    });
                    
                    currentY += 8;
                    doc.setTextColor(0, 0, 0);
                    doc.setFont('helvetica', 'normal');
                }
                
                // Déterminer si conforme
                let isConforme = true;
                let conformiteText = 'CONFORME';
                let conformiteColor = [50, 168, 82];
                let raisonNonConforme = '';
                
                switch(type) {
                    case 'extincteur':
                        isConforme = isExtincteurConforme(material);
                        if (material.annee) {
                            const age = new Date().getFullYear() - parseInt(material.annee);
                            if (age >= 10) {
                                isConforme = false;
                                raisonNonConforme = 'Âge > 10 ans';
                            }
                        }
                        break;
                    case 'ria':
                        isConforme = isRIAConforme(material);
                        break;
                    case 'baes':
                        isConforme = isBAESConforme(material);
                        break;
                    case 'alarme':
                        isConforme = isAlarmeConforme(material);
                        break;
                }
                
                if (!isConforme && conformiteText === 'CONFORME') {
                    conformiteText = 'NON CONFORME';
                    conformiteColor = [220, 53, 69];
                }
                
                // Vérifier les observations
                if (material.observations && material.observations.toLowerCase().includes('non conforme')) {
                    isConforme = false;
                    conformiteText = 'NON CONFORME';
                    conformiteColor = [220, 53, 69];
                    if (!raisonNonConforme) raisonNonConforme = 'Observations';
                }
                
                // Ligne de données
                const rowData = [
                    material.id || material.numero || 'N/A',
                    material.localisation || material.location || 'Non spécifié',
                    material.typeExtincteur || material.typeRIA || material.typeBAES || material.typeAlarme || '',
                    material.annee || '',
                    formatDate(material.dateVerification),
                    conformiteText
                ];
                
                // Alterner les couleurs de fond
                if (index % 2 === 0) {
                    doc.setFillColor(248, 249, 250);
                    doc.rect(margin, currentY, contentWidth, 7, 'F');
                }
                
                // Écrire les données
                xPos = margin;
                rowData.forEach((data, i) => {
                    const textColor = i === 5 ? conformiteColor : [0, 0, 0];
                    addText(data.toString(), xPos + 2, currentY + 4.5, 8, i === 5 ? 'bold' : 'normal', 'left', textColor);
                    xPos += colWidths[i];
                });
                
                currentY += 7;
            });
            
            currentY += 10;
        });
        
        // ============== OBSERVATIONS ET RECOMMANDATIONS ==============
        if (currentY > pageHeight - 100) {
            doc.addPage();
            currentY = margin;
        }
        
        addText('OBSERVATIONS ET RECOMMANDATIONS', margin, currentY, 14, 'bold', 'left', [26, 54, 93]);
        currentY += 8;
        
        if (totalNonConforme > 0) {
            addText(`⚠️ ${totalNonConforme} matériel(s) nécessite(nt) une attention particulière.`, margin, currentY, 11, 'bold', 'left', [220, 53, 69]);
            currentY += 6;
            
            // Lister les matériels non conformes
            Object.entries(nonConformesParType).forEach(([type, count]) => {
                const typeInfo = getMaterialInfo(type);
                addText(`• ${count} ${typeInfo.text.toLowerCase()}(s)`, margin + 10, currentY, 10);
                currentY += 5;
            });
            
            currentY += 5;
            addText('Recommandations:', margin, currentY, 11, 'bold', 'left', [26, 54, 93]);
            currentY += 6;
            addText('1. Procéder au remplacement ou à la réparation des matériels non conformes', margin + 10, currentY, 10);
            currentY += 5;
            addText('2. Vérifier l\'accessibilité et la signalisation des équipements', margin + 10, currentY, 10);
            currentY += 5;
            addText('3. Mettre à jour le registre de sécurité incendie', margin + 10, currentY, 10);
            currentY += 5;
        } else {
            addText('✅ Tous les équipements vérifiés sont conformes aux normes en vigueur.', margin, currentY, 11, 'normal', 'left', [50, 168, 82]);
            currentY += 6;
            addText('Aucune intervention corrective n\'est nécessaire.', margin, currentY, 10);
            currentY += 5;
        }
        
        currentY += 10;
        
        // ============== VALIDITÉ ET SIGNATURES ==============
        // Nouvelle page pour les signatures
        doc.addPage();
        currentY = margin;
        
        addText('VALIDATION DU RAPPORT', margin, currentY, 16, 'bold', 'center', [26, 54, 93]);
        currentY += 20;
        
        // Validité
        addText('VALIDITÉ DU RAPPORT', margin, currentY, 12, 'bold', 'left', [26, 54, 93]);
        currentY += 7;
        addText(`Ce rapport est valable 12 mois à compter de la date de vérification.`, margin, currentY, 10);
        currentY += 5;
        addText(`Date de la prochaine vérification recommandée: ${getNextVerificationDate()}`, margin, currentY, 10);
        currentY += 15;
        
        // Signature technicien
        addText('LE TECHNICIEN', margin, currentY, 12, 'bold', 'left', [26, 54, 93]);
        currentY += 7;
        addText(technician, margin, currentY, 10);
        currentY += 15;
        
        // Ligne de signature
        addLine(currentY, [0, 0, 0]);
        addText('Signature et cachet', margin + 30, currentY + 5, 9, 'italic', 'left', [100, 100, 100]);
        currentY += 20;
        
        // Signature client
        addText('LE CLIENT', margin, currentY, 12, 'bold', 'left', [26, 54, 93]);
        currentY += 7;
        addText(client.name, margin, currentY, 10);
        currentY += 15;
        
        // Ligne de signature
        addLine(currentY, [0, 0, 0]);
        addText('Signature', margin + 30, currentY + 5, 9, 'italic', 'left', [100, 100, 100]);
        currentY += 20;
        
        // Note légale
        addText('NOTE LÉGALE', margin, currentY, 10, 'bold', 'left', [73, 80, 87]);
        currentY += 6;
        addText('Ce document certifie la vérification des équipements conformément à la norme APSAD R4.', margin, currentY, 9, 'italic', 'left', [108, 117, 125]);
        currentY += 4;
        addText('Toute reproduction ou modification non autorisée est interdite.', margin, currentY, 9, 'italic', 'left', [108, 117, 125]);
        
        // ============== SAUVEGARDE ==============
        const filename = `Rapport_${client.name.replace(/[^a-z0-9]/gi, '_')}_${new Date().toISOString().split('T')[0]}.pdf`;
        doc.save(filename);
        
        closeLoading();
        showSuccess('Rapport PDF généré avec succès !');
        
    } catch (error) {
        console.error('❌ Erreur génération rapport PDF:', error);
        closeLoading();
        showError('Erreur lors de la génération du rapport: ' + error.message);
    }
}

function getNextVerificationDate() {
    const nextYear = new Date();
    nextYear.setFullYear(nextYear.getFullYear() + 1);
    return formatDate(nextYear.toISOString());
}

function groupMaterialsByType(materials) {
    const grouped = {
        extincteur: [],
        ria: [],
        baes: [],
        alarme: []
    };
    
    materials.forEach(material => {
        if (grouped[material.type]) {
            grouped[material.type].push(material);
        }
    });
    
    return grouped;
}

// ==================== IMPORT/EXPORT ====================
class ImportExportManager {
    async exportAllData(silent = false) {
        try {
            const clients = await dbManager.getAll('clients');
            const interventions = await dbManager.getAll('interventions');
            const factures = await dbManager.getAll('factures');
            
            const exportData = {
                metadata: {
                    exportDate: new Date().toISOString(),
                    version: '2.0',
                    recordCounts: {
                        clients: clients.length,
                        interventions: interventions.length,
                        factures: factures.length
                    }
                },
                data: {
                    clients: clients,
                    interventions: interventions,
                    factures: factures
                }
            };
            
            const blob = new Blob([JSON.stringify(exportData, null, 2)], { 
                type: 'application/json' 
            });
            
            const url = URL.createObjectURL(blob);
            const timestamp = new Date().toISOString().split('T')[0].replace(/-/g, '');
            const filename = `firecheck_backup_${timestamp}_${Date.now()}.json`;
            
            await dbManager.save('settings', {
                id: `backup_${timestamp}`,
                data: exportData,
                timestamp: new Date().toISOString()
            });
            
            if (!silent) {
                this.downloadFile(url, filename);
            }
            
            this.cleanOldBackups();
            
            if (!silent) {
                showSuccess(`Backup créé: ${filename}`);
            }
            
            return exportData;
            
        } catch (error) {
            console.error('Erreur export:', error);
            if (!silent) {
                showError('Erreur lors de la création du backup');
            }
            throw error;
        }
    }
    
    async importData(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            
            reader.onload = async (event) => {
                try {
                    const importData = JSON.parse(event.target.result);
                    
                    if (!this.validateImportData(importData)) {
                        throw new Error('Format de fichier invalide');
                    }
                    
                    if (!confirm(this.getImportConfirmationMessage(importData))) {
                        reject(new Error('Import annulé'));
                        return;
                    }
                    
                    await this.createPreImportBackup();
                    await this.processImport(importData);
                    await this.reloadAppAfterImport();
                    
                    showSuccess('Import réussi !');
                    resolve();
                    
                } catch (error) {
                    console.error('Erreur import:', error);
                    showError(`Erreur import: ${error.message}`);
                    reject(error);
                }
            };
            
            reader.onerror = () => {
                reject(new Error('Erreur de lecture du fichier'));
            };
            
            reader.readAsText(file);
        });
    }
    
    validateImportData(data) {
        return data && data.metadata && data.data && Array.isArray(data.data.clients);
    }
    
    getImportConfirmationMessage(data) {
        const counts = data.metadata.recordCounts;
        return `Voulez-vous importer :
• ${counts.clients || 0} client(s)
• ${counts.interventions || 0} intervention(s)
• ${counts.factures || 0} facture(s)

⚠️ Cela écrasera vos données existantes.`;
    }
    
    async createPreImportBackup() {
        const backup = await this.exportAllData(true);
        await dbManager.save('settings', {
            id: 'pre_import_backup',
            data: backup,
            timestamp: new Date().toISOString()
        });
    }
    
    async processImport(importData) {
        await dbManager.clearStore('clients');
        await dbManager.clearStore('interventions');
        await dbManager.clearStore('factures');
        
        if (importData.data.clients.length > 0) {
            await dbManager.saveAll('clients', importData.data.clients);
        }
        
        if (importData.data.interventions.length > 0) {
            await dbManager.saveAll('interventions', importData.data.interventions);
        }
        
        if (importData.data.factures.length > 0) {
            await dbManager.saveAll('factures', importData.data.factures);
        }
        
        await dbManager.save('settings', {
            id: 'last_import',
            data: importData.metadata,
            timestamp: new Date().toISOString()
        });
    }
    
    async reloadAppAfterImport() {
        AppState.clients = await dbManager.getAll('clients');
        AppState.currentInterventions = await dbManager.getAll('interventions');
        AppState.currentClient = null;
        AppState.unsavedChanges = false;
        
        if (AppState.currentPage === 'clients') {
            displayClientsList();
        }
        
        updateClientInfoBadge();
    }
    
    downloadFile(url, filename) {
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        setTimeout(() => {
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        }, 100);
    }
    
    async cleanOldBackups() {
        const backups = await dbManager.getAll('settings');
        const backupKeys = backups
            .filter(item => item.id && item.id.startsWith('backup_'))
            .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
        
        if (backupKeys.length > 5) {
            for (let i = 5; i < backupKeys.length; i++) {
                await dbManager.delete('settings', backupKeys[i].id);
            }
        }
    }
}

// ==================== FONCTIONS DE RIA ====================
function addRIAToList() {
    if (!validateMaterialForm('ria')) {
        return;
    }
    
    const ria = createRIAObject();
    addMaterialToList(ria);
    closeModal('add-ria-modal');
    showSuccess('RIA ajouté avec succès');
}

function createRIAObject() {
    return {
        type: 'ria',
        id: getElementValue('ria-id'),
        localisation: getElementValue('ria-location'),
        typeRIA: getElementValue('ria-type'),
        diametre: getElementValue('ria-diametre'),
        longueur: getElementValue('ria-longueur'),
        pression: getElementValue('ria-pression'),
        dateControle: getElementValue('ria-date-controle'),
        prochainControle: getElementValue('ria-prochain-controle'),
        etatGeneral: getElementValue('ria-etat-general'),
        etatGeneralComment: getElementValue('ria-etat-general-comment'),
        lisibilite: getElementValue('ria-lisibilite'),
        panneau: getElementValue('ria-panneau'),
        accessibilite: getElementValue('ria-accessibilite'),
        observations: getElementValue('ria-observations'),
        interventionType: getElementValue('ria-intervention-type'),
        photos: [],
        verified: false,
        dateVerification: null
    };
}

function resetRIAForm() {
    const today = new Date().toISOString().split('T')[0];
    const nextYear = new Date(new Date().setFullYear(new Date().getFullYear() + 1)).toISOString().split('T')[0];
    
    setElementValue('ria-id', '');
    setElementValue('ria-location', '');
    setElementValue('ria-type', '');
    setElementValue('ria-diametre', '');
    setElementValue('ria-longueur', '');
    setElementValue('ria-pression', '');
    setElementValue('ria-observations', '');
    setElementValue('ria-etat-general-comment', '');
    setElementValue('ria-date-controle', today);
    setElementValue('ria-prochain-controle', nextYear);
    
    resetOkNokFields(['etat-general', 'lisibilite', 'panneau', 'accessibilite']);
    selectMaterialInterventionType('ria', 'verification');
    clearPhotoGallery('ria-photo-gallery');
    updateModalButton('add-ria-modal', 'Ajouter', addRIAToList);
}

// ==================== FONCTIONS DE BAES ====================
function addBAESToList() {
    if (!validateMaterialForm('baes')) {
        return;
    }
    
    const baes = createBAESObject();
    addMaterialToList(baes);
    closeModal('add-baes-modal');
    showSuccess('BAES ajouté avec succès');
}

function createBAESObject() {
    return {
        type: 'baes',
        id: getElementValue('baes-id'),
        localisation: getElementValue('baes-location'),
        typeBAES: getElementValue('baes-type'),
        puissance: getElementValue('baes-puissance'),
        autonomie: getElementValue('baes-autonomie'),
        dateControle: getElementValue('baes-date-controle'),
        prochainControle: getElementValue('baes-prochain-controle'),
        etatGeneral: getElementValue('baes-etat-general'),
        etatGeneralComment: getElementValue('baes-etat-general-comment'),
        fonctionnement: getElementValue('baes-fonctionnement'),
        chargeur: getElementValue('baes-chargeur'),
        accessibilite: getElementValue('baes-accessibilite'),
        observations: getElementValue('baes-observations'),
        interventionType: getElementValue('baes-intervention-type'),
        photos: [],
        verified: false,
        dateVerification: null
    };
}

function resetBAESForm() {
    const today = new Date().toISOString().split('T')[0];
    const nextYear = new Date(new Date().setFullYear(new Date().getFullYear() + 1)).toISOString().split('T')[0];
    
    setElementValue('baes-id', '');
    setElementValue('baes-location', '');
    setElementValue('baes-type', '');
    setElementValue('baes-puissance', '');
    setElementValue('baes-autonomie', '');
    setElementValue('baes-observations', '');
    setElementValue('baes-etat-general-comment', '');
    setElementValue('baes-date-controle', today);
    setElementValue('baes-prochain-controle', nextYear);
    
    resetOkNokFields(['etat-general', 'fonctionnement', 'chargeur', 'accessibilite']);
    selectMaterialInterventionType('baes', 'verification');
    clearPhotoGallery('baes-photo-gallery');
    updateModalButton('add-baes-modal', 'Ajouter', addBAESToList);
}

// ==================== FONCTIONS D'ALARME ====================
function addAlarmeToList() {
    if (!validateMaterialForm('alarme')) {
        return;
    }
    
    const alarme = createAlarmeObject();
    addMaterialToList(alarme);
    closeModal('add-alarme-modal');
    showSuccess('Alarme ajoutée avec succès');
}

function createAlarmeObject() {
    return {
        type: 'alarme',
        id: getElementValue('alarme-id'),
        localisation: getElementValue('alarme-location'),
        typeAlarme: getElementValue('alarme-type'),
        dateVerif: getElementValue('alarme-date-verif'),
        dateProchaine: getElementValue('alarme-date-prochaine'),
        annee: getElementValue('alarme-annee'),
        batterie: getCheckboxValue('alarme-batterie'),
        fonctionnement: getCheckboxValue('alarme-fonctionnement'),
        accessibilite: getCheckboxValue('alarme-accessibilite'),
        registreSecurite: getElementValue('registre-securite'),
        photos: AppState.currentAlarmePhotos,
        verified: false,
        dateVerification: null
    };
}

function resetAlarmeForm() {
    const today = new Date().toISOString().split('T')[0];
    const nextYear = new Date(new Date().setFullYear(new Date().getFullYear() + 1)).toISOString().split('T')[0];
    
    setElementValue('alarme-id', generateAlarmeId());
    setElementValue('alarme-location', '');
    setElementValue('alarme-type', '');
    setElementValue('alarme-date-verif', today);
    setElementValue('alarme-date-prochaine', nextYear);
    setElementValue('alarme-annee', new Date().getFullYear());
    setCheckboxValue('alarme-batterie', false);
    setCheckboxValue('alarme-fonctionnement', false);
    setCheckboxValue('alarme-accessibilite', false);
    setElementValue('registre-securite', '');
    
    AppState.currentAlarmePhotos = [];
    clearPhotoGallery('alarme-photo-gallery');
    updateModalButton('add-alarme-modal', 'Ajouter', addAlarmeToList);
}

// ==================== FONCTIONS DE GESTION DES PHOTOS ====================
function takePhoto(galleryId) {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        alert('La prise de photo n\'est pas supportée sur cet appareil');
        return;
    }
    
    navigator.mediaDevices.getUserMedia({ video: true })
        .then(function(stream) {
            const video = document.createElement('video');
            video.srcObject = stream;
            video.play();
            
            const canvas = document.createElement('canvas');
            const context = canvas.getContext('2d');
            
            setTimeout(() => {
                canvas.width = video.videoWidth;
                canvas.height = video.videoHeight;
                context.drawImage(video, 0, 0);
                
                const photoData = canvas.toDataURL('image/jpeg');
                addPhotoToGallery(galleryId, photoData);
                
                stream.getTracks().forEach(track => track.stop());
            }, 1000);
        })
        .catch(function(error) {
            console.error('Erreur prise photo:', error);
            alert('Impossible d\'accéder à la caméra');
        });
}

function addPhotoToGallery(galleryId, photoData) {
    const gallery = document.getElementById(galleryId);
    if (!gallery) return;
    
    const photoId = `photo_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const photoItem = document.createElement('div');
    photoItem.className = 'photo-item';
    photoItem.innerHTML = `
        <img src="${photoData}" alt="Photo">
        <button class="btn btn-sm btn-danger" onclick="removePhoto('${photoId}')">
            <i class="fas fa-times"></i>
        </button>
    `;
    photoItem.id = photoId;
    
    gallery.appendChild(photoItem);
    
    // Stocker les photos d'alarme dans AppState
    if (galleryId === 'alarme-photo-gallery') {
        AppState.currentAlarmePhotos.push(photoData);
    }
}

function removePhoto(photoId) {
    const photoElement = document.getElementById(photoId);
    if (photoElement) {
        photoElement.remove();
    }
}

// ==================== FONCTIONS MANQUANTES POUR VÉRIFICATION ====================
function editMaterialForVerification(index) {
    if (!AppState.currentClient || !AppState.currentClient.materials || !AppState.currentClient.materials[index]) {
        showError("Matériel non trouvé");
        return;
    }
    
    const material = AppState.currentClient.materials[index];
    AppState.currentEditingMaterialIndex = index;
    
    switch(material.type) {
        case 'extincteur':
            editExtincteur(material);
            break;
        case 'ria':
            editRIA(material);
            break;
        case 'baes':
            editBAES(material);
            break;
        case 'alarme':
            editAlarme(material);
            break;
    }
}

function editExtincteur(material) {
    setFormValues({
        'extincteur-id': material.id,
        'extincteur-location': material.localisation,
        'extincteur-type': material.typeExtincteur,
        'extincteur-fabricant': material.fabricant,
        'extincteur-modele': material.modele,
        'extincteur-annee': material.annee,
        'extincteur-capacite': material.capacite,
        'extincteur-date-controle': material.dateControle,
        'extincteur-prochain-controle': material.prochainControle,
        'extincteur-etat-general': material.etatGeneral,
        'extincteur-etat-general-comment': material.etatGeneralComment,
        'extincteur-lisibilite': material.lisibilite,
        'extincteur-panneau': material.panneau,
        'extincteur-goupille': material.goupille,
        'extincteur-pression': material.pression,
        'extincteur-pesee': material.pesee,
        'extincteur-joints': material.joints,
        'extincteur-accessibilite': material.accessibilite,
        'extincteur-observations': material.observations,
        'extincteur-scelle': material.scelle,
        'extincteur-remplacement-joint': material.remplacementJoint,
        'extincteur-intervention-type': material.interventionType
    });
    
    if (material.interventions) {
        setCheckboxValue('extincteur-maa', material.interventions.maa);
        setCheckboxValue('extincteur-eiee', material.interventions.eiee);
        setCheckboxValue('extincteur-recharge', material.interventions.recharge);
    }
    
    updateModalButton('add-extincteur-modal', 'Mettre à jour', updateExtincteur);
    showModal('add-extincteur-modal');
}

function updateExtincteur() {
    if (AppState.currentEditingMaterialIndex === -1) return;
    
    const updatedExtincteur = createExtincteurObject();
    AppState.currentClient.materials[AppState.currentEditingMaterialIndex] = updatedExtincteur;
    
    saveCurrentClientChanges();
    closeModal('add-extincteur-modal');
    displayVerificationList();
    showSuccess('Extincteur mis à jour avec succès');
}

function editRIA(material) {
    setFormValues({
        'ria-id': material.id,
        'ria-location': material.localisation,
        'ria-type': material.typeRIA,
        'ria-diametre': material.diametre,
        'ria-longueur': material.longueur,
        'ria-pression': material.pression,
        'ria-date-controle': material.dateControle,
        'ria-prochainControle': material.prochainControle,
        'ria-etat-general': material.etatGeneral,
        'ria-etat-general-comment': material.etatGeneralComment,
        'ria-lisibilite': material.lisibilite,
        'ria-panneau': material.panneau,
        'ria-accessibilite': material.accessibilite,
        'ria-observations': material.observations,
        'ria-intervention-type': material.interventionType
    });
    
    updateModalButton('add-ria-modal', 'Mettre à jour', updateRIA);
    showModal('add-ria-modal');
}

function updateRIA() {
    if (AppState.currentEditingMaterialIndex === -1) return;
    
    const updatedRIA = createRIAObject();
    AppState.currentClient.materials[AppState.currentEditingMaterialIndex] = updatedRIA;
    
    saveCurrentClientChanges();
    closeModal('add-ria-modal');
    displayVerificationList();
    showSuccess('RIA mis à jour avec succès');
}

function editBAES(material) {
    setFormValues({
        'baes-id': material.id,
        'baes-location': material.localisation,
        'baes-type': material.typeBAES,
        'baes-puissance': material.puissance,
        'baes-autonomie': material.autonomie,
        'baes-date-controle': material.dateControle,
        'baes-prochainControle': material.prochainControle,
        'baes-etat-general': material.etatGeneral,
        'baes-etat-general-comment': material.etatGeneralComment,
        'baes-fonctionnement': material.fonctionnement,
        'baes-chargeur': material.chargeur,
        'baes-accessibilite': material.accessibilite,
        'baes-observations': material.observations,
        'baes-intervention-type': material.interventionType
    });
    
    updateModalButton('add-baes-modal', 'Mettre à jour', updateBAES);
    showModal('add-baes-modal');
}

function updateBAES() {
    if (AppState.currentEditingMaterialIndex === -1) return;
    
    const updatedBAES = createBAESObject();
    AppState.currentClient.materials[AppState.currentEditingMaterialIndex] = updatedBAES;
    
    saveCurrentClientChanges();
    closeModal('add-baes-modal');
    displayVerificationList();
    showSuccess('BAES mis à jour avec succès');
}

function editAlarme(material) {
    setFormValues({
        'alarme-id': material.id,
        'alarme-location': material.localisation,
        'alarme-type': material.typeAlarme,
        'alarme-date-verif': material.dateVerif,
        'alarme-date-prochaine': material.dateProchaine,
        'alarme-annee': material.annee,
        'registre-securite': material.registreSecurite
    });
    
    setCheckboxValue('alarme-batterie', material.batterie);
    setCheckboxValue('alarme-fonctionnement', material.fonctionnement);
    setCheckboxValue('alarme-accessibilite', material.accessibilite);
    
    AppState.currentAlarmePhotos = material.photos || [];
    displayAlarmePhotos();
    
    updateModalButton('add-alarme-modal', 'Mettre à jour', updateAlarme);
    showModal('add-alarme-modal');
}

function updateAlarme() {
    if (AppState.currentEditingMaterialIndex === -1) return;
    
    const updatedAlarme = createAlarmeObject();
    AppState.currentClient.materials[AppState.currentEditingMaterialIndex] = updatedAlarme;
    
    saveCurrentClientChanges();
    closeModal('add-alarme-modal');
    displayVerificationList();
    showSuccess('Alarme mise à jour avec succès');
}

function displayAlarmePhotos() {
    const gallery = document.getElementById('alarme-photo-gallery');
    if (!gallery) return;
    
    gallery.innerHTML = '';
    AppState.currentAlarmePhotos.forEach((photoData, index) => {
        const photoId = `alarme_photo_${index}`;
        const photoItem = document.createElement('div');
        photoItem.className = 'photo-item';
        photoItem.innerHTML = `
            <img src="${photoData}" alt="Photo alarme">
            <button class="btn btn-sm btn-danger" onclick="removeAlarmePhoto(${index})">
                <i class="fas fa-times"></i>
            </button>
        `;
        photoItem.id = photoId;
        gallery.appendChild(photoItem);
    });
}

function removeAlarmePhoto(index) {
    AppState.currentAlarmePhotos.splice(index, 1);
    displayAlarmePhotos();
}

// ==================== SAUVEGARDE AUTOMATIQUE ET ENREGISTREMENT ====================
function saveFacture() {
    if (!AppState.currentClient) {
        showError('Veuillez d\'abord sélectionner un client');
        return;
    }
    
    if (AppState.factureItems.length === 0 && AppState.fraisDeplacement === 0) {
        showError('Aucun article dans la facture');
        return;
    }
    
    const totalHT = AppState.factureItems.reduce((sum, item) => sum + item.total, 0) + AppState.fraisDeplacement;
    const tva = totalHT * 0.20;
    const totalTTC = totalHT + tva;
    
    const facture = {
        id: AppState.factureNumero,
        numero: AppState.factureNumero,
        clientId: AppState.currentClient.id,
        clientName: AppState.currentClient.name,
        date: new Date().toISOString().split('T')[0],
        items: AppState.factureItems,
        fraisDeplacement: AppState.fraisDeplacement,
        totalHT: totalHT,
        tva: tva,
        totalTTC: totalTTC,
        signatureClient: clientSignaturePad ? clientSignaturePad.toDataURL() : null,
        signatureTechnicien: technicianSignaturePad ? technicianSignaturePad.toDataURL() : null,
        created: new Date().toISOString()
    };
    
    dbManager.save('factures', facture).then(() => {
        showSuccess('Facture enregistrée avec succès !');
        resetFactureForm();
    }).catch(error => {
        console.error('Erreur enregistrement facture:', error);
        showError('Erreur lors de l\'enregistrement de la facture');
    });
}

function resetFactureForm() {
    AppState.factureItems = [];
    AppState.fraisDeplacement = 0;
    generateFactureNumber();
    
    updateFactureItemsList();
    updateFactureTotal();
    
    if (clientSignaturePad) clientSignaturePad.clear();
    if (technicianSignaturePad) technicianSignaturePad.clear();
    
    const fraisCheckbox = document.getElementById('frais-deplacement');
    if (fraisCheckbox) fraisCheckbox.checked = false;
    
    const montantInput = document.getElementById('frais-deplacement-montant');
    if (montantInput) montantInput.value = '0';
}

// ==================== GESTION AUTOMATIQUE DU NETTOYAGE ====================
setInterval(() => {
    const usage = new DatabaseManager().getLocalStorageUsage();
    if (usage > 3 * 1024 * 1024) {
        console.log('⏰ Nettoyage périodique du localStorage...');
        new DatabaseManager().cleanupLocalStorage();
    }
}, 3600000);

window.addEventListener('load', () => {
    setTimeout(() => {
        const usage = new DatabaseManager().getLocalStorageUsage();
        if (usage > 4 * 1024 * 1024) {
            console.log('🚀 Nettoyage au démarrage...');
            new DatabaseManager().cleanupLocalStorage();
        }
    }, 5000);
});

// ==================== PRÉVISUALISATIONS ====================
function previewReport() {
    if (!AppState.currentClient) {
        showError('Veuillez d\'abord sélectionner un client');
        return;
    }
    
    const materials = AppState.currentClient.materials.filter(m => m.verified);
    if (materials.length === 0) {
        showError('Aucun matériel vérifié à afficher dans le rapport');
        return;
    }
    
    const verifiedCount = materials.length;
    const today = new Date().toLocaleDateString('fr-FR');
    const technician = getElementValue('technician-name') || 'Technicien';
    const registreSecurite = getElementValue('registre-securite');
    
    const materialsByType = groupMaterialsByType(materials);
    
    // Calculer les statistiques de conformité
    let totalConforme = 0;
    let totalNonConforme = 0;
    
    Object.values(materialsByType).forEach(items => {
        items.forEach(material => {
            let isConforme = true;
            switch(material.type) {
                case 'extincteur':
                    isConforme = isExtincteurConforme(material);
                    break;
                case 'ria':
                    isConforme = isRIAConforme(material);
                    break;
                case 'baes':
                    isConforme = isBAESConforme(material);
                    break;
                case 'alarme':
                    isConforme = isAlarmeConforme(material);
                    break;
            }
            
            if (isConforme) {
                totalConforme++;
            } else {
                totalNonConforme++;
            }
        });
    });
    
    const previewHTML = `
        <div class="pdf-container" style="max-width: 800px; margin: 0 auto; padding: 20px; font-family: Arial, sans-serif;">
            <div class="pdf-header" style="border-bottom: 3px solid #1a365d; padding-bottom: 15px; margin-bottom: 20px;">
                <div class="header-left" style="text-align: center;">
                    <h1 style="color: #1a365d; margin: 0; font-size: 28px;">PRÉVISUALISATION DU RAPPORT</h1>
                    <h2 style="color: #2c5282; margin: 10px 0 0 0; font-size: 18px;">Vérification Annuelle des Équipements de Sécurité Incendie</h2>
                </div>
                <div class="header-right" style="display: flex; justify-content: space-between; margin-top: 15px; font-size: 14px;">
                    <div>
                        <p><strong>Date:</strong> ${today}</p>
                        <p><strong>Référence:</strong> RAP-${new Date().getFullYear()}-${AppState.currentClient.id?.substr(0, 8) || '000000'}</p>
                    </div>
                </div>
            </div>
            
            <div class="client-info" style="background: #f7fafc; padding: 15px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #2c5282;">
                <h3 style="color: #1a365d; margin-top: 0; font-size: 18px;">INFORMATIONS CLIENT</h3>
                <p><strong>Nom:</strong> ${escapeHtml(AppState.currentClient.name)}</p>
                <p><strong>Contact:</strong> ${escapeHtml(AppState.currentClient.contact)}</p>
                <p><strong>Adresse:</strong> ${escapeHtml(AppState.currentClient.address)}</p>
                <p><strong>Technicien:</strong> ${escapeHtml(technician)}</p>
                ${registreSecurite ? `
                    <p><strong>Registre de sécurité:</strong> 
                        ${registreSecurite === 'oui' ? '✅ Signé et conforme' : 
                          registreSecurite === 'non' ? '❌ Non signé' : '⚠️ Indisponible'}
                    </p>
                ` : ''}
            </div>
            
            <div class="conformite-summary" style="background: ${totalNonConforme === 0 ? '#d4edda' : '#fff3cd'}; padding: 15px; border-radius: 8px; margin: 20px 0; border: 2px solid ${totalNonConforme === 0 ? '#c3e6cb' : '#ffeaa7'};">
                <h3 style="color: ${totalNonConforme === 0 ? '#155724' : '#856404'}; margin: 0; font-size: 20px;">
                    ${totalNonConforme === 0 ? '✅ ÉTAT CONFORME' : '⚠️ ÉTAT NON CONFORME'}
                </h3>
                <p style="color: ${totalNonConforme === 0 ? '#155724' : '#856404'}; margin: 10px 0 0 0; font-size: 16px;">
                    ${totalNonConforme === 0 
                        ? `Tous les ${materials.length} matériels vérifiés sont conformes`
                        : `${totalNonConforme} matériel(s) non conforme(s) sur ${materials.length}`}
                </p>
            </div>
            
            <div class="summary" style="background: #e8f4fd; padding: 15px; border-radius: 8px; margin: 20px 0; border: 1px solid #b3d7ff;">
                <h3 style="color: #1a365d; margin-top: 0; font-size: 18px;">SYNTHÈSE DES VÉRIFICATIONS</h3>
                <div style="display: flex; justify-content: space-around; text-align: center; margin-top: 15px;">
                    <div style="flex: 1;">
                        <div style="font-size: 2em; font-weight: bold; color: #1a365d;">${materials.length}</div>
                        <div>Matériels vérifiés</div>
                    </div>
                    <div style="flex: 1;">
                        <div style="font-size: 2em; font-weight: bold; color: #28a745;">${totalConforme}</div>
                        <div>Conformes</div>
                    </div>
                    <div style="flex: 1;">
                        <div style="font-size: 2em; font-weight: bold; color: #dc3545;">${totalNonConforme}</div>
                        <div>Non conformes</div>
                    </div>
                </div>
            </div>
            
            ${Object.entries(materialsByType).map(([type, items]) => 
                items.length > 0 ? `
                <div style="margin: 20px 0;">
                    <h3 style="color: #1a365d; border-bottom: 2px solid #e2e8f0; padding-bottom: 5px; font-size: 16px;">
                        ${getMaterialInfo(type).text.toUpperCase()}
                    </h3>
                    <table style="width: 100%; border-collapse: collapse; margin: 10px 0; font-size: 12px;">
                        <thead>
                            <tr style="background: #1a365d; color: white;">
                                <th style="padding: 8px; text-align: left; border: 1px solid #ddd;">ID</th>
                                <th style="padding: 8px; text-align: left; border: 1px solid #ddd;">Localisation</th>
                                <th style="padding: 8px; text-align: left; border: 1px solid #ddd;">Type/Modèle</th>
                                <th style="padding: 8px; text-align: left; border: 1px solid #ddd;">Année</th>
                                <th style="padding: 8px; text-align: left; border: 1px solid #ddd;">Date vérif.</th>
                                <th style="padding: 8px; text-align: left; border: 1px solid #ddd;">État</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${items.map(material => {
                                let isConforme = true;
                                let conformiteText = 'CONFORME';
                                let conformiteColor = '#28a745';
                                let observations = material.observations || '';
                                
                                switch(type) {
                                    case 'extincteur':
                                        isConforme = isExtincteurConforme(material);
                                        if (material.annee) {
                                            const age = new Date().getFullYear() - parseInt(material.annee);
                                            if (age >= 10) {
                                                isConforme = false;
                                                conformiteText = 'NON CONFORME (âge > 10 ans)';
                                                conformiteColor = '#dc3545';
                                            }
                                        }
                                        break;
                                    case 'ria':
                                        isConforme = isRIAConforme(material);
                                        break;
                                    case 'baes':
                                        isConforme = isBAESConforme(material);
                                        break;
                                    case 'alarme':
                                        isConforme = isAlarmeConforme(material);
                                        break;
                                }
                                
                                if (!isConforme && conformiteText === 'CONFORME') {
                                    conformiteText = 'NON CONFORME';
                                    conformiteColor = '#dc3545';
                                }
                                
                                if (observations.toLowerCase().includes('non conforme')) {
                                    conformiteText = 'NON CONFORME (observations)';
                                    conformiteColor = '#dc3545';
                                }
                                
                                return `
                                    <tr style="border-bottom: 1px solid #e2e8f0;">
                                        <td style="padding: 8px; border: 1px solid #ddd;"><strong>${material.id || material.numero}</strong></td>
                                        <td style="padding: 8px; border: 1px solid #ddd;">${material.localisation || material.location || 'Non spécifié'}</td>
                                        <td style="padding: 8px; border: 1px solid #ddd;">${material.typeExtincteur || material.typeRIA || material.typeBAES || material.typeAlarme || ''}</td>
                                        <td style="padding: 8px; border: 1px solid #ddd;">${material.annee || ''}</td>
                                        <td style="padding: 8px; border: 1px solid #ddd;">${formatDate(material.dateVerification)}</td>
                                        <td style="padding: 8px; border: 1px solid #ddd;">
                                            <span style="background: ${conformiteColor}; color: white; padding: 2px 6px; border-radius: 3px; font-size: 11px;">
                                                ${conformiteText}
                                            </span>
                                        </td>
                                    </tr>
                                `;
                            }).join('')}
                        </tbody>
                    </table>
                </div>
                ` : ''
            ).join('')}
            
            <div style="margin-top: 30px; padding: 20px; background: #f8f9fa; border-radius: 8px; border: 1px solid #dee2e6;">
                <h3 style="color: #1a365d; margin-top: 0; font-size: 16px;">VALIDITÉ</h3>
                <p>Ce rapport est valable 12 mois à compter de la date de vérification.</p>
                <p><strong>Date de la prochaine vérification recommandée:</strong> ${getNextVerificationDate()}</p>
            </div>
        </div>
    `;
    
    const modal = document.getElementById('preview-modal');
    const content = document.getElementById('preview-content');
    
    if (!modal || !content) {
        showError('Modal de prévisualisation non trouvé');
        return;
    }
    
    content.innerHTML = previewHTML;
    modal.classList.add('active');
    document.body.style.overflow = 'hidden';
}

function previewFacture() {
    if (!AppState.currentClient) {
        showError('Veuillez d\'abord sélectionner un client');
        return;
    }
    
    if (AppState.factureItems.length === 0 && AppState.fraisDeplacement === 0) {
        showError('Aucun article dans la facture');
        return;
    }
    
const modal = document.getElementById('facture-modal');
const content = document.getElementById('facture-content');
    
    if (!modal || !content) {
        showError('Modal de prévisualisation non trouvé');
        return;
    }
    
    const totalHT = AppState.factureItems.reduce((sum, item) => sum + item.total, 0) + AppState.fraisDeplacement;
    const tva = totalHT * 0.20;
    const totalTTC = totalHT + tva;
    
    const previewHTML = `
        <div class="pdf-container" style="max-width: 800px; margin: 0 auto; padding: 20px; font-family: Arial, sans-serif;">
            <div class="header" style="border-bottom: 3px solid #dc3545; padding-bottom: 15px; margin-bottom: 20px;">
                <div style="display: flex; justify-content: space-between; align-items: flex-start;">
                    <div>
                        <h1 style="color: #dc3545; margin: 0; font-size: 28px;">FACTURE</h1>
                        <p style="font-size: 16px; margin: 5px 0;"><strong>${AppState.factureNumero}</strong></p>
                    </div>
                    <div style="text-align: right;">
                        <p><strong>Date:</strong> ${formatDate(new Date().toISOString())}</p>
                    </div>
                </div>
            </div>
            
            <div style="display: flex; justify-content: space-between; margin-bottom: 30px;">
                <div style="width: 48%;">
                    <h3 style="color: #495057; margin-top: 0; font-size: 16px;">VOTRE ENTREPRISE</h3>
                    <p>Adresse de votre entreprise</p>
                    <p>Tél: 01 23 45 67 89</p>
                    <p>Email: contact@votreentreprise.com</p>
                    <p>SIRET: 123 456 789 00000</p>
                </div>
                
                <div style="width: 48%;">
                    <h3 style="color: #495057; margin-top: 0; font-size: 16px;">CLIENT</h3>
                    <p><strong>${escapeHtml(AppState.currentClient.name)}</strong></p>
                    <p>${escapeHtml(AppState.currentClient.contact)}</p>
                    <p>${escapeHtml(AppState.currentClient.address)}</p>
                    ${AppState.currentClient.email ? `<p>Email: ${escapeHtml(AppState.currentClient.email)}</p>` : ''}
                    ${AppState.currentClient.phone ? `<p>Tél: ${escapeHtml(AppState.currentClient.phone)}</p>` : ''}
                </div>
            </div>
            
            <table style="width: 100%; border-collapse: collapse; margin: 20px 0; font-size: 12px;">
                <thead>
                    <tr style="background: #dc3545; color: white;">
                        <th style="padding: 10px; text-align: left; border: 1px solid #ddd;">Description</th>
                        <th style="padding: 10px; text-align: center; border: 1px solid #ddd;">Qté</th>
                        <th style="padding: 10px; text-align: right; border: 1px solid #ddd;">Prix unitaire HT</th>
                        <th style="padding: 10px; text-align: right; border: 1px solid #ddd;">Total HT</th>
                    </tr>
                </thead>
                <tbody>
                    ${AppState.factureItems.map(item => `
                        <tr style="border-bottom: 1px solid #dee2e6;">
                            <td style="padding: 8px; border: 1px solid #ddd;">${escapeHtml(item.description)}</td>
                            <td style="padding: 8px; text-align: center; border: 1px solid #ddd;">${item.quantity}</td>
                            <td style="padding: 8px; text-align: right; border: 1px solid #ddd;">${item.price.toFixed(2)} €</td>
                            <td style="padding: 8px; text-align: right; border: 1px solid #ddd;">${item.total.toFixed(2)} €</td>
                        </tr>
                    `).join('')}
                    
                    ${AppState.fraisDeplacement > 0 ? `
                        <tr style="border-bottom: 1px solid #dee2e6;">
                            <td style="padding: 8px; border: 1px solid #ddd;">Frais de déplacement</td>
                            <td style="padding: 8px; text-align: center; border: 1px solid #ddd;">1</td>
                            <td style="padding: 8px; text-align: right; border: 1px solid #ddd;">${AppState.fraisDeplacement.toFixed(2)} €</td>
                            <td style="padding: 8px; text-align: right; border: 1px solid #ddd;">${AppState.fraisDeplacement.toFixed(2)} €</td>
                        </tr>
                    ` : ''}
                    
                    <tr style="background: #f8f9fa; font-weight: bold;">
                        <td colspan="3" style="padding: 10px; text-align: right; border: 1px solid #ddd;">Total HT</td>
                        <td style="padding: 10px; text-align: right; border: 1px solid #ddd;">${totalHT.toFixed(2)} €</td>
                    </tr>
                    <tr>
                        <td colspan="3" style="padding: 8px; text-align: right; border: 1px solid #ddd;">TVA (20%)</td>
                        <td style="padding: 8px; text-align: right; border: 1px solid #ddd;">${tva.toFixed(2)} €</td>
                    </tr>
                    <tr style="background: #f8f9fa; font-weight: bold;">
                        <td colspan="3" style="padding: 10px; text-align: right; border: 1px solid #ddd;">Total TTC</td>
                        <td style="padding: 10px; text-align: right; border: 1px solid #ddd;">${totalTTC.toFixed(2)} €</td>
                    </tr>
                </tbody>
            </table>
            
            <div style="margin-top: 30px; padding: 15px; background: #f8f9fa; border-radius: 5px; border: 1px solid #dee2e6;">
                <h4 style="color: #495057; margin-top: 0; font-size: 14px;">Notes:</h4>
                <p>Paiement à réception de facture. En cas de retard, pénalité de 1,5% par mois.</p>
                <p><strong>Mode de règlement:</strong> Virement bancaire</p>
                <p><strong>IBAN:</strong> FR76 3000 1000 1234 5678 9012 345</p>
            </div>
            
            <div style="margin-top: 50px; text-align: center; border-top: 2px dashed #ccc; padding-top: 20px;">
                <p>Fait pour valoir et servir que de droit</p>
                <div style="width: 200px; border-top: 1px solid #333; margin: 20px auto 8px auto;"></div>
                <p>Le ${formatDate(new Date().toISOString())}</p>
            </div>
        </div>
    `;
    
    content.innerHTML = previewHTML;
    modal.classList.add('active');
    document.body.style.overflow = 'hidden';
}

// ==================== GÉNÉRATION FACTURE PDF ====================
async function generateFacturePDF() {
    console.log('🧾 Génération du PDF de facture avec jsPDF...');
    
    if (!AppState.currentClient) {
        showError('Veuillez d\'abord sélectionner un client');
        return;
    }
    
    if (AppState.factureItems.length === 0 && AppState.fraisDeplacement === 0) {
        showError('Aucun article dans la facture');
        return;
    }
    
    showLoading('Génération de la facture en PDF...');
    
    try {
        await ensureJSPDF();
        
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF({
            orientation: 'portrait',
            unit: 'mm',
            format: 'a4'
        });
        
        // Configurations
        const margin = 15;
        const pageWidth = doc.internal.pageSize.getWidth();
        const pageHeight = doc.internal.pageSize.getHeight();
        const contentWidth = pageWidth - (2 * margin);
        
        // Variables de position
        let currentY = margin;
        
        // Fonctions utilitaires simplifiées
        const addText = (text, x, y, fontSize = 10, style = 'normal', align = 'left', color = [0, 0, 0]) => {
            doc.setFontSize(fontSize);
            doc.setFont('helvetica', style);
            doc.setTextColor(color[0], color[1], color[2]);
            doc.text(text, x, y, { align: align });
        };
        
        const addLine = (y, color = [200, 200, 200], width = 1) => {
            doc.setDrawColor(color[0], color[1], color[2]);
            doc.setLineWidth(width);
            doc.line(margin, y, pageWidth - margin, y);
        };
        
        // Calcul des totaux
        const totalHT = AppState.factureItems.reduce((sum, item) => sum + item.total, 0) + AppState.fraisDeplacement;
        const tva = totalHT * 0.20;
        const totalTTC = totalHT + tva;
        const today = new Date().toLocaleDateString('fr-FR');
        
        // En-tête
        addText('FACTURE', margin, currentY, 20, 'bold', 'left', [220, 53, 69]);
        currentY += 10;
        
        addText(AppState.factureNumero, margin, currentY, 14, 'bold', 'left', [220, 53, 69]);
        addText(`Date: ${today}`, pageWidth - margin, currentY, 10, 'normal', 'right');
        currentY += 8;
        
        addLine(currentY, [220, 53, 69], 1);
        currentY += 10;
        
        // Informations entreprise
        addText('VOTRE ENTREPRISE', margin, currentY, 12, 'bold', 'left', [73, 80, 87]);
        currentY += 7;
        addText('Adresse de votre entreprise', margin, currentY, 10);
        currentY += 5;
        addText('Tél: 01 23 45 67 89', margin, currentY, 10);
        currentY += 5;
        addText('Email: contact@votreentreprise.com', margin, currentY, 10);
        currentY += 5;
        addText('SIRET: 123 456 789 00000', margin, currentY, 10);
        currentY += 10;
        
        // Informations client
        addText('CLIENT', margin + contentWidth/2, currentY - 25, 12, 'bold', 'left', [73, 80, 87]);
        const client = AppState.currentClient;
        addText(client.name, margin + contentWidth/2, currentY - 18, 10, 'bold');
        addText(client.contact, margin + contentWidth/2, currentY - 13, 10);
        addText(client.address, margin + contentWidth/2, currentY - 8, 10);
        
        if (client.email) {
            addText(`Email: ${client.email}`, margin + contentWidth/2, currentY - 3, 10);
        }
        if (client.phone) {
            addText(`Tél: ${client.phone}`, margin + contentWidth/2, currentY + 2, 10);
        }
        
        currentY += 10;
        
        // Tableau des articles
        addText('DÉTAIL DES ARTICLES', margin, currentY, 12, 'bold', 'left', [73, 80, 87]);
        currentY += 7;
        
        // En-têtes du tableau
        const headers = ['Description', 'Qté', 'Prix HT', 'Total HT'];
        const colWidths = [80, 20, 30, 30];
        
        // CORRECTION : Dessiner les en-têtes SANS rectangle de fond noir
        doc.setFillColor(220, 53, 69); // Rouge pour le fond
        doc.setTextColor(255, 255, 255);
        doc.setFont('helvetica', 'bold');
        
        let xPos = margin;
        headers.forEach((header, i) => {
            // Dessiner le rectangle avec couleur rouge
            doc.rect(xPos, currentY, colWidths[i], 8, 'F');
            // Ajouter le texte
            doc.text(header, xPos + colWidths[i]/2, currentY + 5, { align: 'center' });
            xPos += colWidths[i];
        });
        
        currentY += 8;
        doc.setTextColor(0, 0, 0);
        doc.setFont('helvetica', 'normal');
        
        // Articles
        AppState.factureItems.forEach((item, index) => {
            // Vérifier si on dépasse la page
            if (currentY > pageHeight - 50) {
                doc.addPage();
                currentY = margin;
                // Redessiner les en-têtes si nouvelle page
                doc.setFillColor(220, 53, 69);
                doc.setTextColor(255, 255, 255);
                doc.setFont('helvetica', 'bold');
                
                xPos = margin;
                headers.forEach((header, i) => {
                    doc.rect(xPos, currentY, colWidths[i], 8, 'F');
                    doc.text(header, xPos + colWidths[i]/2, currentY + 5, { align: 'center' });
                    xPos += colWidths[i];
                });
                
                currentY += 8;
                doc.setTextColor(0, 0, 0);
                doc.setFont('helvetica', 'normal');
            }
            
            // Ligne de données
            const rowData = [
                item.description.substring(0, 40),
                item.quantity.toString(),
                `${item.price.toFixed(2)} €`,
                `${item.total.toFixed(2)} €`
            ];
            
            // Alterner les couleurs de fond pour les lignes
            if (index % 2 === 0) {
                doc.setFillColor(248, 249, 250); // Gris très clair
                doc.rect(margin, currentY, contentWidth, 7, 'F');
            }
            
            xPos = margin;
            rowData.forEach((data, i) => {
                const align = i === 1 ? 'center' : i >= 2 ? 'right' : 'left';
                doc.setTextColor(0, 0, 0);
                doc.text(data, xPos + (i === 0 ? 2 : colWidths[i]/2), currentY + 4.5, { align: align });
                xPos += colWidths[i];
            });
            
            currentY += 7;
        });
        
        // Frais de déplacement
        if (AppState.fraisDeplacement > 0) {
            const rowData = [
                'Frais de déplacement',
                '1',
                `${AppState.fraisDeplacement.toFixed(2)} €`,
                `${AppState.fraisDeplacement.toFixed(2)} €`
            ];
            
            if (currentY > pageHeight - 50) {
                doc.addPage();
                currentY = margin;
            }
            
            xPos = margin;
            rowData.forEach((data, i) => {
                const align = i === 1 ? 'center' : i >= 2 ? 'right' : 'left';
                doc.text(data, xPos + (i === 0 ? 2 : colWidths[i]/2), currentY + 4.5, { align: align });
                xPos += colWidths[i];
            });
            
            currentY += 7;
        }
        
        currentY += 10;
        
        // Totaux - CORRECTION : Supprimer le rectangle qui causait le carré noir
        const totals = [
            { label: 'Total HT', value: totalHT.toFixed(2) + ' €' },
            { label: 'TVA (20%)', value: tva.toFixed(2) + ' €' },
            { label: 'Total TTC', value: totalTTC.toFixed(2) + ' €' }
        ];
        
        totals.forEach((total, index) => {
            const isTotal = index === totals.length - 1;
            
            // CORRECTION : Pas de doc.rect() ici pour éviter le carré noir
            if (isTotal) {
                doc.setTextColor(220, 53, 69); // Rouge pour le total
                doc.setFont('helvetica', 'bold');
            } else {
                doc.setTextColor(0, 0, 0);
                doc.setFont('helvetica', 'normal');
            }
            
            doc.text(total.label, margin + 100, currentY, { align: 'right' });
            doc.text(total.value, margin + 140, currentY, { align: 'right' });
            
            currentY += isTotal ? 8 : 6;
        });
        
        // Réinitialiser la couleur
        doc.setTextColor(0, 0, 0);
        doc.setFont('helvetica', 'normal');
        
        currentY += 15;
        
        // Informations de paiement
        addText('INFORMATIONS DE PAIEMENT', margin, currentY, 12, 'bold', 'left', [73, 80, 87]);
        currentY += 7;
        addText('Mode de règlement: Virement bancaire', margin, currentY, 10);
        currentY += 5;
        addText('IBAN: FR76 3000 1000 1234 5678 9012 345', margin, currentY, 10);
        currentY += 5;
        addText('Paiement à réception de facture', margin, currentY, 10);
        currentY += 5;
        addText('En cas de retard, pénalité de 1,5% par mois', margin, currentY, 10);
        
        currentY += 15;
        
        // Signature
        addText('Fait pour valoir et servir que de droit', margin, currentY, 10, 'italic');
        currentY += 10;
        
        addLine(currentY, [0, 0, 0]);
        addText(`Le ${today}`, margin, currentY + 5, 10);
        
        // Sauvegarder le PDF
        const filename = `Facture_${AppState.factureNumero.replace(/\//g, '_')}.pdf`;
        doc.save(filename);
        
        closeLoading();
        showSuccess('Facture générée en PDF avec succès !');
        
    } catch (error) {
        console.error('Erreur génération PDF facture:', error);
        closeLoading();
        showError('Erreur lors de la génération de la facture: ' + error.message);
    }
}

// ==================== ALIAS POUR LES FONCTIONS PDF ====================

// Ces fonctions sont des alias pour la compatibilité avec le HTML
function generatePDFFromPreview() {
    // Alias pour generatePDFReport
    generatePDFReport();
}

function generateFacturePDFFromPreview() {
    // Alias pour generateFacturePDF
    generateFacturePDF();
}

// Fonctions avec d'autres noms pour compatibilité
function generatePDF() {
    return generatePDFReport();
}

function generateFacture() {
    return generateFacturePDF();
}

function enregistrerFacturePDF() {
    return generateFacturePDF();
}

function genererPDFRapport() {
    return generatePDFReport();
}

// ==================== AJOUTER TOUTES LES FONCTIONS AU WINDOW ====================

// Exposer toutes les fonctions PDF
window.generatePDFReport = generatePDFReport;
window.generateFacturePDF = generateFacturePDF;
window.previewReport = previewReport;
window.previewFacture = previewFacture;
window.generatePDFFromPreview = generatePDFFromPreview;
window.generateFacturePDFFromPreview = generateFacturePDFFromPreview;
window.generatePDF = generatePDF;
window.generateFacture = generateFacture;
window.enregistrerFacturePDF = enregistrerFacturePDF;
window.genererPDFRapport = genererPDFRapport;

// Fonctions d'édition de matériels
window.addExtincteurToList = addExtincteurToList;
window.addRIAToList = addRIAToList;
window.addBAESToList = addBAESToList;
window.addAlarmeToList = addAlarmeToList;
window.updateExtincteur = updateExtincteur;
window.updateRIA = updateRIA;
window.updateBAES = updateBAES;
window.updateAlarme = updateAlarme;
window.editMaterialForVerification = editMaterialForVerification;
window.editExtincteur = editExtincteur;
window.editRIA = editRIA;
window.editBAES = editBAES;
window.editAlarme = editAlarme;
window.selectOkNok = selectOkNok;
window.selectRIANok = selectRIANok;
window.selectBAESNok = selectBAESNok;
window.selectExtincteurInterventionType = selectExtincteurInterventionType;
window.selectRIAInterventionType = selectRIAInterventionType;
window.selectBAESInterventionType = selectBAESInterventionType;
window.selectMaterialInterventionType = selectMaterialInterventionType;
window.selectRegistreSecurite = selectRegistreSecurite;
window.checkExtincteurAge = checkExtincteurAge;
window.generateExtincteurId = generateExtincteurId;
window.takePhoto = takePhoto;
window.addPhotoToGallery = addPhotoToGallery;
window.removePhoto = removePhoto;
window.removeAlarmePhoto = removeAlarmePhoto;
window.clearSignature = clearSignature;
window.undoSignature = undoSignature;
window.toggleFraisDeplacement = toggleFraisDeplacement;
window.addFactureItem = addFactureItem;
window.removeFactureItem = removeFactureItem;
window.updateFactureTotal = updateFactureTotal;
window.saveFacture = saveFacture;
window.closeExtincteurModal = closeExtincteurModal;
window.closeRIAModal = closeRIAModal;
window.closeBAESModal = closeBAESModal;
window.closeAlarmeModal = closeAlarmeModal;
window.closeInterventionModal = closeInterventionModal;
window.closePreview = closePreview;
window.closeFacture = closeFacture;
window.addIntervention = addIntervention;
window.saveIntervention = saveIntervention;
window.editIntervention = editIntervention;
window.deleteIntervention = deleteIntervention;
window.updateInterventionColor = updateInterventionColor;
window.changeMonth = changeMonth;
window.goToToday = goToToday;
window.goToVerificationFromPlanning = goToVerificationFromPlanning;
window.searchClients = searchClients;
window.searchHistory = searchHistory;
window.createClient = createClient;
window.deleteClient = deleteClient;
window.selectClient = selectClient;
window.openMaterialModal = openMaterialModal;
window.removeMaterial = removeMaterial;
window.removeMaterialFromVerification = removeMaterialFromVerification;
window.verifyMaterial = verifyMaterial;
window.unverifyMaterial = unverifyMaterial;
window.verifyAllInFamily = verifyAllInFamily;
window.toggleFamilyFilter = toggleFamilyFilter;
window.completeVerification = completeVerification;
window.viewClientHistory = viewClientHistory;
window.closeSuccessModal = closeSuccessModal;
window.closeErrorModal = closeErrorModal;
window.exportAllDataManual = exportAllDataManual;
window.createBackupNow = createBackupNow;
window.triggerImport = triggerImport;
window.showDataManagementModal = showDataManagementModal;
window.logoutUser = logoutUser;
window.saveClients = saveClients;
window.saveInterventions = saveInterventions;

console.log('🎉 Application FireCheck Pro initialisée avec rapport PDF optimisé !');
