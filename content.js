// Debug configuration
const DEBUG = false;

function log(...args) {
    if (DEBUG) console.log(...args);
}

function handleError(error, context) {
    if (DEBUG) console.error(`Error in ${context}:`, error);
}

class ClickRemover {
    constructor(context) {
        // Initialize audio context and processing nodes
        this.audioContext = context;
        this.clickCount = 0;

        this.analyser = this.audioContext.createAnalyser();
        this.inputGain = this.audioContext.createGain();
        this.outputGain = this.audioContext.createGain();
        this.clickGain = this.audioContext.createGain();

        // Set up delay buffer for pre-emptive click detection
        this.delayNode = this.audioContext.createDelay(0.15);
        this.delayNode.delayTime.value = 0.08;

        // Configure analysis parameters
        this.analyser.fftSize = 8192;
        this.lookAheadSize = 8192;
        this.timeBuffer = new Float32Array(this.lookAheadSize);
        this.freqBuffer = new Float32Array(this.lookAheadSize);
        this.analysisOverlap = 256;

        // Set up audio processing chain
        this.inputGain.connect(this.analyser);
        this.inputGain.connect(this.delayNode);
        this.delayNode.connect(this.clickGain);
        this.clickGain.connect(this.outputGain);
        this.outputGain.connect(this.audioContext.destination);

        // Initialize analysis buffers
        this.previousSpectrum = new Float32Array(this.analyser.frequencyBinCount);
        this.currentSpectrum = new Float32Array(this.analyser.frequencyBinCount);
        this.spectralDifference = new Float32Array(this.analyser.frequencyBinCount);
        this.peakHistory = new Array(10).fill(0);
        this.ratioHistory = new Array(10).fill(1);

        this.debugElement = null;
        this.debugEnabled = false;
        this.hostname = window.location.hostname;

        // Core detection parameters
        this.params = {
            freqBands: {
                low: { min: 100, max: 500 },
                mid: { min: 500, max: 2000 },
                high: { min: 2000, max: 8000 }
            },
            thresholds: {
                spectralDifference: 10,
                peakCount: 5,
                maxDiff: 15,
                rms: 0.005,
                lowToHighRatio: 0.5,
                midToLowRatio: 1.2,
                confidenceThreshold: 0.6,
                weights: {
                    spectralChange: 0.4,
                    frequencyRatio: 1.5,
                    amplitudeSpike: 0.9,
                    spectralShape: 1.2
                },
                suddenChange: 8
            }
        };

        this.smoothedValues = {
            confidence: 0,
            lowToHighRatio: 0,
            midToLowRatio: 0,
            rms: 0
        };
        this.smoothingFactor = 0.85;

        // Load user settings
        chrome.storage.sync.get(['debugEnabled', 'globalProcessingEnabled', 'siteSettings'], (data) => {
            if (data.debugEnabled) {
                this.createDebugDisplay();
                this.debugEnabled = true;
            }

            const siteSettings = data.siteSettings || {};
            this.processingEnabled = this.hostname in siteSettings ?
                siteSettings[this.hostname] :
                data.globalProcessingEnabled !== false;

            if (!this.processingEnabled) {
                this.clickGain.gain.setValueAtTime(1.0, this.audioContext.currentTime);
            }
        });

        this.dynamicHistory = new Array(10).fill(0);
        this.sensitivityMultiplier = 1.0;

        chrome.storage.sync.get(['sensitivity'], (data) => {
            if (data.sensitivity) {
                this.sensitivityMultiplier = data.sensitivity / 100;
            }
        });
    }

    // Calculate energy in specific frequency band
    calculateBandEnergy(freqData, minFreq, maxFreq) {
        const minBin = Math.floor(minFreq * this.analyser.frequencyBinCount / this.audioContext.sampleRate);
        const maxBin = Math.floor(maxFreq * this.analyser.frequencyBinCount / this.audioContext.sampleRate);
        let energy = 0;
        for (let i = minBin; i < maxBin; i++) {
            energy += Math.pow(10, freqData[i] / 20);
        }
        return energy / (maxBin - minBin);
    }

