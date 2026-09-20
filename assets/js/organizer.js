// ===========================
// DATA MODEL
// ===========================
const STORAGE_KEY = 'focusOrganizerState';
const FOCUS_HANDOFF_KEY = 'focusAppState';
const RECURRENCE = window.FocusRecurrence;
const MY_DAY_BLOCK_ID = 'my-day';
// Apenas a faixa central da tarefa aceita a conversão em subtarefa. As bordas
// continuam livres para facilitar a reordenação por arrastar e soltar.
const SUBTASK_DROP_ZONE_RATIO = 0.20;
const BLOCK_DRAG_SCROLL_EDGE = 120;
const BLOCK_DRAG_SCROLL_MAX_SPEED_UP = 24;
const BLOCK_DRAG_SCROLL_MAX_SPEED_DOWN = 42;
const BLOCK_DROP_DIRECTIONAL_THRESHOLD = 0.35;
const BLOCK_DRAG_WHEEL_SPEED_DOWN = 3;
const BLOCK_DRAG_WHEEL_SPEED_UP = 3;

const DAY_CONFIG = {
    hoje:    { label: 'Hoje',    color: 'var(--status-today)',    bg: 'rgba(37,99,235,0.12)' },
    amanha:  { label: 'Amanhã',  color: 'var(--status-tomorrow)', bg: 'rgba(249,115,22,0.12)' },
    segunda: { label: 'Segunda', color: 'var(--day-seg)', bg: 'rgba(20,184,166,0.12)' },
    terca:   { label: 'Terça',   color: 'var(--day-ter)', bg: 'rgba(139,92,246,0.12)' },
    quarta:  { label: 'Quarta',  color: 'var(--day-qua)', bg: 'rgba(34,197,94,0.12)' },
    quinta:  { label: 'Quinta',  color: 'var(--day-qui)', bg: 'rgba(219,39,119,0.12)' },
    sexta:   { label: 'Sexta',   color: 'var(--day-sex)', bg: 'rgba(14,165,233,0.12)' },
    sabado:  { label: 'Sábado',  color: 'var(--day-sab)', bg: 'rgba(161,98,7,0.12)' },
    domingo: { label: 'Domingo', color: 'var(--day-dom)', bg: 'rgba(132,204,22,0.12)' },
};

const DEFAULT_BLOCKS = [
    { id: MY_DAY_BLOCK_ID, title: 'Meu dia',       colorVar: 'important', tasks: [], specialType: 'my-day' },
    { id: genId(), title: 'Urgente',        colorVar: 'urgent',    tasks: [] },
    { id: genId(), title: 'Importante',     colorVar: 'important', tasks: [] },
    { id: genId(), title: 'Pode esperar',   colorVar: 'canwait',   tasks: [] },
    { id: genId(), title: 'Tarefas rÃ¡pidas', colorVar: 'quick',    tasks: [] },
];

const BLOCK_COLORS = ['urgent', 'important', 'canwait', 'quick', 'blue', 'teal', 'pink', 'gray', 'yellow', 'indigo'];
let nextColorIndex = 0;

let state = {
    inbox: [],
    blocks: [],
    deletedItems: [],
    activeFilter: 'all',
    searchQuery: '',
    filterOrder: [],
    weekdayOrder: [],
    collapsedCompletedSections: [],
};

const DEFAULT_FILTER_ORDER = ['all', 'important', 'atrasadas', 'hoje', 'amanha', 'weekdays', 'futuras'];
const DEFAULT_WEEKDAY_ORDER = ['segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado', 'domingo'];

function normalizeFilterOrders(source) {
    const normalize = (value, defaults) => [...new Set([...(Array.isArray(value) ? value : []), ...defaults].filter(id => defaults.includes(id)))];
    state.filterOrder = normalize(source?.filterOrder, DEFAULT_FILTER_ORDER);
    state.weekdayOrder = normalize(source?.weekdayOrder, DEFAULT_WEEKDAY_ORDER);
}

let dragData = null; // { taskId, sourceType: 'inbox'|'block', sourceBlockId? }
let pendingDrop = null;
let blockDragPointer = null;
let blockDragScrollFrame = null;
let blockPointerDrag = null;
let recurrenceWakeTimer = null;
let dateRefreshTimer = null;
const collapsedCompletedSections = new Set();

function restoreCollapsedCompletedSections(source) {
    const savedSections = Array.isArray(source?.collapsedCompletedSections)
        ? source.collapsedCompletedSections.filter(key => typeof key === 'string')
        : [];
    state.collapsedCompletedSections = [...new Set(savedSections)];
    collapsedCompletedSections.clear();
    state.collapsedCompletedSections.forEach(key => collapsedCompletedSections.add(key));
}

function saveCollapsedCompletedSections() {
    state.collapsedCompletedSections = [...collapsedCompletedSections];
    saveState();
}

function previewDrop(container, before, indicator, after = false) {
    document.querySelectorAll('.drop-before, .drop-after').forEach(el => el.classList.remove('drop-before', 'drop-after'));
    document.querySelectorAll('.block-swap-target').forEach(el => el.classList.remove('block-swap-target'));
    pendingDrop = { container, before };
    if (indicator) indicator.classList.add(after ? 'drop-after' : 'drop-before');
}

