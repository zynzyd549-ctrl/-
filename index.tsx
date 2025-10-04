import { Notebook } from "./notebook.js";
import { GoogleGenAI } from "@google/genai";

// --- PWA Service Worker Registration ---
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').then(registration => {
      console.log('Service Worker registered: ', registration);
    }).catch(registrationError => {
      console.log('Service Worker registration failed: ', registrationError);
    });
  });
}

// --- Utility Functions ---
const sleep = (ms: number) => new Promise(res => setTimeout(res, ms));

// --- Sound Engine ---
class SoundManager {
    private audioCtx: AudioContext;
    private engineHumSource: { oscillator: OscillatorNode, filter: BiquadFilterNode, gain: GainNode } | null = null;

    constructor() {
        this.audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
    }

    private async resumeContext() {
        if (this.audioCtx.state === 'suspended') {
            await this.audioCtx.resume();
        }
    }

    private createOscillator(freq: number, type: OscillatorType, duration: number, gainValue: number) {
        if (this.audioCtx.state === 'suspended') return;
        const oscillator = this.audioCtx.createOscillator();
        const gainNode = this.audioCtx.createGain();

        oscillator.type = type;
        oscillator.frequency.setValueAtTime(freq, this.audioCtx.currentTime);
        gainNode.gain.setValueAtTime(gainValue, this.audioCtx.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.0001, this.audioCtx.currentTime + duration);

        oscillator.connect(gainNode);
        gainNode.connect(this.audioCtx.destination);
        oscillator.start();
        oscillator.stop(this.audioCtx.currentTime + duration);
    }

    async playRaceStartCountdown() {
        await this.resumeContext();
        this.createOscillator(440, 'sine', 0.15, 0.3);
        await sleep(500);
        this.createOscillator(440, 'sine', 0.15, 0.3);
        await sleep(500);
        this.createOscillator(880, 'sine', 0.3, 0.4);
        await sleep(200);
    }
    
    playLapCompletion() {
        this.createOscillator(880, 'sine', 0.2, 0.25);
    }

    playStageWin() {
        this.createOscillator(523.25, 'sine', 0.1, 0.3); // C5
        setTimeout(() => this.createOscillator(659.25, 'sine', 0.1, 0.3), 120); // E5
        setTimeout(() => this.createOscillator(783.99, 'sine', 0.2, 0.3), 240); // G5
    }

    playRaceWin() {
        this.createOscillator(523.25, 'sine', 0.1, 0.3); // C5
        setTimeout(() => this.createOscillator(659.25, 'sine', 0.1, 0.3), 120); // E5
        setTimeout(() => this.createOscillator(783.99, 'sine', 0.1, 0.3), 240); // G5
        setTimeout(() => this.createOscillator(1046.50, 'sine', 0.3, 0.35), 360); // C6
    }
    
    startEngineHum() {
        this.resumeContext();
        if (this.engineHumSource || this.audioCtx.state === 'suspended') return;

        const oscillator = this.audioCtx.createOscillator();
        const filter = this.audioCtx.createBiquadFilter();
        const gain = this.audioCtx.createGain();

        oscillator.type = 'sawtooth';
        oscillator.frequency.value = 70;
        
        filter.type = 'lowpass';
        filter.frequency.value = 200;

        gain.gain.value = 0.05; // Keep it subtle

        oscillator.connect(filter);
        filter.connect(gain);
        gain.connect(this.audioCtx.destination);
        
        oscillator.start();
        this.engineHumSource = { oscillator, filter, gain };
    }

    stopEngineHum() {
        if (this.engineHumSource) {
            this.engineHumSource.oscillator.stop();
            this.engineHumSource = null;
        }
    }
}


// --- Game Classes ---
class Car {
    name: string;
    speed: number;
    handling: number;
    color: string;
    position: number;
    currentLap: number;
    damage: number;
    tireWear: number;

    constructor(name: string, speed: number, handling: number, color: string) {
        this.name = name;
        this.speed = speed;
        this.handling = handling;
        this.color = color;
        this.reset();
    }

