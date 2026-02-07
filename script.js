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
let players = []; 
let balance = 0;
let currentBet = 0; // 싱글용 베팅
let myMultiBet = 0; // 멀티용 베팅
let lastClaimDate = "";
let deck = [], playerHand = [], dealerHand = [];
let isGameOver = true;
let currentRoomId = null;
let isMultiplayer = false;

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// UI 요소
const loginBtn = document.getElementById('login-btn');
const authSection = document.getElementById('auth-section');
const lobbySection = document.getElementById('lobby-section');
const board = document.getElementById('board');
const messageEl = document.getElementById('message');
const dealBtn = document.getElementById('deal-btn');
const actionBtns = document.getElementById('action-btns');
const rankBtn = document.getElementById('rank-btn');
const rankModal = document.getElementById('rank-modal');
const closeRank = document.getElementById('close-rank');
const rankList = document.getElementById('rank-list');
const nicknameModal = document.getElementById('nickname-modal');
const nicknameInput = document.getElementById('nickname-input');
const displayNickname = document.getElementById('display-nickname');
const editNicknameBtn = document.getElementById('edit-nickname-btn');
const saveNicknameBtn = document.getElementById('save-nickname');
const closeNicknameBtn = document.getElementById('close-nickname');
const multiGameBtn = document.getElementById('multi-game-btn');
const multiLobbyModal = document.getElementById('multi-lobby-modal');
const playerListMulti = document.getElementById('player-list-multi');
const multiContainer = document.getElementById('multi-player-container');
const multiStartBtn = document.getElementById('multi-start-btn');
const leaveMultiBtn = document.getElementById('leave-multi');

// --- [공통] 초기 세팅 및 유틸리티 ---

onAuthStateChanged(auth, async (u) => {
    if (u) { user = u; loadUserData(); }
});

async function loadUserData() {
    const userRef = doc(db, "users", user.uid);
    const snap = await getDoc(userRef);
    let nickname = "";

    if (snap.exists()) {
        const data = snap.data();
        balance = data.money || 0;
        lastClaimDate = data.lastClaimDate || "";
        nickname = data.displayName || "";
    } else {
        balance = 1000;
        await setDoc(userRef, { money: balance, lastClaimDate: "", displayName: "" });
    }

    if (!nickname) nicknameModal.classList.remove('hidden');
    else displayNickname.innerText = nickname;

    authSection.classList.add('hidden');
    lobbySection.classList.remove('hidden');
    board.classList.add('hidden');
    checkDailyReward();
    updateUI();
}

function updateUI() {
    document.getElementById('balance').innerText = balance.toLocaleString();
    document.getElementById('lobby-balance').innerText = balance.toLocaleString();
    document.getElementById('current-bet-display').innerText = isMultiplayer ? myMultiBet.toLocaleString() : currentBet.toLocaleString();
    document.getElementById('player-score').innerText = isMultiplayer ? "" : calculateScore(playerHand);
    document.getElementById('dealer-score').innerText = (isGameOver || isMultiplayer) ? "" : "?";
}

function calculateScore(hand) {
    if (!hand || hand.length === 0) return 0;
    let score = 0, aces = 0;
    for (let c of hand) {
        if (c.r === 'A') { score += 11; aces++; }
        else if (['J', 'Q', 'K'].includes(c.r)) score += 10;
        else score += parseInt(c.r);
    }
    while (score > 21 && aces > 0) { score -= 10; aces--; }
    return score;
}

window.adjustBet = (amount) => {
    if (!isGameOver && !isMultiplayer) return;
    if (balance >= amount) {
        balance -= amount;
        if (isMultiplayer) {
            myMultiBet += Number(amount);
            updateMultiBetInDB();
        } else {
            currentBet += Number(amount);
        }
        updateUI();
    }
};

// --- [멀티플레이] 핵심 로직 ---

async function updateMultiBetInDB() {
    if (!currentRoomId || !user) return;
    const roomRef = doc(db, "rooms", currentRoomId);
    const snap = await getDoc(roomRef);
    const data = snap.data();
    const updatedPlayers = data.players.map(p => p.uid === user.uid ? { ...p, bet: myMultiBet, money: balance } : p);
    await updateDoc(roomRef, { players: updatedPlayers });
}

multiGameBtn.onclick = async () => {
    myMultiBet = 0;
    multiLobbyModal.classList.remove('hidden');
    joinOrCreateRoom();
};