function prefersReducedMotion() {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function captureLayout(selector) {
    const positions = new Map();
    if (prefersReducedMotion()) return positions;
    document.querySelectorAll(selector).forEach(element => {
        positions.set(element, element.getBoundingClientRect());
    });
    return positions;
}

function animateLayoutFrom(positions) {
    if (positions.size === 0) return;
    requestAnimationFrame(() => {
        positions.forEach((before, element) => {
            if (!element.isConnected || typeof element.animate !== 'function') return;
            const after = element.getBoundingClientRect();
            const deltaX = before.left - after.left;
            const deltaY = before.top - after.top;
            if (Math.abs(deltaX) < 1 && Math.abs(deltaY) < 1) return;
            element.animate(
                [
                    { transform: `translate(${deltaX}px, ${deltaY}px)` },
                    { transform: 'translate(0, 0)' }
                ],
                { duration: 180, easing: 'cubic-bezier(0.2, 0, 0, 1)' }
            );
        });
    });
}

function commitDrop(e) {
    if (!dragData || !pendingDrop) return;
    e.preventDefault();
    e.stopPropagation();
    const positions = captureLayout(dragData.blockId ? '.block-card' : '.task-card:not(.hidden-by-filter)');
    const dragging = document.querySelector(dragData.blockId ? '.dragging-block' : '.dragging');
    const { container, before, swapWith } = pendingDrop;
    if (dragging && swapWith && swapWith !== dragging) {
        const placeholder = document.createComment('block-swap');
        container.replaceChild(placeholder, dragging);
        container.replaceChild(dragging, swapWith);
        container.replaceChild(swapWith, placeholder);
    } else if (dragging && before !== dragging) {
        container.insertBefore(dragging, before || null);
    }
    clearAllDragOver();
    animateLayoutFrom(positions);
}

function clearTaskConversionTargets() {
    document.querySelectorAll('.task-convert-target, .task-convert-unavailable')
        .forEach(card => card.classList.remove('task-convert-target', 'task-convert-unavailable'));
}

function canConvertTaskToSubtask(sourceTask, targetTask) {
    return sourceTask && targetTask && sourceTask.id !== targetTask.id && (!sourceTask.subtasks || sourceTask.subtasks.length === 0);
}

function convertTaskToSubtask(sourceTaskId, targetTask) {
    const sourceLocation = findTaskLocation(sourceTaskId);
    const sourceTask = getTaskById(sourceTaskId);
    if (!canConvertTaskToSubtask(sourceTask, targetTask)) return false;

    if (!targetTask.subtasks) targetTask.subtasks = [];
    targetTask.subtasks.push({
        id: sourceTask.id,
        text: sourceTask.text,
        completed: sourceTask.completed
    });
    removeTaskFromSource(sourceTask.id);
    saveState();
    refreshTaskContainerState(sourceLocation);
    refreshTaskCard(targetTask);

    const removedFields = ['a data'];
    if (sourceTask.important) removedFields.push('a importÃ¢ncia');
    if (sourceTask.recurrence) removedFields.push('a repetição');
    showToast(`Tarefa convertida em subtarefa. Foi removida ${removedFields.join(' e ')}.`);
    return true;
}

// ===========================
// UTILITIES
// ===========================
function genId() {
    return 'id_' + Math.random().toString(36).substr(2, 9) + Date.now().toString(36);
}

function createTask(text) {
    return {
        id: genId(),
        text: text.trim(),
        completed: false,
        important: false,
        days: [],
        subtasks: [],
        recurrence: null,
    };
}

function isMyDayBlock(block) {
    return Boolean(block && (block.id === MY_DAY_BLOCK_ID || block.specialType === 'my-day'));
}

function ensureMyDayBlock() {
    if (!Array.isArray(state.blocks)) {
        state.blocks = [];
    }
    let myDayBlock = state.blocks.find(isMyDayBlock);
    let changed = false;
    if (!myDayBlock) {
        myDayBlock = {
            id: MY_DAY_BLOCK_ID,
            title: 'Meu dia',
            colorVar: 'important',
            tasks: [],
            specialType: 'my-day',
        };
        state.blocks.unshift(myDayBlock);
        return true;
    }
    if (myDayBlock.specialType !== 'my-day') { myDayBlock.specialType = 'my-day'; changed = true; }
    if (myDayBlock.title !== 'Meu dia') { myDayBlock.title = 'Meu dia'; changed = true; }
    if (!Array.isArray(myDayBlock.tasks)) { myDayBlock.tasks = []; changed = true; }
    const otherBlocks = state.blocks.filter(block => block !== myDayBlock);
    if (state.blocks[0] !== myDayBlock) {
        state.blocks = [myDayBlock, ...otherBlocks];
        changed = true;
    }
    return changed;
}

function setTaskDate(task, date = RECURRENCE.today()) {
    const category = RECURRENCE.getCategoryForDate(date);
    task.days = [category, date].filter(Boolean);
}

function normalizeTaskDates(task) {
    if (!task || !Array.isArray(task.days)) return false;
    const exactDate = getTaskExactDate(task);
    const legacyCategory = task.days.find(day => Object.prototype.hasOwnProperty.call(DAY_CONFIG, day));
    let normalizedDays = [];
    if (exactDate) {
        normalizedDays = [RECURRENCE.getCategoryForDate(exactDate), exactDate].filter(Boolean);
    } else if (legacyCategory) {
        const derivedDate = getDateForKey(legacyCategory);
        normalizedDays = [RECURRENCE.getCategoryForDate(derivedDate), derivedDate].filter(Boolean);
    }
    if (JSON.stringify(task.days) === JSON.stringify(normalizedDays)) return false;
    task.days = normalizedDays;
    return true;
}

function normalizeOrganizerTaskDates() {
    let changed = false;
    state.inbox.forEach(task => { changed = normalizeTaskDates(task) || changed; });
    state.blocks.forEach(block => (block.tasks || []).forEach(task => {
        changed = normalizeTaskDates(task) || changed;
    }));
    return changed;
}

function assignTaskToMyDay(task) {
    setTaskDate(task);
}

function getTaskExactDate(task) {
    return (task.days || []).find(day => RECURRENCE.parseLocalDate(day)) || null;
}

function getRecurrenceSeriesId(task) {
    return task.recurrence?.seriesId || `series_${task.id || genId()}`;
}

function ensureRecurringTaskSchedule(task, referenceDate = RECURRENCE.today()) {
    const recurrence = RECURRENCE.normalize(task.recurrence);
    if (!task.completed || !recurrence || recurrence.nextDate || recurrence.spawnedTaskId) return false;
    const anchorDate = getTaskExactDate(task) || referenceDate;
    task.recurrence = {
        ...RECURRENCE.configOnly(recurrence),
        seriesId: recurrence.seriesId || getRecurrenceSeriesId(task),
        nextDate: RECURRENCE.getNextDate(anchorDate, recurrence, referenceDate),
    };
    if (!task.completedAt) task.completedAt = new Date().toISOString();
    return true;
}

function normalizeTaskShape(task) {
    if (!task || typeof task !== 'object') return false;
    let changed = false;
    if (!Array.isArray(task.days)) { task.days = []; changed = true; }
    if (!Array.isArray(task.subtasks)) { task.subtasks = []; changed = true; }
    if (typeof task.important !== 'boolean') { task.important = false; changed = true; }
    const normalizedRecurrence = RECURRENCE.normalize(task.recurrence);
    if (task.recurrence && !normalizedRecurrence) { task.recurrence = null; changed = true; }
    if (normalizedRecurrence && JSON.stringify(normalizedRecurrence) !== JSON.stringify(task.recurrence)) {
        task.recurrence = normalizedRecurrence;
        changed = true;
    }
    const recurrenceChanged = ensureRecurringTaskSchedule(task);
    const datesChanged = normalizeTaskDates(task);
    return recurrenceChanged || datesChanged || changed;
}

function normalizeOrganizerTasks() {
    let changed = false;
    state.inbox.forEach(task => { changed = normalizeTaskShape(task) || changed; });
    state.blocks.forEach(block => {
        if (!Array.isArray(block.tasks)) { block.tasks = []; changed = true; }
        block.tasks.forEach(task => { changed = normalizeTaskShape(task) || changed; });
    });
    return changed;
}

function setTaskCompleted(task, completed) {
    task.completed = completed;
    if (completed) {
        task.completedAt = new Date().toISOString();
        ensureRecurringTaskSchedule(task);
    } else {
        delete task.completedAt;
        if (task.recurrence && !task.recurrence.spawnedTaskId) delete task.recurrence.nextDate;
    }
    scheduleRecurrenceWakeUp();
}

function buildRecurringOccurrence(task, dueDate) {
    const recurrence = RECURRENCE.normalize(task.recurrence);
    const seriesId = recurrence.seriesId || getRecurrenceSeriesId(task);
    const safeSeriesId = seriesId.replace(/[^a-zA-Z0-9_-]/g, '');
    const occurrence = createTask(task.text);
    occurrence.id = `rec_${safeSeriesId}_${dueDate.replaceAll('-', '')}`;
    occurrence.important = Boolean(task.important);
    occurrence.days = [getCategoryForDate(dueDate), dueDate].filter(Boolean);
    occurrence.subtasks = (task.subtasks || []).map(subtask => ({
        ...subtask,
        id: genId(),
        completed: false,
    }));
    occurrence.recurrence = {
        ...RECURRENCE.configOnly(recurrence),
        seriesId,
    };
    return occurrence;
}

function materializeDueRecurrences() {
    const today = RECURRENCE.today();
    let createdCount = 0;
    const collections = [state.inbox, ...state.blocks.map(block => block.tasks)];

    collections.forEach(tasks => {
        [...tasks].forEach(task => {
            const recurrence = RECURRENCE.normalize(task.recurrence);
            if (!task.completed || !recurrence?.nextDate || recurrence.spawnedTaskId || recurrence.nextDate > today) return;

            const occurrence = buildRecurringOccurrence(task, recurrence.nextDate);
            const existing = getTaskById(occurrence.id);
            if (!existing) {
                const taskIndex = tasks.indexOf(task);
                tasks.splice(taskIndex + 1, 0, occurrence);
                createdCount++;
            }
            task.recurrence = { ...recurrence, spawnedTaskId: occurrence.id };
        });
    });

    return createdCount;
}

function scheduleRecurrenceWakeUp() {
    window.clearTimeout(recurrenceWakeTimer);
    recurrenceWakeTimer = null;
    const scheduledDates = [];
    const collect = task => {
        const recurrence = RECURRENCE.normalize(task.recurrence);
        if (task.completed && recurrence?.nextDate && !recurrence.spawnedTaskId) scheduledDates.push(recurrence.nextDate);
    };
    state.inbox.forEach(collect);
    state.blocks.forEach(block => block.tasks.forEach(collect));
    if (scheduledDates.length === 0) return;

    scheduledDates.sort();
    const nextDate = RECURRENCE.parseLocalDate(scheduledDates[0]);
    const delay = Math.max(100, nextDate.getTime() - Date.now() + 1000);
    recurrenceWakeTimer = window.setTimeout(runRecurrenceActivation, Math.min(delay, 2147483647));
}

function runRecurrenceActivation() {
    const datesUpdated = normalizeOrganizerTaskDates();
    const createdCount = materializeDueRecurrences();
    if (createdCount > 0 || datesUpdated) {
        saveState();
        refreshTaskContainersState();
        if (createdCount > 0) {
            showToast(createdCount === 1 ? 'Tarefa recorrente adicionada.' : `${createdCount} tarefas recorrentes adicionadas.`);
        }
    }
    scheduleRecurrenceWakeUp();
    scheduleDateRefresh();
}

function scheduleDateRefresh() {
    window.clearTimeout(dateRefreshTimer);
    const nextMidnight = new Date();
    nextMidnight.setHours(24, 0, 1, 0);
    dateRefreshTimer = window.setTimeout(runRecurrenceActivation, Math.max(100, nextMidnight.getTime() - Date.now()));
}

function normalizeTaskImportance(task) {
    if (!task || typeof task !== 'object' || typeof task.important === 'boolean') return false;
    task.important = false;
    return true;
}

function normalizeOrganizerTaskImportance() {
    let changed = false;
    state.inbox.forEach(task => { changed = normalizeTaskImportance(task) || changed; });
    state.blocks.forEach(block => (block.tasks || []).forEach(task => { changed = normalizeTaskImportance(task) || changed; }));
    return changed;
}

function getDragAfterElement(container, y) {
    const draggableElements = [...container.querySelectorAll(':scope > .task-card:not(.dragging):not(.hidden-by-filter)')];
    
    return draggableElements.reduce((closest, child) => {
        const box = child.getBoundingClientRect();
        const offset = y - box.top - box.height / 2;
        if (offset < 0 && offset > closest.offset) {
            return { offset: offset, element: child };
        } else {
            return closest;
        }
    }, { offset: Number.NEGATIVE_INFINITY }).element;
}

function getDragDropTargetBlock(container, x, y) {
    const blocks = [...container.querySelectorAll('.block-card:not(.dragging-block)')]
        .map(element => ({ element, box: element.getBoundingClientRect() }));
    if (blocks.length === 0) return null;

    // Agrupa os cartões pelas linhas visuais da grade. Dessa forma, os espaços
    // entre os blocos também funcionam como áreas válidas para reposicionamento.
    const rows = [];
    blocks.forEach(item => {
        let row = rows.find(candidate => Math.abs(candidate.top - item.box.top) < 24);
        if (!row) {
            row = { top: item.box.top, items: [] };
            rows.push(row);
        }
        row.items.push(item);
    });
    rows.sort((a, b) => a.top - b.top);
    rows.forEach(row => row.items.sort((a, b) => a.box.left - b.box.left));

    const firstRow = rows[0];
    const lastRow = rows[rows.length - 1];
    const lastRowCenter = lastRow.top + Math.max(...lastRow.items.map(item => item.box.height)) / 2;
    if (y > lastRowCenter) {
        const lastItem = lastRow.items[lastRow.items.length - 1];
        return { before: null, indicator: lastItem.element, after: true };
    }

    let row = firstRow;
    for (let index = 0; index < rows.length - 1; index++) {
        const current = rows[index];
        const next = rows[index + 1];
        const currentCenter = current.top + Math.max(...current.items.map(item => item.box.height)) / 2;
        const nextCenter = next.top + Math.max(...next.items.map(item => item.box.height)) / 2;
        if (y < (currentCenter + nextCenter) / 2) {
            row = current;
            break;
        }
        row = next;
    }

    const draggingBox = document.querySelector('.dragging-block')?.getBoundingClientRect();
    const movingRight = draggingBox && x > draggingBox.left + draggingBox.width / 2;
    const movingLeft = draggingBox && x < draggingBox.left + draggingBox.width / 2;
    const threshold = movingRight
        ? BLOCK_DROP_DIRECTIONAL_THRESHOLD
        : movingLeft
            ? 1 - BLOCK_DROP_DIRECTIONAL_THRESHOLD
            : 0.5;
    const itemBeforePointer = row.items.find(item => x < item.box.left + item.box.width * threshold);
    if (itemBeforePointer) {
        // Ao mover para a direita, a posição escolhida fica logo após o cartão
        // anterior. Destacá-lo torna o destino visual óbvio, em vez de acender
        // a borda superior do próximo cartão da grade.
        const itemIndex = row.items.indexOf(itemBeforePointer);
        if (movingRight && itemIndex > 0) {
            return { before: itemBeforePointer.element, indicator: row.items[itemIndex - 1].element, after: true };
        }
        return { before: itemBeforePointer.element, indicator: itemBeforePointer.element, after: false };
    }

    const rowIndex = rows.indexOf(row);
    const nextRowFirstItem = rows[rowIndex + 1]?.items[0];
    const lastItem = row.items[row.items.length - 1];
    return nextRowFirstItem
        ? { before: nextRowFirstItem.element, indicator: lastItem.element, after: true }
        : { before: null, indicator: lastItem.element, after: true };
}

function previewBlockDrop(blocksPanel, x, y) {
    const dragging = document.querySelector('.dragging-block');
    const swapTarget = [...blocksPanel.querySelectorAll('.block-card:not(.dragging-block)')].find(card => {
        const box = card.getBoundingClientRect();
        return x >= box.left && x <= box.right && y >= box.top && y <= box.bottom;
    });

    if (dragging && swapTarget) {
        document.querySelectorAll('.drop-before, .drop-after').forEach(el => el.classList.remove('drop-before', 'drop-after'));
        document.querySelectorAll('.block-swap-target').forEach(el => el.classList.remove('block-swap-target'));
        swapTarget.classList.add('block-swap-target');
        pendingDrop = { container: blocksPanel, swapWith: swapTarget };
        return;
    }

    const target = getDragDropTargetBlock(blocksPanel, x, y);
    if (dragging && target && target.before !== dragging) {
        previewDrop(blocksPanel, target.before, target.indicator, target.after);
    } else {
        clearAllDragOver();
    }
}

function getAutoScrollSpeed(pointer, start, end) {
    const edge = Math.min(BLOCK_DRAG_SCROLL_EDGE, Math.max(24, (end - start) / 3));
    if (pointer < start + edge) return -Math.ceil(BLOCK_DRAG_SCROLL_MAX_SPEED_UP * (1 - (pointer - start) / edge));
    if (pointer > end - edge) return Math.ceil(BLOCK_DRAG_SCROLL_MAX_SPEED_DOWN * (1 - (end - pointer) / edge));
    return 0;
}

function stopBlockDragAutoScroll() {
    blockDragPointer = null;
    if (blockDragScrollFrame) cancelAnimationFrame(blockDragScrollFrame);
    blockDragScrollFrame = null;
}

function updateBlockDragAutoScroll(x, y) {
    blockDragPointer = { x, y };
    if (!blockDragScrollFrame) blockDragScrollFrame = requestAnimationFrame(runBlockDragAutoScroll);
}

function runBlockDragAutoScroll() {
    blockDragScrollFrame = null;
    if (!dragData?.blockId || !blockDragPointer) return;

    const blocksPanel = document.getElementById('blocks-panel');
    const panelBox = blocksPanel.getBoundingClientRect();
    const { x, y } = blockDragPointer;
    let didScrollPanel = false;

    if (x >= panelBox.left && x <= panelBox.right && y >= panelBox.top && y <= panelBox.bottom) {
        const panelSpeed = getAutoScrollSpeed(y, panelBox.top, panelBox.bottom);
        if (panelSpeed) {
            const previousScrollTop = blocksPanel.scrollTop;
            blocksPanel.scrollBy({ top: panelSpeed });
            didScrollPanel = blocksPanel.scrollTop !== previousScrollTop;
        }
    }

    if (!didScrollPanel) {
        const pageSpeed = getAutoScrollSpeed(y, 0, window.innerHeight);
        if (pageSpeed) window.scrollBy({ top: pageSpeed });
    }

    previewBlockDrop(blocksPanel, x, y);
    blockDragScrollFrame = requestAnimationFrame(runBlockDragAutoScroll);
}

function scrollBlocksWhileDragging(event) {
    if (!dragData?.blockId) return;

    const blocksPanel = document.getElementById('blocks-panel');
    const wheelSpeed = event.deltaY > 0 ? BLOCK_DRAG_WHEEL_SPEED_DOWN : BLOCK_DRAG_WHEEL_SPEED_UP;
    const scrollAmount = event.deltaY * wheelSpeed;
    const previousScrollTop = blocksPanel.scrollTop;
    blocksPanel.scrollBy({ top: scrollAmount });

    // Em telas onde a rolagem pertence à página, usa a mesma roda do mouse.
    if (blocksPanel.scrollTop === previousScrollTop) window.scrollBy({ top: scrollAmount });
    event.preventDefault();

    if (blockDragPointer) previewBlockDrop(blocksPanel, blockDragPointer.x, blockDragPointer.y);
}

function rebuildStateFromDOM() {
    const previousMyDayTaskIds = new Set(
        state.blocks.find(isMyDayBlock)?.tasks.map(task => task.id) || []
    );
    const allTasks = new Map();
    state.inbox.forEach(t => allTasks.set(t.id, t));
    state.blocks.forEach(b => b.tasks.forEach(t => allTasks.set(t.id, t)));

    const inboxTasksEl = document.getElementById('inbox-tasks');
    if (inboxTasksEl) {
        state.inbox = Array.from(inboxTasksEl.querySelectorAll('.task-card'))
            .map(card => allTasks.get(card.dataset.taskId))
            .filter(Boolean);
    }

    const newBlocks = [];
    document.querySelectorAll('.block-card').forEach(blockCard => {
        const blockId = blockCard.dataset.blockId;
        const block = state.blocks.find(b => b.id === blockId);
        if (block) {
            block.tasks = Array.from(blockCard.querySelectorAll('.task-card'))
                .map(card => allTasks.get(card.dataset.taskId))
                .filter(Boolean);
            newBlocks.push(block);
        }
    });
    if (newBlocks.length === state.blocks.length) {
        state.blocks = newBlocks;
    }

    const myDayPositionRestored = ensureMyDayBlock();
    const myDayBlock = state.blocks.find(isMyDayBlock);
    myDayBlock.tasks
        .filter(task => !previousMyDayTaskIds.has(task.id))
        .forEach(assignTaskToMyDay);

    saveState();
    if (myDayPositionRestored) {
        renderInitialView();
        return;
    }
    refreshTaskContainersState();
    refreshTaskVisibility();
}

// ===========================
// PERSISTENCE
// ===========================
function saveState() {
    try {
        if (window.FocusCloud?.writeLocalState) {
            window.FocusCloud.writeLocalState(STORAGE_KEY, state);
        } else {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
        }
        window.FocusCloud?.scheduleOrganizerSave(state);
    } catch (e) {
        console.error('Failed to save state:', e);
    }
}

async function loadState() {
    let localState = null;
    let localSavedAt = null;
    try {
        if (window.FocusCloud?.readLocalRecord) {
            const localRecord = window.FocusCloud.readLocalRecord(STORAGE_KEY);
            localState = localRecord.state;
            localSavedAt = localRecord.savedAt;
        } else {
            const data = localStorage.getItem(STORAGE_KEY);
            if (data) localState = JSON.parse(data);
        }
    } catch (e) {
        console.error('Failed to load state:', e);
    }

    if (window.FocusCloud?.configured) {
        try {
            const cloudRecord = await window.FocusCloud.loadOrganizerRecord();
            const cloudState = cloudRecord.state;
            if (cloudState && Array.isArray(cloudState.blocks)) {
                const localHasContent = Boolean(localState && (
                    (localState.inbox || []).length > 0 ||
                    (localState.blocks || []).some(block => (block.tasks || []).length > 0)
                ));
                const cloudHasContent = (cloudState.inbox || []).length > 0 ||
                    (cloudState.blocks || []).some(block => (block.tasks || []).length > 0);
                const localIsNewer = localSavedAt && cloudRecord.updatedAt &&
                    new Date(localSavedAt).getTime() > new Date(cloudRecord.updatedAt).getTime();
                if (localHasContent && (!cloudHasContent || localIsNewer)) {
                    state.inbox = localState.inbox || [];
                    state.blocks = localState.blocks || [];
                    state.deletedItems = Array.isArray(localState.deletedItems) ? localState.deletedItems : [];
                    state.activeFilter = localState.activeFilter || 'all';
                    state.searchQuery = localState.searchQuery || '';
                    state.collapsedCompletedSections = localState.collapsedCompletedSections || [];
                    normalizeFilterOrders(localState);
                    normalizeOrganizerTaskImportance();
                    window.FocusCloud?.showStatus(
                        !cloudHasContent
                            ? 'A cÃ³pia local foi preservada; a nuvem estava vazia'
                            : 'AlteraÃ§Ãµes locais mais recentes foram preservadas',
                        'warning'
                    );
                    // Mantém a cópia local protegida e tenta sincronizá-la com a nuvem.
                    // O salvamento usa controle otimista de conflito no Supabase.
                    window.FocusCloud?.scheduleOrganizerSave(state);
                    return true;
                }
                state.inbox = cloudState.inbox || [];
                state.blocks = cloudState.blocks || [];
                state.deletedItems = Array.isArray(cloudState.deletedItems) ? cloudState.deletedItems : [];
                state.activeFilter = cloudState.activeFilter || 'all';
                state.searchQuery = cloudState.searchQuery || '';
                state.collapsedCompletedSections = cloudState.collapsedCompletedSections || [];
                normalizeFilterOrders(cloudState);
                const normalized = normalizeOrganizerTaskImportance();
                window.FocusCloud.writeLocalState(STORAGE_KEY, state, {
                    savedAt: cloudRecord.updatedAt,
                    source: 'cloud',
                    reason: 'before-cloud-restore'
                });
                if (normalized) window.FocusCloud?.scheduleOrganizerSave(state);
                return true;
            }
        } catch (e) {
            console.error('Failed to load cloud state:', e);
            window.FocusCloud.showStatus('Usando a cÃ³pia local', 'warning');
        }
    }

    if (localState) {
        state.inbox = localState.inbox || [];
        state.blocks = localState.blocks || [];
        state.deletedItems = Array.isArray(localState.deletedItems) ? localState.deletedItems : [];
        state.activeFilter = localState.activeFilter || 'all';
        state.searchQuery = localState.searchQuery || '';
        state.collapsedCompletedSections = localState.collapsedCompletedSections || [];
        normalizeFilterOrders(localState);
        normalizeOrganizerTaskImportance();
        return true;
    }

    return false;
}

// ===========================
// THEME
// ===========================
function initTheme() {
    const saved = localStorage.getItem('focusOrganizerTheme');
    if (saved) {
        document.documentElement.setAttribute('data-theme', saved);
    }
    updateThemeIcon();
}

function toggleTheme() {
    const current = document.documentElement.getAttribute('data-theme');
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;

    let next;
    if (current === 'dark') next = 'light';
    else if (current === 'light') next = 'dark';
    else next = prefersDark ? 'light' : 'dark';

    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('focusOrganizerTheme', next);
    updateThemeIcon();
}

function updateThemeIcon() {
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark' ||
        (!document.documentElement.getAttribute('data-theme') && window.matchMedia('(prefers-color-scheme: dark)').matches);
    document.getElementById('icon-sun').style.display = isDark ? 'none' : 'block';
    document.getElementById('icon-moon').style.display = isDark ? 'block' : 'none';
}

// ===========================
// MODAL
// ===========================
let modalResolve = null;

function showModal(title, text) {
    document.getElementById('modal-title').textContent = title;
    document.getElementById('modal-text').textContent = text;
    document.getElementById('modal-overlay').classList.add('open');
    return new Promise(resolve => {
        modalResolve = resolve;
    });
}

function closeModal(result) {
    document.getElementById('modal-overlay').classList.remove('open');
    if (modalResolve) {
        modalResolve(result);
        modalResolve = null;
    }
}

document.getElementById('modal-confirm').addEventListener('click', () => closeModal(true));
document.getElementById('modal-cancel').addEventListener('click', () => closeModal(false));
document.getElementById('modal-overlay').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeModal(false);
});