    reset() {
        this.position = 0;
        this.currentLap = 1;
        this.damage = 0;
        this.tireWear = 100;
    }
}

class Stage {
    name: string;
    length: number;
    laps: number;
    
    constructor(name: string, length: number, laps: number) {
        this.name = name;
        this.length = length;
        this.laps = laps;
    }
}

class AICommentator {
    private ai: GoogleGenAI | null;
    private systemInstruction: string;
    private commentaryElement: HTMLElement | null;

    constructor() {
        try {
            this.ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
            this.systemInstruction = "You are an excited and energetic sports announcer for a futuristic car race. Your comments must be in Arabic. Keep them brief (1-2 sentences), punchy, and exciting. Focus on the action. Never mention you are an AI.";
        } catch (e) {
            console.error("Failed to initialize AI Commentator. Is the API_KEY set?", e);
            this.ai = null;
        }
        this.commentaryElement = document.getElementById('commentary-box');
    }

    async generateCommentary(prompt: string) {
        if (!this.ai || !this.commentaryElement) {
            console.log("AI Commentator not available.");
            return;
        }

        this.commentaryElement.textContent = '...المعلق يفكر';
        this.commentaryElement.style.color = '#888';

        try {
            const response = await this.ai.models.generateContent({
                model: 'gemini-2.5-flash',
                contents: prompt,
                config: {
                    systemInstruction: this.systemInstruction,
                    temperature: 0.8,
                },
            });
            const commentaryText = response.text;
            this.commentaryElement.textContent = commentaryText;
            this.commentaryElement.style.color = '#f2f2f2';
        } catch (error) {
            console.error("Error generating commentary:", error);
            this.commentaryElement.textContent = '...صمت في غرفة التعليق';
        }
    }
}

class RacingGame {
    cars: Car[];
    stages: Stage[];
    leaderboard: { [key: string]: number };
    isFinished: boolean;
    carCanvases: (CanvasRenderingContext2D | null)[];
    carParticles: { x: number, y: number, vx: number, vy: number, life: number, startLife: number, color: string }[][];
    
    commentator: AICommentator;
    soundManager: SoundManager;
    lastCommentaryTime: number;
    commentaryCooldown: number = 7000; // 7 seconds
    previousLeader: Car | null = null;
    stageResults: any[];
    currentStageIndex: number;

    constructor(cars: Car[], stages: Stage[]) {
        this.cars = cars;
        this.stages = stages;
        this.commentator = new AICommentator();
        this.soundManager = new SoundManager();
        this.resetForNewRace();
    }

    resetForNewRace() {
        this.isFinished = false;
        this.leaderboard = {};
        this.cars.forEach(car => this.leaderboard[car.name] = 0);
        this.initializeTrackUI();
        this.carCanvases = [];
        this.carParticles = this.cars.map(() => []);
        this.lastCommentaryTime = -Infinity;
        this.previousLeader = null;
        this.stageResults = [];
        this.currentStageIndex = 0;
    }

    initializeTrackUI() {
        const trackVisuals = document.getElementById('track-visuals');
        if (!trackVisuals) return;
        trackVisuals.innerHTML = '';
        this.cars.forEach((car, index) => {
            const carEl = document.createElement('div');
            carEl.id = `car-${index}`;
            carEl.className = 'car';
            carEl.style.backgroundColor = car.color;
            if(car.color === '#eee') carEl.style.color = '#333';
            
            carEl.innerHTML = `
                <canvas id="car-canvas-${index}" class="car-particles-canvas"></canvas>
                <div class="car-body">
                    <div class="car-info">
                        <span>${car.name}</span>
                        <span id="car-lap-${index}"></span>
                    </div>
                    <div class="car-stats">
                        <div class="damage-bar-container">
                          <div id="car-damage-${index}" class="damage-bar"></div>
                        </div>
                        <div class="tire-wear-container">
                          <div id="car-tire-${index}" class="tire-wear-bar"></div>
                        </div>
                    </div>
                </div>
            `;
            trackVisuals.appendChild(carEl);

            const canvas = document.getElementById(`car-canvas-${index}`) as HTMLCanvasElement;
            if (canvas) {
                setTimeout(() => {
                    const rect = carEl.getBoundingClientRect();
                    canvas.width = rect.width;
                    canvas.height = rect.height;
                    this.carCanvases[index] = canvas.getContext('2d');
                }, 0);
            }
        });
    }

