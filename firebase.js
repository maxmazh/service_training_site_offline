import { initializeApp } from "https://www.gstatic.com/firebasejs/13.4.0/firebase-app.js";

import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut
} from "https://www.gstatic.com/firebasejs/13.4.0/firebase-auth.js";

import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  collection,
  getDocs,
  query,
  orderBy,
  doc,
  deleteDoc,
  writeBatch,
  setDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/13.4.0/firebase-firestore.js";

// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyCC20gldUQGnq_ctVGSSomlS1Srk-K1Bxw",
  authDomain: "service-training-site.firebaseapp.com",
  projectId: "service-training-site",
  storageBucket: "service-training-site.firebasestorage.app",
  messagingSenderId: "360644610762",
  appId: "1:360644610762:web:2ca938c59a2e9efece4233"
};

// 1. Инициализация Firebase
const app = initializeApp(firebaseConfig);

// 2. Инициализация Authentication
const auth = getAuth(app);

// 3. Инициализация Firestore
const db = initializeFirestore(app, {
  localCache: persistentLocalCache({
    tabManager: persistentMultipleTabManager()
  })
});

// Передаём Authentication остальному коду сайта
window.auth = auth;

window.firebaseAuthApi = {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut
};

// Передаём Firestore остальному коду сайта
window.firestoreApi = {
  db,
  collection,
  getDocs,
  query,
  orderBy,
  doc,
  deleteDoc,
  writeBatch,
  setDoc,
  serverTimestamp
};

// Сообщаем, что Firestore готов
window.firestoreReady = Promise.resolve();
console.log("Firebase успешно инициализирован");