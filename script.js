import { 
    initializeApp 
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import { 
    getAuth, GoogleAuthProvider, signInWithPopup, onAuthStateChanged 
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import { 
    getFirestore, doc, getDoc, setDoc, updateDoc, collection, query, orderBy, 
    limit, onSnapshot, where, addDoc, serverTimestamp, arrayUnion, getDocs 
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

// --- [수정] 변수 선언 순서 조정 (ReferenceError 방지) ---
let user = null;
let players = []; // players를 먼저 선언
let balance = 0;
let currentBet = 0;
let lastClaimDate = "";
let deck = [], playerHand = [], dealerHand = [];
let isGameOver = true;
let currentRoomId = null;
let isMultiplayer = false;

const startBtn = document.getElementById('start-game-btn');
// -------------------------------------------------------

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

// 닉네임 관련 UI 요소
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

// --- [수정] 방장 체크 함수화 ---
function updateHostUI() {
    if (!user || players.length === 0 || !startBtn) return;
    // 첫 번째 플레이어가 본인인지 확인
    const isHost = players[0].uid === user.uid;
    if (isHost && players.length >= 2) {
        startBtn.classList.remove('hidden');
    } else {
        startBtn.classList.add('hidden');
    }
}

document.getElementById('start-game-btn').onclick = async () => {
    if (!currentRoomId) return;
    
    const roomRef = doc(db, "rooms", currentRoomId);
    
    createDeck(); 
    
    await updateDoc(roomRef, {
        status: "playing",
        deck: deck, 
        turnIndex: 0 
    });
};

multiGameBtn.onclick = async () => {
    multiLobbyModal.classList.remove('hidden');
    joinOrCreateRoom();
};

async function joinOrCreateRoom() {
    const roomsRef = collection(db, "rooms");
    const q = query(roomsRef, where("status", "==", "waiting"), limit(1));
    const querySnapshot = await getDocs(q);

    let roomId;
    if (querySnapshot.empty) {
        const newRoom = await addDoc(roomsRef, {
            status: "waiting",
            players: [{ 
                uid: user.uid, 
                name: displayNickname.innerText, 
                isReady: false, 
                hand: [], 
                status: "thinking" 
            }],
            turnIndex: 0,
            deck: generateDeckArray(), 
            dealerHand: [],
            createdAt: serverTimestamp()
        });
        roomId = newRoom.id;
    } else {
        roomId = querySnapshot.docs[0].id;
        await updateDoc(doc(db, "rooms", roomId), {
            players: arrayUnion({ 
                uid: user.uid, 
                name: displayNickname.innerText, 
                isReady: false, 
                hand: [], 
                status: "thinking" 
            })
        });
    }
    currentRoomId = roomId;
    listenToRoom(roomId);
}

function generateDeckArray() {
    const suits = ['♠', '♥', '♦', '♣'];
    const ranks = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
    let newDeck = [];
    for (let s of suits) for (let r of ranks) newDeck.push({ s, r });
    return newDeck.sort(() => Math.random() - 0.5);
}

function renderMultiTable(data) {
    multiContainer.innerHTML = ''; 
    
    data.players.forEach((p, index) => {
        const isMyTurn = data.turnIndex === index;
        const isMe = p.uid === user.uid;
        
        const slot = document.createElement('div');
        slot.className = `player-slot ${isMyTurn ? 'active-turn' : ''}`;
        
        slot.innerHTML = `
            <div id="cards-player-${index}" class="card-row"></div>
            <p class="score-text">${calculateScore(p.hand)}</p>
            <h3 class="role-title" style="font-size:1rem;">${p.name}${isMe ? ' (You)' : ''}</h3>
            <div class="status-tag">${p.status.toUpperCase()}</div>
        `;
        
        multiContainer.appendChild(slot);
        
        const cardRow = document.getElementById(`cards-player-${index}`);
        p.hand.forEach(card => {
            cardRow.appendChild(createCardElement(card));
        });
        reorderCards(`cards-player-${index}`);

        if (isMe && isMyTurn && p.status === "thinking" && data.status === "playing") {
            actionBtns.classList.remove('hidden');
            messageEl.innerText = "Your Turn! Hit or Stay?";
        } else if (isMe && isMyTurn && p.status !== "thinking") {
            actionBtns.classList.add('hidden');
        }
    });

    const dCards = document.getElementById('dealer-cards');
    dCards.innerHTML = '';
    data.dealerHand.forEach((card, i) => {
        const isHidden = (data.status === "playing" && i === 1);
        dCards.appendChild(createCardElement(card, isHidden));
    });
    reorderCards('dealer-cards');
    
    if (data.turnIndex >= data.players.length && data.status === "playing") {
        if (user.uid === data.players[0].uid) {
            runDealerAI(currentRoomId, data);
        }
    }
}

function updateLobbyUI(playersList) {
    playerListMulti.innerHTML = playersList.map(p => 
        `<div style="padding:10px; border-bottom:1px solid #eee; display:flex; justify-content:space-between; font-family:'Cormorant Garamond', serif;">
            <span>${p.name}</span>
            <span style="color: var(--rose-gold);">${p.uid === user.uid ? "● You" : "● Joined"}</span>
        </div>`
    ).join('');
}

function listenToRoom(roomId) {
    const roomRef = doc(db, "rooms", roomId);
    onSnapshot(roomRef, (docSnap) => {
        const roomData = docSnap.data();
        if (!roomData) return;
        
        // --- [수정] 전역 변수 players 업데이트 및 방장 UI 체크 ---
        players = roomData.players || [];
        updateHostUI();
        // -----------------------------------------------------

        if (roomData.status === "playing") {
            lobbySection.classList.add('hidden');
            multiLobbyModal.classList.add('hidden'); // 모달 닫기 추가
            board.classList.remove('hidden');
            isMultiplayer = true;
            renderMultiTable(roomData);
        } else {
            updateLobbyUI(players);
        }
    });
}

async function multiHit() {
    const roomRef = doc(db, "rooms", currentRoomId);
    const snap = await getDoc(roomRef);
    const data = snap.data();
    
    let updatedPlayers = [...data.players];
    const myIndex = data.turnIndex;
    const nextCard = data.deck.pop(); 
    
    updatedPlayers[myIndex].hand.push(nextCard);
    
    if (calculateScore(updatedPlayers[myIndex].hand) > 21) {
        updatedPlayers[myIndex].status = "bust";
        await updateDoc(roomRef, {
            players: updatedPlayers,
            deck: data.deck,
            turnIndex: data.turnIndex + 1
        });
    } else {
        await updateDoc(roomRef, {
            players: updatedPlayers,
            deck: data.deck
        });
    }
}

async function multiStay() {
    const roomRef = doc(db, "rooms", currentRoomId);
    const snap = await getDoc(roomRef);
    const data = snap.data();
    
    let updatedPlayers = [...data.players];
    updatedPlayers[data.turnIndex].status = "stay";
    
    await updateDoc(roomRef, {
        players: updatedPlayers,
        turnIndex: data.turnIndex + 1
    });
}

async function runDealerAI(roomId, data) {
    let dHand = [...data.dealerHand];
    let dDeck = [...data.deck];
    
    while (calculateScore(dHand) < 18) {
        dHand.push(dDeck.pop());
    }
    
    await updateDoc(doc(db, "rooms", roomId), {
        dealerHand: dHand,
        deck: dDeck,
        status: "finished"
    });
}

loginBtn.onclick = async () => {
    try {
        const result = await signInWithPopup(auth, provider);
        user = result.user;
        loadUserData();
    } catch (error) {
        alert("Login failed: " + error.message);
    }
};

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

    if (!nickname) {
        nicknameModal.classList.remove('hidden');
    } else {
        displayNickname.innerText = nickname;
    }

    authSection.classList.add('hidden');
    lobbySection.classList.remove('hidden');
    board.classList.add('hidden');
    checkDailyReward();
    updateUI();
}

saveNicknameBtn.onclick = async () => {
    const newName = nicknameInput.value.trim();
    if (!newName) return alert("Please enter a nickname.");
    if (newName.length > 10) return alert("Nickname is too long (max 10).");

    await updateDoc(doc(db, "users", user.uid), { displayName: newName });
    displayNickname.innerText = newName;
    nicknameModal.classList.add('hidden');
    alert("Nickname saved.");
};

editNicknameBtn.onclick = () => {
    nicknameInput.value = displayNickname.innerText;
    nicknameModal.classList.remove('hidden');
};

closeNicknameBtn.onclick = () => {
    if (displayNickname.innerText !== "Guest") {
        nicknameModal.classList.add('hidden');
    } else {
        alert("Please set a nickname first.");
    }
};

// 싱글 게임 시작 버튼
document.getElementById('start-game-btn').onclick = () => {
    if (currentRoomId) return; // 멀티플레이 중이면 무시
    isMultiplayer = false;
    lobbySection.classList.add('hidden');
    board.classList.remove('hidden');
    
    document.getElementById('single-player-area').classList.remove('hidden');
    document.getElementById('multi-player-container').classList.add('hidden');
    
    resetSingleGame(); 
};

document.getElementById('daily-reward-btn').onclick = async () => {
    const today = new Date().toISOString().split('T')[0];
    if (lastClaimDate === today) return;

    balance += 1000;
    lastClaimDate = today;
    updateUI();
    checkDailyReward();
    await updateDoc(doc(db, "users", user.uid), { money: balance, lastClaimDate: today });
    alert("Daily reward received (1,000 gold).");
};

function checkDailyReward() {
    const today = new Date().toISOString().split('T')[0];
    const btn = document.getElementById('daily-reward-btn');
    if (lastClaimDate === today) {
        btn.disabled = true;
        btn.innerText = "Claimed";
        btn.style.opacity = "0.5";
    }
}

document.getElementById('exchange-btn').onclick = () => alert("Shop coming soon.");

function createDeck() {
    const suits = ['♠', '♥', '♦', '♣'];
    const ranks = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
    deck = [];
    for (let s of suits) {
        for (let r of ranks) {
            deck.push({ s, r });
        }
    }
    deck.sort(() => Math.random() - 0.5);
}

function calculateScore(hand) {
    if (!hand) return 0;
    let score = 0;
    let aces = 0;
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
        balance = balance - amount;
        currentBet += Number(amount);
        updateUI();
    }
};

dealBtn.onclick = async () => {
    if (currentBet <= 0) return alert("Please place a bet!");
    isGameOver = false;

    document.getElementById('bet-controls').classList.add('hidden');
    
    createDeck();
    playerHand = [deck.pop(), deck.pop()];
    dealerHand = [deck.pop(), deck.pop()];

    document.getElementById('player-cards').innerHTML = ''; 
    document.getElementById('dealer-cards').innerHTML = '';

    document.getElementById('player-cards').appendChild(createCardElement(playerHand[0]));
    reorderCards('player-cards');
    await sleep(400);

    document.getElementById('dealer-cards').appendChild(createCardElement(dealerHand[0]));
    reorderCards('dealer-cards');
    await sleep(400);

    document.getElementById('player-cards').appendChild(createCardElement(playerHand[1]));
    reorderCards('player-cards');
    await sleep(400);

    document.getElementById('dealer-cards').appendChild(createCardElement(dealerHand[1], true));
    reorderCards('dealer-cards');

    updateUI();
    actionBtns.classList.remove('hidden');
    messageEl.innerText = "Hit or Stay?";
};

document.getElementById('hit-btn').onclick = async () => {
    if (isMultiplayer) {
        await multiHit();
    } else {
        if (isGameOver) return;
        const nextCard = deck.pop();
        playerHand.push(nextCard);
        document.getElementById('player-cards').appendChild(createCardElement(nextCard));
        reorderCards('player-cards');
        updateUI();
        
        if (calculateScore(playerHand) > 21) {
            await sleep(500);
            endGame('lose');
        }
    }
};

document.getElementById('all-in-btn').onclick = () => {
    if (!isGameOver) return; 
    
    if (balance > 0) {
        currentBet += balance; 
        balance = 0;           
        updateUI();
    } else {
        alert("You have no gold for an All-in bet.");
    }
};

document.getElementById('stay-btn').onclick = async () => {
    if (isMultiplayer) {
        await multiStay();
    } else {
        if (isGameOver) return;
        dealerTurn();
    }
};

async function dealerTurn() {
    actionBtns.classList.add('hidden');
    const hiddenCard = document.querySelector('#dealer-hidden-card .card-inner');
    if (hiddenCard) { hiddenCard.classList.add('flipped'); await sleep(800); }

    let dScore = calculateScore(dealerHand);
    while (dScore < 18) {
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
        msg = isBJ ? "Blackjack! You win." : "You win!";
    } else if (result === 'lose') {
        msg = calculateScore(playerHand) > 21 ? "Bust! You lose." : "Dealer wins.";
    } else {
        balance += currentBet;
        msg = "Push (Tie).";
    }
    
    currentBet = 0;
    messageEl.innerText = msg;
    actionBtns.classList.add('hidden');
    document.querySelector('.bet-controls').classList.remove('hidden');
    
    updateUI();
    if (user) await updateDoc(doc(db, "users", user.uid), { money: balance });
}

function updateUI() {
    document.getElementById('balance').innerText = balance.toLocaleString();
    document.getElementById('lobby-balance').innerText = balance.toLocaleString();
    document.getElementById('current-bet-display').innerText = currentBet.toLocaleString();
    document.getElementById('player-score').innerText = calculateScore(playerHand);
    if (isGameOver) {
        document.getElementById('dealer-score').innerText = calculateScore(dealerHand);
    } else {
        document.getElementById('dealer-score').innerText = "?";
    }
}

// --- [수정] 랭킹 시스템 NaN 및 스타일 보강 ---
rankBtn.onclick = () => {
    rankModal.classList.remove('hidden');
    loadRankings();
};

closeRank.onclick = () => rankModal.classList.add('hidden');

function loadRankings() {
    const q = query(collection(db, "users"), orderBy("money", "desc"), limit(10));
    onSnapshot(q, (snapshot) => {
        rankList.innerHTML = '';
        snapshot.forEach((doc, index) => {
            const data = doc.data();
            const li = document.createElement('li');
            
            // 데이터 타입 검증
            const displayMoney = Number(data.money) || 0;
            const nickname = data.displayName || "Guest";

            li.innerHTML = `
                <span style="font-weight:bold;">${index + 1}. ${nickname}</span>
                <span>${displayMoney.toLocaleString()} G</span>
            `;
            rankList.appendChild(li);
        });
    });
}
// ------------------------------------------------

function createCardElement(card, isHidden = false) {
    const container = document.createElement('div');
    container.className = 'card'; 
    
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
        symbolsGrid.innerHTML = `<div class="face-center" style="font-size: 2rem;">${card.s}</div>`;
    } else {
        const num = parseInt(card.r);
        const positions = getSymbolPositions(num);
        positions.forEach(pos => {
            const s = document.createElement('div');
            s.className = 'symbol';
            s.style.gridArea = pos;
            s.innerText = card.s;
            symbolsGrid.appendChild(s);
        });
    }

    front.innerHTML = `<div class="corner-wrapper top-left">${cornerTag}</div><div class="corner-wrapper bottom-right">${cornerTag}</div>`;
    front.appendChild(symbolsGrid);

    const back = document.createElement('div');
    back.className = 'card-back';

    inner.appendChild(front);
    inner.appendChild(back);
    container.appendChild(inner);

    if (!isHidden) {
        setTimeout(() => {
            inner.classList.add('flipped');
        }, 50);
    }
    return container;
}