    // Main click detection combining frequency and dynamics analysis
    detectClick(timeData, freqData) {
        if (!this.processingEnabled) {
            return { isClick: false, confidence: 0, freqConfidence: 0, dynamicConfidence: 0 };
        }

        // Frequency-based detection
        const lowEnergy = this.calculateBandEnergy(freqData, this.params.freqBands.low.min, this.params.freqBands.low.max);
        const midEnergy = this.calculateBandEnergy(freqData, this.params.freqBands.mid.min, this.params.freqBands.mid.max);
        const highEnergy = this.calculateBandEnergy(freqData, this.params.freqBands.high.min, this.params.freqBands.high.max);

        const lowToHighRatio = lowEnergy / (highEnergy || 0.000001);
        const midToLowRatio = midEnergy / (lowEnergy || 0.000001);

        const freqMethods = {
            spectralChange: {
                detected: lowToHighRatio < this.params.thresholds.lowToHighRatio,
                weight: this.params.thresholds.weights.spectralChange
            },
            frequencyRatio: {
                detected: midToLowRatio > this.params.thresholds.midToLowRatio,
                weight: this.params.thresholds.weights.frequencyRatio
            }
        };

        // Dynamics-based detection
        this.currentSpectrum.set(freqData);
        let totalChange = 0;
        let suddenChange = 0;
        let peakCount = 0;
        let maxChange = 0;

        for (let i = 0; i < this.analyser.frequencyBinCount; i++) {
            const change = Math.abs(this.currentSpectrum[i] - this.previousSpectrum[i]);
            if (change > 0) {
                totalChange += change;
                maxChange = Math.max(maxChange, change);
                if (change > this.params.thresholds.suddenChange) {
                    suddenChange += change;
                    peakCount++;
                }
            }
        }
        this.previousSpectrum.set(this.currentSpectrum);

        this.dynamicHistory.push(totalChange);
        if (this.dynamicHistory.length > 5) {
            this.dynamicHistory.shift();
        }

        const avgChange = this.dynamicHistory.reduce((a, b) => a + b) / this.dynamicHistory.length;
        const dynamicRatio = suddenChange / (avgChange || 0.000001);

        const dynamicMethods = {
            suddenChange: {
                detected: suddenChange > (avgChange * 2.0 / this.sensitivityMultiplier) ||
                    maxChange > (this.params.thresholds.suddenChange * 2 / this.sensitivityMultiplier),
                weight: 1.8 * this.sensitivityMultiplier
            },
            peakDensity: {
                detected: peakCount > (this.analyser.frequencyBinCount * 0.08 / this.sensitivityMultiplier),
                weight: 1.2 * this.sensitivityMultiplier
            },
            dynamicRange: {
                detected: dynamicRatio > (1.8 / this.sensitivityMultiplier),
                weight: 1.0 * this.sensitivityMultiplier
            }
        };

        // Calculate confidence scores and determine if click detected
        const freqConfidence = Object.values(freqMethods)
            .reduce((sum, method) => sum + (method.detected ? method.weight : 0), 0) /
            Object.values(freqMethods).reduce((sum, method) => sum + method.weight, 0);

        const dynamicConfidence = Object.values(dynamicMethods)
            .reduce((sum, method) => sum + (method.detected ? method.weight : 0), 0) /
            Object.values(dynamicMethods).reduce((sum, method) => sum + method.weight, 0);

        const isClick = freqConfidence >= this.params.thresholds.confidenceThreshold ||
            dynamicConfidence >= 0.6;

        const confidence = Math.max(freqConfidence, dynamicConfidence);

        if (isClick) {
            this.handleClickDetected();
        }

        return {
            isClick,
            confidence,
            freqConfidence,
            dynamicConfidence,
            lowToHighRatio,
            midToLowRatio,
            dynamicRatio,
            suddenChange,
            peakCount
        };
    }