    updateAllVisuals(stage, distanceIncrements) {
        const containerWidth = document.getElementById('track-visuals')?.clientWidth || 1;
        this.cars.forEach((car, index) => {
            const carEl = document.getElementById(`car-${index}`) as HTMLElement;
            const ctx = this.carCanvases[index];
            if (!carEl || !ctx) return;
            
            const particles = this.carParticles[index];
            const carWidth = carEl.clientWidth;
            const progress = car.position / stage.length;
            const position = progress * (containerWidth - carWidth);
            carEl.style.transform = `translateX(${position}px)`;

            const lapCounter = document.getElementById(`car-lap-${index}`) as HTMLElement;
            if (lapCounter) {
                const newLapText = `دورة ${car.currentLap > stage.laps ? stage.laps : car.currentLap}/${stage.laps}`;
                if (lapCounter.textContent !== newLapText) {
                    lapCounter.textContent = newLapText;
                    lapCounter.classList.add('lap-update-animation');
                    lapCounter.addEventListener('animationend', () => {
                        lapCounter.classList.remove('lap-update-animation');
                    }, { once: true });
                }
            }

            const damageBar = document.getElementById(`car-damage-${index}`);
            if (damageBar) {
                const damagePercent = 100 - car.damage;
                (damageBar as HTMLElement).style.width = `${damagePercent}%`;
                if (damagePercent < 30) (damageBar as HTMLElement).style.backgroundColor = '#e74c3c';
                else if (damagePercent < 60) (damageBar as HTMLElement).style.backgroundColor = '#f1c40f';
                else (damageBar as HTMLElement).style.backgroundColor = '#2ecc71';
            }

            const tireBar = document.getElementById(`car-tire-${index}`);
            if (tireBar) (tireBar as HTMLElement).style.width = `${car.tireWear}%`;
            
            ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
            for (let i = particles.length - 1; i >= 0; i--) {
                const p = particles[i];
                p.x += p.vx;
                p.y += p.vy;
                p.life--;
                if (p.life <= 0) {
                    particles.splice(i, 1);
                } else {
                    ctx.globalAlpha = p.life / p.startLife;
                    ctx.fillStyle = p.color;
                    ctx.fillRect(p.x, p.y, 2, 2);
                    ctx.globalAlpha = 1.0;
                }
            }

            const increment = distanceIncrements[car.name] || 0;
            const numNewParticles = Math.min(5, Math.floor(increment / 3));
            for (let i = 0; i < numNewParticles; i++) {
                const life = 20 + Math.random() * 20;
                particles.push({
                    x: 10, y: carEl.clientHeight / 2 + (Math.random() - 0.5) * 20,
                    vx: -1 - Math.random() * 2, vy: (Math.random() - 0.5) * 1.5,
                    life: life, startLife: life, color: 'rgba(80, 80, 80, 0.7)',
                });
            }
        });
    }

    tryGenerateCommentary(prompt: string) {
        const now = performance.now();
        if (now - this.lastCommentaryTime > this.commentaryCooldown) {
            this.lastCommentaryTime = now;
            this.commentator.generateCommentary(prompt);
        }
    }

