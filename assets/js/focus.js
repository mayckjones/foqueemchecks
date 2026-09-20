// Elementos do DOM
const screenAdd = document.getElementById('screen-add');
const screenFocus = document.getElementById('screen-focus');
const screenDone = document.getElementById('screen-done');

const taskInput = document.getElementById('task-input');
const btnStart = document.getElementById('btn-start');
const btnShuffle = document.getElementById('btn-shuffle');
const btnResume = document.getElementById('btn-resume');

const currentTaskEl = document.getElementById('current-task');
const progressText = document.getElementById('progress-text');
const progressBar = document.getElementById('progress-bar');
const btnComplete = document.getElementById('btn-complete');
const btnSkip = document.getElementById('btn-skip');
const btnHome = document.getElementById('btn-home');
const btnPrev = document.getElementById('btn-prev');
const btnUploadFile = document.getElementById('btn-upload-file');
const btnPaste = document.getElementById('btn-paste');
const fileInput = document.getElementById('file-input');
const ocrStatus = document.getElementById('ocr-status');

const doneMessage = document.getElementById('done-message');
const btnRestart = document.getElementById('btn-restart');
const btnTheme = document.getElementById('btn-theme-index');

// Estado do App
let tasks = [];
let currentIndex = 0;
let blockTitle = '';
let blockId = null;
let fromOrganizer = false;

// Inicializar lendo do LocalStorage
async function init() {
    initTheme();
    const params = new URLSearchParams(window.location.search);
    const enterFocus = params.get('mode') === 'focus';
    const launchedFromOrganizer = params.get('from') === 'organizer';
    if (!enterFocus) {
        window.location.replace('organizer.html');
        return;
    }

    const user = await window.FocusCloud?.requireUser();
    if (window.FocusCloud?.configured && !user) return;

    if (!launchedFromOrganizer) {
        if (window.FocusCloud?.removeLocalState) {
            window.FocusCloud.removeLocalState('focusAppState');
        } else {
            localStorage.removeItem('focusAppState');
        }
        tasks = [];
        currentIndex = 0;
        blockTitle = '';
        blockId = null;
        fromOrganizer = false;
        updateBlockBadge();
        showScreen(screenAdd);
        return;
    }

    const localRecord = window.FocusCloud?.readLocalRecord
        ? window.FocusCloud.readLocalRecord('focusAppState')
        : { state: JSON.parse(localStorage.getItem('focusAppState') || 'null'), savedAt: null };
    let savedData = localRecord.state ? JSON.stringify(localRecord.state) : null;
    if (window.FocusCloud?.configured) {
        try {
            const cloudRecord = await window.FocusCloud.loadFocusRecord();
            const cloudState = cloudRecord.state;
            const localHasTasks = Array.isArray(localRecord.state?.tasks) && localRecord.state.tasks.length > 0;
            const cloudHasTasks = Array.isArray(cloudState?.tasks) && cloudState.tasks.length > 0;
            const localIsNewer = localRecord.savedAt && cloudRecord.updatedAt &&
                new Date(localRecord.savedAt).getTime() > new Date(cloudRecord.updatedAt).getTime();
            if (cloudHasTasks && !(localHasTasks && localIsNewer)) {
                savedData = JSON.stringify(cloudState);
                window.FocusCloud.writeLocalState('focusAppState', cloudState, {
                    savedAt: cloudRecord.updatedAt,
                    source: 'cloud',
                    reason: 'before-cloud-restore'
                });
            } else if (localHasTasks && (!cloudHasTasks || localIsNewer)) {
                window.FocusCloud.showStatus('A sessÃ£o local mais recente foi preservada', 'warning');
            }
        } catch (error) {
            console.error('Erro ao carregar sessÃ£o de foco da nuvem:', error);
            window.FocusCloud.showStatus('Usando a cÃ³pia local', 'warning');
        }
    }
    if (savedData) {
        try {
            const state = JSON.parse(savedData);
            if (state.tasks && state.tasks.length > 0 && state.currentIndex < state.tasks.length) {
                tasks = state.tasks;
                currentIndex = state.currentIndex;
                blockTitle = state.blockTitle || '';
                blockId = state.blockId || null;
                fromOrganizer = !!state.fromOrganizer;

                updateBlockBadge();
                showScreen(screenFocus);
                
                // Restaura o progresso
                const total = tasks.length;
                const current = currentIndex + 1;
                const percentage = ((current - 1) / total) * 100;
                progressBar.style.width = `${percentage}%`;
                
                updateFocusView(false); // sem animaÃ§Ã£o inicial forte
                return;
            }
        } catch (e) {
            console.error("Erro ao ler LocalStorage", e);
        }
    }
    // PadrÃ£o: tela de adiÃ§Ã£o
    showScreen(screenAdd);
}

