import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc, updateDoc } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

const firebaseConfig = {
    apiKey: "AIzaSyC8k8GO0wjskjMiInIlB0Ay_qC58PVs2W4",
    authDomain: "black-jack-d09e8.firebaseapp.com",
    projectId: "black-jack-d09e8",
    storageBucket: "black-jack-d09e8.firebasestorage.app",
    messagingSenderId: "808367199261",
    appId: "1:808367199261:web:71a5a47c1b670afa8de2f4",
    measurementId: "G-E4SP34GRYD"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const provider = new GoogleAuthProvider();

let user = null;
let balance = 0;
let currentBet = 0;
let lastClaimDate = ""; // 신규 추가
let deck = [], playerHand = [], dealerHand = [];
let isGameOver = true;

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const loginBtn = document.getElementById('login-btn');
const authSection = document.getElementById('auth-section');
const lobbySection = document.getElementById('lobby-section'); // 신규 연결
const board = document.getElementById('board');
const messageEl = document.getElementById('message');
const dealBtn = document.getElementById('deal-btn');
const actionBtns = document.getElementById('action-btns');

loginBtn.onclick = async () => {
    const result = await signInWithPopup(auth, provider);
    user = result.user;
    loadUserData();
};

onAuthStateChanged(auth, async (u) => {
    if (u) { user = u; loadUserData(); }
});

async function loadUserData() {
    const userRef = doc(db, "users", user.uid);
    const snap = await getDoc(userRef);
    if (snap.exists()) {
        balance = snap.data().money;
        lastClaimDate = snap.data().lastClaimDate || ""; // 데이터 로드
    } else {
        balance = 1000;
        await setDoc(userRef, { money: balance, lastClaimDate: "" });
    }
    authSection.classList.add('hidden');
    lobbySection.classList.remove('hidden'); // 로그인 후 로비로 이동
    board.classList.add('hidden');
    
    checkDailyReward();
    updateUI();
}

// --- 화면 전환 및 로비 기능 (신규 추가) ---
document.getElementById('start-game-btn').onclick = () => {
    lobbySection.classList.add('hidden');
    board.classList.remove('hidden');
};

document.getElementById('back-to-lobby').onclick = () => {
    if(!isGameOver) {
        if(!confirm("The game is in progress. Return to lobby?")) return;
    }
    board.classList.add('hidden');
    lobbySection.classList.remove('hidden');
    updateUI();
};

function checkDailyReward() {
    const today = new Date().toISOString().split('T')[0];
    const btn = document.getElementById('daily-reward-btn');
    if (lastClaimDate === today) {
        btn.disabled = true;
        btn.innerText = "Already Claimed ✨";
        btn.style.opacity = "0.5";
    }
}

document.getElementById('daily-reward-btn').onclick = async () => {
    const today = new Date().toISOString().split('T')[0];
    if (lastClaimDate === today) return;

    balance += 1000;
    lastClaimDate = today;
    updateUI();
    checkDailyReward();

    await updateDoc(doc(db, "users", user.uid), { 
        money: balance, 
        lastClaimDate: today 
    });
    alert("Enjoy your 1,000 gold gift! 🥂");
};

document.getElementById('exchange-btn').onclick = () => {
    alert("The Boutique is preparing its collection... 🌹");
};

// --- 기존 게임 기능 (유지) ---
function reorderCards(containerId) {
    const container = document.getElementById(containerId);
    const cards = container.querySelectorAll('.card-container');
    const total = cards.length;
    const overlapValue = total >= 3 ? 40 : 0; 
    cards.forEach((card, index) => {
        card.style.position = 'relative';
        card.style.zIndex = index;
        if (index > 0) card.style.marginLeft = `-${overlapValue}px`;
        else card.style.marginLeft = '0px';
    });
}

function createCardElement(card, isHidden = false) {
    const container = document.createElement('div');
    container.className = 'card-container';
    const inner = document.createElement('div');
    inner.className = 'card-inner';
    if (isHidden) container.id = 'dealer-hidden-card';
    const front = document.createElement('div');
    front.className = 'card-front';
    const isRed = card.s === '♥' || card.s === '♦';
    front.style.color = isRed ? 'var(--rose-gold)' : 'var(--deep-rose)';
    const cornerTag = `<div class="card-corner"><div class="card-rank">${card.r}</div><div class="card-suit-small">${card.s}</div></div>`;
    const symbolsGrid = document.createElement('div');
    symbolsGrid.className = 'symbols-grid';
    if (['J', 'Q', 'K'].includes(card.r)) {
        symbolsGrid.innerHTML = `<div class="face-center">${card.r}</div>`;
    } else if (card.r === 'A') {
        symbolsGrid.innerHTML = `<div class="face-center" style="font-size: 1.8rem;">${card.s}</div>`;
    } else {
        getSymbolPositions(parseInt(card.r)).forEach(pos => {
            const s = document.createElement('div'); s.className = 'symbol';
            s.style.gridArea = pos; s.innerText = card.s;
            symbolsGrid.appendChild(s);
        });
    }
    front.innerHTML = `<div class="corner-wrapper top-left">${cornerTag}</div>`;
    front.appendChild(symbolsGrid);
    front.innerHTML += `<div class="corner-wrapper bottom-right">${cornerTag}</div>`;
    const back = document.createElement('div');
    back.className = 'card-back';
    inner.appendChild(front); inner.appendChild(back);
    container.appendChild(inner);
    if (!isHidden) setTimeout(() => inner.classList.add('flipped'), 100);
    return container;
}

function getSymbolPositions(num) {
    const posMap = {
        2: ["1/2", "5/2"], 3: ["1/2", "3/2", "5/2"], 4: ["1/1", "1/3", "5/1", "5/3"],
        5: ["1/1", "1/3", "3/2", "5/1", "5/3"], 6: ["1/1", "1/3", "3/1", "3/3", "5/1", "5/3"],
        7: ["1/1", "1/3", "2/2", "3/1", "3/3", "5/1", "5/3"], 8: ["1/1", "1/3", "2/2", "3/1", "3/3", "4/2", "5/1", "5/3"],
        9: ["1/1", "1/3", "2/1", "2/3", "3/2", "4/1", "4/3", "5/1", "5/3"],
        10: ["1/1", "1/3", "2/1", "2/3", "2/2", "4/2", "4/1", "4/3", "5/1", "5/3"]
    };
    return posMap[num] || [];
}

function createDeck() {
    const suits = ['♠', '♥', '♦', '♣'];
    const ranks = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
    deck = [];
    for (let s of suits) for (let r of ranks) deck.push({ s, r });
    deck.sort(() => Math.random() - 0.5);
}

function calculateScore(hand) {
    let score = 0, aces = 0;
    for (let card of hand) {
        if (card.r === 'A') { score += 11; aces++; }
        else if (['J', 'Q', 'K'].includes(card.r)) score += 10;
        else score += parseInt(card.r);
    }
    while (score > 21 && aces > 0) { score -= 10; aces--; }
    return score;
}

window.adjustBet = (amount) => {
    if (!isGameOver) return;
    if (balance >= amount) {
        currentBet += amount;
        balance -= amount;
        updateUI();
    }
};

dealBtn.onclick = async () => {
    if (currentBet <= 0) return alert("Please place a bet!");
    isGameOver = false;
    dealBtn.classList.add('hidden');
    createDeck();
    playerHand = [deck.pop(), deck.pop()];
    dealerHand = [deck.pop(), deck.pop()];
    const pDiv = document.getElementById('player-cards');
    const dDiv = document.getElementById('dealer-cards');
    pDiv.innerHTML = ''; dDiv.innerHTML = '';
    pDiv.appendChild(createCardElement(playerHand[0])); reorderCards('player-cards'); await sleep(600);
    dDiv.appendChild(createCardElement(dealerHand[0])); reorderCards('dealer-cards'); await sleep(600);
    pDiv.appendChild(createCardElement(playerHand[1])); reorderCards('player-cards'); await sleep(600);
    dDiv.appendChild(createCardElement(dealerHand[1], true)); reorderCards('dealer-cards');
    updateUI();
    actionBtns.classList.remove('hidden');
    messageEl.innerText = "Shall we draw another?";
};

document.getElementById('hit-btn').onclick = async () => {
    const nextCard = deck.pop();
    playerHand.push(nextCard);
    document.getElementById('player-cards').appendChild(createCardElement(nextCard));
    reorderCards('player-cards');
    updateUI();
    if (calculateScore(playerHand) > 21) endGame('lose');
};

document.getElementById('stay-btn').onclick = dealerTurn;

async function dealerTurn() {
    actionBtns.classList.add('hidden');
    const hiddenCard = document.querySelector('#dealer-hidden-card .card-inner');
    if (hiddenCard) { hiddenCard.classList.add('flipped'); await sleep(800); }
    let dScore = calculateScore(dealerHand);
    while (dScore < 17) {
        const nextCard = deck.pop();
        dealerHand.push(nextCard);
        document.getElementById('dealer-cards').appendChild(createCardElement(nextCard));
        reorderCards('dealer-cards');
        dScore = calculateScore(dealerHand);
        updateUI();
        await sleep(1000);
    }
    const pScore = calculateScore(playerHand);
    if (dScore > 21 || pScore > dScore) endGame('win');
    else if (pScore < dScore) endGame('lose');
    else endGame('push');
}

async function endGame(result) {
    isGameOver = true;
    let msg = "";
    if (result === 'win') {
        const isBJ = calculateScore(playerHand) === 21 && playerHand.length === 2;
        balance += Math.floor(currentBet * (isBJ ? 3 : 2));
        msg = isBJ ? "Magnificent Blackjack! 🥂" : "Victory is yours, darling! ✨";
    } else if (result === 'lose') {
        msg = "The Dame wins this time. 🌹";
    } else {
        balance += currentBet;
        msg = "It's a delicate tie.";
    }
    currentBet = 0;
    messageEl.innerText = msg;
    dealBtn.classList.remove('hidden');
    updateUI();
    if (user) await updateDoc(doc(db, "users", user.uid), { money: balance });
}

function updateUI() {
    document.getElementById('balance').innerText = balance.toLocaleString();
    document.getElementById('lobby-balance').innerText = balance.toLocaleString(); // 로비 잔액도 동기화
    document.getElementById('current-bet-display').innerText = currentBet.toLocaleString();
    document.getElementById('player-score').innerText = calculateScore(playerHand);
    if (isGameOver) document.getElementById('dealer-score').innerText = calculateScore(dealerHand);
    else document.getElementById('dealer-score').innerText = "?";
}