    async simulateStage(stage: Stage) {
        console.log(`\n--- بدء المرحلة: ${stage.name} (${stage.laps} دورات، ${stage.length} متر/دورة) ---`);
        this.cars.forEach(car => car.reset());
        this.isFinished = false;
        this.previousLeader = null;
        
        this.tryGenerateCommentary(`The race is starting for stage: ${stage.name}! All cars are revving their engines.`);
        await this.soundManager.playRaceStartCountdown();
        this.soundManager.startEngineHum();

        let winner: Car | null = null;
        
        while (!winner && !this.isFinished) {
            const distanceIncrements: { [key: string]: number } = {};
            for (const car of this.cars) {
                if (car.currentLap > stage.laps) continue;

                // --- Refined Physics Simulation ---
                const speedInMps = car.speed / 3.6;
                const damagePenalty = Math.pow(1 - (car.damage / 100), 1.5);
                const tireGripFactor = 0.4 + (car.tireWear / 100) * 0.6;
                const effectiveHandling = car.handling * tireGripFactor;
                const handlingFactor = (Math.random() - 0.5) * (12 - effectiveHandling) * 0.12;
                const distanceIncrement = (speedInMps + (speedInMps * handlingFactor)) * damagePenalty;
                distanceIncrements[car.name] = distanceIncrement;
                const baseDamage = Math.abs(handlingFactor) * (15 - car.handling) * 0.08;
                const speedDamageMultiplier = 1 + (speedInMps / 70);
                const damageTaken = baseDamage * speedDamageMultiplier;
                car.damage = Math.min(100, car.damage + damageTaken);
                const baseTireWear = (Math.abs(handlingFactor) * 2 + (speedInMps / 100)) * 0.06;
                car.tireWear = Math.max(0, car.tireWear - baseTireWear);
                car.position += distanceIncrement;

                if (car.position >= stage.length) {
                    car.position %= stage.length;
                    car.currentLap++;
                    this.soundManager.playLapCompletion();
                    if (car.currentLap > stage.laps && !winner) {
                        winner = car;
                        this.leaderboard[car.name]++;
                        console.log(`${car.name} finished the stage!`);
                        this.soundManager.playStageWin();
                        this.tryGenerateCommentary(`And that's the checkered flag! ${winner.name} wins stage ${stage.name}! An amazing performance!`);
                    }
                }
            }

            const carsByProgress = [...this.cars]
                .filter(c => c.currentLap <= stage.laps)
                .sort((a, b) => (b.currentLap * stage.length + b.position) - (a.currentLap * stage.length + a.position));
            const currentLeader = carsByProgress.length > 0 ? carsByProgress[0] : null;
            if (currentLeader && currentLeader !== this.previousLeader && this.previousLeader !== null) {
                this.tryGenerateCommentary(`Incredible! ${currentLeader.name} overtakes ${this.previousLeader.name} for the lead! What a move!`);
            }
            this.previousLeader = currentLeader;

            this.updateAllVisuals(stage, distanceIncrements);
            if (winner) this.isFinished = true;
            await sleep(50);
        }
        
        this.soundManager.stopEngineHum();
        
        this.stageResults.push({
            stageName: stage.name,
            winner: winner?.name || "N/A",
            finalStandings: this.cars.map(c => ({ name: c.name, damage: c.damage.toFixed(1), tireWear: c.tireWear.toFixed(1) }))
                .sort((a, b) => parseFloat(a.damage) - parseFloat(b.damage))
        });
        this.currentStageIndex++;
    }
    
    getOverallWinner(): string {
        let maxWins = -1;
        let winners = [];
        for (const carName in this.leaderboard) {
            const wins = this.leaderboard[carName];
            if (wins > maxWins) {
                maxWins = wins;
                winners = [carName];
            } else if (wins === maxWins) {
                winners.push(carName);
            }
        }
        return winners.join(' & ');
    }

    async runRace() {
        if (this.currentStageIndex === 0) { // Only reset if it's a completely new race
             this.resetForNewRace();
        }

        for (let i = this.currentStageIndex; i < this.stages.length; i++) {
            const stage = this.stages[i];
            await this.simulateStage(stage);
        }

        console.log("\n--- Race Finished! ---");
        const overallWinner = this.getOverallWinner();
        console.log(`Overall winner: ${overallWinner}`);
        this.soundManager.playRaceWin();
        this.tryGenerateCommentary(`What a Grand Prix! After all the stages, the overall champion is ${overallWinner}! A victory for the ages!`);
        
        const raceResult = {
            winner: overallWinner,
            leaderboard: this.leaderboard,
            stages: this.stageResults,
            date: new Date().toLocaleString()
        };
        updateRaceHistory(raceResult);
        showRaceSummary(raceResult);
    }
}