async function joinOrCreateRoom() {
    const roomsRef = collection(db, "rooms");
    const q = query(roomsRef, where("status", "==", "waiting"), limit(1));
    const snap = await getDocs(q);

    let roomId;
    const initialPlayer = { 
        uid: user.uid, 
        name: displayNickname.innerText, 
        money: balance,
        bet: 0,
        hand: [], 
        status: "thinking" 
    };

    if (snap.empty) {
        const newRoom = await addDoc(roomsRef, {
            status: "waiting",
            players: [initialPlayer],
            turnIndex: 0,
            deck: [], 
            dealerHand: [],
            createdAt: serverTimestamp()
        });
        roomId = newRoom.id;
    } else {
        roomId = snap.docs[0].id;
        await updateDoc(doc(db, "rooms", roomId), {
            players: arrayUnion(initialPlayer)
        });
    }
    currentRoomId = roomId;
    listenToRoom(roomId);
}

function listenToRoom(roomId) {
    const roomRef = doc(db, "rooms", roomId);
    onSnapshot(roomRef, async (docSnap) => {
        const data = docSnap.data();
        if (!data) { exitToLobby(); return; }
        
        players = data.players || [];
        updateHostUI();

        if (data.status === "playing" || data.status === "finished") {
            lobbySection.classList.add('hidden');
            multiLobbyModal.classList.add('hidden'); 
            board.classList.remove('hidden');
            isMultiplayer = true;
            renderMultiTable(data);
            
            // 방장이 딜러 AI 실행
            if (data.status === "playing" && data.turnIndex >= players.length && user.uid === players[0].uid) {
                await runDealerAI(roomId, data);
            }
        } else if (data.status === "waiting") {
            updateLobbyUI(players);
        }
    });
}

function updateHostUI() {
    if (!user || players.length === 0 || !multiStartBtn) return;
    const isHost = players[0].uid === user.uid;
    if (isHost && players.length >= 1) multiStartBtn.classList.remove('hidden');
    else multiStartBtn.classList.add('hidden');
}

multiStartBtn.onclick = async () => {
    const allBet = players.every(p => p.bet > 0);
    if (!allBet) return alert("All players must bet!");

    const roomRef = doc(db, "rooms", currentRoomId);
    const newDeck = generateDeckArray();
    const dealerHand = [newDeck.pop(), newDeck.pop()];
    const updatedPlayers = players.map(p => ({ ...p, hand: [newDeck.pop(), newDeck.pop()], status: "thinking" }));

    await updateDoc(roomRef, {
        status: "playing",
        deck: newDeck,
        dealerHand: dealerHand,
        players: updatedPlayers,
        turnIndex: 0
    });
};

function renderMultiTable(data) {
    multiContainer.innerHTML = ''; 
    multiContainer.classList.remove('hidden');
    document.getElementById('single-player-area').classList.add('hidden');
    document.getElementById('bet-controls').classList.toggle('hidden', data.status === "playing");

    data.players.forEach((p, index) => {
        const isMyTurn = data.turnIndex === index && data.status === "playing";
        const isMe = p.uid === user.uid;
        const slot = document.createElement('div');
        slot.className = `player-slot ${isMyTurn ? 'active-turn' : ''}`;
        
        // 부채꼴 위치 계산 (nth-child 스타일 대신 직접 부여 가능)
        slot.innerHTML = `
            <div id="cards-player-${index}" class="card-row" style="height:80px;"></div>
            <p class="score-text">${calculateScore(p.hand)}</p>
            <h3 class="role-title" style="font-size:0.8rem; margin:0;">${p.name}</h3>
            <div style="font-size:0.7rem; color:var(--deep-rose);">💰${Number(p.money).toLocaleString()} | 🎯${Number(p.bet).toLocaleString()}</div>
            <div class="status-tag" style="background:${getStatusColor(p.status)}">${p.status.toUpperCase()}</div>
        `;
        
        multiContainer.appendChild(slot);
        p.hand.forEach(card => document.getElementById(`cards-player-${index}`).appendChild(createCardElement(card)));
        reorderCardsMulti(`cards-player-${index}`);

        if (isMe && isMyTurn && p.status === "thinking") actionBtns.classList.remove('hidden');
        else if (isMe) actionBtns.classList.add('hidden');
    });

    const dCards = document.getElementById('dealer-cards');
    dCards.innerHTML = '';
    data.dealerHand.forEach((card, i) => {
        const isHidden = (data.status === "playing" && i === 1);
        dCards.appendChild(createCardElement(card, isHidden));
    });
    reorderCards('dealer-cards');
    document.getElementById('dealer-score').innerText = data.status === "finished" ? calculateScore(data.dealerHand) : "?";

    // 방장 제어 버튼 (게임 종료 시)
    if (data.status === "finished" && data.players[0].uid === user.uid) {
        messageEl.innerHTML = `
            <button id="rematch-btn" class="coquette-btn small main">Next Round</button>
            <button id="close-table-btn" class="coquette-btn small">Close Table</button>
        `;
        document.getElementById('rematch-btn').onclick = () => multiStartBtn.click();
        document.getElementById('close-table-btn').onclick = async () => await updateDoc(doc(db, "rooms", currentRoomId), { status: "closed" });
    }
}

