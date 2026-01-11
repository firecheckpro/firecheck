// ============================================
// AUTH.JS - Version corrigée
// Désactive la redirection automatique vers index.html
// ============================================

// 🔐 UTILISATEURS DE DÉMONSTRATION
const USERS = [
    {
        username: "demo",
        password: "demo123",
        role: "user",
        fullName: "Utilisateur Démo"
    },
    {
        username: "admin",
        password: "admin123",
        role: "admin",
        fullName: "Administrateur"
    },
    {
        username: "tech",
        password: "tech123",
        role: "technician",
        fullName: "Technicien"
    }
];

// ============================================
// FONCTIONS D'AUTHENTIFICATION
// ============================================

/**
 * Fonction de connexion principale
 */
function login(username, password, rememberMe = false) {
    console.log('🔐 Tentative de connexion...');
    
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
    
    // Redirection vers l'application après succès
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
        expiresAt: Date.now() + (24 * 60 * 60 * 1000) // 24 heures
    };
    
    // Stocker la session
    localStorage.setItem('user_session', JSON.stringify(sessionData));
    
    // Option "Se souvenir de moi"
    if (rememberMe) {
        localStorage.setItem('remember_me', 'true');
    } else {
        localStorage.removeItem('remember_me');
    }
    
    console.log(`✅ ${user.fullName} connecté(e) avec succès`);
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
            console.log('Session expirée');
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
    
    console.log('👋 Déconnexion effectuée');
    
    // Rediriger vers la page de connexion
    window.location.href = "auth.html";
}

/**
 * Affiche un message d'erreur
 */
function showError(message) {
    console.error('Erreur auth:', message);
    const errorDiv = document.getElementById('errorMessage');
    if (errorDiv) {
        errorDiv.innerHTML = `
            <i class="fas fa-exclamation-circle"></i>
            <span>${message}</span>
        `;
        errorDiv.style.display = 'flex';
        errorDiv.style.alignItems = 'center';
        errorDiv.style.gap = '10px';
        
        setTimeout(() => {
            errorDiv.style.display = 'none';
        }, 5000);
    } else {
        alert(message);
    }
}

/**
 * Vérifie l'accès à une page
 */
function requireAuth() {
    const userSession = checkAuth();
    
    console.log('Vérification auth pour:', window.location.pathname);
    console.log('Session:', userSession ? 'Connecté' : 'Non connecté');
    
    // Si sur index.html et pas connecté -> rediriger vers auth.html
    if (window.location.pathname.includes('index.html') && !userSession) {
        console.log('Non authentifié, redirection vers auth.html');
        window.location.href = "auth.html";
        return null;
    }
    
    // Si sur auth.html et déjà connecté -> NE PAS rediriger automatiquement
    // L'utilisateur peut choisir de rester ou de se reconnecter
    if (window.location.pathname.includes('auth.html') && userSession) {
        console.log('Déjà connecté, reste sur auth.html');
        // Afficher une info pour indiquer qu'une session existe
        displaySessionInfo(userSession);
        return userSession;
    }
    
    return userSession;
}

/**
 * Affiche les informations de session sur auth.html
 */
function displaySessionInfo(session) {
    const infoDiv = document.getElementById('sessionInfo');
    if (!infoDiv) return;
    
    infoDiv.innerHTML = `
        <div style="background: #e8f5e9; padding: 10px; border-radius: 8px; margin: 15px 0; border-left: 4px solid #4caf50;">
            <p style="margin: 0; color: #2e7d32;">
                <i class="fas fa-info-circle"></i>
                Vous êtes déjà connecté en tant que <strong>${session.fullName}</strong>
            </p>
            <p style="margin: 5px 0 0 0; font-size: 14px; color: #555;">
                Vous pouvez :
                <button onclick="window.location.href='index.html'" style="margin-left: 10px; padding: 5px 10px; background: #4caf50; color: white; border: none; border-radius: 4px; cursor: pointer;">
                    <i class="fas fa-arrow-right"></i> Aller à l'application
                </button>
                <button onclick="logout()" style="margin-left: 5px; padding: 5px 10px; background: #f44336; color: white; border: none; border-radius: 4px; cursor: pointer;">
                    <i class="fas fa-sign-out-alt"></i> Changer d'utilisateur
                </button>
            </p>
        </div>
    `;
    infoDiv.style.display = 'block';
}

/**
 * Vérifie si l'utilisateur est admin
 */
function isAdmin() {
    const session = checkAuth();
    return session && session.role === 'admin';
}

/**
 * Vérifie si l'utilisateur est technicien
 */
function isTechnician() {
    const session = checkAuth();
    return session && (session.role === 'technician' || session.role === 'admin');
}

// ============================================
// INITIALISATION
// ============================================

// Au chargement de la page
document.addEventListener('DOMContentLoaded', function() {
    console.log('DOM chargé, vérification auth...');
    
    // Si on est sur index.html, vérifier l'authentification (redirigera si non connecté)
    if (window.location.pathname.includes('index.html')) {
        requireAuth();
    }
    
    // Si on est sur auth.html
    if (window.location.pathname.includes('auth.html')) {
        console.log('Page de connexion détectée');
        
        // Vérifier si une session existe
        const user = checkAuth();
        const rememberMe = localStorage.getItem('remember_me') === 'true';
        
        console.log('Session existante:', user ? 'Oui' : 'Non');
        console.log('Remember me:', rememberMe);
        
        // Si une session existe et que "remember me" est activé
        if (user && rememberMe) {
            console.log('Session existante avec remember me');
            // Afficher les infos de session mais NE PAS rediriger automatiquement
            displaySessionInfo(user);
        } else if (user && !rememberMe) {
            console.log('Session existante sans remember me');
            // Afficher simplement les infos
            displaySessionInfo(user);
        } else {
            console.log('Aucune session active');
        }
        
        // Focus sur le champ utilisateur
        const usernameInput = document.getElementById('username');
        if (usernameInput) {
            usernameInput.focus();
        }
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
    isTechnician,
    USERS // Exposé pour debug
};

// Message de sécurité
console.log('🔒 Auth.js chargé - Version corrigée');
console.log('📋 Utilisateurs disponibles:', USERS.map(u => u.username));
console.log('ℹ️ La redirection automatique est désactivée');
