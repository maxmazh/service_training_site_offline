// Import the functions you need from the SDKs you need
// import { initializeApp } from "firebase/app";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyCC20gldUQGnq_ctVGSSomlS1Srk-K1Bxw",
  authDomain: "service-training-site.firebaseapp.com",
  projectId: "service-training-site",
  storageBucket: "service-training-site.firebasestorage.app",
  messagingSenderId: "360644610762",
  appId: "1:360644610762:web:2ca938c59a2e9efece4233"
};

// Initialize Firebase
if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
}

// const app = initializeApp(firebaseConfig);
const db = firebase.firestore();

firebase.firestore().enablePersistence()
  .catch(function(err) {
    if (err.code === 'failed-precondition') {
      console.warn('Персистентность недоступна (открыто несколько вкладок)');
    } else if (err.code === 'unimplemented') {
      console.warn('Браузер не поддерживает персистентность');
    }
  });
