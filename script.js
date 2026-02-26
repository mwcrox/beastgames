(() => {
    const $ = (sel, el = document) => el.querySelector(sel);
    const $$ = (sel, el = document) => Array.from(el.querySelectorAll(sel));
    const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
    const shuffle = (arr) => {
        const a = arr.slice();
        for (let i = a.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [a[i], a[j]] = [a[j], a[i]];
        }
        return a;
    };

    const board = $("#board");
    const overlay = $("#overlay");
    const modal = $("#modal");

    const statusText = $("#statusText");
    const roundNumEl = $("#roundNum");
    const boxesLeftEl = $("#boxesLeft");
    const phasePill = $("#phasePill");

    const doneMovingBtn = $("#doneMovingBtn");
    const lockBtn = $("#lockBtn");
    const resetBtn = $("#resetBtn");
    const boardShell = $("#boardShell");

    const PHASE = Object.freeze({
        NAMES: "NAMES",
        COIN: "COIN",

        LOOK_AWAY_FOR_MOVE: "LOOK_AWAY_FOR_MOVE",
        MOVE: "MOVE",

        PICK_WINNER: "PICK_WINNER",     // hider selects winning case (after moving)
        PASS_TO_GUESS: "PASS_TO_GUESS",
        GUESS: "GUESS",

        WIN: "WIN"
    });

    let phase = PHASE.NAMES;

    let players = { A: "", B: "" };
    let coinWinner = "A";  // goes first as GUESSER
    let guesser = "A";
    let hider = "B";

    let round = 1;

    let winningBoxId = null;
    let selectedWinningBoxId = null;
    let selectedGuessBoxId = null;

    const SLOT_COUNT = 15;
    const OUTER_SLOTS = 10;
    const INNER_SLOTS = 5;

    let slotCenters = new Map();
    let slotEls = new Map();

    let slotToBox = new Map();
    let boxToSlot = new Map();
    let aliveBoxes = new Set();

    let dragging = null;
    let allowDrag = false;

    function computeSlotCenters() {
        const rect = board.getBoundingClientRect();
        const w = rect.width;
        const h = rect.height;
        const cx = w / 2;
        const cy = h / 2;

        const boxSize = 84;
        const pad = 18;
        const maxR = Math.min(w, h) / 2 - (boxSize / 2) - pad;

        const outerR = clamp(maxR, 160, 300);
        const innerR = clamp(outerR * 0.42, 70, 140);

        const centers = new Map();

        for (let i = 0; i < OUTER_SLOTS; i++) {
            const angle = (-Math.PI / 2) + (i * (2 * Math.PI / OUTER_SLOTS));
            const x = cx + outerR * Math.cos(angle);
            const y = cy + outerR * Math.sin(angle);
            centers.set(`slot-${i + 1}`, { x, y, kind: "outer" });
        }

        for (let i = 0; i < INNER_SLOTS; i++) {
            const angle = (-Math.PI / 2) + (i * (2 * Math.PI / INNER_SLOTS));
            const x = cx + innerR * Math.cos(angle);
            const y = cy + innerR * Math.sin(angle);
            centers.set(`slot-${OUTER_SLOTS + i + 1}`, { x, y, kind: "inner" });
        }

        slotCenters = centers;
    }

    function renderSlots() {
        board.innerHTML = "";
        slotEls.clear();

        computeSlotCenters();

        for (let i = 1; i <= SLOT_COUNT; i++) {
            const id = `slot-${i}`;
            const s = document.createElement("div");
            s.className = "slot " + (i <= OUTER_SLOTS ? "outer" : "inner");
            s.dataset.slotId = id;

            // IMPORTANT: Do not label the 1-10 outer locations
            // (Inner locations can remain subtle dots or be blank)
            s.textContent = (i <= OUTER_SLOTS) ? "" : "•";

            board.appendChild(s);
            slotEls.set(id, s);
        }

        for (const boxId of Array.from(aliveBoxes)) {
            const box = makeOrGetBox(boxId);
            board.appendChild(box);
        }

        positionAllSlotsAndBoxes();
    }

    function positionAllSlotsAndBoxes() {
        computeSlotCenters();

        for (const [slotId, sEl] of slotEls.entries()) {
            const c = slotCenters.get(slotId);
            if (!c) continue;
            sEl.style.left = `${c.x - 84 / 2}px`;
            sEl.style.top = `${c.y - 84 / 2}px`;
        }

        for (const boxId of aliveBoxes) {
            if (dragging && dragging.boxId === boxId) continue;
            const boxEl = makeOrGetBox(boxId);
            const slotId = boxToSlot.get(boxId);
            if (!slotId) continue;
            snapBoxElementToSlot(boxEl, slotId);
        }
    }

    function makeOrGetBox(boxId) {
        let el = document.getElementById(boxId);
        if (el) return el;

        el = document.createElement("div");
        el.className = "box";
        el.id = boxId;
        el.dataset.boxId = boxId;
        el.textContent = boxId.replace("box-", "");
        el.addEventListener("pointerdown", onBoxPointerDown);
        el.addEventListener("click", onBoxClick);
        return el;
    }

    function initBoxes() {
        aliveBoxes = new Set();
        slotToBox = new Map();
        boxToSlot = new Map();

        winningBoxId = null;
        selectedWinningBoxId = null;
        selectedGuessBoxId = null;

        for (let i = 1; i <= 10; i++) {
            const boxId = `box-${i}`;
            const slotId = `slot-${i}`;
            aliveBoxes.add(boxId);
            slotToBox.set(slotId, boxId);
            boxToSlot.set(boxId, slotId);
        }

        renderSlots();
        updateUI();
    }

    function snapBoxElementToSlot(boxEl, slotId) {
        const c = slotCenters.get(slotId);
        if (!c) return;
        boxEl.style.left = `${c.x - 84 / 2}px`;
        boxEl.style.top = `${c.y - 84 / 2}px`;
    }

    function nearestAvailableSlot(x, y, excludeBoxId = null) {
        let best = null;
        let bestD = Infinity;
        for (let i = 1; i <= SLOT_COUNT; i++) {
            const slotId = `slot-${i}`;
            const c = slotCenters.get(slotId);
            if (!c) continue;

            const occupant = slotToBox.get(slotId);
            if (occupant && occupant !== excludeBoxId) continue;

            const dx = c.x - x;
            const dy = c.y - y;
            const d = dx * dx + dy * dy;
            if (d < bestD) {
                bestD = d;
                best = slotId;
            }
        }
        return best;
    }

    function setBoxSlot(boxId, newSlotId) {
        const oldSlotId = boxToSlot.get(boxId);
        if (oldSlotId) slotToBox.delete(oldSlotId);

        slotToBox.set(newSlotId, boxId);
        boxToSlot.set(boxId, newSlotId);

        const el = makeOrGetBox(boxId);
        snapBoxElementToSlot(el, newSlotId);
    }

    function removeBox(boxId) {
        aliveBoxes.delete(boxId);

        const slotId = boxToSlot.get(boxId);
        if (slotId) slotToBox.delete(slotId);
        boxToSlot.delete(boxId);

        const el = document.getElementById(boxId);
        if (el) {
            el.classList.add("removing");
            setTimeout(() => el.remove(), 220);
        }
    }

    // ---------------- Drag ----------------
    function onBoxPointerDown(e) {
        if (!allowDrag) return;
        if (phase !== PHASE.MOVE) return;

        const boxEl = e.currentTarget;
        const boxId = boxEl.dataset.boxId;
        if (!aliveBoxes.has(boxId)) return;

        boxEl.setPointerCapture(e.pointerId);
        const boxRect = boxEl.getBoundingClientRect();

        const startSlotId = boxToSlot.get(boxId);

        dragging = {
            boxId,
            pointerId: e.pointerId,
            offsetX: e.clientX - boxRect.left,
            offsetY: e.clientY - boxRect.top,
            startSlotId
        };

        if (startSlotId) slotToBox.delete(startSlotId);

        boxEl.classList.add("dragging");
        boxEl.style.zIndex = 60;

        board.addEventListener("pointermove", onBoardPointerMove);
        board.addEventListener("pointerup", onBoardPointerUp, { once: true });
        board.addEventListener("pointercancel", onBoardPointerUp, { once: true });
    }

    function onBoardPointerMove(e) {
        if (!dragging) return;
        const boxEl = document.getElementById(dragging.boxId);
        if (!boxEl) return;

        const boardRect = board.getBoundingClientRect();
        const x = e.clientX - boardRect.left - dragging.offsetX;
        const y = e.clientY - boardRect.top - dragging.offsetY;

        boxEl.style.left = `${x}px`;
        boxEl.style.top = `${y}px`;
    }

    function onBoardPointerUp(e) {
        board.removeEventListener("pointermove", onBoardPointerMove);
        if (!dragging) return;

        const { boxId, startSlotId } = dragging;
        const boxEl = document.getElementById(boxId);

        const boardRect = board.getBoundingClientRect();
        const centerX = (e.clientX - boardRect.left);
        const centerY = (e.clientY - boardRect.top);

        const targetSlot = nearestAvailableSlot(centerX, centerY, boxId) || startSlotId;

        if (targetSlot) setBoxSlot(boxId, targetSlot);
        else if (startSlotId) setBoxSlot(boxId, startSlotId);

        if (boxEl) {
            boxEl.classList.remove("dragging");
            boxEl.style.zIndex = "";
        }

        dragging = null;
        updateUI();
    }

    // ---------------- Selection ----------------
    function clearSelections() {
        selectedWinningBoxId = null;
        selectedGuessBoxId = null;
        for (const el of $$(".box", board)) el.classList.remove("selected");
        lockBtn.disabled = true;
    }

    function onBoxClick(e) {
        const boxEl = e.currentTarget;
        const boxId = boxEl.dataset.boxId;
        if (!aliveBoxes.has(boxId)) return;

        if (phase === PHASE.PICK_WINNER) {
            // Select winning case (glow), but DO NOT finalize until lock button
            for (const el of $$(".box", board)) el.classList.remove("selected");
            selectedWinningBoxId = boxId;
            boxEl.classList.add("selected");
            lockBtn.disabled = false;
            return;
        }

        if (phase === PHASE.GUESS) {
            // Select guess case (glow), but DO NOT finalize until lock button
            for (const el of $$(".box", board)) el.classList.remove("selected");
            selectedGuessBoxId = boxId;
            boxEl.classList.add("selected");
            lockBtn.disabled = false;
            return;
        }
    }

    // ---------------- UI / Phase ----------------
    function setPhase(p) {
        phase = p;
        updateUI();
    }

    function updateUI() {
        roundNumEl.textContent = String(round);
        boxesLeftEl.textContent = String(aliveBoxes.size);

        phasePill.textContent =
            phase === PHASE.MOVE ? "MOVE" :
                phase === PHASE.PICK_WINNER ? "PICK" :
                    phase === PHASE.GUESS ? "GUESS" :
                        phase === PHASE.WIN ? "WIN" :
                            "—";

        allowDrag = (phase === PHASE.MOVE);

        doneMovingBtn.disabled = !(phase === PHASE.MOVE);

        // Lock button behavior/label changes by phase
        if (phase === PHASE.PICK_WINNER) {
            lockBtn.textContent = "Lock Winning Case";
            lockBtn.disabled = !selectedWinningBoxId;
        } else if (phase === PHASE.GUESS) {
            lockBtn.textContent = "Lock In Guess";
            lockBtn.disabled = !selectedGuessBoxId;
        } else {
            lockBtn.textContent = "Lock In";
            lockBtn.disabled = true;
        }

        // Status text
        if (phase === PHASE.MOVE) {
            statusText.innerHTML = `Hider: <strong>${players[hider]}</strong> — Move the boxes (drag). Then tap <strong>Done Moving</strong>.`;
        } else if (phase === PHASE.PICK_WINNER) {
            statusText.innerHTML = `Hider: <strong>${players[hider]}</strong> — Select the winning case (glows), then <strong>Lock Winning Case</strong>.`;
        } else if (phase === PHASE.GUESS) {
            statusText.innerHTML = `Guesser: <strong>${players[guesser]}</strong> — Select a case (glows), then <strong>Lock In Guess</strong>.`;
        } else if (phase === PHASE.WIN) {
            statusText.innerHTML = `<strong>${players[guesser]}</strong> wins!`;
        } else if (phase === PHASE.COIN) {
            statusText.innerHTML = `Flipping coin…`;
        } else {
            statusText.innerHTML = `Ready…`;
        }

        // Disable cursor hint
        for (const el of $$(".box", board)) {
            if (allowDrag) el.classList.remove("disabled");
            else el.classList.add("disabled");
        }
    }

    // ---------------- Overlays ----------------
    function showOverlay(contentHTML) {
        modal.innerHTML = contentHTML;
        overlay.style.display = "flex";
    }
    function hideOverlay() {
        overlay.style.display = "none";
        modal.innerHTML = "";
    }

    function namesOverlay() {
        showOverlay(`
      <h2>Enter Player Names</h2>
      <p>We’ll flip a coin to decide who goes first (as the <strong>Guesser</strong>).</p>
      <div class="row">
        <input id="nameA" placeholder="Player 1 name" maxlength="18" autocomplete="off" />
        <input id="nameB" placeholder="Player 2 name" maxlength="18" autocomplete="off" />
      </div>
      <div class="modalActions">
        <button class="secondary" id="namesFill">Random Names</button>
        <button class="good" id="namesGo" disabled>Start</button>
      </div>
    `);

        const nameA = $("#nameA", modal);
        const nameB = $("#nameB", modal);
        const go = $("#namesGo", modal);
        const fill = $("#namesFill", modal);

        const validate = () => {
            const a = nameA.value.trim();
            const b = nameB.value.trim();
            go.disabled = !(a && b && a.toLowerCase() !== b.toLowerCase());
        };

        nameA.addEventListener("input", validate);
        nameB.addEventListener("input", validate);

        fill.addEventListener("click", () => {
            const pool = shuffle(["Nova", "Blaze", "Shadow", "Rogue", "Pixel", "Viper", "Koda", "Skye", "Atlas", "Echo", "Jinx", "River"]);
            nameA.value = pool[0];
            nameB.value = pool[1];
            validate();
        });

        go.addEventListener("click", () => {
            players.A = nameA.value.trim();
            players.B = nameB.value.trim();
            hideOverlay();
            startCoinFlip();
        });

        setPhase(PHASE.NAMES);
        updateUI();
    }

    function coinFlipOverlay() {
        showOverlay(`
      <h2>Coin Flip</h2>
      <p>Slower flip to decide who goes first (as the <strong>Guesser</strong>).</p>
      <div class="coinWrap">
        <div class="coin spin" id="coinEl">
          <div class="coinFace front">
            <div>
              <div class="coinName">${players.A}</div>
              <div class="coinSub">Heads</div>
            </div>
          </div>
          <div class="coinFace back">
            <div>
              <div class="coinName">${players.B}</div>
              <div class="coinSub">Tails</div>
            </div>
          </div>
        </div>
        <div class="coinSub" id="coinMsg">Spinning…</div>
        <div class="modalActions">
          <button class="secondary" id="skipFlip">Skip</button>
        </div>
      </div>
    `);
    }

    function lookAwayOverlay(lookAwayPlayerKey, nextForPlayerKey, text) {
        const looker = players[lookAwayPlayerKey];
        const next = players[nextForPlayerKey];
        showOverlay(`
      <h2>Look Away!</h2>
      <p><strong>${looker}</strong>, don’t look at the screen.</p>
      <p>${text}</p>
      <div class="modalActions">
        <button class="good" id="lookAwayReady">${next} is ready</button>
      </div>
    `);
        $("#lookAwayReady", modal).addEventListener("click", () => {
            hideOverlay();
            clearSelections();
            setPhase(PHASE.MOVE);
        });
    }

    function passDeviceOverlay(toPlayerKey) {
        const toName = players[toPlayerKey];
        showOverlay(`
      <h2>Pass the Device</h2>
      <p>Hand it to <strong>${toName}</strong>.</p>
      <div class="modalActions">
        <button class="good" id="passOk">${toName} is ready</button>
      </div>
    `);
        $("#passOk", modal).addEventListener("click", () => {
            hideOverlay();
            clearSelections();
            setPhase(PHASE.GUESS);
        });
    }

    function wrongGuessOverlay(winningNumber) {
        showOverlay(`
      <h2>❌ Wrong!</h2>
      <p>The winning case was <strong>${winningNumber}</strong>.</p>
      <p>Removing your chosen case and switching roles.</p>
      <div class="modalActions">
        <button class="good" id="wrongOk">Continue</button>
      </div>
    `);
        $("#wrongOk", modal).addEventListener("click", () => {
            hideOverlay();
            beginRoundLookAwayForMove();
        });
    }

    function winOverlay(winnerKey) {
        const winner = players[winnerKey];
        showOverlay(`
      <h2>🏆 ${winner} Wins!</h2>
      <p>The screen turns gold to celebrate.</p>
      <div class="modalActions">
        <button class="good" id="playAgain">Play Again</button>
      </div>
    `);
        $("#playAgain", modal).addEventListener("click", () => {
            document.body.classList.remove("win");
            hideOverlay();
            hardReset();
        });
    }

    // ---------------- Flow ----------------
    function startCoinFlip() {
        setPhase(PHASE.COIN);
        updateUI();
        coinFlipOverlay();

        const msg = $("#coinMsg", modal);
        const coinEl = $("#coinEl", modal);
        const skip = $("#skipFlip", modal);

        let finished = false;

        const finish = () => {
            if (finished) return;
            finished = true;

            coinWinner = (Math.random() < 0.5) ? "A" : "B";
            guesser = coinWinner;
            hider = (guesser === "A") ? "B" : "A";

            coinEl.classList.remove("spin");
            coinEl.style.transform = (coinWinner === "A") ? "rotateY(0deg)" : "rotateY(180deg)";

            msg.innerHTML = `<strong>${players[guesser]}</strong> goes first as the <strong>Guesser</strong>.<br/>
                       <span style="color:var(--muted)">Hider: <strong>${players[hider]}</strong></span><br/>
                       <span style="color:var(--muted)">Starting in 5 seconds…</span>`;

            // IMPORTANT: keep name visible for at least 5 seconds
            setTimeout(() => {
                hideOverlay();
                beginRoundLookAwayForMove();
            }, 5200);
        };

        // slower total flip time
        const timer = setTimeout(() => finish(), 6500);
        skip.addEventListener("click", () => { clearTimeout(timer); finish(); });

        updateUI();
    }

    function beginRoundLookAwayForMove() {
        winningBoxId = null;
        selectedWinningBoxId = null;
        selectedGuessBoxId = null;
        clearSelections();

        setPhase(PHASE.LOOK_AWAY_FOR_MOVE);
        updateUI();

        lookAwayOverlay(
            guesser,
            hider,
            `First, <strong>${players[hider]}</strong> will rearrange the boxes. After moving, they will pick and lock the winning case.`
        );
    }

    function endMovePhase() {
        // After moving, hider now chooses winning case (and must lock it)
        clearSelections();
        setPhase(PHASE.PICK_WINNER);
    }

    function lockWinningCase() {
        if (phase !== PHASE.PICK_WINNER) return;
        if (!selectedWinningBoxId) return;

        // Save the winning case
        winningBoxId = selectedWinningBoxId;

        // IMPORTANT: remove any visible glow BEFORE pass screen
        for (const el of $$(".box", board)) el.classList.remove("selected");
        selectedWinningBoxId = null;

        setPhase(PHASE.PASS_TO_GUESS);
        updateUI();
        passDeviceOverlay(guesser);
    }

    function lockGuess() {
        if (phase !== PHASE.GUESS) return;
        if (!selectedGuessBoxId) return;
        if (!winningBoxId) return; // safety

        const picked = selectedGuessBoxId;

        if (picked === winningBoxId) {
            setPhase(PHASE.WIN);
            updateUI();

            document.body.classList.add("win");
            boardShell.classList.add("winGlow");
            setTimeout(() => boardShell.classList.remove("winGlow"), 1000);

            winOverlay(guesser);
            return;
        }

        // WRONG: flash red, reveal correct case, remove picked, swap roles, continue
        flashWrong();

        const winningNumber = winningBoxId.replace("box-", "");
        removeBox(picked);

        // swap roles
        const oldGuesser = guesser;
        guesser = hider;
        hider = oldGuesser;

        round++;
        updateUI();

        // show which case it was in
        clearSelections();
        setTimeout(() => {
            wrongGuessOverlay(winningNumber);
        }, 450);
    }

    function flashWrong() {
        document.body.classList.add("wrong");
        boardShell.classList.add("wrongGlow");
        setTimeout(() => {
            document.body.classList.remove("wrong");
            boardShell.classList.remove("wrongGlow");
        }, 1100);
    }

    // ---------------- Buttons ----------------
    doneMovingBtn.addEventListener("click", () => {
        if (phase !== PHASE.MOVE) return;
        endMovePhase();
    });

    lockBtn.addEventListener("click", () => {
        if (phase === PHASE.PICK_WINNER) lockWinningCase();
        else if (phase === PHASE.GUESS) lockGuess();
    });

    resetBtn.addEventListener("click", () => hardReset());

    // ---------------- Misc ----------------
    function enforceAliveBoxes() {
        for (const el of $$(".box", board)) {
            const id = el.dataset.boxId;
            if (!aliveBoxes.has(id)) el.remove();
        }
    }

    window.addEventListener("resize", () => positionAllSlotsAndBoxes());

    function hardReset() {
        document.body.classList.remove("win");
        document.body.classList.remove("wrong");
        boardShell.classList.remove("winGlow");
        boardShell.classList.remove("wrongGlow");

        round = 1;
        players = { A: "", B: "" };
        coinWinner = "A";
        guesser = "A";
        hider = "B";
        winningBoxId = null;
        selectedWinningBoxId = null;
        selectedGuessBoxId = null;

        initBoxes();
        namesOverlay();
    }

    setInterval(enforceAliveBoxes, 200);

    // Patch phase entry side effects
    const _setPhase = setPhase;
    setPhase = function (p) {
        phase = p;

        if (phase === PHASE.MOVE) {
            allowDrag = true;
            updateUI();
            return;
        }

        if (phase === PHASE.PICK_WINNER || phase === PHASE.GUESS) {
            allowDrag = false;
            updateUI();
            return;
        }

        allowDrag = false;
        updateUI();
    };

    // Initialize
    initBoxes();
    namesOverlay();
})();