async function runDealerAI(roomId, data) {
    let dHand = [...data.dealerHand];
    let dDeck = [...data.deck];
    while (calculateScore(dHand) < 17) { dHand.push(dDeck.pop()); await sleep(600); }
    
    const finalPlayers = data.players.map(p => {
        const pScore = calculateScore(p.hand);
        const dScore = calculateScore(dHand);
        let res = "lose", factor = 0;
        if (p.status === "bust") { res = "bust"; factor = 0; }
        else if (dScore > 21 || pScore > dScore) { res = "win"; factor = 2; }
        else if (pScore === dScore) { res = "push"; factor = 1; }
        return { ...p, status: res, winAmount: p.bet * factor };
    });

    await updateDoc(doc(db, "rooms", roomId), { 
        dealerHand: dHand, players: finalPlayers, status: "finished" 
    });

    // 각자 브라우저에서 돈 정산
    const me = finalPlayers.find(p => p.uid === user.uid);
    if (me && me.winAmount > 0) {
        balance += me.winAmount;
        await updateDoc(doc(db, "users", user.uid), { money: balance });
        updateUI();
    }
}

// --- [멀티플레이] 버튼 액션 ---

document.getElementById('hit-btn').onclick = async () => {
    if (!isMultiplayer) { /* 기존 싱글 로직 */ return; }
    const roomRef = doc(db, "rooms", currentRoomId);
    const snap = await getDoc(roomRef);
    const data = snap.data();
    const myIdx = data.turnIndex;
    if (data.players[myIdx].uid !== user.uid) return;

    let updatedPlayers = [...data.players];
    updatedPlayers[myIdx].hand.push(data.deck.pop());
    
    if (calculateScore(updatedPlayers[myIdx].hand) > 21) {
        updatedPlayers[myIdx].status = "bust";
        await updateDoc(roomRef, { players: updatedPlayers, turnIndex: myIdx + 1 });
    } else {
        await updateDoc(roomRef, { players: updatedPlayers, deck: data.deck });
    }
};

document.getElementById('stay-btn').onclick = async () => {
    if (!isMultiplayer) { /* 기존 싱글 로직 */ return; }
    const roomRef = doc(db, "rooms", currentRoomId);
    const snap = await getDoc(roomRef);
    const myIdx = snap.data().turnIndex;
    if (snap.data().players[myIdx].uid !== user.uid) return;

    let updatedPlayers = [...snap.data().players];
    updatedPlayers[myIdx].status = "stay";
    await updateDoc(roomRef, { players: updatedPlayers, turnIndex: myIdx + 1 });
};

leaveMultiBtn.onclick = async () => {
    if (!currentRoomId) return;
    const roomRef = doc(db, "rooms", currentRoomId);
    const snap = await getDoc(roomRef);
    if (snap.exists()) {
        const updated = snap.data().players.filter(p => p.uid !== user.uid);
        if (updated.length === 0) await deleteDoc(roomRef);
        else await updateDoc(roomRef, { players: updated });
    }
    exitToLobby();
};

function exitToLobby() {
    isMultiplayer = false;
    currentRoomId = null;
    board.classList.add('hidden');
    lobbySection.classList.remove('hidden');
    multiLobbyModal.classList.add('hidden');
    updateUI();
}

// --- [싱글플레이 및 기타] 기존 기능 보존 ---

dealBtn.onclick = async () => {
    if (currentBet <= 0) return alert("Please place a bet!");
    isGameOver = false;
    document.getElementById('bet-controls').classList.add('hidden');
    createDeck();
    playerHand = [deck.pop(), deck.pop()];
    dealerHand = [deck.pop(), deck.pop()];
    document.getElementById('player-cards').innerHTML = ''; 
    document.getElementById('dealer-cards').innerHTML = '';
    
    // 카드 배분 애니메이션
    for(let i=0; i<2; i++) {
        document.getElementById('player-cards').appendChild(createCardElement(playerHand[i]));
        reorderCards('player-cards');
        await sleep(300);
        document.getElementById('dealer-cards').appendChild(createCardElement(dealerHand[i], i===1));
        reorderCards('dealer-cards');
        await sleep(300);
    }
    updateUI();
    actionBtns.classList.remove('hidden');
    messageEl.innerText = "Hit or Stay?";
};