function updateBlockBadge() {
    const badge = document.getElementById('focus-block-badge');
    const nameEl = document.getElementById('focus-block-name');
    if (badge && nameEl) {
        if (blockTitle) {
            nameEl.textContent = blockTitle;
            badge.style.display = 'inline-flex';
        } else {
            badge.style.display = 'none';
        }
    }
}

function saveState() {
    const focusState = {
        tasks: tasks,
        currentIndex: currentIndex,
        blockTitle: blockTitle,
        blockId: blockId,
        fromOrganizer: fromOrganizer
    };
    if (window.FocusCloud?.writeLocalState) {
        window.FocusCloud.writeLocalState('focusAppState', focusState);
    } else {
        localStorage.setItem('focusAppState', JSON.stringify(focusState));
    }
    window.FocusCloud?.scheduleFocusSave(focusState);
}

function clearState() {
    if (window.FocusCloud?.removeLocalState) {
        window.FocusCloud.removeLocalState('focusAppState');
    } else {
        localStorage.removeItem('focusAppState');
    }
    window.FocusCloud?.clearFocusState();
    blockTitle = '';
    blockId = null;
    fromOrganizer = false;
    updateBlockBadge();
}

function syncTaskStateWithOrganizer(taskObj, targetBlockId, completeMainTask = true) {
    if (!taskObj || !taskObj.id) return;
    try {
        const orgState = window.FocusCloud?.readLocalRecord
            ? window.FocusCloud.readLocalRecord('focusOrganizerState').state
            : JSON.parse(localStorage.getItem('focusOrganizerState') || 'null');
        if (!orgState) return;
        if (!orgState.blocks) return;

        let updated = false;
        for (const b of orgState.blocks) {
            if (targetBlockId && b.id !== targetBlockId) continue;
            for (const t of b.tasks) {
                if (t.id === taskObj.id) {
                    if (completeMainTask) {
                        t.completed = true;
                        t.completedAt = new Date().toISOString();
                        const recurrence = window.FocusRecurrence?.normalize(t.recurrence);
                        if (recurrence && !recurrence.nextDate && !recurrence.spawnedTaskId) {
                            const referenceDate = window.FocusRecurrence.today();
                            const exactDate = (t.days || []).find(day => window.FocusRecurrence.parseLocalDate(day));
                            t.recurrence = {
                                ...window.FocusRecurrence.configOnly(recurrence),
                                seriesId: recurrence.seriesId || `series_${t.id}`,
                                nextDate: window.FocusRecurrence.getNextDate(exactDate || referenceDate, recurrence, referenceDate),
                            };
                        }
                    }
                    t.subtasks = taskObj.subtasks || [];
                    updated = true;
                    break;
                }
            }
            if (updated) break;
        }
        if (updated) {
            if (window.FocusCloud?.writeLocalState) {
                window.FocusCloud.writeLocalState('focusOrganizerState', orgState);
            } else {
                localStorage.setItem('focusOrganizerState', JSON.stringify(orgState));
            }
            window.FocusCloud?.scheduleOrganizerSave(orgState);
        }
    } catch (e) {
        console.error("Erro ao sincronizar com organizador", e);
    }
}

function showScreen(screenEl) {
    document.querySelectorAll('.screen').forEach(s => {
        s.style.display = 'none';
        s.classList.remove('active');
    });
    
    if (screenEl === screenAdd) {
        if (tasks.length > 0 && currentIndex < tasks.length) {
            btnResume.style.display = 'flex';
        } else {
            btnResume.style.display = 'none';
        }
    }
    
    screenEl.style.display = 'flex';
    // Pequeno delay para permitir a transiÃ§Ã£o do display:flex
    setTimeout(() => {
        screenEl.classList.add('active');
    }, 10);
}

