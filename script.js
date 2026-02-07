import { 
    initializeApp 
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import { 
    getAuth, GoogleAuthProvider, signInWithPopup, onAuthStateChanged 
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import { 
    getFirestore, doc, getDoc, setDoc, updateDoc, collection, query, orderBy, 
    limit, onSnapshot, where, addDoc, serverTimestamp, arrayUnion, getDocs, deleteDoc 
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

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

// --- 전역 변수 ---
let user = null;
let balance = 0;
let currentBet = 0;
let myMultiBet = 0;
let lastClaimDate = "";
let deck = [], playerHand = [], dealerHand = [];
let isGameOver = true;
let currentRoomId = null;
let isMultiplayer = false;
let players = [];

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// UI 요소 연결
const loginBtn = document.getElementById('login-btn');
const authSection = document.getElementById('auth-section');
const lobbySection = document.getElementById('lobby-section');
const board = document.getElementById('board');
const messageEl = document.getElementById('message');
const dealBtn = document.getElementById('deal-btn');
const actionBtns = document.getElementById('action-btns');
const displayNickname = document.getElementById('display-nickname');
const multiLobbyModal = document.getElementById('multi-lobby-modal');
const playerListMulti = document.getElementById('player-list-multi');
const multiContainer = document.getElementById('multi-player-container');
const multiStartBtn = document.getElementById('multi-start-btn');
const leaveMultiBtn = document.getElementById('leave-multi');

// --- 1. 인증 및 유저 데이터 관리 ---
onAuthStateChanged(auth, async (u) => {
    if (u) {
        user = u;
        await loadUserData();
    } else {
        authSection.classList.remove('hidden');
        lobbySection.classList.add('hidden');
    }
});

async function loadUserData() {
    const userRef = doc(db, "users", user.uid);
    const snap = await getDoc(userRef);
    if (snap.exists()) {
        const data = snap.data();
        balance = data.money || 0;
        lastClaimDate = data.lastClaimDate || "";
        displayNickname.innerText = data.displayName || "Guest";
    } else {
        balance = 1000;
        await setDoc(userRef, { money: balance, lastClaimDate: "", displayName: "" });
    }
    authSection.classList.add('hidden');
    lobbySection.classList.remove('hidden');
    checkDailyReward();
    updateUI();
}

// 닉네임 수정 기능
document.getElementById('edit-nickname-btn').onclick = () => {
    document.getElementById('nickname-modal').classList.remove('hidden');
};

document.getElementById('save-nickname').onclick = async () => {
    const newName = document.getElementById('nickname-input').value.trim();
    if (newName) {
        await updateDoc(doc(db, "users", user.uid), { displayName: newName });
        displayNickname.innerText = newName;
        document.getElementById('nickname-modal').classList.add('hidden');
    }
};

// 데일리 리워드
function checkDailyReward() {
    const today = new Date().toDateString();
    if (lastClaimDate !== today) {
        balance += 500;
        lastClaimDate = today;
        updateDoc(doc(db, "users", user.uid), { money: balance, lastClaimDate: today });
        alert("Daily Reward! 500G added.");
        updateUI();
    }
}

// --- 2. 게임 UI 및 베팅 통합 로직 ---
function updateUI() {
    document.getElementById('balance').innerText = balance.toLocaleString();
    document.getElementById('lobby-balance').innerText = balance.toLocaleString();
    document.getElementById('current-bet-display').innerText = (isMultiplayer ? myMultiBet : currentBet).toLocaleString();
    if (!isMultiplayer) {
        document.getElementById('player-score').innerText = calculateScore(playerHand) || "";
        
        // 수정: 게임 중(isGameOver가 false)일 때는 딜러 점수를 숨깁니다.
        const dealerScoreEl = document.getElementById('dealer-score');
        if (isGameOver) {
            dealerScoreEl.innerText = calculateScore(dealerHand) || "";
        } else {
            dealerScoreEl.innerText = "?"; // 게임 중에는 물음표로 표시
        }
    }
}

// 1. adjustBet 함수 보강 (약 100라인 근처)
window.adjustBet = async (amount) => {
    if (!isGameOver && !isMultiplayer) return;
    
    const numericAmount = Number(amount);
    if (balance >= numericAmount) {
        balance -= numericAmount;
        if (isMultiplayer) {
            myMultiBet += numericAmount;
            // 로비 내 점수 실시간 텍스트 업데이트
            const display = document.getElementById('multi-bet-display');
            if(display) display.innerText = myMultiBet.toLocaleString() + "G";
            await syncMultiBet(); // DB 동기화
        } else {
            currentBet += numericAmount;
        }
        updateUI();
    } else {
        alert("Not enough gold!");
    }
};

// 2. 멀티플레이어 베팅 초기화 함수 추가
window.resetMultiBet = async () => {
    if (!isMultiplayer) return;
    balance += myMultiBet; // 베팅했던 돈을 다시 잔액으로
    myMultiBet = 0;
    const display = document.getElementById('multi-bet-display');
    if(display) display.innerText = "0G";
    await syncMultiBet();
    updateUI();
};

async function syncMultiBet() {
    if (!currentRoomId) return;
    const roomRef = doc(db, "rooms", currentRoomId);
    const snap = await getDoc(roomRef);
    const updatedPlayers = snap.data().players.map(p => 
        p.uid === user.uid ? { ...p, bet: myMultiBet, money: balance } : p
    );
    await updateDoc(roomRef, { players: updatedPlayers });
}

// --- 3. 싱글 플레이 로직 ---
dealBtn.onclick = async () => {
    if (currentBet <= 0) return alert("Bet first!");
    isGameOver = false;
    document.getElementById('bet-controls').classList.add('hidden');
    createDeck(); // 덱 생성 및 셔플
    playerHand = [deck.pop(), deck.pop()];
    dealerHand = [deck.pop(), deck.pop()];
    
    document.getElementById('player-cards').innerHTML = '';
    document.getElementById('dealer-cards').innerHTML = '';
    
    playerHand.forEach(c => document.getElementById('player-cards').appendChild(createCardElement(c)));
    dealerHand.forEach((c, i) => document.getElementById('dealer-cards').appendChild(createCardElement(c, i === 1)));
    
    reorderCards('player-cards');
    reorderCards('dealer-cards');
    
    actionBtns.classList.remove('hidden');
    messageEl.innerText = "Hit or Stay?";
    updateUI();
};

async function runSingleDealerAI() {
    const hiddenCard = document.getElementById('dealer-hidden-card');
    if (hiddenCard) hiddenCard.querySelector('.card-inner').classList.add('flipped');

    while (calculateScore(dealerHand) < 17) {
        dealerHand.push(deck.pop());
        document.getElementById('dealer-cards').appendChild(createCardElement(dealerHand[dealerHand.length - 1]));
        reorderCards('dealer-cards');
        await sleep(500);
    }

    const ps = calculateScore(playerHand), ds = calculateScore(dealerHand);
    if (ds > 21 || ps > ds) {
        messageEl.innerText = "You Win!";
        balance += currentBet * 2;
    } else if (ps === ds) {
        messageEl.innerText = "Push (Draw)";
        balance += currentBet;
    } else {
        messageEl.innerText = "Dealer Wins.";
    }
    
    isGameOver = true;
    updateUI();
    document.getElementById('bet-controls').classList.remove('hidden');
    await updateDoc(doc(db, "users", user.uid), { money: balance });
    currentBet = 0;
    updateUI();
}

// --- 4. 멀티플레이어 로직 (Firebase) ---
document.getElementById('multi-game-btn').onclick = () => {
    myMultiBet = 0;
    multiLobbyModal.classList.remove('hidden');
    joinMultiRoom();
};

async function joinMultiRoom() {
    const q = query(collection(db, "rooms"), where("status", "==", "waiting"), limit(1));
    const snap = await getDocs(q);
    const me = { uid: user.uid, name: displayNickname.innerText, money: balance, bet: 0, hand: [], status: "thinking" };

    if (snap.empty) {
        const res = await addDoc(collection(db, "rooms"), {
            status: "waiting", players: [me], turnIndex: 0, dealerHand: [], deck: []
        });
        currentRoomId = res.id;
    } else {
        currentRoomId = snap.docs[0].id;
        await updateDoc(doc(db, "rooms", currentRoomId), { players: arrayUnion(me) });
    }
    listenToRoom(currentRoomId);
}

function listenToRoom(roomId) {
    onSnapshot(doc(db, "rooms", roomId), (snap) => {
        const data = snap.data();
        if (!data) return;
        players = data.players;

        if (data.status === "waiting") {
            playerListMulti.innerHTML = players.map(p => `<div>${p.name} (Bet: ${p.bet})</div>`).join('');
            // 방장(players[0])이고, 인원이 2명 이상일 때만 버튼을 보여줍니다.
            if (players[0].uid === user.uid && players.length >= 2) {
                multiStartBtn.classList.remove('hidden');
                multiStartBtn.innerText = `Start Game (${players.length}/3)`; // 현재 인원 표시 서비스
            } else {
                    multiStartBtn.classList.add('hidden');
            }
        } else if (data.status === "playing" || data.status === "finished") {
            isMultiplayer = true;
            lobbySection.classList.add('hidden');
            multiLobbyModal.classList.add('hidden');
            board.classList.remove('hidden');
            renderMultiTable(data);
        }
    });
}

function renderMultiTable(data) {
    multiContainer.innerHTML = '';
    multiContainer.classList.remove('hidden');
    document.getElementById('single-player-area').classList.add('hidden');
    document.getElementById('bet-controls').classList.toggle('hidden', data.status === "playing");

    data.players.forEach((p, i) => {
        const isMyTurn = data.turnIndex === i && data.status === "playing";
        const slot = document.createElement('div');
        slot.className = `player-slot ${isMyTurn ? 'active-turn' : ''}`;
        
        // 기본 위치 및 각도 설정 (부채꼴 레이아웃 유지)
        let baseTransform = "";
        if (i === 0) baseTransform = "rotate(-15deg)";
        else if (i === 1) baseTransform = "translateX(-50%)";
        else if (i === 2) baseTransform = "rotate(15deg)";

        // [중요] 내 차례일 때 기존 각도를 유지하면서 크기만 키움
        if (isMyTurn) {
            slot.style.transform = `${baseTransform} scale(1.1)`;
        } else {
            slot.style.transform = baseTransform;
        }
        
        slot.innerHTML = `
            <div id="cards-p-${i}" class="card-row" style="height:80px;"></div>
            <p class="score-text">${calculateScore(p.hand)}</p>
            <div style="font-size:0.7rem;">${p.name}<br>🎯${p.bet}</div>
            <div class="status-tag" style="background:${getStatusColor(p.status)}">${p.status}</div>
        `;
        multiContainer.appendChild(slot);
        p.hand.forEach(c => document.getElementById(`cards-p-${i}`).appendChild(createCardElement(c)));
        reorderCards(`cards-p-${i}`);

        if (p.uid === user.uid && isMyTurn) actionBtns.classList.remove('hidden');
        else if (p.uid === user.uid) actionBtns.classList.add('hidden');
    });

    const dCards = document.getElementById('dealer-cards');
    dCards.innerHTML = '';

    const dScoreText = data.status === "playing" ? "?" : calculateScore(data.dealerHand);
document.getElementById('dealer-score').innerText = dScoreText;

    data.dealerHand.forEach((c, i) => dCards.appendChild(createCardElement(c, data.status === "playing" && i === 1)));
    reorderCards('dealer-cards');
}

// --- 5. 공통 버튼 액션 (Hit/Stay) ---
document.getElementById('hit-btn').onclick = async () => {
    if (isMultiplayer) {
        const roomRef = doc(db, "rooms", currentRoomId);
        const snap = await getDoc(roomRef);
        const data = snap.data();
        const idx = data.turnIndex;
        if (data.players[idx].uid !== user.uid) return;

        let up = [...data.players], dk = [...data.deck];
        up[idx].hand.push(dk.pop());
        if (calculateScore(up[idx].hand) > 21) {
            up[idx].status = "bust";
            await updateDoc(roomRef, { players: up, deck: dk, turnIndex: idx + 1 });
        } else {
            await updateDoc(roomRef, { players: up, deck: dk });
        }
    } else {
        playerHand.push(deck.pop());
        document.getElementById('player-cards').appendChild(createCardElement(playerHand[playerHand.length - 1]));
        reorderCards('player-cards');
        if (calculateScore(playerHand) > 21) {
            messageEl.innerText = "Bust! You Lose.";
            endSingleGame();
        }
        updateUI();
    }
};

document.getElementById('stay-btn').onclick = async () => {
    if (isMultiplayer) {
        const roomRef = doc(db, "rooms", currentRoomId);
        const snap = await getDoc(roomRef);
        const idx = snap.data().turnIndex;
        if (snap.data().players[idx].uid !== user.uid) return;
        let up = [...snap.data().players];
        up[idx].status = "stay";
        await updateDoc(roomRef, { players: up, turnIndex: idx + 1 });
    } else {
        actionBtns.classList.add('hidden');
        runSingleDealerAI();
    }
};

// --- 6. 유틸리티 함수들 ---
function createDeck() {
    const suits = ['♠', '♥', '♦', '♣'], ranks = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
    deck = [];
    for (let s of suits) for (let r of ranks) deck.push({ s, r });
    deck.sort(() => Math.random() - 0.5);
}

function calculateScore(hand) {
    if (!hand || hand.length === 0) return 0;
    let s = 0, a = 0;
    hand.forEach(c => {
        if (c.r === 'A') { s += 11; a++; }
        else if (['J', 'Q', 'K'].includes(c.r)) s += 10;
        else s += parseInt(c.r);
    });
    while (s > 21 && a > 0) { s -= 10; a--; }
    return s;
}

function createCardElement(card, isHidden) {
    const div = document.createElement('div');
    div.className = 'card';
    if (isHidden) div.id = 'dealer-hidden-card';
    div.innerHTML = `<div class="card-inner ${isHidden ? '' : 'flipped'}">
        <div class="card-front" style="color:${(card.s === '♥' || card.s === '♦') ? 'var(--rose-gold)' : 'var(--deep-rose)'}">
            <div style="position:absolute;top:2px;left:2px;font-size:0.6rem;">${card.r}${card.s}</div>${card.s}
        </div><div class="card-back"></div></div>`;
    return div;
}

function reorderCards(id) {
    const c = document.getElementById(id).children;
    for (let i = 0; i < c.length; i++) {
        c[i].style.position = 'absolute';
        c[i].style.left = `calc(50% - 30px + ${(i - (c.length - 1) / 2) * 20}px)`;
    }
}

function getStatusColor(s) {
    if (s === 'win') return '#4caf50';
    if (s === 'bust' || s === 'lose') return '#f44336';
    return 'var(--rose-gold)';
}

function endSingleGame() {
    isGameOver = true;
    actionBtns.classList.add('hidden');
    document.getElementById('bet-controls').classList.remove('hidden');
    currentBet = 0;
}

// 랭킹 시스템 (Hall of Fame)
document.getElementById('rank-btn').onclick = async () => {
    const q = query(collection(db, "users"), orderBy("money", "desc"), limit(10));
    const snap = await getDocs(q);
    const list = document.getElementById('rank-list');
    list.innerHTML = '';
    
    snap.forEach((doc, i) => {
        const d = doc.data();
        
        // [중요] d.money가 유효하지 않을 경우를 대비해 Number() 변환 및 기본값 0 설정
        const safeMoney = Number(d.money) || 0; 
        const name = d.displayName || 'Guest';

        list.innerHTML += `<li>${i + 1}. ${name} - ${safeMoney.toLocaleString()}G</li>`;
    });
    document.getElementById('rank-modal').classList.remove('hidden');
};

document.getElementById('close-rank').onclick = () => document.getElementById('rank-modal').classList.add('hidden');

// 로비로 돌아가기
function exitToLobby() {
    isMultiplayer = false;
    currentRoomId = null;
    board.classList.add('hidden');
    lobbySection.classList.remove('hidden');
    multiLobbyModal.classList.add('hidden');
}

document.getElementById('back-to-lobby').onclick = exitToLobby;
loginBtn.onclick = () => signInWithPopup(auth, provider);

// 멀티플레이 시작 (방장전용)
multiStartBtn.onclick = async () => {
    if (players.every(p => p.bet > 0)) {
        createDeck();
        const dHand = [deck.pop(), deck.pop()];
        const updatedPlayers = players.map(p => ({ ...p, hand: [deck.pop(), deck.pop()], status: "thinking" }));
        await updateDoc(doc(db, "rooms", currentRoomId), {
            status: "playing", deck: deck, dealerHand: dHand, players: updatedPlayers, turnIndex: 0
        });
    } else {
        alert("Wait for all players to bet!");
    }
};

leaveMultiBtn.onclick = async () => {
    if (currentRoomId) {
        const roomRef = doc(db, "rooms", currentRoomId);
        const snap = await getDoc(roomRef);
        const leftPlayers = snap.data().players.filter(p => p.uid !== user.uid);
        if (leftPlayers.length === 0) await deleteDoc(roomRef);
        else await updateDoc(roomRef, { players: leftPlayers });
    }
    exitToLobby();
};

document.getElementById('start-game-btn').onclick = () => {
    isMultiplayer = false;
    lobbySection.classList.add('hidden');
    board.classList.remove('hidden');
    document.getElementById('single-player-area').classList.remove('hidden');
    document.getElementById('multi-player-container').classList.add('hidden');
    isGameOver = true;
    updateUI();
};