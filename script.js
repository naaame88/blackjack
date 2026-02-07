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

let user = null;
let balance = 0;
let currentBet = 0;
let lastClaimDate = "";
let deck = [], playerHand = [], dealerHand = [];
let isGameOver = true;
let currentRoomId = null;

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

// 1. 멀티플레이어 버튼 클릭 시
multiGameBtn.onclick = async () => {
    multiLobbyModal.classList.remove('hidden');
    joinOrCreateRoom();
};

// 2. 방 참가 또는 생성 로직
async function joinOrCreateRoom() {
    const roomsRef = collection(db, "rooms");
    // 대기 중(waiting)이고 3명 미만인 방 찾기
    const q = query(roomsRef, where("status", "==", "waiting"), limit(1));
    const querySnapshot = await getDocs(q);

    let roomId;
    if (querySnapshot.empty) {
        // 새 방 생성
        const newRoom = await addDoc(roomsRef, {
            status: "waiting",
            players: [{ uid: user.uid, name: displayNickname.innerText, isReady: false }],
            createdAt: serverTimestamp()
        });
        roomId = newRoom.id;
    } else {
        // 기존 방 입장
        roomId = querySnapshot.docs[0].id;
        await updateDoc(doc(db, "rooms", roomId), {
            players: arrayUnion({ uid: user.uid, name: displayNickname.innerText, isReady: false })
        });
    }
    currentRoomId = roomId;
    listenToRoom(roomId);
}

// rooms/{roomId} 문서를 실시간 감시
function listenToGame(roomId) {
    onSnapshot(doc(db, "rooms", roomId), (snap) => {
        const data = snap.data();
        if (!data) return;

        // 1. 모든 플레이어의 카드와 점수를 화면에 렌더링
        renderMultiTable(data.players, data.dealerHand);

        // 2. 현재 내 차례인지 확인 (turnIndex 활용)
        const currentPlayer = data.players[data.turnIndex];
        if (currentPlayer.uid === user.uid && data.status === "playing") {
            // 내 차례면 버튼 활성화
            actionBtns.classList.remove('hidden');
            messageEl.innerText = "It's your turn!";
        } else {
            // 남의 차례면 버튼 숨김
            actionBtns.classList.add('hidden');
            messageEl.innerText = `${currentPlayer.name}'s turn...`;
        }

        // 3. 딜러 차례인지 확인 (모든 플레이어 완료 시)
        if (data.turnIndex === data.players.length) {
            if (user.uid === data.players[0].uid) { // 방장(첫 번째 플레이어)이 AI 계산 수행
                runDealerAI(roomId, data);
            }
        }
    });
}

// Hit 버튼 클릭 시
async function multiHit() {
    const roomRef = doc(db, "rooms", currentRoomId);
    const snap = await getDoc(roomRef);
    const data = snap.data();
    
    let updatedPlayers = [...data.players];
    const myIndex = data.turnIndex;
    const nextCard = data.deck.pop(); // 공용 덱에서 한 장 추출
    
    updatedPlayers[myIndex].hand.push(nextCard);
    
    // 점수 계산 후 버스트 체크
    if (calculateScore(updatedPlayers[myIndex].hand) > 21) {
        updatedPlayers[myIndex].status = "bust";
        // 버스트되면 자동으로 다음 사람에게 턴을 넘김
        await updateDoc(roomRef, {
            players: updatedPlayers,
            deck: data.deck,
            turnIndex: data.turnIndex + 1
        });
    } else {
        // 버스트가 아니면 카드만 추가
        await updateDoc(roomRef, {
            players: updatedPlayers,
            deck: data.deck
        });
    }
}

// Stay 버튼 클릭 시
async function multiStay() {
    const roomRef = doc(db, "rooms", currentRoomId);
    const snap = await getDoc(roomRef);
    const data = snap.data();
    
    let updatedPlayers = [...data.players];
    updatedPlayers[data.turnIndex].status = "stay";
    
    // 다음 사람에게 턴 넘기기
    await updateDoc(roomRef, {
        players: updatedPlayers,
        turnIndex: data.turnIndex + 1
    });
}

