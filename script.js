(() => {
    'use strict';

    const $ = (selector, root = document) => root.querySelector(selector);

    const ui = Object.fromEntries([
        'app',
        'board',
        'boardShell',
        'roundNum',
        'boxesLeft',
        'phasePill',
        'statusText',
        'statusHint',
        'activePlayer',
        'actionBtn',
        'resetBtn',
        'helpBtn',
        'overlay',
        'modal'
    ].map(id => [id, document.getElementById(id)]));

    const PHASE = Object.freeze({
        SETUP: 'setup',
        COIN: 'coin',
        PRIVATE: 'private',
        MOVE: 'move',
        PICK: 'pick',
        PASS: 'pass',
        GUESS: 'guess',
        RESULT: 'result',
        WIN: 'win'
    });

    const CASE_COUNT = 10;
    const SLOT_COUNT = 15;
    const COIN_SPIN_MS = 6500;
    const COIN_RESULT_MS = 5200;
    const DRAG_THRESHOLD = 7;

    const timers = new Set();
    const slots = new Map();
    const cases = new Map();

    let centers = [];
    let caseSize = 64;
    let drag = null;
    let layoutFrame = 0;
    let dragFrame = 0;
    let suppressClick = null;
    let modalClose = null;
    let returnFocus = null;
    let state;

    const escapeHTML = text => String(text).replace(/[&<>"']/g, char => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    }[char]));

    const otherPlayer = player => player === 'A' ? 'B' : 'A';

    const name = player => escapeHTML(state.players[player]);

    const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

    /* Timers */

    function later(callback, delay) {
        const id = setTimeout(() => {
            timers.delete(id);
            callback();
        }, delay);

        timers.add(id);
        return id;
    }

    function cancelTimers() {
        for (const id of timers) {
            clearTimeout(id);
        }

        timers.clear();
    }

    /* Game state */

    function setPhase(phase) {
        cancelDrag();

        state.phase = phase;
        state.selected = null;
        state.moveSelected = null;

        render();
    }

    // Each surviving case maps to exactly one slot.
    function resetGame(keepNames = false) {
        cancelTimers();
        cancelDrag();

        const players = keepNames ? state.players : { A: '', B: '' };

        state = {
            phase: PHASE.SETUP,
            players,
            guesser: 'A',
            hider: 'B',
            round: 1,
            positions: new Map(
                Array.from({ length: CASE_COUNT }, (_, i) => [i + 1, i])
            ),
            winner: null,
            selected: null,
            moveSelected: null
        };

        document.body.classList.remove('win');
        ui.boardShell.classList.remove('win-glow');

        buildBoard();
        render();

        if (keepNames) {
            startCoinFlip();
        } else {
            showNames();
        }
    }

    /* Board construction and layout */

    function buildBoard() {
        ui.board.replaceChildren();
        slots.clear();
        cases.clear();

        for (let slot = 0; slot < SLOT_COUNT; slot++) {
            const element = document.createElement('button');

            element.type = 'button';
            element.className = 'slot';
            element.dataset.slot = slot;
            element.setAttribute('aria-label', `Empty position ${slot + 1}`);

            slots.set(slot, element);
            ui.board.append(element);
        }

        for (const id of state.positions.keys()) {
            const element = document.createElement('button');

            element.type = 'button';
            element.className = 'box';
            element.id = `box-${id}`;
            element.dataset.case = id;
            element.textContent = id;
            element.setAttribute('aria-label', `Case ${id}`);

            cases.set(id, element);
            ui.board.append(element);
        }

        layoutBoard();
    }

    function layoutBoard() {
        cancelDrag();

        const width = ui.board.clientWidth;
        const height = ui.board.clientHeight;

        if (!width || !height) {
            return;
        }

        centers = [];

        if (width < 620 || height < 480) {
            const columns = 3;
            const rows = 5;

            // Logical slot positions produce these starting rows:
            // Row 1: cases 2, 3, 4
            // Row 2: case 1, empty, case 5
            // Row 3: empty, empty, empty
            // Row 4: case 10, empty, case 6
            // Row 5: cases 7, 8, 9
            const mobileSlots = [
                1, 2, 3,
                0, 10, 4,
                11, 12, 13,
                9, 14, 5,
                6, 7, 8
            ];

            const gap = Math.min(
                14,
                width * 0.035,
                height * 0.035
            );

            caseSize = Math.floor(
                Math.min(
                    88,
                    (width - 16 - gap * (columns - 1)) / columns,
                    (height - 16 - gap * (rows - 1)) / rows
                )
            );

            caseSize = Math.max(1, caseSize);

            const gridWidth =
                columns * caseSize + (columns - 1) * gap;

            const gridHeight =
                rows * caseSize + (rows - 1) * gap;

            mobileSlots.forEach((slot, cell) => {
                const column = cell % columns;
                const row = Math.floor(cell / columns);

                centers[slot] = {
                    x:
                        (width - gridWidth) / 2 +
                        column * (caseSize + gap) +
                        caseSize / 2,

                    y:
                        (height - gridHeight) / 2 +
                        row * (caseSize + gap) +
                        caseSize / 2
                };
            });

            ui.board.dataset.layout = 'grid';
        } else {
            // Circular layout for larger screens.
            caseSize = Math.floor(
                Math.min(84, Math.min(width, height) * 0.14)
            );

            const radius =
                Math.min(width, height) / 2 -
                caseSize / 2 -
                12;

            for (let i = 0; i < SLOT_COUNT; i++) {
                const outer = i < CASE_COUNT;

                const count = outer
                    ? CASE_COUNT
                    : SLOT_COUNT - CASE_COUNT;

                const angle =
                    -Math.PI / 2 +
                    (outer ? i : i - CASE_COUNT) *
                    Math.PI * 2 / count;

                const r = outer ? radius : radius * 0.43;

                centers.push({
                    x: width / 2 + r * Math.cos(angle),
                    y: height / 2 + r * Math.sin(angle)
                });
            }

            ui.board.dataset.layout = 'ring';
        }

        ui.board.style.setProperty(
            '--case-size',
            `${caseSize}px`
        );

        for (const [slot, element] of slots) {
            position(element, slot);
        }

        for (const [id, slot] of state.positions) {
            position(cases.get(id), slot);
        }
    }

    function position(element, slot) {
        const center = centers[slot];

        if (!element || !center) {
            return;
        }

        element.style.left = `${center.x - caseSize / 2}px`;
        element.style.top = `${center.y - caseSize / 2}px`;
    }

    function scheduleLayout() {
        cancelAnimationFrame(layoutFrame);
        layoutFrame = requestAnimationFrame(layoutBoard);
    }

    function occupied(slot) {
        return [...state.positions.values()].includes(slot);
    }

    function moveCase(id, slot) {
        if (occupied(slot) || !state.positions.has(id)) {
            return;
        }

        state.positions.set(id, slot);
        state.moveSelected = null;

        position(cases.get(id), slot);
        render();
    }

    /* Interface */

    function render() {
        const { phase, selected, moveSelected } = state;

        ui.roundNum.textContent = state.round;
        ui.boxesLeft.textContent = state.positions.size;
        ui.board.dataset.phase = phase;

        const steps = {
            [PHASE.MOVE]: [
                '01 / Move',
                state.players[state.hider],
                'Mix up the cases.',
                moveSelected
                    ? `Case ${moveSelected} selected. Tap an empty space.`
                    : 'Drag a case, or tap a case then an empty space.',
                'Done moving'
            ],

            [PHASE.PICK]: [
                '02 / Hide',
                state.players[state.hider],
                'Choose the winning case.',
                selected
                    ? `Case ${selected} selected. Lock it when you’re ready.`
                    : 'Tap one case. Keep your choice secret.',
                'Lock winning case'
            ],

            [PHASE.GUESS]: [
                '03 / Guess',
                state.players[state.guesser],
                'Which case is the winner?',
                selected
                    ? `Case ${selected} selected. Ready to take your chance?`
                    : 'Tap a case, then lock in your guess.',
                'Lock in guess'
            ],

            [PHASE.WIN]: [
                'Winner',
                state.players[state.guesser],
                `${state.players[state.guesser]} wins!`,
                'A perfect pick. Ready for a rematch?',
                'Play again'
            ]
        };

        const content = steps[phase] || [
            'Get ready',
            'Two players. One screen.',
            'Every case counts.',
            'Follow the instructions to begin your turn.',
            'Continue'
        ];

        [
            ui.phasePill,
            ui.activePlayer,
            ui.statusText,
            ui.statusHint,
            ui.actionBtn
        ].forEach((element, i) => {
            element.textContent = content[i];
        });

        ui.actionBtn.disabled = !(
            phase === PHASE.MOVE ||
            (
                (phase === PHASE.PICK || phase === PHASE.GUESS) &&
                selected !== null
            )
        );

        for (const [id, element] of cases) {
            const chosen = selected === id;

            element.classList.toggle('selected', chosen);
            element.classList.toggle('move-selected', moveSelected === id);
            element.setAttribute(
                'aria-pressed',
                String(chosen || moveSelected === id)
            );

            element.disabled = ![
                PHASE.MOVE,
                PHASE.PICK,
                PHASE.GUESS
            ].includes(phase);
        }

        for (const [slot, element] of slots) {
            const filled = occupied(slot);

            element.disabled =
                phase !== PHASE.MOVE ||
                filled ||
                moveSelected === null;

            element.setAttribute('aria-hidden', String(filled));
            element.tabIndex = element.disabled ? -1 : 0;
        }
    }

    /* Dragging */

    // Listeners are registered once. Canceled gestures preserve case positions.
    ui.board.addEventListener('pointerdown', event => {
        const element = event.target.closest('.box');

        if (
            !element ||
            state.phase !== PHASE.MOVE ||
            drag ||
            !event.isPrimary ||
            event.button !== 0
        ) {
            return;
        }

        suppressClick = null;

        const id = Number(element.dataset.case);
        const rect = element.getBoundingClientRect();

        drag = {
            id,
            pointer: event.pointerId,
            element,
            slot: state.positions.get(id),
            startX: event.clientX,
            startY: event.clientY,
            offsetX: event.clientX - rect.left,
            offsetY: event.clientY - rect.top,
            x: rect.left - ui.board.getBoundingClientRect().left,
            y: rect.top - ui.board.getBoundingClientRect().top,
            moved: false,
            target: null
        };

        element.setPointerCapture(event.pointerId);
    });

    ui.board.addEventListener('pointermove', event => {
        if (!drag || drag.pointer !== event.pointerId) {
            return;
        }

        if (
            !drag.moved &&
            Math.hypot(
                event.clientX - drag.startX,
                event.clientY - drag.startY
            ) < DRAG_THRESHOLD
        ) {
            return;
        }

        event.preventDefault();
        drag.moved = true;

        const rect = ui.board.getBoundingClientRect();

        drag.x = clamp(
            event.clientX - rect.left - drag.offsetX,
            0,
            rect.width - caseSize
        );

        drag.y = clamp(
            event.clientY - rect.top - drag.offsetY,
            0,
            rect.height - caseSize
        );

        drag.target = findDropTarget(
            drag.x + caseSize / 2,
            drag.y + caseSize / 2
        );

        drag.element.classList.add('dragging');

        if (!dragFrame) {
            dragFrame = requestAnimationFrame(paintDrag);
        }
    });

    function findDropTarget(x, y) {
        let result = null;
        let best = (caseSize * .85) ** 2;

        centers.forEach((center, slot) => {
            if (occupied(slot) && slot !== drag.slot) {
                return;
            }

            const distance =
                (center.x - x) ** 2 +
                (center.y - y) ** 2;

            if (distance < best) {
                best = distance;
                result = slot;
            }
        });

        return result;
    }

    function paintDrag() {
        dragFrame = 0;

        if (!drag) {
            return;
        }

        drag.element.style.left = `${drag.x}px`;
        drag.element.style.top = `${drag.y}px`;

        for (const [slot, element] of slots) {
            element.classList.toggle('drop-target', slot === drag.target);
        }
    }

    function releaseDrag(commit) {
        if (!drag) {
            return;
        }

        const current = drag;
        drag = null;

        cancelAnimationFrame(dragFrame);
        dragFrame = 0;

        if (current.moved) {
            suppressClick = {
                id: current.id,
                until: performance.now() + 400
            };
        }

        if (
            commit &&
            current.moved &&
            current.target !== null
        ) {
            state.positions.set(current.id, current.target);
            state.moveSelected = null;
        }

        current.element.classList.remove('dragging');

        for (const element of slots.values()) {
            element.classList.remove('drop-target');
        }

        if (current.element.hasPointerCapture(current.pointer)) {
            current.element.releasePointerCapture(current.pointer);
        }

        position(current.element, state.positions.get(current.id));
        render();
    }

    function cancelDrag() {
        if (drag) {
            releaseDrag(false);
        }
    }

    ui.board.addEventListener('pointerup', event => {
        if (drag?.pointer === event.pointerId) {
            releaseDrag(true);
        }
    });

    ui.board.addEventListener('pointercancel', event => {
        if (drag?.pointer === event.pointerId) {
            releaseDrag(false);
        }
    });

    ui.board.addEventListener('lostpointercapture', event => {
        if (drag?.pointer === event.pointerId) {
            releaseDrag(false);
        }
    });

    window.addEventListener('blur', cancelDrag);

    document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
            cancelDrag();
        }
    });

    /* Tap, click, and keyboard selection */

    ui.board.addEventListener('click', event => {
        if (!ui.overlay.hidden) {
            return;
        }

        const element = event.target.closest('.box, .slot');

        if (!element) {
            return;
        }

        if (element.classList.contains('slot')) {
            if (
                state.phase === PHASE.MOVE &&
                state.moveSelected !== null
            ) {
                moveCase(
                    state.moveSelected,
                    Number(element.dataset.slot)
                );
            }

            return;
        }

        const id = Number(element.dataset.case);

        if (
            suppressClick?.id === id &&
            performance.now() < suppressClick.until &&
            event.detail !== 0
        ) {
            suppressClick = null;
            return;
        }

        if (state.phase === PHASE.MOVE) {
            state.moveSelected = state.moveSelected === id ? null : id;
        } else if (
            state.phase === PHASE.PICK ||
            state.phase === PHASE.GUESS
        ) {
            state.selected = id;
        }

        render();
    });

    /* Dialogs */

    function showModal(content, onClose = null) {
        cancelDrag();

        if (ui.overlay.hidden) {
            returnFocus = document.activeElement;
        }

        ui.modal.innerHTML = content;
        modalClose = onClose;

        ui.overlay.hidden = false;
        ui.app.inert = true;
        ui.app.setAttribute('aria-hidden', 'true');

        ui.modal.scrollTop = 0;
        ui.modal.focus({ preventScroll: true });
    }

    function hideModal() {
        ui.overlay.hidden = true;
        ui.modal.replaceChildren();

        modalClose = null;
        ui.app.inert = false;
        ui.app.removeAttribute('aria-hidden');

        if (returnFocus?.isConnected && !returnFocus.disabled) {
            returnFocus.focus({ preventScroll: true });
        } else {
            const target = ui.actionBtn.disabled ? ui.helpBtn : ui.actionBtn;
            target.focus({ preventScroll: true });
        }
    }

    ui.overlay.addEventListener('keydown', event => {
        if (event.key === 'Escape') {
            event.preventDefault();

            if (modalClose) {
                modalClose();
            }

            return;
        }

        if (event.key !== 'Tab') {
            return;
        }

        const focusable = [
            ...ui.modal.querySelectorAll(
                'button:not(:disabled), input:not(:disabled), [tabindex="0"]'
            )
        ];

        if (!focusable.length) {
            event.preventDefault();
            return;
        }

        const first = focusable[0];
        const last = focusable[focusable.length - 1];

        if (
            event.shiftKey &&
            (
                document.activeElement === first ||
                document.activeElement === ui.modal
            )
        ) {
            event.preventDefault();
            last.focus();
        } else if (
            !event.shiftKey &&
            (
                document.activeElement === last ||
                document.activeElement === ui.modal
            )
        ) {
            event.preventDefault();
            first.focus();
        }
    });

    /* Player setup */

    function showNames() {
        showModal(`
      <p class="eyebrow">Beast Games · Two players</p>

      <h2 id="modalTitle">
        Ten cases.<br>
        One winning choice.
      </h2>

      <p class="modal-copy">
        Take turns hiding and guessing on one screen.
        Find the winning case to win the game.
      </p>

      <form id="namesForm">
        <div class="name-fields">
          <label>
            Player one
            <input
              id="nameA"
              name="playerOne"
              placeholder="First name"
              maxlength="18"
              autocomplete="off"
              autocapitalize="words"
              enterkeyhint="next"
              required
            >
          </label>

          <label>
            Player two
            <input
              id="nameB"
              name="playerTwo"
              placeholder="First name"
              maxlength="18"
              autocomplete="off"
              autocapitalize="words"
              enterkeyhint="go"
              required
            >
          </label>
        </div>

        <div class="form-note" id="nameNote" role="status">
          Enter two different names to get started.
        </div>

        <div class="modal-actions">
          <button class="secondary" id="randomNames" type="button">
            Random names
          </button>

          <button class="primary" id="startBtn" type="submit" disabled>
            Let’s play
          </button>
        </div>
      </form>
    `);

        const a = $('#nameA', ui.modal);
        const b = $('#nameB', ui.modal);
        const start = $('#startBtn', ui.modal);

        const validate = () => {
            const duplicate =
                a.value.trim().toLocaleLowerCase() ===
                b.value.trim().toLocaleLowerCase();

            start.disabled =
                !a.value.trim() ||
                !b.value.trim() ||
                duplicate;

            $('#nameNote', ui.modal).textContent =
                a.value.trim() && b.value.trim() && duplicate
                    ? 'Use different names so you can tell whose turn it is.'
                    : 'A coin flip decides who guesses first.';
        };

        a.addEventListener('input', validate);
        b.addEventListener('input', validate);

        $('#randomNames', ui.modal).addEventListener('click', () => {
            const names = [
                'Nova',
                'Blaze',
                'Shadow',
                'Rogue',
                'Pixel',
                'Viper',
                'Koda',
                'Skye',
                'Atlas',
                'Echo',
                'Jinx',
                'River'
            ];

            a.value = names.splice(
                Math.floor(Math.random() * names.length),
                1
            )[0];

            b.value = names[Math.floor(Math.random() * names.length)];

            validate();
        });

        $('#namesForm', ui.modal).addEventListener('submit', event => {
            event.preventDefault();
            validate();

            if (start.disabled) {
                return;
            }

            state.players = {
                A: a.value.trim(),
                B: b.value.trim()
            };

            document.activeElement.blur();
            startCoinFlip();
        });
    }

    /* Coin flip */

    function startCoinFlip() {
        cancelTimers();
        setPhase(PHASE.COIN);

        showModal(`
      <p class="eyebrow">First things first</p>
      <h2 id="modalTitle">Who goes first?</h2>

      <p class="modal-copy">
        The coin decides who takes the first guess.
      </p>

      <div class="coin-wrap">
        <div class="coin spin" id="coin" aria-hidden="true">
          <div class="coin-face coin-front">
            <span class="coin-name">${name('A')}</span>
            <span class="coin-caption">Heads</span>
          </div>

          <div class="coin-face coin-back">
            <span class="coin-name">${name('B')}</span>
            <span class="coin-caption">Tails</span>
          </div>
        </div>

        <div class="coin-message" id="coinMessage" role="status">
          Flipping the coin…
        </div>
      </div>

      <div class="modal-actions">
        <button class="secondary" id="skipCoin">
          Skip animation
        </button>
      </div>
    `);

        let finished = false;

        const finish = () => {
            if (finished || state.phase !== PHASE.COIN) {
                return;
            }

            finished = true;
            cancelTimers();

            state.guesser = Math.random() < .5 ? 'A' : 'B';
            state.hider = otherPlayer(state.guesser);

            const coin = $('#coin', ui.modal);

            coin.classList.remove('spin');
            coin.style.transform =
                state.guesser === 'A'
                    ? 'rotateY(0deg)'
                    : 'rotateY(180deg)';

            $('#coinMessage', ui.modal).textContent =
                `${state.players[state.guesser]} guesses first. ` +
                `${state.players[state.hider]} hides. Get ready…`;

            $('#skipCoin', ui.modal).hidden = true;

            later(beginRound, COIN_RESULT_MS);
        };

        $('#skipCoin', ui.modal).addEventListener('click', finish);

        const reducedMotion = window.matchMedia(
            '(prefers-reduced-motion: reduce)'
        ).matches;

        later(finish, reducedMotion ? 0 : COIN_SPIN_MS);
    }

    /* Round flow */

    function beginRound() {
        state.winner = null;
        setPhase(PHASE.PRIVATE);

        showModal(`
      <p class="eyebrow">
        Round ${state.round} · Private turn
      </p>

      <h2 id="modalTitle">
        ${name(state.guesser)}, look away.
      </h2>

      <p class="modal-copy">
        Give the screen to <strong>${name(state.hider)}</strong>
        to rearrange the cases and choose the winner.
      </p>

      <div class="modal-actions">
        <button class="primary" id="readyMove">
          I’m ${name(state.hider)}. I’m ready.
        </button>
      </div>
    `);

        $('#readyMove', ui.modal).addEventListener('click', () => {
            setPhase(PHASE.MOVE);
            hideModal();
        });
    }

    function lockWinner() {
        if (state.selected === null) {
            return;
        }

        state.winner = state.selected;

        // Clear the visual and accessible selection before handing over the screen.
        setPhase(PHASE.PASS);

        showModal(`
      <p class="eyebrow">Choice locked</p>
      <h2 id="modalTitle">Pass the screen.</h2>

      <p class="modal-copy">
        It’s <strong>${name(state.guesser)}’s</strong> turn to guess.
        Your choice stays secret.
      </p>

      <div class="modal-actions">
        <button class="primary" id="readyGuess">
          I’m ${name(state.guesser)}. Let me guess.
        </button>
      </div>
    `);

        $('#readyGuess', ui.modal).addEventListener('click', () => {
            setPhase(PHASE.GUESS);
            hideModal();
        });
    }

    function lockGuess() {
        const picked = state.selected;
        const winner = state.winner;

        if (picked === null || winner === null) {
            return;
        }

        if (picked === winner) {
            setPhase(PHASE.WIN);

            document.body.classList.add('win');
            ui.boardShell.classList.add('win-glow');

            showModal(`
        <p class="eyebrow">The winning pick</p>

        <div class="result-badge" aria-label="Winning case">
          ${winner}
        </div>

        <h2 id="modalTitle">
          ${name(state.guesser)} wins!
        </h2>

        <p class="modal-copy">
          Case ${winner} was the winner.
          You found it in round ${state.round}.
        </p>

        <div class="modal-actions">
          <button class="secondary" id="newPlayers">
            New players
          </button>

          <button class="primary" id="rematch">
            Play again
          </button>
        </div>
      `);

            $('#rematch', ui.modal).addEventListener('click', () => {
                resetGame(true);
            });

            $('#newPlayers', ui.modal).addEventListener('click', () => {
                resetGame();
            });

            return;
        }

        // Freeze input immediately so double taps cannot submit another guess.
        setPhase(PHASE.RESULT);

        state.positions.delete(picked);
        cases.get(picked).remove();
        cases.delete(picked);

        render();

        showModal(`
      <p class="eyebrow">Not this time</p>

      <div class="result-badge">
        ${winner}
      </div>

      <h2 id="modalTitle">
        The winner was case ${winner}.
      </h2>

      <p class="modal-copy">
        Case ${picked} is out.
        ${state.positions.size}
        ${state.positions.size === 1 ? 'case remains' : 'cases remain'}.
        Switch roles and try again.
      </p>

      <div class="modal-actions">
        <button class="primary" id="nextRound">
          Next round
        </button>
      </div>
    `);

        $('#nextRound', ui.modal).addEventListener('click', () => {
            [state.guesser, state.hider] = [state.hider, state.guesser];
            state.round++;
            beginRound();
        });
    }

    /* Main controls */

    ui.actionBtn.addEventListener('click', () => {
        if (state.phase === PHASE.MOVE) {
            setPhase(PHASE.PICK);
        } else if (state.phase === PHASE.PICK) {
            lockWinner();
        } else if (state.phase === PHASE.GUESS) {
            lockGuess();
        }
    });

    ui.helpBtn.addEventListener('click', () => {
        if (!ui.overlay.hidden) {
            return;
        }

        showModal(`
      <p class="eyebrow">The case game</p>
      <h2 id="modalTitle">How to play</h2>

      <ol class="rules-list">
        <li>
          A coin flip picks the first guesser.
          The other player hides.
        </li>

        <li>
          The guesser looks away. The hider moves cases into empty
          spaces, then selects and locks the winning case.
        </li>

        <li>
          Pass the screen. The guesser selects a case and locks
          in the guess.
        </li>

        <li>
          A correct guess wins. Otherwise, remove the guessed case,
          switch roles, and play again.
        </li>
      </ol>

      <p class="form-note">
        To move: drag a case, or tap it and then tap an empty space.
        Keyboard: use Tab to reach a case or space, then Enter or
        Space to select.
      </p>

      <div class="modal-actions">
        <button class="primary" id="closeHelp">
          Back to game
        </button>
      </div>
    `, hideModal);

        $('#closeHelp', ui.modal).addEventListener('click', hideModal);
    });

    ui.resetBtn.addEventListener('click', () => {
        if (!ui.overlay.hidden) {
            return;
        }

        showModal(`
      <p class="eyebrow">Fresh start</p>
      <h2 id="modalTitle">Start a new game?</h2>

      <p class="modal-copy">
        This ends the current game and brings back all ten cases.
      </p>

      <div class="modal-actions">
        <button class="secondary" id="cancelReset">
          Keep playing
        </button>

        <button class="primary" id="confirmReset">
          New game
        </button>
      </div>
    `, hideModal);

        $('#cancelReset', ui.modal).addEventListener('click', hideModal);

        $('#confirmReset', ui.modal).addEventListener('click', () => {
            resetGame();
        });
    });

    /* Screen resizing and mobile keyboard */

    new ResizeObserver(scheduleLayout).observe(ui.board);

    window.addEventListener('resize', scheduleLayout);

    // Keep dialogs above the virtual keyboard without disabling pinch-to-zoom.
    function fitVisualViewport() {
        const viewport = window.visualViewport;

        if (!viewport || viewport.scale !== 1) {
            return;
        }

        ui.overlay.style.height = `${viewport.height}px`;
        ui.overlay.style.top = `${viewport.offsetTop}px`;

        scheduleLayout();
    }

    window.visualViewport?.addEventListener('resize', fitVisualViewport);
    window.visualViewport?.addEventListener('scroll', fitVisualViewport);

    /* Initialize */

    resetGame();
    fitVisualViewport();
})();