function getSymbolPositions(num) {
    const posMap = {
        2: ["1/2", "5/2"],
        3: ["1/2", "3/2", "5/2"],
        4: ["1/1", "1/3", "5/1", "5/3"],
        5: ["1/1", "1/3", "3/2", "5/1", "5/3"],
        6: ["1/1", "1/3", "3/1", "3/3", "5/1", "5/3"],
        7: ["1/1", "1/3", "2/2", "3/1", "3/3", "5/1", "5/3"],
        8: ["1/1", "1/3", "2/2", "3/1", "3/3", "4/2", "5/1", "5/3"],
        9: ["1/1", "1/3", "2/1", "2/3", "3/2", "4/1", "4/3", "5/1", "5/3"],
        10: ["1/1", "1/3", "2/1", "2/3", "2/2", "4/2", "4/1", "4/3", "5/1", "5/3"]
    };
    return posMap[num] || [];
}

function reorderCards(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;
    
    const cards = container.children;
    const overlap = 25; 

    for (let i = 0; i < cards.length; i++) {
        cards[i].style.position = 'absolute';
        cards[i].style.left = `calc(50% - 40px + ${(i - (cards.length - 1) / 2) * overlap}px)`;
        cards[i].style.zIndex = i;
    }
}

document.getElementById('back-to-lobby').onclick = () => {
    if (!isGameOver && !confirm("Game in progress. Return to lobby?")) return;
    board.classList.add('hidden');
    lobbySection.classList.remove('hidden');
};

function resetSingleGame() {
    isGameOver = true;
    playerHand = [];
    dealerHand = [];
    currentBet = 0;
    
    const playerCardsEl = document.getElementById('player-cards');
    const dealerCardsEl = document.getElementById('dealer-cards');
    const playerScoreEl = document.getElementById('player-score');
    const dealerScoreEl = document.getElementById('dealer-score');

    if (playerCardsEl) playerCardsEl.innerHTML = '';
    if (dealerCardsEl) dealerCardsEl.innerHTML = '';
    if (playerScoreEl) playerScoreEl.innerText = '';
    if (dealerScoreEl) dealerScoreEl.innerText = '';
    
    document.getElementById('action-btns').classList.add('hidden');
    document.getElementById('bet-controls').classList.remove('hidden');
    
    updateUI(); 
}