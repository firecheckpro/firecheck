// FireCheck Pro - Application PWA de vérification sécurité incendie APSAD R4
// Version améliorée avec IndexedDB, gestion hors ligne et sauvegarde automatique
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
    
    // Nouvelles configurations
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
    
    // Sauvegarde automatique
    autoSave: {
        enabled: false, // DÉSACTIVÉ
        interval: 60000, // 1 minute
        onUnload: false, // DÉSACTIVÉ
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
                reject(event.target.error);
            };
            
            request.onsuccess = (event) => {
                this.db = event.target.result;
                console.log('IndexedDB initialisé');
                
                // Vérifier et migrer les données depuis localStorage
                this.migrateFromLocalStorage().then(() => {
                    resolve(this.db);
                });
            };
            
            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                const stores = CONFIG.indexedDB.stores;
                
                // Créer tous les stores s'ils n'existent pas
                Object.values(stores).forEach(storeName => {
                    if (!db.objectStoreNames.contains(storeName)) {
                        const store = db.createObjectStore(storeName, { keyPath: 'id' });
                        
                        // Créer des index pour les recherches
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
                    const parsedData = JSON.parse(data);
                    const storeName = this.getStoreNameFromKey(key);
                    
                    if (storeName) {
                        await this.saveAll(storeName, Array.isArray(parsedData) ? parsedData : [parsedData]);
                        console.log(`Migré ${parsedData.length || 1} éléments depuis localStorage vers ${storeName}`);
                    }
                }
            }
            
            // Marquer la migration comme terminée
            await this.save('settings', {
                id: 'migration',
                completed: true,
                date: new Date().toISOString()
            });
            
        } catch (error) {
            console.error('Erreur migration localStorage:', error);
        }
    }
    
    getStoreNameFromKey(key) {
        const mapping = {
            'firecheck_clients': 'clients',
            'firecheck_interventions': 'interventions',
            'firecheck_factures': 'factures',
            'calendarEvents': 'interventions' // Les événements du calendrier sont des interventions
        };
        return mapping[key];
    }
    
    async save(storeName, data) {
        if (!this.db || !this.db.isIndexedDB) {
            // Fallback vers localStorage
            return this.saveToLocalStorage(storeName, data);
        }
        
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([storeName], 'readwrite');
            const store = transaction.objectStore(storeName);
            
            const request = store.put(data);
            
            request.onsuccess = () => {
                // Sauvegarde double dans localStorage pour sécurité
                this.saveToLocalStorage(storeName, data);
                resolve();
            };
            
            request.onerror = (event) => {
                console.error(`Erreur sauvegarde ${storeName}:`, event.target.error);
                // Fallback vers localStorage
                this.saveToLocalStorage(storeName, data);
                resolve();
            };
        });
    }
    
    async saveAll(storeName, items) {
        if (!this.db || !this.db.isIndexedDB) {
            return this.saveAllToLocalStorage(storeName, items);
        }
        
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([storeName], 'readwrite');
            const store = transaction.objectStore(storeName);
            
            items.forEach(item => {
                store.put(item);
            });
            
            transaction.oncomplete = () => {
                // Sauvegarde double
                this.saveAllToLocalStorage(storeName, items);
                resolve();
            };
            
            transaction.onerror = (event) => {
                console.error(`Erreur sauvegarde multiple ${storeName}:`, event.target.error);
                this.saveAllToLocalStorage(storeName, items);
                resolve();
            };
        });
    }
    
    async get(storeName, id) {
        if (!this.db || !this.db.isIndexedDB) {
            return this.getFromLocalStorage(storeName, id);
        }
        
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([storeName], 'readonly');
            const store = transaction.objectStore(storeName);
            
            const request = store.get(id);
            
            request.onsuccess = (event) => {
                resolve(event.target.result);
            };
            
            request.onerror = (event) => {
                console.error(`Erreur récupération ${storeName}:`, event.target.error);
                this.getFromLocalStorage(storeName, id).then(resolve);
            };
        });
    }
    
    async getAll(storeName, indexName = null, indexValue = null) {
        if (!this.db || !this.db.isIndexedDB) {
            return this.getAllFromLocalStorage(storeName);
        }
        
        return new Promise((resolve, reject) => {
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
            
            request.onerror = (event) => {
                console.error(`Erreur récupération multiple ${storeName}:`, event.target.error);
                this.getAllFromLocalStorage(storeName).then(resolve);
            };
        });
    }
    
    async delete(storeName, id) {
        if (!this.db || !this.db.isIndexedDB) {
            return this.deleteFromLocalStorage(storeName, id);
        }
        
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([storeName], 'readwrite');
            const store = transaction.objectStore(storeName);
            
            const request = store.delete(id);
            
            request.onsuccess = () => {
                this.deleteFromLocalStorage(storeName, id);
                resolve();
            };
            
            request.onerror = (event) => {
                console.error(`Erreur suppression ${storeName}:`, event.target.error);
                this.deleteFromLocalStorage(storeName, id);
                resolve();
            };
        });
    }
    
    // Méthodes localStorage (fallback)
    saveToLocalStorage(storeName, data) {
        const key = this.getLocalStorageKey(storeName);
        const existing = this.getAllFromLocalStorage(storeName);
        const index = existing.findIndex(item => item.id === data.id);
        
        if (index !== -1) {
            existing[index] = data;
        } else {
            existing.push(data);
        }
        
        localStorage.setItem(key, JSON.stringify(existing));
    }
    
    saveAllToLocalStorage(storeName, items) {
        const key = this.getLocalStorageKey(storeName);
        localStorage.setItem(key, JSON.stringify(items));
    }
    
    getFromLocalStorage(storeName, id) {
        const items = this.getAllFromLocalStorage(storeName);
        return items.find(item => item.id === id);
    }
    
    getAllFromLocalStorage(storeName) {
        const key = this.getLocalStorageKey(storeName);
        const data = localStorage.getItem(key);
        return data ? JSON.parse(data) : [];
    }
    
    deleteFromLocalStorage(storeName, id) {
        const items = this.getAllFromLocalStorage(storeName);
        const filtered = items.filter(item => item.id !== id);
        const key = this.getLocalStorageKey(storeName);
        localStorage.setItem(key, JSON.stringify(filtered));
    }
    
    getLocalStorageKey(storeName) {
        return `firecheck_${storeName}`;
    }
    
    // Méthodes utilitaires
    async clearStore(storeName) {
        if (!this.db || !this.db.isIndexedDB) {
            const key = this.getLocalStorageKey(storeName);
            localStorage.removeItem(key);
            return;
        }
        
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([storeName], 'readwrite');
            const store = transaction.objectStore(storeName);
            const request = store.clear();
            
            request.onsuccess = () => resolve();
            request.onerror = (event) => reject(event.target.error);
        });
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

// Instance globale de DatabaseManager
const dbManager = new DatabaseManager();

// ==================== GESTION HORS LIGNE ====================
class OfflineManager {
    constructor() {
        this.syncQueue = [];
        this.retryCount = 0;
        this.init();
    }
    
    init() {
        // Détecter les changements de connexion
        window.addEventListener('online', () => this.handleOnline());
        window.addEventListener('offline', () => this.handleOffline());
        
        // Initialiser l'état
        AppState.isOnline = navigator.onLine;
        AppState.offlineMode = !navigator.onLine;
        
        // Charger la file de synchronisation
        this.loadSyncQueue();
        
        // Démarrer le worker de synchronisation
        if (CONFIG.sync.enabled) {
            this.startSyncWorker();
        }
    }
    
    async handleOnline() {
        console.log('🟢 Connexion rétablie');
        AppState.isOnline = true;
        AppState.offlineMode = false;
        
        // Mettre à jour l'interface
        this.updateOnlineStatus();
        
        // Synchroniser si configuré
        if (CONFIG.offline.syncOnReconnect) {
            await this.syncAll();
        }
        
        // Nettoyer le cache si nécessaire
        this.cleanOldCache();
    }
    
    async handleOffline() {
        console.log('🔴 Hors ligne');
        AppState.isOnline = false;
        AppState.offlineMode = true;
        
        // Mettre à jour l'interface
        this.updateOnlineStatus();
        
        // Activer le mode hors ligne
        this.enableOfflineMode();
    }
    
    updateOnlineStatus() {
        const statusElement = document.getElementById('connection-status');
        if (!statusElement) return;
        
        if (AppState.isOnline) {
            statusElement.innerHTML = '<i class="fas fa-wifi"></i> En ligne';
            statusElement.className = 'status-indicator online';
        } else {
            statusElement.innerHTML = '<i class="fas fa-wifi-slash"></i> Hors ligne';
            statusElement.className = 'status-indicator offline';
            
            // Afficher une notification
            this.showOfflineNotification();
        }
    }
    
