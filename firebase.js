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

window.db = db;


window.firestoreReady = db.enablePersistence({
  synchronizeTabs: true
})
  .then(function() {
    console.log(
      "Firestore Offline Persistence включена (Multi-Tab)"
    );
  })
  .catch(function(err) {
    console.warn(
      "Offline Persistence недоступна:",
      err.code
    );
  });