// --- Global State & UI Management ---
const notebook = new Notebook();
let raceHistory: any[] = JSON.parse(localStorage.getItem('raceHistory') || '[]');
let racingGame: RacingGame;

function updateRaceHistory(result: any) {
    raceHistory.unshift(result);
    if (raceHistory.length > 5) {
        raceHistory.pop();
    }
    localStorage.setItem('raceHistory', JSON.stringify(raceHistory));
    renderRaceHistory();
}

function renderRaceHistory() {
    const logEl = document.getElementById('history-log');
    if (!logEl) return;
    if (raceHistory.length === 0) {
        logEl.innerHTML = '<p>No race history yet. Run a race to see the results here.</p>';
        return;
    }
    logEl.innerHTML = raceHistory.map((race, index) => `
        <div class="history-entry">
            <div class="history-header" data-index="${index}">
                <span>🏆 ${race.winner}</span>
                <span>${race.date}</span>
            </div>
            <div class="history-details" id="details-${index}">
                <p><strong>Final Leaderboard:</strong></p>
                <ul>
                    ${Object.entries(race.leaderboard).map(([name, score]) => `<li>${name}: ${score} wins</li>`).join('')}
                </ul>
                <p><strong>Stage Results:</strong></p>
                ${race.stages.map(stage => `
                    <div>
                        <strong>${stage.stageName}</strong> - Winner: ${stage.winner}
                    </div>
                `).join('')}
            </div>
        </div>
    `).join('');

    logEl.querySelectorAll('.history-header').forEach(header => {
        header.addEventListener('click', () => {
            const index = header.getAttribute('data-index');
            const details = document.getElementById(`details-${index}`);
            header.classList.toggle('expanded');
            details?.classList.toggle('visible');
        });
    });
}

function showRaceSummary(result: any) {
    const overlay = document.getElementById('race-summary-overlay') as HTMLElement;
    const winnerEl = document.getElementById('race-summary-winner') as HTMLElement;
    const leaderboardEl = document.getElementById('race-summary-leaderboard') as HTMLElement;
    
    winnerEl.textContent = `Winner: ${result.winner}`;
    leaderboardEl.innerHTML = Object.entries(result.leaderboard)
        .sort(([, a], [, b]) => (b as number) - (a as number))
        .map(([name, score]) => `<div><span>${name}</span> <span>${score} wins</span></div>`)
        .join('');
    
    overlay.classList.add('visible');
}

function saveGameState() {
    if (!racingGame) {
        alert("No active game to save.");
        return;
    }
    const gameState = {
        cars: racingGame.cars,
        stages: racingGame.stages,
        leaderboard: racingGame.leaderboard,
        stageResults: racingGame.stageResults,
        currentStageIndex: racingGame.currentStageIndex,
        difficulty: (document.getElementById('difficulty-select') as HTMLSelectElement).value
    };
    localStorage.setItem('savedRacingGame', JSON.stringify(gameState));
    alert("Game Saved!");
}

function loadGameState() {
    const savedStateJSON = localStorage.getItem('savedRacingGame');
    if (!savedStateJSON) {
        alert("No saved game found.");
        return;
    }
    const savedState = JSON.parse(savedStateJSON);

    const cars = savedState.cars.map(c => new Car(c.name, c.speed, c.handling, c.color));
    const stages = savedState.stages.map(s => new Stage(s.name, s.length, s.laps));

    racingGame = new RacingGame(cars, stages);
    racingGame.leaderboard = savedState.leaderboard;
    racingGame.stageResults = savedState.stageResults;
    racingGame.currentStageIndex = savedState.currentStageIndex;
    
    // Restore car states
    racingGame.cars.forEach((car, index) => {
        const savedCar = savedState.cars[index];
        if (savedCar) {
            Object.assign(car, savedCar);
        }
    });

    (document.getElementById('difficulty-select') as HTMLSelectElement).value = savedState.difficulty;
    racingGame.initializeTrackUI(); // Redraw track with loaded state
    console.log("Game Loaded. Run the simulation to continue the race.");
    alert("Game Loaded! Press the play button to continue.");
}


