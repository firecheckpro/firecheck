// FireCheck Pro - Application PWA de vérification sécurité incendie APSAD R4

// ==================== VARIABLES GLOBALES ====================
let currentClient = null;
let clients = [];
let currentPage = 'clients';
let currentMonth = new Date().getMonth();
let currentYear = new Date().getFullYear();
let currentEditingMaterialIndex = -1;
let currentInterventions = [];
let clientSignaturePad = null;
let technicianSignaturePad = null;
let factureItems = [];
let fraisDeplacement = 0;
let factureNumero = '';
let currentEditingInterventionId = null;

// Variables pour la navigation par swipe
let touchStartX = 0;
let touchEndX = 0;

// Variables pour le filtrage par famille (maintenant multi-sélection)
let currentFamilyFilter = ['all']; // Tableau pour stocker les filtres sélectionnés
let availableFamilyFilters = ['all', 'extincteur', 'ria', 'baes', 'alarme'];

// Variables pour les alarmes
let currentAlarmePhotos = [];
let materials = [];
let currentVerificationIndex = null;
let currentVerificationPhotos = [];

// ==================== INITIALISATION ====================
document.addEventListener('DOMContentLoaded', function() {
    initApp();
});

function initApp() {
    // Charger les données
    loadClients();
    loadInterventions();
    
    // Initialiser la navigation
    initNavigation();
    
    // Initialiser les pads de signature
    initSignaturePads();
    
    // Initialiser la date du jour
    setTodayDate();
    
    // Initialiser le calendrier
    generateCalendar(currentMonth, currentYear);
    
    // Initialiser les événements du calendrier
    loadCalendarEvents();
    
    // Initialiser le numéro de facture
    generateFactureNumber();
    
    // Initialiser les événements pour l'alarme
    initAlarmeEvents();
    
    // Initialiser la page
    navigateTo('clients');
    
    // Initialiser la navigation par swipe
    initSwipeNavigation();
    
    // Initialiser les événements tactiles pour les mobiles
    initTouchEvents();
    
    // Initialiser PWA
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('service-worker.js')
            .then(registration => {
                console.log('Service Worker enregistré avec succès:', registration);
            })
            .catch(error => {
                console.log('Échec de l\'enregistrement du Service Worker:', error);
            });
    }
    
    // Adapter l'interface à la taille de l'écran
    adaptInterfaceToScreenSize();
    
    // Redimensionner les canvas de signature
    window.addEventListener('resize', function() {
        resizeSignatureCanvases();
        adaptInterfaceToScreenSize();
    });
}

// ==================== ADAPTATION RESPONSIVE ====================
function adaptInterfaceToScreenSize() {
    const width = window.innerWidth;
    const isMobile = width < 768;
    const isTablet = width >= 768 && width < 1024;
    
    // Ajuster la taille des textes
    const html = document.documentElement;
    if (isMobile) {
        html.style.fontSize = '14px';
        document.body.classList.add('mobile-view');
        document.body.classList.remove('tablet-view', 'desktop-view');
    } else if (isTablet) {
        html.style.fontSize = '15px';
        document.body.classList.add('tablet-view');
        document.body.classList.remove('mobile-view', 'desktop-view');
    } else {
        html.style.fontSize = '16px';
        document.body.classList.add('desktop-view');
        document.body.classList.remove('mobile-view', 'tablet-view');
    }
    
    // Ajuster la navigation
    const navTabs = document.querySelector('.nav-tabs');
    if (navTabs) {
        if (isMobile) {
            navTabs.classList.add('mobile-nav');
            navTabs.classList.remove('tablet-nav');
        } else {
            navTabs.classList.remove('mobile-nav');
        }
    }
    
    // Ajuster les modals
    const modals = document.querySelectorAll('.modal-content');
    modals.forEach(modal => {
        if (isMobile) {
            modal.style.maxWidth = '95%';
            modal.style.margin = '1rem auto';
            modal.style.padding = '1rem';
        } else if (isTablet) {
            modal.style.maxWidth = '90%';
            modal.style.margin = '2rem auto';
        } else {
            modal.style.maxWidth = '800px';
            modal.style.margin = '3rem auto';
        }
    });
}

function initTouchEvents() {
    // Empêcher le zoom sur les champs de saisie sur mobile
    document.addEventListener('touchstart', function(e) {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
            e.target.style.fontSize = '16px'; // Empêche le zoom automatique sur iOS
        }
    });
    
    // Gérer le clavier virtuel
    window.addEventListener('resize', function() {
        if (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA') {
            setTimeout(() => {
                document.activeElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }, 300);
        }
    });
}

function resizeSignatureCanvases() {
    if (clientSignaturePad) {
        const canvas = document.getElementById('client-signature-canvas');
        const data = clientSignaturePad.toData();
        canvas.width = canvas.offsetWidth;
        canvas.height = canvas.offsetHeight;
        clientSignaturePad.clear();
        if (data && data.length > 0) {
            clientSignaturePad.fromData(data);
        }
    }
    
    if (technicianSignaturePad) {
        const canvas = document.getElementById('technician-signature-canvas');
        const data = technicianSignaturePad.toData();
        canvas.width = canvas.offsetWidth;
        canvas.height = canvas.offsetHeight;
        technicianSignaturePad.clear();
        if (data && data.length > 0) {
            technicianSignaturePad.fromData(data);
        }
    }
}

// ==================== GESTION DES DONNÉES ====================
function loadClients() {
    const savedClients = localStorage.getItem('firecheck_clients');
    if (savedClients) {
        clients = JSON.parse(savedClients);
        displayClientsList();
    }
}

function saveClients() {
    localStorage.setItem('firecheck_clients', JSON.stringify(clients));
}

function loadInterventions() {
    const saved = localStorage.getItem('firecheck_interventions');
    if (saved) {
        currentInterventions = JSON.parse(saved);
    }
}

function saveInterventions() {
    localStorage.setItem('firecheck_interventions', JSON.stringify(currentInterventions));
}

// ==================== NAVIGATION ====================
function initNavigation() {
    const tabs = document.querySelectorAll('.nav-tab');
    tabs.forEach(tab => {
        tab.addEventListener('click', function(e) {
            e.preventDefault();
            const page = this.getAttribute('data-page');
            navigateTo(page);
        });
    });
    
    // Bouton menu hamburger pour mobile
    const menuToggle = document.getElementById('menu-toggle');
    if (menuToggle) {
        menuToggle.addEventListener('click', function() {
            const navTabs = document.querySelector('.nav-tabs');
            navTabs.classList.toggle('mobile-visible');
        });
    }
}

function navigateTo(page) {
    // Sauvegarder les modifications du client actuel avant de changer de page
    saveCurrentClientChanges();
    
    // Mettre à jour la page active
    currentPage = page;
    
    // Mettre à jour les onglets
    document.querySelectorAll('.nav-tab').forEach(tab => {
        tab.classList.remove('active');
        if (tab.getAttribute('data-page') === page) {
            tab.classList.add('active');
        }
    });
    
    // Afficher la page
    document.querySelectorAll('.page').forEach(pageEl => {
        pageEl.classList.remove('active');
    });
    document.getElementById(`page-${page}`).classList.add('active');
    
    // Cacher le menu mobile si ouvert
    const navTabs = document.querySelector('.nav-tabs');
    if (navTabs && navTabs.classList.contains('mobile-visible')) {
        navTabs.classList.remove('mobile-visible');
    }
    
    // Actions spécifiques à chaque page
    switch(page) {
        case 'clients':
            displayClientsList();
            break;
        case 'materials':
            updateClientInfoBadge();
            displayMaterialsList();
            break;
        case 'verification':
            // Mettre à jour le badge avant d'afficher la liste de vérification
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
            generateCalendar(currentMonth, currentYear);
            break;
    }
    
    // Scroll vers le haut sur mobile
    if (window.innerWidth < 768) {
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }
}

// ==================== NAVIGATION PAR SWIPE ====================
function initSwipeNavigation() {
    // Ne pas activer le swipe sur les zones de saisie
    document.addEventListener('touchstart', e => {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || 
            e.target.tagName === 'SELECT' || e.target.isContentEditable) {
            return;
        }
        touchStartX = e.changedTouches[0].screenX;
    });

    document.addEventListener('touchend', e => {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || 
            e.target.tagName === 'SELECT' || e.target.isContentEditable) {
            return;
        }
        touchEndX = e.changedTouches[0].screenX;
        handleSwipe();
    });
}

function handleSwipe() {
    const swipeThreshold = 50;
    const diff = touchStartX - touchEndX;
    
    if (Math.abs(diff) > swipeThreshold) {
        if (diff > 0) {
            navigateToNextPage();
        } else {
            navigateToPreviousPage();
        }
    }
}

function navigateToNextPage() {
    const pages = ['clients', 'materials', 'verification', 'signature', 'history', 'planning'];
    const currentIndex = pages.indexOf(currentPage);
    
    if (currentIndex < pages.length - 1) {
        navigateTo(pages[currentIndex + 1]);
    }
}

function navigateToPreviousPage() {
    const pages = ['clients', 'materials', 'verification', 'signature', 'history', 'planning'];
    const currentIndex = pages.indexOf(currentPage);
    
    if (currentIndex > 0) {
        navigateTo(pages[currentIndex - 1]);
    }
}

// ==================== SAUVEGARDE DES MODIFICATIONS DU CLIENT ====================
function saveCurrentClientChanges() {
    if (currentClient) {
        const clientIndex = clients.findIndex(c => c.id === currentClient.id);
        
        if (clientIndex !== -1) {
            clients[clientIndex] = JSON.parse(JSON.stringify(currentClient));
            saveClients();
        }
    }
}

// ==================== GESTION DES CLIENTS ====================
function createClient() {
    const name = document.getElementById('client-name').value;
    const contact = document.getElementById('client-contact').value;
    const address = document.getElementById('client-address').value;
    const technician = document.getElementById('technician-name').value;
    const email = document.getElementById('client-email').value;
    const phone = document.getElementById('client-phone').value;
    const notes = document.getElementById('client-notes').value;
    
    if (!name || !contact || !address || !technician) {
        showError('Veuillez remplir tous les champs obligatoires (*)');
        return;
    }
    
    const newClient = {
        id: generateId(),
        name: name,
        contact: contact,
        address: address,
        technician: technician,
        email: email,
        phone: phone,
        notes: notes,
        createdDate: new Date().toISOString(),
        materials: [],
        interventions: []
    };
    
    clients.push(newClient);
    saveClients();
    
    selectClient(newClient);
    
    // Réinitialiser le formulaire
    document.getElementById('client-name').value = '';
    document.getElementById('client-contact').value = '';
    document.getElementById('client-address').value = '';
    document.getElementById('client-email').value = '';
    document.getElementById('client-phone').value = '';
    document.getElementById('client-notes').value = '';
    document.getElementById('technician-name').value = technician;
    
    showSuccess('Client créé avec succès !');
    displayClientsList();
}

function displayClientsList() {
    const clientsList = document.getElementById('clients-list');
    const searchTerm = document.getElementById('client-search')?.value?.toLowerCase() || '';
    
    const filteredClients = clients.filter(client => 
        client.name.toLowerCase().includes(searchTerm) ||
        client.contact.toLowerCase().includes(searchTerm) ||
        client.address.toLowerCase().includes(searchTerm)
    );
    
    if (filteredClients.length === 0) {
        clientsList.innerHTML = `
            <div class="empty-state">
                <i class="fas fa-users"></i>
                <p>Aucun client trouvé</p>
                <p class="empty-state-sub">Créez votre premier client ci-dessus</p>
            </div>
        `;
        return;
    }
    
    clientsList.innerHTML = '';
    
    filteredClients.forEach(client => {
        const materialsCount = client.materials?.length || 0;
        const isSelected = currentClient && currentClient.id === client.id;
        
        clientsList.innerHTML += `
            <div class="compact-material-item client-item ${isSelected ? 'selected' : ''}" 
                 onclick="selectClient(${JSON.stringify(client).replace(/"/g, '&quot;')})">
                <div class="compact-material-info">
                    <div class="compact-material-name">
                        <i class="fas fa-user"></i>
                        ${client.name}
                        ${isSelected ? '<span class="status-badge status-ok">Sélectionné</span>' : ''}
                    </div>
                    <div class="compact-material-details">
                        ${client.contact} • ${client.address}
                        <br>
                        <small>${materialsCount} matériel(s) • Créé le ${formatDate(client.createdDate)}</small>
                    </div>
                </div>
                <div class="compact-material-actions">
                    <button class="btn btn-sm btn-danger" onclick="deleteClient('${client.id}', event)" title="Supprimer">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            </div>
        `;
    });
}

function searchClients() {
    displayClientsList();
}

function selectClient(client) {
    if (currentClient) {
        saveCurrentClientChanges();
    }
    
    currentClient = JSON.parse(JSON.stringify(client));
    displayClientsList();
    updateClientInfoBadge();
    
    if (currentPage === 'materials') {
        displayMaterialsList();
    }
    
    if (currentPage === 'verification') {
        displayVerificationList();
    }
    
    updateInterventionClientList();
    showSuccess(`Client ${client.name} sélectionné`);
}

function deleteClient(clientId, event) {
    event.stopPropagation();
    
    if (!confirm('Êtes-vous sûr de vouloir supprimer ce client ? Tous ses matériels et vérifications seront également supprimés.')) {
        return;
    }
    
    const index = clients.findIndex(c => c.id === clientId);
    if (index !== -1) {
        clients.splice(index, 1);
        saveClients();
        
        if (currentClient && currentClient.id === clientId) {
            currentClient = null;
            updateClientInfoBadge();
            if (currentPage === 'materials' || currentPage === 'verification') {
                displayMaterialsList();
                displayVerificationList();
            }
        }
        
        displayClientsList();
        showSuccess('Client supprimé avec succès');
    }
}

function updateClientInfoBadge() {
    const badge = document.getElementById('client-info-badge');
    const verificationClientBadge = document.getElementById('verification-client-badge');
    
    if (currentClient) {
        // Mettre à jour le badge principal
        badge.innerHTML = `<i class="fas fa-user"></i> ${currentClient.name}`;
        badge.className = 'status-badge status-ok';
        
        // Mettre à jour le badge sur la page vérification
        if (verificationClientBadge) {
            const materialsCount = currentClient.materials?.length || 0;
            verificationClientBadge.innerHTML = `
                <i class="fas fa-user"></i> ${currentClient.name}
                <span class="badge-count">${materialsCount} matériel(s)</span>
            `;
            verificationClientBadge.className = 'status-badge status-ok';
            verificationClientBadge.style.display = 'flex';
            verificationClientBadge.style.alignItems = 'center';
            verificationClientBadge.style.gap = '0.5rem';
        }
    } else {
        badge.innerHTML = '<i class="fas fa-user"></i> Sélectionnez un client';
        badge.className = 'status-badge status-warning';
        
        if (verificationClientBadge) {
            verificationClientBadge.innerHTML = '<i class="fas fa-user"></i> Sélectionnez un client';
            verificationClientBadge.className = 'status-badge status-warning';
            verificationClientBadge.style.display = 'flex';
            verificationClientBadge.style.alignItems = 'center';
        }
    }
}

// ==================== GESTION DES MATERIELS ====================
function openAddExtincteurModal() {
    resetExtincteurForm();
    document.getElementById('add-extincteur-modal').classList.add('active');
    currentEditingMaterialIndex = -1;
}

function openAddRIAModal() {
    resetRIAForm();
    document.getElementById('add-ria-modal').classList.add('active');
    currentEditingMaterialIndex = -1;
}

function openAddBAESModal() {
    resetBAESForm();
    document.getElementById('add-baes-modal').classList.add('active');
    currentEditingMaterialIndex = -1;
}

function resetExtincteurForm() {
    document.getElementById('extincteur-id').value = '';
    document.getElementById('extincteur-location').value = '';
    document.getElementById('extincteur-type').value = '';
    document.getElementById('extincteur-fabricant').value = '';
    document.getElementById('extincteur-modele').value = '';
    document.getElementById('extincteur-annee').value = new Date().getFullYear();
    document.getElementById('extincteur-capacite').value = '';
    
    const today = new Date().toISOString().split('T')[0];
    const nextYear = new Date(new Date().setFullYear(new Date().getFullYear() + 1)).toISOString().split('T')[0];
    
    document.getElementById('extincteur-date-controle').value = today;
    document.getElementById('extincteur-prochain-controle').value = nextYear;
    
    ['etat-general', 'lisibilite', 'panneau', 'goupille', 'pression', 'joints', 'accessibilite'].forEach(field => {
        const selector = document.querySelector(`[onclick*="${field}"]`);
        if (selector) {
            const options = selector.parentElement.querySelectorAll('.ok-nok-option');
            options.forEach(opt => opt.classList.remove('selected'));
        }
        document.getElementById(`extincteur-${field}`).value = '';
    });
    
    document.getElementById('extincteur-pesee').value = '';
    document.getElementById('extincteur-observations').value = '';
    document.getElementById('extincteur-etat-general-comment').value = '';
    
    document.getElementById('extincteur-maa').checked = false;
    document.getElementById('extincteur-eiee').checked = false;
    document.getElementById('extincteur-recharge').checked = false;
    document.getElementById('extincteur-scelle').checked = false;
    document.getElementById('extincteur-remplacement-joint').checked = false;
    
    selectExtincteurInterventionType('verification');
    document.getElementById('extincteur-photo-gallery').innerHTML = '';
    
    const modal = document.getElementById('add-extincteur-modal');
    modal.querySelector('.btn-success').onclick = addExtincteurToList;
    modal.querySelector('.btn-success').innerHTML = '<i class="fas fa-plus"></i> Ajouter';
}

function resetRIAForm() {
    document.getElementById('ria-id').value = '';
    document.getElementById('ria-location').value = '';
    document.getElementById('ria-type').value = '';
    document.getElementById('ria-marque').value = '';
    document.getElementById('ria-annee').value = new Date().getFullYear();
    
    const today = new Date().toISOString().split('T')[0];
    const nextYear = new Date(new Date().setFullYear(new Date().getFullYear() + 1)).toISOString().split('T')[0];
    
    document.getElementById('ria-date-verif').value = today;
    document.getElementById('ria-date-prochaine').value = nextYear;
    
    ['tuyau', 'joints', 'organes', 'signalisation', 'visuel'].forEach(field => {
        const selector = document.querySelector(`[onclick*="${field}"]`);
        if (selector) {
            const options = selector.parentElement.querySelectorAll('.ok-nok-option');
            options.forEach(opt => opt.classList.remove('selected'));
        }
        document.getElementById(`ria-${field}`).value = '';
    });
    
    document.getElementById('ria-devidoir').value = '';
    document.getElementById('ria-pression-statique').value = '';
    document.getElementById('ria-pression-dynamique').value = '';
    document.getElementById('ria-debit').value = '';
    document.getElementById('ria-observations').value = '';
    
    document.getElementById('ria-devidoir-pivotant').checked = false;
    document.getElementById('ria-devidoir-fixe').checked = false;
    
    selectRIAInterventionType('verification');
    document.getElementById('ria-photo-gallery').innerHTML = '';
    
    const modal = document.getElementById('add-ria-modal');
    modal.querySelector('.btn-success').onclick = addRIAtoList;
    modal.querySelector('.btn-success').innerHTML = '<i class="fas fa-plus"></i> Ajouter';
}

function resetBAESForm() {
    document.getElementById('baes-id').value = '';
    document.getElementById('baes-location').value = '';
    document.getElementById('baes-type').value = '';
    document.getElementById('baes-marque').value = '';
    document.getElementById('baes-modele').value = '';
    document.getElementById('baes-puissance').value = '';
    
    const today = new Date().toISOString().split('T')[0];
    const nextSixMonths = new Date(new Date().setMonth(new Date().getMonth() + 6)).toISOString().split('T')[0];
    
    document.getElementById('baes-date-verif').value = today;
    document.getElementById('baes-date-prochaine').value = nextSixMonths;
    
    ['visuel', 'lampe', 'batteries', 'fonctionnement', 'autonomie', 'signalisation', 'accessibilite'].forEach(field => {
        const selector = document.querySelector(`[onclick*="${field}"]`);
        if (selector) {
            const options = selector.parentElement.querySelectorAll('.ok-nok-option');
            options.forEach(opt => opt.classList.remove('selected'));
        }
        document.getElementById(`baes-${field}`).value = '';
    });
    
    document.getElementById('baes-observations').value = '';
    
    document.getElementById('baes-lampe-ampoule').checked = false;
    document.getElementById('baes-lampe-led').checked = false;
    
    document.getElementById('baes-test-autonomie').checked = false;
    document.getElementById('baes-test-charge').checked = false;
    document.getElementById('baes-test-fonction').checked = false;
    
    selectBAESInterventionType('verification');
    document.getElementById('baes-photo-gallery').innerHTML = '';
    
    const modal = document.getElementById('add-baes-modal');
    modal.querySelector('.btn-success').onclick = addBAEStoList;
    modal.querySelector('.btn-success').innerHTML = '<i class="fas fa-plus"></i> Ajouter';
}

