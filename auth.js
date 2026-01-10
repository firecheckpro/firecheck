// ============================================
// AUTH.JS - Version SÉCURISÉE pour GitHub
// ============================================

// 🔐 UTILISATEURS DE DÉMONSTRATION
// ⚠️ Pour un usage réel, remplacez par vos propres utilisateurs
const USERS = [
    {
        username: "demo",
        password: "demo123",      // Mot de passe démo
        role: "user",
        fullName: "Utilisateur Démo"
    },
    {
        username: "admin",
        password: "admin123",     // Mot de passe démo admin
        role: "admin",
        fullName: "Administrateur"
    }
];

// ⚙️ PARAMÈTRES DE SESSION
const SESSION_DURATION = 24 * 60 * 60 * 1000; // 24 heures

// ============================================
// FONCTIONS D'AUTHENTIFICATION
// ============================================

/**
 * Fonction de connexion principale
 */
function login(username, password, rememberMe = false) {
    // Si appelé depuis le HTML sans paramètres
    if (!username) {
        const usernameInput = document.getElementById('username');
        const passwordInput = document.getElementById('password');
        const rememberCheckbox = document.getElementById('rememberMe');
        
        if (usernameInput && passwordInput) {
            username = usernameInput.value.trim();
            password = passwordInput.value;
            rememberMe = rememberCheckbox ? rememberCheckbox.checked : false;
        }
    }
    
    // Validation
    if (!username || !password) {
        showError("Veuillez remplir tous les champs");
        return false;
    }
    
    // Chercher l'utilisateur
    const user = USERS.find(u => u.username === username);
    
    if (!user) {
        showError("Utilisateur non trouvé");
        return false;
    }
    
    // Vérifier le mot de passe
    if (user.password !== password) {
        showError("Mot de passe incorrect");
        return false;
    }
    
    // ✅ Connexion réussie !
    createSession(user, rememberMe);
    
    // Redirection vers l'application
    setTimeout(() => {
        window.location.href = "index.html";
    }, 500);
    
    return true;
}

/**
 * Crée une session utilisateur
 */
function createSession(user, rememberMe) {
    const sessionData = {
        username: user.username,
        fullName: user.fullName,
        role: user.role,
        loginTime: Date.now(),
        expiresAt: Date.now() + SESSION_DURATION
    };
    
    // Stocker la session
    localStorage.setItem('user_session', JSON.stringify(sessionData));
    
    // Option "Se souvenir de moi"
    if (rememberMe) {
        localStorage.setItem('remember_me', 'true');
    } else {
        localStorage.removeItem('remember_me');
    }
    
    console.log(`✅ ${user.fullName} connecté(e)`);
    return sessionData;
}

/**
 * Vérifie si l'utilisateur est connecté
 */
function checkAuth() {
    const sessionData = localStorage.getItem('user_session');
    
    if (!sessionData) {
        return null;
    }
    
    try {
        const session = JSON.parse(sessionData);
        
        // Vérifier l'expiration
        if (Date.now() > session.expiresAt) {
            logout();
            return null;
        }
        
        return session;
    } catch (error) {
        console.error('Erreur lecture session:', error);
        localStorage.removeItem('user_session');
        return null;
    }
}

/**
 * Déconnecte l'utilisateur
 */
function logout() {
    localStorage.removeItem('user_session');
    localStorage.removeItem('remember_me');
    
    // Rediriger vers la page de connexion
    if (!window.location.pathname.includes('auth.html')) {
        window.location.href = "auth.html";
    }
    
    console.log('👋 Utilisateur déconnecté');
}

/**
 * Affiche un message d'erreur
 */
function showError(message) {
    const errorDiv = document.getElementById('errorMessage');
    if (errorDiv) {
        errorDiv.textContent = message;
        errorDiv.style.display = 'block';
        
        setTimeout(() => {
            errorDiv.style.display = 'none';
        }, 5000);
    } else {
        alert(message); // Fallback
    }
}

/**
 * Vérifie l'accès à une page
 */
function requireAuth() {
    const userSession = checkAuth();
    
    // Si sur index.html et pas connecté
    if (window.location.pathname.includes('index.html') && !userSession) {
        window.location.href = "auth.html";
        return null;
    }
    
    // Si sur auth.html et déjà connecté
    if (window.location.pathname.includes('auth.html') && userSession) {
        window.location.href = "index.html";
        return userSession;
    }
    
    return userSession;
}

/**
 * Vérifie si l'utilisateur est admin
 */
function isAdmin() {
    const session = checkAuth();
    return session && session.role === 'admin';
}

// ============================================
// FONCTIONS UTILITAIRES
// ============================================

/**
 * Ajoute un utilisateur temporaire (pour configuration)
 */
function addTempUser(username, password, fullName, role = 'user') {
    USERS.push({
        username,
        password,
        fullName,
        role
    });
    
    console.log('👤 Utilisateur temporaire ajouté');
    return true;
}

/**
 * Configuration rapide pour test
 */
function quickSetup() {
    console.log('⚙️ Configuration rapide...');
    
    // Ajouter un utilisateur admin pour test
    addTempUser('test', 'test123', 'Utilisateur Test', 'admin');
    
    // Connecter automatiquement
    createSession({
        username: 'test',
        fullName: 'Utilisateur Test',
        role: 'admin'
    }, false);
    
    alert('✅ Configuration terminée ! Redirection...');
    window.location.href = "index.html";
}

// ============================================
// INITIALISATION
// ============================================

// Au chargement de la page
document.addEventListener('DOMContentLoaded', function() {
    // Si on est sur auth.html, vérifier si déjà connecté
    if (window.location.pathname.includes('auth.html')) {
        const user = checkAuth();
        if (user && localStorage.getItem('remember_me') === 'true') {
            // Redirection auto si "se souvenir"
            window.location.href = "index.html";
        }
    }
    
    // Si on est sur index.html, vérifier l'authentification
    if (window.location.pathname.includes('index.html')) {
        requireAuth();
    }
});

// ============================================
// EXPORT DES FONCTIONS
// ============================================
window.auth = {
    login,
    logout,
    checkAuth,
    requireAuth,
    isAdmin,
    addTempUser,
    quickSetup,
    USERS // Exposé pour debug
};

// Message de sécurité
console.log('🔒 Auth.js chargé - Version démo');
console.log('⚠️ Pour usage professionnel, remplacez les utilisateurs démo');