// --- Notebook Cell Definitions ---
const markdownContent = `
# 🏎️ JavaScript Grand Prix

This notebook simulates a simple car racing game. Choose a difficulty and run the code cell below to start the race. The simulation will run through several stages, and a winner will be crowned based on stage victories.

### Game Controls
<div class="game-controls">
  <label for="difficulty-select">Select Difficulty:</label>
  <select id="difficulty-select">
    <option value="easy">Easy</option>
    <option value="medium">Medium</option>
    <option value="hard">Hard</option>
  </select>
</div>

### Race Track
<div id="track-visuals"></div>

### Race History
<div class="history-log" id="history-log"></div>
`;

notebook.addMarkdownCell(markdownContent);

function initializeGame(difficulty: string) {
    let cars: Car[], stages: Stage[];
    if (difficulty === 'easy') {
        cars = [ new Car("Eagle", 220, 8, '#3498db'), new Car("Viper", 210, 9, '#e74c3c'), new Car("Shadow", 230, 7, '#333'), new Car("Bolt", 215, 8.5, '#f1c40f'), ];
        stages = [new Stage("Urban Sprint", 1000, 3)];
    } else if (difficulty === 'medium') {
        cars = [ new Car("Fusion", 240, 7, '#9b59b6'), new Car("Apex", 235, 8, '#2ecc71'), new Car("Blaze", 250, 6, '#e67e22'), new Car("Sting", 230, 9, '#1abc9c'), ];
        stages = [new Stage("City Circuit", 1500, 4), new Stage("Coastal Run", 2000, 3)];
    } else { // hard
        cars = [ new Car("Titan", 260, 6, '#eee'), new Car("Wraith", 250, 7.5, '#34495e'), new Car("Goliath", 270, 5, '#95a5a6'), new Car("Phantom", 255, 8, '#7f8c8d'), ];
        stages = [new Stage("Mountain Pass", 2500, 5), new Stage("Desert Rally", 3000, 4), new Stage("Final Speedway", 1800, 8)];
    }
    racingGame = new RacingGame(cars, stages);
}

function handleDifficultyChange() {
    const difficultySelect = document.getElementById('difficulty-select') as HTMLSelectElement;
    console.clear();
    console.log(`Game difficulty set to ${difficultySelect.value}. Run the simulation to start.`);
    initializeGame(difficultySelect.value);
}

document.addEventListener('DOMContentLoaded', () => {
    // Menu listeners
    const saveBtn = document.getElementById('save-game-btn');
    if (saveBtn) saveBtn.addEventListener('click', saveGameState);
    
    const loadBtn = document.getElementById('load-game-btn');
    if (loadBtn) loadBtn.addEventListener('click', loadGameState);

    // Game control listeners
    const difficultySelect = document.getElementById('difficulty-select');
    if (difficultySelect) {
        difficultySelect.addEventListener('change', handleDifficultyChange);
    }
    
    const summaryCloseBtn = document.getElementById('race-summary-close');
    if (summaryCloseBtn) {
        summaryCloseBtn.addEventListener('click', () => {
            document.getElementById('race-summary-overlay')?.classList.remove('visible');
            handleDifficultyChange(); // Reset game to current difficulty for a new race
        });
    }

    handleDifficultyChange();
    renderRaceHistory();
});


const codeContent = `// Press the play button to start the race!
await racingGame.runRace();
`;

notebook.addCodeCell(codeContent, async (code, output) => {
    try {
        if (racingGame) {
            await racingGame.runRace();
        } else {
            throw new Error("Game not initialized. Please select a difficulty first.");
        }
    } catch (e) {
        output.textContent = e.message;
        console.error(e);
    }
});