function addExtincteurToList() {
    if (!currentClient) {
        showError('Veuillez d\'abord sélectionner un client');
        return;
    }
    
    const extincteur = {
        type: 'extincteur',
        id: document.getElementById('extincteur-id').value,
        localisation: document.getElementById('extincteur-location').value,
        typeExtincteur: document.getElementById('extincteur-type').value,
        fabricant: document.getElementById('extincteur-fabricant').value,
        modele: document.getElementById('extincteur-modele').value,
        annee: document.getElementById('extincteur-annee').value,
        capacite: document.getElementById('extincteur-capacite').value,
        dateControle: document.getElementById('extincteur-date-controle').value,
        prochainControle: document.getElementById('extincteur-prochain-controle').value,
        etatGeneral: document.getElementById('extincteur-etat-general').value,
        etatGeneralComment: document.getElementById('extincteur-etat-general-comment').value,
        lisibilite: document.getElementById('extincteur-lisibilite').value,
        panneau: document.getElementById('extincteur-panneau').value,
        goupille: document.getElementById('extincteur-goupille').value,
        pression: document.getElementById('extincteur-pression').value,
        pesee: document.getElementById('extincteur-pesee').value,
        joints: document.getElementById('extincteur-joints').value,
        accessibilite: document.getElementById('extincteur-accessibilite').value,
        observations: document.getElementById('extincteur-observations').value,
        scelle: document.getElementById('extincteur-scelle').checked,
        remplacementJoint: document.getElementById('extincteur-remplacement-joint').checked,
        interventionType: document.getElementById('extincteur-intervention-type').value,
        interventions: {
            maa: document.getElementById('extincteur-maa').checked,
            eiee: document.getElementById('extincteur-eiee').checked,
            recharge: document.getElementById('extincteur-recharge').checked
        },
        photos: [],
        verified: false,
        dateVerification: null
    };
    
    if (!extincteur.id || !extincteur.localisation || !extincteur.typeExtincteur) {
        showError('Veuillez remplir tous les champs obligatoires');
        return;
    }
    
    if (!currentClient.materials) {
        currentClient.materials = [];
    }
    currentClient.materials.push(extincteur);
    saveCurrentClientChanges();
    closeExtincteurModal();
    displayMaterialsList();
    showSuccess('Extincteur ajouté avec succès');
}

function addRIAtoList() {
    if (!currentClient) {
        showError('Veuillez d\'abord sélectionner un client');
        return;
    }
    
    const ria = {
        type: 'ria',
        id: document.getElementById('ria-id').value,
        localisation: document.getElementById('ria-location').value,
        typeRIA: document.getElementById('ria-type').value,
        marque: document.getElementById('ria-marque').value,
        annee: document.getElementById('ria-annee').value,
        dateVerification: document.getElementById('ria-date-verif').value,
        dateProchaineVerification: document.getElementById('ria-date-prochaine').value,
        tuyau: document.getElementById('ria-tuyau').value,
        devidoir: document.getElementById('ria-devidoir').value,
        typeDevidoir: document.querySelector('input[name="ria-devidoir-type"]:checked')?.value || '',
        joints: document.getElementById('ria-joints').value,
        pressionStatique: document.getElementById('ria-pression-statique').value,
        pressionDynamique: document.getElementById('ria-pression-dynamique').value,
        debit: document.getElementById('ria-debit').value,
        organes: document.getElementById('ria-organes').value,
        signalisation: document.getElementById('ria-signalisation').value,
        visuel: document.getElementById('ria-visuel').value,
        observations: document.getElementById('ria-observations').value,
        interventionType: document.getElementById('ria-intervention-type').value,
        photos: [],
        verified: false,
        dateVerification: null
    };
    
    if (!ria.id || !ria.localisation || !ria.typeRIA) {
        showError('Veuillez remplir tous les champs obligatoires');
        return;
    }
    
    if (!currentClient.materials) {
        currentClient.materials = [];
    }
    currentClient.materials.push(ria);
    saveCurrentClientChanges();
    closeRIAModal();
    displayMaterialsList();
    showSuccess('RIA ajouté avec succès');
}

function addBAEStoList() {
    if (!currentClient) {
        showError('Veuillez d\'abord sélectionner un client');
        return;
    }
    
    const baes = {
        type: 'baes',
        id: document.getElementById('baes-id').value,
        localisation: document.getElementById('baes-location').value,
        typeBAES: document.getElementById('baes-type').value,
        marque: document.getElementById('baes-marque').value,
        modele: document.getElementById('baes-modele').value,
        puissance: document.getElementById('baes-puissance').value,
        dateVerification: document.getElementById('baes-date-verif').value,
        dateProchaineVerification: document.getElementById('baes-date-prochaine').value,
        visuel: document.getElementById('baes-visuel').value,
        typeLampe: document.querySelector('input[name="baes-lampe-type"]:checked')?.value || '',
        lampe: document.getElementById('baes-lampe').value,
        batteries: document.getElementById('baes-batteries').value,
        fonctionnement: document.getElementById('baes-fonctionnement').value,
        autonomie: document.getElementById('baes-autonomie').value,
        signalisation: document.getElementById('baes-signalisation').value,
        accessibilite: document.getElementById('baes-accessibilite').value,
        observations: document.getElementById('baes-observations').value,
        interventionType: document.getElementById('baes-intervention-type').value,
        tests: {
            autonomie: document.getElementById('baes-test-autonomie').checked,
            charge: document.getElementById('baes-test-charge').checked,
            fonction: document.getElementById('baes-test-fonction').checked
        },
        photos: [],
        verified: false,
        dateVerification: null
    };
    
    if (!baes.id || !baes.localisation || !baes.typeBAES) {
        showError('Veuillez remplir tous les champs obligatoires');
        return;
    }
    
    if (!currentClient.materials) {
        currentClient.materials = [];
    }
    currentClient.materials.push(baes);
    saveCurrentClientChanges();
    closeBAESModal();
    displayMaterialsList();
    showSuccess('BAES ajouté avec succès');
}

function displayMaterialsList() {
    const materialsList = document.getElementById('materials-list');
    const materialsCountBadge = document.getElementById('materials-count-badge');
    
    if (!currentClient || !currentClient.materials || currentClient.materials.length === 0) {
        materialsList.innerHTML = `
            <div class="empty-state">
                <i class="fas fa-clipboard-list"></i>
                <p>Aucun matériel dans la liste</p>
                <p class="empty-state-sub">Ajoutez des matériels ci-dessus</p>
            </div>
        `;
        materialsCountBadge.textContent = '0';
        return;
    }
    
    const materials = currentClient.materials;
    materialsCountBadge.textContent = materials.length;
    materialsList.innerHTML = '';
    
    materials.forEach((material, index) => {
        let materialClass = '';
        let materialIcon = '';
        let materialTypeText = '';
        
        switch(material.type) {
            case 'extincteur':
                materialClass = 'extincteur';
                materialIcon = 'fa-fire-extinguisher';
                materialTypeText = 'Extincteur';
                break;
            case 'ria':
                materialClass = 'ria';
                materialIcon = 'fa-faucet';
                materialTypeText = 'RIA';
                break;
            case 'baes':
                materialClass = 'baes';
                materialIcon = 'fa-lightbulb';
                materialTypeText = 'BAES';
                break;
            case 'alarme':
                materialClass = 'alarme';
                materialIcon = 'fa-bell';
                materialTypeText = 'Alarme';
                break;
        }
        
        const isVerified = material.verified;
        const verifiedBadge = isVerified ? 
            `<span class="status-badge status-ok">
                <i class="fas fa-check-circle"></i> Vérifié
            </span>` : '';
        
        materialsList.innerHTML += `
            <div class="compact-material-item ${materialClass}">
                <div class="compact-material-info">
                    <div class="compact-material-name">
                        <i class="fas ${materialIcon}"></i>
                        ${materialTypeText} - ${material.id || material.numero}
                        ${verifiedBadge}
                    </div>
                    <div class="compact-material-details">
                        ${material.localisation || material.location || 'Non spécifié'}
                        ${material.interventionType === 'installation' ? 
                          '<span class="status-badge status-purple"><i class="fas fa-wrench"></i> Installation</span>' : 
                          '<span class="status-badge status-info"><i class="fas fa-clipboard-check"></i> Vérification</span>'}
                    </div>
                </div>
                <div class="compact-material-actions">
                    <button class="btn btn-sm btn-danger" onclick="removeMaterial(${index})" title="Supprimer">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            </div>
        `;
    });
}

function removeMaterial(index) {
    if (!currentClient || !currentClient.materials || !currentClient.materials[index]) {
        showError("Matériel non trouvé");
        return;
    }
    
    const material = currentClient.materials[index];
    if (!confirm(`Voulez-vous vraiment supprimer ${material.id || material.numero} ?`)) {
        return;
    }
    
    currentClient.materials.splice(index, 1);
    saveCurrentClientChanges();
    displayMaterialsList();
    
    if (currentPage === 'verification') {
        displayVerificationList();
    }
    
    showSuccess("Matériel supprimé avec succès");
}