function updateFocusView(animate = true) {
    const total = tasks.length;
    const current = currentIndex + 1;
    const currentTask = tasks[currentIndex];
    const isObj = typeof currentTask === 'object' && currentTask !== null;
    const text = isObj ? currentTask.text : currentTask;
    const subtasks = isObj && currentTask.subtasks ? currentTask.subtasks : [];
    
    btnPrev.disabled = currentIndex === 0;

    const renderContent = () => {
        currentTaskEl.textContent = text;
        progressText.textContent = `Tarefa ${current} de ${total}`;
        
        const percentage = ((current - 1) / total) * 100;
        progressBar.style.width = `${percentage}%`;

        const subtasksContainer = document.getElementById('focus-subtasks');
        subtasksContainer.innerHTML = '';
        if (subtasks.length > 0) {
            subtasks.forEach(st => {
                const stEl = document.createElement('div');
                stEl.className = 'focus-subtask-item' + (st.completed ? ' completed' : '');
                const checkbox = document.createElement('div');
                checkbox.className = 'focus-subtask-checkbox';
                checkbox.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>';
                const subtaskText = document.createElement('div');
                subtaskText.className = 'focus-subtask-text';
                subtaskText.textContent = st.text;
                stEl.append(checkbox, subtaskText);
                stEl.addEventListener('click', () => {
                    st.completed = !st.completed;
                    stEl.classList.toggle('completed', st.completed);
                    saveState();
                    if (isObj && currentTask.id) {
                        syncTaskStateWithOrganizer(currentTask, blockId, false);
                    }
                });
                subtasksContainer.appendChild(stEl);
            });
        }
    };
    
    if (animate) {
        // AnimaÃ§Ã£o de saÃ­da
        currentTaskEl.style.opacity = 0;
        currentTaskEl.style.transform = 'translateY(10px)';
        document.getElementById('focus-subtasks').style.opacity = 0;
        
        setTimeout(() => {
            renderContent();
            // AnimaÃ§Ã£o de entrada
            currentTaskEl.style.opacity = 1;
            currentTaskEl.style.transform = 'translateY(0)';
            document.getElementById('focus-subtasks').style.opacity = 1;
        }, 300);
    } else {
        renderContent();
        currentTaskEl.style.opacity = 1;
        currentTaskEl.style.transform = 'translateY(0)';
        document.getElementById('focus-subtasks').style.opacity = 1;
    }
}

// Tema
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
    document.getElementById('icon-sun-index').style.display = isDark ? 'none' : 'block';
    document.getElementById('icon-moon-index').style.display = isDark ? 'block' : 'none';
}

if (btnTheme) {
    btnTheme.addEventListener('click', toggleTheme);
}

// Event Listeners
btnShuffle.addEventListener('click', () => {
    const lines = taskInput.value.split('\n').map(t => t.trim()).filter(t => t.length > 0);
    if (lines.length > 0) {
        for (let i = lines.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [lines[i], lines[j]] = [lines[j], lines[i]];
        }
        taskInput.value = lines.join('\n');
    }
});

btnUploadFile.addEventListener('click', () => {
    fileInput.click();
});

btnPaste.addEventListener('click', () => {
    alert('Use Ctrl+V para colar uma captura de tela com tarefas na pÃ¡gina.');
});

fileInput.addEventListener('change', async (event) => {
    const file = event.target.files[0];
    if (file) {
        await processImageFile(file);
    }
    fileInput.value = '';
});

document.addEventListener('paste', async (event) => {
    const items = event.clipboardData && event.clipboardData.items;
    if (!items) return;

    for (const item of items) {
        if (item.type.indexOf('image') !== -1) {
            const blob = item.getAsFile();
            if (blob) {
                await processImageFile(blob);
                return;
            }
        }
    }
});

function setOcrStatus(message, isError = false) {
    ocrStatus.textContent = message;
    ocrStatus.style.color = isError ? '#B91C1C' : 'var(--text-main)';
    ocrStatus.classList.remove('hidden');
}

