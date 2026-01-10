// security.js - Protection de toutes les pages
(function() {
    // Liste des pages PROTÉGÉES (nécessitent une connexion)
    const PROTECTED_PAGES = [
        'index.html',
        'materials.html',  // si tu en as
        'clients.html',    // si tu en as
        'verification.html' // si tu en as
    ];
    
    // Vérifier si on est sur une page protégée
    const currentPage = window.location.pathname.split('/').pop();
    
    if (PROTECTED_PAGES.includes(currentPage)) {
        // Charger l'authentification
        checkAuthentication();
    }
    
    function checkAuthentication() {
        // Essayer d'abord avec auth.js
        if (typeof auth !== 'undefined' && auth.checkAuth) {
            const user = auth.checkAuth();
            if (!user) {
                redirectToLogin();
            }
        } else {
            // Fallback : vérifier localStorage
            const session = localStorage.getItem('user_session');
            if (!session) {
                redirectToLogin();
            } else {
                try {
                    const userData = JSON.parse(session);
                    // Vérifier expiration
                    if (Date.now() > userData.expiresAt) {
                        localStorage.removeItem('user_session');
                        redirectToLogin();
                    }
                } catch (e) {
                    redirectToLogin();
                }
            }
        }
    }
    
    function redirectToLogin() {
        // Sauvegarder la page actuelle pour y retourner après login
        sessionStorage.setItem('redirectAfterLogin', window.location.href);
        
        // Rediriger vers auth.html
        if (!window.location.pathname.includes('auth.html')) {
            window.location.href = 'auth.html';
        }
    }
    
    // Exposer globalement
    window.security = {
        checkAuthentication,
        requireAuth: checkAuthentication
    };
})();
