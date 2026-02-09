// FireCheck Pro - Application PWA de vérification sécurité incendie
// Version optimisée avec système de vérification annuelle simplifié
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
            warning: [255, 193, 7],
            info: [13, 110, 253]
        }
    },
    responsiveBreakpoints: {
        mobile: 768,
        tablet: 1024
    },
    familyFilters: ['extincteur', 'ria', 'baes', 'alarme'],
    
    // Configurations IndexedDB
    indexedDB: {
        name: 'FireCheckProDB',
        version: 4,
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
        interval: 300000,
        retryAttempts: 3,
        retryDelay: 5000
    },
    
    // Sauvegarde automatique
    autoSave: {
        enabled: true,
        interval: 30000,
        onUnload: true
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
    currentFamilyFilter: ['extincteur', 'ria', 'baes', 'alarme'], // Par défaut toutes les familles
    currentAlarmePhotos: [],
    materials: [],
    currentVerificationIndex: null,
    currentVerificationPhotos: [],
    verifiedMaterialsForReport: [],
    
    // Nouvelles propriétés
    db: null,
    isOnline: navigator.onLine,
    unsavedChanges: false,
    lastSaveTime: null,
    syncQueue: [],
    offlineMode: false,
    
    // Variables pour le calendrier
    calendarEvents: [],
    
    // Gestion des performances
    lastOperationTime: null,
    operationQueue: [],
    isProcessing: false
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
                                store.createIndex('lastVerificationYear', 'lastVerificationYear', { unique: false });
                                break;
                            case 'materials':
                                store.createIndex('clientId', 'clientId', { unique: false });
                                store.createIndex('type', 'type', { unique: false });
                                store.createIndex('verified', 'verified', { unique: false });
                                store.createIndex('verificationYear', 'verificationYear', { unique: false });
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
        
        // Ajouter le CSS simplifié pour la vérification
        addSimpleVerificationCSS();
        
        navigateTo(AppState.currentPage || 'clients');
        
        setTimeout(addDataManagementUI, 1000);
        
        closeLoading();
        showDataStats();
        
        console.log('FireCheck Pro initialisé avec succès');
        
        // Initialiser le préchargement des pages
        initPagePreloading();
        
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
    initVerificationPage();
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
            displayMaterialsListSimplified();
            break;
        case 'verification':
            updateClientInfoBadge();
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
        lastVerificationYear: null,
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
        displayMaterialsListSimplified();
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
                displayMaterialsListSimplified();
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

// ==================== GESTION DES MATÉRIELS (PAGE SIMPLIFIÉE) ====================
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

function displayMaterialsListSimplified() {
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
    
    materialsList.innerHTML = materials.map((material, index) => createMaterialListItemSimplified(material, index)).join('');
}

function createMaterialListItemSimplified(material, index) {
    const materialInfo = getMaterialInfo(material.type);
    
    return `
        <div class="compact-material-item ${materialInfo.class}">
            <div class="compact-material-info">
                <div class="compact-material-name">
                    <i class="fas ${materialInfo.icon}"></i>
                    ${materialInfo.text} - ${material.id || material.numero}
                </div>
                <div class="compact-material-details">
                    ${material.localisation || material.location || 'Non spécifié'}
                    ${material.annee ? ` • Année: ${material.annee}` : ''}
                </div>
            </div>
            <div class="compact-material-actions">
                <button class="btn btn-sm btn-primary" onclick="editMaterial(${index})" 
                        title="Modifier la fiche">
                    <i class="fas fa-edit"></i>
                </button>
                <button class="btn btn-sm btn-danger" onclick="removeMaterialPermanent(${index})" 
                        title="Supprimer définitivement">
                    <i class="fas fa-trash"></i>
                </button>
            </div>
        </div>
    `;
}

function removeMaterialPermanent(index) {
    if (!AppState.currentClient || !AppState.currentClient.materials || !AppState.currentClient.materials[index]) {
        showError("Matériel non trouvé");
        return;
    }
    
    const material = AppState.currentClient.materials[index];
    
    if (!confirm(`Voulez-vous vraiment supprimer définitivement ${material.id || material.numero} ?`)) {
        return;
    }
    
    AppState.currentClient.materials.splice(index, 1);
    saveCurrentClientChanges();
    displayMaterialsListSimplified();
    
    // Rafraîchir aussi la liste de vérification si on est sur cette page
    if (AppState.currentPage === 'verification') {
        displayVerificationList();
    }
    
    showSuccess(`Matériel supprimé définitivement`);
}

// ==================== INITIALISATION DE LA PAGE DE VÉRIFICATION ====================
function initVerificationPage() {
    const filterContainer = document.getElementById('verification-filters');
    if (filterContainer) {
        filterContainer.innerHTML = `
            <div class="verification-header">
                <h3><i class="fas fa-filter"></i> Filtres de vérification</h3>
                <div class="filter-counters">
                    <span id="filter-stats">Chargement...</span>
                </div>
            </div>
            <div class="filter-buttons-grid">
                <div class="filter-button-item" data-family="extincteur">
                    <button class="filter-btn ${AppState.currentFamilyFilter.includes('extincteur') ? 'active' : ''}" 
                            onclick="toggleFamilyFilter('extincteur')">
                        <i class="fas fa-fire-extinguisher"></i>
                        <span>Extincteurs</span>
                        <span class="filter-count" id="count-extincteur">0</span>
                    </button>
                </div>
                <div class="filter-button-item" data-family="ria">
                    <button class="filter-btn ${AppState.currentFamilyFilter.includes('ria') ? 'active' : ''}" 
                            onclick="toggleFamilyFilter('ria')">
                        <i class="fas fa-faucet"></i>
                        <span>RIA</span>
                        <span class="filter-count" id="count-ria">0</span>
                    </button>
                </div>
                <div class="filter-button-item" data-family="baes">
                    <button class="filter-btn ${AppState.currentFamilyFilter.includes('baes') ? 'active' : ''}" 
                            onclick="toggleFamilyFilter('baes')">
                        <i class="fas fa-lightbulb"></i>
                        <span>BAES</span>
                        <span class="filter-count" id="count-baes">0</span>
                    </button>
                </div>
                <div class="filter-button-item" data-family="alarme">
                    <button class="filter-btn ${AppState.currentFamilyFilter.includes('alarme') ? 'active' : ''}" 
                            onclick="toggleFamilyFilter('alarme')">
                        <i class="fas fa-bell"></i>
                        <span>Alarmes</span>
                        <span class="filter-count" id="count-alarme">0</span>
                    </button>
                </div>
            </div>
            <div class="filter-actions">
                <button class="filter-action-btn select-all-btn" onclick="selectAllFamilies()">
                    <i class="fas fa-check-double"></i> <span>Tout sélectionner</span>
                </button>
                <button class="filter-action-btn clear-all-btn" onclick="clearAllFamilies()">
                    <i class="fas fa-times"></i> <span>Tout désélectionner</span>
                </button>
            </div>
            <div class="search-container">
                <input type="text" id="verification-search" class="search-input" 
                       placeholder="Rechercher un matériel..." oninput="searchVerificationMaterials()">
                <i class="fas fa-search search-icon"></i>
            </div>
        `;
    }
    
    const actionContainer = document.getElementById('verification-actions');
    if (actionContainer) {
        actionContainer.innerHTML = `
            <div class="verification-stats-grid">
                <div class="stat-item">
                    <div class="stat-label">Total</div>
                    <div class="stat-value" id="total-count">0</div>
                </div>
                <div class="stat-item">
                    <div class="stat-label">Vérifiés</div>
                    <div class="stat-value verified-count" id="verified-count">0</div>
                </div>
                <div class="stat-item">
                    <div class="stat-label">À vérifier</div>
                    <div class="stat-value pending-count" id="pending-count">0</div>
                </div>
            </div>
            <button id="finish-verification-btn" class="btn btn-success" onclick="finishVerification()" disabled>
                <i class="fas fa-check-circle"></i> <span>Terminer la vérification</span>
            </button>
        `;
    }
}

function addSimpleVerificationCSS() {
    const style = document.createElement('style');
    style.textContent = `
        /* Style simplifié pour la vérification */
        .compact-material-item {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 12px 15px;
            margin-bottom: 10px;
            background: white;
            border-radius: 8px;
            border-left: 4px solid #ccc;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
            transition: all 0.3s ease;
        }
        
        .compact-material-item:hover {
            transform: translateY(-2px);
            box-shadow: 0 4px 8px rgba(0,0,0,0.15);
        }
        
        /* Extincteur */
        .compact-material-item.extincteur {
            border-left-color: #e74c3c;
        }
        
        /* RIA */
        .compact-material-item.ria {
            border-left-color: #3498db;
        }
        
        /* BAES */
        .compact-material-item.baes {
            border-left-color: #f39c12;
        }
        
        /* Alarme */
        .compact-material-item.alarme {
            border-left-color: #9b59b6;
        }
        
        /* Informations du matériel */
        .compact-material-info {
            flex: 1;
            min-width: 0;
        }
        
        .compact-material-header {
            display: flex;
            align-items: center;
            gap: 8px;
            margin-bottom: 5px;
        }
        
        .compact-material-header i.fas {
            color: #6c757d;
        }
        
        .compact-material-header strong {
            font-size: 1.1em;
            color: #2c3e50;
        }
        
        .material-family-badge {
            background: #e9ecef;
            color: #495057;
            padding: 2px 8px;
            border-radius: 12px;
            font-size: 0.75em;
            font-weight: 500;
        }
        
        .material-status {
            font-size: 0.8em;
            font-weight: 600;
            display: flex;
            align-items: center;
            gap: 4px;
        }
        
        .material-status.status-success {
            color: #28a745;
        }
        
        .material-status.status-warning {
            color: #ffc107;
        }
        
        .compact-material-details {
            font-size: 0.9em;
            color: #6c757d;
            line-height: 1.4;
        }
        
        .compact-material-details div {
            display: flex;
            align-items: center;
            gap: 5px;
            margin-bottom: 3px;
        }
        
        .compact-material-details i {
            width: 16px;
            color: #adb5bd;
        }
        
        .verification-date {
            font-size: 0.85em;
            color: #28a745;
            margin-top: 3px;
        }
        
        /* Boutons d'action */
        .compact-material-actions {
            display: flex;
            align-items: center;
        }
        
        .action-buttons {
            display: flex;
            gap: 8px;
        }
        
        .action-buttons button {
            width: 40px;
            height: 40px;
            border-radius: 6px;
            border: none;
            display: flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            transition: all 0.2s ease;
            font-size: 1em;
        }
        
        .action-buttons button:hover {
            transform: scale(1.1);
        }
        
        /* Bouton Modifier */
        .btn-edit {
            background: #3498db;
            color: white;
        }
        
        .btn-edit:hover {
            background: #2980b9;
        }
        
        /* Bouton Valider */
        .btn-validate {
            background: #28a745;
            color: white;
        }
        
        .btn-validate:hover {
            background: #218838;
        }
        
        /* Bouton Déjà validé */
        .btn-validated {
            background: #6c757d;
            color: white;
        }
        
        .btn-validated:hover {
            background: #5a6268;
        }
        
        /* Bouton Supprimer */
        .btn-delete {
            background: #dc3545;
            color: white;
        }
        
        .btn-delete:hover {
            background: #c82333;
        }
        
        /* Responsive */
        @media (max-width: 768px) {
            .compact-material-item {
                flex-direction: column;
                align-items: stretch;
                padding: 10px;
            }
            
            .compact-material-header {
                flex-wrap: wrap;
                gap: 5px;
            }
            
            .compact-material-header strong {
                font-size: 1em;
            }
            
            .material-family-badge {
                font-size: 0.7em;
                padding: 1px 6px;
            }
            
            .material-status {
                font-size: 0.75em;
            }
            
            .compact-material-details {
                font-size: 0.85em;
                margin-bottom: 10px;
            }
            
            .compact-material-actions {
                justify-content: flex-end;
            }
            
            .action-buttons {
                width: 100%;
                justify-content: flex-end;
            }
            
            .action-buttons button {
                width: 36px;
                height: 36px;
                font-size: 0.9em;
            }
        }
        
        @media (max-width: 480px) {
            .compact-material-item {
                padding: 8px;
            }
            
            .action-buttons button {
                width: 32px;
                height: 32px;
                font-size: 0.85em;
            }
            
            .compact-material-header {
                font-size: 0.9em;
            }
            
            .compact-material-details {
                font-size: 0.8em;
            }
        }
    `;
    
    // Vérifier si le style n'a pas déjà été ajouté
    if (!document.getElementById('simple-verification-css')) {
        style.id = 'simple-verification-css';
        document.head.appendChild(style);
    }
}

// ==================== CSS RESPONSIVE POUR LA VÉRIFICATION ====================
function addResponsiveVerificationCSS() {
    const style = document.createElement('style');
    style.textContent = `
        /* Styles pour les écrans mobiles */
        @media (max-width: 768px) {
            /* Ajustement des filtres */
            .filter-buttons-grid {
                grid-template-columns: repeat(2, 1fr) !important;
                gap: 8px;
            }
            
            .filter-btn {
                padding: 12px 8px;
                font-size: 0.8em;
            }
            
            .filter-btn i {
                font-size: 1.2em;
            }
            
            .filter-count {
                top: -6px;
                right: -6px;
                font-size: 0.7em;
                padding: 1px 4px;
                min-width: 18px;
            }
            
            .verification-header {
                flex-direction: column;
                align-items: flex-start;
                gap: 10px;
            }
            
            .verification-header h3 {
                font-size: 1.1rem;
            }
            
            .filter-counters {
                font-size: 0.85rem;
            }
            
            .filter-actions {
                flex-direction: column;
                gap: 8px;
            }
            
            .filter-action-btn {
                width: 100%;
                padding: 10px;
            }
            
            /* Ajustement des statistiques */
            .verification-stats-grid {
                grid-template-columns: repeat(3, 1fr) !important;
                gap: 8px;
            }
            
            .stat-item {
                padding: 8px 4px;
            }
            
            .stat-label {
                font-size: 0.75em;
            }
            
            .stat-value {
                font-size: 1.2em;
            }
            
            #verification-actions {
                flex-direction: column;
                gap: 15px;
                padding: 15px;
            }
            
            #finish-verification-btn {
                width: 100%;
                padding: 10px 16px;
                font-size: 0.9em;
            }
            
            /* Optimisation des boutons d'action dans la liste */
            .compact-material-actions.verification-actions {
                display: flex;
                flex-direction: column;
                align-items: stretch;
                gap: 4px;
                min-width: 50px;
            }
            
            .compact-material-actions.verification-actions button {
                padding: 6px 8px;
                font-size: 0.85em;
                min-width: 40px;
                display: flex;
                justify-content: center;
                align-items: center;
            }
            
            .compact-material-actions.verification-actions button i {
                margin: 0;
                font-size: 0.9em;
            }
            
            .verification-item-actions {
                flex-direction: column;
                gap: 4px;
            }
            
            .remove-from-verification-btn {
                width: 28px;
                height: 28px;
            }
            
            /* Ajustement du contenu des matériels */
            .compact-material-item {
                padding: 10px;
            }
            
            .compact-material-info {
                flex: 1;
                min-width: 0;
                overflow: hidden;
            }
            
            .compact-material-name {
                flex-wrap: wrap;
                gap: 4px;
                margin-bottom: 4px;
            }
            
            .material-family-badge {
                font-size: 0.7em;
                padding: 1px 6px;
                margin-left: 6px;
            }
            
            .material-status {
                font-size: 0.8em;
                margin-top: 4px;
                width: 100%;
            }
            
            .compact-material-details {
                font-size: 0.8em;
                line-height: 1.3;
            }
            
            .compact-material-details div {
                margin-bottom: 2px;
            }
            
            .verification-date {
                font-size: 0.75em;
                margin-top: 2px;
            }
            
            /* Cacher le texte des boutons sur mobile très petit */
            @media (max-width: 480px) {
                .filter-buttons-grid {
                    grid-template-columns: 1fr !important;
                }
                
                .filter-btn span,
                .filter-action-btn span,
                #finish-verification-btn span {
                    display: none;
                }
                
                .filter-btn {
                    padding: 12px;
                    height: 70px;
                    justify-content: center;
                }
                
                .filter-btn i {
                    font-size: 1.4em;
                    margin-bottom: 4px;
                }
                
                .filter-count {
                    top: -4px;
                    right: -4px;
                }
                
                .compact-material-name strong {
                    font-size: 0.9em;
                }
                
                .compact-material-details {
                    font-size: 0.75em;
                }
                
                .compact-material-actions.verification-actions button span {
                    display: none;
                }
                
                .compact-material-actions.verification-actions button {
                    width: 32px;
                    height: 32px;
                    padding: 2px;
                }
                
                .verification-stats-grid {
                    grid-template-columns: repeat(3, 1fr) !important;
                }
                
                .stat-label {
                    font-size: 0.7em;
                }
                
                .stat-value {
                    font-size: 1.1em;
                }
            }
            
            /* Pour les tablettes */
            @media (min-width: 481px) and (max-width: 768px) {
                .filter-buttons-grid {
                    grid-template-columns: repeat(2, 1fr) !important;
                }
                
                .filter-btn span {
                    font-size: 0.85em;
                }
                
                .compact-material-actions.verification-actions {
                    flex-direction: row;
                    flex-wrap: wrap;
                    justify-content: flex-end;
                }
                
                .compact-material-actions.verification-actions button {
                    width: 36px;
                    height: 36px;
                }
                
                .verification-item-actions {
                    flex-direction: row;
                    flex-wrap: wrap;
                }
            }
        }
        
        /* Ajustements pour les grands écrans mobiles et tablettes */
        @media (min-width: 769px) and (max-width: 1024px) {
            .filter-buttons-grid {
                grid-template-columns: repeat(2, 1fr) !important;
            }
            
            .compact-material-actions.verification-actions {
                display: flex;
                flex-direction: row;
                gap: 6px;
            }
            
            .compact-material-actions.verification-actions button {
                padding: 6px 10px;
                font-size: 0.85em;
            }
            
            .verification-item-actions {
                display: flex;
                flex-direction: row;
                gap: 6px;
            }
            
            .remove-from-verification-btn {
                width: 32px;
                height: 32px;
            }
        }
        
        /* Pour les grands écrans */
        @media (min-width: 1025px) {
            .filter-buttons-grid {
                grid-template-columns: repeat(4, 1fr);
            }
            
            .verification-stats-grid {
                grid-template-columns: repeat(3, 1fr);
            }
        }
    `;
    document.head.appendChild(style);
}

// ==================== GESTION DES FILTRES DE VÉRIFICATION AMÉLIORÉE ====================
function toggleFamilyFilter(family) {
    const index = AppState.currentFamilyFilter.indexOf(family);
    if (index === -1) {
        AppState.currentFamilyFilter.push(family);
    } else {
        AppState.currentFamilyFilter.splice(index, 1);
    }
    
    // Sauvegarder les filtres
    localStorage.setItem('verification_filters', JSON.stringify(AppState.currentFamilyFilter));
    
    // Mettre à jour les boutons de filtre
    updateFilterButtons();
    
    // Rafraîchir la liste des matériels
    displayVerificationList();
}

function selectAllFamilies() {
    AppState.currentFamilyFilter = [...CONFIG.familyFilters];
    localStorage.setItem('verification_filters', JSON.stringify(AppState.currentFamilyFilter));
    updateFilterButtons();
    displayVerificationList();
}

function clearAllFamilies() {
    AppState.currentFamilyFilter = [];
    localStorage.setItem('verification_filters', JSON.stringify(AppState.currentFamilyFilter));
    updateFilterButtons();
    displayVerificationList();
}

function updateFilterButtons() {
    const filterButtons = document.querySelectorAll('.filter-btn');
    filterButtons.forEach(button => {
        const family = button.closest('.filter-button-item')?.dataset.family;
        if (family && AppState.currentFamilyFilter.includes(family)) {
            button.classList.add('active');
        } else if (family) {
            button.classList.remove('active');
        }
    });
    
    updateFilterCounts();
}

function updateFilterCounts() {
    if (!AppState.currentClient || !AppState.currentClient.materials) return;
    
    const currentYear = new Date().getFullYear();
    
    CONFIG.familyFilters.forEach(family => {
        const materials = AppState.currentClient.materials.filter(m => m.type === family);
        const verifiedCount = materials.filter(m => {
            const status = getMaterialVerificationStatus(m, currentYear);
            return status.verified;
        }).length;
        
        const countElement = document.getElementById(`count-${family}`);
        if (countElement) {
            countElement.textContent = materials.length;
            countElement.title = `${verifiedCount} vérifié(s) sur ${materials.length}`;
        }
    });
    
    // Mettre à jour les statistiques des filtres
    const totalFiltered = getFilteredMaterials().length;
    const totalMaterials = AppState.currentClient.materials.length;
    const statsElement = document.getElementById('filter-stats');
    if (statsElement) {
        statsElement.textContent = `${totalFiltered} matériel(s) sélectionné(s) sur ${totalMaterials}`;
    }
}

function searchVerificationMaterials() {
    displayVerificationList();
}

// ==================== VÉRIFICATION ANNUELLE - VERSION SIMPLIFIÉE ====================
function displayVerificationList() {
    const verificationList = document.getElementById('verification-list');
    const verificationSearch = document.getElementById('verification-search');
    
    if (!verificationList) return;
    
    updateClientInfoBadge();
    
    if (!AppState.currentClient || !AppState.currentClient.materials || AppState.currentClient.materials.length === 0) {
        showEmptyState(verificationList, 'verification');
        updateVerificationStats(0, 0, 0);
        updateFilterCounts();
        updateFinishButton();
        return;
    }
    
    const searchTerm = verificationSearch ? verificationSearch.value.toLowerCase() : '';
    
    // Obtenir les matériels filtrés
    const filteredMaterials = getFilteredMaterials(searchTerm);
    
    if (filteredMaterials.length === 0) {
        showEmptyState(verificationList, 'verification');
        updateVerificationStats(0, 0, 0);
        updateFilterCounts();
        updateFinishButton();
        return;
    }
    
    // Calculer les statistiques
    const currentYear = new Date().getFullYear();
    let verifiedCount = 0;
    
    verificationList.innerHTML = filteredMaterials.map((material, originalIndex) => {
        // Trouver l'index original dans la liste complète
        const originalFullIndex = AppState.currentClient.materials.findIndex(m => m.id === material.id);
        
        const materialInfo = getMaterialInfo(material.type);
        const status = getMaterialVerificationStatus(material, currentYear);
        const isVerified = status.verified;
        
        if (isVerified) verifiedCount++;
        
        // Formatage simplifié des informations du matériel
        const location = material.localisation || material.location || 'Non spécifié';
        const type = material.typeExtincteur || material.typeRIA || material.typeBAES || material.typeAlarme || 'Type non spécifié';
        const annee = material.annee ? ` • Année: ${material.annee}` : '';
        const verificationDate = status.currentVerification?.dateVerification 
            ? `<div class="verification-date"><i class="fas fa-calendar-check"></i> Vérifié le ${formatDate(status.currentVerification.dateVerification)}</div>`
            : '';
        
        // Couleur et texte de statut
        const statusColor = isVerified ? 'success' : 'warning';
        const statusText = isVerified ? 'Vérifié' : 'À vérifier';
        const statusIcon = isVerified ? 'fa-check-circle' : 'fa-clock';
        
        return `
            <div class="compact-material-item ${materialInfo.class}" id="verif-material-${originalFullIndex}">
                <div class="compact-material-info">
                    <div class="compact-material-header">
                        <i class="fas ${materialInfo.icon}"></i>
                        <strong>${material.id || material.numero}</strong>
                        <span class="material-family-badge">${materialInfo.text}</span>
                        <span class="material-status status-${statusColor}">
                            <i class="fas ${statusIcon}"></i> ${statusText}
                        </span>
                    </div>
                    <div class="compact-material-details">
                        <div><i class="fas fa-map-marker-alt"></i> ${location}</div>
                        <div><i class="fas fa-tag"></i> ${type}${annee}</div>
                        ${verificationDate}
                    </div>
                </div>
                <div class="compact-material-actions">
                    <div class="action-buttons">
                        <!-- Bouton Modifier -->
                        <button class="btn btn-sm btn-edit" onclick="editMaterial(${originalFullIndex})" 
                                title="Modifier le matériel">
                            <i class="fas fa-edit"></i>
                        </button>
                        
                        <!-- Bouton Valider/Annuler validation -->
                        <button class="btn btn-sm ${isVerified ? 'btn-validated' : 'btn-validate'}" 
                                onclick="${isVerified ? 'resetMaterialVerification' : 'verifyMaterial'}(${originalFullIndex})" 
                                title="${isVerified ? 'Annuler la validation' : 'Valider le matériel'}">
                            <i class="fas ${isVerified ? 'fa-undo' : 'fa-check'}"></i>
                        </button>
                        
                        <!-- Bouton Supprimer -->
                        <button class="btn btn-sm btn-delete" onclick="removeFromVerification(${originalFullIndex})" 
                                title="Retirer de la vérification">
                            <i class="fas fa-trash"></i>
                        </button>
                    </div>
                </div>
            </div>
        `;
    }).join('');
    
    // Mettre à jour les statistiques
    const pendingCount = filteredMaterials.length - verifiedCount;
    updateVerificationStats(filteredMaterials.length, verifiedCount, pendingCount);
    
    // Mettre à jour les compteurs de filtres
    updateFilterCounts();
    
    // Mettre à jour le bouton de fin
    updateFinishButton();
}

function getFilteredMaterials(searchTerm = '') {
    if (!AppState.currentClient || !AppState.currentClient.materials) return [];
    
    // Filtrer par famille
    let filtered = AppState.currentClient.materials.filter(material => {
        if (AppState.currentFamilyFilter.length === 0) return false;
        return AppState.currentFamilyFilter.includes(material.type);
    });
    
    // Filtrer par recherche
    if (searchTerm) {
        filtered = filtered.filter(material => {
            const searchableFields = [
                material.id || material.numero || '',
                material.localisation || material.location || '',
                material.typeExtincteur || material.typeRIA || material.typeBAES || material.typeAlarme || '',
                material.observations || ''
            ];
            
            return searchableFields.some(field => 
                field.toLowerCase().includes(searchTerm)
            );
        });
    }
    
    return filtered;
}

// ==================== BOUTON SUPPRIMER DE LA VÉRIFICATION ====================
function removeFromVerification(index) {
    if (!AppState.currentClient || !AppState.currentClient.materials || !AppState.currentClient.materials[index]) {
        showError("Matériel non trouvé");
        return;
    }
    
    const material = AppState.currentClient.materials[index];
    const materialInfo = getMaterialInfo(material.type);
    
    if (!confirm(`Voulez-vous retirer le ${materialInfo.text.toLowerCase()} ${material.id || material.numero} de la vérification en cours ?

⚠️ Cette action :
• Retire le matériel de la vérification en cours
• Le matériel reste dans la liste du client
• Ne supprime pas le matériel définitivement

Pour supprimer définitivement le matériel, utilisez le bouton "Supprimer" dans la page des matériels.`)) {
        return;
    }
    
    // Réinitialiser la vérification pour l'année en cours
    const currentYear = new Date().getFullYear();
    updateMaterialVerification(material, currentYear, false);
    
    saveCurrentClientChanges();
    refreshAllLists();
    
    showSuccess(`${materialInfo.text} retiré de la vérification en cours`);
}

function updateVerificationStats(total, verified, pending) {
    const totalElement = document.getElementById('total-count');
    const verifiedElement = document.getElementById('verified-count');
    const pendingElement = document.getElementById('pending-count');
    
    if (totalElement) totalElement.textContent = total;
    if (verifiedElement) verifiedElement.textContent = verified;
    if (pendingElement) pendingElement.textContent = pending;
}

function updateFinishButton() {
    const finishButton = document.getElementById('finish-verification-btn');
    if (!finishButton) return;
    
    const currentYear = new Date().getFullYear();
    
    // Obtenir les matériels filtrés
    const filteredMaterials = getFilteredMaterials();
    
    if (filteredMaterials.length === 0) {
        finishButton.disabled = true;
        finishButton.title = 'Aucun matériel sélectionné dans les filtres';
        return;
    }
    
    // Vérifier si tous les matériels filtrés sont vérifiés
    const allVerified = filteredMaterials.every(material => {
        const status = getMaterialVerificationStatus(material, currentYear);
        return status.verified;
    });
    
    finishButton.disabled = !allVerified;
    finishButton.title = allVerified 
        ? 'Cliquez pour terminer la vérification et générer le rapport' 
        : `${filteredMaterials.filter(m => !getMaterialVerificationStatus(m, currentYear).verified).length} matériel(s) restant(s) à vérifier`;
}

// ==================== FONCTIONS DE VÉRIFICATION ANNUELLE ====================
function getMaterialVerificationStatus(material, currentYear) {
    if (!material.verificationHistory || material.verificationHistory.length === 0) {
        return { verified: false, lastYear: null, currentVerification: null };
    }
    
    const currentVerification = material.verificationHistory.find(v => v.verificationYear === currentYear);
    
    return {
        verified: currentVerification ? currentVerification.verified : false,
        lastYear: currentVerification ? currentVerification.verificationYear : null,
        currentVerification: currentVerification
    };
}

function updateMaterialVerification(material, currentYear, verified = true) {
    if (!material.verificationHistory) {
        material.verificationHistory = [];
    }
    
    let currentYearVerification = material.verificationHistory.find(v => v.verificationYear === currentYear);
    if (!currentYearVerification) {
        currentYearVerification = {
            verified: verified,
            verificationYear: currentYear,
            dateVerification: verified ? new Date().toISOString().split('T')[0] : null,
            verifiedBy: verified ? (getElementValue('technician-name') || 'Technicien') : ''
        };
        material.verificationHistory.push(currentYearVerification);
    } else {
        currentYearVerification.verified = verified;
        currentYearVerification.dateVerification = verified ? new Date().toISOString().split('T')[0] : null;
        currentYearVerification.verifiedBy = verified ? (getElementValue('technician-name') || 'Technicien') : '';
    }
    
    return currentYearVerification;
}

function verifyMaterial(index) {
    if (!AppState.currentClient || !AppState.currentClient.materials || !AppState.currentClient.materials[index]) {
        showError("Matériel non trouvé");
        return;
    }
    
    const currentYear = new Date().getFullYear();
    const material = AppState.currentClient.materials[index];
    const materialInfo = getMaterialInfo(material.type);
    
    if (!confirm(`Voulez-vous vraiment valider le ${materialInfo.text.toLowerCase()} ${material.id || material.numero} pour l'année ${currentYear} ?`)) {
        return;
    }
    
    updateMaterialVerification(material, currentYear, true);
    
    // Mettre à jour l'année de dernière vérification du client
    AppState.currentClient.lastVerificationYear = currentYear;
    
    saveCurrentClientChanges();
    refreshAllLists();
    
    showSuccess(`${materialInfo.text} validé pour l'année ${currentYear}`);
    
    // Mettre à jour le bouton de fin de vérification
    updateFinishButton();
}

function resetMaterialVerification(index) {
    if (!AppState.currentClient || !AppState.currentClient.materials || !AppState.currentClient.materials[index]) {
        showError("Matériel non trouvé");
        return;
    }
    
    const currentYear = new Date().getFullYear();
    const material = AppState.currentClient.materials[index];
    const materialInfo = getMaterialInfo(material.type);
    
    if (!confirm(`Voulez-vous re-marquer le ${materialInfo.text.toLowerCase()} ${material.id || material.numero} comme 'à vérifier' pour l'année en cours ?`)) {
        return;
    }
    
    updateMaterialVerification(material, currentYear, false);
    
    saveCurrentClientChanges();
    refreshAllLists();
    
    showSuccess(`${materialInfo.text} marqué comme 'à vérifier'`);
    
    // Mettre à jour le bouton de fin de vérification
    updateFinishButton();
}

function finishVerification() {
    const finishButton = document.getElementById('finish-verification-btn');
    if (finishButton && finishButton.disabled) {
        showError('Vous devez vérifier tous les matériels sélectionnés dans les filtres avant de terminer');
        return;
    }
    
    // Préparer les données pour le rapport
    const prepared = prepareVerificationReport();
    
    if (!prepared) {
        showError('Impossible de préparer le rapport. Vérifiez que des matériels ont été validés.');
        return;
    }
    
    // Naviguer vers la page de signature
    navigateTo('signature');
    showSuccess('Vérification terminée ! Vous pouvez maintenant générer le rapport PDF.');
}

function prepareVerificationReport() {
    if (!AppState.currentClient) {
        showError('Aucun client sélectionné');
        return false;
    }
    
    const currentYear = new Date().getFullYear();
    
    // Filtrer les matériels vérifiés pour l'année en cours (basé sur les filtres actifs)
    const verifiedMaterials = AppState.currentClient.materials.filter(material => {
        // Vérifier si le matériel est dans les filtres actifs
        if (AppState.currentFamilyFilter.length > 0 && 
            !AppState.currentFamilyFilter.includes(material.type)) {
            return false;
        }
        
        // Vérifier si le matériel est vérifié pour l'année en cours
        const status = getMaterialVerificationStatus(material, currentYear);
        return status.verified;
    });
    
    if (verifiedMaterials.length === 0) {
        showError('Aucun matériel vérifié dans les filtres sélectionnés');
        return false;
    }
    
    // Stocker les matériels vérifiés pour le rapport
    AppState.verifiedMaterialsForReport = verifiedMaterials;
    
    // Mettre à jour l'année de dernière vérification du client
    AppState.currentClient.lastVerificationYear = currentYear;
    saveCurrentClientChanges();
    
    console.log(`${verifiedMaterials.length} matériel(s) vérifié(s) seront inclus dans le rapport`);
    return true;
}

// ==================== FONCTIONS DE MATÉRIELS (EXISTANTES) ====================
function getMaterialInfo(type) {
    const types = {
        extincteur: { class: 'extincteur', icon: 'fa-fire-extinguisher', text: 'Extincteur' },
        ria: { class: 'ria', icon: 'fa-faucet', text: 'RIA' },
        baes: { class: 'baes', icon: 'fa-lightbulb', text: 'BAES' },
        alarme: { class: 'alarme', icon: 'fa-bell', text: 'Alarme' }
    };
    
    return types[type] || { class: '', icon: 'fa-question', text: 'Matériel' };
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
    displayMaterialsListSimplified();
    
    // Rafraîchir aussi la liste de vérification si on est sur cette page
    if (AppState.currentPage === 'verification') {
        displayVerificationList();
    }
}

// ==================== ÉDITION DES MATÉRIELS ====================
function editMaterial(index) {
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
        default:
            showError('Type de matériel non reconnu');
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
    
    // Conserver l'historique de vérification
    const originalMaterial = AppState.currentClient.materials[AppState.currentEditingMaterialIndex];
    if (originalMaterial.verificationHistory) {
        updatedExtincteur.verificationHistory = originalMaterial.verificationHistory;
    }
    
    AppState.currentClient.materials[AppState.currentEditingMaterialIndex] = updatedExtincteur;
    
    saveCurrentClientChanges();
    closeModal('add-extincteur-modal');
    refreshAllLists();
    
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
    
    // Conserver l'historique de vérification
    const originalMaterial = AppState.currentClient.materials[AppState.currentEditingMaterialIndex];
    if (originalMaterial.verificationHistory) {
        updatedRIA.verificationHistory = originalMaterial.verificationHistory;
    }
    
    AppState.currentClient.materials[AppState.currentEditingMaterialIndex] = updatedRIA;
    
    saveCurrentClientChanges();
    closeModal('add-ria-modal');
    refreshAllLists();
    
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
    
    // Conserver l'historique de vérification
    const originalMaterial = AppState.currentClient.materials[AppState.currentEditingMaterialIndex];
    if (originalMaterial.verificationHistory) {
        updatedBAES.verificationHistory = originalMaterial.verificationHistory;
    }
    
    AppState.currentClient.materials[AppState.currentEditingMaterialIndex] = updatedBAES;
    
    saveCurrentClientChanges();
    closeModal('add-baes-modal');
    refreshAllLists();
    
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
    
    // Conserver l'historique de vérification
    const originalMaterial = AppState.currentClient.materials[AppState.currentEditingMaterialIndex];
    if (originalMaterial.verificationHistory) {
        updatedAlarme.verificationHistory = originalMaterial.verificationHistory;
    }
    updatedAlarme.photos = originalMaterial.photos || [];
    
    AppState.currentClient.materials[AppState.currentEditingMaterialIndex] = updatedAlarme;
    
    saveCurrentClientChanges();
    closeModal('add-alarme-modal');
    refreshAllLists();
    
    showSuccess('Alarme mise à jour avec succès');
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
        const verifBtn = buttonContainer.querySelector('#planning-verif-btn');
        if (verifBtn) {
            verifBtn.onclick = goToVerificationFromPlanning;
        }
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
                    <button class="btn btn-sm btn-primary" onclick="editIntervention('${event.id}')" 
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
        const hasVerifications = client.lastVerificationYear || 
                                (client.materials && client.materials.some(m => 
                                    m.verificationHistory && m.verificationHistory.some(v => v.verified)
                                ));
        
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
    const materialsCount = client.materials?.length || 0;
    let verifiedMaterialsCount = 0;
    let lastVerificationYear = client.lastVerificationYear;
    
    if (client.materials) {
        client.materials.forEach(material => {
            if (material.verificationHistory && material.verificationHistory.some(v => v.verified)) {
                verifiedMaterialsCount++;
                
                material.verificationHistory.forEach(verification => {
                    if (verification.verified && verification.verificationYear) {
                        if (!lastVerificationYear || verification.verificationYear > lastVerificationYear) {
                            lastVerificationYear = verification.verificationYear;
                        }
                    }
                });
            }
        });
    }
    
    return `
        <div class="compact-material-item client-item">
            <div class="compact-material-info">
                <div class="compact-material-name">
                    <i class="fas fa-user"></i>
                    ${escapeHtml(client.name)}
                    <span class="status-badge status-ok">
                        ${verifiedMaterialsCount} matériel(s) vérifié(s)
                    </span>
                </div>
                <div class="compact-material-details">
                    ${escapeHtml(client.contact)} • ${escapeHtml(client.address)}
                    <br>
                    <small>Dernière vérification : ${lastVerificationYear ? `Année ${lastVerificationYear}` : 'Non spécifiée'}</small>
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

function showToast(message, type = 'success', duration = 3000) {
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `
        <i class="fas fa-${type === 'success' ? 'check-circle' : 
                         type === 'error' ? 'exclamation-circle' : 
                         'info-circle'}"></i>
        <span>${message}</span>
    `;
    
    toast.style.cssText = `
        position: fixed;
        bottom: 20px;
        right: 20px;
        padding: 12px 20px;
        border-radius: 8px;
        color: white;
        z-index: 10000;
        transform: translateY(100px);
        opacity: 0;
        transition: all 0.3s ease;
        max-width: 300px;
        display: flex;
        align-items: center;
        gap: 10px;
        font-weight: 500;
        box-shadow: 0 4px 12px rgba(0,0,0,0.15);
    `;
    
    if (type === 'success') {
        toast.style.background = 'linear-gradient(135deg, #28a745 0%, #218838 100%)';
    } else if (type === 'error') {
        toast.style.background = 'linear-gradient(135deg, #dc3545 0%, #c82333 100%)';
    } else {
        toast.style.background = 'linear-gradient(135deg, #17a2b8 0%, #138496 100%)';
    }
    
    document.body.appendChild(toast);
    
    setTimeout(() => {
        toast.style.transform = 'translateY(0)';
        toast.style.opacity = '1';
    }, 10);
    
    setTimeout(() => {
        toast.style.transform = 'translateY(100px)';
        toast.style.opacity = '0';
        setTimeout(() => {
            if (toast.parentNode) {
                toast.remove();
            }
        }, 300);
    }, duration);
    
    return toast;
}

function showSuccess(message) {
    showToast(message, 'success');
}

function showError(message) {
    showToast(message, 'error');
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
        
        .material-family-badge {
            background: #e9ecef;
            color: #495057;
            padding: 2px 8px;
            border-radius: 12px;
            font-size: 0.8em;
            margin-left: 8px;
        }
        
        .verification-actions {
            display: flex;
            gap: 5px;
        }
        
        .verification-date {
            font-size: 0.9em;
            color: #6c757d;
            margin-top: 4px;
        }
        
        .btn-success.verified {
            background-color: #28a745;
            border-color: #28a745;
        }
        
        @media (max-width: 768px) {
            .data-management-options {
                grid-template-columns: 1fr;
            }
            
            .verification-actions {
                flex-direction: column;
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

// ==================== GÉNÉRATION RAPPORT PDF OPTIMISÉ ====================
async function generatePDFReport() {
    console.log('🔄 Début génération rapport PDF optimisé...');
    
    if (!AppState.currentClient) {
        showError('Veuillez d\'abord sélectionner un client');
        return;
    }
    
    const currentYear = new Date().getFullYear();
    
    // Utiliser les matériels vérifiés stockés ou filtrer à nouveau
    const materials = AppState.verifiedMaterialsForReport || 
        AppState.currentClient.materials?.filter(m => 
            m.verificationHistory && 
            m.verificationHistory.some(v => v.verificationYear === currentYear && v.verified)
        ) || [];
    
    if (materials.length === 0) {
        showError('Aucun matériel vérifié pour l\'année en cours à exporter');
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
        
        const margin = 15;
        const pageWidth = doc.internal.pageSize.getWidth();
        const pageHeight = doc.internal.pageSize.getHeight();
        const contentWidth = pageWidth - (2 * margin);
        let currentY = margin;
        
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
        
        addText('RAPPORT DE VÉRIFICATION ANNUEL', margin, currentY, 20, 'bold', 'left', [26, 54, 93]);
        currentY += 10;
        
        addText(`Vérification des équipements de sécurité incendie - Année ${currentYear}`, margin, currentY, 14, 'normal', 'left', [44, 62, 80]);
        currentY += 8;
        
        const today = new Date().toLocaleDateString('fr-FR');
        addText(`Date: ${today}`, margin, currentY, 10);
        addText(`Référence: RAP-${currentYear}-${AppState.currentClient.id?.substr(0, 8) || '000000'}`, pageWidth - margin, currentY, 10, 'normal', 'right');
        currentY += 10;
        
        addLine(currentY);
        currentY += 5;
        
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
        
        const registreSecurite = getElementValue('registre-securite');
        if (registreSecurite) {
            const statutRegistre = registreSecurite === 'oui' ? 'Signé et conforme' : 
                                  registreSecurite === 'non' ? 'Non signé' : 'Indisponible';
            addText(`Registre de sécurité: ${statutRegistre}`, margin, currentY, 10);
            currentY += 5;
        }
        
        currentY += 10;
        
        const materialsByType = groupMaterialsByType(materials);
        let totalConforme = 0;
        let totalNonConforme = 0;
        
        Object.entries(materialsByType).forEach(([type, items]) => {
            const conformeCount = items.filter(m => 
                checkMaterialConformity(m, currentYear)
            ).length;
            const nonConformeCount = items.length - conformeCount;
            
            totalConforme += conformeCount;
            totalNonConforme += nonConformeCount;
        });
        
        const isGlobalConforme = totalNonConforme === 0;
        const conformiteText = isGlobalConforme ? 'ÉTAT CONFORME' : 'ÉTAT NON CONFORME';
        const conformiteColor = isGlobalConforme ? [50, 168, 82] : [220, 53, 69];
        
        addText(conformiteText, pageWidth / 2, currentY, 16, 'bold', 'center', conformiteColor);
        currentY += 8;
        
        const sousTitre = isGlobalConforme 
            ? `Tous les matériels vérifiés (${materials.length}) sont conformes aux normes NF S 61-919`
            : `${totalNonConforme} matériel(s) non conforme(s) sur ${materials.length} vérifié(s)`;
        addText(sousTitre, pageWidth / 2, currentY, 12, 'normal', 'center', [73, 80, 87]);
        
        currentY += 15;
        
        addText('SYNTHÈSE DES VÉRIFICATIONS', margin, currentY, 14, 'bold', 'left', [26, 54, 93]);
        currentY += 8;
        
        const statX = margin;
        const statWidth = contentWidth / 4;
        
        addBox(statX, currentY, statWidth, 20, [248, 249, 250]);
        addText('VÉRIFIÉS', statX + statWidth/2, currentY + 8, 10, 'bold', 'center', [73, 80, 87]);
        addText(materials.length.toString(), statX + statWidth/2, currentY + 15, 16, 'bold', 'center', [26, 54, 93]);
        
        addBox(statX + statWidth, currentY, statWidth, 20, [232, 245, 233]);
        addText('CONFORMES', statX + statWidth + statWidth/2, currentY + 8, 10, 'bold', 'center', [73, 80, 87]);
        addText(totalConforme.toString(), statX + statWidth + statWidth/2, currentY + 15, 16, 'bold', 'center', [50, 168, 82]);
        
        addBox(statX + statWidth*2, currentY, statWidth, 20, [248, 215, 218]);
        addText('NON CONFORMES', statX + statWidth*2 + statWidth/2, currentY + 8, 10, 'bold', 'center', [73, 80, 87]);
        addText(totalNonConforme.toString(), statX + statWidth*2 + statWidth/2, currentY + 15, 16, 'bold', 'center', [220, 53, 69]);
        
        const taux = materials.length > 0 ? Math.round((totalConforme / materials.length) * 100) : 0;
        addBox(statX + statWidth*3, currentY, statWidth, 20, [220, 237, 253]);
        addText('TAUX', statX + statWidth*3 + statWidth/2, currentY + 8, 10, 'bold', 'center', [73, 80, 87]);
        addText(`${taux}%`, statX + statWidth*3 + statWidth/2, currentY + 15, 16, 'bold', 'center', [13, 110, 253]);
        
        currentY += 25;
        
        currentY += 5;
        
        Object.entries(materialsByType).forEach(([type, items]) => {
            if (items.length === 0) return;
            
            if (currentY > pageHeight - 60) {
                doc.addPage();
                currentY = margin;
            }
            
            const materialInfo = getMaterialInfo(type);
            const conformeCount = items.filter(m => checkMaterialConformity(m, currentYear)).length;
            const nonConformeCount = items.length - conformeCount;
            const isTypeConforme = nonConformeCount === 0;
            
            addText(`${materialInfo.text.toUpperCase()}`, margin, currentY, 14, 'bold', 'left', [26, 54, 93]);
            
            const typeConformiteColor = isTypeConforme ? [50, 168, 82] : [220, 53, 69];
            const typeConformiteText = isTypeConforme ? 'Conforme' : `${nonConformeCount} non conforme(s)`;
            
            addText(typeConformiteText, pageWidth - margin, currentY, 10, 'bold', 'right', typeConformiteColor);
            currentY += 7;
            
            addText(`${items.length} matériel(s) vérifié(s)`, margin, currentY, 10, 'normal', 'left', [108, 117, 125]);
            currentY += 5;
            
            const headers = ['ID', 'Localisation', 'Type/Modèle', 'Année', 'Date vérif.', 'État'];
            const colWidths = [20, 35, 30, 15, 20, 30];
            
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
            
            items.forEach((material, index) => {
                if (currentY > pageHeight - 20) {
                    doc.addPage();
                    currentY = margin;
                    
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
                
                const yearVerification = material.verificationHistory.find(v => v.verificationYear === currentYear);
                const isConforme = checkMaterialConformity(material, currentYear);
                const conformiteText = isConforme ? 'CONFORME' : 'NON CONFORME';
                const conformiteColor = isConforme ? [50, 168, 82] : [220, 53, 69];
                
                const rowData = [
                    material.id || material.numero || 'N/A',
                    material.localisation || material.location || 'Non spécifié',
                    material.typeExtincteur || material.typeRIA || material.typeBAES || material.typeAlarme || '',
                    material.annee || '',
                    yearVerification ? formatDate(yearVerification.dateVerification) : '',
                    conformiteText
                ];
                
                if (index % 2 === 0) {
                    doc.setFillColor(248, 249, 250);
                    doc.rect(margin, currentY, contentWidth, 7, 'F');
                }
                
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
        
        if (currentY > pageHeight - 100) {
            doc.addPage();
            currentY = margin;
        }
        
        addText('COMMENTAIRE FINAL', margin, currentY, 14, 'bold', 'left', [26, 54, 93]);
        currentY += 8;
        
        const commentaireFinal = getElementValue('commentaire-final') || 
                               'Vérification annuelle des équipements de sécurité incendie effectuée conformément aux normes NF S 61-919 en vigueur.';
        
        addText(commentaireFinal, margin, currentY, 10, 'normal', 'left');
        currentY += 15;
        
        doc.addPage();
        currentY = margin;
        
        addText('VALIDATION DU RAPPORT', margin, currentY, 16, 'bold', 'center', [26, 54, 93]);
        currentY += 20;
        
        addText('VALIDITÉ DU RAPPORT', margin, currentY, 12, 'bold', 'left', [26, 54, 93]);
        currentY += 7;
        addText(`Ce rapport est valable 12 mois à compter de la date de vérification.`, margin, currentY, 10);
        currentY += 5;
        addText(`Date de la prochaine vérification recommandée: ${getNextVerificationDate()}`, margin, currentY, 10);
        currentY += 15;
        
        addText('LE TECHNICIEN', margin, currentY, 12, 'bold', 'left', [26, 54, 93]);
        currentY += 7;
        addText(technician, margin, currentY, 10);
        currentY += 15;
        
        if (technicianSignaturePad && !technicianSignaturePad.isEmpty()) {
            const signatureData = technicianSignaturePad.toDataURL('image/png');
            const signatureWidth = 60;
            const signatureHeight = 30;
            doc.addImage(signatureData, 'PNG', margin, currentY, signatureWidth, signatureHeight);
            currentY += signatureHeight + 5;
        } else {
            addLine(currentY, [0, 0, 0]);
            addText('Signature et cachet', margin + 30, currentY + 5, 9, 'italic', 'left', [100, 100, 100]);
            currentY += 20;
        }
        
        addText('LE CLIENT', margin, currentY, 12, 'bold', 'left', [26, 54, 93]);
        currentY += 7;
        addText(client.name, margin, currentY, 10);
        currentY += 15;
        
        if (clientSignaturePad && !clientSignaturePad.isEmpty()) {
            const signatureData = clientSignaturePad.toDataURL('image/png');
            const signatureWidth = 60;
            const signatureHeight = 30;
            doc.addImage(signatureData, 'PNG', margin, currentY, signatureWidth, signatureHeight);
            currentY += signatureHeight + 5;
        } else {
            addLine(currentY, [0, 0, 0]);
            addText('Signature', margin + 30, currentY + 5, 9, 'italic', 'left', [100, 100, 100]);
            currentY += 20;
        }
        
        addText('NOTE LÉGALE', margin, currentY, 10, 'bold', 'left', [73, 80, 87]);
        currentY += 6;
        addText('Ce document certifie la vérification des équipements conformément à la norme NF S 61-919.', margin, currentY, 9, 'italic', 'left', [108, 117, 125]);
        currentY += 4;
        addText('Toute reproduction ou modification non autorisée est interdite.', margin, currentY, 9, 'italic', 'left', [108, 117, 125]);
        
        const filename = `Rapport_${client.name.replace(/[^a-z0-9]/gi, '_')}_${currentYear}.pdf`;
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
        verificationHistory: []
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
        verificationHistory: []
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
        verificationHistory: []
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
    setCheckboxValue('alarme-batterie', true);
    setCheckboxValue('alarme-fonctionnement', true);
    setCheckboxValue('alarme-accessibilite', true);
    setElementValue('registre-securite', 'oui');
    
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
    
    const currentYear = new Date().getFullYear();
    const materials = AppState.verifiedMaterialsForReport || 
        AppState.currentClient.materials.filter(m => 
            m.verificationHistory && 
            m.verificationHistory.some(v => v.verificationYear === currentYear && v.verified)
        );
    
    if (materials.length === 0) {
        showError('Aucun matériel vérifié pour l\'année en cours à afficher dans le rapport');
        return;
    }
    
    const verifiedCount = materials.length;
    const today = new Date().toLocaleDateString('fr-FR');
    const technician = getElementValue('technician-name') || 'Technicien';
    const registreSecurite = getElementValue('registre-securite');
    
    const materialsByType = groupMaterialsByType(materials);
    
    let totalConforme = 0;
    let totalNonConforme = 0;
    
    Object.values(materialsByType).forEach(items => {
        items.forEach(material => {
            if (checkMaterialConformity(material, currentYear)) {
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
                    <h2 style="color: #2c5282; margin: 10px 0 0 0; font-size: 18px;">Vérification Annuelle ${currentYear} des Équipements de Sécurité Incendie</h2>
                </div>
                <div class="header-right" style="display: flex; justify-content: space-between; margin-top: 15px; font-size: 14px;">
                    <div>
                        <p><strong>Date:</strong> ${today}</p>
                        <p><strong>Référence:</strong> RAP-${currentYear}-${AppState.currentClient.id?.substr(0, 8) || '000000'}</p>
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
                        ? `Tous les matériels vérifiés (${materials.length}) sont conformes aux normes NF S 61-919`
                        : `${totalNonConforme} matériel(s) non conforme(s) sur ${materials.length} vérifié(s)`}
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
                                const yearVerification = material.verificationHistory.find(v => v.verificationYear === currentYear);
                                const isConforme = checkMaterialConformity(material, currentYear);
                                const conformiteText = isConforme ? 'CONFORME' : 'NON CONFORME';
                                const conformiteColor = isConforme ? '#28a745' : '#dc3545';
                                
                                return `
                                    <tr style="border-bottom: 1px solid #e2e8f0;">
                                        <td style="padding: 8px; border: 1px solid #ddd;"><strong>${material.id || material.numero}</strong></td>
                                        <td style="padding: 8px; border: 1px solid #ddd;">${material.localisation || material.location || 'Non spécifié'}</td>
                                        <td style="padding: 8px; border: 1px solid #ddd;">${material.typeExtincteur || material.typeRIA || material.typeBAES || material.typeAlarme || ''}</td>
                                        <td style="padding: 8px; border: 1px solid #ddd;">${material.annee || ''}</td>
                                        <td style="padding: 8px; border: 1px solid #ddd;">${yearVerification ? formatDate(yearVerification.dateVerification) : ''}</td>
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
                <h3 style="color: #1a365d; margin-top: 0; font-size: 16px;">COMMENTAIRE FINAL</h3>
                <p>${getElementValue('commentaire-final') || 'Vérification annuelle des équipements de sécurité incendie effectuée conformément aux normes NF S 61-919 en vigueur.'}</p>
            </div>
            
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
        
        const margin = 15;
        const pageWidth = doc.internal.pageSize.getWidth();
        const pageHeight = doc.internal.pageSize.getHeight();
        const contentWidth = pageWidth - (2 * margin);
        
        let currentY = margin;
        
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
        
        const totalHT = AppState.factureItems.reduce((sum, item) => sum + item.total, 0) + AppState.fraisDeplacement;
        const tva = totalHT * 0.20;
        const totalTTC = totalHT + tva;
        const today = new Date().toLocaleDateString('fr-FR');
        
        addText('FACTURE', margin, currentY, 20, 'bold', 'left', [220, 53, 69]);
        currentY += 10;
        
        addText(AppState.factureNumero, margin, currentY, 14, 'bold', 'left', [220, 53, 69]);
        addText(`Date: ${today}`, pageWidth - margin, currentY, 10, 'normal', 'right');
        currentY += 8;
        
        addLine(currentY, [220, 53, 69], 1);
        currentY += 10;
        
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
        
        addText('DÉTAIL DES ARTICLES', margin, currentY, 12, 'bold', 'left', [73, 80, 87]);
        currentY += 7;
        
        const headers = ['Description', 'Qté', 'Prix HT', 'Total HT'];
        const colWidths = [80, 20, 30, 30];
        
        doc.setFillColor(220, 53, 69);
        doc.setTextColor(255, 255, 255);
        doc.setFont('helvetica', 'bold');
        
        let xPos = margin;
        headers.forEach((header, i) => {
            doc.rect(xPos, currentY, colWidths[i], 8, 'F');
            doc.text(header, xPos + colWidths[i]/2, currentY + 5, { align: 'center' });
            xPos += colWidths[i];
        });
        
        currentY += 8;
        doc.setTextColor(0, 0, 0);
        doc.setFont('helvetica', 'normal');
        
        AppState.factureItems.forEach((item, index) => {
            if (currentY > pageHeight - 50) {
                doc.addPage();
                currentY = margin;
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
            
            const rowData = [
                item.description.substring(0, 40),
                item.quantity.toString(),
                `${item.price.toFixed(2)} €`,
                `${item.total.toFixed(2)} €`
            ];
            
            if (index % 2 === 0) {
                doc.setFillColor(248, 249, 250);
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
        
        const totals = [
            { label: 'Total HT', value: totalHT.toFixed(2) + ' €' },
            { label: 'TVA (20%)', value: tva.toFixed(2) + ' €' },
            { label: 'Total TTC', value: totalTTC.toFixed(2) + ' €' }
        ];
        
        totals.forEach((total, index) => {
            const isTotal = index === totals.length - 1;
            
            if (isTotal) {
                doc.setTextColor(220, 53, 69);
                doc.setFont('helvetica', 'bold');
            } else {
                doc.setTextColor(0, 0, 0);
                doc.setFont('helvetica', 'normal');
            }
            
            doc.text(total.label, margin + 100, currentY, { align: 'right' });
            doc.text(total.value, margin + 140, currentY, { align: 'right' });
            
            currentY += isTotal ? 8 : 6;
        });
        
        doc.setTextColor(0, 0, 0);
        doc.setFont('helvetica', 'normal');
        
        currentY += 15;
        
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
        
        addText('SIGNATURES', margin, currentY, 12, 'bold', 'left', [73, 80, 87]);
        currentY += 10;
        
        addText('LE TECHNICIEN', margin, currentY, 10, 'bold');
        currentY += 5;
        
        if (technicianSignaturePad && !technicianSignaturePad.isEmpty()) {
            const signatureData = technicianSignaturePad.toDataURL('image/png');
            const signatureWidth = 60;
            const signatureHeight = 30;
            doc.addImage(signatureData, 'PNG', margin, currentY, signatureWidth, signatureHeight);
            currentY += signatureHeight + 10;
        } else {
            addLine(currentY, [0, 0, 0]);
            addText('Signature et cachet', margin + 30, currentY + 5, 9, 'italic', 'left', [100, 100, 100]);
            currentY += 20;
        }
        
        addText('LE CLIENT', margin, currentY, 10, 'bold');
        currentY += 5;
        addText(client.name, margin, currentY, 10);
        currentY += 5;
        
        if (clientSignaturePad && !clientSignaturePad.isEmpty()) {
            const signatureData = clientSignaturePad.toDataURL('image/png');
            const signatureWidth = 60;
            const signatureHeight = 30;
            doc.addImage(signatureData, 'PNG', margin, currentY, signatureWidth, signatureHeight);
            currentY += signatureHeight + 10;
        } else {
            addLine(currentY, [0, 0, 0]);
            addText('Signature', margin + 30, currentY + 5, 9, 'italic', 'left', [100, 100, 100]);
            currentY += 20;
        }
        
        addText('Fait pour valoir et servir que de droit', margin, currentY, 10, 'italic');
        currentY += 10;
        addText(`Le ${today}`, margin, currentY, 10);
        
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
function generatePDFFromPreview() {
    generatePDFReport();
}

function generateFacturePDFFromPreview() {
    generateFacturePDF();
}

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

// ==================== FONCTIONS DE RAFRAÎCHISSEMENT ====================
function refreshAllLists() {
    // Rafraîchir toutes les listes visibles
    if (AppState.currentPage === 'materials') {
        displayMaterialsListSimplified();
    }
    if (AppState.currentPage === 'verification') {
        displayVerificationList();
    }
    if (AppState.currentPage === 'history') {
        loadHistory();
    }
}

// ==================== VÉRIFICATION DE CONFORMITÉ ====================
function checkMaterialConformity(material, verificationYear) {
    if (!material.verificationHistory) return false;
    
    const yearVerification = material.verificationHistory.find(v => v.verificationYear === verificationYear);
    if (!yearVerification || !yearVerification.verified) {
        return false;
    }
    
    // Vérifications spécifiques par type
    switch(material.type) {
        case 'extincteur':
            return checkExtincteurConformity(material);
        case 'ria':
            return checkRIAConformity(material);
        case 'baes':
            return checkBAESConformity(material);
        case 'alarme':
            return checkAlarmeConformity(material);
        default:
            return true;
    }
}

function checkExtincteurConformity(material) {
    // Vérifier les observations - SEUL CRITÈRE FORT
    if (material.observations && material.observations.toLowerCase().includes('non conforme')) {
        return false; // NON CONFORME
    }
    
    // Vérifier les champs OK/NOK SAUF "joints"
    const verificationFields = ['etatGeneral', 'lisibilite', 'panneau', 'goupille', 'pression', 'accessibilite'];
    for (const field of verificationFields) {
        if (material[field] === 'Non OK') {
            return false; // NON CONFORME
        }
    }
    
    // Âge ≥ 10 ans → IGNORÉ (ne rend plus non conforme)
    // joints = "Non OK" → IGNORÉ (ne rend plus non conforme)
    
    return true; // CONFORME
}


function checkRIAConformity(material) {
    if (material.observations && material.observations.toLowerCase().includes('non conforme')) {
        return false;
    }
    
    const verificationFields = ['etatGeneral', 'lisibilite', 'panneau', 'accessibilite'];
    for (const field of verificationFields) {
        if (material[field] === 'Non OK') {
            return false;
        }
    }
    
    return true;
}

function checkBAESConformity(material) {
    if (material.observations && material.observations.toLowerCase().includes('non conforme')) {
        return false;
    }
    
    const verificationFields = ['etatGeneral', 'fonctionnement', 'chargeur', 'accessibilite'];
    for (const field of verificationFields) {
        if (material[field] === 'Non OK') {
            return false;
        }
    }
    
    return true;
}

function checkAlarmeConformity(material) {
    if (material.observations && material.observations.toLowerCase().includes('non conforme')) {
        return false;
    }
    
    if (!material.batterie || !material.fonctionnement || !material.accessibilite) {
        return false;
    }
    
    return true;
}

// ==================== FONCTIONS D'EXTINCTEUR ====================
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
        verificationHistory: []
    };
}

// ==================== CHARGEMENT DES FILTRES PERSISTANTS ====================
function loadPersistentFilters() {
    try {
        const savedFilters = localStorage.getItem('verification_filters');
        if (savedFilters) {
            AppState.currentFamilyFilter = JSON.parse(savedFilters);
        }
    } catch (error) {
        console.warn('Erreur chargement filtres:', error);
        AppState.currentFamilyFilter = [...CONFIG.familyFilters];
    }
}

// ==================== VÉRIFICATION ANNUELLE AU DÉMARRAGE ====================
function checkAnnualVerification() {
    if (!AppState.currentClient || !AppState.currentClient.materials) return;
    
    const currentYear = new Date().getFullYear();
    let needsVerification = false;
    
    AppState.currentClient.materials.forEach(material => {
        const status = getMaterialVerificationStatus(material, currentYear);
        if (!status.verified) {
            needsVerification = true;
        }
    });
    
    if (needsVerification && AppState.currentClient.lastVerificationYear !== currentYear) {
        console.log('🔔 Vérification annuelle requise pour', AppState.currentClient.name);
        showToast('Vérification annuelle requise pour ce client', 'warning', 5000);
    }
}

// ==================== AJOUTER TOUTES LES FONCTIONS AU WINDOW ====================
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
window.addExtincteurToList = addExtincteurToList;
window.addRIAToList = addRIAToList;
window.addBAESToList = addBAESToList;
window.addAlarmeToList = addAlarmeToList;
window.updateExtincteur = updateExtincteur;
window.updateRIA = updateRIA;
window.updateBAES = updateBAES;
window.updateAlarme = updateAlarme;
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
window.editMaterial = editMaterial;
window.removeMaterialPermanent = removeMaterialPermanent;
window.removeFromVerification = removeFromVerification;
window.verifyMaterial = verifyMaterial;
window.resetMaterialVerification = resetMaterialVerification;
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
window.checkAnnualVerification = checkAnnualVerification;
window.refreshAllLists = refreshAllLists;
window.displayMaterialsListSimplified = displayMaterialsListSimplified;
window.displayVerificationList = displayVerificationList;
window.toggleFamilyFilter = toggleFamilyFilter;
window.selectAllFamilies = selectAllFamilies;
window.clearAllFamilies = clearAllFamilies;
window.searchVerificationMaterials = searchVerificationMaterials;
window.finishVerification = finishVerification;

// ==================== PRÉCHARGEMENT DES PAGES ====================
function preloadNextPages() {
    console.log('🔄 Préchargement des pages suivantes...');
    
    const pagesToPreload = ['materials', 'verification', 'signature', 'history', 'planning'];
    let loadedCount = 0;
    
    pagesToPreload.forEach(page => {
        const pageElement = document.getElementById(`page-${page}`);
        if (pageElement && !pageElement.dataset.preloaded) {
            pageElement.dataset.preloaded = 'true';
            loadedCount++;
            
            if (page === 'materials') {
                const buttons = pageElement.querySelectorAll('button');
                buttons.forEach(btn => {
                    if (btn.onclick) {
                        btn.setAttribute('data-original-onclick', btn.onclick.toString());
                    }
                });
            }
        }
    });
    
    console.log(`✅ ${loadedCount} page(s) préchargée(s)`);
    
    if (loadedCount > 0) {
        showToast(`${loadedCount} page(s) préchargée(s) pour une navigation plus rapide`, 'success', 2000);
    }
    
    return loadedCount;
}

function initPagePreloading() {
    // Charger les filtres persistants
    loadPersistentFilters();
    
    setTimeout(() => {
        preloadNextPages();
    }, 2000);
    
    let inactivityTimer;
    function resetInactivityTimer() {
        clearTimeout(inactivityTimer);
        inactivityTimer = setTimeout(() => {
            const currentPage = AppState.currentPage;
            if (currentPage === 'clients') {
                preloadNextPages();
            }
        }, 5000);
    }
    
    ['mousemove', 'keydown', 'click', 'scroll'].forEach(event => {
        window.addEventListener(event, resetInactivityTimer);
    });
    
    resetInactivityTimer();
}

window.preloadNextPages = preloadNextPages;
window.initPagePreloading = initPagePreloading;

// Vérification annuelle au démarrage
setTimeout(() => {
    checkAnnualVerification();
}, 1000);

console.log('🎉 Application FireCheck Pro avec vérification annuelle simplifiée initialisée avec succès !');


// ==================== FILTRES AVEC COCHES VERTES SIMPLES ====================

// Fonction principale de filtrage
function filterVerification(type) {
    console.log("Filtre cliqué :", type);
    
    if (type === 'all') {
        // Basculer "Tous"
        if (AppState.currentFamilyFilter.length === CONFIG.familyFilters.length) {
            // Tous déjà sélectionnés → tout désélectionner
            AppState.currentFamilyFilter = [];
        } else {
            // Sinon → tout sélectionner
            AppState.currentFamilyFilter = [...CONFIG.familyFilters];
        }
    } else {
        // Basculer un filtre individuel
        const index = AppState.currentFamilyFilter.indexOf(type);
        if (index === -1) {
            AppState.currentFamilyFilter.push(type);
        } else {
            AppState.currentFamilyFilter.splice(index, 1);
        }
    }
    
    // Sauvegarder
    localStorage.setItem('verification_filters', JSON.stringify(AppState.currentFamilyFilter));
    
    // Mettre à jour l'interface
    updateFilterButtonsWithChecks();
    
    // Rafraîchir la liste
    if (typeof displayVerificationList === 'function') {
        displayVerificationList();
    }
}

// Mettre à jour les boutons avec des coches vertes
function updateFilterButtonsWithChecks() {
    document.querySelectorAll('.family-filter-btn').forEach(btn => {
        const type = btn.getAttribute('data-filter-type') || 
                     btn.id.replace('filter-', '');
        
        // Vérifier si actif
        let isActive = false;
        
        if (type === 'all') {
            isActive = AppState.currentFamilyFilter.length === CONFIG.familyFilters.length;
        } else {
            isActive = AppState.currentFamilyFilter.includes(type);
        }
        
        // Supprimer la coche existante
        const existingCheck = btn.querySelector('.filter-checkmark');
        if (existingCheck) {
            existingCheck.remove();
        }
        
        // Réinitialiser les styles
        btn.style.backgroundColor = '#f8f9fa';
        btn.style.border = '1px solid #dee2e6';
        btn.style.color = '#495057';
        btn.style.position = 'relative';
        btn.style.paddingRight = '35px'; // Espace pour la coche
        
        // Ajouter la coche si actif
        if (isActive) {
            const checkmark = document.createElement('span');
            checkmark.className = 'filter-checkmark';
            checkmark.innerHTML = '✓';
            checkmark.style.cssText = `
                position: absolute;
                right: 10px;
                top: 50%;
                transform: translateY(-50%);
                color: #28a745;
                font-weight: bold;
                font-size: 14px;
            `;
            btn.appendChild(checkmark);
            
            // Style léger pour le bouton actif
            btn.style.backgroundColor = '#f0f9f0';
            btn.style.borderColor = '#c3e6cb';
        }
        
        // Classe CSS pour compatibilité
        btn.classList.toggle('active', isActive);
    });
}

// CSS pour les coches
function addCheckmarkStyles() {
    const style = document.createElement('style');
    style.textContent = `
        .family-filter-buttons {
            display: flex;
            flex-wrap: wrap;
            gap: 10px;
            margin: 15px 0;
        }
        
        .family-filter-btn {
            position: relative;
            padding: 8px 35px 8px 15px;
            border: 1px solid #dee2e6;
            background: #f8f9fa;
            border-radius: 6px;
            color: #495057;
            cursor: pointer;
            transition: all 0.2s ease;
            font-size: 0.9em;
            display: flex;
            align-items: center;
            gap: 8px;
            min-height: 40px;
        }
        
        .family-filter-btn:hover {
            background: #e9ecef;
            transform: translateY(-1px);
        }
        
        .family-filter-btn.active {
            background: #f0f9f0;
            border-color: #c3e6cb;
        }
        
        .family-filter-header {
            display: flex;
            align-items: center;
            gap: 8px;
            margin-bottom: 10px;
            color: #495057;
            font-weight: 500;
        }
        
        /* Responsive */
        @media (max-width: 768px) {
            .family-filter-buttons {
                gap: 8px;
            }
            
            .family-filter-btn {
                padding: 6px 30px 6px 12px;
                font-size: 0.85em;
                min-height: 36px;
            }
        }
        
        @media (max-width: 480px) {
            .family-filter-buttons {
                justify-content: center;
            }
            
            .family-filter-btn {
                flex: 1;
                min-width: 140px;
                justify-content: center;
            }
        }
    `;
    document.head.appendChild(style);
}

// Initialiser les filtres
function initFilterVerification() {
    // Charger les préférences
    try {
        const saved = localStorage.getItem('verification_filters');
        if (saved) {
            AppState.currentFamilyFilter = JSON.parse(saved);
        } else {
            // Par défaut : tout sélectionné
            AppState.currentFamilyFilter = [...CONFIG.familyFilters];
        }
    } catch (e) {
        console.warn("Erreur filtres:", e);
        AppState.currentFamilyFilter = [...CONFIG.familyFilters];
    }
    
    // Ajouter les styles
    addCheckmarkStyles();
    
    // Mettre à jour les boutons
    setTimeout(updateFilterButtonsWithChecks, 500);
}

// Exposer les fonctions
window.filterVerification = filterVerification;
window.updateFilterButtonsWithChecks = updateFilterButtonsWithChecks;

// Initialiser au chargement
document.addEventListener('DOMContentLoaded', function() {
    setTimeout(initFilterVerification, 1000);
});

console.log('✅ Filtres avec coches vertes chargés');

// ==================== FONCTION DE RECHERCHE CORRIGÉE ====================

// Fonction de recherche principale
function searchVerification() {
    console.log("🔍 searchVerification() appelée");
    
    // 1. Récupérer la valeur de recherche
    const searchInput = document.getElementById('verification-search');
    if (!searchInput) {
        console.error("❌ Input de recherche non trouvé");
        return;
    }
    
    const searchTerm = searchInput.value.toLowerCase().trim();
    console.log("Terme recherché:", searchTerm);
    
    // 2. Stocker dans AppState
    AppState.verificationSearchTerm = searchTerm;
    
    // 3. Appeler la fonction d'affichage existante
    if (typeof displayVerificationList === 'function') {
        displayVerificationList();
    } else {
        console.error("❌ displayVerificationList non disponible");
        // Fallback: filtrer manuellement
        filterMaterialsManually(searchTerm);
    }
}

// Fallback si displayVerificationList n'existe pas
function filterMaterialsManually(searchTerm) {
    const items = document.querySelectorAll('.compact-material-item');
    console.log(`${items.length} éléments à filtrer`);
    
    items.forEach(item => {
        const text = item.textContent.toLowerCase();
        if (searchTerm === '' || text.includes(searchTerm)) {
            item.style.display = 'flex';
        } else {
            item.style.display = 'none';
        }
    });
}

// Rendre la fonction disponible GLOBALEMENT
window.searchVerification = searchVerification;

// Pour le débogage
console.log("✅ searchVerification chargée dans window");


// ==================== FONCTION TERMINER LA VÉRIFICATION AVEC FILTRES ====================

function completeVerification() {
    console.log("🎯 Terminer la vérification avec filtres");
    
    // Vérifier qu'un client est sélectionné
    if (!AppState.currentClient) {
        showError("Veuillez d'abord sélectionner un client");
        return;
    }
    
    // Vérifier qu'il y a des matériels
    if (!AppState.currentClient.materials || AppState.currentClient.materials.length === 0) {
        showError("Aucun matériel dans la liste du client");
        return;
    }
    
    const currentYear = new Date().getFullYear();
    
    // 1. Récupérer les matériels FILTRÉS
    const filteredMaterials = getFilteredMaterials();
    
    if (filteredMaterials.length === 0) {
        showError("Aucun matériel correspond aux filtres sélectionnés");
        return;
    }
    
    // 2. Vérifier que TOUS les matériels filtrés sont validés
    const allVerified = filteredMaterials.every(material => {
        const status = getMaterialVerificationStatus(material, currentYear);
        return status.verified;
    });
    
    if (!allVerified) {
        const pendingCount = filteredMaterials.filter(m => {
            const status = getMaterialVerificationStatus(m, currentYear);
            return !status.verified;
        }).length;
        
        showError(`${pendingCount} matériel(s) restent à valider dans les filtres sélectionnés`);
        return;
    }
    
    // 3. Demander confirmation
    const filtersText = AppState.currentFamilyFilter.length === CONFIG.familyFilters.length 
        ? "Tous les matériels" 
        : AppState.currentFamilyFilter.map(f => getFamilyName(f)).join(", ");
    
    if (!confirm(`Voulez-vous terminer la vérification de ${filteredMaterials.length} matériel(s) (${filtersText}) ?

✓ Les matériels vérifiés seront exportés dans le rapport PDF
✓ Vous serez redirigé vers l'onglet Signature
✓ Le rapport pourra être généré immédiatement`)) {
        return;
    }
    
    // 4. Préparer les données pour le rapport PDF
    AppState.verifiedMaterialsForReport = filteredMaterials;
    
    // 5. Mettre à jour le client
    AppState.currentClient.lastVerificationYear = currentYear;
    AppState.currentClient.lastVerificationDate = new Date().toISOString();
    
    // 6. Sauvegarder
    if (typeof saveCurrentClientChanges === 'function') {
        saveCurrentClientChanges();
    }
    
    // 7. Afficher succès
    showSuccess(`${filteredMaterials.length} matériel(s) vérifié(s) - Redirection vers Signature...`);
    
    // 8. Désactiver le bouton temporairement
    const completeBtn = document.getElementById('complete-btn');
    if (completeBtn) {
        completeBtn.disabled = true;
        completeBtn.innerHTML = '<i class="fas fa-check-circle"></i> Terminée !';
    }
    
    // 9. Rediriger vers la signature après 2 secondes
    setTimeout(() => {
        navigateTo('signature');
        
        // Réactiver le bouton après la redirection
        setTimeout(() => {
            if (completeBtn) {
                completeBtn.disabled = false;
                completeBtn.innerHTML = '<i class="fas fa-check-double"></i> Terminer la vérification';
            }
        }, 3000);
    }, 2000);
}

// Obtenir le nom de la famille
function getFamilyName(family) {
    const names = {
        'extincteur': 'Extincteurs',
        'ria': 'RIA',
        'baes': 'BAES',
        'alarme': 'Alarmes'
    };
    return names[family] || family;
}

// Mettre à jour l'état du bouton selon les filtres
function updateCompleteButton() {
    const completeBtn = document.getElementById('complete-btn');
    if (!completeBtn) return;
    
    // Si pas de client ou pas de matériels
    if (!AppState.currentClient || !AppState.currentClient.materials) {
        completeBtn.disabled = true;
        completeBtn.title = "Sélectionnez d'abord un client avec des matériels";
        return;
    }
    
    // Si pas de filtres sélectionnés
    if (AppState.currentFamilyFilter.length === 0) {
        completeBtn.disabled = true;
        completeBtn.title = "Sélectionnez au moins un type de matériel dans les filtres";
        return;
    }
    
    const currentYear = new Date().getFullYear();
    
    // 1. Récupérer les matériels filtrés
    const filteredMaterials = getFilteredMaterials();
    
    if (filteredMaterials.length === 0) {
        completeBtn.disabled = true;
        completeBtn.title = "Aucun matériel correspond aux filtres sélectionnés";
        return;
    }
    
    // 2. Vérifier combien sont vérifiés
    const verifiedCount = filteredMaterials.filter(material => {
        const status = getMaterialVerificationStatus(material, currentYear);
        return status.verified;
    }).length;
    
    const pendingCount = filteredMaterials.length - verifiedCount;
    
    // 3. Déterminer si le bouton doit être activé
    const allVerified = pendingCount === 0;
    
    completeBtn.disabled = !allVerified;
    
    // 4. Mettre à jour le texte et l'info-bulle
    if (allVerified) {
        completeBtn.title = `Tous les matériels sont vérifiés (${filteredMaterials.length}) - Cliquez pour générer le rapport`;
        
        // Mettre à jour le texte du bouton
        const filtersText = AppState.currentFamilyFilter.length === CONFIG.familyFilters.length 
            ? "Tous" 
            : AppState.currentFamilyFilter.map(f => getFamilyName(f).substring(0, 3)).join("+");
        
        const btnSpan = completeBtn.querySelector('span');
        if (btnSpan) {
            btnSpan.textContent = `Terminer (${filtersText}: ${filteredMaterials.length})`;
        }
    } else {
        completeBtn.title = `${pendingCount} matériel(s) à vérifier dans les filtres sélectionnés`;
        
        const btnSpan = completeBtn.querySelector('span');
        if (btnSpan) {
            btnSpan.textContent = `Terminer (${pendingCount} restant(s))`;
        }
    }
}

// Fonction pour obtenir les matériels filtrés (doit exister)
function getFilteredMaterials() {
    if (!AppState.currentClient || !AppState.currentClient.materials) {
        return [];
    }
    
    // Filtrer par famille
    let filtered = AppState.currentClient.materials.filter(material => {
        return AppState.currentFamilyFilter.includes(material.type);
    });
    
    // Filtrer par recherche si applicable
    const searchInput = document.getElementById('verification-search');
    if (searchInput && searchInput.value.trim() !== '') {
        const searchTerm = searchInput.value.toLowerCase().trim();
        filtered = filtered.filter(material => {
            const searchableText = [
                material.id || material.numero || '',
                material.localisation || material.location || '',
                material.typeExtincteur || material.typeRIA || material.typeBAES || material.typeAlarme || '',
                material.observations || ''
            ].join(' ').toLowerCase();
            
            return searchableText.includes(searchTerm);
        });
    }
    
    return filtered;
}

// Vérifier l'état automatiquement
function checkVerificationStatus() {
    if (AppState.currentPage === 'verification') {
        updateCompleteButton();
        
        // Vérifier à nouveau dans 1 seconde
        setTimeout(checkVerificationStatus, 1000);
    }
}

// Surveiller les changements de filtres
function watchFilterChanges() {
    // Sauvegarder la fonction originale
    const originalFilterVerification = window.filterVerification;
    
    // Redéfinir pour surveiller les changements
    if (originalFilterVerification) {
        window.filterVerification = function(type) {
            const result = originalFilterVerification(type);
            
            // Mettre à jour le bouton après changement de filtre
            setTimeout(updateCompleteButton, 100);
            
            return result;
        };
    }
    
    // Surveiller aussi les changements de recherche
    const searchInput = document.getElementById('verification-search');
    if (searchInput) {
        searchInput.addEventListener('input', function() {
            setTimeout(updateCompleteButton, 300);
        });
    }
}

// Initialiser le système
function initVerificationCompleteSystem() {
    console.log("🔄 Initialisation système de vérification");
    
    // Vérifier que le bouton existe
    let completeBtn = document.getElementById('complete-btn');
    
    if (!completeBtn) {
        const actionsDiv = document.querySelector('.page-actions');
        if (actionsDiv) {
            completeBtn = document.createElement('button');
            completeBtn.id = 'complete-btn';
            completeBtn.className = 'btn btn-success';
            completeBtn.innerHTML = '<i class="fas fa-check-double"></i> <span>Terminer la vérification</span>';
            completeBtn.onclick = completeVerification;
            actionsDiv.appendChild(completeBtn);
        }
    }
    
    // Surveiller les filtres
    watchFilterChanges();
    
    // Démarrer la vérification automatique
    setTimeout(checkVerificationStatus, 500);
    
    // Mettre à jour quand un matériel est validé
    const originalVerifyMaterial = window.verifyMaterial;
    if (originalVerifyMaterial) {
        window.verifyMaterial = function(index) {
            const result = originalVerifyMaterial(index);
            setTimeout(updateCompleteButton, 100);
            return result;
        };
    }
    
    // Même chose pour reset
    const originalResetVerification = window.resetMaterialVerification;
    if (originalResetVerification) {
        window.resetMaterialVerification = function(index) {
            const result = originalResetVerification(index);
            setTimeout(updateCompleteButton, 100);
            return result;
        };
    }
}

// CSS amélioré pour le bouton
const verificationButtonCSS = document.createElement('style');
verificationButtonCSS.textContent = `
    #complete-btn {
        padding: 12px 24px;
        font-size: 1.1em;
        font-weight: 600;
        border-radius: 8px;
        transition: all 0.3s ease;
        display: flex;
        align-items: center;
        gap: 10px;
        min-width: 260px;
        justify-content: center;
        position: relative;
        overflow: hidden;
    }
    
    #complete-btn:not(:disabled) {
        background: linear-gradient(135deg, #28a745 0%, #1e7e34 100%);
        border: none;
        box-shadow: 0 4px 8px rgba(40, 167, 69, 0.3);
    }
    
    #complete-btn:not(:disabled):hover {
        transform: translateY(-2px);
        box-shadow: 0 6px 12px rgba(40, 167, 69, 0.4);
        background: linear-gradient(135deg, #1e7e34 0%, #155724 100%);
    }
    
    #complete-btn:disabled {
        background: #6c757d;
        opacity: 0.7;
        cursor: not-allowed;
        box-shadow: none;
    }
    
    #complete-btn i {
        font-size: 1.2em;
    }
    
    /* Indicateur visuel */
    #complete-btn::after {
        content: '';
        position: absolute;
        top: 0;
        left: -100%;
        width: 100%;
        height: 100%;
        background: linear-gradient(90deg, transparent, rgba(255,255,255,0.2), transparent);
        transition: left 0.5s;
    }
    
    #complete-btn:not(:disabled):hover::after {
        left: 100%;
    }
    
    @media (max-width: 768px) {
        #complete-btn {
            padding: 10px 20px;
            font-size: 1em;
            min-width: 240px;
        }
    }
    
    @media (max-width: 480px) {
        #complete-btn {
            width: 100%;
            min-width: auto;
        }
    }
`;
document.head.appendChild(verificationButtonCSS);

// Intégration avec la navigation
const originalNavigate = window.navigateTo;
if (originalNavigate) {
    window.navigateTo = function(page) {
        originalNavigate(page);
        
        if (page === 'verification') {
            // Initialiser après l'affichage de la page
            setTimeout(initVerificationCompleteSystem, 300);
        }
    };
}

// Exposer les fonctions
window.completeVerification = completeVerification;
window.updateCompleteButton = updateCompleteButton;
window.getFilteredMaterials = getFilteredMaterials;

// Initialiser au démarrage
document.addEventListener('DOMContentLoaded', function() {
    // Vérifier si on est déjà sur la page vérification
    if (AppState.currentPage === 'verification') {
        setTimeout(initVerificationCompleteSystem, 1000);
    }
    
    // Initialiser les filtres par défaut si vide
    if (!AppState.currentFamilyFilter || AppState.currentFamilyFilter.length === 0) {
        AppState.currentFamilyFilter = [...CONFIG.familyFilters];
    }
});

console.log("✅ Système 'Terminer la vérification' chargé avec gestion des filtres");


// ==================== SOLUTION AVEC ID UNIQUES POUR VÉRIFICATION ====================
function displayVerificationList() {
    const verificationList = document.getElementById('verification-list');
    const verificationSearch = document.getElementById('verification-search');
    
    if (!verificationList) return;
    
    updateClientInfoBadge();
    
    if (!AppState.currentClient || !AppState.currentClient.materials || AppState.currentClient.materials.length === 0) {
        showEmptyState(verificationList, 'verification');
        updateVerificationStats(0, 0, 0);
        updateFilterCounts();
        updateCompleteButton();
        return;
    }
    
    const searchTerm = verificationSearch ? verificationSearch.value.toLowerCase() : '';
    const filteredMaterials = getFilteredMaterials(searchTerm);
    
    if (filteredMaterials.length === 0) {
        showEmptyState(verificationList, 'verification');
        updateVerificationStats(0, 0, 0);
        updateFilterCounts();
        updateCompleteButton();
        return;
    }
    
    const currentYear = new Date().getFullYear();
    let verifiedCount = 0;
    
    verificationList.innerHTML = filteredMaterials.map((material, filteredIndex) => {
        const materialInfo = getMaterialInfo(material.type);
        const status = getMaterialVerificationStatus(material, currentYear);
        const isVerified = status.verified;
        
        if (isVerified) verifiedCount++;
        
        // Créer un ID unique basé sur les propriétés du matériel
        const materialUniqueId = generateMaterialUniqueId(material, filteredIndex);
        
        const location = material.localisation || material.location || 'Non spécifié';
        const type = material.typeExtincteur || material.typeRIA || material.typeBAES || material.typeAlarme || 'Type non spécifié';
        const annee = material.annee ? ` • Année: ${material.annee}` : '';
        const verificationDate = status.currentVerification?.dateVerification 
            ? `<div class="verification-date"><i class="fas fa-calendar-check"></i> Vérifié le ${formatDate(status.currentVerification.dateVerification)}</div>`
            : '';
        
        const statusColor = isVerified ? 'success' : 'warning';
        const statusText = isVerified ? 'Vérifié' : 'À vérifier';
        const statusIcon = isVerified ? 'fa-check-circle' : 'fa-clock';
        
        return `
            <div class="compact-material-item ${materialInfo.class}" data-unique-id="${materialUniqueId}">
                <div class="compact-material-info">
                    <div class="compact-material-header">
                        <i class="fas ${materialInfo.icon}"></i>
                        <strong>${material.id || material.numero}</strong>
                        <span class="material-family-badge">${materialInfo.text}</span>
                        <span class="material-status status-${statusColor}">
                            <i class="fas ${statusIcon}"></i> ${statusText}
                        </span>
                    </div>
                    <div class="compact-material-details">
                        <div><i class="fas fa-map-marker-alt"></i> ${location}</div>
                        <div><i class="fas fa-tag"></i> ${type}${annee}</div>
                        ${verificationDate}
                    </div>
                </div>
                <div class="compact-material-actions">
                    <div class="action-buttons">
                        <button class="btn btn-sm btn-edit" onclick="handleEditMaterial('${materialUniqueId}')" 
                                title="Modifier le matériel">
                            <i class="fas fa-edit"></i>
                        </button>
                        
                        <button class="btn btn-sm ${isVerified ? 'btn-validated' : 'btn-validate'}" 
                                onclick="handleVerifyMaterial('${materialUniqueId}', ${isVerified})" 
                                title="${isVerified ? 'Annuler la validation' : 'Valider le matériel'}">
                            <i class="fas ${isVerified ? 'fa-undo' : 'fa-check'}"></i>
                        </button>
                        
                        <button class="btn btn-sm btn-delete" onclick="handleRemoveFromVerification('${materialUniqueId}')" 
                                title="Retirer de la vérification">
                            <i class="fas fa-trash"></i>
                        </button>
                    </div>
                </div>
            </div>
        `;
    }).join('');
    
    const pendingCount = filteredMaterials.length - verifiedCount;
    updateVerificationStats(filteredMaterials.length, verifiedCount, pendingCount);
    updateFilterCounts();
    updateCompleteButton();
}

// ==================== FONCTIONS D'AIDE POUR ID UNIQUES ====================
function generateMaterialUniqueId(material, filteredIndex) {
    // Créer un ID unique basé sur les propriétés du matériel
    const baseId = material.id || material.numero || `mat_${filteredIndex}`;
    const type = material.type || 'unknown';
    const location = material.localisation || material.location || 'unknown';
    
    // Combiner pour créer un ID vraiment unique
    return `${type}_${baseId}_${location}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

function findMaterialByUniqueId(uniqueId) {
    if (!AppState.currentClient?.materials) return { material: null, index: -1 };
    
    const allMaterials = AppState.currentClient.materials;
    
    // Extraire l'ID de base de l'ID unique
    const baseIdMatch = uniqueId.match(/^(extincteur|ria|baes|alarme)_(.+?)_.+$/);
    if (baseIdMatch) {
        const [, type, baseId] = baseIdMatch;
        
        // Chercher d'abord par ID complet (pour les nouveaux matériels)
        for (let i = 0; i < allMaterials.length; i++) {
            const material = allMaterials[i];
            const materialUniqueId = generateMaterialUniqueId(material, i);
            if (materialUniqueId === uniqueId) {
                return { material, index: i };
            }
        }
        
        // Sinon, chercher par ID de base
        for (let i = 0; i < allMaterials.length; i++) {
            const material = allMaterials[i];
            if (material.type === type) {
                const materialBaseId = material.id || material.numero;
                if (materialBaseId && materialBaseId.toString() === baseId.toString()) {
                    return { material, index: i };
                }
            }
        }
    }
    
    // Fallback : chercher dans tous les matériels filtrés
    const filteredMaterials = getFilteredMaterials();
    for (let i = 0; i < filteredMaterials.length; i++) {
        const material = filteredMaterials[i];
        const materialUniqueId = generateMaterialUniqueId(material, i);
        if (materialUniqueId === uniqueId) {
            // Trouver l'index réel
            const realIndex = AppState.currentClient.materials.findIndex(m => 
                m === material || 
                (m.id && material.id && m.id === material.id) ||
                (m.numero && material.numero && m.numero === material.numero)
            );
            if (realIndex !== -1) {
                return { material, index: realIndex };
            }
        }
    }
    
    return { material: null, index: -1 };
}

// ==================== GESTIONNAIRES D'ÉVÉNEMENTS AVEC ID UNIQUES ====================
function handleEditMaterial(uniqueId) {
    console.log("✏️ Édition avec ID unique:", uniqueId);
    
    const { material, index } = findMaterialByUniqueId(uniqueId);
    if (material && index !== -1) {
        editMaterial(index);
    } else {
        showError("Matériel non trouvé pour édition");
        console.error("Matériel non trouvé, ID unique:", uniqueId);
    }
}

function handleVerifyMaterial(uniqueId, isCurrentlyVerified) {
    console.log(`✅ Validation avec ID unique: ${uniqueId}, Actuellement vérifié: ${isCurrentlyVerified}`);
    
    const { material, index } = findMaterialByUniqueId(uniqueId);
    if (material && index !== -1) {
        if (isCurrentlyVerified) {
            resetMaterialVerification(index);
        } else {
            verifyMaterial(index);
        }
    } else {
        showError("Matériel non trouvé pour validation");
        console.error("Matériel non trouvé, ID unique:", uniqueId);
    }
}

function handleRemoveFromVerification(uniqueId) {
    console.log("🗑️ Suppression avec ID unique:", uniqueId);
    
    const { material, index } = findMaterialByUniqueId(uniqueId);
    if (material && index !== -1) {
        removeFromVerification(index);
    } else {
        showError("Matériel non trouvé pour suppression");
        console.error("Matériel non trouvé, ID unique:", uniqueId);
    }
}

// ==================== FONCTIONS DE DÉBOGAGE ====================
function debugMaterials() {
    if (!AppState.currentClient) {
        console.log("❌ Aucun client sélectionné");
        return;
    }
    
    console.log("=== DÉBOGAGE MATÉRIELS ===");
    console.log("Client:", AppState.currentClient.name);
    console.log("Nombre total de matériels:", AppState.currentClient.materials?.length || 0);
    
    if (AppState.currentClient.materials) {
        AppState.currentClient.materials.forEach((material, index) => {
            console.log(`[${index}] ID: ${material.id || material.numero}, Type: ${material.type}, Localisation: ${material.localisation || material.location}`);
        });
    }
    
    const filteredMaterials = getFilteredMaterials();
    console.log("Matériels filtrés:", filteredMaterials.length);
    filteredMaterials.forEach((material, index) => {
        console.log(`Filtré [${index}] ID: ${material.id || material.numero}, Type: ${material.type}`);
    });
}

// ==================== SURCHARGE DES FONCTIONS EXISTANTES ====================
// Remplace la fonction displayVerificationList existante
window.displayVerificationList = displayVerificationList;

// Ajoute les nouvelles fonctions au scope global
window.handleEditMaterial = handleEditMaterial;
window.handleVerifyMaterial = handleVerifyMaterial;
window.handleRemoveFromVerification = handleRemoveFromVerification;
window.debugMaterials = debugMaterials;

// ==================== TEST AUTOMATIQUE ====================
function testMaterialSelection() {
    console.log("🧪 Test de sélection de matériels...");
    
    if (!AppState.currentClient?.materials?.length) {
        console.log("❌ Aucun matériel à tester");
        return;
    }
    
    // Créer des IDs uniques pour chaque matériel
    AppState.currentClient.materials.forEach((material, index) => {
        const uniqueId = generateMaterialUniqueId(material, index);
        const found = findMaterialByUniqueId(uniqueId);
        
        if (found.material && found.index === index) {
            console.log(`✅ Matériel ${index} correctement identifié: ${material.id || material.numero}`);
        } else {
            console.log(`❌ Problème avec matériel ${index}: ${material.id || material.numero}`);
        }
    });
    
    console.log("🧪 Test terminé");
}

// Exécuter le test au chargement
setTimeout(() => {
    if (AppState.currentClient?.materials?.length > 0) {
        testMaterialSelection();
    }
}, 2000);

console.log('🎉 Système d\'ID uniques pour matériels initialisé !');

// ==================== CORRECTION DES BOUTONS AJOUTER ====================

// Initialisation des boutons d'ajout de matériel
function initMaterialAddButtons() {
    console.log("🔧 Initialisation des boutons d'ajout de matériel...");
    
    // Bouton RIA
    const addRiaBtn = document.querySelector('[onclick*="openAddRIAModal"]');
    if (addRiaBtn) {
        console.log("✅ Bouton RIA trouvé, réassignation...");
        addRiaBtn.onclick = function() {
            console.log("🔄 Clic sur Ajouter RIA");
            openAddRIAModal();
        };
    }
    
    // Bouton BAES
    const addBaesBtn = document.querySelector('[onclick*="openAddBAESModal"]');
    if (addBaesBtn) {
        console.log("✅ Bouton BAES trouvé, réassignation...");
        addBaesBtn.onclick = function() {
            console.log("🔄 Clic sur Ajouter BAES");
            openAddBAESModal();
        };
    }
    
    // Bouton Alarme
    const addAlarmeBtn = document.querySelector('[onclick*="openAddAlarmeModal"]');
    if (addAlarmeBtn) {
        console.log("✅ Bouton Alarme trouvé, réassignation...");
        addAlarmeBtn.onclick = function() {
            console.log("🔄 Clic sur Ajouter Alarme");
            openAddAlarmeModal();
        };
    }
    
    // Bouton Extincteur (pour vérification)
    const addExtincteurBtn = document.querySelector('[onclick*="openAddExtincteurModal"]');
    if (addExtincteurBtn) {
        console.log("✅ Bouton Extincteur trouvé, réassignation...");
        addExtincteurBtn.onclick = function() {
            console.log("🔄 Clic sur Ajouter Extincteur");
            openAddExtincteurModal();
        };
    }
}

// Réinitialisation des formulaires avec confirmation
function openAddRIAModal() {
    if (!AppState.currentClient) {
        showError('Veuillez d\'abord sélectionner un client');
        return;
    }
    
    console.log("📝 Ouverture modal RIA");
    AppState.currentEditingMaterialIndex = -1;
    resetRIAForm();
    
    const modal = document.getElementById('add-ria-modal');
    if (modal) {
        modal.classList.add('active');
        document.body.style.overflow = 'hidden';
        
        // Réassigner le bouton d'ajout
        const addButton = modal.querySelector('.btn-success');
        if (addButton) {
            addButton.onclick = addRIAToList;
        }
    } else {
        console.error("❌ Modal RIA non trouvé");
        showError('Erreur: formulaire RIA non disponible');
    }
}

function openAddBAESModal() {
    if (!AppState.currentClient) {
        showError('Veuillez d\'abord sélectionner un client');
        return;
    }
    
    console.log("📝 Ouverture modal BAES");
    AppState.currentEditingMaterialIndex = -1;
    resetBAESForm();
    
    const modal = document.getElementById('add-baes-modal');
    if (modal) {
        modal.classList.add('active');
        document.body.style.overflow = 'hidden';
        
        // Réassigner le bouton d'ajout
        const addButton = modal.querySelector('.btn-success');
        if (addButton) {
            addButton.onclick = addBAESToList;
        }
    } else {
        console.error("❌ Modal BAES non trouvé");
        showError('Erreur: formulaire BAES non disponible');
    }
}

function openAddAlarmeModal() {
    if (!AppState.currentClient) {
        showError('Veuillez d\'abord sélectionner un client');
        return;
    }
    
    console.log("📝 Ouverture modal Alarme");
    AppState.currentEditingMaterialIndex = -1;
    resetAlarmeForm();
    
    const modal = document.getElementById('add-alarme-modal');
    if (modal) {
        modal.classList.add('active');
        document.body.style.overflow = 'hidden';
        
        // Réassigner le bouton d'ajout
        const addButton = modal.querySelector('.btn-success');
        if (addButton) {
            addButton.onclick = addAlarmeToList;
        }
    } else {
        console.error("❌ Modal Alarme non trouvé");
        showError('Erreur: formulaire Alarme non disponible');
    }
}

function openAddExtincteurModal() {
    if (!AppState.currentClient) {
        showError('Veuillez d\'abord sélectionner un client');
        return;
    }
    
    console.log("📝 Ouverture modal Extincteur");
    AppState.currentEditingMaterialIndex = -1;
    resetExtincteurForm();
    
    const modal = document.getElementById('add-extincteur-modal');
    if (modal) {
        modal.classList.add('active');
        document.body.style.overflow = 'hidden';
        
        // Réassigner le bouton d'ajout
        const addButton = modal.querySelector('.btn-success');
        if (addButton) {
            addButton.onclick = addExtincteurToList;
        }
    } else {
        console.error("❌ Modal Extincteur non trouvé");
        showError('Erreur: formulaire Extincteur non disponible');
    }
}

// Fonctions de fermeture améliorées
function closeRIAModal() {
    const modal = document.getElementById('add-ria-modal');
    if (modal) {
        modal.classList.remove('active');
        document.body.style.overflow = '';
        console.log("✅ Modal RIA fermé");
    }
}

function closeBAESModal() {
    const modal = document.getElementById('add-baes-modal');
    if (modal) {
        modal.classList.remove('active');
        document.body.style.overflow = '';
        console.log("✅ Modal BAES fermé");
    }
}

function closeAlarmeModal() {
    const modal = document.getElementById('add-alarme-modal');
    if (modal) {
        modal.classList.remove('active');
        document.body.style.overflow = '';
        console.log("✅ Modal Alarme fermé");
    }
}

function closeExtincteurModal() {
    const modal = document.getElementById('add-extincteur-modal');
    if (modal) {
        modal.classList.remove('active');
        document.body.style.overflow = '';
        console.log("✅ Modal Extincteur fermé");
    }
}

// Ajouter RIA à la liste
function addRIAToList() {
    console.log("🔄 Tentative d'ajout RIA");
    
    if (!validateMaterialForm('ria')) {
        console.log("❌ Validation RIA échouée");
        return;
    }
    
    const ria = createRIAObject();
    console.log("✅ Objet RIA créé:", ria);
    
    addMaterialToList(ria);
    closeRIAModal();
    showSuccess('RIA ajouté avec succès');
    
    // Rafraîchir l'affichage
    if (AppState.currentPage === 'materials') {
        displayMaterialsListSimplified();
    }
    if (AppState.currentPage === 'verification') {
        displayVerificationList();
    }
}

// Ajouter BAES à la liste
function addBAESToList() {
    console.log("🔄 Tentative d'ajout BAES");
    
    if (!validateMaterialForm('baes')) {
        console.log("❌ Validation BAES échouée");
        return;
    }
    
    const baes = createBAESObject();
    console.log("✅ Objet BAES créé:", baes);
    
    addMaterialToList(baes);
    closeBAESModal();
    showSuccess('BAES ajouté avec succès');
    
    // Rafraîchir l'affichage
    if (AppState.currentPage === 'materials') {
        displayMaterialsListSimplified();
    }
    if (AppState.currentPage === 'verification') {
        displayVerificationList();
    }
}

// Ajouter Alarme à la liste
function addAlarmeToList() {
    console.log("🔄 Tentative d'ajout Alarme");
    
    if (!validateMaterialForm('alarme')) {
        console.log("❌ Validation Alarme échouée");
        return;
    }
    
    const alarme = createAlarmeObject();
    console.log("✅ Objet Alarme créé:", alarme);
    
    addMaterialToList(alarme);
    closeAlarmeModal();
    showSuccess('Alarme ajoutée avec succès');
    
    // Rafraîchir l'affichage
    if (AppState.currentPage === 'materials') {
        displayMaterialsListSimplified();
    }
    if (AppState.currentPage === 'verification') {
        displayVerificationList();
    }
}

// Ajouter Extincteur à la liste
function addExtincteurToList() {
    console.log("🔄 Tentative d'ajout Extincteur");
    
    if (!validateMaterialForm('extincteur')) {
        console.log("❌ Validation Extincteur échouée");
        return;
    }
    
    const extincteur = createExtincteurObject();
    console.log("✅ Objet Extincteur créé:", extincteur);
    
    addMaterialToList(extincteur);
    closeExtincteurModal();
    showSuccess('Extincteur ajouté avec succès');
    
    // Rafraîchir l'affichage
    if (AppState.currentPage === 'materials') {
        displayMaterialsListSimplified();
    }
    if (AppState.currentPage === 'verification') {
        displayVerificationList();
    }
}

// Fonction pour ouvrir le modal de matériel générique
function openMaterialModal(type) {
    console.log("📝 Ouverture modal pour type:", type);
    
    if (!AppState.currentClient) {
        showError('Veuillez d\'abord sélectionner un client');
        return;
    }
    
    AppState.currentEditingMaterialIndex = -1;
    
    switch(type) {
        case 'extincteur':
            resetExtincteurForm();
            openAddExtincteurModal();
            break;
        case 'ria':
            resetRIAForm();
            openAddRIAModal();
            break;
        case 'baes':
            resetBAESForm();
            openAddBAESModal();
            break;
        case 'alarme':
            resetAlarmeForm();
            openAddAlarmeModal();
            break;
        default:
            showError('Type de matériel non reconnu');
    }
}

// Réassigner la fonction openMaterialModal existante
window.openMaterialModal = openMaterialModal;

// Initialiser au démarrage et après chaque navigation
function initMaterialButtonsOnNavigation() {
    // Initialiser les boutons d'ajout
    initMaterialAddButtons();
    
    // Réassigner les événements de fermeture
    const closeButtons = document.querySelectorAll('[onclick*="closeModal"]');
    closeButtons.forEach(btn => {
        const onclick = btn.getAttribute('onclick');
        if (onclick) {
            if (onclick.includes('add-ria-modal')) {
                btn.onclick = closeRIAModal;
            } else if (onclick.includes('add-baes-modal')) {
                btn.onclick = closeBAESModal;
            } else if (onclick.includes('add-alarme-modal')) {
                btn.onclick = closeAlarmeModal;
            } else if (onclick.includes('add-extincteur-modal')) {
                btn.onclick = closeExtincteurModal;
            }
        }
    });
    
    // Réassigner les boutons dans les modals
    setTimeout(() => {
        // Modal RIA
        const addRiaModalBtn = document.querySelector('#add-ria-modal .btn-success');
        if (addRiaModalBtn) {
            addRiaModalBtn.onclick = addRIAToList;
        }
        
        // Modal BAES
        const addBaesModalBtn = document.querySelector('#add-baes-modal .btn-success');
        if (addBaesModalBtn) {
            addBaesModalBtn.onclick = addBAESToList;
        }
        
        // Modal Alarme
        const addAlarmeModalBtn = document.querySelector('#add-alarme-modal .btn-success');
        if (addAlarmeModalBtn) {
            addAlarmeModalBtn.onclick = addAlarmeToList;
        }
        
        // Modal Extincteur
        const addExtincteurModalBtn = document.querySelector('#add-extincteur-modal .btn-success');
        if (addExtincteurModalBtn) {
            addExtincteurModalBtn.onclick = addExtincteurToList;
        }
    }, 500);
}

// Initialiser au chargement
document.addEventListener('DOMContentLoaded', function() {
    setTimeout(initMaterialAddButtons, 1000);
    
    // Surveiller les changements de page
    const originalNavigate = window.navigateTo;
    if (originalNavigate) {
        window.navigateTo = function(page) {
            originalNavigate(page);
            
            // Si on navigue vers la page des matériels, initialiser les boutons
            if (page === 'materials') {
                setTimeout(initMaterialButtonsOnNavigation, 300);
            }
        };
    }
});

// Exposer les fonctions globalement
window.openAddRIAModal = openAddRIAModal;
window.openAddBAESModal = openAddBAESModal;
window.openAddAlarmeModal = openAddAlarmeModal;
window.openAddExtincteurModal = openAddExtincteurModal;
window.addRIAToList = addRIAToList;
window.addBAESToList = addBAESToList;
window.addAlarmeToList = addAlarmeToList;
window.addExtincteurToList = addExtincteurToList;
window.closeRIAModal = closeRIAModal;
window.closeBAESModal = closeBAESModal;
window.closeAlarmeModal = closeAlarmeModal;
window.closeExtincteurModal = closeExtincteurModal;

console.log('✅ Correction des boutons d\'ajout de matériel chargée !');

// Fonction minimale pour corriger l'erreur
window.selectAlarmeNok = function(element, field) {
    // Retirer la classe 'selected' de tous les boutons dans ce groupe
    const parent = element.parentElement;
    const allOptions = parent.querySelectorAll('.ok-nok-option');
    allOptions.forEach(opt => opt.classList.remove('selected'));
    
    // Ajouter la classe 'selected' au bouton cliqué
    element.classList.add('selected');
    
    // Déterminer la valeur
    let value = '';
    if (element.classList.contains('ok')) {
        value = 'OK';
    } else if (element.classList.contains('nok')) {
        value = 'Non OK';
    } else if (element.classList.contains('nc')) {
        value = 'NC';
    }
    
    // Mettre à jour le champ caché correspondant
    const hiddenField = document.getElementById(`alarme-${field}`);
    if (hiddenField) {
        hiddenField.value = value;
    }
};


// ==================== DÉSACTIVATION DU SWIPE ====================

// Supprimer complètement la navigation par swipe
function disableSwipeNavigation() {
    console.log("📱 Désactivation de la navigation par swipe");
    
    // Remplacer la fonction initSwipeNavigation par une fonction vide
    window.initSwipeNavigation = function() {
        console.log("❌ Navigation par swipe désactivée");
        return false;
    };
    
    // Remplacer handleSwipeGesture par une fonction vide
    window.handleSwipeGesture = function() {
        return false;
    };
    
    // Supprimer les écouteurs d'événements si existants
    document.removeEventListener('touchstart', function() {});
    document.removeEventListener('touchend', function() {});
    
    console.log("✅ Swipe désactivé avec succès");
}

// Désactiver automatiquement sur mobile
function checkAndDisableSwipe() {
    // Désactiver uniquement sur mobile (écran <= 768px)
    if (window.innerWidth <= 768) {
        disableSwipeNavigation();
        return true;
    }
    return false;
}

// Écouter les changements de taille d'écran
window.addEventListener('resize', function() {
    checkAndDisableSwipe();
});

// Désactiver au démarrage
document.addEventListener('DOMContentLoaded', function() {
    // Attendre un peu que tout soit chargé
    setTimeout(function() {
        checkAndDisableSwipe();
    }, 1000);
});

// Écouter quand la page est complètement chargée
window.addEventListener('load', function() {
    setTimeout(function() {
        checkAndDisableSwipe();
    }, 500);
});

// Exposer la fonction globalement au cas où
window.disableSwipeNavigation = disableSwipeNavigation;
window.checkAndDisableSwipe = checkAndDisableSwipe;

console.log("✅ Script de désactivation du swipe chargé");

// ==================== ACTIVATION BOUTON "ALLER À LA VÉRIFICATION" ====================

// Fonction principale pour naviguer vers la vérification
function goToVerification() {
    console.log("🔄 Navigation vers la vérification...");
    
    // Vérifier qu'un client est sélectionné
    if (!AppState.currentClient) {
        showError('Veuillez d\'abord sélectionner un client');
        return;
    }
    
    // Vérifier s'il y a des matériels
    if (!AppState.currentClient.materials || AppState.currentClient.materials.length === 0) {
        if (confirm('Ce client n\'a aucun matériel. Voulez-vous quand même aller à la vérification ?')) {
            // Naviguer quand même
            navigateTo('verification');
            showSuccess('Page de vérification ouverte');
        } else {
            showInfo('Ajoutez d\'abord des matériels dans la liste');
        }
        return;
    }
    
    // Si tout est OK, naviguer
    navigateTo('verification');
    showSuccess('Navigation vers la vérification réussie');
}

// Trouver et activer le bouton existant
function activateVerificationButton() {
    console.log("🔍 Recherche du bouton 'Aller à la vérification'...");
    
    // Chercher le bouton par son texte
    const allButtons = document.querySelectorAll('button');
    let verificationButton = null;
    
    allButtons.forEach(button => {
        if (button.textContent.includes('Aller à la vérification') || 
            button.textContent.includes('aller à la vérification') ||
            button.textContent.includes('Vérification')) {
            verificationButton = button;
        }
    });
    
    // Si on a trouvé le bouton
    if (verificationButton) {
        console.log("✅ Bouton trouvé:", verificationButton);
        
        // Ajouter l'événement click
        verificationButton.onclick = goToVerification;
        
        // Ajouter un style pour le rendre plus visible
        verificationButton.style.backgroundColor = '#ffc107';
        verificationButton.style.color = '#000';
        verificationButton.style.fontWeight = 'bold';
        verificationButton.style.border = '2px solid #e0a800';
        
        // Ajouter un effet hover
        verificationButton.addEventListener('mouseenter', function() {
            this.style.transform = 'scale(1.05)';
            this.style.boxShadow = '0 4px 8px rgba(0,0,0,0.2)';
        });
        
        verificationButton.addEventListener('mouseleave', function() {
            this.style.transform = 'scale(1)';
            this.style.boxShadow = 'none';
        });
        
        console.log("✅ Bouton activé avec succès");
        return true;
    } else {
        console.log("❌ Bouton non trouvé, création d'un nouveau...");
        
        // Créer un nouveau bouton si non trouvé
        createNewVerificationButton();
        return false;
    }
}

// Créer un nouveau bouton si nécessaire
function createNewVerificationButton() {
    // Chercher un endroit où ajouter le bouton
    const materialsPage = document.getElementById('page-materials');
    const materialsList = document.getElementById('materials-list');
    const materialsHeader = document.querySelector('.page-header');
    
    let container = materialsPage || materialsList || materialsHeader;
    
    if (container) {
        const button = document.createElement('button');
        button.id = 'verification-button';
        button.className = 'btn btn-warning';
        button.innerHTML = '<i class="fas fa-clipboard-check"></i> Aller à la vérification';
        button.style.margin = '15px 0';
        button.style.padding = '10px 20px';
        button.style.fontSize = '16px';
        button.style.fontWeight = 'bold';
        
        button.onclick = goToVerification;
        
        // Ajouter avant la liste ou à la fin du conteneur
        if (materialsList && materialsList.parentNode) {
            materialsList.parentNode.insertBefore(button, materialsList);
        } else {
            container.appendChild(button);
        }
        
        console.log("✅ Nouveau bouton créé");
        return button;
    }
    
    console.log("❌ Impossible de créer le bouton");
    return null;
}

// Mettre à jour l'état du bouton
function updateVerificationButton() {
    const button = document.querySelector('#verification-button') || 
                   document.querySelector('button[onclick*="goToVerification"]');
    
    if (!button) return;
    
    if (!AppState.currentClient) {
        button.disabled = true;
        button.title = 'Sélectionnez d\'abord un client';
        button.style.opacity = '0.6';
    } else {
        button.disabled = false;
        button.title = 'Cliquez pour vérifier les matériels';
        button.style.opacity = '1';
        
        // Afficher le nombre de matériels
        const count = AppState.currentClient.materials ? AppState.currentClient.materials.length : 0;
        const icon = button.querySelector('i');
        if (icon) {
            button.innerHTML = `<i class="fas fa-clipboard-check"></i> Vérification (${count} matériels)`;
        }
    }
}

// Surveiller les changements de client
function watchClientSelection() {
    // Surcharger la fonction selectClient existante
    const originalSelectClient = window.selectClient;
    if (originalSelectClient) {
        window.selectClient = function(client) {
            const result = originalSelectClient(client);
            
            // Mettre à jour le bouton après la sélection
            setTimeout(updateVerificationButton, 100);
            
            return result;
        };
    }
}

// Initialiser le système
function initVerificationButtonSystem() {
    console.log("🚀 Initialisation du système de bouton vérification");
    
    // Attendre que la page soit prête
    setTimeout(() => {
        // Activer le bouton existant
        activateVerificationButton();
        
        // Surveiller les changements
        watchClientSelection();
        
        // Mettre à jour l'état initial
        updateVerificationButton();
        
        console.log("✅ Système de bouton vérification initialisé");
    }, 2000);
}

// Lancer l'initialisation
document.addEventListener('DOMContentLoaded', initVerificationButtonSystem);

// Relancer quand on navigue vers la page matériels
const originalNavigateTo = window.navigateTo;
if (originalNavigateTo) {
    window.navigateTo = function(page) {
        originalNavigateTo(page);
        
        if (page === 'materials') {
            setTimeout(initVerificationButtonSystem, 500);
        }
    };
}

// Exposer les fonctions globalement
window.goToVerification = goToVerification;
window.activateVerificationButton = activateVerificationButton;
window.updateVerificationButton = updateVerificationButton;

console.log("✅ Code bouton vérification chargé");






// ==================== MODIFICATION DES CLIENTS - VERSION CORRIGÉE DÉCALAGE ====================

// Variable pour suivre le client en cours de modification
let editingClientId = null;

function initClientModification() {
    console.log("🔧 Initialisation modification clients...");
    
    // Ajouter le CSS immédiatement
    addClientModificationCSS();
    
    // Initialiser la recherche
    initClientSearch();
}

function displayClientsListEnhanced() {
    const clientsList = document.getElementById('clients-list');
    if (!clientsList) {
        console.error("❌ Élément clients-list non trouvé");
        return;
    }
    
    const searchTerm = getElementValue('client-search')?.toLowerCase() || '';
    const filteredClients = filterClients(searchTerm);
    
    if (filteredClients.length === 0) {
        showEmptyState(clientsList, 'clients');
        return;
    }
    
    clientsList.innerHTML = filteredClients.map(client => createClientCardWithEdit(client)).join('');
}

function createClientCardWithEdit(client) {
    const materialsCount = client.materials?.length || 0;
    const isSelected = AppState.currentClient && AppState.currentClient.id === client.id;
    const createdDate = client.createdDate ? formatDate(client.createdDate) : 'Non spécifiée';
    
    return `
        <div class="compact-material-item client-item ${isSelected ? 'selected' : ''}" 
             data-client-id="${client.id}"
             onclick="selectClientById('${client.id}')">
            <div class="compact-material-info">
                <div class="compact-material-name">
                    <i class="fas fa-user"></i>
                    <span class="client-name-text">${escapeHtml(client.name)}</span>
                    ${isSelected ? '<span class="status-badge status-ok">Sélectionné</span>' : ''}
                </div>
                <div class="compact-material-details">
                    <div class="client-contact-info">
                        <i class="fas fa-user-circle"></i> ${escapeHtml(client.contact)}
                    </div>
                    <div class="client-address-info">
                        <i class="fas fa-map-marker-alt"></i> ${escapeHtml(client.address)}
                    </div>
                    <div class="client-contact-details">
                        <div class="client-phone">
                            <i class="fas fa-phone"></i> ${client.phone || 'Non renseigné'}
                        </div>
                        <div class="client-email">
                            <i class="fas fa-envelope"></i> ${client.email || 'Non renseigné'}
                        </div>
                    </div>
                    ${client.notes ? `
                    <div class="client-notes-preview">
                        <i class="fas fa-sticky-note"></i>
                        <span>${escapeHtml(client.notes.length > 100 ? client.notes.substring(0, 100) + '...' : client.notes)}</span>
                    </div>
                    ` : ''}
                    <div class="client-meta-info">
                        <small>
                            <i class="fas fa-clipboard-list"></i> ${materialsCount} matériel(s)
                            <span style="margin: 0 5px">•</span>
                            <i class="fas fa-calendar"></i> ${createdDate}
                        </small>
                    </div>
                </div>
            </div>
            <div class="compact-material-actions client-actions">
                <button class="btn btn-sm btn-primary btn-edit-client" 
                        onclick="editClient('${client.id}', event)"
                        title="Modifier ce client">
                    <i class="fas fa-edit"></i>
                    <span class="btn-text">Modifier</span>
                </button>
                <button class="btn btn-sm btn-danger" 
                        onclick="deleteClient('${client.id}', event)"
                        title="Supprimer ce client">
                    <i class="fas fa-trash"></i>
                </button>
            </div>
        </div>
    `;
}

function selectClientById(clientId) {
    const client = AppState.clients.find(c => c.id === clientId);
    if (client) {
        selectClient(client);
    }
}

function editClient(clientId, event) {
    if (event) {
        event.stopPropagation();
        event.preventDefault();
    }
    
    console.log("✏️ Modification client:", clientId);
    
    const client = AppState.clients.find(c => c.id === clientId);
    if (!client) {
        showError("Client non trouvé");
        return;
    }
    
    // Stocker l'ID du client en cours de modification
    editingClientId = clientId;
    
    // Remplir le formulaire avec les données du client
    setElementValue('client-name', client.name);
    setElementValue('client-contact', client.contact);
    setElementValue('client-address', client.address);
    setElementValue('technician-name', client.technician);
    setElementValue('client-email', client.email || '');
    setElementValue('client-phone', client.phone || '');
    setElementValue('client-notes', client.notes || '');
    
    // MODIFICATION CRITIQUE : Remplacer le bouton Créer
    updateCreateButtonForEdit(clientId);
    
    // Faire défiler vers le formulaire
    setTimeout(() => {
        const formSection = document.querySelector('.client-form-section');
        if (formSection) {
            formSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
    }, 100);
    
    showToast(`Mode modification activé pour "${client.name}"`, "info", 3000);
}

// FONCTION CORRIGÉE : Trouve le bouton Créer et gère le décalage
function updateCreateButtonForEdit(clientId) {
    // Essayer plusieurs façons de trouver le bouton Créer
    let createBtn = null;
    
    // 1. Par ID
    createBtn = document.getElementById('create-client-btn');
    
    // 2. Par texte du bouton (si pas d'ID)
    if (!createBtn) {
        const buttons = document.querySelectorAll('button');
        for (const btn of buttons) {
            const btnText = btn.textContent || btn.innerText;
            if (btnText.toLowerCase().includes('créer') && btnText.toLowerCase().includes('client')) {
                createBtn = btn;
                break;
            }
        }
    }
    
    // 3. Par classe (bouton dans le formulaire client)
    if (!createBtn) {
        createBtn = document.querySelector('.client-form-section button.btn-success');
    }
    
    // 4. Par le formulaire de création de client
    if (!createBtn) {
        const form = document.querySelector('form');
        if (form) {
            createBtn = form.querySelector('button[type="button"], button[type="submit"]');
        }
    }
    
    if (!createBtn) {
        console.error("❌ Impossible de trouver le bouton Créer le client");
        showError("Impossible de trouver le bouton de création. Le formulaire client est-il visible ?");
        return;
    }
    
    console.log("✅ Bouton Créer trouvé:", createBtn);
    
    // Donner un ID au bouton pour les prochaines fois
    if (!createBtn.id) {
        createBtn.id = 'create-client-btn';
    }
    
    // Sauvegarder l'état original
    if (!createBtn.dataset.originalText) {
        createBtn.dataset.originalText = createBtn.innerHTML;
        createBtn.dataset.originalOnclick = createBtn.getAttribute('onclick');
        // Sauvegarder aussi les classes originales
        createBtn.dataset.originalClasses = createBtn.className;
    }
    
    // Transformer en bouton Mettre à jour
    createBtn.innerHTML = '<i class="fas fa-save"></i> Mettre à jour le client';
    createBtn.setAttribute('onclick', `updateExistingClient('${clientId}')`);
    
    // Remplacer les classes correctement
    createBtn.className = createBtn.dataset.originalClasses.replace('btn-success', 'btn-warning');
    
    // S'assurer que le bouton a la classe btn
    if (!createBtn.className.includes('btn')) {
        createBtn.className += ' btn btn-warning';
    }
    
    // Ajouter le bouton Annuler s'il n'existe pas
    addCancelEditButton(createBtn);
}

function updateExistingClient(clientId) {
    console.log("🔄 Mise à jour du client:", clientId);
    
    const formData = getClientFormData();
    
    if (!validateClientForm(formData)) {
        return;
    }
    
    const clientIndex = AppState.clients.findIndex(c => c.id === clientId);
    if (clientIndex === -1) {
        showError("Client non trouvé");
        return;
    }
    
    // Mettre à jour le client
    const updatedClient = {
        ...AppState.clients[clientIndex],
        ...formData,
        name: formData.name.trim(),
        contact: formData.contact.trim(),
        address: formData.address.trim(),
        technician: formData.technician.trim(),
        email: formData.email.trim(),
        phone: formData.phone.trim(),
        notes: formData.notes.trim(),
        updatedDate: new Date().toISOString()
    };
    
    AppState.clients[clientIndex] = updatedClient;
    
    // Mettre à jour le client actuel si c'est le même
    if (AppState.currentClient && AppState.currentClient.id === clientId) {
        AppState.currentClient = JSON.parse(JSON.stringify(updatedClient));
    }
    
    // Sauvegarder
    saveClients();
    
    // Réinitialiser le formulaire et le bouton
    resetCreateButtonToNormal();
    
    // Rafraîchir la liste
    displayClientsListEnhanced();
    
    showSuccess('Client mis à jour avec succès !');
}

function resetCreateButtonToNormal() {
    // Trouver le bouton de la même manière que updateCreateButtonForEdit
    let createBtn = document.getElementById('create-client-btn');
    if (!createBtn) {
        const buttons = document.querySelectorAll('button');
        for (const btn of buttons) {
            const btnText = btn.textContent || btn.innerText;
            if (btnText.includes('Mettre à jour') && (btn.classList.contains('btn-warning') || btn.classList.contains('btn-warning'))) {
                createBtn = btn;
                break;
            }
        }
    }
    
    if (createBtn && createBtn.dataset.originalText) {
        console.log("🔄 Restauration du bouton Créer");
        
        // Restaurer le bouton original
        createBtn.innerHTML = createBtn.dataset.originalText;
        
        if (createBtn.dataset.originalOnclick) {
            createBtn.setAttribute('onclick', createBtn.dataset.originalOnclick);
        }
        
        // Restaurer les classes originales
        if (createBtn.dataset.originalClasses) {
            createBtn.className = createBtn.dataset.originalClasses;
        } else {
            createBtn.className = createBtn.className.replace('btn-warning', 'btn-success');
        }
        
        // Supprimer les données temporaires
        delete createBtn.dataset.originalText;
        delete createBtn.dataset.originalOnclick;
        delete createBtn.dataset.originalClasses;
    }
    
    // Réinitialiser le formulaire
    resetClientForm();
    
    // Supprimer le bouton Annuler
    removeCancelButton();
    
    // Réinitialiser l'ID d'édition
    editingClientId = null;
}

function addCancelEditButton(createBtn) {
    // Vérifier si le bouton existe déjà
    if (document.getElementById('cancel-edit-btn')) {
        return;
    }
    
    if (!createBtn) {
        createBtn = document.getElementById('create-client-btn') || 
                   document.querySelector('.btn-warning') ||
                   document.querySelector('.client-form-section button');
    }
    
    if (!createBtn || !createBtn.parentNode) {
        return;
    }
    
    // Créer le bouton Annuler
    const cancelBtn = document.createElement('button');
    cancelBtn.id = 'cancel-edit-btn';
    cancelBtn.className = 'btn btn-secondary cancel-edit-btn';
    cancelBtn.innerHTML = '<i class="fas fa-times"></i> <span>Annuler</span>';
    cancelBtn.type = 'button';
    cancelBtn.onclick = function(e) {
        e.preventDefault();
        resetCreateButtonToNormal();
        showToast("Modification annulée", "info", 2000);
    };
    
    // Vérifier si le parent est un conteneur flex
    const parent = createBtn.parentNode;
    if (parent.classList.contains('d-flex') || parent.style.display === 'flex') {
        // Ajouter simplement à côté
        parent.appendChild(cancelBtn);
    } else {
        // Créer un conteneur flex pour les boutons
        const container = document.createElement('div');
        container.className = 'edit-buttons-container';
        container.style.cssText = `
            display: flex;
            gap: 10px;
            align-items: center;
            margin-top: 15px;
        `;
        
        // Remplacer le bouton par le conteneur
        parent.insertBefore(container, createBtn);
        container.appendChild(createBtn);
        container.appendChild(cancelBtn);
    }
}

function removeCancelButton() {
    const cancelBtn = document.getElementById('cancel-edit-btn');
    if (cancelBtn && cancelBtn.parentNode) {
        const parent = cancelBtn.parentNode;
        
        // Si le parent est notre conteneur spécial
        if (parent.classList.contains('edit-buttons-container')) {
            const createBtn = parent.querySelector('button:not(#cancel-edit-btn)');
            if (createBtn) {
                // Remplacer le conteneur par le bouton original
                parent.parentNode.insertBefore(createBtn, parent);
                parent.parentNode.removeChild(parent);
            }
        } else {
            // Sinon, simplement retirer le bouton Annuler
            parent.removeChild(cancelBtn);
        }
    }
}

function initClientSearch() {
    const searchInput = document.getElementById('client-search');
    if (searchInput) {
        // Recherche en temps réel
        searchInput.addEventListener('input', function() {
            displayClientsListEnhanced();
        });
        
        // Nettoyer la recherche
        const clearBtn = searchInput.parentNode.querySelector('.search-clear');
        if (!clearBtn) {
            const clearBtn = document.createElement('button');
            clearBtn.type = 'button';
            clearBtn.className = 'search-clear';
            clearBtn.innerHTML = '<i class="fas fa-times"></i>';
            clearBtn.style.cssText = `
                position: absolute;
                right: 40px;
                top: 50%;
                transform: translateY(-50%);
                background: none;
                border: none;
                color: #999;
                cursor: pointer;
                display: none;
            `;
            clearBtn.onclick = function() {
                searchInput.value = '';
                displayClientsListEnhanced();
                this.style.display = 'none';
            };
            
            searchInput.parentNode.appendChild(clearBtn);
            
            // Afficher/masquer le bouton nettoyer
            searchInput.addEventListener('input', function() {
                clearBtn.style.display = this.value ? 'block' : 'none';
            });
        }
    }
}

function filterClients(searchTerm) {
    if (!searchTerm) return AppState.clients;
    
    return AppState.clients.filter(client => 
        client.name.toLowerCase().includes(searchTerm) ||
        (client.contact && client.contact.toLowerCase().includes(searchTerm)) ||
        (client.address && client.address.toLowerCase().includes(searchTerm)) ||
        (client.email && client.email.toLowerCase().includes(searchTerm)) ||
        (client.phone && client.phone.includes(searchTerm)) ||
        (client.notes && client.notes.toLowerCase().includes(searchTerm))
    );
}

// CSS pour la modification clients
function addClientModificationCSS() {
    const styleId = 'client-modification-css';
    if (document.getElementById(styleId)) return;
    
    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = `
        /* ============ TAILLE DE POLICE AUGMENTÉE ============ */
        
        /* Noms des clients - Police plus grosse */
        .client-name-text {
            font-size: 1.2rem !important; /* Augmenté */
            font-weight: 600 !important;
            color: #2c3e50 !important;
        }
        
        /* Informations de contact - Police plus grosse */
        .client-contact-info {
            display: flex;
            align-items: center;
            gap: 8px;
            margin-bottom: 6px; /* Augmenté */
            color: #495057;
            font-size: 1.05rem !important; /* Augmenté */
        }
        
        /* Adresse - Police plus grosse */
        .client-address-info {
            display: flex;
            align-items: flex-start;
            gap: 8px;
            margin-bottom: 8px; /* Augmenté */
            color: #6c757d;
            font-size: 1.05rem !important; /* Augmenté */
        }
        
        /* NOUVEAU : Détails de contact (téléphone, email) */
        .client-contact-details {
            margin: 10px 0; /* Augmenté */
            display: flex;
            flex-direction: column;
            gap: 6px; /* Augmenté */
        }
        
        .client-phone, .client-email {
            display: flex;
            align-items: center;
            gap: 8px;
            color: #495057;
            font-size: 1.05rem !important; /* Augmenté */
            line-height: 1.4;
        }
        
        /* NOUVEAU : Notes supplémentaires */
        .client-notes-preview {
            margin: 12px 0; /* Augmenté */
            padding: 10px; /* Augmenté */
            background-color: #f8f9fa;
            border-radius: 6px;
            border-left: 3px solid #3498db;
            font-size: 1.05rem !important; /* Augmenté */
            color: #495057;
            line-height: 1.5;
            display: flex;
            gap: 10px; /* Augmenté */
            align-items: flex-start;
        }
        
        .client-notes-preview i {
            color: #3498db;
            margin-top: 3px;
            font-size: 1.1rem; /* Augmenté */
        }
        
        /* Métadonnées - Police plus grosse */
        .client-meta-info {
            color: #868e96;
            font-size: 1rem !important; /* Augmenté */
            display: flex;
            align-items: center;
            gap: 10px; /* Augmenté */
            flex-wrap: wrap;
            margin-top: 10px; /* Augmenté */
        }
        
        .client-meta-info i {
            font-size: 1rem; /* Augmenté */
        }
        
        /* ============ FIN TAILLE DE POLICE AUGMENTÉE ============ */
        
        /* Cartes clients améliorées */
        .client-item {
            cursor: pointer;
            transition: all 0.3s ease;
            border-left: 4px solid #3498db !important;
            margin-bottom: 15px; /* Augmenté */
            padding: 15px; /* Augmenté */
        }
        
        .client-item:hover {
            transform: translateY(-2px);
            box-shadow: 0 6px 12px rgba(52, 152, 219, 0.15);
        }
        
        .client-item.selected {
            border-left-color: #2ecc71 !important;
            background-color: #f8f9fa;
        }
        
        /* Icônes plus grosses */
        .client-item .fa-user, 
        .client-item .fa-user-circle,
        .client-item .fa-map-marker-alt,
        .client-item .fa-phone,
        .client-item .fa-envelope,
        .client-item .fa-sticky-note,
        .client-item .fa-clipboard-list,
        .client-item .fa-calendar {
            font-size: 1.1rem !important; /* Augmenté */
            min-width: 20px; /* Augmenté */
        }
        
        /* Actions clients */
        .client-actions {
            display: flex;
            flex-direction: column;
            gap: 8px; /* Augmenté */
            min-width: 100px; /* Augmenté */
        }
        
        .btn-edit-client {
            background: linear-gradient(135deg, #3498db 0%, #2980b9 100%);
            border: none;
            color: white;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 8px; /* Augmenté */
            padding: 8px 12px; /* Augmenté */
            font-size: 1rem !important; /* Augmenté */
        }
        
        .btn-edit-client:hover {
            background: linear-gradient(135deg, #2980b9 0%, #1f639d 100%);
            transform: translateY(-1px);
        }
        
        /* CONTENEUR BOUTONS ÉDITION - CORRECTION DÉCALAGE */
        .edit-buttons-container {
            display: flex !important;
            gap: 12px !important; /* Augmenté */
            align-items: center !important;
            margin-top: 20px !important; /* Augmenté */
            width: 100% !important;
        }
        
        /* BOUTON METTRE À JOUR - JAUNE */
        .btn-warning {
            background: linear-gradient(135deg, #ffc107 0%, #e0a800 100%) !important;
            border-color: #e0a800 !important;
            color: #212529 !important;
            font-weight: 600;
            border: 1px solid #e0a800 !important;
            padding: 12px 24px !important; /* Augmenté */
            flex: 1;
            min-width: 0;
            display: flex !important;
            align-items: center !important;
            justify-content: center !important;
            gap: 10px !important; /* Augmenté */
            font-size: 1.1rem !important; /* Augmenté */
        }
        
        .btn-warning:hover {
            background: linear-gradient(135deg, #e0a800 0%, #c69500 100%) !important;
            box-shadow: 0 4px 8px rgba(255, 193, 7, 0.3);
        }
        
        /* BOUTON ANNULER - GRIS */
        .cancel-edit-btn {
            background: linear-gradient(135deg, #6c757d 0%, #495057 100%) !important;
            border: 1px solid #495057 !important;
            color: white !important;
            padding: 12px 24px !important; /* Augmenté */
            border-radius: 6px !important;
            font-size: 1.1rem !important; /* Augmenté */
            transition: all 0.3s ease !important;
            display: flex !important;
            align-items: center !important;
            justify-content: center !important;
            gap: 10px !important; /* Augmenté */
            cursor: pointer !important;
            flex: 1 !important;
            min-width: 0 !important;
            text-decoration: none !important;
            text-align: center !important;
            height: auto !important;
            line-height: normal !important;
        }
        
        .cancel-edit-btn:hover {
            background: linear-gradient(135deg, #495057 0%, #343a40 100%) !important;
            transform: translateY(-1px);
            box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
        }
        
        /* ALIGNEMENT BOUTONS DANS LE FORMULAIRE */
        .client-form-section .d-flex {
            display: flex !important;
            gap: 12px !important; /* Augmenté */
            align-items: center !important;
            flex-wrap: wrap !important;
        }
        
        /* Barre de recherche améliorée */
        .search-container {
            position: relative;
            margin-bottom: 20px; /* Augmenté */
        }
        
        .search-input {
            width: 100%;
            padding: 14px 45px 14px 20px; /* Augmenté */
            border: 2px solid #e9ecef;
            border-radius: 8px;
            font-size: 1.1rem !important; /* Augmenté */
            transition: all 0.3s ease;
            background: white;
        }
        
        .search-input:focus {
            outline: none;
            border-color: #3498db;
            box-shadow: 0 0 0 3px rgba(52, 152, 219, 0.2);
        }
        
        .search-icon {
            position: absolute;
            right: 20px; /* Augmenté */
            top: 50%;
            transform: translateY(-50%);
            color: #6c757d;
            pointer-events: none;
            font-size: 1.2rem; /* Augmenté */
        }
        
        /* RESPONSIVE SMARTPHONE - CORRECTION DÉCALAGE */
        @media (max-width: 768px) {
            /* Cartes clients */
            .client-item {
                flex-direction: column;
                align-items: stretch;
            }
            
            .client-actions {
                flex-direction: row;
                justify-content: flex-end;
                width: 100%;
                margin-top: 15px; /* Augmenté */
                min-width: auto;
            }
            
            .btn-edit-client {
                flex: 1;
                min-width: 0;
                font-size: 1.05rem !important; /* Augmenté */
            }
            
            .btn-edit-client .btn-text {
                display: inline;
                font-size: 1.05rem; /* Augmenté */
            }
            
            /* BOUTONS ÉDITION SUR SMARTPHONE */
            .edit-buttons-container {
                flex-direction: row !important;
                gap: 10px !important; /* Augmenté */
                width: 100% !important;
            }
            
            .client-form-section .d-flex {
                flex-direction: column !important;
                align-items: stretch !important;
            }
            
            .btn-warning, .cancel-edit-btn {
                width: 100% !important;
                padding: 14px 18px !important; /* Augmenté */
                font-size: 1.15rem !important; /* Augmenté */
                min-height: 52px !important; /* Augmenté */
                margin: 0 !important;
            }
            
            .btn-warning i, .cancel-edit-btn i {
                font-size: 1.2rem !important; /* Augmenté */
            }
            
            /* Taille police mobile */
            .client-name-text {
                font-size: 1.3rem !important; /* Augmenté pour mobile */
            }
            
            .client-contact-info,
            .client-address-info,
            .client-phone,
            .client-email,
            .client-notes-preview {
                font-size: 1.1rem !important; /* Augmenté pour mobile */
            }
        }
        
        /* PETITS SMARTPHONES */
        @media (max-width: 480px) {
            .client-item {
                padding: 15px; /* Augmenté */
            }
            
            .client-actions {
                gap: 8px; /* Augmenté */
            }
            
            .btn-edit-client {
                padding: 10px 12px; /* Augmenté */
                font-size: 1.05rem !important; /* Augmenté */
            }
            
            .btn-edit-client .btn-text {
                font-size: 1.05rem; /* Augmenté */
            }
            
            /* BOUTONS ÉDITION */
            .edit-buttons-container {
                gap: 8px !important; /* Augmenté */
            }
            
            .btn-warning, .cancel-edit-btn {
                padding: 12px 15px !important; /* Augmenté */
                font-size: 1.1rem !important; /* Augmenté */
                min-height: 50px !important; /* Augmenté */
            }
            
            .btn-warning span, .cancel-edit-btn span {
                font-size: 1.1rem !important; /* Augmenté */
            }
        }
        
        /* TRÈS PETITS SMARTPHONES */
        @media (max-width: 375px) {
            .btn-edit-client .btn-text {
                display: none;
            }
            
            .btn-edit-client {
                min-width: 45px; /* Augmenté */
                padding: 10px; /* Augmenté */
            }
            
            .client-actions button {
                min-width: 45px; /* Augmenté */
                height: 45px; /* Augmenté */
                padding: 0;
                display: flex;
                align-items: center;
                justify-content: center;
            }
            
            .client-actions button i {
                margin: 0;
                font-size: 18px; /* Augmenté */
            }
            
            /* BOUTONS ÉDITION */
            .edit-buttons-container {
                gap: 6px !important; /* Augmenté */
            }
            
            .btn-warning, .cancel-edit-btn {
                padding: 12px 10px !important; /* Augmenté */
                font-size: 1.05rem !important; /* Augmenté */
                min-height: 48px !important; /* Augmenté */
            }
            
            /* Cacher le texte, garder seulement les icônes */
            .btn-warning span, .cancel-edit-btn span {
                display: none !important;
            }
            
            .btn-warning i, .cancel-edit-btn i {
                margin: 0 !important;
                font-size: 20px !important; /* Augmenté */
            }
            
            .client-meta-info {
                flex-direction: column;
                align-items: flex-start;
                gap: 5px; /* Augmenté */
            }
        }
        
        /* Animation pour la modification */
        @keyframes highlightEdit {
            0% { background-color: rgba(52, 152, 219, 0.1); }
            100% { background-color: transparent; }
        }
        
        .client-item.editing {
            animation: highlightEdit 2s ease;
            border-left-color: #ffc107 !important;
        }
        
        /* État vide */
        .empty-state {
            text-align: center;
            padding: 50px 25px; /* Augmenté */
            color: #6c757d;
        }
        
        .empty-state i {
            font-size: 56px; /* Augmenté */
            color: #adb5bd;
            margin-bottom: 20px; /* Augmenté */
        }
        
        .empty-state p {
            margin: 0;
            font-size: 1.2rem !important; /* Augmenté */
        }
        
        .empty-state-sub {
            font-size: 1.05rem !important; /* Augmenté */
            margin-top: 8px !important; /* Augmenté */
            color: #868e96;
        }
        
        /* iPhone specific - Évite le zoom */
        @media (max-width: 480px) {
            .search-input {
                font-size: 16px !important;
            }
            
            input, textarea, select {
                font-size: 16px !important;
            }
        }
        
        /* Style pour le formulaire client */
        .client-form-section {
            background: #f8f9fa;
            padding: 20px; /* Augmenté */
            border-radius: 8px;
            margin-bottom: 25px; /* Augmenté */
            border: 1px solid #dee2e6;
        }
        
        .client-form-section h3 {
            margin-top: 0;
            color: #2c3e50;
            border-bottom: 2px solid #3498db;
            padding-bottom: 10px; /* Augmenté */
            margin-bottom: 20px; /* Augmenté */
            font-size: 1.4rem !important; /* Augmenté */
        }
        
        .form-group {
            margin-bottom: 15px; /* Augmenté */
        }
        
        .form-group label {
            font-weight: 600;
            color: #495057;
            margin-bottom: 8px; /* Augmenté */
            display: block;
            font-size: 1.1rem !important; /* Augmenté */
        }
        
        .form-control {
            width: 100%;
            padding: 12px; /* Augmenté */
            border: 1px solid #ced4da;
            border-radius: 4px;
            font-size: 1.1rem !important; /* Augmenté */
        }
        
        .form-control:focus {
            border-color: #3498db;
            box-shadow: 0 0 0 0.2rem rgba(52, 152, 219, 0.25);
            outline: none;
        }
        
        /* FORCER L'ALIGNEMENT DES BOUTONS */
        #create-client-btn, .btn-success, .btn-warning {
            display: inline-flex !important;
            align-items: center !important;
            justify-content: center !important;
            vertical-align: middle !important;
        }
        
        /* CORRECTION HAUTEUR BOUTONS */
        button {
            line-height: 1.6 !important; /* Augmenté */
            height: auto !important;
        }
        
        /* Icônes dans tout l'interface client */
        .client-item .fas, .client-item .far {
            font-size: 1.1rem !important; /* Augmenté */
        }
    `;
    document.head.appendChild(style);
}

// ==================== INTÉGRATION AVEC VOTRE CODE EXISTANT ====================

// Redéfinir la fonction displayClientsList si elle existe
if (typeof displayClientsList === 'function') {
    const originalDisplayClientsList = displayClientsList;
    window.displayClientsList = function() {
        // Essayer d'abord notre nouvelle version
        try {
            displayClientsListEnhanced();
        } catch (error) {
            console.error("Erreur affichage clients:", error);
            // Fallback à l'original
            originalDisplayClientsList();
        }
    };
} else {
    window.displayClientsList = displayClientsListEnhanced;
}

// Initialiser au chargement
document.addEventListener('DOMContentLoaded', function() {
    // Petit délai pour s'assurer que tout est chargé
    setTimeout(() => {
        initClientModification();
        console.log("✅ Modification clients initialisée");
        
        // S'assurer que la liste est affichée
        if (AppState.currentPage === 'clients') {
            setTimeout(displayClientsListEnhanced, 200);
        }
    }, 1000);
});

// Intercepter la navigation vers la page clients
const existingNavigateTo = window.navigateTo;
if (existingNavigateTo) {
    window.navigateTo = function(page) {
        existingNavigateTo(page);
        
        if (page === 'clients') {
            // Réinitialiser si on était en mode édition
            if (editingClientId) {
                setTimeout(resetCreateButtonToNormal, 100);
            }
            
            // Rafraîchir la liste
            setTimeout(displayClientsListEnhanced, 200);
        }
    };
}

// ==================== EXPOSITION DES FONCTIONS ====================

// Exposer les fonctions globalement
window.editClient = editClient;
window.updateExistingClient = updateExistingClient;
window.resetCreateButtonToNormal = resetCreateButtonToNormal;
window.selectClientById = selectClientById;
window.searchClients = function() { displayClientsListEnhanced(); };

console.log("✅ Module modification clients avec toutes les informations et police augmentée !");
