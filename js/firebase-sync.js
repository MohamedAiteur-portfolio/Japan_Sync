import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getFirestore, doc, setDoc, onSnapshot } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getAuth, signInAnonymously, signInWithEmailAndPassword, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

// Le mode aperçu charge uniquement les données fictives locales et ne se
// connecte pas au document Firebase partagé du vrai espace de voyage.
if (new URLSearchParams(window.location.search).get('demo') !== 'lisbonne') {

// Compte "éditeur" partagé : ce n'est qu'un identifiant technique, pas un
// secret — le vrai mot de passe n'existe que dans Firebase Authentication
// (jamais dans ce fichier), et les règles Firestore sont ce qui bloque
// réellement l'écriture pour qui ne le connaît pas.
const EDITOR_EMAIL = "editeur@voyage-japon.app";

const firebaseConfig = {
    apiKey: "AIzaSyBm8xMiTMBN1oI9Bc8ZyKBGeoWOcVnZ_yk",
    authDomain: "monvoyageaujapon-d9744.firebaseapp.com",
    projectId: "monvoyageaujapon-d9744",
    storageBucket: "monvoyageaujapon-d9744.firebasestorage.app",
    messagingSenderId: "770359975810",
    appId: "1:770359975810:web:83eb1b5069f8c8a28b399b"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);
// Le projet historique utilise encore un seul document partagé : voyage/data.
const tripDocRef = doc(db, "voyage", "data");

let localWriteInProgress = false;
let pendingCloudData = null;

// Fonction appelée par saveToLocalStorage() pour pousser les données vers le cloud
window.saveToCloud = async function (data) {
    // Tant que l'authentification n'est pas terminée, les règles Firestore
    // refuseraient l'écriture : on retente automatiquement une fois connecté.
    if (!auth.currentUser) {
        pendingCloudData = data;
        return;
    }
    localWriteInProgress = true;
    try {
        await setDoc(tripDocRef, data);
    } catch (e) {
        console.error("Erreur de sauvegarde Firebase :", e);
    }
    setTimeout(() => { localWriteInProgress = false; }, 500);
};

// Authentification anonyme : chaque appareil obtient une identité technique
// sans mot de passe, requise par les règles Firestore (request.auth != null)
// pour empêcher n'importe qui sur Internet de lire/écrire vos données.
// Un utilisateur connecté avec le compte "éditeur" (email/mot de passe)
// n'est PAS anonyme : c'est ce que vérifient les règles Firestore pour
// autoriser l'écriture, et ce que ce code utilise pour afficher les
// boutons de modification (window.isEditor).
onAuthStateChanged(auth, (user) => {
    window.isEditor = !!(user && user.isAnonymous === false);
    document.body.classList.toggle('is-editor', window.isEditor);
    if (window.updateLockButtonUI) window.updateLockButtonUI();

    if (user && pendingCloudData) {
        window.saveToCloud(pendingCloudData);
        pendingCloudData = null;
    }
});
signInAnonymously(auth).catch((e) => {
    console.error("Erreur d'authentification Firebase :", e);
});

// Appelé par le formulaire de déverrouillage : tente de se connecter avec
// le compte éditeur. Si le mot de passe est bon, Firebase remplace la
// session anonyme par une session "éditeur" (onAuthStateChanged ci-dessus
// s'en aperçoit et débloque l'interface). Si le mot de passe est faux,
// rien ne change et la fonction renvoie false pour afficher une erreur.
window.unlockEditing = async function (password) {
    try {
        await signInWithEmailAndPassword(auth, EDITOR_EMAIL, password);
        return true;
    } catch (e) {
        console.error("Échec du déverrouillage :", e.code || e);
        return false;
    }
};

// Reverrouille l'appareil : revient à une session anonyme (lecture seule).
window.lockEditing = async function () {
    try {
        await signOut(auth);
    } catch (e) {
        console.error("Erreur lors du reverrouillage :", e);
    }
    signInAnonymously(auth).catch((e) => {
        console.error("Erreur d'authentification Firebase :", e);
    });
};

// Écoute en direct des changements de l'espace partagé.
onSnapshot(tripDocRef, (snap) => {
    if (localWriteInProgress) return;
    if (snap.exists()) {
        window.appData = snap.data();
        if (window.ensureDataShape) window.ensureDataShape();
        if (window.migrateLegacyProgramme) window.migrateLegacyProgramme();
        if (window.refreshAllUI) window.refreshAllUI();
    } else if (auth.currentUser) {
        // Première connexion : personne n'a encore rien envoyé au cloud, on initialise avec les données actuelles
        window.saveToCloud(window.appData);
    }
});
}