// ===========================
// RENDER: TASK CARD
// ===========================
function taskMatchesCurrentView(task) {
    if (state.activeFilter !== 'all') {
        if (state.activeFilter === 'atrasadas') {
            const todayStr = RECURRENCE.today();
            const hasPastDate = task.days.some(d => /^\d{4}-\d{2}-\d{2}$/.test(d) && d < todayStr);
            if (!hasPastDate) return false;
        } else if (state.activeFilter === 'futuras') {
            const todayStr = RECURRENCE.today();
            const hasFutureDate = task.days.some(d => /^\d{4}-\d{2}-\d{2}$/.test(d) && d > todayStr);
            if (!hasFutureDate) return false;
        } else if (state.activeFilter === 'important') {
            if (!task.important) return false;
        } else {
            const exactDate = getTaskExactDate(task);
            const category = exactDate ? RECURRENCE.getCategoryForDate(exactDate) : null;
            if (category !== state.activeFilter) return false;
        }
    }

    if (state.searchQuery) {
        const q = state.searchQuery.toLowerCase();
        const matchTask = task.text.toLowerCase().includes(q);
        const matchSubtask = task.subtasks && task.subtasks.some(subtask => subtask.text.toLowerCase().includes(q));
        if (!matchTask && !matchSubtask) return false;
    }

    return true;
}

function getTaskDayDisplay(task) {
    const exactDate = getTaskExactDate(task);
    if (!exactDate) return [];
    return [RECURRENCE.getCategoryForDate(exactDate), exactDate].filter(Boolean);
}

function renderTaskCard(task, options = {}) {
    const card = document.createElement('div');
    card.className = 'task-card' + (task.completed ? ' completed' : '');
    card.draggable = true;
    card.dataset.taskId = task.id;

    if (options.animateEntry && !prefersReducedMotion()) {
        card.classList.add('task-entering');
        card.addEventListener('animationend', () => card.classList.remove('task-entering'), { once: true });
    }

    card.classList.toggle('hidden-by-filter', !taskMatchesCurrentView(task));

    // Checkbox
    const checkbox = document.createElement('div');
    checkbox.className = 'task-checkbox';
    checkbox.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>';
    checkbox.addEventListener('click', (e) => {
        e.stopPropagation();
        const location = findTaskLocation(task.id);
        setTaskCompleted(task, !task.completed);
        saveState();
        refreshTaskContainerState(location);
    });

    // Content
    const content = document.createElement('div');
    content.className = 'task-content';

    const textEl = document.createElement('div');
    textEl.className = 'task-text';
    textEl.textContent = task.text;
    textEl.title = 'Clique para editar';
    textEl.addEventListener('click', (e) => {
        e.stopPropagation();
        startEditTask(task, textEl, card);
    });
    content.appendChild(textEl);

    // Day chips
    const displayedDays = getTaskDayDisplay(task);
    if (displayedDays.length > 0) {
        const chipsEl = document.createElement('div');
        chipsEl.className = 'task-chips';
        displayedDays.forEach(dayKey => {
            let cfg = DAY_CONFIG[dayKey];
            if (!cfg && dayKey.match(/^\d{4}-\d{2}-\d{2}$/)) {
                const [y, m, d] = dayKey.split('-');
                cfg = {
                    label: `${d}/${m}/${y}`,
                    bg: 'var(--bg-secondary)',
                    color: 'var(--text)'
                };
            }
            if (!cfg) return;
            const chip = document.createElement('span');
            chip.className = 'day-chip';
            chip.style.background = cfg.bg;
            chip.style.color = cfg.color;
            chip.innerHTML = `${cfg.label}<svg class="remove-chip" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`;
            chip.addEventListener('click', (e) => {
                e.stopPropagation();
                task.days = [];
                if (task.completed && task.recurrence && !task.recurrence.spawnedTaskId) {
                    delete task.recurrence.nextDate;
                    ensureRecurringTaskSchedule(task);
                    scheduleRecurrenceWakeUp();
                }
                saveState();
                refreshTaskCard(task);
            });
            chipsEl.appendChild(chip);
        });
        content.appendChild(chipsEl);
    }

    const recurrence = RECURRENCE.normalize(task.recurrence);
    if (recurrence) {
        let chipsEl = content.querySelector('.task-chips');
        if (!chipsEl) {
            chipsEl = document.createElement('div');
            chipsEl.className = 'task-chips';
            content.appendChild(chipsEl);
        }
        const recurrenceChip = document.createElement('button');
        recurrenceChip.type = 'button';
        recurrenceChip.className = 'recurrence-chip';
        recurrenceChip.title = recurrence.spawnedTaskId
            ? 'A repetição continua na próxima ocorrência'
            : recurrence.nextDate
                ? `Próxima ocorrência em ${formatDisplayDate(recurrence.nextDate)}`
                : 'Editar repetição';
        recurrenceChip.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="17 1 21 5 17 9"></polyline><path d="M3 11V9a4 4 0 0 1 4-4h14"></path><polyline points="7 23 3 19 7 15"></polyline><path d="M21 13v2a4 4 0 0 1-4 4H3"></path></svg>${RECURRENCE.getLabel(recurrence)}`;
        recurrenceChip.addEventListener('click', (event) => {
            event.stopPropagation();
            toggleRepeatPicker(task, recurrenceChip);
        });
        chipsEl.appendChild(recurrenceChip);
    }

    // Subtasks Badge
    const subtasks = task.subtasks || [];
    if (subtasks.length > 0) {
        const completedCount = subtasks.filter(s => s.completed).length;
        const badgeEl = document.createElement('div');
        badgeEl.className = 'task-subtask-badge';
        badgeEl.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="6" x2="21" y2="6"></line><line x1="8" y1="12" x2="21" y2="12"></line><line x1="8" y1="18" x2="21" y2="18"></line><line x1="3" y1="6" x2="3.01" y2="6"></line><line x1="3" y1="12" x2="3.01" y2="12"></line><line x1="3" y1="18" x2="3.01" y2="18"></line></svg> ${completedCount}/${subtasks.length}`;
        content.appendChild(badgeEl);
    }

    // Actions
    const actions = document.createElement('div');
    actions.className = 'task-actions';

    const importantBtn = document.createElement('button');
    importantBtn.type = 'button';
    importantBtn.className = 'task-important-btn';
    importantBtn.title = 'Marcar como importante';
    importantBtn.setAttribute('aria-label', 'Marcar como importante');
    importantBtn.setAttribute('aria-pressed', String(task.important));
    importantBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.1 8.3 22 9.3 17 14.2 18.2 21.1 12 17.8 5.8 21.1 7 14.2 2 9.3 8.9 8.3 12 2"></polygon></svg>';
    importantBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        task.important = !task.important;
        importantBtn.setAttribute('aria-pressed', String(task.important));
        importantBtn.title = task.important ? 'Remover importÃ¢ncia' : 'Marcar como importante';
        importantBtn.setAttribute('aria-label', importantBtn.title);
        saveState();
        refreshTaskVisibility();
    });

    // Details button
    const detailsBtn = document.createElement('button');
    detailsBtn.className = 'task-action-btn';
    detailsBtn.title = 'Subtarefas / Detalhes';
    detailsBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="6" x2="21" y2="6"></line><line x1="8" y1="12" x2="21" y2="12"></line><line x1="8" y1="18" x2="21" y2="18"></line><line x1="3" y1="6" x2="3.01" y2="6"></line><line x1="3" y1="12" x2="3.01" y2="12"></line><line x1="3" y1="18" x2="3.01" y2="18"></line></svg>';
    detailsBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        openSidePanel(task);
    });

    // Day picker button
    const dayBtn = document.createElement('button');
    dayBtn.className = 'task-action-btn';
    dayBtn.title = 'Adicionar dia';
    dayBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>';
    dayBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleDayPicker(task, card);
    });

    // Repeat picker button
    const repeatBtn = document.createElement('button');
    repeatBtn.type = 'button';
    repeatBtn.className = 'task-action-btn repeat-action-btn';
    repeatBtn.classList.toggle('active', Boolean(recurrence));
    repeatBtn.title = recurrence ? `Repetir: ${RECURRENCE.getLabel(recurrence)}` : 'Repetir tarefa';
    repeatBtn.setAttribute('aria-label', repeatBtn.title);
    repeatBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="17 1 21 5 17 9"></polyline><path d="M3 11V9a4 4 0 0 1 4-4h14"></path><polyline points="7 23 3 19 7 15"></polyline><path d="M21 13v2a4 4 0 0 1-4 4H3"></path></svg>';
    repeatBtn.addEventListener('click', (event) => {
        event.stopPropagation();
        toggleRepeatPicker(task, repeatBtn);
    });

    // Delete button
    const delBtn = document.createElement('button');
    delBtn.className = 'task-action-btn danger';
    delBtn.title = 'Excluir';
    delBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>';
    delBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        deleteTask(task.id);
    });

    actions.appendChild(detailsBtn);
    actions.appendChild(dayBtn);
    actions.appendChild(repeatBtn);
    actions.appendChild(delBtn);

    card.appendChild(checkbox);
    card.appendChild(content);
    card.appendChild(actions);
    card.appendChild(importantBtn);

    // Drag events
    card.addEventListener('dragstart', (e) => {
        e.stopPropagation(); // Previne que arraste o bloco inteiro quando estiver arrastando apenas a tarefa
        if (e.target.closest('input, textarea, button') || card.querySelector('.task-text-input')) {
            e.preventDefault();
            return;
        }
        card.classList.add('dragging');
        const source = findTaskLocation(task.id);
        dragData = {
            taskId: task.id,
            sourceType: source.type,
            sourceBlockId: source.blockId,
        };
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', task.id);
    });

    card.addEventListener('dragend', (e) => {
        e.stopPropagation();
        const converted = dragData?.converted;
        card.classList.remove('dragging');
        dragData = null;
        clearAllDragOver();
        clearTaskConversionTargets();
        if (!converted) rebuildStateFromDOM();
    });

    card.addEventListener('dragover', (e) => {
        if (!dragData?.taskId) return;
        const sourceTask = getTaskById(dragData.taskId);
        const box = card.getBoundingClientRect();
        const subtaskZoneHeight = box.height * SUBTASK_DROP_ZONE_RATIO;
        const subtaskZoneTop = box.top + (box.height - subtaskZoneHeight) / 2;
        const pointerInCenter = e.clientY > subtaskZoneTop && e.clientY < subtaskZoneTop + subtaskZoneHeight;
        if (!pointerInCenter) return;
        e.preventDefault();
        e.stopPropagation();
        clearAllDragOver();
        clearTaskConversionTargets();
        card.classList.add(canConvertTaskToSubtask(sourceTask, task) ? 'task-convert-target' : 'task-convert-unavailable');
        e.dataTransfer.dropEffect = 'move';
    });

    card.addEventListener('dragleave', (e) => {
        if (!card.contains(e.relatedTarget)) card.classList.remove('task-convert-target');
    });

    card.addEventListener('drop', (e) => {
        if (!dragData?.taskId || (!card.classList.contains('task-convert-target') && !card.classList.contains('task-convert-unavailable'))) return;
        e.preventDefault();
        e.stopPropagation();
        const converted = card.classList.contains('task-convert-target') && convertTaskToSubtask(dragData.taskId, task);
        if (converted) dragData.converted = true;
        clearTaskConversionTargets();
    });

    return card;
}

function getTaskLocationKey(location) {
    return location?.type === 'block' ? `block:${location.blockId}` : 'inbox';
}