// ==================== VERIFICATION DES MATERIELS ====================
function displayVerificationList() {
    const verificationList = document.getElementById('verification-list');
    const materialsCount = document.getElementById('materials-count');
    const completeBtn = document.getElementById('complete-btn');
    const searchTerm = document.getElementById('verification-search')?.value?.toLowerCase() || '';
    
    // Mettre à jour le badge client sur la page vérification
    updateClientInfoBadge();
    
    if (!currentClient || !currentClient.materials || currentClient.materials.length === 0) {
        verificationList.innerHTML = `
            <div class="empty-state">
                <i class="fas fa-clipboard-check"></i>
                <p>Aucun matériel à vérifier</p>
                <p class="empty-state-sub">Retournez à la page précédente pour ajouter des matériels</p>
            </div>
        `;
        if (materialsCount) {
            materialsCount.innerHTML = `<i class="fas fa-list"></i> 0 matériel(s)`;
        }
        if (completeBtn) {
            completeBtn.disabled = true;
        }
        return;
    }
    
    // Filtrer les matériels selon le terme de recherche ET les familles sélectionnées
    let filteredMaterials = currentClient.materials.filter(material => {
        // Filtre par famille (multi-sélection)
        if (!currentFamilyFilter.includes('all')) {
            if (currentFamilyFilter.length === 0) return false; // Si aucun filtre sélectionné
            if (!currentFamilyFilter.includes(material.type)) return false;
        }
        
        // Filtre par recherche
        const materialId = (material.id || material.numero || '').toLowerCase();
        const materialLocation = (material.localisation || material.location || '').toLowerCase();
        const materialType = material.type ? material.type.toLowerCase() : '';
        const materialTypeExtincteur = (material.typeExtincteur || '').toLowerCase();
        
        return materialId.includes(searchTerm) || 
               materialLocation.includes(searchTerm) || 
               materialType.includes(searchTerm) ||
               materialTypeExtincteur.includes(searchTerm);
    });
    
    // Trier les matériels par type puis par numéro (du plus petit au plus grand)
    filteredMaterials.sort((a, b) => {
        // Tri par type d'abord
        const typeOrder = { 'extincteur': 1, 'ria': 2, 'baes': 3, 'alarme': 4 };
        const typeComparison = (typeOrder[a.type] || 4) - (typeOrder[b.type] || 4);
        
        if (typeComparison !== 0) {
            return typeComparison;
        }
        
        // Si même type, tri par numéro
        const aId = a.id || a.numero || '';
        const bId = b.id || b.numero || '';
        
        // Extraire les parties numériques des IDs
        const aNum = parseInt(aId.replace(/\D/g, '')) || 0;
        const bNum = parseInt(bId.replace(/\D/g, '')) || 0;
        
        return aNum - bNum;
    });
    
    let verifiedCount = 0;
    let toVerifyCount = 0;
    
    verificationList.innerHTML = '';
    
    // Ajouter les filtres par famille en haut de la liste (version multi-sélection)
    verificationList.innerHTML = `
        <div class="family-filters">
            <div class="family-filter-header">
                <i class="fas fa-filter"></i> Filtrer par famille :
            </div>
            <div class="family-filter-buttons">
                <button class="family-filter-btn ${currentFamilyFilter.includes('all') ? 'active' : ''}" 
                        onclick="toggleFamilyFilter('all')">
                    <i class="fas fa-layer-group"></i> Tous
                </button>
                <button class="family-filter-btn ${currentFamilyFilter.includes('extincteur') ? 'active' : ''}" 
                        onclick="toggleFamilyFilter('extincteur')">
                    <i class="fas fa-fire-extinguisher"></i> Extincteurs
                </button>
                <button class="family-filter-btn ${currentFamilyFilter.includes('ria') ? 'active' : ''}" 
                        onclick="toggleFamilyFilter('ria')">
                    <i class="fas fa-faucet"></i> RIA
                </button>
                <button class="family-filter-btn ${currentFamilyFilter.includes('baes') ? 'active' : ''}" 
                        onclick="toggleFamilyFilter('baes')">
                    <i class="fas fa-lightbulb"></i> BAES
                </button>
                <button class="family-filter-btn ${currentFamilyFilter.includes('alarme') ? 'active' : ''}" 
                        onclick="toggleFamilyFilter('alarme')">
                    <i class="fas fa-bell"></i> Alarmes
                </button>
            </div>
            <div class="family-filter-stats">
                <span class="filter-stat">
                    <i class="fas fa-list"></i> ${filteredMaterials.length} matériel(s) filtré(s)
                </span>
                <span class="filter-stat">
                    <i class="fas fa-fire-extinguisher"></i> ${currentClient.materials.filter(m => m.type === 'extincteur').length} extincteur(s)
                </span>
                <span class="filter-stat">
                    <i class="fas fa-faucet"></i> ${currentClient.materials.filter(m => m.type === 'ria').length} RIA
                </span>
                <span class="filter-stat">
                    <i class="fas fa-lightbulb"></i> ${currentClient.materials.filter(m => m.type === 'baes').length} BAES
                </span>
                <span class="filter-stat">
                    <i class="fas fa-bell"></i> ${currentClient.materials.filter(m => m.type === 'alarme').length} alarme(s)
                </span>
                ${currentFamilyFilter.length > 0 && !currentFamilyFilter.includes('all') ? 
                    `<span class="filter-stat filter-active">
                        <i class="fas fa-filter"></i> Filtre actif: ${currentFamilyFilter.map(f => {
                            switch(f) {
                                case 'extincteur': return 'Extincteurs';
                                case 'ria': return 'RIA';
                                case 'baes': return 'BAES';
                                case 'alarme': return 'Alarmes';
                                default: return f;
                            }
                        }).join(', ')}
                    </span>` : ''}
            </div>
        </div>
    `;
    
    filteredMaterials.forEach((material, index) => {
        const originalIndex = currentClient.materials.indexOf(material);
        const currentYear = new Date().getFullYear();
        let isVerifiedForCurrentYear = false;
        
        if (material.verified && material.dateVerification) {
            const verificationYear = new Date(material.dateVerification).getFullYear();
            isVerifiedForCurrentYear = verificationYear === currentYear;
        }
        
        if (material.dateVerification) {
            const verificationYear = new Date(material.dateVerification).getFullYear();
            if (verificationYear < currentYear) {
                material.verified = false;
                material.verifiedBy = '';
            }
        }
        
        if (isVerifiedForCurrentYear) verifiedCount++;
        else toVerifyCount++;
        
        let materialClass = '';
        let materialIcon = '';
        let materialTypeText = '';
        let materialDetails = '';
        
        switch(material.type) {
            case 'extincteur':
                materialClass = 'extincteur';
                materialIcon = 'fa-fire-extinguisher';
                materialTypeText = 'Extincteur';
                // Ajouter le type d'extincteur dans les détails
                materialDetails = material.typeExtincteur ? 
                    `${material.typeExtincteur} - ${material.localisation || material.location || 'Non spécifié'}` :
                    `${material.localisation || material.location || 'Non spécifié'}`;
                break;
            case 'ria':
                materialClass = 'ria';
                materialIcon = 'fa-faucet';
                materialTypeText = 'RIA';
                materialDetails = material.localisation || material.location || 'Non spécifié';
                break;
            case 'baes':
                materialClass = 'baes';
                materialIcon = 'fa-lightbulb';
                materialTypeText = 'BAES';
                materialDetails = material.localisation || material.location || 'Non spécifié';
                break;
            case 'alarme':
                materialClass = 'alarme';
                materialIcon = 'fa-bell';
                materialTypeText = 'Alarme';
                materialDetails = material.localisation || material.location || 'Non spécifié';
                break;
        }
        
        let statusBadge = '';
        let verificationYearInfo = '';
        
        if (isVerifiedForCurrentYear) {
            statusBadge = `<span class="status-badge status-ok">
                <i class="fas fa-check-circle"></i> Vérifié ${currentYear}
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
        
        verificationList.innerHTML += `
            <div class="compact-material-item ${materialClass}" id="verif-material-${originalIndex}">
                <div class="compact-material-info">
                    <div class="compact-material-name">
                        <i class="fas ${materialIcon}"></i>
                        ${materialTypeText} - ${material.id || material.numero}
                        ${statusBadge}
                    </div>
                    <div class="compact-material-details">
                        ${materialDetails}
                        ${material.interventionType === 'installation' ? 
                          '<span class="status-badge status-purple"><i class="fas fa-wrench"></i> Installation</span>' : 
                          '<span class="status-badge status-info"><i class="fas fa-clipboard-check"></i> Vérification</span>'}
                        ${verificationYearInfo}
                    </div>
                </div>
                <div class="compact-material-actions">
                    <button class="btn btn-sm" onclick="editMaterialForVerification(${originalIndex})" title="Modifier">
                        <i class="fas fa-edit"></i>
                    </button>
                    ${!isVerifiedForCurrentYear ? `
                        <button class="btn btn-sm btn-success" onclick="verifyMaterial(${originalIndex})" title="Valider la vérification">
                            <i class="fas fa-check"></i>
                        </button>
                    ` : `
                        <button class="btn btn-sm btn-danger" onclick="unverifyMaterial(${originalIndex})" title="Marquer à vérifier">
                            <i class="fas fa-redo"></i>
                        </button>
                    `}
                    <button class="btn btn-sm btn-danger" onclick="removeMaterialFromVerification(${originalIndex})" title="Supprimer">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            </div>
        `;
    });
    
    // Mettre à jour le compteur de matériels
    if (materialsCount) {
        materialsCount.innerHTML = `<i class="fas fa-list"></i> ${currentClient.materials.length} matériel(s)`;
    }
    
    // Mettre à jour le bouton de complétion
    updateCompleteButton(verifiedCount, toVerifyCount, filteredMaterials.length);
}

// Fonction pour basculer un filtre de famille (multi-sélection)
function toggleFamilyFilter(family) {
    if (family === 'all') {
        // Si on clique sur "Tous", on désactive tous les autres filtres
        currentFamilyFilter = ['all'];
    } else {
        // Retirer 'all' si présent
        currentFamilyFilter = currentFamilyFilter.filter(f => f !== 'all');
        
        // Basculer le filtre sélectionné
        const index = currentFamilyFilter.indexOf(family);
        if (index === -1) {
            // Ajouter le filtre
            currentFamilyFilter.push(family);
        } else {
            // Retirer le filtre
            currentFamilyFilter.splice(index, 1);
        }
        
        // Si plus aucun filtre n'est sélectionné, activer "Tous"
        if (currentFamilyFilter.length === 0) {
            currentFamilyFilter = ['all'];
        }
    }
    
    displayVerificationList();
    
    // Mettre à jour les statistiques dans le bouton de complétion
    const filteredMaterials = currentClient.materials.filter(material => {
        if (!currentFamilyFilter.includes('all')) {
            return currentFamilyFilter.includes(material.type);
        }
        return true;
    });
    
    const verifiedCount = filteredMaterials.filter(m => m.verified).length;
    const toVerifyCount = filteredMaterials.length - verifiedCount;
    
    updateCompleteButton(verifiedCount, toVerifyCount, filteredMaterials.length);
}

// Ancienne fonction pour compatibilité (maintenant utilise toggleFamilyFilter)
function setFamilyFilter(family) {
    toggleFamilyFilter(family);
}

function verifyAllInFamily(family) {
    if (!currentClient || !currentClient.materials) {
        showError('Aucun matériel à vérifier');
        return;
    }
    
    // Si "all" est sélectionné, vérifier tous les matériels
    const familyMaterials = currentFamilyFilter.includes('all') ? 
        currentClient.materials : 
        currentClient.materials.filter(m => currentFamilyFilter.includes(m.type));
    
    const currentYear = new Date().getFullYear();
    const notVerifiedMaterials = familyMaterials.filter(m => {
        if (!m.verified) return true;
        if (m.dateVerification) {
            const verificationYear = new Date(material.dateVerification).getFullYear();
            return verificationYear < currentYear;
        }
        return false;
    });
    
    if (notVerifiedMaterials.length === 0) {
        const filterNames = currentFamilyFilter.includes('all') ? 'tous les matériels' : 
            currentFamilyFilter.map(f => {
                switch(f) {
                    case 'extincteur': return 'extincteurs';
                    case 'ria': return 'RIA';
                    case 'baes': return 'BAES';
                    case 'alarme': return 'alarmes';
                    default: return f;
                }
            }).join(', ');
        
        showSuccess(`Tous les ${filterNames} sont déjà vérifiés pour cette année !`);
        return;
    }
    
    const familyNames = currentFamilyFilter.includes('all') ? 'tous les matériels' : 
        currentFamilyFilter.map(f => {
            switch(f) {
                case 'extincteur': return 'extincteurs';
                case 'ria': return 'RIA';
                case 'baes': return 'BAES';
                case 'alarme': return 'alarmes';
                default: return f;
            }
        }).join(', ');
    
    if (!confirm(`Voulez-vous valider ${familyNames} (${notVerifiedMaterials.length}) pour l'année ${currentYear} ?`)) {
        return;
    }
    
    const technicianName = document.getElementById('technician-name').value || 'Technicien';
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

function updateCompleteButton(verifiedCount, toVerifyCount, totalFiltered) {
    const completeBtn = document.getElementById('complete-btn');
    
    if (!completeBtn) return;
    
    if (toVerifyCount === 0 && verifiedCount > 0) {
        completeBtn.disabled = false;
        completeBtn.innerHTML = `<i class="fas fa-check-double"></i> Terminer la vérification (${verifiedCount} vérifié(s))`;
    } else if (toVerifyCount > 0) {
        completeBtn.disabled = true;
        completeBtn.innerHTML = `<i class="fas fa-check-double"></i> Vérifiez tous les matériels d'abord (${toVerifyCount} restant(s))`;
    } else {
        completeBtn.disabled = true;
        completeBtn.innerHTML = `<i class="fas fa-check-double"></i> Aucun matériel à vérifier`;
    }
}

function searchVerification() {
    displayVerificationList();
}

function editMaterialForVerification(index) {
    if (!currentClient || !currentClient.materials || !currentClient.materials[index]) {
        showError("Matériel non trouvé");
        return;
    }
    
    const material = currentClient.materials[index];
    
    switch(material.type) {
        case 'extincteur':
            openEditExtincteurModal(material, index);
            break;
        case 'ria':
            openEditRiaModal(material, index);
            break;
        case 'baes':
            openEditBaesModal(material, index);
            break;
        case 'alarme':
            openEditAlarmeModal(material, index);
            break;
    }
}

function openEditExtincteurModal(material, index) {
    document.getElementById('extincteur-id').value = material.id || '';
    document.getElementById('extincteur-location').value = material.localisation || '';
    document.getElementById('extincteur-type').value = material.typeExtincteur || '';
    document.getElementById('extincteur-fabricant').value = material.fabricant || '';
    document.getElementById('extincteur-modele').value = material.modele || '';
    document.getElementById('extincteur-annee').value = material.annee || '';
    document.getElementById('extincteur-capacite').value = material.capacite || '';
    document.getElementById('extincteur-date-controle').value = material.dateControle || '';
    document.getElementById('extincteur-prochain-controle').value = material.prochainControle || '';
    
    if (material.etatGeneral) selectOkNokValue('etat-general', material.etatGeneral);
    if (material.lisibilite) selectOkNokValue('lisibilite', material.lisibilite);
    if (material.panneau) selectOkNokValue('panneau', material.panneau);
    if (material.goupille) selectOkNokValue('goupille', material.goupille);
    if (material.pression) selectOkNokValue('pression', material.pression);
    if (material.joints) selectOkNokValue('joints', material.joints);
    if (material.accessibilite) selectOkNokValue('accessibilite', material.accessibilite);
    
    document.getElementById('extincteur-pesee').value = material.pesee || '';
    document.getElementById('extincteur-observations').value = material.observations || '';
    document.getElementById('extincteur-etat-general-comment').value = material.etatGeneralComment || '';
    
    if (material.interventions) {
        document.getElementById('extincteur-maa').checked = material.interventions.maa || false;
        document.getElementById('extincteur-eiee').checked = material.interventions.eiee || false;
        document.getElementById('extincteur-recharge').checked = material.interventions.recharge || false;
    }
    
    document.getElementById('extincteur-scelle').checked = material.scelle || false;
    document.getElementById('extincteur-remplacement-joint').checked = material.remplacementJoint || false;
    
    if (material.interventionType) {
        selectExtincteurInterventionType(material.interventionType);
    }
    
    if (material.photos && material.photos.length > 0) {
        const gallery = document.getElementById('extincteur-photo-gallery');
        gallery.innerHTML = '';
        material.photos.forEach((photo, photoIndex) => {
            gallery.innerHTML += `
                <div class="photo-item">
                    <img src="${photo}" alt="Photo ${photoIndex + 1}">
                    <button onclick="removeExtincteurPhoto(${index}, ${photoIndex})">×</button>
                </div>
            `;
        });
    }
    
    currentEditingMaterialIndex = index;
    const modal = document.getElementById('add-extincteur-modal');
    modal.querySelector('.btn-success').onclick = function() {
        updateExtincteurFromModal(index);
    };
    modal.querySelector('.btn-success').innerHTML = '<i class="fas fa-save"></i> Enregistrer les modifications';
    modal.classList.add('active');
    checkExtincteurAge();
}

function openEditRiaModal(material, index) {
    document.getElementById('ria-id').value = material.id || material.numero || '';
    document.getElementById('ria-location').value = material.localisation || '';
    document.getElementById('ria-type').value = material.typeRIA || '';
    document.getElementById('ria-marque').value = material.marque || '';
    document.getElementById('ria-annee').value = material.annee || '';
    document.getElementById('ria-date-verif').value = material.dateVerification || '';
    document.getElementById('ria-date-prochaine').value = material.dateProchaineVerification || '';
    
    if (material.tuyau) selectRIANokValue('tuyau', material.tuyau);
    document.getElementById('ria-devidoir').value = material.devidoir || '';
    if (material.typeDevidoir) {
        document.getElementById(`ria-devidoir-${material.typeDevidoir}`).checked = true;
    }
    if (material.joints) selectRIANokValue('joints', material.joints);
    document.getElementById('ria-pression-statique').value = material.pressionStatique || '';
    document.getElementById('ria-pression-dynamique').value = material.pressionDynamique || '';
    document.getElementById('ria-debit').value = material.debit || '';
    if (material.organes) selectRIANokValue('organes', material.organes);
    if (material.signalisation) selectRIANokValue('signalisation', material.signalisation);
    if (material.visuel) selectRIANokValue('visuel', material.visuel);
    
    document.getElementById('ria-observations').value = material.observations || '';
    
    if (material.interventionType) {
        selectRIAInterventionType(material.interventionType);
    }
    
    if (material.photos && material.photos.length > 0) {
        const gallery = document.getElementById('ria-photo-gallery');
        gallery.innerHTML = '';
        material.photos.forEach((photo, photoIndex) => {
            gallery.innerHTML += `
                <div class="photo-item">
                    <img src="${photo}" alt="Photo ${photoIndex + 1}">
                    <button onclick="removeRiaPhoto(${index}, ${photoIndex})">×</button>
                </div>
            `;
        });
    }
    
    currentEditingMaterialIndex = index;
    const modal = document.getElementById('add-ria-modal');
    modal.querySelector('.btn-success').onclick = function() {
        updateRIAFromModal(index);
    };
    modal.querySelector('.btn-success').innerHTML = '<i class="fas fa-save"></i> Enregistrer les modifications';
    modal.classList.add('active');
}

function openEditBaesModal(material, index) {
    document.getElementById('baes-id').value = material.id || material.numero || '';
    document.getElementById('baes-location').value = material.localisation || '';
    document.getElementById('baes-type').value = material.typeBAES || '';
    document.getElementById('baes-marque').value = material.marque || '';
    document.getElementById('baes-modele').value = material.modele || '';
    document.getElementById('baes-puissance').value = material.puissance || '';
    document.getElementById('baes-date-verif').value = material.dateVerification || '';
    document.getElementById('baes-date-prochaine').value = material.dateProchaineVerification || '';
    
    if (material.visuel) selectBAESNokValue('visuel', material.visuel);
    if (material.typeLampe) {
        document.getElementById(`baes-lampe-${material.typeLampe}`).checked = true;
    }
    if (material.lampe) selectBAESNokValue('lampe', material.lampe);
    if (material.batteries) selectBAESNokValue('batteries', material.batteries);
    if (material.fonctionnement) selectBAESNokValue('fonctionnement', material.fonctionnement);
    if (material.autonomie) selectBAESNokValue('autonomie', material.autonomie);
    if (material.signalisation) selectBAESNokValue('signalisation', material.signalisation);
    if (material.accessibilite) selectBAESNokValue('accessibilite', material.accessibilite);
    
    if (material.tests) {
        document.getElementById('baes-test-autonomie').checked = material.tests.autonomie || false;
        document.getElementById('baes-test-charge').checked = material.tests.charge || false;
        document.getElementById('baes-test-fonction').checked = material.tests.fonction || false;
    }
    
    document.getElementById('baes-observations').value = material.observations || '';
    
    if (material.interventionType) {
        selectBAESInterventionType(material.interventionType);
    }
    
    if (material.photos && material.photos.length > 0) {
        const gallery = document.getElementById('baes-photo-gallery');
        gallery.innerHTML = '';
        material.photos.forEach((photo, photoIndex) => {
            gallery.innerHTML += `
                <div class="photo-item">
                    <img src="${photo}" alt="Photo ${photoIndex + 1}">
                    <button onclick="removeBaesPhoto(${index}, ${photoIndex})">×</button>
                </div>
            `;
        });
    }
    
    currentEditingMaterialIndex = index;
    const modal = document.getElementById('add-baes-modal');
    modal.querySelector('.btn-success').onclick = function() {
        updateBAESFromModal(index);
    };
    modal.querySelector('.btn-success').innerHTML = '<i class="fas fa-save"></i> Enregistrer les modifications';
    modal.classList.add('active');
}

function selectOkNokValue(fieldId, value) {
    const selector = document.querySelector(`[onclick*="${fieldId}"]`);
    if (selector) {
        const options = selector.parentElement.querySelectorAll('.ok-nok-option');
        options.forEach(opt => {
            opt.classList.remove('selected');
            if (opt.textContent.trim().toLowerCase() === value.toLowerCase()) {
                opt.classList.add('selected');
            }
        });
    }
    document.getElementById(`extincteur-${fieldId}`).value = value;
}

function selectRIANokValue(fieldId, value) {
    const selector = document.querySelector(`[onclick*="${fieldId}"]`);
    if (selector) {
        const options = selector.parentElement.querySelectorAll('.ok-nok-option');
        options.forEach(opt => {
            opt.classList.remove('selected');
            if (opt.textContent.trim().toLowerCase() === value.toLowerCase()) {
                opt.classList.add('selected');
            }
        });
    }
    document.getElementById(`ria-${fieldId}`).value = value;
}

function selectBAESNokValue(fieldId, value) {
    const selector = document.querySelector(`[onclick*="${fieldId}"]`);
    if (selector) {
        const options = selector.parentElement.querySelectorAll('.ok-nok-option');
        options.forEach(opt => {
            opt.classList.remove('selected');
            if (opt.textContent.trim().toLowerCase() === value.toLowerCase()) {
                opt.classList.add('selected');
            }
        });
    }
    document.getElementById(`baes-${fieldId}`).value = value;
}

function updateExtincteurFromModal(index) {
    if (!currentClient || !currentClient.materials || !currentClient.materials[index]) {
        showError("Matériel non trouvé");
        return;
    }
    
    const extincteur = {
        type: 'extincteur',
        id: document.getElementById('extincteur-id').value,
        localisation: document.getElementById('extincteur-location').value,
        typeExtincteur: document.getElementById('extincteur-type').value,
        fabricant: document.getElementById('extincteur-fabricant').value,
        modele: document.getElementById('extincteur-modele').value,
        annee: document.getElementById('extincteur-annee').value,
        capacite: document.getElementById('extincteur-capacite').value,
        dateControle: document.getElementById('extincteur-date-controle').value,
        prochainControle: document.getElementById('extincteur-prochain-controle').value,
        etatGeneral: document.getElementById('extincteur-etat-general').value,
        etatGeneralComment: document.getElementById('extincteur-etat-general-comment').value,
        lisibilite: document.getElementById('extincteur-lisibilite').value,
        panneau: document.getElementById('extincteur-panneau').value,
        goupille: document.getElementById('extincteur-goupille').value,
        pression: document.getElementById('extincteur-pression').value,
        pesee: document.getElementById('extincteur-pesee').value,
        joints: document.getElementById('extincteur-joints').value,
        accessibilite: document.getElementById('extincteur-accessibilite').value,
        observations: document.getElementById('extincteur-observations').value,
        scelle: document.getElementById('extincteur-scelle').checked,
        remplacementJoint: document.getElementById('extincteur-remplacement-joint').checked,
        interventionType: document.getElementById('extincteur-intervention-type').value,
        interventions: {
            maa: document.getElementById('extincteur-maa').checked,
            eiee: document.getElementById('extincteur-eiee').checked,
            recharge: document.getElementById('extincteur-recharge').checked
        },
        photos: currentClient.materials[index].photos || [],
        verified: currentClient.materials[index].verified || false,
        dateVerification: currentClient.materials[index].dateVerification || null
    };
    
    if (!extincteur.id || !extincteur.localisation || !extincteur.typeExtincteur) {
        showError("Veuillez remplir tous les champs obligatoires");
        return;
    }
    
    currentClient.materials[index] = extincteur;
    saveCurrentClientChanges();
    closeExtincteurModal();
    displayMaterialsList();
    
    if (currentPage === 'verification') {
        displayVerificationList();
    }
    
    showSuccess("Extincteur modifié avec succès");
}

function updateRIAFromModal(index) {
    if (!currentClient || !currentClient.materials || !currentClient.materials[index]) {
        showError("Matériel non trouvé");
        return;
    }
    
    const ria = {
        type: 'ria',
        id: document.getElementById('ria-id').value,
        localisation: document.getElementById('ria-location').value,
        typeRIA: document.getElementById('ria-type').value,
        marque: document.getElementById('ria-marque').value,
        annee: document.getElementById('ria-annee').value,
        dateVerification: document.getElementById('ria-date-verif').value,
        dateProchaineVerification: document.getElementById('ria-date-prochaine').value,
        tuyau: document.getElementById('ria-tuyau').value,
        devidoir: document.getElementById('ria-devidoir').value,
        typeDevidoir: document.querySelector('input[name="ria-devidoir-type"]:checked')?.value || '',
        joints: document.getElementById('ria-joints').value,
        pressionStatique: document.getElementById('ria-pression-statique').value,
        pressionDynamique: document.getElementById('ria-pression-dynamique').value,
        debit: document.getElementById('ria-debit').value,
        organes: document.getElementById('ria-organes').value,
        signalisation: document.getElementById('ria-signalisation').value,
        visuel: document.getElementById('ria-visuel').value,
        observations: document.getElementById('ria-observations').value,
        interventionType: document.getElementById('ria-intervention-type').value,
        photos: currentClient.materials[index].photos || [],
        verified: currentClient.materials[index].verified || false,
        dateVerification: currentClient.materials[index].dateVerification || null
    };
    
    if (!ria.id || !ria.localisation || !ria.typeRIA) {
        showError("Veuillez remplir tous les champs obligatoires");
        return;
    }
    
    currentClient.materials[index] = ria;
    saveCurrentClientChanges();
    closeRIAModal();
    displayMaterialsList();
    
    if (currentPage === 'verification') {
        displayVerificationList();
    }
    
    showSuccess("RIA modifié avec succès");
}

function updateBAESFromModal(index) {
    if (!currentClient || !currentClient.materials || !currentClient.materials[index]) {
        showError("Matériel non trouvé");
        return;
    }
    
    const baes = {
        type: 'baes',
        id: document.getElementById('baes-id').value,
        localisation: document.getElementById('baes-location').value,
        typeBAES: document.getElementById('baes-type').value,
        marque: document.getElementById('baes-marque').value,
        modele: document.getElementById('baes-modele').value,
        puissance: document.getElementById('baes-puissance').value,
        dateVerification: document.getElementById('baes-date-verif').value,
        dateProchaineVerification: document.getElementById('baes-date-prochaine').value,
        visuel: document.getElementById('baes-visuel').value,
        typeLampe: document.querySelector('input[name="baes-lampe-type"]:checked')?.value || '',
        lampe: document.getElementById('baes-lampe').value,
        batteries: document.getElementById('baes-batteries').value,
        fonctionnement: document.getElementById('baes-fonctionnement').value,
        autonomie: document.getElementById('baes-autonomie').value,
        signalisation: document.getElementById('baes-signalisation').value,
        accessibilite: document.getElementById('baes-accessibilite').value,
        observations: document.getElementById('baes-observations').value,
        interventionType: document.getElementById('baes-intervention-type').value,
        tests: {
            autonomie: document.getElementById('baes-test-autonomie').checked,
            charge: document.getElementById('baes-test-charge').checked,
            fonction: document.getElementById('baes-test-fonction').checked
        },
        photos: currentClient.materials[index].photos || [],
        verified: currentClient.materials[index].verified || false,
        dateVerification: currentClient.materials[index].dateVerification || null
    };
    
    if (!baes.id || !baes.localisation || !baes.typeBAES) {
        showError("Veuillez remplir tous les champs obligatoires");
        return;
    }
    
    currentClient.materials[index] = baes;
    saveCurrentClientChanges();
    closeBAESModal();
    displayMaterialsList();
    
    if (currentPage === 'verification') {
        displayVerificationList();
    }
    
    showSuccess("BAES modifié avec succès");
}

function verifyMaterial(index) {
    if (!currentClient || !currentClient.materials || !currentClient.materials[index]) {
        showError("Matériel non trouvé");
        return;
    }
    
    if (!confirm(`Voulez-vous vraiment valider la vérification de ce matériel pour l'année ${new Date().getFullYear()} ?`)) {
        return;
    }
    
    currentClient.materials[index].verified = true;
    currentClient.materials[index].dateVerification = new Date().toISOString().split('T')[0];
    currentClient.materials[index].verifiedBy = document.getElementById('technician-name').value || 'Technicien';
    
    saveCurrentClientChanges();
    displayVerificationList();
    showSuccess(`Matériel validé pour l'année ${new Date().getFullYear()}`);
}

function unverifyMaterial(index) {
    if (!currentClient || !currentClient.materials || !currentClient.materials[index]) {
        showError("Matériel non trouvé");
        return;
    }
    
    if (!confirm("Voulez-vous re-marquer ce matériel comme 'à vérifier' ?")) {
        return;
    }
    
    currentClient.materials[index].verified = false;
    currentClient.materials[index].dateVerification = null;
    currentClient.materials[index].verifiedBy = '';
    
    saveCurrentClientChanges();
    displayVerificationList();
    showSuccess("Matériel marqué comme 'à vérifier'");
}

function removeMaterialFromVerification(index) {
    if (!currentClient || !currentClient.materials || !currentClient.materials[index]) {
        showError("Matériel non trouvé");
        return;
    }
    
    const material = currentClient.materials[index];
    if (!confirm(`Voulez-vous vraiment supprimer ${material.id || material.numero} de la liste ?`)) {
        return;
    }
    
    currentClient.materials.splice(index, 1);
    saveCurrentClientChanges();
    displayMaterialsList();
    displayVerificationList();
    showSuccess("Matériel supprimé de la liste");
}

function completeVerification() {
    if (!currentClient || !currentClient.materials || currentClient.materials.length === 0) {
        showError("Aucun matériel à vérifier");
        return;
    }
    
    // Filtrer selon les filtres actifs
    let materialsToCheck = currentClient.materials;
    if (!currentFamilyFilter.includes('all')) {
        materialsToCheck = currentClient.materials.filter(m => currentFamilyFilter.includes(m.type));
    }
    
    // Ne prendre que les matériels vérifiés pour le rapport
    const verifiedMaterials = materialsToCheck.filter(m => m.verified);
    
    if (verifiedMaterials.length === 0) {
        showError("Aucun matériel n'a été validé !");
        return;
    }
    
    const filterNames = currentFamilyFilter.includes('all') ? 'tous les matériels' : 
        currentFamilyFilter.map(f => {
            switch(f) {
                case 'extincteur': return 'extincteurs';
                case 'ria': return 'RIA';
                case 'baes': return 'BAES';
                case 'alarme': return 'alarmes';
                default: return f;
            }
        }).join(', ');
    
    showSuccess(`Vérification terminée pour ${filterNames} ! ${verifiedMaterials.length} matériel(s) vérifié(s) pour ${new Date().getFullYear()}. Vous pouvez maintenant passer à la signature.`);
    
    // Réinitialiser le filtre après complétion
    currentFamilyFilter = ['all'];
    navigateTo('signature');
}

function goToVerification() {
    if (!currentClient || !currentClient.materials || currentClient.materials.length === 0) {
        showError("Veuillez d'abord ajouter des matériels au client");
        return;
    }
    
    navigateTo('verification');
}

function resetVerificationsForNewYear() {
    if (!currentClient || !currentClient.materials) return;
    
    const currentYear = new Date().getFullYear();
    
    currentClient.materials.forEach(material => {
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
    const clientCanvas = document.getElementById('client-signature-canvas');
    const technicianCanvas = document.getElementById('technician-signature-canvas');
    
    if (clientCanvas) {
        clientCanvas.width = clientCanvas.offsetWidth;
        clientCanvas.height = clientCanvas.offsetHeight;
        
        clientSignaturePad = new SignaturePad(clientCanvas, {
            backgroundColor: 'white',
            penColor: 'rgb(26, 54, 93)',
            minWidth: 1,
            maxWidth: 3,
            onEnd: function() {
                // Cacher le placeholder quand l'utilisateur commence à signer
                document.getElementById('client-signature-placeholder').style.display = 'none';
            }
        });
        
        // Activer le support tactile
        clientCanvas.addEventListener('touchstart', function(e) {
            e.preventDefault();
        }, { passive: false });
        
        // Réinitialiser les événements pour assurer la compatibilité mobile
        clientCanvas.style.touchAction = 'none';
    }
    
    if (technicianCanvas) {
        technicianCanvas.width = technicianCanvas.offsetWidth;
        technicianCanvas.height = technicianCanvas.offsetHeight;
        
        technicianSignaturePad = new SignaturePad(technicianCanvas, {
            backgroundColor: 'white',
            penColor: 'rgb(26, 54, 93)',
            minWidth: 1,
            maxWidth: 3,
            onEnd: function() {
                // Cacher le placeholder quand l'utilisateur commence à signer
                document.getElementById('technician-signature-placeholder').style.display = 'none';
            }
        });
        
        // Activer le support tactile
        technicianCanvas.addEventListener('touchstart', function(e) {
            e.preventDefault();
        }, { passive: false });
        
        // Réinitialiser les événements pour assurer la compatibilité mobile
        technicianCanvas.style.touchAction = 'none';
    }
    
    // Ajouter un événement pour réinitialiser les canvas si nécessaire
    document.addEventListener('visibilitychange', function() {
        if (!document.hidden) {
            setTimeout(() => {
                if (clientCanvas && clientSignaturePad) {
                    clientCanvas.width = clientCanvas.offsetWidth;
                    clientCanvas.height = clientCanvas.offsetHeight;
                }
                if (technicianCanvas && technicianSignaturePad) {
                    technicianCanvas.width = technicianCanvas.offsetWidth;
                    technicianCanvas.height = technicianCanvas.offsetHeight;
                }
            }, 100);
        }
    });
}

function clearSignature(type) {
    if (type === 'client' && clientSignaturePad) {
        clientSignaturePad.clear();
        document.getElementById('client-signature-placeholder').style.display = 'block';
    } else if (type === 'technician' && technicianSignaturePad) {
        technicianSignaturePad.clear();
        document.getElementById('technician-signature-placeholder').style.display = 'block';
    }
}

function undoSignature(type) {
    if (type === 'client' && clientSignaturePad) {
        const data = clientSignaturePad.toData();
        if (data && data.length > 0) {
            data.pop();
            clientSignaturePad.fromData(data);
            
            // Si plus de données, réafficher le placeholder
            if (data.length === 0) {
                document.getElementById('client-signature-placeholder').style.display = 'block';
            }
        }
    } else if (type === 'technician' && technicianSignaturePad) {
        const data = technicianSignaturePad.toData();
        if (data && data.length > 0) {
            data.pop();
            technicianSignaturePad.fromData(data);
            
            // Si plus de données, réafficher le placeholder
            if (data.length === 0) {
                document.getElementById('technician-signature-placeholder').style.display = 'block';
            }
        }
    }
}

function setSignatureDate() {
    document.getElementById('signature-date').value = new Date().toISOString().split('T')[0];
}

// ==================== FACTURATION ====================
function generateFactureNumber() {
    const date = new Date();
    const year = date.getFullYear().toString().substr(-2);
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const day = date.getDate().toString().padStart(2, '0');
    const random = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
    
    factureNumero = `FACT-${year}${month}${day}-${random}`;
    document.getElementById('facture-numero').value = factureNumero;
}

function toggleFraisDeplacement() {
    const container = document.getElementById('frais-deplacement-container');
    const checkbox = document.getElementById('frais-deplacement');
    
    if (checkbox.checked) {
        container.style.display = 'flex';
        container.style.alignItems = 'center';
        container.style.gap = '0.5rem';
    } else {
        container.style.display = 'none';
        fraisDeplacement = 0;
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
        description: description,
        quantity: quantity,
        price: price,
        total: quantity * price
    };
    
    factureItems.push(item);
    updateFactureItemsList();
    updateFactureTotal();
}

function updateFactureItemsList() {
    const list = document.getElementById('facture-items-list');
    list.innerHTML = '';
    
    factureItems.forEach((item, index) => {
        list.innerHTML += `
            <div class="facture-item">
                <div class="facture-item-desc">${item.description}</div>
                <div class="facture-item-qty">${item.quantity}</div>
                <div class="facture-item-price">${item.price.toFixed(2)} €</div>
                <div class="facture-item-total">${item.total.toFixed(2)} €</div>
                <button class="btn btn-sm btn-danger" onclick="removeFactureItem(${index})">
                    <i class="fas fa-trash"></i>
                </button>
            </div>
        `;
    });
}

function removeFactureItem(index) {
    factureItems.splice(index, 1);
    updateFactureItemsList();
    updateFactureTotal();
}

function updateFactureTotal() {
    let totalHT = factureItems.reduce((sum, item) => sum + item.total, 0);
    
    const deplacementCheckbox = document.getElementById('frais-deplacement');
    if (deplacementCheckbox && deplacementCheckbox.checked) {
        const montantInput = document.getElementById('frais-deplacement-montant');
        if (montantInput) {
            fraisDeplacement = parseFloat(montantInput.value) || 0;
            totalHT += fraisDeplacement;
        }
    }
    
    const tva = totalHT * 0.20;
    const totalTTC = totalHT + tva;
    
    document.getElementById('facture-total-ht').textContent = totalHT.toFixed(2) + ' €';
    document.getElementById('facture-tva').textContent = tva.toFixed(2) + ' €';
    document.getElementById('facture-total-ttc').textContent = totalTTC.toFixed(2) + ' €';
}

// ==================== CALENDRIER ====================
function generateCalendar(month, year) {
    const monthNames = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 
                       'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];
    
    document.getElementById('current-month').textContent = `${monthNames[month]} ${year}`;
    
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const daysInMonth = lastDay.getDate();
    const startingDay = firstDay.getDay() === 0 ? 6 : firstDay.getDay() - 1;
    
    const calendarDays = document.getElementById('calendar-days');
    calendarDays.innerHTML = '';
    
    const prevMonthLastDay = new Date(year, month, 0).getDate();
    for (let i = 0; i < startingDay; i++) {
        const day = prevMonthLastDay - startingDay + i + 1;
        const dayElement = document.createElement('div');
        dayElement.className = 'calendar-day other-month';
        dayElement.innerHTML = `<div class="calendar-day-number">${day}</div>`;
        calendarDays.appendChild(dayElement);
    }
    
    const today = new Date();
    const currentDay = today.getDate();
    const currentMonthToday = today.getMonth();
    const currentYearToday = today.getFullYear();
    
    for (let day = 1; day <= daysInMonth; day++) {
        const dayElement = document.createElement('div');
        dayElement.className = 'calendar-day';
        
        if (day === currentDay && month === currentMonthToday && year === currentYearToday) {
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
        
        dayElement.addEventListener('click', () => {
            document.querySelectorAll('.calendar-day').forEach(d => d.classList.remove('selected'));
            dayElement.classList.add('selected');
            displayEventsForDay(day, month, year);
        });
        
        calendarDays.appendChild(dayElement);
    }
    
    if (month === currentMonthToday && year === currentYearToday) {
        const todayElement = calendarDays.querySelector('.today');
        if (todayElement) {
            todayElement.click();
        }
    }
}

function changeMonth(delta) {
    currentMonth += delta;
    if (currentMonth < 0) {
        currentMonth = 11;
        currentYear--;
    } else if (currentMonth > 11) {
        currentMonth = 0;
        currentYear++;
    }
    generateCalendar(currentMonth, currentYear);
}

function goToToday() {
    const today = new Date();
    currentMonth = today.getMonth();
    currentYear = today.getFullYear();
    generateCalendar(currentMonth, currentYear);
}

function getEventsForDay(day, month, year) {
    return currentInterventions.filter(event => {
        const eventDate = new Date(event.start);
        return eventDate.getDate() === day && 
               eventDate.getMonth() === month && 
               eventDate.getFullYear() === year;
    });
}

function displayEventsForDay(day, month, year) {
    const events = getEventsForDay(day, month, year);
    const container = document.getElementById('calendar-events');
    const buttonContainer = document.getElementById('planning-verif-btn-container');
    
    if (events.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <i class="fas fa-calendar-day"></i>
                <p>Aucune intervention prévue</p>
            </div>
        `;
        buttonContainer.style.display = 'none';
        return;
    }
    
    container.innerHTML = `
        <h3 class="calendar-events-title">Interventions du ${day}/${month + 1}/${year}</h3>
    `;
    
    events.forEach((event, index) => {
        const start = new Date(event.start);
        const end = new Date(event.end);
        
        container.innerHTML += `
            <div class="calendar-event-item" id="event-${event.id}">
                <div class="calendar-event-header">
                    <div>
                        <div class="calendar-event-time">
                            <i class="far fa-clock"></i> ${formatTime(start)} - ${formatTime(end)}
                        </div>
                        <div class="calendar-event-title">
                            ${event.title}
                        </div>
                        <div class="calendar-event-client">
                            <i class="fas fa-user"></i> ${event.clientName || 'Client'}
                        </div>
                    </div>
                    <div class="compact-material-actions">
                        <button class="btn btn-sm" onclick="editIntervention('${event.id}')" title="Modifier">
                            <i class="fas fa-edit"></i>
                        </button>
                        <button class="btn btn-sm btn-danger" onclick="deleteIntervention('${event.id}')" title="Supprimer">
                            <i class="fas fa-trash"></i>
                        </button>
                    </div>
                </div>
                <div class="calendar-event-footer">
                    <span class="status-badge ${event.type === 'verification' ? 'status-ok' : 'status-purple'}">
                        ${event.type === 'verification' ? 'Vérification' : 'Installation'}
                    </span>
                    ${event.technician ? `<span class="status-badge status-technician">
                        <i class="fas fa-user-cog"></i> ${event.technician}
                    </span>` : ''}
                </div>
                ${event.description ? `
                    <div class="calendar-event-desc">
                        ${event.description}
                    </div>
                ` : ''}
            </div>
        `;
    });
    
    buttonContainer.style.display = 'block';
}

// ==================== INTERVENTIONS ====================
function addIntervention() {
    updateInterventionClientList();
    
    const now = new Date();
    const startDate = now.toISOString().slice(0, 16);
    const endDate = new Date(now.getTime() + 2 * 60 * 60 * 1000).toISOString().slice(0, 16);
    
    document.getElementById('intervention-title').value = '';
    document.getElementById('intervention-type').value = 'verification';
    document.getElementById('intervention-start').value = startDate;
    document.getElementById('intervention-end').value = endDate;
    document.getElementById('intervention-technician').value = document.getElementById('technician-name').value || '';
    document.getElementById('intervention-description').value = '';
    
    document.getElementById('add-intervention-modal').classList.add('active');
}

function updateInterventionClientList() {
    const select = document.getElementById('intervention-client');
    select.innerHTML = '<option value="">Sélectionner un client</option>';
    
    clients.forEach(client => {
        const option = document.createElement('option');
        option.value = client.id;
        option.textContent = client.name;
        select.appendChild(option);
    });
}

function updateInterventionColor() {
    const type = document.getElementById('intervention-type').value;
    const color = type === 'verification' ? 'var(--verification-color)' : 'var(--installation-color)';
    document.getElementById('intervention-color').value = color;
}

function editIntervention(interventionId) {
    const intervention = currentInterventions.find(i => i.id === interventionId);
    if (!intervention) {
        showError('Intervention non trouvée');
        return;
    }
    
    document.getElementById('intervention-client').value = intervention.clientId || '';
    document.getElementById('intervention-title').value = intervention.title || '';
    document.getElementById('intervention-type').value = intervention.type || 'verification';
    document.getElementById('intervention-start').value = intervention.start ? 
        new Date(intervention.start).toISOString().slice(0, 16) : '';
    document.getElementById('intervention-end').value = intervention.end ? 
        new Date(intervention.end).toISOString().slice(0, 16) : '';
    document.getElementById('intervention-technician').value = intervention.technician || '';
    document.getElementById('intervention-description').value = intervention.description || '';
    
    currentEditingInterventionId = interventionId;
    
    const modal = document.getElementById('add-intervention-modal');
    const saveButton = modal.querySelector('.btn-success');
    saveButton.innerHTML = '<i class="fas fa-save"></i> Enregistrer les modifications';
    saveButton.onclick = function() { saveEditedIntervention(interventionId); };
    
    modal.classList.add('active');
    updateInterventionColor();
}

function saveEditedIntervention(interventionId) {
    const index = currentInterventions.findIndex(i => i.id === interventionId);
    if (index === -1) {
        showError('Intervention non trouvé');
        return;
    }
    
    const clientId = document.getElementById('intervention-client').value;
    const title = document.getElementById('intervention-title').value;
    const type = document.getElementById('intervention-type').value;
    const start = document.getElementById('intervention-start').value;
    const end = document.getElementById('intervention-end').value;
    const technician = document.getElementById('intervention-technician').value;
    const description = document.getElementById('intervention-description').value;
    const color = document.getElementById('intervention-color').value;
    
    if (!clientId || !title || !type || !start || !end) {
        showError('Veuillez remplir tous les champs obligatoires');
        return;
    }
    
    const client = clients.find(c => c.id === clientId);
    if (!client) {
        showError('Client non trouvé');
        return;
    }
    
    currentInterventions[index] = {
        ...currentInterventions[index],
        clientId: clientId,
        clientName: client.name,
        title: title,
        type: type,
        start: start,
        end: end,
        technician: technician,
        description: description,
        color: color,
        updated: new Date().toISOString()
    };
    
    if (client.interventions) {
        const clientInterventionIndex = client.interventions.findIndex(i => i.id === interventionId);
        if (clientInterventionIndex !== -1) {
            client.interventions[clientInterventionIndex] = currentInterventions[index];
        }
    }
    
    saveInterventions();
    saveClients();
    closeInterventionModal();
    generateCalendar(currentMonth, currentYear);
    showSuccess('Intervention modifiée avec succès');
    currentEditingInterventionId = null;
}

function deleteIntervention(interventionId) {
    if (!confirm('Êtes-vous sûr de vouloir supprimer cette intervention ?')) {
        return;
    }
    
    const intervention = currentInterventions.find(i => i.id === interventionId);
    if (!intervention) {
        showError('Intervention non trouvée');
        return;
    }
    
    currentInterventions = currentInterventions.filter(i => i.id !== interventionId);
    
    const client = clients.find(c => c.id === intervention.clientId);
    if (client && client.interventions) {
        client.interventions = client.interventions.filter(i => i.id !== interventionId);
        saveClients();
    }
    
    saveInterventions();
    generateCalendar(currentMonth, currentYear);
    showSuccess('Intervention supprimée avec succès');
}

function saveIntervention() {
    const clientId = document.getElementById('intervention-client').value;
    const title = document.getElementById('intervention-title').value;
    const type = document.getElementById('intervention-type').value;
    const start = document.getElementById('intervention-start').value;
    const end = document.getElementById('intervention-end').value;
    const technician = document.getElementById('intervention-technician').value;
    const description = document.getElementById('intervention-description').value;
    const color = document.getElementById('intervention-color').value;
    
    if (!clientId || !title || !type || !start || !end) {
        showError('Veuillez remplir tous les champs obligatoires');
        return;
    }
    
    const client = clients.find(c => c.id === clientId);
    if (!client) {
        showError('Client non trouvé');
        return;
    }
    
    const interventionId = currentEditingInterventionId || generateId();
    
    const intervention = {
        id: interventionId,
        clientId: clientId,
        clientName: client.name,
        title: title,
        type: type,
        start: start,
        end: end,
        technician: technician,
        description: description,
        color: color,
        created: new Date().toISOString()
    };
    
    if (currentEditingInterventionId) {
        const index = currentInterventions.findIndex(i => i.id === interventionId);
        if (index !== -1) {
            currentInterventions[index] = intervention;
        }
    } else {
        currentInterventions.push(intervention);
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
    
    saveInterventions();
    saveClients();
    closeInterventionModal();
    generateCalendar(currentMonth, currentYear);
    
    if (currentEditingInterventionId) {
        showSuccess('Intervention modifiée avec succès');
        currentEditingInterventionId = null;
    } else {
        showSuccess('Intervention ajoutée au planning');
    }
    
    resetInterventionForm();
}

function resetInterventionForm() {
    const modal = document.getElementById('add-intervention-modal');
    const saveButton = modal.querySelector('.btn-success');
    saveButton.innerHTML = '<i class="fas fa-save"></i> Enregistrer';
    saveButton.onclick = saveIntervention;
    currentEditingInterventionId = null;
}

function closeInterventionModal() {
    document.getElementById('add-intervention-modal').classList.remove('active');
    resetInterventionForm();
}

function goToVerificationFromPlanning() {
    navigateTo('verification');
}

// ==================== FONCTIONS UTILES ====================
function generateId() {
    return '_' + Math.random().toString(36).substr(2, 9);
}

function formatDate(dateString) {
    const date = new Date(dateString);
    return date.toLocaleDateString('fr-FR');
}

function formatTime(date) {
    return date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

function showSuccess(message) {
    document.getElementById('modal-message').textContent = message;
    document.getElementById('success-modal').classList.add('active');
}

function showError(message) {
    document.getElementById('error-message').textContent = message;
    document.getElementById('error-modal').classList.add('active');
}

function closeSuccessModal() {
    document.getElementById('success-modal').classList.remove('active');
}

function closeErrorModal() {
    document.getElementById('error-modal').classList.remove('active');
}

function setTodayDate() {
    const today = new Date().toISOString().split('T')[0];
    const dateInputs = document.querySelectorAll('input[type="date"]');
    dateInputs.forEach(input => {
        if (!input.value) {
            input.value = today;
        }
    });
}

// ==================== FONCTIONS DE FERMETURE DES MODALS ====================
function closeExtincteurModal() {
    document.getElementById('add-extincteur-modal').classList.remove('active');
    currentEditingMaterialIndex = -1;
}

function closeRIAModal() {
    document.getElementById('add-ria-modal').classList.remove('active');
    currentEditingMaterialIndex = -1;
}

function closeBAESModal() {
    document.getElementById('add-baes-modal').classList.remove('active');
    currentEditingMaterialIndex = -1;
}

function closePreview() {
    document.getElementById('preview-modal').classList.remove('active');
}

function closeFacture() {
    document.getElementById('facture-modal').classList.remove('active');
}

// ==================== FONCTIONS D'INTERACTION DES MODALS ====================
function selectOkNok(element, field) {
    const parent = element.parentElement;
    parent.querySelectorAll('.ok-nok-option').forEach(opt => {
        opt.classList.remove('selected');
    });
    
    element.classList.add('selected');
    const value = element.textContent.trim();
    document.getElementById(`extincteur-${field}`).value = value;
    
    if (field === 'joints' && value === 'Non OK') {
        document.getElementById('remplacement-joint-container').style.display = 'block';
    } else if (field === 'joints') {
        document.getElementById('remplacement-joint-container').style.display = 'none';
    }
}

function selectRIANok(element, field) {
    const parent = element.parentElement;
    parent.querySelectorAll('.ok-nok-option').forEach(opt => {
        opt.classList.remove('selected');
    });
    element.classList.add('selected');
    document.getElementById(`ria-${field}`).value = element.textContent.trim();
}

function selectBAESNok(element, field) {
    const parent = element.parentElement;
    parent.querySelectorAll('.ok-nok-option').forEach(opt => {
        opt.classList.remove('selected');
    });
    element.classList.add('selected');
    document.getElementById(`baes-${field}`).value = element.textContent.trim();
}

function selectExtincteurInterventionType(type) {
    const selector = document.getElementById('extincteur-intervention-type-selector');
    selector.querySelectorAll('.material-type-option').forEach(opt => {
        opt.classList.remove('selected');
    });
    
    const selectedOption = selector.querySelector(`[onclick*="${type}"]`);
    if (selectedOption) {
        selectedOption.classList.add('selected');
    }
    
    document.getElementById('extincteur-intervention-type').value = type;
}

function selectRIAInterventionType(type) {
    const selector = document.getElementById('ria-intervention-type-selector');
    selector.querySelectorAll('.material-type-option').forEach(opt => {
        opt.classList.remove('selected');
    });
    
    const selectedOption = selector.querySelector(`[onclick*="${type}"]`);
    if (selectedOption) {
        selectedOption.classList.add('selected');
    }
    
    document.getElementById('ria-intervention-type').value = type;
}

function selectBAESInterventionType(type) {
    const selector = document.getElementById('baes-intervention-type-selector');
    selector.querySelectorAll('.material-type-option').forEach(opt => {
        opt.classList.remove('selected');
    });
    
    const selectedOption = selector.querySelector(`[onclick*="${type}"]`);
    if (selectedOption) {
        selectedOption.classList.add('selected');
    }
    
    document.getElementById('baes-intervention-type').value = type;
}

function checkExtincteurAge() {
    const annee = document.getElementById('extincteur-annee').value;
    const type = document.getElementById('extincteur-type').value;
    const container = document.getElementById('age-warning-container');
    const warningText = document.getElementById('age-warning-text');
    
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
    const currentCount = currentClient ? (currentClient.materials?.filter(m => m.type === 'extincteur').length || 0) + 1 : 1;
    document.getElementById('extincteur-id').value = `EXT-${currentCount.toString().padStart(3, '0')}`;
}

function addExtincteurPhoto() {
    document.getElementById('extincteur-photo-input').click();
}

function handleExtincteurPhotos(files) {
    const gallery = document.getElementById('extincteur-photo-gallery');
    
    Array.from(files).forEach(file => {
        const reader = new FileReader();
        reader.onload = function(e) {
            gallery.innerHTML += `
                <div class="photo-item">
                    <img src="${e.target.result}" alt="Photo extincteur">
                    <button onclick="this.parentElement.remove()">×</button>
                </div>
            `;
        };
        reader.readAsDataURL(file);
    });
}

function addRiaPhoto() {
    document.getElementById('ria-photo-input').click();
}

function handleRiaPhotos(files) {
    const gallery = document.getElementById('ria-photo-gallery');
    
    Array.from(files).forEach(file => {
        const reader = new FileReader();
        reader.onload = function(e) {
            gallery.innerHTML += `
                <div class="photo-item">
                    <img src="${e.target.result}" alt="Photo RIA">
                    <button onclick="this.parentElement.remove()">×</button>
                </div>
            `;
        };
        reader.readAsDataURL(file);
    });
}

function addBaesPhoto() {
    document.getElementById('baes-photo-input').click();
}

function handleBaesPhotos(files) {
    const gallery = document.getElementById('baes-photo-gallery');
    
    Array.from(files).forEach(file => {
        const reader = new FileReader();
        reader.onload = function(e) {
            gallery.innerHTML += `
                <div class="photo-item">
                    <img src="${e.target.result}" alt="Photo BAES">
                    <button onclick="this.parentElement.remove()">×</button>
                </div>
            `;
        };
        reader.readAsDataURL(file);
    });
}

// ==================== HISTORIQUE ====================
function loadHistory() {
    const historyList = document.getElementById('history-list');
    const searchTerm = document.getElementById('history-search')?.value?.toLowerCase() || '';
    
    const verifiedClients = clients.filter(client => 
        client.verificationCompleted || 
        (client.materials && client.materials.some(m => m.verified))
    );
    
    if (verifiedClients.length === 0) {
        historyList.innerHTML = `
            <div class="empty-state">
                <i class="fas fa-history"></i>
                <p>Aucun historique de vérification</p>
                <p class="empty-state-sub">Les rapports générés apparaîtront ici</p>
            </div>
        `;
        return;
    }
    
    historyList.innerHTML = '';
    
    verifiedClients.forEach(client => {
        const verifiedMaterials = client.materials?.filter(m => m.verified) || [];
        const lastVerification = client.lastVerificationDate || 
                               (verifiedMaterials.length > 0 ? verifiedMaterials[0].dateVerification : null);
        
        historyList.innerHTML += `
            <div class="compact-material-item client-item">
                <div class="compact-material-info">
                    <div class="compact-material-name">
                        <i class="fas fa-user"></i>
                        ${client.name}
                        <span class="status-badge status-ok">
                            ${verifiedMaterials.length} matériel(s) vérifié(s)
                        </span>
                    </div>
                    <div class="compact-material-details">
                        ${client.contact} • ${client.address}
                        <br>
                        <small>Dernière vérification : ${lastVerification ? formatDate(lastVerification) : 'Non spécifiée'}</small>
                    </div>
                </div>
                <div class="compact-material-actions">
                    <button class="btn btn-sm btn-primary" onclick="viewClientHistory('${client.id}')" title="Voir détails">
                        <i class="fas fa-eye"></i>
                    </button>
                </div>
            </div>
        `;
    });
}

function searchHistory() {
    loadHistory();
}

function viewClientHistory(clientId) {
    const client = clients.find(c => c.id === clientId);
    if (client) {
        selectClient(client);
        navigateTo('verification');
    }
}

// ==================== EXPORT ====================
function exportData() {
    const data = {
        clients: clients,
        interventions: currentInterventions,
        exportDate: new Date().toISOString()
    };
    
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    
    const a = document.createElement('a');
    a.href = url;
    a.download = `firecheck_export_${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    
    showSuccess('Données exportées avec succès');
}

// ==================== GENERATION PDF APSAD ====================
async function generatePDFAPSAD() {
    if (!currentClient) {
        showError('Aucun client sélectionné');
        return;
    }
    
    // Ne prendre que les matériels vérifiés pour le rapport
    const verifiedMaterials = currentClient.materials?.filter(m => m.verified) || [];
    
    if (verifiedMaterials.length === 0) {
        showError('Aucun matériel vérifié pour ce client');
        return;
    }
    
    const registreStatus = document.getElementById('registre-securite').value || 'non';
    const registreText = registreStatus === 'oui' ? 'Oui' : 
                        registreStatus === 'non' ? 'Non' : 
                        'Indisponible';
    
    const signatoryName = document.getElementById('signatory-name').value || 'Non spécifié';
    const signatoryFunction = document.getElementById('signatory-function').value || 'Non spécifié';
    const finalComments = document.getElementById('final-comments').value || 'Aucun commentaire';
    
    const clientSignature = clientSignaturePad ? clientSignaturePad.toDataURL() : '';
    const technicianSignature = technicianSignaturePad ? technicianSignaturePad.toDataURL() : '';
    
    showLoading('Génération du PDF APSAD en cours...');
    
    try {
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF({
            orientation: 'portrait',
            unit: 'mm',
            format: 'a4'
        });
        
        doc.setFontSize(20);
        doc.setTextColor(26, 54, 93);
        doc.text('FireCheck Pro', 105, 20, { align: 'center' });
        
        doc.setFontSize(12);
        doc.setTextColor(100, 100, 100);
        doc.text('Rapport de vérification APSAD R4', 105, 28, { align: 'center' });
        
        doc.setDrawColor(26, 54, 93);
        doc.setLineWidth(0.5);
        doc.line(20, 32, 190, 32);
        
        doc.setFontSize(14);
        doc.setTextColor(26, 54, 93);
        doc.text('1. INFORMATIONS CLIENT', 20, 42);
        
        doc.setFontSize(10);
        doc.setTextColor(0, 0, 0);
        
        const clientInfo = [
            `Client : ${currentClient.name}`,
            `Contact : ${currentClient.contact}`,
            `Adresse : ${currentClient.address}`,
            `Téléphone : ${currentClient.phone || 'Non spécifié'}`,
            `Email : ${currentClient.email || 'Non spécifié'}`,
            `Technicien : ${currentClient.technician}`,
            `Date de vérification : ${new Date().toLocaleDateString('fr-FR')}`
        ];
        
        let y = 48;
        clientInfo.forEach(line => {
            doc.text(line, 25, y);
            y += 6;
        });
        
        y += 10;
        doc.setFontSize(14);
        doc.setTextColor(26, 54, 93);
        doc.text('2. RÉSUMÉ DES VÉRIFICATIONS', 20, y);
        
        y += 8;
        doc.setFontSize(10);
        doc.setTextColor(0, 0, 0);
        
        const headers = ['Type', 'ID', 'Localisation', 'Statut', 'Date vérif.'];
        const data = verifiedMaterials.map(material => [
            material.type.toUpperCase(),
            material.id || material.numero || 'N/A',
            material.localisation || material.location || 'N/A',
            material.interventionType === 'installation' ? 'Installation' : 'Vérification',
            material.dateVerification ? formatDate(material.dateVerification) : 'N/A'
        ]);
        
        doc.text('Type', 25, y);
        doc.text('ID', 55, y);
        doc.text('Localisation', 75, y);
        doc.text('Statut', 125, y);
        doc.text('Date vérif.', 155, y);
        
        y += 5;
        doc.setLineWidth(0.0);
        doc.line(0, y, 0, y);
        y += 2;
        
        data.forEach((row, index) => {
            if (y > 270) {
                doc.addPage();
                y = 20;
            }
            
            doc.text(row[0], 25, y);
            doc.text(row[1], 55, y);
            doc.text(row[2].length > 20 ? row[2].substring(0, 20) + '...' : row[2], 75, y);
            doc.text(row[3], 125, y);
            doc.text(row[4], 155, y);
            y += 7;
        });
        
        y += 10;
        if (y > 250) {
            doc.addPage();
            y = 20;
        }
        
        doc.setFontSize(14);
        doc.setTextColor(26, 54, 93);
        doc.text('3. DÉTAILS DES VÉRIFICATIONS PAR MATÉRIEL', 20, y);
        y += 15;
        
        // Filtrer les matériels vérifiés par type
        const extincteurs = verifiedMaterials.filter(m => m.type === 'extincteur');
        const rias = verifiedMaterials.filter(m => m.type === 'ria');
        const baes = verifiedMaterials.filter(m => m.type === 'baes');
        const alarmes = verifiedMaterials.filter(m => m.type === 'alarme');
        
        if (extincteurs.length > 0) {
            doc.setFontSize(12);
            doc.setTextColor(200, 50, 50);
            doc.text('EXTINCTEURS', 20, y);
            y += 7;
            
            extincteurs.forEach((extincteur, index) => {
                if (y > 270) {
                    doc.addPage();
                    y = 20;
                }
                
                doc.setFontSize(10);
                doc.setTextColor(0, 0, 0);
                
                doc.text(`Extincteur ${extincteur.id || extincteur.numero} - ${extincteur.localisation || 'N/A'}`, 25, y);
                y += 5;
                
                const details = [
                    `Type : ${extincteur.typeExtincteur || 'N/A'}`,
                    `Fabricant : ${extincteur.fabricant || 'N/A'}`,
                    `Année : ${extincteur.annee || 'N/A'}`,
                    `Capacité : ${extincteur.capacite || 'N/A'}`,
                    `État général : ${extincteur.etatGeneral || 'N/A'} - ${extincteur.etatGeneralComment || ''}`,
                    `Lisibilité : ${extincteur.lisibilite || 'N/A'}`,
                    `Pression : ${extincteur.pression || 'N/A'}`,
                    `Pesée : ${extincteur.pesee || 'N/A'}`,
                    `Joints : ${extincteur.joints || 'N/A'} ${extincteur.remplacementJoint ? '(Joint remplacé)' : ''}`,
                    `Scellé : ${extincteur.scelle ? 'Oui' : 'Non'}`,
                    `Observations : ${extincteur.observations || 'Aucune'}`
                ];
                
                details.forEach(detail => {
                    if (y > 270) {
                        doc.addPage();
                        y = 20;
                    }
                    doc.text(detail, 30, y);
                    y += 5;
                });
                
                y += 5;
            });
        }
        
        if (rias.length > 0) {
            if (y > 250) {
                doc.addPage();
                y = 20;
            }
            
            doc.setFontSize(12);
            doc.setTextColor(50, 100, 200);
            doc.text('ROBINETS D\'INCENDIE ARMÉS (RIA)', 20, y);
            y += 7;
            
            rias.forEach((ria, index) => {
                if (y > 270) {
                    doc.addPage();
                    y = 20;
                }
                
                doc.setFontSize(10);
                doc.setTextColor(0, 0, 0);
                
                doc.text(`RIA ${ria.id || ria.numero} - ${ria.localisation || 'N/A'}`, 25, y);
                y += 5;
                
                const details = [
                    `Type : ${ria.typeRIA || 'N/A'}`,
                    `Marque : ${ria.marque || 'N/A'}`,
                    `Année : ${ria.annee || 'N/A'}`,
                    `Tuyau : ${ria.tuyau || 'N/A'}`,
                    `Dévidoir : ${ria.devidoir || 'N/A'} (${ria.typeDevidoir || 'N/A'})`,
                    `Pression statique : ${ria.pressionStatique || 'N/A'}`,
                    `Pression dynamique : ${ria.pressionDynamique || 'N/A'}`,
                    `Débit : ${ria.debit || 'N/A'}`,
                    `Observations : ${ria.observations || 'Aucune'}`
                ];
                
                details.forEach(detail => {
                    if (y > 270) {
                        doc.addPage();
                        y = 20;
                    }
                    doc.text(detail, 30, y);
                    y += 5;
                });
                
                y += 5;
            });
        }
        
        if (baes.length > 0) {
            if (y > 250) {
                doc.addPage();
                y = 20;
            }
            
            doc.setFontSize(12);
            doc.setTextColor(150, 100, 200);
            doc.text('BLOCS AUTONOMES D\'ÉCLAIRAGE DE SÉCURITÉ (BAES)', 20, y);
            y += 7;
            
            baes.forEach((baes, index) => {
                if (y > 270) {
                    doc.addPage();
                    y = 20;
                }
                
                doc.setFontSize(10);
                doc.setTextColor(0, 0, 0);
                
                doc.text(`BAES ${baes.id || baes.numero} - ${baes.localisation || 'N/A'}`, 25, y);
                y += 5;
                
                const details = [
                    `Type : ${baes.typeBAES || 'N/A'}`,
                    `Marque/Modèle : ${baes.marque || 'N/A'} ${baes.modele || ''}`,
                    `Puissance : ${baes.puissance || 'N/A'}`,
                    `Lampe : ${baes.lampe || 'N/A'} (${baes.typeLampe || 'N/A'})`,
                    `Batteries : ${baes.batteries || 'N/A'}`,
                    `Fonctionnement : ${baes.fonctionnement || 'N/A'}`,
                    `Autonomie : ${baes.autonomie || 'N/A'}`,
                    `Tests effectués : ${baes.tests?.autonomie ? 'Autonomie ' : ''}${baes.tests?.charge ? 'Charge ' : ''}${baes.tests?.fonction ? 'Fonction ' : ''}`,
                    `Observations : ${baes.observations || 'Aucune'}`
                ];
                
                details.forEach(detail => {
                    if (y > 270) {
                        doc.addPage();
                        y = 20;
                    }
                    doc.text(detail, 30, y);
                    y += 5;
                });
                
                y += 5;
            });
        }
        
        if (alarmes.length > 0) {
            if (y > 250) {
                doc.addPage();
                y = 20;
            }
            
            doc.setFontSize(12);
            doc.setTextColor(220, 150, 50);
            doc.text('ALARMES INCENDIE', 20, y);
            y += 7;
            
            alarmes.forEach((alarme, index) => {
                if (y > 270) {
                    doc.addPage();
                    y = 20;
                }
                
                doc.setFontSize(10);
                doc.setTextColor(0, 0, 0);
                
                doc.text(`Alarme ${alarme.id || alarme.numero} - ${alarme.location || 'N/A'}`, 25, y);
                y += 5;
                
                const details = [
                    `Type d'alarme : ${alarme.alarmeType || 'N/A'}`,
                    `Marque : ${alarme.marque || 'N/A'}`,
                    `Modèle : ${alarme.modele || 'N/A'}`,
                    `Année d'installation : ${alarme.annee || 'N/A'}`,
                    `Date vérification : ${formatDate(alarme.dateVerif)}`,
                    `Prochaine vérification : ${formatDate(alarme.dateProchaine)}`,
                    `Observations : ${alarme.observations || 'Aucune'}`
                ];
                
                details.forEach(detail => {
                    if (y > 270) {
                        doc.addPage();
                        y = 20;
                    }
                    doc.text(detail, 30, y);
                    y += 5;
                });
                
                y += 5;
            });
        }
        
        if (y > 250) {
            doc.addPage();
            y = 20;
        }
        
        doc.setFontSize(14);
        doc.setTextColor(26, 54, 93);
        doc.text('4. REGISTRE DE SÉCURITÉ INCENDIE', 20, y);
        y += 8;
        
        doc.setFontSize(10);
        doc.setTextColor(0, 0, 0);
        doc.text(`Le registre de sécurité incendie a été ${registreStatus === 'oui' ? 'signé' : registreStatus === 'non' ? 'non signé' : 'indisponible'}`, 25, y);
        y += 10;
        
        if (y > 250) {
            doc.addPage();
            y = 20;
        }
        
        doc.setFontSize(14);
        doc.setTextColor(26, 54, 93);
        doc.text('5. COMMENTAIRES ET OBSERVATIONS', 20, y);
        y += 8;
        
        doc.setFontSize(10);
        doc.setTextColor(0, 0, 0);
        
        const comments = finalComments;
        const lines = doc.splitTextToSize(comments, 150);
        lines.forEach(line => {
            if (y > 270) {
                doc.addPage();
                y = 20;
            }
            doc.text(line, 25, y);
            y += 5;
        });
        
        if (y > 220) {
            doc.addPage();
            y = 20;
        }
        
        doc.setFontSize(14);
        doc.setTextColor(26, 54, 93);
        doc.text('6. SIGNATURES', 20, y);
        y += 15;
        
        doc.setFontSize(10);
        doc.setTextColor(0, 0, 0);
        doc.text('CLIENT', 25, y);
        y += 5;
        doc.text(`Nom : ${signatoryName}`, 30, y);
        y += 5;
        doc.text(`Fonction : ${signatoryFunction}`, 30, y);
        y += 10;
        doc.line(30, y, 90, y);
        y += 5;
        doc.text('Signature', 60, y, { align: 'center' });
        
        if (clientSignature) {
            try {
                const img = new Image();
                img.src = clientSignature;
                await new Promise(resolve => {
                    img.onload = resolve;
                    setTimeout(resolve, 1000);
                });
                
                const signatureWidth = 60;
                const signatureHeight = 20;
                doc.addImage(img, 'PNG', 30, y - 25, signatureWidth, signatureHeight);
            } catch (e) {
                console.log('Erreur signature client:', e);
            }
        }
        
        y += 40;
        doc.text('TECHNICIEN', 25, y);
        y += 5;
        doc.text(`Nom : ${currentClient.technician}`, 30, y);
        y += 5;
        doc.text(`Entreprise : FireCheck Pro`, 30, y);
        y += 10;
        doc.line(30, y, 90, y);
        y += 5;
        doc.text('Signature', 60, y, { align: 'center' });
        
        if (technicianSignature) {
            try {
                const img = new Image();
                img.src = technicianSignature;
                await new Promise(resolve => {
                    img.onload = resolve;
                    setTimeout(resolve, 1000);
                });
                
                const signatureWidth = 60;
                const signatureHeight = 20;
                doc.addImage(img, 'PNG', 30, y - 25, signatureWidth, signatureHeight);
            } catch (e) {
                console.log('Erreur signature technicien:', e);
            }
        }
        
        // Ajouter un pied de page avec le nombre de matériels vérifiés
        const pageCount = doc.internal.getNumberOfPages();
        for (let i = 1; i <= pageCount; i++) {
            doc.setPage(i);
            doc.setFontSize(8);
            doc.setTextColor(100, 100, 100);
            doc.text(`Page ${i} / ${pageCount}`, 105, 287, { align: 'center' });
            doc.text(`FireCheck Pro - Rapport APSAD R4 - ${new Date().toLocaleDateString('fr-FR')}`, 105, 290, { align: 'center' });
        }
        
        // Ajouter une note sur la dernière page
        doc.setPage(pageCount);
        doc.setFontSize(9);
        doc.setTextColor(80, 80, 80);
        doc.text(`Total des matériels vérifiés : ${verifiedMaterials.length}`, 20, 275);
        
        const fileName = `Rapport_APSAD_${currentClient.name.replace(/\s+/g, '_')}_${new Date().toISOString().split('T')[0]}.pdf`;
        doc.save(fileName);
        
        closeLoading();
        showSuccess(`PDF APSAD généré avec succès : ${fileName} (${verifiedMaterials.length} matériel(s) vérifié(s))`);
        
    } catch (error) {
        closeLoading();
        console.error('Erreur lors de la génération du PDF:', error);
        showError('Erreur lors de la génération du PDF. Vérifiez la console pour plus de détails.');
    }
}

function showLoading(message) {
    const loadingDiv = document.createElement('div');
    loadingDiv.id = 'loading-modal';
    loadingDiv.innerHTML = `
        <div class="modal-backdrop active" style="z-index: 9999;">
            <div class="modal-content" style="max-width: 300px; text-align: center;">
                <div class="modal-header">
                    <h3>Génération PDF</h3>
                </div>
                <div class="modal-body">
                    <div class="spinner">⏳</div>
                    <p>${message}</p>
                    <p class="loading-sub">Cela peut prendre quelques secondes...</p>
                </div>
            </div>
        </div>
    `;
    document.body.appendChild(loadingDiv);
}

function closeLoading() {
    const loadingDiv = document.getElementById('loading-modal');
    if (loadingDiv) {
        loadingDiv.remove();
    }
}

// ==================== PREVIEW ET PDF ====================
function previewReport() {
    if (!currentClient) {
        showError('Aucun client sélectionné');
        return;
    }
    
    // Ne prendre que les matériels vérifiés pour le rapport
    const verifiedMaterials = currentClient.materials?.filter(m => m.verified) || [];
    
    if (verifiedMaterials.length === 0) {
        showError('Aucun matériel vérifié pour ce client');
        return;
    }
    
    const clientSignature = clientSignaturePad ? clientSignaturePad.toDataURL() : '';
    const technicianSignature = technicianSignaturePad ? technicianSignaturePad.toDataURL() : '';
    
    const previewContent = document.getElementById('preview-content');
    
    previewContent.innerHTML = `
        <div class="preview-logo">
            <h1>FireCheck Pro</h1>
            <div class="subtitle">Rapport de vérification APSAD R4</div>
            <div class="preview-info">
                <span><i class="fas fa-clipboard-check"></i> ${verifiedMaterials.length} matériel(s) vérifié(s)</span>
            </div>
        </div>
        
        <div class="preview-section">
            <h2>Informations client</h2>
            <table class="preview-table">
                <tr>
                    <td><strong>Client :</strong></td>
                    <td>${currentClient.name}</td>
                </tr>
                <tr>
                    <td><strong>Contact :</strong></td>
                    <td>${currentClient.contact}</td>
                </tr>
                <tr>
                    <td><strong>Adresse :</strong></td>
                    <td>${currentClient.address}</td>
                </tr>
                <tr>
                    <td><strong>Technicien :</strong></td>
                    <td>${currentClient.technician}</td>
                </tr>
                <tr>
                    <td><strong>Date de vérification :</strong></td>
                    <td>${new Date().toLocaleDateString('fr-FR')}</td>
                </tr>
            </table>
        </div>
        
        <div class="preview-section">
            <h2>Résumé des vérifications</h2>
            <table class="preview-table">
                <thead>
                    <tr>
                        <th>Type</th>
                        <th>ID</th>
                        <th>Localisation</th>
                        <th>Statut</th>
                        <th>Date vérif.</th>
                    </tr>
                </thead>
                <tbody>
                    ${verifiedMaterials.map(material => `
                        <tr>
                            <td>${material.type.toUpperCase()}</td>
                            <td>${material.id || material.numero}</td>
                            <td>${material.localisation || material.location}</td>
                            <td>${material.interventionType === 'installation' ? 'Installation' : 'Vérification'}</td>
                            <td>${material.dateVerification ? formatDate(material.dateVerification) : 'N/A'}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>
        
        <div class="preview-section">
            <h2>Signatures</h2>
            <div class="signature-preview">
                <div class="signature-container">
                    ${clientSignature ? `
                        <div class="signature-box">
                            <div><strong>Client :</strong></div>
                            <div>${document.getElementById('signatory-name').value || 'Non spécifié'}</div>
                            <div>${document.getElementById('signatory-function').value || 'Non spécifié'}</div>
                            <div class="signature-line"></div>
                            <img src="${clientSignature}" class="signature-image" alt="Signature client">
                        </div>
                    ` : ''}
                    
                    ${technicianSignature ? `
                        <div class="signature-box">
                            <div><strong>Technicien :</strong></div>
                            <div>${currentClient.technician}</td>
                            <div class="signature-line"></div>
                            <img src="${technicianSignature}" class="signature-image" alt="Signature technicien">
                        </div>
                    ` : ''}
                </div>
            </div>
        </div>
        
        <div class="preview-section">
            <h2>Commentaires</h2>
            <p>${document.getElementById('final-comments').value || 'Aucun commentaire'}</p>
        </div>
    `;
    
    document.getElementById('preview-modal').classList.add('active');
}

function generatePDF() {
    generatePDFAPSAD();
}

function printPreview() {
    window.print();
}

function previewFacture() {
    if (!currentClient) {
        showError('Aucun client sélectionné');
        return;
    }
    
    const factureContent = document.getElementById('facture-content');
    
    const totalHT = factureItems.reduce((sum, item) => sum + item.total, 0) + fraisDeplacement;
    const tva = totalHT * 0.20;
    const totalTTC = totalHT + tva;
    
    factureContent.innerHTML = `
        <div class="facture-header">
            <div class="facture-info">
                <h1>Facture</h1>
                <p><strong>Numéro :</strong> ${factureNumero}</p>
                <p><strong>Date :</strong> ${document.getElementById('facture-date').value || new Date().toLocaleDateString('fr-FR')}</p>
            </div>
            
            <div class="facture-info facture-company">
                <h3>FireCheck Pro</h3>
                <p>Service vérification incendie</p>
            </div>
        </div>
        
        <div class="facture-client">
            <h3>Client</h3>
            <p><strong>${currentClient.name}</strong></p>
            <p>${currentClient.contact}</p>
            <p>${currentClient.address}</p>
        </div>
        
        ${document.getElementById('facture-description').value ? `
            <div class="facture-description">
                <h3>Description des travaux</h3>
                <p>${document.getElementById('facture-description').value}</p>
            </div>
        ` : ''}
        
        <div class="facture-details">
            <h3>Détail de la facture</h3>
            <table class="preview-table">
                <thead>
                    <tr>
                        <th>Description</th>
                        <th>Quantité</th>
                        <th>Prix unitaire HT</th>
                        <th>Total HT</th>
                    </tr>
                </thead>
                <tbody>
                    ${factureItems.map(item => `
                        <tr>
                            <td>${item.description}</td>
                            <td>${item.quantity}</td>
                            <td>${item.price.toFixed(2)} €</td>
                            <td>${item.total.toFixed(2)} €</td>
                        </tr>
                    `).join('')}
                    
                    ${fraisDeplacement > 0 ? `
                        <tr>
                            <td>Frais de déplacement</td>
                            <td>1</td>
                            <td>${fraisDeplacement.toFixed(2)} €</td>
                            <td>${fraisDeplacement.toFixed(2)} €</td>
                        </tr>
                    ` : ''}
                </tbody>
            </table>
        </div>
        
        <div class="facture-totaux">
            <div class="facture-ligne">
                <span>Total HT :</span>
                <span>${totalHT.toFixed(2)} €</span>
            </div>
            <div class="facture-ligne">
                <span>TVA (20%) :</span>
                <span>${tva.toFixed(2)} €</span>
            </div>
            <div class="facture-ligne facture-ligne-total">
                <span>Total TTC :</span>
                <span>${totalTTC.toFixed(2)} €</span>
            </div>
        </div>
        
        <div class="facture-footer">
            <p><strong>Conditions de paiement :</strong> Paiement à 30 jours</p>
            <p><strong>IBAN :</strong> FR76 XXXX XXXX XXXX XXXX XXXX XXX</p>
            <p class="facture-thanks">Merci pour votre confiance.</p>
        </div>
    `;
    
    document.getElementById('facture-modal').classList.add('active');
}

function generateFacturePDF() {
    showSuccess('Génération PDF de la facture en cours de développement...');
}

// ==================== REGISTRE DE SECURITE ====================
function selectRegistreSecurite(element, value) {
    const parent = element.parentElement;
    parent.querySelectorAll('.ok-nok-option').forEach(opt => {
        opt.classList.remove('selected');
    });
    element.classList.add('selected');
    document.getElementById('registre-securite').value = value;
    
    const status = document.getElementById('registre-securite-status');
    status.style.color = 'var(--success)';
    status.innerHTML = `<i class="fas fa-check-circle"></i> ${value === 'oui' ? 'Registre signé' : value === 'non' ? 'Registre non signé' : 'Registre indisponible'}`;
}

// ============================================
// FONCTIONS POUR ALARME INCENDIE
// ============================================

// Ouvrir le modal d'ajout d'alarme
function openAddAlarmeModal() {
    if (!currentClient) {
        showError("Veuillez d'abord sélectionner un client");
        return;
    }
    
    resetAlarmeForm();
    document.getElementById('add-alarme-modal').classList.add('active');
}

// Fermer le modal d'alarme
function closeAlarmeModal() {
    document.getElementById('add-alarme-modal').classList.remove('active');
}

// Réinitialiser le formulaire d'alarme
function resetAlarmeForm() {
    // Réinitialiser les champs
    document.getElementById('alarme-id').value = generateAlarmeId();
    document.getElementById('alarme-location').value = '';
    document.getElementById('alarme-type').value = '';
    document.getElementById('alarme-marque').value = '';
    document.getElementById('alarme-modele').value = '';
    document.getElementById('alarme-annee').value = new Date().getFullYear();
    
    const today = new Date().toISOString().split('T')[0];
    document.getElementById('alarme-date-verif').value = today;
    
    // Date de prochaine vérification (dans 1 an)
    const nextYear = new Date();
    nextYear.setFullYear(nextYear.getFullYear() + 1);
    document.getElementById('alarme-date-prochaine').value = nextYear.toISOString().split('T')[0];
    
    // Réinitialiser les options OK/NOK
    resetAlarmeVerificationFields();
    
    // Réinitialiser les photos
    currentAlarmePhotos = [];
    updateAlarmePhotoGallery();
    
    // Réinitialiser les observations
    document.getElementById('alarme-observations').value = '';
    
    // Réinitialiser le type d'intervention
    selectAlarmeInterventionType('verification');
}

// Générer un ID pour l'alarme
function generateAlarmeId() {
    const count = materials.filter(m => m.type === 'alarme').length + 1;
    return `AL-${count.toString().padStart(3, '0')}`;
}

// Sélectionner le type d'intervention pour alarme
function selectAlarmeInterventionType(type) {
    const options = document.querySelectorAll('#alarme-intervention-type-selector .material-type-option');
    options.forEach(option => option.classList.remove('selected'));
    
    if (type === 'verification') {
        options[0].classList.add('selected');
        // Afficher la section vérification
        document.getElementById('alarme-verification-section').style.display = 'block';
    } else {
        options[1].classList.add('selected');
        // Cacher la section vérification pour installation
        document.getElementById('alarme-verification-section').style.display = 'none';
    }
    
    document.getElementById('alarme-intervention-type').value = type;
}

// Gérer les sélections OK/NOK pour l'alarme
function selectAlarmeNok(element, field) {
    const parent = element.parentElement;
    const options = parent.querySelectorAll('.ok-nok-option');
    options.forEach(opt => opt.classList.remove('selected'));
    element.classList.add('selected');
    
    // Déterminer la valeur
    let value = '';
    if (element.classList.contains('ok')) value = 'ok';
    else if (element.classList.contains('nok')) value = 'nok';
    else if (element.classList.contains('nc')) value = 'nc';
    
    // Mettre à jour le champ caché correspondant
    document.getElementById(`alarme-${field}`).value = value;
    
    // Logique spécifique pour certains champs
    if (field === 'detecteurs' && value === 'nok') {
        // Ajouter une logique si nécessaire
    }
}

// Réinitialiser les champs de vérification de l'alarme
function resetAlarmeVerificationFields() {
    // Réinitialiser tous les sélecteurs OK/NOK
    const selectors = document.querySelectorAll('#alarme-verification-section .ok-nok-selector');
    selectors.forEach(selector => {
        const options = selector.querySelectorAll('.ok-nok-option');
        options.forEach(opt => opt.classList.remove('selected'));
    });
    
    // Réinitialiser tous les champs cachés
    const fields = ['etat-general', 'detecteurs', 'sirenes', 'panneau', 'alimentation', 'batteries', 'test-complet', 'signalisation', 'journalisation'];
    fields.forEach(field => {
        document.getElementById(`alarme-${field}`).value = '';
    });
    
    // Réinitialiser les cases à cocher
    document.getElementById('alarme-test-detecteurs').checked = false;
    document.getElementById('alarme-test-sirenes').checked = false;
    document.getElementById('alarme-test-flashs').checked = false;
    document.getElementById('alarme-test-batteries').checked = false;
    
    // Réinitialiser les commentaires
    document.getElementById('alarme-etat-general-comment').value = '';
}

// Ajouter une photo pour l'alarme
function addAlarmePhoto() {
    document.getElementById('alarme-photo-input').click();
}

// Gérer le téléchargement de photos pour l'alarme
function handleAlarmePhotos(files) {
    if (!files || files.length === 0) return;
    
    for (let i = 0; i < files.length; i++) {
        const file = files[i];
        if (!file.type.startsWith('image/')) continue;
        
        const reader = new FileReader();
        reader.onload = function(e) {
            currentAlarmePhotos.push({
                data: e.target.result,
                name: file.name,
                type: file.type,
                timestamp: new Date().toISOString()
            });
            updateAlarmePhotoGallery();
        };
        reader.readAsDataURL(file);
    }
    
    // Réinitialiser l'input file
    document.getElementById('alarme-photo-input').value = '';
}

// Mettre à jour la galerie de photos de l'alarme
function updateAlarmePhotoGallery() {
    const gallery = document.getElementById('alarme-photo-gallery');
    gallery.innerHTML = '';
    
    if (currentAlarmePhotos.length === 0) {
        gallery.innerHTML = '<div style="text-align: center; color: var(--text-secondary); padding: 1rem;">Aucune photo</div>';
        return;
    }
    
    currentAlarmePhotos.forEach((photo, index) => {
        const photoItem = document.createElement('div');
        photoItem.className = 'photo-item';
        photoItem.innerHTML = `
            <img src="${photo.data}" alt="Photo ${index + 1}">
            <button type="button" onclick="removeAlarmePhoto(${index})">
                <i class="fas fa-times"></i>
            </button>
        `;
        gallery.appendChild(photoItem);
    });
}

// Supprimer une photo de l'alarme
function removeAlarmePhoto(index) {
    currentAlarmePhotos.splice(index, 1);
    updateAlarmePhotoGallery();
}

// Ajouter une alarme à la liste des matériels
function addAlarmeToList() {
    // Validation des champs obligatoires
    if (!validateAlarmeForm()) {
        return;
    }
    
    // Récupérer les valeurs du formulaire
    const alarmeData = {
        type: 'alarme',
        id: document.getElementById('alarme-id').value.trim(),
        location: document.getElementById('alarme-location').value.trim(),
        alarmeType: document.getElementById('alarme-type').value,
        marque: document.getElementById('alarme-marque').value,
        modele: document.getElementById('alarme-modele').value.trim(),
        annee: document.getElementById('alarme-annee').value,
        dateVerif: document.getElementById('alarme-date-verif').value,
        dateProchaine: document.getElementById('alarme-date-prochaine').value,
        interventionType: document.getElementById('alarme-intervention-type').value,
        observations: document.getElementById('alarme-observations').value.trim(),
        photos: [...currentAlarmePhotos],
        status: 'pending',
        addedDate: new Date().toISOString()
    };
    
    // Ajouter les données de vérification si c'est une vérification
    if (alarmeData.interventionType === 'verification') {
        alarmeData.verification = getAlarmeVerificationData();
    }
    
    // Ajouter l'alarme à la liste des matériels
    addMaterial(alarmeData);
    
    // Fermer le modal et réinitialiser
    closeAlarmeModal();
    showSuccess('Alarme incendie ajoutée avec succès');
    
    // Mettre à jour la liste des matériels
    updateMaterialsList();
    updateMaterialsCount();
}

// Récupérer les données de vérification de l'alarme
function getAlarmeVerificationData() {
    return {
        etatGeneral: {
            value: document.getElementById('alarme-etat-general').value,
            comment: document.getElementById('alarme-etat-general-comment').value.trim()
        },
        detecteurs: document.getElementById('alarme-detecteurs').value,
        sirenes: document.getElementById('alarme-sirenes').value,
        panneau: document.getElementById('alarme-panneau').value,
        alimentation: document.getElementById('alarme-alimentation').value,
        batteries: document.getElementById('alarme-batteries').value,
        testComplet: document.getElementById('alarme-test-complet').value,
        signalisation: document.getElementById('alarme-signalisation').value,
        journalisation: document.getElementById('alarme-journalisation').value,
        testsEffectues: {
            detecteurs: document.getElementById('alarme-test-detecteurs').checked,
            sirenes: document.getElementById('alarme-test-sirenes').checked,
            flashs: document.getElementById('alarme-test-flashs').checked,
            batteries: document.getElementById('alarme-test-batteries').checked
        }
    };
}

// Valider le formulaire d'alarme
function validateAlarmeForm() {
    // Champs obligatoires de base
    const requiredFields = [
        { id: 'alarme-id', name: 'Numéro d\'identification' },
        { id: 'alarme-location', name: 'Localisation' },
        { id: 'alarme-type', name: 'Type d\'alarme' },
        { id: 'alarme-marque', name: 'Marque' },
        { id: 'alarme-date-verif', name: 'Date de vérification' },
        { id: 'alarme-date-prochaine', name: 'Date de prochaine vérification' }
    ];
    
    for (const field of requiredFields) {
        const element = document.getElementById(field.id);
        if (!element.value.trim()) {
            showError(`Le champ "${field.name}" est obligatoire`);
            element.focus();
            return false;
        }
    }
    
    // Validation spécifique pour l'année
    const annee = parseInt(document.getElementById('alarme-annee').value);
    if (annee && (annee < 2000 || annee > 2030)) {
        showError("L'année doit être comprise entre 2000 et 2030");
        document.getElementById('alarme-annee').focus();
        return false;
    }
    
    // Validation des champs de vérification si c'est une vérification
    if (document.getElementById('alarme-intervention-type').value === 'verification') {
        const verificationFields = [
            'etat-general', 'detecteurs', 'sirenes', 'panneau', 
            'alimentation', 'batteries', 'test-complet', 'signalisation', 'journalisation'
        ];
        
        for (const field of verificationFields) {
            const value = document.getElementById(`alarme-${field}`).value;
            if (!value) {
                showError(`Veuillez sélectionner une option pour "${getAlarmeFieldName(field)}"`);
                // Trouver et mettre en surbrillance le sélecteur correspondant
                const selector = document.querySelector(`[onclick*="${field}"]`).parentElement;
                selector.scrollIntoView({ behavior: 'smooth', block: 'center' });
                return false;
            }
        }
    }
    
    return true;
}

// Obtenir le nom d'un champ d'alarme pour l'affichage
function getAlarmeFieldName(fieldId) {
    const fieldNames = {
        'etat-general': 'État général',
        'detecteurs': 'Détecteurs',
        'sirenes': 'Sirènes et flashs',
        'panneau': 'Panneau de contrôle',
        'alimentation': 'Alimentation',
        'batteries': 'Batteries de secours',
        'test-complet': 'Test complet du système',
        'signalisation': 'Signalisation',
        'journalisation': 'Journalisation des événements'
    };
    
    return fieldNames[fieldId] || fieldId;
}

// ============================================
// FONCTIONS POUR L'AFFICHAGE DES ALARMES
// ============================================

// Afficher les détails d'une alarme
function displayAlarmeDetails(material) {
    let html = `
        <div class="material-details-container">
            <div class="detail-row">
                <div class="detail-label">Type d'intervention:</div>
                <div class="detail-value">${material.interventionType === 'verification' ? 'Vérification' : 'Installation'}</div>
            </div>
            <div class="detail-row">
                <div class="detail-label">ID:</div>
                <div class="detail-value">${material.id}</div>
            </div>
            <div class="detail-row">
                <div class="detail-label">Localisation:</div>
                <div class="detail-value">${material.location}</div>
            </div>
            <div class="detail-row">
                <div class="detail-label">Type d'alarme:</div>
                <div class="detail-value">${material.alarmeType}</div>
            </div>
            <div class="detail-row">
                <div class="detail-label">Marque:</div>
                <div class="detail-value">${material.marque}</div>
            </div>
    `;
    
    if (material.modele) {
        html += `
            <div class="detail-row">
                <div class="detail-label">Modèle:</div>
                <div class="detail-value">${material.modele}</div>
            </div>
        `;
    }
    
    if (material.annee) {
        html += `
            <div class="detail-row">
                <div class="detail-label">Année d'installation:</div>
                <div class="detail-value">${material.annee}</div>
            </div>
        `;
    }
    
    html += `
            <div class="detail-row">
                <div class="detail-label">Date vérification:</div>
                <div class="detail-value">${formatDate(material.dateVerif)}</div>
            </div>
            <div class="detail-row">
                <div class="detail-label">Prochaine vérification:</div>
                <div class="detail-value">${formatDate(material.dateProchaine)}</div>
            </div>
    `;
    
    // Afficher les données de vérification si elles existent
    if (material.verification) {
        html += `
            <div style="margin-top: 1rem; padding-top: 1rem; border-top: 1px solid var(--border-color);">
                <div style="font-weight: bold; color: var(--primary); margin-bottom: 0.5rem;">Vérification technique:</div>
        `;
        
        const verification = material.verification;
        
        // État général
        if (verification.etatGeneral) {
            html += `
                <div class="detail-row">
                    <div class="detail-label">État général:</div>
                    <div class="detail-value">
                        ${getStatusBadge(verification.etatGeneral.value)}
                        ${verification.etatGeneral.comment ? `<div style="margin-top: 0.25rem; font-size: 0.85rem;">${verification.etatGeneral.comment}</div>` : ''}
                    </div>
                </div>
            `;
        }
        
        // Champs de vérification
        const verificationFields = [
            { key: 'detecteurs', label: 'Détecteurs' },
            { key: 'sirenes', label: 'Sirènes et flashs' },
            { key: 'panneau', label: 'Panneau de contrôle' },
            { key: 'alimentation', label: 'Alimentation' },
            { key: 'batteries', label: 'Batteries de secours' },
            { key: 'testComplet', label: 'Test complet' },
            { key: 'signalisation', label: 'Signalisation' },
            { key: 'journalisation', label: 'Journalisation' }
        ];
        
        verificationFields.forEach(field => {
            if (verification[field.key]) {
                html += `
                    <div class="detail-row">
                        <div class="detail-label">${field.label}:</div>
                        <div class="detail-value">${getStatusBadge(verification[field.key])}</div>
                    </div>
                `;
            }
        });
        
        // Tests effectués
        if (verification.testsEffectues) {
            const tests = [];
            if (verification.testsEffectues.detecteurs) tests.push('Détecteurs');
            if (verification.testsEffectues.sirenes) tests.push('Sirènes');
            if (verification.testsEffectues.flashs) tests.push('Flashs');
            if (verification.testsEffectues.batteries) tests.push('Batteries');
            
            if (tests.length > 0) {
                html += `
                    <div class="detail-row">
                        <div class="detail-label">Tests effectués:</div>
                        <div class="detail-value">${tests.join(', ')}</div>
                    </div>
                `;
            }
        }
        
        html += `</div>`;
    }
    
    // Observations
    if (material.observations) {
        html += `
            <div class="detail-row">
                <div class="detail-label">Observations:</div>
                <div class="detail-value">${material.observations}</div>
            </div>
        `;
    }
    
    // Photos
    if (material.photos && material.photos.length > 0) {
        html += `
            <div class="detail-row">
                <div class="detail-label">Photos:</div>
                <div class="detail-value">
                    <div style="display: flex; flex-wrap: wrap; gap: 0.5rem; margin-top: 0.5rem;">
                        ${material.photos.map((photo, index) => `
                            <div style="width: 80px; height: 80px; border-radius: 4px; overflow: hidden; border: 1px solid var(--border-color);">
                                <img src="${photo.data}" alt="Photo ${index + 1}" style="width: 100%; height: 100%; object-fit: cover;">
                            </div>
                        `).join('')}
                    </div>
                </div>
            </div>
        `;
    }
    
    html += `</div>`;
    return html;
}

// Obtenir un badge de statut pour l'affichage
function getStatusBadge(status) {
    const badges = {
        'ok': '<span class="status-badge status-ok">OK</span>',
        'nok': '<span class="status-badge status-danger">Non OK</span>',
        'nc': '<span class="status-badge status-warning">NC</span>'
    };
    return badges[status] || status;
}

// Afficher une alarme dans la liste de vérification
function displayAlarmeInVerification(material, index) {
    let statusBadge = '';
    if (material.status === 'verified') {
        statusBadge = '<span class="status-badge status-ok" style="margin-left: auto;"><i class="fas fa-check"></i> Vérifié</span>';
    } else if (material.status === 'issues') {
        statusBadge = '<span class="status-badge status-danger" style="margin-left: auto;"><i class="fas fa-exclamation-triangle"></i> Problèmes</span>';
    }
    
    return `
        <div class="compact-material-item alarme" onclick="toggleMaterialDetails(${index})">
            <div class="compact-material-info">
                <div class="compact-material-name">
                    ${material.id} - ${material.alarmeType}
                </div>
                <div class="compact-material-details">
                    <div><i class="fas fa-map-marker-alt"></i> ${material.location}</div>
                    <div><i class="fas fa-calendar-alt"></i> Vérifié le: ${formatDate(material.dateVerif)}</div>
                    ${material.observations ? `<div><i class="fas fa-comment"></i> ${material.observations.substring(0, 50)}${material.observations.length > 50 ? '...' : ''}</div>` : ''}
                </div>
            </div>
            ${statusBadge}
            <div class="compact-material-actions">
                <button class="btn btn-sm ${material.status === 'verified' ? 'btn-success' : 'btn-primary'}" onclick="verifyAlarme(${index}); event.stopPropagation();">
                    <i class="fas fa-${material.status === 'verified' ? 'check' : 'clipboard-check'}"></i>
                </button>
                <button class="btn btn-sm btn-danger" onclick="removeMaterial(${index}); event.stopPropagation();">
                    <i class="fas fa-trash"></i>
                </button>
            </div>
        </div>
    `;
}

// Vérifier une alarme (marquer comme vérifiée)
function verifyAlarme(index) {
    if (index < 0 || index >= materials.length) return;
    
    const material = materials[index];
    if (material.type !== 'alarme') return;
    
    // Ouvrir un modal de vérification détaillée
    openAlarmeVerificationModal(index);
}

// Ouvrir le modal de vérification d'alarme
function openAlarmeVerificationModal(index) {
    const material = materials[index];
    if (!material || material.type !== 'alarme') return;
    
    // Stocker l'index du matériel en cours de vérification
    currentVerificationIndex = index;
    
    // Créer et afficher le modal de vérification
    const modalHtml = createAlarmeVerificationModal(material);
    
    // Afficher le modal
    showCustomModal('Vérification Alarme Incendie', modalHtml, [
        { text: 'Annuler', class: 'btn', action: 'close' },
        { text: 'Enregistrer', class: 'btn btn-success', action: 'saveAlarmeVerification' }
    ]);
}

// Créer le contenu du modal de vérification d'alarme
function createAlarmeVerificationModal(material) {
    let html = `
        <div class="form-section">
            <div class="form-group">
                <label class="form-label">Identifiant:</label>
                <div class="form-input" style="background: var(--bg-secondary);">${material.id}</div>
            </div>
            
            <div class="form-group">
                <label class="form-label">Localisation:</label>
                <div class="form-input" style="background: var(--bg-secondary);">${material.location}</div>
            </div>
            
            <div class="form-group">
                <label class="form-label">Résultat de la vérification *</label>
                <div class="ok-nok-selector">
                    <div class="ok-nok-option ok" onclick="selectVerificationResult(this, 'ok')">Conforme</div>
                    <div class="ok-nok-option nok" onclick="selectVerificationResult(this, 'nok')">Non conforme</div>
                    <div class="ok-nok-option nc" onclick="selectVerificationResult(this, 'nc')">À contrôler</div>
                </div>
                <input type="hidden" id="verification-result" value="${material.status === 'verified' ? 'ok' : material.status === 'issues' ? 'nok' : ''}">
            </div>
            
            <div class="form-group">
                <label class="form-label">Commentaires</label>
                <textarea class="form-textarea" id="verification-comments" placeholder="Détails de la vérification..." rows="4">${material.verificationComments || ''}</textarea>
            </div>
            
            <div class="form-group">
                <label class="form-label">Photos de la vérification</label>
                <button type="button" class="btn btn-primary" onclick="addVerificationPhoto()" style="width: 100%; margin-bottom: 0.5rem;">
                    <i class="fas fa-camera"></i> Ajouter des photos
                </button>
                <input type="file" id="verification-photo-input" accept="image/*" multiple style="display: none;" onchange="handleVerificationPhotos(this.files)">
                <div id="verification-photo-gallery" class="photo-gallery"></div>
            </div>
    `;
    
    // Pré-remplir si déjà vérifié
    if (material.status === 'verified' || material.status === 'issues') {
        const resultInput = document.createElement('input');
        resultInput.type = 'hidden';
        resultInput.id = 'verification-result';
        resultInput.value = material.status === 'verified' ? 'ok' : material.status === 'issues' ? 'nok' : '';
        
        // Sélectionner l'option correspondante
        setTimeout(() => {
            const result = material.status === 'verified' ? 'ok' : 'nok';
            const selector = document.querySelector(`.ok-nok-option.${result}`);
            if (selector) {
                selector.classList.add('selected');
            }
        }, 100);
        
        // Afficher les photos existantes
        if (material.verificationPhotos) {
            setTimeout(() => {
                currentVerificationPhotos = material.verificationPhotos;
                updateVerificationPhotoGallery();
            }, 100);
        }
    }
    
    return html;
}

// Enregistrer la vérification d'une alarme
function saveAlarmeVerification() {
    const result = document.getElementById('verification-result').value;
    const comments = document.getElementById('verification-comments').value.trim();
    
    if (!result) {
        showError('Veuillez sélectionner un résultat de vérification');
        return;
    }
    
    if (currentVerificationIndex === null || currentVerificationIndex >= materials.length) {
        showError('Erreur: matériel non trouvé');
        return;
    }
    
    const material = materials[currentVerificationIndex];
    
    // Mettre à jour le statut
    material.status = result === 'ok' ? 'verified' : result === 'nok' ? 'issues' : 'pending';
    material.verificationComments = comments;
    material.verificationDate = new Date().toISOString();
    material.verificationPhotos = [...currentVerificationPhotos];
    
    // Mettre à jour l'affichage
    updateVerificationList();
    updateMaterialsCount();
    
    // Fermer le modal
    closeCustomModal();
    
    // Afficher un message de confirmation
    showSuccess('Vérification enregistrée avec succès');
    
    // Réinitialiser les variables temporaires
    currentVerificationIndex = null;
    currentVerificationPhotos = [];
}

// ============================================
// FONCTIONS POUR LE RAPPORT PDF
// ============================================

// Générer le contenu PDF pour une alarme
function generateAlarmePDFContent(material, startY) {
    const doc = window.jspdf.jsPDF;
    const pdfDoc = new doc();
    
    // Cette fonction serait appelée depuis generatePDF()
    // Pour l'instant, retournons un objet avec les données
    return {
        sections: [
            {
                title: 'ALARME INCENDIE',
                content: `
                    <strong>Identifiant:</strong> ${material.id}<br>
                    <strong>Localisation:</strong> ${material.location}<br>
                    <strong>Type d'alarme:</strong> ${material.alarmeType}<br>
                    <strong>Marque:</strong> ${material.marque}<br>
                    ${material.modele ? `<strong>Modèle:</strong> ${material.modele}<br>` : ''}
                    ${material.annee ? `<strong>Année d'installation:</strong> ${material.annee}<br>` : ''}
                    <strong>Date de vérification:</strong> ${formatDate(material.dateVerif)}<br>
                    <strong>Prochaine vérification:</strong> ${formatDate(material.dateProchaine)}
                `
            }
        ]
    };
}

// ============================================
// FONCTIONS D'INITIALISATION
// ============================================

// Initialiser les événements pour l'alarme
function initAlarmeEvents() {
    // Initialiser la date de vérification à aujourd'hui
    const today = new Date().toISOString().split('T')[0];
    const dateVerifInput = document.getElementById('alarme-date-verif');
    if (dateVerifInput && !dateVerifInput.value) {
        dateVerifInput.value = today;
    }
    
    // Initialiser la date de prochaine vérification (dans 1 an)
    const nextYear = new Date();
    nextYear.setFullYear(nextYear.getFullYear() + 1);
    const dateProchaineInput = document.getElementById('alarme-date-prochaine');
    if (dateProchaineInput && !dateProchaineInput.value) {
        dateProchaineInput.value = nextYear.toISOString().split('T')[0];
    }
    
    // Initialiser l'année à l'année courante
    const yearInput = document.getElementById('alarme-annee');
    if (yearInput && !yearInput.value) {
        yearInput.value = new Date().getFullYear();
    }
    
    // Générer un ID par défaut
    const idInput = document.getElementById('alarme-id');
    if (idInput && !idInput.value) {
        idInput.value = generateAlarmeId();
    }
}

// ============================================
// INTÉGRATION AVEC LES FONCTIONS EXISTANTES
// ============================================

// Ajouter un matériel (fonction d'intégration)
function addMaterial(materialData) {
    if (!currentClient) {
        showError('Aucun client sélectionné');
        return;
    }
    
    if (!currentClient.materials) {
        currentClient.materials = [];
    }
    
    currentClient.materials.push(materialData);
    saveCurrentClientChanges();
    
    // Mettre à jour la liste des matériels globaux
    if (!materials) materials = [];
    materials.push(materialData);
}

// Mettre à jour la liste des matériels
function updateMaterialsList() {
    displayMaterialsList();
}

// Mettre à jour le compteur de matériels
function updateMaterialsCount() {
    const badge = document.getElementById('materials-count-badge');
    if (badge && currentClient && currentClient.materials) {
        badge.textContent = currentClient.materials.length;
    }
}

// Basculer l'affichage des détails d'un matériel
function toggleMaterialDetails(index) {
    const material = materials[index];
    if (!material) return;
    
    // Cette fonction devrait basculer l'affichage des détails
    // Pour l'instant, affichons simplement une alerte
    alert(`Détails de ${material.id || material.numero}`);
}

// Mettre à jour la liste de vérification
function updateVerificationList() {
    displayVerificationList();
}

// ============================================
// FONCTIONS UTILITAIRES POUR ALARMES
// ============================================

function selectVerificationResult(element, value) {
    const parent = element.parentElement;
    const options = parent.querySelectorAll('.ok-nok-option');
    options.forEach(opt => opt.classList.remove('selected'));
    element.classList.add('selected');
    document.getElementById('verification-result').value = value;
}

function addVerificationPhoto() {
    document.getElementById('verification-photo-input').click();
}

function handleVerificationPhotos(files) {
    if (!currentVerificationPhotos) currentVerificationPhotos = [];
    
    for (let i = 0; i < files.length; i++) {
        const file = files[i];
        if (!file.type.startsWith('image/')) continue;
        
        const reader = new FileReader();
        reader.onload = function(e) {
            currentVerificationPhotos.push({
                data: e.target.result,
                name: file.name,
                type: file.type,
                timestamp: new Date().toISOString()
            });
            updateVerificationPhotoGallery();
        };
        reader.readAsDataURL(file);
    }
    
    document.getElementById('verification-photo-input').value = '';
}

function updateVerificationPhotoGallery() {
    const gallery = document.getElementById('verification-photo-gallery');
    if (!gallery) return;
    
    gallery.innerHTML = '';
    
    if (!currentVerificationPhotos || currentVerificationPhotos.length === 0) {
        gallery.innerHTML = '<div style="text-align: center; color: var(--text-secondary); padding: 1rem;">Aucune photo</div>';
        return;
    }
    
    currentVerificationPhotos.forEach((photo, index) => {
        const photoItem = document.createElement('div');
        photoItem.className = 'photo-item';
        photoItem.innerHTML = `
            <img src="${photo.data}" alt="Photo vérification ${index + 1}">
            <button type="button" onclick="removeVerificationPhoto(${index})">
                <i class="fas fa-times"></i>
            </button>
        `;
        gallery.appendChild(photoItem);
    });
}

function removeVerificationPhoto(index) {
    if (currentVerificationPhotos && currentVerificationPhotos[index]) {
        currentVerificationPhotos.splice(index, 1);
        updateVerificationPhotoGallery();
    }
}

// Fonction pour afficher un modal personnalisé
function showCustomModal(title, content, buttons) {
    // Créer le modal
    const modalHtml = `
        <div class="modal-backdrop active" style="z-index: 9999;">
            <div class="modal-content" style="max-width: 500px;">
                <div class="modal-header">
                    <h3>${title}</h3>
                    <button class="modal-close" onclick="closeCustomModal()">&times;</button>
                </div>
                <div class="modal-body">
                    ${content}
                </div>
                <div class="modal-footer">
                    ${buttons.map(btn => 
                        `<button class="${btn.class}" onclick="${btn.action === 'close' ? 'closeCustomModal()' : btn.action}()">${btn.text}</button>`
                    ).join('')}
                </div>
            </div>
        </div>
    `;
    
    // Ajouter le modal au document
    const modalDiv = document.createElement('div');
    modalDiv.id = 'custom-modal';
    modalDiv.innerHTML = modalHtml;
    document.body.appendChild(modalDiv);
}

// Fonction pour fermer le modal personnalisé
function closeCustomModal() {
    const modal = document.getElementById('custom-modal');
    if (modal) {
        modal.remove();
    }
}

// Fonction pour éditer une alarme
function openEditAlarmeModal(material, index) {
    // Cette fonction devrait ouvrir le modal d'édition d'alarme
    // Pour l'instant, affichons un message
    showSuccess(`Édition de l'alarme ${material.id} (index: ${index})`);
}

// Initialiser les événements au chargement
document.addEventListener('DOMContentLoaded', function() {
    // Initialiser les événements pour l'alarme
    initAlarmeEvents();
    
    // S'assurer que le bouton d'ouverture du modal est connecté
    const alarmeCard = document.querySelector('.equipment-card.alarme');
    if (alarmeCard) {
        alarmeCard.onclick = openAddAlarmeModal;
    }
});

// ==================== FONCTIONS DE SERVICE WORKER ====================
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

// ==================== FONCTIONS DE GESTION DE CONNEXION ====================
// Modifie la fonction updateOnlineStatus()
function updateOnlineStatus() {
    var status = document.getElementById('status');
    if (status) {
        if (navigator.onLine) {
            status.innerHTML = '🟢 En ligne';
            status.className = 'status-indicator online';
        } else {
            status.innerHTML = '🔴 Hors ligne';
            status.className = 'status-indicator offline';
        }
    }
}

console.log('FireCheck Pro - Application chargée avec succès');

// ==================== GÉNÉRATION PDF DES FACTURES (ALIGNEMENT CORRIGÉ) ====================
async function generateFacturePDF() {
    console.log("🔧 Début génération facture PDF");
    
    // 1. Vérifications préalables
    if (!currentClient) {
        showError('Veuillez d\'abord sélectionner un client');
        return;
    }
    
    if (factureItems.length === 0 && fraisDeplacement === 0) {
        showError('Aucun article dans la facture');
        return;
    }
    
    // 2. Vérifier que jsPDF est disponible
    if (typeof window.jspdf === 'undefined') {
        console.error('❌ jsPDF non chargé');
        showError('La bibliothèque PDF n\'est pas disponible. Rechargez la page.');
        return;
    }
    
    showLoading('Génération de la facture PDF en cours...');
    
    try {
        const { jsPDF } = window.jspdf;
        
        // 3. Créer le document PDF
        const doc = new jsPDF({
            orientation: 'portrait',
            unit: 'mm',
            format: 'a4'
        });
        
        // Configuration
        const pageWidth = doc.internal.pageSize.getWidth();
        const margin = 20;
        
        // Définir les positions X des colonnes POUR UN ALIGNEMENT PARFAIT
        const colDescription = margin + 2;    // Description
        const colQty = margin + 110;          // Quantité (aligné à droite)
        const colUnitPrice = margin + 130;    // Prix unitaire (aligné à droite)
        const colTotal = margin + 160;        // Total (aligné à droite)
        
        let y = 20;
        
        // ===== EN-TÊTE =====
        doc.setFontSize(24);
        doc.setTextColor(26, 54, 93);
        doc.text('FACTURE', margin, y);
        
        // Informations entreprise (à droite)
        doc.setFontSize(10);
        doc.setTextColor(0, 0, 0);
        y += 10;
        doc.text('FireCheck Pro', pageWidth - margin, y, { align: 'right' });
        doc.text('Service de vérification incendie', pageWidth - margin, y + 5, { align: 'right' });
        doc.text('SIRET: XXXXXXXX', pageWidth - margin, y + 10, { align: 'right' });
        doc.text('TVA: FRXXXXXXXX', pageWidth - margin, y + 15, { align: 'right' });
        
        // Numéro et date
        y = 40;
        doc.text(`N° Facture: ${factureNumero}`, margin, y);
        const factureDate = document.getElementById('facture-date')?.value || new Date().toLocaleDateString('fr-FR');
        doc.text(`Date: ${factureDate}`, margin, y + 5);
        
        // ===== INFORMATION CLIENT =====
        y += 20;
        doc.setFontSize(12);
        doc.setTextColor(26, 54, 93);
        doc.text('FACTURÉ À:', margin, y);
        
        doc.setFontSize(10);
        doc.setTextColor(0, 0, 0);
        y += 7;
        doc.text(currentClient.name, margin + 10, y);
        y += 5;
        doc.text(currentClient.contact, margin + 10, y);
        y += 5;
        doc.text(currentClient.address, margin + 10, y);
        
        if (currentClient.phone) {
            y += 5;
            doc.text(`Tél: ${currentClient.phone}`, margin + 10, y);
        }
        
        if (currentClient.email) {
            y += 5;
            doc.text(`Email: ${currentClient.email}`, margin + 10, y);
        }
        
        // ===== DESCRIPTION DES TRAVAUX =====
        const description = document.getElementById('facture-description')?.value || '';
        if (description) {
            y += 15;
            doc.setFontSize(12);
            doc.setTextColor(26, 54, 93);
            doc.text('DESCRIPTION DES TRAVAUX:', margin, y);
            
            doc.setFontSize(10);
            doc.setTextColor(0, 0, 0);
            const descLines = doc.splitTextToSize(description, pageWidth - 2 * margin);
            descLines.forEach(line => {
                y += 5;
                doc.text(line, margin + 10, y);
            });
        }
        
        // ===== TABLEAU DES ARTICLES =====
        y += 15;
        doc.setFontSize(12);
        doc.setTextColor(26, 54, 93);
        doc.text('DÉTAIL DE LA FACTURE:', margin, y);
        
        // En-tête du tableau (fond bleu)
        y += 10;
        doc.setFontSize(10);
        doc.setTextColor(255, 255, 255);
        doc.setFillColor(26, 54, 93);
        doc.rect(margin, y - 5, pageWidth - 2 * margin, 8, 'F');
        
        // En-têtes des colonnes avec ALIGNEMENT
        doc.text('Description', colDescription, y);
        doc.text('Qté', colQty, y, { align: 'right' });
        doc.text('Prix U. HT', colUnitPrice, y, { align: 'right' });
        doc.text('Total HT', colTotal, y, { align: 'right' });
        
        // Lignes des articles
        doc.setTextColor(0, 0, 0);
        y += 8;
        
        let totalHT = 0;
        
        factureItems.forEach(item => {
            // Description (peut être sur plusieurs lignes)
            const descLines = doc.splitTextToSize(item.description, 75); // Largeur réduite pour la description
            let lineHeight = 0;
            
            descLines.forEach((line, index) => {
                if (index === 0) {
                    doc.text(line, colDescription, y);
                } else {
                    y += 5;
                    doc.text(line, colDescription, y);
                    lineHeight += 5;
                }
            });
            
            // Quantité (alignée à droite)
            doc.text(item.quantity.toString(), colQty, y, { align: 'right' });
            
            // Prix unitaire (aligné à droite)
            doc.text(`${item.price.toFixed(2)} €`, colUnitPrice, y, { align: 'right' });
            
            // Total (aligné à droite)
            const total = item.quantity * item.price;
            doc.text(`${total.toFixed(2)} €`, colTotal, y, { align: 'right' });
            
            totalHT += total;
            
            // Passer à la ligne suivante
            y += 8 + lineHeight;
            
            // Nouvelle page si nécessaire
            if (y > 250) {
                doc.addPage();
                y = 20;
                
                // Réafficher l'en-tête du tableau sur la nouvelle page
                doc.setFillColor(26, 54, 93);
                doc.rect(margin, y - 5, pageWidth - 2 * margin, 8, 'F');
                doc.setTextColor(255, 255, 255);
                doc.text('Description', colDescription, y);
                doc.text('Qté', colQty, y, { align: 'right' });
                doc.text('Prix U. HT', colUnitPrice, y, { align: 'right' });
                doc.text('Total HT', colTotal, y, { align: 'right' });
                doc.setTextColor(0, 0, 0);
                y += 13;
            }
        });
        
        // Frais de déplacement
        if (fraisDeplacement > 0) {
            doc.text('Frais de déplacement', colDescription, y);
            doc.text('1', colQty, y, { align: 'right' });
            doc.text(`${fraisDeplacement.toFixed(2)} €`, colUnitPrice, y, { align: 'right' });
            doc.text(`${fraisDeplacement.toFixed(2)} €`, colTotal, y, { align: 'right' });
            totalHT += fraisDeplacement;
            y += 8;
        }
        
        // ===== TOTAUX =====
        y += 10;
        doc.setDrawColor(200, 200, 200);
        doc.setLineWidth(0.5);
        doc.line(margin, y, pageWidth - margin, y);
        
        y += 15;
        const tva = totalHT * 0.20;
        const totalTTC = totalHT + tva;
        
        // Position pour aligner TOUS les montants à droite
        const montantX = pageWidth - margin;
        
        // Total HT (aligné à droite comme les autres)
        doc.setFontSize(11);
        doc.text('Total HT:', colTotal - 50, y);
        doc.text(`${totalHT.toFixed(2)} €`, montantX, y, { align: 'right' });
        
        // TVA
        y += 7;
        doc.text('TVA (20%):', colTotal - 50, y);
        doc.text(`${tva.toFixed(2)} €`, montantX, y, { align: 'right' });
        
        // Total TTC (en gras)
        y += 7;
        doc.setFont(undefined, 'bold');
        doc.setFontSize(12);
        doc.text('Total TTC:', colTotal - 50, y);
        doc.text(`${totalTTC.toFixed(2)} €`, montantX, y, { align: 'right' });
        
        // ===== CONDITIONS DE PAIEMENT =====
        y += 20;
        doc.setFontSize(10);
        doc.setFont(undefined, 'normal');
        doc.setTextColor(26, 54, 93);
        doc.text('CONDITIONS DE PAIEMENT:', margin, y);
        
        doc.setTextColor(0, 0, 0);
        y += 7;
        doc.text('• Paiement à 30 jours', margin + 5, y);
        y += 5;
        doc.text('• Mode de règlement: Virement bancaire', margin + 5, y);
        y += 5;
        doc.text('• IBAN: FR76 XXXX XXXX XXXX XXXX XXXX XXX', margin + 5, y);
        y += 5;
        doc.text('• BIC: XXXXXXXXXXX', margin + 5, y);
        
        // ===== PIED DE PAGE =====
        y = 270;
        doc.setFontSize(8);
        doc.setTextColor(150, 150, 150);
        doc.text('FireCheck Pro - Service de vérification incendie - SIRET: XXXXXXXXXXXXX', pageWidth / 2, y, { align: 'center' });
        y += 4;
        doc.text('Tél: XX.XX.XX.XX.XX - Email: contact@firecheckpro.fr', pageWidth / 2, y, { align: 'center' });
        y += 4;
        doc.text('Cette facture est générée automatiquement par FireCheck Pro', pageWidth / 2, y, { align: 'center' });
        
        // ===== SAUVEGARDE DU PDF =====
        const safeClientName = currentClient.name.replace(/[^\w\s]/gi, '_').replace(/\s+/g, '_');
        const fileName = `Facture_${safeClientName}_${factureNumero}.pdf`;
        doc.save(fileName);
        
        closeLoading();
        showSuccess(`Facture PDF générée: ${fileName}`);
        
        // Enregistrer dans l'historique
        saveFactureToHistory();
        
    } catch (error) {
        closeLoading();
        console.error('❌ Erreur génération facture PDF:', error);
        showError(`Erreur lors de la génération du PDF: ${error.message}`);
    }
}

// Version SIMPLIFIÉE avec tableau parfaitement aligné (alternative)
function generateFacturePDFSimple() {
    if (!currentClient) {
        showError('Veuillez d\'abord sélectionner un client');
        return;
    }
    
    if (factureItems.length === 0) {
        showError('Aucun article dans la facture');
        return;
    }
    
    if (typeof window.jspdf === 'undefined') {
        showError('La bibliothèque PDF n\'est pas disponible');
        return;
    }
    
    showLoading('Génération PDF...');
    
    try {
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF();
        
        const pageWidth = doc.internal.pageSize.getWidth();
        const margin = 20;
        
        // POSITIONS EXACTES pour un alignement parfait
        const positions = {
            description: margin + 2,          // Description (gauche)
            quantity: margin + 110,           // Quantité (centré)
            unitPrice: margin + 130,          // Prix unitaire (droite)
            total: margin + 160               // Total (droite)
        };
        
        let y = 20;
        
        // 1. TITRE
        doc.setFontSize(20);
        doc.setTextColor(26, 54, 93);
        doc.text('FACTURE', margin, y);
        
        // 2. ENTREPRISE (droite)
        doc.setFontSize(9);
        doc.setTextColor(100, 100, 100);
        doc.text('FireCheck Pro', pageWidth - margin, y, { align: 'right' });
        doc.text('SIRET: XXXXXXXXXXXXX', pageWidth - margin, y + 4, { align: 'right' });
        
        // 3. NUMÉRO ET DATE
        y = 35;
        doc.setFontSize(11);
        doc.setTextColor(0, 0, 0);
        doc.text(`N°: ${factureNumero}`, margin, y);
        doc.text(`Date: ${new Date().toLocaleDateString('fr-FR')}`, margin, y + 6);
        
        // 4. CLIENT
        y += 20;
        doc.setFontSize(12);
        doc.setTextColor(26, 54, 93);
        doc.text('Client:', margin, y);
        
        doc.setFontSize(11);
        doc.setTextColor(0, 0, 0);
        y += 8;
        doc.text(currentClient.name, margin + 10, y);
        y += 6;
        doc.text(currentClient.address, margin + 10, y);
        
        // 5. TABLEAU
        y += 15;
        doc.setFontSize(12);
        doc.setTextColor(26, 54, 93);
        doc.text('Articles:', margin, y);
        
        // En-tête tableau
        y += 10;
        doc.setFillColor(26, 54, 93);
        doc.rect(margin, y - 5, pageWidth - 2 * margin, 8, 'F');
        doc.setFontSize(10);
        doc.setTextColor(255, 255, 255);
        
        // EN-TÊTES BIEN ALIGNÉS
        doc.text('Description', positions.description, y);
        doc.text('Qté', positions.quantity, y, { align: 'center' });
        doc.text('Prix U.', positions.unitPrice, y, { align: 'right' });
        doc.text('Total', positions.total, y, { align: 'right' });
        
        // Articles
        doc.setTextColor(0, 0, 0);
        y += 8;
        
        let totalHT = 0;
        
        factureItems.forEach(item => {
            // Description
            doc.text(item.description.substring(0, 40), positions.description, y);
            
            // Quantité (centré)
            doc.text(item.quantity.toString(), positions.quantity, y, { align: 'center' });
            
            // Prix unitaire (aligné à droite)
            doc.text(`${item.price.toFixed(2)} €`, positions.unitPrice, y, { align: 'right' });
            
            // Total (aligné à droite)
            const total = item.quantity * item.price;
            doc.text(`${total.toFixed(2)} €`, positions.total, y, { align: 'right' });
            
            totalHT += total;
            y += 7;
        });
        
        // 6. TOTAUX (TOUT ALIGNÉ À DROITE)
        y += 10;
        
        // Ligne de séparation
        doc.setDrawColor(200, 200, 200);
        doc.line(margin, y, pageWidth - margin, y);
        
        y += 15;
        
        const tva = totalHT * 0.20;
        const totalTTC = totalHT + tva;
        
        // Position finale pour alignement droit
        const rightAlign = pageWidth - margin;
        
        doc.setFontSize(11);
        doc.text('Total HT:', positions.total - 40, y);
        doc.text(`${totalHT.toFixed(2)} €`, rightAlign, y, { align: 'right' });
        
        y += 7;
        doc.text('TVA (20%):', positions.total - 40, y);
        doc.text(`${tva.toFixed(2)} €`, rightAlign, y, { align: 'right' });
        
        y += 7;
        doc.setFont(undefined, 'bold');
        doc.text('Total TTC:', positions.total - 40, y);
        doc.text(`${totalTTC.toFixed(2)} €`, rightAlign, y, { align: 'right' });
        
        // 7. PIED DE PAGE
        y = 280;
        doc.setFontSize(8);
        doc.setTextColor(150, 150, 150);
        doc.text('Facture générée par FireCheck Pro', pageWidth / 2, y, { align: 'center' });
        
        // 8. SAUVEGARDE
        const fileName = `Facture_${currentClient.name.replace(/\s+/g, '_')}.pdf`;
        doc.save(fileName);
        
        closeLoading();
        showSuccess(`Facture PDF générée: ${fileName}`);
        
    } catch (error) {
        closeLoading();
        console.error('Erreur:', error);
        showError('Erreur génération PDF');
    }
}

// Sauvegarder une facture dans l'historique
function saveFactureToHistory() {
    if (!currentClient) return;
    
    // Calculer le total HT
    const totalHT = factureItems.reduce((sum, item) => sum + (item.quantity * item.price), 0) + fraisDeplacement;
    
    const factureData = {
        id: generateId(),
        numero: factureNumero,
        date: document.getElementById('facture-date')?.value || new Date().toISOString().split('T')[0],
        clientId: currentClient.id,
        clientName: currentClient.name,
        items: [...factureItems],
        fraisDeplacement: fraisDeplacement,
        description: document.getElementById('facture-description')?.value || '',
        totalHT: totalHT,
        tva: 0.20,
        totalTTC: totalHT * 1.20,
        generated: new Date().toISOString()
    };
    
    // Sauvegarder dans localStorage
    const savedFactures = JSON.parse(localStorage.getItem('firecheck_factures') || '[]');
    savedFactures.push(factureData);
    localStorage.setItem('firecheck_factures', JSON.stringify(savedFactures));
    
    // Ajouter aux interventions du client
    if (!currentClient.interventions) {
        currentClient.interventions = [];
    }
    
    currentClient.interventions.push({
        type: 'facturation',
        date: new Date().toISOString(),
        description: `Facture ${factureNumero}`,
        montant: totalHT * 1.20,
        data: factureData
    });
    
    saveCurrentClientChanges();
    
    console.log('✅ Facture sauvegardée');
}

// Exporter toutes les factures en CSV
function exportFacturesCSV() {
    const savedFactures = JSON.parse(localStorage.getItem('firecheck_factures') || '[]');
    
    if (savedFactures.length === 0) {
        showError('Aucune facture trouvée');
        return;
    }
    
    const csv = [
        ['Numéro', 'Date', 'Client', 'Total HT', 'TVA', 'Total TTC', 'Description'],
        ...savedFactures.map(f => [
            f.numero,
            f.date,
            f.clientName,
            `${f.totalHT?.toFixed(2) || '0.00'}`,
            `${((f.totalHT || 0) * 0.20).toFixed(2)}`,
            `${((f.totalHT || 0) * 1.20).toFixed(2)}`,
            `"${(f.description || '').replace(/"/g, '""')}"`
        ])
    ].map(row => row.join(';')).join('\n');
    
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    
    link.setAttribute('href', url);
    link.setAttribute('download', `factures_export_${new Date().toISOString().split('T')[0]}.csv`);
    link.style.visibility = 'hidden';
    
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    
    showSuccess(`${savedFactures.length} facture(s) exportée(s)`);
}

console.log('FireCheck Pro - Application chargée avec succès');

// ==================== MODE PLEIN ÉCRAN POUR iPhone ====================
(function() {
    console.log('📱 Initialisation mode plein écran iPhone/Chrome');
    
    // Détecter iPhone
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
    
    // Détecter si l'app est en mode standalone (installée sur l'écran d'accueil)
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches || 
                        window.navigator.standalone || 
                        document.referrer.includes('android-app://');
    
    console.log('📱 Mode standalone détecté:', isStandalone);
    
    if (isIOS || isStandalone) {
        // Mode plein écran activé
        console.log('🚀 Mode plein écran activé pour iPhone');
        
        // Ajuster le CSS pour le mode plein écran
        const style = document.createElement('style');
        style.textContent = `
            /* Ajustements pour le mode plein écran */
            body {
                height: 100vh;
                height: -webkit-fill-available;
                overflow: hidden;
            }
            
            .container {
                height: 100vh;
                height: -webkit-fill-available;
                display: flex;
                flex-direction: column;
            }
            
            /* Ajuster la hauteur pour iPhone avec encoche */
            @supports (padding: env(safe-area-inset-top)) {
                body {
                    padding-top: env(safe-area-inset-top);
                    padding-bottom: env(safe-area-inset-bottom);
                    padding-left: env(safe-area-inset-left);
                    padding-right: env(safe-area-inset-right);
                }
                
                .header {
                    padding-top: env(safe-area-inset-top);
                    min-height: calc(60px + env(safe-area-inset-top));
                }
                
                .nav-tabs {
                    top: calc(60px + env(safe-area-inset-top));
                }
                
                .page {
                    min-height: calc(100vh - 120px - env(safe-area-inset-top) - env(safe-area-inset-bottom));
                }
            }
            
            /* Ajustements pour Chrome sur iOS en mode plein écran */
            @media all and (display-mode: standalone) {
                body {
                    -webkit-overflow-scrolling: touch;
                }
                
                .container {
                    overflow-y: auto;
                }
            }
        `;
        document.head.appendChild(style);
        
        // Gérer les événements de touche pour éviter le zoom
        document.addEventListener('touchstart', function(event) {
            if (event.touches.length > 1) {
                event.preventDefault();
            }
        }, { passive: false });
        
        let lastTouchEnd = 0;
        document.addEventListener('touchend', function(event) {
            const now = Date.now();
            if (now - lastTouchEnd <= 300) {
                event.preventDefault();
            }
            lastTouchEnd = now;
        }, { passive: false });
        
        // Éviter le zoom double-tap
        document.addEventListener('gesturestart', function(event) {
            event.preventDefault();
        });
        
        // Ajuster dynamiquement la hauteur sur iOS
        function setAppHeight() {
            const vh = window.innerHeight * 0.01;
            document.documentElement.style.setProperty('--vh', `${vh}px`);
        }
        
        // Initialiser la hauteur
        setAppHeight();
        
        // Mettre à jour la hauteur lors des rotations
        window.addEventListener('resize', setAppHeight);
        window.addEventListener('orientationchange', setAppHeight);
        
        // Gestion du clavier sur iOS
        const inputs = document.querySelectorAll('input, textarea, select');
        inputs.forEach(input => {
            input.addEventListener('focus', function() {
                // Faire défiler vers l'élément
                setTimeout(() => {
                    this.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }, 300);
            });
        });
    }
    
    // Fonction pour forcer le mode plein écran
    window.requestFullscreenMode = function() {
        if (document.documentElement.requestFullscreen) {
            document.documentElement.requestFullscreen();
        } else if (document.documentElement.webkitRequestFullscreen) { // Safari
            document.documentElement.webkitRequestFullscreen();
        } else if (document.documentElement.msRequestFullscreen) { // IE11
            document.documentElement.msRequestFullscreen();
        }
    };
    
    // Fonction pour sortir du mode plein écran
    window.exitFullscreenMode = function() {
        if (document.exitFullscreen) {
            document.exitFullscreen();
        } else if (document.webkitExitFullscreen) { // Safari
            document.webkitExitFullscreen();
        } else if (document.msExitFullscreen) { // IE11
            document.msExitFullscreen();
        }
    };
    
    // Ajouter un bouton de contrôle plein écran dans le header (optionnel)
    if (isIOS) {
        document.addEventListener('DOMContentLoaded', function() {
            const fullscreenBtn = document.createElement('button');
            fullscreenBtn.className = 'btn btn-sm';
            fullscreenBtn.innerHTML = '<i class="fas fa-expand"></i>';
            fullscreenBtn.title = 'Mode plein écran';
            fullscreenBtn.onclick = function() {
                window.requestFullscreenMode();
            };
            
            // Ajouter au header si souhaité
            // const headerControls = document.querySelector('.header-controls');
            // if (headerControls) {
            //     headerControls.appendChild(fullscreenBtn);
            // }
        });
    }
})();