// ... (랭킹, 닉네임, 데일리 리워드 등 나머지 코드는 기존과 동일) ...

function getStatusColor(status) {
    if (status === 'win') return '#4caf50';
    if (status === 'bust' || status === 'lose') return '#f44336';
    if (status === 'push') return '#ff9800';
    return 'var(--rose-gold)';
}

function generateDeckArray() {
    const suits = ['♠', '♥', '♦', '♣'];
    const ranks = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
    let d = [];
    for (let s of suits) for (let r of ranks) d.push({ s, r });
    return d.sort(() => Math.random() - 0.5);
}

function createCardElement(card, isHidden = false) {
    const container = document.createElement('div');
    container.className = 'card'; 
    const inner = document.createElement('div');
    inner.className = 'card-inner';
    if (isHidden) container.id = 'dealer-hidden-card';
    const front = document.createElement('div');
    front.className = 'card-front';
    front.style.color = (card.s === '♥' || card.s === '♦') ? 'var(--rose-gold)' : 'var(--deep-rose)';
    front.innerHTML = `<div style="position:absolute; top:2px; left:2px; font-size:0.6rem;">${card.r}${card.s}</div><div style="font-size:1.5rem;">${card.s}</div>`;
    const back = document.createElement('div'); back.className = 'card-back';
    inner.appendChild(front); inner.appendChild(back);
    container.appendChild(inner);
    if (!isHidden) setTimeout(() => inner.classList.add('flipped'), 50);
    return container;
}

function reorderCards(id) {
    const c = document.getElementById(id).children;
    for (let i = 0; i < c.length; i++) {
        c[i].style.position = 'absolute';
        c[i].style.left = `calc(50% - 30px + ${(i - (c.length - 1) / 2) * 20}px)`;
        c[i].style.zIndex = i;
    }
}

function reorderCardsMulti(id) {
    const c = document.getElementById(id).children;
    for (let i = 0; i < c.length; i++) {
        c[i].style.position = 'absolute';
        c[i].style.left = `calc(50% - 25px + ${(i - (c.length - 1) / 2) * 15}px)`;
        c[i].style.zIndex = i;
    }
}

// 랭킹 시스템 (NaN 방지 포함)
rankBtn.onclick = () => { rankModal.classList.remove('hidden'); loadRankings(); };
closeRank.onclick = () => rankModal.classList.add('hidden');
function loadRankings() {
    const q = query(collection(db, "users"), orderBy("money", "desc"), limit(10));
    onSnapshot(q, (snap) => {
        rankList.innerHTML = '';
        snap.forEach((doc, i) => {
            const data = doc.data();
            const li = document.createElement('li');
            li.innerHTML = `<span><strong>${i+1}.</strong> ${data.displayName || "Guest"}</span><span>${(Number(data.money)||0).toLocaleString()} G</span>`;
            rankList.appendChild(li);
        });
    });
}

// 초기 싱글 게임 리셋
function resetSingleGame() {
    isGameOver = true; playerHand = []; dealerHand = []; currentBet = 0;
    document.getElementById('player-cards').innerHTML = '';
    document.getElementById('dealer-cards').innerHTML = '';
    updateUI();
}

document.getElementById('start-game-btn').onclick = () => {
    isMultiplayer = false;
    lobbySection.classList.add('hidden');
    board.classList.remove('hidden');
    document.getElementById('single-player-area').classList.remove('hidden');
    document.getElementById('multi-player-container').classList.add('hidden');
    resetSingleGame(); 
};

document.getElementById('back-to-lobby').onclick = () => exitToLobby();

function createDeck() {
    const suits = ['♠', '♥', '♦', '♣'];
    const ranks = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
    deck = [];
    for (let s of suits) for (let r of ranks) deck.push({ s, r });
    deck.sort(() => Math.random() - 0.5);
}

function updateLobbyUI(list) {
    playerListMulti.innerHTML = list.map(p => 
        `<div style="padding:10px; border-bottom:1px solid #eee; display:flex; justify-content:space-between;">
            <span>${p.name} (${(Number(p.money)||0).toLocaleString()}G)</span>
            <span style="color:var(--rose-gold);">${p.uid === user.uid ? "● You" : "● Joined"}</span>
        </div>`).join('');
}