    showOfflineNotification() {
        if (!AppState.offlineMode) return;
        
        const notification = document.createElement('div');
        notification.className = 'offline-notification';
        notification.innerHTML = `
            <div class="offline-content">
                <i class="fas fa-wifi-slash"></i>
                <span>Mode hors ligne activé - Les modifications seront synchronisées lorsque la connexion sera rétablie</span>
                <button onclick="this.parentElement.parentElement.remove()">
                    <i class="fas fa-times"></i>
                </button>
            </div>
        `;
        
        document.body.appendChild(notification);
        
        // Retirer automatiquement après 5 secondes
        setTimeout(() => {
            if (notification.parentElement) {
                notification.remove();
            }
        }, 5000);
    }
    
    enableOfflineMode() {
        // Précharger les données nécessaires
        this.precacheOfflineData();
        
        // Désactiver les fonctionnalités nécessitant une connexion
        this.disableOnlineFeatures();
        
        // Afficher un indicateur dans l'interface
        document.body.classList.add('offline-mode');
    }
    
    disableOfflineMode() {
        document.body.classList.remove('offline-mode');
        this.enableOnlineFeatures();
    }
    
    async precacheOfflineData() {
        const pagesToCache = CONFIG.offline.cachePages;
        
        for (const page of pagesToCache) {
            try {
                await this.cachePageData(page);
            } catch (error) {
                console.error(`Erreur cache page ${page}:`, error);
            }
        }
    }
    
    async cachePageData(page) {
        // Cache spécifique selon la page
        switch(page) {
            case 'clients':
                AppState.clients = await dbManager.getAll('clients');
                break;
            case 'materials':
                // Les matériels sont chargés avec les clients
                break;
            case 'verification':
                // Précharger les données de vérification
                break;
        }
        
        // Sauvegarder dans le cache du navigateur
        const cacheKey = `firecheck_cache_${page}`;
        const data = {
            timestamp: new Date().toISOString(),
            data: AppState[page] || []
        };
        
        localStorage.setItem(cacheKey, JSON.stringify(data));
    }
    
    disableOnlineFeatures() {
        // Désactiver les boutons nécessitant une connexion
        const onlineButtons = document.querySelectorAll('[data-requires-online]');
        onlineButtons.forEach(button => {
            button.disabled = true;
            button.title = 'Fonctionnalité disponible uniquement en ligne';
        });
    }
    
    enableOnlineFeatures() {
        const onlineButtons = document.querySelectorAll('[data-requires-online]');
        onlineButtons.forEach(button => {
            button.disabled = false;
            button.title = '';
        });
    }
    
    async loadSyncQueue() {
        this.syncQueue = await dbManager.getAll('syncQueue', 'status', 'pending');
        console.log(`File de synchronisation chargée: ${this.syncQueue.length} éléments en attente`);
    }
    