async function processImageFile(file) {
    setOcrStatus('Extraindo texto da imagem...');

    try {
        const imageUrl = URL.createObjectURL(file);
        const { data: { text } } = await Tesseract.recognize(imageUrl, 'por', {
            logger: m => {
                if (m.status === 'recognizing text' && m.progress !== undefined) {
                    setOcrStatus(`Extraindo texto... ${Math.round(m.progress * 100)}%`);
                }
            }
        });
        URL.revokeObjectURL(imageUrl);
        const cleanedText = text.replace(/\s+$/gm, '').trim();
        const newTasks = parseTasksFromText(cleanedText);

        if (newTasks.length === 0) {
            setOcrStatus('NÃ£o foi possÃ­vel identificar tarefas na imagem.', true);
            return;
        }

        const currentTasks = taskInput.value
            .split('\n')
            .map(line => line.trim())
            .filter(line => line.length > 0);

        taskInput.value = [...currentTasks, ...newTasks].join('\n');
        setOcrStatus(`ExtraÃ­do ${newTasks.length} tarefas e inserido na caixa acima.`, false);
    } catch (error) {
        console.error(error);
        setOcrStatus('Erro ao processar a imagem. Tente novamente.', true);
    }
}

function parseTasksFromText(text) {
    const lines = text
        .split(/\r?\n|â€¢|-|\d+\.|\)|\:/)
        .map(line => line.trim())
        .filter(line => line.length > 2);
    return lines;
}

btnStart.addEventListener('click', () => {
    const lines = taskInput.value.split('\n');
    tasks = lines.map(t => t.trim()).filter(t => t.length > 0).map(t => ({ id: null, text: t, subtasks: [] }));
    
    if (tasks.length === 0) {
        alert('Por favor, adicione pelo menos uma tarefa para iniciar o Modo Foco.');
        return;
    }

    blockTitle = '';
    blockId = null;
    fromOrganizer = false;
    updateBlockBadge();

    currentIndex = 0;
    saveState();
    showScreen(screenFocus);
    
    // Inicializa a barra de progresso zerada e depois anima para a primeira tarefa
    progressBar.style.width = '0%';
    updateFocusView(false); // Define o texto logo
    currentTaskEl.style.opacity = 0;
    currentTaskEl.style.transform = 'translateY(10px)';
    
    setTimeout(() => {
        currentTaskEl.style.opacity = 1;
        currentTaskEl.style.transform = 'translateY(0)';
    }, 100);
});

btnComplete.addEventListener('click', () => {
    if (currentIndex < tasks.length) {
        const currentTask = tasks[currentIndex];
        const isObj = typeof currentTask === 'object' && currentTask !== null;
        if (isObj) {
            syncTaskStateWithOrganizer(currentTask, blockId, true);
        }
    }

    currentIndex++;
    saveState();
    
    const total = tasks.length;
    
    if (currentIndex < total) {
        updateFocusView();
    } else {
        // Completou tudo
        progressBar.style.width = '100%';
        
        // AnimaÃ§Ã£o de saÃ­da da Ãºltima tarefa antes de ir para a tela final
        currentTaskEl.style.opacity = 0;
        currentTaskEl.style.transform = 'translateY(-10px)';
        
        setTimeout(() => {
            doneMessage.textContent = `VocÃª concluiu todas as ${tasks.length} tarefas!`;
            clearState();
            showScreen(screenDone);
        }, 400);
    }
});

btnSkip.addEventListener('click', () => {
    // SÃ³ pula se nÃ£o for a Ãºltima tarefa da lista
    if (currentIndex < tasks.length - 1) {
        // Remove a tarefa atual e coloca no final da lista
        const skippedTask = tasks.splice(currentIndex, 1)[0];
        tasks.push(skippedTask);
        
        saveState();
        updateFocusView();
    }
});

btnRestart.addEventListener('click', () => {
    tasks = [];
    currentIndex = 0;
    taskInput.value = '';
    showScreen(screenAdd);
});

btnPrev.addEventListener('click', () => {
    if (currentIndex > 0) {
        currentIndex--;
        saveState();
        updateFocusView();
    }
});

btnHome.addEventListener('click', () => {
    saveState();
    showScreen(screenAdd);
});

btnResume.addEventListener('click', () => {
    showScreen(screenFocus);
    updateFocusView(false);
});

// Inicia o app
init();