async function runDealerAI(roomId, data) {
    let dHand = [...data.dealerHand];
    let dDeck = [...data.deck];
    
    // 딜러 룰: 18점 미만이면 계속 뽑기
    while (calculateScore(dHand) < 18) {
        dHand.push(dDeck.pop());
    }
    
    // 최종 상태 업데이트 및 게임 종료
    await updateDoc(doc(db, "rooms", roomId), {
        dealerHand: dHand,
        deck: dDeck,
        status: "finished"
    });
}

// 로그인 처리
loginBtn.onclick = async () => {
    try {
        const result = await signInWithPopup(auth, provider);
        user = result.user;
        loadUserData();
    } catch (error) {
        console.error("Login failed:", error);
    }
};

onAuthStateChanged(auth, async (u) => {
    if (u) { user = u; loadUserData(); }
});

// 유저 데이터 로드 및 닉네임 체크
async function loadUserData() {
    const userRef = doc(db, "users", user.uid);
    const snap = await getDoc(userRef);
    let nickname = "";

    if (snap.exists()) {
        const data = snap.data();
        balance = data.money;
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

// 닉네임 저장/수정
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

// 로비 메뉴
document.getElementById('start-game-btn').onclick = () => {
    lobbySection.classList.add('hidden');
    board.classList.remove('hidden');
    messageEl.innerText = "Place your bet to start.";
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

// 게임 로직
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
    
    // 게임 시작 시 배팅 컨트롤 숨기기
    document.querySelector('.bet-controls').classList.add('hidden');
    
    createDeck();
    playerHand = [deck.pop(), deck.pop()];
    dealerHand = [deck.pop(), deck.pop()];
    
    document.getElementById('player-cards').innerHTML = '';
    document.getElementById('dealer-cards').innerHTML = '';
    
    // 초기 카드 배분 애니메이션
    document.getElementById('player-cards').appendChild(createCardElement(playerHand[0]));
    reorderCards('player-cards');
    await sleep(500);
    document.getElementById('dealer-cards').appendChild(createCardElement(dealerHand[0]));
    reorderCards('dealer-cards');
    await sleep(500);
    document.getElementById('player-cards').appendChild(createCardElement(playerHand[1]));
    reorderCards('player-cards');
    await sleep(500);
    document.getElementById('dealer-cards').appendChild(createCardElement(dealerHand[1], true));
    reorderCards('dealer-cards');
    
    updateUI();
    actionBtns.classList.remove('hidden');
    messageEl.innerText = "Hit or Stay?";
};

document.getElementById('hit-btn').onclick = async () => {
    if (isGameOver) return;
    
    const nextCard = deck.pop();
    playerHand.push(nextCard);
    document.getElementById('player-cards').appendChild(createCardElement(nextCard));
    reorderCards('player-cards');
    updateUI();
    
    // 버스트 시 즉시 종료
    if (calculateScore(playerHand) > 21) {
        await sleep(500);
        endGame('lose');
    }
};

document.getElementById('all-in-btn').onclick = () => {
    if (!isGameOver) return; // 게임 중에는 배팅 불가
    
    if (balance > 0) {
        currentBet += balance; // 전재산을 배팅액에 추가
        balance = 0;           // 내 잔고는 0원
        updateUI();
    } else {
        alert("You have no gold for an All-in bet.");
    }
};

document.getElementById('stay-btn').onclick = dealerTurn;

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

// 랭킹 시스템
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
            li.innerHTML = `<span>${index + 1}. ${data.displayName || "Guest"}</span><span>${data.money.toLocaleString()} G</span>`;
            rankList.appendChild(li);
        });
    });
}

// 카드 엘리먼트 생성
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
        setTimeout(() => inner.classList.add('flipped'), 100);
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
    const cards = document.getElementById(containerId).querySelectorAll('.card-container');
    const overlapValue = cards.length >= 3 ? 40 : 0;
    cards.forEach((card, index) => {
        card.style.position = 'relative';
        card.style.zIndex = index;
        card.style.marginLeft = index > 0 ? `-${overlapValue}px` : '0px';
    });
}

document.getElementById('back-to-lobby').onclick = () => {
    if (!isGameOver && !confirm("Game in progress. Return to lobby?")) return;
    board.classList.add('hidden');
    lobbySection.classList.remove('hidden');
};