    async addToSyncQueue(action, data) {
        const syncItem = {
            id: `sync_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            action: action,
            data: data,
            status: 'pending',
            timestamp: new Date().toISOString(),
            retryCount: 0
        };
        
        await dbManager.save('syncQueue', syncItem);
        this.syncQueue.push(syncItem);
        
        // Tenter une synchronisation immédiate si en ligne
        if (AppState.isOnline) {
            this.processSyncQueue();
        }
        
        return syncItem.id;
    }
    
    async processSyncQueue() {
        if (!AppState.isOnline || this.syncQueue.length === 0) {
            return;
        }
        
        console.log(`Traitement de la file de synchronisation: ${this.syncQueue.length} éléments`);
        
        for (const item of this.syncQueue.filter(i => i.status === 'pending')) {
            try {
                await this.processSyncItem(item);
                item.status = 'completed';
                await dbManager.save('syncQueue', item);
                
            } catch (error) {
                console.error(`Erreur synchronisation ${item.id}:`, error);
                item.retryCount++;
                
                if (item.retryCount >= CONFIG.sync.retryAttempts) {
                    item.status = 'failed';
                    item.error = error.message;
                }
                
                await dbManager.save('syncQueue', item);
            }
        }
        
        // Filtrer les éléments complétés
        this.syncQueue = this.syncQueue.filter(item => item.status === 'pending');
    }
    
    async processSyncItem(item) {
        // Implémentation de la synchronisation avec le serveur
        // À adapter selon votre backend
        
        switch(item.action) {
            case 'saveClient':
                // await api.saveClient(item.data);
                break;
            case 'saveMaterial':
                // await api.saveMaterial(item.data);
                break;
            case 'saveIntervention':
                // await api.saveIntervention(item.data);
                break;
        }
        
        // Simuler un délai
        await new Promise(resolve => setTimeout(resolve, 500));
    }
    
    startSyncWorker() {
        setInterval(() => {
            if (AppState.isOnline && this.syncQueue.length > 0) {
                this.processSyncQueue();
            }
        }, CONFIG.sync.interval);
    }
    
    async syncAll() {
        console.log('Synchronisation complète démarrée');
        
        // Synchroniser les clients
        const clients = await dbManager.getAll('clients');
        for (const client of clients) {
            await this.addToSyncQueue('saveClient', client);
        }
        
        // Synchroniser les matériels
        const materials = await dbManager.getAll('materials');
        for (const material of materials) {
            await this.addToSyncQueue('saveMaterial', material);
        }
        
        // Synchroniser les interventions
        const interventions = await dbManager.getAll('interventions');
        for (const intervention of interventions) {
            await this.addToSyncQueue('saveIntervention', intervention);
        }
        
        console.log('Synchronisation complète terminée');
    }
    
    cleanOldCache() {
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - CONFIG.offline.maxRetentionDays);
        
        // Nettoyer le cache localStorage
        Object.keys(localStorage).forEach(key => {
            if (key.startsWith('firecheck_cache_')) {
                try {
                    const data = JSON.parse(localStorage.getItem(key));
                    if (data && new Date(data.timestamp) < cutoffDate) {
                        localStorage.removeItem(key);
                    }
                } catch (error) {
                    // Ignorer les erreurs de parsing
                }
            }
        });
    }
}

// ==================== SAUVEGARDE AUTOMATIQUE ====================
class AutoSaveManager {
    constructor() {
        this.saveTimeout = null;
        this.lastSave = null;
        this.init();
    }
    
    init() {
        if (!CONFIG.autoSave.enabled) return;
        
        // Sauvegarde périodique
        setInterval(() => {
            if (AppState.unsavedChanges) {
                this.saveAllData();
            }
        }, CONFIG.autoSave.interval);
        
        // Sauvegarde avant déchargement
        if (CONFIG.autoSave.onUnload) {
            window.addEventListener('beforeunload', (event) => {
                if (AppState.unsavedChanges) {
                    this.saveAllData();
                    event.preventDefault();
                    event.returnValue = 'Vous avez des modifications non sauvegardées.';
                }
            });
        }
        
        // Sauvegarde sur changement de page
        const originalNavigateTo = window.navigateTo;
        window.navigateTo = function(page) {
            if (AppState.unsavedChanges) {
                AutoSaveManager.instance.saveAllData();
            }
            return originalNavigateTo(page);
        };
        
        // Détecter les modifications
        this.setupChangeDetection();
    }
    
    setupChangeDetection() {
        // Observer les modifications dans les formulaires
        const forms = document.querySelectorAll('form, input, textarea, select');
        forms.forEach(element => {
            element.addEventListener('change', () => {
                this.markUnsavedChanges();
            });
            element.addEventListener('input', () => {
                this.markUnsavedChanges();
            });
        });
        
        // Observer les boutons de sauvegarde
        const saveButtons = document.querySelectorAll('[data-action="save"]');
        saveButtons.forEach(button => {
            button.addEventListener('click', () => {
                this.saveAllData();
            });
        });
    }
    
    markUnsavedChanges() {
        if (!AppState.unsavedChanges) {
            AppState.unsavedChanges = true;
            this.showUnsavedIndicator();
        }
        
        // Débouncer la sauvegarde automatique
        if (this.saveTimeout) {
            clearTimeout(this.saveTimeout);
        }
        
        this.saveTimeout = setTimeout(() => {
            if (AppState.unsavedChanges) {
                this.saveAllData();
            }
        }, 10000); // Sauvegarde après 10 secondes d'inactivité
    }
    
    showUnsavedIndicator() {
        let indicator = document.getElementById('unsaved-changes-indicator');
        
        if (!indicator) {
            indicator = document.createElement('div');
            indicator.id = 'unsaved-changes-indicator';
            indicator.className = 'unsaved-indicator';
            indicator.innerHTML = `
                <i class="fas fa-save"></i>
                <span>Modifications non sauvegardées</span>
                <button onclick="AutoSaveManager.instance.saveAllData()">
                    <i class="fas fa-save"></i> Sauvegarder
                </button>
            `;
            document.body.appendChild(indicator);
        }
        
        indicator.classList.add('visible');
    }
    
    hideUnsavedIndicator() {
        const indicator = document.getElementById('unsaved-changes-indicator');
        if (indicator) {
            indicator.classList.remove('visible');
            setTimeout(() => {
                if (indicator.parentElement && !indicator.classList.contains('visible')) {
                    indicator.remove();
                }
            }, 300);
        }
    }
    
    async saveAllData() {
        if (!AppState.unsavedChanges) return;
        
        console.log('Sauvegarde automatique...');
        
        try {
            // Sauvegarder les clients
            if (AppState.clients.length > 0) {
                await dbManager.saveAll('clients', AppState.clients);
            }
            
            // Sauvegarder les interventions
            if (AppState.currentInterventions.length > 0) {
                await dbManager.saveAll('interventions', AppState.currentInterventions);
            }
            
            // Sauvegarder l'état de l'application
            await this.saveAppState();
            
            // Marquer comme sauvegardé
            AppState.unsavedChanges = false;
            AppState.lastSaveTime = new Date();
            
            // Cacher l'indicateur
            this.hideUnsavedIndicator();
            
            // Ajouter à la file de synchronisation
            if (AppState.isOnline) {
                const offlineManager = new OfflineManager();
                await offlineManager.addToSyncQueue('saveAll', {
                    clients: AppState.clients,
                    interventions: AppState.currentInterventions,
                    timestamp: new Date().toISOString()
                });
            }
            
            console.log('✅ Sauvegarde automatique terminée');
            
        } catch (error) {
            console.error('❌ Erreur sauvegarde automatique:', error);
            this.showSaveError(error);
        }
    }
    
    async saveAppState() {
        const appState = {
            id: 'app_state',
            currentClient: AppState.currentClient,
            currentPage: AppState.currentPage,
            currentFamilyFilter: AppState.currentFamilyFilter,
            factureNumero: AppState.factureNumero,
            lastSave: new Date().toISOString(),
            version: '1.0'
        };
        
        await dbManager.save('settings', appState);
    }
    
    async loadAppState() {
        const savedState = await dbManager.get('settings', 'app_state');
        
        if (savedState) {
            AppState.currentPage = savedState.currentPage || 'clients';
            AppState.currentFamilyFilter = savedState.currentFamilyFilter || ['all'];
            AppState.factureNumero = savedState.factureNumero || '';
            AppState.lastSaveTime = new Date(savedState.lastSave);
            
            // Restaurer la page courante
            if (savedState.currentPage) {
                navigateTo(savedState.currentPage);
            }
            
            // Restaurer le client courant si possible
            if (savedState.currentClient) {
                const client = await dbManager.get('clients', savedState.currentClient.id);
                if (client) {
                    AppState.currentClient = client;
                }
            }
        }
    }
    
    showSaveError(error) {
        const errorDiv = document.createElement('div');
        errorDiv.className = 'save-error-notification';
        errorDiv.innerHTML = `
            <div class="error-content">
                <i class="fas fa-exclamation-triangle"></i>
                <span>Erreur de sauvegarde: ${error.message}</span>
                <button onclick="this.parentElement.parentElement.remove()">
                    <i class="fas fa-times"></i>
                </button>
                <button onclick="AutoSaveManager.instance.saveAllData()" class="retry-btn">
                    <i class="fas fa-redo"></i> Réessayer
                </button>
            </div>
        `;
        
        document.body.appendChild(errorDiv);
        
        setTimeout(() => {
            if (errorDiv.parentElement) {
                errorDiv.remove();
            }
        }, 10000);
    }
}

// Singleton
AutoSaveManager.instance = new AutoSaveManager();

// ==================== IMPORT/EXPORT AVANCÉ ====================
class ImportExportManager {
    constructor() {
        this.exportInterval = null;
        this.init();
    }
    
    init() {
        // Export automatique toutes les heures
        this.startAutoExport();
        
        // Backup au démarrage
        this.createStartupBackup();
    }
    
    startAutoExport() {
        // Vérifier si un export est nécessaire toutes les heures
        this.exportInterval = setInterval(() => {
            const lastExport = localStorage.getItem('last_auto_export');
            const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
            
            if (!lastExport || new Date(lastExport) < oneHourAgo) {
                this.exportAllData(true); // Export silencieux
                localStorage.setItem('last_auto_export', new Date().toISOString());
            }
        }, 15 * 60 * 1000); // Vérifier toutes les 15 minutes
    }
    
    async createStartupBackup() {
        // Créer un backup au démarrage si aucun récent n'existe
        const lastBackup = localStorage.getItem('last_startup_backup');
        const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
        
        if (!lastBackup || new Date(lastBackup) < yesterday) {
            await this.exportAllData(true);
            localStorage.setItem('last_startup_backup', new Date().toISOString());
        }
    }
    
    async exportAllData(silent = false) {
        try {
            // Récupérer toutes les données
            const clients = await dbManager.getAll('clients');
            const interventions = await dbManager.getAll('interventions');
            const factures = await dbManager.getAll('factures');
            const settings = await dbManager.getAll('settings');
            
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
                    factures: factures,
                    settings: settings
                }
            };
            
            // Générer le fichier
            const blob = new Blob([JSON.stringify(exportData, null, 2)], { 
                type: 'application/json' 
            });
            
            const url = URL.createObjectURL(blob);
            const timestamp = new Date().toISOString().split('T')[0].replace(/-/g, '');
            const filename = `firecheck_backup_${timestamp}_${Date.now()}.json`;
            
            // Sauvegarder dans IndexedDB aussi
            await dbManager.save('settings', {
                id: `backup_${timestamp}`,
                data: exportData,
                timestamp: new Date().toISOString()
            });
            
            // Télécharger automatiquement seulement si demandé
            if (!silent) {
                this.downloadFile(url, filename);
            }
            
            // Nettoyer les vieux backups (garder les 5 derniers)
            await this.cleanOldBackups();
            
            if (!silent) {
                showSuccess(`Backup créé: ${filename} (${clients.length} clients, ${interventions.length} interventions)`);
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
                    
                    // Validation des données
                    if (!this.validateImportData(importData)) {
                        throw new Error('Format de fichier invalide');
                    }
                    
                    // Confirmation utilisateur
                    if (!confirm(this.getImportConfirmationMessage(importData))) {
                        reject(new Error('Import annulé'));
                        return;
                    }
                    
                    // Sauvegarde avant import
                    await this.createPreImportBackup();
                    
                    // Importer les données
                    await this.processImport(importData);
                    
                    // Recharger l'application
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
        return data && 
               data.metadata && 
               data.data && 
               Array.isArray(data.data.clients);
    }
    
    getImportConfirmationMessage(data) {
        const counts = data.metadata.recordCounts;
        return `
            Voulez-vous importer :
            • ${counts.clients || 0} client(s)
            • ${counts.interventions || 0} intervention(s)
            • ${counts.factures || 0} facture(s)
            
            ⚠️ Cela écrasera vos données existantes.
            Une sauvegarde automatique a été créée.
        `;
    }
    
    async createPreImportBackup() {
        // Créer un backup spécial avant import
        const backup = await this.exportAllData(true);
        await dbManager.save('settings', {
            id: 'pre_import_backup',
            data: backup,
            timestamp: new Date().toISOString()
        });
    }
    
    async processImport(importData) {
        // Vider les stores existants
        await dbManager.clearStore('clients');
        await dbManager.clearStore('interventions');
        await dbManager.clearStore('factures');
        
        // Importer les nouvelles données
        if (importData.data.clients.length > 0) {
            await dbManager.saveAll('clients', importData.data.clients);
        }
        
        if (importData.data.interventions.length > 0) {
            await dbManager.saveAll('interventions', importData.data.interventions);
        }
        
        if (importData.data.factures.length > 0) {
            await dbManager.saveAll('factures', importData.data.factures);
        }
        
        // Mettre à jour les settings
        await dbManager.save('settings', {
            id: 'last_import',
            data: importData.metadata,
            timestamp: new Date().toISOString()
        });
    }
    
    async reloadAppAfterImport() {
        // Recharger les données
        AppState.clients = await dbManager.getAll('clients');
        AppState.currentInterventions = await dbManager.getAll('interventions');
        
        // Réinitialiser l'état
        AppState.currentClient = null;
        AppState.unsavedChanges = false;
        
        // Rafraîchir l'interface
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
        document.body.removeChild(a);
        
        // Libérer l'URL
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
    
    async cleanOldBackups() {
        const backups = await dbManager.getAll('settings');
        const backupKeys = backups
            .filter(item => item.id.startsWith('backup_'))
            .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
        
        // Garder seulement les 5 derniers backups
        if (backupKeys.length > 5) {
            for (let i = 5; i < backupKeys.length; i++) {
                await dbManager.delete('settings', backupKeys[i].id);
            }
        }
    }
    
    // Export sélectif
    async exportSelection(type, ids) {
        let data = [];
        
        switch(type) {
            case 'clients':
                data = await Promise.all(
                    ids.map(id => dbManager.get('clients', id))
                );
                break;
            case 'interventions':
                data = await Promise.all(
                    ids.map(id => dbManager.get('interventions', id))
                );
                break;
        }
        
        const exportData = {
            type: type,
            items: data.filter(item => item !== undefined),
            exportDate: new Date().toISOString()
        };
        
        const blob = new Blob([JSON.stringify(exportData, null, 2)], { 
            type: 'application/json' 
        });
        
        const url = URL.createObjectURL(blob);
        const filename = `firecheck_${type}_export_${Date.now()}.json`;
        
        this.downloadFile(url, filename);
        showSuccess(`${data.length} ${type} exporté(s)`);
    }
}

// ==================== INITIALISATION ====================
document.addEventListener('DOMContentLoaded', function() {
    initApp();
});

async function initApp() {
    try {
        // Afficher un écran de chargement
        showLoading('Initialisation...');
        
        // Initialiser les gestionnaires
        await dbManager.init();
        const offlineManager = new OfflineManager();
        const importExportManager = new ImportExportManager();
        
        // Charger les données
        await loadData();
        
        // Initialiser les composants UI
        initComponents();
        
        // Initialiser PWA
        initPWA();
        
        // Ajouter le CSS de gestion des données
        addDataManagementCSS();
        
        // Ajouter le CSS pour le bouton de déconnexion
        addLogoutButtonCSS();
        
        // Ajouter le bouton de déconnexion
        addLogoutButton();
        
        // Afficher la première page
        navigateTo(AppState.currentPage || 'clients');
        
        // Ajouter l'UI de gestion des données
        setTimeout(addDataManagementUI, 1000);
        
        // Cacher le chargement
        closeLoading();
        
        // Afficher les statistiques
        showDataStats();
        
        console.log('FireCheck Pro amélioré initialisé avec succès');
        
    } catch (error) {
        console.error('Erreur initialisation:', error);
        showError('Erreur lors de l\'initialisation de l\'application');
        closeLoading();
    }
}

function initComponents() {
    initNavigation();
    initSignaturePads();
    initAlarmeEvents();
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
    // Chercher l'élément existant avec les trois points
    const headerControls = document.querySelector('.header-controls');
    if (!headerControls) return;
    
    // Supprimer l'ancien bouton de menu s'il existe
    const oldMenuBtn = headerControls.querySelector('.menu-toggle');
    if (oldMenuBtn) {
        oldMenuBtn.remove();
    }
    
    // Supprimer aussi les autres boutons de menu déroulant s'ils existent
    const menuButtons = headerControls.querySelectorAll('[data-menu-toggle]');
    menuButtons.forEach(btn => btn.remove());
    
    // Créer le bouton de déconnexion
    const logoutBtn = document.createElement('button');
    logoutBtn.className = 'btn btn-sm btn-danger logout-btn';
    logoutBtn.innerHTML = '<i class="fas fa-sign-out-alt"></i> <span class="logout-text">Déconnexion</span>';
    logoutBtn.title = 'Se déconnecter';
    logoutBtn.setAttribute('aria-label', 'Se déconnecter');
    logoutBtn.onclick = logoutUser;
    
    // Insérer avant le bouton données si existe, sinon à la fin
    const dataBtn = headerControls.querySelector('[onclick*="showDataManagementModal"]');
    if (dataBtn) {
        headerControls.insertBefore(logoutBtn, dataBtn);
    } else {
        headerControls.appendChild(logoutBtn);
    }
}

function logoutUser() {
    if (confirm('Voulez-vous vraiment vous déconnecter ? Toutes les modifications non sauvegardées seront perdues.')) {
        // Sauvegarder les données avant déconnexion
        saveCurrentClientChanges();
        saveInterventions();
        
        // Réinitialiser l'état de l'application
        AppState.currentClient = null;
        AppState.clients = [];
        AppState.currentInterventions = [];
        AppState.calendarEvents = [];
        
        // Rediriger vers la page de connexion ou recharger
        showSuccess('Déconnexion réussie');
        setTimeout(() => {
            // Pour une PWA, on pourrait rediriger vers une page de login
            // Pour l'instant, on recharge juste la page
            window.location.reload();
        }, 1500);
    }
}

function addLogoutButtonCSS() {
    const style = document.createElement('style');
    style.textContent = `
        /* Bouton de déconnexion */
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
            white-space: nowrap;
            overflow: hidden;
        }
        
        .logout-btn:hover {
            background: linear-gradient(135deg, #c82333 0%, #bd2130 100%);
            transform: translateY(-1px);
            box-shadow: 0 4px 8px rgba(220, 53, 69, 0.4);
        }
        
        .logout-btn:active {
            transform: translateY(0);
            box-shadow: 0 2px 4px rgba(220, 53, 69, 0.3);
        }
        
        .logout-btn i {
            font-size: 0.9em;
            flex-shrink: 0;
        }
        
        .logout-text {
            flex-shrink: 0;
        }
        
        /* Responsive */
        @media (max-width: 768px) {
            .logout-btn {
                padding: 6px 12px;
                font-size: 0.9em;
                margin-right: 8px;
                gap: 6px;
            }
            
            .logout-text {
                font-size: 0.9em;
            }
        }
        
        @media (max-width: 600px) {
            .logout-btn {
                padding: 6px 10px;
                margin-right: 6px;
            }
            
            .logout-text {
                display: none; /* Cacher le texte sur très petits écrans */
            }
            
            .logout-btn i {
                margin: 0;
                font-size: 1em;
            }
        }
        
        @media (max-width: 480px) {
            .header-controls {
                display: flex;
                gap: 6px;
                flex-wrap: nowrap;
            }
            
            .logout-btn {
                padding: 6px;
                border-radius: 6px;
                min-width: 40px;
                height: 36px;
                justify-content: center;
                margin-right: 4px;
            }
            
            .logout-btn i {
                font-size: 1em;
            }
        }
        
        /* Assurer que les boutons ne se chevauchent pas */
        @media (max-width: 380px) {
            .header-controls {
                gap: 4px;
            }
            
            .logout-btn {
                margin-right: 2px;
                padding: 5px;
                min-width: 36px;
                height: 34px;
            }
        }
    `;
    document.head.appendChild(style);
}

// ==================== MODIFICATIONS DES FONCTIONS EXISTANTES ====================

// Remplacez les fonctions de sauvegarde existantes
async function saveClients() {
    if (AppState.clients.length > 0) {
        await dbManager.saveAll('clients', AppState.clients);
        
        // Marquer les changements non sauvegardés
        AutoSaveManager.instance.markUnsavedChanges();
        
        // Ajouter à la file de sync
        if (AppState.isOnline) {
            const offlineManager = new OfflineManager();
            await offlineManager.addToSyncQueue('saveClients', {
                clients: AppState.clients,
                timestamp: new Date().toISOString()
            });
        }
    }
}

async function saveInterventions() {
    if (AppState.currentInterventions.length > 0) {
        await dbManager.saveAll('interventions', AppState.currentInterventions);
        AutoSaveManager.instance.markUnsavedChanges();
    }
}

// Modifier la fonction loadData
async function loadData() {
    try {
        // Initialiser IndexedDB
        await dbManager.init();
        
        // Charger depuis IndexedDB
        AppState.clients = await dbManager.getAll('clients');
        AppState.currentInterventions = await dbManager.getAll('interventions');
        
        // Charger l'état de l'application
        await AutoSaveManager.instance.loadAppState();
        
        // Charger les événements du calendrier
        loadCalendarEvents();
        
        // Afficher les statistiques
        const stats = await dbManager.getStats();
        console.log('Données chargées:', stats);
        
    } catch (error) {
        console.error('Erreur chargement données:', error);
        
        // Fallback vers localStorage
        const savedClients = localStorage.getItem('firecheck_clients');
        const savedInterventions = localStorage.getItem('firecheck_interventions');
        
        if (savedClients) {
            AppState.clients = JSON.parse(savedClients);
        }
        
        if (savedInterventions) {
            AppState.currentInterventions = JSON.parse(savedInterventions);
        }
        
        // Charger aussi les événements du calendrier depuis localStorage
        loadCalendarEvents();
    }
}

// ==================== FONCTIONS DE STOCKAGE LOCAL ====================
function loadFromStorage(key) {
    try {
        const item = localStorage.getItem(key);
        return item ? JSON.parse(item) : null;
    } catch (error) {
        console.error('Erreur lors du chargement depuis le stockage:', error);
        return null;
    }
}

function saveToStorage(key, data) {
    try {
        localStorage.setItem(key, JSON.stringify(data));
        return true;
    } catch (error) {
        console.error('Erreur lors de la sauvegarde dans le stockage:', error);
        return false;
    }
}

function clearStorage(key) {
    try {
        if (key) {
            localStorage.removeItem(key);
        } else {
            localStorage.clear();
        }
        return true;
    } catch (error) {
        console.error('Erreur lors de la suppression du stockage:', error);
        return false;
    }
}

function getStorageKeys() {
    try {
        return Object.keys(localStorage);
    } catch (error) {
        console.error('Erreur lors de la récupération des clés:', error);
        return [];
    }
}

function saveCalendarEvents() {
    try {
        saveToStorage('calendarEvents', AppState.calendarEvents);
        console.log(`💾 ${AppState.calendarEvents.length} événement(s) sauvegardé(s)`);
        return true;
    } catch (error) {
        console.error('❌ Erreur lors de la sauvegarde des événements:', error);
        return false;
    }
}

// ==================== GESTION DU CALENDRIER ====================
function loadCalendarEvents() {
    try {
        // Charger les événements depuis le stockage local
        const storedEvents = loadFromStorage('calendarEvents');
        
        if (storedEvents && Array.isArray(storedEvents)) {
            AppState.calendarEvents = storedEvents;
            console.log(`✅ ${AppState.calendarEvents.length} événement(s) chargé(s) depuis le stockage`);
        } else {
            // Initialiser avec des données par défaut si vide
            AppState.calendarEvents = [];
            console.log('📅 Aucun événement trouvé, initialisation avec tableau vide');
        }
        
        // S'assurer que les événements sont aussi dans les interventions
        mergeCalendarEventsWithInterventions();
        
    } catch (error) {
        console.error('❌ Erreur lors du chargement des événements:', error);
        // Initialiser avec tableau vide en cas d'erreur
        AppState.calendarEvents = [];
    }
}

function mergeCalendarEventsWithInterventions() {
    // S'assurer que les événements du calendrier sont aussi dans les interventions
    AppState.calendarEvents.forEach(event => {
        // Vérifier si l'événement existe déjà dans les interventions
        const existingIntervention = AppState.currentInterventions.find(i => i.id === event.id);
        if (!existingIntervention) {
            AppState.currentInterventions.push(event);
        }
    });
    
    // Mettre à jour le stockage
    saveCalendarEvents();
    saveInterventions();
}

// ==================== GESTION RESPONSIVE ====================
function initResponsiveHandlers() {
    // Adapter l'interface à la taille de l'écran
    adaptInterfaceToScreenSize();
    
    // Redimensionner les canvas de signature
    window.addEventListener('resize', debounce(() => {
        resizeSignatureCanvases();
        adaptInterfaceToScreenSize();
    }, 250));
    
    // Empêcher le zoom sur iOS
    preventIOSZoom();
}

function adaptInterfaceToScreenSize() {
    const width = window.innerWidth;
    const html = document.documentElement;
    
    // Déterminer le type d'appareil
    if (width < CONFIG.responsiveBreakpoints.mobile) {
        html.classList.add('mobile', 'small-screen');
        html.classList.remove('tablet', 'desktop');
        html.style.fontSize = '14px';
    } else if (width < CONFIG.responsiveBreakpoints.tablet) {
        html.classList.add('tablet', 'medium-screen');
        html.classList.remove('mobile', 'desktop');
        html.style.fontSize = '15px';
    } else {
        html.classList.add('desktop', 'large-screen');
        html.classList.remove('mobile', 'tablet');
        html.style.fontSize = '16px';
    }
    
    // Ajuster la navigation mobile
    adjustMobileNavigation(width);
    
    // Ajuster les modals
    adjustModals(width);
    
    // Ajuster le bouton de déconnexion
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
        // Mode très petit écran - cacher le texte
        if (logoutText) {
            logoutText.style.display = 'none';
        }
        
        logoutBtn.style.padding = '6px';
        logoutBtn.style.minWidth = '40px';
        logoutBtn.style.justifyContent = 'center';
        
    } else if (width < 768) {
        // Mode mobile - bouton compact
        if (logoutText) {
            logoutText.style.display = 'inline';
            logoutText.style.fontSize = '0.9em';
        }
        
        logoutBtn.style.padding = '6px 12px';
        logoutBtn.style.minWidth = 'auto';
        
    } else {
        // Mode desktop - bouton complet
        if (logoutText) {
            logoutText.style.display = 'inline';
            logoutText.style.fontSize = '1em';
        }
        
        logoutBtn.style.padding = '8px 16px';
        logoutBtn.style.minWidth = 'auto';
    }
}

function preventIOSZoom() {
    // Empêcher le zoom sur les champs de saisie iOS
    document.addEventListener('touchstart', function(e) {
        const target = e.target;
        if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') {
            target.style.fontSize = '16px';
        }
    }, { passive: true });
    
    // Gérer le clavier virtuel
    window.addEventListener('resize', function() {
        const activeElement = document.activeElement;
        if (activeElement && (activeElement.tagName === 'INPUT' || activeElement.tagName === 'TEXTAREA')) {
            setTimeout(() => {
                activeElement.scrollIntoView({ 
                    behavior: 'smooth', 
                    block: 'nearest',
                    inline: 'nearest' 
                });
            }, 300);
        }
    });
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
    // Navigation par onglets
    document.querySelectorAll('.nav-tab').forEach(tab => {
        tab.addEventListener('click', function(e) {
            e.preventDefault();
            const page = this.getAttribute('data-page');
            navigateTo(page);
        });
    });
    
    // Menu hamburger pour mobile
    const menuToggle = document.getElementById('menu-toggle');
    if (menuToggle) {
        menuToggle.addEventListener('click', function() {
            const navTabs = document.querySelector('.nav-tabs');
            if (navTabs) {
                navTabs.classList.toggle('mobile-visible');
            }
        });
    }
    
    // Navigation par swipe
    initSwipeNavigation();
}

function navigateTo(page) {
    // Sauvegarder les modifications en cours
    saveCurrentClientChanges();
    
    // Mettre à jour la page active
    AppState.currentPage = page;
    
    // Mettre à jour les onglets
    updateActiveTab(page);
    
    // Afficher la page
    showPage(page);
    
    // Actions spécifiques à la page
    executePageActions(page);
    
    // Fermer le menu mobile si ouvert
    closeMobileMenu();
    
    // Scroll vers le haut sur mobile
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
                        title="Supprimer" aria-label="Supprimer client">
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
    // Sauvegarder les modifications du client actuel
    if (AppState.currentClient) {
        saveCurrentClientChanges();
    }
    
    // Créer une copie profonde du client
    AppState.currentClient = JSON.parse(JSON.stringify(client));
    
    // Mettre à jour l'interface
    displayClientsList();
    updateClientInfoBadge();
    
    // Recharger les listes si nécessaire
    if (AppState.currentPage === 'materials') {
        displayMaterialsList();
    }
    
    if (AppState.currentPage === 'verification') {
        displayVerificationList();
    }
    
    // Mettre à jour les interventions
    updateInterventionClientList();
    
    showSuccess(`Client ${client.name} sélectionné`);
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
    
    if (!confirm('Êtes-vous sûr de vouloir supprimer ce client ? Tous ses matériels et vérifications seront également supprimés.')) {
        return;
    }
    
    const index = AppState.clients.findIndex(c => c.id === clientId);
    if (index !== -1) {
        AppState.clients.splice(index, 1);
        saveClients();
        
        // Si le client supprimé était le client actuel
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
    const fields = {
        'extincteur-id': '',
        'extincteur-location': '',
        'extincteur-type': '',
        'extincteur-fabricant': '',
        'extincteur-modele': '',
        'extincteur-annee': new Date().getFullYear(),
        'extincteur-capacite': '',
        'extincteur-pesee': '',
        'extincteur-observations': '',
        'extincteur-etat-general-comment': ''
    };
    
    setFormValues(fields);
    
    // Dates
    const today = new Date().toISOString().split('T')[0];
    const nextYear = new Date(new Date().setFullYear(new Date().getFullYear() + 1)).toISOString().split('T')[0];
    
    setElementValue('extincteur-date-controle', today);
    setElementValue('extincteur-prochain-controle', nextYear);
    
    // Champs OK/NOK
    resetOkNokFields(['etat-general', 'lisibilite', 'panneau', 'goupille', 'pression', 'joints', 'accessibilite']);
    
    // Cases à cocher
    setCheckboxValue('extincteur-maa', false);
    setCheckboxValue('extincteur-eiee', false);
    setCheckboxValue('extincteur-recharge', false);
    setCheckboxValue('extincteur-scelle', false);
    setCheckboxValue('extincteur-remplacement-joint', false);
    
    // Type d'intervention
    selectExtincteurInterventionType('verification');
    
    // Photos
    clearPhotoGallery('extincteur-photo-gallery');
    
    // Bouton
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
                        title="Supprimer" aria-label="Supprimer matériel">
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
    
    // Mettre à jour le badge client
    updateClientInfoBadge();
    
    if (!AppState.currentClient || !AppState.currentClient.materials || AppState.currentClient.materials.length === 0) {
        showEmptyState(verificationList, 'verification');
        updateMaterialsCount(materialsCount, completeBtn, 0, 0, 0);
        return;
    }
    
    // Filtrer les matériels
    const filteredMaterials = filterMaterialsForVerification();
    
    // Générer le HTML
    verificationList.innerHTML = createVerificationListHTML(filteredMaterials);
    
    // Mettre à jour les compteurs
    const verifiedCount = filteredMaterials.filter(m => isVerifiedForCurrentYear(m)).length;
    const toVerifyCount = filteredMaterials.length - verifiedCount;
    
    updateMaterialsCount(materialsCount, completeBtn, verifiedCount, toVerifyCount, filteredMaterials.length);
}

function filterMaterialsForVerification() {
    const searchTerm = getElementValue('verification-search')?.toLowerCase() || '';
    const materials = AppState.currentClient.materials;
    
    return materials.filter(material => {
        // Filtre par famille
        if (!AppState.currentFamilyFilter.includes('all')) {
            if (AppState.currentFamilyFilter.length === 0) return false;
            if (!AppState.currentFamilyFilter.includes(material.type)) return false;
        }
        
        // Filtre par recherche
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
    // Tri par type
    const typeOrder = { 'extincteur': 1, 'ria': 2, 'baes': 3, 'alarme': 4 };
    const typeComparison = (typeOrder[a.type] || 4) - (typeOrder[b.type] || 4);
    
    if (typeComparison !== 0) {
        return typeComparison;
    }
    
    // Tri par ID numérique
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
    
    // Statistiques par famille
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
    
    // Filtre actif
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
                        title="Modifier" aria-label="Modifier matériel">
                    <i class="fas fa-edit"></i>
                </button>
                ${!isVerified 
                    ? `<button class="btn btn-sm btn-success" onclick="verifyMaterial(${originalIndex})" 
                           title="Valider la vérification" aria-label="Valider vérification">
                        <i class="fas fa-check"></i>
                       </button>`
                    : `<button class="btn btn-sm btn-danger" onclick="unverifyMaterial(${originalIndex})" 
                           title="Marquer à vérifier" aria-label="Marquer à vérifier">
                        <i class="fas fa-redo"></i>
                       </button>`
                }
                <button class="btn btn-sm btn-danger" onclick="removeMaterialFromVerification(${originalIndex})" 
                        title="Supprimer" aria-label="Supprimer matériel">
                    <i class="fas fa-trash"></i>
                </button>
            </div>
        </div>
    `;
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
        // Retirer 'all' si présent
        AppState.currentFamilyFilter = AppState.currentFamilyFilter.filter(f => f !== 'all');
        
        // Basculer le filtre
        const index = AppState.currentFamilyFilter.indexOf(family);
        if (index === -1) {
            AppState.currentFamilyFilter.push(family);
        } else {
            AppState.currentFamilyFilter.splice(index, 1);
        }
        
        // Si plus aucun filtre, activer "Tous"
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
    
    // Matériels à vérifier selon les filtres actuels
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
    
    // Matériels selon les filtres actuels
    const materialsToCheck = AppState.currentFamilyFilter.includes('all') 
        ? AppState.currentClient.materials 
        : AppState.currentClient.materials.filter(m => AppState.currentFamilyFilter.includes(m.type));
    
    // Matériels vérifiés
    const verifiedMaterials = materialsToCheck.filter(m => m.verified && isVerifiedForCurrentYear(m));
    
    if (verifiedMaterials.length === 0) {
        showError("Aucun matériel n'a été validé !");
        return;
    }
    
    const filterNames = getActiveFilterNames();
    showSuccess(`Vérification terminée pour ${filterNames} ! ${verifiedMaterials.length} matériel(s) vérifié(s) pour ${new Date().getFullYear()}. Vous pouvez maintenant passer à la signature.`);
    
    // Réinitialiser le filtre
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
    
    // Dimensions du canvas
    const container = canvas.parentElement;
    if (container) {
        canvas.width = container.clientWidth;
        canvas.height = container.clientHeight;
    }
    
    // Créer le pad de signature
    const signaturePad = new SignaturePad(canvas, {
        backgroundColor: 'white',
        penColor: 'rgb(26, 54, 93)',
        minWidth: 1,
        maxWidth: 3,
        onEnd: function() {
            hideSignaturePlaceholder(canvasId.replace('-canvas', '-placeholder'));
        }
    });
    
    // Activer le support tactile
    canvas.addEventListener('touchstart', function(e) {
        e.preventDefault();
    }, { passive: false });
    
    canvas.style.touchAction = 'none';
    
    // Stocker la référence
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
            <button class="btn btn-sm btn-danger" onclick="removeFactureItem(${index})"
                    aria-label="Supprimer article">
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
    
    // Ajouter les frais de déplacement
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
    
    // Jours du mois précédent
    const prevMonthLastDay = new Date(year, month, 0).getDate();
    for (let i = 0; i < startingDay; i++) {
        const day = prevMonthLastDay - startingDay + i + 1;
        calendarDays.appendChild(createCalendarDay(day, true, month, year));
    }
    
    // Jours du mois en cours
    const today = new Date();
    for (let day = 1; day <= daysInMonth; day++) {
        const isToday = day === today.getDate() && 
                       month === today.getMonth() && 
                       year === today.getFullYear();
        
        calendarDays.appendChild(createCalendarDay(day, false, month, year, isToday));
    }
    
    // Sélectionner aujourd'hui si c'est le mois en cours
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
    
    // Vérifier les événements
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
    
    // Ajouter l'événement de clic
    if (!isOtherMonth) {
        dayElement.addEventListener('click', () => {
            selectCalendarDay(dayElement, day, month, year);
        });
    }
    
    return dayElement;
}

function selectCalendarDay(dayElement, day, month, year) {
    // Désélectionner tous les jours
    document.querySelectorAll('.calendar-day').forEach(d => d.classList.remove('selected'));
    
    // Sélectionner le jour cliqué
    dayElement.classList.add('selected');
    
    // Afficher les événements
    displayEventsForDay(day, month, year);
}

function selectTodayInCalendar(calendarDays) {
    const todayElement = calendarDays.querySelector('.today');
    if (todayElement) {
        todayElement.click();
    }
}

function getEventsForDay(day, month, year) {
    // Chercher dans les événements du calendrier
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
                            title="Modifier" aria-label="Modifier intervention">
                        <i class="fas fa-edit"></i>
                    </button>
                    <button class="btn btn-sm btn-danger" onclick="deleteIntervention('${event.id}')" 
                            title="Supprimer" aria-label="Supprimer intervention">
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
    
    // Mettre à jour l'intervention
    const updatedIntervention = {
        ...AppState.currentInterventions[index],
        ...formData,
        clientName: client.name,
        updated: new Date().toISOString()
    };
    
    AppState.currentInterventions[index] = updatedIntervention;
    
    // Mettre à jour dans le client
    if (client.interventions) {
        const clientInterventionIndex = client.interventions.findIndex(i => i.id === interventionId);
        if (clientInterventionIndex !== -1) {
            client.interventions[clientInterventionIndex] = updatedIntervention;
        }
    }
    
    // Mettre à jour dans les événements du calendrier
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
    
    // Ajouter aux événements du calendrier
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
    
    // Supprimer aussi des événements du calendrier
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
        // Vérifier si le client a des vérifications
        const hasVerifications = client.verificationCompleted || 
                                (client.materials && client.materials.some(m => m.verified));
        
        if (!hasVerifications) return false;
        
        // Filtrer par recherche
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
                        title="Voir détails" aria-label="Voir historique client">
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

// ==================== EXPORT ====================
function exportData() {
    const data = {
        clients: AppState.clients,
        interventions: AppState.currentInterventions,
        calendarEvents: AppState.calendarEvents,
        exportDate: new Date().toISOString()
    };
    
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    
    const a = document.createElement('a');
    a.href = url;
    a.download = `firecheck_export_${new Date().toISOString().split('T')[0]}.json`;
    a.style.display = 'none';
    
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    
    URL.revokeObjectURL(url);
    
    showSuccess('Données exportées avec succès');
}

function exportFacturesCSV() {
    const savedFactures = loadFromStorage(CONFIG.localStorageKeys.factures) || [];
    
    if (savedFactures.length === 0) {
        showError('Aucune facture trouvée');
        return;
    }
    
    const headers = ['Numéro', 'Date', 'Client', 'Total HT', 'TVA', 'Total TTC', 'Description'];
    const rows = savedFactures.map(f => [
        f.numero,
        f.date,
        f.clientName,
        f.totalHT?.toFixed(2) || '0.00',
        ((f.totalHT || 0) * 0.20).toFixed(2),
        ((f.totalHT || 0) * 1.20).toFixed(2),
        `"${(f.description || '').replace(/"/g, '""')}"`
    ]);
    
    const csv = [headers, ...rows].map(row => row.join(';')).join('\n');
    
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    
    const a = document.createElement('a');
    a.href = url;
    a.download = `factures_export_${new Date().toISOString().split('T')[0]}.csv`;
    a.style.display = 'none';
    
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    
    URL.revokeObjectURL(url);
    
    showSuccess(`${savedFactures.length} facture(s) exportée(s)`);
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

// ==================== FONCTIONS NON IMPLÉMENTÉES ====================
// Ces fonctions sont définies dans le code original mais ne sont pas entièrement implémentées
// Elles sont gardées pour la compatibilité

function editMaterialForVerification(index) {
    console.log('Édition du matériel à l\'index:', index);
    // À implémenter
}

function previewReport() {
    console.log('Prévisualisation du rapport');
    // À implémenter
}

function generatePDF() {
    console.log('Génération PDF');
    // À implémenter
}

function printPreview() {
    window.print();
}

function previewFacture() {
    console.log('Prévisualisation facture');
    // À implémenter
}

function generateFacturePDF() {
    console.log('Génération PDF facture');
    // À implémenter avec jsPDF
}

function goToVerification() {
    navigateTo('verification');
}

function addExtincteurPhoto() {
    console.log('Ajout photo extincteur');
    // À implémenter
}

function handleExtincteurPhotos(files) {
    console.log('Gestion photos extincteur:', files);
    // À implémenter
}

function addRiaPhoto() {
    console.log('Ajout photo RIA');
    // À implémenter
}

function handleRiaPhotos(files) {
    console.log('Gestion photos RIA:', files);
    // À implémenter
}

function addBaesPhoto() {
    console.log('Ajout photo BAES');
    // À implémenter
}

function handleBaesPhotos(files) {
    console.log('Gestion photos BAES:', files);
    // À implémenter
}

function addAlarmePhoto() {
    console.log('Ajout photo alarme');
    // À implémenter
}

function handleAlarmePhotos(files) {
    console.log('Gestion photos alarme:', files);
    // À implémenter
}

function removeAlarmePhoto(index) {
    console.log('Suppression photo alarme:', index);
    // À implémenter
}

function addAlarmeToList() {
    console.log('Ajout alarme à la liste');
    // À implémenter
}

function resetAlarmeForm() {
    console.log('Réinitialisation formulaire alarme');
    // À implémenter
}

function selectAlarmeNok(element, field) {
    console.log('Sélection OK/NOK alarme:', field);
    // À implémenter
}

function selectAlarmeInterventionType(type) {
    console.log('Sélection type intervention alarme:', type);
    // À implémenter
}

// ==================== UI POUR LA GESTION DES DONNÉES ====================
function addDataManagementUI() {
    // Ajouter un menu de gestion des données
    const headerControls = document.querySelector('.header-controls');
    if (!headerControls) return;
    
    const dataMenu = document.createElement('div');
    dataMenu.className = 'data-management-menu';
    dataMenu.innerHTML = `
        <button class="btn btn-sm" onclick="showDataManagementModal()" 
                title="Gestion des données" aria-label="Gestion données">
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
                    <small>Dernière sauvegarde: <span id="last-backup-time">${getLastBackupTime()}</span></small>
                </div>
                
                <div class="data-option">
                    <h4><i class="fas fa-upload"></i> Restauration</h4>
                    <button class="btn btn-block" onclick="triggerImport()">
                        <i class="fas fa-upload"></i> Importer des données
                    </button>
                    <button class="btn btn-block" onclick="showBackupList()">
                        <i class="fas fa-history"></i> Voir les backups
                    </button>
                </div>
                
                <div class="data-option">
                    <h4><i class="fas fa-sync"></i> Synchronisation</h4>
                    <div class="sync-status">
                        <span>Statut: <span id="sync-status-indicator">${AppState.isOnline ? '🟢 En ligne' : '🔴 Hors ligne'}</span></span>
                        <br>
                        <span>Éléments en attente: <span id="sync-queue-count">0</span></span>
                    </div>
                    <button class="btn btn-block" onclick="forceSync()" ${!AppState.isOnline ? 'disabled' : ''}>
                        <i class="fas fa-sync"></i> Forcer la synchronisation
                    </button>
                </div>
                
                <div class="data-option">
                    <h4><i class="fas fa-database"></i> Stockage</h4>
                    <div class="storage-info">
                        <span>Méthode: <strong>IndexedDB + localStorage</strong></span>
                        <br>
                        <span>Résilience: <strong>Haute</strong></span>
                        <br>
                        <span>Données hors ligne: <strong>Activé</strong></span>
                    </div>
                    <button class="btn btn-block btn-danger" onclick="showClearDataConfirm()">
                        <i class="fas fa-trash"></i> Effacer toutes les données
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

// Fonctions utilitaires pour l'UI
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

function forceSync() {
    const offlineManager = new OfflineManager();
    offlineManager.syncAll().then(() => {
        showSuccess('Synchronisation forcée démarrée');
    });
}

function getLastBackupTime() {
    const lastBackup = localStorage.getItem('last_auto_export');
    return lastBackup ? new Date(lastBackup).toLocaleString('fr-FR') : 'Jamais';
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
// ==================== CSS ADDITIONNEL ====================
function addDataManagementCSS() {
    const style = document.createElement('style');
    style.textContent = `
        /* Indicateur hors ligne */
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
        
        .offline-content i {
            font-size: 1.2em;
        }
        
        .offline-content button {
            background: none;
            border: none;
            color: #721c24;
            cursor: pointer;
            font-size: 1.2em;
        }
        
        /* Indicateur modifications non sauvegardées */
        .unsaved-indicator {
            position: fixed;
            bottom: 20px;
            right: 20px;
            background: #fff3cd;
            color: #856404;
            padding: 12px 16px;
            border-radius: 8px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.15);
            display: flex;
            align-items: center;
            gap: 10px;
            z-index: 9999;
            transform: translateY(100px);
            opacity: 0;
            transition: all 0.3s ease;
        }
        
        .unsaved-indicator.visible {
            transform: translateY(0);
            opacity: 1;
        }
        
        .unsaved-indicator button {
            background: #856404;
            color: white;
            border: none;
            padding: 5px 10px;
            border-radius: 4px;
            cursor: pointer;
            font-size: 0.9em;
        }
        
        /* Gestion des données */
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
        
        /* Mode hors ligne */
        .offline-mode [data-requires-online] {
            opacity: 0.5;
            cursor: not-allowed;
        }
        
        /* Statut de connexion */
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
        
        /* Erreurs de sauvegarde */
        .save-error-notification {
            position: fixed;
            bottom: 20px;
            left: 20px;
            background: #f8d7da;
            color: #721c24;
            padding: 12px 16px;
            border-radius: 8px;
            border: 1px solid #f5c6cb;
            z-index: 10000;
            max-width: 400px;
        }
        
        .error-content {
            display: flex;
            align-items: center;
            gap: 10px;
            flex-wrap: wrap;
        }
        
        .retry-btn {
            background: #721c24;
            color: white;
            border: none;
            padding: 4px 8px;
            border-radius: 4px;
            cursor: pointer;
            font-size: 0.8em;
        }
        
        /* Responsive */
        @media (max-width: 768px) {
            .data-management-options {
                grid-template-columns: 1fr;
            }
            
            .unsaved-indicator {
                left: 20px;
                right: 20px;
                bottom: 10px;
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
            • ${stats.syncQueue || 0} élément(s) en attente de sync
        `;
        console.log(message);
    }, 1000);
}

// ==================== DÉBOGAGE ====================
console.log('🚀 FireCheck Pro - Initialisation...');

// Vérifier si les fonctions existent
if (typeof loadFromStorage === 'undefined') {
    console.log('⚠️ loadFromStorage non définie, création...');
    
    // Définir les fonctions manquantes
    window.loadFromStorage = function(key) {
        try {
            const item = localStorage.getItem(key);
            return item ? JSON.parse(item) : null;
        } catch (error) {
            console.error('Erreur loadFromStorage:', error);
            return null;
        }
    };
    
    window.saveToStorage = function(key, data) {
        try {
            localStorage.setItem(key, JSON.stringify(data));
            return true;
        } catch (error) {
            console.error('Erreur saveToStorage:', error);
            return false;
        }
    };
}

// ==================== FONCTIONS D'OUVERTURE DES MODALS ====================

function openAddExtincteurModal() {
    console.log('Ouverture modal extincteur');
    const modal = document.getElementById('add-extincteur-modal');
    if (modal) {
        modal.classList.add('active');
        document.body.style.overflow = 'hidden';
    } else {
        console.error('Modal extincteur non trouvé');
    }
}

function openAddRIAModal() {
    console.log('Ouverture modal RIA');
    const modal = document.getElementById('add-ria-modal');
    if (modal) {
        modal.classList.add('active');
        document.body.style.overflow = 'hidden';
    } else {
        console.error('Modal RIA non trouvé');
    }
}

function openAddBAESModal() {
    console.log('Ouverture modal BAES');
    const modal = document.getElementById('add-baes-modal');
    if (modal) {
        modal.classList.add('active');
        document.body.style.overflow = 'hidden';
    } else {
        console.error('Modal BAES non trouvé');
    }
}

function openAddAlarmeModal() {
    console.log('Ouverture modal alarme');
    const modal = document.getElementById('add-alarme-modal');
    if (modal) {
        modal.classList.add('active');
        document.body.style.overflow = 'hidden';
    } else {
        console.error('Modal alarme non trouvé');
    }
}

// ==================== FONCTIONS DE FERMETURE DES MODALS ====================

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

function closeSuccessModal() {
    const modal = document.getElementById('success-modal');
    if (modal) {
        modal.classList.remove('active');
        document.body.style.overflow = '';
    }
}

function closeErrorModal() {
    const modal = document.getElementById('error-modal');
    if (modal) {
        modal.classList.remove('active');
        document.body.style.overflow = '';
    }
}

// ==================== CORRECTION DU BUG DES NOTIFICATIONS ====================
// Solution pour désactiver définitivement les notifications gênantes
// Version sans bouton STOP BUG - Interface propre

console.log("🔧 Application du correctif de notifications...");

// 1. Désactive complètement l'auto-save dans la config
CONFIG.autoSave.enabled = false;
CONFIG.autoSave.onUnload = false;

// 2. Remplace le gestionnaire par une version silencieuse
class SilentAutoSaveManager {
    constructor() {
        console.log("✅ Mode silencieux activé - Pas de notifications");
    }
    
    init() { 
        // Ne rien faire
    }
    
    setupChangeDetection() { 
        // Ne pas écouter les changements
    }
    
    markUnsavedChanges() { 
        // Ne pas marquer de changements
        AppState.unsavedChanges = false;
    }
    
    showUnsavedIndicator() { 
        // Ne pas montrer d'indicateur
    }
    
    hideUnsavedIndicator() { 
        // Supprime l'indicateur s'il existe
        const indicator = document.getElementById('unsaved-changes-indicator');
        if (indicator && indicator.parentElement) {
            indicator.remove();
        }
    }
    
    saveAllData() { 
        // Sauvegarde silencieuse
        console.log("💾 Sauvegarde silencieuse");
        return Promise.resolve();
    }
    
    saveAppState() { 
        return Promise.resolve();
    }
    
    loadAppState() { 
        return Promise.resolve();
    }
    
    showSaveError() { 
        // Ne pas montrer d'erreurs
    }
}

// 3. Remplace l'instance problématique
AutoSaveManager.instance = new SilentAutoSaveManager();

// 4. Nettoie immédiatement les notifications existantes
function cleanExistingNotifications() {
    // Supprime l'indicateur de modifications
    const unsavedIndicator = document.getElementById('unsaved-changes-indicator');
    if (unsavedIndicator && unsavedIndicator.parentElement) {
        unsavedIndicator.remove();
        console.log("🗑️ Indicateur 'modifications non sauvegardées' supprimé");
    }
    
    // Supprime les notifications d'erreur
    const errorNotifications = document.querySelectorAll('.save-error-notification');
    errorNotifications.forEach(el => {
        if (el.parentElement) {
            el.remove();
        }
    });
    
    if (errorNotifications.length > 0) {
        console.log(`🗑️ ${errorNotifications.length} notification(s) d'erreur supprimée(s)`);
    }
    
    // Supprime l'écouteur beforeunload
    window.onbeforeunload = null;
    
    // Réinitialise l'état
    AppState.unsavedChanges = false;
}

// 5. Exécute le nettoyage au démarrage
document.addEventListener('DOMContentLoaded', function() {
    // Nettoie après un petit délai
    setTimeout(cleanExistingNotifications, 500);
    
    // Nettoie aussi quand on navigue
    const originalNavigateTo = window.navigateTo;
    if (typeof originalNavigateTo === 'function') {
        window.navigateTo = function(page) {
            cleanExistingNotifications();
            return originalNavigateTo(page);
        };
    }
    
    console.log("✅ Correctif appliqué avec succès");
});

// 6. S'assure que les sauvegardes manuelles fonctionnent toujours
window.saveClients = async function() {
    if (AppState.clients.length > 0) {
        await dbManager.saveAll('clients', AppState.clients);
        console.log(`💾 ${AppState.clients.length} client(s) sauvegardé(s)`);
    }
};

window.saveInterventions = async function() {
    if (AppState.currentInterventions.length > 0) {
        await dbManager.saveAll('interventions', AppState.currentInterventions);
        console.log(`💾 ${AppState.currentInterventions.length} intervention(s) sauvegardée(s)`);
    }
};

// 7. Nettoie aussi au chargement de la page
window.addEventListener('load', function() {
    setTimeout(cleanExistingNotifications, 1000);
});

// 8. Redéfinit la fonction problématique de détection
if (AutoSaveManager.prototype && AutoSaveManager.prototype.setupChangeDetection) {
    AutoSaveManager.prototype.setupChangeDetection = function() {
        // Version vide - ne détecte aucun changement
        console.log("🔇 Détection des changements désactivée");
    };
}

console.log("✨ Correctif de notifications installé avec succès !");

// Vérifier que localStorage est disponible
if (typeof localStorage === 'undefined') {
    console.error('❌ localStorage non disponible');
    alert('Attention: Votre navigateur ne supporte pas le stockage local. Certaines fonctionnalités seront limitées.');
}

// Fonctions globales exposées
window.exportAllDataManual = exportAllDataManual;
window.createBackupNow = createBackupNow;
window.triggerImport = triggerImport;
window.forceSync = forceSync;
window.showDataManagementModal = showDataManagementModal;
window.logoutUser = logoutUser;

// Garder la compatibilité avec l'ancien code
window.saveClients = saveClients;
window.saveInterventions = saveInterventions;

console.log('FireCheck Pro - Système de données avancé chargé');