    // Apply volume reduction when click detected
    handleClickDetected() {
        const currentTime = this.audioContext.currentTime;
        const lookAheadTime = currentTime + this.delayNode.delayTime.value;

        this.clickGain.gain.cancelScheduledValues(lookAheadTime);
        this.clickGain.gain.setValueAtTime(0.0001, lookAheadTime - 0.025);
        this.clickGain.gain.setValueAtTime(0.0001, lookAheadTime + 0.04);
        this.clickGain.gain.linearRampToValueAtTime(0.2, lookAheadTime + 0.055);
        this.clickGain.gain.linearRampToValueAtTime(0.6, lookAheadTime + 0.075);
        this.clickGain.gain.linearRampToValueAtTime(1.0, lookAheadTime + 0.1);

        this.clickCount++;
    }

    // Process audio chunks for click detection
    analyzeAudio() {
        this.analyser.getByteTimeDomainData(this.timeBuffer);
        this.analyser.getByteFrequencyData(this.freqBuffer);

        for (let i = 0; i < this.lookAheadSize - 512; i += (512 - this.analysisOverlap)) {
            const timeSlice = this.timeBuffer.slice(i, i + 512);
            const freqSlice = this.freqBuffer.slice(i, i + 512);

            const result = this.detectClick(timeSlice, freqSlice);
            if (result.isClick) {
                this.handleClickDetected();
                break;
            }
        }
    }

    // Update debug display with current detection metrics
    updateDebugDisplay(timeData, freqData, detection) {
        if (!this.debugEnabled || !this.debugElement) return;

        this.smoothedValues = {
            confidence: this.smoothValue(this.smoothedValues.confidence, detection.confidence, this.smoothingFactor),
            lowToHighRatio: this.smoothValue(this.smoothedValues.lowToHighRatio, detection.lowToHighRatio, this.smoothingFactor),
            midToLowRatio: this.smoothValue(this.smoothedValues.midToLowRatio, detection.midToLowRatio, this.smoothingFactor),
            rms: this.smoothValue(this.smoothedValues.rms, detection.rms, this.smoothingFactor)
        };

        const confidence = (this.smoothedValues.confidence * 100).toFixed(1);
        const confidenceColor = confidence > 80 ? '#ff4444' :
            confidence > 50 ? '#ffaa44' : '#44ff44';

        const lowHighPercent = (this.smoothedValues.lowToHighRatio * 100).toFixed(0);
        const midLowPercent = (this.smoothedValues.midToLowRatio * 100).toFixed(0);
        const levelPercent = (this.smoothedValues.rms * 100).toFixed(0);

        this.debugElement.innerHTML = `
            <div style="border-bottom: 1px solid rgba(255,255,255,0.2); padding-bottom: 4px; margin-bottom: 8px;">
                <span style="color: ${confidenceColor}">Confidence: ${confidence}%</span>
            </div>
            <div style="display: grid; grid-template-columns: auto 1fr; gap: 4px; font-size: 11px;">
                <span>Low/High:</span><span>${lowHighPercent}%</span>
                <span>Mid/Low:</span><span>${midLowPercent}%</span>
                <span>Level:</span><span>${levelPercent}%</span>
            </div>
            <div style="margin-top: 8px; font-size: 11px;">
                <span style="color: ${detection.isClick ? '#FF5722' : '#4CAF50'}">
                    ${detection.isClick ? '🔔 CLICK' : '👂 Monitoring'}
                </span>
                <span style="float: right;">Clicks: ${this.clickCount}</span>
            </div>
        `;
    }

    // Connect audio source to processor
    processAudio(sourceNode) {
        sourceNode.disconnect();
        sourceNode.connect(this.inputGain);
    }

    // Start continuous click detection
    startDetection() {
        const detect = () => {
            const timeData = new Float32Array(this.analyser.frequencyBinCount);
            const freqData = new Float32Array(this.analyser.frequencyBinCount);

            this.analyser.getFloatTimeDomainData(timeData);
            this.analyser.getFloatFrequencyData(freqData);

            const detection = this.detectClick(timeData, freqData);
            this.updateDebugDisplay(timeData, freqData, detection);

            requestAnimationFrame(detect);
        };
        detect();
    }