function renderTaskCollection(container, tasks, location, options = {}) {
    const existingIds = new Set(
        [...container.querySelectorAll('.task-card')].map(card => card.dataset.taskId)
    );
    const pendingTasks = tasks.filter(task => !task.completed);
    const completedTasks = tasks.filter(task => task.completed);

    container.replaceChildren();

    pendingTasks.forEach(task => {
        container.appendChild(renderTaskCard(task, {
            animateEntry: options.animateNew && !existingIds.has(task.id)
        }));
    });

    if (tasks.length === 0) appendEmptyTaskState(container, location);

    if (completedTasks.length > 0) {
        const locationKey = getTaskLocationKey(location);
        const isCollapsed = collapsedCompletedSections.has(locationKey);
        const section = document.createElement('div');
        section.className = 'completed-tasks-section';
        section.dataset.locationKey = locationKey;

        const toggle = document.createElement('button');
        toggle.type = 'button';
        toggle.className = 'completed-tasks-toggle';
        toggle.setAttribute('aria-expanded', String(!isCollapsed));
        toggle.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"></polyline></svg><span>Conclu\u00edda</span><span class="completed-tasks-count"></span>';

        const list = document.createElement('div');
        list.className = 'completed-tasks-list';
        list.hidden = isCollapsed;

        completedTasks.forEach(task => {
            list.appendChild(renderTaskCard(task, {
                animateEntry: options.animateNew && !existingIds.has(task.id)
            }));
        });

        toggle.addEventListener('click', () => {
            const collapsed = toggle.getAttribute('aria-expanded') === 'true';
            toggle.setAttribute('aria-expanded', String(!collapsed));
            list.hidden = collapsed;
            if (collapsed) collapsedCompletedSections.add(locationKey);
            else collapsedCompletedSections.delete(locationKey);
            saveCollapsedCompletedSections();
        });

        section.append(toggle, list);
        container.appendChild(section);
    }
}

function startEditTask(task, textEl, card) {
    const input = document.createElement('textarea');
    input.className = 'task-text-input';
    input.setAttribute('aria-label', 'Editar tarefa');
    input.value = task.text;
    input.rows = 1;
    
    const adjustHeight = () => {
        input.style.height = 'auto';
        input.style.height = input.scrollHeight + 'px';
    };
    input.addEventListener('input', adjustHeight);

    textEl.replaceWith(input);
    input.focus();
    input.setSelectionRange(0, input.value.length);
    adjustHeight();

    const finish = () => {
        const val = input.value.trim();
        if (val && val !== task.text) {
            task.text = val;
            saveState();
        }
        refreshTaskCard(task);
    };

    input.addEventListener('blur', finish);
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); input.blur(); }
        if (e.key === 'Escape') { input.value = task.text; input.blur(); }
    });
}