    // Create debug overlay
    createDebugDisplay() {
        const existingDisplay = document.getElementById('click-debug');
        if (existingDisplay) {
            existingDisplay.remove();
        }

        const display = document.createElement('div');
        display.id = 'click-debug';
        display.style.cssText = `
            position: fixed;
            bottom: 20px;
            right: 20px;
            background: rgba(0, 0, 0, 0.85);
            color: #fff;
            padding: 10px;
            border-radius: 8px;
            font-family: monospace;
            font-size: 12px;
            z-index: 9999;
            width: 180px;
            backdrop-filter: blur(5px);
            box-shadow: 0 2px 10px rgba(0,0,0,0.3);
        `;
        document.body.appendChild(display);
        this.debugElement = display;
        return display;
    }

    // Toggle debug display
    toggleDebug(enabled) {
        this.debugEnabled = enabled;
        if (enabled) {
            if (!this.debugElement) {
                this.createDebugDisplay();
            }
            this.debugElement.style.display = 'block';
        } else if (this.debugElement) {
            this.debugElement.remove();
            this.debugElement = null;
        }
    }

    // Toggle click removal processing
    toggleProcessing(enabled, isGlobal = false) {
        this.processingEnabled = enabled;

        chrome.storage.sync.get(['siteSettings'], (data) => {
            if (isGlobal) {
                chrome.storage.sync.set({ globalProcessingEnabled: enabled });
            } else {
                const siteSettings = data.siteSettings || {};
                siteSettings[this.hostname] = enabled;
                chrome.storage.sync.set({ siteSettings: siteSettings });
            }
        });

        if (!enabled) {
            this.clickGain.gain.cancelScheduledValues(this.audioContext.currentTime);
            this.clickGain.gain.setValueAtTime(1.0, this.audioContext.currentTime);
        }
    }

    smoothValue(oldValue, newValue, smoothingFactor) {
        return oldValue * smoothingFactor + newValue * (1 - smoothingFactor);
    }
}

// Main audio processor controller
const AudioProcessor = {
    context: null,
    clickRemover: null,
    activeConnections: new Map(),

    init() {
        this.setupEventListeners();
    },

    setupEventListeners() {
        document.addEventListener('click', () => this.ensureAudioContext(), { once: true });
        document.addEventListener('touchstart', () => this.ensureAudioContext(), { once: true });
        document.addEventListener('keydown', () => this.ensureAudioContext(), { once: true });
        document.addEventListener('play', (event) => {
            if (event.target.tagName === 'VIDEO') {
                this.handleVideo(event.target);
            }
        }, true);
    },

    ensureAudioContext() {
        if (!this.context) {
            this.context = new (window.AudioContext || window.webkitAudioContext)();
        }
        if (this.context.state === 'suspended') {
            this.context.resume();
        }
    },

    handleVideo(video) {
        this.ensureAudioContext();

        if (this.context.state === 'running' && !this.activeConnections.has(video)) {
            try {
                const source = this.context.createMediaElementSource(video);
                this.activeConnections.set(video, source);

                if (!this.clickRemover) {
                    this.clickRemover = new ClickRemover(this.context);
                }

                this.clickRemover.processAudio(source);
                this.clickRemover.startDetection();
            } catch (error) {
                handleError(error, 'handleVideo');
            }
        }
    }
};

// Handle messages from popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    try {
        if (!AudioProcessor.clickRemover) return;

        switch (message.type) {
            case 'toggleProcessing':
                AudioProcessor.clickRemover.toggleProcessing(message.value);
                break;
            case 'toggleDebug':
                AudioProcessor.clickRemover.toggleDebug(message.value);
                break;
            case 'updateSensitivity':
                AudioProcessor.clickRemover.sensitivityMultiplier = message.value;
                break;
        }
    } catch (error) {
        handleError(error, 'message listener');
    }
});

// Initialize processor
AudioProcessor.init();