function getDateForKey(key) {
    let d = new Date();
    if (key === 'hoje') {
        // today
    } else if (key === 'amanha') {
        d.setDate(d.getDate() + 1);
    } else {
        const daysMap = { domingo: 0, segunda: 1, terca: 2, quarta: 3, quinta: 4, sexta: 5, sabado: 6 };
        const targetDay = daysMap[key];
        if (targetDay !== undefined) {
            const currentDay = d.getDay();
            let diff = targetDay - currentDay;
            if (diff <= 0) {
                diff += 7;
            }
            d.setDate(d.getDate() + diff);
        } else {
            return null;
        }
    }
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const dateStr = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${dateStr}`;
}

function getCategoryForDate(dateString) {
    return RECURRENCE.getCategoryForDate(dateString);
}

function formatDisplayDate(dateString) {
    const date = RECURRENCE.parseLocalDate(dateString);
    if (!date) return dateString || '';
    return new Intl.DateTimeFormat('pt-BR').format(date);
}

function closeTaskPickers() {
    document.querySelectorAll('.day-picker.open, .repeat-picker.open').forEach(picker => {
        if (typeof picker.closePicker === 'function') picker.closePicker();
        else picker.remove();
    });
}

function setTaskRecurrence(task, value) {
    const config = RECURRENCE.configOnly(value);
    if (!config) {
        task.recurrence = null;
    } else {
        const existing = RECURRENCE.normalize(task.recurrence);
        task.recurrence = {
            ...config,
            seriesId: existing?.seriesId || getRecurrenceSeriesId(task),
        };
        ensureRecurringTaskSchedule(task);
    }
    saveState();
    scheduleRecurrenceWakeUp();
    refreshTaskCard(task);
    refreshSidePanelRecurrence();
}

function toggleRepeatPicker(task, anchor, options = {}) {
    closeTaskPickers();
    const existing = RECURRENCE.normalize(task.recurrence);
    if (task.completed && existing?.spawnedTaskId) {
        showToast('A repetição continua na ocorrência seguinte.');
        return;
    }

    let draft = RECURRENCE.configOnly(existing);
    const picker = document.createElement('div');
    picker.className = `repeat-picker open${options.sidePanel ? ' side-panel-repeat-picker' : ''}`;
    picker.setAttribute('role', 'dialog');
    picker.setAttribute('aria-label', 'Configurar repetição da tarefa');

    const title = document.createElement('div');
    title.className = 'repeat-picker-title';
    title.textContent = 'Repetir';
    picker.appendChild(title);

    const optionsContainer = document.createElement('div');
    picker.appendChild(optionsContainer);

    const customControls = document.createElement('div');
    customControls.className = 'repeat-custom-controls';
    const intervalInput = document.createElement('input');
    intervalInput.type = 'number';
    intervalInput.min = '1';
    intervalInput.max = '365';
    intervalInput.className = 'repeat-interval-input';
    intervalInput.setAttribute('aria-label', 'Intervalo da repetição');
    const unitSelect = document.createElement('select');
    unitSelect.className = 'repeat-unit-select';
    unitSelect.setAttribute('aria-label', 'Unidade da repetição');
    unitSelect.innerHTML = '<option value="day">dia(s)</option><option value="week">semana(s)</option><option value="month">mês(es)</option><option value="year">ano(s)</option>';
    customControls.append('A cada', intervalInput, unitSelect);
    picker.appendChild(customControls);

    const renderOptions = () => {
        optionsContainer.replaceChildren();
        const recurrenceOptions = [
            ['daily', 'Diariamente'],
            ['weekdays', 'Dias da semana'],
            ['weekly', 'Semanalmente'],
            ['monthly', 'Mensalmente'],
            ['yearly', 'Anualmente'],
            ['custom', 'Personalizar'],
        ];
        recurrenceOptions.forEach(([type, label]) => {
            const item = document.createElement('button');
            item.type = 'button';
            item.className = 'repeat-picker-item';
            item.setAttribute('aria-pressed', String(draft?.type === type));
            item.innerHTML = `<span>${label}</span>${draft?.type === type ? '<span aria-hidden="true">✓</span>' : ''}`;
            item.addEventListener('click', event => {
                event.stopPropagation();
                draft = type === 'custom'
                    ? { type, interval: draft?.type === 'custom' ? draft.interval : 1, unit: draft?.type === 'custom' ? draft.unit : 'day' }
                    : { type };
                renderOptions();
            });
            optionsContainer.appendChild(item);
        });
        customControls.hidden = draft?.type !== 'custom';
        if (draft?.type === 'custom') {
            intervalInput.value = String(draft.interval || 1);
            unitSelect.value = draft.unit || 'day';
        }
        if (picker.isConnected) window.requestAnimationFrame(positionPicker);
    };

    intervalInput.addEventListener('input', () => {
        if (draft?.type === 'custom') draft.interval = Math.min(365, Math.max(1, Number.parseInt(intervalInput.value, 10) || 1));
    });
    unitSelect.addEventListener('change', () => {
        if (draft?.type === 'custom') draft.unit = unitSelect.value;
    });

    const actions = document.createElement('div');
    actions.className = 'repeat-picker-actions';
    const removeButton = document.createElement('button');
    removeButton.type = 'button';
    removeButton.className = 'repeat-picker-action remove';
    removeButton.textContent = 'Não repetir';
    removeButton.disabled = !existing;
    const cancelButton = document.createElement('button');
    cancelButton.type = 'button';
    cancelButton.className = 'repeat-picker-action';
    cancelButton.textContent = 'Cancelar';
    const confirmButton = document.createElement('button');
    confirmButton.type = 'button';
    confirmButton.className = 'repeat-picker-action confirm';
    confirmButton.textContent = 'Salvar';
    actions.append(removeButton, cancelButton, confirmButton);
    picker.appendChild(actions);

    renderOptions();
    document.body.appendChild(picker);

    const positionPicker = () => {
        const anchorRect = anchor.getBoundingClientRect();
        const pickerRect = picker.getBoundingClientRect();
        const viewportPadding = 8;
        let top = anchorRect.bottom + 4;
        if (top + pickerRect.height > window.innerHeight - viewportPadding) {
            top = Math.max(viewportPadding, anchorRect.top - pickerRect.height - 4);
        }
        const left = Math.min(
            window.innerWidth - pickerRect.width - viewportPadding,
            Math.max(viewportPadding, anchorRect.right - pickerRect.width)
        );
        picker.style.position = 'fixed';
        picker.style.top = `${top}px`;
        picker.style.right = 'auto';
        picker.style.left = `${left}px`;
    };
    positionPicker();

    const close = () => {
        picker.remove();
        document.removeEventListener('click', closeHandler, true);
        document.removeEventListener('keydown', escapeHandler, true);
        window.removeEventListener('resize', close);
        window.removeEventListener('scroll', close, true);
    };
    picker.closePicker = close;
    const closeHandler = event => {
        if (!picker.contains(event.target)) close();
    };
    const escapeHandler = event => {
        if (event.key === 'Escape') {
            event.preventDefault();
            close();
        }
    };
    picker.addEventListener('click', event => event.stopPropagation());
    removeButton.addEventListener('click', () => {
        setTaskRecurrence(task, null);
        close();
    });
    cancelButton.addEventListener('click', close);
    confirmButton.addEventListener('click', () => {
        if (!draft) return close();
        if (draft.type === 'custom') {
            draft.interval = Math.min(365, Math.max(1, Number.parseInt(intervalInput.value, 10) || 1));
            draft.unit = unitSelect.value;
        }
        setTaskRecurrence(task, draft);
        close();
    });
    window.setTimeout(() => {
        document.addEventListener('click', closeHandler, true);
        document.addEventListener('keydown', escapeHandler, true);
        window.addEventListener('resize', close);
        window.addEventListener('scroll', close, true);
    }, 10);
}

function toggleDayPicker(task, card) {
    closeTaskPickers();

    const picker = document.createElement('div');
    picker.className = 'day-picker open';
    let draftDays = [...task.days];
    let dateInput;

    const setDraftDate = (key, exactDate) => {
        const isCurrentSelection = draftDays.includes(key) && draftDays.includes(exactDate);
        draftDays = isCurrentSelection ? [] : [key, exactDate];
        if (dateInput) dateInput.value = exactDate || '';
        renderOptions();
    };

    const renderOptions = () => {
        picker.querySelectorAll('.day-picker-item').forEach(item => item.remove());
        const reference = dateInput || picker.firstChild;
        Object.entries(DAY_CONFIG).forEach(([key, cfg]) => {
            const item = document.createElement('button');
            const isActive = draftDays.includes(key);
            item.type = 'button';
            item.className = 'day-picker-item';
            item.setAttribute('aria-pressed', String(isActive));
            item.innerHTML = `<span class="picker-dot" style="background:${isActive ? cfg.color : 'var(--border)'}"></span>${cfg.label}${isActive ? ' ✓' : ''}`;
            item.addEventListener('click', (e) => {
                e.stopPropagation();
                setDraftDate(key, getDateForKey(key));
            });
            picker.insertBefore(item, reference);
        });
    };

    const customDateKey = draftDays.find(d => /^\d{4}-\d{2}-\d{2}$/.test(d));
    dateInput = document.createElement('input');
    dateInput.type = 'date';
    dateInput.className = 'day-picker-date-input';
    dateInput.value = customDateKey || '';
    dateInput.addEventListener('change', (e) => {
        e.stopPropagation();
        const category = getCategoryForDate(dateInput.value);
        draftDays = category && dateInput.value ? [category, dateInput.value] : [];
        renderOptions();
    });
    dateInput.addEventListener('click', (e) => e.stopPropagation());
    picker.appendChild(dateInput);

    const actions = document.createElement('div');
    actions.className = 'day-picker-actions';
    const cancelButton = document.createElement('button');
    cancelButton.type = 'button';
    cancelButton.className = 'day-picker-action';
    cancelButton.textContent = 'Cancelar';
    const confirmButton = document.createElement('button');
    confirmButton.type = 'button';
    confirmButton.className = 'day-picker-action confirm';
    confirmButton.textContent = 'OK';
    actions.append(cancelButton, confirmButton);
    picker.appendChild(actions);
    renderOptions();

    card.style.position = 'relative';
    card.appendChild(picker);

    const close = () => {
        picker.remove();
        document.removeEventListener('click', closeHandler, true);
        document.removeEventListener('keydown', escapeHandler, true);
    };
    picker.closePicker = close;
    const closeHandler = (e) => {
        if (!picker.contains(e.target)) close();
    };
    const escapeHandler = (e) => {
        if (e.key === 'Escape') {
            e.preventDefault();
            close();
        }
    };

    cancelButton.addEventListener('click', close);
    confirmButton.addEventListener('click', () => {
        task.days = draftDays;
        if (task.completed && task.recurrence && !task.recurrence.spawnedTaskId) {
            delete task.recurrence.nextDate;
            ensureRecurringTaskSchedule(task);
            scheduleRecurrenceWakeUp();
        }
        saveState();
        close();
        refreshTaskCard(task);
    });
    setTimeout(() => {
        document.addEventListener('click', closeHandler, true);
        document.addEventListener('keydown', escapeHandler, true);
    }, 10);
}

function findTaskLocation(taskId) {
    if (state.inbox.find(t => t.id === taskId)) {
        return { type: 'inbox', blockId: null };
    }
    for (const block of state.blocks) {
        if (block.tasks.find(t => t.id === taskId)) {
            return { type: 'block', blockId: block.id };
        }
    }
    return { type: 'unknown', blockId: null };
}

function removeTaskFromSource(taskId) {
    state.inbox = state.inbox.filter(t => t.id !== taskId);
    for (const block of state.blocks) {
        block.tasks = block.tasks.filter(t => t.id !== taskId);
    }
}

function getTaskById(taskId) {
    const inboxTask = state.inbox.find(t => t.id === taskId);
    if (inboxTask) return inboxTask;
    for (const block of state.blocks) {
        const t = block.tasks.find(t => t.id === taskId);
        if (t) return t;
    }
    return null;
}

function cloneData(value) {
    return JSON.parse(JSON.stringify(value));
}

function getTaskCollection(location) {
    if (!location || location.type === 'unknown') return null;
    if (location.type === 'inbox') return state.inbox;
    return state.blocks.find(block => block.id === location.blockId)?.tasks || null;
}

function addDeletedItem(kind, value, source) {
    if (!Array.isArray(state.deletedItems)) state.deletedItems = [];
    state.deletedItems.unshift({
        id: genId(),
        kind,
        item: cloneData(value),
        source: cloneData(source),
        deletedAt: new Date().toISOString(),
    });
}

function getDeletedSourceLabel(entry) {
    if (entry.kind === 'subtask') {
        return entry.source?.parentTitle ? `Subtarefa de “${entry.source.parentTitle}”` : 'Subtarefa';
    }
    if (entry.source?.type === 'block') return entry.source.blockTitle || 'Bloco';
    return 'Inbox';
}

function updateTrashCount() {
    const count = document.getElementById('trash-count');
    if (!count) return;
    const total = Array.isArray(state.deletedItems) ? state.deletedItems.length : 0;
    count.textContent = total;
    count.hidden = total === 0;
}

function renderDeletedItems() {
    const list = document.getElementById('trash-list');
    if (!list) return;
    list.replaceChildren();
    const deletedItems = Array.isArray(state.deletedItems) ? state.deletedItems : [];
    if (deletedItems.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'trash-empty';
        empty.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"></path><path d="M8 6V4h8v2"></path><path d="M19 6l-1 15H6L5 6"></path><path d="M10 11v6M14 11v6"></path></svg><strong>A lixeira está vazia</strong><span>Itens excluídos aparecerão aqui.</span>';
        list.appendChild(empty);
        updateTrashCount();
        return;
    }

    deletedItems.forEach(entry => {
        const row = document.createElement('div');
        row.className = 'trash-item';
        const icon = document.createElement('div');
        icon.className = 'trash-item-icon';
        icon.innerHTML = entry.kind === 'subtask'
            ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 11h10M9 16h7"></path><path d="M5 5h.01M5 11h.01M5 16h.01"></path></svg>'
            : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="3"></rect><path d="m8 12 2.5 2.5L16 9"></path></svg>';
        const content = document.createElement('div');
        content.className = 'trash-item-content';
        const title = document.createElement('div');
        title.className = 'trash-item-title';
        title.textContent = entry.item?.text || 'Item sem título';
        const meta = document.createElement('div');
        meta.className = 'trash-item-meta';
        meta.textContent = `${entry.kind === 'subtask' ? 'Subtarefa' : 'Tarefa'} · ${getDeletedSourceLabel(entry)}`;
        content.append(title, meta);
        const restoreButton = document.createElement('button');
        restoreButton.type = 'button';
        restoreButton.className = 'trash-restore-btn';
        restoreButton.title = 'Desfazer exclusão';
        restoreButton.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7"></path><polyline points="3 4 3 10 9 10"></polyline></svg><span>Desfazer</span>';
        restoreButton.addEventListener('click', () => restoreDeletedItem(entry.id));
        row.append(icon, content, restoreButton);
        list.appendChild(row);
    });
    updateTrashCount();
}

function restoreDeletedItem(deletedId) {
    const entry = state.deletedItems?.find(item => item.id === deletedId);
    if (!entry) return;

    if (entry.kind === 'task') {
        if (getTaskById(entry.item.id)) {
            showToast('Essa tarefa já existe na lista.');
            return;
        }
        let collection = getTaskCollection(entry.source);
        let fallback = false;
        if (!collection) {
            collection = state.inbox;
            fallback = true;
        }
        const index = Math.max(0, Math.min(Number.isInteger(entry.source?.index) ? entry.source.index : collection.length, collection.length));
        collection.splice(index, 0, cloneData(entry.item));
        state.deletedItems = state.deletedItems.filter(item => item.id !== deletedId);
        saveState();
        renderInitialView();
        renderDeletedItems();
        showToast(fallback ? 'Tarefa restaurada no Inbox; o bloco original não existe mais.' : 'Tarefa restaurada no local original.');
        return;
    }

    const parentTask = getTaskById(entry.source?.parentTaskId);
    if (!parentTask) {
        showToast('Restaure primeiro a tarefa principal.');
        return;
    }
    if (!Array.isArray(parentTask.subtasks)) parentTask.subtasks = [];
    if (parentTask.subtasks.some(subtask => subtask.id === entry.item.id)) {
        showToast('Essa subtarefa já existe na tarefa principal.');
        return;
    }
    const index = Math.max(0, Math.min(Number.isInteger(entry.source?.index) ? entry.source.index : parentTask.subtasks.length, parentTask.subtasks.length));
    parentTask.subtasks.splice(index, 0, cloneData(entry.item));
    state.deletedItems = state.deletedItems.filter(item => item.id !== deletedId);
    saveState();
    renderSubtasks();
    refreshTaskCard(parentTask);
    renderDeletedItems();
    showToast('Subtarefa restaurada na tarefa original.');
}

function openTrash() {
    renderDeletedItems();
    document.getElementById('trash-modal-overlay')?.classList.add('open');
}

function closeTrash() {
    document.getElementById('trash-modal-overlay')?.classList.remove('open');
}

document.getElementById('btn-trash')?.addEventListener('click', openTrash);
document.getElementById('trash-modal-close')?.addEventListener('click', closeTrash);
document.getElementById('trash-modal-overlay')?.addEventListener('click', event => {
    if (event.target === event.currentTarget) closeTrash();
});
document.addEventListener('keydown', event => {
    if (event.key === 'Escape') closeTrash();
});

function animateRemoval(element, className, onComplete) {
    if (!element || prefersReducedMotion()) {
        if (element) element.remove();
        onComplete();
        return;
    }

    if (className === 'task-removing') {
        element.style.height = `${element.offsetHeight}px`;
    }
    element.getBoundingClientRect();
    requestAnimationFrame(() => element.classList.add(className));
    window.setTimeout(() => {
        element.remove();
        onComplete();
    }, 190);
}

function deleteTask(taskId) {
    const location = findTaskLocation(taskId);
    const collection = getTaskCollection(location);
    const taskIndex = collection ? collection.findIndex(task => task.id === taskId) : -1;
    const task = getTaskById(taskId);
    if (!task || !collection || taskIndex < 0) return;
    addDeletedItem('task', task, {
        type: location.type,
        blockId: location.blockId,
        blockTitle: location.type === 'block' ? state.blocks.find(block => block.id === location.blockId)?.title : null,
        index: taskIndex,
    });
    removeTaskFromSource(taskId);
    saveState();
    renderDeletedItems();
    const card = document.querySelector(`.task-card[data-task-id="${taskId}"]`);
    animateRemoval(card, 'task-removing', () => refreshTaskContainerState(location));
}

function createTaskForBlock(block, text) {
    const task = createTask(text);
    if (isMyDayBlock(block)) {
        assignTaskToMyDay(task);
        return task;
    }
    const extractedDay = extractDayFromText(task.text);
    if (extractedDay) setTaskDate(task, getDateForKey(extractedDay));
    return task;
}

// ===========================
// RENDER: BLOCK
// ===========================
function getBlockCSSVars(colorVar) {
    return {
        dot: `var(--block-${colorVar})`,
        bg: `var(--block-${colorVar}-bg)`,
        border: `var(--block-${colorVar}-border)`,
    };
}

function renderBlock(block, options = {}) {
    const colors = getBlockCSSVars(block.colorVar);
    if (isMyDayBlock(block)) {
        colors.dot = 'var(--my-day)';
        colors.bg = 'var(--my-day-bg)';
        colors.border = 'var(--my-day-border)';
    }

    const card = document.createElement('div');
    card.className = 'block-card';
    card.classList.toggle('my-day-block', isMyDayBlock(block));
    card.dataset.blockId = block.id;
    // O arraste por ponteiro mantém a roda do mouse disponível durante a ação.
    card.draggable = false;
    card.style.borderTopColor = colors.dot;
    card.style.borderTopWidth = '3px';

    if (options.animateEntry && !prefersReducedMotion()) {
        card.classList.add('block-entering');
        card.addEventListener('animationend', () => card.classList.remove('block-entering'), { once: true });
    }

    const canStartBlockPointerDrag = (target) => !isMyDayBlock(block) && (
        target.closest('.block-title') || !target.closest(
            'input, textarea, button, .block-color-dot, .color-picker, .task-card'
        )
    ) && !card.querySelector('.task-text-input');

    card.addEventListener('pointerdown', (e) => {
        if (e.button !== 0 || !canStartBlockPointerDrag(e.target)) return;
        blockPointerDrag = {
            blockId: block.id,
            card,
            pointerId: e.pointerId,
            startX: e.clientX,
            startY: e.clientY,
            active: false,
        };
        card.setPointerCapture(e.pointerId);
    });

    card.addEventListener('pointermove', (e) => {
        if (!blockPointerDrag || blockPointerDrag.card !== card || blockPointerDrag.pointerId !== e.pointerId) return;

        if (!blockPointerDrag.active) {
            const distance = Math.hypot(e.clientX - blockPointerDrag.startX, e.clientY - blockPointerDrag.startY);
            if (distance < 6) return;
            blockPointerDrag.active = true;
            card.classList.add('dragging-block');
            dragData = { blockId: block.id };
        }

        e.preventDefault();
        updateBlockDragAutoScroll(e.clientX, e.clientY);
        previewBlockDrop(document.getElementById('blocks-panel'), e.clientX, e.clientY);
    });

    const finishBlockPointerDrag = (e, shouldCommit) => {
        if (!blockPointerDrag || blockPointerDrag.card !== card || blockPointerDrag.pointerId !== e.pointerId) return;
        const wasActive = blockPointerDrag.active;
        if (card.hasPointerCapture(e.pointerId)) card.releasePointerCapture(e.pointerId);
        blockPointerDrag = null;
        if (!wasActive) return;

        stopBlockDragAutoScroll();
        if (shouldCommit && pendingDrop) commitDrop(e);
        card.classList.remove('dragging-block');
        dragData = null;
        clearAllDragOver();
        rebuildStateFromDOM();
    };

    card.addEventListener('pointerup', (e) => finishBlockPointerDrag(e, true));
    card.addEventListener('pointercancel', (e) => finishBlockPointerDrag(e, false));

    // Header
    const header = document.createElement('div');
    header.className = 'block-header';

    const headerLeft = document.createElement('div');
    headerLeft.className = 'block-header-left';

    const dot = document.createElement('div');
    dot.className = 'block-color-dot';
    dot.style.background = colors.dot;
    dot.title = isMyDayBlock(block) ? 'Meu dia é um bloco fixo' : 'Mudar cor do bloco';
    if (isMyDayBlock(block)) {
        dot.classList.add('my-day-icon');
        dot.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4.25" fill="currentColor" stroke="none"></circle><path d="M12 2.75v2M12 19.25v2M4.75 12h-2M21.25 12h-2M5.46 5.46 6.88 6.88M17.12 17.12l1.42 1.42M18.54 5.46l-1.42 1.42M6.88 17.12l-1.42 1.42"></path></svg>';
    }

    if (!isMyDayBlock(block)) dot.addEventListener('click', (e) => {
        e.stopPropagation();
        document.querySelectorAll('.color-picker').forEach(p => p.remove());

        const picker = document.createElement('div');
        picker.className = 'color-picker';

        BLOCK_COLORS.forEach(colorVar => {
            const item = document.createElement('div');
            item.className = 'color-picker-item';
            item.style.background = `var(--block-${colorVar})`;
            if (block.colorVar === colorVar) {
                item.style.borderColor = 'var(--text)';
            }
            item.addEventListener('click', (ev) => {
                ev.stopPropagation();
                block.colorVar = colorVar;
                saveState();
                picker.remove();
                refreshBlockAppearance(block);
            });
            picker.appendChild(item);
        });

        headerLeft.style.position = 'relative';
        headerLeft.appendChild(picker);

        const closeHandler = (ev) => {
            if (!picker.contains(ev.target) && ev.target !== dot) {
                picker.remove();
                document.removeEventListener('click', closeHandler, true);
            }
        };
        setTimeout(() => document.addEventListener('click', closeHandler, true), 10);
    });

    const titleInput = document.createElement('input');
    titleInput.type = 'text';
    titleInput.className = 'block-title';
    titleInput.value = block.title;
    titleInput.readOnly = isMyDayBlock(block);
    if (isMyDayBlock(block)) titleInput.title = 'Meu dia é um bloco fixo';
    titleInput.addEventListener('change', () => {
        block.title = titleInput.value.trim() || 'Sem TÃ­tulo';
        saveState();
    });
    titleInput.addEventListener('blur', () => {
        if (!titleInput.value.trim()) {
            titleInput.value = block.title;
        }
    });

    headerLeft.appendChild(dot);
    headerLeft.appendChild(titleInput);

    const count = document.createElement('span');
    count.className = 'block-count';
    
    const visibleTasks = block.tasks.filter(taskMatchesCurrentView);
    count.textContent = visibleTasks.length;

    const actions = document.createElement('div');
    actions.className = 'block-actions';

    // Focus button (in header for compact view)
    const focusBtn = document.createElement('button');
    focusBtn.className = 'block-action-btn';
    focusBtn.title = 'Focar neste bloco';
    focusBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>';
    focusBtn.addEventListener('click', () => focusOnBlock(block));

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'block-action-btn danger';
    deleteBtn.title = 'Remover bloco';
    deleteBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>';
    deleteBtn.addEventListener('click', () => deleteBlock(block.id));

    actions.appendChild(count);
    actions.appendChild(focusBtn);
    if (!isMyDayBlock(block)) actions.appendChild(deleteBtn);

    header.appendChild(headerLeft);
    header.appendChild(actions);

    // Tasks area
    const tasksArea = document.createElement('div');
    tasksArea.className = 'block-tasks';
    renderTaskCollection(tasksArea, block.tasks, { type: 'block', blockId: block.id });

    // Footer with focus button and quick add input
    const footer = document.createElement('div');
    footer.className = 'block-footer';
    
    const quickAddContainer = document.createElement('div');
    quickAddContainer.className = 'block-quick-add';
    quickAddContainer.style.display = 'flex';
    quickAddContainer.style.alignItems = 'center';
    quickAddContainer.style.gap = '8px';
    quickAddContainer.style.marginBottom = '12px';

    const quickAddInput = document.createElement('input');
    quickAddInput.type = 'text';
    quickAddInput.placeholder = '+ Adicionar tarefa...';
    quickAddInput.style.flex = '1';
    quickAddInput.style.padding = '8px 12px';
    quickAddInput.style.border = '1px solid var(--border)';
    quickAddInput.style.borderRadius = 'var(--radius-sm)';
    quickAddInput.style.background = 'var(--bg)';
    quickAddInput.style.color = 'var(--text)';
    quickAddInput.style.fontSize = '13px';
    
    quickAddInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && quickAddInput.value.trim()) {
            e.preventDefault();
            const newTask = createTaskForBlock(block, quickAddInput.value);
            block.tasks.push(newTask);
            saveState();
            quickAddInput.value = '';
            refreshTaskContainerState({ type: 'block', blockId: block.id }, { animateNew: true });
            quickAddInput.focus();
        }
    });

    const quickAddBtn = document.createElement('button');
    quickAddBtn.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>';
    quickAddBtn.style.background = 'var(--primary)';
    quickAddBtn.style.color = 'white';
    quickAddBtn.style.border = 'none';
    quickAddBtn.style.borderRadius = 'var(--radius-sm)';
    quickAddBtn.style.width = '32px';
    quickAddBtn.style.height = '32px';
    quickAddBtn.style.display = 'flex';
    quickAddBtn.style.alignItems = 'center';
    quickAddBtn.style.justifyContent = 'center';
    quickAddBtn.style.cursor = 'pointer';

    quickAddBtn.addEventListener('click', () => {
        if (quickAddInput.value.trim()) {
            const newTask = createTaskForBlock(block, quickAddInput.value);
            block.tasks.push(newTask);
            saveState();
            quickAddInput.value = '';
            refreshTaskContainerState({ type: 'block', blockId: block.id }, { animateNew: true });
            quickAddInput.focus();
        }
    });

    quickAddContainer.appendChild(quickAddInput);
    quickAddContainer.appendChild(quickAddBtn);

    const focusBtnFull = document.createElement('button');
    focusBtnFull.className = 'block-focus-btn';
    focusBtnFull.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg> Focar neste bloco';
    focusBtnFull.addEventListener('click', () => focusOnBlock(block));
    
    footer.appendChild(quickAddContainer);
    footer.appendChild(focusBtnFull);

    card.appendChild(header);
    card.appendChild(tasksArea);
    card.appendChild(footer);

    // Drop zone events
    card.addEventListener('dragover', (e) => {
        if (!dragData || !dragData.taskId) return;
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = 'move';
        card.classList.add('drag-over');

        const container = card.querySelector('.block-tasks');
        if (container) {
            const afterElement = getDragAfterElement(container, e.clientY);
            const dragging = document.querySelector('.dragging');
            if (dragging) {
                const last = container.querySelector('.task-card:last-child');
                previewDrop(container, afterElement, afterElement || last || container, !afterElement);
            }
        }
    });

    card.addEventListener('dragleave', (e) => {
        if (!card.contains(e.relatedTarget)) {
            card.classList.remove('drag-over');
            if (pendingDrop && pendingDrop.container === card.querySelector('.block-tasks')) clearAllDragOver();
        }
    });

    card.addEventListener('drop', (e) => {
        if (dragData && dragData.taskId) commitDrop(e);
    });

    return card;
}

async function deleteBlock(blockId) {
    const block = state.blocks.find(b => b.id === blockId);
    if (!block) return;
    if (isMyDayBlock(block)) {
        showToast('Meu dia é um bloco fixo e não pode ser removido.');
        return;
    }

    if (block.tasks.length > 0) {
        const confirmed = await showModal(
            'Remover bloco',
            `O bloco "${block.title}" tem ${block.tasks.length} tarefa(s). As tarefas serÃ£o movidas de volta para o Inbox. Deseja continuar?`
        );
        if (!confirmed) return;
        // Move tasks back to inbox
        state.inbox.push(...block.tasks);
    }

    state.blocks = state.blocks.filter(b => b.id !== blockId);
    saveState();
    const blockCard = document.querySelector(`.block-card[data-block-id="${blockId}"]`);
    animateRemoval(blockCard, 'block-removing', () => {
        refreshTaskContainerState({ type: 'inbox', blockId: null }, { animateNew: true });
    });
}

function addBlock() {
    const colorVar = BLOCK_COLORS[nextColorIndex % BLOCK_COLORS.length];
    nextColorIndex++;
    const block = {
        id: genId(),
        title: `Bloco ${state.blocks.length + 1}`,
        colorVar: colorVar,
        tasks: [],
    };
    state.blocks.push(block);
    saveState();
    const blocksPanel = document.getElementById('blocks-panel');
    const addButton = blocksPanel.querySelector('.add-block-card');
    blocksPanel.insertBefore(renderBlock(block, { animateEntry: true }), addButton || null);
}

function focusOnBlock(block) {
    const incompleteTasks = block.tasks.filter(t => !t.completed);
    if (incompleteTasks.length === 0) {
        alert('NÃ£o hÃ¡ tarefas pendentes neste bloco.');
        return;
    }
    // Save tasks to shared localStorage for Focus app
    const focusState = {
        tasks: incompleteTasks,
        currentIndex: 0,
        blockId: block.id,
        blockTitle: block.title,
        fromOrganizer: true
    };
    if (window.FocusCloud?.writeLocalState) {
        window.FocusCloud.writeLocalState(FOCUS_HANDOFF_KEY, focusState);
    } else {
        localStorage.setItem(FOCUS_HANDOFF_KEY, JSON.stringify(focusState));
    }
    window.FocusCloud?.scheduleFocusSave(focusState);
    window.location.href = 'index.html?mode=focus&from=organizer';
}

function getTasksForLocation(location) {
    if (!location || location.type === 'unknown') return [];
    if (location.type === 'inbox') return state.inbox;
    const block = state.blocks.find(item => item.id === location.blockId);
    return block ? block.tasks : [];
}

function getTaskContainerForLocation(location) {
    if (!location || location.type === 'unknown') return null;
    if (location.type === 'inbox') return document.getElementById('inbox-tasks');
    return document.querySelector(`.block-card[data-block-id="${location.blockId}"] .block-tasks`);
}

function appendEmptyTaskState(container, location) {
    if (location.type === 'inbox') {
        const empty = document.createElement('div');
        empty.className = 'inbox-empty';
        empty.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 16 12 14 15 10 15 8 12 2 12"></polyline><path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"></path></svg><span>Nenhuma tarefa no inbox.<br>Digite acima para adicionar.</span>';
        container.appendChild(empty);
        return;
    }

    const empty = document.createElement('div');
    empty.className = 'block-empty';
    empty.textContent = 'Arraste tarefas aqui';
    container.appendChild(empty);
}

function refreshTaskContainerState(location, options = {}) {
    const container = getTaskContainerForLocation(location);
    if (!container) return;

    const tasks = getTasksForLocation(location);
    renderTaskCollection(container, tasks, location, options);
    refreshTaskVisibility();
}

function refreshTaskContainersState() {
    refreshTaskContainerState({ type: 'inbox', blockId: null });
    state.blocks.forEach(block => {
        refreshTaskContainerState({ type: 'block', blockId: block.id });
    });
}

function refreshTaskCard(task) {
    const currentCard = document.querySelector(`.task-card[data-task-id="${task.id}"]`);
    if (currentCard) currentCard.replaceWith(renderTaskCard(task));

    if (currentEditingTask && currentEditingTask.id === task.id) {
        document.getElementById('side-panel-title').textContent = task.text;
    }

    refreshTaskVisibility();
}

function refreshBlockAppearance(block) {
    const blockCard = document.querySelector(`.block-card[data-block-id="${block.id}"]`);
    if (!blockCard) return;
    const colors = getBlockCSSVars(block.colorVar);
    blockCard.style.borderTopColor = colors.dot;
    const dot = blockCard.querySelector('.block-color-dot');
    if (dot) dot.style.background = colors.dot;
}

function refreshTaskVisibility() {
    document.querySelectorAll('.task-card').forEach(card => {
        const task = getTaskById(card.dataset.taskId);
        card.classList.toggle('hidden-by-filter', !task || !taskMatchesCurrentView(task));
    });

    state.blocks.forEach(block => {
        const blockCard = document.querySelector(`.block-card[data-block-id="${block.id}"]`);
        const count = blockCard?.querySelector('.block-actions > .block-count');
        if (count) count.textContent = block.tasks.filter(taskMatchesCurrentView).length;
    });

    document.getElementById('inbox-count').textContent = state.inbox.length;
    document.querySelectorAll('.completed-tasks-section').forEach(section => {
        const visibleCount = section.querySelectorAll('.task-card:not(.hidden-by-filter)').length;
        const count = section.querySelector('.completed-tasks-count');
        if (count) count.textContent = visibleCount;
        section.hidden = visibleCount === 0;
    });
    document.querySelectorAll('.filter-chip').forEach(chip => {
        chip.classList.toggle('active', chip.dataset.filter === state.activeFilter);
    });
    updateWeekdayFilterLabel();
}

function updateWeekdayFilterLabel() {
    const toggle = document.getElementById('weekday-filter-toggle');
    const label = document.getElementById('weekday-filter-label');
    if (!toggle || !label) return;
    const labels = { segunda: 'Segunda', terca: 'Terça', quarta: 'Quarta', quinta: 'Quinta', sexta: 'Sexta', sabado: 'Sábado', domingo: 'Domingo' };
    label.textContent = labels[state.activeFilter] ? `Dias: ${labels[state.activeFilter]}` : 'Dias da semana';
}

// ===========================
// INITIAL RENDER
// ===========================
function renderInitialView() {
    // Render blocks
    const blocksPanel = document.getElementById('blocks-panel');
    blocksPanel.innerHTML = '';

    state.blocks.forEach(block => {
        blocksPanel.appendChild(renderBlock(block));
    });

    // Add block button
    const addBtn = document.createElement('button');
    addBtn.className = 'add-block-card';
    addBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg> Novo Bloco';
    addBtn.addEventListener('click', addBlock);
    blocksPanel.appendChild(addBtn);

    blocksPanel.ondragover = (e) => {
        if (dragData && dragData.blockId) {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            updateBlockDragAutoScroll(e.clientX, e.clientY);
            previewBlockDrop(blocksPanel, e.clientX, e.clientY);
        }
    };
    blocksPanel.ondrop = (e) => {
        if (dragData && dragData.blockId) {
            stopBlockDragAutoScroll();
            commitDrop(e);
        }
    };

    // Render inbox
    const inboxTasks = document.getElementById('inbox-tasks');
    inboxTasks.innerHTML = '';

    renderTaskCollection(inboxTasks, state.inbox, { type: 'inbox', blockId: null });

    // Update inbox count
    document.getElementById('inbox-count').textContent = state.inbox.length;

    // Update filter bar
    document.querySelectorAll('.filter-chip').forEach(chip => {
        chip.classList.toggle('active', chip.dataset.filter === state.activeFilter);
    });
    refreshTaskVisibility();
    updateWeekdayFilterLabel();
}

// ===========================
// CLEAR DRAG OVER
// ===========================
function clearAllDragOver() {
    document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
    document.querySelectorAll('.drop-before, .drop-after').forEach(el => el.classList.remove('drop-before', 'drop-after'));
    document.querySelectorAll('.block-swap-target').forEach(el => el.classList.remove('block-swap-target'));
    clearTaskConversionTargets();
    pendingDrop = null;
}

// ===========================
// INBOX DRAG/DROP
// ===========================
const inboxPanel = document.getElementById('inbox-panel');

// Mantém a roda do mouse disponível durante o arraste de um bloco.
document.addEventListener('wheel', scrollBlocksWhileDragging, { passive: false });

inboxPanel.addEventListener('dragover', (e) => {
    if (!dragData || !dragData.taskId) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    inboxPanel.classList.add('drag-over');

    const container = document.getElementById('inbox-tasks');
    if (container) {
        const afterElement = getDragAfterElement(container, e.clientY);
        const dragging = document.querySelector('.dragging');
        if (dragging) {
            const last = container.querySelector('.task-card:last-child');
            previewDrop(container, afterElement, afterElement || last || container, !afterElement);
        }
    }
});

inboxPanel.addEventListener('dragleave', (e) => {
    if (!inboxPanel.contains(e.relatedTarget)) {
        inboxPanel.classList.remove('drag-over');
        if (pendingDrop && pendingDrop.container === document.getElementById('inbox-tasks')) clearAllDragOver();
    }
});

inboxPanel.addEventListener('drop', (e) => {
    if (dragData && dragData.taskId) commitDrop(e);
});

// ===========================
// INBOX INPUT
// ===========================
const inboxInput = document.getElementById('inbox-input');
const btnInboxAdd = document.getElementById('btn-inbox-add');

function addInboxTasks(text) {
    const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    lines.forEach(line => {
        state.inbox.push(createTask(line));
    });
    if (lines.length > 0) {
        saveState();
        refreshTaskContainerState({ type: 'inbox', blockId: null }, { animateNew: true });
    }
}

btnInboxAdd.addEventListener('click', () => {
    const val = inboxInput.value.trim();
    if (val) {
        addInboxTasks(val);
        inboxInput.value = '';
        inboxInput.focus();
    }
});

inboxInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        const val = inboxInput.value.trim();
        if (val) {
            addInboxTasks(val);
            inboxInput.value = '';
        }
    }
});

// Paste multi-line support
inboxInput.addEventListener('paste', (e) => {
    const pasted = e.clipboardData.getData('text');
    if (pasted.includes('\n')) {
        e.preventDefault();
        const existing = inboxInput.value.trim();
        const allText = existing ? existing + '\n' + pasted : pasted;
        addInboxTasks(allText);
        inboxInput.value = '';
    }
});

// ===========================
// FILTER BAR
// ===========================
document.getElementById('filter-bar').addEventListener('click', (e) => {
    const weekdayToggle = e.target.closest('#weekday-filter-toggle');
    if (weekdayToggle) {
        const weekdayFilter = document.getElementById('weekday-filter');
        const isOpen = weekdayFilter.classList.toggle('open');
        document.body.classList.toggle('weekday-menu-open', isOpen);
        weekdayToggle.setAttribute('aria-expanded', String(isOpen));
        return;
    }
    const chip = e.target.closest('.filter-chip');
    if (!chip) return;
    state.activeFilter = chip.dataset.filter;
    saveState();
    refreshTaskVisibility();
    document.getElementById('weekday-filter').classList.remove('open');
    document.body.classList.remove('weekday-menu-open');
    document.getElementById('weekday-filter-toggle').setAttribute('aria-expanded', 'false');
});

document.addEventListener('click', (e) => {
    if (!e.target.closest('#weekday-filter')) {
        document.getElementById('weekday-filter').classList.remove('open');
        document.body.classList.remove('weekday-menu-open');
        document.getElementById('weekday-filter-toggle').setAttribute('aria-expanded', 'false');
    }
});

let organizingFilters = false;
let filterDragItem = null;
function applyFilterOrders() {
    const bar = document.getElementById('filter-bar'); const search = bar.querySelector('.search-container');
    state.filterOrder.forEach(id => { const item = bar.querySelector(`[data-order-id="${id}"]`); if (item) bar.insertBefore(item, search); });
    const menu = document.getElementById('weekday-filter-menu');
    state.weekdayOrder.forEach(id => { const item = menu.querySelector(`[data-order-id="${id}"]`); if (item) menu.appendChild(item); });
}
function saveFilterOrder(container, property) { state[property] = [...container.querySelectorAll(':scope > .filter-orderable')].map(item => item.dataset.orderId); saveState(); }
function enableFilterOrdering(enabled) {
    organizingFilters = enabled; const bar = document.getElementById('filter-bar'); const menu = document.getElementById('weekday-filter-menu');
    bar.classList.toggle('organizing-filters', enabled); menu.classList.toggle('organizing-filters', enabled);
    document.querySelectorAll('.filter-orderable').forEach(item => item.draggable = enabled);
    const button = document.getElementById('btn-organize-filters');
    button.classList.toggle('active', enabled);
    button.title = enabled ? 'Concluir organizaÃ§Ã£o' : 'Organizar filtros';
    button.setAttribute('aria-label', button.title);
}
document.getElementById('btn-organize-filters').addEventListener('click', (e) => { e.stopPropagation(); enableFilterOrdering(!organizingFilters); });
document.addEventListener('dragstart', (e) => { if (!organizingFilters || !e.target.matches('.filter-orderable')) return; filterDragItem = e.target; e.target.classList.add('filter-dragging'); });
document.addEventListener('dragend', () => { filterDragItem?.classList.remove('filter-dragging'); filterDragItem = null; });
function bindOrderContainer(container, property) {
    container.addEventListener('dragover', (e) => { if (!filterDragItem || filterDragItem.parentElement !== container) return; e.preventDefault(); const siblings=[...container.querySelectorAll(':scope > .filter-orderable:not(.filter-dragging)')]; const before=siblings.find(item => (container.id === 'weekday-filter-menu' ? e.clientY < item.getBoundingClientRect().top + item.offsetHeight/2 : e.clientX < item.getBoundingClientRect().left + item.offsetWidth/2)); container.insertBefore(filterDragItem, before || null); });
    container.addEventListener('drop', (e) => { if (!filterDragItem) return; e.preventDefault(); saveFilterOrder(container, property); });
}
bindOrderContainer(document.getElementById('filter-bar'), 'filterOrder');
bindOrderContainer(document.getElementById('weekday-filter-menu'), 'weekdayOrder');

// ===========================
// THEME TOGGLE
// ===========================
document.getElementById('btn-theme').addEventListener('click', toggleTheme);

// ===========================
// TOAST NOTIFICATION
// ===========================
let toastTimeout = null;
function showToast(msg) {
    const toast = document.getElementById('toast-notification');
    const msgEl = document.getElementById('toast-message');
    if (!toast || !msgEl) return;
    msgEl.textContent = msg;
    toast.classList.add('active');
    clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => {
        toast.classList.remove('active');
    }, 3500);
}

// ===========================
// MICROSOFT TO DO PDF IMPORT
// ===========================
if (window.pdfjsLib) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
}

const pdfFileInput = document.getElementById('pdf-file-input');
const btnImportPdf = document.getElementById('btn-import-pdf');
const pdfModalOverlay = document.getElementById('pdf-modal-overlay');
const pdfModalClose = document.getElementById('pdf-modal-close');
const pdfBtnCancel = document.getElementById('pdf-btn-cancel');
const pdfBtnConfirm = document.getElementById('pdf-btn-confirm');
const pdfDropOverlay = document.getElementById('pdf-drop-overlay');

const pdfOptIncludeSubtasks = document.getElementById('pdf-opt-include-subtasks');
const pdfOptApplyDays = document.getElementById('pdf-opt-apply-days');
const btnToggleSelectAll = document.getElementById('btn-toggle-select-all');
const pdfPreviewList = document.getElementById('pdf-preview-list');
const pdfModalFilename = document.getElementById('pdf-modal-filename');

let parsedPdfTasks = []; // Array de { id, text, days: [], subtasks: [{ text, days: [] }] }
let selectedPreviewKeys = new Set();

function extractDayFromText(text) {
    if (!text) return null;
    const lower = text.toLowerCase();
    if (/\b(hoje|meu\s+dia)\b/.test(lower)) return 'hoje';
    if (/\b(amanhã|amanha)\b/.test(lower)) return 'amanha';
    if (/\b(dom|domingo)\b/.test(lower)) return 'domingo';
    if (/\b(seg|segunda(-feira)?)\b/.test(lower)) return 'segunda';
    if (/\b(ter|terça|terca(-feira)?)\b/.test(lower)) return 'terca';
    if (/\b(qua|quarta(-feira)?)\b/.test(lower)) return 'quarta';
    if (/\b(qui|quinta(-feira)?)\b/.test(lower)) return 'quinta';
    if (/\b(sex|sexta(-feira)?)\b/.test(lower)) return 'sexta';
    if (/\b(sáb|sab|sábado|sabado)\b/.test(lower)) return 'sabado';
    return null;
}

async function processPdfFile(file) {
    if (!file || !file.type.includes('pdf') && !file.name.toLowerCase().endsWith('.pdf')) {
        alert('Por favor, selecione um arquivo no formato PDF.');
        return;
    }

    pdfModalFilename.textContent = file.name || 'Tarefas do Microsoft To Do';
    showToast('Lendo PDF do Microsoft To Do...');

    try {
        const arrayBuffer = await file.arrayBuffer();
        if (!window.pdfjsLib) {
            throw new Error('Biblioteca PDF.js nÃ£o carregada');
        }

        const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
        const pdf = await loadingTask.promise;
        const pagesLines = [];

        for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
            const page = await pdf.getPage(pageNum);
            const textContent = await page.getTextContent();
            const viewport = page.getViewport({ scale: 1.0 });
            const pageHeight = viewport.height;

            pagesLines.push(...extractToDoPdfPageLines(textContent.items, pageNum, pageHeight));
        }

        parsedPdfTasks = parseToDoLines(pagesLines);

        if (parsedPdfTasks.length === 0) {
            alert('Nenhuma tarefa foi identificada no PDF. Verifique se Ã© uma lista impressa do Microsoft To Do.');
            return;
        }

        openPdfImportModal();
    } catch (err) {
        console.error('Erro ao ler PDF:', err);
        alert('Erro ao processar o arquivo PDF: ' + (err.message || 'Verifique o formato do arquivo.'));
    }
}

function extractToDoPdfPageLines(items, page, pageHeight) {
    // O PDF do To Do codifica os Ã­cones em fontes prÃ³prias. Em vez de
    // depender do caractere do Ã­cone, usamos a indentaÃ§Ã£o do texto.
    const iconFonts = new Set(items
        .filter(item => /[\uE000-\uF8FF]/u.test(item.str || ''))
        .map(item => item.fontName));
    const rows = [];
    const subtaskMarkerYs = [];

    items.forEach(item => {
        if (!item.str || !item.str.trim() || iconFonts.has(item.fontName)) return;
        const size = Math.hypot(item.transform[0], item.transform[1]);
        const x = item.transform[4];
        const y = item.transform[5];
        // Checkboxes sÃ£o sÃ­mbolos curtos na margem esquerda, nÃ£o texto.
        // Os marcadores maiores pertencem Ã s subtarefas; guardamos apenas
        // sua posiÃ§Ã£o para distinguir o inÃ­cio de um texto quebrado.
        if (item.str.trim().length === 1 && x < 100 && size >= 14) {
            if (size >= 16) subtaskMarkerYs.push(y);
            return;
        }
        const existing = rows.find(row => Math.abs(row.y - y) <= 3);
        const entry = { str: item.str, x, y, width: item.width || 0, fontSize: size };
        if (existing) existing.items.push(entry);
        else rows.push({ y, items: [entry] });
    });

    const yearMatch = items.map(item => item.str).join(' ').match(/\b(20\d{2})\b/);
    const year = yearMatch ? Number(yearMatch[1]) : new Date().getFullYear();
    const subtaskStartRows = new Set();
    subtaskMarkerYs.forEach(markerY => {
        const firstTextRow = rows
            .filter(row => row.y >= markerY && row.y - markerY < 20)
            .sort((a, b) => b.y - a.y)[0];
        if (firstTextRow) subtaskStartRows.add(firstTextRow);
    });
    return rows.sort((a, b) => b.y - a.y).flatMap(row => {
        row.items.sort((a, b) => a.x - b.x);
        let text = '';
        row.items.forEach((item, index) => {
            const previous = row.items[index - 1];
            const gap = previous ? item.x - (previous.x + previous.width) : 0;
            text += index && gap > 2 && !text.endsWith(' ') && !item.str.startsWith(' ') ? ` ${item.str}` : item.str;
        });
        text = text.trim();
        if (!text) return [];
        const isHeader = row.y > pageHeight * 0.88 && (/^tarefas\b/i.test(text) || /\d{1,2}\s+de\s+[a-zç]+\s+de\s+\d{4}/i.test(text));
        const isFooter = row.y < pageHeight * 0.09 || /Impressa com o Microsoft To Do/i.test(text);
        if (isHeader || isFooter) return [];
        const startsSubtask = subtaskStartRows.has(row);
        return [{ text, x: row.items[0].x, y: row.y, page, year, fontSize: row.items[0].fontSize, startsSubtask }];
    });
}

function detectedToDoDays(text, year) {
    const months = { jan: 0, fev: 1, mar: 2, abr: 3, mai: 4, jun: 5, jul: 6, ago: 7, set: 8, out: 9, nov: 10, dez: 11 };
    const match = text.toLowerCase().match(/\b(\d{1,2})\s+de\s+(jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)[a-z]*/i);
    if (match) {
        const month = months[match[2].slice(0, 3).toLowerCase()];
        const date = new Date(Date.UTC(year, month, Number(match[1])));
        if (date.getUTCMonth() === month && date.getUTCDate() === Number(match[1])) return [date.toISOString().slice(0, 10)];
    }
    const day = extractDayFromText(text);
    return day ? [day] : [];
}

function parseToDoLines(lines) {
    const tasks = [];
    let currentTask = null;
    let currentSubtask = null;
    let lastContent = null;

    const isContinuation = (kind, line) => lastContent && lastContent.kind === kind &&
        lastContent.page === line.page && lastContent.y - line.y < 19;
    const append = (item, text) => { item.text = `${item.text} ${text}`.replace(/\s+/g, ' ').trim(); };

    for (const line of lines) {
        const text = line.text.trim();
        const isMainText = line.x <= 105 && line.fontSize >= 10;
        const isSubtaskText = line.x > 105 && line.fontSize >= 9.4;

        if (isMainText) {
            if (currentTask && isContinuation('main', line)) {
                append(currentTask, text);
            } else {
                currentTask = { id: genId(), text, completed: false, important: false, days: [], subtasks: [] };
                tasks.push(currentTask);
                currentSubtask = null;
            }
            lastContent = { kind: 'main', page: line.page, y: line.y };
            continue;
        }

        if (isSubtaskText && currentTask) {
            if (currentSubtask && isContinuation('subtask', line) && !line.startsSubtask) {
                append(currentSubtask, text);
            } else {
                currentSubtask = { id: genId(), text, completed: false, days: [] };
                currentTask.subtasks.push(currentSubtask);
            }
            lastContent = { kind: 'subtask', page: line.page, y: line.y };
            continue;
        }

        if (currentTask) {
            detectedToDoDays(text, line.year).forEach(day => {
                if (!currentTask.days.includes(day)) currentTask.days.push(day);
            });
        }
    }
    return tasks;
}

function openPdfImportModal() {
    selectedPreviewKeys.clear();

    // PrÃ©-selecionar todas as tarefas e subtarefas
    parsedPdfTasks.forEach((task, tIdx) => {
        selectedPreviewKeys.add(`main_${tIdx}`);
        task.subtasks.forEach((_, sIdx) => {
            selectedPreviewKeys.add(`sub_${tIdx}_${sIdx}`);
        });
    });

    updatePdfStats();
    renderPdfPreview();
    pdfModalOverlay.classList.add('open');
}

function closePdfImportModal() {
    pdfModalOverlay.classList.remove('open');
    if (pdfFileInput) pdfFileInput.value = '';
}

function updatePdfStats() {
    let totalMain = parsedPdfTasks.length;
    let totalSub = 0;
    let totalWithDays = 0;

    parsedPdfTasks.forEach(t => {
        totalSub += t.subtasks.length;
        if (t.days.length > 0) totalWithDays++;
    });

    document.getElementById('stat-pill-total').textContent = `${totalMain + totalSub} itens encontrados`;
    document.getElementById('stat-pill-main').textContent = `${totalMain} principais`;
    document.getElementById('stat-pill-sub').textContent = `${totalSub} subtarefas`;
    document.getElementById('stat-pill-days').textContent = `${totalWithDays} com data`;
}

function renderPdfPreview() {
    pdfPreviewList.innerHTML = '';
    const includeSubtasks = pdfOptIncludeSubtasks.checked;
    const applyDays = pdfOptApplyDays.checked;


    parsedPdfTasks.forEach((task, tIdx) => {
        const mainKey = `main_${tIdx}`;
        const isMainSelected = selectedPreviewKeys.has(mainKey);

        // Card da tarefa principal
        const mainItem = document.createElement('div');
        mainItem.className = 'pdf-preview-item';

        const mainCheck = document.createElement('input');
        mainCheck.type = 'checkbox';
        mainCheck.checked = isMainSelected;
        mainCheck.addEventListener('change', () => {
            if (mainCheck.checked) selectedPreviewKeys.add(mainKey);
            else selectedPreviewKeys.delete(mainKey);
            updatePreviewSelectedCount();
        });

        const mainText = document.createElement('div');
        mainText.className = 'pdf-preview-text';
        mainText.textContent = task.text;

        mainItem.appendChild(mainCheck);
        mainItem.appendChild(mainText);

        if (applyDays && task.days.length > 0) {
            task.days.forEach(d => {
                const cfg = DAY_CONFIG[d];
                if (cfg) {
                    const badge = document.createElement('span');
                    badge.className = 'pdf-preview-day';
                    badge.style.background = cfg.bg;
                    badge.style.color = cfg.color;
                    badge.textContent = cfg.label;
                    mainItem.appendChild(badge);
                }
            });
        }

        pdfPreviewList.appendChild(mainItem);

        // Subtarefas
        if (includeSubtasks && task.subtasks.length > 0) {
            task.subtasks.forEach((sub, sIdx) => {
                const subKey = `sub_${tIdx}_${sIdx}`;
                const isSubSelected = selectedPreviewKeys.has(subKey);

                const subItem = document.createElement('div');
                subItem.className = 'pdf-preview-item subtask-item';

                const subCheck = document.createElement('input');
                subCheck.type = 'checkbox';
                subCheck.checked = isSubSelected;
                subCheck.addEventListener('change', () => {
                    if (subCheck.checked) selectedPreviewKeys.add(subKey);
                    else selectedPreviewKeys.delete(subKey);
                    updatePreviewSelectedCount();
                });

                let formattedText = sub.text;

                const subText = document.createElement('div');
                subText.className = 'pdf-preview-text';
                subText.textContent = `â†³ ${formattedText}`;

                subItem.appendChild(subCheck);
                subItem.appendChild(subText);

                if (applyDays && sub.days.length > 0) {
                    sub.days.forEach(d => {
                        const cfg = DAY_CONFIG[d];
                        if (cfg) {
                            const badge = document.createElement('span');
                            badge.className = 'pdf-preview-day';
                            badge.style.background = cfg.bg;
                            badge.style.color = cfg.color;
                            badge.textContent = cfg.label;
                            subItem.appendChild(badge);
                        }
                    });
                }

                pdfPreviewList.appendChild(subItem);
            });
        }
    });

    updatePreviewSelectedCount();
}

function updatePreviewSelectedCount() {
    const count = selectedPreviewKeys.size;
    document.getElementById('pdf-preview-count').textContent = `PrÃ©-visualizaÃ§Ã£o (${count} selecionadas):`;
    pdfBtnConfirm.textContent = `Importar (${count}) para o Inbox`;
    btnToggleSelectAll.textContent = count > 0 ? 'Desmarcar todas' : 'Selecionar todas';
}

// Eventos do modal de PDF
btnImportPdf.addEventListener('click', () => {
    pdfFileInput.click();
});

pdfFileInput.addEventListener('change', (e) => {
    const file = e.target.files && e.target.files[0];
    if (file) {
        processPdfFile(file);
    }
});

pdfModalClose.addEventListener('click', closePdfImportModal);
pdfBtnCancel.addEventListener('click', closePdfImportModal);
pdfModalOverlay.addEventListener('click', (e) => {
    if (e.target === pdfModalOverlay) closePdfImportModal();
});

pdfOptIncludeSubtasks.addEventListener('change', () => {
    renderPdfPreview();
});

pdfOptApplyDays.addEventListener('change', renderPdfPreview);

btnToggleSelectAll.addEventListener('click', () => {
    const shouldSelectAll = selectedPreviewKeys.size === 0;
    selectedPreviewKeys.clear();
    if (shouldSelectAll) {
        parsedPdfTasks.forEach((task, tIdx) => {
            selectedPreviewKeys.add(`main_${tIdx}`);
            if (pdfOptIncludeSubtasks.checked) {
                task.subtasks.forEach((_, sIdx) => {
                    selectedPreviewKeys.add(`sub_${tIdx}_${sIdx}`);
                });
            }
        });
    }
    renderPdfPreview();
});

pdfBtnConfirm.addEventListener('click', () => {
    if (selectedPreviewKeys.size === 0) {
        alert('Selecione pelo menos uma tarefa para importar.');
        return;
    }

    const includeSubtasks = pdfOptIncludeSubtasks.checked;
    const applyDays = pdfOptApplyDays.checked;
    let importedCount = 0;

    parsedPdfTasks.forEach((task, tIdx) => {
        const mainKey = `main_${tIdx}`;
        
        if (selectedPreviewKeys.has(mainKey)) {
            const newTask = createTask(task.text);
            if (applyDays && task.days.length > 0) {
                newTask.days = [...task.days];
                normalizeTaskDates(newTask);
            }
            
            if (includeSubtasks && task.subtasks.length > 0) {
                task.subtasks.forEach((sub, sIdx) => {
                    const subKey = `sub_${tIdx}_${sIdx}`;
                    if (selectedPreviewKeys.has(subKey)) {
                        newTask.subtasks.push({
                            id: genId(),
                            text: sub.text,
                            completed: false
                        });
                    }
                });
            }
            state.inbox.push(newTask);
            importedCount++;
        } else {
            if (includeSubtasks && task.subtasks.length > 0) {
                task.subtasks.forEach((sub, sIdx) => {
                    const subKey = `sub_${tIdx}_${sIdx}`;
                    if (selectedPreviewKeys.has(subKey)) {
                        const newSubtask = createTask(sub.text);
                        if (applyDays && sub.days.length > 0) {
                            newSubtask.days = [...sub.days];
                            normalizeTaskDates(newSubtask);
                        }
                        state.inbox.push(newSubtask);
                        importedCount++;
                    }
                });
            }
        }
    });

    saveState();
    refreshTaskContainerState({ type: 'inbox', blockId: null }, { animateNew: true });
    closePdfImportModal();
    showToast(`âœ“ ${importedCount} tarefas importadas com sucesso para o Inbox!`);
});

// ===========================
// WINDOW DRAG & DROP FOR PDF
// ===========================
let dragCounter = 0;

window.addEventListener('dragenter', (e) => {
    if (e.dataTransfer && e.dataTransfer.types && e.dataTransfer.types.includes('Files')) {
        dragCounter++;
        pdfDropOverlay.classList.add('active');
    }
});

window.addEventListener('dragleave', () => {
    dragCounter--;
    if (dragCounter <= 0) {
        dragCounter = 0;
        pdfDropOverlay.classList.remove('active');
    }
});

window.addEventListener('dragover', (e) => {
    if (e.dataTransfer && e.dataTransfer.types && e.dataTransfer.types.includes('Files')) {
        e.preventDefault();
    }
});

window.addEventListener('drop', (e) => {
    dragCounter = 0;
    pdfDropOverlay.classList.remove('active');

    if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        const file = e.dataTransfer.files[0];
        if (file.type.includes('pdf') || file.name.toLowerCase().endsWith('.pdf')) {
            e.preventDefault();
            processPdfFile(file);
        }
    }
});

// ===========================
// SIDE PANEL (TASK DETAILS)
// ===========================
let currentEditingTask = null;
let sidePanelMode = 'comparison';
let subtaskDragState = null;
const sidePanel = document.getElementById('side-panel');
const sidePanelOverlay = document.getElementById('side-panel-overlay');
const sidePanelModeButton = document.getElementById('side-panel-mode');
const sidePanelRepeatButton = document.getElementById('side-panel-repeat');
const sidePanelRepeatValue = document.getElementById('side-panel-repeat-value');
const subtaskListEl = document.getElementById('subtask-list');
const subtaskInputEl = document.getElementById('subtask-input');

function setSidePanelMode(mode) {
    sidePanelMode = mode;
    const isFocusMode = mode === 'focus';
    sidePanel.classList.toggle('focus-mode', isFocusMode);
    sidePanelOverlay.classList.toggle('active', isFocusMode);
    sidePanelModeButton.setAttribute('aria-pressed', String(isFocusMode));
    sidePanelModeButton.textContent = isFocusMode ? 'Comparar' : 'Foco';
    sidePanelModeButton.title = isFocusMode ? 'Voltar ao modo comparaÃ§Ã£o' : 'Ativar modo foco';
}

function openSidePanel(task) {
    currentEditingTask = task;
    document.getElementById('side-panel-title').textContent = task.text;
    refreshSidePanelRecurrence();
    renderSubtasks();
    sidePanel.classList.add('active');
}

function refreshSidePanelRecurrence() {
    if (!sidePanelRepeatValue || !currentEditingTask) return;
    const recurrence = RECURRENCE.normalize(currentEditingTask.recurrence);
    sidePanelRepeatValue.textContent = RECURRENCE.getLabel(recurrence);
    sidePanelRepeatButton.classList.toggle('active', Boolean(recurrence));
}

function closeSidePanel() {
    closeTaskPickers();
    sidePanel.classList.remove('active');
    setSidePanelMode('comparison');
    currentEditingTask = null;
}

function deleteSubtaskFromTask(task, subtaskIndex) {
    const subtask = task?.subtasks?.[subtaskIndex];
    if (!subtask) return;
    const location = findTaskLocation(task.id);
    addDeletedItem('subtask', subtask, {
        parentTaskId: task.id,
        parentTitle: task.text,
        type: location.type,
        blockId: location.blockId,
        index: subtaskIndex,
    });
    task.subtasks.splice(subtaskIndex, 1);
    saveState();
    renderDeletedItems();
    renderSubtasks();
    refreshTaskCard(task);
}

document.getElementById('side-panel-close').addEventListener('click', closeSidePanel);
sidePanelModeButton.addEventListener('click', () => {
    setSidePanelMode(sidePanelMode === 'focus' ? 'comparison' : 'focus');
});
sidePanelRepeatButton.addEventListener('click', event => {
    event.stopPropagation();
    if (currentEditingTask) toggleRepeatPicker(currentEditingTask, sidePanelRepeatButton, { sidePanel: true });
});
sidePanelOverlay.addEventListener('click', (e) => e.preventDefault());

function renderSubtasks() {
    if (!currentEditingTask) return;
    subtaskListEl.innerHTML = '';
    const subtasks = currentEditingTask.subtasks || [];
    
    subtasks.forEach((subtask, index) => {
        const item = document.createElement('div');
        item.className = 'subtask-item' + (subtask.completed ? ' completed' : '');
        item.dataset.subtaskId = subtask.id;

        const dragHandle = document.createElement('span');
        dragHandle.className = 'subtask-drag-handle';
        dragHandle.setAttribute('draggable', 'true');
        dragHandle.title = 'Arrastar para reordenar';
        dragHandle.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="9" cy="6" r="1"></circle><circle cx="15" cy="6" r="1"></circle><circle cx="9" cy="12" r="1"></circle><circle cx="15" cy="12" r="1"></circle><circle cx="9" cy="18" r="1"></circle><circle cx="15" cy="18" r="1"></circle></svg>';
        dragHandle.addEventListener('dragstart', (e) => {
            subtaskDragState = { subtaskId: subtask.id, taskId: currentEditingTask.id };
            item.classList.add('subtask-dragging');
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', subtask.id);
        });
        dragHandle.addEventListener('dragend', () => {
            item.classList.remove('subtask-dragging');
            subtaskDragState = null;
        });
        
        const checkbox = document.createElement('div');
        checkbox.className = 'subtask-checkbox' + (subtask.completed ? ' completed' : '');
        checkbox.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>';
        
        checkbox.addEventListener('click', () => {
            subtask.completed = !subtask.completed;
            saveState();
            renderSubtasks();
            refreshTaskCard(currentEditingTask);
        });

        const textEl = document.createElement('div');
        textEl.className = 'subtask-text';
        textEl.textContent = subtask.text;
        textEl.title = 'Clique para editar';
        
        textEl.addEventListener('click', (e) => {
            e.stopPropagation();
            const input = document.createElement('textarea');
            input.className = 'task-text-input';
            input.setAttribute('aria-label', 'Editar subtarefa');
            input.value = subtask.text;
            input.rows = 1;
            
            const adjustHeight = () => {
                input.style.height = 'auto';
                input.style.height = input.scrollHeight + 'px';
            };
            input.addEventListener('input', adjustHeight);

            textEl.replaceWith(input);
            input.focus();
            input.setSelectionRange(0, input.value.length);
            adjustHeight();

            const finish = () => {
                const val = input.value.trim();
                if (val && val !== subtask.text) {
                    subtask.text = val;
                    saveState();
                }
                renderSubtasks();
                refreshTaskCard(currentEditingTask);
            };

            input.addEventListener('blur', finish);
            input.addEventListener('keydown', (ev) => {
                if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); input.blur(); }
                if (ev.key === 'Escape') { input.value = subtask.text; input.blur(); }
            });
        });

        const actions = document.createElement('div');
        actions.style.display = 'flex';
        actions.style.gap = '4px';

        const promoteBtn = document.createElement('button');
        promoteBtn.className = 'subtask-delete';
        promoteBtn.title = 'Promover a tarefa';
        promoteBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="16" height="16"><polyline points="9 18 15 12 9 6"></polyline></svg>';
        promoteBtn.addEventListener('click', () => {
            currentEditingTask.subtasks.splice(index, 1);
            const newTask = createTask(subtask.text);
            newTask.completed = subtask.completed;
            state.inbox.unshift(newTask);
            saveState();
            renderSubtasks();
            refreshTaskCard(currentEditingTask);
            refreshTaskContainerState({ type: 'inbox', blockId: null }, { animateNew: true });
        });

        const delBtn = document.createElement('button');
        delBtn.className = 'subtask-delete';
        delBtn.title = 'Excluir';
        delBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="16" height="16"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>';
        
        delBtn.addEventListener('click', () => {
            deleteSubtaskFromTask(currentEditingTask, index);
        });

        actions.appendChild(promoteBtn);
        actions.appendChild(delBtn);

        item.appendChild(dragHandle);
        item.appendChild(checkbox);
        item.appendChild(textEl);
        item.appendChild(actions);
        subtaskListEl.appendChild(item);
    });
}

function getSubtaskDragAfterElement(container, y) {
    return [...container.querySelectorAll('.subtask-item:not(.subtask-dragging)')].reduce((closest, item) => {
        const box = item.getBoundingClientRect();
        const offset = y - box.top - box.height / 2;
        return offset < 0 && offset > closest.offset ? { offset, element: item } : closest;
    }, { offset: Number.NEGATIVE_INFINITY }).element;
}

subtaskListEl.addEventListener('dragover', (e) => {
    if (!subtaskDragState || subtaskDragState.taskId !== currentEditingTask?.id) return;
    e.preventDefault();
    const draggingItem = subtaskListEl.querySelector('.subtask-dragging');
    const afterElement = getSubtaskDragAfterElement(subtaskListEl, e.clientY);
    if (draggingItem && afterElement !== draggingItem) {
        subtaskListEl.insertBefore(draggingItem, afterElement || null);
    }
});

subtaskListEl.addEventListener('drop', (e) => {
    if (!subtaskDragState || subtaskDragState.taskId !== currentEditingTask?.id) return;
    e.preventDefault();
    const subtasksById = new Map(currentEditingTask.subtasks.map(subtask => [subtask.id, subtask]));
    const reorderedSubtasks = [...subtaskListEl.querySelectorAll('.subtask-item')]
        .map(item => subtasksById.get(item.dataset.subtaskId))
        .filter(Boolean);
    const orderChanged = reorderedSubtasks.some((subtask, index) => subtask.id !== currentEditingTask.subtasks[index]?.id);
    if (orderChanged) {
        currentEditingTask.subtasks = reorderedSubtasks;
        saveState();
    }
});

subtaskInputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && currentEditingTask) {
        e.preventDefault();
        const val = subtaskInputEl.value.trim();
        if (val) {
            if (!currentEditingTask.subtasks) currentEditingTask.subtasks = [];
            currentEditingTask.subtasks.push({
                id: genId(),
                text: val,
                completed: false
            });
            saveState();
            renderSubtasks();
            refreshTaskCard(currentEditingTask);
            subtaskInputEl.value = '';
        }
    }
});

// ===========================
// INIT
// ===========================
async function init() {
    initTheme();

    const user = await window.FocusCloud?.requireUser();
    if (window.FocusCloud?.configured && !user) return;

    const loaded = await loadState();
    if (!loaded) {
        // Initialize with default blocks
        state.blocks = DEFAULT_BLOCKS;
    }
    const myDayEnsured = ensureMyDayBlock();
    const normalizedTasks = normalizeOrganizerTasks();
    const activatedRecurrences = materializeDueRecurrences();
    if (myDayEnsured || normalizedTasks || activatedRecurrences > 0) saveState();
    normalizeFilterOrders(state);
    restoreCollapsedCompletedSections(state);
    applyFilterOrders();

    // Update nextColorIndex based on existing blocks
    if (state.blocks.length > 0) {
        nextColorIndex = state.blocks.length;
    }

    // Bind Search Input
    const searchInput = document.getElementById('search-input');
    if (searchInput) {
        searchInput.value = state.searchQuery || '';
        searchInput.addEventListener('input', (e) => {
            state.searchQuery = e.target.value;
            refreshTaskVisibility();
        });
    }

    renderInitialView();
    renderDeletedItems();
    scheduleRecurrenceWakeUp();
    scheduleDateRefresh();
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) runRecurrenceActivation();
    });
    window.addEventListener('focus', runRecurrenceActivation);
    inboxInput.focus();
}

init();

